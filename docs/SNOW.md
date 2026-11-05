# Mutable snow

Snow is enabled in ordinary play, on the generated forest terrain. `WorldSnow`
uses the same mass/compaction field and continuous boot sweeps as the laboratory.
The immutable 2 m terrain triangles are sampled exactly; slope retention is cached
in one byte per terrain vertex. Water and sheltered floors are excluded. Solid
wood, rocks and ice still use their real collider surfaces and existing rules.

With empty hands, hold LMB to move snow aside and use RMB to return the finite
quantity collected. These are ordinary contextual actions: equipped tools retain
their controls, and eating snow, filling pots and making fires remain available.
The snow ray hides buried items until a visible route to them is excavated.

Only a 22.4 m square around the player has detailed snow geometry: 49 recycled
meshes and 69,009 grid vertices, with the existing nine fine / sixteen medium /
twenty-four coarse tiles. No map-sized 40 cm mesh is built. Outside that patch,
the existing terrain shader supplies the distant snow. The outer ring blends into
it; inside the patch the terrain shader draws the bare substrate beneath the
upper layer. The same biome shader shades the detailed layer, retaining needles,
burned ground and shore colour. Changed cells remain sparse when travelling.

## Laboratory

Open `?snow=1` (also linked from the start screen). This is a separate test
bed with flat ground and three small hills, using the actual player controller, gait, IK,
rendering and interaction. The laboratory remains separate from ordinary survival
settings and is no longer required to play with deformable snow.

WASD walks, Shift runs, Space jumps, F6 cycles first person / side / front. Escape
releases the pointer for the powder/firm, reset and no-snow comparison buttons.
LMB excavates locally; RMB deposits the finite quantity excavated. This is a test
brush, not a finished shovel animation. The knife left of the stake rests on the
solid base; E can collect it only when the line of sight is clear of snow.

## Material and contact

`world/snow-field.ts` owns a common 28 cm starting thickness plus sparse local
changes. Each changed cell stores fresh-equivalent material quantity and density
(compaction); height is quantity divided by density. Compression conserves mass;
a small, measured amount is transferred to the lip. Excavation removes quantity,
deposition returns it. These are intentionally distinct operations.

The boot is a rounded approximation of the visible boot's 14.5 × 31 cm outline,
with its full orientation and height. Each fixed physics tick sweeps the previous
and current `footPose`, including toe pivot, roll and yaw. Subdivision follows
travel and rotation at half-cell spacing. A boot in the air does not cut snow;
vertical extraction does not invent a sideways mark. Teleport clears sweep
history. The final render-time IK reach guard remains in place.

The experiment's immutable collider remains Rapier's obstacle/base support. A
separate loaded-support query supplies character/foot height and movement
resistance. A 6 cm support tolerance treats small settling changes as continuous
contact, avoiding false falls and both-foot resets. Solid plank/rock probes take
precedence. Snow depth raises swing clearance. Powder and firm snow use density
ratios of 2.6 and 1.25 respectively; these are tuning parameters, not climate rules.

Interaction compares the snow ray hit with the solid/entity hit, so a buried
collider cannot be picked through the visible snow surface. Ordinary ground
actions are suppressed on the experimental bed; entity pickup still uses the
existing interaction code.

## Bounded rendering and storage

- 4 cm material grid, 3.2 m storage tiles. Pristine space needs no detailed arrays.
- At most 32 tiles keep dense mutable arrays. Older tiles store only changed
  indices, material quantities and compaction; reading them does not unpack them.
- One fixed rendering pool: nine fine, sixteen medium and twenty-four coarse
  tiles, plus a cheap distant cover. 69,009 pooled grid vertices; 50 meshes total.
  Traversing farther reuses their geometries and materials.
- Deformation updates only its dirty rectangle plus the normal border. Streaming
  uses direct grid reads and a reusable height buffer, avoiding per-vertex
  interpolated material queries and object allocation. Pristine tiles have a fast
  flat-fill path.
- No snow colliders or rigid bodies are created per footstep. No physical snow
  particles. Ordinary play uses the bounded near pool rather than a whole-map mesh.

Old trails remain for the page's lifetime and return when the near pool revisits
them. The distant terrain uses the simplified undisturbed cover.
Reload persistence, temperature/moisture/crust, snowfall,
melting, slope transport and finished shovel/particle effects are subsequent work.
This height layer cannot represent tunnels or overhanging crust.

