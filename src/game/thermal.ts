// House heat model: two air zones (ground floor, upper floor). Each loses heat through
// walls, roof, floor, windows, the door and air leaks; fires and people add heat.
import { G } from './ctx';
import type { WindowData } from '../world/house';

export type ZoneName = 'ground' | 'upper';

export interface Part {
  label: string;
  ua: number; // W/K
}

export interface Zone {
  name: ZoneName;
  T: number;
  C: number; // J/K
  parts: Part[];
  ua: number;
  heatW: number;
  lossW: number;
}

const LEAK = 1200 * 0.05; // W/K per m² of opening per (m/s wind + 0.7)

export class Thermal {
  zones: Record<ZoneName, Zone>;
  exchange = 0;

  constructor() {
    const mk = (name: ZoneName, C: number): Zone => ({ name, T: 0, C, parts: [], ua: 0, heatW: 0, lossW: 0 });
    this.zones = { ground: mk('ground', 0.8e6), upper: mk('upper', 0.65e6) };
  }

  init() {
    const t = G.weather.temp;
    this.zones.ground.T = t + 4;
    this.zones.upper.T = t + 3;
  }

  zone(n: ZoneName) {
    return this.zones[n];
  }

  windowUA(w: WindowData, wind: number): { cond: number; leak: number } {
    const boards = 1 - 0.27 * w.boards;
    if (w.glass === 'intact') {
      let u = 5.8 * w.w * w.h;
      if (w.cover) u = (w.w * w.h) / (1 / 5.8 + 0.3);
      u *= 1 - 0.08 * w.boards;
      return { cond: u, leak: LEAK * 0.01 * (wind + 0.7) };
    }
    const area = w.w * w.h * (w.cover ? 0.25 : 1) * boards;
    return { cond: (w.cover ? 3 : 6) * w.w * w.h, leak: LEAK * area * (wind + 0.7) };
  }

  private computeParts(z: Zone, wind: number) {
    const parts: Part[] = [];
    if (z.name === 'ground') {
      parts.push({ label: 'Стены', ua: 40 });
      parts.push({ label: 'Пол', ua: 20 });
    } else {
      parts.push({ label: 'Стены', ua: 28 });
      parts.push({ label: 'Крыша', ua: 26 });
    }
    let winCond = 0, winLeak = 0, broken = 0, covered = 0;
    for (const e of G.house.windows) {
      const w = e.data as WindowData;
      if (w.zone !== z.name) continue;
      const r = this.windowUA(w, wind);
      winCond += r.cond;
      winLeak += r.leak;
      if (w.glass === 'broken') broken++;
      if (w.cover || w.boards) covered++;
    }
    parts.push({ label: `Окна${covered ? ` (утеплено ${covered})` : ''}`, ua: winCond });
    if (winLeak > 1) parts.push({ label: broken ? `Сквозняк: разбитые окна ×${broken}` : 'Щели в окнах', ua: winLeak });
    if (z.name === 'ground') {
      const door = G.house.door;
      if (!door.removed) {
        if (door.data.open || Math.abs(door.data.angle) > 0.15) parts.push({ label: 'Открытая дверь!', ua: LEAK * 2.0 * (wind + 0.7) });
        else parts.push({ label: 'Дверь', ua: 5 + LEAK * 0.03 * (wind + 0.7) });
      } else {
        const dw = G.house.doorway;
        const covered = !!dw?.data.cover;
        parts.push({ label: covered ? 'Проём (завешен)' : 'Пустой дверной проём!', ua: LEAK * 2.1 * (covered ? 0.22 : 1) * (wind + 0.7) + 8 });
      }
    }
    parts.push({ label: 'Щели и вентиляция', ua: 6 + LEAK * 0.02 * (wind + 0.7) });
    z.parts = parts;
    z.ua = parts.reduce((s, p) => s + p.ua, 0);
  }

  update(dtGame: number) {
    const tout = G.weather.temp;
    const wind = Math.min(G.weather.wind, 20);
    const g = this.zones.ground, u = this.zones.upper;
    this.computeParts(g, wind);
    this.computeParts(u, wind);
    const pz = G.player ? G.house.zoneAt(G.player.pos) : null;
    let left = dtGame;
    while (left > 0) {
      const dt = Math.min(left, 20);
      left -= dt;
      for (const z of [g, u]) {
        let heat = G.fires.heatToZone(z.name) * 1000;
        if (pz === z.name) heat += 100;
        for (const e of G.entities.list) {
          if (e.defId === 'lamp' && e.lit) {
            const p = e.inWorld || e.pinned ? e.position() : G.player.pos;
            if (G.house.zoneAt(p) === z.name) heat += 80;
          }
        }
        z.heatW = heat;
        z.lossW = z.ua * (z.T - tout);
      }
      // warm air rises through the stairwell
      const k = 60 + Math.min(240, 10 * Math.abs(g.T - u.T));
      const ex = k * (g.T - u.T);
      this.exchange = ex;
      g.T += ((g.heatW - g.lossW - ex) * dt) / g.C;
      u.T += ((u.heatW - u.lossW + ex) * dt) / u.C;
    }
  }

  /** Equilibrium temperature with current heat input (for the debug panel). */
  equilibrium(z: ZoneName) {
    const Z = this.zones[z];
    return G.weather.temp + Z.heatW / Math.max(1, Z.ua);
  }
}
