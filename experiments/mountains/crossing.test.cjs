'use strict';
const assert = require('node:assert/strict'), path = require('node:path'), Module = require('node:module');
const { buildSync } = require('esbuild'), R = require('@dimforge/rapier3d-compat');
const compiled = new Module(__filename);
compiled._compile(buildSync({ entryPoints: [path.join(__dirname, 'crossing.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename);
const { createCrossingPlan, bakeCrossing } = compiled.exports;
const seeds = process.env.SEEDS ? process.env.SEEDS.split(',').map(Number) : [1, 6, 19, 42, 71];
const walkSpeed = process.env.WALK_SPEED ? Number(process.env.WALK_SPEED) : 1.72;
function densify(points, kind) {
    const out = [{ ...points[0], kind }];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], count = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2);
        for (let j = 1; j <= count; j++) { const t = j / count; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, kind }); }
    }
    return out;
}
function route(world, id, reverse = false) {
    const r = world.routes.find(r => r.id === id), points = reverse ? [...r.points].reverse() : r.points;
    return densify(points, r.kind);
}
function walk(world, points, includeBridge = true) {
    const physics = new R.World({ x: 0, y: -9.81, z: 0 });
    const terrain = physics.createCollider(R.ColliderDesc.trimesh(world.terrain.positions, world.terrain.indices));
    const bridge = includeBridge ? physics.createCollider(R.ColliderDesc.trimesh(world.bridge.positions, world.bridge.indices)) : null;
    const first = points[0], body = physics.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(first.x, first.y + .94, first.z));
    const collider = physics.createCollider(R.ColliderDesc.capsule(.6, .3), body), controller = physics.createCharacterController(.03);
    controller.setMaxSlopeClimbAngle(48 * Math.PI / 180);
    controller.setMinSlopeSlideAngle(55 * Math.PI / 180);
    controller.enableAutostep(.32, .15, false);
    controller.enableSnapToGround(.35);
    let reached = 0, ticks = 0, vy = 0, stuck = 0, previous = Infinity, maxWaypointYError = 0;
    const crossings = { terrain: [], bridge: [] }, cross = world.realization.crossing;
    while (reached < points.length && ticks++ < 150000) {
        const p = body.translation(), target = points[reached], dx = target.x - p.x, dz = target.z - p.z, horizontal = Math.hypot(dx, dz), dy = Math.abs(p.y - .9 - target.y);
        // XZ alone would falsely accept a walker standing in the gorge below the bridge.
        if (horizontal < .55 && dy < .45) { maxWaypointYError = Math.max(maxWaypointYError, dy); reached++; stuck = 0; previous = Infinity; continue; }
        const score = horizontal + dy;
        stuck = score > previous - .003 ? stuck + 1 : 0; previous = score;
        if (stuck > 240 || p.y < -20) break;
        vy = Math.max(-30, vy - 9.81 / 60);
        const speed = horizontal > .15 ? walkSpeed : 0;
        controller.computeColliderMovement(collider, { x: horizontal ? dx / horizontal * speed / 60 : 0, y: vy / 60, z: horizontal ? dz / horizontal * speed / 60 : 0 });
        const movement = controller.computedMovement();
        body.setNextKinematicTranslation({ x: p.x + movement.x, y: p.y + movement.y, z: p.z + movement.z });
        physics.step();
        if (controller.computedGrounded()) vy = -.5;
        const actual = body.translation();
        if (Math.abs(actual.x - cross.x) < .5 && Math.abs(actual.z - cross.z) < .5) {
            const hit = physics.castRayAndGetNormal(new R.Ray({ x: actual.x, y: actual.y - .6, z: actual.z }, { x: 0, y: -1, z: 0 }), .8, true, undefined, undefined, collider);
            if (hit) {
                const name = hit.collider.handle === terrain.handle ? 'terrain' : bridge && hit.collider.handle === bridge.handle ? 'bridge' : 'unknown';
                if (name !== 'unknown') crossings[name].push(actual.y - .9);
            }
        }
    }
    const result = { reached, total: points.length, ticks, maxWaypointYError, crossings, end: { ...body.translation() } };
    physics.free(); return result;
}
function fullLoop(world) {
    // Start at spawn, traverse the lower path out and back, then climb, cross and explore east.
    return [...route(world, 'lower', true), ...route(world, 'lower').slice(1), ...route(world, 'ascent').slice(1), ...route(world, 'bridge').slice(1), ...route(world, 'east').slice(1),
        ...route(world, 'east', true).slice(1), ...route(world, 'bridge', true).slice(1), ...route(world, 'ascent', true).slice(1)];
}
function reject(plan, mutation, expected) {
    const changed = JSON.parse(JSON.stringify(plan)); mutation(changed);
    const snapshot = JSON.stringify(changed), result = bakeCrossing(changed);
    assert.equal(result.ok, false, `invalid plan must fail: ${expected}`);
    assert.ok(result.issues.some(i => i.code === expected), JSON.stringify(result.issues));
    assert.equal(JSON.stringify(changed), snapshot, 'bake must never repair a rejected target');
}
function assertNoLandingOverlap(world) {
    const bridge = world.routes.find(r => r.id === 'bridge'), [a, b] = bridge.points;
    const bounds = [a.x, b.x, a.z - bridge.width / 2, a.z + bridge.width / 2].map(Math.fround);
    const clip = (polygon, coordinate, limit, keepAbove) => {
        const result = [];
        for (let i = 0; i < polygon.length; i++) {
            const p = polygon[i], q = polygon[(i + 1) % polygon.length], dp = (p[coordinate] - limit) * (keepAbove ? 1 : -1), dq = (q[coordinate] - limit) * (keepAbove ? 1 : -1);
            if (dp >= 0) result.push(p);
            if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); result.push({ x: p.x + t * (q.x - p.x), z: p.z + t * (q.z - p.z) }); }
        }
        return result;
    };
    const { positions: p, indices } = world.terrain;
    for (let i = 0; i < indices.length; i += 3) {
        const vertices = Array.from(indices.slice(i, i + 3), j => ({ x: p[j * 3], y: p[j * 3 + 1], z: p[j * 3 + 2] }));
        if (!vertices.every(v => Math.abs(v.y - a.y) < 1e-4)) continue;
        let overlap = vertices;
        for (const [coordinate, limit, above] of [['x', bounds[0], true], ['x', bounds[1], false], ['z', bounds[2], true], ['z', bounds[3], false]]) overlap = clip(overlap, coordinate, limit, above);
        const area = Math.abs(overlap.reduce((sum, v, j) => { const q = overlap[(j + 1) % overlap.length]; return sum + v.x * q.z - v.z * q.x; }, 0)) / 2;
        assert.ok(area < 1e-5, `terrain/deck coplanar landing overlap: ${area}`);
    }
    for (const x of [a.x + 1, b.x - 1]) assert.ok(world.heightAt(x, a.z) <= a.y - world.plan.bridge.thickness - .03, 'landing terrain must clear the deck underside');
}
(async () => {
    await R.init();
    const reports = [], forms = new Set();
    for (const seed of seeds) {
        const plan = createCrossingPlan(seed), snapshot = JSON.stringify(plan), baked = bakeCrossing(plan);
        assert.deepEqual(createCrossingPlan(seed), plan);
        assert.ok(baked.ok, JSON.stringify(baked.issues));
        const w = baked.world;
        assert.equal(JSON.stringify(plan), snapshot);
        assert.strictEqual(w.plan, plan);
        assert.strictEqual(w.routes, plan.routes);
        assert.throws(() => { plan.routes[0].points[0].y = 900; }, TypeError);
        for (const mesh of [w.terrain, w.bridge]) {
            assert.ok(mesh.positions instanceof Float32Array && mesh.indices instanceof Uint32Array);
            assert.ok(mesh.positions.every(Number.isFinite));
            assert.ok(mesh.indices.every(i => i >= 0 && i < mesh.positions.length / 3));
        }
        const c = w.realization.crossing;
        assert.ok(c.clearance >= plan.bridge.minClearance + 20);
        assert.ok(Math.abs(w.heightAt(c.x, c.z) - c.terrainY) < .001);
        assert.ok(c.deckY - w.heightAt(c.x, c.z) > 30, 'bridge must not be baked into the heightfield');
        assertNoLandingOverlap(w);
        const walked = walk(w, fullLoop(w));
        assert.equal(walked.reached, walked.total, JSON.stringify({ seed, walked }));
        assert.ok(walked.crossings.terrain.length > 1 && walked.crossings.bridge.length > 1, 'both crossing levels require the correct supporting collider');
        assert.ok(walked.crossings.terrain.every(y => Math.abs(y - c.terrainY) < .15));
        assert.ok(walked.crossings.bridge.every(y => Math.abs(y - c.deckY) < .15));
        forms.add(JSON.stringify(plan.masses));
        reports.push({ seed, clearance: c.clearance, surfaceResidual: w.realization.maxSurfaceResidual, ticks: walked.ticks, waypoints: walked.total, crossingSamples: { terrain: walked.crossings.terrain.length, bridge: walked.crossings.bridge.length }, maxWaypointYError: walked.maxWaypointYError });
    }
    if (seeds.length > 1) assert.equal(forms.size, seeds.length, 'seed changes actual mass parameters');
    const plan = createCrossingPlan(42), baked = bakeCrossing(plan), world = baked.world;
    const missingBridge = walk(world, [...route(world, 'ascent'), ...route(world, 'bridge').slice(1), ...route(world, 'east').slice(1)], false);
    assert.ok(missingBridge.reached < missingBridge.total, 'without bridge collision the upper route must fail, even when XZ is reachable below');
    assert.equal(missingBridge.crossings.bridge.length, 0);
    const crossing = world.realization.crossing;
    const underDeck = walk(world, [{ x: crossing.x, y: crossing.terrainY, z: crossing.z, kind: 'surface' }, { x: crossing.x, y: crossing.deckY, z: crossing.z, kind: 'bridge' }]);
    assert.equal(underDeck.reached, 1, 'being directly beneath a bridge waypoint cannot count as reaching it');
    reject(plan, p => { p.bridge.minClearance = 100; }, 'bridge-clearance');
    reject(plan, p => { p.bridge.thickness = world.realization.crossing.deckY - world.realization.crossing.terrainY - 1; }, 'bridge-clearance');
    reject(plan, p => { p.routes.find(r => r.id === 'bridge').points[0].y += 1; }, 'planned-junction');
    reject(plan, p => { p.terrain.halfX = 10; }, 'route-outside-mesh');
    reject(plan, p => { p.regions = []; }, 'invalid-regions');
    reject(plan, p => { p.regions[2].core.x = 500; }, 'invalid-region');
    reject(plan, p => { p.regions[2].entrances.push('ascent'); }, 'invalid-region');
    reject(plan, p => { p.island.bottom = 1; }, 'invalid-contract');
    reject(plan, p => { p.terrain.cell = 0; }, 'invalid-contract');
    reject(plan, p => { p.island.radiusX = 10000; }, 'island-outside-mesh');
    assert.throws(() => createCrossingPlan(NaN), RangeError);
    console.log(JSON.stringify({ status: 'PASS', stage: 'hybrid-crossing-prototype', walkSpeed, reports, noBridge: { reached: missingBridge.reached, total: missingBridge.total, end: missingBridge.end },
        limitation: 'This is one predefined crossing structure with varied dimensions; physics route checks do not certify the absence of every unplanned terrain bypass.' }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
