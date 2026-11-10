import * as THREE from 'three';

export interface LandmarkPoint { x: number; y: number; z: number }
export interface LandmarkMesh { positions: Float32Array; indices: Uint32Array }
export interface MountainLandmark {
    group: THREE.Group;
    collider: LandmarkMesh;
    footprint: { minX: number; maxX: number; minZ: number; maxZ: number };
    anchors: Record<string, LandmarkPoint>;
}

type V = readonly [number, number, number];
const material = (color: string, side: THREE.Side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ color, roughness: .94, metalness: .08, flatShading: true, side });
const P = {
    skin: '#778078', pale: '#a5aba1', dark: '#344443', inside: '#414b49',
    rust: '#8c563d', stripe: '#ad6848', glass: '#263b45', metal: '#4f5b60',
    snow: '#dce4e4', roof: '#566461', concrete: '#737c7b', wood: '#6b6250',
};
function mesh(parent: THREE.Group, geometry: THREE.BufferGeometry, mat: THREE.Material, solid = true) {
    const m = new THREE.Mesh(geometry, mat);
    m.castShadow = m.receiveShadow = true;
    m.userData.landmarkSolid = solid;
    parent.add(m);
    return m;
}
function box(parent: THREE.Group, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, solid = true) {
    const m = mesh(parent, new THREE.BoxGeometry(sx, sy, sz), material(color), solid);
    m.position.set(x, y, z); return m;
}
function faces(vertices: readonly V[], indices: number[]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flatMap(v => [...v]), 3));
    g.setIndex(indices); g.computeVertexNormals(); return g;
}
function beam(parent: THREE.Group, a: V, b: V, width: number, color: string, solid = false) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), d = end.clone().sub(start);
    const m = mesh(parent, new THREE.CylinderGeometry(width, width, d.length(), 5), material(color), solid);
    m.position.copy(start.add(end).multiplyScalar(.5));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
}
function plate(parent: THREE.Group, outline: readonly (readonly [number, number])[], y: number, thickness: number, color: string) {
    const n = outline.length, vertices: V[] = outline.map(([x, z]) => [x, y, z]);
    vertices.push(...outline.map(([x, z]): V => [x, y - thickness, z]));
    const contour = outline.map(([x, z]) => new THREE.Vector2(x, z));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []), I: number[] = [];
    for (const [a, b, c] of triangles) {
        // A CCW XZ outline faces down in the Three coordinate system.
        I.push(a, c, b, a + n, b + n, c + n);
    }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; I.push(i, j, j + n, i, j + n, i + n); }
    return mesh(parent, faces(vertices, I), material(color, THREE.DoubleSide));
}
function finish(group: THREE.Group, anchors: Record<string, LandmarkPoint>): MountainLandmark {
    group.updateMatrixWorld(true);
    const positions: number[] = [], indices: number[] = [], v = new THREE.Vector3();
    group.traverse(o => {
        if (!(o instanceof THREE.Mesh) || !o.userData.landmarkSolid) return;
        const p = o.geometry.getAttribute('position'), index = o.geometry.index, offset = positions.length / 3;
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); positions.push(v.x, v.y, v.z); }
        if (index) for (let i = 0; i < index.count; i++) indices.push(offset + index.getX(i));
        else for (let i = 0; i < p.count; i++) indices.push(offset + i);
    });
    const bounds = new THREE.Box3().setFromObject(group);
    return { group, collider: { positions: new Float32Array(positions), indices: new Uint32Array(indices) },
        footprint: { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z }, anchors };
}

/** A deliberately identifiable transport wreck. Nose points -Z, ground is Y=0.
 * The cargo break, rear shell and deck are real geometry, with no enclosing collider box.
 */
