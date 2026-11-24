import { buildBoundary, type Boundary, type SourceGrid } from './seam-boundary';
import { plateauRadius, SLOPE_START } from './plateau-profile';

export function triangleVertexIndices(grid: SourceGrid, triangle: number) {
  const cell = Math.floor(triangle / 2), i = cell % grid.n, j = Math.floor(cell / grid.n);
  const a = j * (grid.n + 1) + i, b = a + 1, c = a + grid.n + 1, d = c + 1;
  return triangle % 2 ? [b, c, d] : [a, c, b];
}
export function inspectBoundarySupport(grid: SourceGrid, boundary: Boundary) {
  const triangles = [...new Set(boundary.sourceTriangles)];
  let maxVertexRadius = -Infinity;
  const invalidTriangles = triangles.filter(id => {
    const radii = triangleVertexIndices(grid, id).map(index => {
      const i = index % (grid.n + 1), j = Math.floor(index / (grid.n + 1));
      return plateauRadius(grid.x0 + i * grid.cell, grid.z0 + j * grid.cell);
    });
    maxVertexRadius = Math.max(maxVertexRadius, ...radii);
    return radii.some(radius => radius > SLOPE_START);
  });
  return { triangles: triangles.length, invalidTriangles, maxVertexRadius };
}

// Search only within the existing homothetic outline family. No assumption
// that safe/unsafe is monotone: every larger candidate on this grid is tested.
// This chooses the outermost TESTED safe contour, not a global shape optimum.
export function chooseSupportedBoundary(grid: SourceGrid, step = .0001, minRadius = .8) {
  if (!(step > 0) || !(minRadius > 0 && minRadius < SLOPE_START)) throw Error('Invalid seam search bounds');
  const attempts: { radius: number; invalidTriangles: number }[] = [];
  for (let k = 0; SLOPE_START - k * step >= minRadius; k++) {
    const radius = SLOPE_START - k * step;
    const boundary = buildBoundary(grid, radius), support = inspectBoundarySupport(grid, boundary);
    attempts.push({ radius, invalidTriangles: support.invalidTriangles.length });
    if (!support.invalidTriangles.length) return { boundary, support, attempts, step };
  }
  throw Error(`No seam with top-only supporting triangles down to radius ${minRadius}`);
}
