// Loose things at rest.
//
// Round logs on round logs, sticks on a slope: a pile can keep trembling for ever, and
// one trembling piece keeps everything it touches awake in the physics. Pieces that have
// not really moved for a while are put to sleep together with everything awake they
// touch, never one by one: a piece that has just lost its support must stay free to fall,
// so whatever wakes up has to keep still for a while again first.
//
// Wood that lies asleep is drawn merged, one mesh per material for each patch of ground,
// instead of every stick and log on its own. A piece is taken out of the merged mesh at
// once when it wakes up, is picked up or changes; the patch is redrawn when it is quiet.
import * as THREE from 'three';
import { G } from './ctx';
import { Entity } from './entities';
import { MergedMeshes } from './merge';

/** how often stillness is checked, s */
const PASS = 0.4;
/** checks in a row without moving before a group is put to sleep */
const STILL_PASSES = 3;
/** how far a piece may wobble between checks and still count as still (m, rad) */
const STILL_MOVE = 0.02;
const STILL_TURN = 0.05;
/** and how fast it may be going at the moment of the check, m/s */
const STILL_SPEED = 0.15;
/** far from the player slow creeping is not worth simulating either */
const FAR = 120;
const FAR_MOVE = 0.12;
const FAR_SPEED = 0.5;

/** patches of ground the resting wood is merged by, m */
const CELL = 32;
/** asleep this long before it is merged, ms */
const SETTLED_MS = 1000;
/** a patch is redrawn when nothing in it changed for this long, ms */
const QUIET_MS = 1500;
/** fewer pieces than this in a patch are drawn on their own */
const MIN_MERGED = 3;
/** drawing distance by size: small sticks, middling pieces, big logs (as for single pieces) */
const DRAW_FAR = [70, 160, 400];

interface Track {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** checks in a row it kept still */
  still: number;
  far: boolean;
}

interface Pile {
  key: string;
  cls: number;
  members: Set<Entity>;
  /** members drawn by the merged mesh (their own objects are out of the scene) */
  merged: Set<Entity>;
  mesh: MergedMeshes | null;
  changed: number;
}

export class Resting {
  private tracks = new Map<Entity, Track>();
  private t = 0;
  private piles = new Map<string, Pile>();
  private pileOf = new Map<Entity, Pile>();
  /** for tests and the debug panel */
  stats = { slept: 0, rebuilt: 0 };

  update(dt: number) {
    this.t -= dt;
    if (this.t <= 0) {
      this.t = PASS;
      this.settle();
      this.collect();
    }
    this.redraw();
  }

  /** It moves again (it was asleep): watch it from the start, draw it on its own. */
  woke(e: Entity) {
    this.tracks.delete(e);
    this.drop(e);
  }

  /** Taken out of its patch: picked up, changed, gone, or woken. */
  drop(e: Entity) {
    const pile = this.pileOf.get(e);
    if (!pile) return;
    this.pileOf.delete(e);
    pile.members.delete(e);
    pile.changed = performance.now();
    if (pile.merged.delete(e)) {
      pile.mesh?.hide(e.id);
      if (e.obj && !e.obj.parent && e.inWorld) G.scene.add(e.obj);
    }
  }

  // ---------- sleep ----------

