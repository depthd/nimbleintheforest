// Cold browser contexts, identical seed; compare first views after loading.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
(async()=>{
 const {preview}=await import('vite');const server=await preview({preview:{port:5194,strictPort:true},logLevel:'error'});let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const results=[];
  for(const warmup of [0,1]){
   const context=await browser.newContext({viewport:{width:320,height:180},deviceScaleFactor:1});const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{window.requestAnimationFrame=()=>0});
   const start=Date.now();await page.goto(`http://localhost:5194/?test=1&seed=42&hour=13&weather=clear&warmup=${warmup}`);
   await page.waitForFunction(()=>window.__game,null,{timeout:300000,polling:100});
   const readyMs=Date.now()-start;
   const result=await page.evaluate(()=>{
    const {G,THREE:T}=window.__game,renderer=G.renderer,gl=renderer.getContext();
    const snapshot=()=>({time:G.time,pos:G.player.pos.toArray(),bodies:G.world.bodies.len(),colliders:G.world.colliders.len(),inventory:G.player.inventory.map(e=>e.defId),snow:G.snow.field.stats().modifiedCells});
    const before=snapshot(),programs=renderer.info.programs.length;
    const views=[];const camera=G.camera.clone();
    for(let round=0;round<2;round++)for(let i=0;i<4;i++){
     camera.quaternion.copy(G.camera.quaternion).premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),i*Math.PI/2));camera.updateMatrixWorld(true);
     const count=renderer.info.programs.length,t=performance.now();renderer.clear();renderer.render(G.scene,camera);gl.finish();
     views.push({round,view:i,ms:performance.now()-t,newPrograms:renderer.info.programs.length-count});
    }
    return {before,after:snapshot(),programs,views,warmupMs:performance.getEntriesByName('startup-graphics','measure').map(e=>e.duration),hands:!!G.player.avatar.hands,diagnostics:!!G.recorder};
   });result.warmup=warmup;result.readyMs=readyMs;result.errors=errors;
   assert.deepEqual(result.before,result.after);assert.equal(errors.length,0);assert.ok(result.hands&&result.diagnostics);
   console.log(JSON.stringify(result));results.push(result);await context.close();
  }
  assert.deepEqual(results[0].before,results[1].before,'graphics warmup must not change simulation');
  assert.ok(results[1].programs>0);assert.equal(results[1].views.reduce((n,v)=>n+v.newPrograms,0),0,'no first-turn compilation after warmup');
  const out=process.argv[2]||'/tmp/startup-results.json';fs.writeFileSync(out,JSON.stringify(results,null,2));
  console.log('PASS startup states identical, no new programs on first turns, hands and diagnostics retained');
 }finally{await browser?.close();await new Promise(r=>server.httpServer.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
