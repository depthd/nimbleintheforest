// Shared plan outline only. These are the existing plateau equations.
export const SLOPE_START = .96;
export function plateauOutline(a: number) {
  return 1 + .095 * Math.sin(a * 3 + .7) + .055 * Math.cos(a * 5 - .4);
}
export function plateauRadius(x: number, z: number) {
  return Math.hypot(x / 260, z / 180) / plateauOutline(Math.atan2(z / 180, x / 260));
}
export function contourPoint(a: number, radius = SLOPE_START) {
  const r = radius * plateauOutline(a);
  return { x: 260 * r * Math.cos(a), z: 180 * r * Math.sin(a) };
}
export function contourTangent(a: number, radius = SLOPE_START) {
  const r = radius * plateauOutline(a);
  const d = radius * (.285 * Math.cos(a * 3 + .7) - .275 * Math.sin(a * 5 - .4));
  return { x: 260 * (d * Math.cos(a) - r * Math.sin(a)), z: 180 * (d * Math.sin(a) + r * Math.cos(a)) };
}
