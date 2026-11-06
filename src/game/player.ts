// First-person player: movement with a physics character controller, inventory,
// clothing, carrying physical objects, falling through ice.
import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { G, GROUPS_HELD, GROUPS_ITEM, GROUPS_PLAYER, GR_ITEM, GR_STATIC, GR_TREE, groups, msg } from './ctx';
import { Entity } from './entities';
import { Slot } from './items';
import { clamp } from '../core/rng';
import { PlayerAvatar } from './avatar';

const EYE = 1.7;
const HALF = 0.6;
const RADIUS = 0.3;
export const MAX_LIFT = 30;
export const MAX_DRAG = 90;
export const MAX_PACK = 16;

export class Player {
  pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  vy = 0;
  grounded = false;
  moving = false;
  sprinting = false;
  crouch = false;
  stamina = 1;
  body!: RAPIER_T.RigidBody;
  collider!: RAPIER_T.Collider;
  kcc!: RAPIER_T.KinematicCharacterController;
  avatar!: PlayerAvatar;
  inventory: Entity[] = [];
  worn = new Map<Slot, Entity>();
  equipped: Entity | null = null;
  carried: Entity | null = null;
  carryDist = 1.4;
  carryYaw = 0;
  /** wood held for building: 0 lying across, π/2 upright, π/4 slanted */
  carryTilt = 0;
  private carryBaseQ = new THREE.Quaternion();
  dragging = false;
  wrapped: Entity | null = null;
  handsWarming = false;
  water: { hole: THREE.Vector3; climb: number } | null = null;
  private fallStartY = 0;
  private breathT = 0;
  lastActivity: 'idle' | 'walk' | 'sprint' = 'idle';
  workT = 0; // seconds of recent physical work (chopping)

