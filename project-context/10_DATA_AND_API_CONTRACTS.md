# Data and API contracts

Status: normative architecture blueprint; isolated persistent-model Pod contracts require a new versioned implementation before production dispatch
Read when: creating schemas, routes, worker payloads, callbacks, or the canonical EDL.

## Current machine-contract boundary

The checked-in `create-project-request/v2`, `project-revision-config/v2`,
`worker-job-envelope/v1`, `orchestration-state/v1`, and their fixtures describe the existing
provider-free/legacy implementation. They do **not** encode the new paid RunPod architecture and
must not authorize or dispatch it. A later implementation task must add new versioned schemas,
fixtures, validators, persistence, and migration evidence before any production start path is
enabled. This document specifies that vNext boundary; it does not reinterpret old JSON bytes or
pretend the current schemas already prove it.

The production lane locks are:

| Lane | Exact model/runtime | Persistent resource |
|---|---|---|
| `image_media` | `Comfy-Org/Mage-Flow` revision `d8c99241f6fa80fbd453014234af2bf337ea21e6`, `int8-convrot`, ComfyUI, 4 steps, guidance 1.0, 1280×720 | Dedicated Mage model volume in `EU-RO-1` plus a disposable Mage Pod |
| `avatar_primary` | Pinned EchoMimicV3-Flash FP8 contract | Dedicated Echo model volume in `EU-RO-1` plus a disposable Echo Pod |

The volumes and Pods are never shared, cross-mounted, cross-adopted, or substituted across lanes.
One Generate action creates the two Pods concurrently after final GPU-offering revalidation. Normal
Pod boot is offline with respect to model files: it verifies the exact retained-volume manifest,
loads the model into the selected GPU, warms it, and only then reports authoritative
`MODEL_READY`. Missing or invalid model bytes fail closed; ordinary generation never downloads or
repairs them. Each Pod is deleted after its lane outputs are durable, and its model volume remains.

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
| `image_style_versions` | Draft workflow state plus immutable root/current profile-artifact pointers; only the open-version pointer may move before `PUBLISHED` |
| `image_style_profile_artifacts` | Immutable accepted-analysis and manual-derived canonical profile bytes/hashes with root-source and immediate-parent lineage |
| `image_style_profile_edits` | Authenticated optimistic/idempotent edit provenance, changed pointers, and exact result artifact/revision |
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
| `execution_profiles` | Immutable lane/model/runtime/container/compatibility policy; never a claim of live GPU availability |
| `model_volumes` | One registered persistent RunPod volume for one exact lane/model contract, fixed to `EU-RO-1`; cross-lane binding forbidden |
| `model_volume_manifests` | Immutable ordered file/checksum/size/model/runtime manifest plus verification result and activation lineage for one model volume |
| `gpu_inventory_receipts` | Timestamped raw/normalized compatible Secure Cloud offerings observed from RunPod for one lane and region |
| `compute_run_plans` | Immutable two-lane start plan binding one fresh receipt and one exact chosen GPU offering per lane before dispatch |
| `pod_lifecycle_attempts` | Per-lane Pod create/reconcile/readiness/work/delete/absence lineage, timing, price, volume, image, and provider identity |
| `workflow_instances` | Durable mapping from application workflow/task to local work and exact RunPod Pod attempts |
| `outbox` | Transactional external dispatch |

Use UUID/ULID identifiers, UTC timestamps, explicit workspace IDs, and soft archive rather than destructive project deletion. Large JSON/media belongs in R2; searchable state and checksums belong in Postgres.

`model_volumes` are control-plane records for RunPod persistent storage, not R2 media assets. A
record binds exactly one lane, model repository/revision/precision, immutable active manifest,
region, provider volume ID, mount contract, and lifecycle state. The database rejects a volume
binding whose lane/model/region differs from the execution profile. Provider IDs are encrypted or
access-controlled and represented by safe aliases in ordinary UI/audit views.

