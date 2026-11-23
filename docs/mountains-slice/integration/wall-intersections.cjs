// Run against the integration checkout: node wall-intersections.cjs [checkout]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const ts = require('typescript');
const {Vector3: V, Box3, Triangle, Ray} = require('three');
const root = path.resolve(process.argv[2] || path.join(__dirname,'../../..'));
const fromPlateau = name => require(path.join(root,'experiments/plateau',name+'.ts'));
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);

const eps = 1e-5, roofSearchMargin=32;
const { reliefGrid } = fromPlateau('seam-relief-fixture');
const { sampleGrid } = fromPlateau('seam-boundary');
const { plateauTop, mountainEnding, mountainSnowProfile, buildMountainMasses } = fromPlateau('mountain-shape');
const { mountainRim, buildMountainSnow } = fromPlateau('mountain-snow');
const { mountainTiers, worldPlan, reservedForUpper } = fromPlateau('mountain-tiers');
const { buildWedgeAscent } = fromPlateau('wedge-ascent');
const { ringPoint } = fromPlateau('wedge-snow-layer');
const { radialSurface } = fromPlateau('wedge-rocks');
const { subtract } = fromPlateau('cavity');
const { bluntTip } = fromPlateau('wedge-tip-profile');
const { buildAngularWall } = fromPlateau('slice-wall-angular');
const { buildRoundedWall } = fromPlateau('slice-wall-rounded');

const source=reliefGrid(plateauTop), upper={...source,heights:source.heights.map((_,i)=>
  plateauTop(source.x0+i%(source.n+1)*source.cell,source.z0+Math.floor(i/(source.n+1))*source.cell))};
const junction=buildWedgeAscent(source,upper,mountainEnding,bluntTip);
const plateau=subtract(junction.cut.plateau),strip=subtract(junction.cut.strip);
const snow=buildMountainSnow(upper,junction,[plateau,strip],mountainSnowProfile);
const tiers=mountainTiers(true,(x,z)=>snow.field(x,z).y);
const rim=mountainRim(junction);
const groundAt=(x,z)=>sampleGrid(source,x,z).y;
const entrance=buildMountainMasses(a=>ringPoint(rim,a),radialSurface([subtract(junction.cut.underside)]),
  groundAt,tiers[0].seed,{cave:true,reserved:(x,z,r)=>reservedForUpper(tiers[0],tiers[1],x,z,r)}).entrance;
