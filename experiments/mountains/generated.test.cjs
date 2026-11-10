// Generated geography: independent plan, baked surface and terrain-only Rapier walks.
// Full scene collisions are exercised separately in generated-browser.cjs.
const assert = require('node:assert/strict');
const path = require('node:path'), Module = require('node:module');
const { buildSync } = require('esbuild'), R = require('@dimforge/rapier3d-compat');
const { inspectRegionConnectivity } = require('./connectivity.cjs');
const m = new Module(__filename);
m._compile(buildSync({ stdin: { contents: "export * from './generated-landforms'; export * from './mountain-plan'; export * from './surface-contract'; export {SIZE,CELL} from './landforms'", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename);
const { GeneratedLandforms, generateMountainPlan, inspectSurface, SIZE, CELL } = m.exports;
function geometry(l) {
    const n = l.n, nf = n + 1, P = new Float32Array(nf * nf * 3), I = new Uint32Array(n * n * 6);
    let k = 0;
    for (let j = 0; j <= n; j++)
        for (let i = 0; i <= n; i++)
            P.set([i * CELL - SIZE / 2, l.heights[j * nf + i], j * CELL - SIZE / 2], (j * nf + i) * 3);
    for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
            const a = j * nf + i, b = a + 1, c = a + nf;
            I.set([a, c, b, b, c, c + 1], k);
            k += 6;
        }
    return { P, I };
}
function walk(l, route) {
    const { P, I } = geometry(l), world = new R.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(R.ColliderDesc.trimesh(P, I));
    const points = l.worldRoute(route), s = points[0], body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(s.x, l.heightAt(s.x, s.z) + 1, s.z)), col = world.createCollider(R.ColliderDesc.capsule(0.6, 0.3), body), k = world.createCharacterController(0.03);
    k.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    k.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    k.enableAutostep(0.32, 0.15, false);
    k.enableSnapToGround(0.35);
    let reached = 0, ticks = 0, vy = 0, stuck = 0, prev = Infinity, maxDelta = 0;
    while (reached < points.length && ticks++ < 45000) {
        const p = body.translation(), v = points[reached], dx = v.x - p.x, dz = v.z - p.z, d = Math.hypot(dx, dz);
        maxDelta = Math.max(maxDelta, Math.abs(p.y - 0.9 - l.heightAt(p.x, p.z)));
        if (d < 1.4) {
            reached++;
            stuck = 0;
            prev = Infinity;
            continue;
        }
        stuck = d >= prev - 0.002 ? stuck + 1 : 0;
        prev = d;
        if (stuck > 180)
            break;
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
        if (k.computedGrounded())
            vy = -0.5;
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
(async () => {
    const topologies = new Set(), counts = new Set();
    for (let seed = 0; seed < 1000; seed++) {
        const p = generateMountainPlan(seed);
        assert.deepEqual(p, generateMountainPlan(seed), `seed ${seed}: plan is not deterministic`);
        assert.ok(Object.isFrozen(p) && Object.isFrozen(p.regions[0].polygon[0]));
        const connected = new Set([p.spawnRegion]);
        for (let i = 0; i < p.regions.length; i++)
            for (const r of p.routes) {
                if (connected.has(r.from))
                    connected.add(r.to);
                if (connected.has(r.to))
                    connected.add(r.from);
            }
        assert.equal(connected.size, p.regions.length, `seed ${seed}: orphan district`);
        assert.ok(p.regions.length >= 5 && p.regions.length <= 9);
        assert.ok(p.regions.filter(r => r.y > 100 && r.kind !== 'crest').length >= 2);
        for (let i = 1; i < p.trunk.length; i++) {
            const a = p.regions.find(r => r.id === p.trunk[i - 1]), b = p.regions.find(r => r.id === p.trunk[i]);
            assert.ok(b.y - a.y >= 15, `seed ${seed}: collapsed vertical progression`);
        }
        for (const r of p.routes) {
            const a = p.regions.find(d => d.id === r.from), b = p.regions.find(d => d.id === r.to);
            assert.deepEqual(r.points[0], { x: a.x, y: a.y, z: a.z });
            assert.deepEqual(r.points.at(-1), { x: b.x, y: b.y, z: b.z });
            assert.equal(r.status, 'planned');
        }
        counts.add(p.regions.length);
        topologies.add(p.regions.length + ':' + p.routes.length);
    }
    assert.ok(counts.size >= 4 && topologies.size >= 10, 'geography count/topology does not vary');
    for (const seed of [-1, 1.5, NaN, 2 ** 32])
        assert.throws(() => generateMountainPlan(seed), /uint32/);
    console.log('PLANS', JSON.stringify({ seeds: 1000, counts: [...counts].sort(), topologies: topologies.size }));
    await R.init();
    let walks = 0;
    for (const seed of (process.env.SEEDS || '42,7,2026,17,91,8191').split(',').map(Number)) {
        const land = new GeneratedLandforms(seed), snapshot = JSON.stringify(land.plan);
        assert.ok(land.heights.every(Number.isFinite));
        assert.equal(land.verification.status, 'terrain-verified');
        if (seed === 42) {
            assert.deepEqual(land.heights, new GeneratedLandforms(seed).heights);
            const buried = Object.create(land);
            buried.heightAt = (x, z) => land.heightAt(x, z) + 25;
            assert.equal(inspectSurface(buried).status, 'rejected', 'buried planned routes must be rejected');
        }
        const regions = land.regions.map(r => inspectRegionConnectivity(land, r));
        for (const r of regions)
            assert.deepEqual(r.failures, [], `seed ${seed} ${r.id}`);
        console.log('SURFACE', seed, JSON.stringify({ regions: regions.map(r => ({ id: r.id, area: r.connectedUsefulArea, ports: r.ports.length })), routes: land.verification.routes }));
        for (const route of land.routes.filter(r => !process.env.ROUTES || process.env.ROUTES.split(',').includes(r.id)))
            for (const direction of ['up', 'down']) {
                const result = walk(land, direction === 'up' ? route : { ...route, points: [...route.points].reverse() });
                console.log('WALK', seed, direction, JSON.stringify(result));
                assert.equal(result.reached, result.total, `seed ${seed} ${route.id} ${direction} stuck`);
                assert.ok(result.maxDelta < 2, `seed ${seed} ${route.id} lost support`);
                walks++;
            }
        assert.equal(JSON.stringify(land.plan), snapshot, 'bake or QA mutated the plan');
    }
    console.log('PASS', JSON.stringify({ plannedSeeds: 1000, terrainWalks: walks }));
})().catch(e => { console.error(e); process.exitCode = 1; });
