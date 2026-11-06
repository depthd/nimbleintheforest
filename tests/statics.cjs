// Statics of wooden structures and wood pieces, without the game.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const THREE = require('three');
const src = buildSync({
  stdin: { contents: "export * from './build/statics'; export * from './wood/piece'; export * from './wood/felling';", resolveDir: path.join(__dirname, '../src/game'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['three'],
}).outputFiles[0].text;
const m = new Module(__filename);
m._compile(src, __filename);
const S = m.exports;
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ', name); }

const UP = new THREE.Vector3(0, 1, 0);
/** a part lying from point a to point b */
function part(id, piece, a, b) {
  const pa = new THREE.Vector3(...a), pb = new THREE.Vector3(...b);
  const d = pb.clone().sub(pa);
  piece.len = d.length();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.clone().normalize());
  return { id, piece, pos: pa.clone().add(pb).multiplyScalar(0.5), quat, moisture: 0.2 };
}
const ground = (a, ua, kind = 'set') => ({ a, ua, b: -1, ub: 0, kind, n: UP.clone() });
const map = (...ps) => new Map(ps.map((p) => [p.id, p]));
function frame(beamR = 0.07, span = 3) {
  const p1 = part(1, S.makeRound('spruce', 2.5, 0.08), [0, -0.5, 0], [0, 2, 0]);
  const p2 = part(2, S.makeRound('spruce', 2.5, 0.08), [span, -0.5, 0], [span, 2, 0]);
  const beam = part(3, S.makeRound('pine', 3.4, beamR), [-0.2, 2 + 0.08 + beamR, 0], [span + 0.2, 2 + 0.08 + beamR, 0]);
  const parts = map(p1, p2, beam);
  const joints = [ground(1, 0.5), ground(2, 0.5), ...S.findRests(beam, p1), ...S.findRests(beam, p2)];
  return { parts, joints, beam };
}

test('a log of real size weighs what its wood weighs', () => {
  const p = S.makeRound('spruce', 2, 0.1, 0.1);
  const v = Math.PI * 0.01 * 2;
  assert.ok(Math.abs(S.volume(p) - v) < 1e-6);
  assert.ok(Math.abs(S.pieceMass(p, 0.45) - v * 780) < 0.5);
});

test('cutting at a point gives two pieces of exactly those lengths, minus the chips', () => {
  const p = S.makeRound('pine', 3, 0.12, 0.1);
  let n;
  for (let i = 0; i < 200; i++) {
    n = S.chop(p, 1.2, 0, 1, false);
    if (S.cutThrough(p, n)) break;
  }
  assert.ok(S.cutThrough(p, n));
  const m0 = S.pieceMass(S.makeRound('pine', 3, 0.12, 0.1), 0.3);
  const [a, b] = S.cutAt(p, S.weakestAt(p, n));
  assert.ok(Math.abs(a.len + b.len - 3) < 1e-9);
  assert.ok(Math.abs(a.len - 1.2) < 0.05, a.len);
  const lost = m0 - S.pieceMass(a, 0.3) - S.pieceMass(b, 0.3);
  assert.ok(lost > 0 && lost < m0 * 0.12, `chips ${lost}`);
});

test('thick trunks take much longer than thin ones; two sides are quicker', () => {
  const hits = (r, two) => {
    const p = S.makeRound('spruce', 3, r, r);
    for (let i = 1; i < 500; i++) {
      const n = S.chop(p, 1.5, two && i % 2 ? Math.PI : 0, 1, false);
      if (p.notches.some((x) => S.cutThrough(p, x))) return i;
    }
    return 500;
  };
  assert.ok(hits(0.2, false) > 3 * hits(0.1, false));
  assert.ok(hits(0.2, true) < hits(0.2, false));
});

test('splitting a chock keeps its wood', () => {
  const p = S.makeRound('birch', 0.5, 0.14, 0.13);
  const [a, b] = S.splitAlong(p);
  assert.ok(Math.abs(S.volume(a) + S.volume(b) - S.volume(p)) < 1e-6);
});

test('a tree notched from one side falls toward the notch when it does not lean', () => {
  const p = S.makeRound('spruce', 10, 0.15, 0.05);
  let st;
  for (let i = 0; i < 300; i++) {
    S.chop(p, 1, Math.PI / 2, 1, false);
    st = S.fellCheck({ stem: p, leanY: 0, leanZ: 0, windY: 0, windZ: 0, windH: 6, moisture: 0.45 });
    if (st.ratio >= 1) break;
  }
  assert.ok(st.ratio >= 1);
  assert.ok(st.dirZ > 0.9, JSON.stringify(st));
  assert.ok(st.frac < 0.35 && st.frac > 0.02, String(st.frac));
});

test('a strong lean wins over a small notch on the other side', () => {
  const p = S.makeRound('spruce', 10, 0.15, 0.05);
  let st;
  for (let i = 0; i < 300; i++) {
    S.chop(p, 1, 0, 1, false);
    st = S.fellCheck({ stem: p, leanY: -0.07, leanZ: 0, windY: 0, windZ: 0, windH: 6, moisture: 0.45 });
    if (st.ratio >= 1) break;
  }
  assert.ok(st.dirY < -0.9, JSON.stringify(st));
});

test('a beam on two dug-in posts holds itself', () => {
  const { parts, joints } = frame();
  const r = S.analyze(parts, joints);
  assert.equal(r.failures.length, 0, JSON.stringify(r.failures));
  const beam = r.state.get(3);
  assert.equal(beam.reactions.length, 2);
  const w = beam.reactions.reduce((a, x) => a + x.R.y, 0);
  assert.ok(w > 0, 'supports push up');
  const post = r.state.get(1);
  assert.ok(post.N > 0, 'posts are in compression');
});

test('a heavy load in the middle breaks the beam there', () => {
  const { parts, joints } = frame(0.05);
  const loads = [{ part: 3, u: 1.7, F: new THREE.Vector3(0, -6000, 0) }];
  const r = S.analyze(parts, joints, 0, loads);
  const f = r.failures.find((x) => x.part === 3);
  assert.ok(f && f.why === 'bend', JSON.stringify(r.failures));
  assert.ok(Math.abs(f.u - 1.7) < 0.3, String(f.u));
});

test('snow on a roof adds up until the ridge gives way', () => {
  const { parts, joints, beam } = frame(0.045);
  beam.roof = 2.5;
  const light = S.analyze(parts, joints, 30);
  assert.equal(light.failures.length, 0, JSON.stringify(light.failures));
  const heavy = S.analyze(parts, joints, 260);
  assert.ok(heavy.failures.some((x) => x.part === 3 && x.why === 'bend'), JSON.stringify(heavy.failures));
});

test('a deeply notched post under load fails at the notch', () => {
  const { parts, joints } = frame(0.09);
  const post = parts.get(1).piece;
  for (let i = 0; i < 60; i++) S.chop(post, 1.4, 0, 1, false);
  const loads = [{ part: 3, u: 0.2, F: new THREE.Vector3(0, -2500, 0) }];
  const r = S.analyze(parts, joints, 0, loads);
  const f = r.failures.find((x) => x.part === 1);
  assert.ok(f, JSON.stringify(r.failures.map((x) => [x.part, x.why, x.u.toFixed(2)])));
  assert.ok(Math.abs(f.u - 1.4) < 0.3, String(f.u));
});

test('take a post away: the beam resting on the other one tips over', () => {
  const { parts, joints } = frame();
  parts.delete(2);
  const r = S.analyze(parts, joints);
  assert.ok(r.failures.some((x) => x.part === 3 && x.why === 'tip'), JSON.stringify(r.failures));
});

test('a board on one post tips unless nailed; nails hold a short overhang', () => {
  const post = part(1, S.makeRound('spruce', 1.5, 0.08), [0, -0.4, 0], [0, 1.1, 0]);
  const board = part(2, S.makeSawn('spruce', 1, 0.15, 0.03), [-0.2, 1.195, 0], [0.8, 1.195, 0]);
  const parts = map(post, board);
  const rests = S.findRests(board, post);
  assert.equal(rests.length, 1);
  const r1 = S.analyze(parts, [ground(1, 0.4), ...rests]);
  assert.ok(r1.failures.some((x) => x.part === 2 && x.why === 'tip'));
  const nailed = rests.map((j) => ({ ...j, kind: 'nail', nails: 3 }));
  const r2 = S.analyze(parts, [ground(1, 0.4), ...nailed]);
  assert.ok(!r2.failures.some((x) => x.part === 2), JSON.stringify(r2.failures));
});

test('nothing below: a piece with no support path falls', () => {
  const { parts, joints } = frame();
  const loose = part(9, S.makeRound('spruce', 1, 0.05), [5, 3, 0], [6, 3, 0]);
  parts.set(9, loose);
  const r = S.analyze(parts, joints);
  assert.ok(r.failures.some((x) => x.part === 9 && x.why === 'unsupported'));
});

test('a thin tall pole buckles before it crushes', () => {
  const pole = part(1, S.makeRound('spruce', 4, 0.025), [0, -0.3, 0], [0, 3.7, 0]);
  const r = S.analyze(map(pole), [ground(1, 0.3)], 0, [{ part: 1, u: 4, F: new THREE.Vector3(0, -600, 0) }]);
  assert.ok(r.failures.some((x) => x.part === 1 && x.why === 'buckle'), JSON.stringify(r.failures));
});

test('a leaning pole shares its weight between the ground and the ridge it rests on', () => {
  const { parts, joints } = frame();
  const sl = part(4, S.makeRound('spruce', 3, 0.04), [1.5, 0, -2.2], [1.5, 2 + 0.08 + 0.07 * 2 + 0.04, 0]);
  parts.set(4, sl);
  const js = [...joints, ground(4, 0.05, 'set'), ...S.findRests(sl, parts.get(3))];
  const r = S.analyze(parts, js);
  assert.equal(r.failures.length, 0, JSON.stringify(r.failures));
  const st = r.state.get(4);
  assert.equal(st.reactions.length, 2);
  const onRidge = st.reactions.find((x) => x.joint.b === 3);
  assert.ok(onRidge && onRidge.R.y > 0, 'the ridge carries part of the pole');
});

test('a log in the valley of two logs stays; on top of one log it rolls off', () => {
  const r = 0.12;
  const l1 = part(1, S.makeRound('spruce', 3, r), [0, r, 0], [3, r, 0]);
  const l2 = part(2, S.makeRound('spruce', 3, r), [0, r, 2 * r + 0.002], [3, r, 2 * r + 0.002]);
  const top = part(3, S.makeRound('spruce', 3, r), [0, r + Math.sqrt(3) * r, r + 0.001], [3, r + Math.sqrt(3) * r, r + 0.001]);
  const base = [ground(1, 0.5, 'rest'), ground(1, 2.5, 'rest'), ground(2, 0.5, 'rest'), ground(2, 2.5, 'rest')];
  const js = [...base, ...S.findRests(top, l1), ...S.findRests(top, l2)];
  const ok = S.analyze(map(l1, l2, top), js);
  assert.ok(!ok.failures.some((x) => x.part === 3), JSON.stringify(ok.failures));
  // pull one bottom log out: the top one now lies on the side of a single log
  const js2 = [...base.filter((j) => j.a !== 2), ...S.findRests(top, l1)];
  const bad = S.analyze(map(l1, top), js2);
  assert.ok(bad.failures.some((x) => x.part === 3 && x.why === 'tip'), JSON.stringify(bad.failures));
});

test('a log balanced along another log rolls off; in a groove it stays', () => {
  const r = 0.12;
  const low = part(1, S.makeRound('spruce', 2, r), [0, r, 0], [2, r, 0]);
  const top = part(2, S.makeRound('spruce', 2, r), [0, 3 * r, 0], [2, 3 * r, 0]);
  const base = [ground(1, 0.3, 'rest'), ground(1, 1.7, 'rest')];
  const rests = S.findRests(top, low);
  assert.ok(rests.length > 1 && rests.every((j) => j.roll));
  const loose = S.analyze(map(low, top), [...base, ...rests]);
  assert.ok(loose.failures.some((x) => x.part === 2 && x.why === 'tip'), JSON.stringify(loose.failures));
  const grooved = S.analyze(map(low, top), [...base, ...rests.map((j) => ({ ...j, kind: 'notch' }))]);
  assert.ok(!grooved.failures.length, JSON.stringify(grooved.failures));
});

console.log(`\n${count} checks passed`);
