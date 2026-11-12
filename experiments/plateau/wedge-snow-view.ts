import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeRockMaterial } from '../../src/world/cliffs';
import { noiseTexture } from '../../src/core/noisetex';
import { groundUniforms } from '../../src/world/terrain';
import { reliefGrid, chaoticTop } from './seam-relief-fixture';
import { buildWedgeAscent } from './wedge-ascent';
import { bluntTip } from './wedge-tip-profile';
import { buildWedgeRocks } from './wedge-rocks';
import { plateauRadius } from './plateau-profile';
import { type MeshData } from './cavity';
import { buildSnowLayer, snowSettings, upperNormal } from './wedge-snow-layer';
import { snowSectionSvg } from './wedge-snow-section';

type Variant = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
const descriptions: Record<Variant, string> = { A: 'Исходная геометрия, плоские нормали, прежний свет.', B: 'A + снежный объём. Прямой край, плоские нормали.', C: 'A + гладкие нормали верха: сетка и шейдер. Без объёма.', D: 'A + заполняющий свет ×2. Без объёма.', E: 'B + округлое снежное плечо R2 м. Нормали плоские.', F: 'Объём E + гладкие нормали верха/снега + заполнение ×2.' };
const source = reliefGrid(chaoticTop), upper = { ...source, heights: source.heights.map((_, k) => chaoticTop(source.x0 + k % (source.n + 1) * source.cell, source.z0 + Math.floor(k / (source.n + 1)) * source.cell)) };
const junction = buildWedgeAscent(source, upper, undefined, bluntTip), snowB = buildSnowLayer(upper, junction.accepted.seam, junction.accepted.nose, false), snowE = buildSnowLayer(upper, junction.accepted.seam, junction.accepted.nose, true);
const dressing = buildWedgeRocks(junction.cut, source, upper), center = snowB.edge(snowSettings.centerAngle), outward = snowB.planNormal(snowSettings.centerAngle), tangent = { x: -outward.z, y: 0, z: outward.x };
const deltaAngle = (x: number, z: number) => Math.atan2(Math.sin(Math.atan2(z / 180, x / 260) - snowSettings.centerAngle), Math.cos(Math.atan2(z / 180, x / 260) - snowSettings.centerAngle));
function crop(data: MeshData) { const indices: number[] = []; for (let k = 0; k < data.indices.length; k += 3) { const ids = Array.from(data.indices.subarray(k, k + 3)); if (ids.every(i => Math.abs(deltaAngle(data.positions[i * 3], data.positions[i * 3 + 2])) > .42) || ids.every(i => data.positions[i * 3 + 1] < center.y - 52) || ids.every(i => plateauRadius(data.positions[i * 3], data.positions[i * 3 + 2]) < .75)) continue; indices.push(...ids); } return { ...data, indices: new Uint32Array(indices) }; }
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false; document.body.append(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#c1d5e4');
const camera = new THREE.PerspectiveCamera(25, innerWidth / innerHeight, .1, 2000), controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false;
groundUniforms.uNoise.value = noiseTexture();
const rockMaterial = makeRockMaterial(), smoothTopMaterial = makeRockMaterial(); smoothTopMaterial.flatShading = false;
const originalHook = smoothTopMaterial.onBeforeCompile;
smoothTopMaterial.onBeforeCompile = function (shader, r) { originalHook.call(this, shader, r); shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSmoothWorldNormal;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSmoothWorldNormal = normalize(mat3(modelMatrix) * normal);'); shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSmoothWorldNormal;').replace('vec3 N = normalize(cross(dFdx(vRockPos), dFdy(vRockPos)));', 'vec3 N = normalize(vSmoothWorldNormal);'); };
smoothTopMaterial.customProgramCacheKey = () => 'snow-diagnostic-smooth-upper-v1';
const snowFlat = new THREE.MeshStandardMaterial({ color: new THREE.Color(.9, .925, .955), roughness: .88, flatShading: true }), snowSmooth = snowFlat.clone(); snowSmooth.flatShading = false;
const oldPillowMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(.9, .925, .955), roughness: .88 });
type Tagged = { mesh: THREE.Mesh; category: number };
const tagged: Tagged[] = [];
function geometry(data: MeshData & { normals?: Float32Array; colors?: number[] }) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3)); g.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const colors = data.colors ? new Float32Array(data.colors) : new Float32Array(data.positions.length); if (!data.colors) { const c = new THREE.Color('#505a65').toArray(); for (let k = 0; k < colors.length; k += 3) colors.set(c, k); } g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (data.normals) g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3)); else g.computeVertexNormals(); return g;
}
function mesh(data: MeshData & { normals?: Float32Array; colors?: number[] }, material: THREE.Material, category: number) { const m = new THREE.Mesh(geometry(data), material); m.castShadow = m.receiveShadow = true; tagged.push({ mesh: m, category }); return m; }
const stone: Record<string, THREE.Mesh> = {}, flatGeometry = new Map<string, THREE.BufferGeometry>(), smoothGeometry = new Map<string, THREE.BufferGeometry>();
const normalCache = new Map<string, number[]>();
for (const [name, data] of Object.entries(junction.cut)) {
  const top = name === 'plateau' || name === 'strip', m = mesh(crop(data), rockMaterial, top ? 2 : 1); stone[name] = m; scene.add(m);
  if (top) { flatGeometry.set(name, m.geometry); const g = m.geometry.clone(), normals = new Float32Array(data.positions.length); for (const id of g.index!.array) { const x = data.positions[id * 3], z = data.positions[id * 3 + 2], key = x + ',' + z; let n = normalCache.get(key); if (!n) { const p = upperNormal(upper, x, z); n = [p.x, p.y, p.z]; normalCache.set(key, n); } normals.set(n, id * 3); } g.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); smoothGeometry.set(name, g); }
}
const rocks = mesh(crop(dressing.rocks), rockMaterial, 1), pillows = mesh(crop(dressing.snow), oldPillowMaterial, 0); scene.add(rocks, pillows);
function snowGroup(layer: ReturnType<typeof buildSnowLayer>) { const group = new THREE.Group(), surfaces: Record<string, THREE.Mesh> = {}; for (const name of ['inner', 'outer', 'bottom', 'cap', 'closures'] as const) { const m = mesh(layer[name], snowFlat, name === 'inner' || name === 'outer' ? 2 : 0); surfaces[name] = m; group.add(m); } scene.add(group); return { group, surfaces }; }
const B = snowGroup(snowB), E = snowGroup(snowE);
const sun = new THREE.DirectionalLight('#fff0d8', 2.5); sun.position.set(-350, 550, 250); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -430, right: 430, top: 430, bottom: -430, near: 1, far: 1700 }); sun.shadow.normalBias = .6;
const fill = new THREE.HemisphereLight('#b8d5f4', '#727a83', 1.15); scene.add(sun, sun.target, fill);
let variant: Variant = 'A', viewName = 'one', section = document.querySelector<HTMLDivElement>('#section')!;
const draw = () => { if (viewName !== 'section') renderer.render(scene, camera); };
function setView(name: string) {
  viewName = name; section.style.display = name === 'section' ? 'block' : 'none'; renderer.domElement.style.visibility = name === 'section' ? 'hidden' : 'visible';
  if (name === 'section') { section.innerHTML = snowSectionSvg(Object.values(junction.cut), variant === 'B' ? snowB : variant === 'E' || variant === 'F' ? snowE : undefined, { point: center, outward }, variant, snowSettings); return; }
  const frames: Record<string, number[]> = { one: [78, 0, 18, 25], two: [55, 50, 15, 20], three: [60, -40, 10, 23] }, [out, along, high, fov] = frames[name];
  camera.position.set(center.x + outward.x * out + tangent.x * along, center.y + high, center.z + outward.z * out + tangent.z * along); controls.target.set(center.x - outward.x * 4, center.y - 4, center.z - outward.z * 4); camera.fov = fov; camera.updateProjectionMatrix(); controls.update(); draw();
}
function setVariant(value: Variant) {
  variant = value; const smooth = value === 'C' || value === 'F';
  for (const name of ['plateau', 'strip']) { stone[name].geometry = (smooth ? smoothGeometry : flatGeometry).get(name)!; stone[name].material = smooth ? smoothTopMaterial : rockMaterial; }
  B.group.visible = value === 'B'; E.group.visible = value === 'E' || value === 'F'; for (const m of Object.values(E.surfaces)) m.material = value === 'F' && m !== E.surfaces.closures ? snowSmooth : snowFlat;
  fill.intensity = value === 'D' || value === 'F' ? 2.3 : 1.15; renderer.shadowMap.needsUpdate = true;
  (document.querySelector('#variant') as HTMLSelectElement).value = value; document.querySelector('#description')!.textContent = descriptions[value];
  if (viewName === 'section') setView('section'); else draw();
}
controls.addEventListener('change', draw); document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view!)); document.querySelector<HTMLSelectElement>('#variant')!.onchange = e => setVariant((e.target as HTMLSelectElement).value as Variant); document.querySelector<HTMLInputElement>('#pillows')!.onchange = e => { pillows.visible = (e.target as HTMLInputElement).checked; renderer.shadowMap.needsUpdate = true; draw(); };
window.addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); draw(); });
const roiMaterial = (category: number) => new THREE.ShaderMaterial({ uniforms: { category: { value: category }, centerA: { value: snowSettings.centerAngle }, centerY: { value: center.y } }, vertexShader: 'varying vec3 wp; void main(){vec4 p=modelMatrix*vec4(position,1.);wp=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}', fragmentShader: `varying vec3 wp;uniform float category,centerA,centerY;void main(){float a=atan(wp.z/180.,wp.x/260.);float d=atan(sin(a-centerA),cos(a-centerA));float r=length(vec2(wp.x/260.,wp.z/180.))/(1.+.095*sin(3.*a+.7)+.055*cos(5.*a-.4));vec3 c=vec3(0.);if(abs(d)<.13){if(category>1.5&&r>.90&&r<.98)c=vec3(0.,1.,0.);if(category>.5&&category<1.5&&r>1.005&&r<1.115&&wp.y>centerY-30.&&wp.y<centerY-8.)c=vec3(1.,0.,0.);}gl_FragColor=vec4(c,1.);}`, toneMapped: false });
const ids = [roiMaterial(0), roiMaterial(1), roiMaterial(2)];
function masks() { const mats = tagged.map(t => t.mesh.material), bg = scene.background; for (const t of tagged) t.mesh.material = ids[t.category]; scene.background = new THREE.Color(0); renderer.render(scene, camera); const png = renderer.domElement.toDataURL('image/png'); tagged.forEach((t, i) => { t.mesh.material = mats[i]; }); scene.background = bg; draw(); return png; }
const params = new URLSearchParams(location.search), initialVariant = params.get('variant') || 'A', initialView = params.get('view') || 'one';
setVariant((Object.keys(descriptions).includes(initialVariant) ? initialVariant : 'A') as Variant); setView(['one', 'two', 'three', 'section'].includes(initialView) ? initialView : 'one');
(window as any).__snowDiagnostic = { ready: true, setVariant, setView, masks, renderer, camera, controls, junction, source, upper, snowB, snowE, dressing, frame: { center, outward, tangent }, settings: snowSettings, descriptions,
  state: () => ({ variant, view: viewName, snowVolume: ['B', 'E', 'F'].includes(variant), rounded: ['E', 'F'].includes(variant), smoothUpper: ['C', 'F'].includes(variant), fillIntensity: fill.intensity, sunIntensity: sun.intensity, exposure: renderer.toneMappingExposure, upperOwners: ['plateau', 'strip'], wallAlwaysFlat: rockMaterial.flatShading, snowFlat: variant !== 'F', pillowsVisible: pillows.visible }) };
