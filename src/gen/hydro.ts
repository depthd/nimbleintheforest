// Hydrology on the coarse grid: depression filling (Priority-Flood, Barnes et al. 2014)
// gives lakes and a drainage tree towards the outlets; flow accumulation gives rivers.
import { MinHeap } from './heap';

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const DD = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

export interface Flood {
  /** water surface where depressions are filled (flat lakes) */
  fill: Float32Array;
  /** downstream neighbour of every vertex, -1 at outlets */
  down: Int32Array;
  /** vertices in the order they were reached (outlets first) */
  order: Int32Array;
}

/**
 * Priority-Flood from the map border. Each vertex drains to the neighbour that reached it,
 * which routes water across lakes to their outlet.
 */
export function priorityFlood(H: Float32Array, n: number): Flood {
  const N = n * n;
  const fill = new Float32Array(N);
  const down = new Int32Array(N).fill(-1);
  const order = new Int32Array(N);
  const closed = new Uint8Array(N);
  const heap = new MinHeap(n * 8);
  let oi = 0;
  for (let i = 0; i < n; i++) {
    for (const v of [i, (n - 1) * n + i, i * n, i * n + n - 1]) {
      if (closed[v]) continue;
      closed[v] = 1;
      fill[v] = H[v];
      heap.push(H[v], v);
    }
  }
  // tiny tie-breaker so flats drain towards the outlet instead of sideways
  let seq = 0;
  while (heap.size > 0) {
    const c = heap.pop();
    order[oi++] = c;
    const cx = c % n, cy = (c / n) | 0;
    const fc = fill[c];
    for (let k = 0; k < 8; k++) {
      const x = cx + DX[k], y = cy + DY[k];
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const v = y * n + x;
      if (closed[v]) continue;
      closed[v] = 1;
      down[v] = c;
      const f = Math.max(H[v], fc);
      fill[v] = f;
      heap.push(f + (seq++ % 1024) * 1e-9, v);
    }
  }
  return { fill, down, order };
}

/**
 * Lakes that would be too big or too deep get a cut outlet instead (breaching): the outlet
 * path is lowered to a new, lower water level, which usually leaves a gorge through the sill.
 */
export function breachLakes(H: Float32Array, n: number, f: Flood, isSea: Uint8Array, maxCells: number, maxDepth: number, maxCut: number) {
  const N = n * n;
  const seen = new Uint8Array(N);
  const stack: number[] = [];
  let breached = 0;
  for (let v = 0; v < N; v++) {
    if (seen[v] || isSea[v] || f.fill[v] - H[v] < 0.35) continue;
    const L = f.fill[v];
    const members: number[] = [];
    stack.push(v);
    seen[v] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      members.push(c);
      const cx = c % n, cy = (c / n) | 0;
      for (let k = 0; k < 8; k++) {
        const x = cx + DX[k], y = cy + DY[k];
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const u = y * n + x;
        if (seen[u] || isSea[u] || Math.abs(f.fill[u] - L) > 0.01 || f.fill[u] - H[u] < 0.02) continue;
        seen[u] = 1;
        stack.push(u);
      }
    }
    const hs = members.map((c) => H[c]).sort((a, b) => a - b);
    const depth = L - hs[0];
    if (members.length <= maxCells && depth <= maxDepth) continue;
    let Ln = hs[Math.min(members.length, maxCells) - 1];
    Ln = Math.min(Ln, hs[0] + maxDepth);
    Ln = Math.max(Ln, L - maxCut);
    // walk from the deepest point to the outlet and on downstream, lowering the path
    let c = members.reduce((a, b) => (H[b] < H[a] ? b : a), members[0]);
    let cur = Ln - 0.15;
    for (let steps = 0; c >= 0 && steps < 700; steps++) {
      if (H[c] > cur) H[c] = cur;
      else if (H[c] < cur - 0.6 && f.fill[c] < Ln - 0.5) break;
      cur = Math.min(cur, H[c]) - 0.02;
      c = f.down[c];
    }
    breached++;
  }
  return breached;
}

/** Upstream area (weighted) draining through each vertex. */
export function accumulate(f: Flood, n: number, weight: Float32Array) {
  const acc = Float32Array.from(weight);
  for (let i = f.order.length - 1; i >= 0; i--) {
    const c = f.order[i];
    const d = f.down[c];
    if (d >= 0) acc[d] += acc[c];
  }
  return acc;
}

export interface RiverPoint {
  x: number; // coarse grid units
  y: number;
  level: number; // water surface, m
  width: number; // m
  acc: number;
}

export interface River {
  pts: RiverPoint[];
  /** where it ends: 'sea', 'lake' or 'river' (confluence) */
  into: string;
}

/**
 * River water levels, computed from the mouths upstream. A river can't climb faster than
 * `maxSlope` (unless the rock is hard, which makes rapids and falls), so where the land rises
 * quickly it cuts a gorge instead. The cut is limited to `maxCut` metres.
 */
