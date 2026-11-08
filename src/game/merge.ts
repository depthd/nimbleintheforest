// Many objects that don't move drawn as one mesh per material (and shadow setting).
//
// One member can be taken out at once: its triangles shrink to a point, so it costs a
// small buffer update instead of a rebuild. Whoever owns the batch draws that member on
// its own until it rebuilds the batch, when nothing has changed for a while.
import * as THREE from 'three';

export interface BatchMember {
  id: number;
  /** drawn as it is now: its own visibility is ignored, hidden children are left out */
  obj: THREE.Object3D;
}

interface Entry {
  geo: THREE.BufferGeometry;
  start: number;
  count: number;
  matrix: THREE.Matrix4;
}

interface Bucket {
  mat: THREE.Material;
  shadow: boolean;
  /** entries of each member, in order */
  members: { id: number; entries: Entry[] }[];
}

interface Range {
  attr: THREE.BufferAttribute;
  start: number;
  count: number;
}

const normalMat = new THREE.Matrix3();

export class MergedMeshes {
  readonly group = new THREE.Group();
  /** bounds of everything in the batch (for distance culling) */
  readonly sphere = new THREE.Sphere();
  /** members taken out since it was built */
  holes = 0;
  private ranges = new Map<number, Range[]>();

  constructor(members: Iterable<BatchMember>) {
    const buckets = new Map<string, Bucket>();
    for (const m of members) {
      const root = m.obj;
      root.updateMatrixWorld(true);
      const seen = new Set<Bucket>();
      const visit = (o: THREE.Object3D, top: boolean) => {
        if (!top && !o.visible) return;
        const me = o as THREE.Mesh;
        if (me.isMesh && !(me as THREE.InstancedMesh).isInstancedMesh && !(me as THREE.SkinnedMesh).isSkinnedMesh) {
          const geo = me.geometry;
          const total = geo.index ? geo.index.count : geo.attributes.position.count;
          const mats = Array.isArray(me.material) ? me.material : [me.material];
          const groups = Array.isArray(me.material) && geo.groups.length ? geo.groups : [{ start: 0, count: total, materialIndex: 0 }];
          for (const gr of groups) {
            const mat = mats[gr.materialIndex ?? 0];
            const count = Math.min(gr.count, total - gr.start);
            if (!mat || count <= 0) continue;
            const key = `${mat.uuid}|${me.castShadow ? 1 : 0}`;
            let b = buckets.get(key);
            if (!b) buckets.set(key, (b = { mat, shadow: me.castShadow, members: [] }));
            if (!seen.has(b)) {
              seen.add(b);
              b.members.push({ id: m.id, entries: [] });
            }
            b.members[b.members.length - 1].entries.push({ geo, start: gr.start, count, matrix: me.matrixWorld });
          }
        }
        for (const c of o.children) visit(c, false);
      };
      visit(root, true);
    }
    const box = new THREE.Box3();
    for (const b of buckets.values()) {
      const geo = this.mergeBucket(b);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, b.mat);
      mesh.castShadow = b.shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      geo.computeBoundingBox();
      box.union(geo.boundingBox!);
    }
    this.group.matrixAutoUpdate = false;
    if (!box.isEmpty()) box.getBoundingSphere(this.sphere);
  }

  get empty() {
    return this.group.children.length === 0;
  }

  has(id: number) {
    return this.ranges.has(id);
  }

  /** Stop drawing one member (it is drawn on its own now, or gone). */
  hide(id: number) {
    const rs = this.ranges.get(id);
    if (!rs) return;
    this.ranges.delete(id);
    this.holes++;
    for (const r of rs) {
      const a = r.attr.array as Float32Array;
      a.fill(0, r.start * 3, (r.start + r.count) * 3);
      r.attr.addUpdateRange(r.start * 3, r.count * 3);
      r.attr.needsUpdate = true;
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const c of this.group.children) (c as THREE.Mesh).geometry.dispose();
    this.group.clear();
    this.ranges.clear();
  }

  /** One non-indexed geometry in world space; remembers where each member's vertices are. */
  private mergeBucket(b: Bucket) {
    // the attributes every piece in it has, with the same size
    const first = b.members[0]?.entries[0]?.geo;
    if (!first) return null;
    const names = Object.keys(first.attributes).filter((k) =>
      b.members.every((m) => m.entries.every((e) => e.geo.attributes[k] && e.geo.attributes[k].itemSize === first.attributes[k].itemSize)),
    );
    if (!names.includes('position')) return null;
    let total = 0;
    for (const m of b.members) for (const e of m.entries) total += e.count;
    if (!total) return null;
    const out: Record<string, Float32Array> = {};
    for (const k of names) out[k] = new Float32Array(total * first.attributes[k].itemSize);
    const P = out.position, N = out.normal;
    const pos = new THREE.BufferAttribute(P, 3);
    let o = 0;
    for (const m of b.members) {
      const start = o;
      for (const e of m.entries) {
        const idx = e.geo.index;
        const src = e.geo.attributes;
        const sp = src.position, sn = N ? src.normal : null;
        const me = e.matrix.elements;
        const ne = N ? normalMat.getNormalMatrix(e.matrix).elements : null;
        for (let k = 0; k < e.count; k++, o++) {
          const vi = idx ? idx.getX(e.start + k) : e.start + k;
          const x = sp.getX(vi), y = sp.getY(vi), z = sp.getZ(vi);
          P[o * 3] = me[0] * x + me[4] * y + me[8] * z + me[12];
          P[o * 3 + 1] = me[1] * x + me[5] * y + me[9] * z + me[13];
          P[o * 3 + 2] = me[2] * x + me[6] * y + me[10] * z + me[14];
          if (sn && ne) {
            const nx = sn.getX(vi), ny = sn.getY(vi), nz = sn.getZ(vi);
            const tx = ne[0] * nx + ne[3] * ny + ne[6] * nz;
            const ty = ne[1] * nx + ne[4] * ny + ne[7] * nz;
            const tz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
            const l = Math.hypot(tx, ty, tz) || 1;
            N[o * 3] = tx / l;
            N[o * 3 + 1] = ty / l;
            N[o * 3 + 2] = tz / l;
          }
          for (const name of names) {
            if (name === 'position' || name === 'normal') continue;
            const s = src[name];
            const d = out[name];
            const n = s.itemSize;
            d[o * n] = s.getX(vi);
            if (n > 1) d[o * n + 1] = s.getY(vi);
            if (n > 2) d[o * n + 2] = s.getZ(vi);
            if (n > 3) d[o * n + 3] = s.getW(vi);
          }
        }
      }
      if (o > start) {
        let rs = this.ranges.get(m.id);
        if (!rs) this.ranges.set(m.id, (rs = []));
        rs.push({ attr: pos, start, count: o - start });
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', pos);
    for (const k of names) if (k !== 'position') geo.setAttribute(k, new THREE.BufferAttribute(out[k], first.attributes[k].itemSize));
    geo.computeBoundingSphere();
    return geo;
  }
}
