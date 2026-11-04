// Wild animals. For now: foxes.
// A fox wanders and sniffs along, listens for mice under the snow and pounces, lies down to
// rest, and keeps away from people: it sees you in the open, hears you running or chopping,
// and smells you when the wind blows from you to it. A curious fox may stop and watch from a
// distance. Food left on the snow draws it in. It leaves a line of tracks in the snow.
import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { G, groups, GR_ITEM, GR_STATIC, GR_PLAYER } from '../ctx';
import { Entity } from '../entities';
import { loadTemplate, Rig, PALETTES, Template, Pose } from './rig';
import { B } from '../../gen/biomes';
import { clamp } from '../../core/rng';

type State = 'wander' | 'sniff' | 'listen' | 'pounce' | 'eat' | 'rest' | 'alert' | 'watch' | 'flee' | 'bait' | 'caught' | 'dead';

export interface Animal {
  id: number;
  species: 'fox';
  rig: Rig;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  want: number; // target speed
  state: State;
  t: number; // time left in the state
  heading: number;
  fear: number; // 0..1
  curious: number; // personality
  bait: Entity | null;
  entity: Entity;
  collider: RAPIER_T.Collider;
  stepAcc: number;
  stepSide: number;
  color: string;
  stuck: number;
}

const MAX_ACTIVE = 4;
const SPAWN_MIN = 160, SPAWN_MAX = 420, DESPAWN = 750;

export const COLOR_NAMES: Record<string, string> = { red: 'Рыжая лиса', silver: 'Чернобурая лиса', arctic: 'Песец' };

export class Animals {
  list: Animal[] = [];
  private templates: Template[] = [];
  private nextId = 1;
  private spawnTimer = 2;
  private tracks!: THREE.InstancedMesh;
  private trackIdx = 0;
  private trackCount = 600;
  ready = false;

