// Quiet dread: distant howls at night, a knock on the door, and when the body is failing,
// whispers and a figure at the edge of vision that is gone when you look.
import * as THREE from 'three';
import { G, dayOf, hourOf } from './ctx';

export class Horror {
  private figure: THREE.Group;
  private figureT = 0;
  private knockNight = -1;
  private cooldown = 30;

  constructor() {
    const m = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1 });
    this.figure = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.6, 4, 8), m);
    body.position.y = 1.1;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), m);
    head.position.y = 2.15;
    this.figure.add(body, head);
    this.figure.visible = false;
    G.scene.add(this.figure);
  }

  update(dtGame: number, dtReal: number) {
    if (!G.settings.horror || G.dead) {
      this.figure.visible = false;
      return;
    }
    const h = hourOf(G.time);
    const night = h >= 21 || h < 5.5;
    const P = G.player;
    const B = G.body;
    // distant wolves
    if (night && Math.random() < dtGame * (0.6 / 3600)) {
      const a = Math.random() * Math.PI * 2;
      G.audio.play('howl', { pos: P.pos.clone().add(new THREE.Vector3(Math.cos(a) * 40, 0, Math.sin(a) * 40)), vol: 3 });
    }
    // a knock at the door, once some nights
    const zone = G.house.zoneAt(P.pos);
    const day = dayOf(G.time);
    if (zone && h >= 0 && h < 4 && this.knockNight !== day && !G.house.door.removed && !G.house.door.data.open && !G.sleeping) {
      if (Math.random() < dtGame * (0.35 / 3600)) {
        this.knockNight = day;
        G.audio.play('knock', { pos: G.house.door.position(), vol: 1.4 });
      }
    }
    // hallucinations when hypothermic or exhausted at night
    const level = B.halluc + (night && B.fatigue > 0.85 ? 0.35 : 0);
    this.cooldown -= dtReal;
    if (level > 0.25 && Math.random() < dtReal * 0.05 * level) G.audio.play('whisper', { vol: 0.8 + level });
    if (this.figure.visible) {
      this.figureT -= dtReal;
      const to = this.figure.position.clone().sub(G.camera.position).normalize();
      const look = P.forward();
      if (this.figureT <= 0 || to.dot(look) > 0.975) this.figure.visible = false;
    } else if (level > 0.3 && this.cooldown <= 0 && !zone) {
      this.cooldown = 25 + Math.random() * 40;
      const side = Math.random() < 0.5 ? -1 : 1;
      const a = P.yaw + side * (0.7 + Math.random() * 0.4);
      const d = 20 + Math.random() * 14;
      const x = P.pos.x - Math.sin(a) * d, z = P.pos.z - Math.cos(a) * d;
      this.figure.position.set(x, G.terrain.heightAt(x, z), z);
      this.figure.lookAt(P.pos.x, this.figure.position.y, P.pos.z);
      this.figure.visible = true;
      this.figureT = 3 + Math.random() * 3;
    }
  }
}
