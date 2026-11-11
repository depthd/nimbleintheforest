import { Color, SRGBColorSpace } from 'three';
import { RockSkin } from '../../src/gen/rock-skin';
import { blockTriangles } from '../../src/gen/cliffs';
import { ascentHeight,ascentCenter,ascentWidth, profile } from './ascent';
import type { MeshData } from './cavity';
export function buildAscentWalls(heightAt:(x:number,z:number)=>number){
 const maskP:number[]=[],maskI:number[]=[],rockP:number[]=[],capP:number[]=[],capI:number[]=[];let blocks=0;const rockColors:number[]=[];const soft=new Color().setRGB(.26,.27,.32,SRGBColorSpace),hard=new Color().setRGB(.41,.43,.49,SRGBColorSpace);
 const n=240,cell=2,size=n*cell,h=new Float32Array((n+1)**2);
 for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)h[j*(n+1)+i]=Math.max(0,Math.min(100,(j*cell-size/2)*30));
 const skin=new RockSkin({seed:42,size,n,cell,h,water:new Float32Array(h.length).fill(NaN),ox:size/2,oz:size/2,edgeDist:()=>500}, {border:4,minDeg:51,exclude:(u,v)=>Math.abs(u)>158||Math.abs(v)>10});
 const offset=(x:number,y:number)=>{
  const floor=ascentHeight(x),t=Math.max(0,Math.min(1,(y-floor)/Math.max(1,100-floor)));
  return -2.2*Math.sin(Math.PI*t)*(.6+.4*Math.sin(x/28+y/33));
 };
 for(const side of [-1,1]){
  const point=(x:number,y:number,depth=0)=>[x,y,ascentCenter(x)+side*(ascentWidth(x)+offset(x,y)+depth)];
  const quad=(a:number[],b:number[],c:number[],d:number[])=>{const k=maskP.length/3;maskP.push(...a,...b,...c,...d);const I=side<0?[k,k+1,k+2,k,k+2,k+3]:[k,k+2,k+1,k,k+3,k+2];maskI.push(...I);};
  const samples=[...new Set(profile.flatMap((p,i)=>i===profile.length-1?[p.x]:Array.from({length:8},(_,j)=>p.x+(profile[i+1].x-p.x)*j/8)))].sort((a,b)=>a-b);
  for(let i=1;i<samples.length;i++){const x=samples[i-1],x2=samples[i];const f1=ascentHeight(x),f2=ascentHeight(x2),z1=ascentCenter(x)+side*ascentWidth(x),z2=ascentCenter(x2)+side*ascentWidth(x2);const top1=Math.min(100,heightAt(x,z1)),top2=Math.min(100,heightAt(x2,z2));if(top1<f1+.2||top2<f2+.2)continue;
   for(let j=0;j<12;j++){const a=j/12,b=(j+1)/12;quad(point(x,f1+(top1-f1)*a),point(x2,f2+(top2-f2)*a),point(x2,f2+(top2-f2)*b),point(x,f1+(top1-f1)*b));}
  }
  const transform=(raw:ArrayLike<number>)=>{const out:number[]=[];for(let i=0;i<raw.length;i+=3)out.push(...point(raw[i]-140,raw[i+1],raw[i+2]-raw[i+1]/30));return out;};
  for(const block of skin.blocks){const x0=block.minX-140,x1=block.maxX-140,mid=(x0+x1)/2,z=ascentCenter(mid)+side*ascentWidth(mid);
   if(x0<-295||x1>16||block.minY<Math.max(ascentHeight(x0),ascentHeight(x1))+1||block.maxY>Math.min(98.8,heightAt(mid,z)-.8))continue;
   const raw:number[]=[];blockTriangles(block,raw);const P=transform(raw);
   if(side<0)for(let k=0;k<P.length;k+=9)for(let j=0;j<3;j++)[P[k+3+j],P[k+6+j]]=[P[k+6+j],P[k+3+j]];
   rockP.push(...P);const color=soft.clone().lerp(hard,block.tone);for(let k=0;k<P.length;k+=3)rockColors.push(color.r,color.g,color.b);blocks++;
  }
  // Caps follow the same chart, clipped by local floor and mountain top.
  for(let i=0;i<skin.caps.indices.length;i+=3){const raw:number[]=[];for(let j=0;j<3;j++){const k=skin.caps.indices[i+j]*3;raw.push(...skin.caps.positions.subarray(k,k+3));}
   if(raw.some((_,k)=>k%3===0&&(raw[k]-140<-295||raw[k]-140>16||raw[k+1]<ascentHeight(raw[k]-140)+1||raw[k+1]>Math.min(98.9,heightAt(raw[k]-140,ascentCenter(raw[k]-140)+side*ascentWidth(raw[k]-140))-.7))))continue;
   const P=transform(raw),k=capP.length/3;capP.push(...P);capI.push(...(side<0?[k,k+2,k+1]:[k,k+1,k+2]));
  }
 }
 const mesh=(positions:number[],indices?:number[]):MeshData=>({positions:new Float32Array(positions),indices:indices?new Uint32Array(indices):Uint32Array.from({length:positions.length/3},(_,i)=>i)});
 return {mask:mesh(maskP,maskI),rocks:{...mesh(rockP),colors:rockColors},caps:mesh(capP,capI),blocks};
}
