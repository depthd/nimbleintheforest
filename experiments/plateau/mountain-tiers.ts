import { distanceToAscent } from './mountain-snow';
import { contourPoint, plateauRadius } from './plateau-profile';
import type { MeshData } from './cavity';

export interface Tier {
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  rise: number;
  seed: number;
}

export function worldPlan(tier: Tier, x: number, z: number) {
  const c = Math.cos(tier.yaw),
    s = Math.sin(tier.yaw);
  return { x: tier.x + tier.width * (x * c + z * s), z: tier.z + tier.width * (z * c - x * s) };
}

export function localPlan(tier: Tier, x: number, z: number) {
  const dx = x - tier.x,
    dz = z - tier.z,
    c = Math.cos(tier.yaw),
    s = Math.sin(tier.yaw);
  return { x: (dx * c - dz * s) / tier.width, z: (dz * c + dx * s) / tier.width };
}

export function mountainTiers(stacked: boolean, roof: (x: number, z: number) => number) {
  const base: Tier = {
    name: 'lower',
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    width: stacked ? 1.85 : 1,
    rise: 1,
    seed: 13947,
  };
  const tiers = [base];
  if (!stacked) return tiers;
  // Offsets are expressed on the supporting terrace. Turning the next entrance
  // leaves a snowfield between the exit below and the next climb.
  for (const spec of [
    { name: 'middle', x: 120, z: 40, yaw: 0.34, width: 0.445, rise: 0.88, seed: 24586 },
    { name: 'summit', x: 95, z: 40, yaw: -2.54, width: 0.435, rise: 0.57, seed: 53103 },
  ]) {
    const parent = tiers[tiers.length - 1],
      center = worldPlan(parent, spec.x, spec.z);
    const tier = { ...spec, ...center, yaw: parent.yaw + spec.yaw, width: parent.width * spec.width, y: 0 };
    let lowest = Infinity;
    for (let i = 0; i < 72; i++)
      for (let j = 0; j <= 12; j++) {
        const p = contourPoint((2 * Math.PI * i) / 72, (1.17 * j) / 12);
        const w = worldPlan(tier, p.x, p.z),
          q = localPlan(parent, w.x, w.z);
        lowest = Math.min(lowest, roof(q.x, q.z));
      }
    tier.y = parent.y + parent.rise * lowest - 4;
    tiers.push(tier);
  }
  return tiers;
}

export function reservedForUpper(tier: Tier, child: Tier | undefined, x: number, z: number, margin: number) {
  if (!child) return false;
  const w = worldPlan(tier, x, z),
    q = localPlan(child, w.x, w.z);
  return plateauRadius(q.x, q.z) < 1.23 + (margin * tier.width) / (160 * child.width);
}

export function supportedSite(tier: Tier, parent: Tier | undefined, x: number, z: number, margin: number) {
  if (!parent) return true;
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI * k) / 4,
      w = worldPlan(tier, x + Math.cos(a) * margin, z + Math.sin(a) * margin);
    const q = localPlan(parent, w.x, w.z);
    if (plateauRadius(q.x, q.z) > 0.975 || distanceToAscent(q) < 2) return false;
  }
  return true;
}

// Only the bottom tier owns the surrounding ground plane. At upper tiers the
// retained apron ends below the supporting snowfield, including at the ramp.
export function raisedFlank(data: MeshData): MeshData {
  const positions: number[] = [],
    indices: number[] = [],
    remap = new Map<number, number>();
  for (let i = 0; i < data.indices.length; i += 3) {
    const a = data.indices[i],
      b = data.indices[i + 1],
      c = data.indices[i + 2];
    if (Math.max(data.positions[a * 3 + 1], data.positions[b * 3 + 1], data.positions[c * 3 + 1]) < 2)
      continue;
    for (const id of [a, b, c]) {
      let to = remap.get(id);
      if (to === undefined) {
        to = positions.length / 3;
        positions.push(data.positions[id * 3], data.positions[id * 3 + 1], data.positions[id * 3 + 2]);
        remap.set(id, to);
      }
      indices.push(to);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
