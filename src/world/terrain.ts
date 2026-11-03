// Procedural heightmap terrain with a flattened clearing for the house
// and a basin for the lake.
import * as THREE from 'three';
import { G, GROUPS_STATIC } from '../game/ctx';
import { Rng, Simplex2, clamp, lerp, smoothstep } from '../core/rng';
import { Tex } from '../core/textures';

export const WORLD_SIZE = 240;
const N = 160; // subdivisions

export interface LakeShape {
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  rot: number;
  level: number;
  wobble: number[]; // radius multipliers by angle
}

export class Terrain {
  size = WORLD_SIZE;
  n = N;
  heights: Float32Array; // (n+1)*(n+1), row-major [row(z)][col(x)]
  noise: Simplex2;
  lake: LakeShape;
  houseY: number;
  mesh!: THREE.Mesh;

  constructor(rng: Rng) {
    this.noise = new Simplex2(() => rng.next());
    const ang = rng.float(0.35, 1.1);
    const dist = rng.float(34, 42);
    const wobble: number[] = [];
    const wob = new Simplex2(() => rng.next());
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      wobble.push(1 + 0.16 * wob.noise(Math.cos(a) * 1.3, Math.sin(a) * 1.3));
    }
    this.lake = {
      cx: Math.cos(ang) * dist,
      cz: Math.sin(ang) * dist,
      rx: rng.float(18, 24),
      rz: rng.float(12, 16),
      rot: rng.float(0, Math.PI),
      level: 0,
      wobble,
    };
    this.houseY = this.natural(0, 0);
    // lake level slightly below the lowest natural point on its shore
    let minShore = Infinity;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const p = this.lakePoint(a, 1.0);
      minShore = Math.min(minShore, this.natural(p.x, p.z));
    }
    this.lake.level = Math.min(minShore, this.houseY) - 1.1;

    const n = this.n;
    this.heights = new Float32Array((n + 1) * (n + 1));
    for (let r = 0; r <= n; r++) {
      for (let c = 0; c <= n; c++) {
        const x = -this.size / 2 + (c * this.size) / n;
        const z = -this.size / 2 + (r * this.size) / n;
        this.heights[r * (n + 1) + c] = this.height(x, z);
      }
    }
  }

  /** Point on the lake ellipse boundary at angle a, scaled by k. */
  lakePoint(a: number, k: number) {
    const L = this.lake;
    const w = this.wobbleAt(a);
    const lx = Math.cos(a) * L.rx * w * k;
    const lz = Math.sin(a) * L.rz * w * k;
    const c = Math.cos(L.rot), s = Math.sin(L.rot);
    return { x: L.cx + lx * c - lz * s, z: L.cz + lx * s + lz * c };
  }

  private wobbleAt(a: number) {
    const W = this.lake.wobble;
    let t = ((a / (Math.PI * 2)) % 1 + 1) % 1;
    t *= W.length;
    const i = Math.floor(t);
    const f = t - i;
    return lerp(W[i % W.length], W[(i + 1) % W.length], f);
  }

  /** Normalised lake distance: <1 inside the lake. */
  lakeQ(x: number, z: number) {
    const L = this.lake;
    const dx = x - L.cx, dz = z - L.cz;
    const c = Math.cos(-L.rot), s = Math.sin(-L.rot);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const a = Math.atan2(lz / L.rz, lx / L.rx);
    const w = this.wobbleAt(a < 0 ? a + Math.PI * 2 : a);
    return Math.hypot(lx / L.rx, lz / L.rz) / w;
  }

  natural(x: number, z: number) {
    const n = this.noise;
    let h = n.fbm(x * 0.011, z * 0.011, 4) * 6 + n.fbm(x * 0.045 + 17, z * 0.045 - 9, 3) * 1.1;
    const r = Math.hypot(x, z);
    h += smoothstep(70, 118, r) * 22 * (0.7 + 0.3 * n.noise(x * 0.02, z * 0.02));
    return h;
  }

  height(x: number, z: number) {
    let h = this.natural(x, z);
    // house clearing
    const dh = Math.hypot(x, z * 1.1);
    h = lerp(this.houseY, h, smoothstep(9, 19, dh));
    // lake basin
    const q = this.lakeQ(x, z);
    const L = this.lake;
    if (q < 1.45) {
      const shore = L.level + 0.25;
      if (q < 1) {
        const bed = L.level - 0.35 - 2.6 * (1 - q * q);
        h = Math.min(h, bed);
      } else {
        const t = smoothstep(1, 1.45, q);
        h = lerp(Math.min(h, shore + (q - 1) * 2), h, t);
      }
    }
    return h;
  }

  /** Bilinear height from the grid (matches the collider closely). */
  heightAt(x: number, z: number) {
    const n = this.n;
    const fx = clamp(((x + this.size / 2) / this.size) * n, 0, n - 0.0001);
    const fz = clamp(((z + this.size / 2) / this.size) * n, 0, n - 0.0001);
    const c = Math.floor(fx), r = Math.floor(fz);
    const tx = fx - c, tz = fz - r;
    const H = this.heights;
    const i = r * (n + 1) + c;
    const h00 = H[i], h10 = H[i + 1], h01 = H[i + n + 1], h11 = H[i + n + 2];
    // match the two-triangle split of the heightfield approximately
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  build() {
    const n = this.n;
    const geo = new THREE.PlaneGeometry(this.size, this.size, n, n);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.heightAt(x, z));
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const slope = 1 - nrm.getY(i);
      const v = 0.94 + 0.06 * this.noise.noise(x * 0.15, z * 0.15);
      const rock = smoothstep(0.25, 0.45, slope);
      const q = this.lakeQ(x, z);
      const shore = q > 0.97 && q < 1.12 ? 0.05 : 0;
      colors[i * 3] = lerp(v * 0.95, 0.42, rock) - shore;
      colors[i * 3 + 1] = lerp(v * 0.97, 0.41, rock) - shore * 0.8;
      colors[i * 3 + 2] = lerp(v * 1.02, 0.4, rock) - shore * 0.3;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 50, uv.getY(i) * 50);
    const mat = new THREE.MeshStandardMaterial({
      map: Tex.snow(),
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    G.scene.add(this.mesh);

    // physics heightfield: column-major, rows along z, columns along x
    const hf = new Float32Array((n + 1) * (n + 1));
    for (let c = 0; c <= n; c++) {
      for (let r = 0; r <= n; r++) {
        hf[c * (n + 1) + r] = this.heights[r * (n + 1) + c];
      }
    }
    const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
    const col = G.world.createCollider(
      G.R.ColliderDesc.heightfield(n, n, hf, { x: this.size, y: 1, z: this.size })
        .setFriction(0.9)
        .setCollisionGroups(GROUPS_STATIC),
      body,
    );
    G.terrainHandle = col.handle;

    this.buildMountains();
  }

  private buildMountains() {
    // distant ring of hills, mostly fog silhouettes
    const geo = new THREE.CylinderGeometry(420, 470, 1, 128, 6, true);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const t = y + 0.5; // 0 bottom, 1 top
      const peak = 40 + 70 * Math.max(0, this.noise.fbm(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 4) + 0.35);
      pos.setY(i, -10 + t * peak);
      const shrink = 1 - t * 0.12;
      pos.setX(i, x * shrink);
      pos.setZ(i, z * shrink);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 1, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.name = 'mountains';
    G.scene.add(m);
  }
}
