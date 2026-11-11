const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const {buildBoundary,sampleGrid,interpolate}=require('./seam-boundary.ts');
const {chooseSupportedBoundary,inspectBoundarySupport,triangleVertexIndices}=require('./seam-safe-boundary.ts');
const {reliefGrid,reliefTop}=require('./seam-relief-fixture.ts');
const {contourPoint,plateauRadius}=require('./plateau-profile.ts');
const {smoothstep,Rng,Simplex2}=require('../../src/core/rng.ts');
const {ascentCutVolumes}=require('./ascent.ts'),{caveCutPlanes}=require('./cavity.ts');
const relief=reliefGrid(),flat={...relief,heights:relief.heights.map((_,i)=>{
 const x=relief.x0+i%(relief.n+1)*relief.cell,z=relief.z0+Math.floor(i/(relief.n+1))*relief.cell,r=plateauRadius(x,z);
 const wall=1-smoothstep(.96,1.055,r),apron=1-smoothstep(1.04,1.23,r);
 return (1-wall)*5*apron+wall*100;
})};
const rng=new Rng(42),noise=new Simplex2(()=>rng.next());
const currentTop=(x,z)=>100+(1-smoothstep(.72,.90,plateauRadius(x,z)))*(1.8*noise.noise(x/100,z/100)+.45*noise.noise(x/35,z/35));
const current={...relief,heights:relief.heights.map((_,i)=>{
 const x=relief.x0+i%(relief.n+1)*relief.cell,z=relief.z0+Math.floor(i/(relief.n+1))*relief.cell,r=plateauRadius(x,z);
 const wall=1-smoothstep(.96,1.055,r),foot=.6*noise.noise(x/160,z/160),apron=1-smoothstep(1.04,1.23,r);
 return (1-wall)*(foot+5*apron)+wall*currentTop(x,z);
})};
const selection=chooseSupportedBoundary(flat),radius=selection.boundary.radius;
assert.equal(selection.support.invalidTriangles.length,0);
assert.ok(selection.attempts.slice(0,-1).every(a=>a.invalidTriangles>0));
const cases=[];
for(const [name,grid,top] of [['flat',flat,()=>100],['relief without attenuation',relief,reliefTop],['current game terrain',current,currentTop]]){
 const before=Buffer.from(grid.heights.buffer).toString('base64');
 const reference={...grid,heights:grid.heights.map((_,i)=>top(grid.x0+i%(grid.n+1)*grid.cell,grid.z0+Math.floor(i/(grid.n+1))*grid.cell))};
 const boundary=buildBoundary(grid,radius),old=buildBoundary(grid),support=inspectBoundarySupport(grid,boundary);
 let maxSurfaceError=0,maxControlDifference=0,maxOldControlDifference=0,selfIntersections=0,maxWeightViolation=0;
 const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
 for(let i=0;i<boundary.points.length;i++){
  const a=boundary.points[i],b=boundary.points[(i+1)%boundary.points.length];
  const tri=boundary.sourceTriangles[i],cellId=Math.floor(tri/2),ci=cellId%grid.n,cj=Math.floor(cellId/grid.n);
  for(const vi of triangleVertexIndices(grid,tri)){
   assert.equal(grid.heights[vi],reference.heights[vi],'support vertex was affected by old flank');
  }
  for(let j=0;j<=32;j++){
   const p=interpolate(a,b,j/32),u=(p.x-grid.x0)/grid.cell-ci,v=(p.z-grid.z0)/grid.cell-cj;
   const weights=tri%2?[u+v-1,1-u,1-v]:[1-u-v,u,v];
   maxWeightViolation=Math.max(maxWeightViolation,-Math.min(...weights));
   maxSurfaceError=Math.max(maxSurfaceError,Math.abs(p.y-sampleGrid(grid,p.x,p.z).y));
   maxControlDifference=Math.max(maxControlDifference,Math.abs(sampleGrid(grid,p.x,p.z).y-sampleGrid(reference,p.x,p.z).y));
  }
  for(let j=i+2;j<boundary.points.length;j++){
   if(i===0&&j===boundary.points.length-1)continue;
   const c=boundary.points[j],d=boundary.points[(j+1)%boundary.points.length];
   if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)selfIntersections++;
  }
 }
 old.points.forEach((a,i)=>{const b=old.points[(i+1)%old.points.length];for(let j=0;j<=32;j++){
  const p=interpolate(a,b,j/32);maxOldControlDifference=Math.max(maxOldControlDifference,Math.abs(sampleGrid(grid,p.x,p.z).y-sampleGrid(reference,p.x,p.z).y));
 }});
 const inside=(p,planes)=>planes.every(pl=>pl.x*p.x+pl.y*p.y+pl.z*p.z+pl.d<=2e-6);
 const counts={ordinary:0,ascentCut:0,aboveCave:0,caveActualCut:0};
 for(const p of boundary.points){
  if(inside(p,caveCutPlanes()))counts.caveActualCut++;
  if(ascentCutVolumes().some(planes=>inside(p,planes)))counts.ascentCut++;
  else if(inside(p,caveCutPlanes().filter(pl=>Math.abs(pl.y)<1e-12)))counts.aboveCave++;else counts.ordinary++;
 }
 assert.equal(support.invalidTriangles.length,0);assert.equal(maxControlDifference,0);
 assert.ok(maxSurfaceError<.00002);assert.ok(maxWeightViolation<.00002);assert.equal(selfIntersections,0);
 assert.equal(new Set(boundary.points.map(p=>`${p.x},${p.z}`)).size,boundary.points.length);
 assert.equal(Buffer.from(grid.heights.buffer).toString('base64'),before,'source grid changed');
 cases.push({name,vertices:boundary.points.length,closed:true,selfIntersections,supportTriangles:support.triangles,invalidTriangles:support.invalidTriangles.length,
 maxVertexRadius:support.maxVertexRadius,maxSurfaceError,maxControlDifference,maxOldControlDifference,maxWeightViolation,
 minHeight:Math.min(...boundary.points.map(p=>p.y)),maxHeight:Math.max(...boundary.points.map(p=>p.y)),counts});
}
const shifts=Array.from({length:32768},(_,i)=>{
 const a=i*2*Math.PI/32768,old=contourPoint(a),next=contourPoint(a,radius);return Math.hypot(old.x-next.x,old.z-next.z);
});
const planScaleMax=Math.max(...shifts)/(.96-radius);
const report={result:'PASS',scope:'candidate diagnostic only; original game E not replaced; no strip',radius,search:{step:selection.step,trials:selection.attempts.length,outermostTestedSafe:true,globalOptimumClaim:false,maxPlanStepMeters:planScaleMax*selection.step,attempts:selection.attempts},
 displacement:{meaning:'plan distance along matching radial rays, 32768 angular samples; not shortest normal distance',min:Math.min(...shifts),max:Math.max(...shifts)},cases};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,search:{...report.search,attempts:'see report'}},null,2));
