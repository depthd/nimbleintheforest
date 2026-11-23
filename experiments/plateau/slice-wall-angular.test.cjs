const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { PerspectiveCamera, Ray, Vector3 } = require('three');

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
// The full perspective camera and native 800x450 pixel grid form an independent
// check of the generator's sparse entrance-side sampling. Rasterize the bank
// too, since it can obscure some of the stone at the front of the fan.
const camera = new PerspectiveCamera(27, 800 / 450, 0.2, 10500);
camera.position.set(-950, 160, -580);
camera.lookAt(-270, 66, -126);
camera.updateMatrixWorld();
function projectedSnowPercent(wall) {
  const width = 800, height = 450;
  const depths = new Float64Array(width * height).fill(Infinity);
  const ids = new Uint8Array(depths.length);
  for (const kind of ['rock', 'snow']) {
    const mesh = wall[kind], vertices = [];
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const p = meshPoint(mesh, i);
      p.x *= 1.85; p.z *= 1.85;
      p.project(camera);
      p.x = (p.x + 1) * width / 2;
      p.y = (1 - p.y) * height / 2;
      vertices.push(p);
    }
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = vertices[mesh.indices[t]], b = vertices[mesh.indices[t + 1]], c = vertices[mesh.indices[t + 2]];
      const area = (b.y-c.y)*(a.x-c.x) + (c.x-b.x)*(a.y-c.y);
      if (area >= 0) continue;
      const left = Math.max(0, Math.floor(Math.min(a.x,b.x,c.x)));
      const right = Math.min(width-1, Math.ceil(Math.max(a.x,b.x,c.x)));
      const top = Math.max(0, Math.floor(Math.min(a.y,b.y,c.y)));
      const bottom = Math.min(height-1, Math.ceil(Math.max(a.y,b.y,c.y)));
      const id = kind === 'rock' ? 1 : t < wall.snowWallIndexCount ? 2 : 3;
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const dx = x+.5-c.x, dy = y+.5-c.y;
          const u = ((b.y-c.y)*dx + (c.x-b.x)*dy) / area;
          const v = ((c.y-a.y)*dx + (a.x-c.x)*dy) / area;
          const w = 1-u-v;
          if (Math.min(u,v,w) < 0) continue;
          const depth = u*a.z + v*b.z + w*c.z, i = y*width+x;
          if (depth >= depths[i]) continue;
          depths[i] = depth;
          ids[i] = id;
        }
      }
    }
  }
  let rock = 0, snow = 0;
  for (const id of ids) {
    if (id === 1) rock++;
    if (id === 2) snow++;
  }
  return 100 * snow / (rock + snow);
}

const newSeed = Number(process.argv[2] || 818723);
const rows = [];
for (const seed of [13947, 42, 7, 8191, 23011, newSeed]) for (const count of [5, 8, 12]) {
  const wall = buildAngularWall(site, count, seed);
  assert.deepEqual(wall, buildAngularWall(site, count, seed), 'seed must be reproducible');
  assert.equal(wall.masses.length, count);
  const boxes = [], rockFaces = [];
  let maxWidth = 0, minRouteClearance = Infinity;
  for (const mass of wall.masses) {
    const verts = new Set();
    const edges = new Map(), orientation = new Map();
    for (let t = mass.firstTriangle; t < mass.firstTriangle + mass.triangles; t++) {
      const tri = Array.from(wall.rock.indices.slice(3*t, 3*t+3));
      const vertices = tri.map(id => meshPoint(wall.rock, id));
      rockFaces.push(vertices);
      assert.ok(vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).lengthSq() > 1e-6);
      for (let k = 0; k < 3; k++) {
        const a = tri[k], b = tri[(k+1)%3], edge = [a,b].sort((a,b)=>a-b).join(',');
        verts.add(a);
        edges.set(edge, (edges.get(edge) || 0) + 1);
        orientation.set(edge, (orientation.get(edge) || 0) + (a < b ? 1 : -1));
      }
    }
    assert.ok([...edges.values()].every(v=>v===2), 'each rock is closed');
    assert.ok([...orientation.values()].every(v=>v===0), 'outward winding is consistent');
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
  let minSnowNormalY=Infinity, maxSnowSupportGap=0;
  const downward=new Vector3(0,-1,0), intersection=new Vector3();
  for(let k=0;k<wall.snow.indices.length;k+=3) {
    const [a,b,c]=Array.from(wall.snow.indices.slice(k,k+3),id=>meshPoint(wall.snow,id));
    const center=a.clone().add(b).add(c).multiplyScalar(1/3);
    if(k<wall.snowWallIndexCount) {
      const ray=new Ray(center,downward);
      let gap=Infinity;
      for(const [r0,r1,r2] of rockFaces) {
        if(ray.intersectTriangle(r0,r1,r2,true,intersection)) gap=Math.min(gap,center.y-intersection.y);
      }
      assert.ok(gap>=0 && gap<0.6, 'snow sits immediately over an upward rock face');
      maxSnowSupportGap=Math.max(maxSnowSupportGap,gap);
    }
    const normal=b.sub(a).cross(c.sub(a)).normalize();
    assert.ok(Number.isFinite(normal.y) && normal.y>0, 'snow triangles face up');
    minSnowNormalY=Math.min(minSnowNormalY,normal.y);
  }
  const snowPercent = projectedSnowPercent(wall);
  assert.ok(snowPercent >= 20 && snowPercent <= 30, "projected coverage stays near 25%");
  rows.push({seed,count,snowPercent,rockTriangles:wall.rock.indices.length/3,snowTriangles:wall.snow.indices.length/3,
    maxWidth,minRouteClearance,minSnowNormalY,maxSnowSupportGap});
}
assert.notDeepEqual(buildAngularWall(site, 8,7).rock.positions,buildAngularWall(site,8,42).rock.positions);
assert.throws(()=>buildAngularWall(site,9,7),RangeError);
console.log(JSON.stringify(rows,null,2));
