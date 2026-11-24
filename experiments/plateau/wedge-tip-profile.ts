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
// Preserve the last sixth of the old profile and its attachment. Above it,
// parameterize inward travel by depth: a finite bounded slope prevents a shelf.
export const undersideJoin = 5 / 6;
export function undersideSection(t: number, fullDepth: number, span: number, position: TipPosition, profile: TipProfile) {
  const thickness = profile.thickness(position), backset = profile.backset(position);
  if (thickness === 0 && backset === 0 || t >= undersideJoin) return { inwardFraction: Math.sqrt(t), depth: fullDepth * t };
  const length = fullDepth * undersideJoin - thickness;
  if (!(length > 0 && span > backset && thickness > 0)) throw Error('Tip dimensions exceed the available section');
  const startSlope = backset / thickness;
  const endSlope = span / (2 * fullDepth * Math.sqrt(undersideJoin));
  const meanSlope = (span * Math.sqrt(undersideJoin) - backset) / length;
  const ramp = .25;
  const middleSlope = (meanSlope - ramp * (startSlope + endSlope) / 2) / (1 - ramp);
  if (!(middleSlope > 0)) throw Error('Tip profile must move inward as it descends');
  // Integral of smoothstep: both the slope and its rate join continuously.
  const integral = (v: number) => v * v * v * (1 - v / 2);
  const u = t / undersideJoin;
  let travel: number;
  if (u < ramp) {
    const v = u / ramp;
    travel = ramp * (startSlope * v + (middleSlope - startSlope) * integral(v));
  } else {
    travel = ramp * (startSlope + middleSlope) / 2;
    if (u <= 1 - ramp) travel += middleSlope * (u - ramp);
    else {
      const v = (u - 1 + ramp) / ramp;
      travel += middleSlope * (1 - 2 * ramp) + ramp * (middleSlope * v + (endSlope - middleSlope) * integral(v));
    }
  }
  return { inwardFraction: (backset + length * travel) / span, depth: thickness + length * u };
}
