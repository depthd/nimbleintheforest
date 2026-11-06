// Cliffs welded into the heightfield.
//
// The heightfield ("the sheet") can only hold one height per point, so it cannot show
// overhangs or real rock faces. A cliff is therefore built as separate rock: horizontal
// strata cut into faceted blocks. Soft strata weather back and hard ones stand out, so
// ledges, overhanging caprock and walk-in undercuts come from the same rule.
//
// The rock is generated first; the sheet is reshaped afterwards from the actual blocks so
// that, wherever the face hides it, the heightfield stays inside the rock. In front of
// the face the sheet becomes a talus apron, under an undercut it becomes a flat floor,
// and behind the face it rises to the plateau only where the rock above already covers it.
//
// Pure data: no Three.js or Rapier here. world/cliffs.ts draws and collides the result.
import { Rng, Simplex2, clamp, lerp, smoothstep } from '../core/rng';

export interface CliffSpec {
  id: string;
  seed: number;
  /** control points of the face foot line */
  path: { x: number; z: number }[];
  /** a closed loop is a free-standing pillar or tor, with rock inside the loop */
  closed?: boolean;
  /** open paths: any point on the rock side (e.g. the middle of the plateau) */
  inside?: { x: number; z: number };
  /** per control point: top of the rock (the plateau level behind an open cliff) */
  top: number[];
  /** per control point: ground at the foot of the exposed face (top of the talus) */
  base: number[];
  /** a walk-in undercut at the foot, between s0 and s1 metres along the path */
  undercut?: { s0: number; s1: number; depth: number; height: number };
  /** how far the caprock sticks out beyond the face, metres */
  overhang?: number;
  /** strata thickness ranges for soft and hard layers */
  soft?: [number, number];
  hard?: [number, number];
  /** at open ends the exposed face fades out over this length; 0 when `base` already tapers */
  taper?: number;
}

/** Heights the stamp blends towards: the ground in front and the plateau behind. */
export interface CliffGround {
  lower(x: number, z: number): number;
  upper(x: number, z: number): number;
}

export type BlockKind = 'face' | 'cap' | 'rubble' | 'boulder' | 'skin';

/** A faceted block: stacked rings of n points, bottom first. Sides join consecutive rings;
 * the first and last rings are closed with fans around their centroids. */
export interface CliffBlock {
  kind: BlockKind;
  n: number;
  rings: number;
  /** ring points, world space, xyz */
  pts: Float32Array;
  /** 0..1 strata tone */
  tone: number;
  layer: number;
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
}

export interface CliffShelter { x: number; z: number; yaw: number; hx: number; hz: number; y0: number; y1: number }

export interface CliffMesh { positions: Float32Array; indices: Uint32Array }

const TALUS = Math.tan((31 * Math.PI) / 180);
const BURY = 0.9; // strata start below the foot so the floor stays hidden under them
const GRID_REACH = 2.9; // one diagonal of the 2 m sheet grid: interpolation can lean this far
const MARGIN = 0.35;
const BIN = 0.25;
const OVERLAP = 0.2; // each block reaches this far down into the layer below
// largest amount a block's front can lie behind its layer recess (jitter, lean, chamfer)
const FRONT_SLACK = 0.55 + 0.12 + 0.45 + 0.4 + 0.45 * 1.4 + 0.1;

// ---------- path frame ----------

class Frame {
  readonly ds = 0.5;
  x: number[] = []; z: number[] = []; tx: number[] = []; tz: number[] = []; nx: number[] = []; nz: number[] = [];
  top: number[] = []; base: number[] = []; s: number[] = [];
  length = 0;
  cx = 0; cz = 0;
  minX = Infinity; maxX = -Infinity; minZ = Infinity; maxZ = -Infinity;

