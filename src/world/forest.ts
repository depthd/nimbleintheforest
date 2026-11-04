// Procedural forest: spruces, birches and dead trees. Trees can be felled and chopped.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Props } from '../gen/region';
import { Sp } from '../gen/biomes';
import { makeGroundMaterial } from './terrain';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { G, GROUPS_ITEM, GROUPS_STATIC, msg } from '../game/ctx';
import { Rng, Simplex2, clamp } from '../core/rng';
import { M, mat } from '../game/meshes';
import { Tex } from '../core/textures';
import { Entity } from '../game/entities';

export type TreeType = 'spruce' | 'birch' | 'dead' | 'pine' | 'burnt';

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

const BASE_H: Record<'spruce' | 'birch' | 'dead', number> = { spruce: 10, birch: 11, dead: 8 };
const BASE_R: Record<'spruce' | 'birch' | 'dead', number> = { spruce: 0.2, birch: 0.15, dead: 0.17 };

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

/** a crown of fine winter twigs: crossed alpha planes */
function twigCrown(rng: Rng, y0: number, y1: number, w: number) {
  const parts: THREE.BufferGeometry[] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(w * rng.float(0.85, 1.1), y1 - y0);
    g.translate(0, (y0 + y1) / 2, 0);
    g.rotateY((i / n) * Math.PI + rng.float(-0.15, 0.15));
    parts.push(g);
  }
  return mergeGeometries(parts);
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
const UP = new THREE.Vector3(0, 1, 0);

const R0 = 240; // trees drawn within this radius
const RC = 45; // colliders within this radius

export class Forest {
  trees: Tree[] = [];
  byCollider = new Map<number, Tree>();
  private kinds: Kind[] = [];
  private body!: RAPIER_T.RigidBody;
  private stumps: THREE.Mesh[] = [];
  private P!: Props;
  private rocksP!: Props;
  private state = new Map<number, Tree>();
  private colliders = new Map<number, RAPIER_T.Collider>();
  private rockCols = new Map<number, RAPIER_T.Collider>();
  private center = new THREE.Vector3(1e9, 0, 1e9);
  private colCenter = new THREE.Vector3(1e9, 0, 1e9);
  private kindOfSp: number[][] = [];
  private rockMesh!: THREE.InstancedMesh;

