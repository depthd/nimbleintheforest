// Macro composition for the full mountain only. The original F fixture is retained.
import { Color } from 'three';
import { Rng, Simplex2, smoothstep } from '../../src/core/rng';
import { blockTriangles, pillow, type CliffBlock } from '../../src/gen/cliffs';
import { chaoticTop } from './seam-relief-fixture';
import { distanceToAscent } from './mountain-snow';
import { radialSurface, surfaceRoof } from './wedge-rocks';
import { contourPoint } from './plateau-profile';
import { type MeshData } from './cavity';

const noise = new Simplex2(new Rng(19547).next);
const gauss = (x:number,z:number,cx:number,cz:number,sx:number,sz:number) => Math.exp(-(((x-cx)/sx)**2+((z-cz)/sz)**2));
export function mountainTop(x:number,z:number) {
  // Large, unequal shoulders and one broad basin: detail is subordinate to the skyline.
  const h=74 + 82*gauss(x,z,130,-155,110,80) + 65*gauss(x,z,-185,130,95,70)
    + 64*gauss(x,z,205,140,75,70) - 20*gauss(x,z,-15,165,80,60)
    + 3.5*noise.noise(x/80+8,z/80-5) + .5*noise.noise(x/23,z/23);
  const w=smoothstep(12,65,distanceToAscent({x,z}));
  return chaoticTop(x,z)*(1-w)+h*w;
}

// Continuous plan deformation, shared by ALL surfaces, snow and dressing.
// It is identity around the existing passage and cave, including their surrounds.
export function landformPoint(x:number,y:number,z:number) {
  const a=Math.atan2(z/180,x/260),r=Math.hypot(x/260,z/180);
  const protect=smoothstep(0,65,Math.hypot(Math.max(-335-x,0,x-55),Math.max(-130-z,0,z-35)))*smoothstep(25,85,Math.hypot(x-300,z));
  const delta=(.075*Math.sin(7*a+1.1)+.045*Math.cos(11*a-.8)) * smoothstep(.4,.85,r) * (1-smoothstep(1.3,2,r)) * protect;
  const inset=(.075+.045*Math.sin(a*3+.3))*smoothstep(25,95,y)*smoothstep(.65,.95,r)*(1-smoothstep(1.3,2,r))*protect;
  return {x:x*(1+delta-inset),y,z:z*(1+delta-inset)};
}
export function sculptMesh<T extends MeshData & {normals?:Float32Array}>(m:T):T {
  const p=new Float32Array(m.positions.length),ns=m.normals?new Float32Array(m.normals.length):undefined;
  for(let i=0;i<p.length;i+=3){const x=m.positions[i],y=m.positions[i+1],z=m.positions[i+2],q=landformPoint(x,y,z);p.set([q.x,y,q.z],i);
    if(ns&&m.normals){const d=.02,px=landformPoint(x+d,y,z),mx=landformPoint(x-d,y,z),pz=landformPoint(x,y,z+d),mz=landformPoint(x,y,z-d);
      const ax=(px.x-mx.x)/(2*d),az=(px.z-mx.z)/(2*d),bx=(pz.x-mz.x)/(2*d),bz=(pz.z-mz.z)/(2*d),det=ax*bz-az*bx;
      const py=landformPoint(x,y+d,z),my=landformPoint(x,y-d,z);const nx=(bz*m.normals[i]-az*m.normals[i+2])/det,nz=(-bx*m.normals[i]+ax*m.normals[i+2])/det,ny=m.normals[i+1]-(py.x-my.x)/(2*d)*nx-(py.z-my.z)/(2*d)*nz,l=Math.hypot(nx,ny,nz);ns.set([nx/l,ny/l,nz/l],i);
    }
  }
  return {...m,positions:p,...(ns?{normals:ns}:{})};
}

export function buildMountainMasses(surfaces:{underside:MeshData;flank:MeshData;restored:MeshData;plateau:MeshData;strip:MeshData}) {
  const sample=radialSurface([surfaces.underside,surfaces.flank,surfaces.restored]);
  const roof=surfaceRoof([surfaces.plateau,surfaces.strip]);
  const rng=new Rng(67319),pos:number[]=[],colors:number[]=[],snowP:number[]=[],snowI:number[]=[];
  const stats={largeMasses:0,secondaryMasses:0,snowCaps:0,rejected:0};
  // Unequal, tall blocks interrupt the cliff. No common bedding levels or global rows.
  function block(a:number,small:boolean){
    const cp=contourPoint(a,1.03),h=roof(cp.x,cp.z);if(h===undefined)return;
    const floor=small?rng.float(-3,35):rng.float(-5,12),top=small?Math.min(h-5,floor+rng.float(12,33)):h-rng.float(3,15);
    const mid=(floor+top)/2,b=sample(a,Math.min(90,mid));if(!b)return;
    const width=small?rng.float(7,15):rng.float(19,35),depth=small?rng.float(5,11):rng.float(16,30);
    if(distanceToAscent(b)<width+14||Math.hypot(b.x-300,b.z)<width+25){stats.rejected++;return;}
    const len=Math.hypot(b.x,b.z),nx=b.x/len,nz=b.z/len,tx=-nz,tz=nx;
    const n=7,rings=5,P:number[]=[],jitter=Array.from({length:n},()=>rng.float(.78,1.13)),lean=rng.float(-14,14),tilt=rng.float(-.35,.35);
    for(let r=0;r<rings;r++)for(let k=0;k<n;k++){
      const t=k/n*Math.PI*2,scale=[1.25,1.05,.94,.83,.72][r],u=Math.sin(t)*width*jitter[k]*scale+lean*r/4;
      const v=Math.cos(t)*depth*jitter[k]*scale-7 + [5,3,0,-2,-3][r];
      const y=[floor, floor+(top-floor)*.32,floor+(top-floor)*.66,top-3,top][r]+u*tilt;
      P.push(b.x+tx*u+nx*v,y,b.z+tz*u+nz*v);
    }
    // Keep the entire crown below the real upper surface, including cap thickness.
    let ceiling=Infinity;
    for(let k=0;k<P.length;k+=3){const h=roof(P[k],P[k+2]);if(h!==undefined)ceiling=Math.min(ceiling,h-P[k+1]);}
    if(ceiling<1.6){stats.rejected++;return;}
    const B:CliffBlock={kind:'boulder',n,rings,pts:new Float32Array(P),tone:rng.float(.25,.8),layer:0,minX:0,maxX:0,minY:floor,maxY:top,minZ:0,maxZ:0};
    const raw:number[]=[];blockTriangles(B,raw);pos.push(...raw);
    const c=new Color('#556373').lerp(new Color('#79828b'),B.tone);for(let k=0;k<raw.length;k+=3)colors.push(c.r,c.g,c.b);
    if(small)stats.secondaryMasses++;else stats.largeMasses++;
    if(rng.next()<.57){pillow(B,rng.float(.45,.95),()=>1,snowP,snowI);stats.snowCaps++;}
  }
  for(let s=0;s<1450;s+=rng.float(30,48))block(s/1450*Math.PI*2,false);
  for(let s=0;s<1450;s+=rng.float(19,39))block(s/1450*Math.PI*2,true);
  return {rocks:{positions:new Float32Array(pos),indices:Uint32Array.from({length:pos.length/3},(_,i)=>i),colors},snow:{positions:new Float32Array(snowP),indices:new Uint32Array(snowI)},stats};
}
