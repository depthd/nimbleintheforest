// The regular world's immutable triangles. Retention is cached per 2 m vertex,
// never per 4 cm snow cell. Continuous shore/roof rules are sampled by both
// static snow geometry and detailed trail replacements.
import type { Region } from '../gen/region';
import { snowRetention } from './snow-test-terrain';

export class WorldSnowTerrain {
  private cover: Uint8Array;
  private waterLevels: Float32Array;
  private shoreLevels: Float32Array;
  private shoreWeights: Uint8Array;
  private cell: number;
  constructor(private region: Pick<Region, 'h' | 'water' | 'n' | 'size' | 'ox' | 'oz'>,
    private exposed: (x: number, z: number) => number) {
    this.cell = region.size / region.n;
    this.cover = new Uint8Array(region.h.length);
    this.waterLevels = new Float32Array(region.h.length).fill(Infinity);
    this.shoreLevels = new Float32Array(region.h.length);
    this.shoreWeights = new Uint8Array(region.h.length);
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
  private waterVertex(ix: number, iz: number) {
    const r = this.region, width = r.n + 1, index = iz * width + ix;
    if (this.waterLevels[index] !== Infinity) return this.waterLevels[index];
    let level = r.water[index];
    if (Number.isNaN(level)) {
      // Match Water.buildMesh: its first dry ring continues the water surface
      // beneath the bank. Nearest-cell waterAt produces visible 2 m steps here.
      let sum = 0, count = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = Math.max(0, Math.min(r.n, ix + dx)), z = Math.max(0, Math.min(r.n, iz + dz));
        const water = r.water[z * width + x];
        if (Number.isFinite(water)) { sum += water; count++; }
      }
      level = count ? sum / count : NaN;
    }
    this.waterLevels[index] = level; return level;
  }
  waterLevelAt(x: number, z: number) {
    const { ix, iz, u, v } = this.grid(x, z);
    const a = this.waterVertex(ix, iz), b = this.waterVertex(ix + 1, iz);
    const c = this.waterVertex(ix, iz + 1), d = this.waterVertex(ix + 1, iz + 1);
    // Water draws only complete quads with all four levels present.
    return Number.isFinite(a+b+c+d) ? this.triangle(a,b,c,d,u,v) + 0.03 : NaN;
  }
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
  substrateAt(x: number, z: number) {
    const { ix, iz, u, v } = this.grid(x, z);
    return this.triangle(this.retention(ix, iz), this.retention(ix + 1, iz),
      this.retention(ix, iz + 1), this.retention(ix + 1, iz + 1), u, v);
  }
  private shoreVertex(ix: number, iz: number) {
    const n=this.region.n,index=iz*(n+1)+ix;
    if (this.shoreWeights[index]) return index;
    let level=this.waterVertex(ix,iz),weight=1;
    if (!Number.isFinite(level)) {
      let sum=0,count=0;
      for (let dz=-1;dz<=1;dz++) for (let dx=-1;dx<=1;dx++) {
        const w=this.waterVertex(Math.max(0,Math.min(n,ix+dx)),Math.max(0,Math.min(n,iz+dz)));
        if (Number.isFinite(w)) {sum+=w;count++;}
      }
      level=count?sum/count:0;weight=count?0.5:0;
    }
    this.shoreWeights[index]=1+Math.round(weight*254);this.shoreLevels[index]=level*weight;
    return index;
  }
  shoreAt(x: number, z: number) {
    const {ix,iz,u,v}=this.grid(x,z),a=this.shoreVertex(ix,iz),b=this.shoreVertex(ix+1,iz),c=this.shoreVertex(ix,iz+1),d=this.shoreVertex(ix+1,iz+1);
    const weight=this.triangle((this.shoreWeights[a]-1)/254,(this.shoreWeights[b]-1)/254,(this.shoreWeights[c]-1)/254,(this.shoreWeights[d]-1)/254,u,v);
    if (weight<1e-6) return 1;
    const level=this.triangle(this.shoreLevels[a],this.shoreLevels[b],this.shoreLevels[c],this.shoreLevels[d],u,v)/weight;
    const t=Math.max(0,Math.min(1,(this.heightAt(x,z)-level-0.03)/0.55));
    return 1-weight+weight*t*t*(3-2*t);
  }
  detailedAt(x: number,z: number,size: number) {
    let lo=1,hi=0;
    for(let dz=0;dz<=size;dz+=this.cell) for(let dx=0;dx<=size;dx+=this.cell) {
      const s=this.shoreAt(x+dx,z+dz);lo=Math.min(lo,s);hi=Math.max(hi,s);
      if(hi-lo>0.01)return true;
    }
    return false;
  }
  retentionAt = (x: number, z: number) => {
    const cover=this.exposed(x,z);
    return cover ? cover*this.substrateAt(x,z)*this.shoreAt(x,z) : 0;
  };
}
