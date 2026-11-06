// Caves in the browser (?cave=1, seed 42): walking into a mouth fades into the cave and back
// out of it, inside the outdoor world is hidden and the sun is off, it is dark without a light
// and the flashlight shows the rock, the game's controller walks to the first hall, things in a
// cave stay in the cave, and nothing errors.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(__dirname, '../test-results/caves');
fs.mkdirSync(OUT, { recursive: true });
let checks = 0;
function check(name, ok, data) { assert.ok(ok, `${name}: ${JSON.stringify(data)}`); checks++; console.log('PASS ', name, data ? JSON.stringify(data) : ''); }
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 5211, strictPort: true, hmr: false }, logLevel: 'error' });
  let browser;
  const stop = async () => { await browser?.close(); await server.close(); process.exit(130); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await server.listen();
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !m.location().url?.endsWith('/favicon.ico')) errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5211/?cave=1&test=1');
    await page.waitForFunction(() => window.__game?.G.snow || document.querySelector('#loading pre'), null, { timeout: 240000 });
    const failed = await page.evaluate(() => document.querySelector('#loading pre')?.textContent);
    check('the world loads with caves', !failed, failed);
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const shot = async (name) => {
      await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 240000 });
    };
    // how much of what the camera sees is clearly lit, percent of pixels
    const brightness = () => ev(() => {
      const { G, THREE } = window.__game, r = G.renderer, rt = new THREE.WebGLRenderTarget(96, 60);
      G.sky.update();
      r.setRenderTarget(rt); r.clear(); r.render(G.scene, G.camera); r.setRenderTarget(null);
      const px = new Uint8Array(96 * 60 * 4);
      r.readRenderTargetPixels(rt, 0, 0, 96, 60, px);
      rt.dispose();
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2] > 18) lit++;
      return +((100 * lit) / (96 * 60)).toFixed(1);
    });
    await ev(() => { const g = window.__game; g.setManualStepping(true); g.G.input.enabled = true; g.steps(20); });
    const start = await ev(() => {
      const { G } = window.__game, s = G.caves.stats();
      const c = [...G.region.caves].map((q, i) => ({ i, d: Math.hypot(q.x - G.player.pos.x, q.z - G.player.pos.z) })).sort((a, b) => a.d - b.d)[0];
      return { ...s, nearest: c.i, distance: +c.d.toFixed(1) };
    });
    check('the cave laboratory starts in front of a mouth', start.caves >= 3 && start.distance < 9 && start.current === -1, start);
    await shot('mouth');

    // walk in: the fade starts in the throat and ends inside
    const inside = await ev((cave) => {
      const g = window.__game, { G } = g, phases = new Set();
      G.input.keys.add('KeyW');
      for (let k = 0; k < 160 && G.caves.current < 0; k++) { g.steps(6); G.caves.update(0.1); phases.add(G.caves.stats().phase); }
      for (let k = 0; k < 6; k++) { g.steps(6); G.caves.update(0.1); }
      G.input.keys.clear();
      g.simulate(1);
      const terrain = G.scene.children.find((o) => o.children?.some?.((c) => c.name === 'terrain'));
      return { current: G.caves.current, phases: [...phases], sun: G.sky.sun.intensity, hemi: +G.sky.hemi.intensity.toFixed(3), dome: G.sky.dome.visible,
        snowfall: G.weather.points.visible, terrain: terrain ? terrain.visible : null, env: G.caves.envAt(G.player.pos), out: +G.weather.temp.toFixed(1), cave };
    }, start.nearest);
    check('walking into the mouth fades into that cave', inside.current === start.nearest && inside.phases.includes('out'), inside);
    check('inside, the outdoor world, the sky and the snowfall are hidden and the sun is off', inside.sun === 0 && !inside.dome && !inside.snowfall && inside.terrain === false && inside.hemi < 0.06, inside);
    check('the cave air is still and between the outdoor air and the cold of the rock', inside.env.wind < 1 && inside.env.air >= Math.min(inside.out, -3) - 0.01 && inside.env.air <= Math.max(inside.out, -3) + 0.01, inside.env);
    await shot('throat');

    // the first hall: dark without a light, the flashlight shows it
    const hall = await ev((cave) => {
      const g = window.__game, { G } = g, b = G.caves.builds[cave], f = G.caves.interiors[cave].frame;
      const toWorld = (x, y, z) => ({ x: f.x + x * Math.cos(f.yaw) + z * Math.sin(f.yaw), y: f.y + y, z: f.z - x * Math.sin(f.yaw) + z * Math.cos(f.yaw) });
      const leaf = b.nodes.findIndex((n) => n.kind === 'hall');
      const route = b.routeTo(leaf).map((n) => toWorld(n.x, n.y, n.z));
      // the real player, steered at each waypoint
      let i = 1, t = 0;
      G.input.keys.add('KeyW');
      while (i < route.length && t < 90) {
        const w = route[i], p = G.player.pos, dx = w.x - p.x, dz = w.z - p.z;
        if (Math.hypot(dx, dz) < 1.0) { i++; continue; }
        G.player.yaw = Math.atan2(-dx, -dz);
        g.steps(6); G.caves.update(0.1); t += 0.1;
      }
      G.input.keys.clear(); g.steps(10);
      // look on along the way into the hall, a little down: floor and rock within the beam
      const c = route[route.length - 1], b0 = route[route.length - 2], L = Math.hypot(c.x - b0.x, c.z - b0.z) || 1;
      g.lookAt(c.x + ((c.x - b0.x) / L) * 6, c.y + 0.6, c.z + ((c.z - b0.z) / L) * 6);
      return { reached: i, of: route.length, seconds: +t.toFixed(1), depth: +G.caves.envAt(G.player.pos).depth.toFixed(1), current: G.caves.current };
    }, start.nearest);
    check('the game\'s controller walks from the throat to the first hall', hall.reached === hall.of && hall.current === start.nearest && hall.depth > 12, hall);
    const dark = await brightness();
    await ev(() => { const g = window.__game, { G } = g; g.give('flashlight', { charges: 100 }); g.equip('flashlight'); G.player.equipped.lit = true; g.simulate(0.5); });
    const lit = await brightness();
    const tris = await ev(() => { const { G } = window.__game; G.renderer.info.autoReset = true; G.renderer.render(G.scene, G.camera); return G.renderer.info.render.triangles; });
    check('a hall is dark without a light, and the flashlight shows the rock', dark < 0.5 && lit > 3 && lit > dark * 4, { darkPercentLit: dark, flashlightPercentLit: lit });
    check('what is drawn inside a cave stays within budget', tris < 250000, { tris });
    await shot('hall-flashlight');

    // the camp: its things lie on the cave floor and stay there
    const camp = await ev((cave) => {
      const { G } = window.__game, f = G.caves.interiors[cave].frame;
      const near = G.entities.list.filter((e) => e.inWorld && !e.removed && Math.abs(e.position().x - f.x) < 200);
      const ys = near.map((e) => e.position().y - f.y);
      return { things: near.length, minY: +Math.min(...ys).toFixed(1), maxY: +Math.max(...ys).toFixed(1), box: G.caves.builds[cave].box };
    }, start.nearest);
    check('the camp and caches lie on the floor of the cave', camp.things >= 3 && camp.minY > camp.box.minY - 1 && camp.maxY < camp.box.maxY, camp);

    // out again: walk to the light
    const out = await ev((cave) => {
      const g = window.__game, { G } = g, f = G.caves.interiors[cave].frame;
      const p = { x: f.x + 0 * Math.cos(f.yaw) + 6 * Math.sin(f.yaw), z: f.z - 0 * Math.sin(f.yaw) + 6 * Math.cos(f.yaw) };
      G.player.teleport(new G.player.pos.constructor(p.x, f.y + 0.6, p.z));
      g.steps(20);
      G.player.yaw = f.yaw; // facing the mouth: forward is −local z
      G.input.keys.add('KeyW');
      for (let k = 0; k < 120 && G.caves.current >= 0; k++) { g.steps(6); G.caves.update(0.1); }
      for (let k = 0; k < 6; k++) { g.steps(6); G.caves.update(0.1); }
      G.input.keys.clear();
      g.simulate(0.5);
      const s = G.region.caves[cave];
      return { current: G.caves.current, dome: G.sky.dome.visible, snowfall: G.weather.points.visible, sun: +G.sky.sun.intensity.toFixed(2),
        fromMouth: +Math.hypot(G.player.pos.x - s.x, G.player.pos.z - s.z).toFixed(1), y: +(G.player.pos.y - s.y).toFixed(2) };
    }, start.nearest);
    check('walking to the light brings you out of the mouth, with the world and the sun back', out.current === -1 && out.dome && out.snowfall && out.sun > 0 && out.fromMouth < 8 && Math.abs(out.y) < 1.5, out);
    await shot('back-outside');
    check('no page errors', errors.length === 0, errors.slice(0, 5));
    console.log(`${checks} cave browser checks passed; images in ${OUT}`);
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
