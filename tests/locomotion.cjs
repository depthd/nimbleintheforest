// Deterministic tests of contact placement, facing and IK, without a renderer.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const THREE = require('three');
const { buildSync } = require('esbuild');
const source = buildSync({ entryPoints: [path.join(__dirname, '../src/game/locomotion.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const compiled = new Module(__filename);
compiled._compile(source, __filename);
const { Locomotion, solveLeg, footPose, wrapAngle, ANKLE, THIGH, SHIN } = compiled.exports;
const dt = 1 / 60;
const flat = (x, z) => ({ point: new THREE.Vector3(x, 0, z), normal: new THREE.Vector3(0, 1, 0) });
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ', name); }
function fixture(probe = flat) {
  const m = new Locomotion();
  const input = { position: new THREE.Vector3(), yaw: 0, pitch: 0, grounded: true,
    crouch: false, sprinting: false, suspended: false };
  m.reset(input, probe);
  const step = (n = 1, vx = 0, vz = 0) => {
    for (let k = 0; k < n; k++) {
      input.position.x += vx * dt;
      input.position.z += vz * dt;
      m.update(dt, input, probe);
    }
  };
  step();
  return { m, input, step };
}

test('idle feet stay planted and silent; breathing cannot create steps', () => {
  const { m, step } = fixture();
  const anchors = m.feet.map(f => f.position.clone());
  step(600);
  assert.equal(m.stepSerial, 0);
  m.feet.forEach((f, i) => assert.ok(f.position.distanceTo(anchors[i]) < 1e-9));
});

test('standing ankles sit below hips instead of reaching in front of a displaced torso', () => {
  const { m, step } = fixture(); step(90);
  for (const f of m.feet) {
    const hip = new THREE.Vector3(f.sign * 0.115, m.hipHeight, 0);
    const pose = footPose(f);
    const ankle = pose.position.clone().add(new THREE.Vector3(0, ANKLE, 0.025).applyQuaternion(pose.rotation));
    assert.ok(Math.abs(ankle.z - hip.z) < 0.01);
    const knee = new THREE.Vector3();
    solveLeg(hip, ankle, new THREE.Vector3(0, 0, -1), knee);
    assert.ok(Math.abs(knee.z - hip.z) < 0.13, `permanently bent-forward knee ${knee.z}`);
  }
});

test('small look turns the head without turning hips or feet', () => {
  const { m, input, step } = fixture();
  input.yaw = 0.55;
  input.pitch = -0.7;
  step(90);
  assert.ok(Math.abs(m.bodyYaw) < 1e-9);
  assert.ok(m.headYaw > 0.3);
  assert.ok(m.headPitch < -0.4 && m.chestPitch < 0);
  assert.equal(m.stepSerial, 0);
});

test('large look smoothly turns the body and replants feet instead of spinning soles', () => {
  const { m, input, step } = fixture();
  input.yaw = 2.8;
  let last = m.bodyYaw, maxSpeed = 0, plantedRotation = 0;
  for (let i = 0; i < 240; i++) {
    const before = m.feet.map(f => ({ yaw: f.yaw, stance: f.grounded }));
    step();
    maxSpeed = Math.max(maxSpeed, Math.abs(wrapAngle(m.bodyYaw - last)) / dt);
    m.feet.forEach((f, j) => { if (before[j].stance && f.grounded) plantedRotation = Math.max(plantedRotation, Math.abs(wrapAngle(f.yaw - before[j].yaw))); });
    last = m.bodyYaw;
  }
  assert.ok(Math.abs(wrapAngle(m.bodyYaw - input.yaw)) < 0.15);
  assert.ok(maxSpeed <= 1.81);
  assert.ok(plantedRotation < 1e-9);
  assert.ok(m.stepSerial >= 2);
});

test('running lengthens the stride instead of accelerating walking into a shuffle', () => {
  const traces = [];
  for (const [speed, sprinting] of [[1.7, false], [4.5, true]]) {
    const { m, input, step } = fixture(); input.sprinting = sprinting;
    const contacts = []; let flight = 0, maxReach = 0, minHip = 1;
    for (let i = 0; i < 480; i++) {
      step(1, 0, -speed);
      if (i < 120) continue;
      contacts.push(...m.contacts.map(c => ({ t: i * dt, z: c.position.z })));
      if (m.feet.every(f => f.swinging)) flight++;
      minHip = Math.min(minHip, m.hipHeight);
      for (const f of m.feet) {
        const hip = input.position.clone().add(new THREE.Vector3(f.sign * 0.115, m.hipHeight, 0));
        const pose = footPose(f);
        const ankle = pose.position.clone().add(new THREE.Vector3(0, ANKLE, 0.025).applyQuaternion(pose.rotation));
        maxReach = Math.max(maxReach, solveLeg(hip, ankle, new THREE.Vector3(0, 0, -1), new THREE.Vector3()));
      }
    }
    const cadence = (contacts.length - 1) / (contacts.at(-1).t - contacts[0].t);
    const stride = Math.abs(contacts.at(-1).z - contacts[0].z) / (contacts.length - 1);
    traces.push({ cadence, stride, flight, minHip, maxReach });
  }
  const [walk, run] = traces;
  assert.ok(run.cadence >= 2.8 && run.cadence <= 3.6, JSON.stringify(run));
  assert.ok(run.cadence < walk.cadence * 1.25, JSON.stringify(traces));
  assert.ok(run.stride > walk.stride * 1.9, JSON.stringify(traces));
  assert.ok(run.flight > 30 && walk.flight === 0);
  assert.ok(run.minHip > 0.9 && run.maxReach < 0.01, JSON.stringify(run));
});

test('toe-off raises the heel while the toe contact stays fixed', () => {
  const { m, input, step } = fixture(); input.sprinting = true;
  let rolled = 0;
  for (let i = 0; i < 240; i++) {
    step(1, 0, -4.5);
    for (const f of m.feet) if (f.grounded && !f.swinging && f.roll < -0.1) {
      const pose = footPose(f), toe = new THREE.Vector3(0, 0, -0.18);
      const actual = toe.clone().applyQuaternion(pose.rotation).add(pose.position);
      const expected = toe.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw).add(f.position);
      assert.ok(actual.distanceTo(expected) < 1e-7);
      assert.ok(pose.position.y > f.position.y + 0.01);
      rolled++;
    }
  }
  assert.ok(rolled > 20);
});

for (const [name, vx, vz, sprinting] of [['forward', 0, -1.7, false], ['backward', 0, 1.7, false],
  ['strafe', 1.7, 0, false], ['diagonal', 1.2, -1.2, false], ['sprint', 0, -4.5, true]]) {
  test(`${name}: contacts alternate, support feet do not slide, movement stops cleanly`, () => {
    const { m, input, step } = fixture();
    input.sprinting = sprinting;
    let drift = 0;
    const sides = [];
    for (let i = 0; i < 240; i++) {
      const before = m.feet.map(f => ({ p: f.position.clone(), stance: f.grounded }));
      step(1, vx, vz);
      m.feet.forEach((f, j) => { if (before[j].stance && f.grounded) drift = Math.max(drift, f.position.distanceTo(before[j].p)); });
      sides.push(...m.contacts.map(c => c.side));
      for (const f of m.feet) assert.ok(f.position.toArray().every(Number.isFinite));
      const separation = m.feet[1].position.clone().sub(m.feet[0].position);
      const gap = separation.x * Math.cos(m.bodyYaw) - separation.z * Math.sin(m.bodyYaw);
      assert.ok(gap > 0.12, `legs crossed: ${gap}`);
    }
    assert.ok(drift < 1e-8, `support drift ${drift}`);
    assert.ok(sides.length >= 6, `${sides.length} contacts`);
    for (let i = 1; i < sides.length; i++) assert.notEqual(sides[i], sides[i - 1], 'same foot twice');
    step(180);
    const serial = m.stepSerial;
    step(120);
    assert.equal(m.stepSerial, serial, 'feet kept stepping after stopping');
    assert.ok(Math.abs(wrapAngle(m.bodyYaw)) < 0.8, 'backpedal/strafe flipped the body');
  });
}

test('jump and suspension create no airborne contacts; landing is reported once', () => {
  const { m, input, step } = fixture();
  input.grounded = false;
  input.position.y = 0.6;
  step(60, 0, -0.5);
  assert.equal(m.stepSerial, 0);
  input.grounded = true;
  input.position.y = 0;
  step();
  assert.equal(m.contacts.filter(c => c.landing).length, 1);
  input.suspended = true;
  const serial = m.stepSerial;
  step(90);
  assert.equal(m.stepSerial, serial);
});

test('crouch lowers pelvis without sliding planted feet', () => {
  const { m, input, step } = fixture();
  const feet = m.feet.map(f => f.position.clone());
  input.crouch = true;
  step(90);
  assert.ok(m.hipHeight < 0.6);
  m.feet.forEach((f, i) => assert.ok(f.position.distanceTo(feet[i]) < 1e-9));
  input.crouch = false;
  step(90);
  assert.ok(m.hipHeight > 0.85);
});

test('slope support follows collision heights and normals', () => {
  const normal = new THREE.Vector3(0, 1, 0.25).normalize();
  const slope = (x, z) => ({ point: new THREE.Vector3(x, -z * 0.25, z), normal });
  const { m, input } = fixture(slope);
  let contacts = 0;
  for (let i = 0; i < 240; i++) {
    input.position.z -= 1.5 * dt;
    input.position.y = -input.position.z * 0.25;
    m.update(dt, input, slope);
    for (const c of m.contacts) {
      contacts++;
      assert.ok(Math.abs(c.position.y + c.position.z * 0.25) < 1e-7);
      assert.ok(c.normal.distanceTo(normal) < 1e-7);
    }
  }
  assert.ok(contacts >= 6);
});

test('teleport resets feet without a step or a stretched limb', () => {
  const { m, input, step } = fixture();
  step(90, 0, -1.7);
  input.position.set(400, 0, 200);
  m.reset(input, flat);
  assert.equal(m.contacts.length, 0);
  m.feet.forEach(f => assert.ok(f.position.distanceTo(input.position) < 0.25));
  step();
  assert.equal(m.contacts.length, 0, 'teleport was treated as an impact');
});

test('two-bone IK preserves lengths, bends forward and stays finite at singularities', () => {
  for (const ankle of [new THREE.Vector3(0, ANKLE, 0), new THREE.Vector3(0, 0.4, -0.3),
    new THREE.Vector3(0.1, 0.15, 0.35)]) {
    const hip = new THREE.Vector3(0, 0.89, 0), knee = new THREE.Vector3();
    solveLeg(hip, ankle, new THREE.Vector3(0, 0, -1), knee);
    assert.ok(Math.abs(hip.distanceTo(knee) - THIGH) < 1e-6);
    assert.ok(Math.abs(ankle.distanceTo(knee) - SHIN) < 1e-6);
    assert.ok(knee.z < (hip.z + ankle.z) * 0.5);
  }
  const knee = new THREE.Vector3();
  solveLeg(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(0, 0, -1), knee);
  assert.ok(knee.toArray().every(Number.isFinite));
});

console.log(`\n${count} locomotion checks passed`);
