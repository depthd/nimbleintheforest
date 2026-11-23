// Surface/footwear decisions and accepted-contact snapshots, without a renderer.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const THREE = require('three');
function load(file) {
  const m = new Module(__filename);
  m._compile(buildSync({ entryPoints: [path.join(__dirname, '../src/game', file)], bundle: true,
    platform: 'node', format: 'cjs', write: false, external: ['three'] }).outputFiles[0].text, __filename);
  return m.exports;
}
const { footstepSurface, footwearFor, footstepSound, isWoodenFootstepOwner } = load('footstep-surface.ts');
const { Locomotion } = load('locomotion.ts');
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ', name); }

test('a real wooden support over a lake stays wood even when snowy ground is below', () => {
  assert.equal(footstepSurface({ support: 10, woodenSupport: true, terrainSupport: false }).material, 'wood');
  assert.equal(footstepSurface({ support: 10, woodenSupport: true, iceSupport: true, snowDepth: 0.2 }).material, 'wood');
});
test('only the accepted ice collider selects ice, never a map coordinate or snow state', () => {
  assert.equal(footstepSurface({ support: 20, iceSupport: true, compaction: 0.9 }).material, 'ice');
  assert.equal(footstepSurface({ support: 21, compaction: 0.9 }).material, 'stone');
  assert.equal(footstepSurface({ support: undefined, iceSupport: true }).material, 'stone');
});
test('validated loose snow and exposed packed base both have bounded physical compaction', () => {
  assert.deepEqual(footstepSurface({ support: 30, snowDepth: 0.12, compaction: 0.3 }), { material: 'snow', compaction: 0.3 });
  assert.deepEqual(footstepSurface({ support: 30, terrainSupport: true, packedSnow: true, snowDepth: 0 }),
    { material: 'snow', compaction: 1 });
  assert.equal(footstepSurface({ support: 30, snowDepth: 0.12, compaction: 4 }).compaction, 1);
  assert.equal(footstepSurface({ support: 30, snowDepth: 0.12, compaction: NaN }).compaction, 0);
});
test('bare ground, missing support and snow-free test fixtures use a hard fallback', () => {
  assert.equal(footstepSurface({ support: 30, terrainSupport: true, snowDepth: 0 }).material, 'stone');
  assert.equal(footstepSurface({}).material, 'stone');
  assert.equal(footstepSurface({ support: 0 }).material, 'stone');
  assert.equal(footstepSound(undefined), 'step_stone');
});
test('shoe profiles follow all current feet-slot items and removal', () => {
  assert.equal(footwearFor('sneakers'), 'sneaker');
  assert.equal(footwearFor('boots'), 'boot');
  assert.equal(footwearFor('valenki'), 'soft');
  assert.equal(footwearFor('unty'), 'soft');
  assert.equal(footwearFor(undefined), 'bare');
});
test('accepted wooden furniture tops sound wood without treating mattresses or unknown containers as wood', () => {
  for (const defId of ['chair', 'stool', 'table', 'wardrobe', 'cabinet', 'crate', 'chest', 'bench', 'workbench', 'block', 'shelf']) {
    const owner = { kind: 'item', defId, data: {} };
    assert.equal(isWoodenFootstepOwner(owner), true, defId);
    assert.equal(footstepSurface({ support: 12, woodenSupport: isWoodenFootstepOwner(owner) }).material, 'wood', defId);
  }
  for (const owner of [undefined, { kind: 'item', defId: 'bed' }, { kind: 'item', defId: 'blanket' },
    { kind: 'stove' }, { kind: 'container' }]) assert.equal(isWoodenFootstepOwner(owner), false);
  assert.equal(isWoodenFootstepOwner({ kind: 'part', data: { wood: {} } }), true);
  assert.equal(isWoodenFootstepOwner({ kind: 'door' }), true);
});

const dt = 1 / 60;
function fixture() {
  let compaction = 0.15;
  const m = new Locomotion();
  const input = { position: new THREE.Vector3(), yaw: 0, pitch: 0, grounded: true,
    crouch: false, sprinting: false, suspended: false };
  const probe = (x, z) => ({ point: new THREE.Vector3(x, 0, z), normal: new THREE.Vector3(0, 1, 0),
    support: x < 0 ? 100 : 101, material: x < 0 ? 'snow' : 'wood', snowDepth: x < 0 ? 0.12 : undefined,
    compaction: x < 0 ? compaction : undefined });
  m.reset(input, probe);
  return { m, input, probe, deform: () => { compaction = 0.9; } };
}
test('accepted contacts retain each foot support and pre-deformation snow snapshot', () => {
  const { m, input, probe, deform } = fixture();
  const found = [];
  for (let i = 0; i < 180; i++) {
    input.position.z -= 1.6 * dt;
    m.update(dt, input, probe);
    for (const c of m.contacts) found.push(c);
  }
  assert.ok(found.length >= 4);
  assert.ok(found.some(c => c.material === 'snow'));
  assert.ok(found.some(c => c.material === 'wood'));
  for (const c of found) {
    assert.equal(c.support, c.side === 'left' ? 100 : 101);
    assert.equal(c.material, c.side === 'left' ? 'snow' : 'wood');
  }
  deform();
  for (const c of found.filter(c => c.material === 'snow')) {
    assert.equal(c.compaction, 0.15);
    assert.equal(c.snowDepth, 0.12);
  }
});
test('zero-dt updates clear spent contacts without generating or advancing a step', () => {
  const { m, input, probe } = fixture();
  for (let i = 0; i < 180 && !m.contacts.length; i++) {
    input.position.z -= 1.6 * dt;
    m.update(dt, input, probe);
  }
  assert.ok(m.contacts.length);
  const serial = m.stepSerial;
  m.update(0, input, probe);
  assert.equal(m.contacts.length, 0);
  assert.equal(m.stepSerial, serial);
});
test('landing keeps accepted surface once, and reset/suspension remain silent', () => {
  const { m, input, probe } = fixture();
  m.update(dt, input, probe);
  assert.equal(m.contacts.length, 0);
  input.grounded = false;
  m.update(dt, input, probe);
  input.grounded = true;
  m.update(dt, input, probe);
  assert.equal(m.contacts.filter(c => c.landing).length, 1);
  assert.equal(m.contacts[0].material, 'snow');
  assert.equal(m.contacts[0].support, 100);
  input.suspended = true;
  m.update(dt, input, probe);
  assert.equal(m.contacts.length, 0);
  m.reset(input, probe);
  assert.equal(m.contacts.length, 0);
});
console.log(`\n${checks} footstep surface checks passed`);
