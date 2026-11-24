import { Rng } from '../../src/core/rng';
import { ascentSample } from './ascent';

// One bed of rock remains above the cut. Along its length, oblique joints
// separate a long shoulder slab, a wedged crown and a lower broken heel.
export function stoneSpan(seed: number, roof: (x: number, z: number) => number) {
  const rng = new Rng(seed ^ 0x4e21c);
  const x=rng.float(-194,-141), profile=ascentSample(x), half=profile.w+20;
  const skew=rng.float(-.39,.32), depth=rng.float(20,28);
  const bankHeight=(sign:number)=>roof(x+sign*skew*half,profile.z+sign*half);
  const left=bankHeight(-1), right=bankHeight(1), peak=rng.float(-.18,.14);
  const soffit=Math.min(left,right)-rng.float(17,23);
  const seamA=rng.float(-.65,-.45), seamB=rng.float(.02,.23);
  const segments=[[-1,seamA],[seamA,seamB],[seamB,1]];
  const rock:number[]=[],snow:number[]=[],triangles:number[]=[],snowTriangles:number[]=[];
  for(const [s,[a,b]] of segments.entries()){
    const slip=rng.float(-2.1,2.1), thickness=rng.float(.79,1.15);
    const rBase=rock.length/3;
    for(const [i,u] of [a,(a+b)/2,b].entries()){
      const ridge=1-Math.abs(u-peak);
      const z=profile.z+u*half, mid=x+skew*u*half + 3*ridge;
      const bank=left+(right-left)*(u+1)/2;
      const crown=bank + 9*ridge - 1.5 + slip + rng.float(-1.2,1.2);
      const belly=soffit-32*(1-ridge)**1.25+slip;
      const front=mid-depth*(.48+.13*ridge)*thickness,back=mid+depth*.51;
      const section=[[front,crown-5],[front+4,crown+.4],[back-3,crown+1.4],
        [back,crown-4],[back-1,belly+1],[front+3,belly]];
      const joint=(i===0 && s>0)||(i===2 && s<2);
      const seam=(y:number)=>joint ? -.21*(y-bank)+(i===0?.38:-.38) : 0;
      const ro=rock.length/3, sn=snow.length/3;
      for(const [px,py] of section) rock.push(px,py,z+seam(py));
      for(const [px,py] of [[front+1.2,crown-2.4],[front+4,crown+1.8],[back-3,crown+2.6],[back-.6,crown-1.1]])
        snow.push(px,py,z+seam(py));
      if(i) {
        for(let j=0;j<6;j++){const k=(j+1)%6;triangles.push(ro-6+j,ro+j,ro-6+k,ro-6+k,ro+j,ro+k);}
        for(let j=0;j<3;j++)snowTriangles.push(sn-4+j,sn+j,sn-3+j,sn-3+j,sn+j,sn+1+j);
      }
    }
    for(let j=1;j<5;j++){
      triangles.push(rBase,rBase+j,rBase+j+1);
      triangles.push(rBase+12,rBase+13+j,rBase+12+j);
    }
  }
  return {x,z:profile.z,floor:profile.y,soffit,half,rock,triangles,snow,snowTriangles};
}
