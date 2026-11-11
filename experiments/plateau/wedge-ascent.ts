// Local passage experiment. The accepted uncut wedge remains the source of
// the geometry; only its two shoulders beside the existing ascent are tapered.
import { buildWedge, wedgeProfile } from './wedge-prototype';
import { contourPoint, plateauRadius, SLOPE_START } from './plateau-profile';
import { sampleGrid, type SourceGrid } from './seam-boundary';
import { type Point, type MeshData, boundaryInMountain, append } from './cavity';
import { ascent, profile, cutAscent, boundary } from './ascent';

// Mode 2 will be added only after the user's review of mode 1.
export interface PassageEnding { type: 1; taperLength: number; clearance: number }
export const ascentEnding: PassageEnding = { type: 1, taperLength: 60, clearance: 12 };
type XZ = { x: number; z: number };
const smooth = (t: number) => { const s = Math.max(0, Math.min(1, t)); return s * s * (3 - 2 * s); };
const pointKey = (p: Point) => [p.x, p.y, p.z].map(Math.fround).join(',');

function segmentDistance(p: XZ, a: XZ, b: XZ) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
function cross(a: XZ, b: XZ, p: XZ) { return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x); }
const footprints = profile.slice(1).map((b, i) => {
  const a = profile[i];
  return [{ x: a.x, z: a.z - a.w }, { x: b.x, z: b.z - b.w }, { x: b.x, z: b.z + b.w }, { x: a.x, z: a.z + a.w }];
});
function distanceToFootprint(p: XZ) {
  let distance = Infinity;
  for (const polygon of footprints) {
    if (polygon.every((a, i) => cross(a, polygon[(i + 1) % 4], p) >= -1e-8)) return 0;
    for (let i = 0; i < 4; i++) distance = Math.min(distance, segmentDistance(p, polygon[i], polygon[(i + 1) % 4]));
  }
  return distance;
}

// An entire radial section fades together, so its upper and lower surfaces
// cannot choose different endings. Sample the whole old-to-new rim interval,
// including the inside of the top, rather than only the outer nose.
export function endingWeight(angle: number, ending = ascentEnding) {
  let distance = Infinity;
  for (let i = 0; i <= 12; i++) {
    const r = wedgeProfile.seam + (wedgeProfile.nose - wedgeProfile.seam) * i / 12;
    distance = Math.min(distance, distanceToFootprint(contourPoint(angle, r)));
  }
  return smooth((distance - ending.clearance) / ending.taperLength);
}

