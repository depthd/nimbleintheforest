// Opt-in test bed using the real player, gait, IK, input and interaction system.
// No snow colliders are rebuilt: terrain/obstacles stay with Rapier, soft support
// is a separate query. This is deliberately not the world's weather system yet.
import * as THREE from 'three';
import { G, GROUPS_STATIC, GROUPS_RAY, msg } from './ctx';
import { SnowField } from '../world/snow-field';
import type { BootPose } from '../world/snow-field';
import { SnowRenderer } from '../world/snow-renderer';
import { footPose } from './locomotion';
import type { FootSurface } from './locomotion';
import type { Entity } from './entities';
import { SnowTestTerrain, SNOW_HILLS } from '../world/snow-test-terrain';

export class SnowExperiment {
  readonly isExperiment = true;
  readonly baseY = G.terrain.heightAt(40, 40) + 35;
  readonly bounds = { minX: 30, maxX: 50, minZ: 8, maxZ: 72 };
  readonly spawn = new THREE.Vector3(40, this.baseY + 0.15, 64);
  readonly treasure = new THREE.Vector3(41.1, this.baseY + 0.025, 61.5);
  readonly terrain = new SnowTestTerrain(this.baseY, this.bounds);
  field!: SnowField;
  renderer!: SnowRenderer;
  enabled = true;
  firm = false;
  carriedSnow = 0;
  bootMs = 0;
  renderMs = 0;
  private lastBoots: BootPose[] | null = null;
  private baseHandle: number;
  private knife!: Entity;
  private panel: HTMLDivElement;
  private status: HTMLElement;
  private cooldown = 0;
  private uiTime = 0;
  constructor() {
    const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
    const bed = G.world.createCollider(G.R.ColliderDesc.trimesh(this.terrain.positions, this.terrain.indices)
      .setCollisionGroups(GROUPS_STATIC), body);
    this.baseHandle = bed.handle;
    const base = new THREE.Mesh(new THREE.BoxGeometry(20, 0.3, 64), new THREE.MeshStandardMaterial({ color: 0x9aa9b5, roughness: 1 }));
    base.position.set(40, this.baseY - 0.155, 40); base.receiveShadow = true; G.scene.add(base);
    const relief = new THREE.Mesh(this.terrain.geometry(), new THREE.MeshStandardMaterial({ color: 0x77818a, roughness: 1 }));
    relief.receiveShadow = relief.castShadow = true; G.scene.add(relief);
    // Low wooden edges and a crossing plank offer actual solid supports to step on.
    const wood = new THREE.MeshStandardMaterial({ color: 0x514b40, roughness: 0.95 });
    const box = (x: number, z: number, sx: number, sz: number, top: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.18, sz), wood);
      mesh.position.set(x, this.baseY + top - 0.09, z); mesh.castShadow = mesh.receiveShadow = true; G.scene.add(mesh);
      G.world.createCollider(G.R.ColliderDesc.cuboid(sx / 2, 0.09, sz / 2).setTranslation(x, mesh.position.y, z).setCollisionGroups(GROUPS_STATIC), body);
    };
    box(30, 40, 0.22, 64, 0.38); box(50, 40, 0.22, 64, 0.38);
    box(40, 8, 20, 0.22, 0.38); box(40, 72, 20, 0.22, 0.38);
    box(40, 40, 20, 0.8, 0.34);
    for (const [x, z, r] of [[34, 54, 0.55], [46, 30, 0.7], [35, 17, 0.35]]) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshStandardMaterial({ color: 0x626d73, roughness: 1 }));
      mesh.position.set(x, this.baseY, z); mesh.castShadow = mesh.receiveShadow = true; G.scene.add(mesh);
      G.world.createCollider(G.R.ColliderDesc.ball(r).setTranslation(x, this.baseY, z).setCollisionGroups(GROUPS_STATIC), body);
    }
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 8), wood);
    marker.position.copy(this.treasure).add(new THREE.Vector3(0.45, 0.3, 0)); G.scene.add(marker);
    this.panel = document.createElement('div'); this.panel.className = 'snow-panel';
    this.panel.innerHTML = `<strong>Испытание снега</strong><span class="snow-status"></span>
      <p>WASD — идти · Shift — бег · F6 — сменить вид<br>ЛКМ — раскопать · ПКМ — высыпать · E — взять<br>Для копания удобен вид от первого лица.<br>Нож слева от колышка. Esc — курсор.</p>
      <div><button data-snow="kind">Плотный снег</button><button data-snow="reset">Сначала</button><button data-snow="toggle">Без снега</button><a href="./">Обычная игра</a></div>
      <div style="margin-top:8px">Горки: ${SNOW_HILLS.map((h, i) => `<button data-hill="${i}">${h.label}</button>`).join('')}</div>`;
    document.body.appendChild(this.panel); this.status = this.panel.querySelector('.snow-status')!;
    this.panel.querySelector('[data-snow="kind"]')!.addEventListener('click', () => {
      this.firm = !this.firm; this.reset(true);
      this.panel.querySelector('[data-snow="kind"]')!.textContent = this.firm ? 'Рыхлый снег' : 'Плотный снег';
    });
    this.panel.querySelector('[data-snow="reset"]')!.addEventListener('click', () => this.reset());
    this.panel.querySelector('[data-snow="toggle"]')!.addEventListener('click', () => this.setEnabled(!this.enabled, true));
    this.panel.querySelectorAll<HTMLButtonElement>('[data-hill]').forEach(button => button.addEventListener('click', () => this.visitHill(Number(button.dataset.hill))));
    document.getElementById('legend')!.style.display = 'none';
    document.getElementById('env')!.style.display = 'none';
    this.reset();
  }
  contains(x: number, z: number) { return x > this.bounds.minX + 0.15 && x < this.bounds.maxX - 0.15 && z > this.bounds.minZ + 0.15 && z < this.bounds.maxZ - 0.15; }
  reset(keepPlace = false) {
    const old = keepPlace ? { position: G.player.pos.clone(), yaw: G.player.yaw, pitch: G.player.pitch, view: G.player.avatar.inspectionView } : null;
    if (this.renderer) {
      // Only an explicit reset replaces GPU resources, never walking/streaming.
      G.scene.remove(this.renderer.group);
      const materials = new Set<THREE.Material>();
      this.renderer.group.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); materials.add(o.material as THREE.Material); } });
      materials.forEach(m => m.dispose());
    }
    this.field = new SnowField({ thickness: 0.28, densityRatio: this.firm ? 1.25 : 2.6,
      base: this.terrain.heightAt, coverage: this.terrain.retentionAt, contains: (x, z) => this.contains(x, z) });
    this.renderer = new SnowRenderer(this.field, this.baseY, this.bounds);
    this.renderer.group.visible = this.enabled; G.scene.add(this.renderer.group);
    this.carriedSnow = 0; this.resetBoots();
    if (this.knife && !this.knife.removed) {
      G.player.inventory = G.player.inventory.filter(e => e !== this.knife);
      if (G.player.equipped === this.knife) G.player.equip(null);
      G.entities.destroy(this.knife);
    }
    this.knife = G.entities.spawnItem('knife', this.treasure.clone());
    G.player.yaw = G.player.pitch = 0;
    G.player.stamina = 1; G.player.winded = false;
    G.player.teleport(this.spawn.clone().setY(this.baseY + (this.enabled ? this.field.support(40, 64) : 0) + 0.05));
    G.player.avatar.inspectionView = 1;
    if (old && this.contains(old.position.x, old.position.z)) {
      const { x, z } = old.position;
      G.player.yaw = old.yaw; G.player.pitch = old.pitch; G.player.avatar.inspectionView = old.view;
      G.player.teleport(new THREE.Vector3(x, this.terrain.heightAt(x, z) + (this.enabled ? this.field.support(x, z) : 0) + 0.05, z));
    }
    this.renderer.update(G.player.pos);
    this.uiTime = 1;
  }
  setEnabled(enabled: boolean, keepPlace = false) {
    this.enabled = enabled; this.renderer.group.visible = enabled; this.resetBoots();
    this.panel.querySelector('[data-snow="toggle"]')!.textContent = enabled ? 'Без снега' : 'Вернуть снег';
    const p = keepPlace && this.contains(G.player.pos.x, G.player.pos.z) ? G.player.pos.clone() : this.spawn.clone();
    G.player.teleport(p.setY(this.terrain.heightAt(p.x, p.z) + (enabled ? this.field.support(p.x, p.z) : 0) + 0.05));
    this.uiTime = 1;
  }
  resetBoots() { this.lastBoots = null; }
  visitHill(index: number) {
    const hill = SNOW_HILLS[index];
    if (!hill) return;
    const x = hill.x, z = hill.z + hill.rz + 1;
    G.player.yaw = 0; G.player.pitch = -0.25;
    G.player.teleport(new THREE.Vector3(x, this.terrain.heightAt(x, z) + (this.enabled ? this.field.support(x, z) : 0) + 0.05, z));
    G.player.stamina = 1; G.player.winded = false;
    this.renderer.update(G.player.pos);
  }
  probe(surface: FootSurface): FootSurface {
    if (!this.enabled || surface.support !== this.baseHandle || !this.contains(surface.point.x, surface.point.z)) return surface;
    const { x, z } = surface.point;
    const depth = Math.max(0, this.field.sample(x, z).height - this.field.support(x, z));
    return { point: new THREE.Vector3(x, this.terrain.heightAt(x, z) + this.field.support(x, z) + 0.012, z),
      normal: surface.normal, support: surface.support, snowDepth: depth };
  }
  movement(x: number, z: number, y: number) {
    const ground = this.terrain.heightAt(x, z);
    if (!this.enabled || !this.contains(x, z) || y < ground - 0.15 || y > ground + 0.9 || this.terrain.normalAt(x, z).y < Math.cos(48 * Math.PI / 180)) return null;
    const support = this.field.support(x, z);
    const depth = Math.max(0, this.field.sample(x, z).height - support);
    return { height: ground + support + 0.03, speed: 1 / (1 + depth * 3) };
  }
  step() {
    if (!this.enabled || G.player.water || G.sleeping || G.dead) { this.resetBoots(); return; }
    const start = performance.now(), poses = G.player.avatar.motion.feet.map(f => footPose(f));
    if (this.lastBoots) for (let i = 0; i < poses.length; i++) this.field.sweepBoot(this.lastBoots[i], poses[i]);
    this.lastBoots = poses; this.bootMs = performance.now() - start;
  }
  /** Near-surface occlusion is also used by interaction, so a buried collider
   * cannot be selected through the visual layer. No per-frame collider rebuild. */
  raycast(origin: THREE.Vector3, direction: THREE.Vector3, reach: number) {
    if (!this.enabled) return null;
    const inside = (d: number) => {
      const x = origin.x + direction.x * d, z = origin.z + direction.z * d, y = origin.y + direction.y * d;
      const ground = this.terrain.heightAt(x, z);
      if (!this.contains(x, z) || y < ground - 0.01) return false;
      const h = this.field.sample(x, z).height;
      return h > 0.004 && y <= ground + h;
    };
    for (let d = 0; d <= reach; d += 0.025) if (inside(d)) {
      let lo = Math.max(0, d - 0.025), hi = d;
      for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (inside(m)) hi = m; else lo = m; }
      return { distance: hi, point: origin.clone().addScaledVector(direction, hi) };
    }
    return null;
  }
  update(dt: number) {
    const start = performance.now();
    if (this.enabled) this.renderer.update(G.player.pos);
    this.renderMs = performance.now() - start;
    this.cooldown -= dt; this.uiTime += dt;
    if (G.input.enabled && (G.input.locked || (window as any).__test) && this.cooldown <= 0 && (G.input.lmb || G.input.rmb) && !G.paused) {
      const origin = G.player.eyePos, direction = G.player.forward();
      const snow = this.raycast(origin, direction, 2.6);
      const hit = G.world.castRay(new G.R.Ray(origin, direction), 2.6, true, undefined, GROUPS_RAY, G.player.collider);
      const point = snow && (!hit || snow.distance < hit.timeOfImpact) ? snow.point : hit ? origin.clone().addScaledVector(direction, hit.timeOfImpact) : null;
      if (point && this.contains(point.x, point.z) && point.y < this.terrain.heightAt(point.x, point.z) + 0.7) {
        if (G.input.lmb && this.enabled) this.carriedSnow += this.field.remove(point.x, point.z, 0.3, 0.09);
        else if (this.enabled && this.carriedSnow > 0) { const volume = Math.min(this.carriedSnow, 0.012); this.carriedSnow -= this.field.add(point.x, point.z, 0.3, volume); }
        G.audio.play('snow_scoop', { pos: point, vol: 0.5 }); this.cooldown = 0.3;
      }
    }
    // Test digging owns mouse actions; entity pickup still goes through normal E.
    G.input.lmbPressed = G.input.rmbPressed = false;
    if (this.uiTime > 0.3) {
      this.uiTime = 0;
      this.status.textContent = this.enabled ? `${this.firm ? 'Плотный' : 'Рыхлый'} · 28 см · в руках ${(this.carriedSnow * 1000).toFixed(1)} л снега` : 'Твёрдое основание · снег выключен';
    }
    if (G.player.pos.y < this.baseY - 3) { G.player.teleport(this.spawn); msg('Вернулись на испытательную площадку', 'info'); }
  }
  stats() { return { ...this.field.stats(), ...this.renderer.stats(), bootMs: this.bootMs, renderMs: this.renderMs, carriedSnow: this.carriedSnow }; }
}
