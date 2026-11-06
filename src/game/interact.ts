// What the player looks at, which actions are possible and what happens:
// chopping, picking up, hanging blankets, lighting fires, fishing and more.
import * as THREE from 'three';
import { G, GROUPS_RAY, msg } from './ctx';
import { Entity } from './entities';
import { def, ItemDef, ToolTag, Yield } from './items';
import type { Tree } from '../world/forest';
import type { WindowData } from '../world/house';
import type { Fire } from './fire';
import { MAX_DRAG, MAX_LIFT } from './player';
import { clamp } from '../core/rng';
import { dryingAt } from './drying';
import { chopLabelFor, describeWood, hitPiece, spawnPiece, woodOf } from './wood/wood';
import { pieceSize } from './wood/piece';
import { TREE_NAMES } from '../world/forest';

export type Key = 'E' | 'F' | 'G' | 'LMB' | 'RMB';

export interface Action {
  key: Key;
  label: string;
  time?: number; // seconds to perform (hold still)
  run: () => void;
}

export interface Target {
  kind: 'entity' | 'tree' | 'ground' | 'ice' | 'static' | 'none';
  entity?: Entity;
  tree?: Tree;
  /** the collider that was hit (a branch whorl of a trunk, a part of a structure) */
  collider?: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  dist: number;
}

const REACH = 2.6;
const FUEL_ORDER = ['tinder', 'paper', 'cloth', 'kindling', 'boughs', 'wood', 'log'];

function tags(e: Entity | null): ToolTag[] {
  return e?.def?.tool?.tags ?? [];
}

export class Interaction {
  target: Target = { kind: 'none', point: new THREE.Vector3(), normal: new THREE.Vector3(), dist: 0 };
  actions: Action[] = [];
  info = '';
  timed: { action: Action; t: number; start: THREE.Vector3 } | null = null;
  swinging: { t: number; dur: number; hit: boolean; tool: Entity } | null = null;
  flame: { t: number; kind: 'match' | 'lighter'; light: THREE.PointLight | null } | null = null;
  fishing: { hole: Entity; wait: number; bite: number } | null = null;
  private iceWork: { pos: THREE.Vector3; hp: number } | null = null;
  private ray = new THREE.Vector3();

  private hasSnow(point: THREE.Vector3) {
    const s = G.snow;
    return !s || s.isExperiment || (s.contains(point.x, point.z) && s.field.sample(point.x, point.z).height > 0.004);
  }

  // ---------- targeting ----------

  private computeTarget() {
    const cam = G.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(this.ray);
    const R = G.R;
    const hit = G.world.castRayAndGetNormal(new R.Ray(origin, dir), REACH, true, undefined, GROUPS_RAY, G.player.collider, G.player.carried?.body ?? undefined);
    const t = this.target;
    const snow = G.snow?.raycast(origin, dir, REACH);
    // a log, stump or wall log just under loose snow is felt through it: no need to dig first
    const big = hit ? G.entities.byCollider.get(hit.collider.handle) : undefined;
    const under = !!big && !!woodOf(big) && (big.kind === 'stump' || big.kind === 'part' || ['log', 'trunk', 'chock', 'pole', 'beam'].includes(big.defId));
    if (snow && hit && under && hit.timeOfImpact - snow.distance < 0.4) {
      // fall through to the physics hit
    } else if (snow && (!hit || snow.distance < hit.timeOfImpact)) {
      t.kind = 'ground'; t.entity = undefined; t.tree = undefined;
      t.point.copy(snow.point); t.normal.set(0, 1, 0); t.dist = snow.distance;
      return;
    }
    if (!hit) {
      t.kind = 'none';
      t.entity = undefined;
      t.tree = undefined;
      return;
    }
    t.point.copy(origin).addScaledVector(dir, hit.timeOfImpact);
    t.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    t.dist = hit.timeOfImpact;
    const h = hit.collider.handle;
    t.collider = h;
    const e = G.entities.byCollider.get(h);
    const tree = G.forest.isTreeTarget(h);
    t.entity = undefined;
    t.tree = undefined;
    if (e && !e.removed) {
      t.kind = 'entity';
      t.entity = e;
    } else if (tree) {
      t.kind = 'tree';
      t.tree = tree;
    } else if (G.terrain.handles.has(h)) t.kind = 'ground';
    else if (G.lake.handles.has(h)) t.kind = 'ice';
    else t.kind = 'static';
  }

  // ---------- helpers ----------

  private bestFuel(f: Fire, skipKind?: string): Entity | null {
    const inv = G.player.inventory.filter((e) => e.def?.fuel && !G.player.isWorn(e) && e !== G.player.equipped);
    if (!inv.length) return null;
    const has = (k: string[]) => f.fuel.some((x) => k.includes(x.kind));
    let order: string[];
    if (!f.burning && f.embers < 0.15) {
      if (!has(['tinder', 'paper', 'cloth'])) order = ['tinder', 'paper', 'cloth', 'kindling', 'wood'];
      else if (!has(['kindling'])) order = ['kindling', 'boughs', 'wood', 'tinder', 'paper'];
      else order = ['wood', 'kindling', 'log', 'tinder', 'paper'];
    } else if (f.power < 3) order = ['kindling', 'wood', 'boughs', 'paper', 'tinder'];
    else order = ['wood', 'log', 'kindling', 'boughs'];
    for (const k of order) {
      if (k === skipKind) continue;
      const c = inv.filter((e) => e.def!.fuel!.kind === k).sort((a, b) => a.moisture - b.moisture);
      if (c.length) return c[0];
    }
    return null;
  }

  private canOpenCans() {
    return !!G.player.inventory.find((e) => {
      const t = tags(e);
      return t.includes('knife') || t.includes('axe');
    });
  }

  private yieldsFor(e: Entity, tool: Entity): Yield[] | null {
    const t = tags(tool);
    const spec = e.def?.chop;
    if (!spec) return null;
    if (t.includes('saw')) return spec.saw ?? null;
    if (t.includes('axe')) return spec.axe ?? null;
    if (t.includes('blunt')) return spec.blunt ?? null;
    if (t.includes('knife')) return spec.knife ?? null;
    return null;
  }

