import { Rng, hashString } from '../../core/rng';
import { append, type MeshData, type Point } from './geometry';
import { createMountainRope, ropeDecoration } from './rope';

export interface PassageAnchors {
  throughLower: Point; throughUpper: Point; throughSkylightStartZ: number;
  denMouth: Point; denBack: Point; halfWidth: number; height: number;
  ropeLower: Point; ropeUpper: Point;
}

export type PassageSurface = MeshData & {
  name: 'passage-rock' | 'passage-portal' | 'passage-floor' | 'den-litter' | 'rope' | 'rope-anchor'; collider: boolean;
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
  // The daylight opening follows a dipping fracture. The broad foot and a shoulder at
  // head height turn into a narrow skewed crown, with a different profile on each wall.
  function ring(middle: Point, top: number, width: number, open: boolean, tilt: number) {
    const {x,y,z} = middle, h = top-y;
    if (open) return [pt(x-width,y,z),pt(x+width,y,z),pt(x+width,top,z),
      pt(x+width,top,z),pt(x-width,top,z),pt(x-width,top,z)];
    return [pt(x-width,y,z), pt(x+width,y,z),
      pt(x+width*rng.float(.80,.99), y+h*rng.float(.38,.58),z),
      pt(x+width*rng.float(.16,.36)+tilt,top-h*.15,z),
      pt(x-width*rng.float(.34,.60)+tilt,top,z),
      pt(x-width*rng.float(.66,.92),y+h*rng.float(.58,.78),z)];
  }
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
    const top = Math.max(section[3].y,section[4].y);
    const left = section[0].x, right = section[1].x, z = section[0].z;
    const corners = [section[0],section[1],pt(right,top,z),pt(section[3].x,top,z),
      pt(section[4].x,top,z),pt(left,top,z)];
    for (let i = 1; i < section.length; i++) {
      const j = (i+1)%section.length;
      portal.add([section[i],section[j],corners[j],corners[i]]);
    }
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
    const top=open?hi.y:Math.min(hi.y,y+clearance);
    const bend = open ? 0 : Math.sin(Math.PI*(lo.z-z)/(lo.z-lip)) * .62;
    const section=ring(pt(lo.x+bend,y,z),top,width,open,-.27);
    if(last) lining(last,section,last[0].z<=lip); else frameMouth(section);
    last=section;
  }

  const m=a.denMouth,b=a.denBack;
  const bearDen = new Rng(seed ^ hashString('winter-den')).chance(.25);
  const denRings=[0,.22,.47,.72,1].map(t=>{
    const z=m.z+(b.z-m.z)*t;
    // The ground plane also exists under the den. Expose one floor, gently raised inside.
    const bow = Math.sin(Math.PI*t);
    const y=m.y+.09*Math.min(1,t/.22), width=half*(1+bow*(bearDen?.38:.12));
    const top=t===0 ? m.y+clearance : y+clearance*(bearDen?rng.float(.67,.82):rng.float(.77,.95));
    return ring(pt(m.x+bow*(bearDen ? -.82 : .66),y,z),top,width,false,.33);
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
  if (bearDen) {
    // Compressed grass, shed bark and twigs collect on one side of an unused winter bed.
    const straw = new Faces();
    const dry = new Rng(seed ^ hashString('den-bedding'));
    for (let i=0; i<160; i++) {
      const angle=dry.float(0,Math.PI*2), r=Math.sqrt(dry.next());
      const x=b.x-.55+Math.cos(angle)*r*1.25, z=b.z+2.9+Math.sin(angle)*r*1.5;
      const y=b.y+.102+.075*(1-r)+dry.float(0,.026);
      const direction=angle+dry.float(-.8,.8), dx=.24*Math.cos(direction), dz=.24*Math.sin(direction);
      const w=dry.float(.08,.23);
      straw.add([pt(x-dx,y,z-dz),pt(x-dz*w,y+.028,z+dx*w),pt(x+dx,y+.012,z+dz)]);
    }
    surfaces.push({...straw.surface('den-litter'),collider:false});
  }
  return { surfaces, rope, bearDen, entrance:{through:lo,den:m},
    routes:{
      through:[pt(lo.x,lo.y,lo.z+2),...throughZ.map(z=>pt(lo.x,uphillFloor(z),z)),pt(hi.x,hi.y,hi.z-1.5)],
      den:[pt(m.x,m.y,m.z+2),pt(m.x,m.y,m.z),pt(b.x,b.y+.09,b.z+1.35)],
    } };
}
