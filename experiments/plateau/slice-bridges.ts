import * as THREE from 'three';
import { Tex } from '../../src/core/textures';
import { Rng, hashString } from '../../src/core/rng';
import type { Point, MeshData } from './cavity';

type Anchor = Point & { mountainId: string; tierId: string; accessible: boolean };
type Tree = Point & { radius: number; height: number };
interface Terrain {
  seed: number;
  bridgeAnchors: readonly Anchor[];
  trees: readonly Tree[];
  sampleHeight(x: number, z: number): number;
}

const WIDTH = 2.4;
const LANDING = 1;
const THICKNESS = 0.12;
// Measured in the T slice: 30 m of air and a metre of bearing at either end.
const SLICE_SPAN = 32;

function planPair(terrain: Terrain, from: Anchor, to: Anchor) {
  if (!from.accessible || !to.accessible || from.mountainId === to.mountainId) return null;
  const dx = to.x - from.x, dz = to.z - from.z;
  const span = Math.hypot(dx, dz);
  if (span <= 2 * LANDING || span > SLICE_SPAN + 1e-5) return null;
  const forwardX = dx / span, forwardZ = dz / span;
  const openSpan = span - LANDING * 2, sag = openSpan / 17;
  function point(along: number, side = 0, lift = 0): Point {
    const t = Math.max(0, Math.min(1, (along - LANDING) / openSpan));
    return {
      x: from.x + forwardX * along - forwardZ * side,
      z: from.z + forwardZ * along + forwardX * side,
      y: from.y + (to.y - from.y) * t + THICKNESS - 4 * sag * t * (1 - t) + lift,
    };
  }

  const count = Math.ceil(span / .30);
  const sections = [0, ...Array.from({length:count + 1}, (_, i) => LANDING + openSpan * i / count), span];
  const route = sections.map(d => point(d));
  for (let i = 0; i < sections.length; i++) {
    const along = sections[i];
    const onBank = along <= LANDING || along >= span - LANDING;
    for (const side of [-WIDTH/2, -WIDTH/4, 0, WIDTH/4, WIDTH/2]) {
      const p = point(along, side);
      const ground = terrain.sampleHeight(p.x, p.z), gap = p.y - THICKNESS - ground;
      if (!Number.isFinite(ground) || gap < -.001 || (onBank && gap > .15)) return null;
    }
    if (i > 0 && Math.abs(route[i].y - route[i-1].y) > Math.tan(Math.PI * 48/180) * (along - sections[i-1])) return null;
  }
  const center = point(span/2);
  const dropAtCenter = center.y - THICKNESS - terrain.sampleHeight(center.x, center.z);
  if (!(dropAtCenter > 1.8)) return null;
  for (const tree of terrain.trees) {
    const along = Math.max(0, Math.min(span, (tree.x-from.x)*forwardX + (tree.z-from.z)*forwardZ));
    const p = point(along);
    // The renderer's outermost crown has radius 0.24 × height. Enclose the
    // whole tree and the anchor posts, not merely the centre line of the deck.
    const reach = Math.max(tree.radius, .24 * tree.height) + WIDTH/2 + .16;
    if (Math.hypot(tree.x-p.x, tree.z-p.z) <= reach && tree.y+tree.height >= p.y-THICKNESS && tree.y <= p.y+2) return null;
  }

  const positions: number[] = [], indices: number[] = [];
  for (const d of sections) {
    for (const side of [-WIDTH/2, WIDTH/2]) {
      const p = point(d, side);
      positions.push(p.x,p.y,p.z);
    }
    const last = positions.length/3-2;
    if (last) indices.push(last-2,last-1,last+1, last-2,last+1,last);
  }
  const collider: MeshData = {positions:Float32Array.from(positions), indices:Uint32Array.from(indices)};
  return {from,to,span,width:WIDTH,sag,dropAtCenter,point,sections,route,collider};
}

