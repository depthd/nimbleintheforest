import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from 'three';
import { buildMountainBridge } from '../../src/world/mountains/bridge';
import { mountainHeight } from '../../src/world/mountains/surface-height';
import { worldPlan, type Tier } from './mountain-tiers';

// The archived art uses larger units than the survival world's metre-based bridge.
export const metres = .17;
type Point = {x: number; y: number; z: number};
export function connectBanks(base: Tier, spur: Tier, rim: (a:number)=>Point, terrainGroups: Group[],
  trees: (Point & {radius:number; height:number})[], seed: number) {
  const outline = (tier: Tier) => Array.from({length:180}, (_, i)=>{
    const p = rim(i*Math.PI/90); return worldPlan(tier,p.x,p.z);
  });
  const direction=spur.z>base.z?1:-1;
  const near=outline(base).reduce((p,q)=>direction*q.z>direction*p.z?q:p);
  const far=outline(spur).reduce((p,q)=>direction*q.z<direction*p.z?q:p);
  const cx = (near.x + far.x)/2, cz = (near.z + far.z)/2;
  const x0=cx-148, x1=cx+148, z0=Math.min(near.z,far.z)-135, z1=Math.max(near.z,far.z)+135;
  const positions:number[]=[], indices:number[]=[];
  // Limit the height index to the candidate gorge. Keep faces of both snow
  // shells and projecting rock. A heightfield of the core alone misses both.
  for (const group of terrainGroups) {
    group.updateMatrixWorld(true);
    group.traverse(object=>{
      if (!(object instanceof Mesh) || object.name==='horizon') return;
      const g=object.geometry, v=g.getAttribute('position'), face=g.index?.array;
      if (!face) return;
      if(!g.boundingBox)g.computeBoundingBox();
      const box=g.boundingBox!.clone().applyMatrix4(object.matrixWorld);
      if(box.min.x>x1 || box.max.x<x0 || box.min.z>z1 || box.max.z<z0)return;
      const m=object.matrixWorld.elements, p=v.array, world=new Float32Array(v.count*3);
      for(let i=0;i<p.length;i+=3){
        world[i]=m[0]*p[i]+m[8]*p[i+2]+m[12];
        world[i+1]=m[5]*p[i+1]+m[13];
        world[i+2]=m[2]*p[i]+m[10]*p[i+2]+m[14];
      }
      const ids=new Map<number,number>();
      for(let i=0;i<face.length;i+=3){
        const a=face[i]*3,b=face[i+1]*3,c=face[i+2]*3;
        if (Math.min(world[a],world[b],world[c])>x1 || Math.max(world[a],world[b],world[c])<x0 ||
          Math.min(world[a+2],world[b+2],world[c+2])>z1 || Math.max(world[a+2],world[b+2],world[c+2])<z0) continue;
        for(const j of [a,b,c]){
          let k=ids.get(j); if(k===undefined){k=positions.length/3; ids.set(j,k); positions.push(world[j],world[j+1],world[j+2]);} indices.push(k);
        }
      }
    });
  }
  const height=mountainHeight([{positions:Float32Array.from(positions),indices:Uint32Array.from(indices)}]);
  const sampleHeight=(x:number,z:number)=>metres*height(x/metres,z/metres);
  // A timber landing sits on a short dressed stone sill. Its rear apron
  // follows the bank; only the last few metres are level under the tower.
  const bank = (x:number, side:1|-1, tier:Tier) => {
    for (let d=0;d<165;d+=1.3) {
      const lip=cz-side*d;
      if (height(x,lip)<tier.rise*93) continue;
      const ax=x*metres, az=lip*metres-1.15*side;
      let high=-Infinity,low=Infinity;
      for(const across of [-1.65,0,1.65]) for(const along of [-3.2,-2,-1,0]){
        const y=sampleHeight(ax+across,az+along*side);
        high=Math.max(y,high);low=Math.min(y,low);
      }
      if(high-low>1.65) continue;
      const point = {x:ax,y:high+.14,z:az,mountainId:tier.name,tierId:tier.name,accessible:true,outward:{x:0,z:side}};
      return {point,side};
    }
  };
  type Sill = NonNullable<ReturnType<typeof bank>>;
  const back=-5.8,flat=-3,front=.44,width=1.67;
  const sillHeight=(s:Sill,x:number,z:number)=>{
    const t=(z-s.point.z)*s.side;
    if(t<back-1e-7 || t>front+1e-7 || Math.abs(x-s.point.x)>width+1e-7) return -Infinity;
    const t0=sampleHeight(x,s.point.z+back*s.side)+.025;
    const blend=Math.min(1,(t-back)/(flat-back));
    return (1-blend)*t0+blend*s.point.y;
  };
  const bearing=(s:Sill)=>{
    const pos:number[]=[],colors:number[]=[];
    const tone=new Color(0x665b6a), frost=new Color(0xc4d1df);
    type V = [number,number,number];
    function tri(a:V,b:V,c:V,color:Color){
      pos.push(...a,...b,...c);for(let i=0;i<3;i++)colors.push(color.r,color.g,color.b);
    }
    const rows=[back,flat,-1,front];
    for(let i=1;i<rows.length;i++) {
      const pts:V[]=[];
      for(const d of [rows[i-1],rows[i]])for(const v of [-width,width]){
        const x=s.point.x+v,z=s.point.z+s.side*d;
        pts.push([x,sillHeight(s,x,z+.00001*s.side*(d===front?-1:d===back?1:0)),z]);
      }
      const [a,b,c,e]=pts;
      if(s.side>0){tri(a,c,b,frost);tri(b,c,e,frost);}else{tri(a,b,c,frost);tri(b,e,c,frost);}
      const edges: [V,V][]=[[a,c],[e,b]];
      if(i===rows.length-1) edges.push([c,e]);
      for(const [u,v] of edges){
        const floor=(q:V):V=>[q[0],Math.min(q[1]-.09,sampleHeight(q[0],q[2])-.12),q[2]];
        tri(u,v,floor(u),tone);tri(floor(u),v,floor(v),tone);
      }
    }
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(pos,3));
    g.setAttribute('color',new Float32BufferAttribute(colors,3));g.computeVertexNormals();
    const m=new Mesh(g,new MeshStandardMaterial({vertexColors:true,flatShading:true,side:2,roughness:1}));
    m.receiveShadow=m.castShadow=true; m.name='bank-sill';return m;
  };
  const xs=Array.from({length:70},(_,i)=>cx+((i%2===0?1:-1)*Math.ceil(i/2)*3.4));
  for(const x of xs){
    const a=bank(x,direction,base),b=bank(x,direction===1?-1:1,spur);
    if(!a||!b) continue;
    const sample=(x:number,z:number)=>Math.max(sampleHeight(x,z),sillHeight(a,x,z),sillHeight(b,x,z));
    const bridge=buildMountainBridge({seed,bridgeAnchors:[a.point,b.point],sampleHeight:sample,trees});
    if(bridge){
      bridge.group.add(bearing(a),bearing(b));bridge.group.scale.setScalar(1/metres);return bridge;
    }
  }
  return null;
}
