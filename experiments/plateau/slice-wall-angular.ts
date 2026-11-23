import { Color, Vector3 } from 'three';
import { Rng } from '../../src/core/rng';

type Site = {
  x: number;
  z: number;
  angle: number;
  width: number;
  height: number;
  groundAt: (x: number, z: number) => number;
};

type Mass = {
  firstTriangle: number;
  triangles: number;
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
};

type Buffer = { positions: number[]; indices: number[]; colors: number[] };

function buffer(): Buffer {
  return { positions: [], indices: [], colors: [] };
}

function addPoint(mesh: Buffer, point: Vector3, color: Color) {
  const index = mesh.positions.length / 3;
  mesh.positions.push(point.x, point.y, point.z);
  mesh.colors.push(color.r, color.g, color.b);
  return index;
}

function pack(mesh: Buffer) {
  return {
    positions: Float32Array.from(mesh.positions),
    indices: Uint32Array.from(mesh.indices),
    colors: mesh.colors,
  };
}

const palette = ['#565e6e', '#677182', '#666a78', '#747782', '#5c626e'];
const white = new Color(1, 1, 1);

// A talus fan in three dimensions. The rear line carries the tall, tilted
// blocks; successive courses occupy the pockets below them toward the toe.
export function buildAngularWall(site: Site, count: number, seed: number) {
  if (![5, 8, 12].includes(count)) throw new RangeError('Angular wall presets are 5, 8 and 12.');
  const rng = new Rng(seed ^ 0x58ee46), rock = buffer(), snow = buffer();
  const rows = count === 5 ? [3, 2] : count === 8 ? [3, 3, 2] : [4, 4, 4];
  const tx = Math.cos(site.angle), tz = Math.sin(site.angle);
  function point(u: number, v: number, y: number) {
    return new Vector3(site.x + tx * u + tz * v, y, site.z + tz * u - tx * v);
  }
  const masses: Mass[] = [];
  // Each row has shared cell boundaries. Its fracture planes stay inside
  // those cells, including at the widest seam between adjacent boulders.
  const maxDepth = site.width * 0.84;
  const rowDepth = maxDepth / rows.length;
  for (const [row, columns] of rows.entries()) {
    const phase = row / (rows.length - 1);
    const shift = (row % 2 ? -1 : 1) * site.width * 0.028;
    const rowWidth = site.width * (columns === 2 ? 0.67 : 0.94);
    const cellWidth = rowWidth / columns;
    const boundaries = Array.from({ length: columns + 1 }, (_, i) =>
      shift - rowWidth / 2 + i * cellWidth +
      (i > 0 && i < columns ? rng.float(-0.04, 0.04) * cellWidth : 0));
    for (let col = 0; col < columns; col++) {
      const lo = boundaries[col], hi = boundaries[col + 1];
      const span = Math.min(hi - lo, site.width / 3) * rng.float(0.95, 0.997);
      const u = (lo + hi) / 2;
      const v = rowDepth * (row + 0.5) + site.width * 0.02;
      const depth = rowDepth * rng.float(0.9, 0.985);
      const h = site.height * (0.67 - 0.43 * phase) * rng.float(0.67, 1.16);
      const shoulder = rng.float(0.38, 0.65);
      const shoulderTip = rng.float(-0.27, 0.27);
      const outline = [
        [-0.50, rng.float(-0.36, -0.17)], [rng.float(-0.33, 0.04), -0.50],
        [0.49, rng.float(-0.38, -0.18)], [rng.float(0.28, 0.49), rng.float(0.12, 0.36)],
        [rng.float(-0.06, 0.23), 0.50], [-0.48, rng.float(0.13, 0.38)],
      ];
      const ground = (du: number, dv: number) => {
        const p = point(u + du, v + dv, 0);
        return site.groundAt(p.x, p.z);
      };
      const base = Math.min(...outline.map(([x, z]) => ground(x * span, z * depth))) - 1.8;
      const tint = new Color(rng.pick(palette));
      const points: Vector3[] = [];
      const tris: number[] = [];
      for (const [x, z] of outline) {
        points.push(point(u + x * span * 0.81, v + z * depth * 0.84, base));
      }
      for (const [x, z] of outline) {
        const height = shoulder + shoulderTip * x - 0.17 * z + rng.float(-0.07, 0.07);
        points.push(point(u + x * span, v + z * depth, base + h * height));
      }
      // A diagonal fracture ridge meets the broken eaves. There is no level
      // cap: its two ends can differ by a third of the whole boulder's height.
      const ridgeSlope = rng.pick([-1, 1]) * rng.float(0.11, 0.25);
      const ridgeDepth = rng.float(-0.16, 0.03);
      const ridgeTwist = rng.float(-0.12, 0.12);
      points.push(
        point(u - span * rng.float(0.26, 0.43), v + (ridgeDepth + ridgeTwist) * depth, base + h * (0.86 + ridgeSlope)),
        point(u + span * rng.float(0.17, 0.39), v + (ridgeDepth - ridgeTwist) * depth, base + h * (0.86 - ridgeSlope)),
      );
      const n = outline.length;
      for (let i = 1; i < n - 1; i++) tris.push(0, i + 1, i);
      for (let i = 0; i < n; i++) {
        const a = i, b = (i + 1) % n;
        tris.push(a, b, b + n, a, b + n, a + n);
      }
      const roof = [
        0, 1, 6,  1, 2, 7,  1, 7, 6,  2, 3, 7,
        3, 4, 7,  4, 6, 7,  4, 5, 6,  5, 0, 6,
      ];
      for (const index of roof) tris.push(n + index);
      const start = rock.indices.length / 3;
      const offset = rock.positions.length / 3;
      for (const p of points) addPoint(rock, p, tint);
      for (const index of tris) rock.indices.push(offset + index);

      // Snow accumulates across neighboring upward planes. Keep their inner
      // edges welded; only the exposed margin retreats toward the face.
      const planes: { ids: number[]; mid: Vector3; altitude: number }[] = [];
      const edgeOwners = new Map<string, number>();
      const edgeKey = (a: number, b: number) => a < b ? a + ',' + b : b + ',' + a;
      for (let i = 0; i < roof.length; i += 3) {
        const ids = roof.slice(i, i + 3);
        const [a, b, c] = ids.map(id => points[n + id]);
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        const altitude = normal.length() / Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
        if (altitude < 0.35 || normal.normalize().y < 0.54) continue;
        planes.push({ ids, mid: a.clone().add(b).add(c).multiplyScalar(1 / 3), altitude });
        for (let k = 0; k < 3; k++) {
          const key = edgeKey(ids[k], ids[(k + 1) % 3]);
          edgeOwners.set(key, (edgeOwners.get(key) || 0) + 1);
        }
      }
      for (const { ids, mid, altitude } of planes) {
        const center = mid.clone();
        center.y += Math.min(0.39, altitude * 0.045);
        const first = addPoint(snow, center, white);
        const loop: number[] = [];
        for (let k = 0; k < 3; k++) {
          const id = ids[k], next = ids[(k + 1) % 3];
          const a = points[n + id], b = points[n + next];
          const corner = a.clone();
          corner.y += 0.06;
          loop.push(addPoint(snow, corner, white));
          const margin = a.clone().lerp(b, 0.5);
          if (edgeOwners.get(edgeKey(id, next)) === 1) {
            margin.lerp(mid, rng.float(0.23, 0.52));
            margin.y += 0.015;
          } else {
            margin.y += 0.11;
          }
          loop.push(addPoint(snow, margin, white));
        }
        for (let k = 0; k < loop.length; k++) {
          snow.indices.push(first, loop[k], loop[(k + 1) % loop.length]);
        }
      }
      masses.push({
        firstTriangle: start, triangles: rock.indices.length / 3 - start,
        minU: u - span * 0.5, maxU: u + span * 0.5,
        minV: v - depth * 0.5, maxV: v + depth * 0.5,
      });
    }
  }
  // A low snow bank fills the crevices at ground level. Radial ends dip
  // below the actual ground, so the bank has no open visible hem.
  const snowWallIndexCount = snow.indices.length;
  const footV = maxDepth * 0.93;
  const bankOffset = snow.positions.length / 3;
  const bankProfile = [
    [-rowDepth * 0.71, -0.35], [-rowDepth * 0.32, 2.4], [0.1, 3.1],
    [rowDepth * 0.24, 1], [rowDepth * 0.50, -0.35],
  ];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, u = (t - 0.5) * site.width * 1.02;
    const taper = Math.sin(t * Math.PI);
    const crest = footV + Math.sin(t * 13) * rowDepth * 0.13;
    for (const [distance, height] of bankProfile) {
      const p = point(u, crest + distance, 0);
      p.y = site.groundAt(p.x, p.z) - 0.30 + taper * height;
      addPoint(snow, p, white);
    }
  }
  for (let i = 0; i < 16; i++) {
    for (let k = 0; k < bankProfile.length - 1; k++) {
      const a = bankOffset + i * bankProfile.length + k, b = a + bankProfile.length;
      snow.indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  return { rock: pack(rock), snow: pack(snow), masses, snowWallIndexCount };
}
