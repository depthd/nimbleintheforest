const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),crypto=require('node:crypto');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {buildWedgeAscent}=require('./wedge-ascent.ts'),{buildWedgeRocks,surfaceRoof}=require('./wedge-rocks.ts'),{bluntTip}=require('./wedge-tip-profile.ts'),{buildSnowLayer,snowSettings,snowThickness}=require('./wedge-snow-layer.ts'),{reliefGrid,chaoticTop}=require('./seam-relief-fixture.ts');
const hash=(...arrays)=>{const h=crypto.createHash('sha256');for(const a of arrays)h.update(a);return h.digest('hex')},mh=m=>hash(m.positions,m.indices);
const source=reliefGrid(chaoticTop),upper={...source,heights:source.heights.map((_,k)=>chaoticTop(source.x0+k%(source.n+1)*source.cell,source.z0+Math.floor(k/(source.n+1))*source.cell))},j=buildWedgeAscent(source,upper,undefined,bluntTip),before=hash(source.heights,upper.heights,...Object.values(j.cut).flatMap(m=>[m.positions,m.indices]));
const dressing=buildWedgeRocks(j.cut,source,upper),pillowsHash=mh(dressing.snow);
const vkey=p=>p.map(v=>Math.round(v*1e4)).join(','),pointKey=p=>[p.x,p.y,p.z].join(',');
function closure(meshes,strict=true){const edges=new Map();for(const m of meshes)for(let k=0;k<m.indices.length;k+=3){const tri=Array.from(m.indices.subarray(k,k+3),id=>Array.from(m.positions.subarray(id*3,id*3+3)));for(let i=0;i<3;i++){const a=tri[i],b=tri[(i+1)%3];if(Math.hypot(...a.map((v,i)=>v-b[i]))<.0001)continue;const key=[vkey(a),vkey(b)].sort().join('|');if(edges.has(key))edges.delete(key);else edges.set(key,{a,b});}}
 const open=[...edges.values()];let max=0;for(const e of open){const d=e.b.map((v,i)=>v-e.a[i]),length=Math.hypot(...d);if(length<=.0005)continue;const u=d.map(v=>v/length),ranges=[];for(const q of open){if(q===e)continue;const a=q.a.map((v,i)=>v-e.a[i]),b=q.b.map((v,i)=>v-e.a[i]),ta=a.reduce((s,v,i)=>s+v*u[i],0),tb=b.reduce((s,v,i)=>s+v*u[i],0),lo=Math.max(0,Math.min(ta,tb)),hi=Math.min(length,Math.max(ta,tb));if(hi<=lo||Math.abs(tb-ta)<1e-12)continue;const dist=t=>{const k=(t-ta)/(tb-ta);return Math.hypot(...a.map((v,i)=>v+k*(b[i]-v)-t*u[i]));};if(dist(lo)<.0005&&dist(hi)<.0005)ranges.push([lo,hi]);}ranges.sort((a,b)=>a[0]-b[0]);let covered=0;for(const [lo,hi]of ranges){if(lo>covered+.0005)max=Math.max(max,lo-covered);covered=Math.max(covered,hi);}max=Math.max(max,length-covered);}if(strict)assert.ok(max<=.0005,'Snow shell has an uncovered edge '+max);return {unpairedEdgesBeforeCollinearCoverage:open.length,maxUncoveredM:max,toleranceM:.0005};}
