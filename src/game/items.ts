// Item catalogue. Everything the player can pick up, carry, burn, wear, eat or chop.

export type ToolTag =
  | 'axe' | 'saw' | 'knife' | 'blunt' | 'hammer' | 'prybar' | 'shovel' | 'auger' | 'rod'
  | 'matches' | 'lighter' | 'flashlight' | 'lamp' | 'pot';

export type Slot = 'head' | 'neck' | 'base' | 'mid' | 'outer' | 'legs' | 'socks' | 'feet' | 'hands' | 'back';

export const SLOT_NAMES: Record<Slot, string> = {
  head: 'Голова', neck: 'Шея', base: 'Бельё', mid: 'Свитер', outer: 'Верх', legs: 'Ноги',
  socks: 'Носки', feet: 'Обувь', hands: 'Руки', back: 'Спина',
};

export type FuelKind = 'tinder' | 'kindling' | 'wood' | 'log' | 'cloth' | 'paper' | 'boughs';

export interface Yield {
  id: string;
  n: number;
}

export interface ChopSpec {
  hp: number; // hits with a power-1 tool
  axe?: Yield[];
  saw?: Yield[];
  knife?: Yield[];
  blunt?: Yield[];
  knifeLabel?: string;
}

export type Shape =
  | { t: 'box'; x: number; y: number; z: number } // half extents
  | { t: 'cyl'; r: number; h: number } // radius, half height (axis Y)
  | { t: 'cylx'; r: number; h: number } // cylinder lying along X
  | { t: 'ball'; r: number };

export interface ItemDef {
  id: string;
  name: string;
  mass: number;
  shape: Shape;
  pocket: boolean;
  desc?: string;
  tool?: { tags: ToolTag[]; swing: number; power: number; reach?: number };
  fuel?: { kind: FuelKind; power: number; burn: number; ignite: number; moisture?: number };
  chop?: ChopSpec;
  wear?: { slot: Slot; clo: number; wind: number; dex?: number; wetSens?: number; pack?: number; material?: string };
  /** readable: book, newspaper, note */
  read?: 'book' | 'paper' | 'note';
  food?: { kcal: number; water?: number; open?: boolean; raw?: boolean };
  insul?: number; // blankets: clo when wrapped, on a bed or over a window
  cook?: { to: string; time: number }; // cooking result and game seconds
  charges?: number; // matches count, nails, battery %, kerosene %
  capacity?: number; // pot/bucket litres
  bedding?: number; // clo when slept on (boughs, mattress)
  tearInto?: Yield[];
  color?: string;
}

