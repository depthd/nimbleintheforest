import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { reliefGrid } from '../../../../experiments/plateau/seam-relief-fixture';
import { smoothstep } from '../../../../src/core/rng';
import { plateauRadius } from '../../../../experiments/plateau/plateau-profile';
import { buildBoundary } from '../../../../experiments/plateau/seam-boundary';

function line(positions: number[], color = 0x007a50) {
  const mat = new LineMaterial({color, linewidth: 3, depthTest: false, depthWrite: false});
  mat.resolution.set(innerWidth, innerHeight);
  const mesh = new LineSegments2(new LineSegmentsGeometry().setPositions(positions), mat);
  mesh.renderOrder = 100;
  return mesh;
}

// Separate, uncut test mountain. It is not a modification of the game scene.
export function renderComparison(kind: string, radius: number) {
  const grid = reliefGrid();
  if(kind==='flat') grid.heights=grid.heights.map((_,i)=>{
    const x=grid.x0+i%(grid.n+1)*grid.cell,z=grid.z0+Math.floor(i/(grid.n+1))*grid.cell;
    const r=plateauRadius(x,z),w=1-smoothstep(.96,1.055,r),apron=1-smoothstep(1.04,1.23,r);
    return (1-w)*5*apron+w*100;
  });
  const seam=buildBoundary(grid,radius),oldSeam=buildBoundary(grid);
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
  const oldPositions:number[]=[];
  oldSeam.points.forEach((a,i)=>{const b=oldSeam.points[(i+1)%oldSeam.points.length];oldPositions.push(a.x,a.y,a.z,b.x,b.y,b.z)});
  scene.add(line(oldPositions,0xd42742),line(sourcePositions,0x006bc2));
  const sun = new THREE.DirectionalLight('#fff6e7', 3); sun.position.set(-300,300,100);
  scene.add(sun, new THREE.HemisphereLight('#d4efff','#4d616f',1.2));
  const camera = new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.1,3000);
  const render = (eye: number[], target: number[]) => {camera.position.fromArray(eye); camera.lookAt(new THREE.Vector3().fromArray(target)); renderer.render(scene,camera);};
  render([390,300,430],[0,50,0]);
  const label = document.createElement('aside');
  label.textContent=(kind==='flat'?'Плоский тест. ':'Рельеф до края, затухание ВЫКЛЮЧЕНО. ')+'Красная — прежняя E. Синяя — кандидат внутри верха. Одна и та же сетка; без маски и вырезов.';
  Object.assign(label.style,{position:'fixed',top:'16px',left:'16px',maxWidth:'600px',padding:'12px',background:'#13212cee',color:'white',font:'17px/1.5 system-ui',borderRadius:'8px'}); document.body.append(label);
  return {render, seam, oldSeam, grid: {n:grid.n,cell:grid.cell}, topAttenuation:false};
}


export function addCandidate(state:any,radius:number){
 const grid=reliefGrid();
 for(let j=0;j<=grid.n;j++)for(let i=0;i<=grid.n;i++)grid.heights[j*(grid.n+1)+i]=state.heightAt(grid.x0+i*grid.cell,grid.z0+j*grid.cell);
 const seam=buildBoundary(grid,radius),positions:number[]=[];
 seam.points.forEach((a,i)=>{const b=seam.points[(i+1)%seam.points.length];positions.push(a.x,a.y,a.z,b.x,b.y,b.z)});
 state.maskMesh.parent.add(line(positions,0x006bc2));
 return seam;
}
