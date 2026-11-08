// Static corpse batching: preserve every visible triangle/material/UV while
// eliminating per-part draws, including clothing changes after world placement.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
// Fabric generation only needs a canvas to paint into; rendering is tested by
// the existing browser suite. Keep actual CanvasTexture/material objects here.
global.document = { createElement: name => {
  assert.equal(name, 'canvas');
  return { width: 0, height: 0, getContext: () => ({ fillRect() {} }) };
} };
const file = path.join(__dirname, '../src/game/corpse-mesh.ts');
const compiled = new Module(__filename);
compiled._compile(buildSync({ stdin: { contents: `export * from ${JSON.stringify(file)}; export * as T from 'three';`,
  resolveDir: path.join(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename);
const { buildCorpseMesh, updateCorpseClothing, T } = compiled.exports;
let checks = 0, nextId = 1;
const test = (name, fn) => { fn(); checks++; console.log('PASS ', name); };
function clothing() {
  return new Map(Object.entries({ outer: 'parka', mid: 'fleece', base: 'thermals', legs: 'jeans',
    head: 'ushanka', neck: 'scarf', hands: 'mittens', feet: 'boots', socks: 'wool_socks', back: 'backpack_big' })
    .map(([slot, defId]) => [slot, { id: nextId++, defId }]));
}
function visibleMeshes(group) { const meshes = []; group.traverseVisible(o => { if (o.isMesh) meshes.push(o); }); return meshes; }
function snapshot(root, source) {
  root.updateMatrixWorld(true);
  source.updateMatrixWorld(true);
  const result = new Map(), p = new T.Vector3(), n = new T.Vector3();
  for (const mesh of visibleMeshes(source)) {
    const transform = source === root ? mesh.matrixWorld : new T.Matrix4().multiplyMatrices(root.matrixWorld, mesh.matrixWorld);
    const normalTransform = new T.Matrix3().getNormalMatrix(transform), g = mesh.geometry;
    let values = result.get(mesh.material.uuid);
    if (!values) { values = { position: [], normal: [], uv: [] }; result.set(mesh.material.uuid, values); }
    for (let i = 0; i < (g.index?.count ?? g.attributes.position.count); i++) {
      const v = g.index ? g.index.getX(i) : i;
      p.fromBufferAttribute(g.attributes.position, v).applyMatrix4(transform);
      n.fromBufferAttribute(g.attributes.normal, v).applyNormalMatrix(normalTransform);
      values.position.push(p.x, p.y, p.z); values.normal.push(n.x, n.y, n.z);
      values.uv.push(g.attributes.uv.getX(v), g.attributes.uv.getY(v));
    }
  }
  return result;
}
function assertPosePreserved(root) {
  const expected = snapshot(root, root.userData.corpseSource), actual = snapshot(root, root);
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort());
  for (const [material, values] of expected) for (const attribute of ['position', 'normal', 'uv']) {
    const a = actual.get(material)[attribute], e = values[attribute];
    assert.equal(a.length, e.length, `${attribute} triangle count`);
    let error = 0; for (let i = 0; i < a.length; i++) error = Math.max(error, Math.abs(a[i] - e[i]));
    assert.ok(error < 2e-6, `${attribute} differs by ${error}`);
  }
  return actual;
}

test('visible material batches retain the dressed pose and reduce per-pass draw calls', () => {
  const worn = clothing(), root = buildCorpseMesh(worn, 1), source = root.userData.corpseSource;
  assert.equal(source.parent, null);
  assert.ok(visibleMeshes(source).length >= 40);
  const batches = visibleMeshes(root), expectedMaterials = new Set(visibleMeshes(source).map(m => m.material));
  assert.equal(batches.length, expectedMaterials.size); assert.ok(batches.length <= 14 && batches.length < visibleMeshes(source).length / 3);
  assert.ok(batches.every(m => m.castShadow && m.receiveShadow && !m.matrixAutoUpdate));
  assertPosePreserved(root);
  console.log(`  dressed corpse: ${visibleMeshes(source).length} parts -> ${batches.length} draws per pass`);
});

test('clothing rebakes preserve root placement, entity identity and changed visible geometry', () => {
  const worn = clothing(), root = buildCorpseMesh(worn, 0), entity = { id: 123 };
  root.userData.entity = entity; root.position.set(-17, 2, 31); root.rotation.set(.11, .79, -.07); root.scale.set(1.2, .7, .9);
  assertPosePreserved(root);
  const torso = root.userData.corpseClothing.torso;
  assert.equal(torso.userData.wornItem, worn.get('outer').id);
  for (const slot of ['outer', 'head', 'hands', 'feet', 'neck', 'back', 'legs', 'mid', 'base', 'socks']) {
    worn.delete(slot); updateCorpseClothing(root, worn); assertPosePreserved(root);
    assert.equal(root.userData.entity, entity); assert.deepEqual(root.position.toArray(), [-17, 2, 31]);
  }
  assert.equal(torso.userData.wornItem, null);
  assert.ok(visibleMeshes(root).length <= 6);
  worn.set('head', { id: nextId++, defId: 'balaclava' }); worn.set('feet', { id: nextId++, defId: 'sneakers' });
  worn.set('outer', { id: nextId++, defId: 'tulup' });
  updateCorpseClothing(root, worn); assertPosePreserved(root);
  assert.ok(root.userData.corpseClothing.balaclava.visible);
  assert.equal(root.userData.corpseClothing.hat.visible, false);
  assert.equal(root.userData.corpseClothing.shoes[0].scale.y, .79);
});

test('rebakes release owned buffers while shared primitive geometry and materials survive', () => {
  const worn = clothing(), first = buildCorpseMesh(worn, 0), second = buildCorpseMesh(worn, 0);
  const old = first.children.map(m => m.geometry), sources = new Set(), materials = new Set();
  first.userData.corpseSource.traverse(o => { if (o.isMesh) { sources.add(o.geometry); materials.add(o.material); } });
  let ownedDisposed = 0, sharedDisposed = 0;
  old.forEach(g => g.addEventListener('dispose', () => ownedDisposed++));
  for (const shared of [...sources, ...materials]) shared.addEventListener('dispose', () => sharedDisposed++);
  worn.delete('outer'); updateCorpseClothing(first, worn);
  assert.equal(ownedDisposed, old.length); assert.equal(sharedDisposed, 0);
  assert.ok(first.children.every(m => !old.includes(m.geometry) && !sources.has(m.geometry)));
  assertPosePreserved(second);
});

test('batch bounds exactly enclose their baked vertices after clothing replacement', () => {
  const worn = clothing(), root = buildCorpseMesh(worn, 2), p = new T.Vector3();
  for (const state of ['dressed', 'bare']) {
    if (state === 'bare') { worn.clear(); updateCorpseClothing(root, worn); }
    for (const mesh of visibleMeshes(root)) {
      const g = mesh.geometry, expected = new T.Box3();
      for (let i = 0; i < g.attributes.position.count; i++) {
        p.fromBufferAttribute(g.attributes.position, i); expected.expandByPoint(p);
        assert.ok(p.distanceTo(g.boundingSphere.center) <= g.boundingSphere.radius + 1e-6);
      }
      assert.ok(g.boundingBox.equals(expected));
    }
  }
});

console.log(`${checks} corpse mesh checks passed`);
