// Procedural forest: spruces, pines, birches and dead trees.
//
// Trees are drawn as instances until someone works on one. Then it gets a real stem
// (a wood piece) and its own mesh: every blow notches the stem where it lands, and
// the tree falls when what is left of the cross-section can't hold it (see
// game/wood/felling). It tips over the hinge toward the side the load leans to,
// leaves a stump of the height you cut at and lands as a trunk with its branches.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Props } from '../gen/region';
import { Sp } from '../gen/biomes';
import { makeGroundMaterial } from './terrain';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { G, GROUPS_FALLING, GROUPS_ITEM, GROUPS_STATIC, GROUPS_TREE, msg } from '../game/ctx';
import { Rng, Simplex2, clamp } from '../core/rng';
import { M, mat } from '../game/meshes';
import { Tex } from '../core/textures';
import { Entity } from '../game/entities';
import type { CrownSource } from '../game/wood/mesh';
import { barkMaterial, endMaterial, roundGeometry } from '../game/wood/mesh';
import { chop, cutAt, makeRound, sectionAt, Whorl, WoodPiece } from '../game/wood/piece';
import { attachColliders, branchPiece, spawnPiece, tip } from '../game/wood/wood';
import { fellCheck, FellState } from '../game/wood/felling';
import type { Species } from '../game/wood/species';

export type TreeType = 'spruce' | 'birch' | 'dead' | 'pine' | 'burnt';

export interface Tree {
  id: number;
  type: TreeType;
  variant: number;
  x: number;
  y: number;
  z: number;
  /** horizontal and vertical scale of the kind's model */
  sx: number;
  sy: number;
  rotY: number;
  r: number; // trunk radius at the base, m
  h: number; // height, m
  alive: boolean;
  index: number;
  collider: RAPIER_T.Collider | null;
  bark: number;
  /** natural lean, rad, and the direction it leans to (world azimuth) */
  lean: number;
  leanDir: number;
  /** the real stem, once someone has worked on the tree */
  stem: WoodPiece | null;
  obj: THREE.Group | null;
  warned: boolean;
}

export const TREE_NAMES: Record<TreeType, string> = { spruce: 'Ель', pine: 'Сосна', birch: 'Берёза', dead: 'Сухостой', burnt: 'Обгорелый ствол' };
const SPECIES_OF: Record<TreeType, Species> = { spruce: 'spruce', pine: 'pine', birch: 'birch', dead: 'dead', burnt: 'burnt' };

/** A part of a crown: a spruce whorl or a band of birch branches. Unscaled tree space. */
interface Band {
  y0: number;
  y1: number;
  rad: number;
  bark: THREE.BufferGeometry | null;
  leaf: THREE.BufferGeometry | null;
  branches: { len: number; r: number }[];
  /** kg of needles per metre of branch */
  needles: number;
}

interface Kind {
  type: TreeType;
  variant: number;
  H: number;
  R: number;
  /** top radius as a fraction of the base */
  top: number;
  bands: Band[];
  meshes: THREE.InstancedMesh[];
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
}

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

function stemGeometry(H: number, R: number, top: number, seg: number, around: number, along: number) {
  const trunk = new THREE.CylinderGeometry(R * top, R, H, seg, 1);
  trunk.translate(0, H / 2, 0);
  const uv = trunk.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * along);
  return trunk.toNonIndexed();
}

function spruceBands(variant: number, rng: Rng, H: number): Band[] {
  const bands: Band[] = [];
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
    let leaf = c.toNonIndexed();
    if (i === n - 1) {
      const topCone = new THREE.ConeGeometry(0.35, 1.4, 6);
      topCone.translate(0, H + 0.2, 0);
      colorize(topCone, () => [0.85, 0.88, 0.92]);
      leaf = mergeGeometries([leaf, topCone.toNonIndexed()])!;
    }
    const count = i < n / 2 ? 6 : 4;
    const branches = Array.from({ length: count }, () => ({ len: rad * rng.float(0.85, 1.0), r: 0.011 + 0.008 * rad }));
    bands.push({ y0: y0 - 0.4, y1: y0 + h * 0.55, rad, bark: null, leaf, branches, needles: 0.55 });
  }
  return bands;
}

