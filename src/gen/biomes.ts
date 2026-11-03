// Biomes of the northern region: what grows where and how the ground looks.

export const enum B {
  Sea = 0,
  Water = 1,
  Coast = 2,
  Taiga = 3,
  Pine = 4,
  Birch = 5,
  Burned = 6,
  Bog = 7,
  Tundra = 8,
  Alpine = 9,
  Stones = 10,
}

export const BIOME_COUNT = 11;

export const BIOME_NAMES = [
  'Море', 'Лёд', 'Побережье', 'Тайга', 'Сосновый бор', 'Березняк', 'Гарь', 'Болото', 'Лесотундра', 'Горы', 'Каменные останцы',
];

export const enum Sp {
  Spruce = 0,
  Pine = 1,
  Birch = 2,
  Snag = 3, // grey dead tree
  Burnt = 4, // charred trunk
  Dwarf = 5, // stunted spruce
}
export const SPECIES_COUNT = 6;

export interface BiomeDef {
  /** trees per 100 m² before clearings */
  trees: number;
  /** relative species weights */
  mix: [Sp, number][];
  scale: [number, number];
  /** 0..1, how much the clearing noise thins the forest */
  clearings: number;
  /** shrubs per 100 m² */
  shrubs: number;
  /** reed tufts per 100 m² */
  reeds: number;
  /** boulders per 10 000 m² */
  rocks: number;
  /** ground look, see terrain shader: forest floor, ash, bog grass, shore pebbles */
  floor: [number, number, number, number];
  /** fine height noise multiplier */
  rough: number;
}

const none: BiomeDef = { trees: 0, mix: [], scale: [1, 1], clearings: 0, shrubs: 0, reeds: 0, rocks: 0, floor: [0, 0, 0, 0], rough: 0 };

export const BIOMES: BiomeDef[] = [
  none, // sea
  none, // lake/river ice
  { trees: 0.25, mix: [[Sp.Pine, 3], [Sp.Snag, 1], [Sp.Spruce, 1]], scale: [0.55, 1.05], clearings: 0.4, shrubs: 0.8, reeds: 1.2, rocks: 22, floor: [0.05, 0, 0.15, 0.85], rough: 0.7 },
  { trees: 2.3, mix: [[Sp.Spruce, 10], [Sp.Birch, 1], [Sp.Snag, 0.6], [Sp.Pine, 0.6]], scale: [0.5, 1.35], clearings: 0.55, shrubs: 0.6, reeds: 0, rocks: 1.5, floor: [1, 0, 0, 0], rough: 0.8 },
  { trees: 1.15, mix: [[Sp.Pine, 10], [Sp.Spruce, 1.2], [Sp.Birch, 0.4]], scale: [0.75, 1.3], clearings: 0.35, shrubs: 0.25, reeds: 0, rocks: 3, floor: [0.6, 0, 0, 0.1], rough: 0.9 },
  { trees: 1.6, mix: [[Sp.Birch, 10], [Sp.Spruce, 1.5], [Sp.Snag, 0.3]], scale: [0.55, 1.15], clearings: 0.5, shrubs: 2.2, reeds: 0.2, rocks: 1, floor: [0.45, 0, 0.05, 0], rough: 0.7 },
  { trees: 1.3, mix: [[Sp.Burnt, 10], [Sp.Birch, 2.2], [Sp.Snag, 1.5]], scale: [0.5, 1.2], clearings: 0.3, shrubs: 1.2, reeds: 0, rocks: 2, floor: [0.25, 1, 0, 0], rough: 0.8 },
  { trees: 0.35, mix: [[Sp.Snag, 3], [Sp.Dwarf, 3], [Sp.Pine, 2], [Sp.Birch, 1]], scale: [0.35, 0.8], clearings: 0.6, shrubs: 2.5, reeds: 5, rocks: 0.3, floor: [0.1, 0, 1, 0], rough: 0.25 },
  { trees: 0.22, mix: [[Sp.Dwarf, 6], [Sp.Spruce, 2], [Sp.Birch, 0.8], [Sp.Snag, 0.5]], scale: [0.35, 0.85], clearings: 0.7, shrubs: 1.8, reeds: 0.3, rocks: 14, floor: [0.05, 0, 0.2, 0.15], rough: 1.3 },
  { trees: 0.01, mix: [[Sp.Dwarf, 1]], scale: [0.3, 0.6], clearings: 0.9, shrubs: 0.15, reeds: 0, rocks: 30, floor: [0, 0, 0, 0.3], rough: 2.2 },
  { trees: 0.12, mix: [[Sp.Dwarf, 3], [Sp.Pine, 1], [Sp.Snag, 1]], scale: [0.4, 0.9], clearings: 0.7, shrubs: 1, reeds: 0, rocks: 20, floor: [0.05, 0, 0.2, 0.2], rough: 1.2 },
];
