// Connected uplands: broad basin patches, independently shaped rock masses and
// asymmetric passes. The graph describes actual geographic connections, not
// floating paths or stacked horizontal platforms. RockSkin is a separate layer.
import { Rng, Simplex2, clamp, lerp, smoothstep, hashString } from '../../src/core/rng';
export interface Point {
    x: number;
    y: number;
    z: number;
}
export interface Route {
    id: string;
    name: string;
    width: number;
    points: Point[];
    status: 'planned';
    from: string;
    to: string;
}
export interface View {
    id: string;
    name: string;
    position: Point;
    target: Point;
}
interface Node extends Point {
    width: number;
    right: number;
}
interface Axis {
    id: string;
    nodes: Node[];
}
interface Region {
    id: string;
    name: string;
    x: number;
    z: number;
    y: number;
    polygon: number[][];
    feather: number;
    tiltX: number;
    tiltZ: number;
    access: { core: { x: number; z: number }; minConnectedArea: number };
    openSide?: { x: number; z: number; feather: number };
    rolloff?: { x: number; z: number; curvature: number };
}
interface Mass {
    id: string;
    polygon: number[][];
    height: number;
    skirt: number;
    wall: number;
    dipX: number;
    dipZ: number;
    // The back of a ridge rises through snow-covered shoulders instead of
    // repeating its exposed cliff all the way around the polygon.
    back?: { x: number; z: number; width: number };
}
export const VERSION = 'connected-uplands-1';
export const SIZE = 1600, CELL = 4;
const stream = (seed: number, id: string) => new Rng(seed ^ hashString(VERSION + '/' + id));
function polygonDistance(poly: number[][], x: number, z: number) {
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
function project(a: Axis, x: number, z: number) {
    let best = { d: Infinity, side: 0, y: 0, width: 1, right: 1 };
    for (let i = 1; i < a.nodes.length; i++) {
        const p = a.nodes[i - 1], q = a.nodes[i], dx = q.x - p.x, dz = q.z - p.z;
        const t = clamp(((x - p.x) * dx + (z - p.z) * dz) / (dx * dx + dz * dz), 0, 1), ux = x - p.x - t * dx, uz = z - p.z - t * dz, d = ux * ux + uz * uz;
        if (d < best.d)
            best = { d, side: dx * uz - dz * ux, y: lerp(p.y, q.y, t), width: lerp(p.width, q.width, t), right: lerp(p.right, q.right, t) };
    }
    best.d = Math.sqrt(best.d);
    return best;
}
// Cubic plan curvature; monotonic interpolated height and width avoid humps at
// the transitions. This is a valley axis, not an independently rendered ribbon.
function axis(id: string, p: number[][]): Axis {
    const nodes: Node[] = [];
    const cubic = (a: number, b: number, c: number, d: number, t: number) => .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    for (let k = 0; k < p.length - 1; k++) {
        const a = p[Math.max(0, k - 1)], b = p[k], c = p[k + 1], d = p[Math.min(p.length - 1, k + 2)];
        const count = Math.ceil(Math.hypot(c[0] - b[0], c[2] - b[2]) / 10);
        for (let i = 0; i < count; i++) {
            const t = i / count;
            nodes.push({ x: cubic(a[0], b[0], c[0], d[0], t), z: cubic(a[2], b[2], c[2], d[2], t), y: lerp(b[1], c[1], t), width: lerp(b[3], c[3], t), right: lerp(b[4] ?? b[3], c[4] ?? c[3], t) });
        }
    }
    const a = p[p.length - 1];
    nodes.push({ x: a[0], y: a[1], z: a[2], width: a[3], right: a[4] ?? a[3] });
    return { id, nodes };
}
export class Landforms {
    readonly n = SIZE / CELL;
    readonly heights = new Float32Array((this.n + 1) ** 2);
    readonly routes: Route[] = [];
    readonly views: View[] = [];
    readonly upper = 118;
    // Keep the playable northern crest inside RockSkin's detailed interior.
    // Outer rows are intentionally coarse and belong beyond walkable destinations.
    readonly offsetZ = 120;
    readonly yaw: number;
    readonly mirror: number;
    readonly noise: Simplex2;
    readonly lake = { x: 35, z: -155, y: 119, rx: 64, rz: 43 };
    readonly drainage: Point[] = [];
    readonly regions: Region[];
    readonly masses: Mass[];
    readonly valleys: Axis[] = [];
    readonly ridges: Mass[];
    readonly plan: {
        version: string;
        family: string;
        geography: string[];
        drainage: string[];
        traversal: {
            id: string;
            from: string;
            to: string;
            status: 'planned';
        }[];
    };
    private drainageAxis: Axis;
    private routeAxes: Axis[] = [];
    constructor(readonly seed: number) {
        const rng = stream(seed, 'layout'), nr = stream(seed, 'surface');
        this.noise = new Simplex2(() => nr.next());
        this.yaw = seed === 42 ? 0 : rng.float(-.2, .2);
        this.mirror = seed === 42 ? 1 : rng.chance(.5) ? 1 : -1;
        const usefulFloor: Record<string, number> = { lowland: 25600, pocket: 3840, lake: 24000, shoulder: 12000, cirque: 12000, summit: 800 };
        const region = (id: string, name: string, x: number, z: number, y: number, polygon: number[][], feather: number, tiltX = 0, tiltZ = 0): Region => ({ id, name, x, z, y, polygon, feather, tiltX, tiltZ, access: { core: { x, z }, minConnectedArea: usefulFloor[id] } });
        this.regions = [
            region('lowland', 'Нижний лес', -190, 400, 22, [[-470, 530], [-40, 530], [90, 380], [-40, 290], [-230, 280], [-420, 350]], 80, .012, -.025),
            region('pocket', 'Тихая котловина', -285, 170, 59, [[-370, 205], [-300, 240], [-200, 200], [-185, 135], [-260, 105], [-350, 125]], 65, .035, -.1),
            region('lake', 'Озёрная долина', -15, -170, 122, [[-260, -75], [-100, -65], [10, -80], [150, -55], [210, -140], [170, -240], [20, -290], [-125, -260], [-250, -210]], 45, .018, -.028),
            region('shoulder', 'Восточная лесная долина', 345, -125, 177, [[240, -40], [335, 20], [420, -45], [460, -145], [395, -230], [315, -230], [250, -170]], 32, .035, -.04),
            region('cirque', 'Высокая снежная котловина', -90, -440, 222, [[-230, -425], [-165, -350], [-40, -350], [60, -410], [20, -515], [-105, -550], [-205, -510]], 30, .018, -.04),
        ];
        // A basin has a cliff side and an open shoulder. Without this transition
        // it would cut a fresh defensive wall even through a massif's gentle back.
        const openings: Record<string, [number, number, number]> = {
            pocket: [-1, .2, 100],
            lake: [-.7, -.4, 150],
            shoulder: [1, .2, 110],
            cirque: [-1, .1, 120],
        };
        for (const r of this.regions) {
            const o = openings[r.id];
            if (o) {
                const n = Math.hypot(o[0], o[1]);
                r.openSide = { x: o[0] / n, z: o[1] / n, feather: o[2] };
            }
        }
        const mass = (id: string, height: number, polygon: number[][], wall = 28, skirt = 100, dipX = .025, dipZ = -.025): Mass => ({ id, height, polygon, wall, skirt, dipX, dipZ });
        this.masses = [
            mass('upland-bedrock', 150, [[-480, 160], [-300, 230], [-90, 135], [105, 210], [315, 130], [470, 40], [530, -170], [435, -415], [220, -590], [-210, -610], [-465, -390], [-525, -100]], 58, 160),
            mass('foreground-buttress', 155, [[-140, 245], [-55, 300], [35, 245], [90, 150], [30, 100], [-65, 140], [-135, 165]], 22, 65, .08, -.04),
            mass('west-gate', 172, [[-455, 80], [-365, 95], [-315, 35], [-330, -75], [-395, -105], [-460, -15]], 23, 80, -.04, -.035),
            mass('inner-nose', 183, [[-185, 50], [-125, 90], [-55, 40], [-65, -40], [-145, -75], [-210, -20]], 19, 62, .035, -.08),
            mass('east-terrace', 205, [[205, 95], [355, 150], [490, 35], [510, -170], [420, -300], [270, -280], [195, -150]], 30, 90, .025, -.05),
            mass('east-divide', 290, [[130, 55], [200, 80], [255, 5], [230, -80], [230, -175], [160, -265], [100, -225], [110, -90]], 25, 85, .06, -.09),
            mass('west-highland', 252, [[-515, -60], [-450, -30], [-375, -100], [-320, -220], [-350, -325], [-440, -345], [-525, -230]], 30, 115, -.03, -.08),
            mass('north-highland', 265, [[-370, -340], [-230, -285], [-65, -290], [75, -315], [200, -410], [110, -585], [-115, -640], [-335, -555]], 35, 110, .025, -.045),
            mass('north-crown', 348, [[-320, -525], [-220, -505], [-155, -555], [-155, -630], [-260, -660], [-350, -615]], 32, 85, -.08, .03),
            mass('cirque-wall', 315, [[-55, -325], [5, -285], [80, -340], [90, -430], [35, -460], [-20, -410]], 24, 65, .06, -.03),
            mass('connecting-divide', 260, [[80, -550], [185, -600], [280, -540], [330, -420], [310, -310], [235, -285], [175, -390]], 65, 120, .02, -.02),
            mass('eastern-apron', 170, [[310, -40], [440, 30], [475, 125], [375, 230], [225, 290], [165, 190], [245, 70]], 130, 160, .04, -.14),
            mass('east-crown', 356, [[315, -335], [430, -265], [530, -325], [510, -465], [405, -515], [310, -455]], 26, 95, .06, -.06),
        ];
        const backs: Record<string, [number, number, number]> = {
            'foreground-buttress': [0, -1, 165],
            'west-gate': [-1, -.2, 180],
            'inner-nose': [.2, 1, 190],
            'east-terrace': [1, .2, 230],
            'east-divide': [1, -.1, 260],
            'west-highland': [-1, .3, 240],
            'north-highland': [-.8, .6, 250],
            'north-crown': [-1, -.2, 290],
            'cirque-wall': [.8, -.6, 250],
            'east-crown': [1, -.2, 290],
        };
        for (const m of this.masses) {
            const b = backs[m.id];
            if (b) {
                const n = Math.hypot(b[0], b[1]);
                m.back = { x: b[0] / n, z: b[1] / n, width: b[2] };
            }
        }
        this.ridges = this.masses;
        // Seed changes physical shapes, while preserving ports of this composition.
        // Topology variants are deliberately deferred until this family is reviewed.
        if (seed !== 42)
            for (const m of this.masses) {
                const r = stream(seed, m.id);
                m.height += r.float(-8, 8);
                m.wall *= r.float(.9, 1.1);
                m.polygon = m.polygon.map(([x, z]) => [x + r.float(-9, 9), z + r.float(-9, 9)]);
            }
        const connect = (id: string, name: string, from: string, to: string, p: number[][]) => {
            const a = axis(id, p);
            this.valleys.push(a);
            this.routeAxes.push(a);
            this.routes.push({ id, name, from, to, width: Math.min(...p.map(p => p[3])), points: [], status: 'planned' });
        };
        connect('gully', 'Лесная ложбина к котловине', 'lowland', 'pocket', [
            [-210, 23, 385, 52, 62], [-280, 34, 300, 28, 40], [-285, 57, 170, 40, 62]
        ]);
        connect('gates', 'Каменные ворота к озеру', 'pocket', 'lake', [
            [-285, 57, 170, 40, 62], [-255, 75, 90, 16, 30], [-260, 99, 0, 22, 38], [-210, 119, -115, 45, 55]
        ]);
        connect('apron', 'Западный снежный обход', 'lowland', 'lake', [
            [-210, 23, 385, 60], [-430, 30, 350, 65], [-535, 50, 225, 50], [-545, 74, 65, 42], [-505, 93, -90, 32], [-385, 113, -170, 28], [-210, 119, -115, 45]
        ]);
        connect('east', 'Восточный перевал', 'lake', 'shoulder', [
            [90, 122, -185, 40], [185, 132, -285, 25, 40], [280, 162, -305, 22, 35], [355, 178, -195, 36, 50], [345, 177, -125, 45]
        ]);
        connect('high', 'Подъём в высокую котловину', 'lake', 'cirque', [
            [-210, 119, -115, 42], [-280, 128, -230, 26, 42], [-290, 135, -260, 24, 36], [-300, 158, -330, 22, 32], [-245, 189, -430, 20, 28], [-160, 220, -455, 35], [-85, 222, -440, 45]
        ]);
        connect('saddle', 'Седловина между верхними районами', 'cirque', 'shoulder', [
            [-85, 222, -440, 42], [25, 235, -510, 20, 30], [140, 242, -530, 20, 32], [225, 199, -450, 25, 38], [245, 178, -385, 24, 35], [280, 162, -305, 22, 35], [355, 178, -195, 36, 50], [345, 177, -125, 45]
        ]);
        connect('balcony', 'Обход по лесному плечу', 'shoulder', 'lowland', [
            [345, 177, -125, 45], [385, 155, 10, 30, 44], [390, 122, 130, 30, 60], [320, 87, 225, 42, 70], [210, 52, 310, 50, 72], [20, 32, 380, 60], [-210, 23, 385, 60]
        ]);
        connect('summit', 'Восхождение на северный гребень', 'cirque', 'summit', [
            [-85, 222, -440, 40], [-145, 225, -540, 26, 40], [-160, 230, -560, 26, 36], [-190, 257, -595, 26, 36], [-245, 285, -645, 24, 36], [-330, 305, -610, 22, 30], [-315, 326, -570, 22, 30], [-245, 340, -570, 26, 32], [-211, 312, -518, 28, 36]
        ]);
        this.drainageAxis = axis('outlet', [[35, 119, -155, 5], [-60, 118, -155, 5], [-155, 117, -125, 5], [-220, 109, -70, 5], [-260, 98, 0, 5], [-255, 74, 90, 5], [-285, 55, 170, 5], [-280, 32, 300, 5], [-210, 21, 385, 5]]);
        this.drainage.push(...this.drainageAxis.nodes.map(({ x, y, z }) => ({ x, y, z })));
        this.regions.push(region('summit', 'Северный гребень', -245, -570, 340, [[-270, -590], [-230, -590], [-187, -520], [-202, -495], [-250, -525], [-280, -555]], 26, 0, -.32));
        // The viewing nose rounds down into the cirque, so standing a safe step
        // back from the edge still reveals its floor. It remains part of the ridge.
        this.regions[this.regions.length - 1].rolloff = { x: .55, z: .835, curvature: .0024 };
        this.plan = { version: VERSION, family: 'interlocking-upland-basins', geography: [...this.regions.map(r => r.id), ...this.masses.map(m => m.id)], drainage: ['lake', 'pocket', 'lowland'], traversal: this.routes.map(r => ({ id: r.id, from: r.from, to: r.to, status: 'planned' })) };
        for (let j = 0; j <= this.n; j++)
            for (let i = 0; i <= this.n; i++)
                this.heights[j * (this.n + 1) + i] = this.form(i * CELL - SIZE / 2, j * CELL - SIZE / 2);
        // The final few walking metres follow the formed crest to its viewing edge.
        // They remain inside the planned pass envelope; they do not carve a new road.
        const summitAxis = this.routeAxes[this.routeAxes.length - 1];
        const overlook = this.world(-203, -516);
        this.routeAxes[this.routeAxes.length - 1] = { ...summitAxis, nodes: [...summitAxis.nodes, { x: -203, z: -516, y: this.heightAt(overlook.x, overlook.z), width: 16, right: 16 }] };
        this.routes.forEach((r, i) => { const a = this.routeAxes[i]; for (let k = 1; k < a.nodes.length; k++) {
            const p = a.nodes[k - 1], q = a.nodes[k], n = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 3);
            for (let t = 0; t < n; t++) {
                const x = lerp(p.x, q.x, t / n), z = lerp(p.z, q.z, t / n), w = this.world(x, z);
                r.points.push({ x, z, y: this.heightAt(w.x, w.z) });
            }
        } const p = a.nodes[a.nodes.length - 1], w = this.world(p.x, p.z); r.points.push({ x: p.x, z: p.z, y: this.heightAt(w.x, w.z) }); });
        const view = (id: string, name: string, x: number, z: number, tx: number, tz: number, dy = 1.8, tdy = 8) => { const p = this.world(x, z), t = this.world(tx, tz); this.views.push({ id, name, position: { ...p, y: this.heightAt(p.x, p.z) + dy }, target: { ...t, y: this.heightAt(t.x, t.z) + tdy } }); };
        view('lower', 'Подножие · выбор пути', -210, 385, -255, 135);
        view('slope', 'Западный снежный склон', -535, 225, -505, 50);
        view('gully', 'Промежуточная котловина', -285, 205, -255, 65);
        view('ledge', 'Поворот между массивами', -255, 75, -265, -15);
        view('reveal', 'За воротами · озёрная долина', -195, -150, 35, -155);
        view('upper', 'Озеро · следующие высоты', -30, -105, 65, -265);
        view('back', 'Обратный вид в нижний лес', -255, 40, -280, 230);
        view('cirque', 'Высокая котловина', -150, -430, 5, -415);
        view('shoulder', 'Восточная лесная долина', 340, -100, 295, -250);
        view('saddle', 'Связь двух верхних районов', 125, -530, 245, -390);
        view('summit', 'Северный гребень · вид на котловину', -203, -516, -80, -430, 1.8, 30);
        view('overview', 'Весь связанный район', -630, 710, 0, -170, 520, 60);
    }
    local(x: number, z: number) { z -= this.offsetZ; const c = Math.cos(this.yaw), s = Math.sin(this.yaw); return { x: (c * x + s * z) * this.mirror, z: -s * x + c * z }; }
    world(x: number, z: number) { x *= this.mirror; const c = Math.cos(this.yaw), s = Math.sin(this.yaw); return { x: c * x - s * z, z: s * x + c * z + this.offsetZ }; }
    private form(wx: number, wz: number) {
        const { x, z } = this.local(wx, wz), N = this.noise;
        const nx = x + N.noise(x / 110 + 4, z / 140) * 6, nz = z + N.noise(x / 130, z / 115 - 7) * 6;
        let h = 20 + N.fbm(x / 240, z / 240, 3) * 5;
        for (const m of this.masses) {
            const d = polygonDistance(m.polygon, nx, nz);
            const cx = m.polygon.reduce((v, p) => v + p[0], 0) / m.polygon.length, cz = m.polygon.reduce((v, p) => v + p[1], 0) / m.polygon.length;
            const back = m.back ? smoothstep(-.2, .7, ((x - cx) * m.back.x + (z - cz) * m.back.z) / Math.max(1, Math.hypot(x - cx, z - cz))) : 0;
            const wall = lerp(m.wall, m.back?.width ?? m.wall, back);
            if (d < -m.skirt - wall)
                continue;
            const crown = m.id.includes('crown'), rib = m.id === 'east-divide' || m.id === 'cirque-wall';
            const cap = m.id === 'upland-bedrock' ? 0 : Math.abs(x - cx) * (crown ? .85 : rib ? .52 : .24) + Math.abs(z - cz) * (crown ? .65 : .18);
            const roof = m.height + m.dipX * (x - cx) + m.dipZ * (z - cz) - cap + N.noise(x / 100, z / 110) * 6;
            // Broad apron, steep face, shoulder: separate slope regimes, not one cone.
            const apron = smoothstep(-m.skirt - wall, -wall, d) * .22;
            const face = smoothstep(-wall, 8, d) * .78;
            h = Math.max(h, 22 + (roof - 22) * (apron + face) + smoothstep(0, 45, d) * 8);
        }
        // Connections need a bedrock foundation, but that support must precede
        // the basins: a distant summit must not refill an already carved cirque.
        const projections = this.valleys.map(a => project(a, x, z));
        for (const p of projections)
            h = Math.max(h, p.y - .45 * p.d);
        // Basins own an area and a gently tilted, internally undulating floor.
        const basinFloors: { floor: number; weight: number }[] = [];
        for (const r of this.regions) {
            // Traversable domains are stable geography. Noise deforms the rock
            // masses outside them, never the ownership of a basin floor or port.
            const d = polygonDistance(r.polygon, x, z);
            const opening = r.openSide ? smoothstep(-.2, .7, ((x - r.x) * r.openSide.x + (z - r.z) * r.openSide.z) / Math.max(1, Math.hypot(x - r.x, z - r.z))) : 0;
            const feather = lerp(r.feather, r.openSide?.feather ?? r.feather, opening);
            if (d < -feather)
                continue;
            const nose = r.rolloff ? Math.max(0, (x - r.x) * r.rolloff.x + (z - r.z) * r.rolloff.z) : 0;
            const floor = r.y + (x - r.x) * r.tiltX + (z - r.z) * r.tiltZ - nose * nose * (r.rolloff?.curvature ?? 0) + N.noise(x / 72 + 1, z / 90) * 2.8 + N.noise(x / 28, z / 30) * .35;
            const w = smoothstep(-feather, 0, d);
            h = lerp(h, floor, w);
            basinFloors.push({ floor, weight: w });
        }
        // Apply the same basin composition to the pass grade. Taking only the
        // minimum of two unrelated surfaces left steep tangencies at basin exits.
        // Small corrections at the pass centre join those surfaces continuously;
        // the sides remain incisions and every basin still owns its interior.
        let valleySum = 0, valleyWeight = 0, maxWeight = 0;
        for (const p of projections) {
            const width = p.side < 0 ? p.width : p.right, q = p.d / width;
            if (q > 2)
                continue;
            const rise = q < .6 ? 3 * q * q : 1.08 + 38 * Math.pow((q - .6) / 1.4, 1.55);
            let floor = p.y + rise + N.noise(x / 80, z / 85) * .8;
            for (const basin of basinFloors)
                floor = lerp(floor, basin.floor, basin.weight);
            const w = (1 - smoothstep(.35, 2, q)) ** 2;
            const grade = lerp(Math.min(h, floor), floor, 1 - smoothstep(.2, .7, q));
            valleySum += grade * w;
            valleyWeight += w;
            maxWeight = Math.max(maxWeight, w);
        }
        if (valleyWeight > 0)
            h = lerp(h, valleySum / valleyWeight, maxWeight);
        const l = this.lake, d = Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz);
        h = lerp(h, l.y - 3 + 2 * d * d, 1 - smoothstep(.9, 1.2, d));
        const river = project(this.drainageAxis, x, z), channel = river.y - .12 + .008 * river.d * river.d;
        h = lerp(h, channel, 1 - smoothstep(8, 38, river.d));
        return h;
    }
    forestAt(x: number, z: number) { const p = this.local(x, z); return this.regions.some(r => r.id !== 'cirque' && r.id !== 'summit' && polygonDistance(r.polygon, p.x, p.z) > -20 && this.heightAt(x, z) < r.y + 30); }
    routeDistance(x: number, z: number) { const p = this.local(x, z); return Math.min(...this.routeAxes.map(r => project(r, p.x, p.z).d)); }
    waterAt(x: number, z: number) { const p = this.local(x, z), l = this.lake; if (Math.hypot((p.x - l.x) / l.rx, (p.z - l.z) / l.rz) < 1)
        return l.y; const r = project(this.drainageAxis, p.x, p.z); return r.d < 2.3 ? r.y : NaN; }
    heightAt(x: number, z: number) { const u = clamp((x + SIZE / 2) / CELL, 0, this.n - 1e-5), v = clamp((z + SIZE / 2) / CELL, 0, this.n - 1e-5), i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, k = j * (this.n + 1) + i, H = this.heights, n = this.n + 1; return a + b <= 1 ? H[k] + (H[k + 1] - H[k]) * a + (H[k + n] - H[k]) * b : H[k + n + 1] + (H[k + n] - H[k + n + 1]) * (1 - a) + (H[k + 1] - H[k + n + 1]) * (1 - b); }
    slopeAt(x: number, z: number) { return Math.hypot(this.heightAt(x + 2, z) - this.heightAt(x - 2, z), this.heightAt(x, z + 2) - this.heightAt(x, z - 2)) / 4; }
    worldRoute(r: Route) { return r.points.map(p => ({ ...this.world(p.x, p.z), y: p.y })); }
}
