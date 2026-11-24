import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import { ledgeMountain } from './ledge-mountain';
import { rangeVault } from './range-vault';
import { rockHorn } from './landform-mesh';
import { generateRockCore } from './range-core';
import { winterSky } from './winter-sky';
import { walkingSurface } from './range-walk';
import { mineralPaint } from './mineral-paint';
import { rangeSeed, stream } from './range-seed';
import { originalRange, readRangeSettings, type RangeSettings } from './range-settings';
import { rangeLayout } from './range-layout';
import { rangeGround } from './range-ground';
import { connectBanks, metres } from './range-bridge';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeRockMaterial } from '../../src/world/cliffs';
import { groundUniforms } from '../../src/world/terrain';
import { noiseTexture } from '../../src/core/noisetex';
import { buildMountainMasses, mountainSnowProfile } from './mountain-shape';
import { type GroveSite, buildMountainGroves } from './mountain-groves';
import { subtract, interior, type MeshData } from './cavity';
import { ascentCenter, ascentSample } from './ascent';
import { ringPoint, snowSettings, upperNormal } from './wedge-snow-layer';
import { sampleGrid } from './seam-boundary';
import { radialSurface, surfaceRoof } from './wedge-rocks';
import { buildMountainSnow, mountainRim } from './mountain-snow';

import { plateauRadius } from './plateau-profile';
import { localPlan, mountainTiers, raisedFlank, reservedForUpper, supportedSite, worldPlan, type Tier } from './mountain-tiers';

