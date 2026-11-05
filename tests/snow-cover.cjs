// Shared author-defined shelter boundaries and continuous shore coverage.
const assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const {buildSync}=require('esbuild');
const bundle=file=>{const m=new Module(__filename,module);m.paths=module.paths;m._compile(buildSync({entryPoints:[path.join(__dirname,'../src/world',file)],bundle:true,platform:'node',format:'cjs',write:false,external:['three']}).outputFiles[0].text,__filename);return m.exports};
const {SnowCover,snowCoverUniforms}=bundle('snow-cover.ts'),{WorldSnowTerrain}=bundle('snow-terrain.ts');
let checks=0;const test=(name,f)=>{f();checks++;console.log('PASS',name)};
const bounds={minX:-100,minZ:-100,maxX:100,maxZ:100};
test('a roof protects bare ground as well as a floor, including rotated and negative-coordinate buildings',()=>{
 const c=new SnowCover(bounds),yaw=.73,x=-17.2,z=15.8;
 c.add({name:'навес',kind:'roof',x,z,hx:2,hz:1.5,yaw,y:3});
 const at=(u,v)=>[x+u*Math.cos(yaw)+v*Math.sin(yaw),z-u*Math.sin(yaw)+v*Math.cos(yaw)];
 for(const [u,v]of[[0,0],[1.99,1.49],[-1.99,-1.49]]){const [px,pz]=at(u,v);assert.equal(c.looseAt(px,pz,0),0);assert.ok(c.roofAt(px,pz,1.7));assert.equal(c.floorAt(px,pz,0),false)}
 const p=at(2.6,0);assert.ok(Math.abs(c.looseAt(...p,0)-.5)<1e-12);
 assert.equal(c.looseAt(...at(3.3,0),0),1);assert.equal(c.roofAt(x,z,4),false);
});
test('floors mask ground only at their elevation; the ground beneath a high tower is retained',()=>{
 const c=new SnowCover(bounds);c.add({name:'пол',kind:'floor',x:0,z:0,hx:2,hz:2,y:10});
 assert.equal(c.floorAt(0,0,0),false);assert.equal(c.floorAt(0,0,10.02),true);assert.equal(c.looseAt(0,0,10),0);assert.equal(c.floorAt(2.01,0,10),false);
});
test('overlapping roofs combine without seams; GPU bins include rotated overhangs and floors',()=>{
 const c=new SnowCover(bounds);
 c.add({name:'крыша',kind:'roof',x:15.9,z:-16.1,hx:3,hz:2,yaw:.4,y:4});
 c.add({name:'крыльцо',kind:'roof',x:18,z:-16,hx:2,hz:2,y:3});
 c.add({name:'пол',kind:'floor',x:15.9,z:-16.1,hx:2,hz:1,yaw:.4,y:.2});c.upload();
 const u=snowCoverUniforms,bin=u.uSnowCoverBins.value.image,grid=u.uSnowCoverGrid.value,idTex=u.uSnowCoverIds.value.image;
 for(let x=12;x<22;x+=.2)for(let z=-20;z<-12;z+=.2){
  const expected=c.looseAt(x,z,0),ix=Math.floor(x/16)-grid.x,iz=Math.floor(z/16)-grid.y,k=(iz*bin.width+ix)*4;
  const ids=[];for(let i=0;i<bin.data[k+1];i++)ids.push(idTex.data[(bin.data[k]+i)*4]);
  if(expected<1)assert.ok(ids.length>0,`${x},${z}`);
 }
 assert.ok(c.detailedAt(15,-17,2));assert.equal(c.detailedAt(-80,-80,2),false);
});
const region=()=>{const n=16,size=32,h=new Float32Array((n+1)**2),water=new Float32Array(h.length).fill(NaN);for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){const x=i*2-16;h[j*(n+1)+i]=x*.2;if(x<=0)water[j*(n+1)+i]=0}return{n,size,ox:16,oz:16,h,water}};
test('snow thins continuously into the actual drawn water surface, without nearest-cell steps',()=>{
 const t=new WorldSnowTerrain(region(),()=>1);let previous=t.retentionAt(-2,0),largest=0;
 for(let x=-1.99;x<8;x+=.01){const h=t.retentionAt(x,0);largest=Math.max(largest,Math.abs(h-previous));assert.ok(h>=previous-1e-6);previous=h}
 assert.ok(largest<.009,largest);assert.equal(t.retentionAt(-2,0),0);assert.ok(t.retentionAt(8,0)>.99);
 assert.ok(Math.abs(t.waterLevelAt(.5,0)-.03)<1e-7);
});
test('roof shelter removes only the loose layer and leaves immutable terrain/colliders unchanged',()=>{
 const r=region(),c=new SnowCover(bounds);c.add({name:'навес',kind:'roof',x:7,z:0,hx:1,hz:2,y:5});
 const bare=new WorldSnowTerrain(r,()=>1),covered=new WorldSnowTerrain(r,(x,z)=>c.looseAt(x,z,bare.heightAt(x,z)));
 assert.equal(covered.retentionAt(7,0),0);assert.equal(covered.heightAt(7,0),bare.heightAt(7,0));assert.ok(covered.substrateAt(7,0)>.99);
 assert.ok(covered.retentionAt(8.6,0)>0&&covered.retentionAt(8.6,0)<bare.retentionAt(8.6,0));
});
console.log(`${checks} snow cover checks passed`);
