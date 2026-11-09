import * as THREE from 'three';
import { G } from './ctx';

export type HandAction = 'idle' | 'brush' | 'airborne' | 'walk' | 'run' | 'crouch' | 'hold' | 'carry' | 'warm' | 'chop' | 'saw' | 'reach' | 'work' | 'eat' | 'drink' | 'ignite' | 'dig' | 'pour' | 'throw';
export interface Grip { right: THREE.Vector3; left?: THREE.Vector3; rotation: THREE.Euler }
/** Item-local palm anchors in metres. New items (including the journal) can register a grip. */
export const handGrips: Record<string, Grip> = {};
const grip = (right: number[], left?: number[], rotation = [-0.35, 0.25, 0.15]): Grip => ({
  right: new THREE.Vector3().fromArray(right), left: left ? new THREE.Vector3().fromArray(left) : undefined,
  rotation: new THREE.Euler().fromArray(rotation as [number, number, number]),
});
for (const id of ['axe', 'shovel', 'auger', 'rod']) handGrips[id] = grip([0, -0.18, 0], [0, 0, 0]);
for (const id of ['hatchet', 'hammer', 'prybar']) handGrips[id] = grip([0, -0.1, 0]);
handGrips.saw = grip([0, 0, -0.26], undefined, [0, Math.PI, 0]);
handGrips.knife = grip([0, 0, -0.07], undefined, [0, Math.PI, 0]);
handGrips.flashlight = grip([0, 0, 0], undefined, [-Math.PI / 2, 0, 0]);
const fallback = grip([0, -0.04, 0], undefined, [0.3, 0.6, 0]);

export function actionFor(label: string): HandAction {
  if (/отрях/i.test(label)) return 'brush';
  if (/снег|раскоп/i.test(label) && !/съесть/i.test(label)) return /высып/i.test(label) ? 'pour' : 'dig';
  if (/пить|выпить|чай/i.test(label)) return 'drink';
  if (/съесть|есть|откус/i.test(label)) return 'eat';
  if (/зажечь|поджечь|спич|разжечь/i.test(label)) return 'ignite';
  if (/пил|распуст/i.test(label)) return 'saw';
  if (/брос/i.test(label)) return 'throw';
  if (/руб|бить|колоть/i.test(label)) return 'chop';
  if (/копать|прибить|сверл|снять|открыть|закрыть|обыск|готов|обтес/i.test(label)) return 'work';
  return 'reach';
}

/** Two rigid bones, a pole vector, and a bounded wrist. Never stretch an arm to a distant target. */
export function solveArm(shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, upper = 0.29, lower = 0.27) {
  const axis = target.clone().sub(shoulder);
  const distance = THREE.MathUtils.clamp(axis.length(), Math.abs(upper - lower) + 0.001, upper + lower - 0.001);
  if (axis.lengthSq() < 1e-10) axis.set(0, -1, 0); else axis.normalize();
  const bend = pole.clone().addScaledVector(axis, -pole.dot(axis));
  if (bend.lengthSq() < 1e-8) bend.set(Math.abs(axis.x) < 0.9 ? 1 : 0, Math.abs(axis.x) < 0.9 ? 0 : 1, 0).addScaledVector(axis, -bend.dot(axis));
  bend.normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const elbow = shoulder.clone().addScaledVector(axis, along).addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - along * along)));
  return { elbow, wrist: shoulder.clone().addScaledVector(axis, distance) };
}

export interface ArmReference { shoulder: THREE.Group; elbow: THREE.Group; wrist?: THREE.Vector3; handRotation?: THREE.Quaternion }
export class Hands {
  readonly item = new THREE.Object3D();
  readonly palms = [new THREE.Object3D(), new THREE.Object3D()]; // left, right; world-space attachment transforms
  state: HandAction = 'idle';
  progress = 0;
  private elapsed = 0;
  private transient: { kind: HandAction; t: number; duration: number } | null = null;
  private targets = [new THREE.Vector3(), new THREE.Vector3()];
  private ready = false;
  begin(kind: HandAction, duration = 0.55) { this.transient = { kind, t: 0, duration: Math.max(0.1, duration) }; }
  cancel() { this.transient = null; }
  diagnostics() { return { state: this.state, progress: this.progress, palms: this.palms.map(p => p.position.toArray()), item: this.item.position.toArray() }; }

