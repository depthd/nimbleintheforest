// Return the whole accepted cross-section into the mountain in plan. The
// upper grid never fades down, and there is no separately cut vertical cap.
import { type MeshData, type Point, type Plane, append, plane, clip, flip, value } from './cavity';
import { type SourceGrid, sampleGrid } from './seam-boundary';
import { contourPoint, plateauRadius } from './plateau-profile';
import { buildWedge, wedgeProfile } from './wedge-prototype';
import { profile } from './ascent';
import { triangleVertexIndices } from './seam-safe-boundary';
import { pack, join, vertices } from './wedge-plan-cut';

export interface SweptEnding { type: 1; transition: number; clearance: number; buriedNose: number }
export const sweptEnding: SweptEnding = { type: 1, transition: 80, clearance: 12, buriedNose: .90 };
const key = (p: Point) => [p.x, p.y, p.z].join(',');
const xzKey = (p: Point) => [p.x, p.z].join(',');
const angle = (p: { x: number; z: number }) => (Math.atan2(p.z / 180, p.x / 260) + Math.PI * 2) % (Math.PI * 2);
const quintic = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * t * (10 + t * (-15 + 6 * t)); };
const footprints = profile.slice(1).map((b, i) => { const a = profile[i]; return [{ x: a.x, z: a.z - a.w }, { x: b.x, z: b.z - b.w }, { x: b.x, z: b.z + b.w }, { x: a.x, z: a.z + a.w }]; });
function distanceToPassage(p: { x: number; z: number }) {
  let distance = Infinity;
  for (const polygon of footprints) {
    if (polygon.every((a, i) => { const b = polygon[(i + 1) % 4]; return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) >= -1e-8; })) return 0;
    for (let i = 0; i < 4; i++) {
      const a = polygon[i], b = polygon[(i + 1) % 4], dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
      distance = Math.min(distance, Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz));
    }
  }
  return distance;
}

