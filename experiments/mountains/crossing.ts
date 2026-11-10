// A small plan -> terrain + separate bridge experiment, not the mountain generator.
import { terrainMassHeight } from './crossing-form';
export interface CrossingPoint { readonly x: number; readonly y: number; readonly z: number }
export interface CrossingMesh { readonly positions: Float32Array; readonly indices: Uint32Array }
export interface CrossingRoute {
    readonly id: 'lower' | 'ascent' | 'bridge' | 'east';
    readonly kind: 'surface' | 'bridge';
    readonly points: readonly CrossingPoint[];
    readonly width: number;
    readonly maxSlope: number;
}
export interface CrossingRegion {
    readonly id: 'valley' | 'west' | 'east';
    readonly domain: readonly { readonly x: number; readonly z: number }[];
    readonly core: CrossingPoint;
    readonly minConnectedArea: number;
    readonly entrances: readonly string[];
}
export interface CrossingMass {
    readonly x: number; readonly z: number; readonly rx: number; readonly rz: number;
    readonly top: number; readonly side: -1 | 1; readonly face: number; readonly foot: number;
    readonly crown: { readonly x: number; readonly z: number; readonly rx: number; readonly rz: number; readonly rise: number };
}
export interface CrossingPlan {
    readonly version: 'hybrid-crossing-1';
    readonly seed: number;
    readonly island: { readonly radiusX: number; readonly radiusZ: number; readonly seaLevel: number; readonly bottom: number };
    readonly terrain: { readonly cell: number; readonly halfX: number; readonly halfZ: number; readonly floor: number; readonly tiltZ: number };
    readonly regions: readonly CrossingRegion[];
    readonly masses: readonly CrossingMass[];
    readonly routes: readonly CrossingRoute[]; // Original targets; bake never overwrites them.
    readonly bridge: { readonly route: 'bridge'; readonly thickness: number; readonly minClearance: number };
    readonly spawn: CrossingPoint;
}
export interface CrossingWorld {
    readonly plan: CrossingPlan;
    readonly terrain: CrossingMesh;
    readonly bridge: CrossingMesh;
    readonly routes: readonly CrossingRoute[];
    readonly regions: readonly CrossingRegion[];
    readonly bounds: { readonly min: CrossingPoint; readonly max: CrossingPoint };
    readonly realization: { readonly maxSurfaceResidual: number; readonly crossing: { readonly x: number; readonly z: number; readonly terrainY: number; readonly deckY: number; readonly clearance: number } };
    // Exact piecewise-linear sampling of the TERRAIN triangles. The bridge is intentionally absent.
    readonly heightAt: (x: number, z: number) => number;
}
export type CrossingBake = { readonly ok: true; readonly world: CrossingWorld } | { readonly ok: false; readonly issues: readonly { readonly code: string; readonly detail: string }[] };
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const smooth = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
function inside(p: { x: number; z: number }, polygon: readonly { x: number; z: number }[]) {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[j], b = polygon[i];
        if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) hit = !hit;
    }
    return hit;
}
function freeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
}
function random(seed: number) { let n = seed >>> 0; return () => { n += 0x6d2b79f5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function createCrossingPlan(seed: number): CrossingPlan {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Crossing seed must be uint32.');
    const rng = random(seed), range = (a: number, b: number) => a + rng() * (b - a);
    const floor = range(10, 14), tiltZ = range(.004, .012), top = floor + range(36, 44), bridgeZ = range(-5, 5), span = range(62, 68), width = range(6.5, 8.5);
    const point = (x: number, z: number, y = floor + tiltZ * z): CrossingPoint => ({ x, y, z });
    const lower = [point(-3, -132), point(0, bridgeZ), point(4, 55), point(0, 135)];
    const ascent = [lower[lower.length - 1], point(-87, 138, floor + 12), point(-145, 75, top - 10), point(-105, 18, top), point(-span / 2, bridgeZ, top)];
    const bridge = [ascent[ascent.length - 1], point(span / 2, bridgeZ, top)];
    const east = [bridge[1], point(72, bridgeZ - 10, top + 2), point(105, -48, top + 6), point(101, -98, top + 11)];
    const mass = (side: -1 | 1): CrossingMass => ({ side, x: side < 0 ? -91 : 96, z: side < 0 ? -2 : -23, rx: range(106, 114), rz: side < 0 ? range(106, 114) : range(139, 147), top,
        face: span / 2 - 4, foot: 15 + rng(), crown: { x: side * range(155, 163), z: side < 0 ? -61 : -104, rx: range(29, 35), rz: side < 0 ? 54 : 66, rise: range(33, 55) } });
    const regions: CrossingRegion[] = [
        { id: 'valley', core: point(2, 77), minConnectedArea: 1700, entrances: ['lower', 'ascent'], domain: [{ x: -13, z: -100 }, { x: 13, z: -100 }, { x: 20, z: 67 }, { x: 57, z: 139 }, { x: -60, z: 145 }, { x: -22, z: 75 }] },
        { id: 'west', core: point(-83, 8, top), minConnectedArea: 2800, entrances: ['ascent', 'bridge'], domain: [{ x: -130, z: -40 }, { x: -76, z: -60 }, { x: -span / 2 + 2, z: -23 }, { x: -span / 2 + 2, z: 30 }, { x: -95, z: 52 }, { x: -135, z: 21 }] },
        { id: 'east', core: east[east.length - 1], minConnectedArea: 4200, entrances: ['bridge'], domain: [{ x: span / 2 - 2, z: 20 }, { x: span / 2 - 2, z: -26 }, { x: 75, z: -43 }, { x: 66, z: -95 }, { x: 98, z: -116 }, { x: 130, z: -94 }, { x: 141, z: -45 }, { x: 132, z: 22 }, { x: 88, z: 44 }] },
    ];
    return freeze({ version: 'hybrid-crossing-1', seed, island: { radiusX: 216, radiusZ: 211, seaLevel: 0, bottom: -12 }, terrain: { cell: 2, halfX: 220, halfZ: 220, floor, tiltZ },
        masses: [mass(-1), mass(1)], regions, routes: [
            { id: 'lower', kind: 'surface', points: lower, width: 18, maxSlope: .08 },
            { id: 'ascent', kind: 'surface', points: ascent, width: 18, maxSlope: .36 },
            { id: 'bridge', kind: 'bridge', points: bridge, width, maxSlope: .08 },
            { id: 'east', kind: 'surface', points: east, width: 20, maxSlope: .12 },
        ], bridge: { route: 'bridge', thickness: 1.4, minClearance: 4 }, spawn: lower[lower.length - 1] });
}
function project(route: CrossingRoute, x: number, z: number) {
    let best = { distance: Infinity, y: 0 }, segment = -1;
    for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1], b = route.points[i], dx = b.x - a.x, dz = b.z - a.z;
        const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1), d = Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
        if (d < best.distance) { best = { distance: d, y: a.y + t * (b.y - a.y) }; segment = i - 1; }
    }
    for (let i = 1; i < route.points.length - 1; i++) {
        if (segment !== i - 1 && segment !== i) continue;
        const a = route.points[i - 1], b = route.points[i], c = route.points[i + 1];
        const ax = a.x - b.x, az = a.z - b.z, cx = c.x - b.x, cz = c.z - b.z, determinant = ax * cz - az * cx;
        if (Math.abs(determinant) < 1e-7) continue;
        // Both original centerlines lie in this plane. It removes the height jump
        // where the nearest segment changes inside a bend, without moving targets.
        const gx = ((a.y - b.y) * cz - az * (c.y - b.y)) / determinant;
        const gz = (ax * (c.y - b.y) - (a.y - b.y) * cx) / determinant;
        const cos = clamp((ax * cx + az * cz) / (Math.hypot(ax, az) * Math.hypot(cx, cz)), -1, 1);
        const radius = (route.width / 2 + 2) / Math.sqrt((1 - cos) / 2) + 2;
        // The entire width plus the two-meter reserve lies in the plane at the
        // junction; its transition starts outside that protected part of the bend.
        const weight = smooth((radius + 9 - Math.hypot(x - b.x, z - b.z)) / 9);
        best.y += (b.y + gx * (x - b.x) + gz * (z - b.z) - best.y) * weight;
    }
    return best;
}
function terrainTarget(plan: CrossingPlan, x: number, z: number) {
    let y = terrainMassHeight(plan, x, z);
    for (const route of plan.routes) if (route.kind === 'surface') {
        const p = project(route, x, z), inner = route.width / 2 + plan.terrain.cell;
        y += (p.y - y) * smooth((inner + 9 - p.distance) / 9);
    }
    const island = Math.hypot(x / plan.island.radiusX, z / plan.island.radiusZ);
    return plan.island.bottom + (y - plan.island.bottom) * smooth((1.08 - island) / .18);
}
function meshBridge(route: CrossingRoute, thickness: number): CrossingMesh {
    const [a, b] = route.points, length = distance(a, b), nx = -(b.z - a.z) / length * route.width / 2, nz = (b.x - a.x) / length * route.width / 2;
    const positions = new Float32Array([
        a.x - nx, a.y, a.z - nz, b.x - nx, b.y, b.z - nz, b.x + nx, b.y, b.z + nz, a.x + nx, a.y, a.z + nz,
        a.x - nx, a.y - thickness, a.z - nz, b.x - nx, b.y - thickness, b.z - nz, b.x + nx, b.y - thickness, b.z + nz, a.x + nx, a.y - thickness, a.z + nz,
    ]);
    return { positions, indices: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]) };
}
export function bakeCrossing(plan: CrossingPlan): CrossingBake {
    const issues: { code: string; detail: string }[] = [], add = (code: string, detail: string) => issues.push({ code, detail });
    const finite = (p: CrossingPoint) => [p.x, p.y, p.z].every(Number.isFinite);
    if (plan.version !== 'hybrid-crossing-1' || ![plan.terrain.cell, plan.terrain.halfX, plan.terrain.halfZ, plan.terrain.floor, plan.terrain.tiltZ, plan.island.radiusX, plan.island.radiusZ, plan.island.bottom, plan.island.seaLevel, plan.bridge.thickness, plan.bridge.minClearance].every(Number.isFinite) || plan.terrain.cell < .5 || plan.terrain.cell > 4 || plan.terrain.halfX <= 0 || plan.terrain.halfZ <= 0 || plan.terrain.halfX / plan.terrain.cell > 500 || plan.terrain.halfZ / plan.terrain.cell > 500 || plan.bridge.thickness <= 0 || plan.bridge.minClearance < 2 || plan.island.radiusX <= 0 || plan.island.radiusZ <= 0 || plan.island.bottom >= plan.island.seaLevel - 1) add('invalid-contract', 'Finite bounded terrain, submerged bottom, positive bridge thickness and pedestrian clearance are required.');
    if (plan.masses.length !== 2 || plan.masses.some(m => ![m.x, m.z, m.rx, m.rz, m.top, m.face, m.foot, m.crown.x, m.crown.z, m.crown.rx, m.crown.rz, m.crown.rise].every(Number.isFinite) || m.rx <= 0 || m.rz <= 0 || m.face <= m.foot || m.crown.rx <= 0 || m.crown.rz <= 0 || ![-1, 1].includes(m.side))) add('invalid-mass', 'Two finite supporting masses are required.');
    if (plan.island.radiusX > plan.terrain.halfX || plan.island.radiusZ > plan.terrain.halfZ) add('island-outside-mesh', 'The declared finite island must fit inside the terrain mesh bounds.');
    const bridgeRoute = plan.routes.find(r => r.id === 'bridge'), lowerRoute = plan.routes.find(r => r.id === 'lower');
    if (plan.routes.length !== 4 || new Set(plan.routes.map(r => r.id)).size !== 4 || !bridgeRoute || !lowerRoute || bridgeRoute.kind !== 'bridge' || bridgeRoute.points.length !== 2) add('invalid-routes', 'Require lower, ascent, bridge and east routes, with a two-point bridge.');
    for (const route of plan.routes) {
        if (route.points.length < 2 || !route.points.every(finite) || !(route.width >= 3 && route.width <= 30 && route.maxSlope > 0 && route.maxSlope <= .5)) { add('invalid-route', route.id); continue; }
        for (let i = 1; i < route.points.length; i++) {
            const a = route.points[i - 1], b = route.points[i], run = distance(a, b);
            if (run < .1 || Math.abs(b.y - a.y) / run > route.maxSlope) add('planned-slope', route.id);
        }
        if (route.points.some(p => p.y < plan.island.seaLevel + 3 || Math.hypot(p.x / plan.island.radiusX, p.z / plan.island.radiusZ) > .88)) add('route-outside-dry-interior', route.id);
        if (route.points.some(p => Math.abs(p.x) + route.width / 2 + plan.terrain.cell > plan.terrain.halfX || Math.abs(p.z) + route.width / 2 + plan.terrain.cell > plan.terrain.halfZ)) add('route-outside-mesh', route.id);
    }
    const expectedEntrances = { valley: ['ascent', 'lower'], west: ['ascent', 'bridge'], east: ['bridge'] };
    if (plan.regions.length !== 3 || new Set(plan.regions.map(r => r.id)).size !== 3) add('invalid-regions', 'Require distinct valley, west and east living regions.');
    for (const r of plan.regions) {
        const area = Math.abs(r.domain.reduce((sum, p, i) => { const q = r.domain[(i + 1) % r.domain.length]; return sum + p.x * q.z - p.z * q.x; }, 0)) / 2;
        if (!expectedEntrances[r.id] || r.domain.length < 3 || !r.domain.every(p => Number.isFinite(p.x) && Number.isFinite(p.z)) || !finite(r.core) || !inside(r.core, r.domain) || !(r.minConnectedArea > 0 && r.minConnectedArea <= area) || JSON.stringify([...r.entrances].sort()) !== JSON.stringify(expectedEntrances[r.id])) add('invalid-region', r.id);
        if (r.domain.some(p => Math.abs(p.x) + plan.terrain.cell > plan.terrain.halfX || Math.abs(p.z) + plan.terrain.cell > plan.terrain.halfZ || Math.hypot(p.x / plan.island.radiusX, p.z / plan.island.radiusZ) > .88)) add('region-outside-interior', r.id);
    }
    if (!finite(plan.spawn)) add('invalid-spawn', 'Spawn coordinates must be finite.');
    if (issues.length) return { ok: false, issues };
    const bridge = bridgeRoute!, lower = lowerRoute!, ascent = plan.routes.find(r => r.id === 'ascent'), east = plan.routes.find(r => r.id === 'east');
    const same = (a: CrossingPoint, b: CrossingPoint) => distance(a, b) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
    if (!ascent || !east || ascent.kind !== 'surface' || east.kind !== 'surface' || lower.kind !== 'surface' || !same(ascent.points[0], plan.spawn) || !same(ascent.points[ascent.points.length - 1], bridge.points[0]) || !same(bridge.points[1], east.points[0])) add('planned-junction', 'Ascent, bridge and east profiles must share their original endpoints.');
    if (Math.abs(bridge.points[0].z - bridge.points[1].z) > 1e-6 || bridge.points[1].x - bridge.points[0].x < 8) add('bridge-footprint', 'This prototype supports one bridge aligned with X and a span of at least eight meters.');
    if (issues.length) return { ok: false, issues };
    const [ba, bb] = bridge.points;
    const axis = (half: number, cuts: number[]) => {
        const n = Math.ceil(2 * half / plan.terrain.cell);
        return [...new Set([...Array.from({ length: n + 1 }, (_, i) => -half + 2 * half * i / n), ...cuts].map(Math.fround))].sort((a, b) => a - b);
    };
    // Exact footprint cuts prevent a regular-grid triangle from extending a
    // coplanar landing beneath the deck. Its shared boundary keeps the bank intact.
    const xs = axis(plan.terrain.halfX, [ba.x, ba.x + .08, bb.x - .08, bb.x]);
    const lowZ = Math.fround(ba.z - bridge.width / 2), highZ = Math.fround(ba.z + bridge.width / 2);
    const zs = axis(plan.terrain.halfZ, [lowZ, lowZ + .08, highZ - .08, highZ]);
    const nx = xs.length - 1, nz = zs.length - 1;
    const positions = new Float32Array((nx + 1) * (nz + 1) * 3), indices = new Uint32Array(nx * nz * 6), flipped = new Uint8Array(nx * nz);
    let minY = Infinity, maxY = -Infinity, dryBoundary = false;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const x = xs[i], z = zs[j];
        let y = terrainTarget(plan, x, z);
        if (x > Math.fround(ba.x) && x < Math.fround(bb.x) && z > lowZ && z < highZ) {
            const deck = ba.y + (bb.y - ba.y) * (x - ba.x) / (bb.x - ba.x);
            y = Math.min(y, deck - plan.bridge.thickness - .04);
        }
        positions.set([x, y, z], (j * (nx + 1) + i) * 3); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        if ((i === 0 || j === 0 || i === nx || j === nz) && y >= plan.island.seaLevel - 1) dryBoundary = true;
    }
    if (dryBoundary) add('dry-mesh-boundary', 'The finite fragment must end below sea level.');
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        const onDeck = (k: number) => Math.abs(positions[k * 3 + 1] - (ba.y + (bb.y - ba.y) * (positions[k * 3] - ba.x) / (bb.x - ba.x))) < 1e-5;
        const insideDeck = xs[i] >= Math.fround(ba.x) && xs[i + 1] <= Math.fround(bb.x) && zs[j] >= lowZ && zs[j + 1] <= highZ;
        // Keep the exterior bank untouched. At a footprint corner, connect the
        // boundary corner to the lowered interior vertex instead of leaving a
        // triangle of three coplanar boundary vertices beneath the deck.
        const flip = insideDeck && (onDeck(a) && onDeck(c) && onDeck(b) || onDeck(b) && onDeck(c) && onDeck(d)) && ![a, b, c, d].every(onDeck);
        if (flip) flipped[j * nx + i] = 1;
        indices.set(flip ? [a, c, d, a, d, b] : [a, c, b, b, c, d], (j * nx + i) * 6);
    }
    const heightAt = (x: number, z: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(z) || x < xs[0] || z < zs[0] || x > xs[nx] || z > zs[nz]) return NaN;
        const locate = (values: number[], value: number) => { let lo = 0, hi = values.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (value < values[mid]) hi = mid; else lo = mid; } return Math.min(lo, values.length - 2); };
        const i = locate(xs, x), j = locate(zs, z), u = (x - xs[i]) / (xs[i + 1] - xs[i]), v = (z - zs[j]) / (zs[j + 1] - zs[j]), a = j * (nx + 1) + i;
        const y = (k: number) => positions[k * 3 + 1];
        if (flipped[j * nx + i]) return v >= u ? y(a) + v * (y(a + nx + 1) - y(a)) + u * (y(a + nx + 2) - y(a + nx + 1)) : y(a) + u * (y(a + 1) - y(a)) + v * (y(a + nx + 2) - y(a + 1));
        return u + v <= 1 ? y(a) + u * (y(a + 1) - y(a)) + v * (y(a + nx + 1) - y(a)) : y(a + nx + 2) + (1 - u) * (y(a + nx + 1) - y(a + nx + 2)) + (1 - v) * (y(a + 1) - y(a + nx + 2));
    };
    let residual = 0;
    for (const route of plan.routes) if (route.kind === 'surface') for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1], b = route.points[i], steps = Math.ceil(distance(a, b));
        for (let k = 0; k <= steps; k++) { const t = k / steps, x = a.x + t * (b.x - a.x), z = a.z + t * (b.z - a.z), y = a.y + t * (b.y - a.y); residual = Math.max(residual, Math.abs(heightAt(x, z) - y)); }
    }
    if (!Number.isFinite(residual) || residual > .18) add('surface-profile-residual', `Terrain differs from retained target by ${residual.toFixed(3)} m.`);
    for (const r of plan.regions) if (!Number.isFinite(heightAt(r.core.x, r.core.z)) || Math.abs(heightAt(r.core.x, r.core.z) - r.core.y) > .18 || r.core.y < plan.island.seaLevel + 3) add('region-core-profile', r.id);
    for (const p of bridge.points) if (!Number.isFinite(heightAt(p.x, p.z)) || Math.abs(heightAt(p.x, p.z) - p.y) > .12) add('bridge-abutment', 'Deck and supporting terrain disagree; the plan is not repaired.');
    const center = { x: (bridge.points[0].x + bridge.points[1].x) / 2, z: (bridge.points[0].z + bridge.points[1].z) / 2 }, deckY = (bridge.points[0].y + bridge.points[1].y) / 2, terrainY = heightAt(center.x, center.z);
    let clearance = deckY - plan.bridge.thickness - terrainY;
    const length = distance(ba, bb), across = { x: -(bb.z - ba.z) / length, z: (bb.x - ba.x) / length };
    for (let k = 0; k <= Math.ceil(length); k++) for (const side of [-.5, 0, .5]) {
        const t = k / Math.ceil(length), x = ba.x + t * (bb.x - ba.x) + across.x * side * bridge.width, z = ba.z + t * (bb.z - ba.z) + across.z * side * bridge.width;
        if (project(lower, x, z).distance <= lower.width / 2 + .3) clearance = Math.min(clearance, ba.y + t * (bb.y - ba.y) - plan.bridge.thickness - heightAt(x, z));
    }
    if (project(lower, center.x, center.z).distance > lower.width / 2) add('missing-crossing', 'The bridge must actually cross the lower path in XZ.');
    if (!Number.isFinite(clearance) || clearance < plan.bridge.minClearance) add('bridge-clearance', `Underside clearance ${clearance.toFixed(3)} is below ${plan.bridge.minClearance}.`);
    if (issues.length) return { ok: false, issues };
    return { ok: true, world: { plan, terrain: { positions, indices }, bridge: meshBridge(bridge, plan.bridge.thickness), routes: plan.routes, regions: plan.regions,
        bounds: { min: { x: -plan.terrain.halfX, y: minY, z: -plan.terrain.halfZ }, max: { x: plan.terrain.halfX, y: maxY, z: plan.terrain.halfZ } }, heightAt,
        realization: { maxSurfaceResidual: residual, crossing: { ...center, terrainY, deckY, clearance } } } };
}
