const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const out=__dirname, prefix='/docs/qa/PLATEAU-001/b8da41b6754c5668197493d00e24fc72698358cb';
const base=process.argv[2]||'http://127.0.0.1:5235';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/experiments/plateau/?seam=1');
  await page.waitForFunction(()=>window.__plateau?.ready,null,{timeout:120000});
  const source=await page.evaluate(()=>window.__plateau.seam);
  const endpoints=JSON.parse(fs.readFileSync(path.join(out,'geometry.json'))).ascentEndpoints;
  await page.evaluate(async({prefix,endpoints})=>{
    const s=window.__plateau;s.controls.enableDamping=false;
    document.getElementById('panel').style.display='none';
    const module=await import(prefix+'/review-view.ts');module.markGameEndpoints(s,endpoints);
    s.camera.position.set(-300,170,-80);s.controls.target.set(-218,96,-28);s.controls.update();
  },{prefix,endpoints});
  const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await frame();await page.screenshot({path:path.join(out,'cut-ends-overview.png'),timeout:120000});
  for(let i=0;i<endpoints.length;i++){
    await page.evaluate(p=>{const s=window.__plateau;s.camera.position.set(p.x-38,p.y+24,p.z-30);s.controls.target.set(p.x,p.y-5,p.z);s.controls.update()},endpoints[i]);
    await frame();await page.screenshot({path:path.join(out,`cut-end-${i+1}.png`),timeout:120000});
  }
  await page.goto(base+prefix+'/relief.html');
  await page.waitForFunction(()=>window.__seamFixture?.seam,null,{timeout:120000});
  const fixture=await page.evaluate(()=>({seam:window.__seamFixture.seam,topAttenuation:window.__seamFixture.topAttenuation}));
  assert.equal(fixture.topAttenuation,false);
  assert.ok(Math.max(...fixture.seam.points.map(p=>p.y))-Math.min(...fixture.seam.points.map(p=>p.y))>10);
  await page.screenshot({path:path.join(out,'relief-overview.png'),timeout:120000});
  await page.evaluate(()=>window.__seamFixture.render([10,150,260],[0,96,165]));
  await page.screenshot({path:path.join(out,'relief-close.png'),timeout:120000});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'boundary-snapshots.json'),JSON.stringify({source,fixture}));
  fs.writeFileSync(path.join(out,'screenshots.json'),JSON.stringify({result:'PASS',backend:'Chromium SwiftShader',fixtureTopAttenuation:false,fixtureReliefRange:Math.max(...fixture.seam.points.map(p=>p.y))-Math.min(...fixture.seam.points.map(p=>p.y)),errors},null,2));
  console.log('PASS: source excavation ends + independent untapered relief screenshots');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
