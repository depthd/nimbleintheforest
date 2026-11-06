// Rock skin in ordinary play (seed 42): the rock is drawn near a mountain, its colliders stream
// around the player, a rock face stops the player like a wall, and nothing errors.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(__dirname, '../test-results/rock');
fs.mkdirSync(OUT, { recursive: true });
let checks = 0;
function check(name, ok, data) { assert.ok(ok, `${name}: ${JSON.stringify(data)}`); checks++; console.log('PASS ', name, data ? JSON.stringify(data) : ''); }
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 5208, strictPort: true, hmr: false }, logLevel: 'error' });
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
    await page.goto('http://127.0.0.1:5208/?seed=42&hour=15.5&weather=clear&nocold=1&horror=0&scale=0&test=1');
    await page.waitForFunction(() => window.__game?.G.snow || document.querySelector('#loading pre'), null, { timeout: 240000 });
    const failed = await page.evaluate(() => document.querySelector('#loading pre')?.textContent);
    check('the world loads with rock', !failed, failed);
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const shot = async (name) => {
      await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 240000 });
    };
    await ev(() => { const g = window.__game; g.setManualStepping(true); g.G.input.enabled = true; g.steps(20); });
    const home = await ev(() => ({ ...window.__game.G.cliffs.stats(), lab: !!window.__game.G.cliffLab }));
    check('ordinary play has the rock skin and no laboratory', home.cliffs === 0 && home.skin > 5000 && !home.lab, home);

    // find a steep rock face near the house: a skin block with walkable ground in front of it
    const face = await ev(() => {
      const g = window.__game, { G } = g, R = G.region, skin = R.skin;
      let best = null;
      for (const b of skin.blocks) {
        const x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2, d = Math.hypot(x, z);
        if (d < 150 || d > 700 || (best && d > best.d)) continue;
        // outward = down the slope at the block
        const e = 3, gx = R.heightAt(x + e, z) - R.heightAt(x - e, z), gz = R.heightAt(x, z + e) - R.heightAt(x, z - e), L = Math.hypot(gx, gz) || 1;
        for (const dist of [8, 11, 14, 18]) {
          const px = x - gx / L * dist, pz = z - gz / L * dist;
          if (skin.covers(px, pz) || R.slopeAt(px, pz) > 0.6 || !Number.isNaN(R.waterAt(px, pz))) continue;
          best = { d, x, z, px, pz, ux: gx / L, uz: gz / L };
          break;
        }
      }
      return best;
    });
    check('a rock face near the house has open ground in front of it', !!face, face);
    const walk = await ev((f) => {
      const g = window.__game, { G } = g;
      g.teleport(f.px, G.terrain.heightAt(f.px, f.pz) + 0.1, f.pz); g.steps(10);
      const colliders = G.cliffs.stats().colliders;
      G.player.yaw = Math.atan2(-f.ux, -f.uz); G.player.pitch = 0;
      const start = G.player.pos.clone();
      G.input.keys.add('KeyW'); g.steps(600); G.input.keys.clear(); g.steps(30);
      const p = G.player.pos;
      // inside any block? (its convex hull, approximately: bounding box shrunk)
      const inside = G.region.skin.blocks.some((b) => p.x > b.minX + 0.6 && p.x < b.maxX - 0.6 && p.z > b.minZ + 0.6 && p.z < b.maxZ - 0.6 && p.y + 0.9 > b.minY + 0.6 && p.y + 0.9 < b.maxY - 0.6
        && G.world.intersectionWithShape({ x: p.x, y: p.y + 0.9, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, new G.R.Ball(0.05), undefined, undefined, G.player.collider) !== null);
      g.lookAt(f.x, G.terrain.heightAt(f.x, f.z) + 6, f.z);
      return { colliders, walked: +start.distanceTo(p).toFixed(2), towards: +((p.x - start.x) * f.ux + (p.z - start.z) * f.uz).toFixed(2), inside, stats: G.cliffs.stats() };
    }, face);
    check('colliders stream in around the player at the rock', walk.colliders > 5, walk);
    check('walking into the rock face stops at it instead of entering it', !walk.inside && walk.towards < 20, walk);
    check('what is drawn near the mountain stays within budget', walk.stats.drawnTriangles < 700000, walk.stats);
    await shot('rock-face');
    check('no page errors', errors.length === 0, errors.slice(0, 5));
    console.log(`${checks} rock browser checks passed; images in ${OUT}`);
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
