// Player physiology: core temperature, hands, feet, calories, water, fatigue,
// wet clothes, frostbite and overall condition.
import { G, msg } from './ctx';
import { clamp } from '../core/rng';
import type { Entity } from './entities';
import type { Slot } from './items';

export type Activity = 'idle' | 'walk' | 'sprint' | 'work' | 'sleep' | 'water';

export interface Env {
  air: number; // ambient air °C
  wind: number; // m/s at the body
  radiant: number; // °C bonus from fires/sun
  inWater: boolean;
  sleeping: boolean;
  bedding: number; // clo under/over you while sleeping
  wrapClo: number; // blanket wrapped around shoulders
  handsWarming: boolean;
  lampInHand: boolean;
  metalTool: boolean;
  outdoors: boolean;
  snowfall: number;
  rh: number; // relative humidity of the air around you, 0..1
}

const MET: Record<Activity, number> = { idle: 95, walk: 210, sprint: 430, work: 380, sleep: 72, water: 420 };

export class Body {
  core = 36.9;
  hands = 31;
  feet = 29;
  kcal = 1700;
  water = 1.5;
  fatigue = 0.3;
  wetness = 0;
  feetWet = 0;
  snow = 0;
  condition = 100;
  frostHands = 0;
  frostFeet = 0;
  sick = 0; // hours left
  warmPending = 0; // J to add to the body
  activity: Activity = 'idle';
  // derived, for UI/debug
  clo = 0;
  windproof = 0;
  felt = 0;
  metabolic = 0;
  loss = 0;
  dex = 1;
  shiver = 0;
  halluc = 0;
  private warned = new Set<string>();

  wornClo(worn: Map<Slot, Entity>) {
    let clo = 0, wp = 0;
    for (const e of worn.values()) {
      const w = e.def!.wear!;
      const wetF = 1 - this.wetness * 0.65 * (w.wetSens ?? 0.6);
      clo += w.clo * wetF;
      wp += w.clo * w.wind;
    }
    return { clo, windproof: clo > 0 ? wp / clo : 0 };
  }

  gloves(worn: Map<Slot, Entity>) {
    const g = worn.get('hands');
    return g ? { clo: g.def!.wear!.clo, dex: g.def!.wear!.dex ?? 1, wind: g.def!.wear!.wind } : { clo: 0, dex: 1, wind: 0 };
  }

  update(dt: number, env: Env, worn: Map<Slot, Entity>) {
    if (dt <= 0) return;
    if (G.settings.noCold) {
      env = { ...env, air: Math.max(env.air, 20), wind: 0, inWater: false };
    }
    // sub-step large time jumps (sleep, waiting)
    let left = dt;
    while (left > 0) {
      const s = Math.min(left, 10);
      left -= s;
      this.step(s, env, worn);
      if (G.dead) return;
    }
  }