## Hills and slope coverage

The test bed now has a 0.65 m gentle hill, a 1.05 m medium hill and a 1.5 m hill
with steep sides. Buttons under the usual controls move to their approaches.
Density and snow-on/off buttons keep that position for comparison; Reset returns
to the original start.

`snow-test-terrain.ts` bakes one immutable 20 cm relief grid. The visible base,
Rapier trimesh and height queries use the same triangles. Snow retention is baked
from that base alone, independently of footprints and excavation. The common
28 cm thickness is multiplied by a smooth retention curve: full through 15°, 55%
at 35°, 6% at 55°, zero at 65°. These are initial tuning values. Crests and flatter
shoulders retain more snow than steep sides. There is no automatic downslope flow.

Mutable quantities remain sparse deltas from this immutable initial quantity;
compression/digging/deposition still conserve the same material. Near geometry and
the static distant cover both follow the relief. Thin coverage blends into the
substrate colour; less than 2.5 cm shows the solid base in the rendering. The small
remaining physical layer still participates in support/interaction. The existing
50-mesh snow pool stays fixed; the solid relief and distant grid are built once.

`npm run test:snow-slopes` checks real uphill/downhill walking, slope-aligned feet,
steep-face sliding, matching collision heights, hill buttons and position-preserving
comparisons. It also spot-checks quarter turns, reversals and zigzag/strafe while
sprinting with snow enabled/disabled, measuring the final rendered feet and IK.
The reported long foot lift was not reproduced in these six cases; this is a
targeted check, not a claim that every possible animation transition is covered.

## Verification

`npm run test:world-snow` opens ordinary play without `?snow=1`: forest footprints,
actual collider/terrain agreement, digging to reveal and collect a real item,
finite redeposition, survival/tool actions, indoor floors, water, bounded streaming
and recordings of ordinary-game snow. It saves normal forest gameplay images.

`npm run test:snow` checks conservation, compaction saturation including loaded
support feedback, complete drag paths, rotation/extraction/flight, timestep
stability, teleport, digging/filling, negative coordinates, archival restoration,
fixed geometry budgets, dirty updates and shared tile edges. It also exercises
1000 boot contacts distributed over 650 m and streams the renderer over 1 km.

`npm run test:snow-browser` starts Vite on 5202. It uses Chromium/Playwright like
the existing movement suite; `CHROMIUM_PATH` can select a system browser. It checks
the real controller's snow contacts, alternating gait without false falls,
standing, deep/firm movement, jumping, solid supports, buried-object interaction,
mouse input, long walking and F6. It saves sequential motion images and traces.

The browser suite records an ABBA snow-off/on comparison of frame times, simulation
CPU time, dirty mesh update time, draw calls and triangles. The cloud test browser
uses software WebGL: its frame timings are not a promised FPS on a player's GPU.
Run the same comparison on target hardware before choosing world-scale defaults.

To run only the comparison in an otherwise idle browser:

```bash
SNOW_BENCH_ONLY=1 NODE_PATH=/opt/codex/cua_node/lib/node_modules CHROMIUM_PATH=/usr/bin/chromium npm run test:snow-browser
```

Use one browser at a time for performance comparisons. The harness closes its
browser on interruption as well as normal completion.

### First measured flat prototype, 805c515 (cloud Chromium / software WebGL)

The 14 material/rendering checks and 12 browser snow checks passed, as did the
existing 19 locomotion and 29 browser movement checks. On the real
controller, 129 m of repeated walking kept 50 snow meshes, 69,009 pooled grid
vertices and the exact same collider count. Distributed 1000-contact / 650 m
storage used 1,507,952 bytes with 32 dense tiles; cold trails restored exactly.

The isolated ABBA comparison at 960 × 640 recorded median full-world frame times
of 2033–2067 ms without snow and 2300 ms with snow (about 12% higher in software
WebGL). This extremely slow software rasterizer is not representative of hardware
WebGL FPS. Rendered triangle counts were about 1.556 million without snow and
1.635 million with snow in the same inspection view.

For simulation plus dirty snow mesh updates, medians were 0.2–0.4 ms without snow
and 0.3–0.4 ms with snow. The snow-on p95 was 2.0–4.4 ms. Rare pauses up to 39.5 ms
also occurred (baseline up to 38.7 ms); these results do not establish a completely
hitch-free frame time. Use the saved distributions and target hardware before
expanding the experiment to the whole world.
