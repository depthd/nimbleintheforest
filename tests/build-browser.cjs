// Structures made of real pieces, in the real game: they stand, carry snow, and come
// down when a support is cut or pulled out. Usage: node tests/build-browser.cjs [outDir]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const OUT = process.argv[2] || path.join(__dirname, '..', 'test-results', 'build');
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!ok) failures++;
}

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 5203, strictPort: false, hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  const port = server.config.server.port;
  const url = `http://localhost:${port}/?test=1&seed=${process.env.SEED || 42}&hour=12&weather=clear`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
  await page.waitForTimeout(800);
  const shot = (n) => page.screenshot({ timeout: 180000, path: path.join(OUT, n + '.png') });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  const start = await ev(() => {
    const G = window.__game.G;
    return G.build.structures.map((s) => ({ name: s.name, parts: s.parts.size, built: s.built, joints: s.joints.length, snow: +s.snow.toFixed(3) }));
  });
  const leantos = start.filter((s) => s.name === 'Навес');
  const stacks = start.filter((s) => s.name === 'Штабель брёвен');
  check('lean-tos stand on their own', leantos.length > 0 && leantos.every((s) => s.parts === s.built && s.parts >= 12), JSON.stringify(leantos));
  check('log stacks stand on their own', stacks.length === 0 || stacks.every((s) => s.parts === s.built), JSON.stringify(stacks));

  // ---- look at a lean-to ----
  const view = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const T = g.THREE;
    const p = G.structures.places.find((x) => x.kind === 'leanto');
    const fwd = new T.Vector3(0, 0, 1).applyAxisAngle(new T.Vector3(0, 1, 0), p.yaw);
    const at = new T.Vector3(p.x, 0, p.z).addScaledVector(fwd, 4.5);
    g.teleport(at.x, G.terrain.heightAt(at.x, at.z) + 0.05, at.z);
    G.forest.update(G.player.pos, true);
    g.steps(10);
    g.lookAt(p.x, p.y + 1.3, p.z);
    return { x: p.x, z: p.z };
  });
  await page.waitForTimeout(400);
  await shot('01-leanto');

  // ---- cut one post: the lean-to comes down ----
  const cut = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const T = g.THREE;
    const p = G.structures.places.find((x) => x.kind === 'leanto');
    const S = G.build.structures.find((s) => s.name === 'Навес' && [...s.parts.values()].some((e) => e.position().distanceTo(new T.Vector3(p.x, p.y, p.z)) < 4));
    const before = S.parts.size;
    const post = [...S.parts.values()].filter((e) => S.joints.some((j) => j.a === e.id && j.b === -1 && j.kind === 'set') && Math.abs(new T.Vector3(1, 0, 0).applyQuaternion(e.obj.quaternion).y) > 0.9)[0];
    g.give('axe');
    g.equip('axe');
    const pp = post.position();
    const fwd = new T.Vector3(0, 0, 1).applyAxisAngle(new T.Vector3(0, 1, 0), p.yaw);
    const stand = pp.clone().addScaledVector(fwd, 0.9);
    g.teleport(stand.x, G.terrain.heightAt(stand.x, stand.z) + 0.05, stand.z);
    g.steps(5);
    const target = new T.Vector3(pp.x, G.terrain.heightAt(pp.x, pp.z) + 0.9, pp.z);
    let n = 0;
    const acts = [];
    while (S.parts.size === before && n < 80) {
      g.lookAt(target.x, target.y, target.z);
      if (n < 2) acts.push(g.actions());
      g.swing();
      g.steps(1);
      n++;
    }
    for (let i = 0; i < 240; i++) g.steps(1);
    const loose = G.entities.list.filter((e) => e.kind === 'item' && e.data?.wood && e.position().distanceTo(new T.Vector3(p.x, p.y, p.z)) < 6).length;
    return { before, after: S.parts.size, n, loose, collapsed: S.collapsed, acts };
  });
  check('cutting a post brings the lean-to down', cut.after < cut.before * 0.5 && cut.collapsed, JSON.stringify(cut));
  check('the fallen parts are loose pieces', cut.loose >= cut.before - cut.after - 1, JSON.stringify(cut));
  await shot('02-collapsed');

  // ---- snow: another lean-to holds a little and breaks under a lot ----
  const snow = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const all = G.build.structures.filter((s) => s.name === 'Навес' && !s.collapsed && s.parts.size === s.built);
    if (!all.length) return { none: true };
    const S = all[0];
    S.snow = 0.25;
    G.build.check(S, true);
    const light = S.parts.size;
    const loads = [...S.parts.values()].map((e) => e.data.load || 0);
    S.snow = 2.0;
    G.build.check(S);
    return { light, built: S.built, heavy: S.parts.size, worstAtLight: Math.max(...loads).toFixed(2) };
  });
  check('a lean-to carries some snow and breaks under a heavy load', snow.none || (snow.light === snow.built && snow.heavy < snow.built), JSON.stringify(snow));

  // ---- a log stack: pull out a bottom log and the upper ones roll ----
  const stack = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const T = g.THREE;
    const S = G.build.structures.find((s) => s.name === 'Штабель брёвен' && s.parts.size === s.built);
    if (!S) return { none: true };
    const parts = [...S.parts.values()];
    const c = parts.reduce((v, e) => v.add(e.position()), new T.Vector3()).multiplyScalar(1 / parts.length);
    g.teleport(c.x + 3, G.terrain.heightAt(c.x + 3, c.z) + 0.05, c.z + 3);
    G.forest.update(G.player.pos, true);
    g.steps(20);
    g.lookAt(c.x, c.y, c.z);
    // a log of the bottom layer that others rest on
    const bottom = parts.filter((e) => S.joints.some((j) => j.b === e.id) && S.joints.some((j) => j.a === e.id && S.parts.get(j.b) && S.joints.some((k) => k.a === j.b && k.b === -1)));
    const victim = bottom.find((e) => G.build.carried(e) >= 2) || bottom[0];
    const before = S.parts.size;
    const carried = G.build.carried(victim);
    G.build.takeOut(victim);
    for (let i = 0; i < 200; i++) g.steps(1);
    return { before, after: S.parts.size, carried };
  });
  check('pulling a lower log out lets the upper ones roll', stack.none || stack.after < stack.before - 1, JSON.stringify(stack));
  await shot('03-stack');

  // ---- log huts: whole on their own; boards off lets the wind in; a cut wall log holds ----
  const hut = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const T = g.THREE;
    const huts = G.build.structures.filter((s) => s.name === 'Заимка' || s.name === 'Рыбацкая избушка');
    const whole = huts.every((s) => s.parts.size === s.built && s.built > 60);
    const S = huts.find((s) => s.name === 'Заимка');
    const p = G.structures.places.find((x) => x.kind === 'hut' && [...S.parts.values()].some((e) => e.position().distanceTo(new T.Vector3(x.x, e.position().y, x.z)) < 4));
    const fwd = new T.Vector3(0, 0, 1).applyAxisAngle(new T.Vector3(0, 1, 0), p.yaw);
    const side = new T.Vector3(1, 0, 0).applyAxisAngle(new T.Vector3(0, 1, 0), p.yaw);
    const at = new T.Vector3(p.x, 0, p.z).addScaledVector(fwd, 6).addScaledVector(side, 3);
    g.teleport(at.x, G.terrain.heightAt(at.x, at.z) + 0.05, at.z);
    G.forest.update(G.player.pos, true);
    g.steps(10);
    g.lookAt(p.x, p.y + 1.6, p.z);
    const sh = G.structures.shelters.find((b) => Math.hypot(b.cx - p.x, b.cz - p.z) < 0.5);
    return { whole, counts: huts.map((s) => `${s.parts.size}/${s.built}`), wind0: sh.shelter.wind, x: p.x, z: p.z, yaw: p.yaw };
  });
  check('log huts stand whole', hut.whole, JSON.stringify(hut.counts));
  await page.waitForTimeout(400);
  await shot('05-hut');
  const hut2 = await ev((h) => {
    const g = window.__game;
    const G = g.G;
    const T = g.THREE;
    const S = G.build.structures.find((s) => s.name === 'Заимка' && [...s.parts.values()].some((e) => Math.hypot(e.position().x - h.x, e.position().z - h.z) < 4));
    const sh = G.structures.shelters.find((b) => Math.hypot(b.cx - h.x, b.cz - h.z) < 0.5);
    // a wall log beside the doorway, cut through in the middle: the wall above still holds
    const fwd = new T.Vector3(0, 0, 1).applyAxisAngle(new T.Vector3(0, 1, 0), h.yaw);
    const walls = [...S.parts.values()].filter((e) => e.data.role === 'wall');
    const front = walls.filter((e) => e.position().clone().sub(new T.Vector3(h.x, e.position().y, h.z)).dot(fwd) > 1 && e.data.wood.len < 2.2);
    const log = front.sort((a, b) => Math.abs(a.position().y - (G.terrain.heightAt(h.x, h.z) + 1.2)) - Math.abs(b.position().y - (G.terrain.heightAt(h.x, h.z) + 1.2)))[0];
    const before = S.parts.size;
    const lp = log.position();
    const stand = lp.clone().addScaledVector(fwd, 1.0);
    g.give('axe');
    g.equip('axe');
    g.teleport(stand.x, G.terrain.heightAt(stand.x, stand.z) + 0.05, stand.z);
    g.steps(5);
    let n = 0;
    const id = log.id;
    while (S.parts.has(id) && n < 60) {
      g.lookAt(lp.x, lp.y, lp.z);
      g.swing();
      g.steps(1);
      n++;
    }
    for (let i = 0; i < 30; i++) g.steps(1);
    const afterCut = S.parts.size;
    // take the roof boards off one by one
    let boards = 0;
    for (const e of [...S.parts.values()].filter((x) => x.data.role === 'roof')) {
      if (!G.build.loosePart(e)) continue;
      G.build.takeOut(e);
      boards++;
    }
    for (let i = 0; i < 30; i++) g.steps(1);
    return { n, before, afterCut, boards, wind1: sh ? sh.shelter.wind : null, warm1: sh ? sh.shelter.warm : null, stuck: G.build.whyStuck(walls[0]) };
  }, hut);
  check('a cut wall log does not bring the hut down', hut2.afterCut >= hut2.before && hut2.n < 60, JSON.stringify(hut2));
  check('without the roof boards the wind gets in', hut2.boards > 10 && hut2.wind1 > hut.wind0 + 0.15, JSON.stringify({ ...hut2, wind0: hut.wind0 }));
  check('a lower wall log is pinned by the wall above', hut2.stuck === 'придавлено сверху', hut2.stuck);
  await shot('06-hut-open');

  // ---- build by hand: two posts dug in, a crossbar on them, a board on the crossbar ----
  const hand = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const T = g.THREE;
    const P = G.player;
    // an open flat spot near the house
    let base = null;
    for (let r = 12; r < 60 && !base; r += 3) for (let a = 0; a < 6.28 && !base; a += 0.4) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!Number.isNaN(G.region.waterAt(x, z)) || G.region.slopeAt(x, z) > 0.15 || G.forest.treesNear(x, z, 4).length) continue;
      if (G.house.zoneAt(new T.Vector3(x, G.terrain.heightAt(x, z) + 1, z))) continue;
      base = new T.Vector3(x, G.terrain.heightAt(x, z), z);
    }
    g.teleport(base.x - 2, G.terrain.heightAt(base.x - 2, base.z) + 0.05, base.z - 2);
    G.forest.update(P.pos, true);
    g.steps(10);
    g.give('shovel');
    const out = {};
    const upright = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), Math.PI / 2);
    const holdAt = (e, pos, q) => {
      P.carry(e);
      e.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
      e.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      G.build.placement.update(1);
      return G.build.placement.plan;
    };
    const posts = [];
    for (const dx of [0, 2.4]) {
      const e = G.entities.spawnItem('pole', base.clone().add(new T.Vector3(dx, 2, 0)));
      const len = e.data.wood.len;
      const at = new T.Vector3(base.x + dx, G.terrain.heightAt(base.x + dx, base.z) + len / 2 + 0.02, base.z);
      const plan = holdAt(e, at, upright);
      out['post' + dx] = { ok: plan.ok, upright: plan.upright, foot: plan.footOnGround, info: G.build.placement.info() };
      G.build.placement.place({ dig: true });
      g.steps(1);
      posts.push(e);
    }
    out.posts = posts.map((e) => e.kind);
    const S = G.build.of(posts[0]);
    out.sameStructure = S && G.build.of(posts[1]) === S ? false : true;
    // the crossbar, held a bit above the tops: it settles onto them
    const bar = G.entities.spawnItem('pole', base.clone().add(new T.Vector3(1.2, 3, 1)));
    const topY = Math.max(...posts.map((e) => e.position().y + e.data.wood.len / 2));
    const plan = holdAt(bar, new T.Vector3(base.x + 1.2, topY + 0.25, base.z), new T.Quaternion());
    out.barPlan = { ok: plan.ok, holds: plan.holds, on: plan.on, info: G.build.placement.info() };
    G.build.placement.place();
    g.steps(1);
    const S2 = G.build.of(bar);
    out.bar = bar.kind;
    out.parts = S2 ? S2.parts.size : 0;
    out.barRests = S2 ? S2.joints.filter((j) => j.a === bar.id && j.b >= 0).length : 0;
    // a board laid with one end on the crossbar tips off; nailed, it stays
    const barY = bar.position().y;
    const board = G.entities.spawnItem('plank', base.clone().add(new T.Vector3(0, 3, 2)));
    const p1 = holdAt(board, new T.Vector3(base.x + 1.2, barY + 0.2, base.z + 0.5), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2));
    out.boardPlan = { ok: p1.ok, holds: p1.holds, why: p1.why };
    G.build.placement.place();
    out.boardLoose = board.kind;
    for (let i = 0; i < 60; i++) g.steps(1);
    g.give('hammer');
    g.give('nails', { charges: 16 });
    const board2 = G.entities.spawnItem('plank', base.clone().add(new T.Vector3(0, 3, 3)));
    const p2 = holdAt(board2, new T.Vector3(base.x + 1.2, barY + 0.2, base.z + 0.3), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2));
    out.board2Plan = { ok: p2.ok };
    G.build.placement.place({ nails: true });
    out.board2 = board2.kind;
    out.nailsLeft = P.inventory.find((x) => x.defId === 'nails')?.charges;
    g.lookAt(base.x + 1.2, barY, base.z);
    return out;
  });
  check('posts dug in by hand stand', hand.posts.every((k) => k === 'part'), JSON.stringify(hand));
  check('a crossbar laid on two posts holds', hand.bar === 'part' && hand.barRests >= 2 && hand.barPlan.holds, JSON.stringify(hand));
  check('a board on one end tips off; nailed it stays', hand.boardLoose === 'item' && hand.board2 === 'part' && hand.nailsLeft < 16, JSON.stringify(hand));
  await page.waitForTimeout(300);
  await shot('04-handbuilt');

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
