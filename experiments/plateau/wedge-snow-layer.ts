import { type Point, type MeshData } from './cavity';
import { type Boundary, type SourceGrid, sampleGrid } from './seam-boundary';
import { contourPoint, contourTangent } from './plateau-profile';
import { smoothstep } from '../../src/core/rng';
export interface SnowMesh extends MeshData { normals: Float32Array }
export const snowSettings = { centerAngle: .7, normalRadius: 2, length: 64, inside: 5, plateau: .8, edge: 2.5, overhang: 2, radius: 2, minThickness: .15, slopeStart: 50, slopeEnd: 60, alongStep: .3, capStep: .2, maxStep: .5, embed: .02 };
export type SnowSettings = typeof snowSettings;
const TAU = 2 * Math.PI;
const add = (a: Point, b: Point, t = 1): Point => ({ x: a.x + t * b.x, y: a.y + t * b.y, z: a.z + t * b.z });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const unit = (p: Point): Point => { const l = Math.hypot(p.x, p.y, p.z); return l > 1e-12 ? { x: p.x / l, y: p.y / l, z: p.z / l } : { x: 0, y: 1, z: 0 }; };
const cross = (a: Point, b: Point): Point => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const lerp = (a: Point, b: Point, t: number) => add(a, sub(b, a), t);
const canonical = (p: Point): Point => ({ x: Math.fround(p.x), y: Math.fround(p.y), z: Math.fround(p.z) });
function locate(values: number[], value: number) { let lo = 0, hi = values.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (values[m] <= value) lo = m; else hi = m; } return lo; }
const boundaryAngles = new WeakMap<Boundary, number[]>();
export function ringPoint(boundary: Boundary, a: number): Point {
  let aa = boundaryAngles.get(boundary); if (!aa) { aa = [...boundary.angles, boundary.angles[0] + TAU]; boundaryAngles.set(boundary, aa); }
  const angle = a < aa[0] ? a + TAU : a;
  const i = locate(aa, angle), p = boundary.points[i], q = boundary.points[(i + 1) % boundary.points.length], ray = contourPoint(a, 1);
  const cr = (x: number, z: number) => x * ray.z - z * ray.x;
  const t = Math.max(0, Math.min(1, -cr(p.x, p.z) / cr(q.x - p.x, q.z - p.z)));
  return lerp(p, q, t);
}
// Adapter only: include the rim's existing knots; never change its meshes.
export function snowEdgeBoundary(reference: Boundary, deform?: (p: Point) => Point, knots: Point[] = [], renderedTop?: MeshData): Boundary {
  const angle = (p: Point) => (Math.atan2(p.z / 180, p.x / 260) + TAU) % TAU;
  const values = [...reference.angles, ...knots.map(angle)].sort((a, b) => a - b).filter((a, i, all) => !i || a - all[i - 1] > 1e-9);
  const points = values.map(a => canonical(deform ? deform(ringPoint(reference, a)) : ringPoint(reference, a)));
  const ordered = points.map(p => ({ p, a: angle(p) })).sort((a, b) => a.a - b.a);
  const approximate = { points: ordered.map(v => v.p), angles: ordered.map(v => v.a), radius: reference.radius, sourceTriangles: [] };
  if (!renderedTop) return approximate;
  // Read the existing top boundary vertices, including every triangle split.
  // In arcs, deforming only the old ring/knots misses small linear subsegments.
  const edges = new Map<string, [Point, Point]>(), key = (p: Point) => [p.x,p.y,p.z].join(',');
  for (let k = 0; k < renderedTop.indices.length; k += 3) {
    const tri = Array.from(renderedTop.indices.subarray(k,k+3), id => ({x:renderedTop.positions[id*3],y:renderedTop.positions[id*3+1],z:renderedTop.positions[id*3+2]}));
    for (let i = 0; i < 3; i++) { const a=tri[i],b=tri[(i+1)%3],id=[key(a),key(b)].sort().join('|'); if(edges.has(id))edges.delete(id);else edges.set(id,[a,b]); }
  }
  const boundary = new Map<string,Point>();
  for (const pair of edges.values()) {
    if (!pair.every(p => { const q=ringPoint(approximate,angle(p));return Math.hypot(q.x-p.x,q.z-p.z)<.05; })) continue;
    for (const p of pair) boundary.set(key(p),p);
  }
  const actual = [...boundary.values()].map(p=>({p,a:angle(p)})).sort((a,b)=>a.a-b.a).filter((v,i,all)=>!i||v.a-all[i-1].a>1e-10);
  if (actual.length<3) throw Error('No rendered rim boundary found');
  return { points: actual.map(v=>v.p), angles:actual.map(v=>v.a), radius:reference.radius, sourceTriangles:[] };
}
// Exact height/contact queries on the rendered top. No stone buffers are modified.
export function snowStoneSurface(meshes: MeshData[]) {
  type Face = { p: Point[]; height: (x: number, z: number) => number; bary: (x: number, z: number) => number[] };
  const bins = new Map<string, Face[]>(), cell = 4;
  const cross2 = (a: Point, b: Point, p: Point) => (b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
  for (const mesh of meshes) for (let k=0;k<mesh.indices.length;k+=3) {
    const p=Array.from(mesh.indices.subarray(k,k+3),id=>({x:mesh.positions[id*3],y:mesh.positions[id*3+1],z:mesh.positions[id*3+2]}));
    const [a,b,c]=p,den=cross2(a,b,c);if(Math.abs(den)<1e-10)continue;
    const bary=(x:number,z:number)=>{const q={x,y:0,z},u=cross2(a,q,c)/den,v=cross2(a,b,q)/den;return [1-u-v,u,v];};
    const face={p,bary,height:(x:number,z:number)=>bary(x,z).reduce((v,w,i)=>v+w*p[i].y,0)};
    for(let x=Math.floor(Math.min(...p.map(q=>q.x))/cell);x<=Math.floor(Math.max(...p.map(q=>q.x))/cell);x++)for(let z=Math.floor(Math.min(...p.map(q=>q.z))/cell);z<=Math.floor(Math.max(...p.map(q=>q.z))/cell);z++){const key=x+','+z;if(!bins.has(key))bins.set(key,[]);bins.get(key)!.push(face);}
  }
  function candidates(p: Point[]) {const out=new Set<Face>();for(let x=Math.floor(Math.min(...p.map(q=>q.x))/cell);x<=Math.floor(Math.max(...p.map(q=>q.x))/cell);x++)for(let z=Math.floor(Math.min(...p.map(q=>q.z))/cell);z<=Math.floor(Math.max(...p.map(q=>q.z))/cell);z++)for(const f of bins.get(x+','+z)||[])out.add(f);return [...out];}
  const vertices = new Map<string,number>();for(const mesh of meshes)for(const id of mesh.indices)vertices.set(mesh.positions[id*3]+','+mesh.positions[id*3+2],mesh.positions[id*3+1]);
  function height(x:number,z:number) {
    const exact=vertices.get(x+','+z);if(exact!==undefined)return exact;
    let h:number|undefined,closest=Infinity,near:number|undefined;
    for(const f of bins.get(Math.floor(x/cell)+','+Math.floor(z/cell))||[]){
      if(!f.bary(x,z).some(v=>v< -2e-7)){const y=f.height(x,z);if(h===undefined||y>h)h=y;continue;}
      for(let i=0;i<3;i++){const a=f.p[i],b=f.p[(i+1)%3],dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz;if(l<1e-18)continue;const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/l)),d=Math.hypot(x-a.x-t*dx,z-a.z-t*dz);if(d<closest){closest=d;near=f.height(x,z);}}
    }return h!==undefined?h:closest<.00005?near:undefined;
  }
  function requireHeight(x:number,z:number){const h=height(x,z);if(h===undefined)throw Error('Snow contact outside actual stone at '+x+','+z);return h;}
  function splitLine(a:Point,b:Point,embed:number) {
    const cuts=[0,1],dx=b.x-a.x,dz=b.z-a.z;
    for(const f of candidates([a,b]))for(let i=0;i<3;i++){const p=f.p[i],q=f.p[(i+1)%3],ex=q.x-p.x,ez=q.z-p.z,den=dx*ez-dz*ex;if(Math.abs(den)<1e-12)continue;const t=((p.x-a.x)*ez-(p.z-a.z)*ex)/den,u=((p.x-a.x)*dz-(p.z-a.z)*dx)/den;if(t>1e-8&&t<1-1e-8&&u>=-1e-7&&u<=1+1e-7)cuts.push(t);}
    return cuts.sort((a,b)=>a-b).filter((v,i,all)=>!i||v-all[i-1]>1e-7).map(t=>{const x=a.x+dx*t,z=a.z+dz*t;return canonical({x,y:requireHeight(x,z)-embed,z});});
  }
  function projectTriangle(triangle:Point[],embed:number) {
    const polys:Point[][]=[];
    for(const f of candidates(triangle)){let poly=triangle;
      for(let i=0;i<3;i++){const a=f.p[i],b=f.p[(i+1)%3],sign=Math.sign(cross2(f.p[0],f.p[1],f.p[2]));const next:Point[]=[];
        for(let j=0;j<poly.length;j++){const p=poly[j],q=poly[(j+1)%poly.length],dp=sign*cross2(a,b,p),dq=sign*cross2(a,b,q);if(dp>=-1e-9)next.push(p);if((dp>0&&dq<0)||(dp<0&&dq>0))next.push(lerp(p,q,dp/(dp-dq)));}poly=next;if(poly.length<3)break;}
      if(poly.length>=3)polys.push(poly.map(p=>canonical({x:p.x,y:f.height(p.x,p.z)-embed,z:p.z})));
    }return polys;
  }
  return {height,requireHeight,splitLine,projectTriangle};
}
// Probe controls only sampling/domain, never repairs support heights, gaps or passage folds.
export interface SnowProbe {
  angleLimits?: [number, number]; recordSamplingFailure?: boolean; stone?: ReturnType<typeof snowStoneSurface>;
  // Extend the domain without resampling the established centre or changing its shading.
  samplingAnchor?: { angles: number[]; vRows: number[]; seamRow: number; capDivisions: number };
}
// A shared 2 m derivative field avoids folding a normal-offset layer over 4 m rock facets.
// It changes snow placement / optional upper normals only; the stone vertices stay fixed.
export function upperNormal(upper: SourceGrid, x: number, z: number, radius = snowSettings.normalRadius): Point {
  const h = (x: number, z: number) => sampleGrid(upper, x, z).y, d = radius;
  return unit({ x: -(h(x + d, z) - h(x - d, z)) / (2 * d), y: 1, z: -(h(x, z + d) - h(x, z - d)) / (2 * d) });
}
export function snowThickness(v: number, normal: Point, settings = snowSettings) {
  const slope = Math.acos(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI;
  const factor = 1 - smoothstep(settings.slopeStart, settings.slopeEnd, slope);
  if (factor <= 0 || normal.y <= 0) return 0;
  const nominal = settings.plateau + (settings.edge - settings.plateau) * smoothstep(.55, 1, v);
  return Math.max(settings.minThickness, nominal * factor);
}
export function buildSnowLayer(upper: SourceGrid, seam: Boundary, nose: Boundary, rounded: boolean, settings: SnowSettings = snowSettings, probe: SnowProbe = {}) {
  const edgeCache = new Map<number, Point>(), seamCache = new Map<number, Point>(), planCache = new Map<number, Point>();
  const edge = (a: number) => { let p = edgeCache.get(a); if (!p) { p = ringPoint(nose, a); edgeCache.set(a, p); } return p; };
  const atE = (a: number) => { let p = seamCache.get(a); if (!p) { p = ringPoint(seam, a); seamCache.set(a, p); } return p; };
  const planStations=[0];for(let i=1;i<=nose.points.length;i++){const p=nose.points[i-1],q=nose.points[i%nose.points.length];planStations.push(planStations[i-1]+Math.hypot(q.x-p.x,q.z-p.z));}
  const planPoint=(s:number)=>{const total=planStations[planStations.length-1];s=(s%total+total)%total;const i=locate(planStations,s);return lerp(nose.points[i],nose.points[(i+1)%nose.points.length],(s-planStations[i])/(planStations[i+1]-planStations[i]));};
  const planNormal = (a: number) => { let n=planCache.get(a);if(!n){
    if(probe.stone){const aa=[...nose.angles,nose.angles[0]+TAU],u=a<aa[0]?a+TAU:a,i=locate(aa,u),p=edge(a),s=planStations[i]+Math.hypot(p.x-nose.points[i].x,p.z-nose.points[i].z),lo=planPoint(s-settings.normalRadius),hi=planPoint(s+settings.normalRadius);n=unit({x:hi.z-lo.z,y:0,z:lo.x-hi.x});}
    else {const t=contourTangent(a,nose.radius);n=unit({x:t.z,y:0,z:-t.x});}planCache.set(a,n);
  }return n;};
  function base(a: number, v: number): Point {
    const e = atE(a), n = edge(a), radial = unit({ x: n.x - e.x, y: 0, z: n.z - e.z });
    let p: Point;
    if (v < 0) p = add(e, radial, settings.inside * v);
    else {
      const length = Math.hypot(n.x - e.x, n.z - e.z), p1 = lerp(e, n, 1 / 3), p2 = add(n, planNormal(a), -length / 3);
      p = lerp(lerp(lerp(e, p1, v), lerp(p1, p2, v), v), lerp(lerp(p1, p2, v), lerp(p2, n, v), v), v);
    }
    return { x:p.x,y:probe.stone && v>0 ? (v===1?n.y:probe.stone.requireHeight(p.x,p.z)) : sampleGrid(upper,p.x,p.z).y,z:p.z };
  }
  function top(a: number, v: number) {
    const p = base(a, v), normal = upperNormal(upper, p.x, p.z, settings.normalRadius), thickness = snowThickness(v, normal, settings);
    if (!thickness) return { p: canonical(p), thickness, lift: 0 };
    const blend = smoothstep(.78, 1, v), vertical = probe.stone ? smoothstep(.25,.45,v) : blend, direction = unit(lerp(normal, { x: 0, y: 1, z: 0 }, vertical));
    const n = edge(a), supportY = p.y + blend * (n.y - p.y);
    const q = add({ ...p, y: supportY }, direction, thickness), floor = (probe.stone && v>0 ? probe.stone.requireHeight(q.x,q.z) : sampleGrid(upper,q.x,q.z).y) + settings.minThickness;
    const lift = Math.max(0, floor - q.y); q.y += lift;
    return { p: canonical(q), thickness, lift };
  }
  function normal(a: number, v: number) {
    const speed=contourTangent(a,nose.radius),da=probe.stone?settings.normalRadius/Math.hypot(speed.x,speed.z):.0001,span=Math.hypot(edge(a).x-atE(a).x,edge(a).z-atE(a).z),dv=probe.stone?settings.normalRadius/Math.max(span,settings.inside):.001,lo=Math.max(-1,v-dv),hi=Math.min(1,v+dv);
    const n = unit(cross(sub(top(a + da, v).p, top(a - da, v).p), sub(top(a, hi).p, top(a, lo).p)));
    return canonical(n.y < 0 ? { x: -n.x, y: -n.y, z: -n.z } : n);
  }
  let capDivisions = probe.samplingAnchor?.capDivisions ?? 1;
  function profile(a: number, curve = rounded) {
    const n = edge(a), direction = planNormal(a), t = top(a, 1), height = t.p.y - n.y;
    const points: Point[] = [t.p], under: boolean[] = [false];
    const push = (x: number, y: number, underside: boolean) => { points.push(canonical(add({ ...n, y: n.y + y }, direction, x))); under.push(underside); };
    const line = (x0: number, y0: number, x1: number, y1: number, count: number, underside: boolean) => { count *= capDivisions; for (let k = 1; k <= count; k++) { const u = k / count; push(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, underside); } };
    if (!t.thickness) {
      const count = (curve ? 41 : 36) * capDivisions; for (let k = 1; k <= count; k++) { points.push(canonical(n)); under.push(k > count / 2); }
      return { points, under };
    }
    if (!curve) {
      line(0, height, settings.overhang, height, 10, false);
      line(settings.overhang, height, settings.overhang, 0, 16, false);
      line(settings.overhang, 0, 0, -settings.embed, 10, true);
    } else {
      const radius = Math.min(settings.radius, settings.overhang, Math.max(.01, height - settings.minThickness));
      const bottomRadius = Math.max(.01, Math.min(height - radius, settings.overhang / 4));
      line(0, height, settings.overhang - radius, height, 1, false);
      for (let k = 1; k <= 16 * capDivisions; k++) { const theta = k / (16 * capDivisions) * Math.PI / 2; push(settings.overhang - radius + radius * Math.sin(theta), height - radius + radius * Math.cos(theta), false); }
      line(settings.overhang, height - radius, settings.overhang, bottomRadius, 8, false);
      for (let k = 1; k <= 6 * capDivisions; k++) { const theta = k / (6 * capDivisions) * Math.PI / 2; push(settings.overhang - bottomRadius + bottomRadius * Math.cos(theta), bottomRadius - bottomRadius * Math.sin(theta), true); }
      line(settings.overhang - bottomRadius, 0, 0, -settings.embed, 10, true);
    }
    return { points, under };
  }
  // Arc distance on the actual rock edge, not a frozen list of sample points.
  const cumulative = [0], closed = [...nose.points, nose.points[0]], aa = [...nose.angles, nose.angles[0] + TAU];
  for (let i = 1; i < closed.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(...Object.values(sub(closed[i], closed[i - 1]))));
  const centerI = locate(aa, settings.centerAngle), centerT = (settings.centerAngle - aa[centerI]) / (aa[centerI + 1] - aa[centerI]);
  const centerS = cumulative[centerI] + centerT * (cumulative[centerI + 1] - cumulative[centerI]);
  const angleAt = (s: number) => { const i = locate(cumulative, s), p = lerp(closed[i], closed[i + 1], (s - cumulative[i]) / (cumulative[i + 1] - cumulative[i])); return (Math.atan2(p.z / 180, p.x / 260) + TAU) % TAU; };
  let alongStep = settings.alongStep, innerRows = probe.samplingAnchor?.seamRow ?? 24, outerRows = 160;
  let extensionCrossDivisions = 1;
  let angles: number[] = [], columns: ReturnType<typeof top>[][] = [], profiles: ReturnType<typeof profile>[] = [], vRows: number[] = [];
  const anchor = probe.samplingAnchor;
  const centralSpan = (i: number) => !anchor || (angles[i] >= anchor.angles[0] && angles[i + 1] <= anchor.angles[anchor.angles.length - 1]);
  const anchorBoundary = (a: number) => anchor && (a === anchor.angles[0] || a === anchor.angles[anchor.angles.length - 1]);
  function crossPoint(a: number, j: number, t: number) {
    const v = vRows[j] + (vRows[j + 1] - vRows[j]) * t;
    // New fine vertices meet the unchanged coarse boundary along its actual edges.
    return anchorBoundary(a) ? lerp(top(a, vRows[j]).p, top(a, vRows[j + 1]).p, t) : top(a, v).p;
  }
  let maxAlong = 0, maxAcross = 0, maxCap = 0;
  let refinedAngles: number[] | undefined, samplingConverged = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const lo = probe.angleLimits?.[0] ?? angleAt(centerS - settings.length / 2), hi = probe.angleLimits?.[1] ?? angleAt(centerS + settings.length / 2), values = [lo, hi, settings.centerAngle];
    const count = Math.ceil(settings.length / alongStep);
    for (let k = 1; k < count; k++) values.push(angleAt(centerS - settings.length / 2 + settings.length * k / count));
    values.push(...seam.angles.filter(a => a > lo && a < hi), ...nose.angles.filter(a => a > lo && a < hi));
    if (anchor) {
      const first = anchor.angles[0], last = anchor.angles[anchor.angles.length - 1];
      for (let k = values.length - 1; k >= 0; k--) if (values[k] >= first && values[k] <= last) values.splice(k, 1);
      values.push(...anchor.angles);
    }
    angles = refinedAngles ?? [...new Set(values.filter(a => a >= lo && a <= hi))].sort((a, b) => a - b);
    vRows = anchor ? [...anchor.vRows] : Array.from({ length: innerRows }, (_, k) => -1 + k / innerRows).concat(Array.from({ length: outerRows + 1 }, (_, k) => k / outerRows));
    columns = angles.map(a => vRows.map(v => top(a, v))); profiles = angles.map(a => profile(a));
    const otherProfiles = angles.map(a => profile(a, !rounded));
    maxAlong = maxAcross = maxCap = 0;
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    for (let i = 0; i < angles.length; i++) {
      for (let j = 0; j < vRows.length; j++) {
        if (i) maxAlong = Math.max(maxAlong, distance(columns[i][j].p, columns[i - 1][j].p));
        if (j) {
          const fine = anchor && (angles[i] < anchor.angles[0] || angles[i] > anchor.angles[anchor.angles.length - 1]);
          const count = fine ? extensionCrossDivisions : 1;
          for (let k = 0; k < count; k++) maxAcross = Math.max(maxAcross, distance(crossPoint(angles[i], j - 1, k / count), crossPoint(angles[i], j - 1, (k + 1) / count)));
        }
      }
      for (const pp of [profiles, otherProfiles]) for (let j = 0; j < pp[i].points.length; j++) { if (i) maxAlong = Math.max(maxAlong, distance(pp[i].points[j], pp[i - 1].points[j])); if (j) maxCap = Math.max(maxCap, distance(pp[i].points[j], pp[i].points[j - 1])); }
    }
    if (maxAlong <= settings.maxStep && maxAcross <= settings.maxStep && maxCap <= settings.maxStep) { samplingConverged = true; break; }
    if (maxAlong > settings.maxStep) {
      const inserts: number[] = [];
      for (let i = 1; i < angles.length; i++) {
        let length = 0;
        for (let j = 0; j < vRows.length; j++) length = Math.max(length, distance(columns[i][j].p, columns[i - 1][j].p));
        for (const pp of [profiles, otherProfiles]) for (let j = 0; j < pp[i].points.length; j++) length = Math.max(length, distance(pp[i].points[j], pp[i - 1].points[j]));
        if (length > settings.maxStep) inserts.push((angles[i - 1] + angles[i]) / 2);
      }
      refinedAngles = [...angles, ...inserts].sort((a, b) => a - b);
    }
    if (anchor && maxCap > settings.maxStep) throw Error('Extension requires different cap sampling; preserve the reference and review before rebuilding it');
    if (maxAcross > settings.maxStep) { if (anchor) extensionCrossDivisions *= 2; else { innerRows *= 2; outerRows *= 2; } }
    if (maxCap > settings.maxStep) capDivisions *= 2;
    if (attempt === 11 && !probe.recordSamplingFailure) throw Error('Snow sampling failed to converge');
  }
  const storage = () => ({ p: [] as number[], n: [] as number[], i: [] as number[] });
  const inner = storage(), outer = storage(), bottom = storage(), cap = storage(), capBottom = storage(), closures = storage();
  function emit(out: ReturnType<typeof storage>, points: Point[], normals: Point[]) {
    const d = cross(sub(points[1], points[0]), sub(points[2], points[0])); if (Math.hypot(d.x, d.y, d.z) < 1e-8) return;
    const start = out.p.length / 3; points.forEach((p, k) => { out.p.push(p.x, p.y, p.z); out.n.push(normals[k].x, normals[k].y, normals[k].z); }); out.i.push(start, start + 1, start + 2);
  }
  const Ns = angles.map(a => vRows.map(v => normal(a, v)));
  const bottoms = angles.map((a, i) => vRows.map((v, j) => { const p = base(a, v); return canonical({ ...p, y: p.y - (columns[i][j].thickness ? settings.embed : 0) }); }));
  function quad(out: ReturnType<typeof storage>, p: Point[], n: Point[], reverse = false) { for (const ids of [[0, 1, 2], [1, 3, 2]]) { if (reverse) ids.reverse(); emit(out, ids.map(i => p[i]), ids.map(i => n[i])); } }
  for (let i = 0; i < angles.length - 1; i++) for (let j = 0; j < vRows.length - 1; j++) {
    if ([columns[i][j], columns[i + 1][j], columns[i][j + 1], columns[i + 1][j + 1]].every(p => !p.thickness)) continue;
    if (!centralSpan(i) && extensionCrossDivisions > 1) {
      const sample = (ii: number, t: number) => {
        const a = angles[ii], v = vRows[j] + (vRows[j + 1] - vRows[j]) * t, b = base(a, v);
        return { p: canonical(crossPoint(a, j, t)), n: anchorBoundary(a) ? lerp(Ns[ii][j], Ns[ii][j + 1], t) : normal(a, v),
          b: anchorBoundary(a) ? canonical(lerp(bottoms[ii][j], bottoms[ii][j + 1], t)) : canonical({ ...b, y: b.y - (top(a, v).thickness ? settings.embed : 0) }) };
      };
      for (let k = 0; k < extensionCrossDivisions; k++) {
        const q = [sample(i, k / extensionCrossDivisions), sample(i + 1, k / extensionCrossDivisions), sample(i, (k + 1) / extensionCrossDivisions), sample(i + 1, (k + 1) / extensionCrossDivisions)];
        quad(j < innerRows ? inner : outer, q.map(q => q.p), q.map(q => q.n));
        quad(bottom, q.map(q => q.b), q.map(() => ({ x: 0, y: -1, z: 0 })), true);
      }
      continue;
    }
    const p = [columns[i][j].p, columns[i + 1][j].p, columns[i][j + 1].p, columns[i + 1][j + 1].p], n = [Ns[i][j], Ns[i + 1][j], Ns[i][j + 1], Ns[i + 1][j + 1]];
    quad(j < innerRows ? inner : outer, p, n);
    const bp=[bottoms[i][j],bottoms[i+1][j],bottoms[i][j+1],bottoms[i+1][j+1]];
    if(probe.stone){for(const ids of [[0,2,1],[1,2,3]])for(const poly of probe.stone.projectTriangle(ids.map(k=>bp[k]),settings.embed))for(let k=1;k+1<poly.length;k++)emit(bottom,[poly[0],poly[k],poly[k+1]],Array(3).fill({x:0,y:-1,z:0}));}
    else quad(bottom,bp,p.map(()=>({x:0,y:-1,z:0})),true);
  }
  function capNormal(i: number, j: number) {
    if (j === 0) return Ns[i][Ns[i].length - 1];
    const anchor = probe.samplingAnchor, inside = anchor && angles[i] >= anchor.angles[0] && angles[i] <= anchor.angles[anchor.angles.length - 1];
    const first = inside ? angles.indexOf(anchor.angles[0]) : 0, last = inside ? angles.indexOf(anchor.angles[anchor.angles.length - 1]) : angles.length - 1;
    const row = profiles[i].points, lo = Math.max(first, i - 1), hi = Math.min(last, i + 1);
    let before = j - 1, after = Math.min(row.length - 1, j + 1);
    while (before > 0 && Math.hypot(...Object.values(sub(row[j], row[before]))) < 1e-7) before--;
    while (after < row.length - 1 && Math.hypot(...Object.values(sub(row[after], row[j]))) < 1e-7) after++;
    if(probe.stone){const t=contourTangent(angles[i],nose.radius),da=settings.normalRadius/Math.hypot(t.x,t.z);return unit(cross(sub(profile(angles[i]+da).points[j],profile(angles[i]-da).points[j]),sub(row[after],row[before])));}
    return unit(cross(sub(profiles[hi].points[j], profiles[lo].points[j]), sub(row[after], row[before])));
  }
  for (let i = 0; i < angles.length - 1; i++) for (let j = 0; j < profiles[i].points.length - 1; j++) {
    const p = [profiles[i].points[j], profiles[i + 1].points[j], profiles[i].points[j + 1], profiles[i + 1].points[j + 1]], n = [capNormal(i, j), capNormal(i + 1, j), capNormal(i, j + 1), capNormal(i + 1, j + 1)];
    quad(cap, p, n); if (profiles[i].under[j + 1]) quad(capBottom, p, n);
  }
  function closePolygon(poly:Point[],reverse=false){const center=poly.reduce((p,q)=>add(p,q,1/poly.length),{x:0,y:0,z:0});for(let k=0;k<poly.length;k++){let tri=[center,poly[k],poly[(k+1)%poly.length]];if(reverse)tri=tri.reverse();const n=unit(cross(sub(tri[1],tri[0]),sub(tri[2],tri[0])));emit(closures,tri,[n,n,n]);}}
  for (let i=0;i<angles.length-1;i++) {
    if(probe.stone)closePolygon([...probe.stone.splitLine(bottoms[i][0],bottoms[i+1][0],settings.embed),columns[i+1][0].p,columns[i][0].p]);
    else quad(closures,[bottoms[i][0],bottoms[i+1][0],columns[i][0].p,columns[i+1][0].p],Array(4).fill({x:0,y:0,z:1}));
  }
  for (const i of [0, angles.length - 1]) {
    const contact:Point[]=[]; if(probe.stone){for(let j=bottoms[i].length-1;j>0;j--)contact.push(...probe.stone.splitLine(bottoms[i][j],bottoms[i][j-1],settings.embed).slice(0,-1));contact.push(bottoms[i][0]);}
    const endTop:Point[] = [], endBottom:Point[] = [];
    if (anchor) {
      for (let j = 0; j + 1 < vRows.length; j++) for (let k = 0; k < extensionCrossDivisions; k++) {
        const t = k / extensionCrossDivisions, v = vRows[j] + (vRows[j + 1] - vRows[j]) * t, p = base(angles[i], v);
        endTop.push(canonical(crossPoint(angles[i], j, t))); endBottom.push(canonical({ ...p, y: p.y - (top(angles[i], v).thickness ? settings.embed : 0) }));
      }
      endTop.push(columns[i][columns[i].length - 1].p);
    }
    const poly = [...(anchor ? endTop : columns[i].map(v => v.p)), ...profiles[i].points.slice(1), ...(anchor ? endBottom.reverse() : probe.stone?contact.slice(1):bottoms[i].slice(0,-1).reverse())];
    const center = poly.reduce((p, q) => add(p, q, 1 / poly.length), { x: 0, y: 0, z: 0 });
    for (let k = 0; k < poly.length; k++) { let tri = [center, poly[k], poly[(k + 1) % poly.length]]; if (i === angles.length - 1) tri = tri.reverse(); const n = unit(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))); emit(closures, tri, [n, n, n]); }
  }
  const pack = (s: ReturnType<typeof storage>): SnowMesh => ({ positions: new Float32Array(s.p), normals: new Float32Array(s.n), indices: new Uint32Array(s.i) });
  return { inner: pack(inner), outer: pack(outer), bottom: pack(bottom), cap: pack(cap), capBottom: pack(capBottom), closures: pack(closures), settings, rounded, angles, vRows, seamRow: innerRows, capDivisions, extensionCrossDivisions, columns, normals: Ns, profiles, base, top, normal, edge, planNormal,
    stats: { samplingConverged, maxAlongM: maxAlong, maxAcrossM: maxAcross, maxCapM: maxCap, alongSamples: angles.length, crossSamples: vRows.length, minThicknessM: columns.flat().reduce((v, p) => p.thickness > 0 ? Math.min(v, p.thickness) : v, Infinity), bareVertices: columns.flat().filter(p => !p.thickness).length, maxSupportLiftM: columns.flat().reduce((v, p) => Math.max(v, p.lift), 0) } };
}
