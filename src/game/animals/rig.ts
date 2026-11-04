// Turns a static low-poly animal (separate meshes for body, legs, head, tail) into a rig
// with joints, and animates it procedurally: walk, trot, gallop, idle, sniff, alert,
// mousing pounce, lying down and dead. No skeleton or baked animation is needed.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type Pose = 'move' | 'idle' | 'sniff' | 'alert' | 'pounce' | 'lie' | 'dead' | 'eat' | 'struggle';

export interface Palette {
  body: number;
  cream: number;
  dark: number;
  eye: number;
}

export const PALETTES: Record<string, Palette> = {
  red: { body: 0xb4562a, cream: 0xeadfcf, dark: 0x2a201c, eye: 0x111111 },
  silver: { body: 0x3c3f46, cream: 0xa7adb5, dark: 0x16181b, eye: 0x101010 },
  arctic: { body: 0xe9edf0, cream: 0xffffff, dark: 0x3a3a3c, eye: 0x111111 },
};

interface PartGeo {
  name: string;
  geo: THREE.BufferGeometry;
  role: keyof Palette | 'own';
  color: number;
  box: THREE.Box3;
}

interface LegDef {
  front: boolean;
  left: boolean;
  chain: { geo: PartGeo[]; pivot: THREE.Vector3 }[];
}

export interface Template {
  name: string;
  parts: PartGeo[];
  body: PartGeo[];
  head: PartGeo[];
  headPivot: THREE.Vector3;
  ears: { geo: PartGeo[]; pivot: THREE.Vector3 }[];
  tail: { geo: PartGeo[]; pivot: THREE.Vector3 }[];
  legs: LegDef[];
  height: number; // shoulder height after scaling
  length: number;
}

const HEAD_RE = /head|skull|snout|muzzle|nose|eye|ear|jaw|cheek|mouth|pupil/i;
const LEG_RE = /leg|paw|upper|lower/i;

function roleOf(name: string, matName: string): keyof Palette | 'own' {
  const m = matName.toLowerCase();
  if (m.includes('fur_body')) return 'body';
  if (m.includes('fur_cream')) return 'cream';
  if (m.includes('fur_dark')) return 'dark';
  if (m === 'eye') return 'eye';
  const n = name.toLowerCase();
  if (/eye|pupil/.test(n)) return 'eye';
  if (/paw|nose|mouth|inner/.test(n)) return 'dark';
  if (/bib|cream|cheek|belly/.test(n)) return 'cream';
  return 'body';
}

