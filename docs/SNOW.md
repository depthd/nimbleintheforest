# Snow experiment

Open `?snow=1` (also linked from the start screen). This is a separate, flat test
bed inside the existing world, using the actual player controller, gait, IK,
rendering and interaction. It is not yet a snow/weather rollout over the map.

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
  particles. The optional experiment does no snow work in the ordinary game.

Old trails remain for the page's lifetime, with coarse distant representation.
Reload persistence, world terrain coverage, temperature/moisture/crust, snowfall,
melting, slope transport and finished shovel/particle effects are subsequent work.
This height layer cannot represent tunnels or overhanging crust.

## Verification

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

### First measured prototype (cloud Chromium / software WebGL)

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
