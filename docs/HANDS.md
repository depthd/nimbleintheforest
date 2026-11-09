# Hands foundation (HANDS-001)

The ordinary Survivor skinned body's UpperArm/ForeArm/Hand bones now perform the
hand poses, in first person, F6 inspection and shadows. No duplicate floating arm
asset is used. The procedural avatar remains the existing loading/error fallback.

`PlayerAvatar.hands` owns the two-bone arm targets. Reach is clamped to 29 + 27 cm;
the body is not stretched to a target. Walking/running uses the existing foot
cycle, and stance follows the anatomical camera. Airborne movement has its own balance pose. A single priority resolves warm,
swing, timed work, short feedback actions, carrying, equipment and locomotion.
The existing interaction clock is authoritative for swings and timed work.
Switching equipment cancels work/swing; pausing does not advance hand feedback.

Every contextual action is routed through `actionFor(label)` to a prototype pose:
reach, repeated work, brushing snow off clothing, food/drink, ignition, sawing, striking, scooping or pouring.
Pickup, carrying, release/throw and changing clothes also notify the controller.
Snow digging requires crouching and free hands, including the snow laboratory.
The effect timing for existing instantaneous actions remains immediate; these are
animation foundations, not a deterministic contact/force simulation. Existing axe
hits retain their 55% interaction-clock impact. Snow still changes per scoop using
the existing cooldown, not a physical palm collider.

## Extension contracts

- `handGrips[id]`: item-local right/optional left palm anchors in metres and item
  orientation. Register a journal profile without replacing the controller.
- `hands.palms[0/1]`: world-space left/right wrist attachment transforms.
- `hands.begin(kind, seconds)` / `cancel()`: short feedback actions. Timed actions
  and swings have priority. Future extensions should add semantic action IDs to
  Action rather than extending the current label-based fallback indefinitely.
- `hands.diagnostics()`: current state, normalized phase, wrist and item positions.
  The diagnostics task can consume this without modifying the controller.
- Clothing stays on the Survivor's existing skeleton. This change does not replace
  the model or modify clothing slots, meshes or inventory semantics.

Equipped meshes use their real dimensions and render in the main world pass,
with scene depth, light and shadows. A wall can occlude an item. No overlay is
painted over walls. Carried objects retain their existing Rapier spring movement;
arms reach for them but do not teleport or rescale them.

## Current limits

This first pass is deliberately rough. There is no finger-chain skeleton in the
asset beyond its thumbs, so closed finger grips need an asset update. Grip profiles
need individual artistic tuning. Distant targets/carry positions can be out of
arm reach; bounded arms do not imply a physical grasp. No new contact-force solver,
wall avoidance sweep, full-body reach/lean, or guaranteed tool-edge collision is
claimed. Inventory modal actions keep their existing immediate semantics.
The motion recorder already captures body bone transforms; the equipped item is
hidden during review because the old format does not record its identity/pose.
The diagnostics task should capture equipment separately rather than showing the
current live item in an old recording.

## Verification

- `npm run build`
- `node tests/hands.cjs`: arm lengths, bounded reach, degenerate targets and grips.
- `NODE_PATH=/opt/codex/cua_node/lib/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/hands-browser.cjs`
  checks all hand modes on the actual loaded Survivor; screenshots in
  `test-results/hands/`. These mode fixtures supplement real gameplay tests;
  they do not claim every contextual action's game result was tested.
- Existing locomotion, motion recording, Survivor and gameplay browser tests.
