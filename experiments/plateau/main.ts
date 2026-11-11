import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Rng, Simplex2, smoothstep } from '../../src/core/rng';
import { RockSkin } from '../../src/gen/rock-skin';
import { blockTriangles } from '../../src/gen/cliffs';
import { makeRockMaterial } from '../../src/world/cliffs';
import { groundUniforms } from '../../src/world/terrain';
import { noiseTexture } from '../../src/core/noisetex';
import { subtract, interior, den } from './cavity';
import { buildAscentWalls } from './ascent-walls';
import { buildOverhang, portalAngle } from './overhang';
import { cutAscent, ascentSurface, ascent, ascentHeight, ascentCenter, ascentWidth } from './ascent';

const $ = (id: string) => document.getElementById(id)!;
const SIZE = 1400, CELL = 4, N = SIZE / CELL, HEIGHT = 100;
const SEED = 42;
const rng = new Rng(SEED), noise = new Simplex2(() => rng.next());

// The source surface stays unchanged; the cavity is subtracted from final meshes.
function heightAt(x: number, z: number) {
  const angle = Math.atan2(z / 180, x / 260);
  const outline = 1 + .095 * Math.sin(angle * 3 + .7) + .055 * Math.cos(angle * 5 - .4);
  const radius = Math.hypot(x / 260, z / 180) / outline;
  const top = HEIGHT + (1 - smoothstep(.72,.90,radius)) * (1.8 * noise.noise(x / 100, z / 100) + .45 * noise.noise(x / 35, z / 35));
  const foot = .6 * noise.noise(x / 160, z / 160);
  const wall = 1 - smoothstep(.96, 1.055, radius);
  const apron = 1 - smoothstep(1.04, 1.23, radius);
  return THREE.MathUtils.lerp(foot + 5 * apron, top, wall);
}

