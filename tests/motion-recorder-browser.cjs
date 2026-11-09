const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(__dirname, '../test-results/motion-recorder');
fs.mkdirSync(OUT, { recursive: true });
let checks = 0;
function check(name, ok, detail) { assert.ok(ok, `${name}: ${JSON.stringify(detail)}`); checks++; console.log('PASS ', name, detail || ''); }
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 5206, strictPort: true, hmr: false }, logLevel: 'error' });
  let browser;
  const stop = async () => { await browser?.close(); await server.close(); process.exit(130); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await server.listen(); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1120, height: 720 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR', e.message); });
    page.on('console', m => { if (m.type() === 'error' && !m.location().url?.endsWith('/favicon.ico')) errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto('http://127.0.0.1:5206/?snow=1&test=1');
    await page.waitForFunction(() => window.__game?.G.recorder, null, { timeout: 180000 });
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const shot = async name => {
      await ev(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 120000 });
    };
    await ev(() => { const g = window.__game; g.setManualStepping(true); g.G.input.enabled = true; g.G.renderer.setPixelRatio(0.35); g.G.renderer.shadowMap.enabled = false; g.steps(120); });
    await page.keyboard.press('F7');
    check('F7 starts opt-in capture', await ev(() => window.__game.G.recorder.recording));
    await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
    for (let i = 0; i < 3; i++) {
      await ev(i => { const g = window.__game; g.G.player.yaw = i * 0.5; g.G.input.mouseDX = 100 + i; g.steps(12); }, i);
      await ev(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
    await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
    // Explicitly draw a fractional physics frame and capture that exact draw.
    // Replay must preserve it rather than rerun IK at alpha=1.
    const expected = await ev(() => {
      const g = window.__game, { G } = g;
      g.steps(1); G.player.renderAlpha = 0.37; G.player.updateCamera(0);
      const a = G.player.avatar; G.renderer.render(G.scene, a.inspectionView ? a.inspectionCamera : G.camera);
      G.recorder.captureFrame(1 / 60, 0.37);
      return Array.from(a.recordedPose());
    });
    await page.keyboard.press('F8');
    let result = await ev(() => {
      const { G } = window.__game, r = G.recorder;
      const index = r.data.frames.findIndex(f => f.alpha === 0.37); r.seek(index); r.present();
      window.__livePose = Array.from(r.live.pose);
      window.__liveBody = G.player.body.translation(); window.__liveSnow = G.snow.field.recordedCells(); window.__liveMotionTime = G.player.avatar.motion.time;
      return { reviewing: r.reviewing, frames: r.data.frames.length, index, pose: Array.from(G.player.avatar.recordedPose()),
        ticks: r.data.frames.flatMap(f => f.ticks).length,
        probes: r.data.frames.flatMap(f => f.ticks).some(t => t.probes?.length),
        inputs: r.data.frames.flatMap(f => f.ticks).some(t => t.input?.keys.includes('KeyW') && t.input?.keys.includes('ShiftLeft')) };
    });
    check('review contains physics inputs, support probes and actual rendered frames', result.reviewing && result.frames > 2 && result.index >= 0 && result.ticks > 10 && result.probes && result.inputs, { ...result, pose: undefined });
    assert.deepEqual(result.pose, expected);
    check('fractional render pose survives replay exactly', true);
    await shot('01-recorded-frame');
    await page.locator('[data-rec="view"]').selectOption('side'); await shot('02-side');
    await page.locator('[data-rec="view"]').selectOption('top'); await shot('03-top');
    await page.locator('[data-rec="expected"]').fill('Стопа стоит на опоре');
    await page.locator('[data-rec="actual"]').fill('Стопа скользит');
    await page.locator('[data-rec="note"]').fill('Здесь правая нога проскальзывает — тест записи');
    await page.locator('[data-rec="mark"]').click();
    const selected = await ev(() => window.__game.G.recorder.data.selectedFrameId);
    await page.locator('[data-rec="next"]').click(); await page.locator('[data-rec="prev"]').click();
    check('frame buttons step without moving live physics', await ev(() => {
      const { G } = window.__game;
      return JSON.stringify(G.player.body.translation()) === JSON.stringify(window.__liveBody) && G.player.avatar.motion.time === window.__liveMotionTime &&
        JSON.stringify(G.snow.field.recordedCells()) === JSON.stringify(window.__liveSnow);
    }));
    await ev(id => { const r = window.__game.G.recorder; r.seek(Math.max(0, r.data.frames.findIndex(f => f.id === id))); }, selected);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-rec="download"]').click()]);
    const file = path.join(OUT, download.suggestedFilename()); await download.saveAs(file);
    const bytes = fs.readFileSync(file), raw = file.endsWith('.gz') ? zlib.gunzipSync(bytes) : bytes;
    const data = JSON.parse(raw.toString('utf8'));
    check('download carries the marked frame, notes, render alpha and scene context', data.format === 'nimble-motion' && data.context.snowScene && data.context.seed === 42 &&
      data.frames.some(f => f.alpha === 0.37) && data.notes.some(n => n.text.includes('правая нога')) && data.frames.some(f => f.id === data.selectedFrameId), { bytes: bytes.length, frames: data.frames.length, notes: data.notes.length });
    check('package includes portable local geometry, system state and map pin', data.diagnostics?.samples.length > 0 && data.diagnostics.samples.every(s => s.terrain.length === 289 && s.systems.weather && s.systems.body) && data.notes.some(n => n.expected && n.actual && n.position?.length === 3));
    await page.locator('[data-rec="view"]').selectOption('orbit');
    await page.locator('[data-rec="colliders"]').check();
    check('isolated world viewer and orbit controls operate without live physics changes', await ev(() => {
      const {G} = window.__game, r = G.recorder; r.present();
      return r.worldViewer.group.parent === G.scene && r.worldViewer.controls.enabled && JSON.stringify(G.player.body.translation()) === JSON.stringify(window.__liveBody);
    }));
    const restored = await ev(() => {
      document.querySelector('[data-rec="exit"]').click();
      const { G } = window.__game;
      const pose = Array.from(G.player.avatar.recordedPose());
      return { reviewing: G.recorder.reviewing, paused: G.paused, enabled: G.input.enabled, snow: G.snow.renderer.field === G.snow.field,
        pose: JSON.stringify(pose) === JSON.stringify(window.__livePose), differences: pose.map((x,i) => x === window.__livePose[i] ? null : [i,x,window.__livePose[i]]).filter(Boolean).slice(0,10) };
    });
    check('leaving review restores original live pose, snow and pause state', !restored.reviewing && restored.paused && restored.enabled && restored.snow && restored.pose, restored);
    await page.evaluate(() => window.__game.G.input.unlock());
    await page.locator('[data-rec="file"]').setInputFiles(file);
    await page.waitForFunction(() => window.__game.G.recorder.reviewing);
    check('downloaded gzip file opens at its saved frame and preserves note', await ev(() => {
      const r = window.__game.G.recorder, f = r.data.frames[r.index];
      return f.id === r.data.selectedFrameId && r.data.notes.some(n => n.frameId === f.id && n.text.includes('правая нога'));
    }));
    await page.locator('[data-rec="view"]').selectOption('recorded'); await shot('04-imported');
    await page.locator('[data-rec="play"]').click();
    check('slow playback can be started and paused', await ev(() => window.__game.G.recorder.playing));
    await page.locator('[data-rec="play"]').click();
    check('world package opens independently of current seed and keeps saved meshes', await ev(() => {
      const r = window.__game.G.recorder, data = JSON.parse(JSON.stringify(r.exportData()));
      data.context.seed += 1; r.load(data); r.present();
      return r.reviewing && r.worldViewer.group.parent === window.__game.G.scene && document.querySelector('[data-rec="world"]').disabled;
    }));
    // Corrupt imports leave the current valid recording intact.
    await page.locator('[data-rec="file"]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"broken"}') });
    await page.waitForFunction(() => document.querySelector('[data-rec="notice"]').textContent.includes('повреждён'));
    check('corrupt import reports a readable error and keeps current replay', await ev(() => window.__game.G.recorder.reviewing && window.__game.G.recorder.data.format === 'nimble-motion'));
    check('no JavaScript, shader or application resource errors', errors.length === 0, errors);
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ checks, errors, frames: data.frames.length, bytes: bytes.length }, null, 2));
    console.log(`${checks} recorder browser checks passed`);
  } finally { await browser?.close(); await server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
