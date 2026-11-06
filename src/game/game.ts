// Boot and main loop: builds the world, runs physics at a fixed step and all
// simulation systems in game time.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { G, Settings, hourOf, msg } from './ctx';
import { Rng } from '../core/rng';
import { GameAudio } from '../core/audio';
import { Input } from '../core/input';
import { Terrain } from '../world/terrain';
import { Weather, WeatherType } from '../world/weather';
import { Sky } from '../world/sky';
import { Forest } from '../world/forest';
import { House } from '../world/house';
import { Water } from '../world/water';
import { Region } from '../gen/region';
import { Structures } from '../world/structures';
import { Animals } from './animals/animals';
import { Entities, Entity } from './entities';
import { Player } from './player';
import { Body, Env, Activity } from './body';
import { Thermal } from './thermal';
import { Fires } from './fire';
import { Interaction } from './interact';
import { ViewModel } from './viewmodel';
import { Effects } from './effects';
import { HUD } from '../ui/hud';
import { Horror } from './horror';
import { def } from './items';
import { dryingAt } from './drying';
import { SnowExperiment } from './snow-experiment';
import { WorldSnow } from './world-snow';
import { SnowCover } from '../world/snow-cover';
import { MotionRecorder } from './motion-recorder';
import { BuildSystem } from './build/build';
import { Cliffs } from '../world/cliffs';
import { CliffLab } from './cliff-lab';
import { Caves } from '../world/caves';

const STEP = 1 / 60;
let horror: Horror;

export async function startGame(settings: Settings) {
  await RAPIER.init();
  G.R = RAPIER;
  G.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  G.world.timestep = STEP;
  G.events = new RAPIER.EventQueue(true);
  G.settings = settings;
  G.rng = new Rng(settings.seed);
  G.time = settings.startHour * 3600;
  G.startTime = G.time;
  G.sleeping = false;
  G.dead = false;
  G.paused = false;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  document.getElementById('app')!.appendChild(renderer.domElement);
  G.renderer = renderer;
  G.scene = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 14000);
  G.scene.add(G.camera);

  G.audio = new GameAudio();
  G.input = new Input(renderer.domElement);

  const rng = G.rng;
  const loadText = document.querySelector('#loading h2');
  const region = new Region(settings.seed, settings.size, { cliffLab: settings.cliffLab });
  await region.generate(async (stage, f) => {
    if (loadText) loadText.textContent = `Генерация мира: ${stage.toLowerCase()} — ${Math.round(f * 100)}%`;
    await new Promise((r) => setTimeout(r, 0));
  });
  if (loadText) loadText.textContent = 'Строим мир…';
  await new Promise((r) => setTimeout(r, 0));
  G.region = region;
  G.snowCover = new SnowCover({ minX: region.minX, minZ: region.minZ, maxX: region.maxX, maxZ: region.maxZ });
  G.terrain = new Terrain(region);
  G.terrain.build();
  G.weather = new Weather(rng);
  const startWeather: WeatherType = (settings.weatherLock as WeatherType) ?? rng.pick(['snow', 'cloudy', 'clear', 'snow'] as WeatherType[]);
  G.weather.init(startWeather);
  G.sky = new Sky();
  G.fx = new Effects();
  G.entities = new Entities();
  G.build = new BuildSystem();
  G.lake = new Water();
  G.lake.build(region);
  G.house = new House();
  G.house.build(rng);
  G.forest = new Forest();
  G.forest.build(rng);
  G.thermal = new Thermal();
  G.body = new Body();
  G.fires = new Fires();
  G.fires.init();
  G.goal = { signalAt: 0, rescued: false, heliShown: false };
  G.structures = new Structures();
  G.structures.build(new Rng(settings.seed * 31 + 5));
  // rock registers its shelters before the snow layout is uploaded
  if (region.cliffs.length || region.skin?.blocks.length) G.cliffs = new Cliffs(region.cliffs, region.skin);
  // cave mouths too (their throats are roofs for the snow)
  if (region.caves.length) G.caves = new Caves(region.caves);
  G.animals = new Animals();
  await G.animals.load();
  // loud work carries far: animals hear it
  const LOUD: Record<string, number> = { chop: 70, tree_fall: 120, glass: 90, hammer: 70, saw: 45, ice_break: 60, thud: 25, creak: 15 };
  G.audio.onSound = (name, pos) => {
    const r = LOUD[name];
    if (r) G.animals.noise(pos ?? G.player.pos, r);
  };
  G.player = new Player();
  const { spawn, yaw } = settings.caveLab && region.caves.length ? caveSpawn() : findSpawn(rng);
  G.player.init(spawn, yaw);
  G.interact = new Interaction();
  G.vm = new ViewModel();
  G.hud = new HUD();
  horror = new Horror();
  G.skip = skip;

  // starting clothes and a chocolate bar
  for (const id of ['jeans', 'sweater', 'jacket_light', 'sneakers']) {
    const e = G.entities.spawnItem(id, new THREE.Vector3(0, -50, 0));
    G.player.addToInventory(e);
    G.player.worn.set(e.def!.wear!.slot, e);
  }
  G.player.addToInventory(G.entities.spawnItem('chocolate', new THREE.Vector3(0, -50, 0)));

  // stream the world around the player, then let furniture and loot settle
  G.terrain.update(G.camera.position.copy(G.player.eyePos), 400);
  G.cliffs?.update(G.player.pos, G.player.pos, Infinity);
  G.forest.update(G.player.pos, true);
  G.lake.stream(G.player.pos, 60);
  for (let i = 0; i < 150; i++) G.world.step(G.events);
  G.entities.sync();
  for (const e of G.entities.list) G.entities.syncOne(e);
  G.thermal.init();
  G.weather.update(0, 0);
  G.sky.update();

  G.snow = new URLSearchParams(location.search).get('snow') === '1' ? new SnowExperiment() : new WorldSnow();
  // fire pits that came with the world are dug out of the snow
  if (G.snow instanceof WorldSnow) for (const f of G.fires.list) if (f.kind === 'camp') G.snow.clearPit(f.pos);
  if (!G.snow.isExperiment) G.player.avatar.reset();
  if (region.cliffLab) G.cliffLab = new CliffLab();
  G.recorder = new MotionRecorder();

  window.addEventListener('resize', onResize);
  onResize();
  G.input.onLockChange = (locked) => {
    if (locked || G.recorder?.reviewing) G.hud.showPause(false);
    else if (!G.hud.modal && !G.dead) G.hud.showPause(true);
  };
  renderer.domElement.addEventListener('click', () => {
    if (G.recorder?.reviewing) return;
    if (!G.input.locked && !G.hud.modal) G.hud.resume();
  });

  (window as any).__game = testApi();
  hud_intro();
  requestAnimationFrame(loop);
}

