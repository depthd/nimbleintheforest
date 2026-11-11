import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeRockMaterial } from '../../src/world/cliffs';
import { groundUniforms } from '../../src/world/terrain';
import { noiseTexture } from '../../src/core/noisetex';
import { reliefGrid, reliefTop } from './seam-relief-fixture';
import { plateauRadius } from './plateau-profile';
import { smoothstep } from '../../src/core/rng';
import { sampleGrid } from './seam-boundary';
import { buildWedge, wedgeProfile } from './wedge-prototype';
import { type MeshData } from './cavity';

const flat = new URLSearchParams(location.search).get('kind') === 'flat';
const source = reliefGrid();
const topAt = flat ? () => 100 : reliefTop;
const upper = { ...source, heights: source.heights.map((_, k) => topAt(source.x0 + k % (source.n + 1) * source.cell, source.z0 + Math.floor(k / (source.n + 1)) * source.cell)) };
if (flat) source.heights = source.heights.map((_, k) => {
  const x = source.x0 + k % (source.n + 1) * source.cell, z = source.z0 + Math.floor(k / (source.n + 1)) * source.cell;
  const r = plateauRadius(x, z), w = 1 - smoothstep(.96, 1.055, r);
  return (1 - w) * 5 * (1 - smoothstep(1.04, 1.23, r)) + w * 100;
});
const wedge = buildWedge(source, upper);
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
function mesh(data: MeshData) {
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3)); geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const colors = new Float32Array(data.positions.length);
  for (let k = 0; k < colors.length; k += 3) colors.set(baseColor.toArray(), k);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.computeVertexNormals();
  const m = new THREE.Mesh(geometry, material); m.castShadow = m.receiveShadow = true; return m;
}
const changed = new THREE.Group();
changed.add(mesh(wedge.plateau), mesh(wedge.strip), mesh(wedge.flank), mesh(wedge.underside)); scene.add(changed);
const positions: number[] = [], indices: number[] = [];
for (let j = 0; j <= source.n; j++) for (let i = 0; i <= source.n; i++) positions.push(source.x0 + i * source.cell, source.heights[j * (source.n + 1) + i], source.z0 + j * source.cell);
for (let j = 0; j < source.n; j++) for (let i = 0; i < source.n; i++) {const a = j * (source.n + 1) + i; indices.push(a, a + source.n + 1, a + 1, a + 1, a + source.n + 1, a + source.n + 2);}
const original = mesh({ positions: new Float32Array(positions), indices: new Uint32Array(indices) }); original.visible = false; scene.add(original);
const linePoints = [...wedge.seam.points, wedge.seam.points[0]].map(p => new THREE.Vector3(p.x, p.y + .025, p.z));
const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePoints), new THREE.LineBasicMaterial({ color: '#ff304f', depthTest: false })); line.visible = false; line.renderOrder = 10; scene.add(line);
const sun = new THREE.DirectionalLight('#fff0d8', 2.5); sun.position.set(-350, 550, 250); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -430, right: 430, top: 430, bottom: -430, near: 1, far: 1700 }); sun.shadow.normalBias = .6;
scene.add(sun, sun.target, new THREE.HemisphereLight('#b8d5f4', '#727a83', 1.15));
const focus = wedge.seam.points.reduce((best, p) => Math.abs(p.x) + (p.z < 0 ? 1000 : 0) < Math.abs(best.x) + (best.z < 0 ? 1000 : 0) ? p : best);
function setCamera(eye: number[], target: number[]) {camera.position.fromArray(eye); controls.target.fromArray(target); controls.update(); renderer.render(scene, camera);}
function view(name: string) {
  const { x, y, z } = focus;
  const views: Record<string, number[][]> = {
    top: [[x + 50, y + 80, z + 70], [x, y - 8, z + 10]],
    side: [[x + 100, y + 7, z + 110], [x, y - 10, z + 12]],
    ground: [[x + 90, 2, z + 155], [x, y - 18, z + 16]],
    walk: [[x + 2, y + 1.75, z - 9], [x, y, z + 22]],
  };
  const [eye, target] = views[name]; setCamera(eye, target);
}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.onclick = () => view(b.dataset.view!));
document.getElementById('seam')!.onchange = e => {line.visible = (e.target as HTMLInputElement).checked;};
document.getElementById('original')!.onchange = e => { original.visible = (e.target as HTMLInputElement).checked; changed.visible = !original.visible; renderer.shadowMap.needsUpdate = true; };
window.addEventListener('resize', () => {camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);});
renderer.shadowMap.needsUpdate = true; view('top');
renderer.setAnimationLoop(() => renderer.render(scene, camera));
(window as any).__wedge = { ready: true, wedge, source, upper, focus, flat, profile: wedgeProfile, view, setCamera, camera, controls, renderer,
  mark: (show: boolean) => {line.visible = show;},
  // Eye height follows the rendered top rather than an invisible old flank.
  walk: (t: number) => {const x = focus.x - 12 + 24 * t, z = focus.z - 8; const y = sampleGrid(upper, x, z).y; setCamera([x, y + 1.75, z], [x + 2, y, z + 25]);},
};
