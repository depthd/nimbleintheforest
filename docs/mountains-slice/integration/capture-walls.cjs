const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const [mode, outDir, origin='http://127.0.0.1:5184', familyFilter, seedFilter] = process.argv.slice(2);
fs.mkdirSync(outDir,{recursive:true});
(async()=>{
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--js-flags=--max-old-space-size=6500']});
 try {
  const page=await browser.newPage({viewport:{width:800,height:450},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.goto(origin+'/experiments/plateau/mountain.html',{timeout:120000,waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__mountain?.ready,null,{timeout:300000});
  await page.addStyleTag({content:'aside,#status{display:none!important}'});
  await page.evaluate(()=>window.__mountain.view('wall'));
  const options=mode==='baseline'?[['original',0,42]]:[['original',0,42],...['rounded','angular'].flatMap((family,i)=>[42,7,8191,23011].flatMap(seed=>(seed===42?[0,1,2]:[1]).map(p=>[family,p,seed])))];
  const report=[];
  for(const [family,preset,seed] of options){
   if(familyFilter && family!==familyFilter)continue;
   if(seedFilter && (seedFilter==='extra'?seed===42:seed!==Number(seedFilter)))continue;
   const name=family+'-'+preset+'-'+seed;
   if(mode!=='baseline') await page.evaluate(o=>window.__mountain.setWall(...o),[family,preset,seed]);
   const stats=await page.evaluate(async(benchmark)=>{
    const m=window.__mountain,r=m.renderer,gl=r.getContext(),times=[];
    const sample=new Uint8Array(4);
    for(let i=0;i<(benchmark?5:0);i++){
      await new Promise(requestAnimationFrame);
      const begin=performance.now();r.render(m.scene,m.camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,sample);
      times.push(performance.now()-begin);
    }
    if(!benchmark)r.render(m.scene,m.camera); // same camera pass as the timed presets, after the shadow update
    const sorted=times.slice(1).sort((a,b)=>a-b);
    return {triangles:r.info.render.triangles,calls:r.info.render.calls,drawMs:times,medianMs:sorted.length?(sorted[1]+sorted[2])/2:null,gpu:gl.getParameter(gl.RENDERER)};
   },seed===42);
   await page.locator('canvas').screenshot({path:path.join(outDir,name+'.png')});
   if(seed===42 && mode!=='baseline') {
     const png=await page.evaluate(()=>{
       const {scene,camera,renderer:r}=window.__mountain;
       const receivers=[];
       scene.traverse(o=>{if(o.receiveShadow){receivers.push(o);o.receiveShadow=false;}});
       r.render(scene,camera);
       const url=r.domElement.toDataURL('image/png');
       receivers.forEach(o=>{o.receiveShadow=true;});
       r.render(scene,camera);
       return url.split(',')[1];
     });
     fs.mkdirSync(path.join(outDir,'no-shadow'),{recursive:true});
     fs.writeFileSync(path.join(outDir,'no-shadow',name+'.png'),Buffer.from(png,'base64'));
   }
   if(family!=='original')stats.mask=await page.evaluate(()=>window.__mountain.wallMask());
   report.push({family,preset,seed,...stats});
   fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify({viewport:[800,450],errors,report},null,2));
   console.log(name,stats.triangles,stats.medianMs);
  }
  if(errors.length)throw Error(errors.join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
