// Air inside the house as a 3D grid of 0.5 m cells.
// Each cell has a temperature and absolute humidity. Heat moves between cells (mixing,
// warm air rising), leaks through walls/roof/floor (with the wall's own thermal mass),
// windows and the door; broken windows and open doors blow in cold air that sinks and
// spreads. Moist air condenses and freezes on cold glass. Corners end up colder,
// a spot by a broken window is freezing and draughty, the ceiling is warmer than the floor.
import * as THREE from 'three';
import { G } from './ctx';
import type { WindowData } from '../world/house';
import { clamp } from '../core/rng';

export type ZoneName = 'ground' | 'upper';

export interface Part {
  label: string;
  w: number; // heat loss, W
}

export interface Zone {
  name: ZoneName;
  T: number;
  rh: number;
  heatW: number;
  lossW: number;
  parts: Part[];
  ua: number; // effective W/K (loss / ΔT)
}

const X0 = -4.75, Z0 = -3.75;
const DX = 0.5;
const NX = 19, NZ = 15;
const GL = 6; // ground layers
const GH = 2.8;
const UY0 = 3.0;
const UDY = 0.48;
const UL = 9; // upper layers
const NY = GL + UL;
const N = NX * NZ * NY;
const RHO_C = 1200; // J/(m³K) for air
const MIX_H = 0.3; // m/s, room-scale circulation between neighbouring cells (sideways)
const MIX_VERT = 0.015; // m/s, vertical mixing when the air is stably layered

const LAYER_Y0: number[] = [];
const LAYER_H: number[] = [];
for (let k = 0; k < GL; k++) {
  LAYER_Y0.push((k * GH) / GL);
  LAYER_H.push(GH / GL);
}
for (let k = 0; k < UL; k++) {
  LAYER_Y0.push(UY0 + k * UDY);
  LAYER_H.push(UDY);
}

const HEAT_STOPS: [number, number][] = [
  [-20, 0x1a2bff], [-10, 0x2ea8ff], [0, 0x4af2d6], [8, 0xa8f04a], [15, 0xffd23a], [22, 0xff7a1a], [30, 0xff2020],
];
const tmpA = new THREE.Color(), tmpB = new THREE.Color();
export function heatColor(t: number, out: THREE.Color) {
  if (t <= HEAT_STOPS[0][0]) return out.setHex(HEAT_STOPS[0][1]);
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    const [t0, c0] = HEAT_STOPS[i], [t1, c1] = HEAT_STOPS[i + 1];
    if (t <= t1) return out.copy(tmpA.setHex(c0)).lerp(tmpB.setHex(c1), (t - t0) / (t1 - t0));
  }
  return out.setHex(HEAT_STOPS[HEAT_STOPS.length - 1][1]);
}

/** saturation vapour density (g/m³) over ice/water at T °C */
export function satAH(T: number) {
  const e = T < 0 ? 6.112 * Math.exp((22.46 * T) / (272.62 + T)) : 6.112 * Math.exp((17.62 * T) / (243.12 + T));
  return (e * 100 * 1000) / (461.5 * (T + 273.15));
}

type FaceKind = 'wall' | 'floor' | 'roof';

interface Face {
  cell: number;
  kind: FaceKind;
  area: number;
  win: number; // index into windows, -1 none
  winFrac: number;
  door: number; // fraction of area that is the door
  Ts: number; // inner surface temperature of the opaque part
  glassT: number;
  nIn: THREE.Vector3; // points into the house
  pos: THREE.Vector3; // world position of face centre
  jet: number[]; // cells reached by incoming air
  jetW: number[];
  zone: ZoneName;
  stoveW: number; // share of the stove's radiant heat this surface receives
}

export class Thermal {
  T = new Float32Array(N);
  AH = new Float32Array(N);
  draft = new Float32Array(N);
  active = new Uint8Array(N);
  private C = new Float32Array(N);
  private V = new Float32Array(N);
  private num = new Float64Array(N);
  private den = new Float64Array(N);
  private hnum = new Float64Array(N);
  private hden = new Float64Array(N);
  private src = new Float64Array(N); // W, explicit sources
  private vap = new Float64Array(N); // g/s vapour sources
  private pendingVapour = new Float64Array(N); // g, added once
  private la: number[] = [];
  private lb: number[] = [];
  private lk: number[] = [];
  private lvert: number[] = [];
  private lopen: number[] = [];
  private linkK = new Float64Array(0);
  private nbStart = new Int32Array(N + 1);
  private nbCell = new Int32Array(0);
  private nbLink = new Int32Array(0);
  faces: Face[] = [];
  windowFrost: number[] = []; // grams of frost per window
  windowGlassT: number[] = [];
  zones: Record<ZoneName, Zone>;
  private Y0 = 0;
  overlay: THREE.InstancedMesh | null = null;
  overlayMode: 'off' | 'temp' | 'rh' | 'draft' = 'off';
  exchange = 0;

