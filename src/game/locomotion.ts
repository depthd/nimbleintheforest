// Fixed-step, world-space foot placement. Rendering and physics stay separate:
// planted soles are anchors, not a looping animation translated with the camera.
import * as THREE from 'three';

export const THIGH = 0.46;
export const SHIN = 0.45;
export const ANKLE = 0.105;
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;
const up = new THREE.Vector3(0, 1, 0);
const down = new THREE.Vector3(0, -1, 0);

export interface FootSurface {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  support?: number;
}
export type GroundProbe = (x: number, z: number, referenceY: number) => FootSurface | null;
export interface MotionInput {
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  crouch: boolean;
  sprinting: boolean;
  suspended: boolean;
}
export interface FootContact {
  side: 'left' | 'right';
  position: THREE.Vector3;
  normal: THREE.Vector3;
  speed: number;
  landing: boolean;
  serial: number;
}

export class FootState {
  position = new THREE.Vector3(); // centre of the sole, in world coordinates
  previous = new THREE.Vector3();
  normal = up.clone();
  yaw = 0;
  previousYaw = 0;
  start = new THREE.Vector3();
  target = new THREE.Vector3();
  startYaw = 0;
  targetYaw = 0;
  targetNormal = up.clone();
  progress = 1;
  duration = 0.3;
  lift = 0.08;
  grounded = false;
  support: number | undefined;
  constructor(public readonly side: 'left' | 'right', public readonly sign: number) {}
  get swinging() { return this.progress < 1; }
}

export class Locomotion {
  readonly feet = [new FootState('left', -1), new FootState('right', 1)];
  readonly position = new THREE.Vector3();
  readonly previousPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly contacts: FootContact[] = [];
  bodyYaw = 0;
  previousBodyYaw = 0;
  chestYaw = 0; // relative to pelvis
  headYaw = 0; // relative to chest, limited anatomically
  chestPitch = 0;
  headPitch = 0;
  hipHeight = 0.99;
  previousHipHeight = 0.99;
  crouch = 0;
  speed = 0;
  time = 0;
  stepSerial = 0;
  turning = false;
  active = true;
  private ready = false;
  private wasGrounded = false;
  private suppressLanding = true;
  private nextFoot = 0;
  private sinceStep = 1;
  private nextStepAfter = 0;
  private acceleration = 0;
  private lastPitch = 0;

  reset(input: MotionInput, probe: GroundProbe) {
    this.ready = true;
    this.position.copy(input.position);
    this.previousPosition.copy(input.position);
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.bodyYaw = this.previousBodyYaw = input.yaw;
    this.chestYaw = this.headYaw = this.chestPitch = this.headPitch = 0;
    this.crouch = input.crouch ? 1 : 0;
    this.hipHeight = this.previousHipHeight = this.crouch ? 0.59 : 0.99;
    this.turning = false;
    this.wasGrounded = false;
    this.suppressLanding = true;
    this.sinceStep = 1;
    this.nextStepAfter = 0;
    this.contacts.length = 0;
    for (const f of this.feet) {
      const rest = this.restPoint(f);
      const hit = probe(rest.x, rest.z, this.position.y);
      f.position.copy(hit?.point ?? rest);
      f.previous.copy(f.position);
      f.normal.copy(hit?.normal ?? up);
      f.yaw = f.previousYaw = f.startYaw = f.targetYaw = this.bodyYaw;
      f.start.copy(f.position);
      f.target.copy(f.position);
      f.targetNormal.copy(f.normal);
      f.progress = 1;
      f.grounded = !!hit;
      f.support = hit?.support;
    }
  }

  private restPoint(f: FootState) {
    const width = 0.145 + this.crouch * 0.035;
    // The eye is slightly ahead of the torso. Toes remain visible looking down.
    const x = f.sign * width, z = 0.035;
    const s = Math.sin(this.bodyYaw), c = Math.cos(this.bodyYaw);
    return new THREE.Vector3(this.position.x + x * c + z * s, this.position.y,
      this.position.z - x * s + z * c);
  }

