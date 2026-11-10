// Structural checks complement Rapier walking; they do not rate visual quality.
const assert = require('node:assert/strict');

// These limits retain the previous checks' walking and useful-floor standards.
// The 4 m raster is a terrain-level certificate; final geometry still needs Rapier.
const STEP = 4, WALK_SLOPE = .85, WALK_GRADIENT = .7;
const FLOOR_SLOPE = .5, FLOOR_DEVIATION = 18, EPSILON = 1e-7;

function polygonDistance(polygon, x, z) {
  let inside = false, distance2 = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const length2 = dx * dx + dz * dz;
    const t = length2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length2)) : 0;
    distance2 = Math.min(distance2, (x - a[0] - t * dx) ** 2 + (z - a[1] - t * dz) ** 2);
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return (inside ? 1 : -1) * Math.sqrt(distance2);
}

// Testing only raster endpoints would allow an edge across a concave boundary.
// Split at every polygon crossing and require every intervening interval inside.
function segmentInside(polygon, a, b) {
  if (polygonDistance(polygon, a.x, a.z) < -EPSILON || polygonDistance(polygon, b.x, b.z) < -EPSILON) return false;
  const dx = b.x - a.x, dz = b.z - a.z, cuts = [0, 1];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const p = polygon[j], q = polygon[i], ex = q[0] - p[0], ez = q[1] - p[1];
    const cross = dx * ez - dz * ex;
    if (Math.abs(cross) < EPSILON) continue;
    const px = p[0] - a.x, pz = p[1] - a.z;
    const t = (px * ez - pz * ex) / cross, u = (px * dz - pz * dx) / cross;
    if (t > 0 && t < 1 && u >= -EPSILON && u <= 1 + EPSILON) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    const t = (cuts[i - 1] + cuts[i]) / 2;
    if (polygonDistance(polygon, a.x + dx * t, a.z + dz * t) < -EPSILON) return false;
  }
  return true;
}

function inspectRegionConnectivity(land, region) {
  const failures = [], access = region.access;
  const report = { id: region.id, minConnectedArea: access?.minConnectedArea, connectedUsefulArea: 0, connectedWalkArea: 0, ports: [], failures };
  if (!access || !Number.isFinite(access.core?.x) || !Number.isFinite(access.core?.z) || !Number.isFinite(access.minConnectedArea) || !(access.minConnectedArea > 0)) {
    failures.push('Missing access contract: core {x,z} and positive minConnectedArea are required');
    return report;
  }
  const polygon = region.polygon;
  const minX = Math.floor(Math.min(...polygon.map(p => p[0])) / STEP) * STEP;
  const minZ = Math.floor(Math.min(...polygon.map(p => p[1])) / STEP) * STEP;
  const nx = Math.ceil((Math.max(...polygon.map(p => p[0])) - minX) / STEP) + 1;
  const nz = Math.ceil((Math.max(...polygon.map(p => p[1])) - minZ) / STEP) + 1;
  const at = k => ({ x: minX + k % nx * STEP, z: minZ + Math.floor(k / nx) * STEP });
  const supportHeight = (x, z) => {
    const p = land.world(x, z), water = land.waterAt(p.x, p.z);
    return Math.max(land.heightAt(p.x, p.z), Number.isFinite(water) ? water : -Infinity);
  };
  const sample = (x, z) => {
    const p = land.world(x, z), height = supportHeight(x, z);
    const water = land.waterAt(p.x, p.z), terrain = land.heightAt(p.x, p.z);
    // Ice is an actual support surface in this experiment. Its shore transition
    // must still satisfy the same slope/step bounds; water is not a free pass.
    const slope = Number.isFinite(water) && water >= terrain
      ? Math.hypot(supportHeight(x + 2, z) - supportHeight(x - 2, z), supportHeight(x, z + 2) - supportHeight(x, z - 2)) / 4
      : land.slopeAt(p.x, p.z);
    const floor = region.y + (x - region.x) * region.tiltX + (z - region.z) * region.tiltZ;
    return { height, slope, floorDeviation: Math.abs(height - floor) };
  };
  const permitted = (s, useful) => Number.isFinite(s.height) && s.slope < (useful ? FLOOR_SLOPE : WALK_SLOPE)
    && (!useful || s.floorDeviation <= FLOOR_DEVIATION);
  const samples = new Array(nx * nz), walkable = new Uint8Array(nx * nz), useful = new Uint8Array(nx * nz), areaCell = new Uint8Array(nx * nz);
  for (let k = 0; k < samples.length; k++) {
    const p = at(k), distance = polygonDistance(polygon, p.x, p.z);
    if (distance < -EPSILON) continue;
    samples[k] = sample(p.x, p.z);
    walkable[k] = permitted(samples[k], false) ? 1 : 0;
    useful[k] = permitted(samples[k], true) ? 1 : 0;
    // Count only complete squares contained in the polygon, never the area of
    // raster cells extending outside it. This is a conservative lower bound.
    areaCell[k] = distance >= STEP / Math.SQRT2 ? 1 : 0;
  }
  const passage = (a, b, usefulFloor) => {
    if (!segmentInside(polygon, a, b)) return false;
    const length = Math.hypot(b.x - a.x, b.z - a.z), count = Math.max(1, Math.ceil(length));
    let previous;
    for (let i = 0; i <= count; i++) {
      const s = sample(a.x + (b.x - a.x) * i / count, a.z + (b.z - a.z) * i / count);
      if (!permitted(s, usefulFloor)) return false;
      if (previous && Math.abs(s.height - previous.height) > WALK_GRADIENT * length / count + EPSILON) return false;
      previous = s;
    }
    return true;
  };
  const attach = (point, usefulFloor) => {
    if (polygonDistance(polygon, point.x, point.z) < -EPSILON) return { cell: -1, reason: 'outside region.polygon' };
    const s = sample(point.x, point.z);
    if (!permitted(s, usefulFloor)) return { cell: -1, reason: usefulFloor ? 'core is not useful floor' : 'point is not walkable', ...s };
    const i = Math.round((point.x - minX) / STEP), j = Math.round((point.z - minZ) / STEP), candidates = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = i + dx, z = j + dz, k = z * nx + x;
      if (x < 0 || z < 0 || x >= nx || z >= nz || !(usefulFloor ? useful[k] : walkable[k])) continue;
      const p = at(k), distance = Math.hypot(p.x - point.x, p.z - point.z);
      if (distance <= STEP * Math.SQRT2 + EPSILON) candidates.push({ cell: k, distance, point: p });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    for (const c of candidates) if (passage(point, c.point, usefulFloor)) return { cell: c.cell, distance: c.distance, ...s };
    return { cell: -1, reason: 'no in-polygon walkable raster attachment within one cell diagonal', ...s };
  };
  const flood = (start, usefulFloor) => {
    const seen = new Uint8Array(nx * nz), queue = [];
    if (start < 0) return { seen, area: 0 };
    seen[start] = 1;
    queue.push(start);
    let area = 0;
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q], x = k % nx, z = Math.floor(k / nx), p = at(k);
      if (areaCell[k]) area += STEP * STEP;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, zz = z + dz, next = zz * nx + xx;
        if (xx < 0 || zz < 0 || xx >= nx || zz >= nz || seen[next] || !(usefulFloor ? useful[next] : walkable[next])) continue;
        if (Math.abs(samples[next].height - samples[k].height) > WALK_GRADIENT * STEP || !passage(p, at(next), usefulFloor)) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    return { seen, area };
  };
  const coreWalk = attach(access.core, false), coreFloor = attach(access.core, true);
  report.core = { position: access.core, walk: coreWalk, usefulFloor: coreFloor };
  if (coreWalk.cell < 0) failures.push(`Core: ${coreWalk.reason}`);
  if (coreFloor.cell < 0) failures.push(`Useful core: ${coreFloor.reason}`);
  const walk = flood(coreWalk.cell, false), floor = flood(coreFloor.cell, true);
  report.connectedWalkArea = walk.area;
  report.connectedUsefulArea = floor.area;
  if (floor.area < access.minConnectedArea) failures.push(`Useful floor component at core is ${floor.area} m2; contract requires ${access.minConnectedArea} m2`);
  const ports = land.routes.flatMap(route => [
    ...(route.from === region.id ? [{ id: `${route.id}:from`, point: route.points[0] }] : []),
    ...(route.to === region.id ? [{ id: `${route.id}:to`, point: route.points.at(-1) }] : []),
  ]);
  if (!ports.length) failures.push('Living region has no arrival/departure port');
  for (const port of ports) {
    const attachment = attach(port.point, false), reached = attachment.cell >= 0 && walk.seen[attachment.cell] === 1;
    report.ports.push({ id: port.id, position: port.point, reached, ...attachment });
    if (!reached) failures.push(`${port.id}: ${attachment.reason || 'disconnected from core inside region.polygon'}`);
  }
  return report;
}

