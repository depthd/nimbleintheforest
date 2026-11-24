// Existing RockSkin dressing projected onto the final, accepted shell. No new
// mask and no changes to the terrain, passage or wedge geometry.
import { Color, SRGBColorSpace } from 'three';
import { RockSkin } from '../../src/gen/rock-skin';
import { blockTriangles, pillow } from '../../src/gen/cliffs';
import { Rng } from '../../src/core/rng';
import { type MeshData, type Point, value, clip, plane, append } from './cavity';
import { type SourceGrid, sampleGrid } from './seam-boundary';
import { contourPoint, plateauRadius } from './plateau-profile';
import { ascentHeight, ascentWidth, ascentCenter, ascentCutVolumes, profile } from './ascent';
import { pack, vertices } from './wedge-plan-cut';

const TAU = Math.PI * 2, ANGLES = 360, HEIGHT_BIN = 4;
interface Face { a: Point; u: Point; v: Point; normal: Point; d: number; uu: number; uv: number; vv: number; denominator: number }
export interface SurfaceHit extends Point { normalY: number; radius: number }
export type RoofSampler = ((x: number, z: number) => number | undefined) & { triangleClearance?: (triangle: Point[]) => number };
// Vertical lookup on the rendered top, including the rim's connecting strip.
// The original height grid is insufficient after its outer edge is shaped.
export function surfaceRoof(meshes: MeshData[]) {
  const cell = 8, bins = new Map<string, Point[][]>();
  let minY = Infinity;
  for (const mesh of meshes) for (let k = 0; k < mesh.indices.length; k += 3) {
    const tri = vertices(mesh, k);
    minY = Math.min(minY, ...tri.map(p => p.y));
    const minX = Math.floor(Math.min(...tri.map(p => p.x)) / cell), maxX = Math.floor(Math.max(...tri.map(p => p.x)) / cell);
    const minZ = Math.floor(Math.min(...tri.map(p => p.z)) / cell), maxZ = Math.floor(Math.max(...tri.map(p => p.z)) / cell);
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const key = x + ',' + z; if (!bins.has(key)) bins.set(key, []); bins.get(key)!.push(tri);
    }
  }
  const query: RoofSampler = (x: number, z: number): number | undefined => {
    let roof: number | undefined;
    for (const [a, b, c] of bins.get(Math.floor(x / cell) + ',' + Math.floor(z / cell)) || []) {
      const ux = b.x - a.x, uz = b.z - a.z, vx = c.x - a.x, vz = c.z - a.z, den = ux * vz - uz * vx;
      if (Math.abs(den) < 1e-10) continue;
      const s = ((x - a.x) * vz - (z - a.z) * vx) / den, t = (ux * (z - a.z) - uz * (x - a.x)) / den;
      if (s < -1e-6 || t < -1e-6 || s + t > 1 + 1e-6) continue;
      const y = a.y + s * (b.y - a.y) + t * (c.y - a.y); if (roof === undefined || y > roof) roof = y;
    }
    return roof;
  };
  const prepared = new Map<Point[], { cuts: ReturnType<typeof plane>[]; height: (p: Point) => number }>();
  query.triangleClearance = triangle => {
    if (Math.max(...triangle.map(p => p.y)) < minY - .5) return Infinity;
    const minX = Math.floor(Math.min(...triangle.map(p => p.x)) / cell), maxX = Math.floor(Math.max(...triangle.map(p => p.x)) / cell);
    const minZ = Math.floor(Math.min(...triangle.map(p => p.z)) / cell), maxZ = Math.floor(Math.max(...triangle.map(p => p.z)) / cell);
    const seen = new Set<Point[]>(); let clearance = Infinity;
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) for (const tri of bins.get(x + ',' + z) || []) {
      if (seen.has(tri)) continue; seen.add(tri);
      let face = prepared.get(tri);
      if (!face) {
        const [a, b, c] = tri, ux = b.x - a.x, uz = b.z - a.z, vx = c.x - a.x, vz = c.z - a.z, den = ux * vz - uz * vx;
        if (Math.abs(den) < 1e-10) continue;
        const cuts = tri.map((a, i) => { const b = tri[(i + 1) % 3], c = tri[(i + 2) % 3]; let p = plane(b.z - a.z, 0, a.x - b.x, -(b.z - a.z) * a.x - (a.x - b.x) * a.z); if (value(p, c) > 0) p = { ...p, x: -p.x, z: -p.z, d: -p.d }; return p; });
        face = { cuts, height: p => a.y + ((p.x - a.x) * vz - (p.z - a.z) * vx) / den * (b.y - a.y) + (ux * (p.z - a.z) - uz * (p.x - a.x)) / den * (c.y - a.y) };
        prepared.set(tri, face);
      }
      let overlap = triangle;
      for (const p of face.cuts) { overlap = clip(overlap, p); if (!overlap.length) break; }
      // Both faces are planar on each overlap. Their height difference is
      // linear, so checking its vertices covers the complete rock triangle.
      for (const p of overlap) clearance = Math.min(clearance, face.height(p) - p.y);
    }
    return clearance;
  };
  return query;
}
export function radialSurface(meshes: MeshData[]) {
  const bins = new Map<number, Face[]>();
  for (const mesh of meshes) for (let k = 0; k < mesh.indices.length; k += 3) {
    const tri = vertices(mesh, k), [a, b, c] = tri;
    if (Math.max(...tri.map(p => p.y)) < .5 || Math.min(...tri.map(p => p.y)) > 112) continue;
    const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const normal = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x }, length = Math.hypot(normal.x, normal.y, normal.z);
    if (length < 1e-8 || Math.abs(normal.y) / length > .95) continue;
    const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y + a.z * b.z;
    const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), denominator = uu * vv - uv * uv;
    if (denominator < 1e-12) continue;
    const face = { a, u, v, normal, d: -dot(normal, a), uu, uv, vv, denominator };
    let angles = tri.map(p => (Math.atan2(p.z / 180, p.x / 260) + TAU) % TAU);
    if (Math.max(...angles) - Math.min(...angles) > Math.PI) angles = angles.map(a => a < Math.PI ? a + TAU : a);
    for (let ai = Math.floor(Math.min(...angles) / TAU * ANGLES); ai <= Math.floor(Math.max(...angles) / TAU * ANGLES); ai++) {
      for (let yi = Math.floor(Math.min(...tri.map(p => p.y)) / HEIGHT_BIN); yi <= Math.floor(Math.max(...tri.map(p => p.y)) / HEIGHT_BIN); yi++) {
        const key = ((ai % ANGLES) + ANGLES) % ANGLES + ANGLES * yi;
        if (!bins.has(key)) bins.set(key, []); bins.get(key)!.push(face);
      }
    }
  }
  return (angle: number, y: number): SurfaceHit | undefined => {
    const a = (angle % TAU + TAU) % TAU, ray = contourPoint(a, 1);
    const key = Math.floor(a / TAU * ANGLES) + ANGLES * Math.floor(y / HEIGHT_BIN);
    let best: SurfaceHit | undefined;
    for (const f of bins.get(key) ?? []) {
      const divisor = f.normal.x * ray.x + f.normal.z * ray.z;
      if (Math.abs(divisor) < 1e-9) continue;
      const radius = -(f.normal.y * y + f.d) / divisor;
      if (radius < .88 || radius > 1.16 || best && radius <= best.radius) continue;
      const x = ray.x * radius, z = ray.z * radius, dx = x - f.a.x, dy = y - f.a.y, dz = z - f.a.z;
      const du = dx * f.u.x + dy * f.u.y + dz * f.u.z, dv = dx * f.v.x + dy * f.v.y + dz * f.v.z;
      const u = (f.vv * du - f.uv * dv) / f.denominator, v = (f.uu * dv - f.uv * du) / f.denominator;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      best = { x, y, z, radius, normalY: f.normal.y / Math.hypot(f.normal.x, f.normal.y, f.normal.z) };
    }
    return best;
  };
}

