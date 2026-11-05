// Actual Rapier movement + continuous boots + Three.js pool, not a fake gait.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(__dirname, '../test-results/snow');
fs.mkdirSync(OUT, { recursive: true });
const checks = [];
function check(name, ok, detail) { assert.ok(ok, `${name}: ${JSON.stringify(detail)}`); checks.push(name); console.log('PASS ', name, detail ? JSON.stringify(detail) : ''); }
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 5202, strictPort: true, hmr: false }, logLevel: 'error' });
  let browser;
  const stop = async () => { await browser?.close(); await server.close(); process.exit(130); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await server.listen();
    browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url?.endsWith('/favicon.ico')) errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto('http://127.0.0.1:5202/?snow=1&test=1');
    await page.waitForFunction(() => window.__game?.G.snow, null, { timeout: 180000 });
    const ev = (fn, arg) => page.evaluate(fn, arg);
    if (process.env.SNOW_BENCH_ONLY === '1') {
      const benchmark = await require('./snow-benchmark.cjs')(page);
      check('isolated benchmark has no browser errors', errors.length === 0, errors);
      fs.writeFileSync(path.join(OUT, 'benchmark.json'), JSON.stringify({ benchmark, errors }, null, 2));
      for (const c of benchmark) {
        const median = a => a.slice().sort((a, b) => a - b)[Math.floor(a.length / 2)];
        const sorted = c.simulation.slice().sort((a, b) => a - b);
        console.log(JSON.stringify({ enabled: c.enabled, medianFrameMs: median(c.frames), medianSimulationMs: median(c.simulation), p95SimulationMs: sorted[Math.floor(sorted.length * 0.95)], maxSimulationMs: sorted.at(-1), calls: c.calls, triangles: c.triangles }));
      }
      return;
    }
    const shot = async name => {
      await ev(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    };
    await ev(() => {
      const g = window.__game; g.setManualStepping(true); g.G.input.enabled = true; g.G.input.keys.clear(); g.steps(120);
    });
    let result = await ev(() => {
      const g = window.__game, s = g.G.snow, m = g.G.player.avatar.motion;
      const before = m.feet.map(f => s.field.sample(f.position.x, f.position.z).height);
      const serial = m.stepSerial; g.steps(600);
      return { before, after: m.feet.map(f => s.field.sample(f.position.x, f.position.z).height), serial, afterSerial: m.stepSerial, reach: g.animation().reachErrors };
    });
    check('a real standing character compresses snow and then settles silently', result.before.every(h => h < 0.17) && result.after.every((h, i) => Math.abs(h - result.before[i]) < 0.003) && result.serial === result.afterSerial, result);
    await shot('01-standing');
    const walk = await ev(() => {
      const g = window.__game, { G } = g, s = G.snow, contacts = [], cost = [];
      const before = G.player.pos.clone(); let drift = 0, reach = 0, lift = 0, falseAir = 0;
      const trace = [];
      G.input.keys.add('KeyW');
      for (let i = 0; i < 300; i++) {
        const old = G.player.avatar.motion.feet.map(f => ({ p: f.position.clone(), grounded: f.grounded }));
        const t = performance.now(); g.steps(1); s.renderer.update(G.player.pos); cost.push(performance.now() - t);
        const m = G.player.avatar.motion;
        if (!G.player.grounded || m.feet.every(f => !f.grounded && !f.swinging)) falseAir++;
        m.feet.forEach((f, j) => { lift = Math.max(lift, f.lift); if (old[j].grounded && f.grounded && !f.swinging) drift = Math.max(drift, Math.hypot(f.position.x - old[j].p.x, f.position.z - old[j].p.z)); });
        contacts.push(...m.contacts.map(c => ({ x: c.position.x, z: c.position.z, side: c.side })));
        if (i % 3 === 0) trace.push(m.snapshot());
        if (i % 30 === 0) reach = Math.max(reach, ...g.animation().reachErrors);
      }
      G.input.keys.clear(); g.steps(90);
      return { distance: before.distanceTo(G.player.pos), drift, reach, lift, falseAir,
        alternating: contacts.every((c, i) => i === 0 || c.side !== contacts[i - 1].side), contacts: contacts.length,
        deformed: contacts.filter(p => s.field.sample(p.x, p.z).height < 0.2).length, cost, trace, stats: s.stats() };
    });
    fs.writeFileSync(path.join(OUT, 'walk-trace.json'), JSON.stringify(walk.trace, null, 2));
    check('real walking cuts contact-aligned tracks and lifts boots clear of the deep layer', walk.distance > 3 && walk.contacts >= 5 && walk.deformed >= walk.contacts - 1 && walk.lift > 0.18 && walk.reach < 0.025 && walk.drift < 1e-5, { ...walk, cost: undefined, trace: undefined });
    check('changing snow support never causes phantom falls or resets both feet', walk.falseAir === 0 && walk.alternating, { falseAir: walk.falseAir, alternating: walk.alternating });
    await shot('02-walk-side');
    await ev(() => {
      const { G } = window.__game, a = G.player.avatar, draw = a.render.bind(a);
      window.__snowDraw = draw;
      a.render = (alpha, dt) => { draw(alpha, dt); a.inspectionCamera.position.copy(G.player.pos).add(new window.__game.THREE.Vector3(2.4, 3.2, 3.8)); a.inspectionCamera.lookAt(G.player.pos.clone().add(new window.__game.THREE.Vector3(0, 0.1, 1))); };
    });
    await shot('03-tracks');
    const motionTrace = [];
    await ev(() => { window.__game.G.input.keys.add('KeyW'); });
    for (let i = 0; i < 8; i++) { motionTrace.push(await ev(() => { const g = window.__game; g.steps(5); return g.animation(); })); await shot(`motion-${String(i).padStart(2, '0')}`); }
    await ev(() => { const g = window.__game; g.G.input.keys.clear(); g.G.player.avatar.render = window.__snowDraw; g.steps(60); });

    result = await ev(() => {
      const g = window.__game, { G } = g, s = G.snow;
      s.firm = true; s.reset(); g.steps(120);
      const before = G.player.pos.clone(), standing = G.player.avatar.motion.feet.map(f => f.position.y - s.baseY);
      G.input.keys.add('KeyW'); g.steps(300); G.input.keys.clear(); g.steps(90);
      return { distance: before.distanceTo(G.player.pos), standing, reach: g.animation().reachErrors };
    });
    check('dense snow supports feet higher and allows faster actual travel', result.distance > walk.distance * 1.15 && result.standing.every(y => y > 0.2) && result.reach.every(e => e < 0.025), result);
    await shot('04-firm');

    result = await ev(() => {
      const g = window.__game, { G } = g, s = G.snow; s.reset(); g.steps(120);
      G.input.pressed.add('Space'); g.steps(1); G.input.pressed.clear();
      let air = 0, marked = 0;
      for (let i = 0; i < 50; i++) {
        const high = G.player.avatar.motion.feet.every(f => f.position.y > s.baseY + 0.55);
        const before = high ? s.field.stats().modifiedCells : 0; g.steps(1);
        if (high && G.player.avatar.motion.feet.every(f => f.position.y > s.baseY + 0.55)) { air++; marked += s.field.stats().modifiedCells - before; }
      }
      g.steps(120); return { air, marked, grounded: G.player.grounded, reach: g.animation().reachErrors };
    });
    check('a real jump cannot carve snow while the boots are clear of it', result.air > 5 && result.marked === 0 && result.grounded && result.reach.every(e => e < 0.025), result);

    result = await ev(() => {
      const g = window.__game, { G } = g, s = G.snow; s.firm = false; s.reset(); g.steps(120);
      const p = s.treasure; g.teleport(p.x, s.baseY + 0.15, p.z + 1.25); g.steps(90); g.lookAt(p.x, p.y, p.z);
      const buried = g.actions(); let volume = 0;
      for (let i = 0; i < 8; i++) volume += s.field.remove(p.x, p.z, 0.38, 0.09);
      const exposed = g.actions(); s.field.add(p.x, p.z, 0.38, volume);
      const reburied = g.actions();
      for (let i = 0; i < 8; i++) s.field.remove(p.x, p.z, 0.38, 0.09);
      const taken = g.act('E', 'Взять');
      return { buried, exposed, reburied, taken, inInventory: G.player.inventory.some(e => e.defId === 'knife'), mass: s.field.massChange() };
    });
    check('buried knife is blocked, digging exposes it, refilling blocks it again, then E picks it up', result.buried.target === 'ground' && result.exposed.target === 'entity' && result.reburied.target === 'ground' && result.taken && result.inInventory, result);
    await shot('05-excavated');
    // Real mouse buttons, through the same frame update a person uses.
    await ev(() => { const g = window.__game, s = g.G.snow; g.lookAt(40, s.baseY, 61); g.G.paused = false; g.G.input.lmb = true; });
    await page.waitForFunction(() => window.__game.G.snow.carriedSnow > 0, null, { timeout: 10000 });
    await ev(() => { const g = window.__game; g.G.input.lmb = false; g.G.input.rmb = true; window.__bucketBefore = g.G.snow.carriedSnow; });
    await page.waitForFunction(() => window.__game.G.snow.carriedSnow < window.__bucketBefore, null, { timeout: 10000 });
    await ev(() => { window.__game.G.input.rmb = false; window.__game.setManualStepping(true); });
    check('actual mouse controls remove and redeposit a finite quantity', true);

    result = await ev(() => {
      const g = window.__game, { G } = g, s = G.snow; s.reset(); g.steps(90);
      g.teleport(40, s.baseY + 0.4, 40); g.steps(120);
      const feet = G.player.avatar.motion.feet.map(f => ({ y: f.position.y - s.baseY, depth: G.player.avatar.probe(f.position.x, f.position.z, G.player.pos.y)?.snowDepth }));
      return { feet, underPlank: s.field.sample(40, 40).height, reach: g.animation().reachErrors };
    });
    check('solid plank wins over soft support and leaves no phantom trench beneath it', result.feet.every(f => f.y > 0.34 && f.depth === undefined) && result.underPlank === 0.28 && result.reach.every(e => e < 0.025), result);

    const long = await ev(() => {
      const g = window.__game, { G } = g, s = G.snow; s.reset(); g.steps(90);
      const before = { ...s.stats(), geometries: G.renderer.info.memory.geometries, colliders: G.world.colliders.len() };
      let distance = 0, maxBoot = 0, maxRender = 0;
      for (let lap = 0; lap < 8; lap++) {
        G.input.keys.clear(); G.input.keys.add(lap % 2 ? 'KeyS' : 'KeyW');
        for (let i = 0; i < 900; i++) {
          const old = G.player.pos.clone(); g.steps(1); distance += old.distanceTo(G.player.pos); maxBoot = Math.max(maxBoot, s.bootMs);
          if (i % 4 === 0) { const t = performance.now(); s.renderer.update(G.player.pos); maxRender = Math.max(maxRender, performance.now() - t); }
        }
      }
      G.input.keys.clear(); g.steps(90);
      return { before, after: { ...s.stats(), colliders: G.world.colliders.len() }, distance, maxBoot, maxRender };
    });
    check('long real walk keeps GPU pool and collider count fixed', long.distance > 90 && long.after.meshes === long.before.meshes && long.after.vertices === long.before.vertices && long.after.colliders === long.before.colliders && long.after.hotTiles <= 32 && long.after.bytes < 4 * 1024 * 1024, long);

    // Warm ABBA comparison, same world, camera and route. This machine uses
    // software WebGL: frame times are evidence for this machine, not a GPU promise.
    const benchmark = await require('./snow-benchmark.cjs')(page);
    const cpu = walk.cost.slice().sort((a, b) => a - b);
    check('walking simulation plus dirty snow mesh update stays within a 60 Hz CPU budget at p95', cpu[Math.floor(cpu.length * 0.95)] < 16.67, { median: cpu[Math.floor(cpu.length / 2)], p95: cpu[Math.floor(cpu.length * 0.95)] });
    await ev(() => { const g = window.__game; g.G.player.avatar.inspectionView = 0; g.G.player.pitch = -1.3; g.G.input.keys.add('KeyW'); g.steps(90); g.G.input.keys.clear(); });
    await shot('06-first-person');
    await page.keyboard.press('F6'); await page.waitForFunction(() => window.__game.G.player.avatar.inspectionView === 1);
    check('F6 works in the playable snow test', true);
    check('no JavaScript, shader or application resource errors', errors.length === 0, errors);
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ checks, walk, long, benchmark, errors }, null, 2));
    fs.writeFileSync(path.join(OUT, 'motion.json'), JSON.stringify(motionTrace, null, 2));
    console.log(`\n${checks.length} browser snow checks passed`);
  } finally { await browser?.close(); await server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
