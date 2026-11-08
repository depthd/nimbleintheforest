// Wood pieces as game objects: spawning, physics shapes, chopping at the hit point,
// splitting short rounds into firewood and lopping branches off felled trunks.
import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { G, GROUPS_CROWN, GROUPS_ITEM, msg } from '../ctx';
import { Entity } from '../entities';
import type { ToolTag } from '../items';
import {
  Branch, BRANCH_TIP, canSplit, category, chop, clonePiece, cutAt, cutThrough, fitsInPack, makeRound, makeSawn, makeSplit,
  maxRadius, pieceMass, pieceName, pieceSize, radiusAt, sectionAt, splitAlong, volume, weakestAt, whorlMass, WoodPiece,
} from './piece';
import { buildWoodObject, wedgeCentroid } from './mesh';
import { density, SPECIES, Species } from './species';

export { WOOD_IDS, defaultPiece } from './piece';

export function woodOf(e: Entity | null | undefined): WoodPiece | null {
  return (e?.data?.wood as WoodPiece | undefined) ?? null;
}

/** Mass of the stem itself (without branches), for the main collider. */
function stemMass(p: WoodPiece, moisture: number) {
  return volume(p) * density(p.sp, moisture) + p.needles;
}

export function woodMass(e: Entity) {
  return pieceMass(e.data.wood as WoodPiece, e.moisture);
}

export function isPocket(e: Entity) {
  const p = woodOf(e);
  if (p) return fitsInPack(p);
  return !!e.def?.pocket;
}

// ---------- physics shapes ----------

const AXIS_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
const rot = (q: THREE.Quaternion) => ({ x: q.x, y: q.y, z: q.z, w: q.w });

export interface WoodCollider {
  desc: RAPIER_T.ColliderDesc;
  /** index of the whorl this collider stands for, or -1 for the stem */
  whorl: number;
}

export function woodColliders(e: Entity): WoodCollider[] {
  const p = woodOf(e)!;
  const R = G.R;
  const out: WoodCollider[] = [];
  let desc: RAPIER_T.ColliderDesc | null = null;
  if (p.form === 'sawn') desc = R.ColliderDesc.cuboid(p.len / 2, Math.max(0.006, p.t / 2), Math.max(0.01, p.w / 2));
  else if (p.form === 'split') {
    const r = p.r0, a = Math.min(p.sector, Math.PI * 1.99), c = wedgeCentroid(r, a);
    const pts: number[] = [];
    const n = Math.max(2, Math.round(a * 3));
    for (const x of [-p.len / 2, p.len / 2]) {
      pts.push(x, -c, 0);
      for (let i = 0; i <= n; i++) {
        const th = -a / 2 + (a * i) / n;
        pts.push(x, Math.cos(th) * r - c, Math.sin(th) * r);
      }
    }
    desc = R.ColliderDesc.convexHull(new Float32Array(pts));
    if (!desc) desc = R.ColliderDesc.cuboid(p.len / 2, r / 3, r / 3);
  } else {
    const r0 = Math.max(0.01, p.r0), r1 = Math.max(0.01, p.r1);
    if (Math.abs(r0 - r1) < 0.2 * Math.max(r0, r1) || p.len < 0.4) {
      desc = R.ColliderDesc.cylinder(p.len / 2, (r0 + r1) / 2).setRotation(rot(AXIS_Q));
    } else {
      const pts: number[] = [];
      const n = 10;
      for (const [x, r] of [[-p.len / 2, r0], [p.len / 2, r1]]) {
        for (let i = 0; i < n; i++) {
          const th = (i / n) * Math.PI * 2;
          pts.push(x, Math.cos(th) * r, Math.sin(th) * r);
        }
      }
      desc = R.ColliderDesc.convexHull(new Float32Array(pts)) ?? R.ColliderDesc.cylinder(p.len / 2, (r0 + r1) / 2).setRotation(rot(AXIS_Q));
    }
  }
  desc.setMass(Math.max(0.05, stemMass(p, e.moisture))).setFriction(p.form === 'round' ? 0.9 : 0.8).setRestitution(0.02);
  out.push({ desc, whorl: -1 });
  p.whorls.forEach((w, i) => {
    const k = 0.35 + 0.65 * (w.branches.length / Math.max(1, w.n0 ?? w.branches.length));
    const rr = Math.min(1.1, Math.max(0.15, w.rad * 0.5 * k));
    const d = R.ColliderDesc.cylinder(Math.max(0.08, w.h * 0.3), rr)
      .setRotation(rot(AXIS_Q))
      .setTranslation(w.u - p.len / 2, 0, 0)
      .setMass(Math.max(0.2, whorlMass(w, p.sp, e.moisture)))
      .setFriction(1.2)
      .setCollisionGroups(GROUPS_CROWN);
    out.push({ desc: d, whorl: i });
  });
  return out;
}

