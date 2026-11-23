const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');

const output = resolve('docs/mountains-slice/tiers-entries');
const base = process.env.SLICE_BASE_URL || 'http://127.0.0.1:5184';
const entranceCamera = { eye: [-77, 33, -67], target: [-22, 8, -5] };
const cases = [
  { seed: 42, file: '42-cut.png', camera: entranceCamera },
  { seed: 7, file: '07-wide.png', camera: entranceCamera },
  { seed: 8191, file: '8191-peak.png', camera: { eye: [58, 38, 25], target: [34, 27, -7] } },
];

async function walk(page) {
  const points = await page.evaluate(() => {
    const r = window.__route;
    r.step(40);
    return r.terrain.routes.find((route) => route.from === 'spawn' && route.to === 'main-1').points;
  });
  const start = await page.evaluate(() => window.__route.state());
  await page.keyboard.down('w');
  let end;
  try {
    end = await page.evaluate((points) => {
      const r = window.__route;
      for (const p of points) {
        let converged = false;
        for (let n = 0; n < 100; n++) {
          const q = r.state(),
            dx = p.x - q.x,
            dz = p.z - q.z;
          if (Math.hypot(dx, dz) < 0.43) {
            converged = true;
            break;
          }
          r.look(Math.atan2(-dx, -dz));
          r.step(8);
        }
        if (!converged)
          throw Error(
            'Player stuck: target ' + JSON.stringify(p) + ', position ' + JSON.stringify(r.state()),
          );
      }
      return r.state();
    }, points);
  } finally {
    await page.keyboard.up('w');
  }
  assert(Math.abs(end.y - 14) < 0.25, 'The player must finish on main-1');
  return { start, end, checkpoints: points.length };
}

async function liveWalk(browser) {
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  try {
    await page.goto(base + '/experiments/plateau/route.html?seed=7', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('WASD'), null, {
      timeout: 90000,
    });
    assert.equal(await page.evaluate(() => Boolean(window.__route)), false);
    const feet = () =>
      page.evaluate(async () => {
        const { G } = await import('/src/game/ctx.ts');
        let result;
        G.world.forEachRigidBody((body) => {
          if (body.isKinematic()) {
            const p = body.translation();
            result = { x: p.x, y: p.y - 0.9, z: p.z };
          }
        });
        return result;
      });
    const start = await feet(),
      checkpoints = [start];
    const started = Date.now();
    let end = start;
    await page.keyboard.down('w');
    try {
      while (Date.now() - started < 185000 && end.x < -15) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        end = await feet();
        if (Math.abs(checkpoints.at(-1).x - end.x) >= 4) checkpoints.push(end);
      }
    } finally {
      await page.keyboard.up('w');
    }
    assert(
      Math.abs(start.x + 65) < 0.5 && end.x >= -15 && Math.abs(end.y - 14) < 0.3,
      'W from spawn must reach the top, observed ' + JSON.stringify({ start, end }),
    );
    return {
      seed: 7,
      input: 'keydown W through keyup W; real animation clock; Rapier readback',
      seconds: (Date.now() - started) / 1000,
      start,
      end,
      checkpoints,
    };
  } finally {
    await page.close();
  }
}

async function run() {
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    if (process.argv.includes('--live')) {
      const trace = await liveWalk(browser);
      writeFileSync(join(output, 'live-walk.json'), JSON.stringify(trace, null, 2) + '\n');
      console.log('Live W route reached', trace.end);
      return;
    }
    const evidence = [];
    for (const item of cases) {
      const page = await browser.newPage({ viewport: { width: 1080, height: 700 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base + '/experiments/plateau/route.html?seed=' + item.seed + '&qa=1', {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(() => window.__route?.ready, null, { timeout: 90000 });
      await page.addStyleTag({ content: 'header, footer { visibility: hidden }' });
      await page.evaluate(({ eye, target }) => window.__route.survey(eye, target), item.camera);
      await page.screenshot({ path: join(output, item.file) });
      // Rendering each QA steering tick at screenshot resolution is expensive on software WebGL.
      await page.setViewportSize({ width: 128, height: 96 });
      const entrance = await page.evaluate(
        () => window.__route.terrain.tiers.find((t) => t.id === 'main-1').entry,
      );
      const result = await walk(page);
      assert.deepEqual(errors, []);
      evidence.push({ ...item, entrance, ...result, errors });
      console.log('Verified', item.seed, entrance, 'height', result.end.y.toFixed(2));
      await page.close();
    }
    writeFileSync(join(output, 'browser.json'), JSON.stringify(evidence, null, 2) + '\n');
  } finally {
    await browser.close();
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
