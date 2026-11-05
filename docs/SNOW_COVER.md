# Buildings and snow cover

`world/snow-cover.ts` owns a common registry of roof and floor footprints. These
are geometry rules, separate from the larger thermal/wind shelter volumes. The
cabin, porch, woodshed, huts, fishing huts, station, lean-tos, grottos and tower
register their boundaries in their builders.

Roof footprints remove the loose ground layer beneath them. Permanent frozen
snow remains on the immutable terrain. A registered floor masks both ground
layers at its actual elevation so neither can cover the wooden surface. A high
tower platform does not cut a hole in the terrain ten metres below it. A lean-to
without a floor exposes packed snow instead. Adjacent/overlapping roofs combine
using the minimum loose-snow allowance, without multiplying the transition.

The same registry controls initial loose material, allowed boot/dig/deposit
contacts, visible ground and trail fragments, their shadow passes, falling snow
particles and snowfall on the player's clothes. Ground contacts with wood, stone
or ice continue to use their real colliders. There are no special cabin-sized
rectangles in `WorldSnow` or snowfall rendering.

## Registering a building

Register each roof and the actual ground-level floor once, alongside its geometry:

```ts
G.snowCover.add({ name: 'Roof', kind: 'roof', x, z, hx, hz, yaw, y: roofTop });
G.snowCover.add({ name: 'Floor', kind: 'floor', x, z, hx: floorHX, hz: floorHZ, yaw, y: floorTop });
```

Positions and half-sizes are metres in world space. `yaw` follows the building's
Three.js rotation about Y. Roof footprints include projected overhangs, and may
use `ellipse: true` for curved natural cover. Roof `y` is the upper limit of its
protected column; floor `y` is the walkable surface. Floor masking has a one-metre
vertical band and does not affect unrelated terrain far below a raised platform.
No floor registration is needed for a ground-floor-less canopy.

Register before `WorldSnow` construction, which uploads the static layout. Adding
or removing building geometry during play would also require updating the
registry/GPU data and refreshing the affected snow material/terrain; runtime
construction and destructible roofs are not implemented by this change.

## Surface and transitions

The immutable terrain collider is the top of the permanent frozen snowpack.
Empty hands remove only the finite loose layer above it. It has its own rendered
surface, so empty excavations and roof-protected ground cannot become grey holes.
Steep exposed rock and water retain their own surfaces. Fully empty trail pixels
are discarded to avoid coplanar surfaces and flickering shadow patterns.

Loose snow tapers smoothly over 1.2 m *outside* a roof's exact boundary. Under the
roof its quantity is zero. Geometry is locally subdivided around cover boundaries
and shore transitions; its shading normals include the upper layer's gradient.
The packed base keeps the original, cheaper terrain triangles. Fragment clipping
enforces the exact footprint even where an ordinary terrain triangle crosses it.
Thin loose material blends into the packed base's colour, instead of abruptly
switching to a different material. Deeper uncompressed excavations receive a
wider rendering filter; compressed boot outlines retain the original filter.
Ground materials also use a stable five-sample shadow kernel, avoiding the
screen-pixel noise pattern visible on otherwise smooth white excavation floors.

`WorldSnowTerrain` samples the same extended/interpolated water levels as the
drawn water mesh. The loose layer diminishes continuously near the bank, using
the immutable terrain height. It never derives rock/biome selection from a snow
edge. Shallow frozen water margins blend into packed bank snow; open water keeps
its water material.

## Bounds and verification

CPU queries use 16 m spatial bins. The GPU receives the same bins, zone IDs and
footprints in nearest-filtered textures, and visits only local zones. This avoids
looping over every building for every terrain pixel or snowflake. Slope, water
and shore caches are bounded by the original 2 m world grid, not the 4 cm mutable
material grid. Ground colliders are unchanged and no rigid bodies are added.

`npm run test:snow-cover` checks rotated/negative-coordinate footprints, roof
overlaps, floor elevations, spatial bins and continuous shore coverage.
`test:snow-cover-browser` compares the actual GPU rules against CPU queries,
checks every registered roof, walks into all low shelters, and saves cabin,
wooden-floor, canopy, excavation, shore and movement images. Run it with the same
`NODE_PATH`/`CHROMIUM_PATH` settings as the other browser suites.
