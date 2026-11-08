const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const file = path.join(__dirname, '../src/world/spatial-geometry.ts');
const compiled = new Module(__filename);
compiled._compile(buildSync({ stdin: { contents: `export * from ${JSON.stringify(file)}; export * as T from 'three';`,
  resolveDir: path.join(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename);
const { splitGridGeometry, T } = compiled.exports;
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ', name); }
function grid(cells, hole = () => false) {
  const positions = [], indices = [];
  for (let z = 0; z <= cells; z++) for (let x = 0; x <= cells; x++) positions.push(x * 32, Math.sin(x * .3) * Math.cos(z * .2) * 20, z * 32);
  for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) {
    if (hole(x, z)) continue;
    const a = z * (cells + 1) + x, b = a + cells + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('aSnowDepth', new T.Float32BufferAttribute(new Float32Array(positions.length / 3).fill(-1), 1));
  g.setIndex(indices); g.computeVertexNormals(); return g;
}
function triangles(g) {
  const out = [];
  for (let i = 0; i < g.index.count; i += 3) out.push([g.index.getX(i), g.index.getX(i + 1), g.index.getX(i + 2)].join(','));
  return out.sort();
}

test('triangle union is exact through the map hole, skipped tiles and partial edge tiles', () => {
  const g = grid(135, (x, z) => x < 64 && z < 64 || x >= 80 && x < 110 && z >= 70 && z < 120);
  const tiles = splitGridGeometry(g, 135);
  assert.equal(tiles.length, 8);
  assert.deepEqual(tiles.flatMap(triangles).sort(), triangles(g));
  assert.ok(tiles.some(tile => tile.index.count < 64 * 64 * 6), 'partial outer tiles remain present');
  assert.ok(tiles.every(tile => tile.index.count <= 64 * 64 * 6));
});

test('every attribute and seam normal is shared verbatim without duplicate vertex buffers', () => {
  const g = grid(130), tiles = splitGridGeometry(g, 130), normals = Array.from(g.attributes.normal.array);
  for (const tile of tiles) for (const [name, attribute] of Object.entries(g.attributes)) assert.equal(tile.attributes[name], attribute);
  assert.deepEqual(Array.from(g.attributes.normal.array), normals);
  const edge = 64 * 131 + 64, touching = tiles.filter(t => Array.from(t.index.array).includes(edge));
  assert.equal(touching.length, 4);
  assert.ok(touching.every(t => t.attributes.normal.getY(edge) === g.attributes.normal.getY(edge)));
});

test('bounds contain exactly the used vertex extent and permit camera culling of other tiles', () => {
  const g = grid(130), tiles = splitGridGeometry(g, 130), p = new T.Vector3();
  for (const tile of tiles) {
    const expected = new T.Box3();
    for (const i of tile.index.array) {
      p.fromBufferAttribute(g.attributes.position, i); expected.expandByPoint(p);
      assert.ok(p.distanceTo(tile.boundingSphere.center) <= tile.boundingSphere.radius + 1e-6);
    }
    assert.ok(tile.boundingBox.equals(expected));
    assert.ok(tile.boundingBox.max.x - tile.boundingBox.min.x <= 2048);
    assert.ok(tile.boundingBox.max.z - tile.boundingBox.min.z <= 2048);
  }
  const camera = new T.OrthographicCamera(-100, 100, 100, -100, 1, 500);
  camera.position.set(100, 200, 100); camera.up.set(0, 0, -1); camera.lookAt(100, 0, 100); camera.updateMatrixWorld(true);
  const f = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const visible = tiles.filter(t => { const mesh = new T.Mesh(t); mesh.updateMatrixWorld(); return f.intersectsObject(mesh); });
  assert.ok(visible.length > 0 && visible.length < tiles.length);
  assert.ok(visible.reduce((n, t) => n + t.index.count, 0) < g.index.count / 2);
});

test('an empty grid produces no drawables and small grids retain all triangles', () => {
  assert.deepEqual(splitGridGeometry(grid(5, () => true), 5), []);
  const g = grid(5), tiles = splitGridGeometry(g, 5);
  assert.equal(tiles.length, 1); assert.deepEqual(triangles(tiles[0]), triangles(g));
});

console.log(`${checks} spatial geometry checks passed`);
