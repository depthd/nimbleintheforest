// Real-world visual preview: exact asset, placement, viewpoints, collision and opt-in isolation.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('playwright');
(async () => {
  const root = path.join(__dirname, '..'), out = process.argv[2] || 'test-results/C1-TEST-001/local';
  fs.mkdirSync(out, { recursive: true });
  const { preview } = await import('vite');
  const server = process.env.C1_URL ? null : await preview({ root, preview: { host: '127.0.0.1', port: 5242, strictPort: true }, logLevel: 'error' });
  const base = process.env.C1_URL || 'http://127.0.0.1:5242/';
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
    const errors = [], assets = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', response => { if (response.url().includes('conifer_c1.glb')) assets.push({ url: response.url(), status: response.status() }); });
    // Freeze simulation to compare rendered viewpoints without changing weather.
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await page.goto(base + '?c1=1&test=1&warmup=0');
    await page.waitForFunction(() => window.__c1Lab || document.querySelector('#loading pre'), null, { timeout: 300000, polling: 100 });
    const state = await page.evaluate(() => {
      if (!window.__c1Lab) throw Error(document.querySelector('#loading pre')?.textContent || 'C1 failed');
      const lab = window.__c1Lab, { G, THREE: T } = window.__game;
      let triangles = 0, meshes = 0, nearest = true, opaque = true;
      const materials = new Set();
      lab.root.traverse(o => { if (!o.isMesh) return; meshes++; triangles += o.geometry.index.count / 3; materials.add(o.material.uuid); nearest &&= o.material.map.magFilter === T.NearestFilter; opaque &&= !o.material.transparent; });
      const box = new T.Box3().setFromObject(lab.root);
      return { meshes, triangles, materials: materials.size, nearest, opaque, position: lab.position.toArray(), home: lab.home.toArray(), height: box.max.y - box.min.y,
        ground: G.terrain.heightAt(lab.position.x, lab.position.z), base: box.min.y, dry: Number.isNaN(G.region.waterAt(lab.position.x, lab.position.z)),
        existingTrees: G.region.trees.x.length, diary: !!document.querySelector('link[href*="neucha"]') || !!G.player.avatar.hands, assetSha256: lab.assetSha256 };
    });
    assert.equal(state.meshes, 2); assert.equal(state.triangles, 2068); assert.equal(state.materials, 1);
    assert.ok(state.nearest && state.opaque && state.dry); assert.ok(Math.abs(state.height - 10) < 1e-5);
    assert.ok(Math.abs(state.base - state.ground) < 1e-5); assert.ok(state.existingTrees > 0);
    for (const view of ['front', 'side', 'close', 'far']) {
      const result = await page.evaluate(view => {
        const { G } = window.__game, lab = window.__c1Lab;
        const ok = lab.preset(view); G.renderer.clear(); G.renderer.render(G.scene, G.camera);
        return { ok, position: G.player.pos.toArray(), distance: G.player.pos.distanceTo(lab.position) };
      }, view);
      assert.ok(result.ok, view + ' must have a safe viewpoint');
      await page.screenshot({ path: path.join(out, view + '.png') });
      console.log(view, JSON.stringify(result));
    }
    const collision = await page.evaluate(() => {
      const { G, THREE: T } = window.__game, lab = window.__c1Lab;
      const origin = lab.position.clone().add(new T.Vector3(0, 0.8, 2));
      return lab.collider.castRay(new G.R.Ray(origin, { x: 0, y: 0, z: -1 }), 5, true);
    });
    assert.ok(collision > 0 && collision < 2, 'solid trunk must block a close ray');
    const input = await page.evaluate(() => {
      const { G } = window.__game; G.input.lock(); G.input.keys.add('KeyW');
      const before = G.player.pos.clone();
      for (let i = 0; i < 30; i++) window.__game.steps(1);
      G.input.keys.delete('KeyW'); G.input.unlock();
      return { moved: G.player.pos.distanceTo(before), enabled: G.input.enabled };
    });
    assert.ok(input.enabled && input.moved > 0.1, 'normal movement must remain available');
    assert.deepEqual(errors, []); assert.ok(assets.some(x => x.status === 200));
    const fetched = await page.request.get(base + 'models/conifer_c1.glb'); assert.equal(fetched.status(), 200);
    const sha = crypto.createHash('sha256').update(await fetched.body()).digest('hex'); assert.equal(sha, state.assetSha256);
    // Without c1=1, normal play must not load or add the preview asset/panel.
    assets.length = 0;
    await page.goto(base + '?test=1&seed=42&hour=13&weather=clear&warmup=0');
    await page.waitForFunction(() => window.__game || document.querySelector('#loading pre'), null, { timeout: 300000, polling: 100 });
    assert.equal(await page.evaluate(() => !!window.__game && !window.__c1Lab && !document.querySelector('#c1-panel')), true);
    assert.equal(assets.length, 0); assert.deepEqual(errors, []);
    const report = { result: 'PASS', state, collision, input, errors, assetSha256: sha, normalPlayLoadsPreview: false };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser?.close(); if (server) await new Promise(r => server.httpServer.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
