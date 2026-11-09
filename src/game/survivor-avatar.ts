import * as THREE from 'three';
import type { ArmReference } from './hands';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Retarget the existing procedural pose; no second animation clock or movement controller. */
export class SurvivorAvatar {
  readonly model: THREE.Group;
  private bones = new Map<string, THREE.Bone>();
  private rest = new Map<string, THREE.Quaternion>();
  private axis = new Map<string, THREE.Vector3>();
  private handToDown = new Map<string, THREE.Quaternion>();
  readonly eyes = new THREE.Object3D();
  private hide = { value: 1 };

  constructor(scene: THREE.Group) {
    this.model = scene;
    // The asset faces +Z, while the game faces -Z at yaw zero.
    scene.rotation.y = Math.PI;
    scene.updateMatrixWorld(true);
    scene.traverse(o => {
      if (o instanceof THREE.Bone) {
        this.bones.set(o.name, o);
        this.rest.set(o.name, o.getWorldQuaternion(new THREE.Quaternion()));
        const child = o.children.find(c => c instanceof THREE.Bone);
        if (child) this.axis.set(o.name, child.position.clone().normalize());
      }
    });
    // The authored hands point sideways in the bind pose. Map that axis to the
    // controller's -Y palm frame before applying camera/world orientation.
    for (const side of ['L', 'R']) {
      const hand = this.bone(`Hand${side}`), forearm = this.bone(`ForeArm${side}`);
      const direction = hand.getWorldPosition(new THREE.Vector3()).sub(forearm.getWorldPosition(new THREE.Vector3())).normalize();
      this.handToDown.set(side, new THREE.Quaternion().setFromUnitVectors(direction, new THREE.Vector3(0, -1, 0)));
    }
    // Midpoint of the painted eyes in the asset's 1.8 m bind pose.
    // Convert the landmark once into Head space, so pitching/yawing the head
    // moves the viewpoint along the same anatomical arc as the visible skull.
    this.eyes.name = 'survivor-eyes';
    const head = this.bone('Head');
    this.eyes.position.copy(head.worldToLocal(new THREE.Vector3(0, 1.70, -0.135)));
    head.add(this.eyes);
    scene.traverse(o => {
      if (!(o instanceof THREE.SkinnedMesh)) return;
      o.castShadow = true;
      o.frustumCulled = false;
      const pos = o.geometry.getAttribute('position');
      const joints = o.geometry.getAttribute('skinIndex');
      const weights = o.geometry.getAttribute('skinWeight');
      const mask = new Float32Array(pos.count);
      // Only hide the head, not a horizontal slice through the torso and arms.
      // Keep the asset's opaque, double-sided body: backfaces are visible when
      // looking down from close to the skin and must not become holes.
      for (let i = 0; i < pos.count; i++) {
        let headWeight = 0;
        for (let k = 0; k < 4; k++) {
          const name = o.skeleton.bones[joints.getComponent(i, k)].name;
          if (name === 'Head') headWeight += weights.getComponent(i, k);
        }
        mask[i] = headWeight > 0.5 ? 1 : 0;
      }
      o.geometry.setAttribute('avatarHide', new THREE.BufferAttribute(mask, 1));
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const material of materials) {
        material.onBeforeCompile = shader => {
          shader.uniforms.uAvatarFirstPerson = this.hide;
          shader.vertexShader = 'attribute float avatarHide; varying float vAvatarHide;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvAvatarHide = avatarHide;');
          shader.fragmentShader = 'uniform float uAvatarFirstPerson; varying float vAvatarHide;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uAvatarFirstPerson > 0.5 && vAvatarHide > 0.5) discard;');
        };
        material.customProgramCacheKey = () => 'survivor-head-only-v3';
      }
    });
  }

  static async load() {
    const gltf = await new GLTFLoader().loadAsync('models/Survivor_PS1.glb');
    return new SurvivorAvatar(gltf.scene);
  }

  setFirstPerson(value: boolean) { this.hide.value = value ? 1 : 0; }

  private bone(name: string) {
    const bone = this.bones.get(name);
    if (!bone) throw new Error(`Survivor missing bone: ${name}`);
    return bone;
  }

  private place(name: string, position: THREE.Vector3, rotation: THREE.Quaternion) {
    const bone = this.bone(name), parent = bone.parent!;
    parent.updateWorldMatrix(true, false);
    bone.position.copy(parent.worldToLocal(position.clone()));
    bone.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
    bone.updateWorldMatrix(false, true);
  }

  private orient(name: string, rotation: THREE.Quaternion) {
    const bone = this.bone(name);
    this.place(name, bone.getWorldPosition(new THREE.Vector3()), rotation.clone().multiply(this.rest.get(name)!));
  }

  private segment(name: string, child: string, start: THREE.Vector3, end: THREE.Vector3, frame: THREE.Quaternion) {
    const rotation = frame.clone().multiply(this.rest.get(name)!);
    const from = this.axis.get(name)!.clone().applyQuaternion(rotation);
    rotation.premultiply(new THREE.Quaternion().setFromUnitVectors(from, end.clone().sub(start).normalize()));
    this.place(name, start, rotation);
    // Preserve the existing solver's joint locations despite different authored proportions.
    const next = this.bone(child);
    next.position.copy(next.parent!.worldToLocal(end.clone()));
    next.updateWorldMatrix(false, true);
  }

  pose(pelvis: THREE.Group, chest: THREE.Group, head: THREE.Group,
    legs: { thigh: THREE.Mesh; shin: THREE.Mesh; boot: THREE.Group }[],
    arms: ArmReference[], firstPerson: boolean) {
    this.hide.value = firstPerson ? 1 : 0;
    pelvis.updateWorldMatrix(true, true);
    const frame = pelvis.getWorldQuaternion(new THREE.Quaternion());
    this.place('Hips', pelvis.getWorldPosition(new THREE.Vector3()), frame.clone().multiply(this.rest.get('Hips')!));
    this.orient('Spine', chest.getWorldQuaternion(new THREE.Quaternion()));
    this.orient('Head', head.getWorldQuaternion(new THREE.Quaternion()));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 'L' : 'R', leg = legs[i], arm = arms[i];
      const endpoint = (mesh: THREE.Mesh, sign: number) => mesh.localToWorld(new THREE.Vector3(0, sign * (mesh.scale.y - 0.025) / mesh.scale.y * 0.5, 0));
      leg.thigh.updateWorldMatrix(true, false); leg.shin.updateWorldMatrix(true, false);
      const hip = endpoint(leg.thigh, 1), knee = endpoint(leg.thigh, -1), ankle = endpoint(leg.shin, -1);
      this.segment(`UpperLeg${side}`, `LowerLeg${side}`, hip, knee, frame);
      this.segment(`LowerLeg${side}`, `Foot${side}`, knee, ankle, frame);
      this.orient(`Foot${side}`, leg.boot.getWorldQuaternion(new THREE.Quaternion()));
      const shoulder = arm.shoulder.getWorldPosition(new THREE.Vector3());
      const elbow = arm.elbow.getWorldPosition(new THREE.Vector3());
      const wrist = arm.wrist ?? arm.elbow.localToWorld(new THREE.Vector3(0, -0.245, 0));
      this.segment(`UpperArm${side}`, `ForeArm${side}`, shoulder, elbow, frame);
      this.segment(`ForeArm${side}`, `Hand${side}`, elbow, wrist, frame);
      this.orient(`Hand${side}`, arm.handRotation ? arm.handRotation.clone().multiply(this.handToDown.get(side)!) : arm.elbow.getWorldQuaternion(new THREE.Quaternion()));
    }
    this.model.updateMatrixWorld(true);
  }
}
