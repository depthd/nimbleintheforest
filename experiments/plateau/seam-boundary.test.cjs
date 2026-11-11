// Geometry tests, independent of the renderer and of screenshots.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const {buildBoundary, sampleGrid, splitBoundary, interpolate} = require('./seam-boundary.ts');
const {plateauRadius, contourPoint, SLOPE_START} = require('./plateau-profile.ts');
const {ascentCutVolumes} = require('./ascent.ts');
const {caveCutPlanes} = require('./cavity.ts');
const {Rng, Simplex2, smoothstep} = require('../../src/core/rng.ts');

const rng = new Rng(42), noise = new Simplex2(() => rng.next());
function originalHeight(x, z) {
  const angle = Math.atan2(z / 180, x / 260);
  const outline = 1 + .095 * Math.sin(angle * 3 + .7) + .055 * Math.cos(angle * 5 - .4);
  const radius = Math.hypot(x / 260, z / 180) / outline;
  const top = 100 + (1 - smoothstep(.72,.90,radius)) * (1.8 * noise.noise(x / 100, z / 100) + .45 * noise.noise(x / 35, z / 35));
  const foot = .6 * noise.noise(x / 160, z / 160);
  const wall = 1 - smoothstep(.96, 1.055, radius);
  const apron = 1 - smoothstep(1.04, 1.23, radius);
  return (1 - wall) * (foot + 5 * apron) + wall * top;
}
function makeGrid(height, cell = 4) {
  const n = 1400 / cell, heights = new Float32Array((n + 1) ** 2);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = i * cell - 700, z = j * cell - 700;
    // Extracting the plan profile must preserve the exact existing equation.
    const oldRadius = Math.hypot(x / 260, z / 180) / (1 + .095 * Math.sin(3 * Math.atan2(z / 180, x / 260) + .7) + .055 * Math.cos(5 * Math.atan2(z / 180, x / 260) - .4));
    assert.equal(plateauRadius(x, z), oldRadius);
    heights[j * (n + 1) + i] = height(x, z);
  }
  return {n, cell, x0: -700, z0: -700, heights};
}
const cross = (a,b,c) => (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
function intersects(a,b,c,d) {
  return cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0;
}
function distanceToSegment(p,a,b) {
  const dx=b.x-a.x,dz=b.z-a.z;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));
  return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);
}
function triangleWeights(grid, id, p) {
  const cellId=Math.floor(id/2),i=cellId%grid.n,j=Math.floor(cellId/grid.n);
  const a=(p.x-grid.x0)/grid.cell-i,b=(p.z-grid.z0)/grid.cell-j;
  return id%2 ? [a+b-1,1-a,1-b] : [1-a-b,a,b];
}
function check(name, grid, radius = SLOPE_START) {
  const before = Buffer.from(grid.heights.buffer).toString('base64');
  const seam=buildBoundary(grid,radius), points=seam.points, count=points.length;
  assert.ok(count > 100);
  assert.equal(new Set(points.map(p=>`${p.x},${p.z}`)).size,count,'duplicate joint');
  let maxHeightError=0,maxContourError=0,maxPlanDeviation=0,minLength=Infinity;
  for(let i=0;i<count;i++) {
    const a=points[i],b=points[(i+1)%count];
    minLength=Math.min(minLength,Math.hypot(b.x-a.x,b.z-a.z));
    assert.ok(Math.hypot(b.x-a.x,b.z-a.z)>1e-6,'zero-length seam edge');
    const gridDistance=Math.min(...[a.x-grid.x0,a.z-grid.z0,a.x+a.z-grid.x0-grid.z0].map(v=>Math.abs(v/grid.cell-Math.round(v/grid.cell))*grid.cell));
    assert.ok(gridDistance<4e-5,'joint is not on any grid edge');
    maxContourError=Math.max(maxContourError,Math.abs(plateauRadius(a.x,a.z)-radius));
    for(let j=0;j<=16;j++) {
      const t=j/16,p=interpolate(a,b,t);
      assert.ok(Math.min(...triangleWeights(grid,seam.sourceTriangles[i],p))>-2e-5,'segment crosses an unrecorded triangle edge');
      maxHeightError=Math.max(maxHeightError,Math.abs(p.y-sampleGrid(grid,p.x,p.z).y));
      const next=seam.angles[(i+1)%count]+(i===count-1?Math.PI*2:0);
      maxPlanDeviation=Math.max(maxPlanDeviation,distanceToSegment(contourPoint(seam.angles[i]+(next-seam.angles[i])*t,radius),a,b));
    }
    for(let j=i+2;j<count;j++) {
      if(i===0 && j===count-1)continue;
      assert.ok(!intersects(a,b,points[j],points[(j+1)%count]),'self-intersection');
    }
  }
  assert.ok(maxHeightError<.0002,`${name}: surface mismatch ${maxHeightError}`);
  assert.ok(maxContourError<2e-7,`contour joint error ${maxContourError}`);
  assert.ok(maxPlanDeviation<.1,`contour approximation ${maxPlanDeviation}`);
  assert.equal(Buffer.from(grid.heights.buffer).toString('base64'),before,'source grid mutated');
  return {name,cell:grid.cell,radius,vertices:count,edges:count,maxHeightError,maxContourError,maxPlanDeviation,minLength,seam};
}

const results=[
  check('current plateau',makeGrid(originalHeight)),
  check('flat top',makeGrid(()=>100)),
  check('rising top',makeGrid((x,z)=>100+.09*x+.04*z)),
  check('falling top',makeGrid((x,z)=>100-.12*x-.03*z)),
  check('bumps and depressions',makeGrid((x,z)=>100+7*Math.sin(x/17)*Math.cos(z/23)+3*Math.sin((x+z)/7))),
  check('contour through lattice vertices',makeGrid((x,z)=>100+4*Math.sin(x/13)), 260/(260*(1+.095*Math.sin(.7)+.055*Math.cos(-.4)))),
];
const volumes=[...ascentCutVolumes().map(planes=>({kind:'ascent',planes})),{kind:'cave',planes:caveCutPlanes()}];
const parts=splitBoundary(results[0].seam,volumes);
const cutCounts={surface:0,ascent:0,cave:0};
for(const part of parts) {
  cutCounts[part.kind]++;
  const p=interpolate(part.a,part.b,.5);
  const inside=volumes.find(v=>v.planes.every(pl=>pl.x*p.x+pl.y*p.y+pl.z*p.z+pl.d<=2e-6));
  assert.equal(part.kind,inside?.kind??'surface','cut classification disagrees with excavation');
}
assert.ok(cutCounts.ascent>0,'existing ascent must cross seam');
assert.equal(cutCounts.cave,0,'low cave must not cut the 100m-high seam');
for(let i=0;i<parts.length;i++) {
  const a=parts[i].b,b=parts[(i+1)%parts.length].a;
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<1e-9,'gap after cut classification');
}
const report={result:'PASS',stage:'boundary diagnostic only; no mask strip or rendering removal',cases:results.map(({seam,...r})=>r),cutCounts,
 checks:['shared source equations unchanged on full grid','closed chain without duplicate joints or self-intersections','all grid directions including diagonals','each segment lies on a source triangle','current/flat/rising/falling/bumpy relief','contour through grid vertices','actual ascent/cave volume classification','source grid not mutated'],
 notChecked:['future strip shape and lighting','final seamless transition','future render removal coverage']};
if(process.argv[2])fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
