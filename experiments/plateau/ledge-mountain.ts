import { Vector3 } from 'three';
import { Rng, Simplex2, smoothstep } from '../../src/core/rng';
import { Surface } from './landform-mesh';

const slices = 84;
const turn = Math.PI * 2;
const wrap = (j: number) => ((j % slices) + slices) % slices;

export function ledgeMountain(rng: Rng) {
  const rock = new Surface(), snow = new Surface(), outcrops = new Surface();
  const noise = new Simplex2(rng.next);
  const aspect = rng.float(.78, 1.14), rotation = rng.float(0, turn);
  const crownRadius = rng.float(51, 85), lean = rng.float(-.25, .31);
  const levels = rng.int(3, 4), crownStrike = rng.float(0, turn);
  const cr = Math.cos(rotation), sr = Math.sin(rotation);
  const angles = Array.from({length:slices}, (_,i) => turn*i/slices);
  function point(i:number,r:number,y:number) {
    const a=angles[wrap(i)], x=r*(Math.cos(a)+lean), z=r*Math.sin(a)*aspect;
    return new Vector3(x*cr-z*sr,y,x*sr+z*cr);
  }

  // Plan the landings first. A climb follows a sector of a terrace and crosses
  // radially onto the next one at a saddle. The next climb can turn back.
  let entry=rng.int(0,slices-1), direction=rng.chance(.5)?1:-1;
  const shelves=Array.from({length:levels},(_,k)=>{
    if(k && (k===1 || rng.chance(.57)))direction*=-1;
    const start=entry, flat=rng.int(5,15), ramp=rng.int(23,35), exit=flat+ramp+2;
    entry=wrap(start+direction*exit);
    const pocket=rng.float(19,35), setback=rng.float(17,38);
    const phase=rng.float(0,turn), pocketCenter=rng.float(.25,.82)*flat;
    const wantedRise=rng.float(65,101);
    const stations=angles.map((a,i)=>{
      const u=wrap((i-start)*direction);
      const before=u>slices-10?u-slices:u;
      const band=smoothstep(-8,-2,before)*(1-smoothstep(exit+2,exit+9,before));
      const hollow=Math.exp(-((before-pocketCenter)**2)/28);
      const width=band*(17+2.2*Math.sin(2*a+phase)+pocket*hollow+8*Math.exp(-((u-exit)**2)/15));
      const spur=4+setback*(.65+.35*Math.cos(2*a+phase))+
        18*Math.max(0,noise.noise(2*Math.cos(a)+k,2*Math.sin(a)));
      return {u,width,spur,inner:0,outer:0,y:0,cover:0};
    });
    return {stations,start,flat,ramp,exit,direction,wantedRise,phase};
  });

  // Nest the profiles in plan. Narrow shelves can disappear completely into
  // an exposed cliff; the stone still has a coherent footprint at that angle.
  for(const [i,a] of angles.entries()){
    let r=crownRadius*(1+.21*Math.cos(2*a+crownStrike)+.13*noise.noise(Math.cos(a)*2,Math.sin(a)*2));
    for(let k=levels-1;k>=0;k--){
      const s=shelves[k].stations[i];
      s.inner=r; s.outer=r+s.width;
      r=s.outer+s.spur;
    }
  }
  let elevation=0;
  for(const shelf of shelves){
    // Integrate rise against the actual available run. This bounds the grade
    // on a tight inside corner too, where an angular step covers fewer metres.
    const rise=[0];
    for(let j=0;j<shelf.ramp;j++){
      const index=wrap(shelf.start+shelf.direction*(shelf.flat+j));
      const next=wrap(index+shelf.direction), s=shelf.stations[index];
      const tangent=point(next,s.inner,0).sub(point(index,s.inner,0));
      const radial=point(index,1,0).normalize();
      const run=tangent.clone().cross(radial).length();
      const easing=.5+.5*Math.sin(Math.PI*(j+.5)/shelf.ramp);
      rise.push(rise[j]+.77*run*easing);
    }
    const total=rise[shelf.ramp], height=Math.min(shelf.wantedRise,total);
    for(const [i,s] of shelf.stations.entries()){
      const climb=rise[Math.max(0,Math.min(shelf.ramp,s.u-shelf.flat))]/total;
      s.y=elevation+height*climb*(1-smoothstep(shelf.exit+6,shelf.exit+22,s.u));
      const exposure=.53+.46*Math.cos(angles[i]*2+shelf.phase);
      const drift=noise.noise(Math.cos(angles[i])*2.7+shelf.phase,Math.sin(angles[i])*2.7);
      const shelter=s.u<shelf.flat || Math.abs(s.u-shelf.exit)<3 ? .31 : -.10;
      s.cover=smoothstep(.22,.76,exposure*.64+drift*.47+shelter);
    }
    elevation+=height;
  }

  const route:Vector3[]=[], trees:{root:Vector3;height:number}[]=[];
  const outline:Vector3[]=[];
  for(const [k,shelf] of shelves.entries()){
    const stations=shelf.stations;
    const top=stations.map((s,i)=>{
      const outer=point(i,s.outer,s.y), inner=point(i,s.inner,s.y);
      return {outer,inner,edge:inner.clone().lerp(outer,s.cover),foot:inner.clone().lerp(outer,.5)};
    });
    function wall(i:number){
      const s=stations[i], a=angles[i], hi=top[i].outer;
      const prev=k?shelves[k-1].stations[i]:null;
      const lo=point(i,prev?.inner??s.outer+19,prev?.y??-.6);
      const outward=point(i,1,0).normalize();
      const span=hi.y-lo.y, relief=smoothstep(16,67,span);
      const joint=noise.noise(Math.cos(a)*2.6+k*1.3,Math.sin(a)*2.6);
      const base=lo.clone().lerp(hi,.33+joint*.11);
      const shoulder=lo.clone().lerp(hi,.78+joint*.09);
      base.addScaledVector(outward,relief*(3+8*joint));
      shoulder.addScaledVector(outward,relief*(4+13*joint));
      const mass=relief*smoothstep(-.23,.52,joint);
      const toe=lo.clone().lerp(base,.79), brow=shoulder.clone().lerp(hi,.24);
      return {profile:[lo,base,shoulder,hi],mass,slab:[
        toe.clone().addScaledVector(outward,-3),
        base.clone().lerp(shoulder,.28).addScaledVector(outward,20*mass-3),
        brow.clone().addScaledVector(outward,24*mass-3),
        brow.clone().lerp(hi,.30).addScaledVector(outward,-3)]};
    }
    const walls=angles.map((_,i)=>wall(i));
    for(let i=0;i<slices;i++){
      const j=wrap(i+1), a=top[i], b=top[j], left=walls[i], right=walls[j];
      for(let h=0;h<3;h++){
        rock.quad(left.profile[h],left.profile[h+1],right.profile[h+1],right.profile[h]);
        if(left.mass+right.mass>.05)outcrops.quad(left.slab[h],left.slab[h+1],right.slab[h+1],right.slab[h]);
      }
      rock.quad(a.outer,a.edge,b.edge,b.outer);
      snow.quad(a.edge,a.inner,b.inner,b.edge);
      outline.push(a.outer,left.profile[0]);
      if(stations[i].width>23 && rng.chance(.13))
        trees.push({root:a.inner.clone().lerp(a.outer,.10),height:rng.float(7,13)});
    }
    for(let step=0;step<=shelf.exit;step++){
      const i=wrap(shelf.start+shelf.direction*step);
      route.push(top[i].foot);
    }
    // Include both lips of the level crossing in the physical route.
    route.push(top[wrap(shelf.start+shelf.direction*shelf.exit)].inner);
    if(k+1<levels){
      const next=shelves[k+1], s=next.stations[next.start];
      route.push(point(next.start,s.outer,s.y));
    }
  }

  // Grow a broad, asymmetric crown directly out of the final cliff. Its high
  // side is a ridge with a shoulder; the arrival pocket stays on the low side.
  const last=shelves[levels-1], arrival=angles[entry];
  const crownHeight=rng.float(35,73), offset=rng.float(.35,1.05);
  const summit=new Surface(), rim:Vector3[]=[], brow:Vector3[]=[];
  for(const [i,a] of angles.entries()){
    const s=last.stations[i], shoulder=(1-Math.cos(a-arrival+offset))*.5;
    rim.push(point(i,s.inner,s.y));
    brow.push(point(i,s.inner*(.32+.44*shoulder),elevation+2+smoothstep(.04,.48,1-Math.cos(a-arrival))*(crownHeight*(.12+.88*shoulder)+4*noise.noise(Math.cos(a)*2,Math.sin(a)*2))));
  }
  const tip=brow.reduce((best,p)=>p.y>best.y?p:best);
  const center=tip.clone().multiplyScalar(.20).setY(elevation+crownHeight*.85);
  for(let i=0;i<slices;i++){
    const j=wrap(i+1), h=Math.max(rim[i].y,rim[j].y);
    const ledge=h>elevation-3 && brow[i].y-h<20;
    (ledge?snow:summit).quad(rim[i],brow[i],brow[j],rim[j]);
    snow.triangle(center,brow[j],brow[i]);
  }
  const approach=point(entry,last.stations[entry].inner, elevation).lerp(brow[entry],.28);
  route.push(approach);
  outline.push(...brow);
  for(let i=0;i<48;i++){
    const j=rng.int(0,slices-1);
    trees.push({root:point(j,shelves[0].stations[j].outer+rng.float(36,125),0),height:rng.float(6,15)});
  }
  return {rock:rock.data(),outcrops:outcrops.data(),snow:snow.data(),summit:{rock:summit.data(),tip},route,trees,outline};
}
