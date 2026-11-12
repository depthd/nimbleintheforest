// Isolated, uncut prototype. The top uses the source grid and its diagonals;
// splitting ownership at E does not change either half of a source face.
import { append, clip, plane, flip, type Point, type MeshData } from './cavity';
import { buildBoundary, sampleGrid, type Boundary, type SourceGrid } from './seam-boundary';
import { triangleVertexIndices } from './seam-safe-boundary';
import { sharpTip, lowerTip, undersideSection, undersideJoin, type TipProfile, type TipPosition } from './wedge-tip-profile';
import { plateauRadius, contourPoint } from './plateau-profile';

export const wedgeProfile = { seam: .9287, nose: 1.09, attachment: 1.005, undersideRows: 24 };
function storage() { return { positions: [] as number[], indices: [] as number[] }; }
function packed(s: ReturnType<typeof storage>): MeshData {
  return { positions: new Float32Array(s.positions), indices: new Uint32Array(s.indices) };
}
function vertex(grid: SourceGrid, k: number): Point {
  return { x: grid.x0 + k % (grid.n + 1) * grid.cell, y: grid.heights[k], z: grid.z0 + Math.floor(k / (grid.n + 1)) * grid.cell };
}
function edgeMap(boundary: Boundary) {
  const map = new Map<number, number>();
  boundary.sourceTriangles.forEach((triangle, i) => {
    if (map.has(triangle)) throw Error('Prototype requires one contour segment per source triangle');
    map.set(triangle, i);
  });
  return map;
}
function half(poly: Point[], boundary: Boundary, segment: number, inside: boolean) {
  const a = boundary.points[segment], b = boundary.points[(segment + 1) % boundary.points.length];
  // Positive xz winding: the inside lies left of a -> b.
  const pl = plane(b.z - a.z, 0, a.x - b.x, -(b.z - a.z) * a.x - (a.x - b.x) * a.z);
  return clip(poly, inside ? pl : flip(pl)).map(p => {
    // Both owners use the same canonical Float32 joints, not separate roundoff.
    for (const joint of [a, b]) if (Math.hypot(p.x - joint.x, p.z - joint.z) < 5e-4) return joint;
    return p;
  });
}

export function buildWedge(source: SourceGrid, upper: SourceGrid, tip: TipProfile = sharpTip) {
  const seam = buildBoundary(source, wedgeProfile.seam), nose = buildBoundary(upper, wedgeProfile.nose);
  const attachment = buildBoundary(source, wedgeProfile.attachment);
  const E = edgeMap(seam), N = edgeMap(nose), A = edgeMap(attachment);
  const plateau = storage(), strip = storage(), flank = storage(), underside = storage(), front = storage();
  for (let id = 0; id < source.n * source.n * 2; id++) {
    const ids = triangleVertexIndices(source, id), tri = ids.map(k => vertex(upper, k));
    const center = { x: (tri[0].x + tri[1].x + tri[2].x) / 3, z: (tri[0].z + tri[1].z + tri[2].z) / 3 };
    const radius = plateauRadius(center.x, center.z), e = E.get(id), n = N.get(id), a = A.get(id);
    if (e !== undefined) {
      append(half(tri, seam, e, true), plateau.positions, plateau.indices);
      append(half(tri, seam, e, false), strip.positions, strip.indices);
    } else if (radius < seam.radius) append(tri, plateau.positions, plateau.indices);
    else if (n !== undefined) append(half(tri, nose, n, true), strip.positions, strip.indices);
    else if (radius < nose.radius) append(tri, strip.positions, strip.indices);
    const old = ids.map(k => vertex(source, k));
    if (a !== undefined) append(half(old, attachment, a, false), flank.positions, flank.indices);
    else if (radius > attachment.radius) append(old, flank.positions, flank.indices);
  }

  // Bridge ordered rings without resampling their boundary edges: different
  // point counts at the nose and old wall cause no T junctions.
  function bridge(a: Point[], aa: number[], b: Point[], ba: number[]) {
    let i = 0, j = 0;
    const emit = (p: Point, q: Point, r: Point) => append([p, q, r], underside.positions, underside.indices);
    while (i < a.length || j < b.length) {
      const ai = i % a.length, bj = j % b.length;
      const nextA = aa[(i + 1) % a.length] + (i + 1 >= a.length ? Math.PI * 2 : 0);
      const nextB = ba[(j + 1) % b.length] + (j + 1 >= b.length ? Math.PI * 2 : 0);
      if (j === b.length || (i < a.length && nextA <= nextB)) {
        emit(a[ai], a[(i + 1) % a.length], b[bj]); i++;
      } else { emit(a[ai], b[(j + 1) % b.length], b[bj]); j++; }
    }
  }
  // Preserve the top nose; an optional lower corner gives the tip thickness.
  // The top reaches the nose unchanged; the underside alone turns back.
  const tipPositions: TipPosition[] = nose.points.map((p, i) => {
    const a = nose.angles[i], e = contourPoint(a, wedgeProfile.seam);
    return { angle: a, alongEdge: a / (Math.PI * 2), x: p.x, z: p.z, distanceToE: Math.hypot(p.x - e.x, p.z - e.z) };
  });
  const tipCorner = nose.points.map((p, i) => lowerTip(p, tipPositions[i], tip));
  function sectionRow(row: number) {
    const t = row / wedgeProfile.undersideRows;
    return nose.points.map((_, i) => {
      const a = nose.angles[i], q = contourPoint(a, wedgeProfile.attachment);
      const wall = buildWallHeight(source, q.x, q.z);
      const depth = buildWallHeight(upper, q.x, q.z) - wall;
      const section = undersideSection(t, depth, Math.hypot(nose.points[i].x - q.x, nose.points[i].z - q.z), tipPositions[i], tip);
      const radius = wedgeProfile.nose + (wedgeProfile.attachment - wedgeProfile.nose) * section.inwardFraction;
      const xz = contourPoint(a, radius);
      return { ...xz, y: buildWallHeight(upper, xz.x, xz.z) - section.depth };
    });
  }
  const lowerNose = tipCorner;
  for (let i = 0; i < nose.points.length; i++) {
    const j = (i + 1) % nose.points.length;
    append([nose.points[i], nose.points[j], lowerNose[j], lowerNose[i]], front.positions, front.indices);
  }
  let ring = lowerNose, angles = nose.angles;
  const step = tipCorner.some((p, i) => p.y !== nose.points[i].y) ? .5 : 1;
  for (let row = step; row < wedgeProfile.undersideRows; row += row < undersideJoin * wedgeProfile.undersideRows ? step : 1) {
    const next = sectionRow(row);
    bridge(ring, angles, next, nose.angles); ring = next; angles = nose.angles;
  }
  bridge(ring, angles, attachment.points, attachment.angles);
  return { plateau: packed(plateau), strip: packed(strip), flank: packed(flank), underside: packed(underside), front: packed(front), tip, seam, nose, tipCorner, lowerNose, attachment };
}
function buildWallHeight(grid: SourceGrid, x: number, z: number) { return sampleGrid(grid, x, z).y; }
