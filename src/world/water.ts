// Lakes, rivers and the sea: ice you can walk on, thin ice that breaks, open water.
// Near the player every chunk with water gets a flat surface mesh and an ice collider;
// far away the ground shader paints the ice. Holes for water and fishing freeze over.
import * as THREE from 'three';
import { G, GROUPS_STATIC } from '../game/ctx';
import type { Region } from '../gen/region';
import { clamp } from '../core/rng';
import { Entity } from '../game/entities';
import { mat } from '../game/meshes';
import { noiseTexture } from '../core/noisetex';
import { groundUniforms } from './terrain';

const CH = 64;

export const waterUniforms = {
  uSkyTop: { value: new THREE.Color(0.3, 0.45, 0.7) },
  uSkyHorizon: { value: new THREE.Color(0.75, 0.82, 0.9) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 0.9, 0.8) },
  uTime: { value: 0 },
  uNoise: { value: null as THREE.Texture | null },
};

function makeIceMaterial(sea: boolean) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0, polygonOffset: !sea, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  m.defines = sea ? { SEA: 1 } : {};
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, waterUniforms, { uWaterTex: groundUniforms.uWaterTex, uOrigin: groundUniforms.uOrigin, uSize: groundUniforms.uSize });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aIce;\nvarying float vIce;\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#ifdef SEA\nvIce = 0.0;\n#else\nvIce = aIce;\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vIce; varying vec3 vWPos;
uniform vec3 uSkyTop; uniform vec3 uSkyHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uTime; uniform sampler2D uNoise;
uniform sampler2D uWaterTex; uniform vec2 uOrigin; uniform float uSize;`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
  vec4 n1 = texture2D(uNoise, vWPos.xz * 0.013);
  vec4 n2 = texture2D(uNoise, vWPos.xz * 0.09);
  vec4 n3 = texture2D(uNoise, vWPos.xz * 0.6);
  float iceT = vIce;
#ifdef SEA
  iceT = texture2D(uWaterTex, (vWPos.xz + uOrigin) / uSize).g;
#endif
  float isIce = smoothstep(0.0, 0.02, iceT);
  // ice: wind-packed snow patches over clear blue-grey ice with white cracks
  float snowK = smoothstep(0.42, 0.62, n1.g + n2.r * 0.35) * smoothstep(0.08, 0.2, iceT);
  vec3 bare = mix(vec3(0.42, 0.55, 0.64), vec3(0.62, 0.72, 0.8), n2.b) * (0.9 + 0.2 * n3.r);
  float crack = 1.0 - smoothstep(0.0, 0.018, abs(n2.a - 0.5)) ;
  crack = max(crack, 1.0 - smoothstep(0.0, 0.012, abs(n3.g - 0.5))) * (1.0 - snowK);
  bare = mix(bare, vec3(0.9, 0.95, 1.0), crack * 0.55);
  // thin ice looks dark and glassy: a warning
  float thin = 1.0 - smoothstep(0.06, 0.16, iceT);
  bare = mix(bare, vec3(0.12, 0.17, 0.21), thin * 0.8);
  vec3 iceCol = mix(bare, vec3(0.9, 0.93, 0.96) * (0.95 + 0.06 * n3.b), snowK);
  vec3 waterCol = vec3(0.015, 0.03, 0.045);
  diffuseColor.rgb = mix(waterCol, iceCol, isIce);
`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.06, mix(0.18, 0.92, snowK), isIce);',
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
  {
    // open water: sky reflection with ripples, and the sun's glitter path
    vec3 V = normalize(cameraPosition - vWPos);
    vec2 w1 = texture2D(uNoise, vWPos.xz * 0.05 + vec2(uTime * 0.011, uTime * 0.007)).rg - 0.5;
    vec2 w2 = texture2D(uNoise, vWPos.xz * 0.21 - vec2(uTime * 0.02, -uTime * 0.013)).ba - 0.5;
    vec3 Nw = normalize(vec3((w1.x + w2.x * 0.5) * 0.35, 1.0, (w1.y + w2.y * 0.5) * 0.35));
    vec3 Rf = reflect(-V, Nw);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(V, Nw), 0.0), 5.0);
    vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(Rf.y, 0.0, 1.0), 0.6));
    float glit = pow(max(dot(Rf, uSunDir), 0.0), 350.0) * 6.0 * step(0.0, uSunDir.y);
    vec3 refl = sky * fres + uSunColor * glit;
    outgoingLight = mix(outgoingLight + refl, outgoingLight, isIce);
  }
#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => (sea ? 'ice-sea' : 'ice');
  return m;
}

interface WSlot {
  built: boolean;
  mesh: THREE.Mesh | null;
  collider: boolean;
  has: boolean;
}

export class Water {
  R!: Region;
  holes: Entity[] = [];
  thin = { x: 1e9, z: 1e9, r: 3.2 };
  thinBroken = false;
  handles = new Set<number>();
  sea!: THREE.Mesh;
  private mat!: THREE.MeshStandardMaterial;
  private holeMat!: THREE.MeshStandardMaterial;
  private slots: WSlot[] = [];
  private cpc = 0;
  private body: any;
  private group = new THREE.Group();