function hud_intro() {
  msg('Холодает. Впереди — дом. Внутри можно согреться.', 'info');
  setTimeout(() => msg('F1 — управление, Tab — инвентарь, F3 — параметры', 'info'), 2500);
}

function findSpawn(rng: Rng) {
  const T = G.terrain;
  // in front of the porch, looking at the house
  for (let i = 0; i < 300; i++) {
    const a = Math.PI / 2 + rng.float(-0.9, 0.9);
    const d = rng.float(13, 19);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!Number.isNaN(G.region.waterAt(x, z))) continue;
    if (x > 3 && x < 10 && z > -4 && z < 7) continue;
    if (G.forest.treesNear(x, z, 2).length) continue;
    if (G.region.slopeAt(x, z) > 0.4) continue;
    const yaw = Math.atan2(x, z); // face the house
    return { spawn: new THREE.Vector3(x, T.heightAt(x, z) + 0.05, z), yaw };
  }
  return { spawn: new THREE.Vector3(0, T.heightAt(0, 15) + 0.05, 15), yaw: 0 };
}

/** In front of the cave mouth nearest to the house, facing it. */
function caveSpawn() {
  const c = [...G.region.caves].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
  const ux = Math.sin(c.yaw), uz = Math.cos(c.yaw);
  const x = c.x - ux * 7, z = c.z - uz * 7;
  return { spawn: new THREE.Vector3(x, G.terrain.heightAt(x, z) + 0.05, z), yaw: Math.atan2(-ux, -uz) };
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  G.renderer.setSize(w, h);
  G.camera.aspect = w / h;
  G.camera.updateProjectionMatrix();
  G.vm.resize(w / h);
}

