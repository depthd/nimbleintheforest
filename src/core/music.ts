// Generative ambient score, synthesized live: slow minor pads, sparse piano-like notes and a
// long reverb. The mood follows the game: calm by a fire, bleak at night and in a blizzard,
// tense when freezing. Pieces play for a few minutes, then there is silence for a while.

export type MusicMood = 'calm' | 'bleak' | 'danger' | 'wonder';

const MIDI = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// chords as MIDI notes (D minor world)
const PROGRESSIONS: Record<MusicMood, number[][]> = {
  calm: [[50, 57, 62, 65], [46, 53, 58, 62], [41, 48, 57, 60], [48, 55, 60, 64]],
  bleak: [[38, 45, 50, 53], [34, 41, 46, 50], [36, 43, 48, 51], [33, 40, 45, 48]],
  danger: [[38, 44, 50, 51], [37, 44, 49, 50], [38, 45, 51, 52]],
  wonder: [[50, 57, 64, 69], [45, 52, 59, 64], [47, 54, 59, 66], [43, 50, 57, 62]],
};
// melody scales
const SCALES: Record<MusicMood, number[]> = {
  calm: [62, 64, 65, 69, 72, 74, 77],
  bleak: [57, 60, 62, 65, 69],
  danger: [62, 63, 66, 69],
  wonder: [64, 66, 69, 71, 73, 76, 78],
};

export class Music {
  private ctx: AudioContext;
  private out: GainNode;
  private verb: ConvolverNode;
  private wet: GainNode;
  private dry: GainNode;
  mood: MusicMood = 'bleak';
  enabled = true;
  private playing = false;
  private nextChord = 0;
  private nextNote = 0;
  private pieceEnd = 0;
  private silenceEnd = 0;
  private chordIdx = 0;
  private voices: { osc: OscillatorNode[]; gain: GainNode }[] = [];
  volume = 0.33;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(dest);
    // long, dark reverb from decaying noise
    this.verb = ctx.createConvolver();
    const len = ctx.sampleRate * 5;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp = lp * 0.7 + (Math.random() * 2 - 1) * 0.3;
        d[i] = lp * Math.pow(1 - i / len, 2.6);
      }
    }
    this.verb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.9;
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.45;
    this.verb.connect(this.wet).connect(this.out);
    this.dry.connect(this.out);
    // start with a short silence so the wind comes first
    this.silenceEnd = ctx.currentTime + 25;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.out.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 1.5);
  }

  setMood(m: MusicMood) {
    if (m === this.mood) return;
    this.mood = m;
    // danger cuts in; other moods change at the next chord
    if (m === 'danger' && this.ctx.currentTime > this.silenceEnd) this.nextChord = this.ctx.currentTime;
  }

  update() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    if (!this.playing) {
      if (t < this.silenceEnd && this.mood !== 'danger') return;
      this.playing = true;
      this.pieceEnd = t + 120 + Math.random() * 120;
      this.nextChord = t;
      this.nextNote = t + 6;
    }
    if (t > this.pieceEnd && this.mood !== 'danger') {
      this.playing = false;
      this.releaseVoices(t, 9);
      this.silenceEnd = t + 60 + Math.random() * 120;
      return;
    }
    if (t >= this.nextChord) {
      const prog = PROGRESSIONS[this.mood];
      this.chordIdx = (this.chordIdx + 1) % prog.length;
      this.chord(prog[this.chordIdx], t);
      this.nextChord = t + (this.mood === 'danger' ? 9 : 15 + Math.random() * 6);
    }
    if (t >= this.nextNote) {
      const sc = SCALES[this.mood];
      // sparse phrases of 1-4 notes, then a long rest
      const phrase = 1 + Math.floor(Math.random() * (this.mood === 'calm' || this.mood === 'wonder' ? 4 : 2));
      let at = t;
      let idx = Math.floor(Math.random() * sc.length);
      for (let i = 0; i < phrase; i++) {
        idx = Math.max(0, Math.min(sc.length - 1, idx + Math.floor(Math.random() * 3) - 1));
        this.pluck(MIDI(sc[idx] - (this.mood === 'bleak' ? 12 : 0)), at, 0.12 + Math.random() * 0.05);
        at += 0.6 + Math.random() * 1.1;
      }
      this.nextNote = at + (this.mood === 'danger' ? 6 : 5 + Math.random() * 9);
    }
  }

  private releaseVoices(t: number, rel: number) {
    for (const v of this.voices) {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, rel / 3);
      for (const o of v.osc) o.stop(t + rel * 2);
    }
    this.voices = [];
  }

  private chord(notes: number[], t: number) {
    this.releaseVoices(t, 6);
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.mood === 'danger' ? 500 : this.mood === 'bleak' ? 700 : 1100;
    lp.Q.value = 0.4;
    // slow filter breathing
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05 + Math.random() * 0.05;
    const lfoG = ctx.createGain();
    lfoG.gain.value = lp.frequency.value * 0.35;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start(t);
    const osc: OscillatorNode[] = [lfo];
    for (const n of notes) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = MIDI(n);
        o.detune.value = det + Math.random() * 3;
        o.connect(lp);
        o.start(t);
        osc.push(o);
      }
    }
    lp.connect(g);
    g.connect(this.verb);
    g.connect(this.dry);
    const level = this.mood === 'danger' ? 0.05 : 0.035;
    g.gain.setTargetAtTime(level, t, 3.5);
    this.voices.push({ osc, gain: g });
  }

  /** a soft, piano-like note */
  private pluck(f: number, t: number, vol: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(vol * 0.25, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 6, t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + 2);
    for (const [mult, a] of [[1, 1], [2, 0.35], [3, 0.12], [4.01, 0.06]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + 5);
    }
    lp.connect(g);
    g.connect(this.verb);
    g.connect(this.dry);
  }
}
