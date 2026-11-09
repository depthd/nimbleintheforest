// Exercise the production instance batching with Three.js camera/shadow frusta,
// without starting WebGL or a browser. Expose only this private class to the test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const root = path.join(__dirname, '..');
const file = path.join(root, 'src/world/forest.ts');
const compiled = new Module(__filename);
compiled._compile(buildSync({ stdin: {
  contents: fs.readFileSync(file, 'utf8') + '\nexport { InstanceChunks as TestInstanceChunks };\nexport * as TestThree from "three";',
  resolveDir: path.dirname(file), sourcefile: file, loader: 'ts',
}, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'error' }).outputFiles[0].text, __filename);
const { TestInstanceChunks: InstanceChunks, TestThree: T } = compiled.exports;
let checks = 0;
const test = (name, fn) => { fn(); checks++; console.log('PASS ', name); };
const matrix = (x, z, scale = 1, tilt = 0) => new T.Matrix4().compose(
  new T.Vector3(x, 0, z), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), tilt),
  new T.Vector3(scale, scale * 1.3, scale));
function fixture() {
  const scene = new T.Scene(), geos = [new T.CylinderGeometry(.2, .3, 12, 7), new T.ConeGeometry(3, 10, 8)];
  geos[0].translate(0, 6, 0); geos[1].translate(0, 9, 0);
  const mats = geos.map(() => new T.MeshStandardMaterial()), kind = { type: 'spruce' };
  return { scene, geos, mats, kind, batch: new InstanceChunks(scene, geos, mats, kind) };
}
function fill(batch, matrices) { batch.begin(); matrices.forEach(m => batch.add(m)); batch.finish(); }
const instanceCount = meshes => meshes.reduce((n, m) => n + m.count, 0);
function frustum(camera) {
  camera.updateMatrixWorld(true);
  return new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
}

test('all parts preserve transforms across signed chunk boundaries, including leaning crowns', () => {
  const f = fixture(), inputs = [-256.01, -128, -.01, 0, 127.99, 128, 256].map((x, i) => matrix(x, i * 29 - 80, 1 + i / 5, .13));
  fill(f.batch, inputs); f.scene.updateMatrixWorld(true);
  assert.equal(instanceCount(f.batch.meshes), inputs.length * 2);
  const expected = inputs.map(m => Array.from(new Float32Array(m.elements)).join(','));
  for (let part = 0; part < 2; part++) {
    const found = [], p = new T.Vector3(), m = new T.Matrix4();
    for (const mesh of f.batch.meshes.filter(m => m.geometry === f.geos[part])) {
      assert.equal(mesh.material, f.mats[part]); assert.equal(mesh.userData.forestKind, f.kind);
      assert.ok(mesh.frustumCulled && mesh.castShadow && mesh.receiveShadow);
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m); found.push(m.elements.join(','));
        const a = mesh.geometry.attributes.position;
        for (let j = 0; j < a.count; j++) {
          p.fromBufferAttribute(a, j).applyMatrix4(m);
          assert.ok(mesh.boundingBox.clone().expandByScalar(1e-5).containsPoint(p));
          assert.ok(p.distanceTo(mesh.boundingSphere.center) <= mesh.boundingSphere.radius + 1e-5);
        }
      }
    }
    assert.deepEqual(found.sort(), expected.slice().sort());
  }
});

test('view and shadow cameras independently cull batches without removing off-screen casters', () => {
  const f = fixture(); fill(f.batch, [matrix(0, -25), matrix(0, 180), matrix(180, 0), matrix(-180, 0)]);
  f.scene.updateMatrixWorld(true);
  const camera = new T.PerspectiveCamera(60, 1, .1, 300); camera.position.set(0, 8, 0); camera.lookAt(0, 8, -1);
  const view = frustum(camera), shadowCamera = new T.OrthographicCamera(-45, 45, 45, -45, 1, 260);
  shadowCamera.position.set(0, 90, 0); shadowCamera.up.set(0, 0, -1); shadowCamera.lookAt(0, 0, 0);
  const shadow = frustum(shadowCamera), total = instanceCount(f.batch.meshes);
  assert.ok(instanceCount(f.batch.meshes.filter(m => view.intersectsObject(m))) < total);
  assert.equal(instanceCount(f.batch.meshes.filter(m => shadow.intersectsObject(m))), 2);
  camera.lookAt(0, 8, 1);
  const turned = frustum(camera);
  assert.ok(f.batch.meshes.some(m => !turned.intersectsObject(m) && shadow.intersectsObject(m)), 'a caster behind the view camera must remain eligible for shadows');
});

