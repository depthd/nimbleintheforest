// Entities: physical items and interactive world objects (windows, doors, railings...).
import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { G, GROUPS_ITEM, GROUPS_STATIC } from './ctx';
import { def, ItemDef, Shape } from './items';
import { buildItemMesh } from './meshes';

export type Kind = 'item' | 'window' | 'door' | 'railing' | 'stove' | 'fire' | 'icehole' | 'trunk' | 'doorway' | 'radio' | 'container';

export interface PotContents {
  snow: number; // litres of water-equivalent snow
  water: number; // litres of liquid water
  temp: number; // °C
  boiled: boolean; // water has been boiled (safe)
  tea: boolean;
  dirty: boolean; // lake water not boiled yet
}

let nextId = 1;

export class Entity {
  id = nextId++;
  kind: Kind;
  defId = '';
  name = '';
  obj: THREE.Object3D | null = null;
  body: RAPIER_T.RigidBody | null = null;
  colliders: RAPIER_T.Collider[] = [];
  hp = 0;
  maxHp = 0;
  moisture = 0;
  charges = 0;
  params: Record<string, number> = {};
  contents: PotContents | null = null;
  cook = 0; // cooking progress, game seconds
  lit = false;
  burning = 0; // lamp/flashlight remaining, uses charges
  data: any = {};
  inWorld = false;
  removed = false;
  /** item is resting on a fixed spot (stove top, bed...) without physics */
  pinned: string | null = null;

  constructor(kind: Kind) {
    this.kind = kind;
  }

  get def(): ItemDef | null {
    return this.defId ? def(this.defId) : null;
  }

  get mass(): number {
    const d = this.def;
    if (!d) return this.data.mass ?? 100;
    let m = d.mass;
    if (this.contents) m += this.contents.snow + this.contents.water;
    return m;
  }

  position(out = new THREE.Vector3()): THREE.Vector3 {
    if (this.body) {
      const t = this.body.translation();
      return out.set(t.x, t.y, t.z);
    }
    if (this.obj) return this.obj.getWorldPosition(out);
    return out.set(0, -1000, 0);
  }

  displayName(): string {
    let n = this.name;
    const d = this.def;
    if ((d?.fuel || d?.wear || d?.insul) && this.moisture > 0.3) n += d?.fuel && !d?.wear && !d?.insul ? ' (сырое)' : ' (мокрое)';
    if (this.defId === 'matches') n += ` (${this.charges})`;
    if (this.defId === 'lighter') n += ` (${this.charges})`;
    if (this.defId === 'nails') n += ` (${this.charges})`;
    if (this.defId === 'flashlight' || this.defId === 'lamp' || this.defId === 'kerosene') n += ` (${Math.round(this.charges)}%)`;
    if (this.contents) {
      const c = this.contents;
      if (c.snow > 0.01) n += ` · снег ${c.snow.toFixed(1)} л`;
      if (c.water > 0.01) n += ` · ${c.tea ? 'чай' : 'вода'} ${c.water.toFixed(1)} л, ${Math.round(c.temp)}°C${c.boiled ? '' : c.dirty ? ', не кипячёная' : ''}`;
    }
    return n;
  }
}