function chartSkin(size: number, cell: number, seed: number, halfLength: number) {
  const n = size / cell, h = new Float32Array((n + 1) ** 2);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) h[j * (n + 1) + i] = Math.max(0, Math.min(112, (j * cell - size / 2) * 2.5));
  const skin = new RockSkin({ seed, size, n, cell, h, water: new Float32Array(h.length).fill(NaN), ox: size / 2, oz: size / 2, edgeDist: () => 500 },
    { border: 4, minDeg: 51, exclude: (u, v) => Math.abs(u) > halfLength || Math.abs(v) > 60 });
  const baseZ = (y: number) => {
    for (let j = n / 2; j < n; j++) {
      const lo = h[j * (n + 1)], hi = h[(j + 1) * (n + 1)];
      if (hi > lo && y <= hi) return j * cell - size / 2 + cell * (y - lo) / (hi - lo);
    }
    return 112 / 2.5;
  };
  return { skin, baseZ };
}
const insidePassage = (p: Point) => ascentCutVolumes().some(volume => volume.every(pl => value(pl, p) < .02));

export function buildWedgeRocks(surfaces: { underside: MeshData; flank: MeshData; restored: MeshData }, source: SourceGrid, upper: SourceGrid, roofAt: RoofSampler = (x, z) => sampleGrid(upper, x, z).y) {
  const sample = radialSurface([surfaces.underside, surfaces.flank, surfaces.restored]);
  const rockP: number[] = [], rockI: number[] = [], colors: number[] = [], snowP: number[] = [], snowI: number[] = [];
  const soft = new Color().setRGB(.26, .27, .32, SRGBColorSpace), hard = new Color().setRGB(.41, .43, .49, SRGBColorSpace);
  const rng = new Rng(142);
  const stats = { exteriorBlocks: 0, wallBlocks: 0, snowCaps: 0, rejectedBlocks: 0, maxWallProtrusion: .8, minTopClearance: Infinity };
  const attachments: { angle: number; y: number; x: number; z: number }[] = [];
  type Mapper = (x: number, y: number, z: number) => Point | undefined;
  function clearOfRoof(points: Point[]) {
    if (!roofAt.triangleClearance) return true;
    for (let k = 0; k < points.length; k += 3) if (roofAt.triangleClearance(points.slice(k, k + 3)) < .5) return false;
    return true;
  }
  function subdivide(raw: number[], wall: boolean) {
    const positions: number[] = [], indices: number[] = [];
    for (let k = 0; k < raw.length; k += 9) {
      let pieces: Point[][] = [[0, 3, 6].map(q => ({ x: raw[k + q], y: raw[k + q + 1], z: raw[k + q + 2] }))];
      for (const axis of ['x', 'y'] as const) {
        const pitch = axis === 'x' ? 4 : 3, stops: number[] = [];
        const lo = Math.min(...pieces[0].map(p => p[axis])), hi = Math.max(...pieces[0].map(p => p[axis]));
        for (let t = Math.floor(lo / pitch) * pitch + pitch; t < hi - 1e-6; t += pitch) stops.push(t);
        if (axis === 'x' && wall) for (const p of profile) if (p.x + 140 > lo + 1e-6 && p.x + 140 < hi - 1e-6) stops.push(p.x + 140);
        for (const t of [...new Set(stops)].sort((a,b)=>a-b)) {
          const next: Point[][] = [], pl = axis === 'x' ? plane(1, 0, 0, -t) : plane(0, 1, 0, -t);
          for (const p of pieces) { const a = clip(p, pl), b = clip(p, { ...pl, x: -pl.x, y: -pl.y, d: -pl.d }); if (a.length >= 3) next.push(a); if (b.length >= 3) next.push(b); }
          pieces = next;
        }
      }
      for (const p of pieces) append(p, positions, indices);
    }
    return positions;
  }
  function dress(skin: RockSkin, map: Mapper, kind: 'exterior' | 'wall') {
    for (const block of skin.blocks) {
      let raw: number[] = []; blockTriangles(block, raw); raw = subdivide(raw, kind === 'wall');
      const mapped: Point[] = [];
      for (let i = 0; i < raw.length; i += 3) {
        const p = map(raw[i], raw[i + 1], raw[i + 2]);
        if (!p) break; mapped.push(p);
      }
      if (mapped.length * 3 !== raw.length || !clearOfRoof(mapped)) { stats.rejectedBlocks++; continue; }
      const color = soft.clone().lerp(hard, block.tone);
      for (const p of mapped) { rockI.push(rockP.length / 3); rockP.push(p.x, p.y, p.z); colors.push(color.r, color.g, color.b); }
      if (kind === 'exterior') stats.exteriorBlocks++; else stats.wallBlocks++;
      if (rng.next() < .62) {
        const localP: number[] = [], localI: number[] = [];
        pillow(block, rng.float(.3, .5), () => rng.float(.94, 1.04), localP, localI);
        const snowRaw: number[] = []; for (const i of localI) snowRaw.push(...localP.slice(i * 3, i * 3 + 3));
        const divided = subdivide(snowRaw, kind === 'wall'), snow: Point[] = [];
        for (let i = 0; i < divided.length; i += 3) { const p = map(divided[i], divided[i + 1], divided[i + 2]); if (!p) break; snow.push(p); }
        if (snow.length * 3 === divided.length && clearOfRoof(snow)) {
          const start = snowP.length / 3; for (const p of snow) snowP.push(p.x, p.y, p.z);
          for (let i = 0; i < snow.length; i++) snowI.push(start + i); stats.snowCaps++;
        }
      }
    }
  }
  const cache = new Map<string, SurfaceHit | undefined>();
  let probe = 0;
  const exteriorChart = chartSkin(1600, 4, 42, 722);
  const exterior: Mapper = (x, y, z) => {
    if (y < 1 || y > 110) return;
    const angle = x / 1450 * TAU, key = x.toFixed(5) + ',' + y.toFixed(5);
    if (!cache.has(key)) cache.set(key, sample(angle, y));
    const base = cache.get(key); if (!base || Math.abs(base.normalY) > .86) return;
    // Beside the passage the old exterior wall can extend beyond the shown
    // top's footprint. Missing vertical coverage is not a reason to erase it.
    const roof = roofAt(base.x, base.z) ?? sampleGrid(upper, base.x, base.z).y;
    if (y > roof - 1.2) return;
    const depth = z - exteriorChart.baseZ(y) + .15, length = Math.hypot(base.x, base.z);
    const p = { x: base.x - depth * base.x / length, y, z: base.z - depth * base.z / length };
    const clearance = (roofAt(p.x, p.z) ?? roof) - y;
    if (insidePassage(p) || clearance < 1) return;
    stats.minTopClearance = Math.min(stats.minTopClearance, clearance);
    if (attachments.length < 120 && probe++ % 71 === 0) attachments.push({ angle, y, x: base.x, z: base.z });
    return p;
  };
  dress(exteriorChart.skin, exterior, 'exterior');
  for (const side of [-1, 1]) {
    const wallChart = chartSkin(480, 2, side < 0 ? 61 : 77, 158);
    const wall: Mapper = (u, y, z) => {
      const x = u - 140; if (x < -295 || x > 16) return;
      const edge = ascentCenter(x) + side * ascentWidth(x), roof = sampleGrid(source, x, edge).y;
      if (y < ascentHeight(x) + .8 || y > roof - 1) return;
      const depth = z - wallChart.baseZ(y) + .15, d = depth < 0 ? Math.max(-.8, depth * .45) : depth;
      stats.minTopClearance = Math.min(stats.minTopClearance, roof - y);
      return { x, y, z: edge + side * d };
    };
    dress(wallChart.skin, wall, 'wall');
  }
  return { rocks: { ...pack(rockP, rockI), colors }, snow: pack(snowP, snowI), stats, attachments, sample };
}