export function buildSweptEnding(source: SourceGrid, upper: SourceGrid, accepted: ReturnType<typeof buildWedge>, ending = sweptEnding) {
  const weights = new Map<number, number>();
  function weight(a: number) {
    const cached = weights.get(a); if (cached !== undefined) return cached;
    let distance = Infinity;
    for (let i = 0; i <= 12; i++) distance = Math.min(distance, distanceToPassage(contourPoint(a, wedgeProfile.seam + (wedgeProfile.nose - wedgeProfile.seam) * i / 12)));
    const w = quintic((distance - ending.clearance) / ending.transition); weights.set(a, w); return w;
  }
  const noseRadius = (a: number) => ending.buriedNose + (wedgeProfile.nose - ending.buriedNose) * weight(a);
  const field = (p: Point) => { const f = plateauRadius(p.x, p.z) - noseRadius(angle(p)); return Math.abs(f) < 2e-7 ? 0 : f; };
  const roots = new Map<string, { x: number; z: number }>();
  function root(a: Point, b: Point): Point {
    if (field(a) === 0) return a;
    if (field(b) === 0) return b;
    if (xzKey(a) > xzKey(b)) [a, b] = [b, a];
    const ek = xzKey(a) + '|' + xzKey(b);
    let p = roots.get(ek);
    if (!p) {
      let lo = 0, hi = 1; const fa = field(a);
      for (let i = 0; i < 40; i++) {
        const t = (lo + hi) / 2, q = { x: a.x + t * (b.x - a.x), y: 0, z: a.z + t * (b.z - a.z) };
        const f = plateauRadius(q.x, q.z) - noseRadius(angle(q));
        if ((f > 0) === (fa > 0)) lo = t; else hi = t;
      }
      const t = (lo + hi) / 2; p = { x: Math.fround(a.x + t * (b.x - a.x)), z: Math.fround(a.z + t * (b.z - a.z)) }; roots.set(ek, p);
    }
    const dx = b.x - a.x, dz = b.z - a.z, t = Math.abs(dx) > Math.abs(dz) ? (p.x - a.x) / dx : (p.z - a.z) / dz;
    return { ...p, y: Math.fround(a.y + t * (b.y - a.y)) };
  }
  function cut(poly: Point[], inside: boolean) {
    const out: Point[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ia = field(a) <= 0, ib = field(b) <= 0;
      if (ia === inside) out.push(a);
      if (ia !== ib) out.push(root(a, b));
    }
    return out;
  }
  function trim(m: MeshData) {
    const p: number[] = [], indices: number[] = [];
    for (let k = 0; k < m.indices.length; k += 3) append(cut(vertices(m, k), true), p, indices);
    return pack(p, indices);
  }
  const strip = trim(accepted.strip), disc = trim(join([accepted.plateau, accepted.strip]));
  const edges = new Map<string, { a: Point; b: Point; count: number }>();
  for (let k = 0; k < disc.indices.length; k += 3) {
    const tri = vertices(disc, k);
    for (let i = 0; i < 3; i++) { const a = tri[i], b = tri[(i + 1) % 3], ek = [key(a), key(b)].sort().join('|'), e = edges.get(ek); if (e) e.count++; else edges.set(ek, { a, b, count: 1 }); }
  }
  const noseMap = new Map<string, Point>(), degrees = new Map<string, number>();
  for (const e of edges.values()) if (e.count === 1) for (const p of [e.a, e.b]) { const k = key(p); noseMap.set(k, p); degrees.set(k, (degrees.get(k) ?? 0) + 1); }
  if ([...degrees.values()].some(d => d !== 2)) throw Error('Swept nose must be closed');
  const originalAngles = new Map(accepted.nose.points.map((p, i) => [key(p), accepted.nose.angles[i]]));
  const ordered = [...noseMap.values()].map(p => ({ p, a: originalAngles.get(key(p)) ?? angle(p) })).sort((a, b) => a.a - b.a);
  for (let i = 0; i < ordered.length; i++) {
    const ek = [key(ordered[i].p), key(ordered[(i + 1) % ordered.length].p)].sort().join('|');
    if (edges.get(ek)?.count !== 1) throw Error('Swept nose must be a single ordered outline');
  }
  const angles = ordered.map(p => p.a), nose = ordered.map(p => p.p), underP: number[] = [], underI: number[] = [];
  function bridge(a: Point[], aa: number[], b: Point[], ba: number[]) {
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      const ai = i % a.length, bj = j % b.length;
      const nextA = aa[(i + 1) % a.length] + (i + 1 >= a.length ? Math.PI * 2 : 0);
      const nextB = ba[(j + 1) % b.length] + (j + 1 >= b.length ? Math.PI * 2 : 0);
      if (j === b.length || i < a.length && nextA <= nextB) { append([a[ai], a[(i + 1) % a.length], b[bj]], underP, underI); i++; }
      else { append([a[ai], b[(j + 1) % b.length], b[bj]], underP, underI); j++; }
    }
  }
  let ring = nose;
  for (let row = 1; row < wedgeProfile.undersideRows; row++) {
    const t = row / wedgeProfile.undersideRows;
    const next = angles.map(a => {
      const wall = contourPoint(a, wedgeProfile.attachment), depth = sampleGrid(upper, wall.x, wall.z).y - sampleGrid(source, wall.x, wall.z).y;
      const n = noseRadius(a), radius = n + (wedgeProfile.attachment - wedgeProfile.nose) * Math.sqrt(t), xz = contourPoint(a, radius);
      return { ...xz, y: sampleGrid(upper, xz.x, xz.z).y - depth * t };
    });
    bridge(ring, angles, next, angles); ring = next;
  }
  const bottom = accepted.attachment.points.map((p, i) => {
    const a = accepted.attachment.angles[i]; if (weight(a) === 1) return p;
    const wall = contourPoint(a, wedgeProfile.attachment), depth = sampleGrid(upper, wall.x, wall.z).y - sampleGrid(source, wall.x, wall.z).y;
    const xz = contourPoint(a, wedgeProfile.attachment + noseRadius(a) - wedgeProfile.nose);
    return { ...xz, y: sampleGrid(upper, xz.x, xz.z).y - depth };
  });
  bridge(ring, angles, bottom, accepted.attachment.angles);
  const sweptUnder = pack(underP, underI);

  // Form the visible union with the old terrain. Split on its actual grid
  // triangles: buried parts disappear, and the ground below an overhang stays.
  const seamSegments = new Map(accepted.seam.sourceTriangles.map((id, i) => [id, i]));
  const oldTris = new Map<number, Point[]>();
  function oldTriangle(id: number) {
    let tri = oldTris.get(id);
    if (!tri) { tri = triangleVertexIndices(source, id).map(k => ({ x: source.x0 + k % (source.n + 1) * source.cell, y: source.heights[k], z: source.z0 + Math.floor(k / (source.n + 1)) * source.cell })); oldTris.set(id, tri); }
    return tri;
  }
  const stableCells = new Map<number, boolean>();
  function stableCell(id: number) {
    const cached = stableCells.get(id); if (cached !== undefined) return cached;
    const tri = oldTriangle(id), x = (tri[0].x + tri[1].x + tri[2].x) / 3, z = (tri[0].z + tri[1].z + tri[2].z) / 3;
    const stable = plateauRadius(x, z) > wedgeProfile.nose + .04 || tri.every(p => weight(angle(p)) === 1) && weight(angle({ x, z })) === 1;
    stableCells.set(id, stable); return stable;
  }
  const attachmentSegments = new Map(accepted.attachment.sourceTriangles.map((id, i) => [id, i]));
  function originalFlank(tri: Point[], id: number) {
    const segment = attachmentSegments.get(id);
    if (segment === undefined) return plateauRadius((tri[0].x + tri[1].x + tri[2].x) / 3, (tri[0].z + tri[1].z + tri[2].z) / 3) > wedgeProfile.attachment ? tri : [];
    const a = accepted.attachment.points[segment], b = accepted.attachment.points[(segment + 1) % accepted.attachment.points.length];
    return clip(tri, flip(plane(b.z - a.z, 0, a.x - b.x, -(b.z - a.z) * a.x - (a.x - b.x) * a.z))).map(p => {
      for (const q of [a, b]) if (Math.hypot(p.x - q.x, p.z - q.z) < 5e-4) return q; return p;
    });
  }
  function outsideSeam(poly: Point[], id: number) {
    if (poly.length < 3) return [];
    const segment = seamSegments.get(id);
    if (segment === undefined) { const p = poly[0]; return plateauRadius(p.x, p.z) < wedgeProfile.seam ? [] : poly; }
    const a = accepted.seam.points[segment], b = accepted.seam.points[(segment + 1) % accepted.seam.points.length];
    return clip(poly, flip(plane(b.z - a.z, 0, a.x - b.x, -(b.z - a.z) * a.x - (a.x - b.x) * a.z))).map(p => {
      for (const q of [a, b]) if (Math.hypot(p.x - q.x, p.z - q.z) < 5e-4) return q;
      return p;
    });
  }
  function facePlane(tri: Point[]): Plane {
    const [a, b, c] = tri, ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    let p = plane(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx, 0);
    if (p.y < 0) p = flip(p); p.d = -p.x * a.x - p.y * a.y - p.z * a.z; return p;
  }
  function footprint(poly: Point[], tri: Point[]) {
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3], c = tri[(i + 2) % 3];
      let p = plane(b.z - a.z, 0, a.x - b.x, -(b.z - a.z) * a.x - (a.x - b.x) * a.z);
      if (value(p, c) > 0) p = flip(p); poly = clip(poly, p); if (poly.length < 3) break;
    }
    return poly;
  }
  const visibleP: number[] = [], visibleI: number[] = [], restoredP: number[] = [], restoredI: number[] = [];
  for (let k = 0; k < sweptUnder.indices.length; k += 3) {
    const tri = vertices(sweptUnder, k), bottomPlane = facePlane(tri);
    const minI = Math.max(0, Math.floor((Math.min(...tri.map(p => p.x)) - source.x0) / source.cell)), maxI = Math.min(source.n - 1, Math.floor((Math.max(...tri.map(p => p.x)) - source.x0) / source.cell));
    const minJ = Math.max(0, Math.floor((Math.min(...tri.map(p => p.z)) - source.z0) / source.cell)), maxJ = Math.min(source.n - 1, Math.floor((Math.max(...tri.map(p => p.z)) - source.z0) / source.cell));
    const pieces: Point[][] = []; let allVisible = true, seen = false;
    for (let j = minJ; j <= maxJ; j++) for (let i = minI; i <= maxI; i++) for (let face = 0; face < 2; face++) {
      const id = 2 * (j * source.n + i) + face, old = oldTriangle(id), section = footprint(tri, old);
      if (section.length < 3) continue;
      let area = 0; for (let q = 0; q < section.length; q++) { const a = section[q], b = section[(q + 1) % section.length]; area += a.x * b.z - b.x * a.z; }
      if (Math.abs(area) < 1e-9) continue;
      seen = true;
      const pl = facePlane(old);
      if (section.some(p => value(pl, p) < -2e-5)) allVisible = false;
      // The protected plateau owns everything inside E. On rough relief a
      // buried triangle's chord can poke through that top between samples;
      // it is not an exposed part of the mask and must not be rendered.
      const above = outsideSeam(clip(section, flip(pl)), id);
      if (above.some(p => value(pl, p) > 1e-4)) pieces.push(above);
      const ground = section.map(p => ({ x: p.x, y: -(pl.x * p.x + pl.z * p.z + pl.d) / pl.y, z: p.z }));
      if (!stableCell(id)) append(outsideSeam(clip(ground, bottomPlane), id).reverse(), restoredP, restoredI);
    }
    if (allVisible && seen || tri.every(p => weight(angle(p)) === 1)) append(tri, visibleP, visibleI); else for (const p of pieces) append(p, visibleP, visibleI);
  }
  // Use the rendered top's exact footprint, not another evaluation of the
  // analytic curve. Near a tangent, its clipped chords can differ by mm.
  const topFootprints = new Map<number, Point[][]>();
  for (let k = 0; k < disc.indices.length; k += 3) {
    const tri = vertices(disc, k), x = (tri[0].x + tri[1].x + tri[2].x) / 3, z = (tri[0].z + tri[1].z + tri[2].z) / 3;
    const id = sampleGrid(source, x, z).triangle;
    if (!topFootprints.has(id)) topFootprints.set(id, []); topFootprints.get(id)!.push(tri);
  }
  const flankP: number[] = [], flankI: number[] = [];
  for (let id = 0; id < source.n * source.n * 2; id++) {
    const tri = oldTriangle(id);
    if (stableCell(id)) { append(originalFlank(tri, id), flankP, flankI); continue; }
    const poly = outsideSeam(tri, id);
    if (poly.length < 3) continue;
    let remaining = [poly];
    for (const top of topFootprints.get(id) ?? []) {
      const next: Point[][] = [];
      for (const piece of remaining) {
        let part = piece;
        for (let i = 0; i < 3; i++) {
          const a = top[i], b = top[(i + 1) % 3], c = top[(i + 2) % 3];
          if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-8) continue;
          let pl = plane(b.z - a.z, 0, a.x - b.x, -(b.z - a.z) * a.x - (a.x - b.x) * a.z);
          if (value(pl, c) > 0) pl = flip(pl);
          if (part.some(p => value(pl, p) > 2e-6)) next.push(clip(part, flip(pl)));
          part = clip(part, pl); if (part.length < 3) break;
        }
      }
      remaining = next;
    }
    for (const p of remaining) append(p, flankP, flankI);
  }
  // Clipping a face tangent to the terrain can leave Float32 slivers. Cull
  // fragments thinner than 0.05 mm, below the 0.5 mm seam-check tolerance.
  function clean(m: MeshData): MeshData {
    const indices: number[] = [];
    for (let k = 0; k < m.indices.length; k += 3) {
      const [a, b, c] = vertices(m, k), ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      const area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      const longest = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz), Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z));
      if (area2 / longest >= 5e-5) indices.push(...m.indices.subarray(k, k + 3));
    }
    return { positions: m.positions, indices: new Uint32Array(indices) };
  }
  return { strip: clean(strip), underside: clean(pack(visibleP, visibleI)), flank: clean(pack(flankP, flankI)), restored: clean(pack(restoredP, restoredI)), sweptUnder, nose, weight, ending };
}
