// Caves: separate places behind an opening in the rock.
//
// The sheet holds one height per point, so it cannot hold a tunnel. A cave is therefore its
// own location. Its mouth sits at the foot of a steep slope in the ordinary world and leads
// into a short dark throat; a few steps in, the game swaps the player into the interior,
// which is built far outside the map. Both share the same throat, so the swap hides in a
// short fade.
//
// The interior is the zero set of an "air field": tubes along passages and domed halls, each
// with an even floor, merged by a smooth union. Noise and bedding planes roughen the walls
// and the ceiling. Surface nets turn the field into a closed mesh, and the light is baked per
// vertex: ambient occlusion, daylight that reaches in through the mouth, and frost near it.
//
// Coordinates are local to the mouth: the opening at the origin, +z into the rock, y up.
// Pure data: no Three.js or Rapier here. world/caves.ts draws and collides the result.
import { Rng, clamp, lerp, smoothstep } from '../core/rng';

/** fine grid of the meshed field, metres */
export const CAVE_CELL = 0.75;
/** the enter and exit thresholds inside the throat (local z) */
export const ENTER_Z = 2.8;
export const EXIT_Z = 2.3;
/** the world throat ends in rock here; inside it goes on and bends after 9 m */
const PLUG_Z = 7;
const BED = 1.45; // bedding thickness of the cave rock
const TAU = Math.PI * 2;

// ---------- 3D gradient noise ----------

function gr(h: number, x: number, y: number, z: number) {
  const k = h & 15, u = k < 8 ? x : y, v = k < 4 ? y : k === 12 || k === 14 ? x : z;
  return ((k & 1) ? -u : u) + ((k & 2) ? -v : v);
}

/** Improved Perlin noise, roughly −1..1. */
export class Noise3 {
  private p = new Uint8Array(512);
  constructor(rand: () => number) {
    const q = new Uint8Array(256);
    for (let i = 0; i < 256; i++) q[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1)), t = q[i];
      q[i] = q[j];
      q[j] = t;
    }
    for (let i = 0; i < 512; i++) this.p[i] = q[i & 255];
  }
  noise(x: number, y: number, z: number) {
    const p = this.p;
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10), w = z * z * z * (z * (z * 6 - 15) + 10);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const x1 = x - 1, y1 = y - 1, z1 = z - 1;
    const a0 = gr(p[AA], x, y, z), a1 = gr(p[BA], x1, y, z), a2 = gr(p[AB], x, y1, z), a3 = gr(p[BB], x1, y1, z);
    const b0 = gr(p[AA + 1], x, y, z1), b1 = gr(p[BA + 1], x1, y, z1), b2 = gr(p[AB + 1], x, y1, z1), b3 = gr(p[BB + 1], x1, y1, z1);
    const c0 = a0 + u * (a1 - a0), c1 = a2 + u * (a3 - a2), c2 = b0 + u * (b1 - b0), c3 = b2 + u * (b3 - b2);
    const d0 = c0 + v * (c1 - c0), d1 = c2 + v * (c3 - c2);
    return d0 + w * (d1 - d0);
  }
}

// ---------- types ----------

export interface CaveHill {
  /** ground heights relative to the mouth floor on a regular grid in mouth coordinates */
  x0: number; z0: number; nx: number; nz: number; cell: number; h: Float32Array;
}

export interface CaveSpec {
  seed: number;
  /** the hillside around the mouth; a steep generic slope when missing */
  hill?: CaveHill;
}

export interface CaveMesh {
  positions: Float32Array;
  indices: Uint32Array;
  /** per vertex, 0..1: ambient occlusion, daylight from the mouth, frost, strata tone */
  ao: Float32Array;
  day: Float32Array;
  frost: Float32Array;
  tone: Float32Array;
}

export type CavePropKind = 'stalactite' | 'stalagmite' | 'column' | 'boulder' | 'pebble' | 'icicle' | 'icemite' | 'ice';

export interface CaveProp {
  kind: CavePropKind;
  /** triangles in cave coordinates, wound outwards */
  pos: Float32Array;
  idx: Uint32Array;
  /** points of a convex collider when the prop can stop you, else null */
  hull: Float32Array | null;
  ice: boolean;
  /** baked light at the prop */
  day: number;
  frost: number;
  x: number; y: number; z: number;
}

export interface CaveSpot { x: number; y: number; z: number; yaw: number; kind: 'camp' | 'cache' }

/** The walkable skeleton: from the mouth to every hall and dead end. */
export interface CaveNode { x: number; y: number; z: number; parent: number; kind: 'mouth' | 'bend' | 'hall' | 'end' }

interface Bounds { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

interface Tube extends Bounds {
  type: 0;
  ax: number; ay: number; az: number; bx: number; by: number; bz: number;
  wa: number; wb: number; ha: number; hb: number;
  dx: number; dz: number; len: number;
  rough: number; k: number;
}

/** a clear corridor along the route: rough walls never close the way */
interface Path extends Bounds {
  type: 2;
  ax: number; az: number; ay: number; bx: number; bz: number; by: number;
}

interface Hall extends Bounds {
  type: 1;
  x: number; y: number; z: number; rx: number; rz: number; h: number;
  c: number; s: number;
  rough: number; k: number; rubble: number;
  /** ellipse angles where passages join: no rubble slope there */
  joins: number[];
  lake: boolean;
  end: boolean;
}

type Prim = Tube | Hall | Path;

interface Head { x: number; y: number; z: number; dir: number; w: number; h: number; node: number; prim: number }

interface Grid { nx: number; ny: number; nz: number; ox: number; oy: number; oz: number; v: Float32Array }

/** 0..1 from integer coordinates */
function hash3(x: number, y: number, z: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smin = (a: number, b: number, k: number) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
};

function ellipse2(a: number, b: number, ra: number, rb: number) {
  const pa = a / ra, pb = b / rb, qa = a / (ra * ra), qb = b / (rb * rb);
  const k0 = Math.sqrt(pa * pa + pb * pb), k1 = Math.sqrt(qa * qa + qb * qb);
  return k1 < 1e-6 ? -Math.min(ra, rb) : (k0 * (k0 - 1)) / k1;
}

function ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  const px = x / rx, py = y / ry, pz = z / rz, qx = px / rx, qy = py / ry, qz = pz / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz), k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  return k1 < 1e-6 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

function sdBox(x: number, y: number, z: number, hx: number, hy: number, hz: number) {
  const qx = Math.abs(x) - hx, qy = Math.abs(y) - hy, qz = Math.abs(z) - hz;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
}

/** distance from (x, z) to the segment a-b in plan */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

// ---------- the cave ----------

export class CaveBuild {
  readonly nodes: CaveNode[] = [];
  readonly spots: CaveSpot[] = [];
  readonly timings: Record<string, number> = {};
  /** how far from the mouth frost and ice reach, metres along the cave */
  readonly iceDepth: number;
  private prims: Prim[] = [];
  private lookupGrid = new Map<number, number[]>();
  private noise: Noise3;
  private rng: Rng;
  private interiorMesh: CaveMesh | null = null;
  private mouthMesh: CaveMesh | null = null;
  private propList: CaveProp[] | null = null;
  private mouthProps: CaveProp[] | null = null;
  private grid: Grid | null = null;
  private dist: Uint16Array | null = null;
  private wall = 0;
  private floorN = 0;
  private big = 0;
  /** walkable route in plan, for keeping props out of the way: ax, az, bx, bz, floor at a, floor at b */
  private route: [number, number, number, number, number, number][] = [];
  private butTop: number;

