// Weather: outdoor temperature, wind, snowfall, fog. Includes the snow particles.
import * as THREE from 'three';
import { snowCoverShader, snowCoverUniforms } from './snow-cover';
import { G, hourOf } from '../game/ctx';
import { Rng, Simplex2, clamp, lerp } from '../core/rng';
import { Tex } from '../core/textures';

export type WeatherType = 'clear' | 'cloudy' | 'snow' | 'blizzard' | 'fog';

export const WEATHER_NAMES: Record<WeatherType, string> = {
  clear: 'Ясно',
  cloudy: 'Облачно',
  snow: 'Снегопад',
  blizzard: 'Метель',
  fog: 'Туман',
};

interface Target {
  cloud: number;
  snow: number;
  wind: [number, number];
  fog: number;
  temp: number; // offset
}

const TARGETS: Record<WeatherType, Target> = {
  clear: { cloud: 0.05, snow: 0, wind: [0.5, 3], fog: 0.0007, temp: -2 },
  cloudy: { cloud: 0.7, snow: 0, wind: [2, 5], fog: 0.0016, temp: 0 },
  snow: { cloud: 0.9, snow: 0.45, wind: [2, 6], fog: 0.006, temp: 1 },
  blizzard: { cloud: 1, snow: 1, wind: [11, 18], fog: 0.05, temp: -6 },
  fog: { cloud: 0.6, snow: 0.05, wind: [0, 1.5], fog: 0.035, temp: 1 },
};

const NEXT: Record<WeatherType, [WeatherType, number][]> = {
  clear: [['clear', 2], ['cloudy', 4], ['fog', 1], ['snow', 1]],
  cloudy: [['clear', 2], ['snow', 4], ['fog', 1], ['blizzard', 1]],
  snow: [['cloudy', 3], ['snow', 2], ['blizzard', 2], ['clear', 1]],
  blizzard: [['snow', 4], ['cloudy', 2]],
  fog: [['cloudy', 3], ['clear', 2], ['snow', 1]],
};

const SNOW_COUNT = 7000;
const BOX = 36;

export class Weather {
  type: WeatherType = 'snow';
  cloud = 0.8;
  snow = 0.4;
  wind = 3;
  windDir = 0.6; // radians, direction wind blows towards
  fog = 0.012;
  tempOffset = 0;
  temp = -15;
  private segEnd = 0;
  private windTarget = 3;
  private rng: Rng;
  private noise: Simplex2;
  points!: THREE.Points;
  private mat!: THREE.ShaderMaterial;
  private clock = 0;

  constructor(rng: Rng) {
    this.rng = rng;
    this.noise = new Simplex2(() => rng.next());
  }

  init(start: WeatherType) {
    this.setType(start, true);
    this.buildParticles();
  }

  setType(t: WeatherType, instant = false) {
    this.type = t;
    const T = TARGETS[t];
    this.windTarget = this.rng.float(T.wind[0], T.wind[1]);
    this.segEnd = G.time + this.rng.float(3, 9) * 3600;
    if (instant) {
      this.cloud = T.cloud;
      this.snow = T.snow;
      this.wind = this.windTarget;
      this.fog = T.fog;
      this.tempOffset = T.temp;
    }
  }

  /** Outdoor air temperature at a given game time. */
  airTemp(t: number) {
    const h = hourOf(t);
    // coldest around 6:00, warmest ~14:30
    const diurnal = -Math.cos(((h - 2.5) / 24) * Math.PI * 2);
    const amp = lerp(6, 2.5, this.cloud);
    const drift = this.noise.noise(t / 86400 * 1.3, 4.2) * 5;
    return G.settings.baseTemp + diurnal * amp + this.tempOffset + drift;
  }

