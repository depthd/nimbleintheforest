// The cliff laboratory (?cliffs=1): a plateau raised near the house in the real generated
// world, its front dressed with one big cliff (caprock overhang and a walk-in undercut),
// plus a free-standing pillar and a low tor in the valley in front of it.
// Ordinary play does not call this: the world there is unchanged.
import { Simplex2, clamp, lerp, smoothstep, Rng } from '../core/rng';
import { CliffBuild } from './cliffs';
import type { CliffSpec } from './cliffs';
import { B as Biome } from './biomes';

interface Sheet {
  h: Float32Array; n: number; ox: number; oz: number; cell: number; seed: number;
  heightAt(x: number, z: number): number;
  waterAt(x: number, z: number): number;
  biomeAt(x: number, z: number): number;
  inside(x: number, z: number, margin?: number): boolean;
  sites: { tower: { x: number; z: number } | null };
}

export interface CliffLabInfo {
  centre: { x: number; z: number };
  /** unit vector from the plateau towards the house */
  front: { x: number; z: number };
  plateau: number;
  main: number; pillar: number; tor: number;
  /** diagnostics: the plateau ground before the cliffs */
  mesaAt?: (x: number, z: number, old: number) => { h: number; inside: boolean };
}

const HEIGHT = 24; // plateau above the surrounding ground
// plateau half-extents across and along the view from the house; not too elongated, so the
// rim never bends tighter than the rock behind the face is deep
const A = 75, B = 40;
const TALUS_K = Math.tan((30 * Math.PI) / 180), BACK_K = Math.tan((16 * Math.PI) / 180); // flank and back slopes
const W_BACK = 90; // how far the back slope can reach
const ARC = 1.2; // half-angle of the cliff arc, radians
// The face fades out along the arc no faster than a talus slope can rise (about 30°),
// otherwise the ground beside a shrinking face would be a steep sheet again.
const TAPER_LEN = 56;
const DEAD_LEN = 6; // the last metres of the arc carry no face at all
const soft = (t: number) => 0.5 * (t + t * t * (3 - 2 * t)); // linear with eased ends, slope ≤ 1.25

function bilinear(H: Float32Array, n: number, ox: number, oz: number, cell: number, x: number, z: number) {
  const fx = clamp((x + ox) / cell, 0, n - 1e-4), fz = clamp((z + oz) / cell, 0, n - 1e-4);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, nf = n + 1, k = j * nf + i;
  return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + nf] * (1 - u) + H[k + nf + 1] * u) * v;
}

