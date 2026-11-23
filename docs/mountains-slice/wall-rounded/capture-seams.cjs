// Run with the integrated mountain scene open on the given origin.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function captureSeams() {
  const [origin, output, mode] = process.argv.slice(2);
  if (!origin || !output) throw Error('Provide scene origin and output frame directory');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: [
      '--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle',
      '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=6500'
    ]
  });
  const camera = {
    target: [-430, 48, -310],
    horizontalRadius: 245,
    elevation: 13,
    fieldOfView: 27,
    azimuths: [-129, -125, -121, -117, -113, -109, -105, -117]
  };
  try {
    const page = await browser.newPage({ viewport: {width: 800, height: 450}, deviceScaleFactor: 1 });
    await page.goto(origin + '/experiments/plateau/mountain.html', {waitUntil: 'domcontentloaded', timeout: 120000});
    await page.waitForFunction(() => window.__mountain?.ready, null, {timeout: 360000});
    const families = mode === 'shadow-control' ? ['angular'] : ['rounded', 'angular'];
    for (const family of families) {
      await page.evaluate(family => window.__mountain.setWall(family, 1, 42), family);
      const views = mode === 'shadow-control' ? [[3, -117]] : camera.azimuths.entries();
      for (const [i, azimuth] of views) {
        const png = await page.evaluate(({config, azimuth, mode}) => {
          const {camera, renderer, scene} = window.__mountain;
          const [x,y,z] = config.target;
          const a = azimuth * Math.PI / 180;
          camera.position.set(
            x + config.horizontalRadius * Math.sin(a),
            y + config.horizontalRadius * Math.tan(config.elevation * Math.PI / 180),
            z + config.horizontalRadius * Math.cos(a)
          );
          camera.lookAt(x, y, z);
          camera.fov = config.fieldOfView;
          camera.updateProjectionMatrix();
          if (mode === 'shadow-control') {
            renderer.shadowMap.enabled = false;
            scene.traverse(o => { o.receiveShadow = false; });
          }
          renderer.render(scene, camera);
          return renderer.domElement.toDataURL('image/png').split(',')[1];
        }, {config: camera, azimuth, mode});
        const filename = family + '-' + (mode === 'shadow-control' ? 'no-shadow' : i) + '.png';
        fs.writeFileSync(path.join(output, filename), Buffer.from(png, 'base64'));
        console.log(filename, azimuth);
      }
    }
    fs.writeFileSync(path.join(output, 'camera.json'), JSON.stringify(camera, null, 2) + '\n');
  } finally {
    await browser.close();
  }
}
captureSeams().catch(error => {console.error(error); process.exitCode = 1;});
