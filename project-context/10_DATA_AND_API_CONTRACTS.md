# Data and API contracts

Status: implementation blueprint; field names may evolve only through versioned migrations  
Read when: creating schemas, routes, worker payloads, callbacks, or the canonical EDL.

## Core relational records

| Record | Purpose |
|---|---|
| `users` | Auth identity |
| `workspaces` | Team boundary |
| `memberships` | Invite, role, status |
| `avatar_profiles` | Workspace named identity, `ACTIVE | ARCHIVED`, active ready version, private thumbnail pointer |
| `avatar_profile_versions` | Version-scoped source workflow; immutable canonical source payload/hash after `READY` |
| `avatar_profile_assets` | Private original/runtime/thumbnail assets, checksums, media metadata, retention |
| `avatar_compatibility_assessments` | Optional exact source + avatar model/execution profile test state/evidence |
| `avatar_profile_test_attempts` | Optional idempotent RunPod test attempts, outputs, verdict, and one-time cost |
| `image_styles` | Workspace/system style identity, `ACTIVE | ARCHIVED`, active published version, cover policy/asset |
| `image_style_versions` | Draft workflow state; immutable structured profile/provenance only after `PUBLISHED` |
| `image_style_references` | Private reference assets, order, rights, retention, outlier/confidence |
| `image_style_analysis_attempts` | Idempotent Runware request, usage/cost, response/error lineage |
| `image_style_previews` | Optional standardized Mage style-test outputs and acceptance |
| `projects` | Stable project identity and owner |
| `project_revisions` | Immutable production configuration/seed |
| `project_inputs` | Upload/session records for voiceover and backward-compatible optional script; resolved production fields live only on the revision |
| `transcripts` | ASR/alignment version and duration |
| `transcript_words` | Millisecond words or a pointer to canonical JSON |
| `timeline_segments` | Ordered EDL rows |
| `generation_tasks` | Durable units/chunks |
| `attempts` | Model/provider execution lineage |
| `assets` | R2 objects, content hashes, media metadata |
| `qa_results` | Defect classification and acceptance |
| `render_jobs` | Final compile attempts |
| `cost_events` | Estimate/reserve/reported/settled ledger owned by a project revision, Image Style version, or Avatar Profile version |
| `workflow_events` | Append-only status/audit stream |
| `execution_profiles` | Immutable tested endpoint, ordered GPU priorities, rate ceiling/snapshot, model/container digest, timeout/TTL, and volume/DC compatibility |
| `workflow_instances` | Durable mapping from application workflow/task to Cloudflare/RunPod external instance IDs |
| `outbox` | Transactional external dispatch |

Use UUID/ULID identifiers, UTC timestamps, explicit workspace IDs, and soft archive rather than destructive project deletion. Large JSON/media belongs in R2; searchable state and checksums belong in Postgres.

## Project input and revision configuration

Validate the client request against `evidence/create_project_request.schema.json` (`create-project-request/v2`). Before scheduling or external dispatch, trusted code resolves checksums/defaults/versions into immutable `project-revision-config/v2` using `evidence/project_revision_config.schema.json`. The resolved revision—not form state—is the authority for title, voiceover, exact Avatar Profile/version/hash/runtime source, selected style version/hash, extra-keyword text/toggle, generation mode/cap, per-lane execution-profile IDs, seed, and compiler versions.

The Create button is one user action but not one giant upload request: the control plane creates a draft project shell, issues a signed R2 voiceover upload, verifies it, resolves the already-stored Avatar Profile and Image Style versions, and then creates the immutable revision. Large audio bytes never pass through the Worker body. Avatar source upload occurs only in the Avatar Hub. If any step fails, the same draft resumes without re-uploading verified voiceover assets.

For compatibility, `optional_script` stays nullable. The web shell sends `null` and uses local ASR; other inputs remain strictly validated.

## Timeline plan versus resolved render manifest

