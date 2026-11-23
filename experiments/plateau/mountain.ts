import * as THREE from 'three';
import { makeWallGroup, measureWallSnow, wallParameters, type WallFamily } from './slice-wall';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeRockMaterial } from '../../src/world/cliffs';
import { groundUniforms } from '../../src/world/terrain';
import { noiseTexture } from '../../src/core/noisetex';
import { reliefGrid } from './seam-relief-fixture';
import { buildWedgeAscent } from './wedge-ascent';
import { bluntTip } from './wedge-tip-profile';
import { buildMountainMasses, mountainEnding, mountainSnowProfile, plateauTop } from './mountain-shape';
import { type GroveSite, buildMountainGroves } from './mountain-groves';
import { subtract, interior, type MeshData } from './cavity';
import { ascentCenter } from './ascent';
import { ringPoint, snowSettings, upperNormal } from './wedge-snow-layer';
import { sampleGrid } from './seam-boundary';
import { radialSurface } from './wedge-rocks';
import { buildMountainSnow, mountainRim } from './mountain-snow';

import { mountainTiers, raisedFlank, reservedForUpper, supportedSite, worldPlan, type Tier } from './mountain-tiers';

const stacked=new URLSearchParams(location.search).get('tiers')!=='1';
const status=document.querySelector<HTMLElement>('#status')!;
const frame=()=>new Promise<void>(ok=>requestAnimationFrame(()=>ok()));
async function start(){
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;document.body.append(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#c1d5e4');
  const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.2,stacked?10500:5000),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.maxDistance=stacked?3300:1800;
  const sun=new THREE.DirectionalLight('#fff0d8',2.5);sun.position.set(-350,550,250);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-430,right:430,top:430,bottom:-430,near:1,far:1700});if(stacked){
    sun.position.multiplyScalar(1.85);
    Object.assign(sun.shadow.camera,{left:-760,right:760,top:760,bottom:-760,far:3000});
    sun.shadow.mapSize.set(3072,3072);
  }
  sun.shadow.normalBias=.6;const fill=new THREE.HemisphereLight('#b8d5f4','#727a83',2.3);scene.add(sun,sun.target,fill);groundUniforms.uNoise.value=noiseTexture();
  await frame();
  const source=reliefGrid(plateauTop),upper={...source,heights:source.heights.map((_,k)=>plateauTop(source.x0+k%(source.n+1)*source.cell,source.z0+Math.floor(k/(source.n+1))*source.cell))};
  const junction=buildWedgeAscent(source,upper,mountainEnding,bluntTip);
  const surfaces=Object.fromEntries(Object.entries(junction.cut).map(([k,m])=>[k,subtract(m)]));
  const rawPositions=new Float32Array(source.heights.length*3),rawIndices:number[]=[];for(let k=0;k<source.heights.length;k++)rawPositions.set([source.x0+k%(source.n+1)*source.cell,source.heights[k],source.z0+Math.floor(k/(source.n+1))*source.cell],k*3);
  for(let z=0;z<source.n;z++)for(let x=0;x<source.n;x++){const a=z*(source.n+1)+x;rawIndices.push(a,a+source.n+1,a+1,a+1,a+source.n+1,a+source.n+2);}
  const cave=interior({positions:rawPositions,indices:new Uint32Array(rawIndices)});
  const material=makeRockMaterial(),smooth=makeRockMaterial();smooth.flatShading=false;
  const hook=smooth.onBeforeCompile;smooth.onBeforeCompile=function(shader,r){hook.call(this,shader,r);shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSmoothWorldNormal;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvSmoothWorldNormal=inverseTransformDirection(transformedNormal,viewMatrix);');shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vSmoothWorldNormal;').replace('vec3 N = normalize(cross(dFdx(vRockPos), dFdy(vRockPos)));','vec3 N = normalize(vSmoothWorldNormal);');};smooth.customProgramCacheKey=()=> 'snow-diagnostic-smooth-upper-v1';
  const snowMaterial=new THREE.MeshStandardMaterial({color:new THREE.Color(.9,.925,.955),roughness:.88});
  // At the upper exit the snow layer tapers into the turning route.
  const snowTopMaterial=snowMaterial.clone();snowTopMaterial.polygonOffset=true;snowTopMaterial.polygonOffsetFactor=-1;snowTopMaterial.polygonOffsetUnits=-1;
  const groups={stone:new THREE.Group(),rocks:new THREE.Group(),snow:new THREE.Group(),trees:new THREE.Group(),cave:new THREE.Group()};Object.values(groups).forEach(g=>scene.add(g));
  function mesh(data: MeshData & { normals?: Float32Array; colors?: number[] }, mat: THREE.Material, grid?: typeof source) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions,3));
    g.setIndex(new THREE.BufferAttribute(data.indices,1));
    if (data.normals) {
      g.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));
    } else if (grid) {
      const normals=new Float32Array(data.positions.length);
      const d=snowSettings.normalRadius, span=grid.n*grid.cell-d-.001;
      for(let k=0;k<normals.length;k+=3) {
        const x=THREE.MathUtils.clamp(data.positions[k],grid.x0+d,grid.x0+span);
        const z=THREE.MathUtils.clamp(data.positions[k+2],grid.z0+d,grid.z0+span);
        const n=upperNormal(grid,x,z,d);
        normals.set([n.x,n.y,n.z],k);
      }
      g.setAttribute('normal',new THREE.BufferAttribute(normals,3));
    } else {
      g.computeVertexNormals();
    }
    const colors=data.colors?new Float32Array(data.colors):new Float32Array(data.positions.length);
    if(!data.colors) {
      const color=new THREE.Color('#505a65').toArray();
      for(let k=0;k<colors.length;k+=3)colors.set(color,k);
    }
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));
    const result=new THREE.Mesh(g,mat);
    result.castShadow=result.receiveShadow=true;
    return result;
  }
  function rockWithFrost(amount:number) {
    const stone=makeRockMaterial(),compile=stone.onBeforeCompile;
    stone.onBeforeCompile=function(shader,renderer) {
      compile.call(this,shader,renderer);
      shader.fragmentShader=shader.fragmentShader.replace('frost * 0.92','frost * '+amount.toFixed(2));
    };
    stone.customProgramCacheKey=()=> 'plateau-rock-frost-'+amount;
    return stone;
  }
  function cliffDressingMaterial() {
    const mat = makeRockMaterial();
    const compile = mat.onBeforeCompile;
    mat.onBeforeCompile = function(shader, renderer) {
      compile.call(this, shader, renderer);
      const varying = 'varying vec3 vRockFinish;\nvarying vec3 vWornNormal;';
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 rockFinish;\n' + varying)
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRockFinish = rockFinish; vWornNormal = normalize(normalMatrix * normal);');
      // Large mineral patches change tone across a whole face. Interpolating
      // across triangular cells leaves broad quiet areas and a broken grain.
      const mineralField = `
        float mineralGrain(vec2 q) {
          vec2 i = floor(q), f = fract(q);
          vec2 diagonal = f.x > f.y ? vec2(1.0,0.0) : vec2(0.0,1.0);
          vec3 ids = vec3(dot(i,vec2(17.0,61.0)), dot(i+diagonal,vec2(17.0,61.0)), dot(i+1.0,vec2(17.0,61.0)));
          vec3 values = fract(sin(ids) * 17389.57);
          return dot(values,vec3(1.0-max(f.x,f.y),abs(f.x-f.y),min(f.x,f.y)));
        }`;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + varying + mineralField)
        .replace('float frost =', `
          vec2 bed = vec2(0.72*vRockPos.x - 0.53*vRockPos.z, vRockPos.y + 0.22*vRockPos.x + 0.34*vRockPos.z);
          vec2 mineral = texture2D(uNoise, bed * vec2(0.003,0.010)).rg;
          float bedding = smoothstep(0.28,0.72,mineral.r + 0.14*(mineral.g-0.5));
          vec2 strike = vec2(0.82*vRockPos.x-0.58*vRockPos.z, vRockPos.y-0.41*vRockPos.x+0.20*vRockPos.z);
          float mineralValue = 0.65 * mineralGrain(strike * vec2(0.057,0.076))
                      + 0.24 * mineralGrain(strike * 0.18 + 14.3) + 0.11 * bedding;
          float warm = smoothstep(0.41,0.73,mineralValue);
          col *= mix(vec3(0.76,0.85,1.06),vec3(1.23,1.06,0.99),warm);
          col *= 0.78 + 0.4 * mineralValue;
          col *= 0.62 + 0.38 * smoothstep(0.012,0.085,vRockFinish.z);
          float frost =`)
        .replace('frost * 0.92', 'frost * 0.29 * vRockFinish.x')
        .replace('#include <normal_fragment_begin>',
          '#include <normal_fragment_begin>\nnormal = normalize(mix(normal, normalize(vWornNormal), vRockFinish.y));');
    };
    mat.customProgramCacheKey = () => 'mountain-jointed-rock';
    return mat;
  }
  status.textContent = 'Снежный край и плато…';
  await frame();
  const rim = mountainRim(junction);
  const snow = buildMountainSnow(upper, junction, [surfaces.plateau, surfaces.strip], mountainSnowProfile);
  const roof = (x: number, z: number) => snow.field(x, z).y;
  const tiers = mountainTiers(stacked, roof);
  const baseStone = new THREE.Group(),
    upperStone = new THREE.Group(),
    snowCover = new THREE.Group();
  if (stacked) {
    // Extend the flat lab ground beyond the broad camera views. Its four quads
    // meet the existing mesh edge to edge, without overlapping the cave floor.
    const near = (source.n * source.cell) / 2,
      far = 9500;
    const border = (size: number) => [-size, 0, -size, -size, 0, size, size, 0, size, size, 0, -size];
    const indices: number[] = [];
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      indices.push(i, i + 4, next + 4, i, next + 4, next);
    }
    const ground = mesh(
      { positions: new Float32Array([...border(near), ...border(far)]), indices: new Uint32Array(indices) },
      smooth,
    );
    ground.name = 'horizon';
    ground.castShadow = false;
    baseStone.add(ground);
    scene.fog = new THREE.Fog('#c1d5e4', 2300, 6800);
  }
  for (const [name, data] of Object.entries(surfaces)) {
    const grid =
      name === 'plateau' || name === 'strip'
        ? upper
        : name === 'flank' || name === 'restored'
          ? source
          : undefined;
    const m = mesh(data, grid ? smooth : material, grid);
    m.name = name;
    baseStone.add(m);
    if (stacked) {
      // Upper tiers use the solid flank before the cave cut.
      const upperMesh =
        name === 'flank' || name === 'restored'
          ? mesh(raisedFlank(junction.cut[name]), smooth, source)
          : m.clone();
      upperMesh.name = name;
      upperStone.add(upperMesh);
    }
  }
  for (const [name, data] of [
    ['top', snow.top],
    ['bottom', snow.bottom],
    ['cap', snow.cap],
  ] as const) {
    const m = mesh(data, name === 'top' ? snowTopMaterial : snowMaterial);
    m.name = 'snow-' + name;
    m.castShadow = name !== 'bottom';
    snowCover.add(m);
  }
  function place(part: THREE.Object3D, tier: Tier, category: THREE.Group) {
    part.name = tier.name;
    part.position.set(tier.x, tier.y, tier.z);
    part.rotation.y = tier.yaw;
    part.scale.set(tier.width, tier.rise, tier.width);
    category.add(part);
  }
  place(mesh(cave, rockWithFrost(0)), tiers[0], groups.cave);
  const wall = radialSurface([surfaces.underside]),
    cliffMaterial = cliffDressingMaterial();
  const dressings: ReturnType<typeof buildMountainMasses>[] = [],
    sites: GroveSite[] = [];
  for (const [i, tier] of tiers.entries()) {
    status.textContent = 'Скалы и снежные полки · ' + (i + 1) + ' / ' + tiers.length;
    await frame();
    const parent = tiers[i - 1],
      child = tiers[i + 1];
    const reserved = (x: number, z: number, r: number) => reservedForUpper(tier, child, x, z, r);
    const dressing = buildMountainMasses(
      (a) => ringPoint(rim, a),
      wall,
      (x, z) => sampleGrid(source, x, z).y,
      tier.seed,
      {
        cave: i === 0,
        reserved,
        supported: parent ? (x, z, r) => supportedSite(tier, parent, x, z, r) : undefined,
      },
    );
    dressings.push(dressing);
    const rocks = new THREE.Group();
    const outcrops = mesh(dressing.rocks, cliffMaterial);
    outcrops.geometry.setAttribute('rockFinish', new THREE.BufferAttribute(dressing.rocks.finish, 3));
    rocks.add(outcrops, mesh(dressing.snow, snowTopMaterial));
    place(rocks, tier, groups.rocks);
    place(i === 0 ? baseStone : upperStone.clone(), tier, groups.stone);
    place(snowCover.clone(), tier, groups.snow);
    sites.push({
      seed: 941003 + i * 1163,
      density: i === 0 ? 1 : i === 1 ? 0.8 : 0.48,
      heightFactor: [1, 0.81, 0.58][i],
      outcrops: dressing.stoneFootprints,
      rootAt: (x, z, outside) => {
        if ((outside && i > 0) || reserved(x, z, 5)) return;
        const p = worldPlan(tier, x, z);
        return { ...p, y: tier.y + tier.rise * (outside ? 0 : roof(x, z)) };
      },
    });
  }
  const groves = await buildMountainGroves(sites);
  groups.trees.add(groves);
  groups.trees.userData.count = groves.userData.count;
  const dressing = dressings[0];
  const entrance = dressing.entrance;
  const lowerRocks = groups.rocks.children[0] as THREE.Group;
  const originalParts = lowerRocks.children.slice(0,2) as THREE.Mesh[];
  const originals = originalParts.map(part => part.geometry.getIndex()!);
  const cuts = [[entrance.rockStart,entrance.rockEnd],[entrance.snowStart,entrance.snowEnd]];
  const remainder = originals.map((attr,i)=>{
    const [start,end] = cuts[i];
    const a = new Uint32Array(attr.count - (end-start));
    a.set(attr.array.slice(0,start));
    a.set(attr.array.slice(end),start);
    return new THREE.BufferAttribute(a,1);
  });
  const localWallMaterial = rockWithFrost(0);
  // Snow lies just above a sloping support. The extra depth bias keeps individual
  // multisamples at shared cap edges from picking the underlying rock.
  const angularWallSnow = snowTopMaterial.clone();
  angularWallSnow.polygonOffsetFactor = -2;
  let activeWall: THREE.Group | undefined;
  const wallInput = document.querySelector<HTMLSelectElement>('#wall-family')!;
  const presetInput = document.querySelector<HTMLSelectElement>('#wall-preset')!;
  const seedInput = document.querySelector<HTMLInputElement>('#wall-seed')!;
  function setWall(family: WallFamily, preset: number, seed: number) {
    if (activeWall) {
      lowerRocks.remove(activeWall);
      activeWall.children.forEach(o=>(o as THREE.Mesh).geometry.dispose());
      activeWall = undefined;
    }
    originalParts.forEach((part,i)=>part.geometry.setIndex(family==='original'?originals[i]:remainder[i]));
    if (family !== 'original') {
      activeWall = makeWallGroup({...entrance,width:100,groundAt:(x,z)=>sampleGrid(source,x,z).y},family,preset,seed,localWallMaterial,family==='angular'?angularWallSnow:snowTopMaterial);
      lowerRocks.add(activeWall);
    }
    wallInput.value=family; presetInput.value=String(preset); seedInput.value=String(seed);
    presetInput.disabled=seedInput.disabled=family==='original';
    renderer.shadowMap.needsUpdate = true;
    draw();
  }
  function updateWall(){
    const params=new URLSearchParams(location.search);
    params.set('wall',wallInput.value);params.set('preset',presetInput.value);params.set('seed',seedInput.value);
    const {family,preset,seed}=wallParameters(params);
    history.replaceState(null,'','?'+params);
    setWall(family,preset,seed);view('wall');
  }
  [wallInput,presetInput,seedInput].forEach(el=>el.addEventListener('change',updateWall));
  let activeView='overview';
  const views:Record<string,{eye:number[];target:number[];fov?:number}>={
    wall:{eye:[-510,160,-314],target:[-146,66,-68],fov:27},
    front:{eye:[-970,191,-395],target:[-6,48,2],fov:17},
    overview:{eye:[520,310,560],target:[0,48,0],fov:45},back:{eye:[-560,280,-480],target:[0,48,0],fov:45},
    ascent:{eye:[-370,190,-230],target:[-130,50,-35],fov:45},ascentFoot:{eye:[-310,20,-60],target:[-190,45,-20],fov:55},ascentTop:{eye:[30,132,ascentCenter(20)],target:[-140,62,ascentCenter(-140)],fov:50},
    entrance:{eye:[340,9,12],target:[285,7,0],fov:42},inside:{eye:[279,6.8,0],target:[320,6.8,0],fov:65},top:{eye:[0,670,.1],target:[0,50,0],fov:45},
    edge:{eye:[244.64436973987432,127.31045870807777,194.19342741677312],target:[210.05573950985809,105.31045870807777,119.84541696046566],fov:25},
  };
  if (stacked) {
    const base = tiers[0];
    // The established close cameras follow the widened base, including its cave.
    for (const v of Object.values(views))
      for (const p of [v.eye, v.target]) {
        p[0] *= base.width;
        p[2] *= base.width;
      }
    Object.assign(views, {
      wall: { eye: [-950,160,-580], target:[-270,66,-126], fov:27 },
      front: { eye: [-1660, 475, -735], target: [20, 63, 6], fov: 22 },
      overview: { eye: [-1170, 760, 890], target: [15, 50, 12], fov: 31 },
      back: { eye: [1290, 550, 860], target: [42, 78, 7], fov: 26 },
      top: { eye: [35, 1610, 1], target: [35, 0, 0], fov: 35 },
    });
    for (const tier of tiers.slice(1)) {
      const eye = worldPlan(tier, -345, -205),
        aim = worldPlan(tier, -37, -16);
      views[tier.name] = {
        eye: [eye.x, tier.y + 196 * tier.rise, eye.z],
        target: [aim.x, tier.y + 70 * tier.rise, aim.z],
        fov: 46,
      };
    }
  }
  const layoutLink = document.querySelector<HTMLAnchorElement>('#layout')!;
  layoutLink.href = stacked ? '?tiers=1' : '?tiers=3';
  layoutLink.textContent = stacked ? 'Одноярусная версия' : 'Трёхъярусная версия';
  document.querySelectorAll<HTMLElement>('[data-upper]').forEach((b) => (b.hidden = !stacked));
  document.querySelector('h1')!.textContent = document.title = stacked
    ? 'Гора · три яруса'
    : 'Гора · скалы и плато';
  function draw(){renderer.render(scene,camera);}
  function view(name:string){activeView=name;const v=views[name];camera.position.fromArray(v.eye);controls.target.fromArray(v.target);camera.fov=v.fov||45;camera.updateProjectionMatrix();controls.update();draw();document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));}
  controls.addEventListener('change',draw);document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view!));
  document.querySelector<HTMLInputElement>('#snow')!.onchange=e=>{groups.snow.visible=(e.target as HTMLInputElement).checked;renderer.shadowMap.needsUpdate=true;draw();};document.querySelector<HTMLInputElement>('#rocks')!.onchange=e=>{groups.rocks.visible=(e.target as HTMLInputElement).checked;renderer.shadowMap.needsUpdate=true;draw();};
  const keys=new Set<string>();window.addEventListener('keydown',e=>{if((e.target as HTMLElement).matches('input,button,select'))return;if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)){keys.add(e.code);e.preventDefault();}});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());
  let previous=performance.now();function tick(now:number){const dt=Math.min(.05,(now-previous)/1000);previous=now;if(keys.size){const forward=new THREE.Vector3();camera.getWorldDirection(forward);const right=new THREE.Vector3().crossVectors(forward,camera.up).normalize(),move=new THREE.Vector3();if(keys.has('KeyW'))move.add(forward);if(keys.has('KeyS'))move.sub(forward);if(keys.has('KeyD'))move.add(right);if(keys.has('KeyA'))move.sub(right);if(keys.has('KeyE'))move.y++;if(keys.has('KeyQ'))move.y--;move.multiplyScalar(dt*(keys.has('ShiftLeft')?100:25));camera.position.add(move);controls.target.add(move);controls.update();draw();}requestAnimationFrame(tick);}requestAnimationFrame(tick);
  window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();draw();});
  renderer.shadowMap.needsUpdate=true;view(stacked?'back':'front');status.textContent=stacked?'Три яруса · подъёмы и плато':'Гора · скалы, плато и подъём';
  const initial=wallParameters(new URLSearchParams(location.search));
  setWall(initial.family,initial.preset,initial.seed);
  if(initial.family!=='original' || new URLSearchParams(location.search).get('view')==='wall')view('wall');
  (window as any).__mountain={ready:true,setWall,wallMask:()=>measureWallSnow(scene,camera,renderer),renderer,scene,camera,controls,source,upper,junction,surfaces,cave,dressing,dressings,tiers,snow,groups,view,views,state:()=>({view:activeView,exposure:renderer.toneMappingExposure,fill:fill.intensity,snow:groups.snow.visible,rocks:groups.rocks.visible,snowStats:snow.stats})};
}
start().catch(e=>{status.textContent='Ошибка: '+e.message;console.error(e);});
