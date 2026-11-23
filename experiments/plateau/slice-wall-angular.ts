import { Color, Ray, Triangle, Vector3 } from 'three';
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

type Face = { vertices: Vector3[]; retention?: number[] };

// Sample the pile once from the fixed entrance-side direction. Hidden backs
// and buried courses must not increase the amount of snow on the front.
// This runs when a preset is built and has no dependency on the current camera.
function snowLine(faces: Face[], site: Site, tx: number, tz: number) {
  const u = -site.width * 0.91, v = site.width * 3.38;
  const eye = new Vector3(site.x + tx * u + tz * v, 1.50 * site.height, site.z + tz * u - tx * v);
  const outward = new Vector3(tz - 0.19 * tx, 0.07, -tx - 0.19 * tz).normalize();
  const right = new Vector3(outward.z, 0, -outward.x).normalize();
  const up = outward.clone().cross(right);
  const points = faces.flatMap(face => face.vertices).map(p => p.clone().sub(eye));
  const x = points.map(p => p.dot(right) / -p.dot(outward));
  const y = points.map(p => p.dot(up) / -p.dot(outward));
  const left = Math.min(...x), bottom = Math.min(...y);
  const width = Math.max(...x) - left, height = Math.max(...y) - bottom;
  const ray = new Ray(eye);
  const hit = new Vector3(), weights = new Vector3(), retention: number[] = [];
  const columns = 40, rows = 32;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < columns; j++) {
      ray.direction.copy(outward).negate()
        .addScaledVector(right, left + width * (j + 0.5) / columns)
        .addScaledVector(up, bottom + height * (i + 0.5) / rows).normalize();
      let closest = Infinity, deposit = -1;
      for (const face of faces) {
        const [a, b, c] = face.vertices;
        if (!ray.intersectTriangle(a, b, c, true, hit)) continue;
        const d = ray.origin.distanceToSquared(hit);
        if (d >= closest) continue;
        closest = d;
        deposit = -1;
        if (face.retention) {
          Triangle.getBarycoord(hit, a, b, c, weights);
          const [qa, qb, qc] = face.retention;
          deposit = weights.x * qa + weights.y * qb + weights.z * qc;
        }
      }
      if (closest < Infinity) retention.push(deposit);
    }
  }
  retention.sort((a, b) => b - a);
  return retention[Math.floor(retention.length * 0.25)] ?? 0;
}

function capAboveSnowLine(snow: Buffer, face: Face, threshold: number) {
  if (!face.retention) return;
  const patch: Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3, a = face.vertices[i], b = face.vertices[j];
    const qa = face.retention[i], qb = face.retention[j];
    if (qa >= threshold) patch.push(a.clone());
    if ((qa > threshold && qb < threshold) || (qa < threshold && qb > threshold)) {
      patch.push(a.clone().lerp(b, (threshold - qa) / (qb - qa)));
    }
  }
  if (patch.length < 3) return;
  const first = snow.positions.length / 3;
  for (const p of patch) {
    p.y += 0.055;
    addPoint(snow, p, white);
  }
  // All vertices have the same vertical offset from their supporting plane,
  // including the ends of every shared edge between two snow-bearing planes.
  for (let i = 1; i < patch.length - 1; i++) snow.indices.push(first, first + i, first + i + 1);
}

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
  const faces: Face[] = [];
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

      // Both ends of the ridge retain snow. Wind exposure varies around its
      // broken edge; the same vertex has the same value on adjoining planes.
      const wind = rng.float(-Math.PI, Math.PI);
      const retention = points.map((p, id) => {
        const pu = (p.x - site.x) * tx + (p.z - site.z) * tz;
        const pv = (p.x - site.x) * tz - (p.z - site.z) * tx;
        const exposure = Math.cos(wind) * (pu - u) / span + Math.sin(wind) * (pv - v) / depth;
        return (id >= 2 * n ? 0.82 : 0.38) + 0.34 * exposure + 0.20 * (p.y - base) / h;
      });
      for (let i = 0; i < tris.length; i += 3) {
        const ids = tris.slice(i, i + 3);
        const vertices = ids.map(id => points[id]);
        const [a, b, c] = vertices;
        const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        const roofFace = i >= tris.length - roof.length;
        const canHoldSnow = roofFace && normal.y > 0.46;
        faces.push({ vertices, retention: canHoldSnow ? ids.map(id => retention[id]) : undefined });
      }
      masses.push({
        firstTriangle: start, triangles: rock.indices.length / 3 - start,
        minU: u - span * 0.5, maxU: u + span * 0.5,
        minV: v - depth * 0.5, maxV: v + depth * 0.5,
      });
    }
  }
  const threshold = snowLine(faces, site, tx, tz);
  for (const face of faces) capAboveSnowLine(snow, face, threshold);
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
