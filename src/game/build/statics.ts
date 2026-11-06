// Statics of wooden structures: which parts hold, which bend, tip over or break.
//
// A structure is a set of wood pieces in fixed poses and the joints between them:
// a piece rests on another one (or on the ground), is dug into the ground, nailed
// or notched into it. Loads go down the "rests on" graph: every piece carries its
// own weight, the snow on it and whatever rests on it, and passes this to the
// pieces it rests on in proportion to where they hold it (the lever rule). Then
// each piece is checked like a beam or a column:
//
// - bending: moment / section modulus (a notch makes the section weaker right there);
// - compression and buckling for posts (Euler: a long thin pole buckles first);
// - joints: a piece that merely rests on another can only be pushed, never pulled,
//   so if the load would have to hang from that support, the piece tips over;
//   a single resting support must have the load right above it;
// - nothing below at all: the piece falls.
//
// Pure maths on plain data, so it can be tested without the game.
import * as THREE from 'three';
import { bendingAt, radiusAt, sectionAt, WoodPiece } from '../wood/piece';
import { density, SPECIES } from '../wood/species';

export type JointKind = 'rest' | 'set' | 'nail' | 'notch';

export interface SPart {
  id: number;
  piece: WoodPiece;
  /** pose of the piece frame (axis along local X, centred) */
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  moisture: number;
  /** width of roof surface this piece carries, m (for snow) */
  roof?: number;
}

export interface SJoint {
  /** the piece that is held */
  a: number;
  ua: number;
  /** the piece that holds it, or -1 for the ground */
  b: number;
  ub: number;
  kind: JointKind;
  /** contact normal, pointing from b toward a (world) */
  n: THREE.Vector3;
  /** nails in a nailed joint */
  nails?: number;
}

export interface SLoad {
  part: number;
  u: number;
  F: THREE.Vector3;
}

export type FailWhy = 'unsupported' | 'tip' | 'bend' | 'buckle' | 'joint';

export interface Failure {
  part: number;
  why: FailWhy;
  /** where along the piece */
  u: number;
  ratio: number;
}

export interface PartState {
  /** worst stress over strength anywhere in the piece (1 = breaks) */
  ratio: number;
  u: number;
  why: FailWhy | null;
  /** force on each of its supports, N */
  reactions: { joint: SJoint; R: THREE.Vector3 }[];
  /** axial force, N (positive = compression) */
  N: number;
}

export interface Analysis {
  failures: Failure[];
  state: Map<number, PartState>;
}

const g = 9.81;
/** fraction of short-term strength used for lasting loads on old, knotty wood */
export const STRUCT_STRENGTH = 0.5;
/** shear a nail takes before it pulls out or bends, N */
export const NAIL_CAP = 900;
/** bending moment a post dug into frozen ground holds: grows with the square of the depth, N·m/m² */
export const SET_MOMENT = 12000;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export function axisOf(p: SPart, out = new THREE.Vector3()) {
  return out.set(1, 0, 0).applyQuaternion(p.quat);
}

/** World point at u along a part's axis. */
export function pointAt(p: SPart, u: number, out = new THREE.Vector3()) {
  return axisOf(p, out).multiplyScalar(u - p.piece.len / 2).add(p.pos);
}

/** a basis across the axis: t1 in the vertical plane through the axis (or any), t2 horizontal */
function transverse(d: THREE.Vector3) {
  let t1 = DOWN.clone().addScaledVector(d, -DOWN.dot(d));
  if (t1.lengthSq() < 1e-6) t1 = new THREE.Vector3(1, 0, 0).addScaledVector(d, -d.x);
  t1.normalize();
  const t2 = new THREE.Vector3().crossVectors(d, t1).normalize();
  return [t1, t2] as const;
}

