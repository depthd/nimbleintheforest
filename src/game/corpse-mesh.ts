// A resting human silhouette, using the same small procedural shapes as the player.
// Clothing changes with the actual items left on the body; no duplicated visual loot.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Tex } from '../core/textures';
import type { Entity } from './entities';
import type { Slot } from './items';

const sphere = new THREE.SphereGeometry(1, 12, 8);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
const box = new THREE.BoxGeometry(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const materials = new Map<string, THREE.MeshStandardMaterial>();
const PALETTE: Record<string, string> = {
  thermals: '#aaa69b', sweater: '#77715d', fleece: '#546975', jacket_light: '#817358',
  parka: '#6b7354', telogreika: '#676756', tulup: '#84715a', jeans: '#4b5968',
  padded_pants: '#636553', wool_pants: '#5d5e61', beanie: '#6c6258', ushanka: '#51483d',
  balaclava: '#555b58', scarf: '#8e8068', wool_socks: '#a5a292', boots: '#3d352e',
  valenki: '#8c8676', sneakers: '#626f77', unty: '#84705a', gloves: '#69604f',
  mittens: '#797362', fur_mitts: '#8b7c66', backpack: '#656c4c', backpack_big: '#715e44',
};

function fabric(id: string) {
  const key = 'fabric:' + id;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({
    map: Tex.fabric(PALETTE[id] ?? '#88877c'), roughness: 0.97,
  }));
  return materials.get(key)!;
}

function solid(color: string) {
  if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.94 }));
  return materials.get(color)!;
}

interface Sleeve { mesh: THREE.Mesh; length: number }
interface ClothingView {
  torso: THREE.Mesh;
  hips: THREE.Mesh;
  sleeves: Sleeve[];
  legs: Sleeve[];
  knees: THREE.Mesh[];
  coatDetail: THREE.Group;
  hat: THREE.Mesh;
  hatBrim: THREE.Mesh;
  earFlaps: THREE.Group;
  balaclava: THREE.Mesh;
  scarf: THREE.Group;
  hands: THREE.Mesh[];
  gloves: THREE.Mesh[];
  feet: THREE.Mesh[];
  shoes: THREE.Group[];
  soles: THREE.Mesh[];
  pack: THREE.Group;
  packBody: THREE.Mesh;
  straps: THREE.Group;
}