  update(dtGame: number, dtReal: number) {
    if (G.settings.weatherLock && G.settings.weatherLock !== this.type) this.setType(G.settings.weatherLock as WeatherType);
    if (!G.settings.weatherLock && G.time > this.segEnd) {
      const opts = NEXT[this.type];
      const total = opts.reduce((s, o) => s + o[1], 0);
      let r = this.rng.float(0, total);
      let next: WeatherType = opts[0][0];
      for (const [k, w] of opts) {
        r -= w;
        if (r <= 0) {
          next = k;
          break;
        }
      }
      this.setType(next);
      G.hud?.message(`Погода меняется: ${WEATHER_NAMES[next].toLowerCase()}`, 'info');
    }
    const T = TARGETS[this.type];
    const k = 1 - Math.exp(-dtGame / 1500); // ~25 game minutes to settle
    this.cloud = lerp(this.cloud, T.cloud, k);
    this.snow = lerp(this.snow, T.snow, k);
    this.fog = lerp(this.fog, T.fog, k);
    this.tempOffset = lerp(this.tempOffset, T.temp, k);
    const gust = 1 + 0.25 * this.noise.noise(G.time / 40, 1.7);
    this.wind = lerp(this.wind, this.windTarget * gust, 1 - Math.exp(-dtGame / 300));
    this.windDir += this.noise.noise(G.time / 7200, 9.1) * dtGame * 0.00002;
    this.temp = this.airTemp(G.time);

    this.clock += dtReal;
    if (this.mat) {
      const u = this.mat.uniforms;
      u.time.value = this.clock;
      u.camPos.value.copy(G.camera.position);
      u.windVel.value.set(Math.cos(this.windDir) * this.wind, 0, Math.sin(this.windDir) * this.wind);
      u.intensity.value = this.snow;
      u.light.value = lerp(0.12, 1, G.sky?.daylight ?? 1);
      u.pxScale.value = (G.renderer.domElement.height * 0.5) * G.camera.projectionMatrix.elements[5];
    }
  }

  /** Wind chill (Environment Canada formula), wind in m/s. */
  windChill(t: number, windMs: number) {
    const v = windMs * 3.6;
    if (v < 4.8 || t > 10) return t;
    const p = Math.pow(v, 0.16);
    return 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p;
  }

  private buildParticles() {
    const g = new THREE.BufferGeometry();
    const off = new Float32Array(SNOW_COUNT * 3);
    const rnd = new Float32Array(SNOW_COUNT);
    for (let i = 0; i < SNOW_COUNT; i++) {
      off[i * 3] = Math.random() * BOX;
      off[i * 3 + 1] = Math.random() * BOX;
      off[i * 3 + 2] = Math.random() * BOX;
      rnd[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(off, 3));
    g.setAttribute('rnd', new THREE.BufferAttribute(rnd, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        ...snowCoverUniforms,
        time: { value: 0 },
        camPos: { value: new THREE.Vector3() },
        windVel: { value: new THREE.Vector3() },
        intensity: { value: 0.5 },
        light: { value: 1 },
        box: { value: BOX },
        map: { value: Tex.flake() },
        pxScale: { value: 500 },
      },
      vertexShader: /* glsl */ `
        ${snowCoverShader}
        attribute float rnd;
        uniform float time; uniform vec3 camPos; uniform vec3 windVel; uniform float intensity;
        uniform float box; uniform float pxScale;
        varying float vAlpha;
        void main() {
          vec3 vel = windVel * (0.7 + rnd * 0.6) + vec3(sin(time * (0.5 + rnd) + rnd * 30.0) * 0.4, -(0.8 + rnd * 0.9), cos(time * 0.7 + rnd * 20.0) * 0.4);
          vec3 p = position + vel * time;
          vec3 base = camPos - vec3(box * 0.5);
          p = mod(p - base, box) + base;
          float vis = step(rnd, intensity);
          if (snowCover(p).x <= 0.001) vis = 0.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = vis * (0.026 + rnd * 0.03) * pxScale / max(d, 0.6);
          vAlpha = vis * smoothstep(box * 0.5, box * 0.3, d) * smoothstep(0.2, 1.2, d);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform float light;
        varying float vAlpha;
        void main() {
          vec4 c = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * light, c.a * vAlpha * 0.9);
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    G.scene.add(this.points);
  }
}
