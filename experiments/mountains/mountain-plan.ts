// Geography first: a branching valley system, connected ridge spines, and districts
// with access. No sampled terrain, props, or seed-specific coordinate tables.
import { Rng, clamp, lerp, hashString } from '../../src/core/rng';
import type { Point } from './landforms';
export const GENERATOR_VERSION = 'branching-uplands-1';
export type XY = {
    x: number;
    z: number;
};
export interface District {
    id: string;
    name: string;
    kind: 'forest' | 'valley' | 'hollow' | 'shoulder' | 'crest';
    x: number;
    z: number;
    y: number;
    polygon: number[][];
    tiltX: number;
    tiltZ: number;
    radius: number;
    feather: number;
    openX: number;
    openZ: number;
    phase: number;
    access: {
        core: XY;
        minConnectedArea: number;
    };
}
export interface PlannedRoute {
    id: string;
    name: string;
    from: string;
    to: string;
    width: number;
    points: Point[];
    status: 'planned';
}
export interface Ridge {
    id: string;
    nodes: (Point & {
        left: number;
        right: number;
    })[];
}
export interface MountainPlan {
    seed: number;
    version: string;
    spawnRegion: string;
    regions: District[];
    routes: PlannedRoute[];
    ridges: Ridge[];
    trunk: string[];
    yaw: number;
    mirror: number;
    traversal: {
        id: string;
        from: string;
        to: string;
        status: 'planned';
    }[];
}
export const noiseStream = (seed: number, id: string) => new Rng(seed ^ hashString(GENERATOR_VERSION + '/' + id));
export function polygonDistance(poly: number[][], x: number, z: number) {
    let inside = false, d = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j], b = poly[i], dx = b[0] - a[0], dz = b[1] - a[1];
        const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
        d = Math.min(d, (x - a[0] - t * dx) ** 2 + (z - a[1] - t * dz) ** 2);
        if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0])
            inside = !inside;
    }
    return (inside ? 1 : -1) * Math.sqrt(d);
}
export function area(poly: number[][]) {
    return Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
}
export function floorAt(r: District, x: number, z: number) { return r.y + (x - r.x) * r.tiltX + (z - r.z) * r.tiltZ; }
function freeze<T>(v: T): T {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
        for (const x of Object.values(v))
            freeze(x);
        Object.freeze(v);
    }
    return v;
}
function makeDistrict(rng: Rng, id: string, name: string, kind: District['kind'], x: number, z: number, y: number, rx: number, rz: number, angle: number): District {
    const ca = Math.cos(angle), sa = Math.sin(angle), tilt = rng.float(.035, .1), side = rng.float(-.045, .045);
    const polygon = Array.from({ length: 12 }, (_, i) => {
        const a = i * Math.PI / 6, scale = rng.float(.82, 1.16), u = Math.cos(a) * rx * scale, v = Math.sin(a) * rz * scale;
        return [x + u * ca - v * sa, z + u * sa + v * ca];
    });
    return { id, name, kind, x, z, y, polygon, radius: Math.max(rx, rz), feather: rng.float(32, 65), openX: ca, openZ: sa, phase: rng.float(0, 7),
        tiltX: ca * side + sa * tilt, tiltZ: sa * side - ca * tilt,
        access: { core: { x, z }, minConnectedArea: area(polygon) * (kind === 'crest' ? .2 : .32) } };
}
function curve(a: District, b: District, bend: number, id: string, width: number): PlannedRoute {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), nx = -dz / len, nz = dx / len;
    const points: Point[] = [];
    // The profile is fixed before bake. Wide districts own a gentle local grade;
    // a pass spends the required rise in the gap, never a repaired terrain sample.
    for (let i = 0; i <= 24; i++) {
        const t = i / 24, bulge = Math.sin(Math.PI * t) ** 2 * bend;
        const x = lerp(a.x, b.x, t) + nx * bulge, z = lerp(a.z, b.z, t) + nz * bulge;
        points.push({ x, y: lerp(a.y, b.y, t), z });
    }
    const exit = points.reduce((last, p, i) => polygonDistance(a.polygon, p.x, p.z) >= 0 ? i : last, 0);
    const enter = points.findIndex(p => polygonDistance(b.polygon, p.x, p.z) >= 0);
    if (enter > exit) {
        const distance = [0];
        for (let i = 1; i < points.length; i++)
            distance.push(distance[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
        const start = floorAt(a, points[exit].x, points[exit].z), end = floorAt(b, points[enter].x, points[enter].z);
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            p.y = i <= exit ? floorAt(a, p.x, p.z) : i >= enter ? floorAt(b, p.x, p.z) : lerp(start, end, (distance[i] - distance[exit]) / (distance[enter] - distance[exit]));
        }
    }
    return { id, name: `${a.name} → ${b.name}`, from: a.id, to: b.id, width, points, status: 'planned' };
}
function validRoute(r: PlannedRoute, regions: District[], routes: PlannedRoute[]) {
    if (r.points.some(p => Math.hypot(p.x, p.z) > 690))
        return false;
    for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1], b = r.points[i];
        if (Math.abs(b.y - a.y) / Math.hypot(b.x - a.x, b.z - a.z) > .58)
            return false;
    }
    for (const p of r.points.slice(2, -2)) {
        if (regions.some(d => d.id !== r.from && d.id !== r.to && polygonDistance(d.polygon, p.x, p.z) > -r.width))
            return false;
        for (const q of routes) {
            const shared = [r.from, r.to].find(id => id === q.from || id === q.to);
            if (shared && regions.some(d => d.id === shared && polygonDistance(d.polygon, p.x, p.z) > -20))
                continue;
            for (const v of q.points)
                if (Math.hypot(p.x - v.x, p.z - v.z) < (r.width + q.width) * .6 && Math.abs(p.y - v.y) > 1)
                    return false;
        }
    }
    return true;
}
function connect(a: District, b: District, rng: Rng, regions: District[], routes: PlannedRoute[], id: string): PlannedRoute | undefined {
    const bend = rng.float(-45, 45), width = rng.float(16, 24);
    for (const factor of [1, .5, 0, -.6]) {
        const r = curve(a, b, bend * factor, id, width);
        if (validRoute(r, regions, routes))
            return r;
    }
}
export function generateMountainPlan(seed: number): MountainPlan {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
        throw Error('Mountain seed must be uint32');
    const rng = noiseStream(seed, 'geography'), regions: District[] = [], routes: PlannedRoute[] = [], ridges: Ridge[] = [];
    const levels = rng.int(3, 4), step = 960 / levels, trunk: District[] = [];
    let x = rng.float(-75, 75), y = rng.float(24, 36);
    for (let i = 0; i <= levels; i++) {
        const z = 475 - step * i + rng.float(-18, 18), dx = i === 0 ? 0 : rng.float(-95, 95);
        x = clamp(x + dx, -140, 140);
        if (i)
            y += rng.float(43, 65);
        const id = i === 0 ? 'lowland' : `valley-${i}`;
        const r = makeDistrict(rng, id, i === 0 ? 'Нижний лес' : i === levels ? 'Верхняя долина' : `Долина ${i}`, i === 0 ? 'forest' : 'valley', x, z, y, i === 0 ? rng.float(150, 190) : rng.float(105, 148), i === 0 ? 95 : rng.float(65, 88), rng.float(-.3, .3));
        // Trunk domains must leave room for a graded passage. Reduce a candidate's
        // rise before committing it, not its useful floor requirement after bake.
        let route: PlannedRoute | undefined;
        if (i)
            for (let trial = 0; trial < 10 && !route; trial++) {
                route = connect(trunk[i - 1], r, rng, [...regions, r], routes, `pass-${i}`);
                if (!route)
                    r.y -= 7;
            }
        if (i && !route)
            throw Error(`seed ${seed}: no graded attachment for ${id}`);
        const previous = trunk.at(-1);
        r.openX = previous ? (previous.x - r.x) / Math.hypot(previous.x - r.x, previous.z - r.z) : 0;
        r.openZ = previous ? (previous.z - r.z) / Math.hypot(previous.x - r.x, previous.z - r.z) : 1;
        regions.push(r);
        trunk.push(r);
        y = r.y;
        if (route)
            routes.push(route);
    }
    // Side basins attach to different heights, on alternating sides of the spine.
    // Their count, rank, area, elevations and optional return links vary by seed.
    const wanted = rng.int(1, 3), firstSide = rng.chance(.5) ? 1 : -1;
    for (let j = 0; j < wanted; j++) {
        const rank = 1 + (j % (trunk.length - 2)), parent = trunk[rank], side = firstSide * (j % 2 ? -1 : 1);
        let accepted = false;
        for (let trial = 0; trial < 18 && !accepted; trial++) {
            const cx = parent.x + side * rng.float(285, 350), cz = parent.z + rng.float(-85, 45);
            const small = rng.chance(.45), rx = small ? rng.float(65, 85) : rng.float(100, 130), rz = rng.float(65, 105);
            const r = makeDistrict(rng, `side-${j}`, small ? 'Боковая котловина' : 'Лесное плечо', small ? 'hollow' : 'shoulder', cx, cz, parent.y + rng.float(24, 52), rx, rz, rng.float(-.7, .7));
            if (r.polygon.some(p => Math.hypot(p[0], p[1]) > 660) || regions.some(a => Math.hypot(a.x - r.x, a.z - r.z) < a.radius + r.radius + 24))
                continue;
            const route = connect(parent, r, rng, [...regions, r], routes, `branch-${j}`);
            if (!route)
                continue;
            r.openX = (parent.x - r.x) / Math.hypot(parent.x - r.x, parent.z - r.z);
            r.openZ = (parent.z - r.z) / Math.hypot(parent.x - r.x, parent.z - r.z);
            regions.push(r);
            routes.push(route);
            accepted = true;
            if (rng.chance(.58)) {
                const target = trunk[Math.min(rank + 1, trunk.length - 1)], loop = connect(r, target, rng, regions, routes, `return-${j}`);
                if (loop)
                    routes.push(loop);
            }
        }
        // Optional side geography is rejected atomically: never an orphan district.
    }
    // The two long, irregular crest systems are the common mountain body. Passes
    // cut through them; they are not one closed cliff ring around each district.
    for (const side of [-1, 1]) {
        const peaks: Ridge['nodes'] = trunk.slice(1).map(r => ({
            x: r.x + side * rng.float(235, 300), z: r.z + rng.float(-45, 45), y: r.y + rng.float(65, 150),
            left: side < 0 ? rng.float(260, 340) : rng.float(170, 240),
            right: side < 0 ? rng.float(170, 240) : rng.float(260, 340),
        }));
        const nodes: Ridge['nodes'] = [];
        for (let i = 0; i < peaks.length; i++) {
            if (i) {
                const a = peaks[i - 1], b = peaks[i], t = rng.float(.35, .65);
                // Low saddles interrupt the skyline and open views between
                // districts. Their positions are independent on opposite sides.
                nodes.push({ x: lerp(a.x, b.x, t) + side * rng.float(-15, 45), z: lerp(a.z, b.z, t),
                    y: lerp(a.y, b.y, t) - rng.float(35, 65),
                    left: lerp(a.left, b.left, t) * 1.15, right: lerp(a.right, b.right, t) * 1.15 });
            }
            nodes.push(peaks[i]);
        }
        const last = nodes[nodes.length - 1];
        nodes.push({ ...last, x: last.x + side * rng.float(-65, 30), z: -625, y: last.y + rng.float(-20, 50) });
        ridges.push({ id: `backbone-${side}`, nodes });
        for (const d of regions.filter(r => r.id.startsWith('side-') && Math.sign(r.x - trunk[1].x) === side)) {
            const near = nodes.reduce((a, b) => Math.hypot(a.x - d.x, a.z - d.z) < Math.hypot(b.x - d.x, b.z - d.z) ? a : b);
            ridges.push({ id: `spur-${d.id}`, nodes: [{ ...near }, { x: d.x + side * 80, z: d.z - 135, y: d.y + rng.float(75, 115), left: 180, right: 180 }, { x: d.x + side * 105, z: d.z - 30, y: d.y + 55, left: 190, right: 150 }] });
        }
    }
    const west = ridges.find(r => r.id === 'backbone--1')!.nodes.at(-1)!, east = ridges.find(r => r.id === 'backbone-1')!.nodes.at(-1)!;
    // A shared head massif gives the upper valley a mountain backdrop and joins
    // the two systems. It occupies the far end, rather than enclosing each floor.
    ridges.push({ id: 'head-massif', nodes: [{ ...west },
            { x: trunk.at(-1)!.x + rng.float(-55, 55), z: -650, y: trunk.at(-1)!.y + rng.float(150, 195), left: 240, right: 220 },
            { ...east }] });
    const parent = trunk.at(-1)!, side = rng.chance(.5) ? 1 : -1, crestRidge = ridges[side < 0 ? 0 : ridges.findIndex(r => r.id === 'backbone-1')];
    // An accessible ridge belongs to the same geography and arrives through a
    // winding climb. Its endpoint is within the map's detailed RockSkin interior.
    const target = crestRidge.nodes[crestRidge.nodes.length - 2];
    const crest = makeDistrict(rng, 'crest', 'Обзорный гребень', 'crest', target.x * .85, -535, Math.min(parent.y + 75, target.y - 20), 58, 42, rng.float(-.7, .7));
    const crestDistance = Math.hypot(crest.x - parent.x, crest.z - parent.z);
    crest.tiltX = (crest.x - parent.x) / crestDistance * .12;
    crest.tiltZ = (crest.z - parent.z) / crestDistance * .12;
    let ascent: PlannedRoute | undefined;
    for (let trial = 0; trial < 8 && !ascent && crest.y >= parent.y + 18; trial++) {
        ascent = connect(parent, crest, rng, [...regions, crest], routes, 'ascent');
        if (!ascent)
            crest.y -= 6;
    }
    if (ascent) {
        crest.openX = (parent.x - crest.x) / Math.hypot(parent.x - crest.x, parent.z - crest.z);
        crest.openZ = (parent.z - crest.z) / Math.hypot(parent.x - crest.x, parent.z - crest.z);
        regions.push(crest);
        routes.push(ascent);
    }
    const plan: MountainPlan = { seed, version: GENERATOR_VERSION, spawnRegion: 'lowland', regions, routes, ridges, trunk: trunk.map(r => r.id), yaw: rng.float(-.22, .22), mirror: rng.chance(.5) ? 1 : -1, traversal: routes.map(({ id, from, to, status }) => ({ id, from, to, status })) };
    return freeze(plan);
}