  update(dt: number, input: MotionInput, probe: GroundProbe) {
    if (dt <= 0) return;
    if (!this.ready || input.position.distanceToSquared(this.position) > 4) this.reset(input, probe);
    this.contacts.length = 0;
    this.previousPosition.copy(this.position);
    this.previousBodyYaw = this.bodyYaw;
    this.previousHipHeight = this.hipHeight;
    for (const f of this.feet) {
      f.previous.copy(f.position);
      f.previousYaw = f.yaw;
    }
    this.time += dt;
    this.sinceStep += dt;
    const vx = (input.position.x - this.position.x) / dt;
    const vz = (input.position.z - this.position.z) / dt;
    this.position.copy(input.position);
    this.velocity.lerp(new THREE.Vector3(vx, 0, vz), 1 - Math.exp(-dt * 18));
    const lastSpeed = this.speed;
    this.speed = this.velocity.length();
    this.acceleration = (this.speed - lastSpeed) / dt;
    this.crouch = THREE.MathUtils.damp(this.crouch, input.crouch ? 1 : 0, 12, dt);
    this.active = !input.suspended;
    this.updateFacing(dt, input);

    if (!input.grounded || input.suspended) {
      if (input.suspended) this.suppressLanding = true;
      // No phantom footsteps in the air, in water, or while sleeping/dead.
      for (const f of this.feet) {
        const target = this.restPoint(f);
        target.y += 0.09 + (input.sprinting ? 0.08 : 0);
        f.position.lerp(target, 1 - Math.exp(-dt * 12));
        f.yaw += wrapAngle(this.bodyYaw - f.yaw) * (1 - Math.exp(-dt * 10));
        f.normal.lerp(up, 1 - Math.exp(-dt * 10)).normalize();
        f.progress = 1;
        f.grounded = false;
        f.support = undefined;
      }
      this.wasGrounded = false;
    } else {
      if (!this.wasGrounded) {
        for (const f of this.feet) {
          const rest = this.restPoint(f);
          const hit = probe(rest.x, rest.z, this.position.y);
          if (hit) {
            f.position.copy(hit.point);
            f.normal.copy(hit.normal);
            f.yaw = this.bodyYaw;
            f.grounded = true;
            f.support = hit.support;
          }
          f.progress = 1;
        }
        // One landing sound, not two simultaneous steps. Initial placement is silent.
        if (!this.suppressLanding && this.feet[0].grounded) this.contact(this.feet[0], true);
        this.suppressLanding = false;
      }
      this.wasGrounded = true;
      for (const f of this.feet) if (f.swinging) this.advanceFoot(f, dt, probe);
      this.planStep(input, probe);
    }
    this.updatePelvis(dt);
    this.lastPitch = input.pitch;
  }

  private updateFacing(dt: number, input: MotionInput) {
    const moving = this.speed > 0.16 && !input.suspended;
    let desired = this.bodyYaw;
    if (moving) {
      let direction = wrapAngle(Math.atan2(-this.velocity.x, -this.velocity.z) - input.yaw);
      // Walking backwards doesn't turn the chest away from the view.
      if (Math.abs(direction) > Math.PI / 2) direction = wrapAngle(direction + Math.PI);
      desired = input.yaw + clamp(direction, -0.65, 0.65) * 0.55;
      this.turning = false;
    } else {
      const twist = wrapAngle(input.yaw - this.bodyYaw);
      if (Math.abs(twist) > 0.85) this.turning = true;
      if (Math.abs(twist) < 0.12) this.turning = false;
      if (this.turning) desired = input.yaw;
    }
    const error = wrapAngle(desired - this.bodyYaw);
    const amount = error * (1 - Math.exp(-dt * (moving ? 9 : 5)));
    this.bodyYaw = wrapAngle(this.bodyYaw + clamp(amount, -dt * 2.8, dt * 2.8));
    const twist = wrapAngle(input.yaw - this.bodyYaw);
    this.chestYaw = THREE.MathUtils.damp(this.chestYaw, clamp(twist * 0.3, -0.3, 0.3), 10, dt);
    this.headYaw = clamp(wrapAngle(twist - this.chestYaw), -1.2, 1.2);
    this.chestPitch = THREE.MathUtils.damp(this.chestPitch, input.pitch * 0.16, 10, dt);
    this.headPitch = clamp(input.pitch - this.chestPitch, -1.2, 1.2);
  }

