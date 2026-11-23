import * as THREE from 'three';
import { Tex } from '../../core/textures';
import { Rng, hashString } from '../../core/rng';
import type { Point, MeshData } from './geometry';

type Direction = { x: number; z: number };
type Anchor = Point & { mountainId: string; tierId: string; accessible: boolean; outward?: Direction };
type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
interface Terrain {
  seed: number;
  bridgeAnchors: readonly Anchor[];
  tiers?: readonly { id: string; mountainId: string; accessible: boolean; center: Point; bounds?: Bounds }[];
  trees: readonly (Point & { radius: number; height: number })[];
  sampleHeight(x: number, z: number): number;
}

const BEARING = 1;
const THICKNESS = .12;
const TOWER_INSET = .26;
const MAX_SPAN = 52;
const anchorKey = (a: Anchor) => `${a.tierId}:${a.x.toFixed(2)},${a.z.toFixed(2)}`;

// Sample the outward-facing lips of the actual upper surfaces. Some banks offer
// several landings; an inner terrace or a summit hidden under a higher one cannot host a deck.
function landingCandidates(terrain: Terrain) {
  const result = terrain.bridgeAnchors.filter(a => a.accessible);
  const tiers = terrain.tiers ?? [];
  for (const tier of tiers) {
    const b = tier.bounds;
    if (!tier.accessible || !b) continue;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!tiers.some(other => other.accessible && other.mountainId !== tier.mountainId &&
        (other.center.x - tier.center.x) * nx + (other.center.z - tier.center.z) * nz > 0)) continue;
      for (const fraction of [.16, .28, .42, .58, .72, .84]) {
        const x = nx === 0 ? b.minX + fraction * (b.maxX - b.minX) : nx > 0 ? b.maxX - BEARING : b.minX + BEARING;
        const z = nz === 0 ? b.minZ + fraction * (b.maxZ - b.minZ) : nz > 0 ? b.maxZ - BEARING : b.minZ + BEARING;
        const y = terrain.sampleHeight(x, z);
        if (Math.abs(y - tier.center.y) > .45 || terrain.sampleHeight(x + 3 * nx, z + 3 * nz) > y - 2) continue;
        if (result.some(a => a.tierId === tier.id && Math.hypot(a.x - x, a.z - z) < 2)) continue;
        result.push({ x, y, z, mountainId: tier.mountainId, tierId: tier.id, accessible: true, outward: { x: nx, z: nz } });
      }
    }
  }
  return result;
}

