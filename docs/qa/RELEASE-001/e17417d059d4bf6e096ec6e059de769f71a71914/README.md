# Published release — RELEASE-001

SHA: e17417d059d4bf6e096ec6e059de769f71a71914. PR #15 merged after the user explicitly repeated publication authorization following the automatic approval rejection. Date: 2026-11-10 Samara.

Production workflow 42709988366: SUCCESS. https://github.com/depthd/nimbleintheforest/actions/runs/42709988366

Merge tree exactly matches the QA-tested head 5941f438b0716cc530eacaa9d8e0337b3d8f274b (git diff --exit-code). Repo-check final SHA passed. GitHub built the exact merge SHA, ran statics/resting, built matching root and test, and deployed successfully. Artifact retention confirmed 90 days. Full final e2e, build and 15 logic suites are archived in the sibling 5941f... directory.

Public root version.json and test/version.json both return this SHA, linked to production run 42709988366. Post-deploy browser checks passed on both public URLs: JS/resource errors absent, exact embedded SHA, movement 0.357 m horizontally, C crouches, Ctrl does not, axe equips, hands and recorder exist. Both screenshots were inspected. Cold programmatic contexts were 480x270 with RAF suspended and warmup=0; this isolates deployed-resource/functionality checks. Normal startup/warmup was covered in the prior tests; no target hardware FPS claim is made.

Cloud Chromium initially rejected its environment proxy CA. TLS verification was NOT disabled. The rerun used page.route to fulfill the actual public-origin resources fetched by curl with inherited proxy and trusted CA, preserving the public origin in Chromium. This verifies publicly served bundles and gameplay in a browser via a TLS-verified transport adapter, not a direct Chromium certificate-store test. The adapter is retained alongside results. Root/test JSON retain numerical results and errors arrays.

Gameplay source matches preview 64090d8db6174bdfe02d0a82b10c437f1df00947; changes during release preparation were tests/workflows/docs only. Mobile layout, target GPU FPS and independent Kimi QA were not performed; prototype art is unchanged.

Future test publication now restores production from live version.json and guards root index/version; syntax reviewed, but an additional test-only deployment was not run after production. Current root and /test/ were both deployed by the successful production workflow. Do not blindly re-merge component PRs #9–#14; their histories are included. Evidence branch must not be merged as gameplay work.
