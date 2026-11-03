// Small particle effects (chips, snow puffs, glass, sparks, smoke, breath) and a fixed pool
// of point lights (a fixed light count avoids shader recompiles when lights toggle).
import * as THREE from 'three';
import { G } from './ctx';
import { Tex } from '../core/textures';

type PType = 'chips' | 'snow' | 'glass' | 'sparks' | 'smoke' | 'breath' | 'steam' | 'splash';

interface P {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
  type: PType;
  grow: number;
  gravity: number;
  alive: boolean;
}

const POOL = 420;

export class Effects {
  private ps: P[] = [];
  private mats: Record<string, THREE.SpriteMaterial> = {};
  lights: THREE.PointLight[] = [];
  private lightUsed: boolean[] = [];
  spot!: THREE.SpotLight;

  constructor() {
    const flake = Tex.flake();
    const smoke = Tex.smoke();
    const flame = Tex.flame();
    const mk = (key: string, map: THREE.Texture, color: number, blend: THREE.Blending = THREE.NormalBlending, opacity = 1) => {
      this.mats[key] = new THREE.SpriteMaterial({ map, color, transparent: true, depthWrite: false, blending: blend, opacity });
    };
    mk('chips', flake, 0xc8a070);
    mk('snow', flake, 0xffffff);
    mk('glass', flake, 0xd8f0ff, THREE.AdditiveBlending);
    mk('sparks', flame, 0xffaa44, THREE.AdditiveBlending);
    mk('smoke', smoke, 0x9a9a9a);
    mk('breath', smoke, 0xffffff, THREE.NormalBlending, 0.5);
    mk('steam', smoke, 0xffffff, THREE.NormalBlending, 0.6);
    mk('splash', flake, 0x9ab8cc);
    for (let i = 0; i < POOL; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flake, transparent: true, depthWrite: false }));
      s.visible = false;
      G.scene.add(s);
      this.ps.push({ sprite: s, vel: new THREE.Vector3(), life: 0, max: 1, type: 'snow', grow: 0, gravity: 0, alive: false });
    }
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xffa050, 0, 8, 1.6);
      l.castShadow = false;
      l.position.set(0, -500, 0);
      G.scene.add(l);
      this.lights.push(l);
      this.lightUsed.push(false);
    }
    this.spot = new THREE.SpotLight(0xfff2dd, 0, 28, 0.42, 0.45, 1.3);
    this.spot.castShadow = false;
    G.camera.add(this.spot);
    G.camera.add(this.spot.target);
    this.spot.position.set(0.15, -0.15, 0);
    this.spot.target.position.set(0, 0, -5);
  }

  acquireLight(): THREE.PointLight | null {
    for (let i = 0; i < this.lights.length; i++) {
      if (!this.lightUsed[i]) {
        this.lightUsed[i] = true;
        return this.lights[i];
      }
    }
    return null;
  }

  releaseLight(l: THREE.PointLight | null) {
    if (!l) return;
    const i = this.lights.indexOf(l);
    if (i >= 0) {
      this.lightUsed[i] = false;
      l.intensity = 0;
      l.position.set(0, -500, 0);
    }
  }

  private spawn(type: PType, pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, grow = 0, gravity = 0) {
    const p = this.ps.find((q) => !q.alive);
    if (!p) return;
    p.alive = true;
    p.type = type;
    p.life = 0;
    p.max = life;
    p.grow = grow;
    p.gravity = gravity;
    p.vel.copy(vel);
    const t = this.mats[type];
    const m = p.sprite.material;
    m.map = t.map;
    m.color.copy(t.color);
    m.blending = t.blending;
    m.opacity = t.opacity;
    p.sprite.position.copy(pos);
    p.sprite.scale.setScalar(size);
    p.sprite.visible = true;
  }

  burst(type: PType, pos: THREE.Vector3, n = 10, dir?: THREE.Vector3) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5);
      if (dir) v.addScaledVector(dir, 1.2);
      switch (type) {
        case 'chips':
          this.spawn('chips', pos, v.multiplyScalar(2.5), 0.7 + Math.random() * 0.5, 0.03 + Math.random() * 0.03, 0, 9);
          break;
        case 'snow':
          this.spawn('snow', pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 2, (Math.random() - 0.5) * 1.5)), v.multiplyScalar(0.6), 1.5 + Math.random(), 0.06 + Math.random() * 0.08, 0.05, 1.5);
          break;
        case 'glass':
          this.spawn('glass', pos, v.multiplyScalar(3), 0.6 + Math.random() * 0.4, 0.025, 0, 9);
          break;
        case 'sparks':
          this.spawn('sparks', pos, v.multiplyScalar(1.2).setY(Math.random() * 1.5 + 0.5), 0.6 + Math.random() * 0.8, 0.03, 0, -0.5);
          break;
        case 'splash':
          this.spawn('splash', pos, v.multiplyScalar(2.2), 0.6, 0.06, 0, 7);
          break;
        default:
          this.spawn(type, pos, v.multiplyScalar(0.3), 2, 0.2, 0.4);
      }
    }
  }

  smoke(pos: THREE.Vector3, amount = 1) {
    const w = G.weather;
    const wind = new THREE.Vector3(Math.cos(w.windDir), 0, Math.sin(w.windDir)).multiplyScalar(Math.min(w.wind, 12) * 0.25);
    this.spawn('smoke', pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0, (Math.random() - 0.5) * 0.15)), new THREE.Vector3(0, 0.6 + Math.random() * 0.4, 0).add(wind), 4 + Math.random() * 2, 0.3 * amount, 0.5 * amount);
  }

  breath(pos: THREE.Vector3, dir: THREE.Vector3) {
    for (let i = 0; i < 3; i++) {
      this.spawn('breath', pos.clone().addScaledVector(dir, 0.25 + i * 0.03), dir.clone().multiplyScalar(0.35).add(new THREE.Vector3(0, 0.08, 0)), 1.1, 0.06, 0.35);
    }
  }

  steam(pos: THREE.Vector3) {
    this.spawn('steam', pos, new THREE.Vector3((Math.random() - 0.5) * 0.05, 0.25, (Math.random() - 0.5) * 0.05), 1.5, 0.08, 0.25);
  }

  update(dt: number) {
    for (const p of this.ps) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const s = p.sprite.scale.x + p.grow * dt;
      p.sprite.scale.setScalar(s);
      const t = p.life / p.max;
      const base = p.type === 'breath' ? 0.45 : p.type === 'smoke' ? 0.55 : p.type === 'steam' ? 0.5 : 1;
      p.sprite.material.opacity = base * (1 - t);
      if ((p.type === 'chips' || p.type === 'glass' || p.type === 'splash') && p.sprite.position.y < G.terrain.heightAt(p.sprite.position.x, p.sprite.position.z)) {
        p.vel.set(0, 0, 0);
        p.gravity = 0;
      }
    }
  }
}
