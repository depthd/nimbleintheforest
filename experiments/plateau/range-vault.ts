import { Vector3 } from 'three';
import { Rng, Simplex2, smoothstep } from '../../src/core/rng';
import { wallOutcrop } from './wall-outcrop';
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
  const breadth=rng.float(89,108), phase=rng.float(-2,2);
  const shoulderA=rng.float(.32,.44), shoulderB=rng.float(.57,.70);
  const length=from.distanceTo(to);
  const lift=Math.min(157,length*Math.min(shoulderA,1-shoulderB)*.74);
  const crestRise=rng.float(52,82), crestOffset=rng.float(-.08,.08);
  const sections=32, route:Vector3[]=[], trees:{root:Vector3;height:number}[]=[];
  const shell:Vector3[][]=[],roofRows:Vector3[][]=[];
  const snowEdges:number[]=[];
  let crest=from.clone();

  // Beds break at unequal intervals along the span. The outer faces of a bed
  // can project over its neighbour, but both spring from the same solid vault.
  const joints=[-.10];
  while(joints[joints.length-1]<1.1)joints.push(joints[joints.length-1]+rng.float(.105,.24));
  function bed(t:number) {
    const j=joints.findIndex(x=>x>=t);
    const f=(t-joints[j-1])/(joints[j]-joints[j-1]);
    return smoothstep(0,.16,f)*(1-smoothstep(.72,1,f));
  }
  function opening(t:number,v:number) {
    const along=t+.040*v*Math.sin(Math.PI*t);
    const left=smoothstep(.035,.39+crestOffset,along);
    const right=1-smoothstep(.58+crestOffset,.96,along);
    return Math.min(left,right);
  }
  const grade=(x:number)=>{
    const q=Math.min(1,Math.max(0,x));
    return q-.037*Math.sin(2*Math.PI*q);
  };
  for(let i=0;i<=sections;i++){
    const t=i/sections,hump=Math.sin(Math.PI*t);
    const center=from.clone().lerp(to,t).addScaledVector(side,29*hump*Math.sin(4*t+phase));
    const terrace=Math.min(grade(t/shoulderA),grade((1-t)/(1-shoulderB)));
    const top=center.y+lift*terrace;
    const w=breadth*(.93+.12*Math.sin(8*t+phase)+.15*hump);
    const p=(v:number,y:number)=>center.clone().addScaledVector(side,w*v).setY(y);
    const bearing=t<.5?left:right;
    const blend=1-smoothstep(.01,.18,Math.min(t,1-t));
    const seat=(v:number,dy:number)=>{
      const q=p(v,top+dy);
      if(blend>0){
        const local=localPlan(bearing,q.x,q.z);
        q.y+=(roof(local.x,local.z)*bearing.rise+bearing.y-(t<.5?from:to).y-1.1)*blend;
      }
      return q;
    };
    const leftEdge=-1-.13*noise.noise(4*t,phase);
    const rightEdge=1+.13*noise.noise(4*t+11,phase);
    const backBed=bed(t-.035), frontBed=bed(t+.035);
    // One high shoulder continues the bank into the roof and dies out before
    // the other bank. Its skyline has a separate strike from the vault below.
    const ridge=crestRise*smoothstep(.06,.24+crestOffset,t)*(1-smoothstep(.47+crestOffset,.80,t));
    const crestWidth=.20*Math.sin(6*t+phase)+.12*backBed;
    const pocket=.07*Math.sin(10*t+phase);
    // The crossing occupies one shoulder. Across its inner edge, the same
    // roof rises through a fractured rock scarp into a broad, offset crest.
    const roofLine=[
      seat(rightEdge,-.8),seat(.64,1.8),seat(.33+pocket,1.2),
      seat(.09+pocket+crestWidth,ridge*.17),seat(.02+pocket+crestWidth,ridge*(.68+.15*backBed)),
      seat(-.23+pocket,ridge*(.99+.09*Math.sin(7*t+phase))),
      seat(-.63,ridge*(1.04+.09*backBed)),seat(leftEdge,ridge*.63)
    ];
    const underside=(v:number)=>{
      const aperture=opening(t,v);
      return Math.min(top-16,17+(Math.min(from.y,to.y)*.94-17)*aperture
        +hump*(8*noise.noise(4.1*t+phase,1.2*v)+6*v));
    };
    function flank(v:number, high:Vector3, ledge:number){
      const air=opening(t,v), h=underside(v), thick=high.y-h;
      const toe=v*(.84+.34*(1-air));
      return [
        p(toe,h),p(toe+Math.sign(v)*(.06+.12*ledge),h+thick*(.22+.08*ledge)),
        p(v*(1.02+.12*ledge),h+thick*(.48+.16*ledge)),
        p(v*(.96+.05*ledge),h+thick*(.74+.10*ledge)),high
      ];
    }
    const rear=flank(leftEdge,roofLine.at(-1)!,backBed).reverse();
    const front=flank(rightEdge,roofLine[0],frontBed);
    shell.push([...rear,p(-.54,underside(-.54)-6*backBed),p(.06,underside(.06)-7),
      p(.53,underside(.53)-9*frontBed),...front]);
    roofRows.push(roofLine);
    // Wind exposes the outer brow. The sheltered part of the crossing keeps
    // its snow, with a boundary that follows the rock beds into each bank.
    const exposure=.48+.33*Math.sin(13*t+phase)+.29*frontBed;
    snowEdges.push(Math.max(0,Math.min(1.85,2.0*exposure*hump)));
    route.push(roofLine[1].clone());
    if(roofLine[6].y>crest.y)crest=roofLine[6].clone();
    if(i>4 && i<sections-4 && rng.chance(.15)) trees.push({root:roofLine[5],height:rng.float(6,12)});
  }
  for(let i=0;i<sections;i++){
    const a=shell[i],b=shell[i+1],c=roofRows[i],d=roofRows[i+1];
    for(let j=0;j<a.length-1;j++)rock.quad(a[j],b[j],b[j+1],a[j+1]);
    for(let j=0;j<c.length-1;j++){
      if(j<2){
        const edge=(row:Vector3[],section:number)=>row[j].clone().lerp(row[j+1],Math.max(0,Math.min(1,snowEdges[section]-j)));
        const near=edge(c,i),far=edge(d,i+1);
        rock.quad(c[j],d[j],far,near);
        snow.quad(near,far,d[j+1],c[j+1]);
        continue;
      }
      const steep=c[j].distanceTo(c[j+1])*.57 < Math.abs(c[j+1].y-c[j].y);
      (steep?rock:snow).quad(c[j],d[j],d[j+1],c[j+1]);
    }
  }
  for(const i of [0,sections]){
    const ring=[...shell[i],...roofRows[i].slice(1,-1)];
    for(let j=1;j<ring.length-1;j++) {
      if(i===0)rock.triangle(ring[0],ring[j],ring[j+1]);
      else rock.triangle(ring[0],ring[j+1],ring[j]);
    }
  }
  const outcrops=new Surface(), patchSnow=new Surface();
  for(const face of [-1,1]){
    // Separate attached masses at the springings and a long fractured bed
    // under the crown. Leave intervening areas of sheer rock exposed.
    for(const [n,t] of [rng.float(.14,.25),rng.float(.39,.59),rng.float(.73,.85)].entries()){
      const i=Math.round(t*sections), profile=shell[i];
      const lo=face<0?profile[4]:profile[profile.length-5];
      const hi=face<0?profile[0]:profile.at(-1)!;
      const span=hi.y-lo.y;
      const site=lo.clone().lerp(hi,.46).addScaledVector(side,face*4);
      const width=length*(n===1?rng.float(.18,.26):rng.float(.105,.17));
      const depth=rng.float(48,74), height=span*(n===1?.61:1.08);
      const strike=Math.atan2(axis.z,axis.x)+(face>0?Math.PI:0)+rng.float(-.12,.12);
      const corners=[[-.50,-.21],[-.32,-.50],[.34,-.48],[.53,-.19],[.41,.36],[.08,.49],[-.43,.36]]
        .map(([x,z])=>[width*x,depth*z,rng.float(-.16,.17)]);
      const pieces=wallOutcrop({x:site.x,z:site.z,base:lo.y+(n===1?.13:-.19)*span,
        width,depth,height,angle:strike,lean:rng.float(-9,8),rake:rng.float(-18,22),crown:1.5,wear:.48},corners,rng.int(0,0x7fffffff));
      for(const piece of pieces){outcrops.shell(piece.rock);patchSnow.shell(piece.snow);}
    }
  }
  const mid=route[sections/2].clone().addScaledVector(side,-breadth*.52);
  const gorgeZ=(bankA.rimZ+bankB.rimZ)/2;
  const x=from.x+(to.x-from.x)*(gorgeZ-from.z)/(to.z-from.z);
  const passage=[new Vector3(x-2.5*breadth,0,gorgeZ),new Vector3(x+2.5*breadth,0,gorgeZ)];
  return {rock:rock.data(),snow:snow.data(),outcrops:outcrops.data(),patchSnow:patchSnow.data(),route,trees,mid,crest,passage};
}
