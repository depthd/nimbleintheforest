// The cliff laboratory in the real game: the shelter keeps snow out, the rim holds the
// player, a fall from it hurts, and the panel's views and toggles work. Saves screenshots.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(__dirname, '../test-results/cliffs');
fs.mkdirSync(OUT, { recursive: true });
let checks = 0;
function check(name, ok, data) { assert.ok(ok, `${name}: ${JSON.stringify(data)}`); checks++; console.log('PASS ', name, data ? JSON.stringify(data) : ''); }
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 5207, strictPort: true, hmr: false }, logLevel: 'error' });
  let browser;
  const stop = async () => { await browser?.close(); await server.close(); process.exit(130); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await server.listen();
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !m.location().url?.endsWith('/favicon.ico')) errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5207/?cliffs=1&test=1');
    await page.waitForFunction(() => window.__game?.G.cliffLab || document.querySelector('#loading pre'), null, { timeout: 240000 });
    const failed = await page.evaluate(() => document.querySelector('#loading pre')?.textContent);
    check('the lab loads', !failed, failed);
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const shot = async (name) => {
      await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 240000 });
    };
    await ev(() => { const g = window.__game; g.setManualStepping(true); g.G.input.enabled = true; g.steps(30); });

    const stats = await ev(() => window.__game.G.cliffs.stats());
    check('every block has a collider', stats.cliffs === 3 && stats.skipped === 0 && stats.colliders === stats.blocks, stats);
    check('the rock stays light to draw', stats.rockTriangles + stats.snowTriangles < 60000, stats);

    // under the undercut: out of the snow and the wind, room to stand and walk along it
    const shelter = await ev(() => {
      const g = window.__game, { G } = g;
      G.cliffLab.go('shelter'); g.steps(60);
      const p = G.player.pos.clone(), eye = G.player.eyePos;
      const s = G.structures.shelterAt(p);
      const c = G.region.cliffs[0], uc = c.spec.undercut;
      let lo = Infinity, hi = -Infinity;
      for (let q = uc.s0 + 3.8; q <= uc.s1 - 3.8; q += 0.5) { lo = Math.min(lo, c.footAt(q)); hi = Math.max(hi, c.footAt(q)); }
      const out = { grounded: G.player.grounded, shelter: s?.name, roof: G.snowCover.roofAt(p.x, p.z, eye.y), loose: G.snowCover.looseAt(p.x, p.z, p.y), snowLayer: G.snow.contains(p.x, p.z), floorSpread: +(hi - lo).toFixed(3) };
      // walk along the shelter for two seconds
      G.input.keys.add('KeyW'); g.steps(120); G.input.keys.clear(); g.steps(20);
      out.walked = +G.player.pos.distanceTo(p).toFixed(2);
      out.stillSheltered = !!G.structures.shelterAt(G.player.pos);
      out.dy = +(G.player.pos.y - p.y).toFixed(2);
      return out;
    });
    check('the undercut is a shelter with no loose snow and no snowfall', shelter.grounded && shelter.shelter && shelter.roof && shelter.loose === 0 && !shelter.snowLayer, shelter);
    check('the shelter floor is level', shelter.floorSpread < 0.05, shelter);
    check('one can walk along under the roof', shelter.walked > 2 && shelter.stillSheltered && Math.abs(shelter.dy) < 0.4, shelter);
    await ev(() => { const g = window.__game; g.G.cliffLab.go('shelter'); g.steps(20); });
    await shot('shelter');

    // on the rim: standing on rock, and a step too far is a long fall
    const rim = await ev(() => {
      const g = window.__game, { G } = g;
      G.cliffLab.go('lip'); g.steps(60);
      const p = G.player.pos.clone();
      const hit = G.world.castRay(new G.R.Ray({ x: p.x, y: p.y + 0.5, z: p.z }, { x: 0, y: -1, z: 0 }), 3, true, undefined, undefined, G.player.collider);
      const onRock = !!hit && G.cliffs.handles.has(hit.collider.handle);
      const top = G.region.cliffs[0].topAt(G.region.cliffs[0].length / 2 + 14);
      return { grounded: G.player.grounded, onRock, y: +p.y.toFixed(2), top: +top.toFixed(2) };
    });
    check('the rim holds the player on rock at the top', rim.grounded && rim.onRock && Math.abs(rim.y - rim.top) < 1.2, rim);
    await shot('lip');
    const fall = await ev(() => {
      const g = window.__game, { G } = g;
      const y0 = G.player.pos.y, condition = G.body.condition;
      // face straight out over the edge and walk
      const c = G.region.cliffs[0], s = c.length / 2 + 14, out = c.outward(s);
      G.player.yaw = Math.atan2(-out.x, -out.z); G.player.pitch = -0.2;
      G.input.keys.add('KeyW'); g.steps(150); G.input.keys.clear(); g.steps(240);
      return { drop: +(y0 - G.player.pos.y).toFixed(1), before: condition, after: G.body.condition, grounded: G.player.grounded };
    });
    check('walking off the rim is a real fall that hurts', fall.drop > 12 && fall.after < fall.before && fall.grounded, fall);

    // views, the bare sheet and the fly-around
    for (const v of ['front', 'pillar', 'tor']) {
      const r = await ev((v) => { const g = window.__game, { G } = g; G.cliffLab.go(v); g.steps(40); return { grounded: G.player.grounded, inRock: G.region.cliffs.some((c) => c.occupied(G.player.pos.x, G.player.pos.z, 0)) }; }, v);
      check(`viewpoint ${v} stands on open ground`, r.grounded && !r.inRock, r);
      await shot(v);
    }
    const bare = await ev(() => { const { G } = window.__game; G.cliffLab.setRock(false); return G.cliffs.group.visible; });
    await shot('front-bare');
    const back = await ev(() => { const { G } = window.__game; G.cliffLab.setRock(true); return G.cliffs.group.visible; });
    check('the rock can be hidden to show the sheet and brought back', bare === false && back === true);
    const orbit = await ev(() => {
      const { G } = window.__game, lab = G.cliffLab, sc = G.sky.sun.shadow.camera;
      lab.setOrbit(true); lab.update(0);
      const a = G.camera.position.clone(); lab.update(3); const moved = G.camera.position.distanceTo(a);
      const wide = sc.right;
      lab.setOrbit(false);
      return { moved: +moved.toFixed(1), wide, restored: sc.right };
    });
    check('the fly-around circles the site with wide shadows, then restores them', orbit.moved > 5 && orbit.wide >= 100 && orbit.restored === 45, orbit);
    await ev(() => { const { G } = window.__game; G.cliffLab.setOrbit(true); G.cliffLab.update(0); G.terrain.update(G.camera.position, 400); });
    await shot('orbit');
    await ev(() => window.__game.G.cliffLab.setOrbit(false));

    // boulders share the ground shader; with world snow on they used to be discarded entirely
    const boulder = await ev(() => {
      const g = window.__game, { G } = g, R = G.region, P = R.rocks;
      let best = -1;
      R.forEachProp(P, G.player.pos.x, G.player.pos.z, 400, (i) => { if (P.s[i] > 1.3 && (best < 0 || P.s[i] > P.s[best])) best = i; });
      if (best < 0) return null;
      const x = P.x[best], z = P.z[best], y = P.y[best], s = P.s[best];
      const px = x + s * 3 + 2, pz = z + s * 3 + 2;
      g.teleport(px, G.terrain.heightAt(px, pz) + 0.05, pz); g.steps(5);
      G.forest.update(G.player.pos, true); G.terrain.update(G.camera.position, 400);
      g.lookAt(x, y + s * 0.2, z);
      return { s: +s.toFixed(2), attr: G.forest.rockMesh.geometry.attributes.aSnowDepth?.array[0] };
    });
    if (boulder) {
      const clip = { x: 380, y: 200, width: 200, height: 200 };
      await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const withRock = await page.screenshot({ clip, timeout: 240000 });
      await ev(() => { window.__game.G.forest.rockMesh.visible = false; });
      await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const without = await page.screenshot({ clip, timeout: 240000 });
      await ev(() => { window.__game.G.forest.rockMesh.visible = true; });
      let diff = 0;
      for (let i = 0; i < Math.min(withRock.length, without.length); i++) if (withRock[i] !== without[i]) diff++;
      check('boulders are drawn on snowy ground, not only their shadows and colliders', boulder.attr === -1 && diff > 2000, { ...boulder, differingBytes: diff });
    }

    check('no page errors', errors.length === 0, errors.slice(0, 5));
    console.log(`${checks} cliff browser checks passed; images in ${OUT}`);
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
