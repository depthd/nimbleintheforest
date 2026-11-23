const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const [origin='http://127.0.0.1:5184',out=path.join(__dirname,'wall-controls.json')]=process.argv.slice(2);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:800,height:450},deviceScaleFactor:1}), errors=[], checks={};
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/experiments/plateau/mountain.html?view=wall',{waitUntil:'domcontentloaded'});
  const family=page.locator('#wall-family'),preset=page.locator('#wall-preset'),seed=page.locator('#wall-seed');
  await page.locator('#status').filter({hasText:'Три яруса'}).waitFor({timeout:300000});
  async function pixels(){const buf=await page.locator('canvas').evaluate(c=>c.toDataURL('image/png').split(',')[1]);return crypto.createHash('sha256').update(Buffer.from(buf,'base64')).digest('hex');}
  const original=await pixels();assert.equal(await family.inputValue(),'original');
  await family.selectOption('rounded');await preset.selectOption('2');
  checks.rounded=await pixels();assert.notEqual(checks.rounded,original);
  await family.selectOption('angular');await preset.selectOption('1');
  await seed.fill('23011');await seed.press('Tab');checks.angular=await pixels();
  assert.notEqual(checks.angular,checks.rounded);
  const url=new URL(page.url());assert.equal(url.searchParams.get('seed'),'23011');assert.equal(url.searchParams.get('wall'),'angular');
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#status').filter({hasText:'Три яруса'}).waitFor({timeout:300000});
  assert.equal(await family.inputValue(),'angular');assert.equal(await preset.inputValue(),'1');assert.equal(await seed.inputValue(),'23011');
  assert.equal(await pixels(),checks.angular);
  await family.selectOption('original');assert.equal(await pixels(),original);assert.equal(await seed.isDisabled(),true);
  assert.deepEqual(errors,[]);fs.writeFileSync(out,JSON.stringify({original,...checks,restoredOriginal:true,sameAfterReload:true,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
