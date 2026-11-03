// Fire simulation for the stove and campfires: fuel items catch from each other,
// burn down, leave embers, heat the room and cook food/melt snow on top.
import * as THREE from 'three';
import { G, GROUPS_STATIC, msg } from './ctx';
import { Entity } from './entities';
import { def, FuelKind, FUEL_KIND_NAMES } from './items';
import { clamp } from '../core/rng';
import { Tex } from '../core/textures';
import { M } from './meshes';

export interface FuelItem {
  defId: string;
  name: string;
  kind: FuelKind;
  power: number;
  remaining: number;
  total: number;
  ignite: number;
  moisture: number;
  burning: boolean;
  ramp: number;
}

export class Fire {
  kind: 'stove' | 'camp';
  pos: THREE.Vector3;
  entity: Entity;
  fuel: FuelItem[] = [];
  embers = 0;
  power = 0; // kW
  capacity: number;
  spots: (Entity | null)[] = [null, null];
  spotPos: THREE.Vector3[];
  light: THREE.PointLight | null = null;
  flames: THREE.Sprite[] = [];
  smokeT = 0;
  sparkT = 0;
  shelter = 0;
  out = false;
  damper = false; // stove only: closed damper = slow burn

  constructor(kind: 'stove' | 'camp', pos: THREE.Vector3, entity: Entity, spotPos: THREE.Vector3[]) {
    this.kind = kind;
    this.pos = pos.clone();
    this.entity = entity;
    this.capacity = kind === 'stove' ? 6 : 10;
    this.spotPos = spotPos;
    const flameMat = new THREE.SpriteMaterial({ map: Tex.flame(), color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const n = kind === 'stove' ? 0 : 7;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(flameMat.clone());
      s.visible = false;
      G.scene.add(s);
      this.flames.push(s);
    }
  }

  get burning() {
    return this.fuel.some((f) => f.burning);
  }

  /** 0..~1.5, used for visuals and spread */
  get heat() {
    return clamp(this.power / 3, 0, 3);
  }

  status(): string {
    if (this.burning) {
      const n = this.fuel.length;
      const left = Math.max(...this.fuel.map((f) => f.remaining), 0);
      const dmp = this.kind === 'stove' ? (this.damper ? ' · заслонка прикрыта' : ' · заслонка открыта') : '';
      return `горит · ${this.power.toFixed(1)} кВт · ${n} шт. · ещё ~${Math.round(left / 60)} мин${dmp}`;
    }
    if (this.embers > 0.15) return `тлеют угли${this.fuel.length ? ` · внутри ${this.fuel.length} шт.` : ''}`;
    if (this.fuel.length && this.kind === 'stove' && this.damper) return `не горит · заслонка прикрыта · внутри: ${this.fuelSummary()}`;
    if (this.fuel.length) return `не горит · внутри: ${this.fuelSummary()}`;
    return 'пусто';
  }

  fuelSummary() {
    const counts = new Map<string, number>();
    for (const f of this.fuel) counts.set(f.name, (counts.get(f.name) ?? 0) + 1);
    return [...counts].map(([k, v]) => (v > 1 ? `${k} ×${v}` : k)).join(', ');
  }
}

export class Fires {
  list: Fire[] = [];
  stoveFire!: Fire;

  init() {
    const st = G.house.stove;
    this.stoveFire = new Fire('stove', st.data.firePos, st, st.data.top);
    this.stoveFire.light = G.fx.acquireLight();
    st.data.fire = this.stoveFire;
    this.list.push(this.stoveFire);
  }