/** Load a GLB and work out its anatomy. `shoulder` is the real shoulder height in metres. */
export async function loadTemplate(url: string, name: string, shoulder: number): Promise<Template> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const raw: { name: string; geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }[] = [];
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    raw.push({ name: m.name || m.parent?.name || '', geo: g, mat: m.material as THREE.MeshStandardMaterial });
  });
  const boxOf = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    return g.boundingBox!.clone();
  };
  // which way does it face? head centre vs body centre
  const all = new THREE.Box3();
  for (const r of raw) all.union(boxOf(r.geo));
  const headC = new THREE.Vector3(), bodyC = all.getCenter(new THREE.Vector3());
  let hn = 0;
  for (const r of raw) if (/head|skull/i.test(r.name)) {
    headC.add(boxOf(r.geo).getCenter(new THREE.Vector3()));
    hn++;
  }
  headC.divideScalar(Math.max(1, hn));
  const d = headC.sub(bodyC);
  // rotate so the animal faces +Z
  const rot = new THREE.Matrix4();
  if (Math.abs(d.x) > Math.abs(d.z)) rot.makeRotationY(d.x > 0 ? -Math.PI / 2 : Math.PI / 2);
  else if (d.z < 0) rot.makeRotationY(Math.PI);
  // scale to the real shoulder height, feet on y = 0
  let top = 0;
  for (const r of raw) {
    r.geo.applyMatrix4(rot);
    if (/torso|^body$|shoulder/i.test(r.name)) top = Math.max(top, boxOf(r.geo).max.y);
  }
  const all2 = new THREE.Box3();
  for (const r of raw) all2.union(boxOf(r.geo));
  if (top <= 0) top = all2.max.y * 0.7;
  const s = shoulder / (top - all2.min.y);
  const fix = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-all2.getCenter(new THREE.Vector3()).x, -all2.min.y, 0));
  const parts: PartGeo[] = raw.map((r) => {
    r.geo.applyMatrix4(fix);
    r.geo.computeVertexNormals();
    const role = roleOf(r.name, r.mat?.name ?? '');
    return { name: r.name, geo: r.geo, role, color: r.mat?.color?.getHex() ?? 0xffffff, box: boxOf(r.geo) };
  });
  const bodyTop = shoulder;
  const box = new THREE.Box3();
  for (const p of parts) box.union(p.box);
  const len = box.max.z - box.min.z;
  const cz = (box.max.z + box.min.z) / 2;
  const T: Template = { name, parts, body: [], head: [], headPivot: new THREE.Vector3(), ears: [], tail: [], legs: [], height: shoulder, length: len };
  const legParts: PartGeo[] = [];
  const tailParts: PartGeo[] = [];
  for (const p of parts) {
    const c = p.box.getCenter(new THREE.Vector3());
    if (/tail/i.test(p.name)) tailParts.push(p);
    else if (LEG_RE.test(p.name) || (p.box.max.y < bodyTop * 0.62 && !HEAD_RE.test(p.name))) legParts.push(p);
    else if (HEAD_RE.test(p.name) || (c.y > bodyTop * 1.05 && c.z > cz + len * 0.2)) T.head.push(p);
    else T.body.push(p);
  }
  // legs: group by quarter, chain from the top down
  const groups = new Map<string, PartGeo[]>();
  for (const p of legParts) {
    const c = p.box.getCenter(new THREE.Vector3());
    const k = `${c.z > cz ? 'f' : 'b'}${c.x > 0 ? 'l' : 'r'}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }
  for (const [k, list] of groups) {
    list.sort((a, b) => b.box.max.y - a.box.max.y);
    const chain = list.map((p) => {
      const c = p.box.getCenter(new THREE.Vector3());
      return { geo: [p], pivot: new THREE.Vector3(c.x, p.box.max.y - (p.box.max.y - p.box.min.y) * 0.08, c.z) };
    });
    // the top joint sits a little inside the body
    chain[0].pivot.y = Math.min(chain[0].pivot.y, bodyTop * 0.78);
    T.legs.push({ front: k[0] === 'f', left: k[1] === 'l', chain });
  }
  // head pivot: back and bottom of the head parts
  const hb = new THREE.Box3();
  for (const p of T.head) hb.union(p.box);
  T.headPivot.set(0, hb.min.y + (hb.max.y - hb.min.y) * 0.25, hb.min.z);
  // ears (and anything sitting inside an ear) twitch on their own
  const ears = T.head.filter((p) => /ear/i.test(p.name) && !/inner/i.test(p.name));
  for (const e of ears) {
    const inside = T.head.filter((p) => p !== e && !ears.includes(p) && e.box.containsPoint(p.box.getCenter(new THREE.Vector3())));
    T.ears.push({ geo: [e, ...inside], pivot: new THREE.Vector3((e.box.min.x + e.box.max.x) / 2, e.box.min.y, (e.box.min.z + e.box.max.z) / 2) });
    T.head = T.head.filter((p) => p !== e && !inside.includes(p));
  }
  // tail: from the base to the tip
  tailParts.sort((a, b) => b.box.max.z - a.box.max.z);
  for (const p of tailParts) {
    const c = p.box.getCenter(new THREE.Vector3());
    T.tail.push({ geo: [p], pivot: new THREE.Vector3(c.x, c.y, p.box.max.z - (p.box.max.z - p.box.min.z) * 0.1) });
  }
  return T;
}

const tmpV = new THREE.Vector3();

/** One animated animal instance built from a template. */
export class Rig {
  root = new THREE.Group();
  body = new THREE.Group();
  head = new THREE.Group();
  ears: THREE.Group[] = [];
  tail: THREE.Group[] = [];
  legs: { def: LegDef; joints: THREE.Group[] }[] = [];
  phase = Math.random() * 10;
  t = Math.random() * 100;
  private pounceT = -1;
  private earTwitch = [0, 0];
  private lookYaw = 0;
  private lookTarget = 0;
  private lookTimer = 0;
  /** blend of the lying-down pose, 0..1 */
  private lieK = 0;
  private deadK = 0;
  mats: THREE.MeshStandardMaterial[] = [];

  constructor(public T: Template, palette: Palette | null) {
    const matCache = new Map<string, THREE.MeshStandardMaterial>();
    const meshOf = (p: PartGeo, pivot: THREE.Vector3) => {
      const col = palette && p.role !== 'own' ? palette[p.role] : p.color;
      const key = `${col}`;
      let m = matCache.get(key);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color: col, roughness: p.role === 'eye' ? 0.3 : 0.92, flatShading: true });
        matCache.set(key, m);
        this.mats.push(m);
      }
      const me = new THREE.Mesh(p.geo, m);
      me.position.copy(pivot).negate();
      me.castShadow = true;
      return me;
    };
    const ZERO = new THREE.Vector3();
    this.root.add(this.body);
    for (const p of T.body) this.body.add(meshOf(p, ZERO));
    this.head.position.copy(T.headPivot);
    this.body.add(this.head);
    for (const p of T.head) this.head.add(meshOf(p, T.headPivot));
    for (const e of T.ears) {
      const g = new THREE.Group();
      g.position.copy(e.pivot).sub(T.headPivot);
      for (const p of e.geo) g.add(meshOf(p, e.pivot));
      this.head.add(g);
      this.ears.push(g);
    }
    let parent: THREE.Object3D = this.body;
    let prev = ZERO;
    for (const seg of T.tail) {
      const g = new THREE.Group();
      g.position.copy(seg.pivot).sub(prev);
      for (const p of seg.geo) g.add(meshOf(p, seg.pivot));
      parent.add(g);
      this.tail.push(g);
      parent = g;
      prev = seg.pivot;
    }
    for (const L of T.legs) {
      const joints: THREE.Group[] = [];
      let par: THREE.Object3D = this.body;
      let pv = ZERO;
      for (const seg of L.chain) {
        const g = new THREE.Group();
        g.position.copy(seg.pivot).sub(pv);
        for (const p of seg.geo) g.add(meshOf(p, seg.pivot));
        par.add(g);
        joints.push(g);
        par = g;
        pv = seg.pivot;
      }
      this.legs.push({ def: L, joints });
    }
  }

  /** start the mousing leap */
  pounce() {
    this.pounceT = 0;
  }

  get pouncing() {
    return this.pounceT >= 0;
  }

  /** true while airborne in a pounce: the owner moves the animal forward then */
  get leaping() {
    return this.pounceT >= 0.6 && this.pounceT < 1.2;
  }

  /** true while the snout is in the snow at the end of a pounce */
  get diving() {
    return this.pounceT >= 1.2 && this.pounceT < 2.2;
  }

  /**
   * Animate one frame. `speed` in m/s along the facing direction.
   * `look` is the head yaw towards something interesting (radians, relative), or null.
   */
  update(dt: number, speed: number, pose: Pose, look: number | null = null) {
    this.t += dt;
    const H = this.T.height;
    // gait by speed
    const gait = speed < 0.05 ? 'stand' : speed < 1.3 ? 'walk' : speed < 4 ? 'trot' : 'gallop';
    const stride = gait === 'walk' ? H * 1.2 : gait === 'trot' ? H * 2.2 : H * 4.2;
    if (gait !== 'stand') this.phase += (speed / stride) * Math.PI * 2 * dt;
    const P = this.phase;
    const offsets: Record<string, number> = gait === 'walk'
      ? { bl: 0, fl: 0.25, br: 0.5, fr: 0.75 }
      : gait === 'trot' ? { fl: 0, br: 0, fr: 0.5, bl: 0.5 } : { bl: 0, br: 0.12, fl: 0.5, fr: 0.62 };
    const amp = gait === 'walk' ? 0.32 : gait === 'trot' ? 0.5 : 0.85;
    const knee = gait === 'walk' ? 0.45 : gait === 'trot' ? 0.75 : 1.0;
    const lieTarget = pose === 'lie' ? 1 : 0;
    this.lieK += (lieTarget - this.lieK) * Math.min(1, dt * 2);
    this.deadK += ((pose === 'dead' ? 1 : 0) - this.deadK) * Math.min(1, dt * 3);
    const moving = gait !== 'stand' && pose === 'move';
    for (const L of this.legs) {
      const k = `${L.def.front ? 'f' : 'b'}${L.def.left ? 'l' : 'r'}`;
      const ph = P + offsets[k] * Math.PI * 2;
      const [up, lo, paw] = L.joints;
      let a = 0, b = 0;
      if (moving) {
        a = -amp * Math.sin(ph);
        b = knee * Math.max(0, Math.cos(ph)) * (L.def.front ? 1 : -1);
      }
      if (pose === 'struggle') {
        a = Math.sin(this.t * 14 + offsets[k] * 9) * 0.6;
        b = Math.sin(this.t * 11 + offsets[k] * 5) * 0.5;
      }
      // folded legs when lying down
      a = a * (1 - this.lieK) + this.lieK * (L.def.front ? -1.1 : 1.2);
      b = b * (1 - this.lieK) + this.lieK * (L.def.front ? 1.6 : -1.9);
      // stiff legs when dead
      a = a * (1 - this.deadK) + this.deadK * (L.def.front ? -0.5 : 0.5);
      b *= 1 - this.deadK;
      if (up) up.rotation.x = a;
      if (lo) lo.rotation.x = b;
      if (paw) paw.rotation.x = -(a + b) * 0.7;
      else if (lo && L.joints.length === 2) lo.rotation.x = b;
    }
    // body: bob and pitch
    let bodyY = 0, bodyPitch = 0, bodyRoll = 0;
    if (moving) {
      if (gait === 'gallop') {
        bodyY = Math.abs(Math.sin(P)) * H * 0.12;
        bodyPitch = Math.sin(P + 1) * 0.12;
      } else bodyY = Math.abs(Math.sin(P * 2)) * H * (gait === 'trot' ? 0.05 : 0.025);
    } else bodyY = Math.sin(this.t * 1.6) * H * 0.006; // breathing
    bodyY -= this.lieK * H * 0.62;
    // head
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 1.5 + Math.random() * 3;
      this.lookTarget = (Math.random() - 0.5) * 1.4;
    }
    const wantYaw = look !== null ? THREE.MathUtils.clamp(look, -1.2, 1.2) : pose === 'idle' || pose === 'lie' ? this.lookTarget : 0;
    this.lookYaw += (wantYaw - this.lookYaw) * Math.min(1, dt * 3);
    let headPitch = 0;
    if (pose === 'sniff') headPitch = 0.65 + Math.sin(this.t * 9) * 0.06;
    else if (pose === 'eat') headPitch = 0.85 + Math.abs(Math.sin(this.t * 5)) * 0.15;
    else if (pose === 'alert') headPitch = -0.25;
    else if (moving && gait === 'gallop') headPitch = 0.15;
    else if (moving) headPitch = 0.1 + Math.sin(P * 2) * 0.04;
    headPitch = headPitch * (1 - this.lieK) + this.lieK * 0.55;
    this.head.rotation.set(headPitch, this.lookYaw, 0, 'YXZ');
    // ears
    for (let i = 0; i < this.ears.length; i++) {
      this.earTwitch[i] = Math.max(0, (this.earTwitch[i] ?? 0) - dt * 4);
      if (Math.random() < dt * 0.25) this.earTwitch[i] = 1;
      const alert = pose === 'alert' ? -0.25 : 0;
      this.ears[i].rotation.x = alert + Math.sin(this.earTwitch[i] * Math.PI) * 0.35;
      this.ears[i].rotation.z = (i ? 1 : -1) * (moving && gait === 'gallop' ? 0.35 : 0.05);
    }
    // tail
    for (let i = 0; i < this.tail.length; i++) {
      const g = this.tail[i];
      const sway = Math.sin(this.t * (moving ? 3 : 1.3) + i * 0.8) * (moving ? 0.15 : 0.22);
      let lift = moving ? (gait === 'gallop' ? -0.1 : 0.15) : 0.35;
      if (pose === 'alert') lift = -0.15;
      lift = lift * (1 - this.lieK) + this.lieK * 0.9;
      g.rotation.set(i === 0 ? lift : lift * 0.3, sway * (1 - this.deadK), 0, 'YXZ');
    }
    // mousing: crouch, leap in an arc, dive nose-first into the snow, pull out
    let rootY = 0, rootZ = 0;
    if (this.pounceT >= 0) {
      this.pounceT += dt;
      const u = this.pounceT;
      if (u < 0.6) {
        const c = u / 0.6;
        bodyY -= H * 0.25 * c;
        headPitch = 0.4;
        bodyPitch = 0.1 * c;
      } else if (u < 1.2) {
        const c = (u - 0.6) / 0.6;
        rootY = Math.sin(c * Math.PI) * H * 2.0;
        rootZ = 0;
        bodyPitch = THREE.MathUtils.lerp(-0.5, 1.1, c);
      } else if (u < 2.2) {
        rootY = -H * 0.45;
        bodyPitch = 1.05;
        for (const g of this.tail) g.rotation.y = Math.sin(this.t * 12) * 0.4;
      } else if (u < 2.8) {
        const c = (u - 2.2) / 0.6;
        rootY = -H * 0.45 * (1 - c);
        bodyPitch = 1.05 * (1 - c);
      } else this.pounceT = -1;
      this.head.rotation.x = headPitch;
    }
    this.pounceOffset.set(0, rootY, rootZ);
    if (this.deadK > 0.01) {
      bodyRoll = this.deadK * 1.45;
      bodyY = bodyY * (1 - this.deadK) - this.deadK * H * 0.55;
    }
    this.body.position.set(0, bodyY, 0).add(this.pounceOffset);
    this.body.rotation.set(bodyPitch, 0, bodyRoll);
    void tmpV;
  }

  /** where the body is pushed during a pounce (in local coordinates) */
  pounceOffset = new THREE.Vector3();
}