function checkConnectivity(land) {
  const ids = new Set(land.regions.map(r => r.id));
  const edges = land.plan.traversal;
  const visited = new Set(['lowland']);
  for (let n=0; n<ids.size; n++) for (const e of edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to), `Unknown endpoint ${e.id}`);
    if (visited.has(e.from)) visited.add(e.to);
    if (visited.has(e.to)) visited.add(e.from);
  }
  assert.equal(visited.size, ids.size, 'Every geographic region must be connected');
  // Loops are a reported property, not a requirement: a living destination may
  // legitimately have a single entrance. Its port must still reach its own core.
  const regionAccess = land.regions.map(r => inspectRegionConnectivity(land, r));
  const failures = regionAccess.filter(r => r.failures.length);
  assert.equal(failures.length, 0, `Region access contracts failed:\n${JSON.stringify(failures, null, 2)}`);
  // A reachable crest must reveal the basin below from standing eye height.
  // This only certifies terrain sightlines; rock occlusion needs actual frames.
  const eye=land.views.find(v=>v.id==='summit').position;
  const cirque=land.regions.find(r=>r.id==='cirque');
  let visible=0;
  for(const [dx,dz] of [[0,0],[-50,15],[20,30],[-60,50]]) {
    const target=land.world(cirque.x+dx,cirque.z+dz);
    const ty=land.heightAt(target.x,target.z)+1.7;
    const n=Math.ceil(Math.hypot(target.x-eye.x,target.z-eye.z)/2);
    let clear=true;
    for(let i=1;i<n;i++) {
      const t=i/n,x=eye.x+(target.x-eye.x)*t,z=eye.z+(target.z-eye.z)*t;
      if(land.heightAt(x,z)>eye.y+(ty-eye.y)*t){clear=false;break;}
    }
    if(clear)visible++;
  }
  assert.ok(visible>=2, `Crest hides the destination basin (${visible}/4 terrain sightlines)`);
  return {regions:ids.size,connections:edges.length,independentLoops:edges.length-ids.size+1,crestSightlines:visible,regionAccess};
}
module.exports={checkConnectivity,inspectRegionConnectivity};