`gpu_inventory_receipts` retain the observed offering ID, GPU SKU, VRAM, Secure Cloud status,
region/data-center scope, availability/count, quoted hourly price, compatibility evaluation, raw
response hash, observed time, and expiry. A choice references an exact offering contained in that
receipt; free-form SKU text and a static priority list are invalid. Immediately before each Pod
create, trusted code refreshes/revalidates that exact offering and rate. Disappearance, material
price increase beyond the approved cap, or compatibility drift blocks dispatch; it never silently
chooses another GPU.

## Durable database implementation boundary

`DEC_DB_001` locks the Phase 1 foundation without prematurely coupling domain logic to one query
library. Committed additive PostgreSQL SQL migrations and query-library-neutral TypeScript
repository contracts are authoritative. A pinned PGlite development dependency applies the same
migrations in fast, network-free unit/CI tests; it is not the production database and passing its
suite is not a Neon deployment claim. The Neon runtime driver and production repository
implementation belong to `VF-1-02`/`VF-1-05` after these contracts are green.

The first migration uses native UUID internal IDs, UTC `timestamptz`, integer frames/milliseconds,
nonnegative integer micro-USD amounts, explicit workspace scope, additive checked state
vocabularies, foreign keys, partial unique indexes, and soft archive/terminal history. Canonical
documents remain immutable JSONB or object-storage bytes with contract name/version and distinct
canonical-document/binary SHA-256 columns; SQL never performs JCS. Migration verification must not
connect to Neon, require Docker, use a schema-push command, or read a `DATABASE_URL`.

Repository methods are domain operations, not generic unscoped CRUD. They must require workspace
scope and expose atomic units for revision creation, preset publication, task/attempt/cost/outbox
reservation, execution claim/reconciliation/cancellation, append-only events, and one accepted
result. `project-context/tasks/VF-1-01.md` owns the exact implementation and contract-test brief.

## Project input and revision configuration

The checked-in `create-project-request/v2` and `project-revision-config/v2` remain authoritative only
for the provider-free/legacy path described by their machine schemas. They must fail closed before
new paid Pod dispatch. vNext preserves their immutable creative bindings and adds exact lane model
profiles, while keeping transient live-GPU availability out of the creative document.

Before a paid start, trusted code validates a future `start-project-revision/vNext` request carrying
two independent selections: one fresh inventory receipt plus exact offering ID for `image_media`,
and one for `avatar_primary`. It resolves them into immutable `compute-run-plan/v1` bytes containing:

- Revision/config identity and approved spend cap.
- Exact Mage and Echo execution-profile IDs and container digests.
- Exact lane-specific `model_volume_id`, immutable volume-manifest ID/hash, `EU-RO-1` region, and mount contract.
- Receipt ID/hash/observed/expiry time, exact chosen offering ID/SKU/VRAM, quoted rate, availability, and compatibility result for each lane.
- Final revalidation receipt/hash/time and rate for each exact choice.
- Per-lane Pod-create idempotency key, deadline, output prefix, and deletion policy.
- Compiler/orchestrator versions and a canonical document hash.

The Compute UI may save both selections with the draft, but stale selections never become a run
plan. Changing an exact GPU offering creates a new compute run plan/attempt, not a new creative
project revision. Changing a model, model revision, precision, runtime, source Avatar Profile,
Image Style, scheduler, prompt contract, or seed still requires the appropriate immutable revision.

The Create/Generate control is one user action but not one giant upload request: the control plane
creates/resumes a draft project shell, locally decodes/probes/hashes the voiceover, issues a signed
resumable R2 upload reservation bound to that checksum/metadata, resolves the already-stored Avatar
Profile and Image Style versions, creates the immutable revision, validates the two exact current GPU
choices, and creates one compute run plan. The Mage and Echo Pods then start concurrently while the
voiceover becomes durable. Large audio bytes never pass through the Worker body. During
Pod/container/model startup, durable upload plus local/provider-free ASR, deterministic scheduling,
prompt compilation, and padded avatar-span materialization overlap. No inference task dispatches
until every required R2/local input passes its durable verification barrier. Avatar source upload
occurs only in the Avatar Hub. If any preflight step fails, the same draft resumes its upload rather
than changing immutable input identity.

