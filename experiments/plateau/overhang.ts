import { RockSkin } from '../../src/gen/rock-skin';
import { blockTriangles } from '../../src/gen/cliffs';
import type { MeshData } from './cavity';

// Two principal faces: a reverse-sloped facade and an upper plane buried in the mesa.
// Closed ends are included in the collision geometry as well.
export function buildOverhang() {
  const positions:number[]=[],indices:number[]=[];
  const quad=(a:number[],b:number[],c:number[],d:number[])=>{const k=positions.length/3;positions.push(...a,...b,...c,...d);indices.push(k,k+1,k+2,k,k+2,k+3);};
  quad([-55,0,190],[55,0,190],[55,100,220],[-55,100,220]);
  quad([-55,100,220],[55,100,220],[55,98,130],[-55,98,130]);
  quad([-55,0,130],[-55,0,190],[-55,100,220],[-55,98,130]);
  quad([55,0,190],[55,0,130],[55,98,130],[55,100,220]);
  const mask:MeshData={positions:new Float32Array(positions),indices:new Uint32Array(indices)};

  // Existing RockSkin operates in a local near-vertical chart (about 88 degrees).
  // Transform its vertices into the facade frame; it never samples the plateau.
  const n=80,cell=2,size=n*cell,h=new Float32Array((n+1)**2);
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)h[j*(n+1)+i]=Math.min(100,Math.max(0,(j*cell-size/2)*30));
  const skin=new RockSkin({seed:42,size,n,cell,h,water:new Float32Array(h.length).fill(NaN),ox:size/2,oz:size/2,edgeDist:()=>500},
    {border:4,minDeg:51,exclude:(x,z)=>Math.abs(x)>51||Math.abs(z)>10});
  const transform=(P:Float32Array)=>{const out=P.slice();for(let i=0;i<out.length;i+=3)out[i+2]=190+out[i+1]/3-out[i+2];return out;};
  const raw:number[]=[];
  for(const b of skin.blocks)blockTriangles(b,raw);
  const rockPositions=transform(new Float32Array(raw));
  // The chart transformation is a reflection: reverse triangle winding.
  for(let i=0;i<rockPositions.length;i+=9)for(let j=0;j<3;j++)[rockPositions[i+3+j],rockPositions[i+6+j]]=[rockPositions[i+6+j],rockPositions[i+3+j]];
  const capIndices=skin.caps.indices.slice();
  for(let i=0;i<capIndices.length;i+=3)[capIndices[i+1],capIndices[i+2]]=[capIndices[i+2],capIndices[i+1]];
  return {mask,rocks:{positions:rockPositions,indices:Uint32Array.from({length:rockPositions.length/3},(_,i)=>i)},
    caps:{positions:transform(skin.caps.positions),indices:capIndices},blocks:skin.blocks.length};
}
