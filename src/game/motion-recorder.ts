// An opt-in diagnostic recorder. Replay displays captured render transforms;
// it never asks today's gait solver to approximate yesterday's broken frame.
import * as THREE from 'three';
import { WorldCapture } from './diagnostics/capture';
import { DiagnosticViewer } from './diagnostics/viewer';
import { G } from './ctx';
import type { FootSurface } from './locomotion';
import { SnowField } from '../world/snow-field';
import { MAX_RECORD_BYTES, MotionRing, diagnosticCopy, readRecording, validateRecording } from './motion-record';
import type { MotionFrame, MotionRecording, RecordedSnow, SnowChange } from './motion-record';

export class MotionRecorder {
  recording = false;
  reviewing = false;
  readonly camera = new THREE.PerspectiveCamera();
  data: MotionRecording | null = null;
  index = 0;
  private errors: { time: number; message: string }[] = [];
  private worldCapture: WorldCapture | null = null;
  private worldViewer: DiagnosticViewer | null = null;
  private worldDetails!: HTMLElement;
  private expected!: HTMLTextAreaElement;
  private actual!: HTMLTextAreaElement;
  private map!: HTMLCanvasElement;
  private ring: MotionRing | null = null;
  private context: any;
  private started = 0;
  private sequence = 0;
  private ticks: any[] = [];
  private tick: any = null;
  private watched: SnowField | null = null;
  private changes = new Map<string, SnowChange>();
  private resetSnow: RecordedSnow | undefined;
  private replayField: SnowField | null = null;
  private snowCursor = -1;
  private live: { paused: boolean; enabled: boolean; pose: Float32Array; snowVisible: boolean } | null = null;
  private playing = false;
  private playTime = 0;
  private lastPlay = 0;
  private panel: HTMLDivElement;
  private status: HTMLElement;
  private slider: HTMLInputElement;
  private note: HTMLTextAreaElement;
  private details: HTMLElement;
  private info: HTMLElement;
  private view: HTMLSelectElement;
  private speed: HTMLSelectElement;
  private notice: HTMLElement;
  constructor() {
    this.panel = document.createElement('div'); this.panel.className = 'motion-recorder';
    this.panel.innerHTML = `<div class="motion-title">Диагностика мира и движения <span data-rec="status">выключена</span></div>
      <div class="motion-buttons"><button data-rec="start">Запись · F7</button><button data-rec="stop" disabled>Разобрать · F8</button><button data-rec="open">Открыть файл</button><input data-rec="file" type="file" accept=".json,.gz" hidden></div>
      <div data-rec="notice" class="motion-notice" role="status"></div>
      <div data-rec="details" hidden><p data-rec="info"></p>
      <input data-rec="slider" aria-label="Кадр записи" type="range" min="0" max="0" step="1" value="0">
      <div class="motion-buttons"><button data-rec="prev" aria-label="Предыдущий кадр">Назад</button><button data-rec="play">Смотреть</button><button data-rec="next" aria-label="Следующий кадр">Вперёд</button>
      <select data-rec="speed" aria-label="Скорость просмотра"><option value="0.25">¼ скорости</option><option value="0.5">½ скорости</option><option value="1">Обычная</option></select></div>
      <label>Ракурс <select data-rec="view"><option value="recorded">Как было</option><option value="side">Сбоку</option><option value="front">Спереди</option><option value="top">Сверху</option><option value="orbit">Свободная камера участка</option></select></label>
      <label><input data-rec="world" type="checkbox" checked> Записанный участок (без текущего мира)</label>
      <label><input data-rec="colliders" type="checkbox"> Коллайдеры и контакты</label>
      <canvas data-rec="map" width="280" height="180" style="width:100%;height:120px;cursor:crosshair" aria-label="Карта записанного участка: нажмите для отметки"></canvas>
      <label>Ожидалось<textarea data-rec="expected" rows="2" maxlength="2000"></textarea></label>
      <label>Произошло<textarea data-rec="actual" rows="2" maxlength="2000"></textarea></label>
      <details><summary>Объекты, системы и границы восстановления</summary><pre data-rec="world-details" style="white-space:pre-wrap;max-height:160px;overflow:auto"></pre></details>
      <label>Заметка к этому кадру<textarea data-rec="note" rows="2" maxlength="2000" placeholder="Например: здесь правая нога начала скользить"></textarea></label>
      <div class="motion-buttons"><button data-rec="mark">Отметить кадр</button><button data-rec="download">Скачать запись</button><button data-rec="exit">Вернуться в игру</button></div>
      <small>← / → — по кадрам · Пробел — просмотр. Файл с отметкой можно прикрепить в чат.</small></div>`;
    document.body.appendChild(this.panel);
    const el = <T extends HTMLElement>(key: string) => this.panel.querySelector<T>(`[data-rec="${key}"]`)!;
    this.status = el('status'); this.slider = el('slider'); this.note = el('note'); this.details = el('details');
    this.worldDetails = el('world-details'); this.expected = el('expected'); this.actual = el('actual'); this.map = el('map');
    this.map.onclick = event => {
      if (!this.data || !this.reviewing) return;
      const f = this.data.frames[this.index], rect = this.map.getBoundingClientRect();
      const x = f.player.pos[0] + ((event.clientX - rect.left) / rect.width - 0.5) * 64;
      const z = f.player.pos[2] + ((event.clientY - rect.top) / rect.height - 0.5) * 64;
      this.mark(); const n = this.data.notes.find(n => n.frameId === f.id);
      if (n) n.position = [x, f.player.pos[1], z]; this.seek(this.index);
    };
    this.info = el('info'); this.view = el('view'); this.speed = el('speed'); this.notice = el('notice');
    const error = (message: string) => { if (this.recording && this.errors.length < 40) this.errors.push({ time: performance.now() / 1000 - this.started, message: message.slice(0, 3500) }); };
    window.addEventListener('error', e => error(String(e.error?.stack ?? e.message)));
    window.addEventListener('unhandledrejection', e => error(String(e.reason?.stack ?? e.reason)));
    el('start').onclick = () => { this.start(); G.hud.resume(); };
    el('stop').onclick = () => this.stop();
    el('prev').onclick = () => { this.playing = false; this.seek(this.index - 1); };
    el('next').onclick = () => { this.playing = false; this.seek(this.index + 1); };
    el('play').onclick = () => this.togglePlay();
    el('mark').onclick = () => this.mark();
    el('download').onclick = () => { this.download().catch(e => this.message(e.message)); };
    el('exit').onclick = () => { this.exit(); G.hud.resume(); };
    el('open').onclick = () => el<HTMLInputElement>('file').click();
    el<HTMLInputElement>('file').onchange = async event => {
      const input = event.target as HTMLInputElement, file = input.files?.[0];
      if (file) try { this.load(await readRecording(file)); } catch (e) { this.message((e as Error).message); }
      input.value = '';
    };
    this.slider.oninput = () => { this.playing = false; this.seek(Number(this.slider.value)); };
    window.addEventListener('keydown', e => {
      if (e.code === 'F7' || e.code === 'F8') {
        e.preventDefault(); if (e.repeat) return;
        if (e.code === 'F7') { this.start(); G.hud.resume(); } else this.stop();
      } else if (this.reviewing && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
          e.preventDefault(); if (e.repeat) return;
          if (e.code === 'Space') this.togglePlay();
          else { this.playing = false; this.seek(this.index + (e.code === 'ArrowLeft' ? -1 : 1)); }
        }
      }
    });
  }
  private message(text: string) { this.notice.textContent = text; }
  private snowState(): RecordedSnow | null {
    const s = G.snow;
    return s ? { enabled: s.enabled, thickness: s.field.thickness, ratio: s.field.densityRatio, cells: s.field.recordedCells(), weatherExposure: s.field.weatherExposure } : null;
  }
  private watchSnow() {
    const field = G.snow?.field ?? null;
    if (field === this.watched) return;
    if (this.watched) this.watched.onRecordedChange = undefined;
    this.watched = field;
    if (field) {
      this.resetSnow = this.snowState()!; this.changes.clear();
      field.onRecordedChange = c => {
        const key = `${c[0]},${c[1]}`, old = this.changes.get(key);
        if (old) { old[4] = c[4]; old[5] = c[5]; old[7] = c[7]; } else this.changes.set(key, c);
      };
    }
  }
  private inputState() {
    const i = G.input;
    return { keys: [...i.keys], pressed: [...i.pressed], mouseDX: i.mouseDX, mouseDY: i.mouseDY, sensitivity: i.sensitivity, locked: i.locked };
  }
  private playerState() {
    const p = G.player;
    return { pos: p.pos.toArray(), prevPos: p.prevPos.toArray(), yaw: p.yaw, pitch: p.pitch, grounded: p.grounded,
      sprinting: p.sprinting, crouch: p.crouch, vy: p.vy, stamina: p.stamina, renderAlpha: p.renderAlpha,
      rigidBody: p.body.translation(), groundedKcc: p.kcc.computedGrounded(), movementKcc: p.kcc.computedMovement() };
  }
  start() {
    if (this.reviewing) this.exit();
    if (this.watched) this.watched.onRecordedChange = undefined;
    this.watched = null; this.changes.clear(); this.resetSnow = undefined;
    const world = this.panel.querySelector('[data-rec="world"]') as HTMLInputElement; world.checked = true; world.disabled = false;
    this.errors = []; this.worldCapture = new WorldCapture();
    this.ring = new MotionRing(this.snowState()); this.sequence = 0; this.ticks = []; this.tick = null;
    this.context = { seed: G.settings.seed, settings: { ...G.settings }, snowScene: !!G.snow?.isExperiment,
      createdAt: new Date().toISOString(), buildAsset: document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src') ?? '',
      buildSha: document.querySelector('.build-info')?.getAttribute('title') ?? 'unknown',
      viewport: [innerWidth, innerHeight, devicePixelRatio], userAgent: navigator.userAgent };
    this.started = performance.now() / 1000; this.data = null; this.recording = true;
    this.watchSnow(); this.resetSnow = undefined; this.details.hidden = true;
    this.panel.classList.add('is-recording');
    (this.panel.querySelector('[data-rec="stop"]') as HTMLButtonElement).disabled = false;
    this.message('Записывается до 20 секунд. Поймайте сбой и нажмите F8.');
  }
  beginTick() {
    if (!this.recording) return;
    this.watchSnow();
    this.tick = { dt: 1 / 60, before: diagnosticCopy(G.player.avatar.motion), input: this.inputState(), playerBefore: this.playerState(), probes: [] };
  }
  probe(x: number, z: number, referenceY: number, surface: FootSurface | null) {
    if (!this.recording || !this.tick) return;
    if (this.tick.probes.length >= 128) { this.tick.probesTruncated = true; return; }
    this.tick.probes.push({ x, z, referenceY, hit: surface ? { point: surface.point.toArray(), normal: surface.normal.toArray(), support: surface.support, snowDepth: surface.snowDepth } : null });
  }
  endTick() {
    if (!this.recording || !this.tick) return;
    this.tick.after = diagnosticCopy(G.player.avatar.motion); this.tick.playerAfter = this.playerState();
    if (this.ticks.length < 299) this.ticks.push(this.tick);
    else if (this.ticks.length === 299) this.ticks.push({ truncated: true });
    this.tick = null;
  }
  captureFrame(dt: number, alpha: number) {
    if (!this.recording || !this.ring) return;
    this.watchSnow();
    const a = G.player.avatar, c = a.inspectionView ? a.inspectionCamera : G.camera;
    const frame: MotionFrame = {
      id: this.sequence++, t: performance.now() / 1000 - this.started, dt, alpha, pose: a.recordedPose(),
      camera: [...c.position.toArray(), ...c.quaternion.toArray(), c.fov, c.aspect, c.near, c.far], view: a.inspectionView,
      input: this.inputState(), player: this.playerState(), animation: a.snapshot(), ticks: this.ticks,
      snow: G.snow ? { enabled: G.snow.enabled, reset: this.resetSnow, changes: [...this.changes.values()], weatherExposure: G.snow.field.weatherExposure } : null,
    };
    frame.worldSampleId = this.worldCapture?.sample(frame.t, this.ring.frames[0]?.t ?? frame.t);
    this.ring.push(frame); this.ticks = []; this.changes.clear(); this.resetSnow = undefined;
    this.status.textContent = `● ${Math.min(20, frame.t).toFixed(1)} с · F8 — разобрать`;
  }
  stop() {
    if (!this.recording) { if (this.data && !this.reviewing) this.enterReview(); return; }
    if (!this.ring) return;
    if (!this.ring.frames.length || this.ticks.length || this.changes.size) this.captureFrame(0, G.player.renderAlpha);
    this.recording = false;
    if (this.watched) this.watched.onRecordedChange = undefined;
    this.watched = null; this.panel.classList.remove('is-recording');
    this.context.errors = this.errors.map(e => ({ ...e }));
    const frames = this.ring.frames;
    this.data = { format: 'nimble-motion', version: 1, context: this.context, rig: G.player.avatar.recordedRig(),
      initialSnow: this.ring.initialSnow(), diagnostics: this.worldCapture?.bundle, frames, notes: [], selectedFrameId: frames.at(-1)!.id };
    this.enterReview();
  }
  private enterReview() {
    this.live = { paused: G.paused, enabled: G.input.enabled, pose: G.player.avatar.recordedPose(), snowVisible: G.snow?.renderer.group.visible ?? false };
    this.worldViewer = this.data?.diagnostics ? new DiagnosticViewer(this.data.diagnostics, this.camera) : null;
    this.reviewing = true; this.playing = false; this.snowCursor = -1; this.replayField = null;
    G.paused = true; G.input.enabled = false; G.input.keys.clear(); G.input.pressed.clear(); G.input.unlock();
    G.input.lmb = G.input.rmb = G.input.lmbPressed = G.input.rmbPressed = false;
    G.hud.showPause(false); document.body.classList.add('motion-reviewing'); this.details.hidden = false;
    (this.panel.querySelector('[data-rec="stop"]') as HTMLButtonElement).disabled = false;
    this.slider.max = String(this.data!.frames.length - 1);
    this.view.value = 'recorded';
    this.seek(Math.max(0, this.data!.frames.findIndex(f => f.id === this.data!.selectedFrameId)));
    this.message('Игра остановлена. Выберите кадр, отметьте сбой и скачайте запись.');
  }
  exit() {
    if (!this.reviewing || !this.live) return;
    this.worldViewer?.dispose(); this.worldViewer = null;
    this.reviewing = false; this.playing = false;
    const s = G.snow;
    if (s) { s.renderer.field = s.field; s.renderer.update(G.player.pos); s.renderer.refreshAll(); s.renderer.group.visible = this.live.snowVisible; }
    G.player.avatar.applyRecordedPose(this.live.pose, G.player.avatar.inspectionView === 0);
    G.paused = this.live.paused; G.input.enabled = this.live.enabled; G.input.keys.clear(); G.input.pressed.clear();
    document.body.classList.remove('motion-reviewing'); this.details.hidden = true; this.status.textContent = 'F8 — открыть запись';
    this.live = null; this.replayField = null;
  }
  private makeSnow(state: RecordedSnow) {
    const s = G.snow!;
    const field = new SnowField({ thickness: state.thickness, densityRatio: state.ratio, base: s.terrain.heightAt, coverage: s.terrain.retentionAt,
      contains: (x, z) => s.contains(x, z) });
    for (const c of state.cells) field.applyRecordedCell(...c);
    field.weatherExposure = state.weatherExposure ?? 0;
    return field;
  }
  private seekSnow(index: number) {
    if (!G.snow || !this.data?.initialSnow) return;
    const frames = this.data.frames;
    let fresh = false;
    if (!this.replayField || (index < this.snowCursor && frames.slice(index + 1, this.snowCursor + 1).some(f => f.snow?.reset))) {
      this.replayField = this.makeSnow(this.data.initialSnow); this.snowCursor = -1; fresh = true;
    }
    if (index < this.snowCursor) {
      for (let i = this.snowCursor; i > index; i--) for (const c of frames[i].snow?.changes ?? []) this.replayField.applyRecordedCell(c[0], c[1], c[2], c[3], c[6] ?? 0);
    } else for (let i = this.snowCursor + 1; i <= index; i++) {
      const state = frames[i].snow;
      if (state?.reset) { this.replayField = this.makeSnow(state.reset); fresh = true; }
      for (const c of state?.changes ?? []) this.replayField.applyRecordedCell(c[0], c[1], c[4], c[5], c[7] ?? 0);
    }
    this.snowCursor = index;
    this.replayField.weatherExposure = frames[index].snow?.weatherExposure ?? this.data.initialSnow.weatherExposure ?? 0;
    G.snow.renderer.field = this.replayField; G.snow.renderer.group.visible = frames[index].snow?.enabled ?? false;
    G.snow.renderer.update(new THREE.Vector3().fromArray(frames[index].player.pos));
    if (fresh) G.snow.renderer.refreshAll();
  }
  seek(index: number) {
    if (!this.data || !this.reviewing) return;
    this.index = THREE.MathUtils.clamp(Math.round(index), 0, this.data.frames.length - 1);
    if (this.data.context.seed === G.settings.seed && this.data.context.snowScene === !!G.snow?.isExperiment) this.seekSnow(this.index);
    const f = this.data.frames[this.index]; this.data.selectedFrameId = f.id; this.slider.value = String(this.index);
    const note = this.data.notes.find(n => n.frameId === f.id); this.note.value = note?.text ?? ''; this.expected.value = note?.expected ?? ''; this.actual.value = note?.actual ?? '';
    const sample = this.data.diagnostics?.samples.find(s => s.id === f.worldSampleId);
    this.worldDetails.textContent = sample ? JSON.stringify({ coverage: this.data.diagnostics!.coverage, build: this.data.context.buildSha, sample }, null, 2) : 'Старая запись: участок мира не сохранён.';
    const ctx = this.map.getContext('2d')!; ctx.fillStyle = '#172631'; ctx.fillRect(0, 0, 280, 180);
    const dot = (p: number[], color: string, radius: number) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(140 + (p[0] - f.player.pos[0]) / 64 * 280, 90 + (p[2] - f.player.pos[2]) / 64 * 180, radius, 0, Math.PI * 2); ctx.fill(); };
    for (const o of sample?.objects ?? []) dot(o.position, '#ffd34a', 2);
    for (const n of this.data.notes) if (n.position) dot(n.position, '#ff5588', 5);
    dot(f.player.pos, '#55ffff', 4); ctx.fillStyle = 'white'; ctx.fillText('64 × 64 м · объекты / игрок / отметки', 6, 16);
    const time = f.t - this.data.frames[0].t;
    this.info.textContent = `Место ${f.player.pos.map((x: number) => x.toFixed(1)).join(', ')} · Кадр ${this.index + 1} / ${this.data.frames.length} · ${time.toFixed(3)} с${note ? ' · ★ отметка' : ''}`;
    this.status.textContent = `Просмотр · отметок: ${this.data.notes.length}`;
  }
  private mark() {
    if (!this.data || !this.reviewing) return;
    const id = this.data.frames[this.index].id, found = this.data.notes.find(n => n.frameId === id);
    if (found) found.text = this.note.value;
    else if (this.data.notes.length < 200) this.data.notes.push({ frameId: id, text: this.note.value });
    const saved = this.data.notes.find(n => n.frameId === id);
    if (saved) { saved.expected = this.expected.value; saved.actual = this.actual.value; saved.position ??= [...this.data.frames[this.index].player.pos]; }
    this.seek(this.index); this.message('Кадр и заметка сохранены в записи. Теперь можно скачать файл.');
  }
  private togglePlay() {
    if (!this.reviewing || !this.data) return;
    if (!this.playing && this.index === this.data.frames.length - 1) this.seek(0);
    this.playing = !this.playing; this.playTime = this.data.frames[this.index].t; this.lastPlay = performance.now();
  }
  present() {
    if (!this.reviewing || !this.data) return;
    G.paused = true; G.input.enabled = false; G.hud.showPause(false);
    if (this.playing) {
      const now = performance.now(); this.playTime += (now - this.lastPlay) / 1000 * Number(this.speed.value); this.lastPlay = now;
      let index = this.index;
      while (index < this.data.frames.length - 1 && this.data.frames[index + 1].t <= this.playTime) index++;
      if (index !== this.index) this.seek(index);
      if (index === this.data.frames.length - 1) this.playing = false;
    }
    (this.panel.querySelector('[data-rec="play"]') as HTMLButtonElement).textContent = this.playing ? 'Пауза' : 'Смотреть';
    const f = this.data.frames[this.index], recorded = this.view.value === 'recorded';
    if (JSON.stringify(this.data.rig) === JSON.stringify(G.player.avatar.recordedRig())) G.player.avatar.applyRecordedPose(f.pose, recorded && f.view === 0);
    const c = this.camera;
    if (recorded) {
      c.position.fromArray(f.camera); c.quaternion.fromArray(f.camera, 3);
      c.fov = f.camera[7]; c.aspect = f.camera[8]; c.near = f.camera[9]; c.far = f.camera[10];
    } else if (this.view.value !== 'orbit') {
      const origin = new THREE.Vector3(f.pose[0], f.pose[1], f.pose[2]);
      const target = origin.clone().add(new THREE.Vector3(0, f.animation.hipHeight ?? 0.9, 0));
      const yaw = f.animation.bodyYaw ?? 0;
      const direction = this.view.value === 'top' ? new THREE.Vector3(0.5, 4.5, 0.5)
        : this.view.value === 'front' ? new THREE.Vector3(-Math.sin(yaw) * 3.4, 0.45, -Math.cos(yaw) * 3.4)
        : new THREE.Vector3(Math.cos(yaw) * 3.4, 0.45, -Math.sin(yaw) * 3.4);
      c.position.copy(target).add(direction); c.lookAt(target); c.fov = 48; c.aspect = innerWidth / innerHeight; c.near = 0.05; c.far = 14000;
    }
    const sample = this.data.diagnostics?.samples.find(s => s.id === f.worldSampleId);
    const useWorld = (this.panel.querySelector('[data-rec="world"]') as HTMLInputElement).checked;
    if (sample && useWorld) this.worldViewer?.show(sample, (this.panel.querySelector('[data-rec="colliders"]') as HTMLInputElement).checked, this.view.value === 'orbit', c, f.ticks.flatMap(t => t.probes ?? []), JSON.stringify(this.data.rig) === JSON.stringify(G.player.avatar.recordedRig()), this.data.context.seed === G.settings.seed && this.data.context.snowScene === !!G.snow?.isExperiment);
    else this.worldViewer?.hide();
    c.updateProjectionMatrix(); c.updateMatrixWorld();
  }
  load(recording: MotionRecording) {
    const data = validateRecording(recording);
    if (!data.diagnostics && (data.context.seed !== G.settings.seed || data.context.settings?.size !== G.settings.size || data.context.snowScene !== !!G.snow?.isExperiment))
      throw new Error(`Откройте тот же мир: seed ${data.context.seed}, ${data.context.snowScene ? 'испытание снега' : 'обычная игра'}, и снова загрузите файл.`);
    if (!data.diagnostics && JSON.stringify(data.rig) !== JSON.stringify(G.player.avatar.recordedRig())) throw new Error('Запись сделана для другой версии модели персонажа.');
    if (this.recording) this.stop();
    if (this.reviewing) this.exit();
    this.data = data;
    const world = this.panel.querySelector('[data-rec="world"]') as HTMLInputElement;
    world.checked = !!data.diagnostics;
    world.disabled = !!data.diagnostics && (data.context.seed !== G.settings.seed || data.context.settings.size !== G.settings.size);
    this.enterReview();
    if (data.context.buildSha !== document.querySelector('.build-info')?.getAttribute('title')) this.message('Версия записи отличается. Сохранённый участок доступен для осмотра; повтор симуляции не гарантируется.');
  }
  exportData(): MotionRecording {
    if (!this.data) throw new Error('Сначала остановите запись.');
    return { ...this.data, frames: this.data.frames.map(f => ({ ...f, pose: Array.from(f.pose) })) };
  }
  private async download() {
    this.mark();
    const data = validateRecording(this.exportData());
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    if (blob.size > MAX_RECORD_BYTES) throw new Error('Запись слишком велика для открытия. Запишите более короткий эпизод.');
    const compressed = typeof CompressionStream !== 'undefined';
    const output = compressed ? await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob() : blob;
    const url = URL.createObjectURL(output), a = document.createElement('a'); a.href = url;
    a.download = `nimble-motion-${new Date().toISOString().replace(/[:.]/g, '-')}.json${compressed ? '.gz' : ''}`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    this.message('Файл скачан. Прикрепите его в чат — отметка и заметка находятся внутри.');
  }
}
