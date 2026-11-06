import { renderRegionMap, mapXY } from './map';
import { NOTES, NOTE_KEYS, NEWSPAPERS, BOOKS } from '../game/lore';
import { itemIcon } from './icons';
import { woodOf } from '../game/wood/wood';
import { pieceSize, stacksByWeight } from '../game/wood/piece';

const STACK_NAMES: Record<string, string> = { sticks: 'Хворост', boughs: 'Лапник', firewood: 'Дрова', kindling: 'Щепа' };
import { BIOME_NAMES } from '../gen/biomes';
// DOM overlay: status, target prompts, messages, inventory, sleep dialog,
// debug/parameters panel, pause and death screens.
import * as THREE from 'three';
import { G, dayOf, hourOf, msg } from '../game/ctx';
import { def, ITEMS, SLOT_NAMES, Slot } from '../game/items';
import type { Entity } from '../game/entities';
import { WEATHER_NAMES, WeatherType } from '../world/weather';
import { clamp } from '../core/rng';
import { Tex } from '../core/textures';
import { PerformanceMonitor } from './performance';

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const KEY_LABEL: Record<string, string> = { E: 'E', F: 'F', G: 'G', LMB: 'ЛКМ', RMB: 'ПКМ' };
const OVERLAY_NAMES: Record<string, string> = { off: 'Выкл', temp: 'Температура', rh: 'Влажность', draft: 'Сквозняк' };
const OVERLAY_ORDER = ['off', 'temp', 'rh', 'draft'] as const;

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
  readonly performance: PerformanceMonitor;
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
  readerOpen = false;
  mapOpen = false;
  private mapBase: HTMLCanvasElement | null = null;
  private mapFog: HTMLCanvasElement | null = null;
  private fogTick = 0;
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
    this.performance = new PerformanceMonitor(this.root);
    this.performance.onChange = enabled => {
      const checkbox = this.debug.querySelector<HTMLInputElement>('#dbg-performance');
      if (checkbox) checkbox.checked = enabled;
    };
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
    $('#reader-close').addEventListener('click', () => this.closeReader());
  }

  newWorld() {
    const u = new URL(location.href);
    u.searchParams.set('seed', String(Math.floor(Math.random() * 1e6)));
    u.searchParams.set('autostart', '1');
    location.href = u.toString();
  }

  get modal() {
    return this.invOpen || this.sleepOpen || this.helpOpen || this.readerOpen || this.mapOpen || G.dead;
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

  // ---------- map ----------

  /** reveal the map around where the player has been */
  updateFog(dt: number) {
    this.fogTick -= dt;
    if (this.fogTick > 0) return;
    this.fogTick = 1;
    const R = G.region;
    if (!this.mapFog) {
      this.mapFog = document.createElement('canvas');
      this.mapFog.width = this.mapFog.height = 300;
    }
    const c = this.mapFog.getContext('2d')!;
    const P = G.player.pos;
    const k = 300 / R.size;
    const high = Math.max(0, P.y - G.terrain.heightAt(P.x, P.z)) + Math.max(0, P.y - 40) * 0.5;
    const r = (170 + Math.min(400, high * 6)) * k;
    const g = c.createRadialGradient((P.x - R.minX) * k, (P.z - R.minZ) * k, r * 0.5, (P.x - R.minX) * k, (P.z - R.minZ) * k, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc((P.x - R.minX) * k, (P.z - R.minZ) * k, r, 0, Math.PI * 2);
    c.fill();
  }

  toggleMap(open?: boolean) {
    this.mapOpen = open ?? !this.mapOpen;
    $('#mapview').style.display = this.mapOpen ? 'flex' : 'none';
    if (this.mapOpen) this.drawMap();
    this.syncInput();
  }

  private drawMap() {
    const R = G.region;
    const cv = $('#map-canvas') as HTMLCanvasElement;
    const px = cv.width;
    if (!this.mapBase) this.mapBase = renderRegionMap(R, px);
    const c = cv.getContext('2d')!;
    c.clearRect(0, 0, px, px);
    c.drawImage(this.mapBase, 0, 0);
    // unexplored: dark paper
    const fog = document.createElement('canvas');
    fog.width = fog.height = px;
    const f = fog.getContext('2d')!;
    f.fillStyle = 'rgba(18,22,28,0.93)';
    f.fillRect(0, 0, px, px);
    f.globalCompositeOperation = 'destination-out';
    if (this.mapFog) f.drawImage(this.mapFog, 0, 0, px, px);
    c.drawImage(fog, 0, 0);
    const label = (x: number, z: number, text: string, col: string) => {
      const p = mapXY(R, px, x, z);
      c.fillStyle = col;
      c.beginPath();
      c.arc(p.x, p.y, 5, 0, Math.PI * 2);
      c.fill();
      c.font = '13px system-ui, sans-serif';
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(0,0,0,0.7)';
      c.strokeText(text, p.x + 8, p.y + 4);
      c.fillStyle = '#fff';
      c.fillText(text, p.x + 8, p.y + 4);
    };
    label(0, 0, 'Дом', '#e05a3a');
    const names: Record<string, string> = { hut: 'Заимка', station: 'Метеостанция «Кряж»', grotto: 'Грот', car: 'УАЗ', bridge: 'Мост', logging: 'Вырубка', cross: 'Крест', leanto: 'Навес', fishing: 'Рыбацкая избушка' };
    for (const p of R.places) if (G.structures.seen.has(p)) label(p.x, p.z, names[p.kind], '#f0c36a');
    const st = G.structures.station;
    if (st && !G.structures.seen.has(st) && G.region.sites.tower && Math.hypot(G.player.pos.x - G.region.sites.tower.x, G.player.pos.z - G.region.sites.tower.z) < 400) label(st.x, st.z, 'Мачта с красным огнём?', '#ff4a3a');
    if (R.sites.tower) label(R.sites.tower.x, R.sites.tower.z, 'Пожарная вышка', '#9cc8ff');
    // you
    const P = G.player;
    const me = mapXY(R, px, P.pos.x, P.pos.z);
    c.save();
    c.translate(me.x, me.y);
    c.rotate(-P.yaw);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#000';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -11);
    c.lineTo(7, 8);
    c.lineTo(0, 4);
    c.lineTo(-7, 8);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }

  closeReader() {
    this.readerOpen = false;
    $('#reader').style.display = 'none';
    this.syncInput();
  }

  /** Read a note, a newspaper or a book. Books take an hour and need light. */
  read(e: Entity) {
    const d = e.def;
    if (!d?.read) return;
    const B = G.body;
    let title = '', body = '', foot = '';
    if (d.read === 'note') {
      const t = NOTES[NOTE_KEYS[e.params.t ?? 0]] ?? NOTES.kid;
      title = t.title;
      body = t.body;
    } else if (d.read === 'paper') {
      if (e.params.t === undefined) e.params.t = e.id % NEWSPAPERS.length;
      const t = NEWSPAPERS[e.params.t];
      title = t.title;
      body = t.body;
      B.mood = Math.min(1, B.mood + 0.02);
    } else {
      if (e.params.t === undefined) e.params.t = e.id % BOOKS.length;
      const bk = BOOKS[e.params.t];
      const fire = G.fires.nearest(G.player.pos);
      const lamp = G.player.equipped?.defId === 'lamp' && G.player.equipped.lit;
      const light = G.sky.daylight > 0.35 || lamp || (fire.level > 0.1 && fire.pos && fire.pos.distanceTo(G.player.pos) < 3);
      if (!light) {
        msg('Слишком темно, чтобы читать. Нужен огонь, лампа или дневной свет.', 'warn');
        return;
      }
      title = bk.title;
      body = bk.body;
      const first = !B.readBooks.has(e.params.t);
      B.readBooks.add(e.params.t);
      G.skip(3600);
      B.mood = Math.min(1, B.mood + (first ? 0.3 : 0.12));
      foot = `Прошёл час. Настроение ${first ? 'заметно ' : ''}лучше.`;
      if (first && bk.skill && !B.skills.has(bk.skill)) {
        B.skills.add(bk.skill);
        foot += ' ' + (bk.tip ?? '');
        msg(bk.tip ?? 'Новый навык', 'good');
      }
    }
    $('#reader-title').textContent = title;
    $('#reader-body').textContent = body;
    $('#reader-foot').textContent = foot;
    if (this.invOpen) this.toggleInventory(false);
    this.readerOpen = true;
    $('#reader').style.display = 'block';
    this.syncInput();
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

  showEnding() {
    this.death.style.display = 'flex';
    const days = (G.time - G.startTime) / 86400;
    this.death.querySelector('h1')!.textContent = 'Вас забрали';
    (this.death.querySelector('h1') as HTMLElement).style.color = 'var(--ok)';
    $('#death-cause').textContent = 'Ми-8 сел у мачты метеостанции. Вы выжили в пепельной зиме.';
    $('#death-stats').textContent = `Дней в глуши: ${days.toFixed(1)}`;
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
    const air = G.thermal.tAt(G.player.pos.clone().add(new THREE.Vector3(0, 0.6, 0)));
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

  invSel = 0;

  private renderInventory() {
    const P = G.player;
    const groups = new Map<string, Entity[]>();
    for (const e of P.inventory) {
      if (P.isWorn(e)) continue;
      const wet = (e.def?.fuel || e.def?.wear) && e.moisture > 0.3 ? 'w' : '';
      const k = e.contents || e.charges || e.def?.read ? `${e.defId}#${e.id}` : e.defId + wet;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(e);
    }
    const nearFire = G.fires.list.find((f) => f.pos.distanceTo(P.pos) < 2.8);
    const all = [...P.inventory];
    let sel = all.find((x) => x.id === this.invSel) ?? null;
    const wetTag = (e: Entity) => {
      if (!e.def?.wear && !e.def?.insul && !e.def?.fuel) return '';
      const m = e.moisture;
      if (m < 0.12) return '';
      return `<i class="wet" style="width:${Math.round(m * 100)}%"></i>`;
    };
    const icon = (e: Entity) => {
      const url = itemIcon(e.defId!, e.params.v ?? 0);
      return url ? `<img src="${url}" alt="">` : '<span class="noicon">?</span>';
    };
    const cards: string[] = [];
    const groupOf = new Map<Entity, Entity[]>();
    for (const [, list] of groups) {
      const e = list[0];
      for (const x of list) groupOf.set(x, list);
      // small wood is one stack by weight; boards and poles are counted
      const byWeight = !!woodOf(e) && stacksByWeight(e.defId);
      const n = list.length > 1 && !byWeight ? `<b class="n">×${list.length}</b>` : '';
      const w = list.reduce((a, x) => a + x.mass, 0);
      const name = byWeight ? (STACK_NAMES[e.defId] ?? e.def?.name ?? e.name) + (e.moisture > 0.3 ? ' (сырое)' : '') : e.displayName();
      cards.push(`<div class="card${sel === e || (sel && groupOf.get(sel) === list) ? ' sel' : ''}${P.equipped === e ? ' eq' : ''}" draggable="true" data-act="select" data-id="${e.id}">${icon(e)}${n}${wetTag(e)}<span class="cn">${name}</span><span class="cw">${w < 1 ? Math.round(w * 1000) + ' г' : w.toFixed(1) + ' кг'}</span></div>`);
    }
    // the figure with slots around it
    const pos: Record<Slot, [number, number]> = {
      head: [50, 2], neck: [50, 17], base: [16, 30], mid: [84, 30], outer: [50, 32], hands: [12, 52], back: [88, 52], legs: [50, 62], socks: [16, 80], feet: [84, 80],
    };
    const slots = (Object.keys(SLOT_NAMES) as Slot[]).map((sl) => {
      const e = P.worn.get(sl);
      const [x, y] = pos[sl];
      const inner = e ? `${icon(e)}${wetTag(e)}<span class="cn">${e.name}</span>` : `<span class="empty">${SLOT_NAMES[sl]}</span>`;
      return `<div class="slotbox${e ? ' full' : ''}${sel && e === sel ? ' sel' : ''}" style="left:${x}%;top:${y}%" data-slot="${sl}" ${e ? `draggable="true" data-act="select" data-id="${e.id}"` : ''} title="${SLOT_NAMES[sl]}">${inner}</div>`;
    });
    const { clo, windproof } = G.body.wornClo(P.worn);
    const pw = P.packWeight();
    // details of the selected item
    let details = '<p class="hint">Выберите предмет. Одежду перетащите на фигуру, чтобы надеть, и обратно в рюкзак, чтобы снять.</p>';
    if (sel) {
      const e = sel;
      const d = e.def!;
      const btn = (act: string, label: string) => `<button data-act="${act}" data-id="${e.id}">${label}</button>`;
      const b: string[] = [];
      const worn = P.isWorn(e);
      if (d.tool || d.food || d.cook) b.push(btn('equip', P.equipped === e ? 'Убрать из руки' : 'В руку'));
      if (d.wear) b.push(worn ? btn('unwear', 'Снять') : btn('wear', 'Надеть'));
      if (d.food) b.push(btn('eat', 'Съесть'));
      if (d.read) b.push(btn('read', d.read === 'book' ? 'Читать (1 ч)' : 'Прочитать'));
      if (e.contents && e.contents.water > 0.05) b.push(btn('drink', 'Пить'));
      if (e.contents && e.contents.water > 0.1 && e.contents.temp >= 80 && !e.contents.tea && P.has((x) => x.defId === 'tea')) b.push(btn('tea', 'Заварить чай'));
      if (e.contents && (e.contents.water > 0 || e.contents.snow > 0)) b.push(btn('pour', 'Вылить'));
      if (e.defId === 'kerosene' && P.has((x) => x.defId === 'lamp')) b.push(btn('refill', 'Заправить лампу'));
      if (d.tearInto) b.push(btn('tear', 'Порвать'));
      if (d.fuel && nearFire) b.push(btn('burn', 'В огонь'));
      if (!worn) b.push(btn('carry', 'В руки'), btn('drop', 'Положить'));
      const stats: string[] = [];
      const bar = (label: string, v: number, txt: string, bad = false) => `<div class="stat"><span>${label}</span><div class="track"><i class="${bad ? 'bad' : ''}" style="width:${Math.round(Math.min(1, v) * 100)}%"></i></div><b>${txt}</b></div>`;
      if (d.wear) {
        stats.push(bar('Тепло', d.wear.clo / 2.2, d.wear.clo.toFixed(2) + ' кло'));
        stats.push(bar('Ветрозащита', d.wear.wind, Math.round(d.wear.wind * 100) + '%'));
        const keep = 1 - 0.65 * (d.wear.wetSens ?? 0.6);
        stats.push(bar('Греет мокрой', keep, Math.round(keep * 100) + '%', keep < 0.5));
        if (d.wear.dex !== undefined) stats.push(bar('Ловкость рук', d.wear.dex, Math.round(d.wear.dex * 100) + '%', d.wear.dex < 0.5));
        if (d.wear.pack) stats.push(bar('Вместимость', d.wear.pack / 34, '+' + d.wear.pack + ' кг'));
      }
      if (d.insul) stats.push(bar('Тепло', d.insul / 2.2, d.insul.toFixed(2) + ' кло'));
      if (d.wear || d.insul || d.fuel) stats.push(bar('Влажность', e.moisture, e.moisture < 0.12 ? 'сухое' : Math.round(e.moisture * 100) + '%', e.moisture > 0.3));
      if (d.food) stats.push(bar('Калории', d.food.kcal / 700, d.food.kcal + ' ккал'));
      const mtl = d.wear?.material ? `<div class="hint">Материал: ${d.wear.material}</div>` : '';
      const wp = woodOf(e);
      if (wp) {
        const list = groupOf.get(e) ?? [e];
        const rows = list.slice(0, 14).map((x) => `<div class="hint">${x === e ? '▸ ' : ''}${x.name} · ${pieceSize(woodOf(x)!)} · ${x.mass < 1 ? Math.round(x.mass * 1000) + ' г' : x.mass.toFixed(1) + ' кг'}</div>`);
        if (list.length > 14) rows.push(`<div class="hint">…и ещё ${list.length - 14}</div>`);
        stats.push(`<div class="pieces">${rows.join('')}</div>`);
      }
      details = `<div class="dhead">${icon(e)}<div><h3>${e.displayName()}</h3><div class="hint">${e.mass < 1 ? Math.round(e.mass * 1000) + ' г' : e.mass.toFixed(1) + ' кг'}${worn ? ' · надето' : ''}</div></div></div>
        ${d.desc ? `<p class="desc">${d.desc}</p>` : ''}${mtl}${stats.join('')}<div class="btns">${b.join('')}</div>`;
    }
    const wrap = P.wrapped ? `<div class="hint">На плечах: ${P.wrapped.name} <button data-act="unwrap" data-id="0">Снять</button></div>` : '';
    this.inv.innerHTML = `
      <div class="inv-col">
        <h2>${P.worn.get('back') ? P.worn.get('back')!.name : 'Карманы'} <small>${pw.toFixed(1)} / ${P.maxPack()} кг${pw > P.maxPack() * 0.5 ? ' · тяжело' : ''}</small></h2>
        <div class="inv-grid" data-zone="pack">${cards.join('') || '<div class="empty">Пусто</div>'}</div>
      </div>
      <div class="inv-col doll-col">
        <h2>Одежда <small>${clo.toFixed(2)} кло · ветер ${Math.round(windproof * 100)}%</small></h2>
        <div class="doll">
          <svg viewBox="0 0 100 160" class="figure"><g fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" stroke-width="0.8">
            <circle cx="50" cy="16" r="10"/><path d="M38 30 Q50 26 62 30 L70 62 L64 64 L60 44 L60 88 L40 88 L40 44 L36 64 L30 62 Z"/>
            <path d="M40 88 L60 88 L62 146 L53 146 L50 100 L47 146 L38 146 Z"/></g></svg>
          ${slots.join('')}
        </div>
        ${wrap}
      </div>
      <div class="inv-col side">
        ${details}
        <button class="close" data-act="close" data-id="0">Закрыть [Tab]</button>
      </div>`;
    this.bindInventoryDrag();
  }

  private bindInventoryDrag() {
    const P = G.player;
    const find = (id: number) => P.inventory.find((x) => x.id === id) ?? null;
    this.inv.querySelectorAll<HTMLElement>('[draggable="true"]').forEach((el) => {
      el.addEventListener('dragstart', (ev) => {
        ev.dataTransfer?.setData('text/plain', el.dataset.id ?? '');
        const e = find(Number(el.dataset.id));
        const slot = e?.def?.wear?.slot;
        if (slot) this.inv.querySelector(`[data-slot="${slot}"]`)?.classList.add('target');
      });
      el.addEventListener('dragend', () => this.inv.querySelectorAll('.target').forEach((t) => t.classList.remove('target')));
    });
    this.inv.querySelectorAll<HTMLElement>('[data-slot], [data-zone="pack"]').forEach((el) => {
      el.addEventListener('dragover', (ev) => ev.preventDefault());
      el.addEventListener('drop', (ev) => {
        ev.preventDefault();
        const e = find(Number(ev.dataTransfer?.getData('text/plain')));
        if (!e) return;
        const slot = el.dataset.slot as Slot | undefined;
        if (slot) {
          if (e.def?.wear?.slot !== slot) msg(e.def?.wear ? `Это надевается на: ${SLOT_NAMES[e.def.wear.slot].toLowerCase()}` : 'Это не надеть', 'warn');
          else P.wear(e);
        } else if (P.isWorn(e)) P.unwear(e);
        this.invSel = e.id;
        this.renderInventory();
      });
    });
    this.inv.querySelectorAll<HTMLElement>('.card, .slotbox.full').forEach((el) => {
      el.addEventListener('dblclick', () => {
        const e = find(Number(el.dataset.id));
        if (!e) return;
        if (e.def?.wear) P.isWorn(e) ? P.unwear(e) : P.wear(e);
        else if (e.def?.tool || e.def?.food) P.equip(e);
        this.renderInventory();
      });
    });
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
      case 'read':
        if (e) this.read(e);
        return;
      case 'select':
        this.invSel = id;
        this.renderInventory();
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
        <label class="chk"><input type="checkbox" id="dbg-performance" ${this.performance.enabled ? 'checked' : ''}> FPS и график времени кадра [F4]</label>
        <label>Средняя температура <b id="dbg-bt">${S.baseTemp}°C</b><input type="range" id="dbg-base" min="-40" max="0" step="1" value="${S.baseTemp}"></label>
        <label>Скорость времени <b id="dbg-ts">×${S.timeScale}</b><input type="range" id="dbg-scale" min="1" max="120" step="1" value="${S.timeScale}"></label>
        <label>Погода <select id="dbg-weather">${wopts}</select></label>
        <label>Тепловизор [V] <select id="dbg-overlay">${['off', 'temp', 'rh', 'draft'].map((m) => `<option value="${m}" ${G.thermal.overlayMode === m ? 'selected' : ''}>${OVERLAY_NAMES[m]}</option>`).join('')}</select></label>
        <div class="row2"><button data-dbg="h1">+1 час</button><button data-dbg="h6">+6 ч</button><button data-dbg="night">→ ночь</button><button data-dbg="day">→ утро</button></div>
        <label class="chk"><input type="checkbox" id="dbg-nocold" ${S.noCold ? 'checked' : ''}> Без холода (тест)</label>
        <label class="chk"><input type="checkbox" id="dbg-horror" ${S.horror ? 'checked' : ''}> Жуть по ночам</label>
        <div class="row2"><select id="dbg-item">${opts}</select><button data-dbg="spawn">Создать</button></div>
        <div class="row2"><button data-dbg="tp-house">К дому</button><button data-dbg="tp-lake">К озеру</button><button data-dbg="tp-forest">В лес</button><button data-dbg="heal">Вылечить</button></div>
        <div class="row2"><button data-dbg="avatar">Осмотр походки [F6]</button></div>
        <div id="dbg-live"></div>`;
    }
    const live = this.debug.querySelector('#dbg-live') as HTMLElement;
    const B = G.body;
    const zrows = (['ground', 'upper'] as const).map((n) => {
      const z = G.thermal.zone(n);
      const parts = z.parts.map((p) => `<tr><td>${p.label}</td><td></td><td>${(p.w / 1000).toFixed(2)} кВт</td></tr>`).join('');
      return `<h4>${n === 'ground' ? '1 этаж' : '2 этаж'}: ${fmtTemp(z.T)} · влажн. ${Math.round(z.rh * 100)}%</h4>
        <table>${parts}<tr class="sum"><td>Приток тепла</td><td></td><td>${(z.heatW / 1000).toFixed(2)} кВт</td></tr><tr class="sum"><td>Потери</td><td>${z.ua.toFixed(0)} Вт/К</td><td>${(z.lossW / 1000).toFixed(2)} кВт</td></tr></table>`;
    }).join('');
    const P = G.player;
    const chest = P.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    const here = G.house.zoneAt(P.pos)
      ? `<h4>Здесь: ${fmtTemp(G.thermal.tAt(chest))} · влажн. ${Math.round(G.thermal.rhAt(chest) * 100)}% · сквозняк ${G.thermal.draftAt(chest).toFixed(1)} м/с · стены ${fmtTemp(G.thermal.mrtAt(chest))}</h4>`
      : '';
    const fires = G.fires.list.map((f) => `<div>${G.fires.describe(f)}<br><small>${f.fuel.map((x) => `${x.name}${x.burning ? '🔥' : ''}${x.moisture > 0.3 ? '💧' : ''} ${Math.round(x.remaining / 60)}м`).join(', ') || '—'} · угли ${Math.round(f.embers * 100)}%</small></div>`).join('');
    live.innerHTML = `
      <h4>Походка</h4>
      <div>Скорость ${P.avatar.motion.speed.toFixed(2)} м/с · поворот головы ${(P.avatar.motion.headYaw * 180 / Math.PI).toFixed(0)}°<br>
      ${P.avatar.motion.feet.map(f => `${f.side === 'left' ? 'Левая' : 'Правая'}: ${f.swinging ? 'перенос' : f.grounded ? 'опора' : 'в воздухе'}`).join(' · ')}</div>
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
      ${here}
      ${zrows}
      <h4>Огонь</h4>${fires}`;
  }

  private onDebugInput(ev: Event) {
    const t = ev.target as HTMLInputElement;
    const S = G.settings;
    if (t.id === 'dbg-performance') this.performance.setEnabled(t.checked);
    if (t.id === 'dbg-base') {
      S.baseTemp = Number(t.value);
      $('#dbg-bt').textContent = `${S.baseTemp}°C`;
    }
    if (t.id === 'dbg-scale') {
      S.timeScale = Number(t.value);
      $('#dbg-ts').textContent = `×${S.timeScale}`;
    }
    if (t.id === 'dbg-weather') S.weatherLock = t.value === 'auto' ? null : t.value;
    if (t.id === 'dbg-overlay') this.setOverlay(t.value as 'off');
    if (t.id === 'dbg-nocold') S.noCold = t.checked;
    if (t.id === 'dbg-horror') S.horror = t.checked;
  }

  private onDebugClick(ev: MouseEvent) {
    const t = ev.target as HTMLElement;
    const a = t.dataset.dbg;
    if (!a) return;
    const P = G.player;
    switch (a) {
      case 'avatar':
        msg(P.avatar.cycleInspection() + ' [F6]', 'info');
        break;
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
        const L = [...G.region.lakes].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
        if (L) P.teleport(new THREE.Vector3(L.x, L.level + 0.1, L.z));
        break;
      }
      case 'tp-forest': {
        const tr = G.forest.treesNear(0, 0, 120).find((x) => x.alive && Math.hypot(x.x, x.z) > 30);
        if (tr) P.teleport(new THREE.Vector3(tr.x + 2, G.terrain.heightAt(tr.x + 2, tr.z) + 0.1, tr.z));
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

  // ---------- thermal vision ----------

  setOverlay(mode: 'off' | 'temp' | 'rh' | 'draft') {
    G.thermal.setOverlay(mode);
    const el = $('#legend');
    if (mode === 'off') {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    const grad =
      mode === 'temp' ? 'linear-gradient(90deg,#1a2bff,#2ea8ff,#4af2d6,#a8f04a,#ffd23a,#ff7a1a,#ff2020)' : mode === 'rh' ? 'linear-gradient(90deg,#ffd94c,#33a6ff)' : 'linear-gradient(90deg,#33e64d,#ff3399)';
    const ends = mode === 'temp' ? ['−20°', '0°', '+30°'] : mode === 'rh' ? ['сухо', '', '100%'] : ['тихо', '', '2 м/с'];
    el.innerHTML = `<div>Тепловизор: ${OVERLAY_NAMES[mode]} <span class="key">V</span></div><div class="grad" style="background:${grad}"></div><div class="ends"><span>${ends[0]}</span><span>${ends[1]}</span><span>${ends[2]}</span></div>`;
  }

  cycleOverlay() {
    const i = OVERLAY_ORDER.indexOf(G.thermal.overlayMode);
    this.setOverlay(OVERLAY_ORDER[(i + 1) % OVERLAY_ORDER.length]);
  }

  // ---------- per frame ----------

  update(dt: number) {
    this.updateFog(dt);
    const I = G.interact;
    // prompts every frame (cheap)
    const P = G.player;
    const lines: string[] = [];
    for (const a of I.actions) lines.push(`<div class="act"><span class="key">${KEY_LABEL[a.key]}</span>${a.label}${a.time ? ' <span class="t">⏱</span>' : ''}</div>`);
    if (P.carried) {
      lines.push(`<div class="act dim"><span class="key">E/Q</span>положить <span class="key">ПКМ</span>бросить <span class="key">R</span>повернуть <span class="key">колесо</span>ближе/дальше</div>`);
    }
    if (P.water) {
      const pick = P.inventory.some((x) => x.defId === 'axe' || x.defId === 'hatchet' || x.defId === 'knife');
      lines.unshift(`<div class="act"><span class="key">Пробел</span><b>Выбирайтесь на лёд: жмите Пробел снова и снова</b></div><div class="act dim">${pick ? 'Топор/нож в рюкзаке помогает цепляться за лёд' : 'Если в рюкзаке есть топор или нож — выбраться легче'} · каждое промедление — ещё холоднее</div>`);
    }
    if (I.fishing) lines.unshift(`<div class="act"><span class="key">ЛКМ</span>${I.fishing.bite > 0 ? '<b>КЛЮЁТ! Подсекай!</b>' : 'Рыбалка… ждите поклёвки'}</div>`);
    const html = lines.join('');
    if (this.prompt.dataset.h !== html) {
      this.prompt.innerHTML = html;
      this.prompt.dataset.h = html;
    }
    if (this.info.textContent !== I.info) this.info.textContent = I.info;
    const prog = P.water ? Math.min(1, P.water.climb) : I.timedProgress();
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
      this.bar('Настроение', B.mood, `${Math.round(B.mood * 100)}%`, k(B.mood, 0.3, 0.12)) +
      this.bar('Состояние', B.condition / 100, `${Math.round(B.condition)}%`, k(B.condition, 50, 25)) +
      `<div class="flags">${B.statusList().map((s) => `<span class="${s.kind}">${s.text}</span>`).join('')}</div>`;
    this.status.innerHTML = html;
  }

  private renderEnv() {
    const P = G.player;
    const z = G.house.zoneAt(P.pos);
    const W = G.weather;
    let loc = G.lake.onIce(P.pos) ? (G.lake.levelAt(P.pos.x, P.pos.z) === 0 ? 'Морской лёд' : 'На льду') : Math.hypot(P.pos.x, P.pos.z) < 14 ? 'Двор' : BIOME_NAMES[G.region.biomeAt(P.pos.x, P.pos.z)];
    if (z) {
      const chest = P.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
      const dr = G.thermal.draftAt(chest);
      loc = `Дом, ${z === 'ground' ? '1 этаж' : '2 этаж'} · здесь <b>${fmtTemp(G.thermal.tAt(chest))}</b> · влажн. ${Math.round(G.thermal.rhAt(chest) * 100)}%${dr > 0.15 ? ` · <span class="draft">сквозняк ${dr.toFixed(1)} м/с</span>` : ''}`;
    }
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
