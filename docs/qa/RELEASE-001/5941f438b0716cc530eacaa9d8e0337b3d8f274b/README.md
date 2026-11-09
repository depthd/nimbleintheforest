# Final self QA — RELEASE-001

Candidate: 5941f438b0716cc530eacaa9d8e0337b3d8f274b. Base: de20db3bb8883af6ade9afb5bb418b708afd9d71. Date: 2026-11-10 Samara.

PASS: production build, repo-check task, 15 logic suites (release-unit.log), GitHub Verify candidate run 42709087412, final e2e (verified-smoke.log: all checks passed).

Command: CHROMIUM_PATH=/usr/bin/chromium E2E_PIXEL_RATIO=.35 node tests/e2e.cjs test-results/RELEASE-001/verified-smoke

Node v24.22.1, Chromium 156, SwiftShader, 800x450 viewport. The raster resolution is scaled, not geometry or physics. Cold startup uses the normal graphics warmup. Pause and explicit stepping isolate gameplay time. Camera synchronization before debug aiming fixes the old fixture's stale eye transforms. The specific fresh pot is placed through G and its placement checked before heating. Fuel lasts through the scenario. Only favicon 404 is ignored; other failed resource URLs are recorded.

Actual gameplay source, package/lock, index.html and vite.config.ts match deployed preview 64090d8db6174bdfe02d0a82b10c437f1df00947 exactly. No game behavior changes were needed. Prior hand, startup A/B, recorder and camera/pose evidence is in the sibling 8611bed... archive, with its limitations preserved.

The checker viewed screenshots 03-window and 05-tree in this final run; previous sequential movement and extreme poses were inspected on identical gameplay code. Kimi is unavailable; this is self QA, not independent QA. Target GPU FPS and mobile are unverified. Prototype art remains unchanged.

Publication pending: automatic approval review rejected merge of PR #15 because the original user template prohibited merging. User was asked explicitly to override that restriction for this release. Do not bypass the rejection. No site publication has been performed during this QA.

This archive branch is evidence only; do not merge it into the game. PR #15 carries the release code and workflow changes.
