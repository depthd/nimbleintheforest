# Recording an animation problem

The demo has a small **Запись движения** panel. Recording is opt-in; it does no
pose/probe/snow logging until started. It is diagnostic data, not screen video.

1. Press **F7** while playing, or click **Запись** with the cursor released.
2. Reproduce the problem. Press **F8** as soon as it happens. Up to the last
   20 seconds / 1800 rendered frames are retained, so recording may be started
   before the exact trigger is known.
3. Use the slider or **← / →** to inspect frames. Slow playback and side/front/top
   views help inspect feet. **Как было** uses the captured camera.
4. Select the problematic frame, write a note and click **Отметить кадр**.
5. **Скачать запись** downloads a `.json.gz` file (plain `.json` on browsers without
   gzip compression). Attach that file in chat. Download also marks the current
   frame and saves its note.

**Открыть файл** imports that same recording. It opens on the selected frame,
including notes. Use the same seed, map size and snow-demo/ordinary-game mode.
**Вернуться в игру** restores the live pose/snow rendering and releases the pause.
F8 can reopen the retained recording before it is replaced or the page is closed.
The file is local; this tool has no upload service or automatic network sending.

## What is captured

- The final per-render avatar hierarchy transforms/visibility, after interpolation
  and the IK reach guard, together with the actual selected camera and render alpha.
- Physics tick inputs (keys, mouse deltas, view yaw/pitch), player displacement,
  KCC grounded/movement results, and all locomotion state before/after each tick,
  including private planner counters and complete foot states.
- Foot probe coordinates, surface positions/normals and support identity. Unusually
  large probe/tick batches carry an explicit truncation marker.
- Snow's initial sparse material state and coalesced reversible cell changes,
  including preset resets. Rolling eviction advances the initial snow state so
  the first retained frame still replays correctly.
  Optional cell contact exposures and frame weather exposure preserve gradual
  track burial when seeking forward/backward. Older four-value cells and six-value
  journals still load; new recordings add a fifth cell value and two journal values.
- Scene settings, viewport, build asset identifier, selected frame and notes.

The viewer applies saved transforms; it does not run the gait solver again and
hide a broken interpolated frame behind a newly computed pose. Snow reconstruction
uses a separate field, leaving live player physics, planner state and material
untouched. The file supplies data for investigating the solver separately.

This is deliberately not a deterministic replay of every system in the game.
Animals, moving props, sound, weather history and other characters are not recorded.
The surrounding scene is the currently loaded world; the character/camera and snow
are replayed. A changed character rig is rejected rather than silently misplayed.
Files are versioned, bounded, validated and interpreted only as data. Gzip and raw
input are limited to 64 MiB, including decompressed size.

## Validation

`npm run test:motion-record` checks bounded history, snow baselines/resets, detached
snapshots, input/alpha/notes preservation, malformed data rejection, exact reversible
snow journals and gzip/JSON round trips.

`npm run test:motion-recorder-browser` uses Playwright/Chromium on port 5206 to test
F7/F8, fractional-frame pose preservation, camera views, stepping without changing
live physics, marked download/import and returning to the original game state.
Use `CHROMIUM_PATH` and `NODE_PATH` as for the other browser suites.
