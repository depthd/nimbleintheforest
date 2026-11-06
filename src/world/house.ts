// The cabin: two floors, stairs, railings, windows, a door and a wood stove.
// Built from boxes with colliders. Furniture and loot are spawned as physical items.
import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { G, GROUPS_STATIC, msg } from '../game/ctx';
import { makeRound, makeSawn } from '../game/wood/piece';
import { Rng } from '../core/rng';
import { Tex, worldUVBox } from '../core/textures';
import { M, mat } from '../game/meshes';
import { Entity } from '../game/entities';
import { def, Shape } from '../game/items';

export interface WindowData {
  zone: 'ground' | 'upper';
  w: number;
  h: number;
  center: THREE.Vector3;
  inward: THREE.Vector3; // unit vector pointing into the house
  glass: 'intact' | 'broken';
  cover: Entity | null;
  boards: number;
  group: THREE.Group;
  glassMesh: THREE.Mesh;
  coverMesh: THREE.Mesh | null;
  boardMeshes: THREE.Mesh[];
  collider: RAPIER_T.Collider;
}

type Opening = { a0: number; a1: number; b0: number; b1: number };

const WALL_T = 0.25;
const HX = 5; // half width (x)
const HZ = 4; // half depth (z)
const UPPER = 3.0; // upper floor surface height
const WALL_TOP = 5.4;
const RIDGE = 7.4;

function halfHeight(shape: Shape, q: THREE.Quaternion) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
  // row 1 of rotation matrix (column-major storage): m[1], m[5], m[9]
  const r0 = Math.abs(m[1]), r1 = Math.abs(m[5]), r2 = Math.abs(m[9]);
  switch (shape.t) {
    case 'box':
      return r0 * shape.x + r1 * shape.y + r2 * shape.z;
    case 'cyl':
      return r1 * shape.h + Math.sqrt(Math.max(0, 1 - r1 * r1)) * shape.r;
    case 'cylx':
      return r0 * shape.h + Math.sqrt(Math.max(0, 1 - r0 * r0)) * shape.r;
    case 'ball':
      return shape.r;
  }
}

export class House {
  Y0 = 0;
  bounds = new THREE.Box3();
  ground = new THREE.Box3();
  upper = new THREE.Box3();
  windows: Entity[] = [];
  door!: Entity;
  doorway: Entity | null = null;
  stove!: Entity;
  railings: Entity[] = [];
  bed: Entity | null = null;
  chimneyTop = new THREE.Vector3();
  private body!: RAPIER_T.RigidBody;
  private wallMat!: THREE.Material;
  private floorMat!: THREE.Material;

  build(rng: Rng) {
    this.Y0 = G.terrain.houseY + 0.45;
    const Y0 = this.Y0;
    this.bounds.set(new THREE.Vector3(-HX - 0.05, Y0 - 0.3, -HZ - 0.05), new THREE.Vector3(HX + 0.05, Y0 + RIDGE, HZ + 0.05));
    const ix = HX - WALL_T, iz = HZ - WALL_T;
    this.ground.set(new THREE.Vector3(-ix, Y0 - 0.2, -iz), new THREE.Vector3(ix, Y0 + 2.85, iz));
    this.upper.set(new THREE.Vector3(-ix, Y0 + 2.85, -iz), new THREE.Vector3(ix, Y0 + RIDGE, iz));
    this.body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
    this.wallMat = mat('logwall', () => new THREE.MeshStandardMaterial({ map: Tex.logWall(), roughness: 0.9 }));
    this.floorMat = mat('floor', () => new THREE.MeshStandardMaterial({ map: Tex.planks(), color: 0xb8a088, roughness: 0.85 }));
    const stoneMat = mat('stoneplinth', () => new THREE.MeshStandardMaterial({ map: Tex.stone(), roughness: 1 }));
    const roofMat = mat('roof', () => new THREE.MeshStandardMaterial({ map: Tex.planks(), color: 0x5a4a40, roughness: 0.9 }));

    // foundation & floors
    G.snowCover.add({ name: 'Пол дома', kind: 'floor', x: 0, z: 0, hx: HX, hz: HZ, y: Y0 });
    const plinthH = 1.3;
    this.solid(2 * HX + 0.2, plinthH, 2 * HZ + 0.2, 0, -0.2 - plinthH / 2, 0, stoneMat, 1.2);
    this.solid(2 * HX, 0.2, 2 * HZ, 0, -0.1, 0, this.floorMat, 1.5);
    // upper floor with stair hole x∈[-4.75,-3.55], z∈[-1,3.75]
    const holeX1 = -3.55;
    this.solid(ix - holeX1, 0.2, 2 * iz, (ix + holeX1) / 2, UPPER - 0.1, 0, this.floorMat, 1.5);
    this.solid(holeX1 + ix, 0.2, -1 + iz, (-ix + holeX1) / 2, UPPER - 0.1, (-iz - 1) / 2, this.floorMat, 1.5);
    // beams under upper floor (decor)
    for (let x = -3; x <= 4; x += 1.75) this.solid(0.18, 0.22, 2 * iz, x, UPPER - 0.31, 0, M.woodDark(), 1.5, false);

    // walls with openings
    const winG = { b0: 1.0, b1: 2.0 };
    const winU = { b0: UPPER + 0.9, b1: UPPER + 1.9 };
    const front: Opening[] = [
      { a0: 1.0, a1: 2.0, b0: 0, b1: 2.1 }, // door
      { a0: -2.0, a1: -1.0, ...winG },
      { a0: 3.0, a1: 4.0, ...winG },
      { a0: 1.5, a1: 2.5, ...winU },
    ];
    const back: Opening[] = [
      { a0: 1.5, a1: 2.5, b0: 1.1, b1: 2.0 },
      { a0: -1.5, a1: -0.5, ...winU },
    ];
    const right: Opening[] = [
      { a0: 0.3, a1: 1.3, ...winG },
      { a0: -0.5, a1: 0.5, ...winU },
    ];
    const left: Opening[] = [{ a0: -0.5, a1: 0.5, ...winU }];
    this.wall('x', HZ - WALL_T / 2, -HX, HX, -0.2, WALL_TOP, front);
    this.wall('x', -HZ + WALL_T / 2, -HX, HX, -0.2, WALL_TOP, back);
    this.wall('z', HX - WALL_T / 2, -iz, iz, -0.2, WALL_TOP, right);
    this.wall('z', -HX + WALL_T / 2, -iz, iz, -0.2, WALL_TOP, left);
    this.gable(HX - WALL_T / 2);
    this.gable(-HX + WALL_T / 2);
    this.roof(roofMat);

    // windows
    const mk = (cx: number, cy: number, cz: number, w: number, h: number, inward: THREE.Vector3, zone: 'ground' | 'upper') =>
      this.windows.push(this.makeWindow(new THREE.Vector3(cx, Y0 + cy, cz), w, h, inward, zone));
    const fz = HZ - WALL_T / 2, bz = -HZ + WALL_T / 2, rx = HX - WALL_T / 2, lx = -HX + WALL_T / 2;
    mk(-1.5, 1.5, fz, 1, 1, new THREE.Vector3(0, 0, -1), 'ground');
    mk(3.5, 1.5, fz, 1, 1, new THREE.Vector3(0, 0, -1), 'ground');
    mk(2.0, UPPER + 1.4, fz, 1, 1, new THREE.Vector3(0, 0, -1), 'upper');
    mk(2.0, 1.55, bz, 1, 0.9, new THREE.Vector3(0, 0, 1), 'ground');
    mk(-1.0, UPPER + 1.4, bz, 1, 1, new THREE.Vector3(0, 0, 1), 'upper');
    mk(rx, 1.5, 0.8, 1, 1, new THREE.Vector3(-1, 0, 0), 'ground');
    mk(rx, UPPER + 1.4, 0, 1, 1, new THREE.Vector3(-1, 0, 0), 'upper');
    mk(lx, UPPER + 1.4, 0, 1, 1, new THREE.Vector3(1, 0, 0), 'upper');

    this.makeDoor();
    this.makeStairs();
    this.makeRailings();
    this.makeStove();
    this.makePorch();
    this.makeWoodshed(rng);
    this.furnish(rng);
  }

