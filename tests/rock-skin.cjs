// Rock skin of the ordinary world (seed 42): steep slopes are covered with rock, the blocks sit
// in the slope rather than float, nothing grows on rock, and the same seed builds the same rock.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const compiled = new Module(__filename);
compiled._compile(buildSync({ stdin: { contents: "export { Region } from './src/gen/region'; export { blockTriangles } from './src/gen/cliffs';", resolveDir: path.join(__dirname, '..') },
  bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename);
const { Region, blockTriangles } = compiled.exports;
let checks = 0;
const test = async (name, run) => { await run(); checks++; console.log('PASS ', name); };

function insideBlock(b, t, x, y, z) {
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ || y < b.minY || y > b.maxY) return false;
  let crossings = 0;
  for (let q = 0; q < t.length; q += 9) {
    const ax = t[q], az = t[q + 2], bx = t[q + 3], bz = t[q + 5], cx = t[q + 6], cz = t[q + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    if (l1 * t[q + 1] + l2 * t[q + 4] + l3 * t[q + 7] > y) crossings++;
  }
  return crossings % 2 === 1;
}

(async () => {
  const t0 = Date.now();
  const R = new Region(42, 3072);
  await R.generate();
  const again = new Region(42, 3072);
  await again.generate();
  console.log(`two regions in ${((Date.now() - t0) / 1000).toFixed(1)} s; rock ${R.timings.rock} ms`);
  const skin = R.skin, n = R.n, nf = n + 1, H = R.h;
  const sheet = (x, z) => {
    const fx = (x + R.ox) / 2, fz = (z + R.oz) / 2, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * nf + i;
    return u + v <= 1 ? H[k] + (H[k + 1] - H[k]) * u + (H[k + nf] - H[k]) * v : H[k + nf + 1] + (H[k + nf] - H[k + nf + 1]) * (1 - u) + (H[k + 1] - H[k + nf + 1]) * (1 - v);
  };
  // blocks by 16 m cell for point queries
  const grid = new Map();
  const solid = skin.blocks.map((b) => { const t = []; blockTriangles(b, t); return [b, t]; });
  solid.forEach((s, i) => {
    const b = s[0];
    for (let gx = Math.floor(b.minX / 16); gx <= Math.floor(b.maxX / 16); gx++) for (let gz = Math.floor(b.minZ / 16); gz <= Math.floor(b.maxZ / 16); gz++) {
      const k = gx * 65536 + gz; (grid.get(k) ?? grid.set(k, []).get(k)).push(i);
    }
  });
  const inRock = (x, y, z) => (grid.get(Math.floor(x / 16) * 65536 + Math.floor(z / 16)) ?? []).some((i) => insideBlock(solid[i][0], solid[i][1], x, y, z));

  await test('the same seed builds the same rock, in a bounded time', () => {
    assert.equal(skin.blocks.length, again.skin.blocks.length);
    assert.deepEqual(Array.from(skin.blocks[1234].pts), Array.from(again.skin.blocks[1234].pts));
    const s = skin.stats();
    assert.ok(s.blocks > 10000 && s.blocks < 45000, JSON.stringify(s));
    assert.ok(R.timings.rock < 4000, `${R.timings.rock} ms`);
  });

  await test('slopes too steep to climb show rock, not the stretched sheet', () => {
    let steep = 0, covered = 0;
    const misses = [];
    for (let j = 40; j < n - 40; j += 3) for (let i = 40; i < n - 40; i += 3) {
      const k = j * nf + i, x = i * 2 - R.ox + 1, z = j * 2 - R.oz + 1;
      if (R.edgeDist(x, z) < 300 || !Number.isNaN(R.water[k])) continue;
      const s = Math.max(Math.hypot(H[k + 1] - H[k], H[k + nf] - H[k]), Math.hypot(H[k + nf + 1] - H[k + nf], H[k + nf + 1] - H[k + 1])) / 2;
      if (Math.atan(s) * 180 / Math.PI < 55) continue;
      if (Math.hypot(x, z) < 40 || R.places.some((p) => Math.hypot(p.x - x, p.z - z) < (p.data.clear ?? 4) + 8)) continue;
      steep++;
      if (inRock(x, sheet(x, z) + 0.05, z)) covered++;
      else if (misses.length < 5) misses.push([+x.toFixed(0), +z.toFixed(0)]);
    }
    assert.ok(steep > 2000, `${steep}`);
    assert.ok(covered / steep > 0.85, `${covered} of ${steep} covered, e.g. not ${JSON.stringify(misses)}`);
  });

  await test('blocks sit in the slope: their fronts reach below the sheet and their backs are buried', () => {
    let floating = 0, exposedBacks = 0, sampled = 0;
    for (let q = 0; q < skin.blocks.length; q += 7) {
      const b = skin.blocks[q], P = b.pts, top = (b.rings - 1) * 5;
      sampled++;
      // bottom front points
      for (const j of [0, 1, 2]) if (P[j * 3 + 1] > sheet(P[j * 3], P[j * 3 + 2]) - 0.2) { floating++; break; }
      // top back points lie under the sheet
      for (const j of [3, 4]) { const o = (top + j) * 3; if (P[o + 1] > sheet(P[o], P[o + 2]) + 0.05) { exposedBacks++; break; } }
    }
    assert.ok(floating / sampled < 0.01, `${floating} of ${sampled} float`);
    assert.ok(exposedBacks / sampled < 0.05, `${exposedBacks} of ${sampled} with exposed backs`);
  });

  await test('nothing grows or lies on the rock, and places keep their ground', () => {
    for (const P of [R.trees, R.rocks]) {
      let bad = 0;
      for (let i = 0; i < P.count; i++) if (!(P.flags[i] & 3) && skin.covers(P.x[i], P.z[i])) bad++;
      assert.equal(bad, 0);
    }
    for (const p of R.places) assert.ok(!skin.covers(p.x, p.z), `${p.kind}`);
    assert.ok(!skin.covers(0, 0) && !skin.covers(0, 10));
  });

  console.log(`${checks} rock skin checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
