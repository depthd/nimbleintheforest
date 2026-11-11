const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {buildWedge}=require('./wedge-prototype.ts'),{reliefGrid,reliefTop}=require('./seam-relief-fixture.ts');
const {plateauRadius}=require('./plateau-profile.ts'),{smoothstep}=require('../../src/core/rng.ts');
const key=p=>p.map(Math.fround).join(','),edge=(a,b)=>[key(a),key(b)].sort().join('|');
function faces(mesh){const out=new Map();let area=0;for(let k=0;k<mesh.indices.length;k+=3){const p=Array.from(mesh.indices.slice(k,k+3),i=>Array.from(mesh.positions.slice(i*3,i*3+3)));const [a,b,c]=p,u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n);assert.ok(l>1e-8);area+=Math.abs(n[1])/2;const normal=n.map(x=>x/l);for(let j=0;j<3;j++)out.set(edge(p[j],p[(j+1)%3]),normal);}return {out,area};}
const reports=[];
for(const kind of ['flat','relief']){
 const source=reliefGrid(),top=kind==='flat'?()=>100:reliefTop;
 const upper={...source,heights:source.heights.map((_,k)=>top(source.x0+k%(source.n+1)*source.cell,source.z0+Math.floor(k/(source.n+1))*source.cell))};
 if(kind==='flat')source.heights=source.heights.map((_,k)=>{const x=source.x0+k%(source.n+1)*source.cell,z=source.z0+Math.floor(k/(source.n+1))*source.cell,r=plateauRadius(x,z),w=1-smoothstep(.96,1.055,r);return 100*w+(1-w)*5*(1-smoothstep(1.04,1.23,r));});
 const before=Buffer.from(source.heights.buffer).toString('base64'),w=buildWedge(source,upper),p=faces(w.plateau),s=faces(w.strip);
 let maxAngle=0,matched=0;
 for(let i=0;i<w.seam.points.length;i++){
  const a=w.seam.points[i],b=w.seam.points[(i+1)%w.seam.points.length],k=edge([a.x,a.y,a.z],[b.x,b.y,b.z]),n=p.out.get(k),m=s.out.get(k);
  assert.ok(n&&m,'Both render meshes must own the identical seam edge'); matched++;
  const angle=Math.acos(Math.min(1,Math.max(-1,n.reduce((sum,x,i)=>sum+x*m[i],0))))*180/Math.PI;maxAngle=Math.max(maxAngle,angle);
 }
 assert.ok(maxAngle<.1,'No new visible crease at E');
 let area=0;for(let i=0;i<w.nose.points.length;i++){const a=w.nose.points[i],b=w.nose.points[(i+1)%w.nose.points.length];area+=(a.x*b.z-b.x*a.z)/2;}
 assert.ok(Math.abs(p.area+s.area-area)<.02,'Top covers nose footprint once');
 let maxOldAbove=0;for(let k=0;k<source.heights.length;k++){const x=source.x0+k%(source.n+1)*source.cell,z=source.z0+Math.floor(k/(source.n+1))*source.cell,r=plateauRadius(x,z);maxOldAbove=Math.max(maxOldAbove,source.heights[k]-upper.heights[k]);}
 assert.equal(maxOldAbove,0);assert.equal(Buffer.from(source.heights.buffer).toString('base64'),before);
 for(const m of [w.flank,w.underside])faces(m);
 const {sampleGrid}=require('./seam-boundary.ts');
 let undersideAboveTop=0;
 for(let k=0;k<w.underside.positions.length;k+=3){const p=w.underside.positions;undersideAboveTop=Math.max(undersideAboveTop,p[k+1]-sampleGrid(upper,p[k],p[k+2]).y);}
 assert.ok(undersideAboveTop<.0001,'Underside must remain below the top');
 reports.push({kind,seamEdges:matched,maxAngleDeg:maxAngle,topAreaErrorM2:Math.abs(p.area+s.area-area),oldCollisionAboveTopWholeGridM:maxOldAbove,sourceUnchanged:true,undersideAboveTopM:undersideAboveTop});
}
console.log(JSON.stringify({result:'PASS',reports},null,2));
