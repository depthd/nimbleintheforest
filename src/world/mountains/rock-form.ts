// A weathered outcrop keeps a family of joints through the whole wall.
// All dimensions here are metres in the mountain's local coordinate system.
import { smoothstep } from '../../core/rng';
import type { Point } from './geometry';

type Face = {
  left: number; right: number; back: number; front: number; bottom: number; top: number;
  tier: { id: string; level: number; kind: string; entry: string; mountainId: string };
  phase: number;
  entrySide?: 'west' | 'east';
  passages?: { denMouth: Point; throughLower: Point; ropeLower: Point; ropeUpper: Point };
};

function taper(distance: number, inner: number, outer: number) {
  return smoothstep(inner, outer, Math.abs(distance));
}

// The mouths, lip, northern footpath and bridge bearings have to meet fixed
// geometry. Only soften the stone outside the protected piece of the seam.
function clearance(s: Face, x: number, z: number) {
  let k = 1;
  if ((s.tier.id === 'main-1' || s.tier.id === 'main-2') && z > (s.front + s.back) / 2) {
    const entrance = s.tier.level === 1 ? s.passages?.denMouth.x ?? 15 : s.passages?.throughLower.x ?? 17;
    k *= taper(x - entrance, 3.1, 8);
    if (s.tier.level === 1) {
      const rope = s.passages?.ropeLower.x ?? -4, exit = s.passages?.throughLower.x ?? 17;
      const distance = Math.max(Math.min(rope,exit)-x, x-Math.max(rope,exit), 0);
      k *= smoothstep(3.5, 8, distance);
    }
  }
  if (s.tier.id === 'main-1' && z < s.back + 12 && x > -64 && x < -8) {
    const shelf = smoothstep(-64,-56,x) * (1 - smoothstep(-14,-8,x));
    k *= 1 - shelf;
  }
  return k;
}

function joint(t: number) {
  // An inclined fracture changes direction abruptly and wears more gradually on one side.
  const a = t - Math.floor(t);
  return a < .62 ? a / .62 : (1 - a) / .38;
}

export function edgeInsets(s: Face, x: number, rounding: number) {
  const width = s.right - s.left, depth = s.front - s.back;
  const u = (x - s.left) / width, p = s.phase;
  const scale = Math.min(1, width / 52, depth / 39);
  // The headlands taper over tens of metres, not just a bevel in the corners.
  const end = Math.pow(Math.abs(2 * u - 1), 3.2);
  const north = scale * (end * (2.2 + 2.0 * Math.sin(p)) + 4 * joint(u * 2.2 + .18 * p) + 1.55 * Math.sin(u * 11 + p));
  const south = scale * (end * (3.4 - 1.6 * Math.cos(p)) + 5 * joint(u * 2.8 + .26 * p) + 2 * Math.cos(u * 9 - p));
  const cornice = s.tier.id === 'main-1' ? 1 - smoothstep(-52,-48,x) * (1 - smoothstep(-10,-6,x)) : 1;
  return {
    back: rounding + north * clearance(s,x,s.back),
    front: rounding + south * clearance(s,x,s.front) * cornice,
  };
}

// Peaks are an asymmetric arête and a secondary shoulder. The long axis and the
// tilt change with the seed. Its entire mass uses the bare rock mesh.
export function peakHeight(s: Face, x: number, z: number) {
  const u = 2 * (x - s.left) / (s.right - s.left) - 1;
  const v = 2 * (z - s.back) / (s.front - s.back) - 1;
  const p = s.phase, skew = .35 * Math.sin(p);
  const a = u + .17 - skew * v, b = v - .15 - .28 * u;
  const summit = 1 - Math.max(Math.abs(a) * .83, Math.abs(b) * 1.29, Math.abs(a + b * .68) * .78);
  const shoulder = .72 - Math.abs(u - .43) * .96 - Math.abs(v + .23 - .32*u) * .58;
  return s.bottom + Math.min(2.2,(s.top-s.bottom)*.21) + (s.top - s.bottom - Math.min(2.2,(s.top-s.bottom)*.21)) *
    Math.max(.01, summit, shoulder);
}

