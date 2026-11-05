import { startGame } from './game/game';
import type { Settings } from './game/ctx';
import { G } from './game/ctx';

const params = new URLSearchParams(location.search);
// The old laboratory remains available for diagnostics. Ordinary play now uses
// the same snow material in the generated world, with normal survival settings.
if (params.get('snow') === '1') {
  for (const [key, value] of Object.entries({ seed: '42', hour: '13', weather: 'clear', nocold: '1', horror: '0', scale: '0' }))
    if (!params.has(key)) params.set(key, value);
}
const el = (id: string) => document.getElementById(id) as HTMLInputElement;

const seedInput = el('st-seed');
seedInput.value = params.get('seed') ?? String(Math.floor(Math.random() * 1e6));
if (params.get('temp')) el('st-temp').value = params.get('temp')!;
if (params.get('hour')) el('st-hour').value = params.get('hour')!;

let started = false;

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
  };
  document.getElementById('start')!.style.display = 'none';
  const loading = document.getElementById('loading')!;
  loading.style.display = 'flex';
  if (params.get('test') === '1') (window as any).__test = true;
  // give the browser a frame to paint the loading screen
  await new Promise((r) => setTimeout(r, 30));
  try {
    await startGame(settings);
  } catch (e) {
    loading.innerHTML = `<h2>Ошибка запуска</h2><pre style="white-space:pre-wrap;max-width:80vw">${String((e as Error)?.stack ?? e)}</pre>`;
    throw e;
  }
  loading.style.display = 'none';
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
else if (params.get('autostart') === '1' || params.get('test') === '1' || params.get('snow') === '1') go();
