// The region generator. Deterministic from the seed, layer by layer:
// macro relief (continentalness / erosion / ridges, like Minecraft 1.18) → droplet erosion →
// lakes and drainage (Priority-Flood) → rivers and gorges → biomes → fine 2 m heightmap,
// water and ice → cliffs → places (house, tower) → trees, shrubs, rocks.
// See docs/WORLD.md.
import { Rng, Simplex2, clamp, lerp, smoothstep } from '../core/rng';
import { erode } from './erosion';
import { priorityFlood, accumulate, breachLakes, riverLevels, traceRivers, smoothRiver, River, DX, DY } from './hydro';
import { B, BIOMES, BIOME_COUNT, Sp } from './biomes';
import type { CliffBuild } from './cliffs';
import { RockSkin } from './rock-skin';
import { buildCliffLab } from './cliff-lab';
import type { CliffLabInfo } from './cliff-lab';

export interface RegionOptions {
  /** raise the cliff laboratory near the house (?cliffs=1) */
  cliffLab?: boolean;
}

export interface Props {
  count: number;
  x: Float32Array;
  z: Float32Array;
  y: Float32Array;
  s: Float32Array;
  rot: Float32Array;
  kind: Uint8Array;
  variant: Uint8Array;
  flags: Uint8Array;
  /** index of the first prop in each spatial cell (cells × cells + 1 entries) */
  cellStart: Int32Array;
  cells: number;
  cellSize: number;
}

export interface LakeInfo {
  id: number;
  level: number;
  x: number; // world centre
  z: number;
  area: number; // m²
}

export interface RiverLine {
  /** world coordinates */
  x: Float32Array;
  z: Float32Array;
  level: Float32Array;
  width: Float32Array;
  into: string;
}

export interface Pillar {
  x: number;
  z: number;
  y: number;
  h: number;
  r: number;
  seed: number;
}

export interface Site {
  x: number;
  z: number;
  y: number;
}

export type PlaceKind = 'hut' | 'station' | 'grotto' | 'car' | 'bridge' | 'logging' | 'cross' | 'leanto' | 'fishing';

/** a man-made place or trace of people, chosen by rules and built by world/structures */
export interface Place {
  kind: PlaceKind;
  x: number;
  z: number;
  y: number;
  yaw: number;
  /** how far from the house, 0..1: remote places are less looted */
  remote: number;
  data: Record<string, any>;
}

const COARSE = 8;
const FINE = 2;
const PROP_CELL = 64;

/** ridged multifractal noise in 0..1 */
function ridged(n: Simplex2, x: number, y: number, oct: number) {
  let sum = 0, amp = 0.5, freq = 1, prev = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    let v = 1 - Math.abs(n.noise(x * freq, y * freq));
    v *= v;
    sum += v * amp * prev;
    norm += amp;
    prev = v;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

function terrace(h: number, step: number) {
  const k = Math.floor(h / step);
  const f = h / step - k;
  return (k + smoothstep(0.3, 0.7, f)) * step;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));

export type Progress = (stage: string, frac: number) => void | Promise<void>;

export class Region {
  seed: number;
  size: number;
  n: number; // fine cells per side
  cell = FINE;
  ox = 0;
  oz = 0;
  h!: Float32Array;
  water!: Float32Array;
  ice!: Uint8Array;
  cn: number; // coarse cells per side
  cc = COARSE;
  ch!: Float32Array;
  biome!: Uint8Array;
  /** RGBA per coarse vertex: forest canopy, ash, bog grass, shore pebbles */
  tex!: Uint8Array;
  moist!: Float32Array;
  rivers: RiverLine[] = [];
  lakes: LakeInfo[] = [];
  lakeId!: Int32Array; // coarse
  trees!: Props;
  shrubs!: Props;
  rocks!: Props;
  pillars: Pillar[] = [];
  sites: { house: Site; tower: Site | null; thin: { x: number; z: number; r: number } | null } = { house: { x: 0, z: 0, y: 0 }, tower: null, thin: null };
  places: Place[] = [];
  /** rock faces welded into the sheet; trees and places keep clear of them */
  cliffs: CliffBuild[] = [];
  /** rows of rock over every slope too steep to walk */
  skin: RockSkin | null = null;
  cliffLab: CliffLabInfo | null = null;
  seaSide = 0;
  treeline = 165;
  timings: Record<string, number> = {};

  constructor(seed: number, size: number, readonly options: RegionOptions = {}) {
    this.seed = seed;
    this.size = size;
    this.n = size / FINE;
    this.cn = size / COARSE;
  }

  // ---------- queries (world coordinates) ----------

  get minX() {
    return -this.ox;
  }
  get minZ() {
    return -this.oz;
  }
  get maxX() {
    return this.size - this.ox;
  }
  get maxZ() {
    return this.size - this.oz;
  }

  inside(x: number, z: number, margin = 0) {
    const gx = x + this.ox, gz = z + this.oz;
    return gx >= margin && gz >= margin && gx <= this.size - margin && gz <= this.size - margin;
  }

