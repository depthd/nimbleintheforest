// Rock skin: steep mountain slopes dressed in rows of faceted strata.
//
// Where the sheet is too steep to walk (over ~52°) it used to show as one stretched texture.
// Here the slope is cut by bedding planes shared by the whole map (gently tilted, so they do
// not look ruled). Each plane meets the sheet along a contour; along every contour runs a row
// of blocks. A block's front stands a little proud of the slope, its back is buried in it, and
// its top reaches the next contour up, so the rows close over the sheet like a stepped rock face
// with a snowy ledge on every step.
//
// Unlike cliff bands this does not change the sheet at all: water, paths, places and the snow
// layer are untouched. Pure data, like gen/cliffs.ts.
import { Rng, Simplex2, clamp, lerp, smoothstep } from '../core/rng';
import { pillow } from './cliffs';
import type { CliffBlock, CliffMesh } from './cliffs';

export interface SkinSheet {
  h: Float32Array; water: Float32Array; n: number; ox: number; oz: number; cell: number; seed: number; size: number;
  edgeDist(x: number, z: number): number;
}

export interface SkinOptions {
  /** ground that must stay bare: places, the house, cliff bands */
  exclude?: (x: number, z: number) => boolean;
  /** slopes at least this steep are dressed, degrees */
  minDeg?: number;
  /** cells closer than this to the map border are left as they are */
  border?: number;
}

const MIN_DEG = 49; // just above what the player can climb (48°)
/** within this distance of the border the impassable ridges get coarser rows */
const OUTER = 260;

export class RockSkin {
  readonly blocks: CliffBlock[] = [];
  caps: CliffMesh = { positions: new Float32Array(0), indices: new Uint32Array(0) };
  /** per sheet cell: 1 where the rock covers the slope */
  readonly mask: Uint8Array;
  readonly timings: Record<string, number> = {};
  private readonly n: number;
  private readonly ox: number;
  private readonly oz: number;
  private readonly cell: number;