  constructor(readonly spec: CaveSpec) {
    this.rng = new Rng(spec.seed * 7177 + 3);
    this.noise = new Noise3(() => this.rng.next());
    this.iceDepth = this.rng.float(14, 30);
    this.butTop = this.rng.float(4.4, 6.0);
    const t0 = performance.now();
    // about one layout in a hundred finds room for only two halls: lay it out again
    for (let attempt = 0; attempt < 4; attempt++) {
      this.prims = [];
      this.route = [];
      this.nodes.length = 0;
      this.spots.length = 0;
      this.layout();
      if (this.prims.filter((p) => p.type === 1).length >= 3) break;
    }
    // the way through stays open: about 1.45 m wide and 2.3 m high over every route segment
    for (const [ax, az, bx, bz, ay, by] of this.route) {
      this.prims.push({ type: 2, ax, az, ay, bx, bz, by, minX: Math.min(ax, bx) - 1.2, maxX: Math.max(ax, bx) + 1.2, minY: Math.min(ay, by) - 0.2,
        maxY: Math.max(ay, by) + 2.6, minZ: Math.min(az, bz) - 1.2, maxZ: Math.max(az, bz) + 1.2 });
    }
    for (let i = 0; i < this.prims.length; i++) this.index(i);
    this.timings.layout = Math.round(performance.now() - t0);
  }

  get halls() {
    return this.prims.filter((p): p is Hall => p.type === 1).map((h) => ({ x: h.x, y: h.y, z: h.z, rx: h.rx, rz: h.rz, h: h.h, lake: h.lake, end: h.end }));
  }

  // ---------- layout ----------

  private layout() {
    const rng = this.rng;
    // the throat: the same in the world and inside, straight for the first 9 m
    this.addTube(0, 0, -2.5, 0, -0.3, 9, 2.25, 2.05, 3.35, 3.05, 0.75);
    const mouth = this.addNode(0, 0, ENTER_Z + 0.4, -1, 'mouth');
    const n0 = this.addNode(0, -0.3, 9, mouth, 'bend');
    let head: Head | null = { x: 0, y: -0.3, z: 9, dir: 0, w: 2.05, h: 3.05, node: n0, prim: 0 };
    // a bend first, so daylight dies before the first hall
    const side = rng.chance(0.5) ? 1 : -1;
    head = this.passage(head, [[side * 0.6, side * 1.05], [-0.4, 0.4]], { len: [8, 12], drop: [0.5, 1.6], w: [1.8, 2.4], h: [2.9, 3.6] }, [0]);
    if (!head) head = this.passage({ x: 0, y: -0.3, z: 9, dir: 0, w: 2.05, h: 3.05, node: n0, prim: 0 }, [[-0.3, 0.3]], { len: [8, 12], drop: [0.5, 1.2], w: [1.8, 2.2], h: [2.9, 3.4] }, [0])!;
    const a = this.hall(head!, [8, 12], [7, 10], [6, 9], false);
    if (a < 0) return;
    // the way on: a bigger hall deeper down
    const main = this.passage(this.exitFrom(a, Math.PI / 2 + rng.float(-0.8, 0.8)), [[-0.5, 0.5], [-0.5, 0.5], [-0.4, 0.4]].slice(0, rng.int(2, 3)),
      { len: [8, 13], drop: [0.6, 2.4], w: [1.6, 2.3], h: [2.8, 3.8] }, [a]);
    let b = -1;
    if (main) b = this.hall(main, [10, 15], [8, 12], [8, 13], false);
    // a side passage to a small dead-end chamber
    const sideAngle = -Math.PI / 2 + (rng.chance(0.5) ? 1 : -1) * rng.float(1.3, 2.0);
    const sp = this.passage(this.exitFrom(a, sideAngle), [[-0.6, 0.6], [-0.6, 0.6]].slice(0, rng.int(1, 2)), { len: [7, 11], drop: [-0.6, 1.2], w: [1.4, 2.0], h: [2.8, 3.3] }, [a]);
    if (sp) this.hall(sp, [3.2, 4.8], [3, 4.2], [3.4, 4.6], true);
    if (b >= 0) {
      // deeper still: a hall that may hold a frozen lake
      if (rng.chance(0.65)) {
        const p = this.passage(this.exitFrom(b, Math.PI / 2 + rng.float(-1, 1)), [[-0.5, 0.5], [-0.5, 0.5]], { len: [8, 12], drop: [0.5, 2], w: [1.6, 2.2], h: [2.8, 3.6] }, [b]);
        if (p) this.hall(p, [7, 11], [6, 9], [5, 9], false, rng.chance(0.65));
      }
      // a tall narrow fissure to a chamber
      if (rng.chance(0.45)) {
        const ang = (rng.chance(0.5) ? 0 : Math.PI) + rng.float(-0.5, 0.5);
        const f = this.passage(this.exitFrom(b, ang, 0.85, 1.25), [[-0.4, 0.4], [-0.4, 0.4]], { len: [6, 10], drop: [-0.5, 1], w: [1.05, 1.2], h: [4.2, 6], rough: 0.6 }, [b]);
        if (f) this.hall(f, [3, 4], [3, 4], [4, 6], true);
      }
    }
    // an old camp in the first or second hall, a cache in every dead end
    const camp = this.prims[b >= 0 && rng.chance(0.5) ? b : a] as Hall;
    this.spotIn(camp, 'camp');
    for (const p of this.prims) if (p.type === 1 && p.end) this.spotIn(p, 'cache');
  }

  private addNode(x: number, y: number, z: number, parent: number, kind: CaveNode['kind']) {
    this.nodes.push({ x, y, z, parent, kind });
    return this.nodes.length - 1;
  }

  private addTube(ax: number, ay: number, az: number, bx: number, by: number, bz: number, wa: number, wb: number, ha: number, hb: number, rough = 0.85): number {
    const len = Math.max(1e-3, Math.hypot(bx - ax, bz - az));
    const w = Math.max(wa, wb) + 1.2;
    const t: Tube = {
      type: 0, ax, ay, az, bx, by, bz, wa, wb, ha, hb, dx: (bx - ax) / len, dz: (bz - az) / len, len, rough, k: 1.1,
      minX: Math.min(ax, bx) - w, maxX: Math.max(ax, bx) + w, minY: Math.min(ay, by) - 0.6, maxY: Math.max(ay + ha, by + hb) + 1.2,
      minZ: Math.min(az, bz) - w, maxZ: Math.max(az, bz) + w,
    };
    this.prims.push(t);
    this.route.push([ax, az, bx, bz, ay, by]);
    return this.prims.length - 1;
  }

  /** a passage of a few legs from a head; retried with other turns if it would hit the cave */
  private passage(from: Head, turns: number[][], o: { len: number[]; drop: number[]; w: number[]; h: number[]; rough?: number }, ignore: number[]): Head | null {
    const rng = this.rng;
    for (let attempt = 0; attempt < 16; attempt++) {
      const mark = this.prims.length, markN = this.nodes.length, markR = this.route.length;
      let head = from, ok = true;
      for (let l = 0; l < turns.length; l++) {
        const spread = 1 + attempt * 0.08;
        const dir = head.dir + rng.float(turns[l][0], turns[l][1]) * spread;
        const len = rng.float(o.len[0], o.len[1]), drop = rng.float(o.drop[0], o.drop[1]);
        const w = rng.float(o.w[0], o.w[1]), h = rng.float(o.h[0], o.h[1]);
        const bx = head.x + Math.sin(dir) * len, bz = head.z + Math.cos(dir) * len, by = head.y - drop;
        if (!this.clearTube(head.x, head.y, head.z, bx, by, bz, Math.max(w, 0.62 * h), l === 0 ? ignore : [head.prim])) {
          ok = false;
          break;
        }
        const prim = this.addTube(head.x, head.y, head.z, bx, by, bz, head.w, w, head.h, h, o.rough ?? 0.85);
        const node = this.addNode(bx, by, bz, head.node, 'bend');
        head = { x: bx, y: by, z: bz, dir, w, h, node, prim };
      }
      if (ok) return head;
      this.prims.length = mark;
      this.nodes.length = markN;
      this.route.length = markR;
    }
    return null;
  }

