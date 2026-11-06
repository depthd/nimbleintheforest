// The cliff laboratory in the real generated world (seed 42): the plateau and its rock are
// welded into the sheet without steep sheet faces, and ordinary play is left unchanged.
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
function covers(region) {
  const solids = [];
  for (const c of region.cliffs) for (const b of c.blocks) { const t = []; blockTriangles(b, t); solids.push([b, t]); }
  const caps = region.cliffs.map((c) => c.caps);
  return (x, y, z) => {
    for (const [b, t] of solids) if (insideBlock(b, t, x, y, z)) return true;
    for (const { positions: P, indices: I } of caps) for (let q = 0; q < I.length; q += 3) {
      const a = I[q] * 3, b = I[q + 1] * 3, c = I[q + 2] * 3;
      const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], cx = P[c], cz = P[c + 2];
      if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx) || z < Math.min(az, bz, cz) || z > Math.max(az, bz, cz)) continue;
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const h = l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1];
      if (h > y && h < y + 1.5) return true;
    }
    return false;
  };
}

(async () => {
  const t0 = Date.now();
  const lab = new Region(42, 3072, { cliffLab: true });
  await lab.generate();
  const plain = new Region(42, 3072);
  await plain.generate();
  console.log(`two regions in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  await test('ordinary play has no cliffs; the lab has a cliff, a pillar and a tor', () => {
    assert.equal(plain.cliffs.length, 0);
    assert.equal(plain.cliffLab, null);
    assert.equal(lab.cliffs.length, 3);
    const s = lab.cliffs.map((c) => c.stats());
    assert.ok(s[0].length > 120 && s[0].shelters >= 4, JSON.stringify(s[0]));
  });

  await test('the lab only changes the ground around its own site', () => {
    const C = lab.cliffLab.centre, nf = lab.n + 1;
    // places keep clear of the rock, so one may pick another spot and flatten its pad there
    const pads = [...lab.places, ...plain.places];
    let far = 0;
    for (let j = 0; j < nf; j += 3) for (let i = 0; i < nf; i += 3) {
      const k = j * nf + i, x = i * 2 - lab.ox, z = j * 2 - lab.oz;
      if (Math.hypot(x - C.x, z - C.z) < 250) continue; // the stamped square reaches ~240 m
      if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < 16)) continue;
      if (Math.abs(lab.h[k] - plain.h[k]) > 1e-4) far++;
    }
    assert.equal(far, 0);
    assert.equal(lab.ox, plain.ox); // the house stays where it is
  });

  await test('around the rock the sheet never shows a steep face of its own', () => {
    const H = lab.h, P = plain.h, nf = lab.n + 1, cover = covers(lab);
    const surface = (A) => (x, z) => {
      const fx = (x + lab.ox) / 2, fz = (z + lab.oz) / 2, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * nf + i;
      return u + v <= 1 ? A[k] + (A[k + 1] - A[k]) * u + (A[k + nf] - A[k]) * v : A[k + nf + 1] + (A[k + nf] - A[k + nf + 1]) * (1 - u) + (A[k + 1] - A[k + nf + 1]) * (1 - v);
    };
    const sheet = surface(H), before = surface(P);
    const slope = (fn, x, z) => { const e = 0.25, gx = (fn(x + e, z) - fn(x - e, z)) / (2 * e), gz = (fn(x, z + e) - fn(x, z - e)) / (2 * e); return Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI; };
    const changed = (x, z) => { const i = Math.round((x + lab.ox) / 2), j = Math.round((z + lab.oz) / 2), k = j * nf + i; return Math.abs(H[k] - P[k]) > 0.01; };
    let probed = 0; const steep = [];
    for (const c of lab.cliffs) {
      for (let x = c.minX; x <= c.maxX; x += 0.61) for (let z = c.minZ; z <= c.maxZ; z += 0.53) {
        if (!changed(x, z)) continue; // natural relief is not the lab's business
        const y = sheet(x, z);
        if (cover(x, y + 0.05, z)) continue;
        probed++;
        // steep where the lab made it steep, not where the hillside already was
        const a = slope(sheet, x, z);
        if (a > 52 && a > slope(before, x, z) + 4) {
          const p = c.frame.project(x, z);
          steep.push([c.spec.id, +x.toFixed(1), +z.toFixed(1), +y.toFixed(1), +a.toFixed(0), 's', +p.s.toFixed(1), 'v', +p.v.toFixed(1), 'b', +p.beyond.toFixed(1), 'foot', +c.footAt(p.s).toFixed(1)]);
        }
      }
    }
    assert.ok(probed > 20000, `${probed}`);
    if (process.env.CLIFF_DEBUG) {
      const hist = {};
      for (const e of steep) { const key = `${e[0]} s${Math.round(e[6] / 10) * 10} v${Math.round(e[8] / 3) * 3}`; hist[key] = (hist[key] || 0) + 1; }
      console.log(JSON.stringify(Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 20)));
    }
    assert.ok(steep.length <= probed * 0.0005, `${steep.length} of ${probed} steep, e.g. ${JSON.stringify(steep.slice(0, 6))}`);
  });

  await test('trees and places keep clear of the rock', () => {
    const T = lab.trees;
    let inside = 0;
    for (let i = 0; i < T.count; i++) if (!(T.flags[i] & 3) && lab.cliffs.some((c) => c.occupied(T.x[i], T.z[i], 0))) inside++;
    assert.equal(inside, 0);
    for (const p of lab.places) assert.ok(!lab.cliffs.some((c) => c.occupied(p.x, p.z, 6)), `${p.kind} at ${p.x},${p.z}`);
  });

  console.log(`${checks} cliff lab checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
