const assert = require("node:assert/strict"),
  path = require("node:path"),
  Module = require("node:module");
const { buildSync } = require("esbuild"),
  R = require("@dimforge/rapier3d-compat");
const m = new Module(__filename);
m._compile(
  buildSync({
    stdin: {
      contents: "export * from './experiments/mountains/landforms'",
      resolveDir: path.resolve(__dirname, "../.."),
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  }).outputFiles[0].text,
  __filename,
);
const { Landforms, SIZE, CELL } = m.exports;
function geometry(l) {
  const n = l.n,
    nf = n + 1,
    P = new Float32Array(nf * nf * 3),
    I = new Uint32Array(n * n * 6);
  let k = 0;
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++)
      P.set(
        [i * CELL - SIZE / 2, l.heights[j * nf + i], j * CELL - SIZE / 2],
        (j * nf + i) * 3,
      );
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * nf + i,
        b = a + 1,
        c = a + nf;
      I.set([a, c, b, b, c, c + 1], k);
      k += 6;
    }
  return { P, I };
}
function walk(l, route) {
  const { P, I } = geometry(l),
    world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(R.ColliderDesc.trimesh(P, I));
  const points = l.worldRoute(route),
    s = points[0],
    body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(
        s.x,
        l.heightAt(s.x, s.z) + 1,
        s.z,
      ),
    ),
    col = world.createCollider(R.ColliderDesc.capsule(0.6, 0.3), body),
    k = world.createCharacterController(0.03);
  k.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
  k.setMinSlopeSlideAngle((55 * Math.PI) / 180);
  k.enableAutostep(0.32, 0.15, false);
  k.enableSnapToGround(0.35);
  let reached = 0,
    ticks = 0,
    vy = 0,
    stuck = 0,
    prev = Infinity,
    maxDelta = 0;
  while (reached < points.length && ticks++ < 45000) {
    const p = body.translation(),
      v = points[reached],
      dx = v.x - p.x,
      dz = v.z - p.z,
      d = Math.hypot(dx, dz);
    maxDelta = Math.max(maxDelta, Math.abs(p.y - 0.9 - l.heightAt(p.x, p.z)));
    if (d < 1.4) {
      reached++;
      stuck = 0;
      prev = Infinity;
      continue;
    }
    stuck = d >= prev - 0.002 ? stuck + 1 : 0;
    prev = d;
    if (stuck > 180) break;
    vy = Math.max(-30, vy - 9.81 / 60);
    k.computeColliderMovement(col, {
      x: ((dx / d) * 1.72) / 60,
      y: vy / 60,
      z: ((dz / d) * 1.72) / 60,
    });
    const a = k.computedMovement();
    body.setNextKinematicTranslation({
      x: p.x + a.x,
      y: p.y + a.y,
      z: p.z + a.z,
    });
    world.step();
    if (k.computedGrounded()) vy = -0.5;
  }
  const result = {
    id: route.id,
    reached,
    total: points.length,
    ticks,
    maxDelta: +maxDelta.toFixed(2),
  };
  world.free();
  return result;
}
(async () => {
  await R.init();
  let checks = 0;
  for (const seed of [1, 2, 3, 7, 19, 42, 123, 2026]) {
    const a = new Landforms(seed),
      b = new Landforms(seed);
    assert.deepEqual(a.heights, b.heights);
    checks++;
    assert.ok(a.heights.every(Number.isFinite));
    let area = 0,
      lo = Infinity,
      hi = -Infinity;
    for (let z = -330; z < -90; z += 8)
      for (let x = -80; x < 320; x += 8) {
        const p = a.world(x, z),
          h = a.heightAt(p.x, p.z);
        if (
          Number.isNaN(a.waterAt(p.x, p.z)) &&
          a.slopeAt(p.x, p.z) < 0.35 &&
          h > a.upper - 6
        ) {
          area += 64;
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
    assert.ok(area > 35000, `seed ${seed}: upper floor area ${area}`);
    assert.ok(hi - lo > 2, `seed ${seed}: upper floor is flat`);
    checks++;
    for (let i = 1; i < a.drainage.length; i++)
      assert.ok(a.drainage[i].y <= a.drainage[i - 1].y + 1e-6);
    checks++;
    console.log(
      "SEED",
      seed,
      "upper area",
      area,
      "range",
      lo.toFixed(1),
      hi.toFixed(1),
    );
    for (const route of a.routes) {
      const r = walk(a, route);
      console.log("ROUTE", seed, JSON.stringify(r));
      assert.equal(r.reached, r.total, `seed ${seed} ${route.id} stuck`);
      assert.ok(r.maxDelta < 2, `seed ${seed} ${route.id} unsupported`);
      checks++;
    }
  }
  console.log(
    "PASS",
    checks,
    "checks; 24 routes traversed with Rapier at walking speed",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
