// A trail along the north shoulder. Every cross-section goes from the foot of the
// exposed rock through the walking tread to a vertex shared with the original plateau.
import { smoothstep } from '../../core/rng';
import type { Point } from './geometry';

const START = -56;
const END = -14;
const STEP = 2; // match the first plateau's north edge exactly

type Buffer = { vertex(point: Point): number; indices: number[] };
type Section = [Point, Point, Point, Point];

export function shelfOwnsNorthWall(midX: number) {
  return midX > START && midX < END;
}

export function buildContourShelf(northEdge: (x: number) => Point, phase: number, rock: Buffer, snow: Buffer) {
  const rows: Section[] = [];
  const points: Point[] = [];
  for (let x = START; x <= END; x += STEP) {
    const join = northEdge(x);
    const taper = 1 - smoothstep(-22, END, x);
    const toeZ = join.z - (join.z + 41.4 - .45 * Math.sin(x * .28 + phase)) * taper;
    const depth = join.z - toeZ;
    const height = join.y * smoothstep(START, -24, x);
    const toe = { x, y: 0, z: toeZ };
    const lip = { x, y: height, z: toeZ + depth * (.22 + .025 * Math.sin(x * .31 + phase)) };
    const inner = { x, y: height, z: toeZ + depth * .67 };
    rows.push([toe, lip, inner, join]);

    if (x <= -18) {
      // Tread and bank meet at plateau height before the route turns onto the terrace.
      const centre = (lip.z + inner.z) * .5;
      const turn = smoothstep(-24, -18, x);
      points.push({ x, y: height, z: centre + (join.z - centre) * turn });
    }
  }
  points.push({ x: -16, y: northEdge(-16).y, z: -30 });

  // Keep boundary walls at both ends closed, and discard zero-area facets where the shelf
  // dies into the plateau. Rock and snow are both used for the actual collision surface.
  function triangle(buffer: Buffer, a: Point, b: Point, c: Point) {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-6) return;
    buffer.indices.push(buffer.vertex(a), buffer.vertex(b), buffer.vertex(c));
  }
  const first = rows[0], westFoot = { ...first[3], y: 0 };
  for (let col = 0; col < 3; col++) triangle(rock, westFoot, first[col + 1], first[col]);
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    for (let col = 0; col < 3; col++) {
      const steep = a[col + 1].y - a[col].y > (a[col + 1].z - a[col].z) * .65;
      const target = col === 0 || steep ? rock : snow;
      triangle(target, a[col], a[col + 1], b[col + 1]);
      triangle(target, a[col], b[col + 1], b[col]);
    }
  }

  /** Height of the same triangles used by Rapier. Outside the shelf the unchanged region takes over. */
  function sample(x: number, z: number) {
    if (x < START || x >= END || z < -42 || z > -24) return 0;
    const i = Math.floor((x - START) / STEP);
    const a = rows[i], b = rows[i + 1], t = (x - a[0].x) / STEP;
    for (let col = 0; col < 3; col++) {
      const outer = a[col], inner = a[col + 1], nextOuter = b[col], nextInner = b[col + 1];
      const lo = outer.z + t * (nextOuter.z - outer.z);
      const hi = inner.z + t * (nextInner.z - inner.z);
      if (z < lo || z > hi) continue;
      const diagonal = outer.z + t * (nextInner.z - outer.z);
      const along = outer.y + t * (nextInner.y - outer.y);
      if (z >= diagonal) return along + (z - diagonal) * (inner.y - outer.y) / (inner.z - outer.z);
      return along + (z - diagonal) * (nextInner.y - nextOuter.y) / (nextInner.z - nextOuter.z);
    }
    return 0;
  }
  return { points, sample };
}
