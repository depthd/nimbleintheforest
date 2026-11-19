// Full-mountain counterpart of the F experiment. The original diagnostic is untouched.
// One height function covers both top owners; the finite patch's rear/end caps disappear.
import { type MeshData, type Point } from './cavity';
import { type SourceGrid, sampleGrid } from './seam-boundary';
import { type buildWedgeAscent } from './wedge-ascent';
import { ringPoint, upperNormal, snowSettings, type SnowMesh } from './wedge-snow-layer';
import { contourTangent, plateauRadius } from './plateau-profile';
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

// The excavated walls have their own inward-facing lip. Sample the roof on
// each bank and taper into the existing cover where the pass reaches the top.
function passageLip(upper:SourceGrid, roof:(x:number,z:number)=>{y:number}) {
  const positions:number[]=[],indices:number[]=[];
  for(const side of [-1,1]){
    let previous:number[]|undefined;
    for(let x=-274;x<=18;x+=1){
      const p=ascentSample(x),edge=p.z+side*p.w,h=sampleGrid(upper,x,edge).y;
      const extent=smoothstep(0,.10,1-plateauRadius(x,edge))*smoothstep(8,31,h-p.y);
      if(extent<.001){previous=undefined;continue;}
      const depth=(2.25+.5*Math.sin(x/13+side)+.32*Math.sin(x/6.7))*extent;
      const row:number[]=[];
      for(const [d,relative] of [[13,-.08],[9,.28],[5,.71],[2,1],[.2,.94],[-.75,.79],[-1.25,.54],[-1.35,.27],[-1.15,.02],[.9,-.28]]){
        const offset=d<2?d*extent:d, z=edge+side*offset;
        const height=roof(x,z).y+relative*depth;
        row.push(positions.length/3);positions.push(x,height,z);
      }
      if(previous)for(let j=0;j<row.length-1;j++){
        const a=previous[j],b=row[j],c=previous[j+1],d=row[j+1];
        if(side===1)indices.push(a,b,c,c,b,d);else indices.push(a,c,b,c,d,b);
      }
      previous=row;
    }
  }
  return {positions:new Float32Array(positions),indices:new Uint32Array(indices)};
}

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
    const coverage=x<bounds.x0||x>bounds.x1||z<bounds.z0||z>bounds.z1 ? 1
      : smoothstep(settings.passageBareM,settings.passageFadeM,distanceToAscent({x,z}));
    const normal=upperNormal(upper,x,z),slope=Math.acos(Math.max(-1,Math.min(1,normal.y)))*180/Math.PI;
    const nominal=settings.plateau+(settings.edge-settings.plateau)*smoothstep(.55,1,v)*cornice;
    const thickness=Math.max(settings.minThickness,nominal*(1-smoothstep(settings.slopeStart,settings.slopeEnd,slope)));
    const blend=smoothstep(.78,1,v)*cornice;
    // Vertical placement cannot fold over the steep parts of the original normal-offset layer.
    const y=h+coverage*Math.max(settings.minThickness,h+blend*(n.y-h)+thickness-h);
    return {y,coverage,edgeDistance,cornice};
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
  function outline(p:Point){
    const f=field(p.x,p.z),q=sample(p),a=angle(p),da=.005;
    const lo=ringPoint(nose,a-da),hi=ringPoint(nose,a+da),fallback=contourTangent(a,nose.radius);
    const outward=unit({x:hi.z-lo.z,y:0,z:lo.x-hi.x});if(outward.x*p.x+outward.z*p.z<0){outward.x=-outward.x;outward.z=-outward.z;}
    if(!Math.hypot(outward.x,outward.z)){const n=unit({x:fallback.z,y:0,z:-fallback.x});Object.assign(outward,n);}
    const h=q.p.y-p.y,out=settings.overhang*f.cornice*f.coverage,r=Math.max(0,Math.min(settings.radius,out,h-settings.minThickness*f.coverage)),rb=Math.max(0,Math.min(h-r,out/4));
    const ps:Point[]=[q.p];const push=(x:number,y:number)=>ps.push(point({x:p.x+outward.x*x,y:p.y+y,z:p.z+outward.z*x}));
    push(out-r,h);for(let k=1;k<=16;k++){const t=k/16*Math.PI/2;push(out-r+r*Math.sin(t),h-r+r*Math.cos(t));}
    for(let k=1;k<=8;k++)push(out,h-r+(rb-(h-r))*k/8);
    for(let k=1;k<=6;k++){const t=k/6*Math.PI/2;push(out-rb+rb*Math.cos(t),rb-rb*Math.sin(t));}
    for(let k=1;k<=10;k++)push((out-rb)*(1-k/10),-settings.embed*f.coverage*k/10);
    return ps;
  }
  let capSegments=0;
  function boundary(a:Point,b:Point,depth=0){if(needsSplit(a,b)>1.000001&&depth<24){const m=point(mix(a,b,.5));boundary(a,m,depth+1);boundary(m,b,depth+1);return;}
    const qa=sample(a),qb=sample(b);if(!qa.coverage&&!qb.coverage)return;
    const pa=outline(a),pb=outline(b);capSegments++;
    for(let j=0;j+1<pa.length;j++){
      const norm=(p:Point,row:Point[],index:number)=>{if(index===0)return sample(p).n;const aa=angle(p),lo=ringPoint(nose,aa-.001),hi=ringPoint(nose,aa+.001),tangent=sub(hi,lo),section=sub(row[Math.min(row.length-1,index+1)],row[Math.max(0,index-1)]);return unit(cross(tangent,section));};
      const ps=[pa[j],pb[j],pa[j+1],pb[j+1]],ns=[norm(a,pa,j),norm(b,pb,j),norm(a,pa,j+1),norm(b,pb,j+1)];
      for(const ids of [[2,1,0],[2,3,1]])emit(cap,ids.map(i=>ps[i]),ids.map(i=>ns[i]));
    }
  }
  for(const {a,b}of boundaries.values())boundary(a,b);
  return {top:pack(top),bottom:pack(bottom),cap:pack(cap),passageLip:passageLip(upper,field),settings,stats:{roofTriangles:triangles,capSegments,sampledVertices:cache.size,maxLeafEdgeM},field};
}