  heightAt(x: number, z: number) {
    const n = this.n;
    const fx = clamp((x + this.ox) / FINE, 0, n - 0.0001);
    const fz = clamp((z + this.oz) / FINE, 0, n - 0.0001);
    const i = fx | 0, j = fz | 0;
    const tx = fx - i, tz = fz - j;
    const H = this.h;
    const v = j * (n + 1) + i;
    const a = H[v], b = H[v + 1], c = H[v + n + 1], d = H[v + n + 2];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  private nearest(x: number, z: number) {
    const n = this.n;
    const i = clamp(Math.round((x + this.ox) / FINE), 0, n);
    const j = clamp(Math.round((z + this.oz) / FINE), 0, n);
    return j * (n + 1) + i;
  }

  /** water surface level at a point, NaN on dry land */
  waterAt(x: number, z: number) {
    return this.water[this.nearest(x, z)];
  }

  /** ice thickness in metres (0 = open water); only meaningful where waterAt is a number */
  iceAt(x: number, z: number) {
    return this.ice[this.nearest(x, z)] / 100;
  }

  biomeAt(x: number, z: number): number {
    const cn = this.cn;
    const i = clamp(Math.round((x + this.ox) / COARSE), 0, cn);
    const j = clamp(Math.round((z + this.oz) / COARSE), 0, cn);
    return this.biome[j * (cn + 1) + i];
  }

  /** slope (rise over run) at a point from the fine grid */
  slopeAt(x: number, z: number) {
    const e = 2;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  forestAt(x: number, z: number) {
    const cn = this.cn;
    const i = clamp(Math.round((x + this.ox) / COARSE), 0, cn);
    const j = clamp(Math.round((z + this.oz) / COARSE), 0, cn);
    return this.tex[(j * (cn + 1) + i) * 4] / 255;
  }

  /** distance to the map border, metres (negative outside) */
  edgeDist(x: number, z: number) {
    const gx = x + this.ox, gz = z + this.oz;
    return Math.min(gx, gz, this.size - gx, this.size - gz);
  }

  // ---------- generation ----------

  async generate(progress?: Progress) {
    const t0 = performance.now();
    const mark = (k: string, t: number) => (this.timings[k] = Math.round(performance.now() - t));
    const rng = new Rng(this.seed * 7919 + 17);
    const sub = (k: number) => new Rng(this.seed * 104729 + k * 7907);
    const noise = (k: number) => {
      const r = sub(k);
      return new Simplex2(() => r.next());
    };
    const S = this.size;
    const cn = this.cn, nc = cn + 1, NC = nc * nc;
    this.seaSide = rng.int(0, 3);
    this.treeline = 150 + rng.float(0, 40);

    await progress?.('Рельеф', 0.02);
    let t = performance.now();
    const nCont = noise(1), nCont2 = noise(2), nEro = noise(3), nRidge = noise(4), nHill = noise(5), nPlat = noise(6), nWarp = noise(7), nEdge = noise(8);
    const ch = new Float32Array(NC);
    const hard = new Float32Array(NC);
    const plateau = new Float32Array(NC);
    const seaU = (x: number, y: number) => {
      switch (this.seaSide) {
        case 0: return y / S;
        case 1: return 1 - y / S;
        case 2: return x / S;
        default: return 1 - x / S;
      }
    };
    const landEdge = (x: number, y: number) => {
      const d = [y, S - y, x, S - x];
      d[this.seaSide] = Infinity;
      return Math.min(...d) / S;
    };
    for (let j = 0; j < nc; j++) for (let i = 0; i < nc; i++) {
      const x = i * COARSE, y = j * COARSE;
      const wx = x + 140 * nWarp.fbm(x / 900, y / 900, 3), wy = y + 140 * nWarp.fbm(x / 900 + 40, y / 900 - 13, 3);
      const u = seaU(wx, wy);
      const c = (u - 0.2) * 1.9 + nCont.fbm(wx / 1300, wy / 1300, 4) * 0.42 + nCont2.fbm(wx / 380, wy / 380, 3) * 0.13;
      // landforms: broad massifs separated by long winding valleys, lowlands by the sea
      const massif = smoothstep(-0.05, 0.45, nEro.fbm(wx / 1500, wy / 1500, 3)) * smoothstep(0.08, 0.55, c);
      const r = ridged(nRidge, wx / 620, wy / 620, 4);
      let h: number;
      if (c < 0) h = -2.5 - 38 * smoothstep(0, 0.42, -c);
      else h = 1.5 + 34 * Math.pow(smoothstep(0, 1.25, c), 1.2);
      // peaks with clear ridgelines
      const mount = massif * (40 + 240 * Math.pow(r, 1.35) * (0.75 + 0.25 * r));
      // long valleys cut through everything except the coast
      const vn = Math.abs(nHill.fbm(wx / 1250, wy / 1250, 3));
      const valley = (1 - smoothstep(0.02, 0.16, vn)) * smoothstep(0.05, 0.3, c);
      // gentle rolling ground in the lowlands
      const roll = nHill.fbm(wx / 420 + 7, wy / 420, 3) * 7 * smoothstep(-0.05, 0.2, c);
      h += mount * (1 - 0.85 * valley) + roll - valley * 6;
      // mesas with sheer cliff bands; rivers cut gorges into them
      const p = smoothstep(0.32, 0.46, nPlat.fbm(wx / 900, wy / 900, 2)) * smoothstep(0.2, 0.4, c) * (1 - massif * 0.8);
      if (p > 0) {
        const step = 22;
        const k = Math.floor((h + 30 * p) / step);
        const f = (h + 30 * p) / step - k;
        h = lerp(h, (k + smoothstep(0.42, 0.58, f)) * step, p);
      }
      const ero = 1 - massif;
      // impassable ridges along the land borders
      const eb = 1 - smoothstep(0.02, 0.11, landEdge(x, y));
      if (eb > 0) h += eb * eb * (150 + 160 * ridged(nEdge, x / 300, y / 300, 4));
      const v = j * nc + i;
      ch[v] = h;
      plateau[v] = p;
      hard[v] = clamp(1 - p * 0.85 - smoothstep(60, 200, h) * 0.3, 0.12, 1);
      void ero;
    }
    mark('macro', t);

    await progress?.('Эрозия', 0.12);
    t = performance.now();
    for (let v = 0; v < NC; v++) ch[v] /= COARSE;
    const er = sub(9);
    erode(ch, nc, () => er.next(), { drops: Math.round(NC * 0.9), hardness: hard, maxLife: 44, radius: 2, capacity: 5, erode: 0.35 });
    for (let v = 0; v < NC; v++) ch[v] = Math.max(-45, ch[v] * COARSE);
    this.ch = ch;
    mark('erosion', t);

    await progress?.('Озёра и реки', 0.3);
    t = performance.now();
    let flood = priorityFlood(ch, nc);
    // sea: below sea level and connected to the border
    const sea = new Uint8Array(NC);
    for (let v = 0; v < NC; v++) if (flood.fill[v] <= 0.02) sea[v] = 1;
    // big or deep basins get an outlet cut through instead of becoming huge lakes
    const maxLakeCells = Math.round((0.09 * 1e6 * Math.pow(S / 3072, 1.2)) / (COARSE * COARSE));
    if (breachLakes(ch, nc, flood, sea, maxLakeCells, 9, 28) > 0) flood = priorityFlood(ch, nc);
    const fill = flood.fill;
    // lakes: filled depressions above sea level
    const lakeLevelC = new Float32Array(NC).fill(NaN);
    const lakeId = new Int32Array(NC).fill(-1);
    {
      const stack: number[] = [];
      let id = 0;
      for (let v = 0; v < NC; v++) {
        if (lakeId[v] >= 0 || sea[v] || fill[v] - ch[v] < 0.35) continue;
        const L = fill[v];
        const members: number[] = [];
        stack.push(v);
        lakeId[v] = id;
        while (stack.length) {
          const c = stack.pop()!;
          members.push(c);
          const cx = c % nc, cy = (c / nc) | 0;
          for (let k = 0; k < 8; k++) {
            const x = cx + DX[k], y = cy + DY[k];
            if (x < 0 || y < 0 || x >= nc || y >= nc) continue;
            const u = y * nc + x;
            if (lakeId[u] >= 0 || sea[u]) continue;
            if (Math.abs(fill[u] - L) > 0.01 || fill[u] - ch[u] < 0.05) continue;
            lakeId[u] = id;
            stack.push(u);
          }
        }
        if (members.length < 10) {
          for (const c of members) lakeId[c] = -2; // too small: a wet hollow, not a lake
          continue;
        }
        let sx = 0, sy = 0;
        for (const c of members) {
          lakeLevelC[c] = L;
          sx += c % nc;
          sy += (c / nc) | 0;
        }
        this.lakes.push({ id, level: L, x: (sx / members.length) * COARSE, z: (sy / members.length) * COARSE, area: members.length * COARSE * COARSE });
        id++;
      }
    }
    this.lakeId = lakeId;
    // flow accumulation, with more rain in the hills
    const wgt = new Float32Array(NC);
    for (let v = 0; v < NC; v++) wgt[v] = 1 + Math.max(0, ch[v]) / 140;
    const acc = accumulate(flood, nc, wgt);
    const A0 = 900;
    const isRiver = new Uint8Array(NC);
    for (let v = 0; v < NC; v++) if (acc[v] > A0 && !sea[v]) isRiver[v] = 1;
    const isLake = (v: number) => lakeId[v] >= 0;
    const isSea = (v: number) => sea[v] === 1;
    const levels = riverLevels(flood, nc, COARSE, acc, isRiver, lakeLevelC, (v) => 1 - hard[v], 34);
    const widthOf = (a: number) => clamp(1.3 + 0.12 * Math.sqrt(a), 2, 30);
    const raw = traceRivers(flood, nc, acc, isRiver, levels, widthOf, isLake, isSea);
    const nMeander = noise(10);
    const rivers: River[] = raw.map((r) => {
      const pts = smoothRiver(r.pts, 3);
      // gentle meanders, fading out at both ends so confluences still meet
      let sAlong = 0;
      const total = pts.length;
      const off = pts.map((p, i) => {
        if (i > 0) sAlong += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) * COARSE;
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(total - 1, i + 1)];
        const tx = b.x - a.x, ty = b.y - a.y;
        const tl = Math.hypot(tx, ty) || 1;
        const fade = Math.min(1, i / 6, (total - 1 - i) / 6);
        const amp = (Math.min(7, 2 + p.width * 0.35) * fade * nMeander.noise(sAlong / 45 + r.pts[0].x, r.pts[0].y)) / COARSE;
        return { x: (-ty / tl) * amp, y: (tx / tl) * amp };
      });
      pts.forEach((p, i) => {
        p.x += off[i].x;
        p.y += off[i].y;
      });
      return { pts, into: r.into };
    });
    mark('hydro', t);

    // ---------- moisture & biomes (coarse) ----------
    await progress?.('Биомы', 0.42);
    t = performance.now();
    // chamfer distance to water (m)
    const dWater = new Float32Array(NC).fill(1e9);
    const dSea = new Float32Array(NC).fill(1e9);
    for (let v = 0; v < NC; v++) {
      if (sea[v]) dSea[v] = 0;
      if (sea[v] || lakeId[v] >= 0 || isRiver[v]) dWater[v] = 0;
    }
    const chamfer = (D: Float32Array) => {
      const a = COARSE, b = COARSE * Math.SQRT2;
      for (let j = 0; j < nc; j++) for (let i = 0; i < nc; i++) {
        const v = j * nc + i;
        let d = D[v];
        if (i > 0) d = Math.min(d, D[v - 1] + a);
        if (j > 0) {
          d = Math.min(d, D[v - nc] + a);
          if (i > 0) d = Math.min(d, D[v - nc - 1] + b);
          if (i < nc - 1) d = Math.min(d, D[v - nc + 1] + b);
        }
        D[v] = d;
      }
      for (let j = nc - 1; j >= 0; j--) for (let i = nc - 1; i >= 0; i--) {
        const v = j * nc + i;
        let d = D[v];
        if (i < nc - 1) d = Math.min(d, D[v + 1] + a);
        if (j < nc - 1) {
          d = Math.min(d, D[v + nc] + a);
          if (i < nc - 1) d = Math.min(d, D[v + nc + 1] + b);
          if (i > 0) d = Math.min(d, D[v + nc - 1] + b);
        }
        D[v] = d;
      }
    };
    chamfer(dWater);
    chamfer(dSea);
    // land distance at sea (for fast ice)
    const dLand = new Float32Array(NC).fill(1e9);
    for (let v = 0; v < NC; v++) if (!sea[v]) dLand[v] = 0;
    chamfer(dLand);

    // biome regions: a jittered grid of seeds, each may be a burned area, birch grove or stone field
    const RG = 470;
    const rgN = Math.ceil(S / RG) + 2;
    const rr = sub(11);
    const regPts: { x: number; y: number; kind: number }[] = [];
    for (let j = 0; j < rgN; j++) for (let i = 0; i < rgN; i++) {
      const roll = rr.next();
      regPts.push({ x: (i - 1 + rr.float(0.15, 0.85)) * RG, y: (j - 1 + rr.float(0.15, 0.85)) * RG, kind: roll < 0.17 ? 1 : roll < 0.29 ? 2 : roll < 0.38 ? 3 : 0 });
    }
    const regionKind = (x: number, y: number) => {
      const gi = Math.floor(x / RG) + 1, gj = Math.floor(y / RG) + 1;
      let best = 1e18, kind = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = gi + di, b = gj + dj;
        if (a < 0 || b < 0 || a >= rgN || b >= rgN) continue;
        const p = regPts[b * rgN + a];
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < best) {
          best = d;
          kind = p.kind;
        }
      }
      return kind;
    };
    const nMoist = noise(12), nBWarp = noise(13), nClear = noise(14), nTL = noise(15);
    const moist = new Float32Array(NC);
    const biome = new Uint8Array(NC);
    const slopeC = (i: number, j: number) => {
      const a = ch[j * nc + Math.max(0, i - 1)], b = ch[j * nc + Math.min(nc - 1, i + 1)];
      const c = ch[Math.max(0, j - 1) * nc + i], d = ch[Math.min(nc - 1, j + 1) * nc + i];
      return Math.hypot(b - a, d - c) / (2 * COARSE);
    };
    const curv = (i: number, j: number) => {
      const r = 3;
      const v = ch[j * nc + i];
      let s = 0, k = 0;
      for (const [di, dj] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const a = clamp(i + di, 0, nc - 1), b = clamp(j + dj, 0, nc - 1);
        s += ch[b * nc + a];
        k++;
      }
      return v - s / k;
    };
    for (let j = 0; j < nc; j++) for (let i = 0; i < nc; i++) {
      const v = j * nc + i;
      const x = i * COARSE, y = j * COARSE;
      const h = ch[v];
      const m = clamp(0.42 + 0.32 * nMoist.fbm(x / 700, y / 700, 3) + 0.42 * Math.exp(-dWater[v] / 85) - 0.25 * smoothstep(90, 260, h), 0, 1);
      moist[v] = m;
      if (sea[v]) {
        biome[v] = B.Sea;
        continue;
      }
      if (lakeId[v] >= 0) {
        biome[v] = B.Water;
        continue;
      }
      // biome borders are warped so they look organic
      const wx = x + 90 * nBWarp.fbm(x / 260, y / 260, 3), wy = y + 90 * nBWarp.fbm(x / 260 + 9, y / 260 + 3, 3);
      const wi = clamp(Math.round(wx / COARSE), 0, nc - 1), wj = clamp(Math.round(wy / COARSE), 0, nc - 1);
      const wv = wj * nc + wi;
      const hh = ch[wv];
      const sl = slopeC(wi, wj);
      const tl = this.treeline + 25 * nTL.fbm(x / 400, y / 400, 2);
      const kind = regionKind(wx, wy);
      let b: number;
      if (dSea[wv] < 75 && hh < 9) b = B.Coast;
      else if (hh > tl + 30 || (sl > 1.05 && hh > 30)) b = B.Alpine;
      else if (hh > tl - 25) b = kind === 3 && sl < 0.35 ? B.Stones : B.Tundra;
      else if (kind === 3 && hh > 70 && sl < 0.22) b = B.Stones;
      else if (moist[wv] > 0.74 && sl < 0.05 && hh < 140) b = B.Bog;
      else if (kind === 1) b = B.Burned;
      else if (kind === 2 || (moist[wv] > 0.8 && hh < 80)) b = B.Birch;
      else if (moist[wv] < 0.34 || curv(wi, wj) > 3.2) b = B.Pine;
      else b = B.Taiga;
      biome[v] = b;
    }
    this.biome = biome;
    this.moist = moist;
    // ground look per coarse vertex (blurred so the transitions are soft)
    const clearAt = (x: number, y: number, k: number) => {
      const q = nClear.fbm(x / 170, y / 170, 3);
      return 1 - clamp(smoothstep(0.12, 0.42, q) * k * 1.6, 0, 0.96);
    };
    const rawTex = new Float32Array(NC * 4);
    const rough = new Float32Array(NC);
    for (let v = 0; v < NC; v++) {
      const d = BIOMES[biome[v]];
      const x = (v % nc) * COARSE, y = ((v / nc) | 0) * COARSE;
      const dens = clamp((d.trees * clearAt(x, y, d.clearings)) / 2.1, 0, 1);
      rawTex[v * 4] = dens;
      rawTex[v * 4 + 1] = d.floor[1];
      rawTex[v * 4 + 2] = d.floor[2];
      rawTex[v * 4 + 3] = d.floor[3];
      rough[v] = biome[v] === B.Sea || biome[v] === B.Water ? 0.2 : d.rough;
    }
    const tex = new Uint8Array(NC * 4);
    const roughB = new Float32Array(NC);
    for (let j = 0; j < nc; j++) for (let i = 0; i < nc; i++) {
      const s = [0, 0, 0, 0];
      let k = 0, rs = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const a = clamp(i + di, 0, nc - 1), b = clamp(j + dj, 0, nc - 1);
        const u = b * nc + a;
        for (let c = 0; c < 4; c++) s[c] += rawTex[u * 4 + c];
        rs += rough[u];
        k++;
      }
      const v = j * nc + i;
      for (let c = 0; c < 4; c++) tex[v * 4 + c] = Math.round(clamp(s[c] / k, 0, 1) * 255);
      roughB[v] = rs / k;
    }
    this.tex = tex;
    mark('biomes', t);

    // ---------- the house site (on the coarse grid) ----------
    t = performance.now();
    const house = this.pickHouse(ch, biome, dWater, lakeId, sea, isRiver, rng);
    this.ox = house.gx;
    this.oz = house.gy;
    mark('sites', t);

    // ---------- fine heightmap ----------
    await progress?.('Детальный рельеф', 0.5);
    t = performance.now();
    const n = this.n, nf = n + 1;
    const H = new Float32Array(nf * nf);
    const nD1 = noise(20), nD2 = noise(21), nDrift = noise(22);
    const cb = (i: number, j: number) => ch[clamp(j, 0, cn) * nc + clamp(i, 0, cn)];
    for (let j = 0; j < nf; j++) {
      const gy = j * FINE;
      const cy = gy / COARSE;
      const cj = Math.floor(cy);
      const ty = cy - cj;
      for (let i = 0; i < nf; i++) {
        const gx = i * FINE;
        const cx = gx / COARSE;
        const ci = Math.floor(cx);
        const tx = cx - ci;
        const r0 = catmull(cb(ci - 1, cj - 1), cb(ci, cj - 1), cb(ci + 1, cj - 1), cb(ci + 2, cj - 1), tx);
        const r1 = catmull(cb(ci - 1, cj), cb(ci, cj), cb(ci + 1, cj), cb(ci + 2, cj), tx);
        const r2 = catmull(cb(ci - 1, cj + 1), cb(ci, cj + 1), cb(ci + 1, cj + 1), cb(ci + 2, cj + 1), tx);
        const r3 = catmull(cb(ci - 1, cj + 2), cb(ci, cj + 2), cb(ci + 1, cj + 2), cb(ci + 2, cj + 2), tx);
        let h = catmull(r0, r1, r2, r3, ty);
        // roughness from the biome (bilinear)
        const v00 = clamp(cj, 0, cn) * nc + clamp(ci, 0, cn);
        const v10 = clamp(cj, 0, cn) * nc + clamp(ci + 1, 0, cn);
        const v01 = clamp(cj + 1, 0, cn) * nc + clamp(ci, 0, cn);
        const v11 = clamp(cj + 1, 0, cn) * nc + clamp(ci + 1, 0, cn);
        const rgh = (roughB[v00] * (1 - tx) + roughB[v10] * tx) * (1 - ty) + (roughB[v01] * (1 - tx) + roughB[v11] * tx) * ty;
        h += (nD1.fbm(gx / 38, gy / 38, 3) * 0.55 + nD2.noise(gx / 11, gy / 11) * 0.09) * rgh;
        // soft wind-blown drifts on open snow
        h += nDrift.noise(gx / 26, gy / 17) * 0.18 * clamp(1.4 - rgh, 0, 1);
        H[j * nf + i] = h;
      }
      if ((j & 127) === 0) await progress?.('Детальный рельеф', 0.5 + (0.12 * j) / nf);
    }
    this.h = H;
    mark('fine', t);

    // ---------- water: rivers, lakes, sea ----------
    await progress?.('Реки и лёд', 0.63);
    t = performance.now();
    const water = new Float32Array(nf * nf).fill(NaN);
    const ice = new Uint8Array(nf * nf);
    const bestD = new Float32Array(nf * nf).fill(1e9);
    const rL = new Float32Array(nf * nf);
    const rW = new Float32Array(nf * nf);
    const rS = new Float32Array(nf * nf);
    const rHard = new Float32Array(nf * nf);
    const hardAtG = (gx: number, gy: number) => hard[clamp(Math.round(gy / COARSE), 0, cn) * nc + clamp(Math.round(gx / COARSE), 0, cn)];
    for (const r of rivers) {
      const P = r.pts;
      for (let s = 0; s < P.length - 1; s++) {
        const a = P[s], b = P[s + 1];
        const ax = a.x * COARSE, ay = a.y * COARSE, bx = b.x * COARSE, by = b.y * COARSE;
        const segLen = Math.hypot(bx - ax, by - ay) || 1e-6;
        const slope = Math.max(0, a.level - b.level) / segLen;
        const hk = hardAtG(ax, ay);
        const wall = lerp(0.5, 2.6, 1 - hk);
        const half = Math.max(a.width, b.width) / 2;
        // the cut reaches as far as the wall needs to climb back to the ground
        const band = half + Math.min(40, 30 / wall) + 2;
        const i0 = clamp(Math.floor((Math.min(ax, bx) - band) / FINE), 0, n), i1 = clamp(Math.ceil((Math.max(ax, bx) + band) / FINE), 0, n);
        const j0 = clamp(Math.floor((Math.min(ay, by) - band) / FINE), 0, n), j1 = clamp(Math.ceil((Math.max(ay, by) + band) / FINE), 0, n);
        const ux = (bx - ax) / segLen, uy = (by - ay) / segLen;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const px = i * FINE - ax, py = j * FINE - ay;
          const tt = clamp(px * ux + py * uy, 0, segLen);
          const qx = px - ux * tt, qy = py - uy * tt;
          const d = Math.hypot(qx, qy);
          if (d > band) continue;
          const v = j * nf + i;
          if (d < bestD[v]) {
            const f = tt / segLen;
            bestD[v] = d;
            rL[v] = a.level + (b.level - a.level) * f;
            rW[v] = a.width + (b.width - a.width) * f;
            rS[v] = slope;
            rHard[v] = hk;
          }
        }
      }
    }
    for (let v = 0; v < nf * nf; v++) {
      const d = bestD[v];
      if (d > 1e8) continue;
      const L = rL[v], half = rW[v] / 2;
      const wall = lerp(0.5, 2.6, 1 - rHard[v]);
      let h = H[v];
      if (d < half) {
        const depth = 1.0 + rW[v] * 0.06;
        h = Math.min(h, L - depth * (1 - (d / half) ** 2) - 0.05);
      } else {
        h = Math.min(h, L + 0.3 + (d - half) * wall);
      }
      H[v] = h;
      if (h < L) {
        water[v] = L;
        // ice on rivers: thinner on steep stretches, open water on rapids and falls
        const s = rS[v];
        const th = s > 0.09 ? 0 : s > 0.05 ? 6 : clamp(34 - s * 260 - (rW[v] < 3 ? 6 : 0), 8, 40);
        ice[v] = th;
      }
    }
    // lakes
    const iLake: { x: number; y: number; r: number }[] = [];
    for (const r of rivers) {
      // river mouths and lake outlets keep the ice thin
      const a = r.pts[r.pts.length - 1];
      if (r.into === 'lake') iLake.push({ x: a.x * COARSE, y: a.y * COARSE, r: 14 + a.width });
    }
    const nIce = noise(23);
    // lake or sea level per coarse vertex, grown by one vertex so shores are covered
    const wC = new Float32Array(NC).fill(NaN);
    const wSea = new Uint8Array(NC);
    for (let j = 0; j < nc; j++) for (let i = 0; i < nc; i++) {
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = clamp(i + di, 0, cn), b = clamp(j + dj, 0, cn);
        const u = b * nc + a;
        if (lakeId[u] >= 0) wC[j * nc + i] = lakeLevelC[u];
        else if (sea[u]) {
          wC[j * nc + i] = 0;
          wSea[j * nc + i] = 1;
        }
      }
    }
    for (let j = 0; j < nf; j++) for (let i = 0; i < nf; i++) {
      const gx = i * FINE, gy = j * FINE;
      const ci = Math.round(gx / COARSE), cj = Math.round(gy / COARSE);
      const v = j * nf + i;
      const cv = cj * nc + ci;
      const L = wC[cv];
      if (Number.isNaN(L)) continue;
      const isSeaV = wSea[cv] === 1;
      if (H[v] >= L) continue;
      if (!Number.isNaN(water[v]) && water[v] > L) continue;
      water[v] = L;
      if (isSeaV) {
        // fast ice along the shore, open dark water further out
        const dl = dLand[cj * nc + ci];
        const lim = 70 + 45 * nIce.fbm(gx / 300, gy / 300, 2);
        ice[v] = dl < lim ? 42 : dl < lim + 14 ? 9 : 0;
      } else {
        let th = 48 + nIce.noise(gx / 60, gy / 60) * 12;
        for (const p of iLake) if (Math.hypot(gx - p.x, gy - p.y) < p.r) th = Math.min(th, 7 + (Math.hypot(gx - p.x, gy - p.y) / p.r) * 25);
        ice[v] = clamp(th, 0, 255);
      }
    }
    this.water = water;
    this.ice = ice;
    // world-space river lines (for bridges, the map and frozen falls)
    this.rivers = rivers.map((r) => ({
      x: Float32Array.from(r.pts, (p) => p.x * COARSE - this.ox),
      z: Float32Array.from(r.pts, (p) => p.y * COARSE - this.oz),
      level: Float32Array.from(r.pts, (p) => p.level),
      width: Float32Array.from(r.pts, (p) => p.width),
      into: r.into,
    }));
    for (const L of this.lakes) {
      L.x -= this.ox;
      L.z -= this.oz;
    }
    mark('water', t);

    // ---------- house pad ----------
    {
      const hx = house.gx, hy = house.gy;
      const padY = house.y;
      const i0 = clamp(Math.floor((hx - 24) / FINE), 0, n), i1 = clamp(Math.ceil((hx + 24) / FINE), 0, n);
      const j0 = clamp(Math.floor((hy - 24) / FINE), 0, n), j1 = clamp(Math.ceil((hy + 24) / FINE), 0, n);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = i * FINE - hx, dz = j * FINE - hy;
        const d = Math.hypot(dx, dz * 1.1);
        const v = j * nf + i;
        H[v] = lerp(padY, H[v], smoothstep(9, 21, d));
        if (d < 15) water[v] = NaN;
      }
      this.sites.house = { x: 0, z: 0, y: padY };
    }

    // ---------- tower ----------
    this.sites.tower = this.pickTower(rng);
    if (this.sites.tower) this.flattenPad(this.sites.tower.x, this.sites.tower.z, this.sites.tower.y, 4, 9);

    // thin ice: on the lake nearest to the house, near an inflow if there is one
    this.sites.thin = this.pickThinIce(rng);

    // cliffs reshape the sheet before anything is placed on it
    if (this.options.cliffLab) {
      t = performance.now();
      const lab = buildCliffLab(this);
      this.cliffs.push(...lab.builds);
      this.cliffLab = lab.info;
      mark('cliffs', t);
    }

    // places of people: huts, the weather station, a grotto, cars, a bridge
    this.pickPlaces(sub(50));

    // steep slopes become rock; places, the house and cliff bands keep their ground
    await progress?.('Скалы', 0.68);
    t = performance.now();
    const tower = this.sites.tower;
    this.skin = new RockSkin(this, {
      exclude: (x, z) => Math.hypot(x, z) < 30 || (!!tower && Math.hypot(x - tower.x, z - tower.z) < 14) ||
        this.places.some((p) => Math.hypot(p.x - x, p.z - z) < (p.data.clear ?? 4) + 6) || this.cliffs.some((c) => c.occupied(x, z, 2)),
    });
    mark('rock', t);

    // ---------- vegetation ----------
    await progress?.('Лес', 0.72);
    t = performance.now();
    this.placeVegetation(sub(30), clearAt, noise(31));
    mark('vegetation', t);
    await progress?.('Камни', 0.88);
    t = performance.now();
    this.placeRocks(sub(40));
    this.clearLogging(sub(51));
    // nothing grows or lies on the rock skin; hiding afterwards keeps the forest elsewhere as it was
    if (this.skin) for (const P of [this.trees, this.shrubs, this.rocks]) {
      for (let i = 0; i < P.count; i++) if (this.skin.covers(P.x[i], P.z[i])) P.flags[i] |= 1;
    }
    mark('rocks', t);
    this.timings.total = Math.round(performance.now() - t0);
    await yieldFrame();
  }

  private pickHouse(ch: Float32Array, biome: Uint8Array, dWater: Float32Array, lakeId: Int32Array, sea: Uint8Array, isRiver: Uint8Array, rng: Rng) {
    const cn = this.cn, nc = cn + 1;
    let best = -1e9, bi = Math.floor(nc / 2), bj = Math.floor(nc / 2);
    const margin = Math.round(Math.min(600, this.size * 0.2) / COARSE);
    for (let j = margin; j < nc - margin; j += 2) for (let i = margin; i < nc - margin; i += 2) {
      const v = j * nc + i;
      const b = biome[v];
      if (b !== B.Taiga && b !== B.Pine && b !== B.Birch) continue;
      const h0 = ch[v];
      if (h0 < 4 || h0 > this.treeline - 50) continue;
      // flat within ~24 m
      let dev = 0;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) dev = Math.max(dev, Math.abs(ch[(j + dj) * nc + i + di] - h0));
      if (dev > 3.2) continue;
      let wet = false;
      for (let dj = -3; dj <= 3 && !wet; dj++) for (let di = -3; di <= 3; di++) {
        const u = (j + dj) * nc + i + di;
        if (lakeId[u] >= 0 || sea[u] || isRiver[u]) wet = true;
      }
      if (wet) continue;
      // water in view in front of the porch (+z = grid +y)
      let view = 0, lakeNear = 0;
      for (let d = 5; d <= 22; d++) for (let a = -4; a <= 4; a++) {
        const xi = clamp(i + Math.round((a * d) / 8), 0, nc - 1), yi = clamp(j + d, 0, nc - 1);
        const u = yi * nc + xi;
        if (lakeId[u] >= 0) {
          view += 1 / d;
          if (d < 14) lakeNear = 1;
        } else if (sea[u] || isRiver[u]) view += 0.5 / d;
      }
      const dw = dWater[v];
      const score = view * 3 + lakeNear * 2 - Math.abs(dw - 60) / 60 - dev * 0.3 + rng.float(0, 0.6);
      if (score > best) {
        best = score;
        bi = i;
        bj = j;
      }
    }
    // pad height: mean of the neighbourhood, a bit above the lowest point
    let s = 0, k = 0, mn = Infinity;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const u = clamp(bj + dj, 0, nc - 1) * nc + clamp(bi + di, 0, nc - 1);
      s += ch[u];
      k++;
      mn = Math.min(mn, ch[u]);
    }
    const y = Math.max(mn + 0.4, s / k);
    return { gx: bi * COARSE, gy: bj * COARSE, y };
  }

  private flattenPad(x: number, z: number, y: number, r0: number, r1: number) {
    const n = this.n, nf = n + 1;
    const gx = x + this.ox, gy = z + this.oz;
    const i0 = clamp(Math.floor((gx - r1) / FINE), 0, n), i1 = clamp(Math.ceil((gx + r1) / FINE), 0, n);
    const j0 = clamp(Math.floor((gy - r1) / FINE), 0, n), j1 = clamp(Math.ceil((gy + r1) / FINE), 0, n);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i * FINE - gx, j * FINE - gy);
      const v = j * nf + i;
      this.h[v] = lerp(y, this.h[v], smoothstep(r0, r1, d));
    }
  }

  private pickTower(rng: Rng): Site | null {
    let best = -1e9;
    let site: Site | null = null;
    for (let k = 0; k < 900; k++) {
      const a = rng.float(0, Math.PI * 2), d = rng.float(220, Math.min(1100, this.size * 0.4));
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!this.inside(x, z, 300)) continue;
      const h = this.heightAt(x, z);
      if (h > this.treeline + 15 || h < 15) continue;
      if (!Number.isNaN(this.waterAt(x, z))) continue;
      if (this.slopeAt(x, z) > 0.35) continue;
      let ring = 0;
      for (let q = 0; q < 12; q++) {
        const b = (q / 12) * Math.PI * 2;
        ring += this.heightAt(x + Math.cos(b) * 160, z + Math.sin(b) * 160);
      }
      const prom = h - ring / 12;
      const score = prom - d * 0.008 + rng.float(0, 2);
      if (score > best) {
        best = score;
        site = { x, z, y: h };
      }
    }
    return site;
  }

  private pickThinIce(rng: Rng) {
    let best: LakeInfo | null = null;
    let bd = Infinity;
    for (const L of this.lakes) {
      const d = Math.hypot(L.x, L.z);
      if (L.area > 1500 && d < bd) {
        bd = d;
        best = L;
      }
    }
    if (!best) return null;
    // a point on that lake, away from the house side
    for (let k = 0; k < 400; k++) {
      const a = rng.float(0, Math.PI * 2), r = rng.float(0, Math.sqrt(best.area / Math.PI) * 0.8);
      const x = best.x + Math.cos(a) * r, z = best.z + Math.sin(a) * r;
      if (this.waterAt(x, z) !== best.level) continue;
      // keep it surrounded by water
      let ok = true;
      for (let q = 0; q < 8 && ok; q++) {
        const b = (q / 8) * Math.PI * 2;
        if (this.waterAt(x + Math.cos(b) * 5, z + Math.sin(b) * 5) !== best.level) ok = false;
      }
      if (!ok || Math.hypot(x, z) < 20) continue;
      return { x, z, r: 3.2 };
    }
    return null;
  }

  // ---------- vegetation ----------

  private makeProps(list: number[][]): Props {
    const cells = Math.ceil(this.size / PROP_CELL);
    const cellOf = (p: number[]) => {
      const ci = clamp(Math.floor((p[0] + this.ox) / PROP_CELL), 0, cells - 1);
      const cj = clamp(Math.floor((p[1] + this.oz) / PROP_CELL), 0, cells - 1);
      return cj * cells + ci;
    };
    const keyed = list.map((p) => ({ p, c: cellOf(p) }));
    keyed.sort((a, b) => a.c - b.c);
    const N = keyed.length;
    const P: Props = {
      count: N,
      x: new Float32Array(N), z: new Float32Array(N), y: new Float32Array(N), s: new Float32Array(N), rot: new Float32Array(N),
      kind: new Uint8Array(N), variant: new Uint8Array(N), flags: new Uint8Array(N),
      cellStart: new Int32Array(cells * cells + 1), cells, cellSize: PROP_CELL,
    };
    let c = 0;
    for (let i = 0; i < N; i++) {
      const { p, c: cc } = keyed[i];
      while (c <= cc) P.cellStart[c++] = i;
      P.x[i] = p[0];
      P.z[i] = p[1];
      P.y[i] = p[2];
      P.s[i] = p[3];
      P.rot[i] = p[4];
      P.kind[i] = p[5];
      P.variant[i] = p[6];
    }
    while (c <= cells * cells) P.cellStart[c++] = N;
    return P;
  }

  /** prop indices within radius of a point */
  forEachProp(P: Props, x: number, z: number, r: number, fn: (i: number) => void) {
    const cs = P.cellSize;
    const i0 = clamp(Math.floor((x + this.ox - r) / cs), 0, P.cells - 1), i1 = clamp(Math.floor((x + this.ox + r) / cs), 0, P.cells - 1);
    const j0 = clamp(Math.floor((z + this.oz - r) / cs), 0, P.cells - 1), j1 = clamp(Math.floor((z + this.oz + r) / cs), 0, P.cells - 1);
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * P.cells + i;
      for (let k = P.cellStart[c]; k < P.cellStart[c + 1]; k++) {
        const dx = P.x[k] - x, dz = P.z[k] - z;
        if (dx * dx + dz * dz <= r2) fn(k);
      }
    }
  }

  private blocked(x: number, z: number) {
    // keep the house yard, the tower pad and other places free
    if (Math.hypot(x, z * 1.1) < 13) return true;
    if (x > 4 && x < 10 && z > -4 && z < 7) return true;
    const t = this.sites.tower;
    if (t && Math.hypot(x - t.x, z - t.z) < 7) return true;
    for (const p of this.places) {
      const r = p.data.clear ?? 0;
      if (r > 0 && Math.hypot(x - p.x, z - p.z) < r) return true;
    }
    for (const c of this.cliffs) if (c.occupied(x, z, 1)) return true;
    return false;
  }

  private flatAround(x: number, z: number, r: number) {
    let mn = Infinity, mx = -Infinity;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      for (const d of [r * 0.5, r]) {
        const xx = x + Math.cos(a) * d, zz = z + Math.sin(a) * d;
        if (!Number.isNaN(this.waterAt(xx, zz))) return Infinity;
        const h = this.heightAt(xx, zz);
        mn = Math.min(mn, h);
        mx = Math.max(mx, h);
      }
    }
    return mx - mn;
  }

  private farFrom(x: number, z: number, d: number) {
    if (Math.hypot(x, z) < d) return false;
    if (this.cliffs.some((c) => c.occupied(x, z, 12))) return false;
    const t = this.sites.tower;
    if (t && Math.hypot(x - t.x, z - t.z) < d * 0.6) return false;
    return this.places.every((p) => Math.hypot(p.x - x, p.z - z) > d * (p.kind === 'car' ? 0.2 : 1));
  }

  private pickPlaces(rng: Rng) {
    const S = this.size;
    const maxD = S * 0.62;
    const add = (kind: PlaceKind, x: number, z: number, yaw: number, data: Record<string, any> = {}) => {
      const p: Place = { kind, x, z, y: this.heightAt(x, z), yaw, remote: clamp(Math.hypot(x, z) / (S * 0.5), 0, 1), data };
      this.places.push(p);
      return p;
    };
    // the weather station: the highest reachable flat spot far from the house
    {
      let best = -1e9, bx = NaN, bz = NaN;
      for (const tol of [2.5, 4.5, 9, 1e9]) {
        for (let k = 0; k < 2500; k++) {
          const x = rng.float(this.minX + 260, this.maxX - 260), z = rng.float(this.minZ + 260, this.maxZ - 260);
          if (Math.hypot(x, z) < S * 0.3) continue;
          const h = this.heightAt(x, z);
          if (this.flatAround(x, z, 9) > tol) continue;
          if (h > best) {
            best = h;
            bx = x;
            bz = z;
          }
        }
        if (!Number.isNaN(bx)) break;
      }
      if (Number.isNaN(bx)) {
        bx = S * 0.35;
        bz = 0;
      }
      const p = add('station', bx, bz, rng.float(0, Math.PI * 2), { clear: 14 });
      this.flattenPad(bx, bz, p.y, 7, 13);
    }
    // hunters' huts: one close to the house for sure, then more further out
    const tryHut = (minD: number, maxD: number, tol: number, spacing: number) => {
      for (let k = 0; k < 2500; k++) {
        const a = rng.float(0, Math.PI * 2), d = rng.float(minD, maxD);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (!this.inside(x, z, 220) || !this.farFrom(x, z, spacing)) continue;
        const b = this.biomeAt(x, z);
        if (b === B.Alpine || b === B.Sea || b === B.Water) continue;
        if (this.flatAround(x, z, 7) > tol) continue;
        const p = add('hut', x, z, Math.round(rng.float(0, 4)) * (Math.PI / 2) + rng.float(-0.3, 0.3), { clear: 9 });
        this.flattenPad(x, z, p.y, 4.5, 10);
        return p;
      }
      return null;
    };
    let near: Place | null = null;
    for (const tol of [1.6, 2.6, 4, 7, 1e9]) if (!near) near = tryHut(160, 420, tol, 140);
    let huts = near ? 1 : 0;
    for (const tol of [1.6, 2.6, 4]) while (huts < 5 && tryHut(380, maxD, tol, 330)) huts++;
    for (const tol of [7, 1e9]) while (huts < 3 && tryHut(300, maxD, tol, 250)) huts++;
    // abandoned cars by two of the huts
    const hutList = this.places.filter((p) => p.kind === 'hut');
    for (const h of hutList.slice(0, 3)) {
      if (this.places.filter((p) => p.kind === 'car').length >= 2) break;
      for (let k = 0; k < 8; k++) {
        const ca = rng.float(0, Math.PI * 2);
        const cx = h.x + Math.cos(ca) * 9, cz = h.z + Math.sin(ca) * 9;
        if (this.flatAround(cx, cz, 3) < 1.5 && Number.isNaN(this.waterAt(cx, cz))) {
          add('car', cx, cz, rng.float(0, Math.PI * 2), { clear: 4 });
          break;
        }
      }
    }
    // the battery for the radio is in one of the cars (or a hut if there is no car)
    const cars = this.places.filter((p) => p.kind === 'car');
    const holder = cars.length ? rng.pick(cars) : rng.pick(this.places.filter((p) => p.kind === 'hut'));
    if (holder) holder.data.battery = true;
    // grottos under cliffs
    for (let k = 0, ng = 0; k < 9000 && ng < 3; k++) {
      const a = rng.float(0, Math.PI * 2), d = rng.float(300, maxD);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!this.inside(x, z, 200) || !this.farFrom(x, z, 250)) continue;
      const sl = this.slopeAt(x, z);
      if (sl > 0.25) continue;
      // steep rise behind: find uphill direction
      const e = 3;
      const gx = this.heightAt(x + e, z) - this.heightAt(x - e, z), gz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
      const gl = Math.hypot(gx, gz);
      if (gl < 1e-3) continue;
      const ux = gx / gl, uz = gz / gl;
      const rise = this.heightAt(x + ux * 12, z + uz * 12) - this.heightAt(x, z);
      if (rise < 7 || this.flatAround(x, z, 4) > 1.5) continue;
      if (!this.farFrom(x, z, 400)) continue;
      const p = add('grotto', x, z, Math.atan2(-ux, -uz), { clear: 7 });
      this.flattenPad(x, z, p.y, 3, 6);
      ng++;
    }
    // fishermen's huts on lake shores, facing the water
    {
      const lakes = [...this.lakes].filter((L) => L.area > 2500).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
      let nf = 0;
      for (const L of lakes) {
        if (nf >= 3) break;
        const R0 = Math.sqrt(L.area / Math.PI);
        for (let k = 0; k < 40; k++) {
          const a = rng.float(0, Math.PI * 2);
          // walk out from the centre to the first dry ground
          let sx = NaN, sz = NaN;
          for (let r = R0 * 0.5; r < R0 * 2.5; r += 1.5) {
            const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
            if (Number.isNaN(this.waterAt(x, z))) {
              sx = L.x + Math.cos(a) * (r + 7);
              sz = L.z + Math.sin(a) * (r + 7);
              break;
            }
          }
          if (Number.isNaN(sx) || !this.inside(sx, sz, 200) || !this.farFrom(sx, sz, 200)) continue;
          if (this.flatAround(sx, sz, 5) > 2.2 || Math.hypot(sx, sz) < 60) continue;
          const p = add('fishing', sx, sz, Math.atan2(L.x - sx, L.z - sz), { clear: 8, lake: [L.x, L.z, L.level] });
          this.flattenPad(sx, sz, p.y, 3.5, 7);
          nf++;
          break;
        }
      }
    }
    // hunters' lean-tos of poles and spruce boughs, scattered through the forest
    for (let k = 0, nl = 0; k < 6000 && nl < 7; k++) {
      const a = rng.float(0, Math.PI * 2), d = rng.float(150, maxD);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!this.inside(x, z, 200) || !this.farFrom(x, z, 260)) continue;
      const b = this.biomeAt(x, z);
      if (b !== B.Taiga && b !== B.Pine && b !== B.Birch && b !== B.Burned && b !== B.Tundra) continue;
      if (this.flatAround(x, z, 3.5) > 1.2) continue;
      const p = add('leanto', x, z, rng.float(0, Math.PI * 2), { clear: 5 });
      this.flattenPad(x, z, p.y, 2.5, 5);
      nl++;
    }
    // a footbridge over the river nearest to the house
    {
      let best: { x: number; z: number; w: number; L: number; dx: number; dz: number } | null = null;
      let bd = Infinity;
      for (const r of this.rivers) {
        for (let i = 2; i < r.x.length - 2; i += 2) {
          const w = r.width[i];
          if (w < 3.5 || w > 16) continue;
          const x = r.x[i], z = r.z[i];
          const d = Math.hypot(x, z);
          if (d < 80 || d > 1100 || d > bd || !this.inside(x, z, 150)) continue;
          const tx = r.x[i + 2] - r.x[i - 2], tz = r.z[i + 2] - r.z[i - 2];
          const tl = Math.hypot(tx, tz) || 1;
          const nx = -tz / tl, nz = tx / tl;
          const half = w / 2 + 4;
          const ha = this.heightAt(x + nx * half, z + nz * half), hb = this.heightAt(x - nx * half, z - nz * half);
          if (!Number.isNaN(this.waterAt(x + nx * half, z + nz * half)) || !Number.isNaN(this.waterAt(x - nx * half, z - nz * half))) continue;
          if (Math.abs(ha - hb) > 2.5 || Math.min(ha, hb) < r.level[i] + 0.8) continue;
          bd = d;
          best = { x, z, w, L: r.level[i], dx: nx, dz: nz };
        }
      }
      if (best) add('bridge', best.x, best.z, Math.atan2(best.dx, best.dz), { half: best.w / 2 + 4, level: best.L, nx: best.dx, nz: best.dz, clear: 0 });
    }
    // logging sites (filled in after the trees are placed) and a lonely cross
    for (let k = 0, n = 0; k < 2000 && n < 2; k++) {
      const a = rng.float(0, Math.PI * 2), d = rng.float(150, maxD * 0.8);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!this.inside(x, z, 200) || !this.farFrom(x, z, 250)) continue;
      const b = this.biomeAt(x, z);
      if (b !== B.Taiga && b !== B.Pine) continue;
      if (this.flatAround(x, z, 12) > 4) continue;
      add('logging', x, z, rng.float(0, 6.28), { clear: 0 });
      n++;
    }
    for (let k = 0; k < 2000; k++) {
      const a = rng.float(0, Math.PI * 2), d = rng.float(150, 700);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!this.inside(x, z, 200) || !this.farFrom(x, z, 120) || this.slopeAt(x, z) > 0.2) continue;
      if (!Number.isNaN(this.waterAt(x, z))) continue;
      add('cross', x, z, rng.float(0, 6.28), { clear: 2 });
      break;
    }
  }

  /** logging sites: the trees there are already cut, leaving stumps */
  private clearLogging(rng: Rng) {
    for (const p of this.places) {
      if (p.kind !== 'logging') continue;
      const stumps: number[][] = [];
      this.forEachProp(this.trees, p.x, p.z, 20, (i) => {
        if (rng.chance(0.85)) {
          this.trees.flags[i] |= 1;
          stumps.push([this.trees.x[i], this.trees.z[i], this.trees.y[i], this.trees.s[i]]);
        }
      });
      p.data.stumps = stumps;
    }
  }

  private placeVegetation(rng: Rng, clearAt: (x: number, y: number, k: number) => number, nVar: Simplex2) {
    const S = this.size;
    const trees: number[][] = [];
    const shrubs: number[][] = [];
    const g = 3.1;
    const N = Math.floor(S / g);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const gx = (i + rng.float(0.15, 0.85)) * g, gy = (j + rng.float(0.15, 0.85)) * g;
      const x = gx - this.ox, z = gy - this.oz;
      // ecotones: sample the biome a little off the real spot
      const bx = x + rng.float(-22, 22), bz = z + rng.float(-22, 22);
      const bio = this.biomeAt(bx, bz);
      const def = BIOMES[bio];
      if (def.trees <= 0 && def.shrubs <= 0) {
        rng.next();
        continue;
      }
      const clear = clearAt(gx, gy, def.clearings);
      const roll = rng.next();
      const pTree = (def.trees * clear * g * g) / 100;
      const pShrub = ((def.shrubs * (1 + (1 - clear) * 1.6)) * g * g) / 100;
      if (roll > pTree + pShrub) continue;
      if (this.edgeDist(x, z) < 6) continue;
      if (!Number.isNaN(this.waterAt(x, z)) || !Number.isNaN(this.waterAt(x + 1.5, z)) || !Number.isNaN(this.waterAt(x - 1.5, z)) || !Number.isNaN(this.waterAt(x, z + 1.5)) || !Number.isNaN(this.waterAt(x, z - 1.5))) continue;
      if (this.blocked(x, z)) continue;
      const y = this.heightAt(x, z);
      const sl = this.slopeAt(x, z);
      if (roll < pTree) {
        if (sl > 0.85) continue;
        // pick species
        let tot = 0;
        for (const [, w] of def.mix) tot += w;
        let r = rng.float(0, tot);
        let sp = def.mix[0][0];
        for (const [s, w] of def.mix) {
          r -= w;
          if (r <= 0) {
            sp = s;
            break;
          }
        }
        if (y > this.treeline - 10 && sp !== Sp.Dwarf && rng.chance(0.7)) sp = Sp.Dwarf;
        let s = rng.float(def.scale[0], def.scale[1]);
        // smaller trees at clearing edges, high up and on young regrowth
        s *= lerp(0.72, 1, clear) * lerp(1, 0.6, smoothstep(this.treeline - 70, this.treeline + 10, y));
        if (bio === B.Burned && sp === Sp.Birch) s *= 0.5;
        s *= 0.9 + 0.2 * (nVar.noise(x / 90, z / 90) * 0.5 + 0.5);
        const variant = sp === Sp.Spruce ? rng.int(0, 2) : sp === Sp.Pine || sp === Sp.Birch || sp === Sp.Burnt ? rng.int(0, 1) : 0;
        trees.push([x, z, y, s, rng.float(0, Math.PI * 2), sp, variant]);
      } else {
        // shrubs, or reeds near water and in bogs
        const wet = bio === B.Bog || bio === B.Coast;
        const kind = wet && rng.chance(0.55) ? 1 : 0;
        shrubs.push([x, z, y, rng.float(0.6, 1.3), rng.float(0, Math.PI * 2), kind, rng.int(0, 2)]);
      }
    }
    // reeds along lake and river shores
    for (let k = 0; k < Math.round(S * S * 0.0006); k++) {
      const x = rng.float(this.minX, this.maxX), z = rng.float(this.minZ, this.maxZ);
      const w = this.waterAt(x, z);
      if (Number.isNaN(w) || w === 0) continue;
      // shore: dry land within 3 m
      let shore = false;
      for (let q = 0; q < 6 && !shore; q++) {
        const a = (q / 6) * Math.PI * 2;
        if (Number.isNaN(this.waterAt(x + Math.cos(a) * 3, z + Math.sin(a) * 3))) shore = true;
      }
      if (!shore || this.blocked(x, z)) continue;
      shrubs.push([x, z, w, rng.float(0.7, 1.2), rng.float(0, 6.28), 1, rng.int(0, 2)]);
    }
    this.trees = this.makeProps(trees);
    this.shrubs = this.makeProps(shrubs);
  }

  private placeRocks(rng: Rng) {
    const S = this.size;
    const rocks: number[][] = [];
    const g = 11;
    const N = Math.floor(S / g);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i + rng.float(0, 1)) * g - this.ox, z = (j + rng.float(0, 1)) * g - this.oz;
      const bio = this.biomeAt(x, z);
      const def = BIOMES[bio];
      const sl = this.slopeAt(x, z);
      let p = (def.rocks * g * g) / 10000;
      p *= 1 + smoothstep(0.4, 1.0, sl) * 4;
      const w = this.waterAt(x, z);
      if (!Number.isNaN(w)) {
        if (this.iceAt(x, z) > 0.2 || w > 0) continue;
      }
      if (rng.next() > p || this.blocked(x, z) || this.edgeDist(x, z) < 4) continue;
      const big = bio === B.Alpine || bio === B.Tundra || sl > 0.6;
      const s = big ? 0.5 + Math.pow(rng.next(), 2.2) * 3.4 : 0.35 + Math.pow(rng.next(), 2.6) * 1.7;
      rocks.push([x, z, this.heightAt(x, z), s, rng.float(0, Math.PI * 2), 0, rng.int(0, 3)]);
    }
    // boulders on lake shores
    for (const L of this.lakes) {
      const R = Math.sqrt(L.area / Math.PI);
      const k = Math.round(R / 5);
      for (let q = 0; q < k; q++) {
        const a = rng.float(0, Math.PI * 2);
        for (let r = R * 0.6; r < R * 1.8; r += 1.5) {
          const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
          if (Number.isNaN(this.waterAt(x, z))) {
            if (!this.blocked(x, z) && rng.chance(0.6)) rocks.push([x, z, this.heightAt(x, z), 0.4 + Math.pow(rng.next(), 2) * 1.6, rng.float(0, 6.28), 0, rng.int(0, 3)]);
            break;
          }
        }
      }
    }
    this.rocks = this.makeProps(rocks);

    // rock pillars in the stone fields, and at least one group as a landmark
    const cands: { x: number; z: number }[] = [];
    for (let k = 0; k < 4000; k++) {
      const x = rng.float(this.minX + 200, this.maxX - 200), z = rng.float(this.minZ + 200, this.maxZ - 200);
      const b = this.biomeAt(x, z);
      if (b === B.Stones) cands.push({ x, z });
    }
    if (cands.length === 0) {
      for (let k = 0; k < 4000 && cands.length < 30; k++) {
        const x = rng.float(this.minX + 250, this.maxX - 250), z = rng.float(this.minZ + 250, this.maxZ - 250);
        const b = this.biomeAt(x, z);
        if ((b === B.Tundra || b === B.Pine) && this.slopeAt(x, z) < 0.25 && Math.hypot(x, z) > 300) cands.push({ x, z });
      }
    }
    const groups = Math.min(3, Math.max(1, Math.floor(cands.length / 40)));
    for (let gq = 0; gq < groups && cands.length; gq++) {
      const c = cands[rng.int(0, cands.length - 1)];
      const cnt = rng.int(4, 8);
      for (let q = 0; q < cnt; q++) {
        const a = rng.float(0, Math.PI * 2), d = rng.float(0, 60);
        const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
        if (!Number.isNaN(this.waterAt(x, z)) || this.pillars.some((p) => Math.hypot(p.x - x, p.z - z) < 14)) continue;
        const h = rng.float(14, 34);
        this.pillars.push({ x, z, y: this.heightAt(x, z), h, r: rng.float(2.6, 5.2) * (0.6 + h / 50), seed: rng.int(0, 1e6) });
      }
    }
    // no trees right at the pillars
    for (const p of this.pillars) this.forEachProp(this.trees, p.x, p.z, p.r + 2.5, (i) => (this.trees.flags[i] |= 1));
  }

  /** stats for the debug panel */
  stats() {
    const counts = new Array(BIOME_COUNT).fill(0);
    for (const b of this.biome) counts[b]++;
    return { counts, trees: this.trees.count, shrubs: this.shrubs.count, rocks: this.rocks.count, lakes: this.lakes.length, rivers: this.rivers.length, pillars: this.pillars.length, timings: this.timings };
  }
}
