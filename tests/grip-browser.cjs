const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
(async()=>{
 const {createServer}=await import('vite');const server=await createServer({server:{port:5214,hmr:false},logLevel:'error'});let browser;
 try {await server.listen();browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const page=await browser.newPage({viewport:{width:960,height:640}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5214/?test=1&seed=42&nocold=1&scale=0&hour=13');await page.waitForFunction(()=>window.__game?.G.player.avatar.survivor,null,{timeout:180000});
 const result=await page.evaluate(async()=>{
 const {G,THREE:T}=window.__game;const {handGrips}=await import('/src/game/hands.ts');
 G.paused=true;const p=G.player;G.input.keys.clear();p.handsWarming=false;p.carried=null;G.interact.timed=null;G.interact.swinging=null;
 let maxGap=0,maxAngle=0,maxWrist=0,maxVisual=0,samples=0;
 for(const id of ['axe','saw','knife','shovel','journal-fixture']){
 const old=handGrips[id];if(id==='journal-fixture')handGrips[id]={right:new T.Vector3(),rotation:new T.Euler(),sockets:{right:{position:new T.Vector3(.12,0,0),rotation:new T.Quaternion().setFromEuler(new T.Euler(Math.PI/2,0,0))},left:{position:new T.Vector3(-.12,0,0),rotation:new T.Quaternion().setFromEuler(new T.Euler(Math.PI/2,0,0))}},createVisual:()=>new T.Group(),samplePose:({position,rotation,phase})=>{position.add(new T.Vector3(0,.02,0));rotation.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),phase*.3));}};
 const e=G.entities.spawnItem(id==='journal-fixture'?'knife':id,new T.Vector3(0,-50,0));if(id==='journal-fixture')e.defId=id;p.equipped=e;p.avatar.hands.cancel();
 const profile=handGrips[id];
 for(let k=0;k<90;k++){
 p.yaw=k*.25;p.pitch=Math.sin(k*.31)*1.3;p.moving=true;p.sprinting=k%2===0;p.crouch=k%3===0;
 if(k%4===0)G.interact.swinging={tool:e,t:(k%17)/17*.6,dur:.6,hit:false};else G.interact.swinging=null;
 p.updateCamera([1/120,1/30,1/60][k%3]);G.vm.update(1/60);
 const h=p.avatar.hands;
 for(let i=0;i<2;i++){
 if(!h.contacts[i]){if(i===1)throw Error('primary grip released: '+id);continue;}
 const socket=profile.sockets?.[i?'right':'left'];const point=socket?.position??(i?profile.right:profile.left);
 const target=point.clone().applyQuaternion(h.item.quaternion).add(h.item.position);
 maxGap=Math.max(maxGap,h.palms[i].position.distanceTo(target));
 const expected=socket? h.item.quaternion.clone().multiply(socket.rotation):h.item.quaternion.clone().multiply(new T.Quaternion().setFromEuler(profile.rotation).invert()).multiply(new T.Quaternion().setFromEuler(new T.Euler(Math.PI/2,0,(i?1:-1)*.12)));
 maxAngle=Math.max(maxAngle,h.palms[i].quaternion.angleTo(expected));
 const bone=p.avatar.survivor.model.getObjectByName('Hand'+(i?'R':'L'));maxWrist=Math.max(maxWrist,bone.getWorldPosition(new T.Vector3()).distanceTo(p.avatar.arms[i].wrist));
 }
 maxVisual=Math.max(maxVisual,G.scene.getObjectByName('held-equipment').position.distanceTo(h.item.position));samples++;
 }
 if(old)handGrips[id]=old;else delete handGrips[id];
 }
 G.interact.swinging=null;p.equipped=null;p.yaw=0;p.pitch=0;p.updateCamera(1/60);
 const object=G.entities.spawnItem('knife',G.camera.position.clone().add(new T.Vector3(0,-.3,-.35)));p.carry(object);
 const base=object.position().clone();let carryContacts=0,carryGap=0;
 for(let k=0;k<40;k++){
 object.body.setTranslation(base.clone().add(new T.Vector3(Math.sin(k)*.015,0,0)),true);
 object.body.setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),k*.05),true);G.entities.sync();p.updateCamera(1/60);
 const h=p.avatar.hands;
 for(let i=0;i<2;i++)if(h.contacts[i]){carryContacts++;carryGap=Math.max(carryGap,h.palms[i].position.distanceTo(object.obj.localToWorld(h.carrySockets[i].position.clone())));}
 }
 if(carryContacts<40||carryGap>1e-4)throw Error('carry contacts '+carryContacts+' gap '+carryGap);
 object.body.setTranslation(base.clone().add(new T.Vector3(5,0,0)),true);G.entities.sync();const before=object.position().clone();G.paused=false;
 for(let k=0;k<8;k++)p.avatar.renderHands(.1);G.paused=true;
 if(!p.avatar.hands.carryLost||p.avatar.hands.contacts.some(Boolean)||before.distanceTo(object.position())>1e-8)throw Error('unreachable physical grasp not released explicitly');
 p.carried=null;return {maxGap,maxAngle,maxWrist,maxVisual,samples,carryContacts,carryGap};});
 assert.ok(result.maxGap<.0001,JSON.stringify(result));assert.ok(result.maxAngle<.0001,JSON.stringify(result));assert.ok(result.maxWrist<.0001,JSON.stringify(result));assert.equal(result.maxVisual,0);
 const live=await page.evaluate(async()=>{
 const {G,THREE:T}=window.__game;const {handGrips}=await import('/src/game/hands.ts');const p=G.player;
 p.equipped=G.entities.spawnItem('axe',new T.Vector3(0,-50,0));p.avatar.hands.cancel();G.paused=false;let gap=0;
 for(let k=0;k<16;k++){
 p.yaw+=.2;p.pitch=Math.sin(k)*.8;
 await new Promise(requestAnimationFrame);
 const h=p.avatar.hands,profile=handGrips.axe;
 for(let i=0;i<2;i++)if(h.contacts[i])gap=Math.max(gap,h.palms[i].position.distanceTo((i?profile.right:profile.left).clone().applyQuaternion(h.item.quaternion).add(h.item.position)));
 }
 G.paused=true;return gap;
 });assert.ok(live<.0001,'live render-loop grip gap '+live);console.log('PASS live frame order, grip gap',live);
 assert.deepEqual(errors,[]);console.log('PASS rigid grips across same-frame turns, pitch, stance, framerate and replaceable model/pose provider',result);
 }finally{await browser?.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
