// Debug page: ?preview=wood shows wood pieces up close: notches, cut ends, split
// halves, boards and boughs. Loads instantly (no world generation).
import * as THREE from 'three';
import { buildWoodObject } from './game/wood/mesh';
import { chop, cutAt, makeRound, makeSawn, makeSplit, splitAlong, WoodPiece } from './game/wood/piece';

export async function previewWood(params: URLSearchParams) {
  document.getElementById('start')!.style.display = 'none';
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setSize(window.innerWidth, window.innerHeight);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.shadowMap.enabled = true;
  document.body.appendChild(r.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc9d6e4);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x777777, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 6, 4);
  sun.castShadow = true;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0xf2f5f8 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const cam = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.05, 100);
  const view = params.get('view') ?? 'all';
  cam.position.set(view === 'stem' ? 2.2 : 3.6, view === 'stem' ? 1.4 : 3.2, view === 'stem' ? 2.4 : 4.4);
  cam.lookAt(view === 'stem' ? 0 : 0.2, view === 'stem' ? 0.8 : 0.2, 0);

  const place = (p: WoodPiece, x: number, y: number, z: number, rot = new THREE.Euler()) => {
    const o = buildWoodObject(p);
    o.position.set(x, y, z);
    o.rotation.copy(rot);
    o.traverse((c) => ((c as THREE.Mesh).castShadow = true));
    scene.add(o);
    return o;
  };

  if (view === 'stem') {
    // a standing stem with a face notch and a back cut leaving a hinge
    const s = makeRound('spruce', 2.4, 0.2, 0.17);
    for (let i = 0; i < 14; i++) chop(s, 0.6, 0, 1, false);
    for (let i = 0; i < 22; i++) chop(s, 0.64, Math.PI, 1, false);
    place(s, 0, 1.2, 0, new THREE.Euler(0, 0, Math.PI / 2));
  } else {
    // a log with an axe notch half way through
    const a = makeRound('spruce', 2.2, 0.15, 0.13);
    for (let i = 0; i < 12; i++) chop(a, 1.0, 0, 1, false);
    place(a, 0, 0.15, -1.2);
    // a log bucked through: the two ends show the axe faces
    const b = makeRound('pine', 2.0, 0.12, 0.11);
    let n = b.notches.length;
    for (let i = 0; i < 30 && n < 2; i++) {
      chop(b, 0.9, 0, 1, false);
      chop(b, 0.9, Math.PI, 1, false);
      n = b.notches.length;
    }
    const [b1, b2] = cutAt(b, 0.9);
    place(b1, -0.6, 0.12, -0.5);
    place(b2, 0.7, 0.12, -0.5);
    // a saw kerf
    const c = makeRound('birch', 1.4, 0.1, 0.1);
    for (let i = 0; i < 4; i++) chop(c, 0.7, 0, 1, true);
    place(c, 0, 0.1, 0.2);
    // a chock split into halves, and a half split again
    const ch = makeRound('spruce', 0.45, 0.13, 0.13);
    const [h1, h2] = splitAlong(ch);
    place(h1, 1.3, 0.08, 0.6, new THREE.Euler(0, 0.3, 0));
    const [q1, q2] = splitAlong(h2);
    place(q1, 1.6, 0.06, 1.0, new THREE.Euler(0, 0.6, 0.4));
    place(q2, 1.1, 0.06, 1.1, new THREE.Euler(0, -0.4, -0.3));
    place(makeSplit('birch', 0.3, 0.06, 0.9), 0.5, 0.03, 1.1, new THREE.Euler(0, 1, 0));
    // board, branch and bough
    place(makeSawn('spruce', 1.2, 0.14, 0.024), -1.2, 0.02, 0.6, new THREE.Euler(0, 0.4, 0));
    place(makeRound('dead', 1.0, 0.016, 0.005), -0.8, 0.02, 1.2, new THREE.Euler(0, -0.3, 0));
    const bough = makeRound('spruce', 0.9, 0.014, 0.004);
    bough.needles = 0.8;
    place(bough, -1.4, 0.06, 1.4, new THREE.Euler(0, 0.8, 0));
  }
  r.render(scene, cam);
  (window as any).__previewReady = true;
}