/** A dry, fairly flat spot in living forest, not far from the house, away from the tower. */
function pickSite(R: Sheet) {
  let best: { x: number; z: number; score: number } | null = null;
  const forestShare = (x: number, z: number, radius: number) => {
    let forest = 0, cells = 0;
    for (let dz = -radius; dz <= radius; dz += 10) for (let dx = -radius; dx <= radius; dx += 10) {
      if (dx * dx + dz * dz > radius * radius) continue;
      const b = R.biomeAt(x + dx, z + dz);
      forest += b === Biome.Taiga || b === Biome.Pine ? 1 : 0; cells++;
    }
    return forest / Math.max(1, cells);
  };
  for (const dist of [165, 205, 245, 285]) {
    for (let a = 0; a < 72; a++) {
      const ang = (a / 72) * Math.PI * 2;
      const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
      if (!R.inside(x, z, 260)) continue;
      const t = R.sites.tower;
      if (t && Math.hypot(t.x - x, t.z - z) < 170) continue;
      let wet = false, lo = Infinity, hi = -Infinity;
      for (let dz = -150; dz <= 150 && !wet; dz += 8) for (let dx = -150; dx <= 150; dx += 8) {
        if (dx * dx + dz * dz > 150 * 150) continue;
        if (!Number.isNaN(R.waterAt(x + dx, z + dz))) { wet = true; break; }
        const h = R.heightAt(x + dx, z + dz);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      if (wet) continue;
      // the valley in front of the cliff, where one stands to look at it, matters most
      const fx = -x / dist, fz = -z / dist;
      const front = forestShare(x + fx * (B + 45), z + fz * (B + 45), 60), all = forestShare(x, z, 130);
      const score = (hi - lo) * 0.5 + dist * 0.03 + 60 * (1 - front) + 25 * (1 - all);
      if (!best || score < best.score) best = { x, z, score };
    }
  }
  return best ?? { x: 160, z: 0, score: 0 };
}

export function buildCliffLab(R: Sheet): { builds: CliffBuild[]; info: CliffLabInfo } {
  const site = pickSite(R);
  const C = { x: site.x, z: site.z };
  const L = Math.hypot(C.x, C.z) || 1;
  const f = { x: -C.x / L, z: -C.z / L }; // towards the house
  const r = { x: f.z, z: -f.x };
  const rng = new Rng(R.seed * 613 + 29);
  const noise = new Simplex2(() => rng.next());
  const orig = R.h.slice();
  const lower = (x: number, z: number) => bilinear(orig, R.n, R.ox, R.oz, R.cell, x, z);
  // a flat plateau a fixed height above the mean ground of the footprint
  let mean = 0, k = 0;
  for (let w = -B; w <= B; w += 4) for (let u = -A; u <= A; u += 4) { mean += lower(C.x + r.x * u + f.x * w, C.z + r.z * u + f.z * w); k++; }
  const P = mean / k + HEIGHT;
  const upper = (x: number, z: number) => P + 0.35 * noise.noise(x / 23, z / 23);

  // outline: a rounded plateau, slightly irregular
  const N = 144;
  const outline: { x: number; z: number; th: number }[] = [];
  for (let q = 0; q < N; q++) {
    const th = (q / N) * Math.PI * 2;
    // broad irregularity only: tight wiggles in plan would fold the rock behind the face
    const kk = 1 + 0.09 * noise.noise(Math.cos(th) * 1.3 + 4, Math.sin(th) * 1.3) + 0.012 * noise.noise(Math.cos(th) * 4 - 2, Math.sin(th) * 4);
    const u = A * Math.cos(th) * kk, w = B * Math.sin(th) * kk;
    outline.push({ x: C.x + r.x * u + f.x * w, z: C.z + r.z * u + f.z * w, th });
  }
  // the cliff arc faces the house (th = π/2); its exposure fades by arc length towards its ends
  const arcIdx = outline.map((o, q) => (Math.abs(o.th - Math.PI / 2) <= ARC + 1e-6 ? q : -1)).filter((q) => q >= 0);
  const sArc: number[] = [0];
  for (let q = 1; q < arcIdx.length; q++) { const a = outline[arcIdx[q - 1]], b = outline[arcIdx[q]]; sArc.push(sArc[q - 1] + Math.hypot(b.x - a.x, b.z - a.z)); }
  const Larc = sArc[sArc.length - 1];
  const ramp = (x: number) => soft(clamp((x - DEAD_LEN) / TAPER_LEN, 0, 1));
  const eOf = new Float32Array(N);
  arcIdx.forEach((q, k) => { eOf[q] = ramp(sArc[k]) * ramp(Larc - sArc[k]); });
  // how far below the rim the foot of the face lies, per outline point (0 off the arc)
  const talusH = 2.6;
  const drop = new Float32Array(N);
  arcIdx.forEach((q) => { const o = outline[q]; drop[q] = Math.max(0.3, (P - (lower(o.x, o.z) + talusH)) * eOf[q]); });

  // ---- the plateau stamp ----
  const nf = R.n + 1, ext = A + W_BACK + 10;
  const i0 = clamp(Math.floor((C.x - ext + R.ox) / R.cell), 0, R.n), i1 = clamp(Math.ceil((C.x + ext + R.ox) / R.cell), 0, R.n);
  const j0 = clamp(Math.floor((C.z - ext + R.oz) / R.cell), 0, R.n), j1 = clamp(Math.ceil((C.z + ext + R.oz) / R.cell), 0, R.n);
  // rim height and flank steepness per outline point: talus at the flanks, gentler at the back
  const rim = outline.map((o, q) => upper(o.x, o.z) - drop[q]);
  const steep = outline.map((o) => lerp(TALUS_K, BACK_K, smoothstep(0.1, 0.6, -Math.sin(o.th))));
  const onArc = new Uint8Array(N);
  for (const q of arcIdx) onArc[q] = 1;
  // outward normal of each stretch of rim (from point q to q+1)
  const outward = outline.map((a, q) => {
    const b = outline[(q + 1) % N];
    let nx = b.z - a.z, nz = -(b.x - a.x);
    const L = Math.hypot(nx, nz) || 1;
    nx /= L; nz /= L;
    if (nx * ((a.x + b.x) / 2 - C.x) + nz * ((a.z + b.z) / 2 - C.z) < 0) { nx = -nx; nz = -nz; }
    return { x: nx, z: nz };
  });
  /** The plateau's ground at a point, before the cliffs dress it. */
  const mesaAt = (x: number, z: number, old: number) => {
    let inside = false;
    for (let q = 0, p = N - 1; q < N; p = q++) {
      const a = outline[p], b = outline[q];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    // On the cliff arc the step sits a little inside the outline, so no ground in front of the
    // (smoothed) foot line can stay at plateau height; the cliff covers everything behind it.
    let nearDrop = 0, nearDist = Infinity;
    if (inside) for (let q = 0, p = N - 1; q < N; p = q++) {
      const a = outline[p], b = outline[q];
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
      const dist = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
      if (dist < nearDist) { nearDist = dist; nearDrop = lerp(drop[p], drop[q], t); }
    }
    if (inside && !(nearDrop > 0.5 && nearDist < 1.6)) return { h: Math.max(old, upper(x, z)), inside };
    // Outside the rim the ground is talus, never below the old ground: the envelope of slopes
    // falling from every stretch of the rim, so it stays continuous around corners and bays.
    // On the cliff arc the talus starts from the foot of the face instead (a sheer step the
    // cliff then dresses), exactly like the cliff's own apron. Elsewhere a short rounding keeps
    // the rim from being a crease.
    let h = -Infinity;
    for (let q = 0, p = N - 1; q < N; p = q++) {
      const a = outline[p], b = outline[q];
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
      const dist = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
      // the cliff sheds its own talus in front of the arc, from the same foot as its face
      if (onArc[p] || onArc[q]) continue;
      const k = lerp(steep[p], steep[q], t), R0 = 4;
      const fall = dist < R0 ? (k * dist * dist) / (2 * R0) : k * (dist - R0 / 2);
      // a stretch of rim sheds talus outwards only, never across the plateau to the far side
      const behind = Math.max(0, -((x - a.x) * outward[p].x + (z - a.z) * outward[p].z));
      h = Math.max(h, lerp(rim[p], rim[q], t) - fall - behind * 0.35);
    }
    return { h: Math.max(old, h), inside };
  };
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = i * R.cell - R.ox, z = j * R.cell - R.oz, k2 = j * nf + i;
    R.h[k2] = mesaAt(x, z, orig[k2]).h;
  }

  // ---- the big cliff on the front arc ----
  const arc = arcIdx.map((q) => outline[q]);
  const main: CliffSpec = {
    id: 'lab-main', seed: R.seed * 31 + 1, inside: C, overhang: 2.0, taper: 0,
    path: arc.map((o) => ({ x: o.x, z: o.z })),
    top: arc.map(() => P),
    base: arcIdx.map((q) => P - drop[q]),
  };
  const ground = { lower, upper };
  const mainBuild = new CliffBuild(main, ground);
  // the undercut sits in the middle of the arc, facing the house
  const mid = mainBuild.length / 2;
  const withShelter: CliffSpec = { ...main, undercut: { s0: mid - 8, s1: mid + 8, depth: 3.4, height: 2.9 } };
  const big = new CliffBuild(withShelter, ground);

  // ---- a pillar and a tor in the valley ----
  const loop = (cx: number, cz: number, rx: number, rz: number, yaw: number, wobble: number) => {
    const pts: { x: number; z: number }[] = [];
    for (let q = 0; q < 10; q++) {
      const a = (q / 10) * Math.PI * 2;
      const kk = 1 + wobble * noise.noise(Math.cos(a) * 1.7 + cx * 0.01, Math.sin(a) * 1.7);
      const lx = Math.cos(a) * rx * kk, lz = Math.sin(a) * rz * kk;
      pts.push({ x: cx + lx * Math.cos(yaw) - lz * Math.sin(yaw), z: cz + lx * Math.sin(yaw) + lz * Math.cos(yaw) });
    }
    return pts;
  };
  // each later rock stands on the ground as the earlier ones left it (their talus included)
  big.stamp(R.h, R.n, R.ox, R.oz, R.cell);
  const now = { lower: (x: number, z: number) => bilinear(R.h, R.n, R.ox, R.oz, R.cell, x, z), upper };
  const pc = { x: C.x + f.x * (B + 30) - r.x * 22, z: C.z + f.z * (B + 30) - r.z * 22 };
  const pPath = loop(pc.x, pc.z, 5.6, 4.9, rng.float(0, 3), 0.12);
  // a free-standing rock's foot follows the ground around it (talus from the cliff included)
  const pBase = pPath.map((p) => now.lower(p.x, p.z) + 0.6), pTop = Math.max(...pBase) + 16;
  const pillar = new CliffBuild({ id: 'lab-pillar', seed: R.seed * 31 + 2, closed: true, overhang: 1.2, path: pPath,
    top: pPath.map(() => pTop), base: pBase, hard: [1.4, 3.0] }, now);
  pillar.stamp(R.h, R.n, R.ox, R.oz, R.cell);
  const tc = { x: C.x + f.x * (B + 27) + r.x * 30, z: C.z + f.z * (B + 27) + r.z * 30 };
  const tPath = loop(tc.x, tc.z, 11, 5.5, Math.atan2(f.z, f.x) + 0.4, 0.15);
  const tBase = tPath.map((p) => now.lower(p.x, p.z) + 0.4), tTop = Math.max(...tBase) + 5.5;
  const tor = new CliffBuild({ id: 'lab-tor', seed: R.seed * 31 + 3, closed: true, overhang: 0.7, path: tPath,
    top: tPath.map(() => tTop), base: tBase, soft: [0.45, 1.0], hard: [0.9, 1.9] }, now);
  tor.stamp(R.h, R.n, R.ox, R.oz, R.cell);
  const builds = [big, pillar, tor];
  return { builds, info: { centre: C, front: f, plateau: P, main: 0, pillar: 1, tor: 2, mesaAt } };
}
