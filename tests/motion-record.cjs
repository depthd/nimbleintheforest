const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { buildSync } = require('esbuild');
function compile(file) {
  const m = new Module(__filename);
  m._compile(buildSync({ entryPoints: [path.join(__dirname, file)], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename);
  return m.exports;
}
const { MotionRing, diagnosticCopy, validateRecording, readRecording, MAX_RECORD_FRAMES } = compile('../src/game/motion-record.ts');
const { SnowField } = compile('../src/world/snow-field.ts');
let count = 0;
function test(name, run) { run(); count++; console.log('PASS ', name); }
const initial = { enabled: true, thickness: 0.28, ratio: 2.6, cells: [[0, 0, 0.01, 1]] };
const frame = (id, t, changes = []) => ({ id, t, dt: 1 / 60, alpha: 0.37, pose: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
  camera: [0, 2, 3, 0, 0, 0, 1, 48, 1.5, 0.05, 14000], view: 1,
  input: { keys: ['KeyW', 'ShiftLeft'], mouseDX: 125 }, player: { pos: [0, 0, 0] }, animation: {}, ticks: [], snow: { enabled: true, changes } });
const recording = () => ({ format: 'nimble-motion', version: 1, context: { seed: 42, settings: { size: 3072 }, snowScene: true }, rig: ['-1:Group:player-avatar:'], initialSnow: initial,
  frames: [frame(1, 0), frame(2, 0.02)], notes: [{ frameId: 2, text: 'Нога скользит — проверить' }], selectedFrameId: 2 });
test('rolling history advances its snow baseline instead of losing old deformation', () => {
  const ring = new MotionRing(initial);
  ring.push(frame(0, 0, [[0, 0, 0.01, 1, 0.02, 2]]));
  ring.push(frame(1, 21, [[0, 0, 0.02, 2, 0.03, 3]]));
  assert.equal(ring.frames.length, 1); assert.deepEqual(ring.initialSnow().cells, [[0, 0, 0.02, 2]]);
});
test('rolling history retains resets and a fixed maximum frame count', () => {
  const ring = new MotionRing(initial), a = frame(0, 0);
  a.snow.reset = { enabled: true, thickness: 0.28, ratio: 1.25, cells: [[3, 4, -0.03, 100]] };
  ring.push(a); ring.push(frame(1, 21));
  assert.equal(ring.initialSnow().ratio, 1.25); assert.deepEqual(ring.initialSnow().cells, [[3, 4, -0.03, 100]]);
  for (let i = 2; i < MAX_RECORD_FRAMES + 20; i++) ring.push(frame(i, 21 + i / 1000));
  assert.equal(ring.frames.length, MAX_RECORD_FRAMES);
});
test('diagnostic snapshots own their data', () => {
  const src = { feet: [{ position: { isVector3: true, toArray: () => [1, 2, 3] }, phase: 'stance' }], active: true };
  const copy = diagnosticCopy(src); copy.feet[0].position[0] = 99; copy.feet[0].phase = 'air';
  assert.equal(src.feet[0].phase, 'stance'); assert.deepEqual(src.feet[0].position.toArray(), [1, 2, 3]);
});
test('portable recording keeps interpolation, mouse input, selected frame and Unicode notes', () => {
  const data = validateRecording(JSON.parse(JSON.stringify(recording())));
  assert.equal(data.frames[0].alpha, 0.37); assert.equal(data.frames[0].input.mouseDX, 125);
  assert.equal(data.selectedFrameId, 2); assert.equal(data.notes[0].text, 'Нога скользит — проверить');
});
test('invalid rigs, timelines, coordinates and prototype keys are rejected', () => {
  for (const mutate of [d => d.frames[0].pose.pop(), d => d.frames[1].id = 1, d => d.frames[1].t = -1,
    d => d.frames[0].snow.changes.push([0.5, 0, 0, 0, 0, 0]), d => d.frames[0].camera[0] = Infinity,
    d => d.selectedFrameId = 999, d => Object.defineProperty(d.context, '__proto__', { value: {}, enumerable: true })]) {
    const d = recording(); mutate(d); assert.throws(() => validateRecording(d));
  }
});
test('snow journals restore exact stored state forward and backward without excavation', () => {
  const source = new SnowField({ thickness: 0.28, densityRatio: 2.6 });
  source.remove(0, 0, 0.3, 0.03); const before = source.recordedCells();
  const changes = []; source.onRecordedChange = c => changes.push(c);
  source.remove(0.2, 0.1, 0.3, 0.1); source.add(0.5, 0.4, 0.2, 0.005);
  const replay = new SnowField({ thickness: 0.28, densityRatio: 2.6 }); before.forEach(c => replay.applyRecordedCell(...c));
  changes.forEach(c => replay.applyRecordedCell(c[0], c[1], c[4], c[5]));
  assert.deepEqual(replay.recordedCells(), source.recordedCells());
  changes.reverse().forEach(c => replay.applyRecordedCell(c[0], c[1], c[2], c[3]));
  assert.deepEqual(replay.recordedCells(), before);
});
const worldRecording = () => {
  const d = recording();
  d.diagnostics = { version: 1, radius: 32, interval: 0.25, coverage: ['local snapshot'], meshes: {
    triangle: { positions: [0,0,0, 1,0,0, 0,0,1], indices: [0,1,2], color: 0xffffff }
  }, samples: [{ id: 0, time: 0, center: [1,2,3], terrain: Array(289).fill(0), objects: [{
    id: 1, name: 'Бревно', kind: 'item', definition: 'log', position: [1,2,3], state: { hp: 10 },
    meshes: [{geometry: 'triangle', matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 1,2,3,1]}], colliders: []
  }], systems: { weather: { temp: -20 } }, truncated: false }] };
  d.frames.forEach(f => f.worldSampleId = 0);
  d.notes[0] = { ...d.notes[0], expected: 'Удержится', actual: 'Падает', position: [1,2,3] };
  return d;
};
test('local world package preserves meshes, system state and expected/actual map pins', () => {
  const d = worldRecording(); assert.deepEqual(validateRecording(JSON.parse(JSON.stringify(d))), d);
});
test('broken world references, oversized geometry and malformed pins are rejected', () => {
  for (const mutate of [d => d.frames[0].worldSampleId = 9,
    d => d.diagnostics.samples[0].objects[0].meshes[0].geometry = 'missing',
    d => d.diagnostics.meshes.triangle.indices[0] = 99,
    d => d.diagnostics.samples[0].terrain.pop(),
    d => d.diagnostics.samples[0].objects[0].meshes[0].matrix[0] = Infinity,
    d => d.notes[0].position = [1,2], d => d.notes[0].expected = 123,
    d => d.diagnostics.samples.push(d.diagnostics.samples[0])]) {
    const d = worldRecording(); mutate(d); assert.throws(() => validateRecording(d));
  }
});
(async () => {
  const d = recording(), raw = new Blob([JSON.stringify(d)]);
  const gzip = await new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  assert.deepEqual(await readRecording(gzip), d); assert.deepEqual(await readRecording(raw), d);
  console.log('PASS  gzip and plain JSON round-trip'); count++;
  console.log(`${count} motion recording checks passed`);
})().catch(e => { console.error(e); process.exitCode = 1; });