For compatibility, `optional_script` stays nullable. The web shell sends `null` and uses local ASR; other inputs remain strictly validated.

## Timeline plan versus resolved render manifest

Do not put generated asset IDs into the pre-generation EDL. Use two immutable contracts:

1. **`timeline-plan/v1`** — canonical 30 fps frame intervals, source-audio boundaries, narration, deterministic timeline composition/in-image shot role, and composition-specific required task slots.
2. **`resolved-render-manifest/v1`** — revision/timeline hashes, original voiceover binding, fixed output/render profile, total frames, accepted asset IDs/checksums, and exact render geometry after the asset barrier closes.

Complete schema-valid plan and resolved documents are
`evidence/fixtures/timeline_plan.valid.json` and
`evidence/fixtures/resolved_render_manifest.valid.json`. They prove the existing provider-free
timeline/asset-barrier mechanics only. Any embedded legacy avatar-model crop/profile name is not an
Echo production authorization. vNext fixtures must bind the exact Echo renderer source profile,
avatar/audio-span/right-image task keys, 30 fps conversion, and right-image zoom profile before the
new paid path is enabled.

Unless a field explicitly hashes raw provider bytes, every JSON contract hash uses `SHA-256(RFC 8785 JCS(payload))` and includes the `sha256:` prefix. Never hash pretty-printed JSON or a mutable database projection. The golden chain contains real content-derived revision, timeline, render, and default-style hashes.

TypeScript is the sole RFC 8785 authority for Phase 0C. A Python worker verifies the SHA-256 of
the exact canonical input bytes it receives and of binary media bytes it produces, validates parsed
documents through the canonical JSON Schema/Pydantic entry point, and treats any
`canonical_document_hash` as opaque. It must not reserialize JSON to derive or verify JCS. The
TypeScript control plane validates returned facts, canonicalizes and stores result-manifest bytes,
and assigns their canonical hash. Future callback HMACs sign raw bytes; local worker envelopes use
the explicit local artifact pointer and a null callback instead of a fake HTTPS callback.

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
- Pinned `execution_profile_id`, exact lane, container digest, and model-volume ID/manifest hash/region/mount; a volume used by the other lane is invalid.
- Inventory receipt/final-revalidation IDs and hashes, exact chosen RunPod offering ID/GPU SKU/VRAM, Secure Cloud/data-center scope, observed availability, quoted/final hourly rate, and approved rate ceiling.
- Internal Pod-attempt ID, provider Pod ID, idempotent create fingerprint, create response hash, and ambiguous-ack reconciliation evidence.
- Worker execution-claim result and the exact offline-model-files policy it enforced.
- Requested, Pod-create-acknowledged, volume-attached, container-ready, volume-manifest-verified,
  model-load-started, warm-up-started, authoritative-model-ready, inference-started/finished,
  output-upload-started/durable, Pod-delete-requested/acknowledged, and independent-Pod-absence-
  verified times.
- Container-pull, volume verification, model load, warm-up, model-ready, inference, upload, deletion, total billed, and end-to-end durations derived from those timestamps.
- Delete/reconciliation attempts and final provider absence evidence. Pod success never implies volume deletion; retained-volume identity and post-run state remain explicit.
- Peak VRAM and output media metadata where available.
- Estimated, reserved, reported, and settled cost.
- QA defect enum, score/notes, accepted asset ID.
- Parent attempt and retry/supersession reason.

EchoMimicV3-Flash FP8 attempts always reference the same exact pinned Avatar Profile runtime source,
selected materialized span audio, Echo model/checkpoint/container, Echo-only volume manifest, and
Echo renderer source profile. The active production contract contains no AvatarForcing, SkyReels,
or MuseTalk repair/fallback dispatch. Historical attempts retain their original lineage and names
without becoming selectable vNext profiles.

