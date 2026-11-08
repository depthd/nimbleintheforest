// The same builder is used during loading, in the mesh worker, and by the
// time-sliced fallback. No WebGL, world state, or physics objects live here.
export const TERRAIN_CHUNK_CELLS = 64;
export const TERRAIN_STEPS = [1, 2, 4, 8];
export interface TerrainGrid { h: Float32Array; n: number; ox: number; oz: number }
export interface TerrainSnowSource {
  heightAt: (x: number, z: number) => number;
  detailedAt?: (x: number, z: number, size: number) => boolean;
}
export interface TerrainGeometryData {
  position: Float32Array; normal: Float32Array; depth: Float32Array;
  snowNormal: Float32Array; index: Uint32Array;
  packed?: { position: Float32Array; normal: Float32Array; index: Uint32Array };
}
const indices = new Map<number, Uint32Array>();
function gridIndex(m: number) {
  let cached = indices.get(m);
  if (cached) return cached;
  const idx: number[] = [], base = m * m;
  for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
    const v = b * m + a; idx.push(v, v + m, v + 1, v + 1, v + m, v + m + 1);
  }
  const edge = (k: number, side: number) => side === 0 ? k : side === 1 ? k * m + m - 1
    : side === 2 ? (m - 1) * m + m - 1 - k : (m - 1 - k) * m;
  for (let side = 0; side < 4; side++) for (let k = 0; k < m - 1; k++) {
    const a = edge(k, side), b = edge(k + 1, side), sa = base + side * m + k;
    idx.push(a, sa, b, b, sa, sa + 1);
  }
  cached = Uint32Array.from(idx); indices.set(m, cached); return cached;
}

export function* terrainGeometrySteps(r: TerrainGrid, ci: number, cj: number, lod: number,
  snow?: TerrainSnowSource): Generator<void, TerrainGeometryData> {
  const CH = TERRAIN_CHUNK_CELLS, s = TERRAIN_STEPS[lod], m = CH / s + 1, nf = r.n + 1;
  const pos = new Array<number>((m * m + 4 * m) * 3).fill(0), nrm = new Array<number>(pos.length).fill(0);
  const hAt = (i: number, j: number) => {
    i = Math.max(0, Math.min(r.n - 1e-7, i)); j = Math.max(0, Math.min(r.n - 1e-7, j));
    const ix = Math.floor(i), iz = Math.floor(j), u = i - ix, v = j - iz, k = iz * nf + ix, H = r.h;
    return u + v <= 1 ? H[k] + (H[k + 1] - H[k]) * u + (H[k + nf] - H[k]) * v
      : H[k + nf + 1] + (H[k + nf] - H[k + nf + 1]) * (1 - u) + (H[k + 1] - H[k + nf + 1]) * (1 - v);
  };
  const setV = (o: number, a: number, b: number, drop: number, height?: number) => {
    const i = ci * CH + a * s, j = cj * CH + b * s;
    pos[o * 3] = a * s * 2; pos[o * 3 + 1] = (height ?? hAt(i, j)) - drop; pos[o * 3 + 2] = b * s * 2;
    const dx = hAt(i + s, j) - hAt(i - s, j), dz = hAt(i, j + s) - hAt(i, j - s), len = Math.hypot(dx, 4 * s, dz);
    nrm[o * 3] = -dx / len; nrm[o * 3 + 1] = 4 * s / len; nrm[o * 3 + 2] = -dz / len;
  };
  for (let b = 0; b < m; b++) { for (let a = 0; a < m; a++) setV(b * m + a, a, b, 0); yield; }
  const base = m * m, drop = 1.5 + s * 1.5;
  for (let k = 0; k < m; k++) {
    setV(base + k, k, 0, drop); setV(base + m + k, m - 1, k, drop);
    setV(base + 2 * m + k, m - 1 - k, m - 1, drop); setV(base + 3 * m + k, 0, m - 1 - k, drop);
  }
  const originalIndex = gridIndex(m);
  let index = originalIndex, packed: TerrainGeometryData['packed'];
  if (snow?.detailedAt) {
    packed = { position: Float32Array.from(pos), normal: Float32Array.from(nrm), index: originalIndex.slice() };
    const idx: number[] = [], sub = lod === 0 ? 8 : 4, originX = ci * CH * 2 - r.ox, originZ = cj * CH * 2 - r.oz;
    for (let b = 0; b < m - 1; b++) {
      for (let a = 0; a < m - 1; a++) {
        const v = b * m + a;
        if (!snow.detailedAt(originX + a * s * 2, originZ + b * s * 2, s * 2)) {
          idx.push(v, v + m, v + 1, v + 1, v + m, v + m + 1); continue;
        }
        const grid: number[] = [], h00 = pos[v * 3 + 1], h10 = pos[(v + 1) * 3 + 1], h01 = pos[(v + m) * 3 + 1], h11 = pos[(v + m + 1) * 3 + 1];
        for (let z = 0; z <= sub; z++) for (let x = 0; x <= sub; x++) {
          const u = x / sub, w = z / sub, id = pos.length / 3;
          const h = u + w <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * w : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - w);
          setV(id, a + u, b + w, 0, h); grid.push(id);
          if (x && z) { const k = z * (sub + 1) + x, aa = grid[k - sub - 2], bb = grid[k - sub - 1], cc = grid[k - 1]; idx.push(aa, cc, bb, bb, cc, id); }
        }
        yield;
      }
      yield;
    }
    for (let i = (m - 1) * (m - 1) * 6; i < originalIndex.length; i++) idx.push(originalIndex[i]);
    index = Uint32Array.from(idx);
  }
  const position = Float32Array.from(pos), normal = Float32Array.from(nrm), depth = new Float32Array(pos.length / 3), snowNormal = normal.slice();
  yield;
  for (let i = 0; i < depth.length; i++) {
    const x = position[i * 3] + ci * CH * 2 - r.ox, z = position[i * 3 + 2] + cj * CH * 2 - r.oz;
    depth[i] = snow?.heightAt(x, z) ?? 0;
    if (snow) {
      const e = .1, dx = (snow.heightAt(x + e, z) - snow.heightAt(x - e, z)) / (2 * e), dz = (snow.heightAt(x, z + e) - snow.heightAt(x, z - e)) / (2 * e);
      const nx = normal[i * 3] / Math.max(.01, normal[i * 3 + 1]) - dx, nz = normal[i * 3 + 2] / Math.max(.01, normal[i * 3 + 1]) - dz, len = Math.hypot(nx, 1, nz);
      snowNormal[i * 3] = nx / len; snowNormal[i * 3 + 1] = 1 / len; snowNormal[i * 3 + 2] = nz / len;
    }
    if ((i & 127) === 127) yield;
  }
  // Every result owns its index buffers: transferring a worker result must not
  // detach the cached template used by the next chunk.
  return { position, normal, depth, snowNormal, index: index === originalIndex ? index.slice() : index, packed };
}

export function buildTerrainGeometry(...args: Parameters<typeof terrainGeometrySteps>) {
  const steps = terrainGeometrySteps(...args);
  let next = steps.next(); while (!next.done) next = steps.next(); return next.value;
}

export function terrainLod(distance: number, previous = -1) {
  const limits = [150, 330, 620], margin = 12;
  if (previous < 0) return distance < 150 ? 0 : distance < 330 ? 1 : distance < 620 ? 2 : 3;
  let lod = previous;
  while (lod > 0 && distance < limits[lod - 1] - margin) lod--;
  while (lod < 3 && distance > limits[lod] + margin) lod++;
  return lod;
}
