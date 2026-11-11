import { type MeshData, type Point, type Plane, plane, clip, flip, value, append, boundaryInMountain } from './cavity';

// Open-top excavation: the rise is removed from the existing mountain.
// Neither the floor nor the side walls extend outside its original solid.
export const ascent = { start: -300, end: 20, z: -50, halfWidth: 9, rise: 103 };
export const profile = Array.from({length: 15},(_,i)=>{
  const t=i/14;
  return {x:ascent.start+(ascent.end-ascent.start)*t,y:ascent.rise*t*t};
});
const minZ=ascent.z-ascent.halfWidth,maxZ=ascent.z+ascent.halfWidth;
const volumes:Plane[][]=[];
const boundary:Point[][]=[];
for(let i=1;i<profile.length;i++) {
  const a=profile[i-1],b=profile[i],grade=(b.y-a.y)/(b.x-a.x);
  volumes.push([plane(-1,0,0,a.x),plane(1,0,0,-b.x),plane(0,0,-1,minZ),plane(0,0,1,-maxZ),plane(grade,-1,0,a.y-grade*a.x)]);
  boundary.push([{x:a.x,y:a.y,z:minZ},{x:a.x,y:a.y,z:maxZ},{x:b.x,y:b.y,z:maxZ},{x:b.x,y:b.y,z:minZ}]);
  boundary.push([{x:a.x,y:a.y,z:minZ},{x:b.x,y:b.y,z:minZ},{x:b.x,y:180,z:minZ},{x:a.x,y:180,z:minZ}]);
  boundary.push([{x:b.x,y:b.y,z:maxZ},{x:a.x,y:a.y,z:maxZ},{x:a.x,y:180,z:maxZ},{x:b.x,y:180,z:maxZ}]);
}
export function cutAscent(mesh:MeshData,colors?:number[]) {
  const positions=Array.from(mesh.positions),indices:number[]=[],outColors=colors?.slice();let cutTriangles=0;
  for(let k=0;k<mesh.indices.length;k+=3) {
    const ids=Array.from(mesh.indices.subarray(k,k+3));
    const tri=ids.map(i=>({x:mesh.positions[i*3],y:mesh.positions[i*3+1],z:mesh.positions[i*3+2]}));
    if(Math.max(...tri.map(v=>v.x))<ascent.start||Math.min(...tri.map(v=>v.x))>ascent.end||Math.max(...tri.map(v=>v.z))<minZ||Math.min(...tri.map(v=>v.z))>maxZ){indices.push(...ids);continue;}
    let fragments=[tri],changed=false;
    for(const planes of volumes) {
      const next:Point[][]=[];
      for(const poly of fragments){
        if(planes.some(pl=>poly.every(v=>value(pl,v)>2e-6))){next.push(poly);continue;}
        let remaining=poly;
        for(const pl of planes){if(remaining.some(v=>value(pl,v)>2e-6))next.push(clip(remaining,flip(pl)));remaining=clip(remaining,pl);if(!remaining.length)break;}
        if(remaining.length>=3)changed=true;
      }
      fragments=next;
    }
    if(changed)cutTriangles++;
    for(const poly of fragments){const before=positions.length;append(poly,positions,indices);if(outColors)for(let j=before;j<positions.length;j+=3)outColors.push(...colors!.slice(ids[0]*3,ids[0]*3+3));}
  }
  return {positions:new Float32Array(positions),indices:new Uint32Array(indices),colors:outColors,cutTriangles};
}
export function ascentSurface(source:MeshData){return boundaryInMountain(source,boundary,{minX:ascent.start,maxX:ascent.end,minZ,maxZ});}
export function ascentHeight(x:number){const i=Math.min(profile.length-2,Math.max(0,Math.floor((x-ascent.start)/(ascent.end-ascent.start)*14))),a=profile[i],b=profile[i+1];return a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);}
