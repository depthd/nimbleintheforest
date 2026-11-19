import { Color, Vector3 } from 'three';
import { Rng, Simplex2, smoothstep } from '../../src/core/rng';
import { ascentSample } from './ascent';
import { reliefHeight } from './seam-relief-fixture';
import { contourTangent, plateauRadius } from './plateau-profile';

const noise = new Simplex2(new Rng(91842).next);
const tau = Math.PI * 2;

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
};

export function buildMountainMasses(
  rimAt: (angle: number) => { x: number; y: number; z: number },
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
    const a = rng.float(0.11, 0.34),
      b = rng.float(0.1, 0.36);
    const polygon = [
      [-0.5 + a, -0.53],
      [0.5 - b, -0.47],
      [0.52, -0.25],
      [0.48, 0.5 - a],
      [0.25, 0.52],
      [-0.48 + b, 0.49],
      [-0.53, 0.23],
      [-0.51, -0.28],
    ];
    const corners = polygon.map(([u, v]) => [
      u * s.width * rng.float(0.91, 1.08),
      v * s.depth * rng.float(0.91, 1.08),
    ]);
    const pitch = rng.float(-0.33, 0.28),
      dip = rng.float(-0.64, -0.19);
    const topHeight = (u: number, v: number) => s.base + s.height + pitch * u + dip * v;
    const top: Vector3[] = [],
      rings: number[][] = [];
    const boulder = kind === 'talus' || kind === 'summit';
    const crownWidth = boulder ? 0.36 + 0.22 * Math.sin(s.x + s.z) : 0.78 + 0.12 * Math.sin(s.x);
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
    // Local (strike, outward) is right-handed when viewed from above.
    for (let i = 0; i < corners.length; i++) {
      const j = (i + 1) % corners.length;
      for (let row = 0; row < 2; row++) {
        const lo = rings[row],
          hi = rings[row + 1];
        stone.indices.push(lo[i], lo[j], hi[j], lo[i], hi[j], hi[i]);
      }
      if (i > 0 && i + 1 < corners.length)
        stone.indices.push(
          rings[2][0],
          rings[2][i],
          rings[2][i + 1],
          rings[0][0],
          rings[0][i + 1],
          rings[0][i],
        );
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
      const center = top.reduce((s, p) => s.add(p), new Vector3()).divideScalar(top.length);
      const centerId = vertex(snow, center.clone().add(new Vector3(0, s.crown * 1.14, 0)), white);
      const radius = Math.min(s.crown * 0.85, s.depth * 0.085, s.width * 0.065);
      const rows: number[][] = [];
      for (const [spread, lift, scale] of [
        [0, 1.08, 0.5],
        [-0.45, 0.99, 1],
        [0.38, 0.86, 1],
        [0.86, 0.55, 1],
        [1, 0.23, 1],
        [0.86, -0.06, 1],
        [-0.6, -0.17, 1],
      ]) {
        const row: number[] = [];
        outline.forEach((p, i) => {
          const prev = outline[(i + outline.length - 1) % outline.length],
            next = outline[(i + 1) % outline.length];
          const outward = new Vector3(prev.z - next.z, 0, next.x - prev.x).normalize();
          const q = center
            .clone()
            .lerp(p, scale)
            .addScaledVector(outward, spread * radius);
          q.y += lift * s.crown;
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
      const y = Math.max(profile.y, reliefHeight(x, z, plateauTop));
      return {
        p: { x, z, y },
        tan: { x: side, z: side * (next.z - profile.z) + next.w - profile.w },
        base: profile.y - 2,
      };
    }
    const color = new Color(rng.pick(palette)),
      sections: number[][] = [];
    const stations = [0, rng.float(0.14, 0.34), rng.float(0.56, 0.83), 1];
    const project = rng.float(9, 36),
      lowerRake = rng.float(-19, 18);
    const strike = (a: number) => 14 * Math.sin(3 * a + 1) - 12 * Math.cos(5 * a);
    const topRow: Vector3[] = [],
      bottomRow: Vector3[] = [],
      setbacks: number[] = [];
    for (let i = 0; i < stations.length; i++) {
      const u = stations[i],
        a = start + (end - start) * u,
        { p, tan, base } = station(a);
      const len = Math.hypot(tan.x, tan.z),
        tx = tan.x / len,
        tz = tan.z / len;
      const place = (along: number, out: number, y: number) =>
        new Vector3(p.x + tx * along + tz * out, y, p.z + tz * along - tx * out);
      const endPoint = i === 0 || i === 3,
        recess = endPoint ? rng.float(-7, -2) : rng.float(-3, 2);
      const setback = side ? -0.55 : recess;
      setbacks.push(setback);
      const top = place(0, setback, p.y - 0.45);
      const along = strike(side ? a / 67 : a) + lowerRake * 0.35 + (endPoint ? 0 : rng.float(-13, 14));
      const reach = project * (endPoint ? rng.float(0.1, 0.66) : rng.float(0.78, 1.38));
      const foot = place(side ? along * 0.3 : along, side ? Math.min(9, reach * 0.33) : reach, base);
      const bend = endPoint ? 0.44 + 0.15 * Math.sin(a * 5) : rng.float(0.23, 0.82);
      const middle = foot.clone().lerp(top, bend);
      const push = (endPoint ? rng.float(-5, 1) : rng.float(4, 16)) * (side ? 0.38 : 1);
      middle.x += tz * push + tx * 4 * Math.sin(a * 7);
      middle.z += -tx * push + tz * 4 * Math.sin(a * 7);
      sections.push([vertex(stone, foot, color), vertex(stone, middle, color), vertex(stone, top, color)]);
      topRow.push(top);
      bottomRow.push(foot);
    }
    for (let i = 0; i < 3; i++) {
      const u = sections[i],
        v = sections[i + 1];
      stone.indices.push(u[0], u[1], v[1], u[0], v[1], v[0]);
      // Sample the roof between joint planes. Long straight chords would
      // slice off the troughs in the snow and poke out of the crest.
      const pieces = Math.max(1, Math.ceil(topRow[i].distanceTo(topRow[i + 1]) / 3));
      let previous = u[2];
      for (let k = 1; k <= pieces; k++) {
        const f = k / pieces,
          along = stations[i] + (stations[i + 1] - stations[i]) * f;
        const a = start + (end - start) * along,
          { p, tan } = station(a),
          l = Math.hypot(tan.x, tan.z);
        const back = setbacks[i] + (setbacks[i + 1] - setbacks[i]) * f;
        const next =
          k === pieces
            ? v[2]
            : vertex(
                stone,
                new Vector3(p.x + (tan.z / l) * back, p.y - 0.45, p.z - (tan.x / l) * back),
                color,
              );
        stone.indices.push(u[1], previous, next);
        previous = next;
      }
      stone.indices.push(u[1], v[2], v[1]);
    }
    // End faces have depth: the dark sliver exposed between them is a fissure.
    for (const i of [0, 3]) {
      const a = i === 0 ? start : end,
        t = station(a).tan,
        l = Math.hypot(t.x, t.z);
      const inward = new Vector3(-t.z / l, 0, t.x / l).multiplyScalar(32);
      const low = vertex(stone, bottomRow[i].clone().add(inward), color);
      const high = vertex(stone, topRow[i].clone().add(inward), color);
      const [b, m, h] = sections[i];
      const tris = [b, m, low, m, high, low, m, h, high];
      if (i === 0) tris.reverse();
      stone.indices.push(...tris);
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
    if (rng.chance(0.66)) {
      const front = rng.float(12, 24),
        offset = rng.float(-0.22, 0.22) * width;
      const x = p.x + nx * front + Math.cos(angle) * offset,
        z = p.z + nz * front + Math.sin(angle) * offset;
      const high = rng.chance(0.4),
        w = width * rng.float(0.5, 0.91);
      if (admissible(x, z, w * 0.5))
        mass(
          {
            x,
            z,
            angle: angle + rng.float(-0.37, 0.39),
            width: w,
            depth: rng.float(18, 40),
            base: -7,
            height: p.y * (high ? rng.float(0.66, 0.95) : rng.float(0.24, 0.59)) + 7,
            lean: rng.float(-20, 6),
            rake: rng.float(-0.35, 0.36) * w,
            crown: rng.float(0.6, 2.0),
          },
          'buttresses',
        );
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
    // Short banks of drifted snow root the wall in the floor of the pass.
    for (let start = -232; start < -24; ) {
      const length = rng.float(25, 58),
        width = rng.float(8, 19),
        height = rng.float(3, 10);
      const rows: number[][] = [];
      for (let i = 0; i <= 14; i++) {
        const u = i / 14,
          x = start + length * u,
          p = ascentSample(x),
          envelope = Math.sin(Math.PI * u) ** 1.4;
        const row: number[] = [];
        for (let j = 0; j <= 9; j++) {
          const v = j / 9,
            d = width * (0.18 + 0.82 * envelope) * v;
          const z = p.z + side * (p.w + 2 - d);
          const y = p.y - 0.15 + height * envelope * (1 - v) ** 1.9;
          row.push(vertex(snow, new Vector3(x, y, z), white));
        }
        rows.push(row);
      }
      for (let i = 0; i + 1 < rows.length; i++)
        for (let j = 0; j < 9; j++) {
          const a = rows[i][j],
            b = rows[i + 1][j],
            c = rows[i][j + 1],
            d = rows[i + 1][j + 1];
          if (side === 1) snow.indices.push(a, b, c, c, b, d);
          else snow.indices.push(a, c, b, c, d, b);
        }
      start += length * rng.float(0.74, 1.26);
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
