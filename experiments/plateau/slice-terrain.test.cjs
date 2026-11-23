// Physical walks and independent navigation graph from the baked triangle colliders.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Module = require('node:module');
const path = require('node:path');
const { buildSync } = require('esbuild');
const R = require('@dimforge/rapier3d-compat');

const m = new Module(__filename);
m._compile(
  buildSync({
    entryPoints: [path.join(__dirname, 'slice-terrain.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  }).outputFiles[0].text,
  __filename,
);
const { generateSliceTerrain } = m.exports;
const seeds = [42, 7, 8191, 23011];

function geometryHash(t) {
  const hash = createHash('sha256');
  for (const mesh of [t.rock, t.snow])
    for (const buf of [mesh.positions, mesh.indices]) hash.update(Buffer.from(buf.buffer));
  hash.update(JSON.stringify([t.tiers, t.routes, t.trees, t.passageAnchors, t.bridgeAnchors]));
  return hash.digest('hex');
}
function worldFor(t) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(R.ColliderDesc.cuboid(260, 0.5, 110).setTranslation(30, -0.5, 0));
  for (const data of [t.rock, t.snow])
    world.createCollider(
      R.ColliderDesc.trimesh(data.positions, data.indices, R.TriMeshFlags.FIX_INTERNAL_EDGES),
    );
  for (const tree of t.trees)
    world.createCollider(
      R.ColliderDesc.cylinder(tree.height / 2, tree.radius).setTranslation(
        tree.x,
        tree.y + tree.height / 2,
        tree.z,
      ),
    );
  world.step();
  return world;
}
function walk(world, start, goals) {
  const body = world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y + 0.92, start.z),
  );
  const col = world.createCollider(R.ColliderDesc.capsule(0.6, 0.3), body),
    k = world.createCharacterController(0.03);
  k.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
  k.setMinSlopeSlideAngle((55 * Math.PI) / 180);
  k.enableAutostep(0.32, 0.15, false);
  k.enableSnapToGround(0.35);
  world.step();
  let ticks = 0,
    vertical = 0;
  try {
    for (const target of goals) {
      let stuck = 0,
        last = Infinity;
      for (;;) {
        const p = body.translation(),
          dx = target.x - p.x,
          dz = target.z - p.z,
          dist = Math.hypot(dx, dz);
        if (dist < 0.2) {
          assert.ok(
            Math.abs(p.y - 0.93 - target.y) < 0.5,
            'wrong vertical layer at ' + JSON.stringify(target) + '; feet ' + (p.y - 0.93),
          );
          break;
        }
        if (dist >= last - 0.0005) stuck++;
        else stuck = 0;
        assert.ok(
          stuck < 80 && ticks < 35000,
          'blocked at ' + JSON.stringify(p) + ' targeting ' + JSON.stringify(target),
        );
        last = dist;
        vertical = Math.max(-30, vertical - 9.81 / 60);
        const step = Math.min(1.72 / 60, dist);
        k.computeColliderMovement(col, { x: (step * dx) / dist, y: vertical / 60, z: (step * dz) / dist });
        const v = k.computedMovement();
        body.setNextKinematicTranslation({ x: p.x + v.x, y: p.y + v.y, z: p.z + v.z });
        world.step();
        if (k.computedGrounded()) vertical = -0.5;
        ticks++;
      }
    }
    return ticks;
  } finally {
    world.removeCharacterController(k);
    world.removeRigidBody(body);
    world.step();
  }
}
// Flood the highest solid surfaces sampled by ray, including rock outcrops and trees.
// Ground-to-satellite disconnection is the negative control for the bridge.
function flood(world, t) {
  const step = 1,
    x0 = -73,
    z0 = -45,
    nx = 248,
    nz = 91,
    n = nx * nz;
  const h = new Float32Array(n);
  const ray = new R.Ray({ x: 0, y: 60, z: 0 }, { x: 0, y: -1, z: 0 });
  for (let i = 0; i < n; i++) {
    ray.origin.x = x0 + (i % nx);
    ray.origin.z = z0 + Math.floor(i / nx);
    const hit = world.castRay(ray, 80, true);
    assert.ok(hit);
    h[i] = 60 - hit.timeOfImpact;
  }
  const index = (p) => Math.round((p.z - z0) / step) * nx + Math.round((p.x - x0) / step);
  function visit(start) {
    const seen = new Uint8Array(n),
      queue = new Int32Array(n);
    queue[0] = index(start);
    seen[queue[0]] = 1;
    let front = 0,
      end = 1;
    while (front < end) {
      const i = queue[front++],
        x = i % nx,
        z = Math.floor(i / nx);
      for (const v of [
        x > 0 ? i - 1 : -1,
        x + 1 < nx ? i + 1 : -1,
        z > 0 ? i - nx : -1,
        z + 1 < nz ? i + nx : -1,
      ]) {
        if (v < 0 || seen[v] || Math.abs(h[i] - h[v]) > Math.tan((48 * Math.PI) / 180) * step + 0.02)
          continue;
        seen[v] = 1;
        queue[end++] = v;
      }
    }
    return seen;
  }
  const main = visit(t.spawn),
    remote = visit(t.bridgeAnchors[1]);
  assert.ok(main[index(t.bridgeAnchors[0])]);
  assert.equal(main[index(t.bridgeAnchors[1])], 0);
  const results = [];
  for (const tier of t.tiers) {
    const at =
      tier.kind === 'peak'
        ? tier.center
        : (t.routes.find((r) => r.to === tier.id)?.points.at(-1) ?? t.bridgeAnchors[1]);
    const i = index(at),
      mine = tier.mountainId === 'main' ? main : remote;
    assert.equal(Boolean(mine[i]), tier.accessible, 'graph ' + tier.id + ' at ' + JSON.stringify(at));
    results.push({
      id: tier.id,
      accessible: tier.accessible,
      observed: Boolean(mine[i]),
      height: +h[i].toFixed(2),
    });
  }
  return results;
}
(async () => {
  await R.init();
  const results = [],
    allCounts = new Set(),
    entries = new Set();
  for (const seed of seeds) {
    const t = generateSliceTerrain(seed, { passages: true });
    const control = generateSliceTerrain(seed, { passages: false });
    assert.equal(geometryHash(t), geometryHash(generateSliceTerrain(seed, { passages: true })));
    assert.equal(control.sampleHeight(17, -5), 22);
    assert.equal(t.sampleHeight(17, -5), 14);
    const world = worldFor(t);
    const physical = [];
    for (const mountain of ['main', 'satellite']) {
      const routes = t.routes.filter((r) => r.to.startsWith(mountain + '-'));
      if (!routes.length) continue;
      const start = mountain === 'main' ? t.spawn : t.bridgeAnchors[1];
      const pts = routes.flatMap((r) => r.points);
      const ticks = walk(world, start, [...pts, ...pts.slice().reverse(), start]);
      physical.push({ mountain, ticks, roundTrip: true });
    }
    const graph = flood(world, t);
    world.free();
    const counts = ['main', 'satellite'].map((id) => t.tiers.filter((q) => q.mountainId === id).length);
    counts.forEach((q) => allCounts.add(q));
    entries.add(t.routes[0].kind);
    const row = {
      seed,
      counts,
      entry: t.routes[0].kind,
      graph,
      physical,
      trees: t.trees.length,
      rockTriangles: t.rock.indices.length / 3,
      snowTriangles: t.snow.indices.length / 3,
      sha256: geometryHash(t),
    };
    results.push(row);
    console.error('Verified', seed, counts, t.routes[0].kind);
  }
  assert.deepEqual([...allCounts].sort(), [1, 2, 3, 4]);
  assert.deepEqual([...entries].sort(), ['cut', 'wide']);
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
