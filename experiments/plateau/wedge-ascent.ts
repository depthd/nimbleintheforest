// Mode 1 cuts the accepted wedge sideways in plan. No height blending and no
// re-formed underside: the retained faces are portions of the accepted faces.
import { buildWedge } from './wedge-prototype';
import { plateauRadius } from './plateau-profile';
import { type SourceGrid, type Boundary } from './seam-boundary';
import { type Point, type MeshData, boundaryInMountain, append, clip, plane, flip } from './cavity';
import { ascent, profile, cutAscent, boundary, ascentCenter } from './ascent';
import { triangleVertexIndices } from './seam-safe-boundary';
import { circleCutter, closePlanCut, join, pack, type PlanCircle } from './wedge-plan-cut';

export interface PassageEnding { type: 1; circle: PlanCircle }
export const ascentEnding: PassageEnding = { type: 1, circle: { x: -300, z: ascentCenter(-235), radius: 100, segments: 256 } };

function sourceSurfaces(source: SourceGrid, seam: Boundary, attachment: Boundary) {
  const bandP: number[] = [], bandI: number[] = [], allP: number[] = [], allI: number[] = [];
  const E = new Map(seam.sourceTriangles.map((id, i) => [id, i]));
  const A = new Map(attachment.sourceTriangles.map((id, i) => [id, i]));
  function half(poly: Point[], boundary: Boundary, segment: number, inside: boolean) {
    const a = boundary.points[segment], b = boundary.points[(segment + 1) % boundary.points.length];
    const pl = plane(b.z - a.z, 0, a.x - b.x, -(b.z - a.z) * a.x - (a.x - b.x) * a.z);
    return clip(poly, inside ? pl : flip(pl)).map(p => {
      for (const joint of [a, b]) if (Math.hypot(p.x - joint.x, p.z - joint.z) < 5e-4) return joint;
      return p;
    });
  }
  for (let id = 0; id < source.n * source.n * 2; id++) {
    const tri = triangleVertexIndices(source, id).map(k => ({ x: source.x0 + k % (source.n + 1) * source.cell, y: source.heights[k], z: source.z0 + Math.floor(k / (source.n + 1)) * source.cell }));
    append(tri, allP, allI);
    const r = plateauRadius((tri[0].x + tri[1].x + tri[2].x) / 3, (tri[0].z + tri[1].z + tri[2].z) / 3), e = E.get(id), a = A.get(id);
    if (e === undefined && r < seam.radius || a === undefined && r > attachment.radius) continue;
    let poly = tri;
    if (e !== undefined) poly = half(poly, seam, e, false);
    if (a !== undefined) poly = half(poly, attachment, a, true);
    append(poly, bandP, bandI);
  }
  return { band: pack(bandP, bandI), full: pack(allP, allI) };
}

export function buildWedgeAscent(source: SourceGrid, upper: SourceGrid, ending = ascentEnding) {
  const accepted = buildWedge(source, upper), old = sourceSurfaces(source, accepted.seam, accepted.attachment);
  const cutter = circleCutter(ending.circle);
  const strip = cutter.split(accepted.strip).outside;
  const underside = cutter.split(accepted.underside).outside;
  // Reveal the old surface only where the added mask was cut away. It is
  // not a target for interpolating or lowering the retained upper face.
  const restored = cutter.split(old.band).inside;
  const side = closePlanCut(cutter, strip, [underside, restored]);
  const uncut = { plateau: accepted.plateau, strip, underside, flank: accepted.flank, restored, ending: side };
  const bounds = { minX: ascent.start, maxX: ascent.end, minZ: Math.min(...profile.map(p => p.z - p.w)), maxZ: Math.max(...profile.map(p => p.z + p.w)) };
  // The circular cut removes the mask beside the ascent. Its floor and walls
  // therefore retain the exact existing terrain and excavation profile.
  const interiors = [boundaryInMountain(old.full, boundary, bounds)];
  const end = profile[profile.length - 1];
  const endFace = [
    { x: end.x, y: end.y, z: end.z - end.w }, { x: end.x, y: end.y, z: end.z + end.w },
    { x: end.x, y: 180, z: end.z + end.w }, { x: end.x, y: 180, z: end.z - end.w },
  ];
  const left: number[] = [];
  for (let k = 0; k < old.full.indices.length; k += 3) {
    const ids = old.full.indices.subarray(k, k + 3);
    if (Math.min(...Array.from(ids, id => old.full.positions[id * 3])) < end.x - 1e-5) left.push(...ids);
  }
  interiors.push(boundaryInMountain({ positions: old.full.positions, indices: new Uint32Array(left) }, [endFace], bounds));
  const cut = { plateau: cutAscent(uncut.plateau), strip: cutAscent(strip), underside: cutAscent(underside), flank: cutAscent(uncut.flank), restored: cutAscent(restored), ending: cutAscent(side), interior: join(interiors) };
  return { accepted, uncut, cut, cutter: { points: cutter.points, circle: ending.circle }, ending };
}
