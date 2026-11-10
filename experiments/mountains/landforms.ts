// Pure-data experiment. No Region mutations or renderer/physics dependencies.
import { Rng, Simplex2, clamp, lerp, smoothstep } from "../../src/core/rng";
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
}
export interface View {
  id: string;
  name: string;
  position: Point;
  target: Point;
}
export const VERSION = "landforms-lab-1";
export const SIZE = 1600,
  CELL = 4;
export class Landforms {
  readonly n = SIZE / CELL;
  readonly heights = new Float32Array((this.n + 1) ** 2);
  readonly routes: Route[];
  readonly views: View[];
  readonly upper: number;
  readonly yaw: number;
  readonly mirror: number;
  readonly noise: Simplex2;
  readonly lake: {
    x: number;
    z: number;
    y: number;
    rx: number;
    rz: number;
  };
  readonly drainage: Point[];
  constructor(readonly seed: number) {
    const rng = new Rng(seed),
      noiseRng = new Rng(seed ^ 0x6a73f);
    this.noise = new Simplex2(() => noiseRng.next());
    this.upper = rng.float(101, 121);
    this.yaw = rng.float(-0.35, 0.35);
    this.mirror = rng.chance(0.5) ? 1 : -1;
    const H = this.upper,
      bend = rng.float(-18, 18);
    const route = (
      id: string,
      name: string,
      width: number,
      points: number[][],
    ): Route => ({
      id,
      name,
      width,
      points: this.spline(points.map(([x, y, z]) => ({ x, y, z }))),
    });
    this.routes = [
      route("apron", "Широкий снежный склон", 29 + rng.float(0, 10), [
        [-420, 20, 300],
        [-490, 34, 185],
        [-470, 57, 65],
        [-360, 83, -70],
        [-195, H, -165],
        [-40, H, -210],
      ]),
      route("gully", "Извилистая ложбина", 12 + rng.float(0, 5), [
        [-220, 20, 300],
        [-120, 32, 200],
        [-210 + bend, 49, 100],
        [-120, 66, 5],
        [-165, 85, -80],
        [-40, H, -175],
        [70, H, -210],
      ]),
      route("shoulder", "Полка вокруг скального плеча", 10 + rng.float(0, 4), [
        [-210 + bend, 49, 100],
        [-65, 61, 170],
        [100, 81, 205],
        [275, 107, 140],
        [315, H + 13, 0],
        [255, H, -140],
        [150, H, -200],
      ]),
    ];
    this.lake = {
      x: 205,
      z: -235,
      y: H + 0.3,
      rx: 52 + rng.float(0, 12),
      rz: 31 + rng.float(0, 8),
    };
    this.drainage = this.spline([
      { x: 235, y: H + 0.3, z: -215 },
      { x: 305, y: H - 1, z: -195 },
      { x: 370, y: H - 8, z: -150 },
      { x: 412, y: H - 35, z: -60 },
      { x: 440, y: 45, z: 60 },
      { x: 465, y: 22, z: 200 },
    ]);
    for (let j = 0; j <= this.n; j++)
      for (let i = 0; i <= this.n; i++)
        this.heights[j * (this.n + 1) + i] = this.form(
          i * CELL - SIZE / 2,
          j * CELL - SIZE / 2,
        );
    const view = (
      id: string,
      name: string,
      x: number,
      z: number,
      tx: number,
      tz: number,
      dy = 1.8,
      tdy = 18,
    ): View => {
      const p = this.world(x, z),
        t = this.world(tx, tz);
      return {
        id,
        name,
        position: { ...p, y: this.heightAt(p.x, p.z) + dy },
        target: { ...t, y: this.heightAt(t.x, t.z) + tdy },
      };
    };
    this.views = [
      view("lower", "Нижняя долина", -290, 360, 120, -160),
      view("reveal", "Выход в верхнюю долину", -100, -172, 250, -250),
      view("upper", "Верхний лес и озеро", 110, -200, 260, -270),
      view("slope", "Снежный склон", -465, 150, -380, -70),
      view("gully", "Поворот ложбины", -165, 150, -180, 65),
      view("ledge", "На круговой полке", 135, 201, 270, 100),
      view("back", "Взгляд вниз", 290, 45, -180, 340, 1.8, 8),
      view("overview", "Общий вид", -400, 520, 100, -120, 330, 45),
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
  private spline(p: Point[]) {
    const out: Point[] = [];
    for (let k = 0; k < p.length - 1; k++) {
      const a = p[Math.max(0, k - 1)],
        b = p[k],
        c = p[k + 1],
        d = p[Math.min(p.length - 1, k + 2)],
        n = Math.ceil(Math.hypot(c.x - b.x, c.z - b.z) / 4);
      for (let j = 0; j < n; j++) {
        const t = j / n;
        const f = (v: keyof Point) =>
          0.5 *
          (2 * b[v] +
            (-a[v] + c[v]) * t +
            (2 * a[v] - 5 * b[v] + 4 * c[v] - d[v]) * t * t +
            (-a[v] + 3 * b[v] - 3 * c[v] + d[v]) * t * t * t);
        out.push({
          x: f("x"),
          y: lerp(b.y, c.y, t * t * (3 - 2 * t)),
          z: f("z"),
        });
      }
    }
    out.push(p[p.length - 1]);
    return out;
  }
  private near(points: Point[], x: number, z: number) {
    let d = Infinity,
      y = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1],
        dx = b.x - a.x,
        dz = b.z - a.z,
        t = clamp(
          ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz),
          0,
          1,
        ),
        dist = Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
      if (dist < d) {
        d = dist;
        y = lerp(a.y, b.y, t);
      }
    }
    return { d, y };
  }
  routeDistance(x: number, z: number) {
    const p = this.local(x, z);
    return Math.min(...this.routes.map((r) => this.near(r.points, p.x, p.z).d));
  }
  waterAt(x: number, z: number) {
    const p = this.local(x, z),
      l = this.lake;
    return Math.hypot((p.x - l.x) / l.rx, (p.z - l.z) / l.rz) < 1 ? l.y : NaN;
  }
  private form(wx: number, wz: number) {
    const { x, z } = this.local(wx, wz),
      N = this.noise,
      H = this.upper;
    let h = 22 + N.fbm(x / 410, z / 410, 3) * 11 + N.noise(x / 90, z / 90) * 2;
    const e = Math.hypot((x - 130) / 360, (z + 210) / 220);
    h = Math.max(h, H * (1 - smoothstep(0.85, 1.16, e)));
    const rx = x + 17 * N.noise(x / 90 + 13, z / 120),
      rz = z + 13 * N.noise(x / 110, z / 85 + 9);
    const ridge = (
      cx: number,
      cz: number,
      sx: number,
      sz: number,
      height: number,
    ) =>
      height * Math.exp(-(((rx - cx) / sx) ** 2 + ((rz - cz) / sz) ** 2) * 1.9);
    // Overlapping elongated shoulders, unequal peaks; an open southern lowland.
    h +=
      ridge(80, -440, 350, 115, 160) +
      ridge(-300, -320, 125, 210, 183) +
      ridge(490, -260, 135, 265, 220) +
      ridge(125, 75, 120, 90, 202) +
      ridge(-80, -440, 125, 115, 100);
    h += N.fbm(x / 70, z / 70, 3) * 22 * smoothstep(65, 180, h);
    const floor = H + 2.7 * N.noise(x / 120, z / 135) + 1.7 * Math.sin(x / 110);
    h = lerp(h, floor, 1 - smoothstep(0.59, 0.91, e));
    const lower = Math.hypot((x + 250) / 300, (z - 340) / 150);
    h = lerp(
      h,
      20 + N.noise(x / 100, z / 100) * 1.2,
      1 - smoothstep(0.6, 1.2, lower),
    );
    // Corridors preserve space, not identical steps. Width varies smoothly along their length.
    let total = 0,
      target = 0,
      weight = 0;
    for (const r of this.routes) {
      const a = this.near(r.points, x, z),
        w = r.width * (1 + 0.14 * N.noise(x / 80 + 11, z / 80));
      const f = 1 - smoothstep(w * 0.45, w * 1.55, a.d);
      total += f;
      target += f * (a.y + 0.18 * N.noise(x / 12, z / 12));
      weight = Math.max(weight, f);
    }
    // A passage is supported by a broad shoulder, not a narrow raised ribbon.
    for (const r of this.routes) {
      const a = this.near(r.points, x, z),
        grade = r.id === "apron" ? 0.34 : r.id === "gully" ? 0.55 : 1.35;
      h = Math.max(h, a.y - Math.max(0, a.d - r.width * 0.3) * grade);
    }
    if (total > 0) h = lerp(h, target / total, weight);
    const l = this.lake,
      ld = Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz);
    h = lerp(h, l.y - 3.2 + ld * ld * 2.7, 1 - smoothstep(0.82, 1.13, ld));
    const river = this.near(this.drainage, x, z),
      rw = 4 + smoothstep(20, H, river.y) * 2;
    h = lerp(h, river.y - 1.3, 1 - smoothstep(rw * 0.45, rw * 1.9, river.d));
    return h;
  }
  /** Triangle interpolation matches both the displayed mesh and Rapier heightfield. */
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
