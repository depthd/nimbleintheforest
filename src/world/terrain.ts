// Terrain rendering and collision for the generated region.
// Rendering: 128 m chunks with four levels of detail near the camera plus one low-resolution
// mesh for the whole map (so the view from a hill reaches the far mountains) and a backdrop of
// mountains and sea beyond the border. Collision: one heightfield per 128 m tile.
// The ground shader paints snow, wind-scoured rock on steep slopes, darker snow with needles
// under the forest, ash on burned land, bog grass, shore pebbles, and sparkle in the sun.
import * as THREE from 'three';
import { G, GROUPS_STATIC } from '../game/ctx';
import type { Region } from '../gen/region';
import { Simplex2, clamp, lerp, smoothstep } from '../core/rng';
import { Tex } from '../core/textures';
import { noiseTexture } from '../core/noisetex';
import { snowCoverShader, snowCoverUniforms } from './snow-cover';
import { buildTerrainGeometry, terrainGeometrySteps, terrainLod, type TerrainGeometryData } from './terrain-geometry';
import { splitGridGeometry } from './spatial-geometry';

const CH = 64; // fine cells per chunk side
const NEAR_K = 6; // chunks drawn individually: (2K+1)²

/** uniforms shared by all ground materials (updated by the sky each frame) */
export const groundUniforms = {
  uOrigin: { value: new THREE.Vector2() },
  uSize: { value: 1 },
  uBiome: { value: null as THREE.Texture | null },
  uWaterTex: { value: null as THREE.Texture | null },
  uNoise: { value: null as THREE.Texture | null },
  uRock: { value: null as THREE.Texture | null },
  uTreeline: { value: 160 },
  uTerrainLoaded: { value: null as THREE.Texture | null },
  uTerrainGrid: { value: 1 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uGlint: { value: 1 },
  uForestFar: { value: new THREE.Vector2(380, 620) },
  uWorldSnow: { value: 0 },
  uSnowPatch: { value: new THREE.Vector4() },
  uSnowTiles: { value: null as THREE.Texture | null },
  uSnowTileGrid: { value: new THREE.Vector4() },
};

function ridged(n: Simplex2, x: number, y: number, oct: number) {
  let s = 0, a = 0.5, f = 1, prev = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    let v = 1 - Math.abs(n.noise(x * f, y * f));
    v *= v;
    s += v * a * prev;
    norm += a;
    prev = v;
    f *= 2.1;
    a *= 0.5;
  }
  return s / norm;
}

/** Boulders, pillars and the backdrop share the ground shader but are not ground:
 * a negative loose depth keeps the snow-cover and trail masks from discarding them. */
export function solidGroundGeometry(g: THREE.BufferGeometry) {
  g.setAttribute('aSnowDepth', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(-1), 1));
  g.setAttribute('aSnowNormal', g.attributes.normal);
  return g;
}

