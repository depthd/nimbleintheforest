// Procedural meshes for items.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Tex, worldUVBox } from '../core/textures';
import { def } from './items';

const mats = new Map<string, THREE.Material>();
export function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = mats.get(key);
  if (!m) {
    m = make();
    mats.set(key, m);
  }
  return m;
}

const std = (key: string, p: THREE.MeshStandardMaterialParameters) => mat(key, () => new THREE.MeshStandardMaterial(p));

export const M = {
  wood: () => std('wood', { map: Tex.planks(), roughness: 0.85 }),
  woodDark: () => std('woodDark', { map: Tex.planks(), color: 0x8a6a50, roughness: 0.85 }),
  woodLight: () => std('woodLight', { color: 0xd2b48a, roughness: 0.9 }),
  handle: () => std('handle', { color: 0x9a6b3e, roughness: 0.7 }),
  metal: () => std('metal', { map: Tex.metal(), color: 0x8a8a8a, metalness: 0.7, roughness: 0.45 }),
  blade: () => std('blade', { color: 0xc8ccd0, metalness: 0.85, roughness: 0.3 }),
  iron: () => std('iron', { map: Tex.metal(), color: 0x3a3836, metalness: 0.6, roughness: 0.7 }),
  red: () => std('red', { color: 0xa42a20, roughness: 0.6 }),
  black: () => std('black', { color: 0x202022, roughness: 0.6 }),
  barkSpruce: () => std('barkSpruce', { map: Tex.barkSpruce(), roughness: 1 }),
  barkBirch: () => std('barkBirch', { map: Tex.barkBirch(), roughness: 0.9 }),
  barkDead: () => std('barkDead', { map: Tex.barkDead(), roughness: 1 }),
  woodEnd: () => std('woodEnd', { map: Tex.woodEnd(), roughness: 0.9 }),
  snow: () => std('snow', { map: Tex.snow(), color: 0xf4f7fb, roughness: 0.95 }),
  needles: () => std('needles', { color: 0x2c4a33, roughness: 0.95 }),
  paper: () => std('paper', { map: Tex.paper(), roughness: 0.95 }),
  glass: () => std('glass', { color: 0xcfe6ff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.1, depthWrite: false }),
  fabric: (c: string) => std('fabric' + c, { map: Tex.fabric(c), roughness: 1 }),
  plaid: (v: number) => {
    const sets: [string, string, string][] = [
      ['#8c1f1a', '#1a1a1a', '#e0c070'],
      ['#25472f', '#0f1d3a', '#c9b98a'],
      ['#6b4a2e', '#ede0c4', '#2a2a2a'],
      ['#3a4f78', '#b9c4d6', '#8c1f1a'],
    ];
    const s = sets[v % sets.length];
    return std('plaid' + v, { map: Tex.plaid(s[0], s[1], s[2]), roughness: 1 });
  },
};

function mesh(geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(geo, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r: number, h: number, seg = 10) => new THREE.CylinderGeometry(r, r, h, seg);

function group(...children: THREE.Object3D[]) {
  const g = new THREE.Group();
  for (const c of children) g.add(c);
  return g;
}

function legs(g: THREE.Group, w: number, d: number, h: number, top: number, t = 0.04, m = M.wood()) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(mesh(box(t, h, t), m, sx * (w / 2 - t / 2), top - h / 2, sz * (d / 2 - t / 2)));
  }
}

function logMesh(r: number, len: number, bark: THREE.Material) {
  const g = new THREE.CylinderGeometry(r, r * 1.03, len, 12, 1);
  const me = mesh(g, [bark, M.woodEnd(), M.woodEnd()]);
  me.rotation.z = Math.PI / 2;
  return me;
}

function sectorGeo(r: number, len: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(r, 0);
  s.absarc(0, 0, r, 0, Math.PI / 2, false);
  s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 4 });
  g.translate(-r / 2, -r / 2, -len / 2);
  return g;
}

function can(r: number, h: number, label: THREE.Texture) {
  const lm = std('label' + label.uuid, { map: label, roughness: 0.6, metalness: 0.2 });
  return group(mesh(new THREE.CylinderGeometry(r, r, h, 14), [lm, M.metal(), M.metal()]));
}