let last = performance.now();
let acc = 0;

function handleGlobalKeys() {
  const inp = G.input;
  const hud = G.hud;
  const P = G.player;
  const pressed = inp.pressed;
  if (pressed.has('Tab') || (pressed.has('KeyI') && !hud.sleepOpen)) {
    if (!G.dead && !G.sleeping) hud.toggleInventory();
  }
  if (pressed.has('F3') || pressed.has('Backquote')) hud.toggleDebug();
  if (pressed.has('F1')) hud.toggleHelp();
  if (pressed.has('F6')) msg(P.avatar.cycleInspection() + ' [F6]', 'info');
  if (pressed.has('KeyM') && !G.dead) hud.toggleMap();
  if (hud.readerOpen && (pressed.has('KeyE') || pressed.has('Escape'))) hud.closeReader();
  if (pressed.has('Escape')) {
    if (hud.invOpen) hud.toggleInventory(false);
    if (hud.mapOpen) hud.toggleMap(false);
    if (hud.helpOpen) hud.toggleHelp(false);
  }
  if (!inp.enabled || G.sleeping || G.dead) return;
  P.handsWarming = inp.down('KeyH') && !P.carried && !G.interact.swinging;
  if (inp.hit('KeyX') && G.body.snow > 0.02) {
    G.interact.timed = { action: { key: 'E', label: 'Отряхнуть снег', time: 2, run: () => { G.body.snow = 0; msg('Снег стряхнут', 'info'); } }, t: 0, start: P.pos.clone() };
  }
  if (inp.hit('KeyZ')) hud.openSleep('floor');
  if (inp.hit('KeyV')) hud.cycleOverlay();
  if (inp.hit('KeyN') && G.audio.music) {
    G.audio.music.setEnabled(!G.audio.music.enabled);
    msg(G.audio.music.enabled ? 'Музыка включена [N]' : 'Музыка выключена [N]', 'info');
  }
  if (inp.hit('KeyT')) hud.openSleep('wait');
  for (let i = 1; i <= 9; i++) {
    if (inp.hit('Digit' + i)) {
      const list = hud.hotbarItems();
      const e = list[i - 1];
      if (e && !P.carried) P.equip(e);
    }
  }
}

function activity(): Activity {
  const P = G.player;
  if (P.water) return 'water';
  if (G.sleeping && G.hud.sleepEnv().sleeping) return 'sleep';
  if (G.interact.swinging || G.interact.timed || P.workT > 0 || (P.carried && P.carried.mass > 15)) return 'work';
  return P.lastActivity;
}

function bodyEnv(): Env {
  const P = G.player;
  const zone = G.house.zoneAt(P.pos);
  const W = G.weather;
  const chest = P.pos.clone().add(new THREE.Vector3(0, P.crouch ? 0.7 : 1.2, 0));
  let air = W.temp;
  let wind = 0;
  let rh = 0.85;
  let surfaces = 0;
  const cave = G.caves?.envAt(P.pos) ?? null;
  if (cave) {
    // in a cave: no wind beyond the mouth, the air of the rock, warmed by a fire nearby
    air = cave.air;
    wind = cave.wind;
    rh = 0.9;
  } else if (!zone) {
    const inForest = !G.lake.onIce(P.pos) && G.region.forestAt(P.pos.x, P.pos.z) > 0.35;
    wind = W.wind * (inForest ? 0.65 : 1);
    // porch roof and walls give a little shelter
    if (Math.abs(P.pos.x - 2) < 3 && P.pos.z > 3.9 && P.pos.z < 6.2) wind *= 0.6;
    // huts, the grotto, the station: out of the wind, and a fire inside warms the air
    if (G.build.roofOver(P.eyePos)) wind *= 0.75;
    const sh = G.structures.shelterAt(P.pos);
    if (sh) {
      wind *= sh.wind;
      let heat = 0;
      if (sh.enclosed) for (const f of G.fires.list) if (f.kind === 'camp' && f.burning && G.structures.shelterAt(f.pos) === sh) heat += f.power;
      air = W.temp + sh.warm + Math.min(30, heat * 2.6);
    }
  } else {
    air = G.thermal.tAt(chest);
    wind = Math.min(5, G.thermal.draftAt(chest));
    // standing in the jet from a broken window you breathe almost outdoor air
    air += (W.temp - air) * Math.min(0.7, wind / 3);
    rh = G.thermal.rhAt(chest);
    // cold walls and glass nearby pull warmth out of you by radiation
    surfaces = 0.45 * (G.thermal.mrtAt(chest) - air);
  }
  const sun = !zone && !cave ? 3 * G.sky.daylight * (1 - W.cloud) : 0;
  const se = G.hud.sleepEnv();
  const eq = P.equipped;
  const metal = !!eq && ['axe', 'saw', 'hammer', 'prybar', 'auger', 'shovel', 'pot', 'bucket'].includes(eq.defId);
  return {
    air,
    wind,
    radiant: G.fires.radiantAt(P.pos, zone) + sun + surfaces,
    inWater: !!P.water,
    sleeping: se.sleeping,
    bedding: se.bedding,
    wrapClo: P.wrapped?.def?.insul ?? 0,
    handsWarming: P.handsWarming,
    lampInHand: eq?.defId === 'lamp' && eq.lit,
    metalTool: metal,
    outdoors: !zone && !cave,
    snowfall: cave || G.snowCover.roofAt(P.pos.x, P.pos.z, P.eyePos.y) || G.build.roofOver(P.eyePos) ? 0 : W.snow,
    rh,
  };
}

