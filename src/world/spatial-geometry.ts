import * as THREE from 'three';

/** Split an indexed regular grid without rebuilding vertices or its smooth normals.
 * Quads can be missing (the backdrop has a hole where the playable map sits).
 * Each triangle belongs to the tile containing its quad's upper-left vertex.
 */
export function splitGridGeometry(g: THREE.BufferGeometry, cells: number, tileCells = 64): THREE.BufferGeometry[] {
  const index = g.index, position = g.attributes.position;
  if (!Number.isInteger(cells) || cells < 1 || !Number.isInteger(tileCells) || tileCells < 1
    || !index || !position || position.count !== (cells + 1) ** 2 || index.count % 3) {
    throw new Error('splitGridGeometry needs an indexed square grid and positive integer cell counts');
  }
  const width = cells + 1, across = Math.ceil(cells / tileCells);
  const tiles = new Map<number, number[]>();
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    const x = Math.min(a % width, b % width, c % width);
    const z = Math.min(Math.floor(a / width), Math.floor(b / width), Math.floor(c / width));
    const key = Math.floor(z / tileCells) * across + Math.floor(x / tileCells);
    let indices = tiles.get(key);
    if (!indices) { indices = []; tiles.set(key, indices); }
    indices.push(a, b, c);
  }

  const p = new THREE.Vector3(), center = new THREE.Vector3();
  return [...tiles.values()].map(indices => {
    const tile = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(g.attributes)) tile.setAttribute(name, attribute);
    tile.morphAttributes = { ...g.morphAttributes };
    tile.morphTargetsRelative = g.morphTargetsRelative;
    tile.setIndex(indices);
    // computeBoundingBox/Sphere would include EVERY shared vertex, defeating
    // culling. Limit both bounds to the indices that this tile actually draws.
    const box = new THREE.Box3();
    for (const i of indices) box.expandByPoint(p.fromBufferAttribute(position, i));
    box.getCenter(center);
    let radiusSq = 0;
    for (const i of indices) radiusSq = Math.max(radiusSq, p.fromBufferAttribute(position, i).distanceToSquared(center));
    tile.boundingBox = box;
    tile.boundingSphere = new THREE.Sphere(center.clone(), Math.sqrt(radiusSq));
    return tile;
  });
}
