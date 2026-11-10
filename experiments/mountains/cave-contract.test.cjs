// Independent ray and seam checks of the final meshes, against the uncut terrain control.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),{createHash}=require('node:crypto');
const {buildSync}=require('esbuild'),R=require('@dimforge/rapier3d-compat');
const bundle=buildSync({stdin:{contents:"export * from './crossing'; export * from './cave';",resolveDir:__dirname,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const m=new Module(__filename);m._compile(bundle,__filename);
const{createCrossingPlan,bakeCrossing,createCavePlan,bakeCave}=m.exports;
const reports=[],failures=[];
function sectionExit(section,h,rz,rh){
 let nearest=Infinity;
 for(let i=0;i<section.length;i++){
  const a=section[i],b=section[(i+1)%section.length],sz=b.z-a.z,sh=b.y-a.y,cross=rz*sh-rh*sz;
  if(Math.abs(cross)<1e-10)continue;
  const qz=a.z,qh=a.y-h,t=(qz*sh-qh*sz)/cross,u=(qz*rh-qh*rz)/cross;
  if(t>=0&&u>=-1e-7&&u<=1+1e-7)nearest=Math.min(nearest,t);
 }
 return nearest;
}
function run(seed){
 const baked=bakeCrossing(createCrossingPlan(seed));assert.ok(baked.ok,JSON.stringify(baked));
 const source=baked.world,plan=createCavePlan(source.plan),result=bakeCave(source,plan);assert.ok(result.ok,JSON.stringify(result));
 const w=result.world,v=plan.volume,origin={x:plan.roofWitness.x,y:v.floor+v.tiltZ*v.centerZ+1.5,z:v.centerZ};
 const original=new R.World({x:0,y:0,z:0}),actual=new R.World({x:0,y:0,z:0});
 const oldTerrain=original.createCollider(R.ColliderDesc.trimesh(source.terrain.positions,source.terrain.indices));
 const terrain=actual.createCollider(R.ColliderDesc.trimesh(w.terrain.positions,w.terrain.indices));
 const interior=actual.createCollider(R.ColliderDesc.trimesh(w.cave.positions,w.cave.indices));
 actual.createCollider(R.ColliderDesc.trimesh(w.bridge.positions,w.bridge.indices));
 original.step();actual.step();
 const cast=(world,o,d,length=300)=>world.castRayAndGetNormal(new R.Ray(o,d),length,true);
 let sectionRays=0,backRays=0,roofRays=0,oldRouteRays=0,maxProtrusion=-Infinity;
 try{
  // The old carrier must obstruct the portal; its replacement must expose the
  // actual dead-end wall. This rejects an interior pasted behind an intact face.
  const portal={x:v.maxX+2,y:origin.y,z:v.centerZ},direction={x:-1,y:0,z:0};
  const oldHit=cast(original,portal,direction),newHit=cast(actual,portal,direction);
  assert.ok(oldHit&&newHit);
  assert.equal(newHit.collider.handle,interior.handle);
  assert.ok(Math.abs(portal.x-newHit.timeOfImpact-v.minX)<.003,'New portal remains occluded before the dead-end wall');
  assert.ok(portal.x-oldHit.timeOfImpact>v.minX+5,'Uncut negative control has no mountain barrier');
  for(let i=0;i<=80;i++){
   const angle=-Math.PI/2+i/80*Math.PI,dy=Math.cos(angle),dz=Math.sin(angle);
   const expected=sectionExit(v.section,1.5,dz,dy-v.tiltZ*dz),hit=cast(actual,origin,{x:0,y:dy,z:dz},40);
   assert.ok(Number.isFinite(expected)&&hit,`Missing arch/side collider at ray ${i}`);
   assert.equal(hit.collider.handle,interior.handle,'Foreign terrain still occupies the cavity');
   assert.ok(Math.abs(hit.timeOfImpact-expected)<.004,`Arch ray ${i}: ${hit.timeOfImpact} != ${expected}`);sectionRays++;
  }
  for(let i=0;i<=80;i++){
   const angle=Math.PI/2+i/80*Math.PI,dx=Math.cos(angle),dz=Math.sin(angle);
   const side=Math.abs(dz)>1e-8?5/Math.abs(dz):Infinity,back=dx < -1e-8?(v.minX-origin.x)/dx:Infinity;
   const hit=cast(actual,origin,{x:dx,y:0,z:dz},80),expected=Math.min(side,back);
   assert.ok(hit,`Leak through back/side seam at ray ${i}`);
   assert.equal(hit.collider.handle,interior.handle);
   assert.ok(Math.abs(hit.timeOfImpact-expected)<.004,`Back/side ray ${i}: ${hit.timeOfImpact} != ${expected}`);backRays++;
  }
  const exit=cast(actual,origin,{x:1,y:0,z:0},100);
  assert.ok(!exit||exit.timeOfImpact>v.maxX-origin.x,'The open mouth acquired an invisible front cap');
  for(const dx of[-8,-4,0,4,8])for(const dz of[-3,-1.5,0,1.5,3]){
   const p={x:origin.x+dx,y:200,z:origin.z+dz};
   const above=source.heightAt(p.x,p.z),ceiling=v.floor+v.tiltZ*p.z+6;
   if(above-ceiling<plan.roofWitness.minCover+1)continue;
   const a=cast(original,p,{x:0,y:-1,z:0}),b=cast(actual,p,{x:0,y:-1,z:0});
   assert.ok(a&&b);assert.equal(b.collider.handle,terrain.handle);
   assert.ok(Math.abs(a.timeOfImpact-b.timeOfImpact)<.003,'Cave subtraction breached the original mountain roof');roofRays++;
  }
  assert.ok(roofRays>=12,'Insufficient independent roof witnesses');
  for(const route of source.routes.filter(r=>r.kind==='surface'))for(let k=1;k<route.points.length;k++){
   const a=route.points[k-1],b=route.points[k],n=Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/5);
   for(let j=0;j<=n;j++){
    const t=j/n,p={x:a.x+(b.x-a.x)*t,y:200,z:a.z+(b.z-a.z)*t};
    const old=cast(original,p,{x:0,y:-1,z:0}),now=actual.castRayAndGetNormal(new R.Ray(p,{x:0,y:-1,z:0}),300,true,undefined,undefined,undefined,undefined,c=>c.handle===terrain.handle);
    assert.ok(old&&now);assert.ok(Math.abs(old.timeOfImpact-now.timeOfImpact)<.003,'Cave cut changed an existing surface route');oldRouteRays++;
   }
  }
  // Every added wall/roof triangle remains inside the original mountain, not a
  // floating tunnel shell in front of the natural flank.
  const P=w.cave.positions,I=w.cave.indices;
  for(let i=0;i<I.length;i+=3){
   const ids=[I[i],I[i+1],I[i+2]],x=ids.reduce((s,k)=>s+P[k*3],0)/3,z=ids.reduce((s,k)=>s+P[k*3+2],0)/3,y=ids.reduce((s,k)=>s+P[k*3+1],0)/3;
   const protrusion=y-source.heightAt(x,z);maxProtrusion=Math.max(maxProtrusion,protrusion);
   assert.ok(Number.isFinite(protrusion)&&protrusion<.001,'Interior triangle protrudes through the source mountain surface');
  }
  return{seed,oldPortalBarrierX:portal.x-oldHit.timeOfImpact,newFirstHitX:portal.x-newHit.timeOfImpact,sectionRays,backRays,roofRays,oldRouteRays,maxProtrusion};
 }finally{original.free();actual.free();}
}
(async()=>{
 await R.init();
 for(const seed of[3,17,113,2026,4294967295])try{reports.push(run(seed));}catch(e){failures.push({seed,message:e.message});}
 console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',testSourceSHA256:createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),bundleSHA256:createHash('sha256').update(bundle).digest('hex'),reports,failures},null,2));
 assert.equal(failures.length,0);
})().catch(e=>{console.error(e);process.exitCode=1;});