Do not put generated asset IDs into the pre-generation EDL. Use two immutable contracts:

1. **`timeline-plan/v1`** — canonical 30 fps frame intervals, source-audio boundaries, narration, deterministic timeline composition/in-image shot role, and composition-specific required task slots.
2. **`resolved-render-manifest/v1`** — revision/timeline hashes, original voiceover binding, fixed output/render profile, total frames, accepted asset IDs/checksums, and exact render geometry after the asset barrier closes.

Complete schema-valid plan and resolved documents are
`evidence/fixtures/timeline_plan.valid.json` and
`evidence/fixtures/resolved_render_manifest.valid.json`. Their split segment proves the exact
avatar/audio-span/right-image task keys become accepted content-addressed assets with the locked
AvatarForcing crop, 30 fps conversion, and right-image zoom profile.

Unless a field explicitly hashes raw provider bytes, every JSON contract hash uses `SHA-256(RFC 8785 JCS(payload))` and includes the `sha256:` prefix. Never hash pretty-printed JSON or a mutable database projection. The golden chain contains real content-derived revision, timeline, render, and default-style hashes.

The machine contracts are `evidence/timeline_plan.schema.json` and `evidence/resolved_render_manifest.schema.json`. Their segment definitions are discriminated unions:

- `AVATAR_FULL` requires exactly an avatar slot/asset.
- `IMAGE_FULL` requires exactly an image slot/asset.
- `AVATAR_SPLIT_IMAGE` requires both avatar and right-image slots/assets.

There is intentionally no MVP `VIDEO_FULL`. Output-frame indices are canonical and end-exclusive; millisecond/audio-sample boundaries remain source-audio metadata only.

## Attempt lineage

Every attempt records:

- Original input asset IDs.
- Avatar Profile parent/version/profile hash, canonical runtime-source asset/checksum, source-preparation/validation versions, exact compatibility state at preflight, and matching immutable terminal evidence ID/hash/status/model snapshot when one exists. `UNTESTED`/`RUNNING` pin a null evidence object; terminal states pin evidence with the same status. Avatar workers never resolve parent `active_version_id`/`latest`.
- Exact source audio start/end and padding.
- Canonical phrase/context.
- Image Style ID/version/profile hash, compact planner-guidance version, scene-prompt-writer version, prompt-compiler version, prompt components, optional extra keywords and apply toggle, permanent guardrail version, exact final positive/negative UTF-8 strings submitted to Mage, and SHA-256 of those exact bytes.
- Model repo/revision/checkpoint hash.
- Container image digest.
- Inference settings and seed.
- GPU SKU and worker/RunPod job ID.
- Pinned `execution_profile_id`, endpoint/configuration revision, ordered GPU priorities, container digest, maximum reserved rate, and price snapshot checked at dispatch.
- Provider dispatch state, ambiguous-ack reconciliation evidence, and worker execution-claim result.
- Submitted/started/model-ready/finished times.
- Peak VRAM and output media metadata where available.
- Estimated, reserved, reported, and settled cost.
- QA defect enum, score/notes, accepted asset ID.
- Parent attempt and fallback reason.

AvatarForcing and SkyReels attempts always reference the same exact pinned Avatar Profile runtime source and selected audio. MuseTalk attempts reference the accepted-quality AvatarForcing visual plus original selected audio.

Style analysis attempts record the ordered `ref_01...ref_N` to normalized-reference-hash map, analyzer provider/model/revision, analyzer prompt/schema versions, media resolution, usage/thinking, provider-reported cost, response hash, uncertainty/outliers, disclosure consent, and separate VideoForge/provider retention/deletion state. The ordered alias map participates in the request hash; returned aliases outside it are invalid.

Every `cost_event` has `owner_type: PROJECT_REVISION | IMAGE_STYLE_VERSION | AVATAR_PROFILE_VERSION`, `owner_id`, and `attempt_id`, in addition to estimate/reservation/reported/settled/refunded amounts. This prevents one-time style-analysis or optional avatar-compatibility charges from being attached to a fake video project.

