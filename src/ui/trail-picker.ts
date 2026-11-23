import { trailStops, type TrailStop } from '../game/trail-location';
import './trail-picker.css';

export function makeTrailPicker(choose: (stop: TrailStop) => void, back: () => void) {
  const dialog = document.querySelector<HTMLDialogElement>('#trail-picker')!;
  const hero = dialog.querySelector<HTMLImageElement>('.trail-hero img')!;
  const form = dialog.querySelector<HTMLButtonElement>('#trail-form')!;
  const legend = dialog.querySelector<HTMLElement>('.trail-key')!;
  const grid = dialog.querySelector<HTMLElement>('.trail-grid')!;
  const file = (name: string) => './trails/' + name + '.webp';
  hero.src = file('overview');
  form.addEventListener('click', () => {
    const simplified = form.getAttribute('aria-pressed') !== 'true';
    form.setAttribute('aria-pressed', String(simplified));
    hero.src = file(simplified ? 'form' : 'overview');
    form.textContent = simplified ? 'Вернуть игровой вид' : 'Показать форму';
    hero.alt = simplified ? 'Ярусы, стены и мост той же горы с обозначением границ' : 'Вид на горные ярусы из игры';
    for (const stop of ['wide','cut']) {
      const thumbnail = grid.querySelector<HTMLImageElement>(`[data-stop="${stop}"] img`)!;
      thumbnail.src = file(simplified ? stop+'-form' : stop);
    }
    legend.hidden = !simplified;
  });
  const visit = (stop: TrailStop) => { dialog.close(); choose(stop); };
  dialog.querySelector('#trail-overview')!.addEventListener('click', () => visit('overview'));
  const hollows = document.createElement('div');
  hollows.className = 'trail-hollows';
  for (const stop of Object.keys(trailStops) as TrailStop[]) {
    if (stop === 'overview') continue;
    const card = document.createElement('button');
    card.className = 'trail-card';
    card.dataset.stop = stop;
    const img = document.createElement('img');
    img.alt = '';
    img.src = file(stop);
    const name = document.createElement('span');
    name.textContent = trailStops[stop].title;
    card.append(img,name);
    card.addEventListener('click', () => visit(stop));
    if (stop === 'den') grid.append(hollows);
    (stop === 'den' || stop === 'bear' ? hollows : grid).append(card);
  }
  const leave = () => { dialog.close(); back(); };
  dialog.querySelector('#trail-back')!.addEventListener('click', leave);
  dialog.addEventListener('cancel', e => { e.preventDefault(); leave(); });
  return { open: () => { if (!dialog.open) dialog.showModal(); }, dialog };
}
