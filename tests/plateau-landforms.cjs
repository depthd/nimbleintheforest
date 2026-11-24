const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const { Module } = require('node:module');
const path = require('node:path');

// Bundle Three with the stand so instanceof Mesh sees the same constructor.
const result = buildSync({
  stdin: {contents: `
    export { BufferGeometry, BufferAttribute, Mesh, Group, Vector3 } from 'three';
    export { ledgeMountain } from './ledge-mountain';
    export { rangeVault } from './range-vault';
    export { mountainTiers } from './mountain-tiers';
    export { contourPoint } from './plateau-profile';
    export { walkingSurface } from './range-walk';
    export { Rng, hashString } from '../../src/core/rng';
  `, resolveDir:path.resolve(__dirname,'../experiments/plateau')},
  bundle:true, platform:'node', format:'cjs', write:false
});
const mod = new Module(__filename);
mod._compile(result.outputFiles[0].text,__filename);
const {BufferGeometry,BufferAttribute,Mesh,Group,ledgeMountain,walkingSurface,Rng,hashString} = mod.exports;
function surface(meshes) {
  const group=new Group();
  for(const data of meshes){
    assert.ok(data.positions.every(Number.isFinite));
    const g=new BufferGeometry();
    g.setAttribute('position',new BufferAttribute(data.positions,3));
    g.setIndex(new BufferAttribute(data.indices,1));
    group.add(new Mesh(g));
  }
  return walkingSurface([group],[]);
}
function traverse(contact,route,seed){
  const foot=route[0].clone();
  foot.y=contact.floor(foot.x,foot.z,foot.y) ?? foot.y;
  for(let i=1;i<route.length;i++){
    const a=route[i-1], b=route[i], steps=Math.ceil(a.distanceTo(b)/.7);
    for(let j=1;j<=steps;j++){
      const next=a.clone().lerp(b,j/steps);
      assert.ok(contact.move(foot,next.x-foot.x,next.z-foot.z), 'blocked on seed '+seed+' at section '+i);
    }
  }
  assert.ok(Math.abs(foot.y-route.at(-1).y)<1);
}
function generate(seed) {
  return ledgeMountain(new Rng(seed ^ hashString('ledge massif')));
}
const reference=generate(42);
assert.deepEqual(reference.rock.positions,generate(42).rock.positions);
for(const seed of [0,1,2,15,42,817,17825,4294967295]){
  const mountain=generate(seed);
  if(seed!==42)assert.notDeepEqual(mountain.route,reference.route);
  traverse(surface([mountain.rock,mountain.snow,mountain.outcrops,mountain.summit.rock]),mountain.route,seed);
  const {mountainTiers,rangeVault,contourPoint} = mod.exports;
  const roof=()=>130;
  const tiers=mountainTiers(true,roof,contourPoint,'vault');
  const vault=rangeVault(tiers,roof,new Rng(seed));
  const collision=surface([vault.rock,vault.snow]);
  // The terminal sections are seated on the bank meshes in the assembled stand.
  traverse(collision,vault.route.slice(1,-1),seed);
  traverse(collision,vault.passage,seed);
  const p=vault.route[Math.floor(vault.route.length/2)];
  assert.equal(collision.floor(p.x,p.z,0),0);
  assert.ok(collision.floor(p.x,p.z,p.y)>200);
}