export function buildPlaneWreck(): MountainLandmark {
    const group = new THREE.Group(); group.name = 'mountain-transport-wreck';
    const skin = material(P.skin, THREE.DoubleSide), dark = material(P.inside, THREE.DoubleSide), snow = material(P.snow, THREE.DoubleSide);
    type Ring = readonly [number, number, number, number]; // z, centreY, radiusX, radiusY
    function hull(parent: THREE.Group, rings: readonly Ring[], brokenStart = false, brokenEnd = false) {
        const sides = 14, vertices: V[] = [], I: number[] = [];
        for (let k = 0; k < rings.length; k++) {
            const [z, cy, rx, ry] = rings[k];
            for (let i = 0; i < sides; i++) {
                const a = i / sides * Math.PI * 2;
                const torn = (k === 0 && brokenStart || k === rings.length - 1 && brokenEnd) ? Math.sin(i * 2.9) * .42 + (i % 3 === 0 ? .35 : 0) : 0;
                vertices.push([Math.cos(a) * rx, cy + Math.sin(a) * ry, z + torn]);
            }
        }
        for (let k = 1; k < rings.length; k++) for (let i = 0; i < sides; i++) {
            const a = (k - 1) * sides + i, b = (k - 1) * sides + (i + 1) % sides, c = k * sides + i, d = k * sides + (i + 1) % sides;
            I.push(a, c, b, b, c, d);
        }
        mesh(parent, faces(vertices, I), skin);
        // Narrow frames reveal the hollow structure at the broken ends.
        for (const k of [0, rings.length - 1]) {
            const [z, cy, rx, ry] = rings[k];
            if (rx < 1) continue;
            for (let i = 0; i < sides; i++) {
                const a = i / sides * Math.PI * 2, b = (i + 1) / sides * Math.PI * 2;
                beam(parent, [Math.cos(a) * (rx - .07), cy + Math.sin(a) * (ry - .07), z], [Math.cos(b) * (rx - .07), cy + Math.sin(b) * (ry - .07), z], .055, P.dark);
            }
        }
        // A shallow top patch follows the existing faceted skin rather than a white cylinder.
        const S: V[] = [], SI: number[] = [], steps = 5;
        for (const [z, cy, rx, ry] of rings) for (let i = 0; i <= steps; i++) {
            const a = .25 * Math.PI + i / steps * .5 * Math.PI;
            S.push([Math.cos(a) * (rx + .06), cy + Math.sin(a) * (ry + .10), z]);
        }
        for (let k = 1; k < rings.length; k++) for (let i = 0; i < steps; i++) {
            const a = (k - 1) * (steps + 1) + i, b = a + 1, c = k * (steps + 1) + i;
            SI.push(a, c, b, b, c, c + 1);
        }
        mesh(parent, faces(S, SI), snow, false);
    }
    hull(group, [[-18, 2.6, .28, .35], [-16, 3.0, 1.55, 1.5], [-13, 3.05, 2.5, 2.2], [-9, 3.05, 2.7, 2.55], [-3, 3.05, 2.8, 2.6], [2.8, 3.05, 2.75, 2.55]], false, true);
    // Cockpit glazing follows sloping panels and remains distinct at viewing distance.
    for (const side of [-1, 1]) {
        mesh(group, faces([[side * .13, 4.1, -15.0], [side * 1.35, 4.0, -14.8], [side * 1.9, 4.8, -12.8], [side * .2, 5.0, -13.0]], [0, 1, 2, 0, 2, 3]), material(P.glass, THREE.DoubleSide), false);
        for (const z of [-8.2, -5.7, -3.2, -.7]) {
            const window = box(group, side * 2.66, 3.8, z, .075, .63, .85, P.glass, false); window.rotation.z = side * -.11;
        }
    }
    // The hold can be approached directly through a low snow-covered broken ramp.
    box(group, 0, 1.04, -4.4, 4.65, .22, 14.4, P.inside);
    mesh(group, faces([[-2.2, 1.15, 2.8], [2.2, 1.15, 2.8], [2.5, .1, 6.2], [-1.9, .1, 6.6]], [0, 2, 1, 0, 3, 2]), material(P.metal, THREE.DoubleSide));
    box(group, -1.45, 1.65, -6, 1.1, 1.0, 1.9, P.wood);
    box(group, 1.35, 1.44, -3.8, 1.0, .65, 1.25, P.rust);
    const tail = new THREE.Group(); tail.position.set(2.1, -.18, 1.0); tail.rotation.y = -.16; tail.rotation.z = .045; group.add(tail);
    hull(tail, [[6.1, 3.05, 2.65, 2.55], [11.3, 3.1, 2.2, 2.15], [16.5, 3.4, 1.15, 1.15], [20, 3.65, .32, .38]], true, false);
    // Tall swept fin and tapered tailplane make the wreck recognizable over a ridge.
    mesh(tail, faces([[-.12, 3.8, 14.2], [.12, 3.8, 14.2], [-.1, 10.0, 18.1], [.1, 10.0, 18.1], [-.1, 10.0, 19.9], [.1, 10.0, 19.9], [-.12, 3.8, 20.4], [.12, 3.8, 20.4]], [0, 2, 4, 0, 4, 6, 1, 7, 5, 1, 5, 3, 2, 3, 5, 2, 5, 4, 4, 5, 7, 4, 7, 6]), material(P.dark, THREE.DoubleSide));
    box(tail, .13, 8.45, 18.9, .04, .65, 1.7, P.stripe, false);
    plate(tail, [[-8.0, 18.8], [-7.6, 20.3], [0, 18.7], [7.8, 20.3], [8.2, 18.8], [0, 15.1]], 4.15, .24, P.skin);
    plate(tail, [[-6.8, 18.75], [-6.2, 19.5], [0, 17.8], [6.5, 19.5], [6.8, 18.75], [0, 15.65]], 4.28, .08, P.snow).userData.landmarkSolid = false;
    // Broad left wing, snapped right wing and a displaced outer panel.
    plate(group, [[-2.2, -4.9], [-9.0, -4.1], [-20.3, .1], [-20.5, 2.0], [-11.1, 2.4], [-2.0, 1.4]], 2.32, .42, P.pale);
    plate(group, [[2.0, 1.4], [11.6, 2.3], [11.0, 1.25], [12.0, .7], [11.2, -.3], [12.0, -1.6], [9.0, -4.1], [2.2, -4.9]], 2.32, .42, P.skin);
    plate(group, [[-3.0, -4.5], [-9, -3.8], [-18.7, .1], [-18.8, .8], [-10.5, 1.5], [-3, 1.0]], 2.39, .08, P.snow).userData.landmarkSolid = false;
    const fragment = new THREE.Group(); fragment.position.set(11.2, -.9, 4.8); fragment.rotation.y = -.35; fragment.rotation.z = -.09; group.add(fragment);
    plate(fragment, [[0, 1], [8.9, 1.8], [10, .3], [0, -3.7], [-.4, -2.8], [.5, -1.4], [-.2, -.5]], 1.22, .35, P.pale);
    for (const x of [-8.5, 8.5]) {
        const nacelle = mesh(group, new THREE.CylinderGeometry(1.1, .94, 4.4, 10), material(P.metal));
        nacelle.rotation.x = Math.PI / 2; nacelle.position.set(x, 2.15, -5.1);
        const rim = mesh(group, new THREE.TorusGeometry(.91, .15, 5, 12), material(P.pale)); rim.position.set(x, 2.15, -7.35);
        const hub = mesh(group, new THREE.ConeGeometry(.39, .65, 8), material(P.dark)); hub.rotation.x = -Math.PI / 2; hub.position.set(x, 2.15, -7.58);
        for (let i = 0; i < 3; i++) {
            const a = i * Math.PI * 2 / 3 + (x < 0 ? .3 : -.45);
            const blade = box(group, x + Math.sin(a) * 1.05, 2.15 + Math.cos(a) * 1.05, -7.43, .22, 2.05, .12, P.dark, false);
            blade.rotation.z = -a; blade.rotation.x = x > 0 && i === 2 ? .35 : .08;
        }
    }
    // Visible undercarriage remnants establish weight and contact with the ground.
    for (const x of [-1.9, 1.9]) {
        beam(group, [x, .2, -1], [x * .7, 1.7, -2], .14, P.metal, true);
        const wheel = mesh(group, new THREE.CylinderGeometry(.55, .55, .35, 10), material('#313a3a')); wheel.rotation.z = Math.PI / 2; wheel.position.set(x, .57, -1);
    }
    return finish(group, { approach: { x: 1, y: 0, z: 8 }, hold: { x: 0, y: 1.15, z: -1 }, silhouette: { x: -1, y: 9.4, z: 19 }, nose: { x: 0, y: 2.6, z: -18 } });
}

