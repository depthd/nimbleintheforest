// Human remains belong to a place, not a respawning population. Possessions belong
// to the worn garments' pockets; loose equipment is made of ordinary world items.
import * as THREE from 'three';
import { G, GROUPS_STATIC, msg } from './ctx';
import { Entity } from './entities';
import type { Slot } from './items';
import { Rng, hashString } from '../core/rng';
import { buildCorpseMesh, updateCorpseClothing } from './corpse-mesh';

export interface CorpseSite {
  key: string;
  kind: string;
  x: number;
  z: number;
  yaw: number;
  radius: number;
}

export interface CorpseData {
  site: CorpseSite;
  worn: Map<Slot, Entity>;
  scattered: Entity[];
  searched: boolean;
}

export class Corpses {
  readonly list: Entity[] = [];
  readonly group = new THREE.Group();
  private built = false;

  build() {
    if (this.built) return;
    this.built = true;
    this.group.name = 'human-corpses';
    G.scene.add(this.group);
    const sites: CorpseSite[] = [{ key: 'house', kind: 'house', x: 0, z: 0, yaw: 0, radius: 9 }];
    for (const [i, p] of G.region.places.entries()) {
      if (!['hut', 'station', 'fishing', 'leanto', 'grotto'].includes(p.kind)) continue;
      sites.push({ key: `${p.kind}:${i}`, kind: p.kind, x: p.x, z: p.z, yaw: p.yaw,
        radius: p.kind === 'station' ? 12 : p.kind === 'leanto' ? 5 : 8 });
    }
    const tower = G.region.sites.tower;
    if (tower) sites.push({ key: 'tower', kind: 'tower', x: tower.x, z: tower.z, yaw: 0, radius: 7 });
    G.region.caves.forEach((c, i) => sites.push({ key: `cave:${i}`, kind: 'cave', x: c.x, z: c.z, yaw: c.yaw, radius: 5 }));
    for (const site of sites) {
      const rng = new Rng(hashString(`${G.settings.seed}:corpse:${site.key}`));
      const pose = this.findSpot(site, rng);
      if (pose) this.spawn(site, pose.pos, pose.yaw, rng);
    }
    this.update();
  }

  private surface(x: number, z: number) {
    const base = G.terrain.heightAt(x, z);
    return base + (G.snow?.contains(x, z) ? G.snow.field.sample(x, z).height : 0);
  }

  private findSpot(site: CorpseSite, rng: Rng) {
    const R = G.region;
    for (let i = 0; i < 64; i++) {
      let x: number, z: number;
      if (site.kind === 'cave') {
        // To the side of the approach, outside the throat and its transition zone.
        const lx = (i % 2 ? -1 : 1) * rng.float(2.8, 4.2), lz = rng.float(-6.5, -3.5);
        x = site.x + lx * Math.cos(site.yaw) + lz * Math.sin(site.yaw);
        z = site.z - lx * Math.sin(site.yaw) + lz * Math.cos(site.yaw);
      } else {
        const a = rng.float(0, Math.PI * 2), d = site.radius + rng.float(0, 4);
        x = site.x + Math.cos(a) * d; z = site.z + Math.sin(a) * d;
      }
      if (!R.inside(x, z, 4) || !Number.isNaN(R.waterAt(x, z)) || R.slopeAt(x, z) > 0.18) continue;
      if (R.skin?.covers(x, z)) continue;
      if (this.list.some(e => Math.hypot(e.position().x - x, e.position().z - z) < 36)) continue;
      const yaw = rng.float(0, Math.PI * 2), c = Math.cos(yaw), s = Math.sin(yaw);
      const samples: number[] = [];
      let blocked = false;
      for (const lx of [-0.55, 0, 0.55]) for (const lz of [-1.05, 0, 1.05]) {
        const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
        if (!Number.isNaN(R.waterAt(px, pz)) || G.house.zoneAt(new THREE.Vector3(px, this.surface(px, pz) + 0.3, pz))) blocked = true;
        samples.push(this.surface(px, pz));
      }
      if (blocked || Math.max(...samples) - Math.min(...samples) > 0.16) continue;
      // Streamed trees/rocks must also stay clear when the player arrives later.
      for (const props of [R.trees, R.rocks]) R.forEachProp(props, x, z, 5, j => {
        if (props.flags[j] & 3) return;
        const margin = props === R.trees ? 1.7 : 1.5 + props.s[j];
        if (Math.hypot(props.x[j] - x, props.z[j] - z) < margin) blocked = true;
      });
      const pos = new THREE.Vector3(x, Math.max(...samples) + 0.005, z);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      // Reject walls, steps, furniture and cave rock; terrain itself is the support.
      G.world.intersectionsWithShape(pos.clone().add(new THREE.Vector3(0, 0.22, 0)), q,
        new G.R.Cuboid(0.55, 0.20, 1.05), col => {
          if (!G.terrain.handles.has(col.handle)) blocked = true;
          return !blocked;
        });
      if (!blocked) return { pos, yaw };
    }
    return null;
  }

