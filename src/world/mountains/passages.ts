import { Rng } from '../../core/rng';
import { append, type MeshData, type Point } from './geometry';
import { createMountainRope, ropeDecoration } from './rope';

export interface PassageAnchors {
  throughLower: Point; throughUpper: Point; throughSkylightStartZ: number;
  denMouth: Point; denBack: Point; halfWidth: number; height: number;
  ropeLower: Point; ropeUpper: Point;
}

export type PassageSurface = MeshData & {
  name: 'passage-rock' | 'passage-portal' | 'passage-floor' | 'rope' | 'rope-anchor'; collider: boolean;
};

class Faces {
  positions: number[] = [];
  indices: number[] = [];
  add(points: Point[]) { append(points, this.positions, this.indices); }
  surface(name: PassageSurface['name']): PassageSurface {
    return { name, collider: true, positions: new Float32Array(this.positions), indices: new Uint32Array(this.indices) };
  }
}

const pt = (x:number,y:number,z:number): Point => ({x,y,z});

export function buildMountainPassages(a: PassageAnchors, seed = 0) {
  const rock = new Faces(), portal = new Faces(), floor = new Faces(), rng = new Rng(seed);
  const half = a.halfWidth, clearance = a.height;
  const ring = (middle: Point, top: number, edgeHeight: number, width: number, crown: number, shift=0) =>
    [pt(middle.x-width,middle.y,middle.z),pt(middle.x+width,middle.y,middle.z),
     pt(middle.x+width,edgeHeight,middle.z),pt(middle.x+crown+shift,top,middle.z),
     pt(middle.x-crown+shift,top,middle.z),pt(middle.x-width,edgeHeight,middle.z)];

  // Join the sheltered lining to a broken rock brow. Each face runs back into
  // the host cliff. The bottom stays open at the same elevation as the approach.
  function frameMouth(section: Point[]) {
    const center = (section[0].x + section[1].x) / 2;
    const outerReach = rng.float(1.4, 2.5);
    const lip = section.map((p, i) => {
      const high = i === 3 || i === 4;
      const foot = i < 2;
      return pt(p.x + (center-p.x) * (foot ? 0 : rng.float(.015,.09)),
        p.y - (high ? rng.float(.08,.28) : 0), p.z + rng.float(.25,high ? 1.35 : .83));
    });
    const crown = lip.map((p, i) => {
      const side = Math.sign(p.x - center);
      const rise = i < 2 ? 0 : i === 3 || i === 4 ? rng.float(.65,1.45) : rng.float(.15,.65);
      return pt(p.x + side * rng.float(.45,outerReach), p.y + rise, p.z + rng.float(-.25,.32));
    });
    const roots = crown.map((p, i) => pt(p.x + Math.sign(p.x - center) * .6,
      p.y + (i < 2 ? -.2 : .32), section[i].z - 2.6));
    // Side faces and the underside are physically continuous with the playable throat.
    for (let i = 1; i < section.length; i++) {
      const j = (i + 1) % section.length;
      rock.add([section[i], section[j], lip[j], lip[i]]);
      portal.add([lip[i], lip[j], crown[j], crown[i]]);
      portal.add([crown[i], crown[j], roots[j], roots[i]]);
    }
    rock.add([section[3],section[2],pt(section[2].x,section[3].y,section[2].z)]);
    rock.add([section[5],section[4],pt(section[5].x,section[4].y,section[5].z)]);
  }
  function lining(from:Point[],to:Point[],sky:boolean) {
    for(let k=0;k<from.length;k++) {
      if(sky && k!==0 && k!==1 && k!==5) continue;
      const j=(k+1)%from.length;
      (k===0?floor:rock).add([from[k],from[j],to[j],to[k]]);
    }
  }
  const lo=a.throughLower, hi=a.throughUpper, lip=a.throughSkylightStartZ;
  const crest=hi.z+0.5;
  const uphillFloor = (z:number) => lo.y+(hi.y-lo.y)*Math.max(0,Math.min(1,(lo.z-z)/(lo.z-crest)));
  const along = (t:number) => lo.z+(lip-lo.z)*t;
  const throughZ=[lo.z,along(.26),along(.53),along(.76),lip,(lip+crest)/2,crest,hi.z];
  let last: Point[] | undefined;
  for(const z of throughZ) {
    const y=uphillFloor(z), open=z<=lip, mouth=z===lo.z;
    const width=open||mouth?half:half-rng.float(.08,.35);
    const crown=open?width:half*rng.float(.55,.75);
    const top=open?hi.y:Math.min(hi.y,y+clearance);
    const side=open?hi.y:top-rng.float(.55,.92);
    const section=ring(pt(lo.x,y,z),top,side,width,crown,open?0:rng.float(-.18,.18));
    if(last) lining(last,section,last[0].z<=lip); else frameMouth(section);
    last=section;
  }

  const m=a.denMouth,b=a.denBack;
  const denRings=[0,.22,.47,.72,1].map(t=>{
    const z=m.z+(b.z-m.z)*t;
    // The ground plane also exists under the den. Expose one floor, gently raised inside.
    const y=m.y+.09*Math.min(1,t/.22), width=t===0?half:half*rng.float(.80,.99);
    const top=t===0?m.y+clearance:y+clearance*rng.float(.79,.96);
    return ring(pt(m.x+(t===0?0:rng.float(-.18,.18)),y,z),top,top-rng.float(.55,.9),
      width,width*rng.float(.50,.75),rng.float(-.14,.14));
  });
  frameMouth(denRings[0]);
  for(let i=1;i<denRings.length;i++) lining(denRings[i-1],denRings[i],false);
  const end = denRings[denRings.length-1];
  const fracture = pt(b.x + half * .21, b.y + clearance * .43, b.z - .025);
  for (let i = 0; i < end.length; i++) rock.add([end[i], end[(i+1)%end.length], fracture]);

  const rope=createMountainRope(a.ropeLower,a.ropeUpper);
  const cable=ropeDecoration(rope);
  const surfaces:PassageSurface[]=[floor.surface('passage-floor'),rock.surface('passage-rock'),portal.surface('passage-portal'),
    {...cable.line,name:'rope',collider:false}, {...cable.anchor,name:'rope-anchor',collider:false}];
  return { surfaces, rope, entrance:{through:lo,den:m},
    routes:{
      through:[pt(lo.x,lo.y,lo.z+2),...throughZ.map(z=>pt(lo.x,uphillFloor(z),z)),pt(hi.x,hi.y,hi.z-1.5)],
      den:[pt(m.x,m.y,m.z+2),pt(m.x,m.y,m.z),pt(b.x,b.y+.09,b.z+1.35)],
    } };
}