  constructor(readonly spec: CliffSpec) {
    const P = spec.path, closed = !!spec.closed, n = P.length;
    const at = (i: number) => (closed ? P[((i % n) + n) % n] : P[clamp(i, 0, n - 1)]);
    const val = (arr: number[], i: number) => (closed ? arr[((i % n) + n) % n] : arr[clamp(i, 0, n - 1)]);
    const segs = closed ? n : n - 1;
    let s = 0, lastX = NaN, lastZ = NaN, since = Infinity;
    for (let i = 0; i < segs; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      const k = Math.max(4, Math.ceil(len / 0.1));
      for (let j = i === 0 ? 0 : 1; j <= k; j++) {
        const t = j / k, t2 = t * t, t3 = t2 * t;
        const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        const x = cr(p0.x, p1.x, p2.x, p3.x), z = cr(p0.z, p1.z, p2.z, p3.z);
        if (!Number.isNaN(lastX)) { const d = Math.hypot(x - lastX, z - lastZ); s += d; since += d; }
        lastX = x; lastZ = z;
        const last = i === segs - 1 && j === k;
        if (closed && last) break; // the loop returns to its first sample
        if (since >= this.ds || this.x.length === 0 || last) {
          if (last && since < this.ds * 0.45 && this.x.length > 2) { this.x.pop(); this.z.pop(); this.s.pop(); this.top.pop(); this.base.pop(); }
          this.x.push(x); this.z.push(z); this.s.push(s);
          this.top.push(lerp(val(spec.top, i), val(spec.top, i + 1), t));
          this.base.push(lerp(val(spec.base, i), val(spec.base, i + 1), t));
          since = 0;
        }
      }
    }
    if (!closed && this.x.length > 4) {
      // Ease out kinks shorter than a few metres: where the path turns tightly towards the
      // rock, the normals cross before the rock's full depth.
      const X = this.x, Z = this.z;
      for (let it = 0; it < 80; it++) for (let i = 1; i < X.length - 1; i++) {
        X[i] = 0.5 * X[i] + 0.25 * (X[i - 1] + X[i + 1]);
        Z[i] = 0.5 * Z[i] + 0.25 * (Z[i - 1] + Z[i + 1]);
      }
      s = 0;
      for (let i = 1; i < X.length; i++) { s += Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]); this.s[i] = s; }
    }
    this.length = closed ? s : this.s[this.s.length - 1];
    const m = this.x.length;
    for (let i = 0; i < m; i++) { this.cx += this.x[i] / m; this.cz += this.z[i] / m; }
    for (let i = 0; i < m; i++) {
      const a = closed ? (i - 1 + m) % m : Math.max(0, i - 1), b = closed ? (i + 1) % m : Math.min(m - 1, i + 1);
      let tx = this.x[b] - this.x[a], tz = this.z[b] - this.z[a];
      const L = Math.hypot(tx, tz) || 1;
      tx /= L; tz /= L;
      this.tx.push(tx); this.tz.push(tz);
      this.nx.push(tz); this.nz.push(-tx);
      this.minX = Math.min(this.minX, this.x[i]); this.maxX = Math.max(this.maxX, this.x[i]);
      this.minZ = Math.min(this.minZ, this.z[i]); this.maxZ = Math.max(this.maxZ, this.z[i]);
    }
    // rock lies on the side of the normal: towards the inside of a loop, and for an
    // open cliff towards the given inside point
    let inward = 0;
    const ix = closed ? this.cx : spec.inside?.x ?? this.cx, iz = closed ? this.cz : spec.inside?.z ?? this.cz;
    for (let i = 0; i < m; i++) inward += (ix - this.x[i]) * this.nx[i] + (iz - this.z[i]) * this.nz[i];
    if (inward < 0) for (let i = 0; i < m; i++) { this.nx[i] = -this.nx[i]; this.nz[i] = -this.nz[i]; }
  }

  get count() { return this.x.length; }
  /** sample index nearest to arc length s */
  index(s: number) {
    const m = this.count;
    if (this.spec.closed) s = ((s % this.length) + this.length) % this.length;
    // samples are close to evenly spaced: start from the estimate, then walk
    let i = clamp(Math.round((s / this.length) * (m - 1)), 0, m - 1);
    while (i > 0 && this.s[i] > s) i--;
    while (i < m - 1 && this.s[i + 1] <= s) i++;
    if (i < m - 1 && s - this.s[i] > this.s[i + 1] - s) i++;
    return i;
  }
  /** world position of (s, v): v metres along the inward normal */
  point(s: number, v: number) {
    const m = this.count;
    if (this.spec.closed) s = ((s % this.length) + this.length) % this.length;
    s = clamp(s, 0, this.length);
    let i = this.index(s);
    if (this.s[i] > s && i > 0) i--;
    const j = this.spec.closed ? (i + 1) % m : Math.min(m - 1, i + 1);
    const span = (j > i ? this.s[j] : this.length) - this.s[i];
    const t = span > 1e-6 ? clamp((s - this.s[i]) / span, 0, 1) : 0;
    const x = lerp(this.x[i], this.x[j], t), z = lerp(this.z[i], this.z[j], t);
    let nx = lerp(this.nx[i], this.nx[j], t), nz = lerp(this.nz[i], this.nz[j], t);
    const L = Math.hypot(nx, nz) || 1;
    nx /= L; nz /= L;
    return { x: x + nx * v, z: z + nz * v, top: lerp(this.top[i], this.top[j], t), base: lerp(this.base[i], this.base[j], t) };
  }
  /** nearest point on the path: arc length, signed inward distance, distance beyond an open end */
  project(x: number, z: number) {
    const m = this.count, segs = this.spec.closed ? m : m - 1;
    let best = Infinity, bs = 0, bi = 0, bt = 0;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % m;
      const ax = this.x[i], az = this.z[i], dx = this.x[j] - ax, dz = this.z[j] - az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
      const px = ax + dx * t - x, pz = az + dz * t - z;
      const d = px * px + pz * pz;
      if (d < best) { best = d; bi = i; bt = t; bs = this.s[i] + (j > i ? this.s[j] - this.s[i] : this.length - this.s[i]) * t; }
    }
    const j = (bi + 1) % m;
    const nx = lerp(this.nx[bi], this.nx[j], bt), nz = lerp(this.nz[bi], this.nz[j], bt);
    const fx = lerp(this.x[bi], this.x[j], bt), fz = lerp(this.z[bi], this.z[j], bt);
    const v = ((x - fx) * nx + (z - fz) * nz) / (Math.hypot(nx, nz) || 1);
    let beyond = 0;
    if (!this.spec.closed) {
      if (bi === 0 && bt === 0) beyond = -((x - fx) * this.tx[0] + (z - fz) * this.tz[0]);
      if (bi === segs - 1 && bt === 1) beyond = (x - fx) * this.tx[m - 1] + (z - fz) * this.tz[m - 1];
    }
    return { s: bs, v, beyond: Math.max(0, beyond), i: bt < 0.5 ? bi : j };
  }
  /** concave curvature radius towards the rock at sample i (Infinity when straight or convex) */
  concaveRadius(i: number) {
    const m = this.count, k = 6;
    const a = this.spec.closed ? (i - k + m) % m : Math.max(0, i - k), b = this.spec.closed ? (i + k) % m : Math.min(m - 1, i + k);
    const dTheta = Math.atan2(this.tx[a] * this.tz[b] - this.tz[a] * this.tx[b], this.tx[a] * this.tx[b] + this.tz[a] * this.tz[b]);
    const ds = Math.max(0.5, Math.abs((this.spec.closed && b < a ? b + m - a : b - a) * this.ds));
    // the normals converge inside the rock when the tangent turns towards it
    const turn = (this.tx[b] - this.tx[a]) * this.nx[i] + (this.tz[b] - this.tz[a]) * this.nz[i];
    if (turn <= 1e-4 || Math.abs(dTheta) < 1e-4) return Infinity;
    return ds / Math.abs(dTheta);
  }
}

// ---------- strata ----------

interface Layer { y0: number; y1: number; hard: number; basal: boolean; roof: boolean }

function strata(spec: CliffSpec, rng: Rng, yMin: number, yMax: number): Layer[] {
  const soft = spec.soft ?? [1.1, 2.4], hard = spec.hard ?? [2.4, 5.2];
  const layers: Layer[] = [];
  let y = yMin, k = 0;
  const wave = rng.float(0, 10);
  while (y < yMax - 0.2) {
    const h = clamp(0.5 + 0.42 * Math.sin(k * 1.37 + wave) + rng.float(-0.32, 0.32), 0, 1);
    const isHard = h > 0.52;
    const t = isHard ? rng.float(hard[0], hard[1]) : rng.float(soft[0], soft[1]);
    layers.push({ y0: y, y1: Math.min(yMax, y + t), hard: h, basal: false, roof: false });
    y += t;
    k++;
  }
  return layers;
}

/** Force a soft basal layer under a thick hard roof at the undercut height. */
function shapeUndercut(layers: Layer[], yRoof: number) {
  let i = layers.findIndex((l) => l.y1 > yRoof);
  if (i < 0) return;
  // snap or split so a boundary lies exactly at the roof height
  const L = layers[i];
  if (yRoof - L.y0 < 0.6 && i > 0) { layers[i - 1].y1 = yRoof; L.y0 = yRoof; i--; }
  else if (L.y1 - yRoof < 0.6 && i < layers.length - 1) { L.y1 = yRoof; layers[i + 1].y0 = yRoof; }
  else { layers.splice(i + 1, 0, { y0: yRoof, y1: L.y1, hard: 0.9, basal: false, roof: false }); L.y1 = yRoof; }
  // everything below the roof is the soft basal layer
  for (let k = 0; k <= i; k++) { layers[k].hard = Math.min(layers[k].hard, 0.15); layers[k].basal = true; }
  const roof = layers[i + 1];
  if (roof) {
    roof.hard = 1; roof.roof = true;
    // a roof slab thinner than 1.4 m merges with the layer above
    while (roof.y1 - roof.y0 < 1.4 && layers[i + 2]) { roof.y1 = layers[i + 2].y1; layers.splice(i + 2, 1); }
  }
}