/** Ground origin; head points toward -z, feet toward +z, face toward +y. */
export function buildCorpseMesh(worn: ReadonlyMap<Slot, Entity>, variant: number): THREE.Group {
  const root = new THREE.Group();
  root.name = 'human-corpse';
  const skin = solid(variant % 3 === 0 ? '#a99a8d' : variant % 3 === 1 ? '#b4a497' : '#9e8e80');
  const trim = solid('#383b35');
  const hair = solid(variant % 2 ? '#51493f' : '#72685d');
  const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
    scale: number[], position: number[], name = '') => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.fromArray(scale);
    m.position.fromArray(position);
    m.name = name;
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const limb = (a: number[], b: number[], radius: number, material: THREE.Material): Sleeve => {
    const start = new THREE.Vector3().fromArray(a), end = new THREE.Vector3().fromArray(b);
    const length = start.distanceTo(end);
    const m = mesh(root, cylinder, material, [radius, length, radius], start.clone().add(end).multiplyScalar(0.5).toArray());
    m.quaternion.setFromUnitVectors(UP, end.sub(start).normalize());
    return { mesh: m, length };
  };

  const torso = mesh(root, sphere, fabric('thermals'), [0.226, 0.147, 0.285], [0, 0.185, -0.25], 'corpse-torso');
  const hips = mesh(root, sphere, fabric('thermals'), [0.19, 0.122, 0.135], [0, 0.143, 0.035]);
  limb([0, 0.17, -0.48], [0, 0.17, -0.61], 0.064, skin);

  const head = new THREE.Group();
  head.position.set(0.014, 0.172, -0.725);
  head.rotation.z = variant % 2 ? 0.18 : -0.16;
  root.add(head);
  mesh(head, sphere, skin, [0.106, 0.112, 0.137], [0, 0, 0]);
  mesh(head, sphere, hair, [0.107, 0.083, 0.105], [0, -0.027, -0.048]);
  for (const sign of [-1, 1]) {
    mesh(head, sphere, skin, [0.022, 0.03, 0.036], [sign * 0.101, -0.005, 0.007]);
    // Closed eyes and a small nose keep the face readable without a detailed asset.
    const eye = mesh(head, box, solid('#635e58'), [0.031, 0.004, 0.006], [sign * 0.038, 0.104, -0.029]);
    eye.rotation.y = sign * 0.08;
  }
  mesh(head, sphere, skin, [0.018, 0.032, 0.029], [0, 0.111, 0.012]);
  mesh(head, box, solid('#847367'), [0.038, 0.005, 0.006], [0, 0.101, 0.062]);

  const hat = mesh(head, sphere, fabric('beanie'), [0.117, 0.113, 0.089], [0, 0, -0.081], 'corpse-hat');
  const hatBrim = mesh(head, box, fabric('beanie'), [0.221, 0.065, 0.044], [0, 0.065, -0.07]);
  const earFlaps = new THREE.Group(); head.add(earFlaps);
  for (const sign of [-1, 1]) mesh(earFlaps, sphere, fabric('ushanka'), [0.035, 0.057, 0.075], [sign * 0.104, -0.008, 0.016]);
  const balaclava = mesh(head, sphere, fabric('balaclava'), [0.113, 0.085, 0.144], [0, -0.035, 0.002]);

  const scarf = new THREE.Group(); root.add(scarf);
  mesh(scarf, sphere, fabric('scarf'), [0.128, 0.102, 0.063], [0, 0.181, -0.545]);
  const scarfEnd = mesh(scarf, box, fabric('scarf'), [0.076, 0.025, 0.225], [-0.055, 0.327, -0.39]);
  scarfEnd.rotation.y = -0.2;

  const coatDetail = new THREE.Group(); root.add(coatDetail);
  mesh(coatDetail, box, trim, [0.012, 0.014, 0.414], [0, 0.337, -0.26]);
  for (const sign of [-1, 1]) {
    mesh(coatDetail, box, fabric('parka'), [0.095, 0.026, 0.118], [sign * 0.125, 0.321, -0.17]);
    mesh(coatDetail, box, trim, [0.09, 0.012, 0.014], [sign * 0.125, 0.341, -0.219]);
  }

  const sleeves: Sleeve[] = [], legs: Sleeve[] = [], knees: THREE.Mesh[] = [];
  const hands: THREE.Mesh[] = [], gloves: THREE.Mesh[] = [], feet: THREE.Mesh[] = [];
  const shoes: THREE.Group[] = [], soles: THREE.Mesh[] = [];
  for (const sign of [-1, 1]) {
    const shoulder = [sign * 0.214, 0.172, -0.43];
    const elbow = [sign * (sign < 0 ? 0.345 : 0.33), 0.116, -0.16];
    const wrist = [sign * (sign < 0 ? 0.4 : 0.275), 0.103, 0.095];
    sleeves.push(limb(shoulder, elbow, 0.083, fabric('thermals')), limb(elbow, wrist, 0.069, fabric('thermals')));
    const handPos = [wrist[0] + sign * 0.009, 0.098, 0.167];
    hands.push(mesh(root, sphere, skin, [0.054, 0.044, 0.085], handPos));
    gloves.push(mesh(root, sphere, fabric('gloves'), [0.06, 0.048, 0.093], handPos, 'corpse-glove'));

    const hip = [sign * 0.105, 0.15, 0.04];
    const knee = [sign * (sign < 0 ? 0.16 : 0.12), 0.131, 0.425];
    const ankle = [sign * (sign < 0 ? 0.205 : 0.145), 0.104, 0.79];
    legs.push(limb(hip, knee, 0.095, fabric('thermals')), limb(knee, ankle, 0.074, fabric('thermals')));
    knees.push(mesh(root, sphere, fabric('thermals'), [0.09, 0.091, 0.09], knee));
    feet.push(mesh(root, sphere, fabric('thermals'), [0.067, 0.106, 0.107], [ankle[0], 0.128, 0.845]));
    const shoe = new THREE.Group();
    shoe.name = 'corpse-shoe';
    shoe.position.set(ankle[0], 0.0, 0.84);
    shoe.rotation.z = sign * 0.17;
    root.add(shoe);
    mesh(shoe, sphere, fabric('boots'), [0.079, 0.131, 0.113], [0, 0.147, 0.015]);
    mesh(shoe, cylinder, fabric('boots'), [0.079, 0.16, 0.079], [0, 0.105, -0.055]).rotation.x = Math.PI / 2;
    soles.push(mesh(shoe, box, solid('#272b2a'), [0.15, 0.24, 0.035], [0, 0.149, 0.12]));
    shoes.push(shoe);
  }

  const pack = new THREE.Group();
  pack.name = 'corpse-backpack';
  pack.position.set(0.4, 0.11, -0.31);
  pack.rotation.y = -0.22;
  root.add(pack);
  const packBody = mesh(pack, sphere, fabric('backpack'), [0.135, 0.105, 0.22], [0, 0.01, 0]);
  mesh(pack, box, trim, [0.035, 0.014, 0.35], [-0.06, 0.11, 0]);
  mesh(pack, box, trim, [0.035, 0.014, 0.35], [0.06, 0.11, 0]);
  const straps = new THREE.Group(); root.add(straps);
  for (const sign of [-1, 1]) mesh(straps, box, trim, [0.031, 0.013, 0.3], [sign * 0.171, 0.324, -0.33]);

  root.userData.corpseClothing = { torso, hips, sleeves, legs, knees, coatDetail,
    hat, hatBrim, earFlaps, balaclava, scarf, hands, gloves, feet, shoes, soles,
    pack, packBody, straps } satisfies ClothingView;
  // Keep editable clothing parts outside the scene. A corpse has no moving
  // joints: only the small set of material batches below needs rendering.
  const source = new THREE.Group();
  source.name = 'corpse-clothing-source';
  source.add(...root.children.slice());
  root.userData.corpseSource = source;
  updateCorpseClothing(root, worn);
  return root;
}

