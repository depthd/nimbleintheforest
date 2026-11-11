const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(process.argv[2]||'/tmp/wedge-qa'),base=process.env.WEDGE_URL||'http://127.0.0.1:5235/experiments/plateau/wedge.html';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const errors=[],page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  for(const kind of ['relief','flat']){
   await page.goto(base+'?kind='+kind);await page.waitForFunction(()=>window.__wedge?.ready);
   for(const view of ['top','side','ground','walk']){
    await page.evaluate(view=>window.__wedge.view(view),view);
    await page.screenshot({path:path.join(out,`${kind}-${view}.png`)});
    if(view==='top'){
     await page.evaluate(()=>window.__wedge.mark(true));await page.screenshot({path:path.join(out,`${kind}-E.png`)});
     await page.evaluate(()=>window.__wedge.mark(false));
    }
   }
  }
  const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:out,size:{width:1280,height:720}}});
  const motion=await context.newPage();motion.on('pageerror',e=>errors.push(e.message));await motion.goto(base+'?kind=relief');await motion.waitForFunction(()=>window.__wedge?.ready);
  await motion.evaluate(()=>{document.querySelector('aside').style.display='none';window.__wedge.walk(0);});
  for(let i=0;i<=40;i++){
   await motion.evaluate(t=>window.__wedge.walk(t),i/40);await motion.waitForTimeout(125);
   if(i%10===0)await motion.screenshot({path:path.join(out,`motion-${i/10}.png`)});
  }
  const video=motion.video();await context.close();await video.saveAs(path.join(out,'along-E.webm'));
  const originalVideo=await video.path();if(originalVideo!==path.join(out,'along-E.webm'))fs.unlinkSync(originalVideo);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify({result:'PASS',errors,backend:'Chromium SwiftShader',reliefAttenuation:false,views:['top','side','ground','walk'],motion:'along-E.webm',physicsPlayerTested:false},null,2));
  console.log('PASS: flat and relief views, E overlays, moving camera video');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
