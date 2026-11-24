import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Texture } from 'three';
import { stream } from './range-seed';

export function winterSky(noise:Texture) {
  const rng=stream('sky');
  const mat=new ShaderMaterial({side:BackSide,depthWrite:false,fog:false, uniforms:{
    noiseMap:{value:noise}, overcast:{value:rng.next()}, offset:{value:rng.float(0,1)}
  },vertexShader:`
    varying vec3 ray;
    void main(){ray=position;vec4 p=projectionMatrix*vec4(mat3(viewMatrix)*position,1.);gl_Position=p.xyww;}
  `,fragmentShader:`
    varying vec3 ray;uniform sampler2D noiseMap;uniform float overcast,offset;
    void main(){
      vec3 d=normalize(ray);float h=max(d.y,0.);
      vec2 uv=d.xz/max(.18,h+.12)*.075+offset;
      float cloud=smoothstep(.26,.72,texture2D(noiseMap,uv).r*.68+texture2D(noiseMap,uv*2.7).g*.32);
      vec3 horizon=vec3(.69,.75,.81);
      vec3 zenith=mix(vec3(.18,.34,.58),vec3(.36,.37,.49),overcast);
      vec3 color=mix(horizon,zenith,smoothstep(0.,.72,h));
      color=mix(color,vec3(.67,.67,.75),cloud*(.15+.37*overcast)*smoothstep(.005,.19,h));
      gl_FragColor=vec4(color,1.);
      #include <colorspace_fragment>
    }`});
  const sky=new Mesh(new SphereGeometry(1,24,12),mat);
  sky.frustumCulled=false;sky.renderOrder=-100;return sky;
}
