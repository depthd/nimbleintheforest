const assert = require('node:assert/strict');
const path = require('node:path');
const { Module } = require('node:module');
const { buildSync } = require('esbuild');

const source = `
  export { Triangle, Vector3 } from 'three';
  export { generateRockCore } from './range-core';
  export { mountainRim, buildMountainSnow, distanceToAscent } from './mountain-snow';
  export { buildMountainMasses, mountainSnowProfile, plateauTop } from './mountain-shape';
  export { radialSurface, surfaceRoof } from './wedge-rocks';
  export { sampleGrid } from './seam-boundary';
  export { ringPoint } from './wedge-snow-layer';
  export { subtract } from './cavity';
  export { mountainTiers } from './mountain-tiers';
  export { stoneSpan } from './stone-span';
  export { mountainHeight } from '../../src/world/mountains/surface-height';
`;
const bundle = buildSync({
  stdin: { contents: source, resolveDir: path.resolve(__dirname, '../experiments/plateau'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
});
const mod = new Module(__filename);
mod._compile('const location = {search:"?seed=42"};\n' + bundle.outputFiles[0].text, __filename);
const api = mod.exports;
const { Triangle, Vector3 } = api;
const { source: ground, upper, junction } = api.generateRockCore();
const rim = api.mountainRim(junction);
const rimAt = a => api.ringPoint(rim, a);
const wallAt = api.radialSurface([api.subtract(junction.cut.underside)]);
const groundAt = (x,z) => api.sampleGrid(ground,x,z).y;
const roofAt = (x,z) => api.sampleGrid(upper,x,z).y;
const roofMeshes = [junction.cut.strip, junction.cut.plateau].map(m => api.subtract(m));
const snow = api.buildMountainSnow(upper, junction, roofMeshes, api.mountainSnowProfile);
const rockRoof = { height: roofAt, clearance: api.surfaceRoof([...roofMeshes, snow.cap]).triangleClearance };
const tiers = api.mountainTiers(true, roofAt, rimAt);

// Exterior panel borders may remain open only where buried in the terrain.
function checkWallBorders(mesh, name) {
  const edges = new Map();
  const p = mesh.positions;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const face = mesh.indices.subarray(i, i + 3);
    if (Math.abs(mesh.finish[3 * face[0] + 1] - 0.32) > 1e-5) continue;
    for (let j = 0; j < 3; j++) {
      const a = face[j], b = face[(j + 1) % 3];
      const key = [Math.min(a,b), Math.max(a,b)].join('/');
      if (edges.has(key)) edges.delete(key);
      else edges.set(key, [a,b]);
    }
  }
  const a = new Vector3(), b = new Vector3(), q = new Vector3();
  for (const [v,w] of edges.values()) {
    a.fromArray(p,3*v);
    b.fromArray(p,3*w);
    q.lerpVectors(a,b,0.5);
    if (q.y < 3 || q.y < groundAt(q.x,q.z) + 0.35) continue;
    if (api.distanceToAscent(q) < 16 || (q.x > 248 && Math.abs(q.z) < 20)) continue;
    const angle = Math.atan2(q.z / 180, q.x / 260);
    const support = wallAt(angle,q.y) ?? rimAt(angle);
    assert.ok(Math.hypot(q.x,q.z) < Math.hypot(support.x,support.z) + 0.1,
      'Exposed panel border on ' + name + ' at ' + q.toArray());
  }
}

// Reported exposed triangle tips on two separate plateaus of seed 42.
for (const [name, tips] of [
  ['lower', [[-258,85],[-200,-63]]],
  ['spur', [[290,59],[173,123],[15,171]]],
]) {
  const tier = tiers.find(t => t.name === name);
  const masses = api.buildMountainMasses(rimAt, wallAt, groundAt, rockRoof, tier.seed, {cave:name==='lower', arch:name==='lower'});
  checkWallBorders(masses.rocks, name);
  const stone = api.mountainHeight([masses.rocks]);
  // A pair of weathered fracture blocks broke through beside the bridge.
  // Check every facet of these wall outcrops against the actual plateau triangles,
  // including intersections occurring between original vertices.
  const mesh = masses.rocks;
  const triangle = [new Vector3(), new Vector3(), new Vector3()];
  let minClearance = Infinity;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const first = mesh.indices[i];
    if (Math.abs(mesh.finish[3 * first + 1] - 0.31) > 1e-5) continue;
    for (let j = 0; j < 3; j++) triangle[j].fromArray(mesh.positions, 3 * mesh.indices[i + j]);
    minClearance = Math.min(minClearance, rockRoof.clearance(triangle));
  }
  assert.ok(minClearance > 0.30, 'Exposed wall outcrop on ' + name + ': ' + minClearance);
  for (const [x,z] of tips) {
    assert.ok(stone(x,z) < roofAt(x,z), `Unburied return on ${name} at ${x}, ${z}`);
  }
}

// Every exposed boundary of the cap, including the transverse ends at a
// fracture, must lie on its own slab. Check mid-edge contact as well as knots.
function checkSpan(seed) {
  const span = api.stoneSpan(seed, api.plateauTop);
  const rock = [];
  for (let i=0; i<span.triangles.length; i+=3) {
    const points = span.triangles.slice(i,i+3).map(id=>new Vector3().fromArray(span.rock,3*id));
    rock.push(new Triangle(...points));
  }
  const edges = new Map();
  for (let i=0; i<span.snowTriangles.length; i+=3) {
    const face = span.snowTriangles.slice(i,i+3);
    for (let k=0; k<3; k++) {
      const a = face[k], b = face[(k+1)%3], key = [Math.min(a,b),Math.max(a,b)].join('/');
      if (edges.has(key)) edges.delete(key);
      else edges.set(key,[a,b]);
    }
  }
  assert.ok(edges.size > 0);
  const nearest = new Vector3();
  for (const [i,j] of edges.values()) {
    const a = new Vector3().fromArray(span.snow,3*i), b = new Vector3().fromArray(span.snow,3*j);
    for (const t of [0,.25,.5,.75,1]) {
      const p = a.clone().lerp(b,t);
      assert.ok(rock.some(tri=>tri.closestPointToPoint(p,nearest).distanceToSquared(p)<1e-10),
        `Unsupported snow edge on arch seed ${seed}`);
    }
  }
}
for (const seed of [0,1,42,817,tiers[0].seed,381105698]) checkSpan(seed);
