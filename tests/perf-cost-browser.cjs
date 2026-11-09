// CPU subsystem comparison on production builds, with RAF deliberately suspended.
// node tests/perf-cost-browser.cjs [checkout-root] [result.json]
// This measures synchronous subsystem work, not GPU time or end-to-end FPS.
const { chromium } = require('playwright');
const fs = require('node:fs');

(async () => {
  const { preview } = await import('vite');
  const server = await preview({ root: process.argv[2] || process.cwd(), preview: { port: 5195, strictPort: true }, logLevel: 'error' });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await page.goto('http://localhost:5195/?test=1&seed=42&hour=13&weather=clear');
    await page.waitForFunction(() => window.__game, null, { timeout: 180000, polling: 100 });
    const data = await page.evaluate(() => {
      const { G, THREE: T } = window.__game, results = {};
      const measure = (name, run, n) => {
        for (let i = 0; i < 10; i++) run(i);
        const samples = [];
        for (let i = 0; i < n; i++) {
          const start = performance.now(); run(i); samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        results[name] = { n, p50: samples[Math.floor(n * .5)], p95: samples[Math.floor(n * .95)],
          max: samples.at(-1), total: samples.reduce((a, b) => a + b, 0) };
      };
      const p = G.player.pos.clone();
      measure('forest', i => G.forest.update(new T.Vector3(p.x + (i % 8) * 15, p.y, p.z)), 96);
      G.house.door.data.open = true;
      for (const w of G.house.windows) w.data.glass = 'broken';
      measure('thermal', () => G.thermal.update(.2), 300);
      const field = G.snow.field;
      for (let i = 0; i < 5; i++) {
        const position = p.clone().add(new T.Vector3(i * .5, 0, 0));
        position.y = field.baseHeight(position.x, position.z) + .11;
        const pose = { position, rotation: new T.Quaternion() };
        field.sweepBoot(pose, pose);
      }
      G.snow.renderer.update(p);
      const entries = [...G.snow.renderer.entries.values()];
      measure('snow-refresh', i => {
        field.advanceWeather(.2, { snow: 1, wind: 15 });
        G.snow.renderer.refresh(entries[i % entries.length]);
      }, 60);
      let hash = 2166136261;
      for (const e of entries) for (const value of e.pixels) hash = Math.imul(hash ^ value, 16777619) >>> 0;
      results.pixelsHash = hash;
      results.entries = entries.length;
      results.physics = { bodies: G.world.bodies.len(), colliders: G.world.colliders.len() };
      return results;
    });
    if (errors.length) throw new Error(errors.join('\n'));
    if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(data, null, 2));
    console.log(JSON.stringify(data, null, 2));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.httpServer.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
