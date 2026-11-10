# MOUNTAINS-002: connected uplands

The rejected terrain-frame-1 produced variants of a ridge/valley profile. This revision constructs a traversable mountain district: lower forest (22 m), intermediate basin (57 m), lake valley (122 m), eastern forest valley (177 m), high cirque (222 m), northern crest (340 m). Eight geographic connections give three independent loops. A summit visible from below is a destination; the upper valleys have their own floor areas and onward routes.

## Geometry

- Irregular polygonal bedrock masses have separate apron, face and shoulder profiles, sloping crowns and asymmetric sides. Basin patches own areas and floor gradients, not just centre lines.
- Curved pass axes constrain a broad regional bedrock envelope and valley incision. The foundation prevents unsupported paths where an axis leaves a massif; it extends into the mountain rather than forming a narrow elevated road.
- Overlapping valley fields are blended together instead of taking a discontinuous lowest surface. River banks join the valley floor over a broad shallow profile.
- Final terrain remains a 4 m heightfield, triangulated identically for rendering, sampling and Rapier. Overhangs, stacked paths, bridges and through caves are not implemented.
- Seed 42 is the designed control composition. Other seeds perturb mass contours, heights, wall widths, noise and orientation. This is one parametric family, not yet a generator of different graph topologies.

## Preserved assets

`addRockSkin()` is restored byte-for-byte from 185989f95ec260455608bb1410eae2a54220b487. The 1.6 scaling was removed. `src/gen/rock-skin.ts` and all other shared sources are unchanged. Existing lab trees are retained; their placement recognises sheltered upper forest areas. No publication, external PR, or merge is performed.

## Internal visual review

The first polygon prototype was rejected internally: tall cylinders with flat caps and disconnected transitions. Subsequent revisions slope and taper crowns, add continuous bedrock beneath passes, give the northern crest a climbable approach, and connect arrival/departure points inside each basin. The goal is a complete exploratory district, not the highest number of tests.

Remaining artistic limits: the existing lab trees are simplified; long rock walls still expose repeated bedding, and the light/material treatment is not equivalent to The Long Dark. This revision should be evaluated as improved spatial structure, not a claim of matching the reference's finished art. Wider terrain variety requires additional reviewed composition families.

## Validation

`node experiments/mountains/test.cjs`: deterministic heights, geographic graph connectivity/cycles, open destination floors, raster connectivity between ports, drainage, lateral clearance, and Rapier walks over final triangles in both directions. Use `SEEDS` and optional `ROUTES` for focused runs.

`node experiments/mountains/browser.cjs [output]`: actual keyboard input; all eight paths and returns on seed 42 with terrain, rock, tree and boulder collisions; ground-level and continuous walk frames; clay/terrain/rock/full views; lighting comparison; held-out seeds 7 and 2026; mobile menu and browser errors. Software rendering is not a measurement of the user's device performance.

QA is stored under `docs/qa/MOUNTAINS-002/<source SHA>/`. The manifest records exact rendering source hashes and source SHA. Independent Kimi review and user artistic acceptance are not asserted by automated checks.
