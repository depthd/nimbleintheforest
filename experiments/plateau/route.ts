import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from '../../src/core/input';
import { G, GROUPS_STATIC, GROUPS_TREE } from '../../src/game/ctx';
import { Player } from '../../src/game/player';
import { makeRockMaterial } from '../../src/world/cliffs';
import { groundUniforms } from '../../src/world/terrain';
import { noiseTexture } from '../../src/core/noisetex';
import { buildTraversalGroves } from './mountain-groves';
import { generateSliceTerrain } from './slice-terrain';
import { buildSlicePassages } from './slice-passages';
import { stepSliceRope, createSliceRopeState } from './slice-passages-rope';
import { buildSliceBridges } from './slice-bridges';
import { makeWallGroup, wallParameters } from './slice-wall';
import { wallOutcrop } from './wall-outcrop';
import type { MeshData } from './cavity';

const element = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const {seed,family,preset} = wallParameters(params);
element<HTMLInputElement>('seed').value = String(seed);
element<HTMLSelectElement>('family').value = family;
element('rebuild').onclick = () => {
  const query=new URLSearchParams(params);
  query.set('seed',element<HTMLInputElement>('seed').value);
  query.set('wall',element<HTMLSelectElement>('family').value);
  location.search=query.toString();
};
async function start() {
  await RAPIER.init();
  const canvas=element<HTMLCanvasElement>('scene');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:false});
  renderer.setPixelRatio(Math.min(1.5,devicePixelRatio));
  const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(68,1,.08,900);
  scene.background=new THREE.Color('#aebcc7');
  scene.fog=new THREE.FogExp2('#aebcc7',.0024);
  scene.add(new THREE.HemisphereLight(0xdce8ef,0x58627a,1.25));
  const sun=new THREE.DirectionalLight(0xfff1db,2.2);
  sun.position.set(-50,65,40); scene.add(sun);
  const world=new RAPIER.World({x:0,y:-9.81,z:0});
  const terrain=generateSliceTerrain(seed,{passages:true});
  const passages=buildSlicePassages(terrain.passageAnchors,seed);
  const bridge=buildSliceBridges(terrain);
  const input=new Input(canvas), handles=new Set<number>();
  const rock=makeRockMaterial();
  groundUniforms.uNoise.value=noiseTexture();
  rock.side=THREE.DoubleSide;
  const snow=new THREE.MeshStandardMaterial({color:0xd8e0e4,roughness:1,flatShading:true,side:THREE.DoubleSide});
  const cave=makeRockMaterial(), shadeRock=cave.onBeforeCompile;
  cave.side=THREE.DoubleSide;
  cave.onBeforeCompile=function(shader,renderer){
    shadeRock.call(this,shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace('frost * 0.92','0.0');
  };
  cave.customProgramCacheKey=()=> 'sheltered-rock';
  const ropeMat=new THREE.MeshStandardMaterial({color:0x9f8153,roughness:1,flatShading:true});
  const pin=new THREE.MeshStandardMaterial({color:0x493d35,roughness:1});
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(760,650),snow);
  ground.rotation.x=-Math.PI/2;ground.position.set(35,-.02,0);scene.add(ground);
  handles.add(world.createCollider(RAPIER.ColliderDesc.cuboid(380,.5,325).setTranslation(35,-.5,0).setCollisionGroups(GROUPS_STATIC)).handle);
  function trimesh(d:MeshData) {
    handles.add(world.createCollider(RAPIER.ColliderDesc.trimesh(d.positions,d.indices).setCollisionGroups(GROUPS_STATIC)).handle);
  }
  function mesh(d:MeshData,material:THREE.Material,name:string,solid=true) {
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(d.positions,3));g.setIndex(new THREE.BufferAttribute(d.indices,1));
    if(material===rock || material===cave) {
      const colors=new Float32Array(d.positions.length), color=new THREE.Color(material===rock?'#616874':name==='passage-floor'?'#5c6370':'#505867');
      for(let i=0;i<colors.length;i+=3)color.toArray(colors,i);
      g.setAttribute('color',new THREE.BufferAttribute(colors,3));
    }
    g.computeVertexNormals(); const m=new THREE.Mesh(g,material);m.name=name;scene.add(m);
    if(solid)trimesh(d);
  }
  mesh(terrain.rock,rock,'terrain-rock');mesh(terrain.snow,snow,'terrain-snow');
  for(const surface of passages.surfaces) {
    const m=surface.name==='rope'?ropeMat:surface.name==='rope-anchor'?pin:cave;
    mesh(surface,m,surface.name,surface.collider);
  }
  if(bridge){scene.add(bridge.group);trimesh(bridge.collider);}
  const wall=terrain.wallAnchor;
  if(family!=='original') {
    const group=makeWallGroup({...wall,angle:Math.PI,groundAt:()=>0},family,preset,seed,rock,snow);
    scene.add(group);
    for(const m of group.children as THREE.Mesh[]) {
      trimesh({positions:m.geometry.getAttribute('position').array as Float32Array,indices:m.geometry.index!.array as Uint32Array});
    }
  } else {
    const shape=wallOutcrop({x:wall.x,z:wall.z+1,angle:Math.PI,width:wall.width,depth:wall.width*.27,
      height:wall.height*.83,base:-.15,lean:.14,rake:.28,crown:.09,wear:.48},
      [[-.50,-.2],[0,-.5],[.50,-.24],[.42,.32],[0,.5],[-.45,.26]].map(([x,z])=>[x*wall.width,z*wall.width*.27,0,1]),seed);
    for(const piece of shape)for(const [part,mat] of [[piece.rock,rock],[piece.snow,snow]] as const){
      mesh({positions:Float32Array.from(part.points.flatMap(p=>[p.x,p.y,p.z])),indices:Uint32Array.from(part.indices)},mat,'archive-outcrop');
    }
  }
  scene.add(await buildTraversalGroves(terrain.trees));
  for(const t of terrain.trees){
    world.createCollider(RAPIER.ColliderDesc.cylinder(t.height*.35,t.radius)
      .setTranslation(t.x,t.y+t.height*.35,t.z).setCollisionGroups(GROUPS_TREE));
  }
  const hint=element('cue');
  Object.assign(G,{world,R:RAPIER,scene,camera,input,terrain:{handles},region:{minX:-335,maxX:410,minZ:-315,maxZ:315},
    lake:{onIce:()=>false,levelAt:()=>NaN,onThin:()=>false,handles:new Set()},house:{zoneAt:()=>null,woodenSupports:new Set()},
    body:{fatigue:0,mood:1,core:37,frostFeet:0,condition:100},hud:{flash:()=>{},message:(s:string)=>{hint.textContent=s;}},audio:{play:()=>{}}});
  world.step();
  // The production avatar resolves model URLs from the game root. This entry is two levels below it.
  THREE.DefaultLoadingManager.setURLModifier(url=>url.startsWith('models/')?new URL('../../'+url,location.href).href:url);
  const p=new Player();
  p.init(new THREE.Vector3(terrain.spawn.x,terrain.spawn.y+.04,terrain.spawn.z),-Math.PI/2);
  p.avatar.root.visible=false;
  let overview=false, ropeState=createSliceRopeState();
  const dt=1/60;
  function step() {
    p.look();
    p.yaw+=((input.down('ArrowLeft')?1:0)-(input.down('ArrowRight')?1:0))*dt*1.5;
    const r=stepSliceRope(passages.rope,ropeState,p.pos,{
      interact:input.hit('KeyE'),climb:Number(input.down('KeyW'))-Number(input.down('KeyS'))},dt);
    ropeState=r.state;hint.textContent=r.hint;
    if(r.attached) {
      p.kcc.computeColliderMovement(p.collider,r.displacement,RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      const d=p.kcc.computedMovement(),t=p.body.translation();
      p.prevPos.copy(p.pos);p.body.setNextKinematicTranslation({x:t.x+d.x,y:t.y+d.y,z:t.z+d.z});
      p.pos.set(t.x+d.x,t.y+d.y-.9,t.z+d.z);p.vy=0;p.grounded=false;
    } else p.physics(dt);
    world.step();input.endFrame();
  }
  function draw() {
    if(overview){camera.position.set(105,99,132);camera.lookAt(36,9,0);}
    else {camera.position.copy(p.pos);camera.position.y+=p.crouch?1.05:1.7;camera.rotation.order='YXZ';camera.rotation.set(p.pitch,p.yaw,0);}
    renderer.render(scene,camera);
  }
  const setOverview=(on:boolean)=>{overview=on;element('view').textContent=on?'От первого лица':'Обзор гор';draw();};
  element('view').onclick=()=>setOverview(!overview);
  const walk=()=>{setOverview(false);input.lock();};
  canvas.onclick=walk;element('walk').onclick=walk;
  input.onLockChange=v=>document.body.classList.toggle('locked',v);
  const resize=()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();draw();};
  window.addEventListener('resize',resize);resize();
  element('status').textContent='WASD · идти   Мышь / ← → · обзор   Пробел · прыгнуть   E · канат   Esc · меню';
  const qa=params.get('qa')==='1';
  if(qa){
    Object.assign(window,{__route:{ready:true,terrain:{...terrain,rock:undefined,snow:undefined},passages:passages.routes,
      bridge:bridge?.route,step:(n:number)=>{for(let i=0;i<n;i++)step();draw();},look:(yaw:number,pitch=0)=>{p.yaw=yaw;p.pitch=pitch;draw();},
      state:()=>({x:p.pos.x,y:p.pos.y,z:p.pos.z,yaw:p.yaw,attached:ropeState.attached,grounded:p.grounded}),overview:setOverview,survey:(eye:[number,number,number],target:[number,number,number])=>{camera.position.set(...eye);camera.lookAt(...target);renderer.render(scene,camera);}}});
  } else {
    let last=performance.now(),pending=0;
    renderer.setAnimationLoop(now=>{pending+=Math.min(.1,(now-last)/1000);last=now;
      while(pending>=dt){step();pending-=dt;} draw();});
  }
}
start().catch(e=>{element('status').textContent=String(e);console.error(e);});
