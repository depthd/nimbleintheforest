// Cliff generator invariants, without a browser: the reshaped sheet stays inside the rock
// wherever the face hides it, the undercut leaves room to stand, and output is repeatable.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const compiled = new Module(__filename);
compiled._compile(buildSync({ entryPoints: [path.join(__dirname, '../src/gen/cliffs.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename);
const { CliffBuild, blockTriangles } = compiled.exports;
let checks = 0;
const test = (name, run) => { run(); checks++; console.log('PASS ', name); };

// A 160 m cliff along +x: valley at 0 in front (z > 0), plateau at 22 behind (z < 0). Its face
// fades out over 42 m at each end, no faster than a talus slope can climb beside it.
const CELL = 2, N = 120, OX = 120, OZ = 120; // grid covers −120..120 m
const ground = { lower: () => 0, upper: () => 22 };
function straight(extra = {}) {
  const path = [], top = [], base = [];
  for (let x = -80; x <= 80; x += 10) { path.push({ x, z: 0.6 * Math.sin(x / 9) }); top.push(22); base.push(2.4); }
  return { id: 'test', seed: 7, path, top, base, inside: { x: 0, z: -30 }, overhang: 1.8, taper: 42, ...extra };
}
function sheetFor(build) {
  const nf = N + 1, H = new Float32Array(nf * nf);
  for (let j = 0; j < nf; j++) for (let i = 0; i < nf; i++) {
    const z = j * CELL - OZ;
    H[j * nf + i] = z < -6 ? 22 : 0; // a crude step the stamp has to replace
  }
  build.stamp(H, N, OX, OZ, CELL);
  return H;
}
// the terrain mesh splits every quad along the same diagonal (see world/terrain.ts)
function sheetHeight(H, x, z) {
  const nf = N + 1, fx = (x + OX) / CELL, fz = (z + OZ) / CELL, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * nf + i;
  return u + v <= 1 ? H[k] + (H[k + 1] - H[k]) * u + (H[k + nf] - H[k]) * v
    : H[k + nf + 1] + (H[k + nf] - H[k + nf + 1]) * (1 - u) + (H[k + 1] - H[k + nf + 1]) * (1 - v);
}
// Each block as its rendered triangles. Inside = an odd number of crossings on a vertical ray,
// which holds for the slightly non-convex blocks too.
function solids(build) {
  return build.blocks.map((b) => { const t = []; blockTriangles(b, t); return { b, t }; });
}
function insideBlock({ b, t }, x, y, z) {
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ || y < b.minY || y > b.maxY) return false;
  let crossings = 0;
  for (let q = 0; q < t.length; q += 9) {
    const ax = t[q], az = t[q + 2], bx = t[q + 3], bz = t[q + 5], cx = t[q + 6], cz = t[q + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    if (l1 * t[q + 1] + l2 * t[q + 4] + l3 * t[q + 7] > y) crossings++;
  }
  return crossings % 2 === 1;
}
const insideRock = (S, x, y, z, eps = 0.06) => S.some((s) => insideBlock(s, x, y, z) || (eps > 0 && (insideBlock(s, x + eps, y, z) || insideBlock(s, x - eps, y, z) || insideBlock(s, x, y + eps, z) || insideBlock(s, x, y, z + eps) || insideBlock(s, x, y, z - eps))));

test('the same spec builds the same rock', () => {
  const a = new CliffBuild(straight(), ground), b = new CliffBuild(straight(), ground);
  assert.equal(a.blocks.length, b.blocks.length);
  assert.deepEqual(Array.from(a.blocks[17].pts), Array.from(b.blocks[17].pts));
  assert.equal(a.caps.indices.length, b.caps.indices.length);
  const s = a.stats();
  assert.ok(s.kinds.face > 60 && s.kinds.cap > 6 && s.kinds.boulder > 3, JSON.stringify(s));
});

// The sheet may show as ground in front of the face, under the shelter roof and on the plateau.
// It must never show as a steep face of its own, and never poke into gaps under low rock.
function sheetSlope(H, x, z) {
  const e = 0.25, gx = (sheetHeight(H, x + e, z) - sheetHeight(H, x - e, z)) / (2 * e), gz = (sheetHeight(H, x, z + e) - sheetHeight(H, x, z - e)) / (2 * e);
  return Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
}
// snow caps and the rim cornice hide what lies just under them
function underSnow(build, x, y, z) {
  const P = build.caps.positions, I = build.caps.indices;
  for (let q = 0; q < I.length; q += 3) {
    const a = I[q] * 3, b = I[q + 1] * 3, c = I[q + 2] * 3;
    const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], cx = P[c], cz = P[c + 2];
    if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx) || z < Math.min(az, bz, cz) || z > Math.max(az, bz, cz)) continue;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const h = l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1];
    if (h > y && h < y + 1.5) return true;
  }
  return false;
}
function sheetAudit(build, H, S, region) {
  let probed = 0;
  const steep = [], slits = [];
  for (let x = region.x0; x <= region.x1; x += 0.43) for (let z = region.z0; z <= region.z1; z += 0.37) {
    const y = sheetHeight(H, x, z);
    if (insideRock(S, x, y + 0.05, z) || underSnow(build, x, y, z)) continue;
    const p = build.frame.project(x, z);
    // the last metres blend into the test's crude sheet; the lab audit covers real ends
    if (p.beyond > 0 || p.s < 5 || p.s > build.length - 5) continue;
    probed++;
    if (sheetSlope(H, x, z) > 50) steep.push([+x.toFixed(2), +z.toFixed(2), +y.toFixed(2), +p.s.toFixed(1), +p.v.toFixed(1)]);
    const foot = build.intendedFootAt(p.s);
    if (y < foot + 0.3) continue; // the floor, including the floor under the shelter roof
    // a gap too low to be ground under an overhang: the sheet pokes into the rock's joints
    for (let yy = y + 0.25; yy < y + 1.2; yy += 0.2) if (insideRock(S, x, yy, z, 0)) { slits.push([+x.toFixed(2), +z.toFixed(2), +y.toFixed(2), +p.s.toFixed(1), +p.v.toFixed(1)]); break; }
  }
  return { probed, steep, slits };
}

test('the stamped sheet never shows as a steep face or in gaps under rock', () => {
  for (const spec of [straight(), straight({ undercut: { s0: 72, s1: 90, depth: 3.2, height: 2.9 } })]) {
    const build = new CliffBuild(spec, ground), H = sheetFor(build), S = solids(build);
    // beyond the ends the test sheet is a crude vertical step that no cliff dresses
    const a = sheetAudit(build, H, S, { x0: -78, x1: 78, z0: -20, z1: 30 });
    assert.ok(a.probed > 15000, `${a.probed}`);
    assert.ok(a.steep.length === 0, `${a.steep.length} steep, e.g. ${JSON.stringify(a.steep.slice(0, 5))}`);
    assert.ok(a.slits.length === 0, `${a.slits.length} under rock, e.g. ${JSON.stringify(a.slits.slice(0, 5))}`);
  }
});

test('no trench behind the rock: past the blocks the sheet is already at the plateau', () => {
  const build = new CliffBuild(straight(), ground), H = sheetFor(build);
  for (let x = -60; x <= 60; x += 1.3) {
    // walk inward until no block covers the column any more
    for (let z = -2; z >= -30; z -= 0.25) {
      const covered = build.blocks.some((b) => b.kind !== 'boulder' && b.kind !== 'rubble' && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY > 20);
      if (covered) continue;
      const p = build.frame.project(x, z);
      if (p.v < 3) continue;
      const y = sheetHeight(H, x, z);
      assert.ok(y > 21.2, `x=${x} z=${z} sheet ${y.toFixed(2)} behind the rock`);
      break;
    }
  }
});

test('the undercut leaves standing room under a solid roof', () => {
  const spec = straight({ undercut: { s0: 72, s1: 90, depth: 3.2, height: 2.9 } });
  const build = new CliffBuild(spec, ground), S = solids(build), H = sheetFor(build);
  assert.ok(build.shelters.length >= 4);
  let free = 0, roof = 0;
  for (let s = 75; s <= 87; s += 0.7) for (let v = 0.6; v <= 2.4; v += 0.3) {
    const p = build.at(s, v), floor = sheetHeight(H, p.x, p.z), foot = build.footAt(s);
    // the apron's slope can lean in by one grid cell; deeper in, the floor is flat
    assert.ok(floor <= foot + 0.02 && floor > foot - (v < 2.9 ? 0.45 : 0.05), `floor ${floor} foot ${foot} at v=${v}`);
    for (let y = floor + 0.15; y <= floor + 2.1; y += 0.3) { assert.ok(!insideRock(S, p.x, y, p.z, -0.02), `rock at s=${s} v=${v} y=${y - floor}`); free++; }
    if (insideRock(S, p.x, floor + 3.6, p.z)) roof++;
  }
  assert.ok(free > 300 && roof > 40, `${free} ${roof}`);
});

test('a pillar keeps its sheet at the foot and is rock all the way up', () => {
  const path = [], top = [], base = [];
  for (let a = 0; a < 8; a++) { const r = 5 + (a % 2) * 0.8; path.push({ x: Math.cos(a / 8 * Math.PI * 2) * r, z: Math.sin(a / 8 * Math.PI * 2) * r }); top.push(15); base.push(0.8); }
  const build = new CliffBuild({ id: 'p', seed: 3, path, top, base, closed: true, overhang: 0.9 }, ground);
  const S = solids(build), H = sheetFor(build);
  for (let y = 1.5; y < 14.5; y += 0.5) assert.ok(insideRock(S, 0, y, 0), `core at ${y}`);
  assert.ok(Math.abs(sheetHeight(H, 0, 0) - 0.8) < 0.05);
  assert.ok(build.caps.indices.length > 0);
});

test('vegetation and places are kept out of the rock but allowed on the plateau and the valley', () => {
  const build = new CliffBuild(straight(), ground);
  assert.ok(build.occupied(0, -3));
  assert.ok(!build.occupied(0, -24));
  assert.ok(!build.occupied(0, 16));
  assert.ok(!build.occupied(130, 0));
});

console.log(`${checks} cliff checks passed`);
