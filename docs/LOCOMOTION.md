# Player body and locomotion

The character controller still owns movement and collision. The avatar follows the
actual displacement, never the pressed keys: walking into a wall cannot produce a
treadmill animation or footsteps. No runtime dependency or external model was added.

## Ownership and update order

- `player.ts`: input, immediate view yaw/pitch, Rapier KCC, interpolation, camera.
- `locomotion.ts`: fixed-step, renderer-independent facing and world-space soles.
- `avatar.ts`: Rapier surface probes, procedural body, two-bone IK and inspection view.

Each physics tick runs movement, `world.step`, then `player.avatar.update`. Both the
normal loop and `__game.steps` use that order. Each render frame interpolates the
root and feet before solving visible knees. A planted foot's coordinates do not move
with the root, including between physics ticks. Teleport resets pose and velocity.
Waiting and game-time acceleration do not accelerate the gait.

The view yaw is independent of pelvis yaw. At rest, small view changes affect the
head and chest. A larger twist starts a turn with hysteresis. The outside foot opens
the stance towards a new heading, then the trailing foot closes it. The pelvis
follows the actual headings of the feet with a speed limit; it cannot spin first
and leave the legs catching up underneath it.
During locomotion the pelvis follows the view with a limited bias towards travel.
Backward movement preserves a forward-facing body. Head and chest pitch share the
view tilt. Head yaw/pitch have anatomical limits; rapid mouse turns keep the camera
responsive while the body catches up.

## Feet

Each foot is in support, swing or air. A support sole is a world anchor. The planner
chooses a step from how far the actual pelvis has travelled from its support and
how far the body has turned. Steps alternate. Early swing can adjust to
acceleration/braking; late swing commits to its
landing. Start/stop transitions settle to a stable stance. A first short step keeps
the other leg reachable during acceleration.

Running has a separate short-support/long-recovery cycle, including overlapping
swings (a flight phase), instead of speeding up the walking transfers. Cadence is
about 190–210 contacts/minute at the normal sprint speed; extra speed comes from
longer strides. The recovering heel rises behind the body, the arms bend and the
torso leans forward. Timer overshoot is retained between physics steps so cadence
does not depend on rounding each interval up to a whole tick.

At toe-off the boot pivots around its toe support while the heel and ankle rise.
`footPose` supplies that same world boot pose to both the IK solver and renderer.
This avoids pulling the pelvis down just to keep a trailing boot flat on the ground.
The hip joints, pelvis mesh and torso share one centre line; the camera has a small
anatomical forward eye offset. First-person visibility is not achieved by moving
the whole torso behind the legs.

Probes use real collision surfaces, not `terrain.heightAt`: wood floors, stairs,
rocks and ice all participate. They exclude sensors, the player, and the carried
object. Swing paths sample clearance over intermediate heights. Contacts recheck
their destination so a removed obstacle cannot be a landing support. Slope normals
orient boots. The pelvis lowers on uneven ground to keep the two-bone legs within
reach. Knees have a forward pole to avoid flipping. This animation does not add
colliders for the visible limbs or change KCC dimensions.

`motion.contacts` contains the events from the current physics tick only:
`side`, world `position`, `normal`, `speed`, `landing`, and monotonic `serial`.
One contact drives one positioned footstep sound. Initial placement and teleport
are silent; jumping, swimming and sleep cannot emit walking contacts.

For future deformable snow, consume the continuous `feet[].previous` and
`feet[].position` trajectory, `footPose` (including toe-off rotation), and contacts. Do not create marks from a
distance timer. The current probe interface is the place to add snow support depth
and strength; it currently queries solid surfaces only. No snow deformation exists
in this change.

## Rendering and inspection

The procedural model uses shared low-resolution geometries and fabric textures.
Its appearance is a technical winter outfit, not a finished character asset or a
visual representation of each equipped clothing item. Inventory tools retain their
existing first-person viewmodel and interaction animations.

Head and upper torso discard fragments in the first-person main pass so looking
down reveals the legs instead of the inside of the body. Their shadow depth
materials remain intact, so the whole character casts an animated shadow. F6 cycles
first person, side inspection and front inspection; inspection doesn't change aim,
movement, audio listener or interaction rays. The inspection camera can pass through
scenery and is intended for checking animation, not normal gameplay.

This is a lightweight procedural gait, not motion capture. Full moving-platform
attachment, ragdolls, climbing animations, tool-specific hand IK and deformable snow
are separate systems. Crouch is a visual pose using the existing movement controller;
this change does not introduce a shorter collision capsule.

## Validation

`npm run test:locomotion` checks idle anchors, head/body separation, turn speed,
directional movement, stop, airborne contacts, crouch, slopes, teleport and IK.
Additional checks enforce an upright neutral pose, sensible running cadence and
stride length, and the running flight phase.

`npm run test:movement` starts Vite on 5201 and tests the real physics/controller
in Chromium. It checks anchor drift and reach, actual footstep calls, jumping,
blocked movement, slope normals, stair clearance and F6 keyboard input. It records
traces and sequential first-person/side, running, turning and shadow frames in
ignored `test-results/movement/`.
Playwright must be available, as for the pre-existing `tests/e2e.cjs`. Set
`CHROMIUM_PATH` to use a system browser. The existing missing `/favicon.ico` is
excluded explicitly from the resource check; application resource failures and
JavaScript errors still fail the test.

For reproducible pose inspection in a running test page:

```js
__game.setManualStepping(true); // keep drawing; stop automatic physics/game time
__game.G.input.keys.add('KeyW');
__game.steps(6);
__game.animation(); // world feet, phases, knees, facing, reach error
__game.G.input.keys.clear();
__game.setManualStepping(false);
```