  init(spawn: THREE.Vector3, yaw: number) {
    const R = G.R;
    this.pos.copy(spawn);
    this.prevPos.copy(spawn);
    this.yaw = yaw;
    this.body = G.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + HALF + RADIUS, spawn.z));
    this.collider = G.world.createCollider(R.ColliderDesc.capsule(HALF, RADIUS).setCollisionGroups(GROUPS_PLAYER).setFriction(0), this.body);
    this.kcc = G.world.createCharacterController(0.03);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.kcc.enableAutostep(0.32, 0.15, false);
    this.kcc.enableSnapToGround(0.35);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(80);
    this.fallStartY = spawn.y;
    this.avatar = new PlayerAvatar(this);
    this.avatar.reset();
  }

  /** position at the previous physics step, for smooth rendering between steps */
  prevPos = new THREE.Vector3();
  /** 0..1: how far the render frame is between the previous and the current step */
  renderAlpha = 1;
  private camY = NaN;
  winded = false;
  private bobAmp = 0;

  private get eyeOffset() {
    const yaw = this.avatar?.motion.bodyYaw ?? this.yaw;
    return new THREE.Vector3(-Math.sin(yaw) * 0.12, 0, -Math.cos(yaw) * 0.12);
  }

  get eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + (this.crouch ? 1.05 : EYE), this.pos.z).add(this.eyeOffset);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  packWeight() {
    return this.inventory.reduce((s, e) => s + (this.worn.get(e.def?.wear?.slot as Slot) === e ? 0 : e.mass), 0);
  }

  // ---------- inventory ----------

  /** what you can carry: pockets and hands, more with a backpack */
  maxPack() {
    return MAX_PACK + (this.worn.get('back')?.def?.wear?.pack ?? 0);
  }

  addToInventory(e: Entity): boolean {
    if (this.packWeight() + e.mass > this.maxPack()) {
      msg('Рюкзак переполнен', 'warn');
      return false;
    }
    if (e.inWorld || e.pinned) {
      if (e.pinned === 'fire') G.fires.takeFromSpot(e);
      G.entities.removeFromWorld(e);
    }
    if (!this.inventory.includes(e)) this.inventory.push(e);
    G.audio.play('pickup');
    return true;
  }

  /** Remove an entity from wherever the player holds it (inventory, hands, clothes). */
  forget(e: Entity) {
    const i = this.inventory.indexOf(e);
    if (i >= 0) this.inventory.splice(i, 1);
    if (this.equipped === e) this.equipped = null;
    if (this.carried === e) this.carried = null;
    if (this.wrapped === e) this.wrapped = null;
    for (const [k, v] of this.worn) if (v === e) this.worn.delete(k);
  }

  has(pred: (e: Entity) => boolean) {
    return this.inventory.find(pred) ?? null;
  }

  hasTag(tag: string) {
    return this.inventory.find((e) => e.def?.tool?.tags.includes(tag as never)) ?? null;
  }

  wear(e: Entity) {
    const w = e.def?.wear;
    if (!w) return;
    const prev = this.worn.get(w.slot);
    if (prev === e) return;
    if (!this.inventory.includes(e) && !this.addToInventory(e)) return;
    this.worn.set(w.slot, e);
    if (this.equipped === e) this.equipped = null;
    this.recalcWetness();
    msg(`Надето: ${e.name}${prev ? ` (снято: ${prev.name})` : ''}`, 'good');
  }

  unwear(e: Entity) {
    for (const [k, v] of this.worn) if (v === e) this.worn.delete(k);
    this.recalcWetness();
  }

  /** body wetness = warmth-weighted wetness of what you wear */
  private recalcWetness() {
    let s = 0, w = 0;
    for (const x of this.worn.values()) {
      const d = x.def?.wear;
      if (!d || d.slot === 'back') continue;
      s += x.moisture * (d.clo + 0.1);
      w += d.clo + 0.1;
    }
    G.body.wetness = w > 0 ? s / w : 0;
  }

  isWorn(e: Entity) {
    for (const v of this.worn.values()) if (v === e) return true;
    return false;
  }

  equip(e: Entity | null) {
    if (e && !this.inventory.includes(e)) return;
    if (e && this.isWorn(e)) this.unwear(e);
    G.interact?.stopFlame();
    if (this.equipped?.defId === 'flashlight' && this.equipped !== e) this.equipped.lit = false;
    this.equipped = this.equipped === e ? null : e;
    G.audio.play('click');
  }

  /** Put an item down in front of the player. */
  dropFromInventory(e: Entity) {
    this.forget(e);
    const p = this.eyePos.add(this.forward().multiplyScalar(0.7));
    p.y -= 0.3;
    G.entities.placeInWorld(e, p, undefined, this.forward().multiplyScalar(1));
    G.audio.play('drop');
  }

  // ---------- carrying ----------

  carry(e: Entity) {
    if (this.carried) this.releaseCarry();
    if (e.pinned === 'fire') G.fires.takeFromSpot(e);
    if (!e.inWorld || !e.body) {
      // from inventory or a fixed spot
      this.forget(e);
      if (e.pinned) G.entities.removeFromWorld(e);
      const p = this.eyePos.add(this.forward().multiplyScalar(1.2));
      G.entities.placeInWorld(e, p);
    }
    this.carried = e;
    this.dragging = e.mass > MAX_LIFT;
    for (const c of e.colliders) c.setCollisionGroups(GROUPS_HELD);
    e.body!.setGravityScale(this.dragging ? 1 : 0, true);
    e.body!.wakeUp();
    const r = e.body!.rotation();
    const camQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.carryBaseQ.copy(camQ.invert()).multiply(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    this.carryYaw = 0;
    this.carryTilt = 0;
    this.carryDist = this.dragging ? 1.6 : clamp(this.eyePos.distanceTo(e.position()), 1.0, 1.8);
    G.audio.play('pickup');
  }

  releaseCarry(throwIt = false) {
    const e = this.carried;
    if (!e) return;
    this.carried = null;
    if (!e.body) return;
    for (const c of e.colliders) c.setCollisionGroups(GROUPS_ITEM);
    e.body.setGravityScale(1, true);
    if (throwIt && !this.dragging) {
      const v = this.forward().multiplyScalar(11 / Math.sqrt(e.mass + 0.6)).add(new THREE.Vector3(0, 1, 0));
      e.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
      e.body.setAngvel({ x: Math.random() * 4 - 2, y: Math.random() * 4 - 2, z: Math.random() * 4 - 2 }, true);
      G.audio.play('swing');
    } else {
      const lv = e.body.linvel();
      e.body.setLinvel({ x: lv.x * 0.3, y: Math.min(lv.y, 0), z: lv.z * 0.3 }, true);
    }
    this.dragging = false;
  }

  private updateCarry(dt: number) {
    const e = this.carried;
    if (!e || !e.body) return;
    if (e.removed || !e.inWorld) {
      this.carried = null;
      return;
    }
    if (G.input.wheel) this.carryDist = clamp(this.carryDist - G.input.wheel * 0.12, 0.7, 2.4);
    if (G.input.hit('KeyR')) this.carryYaw += Math.PI / 4;
    const wood = !!e.data.wood && !this.dragging;
    if (wood && G.input.hit('KeyB')) this.carryTilt = this.carryTilt === 0 ? Math.PI / 2 : this.carryTilt > 1 ? Math.PI / 4 : 0;
    const eye = this.eyePos;
    const target = eye.clone().add(this.forward().multiplyScalar(this.carryDist));
    const p = e.position();
    if (this.dragging) target.y = p.y;
    const diff = target.sub(p);
    if (diff.length() > 2.6) {
      msg(`${e.name} выскользнул из рук`, 'warn');
      this.releaseCarry();
      return;
    }
    const maxV = this.dragging ? 2.2 : 9 / Math.sqrt(Math.max(1, e.mass / 4));
    const v = diff.multiplyScalar(this.dragging ? 6 : 14);
    if (v.length() > maxV) v.setLength(maxV);
    const lv = e.body.linvel();
    e.body.setLinvel({ x: v.x, y: this.dragging ? lv.y : v.y, z: v.z }, true);
    // orientation follows view yaw
    // wood is held lying across the view (R turns it, B stands it up); other things keep how they were picked up
    const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw + this.carryYaw);
    if (wood) want.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.carryTilt));
    else want.multiply(this.carryBaseQ);
    const r = e.body.rotation();
    const cur = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const dq = want.multiply(cur.invert());
    if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
    const ang = 2 * Math.acos(clamp(dq.w, -1, 1));
    const s = Math.sqrt(1 - dq.w * dq.w);
    const k = this.dragging ? 1.5 : 7;
    if (s > 1e-4) e.body.setAngvel({ x: (dq.x / s) * ang * k, y: (dq.y / s) * ang * k, z: (dq.z / s) * ang * k }, true);
    else e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  // ---------- water ----------

  fallThroughIce(hole: THREE.Vector3) {
    this.releaseCarry();
    const L = G.lake.levelAt(hole.x, hole.z);
    this.water = { hole: hole.clone().setY(Number.isNaN(L) ? hole.y : L), climb: 0 };
    G.audio.play('ice_break', { pos: hole });
    G.audio.play('splash', { pos: hole });
    G.fx.burst('splash', this.water.hole.clone().setY(this.water.hole.y + 0.1), 30);
    msg('Лёд проломился! Вы в ледяной воде! Жмите [Пробел], чтобы выбраться.', 'bad');
    // matches in the pack get soaked
    for (const e of this.inventory) if (e.defId === 'matches' && Math.random() < 0.8) e.moisture = 1;
  }

  private updateWater(dt: number) {
    const w = this.water!;
    const target = new THREE.Vector3(w.hole.x, w.hole.y - 1.3, w.hole.z);
    this.pos.copy(target);
    this.body.setNextKinematicTranslation({ x: target.x, y: target.y + HALF + RADIUS, z: target.z });
    // you slide back slowly; an axe or knife bites into the ice like an ice pick
    w.climb = Math.max(0, w.climb - dt * 0.05);
    if (G.input.hit('Space')) {
      const pick = this.inventory.some((x) => x.defId === 'axe' || x.defId === 'hatchet' || x.defId === 'knife') ? 1.5 : 1;
      w.climb += 0.13 * (0.55 + 0.45 * G.body.dex) * (0.6 + 0.4 * this.stamina) * pick;
      this.stamina = Math.max(0, this.stamina - 0.06);
      G.audio.play('splash', { pos: w.hole, vol: 0.4 });
    }
    if (w.climb >= 1) {
      // climb out onto the nearest thick ice or the bank
      const out = G.lake.safeSpotNear(w.hole) ?? w.hole.clone().setY(w.hole.y + 0.06);
      this.water = null;
      this.teleport(out);
      msg('Вы выбрались. Одежда мокрая насквозь — срочно к огню!', 'warn');
    }
  }

  teleport(p: THREE.Vector3) {
    this.pos.copy(p);
    this.prevPos.copy(p);
    this.camY = NaN;
    this.vy = 0;
    this.hvx = this.hvz = 0;
    this.moving = this.sprinting = this.grounded = false;
    this.body.setTranslation({ x: p.x, y: p.y + HALF + RADIUS, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + HALF + RADIUS, z: p.z });
    this.fallStartY = p.y;
    this.avatar?.reset();
  }

  // ---------- per frame ----------

  look() {
    const inp = G.input;
    if (!inp.locked || !inp.enabled) return;
    this.yaw -= inp.mouseDX * inp.sensitivity;
    this.pitch -= inp.mouseDY * inp.sensitivity;
    this.pitch = clamp(this.pitch, -1.5, 1.5);
  }

  /** Called every fixed physics step before world.step(). */
  physics(dt: number) {
    this.prevPos.copy(this.pos);
    this.updateCarry(dt);
    if (this.water) {
      this.updateWater(dt);
      return;
    }
    const inp = G.input;
    const busy = G.sleeping || G.dead || !inp.enabled;
    let fx = 0, fz = 0;
    if (!busy) {
      if (inp.down('KeyW')) fz -= 1;
      if (inp.down('KeyS')) fz += 1;
      if (inp.down('KeyA')) fx -= 1;
      if (inp.down('KeyD')) fx += 1;
    }
    const len = Math.hypot(fx, fz);
    this.crouch = !busy && (inp.down('ControlLeft') || inp.down('KeyC'));
    const wantSprint = !busy && inp.down('ShiftLeft') && fz < 0 && !this.crouch;
    const B = G.body;
    const maxStam = 1 - Math.max(0, B.fatigue - 0.6) * 1.5;
    // out of breath: no sprinting until you have caught your breath a little
    if (this.stamina <= 0.05) {
      if (!this.winded && wantSprint) msg('Вы запыхались', 'warn');
      this.winded = true;
    } else if (this.stamina > 0.3) this.winded = false;
    this.sprinting = wantSprint && !this.winded && len > 0 && !this.dragging;
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt / 7);
    else this.stamina = Math.min(maxStam, this.stamina + (dt / (len > 0 ? 14 : 7)) * (G.body.mood > 0.7 ? 1.25 : 1));

    // a grown man in winter clothes: ~1.5 m/s walking in snow, ~3.3 m/s running
    let speed = this.crouch ? 1.0 : this.sprinting ? 5.2 : 1.95;
    const pack = this.packWeight();
    speed *= clamp(1 - (pack - this.maxPack() * 0.5) / (this.maxPack() * 0.9), 0.45, 1);
    if (this.carried) speed *= this.dragging ? 0.45 : clamp(1 - this.carried.mass / 50, 0.5, 1);
    if (this.wrapped) speed *= 0.72;
    if (B.core < 35) speed *= 0.8;
    if (B.fatigue > 0.9) speed *= 0.8;
    if (B.frostFeet > 0.3) speed *= 1 - B.frostFeet * 0.3;
    const outdoors = !G.house.zoneAt(this.pos);
    if (outdoors && !G.lake.onIce(this.pos)) speed *= 0.88; // snow
    const snow = G.snow?.movement(this.pos.x, this.pos.z, this.pos.y);
    if (snow) speed *= snow.speed;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let tx = 0, tz = 0;
    if (len > 0) {
      const nx = fx / len, nz = fz / len;
      tx = (nx * cos + nz * sin) * speed;
      tz = (-nx * sin + nz * cos) * speed;
    }
    // body weight: speed builds up and dies down instead of snapping
    const acc = 1 - Math.exp(-dt * (this.grounded ? (len > 0 ? 5 : 7) : 0.8));
    this.hvx += (tx - this.hvx) * acc;
    this.hvz += (tz - this.hvz) * acc;
    const vx = this.hvx, vz = this.hvz;
    if (this.grounded && !busy && inp.hit('Space') && this.stamina > 0.1) {
      this.vy = 4.3;
      this.stamina -= 0.08;
      this.grounded = false;
    }
    this.vy -= 9.81 * dt;
    if (this.vy < -30) this.vy = -30;

    const desired = { x: vx * dt, y: this.vy * dt, z: vz * dt };
    const carriedBody = this.carried?.body ?? null;
    this.kcc.computeColliderMovement(
      this.collider,
      desired,
      G.R.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(0x0004, GR_STATIC | GR_TREE | GR_ITEM),
      carriedBody ? (c) => c.parent()?.handle !== carriedBody.handle : undefined,
    );
    const mv = this.kcc.computedMovement();
    const t = this.body.translation();
    const nx = t.x + mv.x, nz = t.z + mv.z;
    let ny = t.y + mv.y;
    const snowSupport = G.snow?.movement(nx, nz, this.pos.y);
    const supportedBySnow = !!snowSupport && this.vy <= 0 &&
      this.pos.y >= snowSupport.height - 0.2 && ny - HALF - RADIUS <= snowSupport.height + (this.grounded ? 0.06 : 0.001);
    // Small changes of loaded support are settling, not repeated airborne/landing
    // transitions. Keep solid steps authoritative when Rapier finds one above it.
    if (supportedBySnow) ny = this.kcc.computedGrounded()
      ? Math.max(ny, snowSupport!.height + HALF + RADIUS) : snowSupport!.height + HALF + RADIUS;
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded() || supportedBySnow;
    if (this.grounded) {
      if (!wasGrounded) this.land();
      if (this.vy < 0) this.vy = 0;
      this.fallStartY = ny;
    } else if (wasGrounded) this.fallStartY = ny;
    else this.fallStartY = Math.max(this.fallStartY, ny);
    // world boundary
    const Rg = G.region;
    const px = clamp(nx, Rg.minX + 30, Rg.maxX - 30), pz = clamp(nz, Rg.minZ + 30, Rg.maxZ - 30);
    this.body.setNextKinematicTranslation({ x: px, y: ny, z: pz });
    const moved = Math.hypot(px - this.pos.x, pz - this.pos.z);
    this.pos.set(px, ny - HALF - RADIUS, pz);
    this.moving = moved > dt * 0.5;
    this.lastActivity = this.moving ? (this.sprinting ? 'sprint' : 'walk') : 'idle';
    // stepped or slid into open water
    const wl = G.lake.levelAt(this.pos.x, this.pos.z);
    if (!Number.isNaN(wl) && this.pos.y < wl - 0.45) {
      this.fallThroughIce(this.pos.clone());
      return;
    }
    // thin ice
    const onSnowBed = G.snow?.isExperiment && G.snow.contains(this.pos.x, this.pos.z) && this.pos.y > G.snow.baseY - 0.2;
    if (!onSnowBed && G.lake.onThin(this.pos) && this.grounded) {
      G.lake.thinBroken = true;
      this.fallThroughIce(this.pos.clone());
      const h = G.lake.makeHole(new THREE.Vector3(this.pos.x, 0, this.pos.z), 1.0, 'Полынья');
      h.data.big = true;
    }
  }

  private hvx = 0;
  private hvz = 0;

  private land() {
    const drop = this.fallStartY - (this.body.translation().y);
    if (drop > 2.2) {
      const dmg = Math.round((drop - 2.2) * 12);
      G.body.condition = Math.max(0, G.body.condition - dmg);
      G.hud.flash('bad');
      G.audio.play('thud');
      msg(drop > 3.5 ? 'Вы тяжело упали! Больно.' : 'Неудачное приземление', 'bad');
    }
  }

  /** Camera placement after physics. */
  updateCamera(dtReal: number) {
    const cam = G.camera;
    const e = this.eyePos;
    // between physics steps: interpolate, so fast movement doesn't stutter
    const a = THREE.MathUtils.clamp(this.renderAlpha, 0, 1);
    const ip = this.prevPos.clone().lerp(this.pos, a);
    const motion = this.avatar.motion;
    const eyeY = ip.y + EYE - motion.crouch * (EYE - 1.05);
    // steps over rocks and bumps are eased instead of snapping the view
    if (Number.isNaN(this.camY) || Math.abs(this.camY - eyeY) > 1.5) this.camY = eyeY;
    else this.camY += (eyeY - this.camY) * Math.min(1, dtReal * 18);
    // head bob fades in and out instead of switching on and off
    const want = this.moving && this.grounded ? (this.sprinting ? 1.5 : 1) : 0;
    this.bobAmp += (want - this.bobAmp) * Math.min(1, dtReal * 6);
    // Small translation follows actual foot swings; looking remains immediate.
    const lift = motion.feet.map(f => f.swinging ? Math.sin(f.progress * Math.PI) : 0);
    const bobY = -Math.max(...lift) * 0.018 * this.bobAmp;
    const bobX = (lift[0] - lift[1]) * 0.012 * this.bobAmp;
    const eyeOffset = this.eyeOffset;
    e.x = ip.x + eyeOffset.x;
    e.z = ip.z + eyeOffset.z;
    e.y = this.camY;
    const sh = G.body.shiver > 20 ? (G.body.shiver / 260) * 0.006 : 0;
    const water = this.water ? Math.sin(performance.now() / 300) * 0.05 : 0;
    cam.position.set(e.x + Math.cos(this.yaw) * bobX + (Math.random() - 0.5) * sh, e.y + bobY + water + (Math.random() - 0.5) * sh, e.z - Math.sin(this.yaw) * bobX);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw;
    cam.rotation.x = this.pitch + (Math.random() - 0.5) * sh * 2;
    cam.rotation.z = 0;
    this.avatar.render(a, dtReal);
    // breath vapour in cold air
    this.breathT -= dtReal;
    const air = G.thermal.tAt(cam.position);
    if (this.breathT <= 0) {
      this.breathT = this.sprinting ? 1.4 : 3.2;
      if (air < 3) G.fx.breath(cam.position.clone().add(new THREE.Vector3(0, -0.12, 0)), this.forward());
    }
  }
}