/** a crown of fine winter twigs: crossed alpha planes */
function twigCrown(rng: Rng, y0: number, y1: number, w: number) {
  const parts: THREE.BufferGeometry[] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(w * rng.float(0.85, 1.1), y1 - y0);
    g.translate(0, (y0 + y1) / 2, 0);
    g.rotateY((i / n) * Math.PI + rng.float(-0.15, 0.15));
    parts.push(g.toNonIndexed());
  }
  return mergeGeometries(parts)!;
}

/** branches as cylinders at heights in [lo, hi] of H, grouped into bands */
function branchBands(rng: Rng, H: number, count: number, lo: number, hi: number, len: [number, number], tilt: [number, number], nb: number, twigs: { y0: number; y1: number; w: number } | null, rBase: number): Band[] {
  const items: { y: number; len: number; geo: THREE.BufferGeometry }[] = [];
  for (let i = 0; i < count; i++) {
    const y = H * rng.float(lo, hi);
    const l = rng.float(len[0], len[1]) * (twigs ? 1.1 - y / H : 1);
    const b = new THREE.CylinderGeometry(0.015, 0.045, l, 5, 1);
    b.translate(0, l / 2, 0);
    b.rotateZ(rng.float(tilt[0], tilt[1]));
    b.rotateY(rng.float(0, Math.PI * 2));
    b.translate(0, y, 0);
    items.push({ y, len: l, geo: b.toNonIndexed() });
  }
  const y0 = twigs ? twigs.y0 : H * lo - 0.2;
  const y1 = twigs ? twigs.y1 : H * hi + 0.6;
  const bands: Band[] = [];
  for (let k = 0; k < nb; k++) {
    const b0 = y0 + ((y1 - y0) * k) / nb, b1 = y0 + ((y1 - y0) * (k + 1)) / nb;
    const mine = items.filter((it) => it.y >= b0 && (it.y < b1 || k === nb - 1));
    const branches = mine.map((it) => ({ len: it.len, r: rBase }));
    // fine twigs that are not modelled one by one
    for (let j = 0; j < 2; j++) branches.push({ len: rng.float(0.5, 1.0), r: 0.01 });
    bands.push({
      y0: b0, y1: b1, rad: Math.max(0.5, ...mine.map((it) => it.len * 0.8)),
      bark: mine.length ? mergeGeometries(mine.map((it) => it.geo))! : null,
      leaf: twigs ? twigCrown(rng, b0, b1, twigs.w) : null,
      branches, needles: 0,
    });
  }
  return bands;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** piece axis (+X) to world up */
const STAND = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

const R0 = 240; // trees drawn within this radius
const RC = 45; // colliders within this radius

interface Falling {
  e: Entity;
  joint: RAPIER_T.ImpulseJoint | null;
  age: number;
  hitPlayer: boolean;
  landed: boolean;
}

export class Forest {
  trees: Tree[] = [];
  byCollider = new Map<number, Tree>();
  private kinds: Kind[] = [];
  private body!: RAPIER_T.RigidBody;
  private P!: Props;
  private rocksP!: Props;
  private state = new Map<number, Tree>();
  private colliders = new Map<number, RAPIER_T.Collider>();
  private rockCols = new Map<number, RAPIER_T.Collider>();
  private center = new THREE.Vector3(1e9, 0, 1e9);
  private colCenter = new THREE.Vector3(1e9, 0, 1e9);
  private kindOfSp: number[][] = [];
  private rockMesh!: THREE.InstancedMesh;
  /** trees drawn on their own (being worked on) */
  private active = new Map<number, Tree>();
  private falling: Falling[] = [];

  build(rng: Rng) {
    const R = G.region;
    this.P = R.trees;
    this.rocksP = R.rocks;
    this.body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
    const foliageMat = mat('foliage', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    const twigMat = mat('twigs', () => new THREE.MeshStandardMaterial({ map: Tex.twigs(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }));
    const burntMat = mat('barkBurnt', () => new THREE.MeshStandardMaterial({ map: Tex.barkBurnt(), roughness: 1 }));
    const pineMat = mat('barkPine', () => new THREE.MeshStandardMaterial({ map: Tex.barkPine(), roughness: 1 }));
    const kind = (type: TreeType, variant: number, H: number, R: number, top: number, bands: Band[], bark: THREE.Material, leaf: THREE.Material | null, seg: number, along: number) => {
      const stem = stemGeometry(H, R, top, seg, 2, along);
      const barkGeo = mergeGeometries([stem, ...bands.filter((b) => b.bark).map((b) => b.bark!)])!;
      const geos = [barkGeo];
      const mats = [bark];
      if (leaf) {
        geos.push(mergeGeometries(bands.filter((b) => b.leaf).map((b) => b.leaf!))!);
        mats.push(leaf);
      }
      this.kinds.push({ type, variant, H, R, top, bands, meshes: [], geos, mats });
    };
    for (let v = 0; v < 3; v++) kind('spruce', v, 10, 0.2, 0.3, spruceBands(v, rng, 10), M.barkSpruce(), foliageMat, 7, 6);
    for (let v = 0; v < 2; v++) {
      const bands = branchBands(rng, 11, 9, 0.4, 0.92, [1.2, 2.8], [0.5, 1.0], 4, { y0: 3.2 + v, y1: 11.8, w: 4.6 - v }, 0.03);
      kind('birch', v, 11, 0.15, 0.35, bands, M.barkBirch(), twigMat, 8, 7);
    }
    kind('dead', 0, 8, 0.17, 0.45, branchBands(rng, 8, 9, 0.12, 0.9, [0.4, 1.6], [1.0, 1.5], 3, null, 0.025), M.barkDead(), null, 7, 5);
    kind('burnt', 0, 8, 0.17, 0.45, branchBands(rng, 8, 7, 0.3, 0.9, [0.4, 1.4], [1.0, 1.5], 3, null, 0.025), burntMat, null, 7, 5);
    kind('pine', 0, 10, 0.2, 0.3, spruceBands(1, rng, 10), pineMat, foliageMat, 7, 6);
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
    this.crownSource = (p, bi) => this.crownParts(p, bi);
    // boulders: smooth, snow settles on top (ground shader)
    const rg = new THREE.IcosahedronGeometry(1, 2);
    const nz = new Simplex2(() => rng.next());
    const merged = mergeVertices(rg);
    const mp = merged.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < mp.count; k++) {
      const x = mp.getX(k), y = mp.getY(k), z = mp.getZ(k);
      const f = 1 + 0.22 * nz.noise(x * 1.7 + 3, z * 1.7 + y) + 0.08 * nz.noise(x * 4, y * 4 + z);
      mp.setXYZ(k, x * f * 1.15, y * f * 0.7, z * f);
    }
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

  /** draws the crown bands of felled trunks */
  crownSource: CrownSource | undefined = undefined;

  /** One crown band of a piece, transformed into the piece's frame (axis along X). */
  private crownParts(p: WoodPiece, bi: number) {
    const c = p.crown;
    if (!c) return [];
    const kind = this.kinds[c.kind];
    const band = kind?.bands[bi];
    if (!band) return [];
    const w = p.whorls.find((x) => x.band === bi);
    const k = w ? 0.35 + 0.65 * (w.branches.length / Math.max(1, w.n0 ?? w.branches.length)) : 1;
    // tree space (Y up, base at 0) → piece space: scale, turn, shift to the piece centre, lay along X
    const m = new THREE.Matrix4().makeRotationZ(-Math.PI / 2)
      .multiply(new THREE.Matrix4().makeTranslation(0, -(c.base + p.len / 2), 0))
      .multiply(new THREE.Matrix4().makeRotationY(c.rotY))
      .multiply(new THREE.Matrix4().makeScale(c.sx * k, c.sy, c.sx * k));
    const out: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
    if (band.bark) out.push({ geo: band.bark.clone().applyMatrix4(m), mat: kind.mats[0] });
    if (band.leaf) out.push({ geo: band.leaf.clone().applyMatrix4(m), mat: kind.mats[1] });
    return out;
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
    const { sx, sy } = this.scaleOf(i);
    // a small natural lean, mostly a degree or two
    const hsh = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    const f1 = hsh - Math.floor(hsh);
    const hsh2 = Math.sin(i * 39.3468 + 11.135) * 24634.6345;
    const f2 = hsh2 - Math.floor(hsh2);
    t = {
      id: i, type: kind.type, variant: kind.variant, x: P.x[i], y: P.y[i] - 0.15, z: P.z[i], sx, sy, rotY: P.rot[i],
      r: kind.R * sx, h: kind.H * sy, alive: (P.flags[i] & 3) === 0, index: kindIdx, collider: null,
      bark: kind.type === 'birch' ? 3 : 0,
      lean: ((0.4 + 3.6 * f1 * f1) * Math.PI) / 180, leanDir: f2 * Math.PI * 2,
      stem: null, obj: null, warned: false,
    };
    this.state.set(i, t);
    return t;
  }

  private scaleOf(i: number) {
    const P = this.P;
    const sp = P.kind[i];
    const s = P.s[i] * (sp === Sp.Pine ? 1.15 : 1) * (sp === Sp.Dwarf ? 0.55 : 1);
    return sp === Sp.Pine ? { sx: s * 0.8, sy: s * 1.25 } : { sx: s, sy: s };
  }

  private leanQuat(lean: number, dir: number, out = new THREE.Quaternion()) {
    const axis = new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir)).cross(UP).multiplyScalar(-1).normalize();
    return out.setFromAxisAngle(axis, lean);
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
        if (this.active.has(i)) return;
        const sp = P.kind[i];
        const ks = this.kindOfSp[sp];
        const kind = this.kinds[ks[Math.min(ks.length - 1, P.variant[i])]];
        const { sx, sy } = this.scaleOf(i);
        const t = this.state.get(i);
        tmpQ.setFromAxisAngle(UP, P.rot[i]);
        if (t) tmpQ.premultiply(this.leanQuat(t.lean, t.leanDir, tmpQ2));
        else {
          const hsh = Math.sin(i * 12.9898 + 78.233) * 43758.5453, f1 = hsh - Math.floor(hsh);
          const hsh2 = Math.sin(i * 39.3468 + 11.135) * 24634.6345, f2 = hsh2 - Math.floor(hsh2);
          tmpQ.premultiply(this.leanQuat(((0.4 + 3.6 * f1 * f1) * Math.PI) / 180, f2 * Math.PI * 2, tmpQ2));
        }
        tmpM.compose(tmpP.set(P.x[i], P.y[i] - 0.15, P.z[i]), tmpQ, tmpS.set(sx, sy, sx));
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
          G.R.ColliderDesc.cylinder(t.h * 0.5, Math.max(0.08, t.r * 0.9)).setTranslation(t.x, t.y + t.h * 0.5, t.z).setCollisionGroups(GROUPS_TREE),
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
      const stick = makeRound('dead', rng.float(0.5, 1.4), rng.float(0.008, 0.02), 0.005);
      G.entities.spawnItem('sticks', new THREE.Vector3(x, T.heightAt(x, z) + 0.05, z), { quat: q, sleep: true, moisture: rng.float(0.15, 0.4), wood: stick });
      placed++;
    }
    for (let i = 0; i < 8 && near.length; i++) {
      const t = rng.pick(near);
      const x = t.x + rng.float(-3, 3), z = t.z + rng.float(-3, 3);
      if (!Number.isNaN(G.region.waterAt(x, z)) || Math.hypot(x, z) < 10) continue;
      const q = new THREE.Quaternion().setFromAxisAngle(UP, rng.float(0, 6));
      const r = rng.float(0.07, 0.12);
      const log = makeRound('dead', rng.float(0.9, 1.8), r, r * 0.9);
      G.entities.spawnItem('log', new THREE.Vector3(x, T.heightAt(x, z) + 0.2, z), { quat: q, sleep: true, moisture: 0.3, wood: log });
    }
  }

  kindOf(t: Tree) {
    return this.kinds[t.index];
  }

  // ---------- working a standing tree ----------

  private standPose(t: Tree) {
    const q = this.leanQuat(t.lean, t.leanDir).multiply(STAND);
    const up = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    return { q, up, base: new THREE.Vector3(t.x, t.y, t.z) };
  }

  /** Give the tree its real stem and crown and draw it on its own. */
  activate(t: Tree) {
    if (t.stem) return t.stem;
    const kind = this.kindOf(t);
    const sp = SPECIES_OF[t.type];
    const stem = makeRound(sp, t.h, t.r, t.r * kind.top);
    stem.crown = { kind: t.index, sx: t.sx, sy: t.sy, rotY: t.rotY, base: 0 };
    const needles = t.type === 'spruce' || t.type === 'pine';
    kind.bands.forEach((b, bi) => {
      const w: Whorl = {
        u: ((b.y0 + b.y1) / 2) * t.sy, h: (b.y1 - b.y0) * t.sy, rad: b.rad * t.sx, band: bi,
        branches: b.branches.map((x) => ({ len: x.len * t.sx, r: Math.max(0.006, x.r * Math.sqrt(t.sx)), needles: needles ? b.needles * x.len * t.sx : 0 })),
      };
      w.n0 = w.branches.length;
      stem.whorls.push(w);
    });
    t.stem = stem;
    this.active.set(t.id, t);
    this.rebuildTree(t);
    this.update(G.player.pos, true);
    return stem;
  }

  /** (Re)build the standing tree's own mesh: the notched stem and its crown. */
  private rebuildTree(t: Tree) {
    const stem = t.stem!;
    if (t.obj) {
      t.obj.removeFromParent();
      t.obj.traverse((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.dispose());
    }
    const { q, up, base } = this.standPose(t);
    const g = new THREE.Group();
    g.position.copy(base).addScaledVector(up, stem.len / 2);
    g.quaternion.copy(q);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[]) => {
      const me = new THREE.Mesh(geo, m);
      me.castShadow = me.receiveShadow = true;
      g.add(me);
    };
    add(roundGeometry(stem), [barkMaterial(stem.sp), endMaterial(stem.sp)]);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const w of stem.whorls) for (const part of this.crownParts(stem, w.band)) {
      if (!byMat.has(part.mat)) byMat.set(part.mat, []);
      byMat.get(part.mat)!.push(part.geo);
    }
    for (const [m, list] of byMat) add(list.length === 1 ? list[0] : mergeGeometries(list)!, m);
    G.scene.add(g);
    t.obj = g;
  }

  /** Where along the stem a point is and from which side a blow from `from` comes. */
  private stemHit(t: Tree, point: THREE.Vector3, from: THREE.Vector3) {
    const stem = t.stem!;
    const { q, up, base } = this.standPose(t);
    const center = base.clone().addScaledVector(up, stem.len / 2);
    const qi = q.clone().invert();
    const local = point.clone().sub(center).applyQuaternion(qi);
    const d = from.clone().sub(point).applyQuaternion(qi);
    return { u: local.x + stem.len / 2, a: Math.atan2(d.z, d.y) };
  }

  /** world horizontal vector → stem cross-section (local y, z) and back */
  private toLocal(t: Tree, v: THREE.Vector3) {
    const l = v.clone().applyQuaternion(this.standPose(t).q.invert());
    return { y: l.y, z: l.z };
  }

  private toWorld(t: Tree, y: number, z: number) {
    return new THREE.Vector3(0, y, z).applyQuaternion(this.standPose(t).q);
  }

  /** How close the tree is to going over, and which way. */
  fellState(t: Tree): FellState | null {
    const stem = t.stem;
    if (!stem || !stem.notches.length) return null;
    const lean = new THREE.Vector3(Math.cos(t.leanDir), 0, Math.sin(t.leanDir)).multiplyScalar(Math.tan(t.lean));
    const L = this.toLocal(t, lean);
    const W = G.weather;
    // wind on the crown: drag on the area the branches present
    let area = 0, ah = 0;
    for (const w of stem.whorls) {
      const fill = t.type === 'spruce' || t.type === 'pine' ? 0.55 : t.type === 'birch' ? 0.25 : 0.08;
      const a = 2 * w.rad * w.h * fill * (w.branches.length / Math.max(1, w.n0 ?? w.branches.length));
      area += a;
      ah += a * w.u;
    }
    const v = W?.wind ?? 0;
    const F = 0.5 * 1.3 * v * v * 0.8 * area;
    const wind = new THREE.Vector3(Math.cos(W?.windDir ?? 0), 0, Math.sin(W?.windDir ?? 0)).multiplyScalar(F);
    const Wl = this.toLocal(t, wind);
    return fellCheck({ stem, leanY: L.y, leanZ: L.z, windY: Wl.y, windZ: Wl.z, windH: area > 0 ? ah / area : t.h * 0.6, moisture: this.moistureOf(t) });
  }

  private moistureOf(t: Tree) {
    return t.type === 'dead' || t.type === 'burnt' ? 0.12 : 0.45;
  }

  /** Predicted fall direction (world, horizontal) once there is a cut. */
  fallDirection(t: Tree) {
    const st = this.fellState(t);
    if (!st) return null;
    const d = this.toWorld(t, st.dirY, st.dirZ).setY(0);
    return { dir: d.lengthSq() > 1e-8 ? d.normalize() : new THREE.Vector3(1, 0, 0), ratio: st.ratio, frac: st.frac };
  }

  /** One blow at a standing tree. */
  chopTree(t: Tree, point: THREE.Vector3, power: number, saw: boolean) {
    if (!t.alive) return;
    tip('fell', 'Зарубка там, куда целитесь. Дерево падает туда, куда смещён его вес: в сторону подруба, наклона или ветра. Подсказка у прицела скажет, куда оно упадёт. Чтобы уронить от себя — подрубите с той стороны, куда валите, и допилите со своей.');
    this.activate(t);
    const { u, a } = this.stemHit(t, point, G.player.eyePos);
    // you can't reach above your head, and the root flare is in the snow
    const n = chop(t.stem!, clamp(u, 0.15, Math.min(t.h - 0.5, 2.3)), a, power, saw);
    void n;
    this.rebuildTree(t);
    G.audio.play(saw ? 'saw' : 'chop', { pos: point });
    G.fx.burst('chips', point, saw ? 3 : 6);
    if (Math.random() < 0.35) G.fx.burst('snow', new THREE.Vector3(t.x, t.y + t.h * 0.55, t.z), 10);
    const st = this.fellState(t);
    if (!st) return;
    if (st.ratio >= 1) this.fell(t, st);
    else if (st.ratio > 0.7 && !t.warned) {
      t.warned = true;
      G.audio.play('creak', { pos: point });
      msg('Дерево потрескивает — скоро пойдёт!', 'warn');
    }
  }

  /** The tree gives way at the weakest section and tips over its hinge. */
  fell(t: Tree, st: FellState) {
    if (!t.alive || !t.stem) return null;
    t.alive = false;
    this.P.flags[t.id] |= 2;
    if (t.collider) {
      this.byCollider.delete(t.collider.handle);
      G.world.removeCollider(t.collider, true);
      this.colliders.delete(t.id);
      t.collider = null;
    }
    if (t.obj) {
      t.obj.removeFromParent();
      t.obj.traverse((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.dispose());
      t.obj = null;
    }
    this.active.delete(t.id);
    const { q, up, base } = this.standPose(t);
    const [lower, upper] = cutAt(t.stem, st.u);
    const moist = this.moistureOf(t);
    const stump = this.makeStump(lower, base, q, up, moist, t);
    // the trunk starts upright where it stood and turns about the hinge
    const center = base.clone().addScaledVector(up, st.u + upper.len / 2);
    const e = spawnPiece(upper, center, q.clone(), moist);
    e.colliders[0].setCollisionGroups(GROUPS_FALLING);
    e.data.groups = GROUPS_FALLING;
    e.data.treeType = t.type;
    const fall = this.toWorld(t, st.dirY, st.dirZ).setY(0);
    if (fall.lengthSq() < 1e-8) fall.set(1, 0, 0);
    fall.normalize();
    const hinge = base.clone().addScaledVector(up, st.u).add(this.toWorld(t, st.hingeY, st.hingeZ));
    const axis = new THREE.Vector3().crossVectors(UP, fall).normalize();
    let joint: RAPIER_T.ImpulseJoint | null = null;
    if (stump.body && e.body) {
      const sb = stump.body.translation(), sq = stump.body.rotation();
      const tb = e.body.translation();
      const sqi = new THREE.Quaternion(sq.x, sq.y, sq.z, sq.w).invert();
      const tqi = q.clone().invert();
      const a1 = hinge.clone().sub(new THREE.Vector3(sb.x, sb.y, sb.z)).applyQuaternion(sqi);
      const a2 = hinge.clone().sub(new THREE.Vector3(tb.x, tb.y, tb.z)).applyQuaternion(tqi);
      const ax1 = axis.clone().applyQuaternion(sqi), ax2 = axis.clone().applyQuaternion(tqi);
      const jd = G.R.JointData.revoluteWithAxes(a1, a2, ax1, ax2);
      joint = G.world.createImpulseJoint(jd, stump.body, e.body, true);
      joint.setContactsEnabled(false);
      e.body.setAngvel({ x: axis.x * 0.12, y: 0, z: axis.z * 0.12 }, true);
    }
    this.falling.push({ e, joint, age: 0, hitPlayer: false, landed: false });
    this.update(G.player.pos, true);
    G.audio.play('creak', { pos: hinge });
    const toPlayer = G.player.pos.clone().sub(base).setY(0);
    const onYou = toPlayer.lengthSq() < t.h * t.h * 1.2 && toPlayer.normalize().dot(fall) > 0.5;
    msg(`${TREE_NAMES[t.type]} падает${onYou ? ' — на вас! Отходите в сторону!' : '!'}`, onYou ? 'bad' : 'good');
    return e;
  }

  /** A stump: the lower part of the stem stays rooted. It can be cut lower still. */
  private makeStump(p: WoodPiece, base: THREE.Vector3, q: THREE.Quaternion, up: THREE.Vector3, moisture: number, t?: Tree) {
    const e = new Entity('stump');
    e.defId = '';
    e.name = t ? `Пень (${TREE_NAMES[t.type].toLowerCase()})` : 'Пень';
    p.whorls = [];
    p.crown = undefined;
    e.data = { wood: p, groups: GROUPS_STATIC, base: base.clone(), up: up.clone(), q: q.clone(), mass: 500 };
    e.moisture = moisture;
    const center = base.clone().addScaledVector(up, p.len / 2);
    const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    e.body = body;
    e.colliders = [];
    attachColliders(e, body, GROUPS_STATIC);
    const g = new THREE.Group();
    const me = new THREE.Mesh(roundGeometry(p), [barkMaterial(p.sp), endMaterial(p.sp)]);
    me.castShadow = me.receiveShadow = true;
    g.add(me);
    g.userData.entity = e;
    g.userData.ownsGeometry = true;
    g.position.copy(center);
    g.quaternion.copy(q);
    G.scene.add(g);
    e.obj = g;
    e.inWorld = true;
    G.entities.add(e);
    return e;
  }

  /** A stump cut through: the top comes off as a loose piece, the rest stays rooted. */
  cutStump(e: Entity, lower: WoodPiece, upper: WoodPiece) {
    const { base, up, q } = e.data;
    const moist = e.moisture;
    G.entities.destroy(e);
    const s = this.makeStump(lower, base, q, up, moist);
    s.name = e.name;
    const center = (base as THREE.Vector3).clone().addScaledVector(up, lower.len + upper.len / 2 + 0.01);
    return spawnPiece(upper, center, (q as THREE.Quaternion).clone(), moist, new THREE.Vector3(0, 0.3, 0));
  }

  /** Falling trees: tear the hinge, hit what is under them, settle. */
  updateFalling(dt: number) {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.age += dt;
      const e = f.e;
      if (e.removed || !e.body) {
        if (f.joint && f.joint.isValid()) G.world.removeImpulseJoint(f.joint, true);
        this.falling.splice(i, 1);
        continue;
      }
      const r = e.body.rotation();
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
      const tilt = Math.acos(clamp(Math.abs(axis.y), 0, 1));
      // the hinge fibres tear once the tree is well on its way
      if (f.joint && (tilt > 0.7 || f.age > 6)) {
        if (f.joint.isValid()) G.world.removeImpulseJoint(f.joint, true);
        f.joint = null;
      }
      const av = e.body.angvel();
      const spin = Math.hypot(av.x, av.y, av.z);
      if (!f.hitPlayer && spin > 0.25 && !G.player.water) this.checkHit(f, axis);
      const settled = f.age > 1.5 && (e.body.isSleeping() || (tilt > 1.2 && spin < 0.15));
      if (!f.landed && (tilt > 1.25 || settled)) {
        f.landed = true;
        const p = e.position();
        G.audio.play('tree_fall', { pos: p });
        const len = (e.data.wood as WoodPiece).len;
        for (let k = 0; k < 4; k++) G.fx.burst('snow', p.clone().addScaledVector(axis, (k / 3 - 0.5) * len), 14);
      }
      if (settled || f.age > 12) {
        e.colliders[0]?.setCollisionGroups(GROUPS_ITEM);
        delete e.data.groups;
        if (f.joint && f.joint.isValid()) G.world.removeImpulseJoint(f.joint, true);
        this.unstickPlayer(e, axis);
        this.falling.splice(i, 1);
      }
    }
  }

  /** Is the player under the falling stem? */
  private checkHit(f: Falling, axis: THREE.Vector3) {
    const e = f.e;
    const p = woodLen(e);
    const c = e.position();
    const a = c.clone().addScaledVector(axis, -p.len / 2), b = c.clone().addScaledVector(axis, p.len / 2);
    const P = G.player.pos;
    let best = Infinity, bestS = 0;
    for (let k = 0; k <= 6; k++) {
      const y = P.y + 0.3 + k * 0.22;
      const q = new THREE.Vector3(P.x, y, P.z);
      const ab = b.clone().sub(a);
      const s = clamp(q.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
      const d = a.clone().addScaledVector(ab, s).distanceTo(q);
      if (d < best) {
        best = d;
        bestS = s;
      }
    }
    const rad = p.r0 + (p.r1 - p.r0) * bestS;
    if (best > rad + 0.35) return;
    f.hitPlayer = true;
    const lv = e.body!.linvel(), av = e.body!.angvel();
    const speed = Math.hypot(lv.x, lv.y, lv.z) + Math.hypot(av.x, av.y, av.z) * p.len * bestS;
    const dmg = Math.round(clamp(10 + e.mass * speed * 0.02, 10, 95));
    G.body.condition = Math.max(0, G.body.condition - dmg);
    G.hud.flash('bad');
    G.audio.play('thud', { pos: P });
    msg(dmg > 50 ? 'Вас придавило деревом! Еле живы.' : 'По вам ударило падающим деревом!', 'bad');
  }

  /** after the stem lies down the player must not end up inside it */
  private unstickPlayer(e: Entity, axis: THREE.Vector3) {
    const p = woodLen(e);
    const c = e.position();
    const P = G.player.pos.clone();
    const rel = P.clone().sub(c);
    const along = clamp(rel.dot(axis), -p.len / 2, p.len / 2);
    const near = c.clone().addScaledVector(axis, along);
    const off = P.clone().sub(near).setY(0);
    const rad = Math.max(p.r0, p.r1);
    if (off.length() < rad + 0.32 && Math.abs(P.y + 0.9 - near.y) < 1.2) {
      const push = off.lengthSq() > 1e-6 ? off.normalize() : new THREE.Vector3(-axis.z, 0, axis.x).normalize();
      const to = near.clone().addScaledVector(push, rad + 0.45);
      to.y = G.terrain.heightAt(to.x, to.z) + 0.05;
      G.player.teleport(to);
    }
  }

  isFalling(e: Entity) {
    return this.falling.some((f) => f.e === e && !f.landed);
  }

  // ---------- small harvest from a standing tree ----------

  /** Branches you can reach from the ground: the lowest band below ~2.3 m. */
  reachableBranches(t: Tree) {
    const kind = this.kindOf(t);
    if (t.stem) {
      const w = t.stem.whorls.filter((x) => x.u - x.h / 2 < 2.3 && x.branches.length).sort((a, b) => a.u - b.u)[0];
      return w ? w.branches.length : 0;
    }
    let n = 0;
    for (const b of kind.bands) if (b.y0 * t.sy < 2.3) n += b.branches.length;
    return Math.min(n, kind.bands.find((b) => b.y0 * t.sy < 2.3)?.branches.length ?? 0);
  }

  /** Break off one low branch by hand: you get exactly that branch. */
  breakBranch(t: Tree) {
    const stem = this.activate(t);
    const w = stem.whorls.filter((x) => x.u - x.h / 2 < 2.3 && x.branches.length).sort((a, b) => a.u - b.u)[0];
    if (!w) return null;
    const br = w.branches.pop()!;
    if (!w.branches.length) stem.whorls.splice(stem.whorls.indexOf(w), 1);
    stem.rev++;
    this.rebuildTree(t);
    return branchPiece(stem.sp, br);
  }

  isTreeTarget(handle: number) {
    return this.byCollider.get(handle) ?? null;
  }

  /** remaining wood at the deepest notch (for the prompt) */
  cutDepth(t: Tree) {
    if (!t.stem) return 0;
    let best = 0;
    for (const n of t.stem.notches) if (!n.done) best = Math.max(best, 1 - sectionAt(t.stem, n.u).frac);
    return best;
  }
}

function woodLen(e: Entity): WoodPiece {
  return e.data.wood as WoodPiece;
}