## Production provenance manifest

`resolved-render-manifest/v1` is deliberately renderer-focused; it must not duplicate every prompt/attempt/cost row. Technical QA creates a `READY_FOR_REVIEW` preview. After explicit user creative approval, create immutable `production-manifest/v2` as the approved downloadable provenance index. It binds by asset ID plus JCS SHA-256:

- Immutable project-revision configuration.
- Timeline plan and resolved render manifest.
- Prompt-component manifest with the exact submitted bytes/hashes.
- Attempt index with model/checkpoint/container/execution/GPU lineage.
- QA manifest and defect/acceptance lineage.
- Reviewer/approval attestation.
- Cost-ledger snapshot and reported/settled summary.
- Pinned Avatar Profile parent/version/profile hash, runtime source checksum, preparation/validation profiles, compatibility state at preflight, and matching immutable terminal compatibility-evidence snapshot when one exists.
- Pinned Image Style version/profile hash and model-role summary.
- Final MP4 asset, checksum, bytes, total frames, and render profile.

The machine contract is `evidence/production_manifest.schema.json`; the coherent synthetic chain is under `evidence/fixtures/`. Child manifests remain independently content-addressed so a cost settlement or regenerated draft does not mutate historical evidence in place.

## R2 layout

```text
workspace/{workspace_id}/project/{project_id}/revision/{revision_id}/
  inputs/
  transcript/
  timeline/
  prompts/
  images/
  avatar/primary/
  avatar/repair/
  avatar/fallback/
  previews/
  renders/
  manifests/

workspace/{workspace_id}/image-style/{style_id}/version/{version_id}/
  references/original/
  references/analysis/
  analysis/
  previews/
  manifests/

workspace/{workspace_id}/avatar-profile/{profile_id}/version/{version_id}/
  source/original/
  source/runtime/
  thumbnails/
  previews/
  compatibility/
  manifests/
```

Object filenames are content-addressed or include an immutable attempt ID. Never overwrite an accepted artifact in place.

## API surface

The canonical same-origin prefix is `/api`: `/v1/...` shorthand below is requested as `/api/v1/...`; health is `/api/health`.

Minimum routes:

```text
POST   /v1/projects
POST   /v1/projects/{id}/uploads/sign
POST   /v1/projects/{id}/revisions
POST   /v1/projects/{project_id}/revisions/{revision_id}/start
GET    /v1/projects/{id}
GET    /v1/projects/{id}/events
POST   /v1/projects/{project_id}/revisions/{revision_id}/cancel
POST   /v1/projects/{project_id}/revisions/{revision_id}/segments/{segment_id}/regenerate
POST   /v1/projects/{project_id}/revisions/{revision_id}/segments/{segment_id}/accept
POST   /v1/projects/{project_id}/revisions/{revision_id}/approve
GET    /v1/avatar-profiles
POST   /v1/avatar-profiles
GET    /v1/avatar-profiles/{id}
PATCH  /v1/avatar-profiles/{id}
GET    /v1/avatar-profiles/{profile_id}/versions
POST   /v1/avatar-profiles/{profile_id}/versions
POST   /v1/avatar-profiles/{profile_id}/versions/{version_id}/uploads/sign
POST   /v1/avatar-profiles/{profile_id}/versions/{version_id}/validate
PATCH  /v1/avatar-profiles/{profile_id}/versions/{version_id}
POST   /v1/avatar-profiles/{profile_id}/versions/{version_id}/test
POST   /v1/avatar-profiles/{profile_id}/versions/{version_id}/tests/{assessment_id}/verdict
POST   /v1/avatar-profiles/{profile_id}/versions/{version_id}/publish
POST   /v1/avatar-profiles/{profile_id}/versions/{version_id}/abandon
DELETE /v1/avatar-profiles/{profile_id}/versions/{version_id}/source
POST   /v1/avatar-profiles/{id}/duplicate
POST   /v1/avatar-profiles/{id}/archive
POST   /v1/avatar-profiles/{id}/restore
GET    /v1/image-styles
POST   /v1/image-styles
GET    /v1/image-styles/{id}
GET    /v1/image-styles/{style_id}/versions
POST   /v1/image-styles/{style_id}/versions
POST   /v1/image-styles/{style_id}/versions/{version_id}/uploads/sign
POST   /v1/image-styles/{style_id}/versions/{version_id}/analyze
PATCH  /v1/image-styles/{style_id}/versions/{version_id}
POST   /v1/image-styles/{style_id}/versions/{version_id}/publish
POST   /v1/image-styles/{style_id}/versions/{version_id}/test
POST   /v1/image-styles/{style_id}/versions/{version_id}/abandon
POST   /v1/image-styles/{id}/duplicate
POST   /v1/image-styles/{id}/archive
GET    /v1/execution-profiles
PUT    /v1/admin/execution-profiles
GET    /v1/usage
POST   /v1/callbacks/runpod
POST   /v1/callbacks/worker-progress
```

