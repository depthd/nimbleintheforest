// Local rim shaping after the accepted shell is built. Shared positions use
// one map; no independent decorative edge or open gaps are added.
import { Rng, smoothstep } from '../../src/core/rng';
import { type Point, type MeshData, append, plane, clip, flip } from './cavity';
import { plateauRadius } from './plateau-profile';
import { type buildWedgeAscent } from './wedge-ascent';
export type RimKind = 'angular' | 'stepped' | 'arcs';
export const rimSettings = { seed: 128719, minLength: 22, maxLength: 38, minDepth: 5, maxDepth: 9, minPeakDepth: .2, maxPeakDepth: 1.2, minPeakFraction: .35, maxPeakFraction: .65, arcSegments: 16, stepWidth: .18, minStep: 2, maxStep: 4 };
const TAU = 2 * Math.PI;
const angle = (p: Point) => (Math.atan2(p.z / 180, p.x / 260) + TAU) % TAU;
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
function search(values: number[], value: number) {
  let lo = 0, hi = values.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (values[mid] <= value) lo = mid; else hi = mid; }
  return lo;
}
export function buildRimVariant(junction: ReturnType<typeof buildWedgeAscent>, mode: RimKind, options = rimSettings) {
  const nose = junction.nose, ring = [...nose, nose[0]];
  const angles = nose.map(angle); // nose is already ordered around the mountain
  const unwrappedAngles = [...angles, angles[0] + TAU];
  const stations = [0];
  for (let i = 1; i < ring.length; i++) stations.push(stations[i - 1] + Math.hypot(ring[i].x - ring[i - 1].x, ring[i].z - ring[i - 1].z));
  const total = stations[stations.length - 1];
  function at(s: number) {
    if (s >= total) return nose[0];
    const i = search(stations, Math.max(0, s));
    return mix(ring[i], ring[i + 1], (s - stations[i]) / (stations[i + 1] - stations[i]));
  }
  function reference(p: Point) {
    const a = angle(p), unwrapped = a < angles[0] ? a + TAU : a;
    const i = search(unwrappedAngles, unwrapped), q = ring[i], b = ring[i + 1];
    // Ray/segment intersection, not interpolation of angles on a curved rim.
    const cross = (x: number, z: number) => x * p.z - z * p.x;
    const t = Math.max(0, Math.min(1, -cross(q.x, q.z) / cross(b.x - q.x, b.z - q.z)));
    return { a, s: stations[i] + t * (stations[i + 1] - stations[i]), point: mix(q, b, t) };
  }
  const rng = new Rng(options.seed), count = Math.round(total / ((options.minLength + options.maxLength) / 2));
  const lengths = Array.from({ length: count }, () => rng.float(options.minLength, options.maxLength)), sum = lengths.reduce((a, b) => a + b);
  const bounds = [0]; for (const length of lengths) bounds.push(bounds[bounds.length - 1] + length / sum * total); bounds[count] = total;
  const valleys = Array.from({ length: count }, () => rng.float(options.minDepth, options.maxDepth)); valleys.push(valleys[0]);
  const pieces = Array.from({ length: count }, (_, i) => ({ start: bounds[i], end: bounds[i + 1], peak: rng.float(options.minPeakFraction, options.maxPeakFraction), peakDepth: rng.float(options.minPeakDepth, options.maxPeakDepth), step: (rng.next() < .5 ? -1 : 1) * rng.float(options.minStep, options.maxStep) }));
  const knots: { s: number; p: Point }[] = [];
  const cutPoint = (s: number, depth: number) => { const p = at(s); return { ...p, y: p.y - depth }; };
  for (let i = 0; i < count; i++) {
    const cell = pieces[i], start = cutPoint(cell.start, valleys[i]), end = cutPoint(cell.end, valleys[i + 1]);
    knots.push({ s: cell.start, p: start });
    if (mode === 'arcs') {
      const amplitude = (valleys[i] + valleys[i + 1]) / 2 - cell.peakDepth;
      for (let k = 1; k < options.arcSegments; k++) { const u = k / options.arcSegments; const p = mix(start, end, u); p.y += 4 * amplitude * u * (1 - u); knots.push({ s: cell.start + (cell.end - cell.start) * u, p }); }
    } else {
      const endS = cell.end - (mode === 'stepped' ? options.stepWidth : 0);
      const peakS = cell.start + (endS - cell.start) * cell.peak;
      const peakDepth = mode === 'stepped' ? Math.min(cell.peakDepth, valleys[i] - .5, valleys[i + 1] + cell.step - .5) : cell.peakDepth;
      knots.push({ s: peakS, p: cutPoint(peakS, peakDepth) });
      if (mode === 'stepped') knots.push({ s: endS, p: cutPoint(endS, valleys[i + 1] + cell.step) });
    }
  }
  knots.push({ s: total, p: knots[0].p });
  const knotS = knots.map(k => k.s);
  const target = (s: number) => { const i = search(knotS, s); return mix(knots[i].p, knots[i + 1].p, (s - knots[i].s) / (knots[i + 1].s - knots[i].s)); };
  const cache = new Map<string, Point>();
  function deform(raw: Point): Point {
    const p = { x: Math.fround(raw.x), y: Math.fround(raw.y), z: Math.fround(raw.z) }, key = [p.x, p.y, p.z].join(',');
    const cached = cache.get(key); if (cached) return cached;
    const r = plateauRadius(p.x, p.z);
    if (p.y <= 65 || r <= 1.005 || r > 1.12) return p;
    const ref = reference(p), fade = smoothstep(.4, 1, junction.weight(ref.a));
    const weight = fade * smoothstep(1.005, 1.08, r) * smoothstep(65, 95, p.y);
    if (!weight) return p;
    const q = target(ref.s), result = { x: Math.fround(p.x + weight * (q.x - ref.point.x)), y: Math.fround(p.y + weight * (q.y - ref.point.y)), z: Math.fround(p.z + weight * (q.z - ref.point.z)) };
    cache.set(key, result); return result;
  }
  // Insert every peak, cusp and step end into the actual triangles. Merely
  // moving the old grid vertices would round or miss the intended corners.
  const planes = knots.slice(0, -1).map(k => { const p = at(k.s); return { a: angle(p), pl: plane(-p.z, 0, p.x, 0) }; });
  function warp(mesh: MeshData): MeshData {
    const positions = Array.from(mesh.positions), indices: number[] = []; let changed = false;
    for (let k = 0; k < mesh.indices.length; k += 3) {
      const ids = Array.from(mesh.indices.subarray(k, k + 3)), tri = ids.map(id => ({ x: mesh.positions[id * 3], y: mesh.positions[id * 3 + 1], z: mesh.positions[id * 3 + 2] }));
      if (tri.every(p => p.y <= 65) || tri.every(p => plateauRadius(p.x, p.z) <= 1.005) || tri.every(p => plateauRadius(p.x, p.z) > 1.12)) { indices.push(...ids); continue; }
      if (tri.every(p => { const q = deform(p); return q.x === p.x && q.y === p.y && q.z === p.z; })) { indices.push(...ids); continue; }
      const ta = tri.map(angle); if (Math.max(...ta) - Math.min(...ta) > Math.PI) for (let i = 0; i < ta.length; i++) if (ta[i] < Math.PI) ta[i] += TAU;
      const lo = Math.min(...ta), hi = Math.max(...ta);
      let parts = [tri];
      for (const { a, pl } of planes) {
        const unwrapped = a < lo ? a + TAU : a;
        if (unwrapped <= lo + 1e-10 || unwrapped >= hi - 1e-10) continue;
        const next: Point[][] = [];
        for (const part of parts) for (const p of [clip(part, pl), clip(part, flip(pl))]) if (p.length >= 3) next.push(p);
        parts = next;
      }
      for (const part of parts) append(part.map(deform), positions, indices);
      changed = true;
    }
    return changed ? { positions: new Float32Array(positions), indices: new Uint32Array(indices) } : mesh;
  }
  const cut = Object.fromEntries(Object.entries(junction.cut).map(([name, mesh]) => [name, name === 'plateau' || name === 'interior' ? mesh : warp(mesh)])) as typeof junction.cut;
  return { cut, mode, options, knots, pieces, total, deform, reference, target };
}
