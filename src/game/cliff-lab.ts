// Panel for the cliff laboratory (?cliffs=1): jump to viewpoints, fly around the site,
// and hide the rock to see the sheet underneath. The world and the player are the real ones.
import * as THREE from 'three';
import { G, msg } from './ctx';

type View = 'front' | 'shelter' | 'lip' | 'pillar' | 'tor';

export class CliffLab {
  orbiting = false;
  private angle = 0;
  private panel: HTMLDivElement;
  private status: HTMLElement;
  private rockShown = true;
  private shadowExtent = 45;

  constructor() {
    this.panel = document.createElement('div');
    this.panel.className = 'snow-panel cliff-panel';
    this.panel.innerHTML = `<strong>Испытание скал</strong><span class="snow-status"></span>
      <p>Плато поднято прямо в обычном мире, рядом с домом. Скала — отдельные глыбы,
      вклеенные в простыню рельефа. «Без скал» показывает простыню под ними
      (столкновения остаются). Esc — курсор, F6 — вид сбоку.</p>
      <div><button data-view="front">Вид на утёс</button><button data-view="shelter">Под навесом</button><button data-view="lip">На краю</button>
      <button data-view="pillar">Останец</button><button data-view="tor">Малая скала</button></div>
      <div style="margin-top:8px"><button data-act="orbit">Облёт</button><button data-act="rock">Без скал</button><a href="./">Обычная игра</a></div>`;
    document.body.appendChild(this.panel);
    this.status = this.panel.querySelector('.snow-status')!;
    this.panel.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.addEventListener('click', () => this.go(b.dataset.view as View)));
    this.panel.querySelector('[data-act="orbit"]')!.addEventListener('click', () => this.setOrbit(!this.orbiting));
    this.panel.querySelector('[data-act="rock"]')!.addEventListener('click', () => this.setRock(!this.rockShown));
    document.getElementById('legend')!.style.display = 'none';
    this.go('front');
    const s = G.cliffs?.stats();
    if (s) this.status.textContent = `${s.blocks} глыб · ${s.rockTriangles + s.snowTriangles} треугольников · ${s.colliders} коллайдеров`;
  }

  private get main() { return G.region.cliffs[G.region.cliffLab!.main]; }

  /** Stand somewhere and look at something; heights come from the real ground. */
  private stand(x: number, z: number, look: THREE.Vector3, y?: number) {
    const ground = y ?? G.terrain.heightAt(x, z);
    G.player.teleport(new THREE.Vector3(x, ground + 0.08, z));
    const e = G.player.eyePos, d = look.clone().sub(e);
    G.player.yaw = Math.atan2(-d.x, -d.z);
    G.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    G.player.stamina = 1; G.player.winded = false;
  }

  /** viewpoints, all derived from the generated cliffs */
  viewpoint(view: View) {
    const R = G.region, info = R.cliffLab!, c = this.main, mid = c.length / 2;
    const foot = c.footAt(mid), top = c.topAt(mid);
    const at = (s: number, v: number, y: number) => { const p = c.at(s, v); return new THREE.Vector3(p.x, y, p.z); };
    switch (view) {
      case 'front': {
        // a clear spot in the valley: no trunk right in front of the eyes
        let p = at(mid, -58, 0);
        search: for (const dv of [-58, -52, -64, -46, -70]) for (const ds of [0, 6, -6, 12, -12, 18, -18]) {
          const q = at(mid + ds, dv, 0);
          if (!G.forest.treesNear(q.x, q.z, 5).length && !G.region.cliffs.some((b) => b.occupied(q.x, q.z, 3))) { p = q; break search; }
        }
        return { p, look: at(mid, 0, foot + (top - foot) * 0.45) };
      }
      case 'shelter': {
        // at one end of the undercut, looking along it under the roof
        const uc = c.spec.undercut!, s0 = uc.s0 + 4.5, f0 = c.footAt(s0);
        return { p: at(s0, 1.4, f0), look: at(uc.s1 - 2, -0.6, f0 + 1.6), y: f0 };
      }
      case 'lip': { const s = mid + 14, p = at(s, -0.2, top); return { p, look: at(s - 4, -24, c.footAt(s) + 1), y: top + 0.35 }; }
      case 'pillar': case 'tor': {
        const b = R.cliffs[view === 'pillar' ? info.pillar : info.tor], m = b.centre;
        const dir = new THREE.Vector2(info.front.x + 0.35, info.front.z - 0.35).normalize();
        const dist = view === 'pillar' ? 24 : 26;
        const p = new THREE.Vector3(m.x + dir.x * dist, 0, m.z + dir.y * dist);
        return { p, look: new THREE.Vector3(m.x, b.footAt(0) + (view === 'pillar' ? 8 : 3), m.z) };
      }
    }
  }

  go(view: View) {
    if (this.orbiting) this.setOrbit(false);
    const v = this.viewpoint(view);
    this.stand(v.p.x, v.p.z, v.look, v.y);
    G.player.avatar.inspectionView = 0;
    msg({ front: 'Утёс: козырёк сверху, навес у подножия', shelter: 'Под навесом: сюда не наметает снег и меньше дует', lip: 'Край утёса. Осторожно: падение с высоты калечит', pillar: 'Останец: тот же генератор, замкнутый контур', tor: 'Невысокая скала посреди долины' }[view], 'info');
  }

  setRock(shown: boolean) {
    this.rockShown = shown;
    G.cliffs?.setVisible(shown);
    this.panel.querySelector('[data-act="rock"]')!.textContent = shown ? 'Без скал' : 'Вернуть скалы';
  }

  setOrbit(on: boolean) {
    this.orbiting = on;
    this.panel.querySelector('[data-act="orbit"]')!.textContent = on ? 'Хватит облёта' : 'Облёт';
    const sc = G.sky.sun.shadow.camera;
    const info = G.region.cliffLab!;
    if (on) {
      // stand in the middle of the plateau so the shadows cover the whole site
      const c = info.centre;
      G.player.teleport(new THREE.Vector3(c.x, G.terrain.heightAt(c.x, c.z) + 0.1, c.z));
      this.angle = Math.atan2(info.front.z, info.front.x);
      this.shadowExtent = sc.right;
      sc.left = sc.bottom = -120; sc.right = sc.top = 120; sc.far = 420;
    } else {
      sc.left = sc.bottom = -this.shadowExtent; sc.right = sc.top = this.shadowExtent; sc.far = 260;
    }
    sc.updateProjectionMatrix();
  }

  /** After the player camera: the fly-around replaces the view. */
  update(dt: number) {
    if (!this.orbiting) return;
    const info = G.region.cliffLab!, c = info.centre;
    this.angle += dt * 0.12;
    const cam = G.camera;
    cam.position.set(c.x + Math.cos(this.angle) * 150, info.plateau + 48, c.z + Math.sin(this.angle) * 150);
    cam.lookAt(c.x + info.front.x * 20, info.plateau - 10, c.z + info.front.z * 20);
    cam.updateMatrixWorld(true);
  }
}
