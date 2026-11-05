// Persistent world tiles. Distance changes relief continuously, never the trail's
// footprint. Far tiles retain the same filtered material texture and lighting.
import * as THREE from 'three';
import { CELL, TILE_CELLS, TILE_SIZE, SnowField } from './snow-field';
import type { SnowRect } from './snow-field';
import { makeGroundMaterial, groundUniforms } from './terrain';
import { snowCoverShader, snowCoverUniforms } from './snow-cover';

const SIZE = TILE_CELLS + 5, RAW = SIZE + 4;
const shader = /* glsl */ `
uniform sampler2D uTrail; uniform vec2 uTrailOrigin; uniform float uTrailBase;
uniform vec3 uTrailEye;
uniform float uTrailMorph; uniform float uTrailCoarseStep;
vec4 trail(vec2 p) { return texture2D(uTrail, (p / 0.04 + 2.5) / 85.0); }
float detail(vec2 p) { return 1.0 - smoothstep(8.0, 18.0, distance(p + uTrailOrigin, uTrailEye.xz)); }
float trailHeight(vec2 p, bool relief) { vec4 t = trail(p); return t.r + t.g + (relief ? t.b * detail(p) : 0.0); }
float trailSurfaceHeight(vec2 p) {
  float h = trailHeight(p, true);
  if (uTrailMorph <= 0.0) return h;
  // Become the next mesh's actual triangles before changing geometry. Sampling
  // only its bilinear height would still pop along each quad's diagonal.
  vec2 grid = (p + 0.06) / uTrailCoarseStep, f = fract(grid);
  vec2 a = floor(grid) * uTrailCoarseStep - 0.06;
  float b = trailHeight(a + vec2(uTrailCoarseStep, 0.0), true);
  float c = trailHeight(a + vec2(0.0, uTrailCoarseStep), true);
  float coarse;
  if (f.x + f.y <= 1.0) {
    float v = trailHeight(a, true);
    coarse = v + (b-v)*f.x + (c-v)*f.y;
  } else {
    float v = trailHeight(a + vec2(uTrailCoarseStep), true);
    coarse = v + (c-v)*(1.0-f.x) + (b-v)*(1.0-f.y);
  }
  return mix(h, coarse, uTrailMorph);
}
vec3 trailNormal(vec2 p, bool relief) {
  float e = 0.025;
  vec4 a=trail(p+vec2(e,0)), b=trail(p-vec2(e,0)), c=trail(p+vec2(0,e)), d=trail(p-vec2(0,e));
  float dx = a.r+a.g-b.r-b.g + (relief ? a.b-b.b : 0.0);
  float dz = c.r+c.g-d.r-d.g + (relief ? c.b-d.b : 0.0);
  return normalize(vec3(-dx, 2.0*e, -dz));
}
void trailVertexNormals(vec2 p, out vec3 reliefNormal, out vec3 baseNormal) {
  // Shadow bias needs the relief normal; biome selection needs the immutable
  // base normal. Reuse their four samples instead of fetching the texture twice.
  float e = 0.025;
  vec4 a=trail(p+vec2(e,0)), b=trail(p-vec2(e,0)), c=trail(p+vec2(0,e)), d=trail(p-vec2(0,e));
  float dx = a.r+a.g-b.r-b.g, dz = c.r+c.g-d.r-d.g;
  // Biome/rock selection follows the original terrain, not the snow's shore
  // taper. Otherwise even a gentle coverage edge can turn into a dark rock wall.
  baseNormal = normalize(vec3(-(a.r-b.r), 2.0*e, -(c.r-d.r)));
  reliefNormal = normalize(vec3(-(dx+(a.b-b.b)), 2.0*e, -(dz+(c.b-d.b))));
}`;
class TrailMesh extends THREE.Mesh { boundingSphere = new THREE.Sphere(); }
interface Entry { x: number; z: number; signature: string; exposure: number; base: number;
  mesh: TrailMesh; texture: THREE.DataTexture; pixels: Uint16Array;
  morph: { value: number }; coarseStep: { value: number };
  active: Uint8Array; activeCount: number; minY: number; maxY: number; }

