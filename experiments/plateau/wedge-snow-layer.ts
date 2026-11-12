import { type Point, type MeshData } from './cavity';
import { type Boundary, type SourceGrid, sampleGrid } from './seam-boundary';
import { contourPoint, contourTangent } from './plateau-profile';
import { smoothstep } from '../../src/core/rng';
export interface SnowMesh extends MeshData { normals: Float32Array }
export const snowSettings = { centerAngle: .7, normalRadius: 2, length: 64, inside: 5, plateau: .8, edge: 2.5, overhang: 2, radius: 2, minThickness: .15, slopeStart: 50, slopeEnd: 60, alongStep: .3, capStep: .2, maxStep: .5, embed: .02 };
export type SnowSettings = typeof snowSettings;
const TAU = 2 * Math.PI;
const add = (a: Point, b: Point, t = 1): Point => ({ x: a.x + t * b.x, y: a.y + t * b.y, z: a.z + t * b.z });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const unit = (p: Point): Point => { const l = Math.hypot(p.x, p.y, p.z); return l > 1e-12 ? { x: p.x / l, y: p.y / l, z: p.z / l } : { x: 0, y: 1, z: 0 }; };
const cross = (a: Point, b: Point): Point => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const lerp = (a: Point, b: Point, t: number) => add(a, sub(b, a), t);
const canonical = (p: Point): Point => ({ x: Math.fround(p.x), y: Math.fround(p.y), z: Math.fround(p.z) });
function locate(values: number[], value: number) { let lo = 0, hi = values.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (values[m] <= value) lo = m; else hi = m; } return lo; }
const boundaryAngles = new WeakMap<Boundary, number[]>();
export function ringPoint(boundary: Boundary, a: number): Point {
  let aa = boundaryAngles.get(boundary); if (!aa) { aa = [...boundary.angles, boundary.angles[0] + TAU]; boundaryAngles.set(boundary, aa); }
  const angle = a < aa[0] ? a + TAU : a;
  const i = locate(aa, angle), p = boundary.points[i], q = boundary.points[(i + 1) % boundary.points.length], ray = contourPoint(a, 1);
  const cr = (x: number, z: number) => x * ray.z - z * ray.x;
  const t = Math.max(0, Math.min(1, -cr(p.x, p.z) / cr(q.x - p.x, q.z - p.z)));
  return lerp(p, q, t);
}
// A shared 2 m derivative field avoids folding a normal-offset layer over 4 m rock facets.
// It changes snow placement / optional upper normals only; the stone vertices stay fixed.
export function upperNormal(upper: SourceGrid, x: number, z: number, radius = snowSettings.normalRadius): Point {
  const h = (x: number, z: number) => sampleGrid(upper, x, z).y, d = radius;
  return unit({ x: -(h(x + d, z) - h(x - d, z)) / (2 * d), y: 1, z: -(h(x, z + d) - h(x, z - d)) / (2 * d) });
}
export function snowThickness(v: number, normal: Point, settings = snowSettings) {
  const slope = Math.acos(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI;
  const factor = 1 - smoothstep(settings.slopeStart, settings.slopeEnd, slope);
  if (factor <= 0 || normal.y <= 0) return 0;
  const nominal = settings.plateau + (settings.edge - settings.plateau) * smoothstep(.55, 1, v);
  return Math.max(settings.minThickness, nominal * factor);
}
export function buildSnowLayer(upper: SourceGrid, seam: Boundary, nose: Boundary, rounded: boolean, settings: SnowSettings = snowSettings) {
  const edgeCache = new Map<number, Point>(), seamCache = new Map<number, Point>(), planCache = new Map<number, Point>();
  const edge = (a: number) => { let p = edgeCache.get(a); if (!p) { p = ringPoint(nose, a); edgeCache.set(a, p); } return p; };
  const atE = (a: number) => { let p = seamCache.get(a); if (!p) { p = ringPoint(seam, a); seamCache.set(a, p); } return p; };
  const planNormal = (a: number) => { let n = planCache.get(a); if (!n) { const t = contourTangent(a, nose.radius); n = unit({ x: t.z, y: 0, z: -t.x }); planCache.set(a, n); } return n; };
  function base(a: number, v: number): Point {
    const e = atE(a), n = edge(a), radial = unit({ x: n.x - e.x, y: 0, z: n.z - e.z });
    let p: Point;
    if (v < 0) p = add(e, radial, settings.inside * v);
    else {
      const length = Math.hypot(n.x - e.x, n.z - e.z), p1 = lerp(e, n, 1 / 3), p2 = add(n, planNormal(a), -length / 3);
      p = lerp(lerp(lerp(e, p1, v), lerp(p1, p2, v), v), lerp(lerp(p1, p2, v), lerp(p2, n, v), v), v);
    }
    return { x: p.x, y: sampleGrid(upper, p.x, p.z).y, z: p.z };
  }
  function top(a: number, v: number) {
    const p = base(a, v), normal = upperNormal(upper, p.x, p.z, settings.normalRadius), thickness = snowThickness(v, normal, settings);
    if (!thickness) return { p: canonical(p), thickness, lift: 0 };
    const blend = smoothstep(.78, 1, v), direction = unit(lerp(normal, { x: 0, y: 1, z: 0 }, blend));
    const n = edge(a), supportY = p.y + blend * (n.y - p.y);
    const q = add({ ...p, y: supportY }, direction, thickness), floor = sampleGrid(upper, q.x, q.z).y + settings.minThickness;
    const lift = Math.max(0, floor - q.y); q.y += lift;
    return { p: canonical(q), thickness, lift };
  }
  function normal(a: number, v: number) {
    const da = .0001, dv = .001, lo = Math.max(-1, v - dv), hi = Math.min(1, v + dv);
    const n = unit(cross(sub(top(a + da, v).p, top(a - da, v).p), sub(top(a, hi).p, top(a, lo).p)));
    return canonical(n.y < 0 ? { x: -n.x, y: -n.y, z: -n.z } : n);
  }
  function profile(a: number, curve = rounded) {
    const n = edge(a), direction = planNormal(a), t = top(a, 1), height = t.p.y - n.y;
    const points: Point[] = [t.p], under: boolean[] = [false];
    const push = (x: number, y: number, underside: boolean) => { points.push(canonical(add({ ...n, y: n.y + y }, direction, x))); under.push(underside); };
    const line = (x0: number, y0: number, x1: number, y1: number, count: number, underside: boolean) => { for (let k = 1; k <= count; k++) { const u = k / count; push(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, underside); } };
    if (!t.thickness) {
      const count = curve ? 41 : 36; for (let k = 1; k <= count; k++) { points.push(canonical(n)); under.push(k > count / 2); }
      return { points, under };
    }
    if (!curve) {
      line(0, height, settings.overhang, height, 10, false);
      line(settings.overhang, height, settings.overhang, 0, 16, false);
      line(settings.overhang, 0, 0, -settings.embed, 10, true);
    } else {
      const radius = Math.min(settings.radius, settings.overhang, Math.max(.01, height - settings.minThickness));
      const bottomRadius = Math.max(.01, Math.min(height - radius, settings.overhang / 4));
      line(0, height, settings.overhang - radius, height, 1, false);
      for (let k = 1; k <= 16; k++) { const theta = k / 16 * Math.PI / 2; push(settings.overhang - radius + radius * Math.sin(theta), height - radius + radius * Math.cos(theta), false); }
      line(settings.overhang, height - radius, settings.overhang, bottomRadius, 8, false);
      for (let k = 1; k <= 6; k++) { const theta = k / 6 * Math.PI / 2; push(settings.overhang - bottomRadius + bottomRadius * Math.cos(theta), bottomRadius - bottomRadius * Math.sin(theta), true); }
      line(settings.overhang - bottomRadius, 0, 0, -settings.embed, 10, true);
    }
    return { points, under };
  }
  // Arc distance on the actual rock edge, not a frozen list of sample points.
  const cumulative = [0], closed = [...nose.points, nose.points[0]], aa = [...nose.angles, nose.angles[0] + TAU];
  for (let i = 1; i < closed.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(...Object.values(sub(closed[i], closed[i - 1]))));
  const centerI = locate(aa, settings.centerAngle), centerT = (settings.centerAngle - aa[centerI]) / (aa[centerI + 1] - aa[centerI]);
  const centerS = cumulative[centerI] + centerT * (cumulative[centerI + 1] - cumulative[centerI]);
  const angleAt = (s: number) => { const i = locate(cumulative, s), p = lerp(closed[i], closed[i + 1], (s - cumulative[i]) / (cumulative[i + 1] - cumulative[i])); return (Math.atan2(p.z / 180, p.x / 260) + TAU) % TAU; };
  let alongStep = settings.alongStep, innerRows = 24, outerRows = 160;
  let angles: number[] = [], columns: ReturnType<typeof top>[][] = [], profiles: ReturnType<typeof profile>[] = [], vRows: number[] = [];
  let maxAlong = 0, maxAcross = 0, maxCap = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const lo = angleAt(centerS - settings.length / 2), hi = angleAt(centerS + settings.length / 2), values = [lo, hi, settings.centerAngle];
    const count = Math.ceil(settings.length / alongStep);
    for (let k = 1; k < count; k++) values.push(angleAt(centerS - settings.length / 2 + settings.length * k / count));
    values.push(...seam.angles.filter(a => a > lo && a < hi), ...nose.angles.filter(a => a > lo && a < hi));
    angles = [...new Set(values)].sort((a, b) => a - b);
    vRows = Array.from({ length: innerRows }, (_, k) => -1 + k / innerRows).concat(Array.from({ length: outerRows + 1 }, (_, k) => k / outerRows));
    columns = angles.map(a => vRows.map(v => top(a, v))); profiles = angles.map(a => profile(a));
    const otherProfiles = angles.map(a => profile(a, !rounded));
    maxAlong = maxAcross = maxCap = 0;
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    for (let i = 0; i < angles.length; i++) {
      for (let j = 0; j < vRows.length; j++) { if (i) maxAlong = Math.max(maxAlong, distance(columns[i][j].p, columns[i - 1][j].p)); if (j) maxAcross = Math.max(maxAcross, distance(columns[i][j].p, columns[i][j - 1].p)); }
      for (const pp of [profiles, otherProfiles]) for (let j = 0; j < pp[i].points.length; j++) { if (i) maxAlong = Math.max(maxAlong, distance(pp[i].points[j], pp[i - 1].points[j])); if (j) maxCap = Math.max(maxCap, distance(pp[i].points[j], pp[i].points[j - 1])); }
    }
    if (maxAlong <= settings.maxStep && maxAcross <= settings.maxStep && maxCap <= settings.maxStep) break;
    if (maxAlong > settings.maxStep) alongStep /= 2;
    if (maxAcross > settings.maxStep) { innerRows *= 2; outerRows *= 2; }
    if (maxCap > settings.maxStep) throw Error('Snow cap parameters exceed configured sampling');
    if (attempt === 4) throw Error('Snow sampling failed to converge');
  }
  const storage = () => ({ p: [] as number[], n: [] as number[], i: [] as number[] });
  const inner = storage(), outer = storage(), bottom = storage(), cap = storage(), capBottom = storage(), closures = storage();
  function emit(out: ReturnType<typeof storage>, points: Point[], normals: Point[]) {
    const d = cross(sub(points[1], points[0]), sub(points[2], points[0])); if (Math.hypot(d.x, d.y, d.z) < 1e-8) return;
    const start = out.p.length / 3; points.forEach((p, k) => { out.p.push(p.x, p.y, p.z); out.n.push(normals[k].x, normals[k].y, normals[k].z); }); out.i.push(start, start + 1, start + 2);
  }
  const Ns = angles.map(a => vRows.map(v => normal(a, v)));
  const bottoms = angles.map((a, i) => vRows.map((v, j) => { const p = base(a, v); return canonical({ ...p, y: p.y - (columns[i][j].thickness ? settings.embed : 0) }); }));
  function quad(out: ReturnType<typeof storage>, p: Point[], n: Point[], reverse = false) { for (const ids of [[0, 1, 2], [1, 3, 2]]) { if (reverse) ids.reverse(); emit(out, ids.map(i => p[i]), ids.map(i => n[i])); } }
  for (let i = 0; i < angles.length - 1; i++) for (let j = 0; j < vRows.length - 1; j++) {
    if ([columns[i][j], columns[i + 1][j], columns[i][j + 1], columns[i + 1][j + 1]].every(p => !p.thickness)) continue;
    const p = [columns[i][j].p, columns[i + 1][j].p, columns[i][j + 1].p, columns[i + 1][j + 1].p], n = [Ns[i][j], Ns[i + 1][j], Ns[i][j + 1], Ns[i + 1][j + 1]];
    quad(j < innerRows ? inner : outer, p, n);
    quad(bottom, [bottoms[i][j], bottoms[i + 1][j], bottoms[i][j + 1], bottoms[i + 1][j + 1]], p.map(() => ({ x: 0, y: -1, z: 0 })), true);
  }
  function capNormal(i: number, j: number) {
    if (j === 0) return Ns[i][Ns[i].length - 1];
    const row = profiles[i].points, lo = Math.max(0, i - 1), hi = Math.min(angles.length - 1, i + 1);
    let before = j - 1, after = Math.min(row.length - 1, j + 1);
    while (before > 0 && Math.hypot(...Object.values(sub(row[j], row[before]))) < 1e-7) before--;
    while (after < row.length - 1 && Math.hypot(...Object.values(sub(row[after], row[j]))) < 1e-7) after++;
    return unit(cross(sub(profiles[hi].points[j], profiles[lo].points[j]), sub(row[after], row[before])));
  }
  for (let i = 0; i < angles.length - 1; i++) for (let j = 0; j < profiles[i].points.length - 1; j++) {
    const p = [profiles[i].points[j], profiles[i + 1].points[j], profiles[i].points[j + 1], profiles[i + 1].points[j + 1]], n = [capNormal(i, j), capNormal(i + 1, j), capNormal(i, j + 1), capNormal(i + 1, j + 1)];
    quad(cap, p, n); if (profiles[i].under[j + 1]) quad(capBottom, p, n);
  }
  for (let i = 0; i < angles.length - 1; i++) quad(closures, [bottoms[i][0], bottoms[i + 1][0], columns[i][0].p, columns[i + 1][0].p], Array(4).fill({ x: 0, y: 0, z: 1 }));
  for (const i of [0, angles.length - 1]) {
    const poly = [...columns[i].map(v => v.p), ...profiles[i].points.slice(1), ...bottoms[i].slice(0, -1).reverse()];
    const center = poly.reduce((p, q) => add(p, q, 1 / poly.length), { x: 0, y: 0, z: 0 });
    for (let k = 0; k < poly.length; k++) { let tri = [center, poly[k], poly[(k + 1) % poly.length]]; if (i === angles.length - 1) tri = tri.reverse(); const n = unit(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))); emit(closures, tri, [n, n, n]); }
  }
  const pack = (s: ReturnType<typeof storage>): SnowMesh => ({ positions: new Float32Array(s.p), normals: new Float32Array(s.n), indices: new Uint32Array(s.i) });
  return { inner: pack(inner), outer: pack(outer), bottom: pack(bottom), cap: pack(cap), capBottom: pack(capBottom), closures: pack(closures), settings, rounded, angles, vRows, seamRow: innerRows, columns, normals: Ns, profiles, base, top, normal, edge, planNormal,
    stats: { maxAlongM: maxAlong, maxAcrossM: maxAcross, maxCapM: maxCap, alongSamples: angles.length, crossSamples: vRows.length, minThicknessM: columns.flat().reduce((v, p) => p.thickness > 0 ? Math.min(v, p.thickness) : v, Infinity), bareVertices: columns.flat().filter(p => !p.thickness).length, maxSupportLiftM: columns.flat().reduce((v, p) => Math.max(v, p.lift), 0) } };
}
