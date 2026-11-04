// How fast things dry (or get damp) at a spot: warm dry air dries, a fire dries faster,
// frost stops it, and cold humid corners make things damp again.
import * as THREE from 'three';
import { G } from './ctx';

export interface DryState {
  /** change of moisture per game second (negative = drying) */
  rate: number;
  T: number;
  rh: number;
  why: string;
}

export function dryingAt(p: THREE.Vector3, fabric: boolean, packed: boolean): DryState {
  const inside = !!G.house.zoneAt(p);
  const sh = !inside ? G.structures?.shelterAt(p) : null;
  let T = inside ? G.thermal.tAt(p) : G.weather.temp;
  if (sh) {
    let heat = 0;
    for (const f of G.fires.list) if (f.kind === 'camp' && f.burning && G.structures.shelterAt(f.pos) === sh) heat += f.power;
    T += sh.warm + Math.min(30, heat * 2.6);
  }
  const rh = inside ? G.thermal.rhAt(p) : sh ? 0.6 : 0.85;
  const fire = G.fires.radiantAt(p, inside ? 'ground' : null);
  const k = (fabric ? 3 : 1) * (packed ? 0.3 : 1);
  if (T > 3 && rh < 0.8) {
    const rate = -((T - 3) / (20 * 3600 * 8)) * (1 + fire / 4) * (0.85 - rh) * 2 * k;
    return { rate, T, rh, why: fire > 1 ? 'сохнет у огня' : 'сохнет' };
  }
  if (inside && rh > 0.88) return { rate: ((rh - 0.88) / 3600) * 0.6 * (packed ? 0.3 : 1), T, rh, why: 'отсыревает — сыро' };
  if (T <= 0) return { rate: -1 / (3600 * 40), T, rh, why: 'на морозе почти не сохнет' };
  return { rate: 0, T, rh, why: 'не сохнет — сыро и холодно' };
}
