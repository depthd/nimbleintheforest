// Wood pieces with real dimensions. Every log, pole, branch, split stick and board is a
// WoodPiece: its mass, name, collider and burn time follow from its size and species,
// and cutting it at a point gives exactly the two parts on either side of the cut.
//
// Frame: the axis runs along local X, u = 0..len from the butt (end 0) to the top (end 1).
// The cross-section lies in the local Y-Z plane; angles around the axis start at +Y
// and turn toward +Z.
import { SPECIES, Species, density } from './species';

export interface Notch {
  /** centre along the axis, m from end 0 */
  u: number;
  /** side the cut comes from: angle around the axis */
  a: number;
  /** depth from the surface, m */
  d: number;
  /** width at the surface, m: a V for an axe, a thin kerf for a saw */
  w: number;
  saw?: boolean;
  /** this cut went through: it only shapes the end now */
  done?: boolean;
}

export interface Branch {
  len: number;
  /** radius at the base, m */
  r: number;
  /** kg of needles on it (spruce, pine) */
  needles: number;
}

/** A group of branches around the stem (a whorl of a spruce, a band of birch branches). */
export interface Whorl {
  u: number;
  /** extent along the axis */
  h: number;
  /** reach of the branches from the axis */
  rad: number;
  branches: Branch[];
  /** how many branches it had on the tree (for drawing a thinned whorl) */
  n0?: number;
  /** crown band of the tree kind used for drawing */
  band: number;
}

/** How a piece's crown was placed on the tree, so it can be drawn the same way. */
export interface CrownRef {
  kind: number;
  sx: number;
  sy: number;
  rotY: number;
  /** tree height of u = 0 */
  base: number;
}

export type Form = 'round' | 'split' | 'sawn';

export interface WoodPiece {
  sp: Species;
  form: Form;
  len: number;
  /** round: radius at u = 0; split: radius of the log it came from */
  r0: number;
  /** round: radius at u = len */
  r1: number;
  /** split: angle of the wedge, rad */
  sector: number;
  /** sawn: width and thickness */
  w: number;
  t: number;
  notches: Notch[];
  whorls: Whorl[];
  crown?: CrownRef;
  /** kg of needles: a spruce bough */
  needles: number;
  /** geometry revision, bumped on every change */
  rev: number;
  vol?: number;
  volRev?: number;
}

export const WOOD_IDS = new Set(['log', 'trunk', 'pole', 'chock', 'sticks', 'boughs', 'firewood', 'kindling', 'plank', 'beam']);

/** What an item of a given id looks like when nothing more is known (loot, old yields). */
export function defaultPiece(id: string, params: Record<string, number> = {}): WoodPiece | null {
  const sp: Species = params.birch ? 'birch' : params.dead ? 'dead' : 'spruce';
  switch (id) {
    case 'log':
      return makeRound(sp, 1.2, 0.125, 0.115);
    case 'trunk':
      return makeRound(sp, 6, 0.18, 0.08);
    case 'pole':
      return makeRound(sp, 2.5, 0.045, 0.03);
    case 'chock':
      return makeRound(sp, 0.5, 0.13, 0.13);
    case 'sticks':
      return makeRound(params.birch ? 'birch' : 'dead', 0.9, 0.016, 0.006);
    case 'boughs': {
      const p = makeRound('spruce', 0.8, 0.014, 0.004);
      p.needles = 0.85;
      return p;
    }
    case 'firewood':
      return makeSplit(sp, 0.4, 0.12, Math.PI / 2);
    case 'kindling':
      return makeSplit(sp === 'birch' ? 'birch' : 'spruce', 0.3, 0.06, 0.9);
    case 'plank':
      return makeSawn('spruce', 1.2, 0.14, 0.024);
    case 'beam':
      return makeSawn('spruce', 2, 0.12, 0.12);
  }
  return null;
}

export function makeRound(sp: Species, len: number, r0: number, r1 = r0): WoodPiece {
  return { sp, form: 'round', len, r0, r1, sector: Math.PI * 2, w: 0, t: 0, notches: [], whorls: [], needles: 0, rev: 0 };
}

export function makeSplit(sp: Species, len: number, r: number, sector: number): WoodPiece {
  return { sp, form: 'split', len, r0: r, r1: r, sector, w: 0, t: 0, notches: [], whorls: [], needles: 0, rev: 0 };
}

export function makeSawn(sp: Species, len: number, w: number, t: number): WoodPiece {
  return { sp, form: 'sawn', len, r0: 0, r1: 0, sector: 0, w, t, notches: [], whorls: [], needles: 0, rev: 0 };
}

