// Human corpses in the actual game: solitary placement, clothing-owned pockets,
// loose equipment nearby and capacity-safe transfers without duplicate loot.
// NODE_PATH=/opt/codex/cua_node/lib/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/corpses-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(__dirname, '../test-results/corpses');
fs.mkdirSync(OUT, { recursive: true });
let checks = 0;
function check(name, ok, data) { assert.ok(ok, `${name}: ${JSON.stringify(data)}`); checks++; console.log('PASS ', name, data ? JSON.stringify(data) : ''); }

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 5212, strictPort: true, hmr: false }, logLevel: 'error' });
  let browser;
  const stop = async () => { await browser?.close(); await server.close(); process.exit(130); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await server.listen();
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1120, height: 760 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url?.endsWith('/favicon.ico')) errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5212/?autostart=1&test=1&seed=42&hour=13&weather=clear');
    await page.waitForFunction(() => window.__game?.G.snow || document.querySelector('#loading pre'), null, { timeout: 240000 });
    const failed = await page.evaluate(() => document.querySelector('#loading pre')?.textContent);
    check('the game loads with the corpse system', !failed && await page.evaluate(() => !!window.__game?.G.corpses), failed);
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const shot = async name => {
      if (process.env.CORPSE_SCREENSHOTS === '0') return;
      await ev(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 240000 });
    };
    await ev(() => { const g = window.__game; g.setManualStepping(true); g.G.input.enabled = true; });

    const placement = await ev(() => {
      const { G, THREE } = window.__game, corpses = G.corpses.list, sites = new Set(), invalid = [];
      let nearestPair = Infinity;
      for (const e of corpses) {
        const d = e.data.corpse, p = e.position(), s = d.site;
        if (sites.has(s.key)) invalid.push(`duplicate site ${s.key}`);
        sites.add(s.key);
        if (e.kind !== 'corpse' || !e.inWorld || e.removed || !G.entities.list.includes(e) || !e.colliders.length) invalid.push(`unregistered corpse ${e.id}`);
        if (!Number.isNaN(G.region.waterAt(p.x, p.z))) invalid.push(`water at ${e.id}`);
        if (Math.hypot(p.x - s.x, p.z - s.z) > 32) invalid.push(`far from site ${e.id}`);
        for (const other of corpses) if (other !== e) nearestPair = Math.min(nearestPair, p.distanceTo(other.position()));
        const size = new THREE.Box3().setFromObject(e.obj).getSize(new THREE.Vector3());
        let meshes = 0; e.obj.traverse(o => { if (o.isMesh) meshes++; });
        if (meshes < 12 || Math.hypot(size.x, size.z) < 1.3 || size.y > 0.9) invalid.push(`missing human silhouette ${e.id}`);
      }
      return { count: corpses.length, kinds: [...new Set(corpses.map(e => e.data.corpse.site.kind))], nearestPair, invalid };
    });
    check('single human bodies lie near structures and cave mouths on dry ground', placement.count >= 2 && placement.kinds.includes('house') && placement.kinds.includes('cave') && placement.nearestPair > 4 && !placement.invalid.length, placement);

    const ownership = await ev(() => {
      const { G } = window.__game, invalid = [], ids = new Set();
      for (const corpse of G.corpses.list) {
        const d = corpse.data.corpse;
        if ('inventory' in d) invalid.push(`shared corpse inventory ${corpse.id}`);
        if (!(d.worn instanceof Map) || !d.worn.size) invalid.push(`no clothing ${corpse.id}`);
        const pockets = [...d.worn.values()].flatMap(e => e.pockets);
        if (!pockets.some(e => e.def?.food)) invalid.push(`no food in clothing ${corpse.id}`);
        const pocketGear = pockets.filter(e => e.def?.tool), looseGear = d.scattered.filter(e => e.def?.tool);
        if (!pocketGear.length || pocketGear.length !== looseGear.length) invalid.push(`equipment not split in half ${corpse.id}`);
        for (const [slot, garment] of d.worn) {
          if (garment.def?.wear?.slot !== slot) invalid.push(`wrong worn slot ${garment.id}`);
          if (Math.abs(garment.pocketMass - garment.pockets.reduce((sum, e) => sum + e.mass, 0)) > 1e-8) invalid.push(`wrong pocket weight ${garment.id}`);
        }
        for (const item of [...d.worn.values(), ...pockets]) {
          if (ids.has(item.id) || item.removed || item.inWorld || item.body || !G.entities.list.includes(item) || G.player.inventory.includes(item)) invalid.push(`invalid ownership ${item.id}`);
          ids.add(item.id);
        }
        for (const item of d.scattered) {
          if (ids.has(item.id) || !item.inWorld || !item.body || item.removed || !G.entities.list.includes(item)) invalid.push(`not physical loose gear ${item.id}`);
          if (item.position().distanceTo(corpse.position()) > 6) invalid.push(`loose gear too far ${item.id}`);
          ids.add(item.id);
        }
      }
      const before = G.corpses.list.map(e => e.id);
      G.corpses.build();
      return { invalid, itemCount: ids.size, rebuilt: G.corpses.list.map(e => e.id), before };
    });
    check('clothing owns all pockets; exactly half the equipment lies physically nearby', !ownership.invalid.length && ownership.itemCount > 0 && JSON.stringify(ownership.before) === JSON.stringify(ownership.rebuilt), { invalid: ownership.invalid, items: ownership.itemCount });

    const aimed = await ev(() => {
      const g = window.__game, { G } = g;
      const corpse = G.corpses.list.find(e => e.data.corpse.site.kind === 'house');
      window.__corpseTest = { corpse };
      const p = corpse.position();
      g.approach(p.x, p.y + 0.2, p.z, 1.25);
      return { id: corpse.id, actions: g.actions() };
    });
    check('the normal targeting ray offers search on the body', aimed.actions.actions.some(a => a.startsWith('E:') && a.includes('Обыскать')), aimed);
    await shot('body-near-house');
    const opened = await ev(() => window.__game.act('E', 'Обыскать'));
    await page.locator('#inventory.corpse-inventory').waitFor({ state: 'visible' });
    const contents = await page.locator('#inventory').innerText();
    check('search shows clothing with its own pockets and blocks movement', opened && contents.includes('Надето') && contents.includes('Карман') && await ev(() => window.__game.G.hud.invOpen && !window.__game.G.input.enabled), contents.slice(0, 240));
    await shot('corpse-clothing-and-pockets');

    const selected = await ev(() => {
      const f = window.__corpseTest, d = f.corpse.data.corpse;
      f.garment = [...d.worn.values()].find(e => e.pockets.length);
      f.pockets = [...f.garment.pockets];
      f.state = { moisture: f.garment.moisture, charges: f.garment.charges, params: JSON.stringify(f.garment.params) };
      f.beforeCount = d.worn.size;
      return { id: f.garment.id, slot: f.garment.def.wear.slot };
    });
    await page.locator(`#inventory [data-act="corpse-take"][data-id="${selected.id}"]`).click();
    const transferred = await ev(() => {
      const { G } = window.__game, f = window.__corpseTest, d = f.corpse.data.corpse, item = f.garment;
      const intact = item.moisture === f.state.moisture && item.charges === f.state.charges && JSON.stringify(item.params) === f.state.params;
      const moved = G.player.inventory.includes(item) && ![...d.worn.values()].includes(item) && d.worn.size === f.beforeCount - 1;
      const pocketsFollow = f.pockets.length === item.pockets.length && f.pockets.every((e, i) => item.pockets[i] === e && !G.player.inventory.includes(e));
      G.player.wear(item);
      const playerCount = G.player.inventory.length, sourceCount = d.worn.size;
      const duplicate = G.corpses.take(f.corpse, item);
      return { intact, moved, pocketsFollow, wearable: G.player.worn.get(item.def.wear.slot) === item,
        noDuplicate: !duplicate && G.player.inventory.length === playerCount && d.worn.size === sourceCount,
        pocketWeightCounted: G.player.packWeight() >= item.pocketMass - 1e-8 };
    });
    check('clothing transfers with the same pocket contents and can be worn', transferred.intact && transferred.moved && transferred.pocketsFollow && transferred.wearable && transferred.noDuplicate && transferred.pocketWeightCounted, transferred);

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__game.G.hud.invOpen);
    await ev(() => { const { G } = window.__game; G.hud.invSel = window.__corpseTest.garment.id; G.hud.toggleInventory(true); });
    const pocket = await ev(() => {
      const { G } = window.__game, f = window.__corpseTest;
      f.pocketItem = f.garment.pockets.find(e => e.charges > 0) ?? f.garment.pockets[0];
      f.pocketState = { charges: f.pocketItem.charges, moisture: f.pocketItem.moisture, params: JSON.stringify(f.pocketItem.params) };
      f.weightBeforeExtract = G.player.packWeight();
      return { item: f.pocketItem.id, garment: f.garment.id };
    });
    await page.locator(`#inventory [data-act="pocket-take"][data-garment-id="${pocket.garment}"][data-id="${pocket.item}"]`).click();
    const extracted = await ev(() => {
      const { G } = window.__game, f = window.__corpseTest, e = f.pocketItem;
      return { moved: G.player.inventory.includes(e) && !f.garment.pockets.includes(e),
        sameWeight: Math.abs(G.player.packWeight() - f.weightBeforeExtract) < 1e-8,
        state: e.charges === f.pocketState.charges && e.moisture === f.pocketState.moisture && JSON.stringify(e.params) === f.pocketState.params,
        noDuplicate: !G.player.takeFromPocket(f.garment, e) };
    });
    check('the player can extract a pocket item from taken clothing without changing total weight', extracted.moved && extracted.sameWeight && extracted.state && extracted.noDuplicate, extracted);
    const entityCountBeforePut = await ev(() => window.__game.G.entities.list.length);
    await page.locator(`#inventory [data-act="pocket-put"][data-garment-id="${pocket.garment}"][data-id="${pocket.item}"]`).click();
    const returned = await ev(() => {
      const { G } = window.__game, f = window.__corpseTest;
      return { nested: f.garment.pockets.includes(f.pocketItem) && !G.player.inventory.includes(f.pocketItem),
        sameWeight: Math.abs(G.player.packWeight() - f.weightBeforeExtract) < 1e-8,
        entities: G.entities.list.length, noDuplicate: !G.player.putInPocket(f.garment, f.pocketItem) };
    });
    check('putting the item back in clothing pockets preserves identity and carried weight', returned.nested && returned.sameWeight && returned.noDuplicate && returned.entities === entityCountBeforePut, returned);
    const overloaded = await ev(() => {
      const g = window.__game, { G } = g, f = window.__corpseTest, P = G.player;
      const bagId = g.give('backpack_big'), bag = G.entities.list.find(e => e.id === bagId);
      P.wear(bag);
      const weights = [g.give('battery'), g.give('battery')].map(id => G.entities.list.find(e => e.id === id));
      P.unwear(bag);
      const before = P.packWeight(), limit = P.maxPack(), entityCount = G.entities.list.length;
      const extracted = P.takeFromPocket(f.garment, f.pocketItem);
      const extractWeight = P.packWeight();
      const putBack = P.putInPocket(f.garment, f.pocketItem);
      const result = { before, limit, extracted, putBack, sameWeight: Math.abs(before - extractWeight) < 1e-8 && Math.abs(before - P.packWeight()) < 1e-8,
        entitiesUnchanged: G.entities.list.length === entityCount, stillNested: f.garment.pockets.includes(f.pocketItem) };
      for (const item of weights) G.entities.destroy(item);
      G.entities.destroy(bag);
      return result;
    });
    check('internal pocket moves remain possible when already overloaded', overloaded.before > overloaded.limit && overloaded.extracted && overloaded.putBack && overloaded.sameWeight && overloaded.entitiesUnchanged && overloaded.stillNested, overloaded);
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => !window.__game.G.hud.invOpen);
    await ev(() => window.__game.G.hud.openCorpse(window.__corpseTest.corpse));
    const afterReopen = await ev(() => ({ takenAbsent: ![...window.__corpseTest.corpse.data.corpse.worn.values()].includes(window.__corpseTest.garment), open: window.__game.G.hud.invOpen }));
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => !window.__game.G.hud.invOpen);
    check('Esc and Tab close search; reopening keeps the looted clothing state', afterReopen.open && afterReopen.takenAbsent, afterReopen);

    const capacity = await ev(() => {
      const g = window.__game, { G } = g, f = window.__corpseTest;
      f.blocked = [...f.corpse.data.corpse.worn.values()].find(e => e.mass >= 0.4);
      f.blockedContents = [...f.blocked.pockets];
      f.fillers = [];
      while (G.player.packWeight() + 0.4 <= G.player.maxPack()) {
        const id = g.give('nails');
        f.fillers.push(G.entities.list.find(e => e.id === id));
      }
      G.hud.openCorpse(f.corpse);
      return { id: f.blocked.id, weight: G.player.packWeight(), limit: G.player.maxPack(), itemMass: f.blocked.mass };
    });
    await page.locator(`#inventory [data-act="corpse-take"][data-id="${capacity.id}"]`).click();
    const blocked = await ev(() => {
      const { G } = window.__game, f = window.__corpseTest;
      return { stayed: [...f.corpse.data.corpse.worn.values()].includes(f.blocked), notInPack: !G.player.inventory.includes(f.blocked),
        pocketsUnchanged: f.blockedContents.every((e, i) => f.blocked.pockets[i] === e), weight: G.player.packWeight(), limit: G.player.maxPack() };
    });
    check('a full pack leaves clothing and its pocket contents on the corpse', blocked.stayed && blocked.notInPack && blocked.pocketsUnchanged && blocked.weight <= blocked.limit && await page.locator(`#inventory .corpse-item[data-item-id="${capacity.id}"]`).count() === 1, { ...capacity, ...blocked });
    await ev(() => { const { G } = window.__game; for (const e of window.__corpseTest.fillers) G.entities.destroy(e); G.hud.openCorpse(window.__corpseTest.corpse); });
    await page.locator(`#inventory [data-act="corpse-take"][data-id="${capacity.id}"]`).click();
    check('freeing space allows the same clothing to be collected later', await ev(() => { const f = window.__corpseTest; return window.__game.G.player.inventory.includes(f.blocked) && ![...f.corpse.data.corpse.worn.values()].includes(f.blocked); }));

    await ev(() => {
      const g = window.__game, { G } = g, f = window.__corpseTest;
      const id = g.give('backpack_big'); G.player.wear(G.entities.list.find(e => e.id === id));
      f.remaining = [...f.corpse.data.corpse.worn.values()];
      f.scattered = [...f.corpse.data.corpse.scattered];
      G.hud.openCorpse(f.corpse);
    });
    await page.locator('#inventory [data-act="corpse-take-all"]').click();
    const emptied = await ev(() => {
      const { G } = window.__game, f = window.__corpseTest, d = f.corpse.data.corpse;
      return { wornLeft: d.worn.size, allOwnedOnce: f.remaining.every(e => G.player.inventory.filter(x => x === e).length === 1),
        looseStillPhysical: f.scattered.every(e => e.inWorld && e.body && !G.player.inventory.includes(e)), bodyRemains: !f.corpse.removed && f.corpse.inWorld };
    });
    check('take all clothes leaves loose equipment to be picked up from the ground', !emptied.wornLeft && emptied.allOwnedOnce && emptied.looseStillPhysical && emptied.bodyRemains && await page.locator('#inventory [data-act="corpse-take-all"]').isDisabled(), emptied);
    await shot('looted-clothing-inventory');

    await ev(() => { const { G } = window.__game, p = window.__corpseTest.corpse.position(); window.__game.teleport(p.x + 8, G.terrain.heightAt(p.x + 8, p.z) + 0.1, p.z); G.hud.update(0); });
    check('moving away closes the search window', await ev(() => !window.__game.G.hud.invOpen));
    const revisit = await ev(() => {
      const g = window.__game, { G } = g, f = window.__corpseTest;
      const ids = G.corpses.list.map(e => e.id), playerIds = G.player.inventory.map(e => e.id);
      g.cave(0, true); g.cave(0, false); G.corpses.build();
      return { before: ids, after: G.corpses.list.map(e => e.id), stillEmpty: !f.corpse.data.corpse.worn.size,
        inventoryUnchanged: JSON.stringify(playerIds) === JSON.stringify(G.player.inventory.map(e => e.id)) };
    });
    check('cave visits do not respawn bodies or refill clothing pockets', JSON.stringify(revisit.before) === JSON.stringify(revisit.after) && revisit.stillEmpty && revisit.inventoryUnchanged, { bodies: revisit.after.length, stillEmpty: revisit.stillEmpty });
    check('no page errors', errors.length === 0, errors.slice(0, 5));
    console.log(`${checks} corpse browser checks passed; images in ${OUT}`);
  } finally { await browser?.close(); await server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
