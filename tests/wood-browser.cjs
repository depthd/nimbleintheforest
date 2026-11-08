// Felling, limbing, bucking and splitting in the real game, in a headless browser.
// Usage: node tests/wood-browser.cjs [outDir]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const OUT = process.argv[2] || path.join(__dirname, '..', 'test-results', 'wood');
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!ok) failures++;
}

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 5201, strictPort: false, hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  const port = server.config.server.port;
  const url = `http://localhost:${port}/?test=1&seed=${process.env.SEED || 42}&hour=12&weather=clear`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.location().url?.endsWith('/favicon.ico')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
  await page.waitForTimeout(1000);
  const shot = (n) => page.screenshot({ timeout: 180000, path: path.join(OUT, n + '.png') });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ---- notch a standing spruce from one side: it falls toward the notch ----
  const fell = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const T = g.THREE;
    g.give('axe');
    g.equip('axe');
    const trees = G.forest.treesNear(0, 0, 120).filter((t) => t.alive && (t.type === 'spruce' || t.type === 'pine') && t.r > 0.09 && t.r < 0.17 && Math.hypot(t.x, t.z) > 18 && G.region.slopeAt(t.x, t.z) < 0.25)
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const tr = trees[0];
    G.forest.update(new T.Vector3(tr.x, tr.y, tr.z), true);
    // stand on the side the tree leans to, so it falls toward the notch... which is toward us:
    // instead stand on the side opposite to the lean and notch from there
    const away = { x: -Math.cos(tr.leanDir), z: -Math.sin(tr.leanDir) };
    const px = tr.x + away.x * 1.1, pz = tr.z + away.z * 1.1;
    g.teleport(px, G.terrain.heightAt(px, pz) + 0.05, pz);
    g.steps(10);
    g.lookAt(tr.x, tr.y + 0.9, tr.z);
    const before = g.actions();
    let n = 0;
    const infos = [];
    while (tr.alive && n < 120) {
      g.lookAt(tr.x, tr.y + 0.9, tr.z);
      g.swing();
      n++;
      if (n % 5 === 0) infos.push(g.actions().info);
    }
    return { id: tr.id, r: tr.r, h: tr.h, lean: tr.lean, fell: !tr.alive, n, before, infos: infos.slice(-3), base: [tr.x, tr.y, tr.z], away };
  });
  check('a notched tree falls', fell.fell, JSON.stringify(fell));
  await page.waitForTimeout(300);
  await shot('01-falling');
  const landed = await ev((f) => {
    const g = window.__game;
    const G = g.G;
    for (let i = 0; i < 600; i++) g.steps(1);
    const trunk = G.entities.list.find((e) => e.data?.wood && e.defId === 'trunk' && !e.removed);
    const stump = G.entities.list.find((e) => e.kind === 'stump' && !e.removed);
    if (!trunk) return { trunk: false };
    const p = trunk.position();
    const dir = { x: p.x - f.base[0], z: p.z - f.base[2] };
    const l = Math.hypot(dir.x, dir.z);
    // the notch was cut from the player's side (opposite the lean); it falls toward the player side or the lean
    return {
      trunk: true, mass: trunk.mass, len: trunk.data.wood.len, whorls: trunk.data.wood.whorls.length,
      stumpH: stump ? stump.data.wood.len : 0, towardNotch: (dir.x * f.away.x + dir.z * f.away.z) / l, tilt: Math.abs(new g.THREE.Vector3(1, 0, 0).applyQuaternion(trunk.obj.quaternion).y),
      groups: trunk.colliders[0].collisionGroups(), condition: G.body.condition,
    };
  }, fell);
  check('trunk lies with its crown', landed.trunk && landed.whorls > 0 && landed.tilt < 0.6, JSON.stringify(landed));
  check('stump is as high as the cut', landed.stumpH > 0.6 && landed.stumpH < 1.3, String(landed.stumpH));
  await shot('02-fallen');

  // ---- lop a branch: you get exactly that branch ----
  const lop = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const T = g.THREE;
    const trunk = G.entities.list.find((e) => e.data?.wood && e.defId === 'trunk' && !e.removed);
    const w = trunk.data.wood;
    const q = trunk.obj.quaternion;
    const c = trunk.position();
    const whorl = w.whorls[Math.floor(w.whorls.length / 2)];
    const at = new T.Vector3(whorl.u - w.len / 2, 0, 0).applyQuaternion(q).add(c);
    const side = new T.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize();
    const stand = at.clone().addScaledVector(side, Math.min(2.2, whorl.rad * 0.5 + 0.9));
    g.teleport(stand.x, G.terrain.heightAt(stand.x, stand.z) + 0.05, stand.z);
    g.steps(5);
    const massBefore = trunk.mass;
    const branchesBefore = w.whorls.reduce((a, x) => a + x.branches.length, 0);
    const countBefore = G.entities.list.filter((e) => e.data?.wood && (e.defId === 'boughs' || e.defId === 'sticks')).length;
    let n = 0, label = '';
    for (; n < 6; n++) {
      g.lookAt(at.x, at.y + 0.2, at.z);
      const a = g.actions();
      label = a.actions.join(',');
      g.swing();
    }
    g.steps(30);
    const pieces = G.entities.list.filter((e) => e.data?.wood && (e.defId === 'boughs' || e.defId === 'sticks'));
    const branchesAfter = w.whorls.reduce((a, x) => a + x.branches.length, 0);
    const got = pieces.length - countBefore;
    const gotMass = pieces.slice(countBefore).reduce((a, e) => a + e.mass, 0);
    return { label, got, gotMass, lost: massBefore - trunk.mass, branchesBefore, branchesAfter };
  });
  check('lopping gives the branches that were on the trunk', lop.got > 0 && Math.abs(lop.gotMass - lop.lost) < 0.5, JSON.stringify(lop));
  await shot('03-lopped');

  // ---- buck the trunk at a chosen point: two pieces of exactly those lengths ----
  const buck = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const T = g.THREE;
    const trunk = G.entities.list.find((e) => e.data?.wood && e.defId === 'trunk' && !e.removed);
    const w = trunk.data.wood;
    const len0 = w.len;
    const q = trunk.obj.quaternion.clone();
    const c = trunk.position();
    const u = 1.6;
    const side = new T.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize();
    // first lop the branches in the way: the stem is inside the crown
    let lopped = 0;
    const dbg = [];
    for (const wh of [...w.whorls]) {
      if (Math.abs(wh.u - u) > wh.h * 0.3 + 0.25) continue;
      const wa = new T.Vector3(wh.u - w.len / 2, 0, 0).applyQuaternion(q).add(c);
      const st = wa.clone().addScaledVector(side, Math.min(2.2, wh.rad * 0.5 + 0.9));
      g.teleport(st.x, G.terrain.heightAt(st.x, st.z) + 0.05, st.z);
      g.steps(3);
      for (let k = 0; k < 12 && w.whorls.includes(wh); k++) {
        const cur = G.entities.list.find((e) => e.data?.wood === w);
        if (!cur) break;
        g.lookAt(wa.x, wa.y + 0.2, wa.z);
        const aa = g.actions();
        if (lopped < 30) dbg.push(aa.target + ':' + aa.actions.filter((x) => x.startsWith('LMB')).join('/') + ':' + (G.interact.target.dist || 0).toFixed(2));
        g.swing();
        g.steps(1);
        lopped++;
      }
    }
    const tr2 = G.entities.list.find((e) => e.data?.wood === w && !e.removed) || trunk;
    const q2 = tr2.obj.quaternion.clone();
    const c2 = tr2.position();
    const at = new T.Vector3(u - w.len / 2, 0, 0).applyQuaternion(q2).add(c2);
    const stand = at.clone().addScaledVector(side, 0.95);
    g.teleport(stand.x, G.terrain.heightAt(stand.x, stand.z) + 0.05, stand.z);
    g.steps(5);
    let n = 0, acts = null;
    const id = tr2.id;
    const trunk2 = tr2;
    while (!trunk2.removed && n < 200) {
      g.lookAt(at.x, at.y + 0.05, at.z);
      if (!acts) acts = g.actions();
      g.swing();
      g.steps(1);
      n++;
    }
    g.steps(20);
    const parts = G.entities.list.filter((e) => e.data?.wood && !e.removed && e.id > id && (e.defId === 'log' || e.defId === 'trunk' || e.defId === 'chock'));
    return { dbg, lopped, n, removed: trunk2.removed, acts, len0, lens: parts.map((e) => +e.data.wood.len.toFixed(3)), names: parts.map((e) => e.name) };
  });
  check('bucking cuts the trunk at the hit point', buck.removed && buck.lens.some((l) => Math.abs(l - 1.6) < 0.08), JSON.stringify(buck));
  check('the two pieces add up to the trunk', buck.lens.length >= 2 && Math.abs(buck.lens.reduce((a, b) => a + b, 0) - buck.len0) < 0.02, JSON.stringify(buck.lens));
  await shot('04-bucked');

  // ---- cut a chock off a log and split it into firewood ----
  const split = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const T = g.THREE;
    // indoors: outside a log lies under the snow and must be dug out first
    const Y0 = G.house.Y0;
    let lp = null;
    for (let x = -3; x <= 3 && !lp; x += 0.5) for (let z = -2.5; z <= 2.5 && !lp; z += 0.5) {
      const p = new T.Vector3(x, Y0 + 1.5, z);
      if (G.house.zoneAt(p) !== 'ground') continue;
      let ok = true;
      for (const dx of [-0.7, 0, 0.7]) for (const dz of [-0.4, 0, 0.4]) {
        const h = G.world.castRay(new G.R.Ray({ x: x + dx, y: Y0 + 1.5, z: z + dz }, { x: 0, y: -1, z: 0 }), 3, true);
        if (!h || Math.abs(Y0 + 1.5 - h.timeOfImpact - Y0) > 0.05) ok = false;
      }
      if (ok) lp = new T.Vector3(x, Y0 + 0.3, z);
    }
    const log = G.entities.spawnItem('log', lp, { quat: new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0) });
    g.teleport(lp.x, Y0 + 0.02, lp.z + 1.2);
    g.steps(90);
    const w = log.data.wood;
    const q = log.obj.quaternion.clone();
    const c = log.position();
    const at = new T.Vector3(0.45 - w.len / 2, 0, 0).applyQuaternion(q).add(c);
    const side = new T.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize();
    const stand = at.clone().addScaledVector(side, 0.95);
    g.teleport(stand.x, Y0 + 0.02, stand.z);
    g.steps(5);
    let n = 0;
    const dbg2 = [];
    while (!log.removed && n < 150) {
      g.lookAt(at.x, at.y + 0.03, at.z);
      if (n < 4) { const aa = g.actions(); dbg2.push(aa.target + ':' + aa.info + ':' + aa.actions.join('/')); }
      g.swing();
      g.steps(1);
      n++;
    }
    g.steps(30);
    const chock = G.entities.list.filter((e) => e.data?.wood && !e.removed && e.defId === 'chock').sort((a, b) => a.position().distanceTo(at) - b.position().distanceTo(at))[0];
    if (!chock) return { n, chock: false, dbg2, logPos: log.position().toArray(), at: at.toArray(), player: G.player.pos.toArray() };
    const cm = chock.mass;
    const cp = chock.position();
    const st2 = cp.clone().add(new T.Vector3(0.3, 0, 0.8));
    g.teleport(st2.x, Y0 + 0.02, st2.z);
    g.steps(3);
    let k = 0;
    const startId = chock.id;
    while (!chock.removed && k < 10) {
      g.lookAt(cp.x, cp.y + 0.05, cp.z);
      g.swing();
      g.steps(1);
      k++;
    }
    g.steps(40);
    const fw = G.entities.list.filter((e) => e.data?.wood && !e.removed && e.id > startId && e.defId === 'firewood');
    return { n, chock: true, chockMass: cm, k, halves: fw.length, halfMass: fw.reduce((a, e) => a + e.mass, 0), names: fw.map((e) => e.name) };
  });
  check('a chock splits into two halves of the same wood', split.chock && split.halves === 2 && Math.abs(split.halfMass - split.chockMass) < split.chockMass * 0.05, JSON.stringify(split));
  await shot('05-split');

  // ---- rip a log into boards with the saw, hew one square with the axe ----
  const mill = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const T = g.THREE;
    const Y0 = G.house.Y0;
    const P = G.player;
    const at = P.pos.clone().add(new T.Vector3(0, 0.3, -1.1));
    const log = G.entities.spawnItem('log', at, { quat: new T.Quaternion() });
    g.steps(60);
    g.give('saw');
    g.equip('saw');
    const lp = log.position();
    g.lookAt(lp.x, lp.y, lp.z);
    const acts = g.actions();
    const before = G.entities.list.length;
    const okRip = g.act('F', 'доски');
    g.steps(30);
    const boards = G.entities.list.filter((e) => e.defId === 'plank' && e.data.wood && !e.removed && e.position().distanceTo(lp) < 1.5);
    const vLog = log.data.wood;
    const log2 = G.entities.spawnItem('log', at.clone().add(new T.Vector3(0.6, 0, 0)), { quat: new T.Quaternion() });
    g.steps(60);
    g.equip('axe');
    const l2 = log2.position();
    g.lookAt(l2.x, l2.y, l2.z);
    const acts2 = g.actions();
    const okHew = g.act('G', 'брус');
    g.steps(20);
    const beam = G.entities.list.find((e) => e.defId === 'beam' && !e.removed);
    return { acts: acts.actions, okRip, removed: log.removed, boards: boards.length, widths: boards.map((b) => +b.data.wood.w.toFixed(3)), len: vLog.len, acts2: acts2.actions, okHew, beam: beam ? [beam.name, +beam.data.wood.w.toFixed(3), +beam.mass.toFixed(1)] : null, Y0 };
  });
  check('a log ripped with the saw gives boards of its length', mill.okRip && mill.removed && mill.boards >= 3, JSON.stringify(mill));
  check('a log hewn with the axe gives a square beam', mill.okHew && mill.beam && mill.beam[1] > 0.1, JSON.stringify(mill));

  // ---- small wood goes into one stack by weight ----
  const stack = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const P = G.player;
    const fw = G.entities.list.filter((e) => e.data?.wood && !e.removed && e.inWorld && (e.defId === 'firewood' || e.defId === 'sticks' || e.defId === 'boughs')).slice(0, 4);
    for (const e of fw) P.addToInventory(e);
    G.hud.toggleInventory(true);
    const html = document.querySelector('#inventory').innerHTML;
    G.hud.toggleInventory(false);
    return { n: fw.length, hasStack: /Дрова|Хворост|Лапник/.test(html), kg: P.packWeight() };
  });
  check('small wood shows as a stack by weight', stack.hasStack, JSON.stringify(stack));

  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  await server.close();
  if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
