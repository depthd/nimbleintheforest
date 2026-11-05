// The equipped item drawn in the lower right of the screen, with swing animation,
// match/lighter flame and lamp glow.
import * as THREE from 'three';
import { G } from './ctx';
import { buildItemMesh } from './meshes';
import { Tex } from '../core/textures';
import type { Entity } from './entities';

export class ViewModel {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private holder = new THREE.Group();
  private current: Entity | null = null;
  private mesh: THREE.Object3D | null = null;
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private flame: THREE.Sprite;
  swingT = -1;
  swingDur = 0.6;
  swingKind: 'chop' | 'saw' | 'poke' = 'chop';
  private t = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(this.camera);
    this.camera.add(this.holder);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 1);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 0.8);
    this.key.position.set(1, 2, 1);
    this.scene.add(this.key);
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: Tex.flame(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.flame.scale.set(0.05, 0.08, 0.05);
    this.flame.visible = false;
    this.holder.add(this.flame);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  swing(dur: number, kind: 'chop' | 'saw' | 'poke') {
    this.swingT = 0;
    this.swingDur = dur;
    this.swingKind = kind;
  }

  private rebuild(e: Entity | null) {
    if (this.mesh) {
      this.holder.remove(this.mesh);
      this.mesh = null;
    }
    this.current = e;
    if (!e) return;
    const m = buildItemMesh(e.defId, e.params);
    m.traverse((c) => {
      c.castShadow = false;
      c.receiveShadow = false;
    });
    const id = e.defId;
    const long = ['axe', 'hatchet', 'hammer', 'prybar', 'shovel', 'auger', 'rod', 'flashlight'].includes(id);
    const scale = id === 'shovel' || id === 'auger' ? 0.6 : id === 'rod' ? 0.7 : 1;
    m.scale.setScalar(scale);
    if (long) {
      m.rotation.set(-0.35, 0.25, 0.15);
      if (id === 'flashlight') m.rotation.set(-Math.PI / 2, 0, 0);
    } else if (id === 'saw' || id === 'knife' || id === 'shard') {
      m.rotation.set(0, Math.PI, 0);
      m.rotation.x = 0.3;
    } else {
      m.rotation.set(0.3, 0.6, 0);
    }
    this.mesh = m;
    this.holder.add(m);
  }

  update(dt: number) {
    this.t += dt;
    const eq = G.player.equipped;
    if (eq !== this.current) this.rebuild(eq);
    const flameOn = G.interact?.flame;
    this.flame.visible = !!flameOn || !!(eq?.defId === 'lamp' && eq.lit);
    // base pose
    const p = G.player;
    const feet = p.avatar.motion.feet;
    const swing = feet.map(f => f.swinging ? Math.sin(f.progress * Math.PI) : 0);
    const bob = p.moving ? (swing[0] - swing[1]) * 0.012 : Math.sin(this.t * 1.5) * 0.004;
    const id = eq?.defId ?? '';
    const long = ['axe', 'hatchet', 'hammer', 'prybar', 'shovel', 'auger', 'rod'].includes(id);
    let x = 0.3, y = -0.3 + bob, z = -0.55;
    if (long) {
      x = 0.32;
      y = -0.42 + bob;
      z = -0.6;
    }
    let rx = 0, ry = 0, rz = 0;
    if (this.swingT >= 0) {
      this.swingT += dt;
      const k = this.swingT / this.swingDur;
      if (k >= 1) this.swingT = -1;
      else if (this.swingKind === 'chop') {
        // raise then strike down
        const up = k < 0.45 ? k / 0.45 : 1 - (k - 0.45) / 0.2;
        const a = k < 0.45 ? up * 0.9 : k < 0.65 ? 0.9 - ((k - 0.45) / 0.2) * 2.0 : -1.1 + ((k - 0.65) / 0.35) * 1.1;
        rx = a;
        z -= Math.max(0, -a) * 0.15;
        x -= Math.max(0, -a) * 0.08;
      } else if (this.swingKind === 'saw') {
        z += Math.sin(k * Math.PI * 2) * 0.12;
      } else {
        z -= Math.sin(k * Math.PI) * 0.15;
      }
    }
    this.holder.position.set(x, y, z);
    this.holder.rotation.set(rx, ry, rz);
    if (this.flame.visible) {
      const fl = 0.85 + Math.random() * 0.3;
      if (eq?.defId === 'lamp') {
        this.flame.position.set(0, 0.0, 0);
        this.flame.scale.set(0.035 * fl, 0.06 * fl, 1);
      } else {
        this.flame.position.set(-0.02, 0.07, 0);
        this.flame.scale.set(0.04 * fl, 0.07 * fl, 1);
      }
    }
    // light the viewmodel roughly like the world
    const amb = G.sky.hemi.intensity;
    const near = G.fires.nearest(G.player.pos);
    const fireK = near.level > 0 && near.pos ? Math.min(1.2, near.level * 3 / (1 + near.pos.distanceTo(G.player.pos) ** 2 * 0.3)) : 0;
    const lamp = this.flame.visible || G.fx.spot.intensity > 0 ? 0.6 : 0;
    this.hemi.intensity = Math.min(1.4, amb * 0.9 + fireK + lamp + 0.03);
    this.key.intensity = Math.min(1, G.sky.daylight * 0.6 * (G.sky.indoorFactor) + fireK * 0.5);
    this.hemi.color.setRGB(1, fireK > 0.2 ? 0.8 : 0.95, fireK > 0.2 ? 0.6 : 0.9);
  }

  render(renderer: THREE.WebGLRenderer) {
    if (!this.mesh) return;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
