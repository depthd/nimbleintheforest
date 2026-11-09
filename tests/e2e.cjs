// Gameplay smoke test in a headless browser.
// Usage: node tests/e2e.cjs [screenshotDir]
// Starts a Vite dev server, opens the game with ?test=1 and drives it through window.__game.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const OUT = process.argv[2] || path.join(__dirname, '..', 'test-results');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!ok) failures++;
}

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 5199, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  const port = server.config.server.port;
  const url = `http://localhost:${port}/?test=1&seed=${process.env.SEED || 42}&hour=13&weather=cloudy`;

  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !m.location().url?.endsWith('/favicon.ico')) errors.push(`${m.location().url}: ${m.text()}`); });
  page.on('response', r => { if(r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__game, null, { timeout: 300000 });
  await page.evaluate(ratio => { const g=window.__game;g.setManualStepping(true);g.G.input.enabled=true;g.G.renderer.setPixelRatio(ratio); }, Number(process.env.E2E_PIXEL_RATIO || 1));
  const shot = (n) => page.screenshot({ timeout: 180000, path: path.join(OUT, n + '.png') });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  await shot('01-start');

  // ---- pick up the axe ----
  const axe = await ev(() => {
    const g = window.__game;
    const a = g.find('axe')[0];
    const [x, y, z] = a.pos;
    g.approach(x, y, z);
    const before = g.actions();
    const ok = g.act('E');
    return { before, ok, inv: g.state().inv };
  });
  check('pick up axe', axe.inv.includes('axe'), JSON.stringify(axe.before));

  // ---- chop a railing on the upper floor ----
  const rail = await ev(() => {
    const g = window.__game;
    const G = g.G;
    g.equip('axe');
    const r = G.house.railings[1];
    const p = r.position();
    g.teleport(p.x + 0.9, G.house.Y0 + 3.02, p.z);
    g.steps(30);
    g.lookAt(p.x, p.y + 0.6, p.z);
    const acts = g.actions();
    let n = 0;
    while (!r.removed && n < 30) {
      g.swing();
      n++;
    }
    g.steps(60);
    const fw = g.find('firewood').filter((f) => Math.hypot(f.pos[0] - p.x, f.pos[2] - p.z) < 2.5).length;
    return { removed: r.removed, swings: n, fw, acts };
  });
  check('chop upper-floor railing', rail.removed && rail.fw >= 2, JSON.stringify(rail));
  await shot('02-railing');

  // ---- carry a blanket and hang it on a window ----
  const win = await ev(() => {
    const g = window.__game;
    const G = g.G;
    g.equip('axe'); // unequip
    if (G.player.equipped) G.player.equip(G.player.equipped);
    const bl = G.entities.list.find((e) => (e.defId === 'blanket' || e.defId === 'plaid') && e.inWorld && !e.removed);
    const bp = bl.position();
    g.approach(bp.x, bp.y, bp.z, 1.0);
    const a1 = g.actions();
    g.act('E');
    const carried = G.player.carried;
    const carrying = !!carried && (carried.defId === 'blanket' || carried.defId === 'plaid');
    const w = G.house.windows.find((e) => e.data.zone === 'upper' && e.data.inward.x === 1);
    const c = w.data.center;
    g.teleport(c.x + 1.3, G.house.Y0 + 3.02, c.z);
    g.steps(30);
    g.lookAt(c.x, c.y, c.z);
    const uaBefore = G.thermal.zone('upper').ua;
    const a2 = g.actions();
    const ok = g.act('E', 'Завесить');
    G.thermal.update(1);
    const uaAfter = G.thermal.zone('upper').ua;
    return { carrying, ok, covered: !!w.data.cover, uaBefore, uaAfter, a1, a2 };
  });
  check('carry blanket', win.carrying, JSON.stringify(win.a1));
  check('hang blanket on window', win.covered && win.uaAfter < win.uaBefore, `UA ${win.uaBefore.toFixed(1)} -> ${win.uaAfter.toFixed(1)} ${JSON.stringify(win.a2)}`);
  await shot('03-window');

  // ---- light the stove ----
  const stove = await ev(() => {
    const g = window.__game;
    const G = g.G;
    for (const id of ['paper', 'paper', 'kindling', 'kindling', 'firewood', 'firewood', 'firewood']) g.give(id, { moisture: 0.05 });
    g.give('matches', { charges: 20 });
    const sp = G.house.stove.data.front;
    g.teleport(sp.x, G.house.Y0 + 0.02, sp.z + 1.1);
    g.steps(30);
    g.lookAt(sp.x, sp.y + 0.1, sp.z - 0.2);
    const acts = g.actions();
    let fed = 0;
    for (let i = 0; i < 7; i++) if (g.act('E')) fed++;
    g.equip('matches');
    let lit = false;
    for (let i = 0; i < 15 && !lit; i++) {
      if (!G.interact.flame) g.act('LMB');
      if (G.interact.flame) {
        g.act('LMB', 'Поджечь');
        lit = G.fires.stoveFire.burning;
      }
    }
    const t0 = G.thermal.zone('ground').T;
    g.simulate(40 * 60);
    return { acts, fed, lit, status: G.fires.stoveFire.status(), t0, t1: G.thermal.zone('ground').T, power: G.fires.stoveFire.power };
  });
  check('feed stove', stove.fed >= 6, JSON.stringify(stove.acts));
  check('light stove', stove.lit, stove.status);
  check('stove heats the house', stove.t1 > stove.t0 + 3, `${stove.t0.toFixed(1)} -> ${stove.t1.toFixed(1)} °C, ${stove.power.toFixed(1)} kW`);
  await ev(() => window.__game.lookAt(window.__game.G.house.stove.data.front.x, window.__game.G.house.Y0 + 0.6, window.__game.G.house.stove.data.front.z));
  await page.waitForTimeout(800);
  await shot('04-stove');

  // ---- the air inside is a field, not one number ----
  const field = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const V = g.THREE.Vector3;
    const Th = G.thermal;
    const Y = G.house.Y0;
    const sf = G.fires.stoveFire;
    const feed = (n) => { for (let i = 0; i < n; i++) G.fires.addFuel(sf, G.entities.spawnItem('firewood', new V(0, -50, 0), { moisture: 0.05 })); };
    for (let h = 0; h < 12; h++) { if (sf.fuel.length < 2) feed(2); if (!sf.burning) G.fires.ignite(sf, 1); g.simulate(600); }
    const at = (x, y, z) => Th.tAt(new V(x, Y + y, z));
    const out = { stove: at(-3.5, 1.2, -2.4), corner: at(4.5, 1.2, 3.5), centre: at(0.5, 1.2, 0) };
    const w = G.house.windows.find((e) => e.data.zone === 'ground' && e.data.inward.x === -1);
    const near = new V(4.2, Y + 1.4, 0.8);
    out.draftBefore = Th.draftAt(near);
    G.house.breakGlass(w, true);
    G.thermal.update(1);
    g.simulate(900);
    out.draftBroken = Th.draftAt(near);
    out.nearBroken = Th.tAt(near);
    out.centreBroken = at(0.5, 1.2, 0);
    G.house.hangCover(w, G.entities.spawnItem('blanket', new V(0, -50, 0)));
    G.thermal.update(1);
    out.draftCovered = Th.draftAt(near);
    return out;
  });
  check('stove side warmer than far corner', field.stove > field.corner + 3, JSON.stringify(field));
  check('broken window: draught and a cold spot', field.draftBroken > 0.3 && field.nearBroken < field.centreBroken - 1);
  check('blanket over the hole cuts the draught', field.draftCovered < field.draftBroken * 0.5);

  // ---- fell a tree and cut the trunk ----
  const tree = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const tr = G.forest.treesNear(0, 0, 90).filter((t) => t.alive && (t.type === 'spruce' || t.type === 'pine') && t.r < 0.2 && Math.hypot(t.x, t.z) > 15 && G.region.slopeAt(t.x, t.z) < 0.3).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    G.forest.update(new g.THREE.Vector3(tr.x, tr.y, tr.z), true);
    const px = tr.x + 1.0, pz = tr.z + 0.3;
    g.teleport(px, G.terrain.heightAt(px, pz) + 0.05, pz);
    g.steps(20);
    g.equip('axe');
    // Aim at exposed wood above today's snow, not the buried summer base.
    g.lookAt(tr.x, Math.max(tr.y + 1.2, G.terrain.heightAt(tr.x, tr.z) + 0.8), tr.z);
    const acts = g.actions();
    let n = 0;
    while (tr.alive && n < 80) {
      g.swing();
      n++;
    }
    g.steps(600);
    const trunk = G.entities.list.find((e) => e.data?.wood && e.defId === 'trunk' && !e.removed);
    const stump = G.entities.list.find((e) => e.kind === 'stump' && !e.removed);
    return { fell: !tr.alive, n, acts, trunk: !!trunk, branches: trunk ? trunk.data.wood.whorls.length : 0, stump: stump ? +stump.data.wood.len.toFixed(2) : 0, info: trunk ? g.actions().info : '' };
  });
  check('fell a tree', tree.fell, JSON.stringify(tree));
  check('felled tree lies as a trunk with branches, a stump remains', tree.trunk && tree.branches > 0 && tree.stump > 0.2, JSON.stringify(tree));
  await shot('05-tree');

  // ---- drill an ice hole and take water ----
  const ice = await ev(() => {
    const g = window.__game;
    const G = g.G;
    // a point on thick lake ice near the house, away from the thin patch
    let px = 0, pz = 0, lvl = 0;
    for (let r = 10; r < 600 && !lvl; r += 4) for (let a = 0; a < 6.28; a += 0.2) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const L = G.region.waterAt(x, z);
      if (Number.isNaN(L) || L === 0 || G.region.iceAt(x, z) < 0.3) continue;
      if (Math.hypot(x - G.lake.thin.x, z - G.lake.thin.z) < G.lake.thin.r + 4) continue;
      let ok = true;
      for (let b = 0; b < 6.28; b += 0.8) if (G.region.iceAt(x + Math.cos(b) * 3, z + Math.sin(b) * 3) < 0.3) ok = false;
      if (ok) { px = x; pz = z; lvl = L; break; }
    }
    g.teleport(px, lvl + 0.1, pz);
    G.lake.stream(G.player.pos, 50);
    G.forest.update(G.player.pos, true);
    g.steps(30);
    g.give('auger');
    g.equip('auger');
    const e = G.player.eyePos;
    g.lookAt(e.x + 1, lvl, e.z);
    const acts = g.actions();
    g.act('LMB');
    g.steps(1);
    const holes = G.lake.holes.length;
    g.give('pot');
    g.equip('pot');
    g.lookAt(e.x + 1, lvl, e.z);
    const acts2 = g.actions();
    g.act('LMB', 'воды');
    const pot = G.player.inventory.find((x) => x.defId === 'pot');
    return { holes, water: pot.contents.water, acts, acts2, thin: G.player.water != null };
  });
  check('drill ice hole', ice.holes >= 1, JSON.stringify(ice.acts));
  check('fill pot with lake water', ice.water > 1, JSON.stringify(ice.acts2));
  await shot('06-lake');

  // ---- chop the door: house loses heat ----
  const door = await ev(() => {
    const g = window.__game;
    const G = g.G;
    g.equip('axe');
    const d = G.house.door;
    const p = d.position();
    g.teleport(1.5, G.house.Y0 + 0.02, 2.4);
    g.steps(30);
    g.lookAt(1.5, G.house.Y0 + 1.2, 3.8);
    const acts = g.actions();
    G.thermal.update(1);
    const ua0 = G.thermal.zone('ground').ua;
    let n = 0;
    while (!d.removed && n < 40) {
      g.swing();
      n++;
    }
    G.thermal.update(1);
    return { removed: d.removed, n, ua0, ua1: G.thermal.zone('ground').ua, acts };
  });
  check('chop the door', door.removed && door.ua1 > door.ua0 * 2, `UA ${door.ua0.toFixed(0)} -> ${door.ua1.toFixed(0)} ${JSON.stringify(door.acts)}`);

  // ---- more systems ----
  const more = await ev(() => {
    const g = window.__game;
    const G = g.G;
    const out = {};
    // eat a can (needs a knife or an axe in the pack)
    g.give('stew');
    g.equip('stew');
    const k0 = G.body.kcal;
    g.act('LMB');
    out.ate = G.body.kcal > k0 + 500;
    // snow in a pot on the stove melts and boils
    const pot = g.entity(g.give('pot'));
    if(G.player.equipped !== pot) G.player.equip(pot);
    pot.contents.snow = 1.0;
    pot.contents.water = 0;
    const sf = G.fires.stoveFire;
    for (const id of ['paper', 'kindling', 'kindling', 'firewood', 'firewood', 'firewood']) G.fires.addFuel(sf, G.entities.spawnItem(id, new g.THREE.Vector3(0, -50, 0), { moisture: 0.05 }));
    G.fires.ignite(sf, 1);
    const sp = G.house.stove.data.front;
    g.teleport(sp.x, G.house.Y0 + 0.02, sp.z + 1.1);
    g.steps(30);
    g.lookAt(sp.x, sp.y + 0.1, sp.z - 0.2);
    out.potPlaced = g.act('G', 'Поставить');
    if (!out.potPlaced || pot.pinned !== 'fire') throw Error('Pot fixture was not placed on stove: '+JSON.stringify(g.actions()));
    g.simulate(25 * 60);
    out.boiled = pot.contents.boiled && pot.contents.snow < 0.01;
    // a thrown log breaks a window
    const w = G.house.windows.find((e) => e.data.zone === 'ground' && e.data.inward.z === -1 && e.data.glass === 'intact');
    const c = w.data.center;
    g.teleport(c.x, G.house.Y0 + 0.02, c.z - 1.6);
    g.steps(5);
    g.lookAt(c.x, c.y, c.z);
    const fw = G.entities.spawnItem('firewood', G.player.eyePos.add(G.player.forward().multiplyScalar(0.8)));
    G.player.carry(fw);
    g.steps(20);
    G.player.releaseCarry(true);
    g.steps(60);
    out.windowBroken = w.data.glass === 'broken';
    // campfire outside
    g.teleport(0, G.terrain.heightAt(0, 14) + 0.05, 14);
    g.steps(10);
    const p = G.player.eyePos.add(G.player.forward().setY(0).normalize().multiplyScalar(1.2));
    g.lookAt(p.x, G.terrain.heightAt(p.x, p.z), p.z);
    g.steps(1);
    g.act('G', 'кострище');
    g.steps(2);
    const f = G.fires.list.filter((x) => x.kind === 'camp').sort((a, b) => a.pos.distanceTo(G.player.pos) - b.pos.distanceTo(G.player.pos))[0];
    for (const id of ['bark', 'kindling', 'kindling', 'firewood']) g.give(id, { moisture: 0.05 });
    g.lookAt(f.pos.x, f.pos.y, f.pos.z);
    for (let i = 0; i < 4; i++) g.act('E');
    g.give('matches', { charges: 20 });
    g.equip('matches');
    for (let i = 0; i < 15 && !f.burning; i++) {
      if (!G.interact.flame) g.act('LMB');
      if (G.interact.flame) g.act('LMB', 'Поджечь');
    }
    out.campfire = f.burning;
    // thin ice
    g.teleport(G.lake.thin.x, G.lake.levelAt(G.lake.thin.x, G.lake.thin.z) + 0.1, G.lake.thin.z);
    G.lake.stream(G.player.pos, 50);
    g.steps(30);
    out.fellIn = !!G.player.water;
    g.simulate(30);
    out.wetInWater = G.body.wetness > 0.9;
    G.player.water.climb = 2;
    g.steps(2);
    out.climbedOut = !G.player.water && out.wetInWater;
    return out;
  });
  check('eat a can', more.ate);
  check('pot of snow boils on the stove', more.boiled);
  check('thrown firewood breaks a window', more.windowBroken);
  check('campfire lights', more.campfire);
  check('fall through thin ice and climb out', more.fellIn && more.climbedOut, JSON.stringify(more));

  // ---- body cools outside at night in a blizzard ----
  const cold = await ev(() => {
    const g = window.__game;
    const G = g.G;
    G.settings.weatherLock = 'blizzard';
    Object.assign(G.body, { core: 37, wetness: 0, snow: 0, condition: 100 });
    g.teleport(0, G.terrain.heightAt(0, 20) + 0.05, 20);
    g.steps(20);
    const c0 = G.body.core;
    g.simulate(60 * 60);
    return { c0, c1: G.body.core, hands: G.body.hands, nan: Number.isNaN(G.body.core) };
  });
  check('body cools in a blizzard', cold.c1 < cold.c0 - 0.3 && !cold.nan, `${cold.c0.toFixed(2)} -> ${cold.c1.toFixed(2)}, hands ${cold.hands.toFixed(1)}`);
  await page.waitForTimeout(1200);
  await shot('07-blizzard');

  // ---- night inside with the stove ----
  await ev(() => {
    const g = window.__game;
    const G = g.G;
    G.settings.weatherLock = 'clear';
    const h = (G.time / 3600) % 24;
    g.simulate(((23 - h + 24) % 24) * 3600);
    G.body.core = 37;
    G.body.condition = 100;
    G.dead = false;
    for (const id of ['firewood', 'firewood']) g.give(id, { moisture: 0.05 });
    const sp = G.house.stove.data.front;
    g.teleport(1.2, G.house.Y0 + 0.02, 1.5);
    g.steps(20);
    g.lookAt(sp.x, sp.y, sp.z);
    g.act('E');
    g.act('E');
    g.simulate(600);
  });
  await page.waitForTimeout(1500);
  await shot('08-night-inside');

  // ---- every shelter can be walked into ----
  const enter = await ev(() => {
    const g = window.__game;
    const G = g.G, T = g.THREE;
    const fails = [];
    let n = 0;
    // fresh legs: earlier checks left the player cold and loaded
    G.player.releaseCarry?.();
    for (const e of [...G.player.inventory]) if (!G.player.isWorn(e)) G.player.forget(e);
    Object.assign(G.body, { core: 37, wetness: 0, snow: 0, condition: 100, fatigue: 0.2 });
    G.settings.weatherLock = 'clear';
    for (const q of G.region.places) {
      if (!['hut', 'fishing', 'station', 'leanto', 'grotto'].includes(q.kind)) continue;
      const f = new T.Vector3(Math.sin(q.yaw), 0, Math.cos(q.yaw));
      const start = new T.Vector3(q.x, 0, q.z).addScaledVector(f, q.kind === 'station' ? 5 : 4.2);
      g.teleport(start.x, G.terrain.heightAt(start.x, start.z) + 0.1, start.z);
      G.forest.update(G.player.pos, true);
      G.player.yaw = Math.atan2(f.x, f.z);
      g.steps(5);
      G.input.keys.add('KeyW');
      let inside = false;
      for (let i = 0; i < 400 && !inside; i++) {
        g.steps(1);
        inside = !!G.structures.shelterAt(G.player.pos);
      }
      G.input.keys.delete('KeyW');
      n++;
      if (!inside) fails.push(q.kind);
    }
    return { n, fails };
  });
  check('walk into every shelter', enter.n >= 6 && enter.fails.length === 0, JSON.stringify(enter));

  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  await server.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