Style analysis attempts record the ordered `ref_01...ref_N` to normalized-reference-hash map, analyzer provider/model/revision, analyzer prompt/schema versions, media resolution, usage/thinking, provider-reported cost, response hash, uncertainty/outliers, disclosure consent, and separate VideoForge/provider retention/deletion state. The ordered alias map participates in the request hash; returned aliases outside it are invalid.

Every `cost_event` has `owner_type: PROJECT_REVISION | IMAGE_STYLE_VERSION | AVATAR_PROFILE_VERSION`, `owner_id`, and `attempt_id`, in addition to estimate/reservation/reported/settled/refunded amounts. This prevents one-time style-analysis or optional avatar-compatibility charges from being attached to a fake video project.

## Production provenance manifest

`resolved-render-manifest/v1` is deliberately renderer-focused; it must not duplicate every prompt/attempt/cost row. Technical QA creates a `READY_FOR_REVIEW` preview. After explicit user creative approval, create immutable `production-manifest/v2` as the approved downloadable provenance index. It binds by asset ID plus JCS SHA-256:

- Immutable project-revision configuration.
- Timeline plan and resolved render manifest.
- Prompt-component manifest with the exact submitted bytes/hashes.
- Attempt index with model/checkpoint/container, retained-volume manifest, exact inventory receipt/GPU offering/rate, Pod lifecycle, readiness timings, and deletion/absence lineage.
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

RunPod model volumes are deliberately absent from this R2 tree. R2 carries project inputs,
generated outputs, final MP4s, and manifests; the two `EU-RO-1` persistent volumes carry only their
respective exact model/runtime cache. Deleting a Pod must not delete its volume, and retaining a
volume must not retain project voiceover or generated project output as the durable source of truth.

## API surface

The canonical same-origin prefix is `/api`: `/v1/...` shorthand below is requested as `/api/v1/...`; health is `/api/health`.

Minimum routes:

```text
POST   /v1/projects
POST   /v1/projects/{id}/uploads/sign
POST   /v1/projects/{id}/revisions
GET    /v1/runpod/gpu-inventory?lane=image_media|avatar_primary
POST   /v1/projects/{project_id}/revisions/{revision_id}/start
GET    /v1/projects/{project_id}/revisions/{revision_id}/compute-runs
GET    /v1/projects/{project_id}/revisions/{revision_id}/compute-runs/{compute_run_id}
POST   /v1/projects/{project_id}/revisions/{revision_id}/compute-runs/{compute_run_id}/cancel
POST   /v1/projects/{project_id}/revisions/{revision_id}/compute-runs/{compute_run_id}/reconcile
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
GET    /v1/admin/model-volumes
GET    /v1/admin/model-volumes/{model_volume_id}
POST   /v1/admin/model-volumes/{model_volume_id}/verify
GET    /v1/usage
POST   /v1/callbacks/worker-progress
```

The vNext `start` body carries the exact two receipt/offering selections and approved cap; the server
returns a compute-run plan identity, never a bare Pod ID. The inventory route is lane-scoped, emits
only compatible Secure Cloud `EU-RO-1` offerings, identifies observation/expiry times, and never
manufactures availability from a configured priority list. `model-volumes/{id}/verify` is an
explicit authenticated administrative operation; ordinary generation cannot prepare, repair, or
download a volume. One-time volume provisioning/preparation is a separately authorized operations
workflow, not an implicit side effect of `start`.

