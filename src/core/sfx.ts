// Original, deterministic foley-like PCM: granular friction, damped bodies and
// breath/formant layers. No recordings, network fetches or generated timers.
// 24 kHz and gentle saturation are artistic PS1-era coloration, not SPU emulation.
export const SFX_RATE = 24000;
export const SFX_NAMES = [
  'chop', 'thud', 'step_snow', 'step_wood', 'glass', 'crack', 'ice_break',
  'match', 'match_fail', 'plink', 'splash', 'knock', 'howl', 'whisper',
  'swing', 'saw', 'pickup', 'drop', 'tree_fall', 'creak', 'hammer',
  'tear', 'eat', 'drink', 'click', 'fire_ignite', 'snow_scoop', 'step_ice', 'step_stone',
] as const;
export type SoundName = typeof SFX_NAMES[number];

const TAU = Math.PI * 2;
const durations: Record<SoundName, number> = {
  chop: 0.57, thud: 0.43, step_snow: 0.46, step_wood: 0.34, step_ice: 0.32, step_stone: 0.28,
  glass: 1.15, crack: 0.57, ice_break: 1.9, match: 0.57, match_fail: 0.24, plink: 0.31,
  splash: 0.9, knock: 1.18, howl: 3.4, whisper: 1.55, swing: 0.29, saw: 0.46,
  pickup: 0.21, drop: 0.43, tree_fall: 3.1, creak: 0.86, hammer: 0.39,
  tear: 0.52, eat: 0.74, drink: 1.02, click: 0.075, fire_ignite: 1.1, snow_scoop: 0.54,
};

export function variantCount(name: SoundName) { return name.startsWith('step_') ? 8 : 3; }