test('capacity growth retains every tree and updates only the occupied matrix range', () => {
  const f = fixture(), inputs = Array.from({ length: 300 }, (_, i) => matrix((i % 25) * 3, Math.floor(i / 25) * 3));
  fill(f.batch, inputs);
  assert.equal(f.batch.meshes.length, 2); assert.equal(instanceCount(f.batch.meshes), 600);
  for (const mesh of f.batch.meshes) {
    assert.equal(mesh.instanceMatrix.count, 512);
    assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 0, count: 300 * 16 }]);
    const last = new T.Matrix4(); mesh.getMatrixAt(299, last);
    assert.deepEqual(last.elements, Array.from(new Float32Array(inputs[299].elements)));
  }
});

test('streaming and forced rebuilds remove stale trees, refresh bounds, and release distant buffers', () => {
  const f = fixture(); fill(f.batch, [matrix(5, 5), matrix(100, 100), matrix(180, 180)]);
  const retained = f.batch.meshes.filter(m => m.boundingBox.min.x < 128), removed = f.batch.meshes.filter(m => !retained.includes(m));
  let disposed = 0; removed.forEach(m => m.addEventListener('dispose', () => disposed++));
  fill(f.batch, [matrix(5, 5)]);
  assert.equal(instanceCount(f.batch.meshes), 2); assert.equal(disposed, 2);
  assert.ok(f.batch.meshes.every(m => retained.includes(m) && m.boundingBox.max.x < 10));
  for (let i = 1; i < 30; i++) {
    fill(f.batch, [matrix(i * 200, i * 200)]);
    assert.equal(f.scene.children.length, 2); assert.equal(f.batch.meshes.length, 2);
  }
  fill(f.batch, []); assert.equal(f.scene.children.length, 0); assert.equal(f.batch.meshes.length, 0);
});

test('the previous 4000-instance per-variant limit is preserved across spatial batches', () => {
  const f = fixture(); fill(f.batch, Array.from({ length: 4100 }, (_, i) => matrix(i, i % 100)));
  assert.equal(instanceCount(f.batch.meshes), 8000);
});

test('unchanged streamed chunks retain GPU versions and bounds; changed, removed and regrown slots refresh', () => {
  const f = fixture(), inputs = [matrix(5, 5, 1.17, .13), matrix(15, 20), matrix(180, 180)];
  fill(f.batch, inputs);
  const state = f.batch.meshes.map(m => [m, m.instanceMatrix.version, m.boundingSphere.clone(), m.boundingBox.clone()]);
  for (let i = 0; i < 5; i++) fill(f.batch, inputs);
  for (const [m, version, sphere, box] of state) {
    assert.equal(m.instanceMatrix.version, version); assert.deepEqual(m.boundingSphere, sphere); assert.deepEqual(m.boundingBox, box);
  }
  fill(f.batch, [matrix(6, 5, 1.17, .13), inputs[1], inputs[2]]);
  for (const [m, version] of state) assert.equal(m.instanceMatrix.version, version + +(m.boundingBox.min.x < 128));
  fill(f.batch, [inputs[0], inputs[2]]); fill(f.batch, inputs);
  for (const m of f.batch.meshes) {
    const expected = m.boundingBox.min.x < 128 ? inputs.slice(0, 2) : inputs.slice(2);
    assert.equal(m.count, expected.length);
    for (let i = 0; i < expected.length; i++) {
      const found = new T.Matrix4(); m.getMatrixAt(i, found);
      assert.deepEqual(found.elements, Array.from(new Float32Array(expected[i].elements)));
    }
  }
});

console.log(`${checks} forest instance checks passed`);
