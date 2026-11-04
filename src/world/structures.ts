// Man-made places and traces of people, built from the places the generator chose:
// hunters' huts with loot, the fire lookout tower, a grotto under a cliff, the weather
// station with the radio (the goal), abandoned cars, a footbridge, logging sites, a cross.
import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { G, GROUPS_STATIC, msg } from '../game/ctx';
import { Rng } from '../core/rng';
import { Tex, worldUVBox } from '../core/textures';
import { M, mat } from '../game/meshes';
import { Entity } from '../game/entities';
import { NOTE_KEYS, BOOKS, NEWSPAPERS } from '../game/lore';
import type { Place } from '../gen/region';

export interface Shelter {
  kind: 'hut' | 'grotto' | 'tower' | 'station';
  name: string;
  /** how much of the wind gets in, 0..1 */
  wind: number;
  /** degrees warmer than outside without a fire */
  warm: number;
  /** a fire inside this space warms the air */
  enclosed: boolean;
  pos: THREE.Vector3;
}

interface Box {
  cx: number;
  cz: number;
  yaw: number;
  hx: number;
  hz: number;
  y0: number;
  y1: number;
  shelter: Shelter;
}

const UP = new THREE.Vector3(0, 1, 0);

class Builder {
  group = new THREE.Group();
  body: RAPIER_T.RigidBody;
  q: THREE.Quaternion;
  constructor(public x: number, public y: number, public z: number, public yaw: number) {
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    this.body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }));
    G.scene.add(this.group);
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, o: { rx?: number; ry?: number; rz?: number; collide?: boolean; tex?: number } = {}) {
    const me = new THREE.Mesh(worldUVBox(w, h, d, o.tex ?? 1.5), m);
    me.position.set(x, y, z);
    me.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    me.castShadow = me.receiveShadow = true;
    this.group.add(me);
    if (o.collide !== false) {
      const qq = new THREE.Quaternion().setFromEuler(me.rotation);
      return G.world.createCollider(
        G.R.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z).setRotation({ x: qq.x, y: qq.y, z: qq.z, w: qq.w }).setCollisionGroups(GROUPS_STATIC).setFriction(0.9),
        this.body,
      );
    }
    return null;
  }

  /** a ramp you can walk on from a to b (local coords), drawn as steps */
  stairs(a: THREE.Vector3, b: THREE.Vector3, width: number, m: THREE.Material) {
    const d = b.clone().sub(a);
    const horiz = Math.hypot(d.x, d.z);
    const yaw = Math.atan2(d.x, d.z);
    const pitch = Math.atan2(d.y, horiz);
    const len = d.length();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
    G.world.createCollider(
      G.R.ColliderDesc.cuboid(width / 2, 0.04, len / 2).setTranslation(mid.x, mid.y - 0.04, mid.z).setRotation({ x: qq.x, y: qq.y, z: qq.z, w: qq.w }).setCollisionGroups(GROUPS_STATIC),
      this.body,
    );
    const n = Math.max(2, Math.round(d.y / 0.22));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const p = a.clone().lerp(b, t);
      this.box(width, 0.05, horiz / n + 0.04, p.x, p.y - 0.03, p.z, m, { ry: yaw, collide: false });
    }
    // stringers
    for (const s of [-1, 1]) {
      const off = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar((s * width) / 2);
      const me = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, len), m);
      me.position.copy(mid).add(off).add(new THREE.Vector3(0, -0.08, 0));
      me.quaternion.copy(qq);
      me.castShadow = true;
      this.group.add(me);
    }
  }

  world(lx: number, ly: number, lz: number) {
    return new THREE.Vector3(lx, ly, lz).applyQuaternion(this.q).add(new THREE.Vector3(this.x, this.y, this.z));
  }
}

export class Structures {
  shelters: Box[] = [];
  places: Place[] = [];
  /** places the player has seen (for the map) */
  seen = new Set<Place | string>();
  beacon: THREE.Mesh | null = null;
  station: Place | null = null;
  private rng!: Rng;