  constructor(R: SkinSheet, o: SkinOptions = {}) {
    const t0 = performance.now();
    const { h: H, n, cell } = R;
    this.n = n; this.ox = R.ox; this.oz = R.oz; this.cell = cell;
    const nf = n + 1;
    const rng = new Rng(R.seed * 7151 + 3);
    const noise = new Simplex2(() => rng.next());
    const minK = Math.tan(((o.minDeg ?? MIN_DEG) * Math.PI) / 180);
    const nearK = Math.tan((((o.minDeg ?? MIN_DEG) - 9) * Math.PI) / 180);
    // the impassable border ridges stay sheet, drawn as rock by the ground shader: dressed
    // coarsely they read as giant monoliths, finely they would cost more than everything else
    const border = o.border ?? OUTER;
    const edge = (i: number, j: number) => Math.min(i, j, n - 1 - i, n - 1 - j) * cell;
    const centre = (i: number, j: number) => [(i + 0.5) * cell - R.ox, (j + 0.5) * cell - R.oz];
    const cellSlope = (k: number) => Math.max(
      Math.hypot(H[k + 1] - H[k], H[k + nf] - H[k]),
      Math.hypot(H[k + nf + 1] - H[k + nf], H[k + nf + 1] - H[k + 1])) / cell;
    const wet = (k: number) => !Number.isNaN(R.water[k]) || !Number.isNaN(R.water[k + 1]) || !Number.isNaN(R.water[k + nf]) || !Number.isNaN(R.water[k + nf + 1]);

    // ---- which cells are rock ----
    const mask = (this.mask = new Uint8Array(n * n));
    const steep = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const c = j * n + i, k = j * nf + i;
      const s = cellSlope(k);
      if (s < nearK || wet(k) || edge(i, j) < border) continue;
      steep[c] = s >= minK ? 2 : 1;
    }
    // grow from the truly steep cells into their nearly-steep neighbours, so rows do not stop
    // on a hair of slope; skip excluded ground and specks too small to read as rock
    const seen = new Uint8Array(n * n), stack: number[] = [], comp: number[] = [];
    for (let c0 = 0; c0 < n * n; c0++) {
      if (steep[c0] !== 2 || seen[c0]) continue;
      comp.length = 0; stack.push(c0); seen[c0] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        comp.push(c);
        const i = c % n, j = (c / n) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          const u = jj * n + ii;
          if (seen[u] || !steep[u]) continue;
          // a nearly-steep cell only joins next to a truly steep one
          if (steep[u] === 1 && steep[c] !== 2) continue;
          seen[u] = 1; stack.push(u);
        }
      }
      if (comp.length < 8) continue;
      for (const c of comp) {
        const [x, z] = centre(c % n, (c / n) | 0);
        if (o.exclude?.(x, z)) continue;
        mask[c] = 1;
      }
    }
    this.timings.mask = Math.round(performance.now() - t0);

    // ---- bedding planes ----
    // f = h − tilt: the planes are level sets of f, so they dip gently and warp over hundreds
    // of metres instead of being perfectly level
    // tilted beds: a smooth field whose slope reaches ~30°, dipping a different way on every
    // massif. Kept well below the dressed slopes (≥52°), so every bed still crosses them once.
    const tilt = (x: number, z: number) => 150 * noise.noise(x / 950 + 3.1, z / 950 - 7.4) + 52 * noise.noise(x / 270 - 5, z / 270 + 2);
    const F = new Float32Array(nf * nf).fill(NaN);
    const fAt = (k: number) => {
      let v = F[k];
      if (Number.isNaN(v)) { const i = k % nf, j = (k / nf) | 0; v = F[k] = H[k] - tilt(i * cell - R.ox, j * cell - R.oz); }
      return v;
    };
    let fMin = Infinity, fMax = -Infinity;
    for (let c = 0; c < n * n; c++) if (mask[c]) {
      const k = ((c / n) | 0) * nf + (c % n);
      for (const q of [k, k + 1, k + nf, k + nf + 1]) { const v = fAt(q); fMin = Math.min(fMin, v); fMax = Math.max(fMax, v); }
    }
    if (!(fMax > fMin)) { this.timings.total = Math.round(performance.now() - t0); return; }
    // strata: thickness and hardness follow slow noise, so the same beds recur on every peak
    const levels: number[] = [], hard: number[] = [];
    for (let y = Math.floor(fMin) - 1, q = 0; y < fMax + 9; q++) {
      const hd = clamp(0.5 + 0.5 * noise.noise(q * 0.31, 11.7) + rng.float(-0.25, 0.25), 0, 1);
      levels.push(y); hard.push(hd);
      y += lerp(4.2, 9.0, hd) + rng.float(-0.8, 0.8);
    }
    const L = levels.length;
    const levelBelow = (v: number) => {
      let lo = 0, hi = L - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (levels[mid] <= v) lo = mid; else hi = mid - 1; }
      return lo;
    };

    // ---- contours: bucket triangles by the planes they cross ----
    // triangles of a cell, matching the terrain mesh: (k, k+1, k+nf) and (k+1, k+nf, k+nf+1)
    const counts = new Int32Array(L + 1);
    const tris: number[] = []; // packed (cell * 2 + half)
    for (let c = 0; c < n * n; c++) if (mask[c]) { tris.push(c * 2, c * 2 + 1); }
    const triVerts = (t: number): [number, number, number] => {
      const c = t >> 1, k = ((c / n) | 0) * nf + (c % n);
      return t & 1 ? [k + 1, k + nf, k + nf + 1] : [k, k + 1, k + nf];
    };
    const span = (t: number) => {
      const [a, b, d] = triVerts(t);
      const lo = Math.min(fAt(a), fAt(b), fAt(d)), hi = Math.max(fAt(a), fAt(b), fAt(d));
      return [levelBelow(lo) + 1, levelBelow(hi)]; // planes strictly above lo, at or below hi
    };
    for (const t of tris) { const [a, b] = span(t); for (let l = a; l <= b; l++) counts[l + 1]++; }
    for (let l = 0; l < L; l++) counts[l + 1] += counts[l];
    const bucket = new Int32Array(counts[L]), fill = counts.slice(0, L);
    for (const t of tris) { const [a, b] = span(t); for (let l = a; l <= b; l++) bucket[fill[l]++] = t; }
    this.timings.contours = Math.round(performance.now() - t0);

    // ---- rows of blocks along each contour ----
    const hAt = (x: number, z: number) => {
      const fx = clamp((x + R.ox) / cell, 0, n - 1e-6), fz = clamp((z + R.oz) / cell, 0, n - 1e-6);
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * nf + i;
      return u + v <= 1 ? H[k] + (H[k + 1] - H[k]) * u + (H[k + nf] - H[k]) * v : H[k + nf + 1] + (H[k + nf] - H[k + nf + 1]) * (1 - u) + (H[k + 1] - H[k + nf + 1]) * (1 - v);
    };
    const capPos: number[] = [], capIdx: number[] = [];
    const edgeKey = (a: number, b: number) => (a < b ? a * 4 + (b - a === 1 ? 0 : b - a === nf ? 1 : 2) : b * 4 + (a - b === 1 ? 0 : a - b === nf ? 1 : 2));
    for (let l = 0; l < L - 1; l++) {
      const y = levels[l];
      // segments of this plane: each joins two crossing points keyed by their grid edge
      const ends = new Map<number, number[]>(); // edge → segment indices
      const segA: number[] = [], segB: number[] = [];
      const point = new Map<number, [number, number]>();
      for (let q = counts[l]; q < counts[l + 1]; q++) {
        const t = bucket[q];
        const v = triVerts(t);
        const cross: number[] = [];
        for (let e = 0; e < 3; e++) {
          const a = v[e], b = v[(e + 1) % 3], fa = fAt(a), fb = fAt(b);
          if ((fa >= y) === (fb >= y)) continue;
          const key = edgeKey(a, b);
          if (!point.has(key)) {
            const w = (y - fa) / (fb - fa);
            const ax = (a % nf) * cell - R.ox, az = ((a / nf) | 0) * cell - R.oz, bx = (b % nf) * cell - R.ox, bz = ((b / nf) | 0) * cell - R.oz;
            point.set(key, [lerp(ax, bx, w), lerp(az, bz, w)]);
          }
          cross.push(key);
        }
        if (cross.length !== 2) continue;
        const s = segA.length;
        segA.push(cross[0]); segB.push(cross[1]);
        for (const key of cross) { const list = ends.get(key); if (list) list.push(s); else ends.set(key, [s]); }
      }
      // chain segments into polylines
      const used = new Uint8Array(segA.length);
      for (let s0 = 0; s0 < segA.length; s0++) {
        if (used[s0]) continue;
        used[s0] = 1;
        const chain = [segA[s0], segB[s0]];
        for (const forward of [true, false]) {
          for (;;) {
            const tip = forward ? chain[chain.length - 1] : chain[0];
            const next = (ends.get(tip) ?? []).find((s) => !used[s]);
            if (next === undefined) break;
            used[next] = 1;
            const other = segA[next] === tip ? segB[next] : segA[next];
            if (forward) chain.push(other); else chain.unshift(other);
          }
        }
        const pts = chain.map((key) => point.get(key)!);
        this.row(pts, l, levels, hard, (x, z) => R.edgeDist(x, z), hAt, tilt, rng, noise, capPos, capIdx);
      }
    }
    this.caps = { positions: Float32Array.from(capPos), indices: Uint32Array.from(capIdx) };
    this.timings.total = Math.round(performance.now() - t0);
  }

  /** Blocks along one contour of bedding plane l. */
  private row(raw: [number, number][], l: number, levels: number[], hard: number[], edgeDist: (x: number, z: number) => number,
    hAt: (x: number, z: number) => number, tilt: (x: number, z: number) => number, rng: Rng, noise: Simplex2, capPos: number[], capIdx: number[]) {
    // drop crowded points, then ease the grid's zigzag a little
    const pts: [number, number][] = [];
    for (const p of raw) if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 0.8) pts.push(p);
    if (pts.length < 2) return;
    for (let i = 1; i < pts.length - 1; i++) pts[i] = [(pts[i - 1][0] + 2 * pts[i][0] + pts[i + 1][0]) / 4, (pts[i - 1][1] + 2 * pts[i][1] + pts[i + 1][1]) / 4];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    if (total < 2.5) return;
    let cursor = 1;
    const at = (s: number) => {
      s = clamp(s, 0, total);
      if (cum[cursor - 1] > s) cursor = 1;
      while (cursor < cum.length - 1 && cum[cursor] < s) cursor++;
      const w = (s - cum[cursor - 1]) / Math.max(1e-6, cum[cursor] - cum[cursor - 1]);
      return [lerp(pts[cursor - 1][0], pts[cursor][0], w), lerp(pts[cursor - 1][1], pts[cursor][1], w)];
    };
    // far out on the border ridges only every third plane makes a row: coarse, few blocks
    const [mx, mz] = at(total / 2);
    const outer = edgeDist(mx, mz) < OUTER;
    if (outer && l % 3 !== 0) return;
    const next = outer ? Math.min(levels.length - 1, l + 3) : l + 1;
    const hd = hard[l];
    let s = 0;
    while (s < total - 0.4) {
      let len = outer ? rng.float(14, 24) : lerp(rng.float(4, 8), rng.float(8, 16), hd);
      if (total - (s + len) < len * 0.4) len = total - s;
      const sa = s, sb = Math.min(total, s + len), sm = lerp(sa, sb, rng.float(0.35, 0.65));
      s = sb;
      // now and then a block spans two beds; buttresses stand out, shallow blocks read as joints
      const span = !outer && rng.chance(0.12) && next + 1 < levels.length ? 1 : 0;
      const y0 = levels[l], y1 = levels[next + span];
      const thick = y1 - y0;
      const kind = rng.next();
      const protrude = (kind < 0.08 ? 0.12 : kind > 0.9 ? 1.6 : rng.float(0.3, 0.95)) + 0.5 * smoothstep(0.2, 0.8, noise.noise(mx / 23 + sa / 17, l * 0.7));
      const dback = rng.float(1.4, 2.6);
      const S = [sa - 0.15, sm, sb + 0.15];
      const P: { x: number; z: number; ux: number; uz: number; g: number; p: number; dist: number }[] = [];
      for (let j = 0; j < 3; j++) {
        const [x, z] = at(S[j]);
        // across the row means up the tilted beds (the gradient of f = h − tilt), not up the slope
        const e = 0.8, f = (xx: number, zz: number) => hAt(xx, zz) - tilt(xx, zz);
        const gx = (f(x + e, z) - f(x - e, z)) / (2 * e), gz = (f(x, z + e) - f(x, z - e)) / (2 * e);
        const g = Math.max(0.5, Math.hypot(gx, gz)), ux = gx / g, uz = gz / g;
        // walk up the slope to where the bed above meets the ground (the top of this block), or
        // to the end of the rock where the slope eases off
        let dist = 10;
        for (let d = 0.4; d <= 10; d += 0.4) if (f(x + ux * d, z + uz * d) >= y1 || !this.covers(x + ux * d, z + uz * d)) { dist = d; break; }
        P.push({ x, z, ux, uz, g, p: protrude + rng.float(-0.12, 0.12) + (j === 1 ? rng.float(-0.25, 0.35) : 0), dist });
      }
      // the face leans back towards the slope instead of standing plumb, so rows read as rock,
      // not as a staircase; some blocks leave a ledge, others run on into the row above
      const lean = rng.chance(0.45) ? rng.float(0.75, 0.95) : rng.float(0.2, 0.5);
      // blocks of one row are staggered: the beds break into pieces of different heights
      const dropB = rng.float(-0.3, 0.15) * thick, liftT = rng.float(-0.25, 0.3) * thick;
      const ch = clamp(thick * rng.float(0.07, 0.12), 0.15, 0.55);
      const front = (j: number, back: number) => [P[j].x + P[j].ux * (back - P[j].p), P[j].z + P[j].uz * (back - P[j].p)];
      const rear = (j: number) => [P[j].x + P[j].ux * (P[j].dist + dback), P[j].z + P[j].uz * (P[j].dist + dback)];

      const topJit = [rng.float(-0.3, 0.25), rng.float(-0.3, 0.25), rng.float(-0.3, 0.25)];
      const planeY = (lv: number, x: number, z: number) => lv + tilt(x, z) + (lv === y0 ? dropB : liftT);
      const ringAt = (frac: number, inset: number) => {
        const r: number[][] = [];
        for (let j = 0; j < 3; j++) {
          const set = Math.min(P[j].dist * 0.75, lean * P[j].dist) * frac + inset;
          const [fx, fz] = front(j, set);
          const yTop = planeY(y1, fx, fz) + topJit[j];
          // bottom: on the bed, and below the sheet where the front stands proud of it
          const yBot = Math.min(planeY(y0, fx, fz), hAt(fx, fz) - 0.35);
          r.push([fx, frac >= 1 ? yTop - (inset > 0 ? 0 : ch) : lerp(yBot, yTop - ch, frac), fz]);
        }
        // the back stays under the ground, also at the top edge of the rock where the bed above
        // never reaches the slope
        const yBack = (j: number, fr: number) => {
          const [bx, bz] = rear(j), g = hAt(bx, bz);
          return lerp(Math.min(planeY(y0, bx, bz) - 0.5, g - 0.8), Math.min(planeY(y1, bx, bz) + topJit[j] * 0.5, g - 0.2), fr);
        };
        const [b2x, b2z] = rear(2), [b0x, b0z] = rear(0);
        r.push([b2x, yBack(2, Math.min(1, frac)), b2z], [b0x, yBack(0, Math.min(1, frac)), b0z]);
        return r;
      };
      const rings = [ringAt(0, 0)];
      if (thick > 4.2) rings.push(ringAt(0.5, rng.float(-0.25, 0.15)));
      rings.push(ringAt(1, 0), ringAt(1, ch));
      // ringAt(1, ch) is the top ring: set back by the chamfer and up on the bed
      const top = rings[rings.length - 1];
      for (let j = 0; j < 3; j++) { const [fx, fz] = [top[j][0], top[j][2]]; top[j][1] = planeY(y1, fx, fz) + topJit[j]; }
      const pts = new Float32Array(rings.length * 5 * 3);
      let o = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const r of rings) for (const q of r) {
        pts[o++] = q[0]; pts[o++] = q[1]; pts[o++] = q[2];
        minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); minZ = Math.min(minZ, q[2]); maxZ = Math.max(maxZ, q[2]);
      }
      const tone = clamp(0.18 + 0.6 * hd + rng.float(-0.15, 0.15) + (rng.chance(0.08) ? 0.22 : 0) - (kind < 0.08 ? 0.12 : 0), 0, 1);
      const block: CliffBlock = { kind: 'skin', n: 5, rings: rings.length, pts, tone, layer: l, minX, maxX, minY, maxY, minZ, maxZ };
      this.blocks.push(block);
      // snow on the step: only where there is a real ledge, and not on the far ridges
      const ledge = P.reduce((a, q) => a + q.dist * (1 - lean) + q.p, 0) / 3;
      // windward and sun-facing faces hold less snow: a slow noise thins the caps
      const snowy = 0.5 + 0.5 * noise.noise(mx / 160 + 31, mz / 160);
      if (!outer && ledge > 1.1 && rng.next() < 0.3 + 0.6 * snowy) pillow(block, clamp(0.25 + ledge * 0.08, 0.3, 0.65) * rng.float(0.8, 1.1), () => rng.float(0.9, 1.08), capPos, capIdx);
    }
  }

  /** Is this point on rock-covered slope? */
  covers(x: number, z: number) {
    const i = Math.floor((x + this.ox) / this.cell), j = Math.floor((z + this.oz) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return false;
    return this.mask[j * this.n + i] === 1;
  }

  stats() {
    let cells = 0;
    for (let c = 0; c < this.mask.length; c++) cells += this.mask[c];
    return { blocks: this.blocks.length, area: cells * this.cell * this.cell, capTriangles: this.caps.indices.length / 3, timings: this.timings };
  }
}
