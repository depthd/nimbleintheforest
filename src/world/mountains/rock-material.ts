import * as THREE from 'three';
import { Tex } from '../../core/textures';
import { groundUniforms } from '../terrain';

/** Local coordinates keep the fracture planes and snow pockets attached to the stone on every map. */
export function mountainRockMaterial() {
  const material = new THREE.MeshStandardMaterial({
    roughness: .96, flatShading: true, side: THREE.DoubleSide,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.uCliffStone = { value: Tex.rock() };
    shader.uniforms.uCliffNoise = groundUniforms.uNoise;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float exposure; varying float vCatch; varying vec3 vCliff;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCatch=exposure; vCliff=position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vCliff;
varying float vCatch;
uniform sampler2D uCliffStone;
uniform sampler2D uCliffNoise;
float fissure(float plane, float width) {
  float d=abs(fract(plane + 0.5)-0.5);
  float aa=max(fwidth(plane),.001);
  return 1.-smoothstep(width, width+aa,d);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  vec3 p=vCliff;
  vec3 n=normalize(cross(dFdx(p),dFdy(p)));
  vec3 weight=pow(abs(n),vec3(4.));
  weight /= max(.001,weight.x+weight.y+weight.z);
  vec3 q=p*.14;
  vec3 grain=texture2D(uCliffStone,q.zy).rgb*weight.x +
             texture2D(uCliffStone,q.xz).rgb*weight.y + texture2D(uCliffStone,q.xy).rgb*weight.z;
  float lateral=p.x*.73+p.z*.64;
  vec4 broad=texture2D(uCliffNoise,vec2(lateral*.031,p.y*.054+p.z*.013));
  float mineral=texture2D(uCliffNoise,vec2(lateral*.114+p.y*.036,p.y*.119-p.x*.021)).g;
  // Two widely spaced joint families: long oblique seams terminating at shorter transverse fractures.
  float dip=p.y*.23+lateral*.048+.22*broad.r;
  float strike=(p.x*.71-p.z*.72)*.135-p.y*.047+.18*broad.g;
  float jointA=fissure(dip+.13*floor(strike+.4),.011)*smoothstep(.28,.7,mineral);
  float jointB=fissure(strike+.07*floor(dip),.018)*smoothstep(.3,.72,broad.g);
  float ledge=fract(dip);
  float oxide=smoothstep(.37,.76,broad.g+.12*mineral)*smoothstep(.08,.65,ledge);
  vec3 stone=mix(vec3(.156,.188,.218),vec3(.279,.215,.172),oxide);
  stone *= (.67+.47*grain.g+.32*mineral) * (1.-.52*max(jointA,jointB));
  // Sheltered facets retain a discontinuous patch. Bare summit rock carries no cap, even on an upward face.
  float snow=smoothstep(.54,.88,n.y+(broad.r-.5)*.29+(mineral-.5)*.13)*vCatch;
  diffuseColor.rgb=mix(stone,vec3(.72,.80,.88),snow*.94);
`);
  };
  material.customProgramCacheKey = () => 'mountain-fracture-v1';
  return material;
}
