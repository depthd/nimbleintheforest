import { Color, Vector3 } from 'three';
import { Rng, Simplex2, smoothstep } from '../../src/core/rng';
import { ascentSample } from './ascent';
import { ascentEnding } from './wedge-ascent';
import { contourTangent, plateauRadius } from './plateau-profile';

const noise = new Simplex2(new Rng(91842).next);
const tau = Math.PI * 2;

// Return the edge to the shoulder where the original terrain starts descending.
export const mountainEnding = { ...ascentEnding, buriedNose: 0.975 };

export const mountainSnowProfile = {
  edge: 4.8,
  radius: 3.8,
  overhang: 4.2,
  interiorStepM: 5.7,
  edgeStepM: 1.55,
};

export function plateauTop(x: number, z: number) {
  const r = plateauRadius(x, z);
  const basin = 5.8 * noise.noise(x / 180 + 1, z / 140 + 6) + 2.6 * noise.noise(x / 89 - 3, z / 78 + 7);
  const shoulder =
    smoothstep(0.53, 0.98, r) * (6.8 * noise.noise(x / 63, z / 50) + 2.8 * noise.noise(x / 33 + 21, z / 43));
  const exit = smoothstep(15, 76, Math.hypot(x - 20, z + 50));
  return 101.5 + exit * (basin + shoulder);
}

type Point2 = { x: number; z: number };
type Buffer = { positions: number[]; indices: number[]; colors: number[] };

function buffer(): Buffer {
  return { positions: [], indices: [], colors: [] };
}
function vertex(b: Buffer, p: Vector3, c: Color) {
  const i = b.positions.length / 3;
  b.positions.push(p.x, p.y, p.z);
  b.colors.push(c.r, c.g, c.b);
  return i;
}

function pack(b: Buffer) {
  return { positions: new Float32Array(b.positions), indices: new Uint32Array(b.indices), colors: b.colors };
}

function portalClear(p: Point2, allowance = 0) {
  return !(p.x > 263 - allowance && Math.abs(p.z) < 13 + allowance);
}

// Local x follows the strike, local z points out of the rock face.
type Mass = {
  x: number;
  z: number;
  angle: number;
  width: number;
  depth: number;
  base: number;
  height: number;
  lean: number;
  rake: number;
  crown: number;
  bedDip?: number;
};