/** cross-section properties of any piece at u for bending toward local (my, mz) */
function sectionProps(p: WoodPiece, u: number, my: number, mz: number) {
  if (p.form === 'sawn') {
    let t = p.t;
    for (const n of p.notches) if (Math.abs(u - n.u) <= n.w / 2 + 0.01) t = Math.max(0.002, t - n.d);
    const Sy = (p.w * t * t) / 6, Sz = (t * p.w * p.w) / 6;
    const inv = Math.abs(my) / Sy + Math.abs(mz) / Sz;
    return { S: 1 / inv, A: p.w * t, I: (p.w * t * t * t) / 12 };
  }
  if (p.form === 'split') {
    const re = p.r0 * Math.sqrt(p.sector / (Math.PI * 2));
    return { S: (Math.PI * re ** 3) / 4, A: Math.PI * re * re, I: (Math.PI * re ** 4) / 4 };
  }
  const b = bendingAt(p, u, my, mz);
  const r = radiusAt(p, u);
  return { S: b.S, A: b.area, I: (Math.PI * r ** 4) / 4 };
}

function sliceMass(p: WoodPiece, u0: number, u1: number, rho: number) {
  const u = (u0 + u1) / 2;
  if (p.form === 'sawn') return p.w * p.t * (u1 - u0) * rho;
  if (p.form === 'split') return 0.5 * p.sector * p.r0 * p.r0 * (u1 - u0) * rho;
  return sectionAt(p, u).area * (u1 - u0) * rho;
}

/** Order parts so that every part comes before the parts it rests on. Cycles are cut. */
function loadOrder(ids: number[], held: Map<number, SJoint[]>) {
  const out: number[] = [];
  const state = new Map<number, number>();
  const cut = new Set<SJoint>();
  // DFS on "a rests on b": emit a part after everything resting on it... done by reversing a post-order on supports
  const restingOn = new Map<number, SJoint[]>();
  for (const id of ids) restingOn.set(id, []);
  for (const [, js] of held) for (const j of js) if (j.b >= 0 && restingOn.has(j.b)) restingOn.get(j.b)!.push(j);
  const visit = (id: number) => {
    state.set(id, 1);
    for (const j of restingOn.get(id) ?? []) {
      const s = state.get(j.a) ?? 0;
      if (s === 1) cut.add(j);
      else if (s === 0) visit(j.a);
    }
    state.set(id, 2);
    out.push(id);
  };
  for (const id of ids) if (!state.get(id)) visit(id);
  return { order: out, cut };
}

/** Which parts have a chain of supports down to the ground. */
export function supported(parts: Map<number, SPart>, joints: SJoint[]) {
  const ok = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const j of joints) {
      if (ok.has(j.a) || !parts.has(j.a)) continue;
      if (j.b === -1 || ok.has(j.b)) {
        ok.add(j.a);
        changed = true;
      }
    }
  }
  return ok;
}