  private hall(head: Head, rxR: number[], rzR: number[], hR: number[], end: boolean, lake = false): number {
    const rng = this.rng;
    for (let attempt = 0; attempt < 10; attempt++) {
      const shrink = 1 - attempt * 0.06;
      const rx = rng.float(rxR[0], rxR[1]) * shrink, rz = rng.float(rzR[0], rzR[1]) * shrink, h = rng.float(hR[0], hR[1]);
      const cx = head.x + Math.sin(head.dir) * rz * 0.82, cz = head.z + Math.cos(head.dir) * rz * 0.82;
      const c = Math.cos(head.dir), s = Math.sin(head.dir);
      const H: Hall = {
        type: 1, x: cx, y: head.y, z: cz, rx, rz, h, c, s, rough: 1.2, k: 1.6, rubble: lake ? 0.25 : rng.float(0.6, 1.5), joins: [-Math.PI / 2], lake, end,
        minX: cx - Math.max(rx, rz) - 1.5, maxX: cx + Math.max(rx, rz) + 1.5, minY: head.y - 0.6, maxY: head.y + h * 1.1 + 1.5,
        minZ: cz - Math.max(rx, rz) - 1.5, maxZ: cz + Math.max(rx, rz) + 1.5,
      };
      if (!this.clearHall(H, [head.prim])) continue;
      this.prims.push(H);
      const i = this.prims.length - 1;
      this.addNode(cx, head.y, cz, head.node, end ? 'end' : 'hall');
      // the route crosses the hall from the entry to its centre
      this.route.push([head.x, head.z, cx, cz, head.y, head.y]);
      return i;
    }
    return -1;
  }

  /** start of a passage leaving a hall at an angle of its ellipse */
  private exitFrom(hi: number, angle: number, w = 2.05, h = 3.1): Head {
    const H = this.prims[hi] as Hall;
    const ex = Math.cos(angle), ez = Math.sin(angle);
    const lx = H.rx * 0.8 * ex, lz = H.rz * 0.8 * ez;
    const x = H.x + lx * H.c + lz * H.s, z = H.z - lx * H.s + lz * H.c;
    const gx = ex / H.rx, gz = ez / H.rz;
    const dir = Math.atan2(gx * H.c + gz * H.s, -gx * H.s + gz * H.c);
    H.joins.push(angle);
    this.route.push([H.x, H.z, x, z, H.y, H.y]);
    const hallNode = this.nodes.findIndex((n) => Math.abs(n.x - H.x) < 1e-6 && Math.abs(n.z - H.z) < 1e-6);
    // the way out of the hall goes through the exit, not straight at the next bend
    const node = this.addNode(x, H.y, z, hallNode, 'bend');
    return { x, y: H.y, z, dir, w, h, node, prim: hi };
  }

  private inBounds(x: number, y: number, z: number) {
    return Math.abs(x) < 80 && z > -30 && z < 120 && y > -45 && y < 40 && !(z < 7 && Math.abs(x) < 17);
  }

  /** base distance of a primitive's air (no noise), negative inside */
  private baseDist(p: Prim, x: number, y: number, z: number) {
    return p.type === 0 ? tubeDist(p, x, y, z, 0, 0) : p.type === 1 ? hallDist(p, x, y, z, 0, 0, 0) : pathDist(p, x, y, z);
  }

  private clearTube(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, ignore: number[]) {
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
    for (let q = 1; q <= n; q++) {
      const t = q / n, x = lerp(ax, bx, t), y = lerp(ay, by, t) + 1.4, z = lerp(az, bz, t);
      if (!this.inBounds(x, y, z)) return false;
      for (let i = 0; i < this.prims.length; i++) {
        if (ignore.includes(i)) continue;
        if (this.baseDist(this.prims[i], x, y, z) < r + 2.4) return false;
      }
    }
    return true;
  }

  private clearHall(H: Hall, ignore: number[]) {
    const pts: number[][] = [[H.x, H.y + H.h * 0.3, H.z]];
    for (let q = 0; q < 10; q++) {
      const a = (q / 10) * TAU, lx = Math.cos(a) * H.rx * 0.9, lz = Math.sin(a) * H.rz * 0.9;
      pts.push([H.x + lx * H.c + lz * H.s, H.y + H.h * 0.3, H.z - lx * H.s + lz * H.c]);
    }
    pts.push([H.x, H.y + H.h, H.z]);
    for (const [x, y, z] of pts) {
      if (!this.inBounds(x, y, z)) return false;
      for (let i = 0; i < this.prims.length; i++) {
        if (ignore.includes(i)) continue;
        if (this.baseDist(this.prims[i], x, y, z) < 2.6) return false;
      }
    }
    // and the other way round: nothing already built may come close to the new hall
    for (let i = 0; i < this.prims.length; i++) {
      if (ignore.includes(i)) continue;
      const p = this.prims[i];
      if (p.type === 2) continue; // corridors are made after the layout
      const samples = p.type === 0 ? [0, 0.25, 0.5, 0.75, 1].map((t) => [lerp(p.ax, p.bx, t), lerp(p.ay, p.by, t) + 1.4, lerp(p.az, p.bz, t), Math.max(p.wa, 0.62 * p.ha)])
        : [[p.x, p.y + p.h * 0.3, p.z, Math.max(p.rx, p.rz)]];
      for (const [x, y, z, r] of samples) if (hallDist(H, x, y, z, 0, 0, 0) < r + 2.6) return false;
    }
    return true;
  }

  /** a flat spot near the wall of a hall, facing its middle */
  private spotIn(H: Hall, kind: CaveSpot['kind']) {
    const rng = this.rng;
    for (let k = 0; k < 40; k++) {
      const a = rng.float(0, TAU);
      if (H.joins.some((j) => Math.abs(Math.atan2(Math.sin(a - j), Math.cos(a - j))) < 0.6)) continue;
      const r = kind === 'cache' ? 0.42 : 0.5;
      const lx = Math.cos(a) * H.rx * r, lz = Math.sin(a) * H.rz * r;
      const x = H.x + lx * H.c + lz * H.s, z = H.z - lx * H.s + lz * H.c;
      if (this.nearRoute(x, z, H.y) < 1.8) continue;
      this.spots.push({ x, y: H.y, z, yaw: Math.atan2(H.x - x, H.z - z), kind });
      return;
    }
  }

  private nearRoute(x: number, z: number, y: number) {
    let d = Infinity;
    for (const [ax, az, bx, bz, ya, yb] of this.route) if (Math.abs((ya + yb) / 2 - y) < 6) d = Math.min(d, segDist(x, z, ax, az, bx, bz));
    return d;
  }

  // ---------- field ----------

  private key(ix: number, iy: number, iz: number) {
    return ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
  }

  private index(i: number) {
    const p = this.prims[i], m = 3.2, s = 8;
    for (let ix = Math.floor((p.minX - m) / s); ix <= Math.floor((p.maxX + m) / s); ix++)
      for (let iy = Math.floor((p.minY - m) / s); iy <= Math.floor((p.maxY + m) / s); iy++)
        for (let iz = Math.floor((p.minZ - m) / s); iz <= Math.floor((p.maxZ + m) / s); iz++) {
          const k = this.key(ix, iy, iz);
          const l = this.lookupGrid.get(k);
          if (l) l.push(i); else this.lookupGrid.set(k, [i]);
        }
  }

  private rough(x: number, y: number, z: number) {
    const n = this.noise;
    const wx = x + 1.4 * n.noise(x * 0.09 + 3.1, y * 0.09, z * 0.09 - 1.3);
    const wz = z + 1.4 * n.noise(x * 0.09 - 7.7, y * 0.09 + 2.2, z * 0.09);
    const big = n.noise(wx / 5.5, y / 4.2, wz / 5.5);
    const mid = n.noise(wx / 2.1 + 17.1, y / 1.6 - 3.3, wz / 2.1 + 8.8);
    const fine = n.noise(x / 0.8 - 4.4, y / 0.8 + 9.1, z / 0.8 - 1.7);
    this.big = big;
    this.wall = 0.72 * big + 0.3 * mid + 0.11 * fine + 0.42 * this.bed(x, y, z) - 0.2;
    this.floorN = 0.1 * n.noise(x / 2.6, 7.7, z / 2.6) + 0.045 * n.noise(x / 1.1, 3.3, z / 1.1);
  }

