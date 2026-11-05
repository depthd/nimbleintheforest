// A height layer, not a particle simulation. Mass is expressed as metres of
// fresh snow per m²; compaction changes density without consuming that mass.
import * as THREE from 'three';

export const CELL = 0.04;
export const TILE_CELLS = 80;
export const TILE_SIZE = CELL * TILE_CELLS;
const COUNT = TILE_CELLS * TILE_CELLS;
export interface BootPose { position: THREE.Vector3; rotation: THREE.Quaternion }
export interface SnowRect { minX: number; minZ: number; maxX: number; maxZ: number }
interface Hot { mass: Float32Array; packed: Uint8Array; age: number }
interface Cold { indices: Uint16Array; mass: Float32Array; packed: Uint8Array }
interface Tile { hot?: Hot; cold?: Cold }
const clamp = THREE.MathUtils.clamp;
const low = [-0.0725, 0, -0.20], high = [0.0725, 0.26, 0.11];

export class SnowField {
  onRecordedChange?: (change: [number, number, number, number, number, number]) => void;
  readonly thickness: number;
  readonly densityRatio: number;
  readonly variableSurface: boolean;
  private tiles = new Map<string, Tile>();
  private age = 0;
  private dirty: SnowRect | null = null;
  private base: (x: number, z: number) => number;
  private coverage: (x: number, z: number) => number;
  private contains: (x: number, z: number) => boolean;
  constructor(options: { thickness: number; densityRatio: number;
    base?: (x: number, z: number) => number; coverage?: (x: number, z: number) => number;
    contains?: (x: number, z: number) => boolean }) {
    this.thickness = options.thickness;
    this.densityRatio = Math.max(1.01, options.densityRatio);
    this.base = options.base ?? (() => 0);
    this.coverage = options.coverage ?? (() => 1);
    this.variableSurface = !!options.coverage;
    this.contains = options.contains ?? (() => true);
  }
  baseHeight(x: number, z: number) { return this.base(x, z); }
  initialThickness(x: number, z: number) { return this.thickness * this.coverage(x, z); }

