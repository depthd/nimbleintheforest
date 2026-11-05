// Immutable test relief. Its triangles are shared by drawing, collision and
// snow queries; slope retention never reads footprints or excavated walls.
import * as THREE from 'three';
import type { SnowRect } from './snow-field';

export const SNOW_HILLS = [
  { x: 34, z: 53, height: 0.65, rx: 3.2, rz: 4, label: 'Пологая', degrees: 18 },
  { x: 46, z: 51, height: 1.05, rx: 2.4, rz: 4, label: 'Средняя', degrees: 35 },
  { x: 40, z: 24, height: 1.5, rx: 1.5, rz: 4.5, label: 'Крутая', degrees: 58 },
];

export function snowRetention(degrees: number) {
  const s = THREE.MathUtils.smoothstep;
  if (degrees <= 15) return 1;
  if (degrees <= 35) return THREE.MathUtils.lerp(1, 0.55, s(degrees, 15, 35));
  if (degrees <= 55) return THREE.MathUtils.lerp(0.55, 0.06, s(degrees, 35, 55));
  return THREE.MathUtils.lerp(0.06, 0, s(degrees, 55, 65));
}

export class SnowTestTerrain {
  readonly cell = 0.2;
  readonly nx: number;
  readonly nz: number;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  private heights: Float32Array;
  private cover: Float32Array;
  constructor(readonly baseY: number, readonly bounds: SnowRect) {
    this.nx = Math.round((bounds.maxX - bounds.minX) / this.cell);
    this.nz = Math.round((bounds.maxZ - bounds.minZ) / this.cell);
    const width = this.nx + 1;
    this.heights = new Float32Array(width * (this.nz + 1));
    this.cover = new Float32Array(this.heights.length);
    this.positions = new Float32Array(this.heights.length * 3);
    const indices: number[] = [];
    for (let z = 0; z <= this.nz; z++) for (let x = 0; x <= this.nx; x++) {
      const wx = bounds.minX + x * this.cell, wz = bounds.minZ + z * this.cell;
      let h = baseY;
      for (const hill of SNOW_HILLS) {
        const r = Math.hypot((wx - hill.x) / hill.rx, (wz - hill.z) / hill.rz);
        if (r < 1) h += hill.height * (1 + Math.cos(Math.PI * r)) / 2;
      }
      const i = z * width + x;
      this.heights[i] = h;
      this.positions.set([wx, h, wz], i * 3);
      if (x < this.nx && z < this.nz) indices.push(i, i + width, i + 1, i + 1, i + width, i + width + 1);
    }
    this.indices = Uint32Array.from(indices);
    for (let z = 0; z <= this.nz; z++) for (let x = 0; x <= this.nx; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(this.nx, x + 1), zm = Math.max(0, z - 1), zp = Math.min(this.nz, z + 1);
      const dx = (this.heights[z * width + xp] - this.heights[z * width + xm]) / ((xp - xm) * this.cell);
      const dz = (this.heights[zp * width + x] - this.heights[zm * width + x]) / ((zp - zm) * this.cell);
      this.cover[z * width + x] = snowRetention(Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI);
    }
  }
  private sample(values: Float32Array, x: number, z: number) {
    const gx = THREE.MathUtils.clamp((x - this.bounds.minX) / this.cell, 0, this.nx - 1e-7);
    const gz = THREE.MathUtils.clamp((z - this.bounds.minZ) / this.cell, 0, this.nz - 1e-7);
    const ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz, i = iz * (this.nx + 1) + ix;
    const a = values[i], b = values[i + 1], c = values[i + this.nx + 1], d = values[i + this.nx + 2];
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  heightAt = (x: number, z: number) => this.sample(this.heights, x, z);
  retentionAt = (x: number, z: number) => this.sample(this.cover, x, z);
  normalAt(x: number, z: number) {
    const e = 0.1;
    return new THREE.Vector3(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e,
      this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setIndex(new THREE.BufferAttribute(this.indices, 1)); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
}