  build(rng: Rng) {
    const R = G.region;
    this.P = R.trees;
    this.rocksP = R.rocks;
    this.body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
    const foliageMat = mat('foliage', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    for (let v = 0; v < 3; v++) {
      const g = spruceGeometry(v, rng);
      this.kinds.push({ type: 'spruce', variant: v, meshes: [], geos: [g.trunk, g.foliage], mats: [M.barkSpruce(), foliageMat], trees: [] });
    }
    const twigMat = mat('twigs', () => new THREE.MeshStandardMaterial({ map: Tex.twigs(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }));
    for (let v = 0; v < 2; v++) this.kinds.push({ type: 'birch', variant: v, meshes: [], geos: [birchGeometry(rng), twigCrown(rng, 3.2 + v, 11.8, 4.6 - v)], mats: [M.barkBirch(), twigMat], trees: [] });
    this.kinds.push({ type: 'dead', variant: 0, meshes: [], geos: [deadGeometry(rng)], mats: [M.barkDead()], trees: [] });
    const burntMat = mat('barkBurnt', () => new THREE.MeshStandardMaterial({ map: Tex.barkBurnt(), roughness: 1 }));
    this.kinds.push({ type: 'burnt', variant: 0, meshes: [], geos: [deadGeometry(rng)], mats: [burntMat], trees: [] });
    const pineMat = mat('barkPine', () => new THREE.MeshStandardMaterial({ map: Tex.barkPine(), roughness: 1 }));
    const pg = spruceGeometry(1, rng);
    this.kinds.push({ type: 'pine', variant: 0, meshes: [], geos: [pg.trunk, pg.foliage], mats: [pineMat, foliageMat], trees: [] });
    // species → kind indices (see gen/biomes Sp)
    this.kindOfSp = [[0, 1, 2], [7], [3, 4], [5], [6], [0, 1, 2]];
    for (const kind of this.kinds) {
      for (let gi = 0; gi < kind.geos.length; gi++) {
        const im = new THREE.InstancedMesh(kind.geos[gi], kind.mats[gi], 4000);
        im.castShadow = true;
        im.receiveShadow = true;
        im.count = 0;
        im.frustumCulled = false;
        im.userData.forestKind = kind;
        G.scene.add(im);
        kind.meshes.push(im);
      }
    }
    // boulders: smooth, snow settles on top (ground shader)
    const rg = new THREE.IcosahedronGeometry(1, 2);
    const rp = rg.attributes.position as THREE.BufferAttribute;
    const nz = new Simplex2(() => rng.next());
    const merged = mergeVertices(rg);
    const mp = merged.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < mp.count; k++) {
      const x = mp.getX(k), y = mp.getY(k), z = mp.getZ(k);
      const f = 1 + 0.22 * nz.noise(x * 1.7 + 3, z * 1.7 + y) + 0.08 * nz.noise(x * 4, y * 4 + z);
      mp.setXYZ(k, x * f * 1.15, y * f * 0.7, z * f);
    }
    void rp;
    merged.computeVertexNormals();
    this.rockMesh = new THREE.InstancedMesh(merged, makeGroundMaterial(false), 3000);
    this.rockMesh.castShadow = true;
    this.rockMesh.receiveShadow = true;
    this.rockMesh.count = 0;
    this.rockMesh.frustumCulled = false;
    G.scene.add(this.rockMesh);
    // rock pillars: landmarks seen from far away
    for (const p of R.pillars) {
      const g = new THREE.CylinderGeometry(p.r * 0.75, p.r, p.h, 14, 10, false);
      const gp = g.attributes.position as THREE.BufferAttribute;
      const pn = new Simplex2(() => ((p.seed % 1000) / 1000));
      for (let k = 0; k < gp.count; k++) {
        const x = gp.getX(k), y = gp.getY(k), z = gp.getZ(k);
        const a = Math.atan2(z, x);
        const f = 1 + 0.28 * pn.noise(Math.cos(a) * 1.3, y / 6) + 0.12 * pn.noise(a * 3, y / 2);
        gp.setXYZ(k, x * f, y, z * f);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, makeGroundMaterial(false));
      m.position.set(p.x, p.y + p.h / 2 - 1, p.z);
      m.castShadow = m.receiveShadow = true;
      G.scene.add(m);
      G.world.createCollider(G.R.ColliderDesc.cylinder(p.h / 2, p.r * 0.85).setTranslation(p.x, p.y + p.h / 2 - 1, p.z).setCollisionGroups(GROUPS_STATIC), this.body);
    }
    this.scatter(rng);
  }

  /** the Tree record for prop index i (created on first use) */
  private tree(i: number): Tree {
    let t = this.state.get(i);
    if (t) return t;
    const P = this.P;
    const sp = P.kind[i];
    const ks = this.kindOfSp[sp];
    const kindIdx = ks[Math.min(ks.length - 1, P.variant[i])];
    const kind = this.kinds[kindIdx];
    const type = kind.type;
    const s = P.s[i] * (sp === Sp.Pine ? 1.15 : 1);
    const baseType: 'spruce' | 'birch' | 'dead' = type === 'birch' ? 'birch' : type === 'spruce' || type === 'pine' ? 'spruce' : 'dead';
    t = {
      id: i, type, variant: kind.variant, x: P.x[i], y: P.y[i] - 0.15, z: P.z[i], s, rotY: P.rot[i],
      r: BASE_R[baseType] * s, h: BASE_H[baseType] * s, hp: 0, maxHp: 0, alive: (P.flags[i] & 3) === 0, index: kindIdx,
      collider: null, bark: type === 'birch' ? 3 : 0, boughs: type === 'spruce' || type === 'pine' ? 4 : 0, twigs: type === 'dead' || type === 'burnt' ? 4 : 2,
    };
    t.maxHp = t.hp = Math.round(3 + t.r * 80);
    this.state.set(i, t);
    return t;
  }

  /** trees near a point (records), for tests and spawning */
  treesNear(x: number, z: number, r: number): Tree[] {
    const out: Tree[] = [];
    G.region.forEachProp(this.P, x, z, r, (i) => {
      if ((this.P.flags[i] & 3) === 0) out.push(this.tree(i));
    });
    return out;
  }

  /** Rebuild the visible instances and colliders around the player. */
  update(p: THREE.Vector3, force = false) {
    const R = G.region;
    const P = this.P;
    if (force || Math.hypot(p.x - this.center.x, p.z - this.center.z) > 14) {
      this.center.copy(p);
      for (const k of this.kinds) for (const im of k.meshes) im.count = 0;
      R.forEachProp(P, p.x, p.z, R0, (i) => {
        if (P.flags[i] & 3) return;
        const sp = P.kind[i];
        const ks = this.kindOfSp[sp];
        const kind = this.kinds[ks[Math.min(ks.length - 1, P.variant[i])]];
        const s = P.s[i] * (sp === Sp.Pine ? 1.15 : 1) * (sp === Sp.Dwarf ? 0.55 : 1);
        tmpQ.setFromAxisAngle(UP, P.rot[i]);
        tmpM.compose(tmpP.set(P.x[i], P.y[i] - 0.15, P.z[i]), tmpQ, sp === Sp.Pine ? tmpS.set(s * 0.8, s * 1.25, s * 0.8) : tmpS.setScalar(s));
        for (const im of kind.meshes) {
          if (im.count >= im.instanceMatrix.count) continue;
          im.setMatrixAt(im.count++, tmpM);
        }
      });
      for (const k of this.kinds) for (const im of k.meshes) im.instanceMatrix.needsUpdate = true;
      const RP = this.rocksP;
      this.rockMesh.count = 0;
      R.forEachProp(RP, p.x, p.z, 320, (i) => {
        if (this.rockMesh.count >= 3000) return;
        tmpQ.setFromAxisAngle(UP, RP.rot[i]);
        const s = RP.s[i];
        tmpM.compose(tmpP.set(RP.x[i], RP.y[i] - s * 0.25, RP.z[i]), tmpQ, tmpS.setScalar(s));
        this.rockMesh.setMatrixAt(this.rockMesh.count++, tmpM);
      });
      this.rockMesh.instanceMatrix.needsUpdate = true;
    }
    if (force || Math.hypot(p.x - this.colCenter.x, p.z - this.colCenter.z) > 6) {
      this.colCenter.copy(p);
      const want = new Set<number>();
      R.forEachProp(P, p.x, p.z, RC, (i) => {
        if (P.flags[i] & 3) return;
        want.add(i);
        if (this.colliders.has(i)) return;
        const t = this.tree(i);
        const col = G.world.createCollider(
          G.R.ColliderDesc.cylinder(t.h * 0.5, Math.max(0.08, t.r * 0.9)).setTranslation(t.x, t.y + t.h * 0.5, t.z).setCollisionGroups(GROUPS_STATIC),
          this.body,
        );
        t.collider = col;
        this.colliders.set(i, col);
        this.byCollider.set(col.handle, t);
      });
      for (const [i, col] of this.colliders) {
        if (want.has(i)) continue;
        this.byCollider.delete(col.handle);
        G.world.removeCollider(col, false);
        this.colliders.delete(i);
        const t = this.state.get(i);
        if (t) t.collider = null;
      }
      const RP = this.rocksP;
      const wantR = new Set<number>();
      R.forEachProp(RP, p.x, p.z, RC, (i) => {
        wantR.add(i);
        if (this.rockCols.has(i)) return;
        const s = RP.s[i];
        const col = G.world.createCollider(G.R.ColliderDesc.ball(s * 0.72).setTranslation(RP.x[i], RP.y[i] - s * 0.25, RP.z[i]).setCollisionGroups(GROUPS_STATIC), this.body);
        this.rockCols.set(i, col);
      });
      for (const [i, col] of this.rockCols) {
        if (wantR.has(i)) continue;
        G.world.removeCollider(col, false);
        this.rockCols.delete(i);
      }
      this.trees = [...this.colliders.keys()].map((i) => this.tree(i));
    }
  }

  /** sticks and fallen logs around the house so the start isn't empty-handed */
  private scatter(rng: Rng) {
    const T = G.terrain;
    const near = this.treesNear(0, 0, 140).filter((t) => Math.hypot(t.x, t.z) > 14);
    let placed = 0;
    for (let i = 0; i < 400 && placed < 60 && near.length; i++) {
      const t = rng.pick(near);
      const a = rng.float(0, Math.PI * 2);
      const d = rng.float(1, 3);
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      if (!Number.isNaN(G.region.waterAt(x, z))) continue;
      const q = new THREE.Quaternion().setFromAxisAngle(UP, rng.float(0, 6));
      G.entities.spawnItem('sticks', new THREE.Vector3(x, T.heightAt(x, z) + 0.05, z), { quat: q, sleep: true, moisture: rng.float(0.15, 0.4) });
      placed++;
    }
    for (let i = 0; i < 8 && near.length; i++) {
      const t = rng.pick(near);
      const x = t.x + rng.float(-3, 3), z = t.z + rng.float(-3, 3);
      if (!Number.isNaN(G.region.waterAt(x, z)) || Math.hypot(x, z) < 10) continue;
      const q = new THREE.Quaternion().setFromAxisAngle(UP, rng.float(0, 6));
      G.entities.spawnItem('log', new THREE.Vector3(x, T.heightAt(x, z) + 0.2, z), { quat: q, sleep: true, moisture: 0.3, params: { dead: 1 } });
    }
  }

  kindOf(t: Tree) {
    return this.kinds[t.index];
  }

  /** Fell a tree: hide the instance and spawn a falling trunk entity. */
  fell(t: Tree, away: THREE.Vector3) {
    if (!t.alive) return;
    t.alive = false;
    const kind = this.kindOf(t);
    this.P.flags[t.id] |= 2;
    if (t.collider) {
      this.byCollider.delete(t.collider.handle);
      G.world.removeCollider(t.collider, true);
      this.colliders.delete(t.id);
      t.collider = null;
    }
    this.update(G.player.pos, true);
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
    e.name = { spruce: 'Поваленная ель', pine: 'Поваленная сосна', birch: 'Поваленная берёза', dead: 'Поваленный сухостой', burnt: 'Обгорелый ствол' }[t.type];
    const len = t.h - stumpH;
    e.data = { len, r: t.r, type: t.type, mass: Math.PI * t.r * t.r * t.h * 520 };
    e.maxHp = e.hp = Math.round(4 + len * t.r * 6 + len * 0.4);
    e.moisture = t.type === 'dead' || t.type === 'burnt' ? 0.1 : 0.45;
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
    msg(`${{ spruce: 'Ель', pine: 'Сосна', birch: 'Берёза', dead: 'Сухостой', burnt: 'Обгорелый ствол' }[t.type]} падает!`, 'good');
    return e;
  }

  /** Yields when a fallen trunk is fully processed. */
  trunkYields(e: Entity) {
    const { len, r, type } = e.data;
    const out: { id: string; n: number; params?: Record<string, number> }[] = [];
    const p: Record<string, number> = type === 'birch' ? { birch: 1 } : type === 'dead' || type === 'burnt' ? { dead: 1 } : {};
    if (r < 0.11) {
      out.push({ id: 'firewood', n: Math.max(1, Math.round(len / 2)), params: p });
      out.push({ id: 'sticks', n: 3 });
    } else {
      out.push({ id: 'log', n: clamp(Math.floor((len * 0.75) / 1.2), 1, 8), params: p });
      out.push({ id: 'sticks', n: 2 });
    }
    if (type === 'spruce' || type === 'pine') out.push({ id: 'boughs', n: 3 });
    if (type === 'birch') out.push({ id: 'bark', n: 2 });
    return out;
  }

  isTreeTarget(handle: number) {
    return this.byCollider.get(handle) ?? null;
  }
}
