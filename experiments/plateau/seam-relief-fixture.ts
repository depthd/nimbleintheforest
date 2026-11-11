// Test-only terrain. No edge attenuation of the top relief; the old flank is
// still formed by the same .96..1.055 falloff. Not imported by the scene.
import { smoothstep } from '../../src/core/rng';
import { plateauRadius, SLOPE_START } from './plateau-profile';
export const reliefFixture = { topAttenuation: false, size: 1400, cell: 4, n: 350 } as const;
export function reliefTop(x: number, z: number) {
  return 100 + 8 * Math.sin(x / 17) * Math.cos(z / 23) + 3 * Math.sin((x + z) / 7);
}
export function reliefHeight(x: number, z: number) {
  const r = plateauRadius(x, z), wall = 1 - smoothstep(SLOPE_START, 1.055, r);
  const apron = 1 - smoothstep(1.04, 1.23, r);
  return (1 - wall) * 5 * apron + wall * reliefTop(x, z);
}
export function reliefGrid() {
  const { n, cell, size } = reliefFixture, heights = new Float32Array((n + 1) ** 2);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    heights[j * (n + 1) + i] = reliefHeight(i * cell - size / 2, j * cell - size / 2);
  }
  return { n, cell, x0: -size / 2, z0: -size / 2, heights };
}
