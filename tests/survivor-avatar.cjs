// Real Rapier + browser checks. Uses the same Playwright setup as tests/e2e.cjs.
// Optional: CHROMIUM_PATH=/usr/bin/chromium. Screenshots go to test-results/survivor/.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(__dirname, '../test-results/survivor');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 5202, strictPort: true, hmr: false }, logLevel: 'error' });
  let browser;
  let checks = 0;
  function check(name, ok, detail = '') {
    assert.ok(ok, `${name}: ${JSON.stringify(detail)}`);
    checks++;
    console.log('PASS ', name, detail ? JSON.stringify(detail) : '');
  }
  try {
    await server.listen();
    browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const pageErrors = [], resources = [], consoleErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error' && !m.location().url?.endsWith('/favicon.ico')) consoleErrors.push(m.text());
    });
    // The existing repository has no favicon. Report other HTTP failures precisely.
    page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) resources.push(`${r.status()} ${r.url()}`); });
    await page.goto('http://127.0.0.1:5202/?test=1&seed=42&hour=13&weather=clear&nocold=1&scale=0');
    await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const shot = async name => {
      // Wait for the manual pose to be rendered, not for wall-clock gameplay.
      await ev(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 });
    };
    await ev(() => {
      const g = window.__game, { G, THREE: T } = g;
      g.setManualStepping(true);
      G.input.enabled = true;
      G.input.keys.clear();
      const stage = { x: 40, z: 40, y: G.terrain.heightAt(40, 40) + 35 };
      window.__stage = stage;
      const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
      G.world.createCollider(G.R.ColliderDesc.cuboid(30, 0.1, 30).setTranslation(stage.x, stage.y - 0.1, stage.z), body);
      const mesh = new T.Mesh(new T.BoxGeometry(60, 0.2, 60), new T.MeshStandardMaterial({ color: 0xc8cdd0, roughness: 1 }));
      mesh.position.set(stage.x, stage.y - 0.1, stage.z);
      mesh.receiveShadow = true;
      G.scene.add(mesh);
      const grid = new T.GridHelper(60, 120, 0x7c8a91, 0xa7b0b5);
      grid.position.set(stage.x, stage.y + 0.002, stage.z);
      G.scene.add(grid);
      window.__movementFixtures = [mesh, grid];
      window.__stepSounds = [];
      const play = G.audio.play.bind(G.audio);
      G.audio.play = (name, opts = {}) => {
        if (name.startsWith('step_')) window.__stepSounds.push({ name, pos: opts.pos?.toArray(), serial: G.player.avatar.motion.stepSerial });
        play(name, opts);
      };
      window.__resetMovement = () => {
        G.input.keys.clear(); G.input.pressed.clear(); G.input.enabled = true;
        G.player.yaw = G.player.pitch = 0;
        G.player.crouch = false; G.player.water = null;
        G.player.stamina = 1; G.player.winded = false;
        g.teleport(stage.x, stage.y + 0.05, stage.z);
        g.steps(90);
        window.__stepSounds.length = 0;
      };
      window.__resetMovement();
    });

    await page.waitForFunction(() => !!window.__game.G.player.avatar.survivor);
    const opacity = await ev(() => {
      const a = window.__game.G.player.avatar;
      const skin = a.survivor.model.getObjectByProperty('isSkinnedMesh', true);
      const mask = skin.geometry.getAttribute('avatarHide');
      const joints = skin.geometry.getAttribute('skinIndex');
      const weights = skin.geometry.getAttribute('skinWeight');
      let incorrectlyHidden = 0, hiddenHead = 0;
      for (let i = 0; i < mask.count; i++) {
        let headWeight = 0;
        for (let k = 0; k < 4; k++) {
          if (['Head', 'Neck'].includes(skin.skeleton.bones[joints.getComponent(i, k)].name)) headWeight += weights.getComponent(i, k);
        }
        if (mask.getX(i) && headWeight <= 0.5) incorrectlyHidden++;
        if (mask.getX(i) && headWeight > 0.5) hiddenHead++;
      }
      return {incorrectlyHidden, hiddenHead, transparent: skin.material.transparent, opacity: skin.material.opacity, side: skin.material.side};
    });
    check('first-person mask hides only head; body and hands remain opaque and double-sided',
      opacity.incorrectlyHidden === 0 && opacity.hiddenHead > 0 && !opacity.transparent && opacity.opacity === 1 && opacity.side === 2, opacity);
    let levelEyeOffset;
    for (const [name, keys, pitch, view] of [
      ['idle-front', [], 0, 2], ['walk-side', ['KeyW'], 0, 1],
      ['run-side', ['KeyW', 'ShiftLeft'], 0, 1],
      ['crouch-front', ['ControlLeft'], 0, 2],
      ['first-person-level', [], 0, 0], ['first-person', [], -1.35, 0],
      ['crouch-first-person', ['ControlLeft'], -1.35, 0],
      ['max-down-wide', [], -1.5, 0], ['crouch-max-down-wide', ['ControlLeft'], -1.5, 0],
      ['turn-right-wide', [], -1.5, 0], ['turn-left-wide', [], -1.5, 0],
    ].filter(([name]) => !process.env.AVATAR_CLEARANCE_ONLY || name.includes('wide'))) {
      if (name.includes('wide')) await page.setViewportSize({width:1080,height:400});
      await ev(({keys, pitch, view, settle, turn}) => {
        const g = window.__game, p = g.G.player;
        window.__resetMovement();
        keys.forEach(k => g.G.input.keys.add(k));
        p.pitch = pitch; p.avatar.inspectionView = view;
        g.steps(settle);
        if (turn) { p.yaw=turn; g.steps(1); }
        p.updateCamera(0);
      }, {keys, pitch, view, settle: name.includes('wide') ? 180 : 18, turn: name === 'turn-right-wide' ? 1.2 : name === 'turn-left-wide' ? -1.2 : 0});
      await shot(name);
      const result = await ev(() => {
        const {G, THREE: T} = window.__game, a = G.player.avatar;
        const skin = a.survivor.model.getObjectByProperty('isSkinnedMesh', true);
        let error = 0;
        for (let i = 0; i < 2; i++) {
          const side = i ? 'R' : 'L', leg = a.legs[i];
          const endpoint = (mesh, sign) => mesh.localToWorld(new T.Vector3(0, sign * (mesh.scale.y - 0.025) / mesh.scale.y * 0.5, 0));
          for (const [name, target] of [
            ['UpperLeg', endpoint(leg.thigh, 1)],
            ['LowerLeg', endpoint(leg.thigh, -1)], ['Foot', endpoint(leg.shin, -1)]
          ]) error = Math.max(error, skin.skeleton.getBoneByName(name + side).getWorldPosition(new T.Vector3()).distanceTo(target));
        }
        const eyes = a.eyePosition(new T.Vector3());
        const eyeOffset = eyes.clone().sub(skin.skeleton.getBoneByName('Head').getWorldPosition(new T.Vector3()));
        return {error, cameraError: G.camera.position.distanceTo(eyes), eyeOffset: eyeOffset.toArray(),
          firstPerson: a.inspectionView === 0, visible: skin.visible, finite: skin.skeleton.bones.every(b => b.matrixWorld.elements.every(Number.isFinite))};
      });
      check(name + ': skin joints follow solver', result.visible && result.finite && result.error < 1e-5, result);
      if (result.firstPerson) check(name + ': camera matches model eyes', result.cameraError < 1e-5, result.cameraError);
      if (name.includes('wide')) {
        const clearance = await ev(() => {
          const {G,THREE:T} = window.__game;
          const skin = G.player.avatar.survivor.model.getObjectByProperty('isSkinnedMesh',true);
          skin.computeBoundingSphere(); skin.computeBoundingBox();
          const mask = skin.geometry.getAttribute('avatarHide');
          const ray = new T.Raycaster(), forward = G.camera.getWorldDirection(new T.Vector3());
          let minDepth = Infinity, backHits = 0, clipped = 0, bodyHits = 0;
          for (let y=-1; y<=1.001; y+=0.2) for (let x=-1; x<=1.001; x+=0.2) {
            ray.setFromCamera(new T.Vector2(x,y),G.camera);
            for (const hit of ray.intersectObject(skin,false)) {
              const f=hit.face; if (!f) continue;
              if (mask.getX(f.a)>0.5 || mask.getX(f.b)>0.5 || mask.getX(f.c)>0.5) continue;
              const depth=hit.point.clone().sub(G.camera.position).dot(forward);
              minDepth=Math.min(minDepth,depth); bodyHits++;
              if (depth<G.camera.near) clipped++;
              const a=skin.getVertexPosition(f.a,new T.Vector3()).applyMatrix4(skin.matrixWorld);
              const b=skin.getVertexPosition(f.b,new T.Vector3()).applyMatrix4(skin.matrixWorld);
              const c=skin.getVertexPosition(f.c,new T.Vector3()).applyMatrix4(skin.matrixWorld);
              if (b.sub(a).cross(c.sub(a)).dot(ray.ray.direction)>0) backHits++;
              break;
            }
          }
          return {near:G.camera.near,minDepth,backHits,clipped,bodyHits};
        });
        check(name + ': body is outside camera and no visible surface is cut by near plane',
          clearance.bodyHits>0 && clearance.backHits===0 && clearance.clipped===0, clearance);
      }
      if (name === 'first-person-level') levelEyeOffset = result.eyeOffset;
      if (name === 'first-person') {
        const delta = Math.hypot(...result.eyeOffset.map((v, i) => v - levelEyeOffset[i]));
        const radiusChange = Math.abs(Math.hypot(...result.eyeOffset) - Math.hypot(...levelEyeOffset));
        check('looking down moves eyes around head pivot without stretching the offset', delta > 0.05 && radiusChange < 1e-5, {delta, radiusChange});
      }
    }
    check('no JavaScript, shader or resource failures', !pageErrors.length && !consoleErrors.length && !resources.length, {pageErrors, consoleErrors, resources});
    console.log(`${checks} survivor checks passed`);
  } finally { await browser?.close(); await server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
