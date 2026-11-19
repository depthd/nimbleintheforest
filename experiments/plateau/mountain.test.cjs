const fs=require('fs'),ts=require('typescript'),assert=require('assert/strict'),crypto=require('crypto');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {sampleGrid}=require('./seam-boundary.ts');
const {ascentSample}=require('./ascent.ts');
const {plateauTop,mountainEnding,mountainSnowProfile,buildMountainMasses}=require('./mountain-shape.ts');
const {reliefGrid}=require('./seam-relief-fixture.ts'),{buildWedgeAscent}=require('./wedge-ascent.ts'),{bluntTip}=require('./wedge-tip-profile.ts'),{subtract,interior}=require('./cavity.ts'),{buildMountainSnow,distanceToAscent}=require('./mountain-snow.ts');
const source=reliefGrid(plateauTop),upper={...source,heights:source.heights.map((_,k)=>plateauTop(source.x0+k%(source.n+1)*source.cell,source.z0+Math.floor(k/(source.n+1))*source.cell))},j=buildWedgeAscent(source,upper,mountainEnding,bluntTip),hash=(...arrays)=>{const h=crypto.createHash('sha256');for(const a of arrays)h.update(a);return h.digest('hex')},before=hash(source.heights,upper.heights,...Object.values(j.cut).flatMap(m=>[m.positions,m.indices]));
const surfaces=Object.fromEntries(Object.entries(j.cut).map(([name,m])=>[name,subtract(m)]));console.error('stone ready');
const snow=buildMountainSnow(upper,j,[surfaces.plateau,surfaces.strip],mountainSnowProfile);console.error('snow ready',snow.stats);
assert.equal(hash(source.heights,upper.heights,...Object.values(j.cut).flatMap(m=>[m.positions,m.indices])),before);
let reversed=0,nonfinite=0,insideBare=0,minY=Infinity;for(let k=0;k<snow.top.indices.length;k+=3){const ps=Array.from(snow.top.indices.subarray(k,k+3),i=>Array.from(snow.top.positions.subarray(i*3,i*3+3)));const [a,b,c]=ps;if((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])< -1e-6)reversed++;for(const p of ps){if(p.some(v=>!Number.isFinite(v)))nonfinite++;minY=Math.min(minY,p[1]);}if(ps.some(([x,y,z])=>{
  const ramp=ascentSample(x);
  return x>-300 && x<20 && Math.abs(z-ramp.z)<ramp.w-.05 && y>ramp.y+.05;
}))insideBare++;}assert.equal(reversed,0);assert.equal(nonfinite,0);assert.equal(insideBare,0);
const edges=new Map(),key=p=>p.map(v=>Math.round(v*1e4)).join(',');for(const m of [snow.top,snow.bottom,snow.cap])for(let k=0;k<m.indices.length;k+=3){const ps=Array.from(m.indices.subarray(k,k+3),i=>Array.from(m.positions.subarray(i*3,i*3+3)));for(let i=0;i<3;i++){const a=ps[i],b=ps[(i+1)%3];if(Math.hypot(...a.map((v,k)=>v-b[k]))<.0001)continue;const k2=[key(a),key(b)].sort().join('|');if(edges.has(k2))edges.delete(k2);else edges.set(k2,{a,b});}}
const {surfaceRoof,radialSurface}=require('./wedge-rocks.ts'),actual=surfaceRoof([surfaces.plateau,surfaces.strip]);let minTopClearance=Infinity,maxFoundationGap=0,maxFoundationEmbed=0;for(const [name,m]of [['top',snow.top],['bottom',snow.bottom]])for(let k=0;k<m.positions.length;k+=3){const h=actual(m.positions[k],m.positions[k+2]);if(h===undefined)continue;const d=m.positions[k+1]-h;if(name==='top')minTopClearance=Math.min(minTopClearance,d);else{maxFoundationGap=Math.max(maxFoundationGap,d);maxFoundationEmbed=Math.max(maxFoundationEmbed,-d);}}assert.ok(minTopClearance>=-.0001);assert.ok(maxFoundationGap<.0001&&maxFoundationEmbed<.0201);
const THREE=require('three'),objects=[];const add=m=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(m.positions,3));g.setIndex(new THREE.BufferAttribute(m.indices,1));const o=new THREE.Mesh(g,new THREE.MeshBasicMaterial());o.updateMatrixWorld();objects.push(o)};Object.values(surfaces).forEach(add);[snow.top,snow.bottom,snow.cap].forEach(add);
const rawP=new Float32Array(source.heights.length*3),rawI=[];for(let k=0;k<source.heights.length;k++)rawP.set([source.x0+k%(source.n+1)*source.cell,source.heights[k],source.z0+Math.floor(k/(source.n+1))*source.cell],k*3);for(let z=0;z<source.n;z++)for(let x=0;x<source.n;x++){const a=z*(source.n+1)+x;rawI.push(a,a+source.n+1,a+1,a+1,a+source.n+1,a+source.n+2)}const cave=interior({positions:rawP,indices:new Uint32Array(rawI)});add(cave);
const rim=require('./mountain-snow.ts').mountainRim(j);
const {ringPoint}=require('./wedge-snow-layer.ts');
const rimAt=a=>ringPoint(rim,a),wallAt=radialSurface([surfaces.underside]),groundAt=(x,z)=>sampleGrid(source,x,z).y;
const dressing=buildMountainMasses(rimAt,wallAt,groundAt);
const deeper=buildMountainMasses(rimAt,(a,y)=>{
  const p=wallAt(a,y);return p&&{x:p.x*.99,z:p.z*.99};
},groundAt);
assert.deepEqual(dressing.rocks.indices,deeper.rocks.indices);
let maskControlledVertices=0;
for(let k=0;k<dressing.rocks.positions.length;k+=3){
  if(Math.hypot(dressing.rocks.positions[k]-deeper.rocks.positions[k],dressing.rocks.positions[k+2]-deeper.rocks.positions[k+2])>.1)maskControlledVertices++;
}
assert.ok(maskControlledVertices>10,'Recessed panels must follow a change below the crest');
const bankRolls=[];
for(const x of [-175,-130,-85])for(const side of [-1,1]){
  let high=-Infinity,low=Infinity;
  for(let i=0;i<snow.cap.positions.length;i+=3){
    const [px,y,z]=snow.cap.positions.subarray(i,i+3);
    if(Math.abs(px-x)>2)continue;
    const bank=ascentSample(px),edge=bank.z+side*bank.w;
    if(Math.abs(z-edge)>2.6)continue;
    const local=y-sampleGrid(upper,px,edge).y;
    high=Math.max(high,local);low=Math.min(low,local);
  }
  assert.ok(high>1 && low<-.08,'Snow must roll above and below both cut banks at '+x+','+side);
  bankRolls.push({x,side,high,low});
}
const {plateauRadius}=require('./plateau-profile.ts');
const bed=surfaceRoof([dressing.rocks]);
let crownSamples=0,maxSummitLift=0,minSummitLift=Infinity;
for(let i=0;i<dressing.snow.positions.length;i+=3){
  const [x,y,z]=dressing.snow.positions.subarray(i,i+3);
  if(plateauRadius(x,z)>.87||distanceToAscent({x,z})<15||y<plateauTop(x,z)-1)continue;
  const stone=bed(x,z);
  if(stone===undefined)continue;
  const gap=y-stone;
  maxSummitLift=Math.max(gap,maxSummitLift);minSummitLift=Math.min(gap,minSummitLift);crownSamples++;
}
assert.ok(crownSamples>100 && maxSummitLift<2.5 && minSummitLift<-.01,'Crown depth/contact: '+[crownSamples,minSummitLift,maxSummitLift]);
add(dressing.rocks);add(dressing.snow);
for(const mesh of [dressing.rocks,dressing.snow]){
  assert.ok(mesh.positions.every(Number.isFinite));
  assert.ok(mesh.indices.every(i=>i<mesh.positions.length/3));
}
const cast=(origin,direction,far=100)=>{const r=new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction),0,far);return r.intersectObjects(objects)[0]?.distance??null};
const caveRays={exit:cast([279,6.8,0],[1,0,0]),back:cast([279,6.8,0],[-1,0,0]),floor:cast([279,6.8,0],[0,-1,0]),roof:cast([279,6.8,0],[0,1,0])};assert.equal(caveRays.exit,null);assert.ok(Math.abs(caveRays.back-9)<.001);assert.ok(Math.abs(caveRays.floor-1.8)<.001);assert.ok(Math.abs(caveRays.roof-3.7)<.001);
const {ascentCenter,ascentHeight}=require('./ascent.ts'),ap=[-180,ascentHeight(-180)+1,ascentCenter(-180)],ascentRays={sky:cast(ap,[0,1,0],200),floor:cast(ap,[0,-1,0])};assert.equal(ascentRays.sky,null);assert.ok(Math.abs(ascentRays.floor-1)<.001);
for(let x=-245;x<=5;x+=10){
  for(const offset of [-9,0,9]){
    const origin=[x,ascentHeight(x)+1.8,ascentCenter(x)+offset];
    assert.equal(cast(origin,[0,1,0],160),null,'overhead obstruction at '+origin);
    assert.ok(Math.abs(cast(origin,[0,-1,0],3)-1.8)<.02,'route floor at '+origin);
  }
}
console.log(JSON.stringify({result:reversed||nonfinite||insideBare||edges.size?'FAIL':'PASS',stoneBefore:before,stoneUnchanged:true,snowStats:snow.stats,contact:{minTopClearance,maxFoundationGap,maxFoundationEmbed,bankRolls,crownSamples,maxSummitLift,minSummitLift},maskControlledVertices,caveRays,ascentRays,snowSettings:snow.settings,roofReversedTriangles:reversed,nonfiniteVertices:nonfinite,roofTrianglesInsideOpenPassage:insideBare,unpairedEdges:edges.size,edgeExamples:[...edges.values()].slice(0,20),minSnowY:minY,caveCuts:Object.fromEntries(Object.entries(surfaces).map(([k,m])=>[k,m.cutTriangles]))},null,2));if(edges.size)process.exitCode=1;