function folded(w: number, h: number, d: number, m: THREE.Material) {
  const g = new THREE.Group();
  const me = mesh(new THREE.BoxGeometry(w, h, d, 2, 1, 2), m);
  // soften edges a bit
  const p = me.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getY(i)) > h * 0.4 && (Math.abs(p.getX(i)) > w * 0.45 || Math.abs(p.getZ(i)) > d * 0.45)) p.setY(i, p.getY(i) * 0.6);
  }
  me.geometry.computeVertexNormals();
  g.add(me);
  return g;
}

export function buildItemMesh(id: string, params: Record<string, number> = {}): THREE.Object3D {
  const v = params.v ?? 0;
  let o: THREE.Object3D;
  switch (id) {
    case 'axe':
    case 'hatchet': {
      const s = id === 'axe' ? 1 : 0.58;
      const g = group(mesh(cyl(0.018 * s + 0.004, 0.72 * s, 8), M.handle(), 0, 0, 0));
      const head = mesh(box(0.025, 0.1 * s, 0.15 * s), M.metal(), 0, 0.3 * s, 0.04 * s);
      const edge = mesh(box(0.008, 0.13 * s, 0.03), M.blade(), 0, 0.3 * s, 0.115 * s);
      g.add(head, edge);
      o = g;
      break;
    }
    case 'saw': {
      const blade = mesh(box(0.003, 0.11, 0.5), M.blade(), 0, 0, 0.05);
      const handle = mesh(box(0.03, 0.11, 0.12), M.handle(), 0, 0, -0.26);
      o = group(blade, handle);
      break;
    }
    case 'knife':
    case 'shard': {
      if (id === 'shard') {
        const s = new THREE.Shape();
        s.moveTo(-0.05, -0.06);
        s.lineTo(0.05, -0.05);
        s.lineTo(0.0, 0.07);
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false });
        g.rotateX(-Math.PI / 2);
        o = group(mesh(g, std('shardglass', { color: 0xdff0ff, transparent: true, opacity: 0.6, roughness: 0.05 })));
      } else {
        o = group(mesh(box(0.004, 0.02, 0.13), M.blade(), 0, 0, 0.06), mesh(box(0.022, 0.024, 0.1), M.black(), 0, 0, -0.07));
      }
      break;
    }
    case 'hammer':
      o = group(mesh(cyl(0.014, 0.3, 8), M.handle()), mesh(box(0.1, 0.03, 0.03), M.iron(), 0.01, 0.15, 0));
      break;
    case 'prybar': {
      const g = group(mesh(cyl(0.012, 0.56, 6), M.red()));
      const tip = mesh(cyl(0.012, 0.08, 6), M.red(), 0, 0.29, 0.025);
      tip.rotation.x = 1.1;
      g.add(tip);
      o = g;
      break;
    }
    case 'shovel':
      o = group(mesh(cyl(0.016, 0.85, 8), M.handle(), 0, 0.12, 0), mesh(box(0.22, 0.28, 0.01), M.metal(), 0, -0.4, 0.01));
      break;
    case 'auger': {
      const g = group(mesh(cyl(0.02, 1.0, 8), M.metal()));
      const t = mesh(cyl(0.015, 0.36, 8), M.red(), 0, 0.5, 0);
      t.rotation.z = Math.PI / 2;
      g.add(t);
      for (let i = 0; i < 4; i++) {
        const b = mesh(box(0.11, 0.01, 0.03), M.blade(), 0, -0.45 + i * 0.03, 0);
        b.rotation.y = i * 0.8;
        g.add(b);
      }
      o = g;
      break;
    }
    case 'rod':
      o = group(mesh(new THREE.CylinderGeometry(0.004, 0.012, 1.0, 6), M.black()), mesh(cyl(0.025, 0.02, 10), M.metal(), 0.02, -0.3, 0));
      break;
    case 'matches':
      o = group(mesh(box(0.05, 0.016, 0.036), [M.red(), M.red(), std('matchlabel', { map: Tex.label('#c8a032', '#3a1a10', 'СПИЧКИ'), roughness: 0.8 }), M.red(), M.red(), M.red()]));
      break;
    case 'lighter':
      o = group(mesh(box(0.024, 0.06, 0.012), std('lighterblue', { color: 0x2a5ab0, roughness: 0.4 }), 0, -0.005, 0), mesh(box(0.024, 0.012, 0.012), M.metal(), 0, 0.03, 0));
      break;
    case 'flashlight': {
      const b = mesh(cyl(0.018, 0.16, 10), M.black());
      const lens = mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.04, 10), M.metal(), 0, 0.09, 0);
      o = group(b, lens);
      break;
    }
    case 'lamp': {
      const g = group(mesh(cyl(0.07, 0.07, 14), M.red(), 0, -0.11, 0));
      g.add(mesh(cyl(0.05, 0.12, 14), M.glass(), 0, 0, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.065, 0.05, 14), M.red(), 0, 0.09, 0));
      const h = mesh(new THREE.TorusGeometry(0.06, 0.004, 6, 16, Math.PI), M.metal(), 0, 0.1, 0);
      g.add(h);
      const wick = mesh(cyl(0.006, 0.02, 6), std('wick', { color: 0xffcc66, emissive: 0x000000 }), 0, -0.02, 0);
      wick.name = 'wick';
      g.add(wick);
      o = g;
      break;
    }
    case 'pot':
    case 'bucket': {
      const big = id === 'bucket';
      const r = big ? 0.14 : 0.11, h = big ? 0.3 : 0.16;
      const pts = [new THREE.Vector2(0, -h / 2), new THREE.Vector2(r * 0.92, -h / 2), new THREE.Vector2(r, h / 2), new THREE.Vector2(r * 0.94, h / 2), new THREE.Vector2(r * 0.86, -h / 2 + 0.01), new THREE.Vector2(0, -h / 2 + 0.01)];
      const g = group(mesh(new THREE.LatheGeometry(pts, 16), std(big ? 'bucketm' : 'potm', { color: big ? 0x8a9096 : 0x55595e, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide })));
      const handle = mesh(new THREE.TorusGeometry(r * 0.95, 0.004, 6, 16, Math.PI), M.metal(), 0, h / 2, 0);
      g.add(handle);
      const contents = mesh(new THREE.CircleGeometry(r * 0.9, 16), std('water', { color: 0x6f8fa8, roughness: 0.1, metalness: 0.2 }), 0, 0, 0);
      contents.rotation.x = -Math.PI / 2;
      contents.name = 'contents';
      contents.visible = false;
      g.add(contents);
      o = g;
      break;
    }
    case 'nails':
      o = group(mesh(box(0.1, 0.06, 0.08), std('nailbox', { map: Tex.label('#6a7a8a', '#111', 'ГВОЗДИ'), roughness: 0.8 })));
      break;
    case 'kerosene':
      o = group(mesh(cyl(0.045, 0.2, 12), std('kerobottle', { color: 0xb8431c, roughness: 0.5 })), mesh(cyl(0.015, 0.04, 8), M.black(), 0, 0.12, 0));
      break;
    case 'log':
      o = group(logMesh(0.14, 1.2, params.dead ? M.barkDead() : params.birch ? M.barkBirch() : M.barkSpruce()));
      break;
    case 'firewood':
      o = group(mesh(sectorGeo(0.11, 0.4), params.birch ? std('fwbirch', { color: 0xe9e1cf, roughness: 0.9 }) : M.woodLight()));
      break;
    case 'plank':
      o = group(mesh(worldUVBox(1.2, 0.024, 0.14, 1.2), M.wood()));
      break;
    case 'kindling': {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const k = mesh(box(0.012, 0.01, 0.24), M.woodLight(), (i - 1) * 0.013, 0, 0);
        k.rotation.y = (i - 1) * 0.12;
        g.add(k);
      }
      o = g;
      break;
    }
    case 'sticks': {
      const g = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const k = mesh(new THREE.CylinderGeometry(0.007, 0.01, 0.5, 5), M.barkDead(), (i - 1.5) * 0.012, 0, 0);
        k.rotation.x = Math.PI / 2;
        k.rotation.y = (i - 1.5) * 0.15;
        g.add(k);
      }
      o = g;
      break;
    }
    case 'boughs': {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const c = mesh(new THREE.ConeGeometry(0.18, 0.62, 6, 1), M.needles(), (i - 1) * 0.1, 0, 0);
        c.rotation.x = Math.PI / 2;
        c.rotation.y = (i - 1) * 0.3;
        c.scale.set(1, 1, 0.25);
        g.add(c);
      }
      o = g;
      break;
    }
    case 'bark': {
      const me = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10, 1, true, 0, Math.PI * 1.4), std('barkpiece', { map: Tex.barkBirch(), side: THREE.DoubleSide, roughness: 0.9 }));
      me.rotation.z = Math.PI / 2;
      o = group(me);
      break;
    }
    case 'paper':
      o = group(mesh(box(0.2, 0.004, 0.28), M.paper()));
      break;
    case 'newspaper':
      o = group(mesh(box(0.3, 0.012, 0.4), M.paper()));
      break;
    case 'shavings': {
      const g = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const t = mesh(new THREE.TorusGeometry(0.015, 0.004, 4, 8, Math.PI * 1.5), M.woodLight(), (Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.04);
        t.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        g.add(t);
      }
      o = g;
      break;
    }
    case 'cloth': {
      const colors = ['#8c1f1a', '#25472f', '#6b4a2e', '#3a4f78', '#777'];
      const me = mesh(new THREE.IcosahedronGeometry(0.08, 0), M.fabric(colors[v % colors.length]));
      me.scale.set(1, 0.2, 1);
      o = group(me);
      break;
    }
    case 'book': {
      const colors = [0x6a1e1e, 0x1e3a6a, 0x2f4f2f, 0x5a4a2a];
      const g = group(mesh(box(0.16, 0.05, 0.22), std('book' + (v % 4), { color: colors[v % 4], roughness: 0.8 })));
      g.add(mesh(box(0.15, 0.04, 0.205), std('pages', { color: 0xeae3cf, roughness: 0.9 }), 0.006, 0, 0));
      o = g;
      break;
    }
    case 'snowblock':
      o = group(mesh(worldUVBox(0.6, 0.36, 0.3, 1), M.snow()));
      break;
    case 'chair': {
      const g = new THREE.Group();
      g.add(mesh(worldUVBox(0.44, 0.04, 0.44), M.wood(), 0, 0, 0));
      legs(g, 0.42, 0.42, 0.45, -0.02);
      g.add(mesh(box(0.04, 0.45, 0.04), M.wood(), -0.19, 0.24, -0.2));
      g.add(mesh(box(0.04, 0.45, 0.04), M.wood(), 0.19, 0.24, -0.2));
      g.add(mesh(worldUVBox(0.42, 0.18, 0.025), M.wood(), 0, 0.36, -0.2));
      o = g;
      break;
    }
    case 'stool': {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 12), M.wood(), 0, 0.21, 0));
      legs(g, 0.26, 0.26, 0.42, 0.19, 0.035);
      o = g;
      break;
    }
    case 'table': {
      const g = new THREE.Group();
      g.add(mesh(worldUVBox(1.4, 0.05, 0.84), M.wood(), 0, 0.355, 0));
      legs(g, 1.3, 0.76, 0.73, 0.33, 0.06);
      o = g;
      break;
    }
    case 'bed': {
      const g = new THREE.Group();
      g.add(mesh(worldUVBox(2.0, 0.18, 0.96), M.woodDark(), 0, -0.1, 0));
      legs(g, 2.0, 0.96, 0.2, -0.17, 0.08, M.woodDark());
      g.add(mesh(new THREE.BoxGeometry(1.92, 0.16, 0.9), std('mattress', { map: Tex.fabric('#d8d2c2'), roughness: 1 }), 0, 0.07, 0));
      g.add(mesh(worldUVBox(0.06, 0.75, 0.96), M.woodDark(), -0.99, 0.18, 0));
      g.add(mesh(worldUVBox(0.06, 0.4, 0.96), M.woodDark(), 0.99, 0.0, 0));
      const pillow = mesh(new THREE.BoxGeometry(0.35, 0.08, 0.6), std('pillow', { map: Tex.fabric('#e8e4da'), roughness: 1 }), -0.75, 0.18, 0);
      g.add(pillow);
      o = g;
      break;
    }
    case 'wardrobe': {
      const g = new THREE.Group();
      g.add(mesh(worldUVBox(1.0, 1.9, 0.56), M.woodDark()));
      g.add(mesh(box(0.01, 1.8, 0.01), M.black(), 0, 0, 0.285));
      g.add(mesh(box(0.03, 0.1, 0.02), M.metal(), -0.06, 0, 0.29));
      g.add(mesh(box(0.03, 0.1, 0.02), M.metal(), 0.06, 0, 0.29));
      o = g;
      break;
    }
    case 'cabinet': {
      const g = new THREE.Group();
      g.add(mesh(worldUVBox(1.2, 0.86, 0.6), M.woodDark(), 0, -0.02, 0));
      g.add(mesh(worldUVBox(1.24, 0.04, 0.62), M.wood(), 0, 0.43, 0));
      g.add(mesh(box(0.01, 0.7, 0.01), M.black(), 0, -0.05, 0.301));
      o = g;
      break;
    }
    case 'crate': {
      const g = new THREE.Group();
      g.add(mesh(worldUVBox(0.6, 0.4, 0.44, 0.6), M.wood()));
      for (const s of [-1, 1]) g.add(mesh(box(0.62, 0.05, 0.02), M.woodDark(), 0, s * 0.17, 0.225));
      o = g;
      break;
    }
    case 'chest': {
      const g = new THREE.Group();
      g.add(mesh(worldUVBox(0.9, 0.42, 0.56, 0.8), M.woodDark(), 0, -0.04, 0));
      g.add(mesh(worldUVBox(0.92, 0.1, 0.58, 0.8), M.woodDark(), 0, 0.2, 0));
      for (const s of [-0.3, 0.3]) g.add(mesh(box(0.04, 0.52, 0.585), M.iron(), s, 0, 0));
      o = g;
      break;
    }
    case 'bench': {
      const g = new THREE.Group();
      g.add(mesh(worldUVBox(1.4, 0.05, 0.32), M.wood(), 0, 0.195, 0));
      for (const s of [-0.6, 0.6]) g.add(mesh(box(0.05, 0.4, 0.28), M.wood(), s, -0.02, 0));
      o = g;
      break;
    }
    case 'workbench': {
      const g = new THREE.Group();
      g.add(mesh(worldUVBox(1.8, 0.07, 0.7), M.wood(), 0, 0.395, 0));
      legs(g, 1.75, 0.66, 0.8, 0.36, 0.08);
      g.add(mesh(worldUVBox(1.6, 0.03, 0.6), M.wood(), 0, -0.25, 0));
      o = g;
      break;
    }
    case 'block': {
      const me = mesh(new THREE.CylinderGeometry(0.25, 0.27, 0.5, 14), [M.barkSpruce(), M.woodEnd(), M.woodEnd()]);
      o = group(me);
      break;
    }
    case 'shelf': {
      const g = new THREE.Group();
      for (const s of [-0.48, 0.48]) g.add(mesh(box(0.03, 0.9, 0.3), M.wood(), s, 0, 0));
      for (const y of [-0.42, 0, 0.42]) g.add(mesh(worldUVBox(0.96, 0.025, 0.3), M.wood(), 0, y, 0));
      o = g;
      break;
    }
    case 'blanket':
      o = folded(0.6, 0.14, 0.48, M.plaid(v));
      break;
    case 'plaid':
      o = folded(0.52, 0.1, 0.4, M.plaid(v + 2));
      break;
    case 'beanie':
    case 'ushanka': {
      const c = id === 'beanie' ? '#3a5a8a' : '#5a4636';
      const me = mesh(new THREE.SphereGeometry(id === 'beanie' ? 0.09 : 0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.fabric(c), 0, -0.04, 0);
      o = group(me);
      break;
    }
    case 'mittens':
    case 'gloves': {
      const c = id === 'mittens' ? '#7a2a2a' : '#8a7a50';
      o = group(mesh(box(0.06, 0.03, 0.16), M.fabric(c), -0.035, 0, 0), mesh(box(0.06, 0.03, 0.16), M.fabric(c), 0.035, 0, 0.01));
      break;
    }
    case 'sneakers':
    case 'boots':
    case 'valenki': {
      const c = id === 'sneakers' ? '#d0d0d0' : id === 'boots' ? '#3a2a1e' : '#6e6a66';
      const tall = id === 'valenki' ? 0.32 : id === 'boots' ? 0.14 : 0.08;
      const g = new THREE.Group();
      for (const s of [-0.045, 0.045]) {
        g.add(mesh(box(0.08, 0.08, 0.26), M.fabric(c), s, -0.04 + 0.04, 0.02));
        g.add(mesh(box(0.08, tall, 0.1), M.fabric(c), s, tall / 2 - 0.04, -0.07));
      }
      g.position.y = -0.03;
      o = group(g);
      break;
    }
    case 'stew':
      o = can(0.045, 0.1, Tex.label('#b0302a', '#fff', 'ТУШЁНКА'));
      break;
    case 'beans':
      o = can(0.04, 0.11, Tex.label('#3a6a2a', '#fff', 'ФАСОЛЬ'));
      break;
    case 'crackers':
      o = group(mesh(box(0.14, 0.06, 0.2), std('crackers', { map: Tex.label('#d0a050', '#5a2a10', 'СУХАРИ'), roughness: 0.8 })));
      break;
    case 'chocolate':
      o = group(mesh(box(0.12, 0.012, 0.24), std('choco', { map: Tex.label('#3a1a8a', '#fff', 'ШОКОЛАД'), roughness: 0.5 })));
      break;
    case 'tea':
      o = group(mesh(box(0.04, 0.01, 0.05), std('teabag', { color: 0xd8c8a0, roughness: 1 })));
      break;
    case 'fish_raw':
    case 'fish_cooked':
    case 'fish_burnt': {
      const c = id === 'fish_raw' ? 0x8ea4a0 : id === 'fish_cooked' ? 0xb07a3a : 0x2a1f18;
      const m = std('fish' + id, { color: c, roughness: id === 'fish_raw' ? 0.35 : 0.8, metalness: id === 'fish_raw' ? 0.3 : 0 });
      const body = mesh(new THREE.SphereGeometry(0.04, 10, 8), m);
      body.scale.set(0.8, 0.7, 3);
      const tail = mesh(new THREE.ConeGeometry(0.04, 0.06, 4), m, 0, 0, -0.14);
      tail.rotation.x = -Math.PI / 2;
      tail.scale.set(0.2, 1, 1);
      o = group(body, tail);
      break;
    }
    default: {
      const d = def(id);
      const c = d.wear ? M.fabric(['#4a4a5a', '#5a3a2a', '#2a4a3a', '#6a5a3a', '#30343a'][(id.length + v) % 5]) : M.wood();
      if (d.shape.t === 'box') o = d.wear ? folded(d.shape.x * 2, d.shape.y * 2, d.shape.z * 2, c) : group(mesh(box(d.shape.x * 2, d.shape.y * 2, d.shape.z * 2), c));
      else if (d.shape.t === 'cyl') o = group(mesh(cyl(d.shape.r, d.shape.h * 2), c));
      else o = group(mesh(new THREE.SphereGeometry(0.1), c));
    }
  }
  const small = (() => {
    try {
      return def(id).mass < 0.5;
    } catch {
      return false;
    }
  })();
  const merged = mergeByMaterial(o);
  merged.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = !small;
      c.receiveShadow = true;
    }
  });
  return merged;
}

/** Collapse a group of meshes into one mesh per material (far fewer draw calls). */
function mergeByMaterial(root: THREE.Object3D): THREE.Object3D {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const keep: THREE.Object3D[] = [];
  let count = 0;
  root.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    count++;
    if (Array.isArray(m.material) || m.name) {
      keep.push(m);
      return;
    }
    let g = m.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.clearGroups();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (!buckets.has(m.material)) buckets.set(m.material, []);
    buckets.get(m.material)!.push(g);
  });
  if (count <= 1 && keep.length === 0) return root;
  const out = new THREE.Group();
  for (const [mtl, geos] of buckets) {
    const g = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!g) continue;
    out.add(new THREE.Mesh(g, mtl));
  }
  for (const k of keep) {
    const wm = new THREE.Matrix4().multiplyMatrices(inv, k.matrixWorld);
    k.removeFromParent();
    wm.decompose(k.position, k.quaternion, k.scale);
    out.add(k);
  }
  return out;
}
