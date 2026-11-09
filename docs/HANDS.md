# Coupled hands foundation (HANDS-002)

The HANDS-001 prototype moved the item and smoothed each wrist independently.
It also solved arms before placing the current frame's anatomical camera. Both
sources of grip drift are removed.

## Frame order and ownership

1. PlayerAvatar.render poses the torso/head/legs, allowing the eye position to be read.
2. Player.updateCamera places the current frame's anatomical camera.
3. Interaction advances its action phase, then PlayerAvatar.renderHands samples one item pose, fits its translation to the
   intersection of arm reach constraints, and solves both attached wrists exactly.
   The main loop defers arms until after action update; standalone updateCamera
  calls still pose arms for diagnostic/test callers. The same frame reposes the actual Survivor bones.
4. ViewModel copies that final item transform into the visible world mesh.

An attached palm has no independent easing or secondary action target. Generic
reach/work/eat poses cannot pull a supporting hand off a two-hand item. Arm length
constraints move the entire equipped item, rather than clamping the wrists away
from it. Impossible two-hand socket spacing explicitly releases the secondary
hand. Warm/brush poses explicitly disengage equipment and hide it.

Unattached hand transitions still use easing. Nothing applies that easing after
a grip constraint. There is intentionally no second animation clock for an item.

## Replaceable model and animation contract

Register a `Grip` in `handGrips[id]`:

- `sockets.right` and optional `sockets.left`: item-local palm positions in metres
  and quaternion orientations. Palm-frame -Y points from wrist toward fingers.
  The common adapter converts palm contact into a wrist target with a 6 cm hand
  offset. A future character can replace this calibration in the adapter.
- `createVisual()`: instantiate the equipped model, including a cloned GLB scene.
  Source geometry/material ownership stays with the asset system.
- `samplePose({state, phase, dt, position, rotation})`: sample an authored animation
  into the proposed WORLD item pose. `phase` comes from the authoritative
  Interaction swing/timed clock. Do not advance a separate action timer. Built-in
  swing/work offsets are disabled when this callback is supplied.
- `contactPhase`: optional gameplay hit marker in normalized swing time (default
  .55), consumed by Interaction. It must agree with the authored clip's contact.

The common reach fit follows sampling, so model, sockets and both hands receive
the same final transform. Replacing the registry profile also rebuilds the visual.
Legacy `right/left/rotation` profiles are adapted into rigid palm frames; they are
fallback art, not a prescribed animation for the new axe. This task does not
create an axe asset or authored axe clip.

`hands.palms` are actual world palm transforms (not wrist origins).
`hands.contacts`, `gripErrors`, and `diagnostics()` expose the attachment state and
constraint error for diagnostics. The rig's `ArmReference.wrist` is the wrist.
Clothing continues to use the existing character bones.

## Physical carrying

Rapier remains authoritative. Anchors are captured once in the actual object's
local geometry bounds (or authored sockets), including rotation; they do not
slide around a recomputed world AABB. Reachable wrists follow actual physics
sockets without lag. Unreachable hands explicitly lose contact and reach toward
the object. If neither hand regains contact for .6 active seconds, the physics
controller releases the object. Rendering never teleports a physical body.
Ordinary carry distance is now .35–.65 m with a lowered center, replacing the
previous 1–2.4 m targets that an anatomical arm could never hold. Dragging keeps
its separate distance/speed behavior but cannot claim an unreachable grasp.

## Limits

This is a constraint/attachment foundation, not polished authored art. Finger
chains are absent in the current asset. Generic free-hand gestures, skin shape,
contact forces, hand wall sweeps and full-body leaning remain future work.
The default swing is a placeholder; agreement between an authored tool edge and
world target belongs to its action/animation implementation. A marker synchronizes
gameplay and animation clocks but does not by itself prove tool-edge contact.
Instant inventory and snow effects retain their existing semantics.

## Checks

- `node tests/grip-solver.cjs`: 600 rigid two-hand fits and palm/wrist conversion,
  impossible socket spacing.
- `NODE_PATH=/opt/codex/cua_node/lib/node_modules node tests/grip-browser.cjs`:
  450 same-frame turn/pitch/stance/framerate samples, legacy and replaceable
  model/pose fixtures, actual skinned wrists, object visual transform, physical
  carried sockets and explicit loss of unreachable grasp.
- `node tests/hands.cjs`, existing hands modes, camera clearance and motion recording.
