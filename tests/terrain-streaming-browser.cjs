// Production worker/fallback regression. Build first; no hardware FPS assumptions.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
let checks = 0;
function check(name, ok, data) {
  assert.ok(ok, `${name}: ${JSON.stringify(data)}`); checks++; console.log('PASS', name, JSON.stringify(data));
}
(async () => {
  const { preview } = await import('vite');
  const server = await preview({ root: ROOT, preview: { host: '127.0.0.1', port: 5231, strictPort: true }, logLevel: 'error' });
  let browser, closing;
  const close = () => closing ||= (async () => { await browser?.close(); await new Promise(r => server.httpServer.close(r)); })();
  const stop = async () => { await close(); process.exit(130); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 480, height: 270 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url?.endsWith('/favicon.ico')) errors.push(m.text()); });
    await page.addInitScript(() => {
      const native = window.requestAnimationFrame.bind(window); window.__nativeRAF = native;
      window.requestAnimationFrame = cb => window.__haltFrames ? 0 : native(t => { if (!window.__haltFrames) cb(t); });
    });
    await page.goto('http://127.0.0.1:5231/?test=1&seed=42&hour=13&weather=clear&scale=0&nocold=1&horror=0');
    await page.waitForFunction(() => window.__game || document.querySelector('#loading pre'), null, { timeout: 240000 });
    const initial = await page.evaluate(async () => {
      if (!window.__game) throw new Error(document.querySelector('#loading pre')?.textContent || 'world failed to load');
      window.__haltFrames = true; await new Promise(r => window.__nativeRAF(r));
      const { G } = window.__game, t = G.terrain;
      window.__terrainTest = { t, home: G.camera.position.clone(), mode: 'hold', held: [], syncCalls: 0, throws: 0 };
      return { stats: t.streamingStats(), heights: G.region.h.byteLength, water: G.region.water.byteLength };
    });
    check('production terrain worker starts without detaching live region arrays', initial.stats.worker && initial.heights > 0 && initial.water > 0, initial);
    // Use timer polling below: the application requestAnimationFrame is frozen.
    for (let i = 0; i < 400; i++) {
      const busy = await page.evaluate(() => { const q = window.__terrainTest; q.t.update(q.home); return !!(q.t.pending || q.t.ready); });
      if (!busy) break;
      if (i === 399) throw new Error('home terrain did not finish warming');
      await page.waitForFunction(() => !!window.__terrainTest.t.ready, null, { polling: 20, timeout: 120000 });
    }
    const held = await page.evaluate(() => {
      const q = window.__terrainTest, { t, home } = q, { G } = window.__game;
      t.update(home);
      if (t.pending) throw new Error('home terrain was not fully warm before worker interception');
      q.make = t.makeGeometry; t.makeGeometry = function (...a) { q.syncCalls++; return q.make.apply(this, a); };
      q.post = t.worker.postMessage.bind(t.worker);
      t.worker.postMessage = message => {
        if (q.mode === 'hold') q.held.push(message);
        else if (q.mode === 'throw') { q.throws++; throw new Error('forced worker postMessage failure'); }
        else q.post(message);
      };
      const R = G.region, directions = [[1024, 0], [-1024, 0], [0, 1024], [0, -1024]];
      const direction = directions.find(([x, z]) => R.inside(home.x + x, home.z + z, 128));
      if (!direction) throw new Error('seed 42 has no in-bounds 1024 m streaming target');
      q.target = home.clone(); q.target.x += direction[0]; q.target.z += direction[1];
      q.target.y = R.heightAt(q.target.x, q.target.z) + 1.7;
      q.mask = () => t.slots.every((s, i) => t.loadedCells[i] === (s.near && s.mesh?.visible ? 255 : 0));
      t.update(q.target);
      q.first = { ...t.pending }; q.discarded = t.streamingStats().discarded;
      return { queued: q.held.length, pending: !!t.pending, syncCalls: q.syncCalls, mask: q.mask(),
        missing: t.slots.filter((s, i) => s.near && !t.loadedCells[i]).length, far: t.far.visible, job: q.first };
    });
    check('missing chunks keep the far surface while generation waits off-thread', held.queued === 1 && held.pending && held.syncCalls === 0 && held.mask && held.missing > 0 && held.far, held);
    const released = await page.evaluate(() => {
      const q = window.__terrainTest; q.t.update(q.home); q.mode = 'pass';
      const outside = !q.t.slots[q.first.cj * q.t.cpc + q.first.ci].near;
      for (const message of q.held.splice(0)) q.post(message);
      return { outside, mask: q.mask() };
    });
    check('returning home retains a consistent loaded mask before an obsolete reply', released.outside && released.mask, released);
    await page.waitForFunction(() => !!window.__terrainTest.t.ready, null, { polling: 20, timeout: 120000 });
    const discarded = await page.evaluate(() => {
      const q = window.__terrainTest; q.t.update(q.home);
      return { count: q.t.streamingStats().discarded - q.discarded, mask: q.mask(), syncCalls: q.syncCalls };
    });
    check('the real worker reply for an off-near chunk is discarded', discarded.count > 0 && discarded.mask && discarded.syncCalls === 0, discarded);
    await page.evaluate(() => {
      const q = window.__terrainTest; q.t.update(q.target);
      q.parity = data => {
        const s = q.t.slots[data.cj * q.t.cpc + data.ci], actual = s.geos[data.lod];
        if (!actual) throw new Error('completed chunk was not installed');
        const expected = q.make.call(q.t, data.ci, data.cj, data.lod), failures = [];
        const bytes = (a, b, name) => {
          if (!a || !b) { if (a !== b) failures.push(name + ': missing'); return; }
          if (a.constructor !== b.constructor || a.byteLength !== b.byteLength) { failures.push(name + ': type/length'); return; }
          const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
          if (x.some((v, i) => v !== y[i])) failures.push(name + ': bytes');
        };
        const compare = (a, b, label) => {
          for (const name of ['position', 'normal', 'aSnowDepth', 'aSnowNormal']) bytes(a?.attributes[name]?.array, b?.attributes[name]?.array, label + name);
          bytes(a?.index?.array, b?.index?.array, label + 'index');
        };
        compare(actual, expected, 'surface/'); compare(actual.userData.packedGeometry, expected.userData.packedGeometry, 'packed/');
        q.t.disposeGeometry(expected); return { ci: data.ci, cj: data.cj, lod: data.lod, failures };
      };
    });
    let workerResult;
    // At most one intermediate home request can precede the new target request.
    for (let i = 0; i < 4 && !workerResult; i++) {
      await page.waitForFunction(() => !!window.__terrainTest.t.ready, null, { polling: 20, timeout: 120000 });
      workerResult = await page.evaluate(() => {
        const q = window.__terrainTest, data = q.t.ready, slot = q.t.slots[data.cj * q.t.cpc + data.ci];
        if (!slot.near) { q.t.update(q.target); return null; }
        q.mode = 'throw'; q.t.update(q.target);
        q.fallbackJob = { ...(q.t.pending || q.t.ready) };
        return { ...q.parity(data), throws: q.throws, worker: q.t.streamingStats().worker,
          fallback: !!(q.t.fallback || q.t.ready), syncCalls: q.syncCalls, mask: q.mask() };
      });
    }
    check('worker geometry exactly matches the synchronous builder and a failed post starts fallback', workerResult && !workerResult.failures.length && workerResult.throws === 1 && !workerResult.worker && workerResult.fallback && workerResult.syncCalls === 0 && workerResult.mask, workerResult);
    const fallback = await page.evaluate(() => {
      const q = window.__terrainTest, id = q.fallbackJob.id; let updates = 0;
      while (q.t.ready?.id !== id && updates++ < 2000) { q.t.update(q.target); if (!q.mask()) throw new Error('fallback changed the loaded mask before installation'); }
      if (q.t.ready?.id !== id) throw new Error('fallback did not complete');
      const data = q.t.ready; q.t.update(q.target);
      return { ...q.parity(data), updates, syncCalls: q.syncCalls, mask: q.mask(), stats: q.t.streamingStats(),
        attached: window.__game.G.region.h.byteLength > 0 && window.__game.G.region.water.byteLength > 0 };
    });
    check('time-sliced fallback preserves exact geometry, live arrays and complete surface coverage', !fallback.failures.length && fallback.syncCalls === 0 && fallback.mask && fallback.attached && !fallback.stats.worker, fallback);
    await page.evaluate(() => {
      const q = window.__terrainTest, { G } = window.__game;
      G.camera.position.copy(q.target); G.camera.lookAt(q.target.x, q.target.y - 1.7, q.target.z - 12);
      G.renderer.clear(); G.renderer.render(G.scene, G.camera);
    });
    check('no JavaScript or shader errors', errors.length === 0, errors);
    console.log(`${checks} terrain streaming browser checks passed`);
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
