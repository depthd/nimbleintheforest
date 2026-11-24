import { stream } from './range-seed';
function contourParameters(attempt:number){
  const shape=stream(attempt===0?'outline':'outline '+attempt);
  return {three:shape.float(.075,.109),five:shape.float(.039,.059),
    phase3:shape.float(.13,1.09),phase5:shape.float(-.86,.03)};
}
let shape=contourParameters(0);
export function selectOutline(attempt:number){shape=contourParameters(attempt);}
export const SLOPE_START = .96;
export function plateauOutline(a: number) {
  const {three,five,phase3,phase5}=shape;
  return 1 + three * Math.sin(a * 3 + phase3) + five * Math.cos(a * 5 + phase5);
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
  const {three,five,phase3,phase5}=shape;
  const d = radius * (3 * three * Math.cos(a * 3 + phase3) - 5 * five * Math.sin(a * 5 + phase5));
  return { x: 260 * (d * Math.cos(a) - r * Math.sin(a)), z: 180 * (d * Math.sin(a) + r * Math.cos(a)) };
}
