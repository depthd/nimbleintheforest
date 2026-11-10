// Pre-terrain planning only. Nothing here samples or rewrites realized terrain.
export const PLAN_VERSION = 'living-regions-1';
export interface Vec2 { readonly x: number; readonly z: number }
export interface PlannedPoint extends Vec2 { readonly y: number }
export type Polygon = readonly Vec2[];
export interface PathReservation {
    readonly plannedProfile: readonly PlannedPoint[];
    readonly reservation: Polygon;
    readonly width: number;
    readonly clearance: number;
    readonly minLength: number;
    readonly maxLength: number;
    readonly maxSlope: number; // rise / horizontal run, never degrees
}
export interface RegionPort {
    readonly id: string;
    readonly regionId: string;
    readonly connectionId: string;
    readonly position: PlannedPoint;
    readonly localAccess: PathReservation;
}
export interface LivingRegionPlan {
    readonly id: string;
    readonly domain: Polygon;
    readonly core: Polygon;
    readonly elevation: number;
    readonly profile: { readonly kind: 'plane'; readonly origin: Vec2; readonly tiltX: number; readonly tiltZ: number };
    // The minimum area is a bake acceptance requirement, not a realized-area claim.
    readonly access: { readonly core: Vec2; readonly minConnectedArea: number };
    readonly ports: readonly RegionPort[];
}
interface ConnectionBase {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly fromPort: string;
    readonly toPort: string;
}
export interface SurfaceConnectionPlan extends ConnectionBase, PathReservation {
    readonly kind: 'surface';
    readonly status: 'planned';
}
// These contracts are deliberately not converted to surface paths by this stage.
export interface BridgeConnectionPlan extends ConnectionBase {
    readonly kind: 'bridge';
    readonly bake: 'unsupported';
    readonly deckProfile: readonly PlannedPoint[];
    readonly width: number;
    readonly minimumUnderClearance: number;
}
export interface CaveConnectionPlan extends ConnectionBase {
    readonly kind: 'cave';
    readonly bake: 'unsupported';
    readonly tunnelProfile: readonly PlannedPoint[];
    readonly width: number;
    readonly minimumHeadroom: number;
}
export type ConnectionPlan = SurfaceConnectionPlan | BridgeConnectionPlan | CaveConnectionPlan;
export interface WorldPlan {
    readonly seed: number;
    readonly version: typeof PLAN_VERSION;
    readonly island: { readonly polygon: Polygon; readonly margin: number; readonly seaLevel: number; readonly drySurfaceMargin: number };
    readonly spawnRegion: string;
    readonly regions: readonly LivingRegionPlan[];
    readonly connections: readonly ConnectionPlan[];
}
export interface PlanIssue { readonly code: string; readonly subject: string }
export interface PlanDiagnostics {
    readonly requestedRegions: number;
    readonly attachmentAttempts: number;
    readonly loopAttempts: number;
    readonly rejected: Readonly<Record<string, number>>;
}
export type PlanResult =
    | { readonly ok: true; readonly plan: WorldPlan; readonly diagnostics: PlanDiagnostics }
    | { readonly ok: false; readonly code: 'invalid-config' | 'placement-exhausted'; readonly message: string;
        readonly seed: number; readonly partialPlan: WorldPlan | null; readonly diagnostics: PlanDiagnostics };
export type PlanMutation =
    | { readonly ok: true; readonly plan: WorldPlan }
    | { readonly ok: false; readonly plan: WorldPlan; readonly issues: readonly PlanIssue[] };
