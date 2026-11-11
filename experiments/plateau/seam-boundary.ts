import { contourPoint, contourTangent, SLOPE_START } from './plateau-profile';
import { type Point, type Plane, value } from './cavity';

const TAU = Math.PI * 2;
export interface SourceGrid { heights: Float32Array; n: number; cell: number; x0: number; z0: number }
export interface Boundary { points: Point[]; angles: number[]; radius: number; sourceTriangles: number[] }
export interface CutVolume { kind: 'ascent' | 'cave'; planes: readonly Plane[] }
export interface BoundaryPart { a: Point; b: Point; kind: 'surface' | 'ascent' | 'cave'; segment: number }

// Exactly the same diagonals as main.ts: (a,c,b), (b,c,d).
export function sampleGrid(grid: SourceGrid, x: number, z: number) {
  const u = (x - grid.x0) / grid.cell, v = (z - grid.z0) / grid.cell;
  if (u < 0 || v < 0 || u >= grid.n || v >= grid.n) throw Error('Seam outside source grid');
  const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, n = grid.n + 1;
  const k = j * n + i, h = grid.heights;
  return a + b <= 1
    ? { y: h[k] + (h[k + 1] - h[k]) * a + (h[k + n] - h[k]) * b, triangle: 2 * (j * grid.n + i) }
    : { y: h[k + n + 1] + (h[k + n] - h[k + n + 1]) * (1 - a) + (h[k + 1] - h[k + n + 1]) * (1 - b), triangle: 2 * (j * grid.n + i) + 1 };
}

function bisect(fn: (a: number) => number, a: number, b: number) {
  let fa = fn(a);
  if (Math.abs(fa) < 1e-12) return a;
  if (Math.abs(fn(b)) < 1e-12) return b;
  for (let k = 0; k < 55; k++) {
    const m = (a + b) / 2, fm = fn(m);
    if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}
function uniqueAngles(values: number[]) {
  const sorted = values.map(a => ((a % TAU) + TAU) % TAU).sort((a, b) => a - b);
  const result = sorted.filter((a, i) => i === 0 || a - sorted[i - 1] > 1e-10);
  if (result.length > 1 && result[0] + TAU - result[result.length - 1] < 1e-10) result.pop();
  return result;
}

// For this fixed, low-frequency outline, locate coordinate extrema first.
// Each monotone span can then cross any grid line at most once. This also
// captures grazing intersections that endpoint tests on short chords miss.
function extrema(fn: (a: number) => number) {
  const result = [0, TAU], steps = 2048;
  for (let i = 0; i < steps; i++) {
    const a = i * TAU / steps, b = (i + 1) * TAU / steps, fa = fn(a), fb = fn(b);
    if (Math.abs(fa) < 1e-10) result.push(a);
    if ((fa < 0) !== (fb < 0)) result.push(bisect(fn, a, b));
  }
  return [...uniqueAngles(result), TAU].sort((a, b) => a - b);
}

export function buildBoundary(grid: SourceGrid, radius = SLOPE_START): Boundary {
  const angles: number[] = [];
  const axes = [
    { coordinate: (p: { x: number; z: number }) => p.x, offset: grid.x0 },
    { coordinate: (p: { x: number; z: number }) => p.z, offset: grid.z0 },
    { coordinate: (p: { x: number; z: number }) => p.x + p.z, offset: grid.x0 + grid.z0 },
  ];
  for (const axis of axes) {
    const coordinate = (a: number) => axis.coordinate(contourPoint(a, radius));
    const spans = extrema(a => axis.coordinate(contourTangent(a, radius)));
    for (let i = 1; i < spans.length; i++) {
      const a = spans[i - 1], b = spans[i], lo = Math.min(coordinate(a), coordinate(b)), hi = Math.max(coordinate(a), coordinate(b));
      for (let k = Math.ceil((lo - axis.offset) / grid.cell); k <= Math.floor((hi - axis.offset) / grid.cell); k++) {
        const line = axis.offset + k * grid.cell;
        angles.push(bisect(t => coordinate(t) - line, a, b));
      }
    }
  }
  const ordered = uniqueAngles(angles);
  if (ordered.length < 3) throw Error('Seam has no closed contour');
  // One canonical Float32 coordinate per joint. Future render boundaries and
  // mask strips must copy these values, rather than calculate their own edge.
  const points = ordered.map(a => {
    const p = contourPoint(a, radius), x = Math.fround(p.x), z = Math.fround(p.z);
    return { x, y: Math.fround(sampleGrid(grid, x, z).y), z };
  });
  const sourceTriangles = points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    return sampleGrid(grid, (a.x + b.x) / 2, (a.z + b.z) / 2).triangle;
  });
  return { points, angles: ordered, sourceTriangles, radius };
}

export function interpolate(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
function cutInterval(a: Point, b: Point, planes: readonly Plane[]) {
  let lo = 0, hi = 1;
  for (const plane of planes) {
    const va = value(plane, a), vb = value(plane, b), delta = vb - va;
    if (Math.abs(delta) < 1e-12) { if (va > 2e-6) return; continue; }
    const t = -va / delta;
    if (delta > 0) hi = Math.min(hi, t); else lo = Math.max(lo, t);
    if (hi <= lo) return;
  }
  if (hi > lo) return { lo, hi };
}
export function splitBoundary(boundary: Boundary, volumes: CutVolume[]): BoundaryPart[] {
  const parts: BoundaryPart[] = [];
  boundary.points.forEach((a, segment) => {
    const b = boundary.points[(segment + 1) % boundary.points.length];
    const cuts = volumes.flatMap(volume => {
      const interval = cutInterval(a, b, volume.planes);
      return interval ? [{ ...interval, kind: volume.kind }] : [];
    });
    const stops = [...new Set([0, 1, ...cuts.flatMap(c => [c.lo, c.hi])])].sort((a, b) => a - b);
    for (let i = 1; i < stops.length; i++) {
      const lo = stops[i - 1], hi = stops[i];
      if (hi - lo < 1e-10) continue;
      const mid = (lo + hi) / 2, kind = cuts.find(c => mid >= c.lo && mid <= c.hi)?.kind ?? 'surface';
      parts.push({ a: interpolate(a, b, lo), b: interpolate(a, b, hi), kind, segment });
    }
  });
  return parts;
}
