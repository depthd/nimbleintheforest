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
 console.log(state);assert.deepEqual(state.contacts,[true,true]);assert.ok(Math.max(...state.errors)<.002);assert.ok(state.mesh);assert.equal(state.enabled,true);
 const before=await page.evaluate(()=>window.__game.G.player.pos.toArray());
 await page.keyboard.down('w');
 await page.waitForFunction(b=>{const p=window.__game.G.player.pos;return Math.hypot(p.x-b[0],p.z-b[2])>.25},before);
 await page.screenshot({path:path.join(out,'walking.png')});
 const yaw=await page.evaluate(()=>{const G=window.__game.G;G.input.mouseDX=50;G.input.mouseDY=10;return G.player.yaw});
 await page.waitForFunction(y=>window.__game.G.player.yaw!==y,yaw);
 await page.keyboard.down('Shift');
 await page.waitForFunction(()=>window.__game.G.player.sprinting && window.__journal.sprintLower>.9);
 await page.screenshot({path:path.join(out,'sprint.png')});
 await page.keyboard.up('Shift');await page.keyboard.up('w');
 await page.waitForFunction(()=>!window.__game.G.player.sprinting && window.__journal.sprintLower<.01);
 await page.screenshot({path:path.join(out,'returned.png')});
 await page.mouse.click(400,300);
 assert.equal(await page.evaluate(()=>!!window.__game.G.interact.swinging || !!window.__game.G.interact.timed),false);
 for(const pitch of [-1.1,.7]){
 await page.evaluate(p=>{window.__game.G.player.pitch=p;},pitch);await page.waitForTimeout(400);await page.screenshot({path:path.join(out,`pitch-${pitch}.png`)});
 const h=await page.evaluate(()=>window.__game.G.player.avatar.hands.diagnostics());assert.deepEqual(h.contacts,[true,true]);assert.ok(Math.max(...h.gripErrors)<.002);
 }
 await page.evaluate(()=>{window.__game.G.player.pitch=0});await page.keyboard.press('j');await page.waitForFunction(()=>!window.__journal.active);
 assert.equal(await page.evaluate(()=>window.__game.G.input.enabled),true);
 await page.keyboard.press('j');await page.waitForFunction(()=>window.__journal.progress===1);await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.__journal.active);
 assert.equal(await page.evaluate(()=>window.__game.G.input.enabled),true);
 await page.setViewportSize({width:700,height:900});await page.keyboard.press('j');await page.waitForFunction(()=>window.__journal.progress===1);await page.screenshot({path:path.join(out,'portrait.png')});
 assert.deepEqual(errors,[]);console.log('PASS journal walk/look, sprint lowering/return, both grips, lifecycle, pitch extremes; screenshots saved');
 }finally{await browser?.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