function planPair(terrain: Terrain, from: Anchor, to: Anchor, span: number) {
  const forwardX = (to.x - from.x) / span, forwardZ = (to.z - from.z) / span;
  const rng = new Rng(terrain.seed ^ hashString(`${anchorKey(from)}|${anchorKey(to)}`));
  const width = rng.float(2.22, 2.53), openSpan = span - 2 * BEARING;
  const sag = Math.min(2.75, openSpan * rng.float(.046, .068));
  function point(along: number, side = 0, lift = 0): Point {
    const t = Math.max(0, Math.min(1, (along - BEARING) / openSpan));
    // Land flat on both banks, including when the far terrace is higher.
    const ease = .16;
    const transition = t < ease ? t * t / (2 * ease) : t > 1 - ease ?
      1 - ease - (1 - t) ** 2 / (2 * ease) : t - ease / 2;
    const rise = (to.y - from.y) * transition / (1 - ease);
    const dip = sag * 16 * t * t * (1 - t) * (1 - t);
    return { x: from.x + forwardX * along - forwardZ * side,
      z: from.z + forwardZ * along + forwardX * side, y: from.y + rise + THICKNESS - dip + lift };
  }

  // Enough ledge to step off in either direction and to bear a loaded timber frame.
  for (const d of [-2.1, 0, span, span + 2.1]) {
    for (const side of [-width / 2 - .23, 0, width / 2 + .23]) {
      const p = point(d, side);
      if (Math.abs(terrain.sampleHeight(p.x, p.z) - p.y + THICKNESS) > .19) return null;
    }
  }
  for (const tree of terrain.trees) {
    const along = THREE.MathUtils.clamp((tree.x - from.x) * forwardX + (tree.z - from.z) * forwardZ, -2.35, span + 2.35);
    const p = point(along);
    if (Math.hypot(tree.x - p.x, tree.z - p.z) < Math.max(tree.radius, .24 * tree.height) + width / 2 + .35 &&
        tree.y + tree.height > p.y - THICKNESS && tree.y < p.y + 3.7) return null;
  }
  const center = point(span / 2);
  const dropAtCenter = center.y - THICKNESS - terrain.sampleHeight(center.x, center.z);
  if (!(dropAtCenter > 2.5)) return null;
  const count = Math.ceil(span / rng.float(.29, .36));
  const sections = Array.from({ length: count + 1 }, (_, i) => span * i / count);
  const route = sections.map(d => point(d));
  let freeSections = 0;
  for (let i = 0; i <= count; i++) {
    const d = sections[i];
    for (const side of [-width / 2, 0, width / 2]) {
      const p = point(d, side), gap = p.y - terrain.sampleHeight(p.x, p.z);
      if (!Number.isFinite(gap) || gap < .025) return null;
      if (side === 0 && gap > 2) freeSections++;
    }
    if (i > 0 && Math.abs(route[i].y - route[i - 1].y) > .81 * (d - sections[i - 1])) return null;
  }
  if (freeSections < count * .45) return null;

  const positions: number[] = [], indices: number[] = [];
  for (const d of sections) {
    for (const side of [-width / 2, width / 2]) {
      const p = point(d, side);
      positions.push(p.x, p.y, p.z);
    }
    const last = positions.length / 3 - 2;
    if (last) indices.push(last - 2, last - 1, last + 1, last - 2, last + 1, last);
  }
  // The rail is a narrow solid rope. A player can look between the hangers,
  // walk right up to the edge, and feel the same rail they can see.
  const bays = Math.ceil((span - 2 * TOWER_INSET) / rng.float(1.62, 2.03));
  const suspenderPositions = Array.from({ length: bays + 1 }, (_, i) => TOWER_INSET + (span - 2 * TOWER_INSET) * i / bays);
  for (const side of [-1, 1]) {
    const edge = side * (width / 2 + .04);
    const start = positions.length / 3;
    for (const d of suspenderPositions) {
      for (const [offset, lift] of [[-.036, 1.02], [0, 1.056], [.036, 1.02], [0, .984]]) {
        const p = point(d, edge + offset, lift);
        positions.push(p.x, p.y, p.z);
      }
    }
    for (let i = 0; i < bays; i++) for (let face = 0; face < 4; face++) {
      const a = start + 4 * i + face, b = start + 4 * i + (face + 1) % 4;
      indices.push(a, b, a + 4, b, b + 4, a + 4);
    }
  }
  const collider: MeshData = { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
  return { from, to, span, width, sag, dropAtCenter, point, sections, route, collider, suspenderPositions };
}

export function planMountainBridge(terrain: Terrain) {
  const candidates = landingCandidates(terrain);
  const pairs: { from: Anchor; to: Anchor; span: number; priority: number }[] = [];
  const elevated = new Rng(terrain.seed ^ hashString('high crossing')).chance(.53);
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    const from = candidates[i], to = candidates[j];
    if (from.mountainId === to.mountainId) continue;
    const dx = to.x - from.x, dz = to.z - from.z, span = Math.hypot(dx, dz);
    if (span < 11 || span > MAX_SPAN || Math.abs(from.y - to.y) / span > .50) continue;
    if (from.outward && (dx * from.outward.x + dz * from.outward.z) / span < .78) continue;
    if (to.outward && -(dx * to.outward.x + dz * to.outward.z) / span < .78) continue;
    const rng = new Rng(terrain.seed ^ hashString(`crossing ${anchorKey(from)} ${anchorKey(to)}`));
    const priority = rng.next() + (elevated && Math.abs(from.y - to.y) > 1.5 ? 1 : 0);
    pairs.push({ from, to, span, priority });
  }
  // Only the first viable crossing is built. Ranking first keeps the expensive
  // terrain-width checks off the vast majority of pairs.
  pairs.sort((a, b) => b.priority - a.priority);
  for (const pair of pairs) {
    const plan = planPair(terrain, pair.from, pair.to, pair.span);
    if (plan) return plan;
  }
  return null;
}

type BridgePlan = NonNullable<ReturnType<typeof planMountainBridge>>;
type Instance = { matrix: THREE.Matrix4; color?: THREE.Color };
const up = new THREE.Vector3(0, 1, 0);
function timber(a: Point, b: Point, radius: number): Instance {
  const axis = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  const size = new THREE.Vector3(radius, axis.length(), radius);
  const rotation = new THREE.Quaternion().setFromUnitVectors(up, axis.normalize());
  return { matrix: new THREE.Matrix4().compose(new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), rotation, size) };
}