// ---------- the cliff ----------

export class CliffBuild {
  readonly frame: Frame;
  readonly blocks: CliffBlock[] = [];
  readonly shelters: CliffShelter[] = [];
  caps: CliffMesh = { positions: new Float32Array(0), indices: new Uint32Array(0) };
  readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number;
  /** per sample: cumulative max recess of the face by height bin, measured from the foot */
  private cumR: Float32Array[] = [];
  /** per sample: depth of the rock behind the path line */
  private depth: number[] = [];
  private apron: number[] = [];
  private lowerAt: number[] = [];
  private exposed: number[] = [];
  /** per sample: the visible foot, never above the intended foot of any sample within 3 m */
  private floor: number[] = [];
  /** per sample: where the strata start, below every floor within 6 m */
  private bottom: number[] = [];
  private frontMin: number[] = [];

  constructor(readonly spec: CliffSpec, readonly ground: CliffGround) {
    const f = (this.frame = new Frame(spec));
    const rng = new Rng(spec.seed * 9973 + 11);
    const noise = new Simplex2(() => rng.next());
    const m = f.count, L = f.length, closed = !!spec.closed;
    const taper = spec.taper ?? Math.min(18, L * 0.22);
    // exposed face height fades at open ends: the talus rises to meet the top
    for (let i = 0; i < m; i++) {
      const s = f.s[i];
      if (!closed && taper > 0) {
        const e = smoothstep(0, taper, s) * smoothstep(0, taper, L - s);
        f.base[i] = f.top[i] - Math.max(0.3, (f.top[i] - f.base[i]) * e);
      }
      const p = { x: f.x[i] - f.nx[i] * 0.5, z: f.z[i] - f.nz[i] * 0.5 };
      const low = ground.lower(p.x, p.z);
      this.lowerAt.push(low);
    }
    // an undercut has a level floor, whatever the ground in front does
    const ucSpec = spec.undercut;
    let ucBase = 0;
    if (ucSpec) {
      let k = 0;
      for (let i = 0; i < m; i++) if (f.s[i] >= ucSpec.s0 && f.s[i] <= ucSpec.s1) { ucBase += f.base[i]; k++; }
      ucBase /= Math.max(1, k);
      for (let i = 0; i < m; i++) {
        const w = smoothstep(ucSpec.s0 - 4, ucSpec.s0, f.s[i]) * (1 - smoothstep(ucSpec.s1, ucSpec.s1 + 4, f.s[i]));
        f.base[i] = lerp(f.base[i], ucBase, w);
      }
    }
    for (let i = 0; i < m; i++) this.exposed.push(f.top[i] - f.base[i]);
    // Where the foot changes quickly along the path (at tapering ends), a floor taken from one
    // sample would rise above the foot of its neighbours. Minimum filters keep it low, and the
    // strata reach below every nearby floor so the face never floats.
    const window = (i: number, metres: number) => {
      const k = Math.ceil(metres / f.ds);
      let lo = Infinity;
      for (let q = -k; q <= k; q++) lo = Math.min(lo, f.base[closed ? (i + q + m) % m : clamp(i + q, 0, m - 1)]);
      return lo;
    };
    for (let i = 0; i < m; i++) {
      this.floor.push(window(i, 3.1));
      this.bottom.push(window(i, 6.2) - BURY);
      this.apron.push(Math.max(0, this.floor[i] - this.lowerAt[i]) / TALUS);
    }
    const ramp = Math.max(3, taper * 0.7);
    const env = (s: number) => (closed ? 1 : smoothstep(0, ramp, s) * smoothstep(0, ramp, L - s));
    const baseAt = (s: number) => f.point(s, 0).base, topAt = (s: number) => f.point(s, 0).top;
    const exposedAt = (s: number) => topAt(s) - baseAt(s);
    /** noise along the path, seamless around a loop, in −1..1 */
    const along = (s: number, scale: number, k: number) => {
      if (!closed) return noise.noise(s / scale, k);
      const a = (s / L) * Math.PI * 2, rr = L / (Math.PI * 2 * scale);
      return noise.noise(Math.cos(a) * rr + k * 7.31, Math.sin(a) * rr - k * 3.7);
    };
    // the face in plan: bays between buttresses, and a few narrow gullies cut through it
    const bayAmp = closed ? 0.7 : 2.1;
    const bay = (s: number) => bayAmp * smoothstep(-0.35, 0.65, along(s, 14, 41.3));
    const gullies: { s: number; w: number; d: number }[] = [];
    if (!closed) for (let q = 0, g = Math.floor(L / 28); q < g; q++) {
      const gs = rng.float(taper + 4, Math.max(taper + 5, L - taper - 4));
      if (spec.undercut && gs > spec.undercut.s0 - 6 && gs < spec.undercut.s1 + 6) continue;
      gullies.push({ s: gs, w: rng.float(3, 5.5), d: rng.float(1.8, 3.2) });
    }
    const gully = (s: number) => {
      let d = 0;
      for (const g of gullies) d = Math.max(d, g.d * smoothstep(g.w / 2, g.w / 2 - 1.3, Math.abs(s - g.s)));
      return d;
    };
    const plan = (s: number) => bay(s) + gully(s);

    // the caprock: a hard rim that follows the top and sticks out
    const overhang = spec.overhang ?? 1.6;
    // One thickness along the whole rim: the caprock and the strata below it are cut at
    // different points, and a thickness that followed the tapering face would open gaps.
    let maxExposed = 0;
    for (let i = 0; i < m; i++) maxExposed = Math.max(maxExposed, this.exposed[i]);
    const capT = clamp(maxExposed * 0.16, 0.8, 3.2);
    const capFront = (s: number) => 0.8 * plan(s) - overhang * env(s) * (0.55 + 0.45 * (0.5 + 0.5 * along(s, 13, 7.1))) * smoothstep(1.5, 6, exposedAt(s));

    let yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < m; i++) { yMin = Math.min(yMin, this.bottom[i]); yMax = Math.max(yMax, f.top[i]); }
    const layers = strata(spec, rng, yMin, yMax);
    const uc = ucSpec;
    if (uc) shapeUndercut(layers, ucBase + uc.height);
    const ucWeight = (s: number) => (uc ? smoothstep(uc.s0 - 2.5, uc.s0 + 1, s) * (1 - smoothstep(uc.s1 - 1, uc.s1 + 2.5, s)) : 0);
    // bedding planes are not perfectly level: a gentle dip and some waviness
    const dip = closed ? 0 : rng.float(-0.035, 0.035);
    const warp = (k: number, s: number) => {
      if (k <= 0) return 0;
      const calm = layers[k]?.basal || layers[k - 1]?.basal || layers[k]?.roof;
      // long wavelengths only: blocks sample the bedding at a few points, and adjacent
      // layers must still meet between those points
      return dip * (s - L / 2) + (calm ? 0.1 : 0.45) * along(s, 36, k * 0.61 + 3);
    };
    const recess = (k: number, s: number) => {
      const l = layers[k];
      const keep = 1 - ucWeight(s); // the shelter keeps its shape inside bays
      if (l.basal) return plan(s) * keep + lerp(0.45 + 0.4 * (0.5 + 0.5 * along(s, 7, 3.3)), uc!.depth, ucWeight(s));
      if (l.roof) return plan(s) * keep - 0.25 * ucWeight(s) + 0.15 * keep;
      const soft = Math.pow(1 - l.hard, 1.3);
      return plan(s) + 1.75 * soft * (0.35 + 0.65 * (0.5 + 0.5 * along(s, 10, k * 1.7))) - 0.25 * l.hard * (0.5 + 0.5 * along(s, 6, k * 2.3 + 9));
    };
    // How deep the rock reaches behind the path. The sheet starts rising one grid diagonal
    // behind the deepest face recess and needs up to one more diagonal to reach the top
    // (triangle interpolation), so the rock must reach past both, or a trench would open
    // between the back of the blocks and the plateau.
    const raw: number[] = [];
    for (let i = 0; i < m; i++) {
      let rMax = 0;
      for (let k = 0; k < layers.length; k++) rMax = Math.max(rMax, recess(k, f.s[i]));
      raw.push(rMax + FRONT_SLACK + MARGIN + 2 * GRID_REACH + 1.0);
      this.frontMin.push(Math.min(0, capFront(f.s[i])) - 0.4);
    }
    for (let i = 0; i < m; i++) {
      let d = 0;
      for (let q = -8; q <= 8; q++) d = Math.max(d, raw[closed ? (i + q + m) % m : clamp(i + q, 0, m - 1)]);
      const rc = f.concaveRadius(i);
      if (rc < Infinity) d = Math.min(d, rc * 0.8);
      this.depth.push(Math.max(2.5, d));
    }
    const depthAt = (s: number) => this.depth[f.index(s)];

