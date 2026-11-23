// Run a single warmed Chromium process on a static build with other capture jobs closed.
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const [origin='http://127.0.0.1:5184',out=path.join(__dirname,'wall-timing.json')]=process.argv.slice(2);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:800,height:450},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/experiments/plateau/mountain.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__mountain?.ready,null,{timeout:300000});
  await page.evaluate(()=>window.__mountain.view('wall'));
  const rows=[],cases=[['original',0],['rounded',0],['angular',0],['rounded',1],['angular',1],['rounded',2],['angular',2],['original',0]];
  for(const [family,preset] of cases){
    const stats=await page.evaluate(([f,p])=>{
      const m=window.__mountain,r=m.renderer,gl=r.getContext();
      m.setWall(f,p,42);
      const sample=new Uint8Array(4), times=[];
      for(let i=0;i<4;i++){
        const start=performance.now();r.render(m.scene,m.camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,sample);
        if(i>0)times.push(performance.now()-start);
      }
      const ext=gl.getExtension('WEBGL_debug_renderer_info');
      return {times,medianMs:times.slice().sort((a,b)=>a-b)[1],triangles:r.info.render.triangles,calls:r.info.render.calls,
        renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
    },[family,preset]);
    rows.push({family,preset,...stats});fs.writeFileSync(out,JSON.stringify({seed:42,viewport:[800,450],errors,rows},null,2));console.log(family,preset,stats.medianMs);
  }
  if(errors.length)throw Error(errors.join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
