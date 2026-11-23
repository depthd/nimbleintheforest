const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, file);
const { buildRoundedWall } = require('./slice-wall-rounded.ts');
const { plateauTop, mountainEnding } = require('./mountain-shape.ts');
const { reliefGrid } = require('./seam-relief-fixture.ts');
const { buildWedgeAscent } = require('./wedge-ascent.ts');
const { bluntTip } = require('./wedge-tip-profile.ts');
const { mountainRim } = require('./mountain-snow.ts');
const { ringPoint } = require('./wedge-snow-layer.ts');
const { contourTangent } = require('./plateau-profile.ts');
const { sampleGrid } = require('./seam-boundary.ts');
const { ascentSample } = require('./ascent.ts');
const { surfaceRoof } = require('./wedge-rocks.ts');

const source = reliefGrid(plateauTop);
const heights = source.heights.map((_, i) => plateauTop(
  source.x0 + i % (source.n + 1) * source.cell,
  source.z0 + Math.floor(i / (source.n + 1)) * source.cell));
const junction = buildWedgeAscent(source, { ...source, heights }, mountainEnding, bluntTip);
const angle = Math.PI + 0.78;
const p = ringPoint(mountainRim(junction), angle);
const tangent = contourTangent(angle);
const roof = surfaceRoof([junction.cut.plateau, junction.cut.strip]);
const site = {
  x: p.x, z: p.z, angle: Math.atan2(tangent.z, tangent.x), width: 100, height: p.y,
  groundAt: (x, z) => sampleGrid(source, x, z).y
};
const seen = new Set();
const rows = [];
for (const count of [4, 7, 10]) {
  for (const seed of [42, 7, 8191, Number(process.env.NEW_SEED || 23011)]) {
    const wall = buildRoundedWall(site, count, seed);
    const repeated = buildRoundedWall(site, count, seed);
    assert.deepEqual(wall, repeated);
    const sha = crypto.createHash('sha256').update(wall.rock.positions).update(wall.snow.positions).digest('hex');
    assert.ok(!seen.has(sha));
    seen.add(sha);
    assert.equal(wall.masses.length, count);
    let maxWidth = 0;
    let minSnowNormal = 1;
    let minPassClearance = Infinity;
    let maxRoofIntrusion = 0;
    const edges = new Map();
    // Combined rock and snow crowns form a closed oriented shell. Foot drifts
    // intentionally end below the sampled terrain and are tested separately.
    for (const [material, mesh] of [['rock', wall.rock], ['snow', wall.snow]]) {
      const { indices, positions } = mesh;
      assert.equal(mesh.colors.length, positions.length);
      for (let k = 0; k < indices.length; k += 3) {
        const triangle = Array.from(indices.subarray(k, k + 3), (id) =>
          Array.from(positions.subarray(3 * id, 3 * id + 3)));
        const [a, b, c] = triangle;
        const ab = b.map((x, i) => x - a[i]), ac = c.map((x, i) => x - a[i]);
        const normal = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]];
        const length = Math.hypot(...normal);
        assert.ok(length > 1e-6);
        if (material === 'snow' && k < wall.capTriangleCount * 3) {
          minSnowNormal = Math.min(minSnowNormal, normal[1] / length);
          assert.ok(normal[1] / length > 0.58, 'Snow on a vertical or downward rock face');
        }
        const roofClearance = roof.triangleClearance(triangle.map(([x,y,z]) => ({x,y,z})));
        maxRoofIntrusion = Math.max(maxRoofIntrusion, -roofClearance);
        for (const [x,y,z] of [...triangle, a.map((v,i) => (v+b[i]+c[i])/3)]) {
          assert.ok([x,y,z].every(Number.isFinite));
          const ramp = ascentSample(x);
          if (x >= -300 && x <= 20) minPassClearance = Math.min(minPassClearance, Math.abs(z-ramp.z) - ramp.w);
        }
        if (material === 'rock' || k < 3 * wall.capTriangleCount) {
          for (let j = 0; j < 3; j++) {
            const aKey = triangle[j].join(','), bKey = triangle[(j+1)%3].join(',');
            const key = aKey < bKey ? aKey+'|'+bKey : bKey+'|'+aKey;
            const edge = edges.get(key) || [0,0];
            edge[0]++; edge[1] += aKey < bKey ? 1 : -1; edges.set(key,edge);
          }
        }
      }
    }
    for (const [uses, direction] of edges.values()) assert.deepEqual([uses, direction], [2, 0]);
    assert.ok(minPassClearance > 2, 'Entrance piece intrudes into the existing passage');
    assert.equal(maxRoofIntrusion, 0, 'A triangle emerges through the plateau');
    for (const [i, bounds] of wall.masses.entries()) {
      maxWidth = Math.max(maxWidth, bounds.maxU - bounds.minU);
      for (const other of wall.masses.slice(i + 1)) {
        assert.ok(other.minU > bounds.maxU || bounds.minU > other.maxU ||
          other.minV > bounds.maxV || bounds.minV > other.maxV, 'Individual solid blocks intersect');
      }
    }
    assert.ok(maxWidth <= site.width / 3);
    // The last two vertices of each middle triangle are perimeter vertices.
    for (let k = wall.capTriangleCount * 3; k < wall.snow.indices.length; k += 9) {
      for (const i of [4,5]) {
        const vertex = wall.snow.indices[k+i] * 3;
        const [x,y,z] = wall.snow.positions.subarray(vertex, vertex+3);
        assert.ok(y < site.groundAt(x,z) - 0.14);
      }
    }
    rows.push({ count, seed, sha, rockTriangles: wall.rock.indices.length/3,
      snowTriangles: wall.snow.indices.length/3, maxWidth, minSnowNormal, minPassClearance, maxRoofIntrusion });
  }
}
console.log(JSON.stringify({site, rows},null,2));