// Weathered split pine, with the exposed latewood grain curving round two knots.
// The grain runs along a single tread; the individual planks provide the seams.
function plankTexture() {
  const w = 128, h = 32, data = new Uint8Array(w * h * 4);
  const rng = new Rng(0xc4b11);
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    let grain = z + .8 * Math.sin(x * .041 + z * .22), knot = 0;
    for (const [kx, kz] of [[31, 12], [101, 24]]) {
      const dx = (x - kx) / 12, dz = (z - kz) / 3.8;
      const radius = Math.hypot(dx, dz);
      grain += 2.6 * Math.sign(dz) * Math.exp(-radius * radius * .44);
      knot += Math.max(0, 1 - radius) * (15 + 10 * Math.cos(radius * 15));
    }
    const darkGrain = Math.max(0, Math.cos(grain * 1.48)) ** 7;
    const shade = 7 * Math.sin(grain * .53) - 21 * darkGrain + rng.float(-7, 7) - knot;
    const i = (z * w + x) * 4;
    data[i] = 158 + shade; data[i + 1] = 141 + shade; data[i + 2] = 121 + shade;
    data[i + 3] = 255;
  }
  const map = new THREE.DataTexture(data, w, h);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

function ropeTexture() {
  const w = 24, h = 96, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const strand = Math.cos(2 * Math.PI * (3 * x / w - 9 * y / h));
    const fibre = Math.cos(2 * Math.PI * (8 * x / w + 13 * y / h));
    const shade = 12 * strand - 11 * Math.max(0, -strand) ** 4 + fibre * 3;
    const i = (y * w + x) * 4;
    data[i] = 142 + shade; data[i + 1] = 118 + shade; data[i + 2] = 87 + shade; data[i + 3] = 255;
  }
  const map = new THREE.DataTexture(data, w, h);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = map.needsUpdate = true;
  return map;
}

// Wind feathers the inner edge. Adjacent treads remain visibly separate beneath the snow.
function snowLip() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -.50, -.3, -.48, -.49, .34, -.24, -.48, .46, .33, -.48, -.3, .49,
    .29, -.3, .49, .48, -.3, .14, .41, -.3, -.46,
    -.14, .61, -.09, -.10, .55, .25,
  ], 3));
  g.setIndex([0, 1, 7, 0, 7, 6, 1, 2, 7, 2, 8, 7, 2, 3, 8, 3, 4, 8, 4, 5, 8, 5, 7, 8, 5, 6, 7]);
  g.computeVertexNormals();
  return g;
}