  private step(dt: number, env: Env, worn: Map<Slot, Entity>) {
    const { clo: wornClo, windproof } = this.wornClo(worn);
    // wind pumps air through permeable clothing and steals part of its insulation
    const windPen = 1 - 0.5 * (1 - windproof) * clamp(env.wind / 15, 0, 1);
    let clo = wornClo * windPen + env.wrapClo;
    if (env.sleeping) clo += env.bedding;
    this.clo = clo;
    this.windproof = windproof;
    const windEff = env.wind * (1 - windproof * 0.85);
    const Te = env.air + env.radiant;
    this.felt = G.weather.windChill(env.air, env.wind) + env.radiant;

    // metabolic heat
    let M = MET[this.activity];
    this.shiver = 0;
    if (this.core < 36.6 && this.kcal > 0 && !env.sleeping) {
      this.shiver = clamp((36.7 - this.core) * 150, 0, 200);
      M += this.shiver;
    }
    if (this.kcal <= 0) M *= 0.8;
    this.metabolic = M;

    // heat loss
    const vaso = clamp((36.8 - this.core) * 2, 0, 3);
    const Tskin = this.core - 3.5 - vaso;
    let loss: number;
    if (env.inWater) {
      // icy water: roughly 3–5 °C of core per hour (the "1-10-1" rule), cold shock aside
      const R = 0.09 + 0.02 * wornClo;
      loss = (1.8 * (Tskin - 0.5)) / R;
    } else {
      const Rair = 0.12 / (1 + 0.35 * windEff);
      let R = 0.155 * clo + Rair;
      if (env.sleeping && env.bedding < 0.3) R *= 0.8; // lying on bare floor/snow
      loss = ((1.8 * (Tskin - Te)) / R) * 0.9;
    }
    // breathing cold air
    loss += Math.max(0, 0.12 * M * ((30 - env.air) / 60));
    this.loss = loss;
    let net = M - loss;
    if (this.warmPending !== 0) {
      const w = Math.sign(this.warmPending) * Math.min(Math.abs(this.warmPending), dt * 400);
      this.warmPending -= w;
      net += w / dt;
    }
    this.core += (net * dt) / (70 * 3500);
    // thermoregulation: sweating sheds excess heat (and wets clothes)
    if (this.core > 37.05) {
      const excess = (this.core - 37.05) * 70 * 3500;
      this.core = 37.05;
      if (excess > 0 && !env.sleeping && this.activity !== 'idle') this.wetness = clamp(this.wetness + excess / (2.4e6 * 6), 0, 1);
    }

    // hands
    const gl = this.gloves(worn);
    const perf = clamp((this.core - 34.5) / 2.3, 0.08, 1);
    let teH = Te + env.radiant * 0.3;
    let kE = (1 / 600) * (1 + 0.12 * env.wind * (1 - gl.wind));
    let insul = 1 + 2.5 * gl.clo;
    if (env.handsWarming) {
      teH = this.core - 3;
      kE *= 2;
      insul = 1;
    }
    if (env.lampInHand) teH += 12;
    if (env.metalTool && gl.clo < 0.2 && env.air < 0) kE *= 1.35;
    if (env.inWater) {
      teH = 0.5;
      kE *= 6;
      insul = 1;
    }
    this.hands += (perf * (this.core - 2 - this.hands) / 900 + (kE * (teH - this.hands)) / insul) * dt;

    // feet
    const boots = worn.get('feet');
    const socks = worn.get('socks');
    const fClo = (boots?.def!.wear!.clo ?? 0) + (socks?.def!.wear!.clo ?? 0);
    const fWet = Math.max(this.feetWet, env.inWater ? 1 : 0);
    const fInsul = 1 + 2.2 * fClo * (1 - fWet * 0.6);
    let teF = env.air + env.radiant * 0.5;
    if (env.inWater) teF = 0.5;
    this.feet += (perf * (this.core - 3 - this.feet) / 1000 + (((1 / 700) * (env.inWater ? 6 : 1)) * (teF - this.feet)) / fInsul) * dt;
    if (env.outdoors && G.player?.moving && !env.inWater) {
      const sens = boots?.def!.wear!.wetSens ?? 1;
      const lowBoots = !boots || boots.defId === 'sneakers';
      if (lowBoots) this.feetWet = clamp(this.feetWet + (dt / 2400) * sens, 0, 1);
    }
    if (env.inWater) this.feetWet = 1;
    if (Te > 5) this.feetWet = clamp(this.feetWet - (dt * (Te - 5)) / (20 * 4000) * (1 + env.radiant / 5), 0, 1);

    // frostbite
    if (this.hands < -0.5) this.frostHands = clamp(this.frostHands + (dt * -this.hands) / 21600, 0, 1);
    if (this.feet < -0.5) this.frostFeet = clamp(this.frostFeet + (dt * -this.feet) / 25000, 0, 1);

    // dexterity
    let dex = clamp((this.hands - 2) / 18, 0.12, 1) * gl.dex * (1 - 0.5 * this.frostHands);
    if (this.core < 34) dex *= 0.7;
    this.dex = dex;

    // wetness: snow sticks to clothes outside and melts in the warm
    if (env.outdoors && env.snowfall > 0.05) this.snow = clamp(this.snow + (dt * env.snowfall) / 2400, 0, 1);
    if (env.inWater) {
      this.wetness = 1;
      this.snow = 0;
    }
    if (Te > 0 && this.snow > 0) {
      const melt = Math.min(this.snow, (dt * (Te / 10)) / 600);
      this.snow -= melt;
      this.wetness = clamp(this.wetness + melt * 0.45, 0, 1);
    }
    if (Te > 0 && !env.inWater) {
      const dry = clamp(1.15 - env.rh, 0.08, 1);
      this.wetness = clamp(this.wetness - ((dt * Te) / (20 * 5400)) * (1 + env.radiant / 4) * dry, 0, 1);
    } else if (!env.inWater) {
      this.wetness = clamp(this.wetness - dt / (3600 * 30), 0, 1); // sublimation
    }

    // needs
    this.kcal = Math.max(0, this.kcal - (M * dt) / 4184);
    this.water = Math.max(0, this.water - dt * (0.000024 + 0.00002 * Math.max(0, M / 100 - 1)));
    if (env.sleeping) this.fatigue = clamp(this.fatigue - dt / (7 * 3600), 0, 1);
    else this.fatigue = clamp(this.fatigue + (dt / (16 * 3600)) * (M > 300 ? 2.2 : 1), 0, 1);
    if (this.sick > 0) this.sick = Math.max(0, this.sick - dt / 3600);

    // condition
    let dmg = 0;
    if (this.core < 35) dmg += 6 * (35 - this.core) * (this.core < 32 ? 2 : 1);
    if (this.kcal <= 0) dmg += 3;
    if (this.water <= 0) dmg += 6;
    if (this.fatigue >= 1) dmg += 2;
    if (this.sick > 0) dmg += 2.5;
    dmg += (this.hands < -0.5 ? 4 : 0) + (this.feet < -0.5 ? 3 : 0);
    let heal = 0;
    if (this.core > 36 && this.kcal > 0 && this.water > 0 && this.fatigue < 0.95 && this.sick <= 0) heal = env.sleeping ? 4 : 1.2;
    this.condition = clamp(this.condition + ((heal - dmg) * dt) / 3600, 0, 100);

    this.halluc = clamp((34.6 - this.core) / 2.5, 0, 1) + (this.fatigue > 0.92 ? 0.3 : 0);

    if (this.core < 27.5 || this.condition <= 0) {
      G.dead = true;
      G.hud?.showDeath(this.core < 27.5 ? 'Переохлаждение' : this.causeOfDeath());
    }
    this.warnings();
  }