export function riverLevels(
  f: Flood, n: number, cell: number, acc: Float32Array, isRiver: Uint8Array, lakeLevel: Float32Array,
  hardness: (i: number) => number, maxCut = 32,
) {
  const level = new Float32Array(n * n).fill(NaN);
  for (let oi = 0; oi < f.order.length; oi++) {
    const c = f.order[oi];
    if (!isRiver[c]) continue;
    const ground = f.fill[c];
    if (!Number.isNaN(lakeLevel[c])) {
      level[c] = lakeLevel[c];
      continue;
    }
    const d = f.down[c];
    const base = ground - 0.9;
    if (d < 0 || Number.isNaN(level[d])) {
      level[c] = Math.max(0.15, base);
      continue;
    }
    const ld = level[d];
    const cx = c % n, cy = (c / n) | 0, dx = d % n, dy = (d / n) | 0;
    const dist = Math.hypot(cx - dx, cy - dy) * cell;
    const hard = hardness(c);
    const maxSlope = 0.025 + hard * hard * 0.6;
    let L = Math.min(base, ld + maxSlope * dist);
    L = Math.max(L, ground - maxCut, ld);
    level[c] = L;
  }
  return level;
}

/** Trace river polylines from their heads downstream. */
export function traceRivers(f: Flood, n: number, acc: Float32Array, isRiver: Uint8Array, level: Float32Array, widthOf: (a: number) => number, isLake: (i: number) => boolean, isSea: (i: number) => boolean): River[] {
  const N = n * n;
  const hasUp = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (isRiver[c] && f.down[c] >= 0 && isRiver[f.down[c]]) hasUp[f.down[c]] = 1;
  const done = new Uint8Array(N);
  const rivers: River[] = [];
  // heads first, then the rest (sorted by accumulation so big rivers are traced as one line)
  const heads: number[] = [];
  for (let c = 0; c < N; c++) if (isRiver[c] && !hasUp[c] && !isLake(c)) heads.push(c);
  let lastLevel = 0;
  const pt = (c: number): RiverPoint => {
    // the end point may be a lake, the sea or plain ground with no level of its own
    let L = level[c];
    if (Number.isNaN(L)) L = isSea(c) ? 0 : f.fill[c] - 0.9;
    L = Math.min(L, lastLevel);
    lastLevel = L;
    return { x: c % n, y: (c / n) | 0, level: L, width: widthOf(acc[c]), acc: acc[c] };
  };
  // longest/biggest first: trace from heads, stop at already traced vertices
  heads.sort((a, b) => acc[a] - acc[b]);
  const traceFrom = (start: number) => {
    const pts: RiverPoint[] = [];
    let c = start;
    lastLevel = Infinity;
    let into = 'edge';
    while (c >= 0) {
      if (isLake(c)) {
        pts.push(pt(c));
        into = 'lake';
        break;
      }
      if (isSea(c)) {
        pts.push(pt(c));
        into = 'sea';
        break;
      }
      if (done[c]) {
        pts.push(pt(c));
        into = 'river';
        break;
      }
      done[c] = 1;
      pts.push(pt(c));
      const d = f.down[c];
      if (d < 0 || !isRiver[d]) {
        if (d >= 0) {
          pts.push(pt(d));
          into = isSea(d) ? 'sea' : isLake(d) ? 'lake' : 'edge';
        }
        break;
      }
      c = d;
    }
    if (pts.length >= 2) rivers.push({ pts, into });
  };
  // trace the main stems first: sort heads by the accumulation at their mouth is costly; use
  // descending order of the head's downstream reach length approximated by tracing biggest heads last
  for (let i = heads.length - 1; i >= 0; i--) traceFrom(heads[i]);
  // outlets of lakes start rivers too
  for (let c = 0; c < N; c++) {
    if (!isRiver[c] || done[c] || isLake(c)) continue;
    const u = c;
    // only start where the upstream vertex is a lake
    let fromLake = false;
    const cx = c % n, cy = (c / n) | 0;
    for (let k = 0; k < 8 && !fromLake; k++) {
      const x = cx + DX[k], y = cy + DY[k];
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const v = y * n + x;
      if (f.down[v] === c && isLake(v)) fromLake = true;
    }
    if (fromLake) traceFrom(u);
  }
  return rivers;
}

/** Chaikin smoothing of a river polyline (keeps the end points). */
export function smoothRiver(pts: RiverPoint[], iterations = 3): RiverPoint[] {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    if (p.length < 3) return p;
    const out: RiverPoint[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      const mix = (t: number): RiverPoint => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        level: a.level + (b.level - a.level) * t,
        width: a.width + (b.width - a.width) * t,
        acc: a.acc + (b.acc - a.acc) * t,
      });
      out.push(mix(0.25), mix(0.75));
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  // keep levels monotone downstream after smoothing
  for (let i = 1; i < p.length; i++) if (p[i].level > p[i - 1].level) p[i].level = p[i - 1].level;
  return p;
}

export { DX, DY, DD };
