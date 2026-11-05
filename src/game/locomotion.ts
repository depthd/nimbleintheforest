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
const SUPPORT_Y = Math.cos(53 * Math.PI / 180);
const isSupport = (surface: FootSurface | null): surface is FootSurface => !!surface && surface.normal.y >= SUPPORT_Y;

export interface FootSurface {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  support?: number;
  snowDepth?: number;
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
  kind: 'walk' | 'run' | 'turn' | 'settle' = 'walk';
  leadTime = 0;
  roll = 0;
  startRoll = 0;
  grounded = false;
  needsPlant = false;
  support: number | undefined;
  constructor(public readonly side: 'left' | 'right', public readonly sign: number) {}
  get swinging() { return this.progress < 1; }
}

/** Shared by the reach solver and renderer: the ankle follows the boot's pose. */
export function footRotation(f: FootState, yaw = f.yaw) {
  const q = new THREE.Quaternion().setFromUnitVectors(up, f.normal)
    .multiply(new THREE.Quaternion().setFromAxisAngle(up, yaw));
  let pitch = f.roll;
  if (f.swinging) {
    const t = f.progress;
    const swingPitch = f.kind === 'run'
      ? -0.85 * Math.sin(Math.PI * t) ** 1.2 + 0.12 * t ** 6
      : -Math.sin(t * Math.PI * 2) * (f.kind === 'turn' ? 0.04 : 0.13);
    pitch = THREE.MathUtils.lerp(f.startRoll, swingPitch, clamp(t / 0.2, 0, 1));
  }
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
  return q;
}