  private settle() {
    const P = G.player;
    const stems = new Set(G.forest?.fallingStems() ?? []);
    const next = new Map<Entity, Track>();
    for (const e of G.entities.list) {
      if (e.kind !== 'item' || !e.body || !e.inWorld || e.removed) continue;
      const b = e.body;
      if (b.isSleeping() || e === P.carried || stems.has(e)) continue;
      const t = b.translation(), r = b.rotation();
      const far = (t.x - P.pos.x) ** 2 + (t.z - P.pos.z) ** 2 > FAR * FAR;
      let tr = this.tracks.get(e);
      if (!tr) tr = { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w, still: 0, far };
      else {
        const v = b.linvel();
        const moved = Math.hypot(t.x - tr.x, t.y - tr.y, t.z - tr.z);
        const speed = Math.hypot(v.x, v.y, v.z);
        const dot = Math.min(1, Math.abs(r.x * tr.qx + r.y * tr.qy + r.z * tr.qz + r.w * tr.qw));
        const turned = 2 * Math.acos(dot);
        const still = far ? moved < FAR_MOVE && speed < FAR_SPEED : moved < STILL_MOVE && turned < STILL_TURN && speed < STILL_SPEED;
        tr.still = still ? tr.still + 1 : 0;
        Object.assign(tr, { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w, far });
      }
      next.set(e, tr);
    }
    this.tracks = next;
    if (!next.size) return;
    // groups of awake pieces touching each other
    const parent = new Map<Entity, Entity>();
    const find = (e: Entity): Entity => {
      let r = e;
      while (parent.get(r) !== r) r = parent.get(r)!;
      while (e !== r) {
        const n = parent.get(e)!;
        parent.set(e, r);
        e = n;
      }
      return r;
    };
    for (const e of next.keys()) parent.set(e, e);
    // touching something awake that is not watched here (held, a falling stem): stays awake
    const held = new Set<Entity>();
    for (const e of next.keys()) {
      for (const c of e.colliders) {
        G.world.contactPairsWith(c, (c2) => {
          const o = G.entities.byCollider.get(c2.handle);
          if (o === e) return;
          if (o && next.has(o)) {
            const a = find(e), b = find(o);
            if (a !== b) parent.set(a, b);
            return;
          }
          const pb = c2.parent();
          if (pb && pb.isDynamic() && !pb.isSleeping()) held.add(e);
        });
      }
    }
    const ok = new Map<Entity, boolean>();
    for (const [e, tr] of next) {
      const root = find(e);
      const fine = tr.still >= (tr.far ? 2 : STILL_PASSES) && !held.has(e);
      ok.set(root, (ok.get(root) ?? true) && fine);
    }
    const now = performance.now();
    for (const e of next.keys()) {
      if (!ok.get(find(e))) continue;
      e.body!.sleep();
      e.restSince = now;
      this.tracks.delete(e);
      this.stats.slept++;
    }
  }

  // ---------- drawing resting wood merged ----------

  /** wood that has lain asleep for a while joins the patch it lies in */
  private collect() {
    const now = performance.now();
    const P = G.player;
    const p = new THREE.Vector3();
    for (const e of G.entities.list) {
      if (e.kind !== 'item' || !e.restSince || !e.data.wood || !e.obj || !e.inWorld || e.removed) continue;
      if (now - e.restSince < SETTLED_MS || e === P.carried || this.pileOf.has(e)) continue;
      e.position(p);
      const m = e.mass;
      const cls = m < 5 ? 0 : m < 40 ? 1 : 2;
      const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)},${cls}`;
      let pile = this.piles.get(key);
      if (!pile) this.piles.set(key, (pile = { key, cls, members: new Set(), merged: new Set(), mesh: null, changed: now }));
      pile.members.add(e);
      pile.changed = now;
      this.pileOf.set(e, pile);
    }
  }

  /** at most one patch rebuilt per frame, once it has been quiet for a while */
  private redraw() {
    const now = performance.now();
    const cam = G.camera.position;
    const inCave = !!G.caves?.inside;
    let built = false;
    for (const pile of this.piles.values()) {
      // a couple of pieces are drawn on their own; a mesh is redrawn once something left it
      const worth = pile.members.size >= MIN_MERGED;
      const pending = worth ? pile.members.size !== pile.merged.size || (pile.mesh?.holes ?? 0) > 0 : !!pile.mesh || !pile.members.size;
      if (!built && pending && now - pile.changed > QUIET_MS) {
        built = true;
        this.rebuild(pile);
      }
      const m = pile.mesh;
      if (m) m.group.visible = !inCave && m.sphere.center.distanceTo(cam) - m.sphere.radius < DRAW_FAR[pile.cls];
    }
  }

  private rebuild(pile: Pile) {
    pile.mesh?.dispose();
    pile.mesh = null;
    if (pile.members.size < MIN_MERGED) {
      for (const e of pile.merged) if (e.obj && !e.obj.parent && e.inWorld) G.scene.add(e.obj);
      pile.merged.clear();
      if (!pile.members.size) this.piles.delete(pile.key);
      return;
    }
    const list = [...pile.members].filter((e) => e.obj);
    pile.mesh = new MergedMeshes(list.map((e) => ({ id: e.id, obj: e.obj! })));
    G.scene.add(pile.mesh.group);
    pile.merged = new Set(list);
    for (const e of list) e.obj!.removeFromParent();
    this.stats.rebuilt++;
  }

  /** for tests: how the resting wood is drawn */
  info() {
    let merged = 0, meshes = 0;
    for (const p of this.piles.values()) {
      merged += p.merged.size;
      meshes += p.mesh?.group.children.length ?? 0;
    }
    return { piles: this.piles.size, members: this.pileOf.size, merged, meshes, tracked: this.tracks.size, ...this.stats };
  }
}
