import * as THREE from 'three';
import { G } from '../ctx';
import type { DiagnosticBundle, DiagnosticObject, WorldSample } from './schema';

/** Only explicit scalar data is copied: never traverse entities or system graphs. */
function scalars(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))));
}
export class WorldCapture {
  bundle: DiagnosticBundle = { version: 1, radius: 32, interval: 0.25, meshes: {}, samples: [], coverage: [
    'Участок ±32 м; сетка земли 4 м; сущности до 128; состояние раз в 0,25 с.',
    'Меши сущностей и простые коллайдеры; ввод, IK и снег сохраняются исходной записью.',
    'Статические опоры в радиусе: физическая геометрия. Лес, вода, скалы и пещеры не имеют полного визуального снимка.',
    'Снимок для осмотра, не сохранение игры и не детерминированный повтор симуляции.' ] };
  private vertices = 0;
  private sequence = 0;
  sample(t: number, firstTime: number): number {
    const samples = this.bundle.samples;
    if (samples.length && t - samples.at(-1)!.time < 0.25) return samples.at(-1)!.id;
    const p = G.player, center = p.pos.toArray();
    const terrain: number[] = [];
    for (let z = -8; z <= 8; z++) for (let x = -8; x <= 8; x++) terrain.push(G.snow?.isExperiment ? G.snow.terrain.heightAt(center[0] + x * 4, center[2] + z * 4) : G.terrain.heightAt(center[0] + x * 4, center[2] + z * 4));
    const nearby = G.entities.list.filter(e => !e.removed && ((e.inWorld && e.position().distanceTo(p.pos) < 32) || p.inventory.includes(e) || p.carried === e || p.equipped === e));
    nearby.sort((a, b) => a.position().distanceToSquared(p.pos) - b.position().distanceToSquared(p.pos));
    let truncated = nearby.length > 128;
    let meshCount = 0;
    const objects: DiagnosticObject[] = nearby.slice(0, 128).map(e => {
      const meshes: DiagnosticObject['meshes'] = [];
      e.obj?.updateWorldMatrix(true, true);
      e.obj?.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible || !m.geometry?.attributes.position) return;
        if (meshCount >= 512 || meshes.length >= 64 || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh) { truncated = true; return; }
        const material = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
        const key = m.geometry.uuid + ':' + (material?.color?.getHex() ?? 0x888888);
        if (!this.bundle.meshes[key]) {
          const a = m.geometry.attributes.position;
          if (Object.keys(this.bundle.meshes).length >= 128 || this.vertices + a.count > 120000) { truncated = true; return; }
          this.vertices += a.count;
          const positions: number[] = [];
          for (let i = 0; i < a.count; i++) positions.push(a.getX(i), a.getY(i), a.getZ(i));
          this.bundle.meshes[key] = { positions, indices: m.geometry.index ? Array.from(m.geometry.index.array) : null, color: material?.color?.getHex() ?? 0x888888 };
        }
        meshCount++; meshes.push({ geometry: key, matrix: m.matrixWorld.toArray() });
      });
      if (e.colliders.length > 32) truncated = true;
      const colliders = e.colliders.slice(0, 32).map(c => {
        const v = c.translation(), q = c.rotation();
        const shape = c.shape as any;
        const h = shape.halfExtents;
        return { position: [v.x, v.y, v.z], rotation: [q.x, q.y, q.z, q.w], shape: c.shapeType(), half: h ? [h.x, h.y, h.z] : [0, 0, 0], radius: shape.radius ?? 0, height: shape.halfHeight ?? 0 };
      });
      return { id: e.id, name: e.name, kind: e.kind, definition: e.defId, position: e.position().toArray(), meshes, colliders,
        state: { ...scalars(e), params: { ...e.params }, contents: e.contents ? { ...e.contents } : null,
          wood: e.data.wood ? JSON.parse(JSON.stringify(e.data.wood)) : null,
          velocity: e.body ? { ...e.body.linvel() } : null, angularVelocity: e.body ? { ...e.body.angvel() } : null,
          sleeping: e.body?.isSleeping() ?? null, pockets: e.pockets.map(x => x.id) } };
    });
    const target = G.interact.target;
    const handles = new Set(nearby.flatMap(e => e.colliders.map(c => c.handle)));
    const staticColliders: any[] = [];
    G.world.forEachCollider(c => {
      if (handles.has(c.handle) || c.parent()?.handle === p.body.handle) return;
      const v = c.translation();
      const distance = Math.hypot(v.x - center[0], v.y - center[1], v.z - center[2]);
      if (distance < 32) staticColliders.push({ c, distance });
    });
    staticColliders.sort((a, b) => a.distance - b.distance);
    for (const { c } of staticColliders) {
      if (objects.length >= 128) { truncated = true; break; }
      const v = c.translation(), q = c.rotation(), shape = c.shape as any, h = shape.halfExtents;
      const meshes: DiagnosticObject['meshes'] = [];
      // Trimesh/convex collision geometry is evidence even when no entity owns it.
      if (shape.vertices?.length && shape.indices?.length && shape.vertices.length / 3 + this.vertices <= 120000 && Object.keys(this.bundle.meshes).length < 128) {
        const key = `collider-${c.handle}`;
        if (!this.bundle.meshes[key]) {
          this.bundle.meshes[key] = { positions: Array.from(shape.vertices), indices: shape.indices ? Array.from(shape.indices) : null, color: 0x687e88 };
          this.vertices += shape.vertices.length / 3;
        }
        meshes.push({ geometry: key, matrix: new THREE.Matrix4().compose(new THREE.Vector3(v.x, v.y, v.z), new THREE.Quaternion(q.x, q.y, q.z, q.w), new THREE.Vector3(1, 1, 1)).toArray() });
      }
      objects.push({ id: -objects.length - 1, name: 'Опора физического мира', kind: 'world-collider', definition: '', position: [v.x, v.y, v.z], meshes,
        state: { handle: c.handle, sensor: c.isSensor(), collisionGroups: c.collisionGroups() },
        colliders: [{ position: [v.x, v.y, v.z], rotation: [q.x, q.y, q.z, q.w], shape: c.shapeType(), half: h ? [h.x, h.y, h.z] : [0, 0, 0], radius: shape.radius ?? 0, height: shape.halfHeight ?? 0 }] });
    }
    const s: WorldSample = { id: this.sequence++, time: t, center, terrain, objects, truncated, systems: {
      gameTime: G.time, body: scalars(G.body), weather: scalars(G.weather),
      inventory: p.inventory.map(e => e.id), worn: [...p.worn].map(([slot, e]) => [slot, e.id]), equipped: p.equipped?.id ?? null, carried: p.carried?.id ?? null,
      target: { kind: target.kind, point: target.point.toArray(), distance: target.dist },
      actions: G.interact.actions?.map(a => ({ key: a.key, label: a.label, time: a.time ?? 0 })) ?? [],
      fires: G.fires.list.slice(0, 64).map(f => ({ ...scalars(f), position: f.pos.toArray() })),
      cave: G.caves?.envAt(p.pos) ?? null, biome: G.region.biomeAt(p.pos.x, p.pos.z),
      thermal: { air: G.thermal.tAt(p.eyePos), humidity: G.thermal.rhAt(p.eyePos), draft: G.thermal.draftAt(p.eyePos) },
      terrainStreaming: G.terrain.streamingStats(),
    } };
    samples.push(s);
    // Keep the preceding sample: every retained frame still resolves its reference.
    while (samples.length > 1 && samples[1].time < firstTime) samples.shift();
    while (samples.length > 100) samples.shift();
    const used = new Set(samples.flatMap(s => s.objects.flatMap(o => o.meshes.map(m => m.geometry))));
    for (const key of Object.keys(this.bundle.meshes)) if (!used.has(key)) { this.vertices -= this.bundle.meshes[key].positions.length / 3; delete this.bundle.meshes[key]; }
    return s.id;
  }
}
