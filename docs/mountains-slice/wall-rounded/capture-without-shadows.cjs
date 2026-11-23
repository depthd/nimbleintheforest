// node capture-without-shadows.cjs ORIGIN OUT_DIRECTORY [original|rounded|angular|all]
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function capture() {
  const [origin, outDir, selection = 'all', litDir] = process.argv.slice(2);
  if (!origin || !outDir || !['original','rounded','angular','all'].includes(selection)) {
    throw Error('Provide origin, output directory and optionally the family');
  }
  fs.mkdirSync(outDir, { recursive: true });
  if (litDir) fs.mkdirSync(litDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--no-sandbox','--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--js-flags=--max-old-space-size=6500']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
    await page.goto(origin + '/experiments/plateau/mountain.html', {waitUntil: 'domcontentloaded', timeout:120000});
    await page.waitForFunction(() => window.__mountain?.ready, null, {timeout:360000});
    await page.evaluate(() => window.__mountain.view('wall'));
    const families = selection === 'all' ? ['original', 'rounded', 'angular'] : [...new Set(['original', selection])];
    for (const family of families) {
      for (const preset of family === 'original' ? [0] : [0, 1, 2]) {
        const captures = await page.evaluate(({family, preset, captureLit}) => {
          const m = window.__mountain;
          const { renderer, scene, camera } = m;
          const encode = () => renderer.domElement.toDataURL('image/png').split(',')[1];
          m.setWall(family, preset, 42);
          const lit = captureLit ? encode() : null;
          const receivers = [];
          scene.traverse(o => {
            if (o.receiveShadow) {
              receivers.push(o);
              o.receiveShadow = false;
            }
          });
          // The receiveShadow uniform updates even when the material program
          // is already cached. Switching shadowMap.enabled alone can leave
          // the previous program sampling the old shadow map.
          renderer.shadowMap.enabled = false;
          renderer.render(scene, camera);
          const unlit = encode();
          for (const o of receivers) o.receiveShadow = true;
          renderer.shadowMap.enabled = true;
          return { lit, unlit };
        }, {family, preset, captureLit: Boolean(litDir)});
        const filename = family + '-' + preset + '-42.png';
        fs.writeFileSync(path.join(outDir, filename), Buffer.from(captures.unlit, 'base64'));
        if (litDir) fs.writeFileSync(path.join(litDir, filename), Buffer.from(captures.lit, 'base64'));
        console.log(filename);
      }
    }
  } finally {
    await browser.close();
  }
}
capture().catch(error => { console.error(error); process.exitCode = 1; });