    // world point for (s, v, y); loops send the back of each block towards the middle
    const P = (s: number, v: number, y: number, back = false) => {
      if (closed && back) {
        const p = f.point(s, 0);
        return [lerp(p.x, f.cx, 1.04), y, lerp(p.z, f.cz, 1.04)];
      }
      const p = f.point(s, v);
      return [p.x, y, p.z];
    };

    const addBlock = (kind: BlockKind, layer: number, tone: number, rings: number[][][]) => {
      const n = rings[0].length, pts = new Float32Array(rings.length * n * 3);
      let o = 0;
      const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const r of rings) for (const p of r) {
        pts[o++] = p[0]; pts[o++] = p[1]; pts[o++] = p[2];
        b.minX = Math.min(b.minX, p[0]); b.maxX = Math.max(b.maxX, p[0]);
        b.minY = Math.min(b.minY, p[1]); b.maxY = Math.max(b.maxY, p[1]);
        b.minZ = Math.min(b.minZ, p[2]); b.maxZ = Math.max(b.maxZ, p[2]);
      }
      const block: CliffBlock = { kind, n, rings: rings.length, pts, tone, layer, ...b };
      this.blocks.push(block);
      return block;
    };

    // per sample, height bins of the face recess (for the sheet stamp)
    const bins = Math.ceil((yMax - yMin + 2) / BIN) + 1;
    const rawR: Float32Array[] = [];
    for (let i = 0; i < m; i++) rawR.push(new Float32Array(bins).fill(-1e3));
    const markFace = (sa: number, sb: number, ya: number, yb: number, front: number) => {
      const ia = f.index(sa), ib = f.index(sb);
      const count = closed && ib < ia ? ib + m - ia : ib - ia;
      for (let q = 0; q <= count; q++) {
        const i = (ia + q) % m, rb = rawR[i], foot = this.floor[i];
        const b0 = clamp(Math.floor((ya - foot) / BIN), 0, bins - 1), b1 = clamp(Math.ceil((yb - foot) / BIN), 0, bins - 1);
        for (let b = b0; b <= b1; b++) rb[b] = Math.max(rb[b], front);
      }
    };

    /** A strata block between sa and sb: three front points, two back points. */
    const capLayer: Layer = { y0: 0, y1: 0, hard: 1, basal: false, roof: false };
    const strataBlock = (k: number, sa: number, sb: number, cap: boolean) => {
      const l = cap ? capLayer : layers[k];
      const sm = lerp(sa, sb, rng.float(0.35, 0.65));
      const S = [sa, sm, sb];
      const yb: number[] = [], yt: number[] = [];
      const band: number[][] = [];
      for (const s of S) {
        const y0 = cap ? topAt(s) - capT : l.y0 + warp(k, s), y1 = cap ? topAt(s) : l.y1 + warp(k + 1, s);
        band.push([y0, y1]);
        // clip to what can be seen: nothing far below the floor, nothing inside the caprock
        yb.push(cap ? y0 : Math.max(y0, this.bottom[f.index(s)]));
        yt.push(cap ? y1 : Math.min(y1, topAt(s) - capT));
      }
      const thick = Math.max(...yt.map((t, j) => t - yb[j]));
      if (thick < 0.35) return;
      // blocks of one bed are staggered: each reaches a little further down or up, so bedding
      // lines break instead of running on like courses of masonry (overlap only grows)
      if (!cap && !l.roof) { // the roof of an undercut keeps its height: it is the headroom
        const down = rng.float(0, 0.3) * thick, up = rng.chance(0.3) ? rng.float(0.1, 0.45) * thick : 0;
        for (let j = 0; j < 3; j++) { yb[j] -= down; yt[j] = Math.min(yt[j] + up, topAt(S[j]) - capT); }
      }
      // where the layer pinches out under the talus or into the caprock, it keeps its own
      // band there (hidden) instead of twisting the block towards the clip
      for (let j = 0; j < 3; j++) if (yt[j] - yb[j] < 0.22) { yb[j] = band[j][0]; yt[j] = Math.max(band[j][1], band[j][0] + 0.22); }
      const isHard = cap || l.hard > 0.52 || l.roof;
      const jit = cap ? rng.float(-0.12, 0.18) : isHard ? rng.float(-0.45, 0.55) : rng.float(-0.3, 0.4);
      const lean = cap ? rng.float(0.5, 1.1) : rng.float(-0.25, 0.4);
      const vf = S.map((s, j) => (cap ? capFront(s) : recess(k, s)) + jit + rng.float(-0.12, 0.12) + (j === 1 ? rng.float(-0.45, 0.45) : 0));
      const ch = cap ? rng.float(0.35, 0.65) : clamp(thick * rng.float(0.12, 0.22), 0.12, 0.45);
      const tilt = cap ? 0 : rng.float(-0.12, 0.1);
      const da = depthAt(sa), db = depthAt(sb);
      const rings: number[][][] = [];
      const ring = (yOf: (j: number) => number, dv: (j: number) => number, inset = 0, yBack?: number) => {
        const r: number[][] = [];
        const ss = [sa + inset * 0.6, sm, sb - inset * 0.6];
        for (let j = 0; j < 3; j++) r.push(P(ss[j], vf[j] + dv(j) + inset, yOf(j)));
        const backY = yBack ?? Math.max(yOf(0), yOf(2));
        r.push(P(sb, db, backY, true), P(sa, da, backY, true));
        return r;
      };
      const down = cap ? 0.35 : OVERLAP;
      const bottomY = (j: number) => yb[j] - down;
      rings.push(ring(bottomY, () => lean, 0, Math.min(yb[0], yb[2]) - down));
      if (thick > 1.6) {
        const mid = rng.float(-0.22, 0.22);
        rings.push(ring((j) => lerp(yb[j], yt[j] - ch, 0.5), (j) => lean * 0.5 + (j === 1 ? mid : mid * 0.4), 0, undefined));
      }
      const capBack = (j: number) => (cap && !closed ? yt[j] - 0.7 : yt[j]);
      rings.push(ring((j) => yt[j] - ch + tilt, () => 0, 0, cap && !closed ? Math.max(yt[0], yt[2]) - 0.7 - ch : undefined));
      rings.push(ring((j) => yt[j] + tilt * 0.5 + (cap ? rng.float(0, 0.12) : 0), () => 0, ch * rng.float(0.8, 1.3), cap && !closed ? Math.max(capBack(0), capBack(2)) : undefined));
      const tone = clamp(0.2 + 0.55 * l.hard + rng.float(-0.18, 0.18) + (rng.chance(0.1) ? 0.25 : 0) + (cap ? 0.12 : 0), 0, 1);
      addBlock(cap ? 'cap' : 'face', cap ? layers.length : k, tone, rings);
      const front = Math.max(...vf) + Math.max(0, lean) + ch * 1.4 + 0.1;
      markFace(sa, sb, Math.min(...yb) - 0.1, Math.max(...yt) + 0.1, front);
    };

    /** A loop is crowned by one slab, not a ring of wedges, so its top reads as one rock. */
    const capSlab = () => {
      const K = 12, S: number[] = [];
      for (let q = 0; q < K; q++) S.push(((q + rng.float(-0.25, 0.25)) / K) * L);
      const ch = rng.float(0.35, 0.6);
      const vf = S.map((s) => capFront(s) + rng.float(-0.2, 0.25));
      const lean = S.map(() => rng.float(0.4, 0.9));
      const ring = (yOf: (s: number) => number, dv: (q: number) => number) => S.map((s, q) => P(s, vf[q] + dv(q), yOf(s)));
      const rings = [
        ring((s) => topAt(s) - capT - 0.12, (q) => lean[q]),
        ring((s) => topAt(s) - ch, () => 0),
        ring((s) => topAt(s) + rng.float(0, 0.15), () => ch * rng.float(0.9, 1.5)),
      ];
      addBlock('cap', layers.length, clamp(0.75 + rng.float(-0.12, 0.12), 0, 1), rings);
      for (let q = 0; q < K; q++) markFace(S[q], S[(q + 1) % K] || L, topAt(S[q]) - capT - 0.2, topAt(S[q]) + 0.2, Math.max(vf[q], vf[(q + 1) % K]) + 1.0);
    };

    // cut each layer into blocks along the path; hard rock breaks into longer blocks
    // blocks also break at the edges of gullies and of the undercut, so those read crisply
    const breaks: number[] = [];
    for (const g of gullies) breaks.push(g.s - g.w / 2, g.s - g.w / 2 + 1.4, g.s + g.w / 2 - 1.4, g.s + g.w / 2);
    if (uc) breaks.push(uc.s0, uc.s1);
    breaks.sort((a, b) => a - b);
    const cut = (minLen: number, maxLen: number, fn: (sa: number, sb: number) => void) => {
      let s = closed ? rng.float(0, 2) : 0;
      const end = closed ? s + L : L;
      while (s < end - 0.3) {
        let sb = s + rng.float(minLen, maxLen);
        const next = closed ? undefined : breaks.find((b) => b > s + 0.6 && b < sb);
        if (next !== undefined) sb = next;
        if (end - sb < minLen * 0.6) sb = end;
        fn(s, Math.min(sb, end) + 0.08);
        s = sb;
      }
    };
    for (let k = 0; k < layers.length; k++) {
      const l = layers[k];
      const hard = l.hard > 0.52 || l.roof;
      if (closed) cut(hard ? L / 5 : L / 7, hard ? L / 3 : L / 4.5, (sa, sb) => strataBlock(k, sa, sb, false));
      else cut(hard ? 6 : 3, hard ? 14 : 7, (sa, sb) => strataBlock(k, sa, sb, false));
    }
    if (closed) capSlab();
    else cut(10, 20, (sa, sb) => strataBlock(layers.length, sa, sb, true));

    // cumulative recess by height, widened along the path: a grid triangle can join
    // vertices up to one diagonal apart along the face as well as across it
    for (let i = 0; i < m; i++) {
      const out = new Float32Array(bins).fill(-1e3);
      for (let q = -8; q <= 8; q++) {
        const j = closed ? (i + q + m) % m : clamp(i + q, 0, m - 1);
        const r = rawR[j];
        for (let b = 0; b < bins; b++) out[b] = Math.max(out[b], r[b]);
      }
      for (let b = 1; b < bins; b++) out[b] = Math.max(out[b], out[b - 1]);
      this.cumR.push(out);
    }

    // rubble at the foot hides the seam between face and ground; fallen blocks lie on the talus
    const clearOf = (s: number) => !uc || s < uc.s0 - 1.5 || s > uc.s1 + 1.5;
    const groundAt = (s: number, v: number) => {
      const p = f.point(s, v);
      const foot = this.floor[f.index(s)];
      return v < 0 ? Math.max(ground.lower(p.x, p.z), foot + v * TALUS) : foot;
    };
    const stone = (kind: BlockKind, x: number, z: number, y: number, size: number, yaw: number, tiltX: number, tiltZ: number, tone: number) => {
      const n = rng.int(5, 7), h = size * rng.float(0.45, 0.85);
      const radii: number[] = [], angles: number[] = [];
      for (let q = 0; q < n; q++) { angles.push(((q + rng.float(-0.3, 0.3)) / n) * Math.PI * 2); radii.push(size * 0.5 * rng.float(0.7, 1.1) * (q % 2 ? 1 : rng.float(0.85, 1.15))); }
      const ch = h * rng.float(0.18, 0.3);
      const local = (fr: number, yy: number) => angles.map((a, q) => [Math.cos(a) * radii[q] * fr, yy, Math.sin(a) * radii[q] * fr]);
      const rings = [local(rng.float(0.75, 0.95), -h * 0.5), local(1, h * 0.5 - ch), local(rng.float(0.55, 0.75), h * 0.5)];
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(tiltX), sx = Math.sin(tiltX), cz = Math.cos(tiltZ), sz = Math.sin(tiltZ);
      const world = rings.map((r) => r.map(([px, py, pz]) => {
        // tilt about x, then z, then yaw
        let y1 = py * cx - pz * sx, z1 = py * sx + pz * cx;
        const x2 = px * cz - y1 * sz; y1 = px * sz + y1 * cz;
        return [x + x2 * cy + z1 * sy, y + y1, z - x2 * sy + z1 * cy];
      }));
      return addBlock(kind, -1, tone, world);
    };
    const footFront = (s: number) => {
      const floor = this.floor[f.index(s)];
      for (let k = 0; k < layers.length; k++) if (layers[k].y1 + warp(k + 1, s) > floor + 0.2) return Math.max(0, recess(k, s));
      return 0;
    };
    for (let s = 0.6; s < L - 0.6; s += rng.float(1.1, 2.0)) {
      const i = f.index(s);
      if (!clearOf(s) || this.exposed[i] < 1.2) continue;
      const v = footFront(s) + rng.float(-0.9, 0.2), size = rng.float(0.35, 0.95);
      const p = f.point(s, v);
      stone('rubble', p.x, p.z, groundAt(s, v) + size * 0.12, size, rng.float(0, 6.28), rng.float(-0.25, 0.25), rng.float(-0.25, 0.25), rng.float(0.3, 0.7));
    }
    for (let s = 1; s < L - 1; s += rng.float(2.2, 4.5)) {
      const i = f.index(s);
      if (!clearOf(s) && rng.chance(0.85)) continue;
      if (rng.next() > clamp(this.exposed[i] / 16, 0.15, 0.85)) continue;
      const v = -rng.float(1.2, Math.max(2, this.apron[i] + 4));
      const size = 0.6 + Math.pow(rng.next(), 2.2) * 2.2;
      const p = f.point(s, v);
      stone('boulder', p.x, p.z, groundAt(s, v) + size * 0.18, size, rng.float(0, 6.28), rng.float(-0.35, 0.35), rng.float(-0.35, 0.35), rng.float(0.3, 0.8));
    }

    // the walk-in shelter under the roof slab
    if (uc) {
      for (let s = uc.s0; s < uc.s1 - 0.5; s += 3) {
        const sb = Math.min(uc.s1, s + 3), smid = (s + sb) / 2;
        const p = f.point(smid, uc.depth * 0.45), i = f.index(smid);
        this.shelters.push({ x: p.x, z: p.z, yaw: Math.atan2(-f.tz[i], f.tx[i]), hx: (sb - s) / 2 + 0.2, hz: uc.depth * 0.5 + 0.35, y0: this.floor[i] - 0.4, y1: ucBase + uc.height });
      }
    }

    this.caps = this.buildCaps(rng, !closed);
    // the cornice runs nearly to the ends, covering where the plateau climbs over the caprock
    if (!closed) this.cornice((s) => ({ v: capFront(s), y: topAt(s) + 0.1, t: (0.32 + 0.12 * along(s, 6, 77)) * smoothstep(0.1, 2.5, exposedAt(s)) }));
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const b of this.blocks) { minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX); minZ = Math.min(minZ, b.minZ); maxZ = Math.max(maxZ, b.maxZ); }
    const pad = Math.max(...this.apron) + 8;
    this.minX = minX - pad; this.maxX = maxX + pad; this.minZ = minZ - pad; this.maxZ = maxZ + pad;
  }

  // ---------- queries ----------

  /** Rock or rubble here: no trees, huts or props. */
  occupied(x: number, z: number, margin = 1) {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return false;
    const p = this.frame.project(x, z);
    if (p.beyond > margin) return false;
    const i = p.i;
    if (p.v > this.frontMin[i] - margin - 1.2 && (this.spec.closed || p.v < this.depth[i] + 0.5)) return true;
    // boulders on the talus
    for (const b of this.blocks) {
      if (b.kind !== 'boulder') continue;
      if (x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin) return true;
    }
    return false;
  }

  /** Height the sheet may take at sample i and inward distance v without showing in front of the rock. */
  private hidden(i: number, v: number) {
    const r = this.cumR[i], foot = this.floor[i];
    if (v < r[0] + MARGIN) return foot;
    let b = 0;
    while (b < r.length - 1 && r[b + 1] + MARGIN <= v) b++;
    return foot + (b + 1) * BIN;
  }

  /** Target sheet height and blend weight at a point. */
  sheetAt(x: number, z: number) {
    const f = this.frame, p = f.project(x, z), i = p.i;
    const top = f.top[i], base = this.floor[i];
    let w = 1;
    if (!this.spec.closed) {
      w *= smoothstep(0, 3, p.s) * smoothstep(0, 3, f.length - p.s) * (1 - smoothstep(0, 4, p.beyond));
    }
    let h: number;
    if (p.v < 0) {
      // Talus is the envelope of cones that fall from every point of the foot. Unlike a
      // profile across the nearest point, it stays continuous in front of bays, where the
      // nearest point of the path jumps from one side to the other.
      const low = this.ground.lower(x, z);
      let cone = -Infinity;
      for (let q = 0; q < f.count; q += 2) {
        const d = Math.hypot(x - f.x[q], z - f.z[q]);
        const c = this.floor[q] - d * TALUS;
        if (c > cone) cone = c;
      }
      h = Math.max(low, cone);
      // fade towards the untouched ground only past the toe of the cones
      w = smoothstep(-7, -1, (cone - low) / TALUS);
      if (!this.spec.closed) w *= 1 - smoothstep(0, 6, p.beyond - (this.apron[i] + 2));
    } else if (this.spec.closed) {
      h = base;
    } else {
      const hide = this.hidden(i, p.v - GRID_REACH);
      const up = this.ground.upper(x, z);
      // where the foot rises along the face, talus from higher up spills along it and
      // buries the lower face instead of leaving a pit at the path line
      let cone = -Infinity;
      for (let q = 0; q < f.count; q += 2) cone = Math.max(cone, this.floor[q] - Math.hypot(x - f.x[q], z - f.z[q]) * TALUS);
      h = Math.max(base, Math.min(up, Math.max(hide, cone)));
      // the plateau takes over behind the rock
      w *= 1 - smoothstep(this.depth[i] + 1, this.depth[i] + 7, p.v);
      if (hide >= top - 0.01) h = up;
    }
    // in front of the face talus only ever adds material: it never cuts into ground that is
    // already higher, such as the flank of a plateau beside the end of the cliff
    return { h, w, front: p.v < 0 };
  }

  /** Reshape a heightfield grid (row-major, (n+1)², spacing `cell`, world x = i·cell − ox). */
  stamp(H: Float32Array, n: number, ox: number, oz: number, cell: number) {
    const nf = n + 1;
    const i0 = clamp(Math.floor((this.minX + ox) / cell), 0, n), i1 = clamp(Math.ceil((this.maxX + ox) / cell), 0, n);
    const j0 = clamp(Math.floor((this.minZ + oz) / cell), 0, n), j1 = clamp(Math.ceil((this.maxZ + oz) / cell), 0, n);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i * cell - ox, z = j * cell - oz;
      const { h, w, front } = this.sheetAt(x, z);
      if (w <= 0) continue;
      const k = j * nf + i;
      H[k] = front ? Math.max(H[k], lerp(H[k], h, w)) : lerp(H[k], h, w);
    }
  }

  // ---------- snow caps ----------

  /** Is the point under rock? Checks the footprints of blocks above it. */
  private covered(x: number, y: number, z: number, self: CliffBlock) {
    for (const b of this.blocks) {
      if (b === self || b.maxY < y + 0.15 || b.minY > y + 45) continue;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      // bottom ring footprint, and its lowest point must be above the sample
      let inside = false, low = Infinity;
      const n = b.n, P = b.pts;
      for (let q = 0, r = n - 1; q < n; r = q++) {
        const xi = P[q * 3], zi = P[q * 3 + 2], xj = P[r * 3], zj = P[r * 3 + 2];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
        low = Math.min(low, P[q * 3 + 1]);
      }
      if (inside && low > y + 0.05) return true;
      // a thick block whose upper rings stick out over the point
      if (!inside && b.rings > 2) {
        const o = (b.rings - 1) * n;
        let inTop = false;
        for (let q = 0, r = n - 1; q < n; r = q++) {
          const xi = P[(o + q) * 3], zi = P[(o + q) * 3 + 2], xj = P[(o + r) * 3], zj = P[(o + r) * 3 + 2];
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inTop = !inTop;
        }
        if (inTop && b.minY > y + 0.05) return true;
      }
    }
    return false;
  }

  private buildCaps(rng: Rng, skipCaprock: boolean): CliffMesh {
    const pos: number[] = [], idx: number[] = [];
    for (const b of this.blocks) {
      if (skipCaprock && b.kind === 'cap') continue; // the cornice covers the rim
      const n = b.n, P = b.pts, top = (b.rings - 1) * n, sh = (b.rings - 2) * n;
      // centroid and tilt of the top ring
      let cx = 0, cy = 0, cz = 0;
      for (let q = 0; q < n; q++) { cx += P[(top + q) * 3] / n; cy += P[(top + q) * 3 + 1] / n; cz += P[(top + q) * 3 + 2] / n; }
      let nx = 0, ny = 0, nz = 0, area = 0;
      for (let q = 0; q < n; q++) {
        const a = (top + q) * 3, c = (top + ((q + 1) % n)) * 3;
        const ax = P[a] - cx, ay = P[a + 1] - cy, az = P[a + 2] - cz, bx = P[c] - cx, by = P[c + 1] - cy, bz = P[c + 2] - cz;
        const ux = ay * bz - az * by, uy = az * bx - ax * bz, uz = ax * by - ay * bx;
        nx += ux; ny += uy; nz += uz;
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      area = nl / 2;
      if (Math.abs(ny) / nl < 0.78) continue;
      // exposure: centre and towards each front point
      let open = 0, total = 0;
      const samples = [[cx, cz]];
      for (let q = 0; q < Math.min(3, n); q++) samples.push([lerp(cx, P[(top + q) * 3], 0.75), lerp(cz, P[(top + q) * 3 + 2], 0.75)]);
      for (const [sx, sz] of samples) { total++; if (!this.covered(sx, cy, sz, b)) open++; }
      const exposure = open / total;
      if (exposure < 0.4) continue;
      const t = clamp(0.1 + 0.035 * Math.sqrt(area), 0.12, 0.36) * exposure * rng.float(0.8, 1.15) * (b.kind === 'rubble' ? 0.7 : 1);
      if (t < 0.07) continue;
      pillow(b, t, () => rng.float(0.9, 1.08), pos, idx);
    }
    return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
  }

  /** One continuous snow cornice along the rim of an open cliff, merging into the plateau snow. */
  private cornice(at: (s: number) => { v: number; y: number; t: number }) {
    const f = this.frame, L = f.length, pos = Array.from(this.caps.positions), idx = Array.from(this.caps.indices);
    const prof = (s: number) => {
      const { v, y, t } = at(s);
      if (t < 0.03) return null;
      // front drape over the lip, rounded crest, then down under the ground snow; the last
      // point closes the drape underneath, inside the rock
      // the snow reaches back over the whole caprock, past where the sheet climbs out of it
      const back = Math.max(v + 4.5, this.depth[f.index(s)] + 0.6);
      const q = [[v - 0.06, y - 0.55], [v + 0.12, y + 0.25 * t], [v + 0.55, y + 0.8 * t], [v + 1.6, y + t], [lerp(v + 1.6, back, 0.5), y + 0.2 + 0.4 * t], [back, y + 0.1], [v + 0.5, y - 0.6]];
      return q.map(([qv, qy]) => { const p = f.point(s, qv); return [p.x, qy, p.z]; });
    };
    let prev: number[][] | null = null, prevBase = -1;
    for (let s = 0; s <= L + 1e-6; s += 0.8) {
      const cur = prof(Math.min(s, L));
      if (!cur) { prev = null; continue; }
      const base = pos.length / 3;
      for (const p of cur) pos.push(p[0], p[1], p[2]);
      if (prev) {
        const { v, y } = at(Math.min(s, L));
        const mid = f.point(Math.min(s, L), v + 1.2);
        const cx = mid.x, cy = y - 0.15, cz = mid.z;
        const K = cur.length;
        for (let k = 0; k < K; k++) {
          const k2 = (k + 1) % K;
          const a = prevBase + k, b = prevBase + k2, c = base + k2, d = base + k;
          for (const [i0, i1, i2] of [[a, b, c], [a, c, d]]) {
            const P0 = [pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2]], P1 = [pos[i1 * 3], pos[i1 * 3 + 1], pos[i1 * 3 + 2]], P2 = [pos[i2 * 3], pos[i2 * 3 + 1], pos[i2 * 3 + 2]];
            const ux = P1[0] - P0[0], uy = P1[1] - P0[1], uz = P1[2] - P0[2], wx = P2[0] - P0[0], wy = P2[1] - P0[1], wz = P2[2] - P0[2];
            const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
            const mx = (P0[0] + P1[0] + P2[0]) / 3 - cx, my = (P0[1] + P1[1] + P2[1]) / 3 - cy, mz = (P0[2] + P1[2] + P2[2]) / 3 - cz;
            if (nx * mx + ny * my + nz * mz < 0) idx.push(i0, i2, i1); else idx.push(i0, i1, i2);
          }
        }
      }
      prev = cur; prevBase = base;
    }
    this.caps = { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
  }

  // ---------- facts for tests and the lab ----------

  stats() {
    const kinds: Record<string, number> = {};
    for (const b of this.blocks) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
    return { blocks: this.blocks.length, kinds, capTriangles: this.caps.indices.length / 3, length: this.frame.length, shelters: this.shelters.length };
  }
  /** a point on the path: s metres along, v metres into (+) or out of (−) the rock */
  at(s: number, v: number) { return this.frame.point(s, v); }
  get length() { return this.frame.length; }
  get centre() { return { x: this.frame.cx, z: this.frame.cz }; }
  /** outward direction (away from the rock) at s */
  outward(s: number) { const i = this.frame.index(s); return { x: -this.frame.nx[i], z: -this.frame.nz[i] }; }
  /** the visible foot of the face (floor of an undercut) */
  footAt(s: number) { return this.floor[this.frame.index(s)]; }
  /** the intended foot before the conservative filter */
  intendedFootAt(s: number) { return this.frame.base[this.frame.index(s)]; }
  topAt(s: number) { return this.frame.top[this.frame.index(s)]; }
}

