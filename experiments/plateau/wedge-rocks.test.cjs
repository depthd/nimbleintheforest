const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const {buildWedgeAscent} = require('./wedge-ascent.ts'), {buildWedgeRocks} = require('./wedge-rocks.ts');
const {reliefGrid, reliefTop, chaoticTop} = require('./seam-relief-fixture.ts'), {contourPoint, plateauRadius} = require('./plateau-profile.ts');
const {bluntTip,sharpTip}=require('./wedge-tip-profile.ts');
const {sampleGrid} = require('./seam-boundary.ts'), {ascentCenter, ascentWidth, ascentHeight} = require('./ascent.ts');
function digest(j, source, upper) { const h=crypto.createHash('sha256'); for(const m of Object.values(j.cut)) {h.update(m.positions);h.update(m.indices);}h.update(source.heights);h.update(upper.heights);return h.digest('hex'); }
(async()=>{
 const THREE = await import('three'), source=reliefGrid(process.env.RELIEF_KIND==='chaotic'?chaoticTop:reliefTop), upper={...source,heights:source.heights.map((_,k)=>(process.env.RELIEF_KIND==='chaotic'?chaoticTop:reliefTop)(source.x0+k%(source.n+1)*source.cell,source.z0+Math.floor(k/(source.n+1))*source.cell))};
 const j=buildWedgeAscent(source,upper,undefined,process.env.TIP_KIND==='blunt'?bluntTip:sharpTip), before=digest(j,source,upper), dressing=buildWedgeRocks(j.cut,source,upper);
 assert.equal(digest(j,source,upper),before,'Dressing must not mutate the accepted base or source heights');
 assert.ok(dressing.stats.exteriorBlocks>500 && dressing.stats.wallBlocks>100,'Both exterior and passage walls are dressed');
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
 const meshes=['underside','flank','restored'].map(name=>{const m=j.cut[name],g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(m.positions,3));g.setIndex(new THREE.BufferAttribute(m.indices,1));return new THREE.Mesh(g,material)});
 let rays=0,maxAttachmentError=0;
 for(const a of [0,.7,1.4,2.1,2.7,2.9,3.05,3.15,3.3,3.5,3.8,4.4,5.2,5.9])for(const y of [8,25,50,75,90,100]){
  const from=contourPoint(a,1.35),unit=contourPoint(a,1),length=Math.hypot(unit.x,unit.z);
  const cast=new THREE.Raycaster(new THREE.Vector3(from.x,y,from.z),new THREE.Vector3(-unit.x/length,0,-unit.z/length),0,length*.5);
  const hit=cast.intersectObjects(meshes).find(h=>Math.abs(h.face.normal.y)<=.95&&plateauRadius(h.point.x,h.point.z)>=.88&&plateauRadius(h.point.x,h.point.z)<=1.16);
  const sample=dressing.sample(a,y);assert.equal(!!sample,!!hit,'Attachment sampler agrees with independent Three raycaster');
  if(hit){const e=Math.hypot(sample.x-hit.point.x,sample.y-hit.point.y,sample.z-hit.point.z);assert.ok(e<.0001);maxAttachmentError=Math.max(maxAttachmentError,e);rays++;}
 }
 assert.ok(rays>40);
 let maxPassageIntrusion=0,minTopClearance=Infinity;
 for(const mesh of [dressing.rocks,dressing.snow])for(let k=0;k<mesh.indices.length;k+=3){
  const tri=Array.from(mesh.indices.subarray(k,k+3),id=>Array.from(mesh.positions.subarray(id*3,id*3+3)));
  const center=[0,1,2].map(q=>(tri[0][q]+tri[1][q]+tri[2][q])/3);
  for(const [x,y,z]of [...tri,center]){
   assert.ok(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z));
   minTopClearance=Math.min(minTopClearance,sampleGrid(upper,x,z).y-y);
   if(x>=-300&&x<=20&&y>ascentHeight(x)+.01)maxPassageIntrusion=Math.max(maxPassageIntrusion,ascentWidth(x)-Math.abs(z-ascentCenter(x)));
  }
 }
 assert.ok(minTopClearance>.25,'No dressing or snow crosses the upper face');
 assert.ok(maxPassageIntrusion<=.801,'Wall dressing stays in the narrow margin beside the original walls');
 console.log(JSON.stringify({result:'PASS',relief:process.env.RELIEF_KIND||'relief',tip:process.env.TIP_KIND||'sharp',stats:dressing.stats,rockTriangles:dressing.rocks.indices.length/3,snowTriangles:dressing.snow.indices.length/3,rays,maxAttachmentErrorM:maxAttachmentError,maxPassageIntrusionM:maxPassageIntrusion,minUpperGridClearanceM:minTopClearance,baseUnchanged:true,baseDigest:before,physicsPlayerTested:false},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
