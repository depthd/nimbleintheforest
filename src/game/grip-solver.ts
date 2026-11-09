import * as THREE from 'three';
export interface GripConstraint { shoulder: THREE.Vector3; offset: THREE.Vector3 }
/** Solve one rigid object's translation, never independent clamped wrists.
 * With fixed orientation each arm contributes a convex ball of legal translations. */
export function fitGrip(position: THREE.Vector3, constraints: GripConstraint[], reach = 0.552) {
  const fitted = position.clone();
  for (let iteration = 0; iteration < 96; iteration++) {
    let error = 0;
    for (const c of constraints) {
      const center = c.shoulder.clone().sub(c.offset);
      const delta = fitted.clone().sub(center), distance = delta.length();
      error = Math.max(error, distance - reach);
      if (distance > reach) fitted.copy(center).addScaledVector(delta, reach / distance);
    }
    if (error < 1e-7) break;
  }
  const error = Math.max(0, ...constraints.map(c => fitted.clone().add(c.offset).distanceTo(c.shoulder) - reach));
  return { position: fitted, reachable: error < 1e-5, error };
}
export interface HandSocket {
  /** Palm contact, in item-local metres. */
  position: THREE.Vector3;
  /** Palm frame: local -Y points from wrist toward fingers. */
  rotation: THREE.Quaternion;
}
export function socketWrist(socket: HandSocket, rotation: THREE.Quaternion) {
  const orientation = rotation.clone().multiply(socket.rotation);
  const offset = socket.position.clone().applyQuaternion(rotation)
    .add(new THREE.Vector3(0, 0.06, 0).applyQuaternion(orientation));
  return { offset, orientation };
}