const site={x:entrance.x,z:entrance.z,angle:entrance.angle,height:entrance.height,width:100,groundAt};
function inWorld(tier,p) {
  const q=worldPlan(tier,p.x,p.z);
  return new V(q.x,tier.y+tier.rise*p.y,q.z);
}
function triangles(mesh,tier,end=mesh.indices.length,area) {
  const verts=[];
  for(let i=0;i<mesh.positions.length;i+=3) verts.push(inWorld(tier,new V().fromArray(mesh.positions,i)));
  const result=[];
  for(let k=0;k<end;k+=3){
    const p=[verts[mesh.indices[k]],verts[mesh.indices[k+1]],verts[mesh.indices[k+2]]];
    const box=new Box3().setFromPoints(p);
    if(area && !area.intersectsBox(box)) continue;
    result.push({p,box,triangle:new Triangle(...p)});
  }
  return result;
}
const localPoint = (world) => {
  const x=world.x/tiers[0].width-site.x,z=world.z/tiers[0].width-site.z;
  return [x*Math.cos(site.angle)+z*Math.sin(site.angle),x*Math.sin(site.angle)-z*Math.cos(site.angle)];
};
function massesFor(family,count,seed) {
  const raw=(family==='rounded'?buildRoundedWall:buildAngularWall)(site,count,seed);
  const stone=triangles(raw.rock,tiers[0]),caps=triangles(raw.snow,tiers[0],raw.snowWallIndexCount);
  const groups=raw.masses.map(()=>[]);
  for (const t of [...stone,...caps]) {
    const [u,v]=localPoint(t.triangle.getMidpoint(new V()));
    const owners=raw.masses.map((m,i)=>u>=m.minU-eps && u<=m.maxU+eps && v>=m.minV-eps && v<=m.maxV+eps ? i : -1).filter(i=>i>=0);
    assert.equal(owners.length,1,'Each triangle belongs to exactly one block');
    groups[owners[0]].push(t);
  }
  assert.ok(groups.every(g=>g.length));
  return groups;
}
function boxDist2(a,b) {
  const dx=Math.max(0,a.min.x-b.max.x,b.min.x-a.max.x), dz=Math.max(0,a.min.z-b.max.z,b.min.z-a.max.z);
  const dy=Math.max(0,a.min.y-b.max.y,b.min.y-a.max.y);
  return dx*dx+dy*dy+dz*dz;
}
// For disjoint triangles minimum distance is attained at vertex–face or edge–edge.
// For intersecting triangles an edge crosses the opposite face, or the coplanar sets touch.
function triDist2(a,b) {
  let best=Infinity;
  for(const [one,two] of [[a,b],[b,a]]) for(let i=0;i<3;i++) {
    const p=one.p[i], q=one.p[(i+1)%3], d=q.clone().sub(p), len=d.length();
    const target=two.triangle.closestPointToPoint(p,new V());
    best=Math.min(best,p.distanceToSquared(target));
    if(!len) continue;
    const ray=new Ray(p,d.divideScalar(len));
    const pierce=ray.intersectTriangle(...two.p,false,new V());
    if(pierce && p.distanceTo(pierce)<=len+eps) return 0;
    for(let j=0;j<3;j++) {
      const onRay=new V(),onEdge=new V();
      ray.distanceSqToSegment(two.p[j],two.p[(j+1)%3],onRay,onEdge);
      if(p.distanceToSquared(onRay)<=len*len) best=Math.min(best,onRay.distanceToSquared(onEdge));
    }
  }
  return best;
}
function nearest(a,b) {
  let min=Infinity;
  for(const f of a) for(const g of b) {
    if(boxDist2(f.box,g.box)>=min) continue;
    min=Math.min(min,triDist2(f,g));
  }
  return Math.sqrt(min);
}
const axes = [new V(Math.cos(site.angle),0,Math.sin(site.angle)),new V(Math.sin(site.angle),0,-Math.cos(site.angle)),new V(0,1,0)];
function intervals(group){
  const points=group.flatMap(t=>t.p);
  return axes.map(n=>{
    const s=points.map(p=>p.dot(n));
    return [Math.min(...s),Math.max(...s)];
  });
}
// Convex clipping in X/Z; signed height difference is affine on each shared
// polygon, so its minimum and maximum occur at the clipped polygon's vertices.
const cross=(a,b,p)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
function clipXZ(t,roof) {
  let poly=t.p;
  const signed=cross(...roof.p);
  if(Math.abs(signed)<1e-10 || Math.abs(cross(...t.p))<1e-10) return [];
  for(let i=0;i<3 && poly.length;i++) {
    const a=roof.p[i],b=roof.p[(i+1)%3],out=[];
    let prev=poly.at(-1),last=Math.sign(signed)*cross(a,b,prev);
    for(const p of poly) {
      const h=Math.sign(signed)*cross(a,b,p);
      if((h<0)!==(last<0)) out.push(prev.clone().lerp(p,last/(last-h)));
      if(h>=0) out.push(p);
      prev=p;last=h;
    }
    poly=out;
  }
  return poly;
}
function horizontalEdgeDistanceSquared(p,a,b) {
  const dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz;
  const t=len2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/len2)):0;
  return (p.x-a.x-t*dx)**2+(p.z-a.z-t*dz)**2;
}
function horizontalGapSquared(t,r) {
  for(const [point,face] of [[t.p[0],r.p],[r.p[0],t.p]]) {
    const signed=cross(...face);
    if(Math.abs(signed)>1e-10 && face.every((a,i)=>Math.sign(signed)*cross(a,face[(i+1)%3],point)>=0)) return 0;
  }
  let best=Infinity;
  for(let i=0;i<3;i++) for(let j=0;j<3;j++) {
    const a=t.p[i],b=t.p[(i+1)%3],c=r.p[j],d=r.p[(j+1)%3];
    const side1=cross(a,b,c),side2=cross(a,b,d),side3=cross(c,d,a),side4=cross(c,d,b);
    if(side1*side2<0 && side3*side4<0) return 0;
    best=Math.min(best,horizontalEdgeDistanceSquared(a,c,d),horizontalEdgeDistanceSquared(c,a,b));
  }
  return best;
}
function roofResult(wall,roof) {
  let minGap2=roofSearchMargin**2;
  let overlap=0,touches=0,crossings=0,above=0,max=-Infinity;
  for(const t of wall) for(const r of roof) {
    const dx=Math.max(0,t.box.min.x-r.box.max.x,r.box.min.x-t.box.max.x);
    const dz=Math.max(0,t.box.min.z-r.box.max.z,r.box.min.z-t.box.max.z);
    const lower=dx*dx+dz*dz;
    if(lower<minGap2) minGap2=Math.min(minGap2,horizontalGapSquared(t,r));
    if(lower>0) continue;
    const poly=clipXZ(t,r);
    if(!poly.length) continue;
    const [a,b,c]=r.p,area=cross(a,b,c);
    const signed=poly.map(p=>p.y-(cross(b,c,p)*a.y+cross(c,a,p)*b.y+cross(a,b,p)*c.y)/area);
    const lo=Math.min(...signed),hi=Math.max(...signed);
    overlap++;minGap2=0;max=Math.max(max,hi);
    if(lo < -eps && hi > eps) crossings++;
    else if(lo<=eps && hi>=-eps) touches++;
    if(hi>eps) above++;
  }
  return {minHorizontalGapM:minGap2<roofSearchMargin**2?+Math.sqrt(minGap2).toFixed(4):null,
    horizontalGapAtLeastM:minGap2===roofSearchMargin**2?roofSearchMargin:null,
    projectedTrianglePairs:overlap,touchingPairs:touches,crossingPairs:crossings,
    abovePairs:above,maxWallMinusRoofM:Number.isFinite(max)?+max.toFixed(4):null};
}
const cases=['rounded','angular'].flatMap(f=>(f==='rounded'?[4,7,10]:[5,8,12]).map(n=>[f,n,42])
  .concat([[f,f==='rounded'?7:8,23011]]));
