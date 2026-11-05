// Small terrain/character regression: slope coverage and the reported sprint-turn
// animation. Uses the actual controller and final rendered IK, not key-only gait.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(__dirname, '../test-results/snow-slopes');
fs.mkdirSync(OUT, { recursive: true });
let checks = 0;
function check(name, ok, data) { assert.ok(ok, `${name}: ${JSON.stringify(data)}`); checks++; console.log('PASS ', name, data ? JSON.stringify(data) : ''); }
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 5204, strictPort: true, hmr: false }, logLevel: 'error' });
  let browser;
  const stop = async () => { await browser?.close(); await server.close(); process.exit(130); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await server.listen();
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url?.endsWith('/favicon.ico')) errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto('http://127.0.0.1:5204/?snow=1&test=1');
    await page.waitForFunction(() => window.__game?.G.snow, null, { timeout: 180000 });
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const shot = async name => {
      await ev(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 120000 });
    };
    await ev(() => { const g = window.__game; g.setManualStepping(true); g.G.input.enabled = true; g.steps(120); });

    const turns = await ev(() => {
      const g = window.__game, { G } = g, s = G.snow, result = [];
      for (const snow of [false, true]) for (const mode of ['quarter', 'reverse', 'zigzag']) {
        s.setEnabled(snow); G.player.stamina = 1; G.player.winded = false;
        g.teleport(40, s.baseY + (snow ? s.field.support(40, 66) : 0) + 0.05, 66);
        G.player.yaw = 0; g.steps(120); G.input.keys.add('KeyW'); G.input.keys.add('ShiftLeft');
        let peak = 0, high = 0, longest = 0, bothHigh = 0, rootPeak = 0, reach = 0;
        for (let i = 0; i < 360; i++) {
          if (i === 240) G.input.keys.clear();
          if (i >= 60 && i < 240) {
            G.player.yaw = mode === 'reverse' ? Math.PI : mode === 'quarter' ? Math.PI / 2 : (Math.floor((i - 60) / 30) % 2 ? Math.PI / 2 : -Math.PI / 2);
            if (Math.floor(i / 30) % 2) G.input.keys.add('KeyD'); else G.input.keys.delete('KeyD');
          }
          g.steps(1); const a = g.animation();
          const heights = a.visualFeet.map(p => p[1] - s.terrain.heightAt(p[0], p[2]));
          peak = Math.max(peak, ...heights); high = Math.max(...heights) > 0.7 ? high + 1 : 0;
          longest = Math.max(longest, high); if (Math.min(...heights) > 0.55) bothHigh++;
          reach = Math.max(reach, ...a.reachErrors);
          rootPeak = Math.max(rootPeak, G.player.pos.y - s.terrain.heightAt(G.player.pos.x, G.player.pos.z));
        }
        G.input.keys.clear(); result.push({ snow, mode, peak, longestHighSeconds: longest / 60, bothHigh, rootPeak, reach });
      }
      return result;
    });
    check('quick sprint turns/strafe/reversal do not leave rendered boots flying above the body', turns.every(t => t.peak < 0.85 && t.longestHighSeconds < 0.25 && t.bothHigh < 10 && t.reach < 0.025), turns);
    fs.writeFileSync(path.join(OUT, 'turns.json'), JSON.stringify(turns, null, 2));

    const samples = await ev(() => {
      const g = window.__game, { G, THREE: T } = g, s = G.snow; s.enabled = true; s.reset(); g.steps(90);
      return [[34 + 3.2 / 2, 53], [46 + 2.4 / 2, 51], [40 + 1.5 / 2, 24]].map(([x, z]) => {
        const ground = s.terrain.heightAt(x, z);
        const hit = G.world.castRayAndGetNormal(new G.R.Ray(new T.Vector3(x, ground + 2, z), new T.Vector3(0, -1, 0)), 3, true, G.R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, G.player.collider);
        return { x, z, ground, collisionY: ground + 2 - hit.timeOfImpact, degrees: Math.acos(hit.normal.y) * 180 / Math.PI, depth: s.field.sample(x, z).height };
      });
    });
    check('hills have matching visible/collision bases and thinner snow with increasing slope', samples.every(s => Math.abs(s.collisionY - s.ground) < 0.0001) && samples[0].depth > 0.25 && samples[1].depth < 0.19 && samples[2].depth < 0.02, samples);

    const walks = [];
    for (const [index, x, z, rx] of [[0, 34, 53, 3.2], [1, 46, 51, 2.4]]) {
      const result = await ev(({ x, z, rx }) => {
        const g = window.__game, { G, THREE: T } = g, s = G.snow;
        G.input.keys.clear(); G.player.yaw = -Math.PI / 2;
        const start = x - rx - 0.3;
        g.teleport(start, s.terrain.heightAt(start, z) + s.field.support(start, z) + 0.06, z); g.steps(90);
        G.input.keys.add('KeyW'); let maxHeight = 0, reach = 0, gap = 0, tilted = 0;
        const before = s.renderer.stats();
        for (let i = 0; i < 330; i++) {
          g.steps(1); const a = g.animation();
          maxHeight = Math.max(maxHeight, G.player.pos.y - s.baseY);
          reach = Math.max(reach, ...a.reachErrors);
          for (const f of G.player.avatar.motion.feet) if (f.grounded && !f.swinging) {
            const support = s.baseY + (s.terrain.heightAt(f.position.x, f.position.z) - s.baseY) + s.field.support(f.position.x, f.position.z) + 0.012;
            gap = Math.max(gap, Math.abs(f.position.y - support)); if (f.normal.y < 0.99) tilted++;
          }
        }
        G.input.keys.clear(); g.steps(60); s.renderer.update(G.player.pos);
        return { x: G.player.pos.x, maxHeight, reach, gap, tilted, samePool: JSON.stringify(before.meshes) === JSON.stringify(s.renderer.stats().meshes) };
      }, { x, z, rx });
      walks.push(result);
      check(`hill ${index + 1}: real uphill/downhill walking, slope-aligned planted feet and bounded IK`, result.x > x + 0.5 && result.maxHeight > (index ? 0.9 : 0.6) && result.reach < 0.025 && result.gap < 0.02 && result.tilted > 20 && result.samePool, result);
      await shot(`walk-hill-${index}`);
    }

    const steep = await ev(() => {
      const g = window.__game, { G, THREE: T } = g, s = G.snow;
      G.input.keys.clear(); const x = 40.75, z = 24, ground = s.terrain.heightAt(x, z);
      g.teleport(x, ground + 0.06, z); let sliding = 0, reach = 0;
      for (let i = 0; i < 90; i++) { g.steps(1); if (G.player.avatar.motion.sliding) sliding++; reach = Math.max(reach, ...g.animation().reachErrors); }
      return { sliding, reach, snowDepth: s.field.sample(x, z).height };
    });
    check('thin snow on the steep face does not turn it into a walkable platform', steep.sliding > 0 && steep.reach < 0.025 && steep.snowDepth < 0.02, steep);
    // Same camera for successive frames to inspect slope contact and movement.
    await ev(() => {
      const g = window.__game, { G, THREE: T } = g, s = G.snow; s.visitHill(2); g.steps(60); G.input.keys.add('KeyW');
      const a = G.player.avatar, draw = a.render.bind(a); a.inspectionView = 1;
      a.render = (alpha, dt) => { draw(alpha, dt); a.inspectionCamera.position.set(47, s.baseY + 4.6, 29); a.inspectionCamera.lookAt(40, s.baseY + 0.6, 24); };
    });
    for (let i = 0; i < 3; i++) { await ev(() => window.__game.steps(35)); await shot(`steep-motion-${i}`); }
    await ev(() => window.__game.G.input.keys.clear());
    // Buttons use actual clicks and preserve the chosen hill for comparisons.
    await page.locator('[data-hill="1"]').click();
    let ui = await ev(() => ({ x: window.__game.G.player.pos.x, z: window.__game.G.player.pos.z }));
    check('hill shortcut button moves to the selected hill', Math.abs(ui.x - 46) < 0.001 && Math.abs(ui.z - 56) < 0.001, ui);
    await page.locator('[data-snow="toggle"]').click();
    let next = await ev(() => ({ x: window.__game.G.player.pos.x, z: window.__game.G.player.pos.z }));
    check('snow comparison keeps the current hill', Math.abs(ui.x - next.x) < 0.001 && Math.abs(ui.z - next.z) < 0.001, next);
    await page.locator('[data-snow="toggle"]').click(); await page.locator('[data-snow="kind"]').click();
    next = await ev(() => ({ x: window.__game.G.player.pos.x, z: window.__game.G.player.pos.z }));
    check('density comparison also keeps the current hill', Math.abs(ui.x - next.x) < 0.001 && Math.abs(ui.z - next.z) < 0.001, next);
    check('no shader, JavaScript or application resource errors', errors.length === 0, errors);
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ checks, turns, samples, walks, steep, errors }, null, 2));
    console.log(`${checks} slope browser checks passed`);
  } finally { await browser?.close(); await server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
