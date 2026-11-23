'use strict';
// Browser keyboard events drive Player. The QA hook advances deterministic physics frames
// and reads the actual pose. Fixed camera pitches are for the saved evidence.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const base =
    process.env.LAB_URL ||
    'http://127.0.0.1:5184/experiments/plateau/route.html?seed=42&wall=rounded&qa=1';
  const output =
    process.env.QA_DIR || path.join(__dirname, '../../docs/mountains-slice/passages/browser');
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: [
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  try {
    await fs.mkdir(output, { recursive: true });
    const p = await browser.newPage({ viewport: { width: 1000, height: 650 } });
    // Keep one revision loaded while other worktrees are integrated into the Vite server.
    await p.routeWebSocket(/.*/, () => {});
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base, { waitUntil: 'networkidle' });
    await p.waitForFunction(() => window.__route?.ready, null, { timeout: 60000 });
    await p.locator('#walk').click();
    const state = () => p.evaluate(() => window.__route.state());
    const step = (n) => p.evaluate((n) => window.__route.step(n), n);
    const key = async (k, n) => {
      await p.keyboard.down(k);
      await step(n);
      await p.keyboard.up(k);
    };
    const stops = {};
    const record = async (name) => {
      stops[name] = await state();
    };
    const aim = async (x, z) => {
      const s = await state(),
        desired = Math.atan2(s.x - x, s.z - z);
      const delta = Math.atan2(Math.sin(desired - s.yaw), Math.cos(desired - s.yaw));
      const frames = Math.round(Math.abs(delta) * 40);
      if (frames) await key(delta > 0 ? 'ArrowLeft' : 'ArrowRight', frames);
    };
    async function walk(x, z) {
      for (let i = 0; i < 25; i++) {
        const s = await state(),
          d = Math.hypot(x - s.x, z - s.z);
        if (d < 0.38) {
          await step(15);
          return;
        }
        await aim(x, z);
        await key('w', Math.max(2, Math.min(260, Math.floor(d * 29))));
      }
      throw new Error('Walk blocked at ' + JSON.stringify({ target: [x, z], pose: await state() }));
    }
    const shoot = async (name, pitch) => {
      const s = await state();
      // Read the same WebGL frame directly after drawing, before the canvas buffer is cleared.
      const data = await p.evaluate(([yaw, tilt]) => {
        window.__route.look(yaw, tilt);
        return document.querySelector('#scene').toDataURL('image/jpeg', 0.9).split(',')[1];
      }, [s.yaw, pitch]);
      await fs.writeFile(path.join(output, name + '.jpg'), Buffer.from(data, 'base64'));
      await p.evaluate((y) => window.__route.look(y, 0), s.yaw);
      await record(name);
    };
    const ride = async (direction) => {
      await key('e', 1);
      assert((await state()).attached, 'E did not catch rope');
      await p.keyboard.down(direction === 1 ? 'w' : 's');
      for (let i = 0; i < 64; i++) {
        await step(12);
        if (!(await state()).attached) break;
      }
      await p.keyboard.up(direction === 1 ? 'w' : 's');
      await step(40);
      const s = await state();
      assert(
        !s.attached && s.grounded && Math.abs(s.y - (direction === 1 ? 14 : 0)) < 0.2,
        JSON.stringify(s)
      );
    };
    await step(20);
    await record('spawn');
    await walk(-66, 62);
    await walk(15, 62);
    await walk(15, 42);
    await aim(15, 21);
    await shoot('den-mouth', 0.1);
    await walk(15, 22);
    await aim(15, 5);
    await key('w', 200);
    await record('den-wall');
    assert(stops['den-wall'].z > 20.0 && stops['den-wall'].z < 20.5);
    await walk(15, 42);
    await walk(-4, 42);
    await aim(-4, 34);
    await shoot('rope-and-anchor', 0.72);
    await walk(-4, 35.3);
    await ride(1);
    await record('rope-upper-landing');
    await walk(-0.8, 30);
    await aim(-4, 32.5);
    await shoot('rope-fastening', -0.28);
    await walk(13, 32);
    await walk(17, 22);
    await walk(17, 8);
    await aim(17, -10);
    await shoot('through-cave', 0.24);
    await walk(17, -12);
    await record('upper-exit');
    assert(Math.abs(stops['upper-exit'].y - 22) < 0.2);
    await walk(17, 17);
    await record('through-return');
    assert(Math.abs(stops['through-return'].y - 14) < 0.2);
    await walk(17, 23);
    await walk(12, 32);
    await walk(-4, 32.6);
    await ride(-1);
    await record('rope-lower-landing');
    assert.deepEqual(errors, []);
    const report = {
      base,
      control:
        'Playwright keydown/up, W/E/arrow keys. QA step advances fixed frames; lookup of actual Player pose. Look sets screenshot pitch only; no teleports.',
      errors,
      stops,
    };
    await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