// ---------- drawing ----------

export function woodObject(e: Entity): THREE.Object3D {
  const p = woodOf(e)!;
  const g = buildWoodObject(p, G.forest?.crownSource);
  g.userData.entity = e;
  g.userData.ownsGeometry = true;
  return g;
}

function disposeObject(o: THREE.Object3D) {
  if (!o.userData.ownsGeometry) return;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
}

/** Rebuild the look (and mass) of a piece after it changed in place. */
export function refreshWood(e: Entity, colliders = false) {
  const p = woodOf(e)!;
  e.name = pieceName(p);
  e.defId = category(p);
  // no longer drawn merged with the wood resting around it
  G.resting?.drop(e);
  const old = e.obj;
  const obj = woodObject(e);
  if (old) {
    obj.position.copy(old.position);
    obj.quaternion.copy(old.quaternion);
    const parent = old.parent;
    old.removeFromParent();
    disposeObject(old);
    if (parent) parent.add(obj);
  } else if (e.inWorld) G.scene.add(obj);
  e.obj = obj;
  if (e.kind === 'part') {
    G.build.partChanged(e, colliders);
    return;
  }
  if (e.body && e.colliders.length && !colliders) {
    e.colliders[0].setMass(Math.max(0.05, stemMass(p, e.moisture)));
    return;
  }
  if (e.body && e.colliders.length) {
    // whorls changed: rebuild the colliders
    const body = e.body;
    for (const c of e.colliders) {
      G.entities.byCollider.delete(c.handle);
      G.world.removeCollider(c, false);
    }
    e.colliders = [];
    attachColliders(e, body, e.data.groups);
    body.wakeUp();
  }
}

/**
 * Create the colliders of a wood piece on its body and register them. On a body shared by
 * many pieces (parts of structures) the colliders carry the piece's own pose.
 */
export function attachColliders(e: Entity, body: RAPIER_T.RigidBody, groups?: number, pose?: { position: THREE.Vector3; quaternion: THREE.Quaternion }) {
  const whorlCols: number[] = [];
  for (const wc of woodColliders(e)) {
    if (wc.whorl < 0) wc.desc.setCollisionGroups(groups ?? GROUPS_ITEM);
    if (pose) {
      const t = wc.desc.translation, r = wc.desc.rotation;
      const q = pose.quaternion.clone().multiply(new THREE.Quaternion(r.x, r.y, r.z, r.w));
      const c = new THREE.Vector3(t.x, t.y, t.z).applyQuaternion(pose.quaternion).add(pose.position);
      wc.desc.setTranslation(c.x, c.y, c.z).setRotation(rot(q));
    }
    const col = G.world.createCollider(wc.desc, body);
    e.colliders.push(col);
    G.entities.byCollider.set(col.handle, e);
    if (wc.whorl >= 0) whorlCols[wc.whorl] = col.handle;
  }
  e.data.whorlCols = whorlCols;
}

// ---------- spawning ----------

export function makeWoodEntity(p: WoodPiece, moisture: number): Entity {
  const e = new Entity('item');
  e.defId = category(p);
  e.name = pieceName(p);
  e.data = { wood: p };
  e.moisture = moisture;
  e.params = { v: 0 };
  return e;
}

export function spawnPiece(p: WoodPiece, pos: THREE.Vector3, quat: THREE.Quaternion, moisture: number, vel?: THREE.Vector3, angvel?: THREE.Vector3) {
  const e = makeWoodEntity(p, moisture);
  G.entities.add(e);
  G.entities.placeInWorld(e, pos, quat, vel, angvel);
  return e;
}

// ---------- working wood ----------

function toolTags(tool: Entity): ToolTag[] {
  return tool.def?.tool?.tags ?? [];
}