Use typed error codes such as `GPU_INVENTORY_STALE`, `GPU_OFFERING_UNAVAILABLE`,
`GPU_PRICE_CHANGED`, `GPU_INCOMPATIBLE`, `MODEL_VOLUME_UNAVAILABLE`,
`MODEL_VOLUME_WRONG_LANE`, `MODEL_VOLUME_WRONG_REGION`, `MODEL_VOLUME_MANIFEST_INVALID`,
`MODEL_DOWNLOAD_FORBIDDEN`, `POD_CREATE_AMBIGUOUS`, `MODEL_LOAD_FAILED`,
`MODEL_WARMUP_FAILED`, `POD_DELETE_UNVERIFIED`, `BUDGET_BLOCKED`, `SCHEMA_INVALID`,
`CALLBACK_REPLAY`, `REVISION_CONFLICT`, `AVATAR_PROFILE_REQUIRED`, `AVATAR_NOT_READY`,
`AVATAR_ARCHIVED`, `AVATAR_SOURCE_INVALID`, `AVATAR_VERSION_CONFLICT`, `AVATAR_TEST_FAILED`,
`STYLE_NOT_READY`, `STYLE_ANALYSIS_FAILED`, `STYLE_REFERENCE_INVALID`,
`STYLE_VERSION_CONFLICT`, `STYLE_VERSION_IMMUTABLE`, `STYLE_PROFILE_NO_CHANGES`, and
`IDEMPOTENCY_CONFLICT`. The UI maps these to plain language.

Every start/cancel/reconcile/regenerate/segment-accept/final-approve mutation requires
`Idempotency-Key` and `If-Match` (or an equivalent expected revision/candidate token). Start also
requires an unexpired receipt and final exact-offering revalidation. Cancel/delete is not complete
until independent provider absence is recorded for every created Pod; the model-volume records
remain. Final approval derives `reviewer_user_id` from the authenticated server session—never from
a client-supplied user ID—and atomically verifies the exact current review-candidate version/final
checksum before creating the production manifest. A project ID alone never implies which revision
or compute run to mutate.

## Worker job envelope

`evidence/worker_job_envelope.schema.json` (`worker-job-envelope/v1`) remains the canonical
claim-bound envelope for the implemented provider-free/legacy path. It carries only immutable
identity, content-addressed pointers, controlled output/callback destinations, expiry, and
cancellation authority. Job-specific avatar, audio-span, image-prompt, or render inputs live in the
content-addressed `input_manifest`; workers must validate that manifest against the expected job
type before loading a model. The complete schema-valid synthetic example is
`evidence/fixtures/worker_job_envelope.valid.json`. This v1 example must not be sent to a paid
isolated-model Pod.

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

The future Pod envelope must add an immutable `compute_run_plan` pointer/hash and a
`pod_resource_binding` containing lane, internal Pod-attempt ID, exact execution profile/container,
chosen offering receipt/revalidation identity, model-volume ID, provider volume ID, manifest
ID/hash, `EU-RO-1`, and exact mount. The image worker accepts only the Mage binding; the avatar
worker accepts only the Echo binding. Cross-lane identity, region, mount, manifest, or model drift is
a terminal pre-load error.

The worker validates contract/profile versions, the pinned Avatar Profile/hash/runtime-source
checksum, URLs, media properties, allowed output prefix, and the single-use execution claim before
loading a costly model. It verifies every required model file from its attached volume with network
model fetching disabled, loads the exact model into the chosen GPU, executes the pinned warm-up,
and emits `MODEL_READY` only after all four boundaries succeed. `MODEL_READY` may not be inferred
from Pod running, container health, an open port, or a model-load log line.

An Echo job receives only materialized padded span-audio assets; the full voiceover URL is never in
its envelope. It removes context padding according to immutable trim metadata before publishing
the native accepted Echo source clip and exact pinned renderer source profile. The renderer alone
applies its fixed crop/composition and native-rate-to-30-fps conversion. URLs are minted/refreshed
just before dispatch and remain valid beyond the job TTL. The worker never accepts arbitrary shell
arguments or destinations. No active vNext worker envelope contains AvatarForcing, SkyReels, or
MuseTalk roles.

An image-generation item carries the immutable compiled prompt components/final hash or a
content-addressed manifest pointer plus the exact Mage inference lock: revision
`d8c99241f6fa80fbd453014234af2bf337ea21e6`, `int8-convrot`, ComfyUI, 4 steps, guidance 1.0,
1280×720. A RunPod worker never fetches mutable `latest style` state or model bytes during normal
boot.

