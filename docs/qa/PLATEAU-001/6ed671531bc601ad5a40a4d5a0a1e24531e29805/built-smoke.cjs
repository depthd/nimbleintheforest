const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5236/experiments/plateau/?seam=1');
  await page.waitForFunction(()=>window.__plateau?.ready,null,{timeout:120000});
  const stats=await page.evaluate(()=>({points:window.__plateau.seam.points.length,overlay:window.__plateau.seamGroup.visible,solids:window.__plateau.solidMeshes.length}));
  assert.deepEqual(stats,{points:758,overlay:true,solids:12});
  await page.uncheck('#seam');
  assert.equal(await page.evaluate(()=>window.__plateau.seamGroup.visible),false);
  await page.setViewportSize({width:390,height:844});
  await page.click('#collapse');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  fs.writeFileSync('/workspace/work/seam-boundary-qa/built.json',JSON.stringify({result:'PASS',stats,mobileOverflow:false,errors},null,2));
  console.log('PASS: built scene, seam query/toggle and mobile viewport');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