export function clonePiece(p: WoodPiece): WoodPiece {
  return {
    ...p,
    notches: p.notches.map((n) => ({ ...n })),
    whorls: p.whorls.map((w) => ({ ...w, branches: w.branches.map((b) => ({ ...b })) })),
    crown: p.crown ? { ...p.crown } : undefined,
    vol: undefined,
    volRev: undefined,
  };
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function radiusAt(p: WoodPiece, u: number) {
  return p.r0 + (p.r1 - p.r0) * clamp(u / p.len, 0, 1);
}

export function maxRadius(p: WoodPiece) {
  if (p.form === 'sawn') return Math.hypot(p.w, p.t) / 2;
  return Math.max(p.r0, p.r1);
}

/** Depth of a notch at a point along the axis. */
export function notchDepthAt(n: Notch, u: number) {
  const half = n.w / 2;
  const x = Math.abs(u - n.u);
  if (x >= half) return 0;
  return n.saw ? n.d : n.d * (1 - x / half);
}

/** Width of an axe notch for a given depth: the faces open at roughly 70°. */
export function axeWidth(d: number) {
  return 1.3 * d + 0.025;
}

export const SAW_KERF = 0.004;

// ---------- cross-sections ----------

/** Equal-area sample points of the unit disk (8 rings, 256 points). */
const DISK: Float32Array = (() => {
  const pts: number[] = [];
  for (let k = 0; k < 8; k++) {
    const rho = Math.sqrt((k + 0.5) / 8);
    const n = 4 * (2 * k + 1);
    for (let j = 0; j < n; j++) {
      const th = ((j + (k % 2) * 0.5) / n) * Math.PI * 2;
      pts.push(rho * Math.cos(th), rho * Math.sin(th));
    }
  }
  return new Float32Array(pts);
})();
const NDISK = DISK.length / 2;

export interface Section {
  /** remaining area, m² */
  area: number;
  /** remaining fraction of the full section */
  frac: number;
  /** centroid of what remains, m (local y, z) */
  cy: number;
  cz: number;
  /** full radius here */
  r: number;
}

function notchesAt(p: WoodPiece, u: number) {
  const out: { ny: number; nz: number; lim: number }[] = [];
  const r = radiusAt(p, u);
  for (const n of p.notches) {
    const d = notchDepthAt(n, u);
    if (d <= 0) continue;
    out.push({ ny: Math.cos(n.a), nz: Math.sin(n.a), lim: r - d });
  }
  return out;
}

/** What remains of a round piece's cross-section at u, after the notches. */
export function sectionAt(p: WoodPiece, u: number): Section {
  const r = radiusAt(p, u);
  const full = Math.PI * r * r;
  const cuts = notchesAt(p, u);
  if (!cuts.length) return { area: full, frac: 1, cy: 0, cz: 0, r };
  let n = 0, sy = 0, sz = 0;
  for (let i = 0; i < NDISK; i++) {
    const y = DISK[i * 2] * r, z = DISK[i * 2 + 1] * r;
    let keep = true;
    for (const c of cuts) if (y * c.ny + z * c.nz > c.lim) { keep = false; break; }
    if (!keep) continue;
    n++;
    sy += y;
    sz += z;
  }
  return { area: (full * n) / NDISK, frac: n / NDISK, cy: n ? sy / n : 0, cz: n ? sz / n : 0, r };
}

/**
 * Section modulus of what remains at u for bending toward direction (my, mz):
 * the stress at the far fibre is M / S. Also returns the area for axial stress.
 */
export function bendingAt(p: WoodPiece, u: number, my: number, mz: number) {
  const r = radiusAt(p, u);
  const cuts = notchesAt(p, u);
  const wgt = (Math.PI * r * r) / NDISK;
  let n = 0, sy = 0, sz = 0;
  const keep = new Uint8Array(NDISK);
  for (let i = 0; i < NDISK; i++) {
    const y = DISK[i * 2] * r, z = DISK[i * 2 + 1] * r;
    let k = 1;
    for (const c of cuts) if (y * c.ny + z * c.nz > c.lim) { k = 0; break; }
    keep[i] = k;
    if (!k) continue;
    n++;
    sy += y;
    sz += z;
  }
  if (!n) return { area: 0, S: 0, cy: 0, cz: 0, edge: 0 };
  const cy = sy / n, cz = sz / n;
  let I = 0, cmax = 0, edge = 0;
  for (let i = 0; i < NDISK; i++) {
    if (!keep[i]) continue;
    const s = (DISK[i * 2] * r - cy) * my + (DISK[i * 2 + 1] * r - cz) * mz;
    I += s * s * wgt;
    if (Math.abs(s) > cmax) cmax = Math.abs(s);
    if (s > edge) edge = s;
  }
  // the samples sit inside the material: the real edge is about half a ring further out
  const pad = r / 16;
  return { area: n * wgt, S: I / (cmax + pad), cy, cz, edge: edge + pad };
}

// ---------- volume and mass ----------

function frustum(r0: number, r1: number, len: number) {
  return (Math.PI * len * (r0 * r0 + r0 * r1 + r1 * r1)) / 3;
}

/** Volume removed by notches between u0 and u1 (round pieces). */
function removedBetween(p: WoodPiece, u0: number, u1: number, steps = 24) {
  u0 = clamp(u0, 0, p.len);
  u1 = clamp(u1, 0, p.len);
  if (u1 <= u0) return 0;
  const h = (u1 - u0) / steps;
  let v = 0;
  for (let i = 0; i <= steps; i++) {
    const u = u0 + i * h;
    const s = sectionAt(p, u);
    const lost = Math.PI * s.r * s.r - s.area;
    v += lost * (i === 0 || i === steps ? 0.5 : 1);
  }
  return v * h;
}

function notchIntervals(p: WoodPiece) {
  const iv = p.notches.map((n) => [n.u - n.w / 2, n.u + n.w / 2] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const x of iv) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}

/** Wood volume of the stem itself, m³ (branches not included). */
export function volume(p: WoodPiece) {
  if (p.vol !== undefined && p.volRev === p.rev) return p.vol;
  let v: number;
  if (p.form === 'sawn') v = p.len * p.w * p.t * (1 - cutFraction(p));
  else if (p.form === 'split') v = 0.5 * p.sector * p.r0 * p.r0 * p.len * (1 - cutFraction(p));
  else {
    v = frustum(p.r0, p.r1, p.len);
    for (const [a, b] of notchIntervals(p)) v -= removedBetween(p, a, b);
  }
  p.vol = Math.max(0, v);
  p.volRev = p.rev;
  return p.vol;
}

/** For sawn and split pieces a cut is tracked as progress through the thickness. */
function cutFraction(p: WoodPiece) {
  let f = 0;
  const thick = p.form === 'sawn' ? p.t : p.r0;
  for (const n of p.notches) f += (n.w * Math.min(1, n.d / Math.max(0.001, thick))) / p.len * (n.saw ? 1 : 0.5);
  return Math.min(0.5, f);
}

/** A branch tapers to 0.3 of its base radius (the same shape it has as a loose piece). */
export const BRANCH_TIP = 0.3;

export function branchMass(b: Branch, sp: Species, moisture: number) {
  const k = 1 + BRANCH_TIP + BRANCH_TIP * BRANCH_TIP;
  return (Math.PI * b.r * b.r * b.len * k * density(sp, moisture)) / 3 + b.needles;
}

export function whorlMass(w: Whorl, sp: Species, moisture: number) {
  let m = 0;
  for (const b of w.branches) m += branchMass(b, sp, moisture);
  return m;
}

export function pieceMass(p: WoodPiece, moisture: number) {
  let m = volume(p) * density(p.sp, moisture) + p.needles;
  for (const w of p.whorls) m += whorlMass(w, p.sp, moisture);
  return m;
}

// ---------- what a piece is ----------

export type WoodCategory = 'trunk' | 'log' | 'chock' | 'pole' | 'sticks' | 'boughs' | 'firewood' | 'kindling' | 'plank' | 'beam';

export function category(p: WoodPiece): WoodCategory {
  if (p.form === 'sawn') return p.t >= 0.07 && p.w >= 0.07 ? 'beam' : 'plank';
  if (p.form === 'split') {
    const width = Math.min(p.r0, 2 * p.r0 * Math.sin(Math.min(Math.PI, p.sector) / 2));
    return width < 0.03 || volume(p) < 0.0006 ? 'kindling' : 'firewood';
  }
  if (p.whorls.length) return 'trunk';
  if (p.needles > 0) return 'boughs';
  const rm = (p.r0 + p.r1) / 2;
  if (rm < 0.025) return 'sticks';
  if (rm < 0.06) return p.len >= 1.0 ? 'pole' : 'firewood';
  return p.len >= 0.8 ? 'log' : 'chock';
}

/** noun and its gender (0 m, 1 f, 2 n) */
const NOUN: Record<WoodCategory, [string, 0 | 1 | 2]> = {
  trunk: ['ствол', 0], log: ['бревно', 2], chock: ['чурбак', 0], pole: ['жердь', 1], sticks: ['ветка', 1], boughs: ['лапник', 0],
  firewood: ['полено', 2], kindling: ['щепа', 1], plank: ['доска', 1], beam: ['брус', 0],
};

export function pieceName(p: WoodPiece) {
  const c = category(p);
  const [noun, g] = NOUN[c];
  if (c === 'boughs') return p.sp === 'pine' ? 'Сосновая ветка с хвоей' : 'Еловый лапник';
  const adj = SPECIES[p.sp].adj[g];
  const s = `${adj} ${noun}`;
  return s[0].toUpperCase() + s.slice(1);
}

const fmtLen = (m: number) => (m < 1 ? `${Math.round(m * 100)} см` : `${m.toFixed(1).replace('.', ',')} м`);

/** Short size description: "2,4 м · ⌀22 см" */
export function pieceSize(p: WoodPiece) {
  if (p.form === 'sawn') return `${fmtLen(p.len)} · ${Math.round(p.w * 100)}×${Math.round(p.t * 100) || 1} см`;
  if (p.form === 'split') return `${fmtLen(p.len)}`;
  const d = Math.round((p.r0 + p.r1) * 100);
  return `${fmtLen(p.len)} · ⌀${d} см`;
}

/** Can it go into the backpack (by size, not weight)? */
export function fitsInPack(p: WoodPiece) {
  const c = category(p);
  if (c === 'sticks' || c === 'boughs') return p.len <= 1.8;
  if (c === 'firewood' || c === 'kindling') return true;
  if (c === 'plank') return p.len <= 1.3;
  return false;
}

/** Small things that go into one weight stack in the inventory. */
export function stacksByWeight(c: string) {
  return c === 'sticks' || c === 'boughs' || c === 'firewood' || c === 'kindling';
}

// ---------- cutting ----------

/** Cut a piece through at u: returns the part from end 0 and the part toward end 1. */
export function cutAt(p: WoodPiece, uc: number): [WoodPiece, WoodPiece] {
  uc = clamp(uc, 0.01, p.len - 0.01);
  const a = clonePiece(p);
  const b = clonePiece(p);
  a.len = uc;
  b.len = p.len - uc;
  if (p.form === 'round') {
    const rc = radiusAt(p, uc);
    a.r1 = rc;
    b.r0 = rc;
  }
  // the notch that went through stays on both ends: that is what the cut faces look like
  const through = (n: Notch) => n.u - n.w / 2 <= uc && n.u + n.w / 2 >= uc;
  a.notches = p.notches.filter((n) => n.u - n.w / 2 < uc).map((n) => ({ ...n, done: n.done || through(n) || undefined }));
  b.notches = p.notches.filter((n) => n.u + n.w / 2 > uc).map((n) => ({ ...n, u: n.u - uc, done: n.done || through(n) || undefined }));
  a.whorls = p.whorls.filter((w) => w.u < uc).map((w) => ({ ...w, branches: w.branches.map((x) => ({ ...x })) }));
  b.whorls = p.whorls.filter((w) => w.u >= uc).map((w) => ({ ...w, u: w.u - uc, branches: w.branches.map((x) => ({ ...x })) }));
  if (b.crown) b.crown.base += uc;
  if (p.needles > 0) {
    // needles sit toward the tip of a bough
    a.needles = p.needles * clamp(uc / p.len, 0, 1) * 0.6;
    b.needles = p.needles - a.needles;
  }
  a.rev = p.rev + 1;
  b.rev = p.rev + 1;
  return [a, b];
}

/** Split a short piece along its length (колка) into two halves. */
export function splitAlong(p: WoodPiece): [WoodPiece, WoodPiece] {
  // keep the wood: a round of the same volume, cut in two
  const r = p.form === 'round' ? Math.sqrt(volume(p) / (Math.PI * p.len)) : p.r0;
  const sector = p.form === 'round' ? Math.PI : p.sector / 2;
  return [makeSplit(p.sp, p.len, r, sector), makeSplit(p.sp, p.len, r, sector)];
}

/** Can the axe split it along the grain? Short rounds and split sticks. */
export function canSplit(p: WoodPiece) {
  if (p.form === 'sawn') return false;
  if (p.form === 'split') return category(p) === 'firewood';
  const c = category(p);
  return c === 'chock' || (c === 'firewood' && (p.r0 + p.r1) / 2 > 0.035);
}

// ---------- chopping progress ----------

/** Removed volume per axe hit of power 1, m³ (about 0.6 litres of chips). */
export const AXE_BITE = 0.0006;
/** Cut area per saw "swing" (a few strokes) of power 1, m². */
export const SAW_BITE = 0.0042;

function findNotch(p: WoodPiece, u: number, a: number, saw: boolean) {
  let best: Notch | null = null;
  let bd = Infinity;
  for (const n of p.notches) {
    if (!!n.saw !== saw || n.done) continue;
    let da = Math.abs(((n.a - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da > 0.9) continue;
    const du = Math.abs(n.u - u);
    if (du > n.w / 2 + 0.035) continue;
    da += du * 4;
    if (da < bd) {
      bd = da;
      best = n;
    }
  }
  return best;
}

/**
 * One hit with an axe (saw = false) or a saw at u from side a. Grows the notch there and
 * returns it. The amount of wood removed per hit is fixed, so thick trunks take
 * quadratically longer than thin ones, and cutting from two sides is quicker.
 */
export function chop(p: WoodPiece, u: number, a: number, power: number, saw: boolean): Notch {
  u = clamp(u, 0.02, p.len - 0.02);
  let n = findNotch(p, u, a, saw);
  if (!n) {
    n = { u, a, d: 0, w: saw ? SAW_KERF : axeWidth(0), saw: saw || undefined };
    p.notches.push(n);
    // too many separate notches: keep the deepest
    if (p.notches.length > 10) {
      p.notches.sort((x, y) => y.d - x.d);
      p.notches.length = 10;
      if (!p.notches.includes(n)) p.notches.push(n);
    }
  }
  const r = p.form === 'round' ? radiusAt(p, n.u) : p.form === 'sawn' ? p.t / 2 : p.r0 / 2;
  const maxD = 2 * r;
  const hard = SPECIES[p.sp].chop;
  if (p.form !== 'round') {
    // boards and split sticks: progress through the thickness
    const thick = p.form === 'sawn' ? p.t : p.r0;
    const width = p.form === 'sawn' ? p.w : p.r0;
    const step = saw ? (SAW_BITE * power) / Math.max(0.02, width) : (AXE_BITE * power * hard) / Math.max(0.0004, width * 0.03);
    n.d = Math.min(thick, n.d + step);
    n.w = saw ? SAW_KERF : 0.03;
    p.rev++;
    return n;
  }
  if (saw) {
    const target = segArea(r, n.d) + SAW_BITE * power;
    n.d = solve((d) => segArea(r, d), target, n.d, maxD);
    n.w = SAW_KERF;
  } else {
    const iv0 = n.u - axeWidth(maxD) / 2, iv1 = n.u + axeWidth(maxD) / 2;
    const before = removedBetween(p, iv0, iv1, 20);
    const target = before + AXE_BITE * power * hard;
    const nn = n;
    const f = (d: number) => {
      nn.d = d;
      nn.w = axeWidth(d);
      return removedBetween(p, iv0, iv1, 20);
    };
    const d = solve(f, target, n.d, maxD);
    n.d = d;
    n.w = axeWidth(d);
  }
  p.rev++;
  return n;
}

/** circular segment area for depth d */
function segArea(r: number, d: number) {
  d = clamp(d, 0, 2 * r);
  const h = r - d;
  return r * r * Math.acos(clamp(h / r, -1, 1)) - h * Math.sqrt(Math.max(0, r * r - h * h));
}

function solve(f: (d: number) => number, target: number, lo: number, hi: number) {
  if (f(hi) <= target) return hi;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Is the piece cut through at a notch? Lying wood tears when only a little is left. */
export function cutThrough(p: WoodPiece, n: Notch, holdFrac = 0.1) {
  if (p.form !== 'round') {
    const thick = p.form === 'sawn' ? p.t : p.r0;
    return n.d >= thick * 0.97;
  }
  let min = 1;
  for (const du of [0, -0.25, 0.25]) {
    const u = n.u + du * (n.saw ? n.w : Math.min(n.w, 0.04));
    if (u <= 0 || u >= p.len) continue;
    min = Math.min(min, sectionAt(p, u).frac);
  }
  return min <= holdFrac;
}

/** The weakest point of a notch: where the remaining section is smallest. */
export function weakestAt(p: WoodPiece, n: Notch) {
  let best = n.u, bf = 2;
  for (let i = -3; i <= 3; i++) {
    const u = n.u + (i / 6) * Math.max(0.005, Math.min(n.w, 0.08));
    if (u <= 0 || u >= p.len) continue;
    const f = sectionAt(p, u).frac;
    if (f < bf) {
      bf = f;
      best = u;
    }
  }
  return best;
}
