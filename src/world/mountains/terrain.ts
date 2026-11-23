// Two neighbouring mountain terraces and the ground routes that connect their different levels.
import { Rng, hashString, smoothstep } from '../../core/rng';
import type { MeshData } from './geometry';
import { buildContourShelf, shelfOwnsNorthWall } from './contour-shelf';
import { planMountainLayout, type Box, type MountainId, type Entry, type EntrySide } from './layout';
import type { PassageAnchors } from './passages';
import { cliffLevels, cliffPoint, edgeInsets, peakHeight, rimRelief } from './rock-form';

export type MountainPoint = { x: number; y: number; z: number };
export type { MountainId, Entry } from './layout';
export type MountainTier = {
  id: string;
  mountainId: MountainId;
  level: number;
  accessible: boolean;
  kind: 'plateau' | 'peak';
  center: MountainPoint;
  entry: Entry;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  entrySide: EntrySide;
};
export type MountainRoute = { from: string; to: string; kind: 'wide' | 'cut' | 'terrace' | 'shelf'; points: MountainPoint[] };
export type MountainTree = MountainPoint & { height: number; radius: number; tierId: string };
export type BridgeAnchor = MountainPoint & { mountainId: MountainId; tierId: string; accessible: boolean; outward: { x: number; z: number }; island: boolean };
type Surface = Box & {
  tier: MountainTier;
  entrySide: EntrySide;
  passages: PassageAnchors;
  length: number;
  width: number;
  bend: number;
  startZ: number;
  secondCutZ?: number;
  phase: number;
};
const pt = (x: number, y: number, z: number): MountainPoint => ({ x, y, z });
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const distance = (a: MountainPoint, b: MountainPoint) => Math.hypot(a.x - b.x, a.z - b.z);

function rampFraction(s: Surface, x: number) {
  return clamp((s.entrySide === 'west' ? x - s.left : s.right - x) / s.length);
}

function rampZ(s: Surface, x: number, startZ = s.startZ) {
  const bend = startZ === s.startZ ? s.bend : -.7 * s.bend;
  return startZ + bend * Math.sin(Math.PI * rampFraction(s, x));
}

// Round the short sides without cutting into reserved landings on the straight edges.
function inset(s: Box, x: number) {
  const r = Math.min(12, (s.front - s.back) * 0.19, (s.right - s.left) * 0.16);
  const dx = Math.max(0, r - Math.min(x - s.left, s.right - x));
  return r - Math.sqrt(Math.max(0, r * r - dx * dx));
}
// On the windward shoulder the deposit thickens into a rounded cornice. It
// tapers out before the rope and cave, leaving their original landings open.
function corniceDepth(s: Surface, x: number) {
  if (s.tier.id !== 'main-1' || x <= -48 || x >= -10) return 0;
  const ends = smoothstep(-48, -40, x) * (1 - smoothstep(-19, -10, x));
  return ends * (.62 + .17 * Math.cos(x * .21 + s.phase));
}

