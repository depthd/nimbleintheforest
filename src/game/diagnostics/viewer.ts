import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { G } from '../ctx';
import type { DiagnosticBundle, WorldSample } from './schema';

export class DiagnosticViewer {
  group = new THREE.Group();
  private hidden = new Map<THREE.Object3D, boolean>();
  private geometries = new Map<string, THREE.BufferGeometry>();
  private controls: OrbitControls;
  private sampleId = -1;
  private diagnosticBackground = new THREE.Color(0x182630);
  private diagnosticFog = new THREE.FogExp2(0x182630, 0);
  private background = G.scene.background;
  private fog = G.scene.fog;
  private mode = '';
  constructor(private bundle: DiagnosticBundle, camera: THREE.PerspectiveCamera) {
    this.controls = new OrbitControls(camera, G.renderer.domElement);
    this.controls.enabled = false;
    this.controls.minDistance = 0.5; this.controls.maxDistance = 120;
  }
  show(s: WorldSample, colliders: boolean, orbit: boolean, camera: THREE.PerspectiveCamera, probes: any[], compatibleRig: boolean, compatibleSnow: boolean) {
    for (const child of G.scene.children) if (child !== this.group && !(compatibleRig && child === G.player.avatar.root) && !(compatibleSnow && child === G.snow?.renderer.group)) { if (!this.hidden.has(child)) this.hidden.set(child, child.visible); child.visible = false; }
    G.scene.background = this.diagnosticBackground; this.diagnosticFog.density = 0; G.scene.fog = this.diagnosticFog;
    if (!this.group.parent) G.scene.add(this.group);
    const mode = `${colliders}/${orbit}`;
    if (this.sampleId !== s.id || this.mode !== mode) {
      this.clear(); this.sampleId = s.id; this.mode = mode;
      this.group.add(new THREE.HemisphereLight(0xe4edff, 0x647064, 2));
      const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(10, 30, 10); this.group.add(sun);
      const terrain = new THREE.PlaneGeometry(64, 64, 16, 16); terrain.rotateX(-Math.PI / 2);
      const a = terrain.attributes.position;
      for (let i = 0; i < a.count; i++) a.setXYZ(i, a.getX(i) + s.center[0], s.terrain[i], a.getZ(i) + s.center[2]);
      terrain.computeVertexNormals(); this.group.add(new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ color: 0xb6cbd6, side: THREE.DoubleSide })));
      for (const o of s.objects) {
        for (const m of o.meshes) {
          let geo = this.geometries.get(m.geometry);
          if (!geo) {
            const data = this.bundle.meshes[m.geometry]; geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
            if (data.indices) geo.setIndex(data.indices); geo.computeVertexNormals(); this.geometries.set(m.geometry, geo);
          }
          const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: this.bundle.meshes[m.geometry].color, side: THREE.DoubleSide }));
          mesh.matrixAutoUpdate = false; mesh.matrix.fromArray(m.matrix); this.group.add(mesh);
        }
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffce30 })); dot.position.fromArray(o.position); this.group.add(dot);
        if (colliders || (!o.meshes.length && o.kind === 'world-collider')) for (const c of o.colliders) {
          // Unsupported triangle/heightfield/convex shapes are labelled in the report, not guessed.
          let geo: THREE.BufferGeometry | null = null;
          if (c.shape === 1) geo = new THREE.BoxGeometry(...c.half.map(x => x * 2) as [number, number, number]);
          if (c.shape === 0) geo = new THREE.SphereGeometry(c.radius, 10, 8);
          if (c.shape === 2) geo = new THREE.CapsuleGeometry(c.radius, c.height * 2, 4, 8);
          if (c.shape === 10) geo = new THREE.CylinderGeometry(c.radius, c.radius, c.height * 2, 10);
          if (!geo) continue;
          const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colliders ? 0x44ff88 : 0x748087, wireframe: colliders, depthTest: !colliders }));
          mesh.position.fromArray(c.position); mesh.quaternion.fromArray(c.rotation); this.group.add(mesh);
        }
      }
      if (orbit) { camera.position.set(s.center[0] + 8, s.center[1] + 7, s.center[2] + 8); this.controls.target.fromArray(s.center); }
    }
    // Probes are exact physics-tick evidence and change independently of the 4 Hz world sample.
    const old = this.group.getObjectByName('probes');
    old?.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose(); }); old?.removeFromParent();
    const points = new THREE.Group(); points.name = 'probes';
    if (colliders) for (const p of probes.slice(0, 128)) if (p.hit) {
      const start = new THREE.Vector3().fromArray(p.hit.point), end = start.clone().addScaledVector(new THREE.Vector3().fromArray(p.hit.normal), 0.4);
      points.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), new THREE.LineBasicMaterial({ color: 0xff4488, depthTest: false })));
    }
    this.group.add(points);
    this.controls.enabled = orbit; if (orbit) this.controls.update();
  }
  private clear() {
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.geometry && ![...this.geometries.values()].includes(m.geometry)) m.geometry.dispose(); if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose(); });
    this.group.clear();
  }
  hide() { if (this.hidden.size) { G.scene.background = this.background; G.scene.fog = this.fog; } this.controls.enabled = false; for (const [o, visible] of this.hidden) o.visible = visible; this.hidden.clear(); this.group.removeFromParent(); }
  dispose() { this.hide(); this.clear(); for (const g of this.geometries.values()) g.dispose(); this.geometries.clear(); this.controls.dispose(); }
}
