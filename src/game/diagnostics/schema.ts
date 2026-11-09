/** Portable, bounded local reconstruction. This is evidence, not a game save. */
export interface DiagnosticMesh { positions: number[]; indices: number[] | null; color: number }
export interface DiagnosticObject {
  id: number; name: string; kind: string; definition: string; position: number[];
  state: Record<string, unknown>; meshes: { geometry: string; matrix: number[] }[];
  colliders: { position: number[]; rotation: number[]; shape: number; half: number[]; radius: number; height: number }[];
}
export interface WorldSample {
  id: number; time: number; center: number[]; terrain: number[]; objects: DiagnosticObject[];
  systems: Record<string, unknown>; truncated: boolean;
}
export interface DiagnosticBundle {
  version: 1; radius: number; interval: number; coverage: string[];
  meshes: Record<string, DiagnosticMesh>; samples: WorldSample[];
}
export function validateDiagnostics(d: DiagnosticBundle) {
  const fail = () => { throw new Error('Повреждён диагностический участок мира.'); };
  const vector = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x));
  if (!d || d.version !== 1 || d.radius !== 32 || d.interval !== 0.25 || !Array.isArray(d.coverage) || !d.coverage.every(x => typeof x === 'string') || !d.meshes || Array.isArray(d.meshes) || !Array.isArray(d.samples) || d.samples.length > 100) fail();
  let vertices = 0;
  for (const m of Object.values(d.meshes)) {
    if (!m || !Array.isArray(m.positions) || m.positions.length % 3 || !m.positions.every(x => typeof x === 'number' && Number.isFinite(x)) || !Number.isInteger(m.color) || m.color < 0 || m.color > 0xffffff) fail();
    vertices += m.positions.length / 3;
    if (vertices > 120000 || (m.indices !== null && (!Array.isArray(m.indices) || m.indices.length > 720000 || m.indices.length % 3 || !m.indices.every(x => Number.isInteger(x) && x >= 0 && x < m.positions.length / 3)))) fail();
  }
  let previous = -1;
  for (const s of d.samples) {
    if (!s || !Number.isInteger(s.id) || s.id <= previous || !Number.isFinite(s.time) || !vector(s.center, 3) || !vector(s.terrain, 17 * 17) || typeof s.truncated !== 'boolean' || !s.systems || !Array.isArray(s.objects) || s.objects.length > 128) fail();
    previous = s.id;
    for (const o of s.objects) {
      if (!Number.isInteger(o.id) || !vector(o.position, 3) || typeof o.name !== 'string' || typeof o.kind !== 'string' || typeof o.definition !== 'string' || !o.state || !Array.isArray(o.meshes) || o.meshes.length > 64 || !Array.isArray(o.colliders) || o.colliders.length > 32) fail();
      for (const m of o.meshes) if (!Object.hasOwn(d.meshes, m.geometry) || !vector(m.matrix, 16)) fail();
      for (const c of o.colliders) if (!vector(c.position, 3) || !vector(c.rotation, 4) || !vector(c.half, 3) || !Number.isInteger(c.shape) || !Number.isFinite(c.radius) || !Number.isFinite(c.height) || c.radius < 0 || c.height < 0 || c.half.some(x => x < 0)) fail();
    }
  }
  return d;
}
