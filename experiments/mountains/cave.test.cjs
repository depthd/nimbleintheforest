'use strict';
const assert = require('node:assert/strict'), path = require('node:path'), Module = require('node:module');
const { buildSync } = require('esbuild'), R = require('@dimforge/rapier3d-compat');
const compiled = new Module(__filename);
compiled._compile(buildSync({ stdin: { contents: "export * from './crossing'; export * from './cave';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename);
const { createCrossingPlan, bakeCrossing, createCavePlan, bakeCave } = compiled.exports;
const seeds = process.env.SEEDS ? process.env.SEEDS.split(',').map(Number) : [1, 6, 19, 42, 71];
const walkSpeed = process.env.WALK_SPEED ? Number(process.env.WALK_SPEED) : 4.58;
assert.ok(Number.isFinite(walkSpeed) && walkSpeed > 0 && walkSpeed <= 6);
const describe = x => JSON.stringify(x);
function physicsFor(w, uncut = false, interior = true) {
    const physics = new R.World({ x: 0, y: -9.81, z: 0 });
    const terrainMesh = uncut ? w.source.terrain : w.terrain;
    const terrain = physics.createCollider(R.ColliderDesc.trimesh(terrainMesh.positions, terrainMesh.indices));
    const cave = interior ? physics.createCollider(R.ColliderDesc.trimesh(w.cave.positions, w.cave.indices)) : null;
    const bridge = physics.createCollider(R.ColliderDesc.trimesh(w.bridge.positions, w.bridge.indices));
    return { physics, terrain, cave, bridge };
}
function walker(physics, first) {
    const body = physics.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(first.x, first.y + .94, first.z));
    const collider = physics.createCollider(R.ColliderDesc.capsule(.6, .3), body), controller = physics.createCharacterController(.03);
    controller.setMaxSlopeClimbAngle(48 * Math.PI / 180); controller.setMinSlopeSlideAngle(55 * Math.PI / 180);
    controller.enableAutostep(.32, .15, false); controller.enableSnapToGround(.35);
    return { body, collider, controller };
}
function densify(points) {
    const result = [points[0]];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], n = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 1.5);
        for (let j = 1; j <= n; j++) { const t = j / n; result.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) }); }
    }
    return result;
}
function walk(w, original, uncut = false) {
    const points = densify(original), { physics, cave } = physicsFor(w, uncut), { body, collider, controller } = walker(physics, points[0]);
    let reached = 0, ticks = 0, vy = 0, stuck = 0, previous = Infinity, maxError = 0, caveSupportFrames = 0;
    while (reached < points.length && ticks++ < 60000) {
        const p = body.translation(), t = points[reached], dx = t.x - p.x, dz = t.z - p.z, distance = Math.hypot(dx, dz), yError = Math.abs(p.y - .9 - t.y);
        if (distance < .45 && yError < .4) { reached++; maxError = Math.max(maxError, yError); stuck = 0; previous = Infinity; continue; }
        const score = distance + yError;
        stuck = score > previous - .002 ? stuck + 1 : 0; previous = score;
        if (stuck > 240 || p.y < -20) break;
        vy = Math.max(-30, vy - 9.81 / 60);
        const speed = distance > .15 ? walkSpeed / 60 : 0;
        controller.computeColliderMovement(collider, { x: distance ? dx / distance * speed : 0, y: vy / 60, z: distance ? dz / distance * speed : 0 });
        const d = controller.computedMovement(); body.setNextKinematicTranslation({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z }); physics.step();
        if (controller.computedGrounded()) vy = -.5;
        const now = body.translation(), hit = physics.castRayAndGetNormal(new R.Ray({ x: now.x, y: now.y - .6, z: now.z }, { x: 0, y: -1, z: 0 }), .8, true, undefined, undefined, collider);
        if (hit && cave && hit.collider.handle === cave.handle && now.x < -32) caveSupportFrames++;
    }
    const report = { reached, total: points.length, ticks, maxError, caveSupportFrames, end: { ...body.translation() } };
    physics.free(); return report;
}
function supports(w) {
    const { physics, terrain, cave } = physicsFor(w), r = w.realization, q = w.plan.roofWitness;
    physics.step();
    const hit = (y, dy, length) => physics.castRayAndGetNormal(new R.Ray({ x: q.x, y, z: q.z }, { x: 0, y: dy, z: 0 }), length, true);
    const lower = hit(r.floorY + 2, -1, 4), roof = hit(r.exteriorY + 3, -1, 5), ceiling = hit(r.floorY + 1, 1, 10);
    assert.ok(lower && roof && ceiling, 'two floors and the inner ceiling must exist at the same XZ');
    assert.equal(lower.collider.handle, cave.handle); assert.equal(roof.collider.handle, terrain.handle); assert.equal(ceiling.collider.handle, cave.handle);
    assert.ok(Math.abs(r.floorY + 2 - lower.timeOfImpact - r.floorY) < .002);
    assert.ok(Math.abs(r.exteriorY + 3 - roof.timeOfImpact - r.exteriorY) < .002);
    assert.ok(Math.abs(r.floorY + 1 + ceiling.timeOfImpact - r.ceilingY) < .002);
    physics.free();
}
function pressure(w, direction, start) {
    const { physics } = physicsFor(w), { body, collider, controller } = walker(physics, start);
    for (let i = 0; i < 250; i++) {
        const p = body.translation(); controller.computeColliderMovement(collider, direction);
        const d = controller.computedMovement(); body.setNextKinematicTranslation({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z }); physics.step();
    }
    const end = { ...body.translation() }; physics.free(); return end;
}
function reject(source, plan, mutate, code) {
    const copy = JSON.parse(JSON.stringify(plan)); mutate(copy); const before = JSON.stringify(copy), result = bakeCave(source, copy);
    assert.equal(result.ok, false); assert.ok(result.issues.some(i => i.code === code), describe(result)); assert.equal(JSON.stringify(copy), before, 'reject without repair');
}
(async () => {
    await R.init(); const reports = [];
    for (const seed of seeds) {
        const base = bakeCrossing(createCrossingPlan(seed)); assert.ok(base.ok, describe(base));
        const source = base.world, oldPositions = source.terrain.positions.slice(), oldIndices = source.terrain.indices.slice(), oldPlan = JSON.stringify(source.plan);
        const plan = createCavePlan(source.plan), planJSON = JSON.stringify(plan), result = bakeCave(source, plan); assert.ok(result.ok, describe(result));
        const w = result.world;
        assert.strictEqual(w.source, source); assert.strictEqual(w.plan, plan); assert.strictEqual(w.route, plan.route); assert.ok(!('heightAt' in w));
        assert.deepEqual(source.terrain.positions, oldPositions); assert.deepEqual(source.terrain.indices, oldIndices); assert.equal(JSON.stringify(source.plan), oldPlan); assert.equal(JSON.stringify(plan), planJSON);
        assert.throws(() => { plan.volume.minX = -80; }, TypeError);
        for (const mesh of [w.terrain, w.cave]) { assert.ok(mesh.positions.every(Number.isFinite)); assert.ok(mesh.indices.every(i => i < mesh.positions.length / 3)); }
        supports(w);
        const roundTrip = [...w.route, ...[...w.route].reverse().slice(1)], walked = walk(w, roundTrip);
        assert.equal(walked.reached, walked.total, describe({ seed, walked })); assert.ok(walked.caveSupportFrames > 100);
        const upper = source.routes.filter(r => r.id === 'ascent' || r.id === 'bridge' || r.id === 'east').flatMap((r, i) => i ? r.points.slice(1) : r.points);
        const upperWalk = walk(w, [...upper, ...[...upper].reverse().slice(1)]);
        assert.equal(upperWalk.reached, upperWalk.total, describe({ seed, upperWalk }));
        const r = w.realization, q = w.plan.roofWitness;
        const ceiling = pressure(w, { x: 0, y: .15, z: 0 }, { x: q.x, y: r.floorY, z: q.z });
        assert.ok(ceiling.y <= r.ceilingY - .88 && ceiling.y > r.ceilingY - 1.1, describe({ ceiling, r }));
        const back = pressure(w, { x: -.15, y: -.05, z: 0 }, { ...w.route[w.route.length - 1] });
        assert.ok(back.x > plan.volume.minX + .25 && back.x < plan.volume.minX + .5, describe({ back }));
        const side = pressure(w, { x: 0, y: -.05, z: .15 }, { x: q.x, y: r.floorY, z: q.z });
        assert.ok(side.z < plan.volume.centerZ + 4.8 && side.z > plan.volume.centerZ + 4.5, describe({ side }));
        reports.push({ seed, ...r, caveTriangles: w.cave.indices.length / 3, roundTrip: walked, upperRoute: { reached: upperWalk.reached, total: upperWalk.total }, ceilingCenterY: ceiling.y, backX: back.x });
        if (seed === seeds[0]) {
            const blocked = walk(w, w.route, true); assert.ok(blocked.reached < blocked.total && blocked.end.x > -32, describe({ blocked }));
            reject(source, plan, p => { p.volume.floor += 1; }, 'invalid-cave-contract');
            reject(source, plan, p => { p.roofWitness.minCover = 100; }, 'cave-roof-cover');
            reject(source, plan, p => { p.volume.maxX = -35; }, 'cave-entrance');
            reject(source, plan, p => { p.route[p.route.length - 1].y += 2; }, 'cave-route');
            reject(source, plan, p => { p.volume.section.reverse(); }, 'invalid-cave-section');
            reject(source, plan, p => { p.volume.section.forEach(s => { s.z *= 4; }); }, 'cave-bounds');
            reject(source, plan, p => { p.volume.centerZ = 1000; }, 'cave-bounds');
            reject(source, plan, p => { p.route[1].x = 999; }, 'cave-route');
            reports[reports.length - 1].uncutNegativeControl = blocked;
        }
    }
    console.log(JSON.stringify({ status: 'PASS', stage: 'same-scene-dead-end-cave', walkSpeed, reports, limitation: 'One straight convex dead-end cavity. These tests certify its designated paths, roof, walls and source immutability; they do not certify all arbitrary cave plans.' }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
