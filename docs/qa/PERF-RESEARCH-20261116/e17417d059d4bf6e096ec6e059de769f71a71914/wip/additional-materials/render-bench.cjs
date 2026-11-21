const {chromium}=require('playwright'), fs=require('node:fs');
const OUT='/workspace/work/perf-research/results';
const mode=process.argv[2]||'base',round=process.argv[3]||'1',N=Number(process.env.N||24);
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
 const page=await browser.newPage({viewport:{width:640,height:360},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.requestAnimationFrame=cb=>{window.__next=cb;return 1;};let s=123456789;Math.random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};});
 const start=Date.now();await page.goto((process.env.URL||'http://127.0.0.1:5196/')+'?test=1&seed=42&hour=13&weather=clear');
 await page.waitForFunction(()=>window.__game,null,{timeout:300000,polling:100});const readyMs=Date.now()-start;console.log('ready',mode,round,readyMs);
 await page.evaluate(mode=>{
  const {G,THREE:T}=window.__game;
  const materials=new Set();G.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)materials.add(m);});
  if(mode==='zero-lights'){
    const old=T.ShaderChunk.lights_fragment_begin;
    let chunk=old;
    for(const type of ['point','spot']){
      const cap=type[0].toUpperCase()+type.slice(1), assignment=`${type}Light = ${type}Lights[ i ];`;
      chunk=chunk.replace(assignment,assignment+`\n if (any(notEqual(${type}Light.color, vec3(0.0)))) {`);
      // Close inside the unrolled loop, after the corresponding direct evaluation.
      const from=chunk.indexOf(assignment),end=chunk.indexOf('RE_Direct( directLight',from),close=chunk.indexOf(';',end)+1;
      chunk=chunk.slice(0,close)+'\n }'+chunk.slice(close);
    }
    T.ShaderChunk.lights_fragment_begin=chunk;
  }
  for(const m of materials){
   if(mode==='glint'){
    const previous=m.onBeforeCompile;m.onBeforeCompile=function(sh,r){previous.call(this,sh,r);sh.fragmentShader=sh.fragmentShader.replace('    // sun glints on the snow','    if (camDist < 28.0 && uGlint > 0.0 && rockK < 1.0) {\n    // sun glints on the snow').replace('    outgoingLight += vec3(g * 1.2);','    outgoingLight += vec3(g * 1.2);\n    }');};
   }
   if(mode==='glint'||mode==='zero-lights'){const key=m.customProgramCacheKey.bind(m);m.customProgramCacheKey=()=>key()+'-research-'+mode;m.needsUpdate=true;}
  }
  if(mode==='no-shadows-diagnostic')G.renderer.shadowMap.enabled=false;
  if(mode==='no-lights-diagnostic'){for(const l of [...G.fx.lights,G.fx.spot])l.visible=false;}
  if(mode==='static-matrices'){
   // Optimistic upper bound: freeze all transforms, valid only in this static render test.
   G.scene.updateMatrixWorld(true);G.scene.traverse(o=>{o.matrixAutoUpdate=false;o.matrixWorldAutoUpdate=false;});
  }
  const gl=G.renderer.getContext(), ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  window.__rb={samples:[],ext,pending:[],mode};
 },mode);
 const result={mode,round,N,readyMs,errors,scenarios:{}};
 const scenarioNames=(process.env.SCENARIOS||'spawn,home,forest,overview,blizzard').split(',');
 for(const name of scenarioNames){
  await page.evaluate(name=>{
   const {G,THREE:T}=window.__game, rb=window.__rb;
   G.time=46800;G.settings.weatherLock=name==='blizzard'?'blizzard':'clear';G.weather.setType(G.settings.weatherLock,true);G.weather.update(0,0);
   let x=G.player.pos.x,y=G.player.pos.y,z=G.player.pos.z,target=new T.Vector3(0,G.house.Y0+1,0);
   if(name==='home'){x=0;y=G.house.Y0+.03;z=1.5;target.set(-3.6,G.house.Y0+1,-3.25);}
   if(name==='forest'||name==='blizzard'){x=110;z=48;y=G.terrain.heightAt(x,z)+.15;target.set(x+8,y+1,z-10);}
   if(name==='overview'){x=80;z=80;y=G.terrain.heightAt(x,z)+160;target.set(0,G.house.Y0,0);}
   window.__game.teleport(x,y,z);window.__game.lookAt(...target.toArray());
   G.player.updateCamera(0);G.sky.indoorFactor=name==='home'?.5:1;G.sky.update();G.terrain.update(G.camera.position,400);G.forest.update(G.player.pos,true);G.cliffs?.update(G.camera.position,G.player.pos,Infinity);G.entities.cull(1,G.camera.position);G.lake.stream(G.player.pos,60);G.corpses.update();G.snow.renderer.update(G.player.pos);
   G.camera.updateMatrixWorld(true);rb.samples=[];rb.pending=[];
  },name);
  for(let i=-5;i<N;i++){
   const sample=await page.evaluate(measured=>{
    const {G}=window.__game, r=G.renderer,gl=r.getContext(),rb=window.__rb;
    const query=rb.ext?gl.createQuery():null;
    if(query)gl.beginQuery(rb.ext.TIME_ELAPSED_EXT,query);
    const t=performance.now();r.clear();r.render(G.scene,G.camera);const submitted=performance.now()-t;gl.finish();const complete=performance.now()-t;
    if(query){gl.endQuery(rb.ext.TIME_ELAPSED_EXT);rb.pending.push(query);}
    const s={submit:submitted,complete,calls:r.info.render.calls,triangles:r.info.render.triangles,points:r.info.render.points};
    if(measured)rb.samples.push(s);return s;
   },i>=0);
   if(i===0)console.log('first',mode,name,sample.complete);
  }
  result.scenarios[name]=await page.evaluate(()=>{
   const {G}=window.__game,rb=window.__rb,gl=G.renderer.getContext(),gpu=[];
   for(const q of rb.pending){gpu.push(rb.ext&&!gl.getParameter(rb.ext.GPU_DISJOINT_EXT)&&gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)?gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6:null);gl.deleteQuery(q);}
   G.renderer.clear();G.renderer.render(G.scene,G.camera);gl.finish();const pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   let hash=2166136261;for(const v of pixels)hash=Math.imul(hash^v,16777619)>>>0;
   let binary='';for(let i=0;i<pixels.length;i+=32768)binary+=String.fromCharCode(...pixels.subarray(i,i+32768));
   return {samples:rb.samples,gpu:gpu.slice(5),pixelHash:hash,raw:btoa(binary),camera:{position:G.camera.position.toArray(),quaternion:G.camera.quaternion.toArray()},memory:G.renderer.info.memory,programs:G.renderer.info.programs.length,physics:{bodies:G.world.bodies.len(),colliders:G.world.colliders.len()}};
  });
  fs.writeFileSync(`${OUT}/render-${mode}-${round}-${name}.rgba`,Buffer.from(result.scenarios[name].raw,'base64'));delete result.scenarios[name].raw;
  fs.writeFileSync(`${OUT}/render-${mode}-${round}.json`,JSON.stringify(result,null,2));
  console.log(name,JSON.stringify(result.scenarios[name]));
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