export function analyze(parts: Map<number, SPart>, joints: SJoint[], snowKgM2 = 0, extra: SLoad[] = []): Analysis {
  const failures: Failure[] = [];
  const state = new Map<number, PartState>();
  const live = joints.filter((j) => parts.has(j.a) && (j.b === -1 || parts.has(j.b)));
  const ok = supported(parts, live);
  for (const id of parts.keys()) if (!ok.has(id)) failures.push({ part: id, why: 'unsupported', u: 0, ratio: Infinity });
  const held = new Map<number, SJoint[]>();
  for (const j of live) {
    if (!ok.has(j.a) || (j.b >= 0 && !ok.has(j.b))) continue;
    if (!held.has(j.a)) held.set(j.a, []);
    held.get(j.a)!.push(j);
  }
  const ids = [...ok];
  const { order, cut } = loadOrder(ids, held);
  // incoming loads from what rests on each part
  const incoming = new Map<number, SLoad[]>();
  for (const l of extra) {
    if (!incoming.has(l.part)) incoming.set(l.part, []);
    incoming.get(l.part)!.push(l);
  }
  // the order has every part before the parts it rests on: loads flow down
  for (const id of order) {
    const sp = parts.get(id)!;
    const p = sp.piece;
    const d = axisOf(sp);
    const [t1, t2] = transverse(d);
    const rho = density(p.sp, sp.moisture);
    const forces: { u: number; F: THREE.Vector3 }[] = [];
    // own weight and snow, in slices
    const n = Math.max(6, Math.min(16, Math.round(p.len / 0.25)));
    const horiz = Math.sqrt(Math.max(0, 1 - d.y * d.y));
    for (let i = 0; i < n; i++) {
      const u0 = (p.len * i) / n, u1 = (p.len * (i + 1)) / n;
      let m = sliceMass(p, u0, u1, rho);
      if (sp.roof && snowKgM2 > 0) m += snowKgM2 * sp.roof * (u1 - u0) * horiz;
      forces.push({ u: (u0 + u1) / 2, F: DOWN.clone().multiplyScalar(m * g) });
    }
    for (const l of incoming.get(id) ?? []) forces.push({ u: l.u, F: l.F.clone() });
    const sup = (held.get(id) ?? []).filter((j) => !cut.has(j));
    const st: PartState = { ratio: 0, u: p.len / 2, why: null, reactions: [], N: 0 };
    state.set(id, st);
    if (!sup.length) {
      failures.push({ part: id, why: 'unsupported', u: 0, ratio: Infinity });
      continue;
    }
    const R = sup.map(() => new THREE.Vector3());
    // supports at (nearly) the same point act together: a log lying in the valley of two
    const raw = sup.map((j, i) => ({ j, i, u: j.ua })).sort((a, b) => a.u - b.u);
    const sorted: { u: number; members: number[]; j: SJoint; i: number }[] = [];
    for (const x of raw) {
      const last = sorted[sorted.length - 1];
      if (last && x.u - last.u < 0.08) last.members.push(x.i);
      else sorted.push({ u: x.u, members: [x.i], j: x.j, i: x.i });
    }
    const share = (st: { members: number[] }, v: THREE.Vector3, k: number) => {
      for (const i of st.members) R[i].addScaledVector(v, k / st.members.length);
    };
    // the support that takes the push along the axis: dug in, nailed, or the lowest one
    const axial = sup.reduce((best, j, i) => {
      const score = (j.kind === 'set' ? -100 : j.kind === 'nail' ? -10 : 0) + pointAt(sp, j.ua).y;
      return score < best.score ? { i, score } : best;
    }, { i: 0, score: Infinity }).i;
    let comp = 0;
    const ua = sup[axial].ua;
    for (const f of forces) {
      const fa = f.F.dot(d);
      const ft = f.F.clone().addScaledVector(d, -fa);
      R[axial].addScaledVector(d, -fa);
      if ((fa < 0 && f.u > ua) || (fa > 0 && f.u < ua)) comp += Math.abs(fa);
      if (sorted.length === 1) {
        share(sorted[0], ft, -1);
        continue;
      }
      // lever rule between the two supports around the load (or the two nearest)
      let k = 0;
      while (k < sorted.length - 2 && f.u > sorted[k + 1].u) k++;
      const s0 = sorted[k], s1 = sorted[k + 1];
      const span = Math.max(1e-3, s1.u - s0.u);
      const w1 = (f.u - s0.u) / span;
      share(s1, ft, -w1);
      share(s0, ft, -(1 - w1));
    }
    st.N = comp;
    // bending moments along the piece (transverse forces and reactions)
    const items = forces.map((f) => ({ u: f.u, F: f.F.clone().addScaledVector(d, -f.F.dot(d)) }));
    sup.forEach((j, i) => items.push({ u: j.ua, F: R[i].clone().addScaledVector(d, -R[i].dot(d)) }));
    const single = sorted.length === 1 ? sorted[0].u : null;
    const xs: number[] = [];
    for (let i = 0; i <= 24; i++) xs.push((p.len * i) / 24);
    for (const nn of p.notches) if (!nn.done) xs.push(nn.u);
    const qi = sp.quat.clone().invert();
    const strength = SPECIES[p.sp].mor * 1e6 * STRUCT_STRENGTH;
    for (const x of xs) {
      if (x <= 0 || x >= p.len) continue;
      const M = new THREE.Vector3();
      const fromRight = single !== null && x > single;
      for (const it of items) {
        if (fromRight ? it.u > x : it.u < x) M.addScaledVector(it.F, Math.abs(x - it.u));
      }
      const m = M.length();
      if (m < 1e-6 && comp < 1e-6) continue;
      // direction of the bend across the section (when there is hardly any moment, any will do)
      const loc = M.clone().applyQuaternion(qi);
      const ll = Math.hypot(loc.y, loc.z);
      const my = m > 1e-3 && ll > 1e-9 ? loc.y / ll : 1, mz = m > 1e-3 && ll > 1e-9 ? loc.z / ll : 0;
      const sec = sectionProps(p, x, my, mz);
      const sigma = (sec.S > 0 ? m / sec.S : Infinity) + (sec.A > 0 ? comp / sec.A : Infinity);
      const ratio = sigma / strength;
      if (ratio > st.ratio) {
        st.ratio = ratio;
        st.u = x;
        st.why = 'bend';
      }
    }
    // buckling of a column
    if (comp > 0 && p.form !== 'split') {
      const top = sup.some((j) => Math.abs(j.ua - ua) > p.len * 0.5);
      const K = top ? 1 : 2;
      const mid = sectionProps(p, p.len / 2, 0, 1);
      const Ncr = (Math.PI * Math.PI * SPECIES[p.sp].E * 1e9 * mid.I) / ((K * p.len) ** 2);
      const rb = comp / Ncr;
      if (rb > st.ratio) {
        st.ratio = rb;
        st.u = p.len / 2;
        st.why = 'buckle';
      }
    }
    // a round piece on a single rounded contact rolls or slides off unless the contact is
    // nearly level; two contacts on both sides (a valley) hold it
    if (p.form === 'round') {
      for (const stn of sorted) {
        const rest = stn.members.map((i) => sup[i]).filter((j) => j.kind === 'rest');
        if (rest.length !== stn.members.length || !rest.length) continue;
        const sum = rest.reduce((v, j) => v.add(j.n), new THREE.Vector3());
        const spread = rest.length > 1 && rest.some((j) => j.n.clone().sub(rest[0].n).lengthSq() > 0.1);
        const tiltd = Math.acos(Math.min(1, Math.max(-1, sum.clone().normalize().y)));
        if (!spread && tiltd > 0.5 && Math.abs(d.y) < 0.7) {
          if (1.5 > st.ratio) Object.assign(st, { ratio: 1.5, u: stn.u, why: 'tip' as FailWhy });
        }
      }
    }
    // joints: resting supports can only push; one resting support must be right under the load
    sup.forEach((j, i) => {
      const r = R[i];
      st.reactions.push({ joint: j, R: r.clone() });
      if (j.kind === 'rest' || j.kind === 'notch') {
        const push = r.dot(j.n);
        if (push < -0.05 * r.length() - 2) {
          const ratio = 1 + -push / Math.max(1, r.length());
          if (ratio > st.ratio) Object.assign(st, { ratio, u: j.ua, why: 'tip' as FailWhy });
        }
      }
      if (j.kind === 'nail') {
        const ratio = r.length() / (NAIL_CAP * (j.nails ?? 2));
        if (ratio > st.ratio) Object.assign(st, { ratio, u: j.ua, why: 'joint' as FailWhy });
      }
    });
    if (single !== null) {
      // a lone support: what it can hold as a moment
      const j = sorted[0].j;
      const M = new THREE.Vector3();
      for (const it of items) M.addScaledVector(it.F, it.u - single);
      const mom = M.length();
      const r = sorted[0].members.reduce((v, i) => v.add(R[i]), new THREE.Vector3()).length();
      const depth = j.ua < p.len / 2 ? j.ua : p.len - j.ua;
      const cap = j.kind === 'set' ? SET_MOMENT * Math.max(0.1, depth) ** 2 : j.kind === 'nail' ? 60 * (j.nails ?? 2) : r * Math.max(0.02, (p.form === 'sawn' ? p.t : radiusAt(p, j.ua)) * 0.6);
      const ratio = mom / Math.max(1e-6, cap);
      if (ratio > st.ratio) Object.assign(st, { ratio, u: j.ua, why: (j.kind === 'set' || j.kind === 'nail' ? 'joint' : 'tip') as FailWhy });
      // a slender pole standing on its end with nothing holding it falls over at the first touch
      const thick = p.form === 'sawn' ? Math.min(p.w, p.t) : 2 * radiusAt(p, j.ua);
      if ((j.kind === 'rest' || j.kind === 'notch') && Math.abs(d.y) > 0.7 && p.len > 3 * thick) {
        if (2 > st.ratio) Object.assign(st, { ratio: 2, u: j.ua, why: 'tip' as FailWhy });
      }
    }
    if (st.ratio > 1) failures.push({ part: id, why: st.why ?? 'bend', u: st.u, ratio: st.ratio });
    // pass the load on
    sup.forEach((j, i) => {
      if (j.b < 0) return;
      if (!incoming.has(j.b)) incoming.set(j.b, []);
      incoming.get(j.b)!.push({ part: j.b, u: j.ub, F: R[i].clone().negate() });
    });
  }
  return { failures, state };
}

