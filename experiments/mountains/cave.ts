import type { CrossingMesh, CrossingPlan, CrossingPoint, CrossingWorld } from './crossing';

/** One authored, convex, dead-end cavity. These are targets, never fitted by bake. */
export interface CavePlan {
    readonly version: 'mountain-cave-1';
    readonly sourceSeed: number;
    readonly volume: {
        readonly minX: number; readonly maxX: number; readonly centerZ: number;
        readonly floor: number; readonly tiltZ: number;
        /** Counter-clockwise (z offset, height above floor) cross-section. */
        readonly section: readonly { readonly z: number; readonly y: number }[];
    };
    readonly route: readonly CrossingPoint[];
    readonly roofWitness: { readonly x: number; readonly z: number; readonly minCover: number };
}
export interface CaveWorld {
    readonly source: CrossingWorld;
    readonly plan: CavePlan;
    readonly terrain: CrossingMesh;
    readonly cave: CrossingMesh;
    readonly bridge: CrossingMesh;
    readonly route: readonly CrossingPoint[];
    readonly realization: { readonly cutTriangles: number; readonly roofCover: number; readonly floorY: number; readonly ceilingY: number; readonly exteriorY: number };
    // Deliberately no heightAt: support must be selected in 3D from these meshes.
}
export type CaveBake = { readonly ok: true; readonly world: CaveWorld } | { readonly ok: false; readonly issues: readonly { readonly code: string; readonly detail: string }[] };
type Point = { x: number; y: number; z: number };
type Plane = { x: number; y: number; z: number; d: number };
const EPS = 2e-6; // source vertices are float32; snap near-coplanar classification only
function freeze<T>(v: T): T { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
const floorAt = (p: CavePlan, z: number) => p.volume.floor + p.volume.tiltZ * z;
const value = (p: Plane, v: Point) => p.x * v.x + p.y * v.y + p.z * v.z + p.d;
function plane(x: number, y: number, z: number, d: number): Plane { const length = Math.hypot(x, y, z); return { x: x / length, y: y / length, z: z / length, d: d / length }; }
function flip(p: Plane): Plane { return { x: -p.x, y: -p.y, z: -p.z, d: -p.d }; }
function clip(polygon: Point[], p: Plane): Point[] {
    const out: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length], rawA = value(p, a), rawB = value(p, b), da = Math.abs(rawA) <= EPS ? 0 : rawA, db = Math.abs(rawB) <= EPS ? 0 : rawB, ia = da <= 0, ib = db <= 0;
        if (ia) out.push(a);
        if (ia !== ib) { const t = da / (da - db); out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) }); }
    }
    return out;
}
function append(polygon: Point[], positions: number[], indices: number[]) {
    if (polygon.length < 3) return;
    const a = polygon[0];
    for (let i = 1; i + 1 < polygon.length; i++) {
        const b = polygon[i], c = polygon[i + 1], u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
        if (Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x) < 1e-8) continue;
        const start = positions.length / 3;
        for (const p of [a, b, c]) positions.push(p.x, p.y, p.z);
        indices.push(start, start + 1, start + 2);
    }
}
function volumePlanes(p: CavePlan): Plane[] {
    const v = p.volume;
    const out = [plane(-1, 0, 0, v.minX), plane(1, 0, 0, -v.maxX)];
    for (let i = 0; i < v.section.length; i++) {
        const a = v.section[i], b = v.section[(i + 1) % v.section.length], dz = b.z - a.z, dy = b.y - a.y;
        out.push(plane(0, -dz, dy + dz * v.tiltZ, -dy * v.centerZ + dz * v.floor - dy * a.z + dz * a.y));
    }
    return out;
}
export function createCavePlan(source: CrossingPlan): CavePlan {
    const centerZ = 20, lower = source.routes.find(r => r.id === 'lower');
    if (!lower) throw new Error('Cave approach requires the declared lower route.');
    const route: CrossingPoint[] = [{ ...source.spawn }], reversed = [...lower.points].reverse();
    let entry: CrossingPoint | undefined;
    for (let i = 1; i < reversed.length; i++) {
        const a = reversed[i - 1], b = reversed[i];
        if ((a.z - centerZ) * (b.z - centerZ) <= 0 && a.z !== b.z) {
            const t = (centerZ - a.z) / (b.z - a.z);
            entry = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: centerZ }; route.push(entry); break;
        }
        route.push({ ...b });
    }
    if (!entry) throw new Error('Declared lower route does not cross the cave approach latitude.');
    const y = source.terrain.floor + source.terrain.tiltZ * centerZ;
    route.push({ x: 0, y, z: centerZ }, { x: -52, y, z: centerZ });
    return freeze({ version: 'mountain-cave-1', sourceSeed: source.seed,
        volume: { minX: -55, maxX: 0, centerZ, floor: source.terrain.floor, tiltZ: source.terrain.tiltZ,
            section: [{ z: -5, y: 0 }, { z: 5, y: 0 }, { z: 5, y: 3 }, { z: 3, y: 6 }, { z: -3, y: 6 }, { z: -5, y: 3 }] },
        route, roofWitness: { x: -42, z: centerZ, minCover: 3 } });
}