export interface PlanConfig {
    readonly regionCount?: number;
    readonly islandRadius?: number;
    readonly islandMargin?: number;
    readonly attemptsPerRegion?: number;
    readonly maxLoops?: number;
}
interface SurfaceOptions { readonly width?: number; readonly clearance?: number; readonly maxSlope?: number }
const EPS = 1e-7;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
const cross = (a: Vec2, b: Vec2) => a.x * b.z - a.z * b.x;
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const equalPoint = (a: PlannedPoint, b: PlannedPoint) => distance(a, b) < EPS && Math.abs(a.y - b.y) < EPS;
function freeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}
export function polygonArea(polygon: Polygon): number {
    return polygon.reduce((sum, p, i) => sum + cross(p, polygon[(i + 1) % polygon.length]), 0) / 2;
}
// Convex CCW polygons keep containment and clearance checks exact, without a grid.
export function insideWithMargin(point: Vec2, polygon: Polygon, margin = 0): boolean {
    return polygon.every((a, i) => {
        const b = polygon[(i + 1) % polygon.length];
        return cross(sub(b, a), sub(point, a)) >= (margin - EPS) * distance(a, b);
    });
}
function convex(p: Polygon): boolean {
    return p.length >= 3 && p.every(v => Number.isFinite(v.x) && Number.isFinite(v.z)) && polygonArea(p) > EPS &&
        p.every((a, i) => cross(sub(p[(i + 1) % p.length], a), sub(p[(i + 2) % p.length], p[(i + 1) % p.length])) > EPS);
}
function intersection(subject: Polygon, clip: Polygon): Vec2[] {
    let result = [...subject];
    for (let i = 0; i < clip.length && result.length; i++) {
        const a = clip[i], b = clip[(i + 1) % clip.length], edge = sub(b, a), input = result;
        result = [];
        for (let j = 0; j < input.length; j++) {
            const p = input[j], q = input[(j + 1) % input.length];
            const dp = cross(edge, sub(p, a)), dq = cross(edge, sub(q, a));
            if (dp >= -EPS) result.push(p);
            if ((dp >= -EPS) !== (dq >= -EPS)) {
                const t = dp / (dp - dq);
                result.push({ x: p.x + t * (q.x - p.x), z: p.z + t * (q.z - p.z) });
            }
        }
    }
    return result;
}
function overlaps(a: Polygon, b: Polygon): boolean { return Math.abs(polygonArea(intersection(a, b))) > EPS; }
function ellipse(center: Vec2, rx: number, rz: number, yaw = 0, sides = 12): Polygon {
    return Array.from({ length: sides }, (_, i) => {
        const angle = i * Math.PI * 2 / sides, x = Math.cos(angle) * rx, z = Math.sin(angle) * rz;
        return { x: center.x + x * Math.cos(yaw) - z * Math.sin(yaw), z: center.z + x * Math.sin(yaw) + z * Math.cos(yaw) };
    });
}
export function plannedFloor(region: LivingRegionPlan, p: Vec2): number {
    return region.elevation + (p.x - region.profile.origin.x) * region.profile.tiltX + (p.z - region.profile.origin.z) * region.profile.tiltZ;
}
export function planRegion(id: string, center: Vec2, radii: Vec2, elevation: number, tilt: Vec2 = { x: 0, z: 0 }, yaw = 0): LivingRegionPlan {
    const core = ellipse(center, radii.x * .52, radii.z * .52, yaw);
    return freeze({ id, domain: ellipse(center, radii.x, radii.z, yaw), core, elevation,
        profile: { kind: 'plane' as const, origin: { ...center }, tiltX: tilt.x, tiltZ: tilt.z },
        access: { core: { ...center }, minConnectedArea: polygonArea(core) * .8 }, ports: [] });
}
// Conservative square caps include the full walk width plus clearance at both ends.
function reserve(a: Vec2, b: Vec2, radius: number): Polygon {
    const length = distance(a, b), dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
    const u = { x: dx * radius, z: dz * radius }, v = { x: -dz * radius, z: dx * radius };
    return [
        { x: a.x - u.x - v.x, z: a.z - u.z - v.z }, { x: b.x + u.x - v.x, z: b.z + u.z - v.z },
        { x: b.x + u.x + v.x, z: b.z + u.z + v.z }, { x: a.x - u.x + v.x, z: a.z - u.z + v.z },
    ];
}
function path(a: PlannedPoint, b: PlannedPoint, width: number, clearance: number, maxSlope: number, minLength: number, maxLength: number): PathReservation {
    return { plannedProfile: [a, b], reservation: reserve(a, b, width / 2 + clearance), width, clearance, maxSlope, minLength, maxLength };
}
function port(region: LivingRegionPlan, target: Vec2, connectionId: string, width: number, clearance: number): RegionPort {
    const center = region.access.core, length = distance(center, target), direction = { x: (target.x - center.x) / length, z: (target.z - center.z) / length };
    const inset = Math.SQRT2 * (width / 2 + clearance) + 1;
    let reach = Infinity;
    for (let i = 0; i < region.domain.length; i++) {
        const a = region.domain[i], b = region.domain[(i + 1) % region.domain.length], edge = sub(b, a), rate = cross(edge, direction);
        if (rate < -EPS) reach = Math.min(reach, (cross(edge, sub(center, a)) - inset * distance(a, b)) / -rate);
    }
    const p = { x: center.x + direction.x * reach, z: center.z + direction.z * reach };
    const position = { ...p, y: plannedFloor(region, p) }, start = { ...center, y: plannedFloor(region, center) };
    return { id: `${connectionId}:${region.id}`, regionId: region.id, connectionId, position,
        localAccess: path(start, position, width, clearance, .12, 1, 250) };
}
function surface(from: LivingRegionPlan, to: LivingRegionPlan, id: string, options: SurfaceOptions) {
    const width = options.width ?? 12, clearance = options.clearance ?? 6;
    const a = port(from, to.access.core, id, width, clearance), b = port(to, from.access.core, id, width, clearance);
    const connection: SurfaceConnectionPlan = { id, kind: 'surface', status: 'planned', from: from.id, to: to.id, fromPort: a.id, toPort: b.id,
        ...path(a.position, b.position, width, clearance, options.maxSlope ?? .36, 30, 440) };
    return { a, b, connection };
}
function pathIssues(p: PathReservation, subject: string, issues: PlanIssue[]) {
    const points = p.plannedProfile;
    if (points.length !== 2 || !points.every(q => [q.x, q.y, q.z].every(Number.isFinite)) ||
        ![p.width, p.clearance, p.maxSlope, p.minLength, p.maxLength].every(Number.isFinite) ||
        !(p.width > 0 && p.clearance >= 0 && p.maxSlope > 0 && p.maxSlope <= .5 && p.minLength >= 0 && p.maxLength >= p.minLength)) {
        issues.push({ code: 'invalid-path-contract', subject }); return;
    }
    const length = distance(points[0], points[1]);
    if (length < p.minLength - EPS || length > p.maxLength + EPS) issues.push({ code: 'path-length', subject });
    if (length <= EPS || Math.abs(points[1].y - points[0].y) > length * p.maxSlope + EPS) issues.push({ code: 'path-slope', subject });
    const expected = reserve(points[0], points[1], p.width / 2 + p.clearance);
    if (p.reservation.length !== 4 || expected.some((q, i) => !p.reservation[i] || distance(q, p.reservation[i]) > EPS))
        issues.push({ code: 'path-reservation', subject });
}
export function validateWorldPlan(plan: WorldPlan): PlanIssue[] {
    const issues: PlanIssue[] = [], add = (code: string, subject: string) => issues.push({ code, subject });
    if (!convex(plan.island.polygon) || ![plan.island.margin, plan.island.seaLevel, plan.island.drySurfaceMargin].every(Number.isFinite) || plan.island.margin < 0 || plan.island.drySurfaceMargin <= 0) add('invalid-island', 'island');
    const dryFloor = plan.island.seaLevel + plan.island.drySurfaceMargin;
    const regions = new Map(plan.regions.map(r => [r.id, r]));
    if (regions.size !== plan.regions.length) add('duplicate-region', 'regions');
    if (!regions.has(plan.spawnRegion)) add('missing-spawn', plan.spawnRegion);
    const connections = new Map(plan.connections.map(c => [c.id, c]));
    if (connections.size !== plan.connections.length) add('duplicate-connection', 'connections');
    for (const r of plan.regions) {
        if (!convex(r.domain) || !convex(r.core)) add('invalid-region-polygon', r.id);
        if (!r.domain.every(p => insideWithMargin(p, plan.island.polygon, plan.island.margin))) add('domain-outside-island', r.id);
        if (!r.core.every(p => insideWithMargin(p, r.domain)) || !insideWithMargin(r.access.core, r.core)) add('core-outside-domain', r.id);
        if (!(r.access.minConnectedArea > 0 && r.access.minConnectedArea <= polygonArea(r.core))) add('core-area', r.id);
        if (![r.elevation, r.profile.origin.x, r.profile.origin.z, r.profile.tiltX, r.profile.tiltZ].every(Number.isFinite) || Math.hypot(r.profile.tiltX, r.profile.tiltZ) > .12) add('region-profile', r.id);
        // A plane reaches its minimum at a convex-domain vertex; checking the center is insufficient.
        if (r.domain.some(p => plannedFloor(r, p) < dryFloor - EPS)) add('region-below-dry-surface', r.id);
        if (new Set(r.ports.map(p => p.id)).size !== r.ports.length) add('duplicate-port', r.id);
        for (const p of r.ports) {
            const c = connections.get(p.connectionId);
            if (p.regionId !== r.id || !c || !(c.from === r.id && c.fromPort === p.id || c.to === r.id && c.toPort === p.id)) add('orphan-port', p.id);
            pathIssues(p.localAccess, p.id, issues);
            if (!p.localAccess.reservation.every(q => insideWithMargin(q, r.domain))) add('local-access-outside-domain', p.id);
            const points = p.localAccess.plannedProfile;
            if (!points.length || !equalPoint(points[0], { ...r.access.core, y: plannedFloor(r, r.access.core) }) || !equalPoint(points[points.length - 1], p.position) || points.some(q => Math.abs(q.y - plannedFloor(r, q)) > EPS)) add('local-access-profile', p.id);
        }
    }
    for (let i = 0; i < plan.regions.length; i++) for (let j = i + 1; j < plan.regions.length; j++)
        if (overlaps(plan.regions[i].domain, plan.regions[j].domain)) add('overlapping-domains', `${plan.regions[i].id}/${plan.regions[j].id}`);
    const pairs = new Set<string>();
    for (const c of plan.connections) {
        const a = regions.get(c.from), b = regions.get(c.to), pair = [c.from, c.to].sort().join('/');
        if (!a || !b || a === b) { add('invalid-endpoints', c.id); continue; }
        if (pairs.has(pair)) add('duplicate-region-link', c.id);
        pairs.add(pair);
        if (c.kind !== 'surface') { add('unsupported-connection-kind', c.id); continue; }
        pathIssues(c, c.id, issues);
        // Straight, linearly graded profiles cannot dip below their endpoints.
        if (c.plannedProfile.some(p => p.y < dryFloor - EPS)) add('surface-below-dry-surface', c.id);
        const pa = a.ports.find(p => p.id === c.fromPort), pb = b.ports.find(p => p.id === c.toPort);
        if (!pa || !pb || !c.plannedProfile.length || !equalPoint(c.plannedProfile[0], pa.position) || !equalPoint(c.plannedProfile[c.plannedProfile.length - 1], pb.position)) add('missing-port-or-profile-mismatch', c.id);
        if (pa && pb && [pa, pb].some(p => p.connectionId !== c.id || p.localAccess.width < c.width || p.localAccess.clearance < c.clearance)) add('port-width-or-ownership', c.id);
        if (!c.reservation.every(p => insideWithMargin(p, plan.island.polygon, plan.island.margin))) add('corridor-outside-island', c.id);
        for (const r of plan.regions) if (r !== a && r !== b && overlaps(c.reservation, r.domain)) add('corridor-through-unrelated-domain', `${c.id}/${r.id}`);
    }
    for (let i = 0; i < plan.connections.length; i++) for (let j = i + 1; j < plan.connections.length; j++) {
        const a = plan.connections[i], b = plan.connections[j];
        if (a.kind !== 'surface' || b.kind !== 'surface') continue;
        const shared = [a.from, a.to].find(id => id === b.from || id === b.to), junction = shared ? regions.get(shared) : undefined;
        const overlap = intersection(a.reservation, b.reservation);
        // Shared living regions are explicit junctions. Any overlap outside one is rejected.
        if (Math.abs(polygonArea(overlap)) > EPS && (!junction || !overlap.every(p => insideWithMargin(p, junction.domain)))) add('surface-crossing', `${a.id}/${b.id}`);
    }
    const seen = new Set([plan.spawnRegion]);
    for (let i = 0; i < plan.regions.length; i++) for (const c of plan.connections) {
        if (seen.has(c.from)) seen.add(c.to);
        if (seen.has(c.to)) seen.add(c.from);
    }
    for (const r of plan.regions) if (!seen.has(r.id)) add('orphan-region', r.id);
    return issues;
}
function commitCandidate(original: WorldPlan, candidate: WorldPlan): PlanMutation {
    const issues = validateWorldPlan(candidate);
    return issues.length ? { ok: false, plan: original, issues } : { ok: true, plan: freeze(candidate) };
}
// Atomic: a failed candidate returns the exact original object, with no new region or port.
export function attachRegion(plan: WorldPlan, region: LivingRegionPlan, fromRegion: string, options: SurfaceOptions = {}): PlanMutation {
    const from = plan.regions.find(r => r.id === fromRegion);
    if (!from || plan.regions.some(r => r.id === region.id) || region.ports.length)
        return { ok: false, plan, issues: [{ code: 'invalid-attachment', subject: region.id }] };
    const { a, b, connection } = surface(from, region, `c${plan.connections.length}`, options);
    return commitCandidate(plan, { ...plan, regions: [...plan.regions.map(r => r === from ? { ...r, ports: [...r.ports, a] } : r), { ...region, ports: [b] }], connections: [...plan.connections, connection] });
}
export function addLoop(plan: WorldPlan, fromRegion: string, toRegion: string, options: SurfaceOptions = {}): PlanMutation {
    const from = plan.regions.find(r => r.id === fromRegion), to = plan.regions.find(r => r.id === toRegion);
    if (!from || !to || from === to || plan.connections.some(c => c.from === from.id && c.to === to.id || c.from === to.id && c.to === from.id))
        return { ok: false, plan, issues: [{ code: 'invalid-loop', subject: `${fromRegion}/${toRegion}` }] };
    const { a, b, connection } = surface(from, to, `c${plan.connections.length}`, options);
    return commitCandidate(plan, { ...plan, regions: plan.regions.map(r => r === from ? { ...r, ports: [...r.ports, a] } : r === to ? { ...r, ports: [...r.ports, b] } : r), connections: [...plan.connections, connection] });
}
function random(seed: number) {
    let state = seed >>> 0;
    return () => { state += 0x6d2b79f5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
export function generateWorldPlan(seed: number, config: PlanConfig = {}): PlanResult {
    const rng = random(seed), between = (lo: number, hi: number) => lo + rng() * (hi - lo);
    const count = config.regionCount ?? 4 + Math.floor(rng() * 5), radius = config.islandRadius ?? 700;
    const margin = config.islandMargin ?? 18, attempts = config.attemptsPerRegion ?? 180, maxLoops = config.maxLoops ?? 2;
    const rejected: Record<string, number> = {};
    let attachmentAttempts = 0, loopAttempts = 0;
    const diagnostics = (): PlanDiagnostics => ({ requestedRegions: count, attachmentAttempts, loopAttempts, rejected: { ...rejected } });
    const failure = (code: 'invalid-config' | 'placement-exhausted', message: string, partialPlan: WorldPlan | null): PlanResult => ({ ok: false, code, message, seed, partialPlan, diagnostics: diagnostics() });
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isInteger(count) || count < 2 || count > 12 || !(radius > 0 && Number.isFinite(radius)) || !(margin >= 0 && Number.isFinite(margin)) || !Number.isInteger(attempts) || attempts < 1 || attempts > 10000 || !Number.isInteger(maxLoops) || maxLoops < 0 || maxLoops > 8)
        return failure('invalid-config', 'Use uint32 seed, 2–12 regions, positive radius, nonnegative margin, 1–10000 attempts, and 0–8 loops.', null);
    let plan: WorldPlan = freeze({ seed, version: PLAN_VERSION, island: { polygon: ellipse({ x: 0, z: 0 }, radius, radius * .9, between(-.3, .3), 16), margin, seaLevel: 0, drySurfaceMargin: 3 }, spawnRegion: 'r0',
        regions: [planRegion('r0', { x: between(-35, 35), z: between(-35, 35) }, { x: between(92, 122), z: between(76, 108) }, between(28, 54), { x: between(-.035, .035), z: between(-.035, .035) }, between(0, Math.PI))], connections: [] });
    const initial = validateWorldPlan(plan);
    if (initial.length) {
        for (const issue of initial) rejected[issue.code] = (rejected[issue.code] ?? 0) + 1;
        return failure('placement-exhausted', 'The spawn region does not fit inside this island with its margin.', null);
    }
    function record(result: PlanMutation): boolean {
        if (result.ok) { plan = result.plan; return true; }
        for (const issue of result.issues) rejected[issue.code] = (rejected[issue.code] ?? 0) + 1;
        return false;
    }
    // Larger domains receive more opportunities to attach or to gain an optional loop.
    function pickRegion(): LivingRegionPlan {
        let choice = rng() * plan.regions.reduce((sum, r) => sum + polygonArea(r.domain), 0);
        return plan.regions.find(r => (choice -= polygonArea(r.domain)) <= 0) ?? plan.regions[plan.regions.length - 1];
    }
    for (let i = 1; i < count; i++) {
        let accepted = false;
        for (let trial = 0; trial < attempts && !accepted; trial++) {
            attachmentAttempts++;
            const parent = pickRegion(), small = rng() < .43, rx = small ? between(43, 62) : between(88, 135), rz = rx * between(.72, 1.12);
            const angle = between(0, Math.PI * 2), parentRadius = Math.max(...parent.domain.map(p => distance(p, parent.access.core)));
            const gap = between(48, 160), separation = parentRadius + Math.max(rx, rz) + gap;
            const center = { x: parent.access.core.x + Math.cos(angle) * separation, z: parent.access.core.z + Math.sin(angle) * separation };
            const elevation = parent.elevation + (rng() < .78 ? 1 : -1) * between(12, Math.min(58, gap * .24 + 15));
            const region = planRegion(`r${i}`, center, { x: rx, z: rz }, elevation, { x: between(-.045, .045), z: between(-.045, .045) }, between(0, Math.PI));
            accepted = record(attachRegion(plan, region, parent.id, { width: between(10, 17), clearance: 6 }));
        }
        if (!accepted) return failure('placement-exhausted', `Could not attach r${i} after ${attempts} candidates; the partial plan remains connected.`, plan);
    }
    const wantedLoops = Math.floor(rng() * (maxLoops + 1));
    let loops = 0;
    while (loops < wantedLoops && loopAttempts < wantedLoops * 24) {
        loopAttempts++;
        if (record(addLoop(plan, pickRegion().id, pickRegion().id))) loops++;
    }
    return { ok: true, plan, diagnostics: diagnostics() };
}
