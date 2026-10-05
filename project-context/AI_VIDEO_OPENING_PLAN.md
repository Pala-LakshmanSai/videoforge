# AI video opening — V2-09 / VF-10-09

## Configurable opening follow-up — 5 October 2026

Current user decision supersedes mandatory opening for fresh configurable requests. Create exposes a Full video opening toggle, On by default, and an opening duration of 3 minutes by default. Duration is 0.1–60 minutes in 0.1-minute increments, normalized once to immutable integer seconds. Off restores the exact original scheduler-v6/v7 and WHOLE_SCENE_V2 whole-timeline percentage/spread/fill behavior. On pins scheduler-v10/v11, ai_video_opening_seconds and OPENING_CONFIG_V4. Existing v8/v9 and OPENING_180_V3 remain fixed at 180 seconds. A crossing scene finishes wholly in footage; only its suffix consumes the remaining-duration allowance. No opening failure may become a still or avatar.

Execution plan from clean eea53304 / currently published b9f9805c:

1. Trace each writer/reader and freeze the new request fields, default, supported durations and backward-compatibility rules before code edits. Keep old request schemas and pending script intake behavior intact.
2. Add the UI controls and carry them through preflight, audio creation, script intake and delayed continuation, request hashes, revision/timeline config hashes, selection, costs and Progress.
3. Reuse the original optional whole-scene algorithm. Parameterize only the required opening threshold in a new immutable scheduler/policy. Prove Off parity, On/default/custom/short/crossing behavior, missing/forged footage rejection and historical replay.
4. Expand native storage with additive migration268 and a six-argument pin overload; preserve old functions, RLS, roles, receipts, accepted media and qualified v3 renderer wire. Rehearse native migration/rollback and compare historical preimages before production mutation.
5. Run affected package suites, schema parity, typechecks, lint, both bundles, quarantine, canonical aggregate, context and secret checks; explain inherited broad-suite failures without treating them as feature proof.
6. Exercise the stable provider-free real-Chrome flow. Review the final diff; push a coherent tested commit. Apply only the guarded additive migration and exact reviewed Worker bundle, retaining all bindings/secrets/Workflows/runtime pins and rollback binaries.
7. Verify production traffic/assets and real Chrome default/custom/Off controls, preflight, retained project recovery/Progress/Review/Library. Run bounded fresh production acceptance and verify private artifact lineage, native decode/playback and all paid CPU rentals clean. Short provider proof and deterministic180-second boundary proof remain separate.
8. Record final source/version/tests/remaining gates, provider liability and compute cleanup in CURRENT_STATE and existing GPT Space Pages with conflict guards.

The user's direct implementation/deployment/test authorization persists and explicitly requests no further permission questions. New feature qualification may use at most two new projects, USD12 of newly started/reserved provider/CPU liability and at most eight 900-second temporary CPU rentals, no retained resources or new model downloads. Resolve current rates and cleanup before dispatch; stop on uncertain request identity, price/cap risk, unsupported retry or unconfirmed cleanup. Earlier canceled tests retain their separate USD4.934096 conservative allowance and unknown charges; unused earlier authority stays retired. New acceptance never replays those submissions.

## Historical fixed-opening release

User decision, 4 October 2026: fresh videos use full-screen generated scene footage for the first 180 seconds, independently of the selected coverage percentage. The percentage applies only to the remaining film. Videos shorter than 180 seconds use footage throughout. Whole scenes crossing 3:00 finish as footage; their post-opening frames count toward the remaining-duration budget before optional scenes are selected. Hard cuts, narration, media quality and private ownership remain.

## Implementation and release sequence

