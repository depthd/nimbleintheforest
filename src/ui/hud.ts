// DOM overlay: status, target prompts, messages, inventory, sleep dialog,
// debug/parameters panel, pause and death screens.
import * as THREE from 'three';
import { G, dayOf, hourOf, msg } from '../game/ctx';
import { def, ITEMS, SLOT_NAMES, Slot } from '../game/items';
import type { Entity } from '../game/entities';
import { WEATHER_NAMES, WeatherType } from '../world/weather';
import { clamp } from '../core/rng';
import { Tex } from '../core/textures';

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const KEY_LABEL: Record<string, string> = { E: 'E', F: 'F', G: 'G', LMB: 'ЛКМ', RMB: 'ПКМ' };

function fmtTemp(t: number) {
  return `${t > 0 ? '+' : ''}${t.toFixed(t > -10 && t < 10 ? 1 : 0)}°C`;
}

function fmtTime(t: number) {
  const h = hourOf(t);
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export class HUD {
  root: HTMLElement;
  private msgs: HTMLElement;
  private prompt: HTMLElement;
  private info: HTMLElement;
  private status: HTMLElement;
  private env: HTMLElement;
  private hands: HTMLElement;
  private hotbar: HTMLElement;
  private progress: HTMLElement;
  private cross: HTMLElement;
  private frost: HTMLElement;
  private vignette: HTMLElement;
  private flashEl: HTMLElement;
  private inv: HTMLElement;
  private debug: HTMLElement;
  private sleepEl: HTMLElement;
  private help: HTMLElement;
  private pause: HTMLElement;
  private death: HTMLElement;
  invOpen = false;
  debugOpen = false;
  helpOpen = false;
  sleepOpen = false;
  private tick = 0;
  private sleepPlan: { hours: number; mode: 'bed' | 'floor' | 'wait'; bed?: Entity; left: number; woke?: string } | null = null;
  private lastMsg = '';

  constructor() {
    this.root = $('#hud');
    this.msgs = $('#msgs');
    this.prompt = $('#prompt');
    this.info = $('#target-info');
    this.status = $('#status');
    this.env = $('#env');
    this.hands = $('#hands');
    this.hotbar = $('#hotbar');
    this.progress = $('#progress');
    this.cross = $('#crosshair');
    this.frost = $('#frost');
    this.vignette = $('#vignette');
    this.flashEl = $('#flash');
    this.inv = $('#inventory');
    this.debug = $('#debug');
    this.sleepEl = $('#sleep');
    this.help = $('#help');
    this.pause = $('#pause');
    this.death = $('#death');
    const frostTex = Tex.frost();
    this.frost.style.backgroundImage = `url(${(frostTex.image as HTMLCanvasElement).toDataURL()})`;
    this.root.style.display = 'block';
    this.inv.addEventListener('click', (e) => this.onInvClick(e));
    this.debug.addEventListener('input', (e) => this.onDebugInput(e));
    this.debug.addEventListener('click', (e) => this.onDebugClick(e));
    this.sleepEl.addEventListener('click', (e) => this.onSleepClick(e));
    this.sleepEl.addEventListener('input', () => this.renderSleepInfo());
    $('#pause-continue').addEventListener('click', () => this.resume());
    this.pause.addEventListener('click', (e) => {
      if (e.target === this.pause || (e.target as HTMLElement).tagName !== 'BUTTON') this.resume();
    });
    $('#pause-help').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHelp(true);
    });
    $('#pause-new').addEventListener('click', (e) => {
      e.stopPropagation();
      this.newWorld();
    });
    $('#death-restart').addEventListener('click', () => location.reload());
    $('#death-new').addEventListener('click', () => this.newWorld());
    $('#help-close').addEventListener('click', () => this.toggleHelp(false));
  }

  newWorld() {
    const u = new URL(location.href);
    u.searchParams.set('seed', String(Math.floor(Math.random() * 1e6)));
    u.searchParams.set('autostart', '1');
    location.href = u.toString();
  }

  get modal() {
    return this.invOpen || this.sleepOpen || this.helpOpen || G.dead;
  }

  message(text: string, kind: 'info' | 'warn' | 'good' | 'bad' = 'info') {
    if (text === this.lastMsg && this.msgs.lastElementChild) {
      const last = this.msgs.lastElementChild as HTMLElement;
      const n = Number(last.dataset.n ?? '1') + 1;
      last.dataset.n = String(n);
      last.textContent = `${text} ×${n}`;
      last.style.animation = 'none';
      void last.offsetWidth;
      last.style.animation = '';
      return;
    }
    this.lastMsg = text;
    const d = document.createElement('div');
    d.className = `msg ${kind}`;
    d.textContent = text;
    this.msgs.appendChild(d);
    while (this.msgs.children.length > 6) this.msgs.firstElementChild!.remove();
    setTimeout(() => d.remove(), 7000);
  }

  flash(kind: 'bad' | 'good') {
    this.flashEl.className = kind;
    this.flashEl.style.opacity = '0.5';
    setTimeout(() => (this.flashEl.style.opacity = '0'), 120);
  }

  // ---------- modals ----------

  toggleInventory(open?: boolean) {
    this.invOpen = open ?? !this.invOpen;
    this.inv.style.display = this.invOpen ? 'flex' : 'none';
    if (this.invOpen) this.renderInventory();
    this.syncInput();
  }

  toggleDebug() {
    this.debugOpen = !this.debugOpen;
    this.debug.style.display = this.debugOpen ? 'block' : 'none';
    if (this.debugOpen) this.renderDebug(true);
  }

  toggleHelp(open?: boolean) {
    this.helpOpen = open ?? !this.helpOpen;
    this.help.style.display = this.helpOpen ? 'block' : 'none';
    if (this.helpOpen) this.pause.style.display = 'none';
    this.syncInput();
  }

  private syncInput() {
    const m = this.modal;
    G.input.enabled = !m;
    if (m) {
      G.input.unlock();
      this.pause.style.display = 'none';
    } else if (!G.input.locked) {
      // closing a dialog with a key press counts as a user gesture: grab the mouse again
      G.input.lock();
      setTimeout(() => {
        if (!G.input.locked && !this.modal) this.showPause(true);
      }, 250);
    }
  }

  showPause(show: boolean) {
    if (G.dead) return;
    this.pause.style.display = show && !this.modal ? 'flex' : 'none';
  }

  resume() {
    this.pause.style.display = 'none';
    G.audio.start();
    G.input.lock();
  }

  showDeath(cause: string) {
    this.death.style.display = 'flex';
    const days = (G.time - G.startTime) / 86400;
    $('#death-cause').textContent = cause;
    $('#death-stats').textContent = `Вы продержались ${days >= 1 ? days.toFixed(1) + ' дн.' : Math.round(days * 24) + ' ч'}`;
    G.input.unlock();
    G.input.enabled = false;
  }

  // ---------- sleep / wait ----------

  openSleep(mode: 'bed' | 'floor' | 'wait', bed?: Entity) {
    if (G.player.water) return;
    this.sleepOpen = true;
    this.sleepEl.style.display = 'block';
    this.sleepEl.dataset.mode = mode;
    $('#sleep-title').textContent = mode === 'bed' ? 'Сон в кровати' : mode === 'floor' ? 'Сон на полу / земле' : 'Ждать';
    (this.sleepEl.querySelector('#sleep-go') as HTMLElement).textContent = mode === 'wait' ? 'Ждать' : 'Спать';
    this.sleepPlan = { hours: 0, mode, bed, left: 0 };
    this.renderSleepInfo();
    this.syncInput();
  }

  private bedding(mode: string, bed?: Entity) {
    if (mode === 'bed' && bed) {
      let b = bed.def!.bedding ?? 0.8;
      for (const x of bed.data.blankets ?? []) b += x.def!.insul ?? 1;
      return b;
    }
    if (mode === 'wait') return 0;
    // floor: boughs/mattress nearby
    let b = 0;
    for (const e of G.entities.near(G.player.pos, 1.3, (x) => !!x.def?.bedding && x.defId !== 'bed')) b += e.def!.bedding!;
    if (G.house.zoneAt(G.player.pos)) b += 0.15;
    return Math.min(1.4, b);
  }

  private renderSleepInfo() {
    const plan = this.sleepPlan;
    if (!plan) return;
    const range = this.sleepEl.querySelector('#sleep-hours') as HTMLInputElement;
    const h = Number(range.value);
    $('#sleep-h').textContent = `${h} ч`;
    const b = this.bedding(plan.mode, plan.bed);
    const z = G.house.zoneAt(G.player.pos);
    const air = z ? G.thermal.zone(z).T : G.weather.temp;
    const clo = G.body.wornClo(G.player.worn).clo + (G.player.wrapped?.def?.insul ?? 0);
    const warmth = clo + b;
    // rough rule: how cold can you sleep at this insulation
    const limit = 22 - warmth * 9;
    let verdict = '';
    if (plan.mode !== 'wait') verdict = air > limit + 6 ? 'Тепло — выспитесь' : air > limit ? 'Прохладно, но терпимо' : air > limit - 8 ? 'Холодно — вероятно, проснётесь от холода' : 'Опасно: можно не проснуться';
    $('#sleep-info').innerHTML = `Воздух: <b>${fmtTemp(air)}</b> · одежда ${clo.toFixed(1)} кло · постель ${b.toFixed(1)} кло<br>${verdict}`;
  }

  private onSleepClick(ev: MouseEvent) {
    const t = ev.target as HTMLElement;
    if (t.id === 'sleep-cancel') this.closeSleep();
    if (t.id === 'sleep-go') {
      const plan = this.sleepPlan!;
      plan.hours = Number((this.sleepEl.querySelector('#sleep-hours') as HTMLInputElement).value);
      plan.left = plan.hours * 3600;
      this.sleepEl.style.display = 'none';
      this.sleepOpen = false;
      G.sleeping = true;
      $('#sleep-overlay').style.display = 'flex';
      $('#sleep-overlay-text').textContent = plan.mode === 'wait' ? 'Время идёт…' : 'Вы спите…';
      G.input.enabled = false;
    }
  }

  private closeSleep() {
    this.sleepEl.style.display = 'none';
    this.sleepOpen = false;
    this.sleepPlan = null;
    this.syncInput();
  }

  /** Called by the game loop while sleeping; returns game seconds to advance. */
  sleepStep(dtReal: number): number {
    const plan = this.sleepPlan;
    if (!plan || !G.sleeping) return 0;
    const speed = 2400;
    const dt = Math.min(plan.left, dtReal * speed);
    plan.left -= dt;
    const B = G.body;
    let wake = '';
    if (plan.mode !== 'wait' && B.core < 35.6) wake = 'Вы проснулись от холода, дрожа';
    if (plan.mode !== 'wait' && B.fatigue <= 0.001 && plan.left > 0) wake = 'Вы выспались';
    if (B.water < 0.05) wake = 'Вас мучает жажда';
    if (plan.left <= 0 && !wake) wake = plan.mode === 'wait' ? '' : 'Вы проснулись';
    if (wake || plan.left <= 0) {
      G.sleeping = false;
      $('#sleep-overlay').style.display = 'none';
      if (wake) msg(wake, B.core < 35.6 ? 'warn' : 'info');
      this.sleepPlan = null;
      G.input.enabled = !this.modal;
      if (!G.input.locked) this.showPause(true);
    }
    return dt;
  }

  sleepEnv() {
    const plan = this.sleepPlan;
    if (!plan || !G.sleeping || plan.mode === 'wait') return { sleeping: false, bedding: 0 };
    return { sleeping: true, bedding: this.bedding(plan.mode, plan.bed) };
  }

  // ---------- inventory ----------

  private renderInventory() {
    const P = G.player;
    const groups = new Map<string, Entity[]>();
    for (const e of P.inventory) {
      if (P.isWorn(e)) continue;
      const wet = e.def?.fuel && e.moisture > 0.3 ? 'w' : '';
      const k = e.contents || e.charges ? `${e.defId}#${e.id}` : e.defId + wet;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(e);
    }
    const nearFire = G.fires.list.find((f) => f.pos.distanceTo(P.pos) < 2.8);
    const rows: string[] = [];
    for (const [, list] of groups) {
      const e = list[0];
      const d = e.def!;
      const btn = (act: string, label: string) => `<button data-act="${act}" data-id="${e.id}">${label}</button>`;
      const b: string[] = [];
      if (d.tool || d.food || d.cook) b.push(btn('equip', P.equipped === e ? 'Убрать из руки' : 'В руку'));
      if (d.wear) b.push(btn('wear', 'Надеть'));
      if (d.food) b.push(btn('eat', 'Съесть'));
      if (e.contents && e.contents.water > 0.05) b.push(btn('drink', 'Пить'));
      if (e.contents && e.contents.water > 0.1 && e.contents.temp >= 80 && !e.contents.tea && P.has((x) => x.defId === 'tea')) b.push(btn('tea', 'Заварить чай'));
      if (e.contents && (e.contents.water > 0 || e.contents.snow > 0)) b.push(btn('pour', 'Вылить'));
      if (e.defId === 'kerosene' && P.has((x) => x.defId === 'lamp')) b.push(btn('refill', 'Заправить лампу'));
      if (d.tearInto) b.push(btn('tear', 'Порвать'));
      if (d.fuel && nearFire) b.push(btn('burn', 'В огонь'));
      b.push(btn('carry', 'В руки'));
      b.push(btn('drop', 'Выбросить'));
      const n = list.length > 1 ? ` <span class="count">×${list.length}</span>` : '';
      const w = list.reduce((s, x) => s + x.mass, 0);
      const desc = d.desc ? `<div class="desc">${d.desc}</div>` : '';
      rows.push(`<div class="row${P.equipped === e ? ' eq' : ''}"><div class="name">${e.displayName()}${n}${desc}</div><div class="w">${w < 1 ? Math.round(w * 1000) + ' г' : w.toFixed(1) + ' кг'}</div><div class="btns">${b.join('')}</div></div>`);
    }
    const slots = (Object.keys(SLOT_NAMES) as Slot[]).map((s) => {
      const e = P.worn.get(s);
      const extra = e ? ` <button data-act="unwear" data-id="${e.id}">Снять</button>` : '';
      return `<div class="slot"><span>${SLOT_NAMES[s]}</span><b>${e ? e.name : '—'}</b>${extra}</div>`;
    });
    if (P.wrapped) slots.push(`<div class="slot"><span>На плечах</span><b>${P.wrapped.name}</b> <button data-act="unwrap" data-id="0">Снять</button></div>`);
    const { clo, windproof } = G.body.wornClo(P.worn);
    const pw = P.packWeight();
    this.inv.innerHTML = `
      <div class="inv-col">
        <h2>Рюкзак <small>${pw.toFixed(1)} / 40 кг${pw > 18 ? ' · тяжело' : ''}</small></h2>
        <div class="list">${rows.join('') || '<div class="empty">Пусто</div>'}</div>
      </div>
      <div class="inv-col side">
        <h2>Одежда <small>${clo.toFixed(2)} кло · ветрозащита ${Math.round(windproof * 100)}%</small></h2>
        ${slots.join('')}
        <p class="hint">Кло — единица теплоизоляции. Мокрая одежда греет хуже. Варежки теплее перчаток, но в них не зажечь спичку.</p>
        <button class="close" data-act="close" data-id="0">Закрыть [Tab]</button>
      </div>`;
  }

  private onInvClick(ev: MouseEvent) {
    const t = ev.target as HTMLElement;
    const act = t.dataset.act;
    if (!act) return;
    const P = G.player;
    const id = Number(t.dataset.id);
    const e = P.inventory.find((x) => x.id === id) ?? null;
    switch (act) {
      case 'close':
        this.toggleInventory(false);
        return;
      case 'unwrap':
        G.interact.unwrap();
        this.toggleInventory(false);
        return;
    }
    if (!e) return;
    switch (act) {
      case 'equip':
        P.equip(e);
        break;
      case 'wear':
        P.wear(e);
        break;
      case 'unwear':
        P.unwear(e);
        break;
      case 'eat':
        P.equip(e);
        this.toggleInventory(false);
        G.interact.actions.find((a) => a.key === 'LMB')?.run();
        return;
      case 'drink': {
        const c = e.contents!;
        if (c.temp > 75) msg('Слишком горячо', 'warn');
        else {
          const v = Math.min(0.4, c.water);
          c.water -= v;
          G.body.drink(v, c.temp);
          G.audio.play('drink');
          if (c.dirty && !c.boiled && Math.random() < 0.35) {
            G.body.sick = 6;
            msg('Сырая вода из озера… живот крутит.', 'bad');
          } else msg(c.tea ? 'Горячий чай греет изнутри' : `Выпили ${v.toFixed(1)} л`, 'good');
        }
        break;
      }
      case 'tea': {
        const tea = P.has((x) => x.defId === 'tea')!;
        G.entities.destroy(tea);
        e.contents!.tea = true;
        msg('Чай заварен', 'good');
        break;
      }
      case 'pour':
        e.contents!.water = 0;
        e.contents!.snow = 0;
        break;
      case 'refill': {
        const lamp = P.has((x) => x.defId === 'lamp')!;
        const need = 100 - lamp.charges;
        const take = Math.min(need, e.charges);
        lamp.charges += take;
        e.charges -= take;
        msg(`Лампа заправлена (${Math.round(lamp.charges)}%)`, 'good');
        if (e.charges <= 0) G.entities.destroy(e);
        break;
      }
      case 'tear': {
        const y = e.def!.tearInto!;
        G.entities.destroy(e);
        for (const q of y) for (let i = 0; i < q.n; i++) {
          const it = G.entities.spawnItem(q.id, P.eyePos);
          P.addToInventory(it);
        }
        G.audio.play('tear');
        break;
      }
      case 'burn': {
        const f = G.fires.list.find((x) => x.pos.distanceTo(P.pos) < 2.8);
        if (f) {
          P.forget(e);
          const err = G.fires.addFuel(f, e);
          if (err) {
            msg(err, 'warn');
            P.addToInventory(e);
          }
        }
        break;
      }
      case 'carry':
        P.carry(e);
        this.toggleInventory(false);
        return;
      case 'drop':
        P.dropFromInventory(e);
        break;
    }
    this.renderInventory();
  }

  // ---------- debug ----------

  private renderDebug(full = false) {
    if (!this.debugOpen) return;
    const S = G.settings;
    if (full || !this.debug.querySelector('#dbg-live')) {
      const opts = Object.keys(ITEMS).map((k) => `<option value="${k}">${ITEMS[k].name}</option>`).join('');
      const wopts = ['auto', ...Object.keys(WEATHER_NAMES)].map((k) => `<option value="${k}" ${(S.weatherLock ?? 'auto') === k ? 'selected' : ''}>${k === 'auto' ? 'Авто' : WEATHER_NAMES[k as WeatherType]}</option>`).join('');
      this.debug.innerHTML = `
        <h3>Параметры мира <small>F3</small></h3>
        <label>Средняя температура <b id="dbg-bt">${S.baseTemp}°C</b><input type="range" id="dbg-base" min="-40" max="0" step="1" value="${S.baseTemp}"></label>
        <label>Скорость времени <b id="dbg-ts">×${S.timeScale}</b><input type="range" id="dbg-scale" min="1" max="120" step="1" value="${S.timeScale}"></label>
        <label>Погода <select id="dbg-weather">${wopts}</select></label>
        <div class="row2"><button data-dbg="h1">+1 час</button><button data-dbg="h6">+6 ч</button><button data-dbg="night">→ ночь</button><button data-dbg="day">→ утро</button></div>
        <label class="chk"><input type="checkbox" id="dbg-nocold" ${S.noCold ? 'checked' : ''}> Без холода (тест)</label>
        <label class="chk"><input type="checkbox" id="dbg-horror" ${S.horror ? 'checked' : ''}> Жуть по ночам</label>
        <div class="row2"><select id="dbg-item">${opts}</select><button data-dbg="spawn">Создать</button></div>
        <div class="row2"><button data-dbg="tp-house">К дому</button><button data-dbg="tp-lake">К озеру</button><button data-dbg="tp-forest">В лес</button><button data-dbg="heal">Вылечить</button></div>
        <div id="dbg-live"></div>`;
    }
    const live = this.debug.querySelector('#dbg-live') as HTMLElement;
    const B = G.body;
    const zrows = (['ground', 'upper'] as const).map((n) => {
      const z = G.thermal.zone(n);
      const parts = z.parts.map((p) => `<tr><td>${p.label}</td><td>${p.ua.toFixed(0)} Вт/К</td><td>${((p.ua * (z.T - G.weather.temp)) / 1000).toFixed(2)} кВт</td></tr>`).join('');
      return `<h4>${n === 'ground' ? '1 этаж' : '2 этаж'}: ${fmtTemp(z.T)} <small>→ равновесие ${fmtTemp(G.thermal.equilibrium(n))}</small></h4>
        <table>${parts}<tr class="sum"><td>Приток тепла</td><td></td><td>${(z.heatW / 1000).toFixed(2)} кВт</td></tr><tr class="sum"><td>Потери</td><td>${z.ua.toFixed(0)} Вт/К</td><td>${(z.lossW / 1000).toFixed(2)} кВт</td></tr></table>`;
    }).join('');
    const fires = G.fires.list.map((f) => `<div>${G.fires.describe(f)}<br><small>${f.fuel.map((x) => `${x.name}${x.burning ? '🔥' : ''}${x.moisture > 0.3 ? '💧' : ''} ${Math.round(x.remaining / 60)}м`).join(', ') || '—'} · угли ${Math.round(f.embers * 100)}%</small></div>`).join('');
    live.innerHTML = `
      <h4>Тело</h4>
      <table>
        <tr><td>Ядро</td><td>${B.core.toFixed(2)}°C</td><td>Руки ${B.hands.toFixed(1)}° · ноги ${B.feet.toFixed(1)}°</td></tr>
        <tr><td>Одежда</td><td>${B.clo.toFixed(2)} кло</td><td>ветрозащита ${Math.round(B.windproof * 100)}%</td></tr>
        <tr><td>Тепло</td><td>+${B.metabolic.toFixed(0)} Вт</td><td>−${B.loss.toFixed(0)} Вт (дрожь ${B.shiver.toFixed(0)})</td></tr>
        <tr><td>Ловкость</td><td>${Math.round(B.dex * 100)}%</td><td>ощущается ${fmtTemp(B.felt)}</td></tr>
        <tr><td>Еда / вода</td><td>${Math.round(B.kcal)} ккал</td><td>${B.water.toFixed(2)} л</td></tr>
        <tr><td>Усталость</td><td>${Math.round(B.fatigue * 100)}%</td><td>сырость ${Math.round(B.wetness * 100)}% · снег ${Math.round(B.snow * 100)}%</td></tr>
        <tr><td>Состояние</td><td>${B.condition.toFixed(1)}%</td><td>обморож. ${Math.round(B.frostHands * 100)}/${Math.round(B.frostFeet * 100)}%</td></tr>
      </table>
      <h4>Улица: ${fmtTemp(G.weather.temp)} · ветер ${G.weather.wind.toFixed(1)} м/с · ${WEATHER_NAMES[G.weather.type]}</h4>
      ${zrows}
      <h4>Огонь</h4>${fires}`;
  }

  private onDebugInput(ev: Event) {
    const t = ev.target as HTMLInputElement;
    const S = G.settings;
    if (t.id === 'dbg-base') {
      S.baseTemp = Number(t.value);
      $('#dbg-bt').textContent = `${S.baseTemp}°C`;
    }
    if (t.id === 'dbg-scale') {
      S.timeScale = Number(t.value);
      $('#dbg-ts').textContent = `×${S.timeScale}`;
    }
    if (t.id === 'dbg-weather') S.weatherLock = t.value === 'auto' ? null : t.value;
    if (t.id === 'dbg-nocold') S.noCold = t.checked;
    if (t.id === 'dbg-horror') S.horror = t.checked;
  }

  private onDebugClick(ev: MouseEvent) {
    const t = ev.target as HTMLElement;
    const a = t.dataset.dbg;
    if (!a) return;
    const P = G.player;
    switch (a) {
      case 'h1':
        G.skip(3600);
        break;
      case 'h6':
        G.skip(6 * 3600);
        break;
      case 'night': {
        const h = hourOf(G.time);
        G.skip(((22 - h + 24) % 24) * 3600);
        break;
      }
      case 'day': {
        const h = hourOf(G.time);
        G.skip(((8.5 - h + 24) % 24) * 3600);
        break;
      }
      case 'spawn': {
        const id = (this.debug.querySelector('#dbg-item') as HTMLSelectElement).value;
        const p = P.eyePos.add(P.forward().multiplyScalar(1.2));
        G.entities.spawnItem(id, p, { charges: def(id).charges });
        break;
      }
      case 'tp-house':
        P.teleport(new THREE.Vector3(1.5, G.house.Y0 + 0.05, 2));
        break;
      case 'tp-lake': {
        const L = G.terrain.lake;
        P.teleport(new THREE.Vector3(L.cx - L.rx * 0.3, G.lake.level + 0.05, L.cz));
        break;
      }
      case 'tp-forest': {
        const tr = G.forest.trees.find((x) => x.alive && Math.hypot(x.x, x.z) > 30)!;
        P.teleport(new THREE.Vector3(tr.x + 2, G.terrain.heightAt(tr.x + 2, tr.z) + 0.1, tr.z));
        break;
      }
      case 'heal': {
        const B = G.body;
        B.core = 37;
        B.hands = 32;
        B.feet = 30;
        B.condition = 100;
        B.kcal = 2500;
        B.water = 2.5;
        B.fatigue = 0;
        B.wetness = 0;
        B.frostHands = B.frostFeet = 0;
        break;
      }
    }
  }

  // ---------- per frame ----------

  update(dt: number) {
    const I = G.interact;
    // prompts every frame (cheap)
    const P = G.player;
    const lines: string[] = [];
    for (const a of I.actions) lines.push(`<div class="act"><span class="key">${KEY_LABEL[a.key]}</span>${a.label}${a.time ? ' <span class="t">⏱</span>' : ''}</div>`);
    if (P.carried) {
      lines.push(`<div class="act dim"><span class="key">E/Q</span>положить <span class="key">ПКМ</span>бросить <span class="key">R</span>повернуть <span class="key">колесо</span>ближе/дальше</div>`);
    }
    if (I.fishing) lines.unshift(`<div class="act"><span class="key">ЛКМ</span>${I.fishing.bite > 0 ? '<b>КЛЮЁТ! Подсекай!</b>' : 'Рыбалка… ждите поклёвки'}</div>`);
    const html = lines.join('');
    if (this.prompt.dataset.h !== html) {
      this.prompt.innerHTML = html;
      this.prompt.dataset.h = html;
    }
    if (this.info.textContent !== I.info) this.info.textContent = I.info;
    const prog = I.timedProgress();
    this.progress.style.display = prog >= 0 ? 'block' : 'none';
    if (prog >= 0) (this.progress.firstElementChild as HTMLElement).style.width = `${Math.round(prog * 100)}%`;
    this.cross.className = I.actions.length ? 'active' : '';

    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = 0.12;
    this.renderStatus();
    this.renderEnv();
    this.renderHands();
    this.renderEffects();
    if (this.debugOpen) this.renderDebug();
    if (this.sleepOpen) this.renderSleepInfo();
  }

  private bar(label: string, frac: number, text: string, kind: string) {
    return `<div class="bar ${kind}"><span class="l">${label}</span><span class="track"><span class="fill" style="width:${Math.round(clamp(frac, 0, 1) * 100)}%"></span></span><span class="v">${text}</span></div>`;
  }

  private renderStatus() {
    const B = G.body;
    const k = (v: number, warn: number, bad: number, inv = false) => (inv ? (v > bad ? 'bad' : v > warn ? 'warn' : 'ok') : v < bad ? 'bad' : v < warn ? 'warn' : 'ok');
    const html =
      this.bar('Тело', (B.core - 32) / 5.2, `${B.core.toFixed(1)}°`, k(B.core, 36.2, 35)) +
      this.bar('Руки', (B.hands + 5) / 37, `${B.hands.toFixed(0)}°`, k(B.hands, 12, 3)) +
      this.bar('Ноги', (B.feet + 5) / 35, `${B.feet.toFixed(0)}°`, k(B.feet, 10, 2)) +
      this.bar('Сытость', B.kcal / 3000, `${Math.round(B.kcal)} ккал`, k(B.kcal, 500, 150)) +
      this.bar('Вода', B.water / 3, `${B.water.toFixed(1)} л`, k(B.water, 0.6, 0.2)) +
      this.bar('Бодрость', 1 - B.fatigue, `${Math.round((1 - B.fatigue) * 100)}%`, k(1 - B.fatigue, 0.25, 0.1)) +
      this.bar('Выносл.', G.player.stamina, '', k(G.player.stamina, 0.3, 0.1)) +
      this.bar('Состояние', B.condition / 100, `${Math.round(B.condition)}%`, k(B.condition, 50, 25)) +
      `<div class="flags">${B.statusList().map((s) => `<span class="${s.kind}">${s.text}</span>`).join('')}</div>`;
    this.status.innerHTML = html;
  }

  private renderEnv() {
    const P = G.player;
    const z = G.house.zoneAt(P.pos);
    const W = G.weather;
    const loc = z ? `Дом, ${z === 'ground' ? '1 этаж' : '2 этаж'}: <b>${fmtTemp(G.thermal.zone(z).T)}</b>` : G.lake.onIce(P.pos) ? 'На льду озера' : Math.hypot(P.pos.x, P.pos.z) < 14 ? 'Двор' : 'Лес';
    this.env.innerHTML = `
      <div class="time">День ${dayOf(G.time)} · ${fmtTime(G.time)}</div>
      <div>${WEATHER_NAMES[W.type]} · ${fmtTemp(W.temp)} · ветер ${W.wind.toFixed(0)} м/с</div>
      <div>Ощущается: <b>${fmtTemp(G.body.felt)}</b></div>
      <div class="loc">${loc}</div>`;
  }

  private renderHands() {
    const P = G.player;
    const parts: string[] = [];
    if (P.carried) parts.push(`В руках: <b>${P.carried.displayName()}</b> (${P.carried.mass.toFixed(1)} кг)${P.dragging ? ' — волоком' : ''}`);
    else if (P.equipped) parts.push(`В руке: <b>${P.equipped.displayName()}</b>${G.interact.flame ? ' 🔥' : ''}${P.equipped.lit ? ' (горит)' : ''}`);
    if (P.wrapped) parts.push(`На плечах: ${P.wrapped.name}`);
    this.hands.innerHTML = parts.join('<br>');
    // hotbar: tools in inventory
    const tools = this.hotbarItems();
    const html = tools.map((e, i) => `<div class="hb${P.equipped === e ? ' on' : ''}"><span>${i + 1}</span>${e.name}</div>`).join('');
    if (this.hotbar.dataset.h !== html) {
      this.hotbar.innerHTML = html;
      this.hotbar.dataset.h = html;
    }
  }

  hotbarItems(): Entity[] {
    const P = G.player;
    const seen = new Set<string>();
    const out: Entity[] = [];
    for (const e of P.inventory) {
      if (!e.def?.tool || P.isWorn(e)) continue;
      if (seen.has(e.defId)) continue;
      seen.add(e.defId);
      out.push(e);
      if (out.length >= 9) break;
    }
    return out;
  }

  private renderEffects() {
    const B = G.body;
    const cold = clamp((36.6 - B.core) / 2.5, 0, 1);
    const felt = clamp((-10 - B.felt) / 30, 0, 1);
    this.frost.style.opacity = String(Math.max(cold * 0.9, felt * 0.35, B.hands < 5 ? 0.25 : 0));
    const lowCond = clamp((50 - B.condition) / 50, 0, 1);
    this.vignette.style.opacity = String(Math.max(lowCond * 0.8, B.halluc * 0.6, G.player.water ? 0.6 : 0));
    const blur = B.halluc > 0.2 ? (B.halluc * 2.2).toFixed(1) : '0';
    const canvas = G.renderer.domElement;
    const f = blur !== '0' ? `blur(${blur}px) saturate(${1 - B.halluc * 0.6})` : '';
    if (canvas.style.filter !== f) canvas.style.filter = f;
  }
}
