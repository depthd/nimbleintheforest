// Fixed survey cameras for comparing the release views to the paths walked by Player.
const {chromium}=require('playwright');
const {mkdirSync}=require('node:fs');
const path=require('node:path');
const [origin='http://127.0.0.1:5184',dir=path.join(__dirname,'release-views')]=process.argv.slice(2);
const shots=[
  ['den',[14,2.7,45],[15,1.85,25]],
  ['rope',[-2,17.6,37],[-4,12.5,34.4]],
  ['bridge',[72,14.5,30],[75,12.9,0]],
];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:960,height:540},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/experiments/plateau/route.html?seed=42&wall=rounded&qa=1');
  await page.waitForFunction(()=>window.__route?.ready);
  await page.addStyleTag({content:'header,footer{display:none}'});
  mkdirSync(dir,{recursive:true});
  for(const [name,eye,target] of shots){
   await page.evaluate(([eye,target])=>window.__route.survey(eye,target),[eye,target]);
   await page.locator('canvas').screenshot({path:path.join(dir,name+'.jpg'),quality:93});
  }
  if(errors.length)throw Error(errors.join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
