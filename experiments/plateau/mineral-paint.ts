import { DataTexture, LinearMipmapLinearFilter, NearestFilter, RepeatWrapping } from 'three';
import { Rng } from '../../src/core/rng';

// Each texel is a patch of pigment. Coarse fields group the rust into veins,
// and a finer broken edge leaves unpainted areas across an individual joint.
export function mineralPaint(seed:number) {
  const n=128, rng=new Rng(seed ^ 0x67b91);
  const fields=[4,9,19,37].map(size=>{
    const grid=Float32Array.from({length:size*size},()=>rng.next());
    return (x:number,y:number)=>{
      const u=(x/n*size+size*4)%size,v=(y/n*size+size*4)%size,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
      const at=(p:number,q:number)=>grid[(q%size)*size+p%size];
      return (1-b)*(at(i,j)*(1-a)+at(i+1,j)*a)+b*(at(i,j+1)*(1-a)+at(i+1,j+1)*a);
    };
  });
  const data=new Uint8Array(n*n*4);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const bend=18*fields[0](x+27,y-19);
    const broad=fields[0](x+bend,y), mid=fields[1](x+8,y+bend);
    const chips=fields[2](x+3,y-2), fleck=fields[3](x,y);
    const rust=.32*broad+.24*mid+.22*chips+.12*fleck+.1*rng.next();
    const mask=Math.max(0,Math.min(1,(rust-.50)*7));
    const grain=Math.round((.45*mid+.35*chips+.2*fleck)*9)/9;
    const k=4*(y*n+x);
    data[k]=Math.round(255*mask);data[k+1]=grain*255;data[k+2]=broad*255;data[k+3]=255;
  }
  const tex=new DataTexture(data,n,n);tex.wrapS=tex.wrapT=RepeatWrapping;
  tex.magFilter=NearestFilter;tex.minFilter=LinearMipmapLinearFilter;tex.generateMipmaps=true;tex.needsUpdate=true;return tex;
}