  private planStep(input: MotionInput, probe: GroundProbe) {
    const moving = this.speed > 0.16;
    const running = input.sprinting && this.speed > 2.5;
    const right = new THREE.Vector3(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
    const lateral = this.velocity.dot(right) / Math.max(this.speed, 0.01);
    const sideways = Math.abs(lateral) > 0.65;
    const swing = this.feet.find(f => f.swinging);
    if (swing && (!running || swing.progress < 0.78)) return;
    let duration = this.crouch > 0.5 ? 0.36 : clamp(0.34 - this.speed * 0.028, 0.205, 0.33);
    if (sideways) duration *= 0.65;
    if (this.sinceStep < this.nextStepAfter) return;
    let candidate: FootState | undefined;
    let worst = 0;
    const gap = this.feet[1].position.clone().sub(this.feet[0].position).dot(right);
    const leading = lateral < 0 ? 0 : 1;
    const sideFoot = gap < 0.26 || this.sinceStep > 0.5 ? leading : 1 - leading;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      if (f.swinging) continue;
      if (moving && sideways && i !== sideFoot) continue;
      const rest = this.restPoint(f);
      const offset = rest.clone().sub(f.position).setY(0);
      const lag = moving ? offset.dot(this.velocity) / Math.max(this.speed, 0.01) : offset.length();
      const twist = Math.abs(wrapAngle(this.bodyYaw - f.yaw));
      const need = moving ? lag / (0.12 + this.speed * 0.025) : Math.max(offset.length() / 0.14, twist / 0.33);
      const reach = offset.length() / 0.48;
      let score = Math.max(need, reach) + (i === this.nextFoot ? 0.05 : 0);
      if (moving && sideways && this.sinceStep > 0.5) score = Math.max(score, 1.1);
      if (score > 1 && score > worst) { candidate = f; worst = score; }
    }
    if (!candidate) return;
    const f = candidate;
    if (moving) {
      const other = this.feet.find(other => other !== f)!;
      const hipOffset = new THREE.Vector3(0, 0, 0.14).applyAxisAngle(up, this.bodyYaw);
      const lag = this.position.clone().add(hipOffset).sub(other.position).setY(0).dot(this.velocity) / this.speed;
      // Short first steps establish the gait before the rear leg runs out of reach.
      const predictedSpeed = Math.min(this.speed * 1.7, this.speed + Math.max(0, this.acceleration) * 0.12);
      duration = Math.max(0.14, Math.min(duration, (0.4 - lag) / predictedSpeed));
    }
    const target = this.restPoint(f);
    // Aim ahead of where the pelvis WILL be at touchdown, not where it was
    // at lift-off. Otherwise a runner perpetually lands behind their own hips.
    if (moving) target.addScaledVector(this.velocity, duration * 1.5);
    this.separateFeet(f, target);
    const hit = probe(target.x, target.z, this.position.y);
    if (!hit) return; // ledge: don't invent a floating support
    f.start.copy(f.position);
    f.target.copy(hit.point);
    f.startYaw = f.yaw;
    f.targetYaw = this.bodyYaw + f.sign * 0.035;
    f.targetNormal.copy(hit.normal);
    f.support = hit.support;
    f.duration = duration;
    f.lift = (moving ? (running ? 0.13 : 0.075) : 0.055) + Math.min(0.12, Math.abs(hit.point.y - f.position.y) * 0.5);
    for (const t of [0.25, 0.5, 0.75]) {
      const path = f.start.clone().lerp(f.target, t);
      const ground = probe(path.x, path.z, this.position.y);
      if (ground) f.lift = Math.max(f.lift, (ground.point.y + 0.035 - path.y) / Math.sin(t * Math.PI) ** 1.3);
    }
    f.lift = Math.min(f.lift, 0.4);
    f.progress = 0;
    f.grounded = false;
    this.sinceStep = 0;
    this.nextStepAfter = duration * (running ? 0.8 : 0.95);
    this.nextFoot = f.sign < 0 ? 1 : 0;
  }

  private advanceFoot(f: FootState, dt: number, probe: GroundProbe) {
    f.progress = Math.min(1, f.progress + dt / f.duration);
    const t = f.progress;
    if (t < 0.65) {
      // Re-plan early in a swing when accelerating, braking or reversing. Late
      // swing commits to its contact, so a mouse flick cannot teleport a foot.
      const target = this.restPoint(f).addScaledVector(this.velocity, f.duration * (1.5 - t));
      this.separateFeet(f, target);
      const hit = probe(target.x, target.z, this.position.y);
      if (hit) {
        f.target.lerp(hit.point, 1 - Math.exp(-dt * 20));
        f.targetNormal.copy(hit.normal);
        f.targetYaw += wrapAngle(this.bodyYaw + f.sign * 0.035 - f.targetYaw) * (1 - Math.exp(-dt * 12));
      }
    }
    const s = t * t * (3 - 2 * t);
    f.position.lerpVectors(f.start, f.target, s);
    this.separateFeet(f, f.position);
    f.position.y += Math.sin(Math.PI * t) ** 1.3 * f.lift;
    f.yaw = f.startYaw + wrapAngle(f.targetYaw - f.startYaw) * s;
    f.normal.lerp(f.targetNormal, Math.min(1, dt * 14)).normalize();
    if (t < 1) return;
    // Recheck the destination: a door, plank, or ice surface may have disappeared.
    const hit = probe(f.target.x, f.target.z, this.position.y);
    f.grounded = !!hit;
    if (hit) {
      f.position.copy(hit.point);
      f.normal.copy(hit.normal);
      f.support = hit.support;
      this.contact(f, false);
    }
  }

