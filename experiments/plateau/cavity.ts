// Local convex subtraction, derived from the archived same-scene cave prototype.
export interface MeshData { positions: Float32Array; indices: Uint32Array }
export const den = { back: 270, mouth: 330, floor: 5, halfWidth: 5, roof: 10.5 };
const section = [{z:-5,y:5},{z:5,y:5},{z:5,y:8},{z:3,y:10.5},{z:-3,y:10.5},{z:-5,y:8}];
export type Point = { x: number; y: number; z: number };
export type Plane = { x: number; y: number; z: number; d: number };
const EPS = 2e-6; // source vertices are float32; snap near-coplanar classification only


export const value = (p: Plane, v: Point) => p.x * v.x + p.y * v.y + p.z * v.z + p.d;
export function plane(x: number, y: number, z: number, d: number): Plane { const length = Math.hypot(x, y, z); return { x: x / length, y: y / length, z: z / length, d: d / length }; }
export function flip(p: Plane): Plane { return { x: -p.x, y: -p.y, z: -p.z, d: -p.d }; }
export function clip(polygon: Point[], p: Plane): Point[] {
    const out: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length], rawA = value(p, a), rawB = value(p, b), da = Math.abs(rawA) <= EPS ? 0 : rawA, db = Math.abs(rawB) <= EPS ? 0 : rawB, ia = da <= 0, ib = db <= 0;
        if (ia) out.push(a);
        if (ia !== ib) { const t = da / (da - db); out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) }); }
    }
    return out;
}
export function append(polygon: Point[], positions: number[], indices: number[]) {
    if (polygon.length < 3) return;
    const a = polygon[0];
    for (let i = 1; i + 1 < polygon.length; i++) {
        const b = polygon[i], c = polygon[i + 1], u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
        if (Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x) < 1e-8) continue;
        const start = positions.length / 3;
        for (const p of [a, b, c]) positions.push(p.x, p.y, p.z);
        indices.push(start, start + 1, start + 2);
    }
}

const planes: Plane[] = [plane(-1,0,0,den.back),plane(1,0,0,-den.mouth)];
for(let i=0;i<section.length;i++) {
 const a=section[i], b=section[(i+1)%section.length], dz=b.z-a.z, dy=b.y-a.y;
 planes.push(plane(0,-dz,dy,-dy*a.z+dz*a.y));
}
export function subtract(mesh: MeshData, colors?: number[]) {
 const positions=Array.from(mesh.positions), indices:number[]=[], outColors=colors?.slice();
 let cutTriangles=0;
 for(let i=0;i<mesh.indices.length;i+=3) {
  const ids=Array.from(mesh.indices.subarray(i,i+3));
  const tri=ids.map(k=>({x:mesh.positions[k*3],y:mesh.positions[k*3+1],z:mesh.positions[k*3+2]}));
  if(planes.some(pl=>tri.every(v=>value(pl,v)>EPS))) {indices.push(...ids);continue;}
  let remaining=tri;const outside:Point[][]=[];
  for(const pl of planes) {
   if(remaining.some(v=>value(pl,v)>EPS))outside.push(clip(remaining,flip(pl)));
   remaining=clip(remaining,pl);if(!remaining.length)break;
  }
  if(remaining.length>=3)cutTriangles++;
  for(const poly of outside){const before=positions.length;append(poly,positions,indices);if(outColors)for(let k=before;k<positions.length;k+=3)outColors.push(...colors!.slice(ids[0]*3,ids[0]*3+3));}
 }
 return {positions:new Float32Array(positions),indices:new Uint32Array(indices),colors:outColors,cutTriangles};
}
// Build the cavity's inward-facing boundary only where the original mountain is solid.
export function interior(mesh:MeshData):MeshData {
 const positions:number[]=[],indices:number[]=[],boundary:Point[][]=[];
 const v=(x:number,s:{y:number;z:number})=>({x,y:s.y,z:s.z});
 for(let i=0;i<section.length;i++) {const a=section[i],b=section[(i+1)%section.length];boundary.push([v(den.back,b),v(den.mouth,b),v(den.mouth,a),v(den.back,a)]);}
 boundary.push([...section].reverse().map(s=>v(den.back,s)));
 return boundaryInMountain(mesh,boundary,{minX:den.back,maxX:den.mouth,minZ:-5,maxZ:5});
}
export function boundaryInMountain(mesh:MeshData,boundary:Point[][],bounds:{minX:number;maxX:number;minZ:number;maxZ:number}):MeshData {
 const positions:number[]=[],indices:number[]=[];
 for(let i=0;i<mesh.indices.length;i+=3){
  const tri=Array.from(mesh.indices.subarray(i,i+3)).map(k=>({x:mesh.positions[k*3],y:mesh.positions[k*3+1],z:mesh.positions[k*3+2]}));
  if(Math.max(...tri.map(v=>v.x))<bounds.minX||Math.min(...tri.map(v=>v.x))>bounds.maxX||Math.max(...tri.map(v=>v.z))<bounds.minZ||Math.min(...tri.map(v=>v.z))>bounds.maxZ)continue;
  const prism:Plane[]=[];
  for(let j=0;j<3;j++){const a=tri[j],b=tri[(j+1)%3],c=tri[(j+2)%3];let pl=plane(b.z-a.z,0,a.x-b.x,-(b.z-a.z)*a.x-(a.x-b.x)*a.z);if(value(pl,c)>0)pl=flip(pl);prism.push(pl);}
  const [a,b,c]=tri,ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
  let top=plane(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx,0);if(top.y<0)top=flip(top);top.d=-top.x*a.x-top.y*a.y-top.z*a.z;prism.push(top);
  for(const face of boundary){let part=face;for(const pl of prism)part=clip(part,pl);append(part,positions,indices);}
 }
 return {positions:new Float32Array(positions),indices:new Uint32Array(indices)};
}
