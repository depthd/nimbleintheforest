import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { reliefGrid } from '../../../../experiments/plateau/seam-relief-fixture';
import { buildBoundary } from '../../../../experiments/plateau/seam-boundary';

function line(positions: number[], color = 0x007a50) {
  const mat = new LineMaterial({color, linewidth: 3, depthTest: false, depthWrite: false});
  mat.resolution.set(innerWidth, innerHeight);
  const mesh = new LineSegments2(new LineSegmentsGeometry().setPositions(positions), mat);
  mesh.renderOrder = 100;
  return mesh;
}

// Separate, uncut test mountain. It is not a modification of the game scene.
export function renderFixture() {
  const grid = reliefGrid(), seam = buildBoundary(grid);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#d2e0e8');
  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1);
  document.body.append(renderer.domElement);
  const positions: number[] = [], indices: number[] = [];
  for (let j = 0; j <= grid.n; j++) for (let i = 0; i <= grid.n; i++) positions.push(grid.x0 + i * grid.cell, grid.heights[j * (grid.n + 1) + i], grid.z0 + j * grid.cell);
  for (let j = 0; j < grid.n; j++) for (let i = 0; i < grid.n; i++) {
    const a = j * (grid.n + 1) + i, b = a + 1, c = a + grid.n + 1, d = c + 1;
    indices.push(a,c,b,b,c,d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color: '#c4d1d4', roughness: 1, flatShading: true})));
  const sourcePositions: number[] = [];
  seam.points.forEach((a, i) => {const b = seam.points[(i+1)%seam.points.length]; sourcePositions.push(a.x,a.y,a.z,b.x,b.y,b.z);});
  scene.add(line(sourcePositions));
  const sun = new THREE.DirectionalLight('#fff6e7', 3); sun.position.set(-300,300,100);
  scene.add(sun, new THREE.HemisphereLight('#d4efff','#4d616f',1.2));
  const camera = new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.1,3000);
  const render = (eye: number[], target: number[]) => {camera.position.fromArray(eye); camera.lookAt(new THREE.Vector3().fromArray(target)); renderer.render(scene,camera);};
  render([390,300,430],[0,50,0]);
  const label = document.createElement('aside');
  label.textContent='Отдельный тест: рельеф до края, затухание ВЫКЛЮЧЕНО. Без маски и вырезов. Зелёная линия — E на настоящих треугольниках.';
  Object.assign(label.style,{position:'fixed',top:'16px',left:'16px',maxWidth:'600px',padding:'12px',background:'#13212cee',color:'white',font:'17px/1.5 system-ui',borderRadius:'8px'}); document.body.append(label);
  return {render, seam, grid: {n:grid.n,cell:grid.cell}, topAttenuation:false};
}

export function markGameEndpoints(state: any, endpoints: {x:number;y:number;z:number}[]) {
  endpoints.forEach((p,i)=>{
    const dot=new THREE.Mesh(new THREE.SphereGeometry(1.1,12,8),new THREE.MeshBasicMaterial({color:0xfe2b90,depthTest:false,depthWrite:false}));
    dot.position.set(p.x,p.y,p.z);dot.renderOrder=110;state.maskMesh.parent.add(dot);
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#13212c';ctx.fillRect(0,0,64,64);ctx.font='bold 44px sans-serif';ctx.fillStyle='white';ctx.textAlign='center';ctx.fillText(String(i+1),32,49);
    const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false,depthWrite:false}));
    label.position.set(p.x,p.y+5,p.z);label.scale.set(4,4,4);label.renderOrder=110;state.maskMesh.parent.add(label);
  });
}
