const { chromium }=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const out='/workspace/work/seam-boundary-qa';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1600,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 try {
  await page.goto('http://127.0.0.1:5235/experiments/plateau/');
  await page.waitForFunction(()=>window.__plateau?.ready,null,{timeout:120000});
  const actual=await page.evaluate(()=>window.__plateau.solidMeshes.map(mesh=>{
    const hash=a=>{let h=2166136261;for(const b of new Uint8Array(a.buffer,a.byteOffset,a.byteLength))h=Math.imul(h^b,16777619);return(h>>>0).toString(16)};
    return {position:hash(mesh.geometry.attributes.position.array),index:hash(mesh.geometry.index.array),normal:hash(mesh.geometry.attributes.normal.array)};
  }));
  assert.deepEqual(actual,JSON.parse(fs.readFileSync(out+'/baseline.json')),'existing geometry/collision changed');
  assert.equal(await page.evaluate(()=>window.__plateau.seamGroup.visible),false);
  await page.click('[data-view="seamPlan"]');
  await page.evaluate(()=>{window.__plateau.controls.enableDamping=false;window.__plateau.controls.update()});
  await page.click('#collapse');
  const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await frame();await page.screenshot({path:out+'/01-unchanged-scene.png',timeout:120000});
  await page.evaluate(()=>{const input=document.getElementById('seam');input.checked=true;input.dispatchEvent(new Event('change'))});
  await frame();await page.screenshot({path:out+'/02-boundary-plan.png',timeout:120000});
  for(const [view,file] of [['seamSide','03-boundary-close'],['ascent','04-ascent-intersection'],['roof','05-above-cave']]) {
    await page.evaluate(id=>window.__plateau.view(id),view);await frame();
    await page.screenshot({path:`${out}/${file}.png`,timeout:120000});
  }
  const data=await page.evaluate(()=>{
    const s=window.__plateau;
    return {seam:s.seam,parts:s.seamParts,caveProjection:s.caveProjection,
      ascentRemovedLength:s.seamParts.filter(p=>p.kind==='ascent').reduce((v,p)=>v+Math.hypot(p.b.x-p.a.x,p.b.y-p.a.y,p.b.z-p.a.z),0),
      caveRays:{insideFloor:s.ray([279,6.8,0],[0,-1,0])[0],insideRoof:s.ray([279,6.8,0],[0,1,0])[0],exit:s.ray([340,6.8,0],[-1,0,0])[0]}};
  });
  assert.ok(data.ascentRemovedLength>0);assert.ok(data.caveProjection.length>0);
  assert.ok(Math.abs(data.caveRays.insideFloor.point[1]-5)<.001);
  assert.ok(data.caveRays.insideRoof.point[1]>=8);
  assert.ok(Math.abs(data.caveRays.exit.point[0]-270)<.001);
  assert.equal(errors.length,0,JSON.stringify(errors));
  fs.writeFileSync(out+'/boundary-data.json',JSON.stringify(data));
  fs.writeFileSync(out+'/browser.json',JSON.stringify({result:'PASS',backend:'Chromium SwiftShader; not hardware FPS',
    unchangedSolidMeshes:actual.length,unchangedAttributes:['position','index','normal'],overlayDefault:false,
    ascentRemovedLength:data.ascentRemovedLength,caveActualIntersection:false,caveProjectionParts:data.caveProjection.length,
    caveRays:data.caveRays,errors},null,2));
  console.log('PASS: unchanged 12 solid meshes, diagnostic views, existing cave rays; screenshots saved');
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