/** Triangles of a block, wound outwards: bottom fan, sides between rings, top fan. */
export function blockTriangles(b: CliffBlock, out: number[]) {
  const n = b.n, P = b.pts, R = b.rings;
  let cx = 0, cy = 0, cz = 0;
  const N = n * R;
  for (let q = 0; q < N; q++) { cx += P[q * 3] / N; cy += P[q * 3 + 1] / N; cz += P[q * 3 + 2] / N; }
  const v = (k: number) => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]];
  const tri = (a: number[], b2: number[], c: number[]) => {
    const ux = b2[0] - a[0], uy = b2[1] - a[1], uz = b2[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    if (nx * nx + ny * ny + nz * nz < 1e-10) return;
    const mx = (a[0] + b2[0] + c[0]) / 3 - cx, my = (a[1] + b2[1] + c[1]) / 3 - cy, mz = (a[2] + b2[2] + c[2]) / 3 - cz;
    if (nx * mx + ny * my + nz * mz < 0) out.push(...a, ...c, ...b2);
    else out.push(...a, ...b2, ...c);
  };
  const fan = (r: number) => {
    let fx = 0, fy = 0, fz = 0;
    for (let q = 0; q < n; q++) { fx += P[(r * n + q) * 3] / n; fy += P[(r * n + q) * 3 + 1] / n; fz += P[(r * n + q) * 3 + 2] / n; }
    for (let q = 0; q < n; q++) tri([fx, fy, fz], v(r * n + q), v(r * n + ((q + 1) % n)));
  };
  fan(0);
  for (let r = 0; r < R - 1; r++) for (let q = 0; q < n; q++) {
    const a = r * n + q, b2 = r * n + ((q + 1) % n), c = (r + 1) * n + ((q + 1) % n), d = (r + 1) * n + q;
    tri(v(a), v(b2), v(c));
    tri(v(a), v(c), v(d));
  }
  fan(R - 1);
}

