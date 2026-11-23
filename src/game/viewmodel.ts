// Equipment uses the same world scene/depth as the actual Survivor hands.
import * as THREE from 'three';
import { handGrips, type Grip } from './hands';
import { G } from './ctx';
import { journal } from './journal/journal';
import { buildItemMesh } from './meshes';
import { Tex } from '../core/textures';
import type { Entity } from './entities';

export class ViewModel {
  private holder = new THREE.Group();
  private profile?: Grip;
  private current: Entity | null = null;
  private mesh: THREE.Object3D | null = null;
  private flame: THREE.Sprite;
  constructor() {
    handGrips.journal = journal.grip;
    journal.init();
    this.holder.name = 'held-equipment';
    G.scene.add(this.holder);
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: Tex.flame(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.flame.scale.set(0.05, 0.08, 1);
    this.flame.visible = false;
    this.holder.add(this.flame);
  }
  resize(_aspect: number) { /* Uses the main camera. */ }
  swing(_dur: number, _kind: 'chop' | 'saw' | 'poke') { /* The authoritative interaction clock drives Hands. */ }
  update(_dt: number) {
    const p = G.player, eq = journal.active ? journal.entity : p.equipped;
    const profile = handGrips[eq?.defId ?? ''];
    if (eq !== this.current || profile !== this.profile) {
      this.profile = profile;
      if (this.mesh) this.holder.remove(this.mesh);
      // Item geometry/materials come from shared caches; do not dispose them here.
      this.mesh = eq ? (profile?.createVisual?.() ?? buildItemMesh(eq.defId, eq.params)) : null;
      this.mesh?.traverse(c => { c.castShadow = c.receiveShadow = true; });
      if (this.mesh) this.holder.add(this.mesh);
      this.current = eq;
    }
    const hands = p.avatar.hands;
    this.holder.position.copy(hands.item.position);
    this.holder.quaternion.copy(hands.item.quaternion);
    this.holder.visible = !p.carried && !G.sleeping && !G.dead && hands.state !== 'warm' && hands.state !== 'brush' && !G.recorder?.reviewing;
    this.flame.visible = !journal.active && (!!G.interact?.flame || !!(eq?.defId === 'lamp' && eq.lit));
    const fl = 0.85 + Math.random() * 0.3;
    this.flame.position.set(eq?.defId === 'lamp' ? 0 : -0.02, eq?.defId === 'lamp' ? 0 : 0.07, 0);
    this.flame.scale.set(0.04 * fl, 0.07 * fl, 1);
  }
  render(_renderer: THREE.WebGLRenderer) { /* Main pass draws hands and equipment together. */ }
}
