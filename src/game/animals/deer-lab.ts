import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { G } from '../ctx';

const LABELS: Record<string, string> = {
  Idle: 'Стоит',
  Walk: 'Шаг',
  Trot: 'Рысь',
  Run: 'Бег',
  Graze: 'Пасётся',
  Alert: 'Насторожился',
  Hit: 'Получает удар',
  LieDown: 'Ложится',
  Lying: 'Лежит',
  StandUp: 'Встаёт',
  Death: 'Смерть',
};

type DeerState = 'idle' | 'walk' | 'graze' | 'lieDown' | 'lying' | 'standUp' | 'alert' | 'retreat' | 'flee';

export class Deer {
  root: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private manual = false;
  private mode: DeerState = 'idle';
  private timer = 3;
  private heading = 0;
  private lastDistance = Infinity;
  private closingTime = 0;

  get state() {
    return this.mode;
  }

  get position() {
    return this.root?.position ?? new THREE.Vector3();
  }

  get animationNames() {
    return [...this.actions.keys()];
  }

  async load(manual = false) {
    this.manual = manual;
    const gltf = await new GLTFLoader().loadAsync('models/deer_ps1.glb');
    this.root = gltf.scene;
    this.root.position.copy(this.findSpawn(manual));
    this.heading = Math.random() * Math.PI * 2;
    this.root.rotation.y = manual ? G.player.yaw : this.heading - Math.PI / 2;
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    });
    G.scene.add(this.root);

    this.mixer = new THREE.AnimationMixer(this.root);
    const order = Object.keys(LABELS);
    const clips = [...gltf.animations].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.play('Idle');
  }

  play(name: string) {
    const next = this.actions.get(name);
    if (!next) return;
    if (this.current && this.current !== next) this.current.fadeOut(0.18);
    const once = ['Death', 'Hit', 'LieDown', 'StandUp'].includes(name);
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.fadeIn(0.18).play();
    this.current = next;
  }

  private enter(mode: DeerState, clip: string, timer: number) {
    this.mode = mode;
    this.timer = timer;
    this.play(clip);
  }

  private findSpawn(manual: boolean) {
    const forward = G.player.forward();
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const offsets = manual ? [[7, 0]] : [[10, 5], [10, -5], [13, 7], [13, -7], [9, 0]];
    for (const [front, side] of offsets) {
      const at = G.player.pos.clone().addScaledVector(forward, front).addScaledVector(right, side);
      if (this.walkable(at.x, at.z)) {
        at.y = G.terrain.heightAt(at.x, at.z) + 0.02;
        return at;
      }
    }
    const at = G.player.pos.clone().addScaledVector(forward, 7);
    at.y = G.terrain.heightAt(at.x, at.z) + 0.02;
    return at;
  }

  private walkable(x: number, z: number) {
    if (!G.region.inside(x, z, 40) || G.region.slopeAt(x, z) > 0.65) return false;
    const water = G.region.waterAt(x, z);
    if (!Number.isNaN(water) && G.region.iceAt(x, z) < 0.15) return false;
    const hb = G.house.bounds;
    if (x > hb.min.x - 1 && x < hb.max.x + 1 && z > hb.min.z - 1 && z < hb.max.z + 2) return false;
    return G.forest.treesNear(x, z, 0.8).length === 0;
  }

  private move(dt: number, speed: number) {
    if (!this.root) return;
    let nx = this.root.position.x + Math.sin(this.heading) * speed * dt;
    let nz = this.root.position.z + Math.cos(this.heading) * speed * dt;
    if (!this.walkable(nx, nz)) {
      for (const offset of [0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 1.9, -1.9, 2.5, -2.5, Math.PI]) {
        const heading = this.heading + offset;
        const x = this.root.position.x + Math.sin(heading) * 0.8;
        const z = this.root.position.z + Math.cos(heading) * 0.8;
        if (!this.walkable(x, z)) continue;
        this.heading = heading;
        nx = this.root.position.x + Math.sin(heading) * speed * dt;
        nz = this.root.position.z + Math.cos(heading) * speed * dt;
        break;
      }
    }
    if (this.walkable(nx, nz)) {
      this.root.position.x = nx;
      this.root.position.z = nz;
    }
    this.root.position.y = G.terrain.heightAt(this.root.position.x, this.root.position.z) + 0.02;
    this.root.rotation.y = this.heading - Math.PI / 2;
  }

  private face(point: THREE.Vector3) {
    if (!this.root) return;
    this.heading = Math.atan2(point.x - this.root.position.x, point.z - this.root.position.z);
    this.root.rotation.y = this.heading - Math.PI / 2;
  }

  private wander() {
    const r = Math.random();
    if (r < 0.38) this.enter('graze', 'Graze', 5 + Math.random() * 5);
    else if (r < 0.82) {
      this.heading += (Math.random() - 0.5) * 2.5;
      this.enter('walk', 'Walk', 4 + Math.random() * 5);
    } else this.enter('lieDown', 'LieDown', 1.5);
  }

  update(dt: number) {
    this.mixer?.update(dt);
    if (this.manual || !this.root || dt <= 0) return;
    this.timer -= dt;
    const distance = this.root.position.distanceTo(G.player.pos);
    const closing = distance < this.lastDistance - 0.005;
    this.closingTime = distance < 12 && closing ? this.closingTime + dt : Math.max(0, this.closingTime - dt * 2);
    this.lastDistance = distance;

    if ((this.mode === 'lying' || this.mode === 'lieDown') && distance < 11) {
      this.enter('standUp', 'StandUp', 1.5);
    } else if (distance < 6 && this.mode !== 'flee') {
      this.enter('flee', 'Run', 4);
    } else if (this.mode !== 'alert' && this.mode !== 'retreat' && this.mode !== 'flee' && this.mode !== 'standUp' && distance < 11) {
      this.enter('alert', 'Alert', 1.1);
    } else if ((this.mode === 'alert' || this.mode === 'retreat') && this.closingTime > 1.2) {
      this.enter('flee', 'Run', 4);
    }

    switch (this.mode) {
      case 'idle':
        if (this.timer <= 0) this.wander();
        break;
      case 'walk':
        this.move(dt, 0.85);
        if (this.timer <= 0) this.enter('idle', 'Idle', 2 + Math.random() * 3);
        break;
      case 'graze':
        if (this.timer <= 0) this.enter('idle', 'Idle', 2 + Math.random() * 3);
        break;
      case 'lieDown':
        if (this.timer <= 0) this.enter('lying', 'Lying', 8 + Math.random() * 8);
        break;
      case 'lying':
        if (this.timer <= 0) this.enter('standUp', 'StandUp', 1.5);
        break;
      case 'standUp':
        if (this.timer <= 0) this.enter(distance < 11 ? 'alert' : 'idle', distance < 11 ? 'Alert' : 'Idle', distance < 11 ? 1.1 : 2);
        break;
      case 'alert':
        this.face(G.player.pos);
        if (this.timer <= 0) this.enter('retreat', 'Walk', 5);
        break;
      case 'retreat':
        this.face(this.root.position.clone().multiplyScalar(2).sub(G.player.pos));
        this.move(dt, 1.25);
        if (distance > 17) this.enter('idle', 'Idle', 2 + Math.random() * 2);
        break;
      case 'flee':
        this.face(this.root.position.clone().multiplyScalar(2).sub(G.player.pos));
        this.move(dt, 5.2);
        if (distance > 35) {
          this.closingTime = 0;
          this.enter('idle', 'Idle', 3);
        }
        break;
    }
  }
}

