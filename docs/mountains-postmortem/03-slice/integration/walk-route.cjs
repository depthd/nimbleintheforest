// Run the route page in Vite, then: node docs/mountains-slice/integration/walk-route.cjs [url] [outputDir]
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const url = new URL(process.argv[2] || 'http://localhost:5184/experiments/plateau/route.html?qa=1&seed=42&wall=rounded');
const output = path.resolve(process.argv[3] || path.join(__dirname, 'seed-' + url.searchParams.get('seed')));
const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const meters = (a, b) => Math.hypot(horizontal(a, b), a.y - b.y);
const round = n => Math.round(n * 1000) / 1000;
const point = p => Object.fromEntries(['x','y','z'].map(k => [k, round(p[k])]));
const at = (x, z) => ({x, z});
const yawTo = (a, b) => Math.atan2(a.x - b.x, a.z - b.z);

function clearance(a, b, tree) {
  const dx = b.x-a.x, dz = b.z-a.z;
  const t = Math.min(1, Math.max(0, ((tree.x-a.x)*dx+(tree.z-a.z)*dz)/(dx*dx+dz*dz || 1)));
  return horizontal(tree, at(a.x+t*dx,a.z+t*dz)) - tree.radius;
}

// The second tier blocks a direct line to the bridge. Cross the southern shelf,
// then turn north along the eastern shelf. Choose a lane clear of the seeded trunks.
function toBridge(start, near, trees) {
  const candidates = [];
  for (let z = start.z + 3; z <= start.z + 11; z++) {
    for (let x = near.x - 10; x <= near.x - 5; x++) {
      const marks = [start, at(start.x,z), at(x,z), at(x,near.z), near];
      const walkable = marks.slice(1).every((p,i) => trees.every(t =>
        Math.abs(t.y-near.y) > 1 || clearance(marks[i],p,t) > 1.1));
      if (walkable) candidates.push({marks,length:marks.slice(1).reduce((d,p,i)=>d+horizontal(p,marks[i]),0)});
    }
  }
  assert(candidates.length, 'No clear approach from the lower cave exit to the bridge');
  candidates.sort((a,b)=>a.length-b.length);
  return candidates[0].marks.slice(1);
}

