// Procedural forest: spruces, birches and dead trees. Trees can be felled and chopped.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { G, GROUPS_ITEM, GROUPS_STATIC, msg } from '../game/ctx';
import { Rng, Simplex2, clamp } from '../core/rng';
import { M, mat } from '../game/meshes';
import { Tex } from '../core/textures';
import { Entity } from '../game/entities';

export type TreeType = 'spruce' | 'birch' | 'dead';

export interface Tree {
  id: number;
  type: TreeType;
  variant: number;
  x: number;
  y: number;
  z: number;
  s: number;
  rotY: number;
  r: number; // trunk radius, m
  h: number; // height, m
  hp: number;
  maxHp: number;
  alive: boolean;
  index: number;
  collider: RAPIER_T.Collider | null;
  bark: number;
  boughs: number;
  twigs: number;
}

const BASE_H: Record<TreeType, number> = { spruce: 10, birch: 11, dead: 8 };
const BASE_R: Record<TreeType, number> = { spruce: 0.2, birch: 0.15, dead: 0.17 };

function colorize(g: THREE.BufferGeometry, fn: (y: number, x: number, z: number) => [number, number, number]) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const [r, gg, b] = fn(p.getY(i), p.getX(i), p.getZ(i));
    c[i * 3] = r;
    c[i * 3 + 1] = gg;
    c[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function spruceGeometry(variant: number, rng: Rng) {
  const H = BASE_H.spruce;
  const R = BASE_R.spruce;
  const trunk = new THREE.CylinderGeometry(R * 0.3, R, H, 7, 1);
  trunk.translate(0, H / 2, 0);
  const trunkUV = trunk.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < trunkUV.count; i++) trunkUV.setXY(i, trunkUV.getX(i) * 2, trunkUV.getY(i) * 6);
  const layers: THREE.BufferGeometry[] = [];
  const n = 7 + variant;
  const width = [2.3, 2.0, 2.6][variant % 3];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y0 = 1.4 + t * (H - 2.2);
    const rad = width * (1 - t * 0.85) * rng.float(0.9, 1.1);
    const h = 2.4 * (1 - t * 0.5);
    const c = new THREE.ConeGeometry(rad, h, 8, 2, false);
    c.rotateY(rng.float(0, Math.PI));
    c.translate(rng.float(-0.05, 0.05), y0 + h / 2, rng.float(-0.05, 0.05));
    // droop the base ring slightly
    const p = c.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      if (p.getY(k) < y0 + 0.01) p.setY(k, p.getY(k) - 0.25 - rng.float(0, 0.2));
    }
    colorize(c, (y) => {
      const local = (y - y0) / h;
      const snow = clamp((local - 0.15) * 2.2, 0, 1) * 0.85;
      const g = 0.16 + rng.float(-0.02, 0.02);
      return [g * 0.7 * (1 - snow) + snow * 0.92, g * 1.25 * (1 - snow) + snow * 0.95, g * 0.85 * (1 - snow) + snow];
    });
    c.computeVertexNormals();
    layers.push(c);
  }
  const top = new THREE.ConeGeometry(0.35, 1.4, 6);
  top.translate(0, H + 0.2, 0);
  colorize(top, () => [0.85, 0.88, 0.92]);
  layers.push(top);
  const foliage = mergeGeometries(layers.map((l) => l.toNonIndexed()));
  return { trunk, foliage };
}

