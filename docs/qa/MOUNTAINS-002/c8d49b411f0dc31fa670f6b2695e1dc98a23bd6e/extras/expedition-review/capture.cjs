const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {chromium} = require('playwright');
const root = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
const port = Number(process.argv[4] || 5225);
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const {createServer}=await import('/workspace/work/mountains-connected/node_modules/vite/dist/node/index.js');
 const server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port,strictPort:true,hmr:false,fs:{allow:['/workspace/work']}},logLevel:'error'});
 await server.listen();
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/experiments/mountains/?seed=42`);
  await page.waitForFunction(()=>window.__mountains?.ready,null,{timeout:180000});
  await page.evaluate(()=>{window.__mountains.manual(true);document.querySelector('#panel').style.display='none';document.querySelector('#status').style.display='none';});
  const manifest={root,renderer:'Chromium ANGLE SwiftShader',viewport:[1280,800],files:{},shots:[],errors};
  for(const f of fs.readdirSync(path.join(root,'experiments/mountains')).filter(x=>/\.(ts|html|css)$/.test(x)))manifest.files[f]=createHash('sha256').update(fs.readFileSync(path.join(root,'experiments/mountains',f))).digest('hex');
  const shot=async(name)=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:path.join(out,name+'.png'),timeout:120000});console.log(name);};
  for(const id of ['lower','reveal','upper','cirque','shoulder','saddle','summit','overview']) {
   for(const layer of ['clay','full']){
    await page.evaluate(({id,layer})=>{const m=window.__mountains;m.view(id);m.layers(layer);},{id,layer});
    manifest.shots.push({name:`42-${id}-${layer}`,view:id,layer,foot:await page.evaluate(()=>window.__mountains.position)});
    await shot(`42-${id}-${layer}`);
   }
  }
  for(const fraction of [0.1,0.35,0.6,0.85])for(const layer of ['clay','full']){
   const pose=await page.evaluate(({fraction,layer})=>{
    const m=window.__mountains;const r=m.land.worldRoute(m.land.routes.find(r=>r.id==='high'));
    const i=Math.floor((r.length-1)*fraction);const p=r[i],q=r[Math.min(r.length-1,i+5)];
    const eye={x:p.x,y:m.supportAt(p.x,p.z)+1.8,z:p.z};
    const target={x:q.x,y:m.supportAt(q.x,q.z)+1.8,z:q.z};m.cameraAt(eye,target);m.layers(layer);return {eye,target};
   },{fraction,layer});
   const name=`42-high-${Math.round(fraction*100)}-${layer}`;manifest.shots.push({name,route:'high',fraction,layer,...pose});await shot(name);
  }
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
 } finally {await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
