// Sky dome, sun/moon light, ambient light, stars and fog colour by time of day.
import * as THREE from 'three';
import { G, hourOf } from '../game/ctx';
import { clamp, lerp, smoothstep } from '../core/rng';
import { groundUniforms } from './terrain';
import { waterUniforms } from './water';

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function mixColor(out: THREE.Color, stops: [number, number][], h: number) {
  // stops: [hour, hex]
  for (let i = 0; i < stops.length - 1; i++) {
    const [h0, c0] = stops[i];
    const [h1, c1] = stops[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / (h1 - h0);
      tmpA.setHex(c0);
      tmpB.setHex(c1);
      return out.copy(tmpA).lerp(tmpB, t);
    }
  }
  return out.setHex(stops[stops.length - 1][1]);
}

const TOP: [number, number][] = [
  [0, 0x05070d], [5, 0x0a1020], [6.5, 0x3a4a6e], [8, 0x6d8fbf], [12, 0x7ea3d4],
  [16, 0x6d8fbf], [17.5, 0x4a5a86], [19, 0x141c33], [21, 0x070a14], [24, 0x05070d],
];
const HORIZON: [number, number][] = [
  [0, 0x0d1220], [5, 0x1a2036], [6.5, 0xd99a7a], [8, 0xc9d6e4], [12, 0xdbe5ef],
  [16, 0xc9d6e4], [17.5, 0xe3a07a], [19, 0x2a2840], [21, 0x10142a], [24, 0x0d1220],
];

export class Sky {
  dome: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  stars: THREE.Points;
  sunDir = new THREE.Vector3();
  daylight = 1; // 0 night .. 1 day
  fogColor = new THREE.Color();
  private mat: THREE.ShaderMaterial;
  indoorFactor = 1;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(1, 0.9, 0.7) },
        sunVis: { value: 1 },
        overcast: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor;
        uniform float sunVis; uniform float overcast;
        varying vec3 vDir;
        void main() {
          float y = max(vDir.y, 0.0);
          vec3 col = mix(horizon, top, pow(y, 0.55));
          if (vDir.y < 0.0) col = horizon * (1.0 + vDir.y * 0.4);
          float d = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          float glow = pow(d, 8.0) * 0.35 + pow(d, 900.0) * 3.0;
          col += sunColor * glow * sunVis * (1.0 - overcast * 0.85);
          vec3 grey = vec3(dot(col, vec3(0.33)));
          col = mix(col, grey * 1.05, overcast * 0.75);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(11000, 32, 16), this.mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    G.scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    G.scene.add(this.sun);
    G.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0xe8eef5, 0.6);
    G.scene.add(this.hemi);

    const sg = new THREE.BufferGeometry();
    const n = 1800;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const y = Math.abs(u);
      p[i * 3] = Math.cos(a) * r * 10000;
      p[i * 3 + 1] = y * 10000;
      p[i * 3 + 2] = Math.sin(a) * r * 10000;
    }
    sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }),
    );
    this.stars.frustumCulled = false;
    G.scene.add(this.stars);

    G.scene.fog = new THREE.FogExp2(0xcccccc, 0.01);
  }

  update() {
    const h = hourOf(G.time);
    const w = G.weather;
    // sun path: rises ~7:30, sets ~16:45 (northern winter), low arc
    const dayFrac = (h - 7.5) / (16.75 - 7.5);
    const elev = Math.sin(clamp(dayFrac, -0.6, 1.6) * Math.PI) * 0.42; // radians-ish height
    const az = lerp(-1.2, 1.2, clamp(dayFrac, -0.3, 1.3));
    this.sunDir.set(Math.sin(az), Math.sin(elev), -Math.cos(az)).normalize();
    const sunUp = smoothstep(-0.08, 0.12, this.sunDir.y);
    this.daylight = sunUp;

    const overcast = clamp(w.cloud, 0, 1);
    const top = mixColor(new THREE.Color(), TOP, h);
    const hor = mixColor(new THREE.Color(), HORIZON, h);
    // weather tint: overcast/blizzard pushes towards grey
    const grey = new THREE.Color().setScalar(lerp(0.05, 0.72, sunUp * 0.9 + 0.08));
    top.lerp(grey, overcast * 0.6);
    hor.lerp(grey, overcast * 0.7);
    this.mat.uniforms.top.value.copy(top);
    this.mat.uniforms.horizon.value.copy(hor);
    this.mat.uniforms.sunDir.value.copy(this.sunDir);
    this.mat.uniforms.sunVis.value = sunUp;
    this.mat.uniforms.overcast.value = overcast;
    this.mat.uniforms.sunColor.value.setRGB(1, lerp(0.55, 0.92, smoothstep(0, 0.3, this.sunDir.y)), lerp(0.35, 0.8, smoothstep(0, 0.3, this.sunDir.y)));

    // lights
    const p = G.player?.pos ?? new THREE.Vector3();
    const moon = 1 - sunUp;
    const lightDir = sunUp > 0.02 ? this.sunDir : new THREE.Vector3(-0.3, 0.6, 0.5).normalize();
    this.sun.position.copy(p).addScaledVector(lightDir, 120);
    this.sun.target.position.copy(p);
    const sunI = sunUp * lerp(2.6, 0.6, overcast);
    const moonI = moon * lerp(0.35, 0.06, overcast);
    this.sun.intensity = sunI + moonI;
    if (sunUp > 0.02) this.sun.color.setRGB(1, lerp(0.7, 0.96, smoothstep(0, 0.3, this.sunDir.y)), lerp(0.55, 0.9, smoothstep(0, 0.3, this.sunDir.y)));
    else this.sun.color.setRGB(0.6, 0.7, 1);

    // snowy nights are not pitch black: moon and starlight bounce off the snow
    const night = lerp(0.2, 0.09, overcast);
    const amb = lerp(night, lerp(0.85, 1.1, overcast), sunUp) * this.indoorFactor;
    this.hemi.intensity = amb;
    this.hemi.color.copy(top).lerp(new THREE.Color(0xffffff), 0.4);
    this.hemi.groundColor.setRGB(0.85, 0.88, 0.92).multiplyScalar(lerp(0.2, 1, sunUp));

    (this.stars.material as THREE.PointsMaterial).opacity = moon * (1 - overcast) * 0.9;

    // fog
    const fog = G.scene.fog as THREE.FogExp2;
    this.fogColor.copy(hor).lerp(grey, 0.3 + overcast * 0.5);
    if (w.snow > 0.6) this.fogColor.lerp(new THREE.Color().setScalar(lerp(0.08, 0.8, sunUp)), (w.snow - 0.6) * 1.5);
    fog.color.copy(this.fogColor);
    fog.density = w.fog;

    // ground sparkle and water reflections follow the sky
    groundUniforms.uSunDir.value.copy(lightDir);
    groundUniforms.uGlint.value = sunUp * (1 - overcast * 0.9);
    waterUniforms.uSunDir.value.copy(lightDir);
    waterUniforms.uSkyTop.value.copy(top);
    waterUniforms.uSkyHorizon.value.copy(hor);
    waterUniforms.uSunColor.value.copy(this.sun.color).multiplyScalar(sunUp * (1 - overcast));
    waterUniforms.uTime.value = performance.now() / 1000;
    this.dome.position.copy(G.camera.position);
    this.stars.position.copy(G.camera.position);
    G.caves?.applySky();
  }
}