  private spawnYields(list: { id: string; n: number; params?: Record<string, number> }[], at: THREE.Vector3, moisture: number, spread = 0.4, axis?: THREE.Vector3) {
    let k = 0;
    const total = list.reduce((s, y) => s + y.n, 0);
    for (const y of list) {
      for (let i = 0; i < y.n; i++) {
        const p = at.clone();
        if (axis) p.addScaledVector(axis, (k / Math.max(1, total - 1) - 0.5) * spread * 2);
        else p.add(new THREE.Vector3((Math.random() - 0.5) * spread, 0.15 + Math.random() * 0.2, (Math.random() - 0.5) * spread));
        p.y += 0.1 + (axis ? 0.2 : 0);
        const d = def(y.id);
        const m = d.fuel ? (moisture >= 0 ? moisture : d.fuel.moisture ?? 0.05) : undefined;
        G.entities.spawnItem(y.id, p, {
          moisture: m,
          params: y.params,
          quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * 6, 0)),
          vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 1 + Math.random(), (Math.random() - 0.5) * 1.2),
        });
        k++;
      }
    }
  }

  private giveOrDrop(id: string, n = 1, opts: { moisture?: number; charges?: number } = {}) {
    for (let i = 0; i < n; i++) {
      const p = G.player.eyePos.add(G.player.forward().multiplyScalar(0.6));
      const e = G.entities.spawnItem(id, p, opts);
      if (e.pocket && G.player.addToInventory(e)) continue;
    }
  }

  stopFlame() {
    if (this.flame) {
      G.fx.releaseLight(this.flame.light);
      this.flame = null;
    }
  }

  private flameQuality(kind: 'match' | 'lighter') {
    return (kind === 'lighter' ? 0.95 : 0.88) * (0.45 + 0.55 * G.body.dex);
  }

  // ---------- action list ----------

  private compute(): Action[] {
    const A: Action[] = [];
    const P = G.player;
    const t = this.target;
    const e = t.kind === 'entity' ? t.entity! : null;
    const eq = P.equipped;
    const tg = tags(eq);
    const carried = P.carried;
    this.info = '';
    const fire = G.fires.fireOf(e);

    if (e) this.info = this.describe(e);
    if (t.kind === 'tree') this.info = this.describeTree(t.tree!);
    if (t.kind === 'ground') this.info = G.house.zoneAt(t.point) ? '' : this.hasSnow(t.point) ? 'Снег' : 'Земля';
    if (t.kind === 'ground' && G.snow && !G.snow.isExperiment && !this.hasSnow(t.point) && G.snow.packedBase(t.point.x, t.point.z)) this.info = 'Плотный снег';
    if (t.kind === 'ice') {
      const th = G.region.iceAt(t.point.x, t.point.z);
      this.info = G.body.skills.has('ice') ? `Лёд · ~${Math.round(th * 100)} см${th < 0.12 ? ' · ТОНКИЙ, не выдержит!' : ''}` : th < 0.12 ? 'Лёд · тёмный, прозрачный' : 'Лёд';
    }
    if (t.kind === 'ground' && G.snow?.isExperiment && G.snow.contains(t.point.x, t.point.z) && t.point.y > G.snow.baseY - 0.02) {
      this.info = 'Снег · ЛКМ — раскопать · ПКМ — высыпать';
      return A;
    }

    // --- carrying a physical object ---
    if (carried) {
      const cd = carried.def;
      if (fire && cd?.fuel) A.push({ key: 'E', label: `Бросить в огонь: ${carried.name}`, run: () => this.feed(fire, carried) });
      if (fire && (carried.contents || cd?.cook)) A.push({ key: 'G', label: 'Поставить на огонь', run: () => this.putOnFire(fire, carried) });
      const isBlanket = carried.defId === 'blanket' || carried.defId === 'plaid';
      if (isBlanket && e?.kind === 'window' && !(e.data as WindowData).cover) A.push({ key: 'E', label: 'Завесить окно', time: 1.2, run: () => this.hangOnWindow(e, carried) });
      if (isBlanket && e?.kind === 'doorway' && !e.data.cover) A.push({ key: 'E', label: 'Завесить проём', time: 1.2, run: () => this.hangDoorway(carried) });
      if (isBlanket && e?.defId === 'bed') A.push({ key: 'E', label: 'Постелить на кровать', time: 1, run: () => this.spreadBed(e, carried) });
      if (isBlanket) A.push({ key: 'F', label: 'Укутаться', time: 1, run: () => this.wrap(carried) });
      else if (carried.pocket) A.push({ key: 'F', label: 'Убрать в рюкзак', run: () => P.addToInventory(carried) && (P.carried = null) });
      // building: put the piece where the ghost shows
      const pl = G.build.placement.plan;
      if (woodOf(carried) && pl && !P.dragging) {
        const nails = !!P.has((x) => x.defId === 'nails' && x.charges >= 2) && !!P.hasTag('hammer');
        if (pl.ok) A.push({ key: 'G', label: nails ? 'Прибить здесь' : 'Положить здесь', run: () => G.build.placement.place({ nails }) });
        if (pl.ok && pl.upright && pl.footOnGround && P.hasTag('shovel') && !carried.pocket) A.push({ key: 'F', label: 'Вкопать столб', time: 5, run: () => G.build.placement.place({ dig: true }) });
        if (pl.ok && !pl.holds && pl.holdsGrooved && P.hasTag('axe') && !carried.pocket) A.push({ key: 'F', label: 'Уложить в паз', time: 4, run: () => G.build.placement.place({ groove: true }) });
        this.info = `${carried.name} · ${pieceSize(woodOf(carried)!)} · ${G.build.placement.info()} · [R] повернуть · [B] стоймя/наискось`;
      }
      return A;
    }

    // --- tool / item in hand (LMB/RMB) ---
    if (eq) this.toolActions(A, eq, tg, t, e, fire);
    if (!eq && t.kind === 'ground' && G.snow && !G.snow.isExperiment && G.snow.contains(t.point.x, t.point.z)) {
      const snow = G.snow, point = t.point.clone();
      if (snow.field.sample(point.x, point.z).mass > 0.001)
        A.push({ key: 'LMB', label: 'Разгрести снег', run: () => snow.dig(point) });
      if (snow.carriedSnow > 0.00001)
        A.push({ key: 'RMB', label: 'Высыпать снег', run: () => snow.deposit(point) });
    }

    // --- context actions (E/F/G) ---
    if (e) this.entityActions(A, e, fire);
    else if (t.kind === 'tree') this.treeActions(A, t.tree!);
    else if (t.kind === 'ground' && !G.house.zoneAt(t.point)) {
      if (!tg.includes('pot') && this.hasSnow(t.point)) A.push({ key: 'F', label: 'Съесть снег', time: 1.5, run: () => this.eatSnow() });
      A.push({ key: 'G', label: 'Сложить кострище здесь', time: 2, run: () => this.makeCampfire(t.point) });
    } else if (t.kind === 'ice') {
      A.push({ key: 'G', label: 'Сложить кострище на льду', time: 2, run: () => this.makeCampfire(t.point) });
    }
    return A;
  }

  private toolActions(A: Action[], eq: Entity, tg: ToolTag[], t: Target, e: Entity | null, fire: Fire | null) {
    const P = G.player;
    const d = eq.def!;
    if (tg.includes('matches') || tg.includes('lighter')) {
      if (!this.flame) {
        const n = eq.charges;
        A.push({ key: 'LMB', label: n > 0 ? (tg.includes('lighter') ? 'Чиркнуть зажигалкой' : 'Чиркнуть спичкой') : 'Пусто', run: () => this.strike(eq) });
      } else {
        if (fire) A.push({ key: 'LMB', label: fire.kind === 'stove' ? 'Поджечь в печи' : 'Поджечь костёр', run: () => this.lightFire(fire) });
        else if (e?.defId === 'lamp' && !e.lit) A.push({ key: 'LMB', label: 'Зажечь лампу', run: () => this.lightLamp(e) });
        else if (e?.def?.fuel && e.inWorld) A.push({ key: 'LMB', label: `Поджечь: ${e.name}`, run: () => this.lightPile(e) });
        A.push({ key: 'RMB', label: 'Погасить', run: () => this.stopFlame() });
      }
      return;
    }
    if (tg.includes('flashlight')) {
      A.push({ key: 'LMB', label: eq.lit ? 'Выключить фонарик' : 'Включить фонарик', run: () => this.toggleFlashlight(eq) });
      return;
    }
    if (tg.includes('lamp')) {
      if (eq.lit) A.push({ key: 'LMB', label: 'Погасить лампу', run: () => { eq.lit = false; } });
      else A.push({ key: 'LMB', label: 'Зажечь лампу (спичка)', run: () => this.lightLampFromPack(eq) });
      return;
    }
    if (tg.includes('pot')) {
      const c = eq.contents!;
      const cap = d.capacity!;
      const full = c.snow + c.water >= cap - 0.01;
      if (e?.kind === 'icehole') {
        if (e.data.frozen > 0.6) this.info = 'Лунка замёрзла — нужен топор или ледобур';
        else if (!full) A.push({ key: 'LMB', label: 'Набрать воды', time: 1.2, run: () => this.fillWater(eq) });
      } else if ((t.kind === 'ground' && !G.house.zoneAt(t.point) && this.hasSnow(t.point)) || t.kind === 'ice') {
        if (!full) A.push({ key: 'LMB', label: 'Набрать снега', time: 1, run: () => this.scoopSnow(eq) });
        else this.info = 'Котелок полон';
      }
      if (fire) A.push({ key: 'G', label: 'Поставить на огонь', run: () => this.putOnFire(fire, eq) });
      if (c.water > 0.05) A.push({ key: 'RMB', label: c.tea ? 'Выпить чай' : c.temp > 45 ? 'Выпить кипяток' : 'Пить', time: 1.2, run: () => this.drinkFrom(eq) });
      return;
    }
    if (d.food) {
      A.push({ key: 'LMB', label: `Съесть: ${eq.name}`, time: d.food.open ? 2.5 : 1.5, run: () => this.eat(eq) });
      if (fire && d.cook) A.push({ key: 'G', label: 'Положить на огонь', run: () => this.putOnFire(fire, eq) });
      return;
    }
    if (d.cook && fire) A.push({ key: 'G', label: 'Положить на огонь', run: () => this.putOnFire(fire, eq) });

    if (tg.includes('rod')) {
      const hole = e?.kind === 'icehole' ? e : (t.kind === 'ice' ? G.lake.holeNear(t.point, 1.2) : null);
      if (hole && !hole.data.big) {
        if (hole.data.frozen > 0.6) this.info = 'Лунка замёрзла';
        else A.push({ key: 'LMB', label: 'Забросить удочку', run: () => this.startFishing(hole) });
      }
      return;
    }
    if (tg.includes('auger')) {
      if (t.kind === 'ice' || (e?.kind === 'icehole' && e.data.frozen > 0.3)) {
        A.push({ key: 'LMB', label: e ? 'Пробурить заново' : 'Сверлить лунку', time: e ? 1.2 : 3.5, run: () => (e ? this.reopenHole(e) : this.drillHole(t.point)) });
      }
      return;
    }
    if (tg.includes('shovel')) {
      if (fire && fire.burning) A.push({ key: 'LMB', label: 'Засыпать огонь снегом', time: 1, run: () => this.smother(fire) });
      else if (t.kind === 'ground' && !G.house.zoneAt(t.point)) A.push({ key: 'LMB', label: 'Нарезать снежный блок', time: 2.2, run: () => this.cutSnowBlock(t.point) });
      return;
    }
    if (tg.includes('hammer') && e?.kind === 'window') {
      const w = e.data as WindowData;
      const plank = P.has((x) => x.defId === 'plank');
      const nails = P.has((x) => x.defId === 'nails' && x.charges >= 2);
      if (w.boards < 3) {
        if (plank && nails) {
          A.push({ key: 'LMB', label: `Заколотить окно (${w.boards}/3)`, time: 3, run: () => this.boardWindow(e, plank, nails) });
          return;
        }
        this.info += plank ? ' · нужны гвозди' : ' · для заколачивания нужна доска';
      }
    }
    if (tg.includes('prybar') && e?.kind === 'window' && (e.data as WindowData).boards > 0) {
      A.push({ key: 'LMB', label: 'Оторвать доску', time: 2, run: () => this.unboard(e) });
      return;
    }
    if (tg.includes('knife')) {
      if (t.kind === 'tree' && t.tree!.type === 'birch') {
        if (t.tree!.bark > 0) A.push({ key: 'LMB', label: 'Срезать бересту', time: 2.5, run: () => this.harvestBark(t.tree!) });
        else this.info += ' · бересты больше нет';
        return;
      }
      if (e?.def?.chop?.knife) {
        A.push({ key: 'LMB', label: e.def.chop.knifeLabel ?? 'Разрезать', time: 3, run: () => this.knifeCut(e, eq) });
        return;
      }
      if (e?.defId === 'blanket' || e?.defId === 'plaid') return;
    }
    // chopping and hitting tools
    if (tg.includes('axe') || tg.includes('saw') || tg.includes('blunt') || tg.includes('knife')) {
      const lbl = this.chopLabel(eq, t, e);
      if (lbl) A.push({ key: 'LMB', label: lbl, run: () => this.startSwing(eq) });
    }
  }

  private chopLabel(tool: Entity, t: Target, e: Entity | null): string | null {
    const tg = tags(tool);
    const saw = tg.includes('saw');
    if (t.kind === 'tree') return tg.includes('blunt') || tg.includes('knife') ? null : saw ? 'Пилить дерево' : 'Рубить дерево';
    if (t.kind === 'ice' && tg.includes('axe')) return 'Прорубить лёд';
    if (!e) return null;
    if (e.kind === 'icehole' && e.data.frozen > 0.3 && (tg.includes('axe') || tg.includes('blunt'))) return 'Разбить лёд в лунке';
    if (e.kind === 'window') {
      const w = e.data as WindowData;
      if (w.glass === 'intact' && !w.cover) return 'Разбить стекло';
      return null;
    }
    if (woodOf(e) && (tg.includes('axe') || saw)) return chopLabelFor(e, tool, t.collider);
    if (e.kind === 'railing') return tg.includes('knife') ? null : saw ? 'Отпилить перила' : 'Рубить перила';
    if (e.kind === 'door') return tg.includes('knife') ? null : saw ? 'Распилить дверь' : 'Рубить дверь';
    if (e.def?.chop) {
      const y = this.yieldsFor(e, tool);
      if (!y) return null;
      const verb = saw ? 'Распилить' : tg.includes('blunt') ? 'Разломать' : e.defId === 'log' ? 'Расколоть' : 'Разрубить';
      return `${verb}: ${e.name}`;
    }
    if (e.kind === 'item' && tg.includes('axe')) return 'Ударить';
    return null;
  }

  private entityActions(A: Action[], e: Entity, fire: Fire | null) {
    const P = G.player;
    const d = e.def;
    if (fire) {
      const f1 = this.bestFuel(fire);
      if (f1) A.push({ key: 'E', label: `Подбросить: ${f1.name}${f1.moisture > 0.3 ? ' (сырое)' : ''}`, run: () => this.feed(fire, f1) });
      const f2 = f1 ? this.bestFuel(fire, f1.def!.fuel!.kind) : null;
      if (f2) A.push({ key: 'F', label: `Подбросить: ${f2.name}`, run: () => this.feed(fire, f2) });
      if (!f1) this.info += ' · нет топлива в рюкзаке';
      if (fire.kind === 'stove' && !tags(P.equipped).includes('pot') && !P.equipped?.def?.cook)
        A.push({ key: 'G', label: fire.damper ? 'Открыть заслонку (жарче, быстрее сгорает)' : 'Прикрыть заслонку (медленное тление)', run: () => { fire.damper = !fire.damper; G.audio.play('click'); } });
      return;
    }
    switch (e.kind) {
      case 'window': {
        const w = e.data as WindowData;
        if (w.cover) A.push({ key: 'F', label: 'Снять одеяло', time: 0.8, run: () => this.takeWindowCover(e) });
        return;
      }
      case 'door':
        A.push({ key: 'E', label: e.data.open ? 'Закрыть дверь' : 'Открыть дверь', run: () => G.house.toggleDoor() });
        return;
      case 'doorway':
        if (e.data.cover) A.push({ key: 'F', label: 'Снять одеяло', time: 0.8, run: () => { const b = G.house.takeDoorway(); if (b) P.carry(b); } });
        return;
      case 'icehole':
        if (!e.data.big && e.data.frozen <= 0.6) this.info += ' · нужен котелок или удочка';
        return;
      case 'trunk':
      case 'railing':
        return;
      case 'part': {
        const stuck = G.build.whyStuck(e);
        if (stuck) {
          this.info += ` · ${stuck}`;
          return;
        }
        if (e.mass > MAX_DRAG) {
          this.info += ' · слишком тяжело';
          return;
        }
        const above = G.build.carried(e);
        A.push({ key: 'E', label: `Вытащить: ${e.name}${above ? ' (что на нём — упадёт)' : ''}`, time: 0.8, run: () => {
          G.build.takeOut(e);
          if (!e.removed && e.inWorld && e.mass <= MAX_DRAG) P.carry(e);
        } });
        return;
      }
      case 'container':
        if (!e.data.searched) A.push({ key: 'E', label: 'Обыскать', time: 2.5, run: () => G.structures.search(e) });
        return;
      case 'radio': {
        const bat = P.has((x) => x.defId === 'battery' && x.charges > 5);
        if (!e.data.powered) {
          if (bat) A.push({ key: 'E', label: 'Подключить аккумулятор', time: 4, run: () => {
            e.data.powered = true;
            e.data.charge = bat.charges;
            P.forget(bat);
            G.entities.destroy(bat);
            (e.data.dial.material as THREE.MeshBasicMaterial).color.setHex(0x66ff88);
            msg('Рация ожила: шипение эфира, огонёк шкалы.', 'good');
          } });
          else this.info += ' · нет питания: нужен аккумулятор 12 В';
        } else if (!G.goal.signalAt) {
          A.push({ key: 'E', label: 'Передать сигнал бедствия', time: 6, run: () => {
            G.goal.signalAt = G.time;
            G.audio.play('click');
            msg('«…Кряж, вас слышим. Борт вылетит, как позволит погода. Ждите у станции.»', 'good');
            setTimeout(() => msg('Вертолёт прилетит не раньше чем через 8 часов и только не в метель. Будьте у станции.', 'info'), 3000);
          } });
        } else this.info += ' · сигнал передан, ждите вертолёт у станции';
        return;
      }
    }
    if (e.kind !== 'item' || !d) return;
    if (e.pinned === 'fire') {
      A.push({ key: 'E', label: 'Снять с огня', run: () => (e.pocket ? P.addToInventory(e) : P.carry(e)) });
      return;
    }
    if (e.defId === 'bed') {
      A.push({ key: 'E', label: 'Лечь спать', run: () => G.hud.openSleep('bed', e) });
      const n = (e.data.blankets ?? []).length;
      if (n) A.push({ key: 'F', label: `Взять одеяло (${n})`, time: 0.8, run: () => { const b = G.house.takeFromBed(e); if (b) P.carry(b); } });
      A.push({ key: 'G', label: 'Тащить кровать', run: () => P.carry(e) });
      return;
    }
    if (e.pocket) {
      A.push({ key: 'E', label: `Взять: ${e.name}`, run: () => P.addToInventory(e) });
      if (d.read) A.push({ key: 'F', label: d.read === 'book' ? 'Читать' : 'Прочитать', run: () => G.hud.read(e) });
      else A.push({ key: 'F', label: 'Взять в руки', run: () => P.carry(e) });
      if (d.tearInto) A.push({ key: 'G', label: 'Порвать на растопку', time: 1.5, run: () => this.tear(e) });
    } else if (e.mass <= MAX_LIFT) {
      A.push({ key: 'E', label: `Поднять: ${e.name}`, run: () => P.carry(e) });
    } else if (e.mass <= MAX_DRAG) {
      A.push({ key: 'E', label: `Тащить: ${e.name}`, run: () => P.carry(e) });
    } else this.info += ' · слишком тяжело';
  }

  private treeActions(A: Action[], tr: Tree) {
    const n = G.forest.reachableBranches(tr);
    if (!n) {
      this.info += ' · нижних веток не достать';
      return;
    }
    const needles = tr.type === 'spruce' || tr.type === 'pine';
    A.push({ key: 'F', label: needles ? 'Отломить еловую ветку (лапник)' : tr.type === 'dead' || tr.type === 'burnt' ? 'Отломить сухую ветку' : 'Отломить ветку', time: needles ? 2.5 : 2, run: () => this.harvest(tr) });
  }

  // ---------- descriptions ----------

  describe(e: Entity): string {
    const fire = G.fires.fireOf(e);
    if (fire) return G.fires.describe(fire);
    switch (e.kind) {
      case 'window': {
        const w = e.data as WindowData;
        const parts = [w.glass === 'intact' ? 'стекло цело' : 'стекло разбито'];
        if (w.cover) parts.push(`завешено: ${w.cover.name.toLowerCase()}`);
        if (w.boards) parts.push(`досок: ${w.boards}/3`);
        return `Окно · ${parts.join(' · ')}`;
      }
      case 'door':
        return `Дверь · ${e.data.open ? 'открыта' : 'закрыта'}` + (e.hp < e.maxHp ? ` · ${this.hpBar(e)}` : '');
      case 'doorway':
        return e.data.cover ? 'Дверной проём · завешен' : 'Пустой дверной проём · сквозит';
      case 'railing':
        return `${e.name}` + (e.hp < e.maxHp ? ` · ${this.hpBar(e)}` : '');
      case 'trunk':
        return `${e.name} · ${e.data.len.toFixed(1)} м · ${this.hpBar(e)}`;
      case 'icehole':
        return `${e.name}${e.data.frozen > 0.6 ? ' · замёрзла' : e.data.frozen > 0.3 ? ' · затягивается льдом' : ''}`;
      case 'container':
        return `${e.name}${e.data.searched ? ' · обыскан' : ''}`;
      case 'radio':
        return `${e.name}${e.data.powered ? ' · есть питание' : ''}`;
    }
    if (e.kind === 'stump') {
      const w = woodOf(e)!;
      return `${e.name} · высота ${pieceSize(w)}`;
    }
    if (e.kind === 'part') {
      const s = G.build.of(e);
      return `${describeWood(e)}${G.build.describe(e)}${s ? ` · ${s.name.toLowerCase()}` : ''}`;
    }
    const d = e.def;
    if (!d) return e.name;
    let s = woodOf(e) ? describeWood(e) : e.displayName() + ` · ${e.mass < 1 ? Math.round(e.mass * 1000) + ' г' : e.mass.toFixed(1) + ' кг'}`;
    if (e.defId === 'bed') {
      const n = (e.data.blankets ?? []).length;
      s += n ? ` · одеял: ${n}` : ' · без одеяла';
    }
    if (e.hp < e.maxHp && e.maxHp > 0) s += ` · ${this.hpBar(e)}`;
    if (e.pinned === 'fire') s += ' · на огне';
    if ((d.wear || d.insul || d.fuel) && e.moisture > 0.12) {
      const st = dryingAt(e.position(), !!(d.wear || d.insul), false);
      const hrs = st.rate < 0 ? (e.moisture - 0.1) / (-st.rate * 3600) : Infinity;
      s += ` · сырое ${Math.round(e.moisture * 100)}% · ${st.why}${hrs < 48 ? ` (~${hrs < 1 ? Math.max(5, Math.round(hrs * 60)) + ' мин' : hrs.toFixed(1) + ' ч'})` : ''} · ${st.T.toFixed(0)}°, влажн. ${Math.round(st.rh * 100)}%`;
    }
    if (d.cook && e.cook > 0) s += ` · готовность ${Math.round((e.cook / d.cook.time) * 100)}%`;
    return s;
  }

  private describeTree(t: Tree) {
    let s = `${TREE_NAMES[t.type]} · ⌀${Math.round(t.r * 200)} см · ${t.h.toFixed(0)} м`;
    const deg = (t.lean * 180) / Math.PI;
    const leanDir = new THREE.Vector3(Math.cos(t.leanDir), 0, Math.sin(t.leanDir));
    if (deg >= 1.5) s += ` · наклон ${Math.round(deg)}° ${this.sideWord(t, leanDir)}`;
    const cut = G.forest.cutDepth(t);
    if (cut > 0.01) {
      s += ` · подрублено ${Math.round(cut * 100)}%`;
      const f = G.forest.fallDirection(t);
      if (f) s += ` · упадёт ${this.sideWord(t, f.dir)}`;
    }
    return s;
  }

  /** "от вас", "на вас", "влево", "вправо": a direction at a tree, seen by the player */
  private sideWord(t: Tree, dir: THREE.Vector3) {
    const P = G.player.pos;
    const away = new THREE.Vector3(t.x - P.x, 0, t.z - P.z);
    if (away.lengthSq() < 1e-6) return '';
    away.normalize();
    const d = dir.clone().setY(0).normalize();
    const c = away.dot(d);
    if (c > 0.7) return 'от вас';
    if (c < -0.7) return 'НА ВАС';
    const right = new THREE.Vector3(-away.z, 0, away.x);
    return d.dot(right) > 0 ? 'вправо' : 'влево';
  }

  private hpBar(e: Entity) {
    return `${Math.round((1 - e.hp / Math.max(1, e.maxHp)) * 100)}% разрушено`;
  }

  // ---------- per frame ----------

  update(dt: number) {
    const inp = G.input;
    G.build?.placement.update(dt);
    this.computeTarget();
    this.actions = this.compute();
    if (G.sleeping || G.dead || !inp.enabled) return;
    const P = G.player;

    // flame countdown
    if (this.flame) {
      this.flame.t -= dt;
      if (this.flame.light) {
        const p = G.camera.position.clone().add(P.forward().multiplyScalar(0.4));
        this.flame.light.position.copy(p);
        this.flame.light.intensity = 0.9 + Math.random() * 0.3;
        this.flame.light.distance = 5;
      }
      if (G.player.equipped?.defId !== (this.flame.kind === 'match' ? 'matches' : 'lighter')) this.stopFlame();
      else if (this.flame.t <= 0) {
        msg(this.flame.kind === 'match' ? 'Спичка догорела' : 'Зажигалка погасла', 'info');
        this.stopFlame();
      } else if (!G.house.zoneAt(P.pos) && G.weather.wind > 8 && Math.random() < dt * 0.25 * (G.weather.wind - 8) / 6) {
        msg('Ветер задул пламя', 'warn');
        this.stopFlame();
      }
    }

    // fishing
    if (this.fishing) {
      const f = this.fishing;
      if (P.moving || P.equipped?.defId !== 'rod') {
        this.fishing = null;
        msg('Рыбалка прервана');
      } else if (f.bite > 0) {
        f.bite -= dt;
        if (f.bite <= 0) {
          msg('Рыба сорвалась…', 'warn');
          f.wait = 5 + Math.random() * 15;
        }
      } else {
        f.wait -= dt;
        if (f.wait <= 0) {
          f.bite = 1.3;
          G.audio.play('plink', { pos: f.hole.position() });
          msg('Клюёт! Жми ЛКМ!', 'good');
        }
      }
    }

    // timed action in progress
    if (this.timed) {
      const tm = this.timed;
      if (P.pos.distanceTo(tm.start) > 0.45) {
        this.timed = null;
        msg('Прервано', 'info');
      } else {
        const speed = 0.5 + 0.5 * G.body.dex;
        tm.t += dt * speed;
        if (tm.t >= (tm.action.time ?? 0)) {
          this.timed = null;
          tm.action.run();
        }
      }
      return;
    }

    // swing in progress
    if (this.swinging) {
      const s = this.swinging;
      s.t += dt;
      if (!s.hit && s.t >= s.dur * 0.55) {
        s.hit = true;
        this.resolveHit(s.tool);
      }
      if (s.t >= s.dur) this.swinging = null;
      return;
    }

    // input
    const pressed = (k: Key) => (k === 'E' ? inp.hit('KeyE') : k === 'F' ? inp.hit('KeyF') : k === 'G' ? inp.hit('KeyG') : k === 'LMB' ? inp.lmbPressed || (inp.lmb && this.isAutoRepeat()) : inp.rmbPressed);
    if (this.fishing && inp.lmbPressed) {
      this.hook();
      return;
    }
    for (const a of this.actions) {
      if (!pressed(a.key)) continue;
      if (a.time) this.timed = { action: a, t: 0, start: P.pos.clone() };
      else a.run();
      return;
    }
    // generic controls
    if (P.carried) {
      if (inp.rmbPressed) P.releaseCarry(true);
      else if (inp.hit('KeyQ') || inp.hit('KeyE')) P.releaseCarry();
      return;
    }
    if (inp.hit('KeyQ') && P.equipped) {
      const e = P.equipped;
      P.equip(null);
      P.dropFromInventory(e);
      return;
    }
    if (inp.lmbPressed && P.equipped && ['axe', 'saw', 'blunt'].some((t) => tags(P.equipped).includes(t as ToolTag))) this.startSwing(P.equipped);
  }

  private isAutoRepeat() {
    const eq = G.player.equipped;
    if (!eq && !G.player.carried && this.target.kind === 'ground' && G.snow && !G.snow.isExperiment) return true;
    const t = tags(eq);
    return t.includes('axe') || t.includes('saw') || t.includes('blunt');
  }

  // ---------- swing / chop ----------

  startSwing(tool: Entity) {
    const P = G.player;
    if (P.wrapped) {
      msg('Сначала снимите одеяло с плеч [F в инвентаре]', 'warn');
      return;
    }
    const spec = tool.def!.tool!;
    const stam = 0.55 + 0.45 * P.stamina;
    const dur = spec.swing / stam;
    this.swinging = { t: 0, dur, hit: false, tool };
    G.vm.swing(dur, tags(tool).includes('saw') ? 'saw' : 'chop');
    P.stamina = Math.max(0, P.stamina - 0.045 * (tool.def!.mass + 0.5));
    P.workT = 1.5;
    G.audio.play('swing', { vol: 0.6 });
  }

  private resolveHit(tool: Entity) {
    this.computeTarget();
    const t = this.target;
    const tg = tags(tool);
    const saw = tg.includes('saw');
    const blunt = tg.includes('blunt');
    const P = G.player;
    const quality = (0.5 + 0.5 * G.body.dex) * (0.6 + 0.4 * P.stamina);
    const power = tool.def!.tool!.power * quality;
    const sfx = saw ? 'saw' : blunt ? 'hammer' : 'chop';
    if (t.kind === 'none' || t.kind === 'static' || t.kind === 'ground') {
      if (t.kind !== 'none') G.audio.play('thud', { pos: t.point, vol: 0.5 });
      return;
    }
    if (t.kind === 'tree') {
      if (blunt || tg.includes('knife')) {
        G.audio.play('thud', { pos: t.point });
        return;
      }
      G.forest.chopTree(t.tree!, t.point, power * (saw ? 0.8 : 1), saw);
      return;
    }
    if (t.kind === 'ice') {
      if (!tg.includes('axe')) return;
      if (G.lake.holeNear(t.point, 0.5)) return;
      if (!this.iceWork || this.iceWork.pos.distanceTo(t.point) > 0.5) this.iceWork = { pos: t.point.clone(), hp: 9 };
      this.iceWork.hp -= power;
      G.audio.play('crack', { pos: t.point, vol: 0.7 });
      G.fx.burst('glass', t.point, 8, t.normal);
      if (this.iceWork.hp <= 0) {
        G.lake.makeHole(this.iceWork.pos);
        this.iceWork = null;
        msg('Прорубь готова', 'good');
      }
      return;
    }
    const e = t.entity!;
    if (woodOf(e) && (tg.includes('axe') || saw) && e.inWorld) {
      hitPiece(e, tool, t.point, power, t.collider);
      return;
    }
    G.fx.burst(e.kind === 'window' ? 'glass' : 'chips', t.point, 6, t.normal);
    switch (e.kind) {
      case 'window': {
        const w = e.data as WindowData;
        if (w.glass === 'intact' && !w.cover) G.house.breakGlass(e);
        else G.audio.play('thud', { pos: t.point });
        return;
      }
      case 'icehole':
        if (e.data.frozen > 0.3) {
          e.data.frozen = 0;
          G.audio.play('crack', { pos: t.point });
          msg('Лёд в лунке разбит', 'good');
        }
        return;
      case 'railing':
      case 'door':
        if (tg.includes('knife')) return;
        e.hp -= power * (saw ? 1.2 : blunt ? 0.8 : 1);
        G.audio.play(sfx, { pos: t.point });
        if (e.hp <= 0) this.breakStructure(e, tool);
        return;
    }
    if (e.kind === 'item' && e.def) {
      const y = this.yieldsFor(e, tool);
      if (y && e.maxHp > 0) {
        const mul = saw ? (e.defId === 'log' ? 0.7 : 1.2) : blunt ? 0.8 : 1;
        e.hp -= power * mul;
        G.audio.play(sfx, { pos: t.point });
        if (e.body) e.body.applyImpulse(P.forward().multiplyScalar(0.3 * Math.min(5, e.mass)), true);
        if (e.hp <= 0) this.breakItem(e, y);
        return;
      }
      if (e.body) {
        e.body.applyImpulseAtPoint(P.forward().multiplyScalar(2.5 + power * 4), t.point, true);
        G.audio.play('thud', { pos: t.point, vol: 0.7 });
      }
    }
  }

  private breakItem(e: Entity, y: Yield[]) {
    const at = e.position();
    const moist = e.def?.fuel ? e.moisture : e.moisture;
    // anything lying on a bed falls off when it breaks
    if (e.defId === 'bed') for (const b of e.data.blankets ?? []) G.entities.placeInWorld(b, at.clone().add(new THREE.Vector3(0, 0.5, 0)));
    G.entities.destroy(e);
    this.spawnYields(y.map((q) => ({ ...q, params: e.params.birch ? { birch: 1 } : undefined })), at, moist);
    msg(`${e.name} → ${y.map((q) => `${def(q.id).name} ×${q.n}`).join(', ')}`, 'good');
  }

  private breakStructure(e: Entity, tool: Entity) {
    const saw = tags(tool).includes('saw');
    const blunt = tags(tool).includes('blunt');
    const at = e.position();
    if (e.kind === 'door') {
      G.house.destroyDoor();
      const y = saw ? [{ id: 'plank', n: 3 }] : blunt ? [{ id: 'firewood', n: 2 }, { id: 'kindling', n: 3 }] : [{ id: 'firewood', n: 4 }];
      this.spawnYields(y, new THREE.Vector3(1.5, G.house.Y0 + 0.9, 3.4), 0.06);
      msg('Дверь разрублена. Теперь в доме гуляет ветер!', 'warn');
      return;
    }
    const len = e.data.len ?? 1.2;
    G.entities.destroy(e);
    const y = saw ? [{ id: 'plank', n: Math.max(1, Math.round(len / 1.2)) }, { id: 'kindling', n: 1 }] : blunt ? [{ id: 'kindling', n: 3 }] : [{ id: 'firewood', n: 2 }, { id: 'kindling', n: 1 }];
    this.spawnYields(y, at.add(new THREE.Vector3(0, 0.6, 0)), 0.06, 0.3);
    msg(`${e.name} разрублены → ${y.map((q) => `${def(q.id).name} ×${q.n}`).join(', ')}`, 'good');
  }

  // ---------- actions ----------

  private feed(f: Fire, e: Entity) {
    if (G.player.carried === e) G.player.releaseCarry();
    G.player.forget(e);
    const err = G.fires.addFuel(f, e);
    if (err) {
      msg(err, 'warn');
      if (!e.inWorld && !e.removed) G.player.addToInventory(e);
      return;
    }
    msg(`В огонь: ${e.name}${e.moisture > 0.3 ? ' (сырое — будет плохо гореть)' : ''}`, 'info');
  }

  private putOnFire(f: Fire, e: Entity) {
    if (G.player.carried === e) G.player.releaseCarry();
    if (G.player.equipped === e) G.player.equip(null);
    G.player.forget(e);
    if (!G.fires.placeOnSpot(f, e)) {
      msg('Нет места на огне', 'warn');
      if (!e.inWorld) G.player.addToInventory(e);
      return;
    }
    G.audio.play('drop', { pos: f.pos });
  }

  private hangOnWindow(win: Entity, b: Entity) {
    G.player.releaseCarry();
    G.player.forget(b);
    G.house.hangCover(win, b);
    msg('Окно завешено одеялом — меньше тепла уходит', 'good');
  }

  private takeWindowCover(win: Entity) {
    const b = G.house.takeCover(win);
    if (b) G.player.carry(b);
  }

  private hangDoorway(b: Entity) {
    G.player.releaseCarry();
    G.player.forget(b);
    G.house.hangDoorway(b);
    msg('Проём завешен', 'good');
  }

  private spreadBed(bed: Entity, b: Entity) {
    G.player.releaseCarry();
    G.player.forget(b);
    G.house.spreadOnBed(bed, b);
    msg(`На кровати одеял: ${bed.data.blankets.length}`, 'good');
  }

  private wrap(b: Entity) {
    const P = G.player;
    P.releaseCarry();
    if (P.wrapped) {
      msg('Вы уже укутаны', 'info');
      return;
    }
    G.entities.removeFromWorld(b);
    P.wrapped = b;
    msg(`Вы укутались: ${b.name}. Теплее, но медленнее и руки заняты.`, 'good');
  }

  unwrap() {
    const P = G.player;
    if (!P.wrapped) return;
    const b = P.wrapped;
    P.wrapped = null;
    P.carry(b);
  }

  private strike(eq: Entity) {
    if (eq.charges <= 0) {
      msg(eq.defId === 'matches' ? 'Спички кончились' : 'Газ кончился', 'warn');
      return;
    }
    const kind = eq.defId === 'lighter' ? 'lighter' : 'match';
    const gl = G.player.worn.get('hands');
    if (gl?.defId === 'mittens') {
      msg('В варежках не получится. Снимите их.', 'warn');
      return;
    }
    eq.charges--;
    let chance = this.flameQuality(kind);
    if (G.body.skills.has('fire')) chance = Math.min(1, chance * 1.2);
    if (kind === 'match' && eq.moisture > 0.4) chance *= 0.05;
    const air = G.thermal.tAt(G.camera.position);
    if (kind === 'lighter' && air < -15) chance *= clamp(1 - (-15 - air) / 15, 0.15, 1);
    if (!G.house.zoneAt(G.player.pos)) chance *= 1 - clamp((G.weather.wind * (G.structures.shelterAt(G.player.pos)?.wind ?? 1) - 4) / 14, 0, 0.7);
    if (Math.random() < chance) {
      this.flame = { t: kind === 'match' ? 8 : 12, kind, light: G.fx.acquireLight() };
      if (this.flame.light) this.flame.light.color.setHex(0xffb060);
      G.audio.play('match');
      if (eq.charges === 0 && kind === 'match') msg('Это была последняя спичка!', 'warn');
    } else {
      G.audio.play('match_fail');
      msg(eq.moisture > 0.4 ? 'Спички отсырели…' : G.body.dex < 0.5 ? 'Пальцы не слушаются — спичка сломалась' : 'Не зажглась', 'warn');
    }
  }

  private lightFire(f: Fire) {
    const fl = this.flame!;
    const q = this.flameQuality(fl.kind) + 0.1;
    G.fires.ignite(f, q);
    if (fl.kind === 'match') this.stopFlame();
  }

  private lightPile(e: Entity) {
    const at = e.position();
    if (G.house.zoneAt(at)) {
      msg('Костёр в доме — плохая идея. Для этого есть печь.', 'warn');
      return;
    }
    const ground = G.lake.onIce(at) ? G.lake.levelAt(at.x, at.z) + 0.03 : G.terrain.heightAt(at.x, at.z);
    const f = G.fires.makeCampfire(new THREE.Vector3(at.x, ground, at.z));
    for (const it of G.entities.near(at, 0.8, (x) => x.kind === 'item' && !!x.def?.fuel && x !== G.player.carried)) G.fires.addFuel(f, it);
    this.lightFire(f);
  }

  private lightLamp(e: Entity) {
    if ((e.charges ?? 0) <= 0) {
      msg('В лампе нет керосина', 'warn');
      return;
    }
    e.lit = true;
    G.audio.play('fire_ignite', { pos: e.position(), vol: 0.4 });
    if (this.flame?.kind === 'match') this.stopFlame();
  }

  private lightLampFromPack(lamp: Entity) {
    if (lamp.charges <= 0) {
      const k = G.player.has((x) => x.defId === 'kerosene' && x.charges > 0);
      msg(k ? 'Лампа пуста — заправьте керосином (в инвентаре)' : 'В лампе нет керосина', 'warn');
      return;
    }
    const m = G.player.has((x) => (x.defId === 'matches' || x.defId === 'lighter') && x.charges > 0);
    if (!m) {
      msg('Нечем зажечь', 'warn');
      return;
    }
    m.charges--;
    if (Math.random() < this.flameQuality(m.defId === 'lighter' ? 'lighter' : 'match') * (m.moisture > 0.4 ? 0.05 : 1)) {
      lamp.lit = true;
      G.audio.play('match');
    } else msg('Не получилось зажечь', 'warn');
  }

  private toggleFlashlight(e: Entity) {
    if (!e.lit && e.charges <= 0) {
      msg('Батарейка села', 'warn');
      return;
    }
    e.lit = !e.lit;
    G.audio.play('click');
  }

  private fillWater(pot: Entity) {
    const c = pot.contents!;
    const cap = pot.def!.capacity!;
    const add = cap - c.snow - c.water;
    const T = (c.water * c.temp + add * 0.5) / (c.water + add);
    c.water += add;
    c.temp = T;
    c.boiled = false;
    c.dirty = true;
    c.tea = false;
    G.audio.play('splash', { vol: 0.3 });
    msg(`Набрали ${add.toFixed(1)} л воды из лунки (лучше вскипятить)`, 'info');
  }

  private scoopSnow(pot: Entity) {
    const c = pot.contents!;
    const cap = pot.def!.capacity!;
    const add = Math.min(0.5, cap - c.snow - c.water);
    c.snow += add;
    if (c.water > 0) c.boiled = false;
    G.audio.play('snow_scoop');
    msg(`Набрали снега (+${add.toFixed(1)} л воды после таяния)`, 'info');
  }

  private drinkFrom(pot: Entity) {
    const c = pot.contents!;
    if (c.temp > 75) {
      msg('Слишком горячо — обожжётесь. Пусть немного остынет.', 'warn');
      return;
    }
    const v = Math.min(0.4, c.water);
    c.water -= v;
    G.body.drink(v, c.temp);
    G.audio.play('drink');
    if (c.dirty && !c.boiled && Math.random() < 0.35) {
      G.body.sick = 6;
      msg('Сырая вода из озера… живот крутит.', 'bad');
    } else msg(c.tea ? 'Горячий чай. Тепло разливается по телу.' : c.temp > 40 ? 'Горячая вода согревает' : `Выпили ${v.toFixed(1)} л`, 'good');
    if (c.water <= 0.01) c.tea = false;
  }

  private eat(food: Entity) {
    const d = food.def!.food!;
    if (d.open && !this.canOpenCans()) {
      msg('Нечем открыть банку — нужен нож или топор', 'warn');
      return;
    }
    G.body.kcal = Math.min(3500, G.body.kcal + d.kcal);
    if (d.water) G.body.water = clamp(G.body.water + d.water, 0, 3);
    if (d.raw && Math.random() < 0.4) {
      G.body.sick = 8;
      msg('Сырая рыба — плохая идея…', 'bad');
    } else msg(`Съедено: ${food.name} (+${d.kcal} ккал)`, 'good');
    // a proper meal is a small joy
    const joy = food.defId === 'chocolate' ? 0.06 : food.defId === 'fish_cooked' ? 0.1 : d.open ? 0.05 : 0.02;
    G.body.mood = clamp(G.body.mood + joy, 0, 1);
    G.audio.play('eat');
    G.entities.destroy(food);
  }

  private eatSnow() {
    G.body.eatSnow();
    G.audio.play('eat');
    msg('Снег утоляет жажду, но остужает изнутри', 'info');
  }

  private tear(e: Entity) {
    const y = e.def!.tearInto!;
    G.entities.destroy(e);
    for (const q of y) this.giveOrDrop(q.id, q.n);
    G.audio.play('tear');
    msg(`Порвано: ${y.map((q) => `${def(q.id).name} ×${q.n}`).join(', ')}`, 'good');
  }

  private knifeCut(e: Entity, knife: Entity) {
    const y = e.def!.chop!.knife!;
    const P = G.player;
    if (P.isWorn(e)) P.unwear(e);
    const m = e.moisture;
    G.entities.destroy(e);
    for (const q of y) this.giveOrDrop(q.id, q.n, { moisture: def(q.id).fuel ? m : undefined });
    G.audio.play('tear');
    if (knife.defId === 'shard' && Math.random() < 0.3) {
      G.body.condition = Math.max(0, G.body.condition - 4);
      msg('Порезались осколком!', 'bad');
      G.hud.flash('bad');
    }
    msg(`Получено: ${y.map((q) => `${def(q.id).name} ×${q.n}`).join(', ')}`, 'good');
  }

  private harvestBark(t: Tree) {
    t.bark--;
    this.giveOrDrop('bark', 1, { moisture: 0.2 });
    G.audio.play('tear');
    msg('Береста — отличный трут', 'good');
  }

  private harvest(t: Tree) {
    const piece = G.forest.breakBranch(t);
    if (!piece) return;
    const P = G.player;
    const at = P.eyePos.add(P.forward().multiplyScalar(0.6));
    const e = spawnPiece(piece, at, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), P.yaw), t.type === 'dead' || t.type === 'burnt' ? 0.12 : 0.4);
    if (!(e.pocket && P.addToInventory(e))) msg(`${e.name} ${pieceSize(woodOf(e)!)} — слишком длинная для рюкзака, лежит рядом`, 'info');
    else msg(`${e.name} · ${pieceSize(woodOf(e)!)} · ${e.mass.toFixed(1)} кг`, 'good');
    G.audio.play('tear');
    G.fx.burst('snow', new THREE.Vector3(t.x, t.y + 1.5, t.z), 6);
  }

  private makeCampfire(p: THREE.Vector3) {
    if (G.house.zoneAt(p)) {
      msg('Костёр в доме — плохая идея', 'warn');
      return;
    }
    for (const f of G.fires.list) if (f.kind === 'camp' && f.pos.distanceTo(p) < 1.5) {
      msg('Кострище уже рядом', 'warn');
      return;
    }
    const y = G.lake.onIce(p) ? G.lake.levelAt(p.x, p.z) + 0.03 : G.terrain.heightAt(p.x, p.z);
    G.fires.makeCampfire(new THREE.Vector3(p.x, y, p.z));
    G.audio.play('snow_scoop');
    msg('Кострище готово. Положите трут, растопку, дрова — и поджигайте.', 'good');
  }

  private drillHole(p: THREE.Vector3) {
    if (G.lake.holeNear(p, 0.6)) return;
    G.lake.makeHole(new THREE.Vector3(p.x, 0, p.z));
    G.audio.play('crack', { pos: p });
    msg('Лунка готова', 'good');
  }

  private reopenHole(h: Entity) {
    h.data.frozen = 0;
    G.audio.play('crack', { pos: h.position() });
  }

  private cutSnowBlock(p: THREE.Vector3) {
    const P = G.player;
    const at = p.clone().add(new THREE.Vector3(0, 0.3, 0));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), P.yaw);
    G.entities.spawnItem('snowblock', at, { quat: q });
    G.audio.play('snow_scoop');
  }

  private smother(f: Fire) {
    for (const x of f.fuel) {
      x.burning = false;
      x.moisture = Math.min(1, x.moisture + 0.4);
    }
    f.embers = 0;
    f.power = 0;
    G.audio.play('snow_scoop');
    G.fx.burst('steam', f.pos, 6);
    msg('Огонь потушен', 'info');
  }

  private boardWindow(win: Entity, plank: Entity, nails: Entity) {
    nails.charges -= 2;
    if (nails.charges <= 0) G.entities.destroy(nails);
    G.entities.destroy(plank);
    G.house.addBoard(win);
    G.audio.play('hammer', { pos: win.position() });
    setTimeout(() => G.audio.play('hammer', { pos: win.position() }), 250);
    msg(`Доска прибита (${(win.data as WindowData).boards}/3)`, 'good');
  }

  private unboard(win: Entity) {
    if (G.house.removeBoard(win)) {
      this.giveOrDrop('plank', 1, { moisture: 0.06 });
      G.audio.play('creak', { pos: win.position() });
    }
  }

  private startFishing(hole: Entity) {
    this.fishing = { hole, wait: 6 + Math.random() * 20, bite: 0 };
    G.audio.play('splash', { pos: hole.position(), vol: 0.2 });
    msg('Удочка заброшена. Ждите поклёвки и жмите ЛКМ.', 'info');
  }

  private hook() {
    const f = this.fishing!;
    if (f.bite > 0) {
      const ok = Math.random() < 0.55 + 0.35 * G.body.dex;
      if (ok) {
        this.giveOrDrop('fish_raw', 1);
        msg('Есть рыба!', 'good');
        G.audio.play('splash', { pos: f.hole.position(), vol: 0.5 });
      } else msg('Сорвалась!', 'warn');
      f.bite = 0;
      f.wait = 8 + Math.random() * 25;
    } else {
      msg('Рано подсекли', 'info');
      f.wait = 5 + Math.random() * 15;
    }
  }

  /** Toggle helper used by the inventory screen. */
  isFishing() {
    return !!this.fishing;
  }

  timedProgress(): number {
    return this.timed ? this.timed.t / (this.timed.action.time ?? 1) : -1;
  }

  itemDef(e: Entity): ItemDef | null {
    return e.def;
  }
}
