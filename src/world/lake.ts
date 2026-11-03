// Frozen lake: walkable ice, holes for water and fishing, and a patch of thin ice.
import * as THREE from 'three';
import { G, GROUPS_STATIC } from '../game/ctx';
import { Rng } from '../core/rng';
import { Tex } from '../core/textures';
import { Entity } from '../game/entities';
import { mat } from '../game/meshes';

export class Lake {
  level = 0;
  mesh!: THREE.Mesh;
  holes: Entity[] = [];
  thin = { x: 0, z: 0, r: 3.2 };
  thinBroken = false;
  private holeMat!: THREE.MeshStandardMaterial;

  build(rng: Rng) {
    const T = G.terrain;
    this.level = T.lake.level;
    const pts: THREE.Vector2[] = [];
    const ring: { x: number; z: number }[] = [];
    const N = 72;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const p = T.lakePoint(a, 1.04);
      ring.push(p);
      pts.push(new THREE.Vector2(p.x, -p.z));
    }
    const shape = new THREE.Shape(pts);
    const geo = new THREE.ShapeGeometry(shape, 1);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 7, uv.getY(i) / 7);
    const m = new THREE.MeshStandardMaterial({ map: Tex.ice(), roughness: 0.35, metalness: 0.05, color: 0xe6eef4 });
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.position.y = this.level;
    this.mesh.receiveShadow = true;
    G.scene.add(this.mesh);

    // collider: triangle fan around lake centre
    const L = T.lake;
    const verts = new Float32Array((N + 1) * 3);
    verts[0] = L.cx;
    verts[1] = this.level;
    verts[2] = L.cz;
    for (let i = 0; i < N; i++) {
      verts[(i + 1) * 3] = ring[i].x;
      verts[(i + 1) * 3 + 1] = this.level;
      verts[(i + 1) * 3 + 2] = ring[i].z;
    }
    const idx = new Uint32Array(N * 3);
    for (let i = 0; i < N; i++) {
      idx[i * 3] = 0;
      idx[i * 3 + 1] = 1 + ((i + 1) % N);
      idx[i * 3 + 2] = 1 + i;
    }
    const col = G.world.createCollider(G.R.ColliderDesc.trimesh(verts, idx).setFriction(0.15).setCollisionGroups(GROUPS_STATIC));
    G.iceHandle = col.handle;

    // thin ice patch: away from the house side of the lake
    const toHouse = Math.atan2(-L.cz, -L.cx);
    const a = toHouse + Math.PI + rng.float(-0.9, 0.9);
    const k = rng.float(0.55, 0.75);
    const tp = T.lakePoint(a, k);
    this.thin.x = tp.x;
    this.thin.z = tp.z;
    const tg = new THREE.CircleGeometry(this.thin.r, 28);
    const tpos = tg.attributes.position as THREE.BufferAttribute;
    for (let i = 1; i < tpos.count; i++) {
      const f = 0.8 + rng.float(0, 0.35);
      tpos.setXY(i, tpos.getX(i) * f, tpos.getY(i) * f);
    }
    const tm = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: 0x8fa6b8, transparent: true, opacity: 0.42, roughness: 0.15, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }));
    tm.rotation.x = -Math.PI / 2;
    tm.position.set(this.thin.x, this.level + 0.004, this.thin.z);
    G.scene.add(tm);

    this.holeMat = mat('icehole', () => new THREE.MeshStandardMaterial({ color: 0x0d1a24, roughness: 0.05, metalness: 0.3 })) as THREE.MeshStandardMaterial;
  }

  onIce(p: THREE.Vector3) {
    return G.terrain.lakeQ(p.x, p.z) < 1.0 && Math.abs(p.y - this.level) < 0.6;
  }

  onThin(p: THREE.Vector3) {
    return !this.thinBroken && Math.hypot(p.x - this.thin.x, p.z - this.thin.z) < this.thin.r * 0.85 && Math.abs(p.y - this.level) < 0.3;
  }

  makeHole(pos: THREE.Vector3, r = 0.2, name = 'Лунка'): Entity {
    const e = new Entity('icehole');
    e.name = name;
    const g = new THREE.Group();
    g.position.set(pos.x, this.level + 0.006, pos.z);
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
      G.R.ColliderDesc.cylinder(0.05, r + 0.05).setTranslation(pos.x, this.level + 0.02, pos.z).setSensor(true).setCollisionGroups(GROUPS_STATIC),
    );
    e.data = { r, frozen: 0, water };
    G.entities.registerStatic(e, [col]);
    this.holes.push(e);
    return e;
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
}
