import { Box3, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Rng } from '../../src/core/rng';
import { plateauRadius } from './plateau-profile';
import { distanceToAscent } from './mountain-snow';

export interface GroveSite {
  seed: number;
  density: number;
  heightFactor: number;
  outcrops: { x: number; z: number; radius: number }[];
  rootAt: (x: number, z: number, outside: boolean) => { x: number; y: number; z: number } | undefined;
}

export async function buildMountainGroves(sites: GroveSite[]) {
  const tree = (
    await new GLTFLoader().loadAsync(new URL('../../models/conifer_c1.glb', document.baseURI).href)
  ).scene;
  tree.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(tree),
    modelHeight = bounds.max.y - bounds.min.y;
  const poses: Matrix4[] = [],
    transform = new Object3D();
  // The crest shelters small groves. The middle of the plateau and the pass are open.
  const groves = [
    [-169, 58, 7],
    [-99, 125, 9],
    [29, 114, 7],
    [156, 61, 10],
    [207, -4, 6],
    [111, -93, 9],
    [13, -127, 8],
    [-115, -103, 5],
    [-204, 7, 4],
    [75, 20, 3],
    [-261, -170, 4],
    [-281, 91, 5],
    [145, -220, 6],
    [256, 126, 4],
    [-346, 43, 4],
    [-374, -144, 3],
  ];
  const trunks: { x:number; y:number; z:number; height:number; radius:number }[] = [];
  const counts: number[] = [];
  for (const site of sites) {
    const rng = new Rng(site.seed),
      start = poses.length;
    const roots: { x: number; z: number }[] = [];
    for (const [gx, gz, originalCount] of groves) {
      const count = Math.max(1, Math.round(originalCount * site.density));
      for (let i = 0, planted = 0; i < count * 2 && planted < count; i++) {
        const x = gx + rng.float(-27, 27),
          z = gz + rng.float(-23, 23),
          r = plateauRadius(x, z);
        if ((r > 0.91 && r < 1.32) || distanceToAscent({ x, z }) < 7) continue;
        if (roots.some((p) => Math.hypot(x - p.x, z - p.z) < 7)) continue;
        if (site.outcrops.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius + 1)) continue;
        const root = site.rootAt(x, z, r > 1);
        if (!root) continue;
        const height = site.heightFactor * rng.float(8, 24) * (r > 1 ? 1.18 : 1),
          scale = height / modelHeight;
        transform.position.set(root.x, root.y - 0.23 - bounds.min.y * scale, root.z);
        transform.rotation.set(rng.float(-0.035, 0.035), rng.float(0, Math.PI * 2), rng.float(-0.04, 0.04));
        transform.scale.setScalar(scale);
        transform.updateMatrix();
        poses.push(transform.matrix.clone());
        trunks.push({...root, height, radius:height*.04});
        roots.push({ x, z });
        planted++;
      }
    }
    counts.push(poses.length - start);
  }
  const group = new Group(),
    matrix = new Matrix4();
  tree.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    let material = node.material;
    if (node.name.includes('Crown') && material instanceof MeshStandardMaterial) {
      const needles = material.clone();
      needles.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying float vBranchSlope;')
          .replace(
            '#include <beginnormal_vertex>',
            '#include <beginnormal_vertex>\nvBranchSlope = normal.y;',
          );
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vBranchSlope;')
          .replace(
            '#include <map_fragment>',
            '#include <map_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.74,.81,.9),smoothstep(.38,.87,vBranchSlope)*.72);',
          );
      };
      material = needles;
    }
    const instances = new InstancedMesh(node.geometry, material, poses.length);
    poses.forEach((pose, i) => instances.setMatrixAt(i, matrix.multiplyMatrices(pose, node.matrixWorld)));
    instances.castShadow = instances.receiveShadow = true;
    instances.computeBoundingSphere();
    group.add(instances);
  });
  group.userData.trunks = trunks;
  group.userData.count = poses.length;
  group.userData.tierCounts = counts;
  return group;
}
