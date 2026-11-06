// Caves in the game: mouths in the hillsides, interiors far outside the map, and the swap
// between them.
//
// A mouth is drawn and collided in the world like any rock. Its throat darkens a few metres in;
// there the screen fades, the player moves to the same spot of the same throat inside the
// interior, and the fade lifts. Inside, the outdoor world is hidden, the sun is off and the fog
// is black: daylight from the mouth is baked into the rock, and lamps do the rest.
import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { G, GROUPS_RAY, GROUPS_STATIC, msg } from '../game/ctx';
import { CaveBuild, ENTER_Z, EXIT_Z } from '../gen/cave';
import type { CaveMesh, CaveProp } from '../gen/cave';
import type { CaveSite } from '../gen/region';
import { Tex } from '../core/textures';
import { Rng, clamp, lerp, smoothstep } from '../core/rng';
import { groundUniforms } from './terrain';
import { NOTE_KEYS } from '../game/lore';

// outside: the cool dark stone of the mountains; inside: a warmer grey that reads under a lamp
const OUT_SOFT = new THREE.Color().setRGB(0.26, 0.27, 0.32, THREE.SRGBColorSpace);
const OUT_HARD = new THREE.Color().setRGB(0.41, 0.43, 0.49, THREE.SRGBColorSpace);
const IN_SOFT = new THREE.Color().setRGB(0.37, 0.355, 0.34, THREE.SRGBColorSpace);
const IN_HARD = new THREE.Color().setRGB(0.57, 0.545, 0.51, THREE.SRGBColorSpace);
const ICE = new THREE.Color().setRGB(0.72, 0.85, 0.96, THREE.SRGBColorSpace);
/** interiors sit in a row this far beyond the eastern edge of the map */
const AWAY = 2600, STEP = 900;
const FADE_OUT = 0.3, FADE_IN = 0.45;
/** air deep in a cave in winter, °C */
const DEEP_AIR = -3;

/** daylight that reaches in through the mouth; set from the sky every frame */
export const caveUniforms = { uDay: { value: new THREE.Color(0, 0, 0) } };

function caveMaterial(outdoor: boolean, ice: boolean) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: ice ? 0.16 : 0.94, metalness: 0, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRock = { value: Tex.rock() };
    sh.uniforms.uNoise = groundUniforms.uNoise;
    sh.uniforms.uDay = caveUniforms.uDay;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aLight;\nvarying vec3 vLight;\nvarying vec3 vCavePos;\nflat varying vec3 vFacet;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = aLight;\nvCavePos = transformed;\nvFacet = color;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLight;
varying vec3 vCavePos;
flat varying vec3 vFacet;
uniform sampler2D uRock;
uniform sampler2D uNoise;
uniform vec3 uDay;`)
      .replace('#include <color_fragment>', /* glsl */ `
  diffuseColor.rgb *= vFacet; // one colour per facet: crisp low-poly stone
  {
    // cave coordinates: the world mouth and the interior throat look the same
    vec3 N = normalize(cross(dFdx(vCavePos), dFdy(vCavePos)));
    vec3 w = pow(abs(N), vec3(4.0)); w /= (w.x + w.y + w.z);
    vec3 p = vCavePos * 0.11;
    vec3 tex = texture2D(uRock, p.yz).rgb * w.x + texture2D(uRock, p.xz).rgb * w.y + texture2D(uRock, p.xy).rgb * w.z;
    vec4 nz = texture2D(uNoise, vCavePos.xz * 0.13 + vCavePos.y * 0.05);
    vec3 col = diffuseColor.rgb * (${ice ? '0.92 + 0.2' : '0.78 + 0.85'} * tex) * (0.9 + 0.2 * nz.g);
    float frost = vLight.z;
    float up = smoothstep(0.5, 0.78, N.y + 0.12 * (nz.r - 0.5));
    ${outdoor ? '' : 'col = mix(col, vec3(0.78, 0.82, 0.88), frost * 0.22); // hoarfrost near the mouth'}
    // snow on ledges and on the floor near daylight; dusty, paler floors deeper in
    col = mix(col, vec3(0.92, 0.94, 0.97), up * frost * frost * 0.95);
    col *= mix(1.0, 1.16, up * (1.0 - frost));
    col *= mix(1.0, 0.72, smoothstep(0.0, -0.75, N.y));
    diffuseColor.rgb = col;
  }`)
      .replace('#include <aomap_fragment>', /* glsl */ `
  reflectedLight.indirectDiffuse *= vLight.x;
  ${outdoor ? '' : 'reflectedLight.indirectDiffuse += material.diffuseColor * uDay * vLight.y * (0.35 + 0.65 * vLight.x);'}`)
      .replace('#include <opaque_fragment>', `${outdoor ? 'outgoingLight *= vLight.y; // the throat goes dark a few metres in' : ''}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `cave-${outdoor ? 'out' : 'in'}-${ice ? 'ice' : 'rock'}-v1`;
  return m;
}