  // ---------- building helpers ----------

  private solid(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, texScale = 1.5, collide = true, quat?: THREE.Quaternion) {
    const me = new THREE.Mesh(worldUVBox(w, h, d, texScale), m);
    me.position.set(x, this.Y0 + y, z);
    if (quat) me.quaternion.copy(quat);
    me.castShadow = true;
    me.receiveShadow = true;
    G.scene.add(me);
    if (collide) {
      const cd = G.R.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, this.Y0 + y, z).setCollisionGroups(GROUPS_STATIC).setFriction(0.9);
      if (quat) cd.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
      G.world.createCollider(cd, this.body);
    }
    return me;
  }

  /** Wall along axis 'x' (fixed z) or 'z' (fixed x), split around openings. */
  private wall(axis: 'x' | 'z', fixed: number, a0: number, a1: number, y0: number, y1: number, openings: Opening[]) {
    const ops = [...openings].sort((p, q) => p.a0 - q.a0);
    const piece = (s0: number, s1: number, b0: number, b1: number) => {
      if (s1 - s0 < 0.01 || b1 - b0 < 0.01) return;
      const len = s1 - s0, mid = (s0 + s1) / 2, h = b1 - b0, my = (b0 + b1) / 2;
      if (axis === 'x') this.solid(len, h, WALL_T, mid, my, fixed, this.wallMat, 1.6);
      else this.solid(WALL_T, h, len, fixed, my, mid, this.wallMat, 1.6);
    };
    let cur = a0;
    // openings might overlap in "a" (window above door) so process columns by unique spans
    const spans: { a0: number; a1: number; holes: Opening[] }[] = [];
    for (const op of ops) {
      const last = spans[spans.length - 1];
      if (last && op.a0 < last.a1) {
        last.a1 = Math.max(last.a1, op.a1);
        last.holes.push(op);
      } else spans.push({ a0: op.a0, a1: op.a1, holes: [op] });
    }
    for (const sp of spans) {
      piece(cur, sp.a0, y0, y1);
      // within a span: build vertical slices between hole edges
      const edges = Array.from(new Set([sp.a0, sp.a1, ...sp.holes.flatMap((h) => [h.a0, h.a1])])).sort((p, q) => p - q);
      for (let i = 0; i < edges.length - 1; i++) {
        const s0 = edges[i], s1 = edges[i + 1];
        const mid = (s0 + s1) / 2;
        const holes = sp.holes.filter((h) => h.a0 <= mid && h.a1 >= mid).sort((p, q) => p.b0 - q.b0);
        let yc = y0;
        for (const h of holes) {
          piece(s0, s1, yc, h.b0);
          yc = h.b1;
        }
        piece(s0, s1, yc, y1);
      }
      cur = sp.a1;
    }
    piece(cur, a1, y0, y1);
  }

  private gable(x: number) {
    const s = new THREE.Shape();
    s.moveTo(-HZ, 0);
    s.lineTo(HZ, 0);
    s.lineTo(0, RIDGE - WALL_TOP);
    s.lineTo(-HZ, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: WALL_T, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.6, uv.getY(i) / 1.6);
    const m = new THREE.Mesh(g, this.wallMat);
    m.position.set(x - WALL_T / 2, this.Y0 + WALL_TOP, 0);
    m.castShadow = m.receiveShadow = true;
    G.scene.add(m);
  }

  private roof(roofMat: THREE.Material) {
    const run = HZ + 0.6;
    const drop = (RIDGE - WALL_TOP) * (run / HZ);
    const len = Math.hypot(run, drop);
    const ang = Math.atan2(drop, run);
    G.snowCover.add({ name: 'Крыша дома', kind: 'roof', x: 0, z: 0, hx: HX + 0.6, hz: run + 0.05*Math.cos(ang)+0.08*Math.sin(ang), y: this.Y0 + RIDGE + 0.3 });
    for (const s of [-1, 1]) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), s * ang);
      const cz = (s * run) / 2;
      const cy = RIDGE - drop / 2 + 0.12;
      this.solid(2 * HX + 1.2, 0.16, len + 0.1, 0, cy, cz, roofMat, 1.5, true, q);
      // snow layer
      const sn = new THREE.Mesh(worldUVBox(2 * HX + 1.1, 0.14, len, 3), M.snow());
      const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      sn.position.set(0, this.Y0 + cy, cz).addScaledVector(n, 0.15);
      sn.quaternion.copy(q);
      sn.castShadow = true;
      sn.receiveShadow = true;
      G.scene.add(sn);
    }
  }

  private makeWindow(center: THREE.Vector3, w: number, h: number, inward: THREE.Vector3, zone: 'ground' | 'upper'): Entity {
    const e = new Entity('window');
    e.name = 'Окно';
    const g = new THREE.Group();
    g.position.copy(center);
    // orient group: local +z = inward
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), inward);
    const fm = M.woodDark();
    const ft = 0.07;
    const frame = (fw: number, fh: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, WALL_T + 0.04), fm);
      m.position.set(x, y, 0);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    };
    frame(w + ft * 2, ft, 0, h / 2 + ft / 2);
    frame(w + ft * 2, ft * 1.4, 0, -h / 2 - ft * 0.7);
    frame(ft, h, -w / 2 - ft / 2, 0);
    frame(ft, h, w / 2 + ft / 2, 0);
    frame(0.04, h, 0, 0);
    frame(w, 0.04, 0, 0);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xdfeefc, transparent: true, opacity: 0.25, roughness: 0.15, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
    glass.position.z = -0.02;
    g.add(glass);
    G.scene.add(g);
    const q = g.quaternion;
    const col = G.world.createCollider(
      G.R.ColliderDesc.cuboid(w / 2, h / 2, 0.05)
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCollisionGroups(GROUPS_STATIC)
        .setActiveEvents(G.R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(60),
    );
    e.obj = g;
    g.userData.entity = e;
    const data: WindowData = { zone, w, h, center: center.clone(), inward: inward.clone(), glass: 'intact', cover: null, boards: 0, group: g, glassMesh: glass, coverMesh: null, boardMeshes: [], collider: col };
    e.data = data;
    G.entities.registerStatic(e, [col]);
    return e;
  }

  breakGlass(e: Entity, silent = false) {
    const d = e.data as WindowData;
    if (d.glass === 'broken') return;
    d.glass = 'broken';
    d.glassMesh.visible = false;
    d.collider.setSensor(true);
    if (!silent) {
      G.audio.play('glass', { pos: d.center });
      G.fx.burst('glass', d.center, 24);
      msg('Стекло разбито. Теперь из окна сильно дует.', 'warn');
    }
    // shards fall inside and outside
    for (let i = 0; i < 2; i++) {
      const p = d.center.clone().addScaledVector(d.inward, i === 0 ? 0.4 : -0.4);
      p.y -= 0.3;
      G.entities.spawnItem('shard', p, { vel: d.inward.clone().multiplyScalar(i === 0 ? 1 : -1) });
    }
  }

  hangCover(e: Entity, blanket: Entity) {
    const d = e.data as WindowData;
    d.cover = blanket;
    G.entities.removeFromWorld(blanket);
    const geo = new THREE.PlaneGeometry(d.w + 0.3, d.h + 0.35, 6, 6);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 7) * 0.025 + (0.5 - Math.abs(p.getY(i))) * 0.03);
    geo.computeVertexNormals();
    const mtl = M.plaid((blanket.params.v ?? 0) + (blanket.defId === 'plaid' ? 2 : 0));
    const m = new THREE.Mesh(geo, mtl);
    (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    m.position.z = WALL_T / 2 + 0.06;
    m.castShadow = true;
    d.group.add(m);
    d.coverMesh = m;
  }

  takeCover(e: Entity): Entity | null {
    const d = e.data as WindowData;
    const b = d.cover;
    if (!b) return null;
    d.cover = null;
    if (d.coverMesh) {
      d.coverMesh.removeFromParent();
      d.coverMesh = null;
    }
    return b;
  }

  addBoard(e: Entity) {
    const d = e.data as WindowData;
    if (d.boards >= 3) return false;
    const i = d.boards++;
    const m = new THREE.Mesh(worldUVBox(d.w + 0.35, 0.14, 0.025, 1.2), M.wood());
    m.position.set(0, (i - 1) * 0.32, WALL_T / 2 + 0.03);
    m.rotation.z = (Math.random() - 0.5) * 0.12;
    m.castShadow = true;
    d.group.add(m);
    d.boardMeshes.push(m);
    return true;
  }

  removeBoard(e: Entity) {
    const d = e.data as WindowData;
    if (d.boards <= 0) return false;
    d.boards--;
    d.boardMeshes.pop()?.removeFromParent();
    return true;
  }

  private makeDoor() {
    const e = new Entity('door');
    e.name = 'Дверь';
    const Y0 = this.Y0;
    const pivot = new THREE.Group();
    const px = 1.0 + 0.01, pz = HZ - WALL_T + 0.04;
    pivot.position.set(px, Y0, pz);
    const panel = new THREE.Mesh(worldUVBox(0.98, 2.08, 0.06, 1.2), M.woodDark());
    panel.position.set(0.49, 1.04, 0);
    panel.castShadow = panel.receiveShadow = true;
    pivot.add(panel);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M.metal());
    knob.position.set(0.86, 1.0, -0.05);
    pivot.add(knob);
    const knob2 = knob.clone();
    knob2.position.z = 0.05;
    pivot.add(knob2);
    G.scene.add(pivot);
    const body = G.world.createRigidBody(G.R.RigidBodyDesc.kinematicPositionBased().setTranslation(px, Y0, pz));
    const col = G.world.createCollider(G.R.ColliderDesc.cuboid(0.49, 1.04, 0.03).setTranslation(0.49, 1.04, 0).setCollisionGroups(GROUPS_STATIC), body);
    e.obj = pivot;
    pivot.userData.entity = e;
    e.data = { open: false, angle: 0, target: 0, body, pivot };
    e.maxHp = e.hp = 7;
    G.entities.registerStatic(e, [col]);
    this.door = e;
  }

  toggleDoor() {
    const d = this.door.data;
    if (this.door.removed) return;
    d.open = !d.open;
    d.target = d.open ? 1.6 : 0;
    G.audio.play('creak', { pos: this.door.position() });
  }

  updateDoor(dt: number) {
    if (this.door.removed) return;
    const d = this.door.data;
    if (Math.abs(d.angle - d.target) < 0.001) return;
    d.angle += Math.sign(d.target - d.angle) * Math.min(Math.abs(d.target - d.angle), dt * 2.5);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.angle);
    d.pivot.quaternion.copy(q);
    d.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }

  destroyDoor() {
    const e = this.door;
    G.entities.destroy(e);
    e.data.pivot.removeFromParent();
    // a doorway that can be curtained with a blanket
    const dw = new Entity('doorway');
    dw.name = 'Дверной проём';
    const c = new THREE.Vector3(1.5, this.Y0 + 1.05, HZ - WALL_T / 2);
    const col = G.world.createCollider(G.R.ColliderDesc.cuboid(0.5, 1.05, 0.1).setTranslation(c.x, c.y, c.z).setSensor(true).setCollisionGroups(GROUPS_STATIC));
    const g = new THREE.Group();
    g.position.copy(c);
    G.scene.add(g);
    dw.obj = g;
    dw.data = { cover: null as Entity | null, mesh: null as THREE.Mesh | null, center: c };
    G.entities.registerStatic(dw, [col]);
    this.doorway = dw;
  }

  hangDoorway(blanket: Entity) {
    const dw = this.doorway!;
    dw.data.cover = blanket;
    G.entities.removeFromWorld(blanket);
    const geo = new THREE.PlaneGeometry(1.15, 2.2, 6, 8);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 8) * 0.03);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, M.plaid(blanket.params.v ?? 0));
    (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    m.position.z = -0.18;
    m.castShadow = true;
    dw.obj!.add(m);
    dw.data.mesh = m;
  }

  takeDoorway(): Entity | null {
    const dw = this.doorway;
    if (!dw?.data.cover) return null;
    const b = dw.data.cover;
    dw.data.cover = null;
    dw.data.mesh?.removeFromParent();
    dw.data.mesh = null;
    return b;
  }

  private makeStairs() {
    const x0 = -HX + WALL_T, x1 = -3.6;
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    const steps = 15;
    const rise = UPPER / steps;
    const zBottom = HZ - WALL_T - 0.25;
    const run = (zBottom - -1.0) / steps;
    for (let i = 0; i < steps; i++) {
      const top = (i + 1) * rise;
      const z = zBottom - (i + 0.5) * run;
      this.solid(w, top, run, cx, top / 2, z, i % 2 ? M.wood() : M.woodDark(), 1.2, false);
      // solid block under the walking ramp so you can't walk through the staircase
      const under = i * rise - 0.03;
      if (under > 0.05) {
        G.world.createCollider(
          G.R.ColliderDesc.cuboid(w / 2, under / 2, run / 2).setTranslation(cx, this.Y0 + under / 2, z).setCollisionGroups(GROUPS_STATIC),
          this.body,
        );
      }
    }
    const len = Math.hypot(zBottom + 1.0, UPPER);
    const ang = Math.atan2(UPPER, zBottom + 1.0);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang);
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const c = new THREE.Vector3(cx, UPPER / 2, (zBottom - 1.0) / 2).addScaledVector(n, -0.03);
    G.world.createCollider(
      G.R.ColliderDesc.cuboid(w / 2, 0.05, len / 2).setTranslation(c.x, this.Y0 + c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(GROUPS_STATIC),
      this.body,
    );
  }

  private makeRailingSegment(a: THREE.Vector3, b: THREE.Vector3, name = 'Перила'): Entity {
    const e = new Entity('railing');
    e.name = name;
    const g = new THREE.Group();
    const len = a.distanceTo(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    g.position.copy(mid);
    g.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    const add = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(worldUVBox(w, h, d, 1.2), M.woodDark());
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    };
    add(0.07, 1.0, 0.07, 0, 0.5, -len / 2 + 0.04);
    add(0.07, 1.0, 0.07, 0, 0.5, len / 2 - 0.04);
    add(0.06, 0.06, len, 0, 0.97, 0);
    add(0.05, 0.05, len, 0, 0.12, 0);
    const n = Math.max(2, Math.round(len / 0.22));
    for (let i = 1; i < n; i++) add(0.03, 0.82, 0.03, 0, 0.55, -len / 2 + (i * len) / n);
    G.scene.add(g);
    const q = g.quaternion;
    const col = G.world.createCollider(
      G.R.ColliderDesc.cuboid(0.05, 0.5, len / 2).setTranslation(mid.x, mid.y + 0.5, mid.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(GROUPS_STATIC),
    );
    e.obj = g;
    g.userData.entity = e;
    e.maxHp = e.hp = 3;
    e.data = { len };
    G.entities.registerStatic(e, [col]);
    this.railings.push(e);
    return e;
  }

  private makeRailings() {
    const Y = this.Y0 + UPPER;
    const x = -3.52;
    const z0 = -1.0, z1 = HZ - WALL_T;
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a = new THREE.Vector3(x, Y, z0 + ((z1 - z0) * i) / n);
      const b = new THREE.Vector3(x, Y, z0 + ((z1 - z0) * (i + 1)) / n);
      this.makeRailingSegment(a, b, 'Перила (2 этаж)');
    }
  }

  private makeStove() {
    const e = new Entity('stove');
    e.name = 'Печь-буржуйка';
    const Y0 = this.Y0;
    const sx = -3.6, sz = -HZ + WALL_T + 0.5;
    const g = new THREE.Group();
    g.position.set(sx, Y0, sz);
    const iron = M.iron();
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const me = new THREE.Mesh(geo, m);
      me.position.set(x, y, z);
      me.castShadow = me.receiveShadow = true;
      g.add(me);
      return me;
    };
    add(new THREE.BoxGeometry(0.72, 0.6, 0.56), iron, 0, 0.47, 0);
    for (const lx of [-0.3, 0.3]) for (const lz of [-0.22, 0.22]) add(new THREE.BoxGeometry(0.05, 0.17, 0.05), iron, lx, 0.085, lz);
    add(new THREE.BoxGeometry(0.76, 0.03, 0.6), iron, 0, 0.785, 0);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x110804, emissive: 0xff6a1a, emissiveIntensity: 0, roughness: 0.5 });
    const glow = add(new THREE.PlaneGeometry(0.34, 0.24), glowMat, 0, 0.46, 0.281);
    add(new THREE.BoxGeometry(0.42, 0.32, 0.02), iron, 0, 0.46, 0.285).material = iron;
    glow.position.z = 0.297;
    // door frame
    add(new THREE.BoxGeometry(0.05, 0.05, 0.03), M.metal(), 0.17, 0.46, 0.31);
    // pipe up through the house
    const pipeTop = RIDGE - 0.6 + 0.9;
    const pipe = add(new THREE.CylinderGeometry(0.075, 0.075, pipeTop - 0.8, 10), iron, 0, 0.8 + (pipeTop - 0.8) / 2, -0.15);
    pipe.castShadow = true;
    // metal floor sheet
    add(new THREE.BoxGeometry(1.1, 0.01, 1.0), M.metal(), 0, 0.005, 0.2);
    G.scene.add(g);
    this.chimneyTop.set(sx, Y0 + pipeTop, sz - 0.15);
    const col = G.world.createCollider(G.R.ColliderDesc.cuboid(0.38, 0.4, 0.3).setTranslation(sx, Y0 + 0.4, sz).setCollisionGroups(GROUPS_STATIC));
    G.world.createCollider(G.R.ColliderDesc.cylinder((pipeTop - 0.8) / 2, 0.08).setTranslation(sx, Y0 + 0.8 + (pipeTop - 0.8) / 2, sz - 0.15).setCollisionGroups(GROUPS_STATIC), this.body);
    e.obj = g;
    g.userData.entity = e;
    e.data = {
      glow: glowMat,
      top: [new THREE.Vector3(sx - 0.18, Y0 + 0.8, sz + 0.05), new THREE.Vector3(sx + 0.18, Y0 + 0.8, sz + 0.05)],
      firePos: new THREE.Vector3(sx, Y0 + 0.45, sz + 0.05),
      front: new THREE.Vector3(sx, Y0 + 0.46, sz + 0.32),
    };
    G.entities.registerStatic(e, [col]);
    this.stove = e;
  }

  private makePorch() {
    const pz0 = HZ, pz1 = HZ + 2.0, px0 = -0.6, px1 = 4.6;
    G.snowCover.add({ name: 'Пол крыльца', kind: 'floor', x: (px0+px1)/2, z: (pz0+pz1)/2, hx: (px1-px0)/2, hz: (pz1-pz0)/2, y: this.Y0 });
    const porchZone = G.snowCover.add({ name: 'Крыша крыльца', kind: 'roof', x: (px0+px1)/2, z: (pz0+pz1)/2+0.1, hx: (px1-px0+0.4)/2, hz: 1.2*Math.cos(0.2), y: this.Y0+3.1 });
    this.solid(px1 - px0, 0.2, pz1 - pz0, (px0 + px1) / 2, -0.1, (pz0 + pz1) / 2, this.floorMat, 1.5);
    this.solid(px1 - px0 + 0.1, 0.9, pz1 - pz0, (px0 + px1) / 2, -0.65, (pz0 + pz1) / 2, mat('stoneplinth', () => new THREE.MeshStandardMaterial({ map: Tex.stone() })), 1.2, false);
    // steps (visual) + ramp collider
    const ground = G.terrain.houseY - this.Y0; // negative
    const sx0 = 1.0, sx1 = 2.6;
    const scx = (sx0 + sx1) / 2;
    this.solid(sx1 - sx0, -ground * 0.66, 0.3, scx, ground + (-ground * 0.66) / 2, pz1 + 0.15, M.wood(), 1.2, false);
    this.solid(sx1 - sx0, -ground * 0.33, 0.3, scx, ground + (-ground * 0.33) / 2, pz1 + 0.45, M.wood(), 1.2, false);
    const rampLen = Math.hypot(0.9, -ground);
    const ang = Math.atan2(-ground, 0.9);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang);
    G.world.createCollider(
      G.R.ColliderDesc.cuboid((sx1 - sx0) / 2, 0.04, rampLen / 2).setTranslation((sx0 + sx1) / 2, this.Y0 + ground / 2 - 0.04, pz1 + 0.45).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(GROUPS_STATIC),
      this.body,
    );
    // posts and a shed roof of real pieces: chop a post and the roof comes down
    const porchRoof = this.shedRoof('Навес крыльца', {
      posts: [px0 + 0.1, px1 - 0.1].map((x) => [new THREE.Vector3(x, this.Y0, pz1 - 0.1), new THREE.Vector3(x, this.Y0 + 2.7, pz1 - 0.1)]),
      postKind: 'nail',
      beam: [new THREE.Vector3(px0 - 0.25, 0, pz1 - 0.1), new THREE.Vector3(px1 + 0.25, 0, pz1 - 0.1)],
      ledger: [new THREE.Vector3(px0 - 0.25, 0, HZ), new THREE.Vector3(px1 + 0.25, 0, HZ)],
      slope: 0.2,
      overhang: 0.35,
    });
    porchRoof.onCollapse = () => G.snowCover.remove(porchZone);
    // porch railings (choppable)
    const Y = this.Y0;
    this.makeRailingSegment(new THREE.Vector3(px0 + 0.1, Y, pz1 - 0.1), new THREE.Vector3(sx0 - 0.05, Y, pz1 - 0.1), 'Перила крыльца');
    this.makeRailingSegment(new THREE.Vector3(sx1 + 0.05, Y, pz1 - 0.1), new THREE.Vector3(px1 - 0.1, Y, pz1 - 0.1), 'Перила крыльца');
  }

  private makeWoodshed(rng: Rng) {
    // lean-to on the right side of the house with logs
    const T = G.terrain;
    const x0 = HX + 0.3, x1 = HX + 1.8;
    const z0 = -2.6, z1 = 1.6;
    const gy = T.heightAt((x0 + x1) / 2, (z0 + z1) / 2) - this.Y0;
    const shedZone = G.snowCover.add({ name: 'Крыша дровника', kind: 'roof', x: (x0+x1)/2+0.1, z: (z0+z1)/2, hx: Math.cos(0.35), hz: (z1-z0+0.6)/2, y: this.Y0+gy+2.9 });
    G.snowCover.add({ name: 'Настил дровника', kind: 'floor', x: (x0+x1)/2, z: (z0+z1)/2, hx: 0.65, hz: (z1-z0)/2, y: this.Y0+gy+0.06 });
    const shed = this.shedRoof('Дровник', {
      posts: [z0, z1].map((z) => {
        const g = T.heightAt(x1, z);
        return [new THREE.Vector3(x1, g - 0.45, z), new THREE.Vector3(x1, this.Y0 + gy + 2.3, z)];
      }),
      postKind: 'set',
      beam: [new THREE.Vector3(x1, 0, z0 - 0.3), new THREE.Vector3(x1, 0, z1 + 0.3)],
      ledger: [new THREE.Vector3(HX, 0, z0 - 0.3), new THREE.Vector3(HX, 0, z1 + 0.3)],
      slope: 0.35,
      overhang: 0.35,
    });
    shed.onCollapse = () => G.snowCover.remove(shedZone);
    this.solid(1.3, 0.06, z1 - z0, (x0 + x1) / 2, gy + 0.03, (z0 + z1) / 2, M.wood(), 1.2);
    const nLogs = rng.int(3, 6);
    const qLog = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    for (let i = 0; i < nLogs; i++) {
      const row = i % 3, layer = Math.floor(i / 3);
      G.entities.spawnItem('log', new THREE.Vector3((x0 + x1) / 2 - 0.3 + row * 0.3, this.Y0 + gy + 0.22 + layer * 0.28, (z0 + z1) / 2 - 0.2 + layer * 0.1), { quat: qLog, moisture: 0.15 });
    }
    const nFw = rng.int(0, 3);
    for (let i = 0; i < nFw; i++) G.entities.spawnItem('firewood', new THREE.Vector3((x0 + x1) / 2 + rng.float(-0.3, 0.3), this.Y0 + gy + 0.2 + i * 0.12, z1 - 0.5), { moisture: 0.12 });
    // chopping block
    const bx = 8.2, bz = 3.4;
    const by = T.heightAt(bx, bz);
    const block = G.entities.spawnItem('block', new THREE.Vector3(bx, by + 0.26, bz));
    block.moisture = 0.2;
    this.blockPos = new THREE.Vector3(bx, by + 0.52, bz);
  }

  blockPos = new THREE.Vector3();

  /**
   * A shed roof leaning on the house: posts, a beam on them, a ledger nailed to the
   * wall and boards from the wall down over the beam. Real pieces with their statics.
   */
  private shedRoof(name: string, o: { posts: THREE.Vector3[][]; postKind: 'set' | 'nail'; beam: THREE.Vector3[]; ledger: THREE.Vector3[]; slope: number; overhang: number }) {
    const S = G.build.structure(name);
    const rp = 0.07, rb = 0.075, rl = 0.065, bw = 0.32, bt = 0.03;
    const posts = o.posts.map(([a, b]) => {
      const e = G.build.part(S, makeRound('pine', 1, rp, rp * 0.9), a, b, { moisture: 0.12 });
      if (o.postKind === 'set') G.build.connect(S, e, { groundKind: 'set' });
      // set into a socket in the stone plinth under the porch floor
      else G.build.joint(S, e, 0.35, null, 0, 'set');
      return e;
    });
    const top = Math.max(...o.posts.map(([, b]) => b.y));
    const beamY = top + rb;
    const ba = o.beam[0].clone().setY(beamY), bb = o.beam[1].clone().setY(beamY);
    const beam = G.build.part(S, makeRound('pine', 1, rb, rb), ba, bb, { moisture: 0.12 });
    G.build.connect(S, beam);
    // the ledger on the wall, as high as the slope needs
    const mid = ba.clone().add(bb).multiplyScalar(0.5);
    const lm = o.ledger[0].clone().add(o.ledger[1]).multiplyScalar(0.5);
    const out = new THREE.Vector3(mid.x - lm.x, 0, mid.z - lm.z);
    const run = out.length() - rl;
    out.normalize();
    const ledgerTop = beamY + rb + Math.tan(o.slope) * run;
    const la = o.ledger[0].clone().addScaledVector(out, rl).setY(ledgerTop - rl), lb = o.ledger[1].clone().addScaledVector(out, rl).setY(ledgerTop - rl);
    const ledger = G.build.part(S, makeRound('pine', 1, rl, rl), la, lb, { moisture: 0.1 });
    const ll = la.distanceTo(lb);
    G.build.joint(S, ledger, 0.3, null, 0, 'nail', 6);
    G.build.joint(S, ledger, ll - 0.3, null, 0, 'nail', 6);
    // boards from the wall down over the beam
    const along = lb.clone().sub(la).setY(0);
    const width = along.length();
    along.normalize();
    const n = Math.ceil(width / bw);
    for (let i = 0; i < n; i++) {
      const t = -width / 2 + bw / 2 + i * bw;
      const hi = lm.clone().addScaledVector(along, t).addScaledVector(out, 0.03).setY(ledgerTop + bt / 2);
      const lo = mid.clone().addScaledVector(along, t).setY(beamY + rb + bt / 2);
      const dir = lo.clone().sub(hi).normalize();
      const e = G.build.part(S, makeSawn('spruce', 1, bw - 0.01, bt), hi, lo.clone().addScaledVector(dir, o.overhang), { moisture: 0.1, roof: bw });
      G.build.connect(S, e);
    }
    void posts;
    S.snow = 0.06;
    G.build.check(S, true);
    return S;
  }

  // ---------- furniture & loot ----------

  private put(id: string, x: number, ySurface: number, z: number, rotY = 0, opts: { moisture?: number; charges?: number; params?: Record<string, number>; tilt?: boolean } = {}) {
    const d = def(id);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
    if (opts.tilt) {
      // lay long tools flat
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
    }
    const hh = halfHeight(d.shape, q);
    return G.entities.spawnItem(id, new THREE.Vector3(x, this.Y0 + ySurface + hh + 0.01, z), { quat: q, moisture: opts.moisture ?? 0.05, charges: opts.charges, params: opts.params });
  }

  private furnish(rng: Rng) {
    const U = UPPER;
    // ground floor: kitchen & living
    this.put('table', 1.3, 0, -1.2);
    this.put('chair', 0.75, 0, -0.45, Math.PI + rng.float(-0.2, 0.2));
    this.put('chair', 1.85, 0, -0.45, Math.PI + rng.float(-0.2, 0.2));
    this.put('chair', 1.3, 0, -2.0, rng.float(-0.3, 0.3));
    const T = 0.76;
    this.put('lamp', 1.0, T, -1.35, 0, { charges: rng.int(25, 70) });
    this.put('book', 1.7, T, -1.0, rng.float(0, 3));
    if (rng.chance(0.6)) this.put('newspaper', 1.4, T, -1.5, rng.float(0, 3));

    this.put('cabinet', 0.85, 0, -3.42);
    this.put('cabinet', 2.15, 0, -3.42);
    const C = 0.9;
    this.put('pot', 0.55, C, -3.35);
    this.put('matches', 1.15, C, -3.3, rng.float(0, 3), { charges: rng.int(8, 16) });
    const foods = ['stew', 'beans', 'crackers', 'chocolate', 'stew', 'beans'];
    const nf = rng.int(2, 4);
    for (let i = 0; i < nf; i++) this.put(rng.pick(foods), 1.7 + i * 0.18, C, -3.4 + rng.float(-0.05, 0.1), rng.float(0, 3));
    this.put('tea', 2.5, C, -3.25);
    if (rng.chance(0.5)) this.put('tea', 2.6, C, -3.4);
    if (rng.chance(0.55)) this.put('lighter', 2.35, C, -3.5, 0, { charges: rng.int(5, 20) });
    this.put('bucket', 3.2, 0, -3.3);

    // wood box by the stove
    this.put('crate', -2.55, 0, -3.3);
    this.put('newspaper', -2.55, 0.4, -3.3, rng.float(0, 3));
    if (rng.chance(0.7)) this.put('kindling', -2.4, 0.42, -3.2, rng.float(0, 3));
    if (rng.chance(0.5)) this.put('firewood', -2.0, 0, -3.1, Math.PI / 2 + rng.float(-0.3, 0.3), { moisture: 0.08 });
    this.put('stool', -2.8, 0, -1.9);

    // shelf with books and kerosene
    this.put('shelf', -1.2, 0, -3.55);
    this.put('book', -1.45, 0.9, -3.55, 0.1);
    this.put('book', -1.15, 0.9, -3.55, -0.1);
    if (rng.chance(0.75)) this.put('kerosene', -0.85, 0.9, -3.55, 0, { charges: rng.int(30, 90) });
    if (rng.chance(0.5)) this.put('paper', -1.3, 0.96, -3.5);

    // workbench with tools
    this.put('workbench', 4.25, 0, 0.8, Math.PI / 2);
    const W = 0.86;
    this.put('hammer', 4.2, W, 0.1, rng.float(0, 3), { tilt: true });
    this.put('nails', 4.3, W, 0.45, rng.float(0, 3), { charges: rng.int(8, 20) });
    this.put('saw', 4.25, W, 1.1, 0);
    if (rng.chance(0.8)) this.put('knife', 4.35, W, 1.55, rng.float(0, 3));
    this.put('flashlight', 4.1, W, 1.45, rng.float(0, 3), { tilt: true, charges: rng.int(20, 80) });
    const axeInside = rng.chance(0.5);
    if (axeInside) this.put('axe', 4.2, W, 0.75, Math.PI / 2, { tilt: true });
    if (rng.chance(0.6)) this.put('prybar', 3.0, 0, 2.3, 0, { tilt: true });

    // by the door
    this.put('bench', -0.1, 0, 3.4);
    const B = 0.45;
    if (rng.chance(0.75)) this.put('ushanka', -0.5, B, 3.4);
    this.put(rng.chance(0.6) ? 'mittens' : 'gloves', 0.0, B, 3.4, rng.float(0, 3));
    if (rng.chance(0.5)) this.put('gloves', 0.25, B, 3.45, rng.float(0, 3));
    if (rng.chance(0.6)) this.put('scarf', 0.4, B, 3.35, rng.float(0, 3));
    const parkaDown = rng.chance(0.6);
    if (parkaDown) this.put('parka', -0.2, B + 0.03, 3.4, rng.float(-0.2, 0.2));
    this.put(rng.chance(0.55) ? 'valenki' : 'boots', 0.75, 0, 2.85, rng.float(0, 3));
    this.put('shovel', 2.65, 0, 3.5, 0, { tilt: true });
    this.put('auger', 3.65, 0, 3.35, 0, { tilt: true });
    this.put('rod', 4.2, 0, 2.6, 0.4, { tilt: true });

    // upstairs
    const bed = this.put('bed', 3.45, U, -2.95);
    bed.data.blankets = [];
    this.bed = bed;
    const b1 = G.entities.spawnItem('blanket', new THREE.Vector3(0, -50, 0), { params: { v: rng.int(0, 3) } });
    this.spreadOnBed(bed, b1);
    this.put('chest', 1.55, U, -3.25);
    this.put('blanket', 1.55, U + 0.5, -3.25, rng.float(-0.2, 0.2), { params: { v: rng.int(0, 3) } });
    if (rng.chance(0.7)) this.put('plaid', 1.55, U + 0.66, -3.25, rng.float(-0.3, 0.3), { params: { v: rng.int(0, 3) } });
    this.put('wardrobe', 4.45, U, 1.8, -Math.PI / 2);
    this.put('stool', 2.15, U, -2.2);
    this.put('book', 2.15, U + 0.46, -2.2, rng.float(0, 3));
    if (rng.chance(0.5)) this.put('chocolate', 2.2, U + 0.47, -2.05, rng.float(0, 3));
    const clothes = rng.shuffle(['thermals', 'sweater', 'padded_pants', 'wool_socks', 'beanie', 'wool_socks', 'thermals']);
    const nc = rng.int(3, 5);
    for (let i = 0; i < nc; i++) this.put(clothes[i], 3.6 + rng.float(-0.25, 0.25), U, 0.6 + i * 0.4, rng.float(0, 3));
    if (!parkaDown) this.put('parka', 3.7, U, 2.8, rng.float(0, 3));
    this.put('crate', -1.6, U, -3.3);
    this.put(rng.pick(['newspaper', 'book', 'paper']), -1.6, U + 0.4, -3.3, rng.float(0, 3));
    if (rng.chance(0.5)) this.put('blanket', -0.4, U, -3.2, rng.float(0, 3), { params: { v: rng.int(0, 3) } });

    // outside: axe or hatchet near the chopping block
    const bp = this.blockPos;
    if (!axeInside) G.entities.spawnItem('axe', new THREE.Vector3(bp.x + 0.1, bp.y + 0.1, bp.z), { quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.4, Math.PI / 2)) });
    else if (rng.chance(0.7)) G.entities.spawnItem('hatchet', new THREE.Vector3(bp.x, bp.y + 0.08, bp.z), { quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 1.2, Math.PI / 2)) });
  }

  // ---------- bed ----------

  spreadOnBed(bed: Entity, blanket: Entity) {
    if (blanket.inWorld) G.entities.removeFromWorld(blanket);
    const list: Entity[] = bed.data.blankets;
    list.push(blanket);
    const layer = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.035, 0.98), M.plaid((blanket.params.v ?? 0) + (blanket.defId === 'plaid' ? 2 : 0)));
    layer.position.set(0.18, 0.165 + list.length * 0.035, 0);
    layer.castShadow = layer.receiveShadow = true;
    layer.name = 'bedlayer';
    bed.obj!.add(layer);
    blanket.data.bedLayer = layer;
  }

  takeFromBed(bed: Entity): Entity | null {
    const list: Entity[] = bed.data.blankets;
    const b = list.pop();
    if (!b) return null;
    b.data.bedLayer?.removeFromParent();
    b.data.bedLayer = null;
    return b;
  }

  // ---------- queries ----------

  zoneAt(p: THREE.Vector3): 'ground' | 'upper' | null {
    if (this.ground.containsPoint(p)) return 'ground';
    if (this.upper.containsPoint(p)) return 'upper';
    return null;
  }

  update(dt: number) {
    this.updateDoor(dt);
    // frost grows on the glass from the room's moisture (see thermal model)
    this.windows.forEach((w, i) => {
      const d = w.data as WindowData;
      if (d.glass !== 'intact') return;
      const grams = G.thermal?.windowFrost[i] ?? 0;
      const frost = Math.min(1, grams / 25);
      const m = d.glassMesh.material as THREE.MeshStandardMaterial;
      m.opacity = 0.2 + frost * 0.62;
      m.color.setRGB(0.87 + frost * 0.13, 0.93 + frost * 0.07, 0.99);
      m.roughness = 0.15 + frost * 0.7;
    });
  }
}