// Pick the shortest viable crossing after the terrain, trees and accessible
// landing metadata are known. Equal distances retain the generator's order.
export function planSliceBridge(terrain: Terrain) {
  let shortest: ReturnType<typeof planPair> = null;
  for (let a=0; a<terrain.bridgeAnchors.length; a++) {
    for (let b=a+1; b<terrain.bridgeAnchors.length; b++) {
      const left = terrain.bridgeAnchors[a], right = terrain.bridgeAnchors[b];
      const length = Math.hypot(right.x-left.x, right.z-left.z);
      if (!length || length > SLICE_SPAN + 1e-5) continue;
      const nx = -(right.z-left.z)/length, nz = (right.x-left.x)/length;
      const rng = new Rng(terrain.seed ^ hashString(left.tierId+'|'+right.tierId));
      // Try a reproducible offset in the reserved 8 m corridor. If a tree or a
      // rock blocks it, retry the centre and both sides before dropping the link.
      for (const offset of [rng.float(-1.2,1.2),0,-1.2,1.2]) {
        const shift = (anchor: Anchor) => ({...anchor,x:anchor.x+nx*offset,z:anchor.z+nz*offset});
        const candidate = planPair(terrain,shift(left),shift(right));
        if (!candidate) continue;
        if (!shortest || candidate.span < shortest.span) shortest = candidate;
        break;
      }
    }
  }
  return shortest;
}

export function buildSliceBridges(terrain: Terrain) {
  const plan = planSliceBridge(terrain);
  if (!plan) return null;
  const {point,span,sections} = plan;
  const group = new THREE.Group();
  group.name = 'suspension-bridge';
  const wood = new THREE.MeshStandardMaterial({map: Tex.planks(), color:0x94806c, roughness:1,flatShading:true});
  const rope = new THREE.MeshStandardMaterial({color:0x514736,roughness:1,flatShading:true});
  const pos: THREE.Vector3 = new THREE.Vector3();
  const scale: THREE.Vector3 = new THREE.Vector3();
  const local: THREE.Object3D = new THREE.Object3D();
  const across = new THREE.Vector3(-(plan.to.z-plan.from.z)/span,0,(plan.to.x-plan.from.x)/span);
  const top = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const orientation = new THREE.Matrix4();

  // Axis x is along each transverse plank, z is uphill along the path.
  const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),wood,sections.length-1);
  planks.name = 'transverse-planks';
  for (let i=1; i<sections.length; i++) {
    const a=point(sections[i-1]), b=point(sections[i]);
    forward.set(b.x-a.x,b.y-a.y,b.z-a.z);
    const length=forward.length();
    forward.normalize();
    top.crossVectors(forward,across).negate().normalize();
    orientation.makeBasis(across,top,forward.clone().negate());
    local.quaternion.setFromRotationMatrix(orientation);
    local.position.set((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2).addScaledVector(top,-THICKNESS/2);
    local.scale.set(WIDTH,THICKNESS,length-.009);
    local.updateMatrix();
    planks.setMatrixAt(i-1,local.matrix);
  }
  planks.receiveShadow = true;
  planks.castShadow = true;
  group.add(planks);

  const up = new THREE.Vector3(0,1,0);
  const members: THREE.Matrix4[] = [], cables: THREE.Matrix4[] = [];
  function bar(a: Point, b: Point, radius: number, target: THREE.Matrix4[]) {
    const axis = new THREE.Vector3(b.x-a.x,b.y-a.y,b.z-a.z);
    const len = axis.length();
    const rotation = new THREE.Quaternion().setFromUnitVectors(up,axis.normalize());
    pos.set((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);
    scale.set(radius,len,radius);
    target.push(new THREE.Matrix4().compose(pos,rotation,scale));
  }
  const cableSections = Math.ceil((span-2*LANDING)/1.2);
  for (const side of [-WIDTH/2,WIDTH/2]) {
    for (const d of [.4,span-.4]) bar(point(d,side,-.30),point(d,side,1.8),.13,members);
    let previousTop=point(.4,side,1.65), previousBottom=point(.4,side,-.10);
    for (let i=0;i<=cableSections;i++) {
      const t=i/cableSections, d=LANDING+t*(span-2*LANDING);
      const high=point(d,side,1.65-2*t*(1-t)), low=point(d,side,-.10);
      bar(previousTop,high,.044,cables);
      bar(previousBottom,low,.052,cables);
      bar(low,high,.027,cables);
      previousTop=high;previousBottom=low;
    }
    bar(previousTop,point(span-.4,side,1.65),.044,cables);
    bar(previousBottom,point(span-.4,side,-.10),.052,cables);
  }
  function addMembers(matrices: THREE.Matrix4[], material: THREE.Material, name: string) {
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1,1,1,5,1),material,matrices.length);
    mesh.name=name;
    matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));
    mesh.receiveShadow=true;
    mesh.castShadow=true;
    group.add(mesh);
  }
  addMembers(members,wood,'bank-anchors');
  addMembers(cables,rope,'suspension-cables-and-hangers');
  return {...plan,group};
}
