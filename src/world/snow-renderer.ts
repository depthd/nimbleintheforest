import * as THREE from 'three';
import { CELL, TILE_CELLS, TILE_SIZE, SnowField } from './snow-field';
import type { SnowRect } from './snow-field';

interface Slot { mesh: THREE.Mesh; step: number; cells: number; ix: number; iz: number; heights: Float32Array }
/** Fixed GPU pool: nine detailed tiles, sixteen medium, twenty-four coarse.
 * Trails live in SnowField. Walking farther cannot create more meshes/materials. */
export class SnowRenderer {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private material: THREE.MeshStandardMaterial;
  private farMaterial: THREE.MeshStandardMaterial;
  private centre = new THREE.Vector2(Infinity, Infinity);
  private near = { value: new THREE.Vector4() };
  private boundsUniform: { value: THREE.Vector4 };
  updatedVertices = 0;
  constructor(public field: SnowField, readonly baseY: number, readonly bounds: SnowRect) {
    this.group.name = 'snow-experiment';
    this.boundsUniform = { value: new THREE.Vector4(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ) };
    const material = (far: boolean) => {
      const m = new THREE.MeshStandardMaterial({ color: 0xf2f7ff, roughness: 0.96, vertexColors: true });
      m.onBeforeCompile = sh => {
        sh.uniforms.uSnowBounds = this.boundsUniform;
        sh.uniforms.uSnowNear = this.near;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnowWorld; attribute float snowDepth; varying float vSnowDepth;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvSnowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz; vSnowDepth = snowDepth;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>',
          '#include <common>\nvarying vec3 vSnowWorld; varying float vSnowDepth; uniform vec4 uSnowBounds; uniform vec4 uSnowNear;')
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (vSnowWorld.x < uSnowBounds.x || vSnowWorld.z < uSnowBounds.y || vSnowWorld.x > uSnowBounds.z || vSnowWorld.z > uSnowBounds.w) discard;
          // Very thin coverage shows the solid substrate. This also keeps the
          // coarse distant cover from intersecting the underlying relief.
          if (vSnowDepth < 0.025) discard;
          ${far ? 'if (vSnowWorld.x >= uSnowNear.x && vSnowWorld.z >= uSnowNear.y && vSnowWorld.x <= uSnowNear.z && vSnowWorld.z <= uSnowNear.w) discard;' : ''}`);
      };
      m.customProgramCacheKey = () => far ? 'snow-far-v2' : 'snow-near-v2';
      return m;
    };
    this.material = material(false); this.farMaterial = material(true);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const r = Math.max(Math.abs(dx), Math.abs(dz)), step = r <= 1 ? 1 : r === 2 ? 4 : 8;
      const cells = TILE_CELLS / step;
      const g = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, cells, cells);
      g.rotateX(-Math.PI / 2); g.translate(TILE_SIZE / 2, 0, TILE_SIZE / 2);
      const n = g.attributes.position.count;
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      g.setAttribute('snowDepth', new THREE.BufferAttribute(new Float32Array(n).fill(field.thickness), 1));
      for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
      g.boundingBox = new THREE.Box3(new THREE.Vector3(0, baseY, 0), new THREE.Vector3(TILE_SIZE, baseY + 2, TILE_SIZE));
      g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(g, this.material);
      mesh.receiveShadow = true;
      // The light sees the real depression nearby; distant tiles don't need a shadow pass.
      mesh.castShadow = false;
      this.group.add(mesh); this.slots.push({ mesh, step, cells, ix: Infinity, iz: Infinity, heights: new Float32Array((cells + 3) ** 2) });
    }
    const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
    const farGeo = new THREE.PlaneGeometry(width, depth, field.variableSurface ? Math.ceil(width / 0.4) : 1, field.variableSurface ? Math.ceil(depth / 0.4) : 1);
    const farColor = new THREE.BufferAttribute(new Float32Array(farGeo.attributes.position.count * 3).fill(1), 3);
    const farDepth = new THREE.BufferAttribute(new Float32Array(farGeo.attributes.position.count).fill(field.thickness), 1);
    farGeo.setAttribute('color', farColor); farGeo.setAttribute('snowDepth', farDepth);
    if (field.variableSurface) {
      // Static far cover follows the same base and initial retention as the near
      // layer. Fine deformation remains local; distant hills do not turn flat.
      const p = farGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) + (bounds.minX + bounds.maxX) / 2;
        const z = -p.getY(i) + (bounds.minZ + bounds.maxZ) / 2;
        const thickness = field.initialThickness(x, z), snow = THREE.MathUtils.smoothstep(thickness, 0.025, 0.06);
        p.setZ(i, field.baseHeight(x, z) + thickness - baseY - field.thickness);
        farDepth.setX(i, thickness); farColor.setXYZ(i, THREE.MathUtils.lerp(0.207, 1, snow), THREE.MathUtils.lerp(0.236, 1, snow), THREE.MathUtils.lerp(0.254, 1, snow));
      }
      farGeo.computeVertexNormals(); farGeo.computeBoundingSphere();
    }
    const far = new THREE.Mesh(farGeo, this.farMaterial);
    far.rotation.x = -Math.PI / 2;
    far.position.set((bounds.minX + bounds.maxX) / 2, baseY + field.thickness, (bounds.minZ + bounds.maxZ) / 2);
    far.receiveShadow = true; this.group.add(far);
  }
  update(position: THREE.Vector3) {
    this.updatedVertices = 0;
    const ix = Math.floor(position.x / TILE_SIZE), iz = Math.floor(position.z / TILE_SIZE);
    const dirty = this.field.takeDirty();
    if (this.centre.x !== ix || this.centre.y !== iz) {
      this.centre.set(ix, iz);
      const wanted: { ix: number; iz: number; step: number }[] = [];
      for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) {
        const r = Math.max(Math.abs(x), Math.abs(z)); wanted.push({ ix: ix + x, iz: iz + z, step: r <= 1 ? 1 : r === 2 ? 4 : 8 });
      }
      const retained = new Set<Slot>();
      for (const w of wanted) { const s = this.slots.find(s => s.ix === w.ix && s.iz === w.iz && s.step === w.step); if (s) retained.add(s); }
      for (const w of wanted) {
        if (this.slots.some(s => retained.has(s) && s.ix === w.ix && s.iz === w.iz && s.step === w.step)) continue;
        const s = this.slots.find(s => !retained.has(s) && s.step === w.step)!;
        s.ix = w.ix; s.iz = w.iz; s.mesh.position.set(w.ix * TILE_SIZE, 0, w.iz * TILE_SIZE);
        retained.add(s); this.refresh(s);
      }
      this.near.value.set((ix - 3) * TILE_SIZE, (iz - 3) * TILE_SIZE, (ix + 4) * TILE_SIZE, (iz + 4) * TILE_SIZE);
    }
    if (dirty) for (const s of this.slots) this.refresh(s, dirty);
  }
  private refresh(s: Slot, dirty?: SnowRect) {
    const x0 = s.ix * TILE_SIZE, z0 = s.iz * TILE_SIZE, spacing = s.step * CELL, n = s.cells + 1;
    s.mesh.visible = x0 < this.bounds.maxX && x0 + TILE_SIZE > this.bounds.minX && z0 < this.bounds.maxZ && z0 + TILE_SIZE > this.bounds.minZ;
    if (!s.mesh.visible) return;
    const a0 = dirty ? Math.max(0, Math.floor((dirty.minX - x0) / spacing) - 1) : 0;
    const a1 = dirty ? Math.min(s.cells, Math.ceil((dirty.maxX - x0) / spacing) + 1) : s.cells;
    const b0 = dirty ? Math.max(0, Math.floor((dirty.minZ - z0) / spacing) - 1) : 0;
    const b1 = dirty ? Math.min(s.cells, Math.ceil((dirty.maxZ - z0) / spacing) + 1) : s.cells;
    if (a0 > a1 || b0 > b1) return;
    const g = s.mesh.geometry, p = g.attributes.position as THREE.BufferAttribute;
    const normal = g.attributes.normal as THREE.BufferAttribute, color = g.attributes.color as THREE.BufferAttribute;
    const depths = g.attributes.snowDepth as THREE.BufferAttribute;
    if (!dirty && !this.field.variableSurface && !this.field.hasChangesNear(s.ix, s.iz)) {
      for (let i = 0; i < p.count; i++) { p.setY(i, this.baseY + this.field.thickness); normal.setXYZ(i, 0, 1, 0); color.setXYZ(i, 1, 1, 1); depths.setX(i, this.field.thickness); }
      for (const attr of [p, normal, color, depths]) { attr.clearUpdateRanges(); attr.needsUpdate = true; }
      this.updatedVertices += p.count;
      return;
    }
    const stride = n + 2, h = s.heights;
    const gx = s.ix * TILE_CELLS, gz = s.iz * TILE_CELLS;
    for (let b = b0 - 1; b <= b1 + 1; b++) for (let a = a0 - 1; a <= a1 + 1; a++)
      h[(b + 1) * stride + a + 1] = this.field.baseHeight((gx + a * s.step) * CELL, (gz + b * s.step) * CELL) + this.field.gridValue(gx + a * s.step, gz + b * s.step);
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) {
      const i = b * n + a, hi = (b + 1) * stride + a + 1;
      const packed = this.field.gridValue(gx + a * s.step, gz + b * s.step, true);
      const thickness = this.field.gridValue(gx + a * s.step, gz + b * s.step);
      depths.setX(i, thickness);
      p.setY(i, h[hi]);
      const dx = h[hi + 1] - h[hi - 1], dz = h[hi + stride] - h[hi - stride];
      const len = Math.hypot(dx, 2 * spacing, dz);
      normal.setXYZ(i, -dx / len, 2 * spacing / len, -dz / len);
      // Subtle blue occlusion in compressed cavities; geometry supplies the lighting.
      const shade = 1 - packed * 0.12;
      const snow = THREE.MathUtils.smoothstep(thickness, 0.025, 0.06);
      color.setXYZ(i, THREE.MathUtils.lerp(0.207, shade * (1 - packed * 0.06), snow), THREE.MathUtils.lerp(0.236, shade, snow), THREE.MathUtils.lerp(0.254, 1, snow));
      this.updatedVertices++;
    }
    for (const attr of [p, normal, color, depths]) {
      for (let b = b0; b <= b1; b++) attr.addUpdateRange((b * n + a0) * attr.itemSize, (a1 - a0 + 1) * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
  stats() { return { meshes: this.slots.length + 1, vertices: this.slots.reduce((n, s) => n + s.mesh.geometry.attributes.position.count, 0), updatedVertices: this.updatedVertices }; }
  refreshAll() { for (const s of this.slots) if (Number.isFinite(s.ix)) this.refresh(s); }
}
