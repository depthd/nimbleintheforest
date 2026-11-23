export interface MeshData { positions: Float32Array; indices: Uint32Array }
export type Point = { x: number; y: number; z: number };

export function append(polygon: Point[], positions: number[], indices: number[]) {
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