/** A rounded snow cap on the top ring of a block, draping its chamfer. Appends to pos/idx,
 * each triangle wound to face up. `t` is the thickness at the crown. */
export function pillow(b: CliffBlock, t: number, jitter: () => number, pos: number[], idx: number[]) {
  const n = b.n, P = b.pts, top = (b.rings - 1) * n, sh = (b.rings - 2) * n;
  let cx = 0, cy = 0, cz = 0;
  for (let q = 0; q < n; q++) { cx += P[(top + q) * 3] / n; cy += P[(top + q) * 3 + 1] / n; cz += P[(top + q) * 3 + 2] / n; }
  const v0 = pos.length / 3, i0 = idx.length;
  // rim on the shoulder, draping the chamfer; then two rings rising to the crown
  for (let q = 0; q < n; q++) {
    const s = (sh + q) * 3, u = (top + q) * 3;
    const ox = P[s] - cx, oz = P[s + 2] - cz, ol = Math.hypot(ox, oz) || 1;
    pos.push(P[s] + (ox / ol) * 0.035, P[s + 1] + 0.03, P[s + 2] + (oz / ol) * 0.035);
    pos.push(lerp(P[s], P[u], 0.6), lerp(P[s + 1], P[u + 1], 0.6) + t * 0.55, lerp(P[s + 2], P[u + 2], 0.6));
    pos.push(lerp(P[u], cx, 0.22), lerp(P[u + 1], cy, 0.22) + t * 0.92 * jitter(), lerp(P[u + 2], cz, 0.22));
  }
  pos.push(cx, cy + t * 1.02 + 0.03, cz);
  const c = v0 + n * 3;
  for (let q = 0; q < n; q++) {
    const a = v0 + q * 3, d = v0 + ((q + 1) % n) * 3;
    for (let r = 0; r < 2; r++) idx.push(a + r, d + r, d + r + 1, a + r, d + r + 1, a + r + 1);
    idx.push(a + 2, d + 2, c);
  }
  for (let k = i0; k < idx.length; k += 3) {
    const a = idx[k] * 3, bb = idx[k + 1] * 3, cc = idx[k + 2] * 3;
    const ux = pos[bb] - pos[a], uz = pos[bb + 2] - pos[a + 2], vx = pos[cc] - pos[a], vz = pos[cc + 2] - pos[a + 2];
    if (uz * vx - ux * vz < 0) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; }
  }
}
