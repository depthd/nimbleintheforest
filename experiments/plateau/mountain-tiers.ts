import { stream } from './range-seed';
import { distanceToAscent } from './mountain-snow';
import { contourPoint, plateauRadius } from './plateau-profile';
import type { MeshData } from './cavity';
import type { PassageShape } from './passage-shape';

export interface Tier {
  name: string;
  parent?: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  depth?: number;
  rise: number;
  seed: number;
  passage?: PassageShape;
}

export function worldPlan(tier: Tier, x: number, z: number) {
  const c = Math.cos(tier.yaw),
    s = Math.sin(tier.yaw);
  const dx=x*tier.width, dz=(tier.passage?.lateral(x,z)??z)*(tier.depth??tier.width);
  return { x: tier.x + dx*c + dz*s, z: tier.z + dz*c - dx*s };
}

export function localPlan(tier: Tier, x: number, z: number) {
  const dx = x - tier.x,
    dz = z - tier.z,
    c = Math.cos(tier.yaw),
    s = Math.sin(tier.yaw);
  const localX=(dx*c-dz*s)/tier.width, localZ=(dz*c+dx*s)/(tier.depth??tier.width);
  return {x:localX,z:tier.passage?.lateral(localX,localZ,true)??localZ};
}

export function seatOnParent(tier:Tier, parent:Tier, roof:(x:number,z:number)=>number) {
  let lowest=Infinity;
  for(let i=0;i<72;i++) for(let j=0;j<=12;j++){
    const p=contourPoint(2*Math.PI*i/72,1.17*j/12);
    const w=worldPlan(tier,p.x,p.z), q=localPlan(parent,w.x,w.z);
    const y=roof(q.x,q.z);
    lowest=Math.min(lowest,parent.passage?.elevation(q.x,y,q.z)??y);
  }
  tier.y=parent.y+parent.rise*lowest-4;
}

export function mountainTiers(stacked: boolean, roof: (x: number, z: number) => number,
  rimAt: (angle: number) => {x: number; z: number}, form = 'range') {
  const rng = stream('tier layout');
  const nextSeed = () => rng.int(0, 0x7fffffff);
  // Scale each vault bank before seating its children on the resulting roof.
  const tierRise=(rise:number,width:number)=>form==='vault'?Math.min(rise*1.30,width*1.48):rise;
  const base: Tier = {
    name: 'lower',
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    width: stacked ? rng.float(1.79, 1.93) : 1,
    rise: form==='vault'?1.30:1,
    seed: nextSeed(),
  };
  const tiers = [base];
  if (!stacked) return tiers;
  // Offsets are expressed on the supporting terrace. Turning the next entrance
  // leaves a snowfield between the exit below and the next climb.
  function addUpper(parent:Tier, spec:{name:string;x:number;z:number;yaw:number;width:number;rise:number;seed:number}){
    const center=worldPlan(parent,spec.x,spec.z);
    const tier={...spec,...center,parent:parent.name,yaw:parent.yaw+spec.yaw,width:parent.width*spec.width,y:0};
    tier.rise=tierRise(tier.rise,tier.width);
    seatOnParent(tier,parent,roof);
    tiers.push(tier);
  }
  for (const spec of [
    { name: 'middle', x: rng.float(108,124), z: rng.float(34,45), yaw: rng.float(.16,.47), width: rng.float(.425,.46), rise: rng.float(.81,.94), seed: nextSeed() },
    { name: 'summit', x: rng.float(88,105), z: rng.float(33,47), yaw: rng.float(-2.8,-2.28), width: rng.float(.40,.46), rise: rng.float(.52,.66), seed: nextSeed() },
  ]) addUpper(tiers[tiers.length-1],spec);
  if (form === 'peak') return tiers;
  const spur: Tier = { name: 'spur', x: 0, y: 0, z: 0, width: rng.float(.95, 1.34),
    rise: rng.float(.93, 1.09), yaw: rng.float(-1.55, 1.55), seed: nextSeed() };
  const facingLip = (tier: Tier, direction: number) => {
    let best = { x: 0, z: -direction * Infinity };
    for (let i = 0; i < 240; i++) {
      const q = rimAt(i * Math.PI / 120), p = worldPlan(tier, q.x, q.z);
      if (direction * p.z > direction * best.z) best = p;
    }
    return best;
  };
  const side = stream('saddle').chance(.5) ? 1 : -1;
  const near = facingLip(base, side), far = facingLip(spur, -side);
  spur.x = near.x - far.x + rng.float(-48, 48);
  spur.z = near.z - far.z + side*rng.float(64, 101);
  if (form === 'vault') {
    const size = rng.float(1.50, 1.80);
    const ratio = size / spur.width;
    spur.x = near.x - far.x*ratio + rng.float(-38,38);
    spur.z = near.z - far.z*ratio + side*rng.float(238,295);
    spur.width = size;
    spur.rise = tierRise(spur.rise,size);
    tiers.push(spur);
    addUpper(spur,{name:'spur-middle',x:rng.float(75,120),z:rng.float(35,46),yaw:rng.float(-.7,.3),
      width:rng.float(.46,.54),rise:rng.float(.78,.94),seed:nextSeed()});
    addUpper(tiers[tiers.length-1],{name:'spur-crest',x:rng.float(88,112),z:rng.float(33,44),yaw:rng.float(-2.8,-1.9),
      width:rng.float(.38,.48),rise:rng.float(.48,.66),seed:nextSeed()});
    return tiers;
  }
  tiers.push(spur);
  if (stream('foothills').chance(.31))
    addUpper(spur,{name:'spur-crest',x:rng.float(104,120),z:rng.float(31,43),yaw:rng.float(-.6,.4),
      width:rng.float(.35,.46),rise:rng.float(.41,.63),seed:nextSeed()});
  return tiers;
}

export function reservedForUpper(tier: Tier, child: Tier | undefined, x: number, z: number, margin: number) {
  if (!child) return false;
  const w = worldPlan(tier, x, z),
    q = localPlan(child, w.x, w.z);
  return plateauRadius(q.x, q.z) < 1.23 + (margin * tier.width) / (160 * child.width);
}

export function supportedSite(tier: Tier, parent: Tier | undefined, x: number, z: number, margin: number) {
  if (!parent) return true;
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI * k) / 4,
      w = worldPlan(tier, x + Math.cos(a) * margin, z + Math.sin(a) * margin);
    const q = localPlan(parent, w.x, w.z);
    if (plateauRadius(q.x, q.z) > 0.975 || distanceToAscent(q) < 2) return false;
  }
  return true;
}

// Only the bottom tier owns the surrounding ground plane. At upper tiers the
// retained apron ends below the supporting snowfield, including at the ramp.
export function raisedFlank(data: MeshData, minimumHeight=2): MeshData {
  const positions: number[] = [],
    indices: number[] = [],
    remap = new Map<number, number>();
  for (let i = 0; i < data.indices.length; i += 3) {
    const a = data.indices[i],
      b = data.indices[i + 1],
      c = data.indices[i + 2];
    if (Math.max(data.positions[a * 3 + 1], data.positions[b * 3 + 1], data.positions[c * 3 + 1]) < minimumHeight)
      continue;
    for (const id of [a, b, c]) {
      let to = remap.get(id);
      if (to === undefined) {
        to = positions.length / 3;
        positions.push(data.positions[id * 3], data.positions[id * 3 + 1], data.positions[id * 3 + 2]);
        remap.set(id, to);
      }
      indices.push(to);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
