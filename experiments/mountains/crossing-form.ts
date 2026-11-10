import type { CrossingPlan } from './crossing';

// Authored geography for this one crossing experiment. Routes are applied later:
// their centre lines do not define the outlines or every fold of the mountain.
type Point = readonly [number, number];
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function polygonDistance(polygon: readonly Point[], x: number, z: number) {
    let inside = false, distance = Infinity;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[j], b = polygon[i], dx = b[0] - a[0], dz = b[1] - a[1];
        const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz));
        distance = Math.min(distance, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
        if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside ? distance : -distance;
}

function profile(knots: readonly Point[], z: number) {
    if (z <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) {
        const a = knots[i - 1], b = knots[i];
        if (z <= b[0]) return mix(a[1], b[1], smooth((z - a[0]) / (b[0] - a[0])));
    }
    return knots[knots.length - 1][1];
}

// These are different pieces of a mountain, not two variations of one disk.
// The west shoulder descends to the broad southern entrance. The east hollow
// extends behind a projecting nose and a long outer ridge.
const WEST: readonly Point[] = [
    [-201, 95], [-191, -18], [-177, -94], [-132, -149], [-80, -156],
    [-40, -113], [-18, -58], [-18, 38], [-43, 93], [-103, 156], [-160, 149],
];
const EAST: readonly Point[] = [
    [18, 39], [18, -28], [37, -57], [45, -109], [75, -152], [128, -165],
    [173, -136], [193, -90], [179, -24], [161, 42], [110, 81], [63, 68],
];
const VALLEY: readonly Point[] = [
    [-37, -169], [36, -166], [40, -78], [32, -17], [45, 54],
    [79, 126], [42, 177], [-43, 172], [-102, 145], [-89, 110], [-42, 75],
];
// Cross sections of the eastern hollow: the route chooses a walk inside this
// geography, while these widths and shoulders determine the room around it.
const EAST_WIDTH: readonly Point[] = [[-140, 27], [-98, 32], [-48, 24], [-10, 19], [45, 32]];
const EAST_LEFT_RISE: readonly Point[] = [[-140, 15], [-98, 19], [-55, 27], [-24, 24], [25, 7]];
const EAST_RIGHT_RISE: readonly Point[] = [[-140, 23], [-98, 34], [-45, 28], [25, 16]];

export function terrainMassHeight(plan: CrossingPlan, x: number, z: number): number {
    const floor = plan.terrain.floor + z * plan.terrain.tiltZ;
    const westCore = plan.regions.find(r => r.id === 'west')!.core;
    const eastCore = plan.regions.find(r => r.id === 'east')!.core;
    const bridge = plan.routes.find(r => r.id === 'bridge')!.points;
    const bridgeZ = (bridge[0].z + bridge[1].z) / 2;
    const halfSpan = Math.abs(bridge[1].x - bridge[0].x) / 2;
    const eastRoute = plan.routes.find(r => r.id === 'east')!.points;
    const eastSections = [...eastRoute].reverse();
    const eastElevation: Point[] = eastSections.map(p => [p.z, p.y]);
    // The bridge landing is an access turn, not a floor cross-section: including
    // it would shift the whole hollow sideways by forty metres within ten metres
    // of Z and turn its shoulder into an accidental knife-shaped wall.
    const eastAxis: Point[] = eastSections.slice(0, -1).map(p => [p.z, p.x]);

    // The lower route has a narrower northern throat and a broad southern bowl.
    // The southern east-bank projection overlooks the bowl and is seen on the
    // lower approach and again when looking back from the bridge.
    const south = smooth((z - 42) / 78);
    const north = smooth((-z - 55) / 80);
    const gorgeCenter = profile([[-140, -3], [bridgeZ, 0], [65, 4], [140, 0]], z);
    const gorgeFoot = 16 + south * 23 + north * 6;
    const nose = smooth(1 - Math.abs(z + 48) / 38);
    const southernNose = smooth(1 - Math.abs(z - 56) / 29);
    const westFace = halfSpan - 4 - nose * 7 + south * 23 + north * 6;
    const eastFace = halfSpan - 4 + south * 24 + north * 11 - southernNose * 7;
    const westBank = smooth((gorgeCenter - x - (gorgeFoot - nose * 3)) / Math.max(7, westFace - gorgeFoot + nose * 3));
    const eastFoot = gorgeFoot - southernNose * 4;
    const eastBank = smooth((x - gorgeCenter - eastFoot) / Math.max(7, eastFace - eastFoot));

    const westGrade = westCore.y - smooth((z - 18) / 120) * (westCore.y - plan.terrain.floor - 12);
    const westSpine = profile([[-150, -146], [-85, -153], [-20, -142], [85, -171]], z);
    const westRise = profile([[-150, 14], [-85, 29], [-20, 18], [85, 6]], z);
    const westBack = westRise * smooth((westCore.x - 25 - x) / (westCore.x - 25 - westSpine));
    const westRoof = westGrade + (x - westCore.x) * -.025 + westBack;
    // The back is a broad descending slope. Only the gorge edge has a cliff.
    const westBody = smooth((polygonDistance(WEST, x, z) + 24) / 55) * westBank;

    // Planned longitudinal grade is carried by the entire hollow, not merely a
    // road incised through an unrelated level top. Full-width floors, then long
    // transverse shoulders, replace the separate conical summit decorations.
    const axis = profile(eastAxis, z), halfWidth = profile(EAST_WIDTH, z);
    const eastFloor = profile(eastElevation, z) + (x - eastCore.x) * .018 - 3 * smooth((z - 12) / 45);
    const leftRise = profile(EAST_LEFT_RISE, z) * smooth((axis - x - halfWidth) / 26);
    const rightRise = profile(EAST_RIGHT_RISE, z) * smooth((x - axis - halfWidth) / 34);
    const eastRoof = eastFloor + Math.max(leftRise, rightRise);
    const eastBody = smooth((polygonDistance(EAST, x, z) + 20) / 50) * eastBank;

    // A through-valley and two sloping backs meet the sea independently; there
    // is no full-island flat disk beneath them. Final coastline remains the
    // baker's boundary, and final route reservations remain authoritative.
    const lowland = smooth((polygonDistance(VALLEY, x, z) + 19) / 24);
    const ground = mix(plan.island.bottom, floor, lowland);
    return Math.max(ground, mix(plan.island.bottom, westRoof, westBody), mix(plan.island.bottom, eastRoof, eastBody));
}
