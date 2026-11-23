import { Vector3 } from 'three';
import type { Region } from '../gen/region';
import { planMountainBridge } from '../world/mountains/bridge';
import type { MountainPoint } from '../world/mountains/terrain';

export const trailStops = {
  overview: { title: 'Общий вид', seed: 7 },
  wide: { title: 'Широкий склон', seed: 42 },
  cut: { title: 'Узкие проходы', seed: 6 },
  rope: { title: 'Подъём по канату', seed: 42 },
  through: { title: 'Сквозная пещера', seed: 42 },
  den: { title: 'Укрытие', seed: 42 },
  bear: { title: 'Старая берлога', seed: 6 },
  bridge: { title: 'Подвесной мост', seed: 42 },
} as const;

export type TrailStop = keyof typeof trailStops;
export function isTrailStop(value: string | null): value is TrailStop {
  return value !== null && Object.hasOwn(trailStops, value);
}

export function trailPose(region: Region, stop: TrailStop) {
  const t = region.mountainTerrain, site = region.mountainSite;
  if (!t || !site) throw new Error('В этом мире не удалось разместить горный массив.');
  function ground(x: number, z: number) {
    return { x, y: region.outdoorHeightAt(site!.x+x, site!.z+z)-site!.y, z };
  }
  let feet: MountainPoint, look: MountainPoint;
  if (stop === 'wide' || stop === 'cut') {
    const route = t.routes.find(r => r.from === 'spawn' && r.to === 'main-1' && r.kind === stop);
    if (!route) throw new Error('Для этой точки нужен мир с соответствующим подъёмом.');
    const entry = route.points[0];
    feet = ground(entry.x-7, entry.z);
    look = route.points[Math.floor(route.points.length*.68)];
  } else if (stop === 'bridge') {
    const bridge = planMountainBridge(t);
    if (!bridge) throw new Error('В этом мире не нашлось места для переправы.');
    const leavingMain = bridge.from.mountainId === 'main';
    const landing = bridge.point(leavingMain ? -2 : bridge.span+2);
    feet = ground(landing.x, landing.z);
    look = bridge.point(bridge.span*(leavingMain ? .8 : .2), 0, 1.2);
  } else if (stop === 'overview') {
    feet = ground(65, -113);
    look = {x: 63, y: 15, z: -.5};
  } else {
    const a = t.passageAnchors;
    const entry = stop === 'rope' ? a.ropeLower : stop === 'through' ? a.throughLower : a.denMouth;
    const offset = stop === 'rope' ? 7 : stop === 'through' ? 5 : 6;
    feet = ground(entry.x + (stop === 'rope' ? -1.4 : .65), entry.z + offset);
    look = {x: entry.x, z: entry.z - 1.2,
      y: stop === 'rope' ? entry.y+(a.ropeUpper.y-entry.y)*.42 : entry.y+1.55};
  }
  const spawn = new Vector3(site.x+feet.x, site.y+feet.y+.12, site.z+feet.z);
  const dx = look.x-feet.x, dz = look.z-feet.z;
  return { spawn, yaw: Math.atan2(-dx,-dz), pitch: Math.atan2(look.y-feet.y-1.82, Math.hypot(dx,dz)) };
}