  /** 0 in soft beds, 1 in hard ones: hard beds stand out of the walls as ribs */
  bed(x: number, y: number, z: number) {
    const ph = y / BED + 0.5 * this.noise.noise(x / 17, 2.5, z / 17);
    return smoothstep(0.42, 0.58, 0.5 + 0.5 * Math.sin(ph * TAU));
  }

  private caveAir(x: number, y: number, z: number) {
    const l = this.lookupGrid.get(this.key(Math.floor(x / 8), Math.floor(y / 8), Math.floor(z / 8)));
    let f = 1e3;
    if (l) for (const i of l) {
      const p = this.prims[i];
      if (p.type === 2) continue;
      f = smin(f, p.type === 0 ? tubeDist(p, x, y, z, this.wall, this.floorN) : hallDist(p, x, y, z, this.wall, this.floorN, this.big), p.k);
    }
    if (l) for (const i of l) {
      const p = this.prims[i];
      if (p.type === 2) f = smin(f, pathDist(p, x, y, z), 0.35);
    }
    return f;
  }

  /** the hillside around the mouth, relative to the mouth floor */
  hillAt(x: number, z: number) {
    const H = this.spec.hill;
    if (!H) return Math.max(0, z) * 1.25; // a 51° slope
    const fx = clamp((x - H.x0) / H.cell, 0, H.nx - 1.001), fz = clamp((z - H.z0) / H.cell, 0, H.nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * H.nx + i;
    return lerp(lerp(H.h[k], H.h[k + 1], u), lerp(H.h[k + H.nx], H.h[k + H.nx + 1], u), v);
  }

  /** The rock patch over the hillside stands a little proud of the sheet where the sheet under
   * it was cut for the throat, and sinks under the sheet at its edges and on the flat ground. */
  private proud(x: number, z: number) {
    const inside = smoothstep(10.6, 9.2, Math.abs(x)) * smoothstep(-0.2, 0.9, z) * smoothstep(14.6, 12.8, z);
    return lerp(-0.45, 0.22, inside);
  }

  /** rock mass of the mouth (hillside and the buttress around the opening), negative inside */
  private mass(x: number, y: number, z: number) {
    const n = this.noise;
    const mh = y - (this.hillAt(x, z) + this.proud(x, z));
    // a low outcrop around the opening: narrower upwards, a ragged top, cracked into blocks
    const yy = Math.max(0, y);
    const zf = -0.4 + 0.3 * yy + 0.012 * x * x + 0.45 * n.noise(x / 2.6, y / 2.6, 1.7);
    const top = this.butTop + 1.1 * n.noise(x / 3.2, 9.1, 0.5);
    const half = 6.3 - 0.6 * yy + 0.7 * n.noise(y / 2.5, 4.4, 2.2);
    let mb = Math.max(zf - z, y - top, Math.abs(x) - half);
    // vertical joints split the face into blocks
    const jx = x + 0.9 * n.noise(y / 3, z / 3, 6.1), jf = jx / 2.7 - Math.floor(jx / 2.7);
    mb += 0.45 * smoothstep(0.75, 0.95, Math.abs(jf - 0.5) * 2);
    return smin(mh, mb, 1.0) - this.wall * 0.6;
  }

  /** The interior field: negative in air. Outside the face there is only a small pocket of air,
   * enough for the opening; looking out, a bright plane covers it. */
  air(x: number, y: number, z: number) {
    this.rough(x, y, z);
    let f = this.caveAir(x, y, z);
    if (z < 5 && Math.abs(x) < 9 && y > -1.5 && y < 9) {
      // reaching well into the face, so that near the opening only the face itself cuts the air
      const out = Math.max(-this.mass(x, y, z), sdBox(x, y - 3.75, z - 0.75, 6, 3.75, 3.25));
      f = smin(f, out, 0.6);
    }
    return f;
  }

  /** The field of the mouth in the ordinary world: the open air outside the rock mass and the
   * throat, which ends in rock a few metres in. */
  mouthAir(x: number, y: number, z: number) {
    this.rough(x, y, z);
    let f = Math.max(this.caveAir(x, y, z), z - PLUG_Z + 0.4 * this.big);
    f = smin(f, -this.mass(x, y, z), 0.6);
    return f;
  }

  // ---------- meshing ----------

  /** Sample a field on the fine grid. A coarse pass finds the cells near the surface; the rest
   * is filled from the coarse values (only their sign matters there). */
  private sample(field: (x: number, y: number, z: number) => number, b: Bounds): Grid {
    const c = CAVE_CELL, C = 3; // coarse step in fine cells
    const ox = Math.floor(b.minX / (c * C)) * c * C, oy = Math.floor(b.minY / (c * C)) * c * C, oz = Math.floor(b.minZ / (c * C)) * c * C;
    const ncx = Math.ceil((b.maxX - ox) / (c * C)) + 1, ncy = Math.ceil((b.maxY - oy) / (c * C)) + 1, ncz = Math.ceil((b.maxZ - oz) / (c * C)) + 1;
    const nx = (ncx - 1) * C + 1, ny = (ncy - 1) * C + 1, nz = (ncz - 1) * C + 1;
    const coarse = new Float32Array(ncx * ncy * ncz);
    for (let k = 0; k < ncz; k++) for (let j = 0; j < ncy; j++) for (let i = 0; i < ncx; i++)
      coarse[i + ncx * (j + ncy * k)] = field(ox + i * c * C, oy + j * c * C, oz + k * c * C);
    const v = new Float32Array(nx * ny * nz);
    const done = new Uint8Array(nx * ny * nz);
    const THR = 2.7;
    for (let k = 0; k < ncz - 1; k++) for (let j = 0; j < ncy - 1; j++) for (let i = 0; i < ncx - 1; i++) {
      let lo = Infinity, hi = -Infinity;
      for (let q = 0; q < 8; q++) {
        const val = coarse[i + (q & 1) + ncx * (j + ((q >> 1) & 1) + ncy * (k + (q >> 2)))];
        lo = Math.min(lo, val);
        hi = Math.max(hi, val);
      }
      if (lo > THR || hi < -THR) continue;
      for (let kk = 0; kk <= C; kk++) for (let jj = 0; jj <= C; jj++) for (let ii = 0; ii <= C; ii++) {
        const fi = i * C + ii, fj = j * C + jj, fk = k * C + kk, o = fi + nx * (fj + ny * fk);
        if (done[o]) continue;
        done[o] = 1;
        v[o] = field(ox + fi * c, oy + fj * c, oz + fk * c);
      }
    }
    // far from the surface only the sign matters (and the depth, for occlusion): interpolate
    for (let k = 0; k < ncz - 1; k++) for (let j = 0; j < ncy - 1; j++) for (let i = 0; i < ncx - 1; i++) {
      const c000 = coarse[i + ncx * (j + ncy * k)], c100 = coarse[i + 1 + ncx * (j + ncy * k)];
      const c010 = coarse[i + ncx * (j + 1 + ncy * k)], c110 = coarse[i + 1 + ncx * (j + 1 + ncy * k)];
      const c001 = coarse[i + ncx * (j + ncy * (k + 1))], c101 = coarse[i + 1 + ncx * (j + ncy * (k + 1))];
      const c011 = coarse[i + ncx * (j + 1 + ncy * (k + 1))], c111 = coarse[i + 1 + ncx * (j + 1 + ncy * (k + 1))];
      for (let kk = 0; kk <= C; kk++) {
        const t = kk / C;
        for (let jj = 0; jj <= C; jj++) {
          const w = jj / C;
          const a0 = lerp(c000, c010, w), a1 = lerp(c100, c110, w), b0 = lerp(c001, c011, w), b1 = lerp(c101, c111, w);
          const r0 = i * C + nx * (j * C + jj + ny * (k * C + kk));
          for (let ii = 0; ii <= C; ii++) {
            const o = r0 + ii;
            if (done[o]) continue;
            const u = ii / C;
            v[o] = lerp(lerp(a0, a1, u), lerp(b0, b1, u), t);
          }
        }
      }
    }
    return { nx, ny, nz, ox, oy, oz, v };
  }

  /** trilinear sample of a grid; rock outside it */
  private at(G: Grid, x: number, y: number, z: number) {
    if (!G.v.length) return 1;
    const c = CAVE_CELL;
    const fx = (x - G.ox) / c, fy = (y - G.oy) / c, fz = (z - G.oz) / c;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= G.nx - 1 || fy >= G.ny - 1 || fz >= G.nz - 1) return 1;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), u = fx - i, w = fy - j, t = fz - k;
    const V = G.v, nx = G.nx, nxy = G.nx * G.ny, o = i + nx * j + nxy * k;
    return lerp(lerp(lerp(V[o], V[o + 1], u), lerp(V[o + nx], V[o + nx + 1], u), w), lerp(lerp(V[o + nxy], V[o + nxy + 1], u), lerp(V[o + nxy + nx], V[o + nxy + nx + 1], u), w), t);
  }

  /** geodesic distance through the air from the outside, in cells (65535: unreached) */
  private daylight(G: Grid, seed: (x: number, y: number, z: number) => boolean) {
    const { nx, ny, nz, v } = G, n = nx * ny * nz, c = CAVE_CELL;
    const d = new Uint16Array(n).fill(65535);
    let air = 0;
    for (let o = 0; o < n; o++) if (v[o] < 0.25) air++;
    const queue = new Int32Array(air + 1);
    let head = 0, tail = 0;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const o = i + nx * (j + ny * k);
      if (v[o] < 0 && seed(G.ox + i * c, G.oy + j * c, G.oz + k * c)) { d[o] = 0; queue[tail++] = o; }
    }
    const nxy = nx * ny;
    while (head < tail) {
      const o = queue[head++], dd = d[o] + 1;
      const i = o % nx, j = Math.floor(o / nx) % ny, k = Math.floor(o / nxy);
      const go = (q: number) => {
        if (v[q] < 0.25 && d[q] > dd) { d[q] = dd; queue[tail++] = q; }
      };
      if (i > 0) go(o - 1);
      if (i < nx - 1) go(o + 1);
      if (j > 0) go(o - nx);
      if (j < ny - 1) go(o + nx);
      if (k > 0) go(o - nxy);
      if (k < nz - 1) go(o + nxy);
    }
    return d;
  }

  private distAt(G: Grid, d: Uint16Array, x: number, y: number, z: number) {
    const c = CAVE_CELL;
    const i0 = Math.floor((x - G.ox) / c), j0 = Math.floor((y - G.oy) / c), k0 = Math.floor((z - G.oz) / c);
    let best = 65535;
    for (let dk = -1; dk <= 2; dk++) for (let dj = -1; dj <= 2; dj++) for (let di = -1; di <= 2; di++) {
      const i = i0 + di, j = j0 + dj, k = k0 + dk;
      if (i < 0 || j < 0 || k < 0 || i >= G.nx || j >= G.ny || k >= G.nz) continue;
      best = Math.min(best, d[i + G.nx * (j + G.ny * k)]);
    }
    return best >= 65535 ? Infinity : best * c * 0.8;
  }

  private meshGrid(G: Grid, d: Uint16Array, outdoor: boolean): CaveMesh {
    const { pos, idx } = surfaceNets(G);
    const nv = pos.length / 3;
    const ao = new Float32Array(nv), day = new Float32Array(nv), frost = new Float32Array(nv), tone = new Float32Array(nv);
    const e = CAVE_CELL * 0.6;
    for (let q = 0; q < nv; q++) {
      let x = pos[q * 3], y = pos[q * 3 + 1], z = pos[q * 3 + 2];
      let nx = this.at(G, x - e, y, z) - this.at(G, x + e, y, z);
      let ny = this.at(G, x, y - e, z) - this.at(G, x, y + e, z);
      let nz = this.at(G, x, y, z - e) - this.at(G, x, y, z + e);
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      // facets: every vertex moves a little along the normal, by a hash of its grid cell
      const hx = Math.floor((x - G.ox) / CAVE_CELL), hy = Math.floor((y - G.oy) / CAVE_CELL), hz = Math.floor((z - G.oz) / CAVE_CELL);
      const gx = hx + Math.round(G.ox / CAVE_CELL), gy = hy + Math.round(G.oy / CAVE_CELL), gz = hz + Math.round(G.oz / CAVE_CELL);
      const jit = (hash3(gx, gy, gz) - 0.5) * 0.32 * CAVE_CELL * smoothstep(0.85, 0.55, ny);
      x += nx * jit; y += ny * jit; z += nz * jit;
      pos[q * 3] = x; pos[q * 3 + 1] = y; pos[q * 3 + 2] = z;
      // occlusion: how much air there is along the normal at a few distances
      let open = 0, wsum = 0;
      for (const [s, w] of [[0.45, 1], [1.1, 1], [2.4, 0.8], [4.5, 0.6]]) {
        open += w * clamp(-this.at(G, x + nx * s, y + ny * s, z + nz * s) / s, 0, 1);
        wsum += w;
      }
      ao[q] = clamp(open / wsum, 0, 1);
      const dist = this.distAt(G, d, x + nx * 0.3, y + ny * 0.3, z + nz * 0.3);
      if (outdoor) {
        // the world mouth: full daylight outside, fading fast into the throat
        day[q] = dist === Infinity ? 0 : Math.exp(-dist / 2.1);
        frost[q] = dist === Infinity ? 0 : smoothstep(5, 0.5, dist);
      } else {
        day[q] = dist === Infinity ? 0 : Math.exp(-dist / 3.6) * (0.55 + 0.45 * clamp(-nz, 0, 1));
        frost[q] = dist === Infinity ? 0 : smoothstep(this.iceDepth, 2, dist);
      }
      tone[q] = clamp(this.bed(x, y, z) * 0.8 + 0.1 + (hash3(gx + 7, gy - 3, gz + 11) - 0.5) * 0.35, 0, 1);
    }
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx), ao, day, frost, tone };
  }

  private bounds(): Bounds {
    const b = { minX: -9, maxX: 9, minY: -2, maxY: 8.5, minZ: -4, maxZ: 6 };
    for (const p of this.prims) {
      b.minX = Math.min(b.minX, p.minX); b.maxX = Math.max(b.maxX, p.maxX);
      b.minY = Math.min(b.minY, p.minY); b.maxY = Math.max(b.maxY, p.maxY);
      b.minZ = Math.min(b.minZ, p.minZ); b.maxZ = Math.max(b.maxZ, p.maxZ);
    }
    b.minX -= 2; b.maxX += 2; b.minY -= 2; b.maxY += 2; b.minZ -= 2; b.maxZ += 2;
    return b;
  }

  /** The whole interior: closed mesh, props and the light. Built once, on demand. */
  interior(): CaveMesh {
    if (this.interiorMesh) return this.interiorMesh;
    let t = performance.now();
    const G = (this.grid = this.sample((x, y, z) => this.air(x, y, z), this.bounds()));
    this.timings.field = Math.round(performance.now() - t);
    t = performance.now();
    // daylight comes from the pocket outside the face
    this.dist = this.daylight(G, (x, y, z) => z < -0.6 && Math.abs(x) < 5.5 && y > 0.2 && y < 6);
    this.interiorMesh = this.meshGrid(G, this.dist, false);
    this.timings.mesh = Math.round(performance.now() - t);
    return this.interiorMesh;
  }

  /** The mouth in the ordinary world: the rock patch over the hillside, the buttress and the
   * dark throat. Its edges sink under the sheet. */
  mouth(): CaveMesh {
    if (this.mouthMesh) return this.mouthMesh;
    const t = performance.now();
    let hmax = 8;
    for (let x = -11; x <= 11; x += 2) for (let z = -5; z <= 15; z += 2) hmax = Math.max(hmax, this.hillAt(x, z) + 1);
    const G = this.sample((x, y, z) => this.mouthAir(x, y, z), { minX: -11.5, maxX: 11.5, minY: -2.5, maxY: hmax + 2, minZ: -5.5, maxZ: 15.5 });
    const d = this.daylight(G, (x, y, z) => {
      if (z < -1.5) return true;
      this.rough(x, y, z);
      return -this.mass(x, y, z) < -0.25;
    });
    this.mouthMesh = this.meshGrid(G, d, true);
    this.timings.mouth = Math.round(performance.now() - t);
    return this.mouthMesh;
  }

  // ---------- floor and ceiling ----------

  /** the floor under a point inside the cave (analytic field), or NaN */
  floorAt(x: number, z: number, yFrom: number) {
    let y = yFrom;
    if (this.air(x, y, z) > 0) return NaN;
    for (let s = 0; s < 60; s++) {
      const y2 = y - 0.2;
      if (this.air(x, y2, z) > 0) {
        let lo = y2, hi = y;
        for (let q = 0; q < 6; q++) {
          const m = (lo + hi) / 2;
          if (this.air(x, m, z) > 0) lo = m; else hi = m;
        }
        return (lo + hi) / 2;
      }
      y = y2;
    }
    return NaN;
  }

  ceilingAt(x: number, z: number, yFrom: number) {
    let y = yFrom;
    if (this.air(x, y, z) > 0) return NaN;
    for (let s = 0; s < 100; s++) {
      const y2 = y + 0.2;
      if (this.air(x, y2, z) > 0) {
        let lo = y, hi = y2;
        for (let q = 0; q < 6; q++) {
          const m = (lo + hi) / 2;
          if (this.air(x, m, z) > 0) hi = m; else lo = m;
        }
        return (lo + hi) / 2;
      }
      y = y2;
    }
    return NaN;
  }

  // ---------- props ----------

  /** Icicles on the lip and the first metres of the throat: the same in the world and inside. */
  lipProps(): CaveProp[] {
    if (this.mouthProps) return this.mouthProps;
    const rng = new Rng(this.spec.seed * 31 + 7);
    const out: CaveProp[] = [];
    for (let z = -0.4; z < 4.2; z += 0.32) for (let x = -2.2; x <= 2.2; x += 0.3) {
      const px = x + rng.float(-0.12, 0.12), pz = z + rng.float(-0.12, 0.12);
      const chance = 0.75 * smoothstep(4.2, 0.4, pz);
      if (!rng.chance(chance)) continue;
      const fl = this.floorAt(px, pz, 1.4);
      const ce = this.ceilingAt(px, pz, 1.4);
      if (!Number.isFinite(ce) || ce > 5) continue;
      const room = ce - (Number.isFinite(fl) ? fl : 0);
      const L = Math.min(room - 2.05, rng.float(0.12, 0.35) + 0.75 * Math.pow(rng.next(), 2.2) * smoothstep(4, 0, pz));
      if (L < 0.08) continue;
      out.push(cone('icicle', px, ce + 0.12, pz, 0.018 + L * 0.07 + rng.float(0, 0.02), L + 0.12, -1, 6, rng, true, null, 1, 1));
    }
    this.mouthProps = out;
    return out;
  }

  /** formations, breakdown and ice of the interior; needs interior() */
  props(): CaveProp[] {
    if (this.propList) return this.propList;
    this.interior();
    const t = performance.now();
    const G = this.grid!, D = this.dist!;
    const rng = new Rng(this.spec.seed * 131 + 17);
    const out: CaveProp[] = [...this.lipProps()];
    const light = (p: CaveProp) => {
      const d = this.distAt(G, D, p.x, p.y + 0.3, p.z);
      p.day = d === Infinity ? 0 : Math.exp(-d / 4.2);
      p.frost = d === Infinity ? 0 : smoothstep(this.iceDepth, 2, d);
      return p;
    };
    const iced = (x: number, y: number, z: number) => {
      const d = this.distAt(G, D, x, y, z);
      return d < this.iceDepth * 0.8;
    };
    for (const p of this.prims) {
      if (p.type !== 1) continue;
      const area = Math.PI * p.rx * p.rz;
      // stalactites, some with stalagmites under them, a few columns
      for (let q = 0, n = Math.round(area / 9); q < n; q++) {
        const a = rng.float(0, TAU), r = Math.sqrt(rng.next()) * 0.82;
        const lx = Math.cos(a) * p.rx * r, lz = Math.sin(a) * p.rz * r;
        const x = p.x + lx * p.c + lz * p.s, z = p.z - lx * p.s + lz * p.c;
        const fl = this.floorAt(x, z, p.y + 1.5);
        if (!Number.isFinite(fl)) continue;
        const ce = this.ceilingAt(x, z, fl + 0.6);
        if (!Number.isFinite(ce)) continue;
        const room = ce - fl;
        if (room < 2.6) continue;
        const route = this.nearRoute(x, z, fl), onRoute = route < 1.6;
        const ice = iced(x, fl + 1, z);
        const cluster = rng.int(1, 4);
        for (let m = 0; m < cluster; m++) {
          const cx = x + rng.float(-0.7, 0.7), cz = z + rng.float(-0.7, 0.7);
          const c2 = this.ceilingAt(cx, cz, fl + 0.6);
          if (!Number.isFinite(c2)) continue;
          let L = (0.2 + 2.2 * Math.pow(rng.next(), 2.6)) * Math.min(1, room / 6);
          if (onRoute) L = Math.min(L, c2 - fl - 2.2);
          if (L < 0.12) continue;
          out.push(light(cone(ice ? 'icicle' : 'stalactite', cx, c2 + 0.15, cz, (ice ? 0.03 : 0.06) + L * (ice ? 0.08 : 0.15), L + 0.15, -1, ice ? 6 : 7, rng, ice,
            L > c2 - fl - 2.3 ? 'hull' : null, 1, 1)));
        }
        if (rng.chance(room < 4.6 ? 0.3 : 0.4)) {
          // standing formations keep a clear way: 1.3 m plus their own width from the route
          const colR = rng.float(0.3, 0.75), H = 0.25 + 1.5 * Math.pow(rng.next(), 1.6), mR = 0.16 + H * 0.3;
          if (room < 4.6 && rng.chance(0.45)) {
            if (route > 1.3 + colR * 1.5) out.push(light(column(x, fl - 0.15, z, ce - fl + 0.3, colR, rng, ice)));
          } else if (route > 1.3 + mR * 1.15) {
            out.push(light(cone(ice ? 'icemite' : 'stalagmite', x, fl - 0.15, z, mR, H + 0.15, 1, 7, rng, ice, 'hull', 1, 1)));
          }
        }
      }
      // breakdown blocks against the walls
      for (let q = 0, n = Math.round(area / 22) + 2; q < n; q++) {
        const a = rng.float(0, TAU), r = rng.float(0.5, 0.86);
        const lx = Math.cos(a) * p.rx * r, lz = Math.sin(a) * p.rz * r;
        const x = p.x + lx * p.c + lz * p.s, z = p.z - lx * p.s + lz * p.c;
        const s = 0.35 + 1.6 * Math.pow(rng.next(), 1.8);
        // a block reaches 1.25 times its size from its middle
        if (this.nearRoute(x, z, p.y) < 1.4 + s * 1.3) continue;
        const fl = this.floorAt(x, z, p.y + 2.5);
        if (!Number.isFinite(fl)) continue;
        out.push(light(boulder(x, fl + s * 0.25, z, s, rng)));
      }
      // rubble on the floor
      for (let q = 0, n = Math.round(area / 3); q < n; q++) {
        const a = rng.float(0, TAU), r = Math.sqrt(rng.next()) * 0.85;
        const lx = Math.cos(a) * p.rx * r, lz = Math.sin(a) * p.rz * r;
        const x = p.x + lx * p.c + lz * p.s, z = p.z - lx * p.s + lz * p.c;
        const fl = this.floorAt(x, z, p.y + 2.5);
        if (!Number.isFinite(fl)) continue;
        out.push(light(pebble(x, fl, z, rng.float(0.06, 0.24), rng)));
      }
      if (p.lake) {
        const fl = this.floorAt(p.x, p.z, p.y + 1.5);
        if (Number.isFinite(fl)) out.push(light(iceSheet(this, p, fl, rng)));
      }
    }
    // a few small stalactites and pebbles along the passages
    for (const p of this.prims) {
      if (p.type !== 0 || (p.az < 9 && p.bz < 9)) continue;
      for (let q = 0, n = Math.round(p.len / 2.5); q < n; q++) {
        const t2 = rng.next(), side = rng.float(-1, 1);
        const x = lerp(p.ax, p.bx, t2) + p.dz * side * lerp(p.wa, p.wb, t2) * 0.6, z = lerp(p.az, p.bz, t2) - p.dx * side * lerp(p.wa, p.wb, t2) * 0.6;
        const fl = this.floorAt(x, z, lerp(p.ay, p.by, t2) + 1.2);
        if (!Number.isFinite(fl)) continue;
        if (rng.chance(0.5)) out.push(light(pebble(x, fl, z, rng.float(0.05, 0.18), rng)));
        const ce = this.ceilingAt(x, z, fl + 0.6);
        if (!Number.isFinite(ce) || ce - fl < 2.5) continue;
        const ice = iced(x, fl + 1, z);
        const L = Math.min(ce - fl - 2.2, 0.15 + 0.5 * Math.pow(rng.next(), 2));
        if (L > 0.1) out.push(light(cone(ice ? 'icicle' : 'stalactite', x, ce + 0.12, z, (ice ? 0.025 : 0.05) + L * 0.12, L + 0.12, -1, 6, rng, ice, null, 1, 1)));
      }
    }
    this.propList = out;
    this.timings.props = Math.round(performance.now() - t);
    // the field itself is no longer needed, only the depth along the cave (a few MB less per cave)
    this.grid = { ...G, v: new Float32Array(0) };
    return out;
  }

  /** metres along the cave from the mouth, at a point inside; needs interior() */
  depthAt(x: number, y: number, z: number) {
    if (!this.grid || !this.dist) return 0;
    const d = this.distAt(this.grid, this.dist, x, y, z);
    return d === Infinity ? 60 : d;
  }

  /** the box the interior occupies */
  get box(): Bounds {
    return this.bounds();
  }

  /** points of the walkable skeleton from the mouth to a node, at floor height */
  routeTo(node: number) {
    const path: CaveNode[] = [];
    for (let n = node; n >= 0; n = this.nodes[n].parent) path.unshift(this.nodes[n]);
    return path;
  }

  stats() {
    const m = this.interiorMesh, p = this.propList;
    return {
      halls: this.prims.filter((q) => q.type === 1).length,
      tubes: this.prims.filter((q) => q.type === 0).length,
      triangles: m ? m.indices.length / 3 : 0,
      props: p?.length ?? 0,
      propTriangles: p ? p.reduce((s, q) => s + q.idx.length / 3, 0) : 0,
      colliders: p ? p.filter((q) => q.hull).length : 0,
      spots: this.spots.length,
    };
  }
}

