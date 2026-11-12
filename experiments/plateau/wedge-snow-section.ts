import { type Point, type MeshData } from './cavity';
import { type buildSnowLayer, type snowSettings } from './wedge-snow-layer';
export function snowSectionSvg(stone: MeshData[], snow: ReturnType<typeof buildSnowLayer> | undefined, frame: { point: Point; outward: Point }, variant: string, settings: typeof snowSettings) {
  const origin = frame.point, n = frame.outward, t = { x: -n.z, z: n.x };
  type P = { x: number; y: number }; type Segment = P[];
  const plane = (p: Point) => (p.x - origin.x) * t.x + (p.z - origin.z) * t.z;
  const project = (p: Point): P => ({ x: (p.x - origin.x) * n.x + (p.z - origin.z) * n.z, y: p.y });
  function extract(meshes: MeshData[]) {
    const segments: Segment[] = [];
    for (const m of meshes) for (let k = 0; k < m.indices.length; k += 3) {
      const tri = Array.from(m.indices.subarray(k, k + 3), id => ({ x: m.positions[id * 3], y: m.positions[id * 3 + 1], z: m.positions[id * 3 + 2] }));
      if (Math.max(...tri.map(p => p.y)) < origin.y - 12) continue;
      const points: P[] = [];
      for (let j = 0; j < 3; j++) { const a = tri[j], b = tri[(j + 1) % 3], fa = plane(a), fb = plane(b); if ((fa < 0) === (fb < 0)) continue; const q = fa / (fa - fb); points.push(project({ x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, z: a.z + (b.z - a.z) * q })); }
      if (points.length === 2 && points.every(p => p.x > -48 && p.x < 5)) segments.push(points);
    }
    return segments;
  }
  let seamMark = '';
  if (snow) for (let i = 1; i < snow.angles.length; i++) {
    const a = snow.columns[i - 1][snow.seamRow].p, b = snow.columns[i][snow.seamRow].p, fa = plane(a), fb = plane(b);
    if ((fa < 0) === (fb < 0)) continue;
    const q = fa / (fa - fb), p = project({ x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, z: a.z + (b.z - a.z) * q });
    seamMark = `<path d="M${1370 + p.x * 28},${490 + (origin.y - p.y) * 28 - 45} v90" stroke="#227db4" stroke-dasharray="4 4"/><text x="${1370 + p.x * 28 - 10}" y="${490 + (origin.y - p.y) * 28 - 60}" fill="#227db4">E</text>`; break;
  }
  const rock = extract(stone), flakes = snow ? extract([snow.inner, snow.outer, snow.cap, snow.bottom, snow.closures]) : [];
  const scale = 28, px = (x: number) => 1370 + x * scale, py = (y: number) => 490 + (origin.y - y) * scale;
  const path = (segments: Segment[]) => segments.map(([a, b]) => `M${px(a.x)},${py(a.y)} L${px(b.x)},${py(b.y)}`).join(' ');
  const unused = new Set(flakes.map((_, k) => k)), loops: P[][] = [], dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
  while (unused.size) {
    const first = unused.values().next().value as number; unused.delete(first); const chain = [...flakes[first]];
    while (dist(chain[0], chain[chain.length - 1]) > .0005) {
      let next = -1, endpoint = 0, best = .0005;
      for (const i of unused) for (let j = 0; j < 2; j++) { const d = dist(chain[chain.length - 1], flakes[i][j]); if (d < best) { next = i; endpoint = j; best = d; } }
      if (next < 0) break; unused.delete(next); chain.push(flakes[next][1 - endpoint]);
    }
    if (dist(chain[0], chain[chain.length - 1]) <= .0005) loops.push(chain);
  }
  const fills = loops.map(chain => 'M' + chain.map(p => `${px(p.x)},${py(p.y)}`).join(' L') + ' Z').join(' ');
  let grid = '', ruler = '';
  for (let x = -45; x <= 4; x++) grid += `<path d="M${px(x)},150 V860"/>`;
  for (let y = -12; y <= 12; y++) { grid += `<path d="M90,${py(origin.y + y)} H1510"/>`; if (y >= -10 && y <= 10) ruler += `<path d="M1490,${py(origin.y + y)} h${y % 5 === 0 ? 14 : 7}"/><text x="1510" y="${py(origin.y + y) + 5}" fill="#53616a" stroke="none">${y} м</text>`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" style="width:100%;height:100%;background:#f7f8fa;font:18px system-ui">
  <defs><clipPath id="plot"><rect x="90" y="150" width="1420" height="710"/></clipPath></defs>
  <text x="60" y="55" font-size="30" fill="#26343e">${variant} · разрез реальной геометрии</text>
  <text x="60" y="92" fill="#596670">Серый — неизменный камень; голубой — снежный объём. Обе оси в одном масштабе.</text>
  <g stroke="#e4e8eb" stroke-width="1" clip-path="url(#plot)">${grid}</g>
  <g clip-path="url(#plot)"><path d="${fills}" fill="#c0e0f9"/><path d="${path(rock)}" fill="none" stroke="#686f75" stroke-width="4"/><path d="${path(flakes)}" fill="none" stroke="#3486c8" stroke-width="2.5"/></g>
  <path d="M${px(0)},155 V850" stroke="#89949c" stroke-dasharray="7 7"/><text x="${px(0) - 190}" y="142" fill="#596670">Каменная кромка →</text>
  ${seamMark}<g stroke="#7a8891" fill="none">${ruler}</g>
  <text x="60" y="915" fill="#26343e">Плато: ${settings.plateau} м по нормали · край: ${settings.edge} м вверх · свес: ${settings.overhang} м · плечо E/F: R${settings.radius} м</text>
  <text x="60" y="950" fill="#596670">Снег строится заново из общей поверхности, E, линии каменной кромки и параметров. Камень не скругляется.</text></svg>`;
}
