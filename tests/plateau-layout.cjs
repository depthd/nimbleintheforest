const assert=require('node:assert/strict');
const path=require('node:path');
const {Module}=require('node:module');
const {buildSync}=require('esbuild');

const source=buildSync({stdin:{contents:`
  export { mountainTiers, localPlan, worldPlan } from './mountain-tiers';
  export { rangeLayout, shapeRange } from './range-layout';
  export { ascent, ascentSample } from './ascent';
  export { rangeGround } from './range-ground';
  export { readRangeSettings } from './range-settings';
  export { contourPoint } from './plateau-profile';
`,resolveDir:path.resolve(__dirname,'../experiments/plateau')},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
for(const seed of [0,42,817]){
  const m=new Module(__filename);
  m._compile('const location={search:"?seed='+seed+'"};\n'+source,__filename);
  const {mountainTiers,localPlan,worldPlan,rangeLayout,rangeGround,readRangeSettings,contourPoint}=m.exports;
  const roof=(x,z)=>100+4*Math.cos(x/35+z/82),rim=a=>contourPoint(a,1);
  const original=mountainTiers(true,roof,rim);
  function layout(search){return rangeLayout(original,readRangeSettings(new URLSearchParams(search)),roof,rim);}
  assert.equal(layout(''),original);
  assert.equal(layout('count=7&layers=-1&shape=other'),original);
  for(const count of [1,2,3,4]){
    for(const layers of [1,2,3,4]){
      const search='count='+count+'&layers='+layers+'&shape=long';
      const tiers=layout(search);
      assert.deepEqual(tiers,layout(search));
      assert.equal(tiers.length,count*layers);
      const roots=tiers.filter(t=>!t.parent);
      assert.equal(roots.length,count);
      for(const root of roots){
        let tier=root;
        for(let level=1;level<layers;level++){
          const child=tiers.find(t=>t.parent===tier.name);
          assert.ok(child && child.y>tier.y && child.width<tier.width);
          const p=localPlan(tier,child.x,child.z);
          assert.ok(child.y<=tier.y+tier.rise*roof(p.x,p.z));
          tier=child;
        }
      }
      for(const tier of tiers){
        const p=worldPlan(tier,-101,58), q=localPlan(tier,p.x,p.z);
        assert.ok(Math.hypot(q.x+101,q.z-58)<1e-8);
      }
    }
  }
  // The route must change between neighbours even when the mountain shares
  // the same source meshes. World placement and its inverse follow the banks.
  const shaped=layout('count=3&layers=3&shape=mixed');
  const duplicate=layout('count=3&layers=3&shape=mixed');
  for(const tiers of [shaped,duplicate])m.exports.shapeRange(tiers,roof,rim);
  const {start,end,rise}=m.exports.ascent, signatures=new Set();
  for(const [i,tier] of shaped.entries()){
    const pass=tier.passage;
    const samples=Array.from({length:end-start+1},(_,j)=>pass.route(start+j));
    assert.equal(samples[0].y,0);
    assert.equal(samples.at(-1).y,rise);
    assert.ok(samples.every(p=>p.y>=0 && p.y<=rise+1e-6),'the dip stays above the approach');
    assert.deepEqual(samples, samples.map(s=>duplicate[i].passage.route(s.x)));
    const widths=samples.map(p=>p.w),grades=samples.slice(1).map((p,j)=>p.y-samples[j].y);
    assert.ok(Math.max(...widths)>1.4*Math.min(...widths),'a tight section and an opening');
    assert.ok(grades.some(v=>v<-.07) && grades.some(v=>v>.3),'downhill and uphill terrain');
    assert.ok(grades.filter(v=>Math.abs(v)<.001).length>=8,'walkable landing within the climb');
    const headings=samples.slice(6).map((p,j)=>Math.atan2(p.z-samples[j].z,6));
    assert.ok(Math.max(...headings)-Math.min(...headings)>1,'substantial change of direction');
    signatures.add(JSON.stringify(samples.filter((_,j)=>j%25===0).map(p=>Math.round(p.z))));
    for(let x=-326;x<320;x+=19){
      let prev=-Infinity;
      for(let z=-345;z<=345;z+=11){
        const mapped=pass.lateral(x,z),world=worldPlan(tier,x,z),back=localPlan(tier,world.x,world.z);
        assert.ok(mapped>prev && Math.hypot(back.x-x,back.z-z)<1e-7);
        prev=mapped;
      }
    }
  }
  assert.equal(signatures.size,shaped.length);
  const trio=layout('count=3&layers=auto'),quad=layout('count=4&layers=auto');
  assert.deepEqual(trio,quad.slice(0,trio.length));
  assert.ok(layout('height=high')[0].rise>original[0].rise);
  assert.ok(layout('height=low')[0].rise<original[0].rise);
  for(const mode of ['hills','valley']){
    const g=rangeGround(quad,mode);
    for(const root of quad.filter(t=>!t.parent)){
      const a=worldPlan(root,-298,-50),b=worldPlan(root,281,0);
      assert.ok(g.floor(a.x,a.z)<1 && g.floor(b.x,b.z)<1);
    }
    const idx=g.mesh.indices,p=g.mesh.positions;
    for(let i=0;i<idx.length-24;i+=717){
      const a=idx[i]*3,b=idx[i+1]*3,c=idx[i+2]*3;
      const at=k=>(p[a+k]+p[b+k]+p[c+k])/3;
      assert.ok(Math.abs(g.floor(at(0),at(2))-at(1))<.0001);
    }
  }
}
