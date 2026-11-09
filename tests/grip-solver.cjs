const assert=require('node:assert/strict'),T=require('three'),{buildSync}=require('esbuild'),Module=require('node:module');
const m=new Module(__filename);m.paths=module.paths;m._compile(buildSync({entryPoints:['src/game/grip-solver.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['three']}).outputFiles[0].text,__filename);
const {fitGrip,socketWrist}=m.exports;
for(let k=0;k<600;k++){
 const rotation=new T.Quaternion().setFromEuler(new T.Euler(k*.13,k*.31,k*.07));
 const constraints=[-1,1].map(sign=>({shoulder:new T.Vector3(sign*.25,1.4,0),offset:new T.Vector3(sign*.07,0,0).applyQuaternion(rotation)}));
 const r=fitGrip(new T.Vector3(Math.sin(k)*2,1.6+Math.cos(k)*2,Math.cos(k*.3)*2),constraints);
 assert.ok(r.reachable,JSON.stringify(r));constraints.forEach(c=>assert.ok(r.position.clone().add(c.offset).distanceTo(c.shoulder)<.55202));
 const socket={position:new T.Vector3(.1,-.1,0),rotation};const w=socketWrist(socket,rotation);
 assert.ok(w.offset.clone().add(new T.Vector3(0,-.06,0).applyQuaternion(w.orientation)).distanceTo(socket.position.clone().applyQuaternion(rotation))<1e-10);
}
assert.equal(fitGrip(new T.Vector3(),[{shoulder:new T.Vector3(-2,0,0),offset:new T.Vector3()},{shoulder:new T.Vector3(2,0,0),offset:new T.Vector3()}]).reachable,false);
console.log('PASS 600 rigid two-hand reach fits and palm/wrist orientation conversions; impossible grips rejected');
