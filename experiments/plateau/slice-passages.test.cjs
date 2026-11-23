'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Module } = require('node:module');
const { buildSync } = require('esbuild');
const R = require('@dimforge/rapier3d-compat');

function source(name) {
  const bundle = buildSync({ entryPoints:[name], bundle:true,platform:'node',format:'cjs',write:false });
  const record = new Module(name,module);
  record._compile(bundle.outputFiles[0].text,name);
  return record.exports;
}
const terrainModule = process.env.SLICE_TERRAIN || path.join(__dirname,'slice-terrain.ts');
const {generateSliceTerrain} = source(terrainModule);
const {buildSlicePassages} = source(path.join(__dirname,'slice-passages.ts'));
const {createSliceRopeState,stepSliceRope,distance} = source(path.join(__dirname,'slice-passages-rope.ts'));
const pt=(x,y,z)=>({x,y,z});
const seeds=(process.env.SEEDS||'42,7,8191,23011').split(',').map(Number);
const hash = p => {
  const h=createHash('sha256');
  for(const s of p.surfaces) { h.update(Buffer.from(s.positions.buffer));h.update(Buffer.from(s.indices.buffer)); }
  return h.digest('hex');
};

function check(seed) {
  const terrain=generateSliceTerrain(seed,{passages:true});
  const passages=buildSlicePassages(terrain.passageAnchors,seed);
  assert.equal(hash(passages),hash(buildSlicePassages(generateSliceTerrain(seed,{passages:true}).passageAnchors,seed)));
  const physics=new R.World(pt(0,-9.81,0)), names=new Map();
  const collider=(desc,name)=>{const c=physics.createCollider(desc);names.set(c.handle,name);return c;};
  collider(R.ColliderDesc.cuboid(180,1,90).setTranslation(37,-1,0),'ground');
  for(const [name,g] of [['host-rock',terrain.rock],['host-top',terrain.snow],...passages.surfaces.filter(s=>s.collider).map(s=>[s.name,s])])
    collider(R.ColliderDesc.trimesh(g.positions,g.indices),name);
  for(const t of terrain.trees) collider(R.ColliderDesc.cylinder(t.height/2,t.radius).setTranslation(t.x,t.y+t.height/2,t.z),'tree');
  const spawn=terrain.spawn;
  const b=physics.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x,spawn.y+.94,spawn.z));
  const body=physics.createCollider(R.ColliderDesc.capsule(.6,.3),b), kcc=physics.createCharacterController(.03);
  kcc.setMaxSlopeClimbAngle(48*Math.PI/180);kcc.setMinSlopeSlideAngle(55*Math.PI/180);
  kcc.enableAutostep(.32,.15,false);kcc.enableSnapToGround(.35);
  let ticks=0, vY=0;
  const feet=()=>{const v=b.translation();return pt(v.x,v.y-.9,v.z);};
  function step(d) {
    kcc.computeColliderMovement(body,d);
    const v=b.translation(), m=kcc.computedMovement();
    b.setNextKinematicTranslation(pt(v.x+m.x,v.y+m.y,v.z+m.z));physics.step();
    ticks++;
  }
  function walk(target) {
    for(let i=0;i<5000;i++) {
      const p=feet(), dx=target.x-p.x,dz=target.z-p.z,l=Math.hypot(dx,dz);
      if(l<.13 && Math.abs(p.y-target.y)<.31)return;
      const s=Math.min(l,4.35/60)/Math.max(l,1e-9);
      vY=Math.max(-18,vY-9.81/60);
      step(pt(dx*s,vY/60,dz*s));
      if(kcc.computedGrounded())vY=0;
    }
    throw new Error(JSON.stringify({seed,target,feet:feet(),ticks}));
  }
  const trace={};
  physics.step();
  // The entire route starts at the world spawn. Never move the rigid body to a waypoint.
  for(const q of [pt(-66,0,40),pt(15,0,40),...passages.routes.den])walk(q);
  for(let i=0;i<200;i++)step(pt(0,-.04,-.1));
  trace.denStop=feet();assert(trace.denStop.z>19.99 && trace.denStop.z<20.4);
  for(const q of [...passages.routes.den].reverse())walk(q);
  const {rope}=passages;
  for(const q of [pt(15,0,40),pt(rope.lower.x,0,40),rope.lower])walk(q);
  function ride(sign) {
    let state=createSliceRopeState();
    for(let i=0;i<1600;i++){
      const result=stepSliceRope(rope,state,feet(),{interact:i===0,climb:sign},1/60);
      state=result.state;
      if(!state.attached){assert(i>200);return;}
      step(result.displacement);
    }
    throw new Error('rope stuck '+JSON.stringify(feet()));
  }
  ride(1);trace.ropeTop=feet();
  assert(distance(feet(),rope.upper)<.18);
  const lo=terrain.passageAnchors.throughLower, high=terrain.passageAnchors.throughUpper;
  for(const q of [pt(12,14,rope.upper.z),pt(17,14,23),...passages.routes.through])walk(q);
  trace.upperExit=feet();assert(Math.abs(trace.upperExit.y-high.y)<.15);
  for(const q of [...passages.routes.through].reverse())walk(q);
  trace.lowerExit=feet();assert(Math.abs(trace.lowerExit.y-lo.y)<.15);
  for(const q of [pt(17,14,23),pt(12,14,rope.upper.z),rope.upper])walk(q);
  ride(-1);trace.ropeBottom=feet();
  assert(distance(feet(),rope.lower)<.18);
  function ray(p,d,max) {
    const hit=physics.castRay(new R.Ray(p,d),max,true,undefined,undefined,body);
    return hit?{name:names.get(hit.collider.handle),distance:hit.timeOfImpact}:null;
  }
  const den=ray(pt(15,1,25),pt(0,1,0),13);
  const denTop=ray(pt(15,17,25),pt(0,-1,0),5);
  const back=ray(pt(15,1,24),pt(0,0,-1),9);
  const ex=ray(pt(17,25,-7),pt(0,-1,0),8);
  assert(den?.name==='passage-rock'&&den.distance>1.7);
  assert.equal(denTop?.name,'host-top');
  assert(back?.name==='passage-rock' && Math.abs(back.distance-4)<.03);
  assert.equal(ex?.name,'passage-floor');
  physics.free();
  return {seed,meshHash:hash(passages),ticks,trace,denCeiling:den,retainedRoof:denTop,deadEnd:back,throughOpening:ex,
    triangles:Object.fromEntries(passages.surfaces.map(s=>[s.name,s.indices.length/3]))};
}
R.init().then(()=>{console.log(JSON.stringify({method:'continuous Rapier KCC from spawn, scripted directional intent and rope E/W/S',reports:seeds.map(check)},null,2));})
.catch(e=>{console.error(e);process.exitCode=1;});
