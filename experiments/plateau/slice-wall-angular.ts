import { Color, Vector3 } from 'three';
import { Rng } from '../../src/core/rng';

type Site = {
  x: number; z: number; angle: number; width: number; height: number;
  groundAt: (x: number, z: number) => number;
};

type Buffer = { positions: number[]; indices: number[]; colors: number[] };

function buffer(): Buffer {
  return { positions: [], indices: [], colors: [] };
}

function addPoint(mesh: Buffer, point: Vector3, color: Color) {
  const index = mesh.positions.length / 3;
  mesh.positions.push(point.x, point.y, point.z);
  mesh.colors.push(color.r, color.g, color.b);
  return index;
}

function pack(mesh: Buffer) {
  return { positions: Float32Array.from(mesh.positions), indices: Uint32Array.from(mesh.indices), colors: mesh.colors };
}

const palette = ['#565e6e', '#677182', '#666a78', '#747782', '#5c626e'];
const white = new Color(1, 1, 1);

// A talus fan in three dimensions. The rear line carries the tall, tilted
// blocks; successive courses occupy the pockets below them toward the toe.
export function buildAngularWall(site: Site, count: number, seed: number) {
  if (![5, 8, 12].includes(count)) throw new RangeError('Angular wall presets are 5, 8 and 12.');
  const rng = new Rng(seed ^ 0x58ee46), rock = buffer(), snow = buffer();
  const rows = count === 5 ? [3, 2] : count === 8 ? [3, 3, 2] : [4, 4, 4];
  const tx = Math.cos(site.angle), tz = Math.sin(site.angle);
  function point(u: number, v: number, y: number) {
    return new Vector3(site.x + tx * u + tz * v, y, site.z + tz * u - tx * v);
  }
  const masses: { firstTriangle: number; triangles: number; minU: number; maxU: number; minV: number; maxV: number }[] = [];
  // Interpolate shared boundaries in plan. The slight shear gives neighboring
  // fragments an oblique joint without letting their volumes interpenetrate.
  const maxDepth = site.width * 0.72;
  const rowDepth = maxDepth / rows.length;
  for (const [row, columns] of rows.entries()) {
    const phase = row / (rows.length - 1);
    const shift = (row % 2 ? -1 : 1) * site.width * 0.028;
    const rowWidth = site.width * (columns === 2 ? 0.67 : 0.94);
    const cellWidth = rowWidth / columns;
    const boundaries = Array.from({length: columns + 1}, (_, i) =>
      shift - rowWidth / 2 + i * cellWidth +
      (i > 0 && i < columns ? rng.float(-0.04, 0.04) * cellWidth : 0));
    for (let col = 0; col < columns; col++) {
      const lo = boundaries[col], hi = boundaries[col+1];
      const span = Math.min(hi-lo, site.width / 3) * rng.float(0.95, 0.997);
      const u = (lo+hi)/2, v = rowDepth * (row + 0.5) + site.width * 0.02;
      const depth = rowDepth * rng.float(0.9, 0.985);
      const h = site.height * (0.86 - 0.48 * phase) * rng.float(0.78, 1.05);
      // Heavily sheared upper rings distinguish fallen wedges from standing pillars.
      const lean = rng.float(-0.27, 0.27);
      const tip = rng.float(-0.3, 0.3), dip = rng.float(0.26, 0.60);
      const shoulder = rng.float(0.39, 0.60);
      const cut = rng.float(0.18, 0.39);
      // Six ends of an asymmetric fractured prism, in counterclockwise plan order.
      const outline = [[-.50,-.27],[-.27,-.50],[.50,-.50+cut],[.44,.29],[.10,.50],[-.50,.35]];
      const ground = (du: number, dv: number) => {
        const p = point(u+du, v+dv, 0);
        return site.groundAt(p.x, p.z);
      };
      const base = Math.min(...outline.map(([x,z])=>ground(x*span,z*depth))) - 1.8;
      const tint = new Color(rng.pick(palette)), points: Vector3[] = [], tris: number[] = [];
      for (const [x,z] of outline) points.push(point(u+x*span*.86,v+z*depth*.82,base));
      for (const [x,z] of outline) {
        const mid = shoulder + .20*x - .20*z;
        points.push(point(u+(x*.93 + lean*.10)*span,v+z*.98*depth, base + h*mid));
      }
      // One oblique fracture plane supports the whole crown, including its snow.
      const capU = u + lean*.64*span, capV = v - .08*depth;
      const topHeight = (x:number,z:number) => base + h*.95 + tip*(x-capU) - dip*(z-capV);
      const cap = outline.map(([x,z])=>{
        const a=capU + x*span*.55, b=capV + z*depth*.8;
        return point(a,b,topHeight(a,b));
      });
      points.push(...cap);
      const n = outline.length;
      // Bottom, fractured sides, upper face. Retain the sharp ridge on each prism.
      for (let i=1;i<n-1;i++) tris.push(0,i+1,i, 2*n,2*n+i,2*n+i+1);
      for (let k=0;k<2;k++) for (let i=0;i<n;i++){
        const a=k*n+i, b=k*n+(i+1)%n;
        tris.push(a,b,b+n,a,b+n,a+n);
      }
      const start = rock.indices.length/3, offset = rock.positions.length/3;
      for (const p of points) addPoint(rock,p,tint);
      for (const index of tris) rock.indices.push(offset+index);

      // Inset a patch on its actual supporting triangle. A centre raised above
      // the rock and a gently buried perimeter let the snow meet the stone.
      const center = cap.reduce((a,b)=>a.add(b),new Vector3()).divideScalar(n);
      const snowTop = center.clone();
      snowTop.y += Math.min(span,depth)*.04;
      const centerIndex = addPoint(snow,snowTop,white);
      const coverage = rng.float(.77,.97);
      for (const vertex of cap) {
        const p = center.clone().lerp(vertex,coverage*rng.float(.86,1));
        p.y -= .025;
        addPoint(snow,p,white);
      }
      for (let i=0;i<n;i++) snow.indices.push(centerIndex,centerIndex+1+i,centerIndex+1+(i+1)%n);

      // Broader load-bearing rock ledges on the front and crownward sides
      // sometimes collect a second patch, always seated on that actual face.
      const sideNormal = new Vector3(), edge = new Vector3();
      for (let i=0;i<tris.length;i+=3) {
        const a=points[tris[i]], b=points[tris[i+1]], c=points[tris[i+2]];
        if ([tris[i],tris[i+1],tris[i+2]].every(id=>id>=2*n)) continue;
        sideNormal.subVectors(b,a).cross(edge.subVectors(c,a)).normalize();
        if (sideNormal.y<.52) continue;
        const mid=a.clone().add(b).add(c).multiplyScalar(1/3);
        const crown=mid.clone().addScaledVector(sideNormal,.16);
        const first=addPoint(snow,crown,white);
        for(const p of [a,b,c]) addPoint(snow,mid.clone().lerp(p,.83).addScaledVector(sideNormal,-.022),white);
        snow.indices.push(first,first+1,first+2,first,first+2,first+3,first,first+3,first+1);
      }
      masses.push({firstTriangle:start,triangles:rock.indices.length/3-start,minU:u-span*.5,maxU:u+span*.5,
        minV:v-depth*.5,maxV:v+depth*.5});
    }
  }
  // A low snow bank fills the crevices at ground level. Radial ends dip
  // below the actual ground, so the bank has no open visible hem.
  const footV = maxDepth*.93, bankOffset=snow.positions.length/3;
  for(let i=0;i<=16;i++){
    const t=i/16, u=(t-.5)*site.width*1.02;
    const taper=Math.sin(t*Math.PI), crest=footV+Math.sin(t*13)*rowDepth*.13;
    for(const [distance,height] of [[-rowDepth*.71,-.35],[-rowDepth*.32,2.4],[.1,3.1],[rowDepth*.24,1],[rowDepth*.50,-.35]]){
      const p=point(u,crest+distance,0);
      p.y=site.groundAt(p.x,p.z)-.30 + taper*height;
      addPoint(snow,p,white);
    }
  }
  for(let i=0;i<16;i++) for(let k=0;k<4;k++){
    const a=bankOffset+i*5+k, b=a+5;
    snow.indices.push(a,b,b+1,a,b+1,a+1);
  }
  return {rock:pack(rock),snow:pack(snow),masses};
}
