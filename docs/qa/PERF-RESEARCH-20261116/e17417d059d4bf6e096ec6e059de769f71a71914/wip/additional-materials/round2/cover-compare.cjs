const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const ROOT=process.env.RESEARCH_ROOT||path.resolve(__dirname,'..'),repo=path.join(ROOT,'repo'),base=path.join(ROOT,'baseline');
const {buildSync}=require(path.join(repo,'node_modules/esbuild'));
function load(dir){const filename=path.join(repo,'tests/r2-compiled.cjs'),m=new Module(filename);m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(buildSync({entryPoints:[path.join(dir,'src/world/snow-cover.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['three'],nodePaths:[path.join(repo,'node_modules')]}).outputFiles[0].text,filename);return m.exports.SnowCover;}
const A=load(repo),B=load(base),bounds={minX:-100,minZ:-100,maxX:100,maxZ:100},a=new A(bounds),b=new B(bounds);let seed=438953;
const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
for(let i=0;i<70;i++){const q={name:String(i),kind:i%3?'roof':'floor',x:rnd()*120-60,z:rnd()*120-60,y:rnd()*8-2,hx:rnd()*5+.2,hz:rnd()*5+.2,yaw:rnd()*Math.PI*2,ellipse:i%4===0};a.add(q);b.add(q);}
let checks=0;for(let i=0;i<500000;i++){const x=rnd()*140-70,z=rnd()*140-70,y=rnd()*12-4;assert.equal(a.looseAt(x,z,y),b.looseAt(x,z,y),JSON.stringify({x,z,y}));checks++;}
for(let i=0;i<70;i+=3){a.remove(i);b.remove(i);}
for(let i=0;i<100000;i++){const x=rnd()*140-70,z=rnd()*140-70,y=rnd()*12-4;assert.equal(a.looseAt(x,z,y),b.looseAt(x,z,y));checks++;}
console.log('PASS',checks,'exact looseAt comparisons, rectangles/ellipses/rotation/height/removal');
