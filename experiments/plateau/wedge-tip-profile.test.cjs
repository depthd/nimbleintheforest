const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {buildWedgeAscent}=require('./wedge-ascent.ts'),{buildWedge}=require('./wedge-prototype.ts');
const {bluntTip,undersideSection,undersideJoin}=require('./wedge-tip-profile.ts'),{reliefGrid}=require('./seam-relief-fixture.ts');
const {plateauRadius,contourPoint}=require('./plateau-profile.ts'),{smoothstep}=require('../../src/core/rng.ts');
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
// The rebuilt underside is finite; the face remains outward-facing.
assert.ok(b.underside.positions.every(Number.isFinite));
assert.ok(b.front.indices.length>0);
for(let k=0;k<b.front.indices.length;k+=3){const p=Array.from(b.front.indices.subarray(k,k+3),id=>Array.from(b.front.positions.subarray(id*3,id*3+3))),[p0,p1,p2]=p,u=p1.map((v,i)=>v-p0[i]),v=p2.map((v,i)=>v-p0[i]),nx=u[1]*v[2]-u[2]*v[1],nz=u[0]*v[1]-u[1]*v[0];assert.ok(nx*p0[0]+nz*p0[2]>0,'Front face points into the mountain');}
const {sampleGrid}=require('./seam-boundary.ts');
let minDownPerInward=Infinity,maxTurnDeg=0,maxStartSlopeError=0,maxJoinSlopeError=0;
const turnAngle=(u,v)=>Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)))))*180/Math.PI;
for(let i=0;i<b.nose.points.length;i++){
 const p=b.nose.points[i],wall=contourPoint(b.nose.angles[i],1.005),depth=100-sampleGrid(source,wall.x,wall.z).y,span=Math.hypot(p.x-wall.x,p.z-wall.z);
 const pos={angle:b.nose.angles[i],alongEdge:i/b.nose.points.length,x:p.x,z:p.z,distanceToE:20,distanceToPassage:100};
 let last={inwardFraction:.5/span,depth:4},lastDirection=[.5,4];
 for(let row=.5;row<=20;row+=.5){
  const next=undersideSection(row/24,depth,span,pos,bluntTip),direction=[span*(next.inwardFraction-last.inwardFraction),next.depth-last.depth];
  assert.ok(direction[0]>0&&direction[1]>0,'Section must descend and move inward without a bump');
  minDownPerInward=Math.min(minDownPerInward,direction[1]/direction[0]);maxTurnDeg=Math.max(maxTurnDeg,turnAngle(lastDirection,direction));last=next;lastDirection=direction;
 }
 assert.ok(minDownPerInward>1.1,'Profile must remain steep, with no shelf');
 const eps=1e-5,start=undersideSection(0,depth,span,pos,bluntTip),near=undersideSection(eps,depth,span,pos,bluntTip);
 assert.equal(start.depth,4);assert.equal(start.inwardFraction,.5/span);
 maxStartSlopeError=Math.max(maxStartSlopeError,Math.abs(span*(near.inwardFraction-start.inwardFraction)/(near.depth-start.depth)-.5/4));
 const atJoin=undersideSection(undersideJoin,depth,span,pos,bluntTip),beforeJoin=undersideSection(undersideJoin-eps,depth,span,pos,bluntTip);
 maxJoinSlopeError=Math.max(maxJoinSlopeError,Math.abs(span*(atJoin.inwardFraction-beforeJoin.inwardFraction)/(atJoin.depth-beforeJoin.depth)-span/(2*depth*Math.sqrt(undersideJoin))));
 for(const t of [undersideJoin,21/24,23/24,1])assert.deepEqual(undersideSection(t,depth,span,pos,bluntTip),{inwardFraction:Math.sqrt(t),depth:depth*t});
}
assert.ok(maxStartSlopeError<1e-5&&maxJoinSlopeError<1e-5,'Both ends must match the adjoining directions');
assert.ok(maxTurnDeg<12,'The rendered sampling must turn gradually');
// Callbacks receive position independently for each sample, including optional
// passage proximity in the swept builder. No noise or fade is applied here.
let calls=0,passageCalls=0;
const callbacks={thickness:p=>{assert.ok(Number.isFinite(p.distanceToE)&&Number.isFinite(p.alongEdge));calls++;if(Number.isFinite(p.distanceToPassage))passageCalls++;return 4;},backset:()=>.5};
buildWedge(source,upper,callbacks);
assert.ok(calls>100);
buildWedgeAscent(source,upper,undefined,callbacks);assert.ok(passageCalls>100);
console.log(JSON.stringify({result:'PASS',trial:'flat bare steep continuous underside, 4m / 0.5m front',thicknessError:maxThicknessError,backsetError:maxBacksetError,minDownPerInward,maxTurnDeg,maxStartSlopeError,maxJoinSlopeError,protectedHashes,note:'Geometry checks; no dressing, physics or visual acceptance claim.'},null,2));
