import { Color, SRGBColorSpace } from 'three';
import { RockSkin } from '../../src/gen/rock-skin';
import { blockTriangles } from '../../src/gen/cliffs';
import { cutAscent } from './ascent';
import { subtract, type MeshData } from './cavity';
const TAU=Math.PI*2;
export function portalAngle(a:number){return Math.abs(Math.atan2(Math.sin(a),Math.cos(a)))<.12 || Math.abs(Math.PI-Math.abs(Math.atan2(Math.sin(a),Math.cos(a))))<.28;}
export function maskPoint(a:number,y:number,depth=0){
  const t=y/100;
  const shape=1+.095*Math.sin(3*a+.7)+.055*Math.cos(5*a-.4);
  const target=1.078+t*(.065+.05*Math.sin(3*a+1))+.025*Math.sin(Math.PI*t)*Math.sin(7*a+2);
  const q=Math.abs(Math.atan2(Math.sin(a),Math.cos(a)));
  const distance=Math.min(Math.max(0,q-.12),Math.max(0,Math.PI-q-.28));
  const u=Math.min(1,distance/.16),blend=u*u*(3-2*u);
  // Bury the mask ends into the original flank beside each opening.
  const scale=(1.04-.10*t)*(1-blend)+target*blend;
  return [Math.cos(a)*(260*shape*scale-depth),y+Math.pow(Math.max(0,y/100),6)*.06,Math.sin(a)*(180*shape*scale-depth)];
}
export function buildOverhang(){
 const positions:number[]=[],indices:number[]=[];
 const quad=(a:number[],b:number[],c:number[],d:number[])=>{const k=positions.length/3;positions.push(...a,...b,...c,...d);indices.push(k,k+1,k+2,k,k+2,k+3);};
 const segments=192,levels=12;
 for(let i=0;i<segments;i++){
  const a=i/segments*TAU,b=(i+1)/segments*TAU;
  if(portalAngle((a+b)/2))continue;
  for(let j=0;j<levels;j++)quad(maskPoint(a,j/levels*100),maskPoint(a,(j+1)/levels*100),maskPoint(b,(j+1)/levels*100),maskPoint(b,j/levels*100));
  const inner=(q:number)=>[Math.cos(q)*260*.86,100.06,Math.sin(q)*180*.86];
  quad(maskPoint(a,100),inner(a),inner(b),maskPoint(b,100));
  // Close the mask's exposed end faces at each opening. These vertices are
  // exactly the facade vertices; the back edge is buried inside the plateau.
  const closeEnd=(q:number,reverse:boolean)=>{
   for(let j=0;j<levels;j++){
    const y0=j/levels*100,y1=(j+1)/levels*100;
    const back=(y:number)=>y===100?inner(q):[Math.cos(q)*260*.80,y+Math.pow(y/100,6)*.06,Math.sin(q)*180*.80];
    const face=[maskPoint(q,y0),back(y0),back(y1),maskPoint(q,y1)];
    if(reverse)face.reverse();quad(face[0],face[1],face[2],face[3]);
   }
  };
  if(portalAngle(a-TAU/segments/2))closeEnd(a,false);
  if(portalAngle(b+TAU/segments/2))closeEnd(b,true);
 }
 const rawMask:MeshData={positions:new Float32Array(positions),indices:new Uint32Array(indices)};
 const mask=cutAscent(subtract(rawMask));
 // A continuous local surface chart follows the entire irregular perimeter.
 const size=1600,cell=4,n=size/cell,perimeter=1450,h=new Float32Array((n+1)**2);
 for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)h[j*(n+1)+i]=Math.min(100,Math.max(0,(j*cell-size/2)*30));
 const skin=new RockSkin({seed:42,size,n,cell,h,water:new Float32Array(h.length).fill(NaN),ox:size/2,oz:size/2,edgeDist:()=>500},
 {border:4,minDeg:51,exclude:(u,v)=>Math.abs(u)>perimeter/2-3||Math.abs(v)>12||portalAngle(u/perimeter*TAU)});
 const transform=(P:Float32Array)=>{const out=P.slice();for(let k=0;k<out.length;k+=3){const p=maskPoint(out[k]/perimeter*TAU,Math.min(99.5,out[k+1]),out[k+2]-out[k+1]/30);out.set(p,k);}return out;};
 const raw:number[]=[],colors:number[]=[];const soft=new Color().setRGB(.26,.27,.32,SRGBColorSpace),hard=new Color().setRGB(.41,.43,.49,SRGBColorSpace);
 for(const b of skin.blocks){const start=raw.length;blockTriangles(b,raw);const c=soft.clone().lerp(hard,b.tone);for(let k=start;k<raw.length;k+=3)colors.push(c.r,c.g,c.b);}
 const caveRocks=subtract({positions:transform(new Float32Array(raw)),indices:Uint32Array.from({length:raw.length/3},(_,i)=>i)},colors);
 const rocks=cutAscent(caveRocks,caveRocks.colors);
 const caps=cutAscent(subtract({positions:transform(skin.caps.positions),indices:skin.caps.indices}));
 return {mask,rocks,caps,blocks:skin.blocks.length};
}