export function buildWedgeAscent(source: SourceGrid, upper: SourceGrid, ending = ascentEnding) {
  const accepted = buildWedge(source, upper);
  const weight = (a: number) => endingWeight(a, ending);
  const angle = (p: XZ) => (Math.atan2(p.z / 180, p.x / 260) + Math.PI * 2) % (Math.PI * 2);
  const noseRadius = (a: number) => SLOPE_START + (wedgeProfile.nose - SLOPE_START) * weight(a);
  const field = (p: Point) => {
    const f = plateauRadius(p.x, p.z) - noseRadius(angle(p));
    return Math.abs(f) < 2e-7 ? 0 : f;
  };
  const packed = (positions: number[], indices: number[]): MeshData => ({ positions: new Float32Array(positions), indices: new Uint32Array(indices) });
  const intersections = new Map<string, Point>();
  const edgeKey = (a: Point, b: Point) => [pointKey(a), pointKey(b)].sort().join('|');
  function intersection(a: Point, b: Point): Point {
    const key = edgeKey(a, b), cached = intersections.get(key);
    if (cached) return cached;
    if (pointKey(a) > pointKey(b)) [a, b] = [b, a];
    const fa = field(a), fb = field(b);
    if (fa === 0) return a;
    if (fb === 0) return b;
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) {
      const t = (lo + hi) / 2, p = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
      const f = plateauRadius(p.x, p.z) - noseRadius(angle(p));
      if ((f > 0) === (fa > 0)) lo = t; else hi = t;
    }
    const t = (lo + hi) / 2, result = { x: Math.fround(a.x + t * (b.x - a.x)), y: Math.fround(a.y + t * (b.y - a.y)), z: Math.fround(a.z + t * (b.z - a.z)) };
    intersections.set(key, result); return result;
  }
  // Clip the accepted grid without moving its XZ vertices. Shared E triangles
  // keep their planes, and neighbouring owners share each cut vertex.
  const topP: number[] = [], topI: number[] = [];
  const m = accepted.strip;
  for (let k = 0; k < m.indices.length; k += 3) {
    const tri = Array.from(m.indices.subarray(k, k + 3), id => ({ x: m.positions[id * 3], y: m.positions[id * 3 + 1], z: m.positions[id * 3 + 2] }));
    const polygon: Point[] = [];
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3], insideA = field(a) <= 0, insideB = field(b) <= 0;
      if (insideA) polygon.push(a);
      if (insideA !== insideB) polygon.push(intersection(a, b));
    }
    append(polygon, topP, topI);
  }
  const rawStrip = packed(topP, topI);
  const edges = new Map<string, { a: Point; b: Point; count: number }>();
  for (let k = 0; k < rawStrip.indices.length; k += 3) {
    const tri = Array.from(rawStrip.indices.subarray(k, k + 3), id => ({ x: rawStrip.positions[id * 3], y: rawStrip.positions[id * 3 + 1], z: rawStrip.positions[id * 3 + 2] }));
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3], key = edgeKey(a, b), e = edges.get(key);
      if (e) e.count++; else edges.set(key, { a, b, count: 1 });
    }
  }
  const nosePoints = new Map<string, Point>(), degree = new Map<string, number>();
  for (const e of edges.values()) if (e.count === 1 && plateauRadius(e.a.x, e.a.z) > .95 && plateauRadius(e.b.x, e.b.z) > .95) {
    for (const p of [e.a, e.b]) { const k = pointKey(p); nosePoints.set(k, p); degree.set(k, (degree.get(k) ?? 0) + 1); }
  }
  if ([...degree.values()].some(n => n !== 2)) throw Error('Tapered nose must be one closed ring');
  const acceptedAngles = new Map(accepted.nose.points.map((p, i) => [pointKey(p), accepted.nose.angles[i]]));
  const ordered = [...nosePoints.values()].map(p => ({ p, a: acceptedAngles.get(pointKey(p)) ?? angle(p) })).sort((a, b) => a.a - b.a);
  function topPoint(p: Point): Point {
    const w = weight(angle(p));
    if (w === 1) return p;
    const y = sampleGrid(source, p.x, p.z).y;
    return { ...p, y: Math.fround(y + (p.y - y) * w) };
  }
  const stripP = rawStrip.positions.slice();
  for (let k = 0; k < stripP.length; k += 3) stripP[k + 1] = topPoint({ x: stripP[k], y: stripP[k + 1], z: stripP[k + 2] }).y;
  const strip = { positions: stripP, indices: rawStrip.indices };
  const underP: number[] = [], underI: number[] = [];
  function bridge(a: Point[], aa: number[], b: Point[], ba: number[]) {
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      const ai = i % a.length, bj = j % b.length;
      const nextA = aa[(i + 1) % a.length] + (i + 1 >= a.length ? Math.PI * 2 : 0);
      const nextB = ba[(j + 1) % b.length] + (j + 1 >= b.length ? Math.PI * 2 : 0);
      if (j === b.length || (i < a.length && nextA <= nextB)) {
        append([a[ai], a[(i + 1) % a.length], b[bj]], underP, underI); i++;
      } else { append([a[ai], b[(j + 1) % b.length], b[bj]], underP, underI); j++; }
    }
  }
  const angles = ordered.map(p => p.a), nose = ordered.map(({ p }) => topPoint(p));
  let ring = nose;
  for (let row = 1; row < wedgeProfile.undersideRows; row++) {
    const t = row / wedgeProfile.undersideRows;
    const next = angles.map(a => {
      const w = weight(a), wall = contourPoint(a, wedgeProfile.attachment);
      const depth = sampleGrid(upper, wall.x, wall.z).y - sampleGrid(source, wall.x, wall.z).y;
      const n = noseRadius(a), radius = n + (wedgeProfile.attachment - n) * Math.sqrt(t), xz = contourPoint(a, radius);
      const target = sampleGrid(upper, xz.x, xz.z).y - depth * t;
      const old = sampleGrid(source, xz.x, xz.z).y;
      return { ...xz, y: w === 1 ? target : old + (target - old) * w };
    });
    bridge(ring, angles, next, angles); ring = next;
  }
  bridge(ring, angles, accepted.attachment.points, accepted.attachment.angles);
  const uncut = { plateau: accepted.plateau, strip, underside: packed(underP, underI), flank: accepted.flank };
  const minZ = Math.min(...profile.map(p => p.z - p.w)), maxZ = Math.max(...profile.map(p => p.z + p.w));
  // In the zero-weight band there is no overhang. Bound the existing ascent
  // by the exact displayed triangles, including the reconstructed old flank.
  const interiors = Object.values(uncut).map(mesh => boundaryInMountain(mesh, boundary, { minX: ascent.start, maxX: ascent.end, minZ, maxZ }));
  const positions: number[] = [], indices: number[] = [];
  for (const mesh of interiors) {
    const offset = positions.length / 3;
    for (const p of mesh.positions) positions.push(p);
    for (const i of mesh.indices) indices.push(i + offset);
  }
  const cut = { plateau: cutAscent(uncut.plateau), strip: cutAscent(uncut.strip), underside: cutAscent(uncut.underside), flank: cutAscent(uncut.flank), interior: packed(positions, indices) };
  return { accepted, uncut, cut, nose, ending, endingWeight: weight };
}
