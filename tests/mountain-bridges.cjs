const assert = require('node:assert/strict');
const path = require('node:path');
const { Module } = require('node:module');
const { buildSync } = require('esbuild');

const entry = path.join(__dirname, '../src/world/mountains');
const bundle = buildSync({ stdin: { contents: "export { generateMountainTerrain } from './terrain'; export { planMountainBridge } from './bridge';", resolveDir: entry, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
const compiled = new Module(__filename);
compiled._compile(bundle.outputFiles[0].text, __filename);
const { generateMountainTerrain, planMountainBridge } = compiled.exports;

function reachable(routes) {
  const seen = new Set(['spawn']);
  for (let count = -1; count !== seen.size;) {
    count = seen.size;
    for (const { from, to } of routes) {
      if (seen.has(from)) seen.add(to);
      if (seen.has(to)) seen.add(from);
    }
  }
  return seen;
}

const tiers = new Set(), spans = [], access = new Set();
for (let seed = 0; seed < 48; seed++) {
  const terrain = generateMountainTerrain(seed), plan = planMountainBridge(terrain);
  assert.ok(plan, `No crossing for seed ${seed}`);
  const [a, b] = [plan.from, plan.to].sort((left, right) => left.mountainId.localeCompare(right.mountainId));
  assert.notEqual(a.mountainId, b.mountainId);
  assert.ok([a, b].every(end => terrain.tiers.find(t => t.id === end.tierId)?.accessible));
  tiers.add(a.tierId + '/' + b.tierId);
  spans.push(plan.span);
  const withoutBridge = reachable(terrain.routes);
  const satellite = terrain.tiers.find(t => t.id === 'satellite-1');
  const bridgeOnly = satellite.entry === 'none';
  access.add(bridgeOnly);
  assert.equal(withoutBridge.has(b.tierId), !bridgeOnly, `Wrong satellite approach on seed ${seed}`);
  const linked = reachable([...terrain.routes, { from: a.tierId, to: b.tierId }]);
  assert.ok(terrain.tiers.every(t => !t.accessible || linked.has(t.id)), `Disconnected plateau on seed ${seed}`);
  assert.deepEqual(plan.from, planMountainBridge(terrain).from);
}
assert.ok(tiers.size >= 3 && Math.max(...spans) - Math.min(...spans) > 10);
assert.equal(access.size, 2);

const terrain = generateMountainTerrain(42), bridge = planMountainBridge(terrain);
const stripped = { ...terrain, tiers: [], bridgeAnchors: [bridge.from, bridge.to], trees: [] };
assert.ok(planMountainBridge(stripped));
const centre = bridge.point(bridge.span / 2);
assert.equal(planMountainBridge({ ...stripped, trees: [{ ...centre, radius: .4, height: 8 }] }), null);
assert.equal(planMountainBridge({ ...stripped, sampleHeight: () => centre.y }), null);
assert.equal(planMountainBridge({ ...stripped, bridgeAnchors: [bridge.from, { ...bridge.to, accessible: false }] }), null);
console.log(`PASS 48 seeded crossings, ${tiers.size} distinct tier pairs, both satellite access modes, blocked crossings and repeatability`);
