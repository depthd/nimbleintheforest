// A small procedural winter-clothed body. The locomotion solver owns the pose;
// this class probes Rapier surfaces and draws interpolated two-bone legs.
import * as THREE from 'three';
import { G, GROUPS_RAY } from './ctx';
import { Tex } from '../core/textures';
import { ANKLE, Locomotion, solveLeg, wrapAngle } from './locomotion';
import type { FootSurface, MotionInput } from './locomotion';
import type { Player } from './player';

const up = new THREE.Vector3(0, 1, 0);
const yAxis = new THREE.Vector3(0, 1, 0);
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const jointGeo = new THREE.SphereGeometry(1, 12, 8);
const limbGeo = new THREE.CylinderGeometry(0.86, 1, 1, 12);

interface LegMesh {
  thigh: THREE.Mesh;
  shin: THREE.Mesh;
  knee: THREE.Mesh;
  boot: THREE.Group;
}

export class PlayerAvatar {
  readonly motion = new Locomotion();
  readonly root = new THREE.Group();
  readonly inspectionCamera = new THREE.PerspectiveCamera(48, 1, 0.05, 14000);
  inspectionView: 0 | 1 | 2 = 0;
  private pelvis = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private legs: LegMesh[] = [];
  private arms: { shoulder: THREE.Group; elbow: THREE.Group }[] = [];
  private visualFeet = [new THREE.Vector3(), new THREE.Vector3()];
  private visualKnees = [new THREE.Vector3(), new THREE.Vector3()];
  private reachErrors = [0, 0];
  private inspectionReady = false;
  private readonly hideUpperBody = { value: 1 };
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3(0, -1, 0);

