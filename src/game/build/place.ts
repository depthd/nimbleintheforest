// Building by hand: put the piece you carry where it is, resting on what is under it.
//
// While you carry a wood piece a ghost shows where it would settle and the prompt says
// what it would rest on and whether it would hold. G puts it there (nailed, if you
// have a hammer and nails), F digs a post in (with a shovel). The statics decide the
// rest: a pole laid across two others holds, a board on one post tips over.
import * as THREE from 'three';
import { G, msg } from '../ctx';
import { Entity } from '../entities';
import type { WoodPiece } from '../wood/piece';
import { buildWoodObject } from '../wood/mesh';
import { analyze, closestSegments, findRests, halfThickness, pointAt, SJoint, SPart } from './statics';
import type { Structure } from './build';

export interface Plan {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  ok: boolean;
  holds: boolean;
  /** it would hold if laid into a groove cut with the axe (logs along logs) */
  holdsGrooved: boolean;
  why: string;
  on: string[];
  structure: Structure | null;
  upright: boolean;
  /** the lower end is at the ground (can be dug in) */
  footOnGround: boolean;
}

const ghostOk = new THREE.MeshBasicMaterial({ color: 0x9fe8a8, transparent: true, opacity: 0.35, depthWrite: false });
const ghostWarn = new THREE.MeshBasicMaterial({ color: 0xf0d070, transparent: true, opacity: 0.35, depthWrite: false });
const ghostBad = new THREE.MeshBasicMaterial({ color: 0xf08080, transparent: true, opacity: 0.3, depthWrite: false });

const WHY: Record<string, string> = {
  unsupported: 'не на что опереться',
  tip: 'перевесит и упадёт — нужна опора под серединой, вторая опора или гвозди',
  bend: 'сломается под нагрузкой',
  buckle: 'слишком тонко — согнётся',
  joint: 'не удержится в креплении',
};

export class Placement {
  plan: Plan | null = null;
  private ghost: THREE.Group | null = null;
  private ghostKey = '';
  private t = 0;

  private carriedWood(): Entity | null {
    const P = G.player;
    const e = P.carried;
    if (!e || !e.data.wood || P.dragging || e.kind !== 'item' || e.removed) return null;
    return e;
  }

