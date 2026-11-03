// Tileable value-noise texture with four independent channels, used by the terrain,
// ice and water shaders for variation without visible repetition.
import * as THREE from 'three';
import { mulberry32 } from './rng';

function lattice(period: number, rand: () => number) {
  const v = new Float32Array(period * period);
  for (let i = 0; i < v.length; i++) v[i] = rand();
  return v;
}

function sample(L: Float32Array, p: number, x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
  const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
  const a = L[y0 * p + x0], b = L[y0 * p + x1], c = L[y1 * p + x0], d = L[y1 * p + x1];
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

let cached: THREE.DataTexture | null = null;

export function noiseTexture(size = 256): THREE.DataTexture {
  if (cached) return cached;
  const rand = mulberry32(1234567);
  const data = new Uint8Array(size * size * 4);
  // per channel: base period and octaves
  const cfg = [
    [4, 4],
    [8, 4],
    [32, 3],
    [16, 3],
  ];
  for (let ch = 0; ch < 4; ch++) {
    const [p0, oct] = cfg[ch];
    const lats: { L: Float32Array; p: number; amp: number }[] = [];
    let amp = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      const p = p0 << o;
      lats.push({ L: lattice(p, rand), p, amp });
      norm += amp;
      amp *= 0.5;
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let s = 0;
      for (const l of lats) s += sample(l.L, l.p, (x / size) * l.p, (y / size) * l.p) * l.amp;
      s /= norm;
      // stretch the contrast a little
      s = Math.min(1, Math.max(0, (s - 0.5) * 1.6 + 0.5));
      data[(y * size + x) * 4 + ch] = Math.round(s * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  cached = t;
  return t;
}
