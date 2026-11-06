// Shared game context. Modules import G and read fields at runtime,
// which keeps module dependencies simple.
import type * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { GameAudio } from '../core/audio';
import type { Input } from '../core/input';
import type { Rng } from '../core/rng';
import type { Terrain } from '../world/terrain';
import type { Sky } from '../world/sky';
import type { Weather } from '../world/weather';
import type { Forest } from '../world/forest';
import type { House } from '../world/house';
import type { Water } from '../world/water';
import type { Region } from '../gen/region';
import type { Structures } from '../world/structures';
import type { Animals } from './animals/animals';
import type { Entities } from './entities';
import type { Player } from './player';
import type { Body } from './body';
import type { Thermal } from './thermal';
import type { Fires } from './fire';
import type { Interaction } from './interact';
import type { ViewModel } from './viewmodel';
import type { HUD } from '../ui/hud';
import type { Effects } from './effects';
import type { SnowExperiment } from './snow-experiment';
import type { WorldSnow } from './world-snow';
import type { MotionRecorder } from './motion-recorder';
import type { SnowCover } from '../world/snow-cover';
import type { BuildSystem } from './build/build';

export interface Settings {
  seed: number;
  baseTemp: number; // average outdoor temperature, °C
  timeScale: number; // game seconds per real second
  startHour: number;
  weatherLock: string | null;
  noCold: boolean;
  horror: boolean;
  size: number;
}

export interface Ctx {
  R: typeof RAPIER_T;
  world: RAPIER_T.World;
  events: RAPIER_T.EventQueue;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  settings: Settings;
  rng: Rng;
  /** game time in seconds since midnight of day 1 */
  time: number;
  audio: GameAudio;
  input: Input;
  terrain: Terrain;
  snowCover: SnowCover;
  sky: Sky;
  weather: Weather;
  forest: Forest;
  house: House;
  lake: Water;
  region: Region;
  structures: Structures;
  /** wooden structures made of real pieces (lean-tos, fences, what the player builds) */
  build: BuildSystem;
  animals: Animals;
  /** the optional goal: power the radio, call for rescue */
  goal: { signalAt: number; rescued: boolean; heliShown: boolean };
  entities: Entities;
  player: Player;
  body: Body;
  thermal: Thermal;
  fires: Fires;
  interact: Interaction;
  vm: ViewModel;
  hud: HUD;
  fx: Effects;
  snow?: SnowExperiment | WorldSnow;
  recorder?: MotionRecorder;
  paused: boolean;
  sleeping: boolean;
  dead: boolean;
  startTime: number;
  /** advance game time instantly (debug / waiting) */
  skip: (seconds: number) => void;
}

export const G = {} as Ctx;

// Collision groups: upper 16 bits membership, lower 16 bits filter
export const GR_STATIC = 0x0001;
export const GR_ITEM = 0x0002;
export const GR_PLAYER = 0x0004;
export const GR_HELD = 0x0008;
/** standing tree stems: a felled crown passes through them, the stem itself does not */
export const GR_TREE = 0x0010;
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
export const GROUPS_STATIC = groups(GR_STATIC, 0xffff);
export const GROUPS_TREE = groups(GR_TREE, 0xffff);
export const GROUPS_ITEM = groups(GR_ITEM, GR_STATIC | GR_TREE | GR_ITEM | GR_PLAYER | GR_HELD);
/** branches of a felled crown: rest on the ground and on things, slip past standing stems */
export const GROUPS_CROWN = groups(GR_ITEM, GR_STATIC | GR_ITEM | GR_PLAYER | GR_HELD);
/** a tree while it falls: hits the ground and other trees; the player is checked separately */
export const GROUPS_FALLING = groups(GR_ITEM, GR_STATIC | GR_TREE | GR_ITEM);
export const GROUPS_HELD = groups(GR_HELD, GR_STATIC | GR_TREE | GR_ITEM);
export const GROUPS_PLAYER = groups(GR_PLAYER, GR_STATIC | GR_TREE | GR_ITEM);
export const GROUPS_RAY = groups(0xffff, GR_STATIC | GR_TREE | GR_ITEM);

export function msg(text: string, kind: 'info' | 'warn' | 'good' | 'bad' = 'info') {
  G.hud?.message(text, kind);
}

export function hourOf(t: number) {
  return (t / 3600) % 24;
}

export function dayOf(t: number) {
  return Math.floor(t / 86400) + 1;
}
