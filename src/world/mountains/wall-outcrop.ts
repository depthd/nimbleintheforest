import { IcosahedronGeometry, Vector3 } from 'three';
import { Rng, smoothstep } from '../../core/rng';

type Cut = { n: Vector3; d: number; round: number };
type Shell = { points: Vector3[]; indices: number[] };
export type OutcropShape = {
  x: number;
  z: number;
  angle: number;
  width: number;
  depth: number;
  height: number;
  base: number;
  lean: number;
  rake: number;
  crown: number;
  wear?: number;
};

// All stones use the same indexed sampling directions. Shared samples keep
// the worn shoulders and the edge of a snow patch continuous across triangles.
function samplingSphere(detail: number): Shell {
  const source = new IcosahedronGeometry(1, detail);
  const pos = source.getAttribute('position');
  const points: Vector3[] = [],
    indices: number[] = [],
    ids = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const p = new Vector3().fromBufferAttribute(pos, i);
    const key = [p.x, p.y, p.z].map((v) => Math.round(v * 1e5)).join(',');
    let id = ids.get(key);
    if (id === undefined) {
      id = points.length;
      ids.set(key, id);
      points.push(p.normalize());
    }
    indices.push(id);
  }
  source.dispose();
  return { points, indices };
}
const largeSphere = samplingSphere(3),
  smallSphere = samplingSphere(2);

function plane(x: number, y: number, z: number, offset: number, round: number): Cut {
  const n = new Vector3(x, y, z),
    len = n.length();
  return { n: n.divideScalar(len), d: offset / len, round };
}

// Intersect weathered joint planes. Only the neighborhood of an arris is
// rounded: the middle of a large fracture remains a plane at every resolution.
function stoneField(p: Vector3, planes: Cut[]) {
  let d = -Infinity;
  for (const cut of planes) {
    const q = cut.n.dot(p) - cut.d;
    const h = Math.max(cut.round - Math.abs(d - q), 0);
    d = Math.max(d, q) + (h * h) / (4 * cut.round);
  }
  return d;
}

function snowPatch(rock: Shell, depth: number, wind: Vector3, exposure: number[]): Shell {
  const normals = rock.points.map(() => new Vector3());
  const normal = new Vector3(),
    edge = new Vector3();
  for (let k = 0; k < rock.indices.length; k += 3) {
    const [i, j, l] = rock.indices.slice(k, k + 3);
    normal.subVectors(rock.points[j], rock.points[i]).cross(edge.subVectors(rock.points[l], rock.points[i]));
    normals[i].add(normal);
    normals[j].add(normal);
    normals[l].add(normal);
  }
  const coverage = normals.map((n, i) => {
    n.normalize();
    return n.y - 0.71 - 0.13 * n.dot(wind) - 0.9 * (1 - exposure[i]);
  });
  const points: Vector3[] = [],
    indices: number[] = [],
    ids = new Map<number, number>();
  function sample(i: number, j: number) {
    const a = Math.min(i, j),
      b = Math.max(i, j),
      key = a * rock.points.length + b;
    let id = ids.get(key);
    if (id !== undefined) return id;
    const t = i === j ? 0 : coverage[a] / (coverage[a] - coverage[b]);
    const p = rock.points[a].clone().lerp(rock.points[b], t);
    const n = normals[a].clone().lerp(normals[b], t).normalize();
    const lift = 0.028 + depth * smoothstep(0, 0.34, i === j ? coverage[i] : 0) * (1 - 0.45 * n.dot(wind));
    p.addScaledVector(n, lift);
    id = points.length;
    points.push(p);
    ids.set(key, id);
    return id;
  }
  for (let k = 0; k < rock.indices.length; k += 3) {
    const polygon: number[] = [];
    for (let side = 0; side < 3; side++) {
      const a = rock.indices[k + side],
        b = rock.indices[k + ((side + 1) % 3)];
      if (coverage[a] > 0) polygon.push(sample(a, a));
      if (coverage[a] > 0 !== coverage[b] > 0) polygon.push(sample(a, b));
    }
    for (let j = 1; j + 1 < polygon.length; j++) indices.push(polygon[0], polygon[j], polygon[j + 1]);
  }
  return { points, indices };
}