  constructor() {
    const mk = (name: ZoneName): Zone => ({ name, T: 0, rh: 0.5, heatW: 0, lossW: 0, parts: [], ua: 0 });
    this.zones = { ground: mk('ground'), upper: mk('upper') };
  }

  // ---------- geometry ----------

  idx(ix: number, iz: number, k: number) {
    return (k * NZ + iz) * NX + ix;
  }

  cellCenter(c: number, out = new THREE.Vector3()) {
    const ix = c % NX;
    const iz = Math.floor(c / NX) % NZ;
    const k = Math.floor(c / (NX * NZ));
    return out.set(X0 + (ix + 0.5) * DX, this.Y0 + LAYER_Y0[k] + LAYER_H[k] / 2, Z0 + (iz + 0.5) * DX);
  }

  cellAt(p: THREE.Vector3): number {
    const ix = Math.floor((p.x - X0) / DX);
    const iz = Math.floor((p.z - Z0) / DX);
    if (ix < 0 || ix >= NX || iz < 0 || iz >= NZ) return -1;
    const y = p.y - this.Y0;
    let k = -1;
    if (y >= -0.3 && y < GH + 0.1) k = clamp(Math.floor((y / GH) * GL), 0, GL - 1);
    else if (y >= GH + 0.1 && y < UY0 + UL * UDY + 0.5) k = GL + clamp(Math.floor((y - UY0) / UDY), 0, UL - 1);
    if (k < 0) return -1;
    let c = this.idx(ix, iz, k);
    // step down if the cell is under the roof slope
    while (!this.active[c] && k > GL) {
      k--;
      c = this.idx(ix, iz, k);
    }
    return this.active[c] ? c : -1;
  }

  private zoneOf(k: number): ZoneName {
    return k < GL ? 'ground' : 'upper';
  }

