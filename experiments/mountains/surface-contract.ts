// Acceptance on the baked triangles, separate from the immutable geography.
// This is a terrain certificate; RockSkin and tree collisions need the browser walk.
import { polygonDistance, floorAt, type District } from './mountain-plan';
import type { Route } from './landforms';
interface Surface {
    regions: District[];
    routes: Route[];
    world(x: number, z: number): {
        x: number;
        z: number;
    };
    heightAt(x: number, z: number): number;
    slopeAt(x: number, z: number): number;
    waterAt(x: number, z: number): number;
}
export function inspectSurface(land: Surface) {
    const failures: string[] = [];
    const height = (x: number, z: number) => { const w = land.world(x, z); return land.heightAt(w.x, w.z); };
    const routes = land.routes.map(r => {
        let maxHeightError = 0, maxGradient = 0, maxCrossGrade = 0;
        for (let i = 0; i < r.points.length; i++) {
            const p = r.points[i], y = height(p.x, p.z);
            maxHeightError = Math.max(maxHeightError, Math.abs(y - p.y));
            if (!i)
                continue;
            const a = r.points[i - 1], dx = p.x - a.x, dz = p.z - a.z, len = Math.hypot(dx, dz);
            maxGradient = Math.max(maxGradient, Math.abs(y - height(a.x, a.z)) / len);
            for (const side of [-1, 1]) {
                const x = p.x - dz / len * side * 3, z = p.z + dx / len * side * 3;
                maxCrossGrade = Math.max(maxCrossGrade, Math.abs(height(x, z) - y) / 3);
            }
        }
        if (!Number.isFinite(maxHeightError + maxGradient + maxCrossGrade) || maxHeightError > 1 || maxGradient > .7 || maxCrossGrade > .7)
            failures.push(`route ${r.id}: height ${maxHeightError.toFixed(2)}, grade ${maxGradient.toFixed(2)}, cross ${maxCrossGrade.toFixed(2)}`);
        return { id: r.id, maxHeightError, maxGradient, maxCrossGrade };
    });
    const regions = land.regions.map(r => {
        const step = 6, minX = Math.floor(Math.min(...r.polygon.map(p => p[0])) / step) * step, minZ = Math.floor(Math.min(...r.polygon.map(p => p[1])) / step) * step;
        const nx = Math.ceil((Math.max(...r.polygon.map(p => p[0])) - minX) / step) + 1, nz = Math.ceil((Math.max(...r.polygon.map(p => p[1])) - minZ) / step) + 1;
        const useful = new Uint8Array(nx * nz), heights = new Float32Array(nx * nz);
        const good = (x: number, z: number) => {
            if (polygonDistance(r.polygon, x, z) < step / Math.SQRT2)
                return false;
            const w = land.world(x, z), y = land.heightAt(w.x, w.z);
            return Number.isNaN(land.waterAt(w.x, w.z)) && land.slopeAt(w.x, w.z) < .5 && Math.abs(y - floorAt(r, x, z)) <= 18;
        };
        for (let j = 0; j < nz; j++)
            for (let i = 0; i < nx; i++) {
                const x = minX + i * step, z = minZ + j * step, k = j * nx + i;
                heights[k] = height(x, z);
                useful[k] = good(x, z) ? 1 : 0;
            }
        const ci = Math.round((r.access.core.x - minX) / step), cj = Math.round((r.access.core.z - minZ) / step), core = cj * nx + ci;
        const queue: number[] = [];
        if (useful[core]) {
            queue.push(core);
            useful[core] = 0;
        }
        for (let q = 0; q < queue.length; q++) {
            const k = queue[q], i = k % nx, j = Math.floor(k / nx);
            for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                const ii = i + di, jj = j + dj, n = jj * nx + ii;
                if (ii < 0 || ii >= nx || jj < 0 || jj >= nz || !useful[n] || Math.abs(heights[n] - heights[k]) / step > .5)
                    continue;
                if (!good(minX + (i + di * .5) * step, minZ + (j + dj * .5) * step))
                    continue;
                useful[n] = 0;
                queue.push(n);
            }
        }
        const connectedArea = queue.length * step * step;
        if (connectedArea < r.access.minConnectedArea)
            failures.push(`region ${r.id}: ${connectedArea}m² below ${r.access.minConnectedArea.toFixed(0)}m²`);
        return { id: r.id, connectedArea, minConnectedArea: r.access.minConnectedArea };
    });
    return { status: failures.length ? 'rejected' as const : 'terrain-verified' as const, routes, regions, failures };
}
