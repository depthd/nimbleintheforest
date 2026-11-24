import { Vector3 } from 'three';
import { Rng, Simplex2, smoothstep } from '../../src/core/rng';
import { Surface, rockHorn } from './landform-mesh';

export function ledgeMountain(rng: Rng) {
  const rock = new Surface(), snow = new Surface(), noise = new Simplex2(rng.next);
  const count = 52, tau = 2*Math.PI;
  const start = rng.float(-.7, .65), turns = rng.float(1.28, 1.83);
  const radius = rng.float(170, 202), height = rng.float(312, 388);
  const stretch = rng.float(.82, 1.1), drift = rng.float(-42, 45);
  const phase = rng.float(0,tau), phase2 = rng.float(0,tau);
  const outcrops = new Surface();
  function section(j:number) {
    const a = start + tau*j/count, c = Math.cos(a), s = Math.sin(a);
    const progress = Math.max(0,Math.min(1,j/(count*turns)));
    // Spend more angular distance on the smaller upper circumference.
    const u = progress + .023*Math.sin(tau*progress+phase)*Math.sin(Math.PI*progress);
    const t = Math.expm1(-1.34*u)/Math.expm1(-1.34);
    const shape = 1+.12*Math.sin(3*a+phase)+.085*Math.cos(5*a+phase2)+.09*noise.noise(2.4*c+t,2.4*s);
    const beyond = Math.max(0,j/count-turns);
    const r = radius * (1-.72*t-.16*Math.min(1,beyond)) * shape;
    const width = (21 + 4*Math.sin(2*a+phase2) + 12*Math.pow(.5+.5*Math.cos(3*a+phase),4)) * (1-.80*Math.min(1,beyond));
    const point = (rad:number, y:number) => new Vector3(drift*t+rad*c, y, 14*t+stretch*rad*s);
    const y = t*height;
    const inner = point(r-width*.48,y), outer = point(r+width*.53,y-.36);
    const lip = point(r+width*.56,y-1.55);
    const foot = inner.clone().lerp(outer,.49);
    return {inner,outer,lip,foot,a,t};
  }
  function joinWall(i:number) {
    const column = (j:number) => {
      const lo = section(j-count).inner, {lip:hi,a} = section(j);
      const relief = Math.min(1, Math.max(0,hi.y-lo.y)/55);
      const toe=lo.clone();
      toe.y += Math.min(16,(hi.y-lo.y)*.55);
      toe.x-=Math.cos(a)*2*relief;toe.z-=Math.sin(a)*2*relief;
      return [lo,toe,...[.30,.74].map((f,k)=>{
        const n=noise.noise(2.2*Math.cos(a)+k,2.2*Math.sin(a)+lo.y*.002);
        const p=toe.clone().lerp(hi,f+.16*n);
        const rib=Math.pow(.5+.5*Math.cos(4*a+phase+.8*f),6);
        const shift=relief*(6+18*n+9*Math.cos(7*a+phase+f)+19*rib);
        p.x+=Math.cos(a)*shift; p.z+=Math.sin(a)*shift;
        return p;
      }),hi];
    };
    const a=column(i), b=column(i+1);
    for(let k=0;k<a.length-1;k++) rock.quad(a[k],a[k+1],b[k+1],b[k]);
    // Project irregular slabs from the actual cliff panels. Their toes sit
    // above the headroom envelope and the crowns stop below the snowy lip.
    const slab = (j:number, wall:Vector3[])=>{
      const angle=section(j).a, span=wall[4].y-wall[0].y;
      const field=noise.noise(2.7*Math.cos(angle)+wall[0].y*.006,2.7*Math.sin(angle)+phase);
      const mass=smoothstep(-.32,.40,field)*smoothstep(48,100,span);
      const outward=new Vector3(Math.cos(angle),0,Math.sin(angle));
      const toe=wall[1].clone().lerp(wall[2],.21);
      const brow=wall[3].clone().lerp(wall[4],.36+.23*field);
      return {mass,points:[toe.clone().addScaledVector(outward,-3),
        toe.clone().lerp(wall[2],.68).addScaledVector(outward,17*mass-3),
        brow.clone().addScaledVector(outward,27*mass-3),
        brow.clone().lerp(wall[4],.19).addScaledVector(outward,-4)]};
    };
    const left=slab(i,a), right=slab(i+1,b);
    if(left.mass+right.mass>.01){
      for(let k=0;k<3;k++)outcrops.quad(left.points[k],left.points[k+1],right.points[k+1],right.points[k]);
    }
  }
  const route:Vector3[]=[], trees: {root:Vector3;height:number}[]=[];
  const last = Math.ceil(turns*count);
  // Each tread is a shared edge between the headwall above and the cliff below.
  // The final revolution closes the summit, narrowing the last wall into it.
  for(let j=0; j<last+count; j++){
    const a=section(j), b=section(j+1);
    joinWall(j);
    rock.quad(a.lip,a.outer,b.outer,b.lip);
    snow.quad(a.outer,a.inner,b.inner,b.outer);
    if(j<last) route.push(a.foot);
    if(j>3 && j<last && (j%13===4 || j%19===6) && rng.chance(.72)){
      trees.push({root:a.inner.clone().lerp(a.outer,.1),height:rng.float(7,13)});
    }
  }
  route.push(section(last).foot);
  const center=new Vector3(drift,height,14);
  for(let j=last;j<last+count;j++){
    snow.triangle(center,section(j+1).inner,section(j).inner);
  }
  const summit = rockHorn(center.clone().add(new Vector3(-2,-height*.17,1)), radius*.19, height*rng.float(.39,.47),rng);
  for(let i=0;i<58;i++){
    const a=rng.float(0,tau), r=radius*rng.float(1.45,2);
    trees.push({root:new Vector3(r*Math.cos(a),0,r*stretch*Math.sin(a)),height:rng.float(6,17)});
  }
  return {rock:rock.data(),outcrops:outcrops.data(),snow:snow.data(),summit,route,trees};
}
