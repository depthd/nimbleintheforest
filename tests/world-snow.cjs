// Integration in ordinary play: the real forest, floors, loot and context actions.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const OUT=process.argv[2]||path.join(__dirname,'../test-results/world-snow');fs.mkdirSync(OUT,{recursive:true});
let checks=0;function check(name,ok,data){assert.ok(ok,`${name}: ${JSON.stringify(data)}`);checks++;console.log('PASS ',name,JSON.stringify(data??''))}
(async()=>{
 const {createServer}=await import('vite');
 const server=await createServer({root:path.join(__dirname,'..'),server:{port:5208,strictPort:true,hmr:false},logLevel:'error'});let browser;
 const stop=async()=>{await browser?.close();await server.close();process.exit(130)};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  await server.listen();browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:960,height:640}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.location().url?.endsWith('/favicon.ico'))errors.push(m.text())});
  const ev=(f,arg)=>page.evaluate(f,arg),shot=async name=>{await ev(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:path.join(OUT,name+'.png'),timeout:120000})};
  await page.goto('http://127.0.0.1:5208/?test=1&seed=42&hour=13&weather=clear&nocold=1&scale=0');
  await page.waitForFunction(()=>window.__game?.G.snow,null,{timeout:180000});
  let r=await ev(()=>{const g=window.__game,{G}=g;g.setManualStepping(true);G.input.enabled=true;g.steps(120);return {experiment:G.snow.isExperiment,panel:!!document.querySelector('.snow-panel'),pool:G.snow.renderer.stats(),pos:G.player.pos.toArray()}});
  check('ordinary forest starts with world snow and no laboratory',!r.experiment&&!r.panel&&r.pool.meshes>0&&r.pool.vertices<100000,r);
  r=await ev(()=>{
   const {G,THREE:T}=window.__game,s=G.snow;let error=0,samples=0;
   for(let dx=-21;dx<=21;dx+=3)for(let dz=-21;dz<=21;dz+=3){
    const x=G.player.pos.x+dx,z=G.player.pos.z+dz,h=s.terrain.heightAt(x,z);
    const hit=G.world.castRayAndGetNormal(new G.R.Ray(new T.Vector3(x,h+3,z),new T.Vector3(0,-1,0)),6,true,G.R.QueryFilterFlags.EXCLUDE_SENSORS,undefined,undefined,undefined,c=>G.terrain.handles.has(c.handle));
    if(hit){samples++;error=Math.max(error,Math.abs(h-(h+3-hit.timeOfImpact)))}
   }return {samples,error};
  });check('snow foundation matches the real terrain colliders',r.samples>100&&r.error<.002,r);
  r=await ev(()=>{
   const g=window.__game,{G}=g,s=G.snow;G.player.yaw+=Math.PI;G.input.keys.add('KeyW');
   const start=G.player.pos.clone();let contacts=0,minHip=1,reach=0,drift=0,distance=0;
   for(let i=0;i<210;i++){
    if(i>80&&i<150)G.player.yaw+=.04;
    const prev=G.player.avatar.motion.feet.map(f=>({p:f.position.clone(),stance:f.grounded})),position=G.player.pos.clone();g.steps(1);distance+=position.distanceTo(G.player.pos);const a=g.animation();
    contacts+=G.player.avatar.motion.contacts.length;minHip=Math.min(minHip,a.hipHeight);reach=Math.max(reach,...a.reachErrors);
    G.player.avatar.motion.feet.forEach((f,j)=>{if(prev[j].stance&&f.grounded)drift=Math.max(drift,Math.hypot(f.position.x-prev[j].p.x,f.position.z-prev[j].p.z))});
   }
   G.input.keys.clear();return {distance,displacement:start.distanceTo(G.player.pos),contacts,minHip,reach,drift,field:s.field.stats(),cost:{boots:s.bootMs,render:s.renderMs}};
  });check('real footsteps deform forest snow without sliding planted feet',r.distance>2&&r.contacts>3&&r.field.modifiedCells>200&&r.reach<.025&&r.drift<1e-6,r);
  await ev(()=>{const {G}=window.__game;G.player.avatar.inspectionView=1;G.player.avatar.render(1,0)});await shot('01-forest-footprints');
  await ev(()=>{const {G}=window.__game;G.player.avatar.inspectionView=0;G.player.pitch=-.8;G.player.updateCamera(0)});
  const loot=await ev(()=>{
   const g=window.__game,{G,THREE:T}=g,s=G.snow,p=G.player.pos.clone().add(G.player.forward().setY(0).normalize().multiplyScalar(1.3));
   p.y=s.terrain.heightAt(p.x,p.z)+.045;const e=G.entities.spawnItem('knife',p);g.steps(90);
   g.lookAt(p.x,p.y,p.z);let a=g.actions();const before={target:G.interact.target.kind,actions:a.actions};
   for(let i=0;i<12;i++){g.act('LMB','снег');s.update(.31)}
   a=g.actions();const exposed=G.interact.target.entity===e&&a.actions.some(s=>s.startsWith('E:'));
   if(exposed)g.act('E');
   g.lookAt(p.x,p.y,p.z);a=g.actions();const fill=a.actions.some(s=>s.startsWith('RMB:'));const carried=s.carriedSnow;
   if(fill)g.act('RMB');
   return {before,exposed,fill,carried,after:s.carriedSnow,picked:G.player.inventory.includes(e)};
  });check('buried real loot is revealed by digging and can then be picked up',loot.before.target==='ground'&&loot.exposed&&loot.picked,loot);
  check('digging keeps survival actions and returns a finite quantity of snow',loot.before.actions.some(s=>s.startsWith('F:'))&&loot.before.actions.some(s=>s.startsWith('G:'))&&loot.fill&&loot.after<loot.carried,loot);
  await shot('02-excavated-forest');
  r=await ev(()=>{
   const g=window.__game,{G}=g,s=G.snow;g.give('axe');g.equip('axe');const a=g.actions();G.player.equip(null);
   g.teleport(0,G.house.Y0+.05,0);g.steps(90);const feet=g.animation().feet;
   let water=null;
   for(let i=0;i<G.region.water.length;i+=37)if(Number.isFinite(G.region.water[i])&&G.region.h[i]<G.region.water[i]-.2){const x=(i%(G.region.n+1))*2-G.region.ox,z=Math.floor(i/(G.region.n+1))*2-G.region.oz;water={x,z,covered:s.contains(x,z),support:s.movement(x,z,G.region.water[i]+.03)};break}
   return {axeDig:a.actions.some(s=>s.includes('Разгрести')),houseCovered:s.contains(0,0),houseThickness:s.field.initialThickness(0,0),feet:feet.map(f=>f.position[1]-G.house.Y0),water};
  });check('tools, indoor floors and water retain their regular game rules',!r.axeDig&&!r.houseCovered&&r.houseThickness===0&&r.feet.every(y=>Math.abs(y-.012)<.03)&&r.water&&!r.water.covered&&!r.water.support,r);
  r=await ev(()=>{
   const {G,THREE:T}=window.__game,s=G.snow,meshes=[...s.renderer.entries.values()].map(e=>({key:`${e.x},${e.z}`,id:e.texture.id})),count=G.world.colliders.len();
   const start=performance.now();for(let i=0;i<20;i++)s.renderer.update(new T.Vector3(G.player.pos.x+i*10,0,G.player.pos.z));
   const ms=performance.now()-start;s.renderer.update(G.player.pos);
   const same=meshes.every(m=>s.renderer.entries.get(m.key)?.texture.id===m.id);
   G.recorder.start();window.__game.steps(2);G.recorder.captureFrame(1/60,1);G.recorder.stop();const recording=G.recorder.exportData();G.recorder.exit();
   return {pool:s.renderer.stats(),same,colliders:G.world.colliders.len()-count,field:s.field.stats(),streamMs:ms,worldRecording:!recording.context.snowScene&&!!recording.initialSnow};
  });check('exploration reuses a bounded pool and ordinary-game recordings keep snow',r.same&&r.colliders===0&&r.pool.meshes>0&&r.field.hotTiles<=32&&r.worldRecording,r);
  check('no shader or JavaScript errors',errors.length===0,errors);
  fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify({checks,errors,last:r},null,2));console.log(`${checks} ordinary-world snow checks passed`);
 }finally{await browser?.close();await server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