export class DeerLab {
  private panel: HTMLDivElement;
  private status: HTMLElement;

  constructor(private deer: Deer) {
    this.panel = document.createElement('div');
    this.panel.className = 'snow-panel deer-panel';
    this.panel.innerHTML = `<strong>Олень — тест анимаций</strong><span class="snow-status">Стоит · Idle</span>
      <div class="deer-animations"></div>
      <p>Здесь анимации переключаются вручную. В обычной игре олень сам гуляет, ест, отдыхает и реагирует на вас.</p>
      <a href="./">Обычная игра</a>`;
    document.body.appendChild(this.panel);
    this.status = this.panel.querySelector('.snow-status')!;
    const buttons = this.panel.querySelector('.deer-animations')!;
    for (const name of deer.animationNames) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.clip = name;
      button.textContent = LABELS[name] ?? name;
      button.addEventListener('click', () => {
        this.deer.play(name);
        this.status.textContent = `${LABELS[name] ?? name} · ${name}`;
        this.panel.querySelectorAll<HTMLButtonElement>('[data-clip]').forEach((b) => b.classList.toggle('active', b === button));
      });
      buttons.appendChild(button);
    }
    this.panel.querySelector<HTMLButtonElement>('[data-clip="Idle"]')!.classList.add('active');
  }
}
