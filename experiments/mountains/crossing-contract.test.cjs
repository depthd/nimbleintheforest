'use strict';
// Independent contract checks complement crossing.test.cjs's continuous journey.
// Terrain connectivity here is a dry triangle-graph approximation at bake resolution;
// it does not certify an arbitrary capsule path, autostep or visual quality.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { buildSync } = require('esbuild');
const R = require('@dimforge/rapier3d-compat');
const compiled = new Module(__filename);
const bundledSource = buildSync({ entryPoints: [path.join(__dirname, 'crossing.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const sourceSHA256 = {
  bakedModule: createHash('sha256').update(bundledSource).digest('hex'),
  contractTest: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
};
compiled._compile(bundledSource, __filename);
const { createCrossingPlan, bakeCrossing } = compiled.exports;
const failures = [], reports = [];
let checks = 0;
function check(name, fn) {
  checks++;
  try { const report = fn(); if (report !== undefined) reports.push({ name, ...report }); }
  catch (error) { failures.push({ name, message: error.message }); }
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function inside(p, poly) {
  let result = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) result = !result;
  }
  return result;
}
function containedEdge(a, b, poly) {
  const dx = b.x - a.x, dz = b.z - a.z, cuts = [0, 1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], ex = q.x - p.x, ez = q.z - p.z;
    const cross = dx * ez - dz * ex;
    if (Math.abs(cross) < 1e-8) continue;
    const px = p.x - a.x, pz = p.z - a.z, t = (px * ez - pz * ex) / cross, u = (px * dz - pz * dx) / cross;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - cuts[i - 1] < 1e-8) continue;
    const t = (cuts[i] + cuts[i - 1]) / 2;
    if (!inside({ x: a.x + t * dx, z: a.z + t * dz }, poly)) return false;
  }
  return true;
}
function triangleGraph(raw) {
  const P = raw.positions, I = raw.indices, count = I.length / 3, vertices = P.length / 3;
  const point = i => ({ x: P[i * 3], y: P[i * 3 + 1], z: P[i * 3 + 2] });
  const faces = new Array(count), neighbors = new Int32Array(count * 3).fill(-1), edges = new Map(), bins = new Map();
  for (let t = 0; t < count; t++) {
    const a = point(I[t * 3]), b = point(I[t * 3 + 1]), c = point(I[t * 3 + 2]);
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    assert.ok(ny > 0, `Terrain triangle ${t} is degenerate or faces down`);
    faces[t] = { a, b, c, slope: Math.hypot(nx, nz) / ny, area: ny / 2, minY: Math.min(a.y, b.y, c.y) };
    for (let x = Math.floor(Math.min(a.x, b.x, c.x) / 16); x <= Math.floor(Math.max(a.x, b.x, c.x) / 16); x++)
      for (let z = Math.floor(Math.min(a.z, b.z, c.z) / 16); z <= Math.floor(Math.max(a.z, b.z, c.z) / 16); z++) {
        const key = `${x},${z}`;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(t);
      }
    for (let e = 0; e < 3; e++) {
      const u = I[t * 3 + e], v = I[t * 3 + (e + 1) % 3], key = Math.min(u, v) * vertices + Math.max(u, v), previous = edges.get(key);
      if (previous === undefined) edges.set(key, t * 3 + e);
      else { assert.equal(neighbors[previous], -1, 'Non-manifold terrain edge'); neighbors[previous] = t; neighbors[t * 3 + e] = Math.floor(previous / 3); }
    }
  }
  const locate = p => {
    for (const t of bins.get(`${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`) || []) {
      const { a, b, c } = faces[t];
      if (p.x < Math.min(a.x, b.x, c.x) - 1e-7 || p.x > Math.max(a.x, b.x, c.x) + 1e-7 || p.z < Math.min(a.z, b.z, c.z) - 1e-7 || p.z > Math.max(a.z, b.z, c.z) + 1e-7) continue;
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      const u = ((b.z - c.z) * (p.x - c.x) + (c.x - b.x) * (p.z - c.z)) / det;
      const v = ((c.z - a.z) * (p.x - c.x) + (a.x - c.x) * (p.z - c.z)) / det;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7) return { face: t, y: u * a.y + v * b.y + (1 - u - v) * c.y };
    }
    return { face: -1, y: NaN };
  };
  const flood = (start, permitted) => {
    const seen = new Uint8Array(count), queue = [];
    if (start >= 0 && permitted(faces[start])) { seen[start] = 1; queue.push(start); }
    let area = 0;
    for (let q = 0; q < queue.length; q++) {
      const t = queue[q]; area += faces[t].area;
      for (let e = 0; e < 3; e++) {
        const n = neighbors[t * 3 + e];
        if (n >= 0 && !seen[n] && permitted(faces[n])) { seen[n] = 1; queue.push(n); }
      }
    }
    return { seen, area, visited: queue.length };
  };
  return { faces, locate, flood };
}
function upperTriangles(mesh) {
  const P = mesh.positions, I = mesh.indices, indices = [];
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    const ny = (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]);
    if (ny > 1e-8) indices.push(I[i], I[i + 1], I[i + 2]);
  }
  return { positions: P, indices: Uint32Array.from(indices) };
}
function rejectMutation(name, mutate) {
  check(`reject:${name}`, () => {
    const plan = structuredClone(createCrossingPlan(42)); mutate(plan);
    const before = JSON.stringify(plan), result = bakeCrossing(plan);
    assert.equal(JSON.stringify(plan), before, 'Bake repaired or mutated the rejected target');
    assert.equal(result.ok, false, `Accepted invalid ${name}`);
    assert.ok(result.issues.length > 0, 'Rejected plans require an explanation');
  });
}
function makePhysics(world) {
  const physics = new R.World({ x: 0, y: -9.81, z: 0 });
  const terrain = physics.createCollider(R.ColliderDesc.trimesh(world.terrain.positions, world.terrain.indices));
  const bridge = physics.createCollider(R.ColliderDesc.trimesh(world.bridge.positions, world.bridge.indices));
  return { physics, terrain, bridge };
}
function actor(scene, foot) {
  const { physics } = scene;
  const body = physics.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(foot.x, foot.y + .96, foot.z));
  const collider = physics.createCollider(R.ColliderDesc.capsule(.6, .3), body), controller = physics.createCharacterController(.03);
  controller.setMaxSlopeClimbAngle(48 * Math.PI / 180); controller.setMinSlopeSlideAngle(55 * Math.PI / 180);
  controller.enableAutostep(.32, .15, false); controller.enableSnapToGround(.35);
  physics.step();
  let vy = 0, grounded = false;
  const position = () => { const p = body.translation(); return { x: p.x, y: p.y - .9, z: p.z }; };
  const step = (vx = 0, vz = 0) => {
    vy = Math.max(-30, vy - 9.81 / 60);
    controller.computeColliderMovement(collider, { x: vx / 60, y: vy / 60, z: vz / 60 });
    const delta = controller.computedMovement(), p = body.translation();
    body.setNextKinematicTranslation({ x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z });
    physics.step(); grounded = controller.computedGrounded(); if (grounded && vy < 0) vy = -.5;
  };
  const support = () => {
    const p = position();
    return physics.castRayAndGetNormal(new R.Ray({ x: p.x, y: p.y + .15, z: p.z }, { x: 0, y: -1, z: 0 }), .6, true, undefined, undefined, collider);
  };
  return { position, step, support, get grounded() { return grounded; } };
}

