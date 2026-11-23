const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const root=process.argv[2]||'http://127.0.0.1:5210/nimbleintheforest/test/';
const base=root+'experiments/plateau/';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:720},ignoreHTTPSErrors:true});
  page.setDefaultTimeout(95000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url())});
  await page.goto(base+'review.html',{waitUntil:'domcontentloaded'});
  const child=()=>page.frames().find(f=>f.parentFrame()===page.mainFrame());
  const game=()=>page.frameLocator('iframe');
  await page.locator('#load-state').waitFor({state:'hidden',timeout:150000});
  await child().waitForFunction(()=>window.__mountain?.ready);
  const graphic=()=>game().locator('canvas').evaluate(c=>c.toDataURL());
  const initial=await graphic();
  await page.getByRole('button',{name:'8 угловатых глыб',exact:true}).click();
  await child().waitForFunction(()=>document.querySelector('#wall-family').value==='angular');
  assert.notEqual(await graphic(),initial);
  await page.getByRole('button',{name:'Вся гора',exact:true}).click();
  await child().waitForFunction(()=>window.__mountain.state().view==='overview');
  await page.getByRole('button',{name:'Исходная стенка',exact:true}).click();
  await child().waitForFunction(()=>document.querySelector('#wall-family').value==='original'&&window.__mountain.state().view==='wall');
  assert.equal(await graphic(),initial);
  await page.getByRole('button',{name:'Ярусы и маршруты',exact:true}).click();
  await page.locator('#load-state').waitFor({state:'hidden'});
  await game().getByRole('button',{name:'Идти',exact:true}).waitFor();
  await page.locator('#route-seed').selectOption('7');
  await page.getByRole('button',{name:'Перед мостом',exact:true}).click();
  await page.locator('#load-state').waitFor({state:'hidden'});
  assert.equal(new URL(child().url()).searchParams.get('seed'),'7');
  assert.equal(new URL(child().url()).searchParams.get('start'),'bridge');
  await game().getByRole('button',{name:'Идти',exact:true}).click();
  await child().waitForFunction(()=>document.pointerLockElement?.id==='scene',{},{timeout:10000});
  await page.keyboard.down('w');
  await page.waitForTimeout(750);
  await page.keyboard.up('w');
  await child().evaluate(()=>document.exitPointerLock());
  await page.getByRole('button',{name:'Кадры и референсы',exact:true}).click();
  const item=page.getByRole('button',{name:'Подвесной мост · референсы'});
  await item.click();
  await page.locator('dialog[open] img').evaluate(img=>img.decode());
  await page.getByRole('button',{name:'Закрыть кадр'}).click();
  assert.equal(await page.locator('iframe').count(),0);
  console.log('PASS dashboard toggles, camera reset, route/seed, Pointer Lock and reference gallery');
  for(const start of ['den','rope','cave','bridge']) {
    await page.goto(base+'route.html?qa=1&seed=42&wall=rounded&start='+start,{waitUntil:'domcontentloaded'});
    const read=()=>page.evaluate(()=>window.__route.state());
    await page.waitForFunction(()=>window.__route?.ready);
    const initial=await read();
    if(start==='rope'){
      await page.keyboard.down('e');
      await page.evaluate(()=>window.__route.step(1));
      await page.keyboard.up('e');
      assert.equal((await read()).attached,true);
    }
    await page.keyboard.down('w');
    await page.evaluate(n=>window.__route.step(n), start==='cave'?1120:1600);
    await page.keyboard.up('w');
    const end=await read();
    if(start==='den')assert(end.z<22&&end.z>19&&end.y<1);
    if(start==='rope')assert(end.y>13);
    if(start==='cave')assert(end.y>21);
    if(start==='bridge')assert(end.x>90&&end.y>13);
    console.log(start,initial,end);
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
