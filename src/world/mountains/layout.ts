import { Rng, hashString } from '../../core/rng';
import type { Point } from './geometry';
import type { PassageAnchors } from './passages';

export type MountainId = 'main' | 'satellite';
export type Entry = 'wide' | 'cut' | 'none';
export type EntrySide = 'west' | 'east';
export interface Box { left: number; right: number; back: number; front: number; bottom: number; top: number }
export interface TierPlan extends Box {
  mountain: MountainId;
  level: number;
  entry: Entry;
  entrySide: EntrySide;
  startZ: number;
  length: number;
  width: number;
  peak: boolean;
}
const point = (x: number, y: number, z: number): Point => ({ x, y, z });
const box = (left: number, right: number, back: number, front: number, bottom: number, top: number): Box =>
  ({ left, right, back, front, bottom, top });

/** Each child stands on the gentle part of its parent. Portal edges coincide
 * with two-metre mesh vertices, including the opening above the tunnel. */
export function planMountainLayout(seed: number) {
  const rng = new Rng(seed ^ hashString('mountain-topology'));
  const tiers: TierPlan[] = [];
  const even = (lo: number, hi: number) => 2 * rng.int(lo / 2, hi / 2);
  const entrance = (): Entry => rng.chance(.5) ? 'wide' : 'cut';
  const add = (mountain: MountainId, level: number, b: Box, entry: Entry, entrySide: EntrySide,
    startZ: number, length: number, width: number, peak = false) => {
    const tier = { ...b, mountain, level, entry: peak ? 'none' as const : entry, entrySide, startZ, length, width, peak };
    tiers.push(tier);
    return tier;
  };

  const mainCount = rng.int(2, 4), satelliteCount = rng.int(1, 4);
  const mainEntry = entrance(), firstZ = even(-22, -8);
  const main = add('main', 1, box(-60, 60, -34, 34, 0, 14), mainEntry, 'west',
    firstZ, even(38, 44), rng.float(5.2, 7.8));
  const highBank = rng.int(0, 2); // a stepped bank on either shore, or two low banks
  const left = even(-8, -4), right = highBank === 1 ? main.right : even(42, 50);
  const side: EntrySide = highBank === 1 || rng.chance(.58) ? 'west' : 'east';
  const second = add('main', 2, box(left, right, even(-26, -22), even(12, 18), main.top, main.top + even(6, 10)),
    entrance(), side, even(-18, -10), 20, rng.float(4.2, 6.0));
  // This x column is clear of the ascending side, leaving a solid roof over
  // the mouth and full-height shoulders on both sides of the upper opening.
  const throughX = side === 'west' ? even(20, 26) + 1 : even(4, 10) + 1;
  const skylight = second.front - even(10, 14), upperZ = skylight - even(8, 10);
  const denX = even(6, 30) + 1, denDepth = even(10, 18);
  const ropeX = denX < 18 ? even(20, 26) : even(-6, 6);
  const passageAnchors: PassageAnchors = {
    throughLower: point(throughX, second.bottom, second.front),
    throughUpper: point(throughX, second.top, upperZ),
    throughSkylightStartZ: skylight,
    denMouth: point(denX, 0, main.front), denBack: point(denX, 0, main.front - denDepth),
    halfWidth: 3, height: 4,
    ropeLower: point(ropeX, 0, main.front + 1.1), ropeUpper: point(ropeX, main.top, main.front - 1.4),
  };

  if (mainCount >= 3) {
    // The high terrace occupies the back of the parent, leaving its cave and
    // landing clear. On a four-tier mountain this is the last inhabited shelf.
    const l = side === 'west' ? left + 22 : left + 2;
    const r = side === 'west' ? right - 2 : right - 22;
    const b = second.back + 1, f = Math.min(upperZ - 2, b + 16);
    const third = add('main', 3, box(l, r, b, f, second.top, second.top + rng.float(3.6, 5.3)), 'cut',
      side === 'west' ? 'east' : 'west', (b + f) / 2, 10, 3.6, mainCount === 3 && rng.chance(.5));
    if (mainCount === 4) {
      const x = third.entrySide === 'west' ? r - 3.5 : l + 3.5;
      add('main', 4, box(x - 2.8, x + 2.8, b + 1.5, f - 1.5, third.top, third.top + 4.6),
        'none', 'west', (b + f) / 2, 1, 1, true);
    }
  }
  const shoreX = even(80, 94), offset = even(-6, 6);
  const satellite = add('satellite', 1,
    box(shoreX, even(154, 164), offset - 28, offset + 28, 0, even(12, 16)),
    rng.chance(.45) ? (mainEntry === 'wide' ? 'cut' : 'wide') : 'none', 'east',
    offset + even(-8, 10), 32, 5.5);
  if (satelliteCount >= 2) {
    const high = highBank === 2;
    const l = high ? shoreX : shoreX + even(8, 14);
    const r = Math.min(satellite.right - (satellite.entry === 'none' ? 6 : 32), l + 42);
    const width = r - l;
    const side: EntrySide = high ? 'east' : 'west';
    const u = add('satellite', 2,
      box(l, r, offset - 16, offset + 14, satellite.top, satellite.top + (width >= 27 ? 6 : 4)),
      entrance(), side, offset + even(-6, 4), Math.min(14, width - 7), 4.4,
      !high && satelliteCount === 2 && rng.chance(.35));
    if (satelliteCount >= 3) {
      const l3 = side === 'east' ? l + 2 : l + u.length + 1;
      const r3 = side === 'east' ? r - u.length - 1 : r - 2;
      const span = r3 - l3;
      const third = add('satellite', 3,
        box(l3, r3, offset - 12, offset + 9, u.top, u.top + Math.min(4.4, span * .37)),
        'cut', 'east', offset - 2, Math.min(10, span * .85), 3.5, satelliteCount === 3 && rng.chance(.5));
      if (satelliteCount === 4)
        add('satellite', 4, box(l3 + .4, l3 + Math.min(5, span * .45), offset + 4, offset + 8, third.top, third.top + 4),
          'none', 'west', offset + 6, 1, 1, true);
    }
  }
  return { tiers, passageAnchors, spawn: point(-65, 0, firstZ), bridgeZ: offset };
}
