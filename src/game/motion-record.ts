// Portable diagnostic data only. Imported recordings are data, never code.
export type SnowCell = [number, number, number, number]; // ix, iz, quantity delta, packed density
export type SnowChange = [number, number, number, number, number, number]; // ix,iz,old delta,density,new delta,density
export interface RecordedSnow { enabled: boolean; thickness: number; ratio: number; cells: SnowCell[] }
export interface MotionFrame {
  id: number; t: number; dt: number; alpha: number; pose: number[] | Float32Array; camera: number[]; view: number;
  input: any; player: any; animation: any; ticks: any[];
  snow: { enabled: boolean; reset?: RecordedSnow; changes: SnowChange[] } | null;
}
export interface MotionRecording {
  format: 'nimble-motion'; version: 1; context: any; rig: string[];
  initialSnow: RecordedSnow | null; frames: MotionFrame[];
  notes: { frameId: number; text: string }[]; selectedFrameId: number;
}
export const MAX_RECORD_FRAMES = 1800;
export const MAX_RECORD_SECONDS = 20;
export const MAX_RECORD_BYTES = 64 * 1024 * 1024;

/** Numeric vectors and all planner state (including private counters) are copied
 * for diagnosis. No reference in a record points back into the running game. */
export function diagnosticCopy(value: any): any {
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? undefined : value;
  if (value.isVector3 || value.isQuaternion) return value.toArray();
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value as any, diagnosticCopy);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v !== 'function') out[k] = diagnosticCopy(v);
  return out;
}

export class MotionRing {
  frames: MotionFrame[] = [];
  private snow: Omit<RecordedSnow, 'cells'> | null;
  private cells = new Map<string, SnowCell>();
  constructor(initialSnow: RecordedSnow | null) {
    this.snow = null; this.resetSnow(initialSnow);
  }
  private resetSnow(state: RecordedSnow | null) {
    this.cells.clear();
    this.snow = state ? { enabled: state.enabled, thickness: state.thickness, ratio: state.ratio } : null;
    if (state) for (const c of state.cells) this.cells.set(`${c[0]},${c[1]}`, [...c]);
  }
  push(frame: MotionFrame) {
    this.frames.push(frame);
    while (this.frames.length > MAX_RECORD_FRAMES || (this.frames.length > 1 && frame.t - this.frames[0].t > MAX_RECORD_SECONDS)) {
      const old = this.frames.shift()!;
      if (old.snow?.reset) this.resetSnow(old.snow.reset);
      if (old.snow && this.snow) {
        this.snow.enabled = old.snow.enabled;
        for (const c of old.snow.changes) {
          const key = `${c[0]},${c[1]}`;
          if (!c[4] && !c[5]) this.cells.delete(key); else this.cells.set(key, [c[0], c[1], c[4], c[5]]);
        }
      }
    }
  }
  initialSnow(): RecordedSnow | null { return this.snow ? { ...this.snow, cells: Array.from(this.cells.values(), c => [...c]) } : null; }
}

