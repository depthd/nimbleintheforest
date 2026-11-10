const assert = require('node:assert/strict');
const { inspectRegionConnectivity, checkConnectivity } = require('./connectivity.cjs');
const polygon = [[-20, -20], [20, -20], [20, 20], [-20, 20]];
function inspect({ domain = polygon, core = { x: -12, z: 0 }, port = { x: 12, z: 0 }, minArea = 256, height = () => 0, slope = () => 0 } = {}) {
  const region = { id: 'test', x: 0, z: 0, y: 0, tiltX: 0, tiltZ: 0, polygon: domain, access: { core, minConnectedArea: minArea } };
  const land = {
    world: (x, z) => ({ x, z }), waterAt: () => NaN, heightAt: height, slopeAt: slope,
    routes: [{ id: 'arrival', from: 'outside', to: 'test', points: [{ x: -30, z: 0, y: 0 }, { ...port, y: height(port.x, port.z) }] }],
  };
  return inspectRegionConnectivity(land, region);
}
const results = {};
results.flatTerminal = inspect();
assert.deepEqual(results.flatTerminal.failures, []);
assert.equal(results.flatTerminal.connectedUsefulArea, 1296);

// The middle barrier reaches both boundaries. A route exists just outside the
// region's top edge, but it is not a valid internal connection between its ports.
results.externalBypass = inspect({ slope: (x, z) => Math.abs(x) <= 4 && Math.abs(z) <= 20 ? 2 : 0 });
assert.ok(results.externalBypass.failures.some(f => f.includes('disconnected from core')));

// Both sides together contain enough floor, but the component at the core does
// not. Its one entrance remains reachable, isolating the area contract failure.
results.disconnectedArea = inspect({ port: { x: -12, z: 8 }, minArea: 700, slope: x => Math.abs(x) <= 4 ? 2 : 0 });
assert.ok(results.disconnectedArea.ports.every(p => p.reached));
assert.ok(results.disconnectedArea.failures.some(f => f.includes('contract requires 700')));
assert.equal(results.disconnectedArea.connectedUsefulArea, 432);

results.outsidePort = inspect({ port: { x: 24, z: 0 } });
assert.ok(results.outsidePort.failures.some(f => f.includes('outside region.polygon')));

// A region with a single port must not skip validation of its planned floor.
results.buriedTerminalCore = inspect({ height: () => 50 });
assert.ok(results.buriedTerminalCore.failures.some(f => f.includes('core is not useful floor')));

// This 2 m notch sits between raster columns x=0 and x=4. Checking endpoints
// alone would allow a false crossing outside the polygon. The bottom joining
// arm is deliberately blocked so that the only apparent route is the notch.
results.concaveNotch = inspect({
  domain: [[-20, -20], [20, -20], [20, 20], [3, 20], [3, -5], [1, -5], [1, 20], [-20, 20]],
  core: { x: -8, z: 12 }, port: { x: 12, z: 12 },
  slope: (x, z) => z <= -5 && x >= -4 && x <= 8 ? 2 : 0,
});
assert.ok(results.concaveNotch.failures.some(f => f.includes('disconnected from core')));
const treeLand = {
  world: (x, z) => ({ x, z }), waterAt: () => NaN, heightAt: () => 0, slopeAt: () => 0,
  regions: ['lowland', 'cirque'].map(id => ({ id, x: 0, y: 0, z: 0, tiltX: 0, tiltZ: 0, polygon, access: { core: { x: 0, z: 0 }, minConnectedArea: 256 } })),
  routes: [{ id: 'only-entrance', from: 'lowland', to: 'cirque', points: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 8 }] }],
  plan: { traversal: [{ id: 'only-entrance', from: 'lowland', to: 'cirque' }] },
  views: [{ id: 'summit', position: { x: 0, y: 10, z: 0 } }],
};
results.treeWithoutLoops = checkConnectivity(treeLand);
assert.equal(results.treeWithoutLoops.independentLoops, 0);
console.log('PASS: flat terminal, zero-loop tree and five negative topology/area cases');