  build(rng: Rng) {
    this.rng = rng;
    const R = G.region;
    this.places = R.places;
    // the letter on the house table
    this.note('intro', new THREE.Vector3(1.0, G.house.Y0 + 0.78, -1.0));
    if (R.sites.tower) this.tower(R.sites.tower.x, R.sites.tower.y, R.sites.tower.z);
    let hutNo = 0;
    for (const p of R.places) {
      switch (p.kind) {
        case 'hut':
          this.hut(p, hutNo++);
          break;
        case 'station':
          this.stationBuild(p);
          break;
        case 'grotto':
          this.grotto(p);
          break;
        case 'car':
          this.car(p);
          break;
        case 'bridge':
          this.bridge(p);
          break;
        case 'logging':
          this.logging(p);
          break;
        case 'cross':
          this.cross(p);
          break;
      }
    }
  }

  // ---------- queries ----------

  shelterAt(p: THREE.Vector3): Shelter | null {
    for (const b of this.shelters) {
      const dx = p.x - b.cx, dz = p.z - b.cz;
      const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw);
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      if (Math.abs(lx) < b.hx && Math.abs(lz) < b.hz && p.y > b.y0 - 0.3 && p.y < b.y1) return b.shelter;
    }
    return null;
  }

  update(dtReal: number) {
    // the station beacon blinks
    if (this.beacon) {
      const on = Math.floor(performance.now() / 900) % 2 === 0;
      (this.beacon.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xff2a1a : 0x330806);
    }
    const P = G.player.pos;
    for (const p of this.places) if (!this.seen.has(p) && Math.hypot(p.x - P.x, p.z - P.z) < 120) this.seen.add(p);
    void dtReal;
  }

  // ---------- loot ----------

  private spawn(id: string, pos: THREE.Vector3, opts: Record<string, any> = {}) {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, this.rng.float(0, 6.28));
    return G.entities.spawnItem(id, pos, { quat: q, ...opts });
  }

  note(key: string, pos: THREE.Vector3) {
    return this.spawn('note', pos, { params: { t: NOTE_KEYS.indexOf(key) } });
  }

  private lootList(remote: number, extra: string[] = []) {
    const r = this.rng;
    const out: string[] = [...extra];
    const n = Math.round(3 + remote * 5 + r.float(0, 2));
    const common = ['stew', 'beans', 'crackers', 'chocolate', 'tea', 'tea', 'kindling', 'firewood', 'newspaper', 'paper', 'matches', 'stew'];
    const clothes = ['telogreika', 'wool_pants', 'balaclava', 'fur_mitts', 'unty', 'fleece', 'wool_socks', 'beanie', 'scarf', 'tulup', 'padded_pants', 'gloves', 'mittens', 'thermals', 'valenki'];
    const tools = ['knife', 'hatchet', 'saw', 'auger', 'rod', 'flashlight', 'lamp', 'kerosene', 'pot', 'prybar', 'lighter', 'blanket'];
    for (let i = 0; i < n; i++) {
      const roll = r.next();
      if (roll < 0.5) out.push(r.pick(common));
      else if (roll < 0.78) out.push(r.pick(clothes));
      else out.push(r.pick(tools));
    }
    if (r.chance(0.35 + remote * 0.3)) out.push('book');
    return out;
  }

  private placeLoot(b: Builder, ids: string[], spots: [number, number, number][]) {
    ids.forEach((id, i) => {
      const s = spots[i % spots.length];
      const jitter = Math.floor(i / spots.length) * 0.12;
      const p = b.world(s[0] + this.rng.float(-0.12, 0.12), s[1] + 0.08 + jitter, s[2] + this.rng.float(-0.12, 0.12));
      const opts: Record<string, any> = { moisture: 0.08 };
      if (id === 'matches') opts.charges = this.rng.int(4, 14);
      if (id === 'lighter') opts.charges = this.rng.int(2, 12);
      if (id === 'flashlight') opts.charges = this.rng.int(10, 60);
      if (id === 'lamp' || id === 'kerosene') opts.charges = this.rng.int(15, 70);
      if (id === 'book') opts.params = { t: this.rng.int(0, BOOKS.length - 1) };
      if (id === 'newspaper') opts.params = { t: this.rng.int(0, NEWSPAPERS.length - 1) };
      if (id === 'blanket') opts.params = { v: this.rng.int(0, 3) };
      this.spawn(id, p, opts);
    });
  }

  // ---------- builders ----------

  private hut(p: Place, no: number) {
    const r = this.rng;
    const b = new Builder(p.x, p.y, p.z, p.yaw);
    const wall = mat('logwall', () => new THREE.MeshStandardMaterial({ map: Tex.logWall(), roughness: 0.9 }));
    const roof = mat('roof', () => new THREE.MeshStandardMaterial({ map: Tex.planks(), color: 0x5a4a40, roughness: 0.9 }));
    const W = 4.4, D = 3.6, H = 2.2, T = 0.2;
    b.box(W, 0.3, D, 0, -0.13, 0, M.wood());
    b.box(W, H, T, 0, H / 2, -D / 2 + T / 2, wall, { tex: 1.6 });
    b.box(T, H, D, -W / 2 + T / 2, H / 2, 0, wall, { tex: 1.6 });
    b.box(T, H, D, W / 2 - T / 2, H / 2, 0, wall, { tex: 1.6 });
    // front wall with a doorway
    const dw = 0.95;
    const side = (W - dw) / 2;
    b.box(side, H, T, -W / 2 + side / 2, H / 2, D / 2 - T / 2, wall, { tex: 1.6 });
    b.box(side, H, T, W / 2 - side / 2, H / 2, D / 2 - T / 2, wall, { tex: 1.6 });
    b.box(dw, H - 1.85, T, 0, 1.85 + (H - 1.85) / 2, D / 2 - T / 2, wall, { tex: 1.6 });
    // a small window (glass gone, boarded up)
    b.box(0.6, 0.45, 0.04, W / 2 + 0.01, 1.35, 0.4, M.woodDark(), { collide: false });
    // gable roof
    const ang = 0.55;
    const run = D / 2 + 0.4;
    const len = run / Math.cos(ang);
    for (const s of [-1, 1]) {
      b.box(W + 0.6, 0.12, len, 0, H + Math.tan(ang) * run * 0.5 - 0.05, (s * run) / 2, roof, { rx: s * ang });
      b.box(W + 0.5, 0.1, len - 0.05, 0, H + Math.tan(ang) * run * 0.5 + 0.07, (s * run) / 2, M.snow(), { rx: s * ang, collide: false });
    }
    // gable triangles
    for (const sx of [-1, 1]) {
      const sh = new THREE.Shape();
      sh.moveTo(-D / 2, 0);
      sh.lineTo(D / 2, 0);
      sh.lineTo(0, Math.tan(ang) * D * 0.5);
      const g = new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: false });
      g.rotateY(Math.PI / 2);
      const m = new THREE.Mesh(g, wall);
      m.position.set(sx * (W / 2) - T / 2, H, 0);
      m.castShadow = true;
      b.group.add(m);
    }
    // bunk and shelf
    b.box(1.9, 0.45, 0.85, -0.95, 0.22, -D / 2 + 0.6, M.woodDark());
    b.box(1.6, 0.05, 0.3, 1.1, 1.3, -D / 2 + 0.35, M.wood());
    // hearth inside, by the door
    const hearth = b.world(1.35, 0, 0.9);
    hearth.y = p.y + 0.02;
    G.fires.makeCampfire(hearth);
    // woodpile and stumps outside
    for (let i = 0; i < r.int(2, 4); i++) this.spawn('log', b.world(-W / 2 - 0.7, 0.25 + i * 0.3, -0.8 + (i % 2) * 0.35), { moisture: 0.15 });
    for (let i = 0; i < r.int(1, 3); i++) this.spawn('firewood', b.world(-W / 2 - 0.6, 0.2, 0.6 + i * 0.15), { moisture: 0.12 });
    this.stump(b.world(1.8, 0, D / 2 + 1.6), 0.25);
    this.stump(b.world(2.6, 0, D / 2 + 2.2), 0.2);
    const ids = this.lootList(p.remote, no === 0 ? ['backpack'] : p.remote > 0.7 && r.chance(0.6) ? ['backpack_big'] : []);
    this.placeLoot(b, ids, [[-0.95, 0.5, -D / 2 + 0.6], [1.1, 1.36, -D / 2 + 0.35], [0.6, 0.05, -0.6], [-1.4, 0.05, 0.8], [1.6, 0.05, -0.3]]);
    // notes: the driver's note sits in the hut by the car with the battery
    const car = this.places.find((c) => c.kind === 'car' && c.data.battery && Math.hypot(c.x - p.x, c.z - p.z) < 14);
    const key = car ? 'battery' : r.pick(['hunter', 'wife', 'kid', 'hunter']);
    this.note(key, b.world(-0.7, 0.5, -D / 2 + 0.55));
    if (p.data.battery) this.spawn('battery', b.world(0.2, 0.1, -1.0), { charges: 70 });
    this.shelters.push({ cx: p.x, cz: p.z, yaw: p.yaw, hx: W / 2 - 0.1, hz: D / 2 - 0.1, y0: p.y, y1: p.y + H + 0.8, shelter: { kind: 'hut', name: 'Заимка', wind: 0.05, warm: 4, enclosed: true, pos: new THREE.Vector3(p.x, p.y, p.z) } });
  }

  private stump(p: THREE.Vector3, r: number) {
    const h = 0.35 + Math.random() * 0.15;
    const y = G.terrain.heightAt(p.x, p.z);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 1.1, h, 9), [M.barkSpruce(), M.woodEnd(), M.woodEnd()]);
    m.position.set(p.x, y + h / 2 - 0.05, p.z);
    m.castShadow = m.receiveShadow = true;
    G.scene.add(m);
    G.world.createCollider(G.R.ColliderDesc.cylinder(h / 2, r).setTranslation(p.x, y + h / 2 - 0.05, p.z).setCollisionGroups(GROUPS_STATIC));
  }

  private tower(x: number, y: number, z: number) {
    const b = new Builder(x, y, z, 0);
    const wood = M.woodDark();
    const TOP = 10;
    // legs and braces
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.2, TOP + 0.2, 0.2, sx * 1.8, TOP / 2, sz * 1.8, wood);
    for (let k = 0; k < 4; k++) {
      const yy = 1.5 + k * 2.3;
      for (const s of [-1, 1]) {
        b.box(3.6, 0.1, 0.1, 0, yy, s * 1.8, wood, { rz: k % 2 ? 0.45 : -0.45, collide: false });
        b.box(0.1, 0.1, 3.6, s * 1.8, yy, 0, wood, { rx: k % 2 ? 0.45 : -0.45, collide: false });
      }
    }
    // stairs around the outside: four flights, one per side
    const c = 2.5;
    const corners = [new THREE.Vector3(-c, 0, c), new THREE.Vector3(c, 0, c), new THREE.Vector3(c, 0, -c), new THREE.Vector3(-c, 0, -c), new THREE.Vector3(-c, 0, c)];
    for (let i = 0; i < 4; i++) {
      const a = corners[i].clone().setY(i * 2.5), bb = corners[i + 1].clone().setY((i + 1) * 2.5);
      b.stairs(a, bb, 0.85, M.wood());
      if (i < 3) b.box(0.9, 0.08, 0.9, corners[i + 1].x, (i + 1) * 2.5 - 0.04, corners[i + 1].z, M.wood());
    }
    // platform, half walls, roof
    b.box(4.2, 0.15, 4.2, 0, TOP - 0.07, 0, M.wood());
    b.box(4.2, 1.0, 0.08, 0, TOP + 0.5, -2.06, wood);
    b.box(0.08, 1.0, 4.2, 2.06, TOP + 0.5, 0, wood);
    b.box(4.2, 1.0, 0.08, 0, TOP + 0.5, 2.06, wood);
    b.box(0.08, 1.0, 2.6, -2.06, TOP + 0.5, -0.8, wood);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.1, 2.3, 0.1, sx * 2.0, TOP + 1.15, sz * 2.0, wood, { collide: false });
    b.box(4.8, 0.12, 4.8, 0, TOP + 2.35, 0, mat('roof', () => new THREE.MeshStandardMaterial({ map: Tex.planks(), color: 0x5a4a40 })));
    b.box(4.7, 0.1, 4.7, 0, TOP + 2.46, 0, M.snow(), { collide: false });
    this.note('tower', b.world(1.2, TOP + 0.1, -1.2));
    this.spawn('matches', b.world(1.4, TOP + 0.1, -0.9), { charges: 6 });
    this.shelters.push({ cx: x, cz: z, yaw: 0, hx: 2, hz: 2, y0: y + TOP, y1: y + TOP + 2.3, shelter: { kind: 'tower', name: 'Пожарная вышка', wind: 0.45, warm: 0, enclosed: false, pos: new THREE.Vector3(x, y + TOP, z) } });
  }

  private stationBuild(p: Place) {
    this.station = p;
    const b = new Builder(p.x, p.y, p.z, p.yaw);
    const wall = mat('stationwall', () => new THREE.MeshStandardMaterial({ map: Tex.planks(), color: 0x9aa4ac, roughness: 0.85 }));
    const W = 6, D = 4.4, H = 2.6, T = 0.2;
    b.box(W, 0.3, D, 0, -0.13, 0, M.wood());
    b.box(W, H, T, 0, H / 2, -D / 2 + T / 2, wall);
    b.box(T, H, D, -W / 2 + T / 2, H / 2, 0, wall);
    b.box(T, H, D, W / 2 - T / 2, H / 2, 0, wall);
    const dw = 1.0, side = (W - dw) / 2;
    b.box(side, H, T, -W / 2 + side / 2, H / 2, D / 2 - T / 2, wall);
    b.box(side, H, T, W / 2 - side / 2, H / 2, D / 2 - T / 2, wall);
    b.box(dw, H - 2, T, 0, 2 + (H - 2) / 2, D / 2 - T / 2, wall);
    b.box(W + 0.4, 0.15, D + 0.4, 0, H + 0.07, 0, M.iron());
    b.box(W + 0.3, 0.12, D + 0.3, 0, H + 0.2, 0, M.snow(), { collide: false });
    // radio desk
    const desk = b.box(1.6, 0.8, 0.7, 1.8, 0.4, -D / 2 + 0.55, M.woodDark());
    const radioMesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.32), M.iron());
    radioMesh.position.set(1.7, 0.94, -D / 2 + 0.5);
    b.group.add(radioMesh);
    const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), new THREE.MeshBasicMaterial({ color: 0x223322 }));
    dial.position.set(1.6, 0.98, -D / 2 + 0.665);
    b.group.add(dial);
    const radio = new Entity('radio');
    radio.name = 'Коротковолновая рация';
    radio.obj = radioMesh;
    radio.data = { powered: false, dial, sent: 0 };
    radioMesh.userData.entity = radio;
    if (desk) G.entities.registerStatic(radio, [desk]);
    b.box(1.9, 0.45, 0.85, -1.9, 0.22, -D / 2 + 0.6, M.woodDark());
    this.note('station', b.world(1.2, 0.85, -D / 2 + 0.5));
    this.placeLoot(b, this.lootList(0.6, ['stew', 'tea']), [[-1.9, 0.5, -D / 2 + 0.6], [-2.2, 0.05, 1.2], [0.2, 0.05, -1.4]]);
    G.fires.makeCampfire(b.world(-1.8, 0, 1.1).setY(p.y + 0.02));
    // radio mast with a red beacon, visible from far away
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.18, 32, 6), M.metal());
    mast.position.set(4.5, 16, 0);
    mast.castShadow = true;
    b.group.add(mast);
    for (let k = 0; k < 8; k++) {
      const yy = 2 + k * 3.8;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 4, 8), M.metal());
      ring.rotation.x = Math.PI / 2;
      ring.position.set(4.5, yy, 0);
      b.group.add(ring);
    }
    G.world.createCollider(G.R.ColliderDesc.cylinder(16, 0.2).setTranslation(4.5, 16, 0).setCollisionGroups(GROUPS_STATIC), b.body);
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a, fog: false }));
    this.beacon.position.set(4.5, 32.3, 0);
    b.group.add(this.beacon);
    // helipad marking
    const pad = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.6, 32), new THREE.MeshStandardMaterial({ color: 0xc0c4c8, roughness: 1 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(-1, 0.03, 9);
    b.group.add(pad);
    this.shelters.push({ cx: p.x, cz: p.z, yaw: p.yaw, hx: W / 2 - 0.1, hz: D / 2 - 0.1, y0: p.y, y1: p.y + H, shelter: { kind: 'station', name: 'Метеостанция «Кряж»', wind: 0.05, warm: 5, enclosed: true, pos: new THREE.Vector3(p.x, p.y, p.z) } });
  }

  private grotto(p: Place) {
    const b = new Builder(p.x, p.y, p.z, p.yaw);
    // a hollow dome of rock opening downhill (+z)
    const g = new THREE.SphereGeometry(4.2, 18, 10, Math.PI * 0.18, Math.PI * 1.64, 0, Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const f = 1 + 0.12 * Math.sin(x * 2.1 + z * 1.3) + 0.08 * Math.sin(y * 3.7 + x);
      pos.setXYZ(i, x * f * 1.25, y * f * 0.75, z * f);
    }
    g.rotateY(Math.PI / 2);
    g.computeVertexNormals();
    const rockMat = mat('grottoRock', () => new THREE.MeshStandardMaterial({ map: Tex.rock(), color: 0x9a9894, roughness: 1, side: THREE.DoubleSide }));
    const m = new THREE.Mesh(g, rockMat);
    m.castShadow = m.receiveShadow = true;
    b.group.add(m);
    // snow on top
    const cap = new THREE.Mesh(new THREE.SphereGeometry(4.3, 16, 6, 0, Math.PI * 2, 0, Math.PI / 3.2), M.snow());
    cap.scale.set(1.25, 0.6, 1.0);
    cap.position.y = 0.6;
    b.group.add(cap);
    const ni = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : undefined;
    const verts = new Float32Array(pos.array as ArrayLike<number>);
    if (ni) G.world.createCollider(G.R.ColliderDesc.trimesh(verts, ni).setCollisionGroups(GROUPS_STATIC), b.body);
    const fire = b.world(0, 0, 1.6);
    fire.y = G.terrain.heightAt(fire.x, fire.z);
    G.fires.makeCampfire(fire);
    this.note('grotto', b.world(-1.2, 0.1, -1.2).setY(G.terrain.heightAt(b.world(-1.2, 0, -1.2).x, b.world(-1.2, 0, -1.2).z) + 0.1));
    for (let i = 0; i < 4; i++) this.spawn('sticks', b.world(1.4 + i * 0.1, 0, -0.8).setY(p.y + 0.2 + i * 0.05), { moisture: 0.1 });
    this.shelters.push({ cx: p.x, cz: p.z, yaw: p.yaw, hx: 3.6, hz: 3.4, y0: p.y, y1: p.y + 3.2, shelter: { kind: 'grotto', name: 'Грот', wind: 0.15, warm: 2, enclosed: true, pos: new THREE.Vector3(p.x, p.y, p.z) } });
  }

  private car(p: Place) {
    const b = new Builder(p.x, p.y + 0.05, p.z, p.yaw);
    const paint = mat('uazPaint', () => new THREE.MeshStandardMaterial({ color: 0x5d6b4a, roughness: 0.6, metalness: 0.3 }));
    const glass = mat('uazGlass', () => new THREE.MeshStandardMaterial({ color: 0x1a222a, roughness: 0.1, metalness: 0.5 }));
    const body = b.box(1.95, 1.55, 4.3, 0, 1.25, 0, paint);
    b.box(1.97, 0.45, 0.7, 0, 1.65, 1.9, glass, { collide: false });
    b.box(1.97, 0.4, 2.6, 0, 1.68, -0.4, glass, { collide: false });
    b.box(1.9, 0.12, 4.2, 0, 2.08, 0, M.snow(), { collide: false });
    for (const sx of [-1, 1]) for (const sz of [-1.35, 1.35]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), M.black());
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * 0.9, 0.42, sz);
      b.group.add(w);
    }
    const e = new Entity('container');
    e.name = 'Брошенный УАЗ';
    e.obj = b.group;
    b.group.userData.entity = e;
    const loot = this.lootList(p.remote * 0.6).slice(0, 4);
    if (p.data.battery) loot.unshift('battery');
    e.data = { loot, searched: false, at: p };
    if (body) G.entities.registerStatic(e, [body]);
  }

  /** search a container: its loot drops next to the player */
  search(e: Entity) {
    if (e.data.searched) return;
    e.data.searched = true;
    const P = G.player;
    const ids: string[] = e.data.loot;
    if (!ids.length) {
      msg(`${e.name}: пусто, кто-то уже всё забрал`, 'info');
      return;
    }
    const base = P.pos.clone().add(P.forward().setY(0).normalize().multiplyScalar(0.7));
    ids.forEach((id, i) => {
      const p = base.clone().add(new THREE.Vector3((i % 3) * 0.25 - 0.25, 0.4 + Math.floor(i / 3) * 0.2, 0));
      const it = this.spawn(id, p, id === 'battery' ? { charges: 70 } : { moisture: 0.1 });
      if (it.def?.pocket && id !== 'battery') P.addToInventory(it);
    });
    msg(`Нашли: ${ids.map((id) => G.entities.list.find((x) => x.defId === id)?.name ?? id).join(', ')}`, 'good');
  }

  private bridge(p: Place) {
    const d = p.data;
    const ax = p.x + d.nx * d.half, az = p.z + d.nz * d.half;
    const bx = p.x - d.nx * d.half, bz = p.z - d.nz * d.half;
    const ay = G.terrain.heightAt(ax, az) + 0.25, by = G.terrain.heightAt(bx, bz) + 0.25;
    const mid = new THREE.Vector3((ax + bx) / 2, Math.max(ay, by, d.level + 1.6), (az + bz) / 2);
    const b = new Builder(mid.x, 0, mid.z, Math.atan2(d.nx, d.nz));
    const L = d.half;
    // two spans meeting in the middle, raised above the river
    b.stairs(new THREE.Vector3(0, ay, L), new THREE.Vector3(0, mid.y, 1.2), 1.4, M.wood());
    b.stairs(new THREE.Vector3(0, mid.y, -1.2), new THREE.Vector3(0, by, -L), 1.4, M.wood());
    b.box(1.4, 0.08, 2.5, 0, mid.y - 0.04, 0, M.wood());
    for (const s of [-1, 1]) {
      b.box(0.08, 0.08, 2 * L, s * 0.72, mid.y + 0.95, 0, M.woodDark(), { collide: false });
      b.box(0.1, 1.0, 0.1, s * 0.72, mid.y + 0.45, 0, M.woodDark(), { collide: false });
      // log piles holding it up
      b.box(0.3, mid.y - d.level + 1, 0.3, s * 0.6, (mid.y + d.level - 1) / 2, 0, M.barkSpruce(), { collide: false });
    }
  }

  private logging(p: Place) {
    const stumps: number[][] = p.data.stumps ?? [];
    for (const s of stumps) this.stump(new THREE.Vector3(s[0], 0, s[2]), Math.max(0.12, 0.2 * s[3]));
    // a stack of logs left behind
    const q = new THREE.Quaternion().setFromAxisAngle(UP, p.yaw);
    for (let i = 0; i < 7; i++) {
      const row = i % 4, layer = Math.floor(i / 4);
      const off = new THREE.Vector3(-0.6 + row * 0.38 + layer * 0.19, 0, 0).applyQuaternion(q);
      const x = p.x + off.x, z = p.z + off.z;
      G.entities.spawnItem('log', new THREE.Vector3(x, G.terrain.heightAt(x, z) + 0.25 + layer * 0.32, z), { quat: q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2)), moisture: 0.25, sleep: true });
    }
  }

  private cross(p: Place) {
    const b = new Builder(p.x, p.y, p.z, p.yaw);
    b.box(0.12, 2.0, 0.12, 0, 1.0, 0, M.woodDark());
    b.box(0.9, 0.1, 0.1, 0, 1.55, 0, M.woodDark(), { collide: false });
    b.box(0.5, 0.08, 0.08, 0, 1.25, 0, M.woodDark(), { rz: -0.3, collide: false });
    const mound = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.snow());
    mound.scale.set(0.7, 0.25, 1.2);
    mound.position.set(0, -0.05, 0.9);
    b.group.add(mound);
  }
}
