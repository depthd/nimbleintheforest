const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(process.argv[2]||__dirname),base=process.env.WEDGE_URL||'http://127.0.0.1:5237/experiments/plateau/wedge-ascent.html',sourceSHA='eae3f09438b52182ae9c948398ef3b5244a3e65b';
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],shots=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'?kind=relief',{timeout:180000});await page.waitForFunction(()=>window.__wedgeAscent?.ready,null,{timeout:180000});
 assert.equal(await page.locator('.build-info').getAttribute('title'),sourceSHA);
 const before=await page.evaluate(()=>Object.fromEntries(Object.entries(window.__wedgeAscent.junction.cut).map(([k,m])=>[k,m.indices.length])));
 await page.evaluate(()=>{document.querySelector('aside').style.display='none';const c=document.createElement('div');c.id='caption';Object.assign(c.style,{position:'fixed',left:'16px',bottom:'16px',padding:'9px 14px',background:'#14232de8',color:'white',borderRadius:'7px',font:'15px system-ui'});document.body.append(c)});
 for(const rocks of [true,false])for(const view of (rocks?['general','side','detail','front','inside']:['general','side','detail'])){
  await page.evaluate(({rocks,view})=>{const s=window.__wedgeAscent;s.setRocks(rocks);s.view(view);const names={general:'Общий вид',side:'Сбоку',detail:'Примыкание вблизи',front:'Спереди',inside:'Из прохода'};document.getElementById('caption').textContent=(rocks?'Со скалами':'Без облицовки')+' · '+names[view]+' · eae3f09'},{rocks,view});
  assert.equal(await page.evaluate(()=>window.__wedgeAscent.rockGroup.visible),rocks);
  const file=(rocks?'rocks-':'bare-')+view+'.png';await page.screenshot({path:path.join(out,file)});shots.push(file);console.log(file);
 }
 const after=await page.evaluate(()=>Object.fromEntries(Object.entries(window.__wedgeAscent.junction.cut).map(([k,m])=>[k,m.indices.length])));assert.deepEqual(after,before);
 const stats=await page.evaluate(()=>window.__wedgeAscent.dressing.stats);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify({result:'PASS',sourceSHA,acceptedBaseSHA:'c56fb97f6026215fa77719697f6fea644ea7ccb5',backend:'Chromium / SwiftShader',delivery:'local Vite preview of the built source SHA',errors,shots,stats,bareToggleWorks:true,baseSurfaceCountsUnchanged:true,physicsPlayerTested:false,deployed:false},null,2)+'\n');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
