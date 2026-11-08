// Geometry invariants shared by loading, the mesh worker, and the sliced fallback.
// No WebGL is needed: check actual positions, winding, snow boundaries and transfers.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const root = path.join(__dirname, '..');
const compile = name => buildSync({ entryPoints: [path.join(root, 'src/world', name)],
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['three'], logLevel: 'error' }).outputFiles[0].text;
function load(name) {
  const m = new Module(__filename, module); m.paths = module.paths;
  m._compile(compile(name), __filename); return m.exports;
}
const { buildTerrainGeometry: build, terrainGeometrySteps: sliced, terrainLod, TERRAIN_STEPS: steps } = load('terrain-geometry.ts');
const { SnowCover } = load('snow-cover.ts'), { WorldSnowTerrain } = load('snow-terrain.ts');
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ', name); }
const near = (a, b, tolerance = 2e-5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function grid(n = 128, height = (i, j) => 11 + i * .5 + j * .25) {
  const h = new Float32Array((n + 1) ** 2);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) h[j * (n + 1) + i] = height(i, j);
  return { h, water: new Float32Array(h.length).fill(NaN), n, size: n * 2, ox: n, oz: n };
}
const buffers = g => [g.position.buffer, g.normal.buffer, g.depth.buffer, g.snowNormal.buffer, g.index.buffer,
  ...(g.packed ? [g.packed.position.buffer, g.packed.normal.buffer, g.packed.index.buffer] : [])];

test('all LODs retain the affine world surface, upward winding and four complete skirts', () => {
  const r = grid();
  for (let lod = 0; lod < 4; lod++) {
    const g = build(r, 1, 1, lod), s = steps[lod], m = 64 / s + 1, vertices = m * m + 4 * m;
    assert.equal(g.position.length, vertices * 3); assert.equal(g.index.length, 6 * (m - 1) ** 2 + 24 * (m - 1));
    assert.ok(g.index.every(i => i < vertices)); assert.ok(g.depth.every(d => d === 0));
    assert.deepEqual(g.snowNormal, g.normal);
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      const k = j * m + i;
      near(g.position[k * 3], i * s * 2); near(g.position[k * 3 + 2], j * s * 2);
      near(g.position[k * 3 + 1], 11 + (64 + i * s) * .5 + (64 + j * s) * .25);
      if (i > 0 && i < m - 1 && j > 0 && j < m - 1) {
        const length = Math.hypot(.25, 1, .125);
        near(g.normal[k * 3], -.25 / length); near(g.normal[k * 3 + 1], 1 / length); near(g.normal[k * 3 + 2], -.125 / length);
      }
    }
    for (let q = 0; q < 6 * (m - 1) ** 2; q += 3) {
      const [a, b, c] = g.index.subarray(q, q + 3), p = g.position;
      const winding = (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]) -
        (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]);
      assert.ok(winding > 0);
    }
    const edges = [k => k, k => k * m + m - 1, k => (m - 1) * m + m - 1 - k, k => (m - 1 - k) * m];
    edges.forEach((edge, side) => {
      for (let k = 0; k < m; k++) {
        const original = edge(k) * 3, skirt = (m * m + side * m + k) * 3;
        near(g.position[skirt], g.position[original]); near(g.position[skirt + 2], g.position[original + 2]);
        near(g.position[skirt + 1], g.position[original + 1] - (1.5 + s * 1.5));
      }
    });
  }
});

test('refinement preserves the original triangle planes and keeps the packed base unrefined', () => {
  const r = grid(64, (i, j) => i * j * .01 + (i === 9 && j === 11 ? 3 : 0));
  const snow = { heightAt: (x, z) => .18 + .0004 * x - .0002 * z,
    detailedAt: (x, z) => x === -48 && z === -44 };
  const plain = build(r, 0, 0, 0, { heightAt: snow.heightAt }), g = build(r, 0, 0, 0, snow);
  assert.deepEqual(g.packed.position, plain.position); assert.deepEqual(g.packed.normal, plain.normal);
  assert.deepEqual(g.packed.index, plain.index);
  const baseCount = plain.position.length / 3;
  assert.equal(g.position.length / 3 - baseCount, 81); assert.equal(g.index.length - plain.index.length, 6 * (64 - 1));
  const [h00, h10, h01, h11] = [[8, 10], [9, 10], [8, 11], [9, 11]].map(([x, z]) => r.h[z * 65 + x]);
  for (let i = baseCount; i < g.position.length / 3; i++) {
    const x = g.position[i * 3], z = g.position[i * 3 + 2], u = (x - 16) / 2, v = (z - 20) / 2;
    const expected = u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v
      : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
    near(g.position[i * 3 + 1], expected);
    near(g.depth[i], snow.heightAt(x - r.ox, z - r.oz));
  }
  assert.ok(g.index.every(i => i < g.position.length / 3));
});