function tubeDist(t: Tube, x: number, y: number, z: number, wall: number, floorN: number) {
  let u = ((x - t.ax) * t.dx + (z - t.az) * t.dz) / t.len;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const hx = x - (t.ax + (t.bx - t.ax) * u), hz = z - (t.az + (t.bz - t.az) * u);
  const yf = t.ay + (t.by - t.ay) * u, w = t.wa + (t.wb - t.wa) * u, h = t.ha + (t.hb - t.ha) * u;
  const d = ellipse2(Math.sqrt(hx * hx + hz * hz), y - (yf + 0.42 * h), w, 0.62 * h) + wall * t.rough;
  return Math.max(d, yf + floorN - y);
}

function pathDist(p: Path, x: number, y: number, z: number) {
  const dx = p.bx - p.ax, dz = p.bz - p.az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((x - p.ax) * dx + (z - p.az) * dz) / l2, 0, 1) : 0;
  const yf = p.ay + (p.by - p.ay) * t;
  const plan = Math.hypot(x - p.ax - dx * t, z - p.az - dz * t);
  return Math.max(plan - 0.72, yf + 0.12 - y, y - (yf + 2.35));
}

function hallDist(H: Hall, x: number, y: number, z: number, wall: number, floorN: number, big: number) {
  const dx = x - H.x, dz = z - H.z;
  const lx = dx * H.c - dz * H.s, lz = dx * H.s + dz * H.c;
  const d = ellipsoid(lx, y - (H.y + 0.3 * H.h), lz, H.rx, 0.72 * H.h, H.rz) + wall * H.rough;
  const ex = lx / H.rx, ez = lz / H.rz, rho = Math.sqrt(ex * ex + ez * ez);
  let rub = 0;
  if (H.rubble > 0 && rho > 0.45) {
    const a = Math.atan2(ez, ex);
    let open = 1;
    for (const j of H.joins) {
      let da = Math.abs(a - j);
      if (da > Math.PI) da = TAU - da;
      open = Math.min(open, smoothstep(0.2, 0.55, da));
    }
    rub = H.rubble * smoothstep(0.5, 1.0, rho) * open * (0.65 + 0.45 * big);
  }
  return Math.max(d, H.y + floorN + rub - y);
}