  /** Make an unlit campfire spot on the ground. */
  makeCampfire(pos: THREE.Vector3): Fire {
    const e = new Entity('fire');
    e.name = 'Костёр';
    const g = new THREE.Group();
    g.position.copy(pos);
    // cleared snow ring + stones
    // trampled, sooty snow that follows the slope
    const ringGeo = new THREE.CircleGeometry(0.75, 20);
    ringGeo.rotateX(-Math.PI / 2);
    const rp = ringGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < rp.count; i++) {
      const wx = pos.x + rp.getX(i), wz = pos.z + rp.getZ(i);
      const gy = G.lake.onIce(new THREE.Vector3(wx, pos.y, wz)) ? G.lake.levelAt(wx, wz) + 0.03 : G.terrain.heightAt(wx, wz);
      rp.setY(i, gy - pos.y + 0.03);
    }
    ringGeo.computeVertexNormals();
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
    ring.receiveShadow = true;
    g.add(ring);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8784, roughness: 1, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const sx = Math.cos(a) * 0.48, sz = Math.sin(a) * 0.48;
      const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08 + Math.random() * 0.04, 0), stoneMat);
      const gy = G.lake.onIce(new THREE.Vector3(pos.x + sx, pos.y, pos.z + sz)) ? G.lake.levelAt(pos.x + sx, pos.z + sz) + 0.03 : G.terrain.heightAt(pos.x + sx, pos.z + sz);
      st.position.set(sx, gy - pos.y + 0.04, sz);
      st.scale.y = 0.7;
      st.castShadow = true;
      g.add(st);
    }
    const pile = new THREE.Group();
    pile.name = 'pile';
    g.add(pile);
    G.scene.add(g);
    e.obj = g;
    g.userData.entity = e;
    const col = G.world.createCollider(G.R.ColliderDesc.cylinder(0.08, 0.45).setTranslation(pos.x, pos.y + 0.08, pos.z).setCollisionGroups(GROUPS_STATIC));
    G.entities.registerStatic(e, [col]);
    const spots = [new THREE.Vector3(pos.x + 0.55, pos.y + 0.12, pos.z), new THREE.Vector3(pos.x - 0.55, pos.y + 0.12, pos.z)];
    const f = new Fire('camp', pos.clone().add(new THREE.Vector3(0, 0.15, 0)), e, spots);
    e.data = { fire: f };
    this.list.push(f);
    return f;
  }

  fireOf(e: Entity | null): Fire | null {
    if (!e) return null;
    if (e.kind === 'stove' || e.kind === 'fire') return e.data.fire ?? null;
    return null;
  }

  canBurn(e: Entity) {
    return !!e.def?.fuel;
  }

  /** Put an item into the fire. Returns an error message or null. */
  addFuel(f: Fire, e: Entity): string | null {
    const d = e.def;
    if (!d?.fuel) return `${e.name} не горит`;
    if (f.fuel.length >= f.capacity) return f.kind === 'stove' ? 'Печь забита до отказа' : 'Костёр и так полон';
    if (f.kind === 'stove' && d.mass > 4) return `${e.name} не влезет в печь — сначала разруби`;
    f.fuel.push({
      defId: e.defId, name: e.name, kind: d.fuel.kind, power: d.fuel.power, remaining: d.fuel.burn, total: d.fuel.burn,
      ignite: d.fuel.ignite, moisture: e.moisture, burning: false, ramp: 0,
    });
    G.entities.destroy(e);
    G.audio.play('drop', { pos: f.pos, vol: 0.6 });
    this.rebuildPile(f);
    return null;
  }

  /** Try to light the fire with a flame. quality 0..1 */
  ignite(f: Fire, quality: number): boolean {
    if (f.burning) return true;
    const tinder = f.fuel.filter((x) => !x.burning && (x.kind === 'tinder' || x.kind === 'paper' || x.kind === 'cloth'));
    if (!tinder.length && f.embers < 0.15) {
      msg('Нужен трут: бумага, береста, стружка или ткань', 'warn');
      return false;
    }
    let chance = quality;
    if (f.kind === 'camp') chance *= 1 - clamp((G.weather.wind - 3) / 14, 0, 0.8) * (1 - f.shelter);
    const t = tinder.sort((a, b) => b.ignite - a.ignite)[0];
    if (t) chance *= clamp(1.15 - t.moisture * (t.defId === 'bark' ? 0.3 : 1.4), 0.1, 1);
    if (Math.random() < chance) {
      if (t) {
        t.burning = true;
        t.ramp = 0.3;
      } else {
        const any = f.fuel.find((x) => !x.burning);
        if (any) any.burning = true;
      }
      f.out = false;
      G.audio.play('fire_ignite', { pos: f.pos });
      msg('Трут занялся! Теперь огонь должен перекинуться на растопку.', 'good');
      return true;
    }
    msg('Не разгорелось…', 'warn');
    return false;
  }

  /** Radiant warmth (°C added to felt temperature) at a point. */
  radiantAt(p: THREE.Vector3, zone: string | null): number {
    let bonus = 0;
    for (const f of this.list) {
      if (f.power <= 0.05) continue;
      if (f.kind === 'stove' && zone === null) continue; // stove doesn't warm you outside
      const d = Math.max(0.4, f.pos.distanceTo(p));
      const k = f.kind === 'stove' ? 2.5 : 5.5;
      bonus += Math.min(28, (f.power * k) / (0.6 + d * d));
    }
    return bonus;
  }

  nearest(p: THREE.Vector3) {
    let best: Fire | null = null;
    let bd = Infinity;
    for (const f of this.list) {
      if (f.power < 0.1) continue;
      const d = f.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best ? { level: clamp(best.power / 6, 0.15, 1.2), pos: best.pos } : { level: 0 };
  }

  placeOnSpot(f: Fire, e: Entity): boolean {
    const i = f.spots.findIndex((s) => s === null || s.removed || s.pinned !== 'fire');
    if (i < 0) return false;
    f.spots[i] = e;
    const p = f.spotPos[i].clone();
    const d = e.def!;
    const hh = d.shape.t === 'box' ? d.shape.y : d.shape.t === 'cyl' ? d.shape.h : 0.05;
    p.y += hh + 0.005;
    G.entities.pin(e, 'fire', p);
    e.data.onFire = f;
    return true;
  }

  takeFromSpot(e: Entity) {
    for (const f of this.list) {
      const i = f.spots.indexOf(e);
      if (i >= 0) f.spots[i] = null;
    }
    e.data.onFire = null;
  }

  private rebuildPile(f: Fire) {
    if (f.kind !== 'camp') return;
    const pile = f.entity.obj!.getObjectByName('pile') as THREE.Group;
    pile.clear();
    f.fuel.forEach((x, i) => {
      if (x.kind === 'tinder' || x.kind === 'paper' || x.kind === 'cloth') return;
      const len = x.kind === 'log' ? 0.9 : 0.4;
      const r = x.kind === 'log' ? 0.1 : x.kind === 'wood' ? 0.05 : 0.02;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), x.kind === 'boughs' ? M.needles() : M.barkDead());
      const a = (i / Math.max(1, f.fuel.length)) * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.08, 0.12 + (i % 3) * 0.03, Math.sin(a) * 0.08);
      m.rotation.set(0.9, a, 0);
      m.castShadow = true;
      pile.add(m);
    });
  }

  update(dtGame: number, dtReal: number) {
    let remaining = dtGame;
    while (remaining > 0) {
      const dt = Math.min(remaining, 5);
      remaining -= dt;
      for (const f of this.list) this.step(f, dt);
    }
    for (const f of this.list) this.visuals(f, dtReal);
    this.updatePots(dtGame);
  }

  private shelterOf(f: Fire) {
    if (f.kind !== 'camp') return 1;
    const w = G.weather;
    const up = new THREE.Vector3(-Math.cos(w.windDir), 0, -Math.sin(w.windDir));
    let s = 0;
    for (const b of G.entities.near(f.pos, 1.8, (e) => e.defId === 'snowblock')) {
      const d = b.position().sub(f.pos).setY(0);
      if (d.length() < 0.1) continue;
      if (d.normalize().dot(up) > 0.3) s += 0.4;
    }
    if (G.house.zoneAt(f.pos)) s = 1;
    return clamp(s, 0, 1);
  }

  private step(f: Fire, dt: number) {
    f.shelter = this.shelterOf(f);
    const windMul = f.kind === 'camp' ? 1 + (G.weather.wind / 14) * (1 - f.shelter) : 1;
    // a stove limits combustion by its air supply (damper): over the cap, everything burns slower
    let raw = 0;
    for (const x of f.fuel) if (x.burning) raw += x.power * Math.max(x.ramp, 0.05) * (1 - 0.7 * x.moisture);
    const cap = f.kind === 'stove' ? (f.damper ? 3.5 : 9) : Infinity;
    const limit = raw > cap ? cap / raw : 1;
    let P = 0;
    for (const x of f.fuel) {
      if (!x.burning) continue;
      x.ramp = Math.min(1, x.ramp + dt / (x.kind === 'log' ? 600 : x.kind === 'wood' ? 240 : 30));
      x.moisture = Math.max(0, x.moisture - dt * 0.0004 * (1 + f.heat));
      x.remaining -= dt * windMul * (0.5 + 0.5 * x.ramp) * limit;
      P += x.power * x.ramp * (1 - 0.7 * x.moisture) * limit;
    }
    f.power = P;
    const heat = clamp(P / 3, 0, 3);
    const burning0 = f.fuel.some((x) => x.burning);
    // spread to unburnt items
    for (const x of f.fuel) {
      if (x.burning) continue;
      const wet = x.defId === 'bark' ? x.moisture * 0.3 : x.moisture;
      const dryness = clamp(1 - wet * 2, 0, 1);
      if (heat > 0) x.moisture = Math.max(0, x.moisture - dt * 0.00035 * heat);
      const src = burning0 ? heat + 0.3 : f.embers * 0.8;
      const lambda = x.ignite * dryness * src * 0.25;
      if (lambda > 0 && Math.random() < 1 - Math.exp(-lambda * dt)) {
        x.burning = true;
        x.ramp = 0.05;
      }
    }
    // burn out
    const before = f.fuel.length;
    f.fuel = f.fuel.filter((x) => {
      if (x.remaining > 0) return true;
      if (x.kind === 'wood' || x.kind === 'log') f.embers = Math.min(1, f.embers + (x.kind === 'log' ? 0.8 : 0.5));
      return false;
    });
    if (f.fuel.length !== before) this.rebuildPile(f);
    const burning = f.fuel.some((x) => x.burning);
    if (!burning) {
      f.embers = Math.max(0, f.embers - dt / 1800);
      if (!f.out && before > 0 && f.fuel.length === 0 && f.embers < 0.15) {
        f.out = true;
      }
    } else {
      f.embers = Math.max(f.embers, Math.min(0.6, f.embers + dt * heat * 0.0005));
    }
    // a weak campfire can be blown out by strong wind
    if (f.kind === 'camp' && burning && G.weather.wind > 9 && heat < 0.9 && f.shelter < 0.5) {
      if (Math.random() < dt * 0.004 * (G.weather.wind - 8)) {
        for (const x of f.fuel) x.burning = false;
        f.power = 0;
        msg('Ветер задул костёр!', 'bad');
      }
    }
  }

  private visuals(f: Fire, dt: number) {
    const heat = f.heat;
    const flick = 0.85 + Math.random() * 0.3;
    if (f.kind === 'stove') {
      const glow = f.entity.data.glow as THREE.MeshStandardMaterial;
      glow.emissiveIntensity = (heat * 1.4 + f.embers * 0.5) * flick;
      if (f.light) {
        f.light.position.copy(f.entity.data.front).add(new THREE.Vector3(0, 0.1, 0.25));
        f.light.intensity = (heat * 2.2 + f.embers * 0.5) * flick;
        f.light.distance = 7 + heat * 2;
      }
      if (f.burning) {
        f.smokeT -= dt;
        if (f.smokeT <= 0) {
          f.smokeT = 0.35 / (0.3 + heat);
          G.fx.smoke(G.house.chimneyTop, 1 + heat * 0.5);
        }
      }
    } else {
      if (!f.light && (f.burning || f.embers > 0.1)) f.light = G.fx.acquireLight();
      if (f.light) {
        f.light.position.copy(f.pos).add(new THREE.Vector3(0, 0.4, 0));
        f.light.intensity = (heat * 3 + f.embers * 0.6) * flick;
        f.light.distance = 9 + heat * 4;
        if (!f.burning && f.embers <= 0.1) {
          G.fx.releaseLight(f.light);
          f.light = null;
        }
      }
      f.flames.forEach((s, i) => {
        const on = f.burning && i < 2 + Math.round(heat * 3);
        s.visible = on;
        if (!on) return;
        const t = performance.now() / 1000 + i * 1.7;
        const h = 0.25 + heat * 0.35;
        s.position.set(f.pos.x + Math.sin(t * 3 + i) * 0.06, f.pos.y + 0.05 + ((t * 0.9 + i * 0.13) % 1) * h * 0.8, f.pos.z + Math.cos(t * 2.3 + i) * 0.06);
        const sc = (0.22 + heat * 0.18) * (1 - ((t * 0.9 + i * 0.13) % 1) * 0.6) * flick;
        s.scale.set(sc, sc * 1.4, sc);
      });
      if (f.burning) {
        f.smokeT -= dt;
        if (f.smokeT <= 0) {
          f.smokeT = 0.25 / (0.3 + heat);
          G.fx.smoke(f.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 0.8 + heat * 0.4);
        }
        f.sparkT -= dt;
        if (f.sparkT <= 0) {
          f.sparkT = 0.2 + Math.random() * 0.6;
          G.fx.burst('sparks', f.pos.clone().add(new THREE.Vector3(0, 0.2, 0)), 1 + Math.round(heat * 2));
        }
      }
    }
  }

  /** Heat flow (kW) into a house zone from fires. */
  heatToZone(zone: 'ground' | 'upper'): number {
    let kw = 0;
    for (const f of this.list) {
      if (f.kind === 'stove') kw += f.power * (zone === 'ground' ? 0.78 : 0.14);
      else if (G.house.zoneAt(f.pos) === zone) kw += f.power * 0.9;
    }
    return kw;
  }

  /** Pots melt snow and boil, food cooks, items left out cool down. */
  private updatePots(dt: number) {
    for (const e of G.entities.list) {
      if (e.removed) continue;
      const onFire: Fire | null = e.pinned === 'fire' ? e.data.onFire : null;
      const heatKW = onFire ? Math.min(1.6, onFire.power * (onFire.kind === 'stove' ? 0.25 : 0.2)) : 0;
      if (e.contents) this.potStep(e, dt, heatKW);
      const d = e.def;
      if (d?.cook && onFire && heatKW > 0.15) {
        e.cook += dt * Math.min(1.5, heatKW / 0.6);
        if (e.cook >= d.cook.time) this.transform(e, d.cook.to);
      }
    }
  }

  private ambientAt(e: Entity) {
    const p = e.inWorld || e.pinned ? e.position() : G.player.pos.clone().add(new THREE.Vector3(0, 1, 0));
    return G.thermal.tAt(p);
  }

  private potStep(e: Entity, dt: number, heatKW: number) {
    const c = e.contents!;
    let Q = heatKW * 1000 * dt;
    const amb = this.ambientAt(e);
    if (Q > 0) {
      if (c.snow > 0) {
        const melt = Math.min(c.snow, Q / 334000);
        c.snow -= melt;
        c.water += melt;
        Q -= melt * 334000;
        if (c.temp < 0) c.temp = 0;
      }
      if (Q > 0 && c.water > 0.001) {
        c.temp = Math.min(100, c.temp + Q / (c.water * 4186 + e.def!.mass * 450));
        if (c.temp >= 99.5) {
          e.data.boilT = (e.data.boilT ?? 0) + dt;
          const ev = Math.min(c.water, dt * 0.00004);
          c.water -= ev;
          G.thermal.addVapour(e.position(), ev * 1000);
          if (e.data.boilT > 60 && !c.boiled) {
            c.boiled = true;
            c.dirty = false;
            if (e.pinned) msg(`${e.name}: вода закипела`, 'good');
          }
          if (Math.random() < 0.3) G.fx.steam(e.position().add(new THREE.Vector3(0, 0.1, 0)));
        }
      }
    } else if (c.water > 0 || c.snow > 0) {
      // cool down towards ambient
      c.temp += (amb - c.temp) * (1 - Math.exp(-dt / 1200));
      if (c.temp < 0 && c.water > 0) {
        const fr = Math.min(c.water, dt / 7200);
        c.water -= fr;
        c.snow += fr;
      }
      e.data.boilT = 0;
    }
    if (c.water <= 0.001 && c.snow <= 0.001) {
      c.water = 0;
      c.snow = 0;
      c.boiled = false;
      c.tea = false;
      c.dirty = false;
      c.temp = amb;
    }
    const cm = e.obj?.getObjectByName('contents') as THREE.Mesh | undefined;
    if (cm) {
      const cap = e.def!.capacity!;
      const fill = (c.water + c.snow) / cap;
      cm.visible = fill > 0.01;
      const h = e.defId === 'bucket' ? 0.3 : 0.16;
      cm.position.y = -h / 2 + 0.01 + fill * h * 0.85;
      const m = cm.material as THREE.MeshStandardMaterial;
      if (c.snow > c.water) m.color.setHex(0xf4f6fa);
      else if (c.tea) m.color.setHex(0x8a5a2a);
      else m.color.setHex(0x6f8fa8);
    }
  }

  /** Replace an item by another definition in place (cooking). */
  transform(e: Entity, toId: string) {
    const d = def(toId);
    const wasPinned = e.pinned;
    const pos = e.position();
    const parentFire: Fire | null = e.data.onFire ?? null;
    const idx = parentFire ? parentFire.spots.indexOf(e) : -1;
    e.defId = toId;
    e.name = d.name;
    e.cook = 0;
    if (e.obj) {
      e.obj.removeFromParent();
      e.obj = null;
    }
    if (wasPinned) {
      G.entities.removeFromWorld(e);
      if (parentFire && idx >= 0) {
        parentFire.spots[idx] = null;
        this.placeOnSpot(parentFire, e);
      } else G.entities.placeInWorld(e, pos);
    } else if (e.inWorld) {
      G.entities.removeFromWorld(e);
      G.entities.placeInWorld(e, pos);
    }
    if (toId === 'fish_cooked') msg('Рыба готова', 'good');
    if (toId === 'fish_burnt') msg('Рыба подгорела', 'warn');
  }

  describe(f: Fire) {
    const name = f.kind === 'stove' ? 'Печь' : 'Костёр';
    const shelter = f.kind === 'camp' && G.weather.wind > 4 ? (f.shelter > 0.5 ? ' · укрыт от ветра' : ' · на ветру') : '';
    return `${name} · ${f.status()}${shelter}`;
  }

  static kindName(k: FuelKind) {
    return FUEL_KIND_NAMES[k];
  }
}