/** A small serviced mountain station: open hangar, annex and a restrained lattice mast. */
export function buildMountainStation(): MountainLandmark {
    const group = new THREE.Group(); group.name = 'mountain-service-station';
    box(group, 0, .12, -.2, 20.6, .24, 23.6, P.concrete);
    // Main walls, with a genuinely open 6.4m portal at the front.
    box(group, -10, 3.5, 0, .3, 6.8, 23, P.skin);
    box(group, 10, 3.5, 0, .3, 6.8, 23, P.skin);
    box(group, 0, 3.5, 11.5, 20.3, 6.8, .3, P.skin);
    box(group, -6.6, 3.5, -11.5, 6.8, 6.8, .3, P.skin);
    box(group, 6.6, 3.5, -11.5, 6.8, 6.8, .3, P.skin);
    box(group, 0, 6.05, -11.5, 6.4, 1.7, .3, P.skin);
    const roof = [[-10.4, 6.9, -12], [0, 9.0, -12], [10.4, 6.9, -12], [-10.4, 6.9, 12], [0, 9.0, 12], [10.4, 6.9, 12]] as const;
    mesh(group, faces(roof, [0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5]), material(P.roof, THREE.DoubleSide));
    mesh(group, faces([[-10, 6.9, -11.5], [10, 6.9, -11.5], [0, 9, -11.5], [-10, 6.9, 11.5], [10, 6.9, 11.5], [0, 9, 11.5]], [0, 2, 1, 3, 4, 5]), material(P.skin, THREE.DoubleSide));
    mesh(group, faces([[-9.9, 7.12, -11.6], [-.1, 9.12, -11.6], [-9.9, 7.12, 11.5], [-.1, 9.12, 11.5], [.1, 9.12, -10], [8.5, 7.42, -10], [.1, 9.12, 11.5], [8.5, 7.42, 11.5]], [0, 2, 1, 1, 2, 3, 4, 6, 5, 5, 6, 7]), material(P.snow, THREE.DoubleSide), false);
    for (const z of [-9, -3, 3, 9]) {
        beam(group, [-9.7, 6.7, z], [0, 8.7, z], .10, P.dark);
        beam(group, [0, 8.7, z], [9.7, 6.7, z], .10, P.dark);
    }
    for (const x of [-4.5, 4.5]) {
        const door = box(group, x, 2.7, -12.3, 2.6, 4.9, .18, P.dark); door.rotation.y = x < 0 ? -.56 : .56;
        for (let y = .8; y < 5; y += .8) beam(group, [x - 1.2, y, -12.42], [x + 1.2, y, -12.42], .035, P.metal);
    }
    // Office annex has its own doorway, rather than an inaccessible solid box.
    box(group, -13.4, .14, 3, 6.8, .28, 12, P.concrete);
    box(group, -16.8, 2.0, 3, .25, 3.7, 12, P.pale);
    box(group, -13.5, 2.0, 9, 6.6, 3.7, .25, P.pale);
    box(group, -15.1, 2.0, -3, 3.3, 3.7, .25, P.pale);
    box(group, -11.1, 2.0, -3, 1.9, 3.7, .25, P.pale);
    box(group, -12.8, 3.2, -3, 1.5, 1.3, .25, P.pale);
    box(group, -13.5, 4.05, 3, 7.2, .24, 12.6, P.roof);
    box(group, -13.5, 4.23, 3, 7.0, .12, 12.2, P.snow, false);
    for (const z of [.0, 4.5]) box(group, -16.96, 2.5, z, .04, 1.2, 1.7, P.glass, false);
    box(group, -6.6, 1.0, 7.5, 4.5, 1.4, 1.5, P.wood);
    box(group, 7.0, .9, 7.6, 2.5, 1.5, 3.0, P.dark);
    // A narrow truss mast and service cabinet, visible over the nearby rock shoulder.
    const tx = 16.2, tz = 6.5, half = 1.0;
    box(group, tx, .2, tz, 3.2, .4, 3.2, P.concrete);
    for (const [x, z] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
        beam(group, [tx + x, .4, tz + z], [tx + x * .25, 18, tz + z * .25], .09, P.metal, true);
    }
    for (let y = 1; y < 17; y += 2.8) for (const side of [-1, 1]) {
        const w0 = half * (1 - y / 24), w1 = half * (1 - (y + 2.8) / 24);
        beam(group, [tx - w0, y, tz + side * w0], [tx + w1, y + 2.8, tz + side * w1], .045, P.metal);
        beam(group, [tx + side * w0, y, tz + w0], [tx + side * w1, y + 2.8, tz - w1], .045, P.metal);
    }
    beam(group, [tx, 17, tz], [tx, 20.5, tz], .075, P.dark);
    box(group, tx, 18.8, tz, 3.4, .12, .18, P.pale, false);
    box(group, tx + 1.8, 1.2, tz - 4.0, 1.4, 2.1, 1.1, P.skin);
    return finish(group, { approach: { x: 0, y: 0, z: -17 }, hall: { x: 0, y: .25, z: -1 }, office: { x: -12.8, y: .3, z: -4.0 }, silhouette: { x: tx, y: 20.5, z: tz } });
}
