const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { Vector3 } = require('three');

require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file,
);
const { buildAngularWall } = require('./slice-wall-angular.ts');
const { plateauTop } = require('./mountain-shape.ts');
const { reliefGrid } = require('./seam-relief-fixture.ts');
const { sampleGrid } = require('./seam-boundary.ts');
const { ascentSample } = require('./ascent.ts');
const meshPoint = (mesh, i) => new Vector3().fromArray(mesh.positions, 3 * i);
const source = reliefGrid(plateauTop);
// Actual lower-tier rim and tangent read from the baseline's buildMountainMasses.
const site = {
  x: -206.5008053555278, z: -141.42690281926113, angle: -.7888201985996071,
  width: 100, height: 106.39975301077203,
  groundAt: (x, z) => sampleGrid(source, x, z).y,
};
const along = new Vector3(Math.cos(site.angle), 0, Math.sin(site.angle));
const across = new Vector3(along.z, 0, -along.x);
const newSeed = Number(process.argv[2] || 818723);
const rows = [];
for (const seed of [13947, 42, 7, newSeed]) for (const count of [5, 8, 12]) {
  const wall = buildAngularWall(site, count, seed);
  assert.deepEqual(wall, buildAngularWall(site, count, seed), 'seed must be reproducible');
  assert.equal(wall.masses.length, count);
  const boxes = [];
  let maxWidth = 0, minRouteClearance = Infinity;
  for (const mass of wall.masses) {
    const verts = new Set();
    const edges = new Map();
    for (let t = mass.firstTriangle; t < mass.firstTriangle + mass.triangles; t++) {
      const tri = Array.from(wall.rock.indices.slice(3*t, 3*t+3));
      for (let k = 0; k < 3; k++) {
        const a = tri[k], b = tri[(k+1)%3], edge = [a,b].sort((a,b)=>a-b).join(',');
        verts.add(a);
        edges.set(edge, (edges.get(edge) || 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(v=>v===2), 'each rock is closed');
    const pts = [...verts].map(id=>meshPoint(wall.rock, id));
    const u = pts.map(p=>p.dot(along)), v = pts.map(p=>p.dot(across));
    assert.ok(pts.some(p=>p.y<site.groundAt(p.x,p.z)), 'rock sits into ground');
    assert.ok(pts.every(p=>Number.isFinite(p.length())&&p.y<site.height), 'rock below snow rim');
    const width = Math.max(...u)-Math.min(...u);
    assert.ok(width<=site.width/3);
    maxWidth = Math.max(maxWidth, width);
    boxes.push([Math.min(...u),Math.max(...u),Math.min(...v),Math.max(...v)]);
    for (const p of pts) {
      const route = ascentSample(p.x);
      minRouteClearance = Math.min(minRouteClearance,Math.abs(p.z-route.z)-route.w);
    }
  }
  assert.ok(minRouteClearance>2, 'walk corridor is clear');
  for(let a=0;a<count;a++) for(let b=0;b<a;b++){
    const A=boxes[a],B=boxes[b];
    assert.ok(A[1]<=B[0]||B[1]<=A[0]||A[3]<=B[2]||B[3]<=A[2], 'boulders have disjoint plan envelopes');
  }
  let minSnowNormalY=Infinity;
  for(let k=0;k<wall.snow.indices.length;k+=3) {
    const [a,b,c]=Array.from(wall.snow.indices.slice(k,k+3),id=>meshPoint(wall.snow,id));
    const normal=b.sub(a).cross(c.sub(a)).normalize();
    assert.ok(Number.isFinite(normal.y) && normal.y>0, 'snow triangles face up');
    minSnowNormalY=Math.min(minSnowNormalY,normal.y);
  }
  rows.push({seed,count,rockTriangles:wall.rock.indices.length/3,snowTriangles:wall.snow.indices.length/3,
    maxWidth,minRouteClearance,minSnowNormalY});
}
assert.notDeepEqual(buildAngularWall(site, 8,7).rock.positions,buildAngularWall(site,8,42).rock.positions);
assert.throws(()=>buildAngularWall(site,9,7),RangeError);
console.log(JSON.stringify(rows,null,2));
