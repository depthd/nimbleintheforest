import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeRockMaterial } from '../../src/world/cliffs';
import { groundUniforms } from '../../src/world/terrain';
import { noiseTexture } from '../../src/core/noisetex';
import { reliefGrid, chaoticTop } from './seam-relief-fixture';
import { buildWedgeAscent } from './wedge-ascent';
import { bluntTip } from './wedge-tip-profile';
import { buildWedgeRocks } from './wedge-rocks';
import { subtract, interior, type MeshData } from './cavity';
import { ascentCenter, ascentHeight } from './ascent';
import { upperNormal } from './wedge-snow-layer';
import { buildMountainSnow } from './mountain-snow';

const status=document.querySelector<HTMLElement>('#status')!;
const frame=()=>new Promise<void>(ok=>requestAnimationFrame(()=>ok()));
async function start(){
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;document.body.append(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#c1d5e4');
  const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.1,3000),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.maxDistance=1800;
  const sun=new THREE.DirectionalLight('#fff0d8',2.5);sun.position.set(-350,550,250);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-430,right:430,top:430,bottom:-430,near:1,far:1700});sun.shadow.normalBias=.6;const fill=new THREE.HemisphereLight('#b8d5f4','#727a83',2.3);scene.add(sun,sun.target,fill);groundUniforms.uNoise.value=noiseTexture();
  await frame();
  const source=reliefGrid(chaoticTop),upper={...source,heights:source.heights.map((_,k)=>chaoticTop(source.x0+k%(source.n+1)*source.cell,source.z0+Math.floor(k/(source.n+1))*source.cell))};
  const junction=buildWedgeAscent(source,upper,undefined,bluntTip);
  const surfaces=Object.fromEntries(Object.entries(junction.cut).map(([k,m])=>[k,subtract(m)]));
  const rawPositions=new Float32Array(source.heights.length*3),rawIndices:number[]=[];for(let k=0;k<source.heights.length;k++)rawPositions.set([source.x0+k%(source.n+1)*source.cell,source.heights[k],source.z0+Math.floor(k/(source.n+1))*source.cell],k*3);
  for(let z=0;z<source.n;z++)for(let x=0;x<source.n;x++){const a=z*(source.n+1)+x;rawIndices.push(a,a+source.n+1,a+1,a+1,a+source.n+1,a+source.n+2);}
  const cave=interior({positions:rawPositions,indices:new Uint32Array(rawIndices)});
  const material=makeRockMaterial(),smooth=makeRockMaterial();smooth.flatShading=false;
  const hook=smooth.onBeforeCompile;smooth.onBeforeCompile=function(shader,r){hook.call(this,shader,r);shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSmoothWorldNormal;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvSmoothWorldNormal=normalize(mat3(modelMatrix)*normal);');shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vSmoothWorldNormal;').replace('vec3 N = normalize(cross(dFdx(vRockPos), dFdy(vRockPos)));','vec3 N = normalize(vSmoothWorldNormal);');};smooth.customProgramCacheKey=()=> 'snow-diagnostic-smooth-upper-v1';
  const snowMaterial=new THREE.MeshStandardMaterial({color:new THREE.Color(.9,.925,.955),roughness:.88});
  // At the passage fade the snow reaches zero thickness on the rock itself.
  const snowTopMaterial=snowMaterial.clone();snowTopMaterial.polygonOffset=true;snowTopMaterial.polygonOffsetFactor=-1;snowTopMaterial.polygonOffsetUnits=-1;
  const groups={stone:new THREE.Group(),rocks:new THREE.Group(),snow:new THREE.Group(),cave:new THREE.Group()};Object.values(groups).forEach(g=>scene.add(g));
  function mesh(data:MeshData&{normals?:Float32Array;colors?:number[]},mat:THREE.Material,top=false){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(data.positions,3));g.setIndex(new THREE.BufferAttribute(data.indices,1));if(data.normals)g.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));else if(top){const ns=new Float32Array(data.positions.length);for(let k=0;k<data.positions.length;k+=3){const n=upperNormal(upper,data.positions[k],data.positions[k+2]);ns.set([n.x,n.y,n.z],k);}g.setAttribute('normal',new THREE.BufferAttribute(ns,3));}else g.computeVertexNormals();const colors=data.colors?new Float32Array(data.colors):new Float32Array(data.positions.length);if(!data.colors){const c=new THREE.Color('#505a65').toArray();for(let k=0;k<colors.length;k+=3)colors.set(c,k);}g.setAttribute('color',new THREE.BufferAttribute(colors,3));const m=new THREE.Mesh(g,mat);m.castShadow=m.receiveShadow=true;return m;}
  for(const [name,data]of Object.entries(surfaces)){const top=name==='plateau'||name==='strip';const m=mesh(data,top?smooth:material,top);m.name=name;groups.stone.add(m);}
  const caveMaterial=makeRockMaterial(),caveHook=caveMaterial.onBeforeCompile;caveMaterial.onBeforeCompile=function(shader,r){caveHook.call(this,shader,r);shader.fragmentShader=shader.fragmentShader.replace('frost * 0.92','0.0');};caveMaterial.customProgramCacheKey=()=> 'plateau-den-dry-rock';groups.cave.add(mesh(cave,caveMaterial));
  status.textContent='Скалы и снежные полки…';await frame();
  const dressing=buildWedgeRocks(junction.cut,source,upper);groups.rocks.add(mesh(subtract(dressing.rocks,dressing.rocks.colors),material),mesh(subtract(dressing.snow),snowMaterial));
  status.textContent='Снежная шапка по всей горе…';await frame();
  const snow=buildMountainSnow(upper,junction,[surfaces.plateau,surfaces.strip]);for(const [name,data]of [['top',snow.top],['bottom',snow.bottom],['cap',snow.cap]]as const){const m=mesh(data,name==='top'?snowTopMaterial:snowMaterial);m.name='snow-'+name;m.castShadow=name!=='bottom';groups.snow.add(m);}
  let activeView='overview';
  const views:Record<string,{eye:number[];target:number[];fov?:number}>={
    overview:{eye:[520,310,560],target:[0,48,0],fov:45},back:{eye:[-560,280,-480],target:[0,48,0],fov:45},
    ascent:{eye:[-370,190,-230],target:[-130,50,-35],fov:45},ascentFoot:{eye:[-310,20,-60],target:[-190,45,-20],fov:55},ascentTop:{eye:[30,132,ascentCenter(20)],target:[-140,62,ascentCenter(-140)],fov:50},
    entrance:{eye:[340,9,12],target:[285,7,0],fov:42},inside:{eye:[279,6.8,0],target:[320,6.8,0],fov:65},top:{eye:[0,670,.1],target:[0,50,0],fov:45},
    edge:{eye:[244.64436973987432,127.31045870807777,194.19342741677312],target:[210.05573950985809,105.31045870807777,119.84541696046566],fov:25},
  };
  function draw(){renderer.render(scene,camera);}
  function view(name:string){activeView=name;const v=views[name];camera.position.fromArray(v.eye);controls.target.fromArray(v.target);camera.fov=v.fov||45;camera.updateProjectionMatrix();controls.update();draw();document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));}
  controls.addEventListener('change',draw);document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view!));
  document.querySelector<HTMLInputElement>('#snow')!.onchange=e=>{groups.snow.visible=(e.target as HTMLInputElement).checked;renderer.shadowMap.needsUpdate=true;draw();};document.querySelector<HTMLInputElement>('#rocks')!.onchange=e=>{groups.rocks.visible=(e.target as HTMLInputElement).checked;renderer.shadowMap.needsUpdate=true;draw();};
  const keys=new Set<string>();window.addEventListener('keydown',e=>{if((e.target as HTMLElement).matches('input,button,select'))return;if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)){keys.add(e.code);e.preventDefault();}});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());
  let previous=performance.now();function tick(now:number){const dt=Math.min(.05,(now-previous)/1000);previous=now;if(keys.size){const forward=new THREE.Vector3();camera.getWorldDirection(forward);const right=new THREE.Vector3().crossVectors(forward,camera.up).normalize(),move=new THREE.Vector3();if(keys.has('KeyW'))move.add(forward);if(keys.has('KeyS'))move.sub(forward);if(keys.has('KeyD'))move.add(right);if(keys.has('KeyA'))move.sub(right);if(keys.has('KeyE'))move.y++;if(keys.has('KeyQ'))move.y--;move.multiplyScalar(dt*(keys.has('ShiftLeft')?100:25));camera.position.add(move);controls.target.add(move);controls.update();draw();}requestAnimationFrame(tick);}requestAnimationFrame(tick);
  window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();draw();});
  renderer.shadowMap.needsUpdate=true;view('overview');status.textContent='Полная гора · снег F · подъём и пещера';
  (window as any).__mountain={ready:true,renderer,scene,camera,controls,source,upper,junction,surfaces,cave,dressing,snow,groups,view,views,state:()=>({view:activeView,exposure:renderer.toneMappingExposure,fill:fill.intensity,snow:groups.snow.visible,rocks:groups.rocks.visible,snowStats:snow.stats})};
}
start().catch(e=>{status.textContent='Ошибка: '+e.message;console.error(e);});