(async () => {
  await R.init();
  const seeds = process.env.CONTRACT_SEEDS ? process.env.CONTRACT_SEEDS.split(',').map(Number) : [0, 3, 17, 113, 2026, 4294967295];
  const signatures = new Set();
  for (const seed of seeds) {
    const plan = createCrossingPlan(seed), before = JSON.stringify(plan), baked = bakeCrossing(plan);
    if (!baked.ok) { failures.push({ name: `bake:${seed}`, message: JSON.stringify(baked.issues) }); continue; }
    const world = baked.world, graph = triangleGraph(world.terrain), bridgeGraph = triangleGraph(upperTriangles(world.bridge));
    assert.equal(JSON.stringify(plan), before, 'Bake changed a retained target');
    signatures.add(JSON.stringify(plan.routes.find(r => r.id === 'bridge')));
    check(`dry-terrain-connectivity:${seed}`, () => {
      const source = graph.locate(plan.spawn), west = graph.locate(plan.regions.find(r => r.id === 'west').core), east = graph.locate(plan.regions.find(r => r.id === 'east').core);
      assert.ok([source, west, east].every(p => p.face >= 0 && Number.isFinite(p.y)));
      const connected = graph.flood(source.face, f => f.slope <= Math.tan(48 * Math.PI / 180) && f.minY > plan.island.seaLevel);
      assert.equal(connected.seen[west.face], 1, 'West core lacks a dry terrain route from spawn');
      assert.equal(connected.seen[east.face], 0, 'East core has an unintended dry terrain connection without the bridge');
      return { seed, resolution: plan.terrain.cell, maxSlopeDegrees: 48, dryOnly: true, visitedFaces: connected.visited };
    });
    for (const region of plan.regions) check(`core-area:${seed}:${region.id}`, () => {
      const core = graph.locate(region.core);
      assert.ok(core.face >= 0 && Math.abs(core.y - region.core.y) <= .18, 'Declared core does not sit on its planned terrain surface');
      const component = graph.flood(core.face, f => f.slope < .5 && f.minY > plan.island.seaLevel && [f.a, f.b, f.c].every(p => inside(p, region.domain) && Math.abs(p.y - region.core.y) <= 18)
        && [f.a, f.b, f.c].every((p, i, points) => containedEdge(p, points[(i + 1) % 3], region.domain)));
      assert.ok(component.area >= region.minConnectedArea, `Core-connected useful floor ${component.area} < ${region.minConnectedArea} m2`);
      return { seed, region: region.id, area: component.area, minimum: region.minConnectedArea };
    });
    check(`lateral-surface-width:${seed}`, () => {
      let maximumSlope = 0, maximumResidual = 0, bridgeSamples = 0;
      for (const route of world.routes.filter(r => r.kind === 'surface')) for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1], b = route.points[i], length = distance(a, b), samples = Math.ceil(length / 4);
        for (let k = 0; k <= samples; k++) {
          const crossSteps = Math.ceil(route.width - 1.2), t = k / samples;
          let previous;
          for (let s = 0; s <= crossSteps; s++) {
            const lateral = (s / crossSteps * 2 - 1) * (route.width / 2 - .6);
            const p = { x: a.x + t * (b.x - a.x) - (b.z - a.z) / length * lateral, z: a.z + t * (b.z - a.z) + (b.x - a.x) / length * lateral };
            const targetY = a.y + t * (b.y - a.y), terrain = graph.locate(p), deck = bridgeGraph.locate(p);
            // Select the realized carrier nearest this retained 3D target.
            // A landing can be supported by the deck above carved terrain; the
            // lower path at the same XZ remains attached to its lower target.
            // This is a measurement only: actor movement never uses this choice.
            const candidates = [
              { ...terrain, slope: terrain.face >= 0 ? graph.faces[terrain.face].slope : Infinity, carrier: 'terrain' },
              { ...deck, slope: deck.face >= 0 ? bridgeGraph.faces[deck.face].slope : Infinity, carrier: 'bridge' },
            ].filter(c => c.face >= 0 && Number.isFinite(c.y));
            candidates.sort((a, b) => Math.abs(Math.abs(a.y - targetY) - Math.abs(b.y - targetY)) < 1e-5 ? a.slope - b.slope : Math.abs(a.y - targetY) - Math.abs(b.y - targetY));
            const found = candidates[0];
            assert.ok(found, `${route.id}: declared width has no realized support`);
            if (found.carrier === 'bridge') bridgeSamples++;
            const slope = found.slope, residual = Math.abs(found.y - targetY);
            maximumSlope = Math.max(maximumSlope, slope); maximumResidual = Math.max(maximumResidual, residual);
            assert.ok(slope <= Math.tan(48 * Math.PI / 180), `${route.id} segment ${i} t=${t.toFixed(2)} lateral=${lateral.toFixed(2)}: slope ${slope.toFixed(3)} exceeds controller limit`);
            if (previous) assert.ok(Math.abs(found.y - previous.y) <= Math.tan(48 * Math.PI / 180) * distance(p, previous) + .32, `${route.id}: unsupported lateral step`);
            previous = { ...p, y: found.y };
          }
        }
      }
      return { seed, maximumSlope, maximumResidual, bridgeSamples };
    });
    check(`finite-coast:${seed}`, () => {
      const P = world.terrain.positions;
      for (let k = 0; k < P.length; k += 3) {
        assert.ok(Number.isFinite(P[k]) && Number.isFinite(P[k + 1]) && Number.isFinite(P[k + 2]));
        if (P[k] === world.bounds.min.x || P[k] === world.bounds.max.x || P[k + 2] === world.bounds.min.z || P[k + 2] === world.bounds.max.z) assert.ok(P[k + 1] < plan.island.seaLevel, 'Finite mesh has a dry outer boundary');
      }
    });
    check(`surface-choice-and-edge-drop:${seed}`, () => {
      const bridgeRoute = plan.routes.find(r => r.id === 'bridge'), [a, b] = bridgeRoute.points;
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
      const lowY = graph.locate(middle).y;
      for (const upper of [false, true]) {
        const scene = makePhysics(world);
        try {
          const walker = actor(scene, { ...middle, y: upper ? middle.y : lowY });
          for (let i = 0; i < 90; i++) walker.step();
          assert.ok(walker.grounded, 'Actor has not settled onto a support');
          assert.equal(walker.support()?.collider.handle, (upper ? scene.bridge : scene.terrain).handle, 'Same XZ selected the wrong vertical surface');
          if (!upper) {
            const hit = scene.physics.castRayAndGetNormal(new R.Ray({ x: middle.x, y: lowY + 1.8, z: middle.z }, { x: 0, y: 1, z: 0 }), 100, true, undefined, undefined, undefined, undefined, c => c.handle === scene.bridge.handle);
            assert.ok(hit, 'Bridge underside is missing above the lower path');
            assert.ok(hit.timeOfImpact + 1.8 >= plan.bridge.minClearance, 'Actual collider headroom violates the plan');
          } else {
            const length = distance(a, b), vx = -(b.z - a.z) / length * 1.72, vz = (b.x - a.x) / length * 1.72;
            let airborne = false;
            for (let i = 0; i < 360; i++) { walker.step(vx, vz); if (!walker.grounded) airborne = true; }
            for (let i = 0; i < 300; i++) walker.step();
            assert.ok(airborne, 'Walking beyond the deck edge did not leave the bridge');
            assert.ok(walker.grounded && walker.support()?.collider.handle === scene.terrain.handle, 'Falling off the deck failed to land on the independent lower terrain');
            assert.ok(Math.abs(walker.position().y - graph.locate(walker.position()).y) < .2, 'Edge fall silently retained the upper surface height');
          }
        } finally { scene.physics.free(); }
      }
    });
  }
  if (seeds.length > 1) check('seed-variation', () => assert.ok(signatures.size > 1, 'Seeds generated the same physical bridge contract'));
  rejectMutation('mesh-does-not-contain-routes', p => { p.terrain.halfX = 10; });
  rejectMutation('dry-island-bottom', p => { p.island.bottom = p.island.seaLevel + 20; });
  rejectMutation('island-exceeds-mesh', p => { p.island.radiusX = 500; });
  rejectMutation('missing-living-regions', p => { p.regions = []; });
  rejectMutation('orphan-entrance', p => { p.regions[2].entrances = ['missing']; });
  rejectMutation('impossible-connected-area', p => { p.regions[2].minConnectedArea = 1e9; });
  rejectMutation('outside-core-only', p => { p.regions[2].core = { ...p.regions[2].core, x: 1000 }; });
  rejectMutation('nonfinite-core-only', p => { p.regions[2].core = { ...p.regions[2].core, y: NaN }; });
  rejectMutation('underground-core-only', p => { p.regions[2].core = { ...p.regions[2].core, y: p.regions[2].core.y - 8 }; });
  console.log(JSON.stringify({ status: failures.length ? 'FAIL' : 'PASS', sourceSHA256, seeds, checks, reports, failures }, null, 2));
  assert.equal(failures.length, 0, `${failures.length} independent crossing contract checks failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
