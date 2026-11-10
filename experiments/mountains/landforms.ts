// Pure geographic frame. Passages are sampled after terrain synthesis: no raised
// route ribbon, radial shelf support or final corridor-flattening operation.
import {
  Rng,
  Simplex2,
  clamp,
  lerp,
  smoothstep,
  hashString,
} from "../../src/core/rng";
export interface Point {
  x: number;
  y: number;
  z: number;
}
export interface Route {
  id: string;
  name: string;
  width: number;
  points: Point[];
  status: "planned";
}
export interface View {
  id: string;
  name: string;
  position: Point;
  target: Point;
}
interface Node extends Point {
  width: number;
  right?: number;
}
interface Axis {
  id: string;
  nodes: Node[];
}
interface Projection {
  d: number;
  side: number;
  y: number;
  width: number;
  right: number;
  along: number;
}
export const VERSION = "terrain-frame-1";
export const SIZE = 1600,
  CELL = 4;
const stream = (seed: number, id: string) =>
  new Rng(seed ^ hashString(VERSION + "/" + id));
const softMax = (a: number, b: number, k: number) =>
  Math.max(a, b) + Math.max(k - Math.abs(a - b), 0) ** 2 / (4 * k);
function project(axis: Axis, x: number, z: number): Projection {
  let best: Projection = {
    d: Infinity,
    side: 0,
    y: 0,
    width: 1,
    right: 1,
    along: 0,
  };
  for (let i = 0; i < axis.nodes.length - 1; i++) {
    const a = axis.nodes[i],
      b = axis.nodes[i + 1],
      dx = b.x - a.x,
      dz = b.z - a.z;
    const t = clamp(
      ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz),
      0,
      1,
    );
    const ux = x - a.x - t * dx,
      uz = z - a.z - t * dz,
      d = Math.hypot(ux, uz);
    if (d < best.d)
      best = {
        d,
        side: dx * uz - dz * ux,
        y: lerp(a.y, b.y, t),
        width: lerp(a.width, b.width, t),
        right: lerp(a.right ?? a.width, b.right ?? b.width, t),
        along: i + t,
      };
  }
  return best;
}
function axis(id: string, pts: number[][]): Axis {
  return {
    id,
    nodes: pts.map(([x, y, z, width, right]) => ({ x, y, z, width, right })),
  };
}
export class Landforms {
  readonly n = SIZE / CELL;
  readonly heights = new Float32Array((this.n + 1) ** 2);
  readonly routes: Route[];
  readonly views: View[];
  readonly upper: number;
  readonly yaw: number;
  readonly mirror: number;
  readonly noise: Simplex2;
  readonly lake: { x: number; z: number; y: number; rx: number; rz: number };
  readonly drainage: Point[];
  readonly valleys: Axis[];
  readonly ridges: Axis[];
  readonly plan: {
    version: string;
    family: string;
    geography: string[];
    drainage: string[];
    traversal: { id: string; from: string; to: string; status: "planned" }[];
  };
  private routeAxes: Axis[] = [];
  private drainageAxis!: Axis;
  constructor(readonly seed: number) {
    const rng = stream(seed, "frame"),
      nr = stream(seed, "surface");
    this.noise = new Simplex2(() => nr.next());
    this.upper = rng.float(112, 126);
    this.yaw = rng.float(-0.25, 0.25);
    this.mirror = rng.chance(0.5) ? 1 : -1;
    const H = this.upper,
      shift = rng.float(-22, 22),
      spread = rng.float(0.9, 1.12);
    // Axis edits have their own stable stream. Decor never consumes it.
    const make = (id: string, pts: number[][], isRidge = false) => {
      const r = stream(seed, id);
      const a = axis(id, pts);
      a.nodes.forEach((p, i) => {
        p.x = p.x * spread + shift;
        p.y += H - 119;
        // Keep confluences fixed; branch interiors and exposed ridge profiles vary.
        if (isRidge) {
          p.y += r.float(-18, 18);
          p.width *= r.float(0.87, 1.15);
          if (p.right) p.right *= r.float(0.9, 1.15);
        } else if (i > 0 && i < a.nodes.length - 1) {
          p.width *= r.float(0.88, 1.13);
        }
      });
      return a;
    };
    this.ridges = [
      make(
        "west-divide",
        [
          [-600, 180, 60, 170, 260],
          [-475, 325, -100, 100, 230],
          [-450, 245, -220, 105, 210],
          [-405, 370, -340, 145, 240],
          [-300, 300, -430, 120, 200],
          [-220, 405, -480, 150, 230],
          [-25, 325, -510, 190, 210],
        ],
        true,
      ),
      make(
        "east-divide",
        [
          [520, 150, 280, 200, 280],
          [490, 285, 45, 135, 230],
          [545, 330, -85, 120, 200],
          [505, 420, -195, 125, 245],
          [435, 325, -300, 110, 200],
          [365, 470, -425, 150, 230],
          [255, 345, -485, 140, 210],
          [150, 390, -525, 170, 220],
        ],
        true,
      ),
      make(
        "fore-spur",
        [
          [505, 385, -195, 150, 200],
          [330, 280, -80, 145, 200],
          [190, 247, 15, 120, 180],
          [95, 200, 150, 105, 170],
          [-10, 95, 240, 150, 170],
        ],
        true,
      ),
      make(
        "west-spur",
        [
          [-405, 355, -340, 120, 170],
          [-310, 215, -70, 90, 135],
          [-365, 140, 85, 130, 170],
        ],
        true,
      ),
      make(
        "north-spur",
        [
          [-220, 375, -480, 145, 150],
          [-130, 260, -390, 100, 95],
          [-40, 159, -305, 75, 95],
        ],
        true,
      ),
      make(
        "east-shoulder",
        [
          [365, 410, -425, 150, 150],
          [345, 255, -240, 85, 140],
          [285, 180, -125, 80, 110],
        ],
        true,
      ),
      make(
        "west-rib",
        [
          [-405, 370, -340, 100, 120],
          [-345, 225, -275, 75, 90],
          [-260, 150, -255, 65, 80],
        ],
        true,
      ),
      make(
        "north-rib",
        [
          [150, 390, -525, 100, 140],
          [100, 245, -420, 80, 100],
          [145, 165, -320, 60, 80],
        ],
        true,
      ),
    ];
    this.valleys = [
      make("upper", [
        [-355, 116, -190, 62],
        [-210, 120, -240, 105],
        [-40, 128, -260, 88],
        [120, 136, -250, 115],
        [260, 149, -290, 86],
        [320, 166, -355, 48],
      ]),
      make("snow-pass", [
        [-535, 25, 310, 90],
        [-555, 44, 155, 80],
        [-540, 70, 15, 66],
        [-475, 96, -115, 70],
        [-355, 116, -190, 62],
      ]),
      make("outlet", [
        [-180, 22, 335, 66],
        [-180, 37, 180, 46],
        [-235, 71, 60, 35],
        [-200, 94, -30, 42],
        [-120, 116, -125, 30],
        [-40, 128, -260, 40],
      ]),
      make("side-cirque", [
        [-40, 128, -260, 36],
        [35, 147, -365, 48],
        [95, 177, -430, 32],
      ]),
      make("west-tributary", [
        [-210, 120, -240, 35],
        [-285, 151, -315, 28],
        [-320, 206, -395, 20],
      ]),
      make("east-tributary", [
        [120, 136, -250, 38],
        [205, 169, -355, 32],
        [225, 222, -430, 21],
      ]),
    ];
    const lakeR = stream(seed, "lake");
    this.lake = {
      x: 70 * spread + shift,
      z: -250,
      y: H + 13.7,
      rx: lakeR.float(39, 52) * spread,
      rz: lakeR.float(24, 31),
    };
    this.drainage = [
      { x: this.lake.x, y: this.lake.y, z: -250 },
      { x: -40 * spread + shift, y: H + 9, z: -260 },
      ...this.valleys[2].nodes
        .slice(0, -1)
        .reverse()
        .map((p) => ({ x: p.x, y: p.y - 1, z: p.z })),
    ];
    this.drainageAxis = {
      id: "outlet-channel",
      nodes: this.drainage.map((p) => ({ ...p, width: 6 })),
    };
    this.plan = {
      version: VERSION,
      family: "forked-upland-catchment",
      geography: this.valleys
        .map((a) => a.id)
        .concat(this.ridges.map((a) => a.id)),
      drainage: ["lake", "upper", "outlet", "lowland"],
      traversal: [
        { id: "apron", from: "lowland", to: "upper", status: "planned" },
        { id: "gully", from: "lowland", to: "upper", status: "planned" },
      ],
    };
    for (let j = 0; j <= this.n; j++)
      for (let i = 0; i <= this.n; i++)
        this.heights[j * (this.n + 1) + i] = this.form(
          i * CELL - SIZE / 2,
          j * CELL - SIZE / 2,
        );
    const route = (id: string, name: string, a: Axis, width: number): Route => {
      const points: Point[] = [];
      for (let k = 0; k < a.nodes.length - 1; k++) {
        const p = a.nodes[k],
          q = a.nodes[k + 1],
          n = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 3);
        for (let i = 0; i < n; i++) {
          const t = i / n,
            x = lerp(p.x, q.x, t),
            z = lerp(p.z, q.z, t),
            w = this.world(x, z);
          points.push({ x, z, y: this.heightAt(w.x, w.z) });
        }
      }
      const p = a.nodes[a.nodes.length - 1],
        w = this.world(p.x, p.z);
      points.push({ x: p.x, z: p.z, y: this.heightAt(w.x, w.z) });
      return { id, name, width, points, status: "planned" };
    };
    this.routes = [
      route("apron", "Снежный перевал", this.valleys[1], 60),
      route("gully", "Ложбина и промежуточный карман", this.valleys[2], 28),
    ];
    this.routeAxes = this.routes.map((r) => ({
      id: r.id,
      nodes: r.points.map((p) => ({ ...p, width: r.width })),
    }));
    const view = (
      id: string,
      name: string,
      x: number,
      z: number,
      tx: number,
      tz: number,
      dy = 1.8,
      tdy = 12,
    ): View => {
      const p = this.world(x * spread + shift, z),
        t = this.world(tx * spread + shift, tz);
      return {
        id,
        name,
        position: { ...p, y: this.heightAt(p.x, p.z) + dy },
        target: { ...t, y: this.heightAt(t.x, t.z) + tdy },
      };
    };
    this.views = [
      view("lower", "Подножие и разные проходы", -280, 380, 20, -180),
      view("slope", "Широкий снежный перевал", -550, 180, -480, -90),
      view("gully", "За поворотом ложбины", -220, 95, -205, -40),
      view("ledge", "Боковой карман под скалой", -205, -28, -125, -110),
      view("reveal", "Раскрытие верхней долины", -355, -190, 100, -245),
      view("upper", "Озеро между отрогами", 0, -220, 200, -290),
      view("back", "Обратный вид к низине", -130, -125, -175, 220, 1.8, 8),
      view("cirque", "Ответвление верхней долины", 35, -345, 120, -440),
      view("overview", "Общий вид", -440, 570, 0, -230, 390, 40),
    ];
  }
  local(x: number, z: number) {
    const c = Math.cos(this.yaw),
      s = Math.sin(this.yaw);
    return { x: (c * x + s * z) * this.mirror, z: -s * x + c * z };
  }
  world(x: number, z: number) {
    x *= this.mirror;
    const c = Math.cos(this.yaw),
      s = Math.sin(this.yaw);
    return { x: c * x - s * z, z: s * x + c * z };
  }
  private form(wx: number, wz: number) {
    const { x, z } = this.local(wx, wz),
      N = this.noise,
      H = this.upper;
    // A broad inclined bedrock foundation, independent of the walking paths.
    const north = 1 - smoothstep(-380, 350, z),
      edge = 1 - smoothstep(510, 790, Math.abs(x));
    const datum = 22 + (H + 38 - 22) * north * edge;
    let h = datum + N.fbm(x / 290, z / 290, 3) * 6;
    // Connected asymmetric ridges, varying crest heights, widths and slope breaks.
    for (const r of this.ridges) {
      const p = project(r, x, z),
        width = p.side < 0 ? p.width : p.right;
      const warp = 1 + 0.12 * N.noise(x / 145 + 3, z / 155);
      const q = p.d / (width * warp),
        relief = Math.max(0, p.y - datum);
      const profile = Math.max(0, 1 - Math.pow(q, 0.82));
      h = softMax(h, datum + relief * profile, 9);
    }
    // Middle forms have much smaller influence on sheltered valley floors.
    h += N.fbm(x / 95, z / 95, 3) * 8 * smoothstep(H + 25, H + 110, h);
    // Carve a connected watershed into the bedrock, not a path on top of it.
    // Min of candidates avoids dependence on the order of overlapping masks.
    let ceiling = h;
    for (const v of this.valleys) {
      const p = project(v, x, z),
        q = p.d / (p.width * (1 + 0.12 * N.noise(x / 110 + 7, z / 100)));
      if (q > 1.7) continue;
      const rise = q < 0.65 ? 5 * q * q : 2 + 70 * ((q - 0.65) / 0.9) ** 1.45;
      const floor =
        p.y +
        rise +
        N.noise(x / 85, z / 90) * 1.4 +
        N.noise(x / 23, z / 25) * 0.35;
      ceiling = Math.min(
        ceiling,
        lerp(h, Math.min(h, floor), 1 - smoothstep(0.85, 1.7, q)),
      );
    }
    h = ceiling;
    // Lake is a local basin in the upper floor, with a connected descending outlet.
    const l = this.lake,
      ld = Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz);
    h = lerp(h, l.y - 3.5 + ld * ld * 3, 1 - smoothstep(0.8, 1.16, ld));
    // Cut the authored outlet into the final ground instead of drawing it
    // through the floor. This local channel is not regional Priority-Flood.
    const river = project(this.drainageAxis, x, z);
    const channel = river.y - 0.6 + 0.08 * river.d * river.d;
    h = lerp(h, Math.min(h, channel), 1 - smoothstep(5, 10, river.d));
    return h;
  }
  routeDistance(x: number, z: number) {
    const p = this.local(x, z);
    return Math.min(...this.routeAxes.map((r) => project(r, p.x, p.z).d));
  }
  waterAt(x: number, z: number) {
    const p = this.local(x, z),
      l = this.lake;
    if (Math.hypot((p.x - l.x) / l.rx, (p.z - l.z) / l.rz) < 1) return l.y;
    const river = project(this.drainageAxis, p.x, p.z);
    return river.d < 2.3 ? river.y : NaN;
  }
  heightAt(x: number, z: number) {
    const u = clamp((x + SIZE / 2) / CELL, 0, this.n - 1e-5),
      v = clamp((z + SIZE / 2) / CELL, 0, this.n - 1e-5),
      i = Math.floor(u),
      j = Math.floor(v),
      a = u - i,
      b = v - j,
      k = j * (this.n + 1) + i,
      H = this.heights,
      n = this.n + 1;
    return a + b <= 1
      ? H[k] + (H[k + 1] - H[k]) * a + (H[k + n] - H[k]) * b
      : H[k + n + 1] +
          (H[k + n] - H[k + n + 1]) * (1 - a) +
          (H[k + 1] - H[k + n + 1]) * (1 - b);
  }
  slopeAt(x: number, z: number) {
    return (
      Math.hypot(
        this.heightAt(x + 2, z) - this.heightAt(x - 2, z),
        this.heightAt(x, z + 2) - this.heightAt(x, z - 2),
      ) / 4
    );
  }
  worldRoute(r: Route) {
    return r.points.map((p) => ({ ...this.world(p.x, p.z), y: p.y }));
  }
}
