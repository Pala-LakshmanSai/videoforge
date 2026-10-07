# Accepted avatar previews during generation — 2026-10-07

Checkpoint V2-09 / VF-10-09; narrow profile `v2_09_media_review_count`.

The Progress avatar launcher incorrectly required the whole avatar stage to be COMPLETE.
Accepted footage already existed and was available through the gallery tab. Match the image
launcher: show the existing avatar viewer whenever the stage exists and accepted clips exist.
Keep private artifact checks, counts, pagination, stable playback URLs and generation untouched.

Regression first failed for RUNNING and passed for COMPLETE. After the one-condition fix,
both cases pass including playback URL stability across polling; both affected UI suites pass
288 tests. Typecheck, touched-file ESLint and production bundle firewall pass. Independent
Luna review confirms the existing committed-object size/type/checksum barrier remains intact.

User explicitly requested production publication. No new provider calls, retries, GPU start,
Workflow registration, or project mutations are part of this repair. Production executable `14c1907b3840b8e80dcc6c37897dbf5d29a0ea65`, Worker
`bf78d0c1-4ed6-45cc-a97e-1f4b67c92ca9` at 100%. Both production/staging bundle
firewalls, context and secret checks pass. All 37 live public assets match their hashes;
private anonymous access remains 401, all 55 bindings preserved. Native289 unchanged.
Server bundle is byte-identical to the prior release (SHA256
`022947cf076ee7beb6e00631d344e947ed3fd8608acad7b8b6ecba6d0112260d`).

Real Chrome on the reported running project showed 32/92 accepted avatar clips and the
new stage launcher. It opened the existing gallery; Avatar clip 1 played to ended at
3.2 seconds, 512x512, readyState4, no media error. Next-clip navigation passed. Existing
images and scene-video launchers remain visible. The original user tab was preserved;
verification used a separate tab. Publication required no Workflow registration/restart,
provider submission or compute action. Private release receipts are under
`.videoforge/avatar-preview-20261007/release/` in the primary checkout. No remaining
fix-specific gate; pre-existing broad CI/long-form acceptance gates remain separate.