Use typed error codes such as `GPU_UNAVAILABLE`, `BUDGET_BLOCKED`, `MODEL_LOAD_FAILED`, `SCHEMA_INVALID`, `CALLBACK_REPLAY`, `REVISION_CONFLICT`, `AVATAR_PROFILE_REQUIRED`, `AVATAR_NOT_READY`, `AVATAR_ARCHIVED`, `AVATAR_SOURCE_INVALID`, `AVATAR_VERSION_CONFLICT`, `AVATAR_TEST_FAILED`, `STYLE_NOT_READY`, `STYLE_ANALYSIS_FAILED`, `STYLE_REFERENCE_INVALID`, and `STYLE_VERSION_CONFLICT`. The UI maps these to plain language.

Every start/cancel/regenerate/segment-accept/final-approve mutation requires `Idempotency-Key` and `If-Match` (or an equivalent expected revision/candidate token). Final approval derives `reviewer_user_id` from the authenticated server session—never from a client-supplied user ID—and atomically verifies the exact current review-candidate version/final checksum before creating the production manifest. A project ID alone never implies which revision to mutate.

## Worker job envelope

`evidence/worker_job_envelope.schema.json` (`worker-job-envelope/v1`) is the canonical
claim-bound dispatch contract. It carries only immutable identity, content-addressed pointers,
controlled output/callback destinations, expiry, and cancellation authority. Job-specific avatar,
audio-span, image-prompt, or render inputs live in the content-addressed `input_manifest`; workers
must validate that manifest against the expected job type before loading a model. The complete
schema-valid synthetic example is `evidence/fixtures/worker_job_envelope.valid.json`.

```json
{
  "schema_version": "worker-job-envelope/v1",
  "job_type": "AVATAR_PRIMARY_CHUNK",
  "dispatch_target": "FIXTURE",
  "idempotency_key": "revision_fixture_001:avatar:chunk_001:attempt_001",
  "workspace_id": "workspace_fixture_001",
  "project_id": "project_fixture_001",
  "revision_id": "revision_fixture_001",
  "task_id": "task_avatar_chunk_001",
  "attempt_id": "attempt_avatar_chunk_001_001",
  "execution_profile_id": "fixture-avatar-primary-auto-v1",
  "execution_claim_token": "single-use-token-at-least-32-characters",
  "revision_config": {"asset_id": "asset_revision_config_001", "sha256": "sha256:..."},
  "input_manifest": {
    "asset_id": "asset_avatar_input_manifest_001",
    "sha256": "sha256:...",
    "signed_url": "https://...",
    "expires_at": "2026-08-09T11:30:00.000Z"
  },
  "output_prefix": "workspace/.../avatar/primary/attempt_001/",
  "callback": {"url": "https://...", "token": "short-lived-token-at-least-32-characters", "expires_at": "2026-08-09T11:30:00.000Z"},
  "cancel_token": "cancel-token-at-least-32-characters",
  "deadline_at": "2026-08-09T11:20:00.000Z"
}
```

