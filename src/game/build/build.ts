// Wooden structures in the world: every part is a real wood piece held in place.
//
// While a structure stands, its parts are static. After every change (a notch, a cut,
// a part taken out or added, snow on the roof) the statics are worked out again;
// parts that lost their support, tip over or break come loose and fall as ordinary
// pieces — the very same pieces, which you can pick up and use. A broken beam breaks
// at the point where it was overloaded.
import * as THREE from 'three';
import { G, GROUPS_STATIC, msg } from '../ctx';
import { Entity } from '../entities';
import { category, cutAt, pieceName, WoodPiece } from '../wood/piece';
import { attachColliders, spawnPiece, woodObject } from '../wood/wood';
import { analyze, findRests, halfThickness, JointKind, pointAt, SJoint, SLoad, SPart } from './statics';
import { Placement } from './place';

export interface Structure {
  id: number;
  name: string;
  parts: Map<number, Entity>;
  joints: SJoint[];
  /** settled snow lying on the roof, m */
  snow: number;
  /** snow load used in the last check, kg/m² */
  checkedSnow: number;
  dirty: boolean;
  /** called once when the structure has mostly come down */
  onCollapse?: () => void;
  collapsed: boolean;
  /** parts it had when built (to tell when it is mostly gone) */
  built: number;
}

export interface PartData {
  s: Structure;
  /** width of roof surface carried, m */
  roof: number;
  snowMesh?: THREE.Mesh;
}

/** settled snow, kg/m³ */
const SNOW_DENSITY = 160;
const X = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** Pose of a piece lying from a to b; a board lies flat (thin side up) unless rolled. */
export function poseFrom(a: THREE.Vector3, b: THREE.Vector3, roll = 0) {
  const x = b.clone().sub(a).normalize();
  let y = UP.clone().addScaledVector(x, -UP.dot(x));
  if (y.lengthSq() < 1e-6) y = new THREE.Vector3(0, 0, 1).addScaledVector(x, -x.z);
  y.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(X, roll));
  return { pos: a.clone().add(b).multiplyScalar(0.5), quat: q, len: a.distanceTo(b) };
}

export class BuildSystem {
  structures: Structure[] = [];
  /** building by hand with the piece you carry */
  placement = new Placement();
  private nextId = 1;
  private snowT = 0;

  structure(name: string): Structure {
    const s: Structure = { id: this.nextId++, name, parts: new Map(), joints: [], snow: 0, checkedSnow: 0, dirty: true, collapsed: false, built: 0 };
    this.structures.push(s);
    return s;
  }

  of(e: Entity | null | undefined): Structure | null {
    return (e?.data?.part as PartData | undefined)?.s ?? null;
  }

  /** Add a static part: a piece lying from a to b. */
  part(s: Structure, piece: WoodPiece, a: THREE.Vector3, b: THREE.Vector3, opts: { roof?: number; moisture?: number; roll?: number; name?: string } = {}) {
    const { pos, quat, len } = poseFrom(a, b, opts.roll ?? 0);
    piece.len = len;
    return this.placePart(s, piece, pos, quat, opts.moisture ?? 0.2, opts.roof ?? 0, opts.name);
  }

  placePart(s: Structure, piece: WoodPiece, pos: THREE.Vector3, quat: THREE.Quaternion, moisture: number, roof = 0, name?: string) {
    const e = new Entity('part');
    e.defId = category(piece);
    e.name = name ?? pieceName(piece);
    e.moisture = moisture;
    e.data = { wood: piece, part: { s, roof } as PartData, groups: GROUPS_STATIC };
    this.makeStatic(e, pos, quat);
    s.parts.set(e.id, e);
    s.built = Math.max(s.built, s.parts.size);
    s.dirty = true;
    return e;
  }

  /** A loose piece becomes a part of a structure where it is. */
  adopt(s: Structure, e: Entity, pos: THREE.Vector3, quat: THREE.Quaternion, roof = 0) {
    e.data.part = { s, roof } as PartData;
    e.data.groups = GROUPS_STATIC;
    this.makeStatic(e, pos, quat);
    s.parts.set(e.id, e);
    s.built = Math.max(s.built, s.parts.size);
    s.dirty = true;
  }

  /** two structures that now touch become one */
  private merge(into: Structure, from: Structure) {
    if (into === from) return;
    for (const [id, e] of from.parts) {
      (e.data.part as PartData).s = into;
      into.parts.set(id, e);
    }
    into.joints.push(...from.joints);
    into.snow = Math.max(into.snow, from.snow);
    into.built += from.built;
    from.parts.clear();
    from.joints = [];
    const i = this.structures.indexOf(from);
    if (i >= 0) this.structures.splice(i, 1);
    into.dirty = true;
  }

