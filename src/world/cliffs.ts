// Draws and collides generated cliffs: faceted rock blocks, rounded snow caps, one convex
// collider per block, and the shelter of every undercut (snow cover and wind).
import * as THREE from 'three';
import { G, GROUPS_STATIC } from '../game/ctx';
import { blockTriangles } from '../gen/cliffs';
import type { CliffBuild } from '../gen/cliffs';
import { Tex } from '../core/textures';
import { groundUniforms } from './terrain';

// strata tones: soft beds are darker and warmer, hard beds lighter and cooler
const SOFT = new THREE.Color().setRGB(0.36, 0.34, 0.36, THREE.SRGBColorSpace);
const HARD = new THREE.Color().setRGB(0.57, 0.58, 0.62, THREE.SRGBColorSpace);

export function makeRockMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRock = { value: Tex.rock() };
    sh.uniforms.uNoise = groundUniforms.uNoise;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;\nvarying vec3 vRockN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRockN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;\nvarying vec3 vRockN;\nuniform sampler2D uRock;\nuniform sampler2D uNoise;')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
  {
    vec3 N = normalize(vRockN);
    vec3 w = pow(abs(N), vec3(4.0)); w /= (w.x + w.y + w.z);
    vec3 p = vRockPos * 0.085;
    vec3 tex = texture2D(uRock, p.yz).rgb * w.x + texture2D(uRock, p.xz).rgb * w.y + texture2D(uRock, p.xy).rgb * w.z;
    vec4 nz = texture2D(uNoise, vRockPos.xz * 0.11 + vRockPos.y * 0.03);
    vec3 col = diffuseColor.rgb * (0.32 + 2.0 * tex) * (0.86 + 0.28 * nz.g);
    // rime and snow dust on everything that faces up; overhang undersides stay dark
    float frost = smoothstep(0.55, 0.85, N.y + 0.18 * (nz.r - 0.5));
    col = mix(col, vec3(0.84, 0.88, 0.93), frost * 0.8);
    col *= mix(1.0, 0.62, smoothstep(0.0, -0.75, N.y));
    diffuseColor.rgb = col;
  }`);
  };
  m.customProgramCacheKey = () => 'cliff-rock-v1';
  return m;
}

export class Cliffs {
  readonly group = new THREE.Group();
  readonly rock: THREE.Mesh;
  readonly snow: THREE.Mesh;
  readonly handles = new Set<number>();
  readonly triangles: number;
  skipped = 0;

  constructor(readonly builds: CliffBuild[]) {
    this.group.name = 'cliffs';
    // rock: flat-shaded facets, tinted per stratum
    const pos: number[] = [], col: number[] = [];
    const c = new THREE.Color();
    for (const b of builds) for (const block of b.blocks) {
      const start = pos.length;
      blockTriangles(block, pos);
      c.copy(SOFT).lerp(HARD, block.tone);
      for (let k = start; k < pos.length; k += 3) col.push(c.r, c.g, c.b);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    rg.computeVertexNormals(); // non-indexed: one normal per facet
    rg.computeBoundingSphere();
    this.rock = new THREE.Mesh(rg, makeRockMaterial());
    this.rock.castShadow = this.rock.receiveShadow = true;
    this.rock.name = 'cliff-rock';
    this.group.add(this.rock);
    this.triangles = pos.length / 9;

    // snow caps: smooth, the same white as the ground snow
    let count = 0, icount = 0;
    for (const b of builds) { count += b.caps.positions.length; icount += b.caps.indices.length; }
    const cp = new Float32Array(count), ci = new Uint32Array(icount);
    let o = 0, io = 0;
    for (const b of builds) {
      const base = o / 3;
      cp.set(b.caps.positions, o);
      for (let k = 0; k < b.caps.indices.length; k++) ci[io + k] = b.caps.indices[k] + base;
      o += b.caps.positions.length; io += b.caps.indices.length;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    sg.setIndex(new THREE.BufferAttribute(ci, 1));
    sg.computeVertexNormals();
    sg.computeBoundingSphere();
    this.snow = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: new THREE.Color(0.9, 0.925, 0.955), roughness: 0.88 }));
    this.snow.castShadow = this.snow.receiveShadow = true;
    this.snow.name = 'cliff-snow';
    this.group.add(this.snow);
    G.scene.add(this.group);

    // one convex collider per block; the feet stand on the same surfaces they see
    const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
    for (const b of builds) for (const block of b.blocks) {
      if (block.pts.some(Number.isNaN)) continue;
      const desc = G.R.ColliderDesc.convexHull(block.pts);
      if (!desc) continue;
      try {
        const col2 = G.world.createCollider(desc.setFriction(0.9).setCollisionGroups(GROUPS_STATIC), body);
        this.handles.add(col2.handle);
      } catch {
        this.skipped++; // a degenerate hull: keep the rest of the cliff
      }
    }

    // undercuts: no loose snow under the roof, out of the wind
    for (const b of builds) for (const s of b.shelters) {
      G.snowCover.add({ name: 'Скальный навес', kind: 'roof', x: s.x, z: s.z, hx: s.hx, hz: s.hz, yaw: s.yaw, y: s.y1 });
      G.structures.shelters.push({ cx: s.x, cz: s.z, yaw: s.yaw, hx: s.hx, hz: s.hz, y0: s.y0, y1: s.y1,
        shelter: { kind: 'grotto', name: 'Под скальным навесом', wind: 0.35, warm: 1, enclosed: false, pos: new THREE.Vector3(s.x, s.y0, s.z) } });
    }
  }

  setVisible(visible: boolean) { this.group.visible = visible; }

  stats() {
    return { cliffs: this.builds.length, blocks: this.builds.reduce((n, b) => n + b.blocks.length, 0), colliders: this.handles.size, skipped: this.skipped,
      rockTriangles: this.triangles, snowTriangles: (this.snow.geometry.index?.count ?? 0) / 3 };
  }
}