function birchGeometry(rng: Rng) {
  const H = BASE_H.birch;
  const R = BASE_R.birch;
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(R * 0.35, R, H, 8, 1);
  trunk.translate(0, H / 2, 0);
  const uv = trunk.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 7);
  parts.push(trunk);
  for (let i = 0; i < 9; i++) {
    const y = H * rng.float(0.4, 0.92);
    const len = rng.float(1.2, 2.8) * (1.1 - y / H);
    const b = new THREE.CylinderGeometry(0.015, 0.045, len, 5, 1);
    b.translate(0, len / 2, 0);
    b.rotateZ(rng.float(0.5, 1.0));
    b.rotateY(rng.float(0, Math.PI * 2));
    b.translate(0, y, 0);
    parts.push(b);
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

function deadGeometry(rng: Rng) {
  const H = BASE_H.dead;
  const R = BASE_R.dead;
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(R * 0.45, R, H, 7, 1);
  trunk.translate(0, H / 2, 0);
  const uv = trunk.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 5);
  parts.push(trunk);
  for (let i = 0; i < 7; i++) {
    const y = H * rng.float(0.3, 0.9);
    const len = rng.float(0.4, 1.6);
    const b = new THREE.CylinderGeometry(0.02, 0.05, len, 4, 1);
    b.translate(0, len / 2, 0);
    b.rotateZ(rng.float(1.0, 1.5));
    b.rotateY(rng.float(0, Math.PI * 2));
    b.translate(0, y, 0);
    parts.push(b);
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

interface Kind {
  type: TreeType;
  variant: number;
  meshes: THREE.InstancedMesh[];
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
  trees: Tree[];
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

export class Forest {
  trees: Tree[] = [];
  byCollider = new Map<number, Tree>();
  private kinds: Kind[] = [];
  private body!: RAPIER_T.RigidBody;
  private stumps: THREE.Mesh[] = [];

  build(rng: Rng) {
    this.body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
    const foliageMat = mat('foliage', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
    for (let v = 0; v < 3; v++) {
      const g = spruceGeometry(v, rng);
      this.kinds.push({ type: 'spruce', variant: v, meshes: [], geos: [g.trunk, g.foliage], mats: [M.barkSpruce(), foliageMat], trees: [] });
    }
    for (let v = 0; v < 2; v++) this.kinds.push({ type: 'birch', variant: v, meshes: [], geos: [birchGeometry(rng)], mats: [M.barkBirch()], trees: [] });
    this.kinds.push({ type: 'dead', variant: 0, meshes: [], geos: [deadGeometry(rng)], mats: [M.barkDead()], trees: [] });

    // placement
    const noise = new Simplex2(() => rng.next());
    const T = G.terrain;
    const pts: Tree[] = [];
    const minD = 2.6;
    const grid = new Map<string, Tree[]>();
    const key = (x: number, z: number) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
    let tries = 0;
    while (pts.length < 620 && tries < 40000) {
      tries++;
      const x = rng.float(-108, 108);
      const z = rng.float(-108, 108);
      const r = Math.hypot(x, z);
      if (r > 110) continue;
      const dHouse = Math.hypot(x, z * 1.1);
      if (dHouse < 12) continue;
      if (x > 4 && x < 10 && z > -4 && z < 6) continue; // woodpile area
      const q = T.lakeQ(x, z);
      if (q < 1.12) continue;
      const dens = clamp(0.55 + noise.fbm(x * 0.03, z * 0.03, 3) * 0.9, 0.05, 1) * clamp((dHouse - 12) / 10, 0.25, 1) * clamp((q - 1.12) * 2.5, 0.2, 1);
      if (rng.next() > dens) continue;
      const k = key(x, z);
      let ok = true;
      for (let gx = -1; gx <= 1 && ok; gx++) for (let gz = -1; gz <= 1 && ok; gz++) {
        const cell = grid.get(`${Math.floor(x / 4) + gx},${Math.floor(z / 4) + gz}`);
        if (cell) for (const t of cell) if (Math.hypot(t.x - x, t.z - z) < minD) ok = false;
      }
      if (!ok) continue;
      const roll = rng.next();
      const type: TreeType = roll < 0.72 ? 'spruce' : roll < 0.9 ? 'birch' : 'dead';
      const s = type === 'spruce' ? rng.float(0.45, 1.35) : type === 'birch' ? rng.float(0.55, 1.15) : rng.float(0.6, 1.2);
      const kinds = this.kinds.filter((kk) => kk.type === type);
      const kind = rng.pick(kinds);
      const y = T.heightAt(x, z) - 0.15;
      const tree: Tree = {
        id: pts.length, type, variant: kind.variant, x, y, z, s, rotY: rng.float(0, Math.PI * 2),
        r: BASE_R[type] * s, h: BASE_H[type] * s, hp: 0, maxHp: 0, alive: true, index: kind.trees.length,
        collider: null, bark: type === 'birch' ? 3 : 0, boughs: type === 'spruce' ? 4 : 0, twigs: type === 'dead' ? 4 : 2,
      };
      tree.maxHp = tree.hp = Math.round(3 + tree.r * 80);
      kind.trees.push(tree);
      pts.push(tree);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(tree);
    }
    this.trees = pts;

    for (const kind of this.kinds) {
      for (let gi = 0; gi < kind.geos.length; gi++) {
        const im = new THREE.InstancedMesh(kind.geos[gi], kind.mats[gi], Math.max(1, kind.trees.length));
        im.castShadow = true;
        im.receiveShadow = true;
        im.count = kind.trees.length;
        for (const t of kind.trees) {
          tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rotY);
          tmpM.compose(tmpP.set(t.x, t.y, t.z), tmpQ, tmpS.setScalar(t.s));
          im.setMatrixAt(t.index, tmpM);
        }
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.userData.forestKind = kind;
        G.scene.add(im);
        kind.meshes.push(im);
      }
      for (const t of kind.trees) {
        const col = G.world.createCollider(
          G.R.ColliderDesc.cylinder(t.h * 0.5, Math.max(0.08, t.r * 0.9)).setTranslation(t.x, t.y + t.h * 0.5, t.z).setCollisionGroups(GROUPS_STATIC),
          this.body,
        );
        t.collider = col;
        this.byCollider.set(col.handle, t);
      }
    }

    this.scatter(rng);
  }

  /** sticks, fallen logs and rocks on the forest floor */
  private scatter(rng: Rng) {
    const T = G.terrain;
    let placed = 0;
    for (let i = 0; i < 400 && placed < 70; i++) {
      const t = rng.pick(this.trees);
      const a = rng.float(0, Math.PI * 2);
      const d = rng.float(1, 3);
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      if (T.lakeQ(x, z) < 1.05) continue;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.float(0, 6));
      G.entities.spawnItem('sticks', new THREE.Vector3(x, T.heightAt(x, z) + 0.05, z), { quat: q, sleep: true, moisture: rng.float(0.15, 0.4) });
      placed++;
    }
    // a few dead logs lying around
    for (let i = 0; i < 8; i++) {
      const t = rng.pick(this.trees);
      const x = t.x + rng.float(-3, 3), z = t.z + rng.float(-3, 3);
      if (T.lakeQ(x, z) < 1.1 || Math.hypot(x, z) < 10) continue;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.float(0, 6));
      G.entities.spawnItem('log', new THREE.Vector3(x, T.heightAt(x, z) + 0.2, z), { quat: q, sleep: true, moisture: 0.3, params: { dead: 1 } });
    }
    // rocks: static decoration with colliders
    const rockMat = mat('rock', () => new THREE.MeshStandardMaterial({ map: Tex.stone(), color: 0x9a9a9a, roughness: 1, flatShading: true }));
    for (let i = 0; i < 45; i++) {
      const x = rng.float(-100, 100), z = rng.float(-100, 100);
      if (Math.hypot(x, z) < 14 || T.lakeQ(x, z) < 1.05) continue;
      const s = rng.float(0.3, 1.4);
      const g = new THREE.IcosahedronGeometry(s, 0);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) * rng.float(0.8, 1.3), p.getY(k) * 0.6, p.getZ(k) * rng.float(0.8, 1.3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, rockMat);
      const y = T.heightAt(x, z) - s * 0.15;
      m.position.set(x, y, z);
      m.rotation.y = rng.float(0, 6);
      m.castShadow = m.receiveShadow = true;
      G.scene.add(m);
      // snow cap
      const cap = new THREE.Mesh(new THREE.SphereGeometry(s * 0.95, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.6), M.snow());
      cap.scale.set(1.05, 0.45, 1.05);
      cap.position.set(x, y + s * 0.3, z);
      cap.receiveShadow = true;
      G.scene.add(cap);
      G.world.createCollider(G.R.ColliderDesc.ball(s * 0.75).setTranslation(x, y, z).setCollisionGroups(GROUPS_STATIC), this.body);
    }
  }

  kindOf(t: Tree) {
    return this.kinds.find((k) => k.type === t.type && k.variant === t.variant)!;
  }

  /** Fell a tree: hide the instance and spawn a falling trunk entity. */
  fell(t: Tree, away: THREE.Vector3) {
    if (!t.alive) return;
    t.alive = false;
    const kind = this.kindOf(t);
    tmpM.compose(tmpP.set(t.x, -1000, t.z), tmpQ.identity(), tmpS.setScalar(0.0001));
    for (const im of kind.meshes) {
      im.setMatrixAt(t.index, tmpM);
      im.instanceMatrix.needsUpdate = true;
    }
    if (t.collider) {
      this.byCollider.delete(t.collider.handle);
      G.world.removeCollider(t.collider, true);
      t.collider = null;
    }
    // stump
    const stumpH = 0.4;
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.95, t.r * 1.05, stumpH, 8), [M.barkSpruce(), M.woodEnd(), M.woodEnd()]);
    if (t.type === 'birch') stump.material = [M.barkBirch(), M.woodEnd(), M.woodEnd()];
    stump.position.set(t.x, t.y + stumpH / 2, t.z);
    stump.castShadow = stump.receiveShadow = true;
    G.scene.add(stump);
    this.stumps.push(stump);
    G.world.createCollider(G.R.ColliderDesc.cylinder(stumpH / 2, t.r).setTranslation(t.x, t.y + stumpH / 2, t.z).setCollisionGroups(GROUPS_STATIC), this.body);

    // trunk entity
    const e = new Entity('trunk');
    e.name = t.type === 'spruce' ? 'Поваленная ель' : t.type === 'birch' ? 'Поваленная берёза' : 'Поваленный сухостой';
    const len = t.h - stumpH;
    e.data = { len, r: t.r, type: t.type, mass: Math.PI * t.r * t.r * t.h * 520 };
    e.maxHp = e.hp = Math.round(4 + len * t.r * 6 + len * 0.4);
    e.moisture = t.type === 'dead' ? 0.12 : 0.45;
    const g = new THREE.Group();
    for (let gi = 0; gi < kind.geos.length; gi++) {
      const m = new THREE.Mesh(kind.geos[gi], kind.mats[gi]);
      m.castShadow = m.receiveShadow = true;
      m.scale.setScalar(t.s);
      m.rotation.y = t.rotY;
      m.position.y = -t.h / 2 - stumpH / 2;
      g.add(m);
    }
    g.userData.entity = e;
    e.obj = g;
    G.scene.add(g);
    const cy = t.y + stumpH + len / 2 + 0.05;
    const body = G.world.createRigidBody(
      G.R.RigidBodyDesc.dynamic().setTranslation(t.x, cy, t.z).setAngularDamping(0.4).setLinearDamping(0.2),
    );
    const col = G.world.createCollider(
      G.R.ColliderDesc.cylinder(len / 2, Math.max(0.08, t.r * 0.9)).setMass(e.data.mass).setFriction(1).setCollisionGroups(GROUPS_ITEM),
      body,
    );
    e.body = body;
    G.entities.registerStatic(e, [col]);
    // tip over: angular velocity around the axis perpendicular to fall direction
    const dir = away.clone().setY(0).normalize();
    const axis = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    body.setAngvel({ x: axis.x * 0.35, y: 0, z: axis.z * 0.35 }, true);
    body.applyImpulseAtPoint({ x: dir.x * e.data.mass * 0.6, y: 0, z: dir.z * e.data.mass * 0.6 }, { x: t.x, y: cy + len * 0.45, z: t.z }, true);
    G.audio.play('tree_fall', { pos: new THREE.Vector3(t.x, t.y + 2, t.z) });
    msg(`${t.type === 'spruce' ? 'Ель' : t.type === 'birch' ? 'Берёза' : 'Сухостой'} падает!`, 'good');
    return e;
  }

  /** Yields when a fallen trunk is fully processed. */
  trunkYields(e: Entity) {
    const { len, r, type } = e.data;
    const out: { id: string; n: number; params?: Record<string, number> }[] = [];
    const p: Record<string, number> = type === 'birch' ? { birch: 1 } : type === 'dead' ? { dead: 1 } : {};
    if (r < 0.11) {
      out.push({ id: 'firewood', n: Math.max(1, Math.round(len / 2)), params: p });
      out.push({ id: 'sticks', n: 3 });
    } else {
      out.push({ id: 'log', n: clamp(Math.floor((len * 0.75) / 1.2), 1, 8), params: p });
      out.push({ id: 'sticks', n: 2 });
    }
    if (type === 'spruce') out.push({ id: 'boughs', n: 3 });
    if (type === 'birch') out.push({ id: 'bark', n: 2 });
    return out;
  }

  isTreeTarget(handle: number) {
    return this.byCollider.get(handle) ?? null;
  }
}