export function validateRecording(value: any): MotionRecording {
  const fail = () => { throw new Error('Файл записи повреждён или имеет неподдерживаемый формат.'); };
  if (!value || value.format !== 'nimble-motion' || value.version !== 1 || !value.context ||
    !Array.isArray(value.rig) || !value.rig.length || value.rig.length > 256 || !value.rig.every(x => typeof x === 'string' && x.length < 200) ||
    !Array.isArray(value.frames) || !value.frames.length || value.frames.length > MAX_RECORD_FRAMES ||
    !Array.isArray(value.notes) || value.notes.length > 200) fail();
  if (!Number.isFinite(value.context.seed) || typeof value.context.snowScene !== 'boolean' || !value.context.settings || !Number.isFinite(value.context.settings.size)) fail();
  let count = 0;
  const inspect = (v: any, depth = 0) => {
    if (++count > 8_000_000 || depth > 16) fail();
    if (typeof v === 'number' && !Number.isFinite(v)) fail();
    if (typeof v === 'string' && v.length > 4000) fail();
    if (v && typeof v === 'object') {
      if (!Array.isArray(v) && Object.keys(v).length > 150) fail();
      for (const [k, child] of Object.entries(v)) { if (['__proto__', 'prototype', 'constructor'].includes(k)) fail(); inspect(child, depth + 1); }
    }
  };
  inspect(value);
  const snow = (s: any) => {
    if (s === null) return;
    if (!s || typeof s.enabled !== 'boolean' || typeof s.thickness !== 'number' || typeof s.ratio !== 'number' || !(s.thickness > 0 && s.thickness < 10) || !(s.ratio >= 1 && s.ratio < 20) || !Array.isArray(s.cells) || s.cells.length > 500_000) fail();
    for (const c of s.cells) if (!Array.isArray(c) || c.length !== 4 || !Number.isInteger(c[0]) || !Number.isInteger(c[1]) || Math.abs(c[0]) > 1e7 || Math.abs(c[1]) > 1e7 || typeof c[2] !== 'number' || Math.abs(c[2]) > 1e4 || !Number.isInteger(c[3]) || c[3] < 0 || c[3] > 255) fail();
  };
  snow(value.initialSnow);
  let lastId = -1, lastTime = -Infinity;
  for (const f of value.frames) {
    if (!Number.isInteger(f.id) || f.id <= lastId || typeof f.t !== 'number' || f.t < lastTime ||
      !Array.isArray(f.pose) || f.pose.length !== value.rig.length * 11 || !f.pose.every(x => typeof x === 'number' && Number.isFinite(x)) ||
      !Array.isArray(f.camera) || f.camera.length !== 11 || !f.camera.every(x => typeof x === 'number') ||
      f.camera[7] <= 0 || f.camera[7] >= 180 || f.camera[8] <= 0 || f.camera[9] <= 0 || f.camera[10] <= f.camera[9] ||
      ![0, 1, 2].includes(f.view) || !Array.isArray(f.ticks) || f.ticks.length > 300 || !f.player || !Array.isArray(f.player.pos) || f.player.pos.length !== 3 || !f.player.pos.every(x => typeof x === 'number') || !f.animation) fail();
    for (const key of ['hipHeight', 'bodyYaw']) if (f.animation[key] !== undefined && typeof f.animation[key] !== 'number') fail();
    if (f.snow) {
      if (typeof f.snow.enabled !== 'boolean' || !Array.isArray(f.snow.changes) || f.snow.changes.length > 500_000) fail();
      if (f.snow.reset) snow(f.snow.reset);
      for (const c of f.snow.changes) if (!Array.isArray(c) || c.length !== 6 || !c.every(x => typeof x === 'number') || !Number.isInteger(c[0]) || !Number.isInteger(c[1]) || Math.abs(c[0]) > 1e7 || Math.abs(c[1]) > 1e7 || Math.abs(c[2]) > 1e4 || Math.abs(c[4]) > 1e4 || !Number.isInteger(c[3]) || !Number.isInteger(c[5]) || c[3] < 0 || c[3] > 255 || c[5] < 0 || c[5] > 255) fail();
    }
    lastId = f.id; lastTime = f.t;
  }
  for (const n of value.notes) if (!n || !Number.isInteger(n.frameId) || typeof n.text !== 'string' || n.text.length > 2000) fail();
  if (!value.frames.some(f => f.id === value.selectedFrameId)) fail();
  return value;
}

export async function readRecording(file: Blob): Promise<MotionRecording> {
  if (file.size > MAX_RECORD_BYTES) throw new Error('Слишком большой файл записи (не более 64 МБ).');
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  let stream = file.stream();
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Этот браузер не поддерживает сжатые записи. Откройте файл в современном Chrome или Firefox.');
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    bytes += part.value.length;
    if (bytes > MAX_RECORD_BYTES) { await reader.cancel(); throw new Error('Распакованная запись превышает 64 МБ.'); }
    chunks.push(part.value);
  }
  const text = await new Blob(chunks as BlobPart[]).text();
  return validateRecording(JSON.parse(text));
}
