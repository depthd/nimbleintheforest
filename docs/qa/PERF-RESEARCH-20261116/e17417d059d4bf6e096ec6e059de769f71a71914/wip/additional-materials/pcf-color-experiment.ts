import * as THREE from 'three';

/** PCF reads the depth texture; its shadow render target's colour is unused. */
export function skipShadowColorWrites(renderer: THREE.WebGLRenderer, shadowCamera: () => THREE.Camera | undefined) {
  const original = renderer.renderBufferDirect;
  renderer.renderBufferDirect = function(camera, scene, geometry, material, object, group) {
    const before = material.colorWrite;
    const skip = camera === shadowCamera() && this.shadowMap.type === THREE.PCFShadowMap && this.getRenderTarget()?.depthTexture;
    if (skip) material.colorWrite = false;
    try { return original.call(this, camera, scene, geometry, material, object, group); }
    finally { material.colorWrite = before; }
  };
}
