const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const out=process.argv[2]||'test-results/journal';fs.mkdirSync(out,{recursive:true});
 const {createServer}=await import('vite');const server=await createServer({server:{port:5193,strictPort:true,hmr:false,watch:null},logLevel:'error'});await server.listen();let browser;
 try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:800,height:600}}),errors=[];
 page.setDefaultTimeout(180000);
 page.on('pageerror',e=>{errors.push(e.message);console.error('PAGEERROR',e.message)});
 page.on('console',m=>{if(m.type()==='error') console.error('CONSOLE',m.text())});
 await page.goto('http://localhost:5193/?test=1&seed=42&hour=13&weather=clear&warmup=0');
 await page.waitForFunction(()=>window.__game,null,{timeout:300000});
 await page.evaluate(()=>{const g=window.__game;g.G.settings.noCold=true;g.G.settings.timeScale=0;g.G.renderer.setPixelRatio(.5);g.G.input.lock();g.G.paused=false;});
 await page.evaluate(async()=>{window.__journal=(await import('/src/game/journal/journal.ts')).journal});
 await page.keyboard.press('j');
 await page.waitForTimeout(200);await page.screenshot({path:path.join(out,'raise.png')});
 await page.waitForFunction(()=>window.__journal.progress===1);await page.screenshot({path:path.join(out,'held.png')});
 const state=await page.evaluate(()=>{const G=window.__game.G,h=G.player.avatar.hands;return {contacts:h.contacts,errors:h.gripErrors,mesh:!!G.scene.getObjectByName('Page_Left_Dynamic'),enabled:G.input.enabled};});
 console.log(state);assert.deepEqual(state.contacts,[true,true]);assert.ok(Math.max(...state.errors)<.002);assert.ok(state.mesh);assert.equal(state.enabled,false);
 const before=await page.evaluate(()=>{const g=window.__game.G;g.body.kcal=150;g.body.water=.1;g.body.fatigue=.9;g.body.frostHands=.8;g.body.wetness=.75;g.body.condition=30;g.player.stamina=.2;return g.player.pos.toArray();});
 await page.waitForTimeout(400);await page.screenshot({path:path.join(out,'depleted.png')});
 await page.keyboard.down('w');await page.waitForTimeout(300);await page.keyboard.up('w');
 const after=await page.evaluate(()=>window.__game.G.player.pos.toArray());assert.ok(Math.hypot(after[0]-before[0],after[2]-before[2])<.01);
 for(const pitch of [-1.1,.7]){
 await page.evaluate(p=>{window.__game.G.player.pitch=p;},pitch);await page.waitForTimeout(400);await page.screenshot({path:path.join(out,`pitch-${pitch}.png`)});
 const h=await page.evaluate(()=>window.__game.G.player.avatar.hands.diagnostics());assert.deepEqual(h.contacts,[true,true]);assert.ok(Math.max(...h.gripErrors)<.002);
 }
 await page.evaluate(()=>{window.__game.G.player.pitch=0});await page.keyboard.press('j');await page.waitForFunction(()=>!window.__journal.active);
 assert.equal(await page.evaluate(()=>window.__game.G.input.enabled),true);
 await page.keyboard.press('j');await page.waitForFunction(()=>window.__journal.progress===1);await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.__journal.active);
 assert.equal(await page.evaluate(()=>window.__game.G.input.enabled),true);
 await page.setViewportSize({width:700,height:900});await page.keyboard.press('j');await page.waitForFunction(()=>window.__journal.progress===1);await page.screenshot({path:path.join(out,'portrait.png')});
 assert.deepEqual(errors,[]);console.log('PASS journal both grips, lifecycle, input isolation, pitch extremes; screenshots saved');
 }finally{await browser?.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
