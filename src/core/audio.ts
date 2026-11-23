// Original procedural Foley, prepared once into variant banks. Weather stays
// live; there are no recordings, audio requests or wall-clock playback timers.
import * as THREE from 'three';
import { Music, MusicMood } from './music';
import { SFX_NAMES, SFX_RATE, synthesizeSound, variantCount } from './sfx';
import type { SoundName } from './sfx';
export type { SoundName } from './sfx';

export interface FootstepSound {
  footwear: 'soft' | 'boot' | 'sneaker' | 'bare';
  speed: number;
  landing: boolean;
  compaction?: number;
}
export interface SoundOptions { pos?: THREE.Vector3; vol?: number; footstep?: FootstepSound }
interface Voice {
  source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode; panner: StereoPannerNode;
  pos?: THREE.Vector3; volume: number; pan: number; priority: number; started: number;
}
const MAX_VOICES = 24;
const MAX_RETIRING = 4; // short crossfades count toward a separate hard bound
const clamp = THREE.MathUtils.clamp;
const priority = (name: SoundName) => name === 'ice_break' || name === 'howl' || name === 'knock' ? 3
  : name.startsWith('step_') || name === 'click' || name === 'pickup' ? 1 : 2;

export class GameAudio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  music: Music | null = null;
  listener = new THREE.Vector3();
  listenerDir = new THREE.Vector3(0, 0, -1);
  volume = 0.8;
  private effects!: GainNode;
  private ambience!: GainNode;
  private roomWet!: GainNode;
  private noise!: AudioBuffer;
  private windBP!: BiquadFilterNode;
  private windLP!: BiquadFilterNode;
  private windGain!: GainNode;
  private howlBP: BiquadFilterNode[] = [];
  private howlGain: GainNode[] = [];
  private rumbleGain!: GainNode;
  private gust = 0;
  private howlPhase = [1.7, 4.2];
  private banks = new Map<SoundName, AudioBuffer[]>();
  private bags = new Map<SoundName, number[]>();
  private recent = new Map<SoundName, number[]>();
  private prepared = new Map<SoundName, Float32Array[]>();
  private voices = new Set<Voice>();
  private retiring = new Set<Voice>();
  private crackleTimer = 0;

  constructor() {
    // Prepare during game loading, before the user gesture. The Start click only
    // uploads PCM to WebAudio; synthesis never stalls a foot-contact frame.
    for (const name of SFX_NAMES) {
      this.prepared.set(name, Array.from({ length: variantCount(name) }, (_, v) => synthesizeSound(name, v)));
    }
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return;
    }
    let ctx: AudioContext;
    try { ctx = new AudioContext(); } catch { return; }
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    // Headroom for coincident impacts; music bypasses the retro SFX bus.
    const safety = ctx.createDynamicsCompressor();
    safety.threshold.value = -8; safety.knee.value = 4; safety.ratio.value = 12;
    safety.attack.value = 0.002; safety.release.value = 0.14;
    this.master.connect(safety).connect(ctx.destination);
    this.effects = ctx.createGain(); this.effects.gain.value = 0.85;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 28; hp.Q.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 8000; lp.Q.value = 0.5;
    this.effects.connect(hp).connect(lp).connect(this.master);
    // One original short room impulse, silent outdoors. No IR asset needed.
    const room = ctx.createConvolver(); room.normalize = false;
    // ConvolverNode requires an impulse at the context rate (unlike sources).
    const irRate = ctx.sampleRate;
    const impulse = ctx.createBuffer(2, Math.ceil(irRate * 0.36), irRate);
    let seed = 76129;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c);
      let filtered = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / irRate;
        filtered += (1 - Math.exp(-Math.PI * 2 * 900 / irRate)) * (random() * 2 - 1 - filtered);
        data[i] = t > 0.018 ? filtered * Math.exp(-t * 23) * 0.08 : 0;
      }
      for (const [t, a] of [[0.024, 0.19], [0.047, 0.11], [0.079, 0.065]])
        data[Math.round((t + c * 0.0027) * irRate)] += a;
    }
    room.buffer = impulse;
    this.roomWet = ctx.createGain(); this.roomWet.gain.value = 0;
    lp.connect(room).connect(this.roomWet).connect(this.master);
    for (const name of SFX_NAMES) {
      const bank: AudioBuffer[] = [];
      for (const samples of this.prepared.get(name)!) {
        const buffer = ctx.createBuffer(1, samples.length, SFX_RATE);
        buffer.getChannelData(0).set(samples); bank.push(buffer);
      }
      this.banks.set(name, bank);
    }
    this.prepared.clear();
    this.ambience = ctx.createGain(); this.ambience.gain.value = 0.65;
    this.ambience.connect(this.master);
    const len = SFX_RATE * 5;
    this.noise = ctx.createBuffer(1, len, SFX_RATE);
    const data = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = random() * 2 - 1;
      last = (last + 0.025 * w) / 1.025;
      data[i] = last * 2.9 + w * 0.035;
    }
    // Blend end into the head, then loop at the matching head sample.
    const seam = Math.floor(SFX_RATE * 0.04);
    for (let i = 0; i < seam; i++) {
      const f = i / (seam - 1);
      data[len - seam + i] = data[len - seam + i] * (1 - f) + data[i] * f;
    }
    const loopStart = (seam - 1) / SFX_RATE;
    const wind = ctx.createBufferSource(); wind.buffer = this.noise; wind.loop = true; wind.loopStart = loopStart;
    this.windBP = ctx.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 400; this.windBP.Q.value = 0.6;
    this.windLP = ctx.createBiquadFilter(); this.windLP.type = 'lowpass'; this.windLP.frequency.value = 3000;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    wind.connect(this.windBP).connect(this.windLP).connect(this.windGain).connect(this.ambience); wind.start();
    for (let i = 0; i < 2; i++) {
      const source = ctx.createBufferSource(); source.buffer = this.noise; source.loop = true;
      source.loopStart = loopStart; source.playbackRate.value = 0.88 + i * 0.17;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5; bp.frequency.value = 450;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const pan = ctx.createStereoPanner(); pan.pan.value = i ? 0.58 : -0.58;
      source.connect(bp).connect(gain).connect(pan).connect(this.ambience); source.start(0, i * 0.7);
      this.howlBP.push(bp); this.howlGain.push(gain);
    }
    const rumble = ctx.createBufferSource(); rumble.buffer = this.noise; rumble.loop = true;
    rumble.loopStart = loopStart; rumble.playbackRate.value = 0.5;
    const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 125;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    rumble.connect(rl).connect(this.rumbleGain).connect(this.ambience); rumble.start();
    this.music = new Music(ctx, this.master);
    if (new URLSearchParams(location.search).get('music') === '0') this.music.setEnabled(false);
  }

  setMood(mood: MusicMood) { this.music?.setMood(mood); }
  setListener(pos: THREE.Vector3, dir: THREE.Vector3) {
    this.listener.copy(pos); this.listenerDir.copy(dir);
    if (this.ctx) for (const voice of this.voices) this.positionVoice(voice, false);
  }

  update(dt: number, wind: number, indoors: boolean, nearestFire: { level: number; pos?: THREE.Vector3 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.gust += Math.max(0, dt) * 0.42;
    const gustF = 0.75 + 0.25 * Math.sin(this.gust) * Math.sin(this.gust * 0.37 + 1.3);
    const level = clamp(wind / 16, 0, 1) * gustF;
    this.windGain.gain.setTargetAtTime((indoors ? 0.16 : 0.43) * (0.08 + level), t, 0.3);
    this.windBP.frequency.setTargetAtTime(240 + level * 740 * gustF, t, 0.4);
    this.windLP.frequency.setTargetAtTime(indoors ? 480 : 3600, t, 0.3);
    const howl = clamp((wind - 4) / 12, 0, 1.5);
    for (let i = 0; i < 2; i++) {
      this.howlPhase[i] += Math.max(0, dt) * (0.15 + 0.1 * i) * (0.5 + level);
      const sweep = 0.5 + 0.5 * Math.sin(this.howlPhase[i]) * Math.sin(this.howlPhase[i] * 0.41 + i);
      this.howlBP[i].frequency.setTargetAtTime((indoors ? 230 : 340) + sweep * (indoors ? 260 : 570), t, 0.25);
      this.howlGain[i].gain.setTargetAtTime(howl * howl * (indoors ? 0.035 : 0.075) * (0.3 + 0.7 * sweep) * gustF, t, 0.35);
    }
    this.rumbleGain.gain.setTargetAtTime(clamp((wind - 8) / 10, 0, 1.5) * (indoors ? 0.15 : 0.34), t, 0.8);
    this.roomWet.gain.setTargetAtTime(indoors ? 0.2 : 0, t, 0.16);
    this.music?.update();
    // Ambient crackles aren't gameplay action notifications. The same voice
    // path keeps their position stable as the listener turns.
    this.crackleTimer -= Math.max(0, dt);
    if (this.crackleTimer <= 0 && nearestFire.level > 0 && nearestFire.pos) {
      const fire = clamp(nearestFire.level, 0, 2);
      this.crackleTimer = 0.12 + Math.random() * 0.45 / (0.3 + fire);
      this.playVoice('crack', { pos: nearestFire.pos, vol: fire * (0.045 + Math.random() * 0.05) }, 0);
    }
  }

  private panFor(pos: THREE.Vector3): number {
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z, len = Math.hypot(dx, dz) || 1;
    const rx = -this.listenerDir.z, rz = this.listenerDir.x, rl = Math.hypot(rx, rz) || 1;
    return clamp((dx * rx + dz * rz) / (len * rl), -1, 1);
  }
  private positionVoice(voice: Voice, immediate: boolean) {
    const t = this.ctx!.currentTime, distance = voice.pos?.distanceTo(this.listener) ?? 0;
    const volume = voice.volume / (1 + distance * distance * 0.02);
    const pan = voice.pos ? this.panFor(voice.pos) * Math.min(1, distance / 3) : voice.pan;
    if (immediate) {
      voice.gain.gain.setValueAtTime(volume, t); voice.panner.pan.setValueAtTime(pan, t);
    } else {
      voice.gain.gain.setTargetAtTime(volume, t, 0.035); voice.panner.pan.setTargetAtTime(pan, t, 0.035);
    }
  }
  private nextBuffer(name: SoundName): AudioBuffer {
    const bank = this.banks.get(name)!;
    let bag = this.bags.get(name);
    if (!bag?.length) {
      bag = bank.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      this.bags.set(name, bag);
    }
    const recent = this.recent.get(name) ?? [];
    const eligible = bag.findIndex(i => !recent.includes(i));
    const index = bag.splice(eligible < 0 ? bag.length - 1 : eligible, 1)[0];
    recent.push(index);
    while (recent.length > Math.min(3, bank.length - 1)) recent.shift();
    this.recent.set(name, recent);
    return bank[index];
  }
  private playVoice(name: SoundName, opts: SoundOptions, rank: number) {
    const ctx = this.ctx;
    if (!ctx || !this.banks.has(name)) return;
    const requested = opts.vol ?? 1;
    if (!Number.isFinite(requested) || requested <= 0) return;
    const distance = opts.pos?.distanceTo(this.listener) ?? 0;
    if (requested / (1 + distance * distance * 0.02) < 0.005) return;
    // Reserve four foreground slots for danger cues. A burst cannot allocate
    // unlimited fading sources while the audio clock hasn't advanced.
    const budget = rank < 3 ? MAX_VOICES - 4 : MAX_VOICES;
    if (this.voices.size >= budget) {
      if (this.retiring.size >= MAX_RETIRING) return;
      const victim = [...this.voices].filter(v => v.priority <= rank)
        .sort((a, b) => a.priority - b.priority || a.started - b.started)[0];
      if (!victim) return;
      this.voices.delete(victim);
      this.retiring.add(victim);
      const t = ctx.currentTime;
      victim.gain.gain.cancelAndHoldAtTime(t); victim.gain.gain.linearRampToValueAtTime(0, t + 0.012);
      victim.source.stop(t + 0.015);
    }
    const source = ctx.createBufferSource(); source.buffer = this.nextBuffer(name);
    const gain = ctx.createGain(), filter = ctx.createBiquadFilter(), panner = ctx.createStereoPanner();
    filter.type = rank === 0 ? 'highpass' : 'lowpass';
    filter.Q.value = 0.5; filter.frequency.value = rank === 0 ? 1500 : 9000;
    let volume = clamp(requested, 0, 4) * (0.93 + Math.random() * 0.14);
    let rate = 0.975 + Math.random() * 0.05;
    const foot = opts.footstep;
    if (foot) {
      const soft = foot.footwear === 'soft' || foot.footwear === 'bare';
      volume *= foot.footwear === 'bare' ? 0.62 : foot.footwear === 'soft' ? 0.78 : 1;
      rate *= foot.footwear === 'boot' ? 0.94 : soft ? 1.025 : 1;
      rate *= 1 + clamp((foot.speed - 1.4) * 0.012, -0.02, 0.035);
      volume *= 1 + clamp((foot.speed - 1.4) * 0.045, -0.04, 0.16);
      filter.frequency.value = soft ? 3700 : 8200;
      if (name === 'step_snow') {
        const packed = clamp(foot.compaction ?? 0, 0, 1);
        filter.frequency.value *= 1 - 0.3 * packed; rate *= 1 + 0.07 * packed;
      }
      if (foot.landing) { rate *= 0.9; volume *= 1.12; }
    }
    source.playbackRate.value = rate;
    const voice: Voice = { source, gain, filter, panner, pos: opts.pos?.clone(), volume,
      pan: name === 'whisper' && !opts.pos ? (Math.random() * 2 - 1) * 0.65 : 0,
      priority: rank, started: ctx.currentTime };
    source.connect(filter).connect(gain).connect(panner).connect(this.effects);
    this.positionVoice(voice, true); this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice); this.retiring.delete(voice); source.disconnect(); filter.disconnect(); gain.disconnect(); panner.disconnect(); source.onended = null;
    };
    source.start();
  }
  /** One gameplay notification even when audio is muted or hasn't started. */
  onSound: ((name: SoundName, pos: THREE.Vector3 | undefined) => void) | null = null;
  play(name: SoundName, opts: SoundOptions = {}) {
    this.onSound?.(name, opts.pos); this.playVoice(name, opts, priority(name));
  }
}
