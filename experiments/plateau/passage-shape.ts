import { Rng, smoothstep } from '../../src/core/rng';
import { ascent, ascentSample } from './ascent';

type Knot = {x:number; v:number};

// Shape-preserving cubic interpolation. Folds flatten at an extremum while
// a straight traverse keeps its heading through intermediate stations.
function curve(knots:Knot[]) {
  const slopes=knots.slice(1).map((b,i)=>(b.v-knots[i].v)/(b.x-knots[i].x));
  const tangent=knots.map((_,i)=>{
    const a=slopes[i-1],b=slopes[i];
    return a*b>0?2*a*b/(a+b):0;
  });
  return (x:number)=>{
    if(x<=knots[0].x)return knots[0].v;
    const j=knots.findIndex(p=>p.x>=x);
    if(j<0)return knots[knots.length-1].v;
    const a=knots[j-1], b=knots[j], w=b.x-a.x, t=(x-a.x)/w;
    return a.v+(b.v-a.v)*t*t*(3-2*t)+w*t*(1-t)*((1-t)*tangent[j-1]-t*tangent[j]);
  };
}

const xmin=-360, xmax=355, boundary=345, shoulder=172;
const clamp=(x:number)=>Math.min(1,Math.max(0,x));

export function passageShape(seed:number, width:number, depth:number, rise:number){
  const rng=new Rng(seed ^ 0x622a9f);
  const hand=rng.chance(.5)?1:-1;
  const turns=rng.int(2,4), weights=Array.from({length:turns+1},()=>rng.float(.58,1.85));
  const total=weights.reduce((a,b)=>a+b,0), bends:Knot[]=[{x:0,v:rng.float(-67,-36)}];
  let t=0;
  for(let i=0;i<turns;i++){
    t+=weights[i]/total;
    bends.push({x:t,v:-27+hand*(i%2?-1:1)*rng.float(26,68)});
  }
  bends.push({x:1,v:-50});
  // Some routes traverse one side of a headland before the next turn.
  // Two stations at the same offset form a straight with a varying length.
  const landmarks=new Rng(seed ^ 0x67e51);
  if(landmarks.chance(.62)){
    const i=landmarks.int(1,bends.length-2),a=bends[i],b=bends[i+1];
    bends.splice(i+1,0,{x:a.x+(b.x-a.x)*landmarks.float(.25,.50),v:a.v});
  }
  const center=curve(bends);
  const pinch=rng.float(.18,.41), bench=rng.float(.48,.71);
  const narrow=Math.max(rng.float(15,22),4.6/Math.min(width,depth));
  const widthProfile=curve([{x:0,v:rng.float(25,42)},{x:pinch,v:narrow},
    {x:bench,v:rng.float(39,53)},{x:rng.float(.76,.86),v:rng.float(17,29)},{x:1,v:rng.float(23,35)}]);
  const reverseWidth=landmarks.chance(.5);
  const breadth=(f:number)=>{
    // Stations are sliced in x. At an oblique bend the usable width is
    // perpendicular to travel, especially important on small upper terraces.
    const slope=(center(f+.01)-center(f-.01))*depth/(.02*(ascent.end-ascent.start)*width);
    return Math.max(widthProfile(reverseWidth?1-f:f),Math.min(shoulder*.77,5*Math.hypot(1,slope)/depth));
  };
  // Unequal headlands on the two flanks change the whole terrace outline.
  function flank(){
    return curve([{x:xmin,v:0},{x:rng.float(-307,-250),v:rng.float(-18,20)},
      {x:rng.float(-224,-128),v:rng.float(-48,45)},{x:rng.float(-88,-14),v:rng.float(-40,48)},
      {x:rng.float(16,88),v:rng.float(-43,40)},{x:rng.float(120,199),v:rng.float(-44,47)},
      {x:rng.float(246,297),v:rng.float(-20,19)},{x:xmax,v:0}]);
  }
  const leftFlank=flank(), rightFlank=flank();

  // Integrate grades in horizontal metres, including a short dip and a
  // near-level landing. Solve for the steeper stretches at this tier's scale.
  const run=ascent.end-ascent.start, dip=rng.float(.30,.55), dipLength=rng.float(.09,.145);
  const grades=curve([{x:0,v:.14},{x:.10,v:.84},{x:dip-.095,v:1.15},{x:dip,v:-.36},
    {x:dip+dipLength,v:-.23},{x:dip+dipLength+.065,v:.92},{x:.82,v:1.13},{x:.93,v:.47},{x:1,v:.19}]);
  const maxGrade=.83*width/rise;
  const shelf=landmarks.float(.75,.84), shelfEnd=shelf+landmarks.float(.04,.08);
  const efforts=Array.from({length:run},(_,i)=>{
    const f=(i+.5)/run;
    const flat=smoothstep(shelf-.025,shelf,f)*(1-smoothstep(shelfEnd,shelfEnd+.025,f));
    return grades(f)*(1-flat);
  });
  // At the mouth the old solid grades into the apron. Preserve that contact
  // before gaining height where there is a continuous rock floor to carry it.
  const approach=efforts.map((_,i)=>({
    original:ascentSample(ascent.start+i+1).y-ascentSample(ascent.start+i).y,
    blend:smoothstep(.20,.30,(i+.5)/run),
  }));
  const grade=(v:number,scale:number,i:number)=>{
    const {original,blend}=approach[i];
    return original*(1-blend)+blend*(v<0?v*.63:Math.min(maxGrade,v*scale));
  };
  // A dip close to the entrance has less elevation to spend. Taper its
  // downhill grade before it could run beneath the surrounding snowfield.
  function advance(y:number,v:number,scale:number,i:number){
    const dy=grade(v,scale,i);
    return y+(dy>=0?dy:Math.max(dy,-Math.max(0,y-1)*.09));
  }
  let lo=0,hi=12;
  for(let i=0;i<30;i++){
    const scale=(lo+hi)*.5;
    if(efforts.reduce((sum,v,i)=>advance(sum,v,scale,i),0)<ascent.rise)lo=scale;else hi=scale;
  }
  const heights=[0];
  for(const [i,v] of efforts.entries())heights.push(advance(heights[i],v,hi,i));
  const heightScale=ascent.rise/heights[run];

  // Each section maps the original two banks and two outer shoulders to
  // their new locations. Keep the order strictly monotone so rocks, snow,
  // feet, and the inverse used by placement all agree at a shared edge.
  const rows=Array.from({length:xmax-xmin+1},(_,i)=>{
    const x=xmin+i, s=ascentSample(x), f=clamp((x-ascent.start)/run);
    const blend=smoothstep(xmin,ascent.start,x)*(1-smoothstep(ascent.end,ascent.end+78,x));
    const z=s.z+(center(f)-s.z)*blend, w=s.w+(breadth(f)-s.w)*blend;
    const l=z-w, r=z+w;
    const low=Math.min(-shoulder+leftFlank(x),l-32),high=Math.max(shoulder+rightFlank(x),r+32);
    const y=heights[Math.round(f*run)]*heightScale;
    return {original:[-boundary,-shoulder,s.z-s.w,s.z+s.w,shoulder,boundary],
      target:[-boundary,low,l,r,high,boundary],floor:s.y,lift:(y-s.y)*blend};
  });
  function section(x:number){
    const i=Math.max(0,Math.min(rows.length-2,Math.floor(x-xmin)));
    return {a:rows[i],b:rows[i+1],f:clamp(x-xmin-i)};
  }
  function lateral(x:number,z:number,inverse=false){
    if(x<=xmin || x>=xmax || Math.abs(z)>=boundary)return z;
    const {a,b,f}=section(x), src=inverse?'target':'original', dst=inverse?'original':'target';
    let prev=-boundary, mapped=-boundary;
    for(let j=1;j<6;j++){
      const next=a[src][j]+f*(b[src][j]-a[src][j]);
      const to=a[dst][j]+f*(b[dst][j]-a[dst][j]);
      if(z<=next)return mapped+(to-mapped)*(z-prev)/(next-prev);
      mapped=to;prev=next;
    }
    return z;
  }
  function elevation(x:number,y:number,z:number){
    if(x<=ascent.start || x>=ascent.end || y<=0 || y>=103 || Math.abs(z)>195)return y;
    const {a,b,f}=section(x);
    const floor=a.floor+f*(b.floor-a.floor), lift=a.lift+f*(b.lift-a.lift);
    const left=a.original[2]+f*(b.original[2]-a.original[2]);
    const right=a.original[3]+f*(b.original[3]-a.original[3]);
    const bank=1-smoothstep(0,36,Math.max(left-z,z-right));
    const contact=y<floor?y/Math.max(.00001,floor):(103-y)/Math.max(.00001,103-floor);
    return y+lift*bank*Math.min(1,contact);
  }
  function route(x:number){
    const s=ascentSample(x), l=lateral(x,s.z-s.w),r=lateral(x,s.z+s.w);
    return {x,z:(l+r)/2,y:elevation(x,s.y,s.z),w:(r-l)/2};
  }
  return {lateral,elevation,route,benchX:ascent.start+(reverseWidth?1-bench:bench)*run};
}
export type PassageShape=ReturnType<typeof passageShape>;
