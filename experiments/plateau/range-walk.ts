import { BufferGeometry, Group, Mesh, Vector3 } from 'three';
import { metres } from './range-bridge';

// Multiple surfaces can occupy the same x,z under the arch, bridge or cave.
// Index triangles in their own local frame, sharing the index across tier clones.
const cell=10;
function groundIndex(g:BufferGeometry) {
  const p=g.getAttribute('position'), index=g.index?.array;
  const bins=new Map<number,number[]>(), key=(i:number,j:number)=>i*65536+j;
  const id=(i:number)=>index?index[i]:i;
  for(let f=0;f<(index?.length??p.count);f+=3) {
    const a=id(f),b=id(f+1),c=id(f+2);
    const x0=Math.floor(Math.min(p.getX(a),p.getX(b),p.getX(c))/cell),x1=Math.floor(Math.max(p.getX(a),p.getX(b),p.getX(c))/cell);
    const z0=Math.floor(Math.min(p.getZ(a),p.getZ(b),p.getZ(c))/cell),z1=Math.floor(Math.max(p.getZ(a),p.getZ(b),p.getZ(c))/cell);
    for(let i=x0;i<=x1;i++)for(let j=z0;j<=z1;j++){
      const k=key(i,j);let bucket=bins.get(k);
      if(!bucket){bucket=[];bins.set(k,bucket);}
      bucket.push(a,b,c);
    }
  }
  return (x:number,z:number,yScale:number,planScale:number,hit:(localY:number,walkable:boolean)=>void)=>{
    const faces=bins.get(key(Math.floor(x/cell),Math.floor(z/cell)));
    if(!faces)return;
    for(let i=0;i<faces.length;i+=3){
      const a=faces[i],b=faces[i+1],c=faces[i+2],ax=p.getX(a),ay=p.getY(a),az=p.getZ(a);
      const bx=p.getX(b)-ax,by=p.getY(b)-ay,bz=p.getZ(b)-az,cx=p.getX(c)-ax,cy=p.getY(c)-ay,cz=p.getZ(c)-az;
      const det=bx*cz-bz*cx;
      if(Math.abs(det)<1e-8)continue;
      const u=((x-ax)*cz-(z-az)*cx)/det,v=(bx*(z-az)-bz*(x-ax))/det;
      if(u<-.00001||v<-.00001||u+v>1.00001)continue;
      // An uphill normal within 49 degrees of vertical can support the feet.
      const horizontal=Math.hypot(by*cz-bz*cy,bx*cy-by*cx)*yScale/planScale;
      hit(ay+u*by+v*cy,det<0 && horizontal<=-det*1.15);
    }
  };
}
export function walkingSurface(groups:Group[], extra:Mesh[]) {
  const meshes:Mesh[]=extra.slice();
  for(const group of groups){group.updateMatrixWorld(true);group.traverse(o=>{
    if(o instanceof Mesh && o.name!=='horizon' && o.name!=='snow-bottom' && o.geometry.attributes.position.count)
      meshes.push(o);
  });}
  const index=new WeakMap<BufferGeometry,ReturnType<typeof groundIndex>>();
  const entries=meshes.map(m=>{
    m.updateWorldMatrix(true,false);
    const g=m.geometry;g.computeBoundingBox();
    const world=m.matrixWorld, inv=world.clone().invert();
    const s=new Vector3().setFromMatrixScale(world);
    return {g,inv:inv.elements,box:g.boundingBox!.clone().applyMatrix4(world),sy:s.y,sx:s.x,y0:world.elements[13]};
  });
  const eye=1.62/metres, step=.46/metres;
  function floor(x:number,z:number,at:number) {
    let foot=at>=-step && at<=step?0:-Infinity;
    const obstructions:number[]=[];
    for(const {g,box,inv,sy,sx,y0} of entries){
      if(x<box.min.x||x>box.max.x||z<box.min.z||z>box.max.z||box.max.y<at-step||box.min.y>at+step+eye+1)continue;
      let h=index.get(g);if(!h){h=groundIndex(g);index.set(g,h);}
      h(inv[0]*x+inv[8]*z+inv[12],inv[2]*x+inv[10]*z+inv[14],sy,sx,(y,walkable)=>{
        const wy=y0+y*sy;
        if(walkable && wy>=at-step && wy<=at+step) foot=Math.max(foot,wy);
        else obstructions.push(wy);
      });
    }
    if(!Number.isFinite(foot)||obstructions.some(y=>y>foot+.55 && y<foot+eye+1))return undefined;
    return foot;
  }
  function move(p:Vector3,dx:number,dz:number) {
    const x=p.x+dx,z=p.z+dz, h=floor(x,z,p.y);
    if(h===undefined)return false;
    const radius=.26/metres;
    for(const [a,b] of [[radius,0],[-radius,0],[0,radius],[0,-radius]]){
      const side=floor(x+a,z+b,h);
      if(side===undefined||Math.abs(side-h)>step)return false;
    }
    p.set(x,h,z);return true;
  }
  return {eye, floor, move};
}