function pose(e: Entity) {
  const T = new THREE.Vector3();
  const Q = new THREE.Quaternion();
  if (e.body) {
    const t = e.body.translation();
    const r = e.body.rotation();
    T.set(t.x, t.y, t.z);
    Q.set(r.x, r.y, r.z, r.w);
  } else if (e.obj) {
    e.obj.getWorldPosition(T);
    e.obj.getWorldQuaternion(Q);
  }
  return { T, Q };
}

/** Where along the axis a world point lies, and from which side a blow from `from` comes. */
export function localHit(e: Entity, point: THREE.Vector3, from: THREE.Vector3) {
  const p = woodOf(e)!;
  const { T, Q } = pose(e);
  const qi = Q.clone().invert();
  const local = point.clone().sub(T).applyQuaternion(qi);
  const d = from.clone().sub(point).applyQuaternion(qi);
  return { u: local.x + p.len / 2, a: Math.atan2(d.z, d.y), T, Q };
}

export function whorlOfCollider(e: Entity, handle: number | undefined) {
  if (handle === undefined) return -1;
  const cols: number[] = e.data.whorlCols ?? [];
  return cols.indexOf(handle);
}

/** Text for the target prompt. */
export function chopLabelFor(e: Entity, tool: Entity, handle?: number): string | null {
  const p = woodOf(e);
  if (!p) return null;
  const tg = toolTags(tool);
  const saw = tg.includes('saw');
  if (!tg.includes('axe') && !saw) return null;
  if (whorlOfCollider(e, handle) >= 0) return saw ? 'Отпилить сук' : 'Обрубить сук';
  if (e.kind === 'stump') return saw ? 'Спилить пень ниже' : 'Срубить пень ниже';
  if (e.kind === 'part') return saw ? 'Подпилить' : 'Подрубить';
  if (!saw && canSplit(p)) return 'Расколоть';
  return saw ? 'Распилить здесь' : 'Перерубить здесь';
}

/** One blow of an axe or a saw stroke at a point on a piece. */
export function hitPiece(e: Entity, tool: Entity, point: THREE.Vector3, power: number, handle?: number) {
  const p = woodOf(e)!;
  const tg = toolTags(tool);
  const saw = tg.includes('saw');
  const eye = G.player.eyePos;
  const wi = whorlOfCollider(e, handle);
  G.audio.play(saw ? 'saw' : 'chop', { pos: point });
  G.fx.burst('chips', point, saw ? 3 : 6);
  if (wi >= 0) {
    lopBranch(e, wi, point);
    return;
  }
  const { u, a, T, Q } = localHit(e, point, eye);
  if (e.kind === 'part') {
    const n = chop(p, u, a, power, saw);
    if (cutThrough(p, n)) G.build.cutPart(e, weakestAt(p, n));
    else {
      // redrawn on its own (refreshWood), then checked alone unless it gives way
      refreshWood(e);
      G.build.changed(e);
    }
    return;
  }
  if (!saw && canSplit(p) && e.kind !== 'stump') {
    const need = Math.max(0.5, (p.form === 'round' ? 2 * (p.r0 + p.r1) / 2 : p.r0) * p.len * 15) / SPECIES[p.sp].chop;
    e.data.splitWork = (e.data.splitWork ?? 0) + power;
    if (e.data.splitWork >= need) splitPiece(e, a, T, Q);
    else msg(`Раскалывается… ${Math.round((e.data.splitWork / need) * 100)}%`, 'info');
    return;
  }
  const n = chop(p, u, a, power * (saw ? 1 : 1), saw);
  if (cutThrough(p, n)) {
    cutPiece(e, weakestAt(p, n), T, Q);
    return;
  }
  refreshWood(e);
}

/** Cut a piece in two at u: both halves stay where they were, with the same motion. */
export function cutPiece(e: Entity, uc: number, T: THREE.Vector3, Q: THREE.Quaternion) {
  const p = woodOf(e)!;
  const [a, b] = cutAt(p, uc);
  if (e.kind === 'stump') {
    const top = G.forest.cutStump(e, a, b);
    G.audio.play('crack', { pos: T, vol: 0.5 });
    msg(`Срублено: ${top.name.toLowerCase()} ${pieceSize(b)}`, 'good');
    return [top];
  }
  const lv = e.body?.linvel() ?? { x: 0, y: 0, z: 0 };
  const moist = e.moisture;
  G.entities.destroy(e);
  const out: Entity[] = [];
  for (const [piece, center] of [[a, uc / 2 - p.len / 2], [b, uc + (p.len - uc) / 2 - p.len / 2]] as [WoodPiece, number][]) {
    if (piece.len < 0.015) continue;
    const pos = new THREE.Vector3(center, 0, 0).applyQuaternion(Q).add(T);
    const sign = center < 0 ? -1 : 1;
    const push = new THREE.Vector3(sign * 0.15, 0, 0).applyQuaternion(Q);
    const ne = spawnPiece(piece, pos, Q.clone(), moist, new THREE.Vector3(lv.x + push.x, lv.y + 0.2, lv.z + push.z));
    out.push(ne);
  }
  G.audio.play('crack', { pos: T, vol: 0.5 });
  msg(`Перерублено: ${out.map((x) => `${x.name.toLowerCase()} ${pieceSize(woodOf(x)!)}`).join(' и ')}`, 'good');
  return out;
}

