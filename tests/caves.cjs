// Caves (gen/cave.ts and the cave mouths of gen/region.ts): the same seed builds the same cave,
// the rock is a closed surface facing the air, the throat in the world is the throat inside,
// the game's own character controller walks from the mouth to every hall and dead end, and in
// the world (seed 42) each mouth stands on level ground with the sheet cut out of its throat.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const RAPIER = require('@dimforge/rapier3d-compat');
const compiled = new Module(__filename);
compiled._compile(buildSync({ stdin: { contents: "export * from './src/gen/cave'; export { Region } from './src/gen/region';", resolveDir: path.join(__dirname, '..') },
  bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename);
const { CaveBuild, ENTER_Z, Region } = compiled.exports;
let checks = 0;
const test = async (name, run) => { await run(); checks++; console.log('PASS ', name); };
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** walk a capsule like the player's along waypoints; returns how far it got */
function walk(world, route, opts = {}) {
  const HALF = 0.6, RADIUS = 0.3, dt = 1 / 60;
  const start = route[0];
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y + HALF + RADIUS + 0.3, start.z));
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS), body);
  const kcc = world.createCharacterController(0.03);
  kcc.setUp({ x: 0, y: 1, z: 0 });
  kcc.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
  kcc.setMinSlopeSlideAngle((55 * Math.PI) / 180);
  kcc.enableAutostep(0.32, 0.15, false);
  kcc.enableSnapToGround(0.35);
  let vy = 0, reached = 1, stuck = 0, t = 0;
  const p = { ...body.translation() };
  while (reached < route.length && t < (opts.limit ?? 400)) {
    const w = route[reached];
    const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.9) { reached++; stuck = 0; continue; }
    const speed = 1.9;
    vy -= 9.81 * dt;
    kcc.computeColliderMovement(collider, { x: (dx / d) * speed * dt, y: vy * dt, z: (dz / d) * speed * dt });
    const mv = kcc.computedMovement();
    if (kcc.computedGrounded()) vy = 0;
    p.x += mv.x; p.y += mv.y; p.z += mv.z;
    body.setNextKinematicTranslation(p);
    world.step();
    stuck = Math.hypot(mv.x, mv.z) < speed * dt * 0.15 ? stuck + dt : 0;
    if (stuck > 3 || p.y < start.y - 80) break;
    t += dt;
  }
  world.removeCollider(collider, false);
  world.removeRigidBody(body);
  return { reached, of: route.length, at: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)], next: route[Math.min(reached, route.length - 1)] };
}