  update(dt: number) {
    const e = this.carriedWood();
    if (!e) {
      this.plan = null;
      this.hideGhost();
      return;
    }
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.12;
      this.plan = this.compute(e);
    }
    if (this.plan) this.showGhost(e, this.plan);
  }

  /** Where the carried piece would settle, on what, and whether it would hold. */
  /** How far each point of the piece is above whatever is under it (ground, rocks, parts). */
  private support(me: SPart, self: Entity) {
    const p = me.piece;
    const n = Math.max(3, Math.round(p.len / 0.35));
    let drop = Infinity;
    const hits: { u: number; gap: number; what: Entity | null }[] = [];
    for (let i = 0; i <= n; i++) {
      const u = (p.len * i) / n;
      const c = pointAt(me, u);
      const h = halfThickness(p, u);
      const ray = new G.R.Ray({ x: c.x, y: c.y, z: c.z }, { x: 0, y: -1, z: 0 });
      const hit = G.world.castRay(ray, 3, true, undefined, undefined, G.player.collider, self.body ?? undefined, (col) => {
        const o = G.entities.byCollider.get(col.handle);
        return !o || o.kind === 'part' || o.kind === 'stump' || (o.kind !== 'item' && o.kind !== 'animal');
      });
      let gap = c.y - h - G.terrain.heightAt(c.x, c.z);
      let what: Entity | null = null;
      if (hit && hit.timeOfImpact - h < gap) {
        gap = hit.timeOfImpact - h;
        what = G.entities.byCollider.get(hit.collider.handle) ?? null;
      }
      hits.push({ u, gap, what });
      drop = Math.min(drop, gap);
    }
    // parts of structures right under it: thin pole tops are easy to miss with rays
    const a0 = pointAt(me, 0), a1 = pointAt(me, p.len);
    const flat = (v: THREE.Vector3) => new THREE.Vector3(v.x, 0, v.z);
    for (const s of G.build.structures) {
      for (const o of s.parts.values()) {
        const op = o.data.wood as WoodPiece;
        if (o.position().distanceTo(me.pos) > p.len / 2 + op.len / 2 + 1.5) continue;
        const os = G.build.spart(o);
        const b0 = pointAt(os, 0), b1 = pointAt(os, op.len);
        const c = closestSegments(flat(a0), flat(a1), flat(b0), flat(b1));
        let t = c.t;
        if (flat(b0).distanceTo(flat(b1)) < 0.05) t = b0.y > b1.y ? 0 : 1;
        const ua = c.s * p.len, ub = t * op.len;
        if (c.dist > halfThickness(p, ua) + halfThickness(op, ub) + 0.02) continue;
        const gap = pointAt(me, ua).y - pointAt(os, ub).y - halfThickness(p, ua) - halfThickness(op, ub);
        if (gap < -0.15) continue;
        hits.push({ u: ua, gap, what: o });
        drop = Math.min(drop, gap);
      }
    }
    return { drop, hits };
  }

  /** Where the carried piece would settle, on what, and whether it would hold. */
  compute(e: Entity): Plan | null {
    if (!e.body) return null;
    const p = e.data.wood as WoodPiece;
    const t = e.body.translation(), r = e.body.rotation();
    let pos = new THREE.Vector3(t.x, t.y, t.z), quat = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    let me: SPart = { id: -2, piece: p, pos, quat, moisture: e.moisture };
    const first = this.support(me, e);
    const d0 = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    const plan: Plan = { pos, quat, ok: false, holds: false, holdsGrooved: false, why: '', on: [], structure: null, upright: Math.abs(d0.y) > 0.8, footOnGround: false };
    if (first.drop > 1.2) {
      plan.why = 'Опустите ниже: под ним ничего нет';
      return plan;
    }
    if (first.drop < -0.25) {
      plan.why = 'Мешает: упирается во что-то';
      return plan;
    }
    pos.y -= first.drop;
    // it comes to rest on the first thing it touches, then turns about that point until
    // the other end finds a support too (a pole on two posts of different height,
    // a pole leaning from the ground onto a crossbar)
    const contact = first.hits.filter((h) => h.gap - first.drop <= 0.02).sort((a, b) => a.gap - b.gap)[0];
    if (contact && !plan.upright && Math.abs(contact.u - p.len / 2) > 0.12) {
      const pivot = pointAt(me, contact.u);
      const axisH = new THREE.Vector3().crossVectors(d0, new THREE.Vector3(0, 1, 0));
      if (axisH.lengthSq() > 1e-6) {
        axisH.normalize();
        const farU = contact.u < p.len / 2 ? p.len : 0;
        const farY = pointAt(me, farU).y;
        const turn = (deg: number) => {
          const q = new THREE.Quaternion().setFromAxisAngle(axisH, (deg * Math.PI) / 180);
          return { pos: pos.clone().sub(pivot).applyQuaternion(q).add(pivot), quat: q.multiply(quat.clone()) };
        };
        const probe = turn(1);
        const sign = pointAt({ ...me, pos: probe.pos, quat: probe.quat }, farU).y < farY ? 1 : -1;
        for (let deg = 1; deg <= 60; deg++) {
          const tp = turn(sign * deg);
          const me2: SPart = { ...me, pos: tp.pos, quat: tp.quat };
          const sp = this.support(me2, e);
          const far = sp.hits.filter((h) => Math.abs(h.u - contact.u) > 0.25);
          if (far.length && Math.min(...far.map((h) => h.gap)) <= 0.015) {
            pos = tp.pos;
            quat = tp.quat;
            break;
          }
        }
      }
    }
    plan.pos = pos;
    plan.quat = quat;
    me = { ...me, pos, quat };
    const settled = this.support(me, e);
    const d = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    plan.upright = Math.abs(d.y) > 0.8;
    const hits = settled.hits;
    const drop = 0;
    // what it touches after settling
    const on = new Set<string>();
    let ground = false;
    for (const h of hits) {
      if (h.gap - drop > 0.07) continue;
      if (!h.what) ground = true;
      else if (h.what.kind !== 'part') on.add(h.what.kind === 'stump' ? 'пень' : 'опору');
    }
    const lowEnd = d.y > 0 ? 0 : p.len;
    plan.footOnGround = plan.upright && hits.some((h) => Math.abs(h.u - lowEnd) < 0.01 && !h.what && h.gap - drop < 0.08);
    // parts of structures nearby that it rests on
    const counts = new Map<Structure, number>();
    const joints: SJoint[] = [];
    for (const s of G.build.structures) {
      for (const o of s.parts.values()) {
        if (o.position().distanceTo(pos) > p.len / 2 + (o.data.wood as WoodPiece).len / 2 + 0.5) continue;
        const js = findRests(me, G.build.spart(o));
        if (!js.length) continue;
        counts.set(s, (counts.get(s) ?? 0) + js.length);
        joints.push(...js);
        on.add(o.name.toLowerCase());
      }
    }
    if (ground) on.add('землю');
    plan.on = [...on];
    plan.structure = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (!plan.on.length) {
      plan.why = 'Не на что опереться';
      return plan;
    }
    plan.ok = true;
    // would it hold? the statics of its structure with the new piece
    const parts = new Map<number, SPart>();
    const all: SJoint[] = [...joints];
    // every structure it touches: they will become one
    for (const st of counts.keys()) {
      for (const [id, o] of st.parts) parts.set(id, G.build.spart(o));
      all.push(...st.joints);
    }
    parts.set(me.id, me);
    for (const h of hits) if (h.gap <= 0.07 && (!h.what || h.what.kind !== 'part')) all.push({ a: me.id, ua: h.u, b: -1, ub: 0, kind: 'rest', n: new THREE.Vector3(0, 1, 0) });
    const res = analyze(parts, all, (plan.structure?.snow ?? 0) * 160);
    const mine = res.failures.find((f) => f.part === me.id);
    plan.holds = !mine && !res.failures.some((f) => f.why !== 'unsupported' && f.part !== me.id);
    plan.why = mine ? WHY[mine.why] ?? 'не удержится' : !plan.holds ? 'под ним что-то сломается' : '';
    // a round log on a round log rolls off unless a groove is cut along its underside
    if (!plan.holds && mine?.why === 'tip' && p.form === 'round' && !plan.upright) {
      const grooved = all.map((j) => (j.a === me.id && j.b >= 0 && j.kind === 'rest' ? { ...j, kind: 'notch' as const } : j));
      const res2 = analyze(parts, grooved, (plan.structure?.snow ?? 0) * 160);
      plan.holdsGrooved = !res2.failures.some((f) => f.part === me.id) && !res2.failures.some((f) => f.why !== 'unsupported');
      if (plan.holdsGrooved) plan.why = 'скатится — нужен паз (топор)';
    }
    return plan;
  }

  private showGhost(e: Entity, plan: Plan) {
    const p = e.data.wood as WoodPiece;
    const key = `${e.id}:${p.rev}`;
    if (!this.ghost || this.ghostKey !== key) {
      this.hideGhost();
      this.ghost = buildWoodObject(p);
      this.ghost.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = false;
        }
      });
      this.ghostKey = key;
      G.scene.add(this.ghost);
    }
    const mat = !plan.ok ? ghostBad : plan.holds ? ghostOk : ghostWarn;
    this.ghost.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) m.material = mat;
    });
    this.ghost.position.copy(plan.pos);
    this.ghost.quaternion.copy(plan.quat);
    this.ghost.visible = true;
  }

  private hideGhost() {
    if (!this.ghost) return;
    this.ghost.removeFromParent();
    this.ghost.traverse((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.dispose());
    this.ghost = null;
    this.ghostKey = '';
  }

  /** Prompt text for the carried piece. */
  info(): string {
    const pl = this.plan;
    if (!pl) return '';
    if (!pl.ok) return pl.why;
    if (pl.upright && pl.footOnGround && !pl.holds) {
      return G.player.hasTag('shovel') ? 'стоймя не устоит — вкопайте [F]' : 'стоймя не устоит — нужна лопата, чтобы вкопать';
    }
    const on = pl.on.length ? `ляжет на ${pl.on.slice(0, 3).join(', ')}` : '';
    if (!pl.holds && pl.holdsGrooved) return `${on} · ${G.player.hasTag('axe') ? 'скатится — уложите в паз [F]' : 'скатится — нужен топор, чтобы вырубить паз'}`;
    return pl.holds ? `${on} · удержится` : `${on} · ${pl.why}`;
  }

  /** Put the carried piece where the ghost is. */
  place(opts: { nails?: boolean; dig?: boolean; groove?: boolean } = {}) {
    const e = this.carriedWood();
    if (!e) return;
    const plan = this.compute(e);
    if (!plan || !plan.ok) {
      msg(plan?.why ?? 'Не получится', 'warn');
      return;
    }
    const P = G.player;
    P.releaseCarry();
    G.entities.removeFromWorld(e);
    const p = e.data.wood as WoodPiece;
    let s = plan.structure;
    if (!s) s = G.build.structure(p.needles > 0 ? 'Настил' : 'Постройка');
    const pos = plan.pos.clone();
    if (opts.dig) pos.y -= 0.45;
    const roof = p.needles > 0 ? 0.5 : p.form === 'sawn' ? p.w : 0;
    G.build.adopt(s, e, pos, plan.quat, roof);
    let nails = 0;
    const box = opts.nails ? P.has((x) => x.defId === 'nails' && x.charges >= 2) : null;
    const found = G.build.connect(s, e, { groundKind: opts.dig ? 'set' : 'rest', nails: box ? 2 : undefined, restKind: opts.groove ? 'notch' : undefined });
    if (opts.groove) G.audio.play('chop', { pos });
    if (box) {
      nails = Math.min(box.charges, 2 * Math.max(1, s.joints.filter((j) => j.a === e.id && j.kind === 'nail').length));
      box.charges -= nails;
      if (box.charges <= 0) G.entities.destroy(box);
      G.audio.play('hammer', { pos });
    } else G.audio.play('drop', { pos });
    s.built = Math.max(s.built, s.parts.size);
    G.build.check(s);
    if (e.kind === 'part') msg(`${e.name}: ${opts.dig ? 'вкопано' : nails ? `прибито (гвоздей: ${nails})` : opts.groove ? 'уложено в паз' : 'поставлено'}${found ? '' : ' (на весу?)'}`, 'good');
    else msg(`${e.name} не удержалось: ${plan.why || 'нет опоры'}`, 'warn');
  }
}
