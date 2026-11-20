const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) =>
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    file,
  );
const { wallOutcrop } = require('./wall-outcrop.ts');
const { surfaceRoof } = require('./wedge-rocks.ts');
const shape = {
  x: 9,
  z: -16,
  width: 53,
  depth: 42,
  height: 72,
  angle: 1.2,
  lean: -6,
  rake: 8,
  crown: 2,
  base: -5,
};
const controls = [
  [-22, -15, -0.06, 1.02],
  [14, -18, 0.1, 0.93],
  [26, -2, 0.02, 0.98],
  [18, 18, 0.17, 1.04],
  [-16, 18, -0.12, 1],
  [-24, 3, 0.03, 1.03],
];
let split = 0,
  whole = 0,
  snowSamples = 0;
for (const seed of [16, 32, 95, 116, 280, 411]) {
  const pieces = wallOutcrop(shape, controls, seed);
  if (pieces.length === 2) split++;
  else whole++;
  for (const { rock, snow, clearance } of pieces) {
    assert.equal(clearance.length, rock.points.length);
    assert.ok(clearance.every((v) => Number.isFinite(v) && v >= 0));
    for (const shell of [rock, snow]) {
      assert.ok(shell.points.every((p) => p.toArray().every(Number.isFinite)));
      assert.ok(shell.indices.every((i) => Number.isInteger(i) && i >= 0 && i < shell.points.length));
    }
    const bed = surfaceRoof([
      {
        positions: Float32Array.from(rock.points.flatMap((p) => p.toArray())),
        indices: Uint32Array.from(rock.indices),
      },
    ]);
    for (const p of snow.points) {
      const y = bed(p.x, p.z);
      assert.ok(y !== undefined, 'Snow needs an underlying rock face');
      assert.ok(p.y >= y - 0.09 && p.y - y < shape.crown * 2, 'Snow must meet its own rock');
      snowSamples++;
    }
  }
}
assert.ok(split > 0 && whole > 0 && snowSamples > 100);
console.log({ split, whole, snowSamples });
