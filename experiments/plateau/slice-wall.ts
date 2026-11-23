import * as THREE from 'three';
import { buildAngularWall } from './slice-wall-angular';
import { buildRoundedWall, type RoundedWallSite } from './slice-wall-rounded';

export type WallFamily = 'original' | 'rounded' | 'angular';
export const wallCounts = { rounded: [4, 7, 10] as const, angular: [5, 8, 12] as const };
export function wallParameters(params: URLSearchParams) {
  const value = params.get('wall');
  const family: WallFamily = value === 'rounded' || value === 'angular' ? value : 'original';
  const p = Number(params.get('preset') ?? 1);
  const rawSeed = Number(params.get('seed') ?? 42);
  return { family, preset: [0, 1, 2].includes(p) ? p : 1, seed: Number.isSafeInteger(rawSeed) ? rawSeed : 42 };
}

export function makeWallGroup(site: RoundedWallSite, family: Exclude<WallFamily,'original'>, preset: number, seed: number, rockMaterial: THREE.Material, snowMaterial: THREE.Material) {
  const data = family === 'rounded'
    ? buildRoundedWall(site, wallCounts.rounded[preset], seed)
    : buildAngularWall(site, wallCounts.angular[preset], seed);
  const group = new THREE.Group();
  for (const [kind, material] of [['rock',rockMaterial], ['snow',snowMaterial]] as const) {
    const raw = data[kind];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(raw.positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(raw.colors, 3));
    g.setIndex(new THREE.BufferAttribute(raw.indices, 1));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'slice-wall-' + kind;
    if (kind==='snow' && 'snowWallIndexCount' in data) mesh.userData.snowWallIndexCount=data.snowWallIndexCount;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.count = data.masses.length;
  return group;
}

// Render semantic IDs with depth testing, including all foreground occluders.
export function measureWallSnow(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
  const oldBg = scene.background;
  const oldFog = scene.fog;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y);
  const originalTarget = renderer.getRenderTarget();
  const materials = [0x000000,0xff0000,0x00ff00,0x0000ff].map(color => new THREE.MeshBasicMaterial({color, toneMapped:false,side:THREE.DoubleSide}));
  const oldMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const snowMeshes:THREE.Mesh[]=[];
  const pixels = new Uint8Array(size.x * size.y * 4);
  try {
    scene.background = new THREE.Color(0);
    scene.fog = null;
    scene.traverse(o => {
      if (o instanceof THREE.Mesh) {
        oldMaterials.set(o, o.material);
        o.material = materials[o.name === 'slice-wall-rock' ? 1 : o.name === 'slice-wall-snow' ? 2 : 0];
        if(o.name==='slice-wall-snow' && Number.isInteger(o.userData.snowWallIndexCount)){
          const g=o.geometry;
          g.addGroup(0,o.userData.snowWallIndexCount,0);
          g.addGroup(o.userData.snowWallIndexCount,g.index!.count-o.userData.snowWallIndexCount,1);
          o.material=[materials[2],materials[3]];
          snowMeshes.push(o);
        }
      }
    });
    renderer.setRenderTarget(target);
    renderer.render(scene,camera);
    renderer.readRenderTargetPixels(target,0,0,size.x,size.y,pixels);
  } finally {
    renderer.setRenderTarget(originalTarget);
    oldMaterials.forEach((v,k)=>{k.material=v;});
    snowMeshes.forEach(m=>m.geometry.clearGroups());
    scene.background=oldBg; scene.fog=oldFog; target.dispose(); materials.forEach(m=>m.dispose());
  }
  let rock=0,snow=0,base=0;
  for(let i=0;i<pixels.length;i+=4){if(pixels[i]>127)rock++;if(pixels[i+1]>127)snow++;if(pixels[i+2]>127)base++;}
  return {rockPixels:rock,snowPixels:snow,bankPixels:base,wholePercent:(snow+base)*100/(snow+base+rock),percent:snow+rock?100*snow/(snow+rock):null};
}