export function updateCorpseClothing(root: THREE.Group, worn: ReadonlyMap<Slot, Entity>): void {
  const v = root.userData.corpseClothing as ClothingView | undefined;
  if (!v) return;
  const outer = worn.get('outer')?.defId;
  const upper = outer ?? worn.get('mid')?.defId ?? worn.get('base')?.defId ?? 'thermals';
  const pants = worn.get('legs')?.defId ?? 'thermals';
  const bulk = outer === 'tulup' ? 1.1 : outer === 'parka' ? 1.06 : outer ? 1 : 0.88;
  v.torso.material = fabric(upper);
  v.torso.scale.set(0.226 * bulk, 0.147 * bulk, 0.285);
  v.torso.userData.wornItem = worn.get('outer')?.id ?? worn.get('mid')?.id ?? worn.get('base')?.id ?? null;
  for (const [i, s] of v.sleeves.entries()) {
    s.mesh.material = fabric(upper);
    const radius = (i % 2 ? 0.069 : 0.083) * bulk;
    s.mesh.scale.set(radius, s.length, radius);
  }
  v.coatDetail.visible = !!outer;
  for (const child of v.coatDetail.children) if (child instanceof THREE.Mesh && child.material !== solid('#383b35')) child.material = fabric(upper);
  v.hips.material = fabric(pants);
  for (const leg of v.legs) leg.mesh.material = fabric(pants);
  for (const knee of v.knees) knee.material = fabric(pants);

  const head = worn.get('head')?.defId;
  v.hat.visible = v.hatBrim.visible = !!head && head !== 'balaclava';
  if (head) v.hat.material = v.hatBrim.material = fabric(head);
  v.earFlaps.visible = head === 'ushanka';
  v.balaclava.visible = head === 'balaclava';
  v.scarf.visible = worn.has('neck');
  const hand = worn.get('hands')?.defId;
  v.hands.forEach(m => { m.visible = !hand; });
  v.gloves.forEach(m => { m.visible = !!hand; if (hand) m.material = fabric(hand); });
  const foot = worn.get('feet')?.defId;
  v.feet.forEach(m => { m.visible = !foot; m.material = fabric(worn.get('socks')?.defId ?? 'thermals'); });
  v.shoes.forEach(shoe => {
    shoe.visible = !!foot;
    shoe.children.forEach(m => { if (m instanceof THREE.Mesh && !v.soles.includes(m) && foot) m.material = fabric(foot); });
    shoe.scale.y = foot === 'sneakers' ? 0.79 : 1;
  });
  v.soles.forEach(sole => { sole.visible = foot !== 'valenki' && foot !== 'unty'; });
  const back = worn.get('back')?.defId;
  v.pack.visible = v.straps.visible = !!back;
  if (back) v.packBody.material = fabric(back);
  bakeCorpse(root);
}

/** Rebuild only when clothing changes, preserving the exact visible pose and UVs. */
function bakeCorpse(root: THREE.Group) {
  const source = root.userData.corpseSource as THREE.Group;
  source.updateMatrixWorld(true);
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  source.traverseVisible(o => {
    if (!(o instanceof THREE.Mesh)) return;
    const material = o.material as THREE.Material;
    let parts = byMaterial.get(material);
    if (!parts) { parts = []; byMaterial.set(material, parts); }
    // The detached source is in root-local coordinates, so root placement and
    // rotation remain independent of this bake, including subsequent looting.
    parts.push(o.geometry.clone().applyMatrix4(o.matrixWorld));
  });
  const batches: THREE.Mesh[] = [];
  for (const [material, parts] of byMaterial) {
    const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts)!;
    if (parts.length > 1) for (const part of parts) part.dispose();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'corpse-material-batch';
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    batches.push(mesh);
  }
  // Only these baked geometries are owned here. Primitive shapes and materials
  // belong to all corpses and must survive a garment being taken from one body.
  for (const previous of root.children.slice()) {
    root.remove(previous);
    if (previous instanceof THREE.Mesh) previous.geometry.dispose();
  }
  root.add(...batches);
}
