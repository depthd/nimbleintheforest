import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Landforms, SIZE, CELL, VERSION, type Point } from "./landforms";
import { Rng, clamp, smoothstep } from "../../src/core/rng";
import { RockSkin } from "../../src/gen/rock-skin";
import { blockTriangles, type CliffBlock } from "../../src/gen/cliffs";
import "./style.css";
const $ = (id: string) => document.getElementById(id)!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
const lastShadow = new THREE.Vector3(Infinity, Infinity, Infinity);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$("world").append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#c1d5e4");
scene.fog = new THREE.FogExp2("#c1d5e4", 0.00082);
const camera = new THREE.PerspectiveCamera(
  65,
  innerWidth / innerHeight,
  0.15,
  4000,
);
const sun = new THREE.DirectionalLight("#fff0d8", 2.5);
sun.position.set(-350, 550, 250);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -330;
sun.shadow.camera.right = 330;
sun.shadow.camera.top = 330;
sun.shadow.camera.bottom = -330;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 1700;
sun.shadow.normalBias = 0.9;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight("#b8d5f4", "#727a83", 1.15);
scene.add(hemi);
const skyGeo = new THREE.SphereGeometry(2500, 24, 16),
  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color("#648fae") },
      bottom: { value: new THREE.Color("#d9e3e8") },
    },
    vertexShader:
      "varying vec3 vP; void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader:
      "varying vec3 vP; uniform vec3 top; uniform vec3 bottom;void main(){float k=pow(clamp(normalize(vP).y,0.,1.),.55);gl_FragColor=vec4(mix(bottom,top,k),1.);}",
  });
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);
let land: Landforms,
  group = new THREE.Group(),
  routeGroup = new THREE.Group(),
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  collider: RAPIER.Collider,
  kcc: RAPIER.KinematicCharacterController;
let dirty = true;
let fly = false,
  manual = false,
  ready = false,
  yaw = 0,
  pitch = 0,
  vy = 0,
  grounded = false,
  position = new THREE.Vector3(),
  generationMs = 0;
let rockBlocks: CliffBlock[] = [];
const rockCols = new Map<number, RAPIER.Collider>();
let rockCenter = { x: Infinity, z: Infinity };
let movement = { x: 0, z: 0 };
const keys = new Set<string>();
let jump = false;
type Layer = "clay" | "terrain" | "rocks" | "full";
let activeLayer: Layer = "full";
function supportAt(x: number, z: number) {
  const ground = land.heightAt(x, z),
    ice = land.waterAt(x, z);
  return Number.isNaN(ice) ? ground : Math.max(ground, ice);
}
function layers(value: Layer) {
  activeLayer = value;
  const terrain = group.children[0] as THREE.Mesh | undefined;
  if (!terrain?.userData.baseMaterial) return;
  terrain.material =
    value === "clay"
      ? terrain.userData.clayMaterial
      : terrain.userData.baseMaterial;
  group.children.forEach(
    (o, i) =>
      (o.visible =
        value === "full" ||
        i === 0 ||
        (value === "rocks" && (i === 3 || i === 4))),
  );
  renderer.shadowMap.needsUpdate = true;
  dirty = true;
}
$("layers").onchange = () =>
  layers(($("layers") as HTMLSelectElement).value as Layer);
