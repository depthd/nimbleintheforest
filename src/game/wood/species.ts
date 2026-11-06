// Wood species and their physical properties. Values are typical for northern
// softwoods and birch; strength is for green (fresh) wood, the weakest state.

export type Species = 'spruce' | 'pine' | 'birch' | 'dead' | 'burnt';

export interface SpeciesDef {
  /** adjective forms: masculine, feminine, neuter */
  adj: [string, string, string];
  /** genitive noun: "ели", "сосны" */
  gen: string;
  /** density of dry wood, kg/m³ */
  dry: number;
  /** density of fresh wood, kg/m³ */
  green: number;
  /** bending strength, MPa */
  mor: number;
  /** compression along the grain, MPa */
  comp: number;
  /** stiffness, GPa */
  E: number;
  /** how readily the axe bites, relative to spruce */
  chop: number;
  /** colour of a fresh cut, linear RGB */
  fresh: [number, number, number];
}

export const SPECIES: Record<Species, SpeciesDef> = {
  spruce: { adj: ['еловый', 'еловая', 'еловое'], gen: 'ели', dry: 450, green: 780, mor: 36, comp: 18, E: 8.5, chop: 1, fresh: [0.58, 0.42, 0.24] },
  pine: { adj: ['сосновый', 'сосновая', 'сосновое'], gen: 'сосны', dry: 510, green: 820, mor: 40, comp: 20, E: 9, chop: 0.95, fresh: [0.6, 0.4, 0.2] },
  birch: { adj: ['берёзовый', 'берёзовая', 'берёзовое'], gen: 'берёзы', dry: 640, green: 900, mor: 44, comp: 22, E: 10, chop: 0.8, fresh: [0.7, 0.62, 0.48] },
  dead: { adj: ['сухой', 'сухая', 'сухое'], gen: 'сухостоя', dry: 430, green: 470, mor: 38, comp: 24, E: 9, chop: 1.05, fresh: [0.42, 0.34, 0.24] },
  burnt: { adj: ['обгорелый', 'обгорелая', 'обгорелое'], gen: 'обгорелого ствола', dry: 420, green: 460, mor: 26, comp: 16, E: 7, chop: 1.1, fresh: [0.2, 0.15, 0.11] },
};

/** Moisture in the game is a 0..1 wetness index: ~0.45 for a living tree, ~0.1 for seasoned wood. */
export function density(sp: Species, moisture: number) {
  const s = SPECIES[sp];
  const k = Math.min(1.3, Math.max(0, (moisture - 0.08) / 0.37));
  return s.dry + (s.green - s.dry) * k;
}

/** Fresh moisture of wood cut from a living tree, or from dead wood. */
export function freshMoisture(sp: Species) {
  return sp === 'dead' || sp === 'burnt' ? 0.12 : 0.45;
}