function colliderFor(shape: Shape): RAPIER_T.ColliderDesc {
  const R = G.R;
  switch (shape.t) {
    case 'box':
      return R.ColliderDesc.cuboid(shape.x, shape.y, shape.z);
    case 'cyl':
      return R.ColliderDesc.cylinder(shape.h, shape.r);
    case 'cylx': {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
      return R.ColliderDesc.cylinder(shape.h, shape.r).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
    case 'ball':
      return R.ColliderDesc.ball(shape.r);
  }
}

export interface SpawnOpts {
  quat?: THREE.Quaternion;
  params?: Record<string, number>;
  moisture?: number;
  charges?: number;
  vel?: THREE.Vector3;
  angvel?: THREE.Vector3;
  sleep?: boolean;
}

export class Entities {
  list: Entity[] = [];
  byCollider = new Map<number, Entity>();

  spawnItem(id: string, pos: THREE.Vector3, opts: SpawnOpts = {}): Entity {
    const d = def(id);
    const e = new Entity('item');
    e.defId = id;
    e.name = d.name;
    e.params = { ...(opts.params ?? {}) };
    if (e.params.v === undefined) e.params.v = Math.floor(Math.random() * 4);
    e.moisture = opts.moisture ?? d.fuel?.moisture ?? 0.05;
    e.charges = opts.charges ?? d.charges ?? 0;
    if (d.capacity) e.contents = { snow: 0, water: 0, temp: 0, boiled: false, tea: false, dirty: false };
    if (d.chop) {
      e.hp = d.chop.hp;
      e.maxHp = d.chop.hp;
    }
    this.list.push(e);
    this.placeInWorld(e, pos, opts.quat, opts.vel, opts.angvel, opts.sleep);
    return e;
  }

  /** Create mesh+body for an item at a position. */
  placeInWorld(e: Entity, pos: THREE.Vector3, quat?: THREE.Quaternion, vel?: THREE.Vector3, angvel?: THREE.Vector3, sleep = false) {
    const d = e.def!;
    if (!e.obj) e.obj = buildItemMesh(e.defId, e.params);
    e.obj.userData.entity = e;
    G.scene.add(e.obj);
    const R = G.R;
    const bd = R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(0.15)
      .setAngularDamping(0.6)
      .setCcdEnabled(d.mass < 4);
    if (quat) bd.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    if (sleep) bd.setSleeping(true);
    const body = G.world.createRigidBody(bd);
    const cd = colliderFor(d.shape).setMass(Math.max(0.05, e.mass)).setFriction(0.8).setRestitution(0.05).setCollisionGroups(GROUPS_ITEM);
    const col = G.world.createCollider(cd, body);
    if (vel) body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    if (angvel) body.setAngvel({ x: angvel.x, y: angvel.y, z: angvel.z }, true);
    e.body = body;
    e.colliders = [col];
    this.byCollider.set(col.handle, e);
    e.inWorld = true;
    e.pinned = null;
    this.syncOne(e);
  }

  /** Remove physics body and mesh from the scene (e.g. item goes to inventory). */
  removeFromWorld(e: Entity) {
    for (const c of e.colliders) this.byCollider.delete(c.handle);
    if (e.body) G.world.removeRigidBody(e.body);
    else for (const c of e.colliders) G.world.removeCollider(c, false);
    e.body = null;
    e.colliders = [];
    if (e.obj) e.obj.removeFromParent();
    e.inWorld = false;
    e.pinned = null;
  }

  destroy(e: Entity) {
    if (e.inWorld || e.colliders.length) this.removeFromWorld(e);
    if (e.obj) e.obj.removeFromParent();
    e.removed = true;
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
    G.player?.forget(e);
  }

  /** Pin an item to a fixed spot without physics (stove top, bed, window). */
  pin(e: Entity, where: string, pos: THREE.Vector3, quat?: THREE.Quaternion, parent?: THREE.Object3D) {
    if (e.inWorld) this.removeFromWorld(e);
    if (!e.obj) e.obj = buildItemMesh(e.defId, e.params);
    e.obj.userData.entity = e;
    (parent ?? G.scene).add(e.obj);
    e.obj.position.copy(pos);
    if (quat) e.obj.quaternion.copy(quat);
    // a fixed sensor-less collider so the item can still be targeted
    const R = G.R;
    const wp = new THREE.Vector3();
    e.obj.updateWorldMatrix(true, false);
    e.obj.getWorldPosition(wp);
    const wq = new THREE.Quaternion();
    e.obj.getWorldQuaternion(wq);
    const cd = colliderFor(e.def!.shape).setTranslation(wp.x, wp.y, wp.z).setRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w }).setCollisionGroups(GROUPS_STATIC);
    const col = G.world.createCollider(cd);
    e.colliders = [col];
    this.byCollider.set(col.handle, e);
    e.pinned = where;
  }

  registerStatic(e: Entity, colliders: RAPIER_T.Collider[]) {
    e.colliders = colliders;
    for (const c of colliders) this.byCollider.set(c.handle, e);
    e.inWorld = true;
    if (!this.list.includes(e)) this.list.push(e);
  }

  syncOne(e: Entity) {
    if (!e.body || !e.obj) return;
    const t = e.body.translation();
    const r = e.body.rotation();
    e.obj.position.set(t.x, t.y, t.z);
    e.obj.quaternion.set(r.x, r.y, r.z, r.w);
  }

  sync() {
    for (const e of this.list) {
      if (!e.body || !e.obj) continue;
      if (e.body.isSleeping()) continue;
      this.syncOne(e);
      const t = e.body.translation();
      // rescue items that fell through the world
      if (e.kind === 'item') {
        const gh = G.terrain.heightAt(t.x, t.z);
        if (t.y < gh - 3 || t.y < -60) {
          e.body.setTranslation({ x: t.x, y: gh + 1, z: t.z }, true);
          e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    }
  }

  ofDef(id: string) {
    return this.list.filter((e) => e.defId === id && !e.removed);
  }

  near(pos: THREE.Vector3, r: number, pred?: (e: Entity) => boolean): Entity[] {
    const out: Entity[] = [];
    const p = new THREE.Vector3();
    for (const e of this.list) {
      if (!e.inWorld || e.removed) continue;
      if (pred && !pred(e)) continue;
      if (e.position(p).distanceTo(pos) <= r) out.push(e);
    }
    return out;
  }
}
