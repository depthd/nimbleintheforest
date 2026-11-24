// Mode 1 sweeps the accepted profile back inside the plateau in plan.
// The upper grid stays fixed; the lower profile travels with the nose.
import { sharpTip, type TipProfile } from './wedge-tip-profile';
import { buildWedge } from './wedge-prototype';
import { type SourceGrid } from './seam-boundary';
import { type MeshData, boundaryInMountain } from './cavity';
import { ascent, profile, cutAscent, boundary } from './ascent';
import { join, pack } from './wedge-plan-cut';
import { buildSweptEnding, sweptEnding, type SweptEnding } from './wedge-swept-ending';

export type PassageEnding = SweptEnding;
export const ascentEnding = sweptEnding;

function sourceSurface(source: SourceGrid): MeshData {
  const positions = new Float32Array(source.heights.length * 3), indices: number[] = [], stride = source.n + 1;
  for (let k = 0; k < source.heights.length; k++) positions.set([source.x0 + k % stride * source.cell, source.heights[k], source.z0 + Math.floor(k / stride) * source.cell], k * 3);
  for (let j = 0; j < source.n; j++) for (let i = 0; i < source.n; i++) { const a = j * stride + i; indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1); }
  return { positions, indices: new Uint32Array(indices) };
}

export function buildWedgeAscent(source: SourceGrid, upper: SourceGrid, ending = ascentEnding, tip: TipProfile = sharpTip) {
  const accepted = buildWedge(source, upper, tip), old = sourceSurface(source);
  const swept = buildSweptEnding(source, upper, accepted, ending);
  const { strip, underside, flank, restored } = swept;
  const uncut = { plateau: accepted.plateau, strip, underside, flank, restored, ending: pack([], []) };
  const bounds = { minX: ascent.start, maxX: ascent.end, minZ: Math.min(...profile.map(p => p.z - p.w)), maxZ: Math.max(...profile.map(p => p.z + p.w)) };
  // The profile is buried inside the plateau beside the ascent. Its floor
  // and walls retain the existing terrain and excavation profile.
  const interiors = [boundaryInMountain(old, boundary, bounds)];
  const end = profile[profile.length - 1];
  const endFace = [
    { x: end.x, y: end.y, z: end.z - end.w }, { x: end.x, y: end.y, z: end.z + end.w },
    { x: end.x, y: 180, z: end.z + end.w }, { x: end.x, y: 180, z: end.z - end.w },
  ];
  const left: number[] = [];
  for (let k = 0; k < old.indices.length; k += 3) {
    const ids = old.indices.subarray(k, k + 3);
    if (Math.min(...Array.from(ids, id => old.positions[id * 3])) < end.x - 1e-5) left.push(...ids);
  }
  interiors.push(boundaryInMountain({ positions: old.positions, indices: new Uint32Array(left) }, [endFace], bounds));
  const cut = { plateau: cutAscent(uncut.plateau), strip: cutAscent(strip), underside: cutAscent(underside), flank: cutAscent(flank), restored: cutAscent(restored), ending: cutAscent(uncut.ending), interior: join(interiors) };
  return { accepted, uncut, cut, nose: swept.nose, sweptUnder: swept.sweptUnder, weight: swept.weight, ending };
}
