import { lerp, smoothstep } from '../core/rng';
import type { Region, Site } from './region';

// Bounds in the mountain generator's own frame, including the approach to its first ramp.
const LEFT = -73, RIGHT = 170, BACK = -42, FRONT = 44;
export const MOUNTAIN_BLEND = 32;

/** Distance to the level part of the foundation (zero inside). */
function distance(site: Site, x: number, z: number) {
  const dx = Math.max(site.x + LEFT - x, 0, x - site.x - RIGHT);
  const dz = Math.max(site.z + BACK - z, 0, z - site.z - FRONT);
  return Math.hypot(dx, dz);
}

export function onMountainSite(site: Site, x: number, z: number, margin = 0) {
  return x >= site.x + LEFT - margin && x <= site.x + RIGHT + margin &&
    z >= site.z + BACK - margin && z <= site.z + FRONT + margin;
}

export function foundationHeight(site: Site, x: number, z: number, original: number) {
  return lerp(site.y, original, smoothstep(0, MOUNTAIN_BLEND, distance(site, x, z)));
}

/** Select existing dry, relatively level ground. Generation of the rest of the region uses
 * its original random streams, including when a small region cannot accommodate both ridges. */
export function findMountainSite(r: Region): Site | null {
  const protectedSites = [
    { x: 0, z: 0, radius: 75 },
    ...r.places.map(p => ({ x: p.x, z: p.z, radius: Math.max(24, (p.data.half ?? p.data.clear ?? 0) + 12) })),
    ...r.caves.map(c => ({ ...c, radius: 35 })),
    ...r.pillars.map(p => ({ ...p, radius: p.r + 5 })),
  ];
  if (r.sites.tower) protectedSites.push({ ...r.sites.tower, radius: 20 });

  const candidates: { site: Site; score: number }[] = [];
  // Player movement clamps to 30 m inside the map. Leave the blend and an approach beyond it.
  const margin = MOUNTAIN_BLEND + 48;
  for (let z = r.minZ - BACK + margin; z <= r.maxZ - FRONT - margin; z += 36) {
    for (let x = r.minX - LEFT + margin; x <= r.maxX - RIGHT - margin; x += 36) {
      const site = { x, z, y: r.heightAt(x + LEFT - MOUNTAIN_BLEND, z - 15) };
      if (protectedSites.some(p => distance(site, p.x, p.z) <= MOUNTAIN_BLEND + p.radius)) continue;
      // Score first, then check promising sites at the actual two-metre resolution.
      let min = site.y, max = site.y;
      for (const dz of [BACK, 0, FRONT]) for (const dx of [LEFT, 0, 85, RIGHT]) {
        const y = r.heightAt(x + dx, z + dz);
        min = Math.min(min, y);
        max = Math.max(max, y);
      }
      const fromHouse = Math.hypot(x - 65, z - 15);
      candidates.push({ site, score: max - min + fromHouse * .016 });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const { site } of candidates) {
    // Also keep the surrounding terrain clear of the edge of rock-skin collision hulls.
    const safety = MOUNTAIN_BLEND + 8;
    const i0 = Math.floor((site.x + LEFT - safety + r.ox) / r.cell);
    const i1 = Math.ceil((site.x + RIGHT + safety + r.ox) / r.cell);
    const j0 = Math.floor((site.z + BACK - safety + r.oz) / r.cell);
    const j1 = Math.ceil((site.z + FRONT + safety + r.oz) / r.cell);
    let clear = true;
    for (let j = j0; clear && j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!Number.isNaN(r.water[j * (r.n + 1) + i]) || r.skin!.mask[j * r.n + i]) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    // The final few metres of the natural approach must be walkable by the real controller.
    let previous = site.y;
    for (let dx = LEFT - MOUNTAIN_BLEND - 6; dx <= LEFT; dx += r.cell) {
      const x = site.x + dx, z = site.z - 15;
      const y = foundationHeight(site, x, z, r.heightAt(x, z));
      if (dx !== LEFT - MOUNTAIN_BLEND - 6 && Math.abs(y - previous) > r.cell * .65) clear = false;
      previous = y;
    }
    if (clear) return site;
  }
  return null;
}

/** Change the same height field consumed by terrain rendering, snow and Rapier. */
export function stampMountainSite(r: Region, site: Site) {
  const i0 = Math.floor((site.x + LEFT - MOUNTAIN_BLEND + r.ox) / r.cell);
  const i1 = Math.ceil((site.x + RIGHT + MOUNTAIN_BLEND + r.ox) / r.cell);
  const j0 = Math.floor((site.z + BACK - MOUNTAIN_BLEND + r.oz) / r.cell);
  const j1 = Math.ceil((site.z + FRONT + MOUNTAIN_BLEND + r.oz) / r.cell);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * (r.n + 1) + i;
    r.h[k] = foundationHeight(site, i * r.cell - r.ox, j * r.cell - r.oz, r.h[k]);
  }
}