The worker validates contract/profile versions, the pinned Avatar Profile/hash/runtime-source checksum, URLs, media properties, allowed output prefix, and the single-use execution claim before loading a costly model. It never fetches a parent `active_version_id`. An avatar job receives only materialized padded span-audio assets; the full voiceover URL is never in its envelope. It removes context padding according to immutable trim metadata before publishing the native accepted source clip and its exact renderer source profile. The primary publishes `avatarforcing-centered-832x480p25-v1`; a SkyReels attempt publishes `skyreels-centered-1280x720p24-v1`. The renderer alone applies the matching fixed crop and direct native-rate→30 conversion. URLs are minted/refreshed just before provider dispatch and must remain valid beyond the job TTL. The worker never accepts arbitrary shell arguments or destinations.

An image-generation item carries the immutable compiled prompt components/final hash or a content-addressed manifest pointer. A RunPod worker never fetches mutable `latest style` state.

## Events and UI progress

Events are append-only and monotonic per attempt. Derived project progress can be rebuilt from them. The UI may receive them through realtime/SSE and must poll after disconnect.

`evidence/orchestration_state.schema.json` (`orchestration-state/v1`) locks the durable workflow,
task, attempt, outbox, cancellation, and event vocabulary before any provider transport is added.
The valid/invalid golden fixtures prove that dispatch is content-addressed and that an unhashed
outbox payload cannot cross the boundary. Cross-row reference integrity and strictly increasing
event sequences remain transactional database invariants in addition to document validation.

Do not store a fake `63%` that cannot be explained. Calculate stage progress from completed/total units, and overall progress from explicit weighted stages whose weights are versioned.

## Revision rules

- Avatar Profile version/binding, scheduler/prompt/model settings, generation mode, any per-lane execution-profile override, selected Image Style version/hash, extra keyword text, or its apply toggle changes create a new project revision. `project_revisions` is the sole persisted authority for those resolved production fields; `project_inputs` does not duplicate them.
- Every new revision requires one accessible `READY` `avatar_profile_version_id`. The server snapshots its parent/version/hash/runtime source before dispatch; archive or v2 activation after that cannot change the revision.
- Every new revision requires one published accessible `image_style_version_id`; the built-in default satisfies this automatically.
- Published Image Style versions are immutable. Reference/profile edits create a new version; old projects remain reproducible even if the style is archived.
- The immutable revision configuration never changes after generation starts. Media selection is a separate versioned review candidate under that revision.
- A single-scene regenerate from `GENERATING`, review, or `READY_FOR_REVIEW` creates a new attempt, increments `review_candidate_version`, updates only that candidate's selected asset binding, and rebuilds the resolved render manifest/final preview. Prior candidates/assets remain addressable for lineage.
- `approve` uses optimistic concurrency against the exact review-candidate version and final checksum. Once `APPROVED`, its production manifest and selected candidate are immutable; any later regenerate, timeline edit, prompt/model/profile/style/keyword change creates a new project revision.
- Editing a timeline invalidates only downstream affected tasks and is shown before confirmation.
- Concurrent mutations require an edit lease or optimistic version check.

## Avatar Hub contract summary

`avatar_profiles` uses `ACTIVE | ARCHIVED` plus `active_version_id`; active names are case-insensitively unique within one workspace. `avatar_profile_versions` uses `DRAFT | VALIDATING | NEEDS_REVIEW | FAILED | READY | ABANDONED`. `FAILED` is retryable, `ABANDONED` is terminal, and `READY` payloads are immutable. A ready v1 remains selectable while a v2 draft is prepared.

Database constraints:

