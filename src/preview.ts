// Debug page: ?preview=map&seed=1&size=3072 renders the generated region as a map.
import { Region } from './gen/region';
import { renderRegionMap, mapXY } from './ui/map';
import { BIOME_NAMES } from './gen/biomes';

export async function previewMap(params: URLSearchParams) {
  document.getElementById('start')!.style.display = 'none';
  const seed = Number(params.get('seed') ?? 1);
  const size = Number(params.get('size') ?? 3072);
  const px = Number(params.get('px') ?? 900);
  const R = new Region(seed, size);
  const info = document.createElement('pre');
  info.style.cssText = 'position:fixed;right:8px;top:8px;color:#fff;font:12px monospace;background:#0008;padding:8px;margin:0;z-index:5';
  document.body.appendChild(info);
  await R.generate((s, f) => {
    info.textContent = `${s} ${(f * 100).toFixed(0)}%`;
  });
  const cv = renderRegionMap(R, px);
  cv.style.cssText = 'position:fixed;left:0;top:0;z-index:4';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d')!;
  const dot = (x: number, z: number, col: string, label: string) => {
    const p = mapXY(R, px, x, z);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#000';
    ctx.fillText(label, p.x + 7, p.y + 4);
  };
  dot(0, 0, '#c22', 'Дом');
  if (R.sites.tower) dot(R.sites.tower.x, R.sites.tower.z, '#22c', 'Вышка');
  if (R.sites.thin) dot(R.sites.thin.x, R.sites.thin.z, '#0aa', 'тонкий лёд');
  for (const p of R.pillars) dot(p.x, p.z, '#663', '');
  const st = R.stats();
  const total = st.counts.reduce((a: number, b: number) => a + b, 0);
  info.textContent = [
    `seed ${seed} size ${size}`,
    `timings ${JSON.stringify(st.timings)}`,
    `trees ${st.trees} shrubs ${st.shrubs} rocks ${st.rocks}`,
    `lakes ${st.lakes} rivers ${st.rivers} pillars ${st.pillars}`,
    ...st.counts.map((c: number, i: number) => `${BIOME_NAMES[i].padEnd(18)} ${((c / total) * 100).toFixed(1)}%`),
    `house y ${R.sites.house.y.toFixed(1)}  tower ${R.sites.tower ? R.sites.tower.y.toFixed(1) : '-'}`,
    `h range ${R.ch.reduce((a, b) => Math.min(a, b), 1e9).toFixed(0)}..${R.ch.reduce((a, b) => Math.max(a, b), -1e9).toFixed(0)}`,
  ].join('\n');
  (window as any).__region = R;
  (window as any).__previewDone = true;
}
