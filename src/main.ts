import { startGame } from './game/game';
import type { Settings } from './game/ctx';
import { G } from './game/ctx';

import { isTrailStop, trailPose, trailStops, type TrailStop } from './game/trail-location';
import { makeTrailPicker } from './ui/trail-picker';

const params = new URLSearchParams(location.search);
// The old laboratory remains available for diagnostics. Ordinary play now uses
// the same snow material in the generated world, with normal survival settings.
if (params.get('snow') === '1') {
  for (const [key, value] of Object.entries({ seed: '42', hour: '13', weather: 'clear', nocold: '1', horror: '0', scale: '0' }))
    if (!params.has(key)) params.set(key, value);
}
// The cliff laboratory raises a plateau with cliffs next to the house in the real world.
if (params.get('cliffs') === '1') {
  for (const [key, value] of Object.entries({ seed: '42', hour: '15.5', weather: 'clear', nocold: '1', horror: '0', scale: '0' }))
    if (!params.has(key)) params.set(key, value);
}
// The cave laboratory starts in front of the cave mouth nearest to the house.
if (params.get('cave') === '1') {
  for (const [key, value] of Object.entries({ seed: '42', hour: '13', weather: 'clear', nocold: '1', horror: '0', scale: '0' }))
    if (!params.has(key)) params.set(key, value);
}
// One stationary imported deer in the ordinary world, with direct clip controls.
if (params.get('deer') === '1') {
  for (const [key, value] of Object.entries({ seed: '42', hour: '13', weather: 'clear', nocold: '1', horror: '0', scale: '0' }))
    if (!params.has(key)) params.set(key, value);
}
const el = (id: string) => document.getElementById(id) as HTMLInputElement;

const seedInput = el('st-seed');
seedInput.value = params.get('seed') ?? String(Math.floor(Math.random() * 1e6));
if (params.get('temp')) el('st-temp').value = params.get('temp')!;
if (params.get('hour')) el('st-hour').value = params.get('hour')!;

const initialSpot = params.get('spot');
let selected: TrailStop | undefined = isTrailStop(initialSpot) ? initialSpot : undefined;
let started = false;
let ready = false;
let picker: ReturnType<typeof makeTrailPicker> | undefined;
const tourPage = /\/mountains\/?(?:index\.html)?$/.test(location.pathname) || params.get('trail') === '1';

function resumeTrail() {
  if (!ready) return;
  G.paused = false;
  G.input.enabled = true;
  G.input.keys.clear();
  G.input.endFrame();
  G.hud.resume();
}

function chooseStop(stop: TrailStop) {
  const next = new URL(location.href);
  next.searchParams.set('trail','1');
  next.searchParams.set('spot',stop);
  const sameWorld = ready && G.settings.trailStop && G.settings.seed === trailStops[stop].seed;
  if (ready && (!sameWorld || G.mountains?.onRope || G.player.water || G.player.carried || G.dead)) {
    location.assign(next.href);
    return;
  }
  selected = stop;
  history.replaceState(null,'', next.href);
  if (!ready) { void go(); return; }
  const pose = trailPose(G.region, stop);
  G.player.teleport(pose.spawn);
  G.player.yaw = pose.yaw;
  G.player.pitch = pose.pitch;
  G.player.updateCamera(0);
  G.terrain.update(G.camera.position,400);
  G.forest.update(G.player.pos,true);
  G.settings.trailStop = stop;
  G.hud.message(trailStops[stop].title + ' · F2 — выбрать место', 'info');
  resumeTrail();
}

function showTrails() {
  if (started && !ready) return;
  picker ??= makeTrailPicker(chooseStop, resumeTrail);
  picker.open();
  if (ready) {
    G.paused = true;
    G.input.enabled = false;
    G.input.unlock();
    G.hud.showPause(false);
  }
}

document.getElementById('st-trails')!.addEventListener('click', showTrails);
document.getElementById('pause-trails')!.addEventListener('click', showTrails);
window.addEventListener('keydown', e => {
  if (picker?.dialog.open) {
    e.stopImmediatePropagation();
    if (e.code === 'F2') { e.preventDefault(); picker.dialog.close(); resumeTrail(); }
  } else if (e.code === 'F2' && ready && G.settings.trailStop && !G.hud.modal && !G.sleeping) {
    e.preventDefault();
    e.stopImmediatePropagation();
    showTrails();
  }
}, true);

async function go() {
  if (started) return;
  started = true;
  const settings: Settings = {
    seed: Number(seedInput.value) || 1,
    baseTemp: Number(params.get('temp') ?? el('st-temp').value),
    timeScale: Number(params.get('scale') ?? 12),
    startHour: Number(params.get('hour') ?? el('st-hour').value),
    weatherLock: params.get('weather'),
    noCold: params.get('nocold') === '1',
    horror: params.get('horror') ? params.get('horror') === '1' : el('st-horror').checked,
    size: Number(params.get('size') ?? 3072),
    cliffLab: params.get('cliffs') === '1',
    caveLab: params.get('cave') === '1',
    deerLab: params.get('deer') === '1',
  };
  if (selected) Object.assign(settings, {
    trailStop: selected, seed: trailStops[selected].seed, size: 1536,
    startHour: 13, timeScale: 0, weatherLock: 'clear', horror: false, noCold: true,
    caveLab: false, cliffLab: false, deerLab: false,
  });
  document.getElementById('start')!.style.display = 'none';
  const loading = document.getElementById('loading')!;
  loading.style.display = 'flex';
  if (params.get('test') === '1' || settings.deerLab) (window as any).__test = true;
  // give the browser a frame to paint the loading screen
  await new Promise((r) => setTimeout(r, 30));
  try {
    await startGame(settings);
  } catch (e) {
    loading.innerHTML = `<h2>Ошибка запуска</h2><pre style="white-space:pre-wrap;max-width:80vw">${String((e as Error)?.stack ?? e)}</pre>`;
    throw e;
  }
  loading.style.display = 'none';
  ready = true;
  document.getElementById('pause-trails')!.hidden = !selected;
  if (!(window as any).__test) {
    G.audio.start();
    G.input.lock();
    // the browser may refuse pointer lock after a long load: then ask for a click
    setTimeout(() => {
      if (!G.input.locked && !G.hud.modal) G.hud.showPause(true);
    }, 500);
  }
}

document.getElementById('st-go')!.addEventListener('click', go);
if (params.get('preview') === 'map') import('./preview').then((m) => m.previewMap(params));
else if (params.get('preview') === 'animals') import('./preview_animals').then((m) => m.previewAnimals(params));
else if (params.get('preview') === 'wood') import('./preview_wood').then((m) => m.previewWood(params));
else if (selected) go();
else if (tourPage) showTrails();
else if (params.get('autostart') === '1' || params.get('test') === '1' || params.get('snow') === '1' || params.get('cliffs') === '1' || params.get('cave') === '1' || params.get('deer') === '1') go();
