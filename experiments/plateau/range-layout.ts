import { type Tier, localPlan, seatOnParent, worldPlan } from './mountain-tiers';
import { stream } from './range-seed';
import { type RangeSettings } from './range-settings';
import { passageShape } from './passage-shape';
import { ascentSample } from './ascent';
import { plateauRadius } from './plateau-profile';

type Point = {x:number; z:number};

function placeEntrance(child:Tier,parent:Tier,preferred:Point,roof:(x:number,z:number)=>number){
  // The approach must start on the parent's snowfield. Keep the parent's
  // own exit and the space needed to turn onto this ascent open as well.
  const runway=Array.from({length:7},(_,i)=>ascentSample(-320+14*i));
  const mainTrail=Array.from({length:31},(_,i)=>{
    const s=ascentSample(-285+i*11);
    return [-.30,0,.30].map(side=>worldPlan(parent,s.x,s.z+side*s.w));
  }).flat();
  function clearance(){
    let margin=Infinity;
    for(const s of runway){
      const w=worldPlan(child,s.x,s.z),q=localPlan(parent,w.x,w.z);
      margin=Math.min(margin,(.93-plateauRadius(q.x,q.z))*150);
      if(margin>=0){
        // A level shelf in plan can still have a steep wind lip underfoot.
        const dx=worldPlan(parent,q.x+2,q.z),dz=worldPlan(parent,q.x,q.z+2);
        const h=roof(q.x,q.z);
        const gx=(roof(q.x+2,q.z)-h)*parent.rise/Math.hypot(dx.x-w.x,dx.z-w.z);
        const gz=(roof(q.x,q.z+2)-h)*parent.rise/Math.hypot(dz.x-w.x,dz.z-w.z);
        margin=Math.min(margin,(.75-Math.hypot(gx,gz))*50);
      }
      if(q.x>=-310 && q.x<=29){
        const floor=ascentSample(q.x);
        margin=Math.min(margin,Math.abs(q.z-floor.z)-floor.w-5);
      }
    }
    for(const w of mainTrail){
      const q=localPlan(child,w.x,w.z);
      margin=Math.min(margin,(plateauRadius(q.x,q.z)-1.45)*120*child.width/parent.width);
    }
    return margin;
  }
  const yaw=child.yaw;
  Object.assign(child,worldPlan(parent,preferred.x,preferred.z));
  let best=clearance(), pose={x:child.x,z:child.z,yaw};
  const rng=stream('terrace entrance '+child.seed);
  for(let i=0;i<160 && best<4;i++){
    Object.assign(child,worldPlan(parent,rng.float(63,153),rng.float(-98,98)));
    child.yaw=yaw+rng.float(-Math.PI,Math.PI);
    const score=clearance();
    if(score>best){best=score;pose={x:child.x,z:child.z,yaw:child.yaw};}
  }
  Object.assign(child,pose);
  return best;
}
// Preserve the bridge gorge and the local attachment of each upper terrace
// when the two banks acquire different shoulders and cut banks.
export function shapeRange(tiers:Tier[], roof:(x:number,z:number)=>number, rim:(a:number)=>Point) {
  const originals=new Map(tiers.map(t=>[t.name,{...t}]));
  const base=tiers[0], spur=tiers.find(t=>t.name==='spur');
  function bank(t:Tier,side:number){
    let best={x:t.x,z:-side*Infinity};
    for(let i=0;i<240;i++){
      const r=rim(i*Math.PI/120),p=worldPlan(t,r.x,r.z);
      if(side*p.z>side*best.z)best=p;
    }
    return best;
  }
  for(const tier of tiers){
    const parent=tiers.find(t=>t.name===tier.parent);
    if(parent){
      const inherited=parent.width/originals.get(parent.name)!.width;
      tier.width*=inherited;tier.depth=(tier.depth??originals.get(tier.name)!.width)*inherited;
      tier.rise*=inherited;
    }
    // Reserve enough horizontal run for the descent, landing and final climb.
    // Small upper terraces cannot carry all three at a root cliff's aspect.
    tier.rise=Math.min(tier.rise,1.16*tier.width);
    tier.passage=passageShape(tier.seed,tier.width,tier.depth??tier.width,tier.rise);
    if(tier===spur){
      const side=Math.sign(spur.z-base.z), a=bank(originals.get(base.name)!,side),b=bank(originals.get(spur.name)!,-side);
      const c=bank(base,side),d=bank(spur,-side);
      spur.x+=c.x-a.x+b.x-d.x;spur.z+=c.z-a.z+b.z-d.z;
    }
    if(parent){
      const original=originals.get(tier.name)!;
      const site=localPlan(originals.get(parent.name)!,original.x,original.z);
      for(let attempt=0;attempt<3;attempt++){
        tier.yaw=original.yaw;
        if(placeEntrance(tier,parent,site,roof)>=0 || attempt===2)break;
        // A wide child can close the only route onto its supporting tier.
        tier.width*=.86;tier.depth=(tier.depth??original.width)*.86;tier.rise*=.86;
        tier.passage=passageShape(tier.seed,tier.width,tier.depth,tier.rise);
      }
      seatOnParent(tier,parent,roof);
    }
  }
}
export function rangeLayout(original:Tier[], settings:RangeSettings, roof:(x:number,z:number)=>number, rim:(a:number)=>Point) {
  const count=Number(settings.count), automatic=settings.layers==='auto';
  if(count===2 && automatic && settings.shape==='original' && settings.height==='original')return original;
  const roots:Tier[]=[], tiers:Tier[]=[];
  const referenceRoots=original.filter(t=>!t.parent);
  function lip(t:Tier, dx:number, dz:number){
    let best=-Infinity, point={x:0,z:0};
    for(let i=0;i<240;i++){
      const q=rim(i*Math.PI/120), p=worldPlan(t,q.x,q.z), projection=p.x*dx+p.z*dz;
      if(projection>best){best=projection;point=p;}
    }
    return point;
  }
  for(let i=0;i<count;i++){
    const rng=stream('massif '+i);
    const aspect=settings.shape==='mixed'?stream('massif aspect '+i).float(.68,1.40):
      {original:1,long:.70,broad:1.36}[settings.shape];
    const height=settings.height==='mixed'?stream('massif height '+i).float(.65,1.50):
      {original:1,low:.68,high:1.44}[settings.height];
    const template=referenceRoots[i];
    const root:Tier=template?{...template}:{
      name:'massif-'+(i+1), x:0,y:0,z:0,yaw:rng.float(-Math.PI,Math.PI),
      width:rng.float(1.28,1.72),rise:rng.float(.80,1.14),seed:rng.int(0,0x7fffffff)
    };
    root.depth=root.width*aspect;
    root.rise*=height;
    if(i===1 && aspect!==1){
      // Carry the original gap and lateral offset to the newly shaped banks.
      const side=Math.sign(root.z), a=lip(referenceRoots[0],0,side), b=lip(template,0,-side);
      const c=lip(roots[0],0,side), d=lip(root,0,-side);
      root.x+=b.x-a.x+c.x-d.x;
      root.z+=b.z-a.z+c.z-d.z;
    }
    if(i>=2){
      // Put each extra massif beyond the occupied contours along a different
      // bearing. A seed controls the valley width and the stagger of its banks.
      const angle=rng.float(-.66,.66)+(i===3?Math.PI:0);
      const dx=Math.cos(angle), dz=Math.sin(angle);
      const banks=roots.map(t=>lip(t,dx,dz));
      const bank=banks.reduce((a,b)=>a.x*dx+a.z*dz>b.x*dx+b.z*dz?a:b);
      const toe=lip(root,-dx,-dz), gap=rng.float(130,295), stagger=rng.float(-140,140);
      root.x=bank.x-toe.x+dx*gap-dz*stagger;
      root.z=bank.z-toe.z+dz*gap+dx*stagger;
    }
    tiers.push(root);roots.push(root);
    const chain:Tier[]=[];
    let source=template;
    while(source){
      const child=original.find(t=>t.parent===source.name);
      if(!child)break;
      chain.push(child);source=child;
    }
    const levels=automatic?(template?1+chain.length:rng.int(1,3)):Number(settings.layers);
    let parent=root;
    for(let j=1;j<levels;j++){
      const child=chain[j-1], sourceParent=j===1?template:chain[j-2];
      const shape=stream(root.name+' terrace '+j);
      const offset=child?localPlan(sourceParent,child.x,child.z):{x:shape.float(70,99),z:shape.float(20,40)};
      // Four terraces need wider intermediate shelves to carry the next ascent.
      const fraction=levels===4?shape.float(.51,.56):child?child.width/sourceParent.width:shape.float(.46,.54);
      const width=parent.width*fraction;
      const center=worldPlan(parent,offset.x*(levels===4?.75:1),offset.z*(levels===4?.75:1));
      const nominalRise=child && levels!==4?child.rise:width*shape.float(.97,1.21);
      const tier:Tier={
        name:child?.name??(i===0 && j===2?'summit':root.name+'-'+j),parent:parent.name,...center,y:0,
        yaw:parent.yaw+(child?child.yaw-sourceParent.yaw:shape.float(-1.25,1.25)),
        width,depth:width*aspect,seed:child?.seed??shape.int(0,0x7fffffff),
        rise:Math.min(nominalRise*height,Math.max(nominalRise,width*1.48)),
      };
      seatOnParent(tier,parent,roof);
      tiers.push(tier);parent=tier;
    }
  }
  return tiers;
}
