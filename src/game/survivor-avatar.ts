import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Retarget the existing procedural pose; no second animation clock or movement controller. */
export class SurvivorAvatar {
  readonly model: THREE.Group;
  private bones = new Map<string, THREE.Bone>();
  private rest = new Map<string, THREE.Quaternion>();
  private axis = new Map<string, THREE.Vector3>();
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
    scene.traverse(o => {
      if (!(o instanceof THREE.SkinnedMesh)) return;
      o.castShadow = true;
      o.frustumCulled = false;
      const pos = o.geometry.getAttribute('position');
      const mask = new Float32Array(pos.count);
      // Bind-space mask follows skinning and affects only the main material, not shadows.
      for (let i = 0; i < pos.count; i++) mask[i] = pos.getY(i) > 1.12 || (pos.getY(i) > 0.98 && Math.abs(pos.getX(i)) < 0.28) ? 1 : 0;
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
        material.customProgramCacheKey = () => 'survivor-first-person-v1';
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
    arms: { shoulder: THREE.Group; elbow: THREE.Group }[], firstPerson: boolean) {
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
      const wrist = arm.elbow.localToWorld(new THREE.Vector3(0, -0.245, 0));
      this.segment(`UpperArm${side}`, `ForeArm${side}`, shoulder, elbow, frame);
      this.segment(`ForeArm${side}`, `Hand${side}`, elbow, wrist, frame);
      this.orient(`Hand${side}`, arm.elbow.getWorldQuaternion(new THREE.Quaternion()));
    }
    this.model.updateMatrixWorld(true);
  }
}