## Events and UI progress

Events are append-only and monotonic per attempt. Derived project progress can be rebuilt from them. The UI may receive them through realtime/SSE and must poll after disconnect.

`evidence/orchestration_state.schema.json` (`orchestration-state/v1`) locks the durable workflow,
task, attempt, outbox, cancellation, and event vocabulary before any provider transport is added.
The valid/invalid golden fixtures prove that dispatch is content-addressed and that an unhashed
outbox payload cannot cross the boundary. Cross-row reference integrity and strictly increasing
event sequences remain transactional database invariants in addition to document validation.

That v1 vocabulary is not sufficient for paid Pod dispatch. vNext adds monotonic per-lane events
for `GPU_SELECTION_REVALIDATED`, `POD_CREATE_REQUESTED`, `POD_CREATE_ACKNOWLEDGED`,
`POD_CREATE_RECONCILING`, `MODEL_VOLUME_ATTACHED`, `CONTAINER_READY`, `MODEL_VOLUME_VERIFIED`,
`MODEL_LOAD_STARTED`, `WARMUP_STARTED`, `MODEL_READY`, `INFERENCE_STARTED`,
`INFERENCE_FINISHED`, `OUTPUT_UPLOAD_STARTED`, `OUTPUT_DURABLE`, `POD_DELETE_REQUESTED`,
`POD_DELETE_ACKNOWLEDGED`, `POD_DELETE_RECONCILING`, and `POD_ABSENCE_VERIFIED`, plus explicit
failure/cancel events. Every event carries compute-run, lane, Pod-attempt, timestamp, and causal
predecessor identity. Volume retention is a separate state and never inferred from Pod absence.

One Generate command creates both lane start intents in one durable transaction, then dispatches
them concurrently. ASR/scheduling/prompt/span-audio events may progress while either Pod boots.
Rendering begins after all required accepted assets are durable. Each Pod becomes eligible for
deletion as soon as its own outputs are durable; it does not wait for the other lane or final local
render. The project becomes downloadable only after the local/R2 final MP4 and provenance are
durable and verified, while both paid Pods must independently converge to absence.

Do not store a fake `63%` that cannot be explained. Calculate stage progress from completed/total
units, and overall progress from explicit weighted stages whose weights are versioned. Pod running
is not model ready; Pod delete acknowledged is not Pod absent; output produced inside a Pod is not
durable until its content-addressed destination is verified.

## Revision rules

- Avatar Profile version/binding, scheduler/prompt/model settings, generation mode, per-lane model execution profile, selected Image Style version/hash, extra keyword text, or its apply toggle changes create a new project revision. Exact live GPU offering selections are operational bindings: a changed/stale/unavailable selection creates a new `compute_run_plan`/attempt under the same otherwise-immutable creative revision. It never silently changes the model execution profile. `project_revisions` is the sole persisted authority for resolved creative/model fields; `project_inputs` does not duplicate them.
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
- Every canonical profile artifact is immutable. Before publication, the version's current-artifact
  pointer/revision may move only through an authenticated atomic mutation; publication freezes it.
- Draft mutations require optimistic revision/`If-Match` and `Idempotency-Key`; externally billed
  version actions retain separate version-scoped attempt and cost idempotency.

Each published `image_style_version` contains:

- Immutable `image-style-profile/v1` payload and `SHA-256(JCS(profile_payload))` hash; lifecycle/default/provenance fields are outside the payload.
- `planner_guidance`, positive/negative suffixes, full/split guidance.
- Source kind (`BUILTIN_MANUAL | VISION_ANALYSIS | DUPLICATE | MANUAL_EDIT`).
- Analyzer provider/model/revision/prompt/schema and reference-set hash.
- Immutable creation/publication identity and timestamps.

### Analyzer-derived manual edits

