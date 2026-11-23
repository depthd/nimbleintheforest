import { lerp, smoothstep } from '../core/rng';
import type { Region, Site } from './region';

// Bounds in the mountain generator's own frame, including the approach to its first ramp.
const LEFT = -73, RIGHT = 170, BACK = -42, FRONT = 44;
export const MOUNTAIN_BLEND = 56;
// West, east, north and south can have different space before a shore or a landmark.
type Apron = [west: number, east: number, north: number, south: number];
type Foundation = Site & { apron?: Apron };

export function onMountainSite(site: Site, x: number, z: number, margin = 0) {
  return x >= site.x + LEFT - margin && x <= site.x + RIGHT + margin &&
    z >= site.z + BACK - margin && z <= site.z + FRONT + margin;
}

export function foundationHeight(site: Foundation, x: number, z: number, original: number) {
  const dx = x - site.x, dz = z - site.z;
  const apron = site.apron;
  const u = Math.max(LEFT - dx, dx - RIGHT, 0) / (apron?.[dx < LEFT ? 0 : 1] ?? MOUNTAIN_BLEND);
  const v = Math.max(BACK - dz, dz - FRONT, 0) / (apron?.[dz < BACK ? 2 : 3] ?? MOUNTAIN_BLEND);
  return lerp(site.y, original, smoothstep(0, 1, Math.hypot(u, v)));
}

// Score the amount of fill/cut and the grade needed to join each natural slope.
// Distance to the house breaks near-ties between equally suitable sites.
function fitHeight(r: Region, site: Foundation, apron: Apron) {
  const horizon = 40;
  let low = Infinity, high = -Infinity;
  for (let dz = BACK - horizon; dz <= FRONT + horizon; dz += 8) {
    for (let dx = LEFT - horizon; dx <= RIGHT + horizon; dx += 8) {
      const y = r.heightAt(site.x + dx, site.z + dz);
      low = Math.min(low, y);
      high = Math.max(high, y);
    }
  }
  const lowEdge: number[] = [], highEdge: number[] = [];
  for (let side = 0; side < 4; side++) {
    const acrossX = side >= 2;
    let min = Infinity, max = -Infinity;
    for (let along = acrossX ? LEFT : BACK; along <= (acrossX ? RIGHT : FRONT); along += 8) {
      for (const t of [0, .5, 1]) {
        const outward = t * apron[side];
        const dx = acrossX ? along : side === 0 ? LEFT - outward : RIGHT + outward;
        const dz = acrossX ? (side === 2 ? BACK - outward : FRONT + outward) : along;
        const y = r.heightAt(site.x + dx, site.z + dz);
        min = Math.min(min, y);
        max = Math.max(max, y);
      }
    }
    lowEdge.push(min);
    highEdge.push(max);
    low = Math.min(low, min);
    high = Math.max(high, max);
  }
  const feet = [-16, -8, 0, 4].map(z => r.heightAt(site.x + LEFT - apron[0], site.z + z));
  const reach = .35 * apron[0];
  const lowDatum = Math.max(...feet) - reach, highDatum = Math.min(...feet) + reach;
  let best = Infinity;
  for (const fraction of [.45, .55, .65]) {
    const y = Math.max(lowDatum, Math.min(highDatum, low + fraction * (high - low)));
    let grade = 0;
    for (let side = 0; side < 4; side++)
      grade = Math.max(grade, (highEdge[side] - y) / apron[side], (y - lowEdge[side]) / apron[side]);
    const relief = Math.max(high - y, y - low);
    const cost = relief + 32 * grade;
    if (cost < best) { best = cost; site.y = y; }
  }
  return best + .0015 * Math.hypot(site.x + LEFT, site.z - 8);
}

/** Select existing dry, relatively level ground. Generation of the rest of the region uses
 * its original random streams, including when a small region cannot accommodate both ridges. */
