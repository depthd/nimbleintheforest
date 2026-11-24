import { BufferAttribute, BufferGeometry } from 'three';
import type { PassageShape } from './passage-shape';

// Preserve the authored smooth normals on snow and the hard joins on stone.
// Transform them by the inverse transpose of the same map used for positions.
export function shapePassageMesh(original:BufferGeometry,shape:PassageShape) {
  const pos=original.getAttribute('position'), norm=original.getAttribute('normal');
  const xyz=new Float32Array(pos.count*3), normals=new Float32Array(xyz.length);
  const d=.04;
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
    const pz=shape.lateral(x,z),py=shape.elevation(x,y,z);
    const zx=(shape.lateral(x+d,z)-pz)/d,zz=(shape.lateral(x,z+d)-pz)/d;
    const yx=(shape.elevation(x+d,y,z)-py)/d,yy=(shape.elevation(x,y+d,z)-py)/d,yz=(shape.elevation(x,y,z+d)-py)/d;
    const ny=norm.getY(i)/Math.max(.001,yy);
    const nz=(norm.getZ(i)-ny*yz)/Math.max(.001,zz), nx=norm.getX(i)-ny*yx-nz*zx;
    const length=Math.hypot(nx,ny,nz)||1,k=i*3;
    xyz[k]=x;xyz[k+1]=py;xyz[k+2]=pz;
    normals[k]=nx/length;normals[k+1]=ny/length;normals[k+2]=nz/length;
  }
  const g=new BufferGeometry();
  for(const [key,attribute] of Object.entries(original.attributes))g.setAttribute(key,attribute);
  g.setAttribute('position',new BufferAttribute(xyz,3));g.setAttribute('normal',new BufferAttribute(normals,3));
  g.setIndex(original.index);
  return g;
}

// A slab can span an entire bend. Split long edges before moving either bank,
// sharing edge midpoints across adjacent faces and interpolating the rock finish.
export function refinePassageFaces(source:BufferGeometry){
  const attrs=Object.entries(source.attributes).map(([name,a])=>({name,size:a.itemSize,data:Array.from(a.array)}));
  const points=attrs.find(a=>a.name==='position')!.data, count=points.length/3;
  const midpoints=new Map<number,number>(), indices:number[]=[];
  function edge(a:number,b:number){
    const ax=points[3*a],bx=points[3*b];
    if(Math.min(ax,bx)>85 || Math.max(ax,bx)<-325)return 0;
    const az=points[3*a+2],bz=points[3*b+2];
    if(Math.min(az,bz)>142 || Math.max(az,bz)<-155)return 0;
    return Math.max(Math.abs(ax-bx)/9,Math.abs(az-bz)/16,Math.abs(points[3*a+1]-points[3*b+1])/25);
  }
  function split(a:number,b:number,c:number){
    const ab=edge(a,b),bc=edge(b,c),ca=edge(c,a);
    if(Math.max(ab,bc,ca)<=1){indices.push(a,b,c);return;}
    if(bc>ab && bc>=ca)[a,b,c]=[b,c,a];
    else if(ca>ab && ca>bc)[a,b,c]=[c,a,b];
    const key=Math.min(a,b)*0x4000000+Math.max(a,b);
    let m=midpoints.get(key);
    if(m===undefined){
      m=points.length/3;midpoints.set(key,m);
      for(const {size,data} of attrs)for(let j=0;j<size;j++)data.push((data[a*size+j]+data[b*size+j])*.5);
    }
    split(a,m,c);split(m,b,c);
  }
  const ids=source.index!.array;
  for(let i=0;i<ids.length;i+=3)split(ids[i],ids[i+1],ids[i+2]);
  if(points.length===3*count)return source;
  const g=new BufferGeometry();
  for(const {name,size,data} of attrs)g.setAttribute(name,new BufferAttribute(Float32Array.from(data),size));
  g.setIndex(indices);
  return g;
}