const angle=(a,b)=>Math.acos(Math.max(-1,Math.min(1,a.reduce((s,v,i)=>s+v*b[i],0)/(Math.hypot(...a)*Math.hypot(...b)))))*180/Math.PI;
function seamMetrics(snow){const keys=new Set(snow.columns.map(c=>pointKey(c[snow.seamRow].p))),maps=[snow.inner,snow.outer].map(m=>{const out=new Map();for(const id of m.indices){const p=Array.from(m.positions.subarray(id*3,id*3+3)),key=p.join(',');if(keys.has(key))out.set(key,{p,n:Array.from(m.normals.subarray(id*3,id*3+3))});}return out;});let gap=0,nangle=0;for(const key of keys){const a=maps[0].get(key),b=maps[1].get(key);assert.ok(a&&b,'Both snow owners use the shared E vertex');gap=Math.max(gap,Math.hypot(...a.p.map((v,i)=>v-b.p[i])));nangle=Math.max(nangle,angle(a.n,b.n));}return {vertices:keys.size,maxHeightOrPositionGapM:gap,maxFormulaNormalAngleDeg:nangle,note:'Canonical vertex normals. Flat-shaded B/E still use per-face shader normals; their ordinary facet changes are not called a smooth seam.'};}
const toy=(p)=>({positions:new Float32Array(p),indices:new Uint32Array([0,1,2])});
assert.ok(surfaceCrossings([toy([0,0,0,2,0,0,0,0,2])],toy([.5,-1,.5,.5,1,.5,1,0,.5])).crossingTrianglePairs>0);
assert.equal(surfaceCrossings([toy([0,0,0,2,0,0,0,0,2])],toy([.5,3,.5,.5,4,.5,1,3,.5])).crossingTrianglePairs,0);
if(process.env.SNOW_PROBE)runProbe(process.env.SNOW_PROBE);else {
const built=[],reports=[];
for(const rounded of [false,true]){
 const snow=buildSnowLayer(upper,j.accepted.seam,j.accepted.nose,rounded);built.push(snow);
 assert.ok(snow.angles.every(a=>j.weight(a)===1),'The patch stays outside the passage transition');
 assert.ok(snow.stats.maxAlongM<=.5&&snow.stats.maxAcrossM<=.5&&snow.stats.maxCapM<=.5);
 assert.equal(snow.stats.bareVertices,0,'The chosen diagnostic patch must not introduce changing coverage holes');
 let down=0;for(const m of [snow.inner,snow.outer])for(let k=0;k<m.indices.length;k+=3){const [a,b,c]=Array.from(m.indices.subarray(k,k+3),id=>Array.from(m.positions.subarray(id*3,id*3+3))),ny=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);if(ny< -1e-6)down++;}
 assert.equal(down,0,'Snow top must remain an unfolded upper surface');
 let overhangError=0,edgeThicknessError=0;for(let i=0;i<snow.angles.length;i++){const a=snow.angles[i],p=snow.edge(a),n=snow.planNormal(a),profile=snow.profiles[i].points;const extent=Math.max(...profile.map(q=>(q.x-p.x)*n.x+(q.z-p.z)*n.z));overhangError=Math.max(overhangError,Math.abs(extent-2));edgeThicknessError=Math.max(edgeThicknessError,Math.abs(profile[0].y-p.y-2.5));}
 assert.ok(overhangError<.0001&&edgeThicknessError<.0001);
 const bottom=surfaceRoof([snow.bottom,snow.capBottom]);let minClearance=Infinity,intersections=0,tested=0;
 for(let k=0;k<dressing.snow.indices.length;k+=3){const tri=Array.from(dressing.snow.indices.subarray(k,k+3),id=>({x:dressing.snow.positions[id*3],y:dressing.snow.positions[id*3+1],z:dressing.snow.positions[id*3+2]})),clearance=bottom.triangleClearance(tri);if(Number.isFinite(clearance)){tested++;minClearance=Math.min(minClearance,clearance);if(clearance<-.0005)intersections++;}}
 assert.equal(intersections,0,'New cornice must not cut existing ledge snow');
 const seam=seamMetrics(snow);assert.equal(seam.maxHeightOrPositionGapM,0);assert.ok(seam.maxFormulaNormalAngleDeg<.00001);
 reports.push({rounded,stats:snow.stats,overhangErrorM:overhangError,edgeThicknessErrorM:edgeThicknessError,seam,closure:closure([snow.inner,snow.outer,snow.bottom,snow.cap,snow.closures]),pillows:{testedOverlaps:tested,minFiniteClearanceM:Number.isFinite(minClearance)?minClearance:null,intersectingTriangles:intersections,unchanged:mh(dressing.snow)===pillowsHash}});
}
assert.equal(mh(built[0].inner),mh(built[1].inner));assert.equal(mh(built[0].outer),mh(built[1].outer));assert.equal(mh(built[0].bottom),mh(built[1].bottom));
assert.equal(hash(source.heights,upper.heights,...Object.values(j.cut).flatMap(m=>[m.positions,m.indices])),before);
for(const y of [-1,0,Math.cos(61*Math.PI/180)])assert.equal(snowThickness(1,{x:Math.sqrt(1-y*y),y,z:0}),0);
const oldText=require('node:child_process').execFileSync('git',['show','9462b0b498b89ec0932f536140378b6c821cc6aa:experiments/plateau/wedge-snow-layer.ts'],{encoding:'utf8'}),Module=require('node:module'),legacy=new Module(__filename,module);legacy.filename=require('node:path').join(__dirname,'wedge-snow-layer.ts');legacy.paths=module.paths;legacy._compile(ts.transpileModule(oldText,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,legacy.filename);
const oldF=legacy.exports.buildSnowLayer(upper,j.accepted.seam,j.accepted.nose,true);for(const key of ['inner','outer','bottom','cap','closures'])assert.equal(hash(built[1][key].positions,built[1][key].normals,built[1][key].indices),hash(oldF[key].positions,oldF[key].normals,oldF[key].indices),'Original F buffers must remain identical: '+key);
console.log(JSON.stringify({result:'PASS',originalFArraysIdenticalTo9462b0b:true,settings:snowSettings,baseDigest:before,baseUnchanged:true,pillowsDigest:pillowsHash,BandEUpperAndBottomIdentical:true,reports},null,2));

}

