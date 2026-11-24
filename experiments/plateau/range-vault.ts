import { Vector3 } from 'three';
import { Rng, Simplex2, smoothstep } from '../../src/core/rng';
import { Surface } from './landform-mesh';
import { contourPoint } from './plateau-profile';
import { distanceToAscent } from './mountain-snow';
import { worldPlan, localPlan, reservedForUpper, type Tier } from './mountain-tiers';

// The ends are on the inner snowfields of the two massifs. Each section carries its
// own tread, snow rim, two cliff faces and vaulted soffit over the lower route.
export function rangeVault(tiers:Tier[], roof:(x:number,z:number)=>number, rng:Rng) {
  const rock=new Surface(), snow=new Surface(), noise=new Simplex2(rng.next);
  const left=tiers[0], right=tiers.find(t=>t.name==='spur')!, sign=Math.sign(right.z-left.z);
  function shoulder(t:Tier, direction:number) {
    const child=tiers.find(other=>other.parent===t.name);
    let best=-Infinity, anchor=new Vector3(), rimZ=direction>0?-Infinity:Infinity;
    for(let i=0;i<180;i++){
      const a=i*Math.PI/90, rim=contourPoint(a,1);
      const w=worldPlan(t,rim.x,rim.z);
      if(direction*w.z>direction*rimZ) rimZ=w.z;
      const p=contourPoint(a,.80), q=worldPlan(t,p.x,p.z);
      const score=direction*q.z - 6*Math.max(0,38-distanceToAscent(p))
        - (reservedForUpper(t,child,p.x,p.z,27)?500:0);
      if(score>best){best=score;anchor=new Vector3(q.x,t.y+t.rise*roof(p.x,p.z),q.z);}
    }
    return {anchor,rimZ};
  }
  const bankA=shoulder(left,sign),bankB=shoulder(right,-sign);
  const from=bankA.anchor,to=bankB.anchor;
  const axis=to.clone().sub(from).setY(0).normalize();
  const side=new Vector3(-axis.z,0,axis.x);
  const breadth=rng.float(88,101), lift=Math.min(from.distanceTo(to)*.255,rng.float(142,185)), phase=rng.float(-2,2);
  const sections=30, route:Vector3[]=[], trees:{root:Vector3;height:number}[]=[];
  const rockRows:Vector3[][]=[], snowRows:Vector3[][]=[];
  for(let i=0;i<=sections;i++){
    const t=i/sections, hump=Math.sin(Math.PI*t), dome=hump*hump;
    const center=from.clone().lerp(to,t).addScaledVector(side,24*hump*Math.sin(4*t+phase));
    const top=center.y+lift*dome;
    const bottom=Math.min(top-4, 19 + (Math.min(from.y,to.y)*.96-19)*Math.pow(hump,.74));
    const w=breadth*(.86+.24*hump+.1*Math.sin(7*t+phase));
    const p=(v:number,y:number)=>center.clone().addScaledVector(side,w*v).setY(y);
    const bearing=t<.5?left:right;
    const blend=1-smoothstep(.01,.18,Math.min(t,1-t));
    const hatch=(v:number,dy:number)=>{
      const q=p(v,top+dy);
      if(blend>0){
        const local=localPlan(bearing,q.x,q.z);
        const seat=roof(local.x,local.z)*bearing.rise+bearing.y;
        q.y+=(seat-(t<.5?from:to).y-1.1)*blend;
      }
      return q;
    };
    const edge=(v:number)=>1+.13*noise.noise(i*.22,v+phase);
    const l=-edge(-2), r=edge(2);
    const row=[
      p(l*.84,bottom+12),p(0,bottom),p(r*.84,bottom+8),
      p(r*1.06, bottom+(top-bottom)*(.51+.12*Math.cos(i*.6))),
      hatch(r,0),hatch(.52,.3),hatch(-.35,.4),hatch(l,-.3),
      p(l*1.02,bottom+(top-bottom)*(.43+.12*Math.sin(i*.86)))];
    rockRows.push(row);
    const cap=row.slice(4,8).map(v=>v.clone());
    cap[1].y+=1.6;cap[2].y+=1.6;
    snowRows.push(cap);
    route.push(row[4].clone().lerp(cap[1],.72));
    if(i>4 && i<sections-4 && i%4===1) trees.push({root:cap[2].clone(),height:rng.float(7,13)});
  }
  // Looking along the span, side points to the left in x/z plan.
  for(let i=0;i<sections;i++){
    const a=rockRows[i],b=rockRows[i+1];
    for(let j=0;j<a.length;j++){
      const k=(j+1)%a.length;
      if(j>=4 && j<7) continue;
      rock.quad(a[j],b[j],b[k],a[k]);
    }
    const c=snowRows[i], d=snowRows[i+1];
    for(let j=0;j<3;j++)snow.quad(c[j],d[j],d[j+1],c[j+1]);
  }
  // Close buried ends. The top is the actual walking surface.
  for(const i of [0,sections]){
    const row=rockRows[i];
    for(let j=1;j<row.length-1;j++) {
      if(i===0) rock.triangle(row[0],row[j],row[j+1]);
      else rock.triangle(row[0],row[j+1],row[j]);
    }
  }
  const mid=route[sections/2].clone().addScaledVector(side,-breadth*.52);
  const gorgeZ=(bankA.rimZ+bankB.rimZ)/2;
  const x=from.x+(to.x-from.x)*(gorgeZ-from.z)/(to.z-from.z);
  const passage=[new Vector3(x-2.5*breadth,0,gorgeZ),new Vector3(x+2.5*breadth,0,gorgeZ)];
  // Place a real stand tier on the broad part of the roof. Its long axis
  // follows the vault, with the snow route along the opposite shoulder.
  const center=rockRows[sections/2][6];
  const crest:Tier={
    name:'vault-crest',x:center.x,y:center.y-24,z:center.z,
    width:rng.float(.25,.29),rise:rng.float(.72,.89),
    yaw:Math.atan2(-axis.z,axis.x),seed:rng.int(0,0x7fffffff)
  };
  return {rock:rock.data(),snow:snow.data(),route,trees,mid,crest,passage};
}