- Unique `(avatar_profile_id, version_number)` and at most one open `DRAFT | VALIDATING | NEEDS_REVIEW | FAILED` version per profile.
- `active_version_id` references a `READY` version of the same parent.
- Publishing atomically marks the version `READY` and updates the parent pointer; rename/archive never changes the version hash.
- Replacing source pixels before readiness invalidates validation/compatibility attempts; changing pixels after readiness creates a new version.
- An archived profile is not selectable for a new revision but remains resolvable for historical lineage.

Compatibility is separate derived evidence keyed by exact avatar version + model/checkpoint/container/execution/crop profile. No row means `UNTESTED`; records use `RUNNING | PASSED | FAILED | STALE | CANCELLED` and immutable evidence hashes. `CANCELLED` retains partial attempt/cost lineage and is retryable through a new attempt. An optional test is a billed version-owned action; it is not rerun during ordinary project creation. All compatibility states remain selectable under the proposed optional-test policy when the source is otherwise ready, with progressively stronger warnings. Source availability is separately derived as `AVAILABLE | ERASED`; erasure makes a version nonselectable/non-regenerable without rewriting its immutable historical payload. The stored immutable payload and privacy/UI lifecycle live in `20_AVATAR_HUB.md` and `evidence/avatar_profile_version.schema.json`.

## Image Style contract summary

`image_styles` uses only `ACTIVE | ARCHIVED`, plus `active_version_id`. `image_style_versions` uses `DRAFT | ANALYZING | NEEDS_REVIEW | FAILED | PUBLISHED | ABANDONED`. A published v1 remains selectable while v2 is analyzing; only the archived parent is removed from new selection. `FAILED` is retriable; `ABANDONED` is terminal and no longer counts as an open draft.

Database constraints:

- Unique `(style_id, version_number)` and at most one open `DRAFT | ANALYZING | NEEDS_REVIEW | FAILED` version per style.
- `active_version_id` references a `PUBLISHED` version of the same style.
- Publish atomically changes the version to `PUBLISHED` and updates the parent pointer.
- Draft mutations require optimistic revision/`If-Match`; externally billed version actions also require version-scoped idempotency.

Each published `image_style_version` contains:

- Immutable `image-style-profile/v1` payload and `SHA-256(JCS(profile_payload))` hash; lifecycle/default/provenance fields are outside the payload.
- `planner_guidance`, positive/negative suffixes, full/split guidance.
- Source kind (`BUILTIN_MANUAL | VISION_ANALYSIS | DUPLICATE | MANUAL_EDIT`).
- Analyzer provider/model/revision/prompt/schema and reference-set hash.
- Immutable creation/publication identity and timestamps.

Detailed fields and prompt provenance live in `18_IMAGE_STYLES_HUB.md`; stored-payload validation uses `evidence/image_style_profile.schema.json`, while the untrusted provider response uses `evidence/image_style_analyzer_output.schema.json`. Register both canonical schema `$id` values before resolving/inlining provider output schema references, and run the documented nonblank/required-list semantic validator before review/publication.

## Retention

Initial policy proposal:

- Failed temporary uploads: 24 hours.
- Avatar originals/runtime assets/thumbnails: retained while a ready version is active or referenced. Archive does not delete them; explicit erasure is blocked during queued/running use and marks historical revisions non-regenerable after a clear warning.
- Style analysis derivatives: delete from VideoForge/R2 after analysis/publication according to the selected policy; originals retained only by explicit choice while a style remains active. Provider-side retention/deletion follows the separately disclosed Runware process.
- Disposable worker intermediates: 3–7 days.
- Accepted scene assets: through project approval plus configurable short retention.
- Final render and manifest: 30 days by default, then archive/delete choice.
- Audit/cost rows: retained longer because they are small.

R2's free 10 GB will not retain many 30-minute videos indefinitely. Show retention clearly and charge storage overage rather than silently deleting a final.
