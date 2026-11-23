import * as THREE from 'three';
import { G, GROUPS_STATIC } from '../../game/ctx';
import type { Site } from '../../gen/region';
import { mountainRockMaterial } from './rock-material';
import { buildMountainBridge } from './bridge';
import type { MeshData, Point } from './geometry';
import { buildMountainPassages } from './passages';
import { createMountainRope, createMountainRopeState, nearRope, stepMountainRope, type MountainRope } from './rope';
import type { MountainTerrain } from './terrain';

/** The route lives in the ordinary outdoor scene and physics world. Its two cave
 * mouths are connected geometry, so there is no loading screen on the climb. */
export class Mountains {
  private readonly rope: MountainRope;
  private ropeState = createMountainRopeState();
  bridgeHandle?: number;
  snowHandle?: number;
  readonly groundHandles = new Set<number>();
  readonly surfaces = new Map<number, string>();

  constructor(site: Site, terrain: MountainTerrain) {
    const position = (p: Point) => new THREE.Vector3(site.x + p.x, site.y + p.y, site.z + p.z);
    const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed().setTranslation(site.x, site.y, site.z));
    const group = new THREE.Group();
    group.name = 'mountain-pass';
    group.position.set(site.x, site.y, site.z);
    G.scene.add(group);

    const rock = mountainRockMaterial();
    const snow = new THREE.MeshStandardMaterial({ color: 0xe4e8ef, roughness: 1, side: THREE.DoubleSide });
    const cave = new THREE.MeshStandardMaterial({ color: 0x555963, roughness: 1, flatShading: true, side: THREE.DoubleSide });
    const cable = new THREE.MeshStandardMaterial({ color: 0x9f8153, roughness: 1 });
    const anchor = new THREE.MeshStandardMaterial({ color: 0x493d35, roughness: 1 });
    const addSolid = (data: MeshData, label: string) => {
      const collider = G.world.createCollider(G.R.ColliderDesc.trimesh(data.positions, data.indices, G.R.TriMeshFlags.FIX_INTERNAL_EDGES)
        .setCollisionGroups(GROUPS_STATIC).setFriction(.92), body);
      this.surfaces.set(collider.handle, label);
      return collider.handle;
    };
    const addMesh = (data: MeshData, material: THREE.Material, label: string, solid = true) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
      if (material === rock) {
        const exposure = data.exposure ?? new Float32Array(data.positions.length / 3).fill(1);
        geometry.setAttribute('exposure', new THREE.BufferAttribute(exposure, 1));
      }
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = label;
      mesh.receiveShadow = mesh.castShadow = true;
      group.add(mesh);
      if (solid) return addSolid(data, label);
    };

    this.groundHandles.add(addMesh(terrain.rock, rock, 'Скалы')!);
    this.snowHandle = addMesh(terrain.snow, snow, 'Заснеженная терраса')!;
    this.groundHandles.add(this.snowHandle);
    const passages = buildMountainPassages(terrain.passageAnchors, terrain.seed);
    for (const surface of passages.surfaces) {
      if (surface.name === 'rope') addMesh(surface, cable, 'Канат', false);
      else if (surface.name === 'rope-anchor') addMesh(surface, anchor, 'Крепление каната', false);
      else {
        const handle = addMesh(surface, cave, 'Горный проход')!;
        if (surface.name === 'passage-floor') this.groundHandles.add(handle);
      }
    }
    this.rope = createMountainRope(position(passages.rope.lower), position(passages.rope.upper));
    const bridge = buildMountainBridge(terrain);
    if (bridge) {
      group.add(bridge.group);
      this.bridgeHandle = addSolid(bridge.collider, 'Подвесной мост');
    }

    const { denBack, denMouth, throughLower, throughUpper, throughSkylightStartZ, halfWidth, height } = terrain.passageAnchors;
    const addShelter = (name: string, x: number, z: number, floor: number, hz: number, enclosed: boolean) => {
      const pos = position({ x, y: floor, z });
      const hx = halfWidth * .8;
      G.snowCover.add({ name, kind: 'roof', x: pos.x, z: pos.z, y: pos.y + height, hx, hz });
      G.structures.shelters.push({ cx: pos.x, cz: pos.z, yaw: 0, hx, hz, y0: pos.y - .2, y1: pos.y + height,
        shelter: { kind: 'grotto', name, wind: enclosed ? .12 : .35, warm: enclosed ? 2 : 1, enclosed, pos } });
    };
    addShelter('Скальное укрытие', denMouth.x, (denMouth.z + denBack.z) / 2, denMouth.y, (denMouth.z - denBack.z) / 2, true);
    // The upper half of the through passage opens to the sky. Roof only the enclosed sections.
    for (let z = throughSkylightStartZ; z < throughLower.z; z += 2) {
      const middle = z + 1;
      const rise = (throughLower.z - middle) / (throughLower.z - throughUpper.z - .5);
      addShelter('Горный проход', throughLower.x, middle, throughLower.y + (throughUpper.y - throughLower.y) * rise, 1, false);
    }
  }

  /** Find the surface at the player's level: the den may be directly under a plateau. */
  floorAt(x: number, y: number, z: number) {
    const ray = new G.R.Ray({ x, y: y + 1, z }, { x: 0, y: -1, z: 0 });
    const hit = G.world.castRay(ray, 2, true, undefined, undefined, undefined, undefined,
      collider => this.groundHandles.has(collider.handle));
    return hit ? y + 1 - hit.timeOfImpact : y;
  }

  get onRope() { return this.ropeState.attached; }

  canReachRope(feet: Point) {
    return Math.abs(feet.x - this.rope.lower.x) <= 1.45 && nearRope(this.rope, feet);
  }

  toggleRope(feet: Point) {
    this.ropeState = stepMountainRope(this.rope, this.ropeState, feet, { interact: true, climb: 0 }, 0).state;
  }

  climb(feet: Point, direction: number, dt: number) {
    if (!this.onRope) return null;
    const result = stepMountainRope(this.rope, this.ropeState, feet, { interact: false, climb: direction }, dt);
    this.ropeState = result.state;
    return result.attached ? result.displacement : null;
  }
}
