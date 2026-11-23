// Run from the integrated checkout. A wall block behind an occluder still
// contributes to this conservative projected footprint.
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const repo = createRequire(path.resolve('package.json'));
const { createCanvas } = repo('@napi-rs/canvas');
const THREE = repo('three');
const ts = repo('typescript');

require.extensions['.ts'] = (module, file) => {
  const source = fs.readFileSync(file, 'utf8');
  const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };
  module._compile(ts.transpileModule(source, { compilerOptions: options }).outputText, file);
};

const plateau = name => repo('./experiments/plateau/' + name + '.ts');
const { plateauTop, mountainEnding, buildMountainMasses } = plateau('mountain-shape');
const { buildWedgeAscent } = plateau('wedge-ascent');
const { reliefGrid } = plateau('seam-relief-fixture');
const { bluntTip } = plateau('wedge-tip-profile');
const { mountainRim } = plateau('mountain-snow');
const { ringPoint } = plateau('wedge-snow-layer');
const { radialSurface } = plateau('wedge-rocks');
const { sampleGrid } = plateau('seam-boundary');
const { buildRoundedWall } = plateau('slice-wall-rounded');
const { buildAngularWall } = plateau('slice-wall-angular');

const source = reliefGrid(plateauTop);
const heights = source.heights.map((_, i) => plateauTop(
  source.x0 + i % (source.n + 1) * source.cell,
  source.z0 + Math.floor(i / (source.n + 1)) * source.cell
));
const junction = buildWedgeAscent(source, { ...source, heights }, mountainEnding, bluntTip);
const rim = mountainRim(junction);
const groundAt = (x, z) => sampleGrid(source, x, z).y;
const dressing = buildMountainMasses(
  a => ringPoint(rim, a), radialSurface([junction.cut.underside]), groundAt
);
const entrance = dressing.entrance;
const site = { ...entrance, width: 100, groundAt };
const oldSurfaces = [
  [dressing.rocks, entrance.rockStart, entrance.rockEnd],
  [dressing.snow, entrance.snowStart, entrance.snowEnd]
];
if (!oldSurfaces.every(([, first, last]) => Number.isInteger(first) && last > first)) {
  throw Error('Missing the original entrance index range');
}

const outputDir = process.argv[2];
if (!outputDir) throw Error('Provide an output directory for the projected masks');
fs.mkdirSync(outputDir, { recursive: true });
const width = 800;
const height = 450;
const camera = new THREE.PerspectiveCamera(27, width / height, 0.2, 10500);
camera.position.set(-950, 160, -580);
camera.lookAt(-270, 66, -126);
camera.updateMatrixWorld();
const scale = new THREE.Vector3(1.85, 1, 1.85);

function fillProjectedTriangles(context, mesh, first, last) {
  const projected = new Map();
  for (let k = first; k < last; k += 3) {
    context.beginPath();
    for (let j = 0; j < 3; j++) {
      const id = mesh.indices[k + j];
      if (!projected.has(id)) {
        const v = new THREE.Vector3().fromArray(mesh.positions, id * 3).multiply(scale).project(camera);
        projected.set(id, [(1 + v.x) * width / 2, (1 - v.y) * height / 2]);
      }
      const [x, y] = projected.get(id);
      if (j === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();
  }
}

const families = [
  { family: 'rounded', builder: buildRoundedWall, counts: [4, 7, 10] },
  { family: 'angular', builder: buildAngularWall, counts: [5, 8, 12] }
];
for (const { family, builder, counts } of families) {
  for (const [preset, count] of counts.entries()) {
    const generated = builder(site, count, 42);
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#fff';
    for (const surface of oldSurfaces) fillProjectedTriangles(context, ...surface);
    for (const mesh of [generated.rock, generated.snow]) {
      fillProjectedTriangles(context, mesh, 0, mesh.indices.length);
    }
    const fileName = family + '-' + preset + '.png';
    fs.writeFileSync(path.join(outputDir, fileName), canvas.toBuffer('image/png'));
  }
}
