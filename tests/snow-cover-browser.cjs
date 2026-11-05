const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {chromium}=require('playwright');
const ROOT=path.join(__dirname,'..'),OUT=process.argv[2]||path.join(ROOT,'test-results/snow-cover');fs.mkdirSync(OUT,{recursive:true});
const checks=[];function check(name,ok,data){assert.ok(ok,name+': '+JSON.stringify(data));checks.push(name);console.log('PASS',name,JSON.stringify(data??''))}
(async()=>{const {createServer}=await import(ROOT+'/node_modules/vite/dist/node/index.js');const server=await createServer({root:ROOT,server:{host:'127.0.0.1',port:5222,strictPort:true,hmr:false},logLevel:'error'});let browser;
const stop=async()=>{await browser?.close();await server.close();process.exit(130)};process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
 await server.listen();browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:960,height:640}}),errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message)});page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico')){errors.push(m.text());console.log('ERROR',m.text().slice(0,3000))}});
 await page.goto('http://127.0.0.1:5222/?test=1&seed=42&hour=13&weather=clear&scale=0&nocold=1');
 await page.waitForFunction(()=>window.__game?.G.snow,null,{timeout:180000});
 const initial=await page.evaluate(()=>{
  const g=window.__game,{G,THREE:T}=g;g.setManualStepping(true);G.input.enabled=true;g.steps(90);
  const camera=new T.PerspectiveCamera(65,innerWidth/innerHeight,.1,10000);G.player.avatar.inspectionView=1;
  const render=G.player.avatar.render.bind(G.player.avatar);G.player.avatar.render=(a,dt)=>{render(a,dt);G.player.avatar.inspectionCamera.copy(camera)};
  window.__view=(eye,target)=>{camera.position.fromArray(eye);camera.lookAt(new T.Vector3().fromArray(target));camera.updateProjectionMatrix();G.snow.renderer.update(camera.position)};
  window.__coverStats=()=>{const slots=G.terrain.slots;return{zones:G.snowCover.zones.length,geometries:slots.reduce((n,s)=>n+s.geos.filter(Boolean).length,0),vertices:slots.reduce((n,s)=>n+(s.mesh?.geometry.attributes.position.count||0),0),field:G.snow.field.stats()}};
  return window.__coverStats();
 });console.log('READY',JSON.stringify(initial));
 const gpu=await page.evaluate(async()=>{
  const {G,THREE:T}=window.__game,{snowCoverShader,snowCoverUniforms}=await import('/src/world/snow-cover.ts');
  const probes=[];
  for(const q of G.snowCover.zones)for(const local of [[0,0],[q.hx+.3,0],[q.hx+1.3,0],[q.hx-.02,q.hz-.02]]){
   const u=local[0],v=local[1],x=q.x+u*q.c+v*q.s,z=q.z-u*q.s+v*q.c,y=q.kind==='floor'?q.y:G.snow.terrain.heightAt(x,z)+.1;
   probes.push([x,y,z,G.snowCover.looseAt(x,z,y),+G.snowCover.floorAt(x,z,y)]);
  }
  const n=probes.length,data=new Float32Array(n*4);probes.forEach((p,i)=>data.set(p.slice(0,3),i*4));
  const texture=new T.DataTexture(data,n,1,T.RGBAFormat,T.FloatType);texture.needsUpdate=true;
  const material=new T.ShaderMaterial({uniforms:{...snowCoverUniforms,uProbes:{value:texture},uCount:{value:n}},vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:`${snowCoverShader}\nuniform sampler2D uProbes;uniform float uCount;void main(){vec3 p=texture2D(uProbes,vec2(gl_FragCoord.x/uCount,0.5)).xyz;vec2 c=snowCover(p);gl_FragColor=vec4(c,0.0,1.0);}`});
  const mesh=new T.Mesh(new T.PlaneGeometry(2,2),material),scene=new T.Scene();scene.add(mesh);
  const target=new T.WebGLRenderTarget(n,1),renderer=G.renderer,previous=renderer.getRenderTarget(),pixels=new Uint8Array(n*4);renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,new T.Camera());renderer.readRenderTargetPixels(target,0,0,n,1,pixels);renderer.setRenderTarget(previous);
  let error=0;probes.forEach((p,i)=>{error=Math.max(error,Math.abs(pixels[i*4]/255-p[3]),Math.abs(pixels[i*4+1]/255-p[4]))});
  mesh.geometry.dispose();material.dispose();texture.dispose();target.dispose();return{probes:n,error};
 });check('the actual GPU uses the same rotated roof and floor boundaries as physics',gpu.probes>100&&gpu.error<.015,gpu);
 const all=await page.evaluate(()=>{
  const {G,THREE:T}=window.__game,s=G.snow;let roofs=0,marks=0;
  for(const q of G.snowCover.zones)if(q.kind==='roof'){
   const h=s.terrain.heightAt(q.x,q.z),p={position:new T.Vector3(q.x,h+.01,q.z),rotation:new T.Quaternion()};
   const before=s.field.recordedCells().length;s.field.sweepBoot(p,p);marks+=s.field.recordedCells().length-before;
   if(G.snowCover.roofAt(q.x,q.z,h+1)&&s.field.initialThickness(q.x,q.z)===0)roofs++;
  }
  return{roofs,marks,expected:G.snowCover.zones.filter(q=>q.kind==='roof').length};
 });check('all registered roofs retain only permanent snow and reject soft footsteps',all.roofs===all.expected&&all.marks===0,all);
 const shot=async name=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:OUT+'/'+name+'.png',timeout:120000});console.log('SHOT',name)};
 await page.evaluate(()=>{const {G}=window.__game,h=G.terrain.houseY;window.__view([9,h+3.1,8],[3,h+.15,3])});await shot('house');
 const places=await page.evaluate(()=>window.__game.G.region.places.filter(p=>['hut','fishing','leanto','grotto','station'].includes(p.kind)).map(p=>({kind:p.kind,x:p.x,z:p.z,y:p.y,yaw:p.yaw})));
 for(const kind of ['hut','leanto']){
  const p=places.find(p=>p.kind===kind);if(!p)continue;
  const state=await page.evaluate(p=>{const g=window.__game,{G,THREE:T}=g;g.teleport(p.x,p.y+.1,p.z);G.terrain.update(G.player.eyePos,100);G.forest.update(G.player.pos,true);G.lake.stream(G.player.pos,100);g.steps(60);const eye=new T.Vector3(0,1.4,2.5).applyAxisAngle(new T.Vector3(0,1,0),p.yaw).add(new T.Vector3(p.x,p.y,p.z));window.__view(eye.toArray(),[p.x,p.y+.1,p.z]);return{kind:p.kind,thickness:G.snow.field.initialThickness(p.x,p.z),roof:G.snowCover.roofAt(p.x,p.z,p.y+1.7),floor:G.snowCover.floorAt(p.x,p.z,p.y),pos:G.player.pos.toArray()}},p);
  console.log('SHELTER',JSON.stringify(state));await shot(kind);
  check(kind+' uses its floor or permanent packed ground without loose snow',state.roof&&state.thickness===0,state);
 }
 const pit=await page.evaluate(()=>{const g=window.__game,{G}=g,s=G.snow,x=9,z=12,y=s.terrain.heightAt(x,z);g.teleport(x,y+.3,z+1.3);g.steps(90);let volume=0;for(let i=0;i<20;i++)volume+=s.field.remove(x,z,.6,.09);s.update(0);window.__view([x+.7,y+1.6,z+1],[x,y,z]);return{height:s.field.sample(x,z).height,volume,base:s.packedBase(x,z)}});console.log('PIT',JSON.stringify(pit));await shot('pit');
 check('excavation ends on a persistent frozen base',pit.height===0&&pit.volume>0&&pit.base,pit);
 const shore=await page.evaluate(()=>{const g=window.__game,{G}=g,s=G.snow,R=G.region,nf=R.n+1;let best=null;
  for(let j=1;j<R.n;j++)for(let i=1;i<R.n;i++){const k=j*nf+i;if(!Number.isFinite(R.water[k]))continue;const x=i*2-R.ox,z=j*2-R.oz,d=x*x+z*z;if(d>400*400||best&&d>best.d)continue;for(const [di,dj]of[[1,0],[-1,0],[0,1],[0,-1]]){const q=k+di+dj*nf;if(Number.isNaN(R.water[q])&&R.h[q]>R.water[k]+.02){best={x,z,y:R.water[k],nx:di,nz:dj,d};break}}}
  if(!best)return null;const q=best;g.teleport(q.x+q.nx*5,s.terrain.heightAt(q.x+q.nx*5,q.z+q.nz*5)+.3,q.z+q.nz*5);G.terrain.update(G.player.eyePos,100);G.forest.update(G.player.pos,true);G.lake.stream(G.player.pos,100);g.steps(60);window.__view([q.x+q.nx*6+q.nz*3,q.y+2.3,q.z+q.nz*6-q.nx*3],[q.x,q.y+.1,q.z]);return q;
 });console.log('SHORE',JSON.stringify(shore));if(shore)await shot('shore');
 const walk=await page.evaluate(()=>{
  const g=window.__game,{G,THREE:T}=g,results=[];
  for(const p of G.region.places.filter(p=>['hut','fishing','station','leanto'].includes(p.kind))){
   const forward=new T.Vector3(Math.sin(p.yaw),0,Math.cos(p.yaw)),start=new T.Vector3(p.x,0,p.z).addScaledVector(forward,4.2);
   g.teleport(start.x,G.terrain.heightAt(start.x,start.z)+.1,start.z);G.player.stamina=1;G.player.winded=false;G.player.yaw=p.yaw;G.forest.update(G.player.pos,true);G.input.keys.add('KeyW');let inside=false;
   for(let i=0;i<400&&!inside;i++){g.steps(1);inside=!!G.structures.shelterAt(G.player.pos)}G.input.keys.clear();
   results.push({kind:p.kind,inside,reach:Math.max(...g.animation().reachErrors)});
  }return results;
 });check('the real controller can walk into every hut, station and lean-to',walk.length>5&&walk.every(p=>p.inside&&p.reach<.025),walk);
 const motion=[];await page.setViewportSize({width:640,height:440});
 await page.evaluate(()=>{const {G}=window.__game;const p=G.player.pos;window.__view([p.x+2,p.y+1.3,p.z+2],[p.x,p.y+.6,p.z]);G.input.keys.add('KeyW')});
 for(let i=0;i<4;i++){motion.push(await page.evaluate(()=>{const g=window.__game;g.steps(9);g.G.snow.update(0);return g.animation()}));await shot('motion-'+i)}
 await page.evaluate(()=>window.__game.G.input.keys.clear());check('rendered movement stays reachable through the snow boundary',motion.every(p=>p.reachErrors.every(e=>e<.025)));
 check('no shader or JavaScript errors',errors.length===0,errors);
 fs.writeFileSync(OUT+'/result.json',JSON.stringify({checks,initial,gpu,all,places,pit,shore,walk,motion,errors},null,2));
}finally{await browser?.close();await server.close()}})().catch(e=>{console.error(e);process.exitCode=1});