// ---------- surface nets ----------

const CORNER = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

/** Naive surface nets: one vertex per cell the surface crosses, one quad per crossed edge,
 * facing the air (negative values). */
export function surfaceNets(G: { nx: number; ny: number; nz: number; ox: number; oy: number; oz: number; v: Float32Array }) {
  const { nx, ny, nz, v } = G, c = CAVE_CELL;
  const pos: number[] = [], idx: number[] = [];
  const nxy = nx * ny;
  const slices = [new Int32Array(nx * ny).fill(-1), new Int32Array(nx * ny).fill(-1)];
  const val = new Float64Array(8);
  const quad = (a: number, b: number, d: number, e: number, flip: boolean) => {
    if (a < 0 || b < 0 || d < 0 || e < 0) return;
    if (flip) { const t = b; b = e; e = t; }
    // split along the shorter diagonal
    const l1 = (pos[a * 3] - pos[d * 3]) ** 2 + (pos[a * 3 + 1] - pos[d * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[d * 3 + 2]) ** 2;
    const l2 = (pos[b * 3] - pos[e * 3]) ** 2 + (pos[b * 3 + 1] - pos[e * 3 + 1]) ** 2 + (pos[b * 3 + 2] - pos[e * 3 + 2]) ** 2;
    if (l1 <= l2) idx.push(a, b, d, a, d, e);
    else idx.push(a, b, e, b, d, e);
  };
  for (let k = 0; k < nz - 1; k++) {
    const cur = slices[k & 1], prev = slices[(k + 1) & 1];
    cur.fill(-1);
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const o = i + nx * j + nxy * k;
      let mask = 0;
      for (let q = 0; q < 8; q++) {
        const cq = CORNER[q];
        val[q] = v[o + cq[0] + nx * cq[1] + nxy * cq[2]];
        if (val[q] < 0) mask |= 1 << q;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (const [a, b] of EDGES) {
        const va = val[a], vb = val[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb), ca = CORNER[a], cb = CORNER[b];
        sx += ca[0] + (cb[0] - ca[0]) * t;
        sy += ca[1] + (cb[1] - ca[1]) * t;
        sz += ca[2] + (cb[2] - ca[2]) * t;
        cnt++;
      }
      cur[i + nx * j] = pos.length / 3;
      pos.push(G.ox + (i + sx / cnt) * c, G.oy + (j + sy / cnt) * c, G.oz + (k + sz / cnt) * c);
    }
    // quads around the crossed grid edges whose cells are all known now
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const o = i + nx * j + nxy * k;
      const v0 = v[o];
      // edge along z from (i, j, k) to (i, j, k + 1): cells (i-1..i, j-1..j, k)
      if (i > 0 && j > 0) {
        const v1 = v[o + nxy];
        if ((v0 < 0) !== (v1 < 0)) quad(cur[i - 1 + nx * (j - 1)], cur[i + nx * (j - 1)], cur[i + nx * j], cur[i - 1 + nx * j], v0 < 0);
      }
      if (k > 0) {
        // edge along x from (i, j, k): cells (i, j-1..j, k-1..k)
        if (j > 0) {
          const v1 = v[o + 1];
          if ((v0 < 0) !== (v1 < 0)) quad(prev[i + nx * (j - 1)], prev[i + nx * j], cur[i + nx * j], cur[i + nx * (j - 1)], v0 < 0);
        }
        // edge along y from (i, j, k): cells (i-1..i, j, k-1..k)
        if (i > 0) {
          const v1 = v[o + nx];
          if ((v0 < 0) !== (v1 < 0)) quad(prev[i - 1 + nx * j], cur[i - 1 + nx * j], cur[i + nx * j], prev[i + nx * j], v0 < 0);
        }
      }
    }
  }
  return { pos, idx };
}

