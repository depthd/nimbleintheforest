'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const R = require('@dimforge/rapier3d-compat');

function compile(file) {
  const unit = new Module(__filename);
  unit.paths = module.paths;
  const build = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false });
  unit._compile(build.outputFiles[0].text, file);
  return unit.exports;
}

const { planSliceBridge } = compile(path.join(__dirname, 'slice-bridges.ts'));
const { generateSliceTerrain } = compile(path.resolve(process.argv[2] || path.join(__dirname, 'slice-terrain.ts')));
const fixedSeeds = [42, 7, 8191];
const heldOut = 23011;

// This spatial graph is built from sampled supports, independently of the
// plan's declared reachability. Keys retain height: canyon and deck coexist.
function supportPath(terrain, bridge) {
  const queue = [terrain.spawn];
  const seen = new Set();
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.x > 94 && cur.y >= 13.9) return true;
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const x = cur.x+dx, z = cur.z+dz;
      if (x < -68 || x > 166 || z < -40 || z > 40) continue;
      const heights = [terrain.sampleHeight(x,z)];
      if (bridge) {
        const dx = (bridge.to.x-bridge.from.x)/bridge.span, dz = (bridge.to.z-bridge.from.z)/bridge.span;
        const ox = x-bridge.from.x, oz = z-bridge.from.z;
        const along = ox*dx+oz*dz, across = Math.abs(oz*dx-ox*dz);
        if (along>=0 && along<=bridge.span && across <=bridge.width/2-.30) heights.push(bridge.point(along).y);
      }
      for (const y of heights) {
        if (Math.abs(cur.y-y) > Math.tan(48*Math.PI/180)) continue;
        if (terrain.trees.some(t => t.y<y+1.8 && t.y+t.height>y && Math.hypot(t.x-x,t.z-z)<t.radius+.30)) continue;
        const key = [x, z, Math.round(y*100)].join('/');
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({x,z,y});
      }
    }
  }
  return false;
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
  for (const seed of [...fixedSeeds,heldOut]) {
    const terrain = generateSliceTerrain(seed,{passages:true});
    const bridge = planSliceBridge(terrain);
    assert.ok(bridge,'Actual anchors form a valid crossing');
    assert.notEqual(bridge.from.mountainId,bridge.to.mountainId);
    assert.equal(bridge.span,32);
    assert.ok(bridge.sag>0 && bridge.dropAtCenter>10);
    const repeat = planSliceBridge(generateSliceTerrain(seed,{passages:true}));
    assert.deepEqual(bridge.collider,repeat.collider);
    assert.equal(supportPath(terrain,bridge),true);
    assert.equal(supportPath(terrain,null),false);
    const forward=walk(terrain,bridge,true,false),reverse=walk(terrain,bridge,true,true);
    const missing=walk(terrain,bridge,false,false);
    for (const trip of [forward,reverse]) {
      assert.equal(trip.crossed,true);
      assert.equal(trip.midDeckSupport,true);
      assert.ok(trip.minEyeClearance>1.6);
    }
    assert.equal(missing.crossed,false);
    assert.equal(planSliceBridge({...terrain,bridgeAnchors:terrain.bridgeAnchors.map(a=>({...a,accessible:false}))}),null);
    assert.equal(planSliceBridge({...terrain,bridgeAnchors:terrain.bridgeAnchors.map(a=>({...a,mountainId:'one'}))}),null);
    const mid=bridge.point(bridge.span/2);
    assert.equal(planSliceBridge({...terrain,trees:[{...mid,y:0,height:17,radius:.35}]}),null);
    const obstruction = {x:mid.x, y:mid.y, z:mid.z+1.45, height:.8, radius:.12};
    const shifted = planSliceBridge({...terrain,trees:[obstruction]});
    assert.ok(shifted && shifted.from.z !== bridge.from.z,'A clear alternative is chosen across the landing');
    assert.equal(planSliceBridge({...terrain,sampleHeight:(x,z)=>Math.abs(x-mid.x)<.8?20:terrain.sampleHeight(x,z)}),null);
    console.log(JSON.stringify({seed,span:bridge.span,sag:bridge.sag,clearance:bridge.dropAtCenter,deckTriangles:bridge.collider.indices.length/3,graphWith:true,graphWithout:false,forward,reverse,withoutBridge:missing}));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
