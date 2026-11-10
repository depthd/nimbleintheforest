// An opt-in visual inspection in the actual world, not a forest/felling replacement.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { G, GROUPS_STATIC } from './ctx';

const ASSET_SHA256 = 'daf6d05bf185b3273768095aef94572381285176079455ac578661c07d9e2df8';

function clearGround(x: number, z: number, margin: number) {
  if (!G.region.inside(x, z, 40) || G.region.slopeAt(x, z) > 0.3 || !Number.isNaN(G.region.waterAt(x, z))) return false;
  const b = G.house.bounds;
  if (x > b.min.x - margin && x < b.max.x + margin && z > b.min.z - margin && z < b.max.z + margin) return false;
  return !G.forest.treesNear(x, z, margin).length;
}

export async function addC1Lab() {
  const gltf = await new GLTFLoader().loadAsync('models/conifer_c1.glb');
  const root = gltf.scene;
  root.name = 'C1_visual_preview';
  root.userData.assetSha256 = ASSET_SHA256;
  const home = G.player.pos.clone();
  let at: THREE.Vector3 | undefined;
  // Keep the existing spawn and world generation. Find a visible, unobstructed
  // clearing beside it, without moving/removing the existing forest or house.
  for (const distance of [14, 18, 24, 30]) {
    for (const offset of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI]) {
      const a = G.player.yaw + offset;
      const x = home.x - Math.sin(a) * distance, z = home.z - Math.cos(a) * distance;
      if (!clearGround(x, z, 4)) continue;
      let visible = true;
      for (let i = 1; i < 8; i++) {
        if (!clearGround(THREE.MathUtils.lerp(home.x, x, i / 8), THREE.MathUtils.lerp(home.z, z, i / 8), 0.8)) visible = false;
      }
      if (visible) { at = new THREE.Vector3(x, G.terrain.heightAt(x, z), z); break; }
    }
    if (at) break;
  }
  if (!at) throw new Error('C1: не найдено свободное место возле игрока; попробуйте seed=42.');
  root.position.copy(at);
  const initialAngle = Math.atan2(home.x - at.x, home.z - at.z);
  root.rotation.y = initialAngle; // the asset's +Z/front faces the initial viewpoint
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = true;
  });
  G.scene.add(root);
  // A static trunk collider supports a walk-around. This is deliberately not
  // registered as a procedural tree: chopping/felling is a separate stage.
  const body = G.world.createRigidBody(G.R.RigidBodyDesc.fixed());
  const collider = G.world.createCollider(G.R.ColliderDesc.cylinder(4.65, 0.5)
    .setTranslation(at.x, at.y + 4.65, at.z).setCollisionGroups(GROUPS_STATIC), body);

  const faceTree = () => {
    const eye = G.player.eyePos, dx = at!.x - eye.x, dz = at!.z - eye.z;
    G.player.yaw = Math.atan2(-dx, -dz);
    G.player.pitch = Math.atan2(at!.y + 4 - eye.y, Math.hypot(dx, dz));
    G.player.updateCamera(0);
    G.camera.updateMatrixWorld(true);
  };
  const preset = (name: string) => {
    if (name === 'front') G.player.teleport(home);
    else {
      const distance = name === 'close' ? 2.5 : name === 'far' ? 26 : 14;
      const angle = initialAngle + (name === 'side' ? Math.PI / 2 : 0);
      let found = false;
      for (const delta of [0, 0.2, -0.2, 0.4, -0.4, 0.8, -0.8]) {
        const x = at!.x + Math.sin(angle + delta) * distance, z = at!.z + Math.cos(angle + delta) * distance;
        if (!clearGround(x, z, 1)) continue;
        G.player.teleport(new THREE.Vector3(x, G.terrain.heightAt(x, z) + 0.05, z));
        found = true; break;
      }
      if (!found) return false;
    }
    G.forest.update(G.player.pos, true);
    G.terrain.update(G.player.eyePos, 400);
    faceTree();
    return true;
  };
  faceTree();
  const panel = document.createElement('div');
  panel.className = 'snow-panel'; panel.id = 'c1-panel';
  panel.innerHTML = `<strong>C1 — осмотр дерева в игре</strong>
    <p>Высота 10 м. Восстановленная модель. Крона пока без снега и качания; рубка этого образца отключена.</p>
    <div><button data-c1-view="front">Спереди</button><button data-c1-view="side">Сбоку</button>
    <button data-c1-view="close">Под кроной</button><button data-c1-view="far">Издалека</button></div>
    <p>Щёлкните по игре, чтобы ходить. WASD — движение, мышь — взгляд. Esc — освободить курсор.</p>
    <a href="./">Обычная тестовая игра</a>`;
  panel.style.maxWidth = '350px';
  panel.querySelectorAll<HTMLButtonElement>('[data-c1-view]').forEach(button => {
    button.addEventListener('click', () => { G.hud.showPause(false); preset(button.dataset.c1View!); });
  });
  document.body.appendChild(panel);
  (window as any).__c1Lab = { root, collider, preset, position: at.clone(), home, assetSha256: ASSET_SHA256 };
  await G.renderer.compileAsync(root, G.camera, G.scene);
}
