const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const out = path.resolve(process.argv[2] || path.join(root, 'test-results/crossing'));
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 5223, strictPort: true, hmr: false }, logLevel: 'error' });
  let browser;
  const manifest = {
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
    sources: Object.fromEntries(['crossing.ts', 'crossing-form.ts', 'cave.ts', 'crossing-view.ts', 'crossing.html', 'crossing-browser.cjs'].map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(__dirname, f))).digest('hex')])),
    renderer: 'Chromium ANGLE SwiftShader; no hardware performance claim',
    errors: [], walks: [], seeds: [], frames: [],
  };
  try {
    await server.listen();
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.setDefaultTimeout(90000);
    page.on('pageerror', e => manifest.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) manifest.errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5223/experiments/mountains/crossing.html?seed=42');
    await page.waitForFunction(() => window.__crossing?.ready);
    await page.evaluate(() => window.__crossing.manual(true));
    const shot = async name => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: path.join(out, `${name}.png`) });
      manifest.frames.push({ name, camera: await page.evaluate(() => window.__crossing.camera()) });
      console.log('SHOT', name);
    };
    await page.locator('#walk').click();
    const before = await page.evaluate(() => window.__crossing.position);
    await page.keyboard.down('w');
    await page.evaluate(() => window.__crossing.steps(180));
    await page.keyboard.up('w');
    await page.evaluate(() => window.__crossing.steps(30));
    const after = await page.evaluate(() => window.__crossing.position);
    const displacement = Math.hypot(after.x - before.x, after.z - before.z);
    assert.ok(displacement > 2 && displacement < 8, `Keyboard displacement ${displacement}`);
    manifest.keyboard = { before, after, displacement };
    await page.locator('#collapse').click();
    for (const view of ['overview', 'approach', 'below', 'above', 'lookback', 'interior', 'entrance', 'cave', 'exit', 'roof']) { await page.evaluate(v => window.__crossing.view(v), view); await shot(`42-${view}`); }
    // One continuous return journey: no reset between ascent, bridge and east core.
    let duringWalk = true;
    manifest.requestsDuringWalk = [];
    page.on('request', request => { if (duringWalk && !request.url().endsWith('/favicon.ico')) manifest.requestsDuringWalk.push(request.url()); });
    for (const [id, reverse, reset] of [['cave', false, true], ['cave', true, false], ['lower', true, false], ['lower', false, false], ['ascent', false, false], ['bridge', false, false], ['east', false, false], ['east', true, false], ['bridge', true, false], ['ascent', true, false]]) {
      const result = await page.evaluate(({ id, reverse, reset }) => window.__crossing.traverse(id, reverse, reset), { id, reverse, reset });
      manifest.walks.push(result); console.log('WALK', JSON.stringify(result));
      assert.ok(result.ok, `Walk failed ${id}/${reverse}: ${JSON.stringify(result)}`);
      await shot(`42-${id}-${reverse ? 'return' : 'end'}`);
    }
    duringWalk = false;
    assert.deepEqual(manifest.requestsDuringWalk, [], 'Walking into the cave must not fetch another location');
    for (const seed of [7, 2026]) {
      await page.evaluate(seed => window.__crossing.generate(seed), seed);
      await page.waitForFunction(() => window.__crossing.ready);
      manifest.seeds.push(seed); await shot(`${seed}-overview`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#collapse').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await shot('mobile-menu');
    assert.deepEqual(manifest.errors, []);
    manifest.pass = true;
    console.log('PASS browser: actual keyboard, 10 continuous route legs including cave with final support checks, no loads while walking, 2 held-out views, mobile menu, no browser errors.');
  } finally {
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await browser?.close(); await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
