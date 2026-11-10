/** Authored destinations within the control composition, in Landforms local XZ.
 * The compact bearing surfaces and scenery reserves travel with seed yaw/mirror.
 */
export const EXPEDITION_SITES = [
  { id: 'wreck', x: -35, z: -470, y: 224.5, yaw: -Math.PI / 2, halfX: 31, halfZ: 27, feather: 20 },
  { id: 'station', x: 365, z: -170, y: 179, yaw: Math.PI, halfX: 32, halfZ: 22, feather: 24 },
] as const;

export function siteDistance(x: number, z: number, site: typeof EXPEDITION_SITES[number]) {
  return Math.hypot(Math.max(Math.abs(x - site.x) - site.halfX, 0), Math.max(Math.abs(z - site.z) - site.halfZ, 0));
}

export function reservedForExpedition(x: number, z: number, padding = 0) {
  return EXPEDITION_SITES.some(site => siteDistance(x, z, site) <= padding);
}
