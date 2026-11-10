import { Simplex2, clamp, lerp, smoothstep } from '../../src/core/rng';
import { SIZE, CELL, type Point, type Route, type View } from './landforms';
import { generateMountainPlan, noiseStream, polygonDistance, floorAt, type District, type MountainPlan } from './mountain-plan';

export interface Projection { distance: number; y: number; x: number; z: number; side: number; t: number; segment: number }
function project(points: readonly Point[], x: number, z: number): Projection {
    let p:Projection={distance:Infinity,y:0,x:0,z:0,side:0,t:0,segment:0};
    for(let i=1;i<points.length;i++) {
        const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz;
        const t=clamp(((x-a.x)*dx+(z-a.z)*dz)/len2,0,1),px=a.x+dx*t,pz=a.z+dz*t,d=(x-px)**2+(z-pz)**2;
        if(d<p.distance)p={distance:d,y:lerp(a.y,b.y,t),x:px,z:pz,side:dx*(z-pz)-dz*(x-px),t,segment:i-1};
    }
    p.distance=Math.sqrt(p.distance);return p;
}
function resample(points:readonly Point[],step=3):Point[] {
    const out:Point[]=[];
    for(let i=1;i<points.length;i++) {const a=points[i-1],b=points[i],n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/step);for(let k=0;k<n;k++)out.push({x:lerp(a.x,b.x,k/n),y:lerp(a.y,b.y,k/n),z:lerp(a.z,b.z,k/n)});}
    out.push({...points[points.length-1]});return out;
}
export class GeneratedLandforms {
    readonly n=SIZE/CELL;
    readonly heights=new Float32Array((this.n+1)**2);
    readonly noise:Simplex2;
    readonly plan:MountainPlan;
    readonly regions:District[];
    readonly routes:Route[];
    readonly views:View[]=[];
    readonly drainage:Point[]=[];
    readonly lake:{x:number;z:number;y:number;rx:number;rz:number};
    readonly yaw:number; readonly mirror:number; readonly upper:number;
    readonly ridges:MountainPlan['ridges'];
    private readonly trunk:Point[];
    constructor(readonly seed:number) {
        this.plan=generateMountainPlan(seed);this.regions=this.plan.regions;this.ridges=this.plan.ridges;
        this.yaw=this.plan.yaw;this.mirror=this.plan.mirror;
        const random=noiseStream(seed,'surface');this.noise=new Simplex2(()=>random.next());
        this.trunk=this.plan.trunk.map(id=>{const r=this.regions.find(r=>r.id===id)!;return{x:r.x,y:r.y,z:r.z};});
        this.upper=this.trunk.at(-1)!.y;
        const low=this.regions[0];this.lake={x:low.x+80,z:low.z+16,y:floorAt(low,low.x+80,low.z+16)-1.2,rx:35,rz:24};
        for(let j=0;j<=this.n;j++)for(let i=0;i<=this.n;i++)this.heights[j*(this.n+1)+i]=this.form(i*CELL-SIZE/2,j*CELL-SIZE/2);
        // Route heights remain the independent plan; never replace them with
        // heightAt() and present the sampled result as fulfilment of the plan.
        this.routes=this.plan.routes.map(r=>({...r,points:resample(r.points)}));
        this.makeViews();
    }
    local(x:number,z:number){const c=Math.cos(this.yaw),s=Math.sin(this.yaw);return{x:(c*x+s*z)*this.mirror,z:-s*x+c*z};}
    world(x:number,z:number){x*=this.mirror;const c=Math.cos(this.yaw),s=Math.sin(this.yaw);return{x:c*x-s*z,z:s*x+c*z};}
    private form(wx:number,wz:number) {
        const {x,z}=this.local(wx,wz),N=this.noise,main=project(this.trunk,x,z);
        const foot=17+N.fbm(x/260,z/260,3)*4;
        let h=Math.max(foot,main.y-main.distance*.36);
        // A connected common body, followed by directional ridge systems.
        // Absolute crest elevations vary along every spine, with broad backs.
        for(const ridge of this.ridges) {
            const q=project(ridge.nodes,x+N.noise(x/180+3,z/170)*7,z+N.noise(x/190,z/180-4)*7);
            const a=ridge.nodes[q.segment],b=ridge.nodes[q.segment+1],width=lerp(q.side<0?a.left:a.right,q.side<0?b.left:b.right,q.t);
            const t=clamp(1-q.distance/width,0,1),profile=.25*t+.75*smoothstep(.03,.95,t);
            const crest=q.y+N.noise(q.x/130,q.z/160)*8;
            h=Math.max(h,foot+(crest-foot)*profile);
        }
        const passes=this.plan.routes.map(r=>({r,p:project(r.points,x,z)}));
        for(const {p} of passes)h=Math.max(h,p.y-p.distance*.5);
        const reserve=Math.min(...passes.map(({p})=>p.distance));
        for(const r of this.regions) {
            const d=polygonDistance(r.polygon,x,z);
            const dx=x-r.x,dz=z-r.z,along=dx*r.openX+dz*r.openZ;
            const open=smoothstep(-.2,.65,along/Math.max(1,Math.hypot(dx,dz)));
            const feather=lerp(r.feather,110,open);if(d<-feather)continue;
            // Interior folds form coves and shoulders. They fade at independently
            // reserved approaches, not across the entire district floor.
            const fold=10*Math.exp(-Math.pow((dx-r.openX*r.radius*.5)/(r.radius*.35),2)-((dz-r.openZ*r.radius*.5)/(r.radius*.55))**2);
            const relief=(fold+N.noise(x/78+r.phase,z/85)*4.5+N.noise(x/31,z/35)*.45)*smoothstep(9,35,reserve);
            let floor=floorAt(r,x,z)+relief;
            if(r.kind==='crest')floor-=Math.max(0,(x-r.x)*.3+(z-r.z)*.8)**2*.0018;
            h=lerp(h,floor,smoothstep(-feather,4,d));
        }
        // A pass owns its walking envelope. Averaging distant pass heights would
        // refill an otherwise correct route at a branch junction.
        let closest: typeof passes[number] | undefined, qmin=Infinity;
        for(const item of passes) {
            const q=item.p.distance/item.r.width;
            if(q<qmin){qmin=q;closest=item;}
        }
        if(closest && qmin<2.8) {
            const {p}=closest,w=(1-smoothstep(.45,2.8,qmin))**2;
            h=lerp(h,p.y+.006*p.distance*p.distance,w);
        }
        const lake=this.lake,d=Math.hypot((x-lake.x)/lake.rx,(z-lake.z)/lake.rz);
        h=lerp(h,lake.y-2.2+1.6*d*d,1-smoothstep(.9,1.2,d));
        // Outer slopes return to the lowland before the finite test-map boundary.
        const edge=Math.max(Math.abs(wx),Math.abs(wz));
        return lerp(h,foot, smoothstep(690,795,edge));
    }
    private makeViews() {
        const view=(id:string,name:string,p:Point,t:Point)=>this.views.push({id,name,position:p,target:t});
        const eye=(x:number,z:number,dy=1.8):Point=>{const p=this.world(x,z);return{...p,y:this.heightAt(p.x,p.z)+dy};};
        const low=this.regions[0],next=this.regions.find(r=>r.id===this.plan.trunk[1])!,top=this.regions.find(r=>r.id===this.plan.trunk.at(-1))!;
        view('lower','Подножие · начало долины',eye(low.x,low.z+55),eye(next.x,next.z,25));
        view('upper','Верхняя долина',eye(top.x-45,top.z+25),eye(top.x+75,top.z-50,15));
        view('overview','Общий массив',eye(-610,620,500),eye(0,-100,65));
        for(const r of this.regions.slice(1)) {
            const incoming=this.routes.find(p=>p.to===r.id),p=incoming?.points[Math.max(0,Math.floor(incoming.points.length*.78))]??{x:r.x,z:r.z+20,y:r.y};
            view(r.id,r.name,eye(p.x,p.z),eye(r.x,r.z,8));
        }
        const crest=this.regions.find(r=>r.id==='crest');
        if(crest)view('summit','С гребня · пройденные долины',eye(crest.x,crest.z),eye(top.x,top.z));
    }
    forestAt(x:number,z:number){const p=this.local(x,z);return this.regions.some(r=>r.kind!=='crest'&&polygonDistance(r.polygon,p.x,p.z)>-30&&this.heightAt(x,z)<Math.min(r.y+24,205));}
    routeDistance(x:number,z:number){const p=this.local(x,z);return Math.min(...this.plan.routes.map(r=>project(r.points,p.x,p.z).distance));}
    waterAt(x:number,z:number){const p=this.local(x,z),l=this.lake;return Math.hypot((p.x-l.x)/l.rx,(p.z-l.z)/l.rz)<1?l.y:NaN;}
    heightAt(x:number,z:number){const u=clamp((x+SIZE/2)/CELL,0,this.n-1e-5),v=clamp((z+SIZE/2)/CELL,0,this.n-1e-5),i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j,k=j*(this.n+1)+i,H=this.heights,n=this.n+1;return a+b<=1?H[k]+(H[k+1]-H[k])*a+(H[k+n]-H[k])*b:H[k+n+1]+(H[k+n]-H[k+n+1])*(1-a)+(H[k+1]-H[k+n+1])*(1-b);}
    slopeAt(x:number,z:number){return Math.hypot(this.heightAt(x+2,z)-this.heightAt(x-2,z),this.heightAt(x,z+2)-this.heightAt(x,z-2))/4;}
    worldRoute(r:Route){return r.points.map(p=>({...this.world(p.x,p.z),y:p.y}));}
}
