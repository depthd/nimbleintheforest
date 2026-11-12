import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeRockMaterial } from '../../src/world/cliffs';
import { groundUniforms } from '../../src/world/terrain';
import { noiseTexture } from '../../src/core/noisetex';
import { reliefGrid, reliefTop, chaoticTop } from './seam-relief-fixture';
import { plateauRadius, contourPoint } from './plateau-profile';
import { smoothstep } from '../../src/core/rng';
import { sampleGrid } from './seam-boundary';
import { wedgeProfile } from './wedge-prototype';
import { bluntTip, sharpTip } from './wedge-tip-profile';
import { buildWedgeAscent } from './wedge-ascent';
import { ascentCenter, ascentWidth, ascentHeight } from './ascent';
import { type MeshData } from './cavity';
import { buildWedgeRocks, surfaceRoof } from './wedge-rocks';
import { sectionAngle, sectionSvg } from './wedge-section';
import { buildRimVariant, rimSettings, type RimKind } from './wedge-rim';

const query = new URLSearchParams(location.search);
const rimParam = query.get('rim');
const rimKind = ['angular', 'stepped', 'arcs'].includes(rimParam || '') ? rimParam as RimKind : null;
const blunt = !!rimKind || query.get('nose') === 'blunt';
const kind = query.get('kind') || 'chaotic';
const flat = kind === 'flat';
const topAt = flat ? () => 100 : kind === 'chaotic' ? chaoticTop : reliefTop;
const source = reliefGrid(topAt);
const upper = { ...source, heights: source.heights.map((_, k) => topAt(source.x0 + k % (source.n + 1) * source.cell, source.z0 + Math.floor(k / (source.n + 1)) * source.cell)) };
if (flat) source.heights = source.heights.map((_, k) => {
  const x = source.x0 + k % (source.n + 1) * source.cell, z = source.z0 + Math.floor(k / (source.n + 1)) * source.cell;
  const r = plateauRadius(x, z), w = 1 - smoothstep(.96, 1.055, r);
  return (1 - w) * 5 * (1 - smoothstep(1.04, 1.23, r)) + w * 100;
});
const junction = buildWedgeAscent(source, upper, undefined, blunt ? bluntTip : sharpTip);
const wedge = junction.accepted;
const rim = rimKind ? buildRimVariant(junction, rimKind, { ...rimSettings, seed: Number(query.get('rimSeed') || rimSettings.seed) }) : undefined;
const shownCut = rim?.cut || junction.cut;
const section = document.createElement('div');
section.style.cssText = 'display:none;position:fixed;inset:0;z-index:2';
if (blunt && flat && !rim) section.innerHTML = sectionSvg(junction.cut, source);
document.body.append(section);
const sectionButton = document.querySelector<HTMLButtonElement>('[data-view="section"]')!;
sectionButton.hidden = !blunt || !flat || !!rim;
if (blunt) {
  document.querySelector('aside b')!.textContent = 'Козырёк · тупой торец';
  document.querySelector('aside b + div')!.textContent = flat ? 'Крутой профиль · плоский контроль. Скалы можно скрыть переключателем.' : 'Крутой профиль · неровный рельеф. Скалы можно скрыть переключателем.';
  document.querySelectorAll<HTMLAnchorElement>('small a[href^="?kind="]').forEach(a => {
    const url = new URL(a.href); url.searchParams.set('nose', 'blunt'); a.href = url.href;
  });
}
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
document.body.append(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#c1d5e4');
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .1, 3000);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false;
groundUniforms.uNoise.value = noiseTexture();
const material = makeRockMaterial(), baseColor = new THREE.Color('#505a65');
function mesh(data: MeshData & { colors?: number[] }) {
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3)); geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const colors = data.colors ? new Float32Array(data.colors) : new Float32Array(data.positions.length);
  if (!data.colors) for (let k = 0; k < colors.length; k += 3) colors.set(baseColor.toArray(), k);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.computeVertexNormals();
  const m = new THREE.Mesh(geometry, material); m.castShadow = m.receiveShadow = true; return m;
}
const changed = new THREE.Group();
const surfaces = Object.fromEntries(Object.entries(shownCut).map(([name, data]) => [name, mesh(data)]));
changed.add(...Object.values(surfaces)); scene.add(changed);
const roof = rim ? surfaceRoof([shownCut.plateau, shownCut.strip]) : undefined;
const dressing = buildWedgeRocks(shownCut, source, upper, roof);
const rockGroup = new THREE.Group();
const rockMesh = mesh(dressing.rocks), snowMesh = mesh(dressing.snow);
snowMesh.material = new THREE.MeshStandardMaterial({ color: new THREE.Color(.9, .925, .955), roughness: .88 });
rockGroup.add(rockMesh, snowMesh); changed.add(rockGroup);
const rocksControl = document.getElementById('rocks') as HTMLInputElement;
rocksControl.checked = query.get('rocks') !== '0';
let activeView = 'general';
rockGroup.visible = rocksControl.checked;
function setRocks(show: boolean) { rocksControl.checked = show; rockGroup.visible = show && !(rim && activeView === 'front'); renderer.shadowMap.needsUpdate = true; }
rocksControl.onchange = () => setRocks(rocksControl.checked);
const positions: number[] = [], indices: number[] = [];
for (let j = 0; j <= source.n; j++) for (let i = 0; i <= source.n; i++) positions.push(source.x0 + i * source.cell, source.heights[j * (source.n + 1) + i], source.z0 + j * source.cell);
for (let j = 0; j < source.n; j++) for (let i = 0; i < source.n; i++) {const a = j * (source.n + 1) + i; indices.push(a, a + source.n + 1, a + 1, a + 1, a + source.n + 1, a + source.n + 2);}
const original = mesh({ positions: new Float32Array(positions), indices: new Uint32Array(indices) }); original.visible = false; scene.add(original);
const linePoints = [...wedge.seam.points, wedge.seam.points[0]].map(p => new THREE.Vector3(p.x, p.y + .025, p.z));
const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePoints), new THREE.LineBasicMaterial({ color: '#ff304f', depthTest: false })); line.visible = false; line.renderOrder = 10; scene.add(line);
const sun = new THREE.DirectionalLight('#fff0d8', 2.5); sun.position.set(-350, 550, 250); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -430, right: 430, top: 430, bottom: -430, near: 1, far: 1700 }); sun.shadow.normalBias = .6;
scene.add(sun, sun.target, new THREE.HemisphereLight('#b8d5f4', '#727a83', 1.15));
const focus = { x: -235, y: 65, z: ascentCenter(-235) };
function setCamera(eye: number[], target: number[]) {camera.position.fromArray(eye); controls.target.fromArray(target); controls.update(); renderer.render(scene, camera);}
function view(name: string) {
  activeView = name;
  if (rim) {
    const isolated = name === 'front';
    rockGroup.visible = !isolated && rocksControl.checked;
    for (const key of ['plateau', 'strip', 'flank', 'restored', 'interior']) surfaces[key].visible = !isolated;
    camera.fov = isolated ? 18 : 60; camera.updateProjectionMatrix();
    if (isolated) {
      const p = contourPoint(4.35, 1.09), length = Math.hypot(p.x, p.z), dx = p.x / length, dz = p.z / length;
      setCamera([p.x + 280 * dx, 78, p.z + 280 * dz], [p.x, 78, p.z]);
      section.style.display = 'none'; return;
    }
  }
  section.style.display = name === 'section' ? 'block' : 'none';
  if (name === 'section') return;
  const views: Record<string, number[][]> = {
    general: [[-450, 235, -300], [-95, 50, -5]],
    detail: [[-335, 122, -195], [-245, 79, -110]],
    front: [[-385, 118, -40], [-230, 61, -35]],
    side: [[-300, 128, -195], [-232, 68, -37]],
    top: [[-250, 360, -35.1], [-250, 50, -35]],
    inside: [[-180, ascentHeight(-180) + 4, ascentCenter(-180)], [-245, ascentHeight(-245) + 2, ascentCenter(-245)]],
  };
  if (blunt) {
    const p = contourPoint(sectionAngle, 1.06), length = Math.hypot(p.x, p.z), dx = p.x / length, dz = p.z / length;
    views.front = [[p.x + 95 * dx, 120, p.z + 95 * dz], [p.x, 83, p.z]];
    views.side = [[p.x + 35 * dx - 95 * dz, 116, p.z + 35 * dz + 95 * dx], [p.x, 83, p.z]];
  }
  const [eye, target] = views[name]; setCamera(eye, target);
}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.onclick = () => view(b.dataset.view!));
document.getElementById('seam')!.onchange = e => {line.visible = (e.target as HTMLInputElement).checked;};
document.getElementById('original')!.onchange = e => { original.visible = (e.target as HTMLInputElement).checked; changed.visible = !original.visible; renderer.shadowMap.needsUpdate = true; };
window.addEventListener('resize', () => {camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);});
renderer.shadowMap.needsUpdate = true; view(rim && !flat ? 'general' : 'front');
renderer.setAnimationLoop(() => renderer.render(scene, camera));
const highlightMaterial = new THREE.MeshStandardMaterial({ color: '#168bd4', roughness: 1, flatShading: true });
function highlight(show: boolean) {
  rockGroup.visible = !show && rocksControl.checked && !(rim && activeView === 'front');
  for (const name of ['strip', 'underside', 'ending']) surfaces[name].material = show ? highlightMaterial : material;
  renderer.shadowMap.needsUpdate = true;
}
document.getElementById('highlight')!.onchange = e => highlight((e.target as HTMLInputElement).checked);
(window as any).__wedgeAscent = { ready: true, junction, rim, shownCut, source, upper, focus, flat, kind, blunt, profile: wedgeProfile, view, setCamera, camera, controls, renderer, surfaces,
  mark: (show: boolean) => { line.visible = show; }, highlight, setRocks, rockGroup, dressing,
  ascentCenter, ascentWidth, ascentHeight,
};

if (rim) {
  document.getElementById('rim-controls')!.hidden = false;
  document.querySelector('aside b')!.textContent = 'Кромка · три варианта';
  document.querySelector('aside b + div')!.textContent = 'Спереди — кромка без скал, верх скрыт. Остальные виды — вся гора; скалы отключаются переключателем.';
  for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-rim]')) { const url = new URL(location.href); url.searchParams.set('rim', a.dataset.rim!); a.href = url.href; a.style.fontWeight = a.dataset.rim === rimKind ? 'bold' : 'normal'; }
  document.querySelectorAll<HTMLAnchorElement>('small a[href^="http"]').forEach(a => { const url = new URL(a.href); url.searchParams.set('rim', rimKind!); a.href = url.href; });
}
