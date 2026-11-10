const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium,request}=require('playwright');
const root='/workspace/work/mountains-test-preview',out=process.argv[3]||'/workspace/work/mountains-test-release/local',expected=process.env.SOURCE_SHA||'9b9da8615b1e6b1c572dd5b42f16e4535aebe932';
(async()=>{
 fs.mkdirSync(out,{recursive:true});let server;const base=process.argv[2]||'http://127.0.0.1:5261/test/';
 if(!process.argv[2]){server=http.createServer((req,res)=>{let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(!name.startsWith('/test/')){res.writeHead(404).end();return;}let file=path.join(root,'dist',name.slice(6));if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)){res.writeHead(404).end();return;}const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.ttf':'font/ttf','.glb':'model/gltf-binary','.png':'image/png'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type});fs.createReadStream(file).pipe(res)});await new Promise(r=>server.listen(5261,'127.0.0.1',r));}
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1100,height:800}});let verifiedHttp;if(base.startsWith('https:')){verifiedHttp=await request.newContext({proxy:{server:process.env.HTTPS_PROXY||process.env.HTTP_PROXY}});await context.route('https://depthd.github.io/**',async route=>{await route.fulfill({response:await verifiedHttp.fetch(route.request())})});} const report={source:expected,base,transport:verifiedHttp?'Published HTTPS assets fetched through inherited proxy with TLS verification, then rendered in Chromium':'local HTTP',errors:[],responses:[],checks:[]}; const record=report.checks.push.bind(report.checks);report.checks.push=value=>{console.log('CHECK',JSON.stringify(value));return record(value)};
 try{
 const page=await context.newPage();page.setDefaultTimeout(180000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))report.responses.push({url:r.url(),status:r.status()})});
 await page.goto(base);await page.locator('#st-go').waitFor({state:'visible'});
 assert.ok((await page.locator('#start .build-info').getAttribute('title'))===expected);
 await page.screenshot({path:path.join(out,'start.png')});
 await page.getByRole('link',{name:'Исследовать новые горы',exact:true}).click();
 await page.waitForFunction(()=>window.__mountains?.ready);
 assert.ok(page.url().includes('/test/experiments/mountains/'));
 await page.evaluate(()=>window.__mountains.manual(true));
 const state=await page.evaluate(()=>({seed:window.__mountains.land.seed,version:window.__mountains.land.plan.version,regions:window.__mountains.land.regions.length,verified:window.__mountains.land.verification.status,stats:window.__mountains.stats}));
 assert.equal(state.version,'branching-uplands-1');assert.equal(state.verified,'terrain-verified');assert.equal(state.seed,42);report.checks.push({entry:state});
 await page.getByRole('button',{name:'Идти по миру',exact:true}).click();await page.waitForFunction(()=>document.pointerLockElement!==null);
 const before=await page.evaluate(()=>window.__mountains.position);
 await page.keyboard.down('w');await page.evaluate(()=>window.__mountains.steps(180));await page.keyboard.up('w');await page.evaluate(()=>window.__mountains.steps(20));
 const move=await page.evaluate(b=>{const m=window.__mountains,p=m.position;return{distance:Math.hypot(p.x-b.x,p.z-b.z),grounded:m.grounded,fly:m.fly}},before);
 report.checks.push({walking:move});assert.ok(move.distance>2&&move.distance<8&&move.grounded&&!move.fly,JSON.stringify(move));await page.screenshot({path:path.join(out,'walking.png')});
 await page.evaluate(()=>document.exitPointerLock());
 await page.locator('#seed').fill('7');await page.locator('#generate').click();await page.waitForFunction(()=>window.__mountains?.ready&&window.__mountains.land.seed===7);
 await page.locator('[data-view="upper"]').click();await page.screenshot({path:path.join(out,'upper-seed-7.png')});report.checks.push({regenerated:7});
 const planUrl=await page.getByRole('link',{name:'план живых районов',exact:true}).getAttribute('href');
 const crossUrl=await page.getByRole('link',{name:'пересечение высот и пещера в склоне',exact:true}).getAttribute('href');
 for(const target of [planUrl,crossUrl]){const url=new URL(target,page.url()).href;const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));const response=await p.goto(url);assert.equal(response.status(),200);if(target.includes('crossing'))await p.waitForFunction(()=>window.__crossing?.ready,null,{timeout:180000});else await p.waitForFunction(()=>document.body.dataset.ready==='true');await p.close();report.checks.push({linkedPage:url,status:200});}
 await page.getByRole('link',{name:'К тестовой игре',exact:true}).click();await page.locator('#st-go').waitFor({state:'visible'});assert.equal(new URL(page.url()).pathname,'/nimbleintheforest/test/'===new URL(base).pathname?'/nimbleintheforest/test/':'/test/');report.checks.push({returnToGame:true});
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>0});
 await page.goto(base+'?test=1&seed=42&hour=13&weather=clear&warmup=0');await page.waitForFunction(()=>window.__game||document.querySelector('#loading pre'),null,{timeout:300000,polling:100});
 const game=await page.evaluate(()=>{if(!window.__game)throw Error(document.querySelector('#loading pre')?.textContent||'game startup failed');const G=window.__game.G;return{player:!!G.player,trees:G.region.trees.x.length,normalGame:true}});assert.ok(game.player&&game.trees>0);report.checks.push(game);
 const model=await (verifiedHttp||page.request).get(base+'models/conifer_c1.glb');assert.equal(model.status(),200);report.checks.push({c1Asset:crypto.createHash('sha256').update(await model.body()).digest('hex')});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.responses,[]);report.result='PASS';
 }finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();if(verifiedHttp)await verifiedHttp.dispose();if(server)await new Promise(r=>server.close(r));}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
