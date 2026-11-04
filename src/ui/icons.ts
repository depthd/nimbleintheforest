// Item icons: each item's 3D model rendered once into a small picture.
import * as THREE from 'three';
import { buildItemMesh } from '../game/meshes';

const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
const SIZE = 96;

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x403830, 1.6));
  const d = new THREE.DirectionalLight(0xffffff, 2.2);
  d.position.set(2, 3, 2);
  scene.add(d);
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
}

export function itemIcon(id: string, variant = 0): string {
  const key = `${id}:${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    if (!renderer) setup();
    const obj = buildItemMesh(id, { v: variant });
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    obj.position.sub(c);
    const pivot = new THREE.Group();
    pivot.add(obj);
    // show flat things from above at an angle, tall things from the side
    pivot.rotation.set(size.y < Math.max(size.x, size.z) * 0.4 ? 0.9 : 0.25, 0.7, 0);
    scene.add(pivot);
    const r = Math.max(size.x, size.y, size.z) * 0.62;
    camera.position.set(0, 0, r / Math.tan((15 * Math.PI) / 180) + r);
    camera.lookAt(0, 0, 0);
    renderer!.render(scene, camera);
    const url = renderer!.domElement.toDataURL('image/png');
    scene.remove(pivot);
    cache.set(key, url);
    return url;
  } catch {
    cache.set(key, '');
    return '';
  }
}
