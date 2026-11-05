const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const OUT=process.argv[2]||path.join(__dirname,'../test-results/trails');fs.mkdirSync(OUT,{recursive:true});
let checks=0;function check(name,ok,data){assert.ok(ok,`${name}: ${JSON.stringify(data)}`);checks++;console.log('PASS',name,JSON.stringify(data??''))}
(async()=>{
 const {createServer}=await import('vite');const server=await createServer({root:path.join(__dirname,'..'),server:{port:5210,strictPort:true,hmr:false},logLevel:'error'});let browser;
 const stop=async()=>{await browser?.close();await server.close();process.exit(130)};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  await server.listen();browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.location().url?.endsWith('/favicon.ico'))errors.push(m.text())});
  await page.goto('http://127.0.0.1:5210/?test=1&seed=42&hour=13&weather=clear&nocold=1&scale=0');
  await page.waitForFunction(()=>window.__game?.G.snow,null,{timeout:180000});
  const ev=(f,a)=>page.evaluate(f,a),shot=async name=>{await ev(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:path.join(OUT,name+'.png'),timeout:120000})};
  let r=await ev(()=>{
   const g=window.__game,{G}=g;g.setManualStepping(true);G.input.enabled=true;g.steps(90);
   G.player.yaw+=Math.PI;G.input.keys.add('KeyW');const start=G.player.pos.clone();for(let i=0;i<150;i++)g.steps(1);G.input.keys.clear();G.snow.update(0);
   return {distance:G.player.pos.distanceTo(start),field:G.snow.field.stats(),render:G.snow.renderer.stats()};
  });check('normal movement leaves persistent world-space tracks',r.distance>2&&r.field.modifiedCells>200&&r.render.meshes>0,r);
  await ev(()=>{
   const g=window.__game,{G,THREE:T}=g,s=G.snow;
   const p=G.player.pos.clone();window.__trailCentre=p.clone().add(new T.Vector3(2,0,-1));
   const c=window.__trailCentre;
   for(let i=0;i<10;i++){
    const x=c.x+(i%2?.13:-.13),z=c.z+2-i*.48;
    const pos=new T.Vector3(x,s.terrain.heightAt(x,z)+s.field.support(x,z)+.012,z);
    const q={position:pos,rotation:new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),.1)};
    s.field.sweepBoot(q,q);
   }
   c.y=s.terrain.heightAt(c.x,c.z)+.28;
   s.update=()=>{};G.player.avatar.inspectionView=1;
   const draw=G.player.avatar.render.bind(G.player.avatar);
   window.__trailView=distance=>{
    const eye=c.clone().add(new T.Vector3(distance*.55,distance*.65,distance*.6));
    G.player.avatar.render=(a,dt)=>{draw(a,dt);const camera=G.player.avatar.inspectionCamera;camera.position.copy(eye);camera.lookAt(c);camera.fov=48;camera.updateProjectionMatrix()};
    s.renderer.update(eye);
   };
   window.__trailView(4);
   document.querySelector('.motion-recorder').style.display='none';
  });
  await shot('01-fresh-close');
  const distance=await ev(()=>{
   const {G,THREE:T}=window.__game,s=G.snow,c=window.__trailCentre;
   const initial=[...s.renderer.entries.values()].map(e=>({key:`${e.x},${e.z}`,texture:e.texture.id}));
   const rows=[];
   for(const d of [4,6,8,10,12,16,17.9,18.1,21.9,22.1,25,45,80,22,4]){
    window.__trailView(d);
    rows.push({d,tiles:s.renderer.entries.size,identities:[...s.renderer.entries.values()].every(e=>initial.some(i=>i.key===`${e.x},${e.z}`&&i.texture===e.texture.id))});
   }return rows;
  });check('all trail tiles and textures survive distance and LOD crossings',distance.every(r=>r.identities&&r.tiles===distance[0].tiles),distance);
  await ev(()=>window.__trailView(25));await shot('02-distant-trails');
  await ev(()=>window.__trailView(4));
  const aging=[];
  for(const [label,minutes] of [['fresh',0],['rounded',5],['covered',8],['soft',3],['faint',5],['gone',15]]){
   const state=await ev(({minutes})=>{
    const {G}=window.__game,s=G.snow,c=window.__trailCentre;
    s.field.advanceWeather(minutes*60,{snow:1,wind:15});
    for(let i=0;i<40;i++)s.renderer.update(G.player.avatar.inspectionCamera.position);
    const x=c.x-.13,z=c.z+2;return {exposure:s.field.weatherExposure,height:s.field.sample(x,z).height,packed:s.field.sample(x,z).compaction,stats:s.renderer.stats()};
   },{minutes});aging.push({label,...state});await shot(`03-${label}`);
  }
  check('snowfall gradually fills, whitens and finally removes the tracks',aging[0].height<aging[1].height&&aging[1].height<aging[2].height&&Math.abs(aging.at(-1).height-.28)<.0001&&aging.at(-1).stats.meshes===0,aging);
  const hook=await ev(()=>{const {G}=window.__game,s=G.snow,before=s.field.weatherExposure;G.weather.setType('snow',true);G.time+=60;Object.getPrototypeOf(s).update.call(s,1);return s.field.weatherExposure-before});
  check('ordinary game time and weather drive the same track lifecycle',hook>0,hook);
  check('no shader or JavaScript errors',errors.length===0,errors);
  fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify({checks,errors,aging,distance},null,2));console.log(`${checks} trail browser checks passed`);
 }finally{await browser?.close();await server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