/** Wood, matches and clothes dry in warm dry air and get damp in cold humid corners. */
function updateMoisture(dtGame: number) {
  const P = G.player;
  for (const e of G.entities.list) {
    if (e.removed || e.kind === 'part' || e.kind === 'stump') continue;
    const d = e.def;
    if (!(d?.fuel || d?.wear || d?.insul || e.defId === 'matches')) continue;
    if (P.isWorn(e)) continue; // worn clothes follow the body
    const carried = P.inventory.includes(e) || P.wrapped === e;
    if (!carried && !e.inWorld) continue;
    const p = carried ? P.pos.clone().add(new THREE.Vector3(0, 1, 0)) : e.position();
    const fabric = !!(d?.wear || d?.insul);
    const st = dryingAt(p, fabric, carried && P.wrapped !== e);
    const before = e.moisture;
    const floor = d?.fuel && !fabric ? 0.03 : 0;
    e.moisture = Math.min(fabric ? 1 : 0.5, Math.max(floor, e.moisture + st.rate * dtGame));
    if (G.house.zoneAt(p) && e.moisture < before) G.thermal.addVapour(p, (before - e.moisture) * 400 * e.mass);
  }
}

/** Worn clothes share the body's wetness; putting on dry things makes you drier. */
function syncWornWetness() {
  const P = G.player;
  for (const e of P.worn.values()) if (e.def?.wear && e.def.wear.slot !== 'back') e.moisture = G.body.wetness;
}

const lampLights = new Map<Entity, THREE.PointLight>();

