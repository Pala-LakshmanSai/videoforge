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
Workflow registration, or project mutations are part of this repair. Live publication/playback
are pending; append their exact evidence after verification.
