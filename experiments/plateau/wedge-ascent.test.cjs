const fs = require('node:fs'), assert = require('node:assert/strict'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, f);
const { buildWedgeAscent } = require('./wedge-ascent.ts');
const { reliefGrid, reliefTop } = require('./seam-relief-fixture.ts');
const { plateauRadius } = require('./plateau-profile.ts');
const { sampleGrid } = require('./seam-boundary.ts');
const { triangleVertexIndices } = require('./seam-safe-boundary.ts');
const { smoothstep } = require('../../src/core/rng.ts');
const { ascentHeight, ascentCenter, ascentWidth } = require('./ascent.ts');
const point = (m, k) => Array.from(m.positions.subarray(k * 3, k * 3 + 3));
const key = p => p.join(',');
const triangleKey = p => p.map(key).sort().join('|');
function triangles(m) {
  const out = [];
  for (let k = 0; k < m.indices.length; k += 3) out.push(Array.from(m.indices.subarray(k, k + 3), id => point(m, id)));
  return out;
}

(async () => {
  const THREE = await import('three'), reports = [];
  for (const kind of ['flat', 'relief']) {
    const source = reliefGrid(), top = kind === 'flat' ? () => 100 : reliefTop;
    const upper = { ...source, heights: source.heights.map((_, k) => top(source.x0 + k % (source.n + 1) * source.cell, source.z0 + Math.floor(k / (source.n + 1)) * source.cell)) };
    if (kind === 'flat') source.heights = source.heights.map((_, k) => {
      const x = source.x0 + k % (source.n + 1) * source.cell, z = source.z0 + Math.floor(k / (source.n + 1)) * source.cell;
      const r = plateauRadius(x, z), w = 1 - smoothstep(.96, 1.055, r);
      return 100 * w + (1 - w) * 5 * (1 - smoothstep(1.04, 1.23, r));
    });
    const before = Buffer.from(source.heights.buffer).toString('base64'), j = buildWedgeAscent(source, upper);
    assert.equal(Buffer.from(source.heights.buffer).toString('base64'), before, 'Source heights preserved');
    let maxTopHeightError = 0, maxTopAngle = 0;
    for (let k = 0; k < j.uncut.strip.positions.length; k += 3) {
      const p = j.uncut.strip.positions;
      maxTopHeightError = Math.max(maxTopHeightError, Math.abs(p[k + 1] - sampleGrid(upper, p[k], p[k + 2]).y));
    }
    assert.ok(maxTopHeightError < .0001, 'Circular cut preserves the upper face, including its height');
    for (const p of triangles(j.uncut.strip)) {
      const center = p.reduce((c, v) => c.map((x, i) => x + v[i] / 3), [0, 0, 0]);
      const id = sampleGrid(upper, center[0], center[2]).triangle;
      const q = triangleVertexIndices(upper, id).map(k => new THREE.Vector3(upper.x0 + k % (upper.n + 1) * upper.cell, upper.heights[k], upper.z0 + Math.floor(k / (upper.n + 1)) * upper.cell));
      const n = new THREE.Vector3(...p[1]).sub(new THREE.Vector3(...p[0])).cross(new THREE.Vector3(...p[2]).sub(new THREE.Vector3(...p[0])));
      if (n.length() < .04) continue; // sub-centimetre slivers do not define a visible face
      const original = q[1].sub(q[0]).cross(q[2].sub(q[0])).normalize();
      maxTopAngle = Math.max(maxTopAngle, Math.acos(Math.max(-1, Math.min(1, n.normalize().dot(original)))) * 180 / Math.PI);
    }
    assert.ok(maxTopAngle < .1, 'No bending of retained upper triangles');
    const cells = new Map(), oldBottom = triangles(j.accepted.underside);
    for (const p of oldBottom) {
      const xs = p.map(v => v[0]), zs = p.map(v => v[2]);
      for (let x = Math.floor(Math.min(...xs) / 4); x <= Math.floor(Math.max(...xs) / 4); x++) for (let z = Math.floor(Math.min(...zs) / 4); z <= Math.floor(Math.max(...zs) / 4); z++) {
        const k = x + ',' + z; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(p);
      }
    }
    let maxUndersideHeightError = 0;
    const checked = new Set();
    for (const p of triangles(j.uncut.underside).flat()) {
      if (checked.has(key(p))) continue; checked.add(key(p));
      let error = Infinity;
      for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) for (const [a, b, c] of cells.get((Math.floor(p[0] / 4) + ix) + ',' + (Math.floor(p[2] / 4) + iz)) ?? []) {
        const dx = p[0] - a[0], dz = p[2] - a[2], bx = b[0] - a[0], bz = b[2] - a[2], cx = c[0] - a[0], cz = c[2] - a[2], det = bx * cz - bz * cx;
        if (Math.abs(det) < 1e-12) continue;
        const u = (dx * cz - dz * cx) / det, v = (bx * dz - bz * dx) / det;
        if (u < -.002 || v < -.002 || u + v > 1.002) continue;
        error = Math.min(error, Math.abs(p[1] - a[1] - u * (b[1] - a[1]) - v * (c[1] - a[1])));
      }
      maxUndersideHeightError = Math.max(maxUndersideHeightError, error);
    }
    assert.ok(maxUndersideHeightError < .0005, 'Concave underside is clipped, never reshaped');
    let unchangedFaces = 0;
    for (const name of ['strip', 'underside']) {
      const current = new Set(triangles(j.uncut[name]).map(triangleKey)), circle = j.ending.circle;
      for (const p of triangles(j.accepted[name])) {
        const xs = p.map(v => v[0]), zs = p.map(v => v[2]);
        const dx = Math.max(Math.min(...xs) - circle.x, 0, circle.x - Math.max(...xs));
        const dz = Math.max(Math.min(...zs) - circle.z, 0, circle.z - Math.max(...zs));
        if (Math.hypot(dx, dz) > circle.radius + .01) {
          assert.ok(current.has(triangleKey(p)), 'Accepted faces outside the circular cut preserved exactly'); unchangedFaces++;
        }
      }
    }
    for (const name of ['strip', 'underside', 'ending']) assert.equal(j.cut[name].cutTriangles, 0, 'Mask ends before the passage walls');
    const meshes = Object.entries(j.cut).map(([name, data]) => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      g.setIndex(new THREE.BufferAttribute(data.indices, 1));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); m.name = name; return m;
    });
    let wallProbes = 0, maxWidthError = 0;
    for (const x of [-240, -235, -230, -225, -215, -205, -190, -150, -70]) for (const side of [-1, 1]) {
      const z = ascentCenter(x) + side * (ascentWidth(x) + .001), floor = ascentHeight(x);
      const above = new THREE.Raycaster(new THREE.Vector3(x, 160, z), new THREE.Vector3(0, -1, 0)).intersectObjects(meshes)[0];
      if (!above || above.point.y < floor + 3) continue;
      for (const t of [.1, .5, .9, .99]) {
        const y = floor + 1 + (above.point.y - floor - 2) * t;
        const hit = new THREE.Raycaster(new THREE.Vector3(x, y, ascentCenter(x)), new THREE.Vector3(0, 0, side)).intersectObjects(meshes)[0];
        assert.ok(hit, 'Closed wall from inside the passage');
        const error = Math.abs(hit.distance - ascentWidth(x));
        assert.ok(error < .001, 'Existing passage width retained');
        maxWidthError = Math.max(maxWidthError, error); wallProbes++;
      }
    }
    assert.ok(wallProbes >= 48);
    for (const x of [-230, -205, -150, -70]) {
      const hit = new THREE.Raycaster(new THREE.Vector3(x, 160, ascentCenter(x)), new THREE.Vector3(0, -1, 0)).intersectObjects(meshes)[0];
      assert.ok(hit && Math.abs(hit.point.y - ascentHeight(x)) < .001, 'Passage open to its existing floor');
    }
    reports.push({ kind, maxTopHeightErrorM: maxTopHeightError, maxTopAngleDeg: maxTopAngle, maxUndersideHeightErrorM: maxUndersideHeightError, unchangedFaces, wallProbes, maxWidthErrorM: maxWidthError, sourceUnchanged: true });
  }
  console.log(JSON.stringify({ result: 'PASS', reports, physicsPlayerTested: false }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