test('snow normals include the snow slope while immutable positions and terrain normals stay fixed', () => {
  const r = grid(), bare = build(r, 0, 0, 1);
  const g = build(r, 0, 0, 1, { heightAt: (x, z) => .28 + .001 * x + .002 * z });
  assert.deepEqual(g.position, bare.position); assert.deepEqual(g.normal, bare.normal);
  for (let i = 0; i < g.depth.length; i++) {
    near(g.depth[i], .28 + .001 * (g.position[i * 3] - r.ox) + .002 * (g.position[i * 3 + 2] - r.oz));
    const nx = g.normal[i * 3] / Math.max(.01, g.normal[i * 3 + 1]) - .001;
    const nz = g.normal[i * 3 + 2] / Math.max(.01, g.normal[i * 3 + 1]) - .002, len = Math.hypot(nx, 1, nz);
    near(g.snowNormal[i * 3], nx / len); near(g.snowNormal[i * 3 + 1], 1 / len); near(g.snowNormal[i * 3 + 2], nz / len);
  }
});

test('arbitrary pauses in the fallback generator produce exactly the synchronous arrays', () => {
  const r = grid(64, (i, j) => Math.sin(i * .13) + Math.cos(j * .19));
  const snow = { heightAt: (x, z) => .28 * Math.max(0, Math.min(1, (x + 30) / 2)),
    detailedAt: (x, z, size) => x <= -28 && x + size >= -30 };
  for (let lod = 0; lod < 4; lod++) {
    const iterator = sliced(r, 0, 0, lod, snow); let next, pauses = 0;
    do { next = iterator.next(); if (!next.done) pauses++; } while (!next.done);
    assert.ok(pauses > 10); assert.deepEqual(next.value, build(r, 0, 0, lod, snow));
  }
});

test('transferring complete results never detaches source terrain or cached index templates', () => {
  const r = grid(64), original = r.h.slice();
  for (const refined of [false, true]) {
    const snow = refined ? { heightAt: () => .28, detailedAt: () => false } : undefined;
    const a = build(r, 0, 0, 2, snow), expected = structuredClone(a), transferred = structuredClone(a, { transfer: buffers(a) });
    assert.equal(a.position.byteLength, 0); assert.equal(a.index.byteLength, 0);
    assert.deepEqual(transferred, expected); assert.deepEqual(build(r, 0, 0, 2, snow), expected);
    assert.deepEqual(r.h, original);
  }
});

test('the actual worker matches roof and shoreline sampling and applies revised shelter data', () => {
  const r = grid(64, (i, j) => (i * 2 - 64) * .12);
  for (let j = 0; j <= r.n; j++) for (let i = 0; i <= r.n; i++) if (i * 2 - 64 <= 0) r.water[j * 65 + i] = 0;
  const cover = new SnowCover({ minX: -64, minZ: -64, maxX: 64, maxZ: 64 });
  cover.add({ name: 'rotated roof', kind: 'roof', x: 15, z: 4, hx: 3, hz: 2, yaw: .73, y: 10 });
  const terrain = new WorldSnowTerrain(r, (x, z) => cover.looseAt(x, z, terrain.heightAt(x, z)));
  const snow = { heightAt: (x, z) => .28 * terrain.retentionAt(x, z),
    detailedAt: (x, z, size) => cover.detailedAt(x, z, size) || terrain.detailedAt(x, z, size) };
  let reply;
  const workerSelf = { postMessage: (message, options) => { reply = structuredClone(message, options); } };
  new Function('self', 'require', compile('terrain-worker.ts'))(workerSelf, require);
  workerSelf.onmessage({ data: { type: 'init', region: structuredClone(r), zones: structuredClone(cover.zones), revision: cover.revision } });
  workerSelf.onmessage({ data: { id: 1, ci: 0, cj: 0, lod: 2 } });
  assert.equal(reply.id, 1); assert.equal(reply.revision, cover.revision); assert.deepEqual(reply.geometry, build(r, 0, 0, 2, snow));
  near(snow.heightAt(15, 4), 0); near(snow.heightAt(-20, 4), 0); assert.ok(snow.heightAt(30, 4) > .27);
  cover.remove(0);
  workerSelf.onmessage({ data: { id: 2, ci: 0, cj: 0, lod: 2, zones: structuredClone(cover.zones), revision: cover.revision } });
  assert.equal(reply.revision, cover.revision); assert.deepEqual(reply.geometry, build(r, 0, 0, 2, snow));
  assert.ok(snow.heightAt(15, 4) > .27);
});

test('LOD hysteresis holds both sides of every boundary and catches up after teleports', () => {
  for (const [fine, threshold] of [[0, 150], [1, 330], [2, 620]]) {
    const coarse = fine + 1;
    for (const d of [threshold - 11.9, threshold, threshold + 11.9]) {
      assert.equal(terrainLod(d, fine), fine); assert.equal(terrainLod(d, coarse), coarse);
    }
    assert.equal(terrainLod(threshold + 12.1, fine), coarse);
    assert.equal(terrainLod(threshold - 12.1, coarse), fine);
    assert.equal(terrainLod(threshold - .1), fine); assert.equal(terrainLod(threshold + .1), coarse);
  }
  assert.equal(terrainLod(10000, 0), 3); assert.equal(terrainLod(0, 3), 0);
});

console.log(`${checks} terrain geometry checks passed`);
