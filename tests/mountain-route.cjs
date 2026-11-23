// Traverse the actual mountain meshes with the same Rapier capsule and climb constraints as the player.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Module } = require('node:module');
const { buildSync } = require('esbuild');
const R = require('@dimforge/rapier3d-compat');

function source(name) {
  const entry = path.join(__dirname, '../src/world/mountains', name + '.ts');
  const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false });
  const record = new Module(entry, module);
  record._compile(bundle.outputFiles[0].text, entry);
  return record.exports;
}
const { generateMountainTerrain } = source('terrain');
const { planMountainBridge } = source('bridge');
const { buildMountainPassages } = source('passages');
const { createMountainRopeState, stepMountainRope, distance } = source('rope');
const seeds = [42, 7];
const pt=(x,y,z)=>({x,y,z});
const hash = p => {
  const h=createHash('sha256');
  for(const s of p.surfaces) { h.update(Buffer.from(s.positions.buffer));h.update(Buffer.from(s.indices.buffer)); }
  return h.digest('hex');
};

function check(seed) {
  const terrain=generateMountainTerrain(seed);
  const passages=buildMountainPassages(terrain.passageAnchors,seed);
  assert.equal(hash(passages),hash(buildMountainPassages(generateMountainTerrain(seed).passageAnchors,seed)));
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
    let state=createMountainRopeState();
    for(let i=0;i<1600;i++){
      const result=stepMountainRope(rope,state,feet(),{interact:i===0,climb:sign},1/60);
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
function walk(terrain, bridge, enabled, reverse) {
  const physics = new R.World({x:0,y:-9.81,z:0});
  for (const raw of [terrain.rock,terrain.snow]) {
    physics.createCollider(R.ColliderDesc.trimesh(raw.positions,raw.indices));
  }
  physics.createCollider(R.ColliderDesc.cuboid(200,.2,100).setTranslation(48,-.2,0));
  for (const tree of terrain.trees) {
    physics.createCollider(R.ColliderDesc.cylinder(tree.height/2,tree.radius).setTranslation(tree.x,tree.y+tree.height/2,tree.z));
  }
  const deck = enabled ? physics.createCollider(R.ColliderDesc.trimesh(bridge.collider.positions,bridge.collider.indices)) : null;
  const sign = reverse ? -1 : 1;
  const start = (reverse ? bridge.to : bridge.from).x-sign*2;
  const finish = (reverse ? bridge.from : bridge.to).x+sign*2;
  const body = physics.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(start,14+.95,bridge.from.z));
  const actor = physics.createCollider(R.ColliderDesc.capsule(.6,.30),body);
  const ctrl = physics.createCharacterController(.03);
  ctrl.setMaxSlopeClimbAngle(48*Math.PI/180);
  ctrl.setMinSlopeSlideAngle(55*Math.PI/180);
  ctrl.enableAutostep(.32,.15,false);
  ctrl.enableSnapToGround(.35);
  physics.step();
  let vertical = 0, crossed = false, midDeckSupport = false, minEyeClearance = Infinity;
  for (let t=0; t<1700; t++) {
    const prev = body.translation();
    vertical = Math.max(-30,vertical-9.81/60);
    ctrl.computeColliderMovement(actor,{x:sign*1.72/60,y:vertical/60,z:0});
    const move = ctrl.computedMovement();
    body.setNextKinematicTranslation({x:prev.x+move.x,y:prev.y+move.y,z:prev.z+move.z});
    physics.step();
    if (ctrl.computedGrounded()) vertical=-.5;
    const cur=body.translation();
    if (Math.abs(cur.x-(bridge.from.x+bridge.to.x)/2)<.6 && deck) {
      const ray = new R.Ray({x:cur.x,y:cur.y+.80,z:cur.z},{x:0,y:-1,z:0});
      const hit = physics.castRay(ray,2.5,true,undefined,undefined,actor);
      if (hit && hit.collider.handle===deck.handle) {
        midDeckSupport=true;
        minEyeClearance=Math.min(minEyeClearance,hit.timeOfImpact);
      }
    }
    if (sign*(cur.x-finish)>=0 && Math.abs(cur.y-.9-14)<.25) { crossed=true; break; }
  }
  const end = {...body.translation()};
  physics.free();
  return {crossed,midDeckSupport,minEyeClearance:Number.isFinite(minEyeClearance)?minEyeClearance:null,end};
}

async function main() {
  await R.init();
  for (const seed of seeds) {
    const terrain = generateMountainTerrain(seed);
    const passage = check(seed);
    const bridge = planMountainBridge(terrain);
    assert.ok(bridge);
    for (const reverse of [false, true]) {
      const trip = walk(terrain, bridge, true, reverse);
      assert.ok(trip.crossed && trip.midDeckSupport);
    }
    assert.equal(walk(terrain, bridge, false, false).crossed, false);
    console.log('PASS seed', seed, ': den, rock tunnel, rope ascent and descent, both bridge directions in', passage.ticks, 'passage ticks');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
