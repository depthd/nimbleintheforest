// Shared building rules for ground snow, footsteps, rendering and snowfall.
// Builders register actual roof/floor footprints, independently of warm-air zones.
import * as THREE from 'three';
import type { SnowRect } from './snow-field';

const BIN = 16;
const NO_ZONES: readonly number[] = [];
export const SNOW_ROOF_FADE = 1.2;
export interface SnowCoverZone {
  name: string; kind: 'roof' | 'floor'; x: number; z: number;
  hx: number; hz: number; yaw?: number; y: number; ellipse?: boolean;
}
interface Zone extends SnowCoverZone { c: number; s: number; minX: number; minZ: number; maxX: number; maxZ: number }
const blank = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
blank.needsUpdate = true;
export const snowCoverUniforms = {
  uSnowCoverEnabled: { value: 0 }, uSnowCoverBins: { value: blank },
  uSnowCoverIds: { value: blank }, uSnowCoverZones: { value: blank },
  uSnowCoverGrid: { value: new THREE.Vector4() }, uSnowCoverIdSize: { value: new THREE.Vector2(1, 1) },
  uSnowCoverCount: { value: 1 },
};
export const snowCoverShader = /* glsl */ `
uniform float uSnowCoverEnabled; uniform sampler2D uSnowCoverBins;
uniform sampler2D uSnowCoverIds; uniform sampler2D uSnowCoverZones;
uniform vec4 uSnowCoverGrid; uniform vec2 uSnowCoverIdSize; uniform float uSnowCoverCount;
vec2 snowCover(vec3 p) {
  if (uSnowCoverEnabled < 0.5) return vec2(1.0, 0.0);
  vec2 cell = floor(p.xz / 16.0) - uSnowCoverGrid.xy;
  if (any(lessThan(cell,vec2(0.0))) || any(greaterThanEqual(cell,uSnowCoverGrid.zw))) return vec2(1.0,0.0);
  vec2 bin = texture2D(uSnowCoverBins,(cell+0.5)/uSnowCoverGrid.zw).rg;
  vec2 result = vec2(1.0,0.0);
  for (int k=0; k<int(bin.y); k++) {
    float address=bin.x+float(k);
    float id=texture2D(uSnowCoverIds,(vec2(mod(address,uSnowCoverIdSize.x),floor(address/uSnowCoverIdSize.x))+0.5)/uSnowCoverIdSize).r;
    vec4 a=texture2D(uSnowCoverZones,vec2(0.25,(id+0.5)/uSnowCoverCount));
    vec4 b=texture2D(uSnowCoverZones,vec2(0.75,(id+0.5)/uSnowCoverCount));
    vec2 d=p.xz-a.xy, q=abs(vec2(d.x*b.x-d.y*b.y,d.x*b.y+d.y*b.x))-a.zw;
    float distanceToRoof=length(max(q,0.0))+min(max(q.x,q.y),0.0);
    if (b.w>1.5) distanceToRoof=(length((q+a.zw)/a.zw)-1.0)*min(a.z,a.w);
    if (b.w<0.5 || b.w>1.5) {
      if (p.y<b.z) result.x=min(result.x,smoothstep(0.0,${SNOW_ROOF_FADE.toFixed(1)},distanceToRoof));
    } else if (distanceToRoof<=0.0 && abs(p.y-b.z)<1.0) result.y=1.0;
  }
  return result;
}`;

