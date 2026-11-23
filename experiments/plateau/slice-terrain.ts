// Compact, metre-scale traversal lab. The legacy art scene retains its original scale.
import { Rng, smoothstep } from '../../src/core/rng';
import { plateauOutline } from './plateau-profile';
import type { MeshData } from './cavity';

export type SlicePoint = { x: number; y: number; z: number };
export type MountainId = 'main' | 'satellite';
export type Entry = 'wide' | 'cut' | 'none';
export type SliceTier = {
  id: string; mountainId: MountainId; level: number; accessible: boolean;
  kind: 'plateau' | 'peak'; center: SlicePoint; entry: Entry;
};
export type SliceRoute = { from: string; to: string; kind: 'wide' | 'cut' | 'terrace'; points: SlicePoint[] };
export type SliceTree = SlicePoint & { height: number; radius: number };
export type BridgeAnchor = SlicePoint & { mountainId: MountainId; tierId: string; accessible: boolean };
type Box = { left: number; right: number; front: number; back: number; bottom: number; top: number };
type Surface = Box & { tier: SliceTier; length: number; width: number; bend: number; startZ: number; phase: number };
const pt = (x: number, y: number, z: number): SlicePoint => ({ x,y,z });
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const distance = (a: SlicePoint, b: SlicePoint) => Math.hypot(a.x-b.x, a.z-b.z);

function rampZ(s: Surface, x: number) {
  return s.startZ + s.bend * Math.sin(Math.PI * clamp((x-s.left)/s.length));
}

