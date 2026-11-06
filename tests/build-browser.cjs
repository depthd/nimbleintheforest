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