  private address(ix: number, iz: number) {
    const tx = Math.floor(ix / TILE_CELLS), tz = Math.floor(iz / TILE_CELLS);
    return { key: `${tx},${tz}`, index: (iz - tz * TILE_CELLS) * TILE_CELLS + ix - tx * TILE_CELLS };
  }
  private read(ix: number, iz: number) {
    const a = this.address(ix, iz), t = this.tiles.get(a.key);
    let delta = 0, compaction = 0;
    if (t?.hot) { delta = t.hot.mass[a.index]; compaction = t.hot.packed[a.index] / 255; }
    else if (t?.cold) {
      const c = t.cold;
      let lo = 0, hi = c.indices.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (c.indices[mid] < a.index) lo = mid + 1; else hi = mid; }
      if (c.indices[lo] === a.index) { delta = c.mass[lo]; compaction = c.packed[lo] / 255; }
    }
    const mass = Math.max(0, this.initialThickness(ix * CELL, iz * CELL) + delta);
    return { mass, compaction, height: mass / (1 + compaction * (this.densityRatio - 1)) };
  }
  sample(x: number, z: number) {
    const gx = x / CELL, gz = z / CELL, ix = Math.floor(gx), iz = Math.floor(gz);
    const u = gx - ix, v = gz - iz;
    const a = this.read(ix, iz), b = this.read(ix + 1, iz), c = this.read(ix, iz + 1), d = this.read(ix + 1, iz + 1);
    const mix = (key: 'mass' | 'height' | 'compaction') =>
      (a[key] * (1 - u) + b[key] * u) * (1 - v) + (c[key] * (1 - u) + d[key] * u) * v;
    return { height: mix('height'), mass: mix('mass'), compaction: mix('compaction') };
  }
  /** Effective support under a person's load. The solid base is the lower bound. */
  support(x: number, z: number) { return this.sample(x, z).mass / this.densityRatio; }

  /** Allocation-free grid reads for mesh streaming. Rendering must not perform
   * four interpolated material queries for every vertex and normal neighbour. */
  gridValue(ix: number, iz: number, packedOnly = false): number {
    const tx = Math.floor(ix / TILE_CELLS), tz = Math.floor(iz / TILE_CELLS);
    const index = (iz - tz * TILE_CELLS) * TILE_CELLS + ix - tx * TILE_CELLS;
    const t = this.tiles.get(`${tx},${tz}`);
    let delta = 0, packed = 0;
    if (t?.hot) { delta = t.hot.mass[index]; packed = t.hot.packed[index]; }
    else if (t?.cold) {
      const c = t.cold; let lo = 0, hi = c.indices.length;
      while (lo < hi) { const m = (lo + hi) >>> 1; if (c.indices[m] < index) lo = m + 1; else hi = m; }
      if (c.indices[lo] === index) { delta = c.mass[lo]; packed = c.packed[lo]; }
    }
    return packedOnly ? packed / 255 : Math.max(0, this.initialThickness(ix * CELL, iz * CELL) + delta) / (1 + packed / 255 * (this.densityRatio - 1));
  }
  hasChangesNear(tx: number, tz: number) {
    for (let z = tz - 1; z <= tz + 1; z++) for (let x = tx - 1; x <= tx + 1; x++)
      if (this.tiles.has(`${x},${z}`)) return true;
    return false;
  }

  private warm(key: string) {
    let t = this.tiles.get(key);
    if (!t) { t = {}; this.tiles.set(key, t); }
    if (!t.hot) {
      // Only mutations warm tiles. Reading old trails never expands cold storage.
      if ([...this.tiles.values()].filter(t => t.hot).length >= 32) {
        let oldest: Tile | undefined, age = Infinity;
        for (const other of this.tiles.values()) if (other.hot && other.hot.age < age) { oldest = other; age = other.hot.age; }
        if (oldest?.hot) {
          const h = oldest.hot, ids: number[] = [];
          for (let i = 0; i < COUNT; i++) if (h.mass[i] !== 0 || h.packed[i] !== 0) ids.push(i);
          oldest.cold = { indices: Uint16Array.from(ids), mass: Float32Array.from(ids, i => h.mass[i]), packed: Uint8Array.from(ids, i => h.packed[i]) };
          oldest.hot = undefined;
        }
      }
      const h = { mass: new Float32Array(COUNT), packed: new Uint8Array(COUNT), age: ++this.age };
      if (t.cold) for (let i = 0; i < t.cold.indices.length; i++) {
        const k = t.cold.indices[i]; h.mass[k] = t.cold.mass[i]; h.packed[k] = t.cold.packed[i];
      }
      t.hot = h; t.cold = undefined;
    }
    t.hot.age = ++this.age;
    return t.hot;
  }
  private write(ix: number, iz: number, mass: number, compaction: number) {
    const a = this.address(ix, iz), h = this.warm(a.key);
    const oldMass = h.mass[a.index], oldPacked = h.packed[a.index];
    h.mass[a.index] = mass - this.initialThickness(ix * CELL, iz * CELL);
    h.packed[a.index] = Math.ceil(clamp(compaction, 0, 1) * 255);
    if (this.onRecordedChange && (oldMass !== h.mass[a.index] || oldPacked !== h.packed[a.index]))
      this.onRecordedChange([ix, iz, oldMass, oldPacked, h.mass[a.index], h.packed[a.index]]);
    this.markDirty(ix, iz);
  }
  /** Lossless diagnostic state. These APIs do not excavate, deposit or compact. */
  recordedCells(): [number, number, number, number][] {
    const cells: [number, number, number, number][] = [];
    for (const [key, t] of this.tiles) {
      const [tx, tz] = key.split(',').map(Number);
      const append = (i: number, mass: number, packed: number) => {
        if (mass || packed) cells.push([tx * TILE_CELLS + i % TILE_CELLS, tz * TILE_CELLS + Math.floor(i / TILE_CELLS), mass, packed]);
      };
      if (t.hot) for (let i = 0; i < COUNT; i++) append(i, t.hot.mass[i], t.hot.packed[i]);
      else if (t.cold) for (let i = 0; i < t.cold.indices.length; i++) append(t.cold.indices[i], t.cold.mass[i], t.cold.packed[i]);
    }
    return cells;
  }
  applyRecordedCell(ix: number, iz: number, massDelta: number, packed: number) {
    const a = this.address(ix, iz), h = this.warm(a.key);
    h.mass[a.index] = massDelta; h.packed[a.index] = packed; this.markDirty(ix, iz);
  }
  private markDirty(ix: number, iz: number) {
    const x = ix * CELL, z = iz * CELL;
    if (!this.dirty) this.dirty = { minX: x, maxX: x, minZ: z, maxZ: z };
    else { this.dirty.minX = Math.min(x, this.dirty.minX); this.dirty.maxX = Math.max(x, this.dirty.maxX);
      this.dirty.minZ = Math.min(z, this.dirty.minZ); this.dirty.maxZ = Math.max(z, this.dirty.maxZ); }
  }
  takeDirty() { const d = this.dirty; this.dirty = null; return d; }

  /** Sweep the whole oriented boot, including heel lift and its toe pivot.
   * Subdivision follows travel/rotation, not elapsed time or walked distance. */
  sweepBoot(from: BootPose, to: BootPose) {
    const travel = from.position.distanceTo(to.position);
    if (travel > 2) return; // teleport/reset is not a snow-cutting movement
    const angle = from.rotation.angleTo(to.rotation);
    const steps = Math.max(1, Math.ceil((travel + angle * 0.3) / (CELL * 0.5)));
    const position = new THREE.Vector3(), rotation = new THREE.Quaternion();
    for (let k = 0; k <= steps; k++) {
      position.lerpVectors(from.position, to.position, k / steps);
      rotation.slerpQuaternions(from.rotation, to.rotation, k / steps);
      this.press(position, rotation);
    }
  }
  private press(position: THREE.Vector3, rotation: THREE.Quaternion) {
    const inv = rotation.clone().invert();
    const vertical = new THREE.Vector3(0, 1, 0).applyQuaternion(inv).toArray();
    // Bound the x/z projection of all eight box corners.
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const corner = new THREE.Vector3();
    for (const x of [low[0], high[0]]) for (const y of [low[1], high[1]]) for (const z of [low[2], high[2]]) {
      corner.set(x, y, z).applyQuaternion(rotation).add(position);
      x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x); z0 = Math.min(z0, corner.z); z1 = Math.max(z1, corner.z);
    }
    const local = new THREE.Vector3(), edge = new THREE.Vector3();
    const localVertical = new THREE.Vector3().fromArray(vertical);
    const deposits = new Map<string, { ix: number; iz: number; mass: number }>();
    for (let iz = Math.ceil(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) for (let ix = Math.ceil(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
      const x = ix * CELL, z = iz * CELL;
      if (!this.contains(x, z)) continue;
      local.set(x - position.x, 0, z - position.z).applyQuaternion(inv);
      const o = local.toArray(); let enter = -Infinity, exit = Infinity;
      for (let axis = 0; axis < 3; axis++) {
        const d = vertical[axis];
        if (Math.abs(d) < 1e-8) { if (o[axis] < low[axis] || o[axis] > high[axis]) { exit = -Infinity; break; } }
        else { const a = (low[axis] - o[axis]) / d, b = (high[axis] - o[axis]) / d;
          enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b)); }
      }
      if (exit < enter) continue;
      const ground = this.base(x, z), s = this.read(ix, iz);
      const bottom = position.y + enter - ground, top = position.y + exit - ground;
      if (top <= 0 || bottom >= s.height - 0.0008) continue;
      local.addScaledVector(localVertical, enter);
      // Rounded boot outline with a one-cell soft shoulder. The target depends
      // on material quantity, not its current height, so repeated idle contact
      // does not progressively erase this shoulder.
      const qx = Math.abs(local.x) - (0.0725 - 0.022);
      const qz = Math.abs(local.z + 0.045) - (0.155 - 0.022);
      const signed = Math.hypot(Math.max(0, qx), Math.max(0, qz)) + Math.min(0, Math.max(qx, qz)) - 0.022;
      if (signed >= 0) continue;
      const blend = THREE.MathUtils.smoothstep(-signed, 0, CELL * 0.65);
      const target = Math.max(0.002, bottom + (s.mass - bottom) * (1 - blend));
      if (target >= s.height - 0.0008) continue;
      // A small amount moves to the lip; the rest of the depression is compaction.
      // The lip gets the same mass removed here, not an arbitrary visual mound.
      const moved = Math.min(s.mass, (s.height - target) * 0.12 * (1 - s.compaction));
      edge.set(Math.sign(local.x || 1) * 0.13, 0, clamp(local.z, -0.22, 0.13)).applyQuaternion(rotation).add(position);
      const ex = Math.round(edge.x / CELL), ez = Math.round(edge.z / CELL);
      const canDeposit = (ex !== ix || ez !== iz) && this.contains(ex * CELL, ez * CELL);
      const mass = s.mass - (canDeposit ? moved : 0);
      const compaction = clamp((mass / target - 1) / (this.densityRatio - 1), s.compaction, 1);
      // If already fully compacted, lateral motion can push the excess to the lip.
      const excess = Math.max(0, mass - target * (1 + compaction * (this.densityRatio - 1)));
      const transfer = canDeposit ? moved + excess : 0;
      this.write(ix, iz, s.mass - transfer, compaction);
      if (transfer > 0) {
        const neighbours = [[ex, ez, 0.5], [ex + 1, ez, 0.125], [ex - 1, ez, 0.125], [ex, ez + 1, 0.125], [ex, ez - 1, 0.125]]
          .filter(([x, z]) => this.contains(x * CELL, z * CELL));
        const total = neighbours.reduce((s, n) => s + n[2], 0);
        for (const [x, z, weight] of neighbours) {
          const key = `${x},${z}`, d = deposits.get(key), mass = transfer * weight / total;
          if (d) d.mass += mass; else deposits.set(key, { ix: x, iz: z, mass });
        }
      }
    }
    for (const d of deposits.values()) { const s = this.read(d.ix, d.iz); this.write(d.ix, d.iz, s.mass + d.mass, s.compaction); }
  }

  remove(x: number, z: number, radius: number, depth: number) {
    let volume = 0;
    this.circle(x, z, radius, (ix, iz, weight) => {
      const s = this.read(ix, iz);
      const mass = Math.min(s.mass, depth * weight * (1 + s.compaction * (this.densityRatio - 1)));
      volume += mass * CELL * CELL; this.write(ix, iz, s.mass - mass, s.compaction);
    });
    return volume;
  }
  add(x: number, z: number, radius: number, volume: number) {
    let weights = 0;
    this.circle(x, z, radius, (_ix, _iz, weight) => { weights += weight; });
    if (!weights) return 0;
    this.circle(x, z, radius, (ix, iz, weight) => {
      const s = this.read(ix, iz); this.write(ix, iz, s.mass + volume * weight / (weights * CELL * CELL), s.compaction);
    });
    return volume;
  }
  private circle(x: number, z: number, radius: number, run: (ix: number, iz: number, weight: number) => void) {
    for (let iz = Math.ceil((z - radius) / CELL); iz <= Math.floor((z + radius) / CELL); iz++)
      for (let ix = Math.ceil((x - radius) / CELL); ix <= Math.floor((x + radius) / CELL); ix++) {
        const d = Math.hypot(ix * CELL - x, iz * CELL - z) / radius;
        if (d < 1 && this.contains(ix * CELL, iz * CELL)) run(ix, iz, Math.min(1, (1 - d) * 4));
      }
  }
  massChange() {
    let change = 0;
    for (const t of this.tiles.values()) for (const d of (t.hot?.mass ?? t.cold!.mass)) change += d;
    return change * CELL * CELL;
  }
  stats() {
    let bytes = 0, hotTiles = 0, modifiedCells = 0, raisedCells = 0;
    for (const t of this.tiles.values()) {
      if (t.hot) { hotTiles++; bytes += t.hot.mass.byteLength + t.hot.packed.byteLength;
        for (let i = 0; i < COUNT; i++) { if (t.hot.mass[i] || t.hot.packed[i]) modifiedCells++; if (t.hot.mass[i] > 0.001) raisedCells++; }
      } else { const c = t.cold!; bytes += c.indices.byteLength + c.mass.byteLength + c.packed.byteLength;
        modifiedCells += c.indices.length; for (const d of c.mass) if (d > 0.001) raisedCells++; }
    }
    return { tiles: this.tiles.size, hotTiles, bytes, modifiedCells, raisedCells };
  }
}