(async () => {
  await RAPIER.init();
  const caves = new Map();
  const timed = [];
  for (const seed of SEEDS) {
    const t0 = performance.now();
    const c = new CaveBuild({ seed });
    c.interior(); c.props(); c.mouth();
    timed.push(performance.now() - t0);
    caves.set(seed, c);
  }

  await test('the same seed builds the same cave, in a bounded time', () => {
    const a = caves.get(3), b = new CaveBuild({ seed: 3 });
    const ma = a.interior(), mb = b.interior();
    assert.equal(ma.positions.length, mb.positions.length);
    for (const i of [0, 999, ma.positions.length - 1]) assert.equal(ma.positions[i], mb.positions[i]);
    assert.equal(a.props().length, b.props().length);
    assert.ok(Math.max(...timed) < 2500, timed.map((t) => t.toFixed(0)).join(' '));
    for (const c of caves.values()) {
      const s = c.stats();
      assert.ok(s.halls >= 3 && s.triangles > 8000 && s.triangles < 60000, JSON.stringify(s));
    }
  });

  await test('the rock is one closed surface, every face turned to the air', () => {
    for (const [seed, c] of caves) {
      const m = c.interior(), I = m.indices, P = m.positions, edges = new Map();
      for (let q = 0; q < I.length; q += 3) for (let e = 0; e < 3; e++) {
        const k = I[q + e] * 1048576 + I[q + ((e + 1) % 3)];
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
      let open = 0;
      for (const [k, n] of edges) {
        const a = Math.floor(k / 1048576), b = k % 1048576;
        if (n !== 1 || edges.get(b * 1048576 + a) !== 1) open++;
      }
      assert.ok(open / edges.size < 0.002, `seed ${seed}: ${open} of ${edges.size} edges unpaired`);
      let wrong = 0, tested = 0;
      for (let q = 0; q < I.length; q += 3 * 29) {
        const a = I[q] * 3, b = I[q + 1] * 3, d = I[q + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-6) continue;
        nx /= l; ny /= l; nz /= l;
        const cx = (P[a] + P[b] + P[d]) / 3, cy = (P[a + 1] + P[b + 1] + P[d + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[d + 2]) / 3;
        tested++;
        if (c.air(cx + nx * 0.4, cy + ny * 0.4, cz + nz * 0.4) > c.air(cx - nx * 0.4, cy - ny * 0.4, cz - nz * 0.4)) wrong++;
      }
      assert.ok(wrong / tested < 0.03, `seed ${seed}: ${wrong} of ${tested} faces turned into the rock`);
    }
  });

  await test('the throat of the world mouth is the throat inside: the swap cannot be seen', () => {
    for (const [seed, c] of caves) {
      const a = c.mouth().positions, b = c.interior().positions;
      const inThroat = (P, i) => Math.abs(P[i]) < 3.2 && P[i + 2] > ENTER_Z - 1.5 && P[i + 2] < ENTER_Z + 3 && P[i + 1] > -0.5 && P[i + 1] < 4;
      const pts = [];
      for (let i = 0; i < a.length; i += 3) if (inThroat(a, i)) pts.push([a[i], a[i + 1], a[i + 2]]);
      let n = 0, miss = 0, worst = 0;
      for (let i = 0; i < b.length; i += 3) {
        if (!inThroat(b, i)) continue;
        n++;
        let best = Infinity;
        for (const p of pts) best = Math.min(best, Math.hypot(p[0] - b[i], p[1] - b[i + 1], p[2] - b[i + 2]));
        worst = Math.max(worst, best);
        if (best > 0.02) miss++;
      }
      assert.ok(n > 40 && miss / n < 0.02, `seed ${seed}: ${miss} of ${n} throat vertices differ, worst by ${worst.toFixed(3)} m`);
    }
  });

  await test('on foot with the game\'s controller, every hall and dead end is reachable from the mouth', () => {
    for (const [seed, c] of caves) {
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      const m = c.interior();
      world.createCollider(RAPIER.ColliderDesc.trimesh(m.positions, m.indices));
      for (const p of c.props()) if (p.hull) { const d = RAPIER.ColliderDesc.convexHull(p.hull); if (d) world.createCollider(d); }
      const leaves = c.nodes.map((n, i) => i).filter((i) => c.nodes[i].kind === 'hall' || c.nodes[i].kind === 'end');
      assert.ok(leaves.length >= 3, `seed ${seed}: ${leaves.length} halls`);
      for (const leaf of leaves) {
        const r = walk(world, c.routeTo(leaf));
        assert.equal(r.reached, r.of, `seed ${seed}: stopped on the way to node ${leaf} (${c.nodes[leaf].kind}): ${JSON.stringify(r)}`);
      }
      world.free();
    }
  });

  await test('daylight dies in the throat and frost stays near the mouth', () => {
    for (const [seed, c] of caves) {
      const m = c.interior(), P = m.positions;
      let farLit = 0, far = 0, nearLit = 0, near = 0;
      for (let q = 0; q < P.length / 3; q++) {
        const d = c.depthAt(P[q * 3], P[q * 3 + 1] + 0.5, P[q * 3 + 2]);
        if (d > 25) { far++; if (m.day[q] > 0.02 || m.frost[q] > 0.5) farLit++; }
        if (d < 3) { near++; if (m.day[q] > 0.3) nearLit++; }
      }
      assert.ok(farLit / far < 0.01 && nearLit / near > 0.4, `seed ${seed}: deep ${farLit}/${far} lit, mouth ${nearLit}/${near} lit`);
    }
  });

  const R = new Region(42, 3072);
  await R.generate();
  await test('the world has cave mouths at the foot of slopes, on level ground, cut into the sheet', () => {
    assert.ok(R.caves.length >= 3 && R.caves.length <= 5, `${R.caves.length}`);
    assert.ok(R.caves.some((c) => Math.hypot(c.x, c.z) < 700), 'a cave within reach of the house');
    for (const c of R.caves) {
      const at = (lx, lz) => [c.x + lx * Math.cos(c.yaw) + lz * Math.sin(c.yaw), c.z - lx * Math.sin(c.yaw) + lz * Math.cos(c.yaw)];
      for (const lz of [-6, -3, -1]) for (const lx of [-3, 0, 3]) {
        const [x, z] = at(lx, lz);
        assert.ok(Math.abs(R.heightAt(x, z) - c.y) < 0.45, `pad of ${c.x.toFixed(0)},${c.z.toFixed(0)} at ${lx},${lz}: ${(R.heightAt(x, z) - c.y).toFixed(2)}`);
      }
      // under the throat the sheet is below the floor of the throat
      for (const lz of [2, 4, 6]) for (const lx of [-1.5, 0, 1.5]) {
        const [x, z] = at(lx, lz);
        assert.ok(R.heightAt(x, z) < c.y - 0.2, `sheet in the throat ${lx},${lz}: ${(R.heightAt(x, z) - c.y).toFixed(2)}`);
      }
      // the hillside behind really rises
      assert.ok(c.hill.h[(7 + 12) * c.hill.nx + 13] > 9, 'hill 12 m behind');
      // nothing grows in front of the mouth or over it, and rock skin keeps off the pad
      for (const P of [R.trees, R.rocks]) R.forEachProp(P, c.x, c.z, 14, (i) => {
        if (R.inMouth(c, P.x[i], P.z[i], 8, 12, -8)) assert.ok(P.flags[i] & 3, `a prop at ${P.x[i].toFixed(1)},${P.z[i].toFixed(1)}`);
      });
      const [px, pz] = at(0, -3);
      assert.ok(!R.skin.covers(px, pz), 'rock skin on the pad');
      assert.ok(R.places.some((p) => p.kind === 'cave' && Math.hypot(p.x - c.x, p.z - c.z) < 6), 'the cave is a place on the map');
    }
  });

  console.log(`${checks} cave checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
