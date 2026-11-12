const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {buildWedgeAscent}=require('./wedge-ascent.ts'),{buildWedge}=require('./wedge-prototype.ts');
const {bluntTip,undersideDepth,roundTipCorner}=require('./wedge-tip-profile.ts'),{reliefGrid}=require('./seam-relief-fixture.ts');
const {plateauRadius}=require('./plateau-profile.ts'),{smoothstep}=require('../../src/core/rng.ts');
const hash=(...arrays)=>{const h=createHash('sha256');for(const a of arrays)h.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));return h.digest('hex');};
const meshHash=m=>hash(m.positions,m.indices),pointHash=p=>hash(new Float64Array(p.flatMap(p=>[p.x,p.y,p.z])));
const source=reliefGrid(()=>100),upper={...source,heights:source.heights.map(()=>100)};
source.heights=source.heights.map((_,k)=>{const x=source.x0+k%(source.n+1)*source.cell,z=source.z0+Math.floor(k/(source.n+1))*source.cell,r=plateauRadius(x,z),w=1-smoothstep(.96,1.055,r);return (1-w)*5*(1-smoothstep(1.04,1.23,r))+w*100;});
const before=hash(source.heights,upper.heights),old=buildWedgeAscent(source,upper),next=buildWedgeAscent(source,upper,undefined,bluntTip),a=old.accepted,b=next.accepted;
assert.equal(hash(source.heights,upper.heights),before);
const protectedHashes={source:before};
for(const name of ['plateau','strip','flank','interior']){
  assert.equal(meshHash(old.cut[name]),meshHash(next.cut[name]),name+' must not change');
  protectedHashes[name]=meshHash(next.cut[name]);
}
assert.equal(pointHash(a.seam.points),pointHash(b.seam.points));
assert.equal(pointHash(a.nose.points),pointHash(b.nose.points));
assert.equal(pointHash(a.attachment.points),pointHash(b.attachment.points));
protectedHashes.E=pointHash(b.seam.points);protectedHashes.upperNose=pointHash(b.nose.points);protectedHashes.attachment=pointHash(b.attachment.points);
let maxThicknessError=0,maxBacksetError=0;
b.nose.points.forEach((p,i)=>{
 const q=b.tipCorner[i];maxThicknessError=Math.max(maxThicknessError,Math.abs(p.y-q.y-4));
 maxBacksetError=Math.max(maxBacksetError,Math.abs(Math.hypot(p.x,p.z)-Math.hypot(q.x,q.z)-.5));
});
assert.ok(maxThicknessError<1e-9&&maxBacksetError<1e-9);
// All lower vertices deeper than the local joining quarter retain their old
// Float32 coordinates. The face itself must be real, finite and outward-facing.
const oldVertices=new Set();for(let k=0;k<a.underside.positions.length;k+=3)oldVertices.add(Array.from(a.underside.positions.subarray(k,k+3)).join(','));
for(let k=0;k<b.underside.positions.length;k+=3){const p=Array.from(b.underside.positions.subarray(k,k+3));assert.ok(p.every(Number.isFinite));if(p[1]<86)assert.ok(oldVertices.has(p.join(',')),'Lower curve changed outside the join');}
assert.ok(b.front.indices.length>0);
for(let k=0;k<b.front.indices.length;k+=3){const p=Array.from(b.front.indices.subarray(k,k+3),id=>Array.from(b.front.positions.subarray(id*3,id*3+3))),[p0,p1,p2]=p,u=p1.map((v,i)=>v-p0[i]),v=p2.map((v,i)=>v-p0[i]),nx=u[1]*v[2]-u[2]*v[1],nz=u[0]*v[1]-u[1]*v[0];assert.ok(nx*p0[0]+nz*p0[2]>0,'Front face points into the mountain');}
const pos={angle:0,alongEdge:0,x:100,z:0,distanceToE:20,distanceToPassage:100};
for(const depth of [40,50,65]){
 const span=20,start=.5/span,end=.5;
 assert.equal(undersideDepth(start*start,depth,span,pos,bluntTip),4);
 for(const s of [.5,.7,1])assert.equal(undersideDepth(s*s,depth,span,pos,bluntTip),depth*(s*s));
 const eps=1e-5,left=(undersideDepth(end*end,depth,span,pos,bluntTip)-undersideDepth((end-eps)**2,depth,span,pos,bluntTip))/eps;
 assert.ok(Math.abs(left-2*depth*end)<.01,'Curve must meet old underside tangentially');
}
// A flat profile's straight front and its first underside segment are the
// incoming/outgoing directions of the rounded corner, with no level shelf.
const top={x:25,y:100,z:0},corner={x:24.5,y:96,z:0},first={x:21,y:95.6,z:0},second={x:19,y:94.5,z:0};
const round=roundTipCorner(top,corner,first,second);
function turnAngle(a,b,c){const u=[b.x-a.x,b.y-a.y,b.z-a.z],v=[c.x-b.x,c.y-b.y,c.z-b.z];return Math.acos(Math.max(-1,Math.min(1,u.reduce((s,x,i)=>s+x*v[i],0)/(Math.hypot(...u)*Math.hypot(...v)))))*180/Math.PI;}
const profile=[top,...round,second];let maxTurnDeg=0;
for(let i=1;i<profile.length-1;i++)maxTurnDeg=Math.max(maxTurnDeg,turnAngle(profile[i-1],profile[i],profile[i+1]));
assert.ok(maxTurnDeg<15,'Rounded section must not have the old abrupt corner');
for(let i=1;i<round.length;i++){assert.ok(round[i].y<round[i-1].y,'No horizontal shelf or upward bump');assert.ok(round[i].x<round[i-1].x,'Round must move continuously inward');}
// Callbacks receive position independently for each sample, including optional
// passage proximity in the swept builder. No noise or fade is applied here.
let calls=0,passageCalls=0;
const callbacks={thickness:p=>{assert.ok(Number.isFinite(p.distanceToE)&&Number.isFinite(p.alongEdge));calls++;if(Number.isFinite(p.distanceToPassage))passageCalls++;return 4;},backset:()=>.5};
buildWedge(source,upper,callbacks);
assert.ok(calls>100);
buildWedgeAscent(source,upper,undefined,callbacks);assert.ok(passageCalls>100);
console.log(JSON.stringify({result:'PASS',trial:'flat bare rounded tip, nominal corner 4m / 0.5m',nominalThicknessError:maxThicknessError,nominalBacksetError:maxBacksetError,maxTurnDeg,protectedHashes,note:'Geometry checks; no dressing, physics or visual acceptance claim.'},null,2));