export function makeGroundMaterial(far: boolean, snowSurface = false, packedBase = false) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  m.defines = far ? { FAR_TERRAIN: 1 } : {};
  if (snowSurface) m.defines.SNOW_SURFACE = 1;
  if (packedBase) m.defines.PACKED_SNOW_BASE = 1;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, groundUniforms, snowCoverUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\n#ifndef SNOW_SURFACE\nattribute float aSnowDepth; attribute vec3 aSnowNormal; varying float vLooseDepth;\n#endif')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n#if !defined(SNOW_SURFACE) && !defined(PACKED_SNOW_BASE)\nobjectNormal=aSnowNormal;\n#endif')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifndef SNOW_SURFACE\nvLooseDepth=aSnowDepth;\n#ifndef PACKED_SNOW_BASE\ntransformed.y+=max(0.0,aSnowDepth);\n#endif\n#endif')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvec4 wp4 = vec4(transformed, 1.0);\nvec3 wn3 = normal;\n#ifdef USE_INSTANCING\nwp4 = instanceMatrix * wp4;\nwn3 = mat3(instanceMatrix) * wn3;\n#endif\nvWPos = (modelMatrix * wp4).xyz;\nvWNorm = normalize(mat3(modelMatrix) * wn3);',
      );
    sh.fragmentShader = sh.fragmentShader
      // This Three.js version rotates its PCF kernel using screen-pixel noise.
      // On clean snow it becomes visible hatching; a stable kernel keeps the
      // same five hardware-filtered samples without the per-pixel rotation.
      .replace('#include <shadowmap_pars_fragment>',THREE.ShaderChunk.shadowmap_pars_fragment.replace('float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;','float phi = 0.0;'))
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
varying vec3 vWPos;
varying vec3 vWNorm;
#ifndef SNOW_SURFACE
varying float vLooseDepth;
#endif
${snowCoverShader}
uniform vec2 uOrigin; uniform float uSize; uniform sampler2D uBiome; uniform sampler2D uWaterTex; uniform sampler2D uNoise; uniform sampler2D uRock;
uniform float uTreeline; uniform sampler2D uTerrainLoaded; uniform float uTerrainGrid; uniform vec3 uSunDir; uniform float uGlint; uniform vec2 uForestFar;
uniform float uWorldSnow; uniform vec4 uSnowPatch; uniform sampler2D uSnowTiles; uniform vec4 uSnowTileGrid;
vec3 triRock(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(uRock, p.yz).rgb * w.x + texture2D(uRock, p.xz).rgb * w.y + texture2D(uRock, p.xy).rgb * w.z;
}`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
#ifdef FAR_TERRAIN
  vec2 terrainCell = floor((vWPos.xz + uOrigin) / 128.0);
  if (all(greaterThanEqual(terrainCell,vec2(0.0))) && all(lessThan(terrainCell,vec2(uTerrainGrid)))
    && texture2D(uTerrainLoaded,(terrainCell+0.5)/uTerrainGrid).r>0.5) discard;
#endif
  if (uSnowCoverEnabled>0.5) {
#ifndef SNOW_SURFACE
    if (vLooseDepth>=0.0) {
#endif
      vec2 shelter=snowCover(vWPos);
      if (shelter.y>0.5) discard;
#ifndef PACKED_SNOW_BASE
      if (shelter.x<=0.001) discard;
#ifndef SNOW_SURFACE
      if (vLooseDepth<0.003) discard;
#endif
#endif
#ifndef SNOW_SURFACE
    }
#endif
  }
  vec2 uvB = (vWPos.xz + uOrigin) / uSize;
  vec4 bio = texture2D(uBiome, uvB);
  vec3 N = normalize(vWNorm);
  float slope = 1.0 - N.y;
  vec4 nz1 = texture2D(uNoise, vWPos.xz * 0.0071);
  vec4 nz2 = texture2D(uNoise, vWPos.xz * 0.061);
  vec4 nz3 = texture2D(uNoise, vWPos.xz * 0.53);
  float camDist = length(cameraPosition - vWPos);
  // snow: slight dunes and blue-white variation
  vec3 snow = vec3(0.92, 0.945, 0.975) * (0.95 + 0.07 * nz1.r + 0.03 * nz2.g);
  // under the forest: darker, with needles and twigs
  float debris = smoothstep(0.6, 0.82, nz3.b) * (1.0 - smoothstep(30.0, 80.0, camDist));
  snow = mix(snow, snow * vec3(0.84, 0.86, 0.88), bio.r * 0.6);
  snow = mix(snow, vec3(0.36, 0.31, 0.26), bio.r * debris * 0.45);
  // burned land: grey snow, black specks
  snow = mix(snow, vec3(0.6, 0.6, 0.61), bio.g * (0.35 + 0.25 * nz2.r));
  snow = mix(snow, vec3(0.08, 0.075, 0.07), bio.g * smoothstep(0.55, 0.75, nz3.g) * 0.75);
  // bog: yellow sedge tufts through the snow
  float tuft = smoothstep(0.58, 0.78, nz3.a) * smoothstep(0.35, 0.65, nz2.b);
  snow = mix(snow, vec3(0.6, 0.52, 0.32), bio.b * tuft * 0.75);
  // shore: pebbles and grey sand where the snow is thin
  float peb = bio.a * smoothstep(0.45, 0.7, nz2.a) * (0.6 + 0.4 * nz3.r);
  snow = mix(snow, vec3(0.5, 0.48, 0.45) * (0.7 + 0.5 * nz3.g), peb * 0.75);
#if !defined(SNOW_SURFACE) && !defined(PACKED_SNOW_BASE)
  // Trail tiles replace only the ground surface; boulders and pillars opt out.
  if (uWorldSnow > 0.5 && vLooseDepth >= 0.0) {
    vec2 tile = floor(vWPos.xz / 3.2) - uSnowTileGrid.xy;
    if (texture2D(uSnowTiles, (tile + 0.5) / uSnowTileGrid.zw).r > 0.5) discard;
  }
#endif
  // rock: steep slopes are bare, ledges keep snow; high ground is wind-scoured
#ifdef PACKED_SNOW_BASE
  snow=vec3(0.78,0.86,0.93)*(0.96+0.05*nz3.r);
#elif !defined(SNOW_SURFACE)
  if(uSnowCoverEnabled>0.5 && vLooseDepth>=0.0) {
    vec3 packedSnow=vec3(0.78,0.86,0.93)*(0.96+0.05*nz3.r);
    snow=mix(packedSnow,snow,smoothstep(0.005,0.05,vLooseDepth)*smoothstep(0.005,0.20,vLooseDepth));
  }
#endif
  float rockK = smoothstep(0.33 + 0.06 * nz2.r, 0.45 + 0.04 * nz2.g, slope);
  rockK = max(rockK, smoothstep(uTreeline + 60.0, uTreeline + 180.0, vWPos.y) * smoothstep(0.2, 0.34, slope));
  // snow clings in streaks and gullies even on steep rock
  rockK *= 1.0 - 0.55 * smoothstep(0.45, 0.7, nz2.a * 0.6 + nz1.b * 0.5) * (1.0 - smoothstep(0.55, 0.8, slope));
  // the same dark, cool stone as the rock blocks (world/cliffs.ts), barely textured
  vec3 rock = vec3(0.085, 0.092, 0.125) * (0.72 + 1.6 * triRock(vWPos * 0.06, N)) * (0.88 + 0.24 * nz2.b);
  vec3 col = mix(snow, rock, rockK);
  // distant forest canopy: dark green-grey seen from afar (the trees themselves stop drawing)
  float farF = smoothstep(uForestFar.x, uForestFar.y, camDist);
  col = mix(col, vec3(0.13, 0.17, 0.15) * (0.85 + 0.3 * nz2.r), bio.r * farF * 0.85);
  // far lakes and sea seen as ice / dark water (near ones have their own meshes)
  vec4 wt = texture2D(uWaterTex, uvB);
  float wet = step(-500.0, wt.r) * step(vWPos.y, wt.r - 0.25) * smoothstep(250.0, 350.0, camDist);
  vec3 iceCol = mix(vec3(0.08, 0.14, 0.2), vec3(0.86, 0.9, 0.94) * (0.94 + 0.08 * nz1.b), smoothstep(0.0, 0.08, wt.g));
  col = mix(col, iceCol, wet);
  rockK *= 1.0 - wet;
  diffuseColor.rgb = col;
`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.82, 0.95, rockK);',
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
  {
    // sun glints on the snow
    vec3 V = normalize(cameraPosition - vWPos);
    vec3 cell = floor(vWPos * 70.0);
    float rnd = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec3 facet = normalize(N * 1.5 + (vec3(fract(rnd * 13.1), fract(rnd * 7.7), fract(rnd * 3.3)) - 0.5));
    float g = pow(max(dot(reflect(-uSunDir, facet), V), 0.0), 800.0) * step(0.7, rnd);
    // only in direct sun: lit surfaces are brighter than the ambient-only shade
    float lit = smoothstep(0.55, 0.9, dot(outgoingLight, vec3(0.333)) / max(0.05, dot(diffuseColor.rgb, vec3(0.333))));
    g *= (1.0 - rockK) * uGlint * lit * (1.0 - smoothstep(6.0, 28.0, camDist));
    outgoingLight += vec3(g * 1.2);
  }