function updateLights(dtGame: number) {
  const P = G.player;
  // flashlight
  const fl = P.equipped?.defId === 'flashlight' && P.equipped.lit ? P.equipped : null;
  if (fl) {
    const cold = G.house.zoneAt(P.pos) || G.caves?.inside ? 1 : G.weather.temp < -15 ? 1.8 : 1.3;
    fl.charges = Math.max(0, fl.charges - (dtGame / (3 * 3600)) * 100 * cold);
    if (fl.charges <= 0) {
      fl.lit = false;
      msg('Фонарик погас — батарейка села', 'warn');
    }
    // eyes used to the dark of a cave see further by its beam
    G.fx.spot.intensity = 14 * Math.min(1, 0.3 + fl.charges / 40) * (G.caves?.inside ? 1.6 : 1);
    G.fx.spot.distance = G.caves?.inside ? 40 : 28;
  } else G.fx.spot.intensity = 0;
  // kerosene lamps (in hand or placed)
  for (const e of G.entities.list) {
    if (e.defId !== 'lamp') continue;
    const inHand = P.equipped === e;
    const visible = inHand || e.inWorld || !!e.pinned;
    if (e.lit && visible) {
      e.charges = Math.max(0, e.charges - (dtGame / (8 * 3600)) * 100);
      if (e.charges <= 0) {
        e.lit = false;
        msg('Лампа погасла — кончился керосин', 'warn');
      }
    }
    let l = lampLights.get(e);
    if (e.lit && visible && !e.removed) {
      if (!l) {
        l = G.fx.acquireLight() ?? undefined;
        if (l) {
          l.color.setHex(0xffc27a);
          lampLights.set(e, l);
        }
      }
      if (l) {
        const p = inHand ? G.camera.position.clone().add(P.forward().multiplyScalar(0.45)).add(new THREE.Vector3(0, -0.2, 0)) : e.position().add(new THREE.Vector3(0, 0.12, 0));
        l.position.copy(p);
        l.intensity = 2.2 * (0.92 + Math.random() * 0.08);
        l.distance = 9;
      }
      const wick = e.obj?.getObjectByName('wick') as THREE.Mesh | undefined;
      if (wick) (wick.material as THREE.MeshStandardMaterial).emissive.setHex(0xffaa44);
    } else if (l) {
      G.fx.releaseLight(l);
      lampLights.delete(e);
    }
    if (!e.lit) {
      const wick = e.obj?.getObjectByName('wick') as THREE.Mesh | undefined;
      if (wick) (wick.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
    }
  }
}

function contactEvents() {
  G.events.drainContactForceEvents((ev) => {
    const a = G.entities.byCollider.get(ev.collider1());
    const b = G.entities.byCollider.get(ev.collider2());
    const win = a?.kind === 'window' ? a : b?.kind === 'window' ? b : null;
    const other = win === a ? b : a;
    if (!win || !other || other.kind !== 'item' || win.data.glass !== 'intact' || win.data.cover) return;
    const d = other.def;
    // soft things (blankets, clothes, paper, boughs) don't break glass
    const soft = !!d && (!!d.wear || !!d.insul || ['cloth', 'paper', 'tinder', 'boughs'].includes(d.fuel?.kind ?? ''));
    if (soft) return;
    // pressing something you hold against the glass needs real force; a throw breaks it
    const need = G.player.carried === other ? 1500 : 260;
    if (ev.maxForceMagnitude() > need) G.house.breakGlass(win);
  });
  G.events.drainCollisionEvents(() => {});
}

function simulate(dtGame: number, dtReal: number) {
  G.time += dtGame;
  G.weather.update(dtGame, dtReal);
  G.fires.update(dtGame, dtReal);
  G.thermal.update(dtGame);
  G.lake.update(dtGame);
  G.build.update(dtGame);
  updateLights(dtGame);
  updateMoisture(dtGame);
  G.player.workT = Math.max(0, G.player.workT - dtReal);
  G.body.activity = activity();
  const wet0 = G.body.wetness;
  G.body.update(dtGame, bodyEnv(), G.player.worn);
  syncWornWetness();
  // drying clothes put water vapour into the room
  if (G.body.wetness < wet0 && G.house.zoneAt(G.player.pos)) G.thermal.addVapour(G.player.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), (wet0 - G.body.wetness) * 900);
}

function musicMood() {
  const B = G.body, W = G.weather;
  if (B.core < 35.4 || B.condition < 25) return 'danger' as const;
  const fire = G.fires.nearest(G.player.pos);
  if (fire.level > 0.2 && fire.pos && fire.pos.distanceTo(G.player.pos) < 4) return 'calm' as const;
  if (G.sky.daylight < 0.2 && W.cloud < 0.3) return 'wonder' as const;
  if (W.type === 'blizzard' || G.sky.daylight < 0.25) return 'bleak' as const;
  return W.cloud < 0.4 ? ('wonder' as const) : ('bleak' as const);
}

/** The optional goal: after the signal a helicopter comes when the weather allows. */
function updateGoal() {
  const g = G.goal;
  if (!g.signalAt || g.rescued) return;
  const st = G.structures.station;
  if (!st) return;
  const wait = G.time - g.signalAt;
  if (wait > 8 * 3600 && G.weather.type !== 'blizzard' && G.weather.type !== 'fog') {
    if (!g.heliShown) {
      g.heliShown = true;
      msg('Сквозь ветер — гул винтов. Вертолёт идёт к метеостанции!', 'good');
    }
    if (Math.hypot(G.player.pos.x - st.x, G.player.pos.z - st.z) < 60) {
      g.rescued = true;
      G.hud.showEnding();
    } else if (wait > 11 * 3600) {
      g.signalAt = G.time - 2 * 3600; // they will try again later
      g.heliShown = false;
      msg('Вертолёт покружил над хребтом и ушёл. Нужно быть у станции, когда он вернётся.', 'warn');
    }
  }
}

