// Draws and collides generated rock: cliff bands and the rock skin of steep slopes.
//
// Everything is merged into 256 m tiles (one rock mesh and one snow mesh each) and drawn by
// distance: rock to ~1.1 km, snow caps near the player only. Convex colliders exist only
// around the player and are created a few hundred at a time as he moves. Undercuts register
// their shelter (snow cover and wind) once, like huts.
import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { G, GROUPS_STATIC } from '../game/ctx';
import type { CliffBlock, CliffBuild, CliffMesh } from '../gen/cliffs';
import type { RockSkin } from '../gen/rock-skin';
import { Tex } from '../core/textures';
import { groundUniforms } from './terrain';

// strata tones: soft beds are darker and warmer, hard beds lighter and cooler
// dark, cool rock against bright snow, as in the references
const SOFT = new THREE.Color().setRGB(0.26, 0.27, 0.32, THREE.SRGBColorSpace);
const HARD = new THREE.Color().setRGB(0.41, 0.43, 0.49, THREE.SRGBColorSpace);
const TILE = 256;
const ROCK_NEAR = 380; // full blocks closer than this, simplified ones beyond
const ROCK_FAR = 1050;
const SNOW_FAR = 240;
const COLLIDE = 70, RELEASE = 95, CELL = 16;

export function makeRockMaterial() {
  // flat shading: the facet normal comes from screen derivatives, so meshes can share vertices
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRock = { value: Tex.rock() };
    sh.uniforms.uNoise = groundUniforms.uNoise;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;\nuniform sampler2D uRock;\nuniform sampler2D uNoise;')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
  {
    vec3 N = normalize(cross(dFdx(vRockPos), dFdy(vRockPos)));
    vec3 w = pow(abs(N), vec3(4.0)); w /= (w.x + w.y + w.z);
    vec3 p = vRockPos * 0.085;
    vec3 tex = texture2D(uRock, p.yz).rgb * w.x + texture2D(uRock, p.xz).rgb * w.y + texture2D(uRock, p.xy).rgb * w.z;
    vec4 nz = texture2D(uNoise, vRockPos.xz * 0.11 + vRockPos.y * 0.03);
    // the texture only breathes a little: clean facets read better than busy detail
    vec3 col = diffuseColor.rgb * (0.78 + 0.9 * tex) * (0.9 + 0.2 * nz.g);
    // faces turned up are snow, not dust: the white of a ledge reaches its edge
    float frost = smoothstep(0.5, 0.72, N.y + 0.14 * (nz.r - 0.5));
    col = mix(col, vec3(0.9, 0.925, 0.955), frost * 0.92);
    col *= mix(1.0, 0.7, smoothstep(0.0, -0.75, N.y));
    diffuseColor.rgb = col;
  }`);
  };
  m.customProgramCacheKey = () => 'cliff-rock-v2';
  return m;
}

/** Indexed triangles of a block, wound outwards. Skin blocks skip the faces buried in the slope.
 * The simplified version keeps only the bottom and top rings: no chamfer, no middle bulge. */
function appendBlock(b: CliffBlock, pos: number[], col: number[], idx: number[], color: THREE.Color, simple = false) {
  const n = b.n, P0 = b.pts, base = pos.length / 3, skin = b.kind === 'skin';
  const P = simple && b.rings > 2 ? Float32Array.from([...P0.subarray(0, n * 3), ...P0.subarray((b.rings - 1) * n * 3)]) : P0;
  const R = simple && b.rings > 2 ? 2 : b.rings;
  let cx = 0, cy = 0, cz = 0;
  for (let q = 0; q < n * R; q++) { cx += P[q * 3] / (n * R); cy += P[q * 3 + 1] / (n * R); cz += P[q * 3 + 2] / (n * R); }
  for (let q = 0; q < n * R * 3; q++) pos.push(P[q]);
  const fanCentre = (r: number) => {
    let x = 0, y = 0, z = 0;
    for (let q = 0; q < n; q++) { x += P[(r * n + q) * 3] / n; y += P[(r * n + q) * 3 + 1] / n; z += P[(r * n + q) * 3 + 2] / n; }
    pos.push(x, y, z);
    return pos.length / 3 - 1;
  };
  const top = fanCentre(R - 1), bottom = skin ? -1 : fanCentre(0);
  const count = pos.length / 3 - base;
  for (let q = 0; q < count; q++) col.push(color.r, color.g, color.b);
  const tri = (a: number, c: number, d: number) => {
    const A = a * 3, C = c * 3, D = d * 3;
    const ux = pos[C] - pos[A], uy = pos[C + 1] - pos[A + 1], uz = pos[C + 2] - pos[A + 2], vx = pos[D] - pos[A], vy = pos[D + 1] - pos[A + 1], vz = pos[D + 2] - pos[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-10) return;
    const mx = (pos[A] + pos[C] + pos[D]) / 3 - cx, my = (pos[A + 1] + pos[C + 1] + pos[D + 1]) / 3 - cy, mz = (pos[A + 2] + pos[C + 2] + pos[D + 2]) / 3 - cz;
    if (nx * mx + ny * my + nz * mz < 0) idx.push(a, d, c); else idx.push(a, c, d);
  };
  const v = (r: number, q: number) => base + r * n + (q % n);
  if (bottom >= 0) for (let q = 0; q < n; q++) tri(bottom, v(0, q), v(0, q + 1));
  for (let r = 0; r < R - 1; r++) for (let q = 0; q < n; q++) {
    if (skin && q === 3) continue; // the back of a skin block lies inside the slope
    tri(v(r, q), v(r, q + 1), v(r + 1, q + 1));
    tri(v(r, q), v(r + 1, q + 1), v(r + 1, q));
  }
  for (let q = 0; q < n; q++) tri(top, v(R - 1, q), v(R - 1, q + 1));
}

function geometry(pos: number[], idx: number[], col?: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(Uint8Array.from(col, (c) => Math.round(c * 255)), 3, true));
  g.setIndex(pos.length / 3 < 65536 ? new THREE.Uint16BufferAttribute(idx, 1) : new THREE.Uint32BufferAttribute(idx, 1));
  if (!col) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

interface Tile { cx: number; cz: number; r: number; rock: THREE.Mesh | null; far: THREE.Mesh | null; snow: THREE.Mesh | null; triangles: number; farTriangles: number; snowTriangles: number }

export class Cliffs {
  readonly group = new THREE.Group();
  readonly handles = new Set<number>();
  readonly blocks: CliffBlock[];
  private tiles: Tile[] = [];
  private grid = new Map<number, number[]>();
  private cols = new Map<number, RAPIER_T.Collider>();
  private body: RAPIER_T.RigidBody;
  private last = new THREE.Vector3(1e9, 0, 1e9);
  private pending = false;
  skipped = 0;

  constructor(readonly builds: CliffBuild[], readonly skin: RockSkin | null = null) {
    this.group.name = 'cliffs';
    this.blocks = [...builds.flatMap((b) => b.blocks), ...(skin?.blocks ?? [])];
    const tileKey = (x: number, z: number) => `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;

    // rock, merged per tile
    const rockByTile = new Map<string, { pos: number[]; col: number[]; idx: number[]; fpos: number[]; fcol: number[]; fidx: number[] }>();
    const c = new THREE.Color();
    this.blocks.forEach((b, i) => {
      const x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2, key = tileKey(x, z);
      let t = rockByTile.get(key);
      if (!t) rockByTile.set(key, (t = { pos: [], col: [], idx: [], fpos: [], fcol: [], fidx: [] }));
      c.copy(SOFT).lerp(HARD, b.tone);
      appendBlock(b, t.pos, t.col, t.idx, c);
      appendBlock(b, t.fpos, t.fcol, t.fidx, c, true);
      const g = Math.floor(x / CELL) * 65536 + Math.floor(z / CELL);
      const list = this.grid.get(g);
      if (list) list.push(i); else this.grid.set(g, [i]);
    });
    // snow caps and cornices, split into the same tiles by triangle
    const snowByTile = new Map<string, { pos: number[]; idx: number[]; map: Map<number, number> }>();
    const addMesh = (m: CliffMesh, id: number) => {
      const P = m.positions, I = m.indices;
      for (let k = 0; k < I.length; k += 3) {
        const a = I[k] * 3, key = tileKey(P[a], P[a + 2]);
        let t = snowByTile.get(key);
        if (!t) snowByTile.set(key, (t = { pos: [], idx: [], map: new Map() }));
        for (let q = 0; q < 3; q++) {
          const vtx = I[k + q], mk = id * 4194304 + vtx;
          let o = t.map.get(mk);
          if (o === undefined) { o = t.pos.length / 3; t.pos.push(P[vtx * 3], P[vtx * 3 + 1], P[vtx * 3 + 2]); t.map.set(mk, o); }
          t.idx.push(o);
        }
      }
    };
    builds.forEach((b, i) => addMesh(b.caps, i));
    if (skin) addMesh(skin.caps, builds.length);

    const rockMat = makeRockMaterial();
    const snowMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.9, 0.925, 0.955), roughness: 0.88 });
    for (const key of new Set([...rockByTile.keys(), ...snowByTile.keys()])) {
      const [tx, tz] = key.split(',').map(Number);
      const tile: Tile = { cx: (tx + 0.5) * TILE, cz: (tz + 0.5) * TILE, r: TILE * 0.71, rock: null, far: null, snow: null, triangles: 0, farTriangles: 0, snowTriangles: 0 };
      const r = rockByTile.get(key);
      if (r) {
        tile.rock = new THREE.Mesh(geometry(r.pos, r.idx, r.col), rockMat);
        tile.rock.castShadow = tile.rock.receiveShadow = true;
        tile.rock.name = 'cliff-rock';
        tile.triangles = r.idx.length / 3;
        this.group.add(tile.rock);
        tile.far = new THREE.Mesh(geometry(r.fpos, r.fidx, r.fcol), rockMat);
        tile.far.receiveShadow = true; // far away: no shadow pass
        tile.far.name = 'cliff-rock-far';
        tile.farTriangles = r.fidx.length / 3;
        tile.far.visible = false;
        this.group.add(tile.far);
      }
      const s = snowByTile.get(key);
      if (s) {
        tile.snow = new THREE.Mesh(geometry(s.pos, s.idx), snowMat);
        tile.snow.castShadow = tile.snow.receiveShadow = true;
        tile.snow.name = 'cliff-snow';
        tile.snowTriangles = s.idx.length / 3;
        this.group.add(tile.snow);
      }
      this.tiles.push(tile);
    }
    G.scene.add(this.group);
    this.body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());

    // undercuts: no loose snow under the roof, out of the wind
    for (const b of builds) for (const s of b.shelters) {
      G.snowCover.add({ name: 'Скальный навес', kind: 'roof', x: s.x, z: s.z, hx: s.hx, hz: s.hz, yaw: s.yaw, y: s.y1 });
      G.structures.shelters.push({ cx: s.x, cz: s.z, yaw: s.yaw, hx: s.hx, hz: s.hz, y0: s.y0, y1: s.y1,
        shelter: { kind: 'grotto', name: 'Под скальным навесом', wind: 0.35, warm: 1, enclosed: false, pos: new THREE.Vector3(s.x, s.y0, s.z) } });
    }
  }

  /** Draw by distance from the camera; keep colliders around the player. */
  update(camera: THREE.Vector3, player: THREE.Vector3, budget = 250) {
    for (const t of this.tiles) {
      const d = Math.max(0, Math.hypot(t.cx - camera.x, t.cz - camera.z) - t.r);
      if (t.rock) t.rock.visible = d < ROCK_NEAR;
      if (t.far) t.far.visible = d >= ROCK_NEAR && d < ROCK_FAR;
      if (t.snow) t.snow.visible = d < SNOW_FAR;
    }
    if (!this.pending && Math.hypot(player.x - this.last.x, player.z - this.last.z) < 5) return;
    this.last.copy(player);
    this.pending = false;
    const want = new Set<number>();
    const c0x = Math.floor((player.x - COLLIDE) / CELL), c1x = Math.floor((player.x + COLLIDE) / CELL);
    const c0z = Math.floor((player.z - COLLIDE) / CELL), c1z = Math.floor((player.z + COLLIDE) / CELL);
    for (let gx = c0x; gx <= c1x; gx++) for (let gz = c0z; gz <= c1z; gz++) {
      for (const i of this.grid.get(gx * 65536 + gz) ?? []) {
        const b = this.blocks[i];
        if (Math.hypot(Math.max(b.minX - player.x, 0, player.x - b.maxX), Math.max(b.minZ - player.z, 0, player.z - b.maxZ)) < COLLIDE) want.add(i);
      }
    }
    for (const i of want) {
      if (this.cols.has(i)) continue;
      if (budget-- <= 0) { this.pending = true; break; }
      const b = this.blocks[i];
      const desc = b.pts.some(Number.isNaN) ? null : G.R.ColliderDesc.convexHull(b.pts);
      if (!desc) { this.skipped++; this.cols.set(i, null as unknown as RAPIER_T.Collider); continue; }
      try {
        const col = G.world.createCollider(desc.setFriction(0.9).setCollisionGroups(GROUPS_STATIC), this.body);
        this.cols.set(i, col);
        this.handles.add(col.handle);
      } catch {
        this.skipped++; // a degenerate hull: keep the rest of the rock
        this.cols.set(i, null as unknown as RAPIER_T.Collider);
      }
    }
    for (const [i, col] of this.cols) {
      const b = this.blocks[i];
      const d = Math.hypot(Math.max(b.minX - player.x, 0, player.x - b.maxX), Math.max(b.minZ - player.z, 0, player.z - b.maxZ));
      if (d < RELEASE) continue;
      if (col) { this.handles.delete(col.handle); G.world.removeCollider(col, false); }
      this.cols.delete(i);
    }
  }

  setVisible(visible: boolean) { this.group.visible = visible; }

  stats() {
    let rock = 0, snow = 0, drawn = 0;
    for (const t of this.tiles) {
      rock += t.triangles; snow += t.snowTriangles;
      if (t.rock?.visible) drawn += t.triangles;
      if (t.far?.visible) drawn += t.farTriangles;
      if (t.snow?.visible) drawn += t.snowTriangles;
    }
    return { cliffs: this.builds.length, blocks: this.blocks.length, skin: this.skin?.blocks.length ?? 0, tiles: this.tiles.length,
      colliders: this.handles.size, skipped: this.skipped, rockTriangles: rock, snowTriangles: snow, drawnTriangles: drawn };
  }
}
