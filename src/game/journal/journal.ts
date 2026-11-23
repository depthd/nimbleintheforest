import * as THREE from 'three';
import { G, msg } from '../ctx';
import { Entity } from '../entities';
import type { Grip } from '../hands';
import { createJournalModel } from './model';

function percent(fraction: number) {
  return Math.round(100 * THREE.MathUtils.clamp(fraction, 0, 1));
}

/** Personal journal is a presentation item, never inserted into physics or inventory. */
class Journal {
  readonly entity = new Entity('item');
  open = false;
  progress = 0;
  private art?: ReturnType<typeof createJournalModel>;
  private lastState = '';
  private sprintLower = 0;
  constructor() { this.entity.defId = 'journal'; this.entity.name = 'Дневник'; }
  get active() { return this.open || this.progress > 0; }
  init() {
    const face = new FontFace('Neucha', `url(${(import.meta as any).env.BASE_URL}fonts/neucha.ttf)`);
    face.load().then(font => { document.fonts.add(font); this.art?.textures.refreshFonts(); this.lastState = ''; }).catch(() => msg('Шрифт дневника недоступен', 'warn'));
  }
  readonly grip: Grip = {
    right: new THREE.Vector3(.225, -.14, -.015),
    left: new THREE.Vector3(-.225, -.14, -.015),
    sockets: {
      right: {position: new THREE.Vector3(.225, -.14, -.015), rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, .5))},
      left: {position: new THREE.Vector3(-.225, -.14, -.015), rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, -.5))},
    },
    rotation: new THREE.Euler(-.12, 0, 0),
    createVisual: () => {
      this.art ??= createJournalModel(G.renderer);
      this.lastState = '';
      return this.art.model;
    },
    samplePose: ({ position, rotation }) => {
      const k = this.progress * this.progress * (3 - 2 * this.progress);
      const aspect = G.camera.aspect;
      const feet = G.player.avatar.motion.feet;
      const step = G.player.moving ? feet.reduce((v, f, i) => v + (f.swinging ? Math.sin(f.progress * Math.PI) * (i ? -1 : 1) : 0), 0) : 0;
      const lower = this.sprintLower;
      const bob = step * .005 * (1 - lower);
      const z = -Math.max(.40, .43 / Math.max(.65, aspect));
      position.copy(G.camera.localToWorld(new THREE.Vector3(0, -.10 - .52 * (1 - k) - .30 * lower + bob, z + .14 * (1 - k))));
      rotation.copy(G.camera.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-.12 - .65 * (1 - k) - .65 * lower, 0, .06 * (1 - k) + step * .008 * (1 - lower))));
    },
  };
  update(dt: number) {
    const inp = G.input;
    if (inp.pressed.has('KeyJ')) {
      if (this.active) this.open = !this.open;
      else if (!G.hud.modal && inp.locked && !G.sleeping && !G.dead && !G.player.carried && !G.interact.swinging && !G.interact.timed && !G.recorder?.reviewing) {
        this.open = true;
        G.player.handsWarming = false;
        msg('Дневник · J / О — убрать', 'info', 3);
      }
    }
    if (inp.pressed.has('Escape')) this.open = false;
    if (G.hud.modal || G.sleeping || G.dead || G.player.carried || G.recorder?.reviewing) { this.open = false; this.progress = 0; }
    this.progress = THREE.MathUtils.clamp(this.progress + (this.open ? 1 : -1) * dt / .65, 0, 1);
    document.body.classList.toggle('journal-reading', this.active);
    this.sprintLower = THREE.MathUtils.damp(this.sprintLower, this.active && G.player.sprinting ? 1 : 0, 10, dt);
    if (!this.active || !this.art) return;
    const b = G.body;
    const state = {
      hunger: percent(1 - b.kcal / 3000),
      thirst: percent(1 - b.water / 3),
      fatigue: percent(b.fatigue),
      temperature: Math.round(b.felt),
      frost: percent(Math.max(b.frostHands, b.frostFeet)),
      wetness: percent(b.wetness),
      condition: Math.round(b.condition),
      stamina: percent(G.player.stamina),
    };
    const key = JSON.stringify(state);
    if (key !== this.lastState) { this.art.textures.update(state); this.lastState = key; }
  }
}
export const journal = new Journal();
