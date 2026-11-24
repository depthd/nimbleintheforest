// Full-mountain counterpart of the F experiment. The original diagnostic is untouched.
// One height function covers both top owners; the finite patch's rear/end caps disappear.
import { type MeshData, type Point } from './cavity';
import { type SourceGrid, sampleGrid } from './seam-boundary';
import { type buildWedgeAscent } from './wedge-ascent';
import { ringPoint, upperNormal, snowSettings, type SnowMesh } from './wedge-snow-layer';
import { ascentSample, profile } from './ascent';
import { smoothstep } from '../../src/core/rng';

const TAU = Math.PI * 2;
const angle = (p: Point) => (Math.atan2(p.z / 180, p.x / 260) + TAU) % TAU;
const point = (p: Point): Point => ({ x: Math.fround(p.x), y: Math.fround(p.y), z: Math.fround(p.z) });
const mix = (a: Point, b: Point, t: number): Point => ({ x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t });
const unit = (p: Point): Point => {const l=Math.hypot(p.x,p.y,p.z)||1;return {x:p.x/l,y:p.y/l,z:p.z/l};};
const cross = (a:Point,b:Point):Point => ({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const sub = (a:Point,b:Point):Point => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const key = (p:Point) => `${p.x},${p.y},${p.z}`;
const footprints=profile.slice(1).map((b,i)=>{const a=profile[i];return [{x:a.x,z:a.z-a.w},{x:b.x,z:b.z-b.w},{x:b.x,z:b.z+b.w},{x:a.x,z:a.z+a.w}];});
export function distanceToAscent(p:{x:number;z:number}) {
  let best=Infinity;
  for(const poly of footprints){
    if(poly.every((a,i)=>{const b=poly[(i+1)%4];return (b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x)>=0;}))return 0;
    for(let i=0;i<4;i++){const a=poly[i],b=poly[(i+1)%4],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));best=Math.min(best,Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz));}
  }return best;
}
function storage(){return {p:[] as number[],n:[] as number[],i:[] as number[],vertices:new Map<string,number>()};}
function emit(s:ReturnType<typeof storage>,ps:Point[],ns:Point[]){const d=cross(sub(ps[1],ps[0]),sub(ps[2],ps[0]));if(Math.hypot(d.x,d.y,d.z)<1e-9)return;ps.forEach((p,i)=>{const n=ns[i],k=[p.x,p.y,p.z,Math.fround(n.x),Math.fround(n.y),Math.fround(n.z)].join(',');let id=s.vertices.get(k);if(id===undefined){id=s.p.length/3;s.vertices.set(k,id);s.p.push(p.x,p.y,p.z);s.n.push(n.x,n.y,n.z);}s.i.push(id);});}
function pack(s:ReturnType<typeof storage>):SnowMesh{return {positions:new Float32Array(s.p),normals:new Float32Array(s.n),indices:new Uint32Array(s.i)};}

export function mountainRim(junction:ReturnType<typeof buildWedgeAscent>) {
  return {...junction.accepted.nose, points:junction.nose, angles:junction.nose.map(angle)};
}