export class SnowCover {
  readonly zones: Zone[] = [];
  private bins = new Map<string, number[]>();
  constructor(private bounds: SnowRect) {}
  /** A roof or floor that is gone (a collapsed shelter): it no longer shelters anything. */
  remove(id: number) {
    const z = this.zones[id];
    if (!z) return;
    z.y = -1e9;
    this.upload();
  }
  add(zone: SnowCoverZone): number {
    const c = Math.cos(zone.yaw ?? 0), s = Math.sin(zone.yaw ?? 0);
    const rx = Math.abs(c) * zone.hx + Math.abs(s) * zone.hz + SNOW_ROOF_FADE;
    const rz = Math.abs(s) * zone.hx + Math.abs(c) * zone.hz + SNOW_ROOF_FADE;
    const z: Zone = { ...zone, c, s, minX: zone.x-rx, maxX: zone.x+rx, minZ: zone.z-rz, maxZ: zone.z+rz };
    const id = this.zones.push(z) - 1;
    for (let iz=Math.floor(z.minZ/BIN); iz<=Math.floor(z.maxZ/BIN); iz++) for (let ix=Math.floor(z.minX/BIN); ix<=Math.floor(z.maxX/BIN); ix++) {
      const key=`${ix},${iz}`, ids=this.bins.get(key) ?? []; ids.push(id); this.bins.set(key,ids);
    }
    return id;
  }
  private near(x: number, z: number) { return this.bins.get(`${Math.floor(x/BIN)},${Math.floor(z/BIN)}`) ?? NO_ZONES; }
  private distance(zone: Zone, x: number, z: number) {
    const dx=x-zone.x, dz=z-zone.z, qx=Math.abs(dx*zone.c-dz*zone.s)-zone.hx, qz=Math.abs(dx*zone.s+dz*zone.c)-zone.hz;
    return zone.ellipse ? (Math.hypot((qx+zone.hx)/zone.hx,(qz+zone.hz)/zone.hz)-1)*Math.min(zone.hx,zone.hz)
      : Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0);
  }
  looseAt(x: number, z: number, y: number) {
    let factor=1;
    for (const id of this.near(x,z)) {
      const zone=this.zones[id], d=this.distance(zone,x,z);
      if (zone.kind==='floor') { if (d<=0 && Math.abs(y-zone.y)<1) return 0; }
      else if (y<zone.y) factor=Math.min(factor,THREE.MathUtils.smoothstep(d,0,SNOW_ROOF_FADE));
    }
    return factor;
  }
  roofAt(x: number, z: number, y: number) {
    return this.near(x,z).some(id=>{const q=this.zones[id];return q.kind==='roof' && y<q.y && this.distance(q,x,z)<=0;});
  }
  floorAt(x: number, z: number, y: number) {
    return this.near(x,z).some(id=>{const q=this.zones[id];return q.kind==='floor' && Math.abs(y-q.y)<1 && this.distance(q,x,z)<=0;});
  }
  detailedAt(x: number, z: number, size: number) {
    for (let iz=Math.floor(z/BIN); iz<=Math.floor((z+size)/BIN); iz++) for (let ix=Math.floor(x/BIN); ix<=Math.floor((x+size)/BIN); ix++) {
      for (const id of this.bins.get(`${ix},${iz}`) ?? NO_ZONES) {
        const q=this.zones[id]; if (x<=q.maxX && x+size>=q.minX && z<=q.maxZ && z+size>=q.minZ) return true;
      }
    }
    return false;
  }
  upload() {
    const b=this.bounds, ox=Math.floor(b.minX/BIN), oz=Math.floor(b.minZ/BIN);
    const width=Math.ceil(b.maxX/BIN)-ox+1,height=Math.ceil(b.maxZ/BIN)-oz+1;
    const bins=new Float32Array(width*height*4),ids:number[]=[];
    for (const [key,list] of this.bins) {
      const [x,z]=key.split(',').map(Number),i=((z-oz)*width+x-ox)*4;
      if (x<ox || z<oz || x>=ox+width || z>=oz+height) continue;
      bins[i]=ids.length;bins[i+1]=list.length;ids.push(...list);
    }
    const iw=Math.min(1024,Math.max(1,ids.length)),ih=Math.max(1,Math.ceil(ids.length/iw)),indices=new Float32Array(iw*ih*4);
    ids.forEach((id,i)=>indices[i*4]=id);
    const count=Math.max(1,this.zones.length),zones=new Float32Array(count*8);
    this.zones.forEach((q,i)=>zones.set([q.x,q.z,q.hx,q.hz,q.c,q.s,q.y,q.kind==='floor'?1:q.ellipse?2:0],i*8));
    const texture=(data:Float32Array,w:number,h:number)=>{const t=new THREE.DataTexture(data,w,h,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.NearestFilter;t.needsUpdate=true;return t;};
    const u=snowCoverUniforms;u.uSnowCoverBins.value=texture(bins,width,height);u.uSnowCoverIds.value=texture(indices,iw,ih);u.uSnowCoverZones.value=texture(zones,2,count);
    u.uSnowCoverGrid.value.set(ox,oz,width,height);u.uSnowCoverIdSize.value.set(iw,ih);u.uSnowCoverCount.value=count;u.uSnowCoverEnabled.value=1;
  }
}