  init() {
    this.Y0 = G.house.Y0;
    const roofY = (z: number) => 7.4 - 0.5 * Math.abs(z) - 0.12;
    for (let k = 0; k < NY; k++) for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
      const c = this.idx(ix, iz, k);
      const zc = Z0 + (iz + 0.5) * DX;
      const yc = LAYER_Y0[k] + LAYER_H[k] / 2;
      this.active[c] = k < GL || yc < roofY(zc) ? 1 : 0;
      this.V[c] = DX * DX * LAYER_H[k];
      this.C[c] = RHO_C * this.V[c] * 3; // air plus light contents
    }
    const inHole = (ix: number, iz: number) => {
      const x = X0 + (ix + 0.5) * DX, z = Z0 + (iz + 0.5) * DX;
      return x < -3.55 && z > -1.0;
    };
    // links between neighbouring cells
    for (let k = 0; k < NY; k++) for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
      const c = this.idx(ix, iz, k);
      if (!this.active[c]) continue;
      const h = LAYER_H[k];
      const add = (b: number, area: number, vert: boolean, open: boolean) => {
        if (!this.active[b]) return;
        this.la.push(c);
        this.lb.push(b);
        const frac = k < GL ? k / (GL - 1) : Math.min(1, (k - GL) / 4);
        this.lk.push(open ? RHO_C * area * (vert ? MIX_VERT : MIX_H * (0.55 + 0.45 * frac)) : 1.2 * area);
        this.lvert.push(vert ? 1 : 0);
        this.lopen.push(open ? 1 : 0);
      };
      if (ix + 1 < NX) add(this.idx(ix + 1, iz, k), DX * h, false, true);
      if (iz + 1 < NZ) add(this.idx(ix, iz + 1, k), DX * h, false, true);
      if (k + 1 < NY) add(this.idx(ix, iz, k + 1), DX * DX, true, k + 1 !== GL || inHole(ix, iz));
    }
    // neighbour lists (CSR) for the solver
    const L = this.la.length;
    this.linkK = new Float64Array(L);
    const deg = new Int32Array(N);
    for (let i = 0; i < L; i++) {
      deg[this.la[i]]++;
      deg[this.lb[i]]++;
    }
    for (let c = 0; c < N; c++) this.nbStart[c + 1] = this.nbStart[c] + deg[c];
    this.nbCell = new Int32Array(2 * L);
    this.nbLink = new Int32Array(2 * L);
    const fill = this.nbStart.slice(0, N);
    for (let i = 0; i < L; i++) {
      const a = this.la[i], b = this.lb[i];
      this.nbCell[fill[a]] = b;
      this.nbLink[fill[a]++] = i;
      this.nbCell[fill[b]] = a;
      this.nbLink[fill[b]++] = i;
    }
    // boundary faces
    const windows = G.house.windows.map((e) => e.data as WindowData);
    this.windowFrost = windows.map(() => 0);
    this.windowGlassT = windows.map(() => 0);
    const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / (a1 - a0);
    for (let k = 0; k < NY; k++) for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
      const c = this.idx(ix, iz, k);
      if (!this.active[c]) continue;
      const h = LAYER_H[k];
      const cc = this.cellCenter(c);
      const y0 = this.Y0 + LAYER_Y0[k], y1 = y0 + h;
      const mkFace = (kind: FaceKind, area: number, nIn: THREE.Vector3, pos: THREE.Vector3) => {
        const f: Face = { cell: c, kind, area, win: -1, winFrac: 0, door: 0, Ts: 0, glassT: 0, nIn, pos, jet: [], jetW: [], zone: this.zoneOf(k), stoveW: 0 };
        if (kind === 'wall') {
          // windows on this wall plane
          windows.forEach((w, wi) => {
            if (w.inward.dot(nIn) < 0.9) return;
            const planeDist = Math.abs(new THREE.Vector3().subVectors(pos, w.center).dot(nIn));
            if (planeDist > 0.4) return;
            const along = Math.abs(nIn.x) > 0.5 ? 'z' : 'x';
            const a = pos[along], ca = w.center[along];
            const fx = overlap(a - DX / 2, a + DX / 2, ca - w.w / 2, ca + w.w / 2);
            const fy = overlap(y0, y1, w.center.y - w.h / 2, w.center.y + w.h / 2);
            if (fx * fy > 0) {
              f.win = wi;
              f.winFrac = fx * fy;
            }
          });
          // the front door: z = +3.75, x 1..2, y 0..2.1
          if (nIn.z < -0.9 && k < GL) {
            const fx = overlap(pos.x - DX / 2, pos.x + DX / 2, 1.0, 2.0);
            const fy = overlap(y0 - this.Y0, y1 - this.Y0, 0, 2.1);
            f.door = fx * fy;
          }
        }
        // cells the incoming air reaches: straight in, sinking as it goes
        let cur = c;
        const weights = [0.45, 0.25, 0.18, 0.12];
        for (let s = 0; s < 4; s++) {
          if (s > 0) {
            const p = this.cellCenter(cur).addScaledVector(nIn, DX);
            p.y -= LAYER_H[k] * 0.8;
            let nc = this.cellAt(p);
            if (nc < 0 || Math.floor(nc / (NX * NZ)) < (k < GL ? 0 : GL)) {
              p.y += LAYER_H[k] * 0.8;
              nc = this.cellAt(p);
            }
            if (nc < 0) break;
            cur = nc;
          }
          f.jet.push(cur);
          f.jetW.push(weights[s]);
        }
        this.faces.push(f);
      };
      if (ix === 0) mkFace('wall', DX * h, new THREE.Vector3(1, 0, 0), cc.clone().setX(X0));
      if (ix === NX - 1) mkFace('wall', DX * h, new THREE.Vector3(-1, 0, 0), cc.clone().setX(X0 + NX * DX));
      if (iz === 0) mkFace('wall', DX * h, new THREE.Vector3(0, 0, 1), cc.clone().setZ(Z0));
      if (iz === NZ - 1) mkFace('wall', DX * h, new THREE.Vector3(0, 0, -1), cc.clone().setZ(Z0 + NZ * DX));
      if (k === 0) mkFace('floor', DX * DX, new THREE.Vector3(0, 1, 0), cc.clone().setY(this.Y0));
      const above = k + 1 < NY ? this.idx(ix, iz, k + 1) : -1;
      if (k >= GL && (above < 0 || !this.active[above])) mkFace('roof', DX * DX * 1.12, new THREE.Vector3(0, -1, 0), cc.clone().setY(y1));
      // roof slope seen from the side (neighbour above the roof line)
      if (k >= GL) {
        for (const d of [-1, 1]) {
          const niz = iz + d;
          if (niz >= 0 && niz < NZ && !this.active[this.idx(ix, niz, k)]) mkFace('roof', DX * h, new THREE.Vector3(0, -0.5, -d).normalize(), cc.clone());
        }
      }
    }
    // surfaces that see the stove (radiant heat)
    const sp = G.house.stove.data.firePos as THREE.Vector3;
    let sw = 0;
    for (const f of this.faces) {
      if (f.zone !== 'ground') continue;
      const d2 = f.pos.distanceToSquared(sp);
      if (d2 > 16) continue;
      f.stoveW = f.area * (1 - f.winFrac - f.door) / (0.5 + d2);
      sw += f.stoveW;
    }
    for (const f of this.faces) f.stoveW /= sw || 1;
    // initial state: as cold as outside, a little damp
    const t0 = G.weather.temp + 3;
    const ah0 = satAH(t0) * 0.75;
    for (let c = 0; c < N; c++) {
      this.T[c] = t0;
      this.AH[c] = ah0;
    }
    for (const f of this.faces) {
      f.Ts = t0;
      f.glassT = t0;
    }
    this.aggregate(0, 0);
  }

  // ---------- public queries ----------

  zone(n: ZoneName) {
    return this.zones[n];
  }

  /** Air temperature at a world point (outdoor temperature outside the house). */
  tAt(p: THREE.Vector3) {
    const c = this.cellAt(p);
    return c < 0 ? G.weather.temp : this.T[c];
  }

  rhAt(p: THREE.Vector3) {
    const c = this.cellAt(p);
    if (c < 0) return 0.85;
    return clamp(this.AH[c] / satAH(this.T[c]), 0, 1.2);
  }

  draftAt(p: THREE.Vector3) {
    const c = this.cellAt(p);
    return c < 0 ? 0 : this.draft[c];
  }

  /** Mean radiant temperature from nearby surfaces (cold walls and glass feel cold). */
  mrtAt(p: THREE.Vector3) {
    let sw = 0, st = 0;
    for (const f of this.faces) {
      const d2 = f.pos.distanceToSquared(p);
      if (d2 > 9) continue;
      const w = f.area / (0.3 + d2);
      const surf = f.win >= 0 ? f.Ts * (1 - f.winFrac) + f.glassT * f.winFrac : f.Ts;
      sw += w;
      st += w * surf;
    }
    const air = this.tAt(p);
    if (sw <= 0) return air;
    // surfaces are only part of what you see; the rest is room air
    const k = clamp(sw / 1.2, 0, 0.8);
    return air * (1 - k) + (st / sw) * k;
  }

  addVapour(p: THREE.Vector3, grams: number) {
    const c = this.cellAt(p);
    if (c >= 0) this.pendingVapour[c] += grams;
  }

  equilibrium(z: ZoneName) {
    const Z = this.zones[z];
    return G.weather.temp + Z.heatW / Math.max(1, Z.ua);
  }

  // ---------- simulation ----------

  private windowLeak(w: WindowData, wind: number) {
    if (w.glass === 'intact') return { u: w.cover ? 2.1 : 5.8 * (1 - 0.08 * w.boards), flow: 0.0004 * (wind + 0.7), v: 0 };
    const cover = w.cover ? 0.25 : 1;
    const boards = 1 - 0.27 * w.boards;
    const area = w.w * w.h * cover * boards;
    return { u: w.cover ? 3 : 6, flow: 0.05 * area * (wind + 0.7), v: 0.25 * (wind + 0.7) * cover * boards };
  }

  private doorLeak(wind: number) {
    const door = G.house.door;
    if (!door.removed) {
      const open = door.data.open || Math.abs(door.data.angle) > 0.15;
      return open ? { u: 6, flow: 0.05 * 2.0 * (wind + 0.7), v: 0.25 * (wind + 0.7), label: 'Открытая дверь!' } : { u: 2.2, flow: 0.0012 * (wind + 0.7), v: 0, label: 'Дверь' };
    }
    const cov = G.house.doorway?.data.cover ? 0.22 : 1;
    return { u: cov < 1 ? 3 : 6, flow: 0.05 * 2.1 * cov * (wind + 0.7), v: 0.25 * (wind + 0.7) * cov, label: cov < 1 ? 'Проём (завешен)' : 'Пустой дверной проём!' };
  }

  stoveRadW = 0;

  private sources() {
    this.src.fill(0);
    this.vap.fill(0);
    this.stoveRadW = 0;
    // the stove: radiates to nearby surfaces, heats the air around it, the pipe heats the air along it
    const sf = G.fires.stoveFire;
    if (sf && sf.power > 0) {
      const P = sf.power * 1000;
      this.stoveRadW = P * 0.3;
      const sp = G.house.stove.data.firePos as THREE.Vector3;
      // the hot plume rises and dumps most of its heat under the ceiling
      const six = Math.floor((sp.x - X0) / DX), siz = Math.floor((sp.z + 0.3 - Z0) / DX);
      const plume = [0.04, 0.04, 0.05, 0.07, 0.1, 0.12];
      for (let k = 0; k < GL; k++) {
        const c = this.idx(six, siz, k);
        this.src[c] += P * plume[k];
      }
      const ix = Math.floor((sp.x - X0) / DX), iz = Math.floor((sp.z - 0.15 - Z0) / DX);
      let nUp = 0;
      for (let k = GL; k < NY && this.active[this.idx(ix, iz, k)]; k++) nUp++;
      for (let k = 2; k < NY; k++) {
        const c = this.idx(ix, iz, k);
        if (!this.active[c]) break;
        this.src[c] += P * (k < GL ? 0.08 / (GL - 2) : 0.12 / Math.max(1, nUp));
      }
    }
    // campfires inside (shouldn't happen, but heat is heat)
    for (const f of G.fires.list) {
      if (f.kind !== 'camp' || f.power <= 0) continue;
      const c = this.cellAt(f.pos);
      if (c >= 0) this.src[c] += f.power * 900;
    }
    // people and lamps
    const P = G.player;
    if (P) {
      const pc = this.cellAt(P.pos.clone().add(new THREE.Vector3(0, 1.1, 0)));
      if (pc >= 0) {
        this.src[pc] += 100;
        this.vap[pc] += 40 / 3600; // breathing, g/s
      }
    }
    for (const e of G.entities.list) {
      if (e.defId !== 'lamp' || !e.lit) continue;
      const p = e.inWorld || e.pinned ? e.position() : G.player.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
      const c = this.cellAt(p);
      if (c >= 0) this.src[c] += 80;
    }
  }

  update(dtGame: number) {
    if (!this.faces.length) return;
    const tout = G.weather.temp;
    const tground = tout + 3;
    const wind = Math.min(G.weather.wind, 20);
    const ahOut = satAH(tout) * 0.85;
    this.sources();
    const windows = G.house.windows.map((e) => e.data as WindowData);
    const wl = windows.map((w) => this.windowLeak(w, wind));
    const dl = this.doorLeak(wind);
    // window area per window across faces (for splitting leaks)
    const winArea = windows.map(() => 0);
    let doorArea = 0;
    for (const f of this.faces) {
      if (f.win >= 0) winArea[f.win] += f.area * f.winFrac;
      doorArea += f.area * f.door;
    }
    // draughts: speed of incoming air decays with distance from the opening
    this.draft.fill(0);
    for (const f of this.faces) {
      let v = 0;
      if (f.win >= 0) v += wl[f.win].v * f.winFrac;
      if (f.door > 0) v += dl.v * f.door;
      if (v < 0.05) continue;
      for (let s = 0; s < f.jet.length; s++) this.draft[f.jet[s]] = Math.max(this.draft[f.jet[s]], v * (1 - s * 0.2));
    }
    // spread draught a bit further with distance falloff
    const draftSrc = [...this.draft];
    for (let c = 0; c < N; c++) {
      if (!this.active[c] || draftSrc[c] <= 0) continue;
      const p = this.cellCenter(c);
      for (let d = 1; d <= 3; d++) {
        for (const off of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
          const q = this.cellAt(new THREE.Vector3(p.x + off[0] * DX, p.y, p.z + off[1] * DX));
          if (q >= 0) this.draft[q] = Math.max(this.draft[q], draftSrc[c] * Math.exp(-d * 0.55));
        }
      }
    }

    let left = dtGame;
    while (left > 1e-6) {
      const dt = Math.min(left, 10);
      left -= dt;
      this.step(dt, tout, tground, wind, ahOut, windows, wl, dl, winArea, doorArea);
    }
    this.aggregate(tout, wind);
  }

  private step(dt: number, tout: number, tground: number, wind: number, ahOut: number, windows: WindowData[], wl: { u: number; flow: number; v: number }[], dl: { u: number; flow: number; v: number }, winArea: number[], doorArea: number) {
    const T = this.T, AH = this.AH, C = this.C, V = this.V;
    const num = this.num, den = this.den, hnum = this.hnum, hden = this.hden;
    for (let c = 0; c < N; c++) {
      if (!this.active[c]) continue;
      num[c] = C[c] * T[c] + dt * this.src[c];
      den[c] = C[c];
      hnum[c] = V[c] * AH[c] + dt * this.vap[c] + this.pendingVapour[c];
      hden[c] = V[c];
      this.pendingVapour[c] = 0;
    }
    // mixing between cells (coefficients from the start of the step); warm air below cold air
    // turns over, warm air spreads sideways under the ceiling
    const K = this.linkK;
    for (let i = 0; i < this.la.length; i++) {
      const a = this.la[i], b = this.lb[i];
      let k = this.lk[i];
      if (this.lopen[i]) {
        if (this.lvert[i]) {
          if (T[a] > T[b]) k += RHO_C * DX * DX * 0.12 * Math.min(3, T[a] - T[b]);
        } else {
          // the warm current runs under the ceiling; near the floor it is the cool return flow
          const lay = Math.floor(a / (NX * NZ));
          const frac = lay < GL ? lay / (GL - 1) : (lay - GL) / 4;
          k += RHO_C * DX * LAYER_H[lay] * 0.15 * (0.1 + 0.9 * Math.min(1, frac)) * Math.min(4, Math.abs(T[a] - T[b]));
        }
        const dr = Math.max(this.draft[a], this.draft[b]);
        if (dr > 0.1) k *= 1 + dr * 2;
      }
      K[i] = k;
    }
    // envelope
    const R_IN = 0.13;
    for (const f of this.faces) {
      const c = f.cell;
      const opaque = 1 - f.winFrac - f.door;
      if (opaque > 0) {
        const A = f.area * opaque;
        const rOut = f.kind === 'wall' ? 1.65 : f.kind === 'floor' ? 2.2 : 2.3;
        const ext = f.kind === 'floor' ? tground : tout;
        const gin = A / R_IN, gout = A / rOut;
        const Cs = A * (f.kind === 'roof' ? 4000 : 5000);
        // surface node with thermal mass (explicit, slow); the stove also warms nearby surfaces by radiation
        const rad = f.stoveW > 0 ? this.stoveRadW * f.stoveW : 0;
        f.Ts += ((gin * (T[c] - f.Ts) - gout * (f.Ts - ext) + rad) * dt) / Cs;
        num[c] += dt * gin * f.Ts;
        den[c] += dt * gin;
        // condensation / frost on cold walls (corners get damp)
        const sat = satAH(f.Ts);
        if (AH[c] > sat) {
          const gm = A * 0.002;
          hnum[c] += dt * gm * sat;
          hden[c] += dt * gm;
        }
      }
      if (f.win >= 0 && f.winFrac > 0) {
        const L = wl[f.win];
        const A = f.area * f.winFrac;
        const ua = L.u * A;
        num[c] += dt * ua * tout;
        den[c] += dt * ua;
        f.glassT = T[c] - (L.u * (T[c] - tout)) / 7.7;
        const share = winArea[f.win] > 0 ? A / winArea[f.win] : 0;
        this.leak(f, L.flow * share, tout, ahOut, dt);
        // frost on the glass
        const w = windows[f.win];
        if (w.glass === 'intact') {
          const sat = satAH(f.glassT);
          const gm = A * 0.003;
          if (AH[c] > sat) {
            const g = gm * (AH[c] - sat) * dt;
            hnum[c] += dt * gm * sat;
            hden[c] += dt * gm;
            this.windowFrost[f.win] += g;
          } else if (this.windowFrost[f.win] > 0) {
            const g = Math.min(this.windowFrost[f.win], gm * (sat - AH[c]) * dt * 0.5);
            this.windowFrost[f.win] -= g;
            hnum[c] += g;
          }
          this.windowGlassT[f.win] = f.glassT;
        } else this.windowFrost[f.win] = 0;
      }
      if (f.door > 0) {
        const A = f.area * f.door;
        num[c] += dt * dl.u * A * tout;
        den[c] += dt * dl.u * A;
        this.leak(f, dl.flow * (doorArea > 0 ? A / doorArea : 0), tout, ahOut, dt);
      }
      // background infiltration through cracks, mostly low on the walls
      if (f.kind === 'wall') {
        const k = Math.floor(f.cell / (NX * NZ));
        const low = k === 0 || k === GL ? 1 : 0.15;
        this.leak(f, 0.000012 * f.area * low * (wind + 0.7), tout, ahOut, dt);
      }
    }
    // implicit step solved with Gauss–Seidel sweeps (stable for long steps, no oscillation)
    const ns = this.nbStart, nc = this.nbCell, nl = this.nbLink, open = this.lopen;
    for (let sweep = 0; sweep < 3; sweep++) {
      const fwd = sweep % 2 === 0;
      for (let q = 0; q < N; q++) {
        const c = fwd ? q : N - 1 - q;
        if (!this.active[c]) continue;
        let st = 0, sk = 0, sh = 0, sm = 0;
        for (let j = ns[c]; j < ns[c + 1]; j++) {
          const b = nc[j];
          const k = K[nl[j]];
          st += k * T[b];
          sk += k;
          if (open[nl[j]]) {
            const m = k / RHO_C;
            sh += m * AH[b];
            sm += m;
          }
        }
        T[c] = (num[c] + dt * st) / (den[c] + dt * sk);
        AH[c] = Math.max(0.05, (hnum[c] + dt * sh) / (hden[c] + dt * sm));
      }
    }
  }

  /** Outdoor air entering through a face, reaching a few cells inwards. */
  private leak(f: Face, flow: number, tout: number, ahOut: number, dt: number) {
    if (flow <= 0) return;
    const num = this.num, den = this.den, hnum = this.hnum, hden = this.hden;
    for (let s = 0; s < f.jet.length; s++) {
      const c = f.jet[s];
      const F = flow * f.jetW[s];
      const g = F * RHO_C;
      num[c] += dt * g * tout;
      den[c] += dt * g;
      hnum[c] += dt * F * ahOut;
      hden[c] += dt * F;
    }
  }

  /** Zone averages and a breakdown of losses for the parameters panel. */
  private aggregate(tout: number, wind: number) {
    const windows = G.house.windows.map((e) => e.data as WindowData);
    const wl = windows.map((w) => this.windowLeak(w, wind));
    const dl = this.doorLeak(wind);
    for (const zn of ['ground', 'upper'] as ZoneName[]) {
      let vt = 0, vv = 0, rh = 0;
      for (let c = 0; c < N; c++) {
        if (!this.active[c]) continue;
        const k = Math.floor(c / (NX * NZ));
        if (this.zoneOf(k) !== zn) continue;
        vt += this.T[c] * this.V[c];
        rh += clamp(this.AH[c] / satAH(this.T[c]), 0, 1.2) * this.V[c];
        vv += this.V[c];
      }
      const Z = this.zones[zn];
      Z.T = vt / vv;
      Z.rh = rh / vv;
      const sums: Record<string, number> = {};
      const add = (l: string, w: number) => (sums[l] = (sums[l] ?? 0) + w);
      let winArea = windows.map(() => 0);
      let doorArea = 0;
      for (const f of this.faces) {
        if (f.win >= 0) winArea[f.win] += f.area * f.winFrac;
        doorArea += f.area * f.door;
      }
      for (const f of this.faces) {
        if (f.zone !== zn) continue;
        const Tc = this.T[f.cell];
        const opaque = 1 - f.winFrac - f.door;
        if (opaque > 0) {
          const label = f.kind === 'wall' ? 'Стены' : f.kind === 'floor' ? 'Пол' : 'Крыша';
          add(label, ((f.area * opaque) / 0.13) * (Tc - f.Ts));
        }
        if (f.win >= 0) {
          const A = f.area * f.winFrac;
          const L = wl[f.win];
          const w = windows[f.win];
          add(w.glass === 'broken' ? 'Разбитые окна: сквозняк' : 'Окна', L.u * A * (Tc - tout) + (winArea[f.win] > 0 ? (L.flow * A) / winArea[f.win] : 0) * RHO_C * (Tc - tout));
        }
        if (f.door > 0) {
          const A = f.area * f.door;
          add(dl.label, dl.u * A * (Tc - tout) + (doorArea > 0 ? (dl.flow * A) / doorArea : 0) * RHO_C * (Tc - tout));
        }
      }
      Z.parts = Object.entries(sums).map(([label, w]) => ({ label, w })).sort((a, b) => b.w - a.w);
      Z.lossW = Z.parts.reduce((s, p) => s + p.w, 0);
      Z.heatW = zn === 'ground' ? this.stoveRadW : 0;
      for (let c = 0; c < N; c++) {
        if (!this.active[c]) continue;
        if (this.zoneOf(Math.floor(c / (NX * NZ))) === zn) Z.heatW += this.src[c];
      }
      // conductance of the envelope (W/K), independent of current temperatures
      let ua = 0;
      for (const f of this.faces) {
        if (f.zone !== zn) continue;
        const opaque = 1 - f.winFrac - f.door;
        const rOut = f.kind === 'wall' ? 1.65 : f.kind === 'floor' ? 2.2 : 2.3;
        ua += (f.area * opaque) / (0.13 + rOut);
        if (f.win >= 0) {
          const A = f.area * f.winFrac;
          ua += wl[f.win].u * A + (winArea[f.win] > 0 ? (wl[f.win].flow * A) / winArea[f.win] : 0) * RHO_C;
        }
        if (f.door > 0) {
          const A = f.area * f.door;
          ua += dl.u * A + (doorArea > 0 ? (dl.flow * A) / doorArea : 0) * RHO_C;
        }
        if (f.kind === 'wall') {
          const k = Math.floor(f.cell / (NX * NZ));
          ua += 0.000012 * f.area * (k === 0 || k === GL ? 1 : 0.15) * (wind + 0.7) * RHO_C;
        }
      }
      Z.ua = ua;
    }
    // exchange through the stairwell (for display)
    this.exchange = (this.zones.ground.T - this.zones.upper.T) * 80;
    this.updateOverlay();
  }

  // ---------- "thermal vision" overlay ----------

  setOverlay(mode: 'off' | 'temp' | 'rh' | 'draft') {
    this.overlayMode = mode;
    if (mode !== 'off' && !this.overlay) {
      const geo = new THREE.PlaneGeometry(DX * 0.97, DX * 0.97);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.62, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false });
      this.overlay = new THREE.InstancedMesh(geo, m, NX * NZ);
      this.overlay.frustumCulled = false;
      this.overlay.renderOrder = 10;
      for (let i = 0; i < NX * NZ; i++) this.overlay.setColorAt(i, new THREE.Color(1, 1, 1));
      G.scene.add(this.overlay);
    }
    if (this.overlay) this.overlay.visible = mode !== 'off';
    this.updateOverlay();
  }

  private updateOverlay() {
    const o = this.overlay;
    if (!o || this.overlayMode === 'off') return;
    const P = G.player;
    if (!P) return;
    const chest = P.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
    let c0 = this.cellAt(chest);
    const k = c0 >= 0 ? Math.floor(c0 / (NX * NZ)) : P.pos.y - this.Y0 > 2.9 ? GL + 2 : 2;
    const floorY = this.Y0 + (k < GL ? 0 : UY0);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    let i = 0;
    for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
      const c = this.idx(ix, iz, k);
      const p = this.cellCenter(c);
      if (!this.active[c]) {
        m.makeScale(0, 0, 0);
        o.setMatrixAt(i, m);
        i++;
        continue;
      }
      // the slice at chest height is painted on the floor so it doesn't block the view
      m.makeTranslation(p.x, floorY + 0.04, p.z);
      o.setMatrixAt(i, m);
      if (this.overlayMode === 'temp') {
        heatColor(this.T[c], col);
      } else if (this.overlayMode === 'rh') {
        const rh = clamp(this.AH[c] / satAH(this.T[c]), 0, 1);
        col.setRGB(1 - rh * 0.8, 0.85 - rh * 0.3, 0.3 + rh * 0.7);
      } else {
        const d = clamp(this.draft[c] / 2, 0, 1);
        col.setRGB(0.2 + d * 0.8, 0.9 - d * 0.7, 0.3 + d * 0.6);
      }
      o.setColorAt(i, col);
      i++;
    }
    o.instanceMatrix.needsUpdate = true;
    if (o.instanceColor) o.instanceColor.needsUpdate = true;
  }
}
