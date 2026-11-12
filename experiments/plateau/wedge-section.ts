import { type MeshData } from './cavity';
import { contourPoint } from './plateau-profile';
import { wedgeProfile } from './wedge-prototype';

// The same exposed portion is used by the bare front/side cameras.
export const sectionAngle = 4.1;
export function sectionSvg(meshes: Record<string, MeshData>) {
  const q = contourPoint(sectionAngle), length = Math.hypot(q.x, q.z), dx = q.x / length, dz = q.z / length;
  type P = { r: number; y: number };
  const segments: P[][] = [];
  // Intersect the actual rendered triangles with a vertical radial plane.
  for (const mesh of Object.values(meshes)) for (let k = 0; k < mesh.indices.length; k += 3) {
    const points: P[] = [];
    for (let i = 0; i < 3; i++) {
      const a = mesh.indices[k + i] * 3, b = mesh.indices[k + (i + 1) % 3] * 3, p = mesh.positions;
      const fa = -dz * p[a] + dx * p[a + 2], fb = -dz * p[b] + dx * p[b + 2];
      if ((fa < 0) === (fb < 0)) continue;
      const t = fa / (fa - fb), x = p[a] + t * (p[b] - p[a]), z = p[a + 2] + t * (p[b + 2] - p[a + 2]);
      points.push({ r: x * dx + z * dz, y: p[a + 1] + t * (p[b + 1] - p[a + 1]) });
    }
    if (points.length === 2 && points.every(p => p.r > 0)) segments.push(points);
  }
  const all = segments.flat(), top = all.filter(p => Math.abs(p.y - 100) < .001).sort((a, b) => b.r - a.r)[0];
  const bottom = all.filter(p => Math.abs(p.y - 96) < .001).sort((a, b) => b.r - a.r)[0];
  if (!top || !bottom) throw Error('Flat blunt section must contain both tip corners');
  const e = contourPoint(sectionAngle, wedgeProfile.seam), er = e.x * dx + e.z * dz;
  const x = (r: number) => 430 + (top.r - r) * 11, y = (v: number) => 180 + (100 - v) * 11;
  const path = segments.map(([a, b]) => `M${x(a.r)},${y(a.y)} L${x(b.r)},${y(b.y)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" style="width:100%;height:100%;background:#f5f6f7;font:22px system-ui;color:#24303a">
    <defs><clipPath id="profile-clip"><rect x="390" y="140" width="940" height="740"/></clipPath></defs>
    <text x="80" y="70" font-size="32" fill="#24303a">Разрез козырька · без камней и шума</text>
    <text x="80" y="110" fill="#56626c">Линии получены пересечением готовой поверхности. Масштаб по обеим осям одинаковый.</text>
    <g clip-path="url(#profile-clip)"><path d="${path}" fill="none" stroke="#273946" stroke-width="4" stroke-linecap="round"/>
    <path d="M${x(er)},145 V850" stroke="#84949e" stroke-width="2" stroke-dasharray="8 8"/></g>
    <path d="M${x(top.r)},${y(top.y)} L${x(bottom.r)},${y(bottom.y)}" stroke="#da733c" stroke-width="6"/>
    <circle cx="${x(top.r)}" cy="${y(top.y)}" r="5" fill="#da733c"/><circle cx="${x(bottom.r)}" cy="${y(bottom.y)}" r="5" fill="#da733c"/>
    <path d="M410,180 H310 V224 H410" fill="none" stroke="#da733c" stroke-width="2"/>
    <text x="240" y="211" fill="#ad5425">4 м</text>
    <text x="80" y="285" fill="#24303a">Верхняя точка на месте</text>
    <text x="80" y="320" fill="#24303a">Нижняя — на 0,5 м внутрь</text>
    <text x="${x(er) + 12}" y="150" fill="#56626c">E · без изменений</text>
    <text x="80" y="935" fill="#56626c">Изменён только конец низа. Дальше дуга и нижний стык прежние.</text>
  </svg>`;
}
