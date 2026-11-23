import * as THREE from 'three';
import { Tex } from '../../core/textures';
import { groundUniforms } from '../terrain';

/** Local coordinates keep the fracture planes and snow pockets attached to the stone on every map. */
export function mountainRockMaterial(sheltered = false) {
  const material = new THREE.MeshStandardMaterial({
    roughness: .96, flatShading: false, side: THREE.DoubleSide,
  });
  material.onBeforeCompile = shader => {
    const shelterAttributes = sheltered ? 'attribute float skylight; varying float vSkylight;' : '';
    shader.uniforms.uCliffStone = { value: Tex.rock() };
    shader.uniforms.uCliffNoise = groundUniforms.uNoise;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float exposure; varying float vCatch; varying vec3 vCliff; varying vec3 vFacet;' + shelterAttributes)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCatch=exposure; vCliff=position; vFacet=normal;' + (sheltered ? 'vSkylight=skylight;' : ''));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${sheltered ? 'varying float vSkylight;' : ''}
varying vec3 vCliff;
varying float vCatch;
varying vec3 vFacet;
uniform sampler2D uCliffStone;
uniform sampler2D uCliffNoise;
float fissure(float plane, float width) {
  float d=abs(fract(plane + 0.5)-0.5);
  float aa=clamp(fwidth(plane),.001,.027);
  return 1.-smoothstep(width, width+aa,d);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  vec3 p=vCliff;
  vec3 n=normalize(vFacet);
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
  float jointA=fissure(dip+.13*floor(strike+.4),.008)*smoothstep(.28,.7,mineral);
  float jointB=fissure(strike+.07*floor(dip),.012)*smoothstep(.3,.72,broad.g);
  float ledge=fract(dip);
  float oxide=smoothstep(.37,.76,broad.g+.12*mineral)*smoothstep(.08,.65,ledge);
  vec3 stone=mix(vec3(.156,.188,.218),vec3(.236,.202,.175),oxide);
  stone *= (.67+.47*grain.g+.32*mineral) * (1.-.25*max(jointA,jointB));
  // Sheltered facets retain a discontinuous patch. Bare summit rock carries no cap, even on an upward face.
  float snow=smoothstep(.54,.88,n.y+(broad.r-.5)*.29+(mineral-.5)*.13)*vCatch;
  diffuseColor.rgb=mix(stone,vec3(.72,.80,.88),snow*.94);
  ${sheltered ? 'diffuseColor.rgb *= vSkylight;' : ''}
`);
  };
  material.customProgramCacheKey = () => sheltered ? 'mountain-cave-v1' : 'mountain-fracture-v1';
  return material;
}

/** Wind leaves shallow, elongated windslab marks and scours exposed crests. */
export function mountainSnowMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: 0xe4e8ef, roughness: .92, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    shader.uniforms.uWindgrain = groundUniforms.uNoise;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDrift;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDrift=position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDrift; uniform sampler2D uWindgrain;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 w=vec2(vDrift.x*.84+vDrift.z*.53,-vDrift.x*.53+vDrift.z*.84);
        float gust=texture2D(uWindgrain,w*vec2(.078,.27)).g;
        float relief=sin(w.y*4.1+1.3*sin(w.x*.55)+gust*1.7);
        float ripple=smoothstep(.34,.92,relief)*smoothstep(.3,.71,gust);
        diffuseColor.rgb*=mix(vec3(.85,.90,.98),vec3(1.07,1.06,1.04),gust)*(.98+.045*ripple);
      `);
  };
  material.customProgramCacheKey=()=>'mountain-windslab-v1';
  return material;
}