export function footPose(f: FootState, yaw = f.yaw, sole = f.position) {
  const rotation = footRotation(f, yaw);
  const position = sole.clone();
  // Roll around the toe contact, not the ankle or boot centre. The toe stays
  // anchored while the heel rises; blend that support pivot out after lift-off.
  const weight = f.swinging ? 1 - clamp(f.progress / 0.2, 0, 1) : f.grounded ? 1 : 0;
  if (weight > 0) {
    const base = new THREE.Quaternion().setFromUnitVectors(up, f.normal)
      .multiply(new THREE.Quaternion().setFromAxisAngle(up, yaw));
    const toe = new THREE.Vector3(0, 0, -0.18);
    position.addScaledVector(toe.clone().applyQuaternion(base).sub(toe.clone().applyQuaternion(rotation)), weight);
  }
  return { position, rotation };
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
  runBlend = 0;
  sliding = false;
  active = true;
  private ready = false;
  private wasGrounded = false;
  private suppressLanding = true;
  private nextFoot = 0;
  private sinceStep = 1;
  private nextStepAfter = 0;
  private acceleration = 0;
  private lastPitch = 0;
  private runActive = false;
  private runLaunches = 0;
  private runWait = 0;

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
    this.runActive = false;
    this.runBlend = 0;
    this.sliding = false;
    this.runWait = 0;
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
      f.kind = 'walk';
      f.roll = f.startRoll = 0;
      f.grounded = isSupport(hit);
      f.needsPlant = !f.grounded;
      f.support = f.grounded ? hit?.support : undefined;
    }
  }

  private restPoint(f: FootState) {
    const width = 0.145 + this.crouch * 0.035;
    // The ankle, hips and torso share a centre line. Camera visibility must not
    // be obtained by shifting the torso backwards and making the legs reach out.
    return this.restAtYaw(f, this.bodyYaw, width);
  }

  private restAtYaw(f: FootState, yaw: number, width = 0.145 + this.crouch * 0.035) {
    const x = f.sign * width, z = -0.025;
    const s = Math.sin(yaw), c = Math.cos(yaw);
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
    const travel = input.position.clone().sub(this.position);
    this.position.copy(input.position);
    this.velocity.lerp(new THREE.Vector3(vx, 0, vz), 1 - Math.exp(-dt * 18));
    const lastSpeed = this.speed;
    this.speed = this.velocity.length();
    this.acceleration = (this.speed - lastSpeed) / dt;
    this.crouch = THREE.MathUtils.damp(this.crouch, input.crouch ? 1 : 0, 12, dt);
    this.active = !input.suspended;
    const surface = probe(this.position.x, this.position.z, this.position.y);
    const nearby = !!surface && Math.abs(surface.point.y - this.position.y) < 0.65;
    this.sliding = !input.suspended && nearby && (input.grounded || travel.y / dt < 0.5)
      && surface!.normal.y < (this.sliding ? Math.cos(49 * Math.PI / 180) : SUPPORT_Y);
    const noSupport = input.grounded && !nearby && !this.feet.some(f => {
      const rest = this.restPoint(f);
      return isSupport(probe(rest.x, rest.z, this.position.y));
    });
    const wantRun = input.sprinting && this.speed > (this.runActive ? 2.0 : 2.2) && input.grounded && !input.suspended && !this.sliding && !noSupport;
    if (wantRun && !this.runActive) {
      this.runLaunches = 0;
      this.runWait = 0;
      // Lift the trailing leg first; preserve the current contact of the other.
      const lag = this.feet.map(f => this.position.clone().sub(f.position).dot(this.velocity));
      this.nextFoot = lag[0] > lag[1] ? 0 : 1;
    }
    this.runActive = wantRun;
    this.runBlend = THREE.MathUtils.damp(this.runBlend, wantRun ? 1 : 0, 8, dt);
    this.updateFacing(dt, input);

    if (!input.grounded || input.suspended || this.sliding || noSupport) {
      if (input.suspended) this.suppressLanding = true;
      // No phantom footsteps in the air, in water, or while sleeping/dead.
      for (const f of this.feet) {
        this.releaseFoot(f);
        this.followBody(f, travel, dt, probe, this.sliding);
      }
      this.wasGrounded = false;
    } else {
      if (!this.wasGrounded) {
        for (const f of this.feet) {
          const rest = this.restPoint(f);
          const hit = probe(rest.x, rest.z, this.position.y);
          if (isSupport(hit)) {
            f.position.copy(hit.point);
            f.normal.copy(hit.normal);
            f.yaw = this.bodyYaw;
            f.grounded = true;
            f.needsPlant = false;
            f.support = hit.support;
          }
          f.progress = 1;
        }
        // One landing sound, not two simultaneous steps. Initial placement is silent.
        if (!this.suppressLanding && this.feet[0].grounded) this.contact(this.feet[0], true);
        this.suppressLanding = false;
      }
      this.wasGrounded = true;
      for (const f of this.feet) if (!f.swinging) {
        if (f.grounded) this.validateSupport(f, probe);
        if (!f.grounded) this.followBody(f, travel, dt, probe, false);
      }
      for (const f of this.feet) if (f.swinging) this.advanceFoot(f, dt, probe);
      if (this.runActive) this.planRun(dt, probe);
      else this.planStep(input, probe);
    }
    const forward = new THREE.Vector3(-Math.sin(this.bodyYaw), 0, -Math.cos(this.bodyYaw));
    for (const f of this.feet) {
      if (f.swinging) continue;
      const trailing = this.position.clone().sub(f.position).dot(forward);
      f.roll = f.grounded && this.speed > 0.2 ? -clamp((trailing - 0.12) * 1.65, 0, 0.4 + this.runBlend * 0.3) : 0;
    }
    this.updatePelvis(dt);
    this.limitFootReach();
    this.lastPitch = input.pitch;
  }

  private hip(f: FootState) {
    return this.position.clone().add(new THREE.Vector3(f.sign * (0.115 + this.crouch * 0.02), this.hipHeight, 0)
      .applyAxisAngle(up, this.bodyYaw));
  }

  private releaseFoot(f: FootState) {
    f.grounded = false;
    f.needsPlant = true;
    f.support = undefined;
    f.progress = 1;
    f.roll = f.startRoll = 0;
    for (let i = this.contacts.length - 1; i >= 0; i--) if (this.contacts[i].side === f.side) this.contacts.splice(i, 1);
  }

  private followBody(f: FootState, travel: THREE.Vector3, dt: number, probe: GroundProbe, sliding: boolean) {
    const target = this.restPoint(f);
    const hit = sliding ? probe(target.x, target.z, this.position.y) : null;
    if (hit && Math.abs(hit.point.y - this.position.y) < 0.65) {
      target.copy(hit.point).addScaledVector(hit.normal, 0.02);
      f.normal.lerp(hit.normal, 1 - Math.exp(-dt * 14)).normalize();
    } else {
      target.y += 0.09;
      f.normal.lerp(up, 1 - Math.exp(-dt * 10)).normalize();
    }
    // An unplanted foot travels WITH the pelvis; damping an old world point
    // would leave a long elastic lag during a fast slide or fall.
    f.position.add(travel).lerp(target, 1 - Math.exp(-dt * 14));
    f.yaw += wrapAngle(this.bodyYaw - f.yaw) * (1 - Math.exp(-dt * 10));
  }

  private validateSupport(f: FootState, probe: GroundProbe) {
    const hit = probe(f.position.x, f.position.z, this.position.y);
    // Settling in a compressible layer is vertical; the planted x/z anchor stays put.
    if (hit?.snowDepth !== undefined && Math.abs(hit.point.y - f.position.y) < 0.09) f.position.y = hit.point.y;
    const pose = footPose(f);
    const ankle = new THREE.Vector3(0, ANKLE, 0.025).applyQuaternion(pose.rotation).add(pose.position);
    if (!isSupport(hit) || Math.abs(hit.point.y - f.position.y) > 0.09 ||
      (f.support !== undefined && hit.support !== f.support) || ankle.distanceTo(this.hip(f)) > THIGH + SHIN + 0.06) {
      this.releaseFoot(f);
    }
  }

  private limitFootReach() {
    for (const f of this.feet) {
      const hip = this.hip(f), pose = footPose(f);
      const ankle = new THREE.Vector3(0, ANKLE, 0.025).applyQuaternion(pose.rotation).add(pose.position);
      if (ankle.distanceTo(hip) <= THIGH + SHIN - 0.005) continue;
      const reachable = ankle.sub(hip).setLength(THIGH + SHIN - 0.015).add(hip);
      this.releaseFoot(f);
      const offset = new THREE.Vector3(0, ANKLE, 0.025).applyQuaternion(footRotation(f));
      f.position.copy(reachable).sub(offset);
    }
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
      // At rest the pelvis follows the feet's actual turn, not an independent
      // spin of the torso. One foot opens the turn, the other closes the stance.
      if (this.turning) desired = this.feet[0].yaw + wrapAngle(this.feet[1].yaw - this.feet[0].yaw) * 0.5;
    }
    const error = wrapAngle(desired - this.bodyYaw);
    const amount = error * (1 - Math.exp(-dt * (moving ? 8 : 12)));
    const maxRate = moving ? 2.5 : 1.8;
    this.bodyYaw = wrapAngle(this.bodyYaw + clamp(amount, -dt * maxRate, dt * maxRate));
    const twist = wrapAngle(input.yaw - this.bodyYaw);
    this.chestYaw = THREE.MathUtils.damp(this.chestYaw, clamp(twist * 0.3, -0.3, 0.3), 10, dt);
    this.headYaw = clamp(wrapAngle(twist - this.chestYaw), -1.2, 1.2);
    this.chestPitch = THREE.MathUtils.damp(this.chestPitch, input.pitch * 0.12 - this.runBlend * 0.19, 10, dt);
    this.headPitch = clamp(input.pitch - this.chestPitch, -1.2, 1.2);
  }

  private planStep(input: MotionInput, probe: GroundProbe) {
    const moving = this.speed > 0.16;
    if (!moving && this.turning) { this.planTurn(input.yaw, probe); return; }
    const right = new THREE.Vector3(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
    const lateral = this.velocity.dot(right) / Math.max(this.speed, 0.01);
    const sideways = Math.abs(lateral) > 0.65;
    const swing = this.feet.find(f => f.swinging);
    if (swing) return;
    let duration = this.crouch > 0.5 ? 0.36 : clamp(0.36 - this.speed * 0.022, 0.24, 0.35);
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
      const need = f.needsPlant ? 2 : moving ? lag / (0.12 + this.speed * 0.025) : Math.max(offset.length() / 0.14, twist / 0.33);
      const reach = offset.length() / 0.48;
      let score = Math.max(need, reach) + (i === this.nextFoot ? 0.05 : 0);
      if (moving && sideways && this.sinceStep > 0.5) score = Math.max(score, 1.1);
      if (score > 1 && score > worst) { candidate = f; worst = score; }
    }
    if (!candidate) return;
    const f = candidate;
    if (moving) {
      const other = this.feet.find(other => other !== f)!;
      const lag = this.position.clone().sub(other.position).setY(0).dot(this.velocity) / this.speed;
      // Short first steps establish the gait before the rear leg runs out of reach.
      const predictedSpeed = Math.min(this.speed * 1.7, this.speed + Math.max(0, this.acceleration) * 0.12);
      duration = Math.max(0.14, Math.min(duration, (0.4 - lag) / predictedSpeed));
    }
    const target = this.restPoint(f);
    // Aim ahead of where the pelvis WILL be at touchdown, not where it was
    // at lift-off. Otherwise a runner perpetually lands behind their own hips.
    if (moving) target.addScaledVector(this.velocity, duration * 1.4);
    this.separateFeet(f, target);
    this.beginStep(f, target, this.bodyYaw + f.sign * 0.025, duration, moving ? 'walk' : 'settle', moving ? duration * 0.4 : 0, probe);
  }

  private planTurn(viewYaw: number, probe: GroundProbe) {
    if (this.feet.some(f => f.swinging) || this.sinceStep < 0.36) return;
    const delta = wrapAngle(viewYaw - this.bodyYaw);
    const direction = Math.sign(delta);
    const headings = this.feet.map(f => wrapAngle(f.yaw - this.bodyYaw) * direction);
    const spread = Math.abs(wrapAngle(this.feet[0].yaw - this.feet[1].yaw));
    // Open with the outside foot, then bring the trailing foot to the same heading.
    const index = spread > 0.25 ? (headings[0] < headings[1] ? 0 : 1) : direction > 0 ? 0 : 1;
    const goal = spread > 0.25
      ? this.feet[1 - index].yaw
      : this.bodyYaw + clamp(delta, -1.0, 1.0);
    const foot = this.feet[index];
    const target = this.restAtYaw(foot, goal);
    this.beginStep(foot, target, goal + foot.sign * 0.025, 0.38, 'turn', 0, probe);
  }

  private planRun(dt: number, probe: GroundProbe) {
    this.runWait -= dt;
    const foot = this.feet[this.nextFoot];
    if (foot.swinging) return;
    const trailing = this.position.clone().sub(foot.position).setY(0).dot(this.velocity) / Math.max(0.01, this.speed);
    const early = this.runLaunches > 1 && trailing > 0.44 ? Math.max(0, this.runWait) : 0;
    if (this.runWait > 1e-6 && early === 0) return;
    // ~190–210 contacts/minute at normal sprint speed, rather than 300 tiny
    // walking steps. Long recovery overlaps the other leg's short support phase.
    const interval = clamp(0.32 - (this.speed - 3) * 0.012, 0.285, 0.32);
    const support = clamp(0.24 - this.speed * 0.015, 0.16, 0.2);
    // If a collision shortened the previous landing, release the rear toe before
    // the leg overextends. Extend recovery by the same amount, keeping the next
    // touchdown on schedule instead of producing an extra hurried step.
    const duration = this.runLaunches === 0 ? 0.2 : interval * 2 - support + early;
    // A running foot lands close to the body's centre, then pushes behind it.
    // Reaching far ahead creates the seated/overstriding silhouette of a fast walk.
    const leadTime = support * 0.3;
    const target = this.restPoint(foot).addScaledVector(this.velocity, duration + leadTime);
    this.separateFeet(foot, target);
    if (this.beginStep(foot, target, this.bodyYaw + foot.sign * 0.025, duration, 'run', leadTime, probe)) {
      const delay = this.runLaunches === 0 ? 0.1 : this.runLaunches === 1 ? interval - 0.02 : interval;
      this.runWait = delay + (this.runLaunches > 1 ? this.runWait : 0);
      this.runLaunches++;
    }
  }

  private beginStep(f: FootState, target: THREE.Vector3, yaw: number, duration: number,
    kind: FootState['kind'], leadTime: number, probe: GroundProbe) {
    const hit = probe(target.x, target.z, this.position.y);
    if (!isSupport(hit)) return false; // steep face / ledge is not a planted support
    f.start.copy(f.position);
    f.target.copy(hit.point);
    f.startYaw = f.yaw;
    f.targetYaw = yaw;
    f.targetNormal.copy(hit.normal);
    f.support = hit.support;
    f.duration = duration;
    f.startRoll = f.roll;
    f.kind = kind;
    f.leadTime = leadTime;
    f.lift = (kind === 'run' ? (this.runLaunches === 0 ? 0.25 : 0.36) : kind === 'walk' ? 0.075 : 0.035)
      + Math.min(0.12, Math.abs(hit.point.y - f.position.y) * 0.5);
    for (const t of [0.25, 0.5, 0.75]) {
      const path = f.start.clone().lerp(f.target, t);
      const ground = probe(path.x, path.z, this.position.y);
      if (ground) f.lift = Math.max(f.lift, (ground.point.y + 0.035 - path.y) / Math.sin(t * Math.PI) ** 1.3);
    }
    f.lift = Math.min(f.lift, 0.4);
    if (hit.snowDepth) f.lift = Math.min(0.4, Math.max(f.lift, hit.snowDepth + 0.10));
    f.progress = 0;
    f.grounded = false;
    f.needsPlant = false;
    this.sinceStep = 0;
    this.nextStepAfter = duration * 0.95;
    this.nextFoot = f.sign < 0 ? 1 : 0;
    return true;
  }

  private advanceFoot(f: FootState, dt: number, probe: GroundProbe) {
    f.progress = Math.min(1, f.progress + dt / f.duration);
    const t = f.progress;
    if (t < 0.65 && (f.kind === 'walk' || f.kind === 'run')) {
      // Re-plan early in a swing when accelerating, braking or reversing. Late
      // swing commits to its contact, so a mouse flick cannot teleport a foot.
      const target = this.restPoint(f).addScaledVector(this.velocity, f.duration * (1 - t) + f.leadTime);
      this.separateFeet(f, target);
      const hit = probe(target.x, target.z, this.position.y);
      if (isSupport(hit)) {
        f.target.lerp(hit.point, 1 - Math.exp(-dt * 20));
        f.targetNormal.copy(hit.normal);
        f.targetYaw += wrapAngle(this.bodyYaw + f.sign * 0.035 - f.targetYaw) * (1 - Math.exp(-dt * 12));
      }
    }
    if (t >= 0.65 && f.kind === 'run') {
      const futureRoot = this.position.clone().addScaledVector(this.velocity, f.duration * (1 - t));
      const offset = f.target.clone().sub(futureRoot).setY(0);
      if (offset.length() > 0.39) {
        // A collision or sudden brake can shorten travel after swing committed.
        // Pull back an unreachable landing gradually instead of squatting deeply.
        offset.setLength(0.39);
        const target = futureRoot.add(offset);
        const hit = probe(target.x, target.z, this.position.y);
        if (isSupport(hit)) f.target.lerp(hit.point, 1 - Math.exp(-dt * 24));
      }
    }
    const s = f.kind === 'run'
      ? t < 0.1 ? t * t / 0.18 : t > 0.9 ? 1 - (1 - t) ** 2 / 0.18 : (t - 0.05) / 0.9
      : t * t * (3 - 2 * t);
    f.position.lerpVectors(f.start, f.target, s);
    this.separateFeet(f, f.position);
    f.position.y += Math.sin(Math.PI * (f.kind === 'run' ? t ** 0.65 : t)) ** 1.3 * f.lift;
    if (f.kind === 'turn') {
      const outward = new THREE.Vector3(Math.cos(f.startYaw), 0, -Math.sin(f.startYaw));
      f.position.addScaledVector(outward, f.sign * Math.sin(Math.PI * t) * 0.045);
    }
    f.yaw = f.startYaw + wrapAngle(f.targetYaw - f.startYaw) * s;
    f.normal.lerp(f.targetNormal, Math.min(1, dt * 14)).normalize();
    if (t < 1) return;
    // Recheck the destination: a door, plank, or ice surface may have disappeared.
    const hit = probe(f.target.x, f.target.z, this.position.y);
    f.grounded = isSupport(hit);
    if (isSupport(hit)) {
      f.position.copy(hit.point);
      f.normal.copy(hit.normal);
      f.support = hit.support;
      this.contact(f, false);
    } else this.releaseFoot(f);
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
    let height = 0.99 - this.crouch * 0.4 - this.runBlend * 0.035;
    if (this.feet.every(f => f.swinging)) height += this.runBlend * 0.025;
    // Lower the pelvis on uneven ground instead of lengthening either leg.
    for (const f of this.feet) {
      const hip = this.position.clone().add(new THREE.Vector3(f.sign * (0.115 + this.crouch * 0.02), 0, 0)
        .applyAxisAngle(up, this.bodyYaw));
      const pose = footPose(f);
      const ankle = new THREE.Vector3(0, ANKLE, 0.025).applyQuaternion(pose.rotation).add(pose.position);
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
      speed: this.speed, hipHeight: this.hipHeight, crouch: this.crouch, turning: this.turning, runBlend: this.runBlend,
      sliding: this.sliding,
      stepSerial: this.stepSerial,
      feet: this.feet.map(f => ({ side: f.side, position: f.position.toArray(), normal: f.normal.toArray(),
        yaw: f.yaw, phase: f.swinging ? 'swing' : f.grounded ? 'stance' : 'air', progress: f.progress, kind: f.kind, roll: f.roll, support: f.support })),
    };
  }
}

/** Analytic two-bone IK. Pole points forwards, so knees never flip backwards. */
export function solveLeg(hip: THREE.Vector3, ankle: THREE.Vector3, forward: THREE.Vector3, knee: THREE.Vector3, resolvedAnkle?: THREE.Vector3) {
  const axis = ankle.clone().sub(hip);
  const rawLength = axis.length();
  const d = clamp(rawLength, 0.06, THIGH + SHIN - 0.001);
  axis.normalize();
  if (rawLength < 1e-6) axis.copy(down);
  resolvedAnkle?.copy(hip).addScaledVector(axis, d);
  const pole = forward.clone().addScaledVector(axis, -forward.dot(axis));
  if (pole.lengthSq() < 1e-5) pole.copy(up).addScaledVector(axis, -axis.y);
  pole.normalize();
  const along = (THIGH * THIGH - SHIN * SHIN + d * d) / (2 * d);
  const bend = Math.sqrt(Math.max(0, THIGH * THIGH - along * along));
  knee.copy(hip).addScaledVector(axis, along).addScaledVector(pole, bend);
  return Math.max(0, rawLength - (THIGH + SHIN));
}
