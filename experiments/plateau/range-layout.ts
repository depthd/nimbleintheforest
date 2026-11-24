import { type Tier, localPlan, seatOnParent, worldPlan } from './mountain-tiers';
import { stream } from './range-seed';
import { type RangeSettings } from './range-settings';

type Point = {x:number; z:number};
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