// Round the short sides without cutting into reserved landings on the straight edges.
function inset(s: Box, x: number) {
  const r = Math.min(8,(s.front-s.back)*.15,(s.right-s.left)*.13);
  const dx = Math.max(0,r-Math.min(x-s.left,s.right-x));
  return r-Math.sqrt(Math.max(0,r*r-dx*dx));
}
function surfaceY(s: Surface,x: number,z: number) {
  const rise = s.top-s.bottom;
  if (s.tier.kind==='peak') {
    const { center }=s.tier;
    const radius=Math.max(Math.abs(2*(x-center.x)/(s.right-s.left)),Math.abs(2*(z-center.z)/(s.front-s.back)));
    return s.bottom + rise*(1-.48*Math.min(1,radius));
  }
  const t=clamp((x-s.left)/s.length);
  // Continuous tangent at foot and crest. The entire west side blends in wide mode.
  const ramp = s.bottom + rise * smoothstep(0,1,t);
  const band = s.tier.entry==='none' ? 1 : s.tier.entry==='wide' ? 0 :
    smoothstep(s.width*.5,s.width*.5+1.6,Math.abs(z-rampZ(s,x)));
  return ramp+(s.top-ramp)*band;
}
class TriangleBuffer {
  xyz: number[]=[];
  indices: number[]=[];
  vertex(p: SlicePoint) { this.xyz.push(p.x,p.y,p.z);return this.xyz.length/3-1; }
  quad(a: SlicePoint,b: SlicePoint,c: SlicePoint,d: SlicePoint) {
    const i=this.vertex(a);this.vertex(b);this.vertex(c);this.vertex(d);
    this.indices.push(i,i+1,i+2,i,i+2,i+3);
  }
  finish(): MeshData { return { positions:new Float32Array(this.xyz), indices:new Uint32Array(this.indices) }; }
}
function gridShape(s: Box) {
  return { nx:Math.ceil((s.right-s.left)/2), nz:Math.ceil((s.front-s.back)/2) };
}
function node(s: Surface, ix: number, iz: number, nx: number, nz: number) {
  const x=s.left+(s.right-s.left)*ix/nx, edge=inset(s,x);
  const z=s.back+edge+(s.front-s.back-2*edge)*iz/nz;
  return pt(x,surfaceY(s,x,z),z);
}
function roofHole(s: Surface, x: number,z: number,passages: boolean) {
  return passages && s.tier.id==='main-2' && x>14 && x<20 && z>-10 && z<0;
}
function bakeSurface(s: Surface,rock: TriangleBuffer,snow: TriangleBuffer,passages: boolean) {
  const {nx,nz}=gridShape(s);
  const top=s.tier.kind==='peak'?rock:snow;
  const start=top.xyz.length/3;
  // Indexed tops share edges with the boundary wall and have upward-facing winding.
  const grid:SlicePoint[]=[];
  for(let ix=0;ix<=nx;ix++) for(let iz=0;iz<=nz;iz++){
    const p=node(s,ix,iz,nx,nz);grid.push(p);top.vertex(p);
  }
  const at=(ix:number,iz:number)=>ix*(nz+1)+iz;
  for(let ix=0;ix<nx;ix++) for(let iz=0;iz<nz;iz++){
    const a=at(ix,iz), b=at(ix,iz+1), c=at(ix+1,iz+1), d=at(ix+1,iz);
    if(!roofHole(s,(grid[a].x+grid[c].x)/2,(grid[a].z+grid[c].z)/2,passages)){
      top.indices.push(start+a,start+b,start+c,start+a,start+c,start+d);
    }
  }
  function side(a: SlicePoint,b: SlicePoint,south=false) {
    const mid=(a.x+b.x)*.5;
    const door=south && passages && ((s.tier.id==='main-1' && mid>12 && mid<18) ||
      (s.tier.id==='main-2' && mid>14 && mid<20));
    const base=s.bottom+(door?4:0);
    if(Math.max(a.y,b.y)<=base+.0001)return;
    rock.quad(a,b,pt(b.x,base,b.z),pt(a.x,base,a.z));
  }
  // Winding faces outward. Doorways retain their stone lintels.
  for(let ix=0;ix<nx;ix++){
    side(grid[at(ix,nz)],grid[at(ix+1,nz)],true);
    side(grid[at(ix+1,0)],grid[at(ix,0)]);
  }
  for(let iz=0;iz<nz;iz++){
    side(grid[at(0,iz)],grid[at(0,iz+1)]);
    side(grid[at(nx,iz+1)],grid[at(nx,iz)]);
  }
}
// Locate the cell in the same rounded grid used for the triangle mesh, then
// interpolate the actual triangle. This also reports open skylights to callers.
function sampleSurface(s: Surface,x:number,z:number,passages:boolean):number|undefined {
  if(x<s.left||x>s.right||z<s.back||z>s.front||roofHole(s,x,z,passages))return;
  const {nx,nz}=gridShape(s), fx=(x-s.left)/(s.right-s.left)*nx, ix=Math.min(nx-1,Math.floor(fx));
  const tx=fx-ix, p0=node(s,ix,0,nx,nz),p1=node(s,ix+1,0,nx,nz);
  const back=p0.z+(p1.z-p0.z)*tx, front=s.front+s.back-back;
  if(z<back-1e-7||z>front+1e-7)return;
  const fz=clamp((z-back)/(front-back))*nz, iz=Math.min(nz-1,Math.floor(fz));
  const a=node(s,ix,iz,nx,nz), b=node(s,ix,iz+1,nx,nz);
  const c=node(s,ix+1,iz+1,nx,nz),d=node(s,ix+1,iz,nx,nz);
  const diagonal=a.z+tx*(c.z-a.z);
  return z>=diagonal ? a.y+tx*(c.y-a.y)+(z-diagonal)*(b.y-a.y)/(b.z-a.z) :
    a.y+tx*(c.y-a.y)+(z-diagonal)*(c.y-d.y)/(c.z-d.z);
}
export function generateSliceTerrain(seed:number,options:{passages?:boolean}={}) {
  const rng=new Rng(seed), surfaces:Surface[]=[],routes:SliceRoute[]=[];
  const wide=rng.chance(.5);
  const mainCount=rng.int(2,4), satelliteCount=rng.int(1,3);
  const spawn=pt(-65,0,-15);
  function add(id:MountainId,level:number,box:Box,entry:Entry,startZ:number,length:number,width:number,peak=false) {
    const center=pt((box.left+box.right)/2,box.top,(box.front+box.back)/2);
    const tier:SliceTier={id:id+'-'+level,mountainId:id,level,accessible:!peak,kind:peak?'peak':'plateau',center,entry};
    const s:Surface={...box,tier,startZ,length,width,bend:entry==='cut'?rng.float(-3,3):0,phase:rng.float(-Math.PI,Math.PI)};
    surfaces.push(s);
    if(peak||entry==='none')return;
    const points:SlicePoint[]=[];
    for(let i=0;i<=20;i++){
      const x=box.left+s.length*i/20, z=rampZ(s,x);
      points.push(pt(x,surfaceY(s,x,z),z));
    }
    routes.push({from:level===1?'spawn':id+'-'+(level-1),to:tier.id,kind:entry,points});
  }
  const box=(left:number,right:number,back:number,front:number,bottom:number,top:number):Box=>({left,right,back,front,bottom,top});
  const entry:Entry=wide?'wide':'cut';
  add('main',1,box(-60,60,-34,34,0,14),entry,-15,rng.float(39,44),rng.float(5,8));
  add('main',2,box(-4,44,-24,14,14,22),entry,-14,rng.float(22,25),rng.float(4.5,6.5));
  if(mainCount>=3)add('main',3,box(22,42,-22,0,22,26.6),entry,-12,15,rng.float(3.5,5),mainCount===3&&rng.chance(.45));
  if(mainCount===4)add('main',4,box(33,41,-20,-8,26.6,33),'none',-14,8,3,true);
  add('satellite',1,box(90,162,-30,30,0,14),'none',0,1,4);
  if(satelliteCount>=2)add('satellite',2,box(117,153,-19,17,14,20.6),entry,2,22,5,satelliteCount===2&&rng.chance(.4));
  if(satelliteCount===3)add('satellite',3,box(140,152,-15,-1,20.6,28),'none',-9,9,3,true);
  const rock=new TriangleBuffer(),snow=new TriangleBuffer(), passages=options.passages??false;
  surfaces.forEach(s=>bakeSurface(s,rock,snow,passages));
  const sampleHeight=(x:number,z:number)=>surfaces.reduce((h,s)=>Math.max(h,sampleSurface(s,x,z,passages)??0),0);
  const bridgeAnchors:[BridgeAnchor,BridgeAnchor]=[
    {...pt(59,14,0),mountainId:'main',tierId:'main-1',accessible:true},
    {...pt(91,14,0),mountainId:'satellite',tierId:'satellite-1',accessible:true}];
  const passageAnchors={throughLower:pt(17,14,14),throughUpper:pt(17,22,-10),
    denMouth:pt(15,0,34),denBack:pt(15,0,20),halfWidth:3,height:4,throughSkylightStartZ:0,
    ropeLower:pt(-4,0,35.1),ropeUpper:pt(-4,14,32.6)};
  const trees:SliceTree[]=[];
  for(const s of surfaces){
    if(s.tier.kind==='peak')continue;
    const n=Math.max(2,Math.round((s.right-s.left)*(s.front-s.back)/320));
    for(let i=0,nPlaced=0;i<n*24&&nPlaced<n;i++){
      const x=rng.float(s.left+2,s.right-2),z=rng.float(s.back+2,s.front-2);
      const h=sampleSurface(s,x,z,passages);
      if(h===undefined||Math.abs(h-s.top)>.02||Math.abs(sampleHeight(x,z)-h)>.02)continue;
      if(surfaces.some(other=>other.tier.mountainId===s.tier.mountainId && other.tier.level>s.tier.level &&
        x>other.left-3&&x<other.right+3&&z>other.back-3&&z<other.front+3))continue;
      if(Math.abs(z)<4&&x>46&&x<111 || x>9&&x<25&&z>-14&&z<38 || x>-9&&x<2&&z>27)continue;
      if(routes.some(r=>r.points.some(p=>Math.hypot(x-p.x,z-p.z)<4)))continue;
      const p=pt(x,h,z);
      if(trees.some(t=>distance(t,p)<3))continue;
      trees.push({...p,height:rng.float(2.4,5.8),radius:.23});nPlaced++;
    }
  }
  // Use the accepted plateau's contour to choose the visible frontage; the wall
  // adapter can place either sculpting family at this same unobstructed section.
  const width=20*plateauOutline(0);
  const wallAnchor={...pt(-29,0,34),yaw:0,width,height:14};
  return {seed,spawn,tiers:surfaces.map(s=>s.tier),routes,bridgeAnchors,passageAnchors,wallAnchor,
    sampleHeight,trees,rock:rock.finish(),snow:snow.finish()};
}
export type SliceTerrain=ReturnType<typeof generateSliceTerrain>;
