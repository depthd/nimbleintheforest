// Behaviour and storage limits before integration with rendering/character code.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const THREE = require('three');
const compiled = new Module(__filename);
compiled._compile(buildSync({ entryPoints: [path.join(__dirname, '../src/world/snow-field.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['three'] }).outputFiles[0].text, __filename);
const { SnowField, CELL } = compiled.exports;
let checks = 0;
const test = (name, run) => { run(); checks++; console.log('PASS ', name); };
const pose = (x, y, z, yaw = 0, pitch = 0) => ({ position: new THREE.Vector3(x, y, z),
  rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')) });
const make = (ratio = 2.6) => new SnowField({ thickness: 0.28, densityRatio: ratio });

test('pristine snow has one common thickness; reading never allocates detailed tiles', () => {
  const f = make();
  for (let i = 0; i < 10000; i++) assert.equal(f.sample(i * 3.1, -i * 7).height, 0.28);
  assert.equal(f.stats().tiles, 0);
});
test('a boot compacts rather than deletes snow; rims retain displaced material', () => {
  const f = make(); const p = pose(0, 0.115, 0);
  f.sweepBoot(p, p);
  assert.ok(f.sample(0, 0).height < 0.14);
  assert.ok(f.sample(0, 0).compaction > 0.5);
  assert.ok(Math.abs(f.massChange()) < 0.00002, f.massChange());
  assert.ok(f.stats().raisedCells > 0);
});
test('standing saturates; it cannot drill endlessly through the base', () => {
  const f = make(), p = pose(0, 0.115, 0);
  f.sweepBoot(p, p); const before = f.sample(0, 0).height;
  for (let i = 0; i < 600; i++) f.sweepBoot(p, p);
  assert.equal(f.sample(0, 0).height, before);
  assert.ok(before > 0);
});
test('settling feedback reaches a stable loaded height instead of pumping mass away', () => {
  const f = make();
  for (let i = 0; i < 600; i++) { const p = pose(0, f.support(0, 0) + 0.012, 0); f.sweepBoot(p, p); }
  const h = f.support(0, 0), volume = f.massChange();
  for (let i = 0; i < 600; i++) { const p = pose(0, f.support(0, 0) + 0.012, 0); f.sweepBoot(p, p); }
  assert.ok(h > 0.09);
  assert.ok(Math.abs(f.support(0, 0) - h) < 0.001);
  assert.ok(Math.abs(volume) < 0.00002);
});
test('continuous dragging fills the entire trajectory, including tile boundaries', () => {
  const f = make(); f.sweepBoot(pose(3, 0.11, -0.04), pose(3.6, 0.11, -0.04));
  for (let x = 3.04; x < 3.6; x += CELL) assert.ok(f.sample(x, -0.04).height < 0.16, x);
  assert.ok(f.sample(3.3, 0.5).height > 0.27);
});
test('vertical extraction and flight do not create lateral marks', () => {
  const f = make(), down = pose(0, 0.115, 0);
  f.sweepBoot(down, down);
  f.sweepBoot(down, pose(0, 0.7, 0));
  f.sweepBoot(pose(0, 0.7, 0), pose(0.7, 0.7, 0));
  assert.equal(f.sample(0.5, 0).height, 0.28);
  assert.ok(f.sample(0, 0).height < 0.14);
});
test('rotation and toe-off affect only the swept boot volume', () => {
  const f = make(); f.sweepBoot(pose(0, 0.11, 0), pose(0, 0.11, 0, Math.PI / 2));
  assert.ok(f.sample(-0.12, 0).height < 0.2);
  assert.equal(f.sample(0.4, 0.4).height, 0.28);
});
test('sweep is stable across physics step sizes and teleport leaves no connecting trench', () => {
  const a = make(), b = make();
  a.sweepBoot(pose(0, 0.11, 0), pose(0.8, 0.11, 0));
  for (let i = 0; i < 60; i++) b.sweepBoot(pose(i * 0.8 / 60, 0.11, 0), pose((i + 1) * 0.8 / 60, 0.11, 0));
  for (let x = 0; x < 0.8; x += CELL) assert.ok(Math.abs(a.sample(x, 0).height - b.sample(x, 0).height) < 0.008);
  a.sweepBoot(pose(1, 0.11, 0), pose(20, 0.11, 0));
  assert.equal(a.sample(10, 0).height, 0.28);
});
test('firm snow supports the same boot higher than powder', () => {
  assert.ok(make(1.2).support(0, 0) - make().support(0, 0) > 0.1);
});
test('digging stops at the base and filling returns the measured quantity', () => {
  const f = make(); let carried = 0;
  for (let i = 0; i < 10; i++) carried += f.remove(0, 0, 0.3, 0.08);
  assert.equal(f.sample(0, 0).height, 0);
  assert.ok(carried > 0);
  f.add(1, 0, 0.3, carried);
  assert.ok(f.sample(1, 0).height > 0.28);
  assert.ok(Math.abs(f.massChange()) < 0.00003, f.massChange());
});
test('long exploration bounds hot storage and revisiting restores exact deformations', () => {
  const f = make(), p = pose(0, 0.11, 0); f.sweepBoot(p, p);
  const first = f.sample(0, 0);
  for (let i = 1; i <= 1000; i++) { const p = pose(i * 0.65, 0.11, i % 2 ? 0.15 : -0.15); f.sweepBoot(p, p); }
  const stats = f.stats();
  assert.ok(stats.hotTiles <= 32, JSON.stringify(stats));
  assert.ok(stats.bytes < 4 * 1024 * 1024, JSON.stringify(stats));
  assert.deepEqual(f.sample(0, 0), first);
  console.log('  1000 contacts / 650 m:', JSON.stringify(stats));
});
test('fast renderer queries agree with material queries, including negative and archived tiles', () => {
  const f = make(); const p = pose(-3.24, 0.11, -0.04); f.sweepBoot(p, p);
  for (let i = 0; i < 100; i++) { const p = pose(i * 4, 0.11, 0); f.sweepBoot(p, p); }
  for (let z = -5; z <= 5; z++) for (let x = -85; x <= -75; x++) {
    const s = f.sample(x * CELL, z * CELL);
    assert.ok(Math.abs(f.gridValue(x, z) - s.height) < 1e-7);
    assert.ok(Math.abs(f.gridValue(x, z, true) - s.compaction) < 1e-7);
  }
});
const rendererModule = new Module(__filename);
rendererModule._compile(buildSync({ entryPoints: [path.join(__dirname, '../src/world/snow-renderer.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['three'] }).outputFiles[0].text, __filename);
const { SnowRenderer } = rendererModule.exports;
test('rendering a kilometre reuses the same GPU geometries, with fixed vertex/draw budgets', () => {
  const f = make(), r = new SnowRenderer(f, 0, { minX: -20, minZ: -20, maxX: 1100, maxZ: 20 });
  r.update(new THREE.Vector3());
  const geometries = new Set(r.group.children.map(o => o.geometry));
  for (let i = 0; i < 100; i++) r.update(new THREE.Vector3(i * 10, 0, 0));
  assert.equal(r.stats().meshes, 50);
  assert.ok(r.stats().vertices <= 70000);
  assert.ok(r.group.children.every(o => geometries.has(o.geometry)));
  assert.equal(f.stats().tiles, 0, 'streaming pristine terrain allocated mutable snow');
});
test('a local boot updates a small dirty rectangle, and shared tile edges agree', () => {
  const f = make(), r = new SnowRenderer(f, 0, { minX: -20, minZ: -20, maxX: 20, maxZ: 20 });
  r.update(new THREE.Vector3(3.2, 0, 0));
  const p = pose(3.2, 0.11, 0); f.sweepBoot(p, p); r.update(new THREE.Vector3(3.2, 0, 0));
  assert.ok(r.stats().updatedVertices > 0 && r.stats().updatedVertices < 2000, r.stats().updatedVertices);
  const fine = r.group.children.filter(m => m.geometry.attributes.position.count === 81 ** 2);
  const a = fine.find(m => m.position.x === 0 && m.position.z === 0);
  const b = fine.find(m => m.position.x === 3.2 && m.position.z === 0);
  for (let row = 0; row <= 80; row++) assert.equal(a.geometry.attributes.position.getY(row * 81 + 80), b.geometry.attributes.position.getY(row * 81));
});
const terrainModule = new Module(__filename);
terrainModule._compile(buildSync({ entryPoints: [path.join(__dirname, '../src/world/snow-test-terrain.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['three'] }).outputFiles[0].text, __filename);
const { SnowTestTerrain, snowRetention, SNOW_HILLS } = terrainModule.exports;
const bounds = { minX: 30, maxX: 50, minZ: 8, maxZ: 72 };
const ground = new SnowTestTerrain(10, bounds);
test('slope retention decreases continuously, keeping flats and exposing steep faces', () => {
  let last = 1;
  for (let degrees = 0; degrees <= 90; degrees += 0.1) {
    const value = snowRetention(degrees);
    assert.ok(value <= last + 1e-8 && value >= 0 && last - value < 0.005);
    last = value;
  }
  assert.equal(snowRetention(0), 1); assert.equal(snowRetention(15), 1); assert.equal(snowRetention(65), 0);
  const faces = SNOW_HILLS.map(h => ground.retentionAt(h.x + h.rx / 2, h.z));
  assert.ok(faces[0] > 0.9 && faces[1] < 0.65 && faces[2] < 0.06, JSON.stringify(faces));
});
test('hill thickness derives from the immutable base; digging cannot change its slope rule', () => {
  const f = new SnowField({ thickness: 0.28, densityRatio: 2.6, base: ground.heightAt, coverage: ground.retentionAt });
  const x = 47.2, z = 51, initial = f.sample(x, z).height, cover = ground.retentionAt(x, z);
  assert.ok(initial < 0.2 && initial > 0.1, initial);
  const p = pose(x, ground.heightAt(x, z) + f.support(x, z) + 0.012, z);
  p.rotation.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ground.normalAt(x, z));
  f.sweepBoot(p, p);
  assert.ok(Math.abs(f.massChange()) < 0.00002);
  let volume = 0;
  for (let i = 0; i < 10; i++) volume += f.remove(x, z, 0.3, 0.1);
  assert.equal(f.sample(x, z).height, 0);
  assert.equal(ground.retentionAt(x, z), cover);
  f.add(x, z, 0.3, volume);
  assert.ok(Math.abs(f.massChange()) < 0.00003);
  assert.equal(f.stats().tiles <= 4, true);
});
test('near and far snow both follow hills; streaming retains the fixed mesh pool', () => {
  const f = new SnowField({ thickness: 0.28, densityRatio: 2.6, base: ground.heightAt, coverage: ground.retentionAt });
  const r = new SnowRenderer(f, 10, bounds); r.update(new THREE.Vector3(40, 10, 24));
  let compared = 0;
  for (const mesh of r.group.children) {
    const p = mesh.geometry.attributes.position;
    if (mesh.rotation.x !== 0 || p.count !== 81 ** 2) continue;
    for (let i = 0; i < p.count; i += 101) {
      const x = mesh.position.x + p.getX(i), z = mesh.position.z + p.getZ(i);
      const expected = ground.heightAt(x, z) + f.sample(x, z).height;
      assert.ok(Math.abs(expected - p.getY(i)) < 0.00002, `${expected} vs ${p.getY(i)}`); compared++;
    }
  }
  assert.ok(compared > 100);
  const far = r.group.children.at(-1), p = far.geometry.attributes.position;
  for (let i = 0; i < p.count; i += 103) {
    const x = far.position.x + p.getX(i), z = far.position.z - p.getY(i);
    const expected = ground.heightAt(x, z) + f.initialThickness(x, z);
    assert.ok(Math.abs(far.position.y + p.getZ(i) - expected) < 0.00002);
  }
  const pool = new Set(r.group.children.map(o => o.geometry));
  r.update(new THREE.Vector3(46, 10, 51));
  assert.ok(r.group.children.every(o => pool.has(o.geometry)));
  assert.equal(f.stats().tiles, 0);
});
console.log(`\n${checks} snow checks passed`);
