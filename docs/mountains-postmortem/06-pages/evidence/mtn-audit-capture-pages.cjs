const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const out = process.argv[2];
const base = 'https://depthd.github.io/nimbleintheforest/test/experiments/plateau/review.html';
(async () => {
  const browser = await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage({viewport:{width:1160,height:820},ignoreHTTPSErrors:true});
    const errors=[];
    const captures=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
    const scenes = [
      ['01-wall-original',''],
      ['02-wall-angular','?wall=angular&preset=1&seed=42'],
      ['03-route-overview','?tab=route&seed=8191'],
      ['04-den','?tab=route&start=den'],
      ['05-rope','?tab=route&start=rope'],
      ['06-cave','?tab=route&start=cave'],
      ['07-bridge','?tab=route&start=bridge'],
      ['08-gallery','?tab=refs'],
    ];
    fs.mkdirSync(out,{recursive:true});
    for (const [name,query] of scenes){
      await page.goto(base+query,{waitUntil:'domcontentloaded'});
      await page.locator('#load-state').waitFor({state:'hidden',timeout:180000});
      if(query.includes('refs'))await page.locator('#gallery img').first().evaluate(i=>i.decode());
      await page.screenshot({path:path.join(out,name+'.jpg'),type:'jpeg',quality:88, fullPage:query.includes('refs')});
      const frame=page.frames().find(f=>f.parentFrame()===page.mainFrame());
      captures.push({file:name+'.jpg',url:page.url(),scene:frame?.url()??null});
      console.log(name);
    }
    fs.writeFileSync(path.join(out,'captures.json'),JSON.stringify({viewport:[1160,820],captures,errors},null,2));
    if(errors.length)process.exitCode=1;
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
