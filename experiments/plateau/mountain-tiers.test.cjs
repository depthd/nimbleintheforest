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
const { mountainTiers, worldPlan, localPlan, reservedForUpper, raisedFlank } = require('./mountain-tiers.ts');
const { plateauTop } = require('./mountain-shape.ts');
const { distanceToAscent } = require('./mountain-snow.ts');
const { contourPoint, plateauRadius } = require('./plateau-profile.ts');

const tiers = mountainTiers(true, plateauTop);
const single = mountainTiers(false, plateauTop);
assert.equal(single.length, 1);
assert.equal(single[0].width, 1);
assert.deepEqual(
  tiers.map((t) => t.name),
  ['lower', 'middle', 'summit'],
);
assert.ok(tiers[0].width > single[0].width);
for (const [i, child] of tiers.slice(1).entries()) {
  const parent = tiers[i];
  assert.ok(child.width < parent.width && child.y > parent.y);
  let minEmbed = Infinity,
    nearestPass = Infinity,
    outerRadius = 0;
  for (let a = 0; a < 360; a += 3) {
    for (let r = 0; r <= 12; r++) {
      const p = contourPoint((a * Math.PI) / 180, (1.17 * r) / 12);
      const w = worldPlan(child, p.x, p.z);
      const q = localPlan(parent, w.x, w.z);
      const back = worldPlan(parent, q.x, q.z);
      assert.ok(Math.hypot(w.x - back.x, w.z - back.z) < 1e-8);
      minEmbed = Math.min(minEmbed, parent.y + parent.rise * plateauTop(q.x, q.z) - child.y);
      nearestPass = Math.min(nearestPass, distanceToAscent(q));
      outerRadius = Math.max(outerRadius, plateauRadius(q.x, q.z));
      assert.ok(reservedForUpper(parent, child, q.x, q.z, 0));
    }
  }
  assert.ok(minEmbed > 3, 'Upper flank must meet the underlying relief');
  assert.ok(nearestPass > 0, 'Upper footprint must clear the lower ascent');
  assert.ok(outerRadius < 1, 'Upper footprint must fit inside its supporting terrace');
  assert.equal(reservedForUpper(parent, child, -140, 75, 5), false);
  console.log(child.name, { minEmbed, nearestPass, outerRadius });
}

// Discard an entire upper ground triangle but keep the adjoining sloping face.
const small = raisedFlank({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 5, 1]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
});
assert.deepEqual([...small.indices], [0, 1, 2]);
assert.deepEqual([...small.positions], [0, 0, 0, 1, 0, 1, 0, 5, 1]);
