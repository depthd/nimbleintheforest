// Check the mountain in generated survival regions, including the slope into its first ramp.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/gen/region.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false });
const compiled = new Module(__filename);
compiled._compile(bundle.outputFiles[0].text, __filename);
const { Region } = compiled.exports;

async function check(seed, size) {
  const region = new Region(seed, size);
  await region.generate();
  const site = region.mountainSite;
  const terrain = region.mountainTerrain;
  assert.ok(site && terrain, `missing mountain, seed ${seed}, ${size} m`);
  const world = p => ({ x: site.x + p.x, z: site.z + p.z });
  assert.ok(!region.inMountainSite(0, 0, 55));
  for (const p of [...region.places, ...region.caves]) assert.ok(!region.inMountainSite(p.x, p.z, 20));
  for (let z = -42; z <= 44; z += 2) for (let x = -73; x <= 170; x += 2) {
    const px = site.x + x, pz = site.z + z;
    assert.ok(Number.isNaN(region.waterAt(px, pz)));
    assert.ok(!region.skin.covers(px, pz));
    assert.ok(Math.abs(region.heightAt(px, pz) - site.y) < .001);
    assert.ok(region.inside(px, pz, 30));
  }
  const landing = terrain.bridgeAnchors[0], bank = world(landing);
  assert.ok(Math.abs(region.outdoorHeightAt(bank.x, bank.z) - (site.y + landing.y)) < .01);
  assert.equal(region.outdoorHeightAt(0, 0), region.heightAt(0, 0));
  const foot = world(terrain.spawn);
  for (let x = foot.x - 46; x < foot.x; x += 2) {
    assert.ok(Math.abs(region.heightAt(x, foot.z) - region.heightAt(x + 2, foot.z)) <= 1.4,
      `abrupt approach at ${x},${foot.z}`);
  }
  let planted = 0;
  region.forEachProp(region.trees, site.x + 49, site.z, 147, i => {
    const { x, y, z, flags } = region.trees;
    if (!region.inMountainSite(x[i], z[i])) return;
    assert.ok(!(flags[i] & 3));
    const t = terrain.trees.find(p => Math.hypot(site.x + p.x - x[i], site.z + p.z - z[i]) < .001);
    assert.ok(t, 'native tree blocked a route');
    assert.ok(Math.abs(y[i] - t.y - site.y) < .001);
    planted++;
  });
  assert.ok(planted > 0);
  assert.equal(planted, terrain.trees.length);
  console.log(`PASS seed ${seed}, ${size} m: foot ${foot.x},${foot.z}; ${planted} living plateau trees`);
}

(async () => {
  for (const [seed, size] of [[42, 3072], [7, 1536], [8191, 2048], [23011, 1536]]) await check(seed, size);
})().catch(error => { console.error(error); process.exitCode = 1; });
