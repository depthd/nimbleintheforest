// Procedural sound: wind, fire crackle, footsteps, chopping and so on.
// Everything is synthesized with WebAudio, no sound files.
import * as THREE from 'three';
import { Music, MusicMood } from './music';

export type SoundName =
  | 'chop' | 'thud' | 'step_snow' | 'step_wood' | 'glass' | 'crack' | 'ice_break'
  | 'match' | 'match_fail' | 'plink' | 'splash' | 'knock' | 'howl' | 'whisper'
  | 'swing' | 'saw' | 'pickup' | 'drop' | 'tree_fall' | 'creak' | 'hammer'
  | 'tear' | 'eat' | 'drink' | 'click' | 'fire_ignite' | 'snow_scoop';

export class GameAudio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private noise!: AudioBuffer;
  private windSrc?: AudioBufferSourceNode;
  private windBP!: BiquadFilterNode;
  private windLP!: BiquadFilterNode;
  private windGain!: GainNode;
  private gust = 0;
  private howlBP: BiquadFilterNode[] = [];
  private howlGain: GainNode[] = [];
  private rumbleGain!: GainNode;
  private howlPhase = [Math.random() * 10, Math.random() * 10];
  music: Music | null = null;
  private crackleLevel = 0;
  private crackleTimer = 0;
  private cracklePan = 0;
  listener = new THREE.Vector3();
  listenerDir = new THREE.Vector3(0, 0, -1);
  volume = 0.8;

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    // brown-ish noise
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5 + w * 0.08;
    }
    // wind loop
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = this.noise;
    this.windSrc.loop = true;
    this.windBP = ctx.createBiquadFilter();
    this.windBP.type = 'bandpass';
    this.windBP.frequency.value = 400;
    this.windBP.Q.value = 0.6;
    this.windLP = ctx.createBiquadFilter();
    this.windLP.type = 'lowpass';
    this.windLP.frequency.value = 3000;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windBP).connect(this.windLP).connect(this.windGain).connect(this.master);
    this.windSrc.start();
    // whistling gusts: narrow resonant bands that slide up and down, left and right
    for (let i = 0; i < 2; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.9 + i * 0.23;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 14;
      bp.frequency.value = 500;
      const gn = ctx.createGain();
      gn.gain.value = 0;
      const pan = ctx.createStereoPanner();
      pan.pan.value = i ? 0.6 : -0.6;
      src.connect(bp).connect(gn).connect(pan).connect(this.master);
      src.start(0, i * 0.7);
      this.howlBP.push(bp);
      this.howlGain.push(gn);
    }
    // low roar of a blizzard
    const rs = ctx.createBufferSource();
    rs.buffer = this.noise;
    rs.loop = true;
    rs.playbackRate.value = 0.5;
    const rl = ctx.createBiquadFilter();
    rl.type = 'lowpass';
    rl.frequency.value = 140;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rs.connect(rl).connect(this.rumbleGain).connect(this.master);
    rs.start();
    this.music = new Music(ctx, this.master);
    if (new URLSearchParams(location.search).get('music') === '0') this.music.setEnabled(false);
  }

  setMood(m: MusicMood) {
    this.music?.setMood(m);
  }

  setListener(pos: THREE.Vector3, dir: THREE.Vector3) {
    this.listener.copy(pos);
    this.listenerDir.copy(dir);
  }

  update(dt: number, wind: number, indoors: boolean, nearestFire: { level: number; pos?: THREE.Vector3 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.gust += dt * (0.3 + Math.random() * 0.4);
    const gustF = 0.75 + 0.25 * Math.sin(this.gust) * Math.sin(this.gust * 0.37 + 1.3);
    const level = Math.min(1, wind / 16) * gustF;
    const g = (indoors ? 0.18 : 0.55) * (0.08 + level);
    this.windGain.gain.setTargetAtTime(g, t, 0.3);
    this.windBP.frequency.setTargetAtTime(250 + level * 900 * gustF, t, 0.4);
    this.windLP.frequency.setTargetAtTime(indoors ? 500 : 4000, t, 0.3);
    // howling: starts with a fresh breeze, screams in a blizzard
    const howl = Math.max(0, (wind - 4) / 12);
    for (let i = 0; i < 2; i++) {
      this.howlPhase[i] += dt * (0.15 + 0.1 * i) * (0.5 + level);
      const sweep = 0.5 + 0.5 * Math.sin(this.howlPhase[i]) * Math.sin(this.howlPhase[i] * 0.41 + i);
      this.howlBP[i].frequency.setTargetAtTime((indoors ? 260 : 380) + sweep * (indoors ? 300 : 700) * (0.6 + howl), t, 0.25);
      const hg = howl * howl * (indoors ? 0.05 : 0.11) * (0.3 + 0.7 * sweep) * gustF;
      this.howlGain[i].gain.setTargetAtTime(hg, t, 0.35);
    }
    this.rumbleGain.gain.setTargetAtTime(Math.max(0, (wind - 8) / 10) * (indoors ? 0.25 : 0.6), t, 0.8);
    this.music?.update();

    // fire crackle
    let lvl = 0;
    if (nearestFire.level > 0 && nearestFire.pos) {
      const d = nearestFire.pos.distanceTo(this.listener);
      lvl = nearestFire.level / (1 + d * d * 0.15);
      this.cracklePan = this.panFor(nearestFire.pos);
    }
    this.crackleLevel = lvl;
    this.crackleTimer -= dt;
    if (this.crackleLevel > 0.02 && this.crackleTimer <= 0) {
      this.crackleTimer = 0.03 + Math.random() * (0.35 / (0.3 + this.crackleLevel));
      this.burst(0.01 + Math.random() * 0.03, 1500 + Math.random() * 3000, 'highpass', Math.min(0.5, this.crackleLevel * (0.2 + Math.random() * 0.6)), this.cracklePan);
    }
  }

  private panFor(pos: THREE.Vector3): number {
    const dx = pos.x - this.listener.x;
    const dz = pos.z - this.listener.z;
    const len = Math.hypot(dx, dz) || 1;
    // right vector of listener dir
    const rx = -this.listenerDir.z, rz = this.listenerDir.x;
    const rl = Math.hypot(rx, rz) || 1;
    return Math.max(-1, Math.min(1, (dx * rx + dz * rz) / (len * rl)));
  }

  private out(pan: number): AudioNode {
    const ctx = this.ctx!;
    if (pan === 0) return this.master;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master);
    return p;
  }

  private burst(dur: number, freq: number, type: BiquadFilterType, vol: number, pan = 0, q = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out(pan));
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', glide = 0, pan = 0, delay = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + glide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(pan));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** called for every sound with its loudness radius (animals listen to it) */
  onSound: ((name: SoundName, pos: THREE.Vector3 | undefined) => void) | null = null;

  play(name: SoundName, opts: { pos?: THREE.Vector3; vol?: number } = {}) {
    this.onSound?.(name, opts.pos);
    if (!this.ctx) return;
    let vol = opts.vol ?? 1;
    let pan = 0;
    if (opts.pos) {
      const d = opts.pos.distanceTo(this.listener);
      vol *= 1 / (1 + d * d * 0.02);
      pan = this.panFor(opts.pos) * Math.min(1, d / 3);
      if (vol < 0.01) return;
    }
    switch (name) {
      case 'chop':
        this.tone(140 + Math.random() * 40, 0.18, 0.5 * vol, 'triangle', -60, pan);
        this.burst(0.09, 900, 'bandpass', 0.6 * vol, pan, 1.2);
        break;
      case 'saw':
        this.burst(0.22, 2500 + Math.random() * 800, 'bandpass', 0.25 * vol, pan, 4);
        break;
      case 'thud':
        this.tone(90, 0.2, 0.45 * vol, 'sine', -40, pan);
        this.burst(0.06, 400, 'lowpass', 0.4 * vol, pan);
        break;
      case 'hammer':
        this.tone(900, 0.06, 0.25 * vol, 'square', -300, pan);
        this.tone(180, 0.12, 0.35 * vol, 'triangle', -50, pan);
        break;
      case 'step_snow':
        this.burst(0.09 + Math.random() * 0.04, 1800 + Math.random() * 1500, 'bandpass', 0.18 * vol, pan, 0.8);
        break;
      case 'step_wood':
        this.tone(110 + Math.random() * 30, 0.08, 0.2 * vol, 'triangle', -30, pan);
        this.burst(0.03, 600, 'lowpass', 0.12 * vol, pan);
        break;
      case 'glass':
        for (let i = 0; i < 7; i++) this.tone(2000 + Math.random() * 4000, 0.15 + Math.random() * 0.3, 0.12 * vol, 'sine', 0, pan, i * 0.02);
        this.burst(0.25, 5000, 'highpass', 0.5 * vol, pan);
        break;
      case 'crack':
        this.burst(0.05, 3000, 'highpass', 0.5 * vol, pan);
        this.tone(600, 0.4, 0.15 * vol, 'sawtooth', -500, pan);
        break;
      case 'ice_break':
        this.burst(0.5, 800, 'lowpass', 0.9 * vol, pan);
        this.tone(80, 0.8, 0.5 * vol, 'sine', -30, pan);
        this.burst(0.6, 3000, 'highpass', 0.4 * vol, pan);
        break;
      case 'splash':
        this.burst(0.6, 1200, 'bandpass', 0.6 * vol, pan, 0.5);
        break;
      case 'match':
        this.burst(0.08, 3500, 'highpass', 0.35 * vol, pan);
        this.burst(0.5, 1500, 'bandpass', 0.15 * vol, pan, 0.6);
        break;
      case 'match_fail':
        this.burst(0.07, 3000, 'highpass', 0.3 * vol, pan);
        break;
      case 'fire_ignite':
        this.burst(0.9, 600, 'lowpass', 0.3 * vol, pan);
        break;
      case 'plink':
        this.tone(1400, 0.25, 0.25 * vol, 'sine', -200, pan);
        break;
      case 'knock':
        for (let i = 0; i < 3; i++) {
          this.tone(120, 0.12, 0.6 * vol, 'triangle', -40, pan, i * 0.42);
        }
        break;
      case 'howl': {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = 5;
        lg.gain.value = 8;
        lfo.connect(lg).connect(o.frequency);
        const t = ctx.currentTime;
        o.frequency.setValueAtTime(380, t);
        o.frequency.linearRampToValueAtTime(620, t + 0.8);
        o.frequency.linearRampToValueAtTime(560, t + 2.4);
        o.frequency.linearRampToValueAtTime(330, t + 3.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.06 * vol, t + 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 1200;
        o.connect(f).connect(g).connect(this.out(pan));
        o.start(t);
        lfo.start(t);
        o.stop(t + 3.8);
        lfo.stop(t + 3.8);
        break;
      }
      case 'whisper':
        for (let i = 0; i < 6; i++) {
          setTimeout(() => this.ctx && this.burst(0.15 + Math.random() * 0.2, 2500 + Math.random() * 2000, 'bandpass', 0.07 * vol, Math.random() * 2 - 1, 3), i * 180 + Math.random() * 120);
        }
        break;
      case 'swing':
        this.burst(0.18, 700, 'bandpass', 0.15 * vol, pan, 0.7);
        break;
      case 'pickup':
        this.burst(0.06, 1200, 'bandpass', 0.15 * vol, pan);
        break;
      case 'drop':
        this.tone(160, 0.1, 0.2 * vol, 'triangle', -60, pan);
        break;
      case 'tree_fall':
        this.burst(1.5, 300, 'lowpass', 0.9 * vol, pan);
        for (let i = 0; i < 5; i++) this.burst(0.08, 2000, 'highpass', 0.3 * vol, pan);
        this.tone(55, 1.2, 0.5 * vol, 'sine', -15, pan, 1.2);
        break;
      case 'creak':
        this.tone(220 + Math.random() * 80, 0.5, 0.06 * vol, 'sawtooth', 40, pan);
        break;
      case 'tear':
        this.burst(0.3, 2200, 'bandpass', 0.3 * vol, pan, 1.5);
        break;
      case 'eat':
        for (let i = 0; i < 3; i++) setTimeout(() => this.ctx && this.burst(0.06, 1000, 'bandpass', 0.2 * vol, pan), i * 220);
        break;
      case 'drink':
        for (let i = 0; i < 3; i++) this.tone(300 + Math.random() * 100, 0.1, 0.15 * vol, 'sine', 100, pan, i * 0.3);
        break;
      case 'click':
        this.tone(1800, 0.03, 0.12 * vol, 'square', 0, pan);
        break;
      case 'snow_scoop':
        this.burst(0.25, 1500, 'bandpass', 0.3 * vol, pan, 0.6);
        break;
    }
  }
}