/** Advance time quickly (waiting / debug). */
function skip(seconds: number) {
  let left = seconds;
  while (left > 0) {
    const s = Math.min(60, left);
    left -= s;
    simulate(s, 0);
    if (G.dead) break;
  }
  G.sky.update();
}

function loop(now: number) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  const inp = G.input;
  if (!G.recorder?.reviewing) handleGlobalKeys();
  const paused = G.recorder?.reviewing || G.paused || (!inp.locked && !G.hud.modal && !(window as any).__test);

  if (!paused && !G.dead) {
    G.player.look();
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      G.recorder?.beginTick();
      G.player.physics(STEP);
      G.house.updateDoor(STEP);
      G.world.step(G.events);
      G.player.avatar.update(STEP);
      contactEvents();
      G.recorder?.endTick();
      acc -= STEP;
      steps++;
    }
    if (steps >= 5) acc = 0;
    G.entities.sync();
    G.forest.updateFalling(STEP * steps);
    let dtGame = dt * G.settings.timeScale;
    if (G.sleeping) dtGame = G.hud.sleepStep(dt);
    simulate(dtGame, dt);
    if (!G.caves?.inside) horror.update(dtGame, dt);
  }
  G.caves?.update(dt);
  const inCave = !!G.caves?.inside;
  G.player.renderAlpha = paused || G.dead ? 1 : acc / STEP;
  if (!G.recorder?.reviewing) {
    G.player.updateCamera(dt);
    if (!inCave) G.snow?.update(paused ? 0 : dt);
    G.cliffLab?.update(dt);
  }
  // the outdoor world stands still while you are in a cave
  if (!inCave) {
    G.terrain.update(G.camera.position);
    G.cliffs?.update(G.camera.position, G.player.pos);
    G.forest.update(G.player.pos);
    G.entities.cull(dt, G.camera.position);
    G.lake.stream(G.player.pos);
  }
  G.structures.update(dt);
  if (!paused && !G.dead && !inCave) G.animals.update(dt);
  updateGoal();
  G.interact.update(paused ? 0 : dt);
  const indoorAmb = G.sky.daylight > 0.3 ? 0.5 : 0.75;
  G.sky.indoorFactor = THREE.MathUtils.lerp(G.sky.indoorFactor, inCave ? 0.04 : G.house.zoneAt(G.player.pos) ? indoorAmb : 1, Math.min(1, dt * 2));
  G.sky.update();
  G.fx.update(dt);
  G.vm.update(dt);
  G.audio.setListener(G.camera.position, G.player.forward());
  G.audio.update(dt, inCave ? 0 : G.weather.wind * (G.structures.shelterAt(G.player.pos)?.wind ?? 1), inCave || !!G.house.zoneAt(G.player.pos) || !!G.structures.shelterAt(G.player.pos), G.fires.nearest(G.player.pos));
  G.audio.setMood(musicMood());
  G.hud.update(dt);
  G.recorder?.present();

  G.renderer.clear();
  const avatar = G.player.avatar;
  G.renderer.render(G.scene, G.recorder?.reviewing ? G.recorder.camera : avatar.inspectionView ? avatar.inspectionCamera : G.camera);
  if (!avatar.inspectionView && !G.recorder?.reviewing && !G.cliffLab?.orbiting) G.vm.render(G.renderer);
  G.recorder?.captureFrame(dt, G.player.renderAlpha);
  G.hud.performance.frame(now);
  inp.endFrame();
}

// ---------- test/debug API (used by automated browser tests) ----------