function runProbe(mode){
 const {buildRimVariant}=require('./wedge-rim.ts'),{snowEdgeBoundary,ringPoint}=require('./wedge-snow-layer.ts');
 const reference=buildSnowLayer(upper,j.accepted.seam,j.accepted.nose,false),rim=mode==='passage'?undefined:buildRimVariant(j,mode),cut=rim?rim.cut:j.cut;
 const stoneHash=hash(...Object.values(cut).flatMap(m=>[m.positions,m.indices]));
 const roof=rim?surfaceRoof([cut.plateau,cut.strip]):undefined,d=buildWedgeRocks(cut,source,upper,roof),dressingHash=hash(d.rocks.positions,d.rocks.indices,d.snow.positions,d.snow.indices);
 const settings=mode==='passage'?{...snowSettings,centerAngle:2.8}:snowSettings;
 const swept={...j.accepted.nose,points:j.nose,angles:j.nose.map(p=>(Math.atan2(p.z/180,p.x/260)+2*Math.PI)%(2*Math.PI))};
 const nose=rim?snowEdgeBoundary(swept,rim.deform,rim.knots.slice(0,-1).map(k=>k.p),rim.cut.strip):snowEdgeBoundary(swept);
 const s=buildSnowLayer(upper,j.accepted.seam,nose,true,settings,{angleLimits:rim?[reference.angles[0],reference.angles.at(-1)]:undefined,recordSamplingFailure:true});
 let reversed=0;for(const m of [s.inner,s.outer])for(let k=0;k<m.indices.length;k+=3){const [a,b,c]=Array.from(m.indices.subarray(k,k+3),id=>Array.from(m.positions.subarray(id*3,id*3+3)));if((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])< -1e-6)reversed++;}
 let edgeGap=0,edgeExcess=0,outError=0;const spots=[];
 for(const a of s.angles){const n=s.edge(a),p=s.base(a,1),t=s.top(a,1).p,gap=p.y-n.y,excess=t.y-n.y-settings.edge;
  edgeGap=Math.max(edgeGap,Math.abs(gap));edgeExcess=Math.max(edgeExcess,Math.abs(excess));
  if(Math.abs(gap)>.1&&spots.length<8)spots.push({angle:a,stoneEdge:n,snowBaseY:p.y,gapM:gap});
  const direction=s.planNormal(a),extent=Math.max(...s.profiles[s.angles.indexOf(a)].points.map(q=>(q.x-n.x)*direction.x+(q.z-n.z)*direction.z));outError=Math.max(outError,Math.abs(extent-settings.overhang));
 }
 const noseDistance=edgeSurfaceDistance(s,cut.strip);assert.ok(noseDistance<.0005,'Adapter must read the actual rendered rim, not an approximate decorative line');
 const seam=seamMetrics(s),closed=closure([s.inner,s.outer,s.bottom,s.cap,s.closures],false);
 const collisions={};for(const [name,m]of [['rocks',d.rocks],['pillows',d.snow]]){
  const underside=surfaceRoof([s.bottom,s.capBottom]);let candidates=0,min=Infinity,negative=0;
  for(let k=0;k<m.indices.length;k+=3){const tri=Array.from(m.indices.subarray(k,k+3),id=>({x:m.positions[id*3],y:m.positions[id*3+1],z:m.positions[id*3+2]})),c=underside.triangleClearance(tri);if(Number.isFinite(c)){candidates++;min=Math.min(min,c);if(c<-.0005)negative++;}}
  collisions[name]={surfaceIntersections:surfaceCrossings([s.inner,s.outer,s.bottom,s.cap,s.closures],m),projectedOverlaps:candidates,minSignedClearanceM:Number.isFinite(min)?min:null,trianglesAboveUnderside:negative,note:'Signed full projected overlap against bottom/cap-bottom; negative is a conflict candidate, not a 3D Boolean volume count.'};
 }
 assert.equal(hash(...Object.values(cut).flatMap(m=>[m.positions,m.indices])),stoneHash);assert.equal(hash(d.rocks.positions,d.rocks.indices,d.snow.positions,d.snow.indices),dressingHash);
 assert.equal(hash(source.heights,upper.heights,...Object.values(j.cut).flatMap(m=>[m.positions,m.indices])),before);
 assert.equal(seam.maxHeightOrPositionGapM,0);assert.ok(s.stats.maxAlongM<=.5&&s.stats.maxAcrossM<=.5&&s.stats.maxCapM<=.5,'Required sampling resolution');
 const volumes=require('./ascent.ts').ascentCutVolumes();const insideExcavation=s.columns.flat().filter(q=>volumes.some(v=>v.every(pl=>pl.x*q.p.x+pl.y*q.p.y+pl.z*q.p.z+pl.d<-.001))).length;
 console.log(JSON.stringify({mode,compatibility:closed.maxUncoveredM>.0005||reversed>0||edgeGap>.001?'FAIL':'PASS',snowTopVerticesInsideExcavation:insideExcavation,execution:'PASS: probe built; conflicts are recorded, not repaired',settings,stoneHash,dressingHash,stoneAndDressingUnchanged:true,seam,stats:s.stats,noseMaxDistanceToRenderedTopM:noseDistance,reversedTopTriangles:reversed,closure:closed,maxSnowBaseToStoneEdgeGapM:edgeGap,maxActualEdgeThicknessDeviationM:edgeExcess,maxOverhangDeviationM:outError,conflictExamples:spots,collisions,passageWeightRange:[Math.min(...s.angles.map(a=>j.weight(a))),Math.max(...s.angles.map(a=>j.weight(a)))]},null,2));
}
// Independent 3D triangle SAT. Records surface crossings, not a volume Boolean.
function surfaceCrossings(meshes,other){
 const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 function tri(m,k){const p=Array.from(m.indices.subarray(k,k+3),id=>Array.from(m.positions.subarray(id*3,id*3+3))),e=p.map((v,i)=>sub(p[(i+1)%3],v));return {p,e,n:cross(e[0],e[1]),lo:[0,1,2].map(i=>Math.min(...p.map(v=>v[i]))),hi:[0,1,2].map(i=>Math.max(...p.map(v=>v[i])))};}
 function hit(a,b){if(a.lo.some((v,i)=>v>b.hi[i]+1e-5||a.hi[i]<b.lo[i]-1e-5))return false;const axes=[a.n,b.n,...a.e.flatMap(e=>b.e.map(f=>cross(e,f))),...a.e.map(e=>cross(a.n,e)),...b.e.map(e=>cross(b.n,e))];for(const axis of axes){const len=Math.hypot(...axis);if(len<1e-12)continue;const pa=a.p.map(p=>dot(p,axis)/len),pb=b.p.map(p=>dot(p,axis)/len);if(Math.max(...pa)<Math.min(...pb)-1e-5||Math.max(...pb)<Math.min(...pa)-1e-5)return false;}return true;}
 const bins=new Map(),cell=4;let id=0;
 function keys(t,fn){for(let x=Math.floor(t.lo[0]/cell);x<=Math.floor(t.hi[0]/cell);x++)for(let y=Math.floor(t.lo[1]/cell);y<=Math.floor(t.hi[1]/cell);y++)for(let z=Math.floor(t.lo[2]/cell);z<=Math.floor(t.hi[2]/cell);z++)fn(x+','+y+','+z);}
 for(const m of meshes)for(let k=0;k<m.indices.length;k+=3){const t=tri(m,k);t.id=id++;keys(t,key=>{if(!bins.has(key))bins.set(key,[]);bins.get(key).push(t)});}
 let pairs=0,triangles=0,candidates=0;const examples=[];
 for(let k=0;k<other.indices.length;k+=3){const t=tri(other,k),seen=new Set();let crossed=false;keys(t,key=>{for(const q of bins.get(key)||[]){if(seen.has(q.id))continue;seen.add(q.id);if(t.lo.some((v,i)=>v>q.hi[i]+1e-5||t.hi[i]<q.lo[i]-1e-5))continue;candidates++;if(hit(t,q)){pairs++;crossed=true;if(examples.length<3)examples.push({dressingTriangle:k/3,points:t.p})}}});if(crossed)triangles++;}
 return {crossingTrianglePairs:pairs,dressingTrianglesCrossing:triangles,broadphasePairs:candidates,examples,toleranceM:1e-5};
}
function edgeSurfaceDistance(snow,mesh){
 const THREE=require('three'),bins=new Map(),cell=4;
 for(let k=0;k<mesh.indices.length;k+=3){const p=Array.from(mesh.indices.subarray(k,k+3),id=>new THREE.Vector3(...mesh.positions.subarray(id*3,id*3+3))),tri=new THREE.Triangle(...p);for(let x=Math.floor(Math.min(...p.map(v=>v.x))/cell);x<=Math.floor(Math.max(...p.map(v=>v.x))/cell);x++)for(let z=Math.floor(Math.min(...p.map(v=>v.z))/cell);z<=Math.floor(Math.max(...p.map(v=>v.z))/cell);z++){const key=x+','+z;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(tri)}}
 let max=0;const out=new THREE.Vector3();for(const a of snow.angles){const q=snow.edge(a),p=new THREE.Vector3(q.x,q.y,q.z);let d=Infinity;for(let x=Math.floor(p.x/cell)-1;x<=Math.floor(p.x/cell)+1;x++)for(let z=Math.floor(p.z/cell)-1;z<=Math.floor(p.z/cell)+1;z++)for(const tri of bins.get(x+','+z)||[])d=Math.min(d,tri.closestPointToPoint(p,out).distanceTo(p));max=Math.max(max,d);}return max;
}