async function run() {
  await fs.mkdir(output,{recursive:true});
  const executablePath = process.env.CHROMIUM_PATH || (require('node:fs').existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const walkViewport = {width:330,height:204};
  const photoViewport = {width:1100,height:680};
  const page = await browser.newPage({viewport:walkViewport,deviceScaleFactor:1});
  const report = {url:url.href,pass:false,stage:'load',physicsHz:60,input:'Playwright keyboard; look rotates camera; fixed Player ticks',frames:0,
    distanceMeters:0,maxSampleSpeedMps:0,checkpoints:[],screenshots:[],pageErrors:[],documentVisits:0};
  let current, held = false;
  page.on('pageerror', e => report.pageErrors.push(String(e)));
  page.on('framenavigated', frame => {if(frame === page.mainFrame()) report.documentVisits++;});

  function stage(name) {
    report.stage = name;
    console.log('['+name+']',current ? point(current) : '');
  }
  function mark(name) {
    const record = {name,frame:report.frames,...point(current),attached:current.attached};
    report.checkpoints.push(record);
    console.log(name, JSON.stringify(record));
  }
  async function forward(on) {
    if (held === on) return;
    if (on) await page.keyboard.down('w'); else await page.keyboard.up('w');
    held = on;
  }
  async function tick(frames) {
    const previous = current;
    current = await page.evaluate(n=>{window.__route.step(n); return window.__route.state();},frames);
    const distance = meters(previous,current);
    const speed = distance*60/frames;
    report.frames += frames;
    report.distanceMeters += distance;
    report.maxSampleSpeedMps = Math.max(report.maxSampleSpeedMps,speed);
    assert(Number.isFinite(distance) && speed < 8, 'Unexpected displacement: '+JSON.stringify({previous,current,frames}));
    assert(report.frames < 26000,'Route exceeded fixed-tick budget');
  }
  async function look(target,pitch=0) {
    await page.evaluate(([yaw,pitch])=>window.__route.look(yaw,pitch),[yawTo(current,target),pitch]);
  }
  async function walk(target, tolerance=.20) {
    await forward(true);
    let best = horizontal(current,target), idleFrames=0;
    while (horizontal(current,target) > tolerance) {
      const distance = horizontal(current,target);
      await look(target);
      const count = Math.min(100,Math.max(2,Math.floor(distance*18)));
      await tick(count);
      const next = horizontal(current,target);
      if (best-next > .04) { best=next; idleFrames=0; } else idleFrames+=count;
      assert(idleFrames < 180,'Player stuck: '+JSON.stringify({stage:report.stage,current,target}));
    }
    await forward(false);
  }
  async function photo(file,target,pitch) {
    await page.setViewportSize(photoViewport);
    await look(target,pitch);
    await tick(1);
    await page.screenshot({path:path.join(output,file),type:'jpeg',quality:88});
    report.screenshots.push({file,frame:report.frames,...point(current)});
    await page.setViewportSize(walkViewport);
  }

  try {
    // Ignore Vite's development hot reload while other slices are being edited.
    await page.routeWebSocket('**', () => {});
    await page.goto(url.href,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__route?.ready,{},{timeout:60000});
    await page.evaluate(()=>window.__route.overview(false));
    const t = await page.evaluate(()=>{const {spawn,passageAnchors,bridgeAnchors,trees,wallAnchor}=window.__route.terrain;
      return {spawn,passageAnchors,bridgeAnchors,trees,wallAnchor};});
    const {denMouth,denBack,ropeLower,ropeUpper,throughLower,throughUpper} = t.passageAnchors;
    const near=t.bridgeAnchors.find(p=>p.mountainId==='main'), far=t.bridgeAnchors.find(p=>p.mountainId==='satellite');
    const wall=t.wallAnchor || {x:-29,z:34};
    current = await page.evaluate(()=>window.__route.state());
    assert(meters(current,t.spawn)<.6,'Player did not start at terrain spawn');
    mark('spawn');

    stage('wall');
    await walk(at(t.spawn.x-2,wall.z+24));
    await walk(at(wall.x-3,wall.z+24));
    await photo('01-wall.jpg',wall,.23);
    mark('wall exterior');

    stage('P3 dead end and return');
    await walk(at(denMouth.x,wall.z+24));
    await walk(denMouth);
    mark('den entrance');
    await walk(at(denBack.x,denBack.z+1));
    await look(denBack);
    await forward(true);
    await tick(60);
    const blocked = point(current);
    await tick(90);
    await forward(false);
    assert(horizontal(blocked,current)<.12 && current.z>=denBack.z && current.z<denBack.z+.75,'Dead end did not physically stop the capsule');
    report.denBlockedMeters = round(horizontal(blocked,current));
    mark('den back wall');
    await photo('02-den.jpg',denMouth,0);
    await walk(at(denMouth.x,denMouth.z+5));
    mark('returned through den entrance');

    stage('P1 rope');
    await walk(at(ropeLower.x,ropeLower.z+4.5));
    await walk(ropeLower);
    await tick(24);
    await look(at(ropeLower.x,ropeLower.z-1),.86);
    await page.keyboard.down('e');
    await tick(1);
    await page.keyboard.up('e');
    assert(current.attached,'E at lower anchor did not attach');
    mark('rope attached');
    await photo('03-rope.jpg',at(ropeLower.x,ropeLower.z-1),1.08);
    await forward(true);
    const attachFrame=report.frames;
    while(current.attached) {
      await tick(current.y<ropeUpper.y-1?12:3);
      assert(report.frames-attachFrame<900,'Rope failed to release on landing');
    }
    await forward(false);
    assert(meters(current,ropeUpper)<.6,'Rope dismounted away from upper anchor');
    report.ropeGainMeters=round(current.y-ropeLower.y);
    mark('rope upper landing');

    stage('P2 through cave, ascent and return');
    await walk(at(throughLower.x-5,ropeUpper.z));
    await walk(at(throughLower.x,throughLower.z+6));
    await walk(throughLower);
    mark('through cave lower entrance');
    await walk(at(throughLower.x,throughLower.z-4));
    await photo('04-through.jpg',throughUpper,.21);
    await walk(at(throughUpper.x,throughUpper.z-1.7));
    assert(Math.abs(current.y-throughUpper.y)<.4,'Did not reach upper walkable platform');
    mark('through cave upper exit');
    report.passageGainMeters=round(current.y-throughLower.y);
    await walk(at(throughLower.x,throughLower.z+2));
    assert(Math.abs(current.y-throughLower.y)<.4,'Did not return to lower walkthrough entrance');
    mark('through cave lower return');

    stage('B suspension bridge');
    for (const p of toBridge(current,near,t.trees)) await walk(p);
    assert(Math.abs(current.y-near.y)<.5,'Near bridge anchor is at another elevation');
    mark('main anchor');
    const mid=at((near.x+far.x)/2,(near.z+far.z)/2);
    await walk(mid);
    report.bridgeMidpointHeightMeters = round(current.y);
    assert(current.y>near.y-3 && current.y<near.y-.4,'Bridge sag / support missing at midpoint');
    mark('bridge midpoint');
    await photo('05-bridge.jpg',far,-.04);
    await walk(far);
    mark('satellite anchor');
    const span=horizontal(near,far);
    await walk(at(far.x+4*(far.x-near.x)/span,far.z+4*(far.z-near.z)/span));
    await tick(24);
    assert(Math.abs(current.y-far.y)<.45,'Player failed to reach the satellite plateau');
    mark('satellite plateau');
    assert.equal(report.documentVisits,1,'Unexpected reload or navigation');
    assert.deepEqual(report.pageErrors,[]);
    report.pass=true;
    report.stage='complete';
  } catch (err) {
    report.error=String(err);
    throw err;
  } finally {
    report.distanceMeters=round(report.distanceMeters);
    report.maxSampleSpeedMps=round(report.maxSampleSpeedMps);
    if(current) report.lastPosition=point(current);
    await fs.writeFile(path.join(output,'metrics.json'),JSON.stringify(report,null,2)+'\n');
    await browser.close();
  }
  console.log('PASS',output,report.frames,'ticks',report.distanceMeters,'m');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
