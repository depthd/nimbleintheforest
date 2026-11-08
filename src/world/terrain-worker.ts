import { buildTerrainGeometry, type TerrainGeometryData } from './terrain-geometry';
import { SnowCover, type SnowCoverZone } from './snow-cover';
import { WorldSnowTerrain } from './snow-terrain';

interface RegionData { h: Float32Array; water: Float32Array; n: number; size: number; ox: number; oz: number }
let region: RegionData;
let cover: SnowCover;
let terrain: WorldSnowTerrain;
let revision = -1;
function setCover(zones: SnowCoverZone[], nextRevision: number) {
  cover = new SnowCover({ minX: -region.ox, minZ: -region.oz, maxX: region.size - region.ox, maxZ: region.size - region.oz });
  for (const zone of zones) cover.add(zone);
  revision = nextRevision;
}
self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    region = data.region;
    setCover(data.zones, data.revision);
    terrain = new WorldSnowTerrain(region, (x, z) => cover.looseAt(x, z, terrain.heightAt(x, z)));
    return;
  }
  if (data.zones) setCover(data.zones, data.revision);
  const geometry = buildTerrainGeometry(region, data.ci, data.cj, data.lod, {
    heightAt: (x, z) => .28 * terrain.retentionAt(x, z),
    detailedAt: (x, z, size) => cover.detailedAt(x, z, size) || terrain.detailedAt(x, z, size),
  });
  const buffers = (g: TerrainGeometryData) => [g.position.buffer, g.normal.buffer, g.depth.buffer, g.snowNormal.buffer, g.index.buffer,
    ...(g.packed ? [g.packed.position.buffer, g.packed.normal.buffer, g.packed.index.buffer] : [])];
  self.postMessage({ id: data.id, ci: data.ci, cj: data.cj, lod: data.lod, revision, geometry }, { transfer: buffers(geometry) });
};
