import * as THREE from 'three';

/** Wait without blocking the loading UI until submitted uploads/draws finish. */
async function drain(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext();
  if (!('fenceSync' in gl)) return;
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) return;
  gl.flush();
  try {
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline) {
      if (gl.isContextLost()) throw new Error('Потерян графический контекст при загрузке');
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED || status === gl.WAIT_FAILED) break;
      await new Promise(resolve => setTimeout(resolve, 16));
    }
  } finally { gl.deleteSync(sync); }
}

/** Graphics only: never advance time, move the player or step the physical world. */
export async function warmStartup(renderer: THREE.WebGLRenderer, scene: THREE.Scene,
  camera: THREE.PerspectiveCamera, interior: THREE.Vector3,
  progress: (text: string) => void) {
  const mark = 'startup-graphics';
  performance.mark(mark);
  const view = camera.clone();
  const views: { position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];
  for (let i = 0; i < 4; i++) views.push({ position: camera.position.clone(),
    quaternion: camera.quaternion.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * Math.PI / 2)) });
  view.position.copy(interior); view.lookAt(interior.clone().add(new THREE.Vector3(0, 0, 1)));
  views.push({ position: view.position.clone(), quaternion: view.quaternion.clone() });
  // Finish on the exact real viewpoint, including its camera-specific uniforms.
  views.push({ position: camera.position.clone(), quaternion: camera.quaternion.clone() });
  progress('Подготовка материалов…');
  await new Promise(resolve => setTimeout(resolve, 0));
  await renderer.compileAsync(scene, camera);
  for (let i = 0; i < views.length; i++) {
    progress(`Подготовка окружения — ${i + 1}/${views.length}`);
    await new Promise(resolve => setTimeout(resolve, 0));
    view.position.copy(views[i].position); view.quaternion.copy(views[i].quaternion);
    view.updateMatrixWorld(true);
    renderer.clear(); renderer.render(scene, view);
    await drain(renderer);
  }
  performance.measure(mark, mark);
}
