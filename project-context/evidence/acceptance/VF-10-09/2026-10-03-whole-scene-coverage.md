# Whole-scene footage coverage — 2026-10-03

Checkpoint V2-09, codex/seedance-video. This record separates source/fixture proof, release qualification, publication, production UI/HTTP proof and fresh paid-film acceptance. Current state is whole_scene_motion_plan_2026_10_03 in CURRENT_STATE.yaml.

## Published behavior

Create offers Off, 7%, 15%, 25%, 50%, 75%, 100% and custom integer percentages, with synchronized slider/number input and default 7%. Coverage means “Up to X% of the finished video.” Avatar time, oversized scenes, whole-scene rounding and definite optional failures can lower actual coverage. The 100% ceiling selects all eligible full-screen image scenes; it preserves avatar allocation.

Each new revision pins immutable WHOLE_SCENE_V2 coverage and selection identity. Selected scenes are complete IMAGE_FULL intervals, at most 357 frames, within floor(total_frames × selected_percent / 100). Renderers replace each selected scene through its last frame; they do not append the original still. Narration, total duration, scene boundaries and avatar composition remain unchanged. A definite optional failure retains the whole original still and its recorded charge. Uncertain submissions stay fenced.

Off pins an empty plan and creates no footage jobs or video-specific provider dependency. Recovery copies the exact saved policy, preserves selections and paid request identities, and can resume pending footage after a Workflow stops even when images/avatars already succeeded. Existing feature flag changes do not silently alter saved work. Metadata export/restore preserves the plan policy, selection hash, accepted receipts and uncertain job identity.

## Source and publication identity

- Feature: ee462b51af16c6bd095ca75f50fc026ca980f777.
- Stopped Workflow recovery: d312c9898d3178f3ff2f4d1d83d2cbfc9c4eda18.
- Metadata preservation and final published source: 89cfe121aff173311bccf11329b3f0444404f407.
- Cloudflare version: 57f26050-261e-4032-9f10-64dedce327b2, 100% traffic, published 2026-10-03T05:08:17Z.
- Final application bundle: sha256:0eabab4563e67bc62212f439774272c4770b59aa911a31e0d091e59f0dc173df; 25 prepared public assets.

Publication retains all 51 bindings, 25 secret names and three existing Workflow resource identities. It creates no Workflow instance or paid project. GPU fallback remains DISABLED_UNQUALIFIED. Production byte/hash readback passes for all 23 static payloads and exact root HTML; index.html returns the expected 307 route to the root HTML, while .assetsignore is an expected SPA fallthrough build file. The 25 prepared files therefore do not represent 25 independently served static payloads. All 39 native/desktop source inputs match the qualified runtime. Evidence: client-assets-1791004258805-private.json and native-desktop-identity-1791004258970-private.json.

Private receipts reside in .videoforge/coverage-release-20261003 in the primary checkout: prepared.json and deployed-private.json. Private receipt paths are evidence pointers, not source-controlled attachments; credentials, customer IDs and media are excluded from this record.

## Additive migration and tenant boundaries

Migration 0248_hosted_video_whole_scene_coverage.sql is installed with its exact committed hash. Existing plans retain LEGACY_PREFIX_V1 and 7%; saved selections, outputs and paid identities are not rewritten. Fresh integer 0–100 policy pinning enforces identical replay; approved ASR successor revisions copy the exact policy. SQL independently validates complete scene bounds, selected frame budget, selection hash, source task, accepted originals and output receipts. New v3 policy admission is required even for Off/all-fallback manifests.

The production read-only verifier passed 34 checks: ledger head 248 and exact 243–248 metadata, fixed search paths and tenant scope, security-definer functions, exact runtime/reconciler grants, PUBLIC denial, FORCE RLS and SELECT-only plan access, coverage/policy constraint, enabled identity immutability, retained legacy 7% and actual runtime rejection of foreign/unscoped ready inputs. Evidence: migration-verification-1791002860309-private.json. Migration bytes must remain unchanged after deployment.

## Qualified runtime releases

Desktop release 0.1.47 passed release Workflow 37097401713. Both platform metadata/readbacks match without downloading the large binaries for this acceptance:

- Execution bundle: sha256:9bac6618411b8eaaaa944d40e59839ea8474ae5852a445891be4d14505a9b0aa.
- Published manifest: sha256:22034c5051b906e0d82fa013d0ecdbd674a3db637d4146af8fd5d8afc3324ce8.
- macOS binary: sha256:f0a351adddc90a2ab4741f61474617049290c3a202cf6aeb940a73da1195ca96, 414291200 bytes.
- Windows binary: sha256:9498d098dbc14fc25848b485db7d5c23c261ff0fed9d1bbbb2025c330359f9a6, 279623052 bytes.

Cloud release Workflow 37097442361 passed qualification. Immutable image: ghcr.io/pala-lakshmansai/videoforge-cloud-media-runtime-private@sha256:47c7e1fa39372b37b48c4af669879c8cf5bc636f4fe9073a6b9226a6b9cbd56f. Source digest: sha256:12f9a84c728cc29bd6b28c07a462bcf825dbcd0e4de58db41a54a7e56f34bc83; runtime digest: sha256:5be1e3cd5e6ee32d212ba1b6f45e57e6ecee634e2d72c83be580ba0a2524856f. Offline ASR, span and render qualification passed; this is runtime qualification, not a newly paid Cloud project or Local installation test. The later recovery and snapshot commits do not alter the qualified native source.

