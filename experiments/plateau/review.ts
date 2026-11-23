import type { WallFamily } from './slice-wall';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const buttons = (selector: string) => [...document.querySelectorAll<HTMLButtonElement>(selector)];
const stage = element('scene');
const status = element('load-state');
const openScene = element<HTMLAnchorElement>('open-scene');
const params = new URLSearchParams(location.search);
const seeds = [42, 7, 8191, 23011];

const starts = {
  overview: 'Обе горы с высоты. Нажмите «Идти», чтобы начать у подножия.',
  spawn: 'Из этой точки начнётся полный маршрут. Взгляд направлен на подъём.',
  wall: 'Перед вами выбранная боковина. К канату и пещерам можно пройти вдоль подножия.',
  den: 'Идите прямо до задней стены. Выход находится за спиной.',
  rope: 'Нажмите E, чтобы взяться за канат. W — вверх, S — вниз.',
  cave: 'Идите прямо через пещеру. Выход ведёт на второй ярус.',
  bridge: 'Идите прямо по настилу. На дальнем берегу начинается соседнее плато.',
};
type Tab = 'wall' | 'route' | 'refs';
type Start = keyof typeof starts;
type Camera = 'wall' | 'overview' | 'top';
const tabFromUrl = params.get('tab');
let tab: Tab = tabFromUrl === 'route' || tabFromUrl === 'refs' ? tabFromUrl : 'wall';
const startFromUrl = params.get('start') ?? '';
let start: Start = Object.hasOwn(starts, startFromUrl) ? startFromUrl as Start : 'overview';
const cameraFromUrl = params.get('camera');
let camera: Camera = cameraFromUrl === 'overview' || cameraFromUrl === 'top' ? cameraFromUrl : 'wall';
const wallFromUrl = params.get('wall');
let family: WallFamily = wallFromUrl === 'rounded' || wallFromUrl === 'angular' ? wallFromUrl : 'original';
const presetFromUrl = Number(params.get('preset') ?? 1);
let preset = [0, 1, 2].includes(presetFromUrl) ? presetFromUrl : 1;
const seedFromUrl = Number(params.get('seed'));
let seed = seeds.includes(seedFromUrl) ? seedFromUrl : 42;
let frame: HTMLIFrameElement | undefined;
let ready = false;
let queuedWall = false;
let pending: number | undefined;
const seedInputs = [...document.querySelectorAll<HTMLSelectElement>('[data-seed]')];
const routeWall = element<HTMLSelectElement>('route-wall');

const artworks = [
  ['Шесть боковин с одной камеры', new URL('../../docs/mountains-slice/wall-rounded/walls-seed42.png', import.meta.url).href],
  ['Оба семейства на сиде 23011', new URL('../../docs/mountains-slice/integration/new-seed.jpg', import.meta.url).href],
  ['Узкий и широкий подъёмы, верхний пик', new URL('../../docs/mountains-slice/integration/tiers-entries.jpg', import.meta.url).href],
  ['Кадры пройденного маршрута', new URL('../../docs/mountains-slice/integration/journey.jpg', import.meta.url).href],
  ['Снежный гребень угловатой боковины', new URL('../../docs/mountains-slice/wall-angular/snow-ridge-before-after.jpg', import.meta.url).href],
  ['Канат · референсы', new URL('../../docs/mountains-slice/references/rope.jpg', import.meta.url).href],
  ['Сквозная пещера · референсы', new URL('../../docs/mountains-slice/references/through.jpg', import.meta.url).href],
  ['Логово · референсы', new URL('../../docs/mountains-slice/references/den.jpg', import.meta.url).href],
  ['Подвесной мост · референсы', new URL('../../docs/mountains-slice/references/bridge.jpg', import.meta.url).href],
];
const dialog = element<HTMLDialogElement>('photo');
const detail = dialog.querySelector('img')!;
for (const [label, src] of artworks) {
  const button = document.createElement('button');
  button.type = 'button';
  const preview = document.createElement('img');
  preview.loading = 'lazy';
  preview.src = src;
  preview.alt = '';
  const caption = document.createElement('span');
  caption.textContent = label;
  button.append(preview, caption);
  button.onclick = () => {
    detail.src = src;
    detail.alt = label;
    dialog.showModal();
  };
  element('gallery').append(button);
}

const build = document.querySelector<HTMLElement>('.build-info[title]')?.title;
if (build && /^[a-f0-9]{40}$/.test(build)) {
  const report = element<HTMLAnchorElement>('report-link');
  report.href = 'https://github.com/depthd/nimbleintheforest/blob/' + build + '/docs/mountains-slice/README.md';
  report.hidden = false;
}

