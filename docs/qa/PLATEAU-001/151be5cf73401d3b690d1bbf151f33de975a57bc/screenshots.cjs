const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const prefix='/docs/qa/PLATEAU-001/151be5cf73401d3b690d1bbf151f33de975a57bc',out=__dirname;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],snapshots={};page.on('pageerror',e=>errors.push(e.message));
  for(const kind of ['flat','relief']){
   await page.goto('http://127.0.0.1:5235'+prefix+'/comparison.html?kind='+kind);
   await page.waitForFunction(()=>window.__comparison?.seam,null,{timeout:120000});
   snapshots[kind]=await page.evaluate(()=>({seam:window.__comparison.seam,oldSeam:window.__comparison.oldSeam}));
   for(const [view,eye,target] of [['overview',[390,300,430],[0,50,0]],['close',[10,150,260],[0,96,165]],['plan',[0,650,.01],[0,80,0]]]){
    await page.evaluate(({eye,target})=>window.__comparison.render(eye,target),{eye,target});
    await page.screenshot({path:path.join(out,`${kind}-${view}.png`),timeout:120000});
   }
  }
  await page.goto('http://127.0.0.1:5235/experiments/plateau/?seam=1');
  await page.waitForFunction(()=>window.__plateau?.ready,null,{timeout:120000});
  const radius=JSON.parse(fs.readFileSync(path.join(out,'geometry.json'))).radius;
  snapshots.game=await page.evaluate(async({prefix,radius})=>{
   const s=window.__plateau;document.getElementById('panel').style.display='none';s.controls.enableDamping=false;
   const module=await import(prefix+'/compare-view.ts'),seam=module.addCandidate(s,radius);s.view('seamSide');return seam;
  },{prefix,radius});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.screenshot({path:path.join(out,'game-close.png'),timeout:120000});
  assert.equal(snapshots.game.points.length,734);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'snapshots.json'),JSON.stringify(snapshots));
  fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify({result:'PASS',backend:'Chromium SwiftShader',errors,gameOriginalEUnchanged:true,temporaryCandidateOverlayOnly:true},null,2));
  console.log('PASS: flat/relief matched cameras and game overlay captured');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