export function buildMountainSnow(upper:SourceGrid,junction:ReturnType<typeof buildWedgeAscent>,roof:MeshData[],
  rim: Partial<Pick<typeof snowSettings, 'edge' | 'radius' | 'overhang'> & { interiorStepM: number; edgeStepM: number }> = {}) {
  const nose=mountainRim(junction),seam=junction.accepted.seam;
  const cache=new Map<string,{p:Point;b:Point;n:Point;coverage:number;edgeDistance:number}>();
  const settings={...snowSettings,passageBareM:4,passageFadeM:10,interiorStepM:2,edgeStepM:.5,...rim};
  const bounds = {
    x0: profile[0].x - settings.passageFadeM, x1: profile[profile.length-1].x + settings.passageFadeM,
    z0: Math.min(...profile.map(p=>p.z-p.w)) - settings.passageFadeM,
    z1: Math.max(...profile.map(p=>p.z+p.w)) + settings.passageFadeM
  };
  function field(x:number,z:number){
    const a=angle({x,y:0,z}),n=ringPoint(nose,a),e=ringPoint(seam,a),h=sampleGrid(upper,x,z).y;
    const width=Math.hypot(n.x-e.x,n.z-e.z)*(Math.hypot(n.x,n.z)>=Math.hypot(e.x,e.z)?1:-1);
    const edgeDistance=Math.hypot(n.x-x,n.z-z),outward=(Math.hypot(x,z)-Math.hypot(e.x,e.z))/Math.max(.001,width);
    const v=Math.max(0,Math.min(1,outward)),cornice=smoothstep(0,12,width);
    const coverAwayFromPass=x<bounds.x0||x>bounds.x1||z<bounds.z0||z>bounds.z1 ? 1
      : smoothstep(settings.passageBareM,settings.passageFadeM,distanceToAscent({x,z}));
    let bank=0;
    if(x>=profile[0].x && x<=profile[profile.length-1].x && z>=bounds.z0 && z<=bounds.z1){
      const ramp=ascentSample(x), d=Math.abs(Math.abs(z-ramp.z)-ramp.w);
      bank=(1-smoothstep(0,13,d))*smoothstep(6,25,h-ramp.y);
    }
    const coverage=Math.max(coverAwayFromPass,bank);
    const normal=upperNormal(upper,x,z),slope=Math.acos(Math.max(-1,Math.min(1,normal.y)))*180/Math.PI;
    const shelter=.5+.5*Math.cos(5*a+.45)*Math.cos(2*a-.8);
    // Long patches of exposed rim and sheltered pockets, measured along
    // the same perimeter as the rock. Keep the authored cut-bank roll.
    const windLoad=smoothstep(0.08,0.90,0.5+0.35*Math.cos(3*a-0.9)+0.19*Math.sin(7*a+1.1)+0.09*Math.cos(12*a));
    const exposedRim=coverAwayFromPass*(1-bank);
    const rimLoad=shelter+(windLoad-shelter)*exposedRim;
    const edgeDepth=settings.edge*((.65+.34*shelter)*(1-exposedRim)+(.055+1.16*rimLoad)*exposedRim);
    const lip=Math.max(smoothstep(.42,1,v)*cornice,bank*.76);
    const nominal=settings.plateau+(edgeDepth-settings.plateau)*lip;
    const thickness=Math.max(settings.minThickness,nominal*(1-smoothstep(settings.slopeStart,settings.slopeEnd,slope)));
    const blend=smoothstep(.78,1,v)*cornice;
    // Vertical placement cannot fold over the steep parts of the original normal-offset layer.
    const y=h+coverage*Math.max(settings.minThickness,h+blend*(n.y-h)+thickness-h);
    return {y,coverage,edgeDistance,lip,shelter,rimLoad,exposedRim};
  }
  function sample(p:Point){const k=key(p);let q=cache.get(k);if(q)return q;
    const f=field(p.x,p.z),d=settings.normalRadius;
    q={p:point({x:p.x,y:f.coverage?f.y:p.y,z:p.z}),b:point({...p,y:p.y-settings.embed*f.coverage}),coverage:f.coverage,edgeDistance:f.edgeDistance,
      n:unit({x:-(field(p.x+d,p.z).y-field(p.x-d,p.z).y)/(2*d),y:1,z:-(field(p.x,p.z+d).y-field(p.x,p.z-d).y)/(2*d)})};cache.set(k,q);return q;
  }
  const top=storage(),bottom=storage(),cap=storage(),boundaries=new Map<string,{a:Point;b:Point}>();
  const edges=(a:Point,b:Point)=>[key(a),key(b)].sort().join('|');
  for(const mesh of roof)for(let k=0;k<mesh.indices.length;k+=3){const ps=Array.from(mesh.indices.subarray(k,k+3),id=>point({x:mesh.positions[id*3],y:mesh.positions[id*3+1],z:mesh.positions[id*3+2]}));for(let i=0;i<3;i++){const a=ps[i],b=ps[(i+1)%3],ek=edges(a,b);if(boundaries.has(ek))boundaries.delete(ek);else boundaries.set(ek,{a,b});}}
  function needsSplit(a:Point,b:Point){const m=mix(a,b,.5),n=ringPoint(nose,angle(m)),near=Math.min(sample(a).edgeDistance,sample(b).edgeDistance,Math.hypot(m.x-n.x,m.z-n.z))<14;return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)/(near?settings.edgeStepM:settings.interiorStepM);}
  let triangles=0,maxLeafEdgeM=0;
  function triangle(ps:Point[],depth=0){
    const ratios=ps.map((p,i)=>needsSplit(p,ps[(i+1)%3])),ratio=Math.max(...ratios);
    if(ratio>1.000001&&depth<24){const i=ratios.indexOf(ratio),a=ps[i],b=ps[(i+1)%3],c=ps[(i+2)%3],m=point(mix(a,b,.5));triangle([a,m,c],depth+1);triangle([m,b,c],depth+1);return;}
    const q=ps.map(sample);if(q.every(p=>p.coverage===0))return;
    triangles++;for(let i=0;i<3;i++)maxLeafEdgeM=Math.max(maxLeafEdgeM,Math.hypot(ps[i].x-ps[(i+1)%3].x,ps[i].y-ps[(i+1)%3].y,ps[i].z-ps[(i+1)%3].z));
    emit(top,q.map(q=>q.p),q.map(q=>q.n));emit(bottom,q.map(q=>q.b).reverse(),q.map(()=>({x:0,y:-1,z:0})));
  }
  for(const mesh of roof)for(let k=0;k<mesh.indices.length;k+=3)triangle(Array.from(mesh.indices.subarray(k,k+3),id=>point({x:mesh.positions[id*3],y:mesh.positions[id*3+1],z:mesh.positions[id*3+2]})));
  // The outside perimeter and both cut banks belong to one roof. Accumulate
  // their true edge tangents, including the corner where the two meet.
  const directions=new Map<string,Point>();
  for(const {a,b} of boundaries.values()){
    const segment=unit(sub(a,b));
    for(const p of [a,b]){
      const k=key(p),v=directions.get(k)??{x:0,y:0,z:0};
      v.x+=segment.x;v.y+=segment.y;v.z+=segment.z;directions.set(k,v);
    }
  }
  function outline(p:Point,tangent:Point){
    const f=field(p.x,p.z),q=sample(p);
    const outward=unit({x:tangent.z,y:0,z:-tangent.x});
    const h=q.p.y-p.y, scale=f.lip*f.coverage;
    const reach=Math.min(settings.overhang,settings.radius)*((.40+.47*f.shelter)*(1-f.exposedRim)+(.03+1.17*f.rimLoad)*f.exposedRim)*scale;
    const drop=settings.edge*((.16+.26*f.shelter)*(1-f.exposedRim)+(.02+.48*f.rimLoad)*f.exposedRim)*scale;
    const ps:Point[]=[q.p];
    // A quarter-round shelf leaves a flat bottom visible above the rock.
    // Roll past the edge, then bury the return in the steep upper tip.
    const embed=(.25*drop+.12*scale);
    const bevelSteps=8;
    for(let k=1;k<=bevelSteps;k++){
      const t=Math.PI*k/bevelSteps;
      const d=reach*Math.sin(t)-embed*smoothstep(.55,1,k/bevelSteps);
      const y=(h-drop)/2+(h+drop)/2*Math.cos(t);
      ps.push(point({x:p.x+outward.x*d,y:p.y+y,z:p.z+outward.z*d}));
    }
    ps.push(q.b);
    return ps;
  }
  let capSegments=0;
  function boundary(a:Point,b:Point,ta:Point,tb:Point,depth=0){
    if(needsSplit(a,b)>1.000001&&depth<24){
      const m=point(mix(a,b,.5)),tm=unit(mix(ta,tb,.5));
      boundary(a,m,ta,tm,depth+1);boundary(m,b,tm,tb,depth+1);return;
    }
    const qa=sample(a),qb=sample(b);if(!qa.coverage&&!qb.coverage)return;
    const pa=outline(a,ta),pb=outline(b,tb);capSegments++;
    const norm=(p:Point,row:Point[],tangent:Point,index:number)=>{
      if(index===0)return sample(p).n;
      const section=sub(row[Math.min(row.length-1,index+1)],row[index-1]);
      return unit(cross(tangent,section));
    };
    for(let j=0;j+1<pa.length;j++){
      const ps=[pa[j],pb[j],pa[j+1],pb[j+1]],ns=[norm(a,pa,ta,j),norm(b,pb,tb,j),norm(a,pa,ta,j+1),norm(b,pb,tb,j+1)];
      for(const ids of [[2,1,0],[2,3,1]])emit(cap,ids.map(i=>ps[i]),ids.map(i=>ns[i]));
    }
  }
  for(const {a,b}of boundaries.values())boundary(a,b,unit(directions.get(key(a))!),unit(directions.get(key(b))!));
  return {top:pack(top),bottom:pack(bottom),cap:pack(cap),settings,stats:{roofTriangles:triangles,capSegments,sampledVertices:cache.size,maxLeafEdgeM},field};
}
