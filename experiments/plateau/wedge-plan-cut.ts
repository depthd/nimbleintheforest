// A vertical circular cutter trims existing faces. It never changes their
// heights or bends a radial section down towards the old mountain.
import { type MeshData, type Point, plane, value, clip, flip, append } from './cavity';

export interface PlanCircle { x: number; z: number; radius: number; segments: number }
const key = (p: Point) => [p.x, p.y, p.z].join(',');
const edgeKey = (a: Point, b: Point) => [key(a), key(b)].sort().join('|');
export const pack = (positions: number[], indices: number[]): MeshData => ({ positions: new Float32Array(positions), indices: new Uint32Array(indices) });
export function join(meshes: MeshData[]): MeshData {
  const positions: number[] = [], indices: number[] = [];
  for (const m of meshes) { const offset = positions.length / 3; for (const p of m.positions) positions.push(p); for (const i of m.indices) indices.push(i + offset); }
  return pack(positions, indices);
}
export function vertices(m: MeshData, k: number): Point[] {
  return Array.from(m.indices.subarray(k, k + 3), id => ({ x: m.positions[id * 3], y: m.positions[id * 3 + 1], z: m.positions[id * 3 + 2] }));
}
export function circleCutter(circle: PlanCircle) {
  const points = Array.from({ length: circle.segments }, (_, i) => {
    const a = i / circle.segments * Math.PI * 2;
    return { x: Math.fround(circle.x + circle.radius * Math.cos(a)), y: 0, z: Math.fround(circle.z + circle.radius * Math.sin(a)) };
  });
  const planes = points.map((a, i) => { const b = points[(i + 1) % points.length]; return plane(b.z - a.z, 0, a.x - b.x, -(b.z - a.z) * a.x - (a.x - b.x) * a.z); });
  function split(m: MeshData) {
    const insideP: number[] = [], insideI: number[] = [], outsideP: number[] = [], outsideI: number[] = [];
    for (let k = 0; k < m.indices.length; k += 3) {
      const tri = vertices(m, k);
      if (planes.some(p => tri.every(v => value(p, v) > 2e-6))) { append(tri, outsideP, outsideI); continue; }
      let remaining = tri;
      for (const p of planes) {
        if (remaining.some(v => value(p, v) > 2e-6)) append(clip(remaining, flip(p)), outsideP, outsideI);
        remaining = clip(remaining, p); if (!remaining.length) break;
      }
      append(remaining, insideP, insideI);
    }
    return { inside: pack(insideP, insideI), outside: pack(outsideP, outsideI) };
  }
  return { points, planes, split };
}

interface Section { a: Point; b: Point; lo: number; hi: number }
function boundaryEdges(m: MeshData) {
  const edges = new Map<string, { a: Point; b: Point; count: number }>();
  for (let k = 0; k < m.indices.length; k += 3) {
    const tri = vertices(m, k);
    for (let i = 0; i < 3; i++) { const a = tri[i], b = tri[(i + 1) % 3], ek = edgeKey(a, b), e = edges.get(ek); if (e) e.count++; else edges.set(ek, { a, b, count: 1 }); }
  }
  return [...edges.values()].filter(e => e.count === 1);
}

// Top and bottom have different triangulations. Merge their exact straight
// section intervals on each polygon side, rather than resampling a smooth
// curve independently and leaving cracks between the owners.
export function closePlanCut(cutter: ReturnType<typeof circleCutter>, top: MeshData, bottom: MeshData[]) {
  const topEdges = boundaryEdges(top), bottomEdges = bottom.flatMap(boundaryEdges);
  const positions: number[] = [], indices: number[] = [];
  cutter.points.forEach((origin, i) => {
    const end = cutter.points[(i + 1) % cutter.points.length], pl = cutter.planes[i];
    const length = Math.hypot(end.x - origin.x, end.z - origin.z), dx = (end.x - origin.x) / length, dz = (end.z - origin.z) / length;
    function sections(edges: typeof topEdges) {
      const result: Section[] = [];
      for (const edge of edges) {
        if (Math.abs(value(pl, edge.a)) > 5e-5 || Math.abs(value(pl, edge.b)) > 5e-5) continue;
        let a = edge.a, b = edge.b, lo = (a.x - origin.x) * dx + (a.z - origin.z) * dz, hi = (b.x - origin.x) * dx + (b.z - origin.z) * dz;
        if (lo > hi) { [a, b] = [b, a]; [lo, hi] = [hi, lo]; }
        const start = Math.max(0, lo), stop = Math.min(length, hi);
        if (stop - start < 1e-6) continue;
        const lerp = (u: number): Point => {
          const t = (u - lo) / (hi - lo);
          return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
        };
        result.push({ a: lerp(start), b: lerp(stop), lo: start, hi: stop });
      }
      return result;
    }
    function at(s: Section, u: number): Point {
      if (Math.abs(u - s.lo) < 1e-7) return s.a;
      if (Math.abs(u - s.hi) < 1e-7) return s.b;
      const t = (u - s.lo) / (s.hi - s.lo);
      return { x: s.a.x + t * (s.b.x - s.a.x), y: s.a.y + t * (s.b.y - s.a.y), z: s.a.z + t * (s.b.z - s.a.z) };
    }
    const ups=sections(topEdges), lows=sections(bottomEdges);
    for (const upper of ups) for (const lower of lows) {
      const lo = Math.max(upper.lo, lower.lo), hi = Math.min(upper.hi, lower.hi);
      if (hi - lo < 1e-5) continue;
      const a = at(lower, lo), b = at(lower, hi), c = at(upper, hi), d = at(upper, lo);
      // The old plateau already fills zero-thickness parts of the cut.
      if (Math.max(d.y - a.y, c.y - b.y) < 2e-5) continue;
      append([a, b, c, d], positions, indices);
    }
  });
  return pack(positions, indices);
}
