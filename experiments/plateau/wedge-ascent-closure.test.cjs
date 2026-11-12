const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const root=path.resolve(__dirname,'../..');
const {buildWedgeAscent}=require(root+'/experiments/plateau/wedge-ascent.ts'),{reliefGrid,reliefTop,chaoticTop}=require(root+'/experiments/plateau/seam-relief-fixture.ts');
const {bluntTip,sharpTip}=require('./wedge-tip-profile.ts'),{plateauRadius}=require('./plateau-profile.ts'),{smoothstep}=require('../../src/core/rng.ts');
const top=process.env.RELIEF_KIND==='flat'?()=>100:process.env.RELIEF_KIND==='chaotic'?chaoticTop:reliefTop;
const s=reliefGrid(top),u={...s,heights:s.heights.map((_,k)=>top(s.x0+k%(s.n+1)*s.cell,s.z0+Math.floor(k/(s.n+1))*s.cell))};
if(process.env.RELIEF_KIND==='flat')s.heights=s.heights.map((_,k)=>{const x=s.x0+k%(s.n+1)*s.cell,z=s.z0+Math.floor(k/(s.n+1))*s.cell,r=plateauRadius(x,z),w=1-smoothstep(.96,1.055,r);return (1-w)*5*(1-smoothstep(1.04,1.23,r))+w*100;});
const j=buildWedgeAscent(s,u,undefined,process.env.TIP_KIND==='blunt'?bluntTip:sharpTip);
const edges=new Map(),key=p=>p.map(v=>Math.round(v*1e4)).join(',');
for(const mesh of Object.values(j.cut))for(let k=0;k<mesh.indices.length;k+=3){const tri=Array.from(mesh.indices.subarray(k,k+3),id=>Array.from(mesh.positions.subarray(id*3,id*3+3)));for(let i=0;i<3;i++){const a=tri[i],b=tri[(i+1)%3],ak=key(a),bk=key(b);if(ak===bk)continue;const ek=[ak,bk].sort().join('|'),e=edges.get(ek);if(e)e.count++;else edges.set(ek,{a,b,count:1});}}
// Ignore the deliberately open outer square. Subdivided collinear edges from
// clipping are geometrically covered, so do not misreport T junctions as holes.
const open=[...edges.values()].filter(e=>e.count===1&&!([0,2].some(i=>Math.abs(e.a[i])===700&&e.a[i]===e.b[i])));
const tolerance=.0005;let maxUncoveredM=0;
for(const e of open){const d=e.b.map((v,i)=>v-e.a[i]),len=Math.hypot(...d),unit=d.map(v=>v/len),ranges=[];if(len<=tolerance)continue;
for(const other of open){if(other===e)continue;const t=other.a.map((v,i)=>v-e.a[i]),v=other.b.map((v,i)=>v-e.a[i]),a=t.reduce((s,x,i)=>s+x*unit[i],0),b=v.reduce((s,x,i)=>s+x*unit[i],0);const lo=Math.max(0,Math.min(a,b)),hi=Math.min(len,Math.max(a,b));if(hi<=lo||Math.abs(b-a)<1e-12)continue;
// Compare only the overlapping part. A short Float32 edge may have a tiny
// angular error; extrapolating it over a much longer neighbour is invalid.
const distance=u=>{const q=(u-a)/(b-a);return Math.hypot(...t.map((x,i)=>x+q*(v[i]-x)-u*unit[i]));};
if(distance(lo)>tolerance||distance(hi)>tolerance)continue;ranges.push([lo,hi]);}
ranges.sort((a,b)=>a[0]-b[0]);let covered=0;for(const [lo,hi]of ranges){if(hi<0||lo>len)continue;if(lo>covered+tolerance)maxUncoveredM=Math.max(maxUncoveredM,lo-covered);covered=Math.max(covered,hi);}maxUncoveredM=Math.max(maxUncoveredM,len-covered);}
assert.ok(maxUncoveredM<=tolerance,`Uncovered rendered edge ${maxUncoveredM}m`);
console.log(JSON.stringify({result:'PASS',scope:'rendered cut surface, excluding outer world border',toleranceM:tolerance,maxUncoveredM,note:'Geometric edge coverage including collinear subdivisions; not a physics test.'},null,2));