  private spawn(site: CorpseSite, pos: THREE.Vector3, yaw: number, rng: Rng) {
    const e = new Entity('corpse');
    e.name = 'Замёрзший человек';
    const worn = new Map<Slot, Entity>();
    const item = (id: string) => G.entities.createItem(id, { params: { v: rng.int(0, 3) },
      moisture: rng.float(0.08, 0.32), charges: id === 'matches' ? rng.int(3, 9) : id === 'flashlight' ? rng.int(18, 65) : undefined });
    const clothes = [rng.pick(['beanie', 'ushanka']), 'scarf', 'thermals', rng.pick(['sweater', 'fleece']),
      rng.pick(['jacket_light', 'parka', 'telogreika']), rng.pick(['jeans', 'wool_pants', 'padded_pants']),
      'wool_socks', rng.pick(['boots', 'valenki']), rng.pick(['gloves', 'mittens'])];
    for (const id of clothes) {
      const it = item(id);
      worn.set(it.def!.wear!.slot, it);
    }
    const coat = worn.get('outer')!, pants = worn.get('legs')!;
    coat.pockets.push(item(rng.pick(['chocolate', 'crackers'])), item('matches'));
    pants.pockets.push(item(rng.pick(['stew', 'beans'])), item('knife'));
    // Four pieces of equipment in total: two in pockets, two on the ground.
    const scattered: Entity[] = [];
    const data: CorpseData = { site, worn, scattered, searched: false };
    e.data.corpse = data;
    const root = buildCorpseMesh(worn, rng.int(0, 3));
    root.position.copy(pos); root.rotation.y = yaw; root.userData.entity = e;
    e.obj = root;
    this.group.add(root);
    const q = root.quaternion;
    const col = G.world.createCollider(G.R.ColliderDesc.cuboid(0.43, 0.17, 0.98)
      .setTranslation(pos.x, pos.y + 0.18, pos.z).setRotation(q).setCollisionGroups(GROUPS_STATIC).setFriction(0.9));
    G.entities.registerStatic(e, [col]);
    this.list.push(e);
    const gear = [item('flashlight'), item(rng.pick(['hatchet', 'pot', 'rod']))];
    gear.forEach((it, i) => {
      // Keep the gear beside the body, away from the doorway and the corpse collider.
      const p = new THREE.Vector3(i ? -1.05 : 1.05, 0, i ? 0.55 : -0.35)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(pos);
      const d = it.def!;
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2));
      const halfHeight = d.shape.t === 'box' ? d.shape.x : d.shape.r;
      p.y = this.surface(p.x, p.z) + halfHeight + 0.015;
      // Sleep until touched: distant terrain is streamed in only on approach.
      G.entities.placeInWorld(it, p, quat, undefined, undefined, true);
      scattered.push(it);
    });
  }

  take(corpse: Entity, item: Entity): boolean {
    if (corpse.removed || corpse.kind !== 'corpse' || G.caves?.inside || corpse.position().distanceTo(G.player.pos) > 4) return false;
    const data = corpse.data.corpse as CorpseData;
    const slot = [...data.worn].find(([, e]) => e === item)?.[0];
    const owner = [...data.worn.values()].find(e => e.pockets.includes(item));
    if ((!slot && !owner) || item.removed || !G.player.addToInventory(item)) return false;
    if (slot) data.worn.delete(slot);
    else owner!.pockets.splice(owner!.pockets.indexOf(item), 1);
    updateCorpseClothing(corpse.obj as THREE.Group, data.worn);
    msg(`Взято: ${item.displayName()}`, 'good');
    return true;
  }

  describe(e: Entity) {
    const d = e.data.corpse as CorpseData;
    return `${e.name}${d.searched ? d.worn.size ? ' · обыскан' : ' · вещей не осталось' : ' · можно обыскать'}`;
  }

  update() {
    for (const e of this.list) if (e.obj) e.obj.visible = e.position().distanceToSquared(G.player.pos) < 220 * 220;
  }
}
