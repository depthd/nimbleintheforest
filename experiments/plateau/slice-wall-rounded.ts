// The camera and the plateau use the existing mountain frame. Local u is along
// the entrance shoulder and v increases out of the mountain.
import { Color, Vector3 } from 'three';
import { Rng } from '../../src/core/rng';

export type RoundedWallSite = {
  x: number;
  z: number;
  angle: number;
  width: number;
  height: number;
  groundAt: (x: number, z: number) => number;
};

type Point = { u: number; v: number; y: number };
type Mesh = { positions: number[]; indices: number[]; colors: number[] };
type Bounds = { minU: number; maxU: number; minV: number; maxV: number; minY: number; maxY: number };

export function buildRoundedWall(site: RoundedWallSite, count: 4 | 7 | 10, seed: number) {
  const rng = new Rng(seed ^ 0x5f77c1);
  const rock: Mesh = { positions: [], indices: [], colors: [] };
  const snow: Mesh = { positions: [], indices: [], colors: [] };
  const masses: Bounds[] = [];
  const cosine = Math.cos(site.angle);
  const sine = Math.sin(site.angle);
  const white = new Color(1, 1, 1);
  const palette = ['#6c7380', '#636b7a', '#626977', '#737682', '#686e7b'];
  function world({ u, v, y }: Point) {
    return new Vector3(site.x + cosine * u + sine * v, y, site.z + sine * u - cosine * v);
  }

  // Each triangle belongs to just one material. The common snow-line vertices
  // close the cap without overlaying two coincident rock and snow faces.
  function triangle(mesh: Mesh, a: Point, b: Point, c: Point, colour: Color) {
    const first = mesh.positions.length / 3;
    for (const p of [a, b, c]) {
      const w = world(p);
      mesh.positions.push(w.x, w.y, w.z);
      mesh.colors.push(colour.r, colour.g, colour.b);
    }
    mesh.indices.push(first, first + 1, first + 2);
  }

  // Bilateral bevels, not a subdivided sphere. The truncated shoulders and the
  // wide central face remain visible on the smallest preset.
  const outline = [
    [-0.48, -0.27], [-0.28, -0.48], [0.29, -0.48], [0.48, -0.24],
    [0.48, 0.26], [0.22, 0.49], [-0.26, 0.47], [-0.49, 0.23],
  ];
  const rear = count === 4 ? 4 : count === 7 ? 4 : 6;
  const rowCounts = count === 4 ? [rear] : [rear, count - rear];
  for (const [row, blocks] of rowCounts.entries()) {
    const weights = Array.from({ length: blocks }, () => rng.float(0.84, 1.13));
    const total = weights.reduce((s, w) => s + w, 0);
    let start = site.width * (row === 1 ? -0.44 : -0.5);
    const span = site.width * (row === 1 ? 0.88 : 1);
    for (const [i, weight] of weights.entries()) {
      const cell = span * weight / total;
      const middle = start + cell / 2;
      start += cell;
      const width = Math.min(site.width / 3, cell * 0.965);
      const forward = site.width * (count === 4 ? rng.float(0.30, 0.34) : row ? 0.507 : 0.258);
      const depth = site.width * (count === 4 ? rng.float(0.39, 0.47) : row ? 0.232 : 0.255);
      const bottom = -3;
      const height = site.height * (row ? rng.float(0.26, 0.44) :
        ((i % 3 === 1) ? rng.float(0.58, 0.73) : rng.float(0.72, 0.89)));
      const dip = rng.float(0.24, 0.42);
      const skew = rng.float(-0.09, 0.09);
      const corners = outline.map(([u, v]) => ({
        u: u * width * rng.float(0.93, 1.0),
        v: v * depth * rng.float(0.88, 1.0),
      }));
      const tint = new Color(rng.pick(palette));
      const rings: Point[][] = [];
      const ranges: Bounds = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity, minY: bottom, maxY: 0 };
      // The upper portion recedes inward. The flatter, snow-holding shoulder
      // therefore projects beyond the summit, especially on the camera side.
      for (const [scale, fraction, retreat] of [
        [0.93, 0, 0.01], [1.0, 0.40, 0.01], [0.91, 0.70, 0],
        [0.74, 0.83, -0.045], [0.48, 1.0, -0.12],
      ]) {
        const ring = corners.map(({ u, v }) => {
          const p = {
            u: middle + u * scale + width * skew * (1 - scale),
            v: forward + v * scale + depth * retreat,
            y: bottom + fraction * (height - bottom + skew * u - dip * v),
          };
          ranges.minU = Math.min(ranges.minU, p.u);
          ranges.maxU = Math.max(ranges.maxU, p.u);
          ranges.minV = Math.min(ranges.minV, p.v);
          ranges.maxV = Math.max(ranges.maxV, p.v);
          ranges.maxY = Math.max(ranges.maxY, p.y);
          return p;
        });
        rings.push(ring);
      }
      const base = { u: middle, v: forward + depth * 0.01, y: bottom };
      const crown = { u: middle + width * skew * 0.52, v: forward - depth * 0.12, y: height + depth * 0.035 };
      ranges.maxY = Math.max(ranges.maxY, crown.y);
      masses.push(ranges);
      for (let j = 0; j < corners.length; j++) {
        const k = (j + 1) % corners.length;
        triangle(rock, base, rings[0][k], rings[0][j], tint);
        for (let level = 0; level < rings.length - 1; level++) {
          const lo = rings[level], hi = rings[level + 1];
          for (const [a, b, c] of [[lo[j], lo[k], hi[k]], [lo[j], hi[k], hi[j]]]) {
            const normal = world(b).sub(world(a)).cross(world(c).sub(world(a))).normalize();
            const covered = level >= 2 && normal.y > 0.59;
            triangle(covered ? snow : rock, a, b, c, covered ? white : tint);
          }
        }
        const top = rings[rings.length - 1];
        triangle(snow, crown, top[j], top[k], white);
      }
    }
  }

  const capTriangleCount = snow.indices.length / 3;
  // Wind packs a low bank at the rock feet; its edge passes under the actual
  // terrain and the inner crest projects into the block. Separate small banks
  // reach the gaps between blocks, leaving stretches of exposed dark rock.
  for (const [i, mass] of masses.entries()) {
    const width = mass.maxU - mass.minU;
    const u = (mass.minU + mass.maxU) / 2 + width * rng.float(-0.18, 0.18);
    const v = mass.maxV + site.width * 0.008;
    const crest = Math.min(4.8, site.width * rng.float(0.029, 0.045));
    const reach = site.width * rng.float(0.055, 0.091);
    const radius = width * rng.float(0.60, 0.76);
    // Keep banks of the rear row within their own footprint when front blocks
    // stand in front of them; snow in these gaps is visible between the toes.
    const minor = i < rear && rowCounts.length > 1 ? reach * 0.68 : reach;
    const bankPoint = (u: number, v: number, lift: number) => {
      const p = { u, v, y: 0 };
      const w = world(p);
      p.y = site.groundAt(w.x, w.z) + lift;
      return p;
    };
    const center = bankPoint(u, v, crest);
    const edge = Array.from({ length: 12 }, (_, j) => {
      const a = 2 * Math.PI * j / 12;
      return bankPoint(u + radius * Math.cos(a), v + minor * Math.sin(a), -0.17);
    });
    const shoulder = edge.map(p => bankPoint(0.55 * p.u + 0.45 * u, 0.55 * p.v + 0.45 * v, crest * 0.60));
    for (let j = 0; j < edge.length; j++) {
      const k = (j + 1) % edge.length;
      triangle(snow, center, shoulder[j], shoulder[k], white);
      triangle(snow, shoulder[j], edge[j], edge[k], white);
      triangle(snow, shoulder[j], edge[k], shoulder[k], white);
    }
  }

  function pack(data: Mesh) {
    return { positions: Float32Array.from(data.positions), indices: Uint32Array.from(data.indices), colors: data.colors };
  }
  return { rock: pack(rock), snow: pack(snow), masses, capTriangleCount };
}
