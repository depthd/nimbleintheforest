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
  // Follow the north shoulder both ways before taking the southern route.
  const shelf = terrain.routes.find(r => r.kind === 'shelf');
  assert.ok(shelf);
  assert.ok(Number.isFinite(terrain.sampleHeight(-14 - 2e-15, -34)), 'collapsed end of the shelf');
  for (const x of [-45.5, -41.5, -36.5, -30.5]) {
    const bounds = shelf.points.filter(p => Math.abs(p.x - x) < 2);
    const t = (x - bounds[0].x) / (bounds[1].x - bounds[0].x);
    const treadZ = bounds[0].z + t * (bounds[1].z - bounds[0].z);
    const height = (z) => {
      const hit = physics.castRay(new R.Ray(pt(x, 35, z),pt(0,-1,0)), 36, true,
        undefined, undefined, undefined, undefined, c => names.get(c.handle) !== 'tree');
      assert.ok(hit);
      return 35 - hit.timeOfImpact;
    };
    const tread = height(treadZ);
    assert.ok(tread > .25 && height(-42) < .05, 'outer drop missing at ' + [seed, x, tread, height(-42)]);
    // Across the entire section, terrain and its physics collider must meet the shared core.
    for (let z = treadZ; z <= -33; z += .18) {
      const support = height(z);
      assert.ok(support >= tread - .035, 'uphill gap at ' + [x, z, support, tread]);
      assert.ok(Math.abs(terrain.sampleHeight(x, z) - support) < .035, 'terrain/collider disagree');
    }
    assert.ok(height(-33) > tread + .1, 'shelf floats off the rock');
  }
  const approach = [pt(-65,0,-38), ...shelf.points];
  for (const waypoint of approach) walk(waypoint);
  assert.ok(feet().y > 13.75);
  for (const waypoint of approach.slice().reverse()) walk(waypoint);
  walk(spawn);
  // The entire route starts at the world spawn. Never move the rigid body to a waypoint.
  const {denMouth, denBack, throughLower: lo, throughUpper: high} = terrain.passageAnchors;
  const approachZ = denMouth.z + 6;
  for(const q of [pt(spawn.x-1,0,approachZ),pt(denMouth.x,0,approachZ),...passages.routes.den])walk(q);
  for(let i=0;i<200;i++)step(pt(0,-.04,-.1));
  trace.denStop=feet();assert(trace.denStop.z>denBack.z-.01 && trace.denStop.z<denBack.z+.4);
  for(const q of [...passages.routes.den].reverse())walk(q);
  const {rope}=passages;
  for(const q of [pt(denMouth.x,0,approachZ),pt(rope.lower.x,0,approachZ),rope.lower])walk(q);
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
  for(const q of [pt(lo.x,lo.y,rope.upper.z),pt(lo.x,lo.y,lo.z+5),...passages.routes.through])walk(q);
  trace.upperExit=feet();assert(Math.abs(trace.upperExit.y-high.y)<.15);
  for(const q of [...passages.routes.through].reverse())walk(q);
  trace.lowerExit=feet();assert(Math.abs(trace.lowerExit.y-lo.y)<.15);
  for(const q of [pt(lo.x,lo.y,lo.z+5),pt(lo.x,lo.y,rope.upper.z),rope.upper])walk(q);
  ride(-1);trace.ropeBottom=feet();
  assert(distance(feet(),rope.lower)<.18);
  function ray(p,d,max) {
    const hit=physics.castRay(new R.Ray(p,d),max,true,undefined,undefined,body);
    return hit?{name:names.get(hit.collider.handle),distance:hit.timeOfImpact}:null;
  }
  const den=ray(pt(denBack.x,1,denBack.z+4),pt(0,1,0),13);
  const denTop=ray(pt(denBack.x,17,denBack.z+4),pt(0,-1,0),5);
  const back=ray(pt(denBack.x,1,denBack.z+4),pt(0,0,-1),9);
  const ex=ray(pt(high.x,high.y+3,high.z+2),pt(0,-1,0),8);
  assert(den?.name==='passage-rock'&&den.distance>1.7);
  assert.ok(denTop?.name === 'host-top' || denTop?.name === 'host-rock', 'solid roof over the den');
  assert(back?.name==='passage-rock' && Math.abs(back.distance-4)<.03);
  assert.equal(ex?.name,'passage-floor');
  // Exercise every advertised ordinary arrival on the actual triangles (including an
  // east-side cut), together with the native trees. Each independent check starts
  // at the parent terrace and walks to the child and back without jumping.
  for (const route of terrain.routes.filter(r => r.kind === 'wide' || r.kind === 'cut')) {
    const first = route.points[0];
    b.setTranslation({x:first.x,y:first.y+1.0,z:first.z},true);
    physics.step(); vY = 0;
    try {
      for(const q of [...route.points,...route.points.slice().reverse()])walk(q);
    } catch (e) { throw Error(route.to+' '+route.kind+' '+e.message); }
  }
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
  const start = bridge.point(reverse ? bridge.span + 2 : -2);
  const finish = bridge.point(reverse ? -2 : bridge.span + 2);
  const along = { x:(bridge.to.x - bridge.from.x) / bridge.span, z:(bridge.to.z - bridge.from.z) / bridge.span };
  const progress = p => (p.x - start.x) * along.x * sign + (p.z - start.z) * along.z * sign;
  const body = physics.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(
    start.x, terrain.sampleHeight(start.x, start.z) + .95, start.z));
  const actor = physics.createCollider(R.ColliderDesc.capsule(.6,.30),body);
  const ctrl = physics.createCharacterController(.03);
  ctrl.setMaxSlopeClimbAngle(48*Math.PI/180);
  ctrl.setMinSlopeSlideAngle(55*Math.PI/180);
  ctrl.enableAutostep(.32,.15,false);
  ctrl.enableSnapToGround(.35);
  physics.step();
  if (deck) {
    const i = Math.floor(bridge.suspenderPositions.length / 2);
    const left = bridge.point(bridge.suspenderPositions[i - 1], 0, 1.02);
    const right = bridge.point(bridge.suspenderPositions[i], 0, 1.02);
    const centre = pt((left.x + right.x) / 2, (left.y + right.y) / 2, (left.z + right.z) / 2);
    for (const side of [-1, 1]) {
      const ray = new R.Ray(centre, pt(-along.z * side, 0, along.x * side));
      const hit = physics.castRay(ray, bridge.width, true, undefined, undefined, actor);
      assert.ok(hit && hit.collider.handle === deck.handle && Math.abs(hit.timeOfImpact - bridge.width / 2) < .09,
        'Visible handrail must have solid support at its rendered height');
    }
  }
  let vertical = 0, crossed = false, midDeckSupport = false, minEyeClearance = Infinity;
  for (let t=0; t<Math.ceil((bridge.span + 15) * 60 / 1.1); t++) {
    const prev = body.translation();
    vertical = Math.max(-30,vertical-9.81/60);
    ctrl.computeColliderMovement(actor,{x:along.x*sign*1.72/60,y:vertical/60,z:along.z*sign*1.72/60});
    const move = ctrl.computedMovement();
    body.setNextKinematicTranslation({x:prev.x+move.x,y:prev.y+move.y,z:prev.z+move.z});
    physics.step();
    if (ctrl.computedGrounded()) vertical=-.5;
    const cur=body.translation();
    if (Math.abs(progress(cur) - (bridge.span / 2 + 2)) < .6 && deck) {
      const ray = new R.Ray({x:cur.x,y:cur.y+.80,z:cur.z},{x:0,y:-1,z:0});
      const hit = physics.castRay(ray,2.5,true,undefined,undefined,actor);
      if (hit && hit.collider.handle===deck.handle) {
        midDeckSupport=true;
        minEyeClearance=Math.min(minEyeClearance,hit.timeOfImpact);
      }
    }
    if (progress(cur) >= progress(finish) && Math.abs(cur.y - .9 - terrain.sampleHeight(finish.x, finish.z)) < .25) { crossed=true; break; }
    if (!enabled && cur.y < Math.min(start.y, finish.y) - 2) break;
  }
  const end = {...body.translation()};
  physics.free();
  return {crossed,midDeckSupport,minEyeClearance:Number.isFinite(minEyeClearance)?minEyeClearance:null,end};
}