export function findMountainSite(r: Region): Site | null {
  const protectedSites = [
    { x: 0, z: 0, radius: 75 },
    ...r.places.map(p => ({ x: p.x, z: p.z, radius: Math.max(20, (p.data.half ?? p.data.clear ?? 0) + 12) })),
    ...r.caves.map(c => ({ ...c, radius: 35 })),
    ...r.pillars.map(p => ({ ...p, radius: p.r + 5 })),
  ];
  if (r.sites.tower) protectedSites.push({ ...r.sites.tower, radius: 20 });

  // A summed-area table can reject even a one-cell pond in a proposed apron in four reads.
  const n = r.n, stride = n + 1;
  const blocked = new Uint32Array(stride * stride);
  for (let j = 0; j < n; j++) {
    let row = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(r.water[j * stride + i]) || r.skin!.mask[j * n + i]) row++;
      const k = (j + 1) * stride + i + 1;
      blocked[k] = row + blocked[k - stride];
    }
  }
  function fits(site: Site, apron: Apron) {
    const [west, east, north, south] = apron;
    const left = site.x + LEFT - west, right = site.x + RIGHT + east;
    const back = site.z + BACK - north, front = site.z + FRONT + south;
    // Leave a full terrain cell on each bank untouched. Projecting rock is checked separately.
    const guard = r.cell;
    if (!r.inside(left, back, 34) || !r.inside(right, front, 34)) return false;
    const x0 = Math.floor((left + r.ox - guard) / r.cell), x1 = Math.ceil((right + r.ox + guard) / r.cell) + 1;
    const z0 = Math.floor((back + r.oz - guard) / r.cell), z1 = Math.ceil((front + r.oz + guard) / r.cell) + 1;
    if (blocked[z1 * stride + x1] - blocked[z1 * stride + x0] -
      blocked[z0 * stride + x1] + blocked[z0 * stride + x0]) return false;
    return !protectedSites.some(p => Math.hypot(
      Math.max(left - p.x, p.x - right, 0), Math.max(back - p.z, p.z - front, 0),
    ) <= p.radius);
  }

  const candidates: { site: Foundation; score: number }[] = [];
  const margin = 54;
  // Inspect the natural relief around the mountain as well as beneath it. A level patch
  // directly beside a 100 m ridge becomes a steep-sided excavation after stamping.
  for (let z = r.minZ - BACK + margin; z <= r.maxZ - FRONT - margin; z += 8) {
    for (let x = r.minX - LEFT + margin; x <= r.maxX - RIGHT - margin; x += 8) {
      const apron: Apron = [4, 4, 4, 4];
      const site: Foundation = { x, z, y: 0, apron };
      if (!fits(site, apron)) continue;
      // Expand each side as far as the *existing* shoreline and landmarks allow.
      // Water off one end need not force a short, steep transition on the other.
      for (let side = 0; side < 4; side++) {
        for (const width of [MOUNTAIN_BLEND, 40, 32, 24, 16, 10, 6]) {
          apron[side] = width;
          if (fits(site, apron)) break;
          apron[side] = 4;
        }
      }
      const score = fitHeight(r, site, apron);
      candidates.push({ site, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const { site } of candidates) {
    // The entry can occur anywhere across this corridor, depending on the mountain layout.
    const [west, east, north, south] = site.apron!;
    const rockMargin = 8;
    const i0 = Math.floor((site.x + LEFT - west - rockMargin + r.ox) / r.cell);
    const i1 = Math.ceil((site.x + RIGHT + east + rockMargin + r.ox) / r.cell);
    const j0 = Math.floor((site.z + BACK - north - rockMargin + r.oz) / r.cell);
    const j1 = Math.ceil((site.z + FRONT + south + rockMargin + r.oz) / r.cell);
    let walkable = true;
    for (let j = j0; walkable && j <= j1; j++)
      if (r.skin!.mask.subarray(j * n + i0, j * n + i1 + 1).includes(1)) walkable = false;
    for (let dz = -16; walkable && dz <= 4; dz += 1) {
      let previous: number | undefined;
      for (let dx = LEFT - Math.max(38, west + 4); dx <= LEFT; dx += r.cell) {
        const x = site.x + dx, z = site.z + dz;
        if (Number.isFinite(r.waterAt(x, z)) || r.skin!.covers(x, z)) { walkable = false; break; }
        const y = foundationHeight(site, x, z, r.heightAt(x, z));
        if (previous !== undefined && Math.abs(y - previous) > r.cell * .65) walkable = false;
        previous = y;
      }
    }
    if (walkable) return site;
  }
  return null;
}

/** Change the same height field consumed by terrain rendering, snow and Rapier. */
export function stampMountainSite(r: Region, site: Foundation) {
  const [west, east, north, south] = site.apron ?? [MOUNTAIN_BLEND, MOUNTAIN_BLEND, MOUNTAIN_BLEND, MOUNTAIN_BLEND];
  const i0 = Math.floor((site.x + LEFT - west + r.ox) / r.cell);
  const i1 = Math.ceil((site.x + RIGHT + east + r.ox) / r.cell);
  const j0 = Math.floor((site.z + BACK - north + r.oz) / r.cell);
  const j1 = Math.ceil((site.z + FRONT + south + r.oz) / r.cell);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * (r.n + 1) + i;
    r.h[k] = foundationHeight(site, i * r.cell - r.ox, j * r.cell - r.oz, r.h[k]);
  }
}
