const fs = require('node:fs'), assert = require('node:assert/strict'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, f);
const { buildWedgeAscent } = require('./wedge-ascent.ts');
const { reliefGrid, reliefTop } = require('./seam-relief-fixture.ts');
const { plateauRadius } = require('./plateau-profile.ts');
const { smoothstep } = require('../../src/core/rng.ts');
const { ascentHeight, ascentCenter, ascentWidth } = require('./ascent.ts');
const point = (m, k) => Array.from(m.positions.subarray(k * 3, k * 3 + 3));
const key = p => p.join(',');
const edgeKey = (a, b) => [key(a), key(b)].sort().join('|');
const triangleKey = p => p.map(key).sort().join('|');
function triangles(m) {
  const out = [];
  for (let k = 0; k < m.indices.length; k += 3) out.push(Array.from(m.indices.subarray(k, k + 3), id => point(m, id)));
  return out;
}

(async () => {
  const THREE = await import('three'), reports = [];
  function faces(m) {
    const edges = new Map();
    for (const p of triangles(m)) {
      const [a, b, c] = p.map(v => new THREE.Vector3(...v));
      const n = b.sub(a).cross(c.sub(a));
      assert.ok(n.length() > 1e-8, 'No degenerate faces'); n.normalize();
      for (let j = 0; j < 3; j++) edges.set(edgeKey(p[j], p[(j + 1) % 3]), n);
    }
    return edges;
  }
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
    const a = faces(j.uncut.plateau), b = faces(j.uncut.strip);
    let maxAngle = 0;
    for (let k = 0; k < j.accepted.seam.points.length; k++) {
      const p = j.accepted.seam.points[k], q = j.accepted.seam.points[(k + 1) % j.accepted.seam.points.length];
      const edge = edgeKey([p.x, p.y, p.z], [q.x, q.y, q.z]);
      assert.ok(a.has(edge) && b.has(edge), 'Same canonical edge on both sides of E');
      maxAngle = Math.max(maxAngle, Math.acos(Math.max(-1, Math.min(1, a.get(edge).dot(b.get(edge))))) * 180 / Math.PI);
    }
    assert.ok(maxAngle < .1, 'No regression of the accepted open upper seam');
    let unchangedFaces = 0;
    for (const name of ['strip', 'underside']) {
      const current = new Set(triangles(j.uncut[name]).map(triangleKey));
      for (const p of triangles(j.accepted[name])) {
        if (p.every(v => j.endingWeight(Math.atan2(v[2] / 180, v[0] / 260)) === 1)) {
          assert.ok(current.has(triangleKey(p)), 'Accepted faces outside taper preserved exactly'); unchangedFaces++;
        }
      }
    }
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
    reports.push({ kind, seamEdges: j.accepted.seam.points.length, maxSeamAngleDeg: maxAngle, unchangedFaces, wallProbes, maxWidthErrorM: maxWidthError, sourceUnchanged: true });
  }
  console.log(JSON.stringify({ result: 'PASS', reports, physicsPlayerTested: false }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
