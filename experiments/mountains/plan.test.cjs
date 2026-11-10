'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const compiled = new Module(__filename);
compiled._compile(buildSync({ entryPoints: [path.join(__dirname, 'plan.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename);
const { PLAN_VERSION, generateWorldPlan, validateWorldPlan, attachRegion, addLoop, planRegion, polygonArea } = compiled.exports;
const seeds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const counts = new Set(), graphInvariants = new Set(), fixedCountInvariants = new Set(), summary = [];
function inside(p, polygon, margin = 0) {
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length], dx = b.x - a.x, dz = b.z - a.z;
        assert.ok((dx * (p.z - a.z) - dz * (p.x - a.x)) / Math.hypot(dx, dz) >= margin - 1e-6, 'reserved geometry must remain inside polygon with margin');
    }
}
function checkPath(p) {
    assert.equal(p.plannedProfile.length, 2);
    const [a, b] = p.plannedProfile, run = Math.hypot(b.x - a.x, b.z - a.z);
    assert.ok(run >= p.minLength - 1e-6 && run <= p.maxLength + 1e-6);
    assert.ok(Math.abs(b.y - a.y) / run <= p.maxSlope + 1e-6);
    assert.ok(p.width >= 10 && p.clearance >= 4);
    const area = polygonArea(p.reservation), expected = (run + p.width + 2 * p.clearance) * (p.width + 2 * p.clearance);
    assert.ok(Math.abs(area - expected) < 1e-6, 'reservation must include width, clearance and end caps');
}
function checkPlan(plan) {
    assert.deepEqual(validateWorldPlan(plan), []);
    assert.equal(plan.island.seaLevel, 0);
    assert.equal(plan.island.drySurfaceMargin, 3);
    const dryFloor = plan.island.seaLevel + plan.island.drySurfaceMargin;
    const regions = new Map(plan.regions.map(r => [r.id, r])), seen = new Set([plan.spawnRegion]);
    const queue = [plan.spawnRegion];
    for (const id of queue) for (const c of plan.connections) {
        const next = c.from === id ? c.to : c.to === id ? c.from : null;
        if (next !== null && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
    assert.equal(seen.size, plan.regions.length, 'no region may be orphaned');
    for (const r of plan.regions) {
        r.domain.forEach(p => inside(p, plan.island.polygon, plan.island.margin));
        r.domain.forEach(p => assert.ok(r.elevation + (p.x - r.profile.origin.x) * r.profile.tiltX + (p.z - r.profile.origin.z) * r.profile.tiltZ >= dryFloor - 1e-7, 'the whole planned region floor must stay above sea plus dry margin'));
        r.core.forEach(p => inside(p, r.domain));
        inside(r.access.core, r.core);
        assert.ok(polygonArea(r.core) >= r.access.minConnectedArea && r.access.minConnectedArea > 0);
        assert.ok(r.ports.length >= 1 || plan.regions.length === 1);
        for (const port of r.ports) {
            assert.equal(port.regionId, r.id);
            const p = port.localAccess;
            checkPath(p);
            p.reservation.forEach(v => inside(v, r.domain));
            assert.deepEqual(p.plannedProfile[0], { ...r.access.core, y: r.elevation });
            assert.deepEqual(p.plannedProfile.at(-1), port.position);
            p.plannedProfile.forEach(v => assert.ok(Math.abs(v.y - (r.elevation + (v.x - r.profile.origin.x) * r.profile.tiltX + (v.z - r.profile.origin.z) * r.profile.tiltZ)) < 1e-7));
        }
    }
    for (const c of plan.connections) {
        assert.equal(c.kind, 'surface');
        assert.equal(c.status, 'planned');
        checkPath(c);
        c.plannedProfile.forEach(p => assert.ok(p.y >= dryFloor - 1e-7, 'planned surface profiles must remain dry'));
        c.reservation.forEach(p => inside(p, plan.island.polygon, plan.island.margin));
        const from = regions.get(c.from).ports.find(p => p.id === c.fromPort), to = regions.get(c.to).ports.find(p => p.id === c.toPort);
        assert.equal(from.connectionId, c.id);
        assert.equal(to.connectionId, c.id);
        assert.deepEqual(c.plannedProfile, [from.position, to.position]);
    }
}
let smallDegrees = 0, smallCount = 0, largeDegrees = 0, largeCount = 0;
for (const seed of seeds) {
    const result = generateWorldPlan(seed);
    assert.ok(result.ok, `seed ${seed}: ${result.message}`);
    assert.deepEqual(generateWorldPlan(seed), result, 'same seed and config must reproduce geometry, graph and diagnostics');
    const plan = result.plan;
    checkPlan(plan);
    const degrees = plan.regions.map(r => r.ports.length).sort((a, b) => a - b);
    // Different degree sequences prove non-isomorphism without conflating rotations with new graphs.
    counts.add(plan.regions.length);
    graphInvariants.add(`${plan.regions.length}:${degrees.join(',')}`);
    if (plan.regions.length === 7) fixedCountInvariants.add(degrees.join(','));
    const areas = plan.regions.map(r => polygonArea(r.domain));
    assert.ok(Math.max(...areas) / Math.min(...areas) > 1.2, 'region areas are unequal');
    assert.ok(new Set(plan.regions.map(r => r.elevation)).size === plan.regions.length, 'local elevations are independent values');
    for (const r of plan.regions) {
        if (polygonArea(r.domain) < 15000) { smallCount++; smallDegrees += r.ports.length; }
        else { largeCount++; largeDegrees += r.ports.length; }
    }
    summary.push({ seed, regions: plan.regions.length, connections: plan.connections.length, degrees, attempts: result.diagnostics.attachmentAttempts });
}
assert.ok(counts.size >= 3, 'at least three region counts across the fixed seeds');
assert.ok(graphInvariants.size >= 6, 'several proven non-isomorphic graphs');
assert.ok(fixedCountInvariants.size >= 3, 'graphs also differ for the same region count');
assert.ok(largeDegrees / largeCount > smallDegrees / smallCount, 'larger areas receive more links on the fixed seed set');

function initial(center = { x: 0, z: 0 }, radii = { x: 100, z: 85 }) {
    return { seed: 42, version: PLAN_VERSION, island: { polygon: [{ x: -600, z: -600 }, { x: 600, z: -600 }, { x: 600, z: 600 }, { x: -600, z: 600 }], margin: 18, seaLevel: 0, drySurfaceMargin: 3 },
        spawnRegion: 'r0', regions: [planRegion('r0', center, radii, 30)], connections: [] };
}
// A useful small pocket is legal with exactly one entrance and reserved access to its core.
const base = initial(), before = JSON.stringify(base);
const pocket = attachRegion(base, planRegion('pocket', { x: 245, z: 0 }, { x: 46, z: 39 }, 58), 'r0', { width: 10, clearance: 4 });
assert.ok(pocket.ok);
assert.equal(JSON.stringify(base), before);
checkPlan(pocket.plan);
assert.equal(pocket.plan.regions.find(r => r.id === 'pocket').ports.length, 1);
assert.ok(polygonArea(pocket.plan.regions[1].domain) < polygonArea(pocket.plan.regions[0].domain) / 3);

// Rejected candidates leave neither a region, an edge, nor an endpoint port behind.
const invalid = attachRegion(pocket.plan, planRegion('outside', { x: 750, z: 0 }, { x: 70, z: 70 }, 60), 'pocket');
assert.equal(invalid.ok, false);
assert.strictEqual(invalid.plan, pocket.plan);
assert.ok(invalid.issues.some(i => i.code === 'domain-outside-island'));
checkPlan(invalid.plan);
const steep = attachRegion(base, planRegion('steep', { x: 245, z: 0 }, { x: 46, z: 39 }, 350), 'r0');
assert.equal(steep.ok, false);
assert.ok(steep.issues.some(i => i.code === 'path-slope'));
assert.strictEqual(steep.plan, base);

// Reject submerged profiles atomically; never clamp a candidate into a different height contract.
const submergedRegion = planRegion('submerged', { x: 245, z: 0 }, { x: 46, z: 39 }, -4);
const submerged = attachRegion(base, submergedRegion, 'r0');
assert.equal(submerged.ok, false);
assert.ok(submerged.issues.some(i => i.code === 'region-below-dry-surface'));
assert.ok(submerged.issues.some(i => i.code === 'surface-below-dry-surface'));
assert.strictEqual(submerged.plan, base);
assert.equal(submergedRegion.elevation, -4);
// Its center and port are dry, but the tilted domain edge violates the three-meter margin.
const wetEdge = attachRegion(base, planRegion('wet-edge', { x: 245, z: 0 }, { x: 46, z: 39 }, 5, { x: 0, z: .09 }), 'r0');
assert.equal(wetEdge.ok, false);
assert.ok(wetEdge.issues.some(i => i.code === 'region-below-dry-surface'));
assert.ok(!wetEdge.issues.some(i => i.code === 'surface-below-dry-surface'));
assert.strictEqual(wetEdge.plan, base);

// The four corners form a connected graph; the second diagonal is an illegal surface crossing.
let corners = initial({ x: -150, z: -150 }, { x: 64, z: 64 });
for (const [id, x, z, parent] of [['r1', 150, 150, 'r0'], ['r2', -150, 150, 'r1'], ['r3', 150, -150, 'r0']]) {
    const next = attachRegion(corners, planRegion(id, { x, z }, { x: 64, z: 64 }, 30), parent);
    assert.ok(next.ok, JSON.stringify(next.issues));
    corners = next.plan;
}
const crossing = addLoop(corners, 'r2', 'r3');
assert.equal(crossing.ok, false);
assert.ok(crossing.issues.some(i => i.code === 'surface-crossing'));
assert.strictEqual(crossing.plan, corners);
checkPlan(corners);

// A geometric impossibility returns an explained failure, never a substitute map.
const failed = generateWorldPlan(4, { regionCount: 8, islandRadius: 190, attemptsPerRegion: 12 });
assert.equal(failed.ok, false);
assert.equal(failed.code, 'placement-exhausted');
assert.ok(failed.message && Object.keys(failed.diagnostics.rejected).length);
assert.ok(failed.partialPlan && failed.partialPlan.regions.length < 8);
assert.deepEqual(validateWorldPlan(failed.partialPlan), []);
assert.deepEqual(generateWorldPlan(4, { regionCount: 8, islandRadius: 190, attemptsPerRegion: 12 }), failed);
assert.equal(generateWorldPlan(NaN).code, 'invalid-config');
assert.equal(generateWorldPlan(1, { maxLoops: -1 }).code, 'invalid-config');

// The plan is a retained target. A later terrain sample must live in a separate realization report.
const retained = pocket.plan.connections[0], target = JSON.stringify(retained.plannedProfile);
const realizedSamples = retained.plannedProfile.map(p => ({ ...p, y: p.y + 23 }));
assert.notDeepEqual(realizedSamples, retained.plannedProfile);
assert.throws(() => { retained.plannedProfile[0].y = realizedSamples[0].y; }, TypeError);
assert.throws(() => { retained.plannedProfile.push(realizedSamples[0]); }, TypeError);
assert.equal(JSON.stringify(retained.plannedProfile), target);
const corrupted = JSON.parse(JSON.stringify(pocket.plan));
corrupted.connections[0].plannedProfile[1].y += 1000;
assert.ok(validateWorldPlan(corrupted).some(i => i.code === 'path-slope'));
assert.ok(validateWorldPlan(corrupted).some(i => i.code === 'missing-port-or-profile-mismatch'));

console.log(JSON.stringify({ status: 'PASS', stage: 'pre-terrain-plan-only', seeds: seeds.length, regionCounts: [...counts].sort(), graphInvariants: graphInvariants.size,
    sameCountGraphInvariants: fixedCountInvariants.size, meanDegree: { small: smallDegrees / smallCount, large: largeDegrees / largeCount }, summary }, null, 2));