/** Split along the grain: two halves fly apart from the blade. */
function splitPiece(e: Entity, a: number, T: THREE.Vector3, Q: THREE.Quaternion) {
  const p = woodOf(e)!;
  const [h1, h2] = splitAlong(p);
  const moist = e.moisture;
  G.entities.destroy(e);
  const r = h1.r0;
  const halfSector = h1.sector;
  // the halves face away from the plane the blade went in along
  let apexY = 0;
  let base = a;
  if (p.form === 'split') {
    apexY = -wedgeCentroid(p.r0, p.sector);
    base = 0;
  }
  const out: Entity[] = [];
  for (const s of [1, -1]) {
    const b = p.form === 'split' ? (s * p.sector) / 4 : base + (s * Math.PI) / 2;
    const c = wedgeCentroid(r, halfSector);
    const local = new THREE.Vector3(0, apexY + Math.cos(b) * c, Math.sin(b) * c);
    const pos = local.applyQuaternion(Q).add(T);
    const q = Q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), b));
    const away = new THREE.Vector3(0, Math.cos(b), Math.sin(b)).applyQuaternion(Q).multiplyScalar(0.8);
    out.push(spawnPiece(s > 0 ? h1 : h2, pos, q, moist, away.add(new THREE.Vector3(0, 0.8, 0))));
  }
  G.audio.play('crack', { pos: T, vol: 0.6 });
  msg(`Расколото: ${out.map((x) => x.name.toLowerCase()).join(' и ')}`, 'good');
}

/** Lop one branch off a whorl: you get exactly that branch. */
function lopBranch(e: Entity, wi: number, point: THREE.Vector3) {
  const p = woodOf(e)!;
  const w = p.whorls[wi];
  if (!w) return;
  if (w.n0 === undefined) w.n0 = w.branches.length;
  const br = w.branches.pop();
  if (br) {
    const piece = branchPiece(p.sp, br);
    const yaw = Math.random() * Math.PI * 2;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, (Math.random() - 0.5) * 0.4));
    const at = point.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6));
    spawnPiece(piece, at, q, e.moisture, new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.6, (Math.random() - 0.5) * 0.8));
  }
  if (!w.branches.length) p.whorls.splice(wi, 1);
  p.rev++;
  if (Math.random() < 0.6) G.fx.burst('snow', point, 8);
  refreshWood(e, true);
}

/** A branch off a tree as a piece of its own. */
export function branchPiece(sp: Species, br: Branch) {
  const piece = makeRound(sp, br.len, br.r, br.r * BRANCH_TIP);
  piece.needles = br.needles;
  return piece;
}

// ---------- first-time tips ----------

const told = new Set<string>();

/** A short explanation the first time something new happens. */
export function tip(key: string, text: string) {
  if (told.has(key)) return;
  told.add(key);
  // long enough to read
  setTimeout(() => msg(text, 'info', 18), 600);
}

// ---------- boards and beams ----------

const BOARD_T = 0.032, KERF = 0.004;

/** Boards a log can be ripped into: through the thickness of its thin end, minus the waney edges. */
export function boardsOf(p: WoodPiece) {
  const r = Math.min(p.r0, p.r1);
  const out: { y: number; w: number }[] = [];
  const n = Math.floor((2 * r * 0.94) / (BOARD_T + KERF));
  for (let k = 0; k < n; k++) {
    const y = -r * 0.94 + (k + 0.5) * (BOARD_T + KERF);
    const w = 2 * Math.sqrt(Math.max(0, r * r - (Math.abs(y) + BOARD_T / 2) ** 2)) * 0.92;
    if (w >= 0.07) out.push({ y, w });
  }
  return out;
}