/** Subtract the cavity from the visible/collision terrain, then add its inward boundary.
 * Boundary polygons are clipped against the exact source triangle prisms and top planes,
 * so the roof and walls emerge at the natural flank instead of floating in the valley.
 */
export function bakeCave(source: CrossingWorld, p: CavePlan): CaveBake {
    const issues: { code: string; detail: string }[] = [], add = (code: string, detail: string) => issues.push({ code, detail });
    const v = p.volume, witness = p.roofWitness, finite = (a: number[]) => a.every(Number.isFinite);
    if (p.version !== 'mountain-cave-1' || p.sourceSeed !== source.plan.seed || !finite([v.minX, v.maxX, v.centerZ, v.floor, v.tiltZ, witness.x, witness.z, witness.minCover]) || v.minX >= v.maxX - 8 || v.maxX - v.minX > 100 || Math.abs(v.tiltZ) > .1 || witness.minCover < 2 || v.floor !== source.plan.terrain.floor || v.tiltZ !== source.plan.terrain.tiltZ) add('invalid-cave-contract', 'Finite bounded cave targets must belong to the source floor and seed.');
    if (v.section.length < 4 || v.section.length > 12 || !v.section.every(a => finite([a.y, a.z])) || Math.min(...v.section.map(a => a.y)) !== 0 || Math.max(...v.section.map(a => a.y)) < 3 || Math.max(...v.section.map(a => a.y)) > 15) add('invalid-cave-section', 'Require a finite convex cross-section with floor zero and pedestrian headroom.');
    for (let i = 0; i < v.section.length; i++) {
        const a = v.section[i], b = v.section[(i + 1) % v.section.length], c = v.section[(i + 2) % v.section.length];
        if ((b.z - a.z) * (c.y - b.y) - (b.y - a.y) * (c.z - b.z) <= EPS) add('invalid-cave-section', 'Cross-section must be strictly convex and counter-clockwise.');
    }
    if (issues.length) return { ok: false, issues };
    const planes = volumePlanes(p), roof = Math.max(...v.section.map(a => a.y)), floorY = floorAt(p, witness.z), ceilingY = floorY + roof, exteriorY = source.heightAt(witness.x, witness.z), roofCover = exteriorY - ceilingY;
    const zMin = v.centerZ + Math.min(...v.section.map(a => a.z)), zMax = v.centerZ + Math.max(...v.section.map(a => a.z));
    const floorSection = v.section.filter(a => a.y === 0);
    if (zMax - zMin < 3 || zMax - zMin > 30 || floorSection.length !== 2 || Math.min(...floorSection.map(a => a.z)) > -.8 || Math.max(...floorSection.map(a => a.z)) < .8 || v.minX <= source.bounds.min.x || v.maxX >= source.bounds.max.x || zMin <= source.bounds.min.z || zMax >= source.bounds.max.z) add('cave-bounds', 'The cavity needs a usable central floor and must stay inside the finite source mesh.');
    if (!(witness.x > v.minX + 1 && witness.x < v.maxX - 1 && witness.z > zMin + 1 && witness.z < zMax - 1) || !Number.isFinite(roofCover) || roofCover < witness.minCover) add('cave-roof-cover', 'Declared roof witness must lie under retained solid mountain.');
    for (const z of [zMin, v.centerZ, zMax]) {
        const mouthY = source.heightAt(v.maxX, z), backY = source.heightAt(v.minX, z);
        if (!Number.isFinite(mouthY) || Math.abs(mouthY - floorAt(p, z)) > .12) add('cave-entrance', 'The original declared mouth must meet the lower ground; bake does not move it.');
        if (!Number.isFinite(backY) || backY < floorAt(p, z) + roof + witness.minCover) add('cave-back-cover', 'The closed end must be inside the mountain.');
    }
    if (p.route.length < 3 || p.route.some(a => !finite([a.x, a.y, a.z])) || Math.hypot(p.route[0].x - source.plan.spawn.x, p.route[0].y - source.plan.spawn.y, p.route[0].z - source.plan.spawn.z) > EPS) add('cave-route', 'Approach must begin at the original spawn.');
    for (const a of p.route) if (Math.abs(a.y - floorAt(p, a.z)) > .12) add('cave-route', 'Retained route floor targets must agree with the declared floor.');
    const last = p.route[p.route.length - 1];
    if (!last || planes.some(pl => value(pl, { ...last, y: last.y + 1 }) > -.5)) add('cave-route', 'Last waypoint must stand safely inside the dead end.');
    for (let i = 1; i < p.route.length; i++) {
        const a = p.route[i - 1], b = p.route[i], steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
        if (steps > 1000) { add('cave-route', 'Route segment exceeds the finite prototype bounds.'); continue; }
        for (let j = 0; j <= steps; j++) {
            const t = steps ? j / steps : 0, q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
            if (planes.every(pl => value(pl, { ...q, y: q.y + 1 }) <= EPS)) continue;
            const height = source.heightAt(q.x, q.z);
            if (!Number.isFinite(height) || Math.abs(height - q.y) > .18) { add('cave-route', 'The retained external approach must agree with the source surface.'); break; }
        }
    }
    if (issues.length) return { ok: false, issues };

    const positions = Array.from(source.terrain.positions), indices: number[] = [], cavePositions: number[] = [], caveIndices: number[] = [];
    const point = (index: number): Point => ({ x: source.terrain.positions[index * 3], y: source.terrain.positions[index * 3 + 1], z: source.terrain.positions[index * 3 + 2] });
    const boundary: Point[][] = [], vertex = (x: number, s: { z: number; y: number }): Point => ({ x, z: v.centerZ + s.z, y: floorAt(p, v.centerZ + s.z) + s.y });
    for (let i = 0; i < v.section.length; i++) {
        const a = v.section[i], b = v.section[(i + 1) % v.section.length];
        boundary.push([vertex(v.minX, b), vertex(v.maxX, b), vertex(v.maxX, a), vertex(v.minX, a)]);
    }
    boundary.push([...v.section].reverse().map(s => vertex(v.minX, s))); // inward back wall; no front cap
    let cutTriangles = 0;
    for (let i = 0; i < source.terrain.indices.length; i += 3) {
        const ids = [source.terrain.indices[i], source.terrain.indices[i + 1], source.terrain.indices[i + 2]], triangle = ids.map(point);
        const nearby = !(Math.max(...triangle.map(a => a.x)) < v.minX - EPS || Math.min(...triangle.map(a => a.x)) > v.maxX + EPS || Math.max(...triangle.map(a => a.z)) < zMin - EPS || Math.min(...triangle.map(a => a.z)) > zMax + EPS);
        if (!nearby) { indices.push(...ids); continue; }
        let remaining = triangle;
        const outside: Point[][] = [];
        if (planes.some(pl => triangle.every(a => value(pl, a) > EPS))) indices.push(...ids);
        else {
            for (const pl of planes) {
                // Coplanar triangles belong to the cavity, including its floor.
                if (remaining.length && remaining.some(a => value(pl, a) > EPS)) outside.push(clip(remaining, flip(pl)));
                remaining = clip(remaining, pl);
                if (!remaining.length) break;
            }
            if (remaining.length >= 3) cutTriangles++;
            for (const polygon of outside) append(polygon, positions, indices);
        }
        // Prism of this original terrain triangle; exact for nonuniform grids too.
        const prism: Plane[] = [];
        for (let j = 0; j < 3; j++) {
            const a = triangle[j], b = triangle[(j + 1) % 3], c = triangle[(j + 2) % 3];
            let pl = plane(b.z - a.z, 0, a.x - b.x, -(b.z - a.z) * a.x - (a.x - b.x) * a.z);
            if (value(pl, c) > 0) pl = flip(pl); prism.push(pl);
        }
        const [a, b, c] = triangle, ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        let top = plane(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx, 0);
        if (top.y < 0) top = flip(top);
        top.d = -top.x * a.x - top.y * a.y - top.z * a.z; prism.push(top);
        for (const face of boundary) { let part = face; for (const pl of prism) part = clip(part, pl); append(part, cavePositions, caveIndices); }
    }
    if (!cutTriangles || !caveIndices.length) return { ok: false, issues: [{ code: 'cave-no-cut', detail: 'The declared volume must intersect the source surface and produce an interior.' }] };
    return { ok: true, world: { source, plan: p, terrain: { positions: new Float32Array(positions), indices: new Uint32Array(indices) }, cave: { positions: new Float32Array(cavePositions), indices: new Uint32Array(caveIndices) }, bridge: source.bridge, route: p.route,
        realization: { cutTriangles, roofCover, floorY, ceilingY, exteriorY } } };
}