function surfaceY(s: Surface, x: number, z: number) {
  const rise = s.top - s.bottom;
  if (s.tier.kind === 'peak') return peakHeight(s, x, z);
  const t = rampFraction(s, x);
  // Continuous tangent at foot and crest. The entire west side blends in wide mode.
  const ramp = s.bottom + rise * smoothstep(0, 1, t);
  const fromCut = Math.min(Math.abs(z - rampZ(s, x)),
    s.secondCutZ === undefined ? Infinity : Math.abs(z - rampZ(s, x, s.secondCutZ)));
  const band =
    s.tier.entry === 'none'
      ? 1
      : s.tier.entry === 'wide'
        ? 0
        : smoothstep(s.width * 0.5, s.width * 0.5 + 1.6, fromCut);
  const y = ramp + (s.top - ramp) * band;
  const brokenRim = rimRelief(s, x, z);
  if (s.tier.level !== 1) return y + brokenRim;
  // Soft terrain folds in the outer snowfield. Bridge, rope, cave and ascent
  // landings sit on their original datum; the upper tier has continuous support.
  const outer = smoothstep(0.72, 0.94, Math.abs((2 * z - s.front - s.back) / (s.front - s.back)));
  const side = smoothstep(27, 45, Math.abs(x - (s.left + s.right) * 0.5));
  const fold = 0.34 * (1 + Math.sin(0.21 * x + s.phase) * Math.cos(0.16 * z - s.phase));
  const drift = corniceDepth(s, x) * smoothstep(s.front - 4, s.front, z);
  return y + outer * side * fold * smoothstep(0.84, 1, t) + drift + brokenRim;
}
class TriangleBuffer {
  xyz: number[] = [];
  indices: number[] = [];
  vertex(p: MountainPoint) {
    this.xyz.push(p.x, p.y, p.z);
    return this.xyz.length / 3 - 1;
  }
  quad(a: MountainPoint, b: MountainPoint, c: MountainPoint, d: MountainPoint) {
    const i = this.vertex(a);
    this.vertex(b);
    this.vertex(c);
    this.vertex(d);
    this.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  bareSummits: [number, number][] = [];
  finish(): MeshData {
    const data: MeshData = { positions: new Float32Array(this.xyz), indices: new Uint32Array(this.indices) };
    if (this.bareSummits.length) {
      data.exposure = new Float32Array(this.xyz.length / 3).fill(1);
      for (const [from, to] of this.bareSummits) data.exposure.fill(0, from, to);
    }
    return data;
  }
}
function gridShape(s: Surface) {
  if (s.tier.kind === 'peak') return { nx: 8, nz: 8 };
  // Short upper gullies need enough samples across the tread and the bend
  // for the physical triangle surface to follow the planned walking line.
  const cell = s.tier.level >= 3 && s.tier.entry === 'cut' ? 1 : 2;
  return { nx: Math.ceil((s.right - s.left) / cell), nz: Math.ceil((s.front - s.back) / cell) };
}
function node(s: Surface, ix: number, iz: number, nx: number, nz: number) {
  const x = s.left + ((s.right - s.left) * ix) / nx,
    edge = edgeInsets(s, x, inset(s, x));
  const z0 = s.back + ((s.front - s.back) * iz) / nz;
  const roundingBand = Math.min(13, (s.front - s.back) * 0.22, (s.right - s.left) * 0.2);
  const z = z0 + edge.back * clamp(1 - (z0 - s.back) / roundingBand)
    - edge.front * clamp(1 - (s.front - z0) / roundingBand);
  return pt(x, surfaceY(s, x, z), z);
}
function roofHole(s: Surface, x: number, z: number) {
  const a = s.passages;
  return s.tier.id === 'main-2' && Math.abs(x - a.throughUpper.x) < a.halfWidth &&
    z > a.throughUpper.z && z < a.throughSkylightStartZ;
}
function bakeSurface(s: Surface, rock: TriangleBuffer, snow: TriangleBuffer) {
  const { nx, nz } = gridShape(s);
  const top = s.tier.kind === 'peak' ? rock : snow;
  const start = top.xyz.length / 3;
  // Indexed tops share edges with the boundary wall and have upward-facing winding.
  const grid: MountainPoint[] = [];
  for (let ix = 0; ix <= nx; ix++)
    for (let iz = 0; iz <= nz; iz++) {
      const p = node(s, ix, iz, nx, nz);
      grid.push(p);
      top.vertex(p);
    }
  const at = (ix: number, iz: number) => ix * (nz + 1) + iz;
  const bankVertices = new Map<number, number>();
  function face(i: number, j: number, k: number) {
    const a = grid[i],
      b = grid[j],
      c = grid[k];
    const ux = b.x - a.x,
      uy = b.y - a.y,
      uz = b.z - a.z;
    const vx = c.x - a.x,
      vy = c.y - a.y,
      vz = c.z - a.z;
    const normalY = uz * vx - ux * vz;
    // Exposed ribs break through the snowy rim. The safe centre of the walking terrace stays snow.
    const slope = Math.hypot(uy * vz - uz * vy, ux * vy - uy * vx) / normalY;
    const relief = Math.max(a.y,b.y,c.y) - s.top;
    const rib = top === snow && relief > .7 && (slope > .42 || relief > 2.0);
    // The steep cut exposes bedrock. Keep its drivable floor on the snow mesh.
    if (rib || (s.tier.entry === 'cut' && slope > 1.45)) {
      for (const index of [i, j, k]) {
        let vertex = bankVertices.get(index);
        if (vertex === undefined) {
          vertex = rock.vertex(grid[index]);
          bankVertices.set(index, vertex);
        }
        rock.indices.push(vertex);
      }
    } else {
      top.indices.push(start + i, start + j, start + k);
    }
  }
  for (let ix = 0; ix < nx; ix++)
    for (let iz = 0; iz < nz; iz++) {
      const a = at(ix, iz),
        b = at(ix, iz + 1),
        c = at(ix + 1, iz + 1),
        d = at(ix + 1, iz);
      if (!roofHole(s, (grid[a].x + grid[c].x) / 2, (grid[a].z + grid[c].z) / 2)) {
        face(a, b, c);
        face(a, c, d);
      }
    }
  function side(a: MountainPoint, b: MountainPoint, south = false) {
    const mid = (a.x + b.x) * 0.5;
    const door =
      south &&
      ((s.tier.id === 'main-1' && Math.abs(mid - s.passages.denMouth.x) < s.passages.halfWidth) ||
        (s.tier.id === 'main-2' && Math.abs(mid - s.passages.throughLower.x) < s.passages.halfWidth));
    const base = s.bottom + (door ? 4 : 0);
    if (Math.max(a.y, b.y) <= base + 0.0001) return;
    let lowerA = pt(a.x, base, a.z), lowerB = pt(b.x, base, b.z);
    for (const level of cliffLevels) {
      const upperA = cliffPoint(s,a,level), upperB = cliffPoint(s,b,level);
      if (upperA.y < base && upperB.y < base) continue;
      if (level > 0) rock.quad(upperB, upperA, lowerA, lowerB);
      lowerA=upperA; lowerB=upperB;
    }
  }
  // A closed rounded lip with a tighter lower radius follows the actual snow
  // edge. The shared top vertices keep both the light and the collider continuous.
  // This is the F snow profile reduced to walking scale.
  if (s.tier.id === 'main-1') {
    let previous: number[] | undefined;
    for (let ix = 0; ix <= nx; ix++) {
      const id = at(ix, nz), edge = grid[id], h = corniceDepth(s, edge.x);
      if (edge.x < -48 || edge.x > -10) continue;
      const row = [start + id];
      const tip = h * .8, lower = h * .2;
      function add(out: number, down: number) {
        row.push(h === 0 ? start + id : top.vertex(pt(edge.x, edge.y - down, edge.z + out)));
      }
      for (let i = 1; i <= 5; i++) {
        const angle = i * Math.PI / 10;
        add(tip * Math.sin(angle), tip * (1 - Math.cos(angle)));
      }
      for (let i = 1; i <= 3; i++) {
        const angle = i * Math.PI / 6;
        add(tip - lower + lower * Math.cos(angle), tip + lower * Math.sin(angle));
      }
      add(0, h + .02);
      if (previous) for (let j = 1; j < row.length; j++) {
        const a = previous[j - 1], b = previous[j], c = row[j], d = row[j - 1];
        if (a !== b) top.indices.push(a, b, c);
        if (c !== d) top.indices.push(a, c, d);
      }
      previous = row;
    }
  }
  // Winding faces outward. Doorways retain their stone lintels.
  for (let ix = 0; ix < nx; ix++) {
    side(grid[at(ix, nz)], grid[at(ix + 1, nz)], true);
    const north = grid[at(ix, 0)], next = grid[at(ix + 1, 0)];
    if (s.tier.id !== 'main-1' || !shelfOwnsNorthWall((north.x + next.x) / 2)) side(next, north);
  }
  for (let iz = 0; iz < nz; iz++) {
    side(grid[at(0, iz)], grid[at(0, iz + 1)]);
    side(grid[at(nx, iz + 1)], grid[at(nx, iz)]);
  }
  if (s.tier.kind === 'peak') rock.bareSummits.push([start, rock.xyz.length / 3]);
}
// Locate the cell in the same rounded grid used for the triangle mesh, then
// interpolate the actual triangle. This also reports open skylights to callers.
function sampleSurface(s: Surface, x: number, z: number): number | undefined {
  if (x < s.left || x > s.right || z < s.back || z > s.front || roofHole(s, x, z)) return;
  const { nx, nz } = gridShape(s),
    fx = ((x - s.left) / (s.right - s.left)) * nx,
    ix = Math.min(nx - 1, Math.floor(fx));
  const tx = fx - ix,
    p0 = node(s, ix, 0, nx, nz),
    p1 = node(s, ix + 1, 0, nx, nz);
  const back = p0.z + (p1.z - p0.z) * tx,
    upper0 = node(s, ix, nz, nx, nz), upper1 = node(s, ix + 1, nz, nx, nz),
    front = upper0.z + (upper1.z - upper0.z) * tx;
  if (z < back - 1e-7 || z > front + 1e-7) return;
  let lo = 0,
    hi = nz;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1,
      left = node(s, ix, mid, nx, nz).z,
      right = node(s, ix + 1, mid, nx, nz).z;
    if (left + (right - left) * tx <= z) lo = mid;
    else hi = mid;
  }
  const iz = lo;
  const a = node(s, ix, iz, nx, nz),
    b = node(s, ix, iz + 1, nx, nz);
  const c = node(s, ix + 1, iz + 1, nx, nz),
    d = node(s, ix + 1, iz, nx, nz);
  const diagonal = a.z + tx * (c.z - a.z);
  return z >= diagonal
    ? a.y + tx * (c.y - a.y) + ((z - diagonal) * (b.y - a.y)) / (b.z - a.z)
    : a.y + tx * (c.y - a.y) + ((z - diagonal) * (c.y - d.y)) / (c.z - d.z);
}
export function generateMountainTerrain(seed: number) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError('terrain seed must be a uint32');
  const rng = new Rng(seed),
    surfaces: Surface[] = [],
    routes: MountainRoute[] = [];
  const { tiers, passageAnchors, spawn, bridgeZ } = planMountainLayout(seed);
  for (const spec of tiers) {
    const { mountain: id, level, entry, entrySide, startZ, length, width, peak } = spec;
    let box: Box = spec;
    if (peak) {
      // A high narrow summit rises from the previous terrace. The three-metre
      // vertical toe precludes reaching its upper slopes from that terrace.
      const cx = (box.left + box.right) / 2,
        cz = (box.front + box.back) / 2;
      const h = box.top - box.bottom,
        halfX = Math.min((box.right - box.left) / 2, h * 0.57),
        halfZ = Math.min((box.front - box.back) / 2, h * 0.54);
      box = {
        ...box,
        left: cx - halfX,
        right: cx + halfX,
        back: cz - halfZ,
        front: cz + halfZ,
        top: box.top + h * 0.46,
      };
    }
    const center = pt((box.left + box.right) / 2, box.top, (box.front + box.back) / 2);
    const tier: MountainTier = {
      id: id + '-' + level,
      mountainId: id,
      level,
      accessible: !peak,
      kind: peak ? 'peak' : 'plateau',
      center,
      entry: peak ? 'none' : entry, entrySide,
      bounds: { minX: box.left, maxX: box.right, minZ: box.back, maxZ: box.front },
    };
    const s: Surface = {
      ...box,
      tier, entrySide, passages: passageAnchors, secondCutZ: spec.secondCutZ,
      startZ,
      length,
      width,
      bend: entry === 'cut' ? rng.float(-3, 3) * Math.min(1, length / 18) : 0,
      phase: rng.float(-Math.PI, Math.PI),
    };
    surfaces.push(s);
    if (peak || entry === 'none') continue;
    for (const centerZ of spec.secondCutZ === undefined ? [startZ] : [startZ, spec.secondCutZ]) {
      const points: MountainPoint[] = [];
      for (let i = 0; i <= 20; i++) {
        const x = entrySide === 'west' ? box.left + (s.length * i) / 20 : box.right - (s.length * i) / 20;
        const z = rampZ(s, x, centerZ);
        points.push(pt(x, sampleSurface(s, x, z) ?? surfaceY(s, x, z), z));
      }
      routes.push({ from: level === 1 ? 'spawn' : id + '-' + (level - 1), to: tier.id, kind: entry, points });
    }
  }
  const rock = new TriangleBuffer(),
    snow = new TriangleBuffer();
  for (const s of surfaces) bakeSurface(s, rock, snow);
  const mainBase = surfaces[0];
  const shelf = buildContourShelf(x => {
    const z = mainBase.back + edgeInsets(mainBase, x, inset(mainBase,x)).back;
    return pt(x, surfaceY(mainBase, x, z), z);
  }, mainBase.phase, rock, snow);
  routes.push({ from: 'spawn', to: 'main-1', kind: 'shelf', points: shelf.points });
  const sampleHeight = (x: number, z: number) =>
    surfaces.reduce((h, s) => Math.max(h, sampleSurface(s, x, z) ?? 0), shelf.sample(x, z));
  const satelliteBase = surfaces.find((s) => s.tier.id === 'satellite-1')!;
  const bridgeAnchors: BridgeAnchor[] = [];
  for (const offset of [0, -10, 10]) for (const surface of [mainBase, satelliteBase, ...surfaces.filter(s => s.tier.level === 2)]) {
    if (!surface.tier.accessible) continue;
    const main = surface.tier.mountainId === 'main';
    if (surface.tier.level > 1 && (main ? surface.right !== mainBase.right : surface.left !== satelliteBase.left)) continue;
    const x = main ? surface.right - 1 : surface.left + 1, z = bridgeZ + offset;
    const y = sampleSurface(surface, x, z);
    if (y === undefined || Math.abs(y - surface.top) > .1 || Math.abs(sampleHeight(x,z) - y) > .1) continue;
    bridgeAnchors.push({ x, y, z, mountainId: surface.tier.mountainId, tierId: surface.tier.id, accessible: true,
      outward: { x: main ? 1 : -1, z: 0 }, island: !main && satelliteBase.tier.entry === 'none' });
  }
  const trees: MountainTree[] = [];
  for (const s of surfaces) {
    if (s.tier.kind === 'peak') continue;
    const n = Math.max(2, Math.round(((s.right - s.left) * (s.front - s.back)) / 320));
    let nPlaced = 0;
    function tryTree(x: number, z: number, heights: Rng) {
      const h = sampleSurface(s, x, z);
      if (h === undefined || h < s.bottom + .75 * (s.top - s.bottom) || Math.abs(sampleHeight(x, z) - h) > .06) return;
      const supports = [sampleSurface(s, x - .65, z), sampleSurface(s, x + .65, z),
        sampleSurface(s, x, z - .65), sampleSurface(s, x, z + .65)];
      if (supports.some(y => y === undefined || Math.abs(y - h) > .38)) return;
      if (
        surfaces.some(
          (other) =>
            other.tier.mountainId === s.tier.mountainId &&
            other.tier.level > s.tier.level &&
            x > other.left - 3 &&
            x < other.right + 3 &&
            z > other.back - 3 &&
            z < other.front + 3,
        )
      )
        return;
      const { ropeUpper, throughUpper, throughLower } = passageAnchors;
      if ((Math.abs(x - throughUpper.x) < 5 && z >= throughUpper.z - 4 && z <= ropeUpper.z + 2) ||
          (Math.abs(z - ropeUpper.z) < 3.5 && x >= Math.min(ropeUpper.x, throughLower.x) - 4 &&
          x <= Math.max(ropeUpper.x, throughLower.x) + 4)) return;
      if (bridgeAnchors.some(a => Math.abs(a.y - h) < 2 && Math.abs(x - a.x) < 7 && Math.abs(z - a.z) < 3.5)) return;
      if (routes.some((r) => r.points.some((p) => Math.hypot(x - p.x, z - p.z) < 4))) return;
      const connectors = routes.filter((r) => r.from === s.tier.id);
      const arrival = routes.find((r) => r.to === s.tier.id)?.points.at(-1) ?? bridgeAnchors.find(a => a.tierId === s.tier.id) ?? s.tier.center;
      if (
        connectors.some((r) => {
          const start = r.points[0],
            dx = start.x - arrival.x,
            dz = start.z - arrival.z;
          const t = clamp(((x - arrival.x) * dx + (z - arrival.z) * dz) / (dx * dx + dz * dz || 1));
          return Math.hypot(x - arrival.x - t * dx, z - arrival.z - t * dz) < 3;
        })
      )
        return;
      const p = pt(x, h, z);
      if (trees.some((t) => distance(t, p) < 3)) return;
      trees.push({ ...p, height: heights.float(2.4, 5.8), radius: 0.23, tierId: s.tier.id });
      nPlaced++;
    }
    for (let i = 0; i < n * 24 && nPlaced < n; i++)
      tryTree(rng.float(s.left + 2, s.right - 2), rng.float(s.back + 2, s.front - 2), rng);
    // On a small shelf a random scatter can miss the remaining free strip.
    // Fill from a deterministic grid using its own heights stream.
    if (nPlaced < n) {
      const fillRng = new Rng(seed ^ hashString(s.tier.id + '-forest'));
      for (let x = s.left + 1.5; x < s.right - 1 && nPlaced < n; x += 1)
        for (let z = s.back + 1.5; z < s.front - 1 && nPlaced < n; z += 1) tryTree(x, z, fillRng);
    }
  }
  return {
    seed,
    spawn,
    tiers: surfaces.map((s) => s.tier),
    routes,
    bridgeAnchors,
    passageAnchors,
    sampleHeight,
    trees,
    rock: rock.finish(),
    snow: snow.finish(),
  };
}
export type MountainTerrain = ReturnType<typeof generateMountainTerrain>;
