// Test-only terrain. No edge attenuation of the top relief; the old flank is
// still formed by the same .96..1.055 falloff. Not imported by the scene.
import { smoothstep, Simplex2, Rng } from '../../src/core/rng';
import { plateauRadius, SLOPE_START } from './plateau-profile';
export const reliefFixture = { topAttenuation: false, size: 1400, cell: 4, n: 350 } as const;
export function reliefTop(x: number, z: number) {
  return 100 + 8 * Math.sin(x / 17) * Math.cos(z / 23) + 3 * Math.sin((x + z) / 7);
}
const terrainNoise = new Simplex2(new Rng(781903).next);
export function chaoticTop(x: number, z: number) {
  const px = x + 24 * terrainNoise.noise(x / 145 + 17, z / 145 - 31);
  const pz = z + 24 * terrainNoise.noise(x / 145 - 53, z / 145 + 11);
  const broad = 14 * terrainNoise.noise(px / 105 + 3.7, pz / 105 - 8.1);
  const medium = 7 * terrainNoise.noise(px / 36 - 21.4, pz / 36 + 15.8);
  const small = 3 * terrainNoise.noise(px / 11 + 47.2, pz / 11 - 29.6);
  // Match the previous fixture's height envelope, without repeated periods
  // or a flat cutoff at extremes. Relief continues all the way to the rim.
  return 100 + 11.5 * Math.tanh((broad + medium + small) / 11.5);
}
export function reliefHeight(x: number, z: number, top = reliefTop) {
  const r = plateauRadius(x, z), wall = 1 - smoothstep(SLOPE_START, 1.055, r);
  const apron = 1 - smoothstep(1.04, 1.23, r);
  return (1 - wall) * 5 * apron + wall * top(x, z);
}
export function reliefGrid(top = reliefTop) {
  const { n, cell, size } = reliefFixture, heights = new Float32Array((n + 1) ** 2);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    heights[j * (n + 1) + i] = reliefHeight(i * cell - size / 2, j * cell - size / 2, top);
  }
  return { n, cell, x0: -size / 2, z0: -size / 2, heights };
}
