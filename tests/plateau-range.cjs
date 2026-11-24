const assert = require('node:assert/strict');
const path = require('node:path');
const { Module } = require('node:module');
const { buildSync } = require('esbuild');

const result = buildSync({
  stdin: { contents: "export {generateRockCore} from './range-core';", resolveDir: path.resolve(__dirname, '../experiments/plateau'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
});
function generate(seed) {
  // The experiment reads its seed before any contour or ascent modules initialise.
  const mod = new Module(__filename);
  mod._compile('const location={search:"?seed='+seed+'"};\n'+result.outputFiles[0].text, __filename);
  const { junction, attempt } = mod.exports.generateRockCore();
  const nose = junction.nose;
  assert.ok(nose.length > 100 && nose.every(p => Number.isFinite(p.x+p.y+p.z)));
  assert.ok(junction.cut.interior.indices.length > 0);
  return { attempt, count: nose.length, lip: nose[Math.floor(nose.length / 3)] };
}

// These contours graze source-grid corners. Adjacent faces must share the
// clipped joints or the generator must choose a reproducible replacement rim.
const nearCorner = generate(15);
assert.deepEqual(nearCorner, generate(15));
for (const seed of [3, 231152, 2183559, 89385185]) assert.notDeepEqual(generate(seed),nearCorner);