function selected(items: HTMLButtonElement[], match: (button: HTMLButtonElement) => boolean) {
  for (const button of items) button.setAttribute('aria-pressed', String(match(button)));
}

function sceneUrl() {
  const search = new URLSearchParams({wall: family, preset: String(preset), seed: String(seed)});
  if (tab === 'wall') search.set('view', camera);
  else search.set('start', start);
  return (tab === 'wall' ? './mountain.html?' : './route.html?') + search;
}

function paintControls() {
  selected(buttons('[data-tab]'), button => button.dataset.tab === tab);
  selected(buttons('[data-wall]'), button => button.dataset.wall === family &&
    (family === 'original' || Number(button.dataset.preset) === preset));
  selected(buttons('[data-camera]'), button => button.dataset.camera === camera);
  selected(buttons('[data-start]'), button => button.dataset.start === start);
  for (const input of seedInputs) input.value = String(seed);
  routeWall.value = family + ':' + (family === 'original' ? 1 : preset);
  element('route-hint').textContent = starts[start];
  element('interactive').hidden = tab === 'refs';
  element('wall-panel').hidden = tab !== 'wall';
  element('route-panel').hidden = tab !== 'route';
  element('reference-panel').hidden = tab !== 'refs';
  const search = new URLSearchParams({
    tab, wall: family, preset: String(preset), seed: String(seed), start, camera,
  });
  history.replaceState(null, '', '?' + search);
  if (tab !== 'refs') openScene.href = sceneUrl();
}

function openView() {
  paintControls();
  clearTimeout(pending);
  frame?.remove();
  frame = undefined;
  ready = false;
  queuedWall = false;
  if (tab === 'refs') return;
  const next = document.createElement('iframe');
  next.title = tab === 'wall' ? 'Интерактивная боковина горы' : 'Игровой маршрут по горам';
  next.allowFullscreen = true;
  next.src = sceneUrl() + '&embedded=1';
  status.hidden = false;
  status.textContent = tab === 'wall' ? 'Загрузка полноразмерной горы…' : 'Загрузка маршрута…';
  frame = next;
  stage.append(next);
  pending = window.setTimeout(() => {
    status.textContent = 'Сцена ещё загружается. Её также можно открыть в отдельной вкладке.';
  }, 30000);
}

function showWall(changed: boolean) {
  paintControls();
  if (!ready) { queuedWall = true; return; }
  frame?.contentWindow?.postMessage({type: 'mountain-review:view', family, preset, seed, camera, changed}, location.origin);
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || !frame || event.source !== frame.contentWindow) return;
  if (event.data?.type === 'mountain-review:ready') {
    clearTimeout(pending);
    ready = true;
    status.hidden = true;
    if (queuedWall && tab === 'wall') { queuedWall = false; showWall(true); }
  }
  if (event.data?.type === 'mountain-review:error') {
    clearTimeout(pending);
    status.hidden = false;
    status.textContent = 'Не удалось загрузить 3D. Откройте сцену в отдельной вкладке или посмотрите кадры.';
  }
});

for (const button of buttons('[data-tab]')) button.onclick = () => {
  const next = button.dataset.tab as Tab;
  if (next === tab) return;
  tab = next;
  openView();
};
for (const button of buttons('[data-wall]')) button.onclick = () => {
  family = button.dataset.wall as typeof family;
  preset = Number(button.dataset.preset ?? 1);
  camera = 'wall';
  showWall(true);
};
for (const button of buttons('[data-camera]')) button.onclick = () => {
  camera = button.dataset.camera as Camera;
  showWall(false);
};
for (const button of buttons('[data-start]')) button.onclick = () => {
  start = button.dataset.start as Start;
  openView();
};
for (const input of seedInputs) input.onchange = () => {
  seed = Number(input.value);
  if (tab === 'wall') showWall(true);
  else openView();
};
routeWall.onchange = () => {
  const [shape, density] = routeWall.value.split(':');
  family = shape as typeof family;
  preset = Number(density);
  openView();
};
const fullscreen = element<HTMLButtonElement>('fullscreen');
fullscreen.hidden = !document.fullscreenEnabled;
fullscreen.onclick = () => stage.parentElement?.requestFullscreen().catch(() => {
  status.hidden = false;
  status.textContent = 'Полноэкранный режим недоступен. Откройте сцену в отдельной вкладке.';
});
openView();