  constructor(private player: Player) {
    this.root.name = 'player-avatar';
    G.scene.add(this.root);
    const fabric = (color: string) => new THREE.MeshStandardMaterial({ map: Tex.fabric(color), roughness: 0.96 });
    const pants = fabric('#46515b');
    const jacket = fabric('#625e49');
    const trim = new THREE.MeshStandardMaterial({ color: 0x34372f, roughness: 0.95 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x342d27, roughness: 0.87 });
    const sole = new THREE.MeshStandardMaterial({ color: 0x171b1d, roughness: 1 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xb48d74, roughness: 0.88 });
    const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
      scale: number[], position = [0, 0, 0]) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.fromArray(scale);
      m.position.fromArray(position);
      m.castShadow = m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const hiddenMaterials = new Map<THREE.Material, THREE.Material>();
    const hide = (m: THREE.Mesh) => {
      const base = m.material as THREE.MeshStandardMaterial;
      let material = hiddenMaterials.get(base);
      if (!material) {
        const copy = base.clone();
        copy.onBeforeCompile = shader => {
          shader.uniforms.uFirstPersonBody = this.hideUpperBody;
          shader.fragmentShader = 'uniform float uFirstPersonBody;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>',
            '#include <clipping_planes_fragment>\nif (uFirstPersonBody > 0.5) discard;');
        };
        copy.customProgramCacheKey = () => 'avatar-first-person-hidden';
        hiddenMaterials.set(base, copy);
        material = copy;
      }
      m.material = material;
    };
    this.root.add(this.pelvis);
    mesh(this.pelvis, jointGeo, pants, [0.215, 0.135, 0.145], [0, 0, 0.08]);
    this.pelvis.add(this.chest);
    this.chest.position.set(0, 0.035, 0.08);
    // Rounded jacket, cuffs, pockets and zip: useful silhouette without an asset dependency.
    const coat = mesh(this.chest, new THREE.CylinderGeometry(0.235, 0.225, 0.43, 12), jacket, [1, 1, 0.72], [0, 0.21, 0]);
    hide(coat); // upper torso must not occlude the first-person view looking down
    mesh(this.chest, new THREE.CylinderGeometry(0.225, 0.225, 0.12, 12), jacket, [1, 1, 0.72], [0, 0.06, 0]);
    mesh(this.chest, new THREE.CylinderGeometry(0.227, 0.227, 0.045, 12), trim, [1, 1, 0.73], [0, 0.015, 0]);
    hide(mesh(this.chest, unitBox, trim, [0.012, 0.4, 0.015], [0, 0.21, -0.169]));
    for (const sign of [-1, 1]) {
      hide(mesh(this.chest, unitBox, jacket, [0.12, 0.115, 0.023], [sign * 0.13, 0.12, -0.143]));
      hide(mesh(this.chest, unitBox, trim, [0.12, 0.015, 0.025], [sign * 0.13, 0.178, -0.145]));
      const shoulder = new THREE.Group();
      shoulder.position.set(sign * 0.255, 0.41, 0);
      shoulder.rotation.z = sign * 0.09;
      this.chest.add(shoulder);
      hide(mesh(shoulder, jointGeo, jacket, [0.105, 0.12, 0.105]));
      hide(mesh(shoulder, limbGeo, jacket, [0.085, 0.27, 0.085], [0, -0.135, 0]));
      const elbow = new THREE.Group();
      elbow.position.y = -0.27;
      shoulder.add(elbow);
      mesh(elbow, jointGeo, jacket, [0.083, 0.083, 0.083]);
      mesh(elbow, limbGeo, jacket, [0.075, 0.245, 0.075], [0, -0.12, 0]);
      mesh(elbow, limbGeo, trim, [0.076, 0.045, 0.076], [0, -0.24, 0]);
      mesh(elbow, jointGeo, leather, [0.064, 0.105, 0.055], [0, -0.315, -0.008]);
      this.arms.push({ shoulder, elbow });
    }
    this.chest.add(this.head);
    this.head.position.set(0, 0.43, 0);
    mesh(this.head, limbGeo, skin, [0.065, 0.12, 0.065], [0, 0.02, 0]);
    mesh(this.head, jointGeo, skin, [0.102, 0.137, 0.105], [0, 0.15, -0.014]);
    mesh(this.head, jointGeo, trim, [0.113, 0.093, 0.118], [0, 0.235, 0.005]);
    mesh(this.head, unitBox, skin, [0.04, 0.045, 0.035], [0, 0.15, -0.12]);
    // Main-pass cutout leaves depth/shadow materials intact: even in first person
    // the full body, including the head, casts its real animated shadow.
    this.head.traverse(o => { if (o instanceof THREE.Mesh) hide(o); });

    for (const sign of [-1, 1]) {
      const thigh = mesh(this.root, limbGeo, pants, [0.105, 0.46, 0.105]);
      const shin = mesh(this.root, limbGeo, pants, [0.082, 0.45, 0.082]);
      const knee = mesh(this.root, jointGeo, pants, [0.091, 0.098, 0.091]);
      const boot = new THREE.Group();
      boot.name = sign < 0 ? 'left-boot' : 'right-boot';
      this.root.add(boot);
      mesh(boot, unitBox, sole, [0.145, 0.047, 0.31], [0, 0.025, -0.045]);
      mesh(boot, jointGeo, leather, [0.073, 0.071, 0.165], [0, 0.082, -0.045]);
      mesh(boot, new THREE.CylinderGeometry(0.065, 0.07, 0.19, 12), leather, [1, 1, 1], [0, 0.18, 0.025]);
      mesh(boot, new THREE.CylinderGeometry(0.075, 0.075, 0.04, 12), trim, [1, 1, 1], [0, 0.27, 0.025]);
      for (let i = 0; i < 3; i++) mesh(boot, unitBox, trim, [0.08, 0.008, 0.01], [0, 0.142 - i * 0.011, -0.055 - i * 0.025]);
      this.legs.push({ thigh, shin, knee, boot });
    }
  }

  private input(): MotionInput {
    const p = this.player;
    return { position: p.pos, yaw: p.yaw, pitch: p.pitch, grounded: p.grounded,
      crouch: p.crouch, sprinting: p.sprinting, suspended: !!p.water || G.sleeping || G.dead };
  }

  // Actual collision surfaces include house floors, porch steps, rocks and lake ice.
  // A terrain height lookup alone would put feet through all those surfaces.
  readonly probe = (x: number, z: number, referenceY: number): FootSurface | null => {
    this.origin.set(x, referenceY + 0.55, z);
    const p = this.player;
    const hit = G.world.castRayAndGetNormal(new G.R.Ray(this.origin, this.direction), 1.3, true,
      G.R.QueryFilterFlags.EXCLUDE_SENSORS, GROUPS_RAY, p.collider, p.carried?.body ?? p.body);
    if (!hit || hit.normal.y < 0.48) return null;
    return { point: new THREE.Vector3(x, this.origin.y - hit.timeOfImpact + 0.012, z),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).normalize(), support: hit.collider.handle };
  };

  reset() {
    this.motion.reset(this.input(), this.probe);
    this.inspectionReady = false;
  }

  update(dt: number) {
    this.motion.update(dt, this.input(), this.probe);
    for (const contact of this.motion.contacts) {
      const pos = contact.position;
      const indoors = !!G.house.zoneAt(pos) || (Math.abs(pos.x) < 5 && pos.z > 3.9 && pos.z < 6.1 && Math.abs(pos.y - G.house.Y0) < 0.3);
      G.audio.play(indoors ? 'step_wood' : 'step_snow', {
        pos, vol: (this.player.crouch ? 0.4 : 1) * (contact.landing ? 1.1 : 1),
      });
    }
  }

  cycleInspection() {
    this.inspectionView = ((this.inspectionView + 1) % 3) as 0 | 1 | 2;
    this.inspectionReady = false;
    return ['От первого лица', 'Осмотр тела: сбоку', 'Осмотр тела: спереди'][this.inspectionView];
  }

  /** Draw once per render frame. Stance anchors stay fixed even between physics ticks. */
  render(alpha: number, dt: number) {
    const m = this.motion;
    this.hideUpperBody.value = this.inspectionView ? 0 : 1;
    const a = THREE.MathUtils.clamp(alpha, 0, 1);
    const origin = new THREE.Vector3().lerpVectors(m.previousPosition, m.position, a);
    this.root.position.copy(origin);
    this.root.visible = !this.player.water && !G.sleeping;
    const yaw = m.previousBodyYaw + wrapAngle(m.bodyYaw - m.previousBodyYaw) * a;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const hipY = THREE.MathUtils.lerp(m.previousHipHeight, m.hipHeight, a);
    this.pelvis.position.copy(forward).multiplyScalar(-0.14);
    this.pelvis.position.y = hipY;
    this.pelvis.rotation.y = yaw;
    this.chest.rotation.set(m.chestPitch, m.chestYaw, 0, 'YXZ');
    this.head.rotation.set(m.headPitch, m.headYaw, 0, 'YXZ');
    for (let i = 0; i < 2; i++) {
      const f = m.feet[i], leg = this.legs[i];
      const sole = this.visualFeet[i].lerpVectors(f.previous, f.position, a);
      const footYaw = f.previousYaw + wrapAngle(f.yaw - f.previousYaw) * a;
      const tilt = new THREE.Quaternion().setFromUnitVectors(up, f.normal);
      leg.boot.position.copy(sole).sub(origin);
      leg.boot.quaternion.copy(tilt).multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, footYaw));
      // Toe clearance while swinging; the support pose itself stays flat on its normal.
      if (f.swinging) leg.boot.rotateX(-Math.sin(f.progress * Math.PI * 2) * 0.13);
      const ankle = new THREE.Vector3(0, ANKLE, 0.025).applyQuaternion(leg.boot.quaternion).add(sole);
      const hip = origin.clone().addScaledVector(right, f.sign * (0.115 + m.crouch * 0.02));
      hip.y += hipY;
      hip.addScaledVector(forward, -0.14);
      const knee = this.visualKnees[i];
      this.reachErrors[i] = solveLeg(hip, ankle, forward.clone().addScaledVector(right, f.sign * 0.12), knee);
      this.segment(leg.thigh, hip, knee, origin, 0.105);
      this.segment(leg.shin, knee, ankle, origin, 0.082);
      leg.knee.position.copy(knee).sub(origin);
      const relative = sole.clone().sub(hip).dot(forward);
      const arm = this.arms[i];
      const holding = !!this.player.equipped || !!this.player.carried || this.player.handsWarming;
      const armSwing = THREE.MathUtils.clamp(-relative * 1.3, -0.65, 0.65);
      arm.shoulder.rotation.x = holding ? 0.65 : armSwing;
      arm.elbow.rotation.x = holding ? 0.8 : 0.2 + Math.abs(armSwing) * 0.25;
    }
    if (this.inspectionView) {
      const target = origin.clone().add(new THREE.Vector3(0, this.player.crouch ? 0.62 : 0.92, 0));
      const eye = target.clone().addScaledVector(this.inspectionView === 1 ? right : forward, 3.3);
      eye.addScaledVector(forward, this.inspectionView === 1 ? 0.55 : 0);
      eye.y += 0.45;
      if (!this.inspectionReady) this.inspectionCamera.position.copy(eye);
      else this.inspectionCamera.position.lerp(eye, 1 - Math.exp(-dt * 8));
      this.inspectionReady = true;
      this.inspectionCamera.aspect = G.camera.aspect;
      this.inspectionCamera.updateProjectionMatrix();
      this.inspectionCamera.lookAt(target);
    }
  }

  private segment(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3, origin: THREE.Vector3, radius: number) {
    mesh.position.copy(start).add(end).multiplyScalar(0.5).sub(origin);
    const dir = start.clone().sub(end);
    mesh.scale.set(radius, dir.length() + 0.025, radius);
    mesh.quaternion.setFromUnitVectors(up, dir.normalize());
  }

  snapshot() {
    return { ...this.motion.snapshot(), inspectionView: this.inspectionView,
      visualFeet: this.visualFeet.map(f => f.toArray()), knees: this.visualKnees.map(k => k.toArray()), reachErrors: [...this.reachErrors] };
  }
}
