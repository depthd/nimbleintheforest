import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createCrossingPlan, bakeCrossing } from './crossing';
import { createCavePlan, bakeCave, type CaveWorld } from './cave';

type Point = { x: number; y: number; z: number };
type MeshData = { positions: Float32Array; indices: Uint32Array };
type Baked = Extract<ReturnType<typeof bakeCrossing>, { ok: true }>['world'];
const $ = (id: string) => document.getElementById(id)!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
$('world').append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#aec3ce');
scene.fog = new THREE.Fog('#aec3ce', 550, 1600);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .12, 2500);
const light = new THREE.DirectionalLight('#fff1d8', 2.5);
light.position.set(-180, 350, 200);
light.castShadow = true;
light.shadow.mapSize.set(2048, 2048);
Object.assign(light.shadow.camera, { left: -340, right: 340, top: 340, bottom: -340, near: 1, far: 1000 });
light.shadow.normalBias = .35;
scene.add(light, light.target, new THREE.HemisphereLight('#d9edf7', '#59626b', 1.5));
let group = new THREE.Group(), guides = new THREE.Group();
scene.add(group, guides);
let data: Baked, plan: ReturnType<typeof createCrossingPlan>;
let cave: CaveWorld;
const allRoutes = () => [...data.routes, { id: 'cave', kind: 'surface', points: cave.route, width: 6, maxSlope: .1 }];
let physics: RAPIER.World, body: RAPIER.RigidBody, collider: RAPIER.Collider, controller: RAPIER.KinematicCharacterController;
let ready = false, walking = false, manual = false, building = false, auto = false;
let yaw = 0, pitch = 0, verticalSpeed = 0, grounded = false;
let vx = 0, vz = 0, elapsed = 0, dirty = true;
const keys = new Set<string>();
const pos = () => { const p = body.translation(); return { x: p.x, y: p.y - .9, z: p.z }; };
const look = (p: Point, q: Point) => { yaw = Math.atan2(-(q.x - p.x), -(q.z - p.z)); pitch = Math.atan2(q.y - p.y, Math.hypot(q.x - p.x, q.z - p.z)); };
function eye() {
  if (!walking) return;
  const p = body.translation();
  camera.position.set(p.x, p.y + .65, p.z);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  dirty = true;
}
function mesh(raw: MeshData, kind: 'terrain' | 'bridge' | 'cave' = 'terrain') {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(raw.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(raw.indices, 1));
  geo.computeVertexNormals();
  if (kind === 'terrain') {
    const colors = new Float32Array(raw.positions.length), normals = geo.getAttribute('normal');
    const snow = new THREE.Color('#dbe5e8'), rock = new THREE.Color('#68767d');
    for (let i = 0; i < raw.positions.length / 3; i++) {
      const n = Math.abs(normals.getY(i));
      const c = rock.clone().lerp(snow, THREE.MathUtils.smoothstep(n, .45, .94));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  const object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: kind === 'bridge' ? '#87684b' : kind === 'cave' ? '#5f6268' : '#ffffff', vertexColors: kind === 'terrain', roughness: 1 }));
  object.castShadow = object.receiveShadow = true;
  group.add(object);
  return object;
}
function dispose(g: THREE.Group) {
  for (const object of [...g.children]) {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      object.geometry.dispose();
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) m.dispose();
    }
    g.remove(object);
  }
}
function teleport(p: Point, target?: Point) {
  body.setTranslation({ x: p.x, y: p.y + .96, z: p.z }, true);
  body.setNextKinematicTranslation(body.translation());
  physics.step();
  verticalSpeed = vx = vz = 0; grounded = false;
  walking = true;
  if (target) look(p, target);
  else pitch = 0;
  eye();
}
function view(id: string) {
  auto = false; keys.clear();
  if (id === 'overview') {
    walking = false;
    const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(data.terrain.positions, 3)), center = box.getCenter(new THREE.Vector3()), span = box.getSize(new THREE.Vector3());
    camera.position.set(center.x + span.x * .62, center.y + span.y + span.z * .54, center.z + span.z * .85);
    camera.lookAt(center.x, center.y + 10, center.z);
    $('status').textContent = 'Общий вид · два маршрута пересекаются на разных высотах';
  } else if (id === 'roof') {
    const witness = cave.plan.roofWitness;
    const bridge = data.routes.find(r => r.id === 'bridge')!;
    teleport({ x: witness.x, y: cave.realization.exteriorY, z: witness.z }, bridge.points[0]);
    $('status').textContent = 'Поверхность горы над пещерой · внутренний пол остаётся внизу';
  } else if (id === 'entrance' || id === 'cave' || id === 'exit') {
    const volume = cave.plan.volume, floor = volume.floor + volume.tiltZ * volume.centerZ;
    const outside = { x: volume.maxX + 5, y: floor, z: volume.centerZ };
    const inside = { x: volume.minX + 10, y: floor, z: volume.centerZ };
    if (id === 'entrance') teleport(outside, inside);
    else teleport(inside, id === 'exit' ? outside : { ...inside, x: volume.minX });
    $('status').textContent = id === 'entrance' ? 'Вход из нижнего ущелья · та же сцена' : id === 'exit' ? 'Вид наружу из пещеры' : 'Тупиковая пещера · земля над потолком сохранена';
  } else if (id === 'lookback') {
    const crossing = data.realization.crossing, bridge = data.routes.find(r => r.id === 'bridge')!;
    const valley = data.regions.find(r => r.id === 'valley')!;
    teleport({ x: crossing.x, y: crossing.deckY, z: crossing.z + bridge.width * .35 }, valley.core);
    $('status').textContent = 'С моста виден прежний нижний путь';
  } else if (id === 'interior') {
    const route = data.routes.find(r => r.id === 'east')!;
    teleport(route.points[route.points.length - 2], route.points[route.points.length - 1]);
    $('status').textContent = 'Внутри верхнего района · после входного поворота';
  } else {
    const route = data.routes.find(r => r.id === (id === 'above' ? 'bridge' : 'lower'))!;
    const crossing = data.realization.crossing;
    if (id === 'above') {
      teleport({ x: crossing.x, y: crossing.deckY, z: crossing.z }, route.points[route.points.length - 1]);
    } else {
      const samples: Point[] = [];
      for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1], b = route.points[i], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
        for (let j = 0; j <= n; j++) { const t = j / n; samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }); }
      }
      const offset = id === 'approach' ? 52 : 26;
      const near = samples.reduce((a, b) => Math.hypot(a.x - crossing.x, a.z - crossing.z - offset) < Math.hypot(b.x - crossing.x, b.z - crossing.z - offset) ? a : b);
      teleport(near, { x: crossing.x, y: id === 'approach' ? crossing.terrainY + 12 : crossing.deckY - 2, z: crossing.z });
    }
    $('status').textContent = id === 'above' ? 'На мосту · нижний путь остаётся под ногами' : id === 'approach' ? 'Подход по нижней долине · мост виден заранее' : 'Нижний путь · мост над ущельем';
  }
  dirty = true;
}
function step(dx: number, dz: number, dt = 1 / 60) {
  const acc = 1 - Math.exp(-dt * (grounded ? 5 : .8));
  vx += (dx - vx) * acc; vz += (dz - vz) * acc;
  verticalSpeed = Math.max(-30, verticalSpeed - 9.81 * dt);
  controller.computeColliderMovement(collider, { x: vx * dt, y: verticalSpeed * dt, z: vz * dt });
  const delta = controller.computedMovement(), p = body.translation();
  body.setNextKinematicTranslation({ x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z });
  physics.step(); grounded = controller.computedGrounded();
  if (grounded && verticalSpeed < 0) verticalSpeed = -.5;
  eye();
}
function keyboardStep() {
  if (!ready || !walking || auto) return;
  const f = Number(keys.has('w')) - Number(keys.has('s')), r = Number(keys.has('d')) - Number(keys.has('a'));
  const norm = Math.max(1, Math.hypot(f, r)), speed = keys.has('shift') ? 4.58 : 1.72;
  step((-Math.sin(yaw) * f + Math.cos(yaw) * r) * speed / norm, (-Math.cos(yaw) * f - Math.sin(yaw) * r) * speed / norm);
}
async function traverse(id: string, reverse = false, reset = true) {
  const route = allRoutes().find(r => r.id === id);
  if (!route) throw new Error(`Unknown route ${id}`);
  const points = reverse ? [...route.points].reverse() : [...route.points];
  if (reset) teleport(points[0], points[1]);
  else if (Math.hypot(pos().x - points[0].x, pos().y - points[0].y, pos().z - points[0].z) > 3)
    return { ok: false, id, reverse, reason: 'discontinuous-start', reached: 0, total: points.length, position: pos() };
  auto = true; walking = true;
  let ticks = 0, reached = 0, stuck = 0, previous = Infinity, maxHeightError = 0;
  while (reached < points.length && ticks++ < 120000 && auto) {
    const p = pos(), q = points[reached], dx = q.x - p.x, dz = q.z - p.z, distance = Math.hypot(dx, dz);
    if (distance < .75) {
      const error = Math.abs(p.y - q.y); maxHeightError = Math.max(maxHeightError, error);
      if (error > 1.1) break;
      reached++; previous = Infinity; stuck = 0; continue;
    }
    stuck = distance > previous - .001 ? stuck + 1 : 0; previous = distance;
    if (stuck > 240) break;
    look(p, q); pitch = THREE.MathUtils.clamp(pitch, -.3, .3);
    step(dx / distance * 4.58, dz / distance * 4.58);
    if (ticks % 1000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  auto = false;
  for (let i = 0; i < 30; i++) step(0, 0);
  const end = points[points.length - 1], final = pos();
  const finalHeightError = Math.abs(final.y - end.y);
  const finalDistance = Math.hypot(final.x - end.x, final.z - end.z);
  return { ok: reached === points.length && grounded && finalHeightError < 1.1 && finalDistance < 1.5,
    id, reverse, ticks, reached, total: points.length, maxHeightError, finalHeightError, finalDistance, grounded, position: final };
}
async function generate(seed: number) {
  if (building) return;
  building = true; auto = false;
  $('veil').style.display = 'grid';
  $('veil').textContent = 'Создаём горный фрагмент…';
  await new Promise(resolve => requestAnimationFrame(resolve));
  try {
    const nextPlan = createCrossingPlan(seed), result = bakeCrossing(nextPlan);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const cavity = bakeCave(result.world, createCavePlan(nextPlan));
    if (!cavity.ok) throw new Error(JSON.stringify(cavity.issues));
    ready = false; data = result.world; plan = nextPlan; cave = cavity.world;
    dispose(group); dispose(guides); physics?.free();
    mesh(cave.terrain); mesh(data.bridge, 'bridge'); mesh(cave.cave, 'cave');
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), new THREE.MeshStandardMaterial({ color: '#6b8997', roughness: .85 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -.2; water.receiveShadow = true; group.add(water);
    for (const [i, route] of allRoutes().entries()) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(route.points.map(p => new THREE.Vector3(p.x, p.y + .3, p.z))), new THREE.LineBasicMaterial({ color: ['#f7b76c', '#93d2bb', '#f4d6a4', '#cedaff'][i % 4] }));
      guides.add(line);
    }
    guides.visible = false;
    physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    for (const raw of [cave.terrain, data.bridge, cave.cave]) physics.createCollider(RAPIER.ColliderDesc.trimesh(raw.positions, raw.indices));
    body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    collider = physics.createCollider(RAPIER.ColliderDesc.capsule(.6, .3), body);
    controller = physics.createCharacterController(.03);
    controller.setMaxSlopeClimbAngle(48 * Math.PI / 180);
    controller.setMinSlopeSlideAngle(55 * Math.PI / 180);
    controller.enableAutostep(.32, .15, false);
    controller.enableSnapToGround(.35);
    ready = true; view('overview');
    renderer.shadowMap.needsUpdate = true;
    $('seed').setAttribute('value', String(seed));
    ($('seed') as HTMLInputElement).value = String(seed);
    $('veil').style.display = 'none';
  } catch (error) {
    if (ready) $('veil').style.display = 'none';
    throw error;
  } finally { building = false; }
}
$('generate').onclick = () => {
  const seed = Number(($('seed') as HTMLInputElement).value);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) { $('status').textContent = 'Seed — целое число от 0 до 4294967295.'; return; }
  generate(seed).catch(error => { $('status').textContent = `Не удалось создать фрагмент: ${error.message}`; if (!ready) $('veil').textContent = $('status').textContent; });
};
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.onclick = () => view(button.dataset.view!));
$('walk').onclick = () => { const r = data.routes.find(r => r.id === 'ascent')!; auto = false; teleport(r.points[0], r.points[1]); $('status').textContent = 'У подножия · WASD — шагать, тянуть мышью — смотреть'; };
$('routes').onclick = () => { guides.visible = !guides.visible; $('routes').textContent = guides.visible ? 'Скрыть пути' : 'Показать пути'; dirty = true; };
$('collapse').onclick = () => { const closed = $('panel').classList.toggle('collapsed'); $('collapse').textContent = closed ? 'Развернуть' : 'Свернуть'; $('collapse').setAttribute('aria-expanded', String(!closed)); };
let dragging = false, lastX = 0, lastY = 0;
renderer.domElement.onpointerdown = e => { dragging = true; lastX = e.clientX; lastY = e.clientY; renderer.domElement.setPointerCapture(e.pointerId); };
renderer.domElement.onpointermove = e => {
  if (!dragging || !walking || auto) return;
  yaw -= (e.clientX - lastX) * .004; pitch = THREE.MathUtils.clamp(pitch - (e.clientY - lastY) * .004, -1.2, 1.2);
  lastX = e.clientX; lastY = e.clientY; eye();
};
renderer.domElement.onpointerup = renderer.domElement.onpointercancel = () => { dragging = false; };
window.addEventListener('keydown', e => { if (e.target instanceof HTMLInputElement) return; if (['w','a','s','d','shift'].includes(e.key.toLowerCase())) { e.preventDefault(); keys.add(e.key.toLowerCase()); } });
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => {
  button.onpointerdown = e => { e.preventDefault(); keys.add(button.dataset.move!); button.setPointerCapture(e.pointerId); };
  button.onpointerup = button.onpointercancel = () => keys.delete(button.dataset.move!);
});
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); dirty = true; });
(window as any).__crossing = {
  get ready() { return ready; }, get position() { return pos(); }, get plan() { return plan; },
  get routes() { return allRoutes(); }, get cavePlan() { return cave.plan; }, get caveRealization() { return cave.realization; }, view, generate, traverse, teleport,
  manual(value: boolean) { manual = value; }, steps(count: number) { for (let i = 0; i < count; i++) keyboardStep(); },
  camera() { return { position: camera.position.toArray(), direction: camera.getWorldDirection(new THREE.Vector3()).toArray() }; },
};
let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  if (!manual && !auto && ready) { elapsed += Math.min((now - last) / 1000, .1); while (elapsed >= 1 / 60) { keyboardStep(); elapsed -= 1 / 60; } }
  last = now;
  if (dirty) { renderer.render(scene, camera); dirty = false; }
}
await RAPIER.init();
await generate(Number(new URLSearchParams(location.search).get('seed') ?? 42));
requestAnimationFrame(frame);
