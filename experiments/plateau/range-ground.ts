import { Simplex2, smoothstep } from '../../src/core/rng';
import { localPlan, type Tier } from './mountain-tiers';
import { plateauRadius } from './plateau-profile';
import { stream } from './range-seed';

export function rangeGround(tiers:Tier[], relief:'hills'|'valley') {
  const roots=tiers.filter(t=>!t.parent);
  const rng=stream('surrounding snowfield'), noise=new Simplex2(rng.next);
  const strike=rng.float(-.9,.9), dx=Math.cos(strike), dz=Math.sin(strike);
  const cell=30;
  const extent=Math.ceil((Math.max(...roots.map(t=>Math.max(Math.abs(t.x),Math.abs(t.z))+370*Math.max(t.width,t.depth??t.width)))+1400)/cell)*cell;
  const n=2*extent/cell, stride=n+1;
  const vertices:number[]=[], indices:number[]=[];
  for(let j=0;j<=n;j++) for(let i=0;i<=n;i++){
    const x=-extent+i*cell, z=-extent+j*cell;
    const broad=noise.noise(x/460,z/460), detail=noise.noise(x/215+6,z/215);
    let height=relief==='hills'?96*(.52+.47*broad)**1.6+16*(.5+.5*detail):
      (28+132*smoothstep(120,850,Math.abs(x*dx+z*dz+195*broad)))*(.82+.18*detail);
    let cover=1;
    for(const t of roots){
      const p=localPlan(t,x,z), r=plateauRadius(p.x,p.z);
      if(r>2)continue;
      const apron=smoothstep(.95,1.56,r);
      // Keep a mouth open at each excavated ascent and at the base cave.
      const offset=Math.abs(p.z-(p.x<0?-50:0));
      const access=Math.max(smoothstep(46,102,offset),smoothstep(1.40,1.90,r));
      cover=Math.min(cover,apron*access);
    }
    height*=cover*smoothstep(0,360,extent-Math.max(Math.abs(x),Math.abs(z)));
    vertices.push(x,height,z);
    if(i<n && j<n){
      const a=j*stride+i, b=a+stride;
      indices.push(a,b,a+1,a+1,b,b+1);
    }
  }

  // Feet and tree roots interpolate the same triangle that is drawn.
  function floor(x:number,z:number){
    const gx=(x+extent)/cell,gz=(z+extent)/cell,i=Math.floor(gx),j=Math.floor(gz);
    if(i<0||j<0||i>=n||j>=n)return 0;
    const u=gx-i,v=gz-j,a=(j*stride+i)*3+1,b=a+stride*3;
    return u+v<=1?(1-u-v)*positions[a]+u*positions[a+3]+v*positions[b]:
      (u+v-1)*positions[b+3]+(1-v)*positions[a+3]+(1-u)*positions[b];
  }
  // Continue the flat outer boundary all the way to the horizon.
  const base=vertices.length/3, far=16000;
  for(const r of [extent,far])vertices.push(-r,0,-r,-r,0,r,r,0,r,r,0,-r);
  for(let i=0;i<4;i++){
    const a=base+i,b=base+(i+1)%4;
    indices.push(a,a+4,b+4,a,b+4,b);
  }
  const positions=Float32Array.from(vertices);
  return {mesh:{positions,indices:Uint32Array.from(indices)},floor};
}