  build(R: Region) {
    this.R = R;
    this.cpc = R.n / CH;
    if (R.sites.thin) this.thin = { ...R.sites.thin };
    waterUniforms.uNoise.value = noiseTexture();
    this.mat = makeIceMaterial(false);
    const nf = R.n + 1;
    for (let cj = 0; cj < this.cpc; cj++) for (let ci = 0; ci < this.cpc; ci++) {
      let has = false;
      for (let j = cj * CH; j <= (cj + 1) * CH && !has; j += 2) for (let i = ci * CH; i <= (ci + 1) * CH; i += 2) {
        if (!Number.isNaN(R.water[j * nf + i])) {
          has = true;
          break;
        }
      }
      this.slots.push({ built: false, mesh: null, collider: false, has });
    }
    this.body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
    G.scene.add(this.group);
    // the sea to the horizon
    const sg = new THREE.PlaneGeometry(60000, 60000, 1, 1);
    sg.rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(sg, makeIceMaterial(true));
    this.sea.position.set(R.size / 2 - R.ox, -0.7, R.size / 2 - R.oz);
    this.sea.frustumCulled = false;
    this.sea.name = 'sea';
    G.scene.add(this.sea);
    this.holeMat = mat('icehole', () => new THREE.MeshStandardMaterial({ color: 0x0d1a24, roughness: 0.05, metalness: 0.3 })) as THREE.MeshStandardMaterial;
    // a thin-ice warning patch
    if (R.sites.thin) {
      const tg = new THREE.CircleGeometry(this.thin.r, 28);
      const tm = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: 0x5f7484, transparent: true, opacity: 0.5, roughness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }));
      tm.rotation.x = -Math.PI / 2;
      tm.position.set(this.thin.x, this.levelAt(this.thin.x, this.thin.z) + 0.035, this.thin.z);
      G.scene.add(tm);
    }
  }

  levelAt(x: number, z: number) {
    return this.R.waterAt(x, z);
  }

  /** standing on (or just above) ice */
  onIce(p: THREE.Vector3) {
    const L = this.R.waterAt(p.x, p.z);
    return !Number.isNaN(L) && this.R.iceAt(p.x, p.z) > 0 && Math.abs(p.y - L) < 0.6;
  }

  /** a spot where the ice gives way */
  onThin(p: THREE.Vector3) {
    const L = this.R.waterAt(p.x, p.z);
    if (Number.isNaN(L) || Math.abs(p.y - L) > 0.3) return false;
    if (!this.thinBroken && Math.hypot(p.x - this.thin.x, p.z - this.thin.z) < this.thin.r * 0.85) return true;
    const t = this.R.iceAt(p.x, p.z);
    return t > 0 && t < 0.1 && !this.holeNear(p, 1.2);
  }

  /** nearest place to climb out onto: thick ice or dry land */
  safeSpotNear(p: THREE.Vector3) {
    for (let r = 1.5; r < 30; r += 0.75) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        const L = this.R.waterAt(x, z);
        if (Number.isNaN(L)) return new THREE.Vector3(x, this.R.heightAt(x, z) + 0.05, z);
        if (this.R.iceAt(x, z) >= 0.15 && !this.holeNear(new THREE.Vector3(x, L, z), 1.4) && Math.hypot(x - this.thin.x, z - this.thin.z) > this.thin.r + 0.5) return new THREE.Vector3(x, L + 0.06, z);
      }
    }
    return null;
  }

  makeHole(pos: THREE.Vector3, r = 0.2, name = 'Лунка'): Entity {
    const level = this.levelAt(pos.x, pos.z);
    const L = Number.isNaN(level) ? pos.y : level;
    const e = new Entity('icehole');
    e.name = name;
    const g = new THREE.Group();
    g.position.set(pos.x, L + 0.045, pos.z);
    const water = new THREE.Mesh(new THREE.CircleGeometry(r, 20), this.holeMat.clone());
    water.rotation.x = -Math.PI / 2;
    g.add(water);
    const rim = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.12, 20), new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 0.9 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.004;
    g.add(rim);
    G.scene.add(g);
    e.obj = g;
    g.userData.entity = e;
    const col = G.world.createCollider(
      G.R.ColliderDesc.cylinder(0.05, r + 0.05).setTranslation(pos.x, L + 0.05, pos.z).setSensor(true).setCollisionGroups(GROUPS_STATIC),
    );
    e.data = { r, frozen: 0, water, level: L };
    G.entities.registerStatic(e, [col]);
    this.holes.push(e);
    return e;
  }

  holeNear(p: THREE.Vector3, r = 0.9): Entity | null {
    let best: Entity | null = null;
    let bd = r;
    for (const h of this.holes) {
      const d = Math.hypot(h.obj!.position.x - p.x, h.obj!.position.z - p.z);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  update(dtGame: number) {
    // holes freeze over in a few hours, faster in hard frost
    const t = G.weather.temp;
    const rate = Math.max(0, -t) / 15 / (3 * 3600);
    for (const h of this.holes) {
      if (h.data.big) continue;
      h.data.frozen = Math.min(1, h.data.frozen + dtGame * rate);
      const m = h.data.water.material as THREE.MeshStandardMaterial;
      const f = h.data.frozen;
      m.color.setRGB(0.05 + f * 0.75, 0.1 + f * 0.75, 0.14 + f * 0.75);
      m.roughness = 0.05 + f * 0.6;
    }
  }

  /** Build surfaces and ice colliders for chunks near a point. */
  stream(p: THREE.Vector3, budget = 2) {
    const R = this.R;
    const cs = CH * 2;
    const cci = Math.floor((p.x + R.ox) / cs), ccj = Math.floor((p.z + R.oz) / cs);
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const ci = cci + di, cj = ccj + dj;
      if (ci < 0 || cj < 0 || ci >= this.cpc || cj >= this.cpc) continue;
      const s = this.slots[cj * this.cpc + ci];
      if (!s.has) continue;
      const near = Math.max(Math.abs(di), Math.abs(dj)) <= 2;
      if (!s.built && budget > 0) {
        this.buildMesh(ci, cj, s);
        budget--;
      }
      if (near && !s.collider) {
        this.buildCollider(ci, cj);
        s.collider = true;
      }
    }
    for (let k = 0; k < this.slots.length; k++) {
      const s = this.slots[k];
      if (!s.mesh) continue;
      const ci = k % this.cpc, cj = Math.floor(k / this.cpc);
      s.mesh.visible = Math.abs(ci - cci) <= 3 && Math.abs(cj - ccj) <= 3;
    }
  }

  private buildMesh(ci: number, cj: number, s: WSlot) {
    s.built = true;
    const R = this.R, nf = R.n + 1;
    const m = CH + 1;
    const lvl = new Float32Array(m * m).fill(NaN);
    const iceV = new Float32Array(m * m);
    for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
      const i = ci * CH + a, j = cj * CH + b;
      const v = j * nf + i;
      let L = R.water[v];
      let th = R.ice[v] / 100;
      if (Number.isNaN(L)) {
        // shore vertex: continue the neighbouring water surface under the bank
        let s2 = 0, k = 0, t2 = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = clamp(i + di, 0, R.n), jj = clamp(j + dj, 0, R.n);
          const w = R.water[jj * nf + ii];
          if (!Number.isNaN(w)) {
            s2 += w;
            t2 += R.ice[jj * nf + ii] / 100;
            k++;
          }
        }
        if (k > 0) {
          L = s2 / k;
          th = t2 / k;
        }
      }
      lvl[b * m + a] = L;
      iceV[b * m + a] = th;
    }
    const pos: number[] = [];
    const ice: number[] = [];
    const idx: number[] = [];
    const vid = new Int32Array(m * m).fill(-1);
    const x0 = ci * CH * 2 - R.ox, z0 = cj * CH * 2 - R.oz;
    const get = (a: number, b: number) => {
      const k = b * m + a;
      if (vid[k] < 0) {
        vid[k] = pos.length / 3;
        pos.push(a * 2, lvl[k] + 0.03, b * 2);
        ice.push(iceV[k]);
      }
      return vid[k];
    };
    for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
      const k = b * m + a;
      if (Number.isNaN(lvl[k]) || Number.isNaN(lvl[k + 1]) || Number.isNaN(lvl[k + m]) || Number.isNaN(lvl[k + m + 1])) continue;
      const v0 = get(a, b), v1 = get(a + 1, b), v2 = get(a, b + 1), v3 = get(a + 1, b + 1);
      idx.push(v0, v2, v1, v1, v2, v3);
    }
    if (idx.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aIce', new THREE.Float32BufferAttribute(ice, 1));
    const nrm = new Float32Array(pos.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.position.set(x0, 0, z0);
    mesh.receiveShadow = true;
    mesh.name = 'ice';
    this.group.add(mesh);
    s.mesh = mesh;
  }

  private buildCollider(ti: number, tj: number) {
    const R = this.R, nf = R.n + 1;
    const hf = new Float32Array((CH + 1) * (CH + 1));
    let any = false;
    for (let c = 0; c <= CH; c++) for (let r = 0; r <= CH; r++) {
      const v = (tj * CH + r) * nf + ti * CH + c;
      const L = R.water[v];
      let h: number;
      if (Number.isNaN(L)) h = R.h[v] - 3;
      else if (R.ice[v] > 0) {
        h = L + 0.03;
        any = true;
      } else h = L - 3;
      hf[c * (CH + 1) + r] = h;
    }
    if (!any) return;
    const cx = (ti * CH + CH / 2) * 2 - R.ox, cz = (tj * CH + CH / 2) * 2 - R.oz;
    const col = G.world.createCollider(
      G.R.ColliderDesc.heightfield(CH, CH, hf, { x: CH * 2, y: 1, z: CH * 2 })
        .setTranslation(cx, 0, cz)
        .setFriction(0.15)
        .setCollisionGroups(GROUPS_STATIC),
      this.body,
    );
    this.handles.add(col.handle);
  }
}
