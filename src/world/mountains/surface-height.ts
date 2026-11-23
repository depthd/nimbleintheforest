import type { MeshData } from './geometry';

/** Top visible ground for map shading, animal feet and bridge clearance.
 * The scarp toe and wind lip can project past the plateau grid. Index the
 * same triangles received by the physics world, including these overhangs. */
export function mountainHeight(meshes: MeshData[]) {
  const cell = 6;
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const { positions } of meshes)
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]);
      maxX = Math.max(maxX, positions[i]);
      minZ = Math.min(minZ, positions[i + 2]);
      maxZ = Math.max(maxZ, positions[i + 2]);
    }
  const columns = Math.floor((maxX - minX) / cell) + 1,
    rows = Math.floor((maxZ - minZ) / cell) + 1;
  const bins = new Array<number[]>(columns * rows);
  const faces: {
    x: number;
    y: number;
    z: number;
    bx: number;
    by: number;
    bz: number;
    cx: number;
    cy: number;
    cz: number;
    inverse: number;
  }[] = [];
  const col = (x: number) => Math.floor((x - minX) / cell);
  const row = (z: number) => Math.floor((z - minZ) / cell);
  for (const { positions: p, indices } of meshes)
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3,
        b = indices[i + 1] * 3,
        c = indices[i + 2] * 3;
      const x = p[a],
        y = p[a + 1],
        z = p[a + 2];
      const bx = p[b] - x,
        bz = p[b + 2] - z,
        cx = p[c] - x,
        cz = p[c + 2] - z;
      const det = bx * cz - bz * cx;
      if (det >= -1e-7) continue;
      const id = faces.length;
      faces.push({ x, y, z, bx, bz, cx, cz, by: p[b + 1] - y, cy: p[c + 1] - y, inverse: 1 / det });
      const x0 = col(Math.min(x, p[b], p[c])),
        x1 = col(Math.max(x, p[b], p[c]));
      const z0 = row(Math.min(z, p[b + 2], p[c + 2])),
        z1 = row(Math.max(z, p[b + 2], p[c + 2]));
      for (let j = z0; j <= z1; j++) for (let k = x0; k <= x1; k++) (bins[j * columns + k] ??= []).push(id);
    }
  return (x: number, z: number) => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return 0;
    const local = bins[row(z) * columns + col(x)];
    if (!local) return 0;
    let height = 0;
    for (const id of local) {
      const f = faces[id],
        dx = x - f.x,
        dz = z - f.z;
      const u = (dx * f.cz - dz * f.cx) * f.inverse,
        v = (f.bx * dz - f.bz * dx) * f.inverse;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001) height = Math.max(height, f.y + u * f.by + v * f.cy);
    }
    return height;
  };
}