  private contact(f: FootState, landing: boolean) {
    this.contacts.push({ side: f.side, position: f.position.clone(), normal: f.normal.clone(),
      speed: this.speed, landing, serial: ++this.stepSerial });
  }

  private separateFeet(f: FootState, target: THREE.Vector3) {
    const right = new THREE.Vector3(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
    if (this.speed < 0.16 || Math.abs(this.velocity.dot(right)) < this.speed * 0.25) return;
    const other = this.feet[f.sign < 0 ? 1 : 0];
    const gap = target.clone().sub(other.position).dot(right) * f.sign;
    // Side steps close and open the stance; the trailing foot never lands across
    // the support leg. This also keeps diagonal swings clear of the other boot.
    if (gap < 0.18) target.addScaledVector(right, f.sign * (0.18 - gap));
  }

  private updatePelvis(dt: number) {
    let height = 0.99 - this.crouch * 0.4;
    // Lower the pelvis on uneven ground instead of lengthening either leg.
    for (const f of this.feet) {
      const hip = this.position.clone().add(new THREE.Vector3(f.sign * (0.115 + this.crouch * 0.02), 0, 0.14)
        .applyAxisAngle(up, this.bodyYaw));
      const ankle = new THREE.Vector3(0, ANKLE, 0.025)
        .applyAxisAngle(up, f.yaw)
        .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, f.normal)).add(f.position);
      const dx = hip.x - ankle.x, dz = hip.z - ankle.z;
      const reach = Math.sqrt(Math.max(0.12, (THIGH + SHIN - 0.015) ** 2 - dx * dx - dz * dz));
      height = Math.min(height, ankle.y - this.position.y + reach);
    }
    height = clamp(height, 0.48 - this.crouch * 0.09, 1.0);
    this.hipHeight = Math.min(THREE.MathUtils.damp(this.hipHeight, height, 18, dt), height + 0.003);
  }

  snapshot() {
    return {
      bodyYaw: this.bodyYaw, chestYaw: this.chestYaw, headYaw: this.headYaw,
      position: this.position.toArray(),
      chestPitch: this.chestPitch, headPitch: this.headPitch, viewPitch: this.lastPitch,
      speed: this.speed, hipHeight: this.hipHeight, crouch: this.crouch, turning: this.turning,
      stepSerial: this.stepSerial,
      feet: this.feet.map(f => ({ side: f.side, position: f.position.toArray(), normal: f.normal.toArray(),
        yaw: f.yaw, phase: f.swinging ? 'swing' : f.grounded ? 'stance' : 'air', progress: f.progress, support: f.support })),
    };
  }
}

/** Analytic two-bone IK. Pole points forwards, so knees never flip backwards. */
export function solveLeg(hip: THREE.Vector3, ankle: THREE.Vector3, forward: THREE.Vector3, knee: THREE.Vector3) {
  const axis = ankle.clone().sub(hip);
  const rawLength = axis.length();
  const d = clamp(rawLength, 0.06, THIGH + SHIN - 0.001);
  axis.normalize();
  if (rawLength < 1e-6) axis.copy(down);
  const pole = forward.clone().addScaledVector(axis, -forward.dot(axis));
  if (pole.lengthSq() < 1e-5) pole.copy(up).addScaledVector(axis, -axis.y);
  pole.normalize();
  const along = (THIGH * THIGH - SHIN * SHIN + d * d) / (2 * d);
  const bend = Math.sqrt(Math.max(0, THIGH * THIGH - along * along));
  knee.copy(hip).addScaledVector(axis, along).addScaledVector(pole, bend);
  return Math.max(0, rawLength - (THIGH + SHIN));
}
