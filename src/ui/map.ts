// Paper-style map of the region: hill shading, biomes, water and ice, rivers, places.
import type { Region } from '../gen/region';
import { B } from '../gen/biomes';
import { clamp, lerp } from '../core/rng';

const PALETTE: Record<number, [number, number, number]> = {
  [B.Sea]: [38, 66, 92],
  [B.Water]: [196, 216, 228],
  [B.Coast]: [222, 220, 210],
  [B.Taiga]: [62, 84, 72],
  [B.Pine]: [96, 108, 78],
  [B.Birch]: [150, 160, 138],
  [B.Burned]: [92, 82, 76],
  [B.Bog]: [168, 166, 130],
  [B.Tundra]: [200, 204, 196],
  [B.Alpine]: [214, 218, 224],
  [B.Stones]: [186, 180, 168],
};

/** Render the region into a canvas of `px` × `px` pixels. */
export function renderRegionMap(R: Region, px: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  const D = img.data;
  const m = R.size / px;
  const lx = -0.6, ly = 0.75, lz = -0.5; // light from the north-west
  const ll = Math.hypot(lx, ly, lz);
  for (let py = 0; py < px; py++) {
    for (let qx = 0; qx < px; qx++) {
      const x = R.minX + (qx + 0.5) * m, z = R.minZ + (py + 0.5) * m;
      const h = R.heightAt(x, z);
      const e = m;
      const dx = (R.heightAt(x + e, z) - R.heightAt(x - e, z)) / (2 * e);
      const dz = (R.heightAt(x, z + e) - R.heightAt(x, z - e)) / (2 * e);
      const nl = Math.hypot(dx, 1, dz);
      const shade = clamp((-dx * lx + ly - dz * lz) / (nl * ll), 0, 1);
      const w = R.waterAt(x, z);
      let c: [number, number, number];
      const o = (py * px + qx) * 4;
      if (!Number.isNaN(w)) {
        const iceT = R.iceAt(x, z);
        if (iceT <= 0.001) c = w === 0 ? [34, 58, 84] : [44, 74, 96];
        else if (iceT < 0.15) c = [150, 182, 204];
        else c = w === 0 ? [206, 222, 232] : [200, 220, 234];
        D[o] = c[0];
        D[o + 1] = c[1];
        D[o + 2] = c[2];
        D[o + 3] = 255;
        continue;
      }
      const b = R.biomeAt(x, z);
      c = PALETTE[b] ?? [255, 0, 255];
      // forests read darker, open snow lighter
      const f = R.forestAt(x, z);
      const snow: [number, number, number] = [236, 240, 244];
      const k = b === B.Alpine || b === B.Tundra || b === B.Coast ? 0.55 : lerp(0.75, 0.0, f);
      let r = lerp(c[0], snow[0], k), g = lerp(c[1], snow[1], k), bl = lerp(c[2], snow[2], k);
      const sl = Math.hypot(dx, dz);
      if (sl > 0.9) {
        r = lerp(r, 110, 0.6);
        g = lerp(g, 108, 0.6);
        bl = lerp(bl, 112, 0.6);
      }
      // contour lines every 20 m
      const cl = Math.abs(((h / 20) % 1 + 1) % 1 - 0.5) > 0.47 && sl < 1.5 ? 0.82 : 1;
      const s = (0.55 + 0.6 * shade) * cl;
      D[o] = clamp(r * s, 0, 255);
      D[o + 1] = clamp(g * s, 0, 255);
      D[o + 2] = clamp(bl * s + 4, 0, 255);
      D[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Convert world coordinates to map pixels. */
export function mapXY(R: Region, px: number, x: number, z: number) {
  return { x: ((x - R.minX) / R.size) * px, y: ((z - R.minZ) / R.size) * px };
}