  private causeOfDeath() {
    if (this.water <= 0) return 'Обезвоживание';
    if (this.kcal <= 0) return 'Истощение';
    if (this.core < 34) return 'Переохлаждение';
    if (this.frostHands > 0.8 || this.frostFeet > 0.8) return 'Обморожение';
    return 'Силы кончились';
  }

  private warnOnce(key: string, cond: boolean, text: string, kind: 'warn' | 'bad' = 'warn') {
    if (cond && !this.warned.has(key)) {
      this.warned.add(key);
      msg(text, kind);
    } else if (!cond) this.warned.delete(key);
  }

  private warnings() {
    this.warnOnce('cold', this.core < 36.2, 'Вас пробирает холод. Найдите тепло.');
    this.warnOnce('hypo', this.core < 35, 'Переохлаждение! Срочно в тепло.', 'bad');
    this.warnOnce('hands', this.hands < 8, 'Пальцы немеют — греть руки: зажать [H]');
    this.warnOnce('frost', this.frostHands > 0.05, 'Обморожение пальцев!', 'bad');
    this.warnOnce('feet', this.feet < 5, 'Ноги коченеют', 'warn');
    this.warnOnce('wet', this.wetness > 0.4, 'Одежда промокла и почти не греет');
    this.warnOnce('hungry', this.kcal < 300, 'Вы голодны');
    this.warnOnce('thirst', this.water < 0.3, 'Хочется пить');
    this.warnOnce('tired', this.fatigue > 0.85, 'Вы валитесь с ног от усталости');
  }

  /** Drink something at temperature T, volume V litres. */
  drink(V: number, T: number) {
    this.water = clamp(this.water + V, 0, 3);
    this.warmPending += V * 4186 * (T - 37) * (T > 37 ? 1.6 : 1);
  }

  eatSnow() {
    this.water = clamp(this.water + 0.08, 0, 3);
    this.warmPending -= 0.1 * (334000 + 4186 * 37);
  }

  statusList(): { text: string; kind: 'ok' | 'warn' | 'bad' }[] {
    const s: { text: string; kind: 'ok' | 'warn' | 'bad' }[] = [];
    if (this.core < 35) s.push({ text: 'Переохлаждение', kind: 'bad' });
    else if (this.core < 36.3) s.push({ text: 'Замерзаете', kind: 'warn' });
    if (this.shiver > 30) s.push({ text: 'Дрожь', kind: 'warn' });
    if (this.frostHands > 0.02) s.push({ text: `Обморожены пальцы ${Math.round(this.frostHands * 100)}%`, kind: 'bad' });
    if (this.frostFeet > 0.02) s.push({ text: `Обморожены ноги ${Math.round(this.frostFeet * 100)}%`, kind: 'bad' });
    if (this.wetness > 0.25) s.push({ text: `Мокрая одежда ${Math.round(this.wetness * 100)}%`, kind: this.wetness > 0.6 ? 'bad' : 'warn' });
    if (this.feetWet > 0.3) s.push({ text: 'Мокрые ноги', kind: 'warn' });
    if (this.snow > 0.2) s.push({ text: 'Одежда в снегу — отряхнуться [X]', kind: 'warn' });
    if (this.sick > 0) s.push({ text: 'Расстройство желудка', kind: 'bad' });
    if (this.halluc > 0.3) s.push({ text: 'Мутится сознание', kind: 'bad' });
    return s;
  }
}
