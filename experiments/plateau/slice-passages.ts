import { Rng } from '../../src/core/rng';
import { append, type MeshData, type Point } from './cavity';
import { createSliceRope, ropeDecoration } from './slice-passages-rope';

export interface PassageAnchors {
  throughLower: Point; throughUpper: Point; throughSkylightStartZ: number;
  denMouth: Point; denBack: Point; halfWidth: number; height: number;
  ropeLower: Point; ropeUpper: Point;
}

export type PassageSurface = MeshData & {
  name: 'passage-rock' | 'passage-floor' | 'rope' | 'rope-anchor'; collider: boolean;
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

export function buildSlicePassages(a: PassageAnchors, seed = 0) {
  const rock = new Faces(), floor = new Faces(), rng = new Rng(seed);
  const half = a.halfWidth, clearance = a.height;
  const ring = (middle: Point, top: number, edgeHeight: number, width: number, crown: number, shift=0) =>
    [pt(middle.x-width,middle.y,middle.z),pt(middle.x+width,middle.y,middle.z),
     pt(middle.x+width,edgeHeight,middle.z),pt(middle.x+crown+shift,top,middle.z),
     pt(middle.x-crown+shift,top,middle.z),pt(middle.x-width,edgeHeight,middle.z)];

  function closeMouth(first: Point[]) {
    // Fill the two corners of the host's rectangular opening up to the natural stone arch.
    rock.add([first[3],first[2],pt(first[2].x,first[3].y,first[2].z)]);
    rock.add([first[5],first[4],pt(first[5].x,first[4].y,first[5].z)]);
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
    if(last) lining(last,section,last[0].z<=lip); else closeMouth(section);
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
  closeMouth(denRings[0]);
  for(let i=1;i<denRings.length;i++) lining(denRings[i-1],denRings[i],false);
  rock.add(denRings[denRings.length-1]);

  const rope=createSliceRope(a.ropeLower,a.ropeUpper);
  const cable=ropeDecoration(rope);
  const surfaces:PassageSurface[]=[floor.surface('passage-floor'),rock.surface('passage-rock'),
    {...cable.line,name:'rope',collider:false}, {...cable.anchor,name:'rope-anchor',collider:false}];
  return { surfaces, rope, entrance:{through:lo,den:m},
    routes:{
      through:[pt(lo.x,lo.y,lo.z+2),...throughZ.map(z=>pt(lo.x,uphillFloor(z),z)),pt(hi.x,hi.y,hi.z-1.5)],
      den:[pt(m.x,m.y,m.z+2),pt(m.x,m.y,m.z),pt(b.x,b.y+.09,b.z+1.35)],
    } };
}