/** rock colour by bed and by depth along the throat: the same function in both meshes */
function rockColor(out: THREE.Color, tone: number, z: number) {
  const k = smoothstep(0, 7, z);
  const r = lerp(lerp(OUT_SOFT.r, OUT_HARD.r, tone), lerp(IN_SOFT.r, IN_HARD.r, tone), k);
  const g = lerp(lerp(OUT_SOFT.g, OUT_HARD.g, tone), lerp(IN_SOFT.g, IN_HARD.g, tone), k);
  const b = lerp(lerp(OUT_SOFT.b, OUT_HARD.b, tone), lerp(IN_SOFT.b, IN_HARD.b, tone), k);
  return out.setRGB(r, g, b);
}

function meshGeometry(m: CaveMesh, outdoor = false) {
  const n = m.positions.length / 3;
  const col = new Uint8Array(n * 3), light = new Uint8Array(n * 3), c = new THREE.Color();
  for (let q = 0; q < n; q++) {
    // the outside of a mouth is mountain stone, calmer than the broken rock inside
    const outer = outdoor && m.day[q] > 0.93;
    rockColor(c, outer ? 0.35 + (m.tone[q] - 0.5) * 0.45 : m.tone[q], outer ? -1 : m.positions[q * 3 + 2]);
    col[q * 3] = c.r * 255; col[q * 3 + 1] = c.g * 255; col[q * 3 + 2] = c.b * 255;
    light[q * 3] = m.ao[q] * 255; light[q * 3 + 1] = m.day[q] * 255; light[q * 3 + 2] = m.frost[q] * 255;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  g.setAttribute('aLight', new THREE.BufferAttribute(light, 3, true));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** all props of one material merged into a geometry */
function propGeometry(props: CaveProp[], ice: boolean) {
  const pos: number[] = [], col: number[] = [], light: number[] = [], idx: number[] = [];
  const rng = new Rng(props.length * 17 + (ice ? 1 : 0)), c = new THREE.Color();
  for (const p of props) {
    if (p.ice !== ice) continue;
    const base = pos.length / 3;
    if (ice) c.copy(ICE).multiplyScalar(rng.float(0.92, 1.05));
    else rockColor(c, rng.float(0.25, 0.85), 99);
    for (let q = 0; q < p.pos.length; q++) pos.push(p.pos[q]);
    for (let q = 0; q < p.pos.length / 3; q++) {
      col.push(c.r, c.g, c.b);
      light.push(p.kind === 'pebble' ? 0.7 : 0.9, p.day, ice ? Math.max(0.2, p.frost * 0.6) : p.frost);
    }
    for (const q of p.idx) idx.push(base + q);
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(Uint8Array.from(col, (v) => Math.round(clamp(v, 0, 1) * 255)), 3, true));
  g.setAttribute('aLight', new THREE.BufferAttribute(Uint8Array.from(light, (v) => Math.round(clamp(v, 0, 1) * 255)), 3, true));
  g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

interface Frame { x: number; y: number; z: number; yaw: number }

function toLocal(f: Frame, p: THREE.Vector3, out = new THREE.Vector3()) {
  const dx = p.x - f.x, dz = p.z - f.z, c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return out.set(dx * c - dz * s, p.y - f.y, dx * s + dz * c);
}

function toWorld(f: Frame, l: THREE.Vector3, out = new THREE.Vector3()) {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return out.set(f.x + l.x * c + l.z * s, f.y + l.y, f.z - l.x * s + l.z * c);
}

interface Interior {
  frame: Frame;
  group: THREE.Group;
  body: RAPIER_T.RigidBody;
  exit: THREE.Mesh;
  minY: number;
  triangles: number;
  colliders: number;
}

export class Caves {
  readonly builds: CaveBuild[];
  readonly mouths = new THREE.Group();
  readonly insides = new THREE.Group();
  /** index of the cave the player is in, −1 outdoors */
  current = -1;
  private interiors: (Interior | null)[] = [];
  private phase: 'idle' | 'out' | 'in' = 'idle';
  private t = 0;
  private target: { cave: number; enter: boolean } | null = null;
  private fade: HTMLDivElement;
  private hidden: THREE.Object3D[] = [];
  private light: THREE.PointLight | null = null;
  /** light thrown back by the rock where a flashlight beam lands */
  private bounce: THREE.PointLight | null = null;
  private visited = new Set<number>();
  private tmp = new THREE.Vector3();
  private mats = { outRock: caveMaterial(true, false), outIce: caveMaterial(true, true), inRock: caveMaterial(false, false), inIce: caveMaterial(false, true) };
  readonly mouthTriangles: number;

  constructor(readonly sites: CaveSite[]) {
    this.mouths.name = 'cave-mouths';
    this.insides.name = 'cave-interiors';
    this.insides.visible = false;
    G.scene.add(this.mouths, this.insides);
    this.builds = sites.map((s) => new CaveBuild({ seed: s.seed, hill: s.hill }));
    let tris = 0;
    sites.forEach((s, i) => (tris += this.buildMouth(i)));
    this.mouthTriangles = tris;
    this.interiors = sites.map(() => null);
    this.fade = document.createElement('div');
    this.fade.id = 'cave-fade';
    Object.assign(this.fade.style, { position: 'fixed', inset: '0', background: '#000', opacity: '0', pointerEvents: 'none', zIndex: '40' });
    document.body.appendChild(this.fade);
  }

  get inside() {
    return this.current >= 0;
  }

  /** where the player is on the map: the mouth of the cave while inside */
  worldPos(out = new THREE.Vector3()) {
    if (!this.inside) return out.copy(G.player.pos);
    const s = this.sites[this.current];
    return out.set(s.x, s.y, s.z);
  }

  private buildMouth(i: number) {
    const s = this.sites[i], b = this.builds[i];
    const m = b.mouth();
    const mesh = new THREE.Mesh(meshGeometry(m, true), this.mats.outRock);
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.y = s.yaw;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = 'cave-mouth';
    this.mouths.add(mesh);
    // icicles go dark with the throat behind them
    const ice = propGeometry(b.lipProps().map((p) => ({ ...p, day: Math.exp(-Math.max(0, p.z - 0.3) / 2.1), frost: 1 })), true);
    if (ice) {
      const im = new THREE.Mesh(ice, this.mats.outIce);
      im.position.copy(mesh.position);
      im.rotation.y = s.yaw;
      im.castShadow = true;
      this.mouths.add(im);
    }
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
    const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed().setTranslation(s.x, s.y, s.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    G.world.createCollider(G.R.ColliderDesc.trimesh(m.positions, m.indices).setCollisionGroups(GROUPS_STATIC).setFriction(0.9), body);
    // no snowfall and no loose snow in the throat; out of the wind
    const c = toWorld(s, new THREE.Vector3(0, 0, 3.4));
    G.snowCover.add({ name: 'Вход в пещеру', kind: 'roof', x: c.x, z: c.z, hx: 2.6, hz: 4.2, yaw: s.yaw, y: s.y + 3.3 });
    G.structures.shelters.push({ cx: c.x, cz: c.z, yaw: s.yaw, hx: 2.3, hz: 3.6, y0: s.y - 0.6, y1: s.y + 3.2,
      shelter: { kind: 'grotto', name: 'Вход в пещеру', wind: 0.3, warm: 1, enclosed: false, pos: new THREE.Vector3(s.x, s.y, s.z) } });
    return m.indices.length / 3;
  }

  private frameOf(i: number): Frame {
    const s = this.sites[i];
    return { x: G.region.maxX + AWAY + STEP * i, y: s.y, z: 0, yaw: s.yaw };
  }

  /** The interior: built on the first visit, kept afterwards so dropped things stay where they lie. */
  private interior(i: number): Interior {
    const have = this.interiors[i];
    if (have) return have;
    const b = this.builds[i], f = this.frameOf(i);
    const m = b.interior(), props = b.props();
    const group = new THREE.Group();
    group.position.set(f.x, f.y, f.z);
    group.rotation.y = f.yaw;
    group.name = `cave-${i}`;
    const rock = new THREE.Mesh(meshGeometry(m), this.mats.inRock);
    rock.receiveShadow = true;
    group.add(rock);
    let tris = m.indices.length / 3;
    for (const ice of [false, true]) {
      const g = propGeometry(props, ice);
      if (!g) continue;
      const pm = new THREE.Mesh(g, ice ? this.mats.inIce : this.mats.inRock);
      group.add(pm);
      tris += (g.index?.count ?? 0) / 3;
    }
    // the daylight outside the mouth: overexposed, as seen from the dark
    const exit = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    exit.position.set(0, 3, -1.25);
    group.add(exit);
    this.insides.add(group);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw);
    const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed().setTranslation(f.x, f.y, f.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    G.world.createCollider(G.R.ColliderDesc.trimesh(m.positions, m.indices).setCollisionGroups(GROUPS_STATIC).setFriction(0.9), body);
    let colliders = 1;
    for (const p of props) {
      if (!p.hull) continue;
      const d = G.R.ColliderDesc.convexHull(p.hull);
      if (!d) continue;
      G.world.createCollider(d.setCollisionGroups(GROUPS_STATIC).setFriction(0.9), body);
      colliders++;
    }
    const I: Interior = { frame: f, group, body, exit, minY: f.y + b.box.minY, triangles: tris, colliders };
    this.interiors[i] = I;
    this.loot(i, I);
    return I;
  }

  /** an old camp and caches: a few useful things, a note */
  private loot(i: number, I: Interior) {
    const b = this.builds[i], rng = new Rng(this.sites[i].seed * 13 + 1);
    const at = (s: { x: number; y: number; z: number }, dx: number, dz: number, up = 0.25) => toWorld(I.frame, new THREE.Vector3(s.x + dx, s.y + up, s.z + dz));
    for (const s of b.spots) {
      if (s.kind === 'camp') {
        const fire = toWorld(I.frame, new THREE.Vector3(s.x, s.y + 0.02, s.z));
        G.fires.makeCampfire(fire);
        for (let k = 0; k < 3; k++) G.entities.spawnItem('sticks', at(s, 0.9 + k * 0.08, -0.6, 0.3 + k * 0.06), { moisture: 0.05 });
        G.entities.spawnItem('firewood', at(s, -0.9, 0.5), { moisture: 0.05 });
        G.entities.spawnItem('note', at(s, 0.5, 0.8), { params: { t: NOTE_KEYS.indexOf('cave') } });
      } else {
        const pool = ['matches', 'stew', 'beans', 'tea', 'crackers', 'kerosene', 'wool_socks', 'lamp', 'flashlight', 'blanket'];
        const ids = rng.shuffle(pool).slice(0, rng.int(2, 4));
        ids.forEach((id, k) => {
          const opts: Record<string, any> = { moisture: 0.05 };
          if (id === 'matches') opts.charges = rng.int(5, 15);
          if (id === 'flashlight') opts.charges = rng.int(20, 70);
          if (id === 'lamp' || id === 'kerosene') opts.charges = rng.int(20, 60);
          if (id === 'blanket') opts.params = { v: rng.int(0, 3) };
          G.entities.spawnItem(id, at(s, (k % 2) * 0.35 - 0.17, Math.floor(k / 2) * 0.3), opts);
        });
      }
    }
  }

  // ---------- the swap ----------

  private start(cave: number, enter: boolean) {
    if (this.phase !== 'idle') return;
    this.phase = 'out';
    this.t = 0;
    this.target = { cave, enter };
  }

  /** enter or leave at once (tests, debugging) */
  jump(cave: number, enter: boolean, local = new THREE.Vector3(0, 0.6, enter ? ENTER_Z + 0.8 : EXIT_Z - 1.2)) {
    const f = enter ? this.interior(cave).frame : this.sites[cave];
    const P = G.player;
    if (enter && !this.inside) this.goInside(cave);
    if (!enter && this.inside) this.goOutside();
    P.teleport(toWorld(f, local));
  }

  private goInside(i: number) {
    const I = this.interior(i);
    this.current = i;
    this.insides.visible = true;
    for (const g of this.insides.children) g.visible = g === I.group;
    // hide the outdoor world: everything at the top of the scene except lights, sprites,
    // things, the player and the caves (it is restored as it was)
    const keep = new Set<THREE.Object3D>([this.insides, G.camera, G.player.avatar.root]);
    for (const e of G.entities.list) if (e.obj) keep.add(e.obj);
    this.hidden = [];
    for (const o of G.scene.children) {
      if (!o.visible || keep.has(o) || (o as THREE.Light).isLight || (o as THREE.Sprite).isSprite) continue;
      o.visible = false;
      this.hidden.push(o);
    }
    G.renderer.shadowMap.autoUpdate = false;
    G.renderer.shadowMap.needsUpdate = true;
    G.sky.indoorFactor = 0.04;
    this.light = G.fx.acquireLight();
    this.bounce = G.fx.acquireLight();
    if (!this.visited.has(i)) {
      this.visited.add(i);
      msg('Пещера. Здесь тихо и не дует, но дальше от входа — темнота', 'info');
    }
  }

  private goOutside() {
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
    this.insides.visible = false;
    this.current = -1;
    G.renderer.shadowMap.autoUpdate = true;
    G.sky.indoorFactor = 1;
    for (const l of [this.light, this.bounce]) if (l) G.fx.releaseLight(l);
    this.light = this.bounce = null;
  }

  private swap() {
    const { cave, enter } = this.target!;
    const P = G.player;
    const from = enter ? this.sites[cave] : this.interior(cave).frame;
    const to = enter ? this.interior(cave).frame : this.sites[cave];
    const dest = toWorld(to, toLocal(from, P.pos, this.tmp), new THREE.Vector3());
    const delta = dest.clone().sub(P.pos);
    const carried = P.carried?.body ?? null;
    const ct = carried?.translation();
    if (enter) this.goInside(cave); else this.goOutside();
    P.teleport(dest);
    if (carried && ct) carried.setTranslation({ x: ct.x + delta.x, y: ct.y + delta.y, z: ct.z + delta.z }, true);
    if (!enter) {
      // the world around the mouth must be there when the fade lifts
      G.terrain.update(P.pos, 400);
      G.forest.update(P.pos, true);
      G.lake.stream(P.pos, 60);
    }
  }

  update(dt: number) {
    const P = G.player;
    if (this.phase === 'idle' && !G.dead) {
      if (!this.inside) {
        for (let i = 0; i < this.sites.length; i++) {
          const s = this.sites[i];
          if (Math.abs(P.pos.x - s.x) > 12 || Math.abs(P.pos.z - s.z) > 12) continue;
          const l = toLocal(s, P.pos, this.tmp);
          if (l.z > ENTER_Z && Math.abs(l.x) < 2.4 && l.y > -1.5 && l.y < 3) this.start(i, true);
        }
      } else {
        const I = this.interiors[this.current]!;
        const l = toLocal(I.frame, P.pos, this.tmp);
        if (l.z < EXIT_Z && Math.abs(l.x) < 4 && l.y > -2 && l.y < 4) this.start(this.current, false);
        // a safety net under the cave
        if (P.pos.y < I.minY - 12) P.teleport(toWorld(I.frame, new THREE.Vector3(0, 0.1, 4)));
      }
    }
    if (this.phase === 'out') {
      this.t += dt;
      if (this.t >= FADE_OUT) {
        this.swap();
        this.phase = 'in';
        this.t = 0;
      }
    } else if (this.phase === 'in') {
      this.t += dt;
      if (this.t >= FADE_IN) {
        this.phase = 'idle';
        this.target = null;
      }
    }
    const o = this.phase === 'out' ? clamp(this.t / FADE_OUT, 0, 1) : this.phase === 'in' ? 1 - clamp(this.t / FADE_IN, 0, 1) : 0;
    this.fade.style.opacity = o.toFixed(3);
    this.updateLight();
  }

  /** daylight reaching in, the bright mouth seen from inside, a lamp-like glow near it */
  private updateLight() {
    const sky = G.sky, d = sky.daylight, oc = G.weather.cloud;
    const k = (0.02 + 0.6 * d) * (1 - 0.35 * oc);
    caveUniforms.uDay.value.copy(sky.fogColor).lerp(new THREE.Color(1, 1, 1), 0.45).multiplyScalar(k);
    if (!this.inside) return;
    const I = this.interiors[this.current]!;
    (I.exit.material as THREE.MeshBasicMaterial).color.copy(sky.fogColor).multiplyScalar(0.25 + 2.6 * d * (1 - 0.3 * oc) + 0.05);
    if (this.light) {
      toWorld(I.frame, new THREE.Vector3(0, 2.2, 1.8), this.light.position);
      const c = caveUniforms.uDay.value, top = Math.max(c.r, c.g, c.b, 1e-4);
      this.light.color.setRGB(c.r / top, c.g / top, c.b / top);
      this.light.intensity = 2.2 * k;
      this.light.distance = 13;
    }
    if (this.bounce) {
      const I = G.fx.spot.intensity;
      let on = false;
      if (I > 0) {
        const dir = G.camera.getWorldDirection(this.tmp), o = G.camera.position;
        const hit = G.world.castRay(new G.R.Ray({ x: o.x, y: o.y, z: o.z }, { x: dir.x, y: dir.y, z: dir.z }), 36, true,
          G.R.QueryFilterFlags.EXCLUDE_SENSORS, GROUPS_RAY, G.player.collider);
        if (hit) {
          const d = hit.timeOfImpact;
          this.bounce.position.set(o.x + dir.x * (d - 0.6), o.y + dir.y * (d - 0.6), o.z + dir.z * (d - 0.6));
          this.bounce.color.setRGB(1, 0.93, 0.84);
          this.bounce.intensity = 0.06 * I * Math.pow(Math.max(1, d), 0.7);
          this.bounce.distance = 12;
          on = true;
        }
      }
      if (!on) this.bounce.intensity = 0;
    }
  }

  /** the sky in a cave: no sun, a black short fog */
  applySky() {
    if (!this.inside) return;
    G.sky.sun.intensity = 0;
    const fog = G.scene.fog as THREE.FogExp2;
    fog.color.setRGB(0.006, 0.007, 0.009);
    fog.density = 0.028;
  }

  /** air and wind at a point inside the current cave */
  envAt(p: THREE.Vector3) {
    if (!this.inside) return null;
    const I = this.interiors[this.current]!, b = this.builds[this.current];
    const l = toLocal(I.frame, p, this.tmp);
    const depth = b.depthAt(l.x, l.y + 1, l.z);
    const k = 1 - Math.exp(-depth / 14);
    let air = lerp(G.weather.temp, Math.max(G.weather.temp, DEEP_AIR), k);
    for (const f of G.fires.list) {
      if (f.kind !== 'camp' || !f.burning) continue;
      const d = f.pos.distanceTo(p);
      if (d < 9) air += Math.min(16, f.power * 2.4) * Math.exp((-d * d) / 18);
    }
    return { air, wind: G.weather.wind * 0.35 * Math.exp(-depth / 3), depth };
  }

  /** things that fell out of a cave go back to its throat; true if the point belongs to caves */
  rescue(body: RAPIER_T.RigidBody) {
    const t = body.translation();
    if (t.x < G.region.maxX + AWAY - 400) return false;
    for (const I of this.interiors) {
      if (!I || Math.abs(t.x - I.frame.x) > STEP / 2) continue;
      if (t.y < I.minY - 10) {
        const p = toWorld(I.frame, new THREE.Vector3(0, 1, 4));
        body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    return true;
  }

  stats() {
    const I = this.inside ? this.interiors[this.current] : null;
    return { caves: this.sites.length, mouthTriangles: this.mouthTriangles, current: this.current, built: this.interiors.filter(Boolean).length,
      triangles: I?.triangles ?? 0, colliders: I?.colliders ?? 0, phase: this.phase };
  }
}