// ---------- finding joints from geometry ----------

/** Closest points between two segments: returns parameters along each (0..1) and the distance. */
export function closestSegments(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) return { s, t, dist: r.length() };
  if (a <= 1e-9) t = Math.min(1, Math.max(0, f / e));
  else {
    const c = d1.dot(r);
    if (e <= 1e-9) s = Math.min(1, Math.max(0, -c / a));
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s), c2 = p2.clone().addScaledVector(d2, t);
  return { s, t, dist: c1.distanceTo(c2), c1, c2 };
}

/** half thickness of a piece across its axis (radius, or half the board) */
export function halfThickness(p: WoodPiece, u: number) {
  if (p.form === 'sawn') return p.t / 2;
  if (p.form === 'split') return p.r0 / 2;
  return radiusAt(p, u);
}

/**
 * Contacts where piece a lies on piece b: closest approach of their axes within the sum
 * of their thicknesses (plus a tolerance), with a above b. Parallel pieces touch along
 * their overlap, so they are sampled every half metre.
 */
export function findRests(a: SPart, b: SPart, tol = 0.04): SJoint[] {
  const out: SJoint[] = [];
  const a0 = pointAt(a, 0), a1 = pointAt(a, a.piece.len);
  const b0 = pointAt(b, 0), b1 = pointAt(b, b.piece.len);
  const da = axisOf(a), db = axisOf(b);
  const parallel = Math.abs(da.dot(db)) > 0.95;
  const tryAt = (s: number, t: number) => {
    const ua = s * a.piece.len, ub = t * b.piece.len;
    const ca = pointAt(a, ua), cb = pointAt(b, ub);
    const gap = ca.distanceTo(cb) - halfThickness(a.piece, ua) - halfThickness(b.piece, ub);
    if (gap > tol) return;
    const nrm = ca.clone().sub(cb);
    if (nrm.lengthSq() < 1e-8) nrm.copy(UP);
    nrm.normalize();
    // a lies on b only if it is above it (the contact normal points up enough)
    if (nrm.y < 0.25) return;
    if (out.some((j) => Math.abs(j.ua - ua) < 0.3)) return;
    out.push({ a: a.id, ua, b: b.id, ub, kind: 'rest', n: nrm });
  };
  if (!parallel) {
    const c = closestSegments(a0, a1, b0, b1);
    tryAt(c.s, c.t);
  } else {
    const steps = Math.max(1, Math.ceil(a.piece.len / 0.5));
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const pa = pointAt(a, s * a.piece.len);
      const t = Math.min(1, Math.max(0, pa.clone().sub(b0).dot(db) / b.piece.len));
      tryAt(s, t);
    }
  }
  return out;
}
