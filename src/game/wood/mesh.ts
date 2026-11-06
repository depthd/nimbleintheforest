// Geometry for wood pieces: tapered stems with real notches carved in, split sticks,
// boards and spruce boughs. Fresh cuts are lighter than bark (a vertex attribute "cut").
import * as THREE from 'three';
import { Tex, worldUVBox } from '../../core/textures';
import { mat, M } from '../meshes';
import { SPECIES, Species } from './species';
import { notchDepthAt, radiusAt, WoodPiece } from './piece';

const BARK: Record<Species, () => THREE.Texture> = {
  spruce: () => Tex.barkSpruce(),
  pine: () => Tex.barkPine(),
  birch: () => Tex.barkBirch(),
  dead: () => Tex.barkDead(),
  burnt: () => Tex.barkBurnt(),
};

/** Bark that shows fresh wood where the vertex attribute "cut" is 1. */
export function barkMaterial(sp: Species): THREE.Material {
  return mat('woodcut_' + sp, () => {
    const m = new THREE.MeshStandardMaterial({ map: BARK[sp](), roughness: sp === 'birch' ? 0.9 : 1 });
    const f = SPECIES[sp].fresh;
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float cut;\nvarying float vCut;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCut = cut;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCut;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float grain = 0.88 + 0.12 * sin(vViewPosition.x * 40.0 + vViewPosition.y * 13.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${f[0].toFixed(3)}, ${f[1].toFixed(3)}, ${f[2].toFixed(3)}) * grain, smoothstep(0.3, 0.7, vCut));`,
        );
    };
    m.customProgramCacheKey = () => 'woodcut_' + sp;
    return m;
  });
}

export function endMaterial(sp: Species): THREE.Material {
  if (sp === 'burnt') return mat('woodEndBurnt', () => new THREE.MeshStandardMaterial({ map: Tex.woodEnd(), color: 0x8a7a68, roughness: 0.95 }));
  if (sp === 'birch') return mat('woodEndBirch', () => new THREE.MeshStandardMaterial({ map: Tex.woodEnd(), color: 0xf2ece0, roughness: 0.9 }));
  return M.woodEnd();
}

interface V {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  cut: number;
}

/** Position on the surface at (u, angle), pushed in by every notch that reaches it. */
function carve(p: WoodPiece, u: number, cy: number, cz: number, r: number, slope: number, out: V) {
  let y = cy * r, z = cz * r;
  let nx = -slope, ny = cy, nz = cz;
  let cut = 0;
  for (const n of p.notches) {
    const d = notchDepthAt(n, u);
    if (d <= 0) continue;
    const ay = Math.cos(n.a), az = Math.sin(n.a);
    const s = y * ay + z * az;
    const lim = r - d;
    if (s <= lim) continue;
    y -= ay * (s - lim);
    z -= az * (s - lim);
    cut = 1;
    const k = n.saw ? 0 : ((2 * n.d) / Math.max(0.001, n.w)) * Math.sign(u - n.u);
    nx = -k;
    ny = ay;
    nz = az;
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  out.x = u - p.len / 2;
  out.y = y;
  out.z = z;
  out.nx = nx / l;
  out.ny = ny / l;
  out.nz = nz / l;
  out.cut = cut;
  return out;
}

function ringPositions(p: WoodPiece) {
  const L = p.len;
  const us: number[] = [0, L];
  const nseg = Math.max(1, Math.ceil(L / 0.6));
  for (let i = 1; i < nseg; i++) us.push((L * i) / nseg);
  for (const n of p.notches) {
    const half = n.w / 2;
    const steps = n.saw ? 2 : Math.max(4, Math.min(16, Math.round(n.w / 0.008)));
    for (let i = 0; i <= steps; i++) us.push(n.u - half + (n.w * i) / steps);
    us.push(n.u - half - 0.002, n.u + half + 0.002, n.u);
  }
  us.sort((a, b) => a - b);
  const out: number[] = [];
  for (const u of us) {
    if (u < 0 || u > L) continue;
    if (out.length && u - out[out.length - 1] < 0.0015) continue;
    out.push(u);
  }
  if (out[out.length - 1] < L) out[out.length - 1] = L;
  return out;
}

/** A round piece: tapered stem with notches, bark on the side, rings on the ends. */
export function roundGeometry(p: WoodPiece): THREE.BufferGeometry {
  const rMax = Math.max(p.r0, p.r1);
  const S = rMax > 0.14 ? 18 : rMax > 0.05 ? 12 : rMax > 0.015 ? 8 : 6;
  const rings = ringPositions(p);
  const slope = (p.r1 - p.r0) / Math.max(0.01, p.len);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], cut: number[] = [];
  const idx: number[] = [];
  const v: V = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, cut: 0 };
  const push = (vv: V, a: number, b: number) => {
    pos.push(vv.x, vv.y, vv.z);
    nor.push(vv.nx, vv.ny, vv.nz);
    uv.push(a, b);
    cut.push(vv.cut);
    return pos.length / 3 - 1;
  };
  const around = rMax > 0.08 ? 2 : 1;
  for (let i = 0; i < rings.length; i++) {
    const u = rings[i];
    const r = radiusAt(p, u);
    for (let j = 0; j <= S; j++) {
      const th = (j / S) * Math.PI * 2;
      carve(p, u, Math.cos(th), Math.sin(th), r, slope, v);
      push(v, (j / S) * around, u * 0.7);
    }
  }
  const W = S + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < S; j++) {
      const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const side = idx.length;
  // end caps: a fan from the middle of the (possibly carved) end outline
  for (const end of [0, 1]) {
    const u = end ? p.len : 0;
    const r = radiusAt(p, u);
    const ring: V[] = [];
    let cy = 0, cz = 0;
    for (let j = 0; j < S; j++) {
      const th = (j / S) * Math.PI * 2;
      const q = carve(p, u, Math.cos(th), Math.sin(th), r, slope, { ...v });
      ring.push(q);
      cy += q.y;
      cz += q.z;
    }
    cy /= S;
    cz /= S;
    const nx = end ? 1 : -1;
    const tex = (y: number, z: number) => [0.5 + y / (2.2 * Math.max(0.01, r)), 0.5 + z / (2.2 * Math.max(0.01, r))];
    const c0 = push({ x: u - p.len / 2, y: cy, z: cz, nx, ny: 0, nz: 0, cut: 1 }, ...(tex(cy, cz) as [number, number]));
    const first = pos.length / 3;
    for (const q of ring) push({ ...q, nx, ny: 0, nz: 0, cut: 1 }, ...(tex(q.y, q.z) as [number, number]));
    for (let j = 0; j < S; j++) {
      const a = first + j, b = first + ((j + 1) % S);
      if (end) idx.push(c0, a, b);
      else idx.push(c0, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('cut', new THREE.Float32BufferAttribute(cut, 1));
  g.setIndex(idx);
  g.addGroup(0, side, 0);
  g.addGroup(side, idx.length - side, 1);
  g.computeBoundingSphere();
  return g;
}

/** Centroid of a wedge of angle a and radius r, measured from the apex. */
export function wedgeCentroid(r: number, a: number) {
  return a >= Math.PI * 2 - 1e-3 ? 0 : (4 * r * Math.sin(a / 2)) / (3 * a);
}

/** A split stick: a wedge with bark on the outer arc, centred on its centroid. */
export function splitGeometry(p: WoodPiece): THREE.BufferGeometry {
  const r = p.r0, a = Math.min(p.sector, Math.PI * 1.999), L = p.len;
  const c = wedgeCentroid(r, a);
  const n = Math.max(2, Math.round(a * 4));
  // outline in the Y-Z plane: apex, then the arc
  const pts: [number, number, number][] = [[-c, 0, 0]];
  for (let i = 0; i <= n; i++) {
    const th = -a / 2 + (a * i) / n;
    pts.push([Math.cos(th) * r - c, Math.sin(th) * r, 1]);
  }
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], cut: number[] = [];
  const idx: number[] = [];
  const quad = (p0: number[], p1: number[], nn: number[], k: number, bark: boolean) => {
    const base = pos.length / 3;
    for (const [px, x] of [[p0, -L / 2], [p1, -L / 2], [p0, L / 2], [p1, L / 2]] as [number[], number][]) {
      pos.push(x, px[0], px[1]);
      nor.push(nn[0], nn[1], nn[2]);
      uv.push(k + (px === p1 ? 0.1 : 0), (x + L / 2) * 0.7);
      cut.push(bark ? 0 : 1);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  };
  // arc (bark) and the two split faces (fresh wood)
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = [pts[i][0], pts[i][1]], p1 = [pts[i + 1][0], pts[i + 1][1]];
    const mid = -a / 2 + (a * (i - 0.5)) / n;
    quad(p0, p1, [0, Math.cos(mid), Math.sin(mid)], i / n, true);
  }
  const apex = [pts[0][0], pts[0][1]];
  const s0 = [pts[1][0], pts[1][1]], s1 = [pts[pts.length - 1][0], pts[pts.length - 1][1]];
  quad(apex, s0, [0, -Math.sin(a / 2), -Math.cos(a / 2)], 0, false);
  quad(s1, apex, [0, -Math.sin(a / 2), Math.cos(a / 2)], 0, false);
  const side = idx.length;
  // ends
  for (const end of [0, 1]) {
    const x = end ? L / 2 : -L / 2;
    const base = pos.length / 3;
    for (const q of pts) {
      pos.push(x, q[0], q[1]);
      nor.push(end ? 1 : -1, 0, 0);
      uv.push(0.5 + (q[0] + c) / (2.2 * r), 0.5 + q[1] / (2.2 * r));
      cut.push(1);
    }
    for (let i = 1; i < pts.length - 1; i++) {
      if (end) idx.push(base, base + i, base + i + 1);
      else idx.push(base, base + i + 1, base + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('cut', new THREE.Float32BufferAttribute(cut, 1));
  g.setIndex(idx);
  g.addGroup(0, side, 0);
  g.addGroup(side, idx.length - side, 1);
  g.computeBoundingSphere();
  return g;
}

const needlesMat = () => mat('boughNeedles', () => new THREE.MeshStandardMaterial({ color: 0x2c4a33, roughness: 0.95, flatShading: true }));

/** Crown drawing for trunks: geometries of one band of the tree kind, already in piece space. */
export type CrownSource = (p: WoodPiece, band: number) => { geo: THREE.BufferGeometry; mat: THREE.Material }[];

/**
 * The visible object of a piece, in piece space (axis along X, centred).
 * Crown bands come from the forest so a felled tree looks like it did standing.
 */
export function buildWoodObject(p: WoodPiece, crown?: CrownSource): THREE.Group {
  const g = new THREE.Group();
  const big = Math.max(p.r0, p.r1, p.t) > 0.03 || p.len > 1;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[]) => {
    const me = new THREE.Mesh(geo, m);
    me.castShadow = big;
    me.receiveShadow = true;
    g.add(me);
    return me;
  };
  if (p.form === 'sawn') {
    add(worldUVBox(p.len, p.t, p.w, 1.2), M.wood());
    return g;
  }
  if (p.form === 'split') {
    add(splitGeometry(p), [barkMaterial(p.sp), endMaterial(p.sp)]);
    return g;
  }
  add(roundGeometry(p), [barkMaterial(p.sp), endMaterial(p.sp)]);
  if (p.needles > 0) {
    // a bough: flat sprays of needles along the outer two thirds
    const n = Math.max(1, Math.round(p.len / 0.35));
    for (let i = 0; i < n; i++) {
      const t = 0.3 + (0.7 * (i + 0.5)) / n;
      const len = (p.len / n) * 1.5;
      const c = new THREE.ConeGeometry(0.06 + 0.12 * (1 - t) + p.len * 0.05, len, 6, 1);
      c.rotateZ(-Math.PI / 2);
      c.scale(1, 0.3, 1);
      c.rotateX((i % 2) * 0.5 - 0.25);
      c.translate(t * p.len - p.len / 2, 0, 0);
      add(c, needlesMat());
    }
  }
  if (crown && p.crown) {
    for (const w of p.whorls) for (const part of crown(p, w.band)) add(part.geo, part.mat);
  }
  return g;
}
