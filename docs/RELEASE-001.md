# RELEASE-001 — preview promotion

The user reviewed the working /test/ build and explicitly instructed this chat to finish testing, integration and publication. This supersedes the earlier task-template instruction to stop at a PR. Kimi is not available in this session; self QA is reported as such, never as independent QA.

Gameplay is the deployed preview 64090d8db6174bdfe02d0a82b10c437f1df00947. No new gameplay source changes are introduced during release preparation. Original evidence for 8611bed46c82482359f4f5f14276e7e05c8c13d2 is archived separately on task/RELEASE-001-qa-evidence, commit 2cbe9dc11a2067e5f957fa9db364eb166b88d055.

The e2e test now pauses wall-clock simulation and enables explicit test input after bootstrap, uses a specific newly created pot instead of toggling ambiguous inventory entries, checks placement before checking heating, and supplies enough dry fuel for the 25-minute scenario. It uses the demonstrated stove viewpoint. A placement failure is reported directly instead of misreported as broken boiling. Only the absent favicon is excluded from resource errors; other failed resource URLs are retained. E2E_PIXEL_RATIO can reduce raster cost without changing viewport, simulation or geometry. CHROMIUM_PATH selects an installed browser. Port conflicts fail rather than silently testing another server.

Release builds both root and /test/ from the approved SHA, each with build identity. A production release no longer removes the preview. Future test publications restore the production artifact referenced by live version.json, not a hardcoded historical run; both root index and version are checked before upload. Artifact expiry can still prevent a future test publish; such failure must stop without replacing production. No automatic deployment on push was added.

Integration includes component histories from PRs #9–#14. Do not independently squash/cherry-pick those changes again. QA evidence branch is an archive and must not be merged. Release checks and final deployment SHA/run are recorded in PR #15, avoiding a documentation commit that would change the tested SHA after release.

Rollback: use an already checked ancestor SHA with pages.yml, or redeploy a retained prior Pages artifact in an explicit rollback task; never rewrite Git history. Previous production artifact run is 42676348641; confirm retention before relying on it. Production deployment remains serialized with test deployment via production-pages concurrency.