  private makeStatic(e: Entity, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }));
    e.body = body;
    e.colliders = [];
    attachColliders(e, body, GROUPS_STATIC);
    if (!e.obj) e.obj = woodObject(e);
    e.obj.userData.entity = e;
    e.obj.position.copy(pos);
    e.obj.quaternion.copy(quat);
    G.scene.add(e.obj);
    e.inWorld = true;
    e.kind = 'part';
    G.entities.add(e);
    this.updateSnowMesh(e);
  }

  /** A joint with the ground (b = -1) or another part. */
  joint(s: Structure, a: Entity, ua: number, b: Entity | null, ub: number, kind: JointKind, nails?: number) {
    const n = b ? pointAt(this.spart(a), ua).sub(pointAt(this.spart(b), ub)).normalize() : UP.clone();
    if (!b || n.lengthSq() < 0.5) n.copy(UP);
    s.joints.push({ a: a.id, ua, b: b ? b.id : -1, ub, kind, n, nails });
    s.dirty = true;
  }

  /**
   * Find what a part rests on: other parts of the structure (axes close enough to
   * touch) and the ground or any fixed thing under its ends (rocks, the house).
   */
  connect(s: Structure, e: Entity, opts: { groundKind?: JointKind; nails?: number; restKind?: JointKind } = {}) {
    const me = this.spart(e);
    let found = 0;
    const pe = e.data.wood as WoodPiece;
    const near: Entity[] = [];
    for (const other of [...this.structures]) {
      for (const o of other.parts.values()) {
        if (o === e) continue;
        if (o.position().distanceTo(me.pos) > pe.len / 2 + (o.data.wood as WoodPiece).len / 2 + 0.5) continue;
        near.push(o);
      }
    }
    for (const o of near) {
      const other = this.of(o)!;
      const touch = findRests(me, this.spart(o)).length + findRests(this.spart(o), me).length;
      if (touch && other !== s) this.merge(s, other);
    }
    for (const o of near) {
      if (this.of(o) !== s) continue;
      for (const j of findRests(me, this.spart(o))) {
        if (opts.restKind) j.kind = opts.restKind;
        if (opts.nails) {
          j.kind = 'nail';
          j.nails = opts.nails;
        }
        s.joints.push(j);
        found++;
      }
      // things that rest on the new part
      for (const j of findRests(this.spart(o), me)) {
        if (s.joints.some((x) => x.a === j.a && x.b === j.b && Math.abs(x.ua - j.ua) < 0.2)) continue;
        s.joints.push(j);
      }
    }
    // the ground (or anything fixed that isn't a part) right under the piece
    const p = e.data.wood as WoodPiece;
    if (opts.groundKind === 'set') {
      // dug in: one joint where it comes out of the ground, as deep as it goes
      const lo = pointAt(me, 0), hi = pointAt(me, p.len);
      const end = lo.y < hi.y ? 0 : p.len;
      const c = pointAt(me, end);
      if (c.y < G.terrain.heightAt(c.x, c.z) + 0.02) {
        let u = end;
        const step = end === 0 ? 0.02 : -0.02;
        for (let k = 0; k < 200; k++) {
          const q = pointAt(me, u);
          if (q.y >= G.terrain.heightAt(q.x, q.z)) break;
          u += step;
        }
        const depth = Math.max(0.05, Math.abs(u - end));
        s.joints.push({ a: e.id, ua: end === 0 ? depth : p.len - depth, b: -1, ub: 0, kind: 'set', n: UP.clone() });
        s.dirty = true;
        return found + 1;
      }
    }
    const steps = Math.max(1, Math.round(p.len / 0.6));
    for (let i = 0; i <= steps; i++) {
      const u = (p.len * i) / steps;
      const c = pointAt(me, u);
      const h = halfThickness(p, u);
      const gy = this.solidBelow(c, h + 0.6, e);
      if (gy === null || c.y - h - gy > 0.06) continue;
      if (s.joints.some((x) => x.a === e.id && x.b === -1 && Math.abs(x.ua - u) < 0.3)) continue;
      s.joints.push({ a: e.id, ua: u, b: -1, ub: 0, kind: opts.groundKind ?? 'rest', n: UP.clone() });
      found++;
    }
    s.dirty = true;
    return found;
  }

  /** height of the solid surface under a point that is not a part of a structure */
  private solidBelow(c: THREE.Vector3, range: number, self: Entity) {
    let best: number | null = G.terrain.heightAt(c.x, c.z);
    if (c.y - best > range) best = null;
    const ray = new G.R.Ray({ x: c.x, y: c.y + 0.05, z: c.z }, { x: 0, y: -1, z: 0 });
    const hit = G.world.castRay(ray, range + 0.05, true, undefined, undefined, undefined, self.body ?? undefined);
    if (hit) {
      const other = G.entities.byCollider.get(hit.collider.handle);
      const isPart = other?.kind === 'part';
      const isLoose = other && other.kind === 'item';
      if (!isPart && !isLoose) {
        const y = c.y + 0.05 - hit.timeOfImpact;
        if (best === null || y > best) best = y;
      }
    }
    return best;
  }

  spart(e: Entity): SPart {
    const pd = e.data.part as PartData;
    const t = e.body!.translation(), r = e.body!.rotation();
    return { id: e.id, piece: e.data.wood as WoodPiece, pos: new THREE.Vector3(t.x, t.y, t.z), quat: new THREE.Quaternion(r.x, r.y, r.z, r.w), moisture: e.moisture, roof: pd?.roof ?? 0 };
  }

  /** Work out the statics and let go whatever can't stand. Returns the parts that fell. */
  check(s: Structure, silent = false) {
    if (this.hold) return [];
    s.dirty = false;
    const fell: Entity[] = [];
    let broke = '';
    for (let iter = 0; iter < 30; iter++) {
      const parts = new Map<number, SPart>();
      for (const [id, e] of s.parts) parts.set(id, this.spart(e));
      const load = s.snow * SNOW_DENSITY;
      const r = analyze(parts, s.joints, load, this.liveLoads(s));
      s.checkedSnow = load;
      for (const [id, st] of r.state) {
        const e = s.parts.get(id);
        if (e) e.data.load = st.ratio;
      }
      if (!r.failures.length) break;
      // the worst first: one break changes everything above it
      const order = r.failures.sort((a, b) => (a.why === 'unsupported' ? -1 : 0) - (b.why === 'unsupported' ? -1 : 0) || b.ratio - a.ratio);
      const unsupported = order.filter((f) => f.why === 'unsupported');
      const act = unsupported.length ? unsupported : [order[0]];
      for (const f of act) {
        const e = s.parts.get(f.part);
        if (!e) continue;
        if (f.why === 'bend' || f.why === 'buckle') {
          if (!broke) broke = e.name;
          fell.push(...this.breakPart(s, e, f.u));
        } else fell.push(this.release(s, e));
      }
    }
    if (fell.length && !silent) {
      const p = fell[0].position();
      G.audio.play(broke ? 'crack' : 'creak', { pos: p });
      if (fell.length > 2) G.audio.play('thud', { pos: p, vol: 0.8 });
      if (broke) msg(`${broke} ломается!`, 'warn');
      else if (fell.length > 3) msg(`${s.name}: обрушение!`, 'warn');
    }
    if (!s.collapsed && s.parts.size < s.built * 0.5) {
      s.collapsed = true;
      s.onCollapse?.();
    }
    return fell;
  }

  /** the player standing on a part loads it */
  private liveLoads(s: Structure): SLoad[] {
    const P = G.player;
    if (!P || !P.grounded) return [];
    const ray = new G.R.Ray({ x: P.pos.x, y: P.pos.y + 0.3, z: P.pos.z }, { x: 0, y: -1, z: 0 });
    const hit = G.world.castRay(ray, 0.6, true, undefined, undefined, P.collider);
    if (!hit) return [];
    const e = G.entities.byCollider.get(hit.collider.handle);
    if (!e || this.of(e) !== s || e.kind !== 'part') return [];
    const sp = this.spart(e);
    const u = P.pos.clone().sub(sp.pos).applyQuaternion(sp.quat.clone().invert()).x + sp.piece.len / 2;
    const mass = 80 + P.packWeight() + (P.carried?.mass ?? 0);
    return [{ part: e.id, u: Math.max(0, Math.min(sp.piece.len, u)), F: new THREE.Vector3(0, -mass * 9.81, 0) }];
  }

  /** A part comes loose and falls as an ordinary piece (the same entity). */
  release(s: Structure, e: Entity, vel?: THREE.Vector3) {
    const t = e.body!.translation(), r = e.body!.rotation();
    const pos = new THREE.Vector3(t.x, t.y, t.z), quat = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    this.detach(s, e);
    G.entities.removeFromWorld(e);
    e.kind = 'item';
    const pd = e.data.part as PartData;
    pd.snowMesh?.removeFromParent();
    delete e.data.part;
    delete e.data.groups;
    delete e.data.load;
    e.defId = category(e.data.wood);
    e.name = pieceName(e.data.wood);
    G.entities.placeInWorld(e, pos, quat, vel ?? new THREE.Vector3(0, -0.2, 0));
    if (s.snow > 0.02 && pd.roof > 0) G.fx.burst('snow', pos, 12);
    return e;
  }

  private detach(s: Structure, e: Entity) {
    s.parts.delete(e.id);
    s.joints = s.joints.filter((j) => j.a !== e.id && j.b !== e.id);
    s.dirty = true;
  }

  /** Overloaded: the piece snaps at u and both halves fall. */
  private breakPart(s: Structure, e: Entity, u: number) {
    const p = e.data.wood as WoodPiece;
    if (u < 0.05 || u > p.len - 0.05) return [this.release(s, e)];
    const t = e.body!.translation(), r = e.body!.rotation();
    const T = new THREE.Vector3(t.x, t.y, t.z), Q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    this.detach(s, e);
    const [a, b] = cutAt(p, u);
    // a break is a ragged tear, not a clean cut: no notch shapes the ends
    const moist = e.moisture;
    G.entities.destroy(e);
    const out: Entity[] = [];
    for (const [piece, c] of [[a, u / 2 - p.len / 2], [b, u + (p.len - u) / 2 - p.len / 2]] as [WoodPiece, number][]) {
      const pos = new THREE.Vector3(c, 0, 0).applyQuaternion(Q).add(T);
      out.push(spawnPiece(piece, pos, Q.clone(), moist, new THREE.Vector3(0, -0.5, 0)));
    }
    G.fx.burst('chips', T, 10);
    return out;
  }

  /** The player cut a part through: two parts, each keeping the joints on its side. */
  cutPart(e: Entity, uc: number) {
    const s = this.of(e);
    if (!s) return;
    const p = e.data.wood as WoodPiece;
    const pd = e.data.part as PartData;
    const t = e.body!.translation(), r = e.body!.rotation();
    const T = new THREE.Vector3(t.x, t.y, t.z), Q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const [a, b] = cutAt(p, uc);
    const old = s.joints.filter((j) => j.a === e.id || j.b === e.id);
    s.parts.delete(e.id);
    s.joints = s.joints.filter((j) => j.a !== e.id && j.b !== e.id);
    pd.snowMesh?.removeFromParent();
    G.entities.destroy(e);
    const ca = new THREE.Vector3(uc / 2 - p.len / 2, 0, 0).applyQuaternion(Q).add(T);
    const cb = new THREE.Vector3(uc + (p.len - uc) / 2 - p.len / 2, 0, 0).applyQuaternion(Q).add(T);
    const ea = this.placePart(s, a, ca, Q.clone(), e.moisture, pd.roof);
    const eb = this.placePart(s, b, cb, Q.clone(), e.moisture, pd.roof);
    for (const j of old) {
      if (j.a === e.id) {
        const tgt = j.ua < uc ? ea : eb;
        s.joints.push({ ...j, a: tgt.id, ua: j.ua < uc ? j.ua : j.ua - uc });
      } else {
        const tgt = j.ub < uc ? ea : eb;
        s.joints.push({ ...j, b: tgt.id, ub: j.ub < uc ? j.ub : j.ub - uc });
      }
    }
    G.audio.play('crack', { pos: T, vol: 0.5 });
    this.check(s);
  }

  /** A part was notched: does it still hold? */
  changed(e: Entity) {
    const s = this.of(e);
    if (!s) return;
    this.check(s);
    const st = e.data?.part ? e.data.load as number | undefined : undefined;
    if (st && st > 0.75 && !e.removed && e.kind === 'part') msg(`${e.name} трещит под нагрузкой`, 'warn');
  }

  /** Take a part out of a structure by hand (what rested on it will come down). */
  takeOut(e: Entity) {
    const s = this.of(e);
    if (!s) return e;
    this.release(s, e);
    this.check(s);
    return e;
  }

  /** Can it be pulled out by hand (not dug in, not nailed)? */
  loosePart(e: Entity) {
    const s = this.of(e);
    if (!s) return false;
    return !s.joints.some((j) => (j.a === e.id || j.b === e.id) && (j.kind === 'set' || j.kind === 'nail'));
  }

  /** parts resting on this one */
  carried(e: Entity) {
    const s = this.of(e);
    if (!s) return 0;
    return s.joints.filter((j) => j.b === e.id).length;
  }

  // ---------- snow on roofs ----------

  private updateSnowMesh(e: Entity) {
    const pd = e.data.part as PartData;
    const s = pd.s;
    if (!pd.roof) return;
    const p = e.data.wood as WoodPiece;
    if (!pd.snowMesh) {
      pd.snowMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), snowMat());
      pd.snowMesh.castShadow = false;
      pd.snowMesh.receiveShadow = true;
      e.obj!.add(pd.snowMesh);
    }
    const d = Math.max(0.005, s.snow);
    const h = halfThickness(p, p.len / 2);
    pd.snowMesh.scale.set(p.len, d, Math.max(0.05, pd.roof * 0.95));
    pd.snowMesh.position.set(0, h + d / 2, 0);
    pd.snowMesh.visible = s.snow > 0.004;
  }

  update(dtGame: number) {
    // snow builds up on roofs while it falls, and a strong wind blows some away
    this.snowT += dtGame;
    if (this.snowT >= 60) {
      const dt = this.snowT;
      this.snowT = 0;
      const W = G.weather;
      const rate = (W.snow * 0.03) / 3600; // up to ~3 cm of settled snow per hour
      const blow = W.wind > 9 ? ((W.wind - 9) * 0.004) / 3600 : 0;
      for (const s of this.structures) {
        if (!s.parts.size) continue;
        const before = s.snow;
        s.snow = Math.max(0, Math.min(2, s.snow + (rate - blow) * dt));
        if (Math.abs(s.snow - before) > 1e-5) for (const e of s.parts.values()) if ((e.data.part as PartData).roof) this.updateSnowMesh(e);
        if (Math.abs(s.snow * SNOW_DENSITY - s.checkedSnow) > 6) s.dirty = true;
      }
    }
    if (this.hold) return;
    for (const s of this.structures) if (s.dirty && s.parts.size) this.check(s);
  }

  /** for tests and the debug panel: what would fail and why, without letting anything go */
  explain(s: Structure) {
    const parts = new Map<number, SPart>();
    for (const [id, e] of s.parts) parts.set(id, this.spart(e));
    const r = analyze(parts, s.joints, s.snow * SNOW_DENSITY, this.liveLoads(s));
    return {
      failures: r.failures.map((f) => ({ name: s.parts.get(f.part)?.name, id: f.part, why: f.why, u: +f.u.toFixed(2), ratio: +f.ratio.toFixed(2) })),
      parts: [...s.parts.values()].map((e) => {
        const st = r.state.get(e.id);
        return {
          id: e.id, name: e.name, len: +(e.data.wood as WoodPiece).len.toFixed(2),
          joints: s.joints.filter((j) => j.a === e.id).map((j) => `${j.kind}->${j.b}@${j.ua.toFixed(2)}/${j.ub.toFixed(2)}`),
          ratio: st ? +st.ratio.toPrecision(3) : null, why: st?.why, N: st ? Math.round(st.N) : null, R: st?.reactions.map((x) => Math.round(x.R.length())),
        };
      }),
    };
  }

  /** skip the checks while a structure is being put together */
  hold = false;

  /** is there a built roof (boughs, boards) right above this point? */
  roofOver(p: THREE.Vector3) {
    const ray = new G.R.Ray({ x: p.x, y: p.y + 0.2, z: p.z }, { x: 0, y: 1, z: 0 });
    const hit = G.world.castRay(ray, 4, true, undefined, undefined, G.player?.collider, undefined, (c) => G.entities.byCollider.get(c.handle)?.kind === 'part');
    if (!hit) return false;
    const e = G.entities.byCollider.get(hit.collider.handle);
    return !!e && ((e.data.part as PartData)?.roof ?? 0) > 0;
  }

  /** a quick look at a part for the prompt */
  describe(e: Entity) {
    const load = e.data.load as number | undefined;
    if (load === undefined) return '';
    if (load > 0.85) return ' · трещит под нагрузкой!';
    if (load > 0.5) return ` · нагружено ${Math.round(load * 100)}%`;
    return '';
  }
}

let _snow: THREE.Material | null = null;
function snowMat() {
  if (!_snow) _snow = new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 0.95 });
  return _snow;
}