export function buildMountainMasses(
  rimAt: (angle: number) => { x: number; y: number; z: number },
  wallAt: (angle: number, y: number) => Point2 | undefined,
  groundAt: (x: number, z: number) => number,
  seed = 13947,
) {
  const rng = new Rng(seed),
    stone = buffer(),
    snow = buffer();
  const palette = ['#656771', '#6c707b', '#707581', '#777982', '#626977', '#74727a'];
  const white = new Color(1, 1, 1);
  const stats = { buttresses: 0, passage: 0, talus: 0, summit: 0 };
  const stoneFootprints: { x: number; z: number; radius: number }[] = [];

  function mass(s: Mass, kind: keyof typeof stats) {
    const tx = Math.cos(s.angle),
      tz = Math.sin(s.angle),
      nx = tz,
      nz = -tx;
    const world = (u: number, v: number, y: number) =>
      new Vector3(s.x + tx * u + nx * v, y, s.z + tz * u + nz * v);
    // A fractured block has a pair of principal joint planes and chipped ends.
    // Keep the same corners up the face so its longest facets run across most of its height.
    const stoneRng = new Rng(seed ^ Math.round(1193 * s.x + 6131 * s.z));
    const a = rng.float(0.11, 0.34),
      b = rng.float(0.1, 0.36);
    const block = [
      [-0.5 + a, -0.53],
      [0.5 - b, -0.47],
      [0.52, -0.25],
      [0.48, 0.5 - a],
      [0.25, 0.52],
      [-0.48 + b, 0.49],
      [-0.53, 0.23],
      [-0.51, -0.28],
    ];
    const blade = [
      [-0.49, -0.33],
      [0.19, -0.51],
      [0.57, -0.25],
      [0.3, 0.2],
      [-0.22, 0.52],
      [-0.54, 0.18],
    ];
    const wedge = [
      [-0.55, -0.23],
      [-0.15, -0.51],
      [0.52, -0.36],
      [0.48, -0.01],
      [-0.12, 0.53],
      [-0.47, 0.35],
    ];
    const polygon = stoneRng.pick([block, blade, wedge]);
    const corners = polygon.map(([u, v]) => [
      u * s.width * stoneRng.float(0.96, 1.03),
      v * s.depth * stoneRng.float(0.96, 1.03),
    ]);
    const pitch = stoneRng.float(-0.43, 0.37),
      dip = s.bedDip ?? stoneRng.float(-0.48, 0.15);
    const heel = stoneRng.float(-0.24, 0.2) * s.width;
    const topHeight = (u: number, v: number) =>
      s.base + Math.max(s.height * 0.08, s.height + pitch * u + dip * v - 0.36 * Math.max(0, u - heel));
    const top: Vector3[] = [],
      rings: number[][] = [];
    const boulder = kind === 'talus' || kind === 'summit';
    const crownWidth = boulder ? stoneRng.float(0.3, 0.73) : stoneRng.float(0.51, 0.9);
    const color = new Color(rng.pick(palette));
    const middle = rng.float(0.26, 0.76),
      toe = rng.float(0.9, 1.52),
      waist = rng.float(0.86, 1.21);
    for (const [row, t, scale] of [
      [0, 0, toe],
      [1, middle, waist],
      [2, 1, crownWidth],
    ]) {
      const ring: number[] = [];
      for (const [u, v] of corners) {
        const fraction = row === 1 ? t + rng.float(-0.22, 0.22) : t;
        const width = scale * (row === 1 ? rng.float(0.92, 1.08) : 1);
        const p = world(
          u * width + s.rake * fraction,
          v * width + s.lean * fraction,
          s.base + (topHeight(u, v) - s.base) * fraction,
        );
        ring.push(vertex(stone, p, color));
        if (row === 2) top.push(p);
      }
      rings.push(ring);
    }
    const crownCenter = top.reduce((p, q) => p.add(q), new Vector3()).divideScalar(top.length);
    const highest = top.reduce((p, q) => (q.y > p.y ? q : p));
    crownCenter.lerp(highest, stoneRng.float(0.12, 0.43));
    crownCenter.y += Math.min(s.height * 0.1, Math.min(s.depth, s.width) * stoneRng.float(0.06, 0.17));
    const ridgeId = vertex(stone, crownCenter, color);
    // Local (strike, outward) is right-handed when viewed from above.
    for (let i = 0; i < corners.length; i++) {
      const j = (i + 1) % corners.length;
      for (let row = 0; row < 2; row++) {
        const lo = rings[row],
          hi = rings[row + 1];
        stone.indices.push(lo[i], lo[j], hi[j], lo[i], hi[j], hi[i]);
      }
      stone.indices.push(ridgeId, rings[2][i], rings[2][j]);
      if (i > 0 && i + 1 < corners.length) stone.indices.push(rings[0][0], rings[0][i + 1], rings[0][i]);
    }
    if (s.crown > 0) {
      // Smooth the plan corners of the accumulated snow while leaving the rock arrises sharp.
      const outline: Vector3[] = [];
      top.forEach((p, i) => {
        const before = p.clone().lerp(top[(i + top.length - 1) % top.length], 0.23);
        const after = p.clone().lerp(top[(i + 1) % top.length], 0.23);
        for (let k = 0; k <= 4; k++) {
          const t = k / 4;
          outline.push(
            before
              .clone()
              .multiplyScalar((1 - t) ** 2)
              .addScaledVector(p, 2 * t * (1 - t))
              .addScaledVector(after, t * t),
          );
        }
      });
      const center = crownCenter;
      const centerId = vertex(snow, center.clone().add(new Vector3(0, s.crown * 1.32, 0)), white);
      // Sample the same fan of fracture planes that was emitted above. A cap
      // can retreat from the high tip and still rest on both sides of its ridge.
      const roofHeight = (p: Vector3) => {
        let nearest = -Infinity,
          height = center.y;
        for (let i = 0; i < top.length; i++) {
          const a = top[i],
            b = top[(i + 1) % top.length];
          const ax = a.x - center.x,
            az = a.z - center.z,
            bx = b.x - center.x,
            bz = b.z - center.z;
          const dx = p.x - center.x,
            dz = p.z - center.z,
            det = ax * bz - az * bx;
          const u = (dx * bz - dz * bx) / det,
            v = (ax * dz - az * dx) / det;
          const weight = Math.min(u, v);
          if (weight > nearest) {
            nearest = weight;
            height = center.y + u * (a.y - center.y) + v * (b.y - center.y);
          }
        }
        return height;
      };
      const radius = Math.min(s.crown * 0.75, s.depth * 0.075, s.width * 0.07);
      const highPoint = highest.clone().sub(center);
      highPoint.y = 0;
      highPoint.normalize();
      const exposure = stoneRng.float(0.15, 0.49);
      const rows: number[][] = [];
      for (const [scale, spread, lift] of [
        [0.34, 0, 1.25],
        [0.68, 0, 1.04],
        [0.89, 0, 0.73],
        [1, -0.42, 0.48],
        [1, 0.25, 0.31],
        [1, 0.42, 0.12],
        [1, -0.12, -0.1],
      ]) {
        const row: number[] = [];
        outline.forEach((p, i) => {
          const prev = outline[(i + outline.length - 1) % outline.length],
            next = outline[(i + 1) % outline.length];
          const outward = new Vector3(prev.z - next.z, 0, next.x - prev.x).normalize();
          const wind = Math.max(0, highPoint.dot(outward));
          const cover = 0.985 - exposure * wind ** 2;
          const q = center
            .clone()
            .lerp(p, scale * cover)
            .addScaledVector(outward, spread * radius);
          q.y = roofHeight(q) + s.crown * lift * (1 - 0.45 * wind * scale);
          row.push(vertex(snow, q, white));
        });
        rows.push(row);
      }
      for (let i = 0; i < outline.length; i++) {
        const j = (i + 1) % outline.length;
        snow.indices.push(centerId, rows[0][i], rows[0][j]);
        for (let r = 0; r + 1 < rows.length; r++)
          snow.indices.push(
            rows[r][i],
            rows[r + 1][i],
            rows[r + 1][j],
            rows[r][i],
            rows[r + 1][j],
            rows[r][j],
          );
      }
    }
    stats[kind]++;
    if (kind === 'summit')
      stoneFootprints.push({ x: s.x, z: s.z, radius: Math.max(s.width, s.depth) * 0.54 });
  }

  function admissible(x: number, z: number, margin: number) {
    if (!portalClear({ x, z }, margin)) return false;
    const p = ascentSample(x);
    return x < -300 - margin || x > 20 + margin || Math.abs(z - p.z) > p.w + margin;
  }
  // Joint traces run from the lip to the foot. Two neighboring masses share
  // a strike direction, but retreat from the trace by different amounts.
  // The roof owns the snow at their upper contact.
  function cliffFace(start: number, end: number, side = 0) {
    function station(a: number) {
      if (!side) return { p: rimAt((a + tau) % tau), tan: contourTangent(a), base: -2 };
      const x = a * side,
        profile = ascentSample(x),
        next = ascentSample(x + 1);
      const z = profile.z + side * profile.w;
      const edge = rimAt(Math.atan2(z / 180, x / 260));
      const rockHeight = Math.hypot(x, z) < Math.hypot(edge.x, edge.z) ? plateauTop(x, z) : groundAt(x, z);
      const y = Math.max(profile.y, rockHeight);
      return {
        p: { x, z, y },
        tan: { x: side, z: side * (next.z - profile.z) + next.w - profile.w },
        base: profile.y - 2,
      };
    }
    const styleRng = new Rng(seed ^ Math.round(start * 87193));
    const middle = (start + end) / 2;
    const style = side
      ? Math.sin(middle / 27)
      : Math.sin(3 * middle - 1.8) + 0.65 * Math.cos(7 * middle + 0.4);
    const shelf = !side && style < -0.28;
    const split = style > -0.6;
    const span = Math.hypot(station(start).p.x - station(end).p.x, station(start).p.z - station(end).p.z);
    const rake = styleRng.float(-0.27, 0.29) * span;
    const toe = side ? styleRng.float(4, 9) : shelf ? styleRng.float(2, 10) : styleRng.float(10, 31);
    const crestBend = styleRng.float(0.28, 0.57);
    const jointPitch = styleRng.float(0.28, 0.5) * (styleRng.chance(0.5) ? 1 : -1);
    const jointTop = styleRng.float(0.33, 0.67),
      jointToe = styleRng.float(0.14, 0.84);
    const joint = (t: number) => jointTop + (jointToe - jointTop) * t + 0.1 * Math.sin(Math.PI * t * 2);
    const gap = Math.min(0.07, styleRng.float(0.8, 2.7) / Math.max(1, span));
    // Each half terminates on the same oblique joint. Its inner face descends
    // into the mountain, so the open fracture has width and depth at eye level.
    const count = split && span > 28 ? 2 : 1;
    for (let part = 0; part < count; part++) {
      const color = new Color(styleRng.pick(palette));
      const faceDepth = styleRng.float(0.64, 1.29);
      const ridge = styleRng.float(0.25, 0.7);
      const broad = styleRng.chance(0.62);
      const rightShoulder = styleRng.float(0.67, 0.86);
      const columns = broad ? [0, ridge * 0.64, rightShoulder, 1] : [0, ridge, 1];
      const crossJoint = !shelf && (part === 0 || style < 0) && styleRng.chance(0.77);
      const levels = shelf
        ? [0, 0.2, 0.48, 1]
        : crossJoint
          ? [0, crestBend - 0.0055, crestBend, crestBend + 0.008, 1]
          : [0, crestBend, 1];
      const notch = styleRng.float(0.95, 2.65) * (side ? 0.65 : 1);
      const dipSign = jointPitch > 0 ? 1 : -1;
      if (crossJoint) columns.push(0.42, 0.74);
      function surface(u: number, t: number) {
        const left = part === 0 ? 0 : joint(t) + gap / 2;
        const right = part === count - 1 ? 1 : joint(t) - gap / 2;
        const s = left + (right - left) * u,
          a = start + (end - start) * s;
        const { p, tan, base } = station(a),
          l = Math.hypot(tan.x, tan.z);
        const tx = tan.x / l,
          tz = tan.z / l,
          nx = tz,
          nz = -tx;
        const rib = broad
          ? Math.max(0.22, Math.min(1, u / (ridge * 0.64), (1 - u) / (1 - rightShoulder)))
          : u < ridge
            ? u / ridge
            : (1 - u) / (1 - ridge);
        const bend = crossJoint
          ? dipSign *
            (0.11 * Math.max(0, 1 - Math.abs(u - 0.42) / 0.42) -
              0.08 * Math.max(0, 1 - Math.abs(u - 0.74) / 0.26))
          : 0;
        const drop = t + Math.sin(Math.PI * t) * (jointPitch * (s - 0.5) + bend);
        const height = p.y - 0.22 + (base - p.y + 0.22) * drop;
        const lean = rake * t * (side ? 0.38 : 1) + rib * span * 0.12 * Math.sin(Math.PI * t);
        let out =
          -0.45 +
          (toe * (0.34 + 0.66 * rib) * faceDepth + 0.45) * t +
          Math.sin(Math.PI * t) * (side ? 4 : 9) * rib;
        if (shelf && t > 0 && t < 1) {
          const wall = wallAt(a, height);
          if (wall) {
            const under = (wall.x - p.x) * nx + (wall.z - p.z) * nz;
            // Use the actual cut underside behind the lower face of the slab.
            out = under + (t <= 0.21 ? 5 + rib * 7 : 1 + rib * 2.4);
          }
        }
        if (crossJoint && t === crestBend) out -= notch * (1 - smoothstep(0.56, 1, u));
        const widthFactor = side ? smoothstep(1.5, 32, p.y - base) : 1;
        return new Vector3(
          p.x + (tx * lean + nx * out) * widthFactor,
          height,
          p.z + (tz * lean + nz * out) * widthFactor,
        );
      }
      if (side && Math.min(start * side, end * side) < -195) {
        for (let i = 1; i < Math.ceil(span / 4); i++) columns.push(i / Math.ceil(span / 4));
      }
      columns.sort((a, b) => a - b);
      const rows = levels.map((t) => columns.map((u) => vertex(stone, surface(u, t), color)));
      for (let row = 0; row + 1 < levels.length; row++) {
        for (let c = 0; c + 1 < columns.length; c++) {
          const upper = rows[row],
            lower = rows[row + 1];
          // The top polyline samples the snow's supporting contour; its
          // height between distant joint planes is seldom a straight chord.
          if (row === 0) {
            const pieces = Math.max(1, Math.ceil((span * (columns[c + 1] - columns[c])) / 2.5));
            let prev = upper[c];
            for (let k = 1; k <= pieces; k++) {
              const u = columns[c] + ((columns[c + 1] - columns[c]) * k) / pieces;
              const next = k === pieces ? upper[c + 1] : vertex(stone, surface(u, 0), color);
              stone.indices.push(lower[c], prev, next);
              prev = next;
            }
          } else stone.indices.push(lower[c], upper[c], upper[c + 1]);
          stone.indices.push(lower[c], upper[c + 1], lower[c + 1]);
        }
      }
      for (const c of [0, columns.length - 1]) {
        const t = station(c === 0 ? start : end).tan,
          l = Math.hypot(t.x, t.z);
        const back = new Vector3(-t.z / l, 0, t.x / l).multiplyScalar(side ? 9 : 19);
        const inside = levels.map((level) => vertex(stone, surface(columns[c], level).add(back), color));
        for (let k = 0; k + 1 < levels.length; k++) {
          const hi = rows[k][c],
            lo = rows[k + 1][c],
            i = inside[k],
            j = inside[k + 1];
          if (c === 0) stone.indices.push(hi, lo, j, hi, j, i);
          else stone.indices.push(lo, hi, i, lo, i, j);
        }
      }
    }
    stats[side ? 'passage' : 'buttresses']++;
  }
  for (let a = 0.024; a < tau + 0.024; ) {
    const tangent = contourTangent(a, 1.07),
      speed = Math.hypot(tangent.x, tangent.z);
    const run = rng.float(38, 86),
      start = a,
      end = Math.min(tau + 0.024, a + run / speed),
      mid = (start + end) * 0.5;
    a = end;
    const p = rimAt(mid % tau),
      t = contourTangent(mid),
      angle = Math.atan2(t.z, t.x);
    const nx = Math.sin(angle),
      nz = -Math.cos(angle),
      width = run;
    // Trim only the part of a span that actually touches an opening.
    let first = start + 0.002,
      last = end - 0.002;
    if (last <= first) continue;
    const clear = (a: number) => {
      const q = rimAt(a % tau);
      return admissible(q.x, q.z, 13);
    };
    for (let n = 0; n < 12 && first < last && !clear(first); n++) first += run / speed / 12;
    for (let n = 0; n < 12 && first < last && !clear(last); n++) last -= run / speed / 12;
    if (last - first > 0.025 && clear((first + last) * 0.5)) cliffFace(first, last);
    if (!admissible(p.x, p.z, width * 0.44)) continue;
    const prominence = Math.cos(3 * mid + 1.45);
    const bench = Math.cos(4 * mid + 0.65) > 0.27;
    if (prominence > -0.65 || bench || rng.chance(0.35)) {
      const tall = prominence > 0.81;
      const front = tall ? rng.float(24, 32) : rng.float(15, 29);
      const offset = rng.float(-0.2, 0.22) * width;
      const x = p.x + nx * front + Math.cos(angle) * offset,
        z = p.z + nz * front + Math.sin(angle) * offset;
      const w = width * (tall ? rng.float(1.02, 1.28) : rng.float(0.65, 1.08));
      if (admissible(x, z, w * 0.49)) {
        const relief = tall
          ? rng.float(0.68, 0.87)
          : prominence > 0.05 || bench
            ? rng.float(0.26, 0.48)
            : rng.float(0.09, 0.24);
        mass(
          {
            x,
            z,
            angle: angle + rng.float(-0.25, 0.19),
            width: w,
            depth: w * rng.float(0.48, 0.84),
            base: -5,
            height: p.y * relief + 5,
            lean: -front * rng.float(0.52, 1.12),
            bedDip: !tall && bench ? -0.83 : undefined,
            rake: (Math.sin(mid * 2) > 0.05 ? 1 : -1) * w * rng.float(0.15, 0.44),
            crown: tall ? rng.float(1.5, 2.6) : rng.float(0.65, 1.8),
          },
          'buttresses',
        );
      }
    }
    // Wind deposits the longer fans against the foot of a recess. Both
    // ends sink into the sampled ground so they have no exposed sheet edge.
    if (prominence < 0.5 && admissible(p.x, p.z, width * 0.6 + 18)) {
      const cols = 14,
        rows = 10,
        offset = snow.positions.length / 3;
      const reach = 37 + 14 * Math.cos(mid * 5),
        depth = 5 + 4 * (0.5 + 0.5 * Math.sin(mid * 7));
      for (let i = 0; i <= cols; i++)
        for (let j = 0; j <= rows; j++) {
          const u = (i / cols) * 2 - 1,
            v = j / rows,
            along = u * width * 0.64;
          const d = 1 + v * reach + (1 - u * u) * 6;
          const x = p.x + Math.cos(angle) * along + nx * d,
            z = p.z + Math.sin(angle) * along + nz * d;
          const ground = groundAt(x, z);
          const height =
            Math.min(ground, 8) + depth * (1 - u * u) ** 2 * Math.sin(Math.PI * v ** 0.61) ** 1.6 - 0.25;
          vertex(snow, new Vector3(x, height, z), white);
        }
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < rows; j++) {
          const a = offset + i * (rows + 1) + j,
            b = a + rows + 1;
          snow.indices.push(a, b, b + 1, a, b + 1, a + 1);
        }
    }
    const fragments = rng.int(4, 9);
    for (let k = 0; k < fragments; k++) {
      const offset = rng.float(-0.62, 0.62) * width,
        front = rng.float(20, 58),
        w = rng.float(4, 23);
      const x = p.x + nx * front + Math.cos(angle) * offset,
        z = p.z + nz * front + Math.sin(angle) * offset;
      if (admissible(x, z, w * 0.72))
        mass(
          {
            x,
            z,
            angle: angle + rng.float(-1, 1),
            width: w,
            depth: w * rng.float(0.48, 0.98),
            base: -w * 0.17,
            height: w * rng.float(0.36, 0.76),
            lean: w * rng.float(-0.19, 0.15),
            rake: w * rng.float(-0.27, 0.31),
            crown: rng.chance(0.48) ? w * 0.045 : 0,
          },
          'talus',
        );
    }
  }
  for (const side of [-1, 1]) {
    for (let x = -259; x < -2; ) {
      const end = Math.min(-2, x + rng.float(28, 61));
      const a = side === 1 ? x : -end,
        b = side === 1 ? end : -x;
      cliffFace(a + 0.4, b - 0.4, side);
      x = end;
    }
    // Cover the narrowing lip between the shallow excavation and the apron.
    // The inner toe meets the ramp; the high side disappears inside the wall.
    let previous: number[] | undefined;
    for (let x = -300; x <= 10; x += 2) {
      const p = ascentSample(x),
        edge = p.z + side * p.w,
        room = Math.max(0, p.w - 12);
      const end = smoothstep(-300, -285, x) * (1 - smoothstep(-48, 10, x));
      const width = Math.min(room, 9 + 5 * Math.sin(x / 27 + side) + 3 * Math.cos(x / 16));
      const lip = Math.max(0, groundAt(x, edge) - p.y);
      const depth = end * Math.min(lip + 0.65, 4.2 + 1.8 * Math.cos(x / 23 + side));
      const row: number[] = [];
      for (const t of [-0.75, -0.4, -0.15, 0, 0.17, 0.38, 0.64, 0.84, 1]) {
        const z = edge - side * t * width,
          ground = groundAt(x, z);
        const floor = Math.min(p.y, ground);
        const bank = t < 0 ? 1 - smoothstep(0.1, 0.75, -t) : 1 - smoothstep(-0.12, 1, t);
        const back = t < 0 ? smoothstep(0.3, 0.75, -t) : 0;
        const y = floor + depth * bank + Math.min(ground - floor, depth) * back - 0.12;
        row.push(vertex(snow, new Vector3(x, y, z), white));
      }
      if (previous)
        for (let i = 0; i + 1 < row.length; i++) {
          const a = previous[i],
            b = row[i],
            c = previous[i + 1],
            d = row[i + 1];
          if (side === 1) snow.indices.push(a, b, c, c, b, d);
          else snow.indices.push(a, c, b, c, d, b);
        }
      previous = row;
    }
  }
  for (const [gx, gz] of [
    [-164, 73],
    [-155, -109],
    [-38, 111],
    [72, 47],
    [144, -90],
    [185, 19],
    [-68, -102],
  ]) {
    const count = rng.int(3, 7);
    for (let j = 0; j < count; j++) {
      const x = gx + rng.float(-18, 18),
        z = gz + rng.float(-13, 13),
        w = rng.float(5, 19);
      if (!admissible(x, z, w * 0.7) || plateauRadius(x, z) > 0.94) continue;
      mass(
        {
          x,
          z,
          angle: rng.float(-0.55, 0.55),
          width: w,
          depth: w * rng.float(0.5, 0.85),
          base: plateauTop(x, z) - 2,
          height: w * rng.float(0.24, 0.53) + 2,
          lean: 0,
          rake: -w * 0.15,
          crown: rng.float(0.45, 1.1),
        },
        'summit',
      );
    }
  }
  return { rocks: pack(stone), snow: pack(snow), stats, stoneFootprints };
}
