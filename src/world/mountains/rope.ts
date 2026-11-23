import type { Point, MeshData } from './geometry';

export interface MountainRope {
  path: Point[];
  distances: number[];
  lower: Point;
  upper: Point;
}

export interface MountainRopeState { attached: boolean; direction: number }
export const createMountainRopeState = (): MountainRopeState => ({ attached: false, direction: 0 });
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t
});
const still = { x: 0, y: 0, z: 0 };

export function createMountainRope(lower: Point, upper: Point): MountainRope {
  // The capsule clears the edge before crossing it. Both landings support ordinary walking.
  const path = [lower, { x: lower.x, y: upper.y + 0.52, z: lower.z },
    { x: upper.x, y: upper.y + 0.52, z: upper.z + 0.34 }, upper];
  const distances = [0];
  for (let i = 1; i < path.length; i++) distances.push(distances[i - 1] + distance(path[i - 1], path[i]));
  return { lower, upper, path, distances };
}

function locate(rope: MountainRope, point: Point) {
  let along = 0, gap = Infinity;
  for (let i = 1; i < rope.path.length; i++) {
    const a = rope.path[i - 1], b = rope.path[i], length = rope.distances[i] - rope.distances[i - 1];
    const dot = (point.x-a.x)*(b.x-a.x) + (point.y-a.y)*(b.y-a.y) + (point.z-a.z)*(b.z-a.z);
    const t = Math.max(0, Math.min(1, dot / (length * length)));
    const dist = distance(point, lerp(a, b, t));
    if (dist < gap) { along = rope.distances[i - 1] + t * length; gap = dist; }
  }
  return { along, gap };
}

function ropePoint(rope: MountainRope, along: number) {
  const i = rope.distances.findIndex((d, j) => j > 0 && along <= d);
  if (i < 0) return rope.upper;
  return lerp(rope.path[i - 1], rope.path[i], (along - rope.distances[i - 1]) / (rope.distances[i] - rope.distances[i - 1]));
}

/** Feet are the capsule's actual location after the last physics step.
 * Caller applies displacement with its normal KCC. A blocked character never advances along the rope.
 */
export function stepMountainRope(rope: MountainRope, state: MountainRopeState, feet: Point,
  input: { interact: boolean; climb: number }, dt: number) {
  const seen = locate(rope, feet), end = rope.distances[rope.distances.length - 1];
  const nearby = seen.gap <= 1.45;
  const release = (hint: string) => ({ state: createMountainRopeState(), attached: false, displacement: still, hint });
  if (state.attached && (input.interact || seen.gap > 1.8)) return release('Канат отпущен');
  if (!state.attached && !(input.interact && nearby)) return release(nearby ? 'E · взяться за канат' : '');
  const move = Math.sign(input.climb);
  const direction = move || (state.attached ? state.direction : 0);
  if ((direction === 1 && distance(feet, rope.upper) < 0.10) ||
      (direction === -1 && distance(feet, rope.lower) < 0.10)) return release('Вы на площадке');
  const step = Math.max(0, Math.min(dt, 0.1)) * 2.0;
  // A small lookahead on the actual polyline allows the controller to turn the corner.
  const aim = ropePoint(rope, Math.max(0, Math.min(end, seen.along + (seen.gap > 0.18 ? 0 : move * step * 2))));
  const t = Math.min(1, step / Math.max(1e-9, distance(feet, aim)));
  const displacement = { x: (aim.x-feet.x)*t, y: (aim.y-feet.y)*t, z: (aim.z-feet.z)*t };
  return { state: { attached: true, direction }, attached: true, displacement, hint: 'W/S · по канату   E · отпустить' };
}

/** A segmented low-poly cable with a visible pin and tie at the top. Nonblocking decoration. */
export function ropeDecoration(rope: MountainRope): { line: MeshData; anchor: MeshData } {
  const shift = (p: Point, dx: number, dy: number, dz: number): Point =>
    ({x:p.x+dx, y:p.y+dy, z:p.z+dz});
  function tubes(segments: [Point,Point,number][]): MeshData {
    const positions: number[] = [], indices: number[] = [];
    for (const [a,b,r] of segments) {
      const dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dy,dz);
      const first = positions.length/3;
      for (const p of [a,b]) for (let k=0;k<6;k++) {
        const angle=k*Math.PI/3;
        positions.push(p.x+r*Math.cos(angle),p.y+r*dz/len*Math.sin(angle),p.z-r*dy/len*Math.sin(angle));
      }
      for(let k=0;k<6;k++) {
        const n=(k+1)%6;
        indices.push(first+k,first+n,first+6+n,first+k,first+6+n,first+6+k);
      }
      for(let k=1;k<5;k++) indices.push(first,first+k+1,first+k,first+6,first+6+k,first+6+k+1);
    }
    return {positions:new Float32Array(positions),indices:new Uint32Array(indices)};
  }
  const tie=shift(rope.upper,0,0.65,-0.15), lip=shift(rope.lower,0,rope.upper.y-rope.lower.y+0.30,-0.48);
  const tail=shift(rope.lower,0,0.36,-0.44);
  const line: [Point,Point,number][] = [[tail,lip,0.075],[lip,tie,0.075]];
  for(let y=tail.y+0.45;y<lip.y;y+=1.15) {
    const a=lerp(tail,lip,(y-tail.y)/(lip.y-tail.y));
    line.push([a,shift(a,0,0.092,0),0.11]);
  }
  return {line:tubes(line),anchor:tubes([[shift(tie,0,-0.85,-0.12),shift(tie,0,0.15,0.02),0.16],
    [shift(tie,0,-0.09,0),shift(tie,0,0.08,0),0.19]])};
}