export class SnowTrailRenderer {
  readonly group = new THREE.Group();
  private entries = new Map<string, Entry>();
  // Refreshes are sequential; scratch stencils are shared by every trail tile.
  private raw = new Float32Array(RAW * RAW);
  private packed = new Float32Array(RAW * RAW);
  private empty = new Map<string, { signature: string; exposure: number }>();
  private fine = this.geometry(160);
  private medium = this.geometry(80);
  private coarse = this.geometry(40);
  private far = this.geometry(8);
  private eye = { value: new THREE.Vector3() };
  private previousField: SnowField;
  private mask: THREE.DataTexture;
  private maskPixels: Uint8Array;
  private origin: THREE.Vector2;
  private width: number;
  updatedVertices = 0;
  constructor(public field: SnowField, bounds: SnowRect) {
    this.previousField = field;
    this.origin = new THREE.Vector2(Math.floor(bounds.minX / TILE_SIZE), Math.floor(bounds.minZ / TILE_SIZE));
    this.width = Math.ceil(bounds.maxX / TILE_SIZE) - this.origin.x + 1;
    const height = Math.ceil(bounds.maxZ / TILE_SIZE) - this.origin.y + 1;
    this.maskPixels = new Uint8Array(this.width * height);
    this.mask = new THREE.DataTexture(this.maskPixels, this.width, height, THREE.RedFormat);
    this.mask.magFilter = this.mask.minFilter = THREE.NearestFilter; this.mask.needsUpdate = true;
    groundUniforms.uSnowTiles.value = this.mask;
    groundUniforms.uSnowTileGrid.value.set(this.origin.x, this.origin.y, this.width, height);
    this.group.name = 'snow-trails';
  }
  private geometry(cells: number) {
    // Cover the multisample footprint of pixels straddling the terrain cutout.
    // Texture guard samples extend 8 cm beyond each edge; 6 cm of overlap avoids
    // uncovered MSAA samples at distant/grazing views without stretching the UVs.
    const g = new THREE.PlaneGeometry(TILE_SIZE + 0.12, TILE_SIZE + 0.12, cells, cells);
    g.rotateX(-Math.PI / 2); g.translate(TILE_SIZE / 2, 0, TILE_SIZE / 2); return g;
  }
  private signature(x: number, z: number) {
    let s = '';
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) s += `${this.field.tileRevision(x + dx, z + dz)},`;
    return s;
  }
  private setMask(e: Entry, visible: boolean) {
    const i = (e.z - this.origin.y) * this.width + e.x - this.origin.x;
    if (this.maskPixels[i] !== +visible * 255) { this.maskPixels[i] = +visible * 255; this.mask.needsUpdate = true; }
  }
  private create(x: number, z: number): Entry {
    const pixels = new Uint16Array(SIZE * SIZE * 4);
    const texture = new THREE.DataTexture(pixels, SIZE, SIZE, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    const base = this.field.baseHeight(x * TILE_SIZE, z * TILE_SIZE);
    const morph = { value: 0 }, coarseStep = { value: (TILE_SIZE + 0.12) / 80 };
    const uniforms = { uTrail: { value: texture }, uTrailOrigin: { value: new THREE.Vector2(x * TILE_SIZE, z * TILE_SIZE) },
      uTrailBase: { value: base }, uTrailEye: this.eye, uTrailMorph: morph, uTrailCoarseStep: coarseStep };
    const material = makeGroundMaterial(false, true), compile = material.onBeforeCompile;
    material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
    material.onBeforeCompile = (sh, renderer) => {
      compile.call(material, sh, renderer); Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + shader)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y = uTrailBase + trailSurfaceHeight(position.xz);')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 trailBaseNormal; trailVertexNormals(position.xz, objectNormal, trailBaseNormal);')
        .replace('vWNorm = normalize(mat3(modelMatrix) * wn3);', 'vWNorm = trailBaseNormal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + shader)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(mat3(viewMatrix) * trailNormal(vWPos.xz - uTrailOrigin, true));')
        .replace('  // rock: steep slopes', `  vec4 contactSnow = trail(vWPos.xz - uTrailOrigin);
  if(contactSnow.g+contactSnow.b<0.002)discard;
  // The immutable terrain collider is the top of the old, frozen snowpack.
  // Empty hands move only the loose layer; they cannot expose a grey void.
  vec3 packedSnow = vec3(0.78,0.86,0.93) * (0.96 + 0.05 * nz3.r);
  snow = mix(packedSnow, snow, smoothstep(0.005,0.05,contactSnow.g + contactSnow.b)*smoothstep(0.005,0.20,contactSnow.g));
  snow *= 1.0 - contactSnow.a * 0.025;
  // rock: steep slopes`);
    };
    material.customProgramCacheKey = () => 'persistent-snow-trail-v3';
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uniforms, snowCoverUniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnowTrailWorld;\n' + shader)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y = uTrailBase + trailSurfaceHeight(position.xz);')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvSnowTrailWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
      sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vSnowTrailWorld; uniform sampler2D uTrail; uniform vec2 uTrailOrigin;\n'+snowCoverShader)
        .replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nvec2 cover=snowCover(vSnowTrailWorld);if(cover.y>0.5 || cover.x<=0.001)discard;\nvec4 materialSnow=texture2D(uTrail,((vSnowTrailWorld.xz-uTrailOrigin)/0.04+2.5)/85.0);if(materialSnow.g+materialSnow.b<0.002)discard;');
    };
    depth.customProgramCacheKey = () => 'snow-trail-depth-v3';
    const mesh = new TrailMesh(this.fine, material); mesh.position.set(x * TILE_SIZE, 0, z * TILE_SIZE);
    mesh.receiveShadow = mesh.castShadow = true; mesh.customDepthMaterial = depth;
    // Geometry is shared; shader displacement has per-tile bounds.
    this.group.add(mesh);
    return { x, z, base, mesh, pixels, texture, morph, coarseStep,
      active: new Uint8Array(SIZE * SIZE), activeCount: 0, minY: Infinity, maxY: -Infinity, signature: '', exposure: -Infinity };
  }
  private refresh(e: Entry, dirty?: SnowRect) {
    const gx = e.x * TILE_CELLS, gz = e.z * TILE_CELLS;
    const x0 = dirty ? Math.max(0, Math.floor(dirty.minX / CELL - gx)) : 0;
    const x1 = dirty ? Math.min(SIZE - 1, Math.ceil(dirty.maxX / CELL - gx) + 4) : SIZE - 1;
    const z0 = dirty ? Math.max(0, Math.floor(dirty.minZ / CELL - gz)) : 0;
    const z1 = dirty ? Math.min(SIZE - 1, Math.ceil(dirty.maxZ / CELL - gz) + 4) : SIZE - 1;
    if (x0 > x1 || z0 > z1) { e.signature = this.signature(e.x,e.z); return e.activeCount > 0; }
    for (let z = z0; z <= z1 + 4; z++) for (let x = x0; x <= x1 + 4; x++) {
      const ix = gx + x - 4, iz = gz + z - 4, state = this.field.gridState(ix, iz), i = z * RAW + x;
      this.raw[i] = state.height - this.field.initialThickness(ix * CELL, iz * CELL);
      this.packed[i] = state.surfaceCompaction;
    }
    if (!dirty) { e.minY = Infinity; e.maxY = -Infinity; }
    const weights = [0.25, 0.5, 0.25], wide=[1/16,4/16,6/16,4/16,1/16];
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      let delta = 0, packed = 0;
      for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
        const i = (z + dz + 1) * RAW + x + dx + 1, weight = weights[dx] * weights[dz];
        delta += this.raw[i] * weight; packed += this.packed[i] * weight;
      }
      // Excavation needs a broader round rim than a narrow compressed boot.
      // Smooth only uncompressed hollows; boot outlines retain their 3x3 filter.
      const centre=(z+2)*RAW+x+2;
      const excavation=THREE.MathUtils.smoothstep(-this.raw[centre],.04,.16)*(1-THREE.MathUtils.smoothstep(this.packed[centre],.05,.25));
      if(excavation>0){let rounded=0;for(let dz=0;dz<5;dz++)for(let dx=0;dx<5;dx++)rounded+=this.raw[(z+dz)*RAW+x+dx]*wide[dx]*wide[dz];delta=THREE.MathUtils.lerp(delta,rounded,excavation);}
      const wx = (gx + x - 2) * CELL, wz = (gz + z - 2) * CELL, i = (z * SIZE + x) * 4;
      const values = [this.field.baseHeight(wx, wz) - e.base, this.field.initialThickness(wx, wz), delta, packed];
      e.minY = Math.min(e.minY, e.base + values[0] + values[1] + Math.min(0, delta));
      e.maxY = Math.max(e.maxY, e.base + values[0] + values[1] + Math.max(0, delta));
      for (let k = 0; k < 4; k++) e.pixels[i + k] = THREE.DataUtils.toHalfFloat(values[k]);
      const active = +(x >= 2 && x <= SIZE - 3 && z >= 2 && z <= SIZE - 3 && (Math.abs(delta) > 0.00005 || packed > 0.001));
      const index = z * SIZE + x; e.activeCount += active - e.active[index]; e.active[index] = active;
    }
    e.texture.needsUpdate = true; if (!dirty) e.exposure = this.field.weatherExposure; e.signature = this.signature(e.x, e.z);
    new THREE.Box3(new THREE.Vector3(-0.06,e.minY-0.1,-0.06),new THREE.Vector3(TILE_SIZE+0.06,e.maxY+0.1,TILE_SIZE+0.06)).getBoundingSphere(e.mesh.boundingSphere);
    e.mesh.visible = e.activeCount > 0; this.setMask(e, e.mesh.visible); this.updatedVertices += (x1-x0+1)*(z1-z0+1);
    return e.mesh.visible;
  }
  private remove(key: string, e: Entry) {
    this.setMask(e, false); this.group.remove(e.mesh); (e.mesh.material as THREE.Material).dispose();
    e.mesh.customDepthMaterial?.dispose(); e.texture.dispose(); this.entries.delete(key);
  }
  update(position: THREE.Vector3) {
    this.eye.value.copy(position); this.updatedVertices = 0;
    if (this.previousField !== this.field) {
      for (const [k, e] of this.entries) this.remove(k, e);
      this.empty.clear(); this.previousField = this.field;
    }
    const dirty = this.field.takeDirty();
    const wanted = new Set<string>(); let weatherBudget = 1;
    this.field.visitTiles((x, z) => {
      const key = `${x},${z}`, signature = this.signature(x, z); wanted.add(key);
      const oldEmpty = this.empty.get(key);
      if (oldEmpty?.signature === signature && this.field.weatherExposure >= oldEmpty.exposure) return;
      let e = this.entries.get(key);
      if (!e) { e = this.create(x, z); this.entries.set(key, e); }
      const distance = Math.hypot((x + 0.5) * TILE_SIZE - position.x, (z + 0.5) * TILE_SIZE - position.z);
      // Keep the original 2 cm mesh near the boots. Away from the viewer, morph
      // to 4/8 cm meshes before swapping them; footprint shading stays in the
      // same texture at every distance. Include the tile radius so its nearest
      // edge keeps full detail within 3 m of the viewer.
      const near = Math.max(0, distance - TILE_SIZE / Math.SQRT2);
      if (near < 6) {
        e.mesh.geometry = this.fine; e.coarseStep.value = (TILE_SIZE + 0.12) / 80;
        e.morph.value = THREE.MathUtils.smoothstep(near, 3, 6);
      } else if (near < 12) {
        e.mesh.geometry = this.medium; e.coarseStep.value = (TILE_SIZE + 0.12) / 40;
        e.morph.value = THREE.MathUtils.smoothstep(near, 8, 12);
      } else if (distance < 22) {
        e.mesh.geometry = this.coarse; e.coarseStep.value = (TILE_SIZE + 0.12) / 8;
        e.morph.value = THREE.MathUtils.smoothstep(distance, 18, 22);
      } else {
        e.mesh.geometry = this.far; e.morph.value = 0;
      }
      e.mesh.castShadow = distance < 22;
      const changed = e.signature !== signature;
      const weather = this.field.weatherExposure - e.exposure > 0.0001;
      if (changed || (weather && weatherBudget-- > 0)) {
        if (!this.refresh(e, e.signature && !weather ? dirty ?? undefined : undefined)) {
          this.empty.set(key, { signature: e.signature, exposure: e.exposure });
          this.remove(key, e); this.field.forgetWeatheredTile(x, z);
        }
      }
    });
    for (const [key, e] of this.entries) if (!wanted.has(key)) this.remove(key, e);
  }
  refreshAll() { for (const e of this.entries.values()) this.refresh(e); }
  stats() { return { meshes: this.entries.size, vertices: Array.from(this.entries.values()).reduce((n,e) => n + e.mesh.geometry.attributes.position.count, 0),
    updatedVertices: this.updatedVertices, texturesBytes: this.entries.size * SIZE * SIZE * 8 }; }
}
