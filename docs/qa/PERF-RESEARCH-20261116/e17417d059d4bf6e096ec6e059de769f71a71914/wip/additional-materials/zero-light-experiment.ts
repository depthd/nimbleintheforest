import * as THREE from 'three';

/** Retain the fixed light pool and every shader variant; skip exact-zero terms. */
export function skipZeroLightWork() {
  let chunk = THREE.ShaderChunk.lights_fragment_begin;
  for (const type of ['point', 'spot']) {
    const assignment = `${type}Light = ${type}Lights[ i ];`;
    chunk = chunk.replace(assignment, assignment + `\n if (any(notEqual(${type}Light.color, vec3(0.0)))) {`);
    const from = chunk.indexOf(assignment), direct = chunk.indexOf('RE_Direct( directLight', from);
    const close = chunk.indexOf(';', direct) + 1;
    if (from < 0 || direct < 0 || close < 1) throw new Error('Unexpected Three.js lighting chunk');
    chunk = chunk.slice(0, close) + '\n }' + chunk.slice(close);
  }
  THREE.ShaderChunk.lights_fragment_begin = chunk;
}