/** Can it be ripped or hewn: a straight round log without branches. */
export function canMill(p: WoodPiece | null) {
  if (!p || p.form !== 'round' || p.whorls.length || p.needles > 0) return false;
  const c = category(p);
  return (c === 'log' || c === 'chock') && Math.min(p.r0, p.r1) >= 0.07;
}

/** Rip a log along its length with a saw: boards as wide as the log allows; the slabs go to kindling. */
export function ripToBoards(e: Entity) {
  const p = woodOf(e)!;
  const { T, Q } = pose(e);
  const moist = e.moisture;
  const boards = boardsOf(p);
  G.entities.destroy(e);
  boards.forEach((b, i) => {
    const piece = makeSawn(p.sp, p.len, b.w, BOARD_T);
    const pos = new THREE.Vector3(0, b.y + i * 0.01 + 0.02, 0).applyQuaternion(Q).add(T);
    spawnPiece(piece, pos, Q.clone(), moist);
  });
  // the two slabs with bark: kindling
  for (const s of [-1, 1]) {
    const pos = new THREE.Vector3(0, 0, s * (Math.min(p.r0, p.r1) + 0.08)).applyQuaternion(Q).add(T);
    spawnPiece(makeSplit(p.sp, Math.min(0.6, p.len), Math.min(p.r0, p.r1) * 0.5, 1.0), pos, Q.clone(), moist);
  }
  G.audio.play('saw', { pos: T });
  msg(`Распущено на доски: ${boards.length} шт. по ${pieceSize(makeSawn(p.sp, p.len, boards[0]?.w ?? 0.1, BOARD_T))}`, 'good');
}

/** Hew a log square with an axe: the largest beam that fits in its thin end. */
export function hewToBeam(e: Entity) {
  const p = woodOf(e)!;
  const { T, Q } = pose(e);
  const moist = e.moisture;
  const side = Math.min(p.r0, p.r1) * Math.SQRT2 * 0.95;
  G.entities.destroy(e);
  const beam = spawnPiece(makeSawn(p.sp, p.len, side, side), T.clone().add(new THREE.Vector3(0, 0.02, 0)), Q.clone(), moist);
  for (let i = 0; i < 3; i++) spawnPiece(makeSplit(p.sp, 0.25, 0.05, 0.8), T.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.15, (Math.random() - 0.5) * 0.6)), new THREE.Quaternion(), moist);
  G.audio.play('chop', { pos: T });
  msg(`Обтёсано: ${beam.name.toLowerCase()} ${pieceSize(woodOf(beam)!)}`, 'good');
}

/** Remaining fraction of the deepest notch (for the prompt). */
export function cutProgress(p: WoodPiece) {
  let best = 0;
  if (p.form !== 'round') {
    const thick = p.form === 'sawn' ? p.t : p.r0;
    for (const n of p.notches) if (!n.done) best = Math.max(best, n.d / thick);
    return Math.min(1, best);
  }
  for (const n of p.notches) if (!n.done) best = Math.max(best, 1 - sectionAt(p, n.u).frac);
  return best;
}

export function describeWood(e: Entity) {
  const p = woodOf(e)!;
  const m = e.mass;
  let s = `${e.displayName()} · ${pieceSize(p)} · ${m < 1 ? Math.round(m * 1000) + ' г' : m < 20 ? m.toFixed(1) + ' кг' : Math.round(m) + ' кг'}`;
  const cp = cutProgress(p);
  if (cp > 0.02) s += ` · ${p.form === 'round' ? 'зарубка' : 'надрез'} ${Math.round(cp * 100)}%`;
  if (e.data.splitWork > 0) s += ' · трещина';
  if (p.whorls.length) s += ` · сучьев: ${p.whorls.reduce((a, w) => a + w.branches.length, 0)}`;
  return s;
}

/** Burn time and fit into the stove follow from the real size. */
export function fuelScale(e: Entity) {
  const p = woodOf(e);
  const d = e.def;
  if (!p || !d) return 1;
  return Math.max(0.15, Math.min(6, e.mass / d.mass));
}

export function fitsStove(e: Entity) {
  const p = woodOf(e);
  if (!p) return (e.def?.mass ?? 0) <= 4;
  return p.len <= 0.55 && maxRadius(p) <= 0.12;
}

export { clonePiece, radiusAt, cutAt };