function renderBridge(plan: BridgePlan, seed: number) {
  const { point, span, width, sections } = plan;
  const rng = new Rng(seed ^ hashString(anchorKey(plan.from) + ' decking'));
  const group = new THREE.Group();
  group.name = 'suspension-bridge';
  const wood = new THREE.MeshStandardMaterial({ map: plankTexture(), color: 0xf1eada, roughness: 1 });
  const logs = new THREE.MeshStandardMaterial({ map: Tex.barkDead(), color: 0xe3d6c4, roughness: 1, flatShading: true });
  const fibre = new THREE.MeshStandardMaterial({ map: ropeTexture(), color: 0xe7d8c1, roughness: 1 });
  const binding = new THREE.MeshStandardMaterial({ color: 0xae9573, roughness: 1, flatShading: true });
  const snow = new THREE.MeshStandardMaterial({ color: 0xd9e1e5, roughness: 1, side: THREE.DoubleSide });
  const poles: Instance[] = [], cables: Instance[] = [], wraps: Instance[] = [], decking: Instance[] = [], frost: Instance[] = [];
  const across = new THREE.Vector3(-(plan.to.z - plan.from.z) / span, 0, (plan.to.x - plan.from.x) / span);
  const local = new THREE.Object3D();
  const half = width / 2, tower = rng.float(3.25, 3.65);
  const dark = new THREE.Color(0xb9aa98), light = new THREE.Color(0xf2eadf);
  const board = new THREE.BoxGeometry(1, 1, 1);
  const driftPhase = rng.float(-Math.PI, Math.PI);
  for (let i = 1; i < sections.length; i++) {
    const a = point(sections[i - 1]), b = point(sections[i]);
    const tangent = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    const length = tangent.length();
    tangent.normalize();
    const normal = new THREE.Vector3().crossVectors(across, tangent).normalize();
    local.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, normal, tangent.clone().negate()));
    const middle = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    local.position.copy(middle).addScaledVector(normal, -THICKNESS / 2).addScaledVector(across, rng.float(-.028, .028));
    local.scale.set(width + rng.float(.035, .13), THICKNESS, length - rng.float(.010, .022));
    local.updateMatrix();
    decking.push({ matrix: local.matrix.clone(), color: dark.clone().lerp(light, rng.float(.05, .96)) });
    // Loose powder clings along the outer boards, leaving a worn wooden footway.
    for (const side of [-1, 1]) {
      const drift = .44 * Math.cos(i * .13 + driftPhase + side * 1.8) +
        .18 * Math.sin(i * .41 + side) + (side < 0 ? .47 : .08);
      if (drift < .15 || !rng.chance(.94)) continue;
      const strip = .06 + .3 * drift * rng.float(.79, 1.08);
      local.position.copy(middle).addScaledVector(normal, .013).addScaledVector(across, side * (half - strip / 2));
      if (side > 0) local.rotateY(Math.PI);
      local.scale.set(strip, .037, length - .025);
      local.updateMatrix();
      frost.push({ matrix: local.matrix.clone() });
    }
  }

  const towerD = TOWER_INSET;
  for (const end of [0, span]) {
    const sign = end === 0 ? 1 : -1;
    const d = end + sign * towerD, back = end - sign * 2;
    for (const side of [-1, 1]) {
      const rail = side * (half + .04);
      poles.push(timber(point(d, rail + side * .22, -.37), point(d, rail, tower + .21), .165));
      const stake = point(back, rail + side * .18, .34);
      poles.push(timber(point(back, rail + side * .18, -.55), stake, .13));
      cables.push(timber(point(d, rail, tower), stake, .064));
      poles.push(timber(point(end - sign * 1.28, rail + side * .17, -.14), point(d, rail + side * .09, 1.78), .115));
      for (const h of [tower - .17, tower - .08, tower + .01, .94, 1.03]) {
        const offset = side * .22 * (tower + .21 - h) / (tower + .58);
        wraps.push(timber(point(d, rail + offset, h), point(d, rail + offset, h + .06), .18));
      }
      wraps.push(timber(point(back, rail + side * .18, .18), stake, .142));
    }
    poles.push(timber(point(d, -half - .37, tower - .09), point(d, half + .37, tower - .09), .16));
    for (const side of [-1, 1]) {
      poles.push(timber(point(d, side * (half + .12), tower - .91), point(d, side * (half - .42), tower - .1), .075));
    }
  }
  const bays = plan.suspenderPositions.length - 1;
  for (const side of [-1, 1]) {
    const edge = side * (half + .04);
    let previous: { main: Point; rail: Point; bottom: Point } | undefined;
    for (let i = 0; i <= bays; i++) {
      const t = i / bays, d = plan.suspenderPositions[i];
      // The thinner guard rope follows the deck; the load cable hangs from the towers.
      const height = 1.18 + (tower - 1.18) * (1 - 2 * t) ** 2;
      const main = point(d, edge, height), rail = point(d, edge, 1.02), bottom = point(d, edge * .89, -.16);
      if (previous) {
        cables.push(timber(previous.main, main, .062), timber(previous.rail, rail, .036), timber(previous.bottom, bottom, .066));
      }
      if (i > 0 && i < bays) {
        cables.push(timber(bottom, main, .033));
        wraps.push(timber(point(d, edge, height - .08), point(d, edge, height + .035), .067));
        if (side === -1) poles.push(timber(point(d, -half - .12, -.17), point(d, half + .12, -.17), .087));
      }
      previous = { main, rail, bottom };
    }
  }

  function add(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, parts: Instance[]) {
    if (!parts.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
    mesh.name = name;
    parts.forEach((part, i) => {
      mesh.setMatrixAt(i, part.matrix);
      if (part.color) mesh.setColorAt(i, part.color);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 7);
  add('transverse-planks', board, wood, decking);
  add('bank-frames-and-deck-bearers', cylinder, logs, poles);
  add('suspension-cables-and-hangers', cylinder, fibre, cables);
  add('rope-lashings', cylinder, binding, wraps);
  add('snow-on-board-ends', snowLip(), snow, frost);
  return group;
}

export function buildMountainBridge(terrain: Terrain) {
  const plan = planMountainBridge(terrain);
  return plan ? { ...plan, group: renderBridge(plan, terrain.seed) } : null;
}
