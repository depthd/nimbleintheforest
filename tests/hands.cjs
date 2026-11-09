const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const T = require('three');
const code = buildSync({ entryPoints:['src/game/hands.ts'], bundle:true, platform:'node',format:'cjs',write:false,external:['three'] }).outputFiles[0].text;
const m = new Module(__filename);m.paths=module.paths;m._compile(code,__filename);
const {solveArm,actionFor,handGrips}=m.exports;
for(let i=0;i<500;i++) {
 const s=new T.Vector3(Math.sin(i),i*0.01,0), t=new T.Vector3(Math.cos(i)*2,Math.sin(i*3),Math.cos(i*4));
 const r=solveArm(s,t,new T.Vector3(1,-0.4,0.35));
 assert.ok(Math.abs(r.elbow.distanceTo(s)-0.29)<1e-9);
 assert.ok(Math.abs(r.wrist.distanceTo(r.elbow)-0.27)<1e-9);
 assert.ok(r.wrist.distanceTo(s)<=0.56);
}
for(const t of [new T.Vector3(),new T.Vector3(1,0,0),new T.Vector3(0,-1,0)])assert.ok(solveArm(new T.Vector3(),t,t.clone()).elbow.toArray().every(Number.isFinite));
assert.equal(actionFor('Отряхнуть снег'),'brush');assert.equal(actionFor('Разгрести снег'),'dig');assert.equal(actionFor('Высыпать снег'),'pour');assert.equal(actionFor('Съесть снег'),'eat');assert.equal(actionFor('Зажечь спичку'),'ignite');
assert.ok(handGrips.axe.left);assert.ok(!handGrips.knife.left);
console.log('PASS 503 arm reach/singular cases, action routing and one/two hand grip contracts');
