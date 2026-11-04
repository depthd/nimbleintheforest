// Debug page: ?preview=animals shows every animal model in several poses.
import * as THREE from 'three';
import { loadTemplate, Rig, PALETTES, Pose } from './game/animals/rig';

export async function previewAnimals(params: URLSearchParams) {
  document.getElementById('start')!.style.display = 'none';
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setSize(window.innerWidth, window.innerHeight);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true;
  document.body.appendChild(r.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc9d6e4);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x888888, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 6, 4);
  sun.castShadow = true;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0xf2f5f8 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const cam = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 100);
  cam.position.set(5.5, 2.2, 3.2);
  cam.lookAt(0, 0.3, 1.5);
  const [fa, fb, wolf] = await Promise.all([loadTemplate('models/fox_a.glb', 'fox_a', 0.38), loadTemplate('models/fox_b.glb', 'fox_b', 0.38), loadTemplate('models/wolf.glb', 'wolf', 0.8)]);
  const poses: [Pose, number][] = [['move', 0.9], ['move', 2.6], ['move', 7], ['sniff', 0], ['alert', 0], ['lie', 0], ['dead', 0], ['pounce', 0]];
  const pose = (params.get('pose') ?? 'all') as string;
  const rigs: { rig: Rig; p: Pose; v: number }[] = [];
  const list = pose === 'all' ? poses : poses.filter((q) => q[0] === pose || `${q[0]}${q[1]}` === pose);
  list.forEach(([p, v], i) => {
    [fa, fb, wolf].forEach((T, k) => {
      const rig = new Rig(T, k === 2 ? null : k === 0 ? PALETTES.red : PALETTES.red);
      rig.root.position.set(k * 1.4 - 1.4, 0, i * 1.6 - 2);
      rig.root.rotation.y = Math.PI / 2;
      scene.add(rig.root);
      rig.root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      rigs.push({ rig, p, v });
    });
  });
  let t = 0;
  const tick = () => {
    t += 1 / 30;
    for (const x of rigs) {
      if (x.p === 'pounce' && !x.rig.pouncing && t % 3.2 < 0.05) x.rig.pounce();
      x.rig.update(1 / 30, x.v, x.p === 'pounce' ? 'idle' : x.p, null);
    }
    r.render(scene, cam);
  };
  (window as any).__tick = (n: number) => {
    for (let i = 0; i < n; i++) tick();
  };
  (window as any).__cam = cam;
  tick();
  (window as any).__previewDone = true;
}