## Focused validation

All presets 0/7/15/25/50/75/100 and custom values are covered by focused UI/API/planner checks. They include invalid/fractional/out-of-range values, stale preflight responses, same-body replay and changed-body conflicts, catalog refetch, upload failure, feature unavailable, exact-fit/underfill/no-fit/oversized scenes, legacy plans and policy inheritance. Zero-job generation succeeds before video-only bindings are required. SQL checks reject forged percentages, hashes, partial frames and cross-tenant access.

Synthetic native FFmpeg fixtures decode every selected scene frame and its boundaries, using visibly distinct moving footage and original stills. They verify no still tail, missing frames or duration/narration change, while retaining avatar composition and legacy behavior. Contracts, native SQL and matching TypeScript/Python renderer gates pass. These fixtures demonstrate composition correctness; they do not establish provider-generated clip quality.

Stopped Workflow API/video focused execution checks pass (42): saved PREPARED/SUBMITTING/SUBMITTED/UNKNOWN state, feature flag changes, uncertainty and cancellation, no restart for completed/fallback/cancelled plans, and no repeat POST of uncertain inference. Backup/restore, inventory and migration smoke checks pass (14), including exact whole 75% and legacy 7% plans, saved hash and UNKNOWN_NO_RETRY job claim preservation. Build/type/lint checks appropriate to these edits pass.

A provider-free 60-minute planner audit used 108000 frames, 720 five-second scenes, 25% avatar allocation and every integer percentage from 0 through 100. Each selected interval was a complete 150-frame image scene, its request was 5.1 seconds, and total selected frames stayed within the integer budget. Both 75% and 100% saturated at 540 clips / 75% actual eligible coverage; padded requests totaled 2754 seconds. Four-job submission concurrency and serial polling remain bounded. The existing 5000-observation Workflow wait bound is unchanged: about 2h46m40s of WAITING intervals plus step work can end in RECONCILIATION_REQUIRED and require resume on long high-coverage projects. Recovery retains saved identities. This arithmetic fixture is not a measured long-film latency, cost invoice or proof of indefinitely unattended background continuation.

## Production HTTP and browser proof

Authenticated production HTTP receipt http-coverage-1791004135961-private.json passed at 2026-10-03T05:08:45Z against source 89cfe121. Eighteen cases include eight valid requests, nine invalid values and the legacy request shape. They validate catalog/preflight responses without creating a project, starting generation or calling providers; each count is zero.

Live Chrome Create control checks pass for all seven presets and custom 23: displayed number, slider value and selected state agree on the published source. Keyboard adjustment to 24 and invalid 101 rejection pass. The 390px mobile viewport has no horizontal overflow, and the viewport was reset after checks. Private captures coverage-desktop.png, coverage-mobile.png and chrome-coverage.json preserve the result without creating a project or starting paid inference. This control proof does not establish upload-to-review completion, new whole-scene playback, seek/download or editorial acceptance.

## Broad CI limitations

Full CI is not green. Feature Workflow 37097384140 exposed existing failures outside this change: format checks identify 130 untouched files of 131 reported, the sole bundle-verifier test also fails on the parent baseline, and Ruff I001 points to unchanged frozen_render_smoke.py. Existing Chrome fixture coverage has 10 failures across five tests and two viewports. TypeScript reports 2677 passed / 84 failed, including 53 protected Linux ENOENT failures, three missing fixture cases and older activation/Library assertion, spacing and timeout cases. Task-relevant snapshot inventory and adapter-bootstrap gaps were repaired in 89cfe121 and focused checks pass; that does not turn the entire baseline CI green.

## Retained car export, spend and remaining gates

The retained car film contains 991 frames. Its car scene is [524,676), 152 frames / 5.0667 seconds, but the immutable legacy 7% selection animates only 69 frames and leaves 83 still frames. A complete replacement requires a 5.2-second generated request and at least a 16% finished-film ceiling. The existing export and receipts remain intact; no repair or provider replay occurred. The released policy prevents this prefix/still-tail behavior for newly created whole-scene plans.

New provider generation and paid compute spend are USD0. Fresh complete RunPod inventory is empty (final-owned-complete-inventory-1791002787101-private.json). A retained historical STOPPING/UNKNOWN launch has no Pod ID or verified cleanup; that claim remains unresolved and is not relabeled CLEAN or active paid compute. No resources were started or stopped by the provider-free acceptance.

Remaining gates: separately bounded fresh provider-backed whole-scene canary or car-export repair; real full-film editorial/playback/seek/download; any Local live acceptance; 30-minute performance comparison; final invoices. Earlier paid Seedance acceptance is historical evidence, not acceptance of this newly released whole-scene policy.

Rollback disables fresh admission, retains additive 248 and compatible v3 readers, then drains/reconciles saved submissions before changing runtime defaults. Do not downgrade persisted whole-scene work to a v2-only consumer, drop policy data or replay uncertain inference.
