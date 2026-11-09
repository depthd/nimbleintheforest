const assert = require('node:assert/strict'), path = require('node:path'), Module = require('node:module');
const { buildSync } = require('esbuild'), T = require('three');
const m = new Module(__filename);
m._compile(buildSync({entryPoints:[path.join(__dirname,'../src/game/startup-warmup.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['three']}).outputFiles[0].text,__filename);
(async()=>{
 const scene=new T.Scene(), camera=new T.PerspectiveCamera(72,1,.1,14000);
 camera.position.set(7,9,13);camera.rotation.set(.2,.3,0);camera.updateMatrixWorld(true);
 const position=camera.position.clone(),rotation=camera.quaternion.clone();
 const calls=[],messages=[];let fences=0,deleted=0;
 const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,WAIT_FAILED:4,fenceSync:()=>{fences++;return {}},flush(){},isContextLost:()=>false,clientWaitSync:()=>2,deleteSync(){deleted++}};
 const renderer={compileAsync:async(s,c)=>{assert.equal(s,scene);assert.equal(c,camera);calls.push('compile')},getContext:()=>gl,clear(){},render(s,c){assert.equal(s,scene);calls.push({p:c.position.clone(),q:c.quaternion.clone()})}};
 await m.exports.warmStartup(renderer,scene,camera,new T.Vector3(.5,3,0),s=>messages.push(s));
 assert.equal(calls[0],'compile');assert.equal(calls.length,7);assert.equal(fences,6);assert.equal(deleted,6);
 assert.deepEqual(camera.position,position);assert.ok(camera.quaternion.equals(rotation));
 assert.deepEqual(calls.at(-1),{p:position,q:rotation});assert.equal(scene.children.length,0);assert.equal(messages.length,7);
 gl.clientWaitSync=()=>{throw new Error('GPU failure')};
 await assert.rejects(()=>m.exports.warmStartup(renderer,scene,camera,new T.Vector3(),()=>{}),/GPU failure/);
 assert.equal(deleted,7);console.log('PASS compile before draws, six views, exact restored viewpoint, no scene/camera mutations, GPU fence cleanup on failure');
})().catch(e=>{console.error(e);process.exitCode=1});
