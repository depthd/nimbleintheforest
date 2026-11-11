const { chromium } = require('playwright'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const out = path.resolve(process.argv[2] || __dirname), base = process.env.WEDGE_URL || 'http://127.0.0.1:5237/experiments/plateau/wedge-ascent.html';
const sourceSHA = 'a6528353bf9bad8a38f25063bf53e874d7482b5e';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [], shots = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const kind of ['relief', 'flat']) {
      await page.goto(base + '?kind=' + kind);
      await page.waitForFunction(() => window.__wedgeAscent?.ready, null, { timeout: 120000 });
      assert.equal(await page.locator('.build-info').getAttribute('title'), sourceSHA);
      await page.evaluate(() => {
        document.querySelector('aside').style.display = 'none';
        const caption = document.createElement('div'); caption.id = 'caption';
        Object.assign(caption.style, {position:'fixed',left:'16px',bottom:'16px',padding:'9px 14px',background:'#14232de8',color:'white',borderRadius:'7px',font:'15px system-ui'});
        document.body.append(caption);
      });
      for (const view of (kind === 'relief' ? ['front', 'side', 'top', 'inside'] : ['front', 'side'])) {
        await page.evaluate(({view,kind}) => {
          window.__wedgeAscent.view(view);
          const names = {front:'Спереди',side:'Сбоку',top:'Сверху',inside:'Из прохода'};
          document.getElementById('caption').textContent = 'Круговой срез · ' + names[view] + (kind === 'flat' ? ' · плоский контроль' : '') + ' · a652835';
        }, {view,kind});
        const file = `${kind}-${view}.png`; await page.screenshot({ path: path.join(out, file) }); shots.push(file); console.log(file);
      }
      if (kind === 'relief') for (const view of ['front','side','top']) {
        await page.evaluate(view => {
          window.__wedgeAscent.highlight(true); window.__wedgeAscent.view(view);
          document.getElementById('caption').textContent = 'Синим — маска и круговой срез · верх сохранён · a652835';
        },view);
        const file = `explained-${view}.png`; await page.screenshot({path:path.join(out,file)}); shots.push(file); console.log(file);
      }
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'browser.json'), JSON.stringify({result:'PASS',sourceSHA,delivery:'local Vite preview of the built source SHA',backend:'Chromium / SwiftShader',errors,shots,physicsPlayerTested:false,deployed:false},null,2)+'\n');
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