function geometry(positions: ArrayLike<number>, indices?: ArrayLike<number>, colors?: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(positions), 3));
  if (indices) g.setIndex(Array.from(indices));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function start() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  document.body.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c1d5e4');
  scene.fog = new THREE.Fog('#c1d5e4', 1100, 2600);
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .15, 3500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 1;
  controls.maxDistance = 1800;
  controls.maxPolarAngle = Math.PI - .01;
  controls.screenSpacePanning = true;

  // Same daylight values used by the archived mountain inspection scene.
  const sun = new THREE.DirectionalLight('#fff0d8', 2.5);
  sun.position.set(-350, 550, 250);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -430, right: 430, top: 430, bottom: -430, near: 1, far: 1700 });
  sun.shadow.normalBias = .6;
  scene.add(sun, sun.target, new THREE.HemisphereLight('#b8d5f4', '#727a83', 1.15));
  groundUniforms.uNoise.value = noiseTexture();

  const heights = new Float32Array((N + 1) ** 2);
  const positions: number[] = [], indices: number[] = [], colors: number[] = [];
  const baseColor = new THREE.Color('#505a65');
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = i * CELL - SIZE / 2, z = j * CELL - SIZE / 2;
    const y = heightAt(x, z);
    heights[j * (N + 1) + i] = y;
    positions.push(x, y, z);
    colors.push(baseColor.r, baseColor.g, baseColor.b);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  // Reuse the game's actual textured, triplanar rock/snow material unchanged.
  const material = makeRockMaterial();
  const original = { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
  const caveGround = subtract(original, colors);
  const cutGround = cutAscent(caveGround, caveGround.colors);
  const ground = new THREE.Mesh(geometry(cutGround.positions, cutGround.indices, cutGround.colors), material);
  ground.receiveShadow = true;
  scene.add(ground);

  const skin = new RockSkin({ seed: SEED, size: SIZE, n: N, cell: CELL,
    h: heights, water: new Float32Array(heights.length).fill(NaN), ox: SIZE / 2, oz: SIZE / 2,
    edgeDist: (x, z) => SIZE / 2 - Math.max(Math.abs(x), Math.abs(z)),
  }, { border: 60, minDeg: 51, exclude: (x,z)=>!portalAngle(Math.atan2(z/180,x/260)) });
  const rockPositions: number[] = [], rockColors: number[] = [];
  const colorRng = new Rng(SEED ^ 0x837);
  const soft = new THREE.Color().setRGB(.26, .27, .32, THREE.SRGBColorSpace);
  const hard = new THREE.Color().setRGB(.41, .43, .49, THREE.SRGBColorSpace);
  for (const block of skin.blocks) {
    const before = rockPositions.length;
    blockTriangles(block, rockPositions);
    const color = soft.clone().lerp(hard, block.tone).multiplyScalar(colorRng.float(.95, 1.05));
    for (let q = before; q < rockPositions.length; q += 3) rockColors.push(color.r, color.g, color.b);
  }
  for(let i=1;i<rockPositions.length;i+=3)rockPositions[i]=Math.min(99.5,rockPositions[i]);
  for(let i=1;i<skin.caps.positions.length;i+=3)skin.caps.positions[i]=Math.min(100.08,skin.caps.positions[i]);
  const caveRocks = subtract({positions:new Float32Array(rockPositions),indices:Uint32Array.from({length:rockPositions.length/3},(_,i)=>i)},rockColors);
  const cutRocks = cutAscent(caveRocks,caveRocks.colors);
  const rocks = new THREE.Mesh(geometry(cutRocks.positions, cutRocks.indices, cutRocks.colors), material);
  rocks.castShadow = rocks.receiveShadow = true;
  const caveCaps = subtract(skin.caps);
  const cutCaps = cutAscent(caveCaps);
  const caps = new THREE.Mesh(geometry(cutCaps.positions, cutCaps.indices),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(.9, .925, .955), roughness: .88 }));
  caps.castShadow = caps.receiveShadow = true;
  const rockGroup = new THREE.Group();
  rockGroup.add(rocks, caps);
  scene.add(rockGroup);

  const inner = interior(original);
  const innerColors: number[] = [];
  for(let i=0;i<inner.positions.length;i+=3) {
    const light = THREE.MathUtils.lerp(.18,.65,smoothstep(273,307,inner.positions[i]));
    innerColors.push(baseColor.r*light,baseColor.g*light,baseColor.b*light);
  }
  const caveMaterial = makeRockMaterial();
  const compile = caveMaterial.onBeforeCompile;
  caveMaterial.onBeforeCompile = (shader, renderer) => {
    compile.call(caveMaterial, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('frost * 0.92','0.0');
  };
  caveMaterial.customProgramCacheKey = () => 'plateau-den-dry-rock';
  const cave = new THREE.Mesh(geometry(inner.positions,inner.indices,innerColors),caveMaterial);
  cave.castShadow = cave.receiveShadow = true;
  scene.add(cave);
  const rampData = ascentSurface(original);
  const rampColors:number[]=[];
  for(let i=0;i<rampData.positions.length;i+=3)rampColors.push(baseColor.r,baseColor.g,baseColor.b);
  const ramp = new THREE.Mesh(geometry(rampData.positions,rampData.indices,rampColors),material);
  ramp.castShadow = ramp.receiveShadow = true;
  scene.add(ramp);
  const overhang = buildOverhang();
  const tint=(data:{positions:Float32Array;indices:Uint32Array;colors?:number[]})=>{
    const colors:number[]=[];for(let i=0;i<data.positions.length;i+=3)colors.push(baseColor.r,baseColor.g,baseColor.b);
    const mesh=new THREE.Mesh(geometry(data.positions,data.indices,data.colors??colors),material);
    mesh.castShadow=mesh.receiveShadow=true;return mesh;
  };
  const maskMesh=tint(overhang.mask),maskRocks=tint(overhang.rocks);
  const maskSnow=new THREE.Mesh(geometry(overhang.caps.positions,overhang.caps.indices),caps.material);
  maskSnow.castShadow=maskSnow.receiveShadow=true;
  const maskRockGroup=new THREE.Group();maskRockGroup.add(maskRocks,maskSnow);
  scene.add(maskMesh,maskRockGroup);
  $('maskRocks').onchange=()=>{maskRockGroup.visible=($('maskRocks') as HTMLInputElement).checked;wallRocks.visible=wallSnow.visible=maskRockGroup.visible;renderer.shadowMap.needsUpdate=true;};
  const walls=buildAscentWalls(heightAt);
  const wallMask=tint(walls.mask),wallRocks=tint(walls.rocks);
  const wallSnow=new THREE.Mesh(geometry(walls.caps.positions,walls.caps.indices),caps.material);
  wallSnow.castShadow=wallSnow.receiveShadow=true;
  scene.add(wallMask,wallRocks,wallSnow);
  const solidMeshes = [ground, rocks, caps, cave, ramp,maskMesh,maskRocks,maskSnow,wallMask,wallRocks,wallSnow];
  scene.updateMatrixWorld(true);

  const views = {
    maskSide: { eye:[450,250,480],target:[0,45,0] },
    maskUnder: { eye:[0,heightAt(0,187)+1.8,187],target:[0,65,193] },
    maskTop: { eye:[0,102,210],target:[0,98,120] },
    ascent: { eye: [-270, 190, -180], target: [-125, 40, -50] },
    ascentFoot: { eye: [-310, heightAt(-310,-50)+1.8, -50], target: [-160, 38, -5] },
    ascentTop: { eye: [16, 102, ascentCenter(16)], target: [-100, 40, ascentCenter(-100)] },
    overview: { eye: [450, 250, 490], target: [0, 48, 0] },
    foot: { eye: [40, 1.8, 300], target: [5, 55, 145] },
    top: { eye: [30, heightAt(30, 30) + 1.8, 30], target: [20, 96, -220] },
    entrance: { eye: [322, heightAt(322,0)+1.8, 0], target: [275, 7, 0] },
    inside: { eye: [279, 6.8, 0], target: [320, 6.8, 0] },
    roof: { eye: [280, heightAt(280,0)+1.8, 0], target: [330, 75, 0] },
  };
  function view(id: keyof typeof views) {
    const v = views[id];
    camera.position.fromArray(v.eye);
    controls.target.fromArray(v.target);
    controls.update();
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === id)));
  }
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.onclick = () => { view(b.dataset.view as keyof typeof views); b.blur(); });
  $('rocks').onchange = () => { rockGroup.visible = ($('rocks') as HTMLInputElement).checked; renderer.shadowMap.needsUpdate = true; };
  $('collapse').onclick = () => {
    const collapsed = $('panel').classList.toggle('collapsed');
    $('collapse').textContent = collapsed ? 'Развернуть' : 'Свернуть';
    $('collapse').setAttribute('aria-expanded', String(!collapsed));
    // Desktop uses the same collapse behavior as mobile.
    ($('panel').querySelector('.detail') as HTMLElement).hidden = collapsed;
  };
  const keys = new Set<string>();
  addEventListener('keydown', e => {
    if ((e.target as HTMLElement).matches('input,button,select')) return;
    if (['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)) { keys.add(e.code); e.preventDefault(); }
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  view('ascent');
  renderer.shadowMap.needsUpdate = true;
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
  const clock = new THREE.Clock();
  const state = { ready: true, camera, controls, view, height: HEIGHT, blocks: skin.blocks.length,
    triangles: indices.length / 3 + rockPositions.length / 9 + skin.caps.indices.length / 3,
    rockGroup, heightAt, solidMeshes, cave, den, maskMesh,maskRockGroup, maskBlocks:overhang.blocks, wallMask,wallRocks,wallBlocks:walls.blocks,
    cutTriangles: {terrain:caveGround.cutTriangles,rock:caveRocks.cutTriangles,snow:caveCaps.cutTriangles},
    ascent, ascentHeight, ascentCenter, ascentWidth, ascentCuts: {terrain:cutGround.cutTriangles,rock:cutRocks.cutTriangles,snow:cutCaps.cutTriangles},
    ray(origin: number[],direction: number[]) {
      const ray = new THREE.Raycaster(new THREE.Vector3().fromArray(origin),new THREE.Vector3().fromArray(direction).normalize(),0,1000);
      return ray.intersectObjects(solidMeshes,false).map(h=>({distance:h.distance,point:h.point.toArray()}));
    } };
  (window as any).__plateau = state;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), .05);
    camera.getWorldDirection(forward);
    right.crossVectors(forward, camera.up).normalize();
    move.set(0, 0, 0);
    if (keys.has('KeyW')) move.add(forward);
    if (keys.has('KeyS')) move.sub(forward);
    if (keys.has('KeyD')) move.add(right);
    if (keys.has('KeyA')) move.sub(right);
    if (keys.has('KeyE')) move.y += 1;
    if (keys.has('KeyQ')) move.y -= 1;
    if (move.lengthSq()) {
      move.normalize().multiplyScalar(dt * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 150 : 35));
      camera.position.add(move);
      controls.target.add(move);
    }
    controls.update();
    renderer.render(scene, camera);
    $('status').textContent = `Высота камеры: ${camera.position.y.toFixed(1)} м · ${skin.blocks.length} скальных блоков`;
  });
}

try { start(); } catch (error) {
  $('error').textContent = `Не удалось открыть сцену: ${error instanceof Error ? error.message : String(error)}`;
  $('status').textContent = 'Ошибка запуска';
  console.error(error);
}
