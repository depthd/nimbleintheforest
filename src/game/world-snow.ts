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
  private weatherTime = G.time;

  constructor() {
    G.snowCover.upload();
    this.terrain = new WorldSnowTerrain(G.region, (x,z) => G.snowCover.looseAt(x,z,this.terrain.heightAt(x,z)));
    this.field = new SnowField({ thickness: 0.28, densityRatio: 2.6, base: this.terrain.heightAt,
      coverage: this.terrain.retentionAt, contains: (x, z) => this.contains(x, z) });
    this.renderer = new SnowTrailRenderer(this.field, this.bounds);
    this.renderer.group.name = 'world-snow'; G.scene.add(this.renderer.group);
    groundUniforms.uWorldSnow.value = 1;
    G.terrain.enableSnow((x,z) => this.field.initialThickness(x,z), (x,z,size) => G.snowCover.detailedAt(x,z,size) || this.terrain.detailedAt(x,z,size));
    this.renderer.update(G.player.pos);
  }
  contains(x: number, z: number) {
    if (!G.region.inside(x, z, 0.1)) return false;
    const water = this.terrain.waterLevelAt(x, z);
    if (Number.isFinite(water) && this.terrain.heightAt(x, z) <= water) return false;
    return G.snowCover.looseAt(x,z,this.terrain.heightAt(x,z)) > 0.0001;
  }
  packedBase(x: number, z: number) {
    const base=this.terrain.heightAt(x,z), water=this.terrain.waterLevelAt(x,z);
    return G.region.inside(x,z,0.1) && (!Number.isFinite(water) || base>water) && !G.snowCover.floorAt(x,z,base) && this.terrain.substrateAt(x,z)>0.03;
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
    if (G.player.water || G.sleeping || G.dead || G.caves?.inside) { this.resetBoots(); return; }
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
  /** Clear the snow down to the ground for a fire pit; the snow goes into a rim around it. */
  clearPit(point: THREE.Vector3, radius = 0.55) {
    if (!this.contains(point.x, point.z)) return;
    let v = 0;
    for (let i = 0; i < 8; i++) v += this.field.remove(point.x, point.z, radius, 0.2);
    const n = 10;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      this.field.add(point.x + Math.cos(a) * (radius + 0.35), point.z + Math.sin(a) * (radius + 0.35), 0.3, v / n);
    }
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