#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => (far ? 'ground-far' : snowSurface ? 'ground-snow-surface' : 'ground') + (packedBase ? '-packed-v2' : '-cover-v2');
  return m;
}

interface Slot {
  ci: number;
  cj: number;
  mesh: THREE.Mesh | null;
  base?: THREE.Mesh;
  geos: (THREE.BufferGeometry | null)[];
  lod: number;
  desired: number;
  near: boolean;
  minY: number;
  maxY: number;
}

export class Terrain {
  private snowHeightAt: ((x: number, z: number) => number) | null = null;
  private snowDetailedAt: ((x: number,z: number,size: number) => boolean) | null = null;
  private snowDepthMaterial: THREE.MeshDepthMaterial | null = null;
  private packedDepthMaterial: THREE.MeshDepthMaterial | null = null;
  private packedMaterial: THREE.MeshStandardMaterial | null = null;
  R: Region;
  size: number;
  n: number;
  houseY: number;
  handles = new Set<number>();
  mat!: THREE.MeshStandardMaterial;
  farMat!: THREE.MeshStandardMaterial;
  far!: THREE.Mesh;
  backdrop!: THREE.Group;
  private slots: Slot[] = [];
  private loaded!: THREE.DataTexture;
  private loadedCells!: Uint8Array;
  private background = false;
  private worker: Worker | null = null;
  private workerRevision = -1;
  private nextJobId = 0;
  private pending: { id: number; ci: number; cj: number; lod: number; revision: number } | null = null;
  private fallback: Generator<void, TerrainGeometryData> | null = null;
  private ready: { ci: number; cj: number; lod: number; revision: number; geometry: TerrainGeometryData } | null = null;
  private completedJobs = 0;
  private discardedJobs = 0;
  private cpc: number; // chunks per side
  private group = new THREE.Group();

