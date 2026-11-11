const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const out = process.argv[2];
if (!out) throw Error('Usage: node experiments/plateau/browser.cjs <output-directory> [base-url]');
const base = process.argv[3] || 'http://127.0.0.1:5236/experiments/plateau/';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], failures = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) failures.push({ url: r.url(), status: r.status() }); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__plateau?.ready, null, { timeout: 60000 });
    const stats = await page.evaluate(() => ({ blocks: window.__plateau.blocks, height: window.__plateau.height, triangles: window.__plateau.triangles }));
    assert.ok(stats.blocks > 0);
    const cameras = {};
    for (const id of ['overview', 'foot', 'top']) {
      await page.click(`[data-view="${id}"]`);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      cameras[id] = await page.evaluate(() => window.__plateau.camera.position.toArray());
      if (id === 'foot') assert.ok(Math.abs(cameras[id][1] - 1.8) < .01, 'foot view must be at actual eye height');
      await page.screenshot({ path: path.join(out, `${id}.png`) });
    }
    const before = await page.evaluate(() => window.__plateau.camera.position.toArray());
    await page.keyboard.down('w');
    await page.waitForFunction(before => Math.hypot(...window.__plateau.camera.position.toArray().map((v, i) => v - before[i])) > 1, before, { timeout: 30000 });
    await page.keyboard.up('w');
    const after = await page.evaluate(() => window.__plateau.camera.position.toArray());
    const moved = Math.hypot(...before.map((v, i) => after[i] - v));
    assert.ok(moved > 1, `WASD did not move after selecting a view: ${moved}`);
    await page.uncheck('#rocks');
    assert.equal(await page.evaluate(() => window.__plateau.rockGroup.visible), false);
    await page.check('#rocks');
    assert.equal(await page.evaluate(() => window.__plateau.rockGroup.visible), true);
    await page.click('[data-view="overview"]');
    const orbitBefore = await page.evaluate(() => window.__plateau.camera.position.toArray());
    await page.mouse.move(900, 450);
    await page.mouse.down();
    await page.mouse.move(1030, 500, { steps: 8 });
    await page.mouse.up();
    const orbitAfter = await page.evaluate(() => window.__plateau.camera.position.toArray());
    assert.ok(Math.hypot(...orbitBefore.map((v, i) => orbitAfter[i] - v)) > 1, 'mouse orbit did not move camera');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('#collapse');
    assert.equal(await page.locator('#collapse').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(out, 'mobile.png') });
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), base, backend: 'Chromium SwiftShader; not hardware FPS', stats, cameras, moved, checks: ['three camera presets', 'eye-height foot view', 'keyboard after view button', 'mouse orbit', 'rock toggle', 'mobile collapse and viewport'], errors, failures, result: 'PASS' }, null, 2));
    console.log('PASS: built scene, three views, WASD, orbit, rocks, mobile, no browser errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