const walls=cases.map(([family,count,seed])=>({family,count,seed,groups:massesFor(family,count,seed)}));
const bounds=new Box3();for(const {groups} of walls)for(const t of groups.flat())bounds.union(t.box);
bounds.expandByVector(new V(roofSearchMargin,0,roofSearchMargin));
bounds.min.y=-Infinity;bounds.max.y=Infinity;
const roofs=Object.fromEntries([['rockTop',plateau],['ascentStrip',strip],['snowTop',snow.top]]
  .map(([name,mesh])=>[name,tiers.flatMap(tier=>triangles(mesh,tier,mesh.indices.length,bounds))]));
const rows=[];
for(const {family,count,seed,groups} of walls) {
  const spans=groups.map(intervals);
  let min=Infinity,pairs=0,separated=0,touches=0;
  for(let i=0;i<count;i++) for(let j=i+1;j<count;j++){
    pairs++;
    const gap=nearest(groups[i],groups[j]); min=Math.min(min,gap);
    if(gap<=eps) touches++;
    if(spans[i].some(([lo,hi],k)=>lo>spans[j][k][1]+eps || hi<spans[j][k][0]-eps)) separated++;
  }
  rows.push({family,count,seed,pairs,separatedAxisPairs:separated,withinTolerancePairs:touches,minMassGapM:+min.toFixed(4),
    roofs:Object.fromEntries(Object.entries(roofs).map(([k,r])=>[k,roofResult(groups.flat(),r)]))});
}
const blobs=Object.fromEntries(['slice-wall-rounded','slice-wall-angular'].map(f=>[f,execFileSync('git',['-C',root,'hash-object','experiments/plateau/'+f+'.ts'],{encoding:'utf8'}).trim()]));
console.log(JSON.stringify({toleranceM:eps,site:{...site},tiers,blobs,rows},null,2));