// ---------- prop shapes ----------

function finish(kind: CavePropKind, pos: number[], idx: number[], hull: boolean, ice: boolean, x: number, y: number, z: number): CaveProp {
  return { kind, pos: new Float32Array(pos), idx: new Uint32Array(idx), hull: hull ? new Float32Array(pos) : null, ice, day: 0, frost: 0, x, y, z };
}

/** A faceted cone from a base on the rock to a tip; dir −1 hangs down, +1 stands up. */
function cone(kind: CavePropKind, x: number, y: number, z: number, r: number, len: number, dir: number, sides: number, rng: Rng, ice: boolean,
  hull: 'hull' | null, sx: number, sz: number): CaveProp {
  const pos: number[] = [], idx: number[] = [];
  const rings = len > 1 ? 4 : 3;
  const bend = rng.float(0, TAU), lean = rng.float(0, 0.08) * len;
  const rot = rng.float(0, TAU);
  for (let r0 = 0; r0 < rings; r0++) {
    const t = r0 / rings;
    const rr = r * Math.pow(1 - t, ice ? 1.25 : 0.9) * (r0 === 0 ? 1 : rng.float(0.85, 1.12));
    const cx = x + Math.cos(bend) * lean * t * t, cz = z + Math.sin(bend) * lean * t * t;
    for (let q = 0; q < sides; q++) {
      const a = rot + (q / sides) * TAU + rng.float(-0.15, 0.15);
      const k = rng.float(0.85, 1.12);
      pos.push(cx + Math.cos(a) * rr * k * sx, y + dir * len * t, cz + Math.sin(a) * rr * k * sz);
    }
  }
  pos.push(x + Math.cos(bend) * lean, y + dir * len, z + Math.sin(bend) * lean);
  const tip = rings * sides;
  for (let r0 = 0; r0 < rings - 1; r0++) for (let q = 0; q < sides; q++) {
    const a = r0 * sides + q, b = r0 * sides + ((q + 1) % sides), c = a + sides, d = b + sides;
    if (dir > 0) idx.push(a, d, b, a, c, d); else idx.push(a, b, d, a, d, c);
  }
  for (let q = 0; q < sides; q++) {
    const a = (rings - 1) * sides + q, b = (rings - 1) * sides + ((q + 1) % sides);
    if (dir > 0) idx.push(a, tip, b); else idx.push(a, b, tip);
  }
  return finish(kind, pos, idx, hull === 'hull', ice, x, y, z);
}

