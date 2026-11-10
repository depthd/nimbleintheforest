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
    position: body.translation(),
  };
  world.free();
  return result;
}
function upperSpace(a) {
  const step = 8,
    nx = 101,
    nz = 48,
    valid = new Uint8Array(nx * nz),
    ys = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const p = a.world(-420 + i * step, -490 + j * step),
        h = a.heightAt(p.x, p.z),
        k = j * nx + i;
      ys[k] = h;
      if (
        h > a.upper - 14 &&
        h < a.upper + 65 &&
        a.slopeAt(p.x, p.z) < 0.4 &&
        Number.isNaN(a.waterAt(p.x, p.z))
      )
        valid[k] = 1;
    }
  let largest = { area: 0, range: 0 };
  for (let k = 0; k < valid.length; k++)
    if (valid[k]) {
      const queue = [k];
      valid[k] = 0;
      let lo = Infinity,
        hi = -Infinity;
      for (let q = 0; q < queue.length; q++) {
        const c = queue[q],
          x = c % nx,
          z = Math.floor(c / nx);
        lo = Math.min(lo, ys[c]);
        hi = Math.max(hi, ys[c]);
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const xx = x + dx,
            zz = z + dz,
            u = zz * nx + xx;
          if (xx >= 0 && xx < nx && zz >= 0 && zz < nz && valid[u]) {
            valid[u] = 0;
            queue.push(u);
          }
        }
      }
      if (queue.length * step * step > largest.area)
        largest = { area: queue.length * step * step, range: hi - lo };
    }
  return largest;
}
(async () => {
  await R.init();
  let checks = 0,
    walks = 0;
  const seeds = process.env.SEEDS
    ? process.env.SEEDS.split(",").map(Number)
    : [1, 2, 3, 7, 19, 42, 123, 2026, 11, 71, 314, 8191];
  for (const seed of seeds) {
    const a = new Landforms(seed),
      b = new Landforms(seed);
    assert.deepEqual(a.heights, b.heights);
    console.log("CONNECTIVITY", seed, require("./connectivity.cjs").checkConnectivity(a));
    checks++;
    assert.ok(a.heights.every(Number.isFinite));
    checks++;
    const space = upperSpace(a);
    console.log("UPPER", seed, JSON.stringify(space));
    assert.ok(
      space.area > 30000,
      `seed ${seed}: upper connected space ${space.area}`,
    );
    assert.ok(
      space.range > 8,
      `seed ${seed}: upper floor too flat ${space.range}`,
    );
    checks++;
    for (let i = 1; i < a.drainage.length; i++)
      assert.ok(
        a.drainage[i].y <= a.drainage[i - 1].y + 1e-6,
        `seed ${seed}: uphill drainage plan`,
      );
    checks++;
    for (let k = 0; k < a.drainage.length - 1; k++) {
      const p = a.drainage[k],
        q = a.drainage[k + 1];
      for (let i = 0; i <= 50; i++) {
        const t = i / 50,
          w = a.world(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t),
          y = p.y + (q.y - p.y) * t;
        assert.ok(
          a.heightAt(w.x, w.z) < y + 0.25,
          `seed ${seed}: buried outlet at ${k}/${i}`,
        );
      }
    }
    checks++;
    assert.ok(a.plan.traversal.every((r) => r.status === "planned"));
    checks++;
    for (const route of a.routes.filter(r => !process.env.ROUTES || process.env.ROUTES.split(",").includes(r.id))) {
      for (const direction of ["up", "down"]) {
        const rr =
          direction === "up"
            ? route
            : { ...route, points: [...route.points].reverse() };
        const result = walk(a, rr);
        console.log("ROUTE", seed, direction, JSON.stringify(result));
        assert.equal(
          result.reached,
          result.total,
          `seed ${seed}: ${route.id} ${direction} stuck`,
        );
        assert.ok(
          result.maxDelta < 2,
          `seed ${seed}: ${route.id} lost support`,
        );
        checks++;
        walks++;
      }
      // Check useful lateral room on actual triangles; a line alone is insufficient.
      for (let i = 2; i < route.points.length - 2; i += 4) {
        const p = route.points[i],
          q = route.points[i + 1],
          len = Math.hypot(q.x - p.x, q.z - p.z),
          origin = a.world(p.x, p.z),
          h = a.heightAt(origin.x, origin.z);
        for (const side of [-1, 1]) {
          const w = a.world(
            p.x - ((q.z - p.z) / len) * side * 2,
            p.z + ((q.x - p.x) / len) * side * 2,
          );
          assert.ok(
            Math.abs(a.heightAt(w.x, w.z) - h) < 1.3,
            `seed ${seed}: ${route.id} narrow at ${i}`,
          );
        }
      }
      checks++;
    }
  }
  console.log(
    `PASS ${checks} checks; ${walks} Rapier walks in both directions; ${seeds.length} seeds`,
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
