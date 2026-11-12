import { type Point } from './cavity';
export interface TipPosition {
  angle: number; alongEdge: number; x: number; z: number;
  distanceToE: number; distanceToPassage?: number;
}
export interface TipProfile {
  thickness(position: TipPosition): number;
  backset(position: TipPosition): number;
}
export const sharpTip: TipProfile = { thickness: () => 0, backset: () => 0 };
export const bluntTip: TipProfile = { thickness: () => 4, backset: () => .5 };
export function lowerTip(p: Point, position: TipPosition, profile: TipProfile): Point {
  const backset = profile.backset(position), length = Math.hypot(p.x, p.z);
  return { x: p.x - backset * p.x / length, y: p.y - profile.thickness(position), z: p.z - backset * p.z / length };
}
// Only the first quarter of the underside changes. Beyond the join the old
// section is returned exactly; the upper face and the lower attachment stay.
export function undersideDepth(t: number, fullDepth: number, span: number, position: TipPosition, profile: TipProfile) {
  const thickness = profile.thickness(position), backset = profile.backset(position);
  if (thickness === 0 && backset === 0) return fullDepth * t;
  const s = Math.sqrt(t), start = backset / span;
  const end = Math.max(.5, Math.sqrt((thickness + 1) / fullDepth));
  if (!(fullDepth > thickness + 1) || start >= end) throw Error('Tip dimensions exceed the available section');
  if (s >= end) return fullDepth * t;
  const u = Math.max(0, (s - start) / (end - start)), u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * thickness + (-2 * u3 + 3 * u2) * fullDepth * end * end
    + (u3 - u2) * 2 * fullDepth * end * (end - start);
}
