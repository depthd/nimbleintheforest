const assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module'),THREE=require('three');
const {buildSync}=require('esbuild'),m=new Module(__filename);
m._compile(buildSync({entryPoints:[path.join(__dirname,'../src/world/snow-field.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['three']}).outputFiles[0].text,__filename);
const {SnowField,BOOT_SHAPE}=m.exports,make=()=>new SnowField({thickness:.28,densityRatio:2.6});
const pose=(x=0,z=0)=>({position:new THREE.Vector3(x,.12,z),rotation:new THREE.Quaternion()});
const press=(f,x=0)=>f.sweepBoot(pose(x),pose(x));const storm={snow:1,wind:15};let count=0;
function test(name,f){f();count++;console.log('PASS',name)}
test('calm weather has no expiry timer; distance does not age a track',()=>{const f=make();press(f);const s=f.sample(0,0);f.advanceWeather(86400,{snow:0,wind:2});assert.deepEqual(f.sample(0,0),s)});
test('weather fills continuously and freshens the surface before relief is lost',()=>{
 const f=make();press(f);let h=f.sample(0,0).height,maxJump=0;
 for(let i=0;i<2400;i++){f.advanceWeather(1,storm);const next=f.sample(0,0);maxJump=Math.max(maxJump,next.height-h);assert.ok(next.height>=h-1e-9);h=next.height}
 assert.ok(maxJump<.0003);assert.equal(h,.28);assert.equal(f.sample(0,0).surfaceCompaction,0);
});
test('snowstorm erases tracks faster than light snow; old and recent tracks differ',()=>{
 const a=make(),b=make();press(a);press(b);a.advanceWeather(300,storm);b.advanceWeather(300,{snow:.2,wind:2});assert.ok(a.sample(0,0).height>b.sample(0,0).height);
 press(a,1);assert.ok(a.sample(0,0).height>a.sample(1,0).height);a.advanceWeather(600,storm);assert.ok(a.sample(0,0).height>a.sample(1,0).height);
});
test('archived offscreen tracks have exactly the same weather history',()=>{
 const a=make(),b=make();press(a);press(b);for(let i=1;i<45;i++)press(b,i*4);
 for(let i=0;i<900;i++){a.advanceWeather(1,storm);a.sample(0,0)}b.advanceWeather(900,storm);
 for(const k of ['height','mass','compaction','surfaceCompaction'])assert.ok(Math.abs(a.sample(0,0)[k]-b.sample(0,0)[k])<1e-12);
 assert.ok(b.stats().hotTiles<=32);
});
test('fully covered storage can be reclaimed only after the last visible relief is gone',()=>{
 const f=make();press(f);assert.equal(f.forgetWeatheredTile(0,0),false);f.advanceWeather(7200,storm);assert.equal(f.forgetWeatheredTile(0,0),true);assert.equal(f.sample(0,0).height,.28);
});
test('the shared swept contact supports paw-sized shapes and records weather losslessly',()=>{
 const f=make();f.advanceWeather(600,storm);const shape={...BOOT_SHAPE,halfWidth:.045,front:.065,back:.045,rounding:.02,shoulder:.025};
 f.sweepContact(pose(),pose(.35),shape);assert.ok(f.sample(.2,0).height<.2);assert.equal(f.sample(.2,.14).height,.28);
 const copy=make();for(const c of f.recordedCells())copy.applyRecordedCell(...c);copy.weatherExposure=f.weatherExposure;
 f.advanceWeather(300,storm);copy.advanceWeather(300,storm);assert.deepEqual(copy.sample(.2,0),f.sample(.2,0));
});
const rendererModule=new Module(__filename);
rendererModule._compile(buildSync({entryPoints:[path.join(__dirname,'../src/world/snow-trails.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['three']}).outputFiles[0].text,__filename);
test('incremental trail updates equal complete reconstruction; fresh tracks return after burial',()=>{
 const f=make(),r=new rendererModule.exports.SnowTrailRenderer(f,{minX:-10,minZ:-10,maxX:10,maxZ:10}),eye=new THREE.Vector3();
 press(f);r.update(eye);f.sweepBoot(pose(.12,.2),pose(.12,.4));r.update(eye);
 assert.ok(r.updatedVertices<5000);
 const before=[...r.entries.values()].map(e=>({e,pixels:e.pixels.slice()}));r.refreshAll();
 before.forEach(({e,pixels})=>assert.deepEqual(e.pixels,pixels));
 f.advanceWeather(7200,storm);for(let i=0;i<20;i++)r.update(eye);assert.equal(r.entries.size,0);
 press(f);r.update(eye);assert.ok(r.entries.size>0);
});
test('a long trail reduces distant geometry without losing material or its textures',()=>{
 const f=make(),r=new rendererModule.exports.SnowTrailRenderer(f,{minX:-100,minZ:-100,maxX:100,maxZ:100}),eye=new THREE.Vector3();
 for(let x=0;x<48;x+=.48)press(f,x);
 r.update(eye);
 const entries=[...r.entries.values()],fullDetail=entries.length*25921;
 assert.ok(r.stats().vertices<fullDetail*.4,'distant history must not use the close boot mesh');
 const original=entries.map(e=>({e,texture:e.texture,pixels:e.pixels.slice()})),cells=f.recordedCells();
 // The viewer is directly over the first print: retain its original detail.
 assert.equal(r.entries.get('0,0').mesh.geometry.attributes.position.count,25921);
 for(const x of [8,12,18,22,48,80,0])r.update(new THREE.Vector3(x,0,0));
 assert.equal(r.entries.size,entries.length);assert.deepEqual(f.recordedCells(),cells);
 for(const {e,texture,pixels} of original){assert.equal(e.texture,texture);assert.deepEqual(e.pixels,pixels)}
});
console.log(`${count} trail lifetime checks passed`);