function testApi() {
  const P = () => G.player;
  return {
    G,
    THREE,
    /** Deterministic frame-by-frame inspection; rendering and UI keep running. */
    setManualStepping(enabled: boolean) {
      G.paused = enabled;
    },
    lookAt(x: number, y: number, z: number) {
      const e = P().eyePos;
      const dx = x - e.x, dy = y - e.y, dz = z - e.z;
      P().yaw = Math.atan2(-dx, -dz);
      P().pitch = Math.atan2(dy, Math.hypot(dx, dz));
      G.player.updateCamera(0);
      G.camera.updateMatrixWorld(true);
    },
    teleport(x: number, y: number, z: number) {
      const c = P().carried;
      P().teleport(new THREE.Vector3(x, y, z));
      if (c?.body) {
        const p = P().eyePos.add(P().forward().multiplyScalar(1.2));
        c.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      }
    },
    /** go into a cave (or out of it) at once */
    cave(i: number, enter = true) {
      G.caves?.jump(i, enter);
      this.steps(30);
      return G.caves?.stats();
    },
    /** stand ~dist metres from a point, on the right floor, and look at it */
    approach(x: number, y: number, z: number, dist = 0.9) {
      const G_ = G;
      const target = new THREE.Vector3(x, y, z);
      const zone = G_.house.zoneAt(target);
      const dir = new THREE.Vector3(-x, 0, -z * 0.3);
      if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
      dir.normalize();
      const px = x + dir.x * dist, pz = z + dir.z * dist;
      const py = zone === 'ground' ? G_.house.Y0 + 0.02 : zone === 'upper' ? G_.house.Y0 + 3.02 : G_.terrain.heightAt(px, pz) + 0.05;
      this.teleport(px, py, pz);
      this.steps(10);
      this.lookAt(x, y, z);
    },
    actions() {
      G.interact.update(0);
      return { info: G.interact.info, target: G.interact.target.kind, actions: G.interact.actions.map((a) => `${a.key}:${a.label}`) };
    },
    act(key: string, match?: string) {
      G.interact.update(0);
      const a = G.interact.actions.find((x) => x.key === key && (!match || x.label.includes(match)));
      if (!a) return false;
      a.run();
      return true;
    },
    swing() {
      const eq = P().equipped;
      if (!eq) return false;
      G.camera.updateMatrixWorld(true);
      (G.interact as any).resolveHit(eq);
      return true;
    },
    give(id: string, opts: Record<string, number> = {}) {
      const e = G.entities.spawnItem(id, P().eyePos, { charges: opts.charges ?? def(id).charges, moisture: opts.moisture });
      if (e.pocket) P().addToInventory(e);
      return e.id;
    },
    equip(id: string) {
      const e = P().inventory.find((x) => x.defId === id);
      if (e) {
        if (P().equipped !== e) P().equip(e);
        return true;
      }
      return false;
    },
    find(defId: string) {
      return G.entities.list.filter((e) => e.defId === defId && !e.removed).map((e) => ({ id: e.id, pos: e.position().toArray(), inWorld: e.inWorld, pinned: e.pinned }));
    },
    entity(id: number) {
      return G.entities.list.find((e) => e.id === id) ?? null;
    },
    simulate(seconds: number) {
      skip(seconds);
    },
    steps(n: number) {
      if (G.recorder?.reviewing) return;
      for (let i = 0; i < n; i++) {
        G.recorder?.beginTick();
        G.player.physics(STEP);
        G.house.updateDoor(STEP);
        G.world.step(G.events);
        G.player.avatar.update(STEP);
        contactEvents();
        G.recorder?.endTick();
        G.forest.updateFalling(STEP);
      }
      G.entities.sync();
    },
    animation() {
      P().avatar.render(1, 0);
      return P().avatar.snapshot();
    },
    state() {
      const B = G.body;
      return {
        time: hourOf(G.time),
        core: B.core, hands: B.hands, kcal: B.kcal, water: B.water, condition: B.condition, wet: B.wetness,
        ground: G.thermal.zone('ground').T, upper: G.thermal.zone('upper').T, out: G.weather.temp,
        groundUA: G.thermal.zone('ground').ua, upperUA: G.thermal.zone('upper').ua,
        stove: G.fires.stoveFire.status(), stovePower: G.fires.stoveFire.power,
        inv: P().inventory.map((e) => e.defId),
        pos: P().pos.toArray(),
        dead: G.dead,
      };
    },
  };
}
