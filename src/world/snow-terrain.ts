// The regular world's immutable triangles. Retention is cached per 2 m vertex,
// never per 4 cm snow cell; masks keep floors, roofs and water out of the layer.
import type { Region } from '../gen/region';
import { snowRetention } from './snow-test-terrain';

export class WorldSnowTerrain {
  private cover: Uint8Array;
  private cell: number;
  constructor(private region: Pick<Region, 'h' | 'n' | 'size' | 'ox' | 'oz'>,
    private exposed: (x: number, z: number) => boolean) {
    this.cell = region.size / region.n;
    this.cover = new Uint8Array(region.h.length);
  }
  private grid(x: number, z: number) {
    const r = this.region;
    const gx = Math.max(0, Math.min(r.n - 1e-7, (x + r.ox) / this.cell));
    const gz = Math.max(0, Math.min(r.n - 1e-7, (z + r.oz) / this.cell));
    const ix = Math.floor(gx), iz = Math.floor(gz);
    return { ix, iz, u: gx - ix, v: gz - iz, i: iz * (r.n + 1) + ix };
  }
  private triangle(a: number, b: number, c: number, d: number, u: number, v: number) {
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  heightAt = (x: number, z: number) => {
    const { i, u, v } = this.grid(x, z), { h, n } = this.region;
    return this.triangle(h[i], h[i + 1], h[i + n + 1], h[i + n + 2], u, v);
  };
  inclineAt(x: number, z: number) {
    const { i, u, v } = this.grid(x, z), { h, n } = this.region;
    const dx = u + v <= 1 ? h[i + 1] - h[i] : h[i + n + 2] - h[i + n + 1];
    const dz = u + v <= 1 ? h[i + n + 1] - h[i] : h[i + n + 2] - h[i + 1];
    return Math.hypot(dx, dz) / this.cell;
  }
  private retention(ix: number, iz: number) {
    const { h, n } = this.region, width = n + 1, i = iz * width + ix;
    if (!this.cover[i]) {
      const xm = Math.max(0, ix - 1), xp = Math.min(n, ix + 1), zm = Math.max(0, iz - 1), zp = Math.min(n, iz + 1);
      const dx = (h[iz * width + xp] - h[iz * width + xm]) / ((xp - xm) * this.cell);
      const dz = (h[zp * width + ix] - h[zm * width + ix]) / ((zp - zm) * this.cell);
      this.cover[i] = 1 + Math.round(254 * snowRetention(Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI));
    }
    return (this.cover[i] - 1) / 254;
  }
  retentionAt = (x: number, z: number) => {
    if (!this.exposed(x, z)) return 0;
    const { ix, iz, u, v } = this.grid(x, z);
    return this.triangle(this.retention(ix, iz), this.retention(ix + 1, iz),
      this.retention(ix, iz + 1), this.retention(ix + 1, iz + 1), u, v);
  };
}