// Verify distributions and geometric constraints independently of the two full walks.
function checkLayouts() {
  const counts = new Set(), entries = new Set(), entrances = new Set(), drySatellite = new Set();
  let twinCuts = 0, highBank = 0;
  for (let seed = 0; seed < 40; seed++) {
    const terrain = generateMountainTerrain(seed);
    const {ropeLower, denMouth} = terrain.passageAnchors;
    assert.ok(Math.abs(ropeLower.x - denMouth.x) >= 9, 'clear vertical climb beside the den');
    for (const kind of ['main', 'satellite']) {
      const tiers = terrain.tiers.filter(t => t.mountainId === kind);
      counts.add(tiers.length);
      for (let i = 0; i < tiers.length; i++) {
        const t = tiers[i], b = t.bounds, parent = tiers[i-1]?.bounds;
        assert.equal(t.level,i+1);
        if (parent) assert.ok(b.minX >= parent.minX && b.maxX <= parent.maxX && b.minZ >= parent.minZ && b.maxZ <= parent.maxZ);
        const trees = terrain.trees.filter(tree => tree.tierId === t.id);
        assert.equal(trees.length > 0, t.accessible, 'living terrace or bare summit ' + [seed,t.id]);
        if (t.kind === 'peak') assert.equal(terrain.routes.some(r => r.to === t.id), false);
      }
    }
    const first = terrain.tiers[0], x = first.bounds.minX + 6;
    const floor = Array.from({length: 41}, (_, i) => terrain.sampleHeight(x, i - 20));
    const low = floor.filter(y => y < 2).length;
    if (first.entry === 'wide') assert.ok(low >= 39, 'whole short side must rise gently');
    else assert.ok(low >= 2 && low < 28, 'a cut should have steep banks');
    twinCuts += Number(terrain.routes.filter(r => r.to === first.id && r.kind === 'cut').length === 2);
    entries.add(first.entry);
    entrances.add(terrain.passageAnchors.throughLower.x + ',' + terrain.passageAnchors.denMouth.x);
    drySatellite.add(terrain.routes.some(r => r.from === 'spawn' && r.to === 'satellite-1'));
    highBank += Number(terrain.bridgeAnchors.some(a => a.tierId.endsWith('-2')));
  }
  assert.deepEqual([...counts].sort(), [1,2,3,4]);
  assert.equal(entries.size,2);
  assert.equal(drySatellite.size,2);
  assert.ok(twinCuts > 0 && highBank > 0 && entrances.size > 10);
}
// At the windward approach the F profile has a continuous rounded upper face,
// a curled underside and open air beyond the lip. Probe the collider the player walks on.
function checkCornice(terrain) {
  const physics = new R.World({x:0,y:-9.81,z:0});
  const {positions, indices} = terrain.snow;
  physics.createCollider(R.ColliderDesc.trimesh(positions,indices));
  physics.step();
  const x = -30;
  function height(z) {
    const ray = new R.Ray({x,y:40,z}, {x:0,y:-1,z:0});
    const hit = physics.castRay(ray, 39, true);
    return hit ? 40 - hit.timeOfImpact : undefined;
  }
  const inner = height(34.03), middle = height(34.17), outer = height(34.33);
  assert.ok(inner > middle && middle > outer);
  assert.ok(Math.abs(inner - terrain.sampleHeight(x, 34)) < .05);
  assert.equal(height(34.7), undefined);
  physics.free();
}

async function main() {
  await R.init();
  for (const seed of seeds) {
    const terrain = generateMountainTerrain(seed);
    checkCornice(terrain);
    const passage = check(seed);
    const bridge = planMountainBridge(terrain);
    assert.ok(bridge);
    for (const reverse of [false, true]) {
      const trip = walk(terrain, bridge, true, reverse);
      assert.ok(trip.crossed && trip.midDeckSupport);
    }
    assert.equal(walk(terrain, bridge, false, false).crossed, false);
    console.log('PASS seed', seed, ': two-way attached contour shelf, den, rock tunnel, rope ascent and descent, both bridge directions in', passage.ticks, 'passage ticks');
  }
}
checkLayouts();
main().catch(error => { console.error(error); process.exitCode = 1; });