export function wallOutcrop(s: OutcropShape, corners: number[][], seed: number) {
  const sphere = s.width > 38 || s.height > 42 ? largeSphere : smallSphere;
  const rng = new Rng(seed),
    planes: Cut[] = [];
  const wear = s.wear ?? 0.55;
  const leanX = rng.float(-0.42, 0.34),
    leanZ = rng.float(-0.38, 0.24);
  planes.push(plane(leanX, 1, leanZ, 0.97, 0.045 + 0.12 * wear), plane(0, -1, 0, 1, 0.08));
  const front = rng.int(0, corners.length - 1);
  for (const [i, corner] of corners.entries()) {
    const next = corners[(i + 1) % corners.length];
    const x = (2 * corner[0]) / s.width,
      z = (2 * corner[1]) / s.depth;
    const dx = (2 * next[0]) / s.width - x,
      dz = (2 * next[1]) / s.depth - z,
      len = Math.hypot(dx, dz);
    const nx = dz / len,
      nz = -dx / len,
      reach = nx * x + nz * z;
    const dip = 0.08 + corner[2];
    const round = (i === front ? 0.035 : 0.07 + 0.14 * wear) * corner[3];
    planes.push(plane(nx, dip, nz, reach, round));
    // Independent shoulder heights cut through some joints and die into others.
    const shoulder = rng.float(0.33, 0.94),
      pitch = rng.float(0.55, 1.05);
    planes.push(plane(nx, dip + pitch, nz, reach + pitch * shoulder, 0.052 + wear * 0.13));
  }
  // A fresh oblique break truncates one of the old rounded shoulders.
  const chipAngle = rng.float(-0.85, 0.85);
  planes.push(
    plane(Math.sin(chipAngle), rng.float(-0.48, 0.55), Math.cos(chipAngle), rng.float(0.63, 0.88), 0.025),
  );
  const split = s.height > 46 && s.width > 36 && rng.chance(0.54);
  const crack = plane(1, rng.float(-0.64, 0.56), rng.float(-0.62, 0.5), rng.float(-0.16, 0.17), 0.034);
  const c = Math.cos(s.angle),
    sn = Math.sin(s.angle);
  const wind = new Vector3(0.78, 0, -0.63);
  return (split ? [-1, 1] : [0]).map((side) => {
    const center = new Vector3(),
      cuts = planes.slice();
    if (side) {
      const n = crack.n.clone().multiplyScalar(-side);
      cuts.push({ n, d: -side * crack.d - 0.01, round: crack.round });
      center.copy(crack.n).multiplyScalar(crack.d + side * 0.33);
    }
    // Start inside the convex fragment. Its sharp half-space intersection
    // gives an upper bound, then refine just the rounded shoulder.
    const p = new Vector3();
    // The same weathering trace runs through both fragments in parent-rock space.
    const phase = (Math.abs(seed % 701) / 701) * Math.PI * 2;
    const bedHeight = 0.18 * Math.sin(phase);
    const bedSlope = 0.4 + 0.22 * Math.cos(phase);
    const clearance: number[] = [],
      exposure: number[] = [];
    // Slip along the joint plane. A vertical offset alone can push one face
    // back through its neighbor on an inclined fracture.
    const slip = new Vector3();
    if (side === 1) {
      slip.set(0, -0.056, 0.045);
      slip.addScaledVector(crack.n, -slip.dot(crack.n));
    }
    const points = sphere.points.map((dir) => {
      let high = Infinity;
      for (const cut of cuts) {
        const speed = cut.n.dot(dir);
        if (speed > 0.00001) high = Math.min(high, (cut.d - cut.n.dot(center)) / speed);
      }
      p.copy(center).addScaledVector(dir, high);
      if (stoneField(p, cuts) > 0.0001) {
        let low = 0;
        for (let iter = 0; iter < 11; iter++) {
          const mid = (low + high) / 2;
          p.copy(center).addScaledVector(dir, mid);
          if (stoneField(p, cuts) > 0) high = mid;
          else low = mid;
        }
        p.copy(center).addScaledVector(dir, (low + high) / 2);
      }
      const distanceInside = side ? side * (crack.n.dot(p) - crack.d) : 1;
      clearance.push(distanceInside);
      exposure.push(smoothstep(0.015, 0.09, distanceInside));
      const bed = p.y - bedSlope * p.x - bedHeight + 0.15 * p.z;
      const exposedFace = smoothstep(-0.08, 0.55, p.z) * smoothstep(0.015, 0.2, distanceInside);
      // A ledge tapers along the front of the stone. Its projecting lower lip
      // and recessed joint above it share an oblique bedding direction.
      const lens = Math.max(0, 1 - ((p.x + 0.15 * Math.cos(phase)) / 1.12) ** 2);
      const lip = Math.max(0, 1 - Math.abs((bed + 0.29) / 0.39));
      const hollow = Math.max(0, 1 - Math.abs((bed - 0.085) / 0.29));
      p.z += exposedFace * lens * (0.22 * lip - 0.25 * hollow);
      p.add(slip);
      const t = (p.y + 1) * 0.5,
        du = p.x * s.width * 0.5 + s.rake * t,
        dv = p.z * s.depth * 0.5 + s.lean * t;
      return new Vector3(s.x + c * du + sn * dv, s.base + t * s.height, s.z + sn * du - c * dv);
    });
    const indices: number[] = [];
    // The local outward axis and strike form a left-handed horizontal frame.
    for (let k = 0; k < sphere.indices.length; k += 3)
      indices.push(sphere.indices[k], sphere.indices[k + 2], sphere.indices[k + 1]);
    const rock = { points, indices };
    return { rock, clearance, snow: snowPatch(rock, s.crown, wind, exposure) };
  });
}
