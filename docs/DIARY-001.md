# DIARY-001 — handheld journal

Base: e17417d059d4bf6e096ec6e059de769f71a71914 (RELEASE-001 already integrated).
User scope: two supplied pages and live indicators, physically held by Survivor with a raise/lower animation. Publish only `/test/`; no production dispatch or integration merge.

J (physical key, О on Russian layout) toggles the journal; Escape lowers it. Reading occupies both hands and stops item actions, while walking, looking, physiology and the world continue. Sprinting smoothly lowers the journal and releasing sprint returns it to reading position. Hands support the lower outside cover corners; restrained sway follows locomotion feet, with no separate walk clock. Inventory/map/help, death, sleep, carrying and motion replay close it. Existing equipment stays in inventory/equipped and returns after lowering. Busy interaction/carrying blocks opening. It is a personal presentation item, not a spawned physics object or an inventory item.

Geometry and canvas artwork adapted from `Dnevnik_pervy_variant(1).zip`; Neucha font bundled locally. The existing Hands rigid two-hand solver drives both palms and the journal in the same scene and frame; no overlay hands and no separate item clock. New modules isolated in `src/game/journal/`. Shared changes are selection hooks in Hands/ViewModel and one update before global input. Reuse model/textures across opens; redraw only when rounded state changes.

Left: hunger = 1 − kcal/3000, thirst = 1 − water/3, fatigue, felt temperature. Rings clamp to 0..100%; temperature marker clamps to −40..20°C but text reports actual temperature. Right: frost=max(hand,foot frostbite), wetness, condition, stamina; frostbite also fills the condition ticks. Cuts/bruises/bleeding have no independent Body model and are explicitly marked «нет данных». No invented injury simulation, editing, additional pages or save system.

Validation: `npm run build`; grip-solver, hands, statics, resting tests; `node tests/journal-browser.cjs <task/SHA artifact dir>`. Browser test captures raising, holding, changing physiology, pitch extremes and portrait; checks both grips and action blocking/restoration. Screenshots require visual inspection, not just numerical contact checks. Kimi unavailable: self QA must not be labelled independent QA.

Delivery: task PR into configured integration branch; dispatch existing test-pages workflow at exact checked task SHA. Workflow restores current production artifact and compares root index/version before publishing test, serializes with other releases. Do not merge QA evidence into gameplay or dispatch pages.yml for this task.

Software-rendered browser capture initially exceeded Playwright's default 30s screenshot timeout. Journal browser test uses half raster pixel ratio (viewport unchanged), freezes only physiology time, and allows 180s per operation; this is a test harness cost adjustment, not a gameplay graphics change.
