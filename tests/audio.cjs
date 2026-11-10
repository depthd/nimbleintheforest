// Procedural PCM invariants plus real Chromium WebAudio rendering/lifecycle.
// AUDIO_QA_OUT isolates artifacts; --unit skips browser checks. No listening is
// inferred from these tests. CHROMIUM_PATH can select the installed browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const OUT = process.env.AUDIO_QA_OUT || path.join(__dirname, '../test-results/audio');
let checks = 0;
const results = [];
function check(name, ok, detail) {
  assert.ok(ok, `${name}: ${JSON.stringify(detail)}`);
  checks++; results.push({ name, detail }); console.log('PASS', name, detail === undefined ? '' : JSON.stringify(detail));
}
function load(file) {
  const m = new Module(__filename);
  m._compile(buildSync({ entryPoints: [path.join(__dirname, '../src/core', file)], bundle: true,
    platform: 'node', format: 'cjs', write: false, external: ['three'] }).outputFiles[0].text, __filename);
  return m.exports;
}
function wav(file, channels, rate) {
  const frames = channels[0].length, bytes = Buffer.alloc(44 + frames * channels.length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels.length, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels.length * 2, 28);
  bytes.writeUInt16LE(channels.length * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels.length; c++)
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767), 44 + (i * channels.length + c) * 2);
  fs.writeFileSync(file, bytes);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { SFX_NAMES, SFX_RATE, synthesizeSound, variantCount } = load('sfx.ts');
  const stats = [], buffers = new Map();
  let total = 0;
  const started = performance.now();
  for (const name of SFX_NAMES) {
    const unique = new Set();
    for (let v = 0; v < variantCount(name); v++) {
      const a = synthesizeSound(name, v), repeat = synthesizeSound(name, v);
      assert.deepEqual(a, repeat, `${name}/${v}: deterministic synthesis`);
      assert.ok(a.every(Number.isFinite), `${name}/${v}: finite PCM`);
      assert.ok(a.length > 100 && a.length <= SFX_RATE * 5, `${name}/${v}: bounded duration`);
      assert.ok(a[0] === 0 && a.at(-1) === 0, `${name}/${v}: zero endpoints (including signed zero)`);
      let sum = 0, energy = 0, peak = 0, difference = 0;
      for (let i = 0; i < a.length; i++) {
        sum += a[i]; energy += a[i] ** 2; peak = Math.max(peak, Math.abs(a[i]));
        if (i) difference += (a[i] - a[i - 1]) ** 2;
      }
      const rms = Math.sqrt(energy / a.length), dc = sum / a.length;
      assert.ok(peak <= 0.8 && rms > 0.002 && Math.abs(dc) < 0.001, `${name}/${v}: audible, bounded, no DC`);
      unique.add(require('node:crypto').createHash('sha256').update(Buffer.from(a.buffer)).digest('hex'));
      stats.push({ name, variant: v, duration: a.length / SFX_RATE, rms, peak, dc, roughness: Math.sqrt(difference / energy) });
      total += a.byteLength;
      if (!v) buffers.set(name, a);
    }
    assert.equal(unique.size, variantCount(name), `${name}: all variants distinct`);
  }
  check('all 29 effects and their variants are deterministic, finite, non-silent and click-free at boundaries',
    SFX_NAMES.length === 29, { variants: stats.length, generationMs: Math.round(performance.now() - started) });
  check('prepared mono banks fit a 10 MiB PCM budget', total < 10 * 1024 * 1024, { bytes: total });
  const first = name => stats.find(s => s.name === name && s.variant === 0);
  check('snow friction and wood resonance have materially different spectral texture',
    first('step_snow').roughness > first('step_wood').roughness * 3,
    { snow: first('step_snow').roughness, wood: first('step_wood').roughness });
  // Useful audition artifact generated only in the task's QA directory.
  const reel = new Float32Array(SFX_RATE * 14);
  for (const [group, name] of ['step_snow', 'step_wood', 'step_ice', 'step_stone'].entries())
    for (let v = 0; v < 4; v++) reel.set(synthesizeSound(name, v), Math.floor((group * 3.4 + v * 0.58 + 0.1) * SFX_RATE));
  wav(path.join(OUT, 'footsteps-snow-wood-ice-stone.wav'), [reel], SFX_RATE);
  fs.writeFileSync(path.join(OUT, 'pcm-metrics.json'), JSON.stringify(stats, null, 2));
  if (process.argv.includes('--unit')) return;

  const { createServer } = await import('vite');
  const { chromium } = require('playwright');
  const server = await createServer({ root: path.join(__dirname, '..'),
    server: { port: 5216, strictPort: true, hmr: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => { errors.push(e.message); console.error('BROWSER', e.message); });
    await page.route('**/__audio-fixture', route => route.fulfill({ contentType: 'text/html', body: '<button id="start">Start audio</button>' }));
    await page.goto('http://127.0.0.1:5216/__audio-fixture');
    await page.evaluate(async () => {
      const { GameAudio } = await import('/src/core/audio.ts');
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { SFX_NAMES } = await import('/src/core/sfx.ts');
      const before = performance.now(), audio = new GameAudio();
      window.__audio = { GameAudio, THREE, SFX_NAMES, audio, prepareMs: performance.now() - before, events: [] };
      audio.onSound = (name, pos) => window.__audio.events.push({ name, pos: pos?.toArray() });
      audio.play('chop');
      document.querySelector('#start').onclick = () => {
        const t = performance.now(); audio.start(); window.__audio.startMs = performance.now() - t;
      };
    });
    await page.click('#start');
    const init = await page.evaluate(() => {
      const { audio, events, prepareMs, startMs } = window.__audio, ctx = audio.ctx;
      const same = ctx; audio.start();
      audio.music.setEnabled(false); audio.ambience.gain.value = 0;
      return { state: ctx.state, same: same === audio.ctx, banks: audio.banks.size, beforeStartEvent: events[0], prepareMs, startMs };
    });
    check('user gesture starts one real AudioContext with every bank and preserves pre-start gameplay notification',
      init.state === 'running' && init.same && init.banks === 29 && init.beforeStartEvent.name === 'chop', init);
    const lifecycle = await page.evaluate(() => {
      const { audio, THREE: T, SFX_NAMES, events } = window.__audio;
      const before = events.length;
      const ctx = audio.ctx, create = ctx.createBufferSource.bind(ctx);
      let live = 0, maximum = 0;
      ctx.createBufferSource = () => {
        const node = create(); live++; maximum = Math.max(maximum, live);
        node.addEventListener('ended', () => live--); return node;
      };
      audio.play('chop', { vol: 0 }); audio.play('glass', { pos: new T.Vector3(1e6, 0, 0) });
      const inaudibleAllocated = live;
      const ids = [];
      for (let i = 0; i < 40; i++) {
        const b = audio.nextBuffer('step_snow');
        ids.push(audio.banks.get('step_snow').indexOf(b));
      }
      for (let i = 0; i < ids.length; i++) if (ids.slice(Math.max(0, i - 3), i).includes(ids[i])) throw Error('footstep repeated within three contacts');
      for (let i = 0; i < 240; i++) audio.play('step_snow');
      audio.play('howl', { pos: new T.Vector3(4, 0, 0) });
      const important = [...audio.voices].some(v => v.priority === 3);
      for (const name of SFX_NAMES) audio.play(name);
      audio.setListener(new T.Vector3(), new T.Vector3(0, 0, 1));
      audio.update(0.1, 15, true, { level: 1, pos: new T.Vector3(2, 0, 0) });
      audio.update(0.1, 0, false, { level: 0 });
      window.__audio.live = () => live;
      return { inaudibleAllocated, maximum, active: audio.voices.size, retiring: audio.retiring.size,
        important, notifications: events.length - before, expected: 2 + 240 + 1 + SFX_NAMES.length };
    });
    check('muted/distant sounds notify once, allocate no source; ambient fire sends no gameplay notification',
      lifecycle.inaudibleAllocated === 0 && lifecycle.notifications === lifecycle.expected, lifecycle);
    check('burst saturation has a hard physical voice bound and reserves danger cues',
      lifecycle.maximum <= 28 && lifecycle.active <= 24 && lifecycle.retiring <= 4 && lifecycle.important, lifecycle);
    await page.waitForTimeout(4400);
    const cleanup = await page.evaluate(() => ({ live: window.__audio.live(), active: window.__audio.audio.voices.size, retiring: window.__audio.audio.retiring.size }));
    check('finished and stolen one-shots release sources and graph connections', cleanup.live === 0 && cleanup.active === 0 && cleanup.retiring === 0, cleanup);

    const render = await page.evaluate(async () => {
      const { GameAudio, THREE: T } = window.__audio;
      const original = window.AudioContext, ctx = new OfflineAudioContext(2, 24000 * 4, 24000);
      window.AudioContext = function () { return ctx; };
      let audio;
      try { audio = new GameAudio(); audio.start(); } finally { window.AudioContext = original; }
      audio.ambience.gain.value = 0;
      audio.setListener(new T.Vector3(), new T.Vector3(0, 0, -1));
      audio.play('howl', { pos: new T.Vector3(4, 0, 0), vol: 2 });
      const suspended = ctx.suspend(1);
      const rendering = ctx.startRendering();
      await suspended;
      audio.setListener(new T.Vector3(), new T.Vector3(0, 0, 1));
      await ctx.resume();
      const buffer = await rendering, left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      function energy(data, from, to) {
        let sum = 0; for (let i = Math.floor(from * 24000); i < Math.floor(to * 24000); i++) sum += data[i] ** 2;
        return sum;
      }
      let peak = 0, finite = true;
      for (const data of [left, right]) for (const x of data) { finite &&= Number.isFinite(x); peak = Math.max(peak, Math.abs(x)); }
      return { finite, peak, before: [energy(left, 0.3, 0.8), energy(right, 0.3, 0.8)],
        after: [energy(left, 1.2, 2), energy(right, 1.2, 2)], channels: [Array.from(left), Array.from(right)] };
    });
    check('real offline WebAudio render is finite, audible and below clipping', render.finite && render.peak > 0.01 && render.peak < 0.99, { peak: render.peak });
    check('a sustained positioned effect follows listener rotation instead of staying in the old speaker',
      render.before[1] > render.before[0] * 3 && render.after[0] > render.after[1] * 3,
      { before: render.before, after: render.after });
    wav(path.join(OUT, 'listener-turn-render.wav'), render.channels, 24000);
    const montage = await page.evaluate(async () => {
      const { GameAudio, THREE: T } = window.__audio;
      const original = window.AudioContext, ctx = new OfflineAudioContext(2, 24000 * 14, 24000);
      window.AudioContext = function () { return ctx; };
      let audio;
      try { audio = new GameAudio(); audio.start(); } finally { window.AudioContext = original; }
      audio.ambience.gain.value = 0;
      audio.setListener(new T.Vector3(0, 1.65, 0), new T.Vector3(0, 0, -1));
      const start = AudioBufferSourceNode.prototype.start;
      let offset = 0;
      AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) { return start.call(this, when + offset, ...rest); };
      try {
        for (const [group, name] of ['step_snow', 'step_wood', 'step_ice', 'step_stone'].entries()) {
          for (let v = 0; v < 4; v++) {
            offset = group * 3.4 + v * 0.58 + 0.1;
            audio.play(name, { pos: new T.Vector3(v % 2 ? 0.12 : -0.12, 0, 0),
              footstep: { footwear: 'sneaker', speed: 1.5, landing: false, compaction: 0 } });
          }
        }
      } finally { AudioBufferSourceNode.prototype.start = start; }
      const buffer = await ctx.startRendering();
      const channels = [Array.from(buffer.getChannelData(0)), Array.from(buffer.getChannelData(1))];
      const energies = [];
      for (let group = 0; group < 4; group++) {
        let sum = 0;
        for (let i = Math.floor(group * 3.4 * 24000); i < Math.floor((group * 3.4 + 2.8) * 24000); i++) sum += channels[0][i] ** 2 + channels[1][i] ** 2;
        energies.push(sum);
      }
      return { channels, energies };
    });
    check('snow, wood, ice and stone all reach the real game audio graph', montage.energies.every(e => e > 0.01), montage.energies);
    wav(path.join(OUT, 'footsteps-game-mix.wav'), montage.channels, 24000);
    check('browser reports no audio/runtime errors', errors.length === 0, errors);

    await page.evaluate(() => window.__audio.audio.ctx.close());
    // End-to-end evidence: actual Rapier supports and registries in the game,
    // including a real wooden support placed ABOVE lake ice.
    const game = await browser.newPage({ viewport: { width: 640, height: 360 } });
    game.on('pageerror', e => errors.push(e.message));
    await game.goto('http://127.0.0.1:5216/?test=1&seed=42&hour=13&weather=clear&nocold=1&scale=0&music=0');
    await game.waitForFunction(() => window.__game, null, { timeout: 180000 });
    const supports = await game.evaluate(() => {
      const g = window.__game, { G, THREE: T } = g;
      g.setManualStepping(true);
      const probe = G.player.avatar.probe;
      const found = {};
      for (let z = -12; z <= 12; z += 2) for (let x = -12; x <= 12; x += 2) {
        const hit = probe(x, z, G.terrain.heightAt(x, z) + 0.3);
        if (hit?.material === 'snow' && !found.snow) found.snow = { material: hit.material, support: hit.support };
      }
      for (let z = -3; z <= 3; z++) for (let x = -4; x <= 4; x++) {
        const hit = probe(x, z, G.house.Y0);
        if (hit?.material === 'wood' && G.house.woodenSupports.has(hit.support)) found.wood = { material: hit.material, support: hit.support };
      }
      const { x, z } = G.lake.thin, y = G.region.waterAt(x, z);
      if (Number.isFinite(y)) {
        G.lake.stream(new T.Vector3(x, y, z), 0); G.world.step(G.events);
        const ice = probe(x, z, y);
        found.ice = ice && { material: ice.material, support: ice.support, registered: G.lake.handles.has(ice.support) };
        const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
        const plank = G.world.createCollider(G.R.ColliderDesc.cuboid(0.6, 0.05, 0.6).setTranslation(x, y + 0.25, z), body);
        G.house.woodenSupports.add(plank.handle); G.world.step(G.events);
        const overIce = probe(x, z, y + 0.3);
        found.plankOverIce = overIce && { material: overIce.material, exactSupport: overIce.support === plank.handle };
      }
      found.shoes = G.player.worn.get('feet')?.defId;
      return found;
    });
    check('real game probes distinguish forest snow, cabin wood and registered lake ice', supports.snow?.material === 'snow' && supports.wood?.material === 'wood' && supports.ice?.material === 'ice' && supports.ice.registered, supports);
    check('a real plank collider overrides lake coordinates and the character starts in sneakers', supports.plankOverIce?.material === 'wood' && supports.plankOverIce.exactSupport && supports.shoes === 'sneakers', supports.plankOverIce);
    check('game integration reports no runtime errors', errors.length === 0, errors);

  } finally {
    await browser?.close(); await server.close();
  }
})().then(() => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ checks, results, listening: false }, null, 2));
  console.log(`\n${checks} audio checks passed (no listening claimed)`);
}).catch(e => { console.error(e); process.exitCode = 1; });