  constructor(R: Region) {
    this.R = R;
    this.size = R.size;
    this.n = R.n;
    this.houseY = R.sites.house.y;
    this.cpc = R.n / CH;
  }

  heightAt(x: number, z: number) {
    return this.R.heightAt(x, z);
  }
  enableSnow(height: (x: number, z: number) => number, detailed?: (x:number,z:number,size:number)=>boolean) {
    this.snowHeightAt = height;
    this.snowDetailedAt = detailed ?? null;
    this.packedMaterial = makeGroundMaterial(false,false,true);
    const depth=(packed:boolean)=>{
      const material=new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      material.onBeforeCompile=sh=>{
        Object.assign(sh.uniforms,snowCoverUniforms,{uSnowTiles:groundUniforms.uSnowTiles,uSnowTileGrid:groundUniforms.uSnowTileGrid});
        sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float aSnowDepth; varying float vLooseDepth; varying vec3 vSnowWorld;')
          .replace('#include <begin_vertex>',`#include <begin_vertex>\nvLooseDepth=aSnowDepth; ${packed?'':'transformed.y+=max(0.0,aSnowDepth);'}`)
          .replace('#include <project_vertex>','#include <project_vertex>\nvSnowWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
        sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying float vLooseDepth; varying vec3 vSnowWorld; uniform sampler2D uSnowTiles; uniform vec4 uSnowTileGrid;\n'+snowCoverShader)
          .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
            vec2 cover=snowCover(vSnowWorld); if(cover.y>0.5)discard;
            ${packed?'':`if(vLooseDepth<0.003 || cover.x<=0.001)discard;
              if(texture2D(uSnowTiles,(floor(vSnowWorld.xz/3.2)-uSnowTileGrid.xy+0.5)/uSnowTileGrid.zw).r>0.5)discard;`}`);
      };
      material.customProgramCacheKey=()=>packed?'terrain-packed-depth-v1':'terrain-loose-depth-v2';return material;
    };
    this.snowDepthMaterial=depth(false);this.packedDepthMaterial=depth(true);
    // Both surfaces share immutable positions. Only the loose material applies
    // aSnowDepth; the packed surface remains below it and fills excavated areas.
    for (const s of this.slots) {
      for(let lod=0;lod<s.geos.length;lod++) if(s.geos[lod]) {this.disposeGeometry(s.geos[lod]!);s.geos[lod]=this.makeGeometry(s.ci,s.cj,lod);}
      if(s.mesh){s.mesh.geometry=s.geos[s.lod]!;s.mesh.customDepthMaterial=this.snowDepthMaterial;this.attachBase(s);}
    }
    this.snowAttributes(this.far.geometry,0,0,false);
    const farBase=new THREE.Mesh(this.far.geometry,makeGroundMaterial(true,false,true));
    farBase.frustumCulled=false;farBase.name='packed-snow-far';this.far.add(farBase);
    this.startBackgroundMeshing();
  }
  private attachBase(s:Slot) {
    if(!this.packedMaterial || !s.mesh || s.base)return;
    s.base=new THREE.Mesh(s.mesh.geometry.userData.packedGeometry ?? s.mesh.geometry,this.packedMaterial);s.base.name='packed-snow';
    s.base.receiveShadow=true;s.base.castShadow=s.lod<=1;s.base.customDepthMaterial=this.packedDepthMaterial!;
    s.mesh.add(s.base);
  }
  private disposeGeometry(g:THREE.BufferGeometry) { (g.userData.packedGeometry as THREE.BufferGeometry | undefined)?.dispose();g.dispose(); }
  private snowAttributes(g:THREE.BufferGeometry,offsetX:number,offsetZ:number,normals=true) {
    const p=g.attributes.position,n=g.attributes.normal,depth=new Float32Array(p.count),normal=Float32Array.from(n.array);
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i)+offsetX,z=p.getZ(i)+offsetZ;
      depth[i]=this.snowHeightAt?.(x,z) ?? 0;
      if(normals && this.snowHeightAt) {
        const e=.1,dx=(this.snowHeightAt(x+e,z)-this.snowHeightAt(x-e,z))/(2*e),dz=(this.snowHeightAt(x,z+e)-this.snowHeightAt(x,z-e))/(2*e);
        const nx=n.getX(i)/Math.max(.01,n.getY(i))-dx,nz=n.getZ(i)/Math.max(.01,n.getY(i))-dz,len=Math.hypot(nx,1,nz);
        normal[i*3]=nx/len;normal[i*3+1]=1/len;normal[i*3+2]=nz/len;
      }
    }
    g.setAttribute('aSnowDepth',new THREE.BufferAttribute(depth,1));g.setAttribute('aSnowNormal',new THREE.BufferAttribute(normal,3));
  }

  build() {
    const R = this.R;
    const U = groundUniforms;
    U.uOrigin.value.set(R.ox, R.oz);
    U.uSize.value = R.size;
    U.uTreeline.value = R.treeline;
    // biome look texture (coarse grid)
    const bt = new THREE.DataTexture(R.tex, R.cn + 1, R.cn + 1, THREE.RGBAFormat);
    bt.magFilter = bt.minFilter = THREE.LinearFilter;
    bt.wrapS = bt.wrapT = THREE.ClampToEdgeWrapping;
    bt.needsUpdate = true;
    U.uBiome.value = bt;
    U.uNoise.value = noiseTexture();
    const rock = Tex.rock();
    U.uRock.value = rock;
    // far water: level and ice per coarse vertex
    const nc = R.cn + 1;
    const wd = new Float32Array(nc * nc * 4);
    for (let j = 0; j < nc; j++) for (let i = 0; i < nc; i++) {
      const x = i * R.cc - R.ox, z = j * R.cc - R.oz;
      const w = R.waterAt(x, z);
      const o = (j * nc + i) * 4;
      wd[o] = Number.isNaN(w) ? -1000 : w;
      wd[o + 1] = Number.isNaN(w) ? 0 : R.iceAt(x, z);
    }
    const wt = new THREE.DataTexture(wd, nc, nc, THREE.RGBAFormat, THREE.FloatType);
    wt.magFilter = wt.minFilter = THREE.NearestFilter;
    wt.needsUpdate = true;
    U.uWaterTex.value = wt;

    this.mat = makeGroundMaterial(false);
    this.farMat = makeGroundMaterial(true);
    G.scene.add(this.group);

    this.loadedCells = new Uint8Array(this.cpc * this.cpc);
    this.loaded = new THREE.DataTexture(this.loadedCells, this.cpc, this.cpc, THREE.RedFormat);
    this.loaded.minFilter = this.loaded.magFilter = THREE.NearestFilter;
    this.loaded.needsUpdate = true;
    U.uTerrainLoaded.value = this.loaded; U.uTerrainGrid.value = this.cpc;
    for (let cj = 0; cj < this.cpc; cj++) for (let ci = 0; ci < this.cpc; ci++) {
      const { minY, maxY } = this.chunkRange(ci, cj);
      this.slots.push({ ci, cj, mesh: null, geos: [null, null, null, null], lod: -1, desired: -1, near: false, minY, maxY });
    }
    this.buildPhysics();
    this.buildFar();
    this.buildBackdrop();
  }

  private chunkRange(ci: number, cj: number) {
    const H = this.R.h, nf = this.n + 1;
    let mn = Infinity, mx = -Infinity;
    for (let j = cj * CH; j <= (cj + 1) * CH; j += 4) for (let i = ci * CH; i <= (ci + 1) * CH; i += 4) {
      const h = H[j * nf + i];
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
    return { minY: mn - 4, maxY: mx + 2 };
  }

  private snowSource() {
    return this.snowHeightAt ? { heightAt: this.snowHeightAt, detailedAt: this.snowDetailedAt ?? undefined } : undefined;
  }

  private geometryFromData(data: TerrainGeometryData, ci: number, cj: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    g.setAttribute('aSnowDepth', new THREE.BufferAttribute(data.depth, 1));
    g.setAttribute('aSnowNormal', new THREE.BufferAttribute(data.snowNormal, 3));
    g.setIndex(new THREE.BufferAttribute(data.index, 1));
    const slot = this.slots[cj * this.cpc + ci];
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, slot.minY, 0), new THREE.Vector3(CH * 2, slot.maxY, CH * 2));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    if (data.packed) {
      const packed = new THREE.BufferGeometry();
      packed.setAttribute('position', new THREE.BufferAttribute(data.packed.position, 3));
      packed.setAttribute('normal', new THREE.BufferAttribute(data.packed.normal, 3));
      packed.setAttribute('aSnowDepth', new THREE.BufferAttribute(new Float32Array(data.packed.position.length / 3), 1));
      packed.setIndex(new THREE.BufferAttribute(data.packed.index, 1));
      packed.boundingBox = g.boundingBox; packed.boundingSphere = g.boundingSphere;
      g.userData.packedGeometry = packed;
    }
    return g;
  }

  private makeGeometry(ci: number, cj: number, lod: number) {
    return this.geometryFromData(buildTerrainGeometry(this.R, ci, cj, lod, this.snowSource()), ci, cj);
  }

  private startBackgroundMeshing() {
    this.background = true;
    if (typeof Worker === 'undefined') return;
    try {
      const worker = new Worker(new URL('./terrain-worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = ({ data }) => {
        if (data.id !== this.pending?.id) return;
        this.ready = data; this.pending = null; this.completedJobs++;
      };
      const fail = (event?: Event) => {
        // A blocked/unsupported worker uses the very same generator, spread
        // across frames. Never fall back to an unbounded synchronous chunk.
        event?.preventDefault(); worker.terminate(); this.worker = null;
        if (this.pending) this.fallback = terrainGeometrySteps(this.R, this.pending.ci, this.pending.cj, this.pending.lod, this.snowSource());
      };
      worker.onerror = fail;
      worker.onmessageerror = fail;
      const r = this.R;
      this.workerRevision = G.snowCover.revision;
      // Structured clone intentionally leaves the live height/water buffers
      // attached: Rapier, snow and gameplay continue using them on this thread.
      worker.postMessage({ type: 'init', region: { h: r.h, water: r.water, n: r.n, size: r.size, ox: r.ox, oz: r.oz },
        zones: G.snowCover.zones, revision: this.workerRevision });
    } catch { this.worker?.terminate(); this.worker = null; }
  }

  private requestGeometry(slot: Slot) {
    const job = { id: ++this.nextJobId, ci: slot.ci, cj: slot.cj, lod: slot.desired, revision: G.snowCover.revision };
    this.pending = job;
    if (this.worker) {
      const zones = job.revision !== this.workerRevision ? G.snowCover.zones : undefined;
      this.workerRevision = job.revision;
      try { this.worker.postMessage({ ...job, zones }); }
      catch {
        this.worker.terminate(); this.worker = null;
        this.fallback = terrainGeometrySteps(this.R, job.ci, job.cj, job.lod, this.snowSource());
      }
    } else this.fallback = terrainGeometrySteps(this.R, job.ci, job.cj, job.lod, this.snowSource());
  }

  private advanceFallback() {
    if (!this.fallback || !this.pending) return;
    const deadline = performance.now() + 1.5;
    do {
      const next = this.fallback.next();
      if (next.done) {
        this.ready = { ...this.pending, geometry: next.value };
        this.pending = null; this.fallback = null; this.completedJobs++; return;
      }
    } while (performance.now() < deadline);
  }

  streamingStats() {
    return { worker: !!this.worker, pending: !!this.pending, completed: this.completedJobs, discarded: this.discardedJobs,
      readyChunks: this.loadedCells.reduce((n, v) => n + (v ? 1 : 0), 0) };
  }

  private buildPhysics() {
    const R = this.R, H = R.h, nf = this.n + 1;
    const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
    for (let tj = 0; tj < this.cpc; tj++) for (let ti = 0; ti < this.cpc; ti++) {
      const hf = new Float32Array((CH + 1) * (CH + 1));
      for (let c = 0; c <= CH; c++) for (let r = 0; r <= CH; r++) hf[c * (CH + 1) + r] = H[(tj * CH + r) * nf + ti * CH + c];
      const cx = (ti * CH + CH / 2) * 2 - R.ox, cz = (tj * CH + CH / 2) * 2 - R.oz;
      const col = G.world.createCollider(
        G.R.ColliderDesc.heightfield(CH, CH, hf, { x: CH * 2, y: 1, z: CH * 2 })
          .setTranslation(cx, 0, cz)
          .setFriction(0.9)
          .setCollisionGroups(GROUPS_STATIC),
        body,
      );
      this.handles.add(col.handle);
    }
  }

  private buildFar() {
    const R = this.R, s = 8;
    const m = this.n / s + 1;
    const g = new THREE.PlaneGeometry(R.size, R.size, m - 1, m - 1);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k) + R.size / 2 - R.ox, z = pos.getZ(k) + R.size / 2 - R.oz;
      pos.setXYZ(k, x, R.heightAt(x, z) - 0.3, z);
    }
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.snowAttributes(g,0,0,false);
    this.far = new THREE.Mesh(g, this.farMat);
    this.far.receiveShadow = false;
    this.far.frustumCulled = false;
    this.far.name = 'terrain-far';
    G.scene.add(this.far);
  }

  /** Mountains and sea beyond the border, so the horizon is never empty. */
  private buildBackdrop() {
    const R = this.R;
    const W = 7000, step = 32;
    const x0 = -W, x1 = R.size + W;
    const m = Math.round((x1 - x0) / step) + 1;
    const noise = new Simplex2(() => 0.37);
    const pos: number[] = [];
    const sea = R.seaSide;
    for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
      const gx = x0 + a * step, gy = x0 + b * step;
      const cx = clamp(gx, 0, R.size), cy = clamp(gy, 0, R.size);
      const out = Math.hypot(gx - cx, gy - cy);
      const edgeH = R.heightAt(cx - R.ox, cy - R.oz);
      let h: number;
      // which side are we beyond?
      const side = gy < 0 ? 0 : gy > R.size ? 1 : gx < 0 ? 2 : gx > R.size ? 3 : -1;
      const towardsSea = side === sea || (side >= 0 && ((sea === 0 && gy < 0) || (sea === 1 && gy > R.size) || (sea === 2 && gx < 0) || (sea === 3 && gx > R.size)));
      if (out <= 0) h = edgeH - 12;
      else if (towardsSea) {
        // open sea, a few far islands
        const isl = Math.max(0, ridged(noise, gx / 2400, gy / 2400, 4) - 0.62) * 600 * smoothstep(1500, 3000, out);
        h = lerp(edgeH, -40, smoothstep(0, 400, out)) + isl;
      } else {
        const mount = 180 + 700 * Math.pow(ridged(noise, gx / 2600, gy / 2600, 4), 1.4) * smoothstep(0, 2500, out);
        h = lerp(edgeH, mount, smoothstep(0, 900, out));
      }
      pos.push(gx - R.ox, h, gy - R.oz);
    }
    const idx: number[] = [];
    for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
      const v = b * m + a;
      // skip quads entirely inside the map
      const gx = x0 + a * step, gy = x0 + b * step;
      if (gx >= 0 && gy >= 0 && gx + step <= R.size && gy + step <= R.size) continue;
      idx.push(v, v + m, v + 1, v + 1, v + m, v + m + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    solidGroundGeometry(g);
    // Preserve the exact horizon mesh and shared normals, but submit only the
    // spatial tiles intersecting the camera instead of the entire 17 km ring.
    this.backdrop = new THREE.Group();
    for (const tile of splitGridGeometry(g, m - 1)) this.backdrop.add(new THREE.Mesh(tile, this.farMat));
    this.backdrop.name = 'backdrop';
    G.scene.add(this.backdrop);
  }

  /** Pick existing geometry immediately; request missing geometry off-thread.
   * Explicit bulk budgets are reserved for loading/teleport inspection tools. */
  update(cam: THREE.Vector3, budget = 6) {
    const R = this.R, cs = CH * 2, synchronous = !this.background || budget > 6;
    const cci = clamp(Math.floor((cam.x + R.ox) / cs), 0, this.cpc - 1);
    const ccj = clamp(Math.floor((cam.z + R.oz) / cs), 0, this.cpc - 1);
    const i0 = Math.max(0, cci - NEAR_K), i1 = Math.min(this.cpc - 1, cci + NEAR_K);
    const j0 = Math.max(0, ccj - NEAR_K), j1 = Math.min(this.cpc - 1, ccj + NEAR_K);
    let wanted: Slot | null = null, closest = Infinity, maskChanged = false;
    for (const s of this.slots) s.near = s.ci >= i0 && s.ci <= i1 && s.cj >= j0 && s.cj <= j1;
    if (this.ready) {
      const data = this.ready, s = this.slots[data.cj * this.cpc + data.ci];
      if (s.near && !s.geos[data.lod] && data.revision === G.snowCover.revision)
        s.geos[data.lod] = this.geometryFromData(data.geometry, data.ci, data.cj);
      else this.discardedJobs++;
      this.ready = null;
    }
    for (let k = 0; k < this.slots.length; k++) {
      const s = this.slots[k];
      if (!s.near) {
        if (s.mesh) s.mesh.visible = false;
        if (s.mesh && s.lod < 2) { this.group.remove(s.mesh); s.mesh = null; s.base = undefined; s.lod = -1; }
        for (let l = 0; l < 2; l++) if (s.geos[l]) { this.disposeGeometry(s.geos[l]!); s.geos[l] = null; }
        s.desired = -1;
        if (this.loadedCells[k]) { this.loadedCells[k] = 0; maskChanged = true; }
        continue;
      }
      const x0 = s.ci * cs - R.ox, z0 = s.cj * cs - R.oz;
      const dx = Math.max(x0 - cam.x, 0, cam.x - x0 - cs), dz = Math.max(z0 - cam.z, 0, cam.z - z0 - cs);
      const dy = Math.max(s.minY - cam.y, 0, cam.y - s.maxY), d = Math.hypot(dx, dz, dy * .5);
      s.desired = terrainLod(d, s.desired);
      let lod = s.desired;
      if (!s.geos[lod]) {
        if (synchronous && (budget > 0 || lod === 3)) { s.geos[lod] = this.makeGeometry(s.ci, s.cj, lod); budget--; }
        else {
          if (d < closest) { closest = d; wanted = s; }
          // Keep the previous surface until its replacement is ready. A new
          // chunk uses the far map, whose mask changes only after installation.
          lod = s.lod >= 0 && s.geos[s.lod] ? s.lod : s.geos.findIndex(g => g !== null);
        }
      }
      if (lod < 0) continue;
      if (!s.mesh) {
        s.mesh = new THREE.Mesh(s.geos[lod]!, this.mat); s.mesh.position.set(x0, 0, z0);
        s.mesh.receiveShadow = true; s.mesh.name = 'terrain';
        if (this.snowDepthMaterial) s.mesh.customDepthMaterial = this.snowDepthMaterial;
        this.group.add(s.mesh); this.attachBase(s);
      }
      if (s.lod !== lod) {
        s.mesh.geometry = s.geos[lod]!; s.lod = lod; s.mesh.castShadow = lod <= 1;
        if (s.base) { s.base.geometry = s.geos[lod]!.userData.packedGeometry ?? s.geos[lod]!; s.base.castShadow = lod <= 1; }
      }
      s.mesh.visible = true;
      if (!this.loadedCells[k]) { this.loadedCells[k] = 255; maskChanged = true; }
    }
    if (maskChanged) this.loaded.needsUpdate = true;
    if (!synchronous) {
      if (!this.pending && wanted) this.requestGeometry(wanted);
      this.advanceFallback();
    }
  }
}
