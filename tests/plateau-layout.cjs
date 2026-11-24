const assert=require('node:assert/strict');
const path=require('node:path');
const {Module}=require('node:module');
const {buildSync}=require('esbuild');

const source=buildSync({stdin:{contents:`
  export { mountainTiers, localPlan, worldPlan } from './mountain-tiers';
  export { rangeLayout } from './range-layout';
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
