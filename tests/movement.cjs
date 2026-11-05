// Real Rapier + browser checks. Uses the same Playwright setup as tests/e2e.cjs.
// Optional: CHROMIUM_PATH=/usr/bin/chromium. Screenshots go to test-results/movement/.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(__dirname, '../test-results/movement');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 5201, strictPort: true, hmr: false }, logLevel: 'error' });
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
    await page.goto('http://127.0.0.1:5201/?test=1&seed=42&hour=13&weather=clear&nocold=1&scale=0');
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
      G.world.createCollider(G.R.ColliderDesc.cuboid(12, 0.1, 12).setTranslation(stage.x, stage.y - 0.1, stage.z), body);
      const mesh = new T.Mesh(new T.BoxGeometry(24, 0.2, 24), new T.MeshStandardMaterial({ color: 0xc8cdd0, roughness: 1 }));
      mesh.position.set(stage.x, stage.y - 0.1, stage.z);
      mesh.receiveShadow = true;
      G.scene.add(mesh);
      const grid = new T.GridHelper(24, 48, 0x7c8a91, 0xa7b0b5);
      grid.position.set(stage.x, stage.y + 0.002, stage.z);
      G.scene.add(grid);
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

    let result = await ev(() => {
      const g = window.__game, before = g.animation();
      g.steps(180);
      const after = g.animation();
      return { before, after, sounds: window.__stepSounds.length };
    });
    check('idle is silent with two fixed support feet', result.sounds === 0 && result.after.feet.every((f, i) =>
      f.phase === 'stance' && f.position.every((v, k) => Math.abs(v - result.before.feet[i].position[k]) < 1e-5)), result.after.reachErrors);

    result = await ev(() => {
      const g = window.__game, before = g.animation();
      g.G.player.yaw = 0.55; g.G.player.pitch = -0.6;
      g.steps(90); g.G.player.updateCamera(0);
      return { before, after: g.animation(), cameraYaw: g.G.camera.rotation.y };
    });
    check('look moves head and chest while hips stay still; camera stays responsive',
      Math.abs(result.after.bodyYaw - result.before.bodyYaw) < 0.001 && result.after.headYaw > 0.3 && Math.abs(result.cameraYaw - 0.55) < 1e-5);
    await ev(() => { window.__game.G.player.avatar.inspectionView = 2; });
    await shot('01-independent-look');

    result = await ev(() => {
      const g = window.__game;
      g.G.player.yaw = 2.6; g.G.player.pitch = 0;
      let last = g.animation(), rate = 0, drift = 0;
      for (let i = 0; i < 240; i++) {
        g.steps(1); const s = g.animation();
        rate = Math.max(rate, Math.abs(Math.atan2(Math.sin(s.bodyYaw - last.bodyYaw), Math.cos(s.bodyYaw - last.bodyYaw))) * 60);
        s.feet.forEach((f, j) => { if (f.phase === 'stance' && last.feet[j].phase === 'stance') drift = Math.max(drift,
          Math.abs(f.yaw - last.feet[j].yaw), Math.hypot(...f.position.map((v, k) => v - last.feet[j].position[k]))); });
        last = s;
      }
      return { state: last, rate, drift, sounds: window.__stepSounds.length };
    });
    check('large turn uses smooth pelvis rotation and real repositioning steps',
      Math.abs(result.state.bodyYaw - 2.6) < 0.15 && result.rate <= 2.81 && result.drift < 1e-5 && result.sounds >= 2,
      { rate: result.rate, drift: result.drift, steps: result.sounds });
    await shot('02-turn-finished');

    const distances = {};
    for (const [name, keys] of [['forward', ['KeyW']], ['backward', ['KeyS']], ['left', ['KeyA']], ['right', ['KeyD']],
      ['diagonal', ['KeyW', 'KeyD']], ['sprint', ['KeyW', 'ShiftLeft']], ['crouch', ['KeyW', 'KeyC']]]) {
      result = await ev(({ keys }) => {
        const g = window.__game; window.__resetMovement();
        const start = g.G.player.pos.clone();
        keys.forEach(k => g.G.input.keys.add(k));
        let last = g.animation(), drift = 0, reach = 0, minHip = Infinity, minGap = Infinity;
        const contacts = [], frames = [];
        for (let i = 0; i < 120; i++) {
          g.steps(1); const s = g.animation();
          s.feet.forEach((f, j) => { if (f.phase === 'stance' && last.feet[j].phase === 'stance') drift = Math.max(drift,
            Math.hypot(...f.position.map((v, k) => v - last.feet[j].position[k]))); });
          reach = Math.max(reach, ...s.reachErrors);
          minHip = Math.min(minHip, s.hipHeight);
          const separation = s.feet[1].position.map((v, k) => v - s.feet[0].position[k]);
          minGap = Math.min(minGap, separation[0] * Math.cos(s.bodyYaw) - separation[2] * Math.sin(s.bodyYaw));
          contacts.push(...g.G.player.avatar.motion.contacts.map(c => ({ side: c.side, pos: c.position.toArray() })));
          if (i % 12 === 0) frames.push(s);
          last = s;
        }
        const distance = g.G.player.pos.distanceTo(start);
        const sounds = window.__stepSounds.slice();
        g.G.input.keys.clear(); g.steps(150);
        const beforeIdle = g.animation().stepSerial;
        g.steps(120);
        return { distance, drift, reach, minHip, minGap, contacts, sounds, frames,
          settled: g.animation().stepSerial === beforeIdle, state: g.animation() };
      }, { keys });
      distances[name] = result.distance;
      fs.writeFileSync(path.join(OUT, name + '-trace.json'), JSON.stringify(result, null, 2));
      check(`${name}: moves, anchors hold, legs reach, stops without treadmill steps`,
        result.distance > (name === 'crouch' ? 0.9 : 2) && result.drift < 1e-5 && result.reach < 0.075 && result.minGap > 0.12 && result.settled,
        { distance: result.distance, drift: result.drift, reach: result.reach, minHip: result.minHip, minGap: result.minGap });
      check(`${name}: each contact produces exactly one positioned footstep sound`,
        result.contacts.length >= 3 && result.sounds.length === result.contacts.length &&
        result.contacts.every((c, i) => c.pos.every((v, k) => Math.abs(v - result.sounds[i].pos[k]) < 1e-7)),
        { contacts: result.contacts.length, sounds: result.sounds.length });
    }
    check('sprint is materially faster than walking', distances.sprint > distances.forward * 1.6, distances);

    result = await ev(() => {
      const g = window.__game; window.__resetMovement();
      g.G.input.pressed.add('Space'); g.steps(1); g.G.input.pressed.clear();
      let air = 0, phantom = 0, landed = 0;
      for (let i = 0; i < 100; i++) {
        g.steps(1);
        if (!g.G.player.grounded) { air++; phantom += g.G.player.avatar.motion.contacts.length; }
        landed += g.G.player.avatar.motion.contacts.filter(c => c.landing).length;
      }
      return { air, phantom, landed, state: g.animation() };
    });
    check('jump has no airborne footsteps and lands once', result.air > 15 && result.phantom === 0 && result.landed === 1, result);

    result = await ev(() => {
      const g = window.__game, { G, THREE: T } = g, s = window.__stage;
      window.__resetMovement();
      const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
      const wall = G.world.createCollider(G.R.ColliderDesc.cuboid(3, 2, 0.1).setTranslation(s.x, s.y + 2, s.z - 1.5), body);
      G.input.keys.add('KeyW'); g.steps(180);
      const serial = g.animation().stepSerial;
      g.steps(120);
      const silent = g.animation().stepSerial === serial;
      G.input.keys.clear(); G.world.removeCollider(wall, true);
      return { silent, speed: g.animation().speed };
    });
    check('pushing against a wall does not play a walking loop', result.silent && result.speed < 0.01, result);

    result = await ev(() => {
      const g = window.__game, { G, THREE: T } = g, s = window.__stage;
      window.__resetMovement();
      const angle = 0.22, x = s.x + 5;
      const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
      const ramp = G.world.createCollider(G.R.ColliderDesc.cuboid(1.6, 0.15, 4).setTranslation(x, s.y + 0.8, s.z)
        .setRotation({ x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) }), body);
      const rampMesh = new T.Mesh(new T.BoxGeometry(3.2, 0.3, 8), new T.MeshStandardMaterial({ color: 0xa5afb6, roughness: 1 }));
      rampMesh.position.set(x, s.y + 0.8, s.z); rampMesh.rotation.x = angle;
      rampMesh.castShadow = rampMesh.receiveShadow = true; G.scene.add(rampMesh);
      g.teleport(x, s.y + 0.8 + 0.15 / Math.cos(angle) - Math.tan(angle) * 2.5 + 0.05, s.z + 2.5);
      g.steps(60); G.input.keys.add('KeyW');
      let contacts = 0, tilted = 0, reach = 0;
      for (let i = 0; i < 100; i++) {
        g.steps(1); const a = g.animation(); reach = Math.max(reach, ...a.reachErrors);
        for (const c of G.player.avatar.motion.contacts) { contacts++; if (c.normal.z > 0.15) tilted++; }
      }
      G.input.keys.clear();
      const state = g.animation();
      return { contacts, tilted, reach, y: G.player.pos.y, expectedNormalZ: Math.sin(angle), state, ramp: ramp.handle };
    });
    check('feet use actual slope collision normals and remain reachable', result.tilted >= 3 && result.reach < 0.08, result);
    await ev(() => { window.__game.G.player.avatar.inspectionView = 1; });
    await shot('03-slope');

    result = await ev(() => {
      const g = window.__game, { G, THREE: T } = g, s = window.__stage;
      window.__resetMovement();
      const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
      for (let i = 0; i < 3; i++) {
        const h = (i + 1) * 0.16, z = s.z - i * 0.65;
        G.world.createCollider(G.R.ColliderDesc.cuboid(1.5, h / 2, 0.325).setTranslation(s.x - 5, s.y + h / 2, z), body);
        const mesh = new T.Mesh(new T.BoxGeometry(3, h, 0.65), new T.MeshStandardMaterial({ color: 0x969fa8 }));
        mesh.position.set(s.x - 5, s.y + h / 2, z); mesh.receiveShadow = true; G.scene.add(mesh);
      }
      g.teleport(s.x - 5, s.y + 0.05, s.z + 1.2);
      g.steps(60); G.input.keys.add('KeyW');
      let raisedContacts = 0, reach = 0, penetration = 0;
      for (let i = 0; i < 95; i++) {
        g.steps(1); const a = g.animation(); reach = Math.max(reach, ...a.reachErrors);
        for (const c of G.player.avatar.motion.contacts) if (c.position.y > s.y + 0.13) raisedContacts++;
        for (const f of G.player.avatar.motion.feet) {
          const ground = G.player.avatar.probe(f.position.x, f.position.z, G.player.pos.y);
          if (ground) penetration = Math.max(penetration, ground.point.y - f.position.y);
        }
      }
      G.input.keys.clear();
      return { raisedContacts, reach, penetration, state: g.animation() };
    });
    check('steps plant on stair tops and clear the risers', result.raisedContacts >= 2 && result.reach < 0.08 && result.penetration < 0.045,
      { raisedContacts: result.raisedContacts, reach: result.reach, penetration: result.penetration });
    await shot('04-stairs');

    await ev(() => {
      const g = window.__game; window.__resetMovement();
      g.G.player.avatar.inspectionView = 1;
      g.G.input.keys.add('KeyW');
      g.steps(90);
    });
    for (let i = 0; i < 12; i++) {
      await ev(() => window.__game.steps(5));
      await shot(`walk-side-${String(i).padStart(2, '0')}`);
    }
    await ev(() => {
      const g = window.__game; window.__resetMovement();
      g.G.player.avatar.inspectionView = 0; g.G.player.pitch = -1.35;
      g.G.input.keys.add('KeyW'); g.steps(90);
    });
    for (let i = 0; i < 12; i++) {
      await ev(() => window.__game.steps(5));
      await shot(`walk-first-${String(i).padStart(2, '0')}`);
    }
    // Real key events: F6 must cycle without changing the first-person aim.
    await page.keyboard.press('F6');
    await page.waitForFunction(() => window.__game.G.player.avatar.inspectionView === 1);
    check('F6 switches to side inspection', await ev(() => window.__game.G.player.avatar.inspectionView === 1));
    await page.keyboard.press('F6');
    await page.waitForFunction(() => window.__game.G.player.avatar.inspectionView === 2);
    check('F6 switches to front inspection', await ev(() => window.__game.G.player.avatar.inspectionView === 2));
    await page.keyboard.press('F6');
    await page.waitForFunction(() => window.__game.G.player.avatar.inspectionView === 0);
    check('F6 returns to first person', await ev(() => window.__game.G.player.avatar.inspectionView === 0));
    const performance = await ev(() => {
      const { G } = window.__game;
      G.input.keys.clear(); window.__game.steps(120);
      const avatar = G.player.avatar;
      let meshes = 0; avatar.root.traverse(o => { if (o.isMesh) meshes++; });
      const t = window.performance.now();
      for (let i = 0; i < 300; i++) { avatar.update(1 / 60); avatar.render(1, 0); }
      return { meshes, averageAnimationMs: (window.performance.now() - t) / 300 };
    });
    console.log('Animation cost (CPU, this test machine):', JSON.stringify(performance));
    check('no JavaScript, shader or application resource errors', pageErrors.length === 0 && resources.length === 0 && consoleErrors.length === 0,
      { pageErrors, resources, consoleErrors });
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ checks, distances, performance, pageErrors, resources, consoleErrors }, null, 2));
    console.log(`\n${checks} browser movement checks passed`);
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
