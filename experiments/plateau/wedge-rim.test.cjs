const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),crypto=require('node:crypto');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {buildWedgeAscent}=require('./wedge-ascent.ts'),{buildRimVariant,rimSettings}=require('./wedge-rim.ts'),{bluntTip,lowerTip}=require('./wedge-tip-profile.ts');
const {reliefGrid}=require('./seam-relief-fixture.ts'),{plateauRadius}=require('./plateau-profile.ts'),{smoothstep}=require('../../src/core/rng.ts');
const hash=(...arrays)=>{const h=crypto.createHash('sha256');for(const a of arrays)h.update(a);return h.digest('hex')},mh=m=>hash(m.positions,m.indices);
const source=reliefGrid(()=>100),upper={...source,heights:source.heights.map(()=>100)};
source.heights=source.heights.map((_,k)=>{const x=source.x0+k%(source.n+1)*source.cell,z=source.z0+Math.floor(k/(source.n+1))*source.cell,r=plateauRadius(x,z),w=1-smoothstep(.96,1.055,r);return (1-w)*5*(1-smoothstep(1.04,1.23,r))+w*100;});
const j=buildWedgeAscent(source,upper,undefined,bluntTip),before=hash(source.heights,upper.heights),base=Object.fromEntries(Object.entries(j.cut).map(([n,m])=>[n,mh(m)]));
const reports=[];
for(const mode of ['angular','stepped','arcs']){
 const v=buildRimVariant(j,mode),same=buildRimVariant(j,mode),other=buildRimVariant(j,mode,{...rimSettings,seed:rimSettings.seed+1});
 assert.deepEqual(v.knots,same.knots,'Seed must reproduce the same shape');assert.notDeepEqual(v.knots,other.knots);
 assert.equal(hash(source.heights,upper.heights),before);for(const [n,m]of Object.entries(j.cut))assert.equal(mh(m),base[n],'Do not mutate the original stand');
 for(const name of ['plateau','interior','flank','restored'])assert.equal(mh(v.cut[name]),base[name],name+' must remain identical');
 for(const p of [...j.accepted.seam.points,...j.accepted.attachment.points])assert.deepEqual(v.deform(p),p,'Protected boundaries fixed');
 let maxCornerVectorError=0,fixedEndPoints=0;
 for(const p of j.nose){const a=(Math.atan2(p.z/180,p.x/260)+2*Math.PI)%(2*Math.PI);if(j.weight(a)<=.4){assert.deepEqual(v.deform(p),p);fixedEndPoints++;}if(plateauRadius(p.x,p.z)>1.089&&j.weight(a)===1){const lower=lowerTip(p,{angle:a,alongEdge:0,x:p.x,z:p.z,distanceToE:10},bluntTip),q=v.deform(p),r=v.deform(lower);maxCornerVectorError=Math.max(maxCornerVectorError,Math.hypot(q.x-r.x-(p.x-lower.x),q.y-r.y-4,q.z-r.z-(p.z-lower.z)));}}
 assert.ok(fixedEndPoints>10);assert.ok(maxCornerVectorError<.003,'Preserve front thickness/backset vector');
 for(const m of Object.values(v.cut))assert.ok(m.positions.every(Number.isFinite));
 for(let i=0;i<v.pieces.length;i++){
  const c=v.pieces[i],len=c.end-c.start;
  if(mode==='angular'){const u=c.start+len*c.peak;for(const [lo,hi]of [[c.start,u],[u,c.end]]){const a=v.target(lo),b=v.target(hi),mid=v.target((lo+hi)/2);assert.ok(Math.abs(mid.y-(a.y+b.y)/2)<1e-9,'Each polygon segment is straight');}}
  if(mode==='arcs'){const points=Array.from({length:17},(_,k)=>v.target(c.start+len*k/16));for(let k=1;k<16;k++)assert.ok(points[k+1].y-2*points[k].y+points[k-1].y<0,'Caps stay convex; no rounded valley bottoms');}
  if(mode==='stepped'){const a=v.target(c.end-rimSettings.stepWidth),b=v.target(c.end);assert.ok(Math.abs(b.y-a.y)>=rimSettings.minStep-.001,'Closed steep step between pieces');}
 }
 assert.deepEqual(v.knots[0].p,v.knots[v.knots.length-1].p);
 reports.push({mode,knots:v.knots.length,fixedEndPoints,maxCornerVectorErrorM:maxCornerVectorError,protectedHashes:base,changedStrip:mh(v.cut.strip)!==base.strip,changedUnderside:mh(v.cut.underside)!==base.underside});
}
console.log(JSON.stringify({result:'PASS',settings:rimSettings,reports,note:'Flat bare rim trial. Narrow external joining band changes; core plateau/E/source heights/passage/lower boundary are fixed. No cladding or physics test.'},null,2));