export function rimRelief(s: Face, x: number, z: number) {
  const width = s.right - s.left, depth = s.front - s.back;
  const u = (x - s.left) / width, v = (z - s.back) / depth;
  const fromEdge = Math.min(x - s.left, s.right - x, z - s.back, s.front - z);
  const reach = Math.min(12,depth*.27,width*.17);
  const rim = 1 - smoothstep(1, reach, fromEdge);
  if (!rim) return 0;
  // Long tilted blades of bedrock rise through the snow at the outside of a terrace;
  // depressions between them leave level ground and gaps in the skyline.
  const long = joint(u * 2.65 + v * 1.35 + s.phase * .26);
  const second = joint(u * 3.2 - v * 2.7 - s.phase * .19 + .42);
  const mass = Math.max(0, long * .94 + second * .38 - .44);
  const span = Math.min(s.top-s.bottom, depth*.25);
  const approach = s.entrySide === 'east' ? 1-u : u;
  const uphill = s.tier.entry === 'none' ? 1 : smoothstep(.03,.56,approach);
  // Leave the level bearings and the established cornice profile intact.
  const onFlank = Math.min(x-s.left,s.right-x) < reach;
  const bearing = onFlank ? taper(z - (s.front + s.back)*.5, 4.7, 13.5) : 1;
  const cornice = s.tier.id === 'main-1' && z > s.front - 5
    ? 1-smoothstep(-51,-46,x)*(1-smoothstep(-13,-8,x)) : 1;
  return span * .49 * mass * rim * clearance(s,x,z) * uphill * bearing * cornice;
}

export function cliffPoint(s: Face, edge: Point, level: number) {
  if (level === 1) return edge;
  const halfX = (s.right-s.left)*.5, halfZ=(s.front-s.back)*.5;
  const u = (edge.x-s.left)/halfX-1, v=(edge.z-s.back)/halfZ-1;
  // A shared normal at corners closes the outer apron on all four sides.
  const ax = Math.sign(u)*Math.pow(Math.abs(u),5), az=Math.sign(v)*Math.pow(Math.abs(v),5);
  const len = Math.hypot(ax,az) || 1, nx=ax/len,nz=az/len;
  const h = edge.y-s.bottom;
  const station = edge.x*.089 + edge.z*.106 + s.phase;
  const major = joint(station*.57 + level*.17);
  const crack = joint(station*1.21 + level*.28 + .18*Math.sin(station*.81));
  const ridge = .66*major + .34*crack;
  // Actual recesses between spurs sit behind a wider talus toe. The narrow
  // lips disappear in the recesses instead of forming horizontal rings.
  const rows = [0, .18, .36, .43, .68, .76, .93, 1];
  const i=rows.indexOf(level);
  const shoulder = Math.max(0, (ridge-.27)/.73);
  const dip=Math.sin(station*.55 + s.phase)*.09 + (crack-.5)*.16;
  const relative = i === 0 ? 0 : level + dip * Math.sin(level * Math.PI);
  const amounts = [ .35+.50*ridge, .21+.48*ridge, .10+.39*shoulder, .08+.17*shoulder,
    .035+.31*shoulder, .05+.075*shoulder, .018+.10*shoulder, 0 ];
  const atBearing = Math.abs(u) > .76 ? taper(edge.z - (s.back+s.front)*.5, 4, 11) : 1;
  const extent = Math.min(h*.63,7,halfX*.35,halfZ*.48);
  const reach = extent * amounts[i] * clearance(s,edge.x,edge.z) * atBearing;
  return { x:edge.x+nx*reach, y:s.bottom+h*relative, z:edge.z+nz*reach };
}

export const cliffLevels = [0,.18,.36,.43,.68,.76,.93,1] as const;