`DEC_STYLE_007` and `18_IMAGE_STYLES_HUB.md` are normative. The accepted
`VISION_ANALYSIS` artifact remains the immutable root source-analysis document. In `NEEDS_REVIEW`,
`PATCH /api/v1/image-styles/{style_id}/versions/{version_id}` accepts one complete candidate
`image-style-profile/v1` plus `If-Match` and `Idempotency-Key`; partial/merge patches are invalid.
The server validates and RFC 8785-canonicalizes the candidate, requires the exact detached
`MANUAL_EDIT` analysis block, computes the creative-field change set, and creates a new immutable
derived artifact linked to both the root source-analysis artifact and immediate prior artifact.

The edit transaction records authenticated actor/time, expected revision, idempotency
identity/fingerprint, sorted RFC 6901 changed pointers, source/parent/derived hashes, invalidates the
prior review snapshot, and moves the current pointer/revision. Any failed storage, validation,
lineage, concurrency, or provenance step leaves visible state unchanged. Exact replay returns the
original result; a changed command under the same key fails `IDEMPOTENCY_CONFLICT`; a stale first
execution fails `STYLE_VERSION_CONFLICT`. Publication derives the reviewer from authentication and
pins the exact current artifact/hash/revision. `PUBLISHED`/`ABANDONED` versions fail closed; editing
published bytes requires a new `DRAFT` version and cannot reinterpret an existing project pin.

VF-7-08 implements this boundary at `326dc38`. Shared versioned request/response/problem DTOs and
runtime validators live in `@videoforge/contracts/image-style-edit`. `If-Match` is one exact quoted
`vf-style-r{revision}-sha256-{artifact_digest}` tag; wildcards or lists are invalid. The Hono route
authenticates before reading JSON, derives workspace and actor from the session, rejects partial or
unknown fields, and composes only `PGliteImageStyleDerivedEditPersistence`. Success returns the
root, immediate parent, current artifact/hash, changed pointers, invalidated review, prior/result
revision, timestamp, replay truth, and a new exact ETag.

VF-7-09 is complete at `6fb3312` plus `d9adee9`. Versioned Hub DTOs cover browser-normalized
reference batches, server registration, draft snapshots, deterministic analysis, publication,
preview, and archive. The browser emits bounded metadata-free sRGB WebP derivatives and exact
original/normalized checksums; the server independently validates base64, magic, dimensions,
checksums, decompression limits, order, disclosure, rights, retention, and normalized WebP chunk
structure. Fixture lifecycle state is authenticated and workspace-scoped with optimistic
concurrency/idempotency. Its retained bytes are session-scoped test data, not production R2.

Detailed fields and prompt provenance live in `18_IMAGE_STYLES_HUB.md`; stored-payload validation uses `evidence/image_style_profile.schema.json`, while the untrusted provider response uses `evidence/image_style_analyzer_output.schema.json`. Register both canonical schema `$id` values before resolving/inlining provider output schema references, and run the documented nonblank/required-list semantic validator before review/publication.

## Retention

Initial policy proposal:

- Failed temporary uploads: 24 hours.
- Avatar originals/runtime assets/thumbnails: retained while a ready version is active or referenced. Archive does not delete them; explicit erasure is blocked during queued/running use and marks historical revisions non-regenerable after a clear warning.
- Style analysis derivatives: delete from VideoForge/R2 after analysis/publication according to the selected policy; originals retained only by explicit choice while a style remains active. Provider-side retention/deletion follows the separately disclosed Runware process.
- Mage and Echo model volumes: retained independently until an explicit separately authorized admin deletion; ordinary project completion/cancel/Pod deletion never deletes either volume.
- Disposable Pods: delete as soon as that lane's outputs are durable or cancellation cleanup begins, then independently prove provider absence. Pod-local intermediates are not durable retention.
- Disposable non-Pod worker intermediates: 3–7 days.
- Accepted scene assets: through project approval plus configurable short retention.
- Final render and manifest: 30 days by default, then archive/delete choice.
- Audit/cost rows: retained longer because they are small.

R2's free 10 GB will not retain many 30-minute videos indefinitely. Show retention clearly and charge storage overage rather than silently deleting a final.
