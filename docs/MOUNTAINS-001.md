# MOUNTAINS-001 — isolated landform laboratory

First implementation of the mountain/valley design, scoped to a separate experiment. Base `e17417d059d4bf6e096ec6e059de769f71a71914`. No existing game source, assets, dependencies, default build entry, or workflow changes.

The experiment lives at `/experiments/mountains/` in Vite development. It has an independent build:

```sh
npx tsc -p experiments/mountains/tsconfig.json
npx vite build --config experiments/mountains/vite.config.mjs
node experiments/mountains/test.cjs
CHROMIUM_PATH=/usr/bin/chromium node experiments/mountains/browser.cjs
```

The separate output is `dist/mountains-lab/experiments/mountains/index.html`; serve `dist/mountains-lab` and open `/experiments/mountains/`. Do not commit dist. The ordinary `npm run build` intentionally does not include the laboratory yet.

## Implemented

A 1600 m square, 4 m grid contains lowland forest, a raised forest basin with an irregular floor, enclosed ridges, a frozen lake, and a monotonically descending outlet profile. Three continuous approaches express different geometry: a broad snow apron, a winding gully, and a partial contour shelf around a shoulder. A broad supporting landform under each approach prevents a raised ribbon on otherwise low ground. Corridors keep useful clearance rather than placing jumping stones. All are walkable without jumping.

Seed controls upper-floor elevation, rotation/mirroring, route widths/bend, lake shape, noise, vegetation, and rock detail. This is **one composition family**, not a finished repertoire of regional layouts. It demonstrates the relationship between upper/lower living spaces and several passage shapes; it does not yet prove full regional diversity.

Pure `landforms.ts` uses the existing RNG. Triangle sampling matches the displayed collision mesh. Separate renderer uses Three and Rapier already in the repository, instanced placeholder vegetation, batched rocks and the existing **RockSkin / blockTriangles** generators. Rock hulls stream within 70 m, release beyond 95 m, and refresh immediately on teleport. Static shadow maps refresh after relocation or lighting changes rather than every frame. There are view buttons, walking, fly inspection, seed regeneration, route overlays, and day/overcast/evening lighting.

The controller matches capsule size, climb/slide angles, autostep, gravity, walking speed and snow sprint speed of the game. This is an inspection controller; it does not instantiate Player/avatar, stamina, inventory, survival, deformable snow or footsteps. No claim of game integration is made.

## Tests and limits

`test.cjs` checks eight seeds: deterministic full height arrays; finite data; useful elevated gentle dry area and nonflat floor; downhill outlet profile; all three approaches traversed by a Rapier capsule at walking speed. This is a physical walk over final terrain triangles, not merely comparison of route coordinates. It does not include scene decoration; browser validation additionally walks the contour shelf through the full scene.

`browser.cjs` uses actual keyboard events, the page's own fixed movement and streamed collisions; captures eight views, three lighting modes, sequential walking frames, eight seed overviews and a small-screen layout. Capture manifest records source SHA, viewport, graphics backend, scene counts and movement results. SwiftShader measurements are not user hardware FPS. Final results belong to the PR at the exact tested SHA.

The lake/outlet is an authored procedural drainage primitive, **not** a replacement for the game's Priority Flood/hydrology. The outlet surface is visual; only the lake has a dedicated ice collider. Terrain has a prototype resolution of 4 m. Rocks and trees are inspection assets; their style and density are not final art. Long-range terrain/rock LOD, streaming forest colliders, ecological tree-line rules and full navigation/reachability classification remain later work. No caves, ropes, bridges or rewards are implemented at this stage.

Views need artistic acceptance. Numerical width/floor checks do not establish beauty. The initial unadorned terrain made shelves look engineered; broad supporting slopes and reuse of the game's rock skin were added after visual inspection. Further tuning should compare both close ground-level views and overview, not just increase noise or rock count.

## Coordination request before integration

The task card deliberately leaves `owner: null` and `allowed_paths: []`. AGENTS.md assigns those fields to the coordinator; this draft does not self-assign them. Requested scope is entirely new files: `.coord/tasks/MOUNTAINS-001.json`, `experiments/mountains/`, `docs/MOUNTAINS-001.md`, `docs/qa/MOUNTAINS-001/`. There is no file overlap with open journal PR #16. Coordinator must assign that scope before the task guard can pass and before merging.

To publish a later test preview, the coordinator must add this HTML entry to the existing Vite build inputs while retaining the main game's entry, then use the existing test-only workflow on the reviewed exact SHA. The concrete extra entry is `experiments/mountains/index.html`; its URL within the test build will be `/nimbleintheforest/test/experiments/mountains/`. This integration touches `vite.config.ts`, currently reserved by UI-001, so this PR intentionally does not change it. Alternatively build with the experiment config and attach the independent artifact in CI. Do not dispatch the ordinary test workflow expecting it to include this entry automatically. No website has been published by this task.

Design and references: https://chatgpt.com/space/page_fe3b8cb4e8148191aa2edbedf75ad3cb . User's additional requirement: varying spaces below/beside/above mountains, straight and winding snow slopes and contour shelves; no regular sequence of isolated stepping stones. Main game remains a mixture of forests, lowlands and mountain districts.
