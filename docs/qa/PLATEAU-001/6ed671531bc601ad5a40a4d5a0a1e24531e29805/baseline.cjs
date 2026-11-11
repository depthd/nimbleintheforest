const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto('http://127.0.0.1:5235/experiments/plateau/');
 await page.waitForFunction(()=>window.__plateau?.ready,null,{timeout:120000});
 const meshes=await page.evaluate(()=>window.__plateau.solidMeshes.map(mesh=>{
   const hash=a=>{let h=2166136261;for(const b of new Uint8Array(a.buffer,a.byteOffset,a.byteLength))h=Math.imul(h^b,16777619);return(h>>>0).toString(16)};
   return {position:hash(mesh.geometry.attributes.position.array),index:hash(mesh.geometry.index.array),normal:hash(mesh.geometry.attributes.normal.array)};
 }));
 fs.writeFileSync('/workspace/work/seam-boundary-qa/baseline.json',JSON.stringify(meshes,null,2));
 console.log('Baseline captured',meshes.length,'solid meshes');
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