function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (o.userData.baseMaterial && o.userData.baseMaterial !== o.material)
        mats.push(o.userData.baseMaterial);
      if (o.userData.clayMaterial && o.userData.clayMaterial !== o.material)
        mats.push(o.userData.clayMaterial);
      for (const m of mats) m.dispose();
    }
  });
  scene.remove(g);
}
function terrainGeometry() {
  const n = land.n,
    nf = n + 1,
    P = new Float32Array(nf * nf * 3),
    C = new Float32Array(P.length),
    idx = new Uint32Array(n * n * 6);
  const snow = new THREE.Color("#e2e7eb"),
    stone = new THREE.Color("#454d58"),
    soil = new THREE.Color("#8b9296"),
    c = new THREE.Color();
  let k = 0;
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const x = i * CELL - SIZE / 2,
        z = j * CELL - SIZE / 2,
        y = land.heights[j * nf + i],
        v = j * nf + i;
      P.set([x, y, z], v * 3);
      const slope = land.slopeAt(x, z),
        p = land.local(x, z),
        grain = land.noise.noise(x / 17, z / 17);
      const rock = smoothstep(0.7, 1.3, slope);
      c.copy(snow).lerp(stone, rock);
      c.multiplyScalar(1 + grain * 0.025);
      if (rock > 0.2) {
        const bed =
          (Math.sin(
            (y +
              0.12 * p.x +
              0.08 * p.z +
              land.noise.noise(x / 80, z / 80) * 4) *
              1.25,
          ) +
            1) *
          0.5;
        c.lerp(soil, (1 - bed) * 0.18 * rock);
      }
      C.set([c.r, c.g, c.b], v * 3);
    }
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * nf + i,
        b = a + 1,
        c = a + nf,
        d = c + 1;
      idx.set([a, c, b, b, c, d], k);
      k += 6;
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(P, 3));
  g.setAttribute("color", new THREE.BufferAttribute(C, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}
function iceGeometry() {
  const l = land.lake,
    P: number[] = [],
    I: number[] = [];
  const center = land.world(l.x, l.z);
  P.push(center.x, l.y, center.z);
  const N = 100;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2,
      p = land.world(l.x + Math.cos(a) * l.rx, l.z + Math.sin(a) * l.rz);
    P.push(p.x, l.y, p.z);
    if (i < N) I.push(0, i + 1, i + 2);
  }
  if (land.mirror === 1)
    for (let i = 0; i < I.length; i += 3)
      [I[i + 1], I[i + 2]] = [I[i + 2], I[i + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}
function addForest() {
  const rng = new Rng(land.seed ^ 0x64a32),
    trees: {
      x: number;
      y: number;
      z: number;
      h: number;
      r: number;
    }[] = [],
    rocks: {
      x: number;
      y: number;
      z: number;
      s: number;
    }[] = [];
  for (let z = -730; z < 730; z += 19)
    for (let x = -730; x < 730; x += 19) {
      const wx = x + rng.float(-7, 7),
        wz = z + rng.float(-7, 7),
        y = land.heightAt(wx, wz),
        slope = land.slopeAt(wx, wz),
        noise = land.noise.noise(wx / 130, wz / 130),
        p = land.local(wx, wz),
        upper = land.forestAt(wx, wz);
      if (
        !Number.isNaN(land.waterAt(wx, wz)) ||
        land.routeDistance(wx, wz) < 4.5 ||
        slope > 0.72 ||
        y > (upper ? 225 : 180) + noise * 30 ||
        rng.next() > (upper ? 0.66 : 0.46) * (noise > 0.1 ? 1 : 0.45)
      )
        continue;
      const h = rng.float(8, 18) * (1 - smoothstep(140, 215, y) * 0.4);
      trees.push({ x: wx, y, z: wz, h, r: h * rng.float(0.13, 0.2) });
    }
  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.24, 1, 5),
    foliageGeo = new THREE.ConeGeometry(1, 1, 7),
    trunks = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: "#5a4940", roughness: 1 }),
      trees.length,
    ),
    leaves = new THREE.InstancedMesh(
      foliageGeo,
      new THREE.MeshStandardMaterial({ color: "#24453f", roughness: 1 }),
      trees.length * 5,
    ),
    caps = new THREE.InstancedMesh(
      foliageGeo,
      new THREE.MeshStandardMaterial({ color: "#dce6e8", roughness: 1 }),
      trees.length * 5,
    );
  const o = new THREE.Object3D();
  let q = 0;
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    o.position.set(t.x, t.y + t.h * 0.44, t.z);
    o.scale.set(1, t.h * 0.88, 1);
    o.rotation.set(0, 0, 0);
    o.updateMatrix();
    trunks.setMatrixAt(i, o.matrix);
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(t.h * 0.38, 0.22).setTranslation(
        t.x,
        t.y + t.h * 0.38,
        t.z,
      ),
    );
    for (let k = 0; k < 5; k++) {
      const h = t.h * (0.4 - k * 0.038),
        r = t.r * (1 - k * 0.17),
        y = t.y + t.h * (0.31 + k * 0.145);
      o.position.set(t.x, y, t.z);
      o.scale.set(r, h, r);
      o.rotation.y = (i * 2.39 + k) * 0.7;
      o.updateMatrix();
      leaves.setMatrixAt(q, o.matrix);
      o.position.y = y + h * 0.14;
      o.scale.set(r * 0.78, h * 0.73, r * 0.78);
      o.updateMatrix();
      caps.setMatrixAt(q++, o.matrix);
    }
  }
  for (const m of [trunks, leaves, caps]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  const geo = new THREE.DodecahedronGeometry(1, 0),
    mat = new THREE.MeshStandardMaterial({
      color: "#6e7882",
      roughness: 1,
      flatShading: true,
    });
  for (let i = 0; i < 900; i++) {
    const x = rng.float(-730, 730),
      z = rng.float(-730, 730),
      y = land.heightAt(x, z);
    if (
      y < 30 ||
      land.slopeAt(x, z) > 0.85 ||
      land.routeDistance(x, z) < 9 ||
      !Number.isNaN(land.waterAt(x, z))
    )
      continue;
    rocks.push({ x, y, z, s: rng.float(0.7, 2.3) });
  }
  const boulders = new THREE.InstancedMesh(geo, mat, rocks.length);
  rocks.forEach((r, i) => {
    o.position.set(r.x, r.y + r.s * 0.15, r.z);
    o.scale.set(r.s, r.s * 0.65, r.s * 0.8);
    o.rotation.set(0, rng.float(0, 6.28), rng.float(-0.25, 0.25));
    o.updateMatrix();
    boulders.setMatrixAt(i, o.matrix);
    world.createCollider(
      RAPIER.ColliderDesc.ball(r.s * 0.65).setTranslation(
        r.x,
        r.y + r.s * 0.15,
        r.z,
      ),
    );
  });
  boulders.castShadow = true;
  boulders.receiveShadow = true;
  group.add(boulders);
  return { trees: trees.length, rocks: rocks.length };
}
function addRockSkin() {
  const water = new Float32Array(land.heights.length).fill(NaN);
  const skin = new RockSkin(
    {
      seed: land.seed,
      size: SIZE,
      n: land.n,
      cell: CELL,
      h: land.heights,
      water,
      ox: SIZE / 2,
      oz: SIZE / 2,
      edgeDist: (x, z) => SIZE / 2 - Math.max(Math.abs(x), Math.abs(z)),
    },
    {
      border: 60,
      minDeg: 51,
      exclude: (x, z) =>
        land.routeDistance(x, z) < 17 || !Number.isNaN(land.waterAt(x, z)),
    },
  );
  rockBlocks = skin.blocks;
  const pos: number[] = [],
    colors: number[] = [];
  const rng = new Rng(land.seed ^ 0x837);
  for (const b of skin.blocks) {
    const start = pos.length;
    blockTriangles(b, pos);
    const c = new THREE.Color("#505a65").multiplyScalar(rng.float(0.88, 1.1));
    for (let i = start; i < pos.length; i += 3) colors.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      flatShading: true,
    }),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  const snow = new THREE.BufferGeometry();
  snow.setAttribute(
    "position",
    new THREE.BufferAttribute(skin.caps.positions, 3),
  );
  snow.setIndex(new THREE.BufferAttribute(skin.caps.indices, 1));
  snow.computeVertexNormals();
  const caps = new THREE.Mesh(
    snow,
    new THREE.MeshStandardMaterial({ color: "#e1e7e9", roughness: 1 }),
  );
  caps.castShadow = true;
  caps.receiveShadow = true;
  group.add(caps);
  return skin.blocks.length;
}
function streamRock(force = false) {
  if (
    !force &&
    Math.hypot(position.x - rockCenter.x, position.z - rockCenter.z) < 5
  )
    return;
  rockCenter = { x: position.x, z: position.z };
  for (let i = 0; i < rockBlocks.length; i++) {
    const b = rockBlocks[i],
      d = Math.hypot(
        Math.max(b.minX - position.x, 0, position.x - b.maxX),
        Math.max(b.minZ - position.z, 0, position.z - b.maxZ),
      );
    if (d < 70 && !rockCols.has(i)) {
      const desc = RAPIER.ColliderDesc.convexHull(b.pts);
      if (desc) rockCols.set(i, world.createCollider(desc.setFriction(0.9)));
    } else if (d > 95 && rockCols.has(i)) {
      world.removeCollider(rockCols.get(i)!, false);
      rockCols.delete(i);
    }
  }
}
function addDrainage() {
  const points = land.drainage,
    positions: number[] = [],
    idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)],
      b = points[Math.min(points.length - 1, i + 1)],
      len = Math.hypot(b.x - a.x, b.z - a.z),
      nx = -(b.z - a.z) / len,
      nz = (b.x - a.x) / len;
    for (const side of [-1, 1]) {
      const p = land.world(
        points[i].x + nx * 2.3 * side,
        points[i].z + nz * 2.3 * side,
      );
      positions.push(p.x, points[i].y, p.z);
    }
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  }
  if (land.mirror === 1)
    for (let i = 0; i < idx.length; i += 3)
      [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({
      color: "#aecbd2",
      roughness: 0.6,
      side: THREE.DoubleSide,
    }),
  );
  group.add(m);
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(
      (g.getAttribute("position").array as Float32Array).slice(),
      Uint32Array.from(g.index!.array),
    ).setFriction(0.8),
  );
}
function addRoutes() {
  routeGroup = new THREE.Group();
  const colors = [0xe7bd65, 0x67d6bb, 0xe6a8af];
  land.routes.forEach((r, i) => {
    const p = land
      .worldRoute(r)
      .map((v) => new THREE.Vector3(v.x, land.heightAt(v.x, v.z) + 0.65, v.z));
    routeGroup.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(p),
        new THREE.LineBasicMaterial({ color: colors[i % colors.length], depthTest: false }),
      ),
    );
  });
  routeGroup.visible = false;
  scene.add(routeGroup);
}
function teleport(p: Point) {
  position.set(p.x, p.y - 1.7, p.z);
  vy = 0;
  movement = { x: 0, z: 0 };
  body.setTranslation(
    { x: position.x, y: position.y + 0.9, z: position.z },
    true,
  );
  body.setNextKinematicTranslation(body.translation());
  grounded = false;
  streamRock(true);
  updateSun();
  updateCamera();
}
function lookAt(p: Point) {
  const dx = p.x - camera.position.x,
    dz = p.z - camera.position.z;
  yaw = Math.atan2(-dx, -dz);
  pitch = Math.atan2(p.y - camera.position.y, Math.hypot(dx, dz));
  updateCamera();
}
function view(id: string) {
  const v = land.views.find((v) => v.id === id)!;
  fly = id === "overview";
  teleport(v.position);
  lookAt(v.target);
  $("status").textContent = v.name;
}
function updateCamera() {
  dirty = true;
  camera.position.copy(position).y += 1.7;
  camera.rotation.set(pitch, yaw, 0, "YXZ");
  camera.updateMatrixWorld();
  sky.position.copy(camera.position);
}
function fixed(dt: number) {
  if (!ready) return;
  const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0),
    side = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
    norm = Math.max(1, Math.hypot(forward, side));
  const speed = fly
    ? keys.has("ShiftLeft")
      ? 70
      : 25
    : keys.has("ShiftLeft")
      ? 4.58
      : 1.72;
  const vx = ((-Math.sin(yaw) * forward + Math.cos(yaw) * side) / norm) * speed,
    vz = ((-Math.cos(yaw) * forward - Math.sin(yaw) * side) / norm) * speed;
  if (fly) {
    position.x += vx * dt;
    position.z += vz * dt;
    position.y +=
      ((keys.has("Space") ? 1 : 0) - (keys.has("ControlLeft") ? 1 : 0)) *
      speed *
      dt;
    body.setTranslation(
      { x: position.x, y: position.y + 0.9, z: position.z },
      true,
    );
    body.setNextKinematicTranslation(body.translation());
    vy = 0;
  } else {
    streamRock();
    const acc = 1 - Math.exp(-dt * (grounded ? 5 : 0.8));
    movement.x += (vx - movement.x) * acc;
    movement.z += (vz - movement.z) * acc;
    if (jump && grounded) vy = 4.3;
    jump = false;
    vy = Math.max(-30, vy - 9.81 * dt);
    kcc.computeColliderMovement(collider, {
      x: movement.x * dt,
      y: vy * dt,
      z: movement.z * dt,
    });
    const m = kcc.computedMovement(),
      p = body.translation();
    body.setNextKinematicTranslation({
      x: p.x + m.x,
      y: p.y + m.y,
      z: p.z + m.z,
    });
    world.step();
    grounded = kcc.computedGrounded();
    if (grounded && vy < 0) vy = -0.5;
    const t = body.translation();
    position.set(t.x, t.y - 0.9, t.z);
    if (position.y < -50) view("lower");
  }
  updateCamera();
}
let stats = { trees: 0, rocks: 0, strata: 0 };
async function generate(seed: number) {
  ready = false;
  $("veil").style.display = "grid";
  await new Promise((r) => setTimeout(r, 30));
  const start = performance.now();
  disposeGroup(group);
  disposeGroup(routeGroup);
  world?.free();
  rockCols.clear();
  rockBlocks = [];
  rockCenter = { x: Infinity, z: Infinity };
  group = new THREE.Group();
  scene.add(group);
  land = new Landforms(seed);
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const g = terrainGeometry(),
    mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.97,
    });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec3 vTerrain;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      "#include <worldpos_vertex>\nvTerrain=(modelMatrix*vec4(transformed,1.)).xyz;",
    );
    shader.fragmentShader =
      "varying vec3 vTerrain;\nfloat grain(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,34.31)))*43758.5453);}\n" +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
 float rock=1.-smoothstep(.20,.55,vColor.r);
 float fine=grain(floor(vTerrain*3.));
 float bed=sin((vTerrain.y+.12*vTerrain.x+.08*vTerrain.z)*2.6);
 float joints=pow(abs(sin(vTerrain.x*.14+sin(vTerrain.z*.1)*2.)),16.);
 diffuseColor.rgb*=mix(.95+fine*.05,.80+fine*.12+bed*.055-joints*.13,rock);`,
    );
  };
  const terrain = new THREE.Mesh(g, mat);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  terrain.userData.baseMaterial = mat;
  terrain.userData.clayMaterial = new THREE.MeshStandardMaterial({
    color: "#b9b9b9",
    roughness: 1,
  });
  group.add(terrain);
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(
      (g.getAttribute("position").array as Float32Array).slice(),
      (g.index!.array as Uint32Array).slice(),
    ).setFriction(0.9),
  );
  const ice = iceGeometry();
  const lake = new THREE.Mesh(
    ice,
    new THREE.MeshStandardMaterial({
      color: "#9db9c2",
      roughness: 0.43,
      metalness: 0.06,
      side: THREE.DoubleSide,
    }),
  );
  lake.receiveShadow = true;
  group.add(lake);
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(
      (ice.getAttribute("position").array as Float32Array).slice(),
      Uint32Array.from(ice.index!.array),
    ).setFriction(0.8),
  );
  addDrainage();
  const strata = addRockSkin();
  stats = { ...addForest(), strata };
  addRoutes();
  body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.6, 0.3), body);
  kcc = world.createCharacterController(0.03);
  kcc.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
  kcc.setMinSlopeSlideAngle((55 * Math.PI) / 180);
  kcc.enableAutostep(0.32, 0.15, false);
  kcc.enableSnapToGround(0.35);
  $("views").replaceChildren();
  for (const v of land.views) {
    const b = document.createElement("button");
    b.textContent = v.name;
    b.dataset.view = v.id;
    b.onclick = () => view(v.id);
    $("views").append(b);
  }
  renderer.shadowMap.needsUpdate = true;
  generationMs = performance.now() - start;
  ready = true;
  layers(activeLayer);
  view("lower");
  for (let i = 0; i < 10; i++) fixed(1 / 60);
  $("veil").style.display = "none";
  const url = new URL(location.href);
  url.searchParams.set("seed", String(seed));
  history.replaceState(null, "", url);
}
function updateSun() {
  dirty = true;
  const evening = ($("light") as HTMLSelectElement).value === "evening";
  sun.target.position.copy(position);
  sun.target.updateMatrixWorld();
  sun.position
    .copy(position)
    .add(new THREE.Vector3(evening ? -500 : -350, evening ? 150 : 550, 250));
  lastShadow.copy(position);
  renderer.shadowMap.needsUpdate = true;
}
function lighting(mode: string) {
  renderer.shadowMap.needsUpdate = true;
  const evening = mode === "evening",
    overcast = mode === "overcast";
  sun.intensity = overcast ? 0.6 : evening ? 2 : 2.5;
  updateSun();
  sun.color.set(evening ? "#ffce9e" : "#fff0d8");
  hemi.intensity = overcast ? 1.5 : evening ? 0.8 : 1.15;
  scene.fog = new THREE.FogExp2(
    overcast ? "#c2cbd1" : evening ? "#c4b9b3" : "#c1d5e4",
    overcast ? 0.0015 : 0.00082,
  );
  skyMat.uniforms.top.value.set(
    overcast ? "#96a5af" : evening ? "#6e7e9f" : "#648fae",
  );
  skyMat.uniforms.bottom.value.set(
    overcast ? "#ccd4d8" : evening ? "#edc7a6" : "#d9e3e8",
  );
}
$("generate").onclick = () => {
  document.exitPointerLock();
  void generate(Number(($("seed") as HTMLInputElement).value) || 1).catch(fail);
};
$("collapse").onclick = () => document.body.classList.toggle("folded");
$("routes").onclick = () => {
  routeGroup.visible = !routeGroup.visible;
  dirty = true;
  $("routes").classList.toggle("active", routeGroup.visible);
};
$("walk").onclick = () => {
  if (fly) {
    const h = supportAt(position.x, position.z);
    teleport({ x: position.x, y: h + 1.85, z: position.z });
  }
  fly = false;
  void renderer.domElement.requestPointerLock();
};
$("fly").onclick = () => {
  fly = true;
  void renderer.domElement.requestPointerLock();
};
$("light").onchange = () => lighting(($("light") as HTMLSelectElement).value);
renderer.domElement.onclick = () => {
  if (ready) void renderer.domElement.requestPointerLock();
};
document.addEventListener("pointerlockchange", () => {
  document.body.classList.toggle(
    "locked",
    document.pointerLockElement === renderer.domElement,
  );
  keys.clear();
});
document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * 0.002;
  pitch = clamp(pitch - e.movementY * 0.002, -1.45, 1.45);
  updateCamera();
});
document.addEventListener("keydown", (e) => {
  if (
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLSelectElement
  )
    return;
  if (["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === "Space" && !e.repeat) jump = true;
});
document.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
let previous = performance.now(),
  acc = 0,
  frames = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - previous) / 1000, 0.1);
  previous = now;
  if (!manual && ready) {
    acc += dt;
    while (acc >= 1 / 60) {
      fixed(1 / 60);
      acc -= 1 / 60;
    }
  }
  if (ready) {
    if (++frames % 30 === 0) {
      if (position.distanceTo(lastShadow) > 20) updateSun();
      $("status").textContent =
        `${fly ? "Полёт" : "Пешком"} · высота ${position.y.toFixed(0)} м · seed ${land.seed} · верхняя долина ${land.upper.toFixed(0)} м`;
    }
    $("crosshair").style.display = document.pointerLockElement
      ? "block"
      : "none";
    if (!manual || dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
  }
}
requestAnimationFrame(frame);
function fail(e: unknown) {
  $("veil").textContent = String(e);
  console.error(e);
}
// Inspection API is confined to this page; ordinary game's __game is untouched.
Object.assign(window, {
  __mountains: {
    get ready() {
      return ready;
    },
    get land() {
      return land;
    },
    get world() {
      return world;
    },
    get stats() {
      return {
        ...stats,
        generationMs,
        version: VERSION,
        rockColliders: rockCols.size,
        triangles: land.n ** 2 * 2,
      };
    },
    get position() {
      return position.clone();
    },
    get grounded() {
      return grounded;
    },
    get fly() {
      return fly;
    },
    view,
    layers,
    supportAt,
    cameraAt: (eye: Point, target: Point) => {
      fly = true;
      teleport(eye);
      lookAt(target);
    },
    generate,
    lighting,
    manual: (v = true) => {
      manual = v;
      acc = 0;
    },
    steps: (n: number) => {
      for (let i = 0; i < n; i++) fixed(1 / 60);
    },
    teleport,
    lookAt,
    key: (key: string, down: boolean) => {
      if (down) keys.add(key);
      else keys.delete(key);
    },
    routes: (v: boolean) => (routeGroup.visible = v),
  },
});
await RAPIER.init();
const seed = Number(new URLSearchParams(location.search).get("seed")) || 42;
($("seed") as HTMLInputElement).value = String(seed);
await generate(seed).catch(fail);