/** Stable PRNG: a variant is reproducible without replacing gameplay Math.random. */
function randomFor(name: string, variant: number) {
  let state = 2166136261;
  for (let i = 0; i < name.length; i++) state = Math.imul(state ^ name.charCodeAt(i), 16777619);
  state ^= Math.imul(variant | 0, 0x9e3779b1);
  return () => {
    state += 0x6d2b79f5;
    let x = Math.imul(state ^ state >>> 15, state | 1);
    x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

/** Build a complete event, including any internal knocks/grains, at native rate. */
export function synthesizeSound(name: SoundName, variant: number): Float32Array {
  const random = randomFor(name, variant);
  const range = (a: number, b: number) => a + (b - a) * random();
  const pcm = new Float32Array(Math.ceil(durations[name] * SFX_RATE));
  const voicePitch = range(0.91, 1.09);

  // Band-limited, attack/release-shaped noise. Moving granular envelopes create
  // friction without looping a conspicuous identical noise fragment.
  const noise = (start: number, length: number, gain: number, low: number, high: number,
    attack = 0.002, decay = 2, modulation = 0) => {
    const from = Math.max(0, Math.floor(start * SFX_RATE));
    const count = Math.min(Math.ceil(length * SFX_RATE), pcm.length - from);
    const lo = 1 - Math.exp(-TAU * Math.max(10, high) / SFX_RATE);
    const hi = 1 - Math.exp(-TAU * Math.max(5, low) / SFX_RATE);
    let lowPass = 0, highPass = 0;
    const phase = range(0, TAU);
    for (let i = 0; i < count; i++) {
      const t = i / SFX_RATE, u = t / length;
      lowPass += lo * (random() * 2 - 1 - lowPass);
      highPass += hi * (lowPass - highPass);
      const env = Math.min(1, t / Math.max(attack, 0.0001)) * Math.pow(Math.max(0, 1 - u), decay);
      const rough = modulation ? 0.62 + 0.38 * Math.sin(TAU * modulation * t + phase) : 1;
      pcm[from + i] += (lowPass - highPass) * gain * env * rough;
    }
  };

  // Inharmonic decaying modes: wood, glass and metal share an excitation but
  // differ in stiffness, damping and modal spacing, rather than musical notes.
  const modes = (start: number, length: number, fundamental: number, gain: number,
    ratios: readonly number[], damping = 7, attack = 0.0015) => {
    const from = Math.max(0, Math.floor(start * SFX_RATE));
    const count = Math.min(Math.ceil(length * SFX_RATE), pcm.length - from);
    for (let m = 0; m < ratios.length; m++) {
      const frequency = fundamental * ratios[m] * range(0.975, 1.025);
      const amplitude = gain / Math.pow(m + 1, 0.85);
      const loss = damping * (1 + m * 0.34);
      const p = range(-0.25, 0.25);
      for (let i = 0; i < count; i++) {
        const t = i / SFX_RATE;
        pcm[from + i] += Math.sin(TAU * frequency * t + p) * amplitude
          * Math.min(1, t / attack) * Math.exp(-t * loss)
          * Math.min(1, (length - t) / 0.018);
      }
    }
  };

  const grains = (start: number, span: number, count: number, strength: number, low: number, high: number) => {
    for (let k = 0; k < count; k++) {
      const at = start + span * random();
      noise(at, range(0.003, 0.023), strength * range(0.25, 1), low, high,
        0.0004, range(1.3, 3));
    }
  };

  const woodImpact = (at: number, strength: number, body = 110) => {
    noise(at, 0.032, 0.24 * strength, 180, 3700);
    modes(at, 0.3, body * voicePitch, 0.14 * strength, [1, 1.58, 2.31, 3.47], 18);
    noise(at + 0.014, 0.11, 0.13 * strength, 35, 460, 0.003, 3);
  };

  const crunch = (at: number, strength: number, spread = 0.17) => {
    noise(at, spread + 0.09, 0.13 * strength, 160, 3300, 0.008, 2.2, 43);
    grains(at, spread, 34, 0.14 * strength, 700, 7200);
    noise(at + 0.015, 0.12, 0.24 * strength, 25, 380, 0.009, 2.5);
  };

  const creak = (at: number, length: number, strength: number) => {
    // Stick-slip excitation and non-periodic pitch bends keep this from being
    // a clean oscillator sweep. All grains remain inside the one PCM event.
    const count = Math.floor(length * 75);
    for (let i = 0; i < count; i++) {
      const u = i / count;
      const pulse = Math.sin(Math.PI * u) * range(0.3, 1);
      noise(at + u * length, range(0.005, 0.018), strength * pulse * 0.26, 150, 2700, 0.0005, 2);
      if (i % 3 === 0) modes(at + u * length, 0.035, range(190, 340), strength * pulse * 0.045, [1, 2.73], 65);
    }
  };

  const liquid = (at: number, length: number, strength: number, bubbles: number) => {
    noise(at, length, strength * 0.16, 90, 3500, 0.016, 1.8, 17);
    for (let i = 0; i < bubbles; i++) {
      const pos = at + random() * length * 0.86;
      const f = range(240, 1250);
      modes(pos, 0.028 + random() * 0.035, f, strength * range(0.015, 0.048), [1, 1.79], 68, 0.001);
    }
  };

  switch (name) {
    case 'step_snow':
      crunch(0.002, range(0.8, 1.05));
      noise(0.14, 0.23, 0.12, 400, 4500, 0.012, 2.3, 32);
      grains(0.18, 0.14, 12, 0.065, 800, 5600);
      break;
    case 'step_wood':
      woodImpact(0.002, range(0.8, 1.05), range(95, 135));
      noise(0.055, 0.12, 0.075, 500, 2500, 0.008, 2.5, 33);
      if (variant % 4 === 2) creak(0.07, 0.2, 0.42);
      break;
    case 'step_ice':
      // A sole on intact ice: compact impact and brief friction. No fissure or
      // breaking sounds here; those remain explicit ice_break gameplay events.
      modes(0.002, 0.19, range(150, 195), 0.105, [1, 2.13, 3.87], 31);
      noise(0.001, 0.024, 0.29, 850, 6900, 0.001, 2.4);
      noise(0.043, 0.19, 0.095, 1300, 5800, 0.009, 2.2, 67);
      noise(0.008, 0.09, 0.13, 35, 390);
      break;
    case 'step_stone':
      modes(0.002, 0.16, range(160, 220), 0.09, [1, 1.83, 3.07, 4.9], 35);
      noise(0.002, 0.044, 0.29, 340, 4600, 0.001, 3);
      grains(0.035, 0.07, 9, 0.045, 1700, 6800);
      break;
    case 'chop':
      woodImpact(0.001, 2.1, range(100, 150));
      grains(0.013, 0.16, 18, 0.18, 1100, 7200);
      modes(0.014, 0.36, range(460, 600), 0.055, [1, 2.59, 4.31], 19);
      break;
    case 'thud':
      noise(0.001, 0.21, 0.68, 25, 680, 0.002, 3.2);
      modes(0.003, 0.34, range(55, 78), 0.19, [1, 1.62, 2.74], 19);
      noise(0.023, 0.15, 0.11, 500, 3000, 0.004, 3);
      break;
    case 'hammer':
      noise(0.001, 0.027, 0.48, 600, 7200, 0.0005, 3.4);
      modes(0.001, 0.28, range(600, 850), 0.15, [1, 2.41, 4.27, 6.1], 24);
      modes(0.004, 0.25, range(130, 180), 0.14, [1, 1.63, 2.92], 19);
      break;
    case 'glass':
      noise(0.001, 0.05, 0.5, 1500, 8500, 0.0007, 2.8);
      for (let i = 0; i < 27; i++) {
        const at = 0.014 + Math.pow(random(), 1.5) * 0.82;
        modes(at, range(0.06, 0.22), range(1400, 4500), range(0.025, 0.1) * (1 - at * 0.65), [1, 1.43], 27);
        noise(at, 0.012, 0.08 * (1 - at * 0.6), 1800, 8200, 0.0003, 3);
      }
      break;
    case 'crack':
      noise(0.001, 0.04, 0.56, 750, 8100, 0.0005, 3.2);
      woodImpact(0.006, 0.9, range(155, 225));
      grains(0.026, 0.23, 16, 0.13, 900, 5900);
      break;
    case 'ice_break':
      noise(0.002, 0.09, 0.63, 450, 8000, 0.001, 3.3);
      modes(0.002, 1.1, range(58, 78), 0.21, [1, 1.51, 2.37, 4.03], 5);
      for (let i = 0; i < 18; i++) {
        const at = range(0.025, 0.88);
        noise(at, range(0.018, 0.07), 0.29 * (1 - at * 0.6), 700, 6500, 0.001, 3);
      }
      liquid(0.25, 1.25, 0.8, 32);
      break;
    case 'match_fail':
      noise(0.001, 0.16, 0.27, 1100, 7200, 0.007, 1.5, 85);
      grains(0.018, 0.1, 11, 0.07, 2200, 7800);
      break;
    case 'match':
      noise(0.001, 0.13, 0.29, 1100, 7500, 0.006, 1.5, 82);
      grains(0.01, 0.09, 12, 0.075, 1700, 7700);
      noise(0.08, 0.35, 0.21, 100, 5300, 0.015, 2.4);
      break;
    case 'fire_ignite':
      noise(0.003, 0.84, 0.4, 70, 4200, 0.095, 1.7, 12);
      grains(0.08, 0.72, 43, 0.18, 750, 6500);
      noise(0.06, 0.6, 0.27, 25, 320, 0.08, 2.4);
      break;
    case 'plink':
      modes(0.001, 0.25, range(1350, 1750), 0.12, [1, 2.37, 4.11], 27);
      noise(0.001, 0.016, 0.1, 1300, 6800);
      break;
    case 'splash':
      liquid(0.002, 0.74, 1.75, 42);
      noise(0.001, 0.13, 0.48, 80, 3800, 0.003, 2.7);
      break;
    case 'knock':
      for (let i = 0; i < 3; i++) woodImpact(0.002 + i * 0.36 + range(0, 0.014), range(1.05, 1.5), range(115, 150));
      break;
    case 'howl': {
      // A breath-driven harmonic source under moving formants. Rough amplitude
      // and pitch fluctuations avoid the old single clean siren oscillator.
      const base = range(200, 240), wobble = range(4.3, 5.8);
      const phases = [0, 0, 0, 0, 0, 0];
      let breath = 0;
      for (let i = 0; i < pcm.length; i++) {
        const t = i / SFX_RATE, u = t / durations.howl;
        const contour = 0.78 + 0.42 * Math.sin(Math.PI * Math.min(1, u * 1.2)) - 0.14 * u;
        const fundamental = base * contour * (1 + 0.012 * Math.sin(TAU * wobble * t) + 0.004 * Math.sin(TAU * 31.7 * t));
        const env = Math.pow(Math.sin(Math.PI * u), 1.45) * Math.min(1, t / 0.22);
        breath += 0.4 * (random() * 2 - 1 - breath);
        let voiced = 0;
        for (let h = 1; h <= phases.length; h++) {
          phases[h - 1] += TAU * fundamental * h / SFX_RATE;
          const f = fundamental * h;
          const formant = Math.exp(-(((f - 530) / 270) ** 2)) + 0.45 * Math.exp(-(((f - 1300) / 460) ** 2));
          voiced += Math.sin(phases[h - 1]) * (0.17 + formant) / (h * 5);
        }
        pcm[i] += (voiced * 0.5 + breath * 0.045) * env * (0.91 + 0.09 * Math.sin(TAU * 19 * t));
      }
      break;
    }
    case 'whisper':
      for (let i = 0; i < 5; i++) {
        const at = 0.002 + i * 0.235 + range(0, 0.055);
        noise(at, range(0.16, 0.3), 0.16, 500, 3600, 0.025, 2, range(14, 29));
        noise(at + 0.025, 0.17, 0.055, 1900, 5700, 0.015, 2);
      }
      break;
    case 'swing':
      noise(0.001, 0.24, 0.22, 220, 3400, 0.055, 1.7);
      break;
    case 'saw':
      noise(0.001, 0.38, 0.3, 500, 6800, 0.025, 1.25, range(70, 95));
      grains(0.02, 0.32, 32, 0.08, 1600, 7600);
      modes(0.004, 0.36, range(145, 190), 0.035, [1, 2.17, 3.61], 12);
      break;
    case 'pickup':
      noise(0.001, 0.13, 0.18, 200, 2600, 0.008, 2.3);
      noise(0.052, 0.09, 0.085, 600, 4300, 0.003, 2.7);
      break;
    case 'drop':
      woodImpact(0.002, 0.95, range(135, 200));
      noise(0.09, 0.14, 0.12, 300, 3900, 0.003, 2.8);
      break;
    case 'tree_fall':
      creak(0.002, 1.05, 1.1);
      for (let i = 0; i < 11; i++) {
        const at = 0.25 + Math.pow(random(), 0.7) * 1.12;
        noise(at, range(0.02, 0.08), range(0.16, 0.36), 400, 6200, 0.001, 3);
      }
      noise(0.78, 1.6, 0.36, 240, 3300, 0.23, 1.5, 8);
      noise(1.38, 0.85, 0.7, 25, 670, 0.008, 2.7);
      modes(1.39, 1.05, range(43, 60), 0.2, [1, 1.69, 2.43], 5);
      grains(1.44, 0.95, 55, 0.14, 700, 6500);
      break;
    case 'creak':
      creak(0.002, range(0.62, 0.76), 1.45);
      noise(0.01, 0.5, 0.08, 80, 800, 0.03, 2.1, 18);
      break;
    case 'tear':
      noise(0.001, 0.4, 0.23, 750, 5400, 0.015, 1.5, range(35, 60));
      grains(0.015, 0.35, 35, 0.12, 1400, 7500);
      break;
    case 'eat':
      for (let i = 0; i < 3; i++) {
        const at = 0.003 + i * 0.19 + range(0, 0.02);
        crunch(at, 0.37, 0.055);
        liquid(at + 0.015, 0.1, 0.36, 4);
      }
      break;
    case 'drink':
      for (let i = 0; i < 3; i++) liquid(0.003 + i * 0.27, 0.23, range(0.65, 0.9), 9);
      noise(0.76, 0.18, 0.085, 180, 1600, 0.02, 2);
      break;
    case 'click':
      noise(0.001, 0.012, 0.19, 650, 6100, 0.0005, 3);
      modes(0.001, 0.04, range(700, 1000), 0.045, [1, 2.53], 95, 0.0005);
      break;
    case 'snow_scoop':
      crunch(0.002, 1, 0.29);
      noise(0.09, 0.3, 0.15, 150, 2900, 0.025, 1.5, 24);
      break;
  }

  // A DC blocker followed by two gentle low-pass stages gives every bank a
  // shared modest bandwidth. Saturation is very light; there is no hard 8-bit
  // gate or persistent hiss to mask low-level threats. Fade *after* processing
  // so the filter's residual state cannot leave a clicking buffer boundary.
  const lp = 1 - Math.exp(-TAU * 8500 / SFX_RATE);
  const hp = Math.exp(-TAU * 28 / SFX_RATE);
  let previous = 0, dc = 0, a = 0, b = 0, peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const x = pcm[i];
    dc = x - previous + hp * dc; previous = x;
    a += lp * (dc - a); b += lp * (a - b);
    const edge = Math.min(1, i / 18, (pcm.length - 1 - i) / 240);
    const y = Math.tanh(b * 1.12) / 1.12 * edge;
    pcm[i] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  // Only overload protection: quiet handling, UI, footsteps and impacts keep
  // their different levels instead of normalizing every event to full scale.
  if (peak > 0.78) for (let i = 0; i < pcm.length; i++) pcm[i] *= 0.78 / peak;
  return pcm;
}
