// Droplet hydraulic erosion (after Hans Theobald Beyer, 2015).
// Each droplet runs downhill, picks up sediment where it speeds up and drops it where it slows,
// carving gullies and ridges and smoothing the foothills.
// Heights are in cell units here, so the gradient is the real slope.

export interface ErosionOptions {
  drops: number;
  maxLife?: number;
  radius?: number;
  inertia?: number;
  capacity?: number;
  minCapacity?: number;
  deposit?: number;
  erode?: number;
  evaporate?: number;
  gravity?: number;
  /** per-vertex multiplier of how easily the ground erodes (0..1) */
  hardness?: Float32Array;
}

export function erode(H: Float32Array, n: number, rand: () => number, o: ErosionOptions) {
  const maxLife = o.maxLife ?? 48;
  const R = o.radius ?? 2;
  const inertia = o.inertia ?? 0.05;
  const capF = o.capacity ?? 4;
  const minCap = o.minCapacity ?? 0.01;
  const depF = o.deposit ?? 0.3;
  const eroF = o.erode ?? 0.3;
  const evap = o.evaporate ?? 0.02;
  const grav = o.gravity ?? 4;
  const hard = o.hardness;

  // erosion brush
  const bx: number[] = [], by: number[] = [], bw: number[] = [];
  let wsum = 0;
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
    const d = Math.hypot(x, y);
    if (d < R) {
      bx.push(x);
      by.push(y);
      bw.push(R - d);
      wsum += R - d;
    }
  }
  for (let i = 0; i < bw.length; i++) bw[i] /= wsum;
  const nb = bw.length;

  const hg = { h: 0, gx: 0, gy: 0 };
  const sample = (x: number, y: number) => {
    const ix = x | 0, iy = y | 0;
    const fx = x - ix, fy = y - iy;
    const i = iy * n + ix;
    const a = H[i], b = H[i + 1], c = H[i + n], d = H[i + n + 1];
    hg.gx = (b - a) * (1 - fy) + (d - c) * fy;
    hg.gy = (c - a) * (1 - fx) + (d - b) * fx;
    hg.h = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  };

  for (let drop = 0; drop < o.drops; drop++) {
    let x = 1 + rand() * (n - 3), y = 1 + rand() * (n - 3);
    let dx = 0, dy = 0, speed = 1, water = 1, sed = 0;
    for (let life = 0; life < maxLife; life++) {
      const ix = x | 0, iy = y | 0;
      const ox = x - ix, oy = y - iy;
      const idx = iy * n + ix;
      sample(x, y);
      const h0 = hg.h;
      dx = dx * inertia - hg.gx * (1 - inertia);
      dy = dy * inertia - hg.gy * (1 - inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) break;
      dx /= len;
      dy /= len;
      x += dx;
      y += dy;
      if (x < 1 || y < 1 || x >= n - 2 || y >= n - 2) break;
      sample(x, y);
      const dh = hg.h - h0;
      const cap = Math.max(-dh * speed * water * capF, minCap);
      if (sed > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depF;
        sed -= amt;
        H[idx] += amt * (1 - ox) * (1 - oy);
        H[idx + 1] += amt * ox * (1 - oy);
        H[idx + n] += amt * (1 - ox) * oy;
        H[idx + n + 1] += amt * ox * oy;
      } else {
        let amt = Math.min((cap - sed) * eroF, -dh);
        if (hard) amt *= hard[idx];
        for (let k = 0; k < nb; k++) {
          const cx = ix + bx[k], cy = iy + by[k];
          if (cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
          const e = amt * bw[k];
          H[cy * n + cx] -= e;
          sed += e;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * grav));
      water *= 1 - evap;
    }
  }
}