  async load() {
    try {
      this.templates = await Promise.all([loadTemplate('models/fox_a.glb', 'fox_a', 0.38), loadTemplate('models/fox_b.glb', 'fox_b', 0.38)]);
      this.ready = true;
    } catch (e) {
      console.warn('animals: models failed to load', e);
    }
    // paw prints: small dark ovals pressed into the snow
    const g = new THREE.CircleGeometry(0.035, 8);
    g.rotateX(-Math.PI / 2);
    g.scale(1, 1, 1.35);
    const m = new THREE.MeshStandardMaterial({ color: 0x8fa0b4, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.tracks = new THREE.InstancedMesh(g, m, this.trackCount);
    this.tracks.count = 0;
    this.tracks.frustumCulled = false;
    this.tracks.receiveShadow = true;
    G.scene.add(this.tracks);
  }

  // ---------- spawning ----------

  private groundY(x: number, z: number) {
    const L = G.region.waterAt(x, z);
    if (!Number.isNaN(L) && G.region.iceAt(x, z) > 0) return L + 0.03;
    return G.region.heightAt(x, z);
  }

  private walkable(x: number, z: number) {
    const R = G.region;
    if (!R.inside(x, z, 40)) return false;
    const L = R.waterAt(x, z);
    if (!Number.isNaN(L) && R.iceAt(x, z) < 0.15) return false;
    if (R.slopeAt(x, z) > 0.75) return false;
    const hb = G.house.bounds;
    if (x > hb.min.x - 0.6 && x < hb.max.x + 0.6 && z > hb.min.z - 0.6 && z < hb.max.z + 2.6) return false;
    if (G.structures.shelterAt(new THREE.Vector3(x, this.groundY(x, z) + 0.3, z))) return false;
    return true;
  }

  spawn(x: number, z: number, color?: string) {
    if (!this.ready || !this.walkable(x, z)) return null;
    const R = G.region;
    const b = R.biomeAt(x, z);
    const cold = b === B.Tundra || b === B.Coast || b === B.Alpine || b === B.Stones;
    const c = color ?? (cold && Math.random() < 0.7 ? 'arctic' : Math.random() < 0.18 ? 'silver' : 'red');
    const T = this.templates[Math.floor(Math.random() * this.templates.length)];
    const rig = new Rig(T, PALETTES[c]);
    const s = 0.9 + Math.random() * 0.2;
    rig.root.scale.setScalar(c === 'arctic' ? s * 0.85 : s);
    G.scene.add(rig.root);
    const e = new Entity('animal');
    e.name = COLOR_NAMES[c];
    e.obj = rig.root;
    rig.root.userData.entity = e;
    const col = G.world.createCollider(
      G.R.ColliderDesc.capsule(0.22, 0.14).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setTranslation(x, this.groundY(x, z) + 0.25, z)
        .setCollisionGroups(groups(GR_ITEM, GR_STATIC | GR_PLAYER)),
    );
    G.entities.registerStatic(e, [col]);
    const a: Animal = {
      id: this.nextId++, species: 'fox', rig, pos: new THREE.Vector3(x, this.groundY(x, z), z), yaw: Math.random() * 6.28, speed: 0, want: 0,
      state: 'wander', t: 5 + Math.random() * 10, heading: Math.random() * 6.28, fear: 0, curious: Math.random(), bait: null, entity: e, collider: col,
      stepAcc: 0, stepSide: 1, color: c, stuck: 0,
    };
    e.data = { animal: a, hp: 2, carcass: false };
    this.list.push(a);
    return a;
  }

  private despawn(a: Animal) {
    a.rig.root.removeFromParent();
    G.entities.destroy(a.entity);
    this.list.splice(this.list.indexOf(a), 1);
  }

  private maintain() {
    const P = G.player.pos;
    for (const a of [...this.list]) {
      if (a.state === 'dead' || a.state === 'caught') continue;
      if (a.pos.distanceTo(P) > DESPAWN) this.despawn(a);
    }
    const alive = this.list.filter((a) => a.state !== 'dead').length;
    if (alive >= MAX_ACTIVE) return;
    // try to put a fox somewhere out there, preferably out of sight
    for (let k = 0; k < 12; k++) {
      const ang = Math.random() * Math.PI * 2;
      const d = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      const x = P.x + Math.cos(ang) * d, z = P.z + Math.sin(ang) * d;
      if (!this.walkable(x, z)) continue;
      const b = G.region.biomeAt(x, z);
      if (b === B.Sea || b === B.Alpine) continue;
      this.spawn(x, z);
      return;
    }
  }

  // ---------- senses ----------

  /** a loud sound (chopping, breaking glass, a shot) */
  noise(at: THREE.Vector3, radius: number) {
    for (const a of this.list) {
      if (a.state === 'dead' || a.state === 'caught') continue;
      const d = a.pos.distanceTo(at);
      if (d < radius) {
        a.fear = Math.min(1, a.fear + (1 - d / radius) * 0.9);
        if (a.fear > 0.5) this.flee(a, at);
        else if (a.state !== 'flee') this.setState(a, 'alert', 2 + Math.random() * 2);
      }
    }
  }

  /** how strongly the fox notices the player right now (0..1+) */
  private notice(a: Animal) {
    const P = G.player;
    const d = a.pos.distanceTo(P.pos);
    if (d > 140) return 0;
    const R = G.region, W = G.weather;
    // sight: shorter in the forest, at night and in snow
    let sight = 60 * (1 - 0.55 * R.forestAt(a.pos.x, a.pos.z)) * (0.45 + 0.55 * G.sky.daylight) * (1 - 0.6 * W.snow) * (W.type === 'fog' ? 0.4 : 1);
    if (P.crouch) sight *= 0.45;
    if (!P.moving) sight *= 0.55;
    if (G.house.zoneAt(P.pos) || G.structures.shelterAt(P.pos)) sight *= 0.15;
    // hearing: running and work are loud
    const hear = P.sprinting ? 45 : P.moving && !P.crouch ? 16 : 5;
    // smell: when the wind carries your scent to the fox
    const wx = Math.cos(W.windDir), wz = Math.sin(W.windDir);
    const tx = (a.pos.x - P.pos.x) / (d || 1), tz = (a.pos.z - P.pos.z) / (d || 1);
    const down = wx * tx + wz * tz; // 1: fox straight downwind of you
    const smell = down > 0.6 && W.wind > 0.5 ? 80 * (down - 0.6) / 0.4 * Math.min(1, W.wind / 3) : 0;
    let n = Math.max(sight > d ? 1 - d / sight : 0, hear > d ? 1 - d / hear : 0, smell > d ? 1.2 * (1 - d / smell) : 0);
    // food in hand-out reach makes a hungry fox bolder
    if (a.bait) n *= 0.6;
    return n;
  }

  // ---------- behaviour ----------

  private setState(a: Animal, s: State, t: number) {
    a.state = s;
    a.t = t;
  }

  private flee(a: Animal, from: THREE.Vector3) {
    a.heading = Math.atan2(a.pos.x - from.x, a.pos.z - from.z) + (Math.random() - 0.5) * 0.6;
    a.bait = null;
    this.setState(a, 'flee', 6 + Math.random() * 6);
  }

  private findBait(a: Animal): Entity | null {
    let best: Entity | null = null;
    let bd = 70;
    for (const e of G.entities.list) {
      if (e.removed || !e.inWorld || !e.def?.food) continue;
      const smelly = ['fish_raw', 'fish_cooked', 'fox_meat', 'fox_meat_cooked', 'stew', 'fish_burnt'].includes(e.defId!);
      if (!smelly) continue;
      const p = e.position();
      const d = p.distanceTo(a.pos);
      if (d < bd && !G.house.zoneAt(p)) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  update(dtReal: number) {
    if (!this.ready || dtReal <= 0) return;
    this.spawnTimer -= dtReal;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 3;
      this.maintain();
    }
    const P = G.player.pos;
    for (const a of this.list) this.think(a, dtReal, P);
  }

  private think(a: Animal, dt: number, P: THREE.Vector3) {
    if (a.state === 'dead') {
      a.rig.update(dt, 0, 'dead');
      this.place(a);
      return;
    }
    a.t -= dt;
    const d = a.pos.distanceTo(P);
    const n = this.notice(a);
    a.fear = Math.max(0, a.fear - dt * 0.03);
    let pose: Pose = 'move';
    let look: number | null = null;
    const toPlayer = Math.atan2(P.x - a.pos.x, P.z - a.pos.z);
    const rel = (ang: number) => Math.atan2(Math.sin(ang - a.yaw), Math.cos(ang - a.yaw));

    if (a.state === 'caught') {
      a.want = 0;
      pose = Math.sin(performance.now() / 700) > 0.3 ? 'struggle' : 'alert';
      look = rel(toPlayer);
      if (d < 6 && Math.random() < dt * 0.6) G.audio.play('whisper', { pos: a.pos, vol: 0.3 });
      a.speed = 0;
      a.rig.update(dt, 0, pose, look);
      this.place(a);
      return;
    }

    // reactions to the player override everything else
    if (a.state !== 'flee' && n > 0) {
      a.fear = Math.min(1, a.fear + n * dt * 0.7);
      if (d < 12 || a.fear > 0.6 || (n > 0.8 && d < 30)) this.flee(a, P);
      else if (a.state !== 'alert' && a.state !== 'watch' && a.state !== 'pounce') this.setState(a, 'alert', 2.5 + Math.random() * 2);
    }

    switch (a.state) {
      case 'wander': {
        a.want = 0.8 + 0.4 * Math.sin(a.id + performance.now() / 4000);
        a.heading += (Math.random() - 0.5) * dt * 0.9;
        if (a.t <= 0) {
          const r = Math.random();
          const open = G.region.forestAt(a.pos.x, a.pos.z) < 0.5 && Number.isNaN(G.region.waterAt(a.pos.x, a.pos.z));
          if (r < 0.3) this.setState(a, 'sniff', 2 + Math.random() * 3);
          else if (r < 0.62 && open) this.setState(a, 'listen', 1.5 + Math.random() * 2);
          else if (r < 0.7 && G.sky.daylight > 0.3) this.setState(a, 'rest', 20 + Math.random() * 40);
          else {
            // trot a bit faster for a while in a new direction
            a.heading += (Math.random() - 0.5) * 2;
            this.setState(a, 'wander', 6 + Math.random() * 10);
            a.want = 2.2;
          }
          const bait = this.findBait(a);
          if (bait && d > 10) {
            a.bait = bait;
            this.setState(a, 'bait', 60);
          }
        }
        break;
      }
      case 'sniff':
        a.want = 0.15;
        pose = 'sniff';
        if (a.t <= 0) this.setState(a, 'wander', 4 + Math.random() * 8);
        break;
      case 'listen':
        // head cocked, ears forward: there is a vole under the snow
        a.want = 0;
        pose = 'alert';
        look = Math.sin(performance.now() / 300) * 0.25;
        if (a.t <= 0) {
          a.rig.pounce();
          this.setState(a, 'pounce', 2.9);
          G.audio.play('snow_scoop', { pos: a.pos, vol: 0.4 });
        }
        break;
      case 'pounce':
        a.want = 0;
        pose = 'idle';
        if (a.rig.leaping) {
          // fly forward
          a.speed = (0.38 * 3.5) / 0.6;
        } else a.speed = 0;
        if (a.rig.diving && Math.random() < dt * 4) G.fx.burst('snow', a.pos.clone().add(new THREE.Vector3(Math.sin(a.yaw) * 0.3, 0.1, Math.cos(a.yaw) * 0.3)), 3);
        if (a.t <= 0) {
          if (Math.random() < 0.3) this.setState(a, 'eat', 4);
          else this.setState(a, 'wander', 3 + Math.random() * 6);
        }
        break;
      case 'eat':
        a.want = 0;
        pose = 'eat';
        if (a.t <= 0) this.setState(a, 'wander', 5 + Math.random() * 8);
        break;
      case 'rest':
        a.want = 0;
        pose = 'lie';
        if (a.t <= 0 || n > 0.2) this.setState(a, n > 0.2 ? 'alert' : 'wander', 3);
        break;
      case 'alert':
        a.want = 0;
        pose = 'alert';
        a.heading = toPlayer;
        look = rel(toPlayer);
        if (a.t <= 0) {
          // a curious fox stays and watches; a shy one leaves
          if (a.curious > 0.5 && d > 22 && a.fear < 0.4) this.setState(a, 'watch', 8 + Math.random() * 10);
          else if (n > 0.1) this.flee(a, P);
          else this.setState(a, 'wander', 5);
        }
        break;
      case 'watch':
        // keeps its distance and stares, sometimes edges closer
        pose = 'alert';
        look = rel(toPlayer);
        a.heading = toPlayer;
        a.want = d > 30 && !G.player.moving ? 0.5 : 0;
        if (d < 18 || a.fear > 0.6) this.flee(a, P);
        else if (a.t <= 0) this.setState(a, 'wander', 6);
        break;
      case 'flee':
        a.want = 7.5;
        // keep running away from you
        {
          const away = toPlayer + Math.PI + Math.sin(a.id + performance.now() / 900) * 0.3;
          if (d < 60 && this.clear(a, away, 2.5)) a.heading = away;
        }
        if (a.t <= 0 && d > 90) {
          this.setState(a, 'wander', 10);
          a.want = 2;
        }
        break;
      case 'bait': {
        const b = a.bait;
        if (!b || b.removed || !b.inWorld) {
          a.bait = null;
          this.setState(a, 'wander', 5);
          break;
        }
        const bp = b.position();
        const db = Math.hypot(bp.x - a.pos.x, bp.z - a.pos.z);
        a.heading = Math.atan2(bp.x - a.pos.x, bp.z - a.pos.z);
        a.want = db > 12 ? 2.2 : 0.7;
        if (db < 0.55) {
          // gulps it down
          a.want = 0;
          pose = 'eat';
          if (a.t > 6) a.t = 6;
          if (a.t <= 0) {
            G.entities.destroy(b);
            a.bait = null;
            this.setState(a, 'wander', 8);
          }
        } else if (a.t <= 0) this.setState(a, 'wander', 5);
        break;
      }
    }
    if (a.state === 'pounce') {
      a.rig.update(dt, 0, 'idle', null);
    } else {
      // steer: avoid trees, open water, cliffs and the map edge
      this.steer(a, dt);
      a.speed += (a.want - a.speed) * Math.min(1, dt * (a.want > a.speed ? 2.5 : 4));
      a.rig.update(dt, a.speed, a.speed > 0.05 ? (pose === 'move' || pose === 'sniff' ? pose : 'move') : pose === 'move' ? 'idle' : pose, look);
    }
    // move
    if (a.speed > 0.01) {
      const nx = a.pos.x + Math.sin(a.yaw) * a.speed * dt, nz = a.pos.z + Math.cos(a.yaw) * a.speed * dt;
      if (this.walkable(nx, nz) || a.state === 'pounce') {
        a.pos.x = nx;
        a.pos.z = nz;
        a.stuck = 0;
      } else {
        a.heading += Math.PI * (0.5 + Math.random() * 0.5);
        a.stuck++;
      }
      // tracks
      a.stepAcc += a.speed * dt;
      if (a.stepAcc > 0.33 && a.state !== 'pounce') {
        a.stepAcc = 0;
        a.stepSide = -a.stepSide;
        this.track(a);
      }
    }
    this.place(a);
  }

  private clear(a: Animal, h: number, dist: number) {
    const x = a.pos.x + Math.sin(h) * dist, z = a.pos.z + Math.cos(h) * dist;
    if (!this.walkable(x, z)) return false;
    for (const t of G.forest.treesNear(x, z, 0.8)) if (t.alive) return false;
    return true;
  }

  private steer(a: Animal, dt: number) {
    // go where it wants if the way is clear, otherwise the nearest clear direction
    if (a.want > 0.1) {
      const look = 1.4 + a.speed * 0.35;
      if (!this.clear(a, a.heading, look)) {
        for (const off of [0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 1.9, -1.9, 2.5, -2.5, Math.PI]) {
          const h = a.heading + off * (a.id % 2 ? 1 : -1);
          if (this.clear(a, h, look)) {
            a.heading = h;
            break;
          }
        }
      }
    }
    const diff = Math.atan2(Math.sin(a.heading - a.yaw), Math.cos(a.heading - a.yaw));
    const turn = (a.speed > 3 ? 2.6 : 3.4) * dt;
    a.yaw += clamp(diff, -turn, turn);
  }

  private place(a: Animal) {
    const y = this.groundY(a.pos.x, a.pos.z);
    a.pos.y = y;
    a.rig.root.position.copy(a.pos);
    // follow the slope
    const e = 0.4;
    const fy = this.groundY(a.pos.x + Math.sin(a.yaw) * e, a.pos.z + Math.cos(a.yaw) * e) - this.groundY(a.pos.x - Math.sin(a.yaw) * e, a.pos.z - Math.cos(a.yaw) * e);
    a.rig.root.rotation.set(-Math.atan2(fy, 2 * e), a.yaw, 0, 'YXZ');
    a.collider.setTranslation({ x: a.pos.x, y: y + 0.25, z: a.pos.z });
    a.collider.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, a.yaw, 0, 'YXZ')));
  }

  private track(a: Animal) {
    if (!Number.isNaN(G.region.waterAt(a.pos.x, a.pos.z)) && G.region.iceAt(a.pos.x, a.pos.z) > 0.3) return;
    const side = new THREE.Vector3(Math.cos(a.yaw), 0, -Math.sin(a.yaw)).multiplyScalar(0.05 * a.stepSide);
    const p = a.pos.clone().add(side);
    p.y = G.region.heightAt(p.x, p.z) + 0.015;
    const m = new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.yaw), new THREE.Vector3(1, 1, 1));
    this.tracks.setMatrixAt(this.trackIdx, m);
    this.trackIdx = (this.trackIdx + 1) % this.trackCount;
    this.tracks.count = Math.max(this.tracks.count, this.trackIdx);
    this.tracks.instanceMatrix.needsUpdate = true;
  }
}