1. Start from the latest verified production source in an isolated checkout. Preserve all unrelated work and existing revision/provider identities.
2. Pin a new immutable opening policy on fresh revisions. Preserve legacy percentage and prefix policies through recovery and exports.
3. Version the scheduler: create full-image source tasks for every opening scene, preserving words, timing, scene bounds and the existing later compositions. Source images become footage; no opening still or avatar composition reaches the final video.
4. Require every opening scene's successful whole clip at both selection and render barriers. Retain existing optional-scene fallback after the opening. Uncertain paid submissions retain their original identities.
5. Select optional complete scenes with the existing spreading/fill algorithm, using only duration after 180 seconds. Show the separate opening and remaining coverage in Create, preflight, Progress and costs.
6. Add regression checks for Off/custom/preset percentages, short/exact/long durations, crossing scenes, forged/missing opening clips, failed opening clips, old-policy compatibility, private scope, immutable replay and recovery.
7. Run affected packages, web/Worker types, changed-file lint, both bundles, context and secret checks. Rehearse additive SQL under native runtime roles with rollback and verify historical preimages and permissions.
8. Push the reviewed source; apply the guarded additive migration and publish the exact production bundle while retaining settings, secrets, Workflow registrations and qualified runtime pins. Keep the prior binary available for rollback.
9. Verify production assets/status and real Chrome Create/Progress/Review/Library. Complete a bounded provider-backed canary, verify its private artifact and playback, and confirm any test rentals are clean. Test the 180-second boundary with deterministic full-duration plans; do not describe a short canary as long-form editorial proof.
10. Record exact source, Worker, checks, artifact and resource evidence in CURRENT_STATE and existing GPT Space Pages. Preserve broader unresolved gates.

The user explicitly authorizes implementation, required testing, remote publication and production deployment without another confirmation. Paid acceptance is bounded internally and stops on uncertain identity, unresolved cleanup or changed provider price; accepted work is never blindly replayed.

## Local regression evidence

Scheduler suite: 51 passing tests, including 40/180/181 second and 10 minute opening schedules,
exact precursor word/frame boundaries, preserved later compositions, replay hashes, short
zero-avatar work plans and rejection of opening avatars. Hosted screen suite: 240 passing tests,
including 60 second Off footage cost, 600 second 7% remaining coverage, unchanged slider/custom
submission and visible Progress scene-video work at zero optional percentage. Owned tests lint
clean; contracts and pipeline builds pass. These are provider-free local checks, not production
playback, paid image/video quality, invoice or rental-cleanup proof. Root CURRENT_STATE records
subsequent deployment and external acceptance.

## Provider acceptance recovery

The first 180-second Off test accepted 37 clips, then its last exact saved Seedance UUID returned HTTP 504 with a single `videoInference` / `failedProviderTimeout` / `status:error` envelope. Generic gateway errors remain reconcilable; only that exact task-scoped failure settles as failed. Cost omission stays unknown, and any explicit charge is persisted before settlement. Required opening failure blocks rendering and releases the failed request's workload lease. Immutable selections and accepted clips remain intact; no supported same-plan paid replay is invented. A second fresh 180-second acceptance is bounded with the first under USD 10, at most two projects and eight 900-second rentals, with full failed-request cost allowance retained. Stop on uncertain identity, price/cap risk, unconfirmed cleanup or another required failure.

Runware [task polling](https://runware.ai/docs/models-api/task-polling) defines task errors as failed async generations; its [error guide](https://runware.ai/docs/models-api/errors) notes provider-specific code variation. Classification of the observed alias is an inference from that documented envelope and the exact native receipt, not a generic HTTP 504 rule.

The second test saved 20 of 39 prompts before its third batch response was lost. Preserve the original textInference UUID, compiled accepted prefix, request/model/plan hashes and full USD 1 reservation. Exact getTaskDetails/getResponse reads retrieve status without new inference; response:null alone is not a failure or a basis to release liability. A usable original archive can pass the existing guarded UNKNOWN recovery endpoint and atomically accept only that batch before unsent work continues. Operator invalid-output resume does not apply to UNKNOWN. No manual state clearing or replacement inference is authorized by a null response.

Bounded original-response retrieval ended without an archive. Supported owner cancellation stops only unsent second-test work and releases its generation slot while preserving all 20 accepted prompts, immutable revision, UNKNOWN request/claim/attempt and full cost reserve. Both rentals are CLEAN, zero held leases/owned Pods are verified, future unused authority is retired and the full started/reserved liability ceiling is USD 4.934096266666668 of USD 10. Deployment is complete; the fresh 180-second final export/playback gate remains provider-blocked and is not marked green.
