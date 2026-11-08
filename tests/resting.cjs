// Resting wood integration with real Rapier bodies and Three.js geometry. Only
// wall-clock time and procedural textures are substituted; no browser is needed.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');
const R = require('@dimforge/rapier3d-compat');

(async () => {
  await R.init();
  const compiled = new Module(__filename);
  compiled._compile((await build({ stdin: {
    contents: "export * from './ctx'; export * from './entities'; export * from './resting'; export * from './wood/wood'; export * from './wood/piece'; export * as T from 'three';",
    resolveDir: path.join(__dirname, '../src/game'), loader: 'ts',
  }, bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [{
    name: 'cpu-textures', setup(b) {
      b.onLoad({ filter: /[\\/]core[\\/]textures\.ts$/ }, () => ({ loader: 'ts', contents: `
        import * as T from 'three'; const textures=new Map();
        export const Tex=new Proxy({}, {get:(_,name)=>()=>{if(!textures.has(name))textures.set(name,new T.Texture());return textures.get(name)}});
        export function worldUVBox(x,y,z){return new T.BoxGeometry(x,y,z)};`,
      }));
    },
  }] })).outputFiles[0].text, __filename);
  const S = compiled.exports, G = S.G, T = S.T;
  const originalPerformance = global.performance;
  let now = 10000, checks = 0, world;
  global.performance = { now: () => now };
  const test = (name, fn) => { fn(); checks++; console.log('PASS ', name); };
  function fixture() {
    world?.free(); now += 10000;
    world = new R.World({ x: 0, y: 0, z: 0 });
    Object.assign(G, { R, world, entities: new S.Entities(), resting: new S.Resting(), scene: new T.Scene(),
      player: { pos: new T.Vector3(), carried: null, forget() {} }, camera: new T.PerspectiveCamera(),
      terrain: { heightAt: () => -100 }, forest: { fallingStems: () => [] }, caves: { inside: false, rescue: () => false },
      audio: { play() {} }, hud: { message() {} } });
    return G;
  }
  function piece(x, y = .1, z = 10, sleeping = false) {
    const e = S.spawnPiece(S.makeRound('dead', .6, .04, .04), new T.Vector3(x, y, z), new T.Quaternion(), .2);
    if (sleeping) e.body.sleep();
    return e;
  }
  function tick(seconds = .41) { now += seconds * 1000; G.entities.sync(); G.resting.update(seconds); }
  function mergePieces(count = 6) {
    const pieces = Array.from({ length: count }, (_, i) => piece(10 + i * .8, .1, 10, true));
    G.entities.sync(); tick(1.1); tick(1.6);
    assert.equal(G.resting.info().merged, count);
    const pile = [...G.resting.piles.values()][0];
    assert.ok(pile.mesh && pieces.every(e => e.obj.parent === null && pile.mesh.has(e.id)));
    return { pieces, pile };
  }
  function triangles(group) {
    let count = 0;
    const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
    group.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry, n = g.index?.count ?? g.attributes.position.count;
      for (let i = 0; i < n; i += 3) {
        const vi = j => g.index ? g.index.getX(j) : j;
        a.fromBufferAttribute(g.attributes.position, vi(i)); b.fromBufferAttribute(g.attributes.position, vi(i + 1)); c.fromBufferAttribute(g.attributes.position, vi(i + 2));
        if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-18) count++;
      }
    });
    return count;
  }

  try {
    test('contact-connected wood sleeps together only after held, falling and moving members settle', () => {
      fixture();
      const pieces = [piece(10, .1), piece(10, .18), piece(10, .26)];
      world.step(); G.entities.sync();
      let contacts = 0; for (const e of pieces) world.contactPairsWith(e.colliders[0], () => contacts++);
      assert.ok(contacts >= 4, `expected a real contact-connected pile, found ${contacts}`);
      const awake = () => assert.ok(pieces.every(e => !e.body.isSleeping()));
      G.player.carried = pieces[2]; for (let i = 0; i < 6; i++) tick(); awake();
      G.player.carried = null; G.forest.fallingStems = () => [pieces[2]];
      for (let i = 0; i < 6; i++) tick(); awake();
      G.forest.fallingStems = () => []; pieces[2].body.setLinvel({ x: .4, y: 0, z: 0 }, true);
      for (let i = 0; i < 6; i++) tick(); awake();
      pieces[2].body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      for (let i = 0; i < 4; i++) tick();
      assert.ok(pieces.every(e => e.body.isSleeping())); assert.equal(G.resting.info().slept, 3);
      pieces[0].body.wakeUp(); G.entities.sync(); tick();
      assert.ok(!pieces[0].body.isSleeping(), 'a woken piece must earn its stillness checks again');
    });

    test('quiet sleeping wood draws merged with retained geometry and cave/distance culling', () => {
      fixture(); const { pieces, pile } = mergePieces();
      assert.equal(triangles(pile.mesh.group), pieces.reduce((n, e) => n + triangles(e.obj), 0));
      const originalParts = pieces.reduce((n, e) => { e.obj.traverse(o => { if (o.isMesh) n++; }); return n; }, 0);
      assert.ok(pile.mesh.group.children.length < originalParts);
      assert.ok(pile.mesh.group.children.every(m => m.castShadow && m.receiveShadow));
      G.caves.inside = true; tick(.01); assert.equal(pile.mesh.group.visible, false);
      G.caves.inside = false; tick(.01); assert.equal(pile.mesh.group.visible, true);
      G.camera.position.set(5000, 0, 0); tick(.01); assert.equal(pile.mesh.group.visible, false);
      G.camera.position.set(10, 1, 10); tick(.01); assert.equal(pile.mesh.group.visible, true);
    });

    test('wake and pickup immediately remove only their own triangles without waiting for a rebuild', () => {
      fixture(); const { pieces, pile } = mergePieces(), [woken, picked] = pieces;
      const batch = pile.mesh, before = triangles(batch.group), one = triangles(woken.obj), collider = woken.colliders[0];
      const position = woken.body.translation(); woken.body.setTranslation({ ...position, x: position.x + 2 }, true);
      G.entities.sync();
      assert.equal(woken.obj.parent, G.scene); assert.equal(woken.obj.position.x, position.x + 2);
      assert.equal(woken.restSince, 0); assert.equal(batch.has(woken.id), false);
      assert.equal(triangles(batch.group), before - one); assert.equal(G.entities.byCollider.get(collider.handle), woken);
      const oldHandles = picked.colliders.map(c => c.handle);
      G.entities.removeFromWorld(picked);
      assert.equal(picked.obj.parent, null); assert.equal(picked.body, null); assert.equal(picked.inWorld, false);
      assert.equal(batch.has(picked.id), false); assert.equal(triangles(batch.group), before - one - triangles(picked.obj));
      assert.ok(oldHandles.every(h => !G.entities.byCollider.has(h)));
      assert.ok(pieces.slice(2).every(e => batch.has(e.id) && !e.obj.parent));
    });

    test('changing and cutting merged wood leave no ghost, preserve other members, and release only owned buffers', () => {
      fixture(); const { pieces, pile } = mergePieces(), [changed, cut] = pieces;
      const batch = pile.mesh, before = triangles(batch.group), changedTriangles = triangles(changed.obj), cutTriangles = triangles(cut.obj);
      const sharedMaterials = new Set(), owned = [], oldObject = changed.obj;
      for (const mesh of batch.group.children) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) sharedMaterials.add(m);
      oldObject.traverse(o => { if (o.isMesh) owned.push(o.geometry); });
      let ownedDisposed = 0, materialDisposed = 0;
      owned.forEach(g => g.addEventListener('dispose', () => ownedDisposed++));
      sharedMaterials.forEach(m => m.addEventListener('dispose', () => materialDisposed++));
      changed.data.wood.r0 *= .9; S.refreshWood(changed, true);
      assert.notEqual(changed.obj, oldObject); assert.equal(changed.obj.parent, G.scene); assert.equal(ownedDisposed, owned.length);
      assert.equal(batch.has(changed.id), false); assert.equal(triangles(batch.group), before - changedTriangles);
      const handles = cut.colliders.map(c => c.handle), length = cut.data.wood.len, pose = cut.position(), rotation = cut.obj.quaternion.clone();
      const halves = S.cutPiece(cut, .25, pose, rotation);
      assert.equal(cut.removed, true); assert.equal(cut.obj.parent, null); assert.equal(batch.has(cut.id), false);
      assert.equal(halves.length, 2); assert.ok(Math.abs(halves.reduce((n, e) => n + e.data.wood.len, 0) - length) < 1e-6);
      assert.ok(halves.every(e => e.inWorld && e.body && e.obj.parent === G.scene));
      assert.ok(handles.every(h => !G.entities.byCollider.has(h)));
      assert.equal(triangles(batch.group), before - changedTriangles - cutTriangles);
      assert.ok(pieces.slice(2).every(e => batch.has(e.id) && e.obj.parent === null));
      let batchDisposed = 0; batch.group.children.forEach(m => m.geometry.addEventListener('dispose', () => batchDisposed++));
      const oldBatchParts = batch.group.children.length;
      tick(1.6);
      assert.equal(batchDisposed, oldBatchParts); assert.equal(materialDisposed, 0);
      assert.equal(G.resting.info().merged, 4); assert.ok(pieces.slice(2).every(e => !e.obj.parent));
    });
    console.log(`${checks} resting wood integration checks passed`);
  } finally {
    world?.free(); global.performance = originalPerformance;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