type View = {eye:number[];target:number[];fov?:number};
type WalkStart = {point:THREE.Vector3;aim:THREE.Vector3};
const requested=new URLSearchParams(location.search).get('form');
const forms={range:'Исходный хребет',peak:'Плато с пиком',ledge:'Гора с боковой тропой',vault:'Гора-арка'};
const form = requested && Object.hasOwn(forms,requested) ? requested as keyof typeof forms : 'range';
const settings=form==='range'?readRangeSettings(new URLSearchParams(location.search)):originalRange;
const settingKeys=Object.keys(originalRange) as (keyof RangeSettings)[];
const adjusted=form==='range' && settingKeys.some(k=>settings[k]!==originalRange[k]);
const stacked=true;
const status=document.querySelector<HTMLElement>('#status')!;
const frame=()=>new Promise<void>(ok=>requestAnimationFrame(()=>ok()));
function setupSceneControls(){
  const seedInput = document.querySelector<HTMLInputElement>('#seed')!;
  document.querySelector<HTMLElement>('#scene-settings')!.hidden=form!=='range';
  const archive=document.querySelector<HTMLElement>('#archive')!;
  archive.hidden=form==='range';
  archive.querySelector('span')!.textContent=forms[form];
  archive.querySelector('a')!.href='?form=range&seed='+rangeSeed;
  const fields=settingKeys.map(key=>{
    const select=document.querySelector<HTMLSelectElement>('#'+key)!;
    select.value=settings[key];return {key,select};
  });
  seedInput.value=String(rangeSeed);
  function load(value:string,reset=false){
    const url=new URL(location.href);
    url.searchParams.set('seed',value);url.searchParams.set('form',form);
    for(const {key,select} of fields){
      if(reset || form!=='range' || select.value===originalRange[key])url.searchParams.delete(key);
      else url.searchParams.set(key,select.value);
    }
    if(reset)url.searchParams.delete('view');
    location.assign(url.href);
  }
  const reset=document.querySelector<HTMLButtonElement>('#baseline')!;
  reset.hidden=!adjusted;
  reset.onclick=()=>load(String(rangeSeed),true);
  document.querySelector<HTMLFormElement>('form')!.onsubmit=e=>{e.preventDefault();load(seedInput.value);};
  document.querySelector<HTMLButtonElement>('#random')!.onclick=()=>load(String(crypto.getRandomValues(new Uint32Array(1))[0]));
}
async function start(){
  setupSceneControls();
  let ground:ReturnType<typeof rangeGround>|undefined;
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;document.body.append(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#c1d5e4');
  const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.2,stacked?10500:5000),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.maxDistance=stacked?3300:1800;
  const sun=new THREE.DirectionalLight('#fff3e5',2.0);sun.position.set(-350,550,250);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-430,right:430,top:430,bottom:-430,near:1,far:1700});if(stacked){
    sun.position.multiplyScalar(1.85);
    Object.assign(sun.shadow.camera,{left:-760,right:760,top:760,bottom:-760,far:3000});
    sun.shadow.mapSize.set(2048,2048);
  }
  sun.shadow.normalBias=.6;const fill=new THREE.HemisphereLight('#d1def3','#95909c',2.5);scene.add(sun,sun.target,fill);groundUniforms.uNoise.value=noiseTexture();scene.add(winterSky(groundUniforms.uNoise.value));
  await frame();
  const paint = mineralPaint(rangeSeed);
  function bedrockMaterial(){
    const mat=makeRockMaterial(), compile=mat.onBeforeCompile;
    mat.onBeforeCompile=function(shader,r){
      compile.call(this,shader,r);shader.uniforms.uPaint={value:paint};
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D uPaint;')
        .replace('float frost =', `vec3 uvw = vRockPos * .0135;
          vec2 pigment = texture2D(uPaint,uvw.yz + .18*uvw.x).rg*w.x + texture2D(uPaint,uvw.xz+.13*uvw.y).rg*w.y + texture2D(uPaint,uvw.xy-.21*uvw.z).rg*w.z;
          float exposure = 1.0-smoothstep(.42,.78,N.y);
          vec3 bedding = mix(vec3(.080,.073,.124),vec3(.155,.094,.075),pigment.r)*(.65 + pigment.g*.44);
          col = mix(col,bedding,exposure);
          float frost =`);
    };mat.customProgramCacheKey=()=>'painted-bedrock'; return mat;
  }
  const material=bedrockMaterial(),smooth=bedrockMaterial();smooth.flatShading=false;
  const hook=smooth.onBeforeCompile;smooth.onBeforeCompile=function(shader,r){hook.call(this,shader,r);shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSmoothWorldNormal;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvSmoothWorldNormal=inverseTransformDirection(transformedNormal,viewMatrix);');shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vSmoothWorldNormal;').replace('vec3 N = normalize(cross(dFdx(vRockPos), dFdy(vRockPos)));','vec3 N = normalize(vSmoothWorldNormal);');};smooth.customProgramCacheKey=()=> 'snow-diagnostic-smooth-upper-v1';
  const snowMaterial=new THREE.MeshStandardMaterial({color:new THREE.Color(.9,.925,.955),roughness:.88});
  // At the upper exit the snow layer tapers into the turning route.
  const snowTopMaterial=snowMaterial.clone();snowTopMaterial.polygonOffset=true;snowTopMaterial.polygonOffsetFactor=-1;snowTopMaterial.polygonOffsetUnits=-1;
  const groups={stone:new THREE.Group(),rocks:new THREE.Group(),snow:new THREE.Group(),trees:new THREE.Group(),cave:new THREE.Group()};Object.values(groups).forEach(g=>scene.add(g));
  function mesh(data: MeshData & { normals?: Float32Array; colors?: number[] }, mat: THREE.Material, grid?: ReturnType<typeof generateRockCore>['source'], tint = '#505a65') {
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
      const color=new THREE.Color(tint).toArray();
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
      shader.uniforms.uPaint = {value:paint};
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
        .replace('#include <common>', '#include <common>\n' + varying + mineralField + '\nuniform sampler2D uPaint;')
        .replace('float frost =', `
          vec2 bed = vec2(0.72*vRockPos.x - 0.53*vRockPos.z, vRockPos.y + 0.22*vRockPos.x + 0.34*vRockPos.z);
          vec2 mineral = texture2D(uNoise, bed * vec2(0.003,0.010)).rg;
          float bedding = smoothstep(0.28,0.72,mineral.r + 0.14*(mineral.g-0.5));
          vec2 strike = vec2(0.82*vRockPos.x-0.58*vRockPos.z, vRockPos.y-0.41*vRockPos.x+0.20*vRockPos.z);
          float mineralValue = 0.65 * mineralGrain(strike * vec2(0.057,0.076))
                      + 0.24 * mineralGrain(strike * 0.18 + 14.3) + 0.11 * bedding;
          vec3 pt = vRockPos * .0135;
          vec3 pattern = texture2D(uPaint, pt.yz + .18*pt.x).rgb * w.x
                       + texture2D(uPaint, pt.xz + .13*pt.y).rgb * w.y
                       + texture2D(uPaint, pt.xy - .21*pt.z).rgb * w.z;
          float warm = pattern.r * (.52 + .48 * bedding);
          col *= mix(vec3(.85,.92,1.08), vec3(1.46,1.12,.76), warm);
          col += vec3(.035,.013,.001) * warm;
          col *= .73 + .41 * pattern.g + .20 * mineralValue;
          col *= 0.62 + 0.38 * smoothstep(0.012,0.085,vRockFinish.z);
          float frost =`)
        .replace('frost * 0.92', 'frost * 0.29 * vRockFinish.x')
        .replace('#include <normal_fragment_begin>',
          '#include <normal_fragment_begin>\nnormal = normalize(mix(normal, normalize(vWornNormal), vRockFinish.y));');
    };
    mat.customProgramCacheKey = () => 'mountain-jointed-rock';
    return mat;
  }
  const cliffMaterial = cliffDressingMaterial();
  function addLandform(data:MeshData, name:string, snowy=false) {
    const obj = mesh(data,snowy ? snowTopMaterial : cliffMaterial, undefined, '#625d78');
    obj.name=name;
    if(!snowy){
      const finish=new Float32Array(data.positions.length);
      for(let i=0;i<finish.length;i+=3){finish[i]=.04;finish[i+1]=.14;finish[i+2]=1;}
      obj.geometry.setAttribute('rockFinish',new THREE.BufferAttribute(finish,3));
    }
    (snowy ? groups.snow : groups.stone).add(obj);
    if(snowy){
      // Adjacent snow triangles share a surface normal at the same position.
      // This avoids spokes of light across a broad snow pocket.
      const unwelded=obj.geometry;
      unwelded.deleteAttribute('normal');
      obj.geometry=mergeVertices(unwelded);
      obj.geometry.computeVertexNormals();
      unwelded.dispose();
      const bed=mesh(data,material);
      bed.name=name+'-bed'; bed.position.y=-.42;
      groups.stone.add(bed);
    }
    return obj;
  }
  if(form==='ledge'){
    const mountain=ledgeMountain(stream('ledge massif'));
    addLandform(mountain.rock,'ledge-walls');
    groups.rocks.add(addLandform(mountain.outcrops,'ledge-outcrops'));
    addLandform(mountain.snow,'ledge-tread',true);
    addLandform(mountain.summit.rock,'peak');
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(18000,18000),snowMaterial);
    ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
    scene.fog=new THREE.Fog('#d6dfe6',980,5400);
    groups.trees.add(await buildMountainGroves([],mountain.trees));
    const route=mountain.route;
    const last=route.length-1, middle=Math.floor(last*.48);
    function along(i:number){
      return {point:route[i],aim:route[Math.min(i+2,last)]};
    }
    const mid=along(middle), end=route[last];
    const trailEye=mid.point.clone().add(new THREE.Vector3(0,11,0));
    const trailAim=route[middle+3].clone();
    trailAim.y=Math.min(trailEye.y-2,trailAim.y+3);
    const views:Record<string,View>={
      range:{eye:[],target:[],fov:34},
      trail:{eye:trailEye.toArray(),target:trailAim.toArray(),fov:66},
      summit:{eye:end.clone().add(new THREE.Vector3(115,80,125)).toArray(),target:end.toArray(),fov:45},
      top:{eye:[0,1000,.1],target:[0,0,0],fov:34}
    };
    const outline=mountain.outline;
    activate(views,outline,new THREE.Vector3(1,.30,.82),[], name=>along(name==='trail'?middle:name==='summit'?last-2:0),
      forms.ledge,{landform:mountain});
    return;
  }
  const {source,upper,junction}=generateRockCore();
  const surfaces=Object.fromEntries(Object.entries(junction.cut).map(([k,m])=>[k,subtract(m)]));
  const rawPositions=new Float32Array(source.heights.length*3),rawIndices:number[]=[];for(let k=0;k<source.heights.length;k++)rawPositions.set([source.x0+k%(source.n+1)*source.cell,source.heights[k],source.z0+Math.floor(k/(source.n+1))*source.cell],k*3);
  for(let z=0;z<source.n;z++)for(let x=0;x<source.n;x++){const a=z*(source.n+1)+x;rawIndices.push(a,a+source.n+1,a+1,a+1,a+source.n+1,a+source.n+2);}
  const cave=interior({positions:rawPositions,indices:new Uint32Array(rawIndices)});
  status.textContent = 'Снежный край и плато…';
  await frame();
  const rim = mountainRim(junction);
  const snow = buildMountainSnow(upper, junction, [surfaces.plateau, surfaces.strip], mountainSnowProfile);
  const roof = (x: number, z: number) => snow.field(x, z).y;
  const rimAt=(a:number)=>ringPoint(rim,a);
  const original=mountainTiers(stacked,roof,rimAt,form);
  const tiers=form==='range'?rangeLayout(original,settings,roof,rimAt):original;
  if(settings.relief!=='flat'){
    ground=rangeGround(tiers,settings.relief);
    const groundSnow=snowMaterial.clone();
    groundSnow.vertexColors=true;
    const snowfield=mesh(ground.mesh,groundSnow);
    const normals=snowfield.geometry.getAttribute('normal'),colors=snowfield.geometry.getAttribute('color');
    for(let i=0;i<normals.count;i++){
      const shade=THREE.MathUtils.clamp(.12+.96*(normals.getX(i)*.82-normals.getZ(i)*.57),0,.72);
      colors.setXYZ(i,1-.52*shade,1-.34*shade,1-.15*shade);
    }
    snowfield.castShadow=false;
    scene.add(snowfield);
  }
  const baseStone = new THREE.Group(),
    upperStone = new THREE.Group(),
    snowCover = new THREE.Group();
  if (stacked && !ground) {
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
  }
  scene.fog = new THREE.Fog('#d6dfe6', 980, 5400);
  for (const [name, data] of Object.entries(surfaces)) {
    const grid =
      name === 'plateau' || name === 'strip'
        ? upper
        : name === 'flank' || name === 'restored'
          ? source
          : undefined;
    const rimStone = name === 'underside';
    const apron=name==='flank'||name==='restored';
    const m = mesh(ground && apron?raisedFlank(data,.0001):data, rimStone ? cliffMaterial : grid ? smooth : material, grid, rimStone ? '#605b72' : undefined);
    if (rimStone) {
      // Exposed rock between the attached slabs shares their world-space mineral
      // pattern. The intact core carries neither joint darkening nor surface frost.
      const finish = new Float32Array(data.positions.length);
      for (let k = 2; k < finish.length; k += 3) finish[k] = 1;
      m.geometry.setAttribute('rockFinish', new THREE.BufferAttribute(finish, 3));
    }
    m.name = name;
    baseStone.add(m);
    if (stacked) {
      // Upper tiers use the solid flank before the cave cut.
      const upperMesh =
        name === 'flank' || name === 'restored'
          ? mesh(raisedFlank(junction.cut[name],ground ? .0001 : 2), smooth, source)
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
    part.scale.set(tier.width, tier.rise, tier.depth??tier.width);
    category.add(part);
  }
  place(mesh(cave, rockWithFrost(0)), tiers[0], groups.cave);
  const rockRoof = {
    height: (x: number, z: number) => sampleGrid(upper, x, z).y,
    clearance: surfaceRoof([surfaces.strip, surfaces.plateau, snow.cap]).triangleClearance,
  };
  const wall = radialSurface([surfaces.underside]);
  const dressings: ReturnType<typeof buildMountainMasses>[] = [],
    sites: GroveSite[] = [];
  const vault=form==='vault'?rangeVault(tiers,roof,stream('rock vault')):undefined;
  const summitTier=tiers.find(t=>t.name==='summit')??tiers[0];
  const peakSite={x:65,z:52}, peakWidth=stream('peak width').float(72,91);
  const summitCenter=worldPlan(summitTier,peakSite.x,peakSite.z);
  const summitFoot=new THREE.Vector3(summitCenter.x,summitTier.y+summitTier.rise*roof(peakSite.x,peakSite.z)-3,summitCenter.z);
  const peak=form==='peak'?rockHorn(summitFoot,peakWidth*summitTier.width,stream('peak rise').float(59,89),stream('plateau horn')):undefined;
  if(peak) addLandform(peak.rock,'peak');
  for (const [i, tier] of tiers.entries()) {
    status.textContent = 'Скалы и снежные полки · ' + (i + 1) + ' / ' + tiers.length;
    await frame();
    const parent = tiers.find(t=>t.name===tier.parent),
      child = tiers.find(t=>t.parent===tier.name);
    const reserved = (x: number, z: number, r: number) => {
      if(reservedForUpper(tier,child,x,z,r))return true;
      if(peak && tier===summitTier && Math.hypot(x-peakSite.x,z-peakSite.z)<peakWidth+r)return true;
      if(!vault || parent)return false;
      const w=worldPlan(tier,x,z);
      return vault.route.some(p=>Math.hypot(w.x-p.x,w.z-p.z)<r*tier.width+23);
    };
    const dressing = buildMountainMasses(
      (a) => ringPoint(rim, a),
      wall,
      (x, z) => sampleGrid(source, x, z).y,
      rockRoof,
      tier.seed,
      {
        cave: i === 0,
        arch: i === 0,
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
      seed: tier.seed ^ 941003,
      density: tier.name === 'summit' ? .42 : .74,
      heightFactor: tier.name === 'summit' ? .64 : parent ? .85 : 1,
      outcrops: dressing.stoneFootprints,
      rootAt: (x, z, outside) => {
        if ((outside && (parent || (!adjusted && i>0))) || reserved(x, z, 5)) return;
        if (outside && tiers.filter(t=>!t.parent && t!==tier).some(other=>{
          const w=worldPlan(tier,x,z), q=localPlan(other,w.x,w.z); return plateauRadius(q.x,q.z)<1.43;
        })) return;
        const p = worldPlan(tier, x, z);
        return { ...p, y: outside?(ground?.floor(p.x,p.z)??0):tier.y+tier.rise*roof(x,z) };
      },
    });
  }
  if(vault){
    addLandform(vault.rock,'vault');
    addLandform(vault.snow,'vault-roof',true);
    groups.rocks.add(addLandform(vault.outcrops,'vault-buttresses'));
    groups.snow.add(mesh(vault.patchSnow,snowTopMaterial));
  }
  const groves = await buildMountainGroves(sites,vault?.trees);
  groups.trees.add(groves);
  groups.trees.userData.count = groves.userData.count;
  const dressing = dressings[0];
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
        p[2] *= base.depth??base.width;
        p[1] *= form==='range'?base.rise:1;
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
  const base = tiers[0], spur = tiers.find(t=>t.name==='spur')!;
  views.range = {eye:[],target:[],fov:34};
  const outlinePoints=tiers.flatMap(t=>Array.from({length:100},(_,i)=>{
    const p=ringPoint(rim,i*Math.PI/50),w=worldPlan(t,p.x*1.13,p.z*1.13);
    return [new THREE.Vector3(w.x,t.y,w.z),new THREE.Vector3(w.x,t.y+t.rise*(p.y+13),w.z)];
  }).flat());
  const roots=tiers.filter(t=>!t.parent);
  if(roots.length>2){
    const bounds=new THREE.Box3().setFromPoints(outlinePoints);
    const center=bounds.getCenter(new THREE.Vector3()), radius=bounds.getSize(new THREE.Vector3()).length()*.55;
    sun.position.normalize().multiplyScalar(radius*2.2).add(center);
    sun.target.position.copy(center);
    Object.assign(sun.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,far:radius*3.5});
    sun.shadow.camera.updateProjectionMatrix();
  }
  if(adjusted){
    for(const [i,root] of roots.entries()){
      const name='massif'+(i+1);
      const members=[root];
      for(let j=0;j<members.length;j++)members.push(...tiers.filter(t=>t.parent===members[j].name));
      const top=Math.max(...members.map(t=>t.y+105*t.rise));
      const eye=worldPlan(root,-600,-440);
      views[name]={eye:[eye.x,top+260,eye.z],target:[root.x,top*.41,root.z],fov:48};
      const button=document.createElement('button');
      button.dataset.view=name;button.textContent='Гора '+(i+1);
      document.querySelector('nav')!.insertBefore(button,document.querySelector('#walk'));
    }
  }
  const arch=dressing.arch!;
  function trailSpot(x:number,lift:number) {
    const p=ascentSample(x), w=worldPlan(base,x,p.z);
    return [w.x,base.y+p.y*base.rise+lift,w.z];
  }
  views.arch = {eye:trailSpot(arch.x-84,13),target:trailSpot(arch.x+4,40),fov:60};
  status.textContent='Поиск опор для моста…'; await frame();
  const trunks = groves.userData.trunks.map((t: {x:number;y:number;z:number;radius:number;height:number})=>({
    x:t.x*metres,y:t.y*metres,z:t.z*metres,radius:t.radius*metres,height:t.height*metres
  }));
  const bridge = form==='range' && spur ? connectBanks(base,spur,rimAt,[groups.rocks,groups.stone,groups.snow],trunks,rangeSeed) : null;
  if (bridge) {
    scene.add(bridge.group);
    const mid = bridge.point(bridge.span/2);
    const loc = [mid.x/metres,mid.y/metres,mid.z/metres];
    views.bridge = {eye:[loc[0]-170,loc[1]+80,loc[2]+Math.sign(spur.z)*68],target:loc,fov:48};
  } else document.querySelector<HTMLElement>('[data-view="bridge"]')!.hidden=true;
  if(peak) outlinePoints.push(peak.tip);
  if(vault){
    outlinePoints.push(...vault.route,vault.crest);
    views.vault={eye:vault.mid.clone().add(new THREE.Vector3(-780,58,35)).toArray(),
      target:vault.mid.clone().setY(vault.mid.y*.69).toArray(),fov:48};
    views.passage={eye:vault.passage[0].clone().add(new THREE.Vector3(0,14,0)).toArray(),
      target:vault.mid.clone().setY(95).toArray(),fov:62};
    views.roof={eye:vault.route[17].clone().add(new THREE.Vector3(0,15,0)).toArray(),
      target:vault.route[26].clone().toArray(),fov:66};
  }
  const axis=new THREE.Vector3(-1460,604,spur?-Math.sign(spur.z)*780:-520);
  if(vault) {
    axis.copy(vault.passage[0]).sub(vault.passage[1]).normalize();
    axis.z=.12;axis.y=.24;
  }
  const extras:THREE.Mesh[]=[];
  if(bridge){
    const deck=mesh(bridge.collider,snowMaterial);deck.scale.setScalar(1/metres);extras.push(deck);
    for(const obj of bridge.group.children) if(obj instanceof THREE.Mesh && obj.name==='bank-sill') extras.push(obj);
  }
  function spawn(name:string):WalkStart{
    if(vault && name==='roof')return {point:vault.route[17],aim:vault.route[22]};
    if(vault && (name==='range'||name==='passage'||name==='vault'))return {point:vault.passage[0],aim:vault.passage[1]};
    if(name==='bridge' && bridge){
      const v=bridge.point(-2.2);
      return {point:new THREE.Vector3(v.x,v.y,v.z).divideScalar(metres),
        aim:new THREE.Vector3(bridge.to.x,bridge.to.y,bridge.to.z).divideScalar(metres)};
    }
    const root=roots.find((_,i)=>name==='massif'+(i+1))??base;
    const start=ascentSample(-317),w=worldPlan(root,-317,start.z);
    const next=ascentSample(-240),aim=worldPlan(root,-240,next.z);
    return {point:new THREE.Vector3(w.x,ground?.floor(w.x,w.z)??0,w.z),aim:new THREE.Vector3(aim.x,root.y+next.y*root.rise,aim.z)};
  }
  const countLabel=['','1 массив','2 массива','3 массива','4 массива'][Number(settings.count)];
  activate(views,outlinePoints,axis,extras,spawn,(form==='range'?countLabel:forms[form])+(bridge?' · мост '+Math.round(bridge.span)+' м':''),
    {bridge,ascentSample,source,upper,junction,surfaces,cave,dressing,dressings,tiers,snow,vault,peak,settings,groundAt:ground?.floor});

  function activate(views:Record<string,View>,outlinePoints:THREE.Vector3[],axis:THREE.Vector3,extras:THREE.Mesh[],
    spawn:(name:string)=>WalkStart,label:string,diagnostics:Record<string,unknown>){
  let activeView='range';
  function frameRange(){
    fit(views.range,axis);
    if(adjusted)fit(views.top,new THREE.Vector3(0,1,.001));
  }
  function fit(view:View,direction:THREE.Vector3){
    const aim=new THREE.Box3().setFromPoints(outlinePoints).getCenter(new THREE.Vector3());
    direction.normalize();
    const right=new THREE.Vector3().crossVectors(camera.up,direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right);
    for(const v of [right,up]){
      const values=outlinePoints.map(p=>p.clone().sub(aim).dot(v));
      aim.addScaledVector(v,(Math.min(...values)+Math.max(...values))*.5);
    }
    const tan=Math.tan(THREE.MathUtils.degToRad(view.fov!)/2);
    const distance=Math.max(...outlinePoints.map(p=>{
      const q=p.clone().sub(aim);
      return q.dot(direction)+1.08*Math.max(Math.abs(q.dot(right))/(tan*camera.aspect),Math.abs(q.dot(up))/tan);
    }));
    view.eye=aim.clone().addScaledVector(direction,distance).toArray();view.target=aim.toArray();
    if(adjusted){
      controls.maxDistance=Math.max(controls.maxDistance,distance*1.25);
      camera.far=Math.max(camera.far,distance*2);
      if(scene.fog instanceof THREE.Fog){
        scene.fog.near=Math.max(980,distance*.67);scene.fog.far=Math.max(5400,distance*2.2);
      }
    }
  }

  frameRange();
  for(const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')){
    if(!views[button.dataset.view!])button.hidden=true;
  }
  const walkingButton=document.querySelector<HTMLButtonElement>('#walk')!;
  let walking=false, contact:ReturnType<typeof walkingSurface>|undefined, pitch=0, yaw=0, dragging=false;
  const foot=new THREE.Vector3(), forward=new THREE.Vector3();
  function lookFromFoot(){
    camera.position.copy(foot);camera.position.y+=contact!.eye;
    camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0,'YXZ');
    camera.getWorldDirection(forward);controls.target.copy(camera.position).addScaledVector(forward,32);
  }
  function endWalk(){
    if(!walking)return;
    walking=false;controls.enabled=true;walkingButton.setAttribute('aria-pressed','false');
    renderer.domElement.style.cursor='';walkingButton.textContent='Пешком';
    keys.clear();controls.update();
  }
  function startWalk(){
    if(walking){endWalk();return;}
    contact??=walkingSurface([groups.stone,groups.rocks,groups.cave,groups.snow],extras,ground?.floor);
    const {point,aim}=spawn(activeView);
    foot.copy(point); foot.y=contact.floor(foot.x,foot.z,foot.y)??foot.y;
    yaw=Math.atan2(foot.x-aim.x,foot.z-aim.z);pitch=.09;
    camera.fov=68;camera.updateProjectionMatrix();controls.enabled=false;walking=true;
    document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));
    walkingButton.setAttribute('aria-pressed','true');walkingButton.textContent='Выйти из прогулки';
    walkingButton.blur();renderer.domElement.style.cursor='grab';lookFromFoot();draw();
  }
  walkingButton.onclick=startWalk;
  renderer.domElement.addEventListener('pointerdown',e=>{if(walking){dragging=true;renderer.domElement.setPointerCapture(e.pointerId);}});
  renderer.domElement.addEventListener('pointermove',e=>{
    if(!walking||!dragging)return;yaw-=e.movementX*.005;pitch=THREE.MathUtils.clamp(pitch-e.movementY*.005,-1.36,1.36);
    lookFromFoot();draw();
  });
  renderer.domElement.addEventListener('pointerup',()=>dragging=false);
  let changingCamera=false;
  function draw(){if(!changingCamera)renderer.render(scene,camera);}
  function view(name:string){changingCamera=true;endWalk();activeView=name;const v=views[name];camera.position.fromArray(v.eye);controls.target.fromArray(v.target);camera.fov=v.fov||45;camera.updateProjectionMatrix();controls.update();changingCamera=false;draw();document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));}
  controls.addEventListener('change',draw);document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view!));
  document.querySelector<HTMLInputElement>('#snow')!.onchange=e=>{groups.snow.visible=(e.target as HTMLInputElement).checked;renderer.shadowMap.needsUpdate=true;draw();};document.querySelector<HTMLInputElement>('#rocks')!.onchange=e=>{groups.rocks.visible=(e.target as HTMLInputElement).checked;renderer.shadowMap.needsUpdate=true;draw();};
  const keys=new Set<string>();window.addEventListener('keydown',e=>{if((e.target as HTMLElement).matches('input,button,select'))return;if(walking&&e.code==='Escape'){endWalk();return;}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)){keys.add(e.code);e.preventDefault();}});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());
  let previous=performance.now();function tick(now:number){const dt=Math.min(.05,(now-previous)/1000);previous=now;if(walking && keys.size){
    const rotate=Number(keys.has('ArrowLeft'))-Number(keys.has('ArrowRight'));
    const tilt=Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown'));
    yaw+=rotate*dt*1.65;pitch=THREE.MathUtils.clamp(pitch+tilt*dt,-1.36,1.36);
    const ahead=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),side=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));
    const distance=dt*(keys.has('ShiftLeft')||keys.has('ShiftRight')?5.0:3.1)/metres/Math.max(1,Math.hypot(ahead,side));
    const dx=distance*(-ahead*Math.sin(yaw)+side*Math.cos(yaw)),dz=distance*(-ahead*Math.cos(yaw)-side*Math.sin(yaw));
    if((dx||dz)&&!contact!.move(foot,dx,dz)){if(!contact!.move(foot,dx,0))contact!.move(foot,0,dz);}
    lookFromFoot();draw();
  }else if(keys.size){const forward=new THREE.Vector3();camera.getWorldDirection(forward);const right=new THREE.Vector3().crossVectors(forward,camera.up).normalize(),move=new THREE.Vector3();if(keys.has('KeyW'))move.add(forward);if(keys.has('KeyS'))move.sub(forward);if(keys.has('KeyD'))move.add(right);if(keys.has('KeyA'))move.sub(right);if(keys.has('KeyE'))move.y++;if(keys.has('KeyQ'))move.y--;move.multiplyScalar(dt*(keys.has('ShiftLeft')?100:25));camera.position.add(move);controls.target.add(move);controls.update();draw();}requestAnimationFrame(tick);}requestAnimationFrame(tick);
  window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();frameRange();if(!walking && (activeView==='range'||(adjusted && activeView==='top')))view(activeView);else draw();});
  const initialView=new URLSearchParams(location.search).get('view');
  renderer.shadowMap.needsUpdate=true;
  view(initialView && Object.hasOwn(views,initialView)?initialView:'range');
  status.textContent='Сид '+rangeSeed+' · '+label;
  (window as any).__mountain={...diagnostics,ready:true,rangeSeed,form,startWalk,endWalk,foot,walkSurface:()=>contact,
    renderer,scene,camera,controls,groups,view,views,state:()=>({view:activeView,exposure:renderer.toneMappingExposure,
    fill:fill.intensity,snow:groups.snow.visible,rocks:groups.rocks.visible,snowStats:(diagnostics.snow as typeof snow|undefined)?.stats})};
  }
}
start().catch(e=>{status.textContent='Ошибка: '+e.message;console.error(e);});
