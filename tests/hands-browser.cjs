const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
 const { createServer } = await import('vite');
 const server = await createServer({server:{port:5213,host:'127.0.0.1',hmr:false},logLevel:'error'});
 let browser; const errors=[]; const out=process.env.HANDS_OUT || 'test-results/hands'; fs.mkdirSync(out,{recursive:true});
 try {
 await server.listen(); browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1100,height:760}}); page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});
 await page.goto('http://127.0.0.1:5213/?test=1&seed=42&hour=13&weather=clear&nocold=1&scale=0');
 await page.waitForFunction(()=>window.__game?.G.player.avatar.survivor,null,{timeout:180000});
 await page.evaluate(()=>{const g=window.__game;g.setManualStepping(true); const G=g.G,T=g.THREE; G.input.enabled=true; const y=G.terrain.heightAt(40,40)+40;const b=G.world.createRigidBody(G.R.RigidBodyDesc.fixed());G.world.createCollider(G.R.ColliderDesc.cuboid(10,0.1,10).setTranslation(40,y-0.1,40),b);g.teleport(40,y,40);g.steps(15); for(const c of G.scene.children)if(c!==G.player.avatar.root&&c.name!=='held-equipment')c.visible=false;G.scene.background=new T.Color('#76838c');G.scene.add(new T.HemisphereLight(0xffffff,0x555555,2)); const floor=new T.Mesh(new T.BoxGeometry(20,0.1,20),new T.MeshStandardMaterial({color:0xb5bec5}));floor.position.set(40,y-0.05,40);G.scene.add(floor); G.player.pitch=0.05;G.player.yaw=0; G.player.avatar.hands.cancel();});
 const capture=async(name)=>{await page.waitForTimeout(150);await page.screenshot({path:path.join(out,name+'.png'),timeout:180000});};
 await capture('01-idle');
 const state=()=>page.evaluate(()=>window.__game.G.player.avatar.hands.diagnostics());
 console.log('initial',await state());
 for (const kind of ['airborne','brush','walk','run','crouch','warm','carry','hold','chop','saw','dig','pour','reach','work','eat','drink','ignite','throw']) {
 await page.evaluate(kind=>{const {G,THREE:T}=window.__game;const p=G.player;p.grounded=kind!=='airborne';p.moving=kind==='walk'||kind==='run';p.sprinting=kind==='run';p.crouch=kind==='crouch'||kind==='dig';p.handsWarming=kind==='warm';G.input.keys.clear();if(kind==='warm')G.input.keys.add('KeyH');p.carried=null;p.equipped=null;G.interact.timed=null;G.interact.swinging=null;p.avatar.hands.cancel();
 if(kind==='hold'||kind==='chop'||kind==='saw'){const e=G.entities.spawnItem(kind==='saw'?'saw':'axe',new T.Vector3(0,-20,0));p.addToInventory(e);p.equipped=e;p.avatar.hands.cancel();}
 if(kind==='carry'){const e=G.entities.spawnItem('log',p.pos.clone().add(new T.Vector3(0,1,-0.5)));p.carry(e);p.avatar.hands.cancel();}
 if(['chop','saw'].includes(kind))G.interact.swinging={tool:p.equipped,t:0.22,dur:0.6,hit:false};
 if(['brush','dig','pour','reach','work','eat','drink','ignite','throw'].includes(kind))p.avatar.hands.begin(kind,0.6);
 G.paused=false;p.avatar.hands.update(0.25,p.avatar.arms);G.paused=true;
 },kind);
 const s=await state();assert.equal(s.state,kind,JSON.stringify(s));assert.ok(s.palms.flat().every(Number.isFinite));
 await capture(kind); const error=await page.evaluate(()=>{const {G,THREE:T}=window.__game;const a=G.player.avatar;return Math.max(...['L','R'].map((side,i)=>a.survivor.model.getObjectByName('Hand'+side).getWorldPosition(new T.Vector3()).distanceTo(a.arms[i].wrist)));}); assert.ok(error<0.0001,'Skin wrist/IK mismatch '+error); console.log('PASS',kind);
 }
 await page.evaluate(()=>{const {G}=window.__game; G.player.equipped=null;G.player.carried=null; G.player.handsWarming=false;G.input.keys.clear();G.player.avatar.inspectionView=2;});await capture('third-person');
 assert.deepEqual(errors,[]); console.log('PASS browser errors, all hand modes, actual skinned avatar');
 } finally {await browser?.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