  update(dt: number, arms: ArmReference[]) {
    const p = G.player, interaction = G.interact;
    const active = !G.paused && !G.dead && !G.sleeping && !G.recorder?.reviewing;
    if (active) { this.elapsed += dt; if (this.transient) { this.transient.t += dt; if (this.transient.t >= this.transient.duration) this.transient = null; } }
    const eq = p.carried ? null : p.equipped;
    const spec = handGrips[eq?.defId ?? ''] ?? fallback;
    const timed = interaction?.timed, swing = interaction?.swinging;
    this.state = p.handsWarming ? 'warm' : swing ? (swing.tool.defId === 'saw' ? 'saw' : 'chop') : timed ? actionFor(timed.action.label) : this.transient?.kind ?? (p.carried ? 'carry' : eq ? 'hold' : !p.grounded ? 'airborne' : p.sprinting ? 'run' : p.moving ? 'walk' : p.crouch ? 'crouch' : 'idle');
    this.progress = swing ? swing.t / swing.dur : timed ? timed.t / (timed.action.time || 1) : this.transient ? this.transient.t / this.transient.duration : 0;
    const phase = Math.min(1, this.progress), pulse = Math.sin(phase * Math.PI);
    // Use the ordinary anatomical camera even when F6 selects an inspection camera.
    const camera = G.camera;
    camera.updateMatrixWorld(true);
    const toWorld = (v: THREE.Vector3) => camera.localToWorld(v);
    const cameraQ = camera.getWorldQuaternion(new THREE.Quaternion());
    const feet = p.avatar.motion.feet;
    const bob = feet[0].swinging ? Math.sin(feet[0].progress * Math.PI) : feet[1].swinging ? -Math.sin(feet[1].progress * Math.PI) : 0;
    const itemPos = spec.left ? new THREE.Vector3(-0.02, -0.06, -0.43) : new THREE.Vector3(0.23, -0.20, eq?.defId === 'saw' ? -0.60 : -0.43);
    const itemRot = spec.rotation.clone();
    if (p.moving) { itemPos.y += bob * (p.sprinting ? 0.045 : 0.014); itemRot.z += bob * 0.04; }
    if (p.crouch) itemPos.y += 0.04;
    if (this.state === 'chop') { itemRot.x += Math.sin(phase * Math.PI * 2) * 1.2; itemPos.y += Math.sin(phase * Math.PI * 2) * 0.12; }
    if (this.state === 'saw' || this.state === 'work') itemPos.z -= Math.sin(phase * Math.PI * 6) * 0.065;
    if (this.state === 'eat' || this.state === 'drink') { itemPos.set(0.04, -0.13, -0.2); itemRot.x += pulse * 0.8; }
    this.item.position.copy(toWorld(itemPos));
    this.item.quaternion.copy(cameraQ).multiply(new THREE.Quaternion().setFromEuler(itemRot));
    this.item.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      const sign = i ? 1 : -1, arm = arms[i];
      const local = new THREE.Vector3(sign * 0.26, p.crouch ? -0.16 : -0.18, -0.43);
      if (p.moving) { local.z += sign * bob * (p.sprinting ? 0.17 : 0.08); local.y += p.sprinting ? 0.06 : 0.02; }
      let desired = toWorld(local);
      if (eq && (i === 1 || spec.left)) desired = this.item.localToWorld((i ? spec.right : spec.left!).clone());
      if (p.carried) {
        const bounds = p.carried.obj ? new THREE.Box3().setFromObject(p.carried.obj) : null;
        desired = p.carried.position().add(new THREE.Vector3(sign * Math.min(0.24, bounds ? bounds.getSize(new THREE.Vector3()).x * 0.4 : 0.2), 0.04, 0));
      }
      if (this.state === 'brush') desired = toWorld(new THREE.Vector3(-sign * (0.08 + Math.sin(phase * Math.PI * 6) * 0.12), -0.34, -0.18));
      else if (this.state === 'airborne') desired = toWorld(new THREE.Vector3(sign * 0.35, -0.24, -0.32));
      else if (this.state === 'warm') desired = toWorld(new THREE.Vector3(-sign * 0.16, -0.33, -0.13));
      else if (['reach', 'dig', 'pour', 'work', 'ignite', 'throw'].includes(this.state)) {
        if (!eq || i === 0) {
          const target = interaction?.target;
          const contact = target && target.kind !== 'none' ? target.point.clone() : toWorld(new THREE.Vector3(sign * 0.15, -0.25, -0.5));
          if (this.state === 'dig' || this.state === 'pour') contact.x += sign * 0.07;
          desired.lerp(contact, this.state === 'work' ? 0.65 + Math.sin(phase * Math.PI * 8) * 0.12 : pulse);
        }
      } else if ((this.state === 'eat' || this.state === 'drink') && i === 1) desired = toWorld(new THREE.Vector3(0.04, -0.13, -0.2));
      if (eq && (i === 1 || spec.left) || p.carried) desired.add(new THREE.Vector3(0, 0, 0.06).applyQuaternion(cameraQ));
      if (!this.ready) this.targets[i].copy(desired);
      this.targets[i].lerp(desired, 1 - Math.exp(-Math.min(dt, 0.1) * 22));
      const shoulder = arm.shoulder.getWorldPosition(new THREE.Vector3());
      const pole = new THREE.Vector3(sign, -0.4, 0.35).applyQuaternion(cameraQ);
      const solved = solveArm(shoulder, this.targets[i], pole);
      const orientSegment = (node: THREE.Object3D, start: THREE.Vector3, end: THREE.Vector3) => {
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), end.clone().sub(start).normalize());
        node.quaternion.copy(node.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
        node.updateWorldMatrix(false, true);
      };
      orientSegment(arm.shoulder, shoulder, solved.elbow);
      arm.elbow.position.set(0, -0.29, 0);
      orientSegment(arm.elbow, solved.elbow, solved.wrist);
      arm.wrist = solved.wrist;
      arm.handRotation = cameraQ.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, sign * 0.12)));
      this.palms[i].position.copy(solved.wrist);
      this.palms[i].quaternion.copy(arm.handRotation);
    }
    this.ready = true;
  }
}