const D: ItemDef[] = [
  // ---- tools ----
  { id: 'axe', name: 'Топор', mass: 1.6, pocket: true, shape: { t: 'box', x: 0.05, y: 0.36, z: 0.09 },
    tool: { tags: ['axe'], swing: 0.8, power: 1 }, desc: 'Рубит деревья, мебель, перила, лёд. Колет брёвна на поленья.' },
  { id: 'hatchet', name: 'Топорик', mass: 0.8, pocket: true, shape: { t: 'box', x: 0.04, y: 0.2, z: 0.07 },
    tool: { tags: ['axe'], swing: 0.55, power: 0.5 }, desc: 'Лёгкий, быстрый, но слабее топора.' },
  { id: 'saw', name: 'Ножовка', mass: 0.7, pocket: true, shape: { t: 'box', x: 0.02, y: 0.06, z: 0.33 },
    tool: { tags: ['saw'], swing: 0.45, power: 0.75 }, desc: 'Пилит аккуратно: из мебели получаются доски, а не щепки.' },
  { id: 'knife', name: 'Нож', mass: 0.2, pocket: true, shape: { t: 'box', x: 0.015, y: 0.01, z: 0.13 },
    tool: { tags: ['knife'], swing: 0.4, power: 0.15 }, desc: 'Режет ткань, снимает бересту, строгает стружку, открывает банки.' },
  { id: 'hammer', name: 'Молоток', mass: 0.6, pocket: true, shape: { t: 'box', x: 0.05, y: 0.16, z: 0.02 },
    tool: { tags: ['hammer', 'blunt'], swing: 0.5, power: 0.25 }, desc: 'Заколачивает окна досками (нужны гвозди). Бьёт стекло.' },
  { id: 'prybar', name: 'Монтировка', mass: 1.5, pocket: true, shape: { t: 'box', x: 0.02, y: 0.3, z: 0.04 },
    tool: { tags: ['prybar', 'blunt'], swing: 0.7, power: 0.4 }, desc: 'Отрывает доски, ломает мебель на щепки.' },
  { id: 'shovel', name: 'Лопата', mass: 1.8, pocket: true, shape: { t: 'box', x: 0.12, y: 0.55, z: 0.03 },
    tool: { tags: ['shovel'], swing: 0.8, power: 0.15 }, desc: 'Нарезает снежные блоки (защита от ветра), тушит огонь снегом.' },
  { id: 'auger', name: 'Ледобур', mass: 3, pocket: true, shape: { t: 'box', x: 0.2, y: 0.55, z: 0.06 },
    tool: { tags: ['auger'], swing: 0.6, power: 0.2 }, desc: 'Сверлит лунку во льду.' },
  { id: 'rod', name: 'Удочка', mass: 0.4, pocket: true, shape: { t: 'box', x: 0.02, y: 0.5, z: 0.02 },
    tool: { tags: ['rod'], swing: 0.5, power: 0 }, desc: 'Рыбалка в лунке.' },
  { id: 'matches', name: 'Спички', mass: 0.05, pocket: true, shape: { t: 'box', x: 0.025, y: 0.008, z: 0.018 },
    tool: { tags: ['matches'], swing: 0.4, power: 0 }, charges: 12, desc: 'Чиркнуть — ЛКМ. Горит несколько секунд. Сырые не зажигаются.' },
  { id: 'lighter', name: 'Зажигалка', mass: 0.03, pocket: true, shape: { t: 'box', x: 0.012, y: 0.035, z: 0.006 },
    tool: { tags: ['lighter'], swing: 0.4, power: 0 }, charges: 25, desc: 'Газ плохо работает на сильном морозе.' },
  { id: 'flashlight', name: 'Фонарик', mass: 0.3, pocket: true, shape: { t: 'cyl', r: 0.02, h: 0.09 },
    tool: { tags: ['flashlight'], swing: 0.3, power: 0 }, charges: 100, desc: 'ЛКМ — вкл/выкл. На морозе батарейка садится быстрее.' },
  { id: 'lamp', name: 'Керосиновая лампа', mass: 1.2, pocket: true, shape: { t: 'cyl', r: 0.08, h: 0.15 },
    tool: { tags: ['lamp'], swing: 0.3, power: 0 }, charges: 60, desc: 'Зажигается спичкой. Светит и немного греет руки. Можно поставить.' },
  { id: 'pot', name: 'Котелок', mass: 0.8, pocket: true, shape: { t: 'cyl', r: 0.11, h: 0.08 },
    tool: { tags: ['pot'], swing: 0.4, power: 0 }, capacity: 1.5, desc: 'Набрать снег или воду, поставить на печь или у костра.' },
  { id: 'bucket', name: 'Ведро', mass: 1.2, pocket: true, shape: { t: 'cyl', r: 0.14, h: 0.15 },
    tool: { tags: ['pot'], swing: 0.5, power: 0 }, capacity: 5, desc: 'Как котелок, только больше.' },
  { id: 'nails', name: 'Гвозди', mass: 0.4, pocket: true, shape: { t: 'box', x: 0.05, y: 0.03, z: 0.04 }, charges: 16,
    desc: 'Для молотка: заколотить окно досками.' },
  { id: 'kerosene', name: 'Керосин', mass: 0.9, pocket: true, shape: { t: 'cyl', r: 0.045, h: 0.12 }, charges: 100,
    desc: 'Топливо для лампы.' },

  // ---- wood & fuel ----
  { id: 'log', name: 'Бревно', mass: 22, pocket: false, shape: { t: 'cylx', r: 0.14, h: 0.6 },
    fuel: { kind: 'log', power: 5, burn: 3 * 3600, ignite: 0.015 },
    desc: 'Перерубите топором или распилите в любом месте — получите два куска ровно той длины. Короткие чурбаки колются на поленья.' },
  { id: 'trunk', name: 'Ствол', mass: 300, pocket: false, shape: { t: 'cylx', r: 0.2, h: 4 },
    desc: 'Поваленное дерево. Обрубите сучья, затем перерубите или распилите ствол на брёвна нужной длины.' },
  { id: 'pole', name: 'Жердь', mass: 6, pocket: false, shape: { t: 'cylx', r: 0.04, h: 1.2 },
    fuel: { kind: 'wood', power: 3, burn: 70 * 60, ignite: 0.05 },
    desc: 'Тонкий длинный ствол. Годится для навеса и изгороди, рубится в любом месте.' },
  { id: 'chock', name: 'Чурбак', mass: 15, pocket: false, shape: { t: 'cylx', r: 0.13, h: 0.25 },
    fuel: { kind: 'log', power: 4.5, burn: 2 * 3600, ignite: 0.02 },
    desc: 'Короткий кусок бревна. Колется топором на поленья: каждый удар делит его пополам.' },
  { id: 'beam', name: 'Брус', mass: 20, pocket: false, shape: { t: 'box', x: 0.6, y: 0.05, z: 0.05 },
    fuel: { kind: 'log', power: 4.5, burn: 2.5 * 3600, ignite: 0.02 } },
  { id: 'firewood', name: 'Полено', mass: 2.2, pocket: true, shape: { t: 'box', x: 0.06, y: 0.05, z: 0.2 },
    fuel: { kind: 'wood', power: 3.5, burn: 50 * 60, ignite: 0.06 },
    chop: { hp: 2, knife: [{ id: 'shavings', n: 2 }, { id: 'kindling', n: 1 }], knifeLabel: 'Настрогать стружку' },
    desc: 'Топором колется пополам, тонкое — на щепу. Ножом можно настрогать стружку.' },
  { id: 'plank', name: 'Доска', mass: 2.5, pocket: true, shape: { t: 'box', x: 0.6, y: 0.012, z: 0.07 },
    fuel: { kind: 'wood', power: 3, burn: 35 * 60, ignite: 0.08 },
    chop: { hp: 2, blunt: [{ id: 'kindling', n: 3 }] },
    desc: 'Можно заколотить окно (молоток + гвозди). Пилится и рубится поперёк в любом месте.' },
  { id: 'kindling', name: 'Щепа', mass: 0.3, pocket: true, shape: { t: 'box', x: 0.02, y: 0.015, z: 0.12 },
    fuel: { kind: 'kindling', power: 2, burn: 5 * 60, ignite: 0.35 }, desc: 'Растопка: загорается от трута.' },
  { id: 'sticks', name: 'Хворост', mass: 0.4, pocket: true, shape: { t: 'box', x: 0.03, y: 0.03, z: 0.25 },
    fuel: { kind: 'kindling', power: 1.8, burn: 4 * 60, ignite: 0.3, moisture: 0.25 },
    chop: { hp: 1, knife: [{ id: 'shavings', n: 1 }], knifeLabel: 'Настрогать стружку' },
    desc: 'Тонкие ветки. В инвентаре лежат одной охапкой: важен только вес.' },
  { id: 'boughs', name: 'Лапник', mass: 1.2, pocket: true, shape: { t: 'box', x: 0.25, y: 0.05, z: 0.35 },
    fuel: { kind: 'boughs', power: 1.5, burn: 3 * 60, ignite: 0.12, moisture: 0.4 }, bedding: 0.6,
    desc: 'Подстилка: спать на лапнике гораздо теплее, чем на снегу.' },
  { id: 'bark', name: 'Береста', mass: 0.05, pocket: true, shape: { t: 'box', x: 0.05, y: 0.01, z: 0.04 },
    fuel: { kind: 'tinder', power: 1.5, burn: 90, ignite: 1 }, desc: 'Отличный трут, горит даже сырой.' },
  { id: 'paper', name: 'Бумага', mass: 0.02, pocket: true, shape: { t: 'box', x: 0.1, y: 0.002, z: 0.14 },
    fuel: { kind: 'paper', power: 1, burn: 40, ignite: 1 }, desc: 'Трут.' },
  { id: 'shavings', name: 'Стружка', mass: 0.05, pocket: true, shape: { t: 'box', x: 0.04, y: 0.02, z: 0.04 },
    fuel: { kind: 'tinder', power: 1.2, burn: 60, ignite: 0.9 }, desc: 'Трут.' },
  { id: 'cloth', name: 'Ткань', mass: 0.15, pocket: true, shape: { t: 'box', x: 0.08, y: 0.015, z: 0.08 },
    fuel: { kind: 'cloth', power: 1.2, burn: 90, ignite: 0.6 }, desc: 'Трут.' },
  { id: 'book', name: 'Книга', mass: 0.6, pocket: true, shape: { t: 'box', x: 0.08, y: 0.025, z: 0.11 },
    fuel: { kind: 'paper', power: 1.5, burn: 600, ignite: 0.25 }, tearInto: [{ id: 'paper', n: 4 }], read: 'book',
    desc: 'Почитать у огня — поднимает настроение. Или пустить на растопку.' },
  { id: 'newspaper', name: 'Газета', mass: 0.1, pocket: true, shape: { t: 'box', x: 0.15, y: 0.006, z: 0.2 },
    fuel: { kind: 'paper', power: 1.2, burn: 60, ignite: 0.95 }, tearInto: [{ id: 'paper', n: 2 }], read: 'paper' },
  { id: 'note', name: 'Записка', mass: 0.01, pocket: true, shape: { t: 'box', x: 0.07, y: 0.002, z: 0.1 },
    fuel: { kind: 'paper', power: 1, burn: 30, ignite: 1 }, read: 'note' },
  { id: 'shard', name: 'Осколок стекла', mass: 0.1, pocket: true, shape: { t: 'box', x: 0.05, y: 0.004, z: 0.07 },
    tool: { tags: ['knife'], swing: 0.5, power: 0.07 }, desc: 'Можно резать, как ножом. Можно и порезаться.' },
  { id: 'snowblock', name: 'Снежный блок', mass: 12, pocket: false, shape: { t: 'box', x: 0.3, y: 0.18, z: 0.15 },
    desc: 'Защищает костёр от ветра.' },

  // ---- furniture ----
  { id: 'chair', name: 'Стул', mass: 6, pocket: false, shape: { t: 'box', x: 0.22, y: 0.45, z: 0.22 },
    fuel: { kind: 'wood', power: 3.5, burn: 40 * 60, ignite: 0.03 },
    chop: { hp: 4, axe: [{ id: 'firewood', n: 3 }], saw: [{ id: 'plank', n: 1 }, { id: 'firewood', n: 1 }], blunt: [{ id: 'firewood', n: 2 }, { id: 'kindling', n: 1 }] } },
  { id: 'stool', name: 'Табурет', mass: 3, pocket: false, shape: { t: 'box', x: 0.17, y: 0.23, z: 0.17 },
    chop: { hp: 2, axe: [{ id: 'firewood', n: 2 }], saw: [{ id: 'firewood', n: 2 }], blunt: [{ id: 'kindling', n: 3 }] } },
  { id: 'table', name: 'Стол', mass: 25, pocket: false, shape: { t: 'box', x: 0.7, y: 0.38, z: 0.42 },
    chop: { hp: 8, axe: [{ id: 'firewood', n: 5 }], saw: [{ id: 'plank', n: 3 }, { id: 'firewood', n: 2 }], blunt: [{ id: 'firewood', n: 3 }, { id: 'kindling', n: 2 }] } },
  { id: 'bed', name: 'Кровать', mass: 45, pocket: false, shape: { t: 'box', x: 1.0, y: 0.25, z: 0.48 },
    chop: { hp: 10, axe: [{ id: 'firewood', n: 6 }, { id: 'cloth', n: 3 }], saw: [{ id: 'plank', n: 4 }, { id: 'firewood', n: 2 }, { id: 'cloth', n: 3 }] },
    bedding: 0.9, desc: 'Матрас даёт тепло снизу. Одеяла сверху — ещё больше.' },
  { id: 'wardrobe', name: 'Шкаф', mass: 55, pocket: false, shape: { t: 'box', x: 0.5, y: 0.95, z: 0.28 },
    chop: { hp: 10, axe: [{ id: 'firewood', n: 6 }], saw: [{ id: 'plank', n: 5 }, { id: 'firewood', n: 1 }], blunt: [{ id: 'firewood', n: 4 }, { id: 'kindling', n: 3 }] } },
  { id: 'cabinet', name: 'Кухонная тумба', mass: 28, pocket: false, shape: { t: 'box', x: 0.6, y: 0.45, z: 0.3 },
    chop: { hp: 7, axe: [{ id: 'firewood', n: 4 }], saw: [{ id: 'plank', n: 3 }, { id: 'firewood', n: 1 }], blunt: [{ id: 'firewood', n: 3 }, { id: 'kindling', n: 2 }] } },
  { id: 'crate', name: 'Ящик', mass: 5, pocket: false, shape: { t: 'box', x: 0.3, y: 0.2, z: 0.22 },
    chop: { hp: 2, axe: [{ id: 'firewood', n: 2 }], saw: [{ id: 'plank', n: 2 }], blunt: [{ id: 'kindling', n: 4 }] } },
  { id: 'chest', name: 'Сундук', mass: 18, pocket: false, shape: { t: 'box', x: 0.45, y: 0.25, z: 0.28 },
    chop: { hp: 5, axe: [{ id: 'firewood', n: 3 }, { id: 'kindling', n: 2 }], saw: [{ id: 'plank', n: 3 }] } },
  { id: 'bench', name: 'Скамья', mass: 12, pocket: false, shape: { t: 'box', x: 0.7, y: 0.22, z: 0.16 },
    chop: { hp: 4, axe: [{ id: 'firewood', n: 3 }], saw: [{ id: 'plank', n: 2 }, { id: 'firewood', n: 1 }], blunt: [{ id: 'firewood', n: 2 }] } },
  { id: 'workbench', name: 'Верстак', mass: 70, pocket: false, shape: { t: 'box', x: 0.9, y: 0.43, z: 0.35 },
    chop: { hp: 14, axe: [{ id: 'firewood', n: 7 }], saw: [{ id: 'plank', n: 6 }, { id: 'firewood', n: 2 }] } },
  { id: 'block', name: 'Колода', mass: 30, pocket: false, shape: { t: 'cyl', r: 0.25, h: 0.25 },
    chop: { hp: 8, axe: [{ id: 'firewood', n: 4 }], saw: [{ id: 'firewood', n: 4 }] }, desc: 'Чурбак для колки дров.' },
  { id: 'shelf', name: 'Полка', mass: 8, pocket: false, shape: { t: 'box', x: 0.5, y: 0.45, z: 0.15 },
    chop: { hp: 3, axe: [{ id: 'firewood', n: 2 }], saw: [{ id: 'plank', n: 2 }], blunt: [{ id: 'kindling', n: 3 }] } },

  // ---- fabric ----
  { id: 'blanket', name: 'Шерстяное одеяло', mass: 2, pocket: false, shape: { t: 'box', x: 0.3, y: 0.07, z: 0.24 },
    insul: 1.2, fuel: { kind: 'cloth', power: 2, burn: 600, ignite: 0.15 },
    chop: { hp: 3, knife: [{ id: 'cloth', n: 4 }], knifeLabel: 'Разрезать на ткань' },
    desc: 'Укутаться, постелить на кровать, завесить окно или дверной проём.' },
  { id: 'plaid', name: 'Плед', mass: 1.2, pocket: false, shape: { t: 'box', x: 0.26, y: 0.05, z: 0.2 },
    insul: 0.8, fuel: { kind: 'cloth', power: 2, burn: 400, ignite: 0.2 },
    chop: { hp: 2, knife: [{ id: 'cloth', n: 3 }], knifeLabel: 'Разрезать на ткань' } },

  // ---- clothing ----
  { id: 'beanie', name: 'Вязаная шапка', mass: 0.1, pocket: true, shape: { t: 'box', x: 0.09, y: 0.05, z: 0.09 },
    wear: { slot: 'head', clo: 0.2, wind: 0.3 }, chop: { hp: 1, knife: [{ id: 'cloth', n: 1 }], knifeLabel: 'Разрезать на ткань' } },
  { id: 'ushanka', name: 'Ушанка', mass: 0.3, pocket: true, shape: { t: 'box', x: 0.11, y: 0.07, z: 0.11 },
    wear: { slot: 'head', clo: 0.45, wind: 0.75 } },
  { id: 'scarf', name: 'Шарф', mass: 0.15, pocket: true, shape: { t: 'box', x: 0.14, y: 0.02, z: 0.06 },
    wear: { slot: 'neck', clo: 0.2, wind: 0.4 }, chop: { hp: 1, knife: [{ id: 'cloth', n: 1 }], knifeLabel: 'Разрезать на ткань' } },
  { id: 'thermals', name: 'Термобельё', mass: 0.4, pocket: true, shape: { t: 'box', x: 0.15, y: 0.03, z: 0.12 },
    wear: { slot: 'base', clo: 0.45, wind: 0.1 } },
  { id: 'sweater', name: 'Свитер', mass: 0.6, pocket: true, shape: { t: 'box', x: 0.17, y: 0.04, z: 0.14 },
    wear: { slot: 'mid', clo: 0.6, wind: 0.15, wetSens: 0.5 }, chop: { hp: 2, knife: [{ id: 'cloth', n: 2 }], knifeLabel: 'Разрезать на ткань' } },
  { id: 'jacket_light', name: 'Лёгкая куртка', mass: 0.8, pocket: true, shape: { t: 'box', x: 0.2, y: 0.05, z: 0.16 },
    wear: { slot: 'outer', clo: 0.55, wind: 0.65 } },
  { id: 'parka', name: 'Пуховик', mass: 1.4, pocket: true, shape: { t: 'box', x: 0.24, y: 0.08, z: 0.2 },
    wear: { slot: 'outer', clo: 1.6, wind: 0.85, wetSens: 0.9 } },
  { id: 'jeans', name: 'Джинсы', mass: 0.7, pocket: true, shape: { t: 'box', x: 0.17, y: 0.03, z: 0.14 },
    wear: { slot: 'legs', clo: 0.25, wind: 0.3, wetSens: 1 } },
  { id: 'padded_pants', name: 'Ватные штаны', mass: 1.1, pocket: true, shape: { t: 'box', x: 0.18, y: 0.05, z: 0.15 },
    wear: { slot: 'legs', clo: 0.75, wind: 0.6, wetSens: 0.8 } },
  { id: 'wool_socks', name: 'Шерстяные носки', mass: 0.1, pocket: true, shape: { t: 'box', x: 0.06, y: 0.02, z: 0.08 },
    wear: { slot: 'socks', clo: 0.2, wind: 0, wetSens: 0.3 } },
  { id: 'sneakers', name: 'Кроссовки', mass: 0.7, pocket: true, shape: { t: 'box', x: 0.08, y: 0.05, z: 0.14 },
    wear: { slot: 'feet', clo: 0.15, wind: 0.2, wetSens: 1 } },
  { id: 'valenki', name: 'Валенки', mass: 1.4, pocket: true, shape: { t: 'box', x: 0.09, y: 0.18, z: 0.14 },
    wear: { slot: 'feet', clo: 0.8, wind: 0.5, wetSens: 1 } },
  { id: 'boots', name: 'Зимние ботинки', mass: 1.3, pocket: true, shape: { t: 'box', x: 0.09, y: 0.08, z: 0.15 },
    wear: { slot: 'feet', clo: 0.55, wind: 0.8, wetSens: 0.4 } },
  { id: 'mittens', name: 'Варежки', mass: 0.15, pocket: true, shape: { t: 'box', x: 0.06, y: 0.02, z: 0.1 },
    wear: { slot: 'hands', clo: 0.9, wind: 0.6, dex: 0.35 }, desc: 'Тёплые, но спичку в них не зажечь.' },
  { id: 'gloves', name: 'Рабочие перчатки', mass: 0.12, pocket: true, shape: { t: 'box', x: 0.05, y: 0.015, z: 0.09 },
    wear: { slot: 'hands', clo: 0.35, wind: 0.4, dex: 0.8 } },

  { id: 'telogreika', name: 'Ватник', mass: 1.6, pocket: true, shape: { t: 'box', x: 0.22, y: 0.07, z: 0.18 },
    wear: { slot: 'outer', clo: 1.05, wind: 0.55, wetSens: 0.85, material: 'хлопок, вата' }, desc: 'Тёплый и крепкий, но мокрым почти не греет и сохнет долго.' },
  { id: 'tulup', name: 'Овчинный тулуп', mass: 4.2, pocket: true, shape: { t: 'box', x: 0.26, y: 0.1, z: 0.22 },
    wear: { slot: 'outer', clo: 2.1, wind: 0.92, wetSens: 0.5, material: 'овчина' }, desc: 'Самое тёплое, что можно найти. Тяжёлый.' },
  { id: 'fleece', name: 'Флисовая кофта', mass: 0.4, pocket: true, shape: { t: 'box', x: 0.16, y: 0.04, z: 0.13 },
    wear: { slot: 'mid', clo: 0.5, wind: 0.1, wetSens: 0.2, material: 'синтетика' }, desc: 'Греет и мокрой, быстро сохнет.' },
  { id: 'wool_pants', name: 'Шерстяные брюки', mass: 0.8, pocket: true, shape: { t: 'box', x: 0.17, y: 0.04, z: 0.14 },
    wear: { slot: 'legs', clo: 0.55, wind: 0.35, wetSens: 0.4, material: 'шерсть' }, desc: 'Шерсть греет даже влажной.' },
  { id: 'balaclava', name: 'Балаклава', mass: 0.1, pocket: true, shape: { t: 'box', x: 0.08, y: 0.03, z: 0.08 },
    wear: { slot: 'head', clo: 0.3, wind: 0.55, wetSens: 0.4, material: 'шерсть' } },
  { id: 'fur_mitts', name: 'Меховые рукавицы', mass: 0.35, pocket: true, shape: { t: 'box', x: 0.07, y: 0.03, z: 0.12 },
    wear: { slot: 'hands', clo: 1.3, wind: 0.85, dex: 0.2, wetSens: 0.5, material: 'мех' }, desc: 'Очень тёплые. Чтобы чиркнуть спичкой, придётся снять.' },
  { id: 'unty', name: 'Унты', mass: 1.8, pocket: true, shape: { t: 'box', x: 0.09, y: 0.2, z: 0.15 },
    wear: { slot: 'feet', clo: 1.1, wind: 0.85, wetSens: 0.5, material: 'мех, кожа' }, desc: 'Меховые сапоги. Лучшая обувь для мороза.' },
  { id: 'backpack', name: 'Рюкзак', mass: 0.9, pocket: true, shape: { t: 'box', x: 0.17, y: 0.25, z: 0.1 },
    wear: { slot: 'back', clo: 0.05, wind: 0.05, pack: 20, material: 'брезент' }, desc: '+20 кг к тому, что можно унести.' },
  { id: 'backpack_big', name: 'Экспедиционный рюкзак', mass: 2.2, pocket: true, shape: { t: 'box', x: 0.2, y: 0.33, z: 0.13 },
    wear: { slot: 'back', clo: 0.1, wind: 0.1, pack: 34, material: 'нейлон' }, desc: '+34 кг к тому, что можно унести.' },
  { id: 'battery', name: 'Аккумулятор 12 В', mass: 13, pocket: true, shape: { t: 'box', x: 0.13, y: 0.1, z: 0.09 },
    charges: 70, desc: 'Тяжёлый. Хватит, чтобы запитать рацию.' },

  // ---- food ----
  { id: 'stew', name: 'Тушёнка', mass: 0.4, pocket: true, shape: { t: 'cyl', r: 0.045, h: 0.05 },
    food: { kcal: 620, water: 0.05, open: true }, desc: 'Нужен нож или топор, чтобы открыть.' },
  { id: 'beans', name: 'Фасоль (банка)', mass: 0.4, pocket: true, shape: { t: 'cyl', r: 0.04, h: 0.055 },
    food: { kcal: 420, water: 0.1, open: true }, desc: 'Нужен нож или топор, чтобы открыть.' },
  { id: 'crackers', name: 'Сухари', mass: 0.2, pocket: true, shape: { t: 'box', x: 0.07, y: 0.03, z: 0.1 },
    food: { kcal: 380, water: -0.05 } },
  { id: 'chocolate', name: 'Шоколад', mass: 0.1, pocket: true, shape: { t: 'box', x: 0.06, y: 0.006, z: 0.12 },
    food: { kcal: 260 } },
  { id: 'tea', name: 'Чайный пакетик', mass: 0.01, pocket: true, shape: { t: 'box', x: 0.02, y: 0.005, z: 0.025 },
    desc: 'Заварить в котелке с кипятком: горячий чай греет изнутри.' },
  { id: 'fish_raw', name: 'Сырая рыба', mass: 0.6, pocket: true, shape: { t: 'box', x: 0.04, y: 0.03, z: 0.15 },
    food: { kcal: 220, water: 0.05, raw: true }, cook: { to: 'fish_cooked', time: 20 * 60 },
    desc: 'Лучше пожарить на печи или у костра.' },
  { id: 'fish_cooked', name: 'Жареная рыба', mass: 0.5, pocket: true, shape: { t: 'box', x: 0.04, y: 0.03, z: 0.15 },
    food: { kcal: 380, water: 0.02 }, cook: { to: 'fish_burnt', time: 30 * 60 } },
  { id: 'fish_burnt', name: 'Горелая рыба', mass: 0.4, pocket: true, shape: { t: 'box', x: 0.04, y: 0.03, z: 0.14 },
    food: { kcal: 120 } },
];

export const ITEMS: Record<string, ItemDef> = {};
for (const d of D) ITEMS[d.id] = d;

export function def(id: string): ItemDef {
  const d = ITEMS[id];
  if (!d) throw new Error('Unknown item ' + id);
  return d;
}

export const FUEL_KIND_NAMES: Record<FuelKind, string> = {
  tinder: 'трут', kindling: 'растопка', wood: 'дрова', log: 'бревно', cloth: 'ткань', paper: 'бумага', boughs: 'лапник',
};
