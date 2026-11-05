import * as THREE from 'three';
import { G } from './ctx';
import { SnowField } from '../world/snow-field';
import type { BootPose } from '../world/snow-field';
import { SnowTrailRenderer } from '../world/snow-trails';
import { WorldSnowTerrain } from '../world/snow-terrain';
import { groundUniforms } from '../world/terrain';
import { footPose } from './locomotion';
import type { FootSurface } from './locomotion';

export class WorldSnow {
  readonly isExperiment = false;
  readonly enabled = true;
  readonly bounds = { minX: G.region.minX, minZ: G.region.minZ, maxX: G.region.maxX, maxZ: G.region.maxZ };
  readonly terrain: WorldSnowTerrain;
  readonly field: SnowField;
  readonly renderer: SnowTrailRenderer;
  carriedSnow = 0;
  bootMs = 0;
  renderMs = 0;
  private lastBoots: BootPose[] | null = null;
  private cooldown = 0;
  private roofs = new Map<string, typeof G.structures.shelters>();
  private roofX = Infinity;
  private roofZ = Infinity;
  private nearbyRoofs: typeof G.structures.shelters = [];
  private weatherTime = G.time;

  constructor() {
    // A roof lookup visits only shelters in this 64 m neighbourhood.
    for (const b of G.structures.shelters) {
      if (b.shelter.kind === 'tower') continue;
      const radius = Math.hypot(b.hx, b.hz);
      for (let z = Math.floor((b.cz - radius) / 64); z <= Math.floor((b.cz + radius) / 64); z++)
        for (let x = Math.floor((b.cx - radius) / 64); x <= Math.floor((b.cx + radius) / 64); x++) {
          const key = `${x},${z}`, list = this.roofs.get(key) ?? [];
          list.push(b); this.roofs.set(key, list);
        }
    }
    this.terrain = new WorldSnowTerrain(G.region, (x, z) => this.contains(x, z));
    this.field = new SnowField({ thickness: 0.28, densityRatio: 2.6, base: this.terrain.heightAt,
      coverage: this.terrain.retentionAt, contains: (x, z) => this.contains(x, z) });
    this.renderer = new SnowTrailRenderer(this.field, this.bounds);
    this.renderer.group.name = 'world-snow'; G.scene.add(this.renderer.group);
    groundUniforms.uWorldSnow.value = 1;
    G.terrain.enableSnow((x,z) => this.field.initialThickness(x,z));
    this.renderer.update(G.player.pos);
  }
  contains(x: number, z: number) {
    if (!G.region.inside(x, z, 0.1)) return false;
    const water = G.region.waterAt(x, z);
    if (!Number.isNaN(water) && G.region.heightAt(x, z) < water + 0.03) return false;
    const b = G.house.bounds;
    if (x > b.min.x - 0.15 && x < b.max.x + 0.15 && z > b.min.z - 0.15 && z < b.max.z + 0.15) return false;
    if (Math.abs(x) < 2.4 && z > 3.8 && z < 6.3) return false;
    const rx = Math.floor(x / 64), rz = Math.floor(z / 64);
    if (rx !== this.roofX || rz !== this.roofZ) {
      this.roofX = rx; this.roofZ = rz; this.nearbyRoofs = this.roofs.get(`${rx},${rz}`) ?? [];
    }
    for (const r of this.nearbyRoofs) {
      const dx = x - r.cx, dz = z - r.cz, c = Math.cos(r.yaw), s = Math.sin(r.yaw);
      if (Math.abs(dx * c - dz * s) < r.hx && Math.abs(dx * s + dz * c) < r.hz) return false;
    }
    return true;
  }
  resetBoots() { this.lastBoots = null; }
  probe(surface: FootSurface): FootSurface {
    const { x, z } = surface.point;
    if (surface.support === undefined || !G.terrain.handles.has(surface.support) || !this.contains(x, z)) return surface;
    const support = this.field.support(x, z);
    return { point: new THREE.Vector3(x, this.terrain.heightAt(x, z) + support + 0.012, z), normal: surface.normal,
      support: surface.support, snowDepth: Math.max(0, this.field.sample(x, z).height - support) };
  }
  movement(x: number, z: number, y: number) {
    if (!this.contains(x, z) || this.terrain.inclineAt(x, z) > Math.tan(48 * Math.PI / 180)) return null;
    const ground = this.terrain.heightAt(x, z), support = this.field.support(x, z), height = ground + support + 0.03;
    if (y < ground - 0.15 || y > height + 0.22) return null;
    const depth = Math.max(0, this.field.sample(x, z).height - support);
    return { height, speed: 1 / (1 + depth * 3) };
  }
  step() {
    if (G.player.water || G.sleeping || G.dead) { this.resetBoots(); return; }
    const start = performance.now(), poses = G.player.avatar.motion.feet.map(f => footPose(f));
    if (this.lastBoots) for (let i = 0; i < poses.length; i++) this.field.sweepBoot(this.lastBoots[i], poses[i]);
    this.lastBoots = poses; this.bootMs = performance.now() - start;
  }
  raycast(origin: THREE.Vector3, direction: THREE.Vector3, reach: number) {
    const inside = (d: number) => {
      const x = origin.x + direction.x * d, z = origin.z + direction.z * d, y = origin.y + direction.y * d;
      if (!this.contains(x, z)) return false;
      const base = this.terrain.heightAt(x, z), h = this.field.sample(x, z).height;
      return h > 0.004 && y >= base - 0.01 && y <= base + h;
    };
    for (let d = 0; d <= reach; d += 0.025) if (inside(d)) {
      let lo = Math.max(0, d - 0.025), hi = d;
      for (let i = 0; i < 6; i++) { const mid = (lo + hi) / 2; if (inside(mid)) hi = mid; else lo = mid; }
      return { distance: hi, point: origin.clone().addScaledVector(direction, hi) };
    }
    return null;
  }
  dig(point: THREE.Vector3) {
    if (this.cooldown > 0 || !this.contains(point.x, point.z)) return;
    this.carriedSnow += this.field.remove(point.x, point.z, 0.3, 0.09);
    this.cooldown = 0.3; G.audio.play('snow_scoop', { pos: point, vol: 0.5 });
  }
  deposit(point: THREE.Vector3) {
    if (this.cooldown > 0 || this.carriedSnow <= 0 || !this.contains(point.x, point.z)) return;
    this.carriedSnow -= this.field.add(point.x, point.z, 0.3, Math.min(this.carriedSnow, 0.012));
    this.cooldown = 0.3; G.audio.play('snow_scoop', { pos: point, vol: 0.5 });
  }
  update(dt: number) {
    const elapsed = Math.max(0, G.time - this.weatherTime); this.weatherTime = G.time;
    this.field.advanceWeather(elapsed, G.weather);
    this.cooldown = Math.max(0, this.cooldown - dt);
    const start = performance.now(); this.renderer.update(G.player.pos); this.renderMs = performance.now() - start;
  }
}