/** a column: floor to ceiling, thinner in the middle */
function column(x: number, y: number, z: number, h: number, r: number, rng: Rng, ice: boolean): CaveProp {
  const pos: number[] = [], idx: number[] = [], sides = 8, rings = 6;
  const rot = rng.float(0, TAU);
  for (let r0 = 0; r0 <= rings; r0++) {
    const t = r0 / rings;
    const rr = r * (1 - 0.55 * Math.sin(Math.PI * t)) * (1 + 0.4 * (Math.pow(1 - t, 6) + Math.pow(t, 6))) * rng.float(0.88, 1.1);
    for (let q = 0; q < sides; q++) {
      const a = rot + (q / sides) * TAU + rng.float(-0.12, 0.12);
      pos.push(x + Math.cos(a) * rr, y + h * t, z + Math.sin(a) * rr);
    }
  }
  for (let r0 = 0; r0 < rings; r0++) for (let q = 0; q < sides; q++) {
    const a = r0 * sides + q, b = r0 * sides + ((q + 1) % sides), c = a + sides, d = b + sides;
    idx.push(a, d, b, a, c, d);
  }
  return finish('column', pos, idx, true, ice, x, y, z);
}

const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / l, p[1] / l, p[2] / l];
  });
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  // one subdivision: 42 points, 80 faces
  const mid = new Map<string, number>();
  const m = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let i = mid.get(key);
    if (i === undefined) {
      const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2], l = Math.hypot(p[0], p[1], p[2]);
      v.push([p[0] / l, p[1] / l, p[2] / l]);
      i = v.length - 1;
      mid.set(key, i);
    }
    return i;
  };
  const faces: number[] = [];
  for (const [a, b, c] of f) {
    const ab = m(a, b), bc = m(b, c), ca = m(c, a);
    faces.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
  }
  return { v, faces };
})();

/** a breakdown block: a lumpy, faceted, flattened ball */
function boulder(x: number, y: number, z: number, s: number, rng: Rng): CaveProp {
  const pos: number[] = [];
  const sx = s * rng.float(0.8, 1.25), sy = s * rng.float(0.45, 0.75), sz = s * rng.float(0.8, 1.25), rot = rng.float(0, TAU);
  const c = Math.cos(rot), sn = Math.sin(rot);
  const bumps = ICO.v.map(() => rng.float(0.82, 1.12));
  ICO.v.forEach((p, i) => {
    const k = bumps[i] * (i < 12 ? 1.06 : 1);
    const lx = p[0] * sx * k, ly = p[1] * sy * k, lz = p[2] * sz * k;
    pos.push(x + lx * c + lz * sn, y + ly, z - lx * sn + lz * c);
  });
  // wound outwards: the icosahedron faces are counter-clockwise seen from outside
  return finish('boulder', pos, ICO.faces.slice(), s > 0.45, false, x, y, z);
}

/** small rubble without a collider */
function pebble(x: number, y: number, z: number, s: number, rng: Rng): CaveProp {
  const pos: number[] = [];
  const rot = rng.float(0, TAU), c = Math.cos(rot), sn = Math.sin(rot);
  const P = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const p of P) {
    const k = rng.float(0.7, 1.2), lx = p[0] * s * k * 1.2, ly = p[1] * s * k * 0.55, lz = p[2] * s * k;
    pos.push(x + lx * c + lz * sn, y + ly + s * 0.15, z - lx * sn + lz * c);
  }
  const idx = [0, 2, 4, 4, 2, 1, 1, 2, 5, 5, 2, 0, 4, 3, 0, 1, 3, 4, 5, 3, 1, 0, 3, 5];
  return finish('pebble', pos, idx, false, false, x, y, z);
}

/** a frozen pool in the flat middle of a hall */
function iceSheet(cave: CaveBuild, H: { x: number; z: number; rx: number; rz: number; c: number; s: number }, fl: number, rng: Rng): CaveProp {
  const pos: number[] = [H.x, fl + 0.03, H.z], idx: number[] = [];
  const n = 28, phase = rng.float(0, TAU);
  for (let q = 0; q < n; q++) {
    const a = (q / n) * TAU;
    let r = 0.5 + 0.12 * Math.sin(a * 3 + phase) + 0.06 * Math.sin(a * 5 - phase * 2);
    // shrink until the floor there is level with the middle
    let px = 0, pz = 0;
    for (let s = 0; s < 6; s++) {
      const lx = Math.cos(a) * H.rx * r, lz = Math.sin(a) * H.rz * r;
      px = H.x + lx * H.c + lz * H.s;
      pz = H.z - lx * H.s + lz * H.c;
      const f = cave.floorAt(px, pz, fl + 1.2);
      if (Number.isFinite(f) && Math.abs(f - fl) < 0.12) break;
      r *= 0.82;
    }
    pos.push(px, fl + 0.03, pz);
  }
  for (let q = 0; q < n; q++) idx.push(0, 1 + ((q + 1) % n), 1 + q);
  return finish('ice', pos, idx, false, true, H.x, fl, H.z);
}
