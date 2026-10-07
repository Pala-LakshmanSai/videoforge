# Data and API contracts

Status: VideoForge V2 target contract; additive implementation remains checkpointed
Read when: changing persistence, tenant isolation, queue admission, Serverless dispatch, artifacts,
attempt lineage, APIs, callbacks, or production manifests.

## Current machine-contract boundary

For fresh API generation selected on 2026-09-24, migration 0188 adds tenant-scoped
`hosted_api_generation_jobs` with immutable inputs, a claim-before-POST transition, persisted Kie
task/Fal request IDs, `UNKNOWN_NO_RETRY` for ambiguous submission, verified private output
asset/receipt/accepted-unit commits, and a ready-render projection. Existing RunPod attempts and
their provenance remain on the original path. The hosted acceptance gate is still open.

Migration 0213 pins new regeneration manifests to `FAL_Z_IMAGE` / `fal-ai/z-image/turbo`.
Exactly one tenant-scoped original source identity is required: API job or historical serverless
attempt backed by accepted unit, committed reservation/receipt and immutable compiled prompt.
Existing regeneration manifests retain their provider. Durable claims precede POST; ambiguous calls
remain `UNKNOWN_NO_RETRY`. Replacement receipt acceptance releases the lease and overlays only
that gallery image; original runtime accepted units and final video receipts are unchanged.
Gallery ordering follows original acceptance so replacements retain their pagination position.

The repository's existing PostgreSQL/PGlite foundation, identity checks, immutable revisions,
scheduler contracts, and media manifests are reusable. Existing migrations and versioned bytes are
append-only history.

The implemented `global-generation-session/v2` and `pod-worker-job-envelope/v2` contracts describe
the superseded singleton/manual-Pod architecture. They remain replayable evidence but are rejected
by the V2 production dispatch firewall. They do not prove tenant privacy, fair two-video admission,
RunPod Serverless transport, hosted R2 durability, or live provider readiness.

The V2 implementation adds, rather than rewrites:

1. tenant-private account/workspace ownership;
2. per-account and global admission/fairness state;
3. Serverless endpoint attempts, durable outbox, assignment, status reconciliation, and cost;
4. tenant R2 object reservations and signed provenance receipts;
5. v3 generation, worker, and production-manifest contracts.

New migrations begin after the existing migration sequence. The planned ownership is:

- `0018_tenant_private_scope.sql`
- `0019_tenant_artifact_receipts.sql`
- `0020_tenant_artifact_isolation_repair.sql`
- `0021_fair_generation_admission.sql`
- `0022_v2_03_admission_audit_repairs.sql`
- `0023_serverless_attempts_and_outbox.sql`
- `0024_serverless_cost_and_reconciliation.sql`
- `0025_serverless_v2_04_audit_repairs.sql`
- `0026_serverless_result_window_and_cancellation_fence.sql`
- `0027_serverless_output_binding_and_result_discovery.sql`
- `0028_v2_05_runtime_cutover.sql`
- `0029_v2_06_hosted_foundation.sql`
- `0030_v2_06_hosted_upload_authority.sql`
- `0031_v2_06_tenant_insert_guard.sql`
- `0032_v2_06_personal_media_workers.sql`

V2-02 implemented `0019_tenant_artifact_receipts.sql` and the additive independent-audit repair
`0020_tenant_artifact_isolation_repair.sql`; later planned filenames moved forward without rewriting history.
V2-03 implemented `0021_fair_generation_admission.sql` and additive independent-audit repair
`0022_v2_03_admission_audit_repairs.sql`; later planned filenames moved forward again without
rewriting history. The repair binds every preview to one exact owned or immutable SYSTEM Mage Image
Style/SoulX Avatar Profile version using composite source lineage.
V2-04 implemented `0023_serverless_attempts_and_outbox.sql` and
`0024_serverless_cost_and_reconciliation.sql`; additive independent-audit repair
`0025_serverless_v2_04_audit_repairs.sql` makes the exact same-attempt provider assignment mandatory
for every progress row and permits a terminal zero-duration reconciliation record at the exact
provider-result expiry boundary. Additive repair
`0026_serverless_result_window_and_cancellation_fence.sql` starts request TTL at provider `/run`
submission, persists the first authoritative terminal observation and its 30-minute result window,
and prevents canonical output acceptance after cancellation or another terminal state at both the
service transaction and database-trigger boundaries.
Additive repair `0027_serverless_output_binding_and_result_discovery.sql` makes canonical output a
complete relational join: every attempt item must have one unique live tenant-owned artifact commit
receipt whose revision, lane, job, item, object key, bytes, checksum, and probe exactly match one
successful item in the separately signed VideoForge provenance receipt. The service derives stored
artifact rows from those receipts instead of trusting caller-supplied rows. An assigned job is not
called terminal until `/status` observes a terminal state; before that observation it remains
discoverable through the worst-case request-TTL-plus-1800-second result horizon.
V2-05 and V2-06 continue the additive history. Migration `0028` binds active per-video runtime
state; `0029` adds hosted identity/workflow/CPU-attempt state; `0030` adds checksum-bound output
authority; and `0031` closes tenant insert-scope gaps. Migration `0032` preserves historical hosted
CPU attempts for rollback while adding `execution_backend`, immutable execution-bundle identity,
tenant-bound personal-worker enrollments/devices/input objects/leases/events, one-live-lease
constraints, RLS, append-only events, and device-authenticated helper functions. Existing migration
bytes are never rewritten to disguise the Cloud Run-to-personal-worker decision change.
Exact future filenames may change only inside their implementation checkpoint before release. Never edit or
renumber committed migrations `0014`–`0017` to make the new architecture appear implemented.

Target versioned machine contracts are:

- `generation-admission/v3`
- `serverless-worker-job-envelope/v3`
- `serverless-provenance-receipt/v1`
- `production-manifest/v3`

V2-02 additionally selects `artifact-object-identity/v3`, `artifact-transfer-port/v3`, and
`artifact-commit-receipt/v3`. Their TypeScript/Python fixtures and provider-free storage tests pass.
The Serverless and production-manifest contracts above remain targets until their checkpoints pass.

## Tenant and authorization model

One authenticated account owns one default workspace in V2. This keeps the 5–10-user product simple
while making every user's data private. The server derives `account_id`, `workspace_id`, and actor
from the authenticated session. Client-provided tenant IDs are routing hints at most and never grant
authority.

Every user-owned relational row carries `account_id` and `workspace_id`. Database constraints use
composite references such as `(account_id, workspace_id, project_id)` so an application bug cannot
join a revision, asset, preset, queue entry, task, cost, or result across tenants. Repository methods
require a tenant scope and return indistinguishable not-found/unauthorized behavior.

Ordinary cross-tenant catalogs contain system presets; DEC_LIBRARY_001 permits owner videos. Presets use explicit `scope_kind=SYSTEM`, contain
no user media, and are read-only to ordinary accounts. User-created Avatar Profiles and Image Styles
use `scope_kind=WORKSPACE` and cannot be discovered, selected, mutated, or referenced by another
account.

Invite-only authentication remains. A unique single-use invite is bound to the intended verified
email and redeemed atomically. Authentication is not sufficient by itself: every read, write,
signed-URL issue, queue mutation, callback acceptance, and download also passes ownership checks.

`DEC_AUTH_002`.

### Team access administration

`DEC_TEAM_ACCESS_001` adds `GET/POST /api/v2/team-access`. Only admitted, verified Google identities
`lakshman121@gmail.com` and `demo9gss@gmail.com` can list admission metadata or perform `INVITE`,
`REVOKE_INVITE`, `REVOKE`, and `RESTORE`. Request bodies contain exactly `operation` and `target`;
mutations require the configured browser origin and existing hosted rate limits. The security-definer
`videoforge_manage_team_access` independently validates the session and exact manager identity.
No project, media, preset, cost, or job content is exposed across tenants.

Migration 0238 retains immutable invitation rows and makes email uniqueness apply to ACTIVE codes.
Replacement creation locks the active email row, revokes it, and inserts a fresh 72-hour code hash.
Consumed codes cannot rotate. `hosted_access_revocations` belongs to native Neon backup/PITR,
not portable restore. Revocation deletes every target browser session, blocks fresh sign-in and
session-scope resolution, and preserves the existing account/workspace; restoration requires a
fresh ordinary Google sign-in. Existing jobs, worker leases, accepted artifacts, provider cleanup,
and tenant ownership rules remain unchanged. Managers cannot revoke either protected owner.

## Core relational records

| Record | Required V2 meaning |
|---|---|
| `accounts` | Auth-bound private tenant and lifecycle |
| `workspaces` | Exactly one default workspace owned by one account in V2 |
| `admissions` / `invites` | Verified-email invite redemption and access state |
| `avatar_profiles` / `avatar_profile_versions` | Workspace-private reusable avatar identity and immutable versions; system rows are explicit built-ins only |
| `image_styles` / `image_style_versions` | Workspace-private reusable style identity and immutable versions; system rows are explicit built-ins only |
| `projects` / `project_revisions` | Workspace-private identity plus immutable voiceover, avatar, style, scheduler, runtime, and render bindings |
| `assets` | Tenant R2 key, content hash, media metadata, retention, and durable-verification state |
| `generation_requests` | One frozen project revision in a tenant video queue with state and fairness metadata |
| `preset_preview_requests` | Explicit tenant-owned Mage or SoulX preview work, lower priority than every eligible video and governed by the same per-account admission lock |
| `global_generation_capacity` | Singleton capacity lock/counter and durable fairness cursor |
| `provider_workload_leases` | Current admitted video or preset-preview slot; unique while active per account; no cross-account ceiling |
| `account_queue_heads` | Per-account eligible head and last-served/fairness state |
| `pipeline_tasks` | CPU, prompt, Mage, SoulX, and render tasks for an admitted revision |
| `hosted_cpu_job_attempts` / `hosted_cpu_job_events` | Provider-neutral ASR/render attempts, execution backend/bundle, deadlines, lifecycle, and append-only recovery truth |
| `media_worker_enrollments` / `media_worker_devices` | One-time PKCE browser pairing and account/workspace-owned installed-device identity, protocol/tool state, heartbeat, and revocation |
| `media_worker_input_objects` / `media_worker_leases` / `media_worker_events` | Exact attempt inputs, current device/nonce/expiry fence, and append-only claim/renew/cancel/result/recovery history |
| `serverless_attempts` | Logical lane attempt, exact endpoint/runtime/volume/GPU policy, provider job state, timings, and terminal result |
| `dispatch_outbox` | Persisted request token/hash and leased send/reconciliation state |
| `provider_assignments` | Post-assignment binding from one persisted dispatch token to one RunPod job ID |
| `artifact_reservations` | Exact tenant object keys, method, checksum/size/type bounds, expiry, and attempt ownership |
| `artifact_receipts` | Durable object validation and accepted application-signed provenance receipt |
| `cost_events` | Estimated, reserved, reported, possible-duplicate, settled, refunded, and fixed-cost-excluded amounts |
| `workflow_instances` | Cloudflare orchestration plus exact personal-worker/RunPod child attempts and recovery cursor |
| `actor_audit_events` | Append-only tenant actor/action/target/version/result trail |

Large media and provider payloads live in private R2, not Postgres. Postgres stores immutable object
keys, hashes, probes, manifests, bounded provider response facts, and canonical receipt hashes. Raw
signed URLs and secrets are never durable database fields.

## Project revision and creative bindings

A generation request references one immutable project revision. That revision pins:

- voiceover asset ID, SHA-256, probe, and duration;
- exact ready Avatar Profile version ID/source checksum;
- exact published Image Style version ID/profile hash;
- `extra_prompt_keywords` and explicit apply toggle;
- deterministic scheduler version, seed, timeline hash, and short SoulX span manifest;
- image and avatar runtime profile IDs and renderer crop profile IDs;
- FFmpeg renderer version, output settings, and estimated work counts.

Live endpoint IDs, provider job IDs, current GPU availability, and signed URLs are attempt state,
not creative revision fields. Regeneration that changes a creative binding creates a new revision.

The scheduler remains deterministic and provider-free. It selects only full avatar, full image, and
avatar-left/image-right split, targets the pinned Ranga cadence, and materializes short avatar audio
spans. Neither an LLM nor the SoulX worker chooses layout or timing.

## Fair queue and admission constraints

`generation_requests` is private to its account. States are:

```text
WAITING -> ADMITTED -> PREPARING -> DISPATCHING -> RUNNING -> RENDERING -> SUCCEEDED
                                      |              |            |-> FAILED
                                      +--------------+------------+-> CANCELLING -> CANCELLED
```

The active-state set is versioned in the schema and shared by every repository/admission query.

One serializable transaction locks `global_generation_capacity`, revalidates the candidate, and:

- enforces no active `provider_workload_lease` for the account;
- enforces different account owners for concurrent workload leases, without a global ceiling;
- chooses an eligible video account head using the durable fair cursor and deterministic tie-break;
  only when no video head is eligible may it choose a preview head using the separate preview cursor;
- changes only that request to `ADMITTED` and creates its workload lease;
- advances only the applicable fairness state;
- materializes exact task/outbox eligibility for the admitted request kind;
- appends audit and reservation records.

A partial unique index enforces at most one active video request per account. A unique active
`provider_workload_leases.account_id` constraint covers videos and previews together. The global
count is enforced under the singleton locked capacity row plus invariant checks; application
counting without a lock is invalid. Crash recovery recomputes active capacity from leases/requests
and reconciles before promoting more work.

FIFO is default inside one account. A user may reorder or cancel only their own `WAITING` rows with
optimistic version checks. Reordering changes only that account's order and cannot change the global
last-served cursor or move around another tenant's eligible turn. Queue reads never reveal other
tenants' identity, titles, inputs, outputs, positions, or costs.

`preset_preview_requests` use a parallel explicit state machine and the same locked capacity row.
The transaction enforces one active provider workload/account without a cross-account ceiling across both request kinds. It considers a preview only when no eligible video
head exists, then applies deterministic account rotation among preview heads. Preview waiting rows
perform no provider or hosted CPU work. Terminal release, cancellation, expiry, audit, cost, and
restart reconstruction obey the same atomic rules without changing the video fairness cursor.

## Serverless endpoint and attempt bindings

Each admitted video can have at most one current whole-video `mage_image` batch attempt and one
current whole-video `soulx_avatar` batch attempt at a time when those lanes have work. The SoulX
batch contains ordered, individually sliced/padded short-span audio only; it never contains the full
voiceover as one generation input. A bounded classified retry creates a new ordinal/token only after
the prior attempt is terminal or uniquely reconciled. Each attempt pins:

- account/workspace/project/revision/request/task IDs;
- lane and ordered item manifest;
- exact Serverless endpoint and template revision;
- immutable container digest;
- exact model source/weights/runtime/precision/settings;
- exact isolated 50 GB `EU-RO-1` volume ID and sealed manifest hash;
- mount `/runpod-volume` and runtime-read-only policy version;
- allowed GPU policy (`RTX 4090`, one GPU) and observed actual GPU;
- input/output artifact reservations;
- request TTL, execution timeout, `RUNPOD_INIT_TIMEOUT`, and deadline;
- rate observation, reservation, finite authority hash, and attempt number.

Mage attempts bind only the Mage volume/runtime. SoulX attempts bind only the SoulX volume/runtime.
Cross-lane, cross-volume, cross-tenant, cross-region, mutable-tag, unqualified-GPU, or manifest drift
fails before model load.

The old Pod worker envelope cannot cross the V2 firewall. The Serverless v3 envelope contains no Pod
create/delete instruction and no permission to prepare, repair, download, or alter a model volume.

## Two-phase external authority

### Predispatch authority

Before `/run`, the control plane persists an immutable predispatch authority and outbox row. It binds
the canonical v3 envelope hash, opaque `dispatch_token`, exact endpoint/runtime/artifacts, allowed
operation, deadline/timeouts, rate/cost reservation, and user/checkpoint authority. No network call
occurs before this commit.

### Post-assignment authority

After RunPod returns a job ID—or bounded reconciliation proves a unique assignment—the control plane
persists a `provider_assignment` joining that exact job ID to the predispatch token and attempt. Only
the current assignment may advance status or accept output. A callback or artifact arriving before
this binding is quarantined until reconciliation; it never grants itself authority.

A lost `/run` response becomes `DISPATCH_ACK_UNKNOWN`. The public API does not promise client
idempotency or exactly-once billing, so VideoForge does not blindly submit the same logical attempt
again. It records possible duplicate compute/cost and guarantees only at most one accepted output by
compare-and-swap on current assignment and artifact receipt.

## `serverless-worker-job-envelope/v3`

The envelope is canonicalized and signed by the TypeScript authority. Python validates the schema,
signature metadata, canonical hash, expiry, and semantic joins before any expensive action. Core
shape:

```json
{
  "schema": "serverless-worker-job-envelope/v3",
  "dispatch_token": "opaque-attempt-token",
  "tenant": {
    "account_id": "account_id",
    "workspace_id": "workspace_id"
  },
  "work": {
    "project_revision_id": "revision_id",
    "generation_request_id": "request_id",
    "task_id": "task_id",
    "attempt_id": "attempt_id",
    "lane": "mage_image",
    "items_manifest_sha256": "sha256:..."
  },
  "runtime": {
    "endpoint_profile_id": "mage-serverless-v1",
    "container_digest": "sha256:...",
    "model_manifest_sha256": "sha256:...",
    "volume_mount": "/runpod-volume",
    "gpu_allowlist": ["RTX 4090"]
  },
  "artifacts": {
    "input_manifest_sha256": "sha256:...",
    "output_prefix": "tenant/account_id/workspace/workspace_id/..."
  },
  "limits": {
    "expires_at": "UTC timestamp",
    "max_items": 1,
    "max_input_bytes": 1,
    "max_output_bytes": 1
  },
  "authority_sha256": "sha256:..."
}
```

Fixture numbers above are placeholders, not production limits. Actual profiles carry positive,
measured bounds. The envelope stores artifact reservation IDs or short-lived URL handles; logs and
receipts redact URL query strings.

## Worker execution and scratch

The handler validates before model initialization where possible, then verifies `/runpod-volume`,
loads the exact model offline, performs a real warm-up, downloads only its tenant-bound inputs, and
processes the ordered batch. Every attempt receives a unique job-local scratch directory outside the
model volume. Cache/config/temp environment variables point there. Scratch is never shared between
tenants or attempts and is removed after durable upload or bounded failure cleanup.

Item outputs upload only to pre-authorized tenant keys. The worker cannot list another tenant prefix,
choose a new output key, or use a broad application storage credential when an exact signed upload
can be used. All image/avatar outputs carry item-level SHA-256, media metadata, timings, and status.

## R2 layout and signed URLs

```text
tenant/{account_id}/workspace/{workspace_id}/
  project/{project_id}/revision/{revision_id}/
    input/voiceover/{asset_id}
    transcript/{transcript_id}.json
    timeline/{timeline_id}.json
    image/{scene_id}/attempt/{attempt_id}/output.png
    avatar/{span_id}/attempt/{attempt_id}/native.mp4
    render/{render_attempt_id}/final.mp4
    provenance/{manifest_id}.json
  avatar-profile/{profile_id}/version/{version_id}/...
  image-style/{style_id}/version/{version_id}/...

system/image-style/{style_id}/version/{version_id}/...
system/avatar-profile/{profile_id}/version/{version_id}/...
```

The server constructs keys from authorized records. Upload/download reservations bind one tenant,
method, exact key or bounded prefix, content type, maximum bytes, checksum when known, expiry, and
attempt. Signed URLs are short-lived and never returned for an unauthorized or unowned object. R2
list operations are server-side and prefix-bound. CDN/public buckets are forbidden for user media.

RunPod model volumes are absent from this tree. They contain only sealed lane model/runtime bytes;
they never become the durable source of voiceovers, avatars, images, results, or receipts.

## Provenance receipt and production manifest

The worker emits `serverless-provenance-receipt/v1`, signed with an application-controlled worker
key. It includes:

- dispatch token, provider job ID when available, attempt and tenant lineage;
- endpoint/template/container/model/volume manifest identifiers;
- actual GPU and runtime versions observed by the worker;
- pre/post model-manifest checks;
- input/output hashes and media probes;
- boot, model-ready, inference, upload, and total timings;
- item results, bounded failure, and scratch-cleanup state;
- monotonic receipt nonce and issued time.

The control plane verifies the signature, nonce, assignment, expected values, R2 objects, checksums,
and probes before acceptance. The signature proves only that the VideoForge worker key signed these
facts. It is not a RunPod attestation of GPU identity, billing, delivery uniqueness, or trusted
hardware.

`production-manifest/v3` joins the immutable creative revision, tenant assets, transcript/timeline,
prompt/style/avatar bindings, every accepted task/attempt/receipt, exact output hashes/probes,
settled/possible costs, renderer version, and final MP4. A manifest becomes final only after all
artifacts are durable and the database commit succeeds.

## Status, webhooks, and reconciliation

RunPod asynchronous result data expires after 30 minutes. The orchestrator polls exact job status and
persists normalized transitions. A webhook is only a latency hint: it is authenticated through
VideoForge's own opaque callback token, validated against assignment, and followed by status/artifact
reconciliation. Webhook delivery is never the sole completion proof.

Normalized attempt states are:

```text
PLANNED -> OUTBOXED -> DISPATCHING -> ASSIGNED -> IN_QUEUE -> IN_PROGRESS -> UPLOADING
                                                                  |-> RECONCILING
             -> SUCCEEDED | RETRYABLE_FAILED | PERMANENT_FAILED | CANCELLING | CANCELLED
```

Every transition is compare-and-swap, monotonic for the current attempt, and tenant-bound. Provider
status, worker receipt, artifact durability, and accepted application state remain separate facts.

## API surface

Every route derives account/workspace scope from the session and uses owner-scoped repositories. Ordinary Cloud follows VideoForge admission automatically (migration0249).
Representative V2 surface:

```text
POST   /v2/auth/invites/redeem
GET    /v2/session

GET    /v2/projects
POST   /v2/projects
GET    /v2/projects/{project_id}
POST   /v2/projects/{project_id}/revisions
POST   /v2/projects/{project_id}/generate
POST   /v2/projects/{project_id}/cancel

GET    /v2/queue
PATCH  /v2/queue/{generation_request_id}
DELETE /v2/queue/{generation_request_id}

GET    /v2/avatar-profiles
POST   /v2/avatar-profiles
DELETE /v2/avatar-profiles/{profile_id}
GET    /v2/image-styles
POST   /v2/image-styles
DELETE /v2/image-styles/{style_id}

POST   /v2/assets/upload-reservations
POST   /v2/assets/{asset_id}/complete
GET    /v2/assets/{asset_id}/download

GET    /v2/generation-requests/{generation_request_id}
GET    /v2/generation-requests/{generation_request_id}/events
POST   /v2/internal/runpod/status/{attempt_id}
POST   /v2/internal/runpod/webhook/{opaque_callback_token}
```

An ordinary user API exposes neither raw RunPod endpoint administration nor GPU/Pod start/stop
controls. Internal callbacks authenticate before body parsing where practical, impose strict body
limits, validate content type/schema/nonce/expiry, and reveal no tenant existence on failure.

All mutating client requests require authenticated session, origin/CSRF protection where applicable,
an idempotency key, and optimistic revision token. Generate freezes the current revision and appends
a private waiting request only after the original voiceover has a durable checksum-verified private
R2 receipt bound into that revision; it does not promise immediate provider dispatch.

## Personal CPU media workers

Whisper transcription and FFmpeg render/probe run on an account-owned Windows/macOS worker in
production. Enrollment, device, input-object, lease, and append-only event rows bind every claim to
the same account/workspace and exact attempt. A device token grants only heartbeat/claim/renew/
cancel/fresh-port/result capabilities; every late or stale result is fenced by the current lease.
The worker uses the same tenant artifact reservation/receipt rules, has no database, reusable R2,
RunPod, Runware, Google, admin credential, or model-volume mount, and cannot keep a GPU worker alive.

## Cost ownership

Every variable `cost_event` is owned by a project revision, image-style version, or avatar-profile
version and exact attempt. Store estimate, reservation, provider report, possible duplicate exposure,
settled amount, refund, rate source/time, and confidence. Never hide ambiguous dispatch cost or attach
one-time preset work to a fake video.

The two retained 50 GB volume charges are shared service-level fixed infrastructure facts reported
separately. They are not owned by an individual tenant account, are not assigned to an arbitrary
project, and do not become zero when endpoint workers reach zero.

## Retention and deletion

- User voiceovers, source avatars, style references, intermediates, and finals remain tenant-private
  and follow the approved retention policy. Deletion verifies ownership and reference safety.
- Removing a reusable Avatar or Image Style from its Hub archives the tenant-owned parent so it is
  unavailable to future project revisions while preserving immutable versions and media required by
  already-pinned revisions. System presets cannot be removed. Full source erasure is a separate
  retention action and must state when historical revisions will become non-regenerable.
- A source used by a queued/running revision cannot be removed. Later erasure may make historical
  revisions non-regenerable and must say so explicitly.
- Job scratch is ephemeral and removed after each attempt; it is never recovery state.
- Successful final videos remain durable until an explicit authenticated user Delete removes the
  exact owned R2 object. Download is never deletion and no automatic delete-after-download exists.
- Serverless workers scale to zero after demand, subject to provider reconciliation.
- The Mage and SoulX model volumes are retained until a separately authorized exact destructive
  operation. Ordinary completion, cancellation, worker cleanup, account deletion, or project
  retention never deletes or mutates them.

## Personal worker connect commands — 2026-09-26

Settings issues same-origin, authenticated commands through `POST /api/v2/media-worker/connect-command`.
Migration 0212 stores only a random 256-bit token hash and exact account/workspace, valid 15 minutes.
The public `.sh`/`.ps1` routes emit installer scripts with no-store headers. Enrollment presents the
one-time token in a header; command consumption and the existing device approval share one transaction.
PKCE credential retrieval, account ownership, revoked-device recovery, lease checks and manual
approval remain shared. Existing paired workers verify command ownership through `connect-check`
without replacing their credential. Installer tokens are deleted from private temporary files.
Scripts refuse to replace a running worker and never interrupt existing jobs.

## Optional media execution compatibility — 2026-09-28

Migration `0214_optional_runpod_media.sql` is additive: revision `media_execution_backend` defaults
to `PERSONAL_WORKER`; attempts may use a separate `RUNPOD_POD` backend; old `CLOUD_RUN` and personal
worker rows retain identity. Durable reservations/jobs and multipart authorities are tenant/attempt
scoped. Apply only exact migration214 after verifying the production ledger and source checksum;
never replay archived/omitted migrations or change historical migration bytes.

Hosted create/v2 and preflight/v1 accept optional exact `execution_backend` (`PERSONAL_WORKER` or
`RUNPOD_POD`). Omission retains Local; create/v1 remains unchanged. Selection participates in request
idempotency/conflict hashing. Revision_config/v2 and accepted immutable media/manifests stay unchanged.
Legacy render-disk-retry/v1 retains its strict Local payload with no backend field. Explicit Cloud
uses render-retry/v2 with exact `execution_backend=RUNPOD_POD` for a fresh bounded attempt. The UI
does not offer Cloud-to-Local retry until that separate recovery is implemented. Stale/replaced leases cannot claim, renew ports or promote outputs.

Cloud upload ports bind exact object, expected size and whole-object SHA256 to durable authority.
Multipart part ETags identify parts rather than prove the final checksum. Artifacts are verified
before receipt/terminal acceptance; uncertain upload/callbacks reconcile the same authority without
rerendering. See `cloud-media/RELEASE_RUNBOOK.md` for release and remaining qualification gates.

Cloud upload uses a conservative single-PUT object-body ceiling of5,363,466,240 bytes: R2 nominal5GiB
minus5MiB for included headers (official footnote4). The existing10GiB application artifact cap is
not a single-PUT/storage guarantee. Compatible Local files below that ceiling retain their current
upload behavior, including decimal5GB+ files; larger Cloud objects require scoped multipart.
[Cloudflare R2 limits](https://developers.cloudflare.com/r2/platform/limits/).

## Personal worker disk capacity — 2026-10-01

The existing v1 heartbeat accepts optional `available_disk_bytes`: a nonnegative safe integer
measured on the worker's temporary scratch filesystem, or null when unreported. Additive migration
0232 stores it on the same tenant-private device row and overwrites older observations on every
heartbeat. A heartbeat without telemetry clears capacity; an Online computer alone is not storage
readiness. Fresh qualified-device queries retain the existing 90-second bound. Local Create checks
2 GiB plus twice the selected voiceover bytes; Retry checks the immutable retained receipt. Claims
read exact input sizes before allocating leases, leaving insufficient-capacity attempts OUTBOXED.
The worker repeats its unchanged runtime disk check because other processes can consume storage
between observations. Cloud admission and budgets do not depend on Local disk capacity.

## Historical Seedance7% rollout (2026-10-03; superseded for fresh coverage below)

The original 7% rollout used resolved-render-manifest/v2 and render-job-input/v2 when motion clips exist. The retained IMAGE_FULL still is mandatory; optional VIDEO binds its exact segment, source image SHA, frame count and Seedance profile. Native H2641248x704 clips cover at most floor(total_frames*7/100), with original narration and timing retained. Version1 rejects VIDEO and preserves existing projects. Tenant-private hosted_video_plans/jobs pin selection and source/provider identities before submission; native ready and materialization gates independently verify accepted VIDEO_CLIP assets/receipts. See DEC_VIDEO_GENERATION_001 and tasks/SEEDANCE_VIDEO_PLAN.md.

Optional Seedance fallback (0244): only allowlisted definite, bounded failures retain their pinned original accepted IMAGE/live receipt, with paid identity and actual charge unchanged. Missing/tombstoned sources, unknown submissions, invalid costs, cancellation and price changes cannot satisfy readiness. Mixed manifests bind the exact SUCCEEDED clip subset and original images; all-static fallback uses version1 with no fake VIDEO asset. Safe final failure uses the existing RENDERING/lease barrier. Canonical replay preserves saved selections; null opted-in selections complete with padded requests, while legacy revisions never opt in.


## Historical whole scene coverage control (2026-10-03)

Published hosted create/v3 and preflight/v2 carry validated integer video_coverage_percent. Migration248 pins coverage plus WHOLE_SCENE_V2 replacement policy in the per-revision video-plan record; old rows retain immutable LEGACY_PREFIX_V1 7% semantics and successors copy exact values. Manifest/render input v3 carries whole-scene policy and immutable selection hash even for Off/all-fallback; v1/v2 remain readable for legacy work. SQL, TypeScript and Python independently verify full-scene equality and the pinned percentage budget. Production role/RLS/tenant and replay checks pass. Fresh paid-film acceptance remains separate. Details: [combined plan](tasks/SEEDANCE_VIDEO_PLAN.md#whole-scene-replacement-follow-up).

## Private voiceover preparation contracts — 2026-10-04

Migration0250 adds hosted_voiceover_jobs and saved_voiceover_voices with forced tenant RLS, scoped security-definer functions and metadata backup/restore inventory. Runtime functions check account principal; each statement binds the authenticated account in its local SQL scope. Immutable job UUID/request hash/script/voice/filename precede submission. States are SUBMITTING, PROCESSING, COMPLETED, FAILED and UNKNOWN_NO_RETRY. Provider identity cannot change, terminal results cannot reopen and changed request bytes cannot reuse a UUID.

/api/v2/voiceovers/voices lists permitted voices and private saved/starred state. POST /voices/{voice_id} saves preferences. GET /voices/{voice_id}/preview proxies a validated provider preview. POST /import accepts one ElevenLabs voice_id. POST /jobs accepts exact id, script (1–100000 characters), voice_id and safe .mp3 filename; GET /jobs returns latest own job, GET /jobs/{id} observes exact own job and GET /jobs/{id}/audio downloads completed own audio. Foreign IDs return404. Browser mutations require same origin and admitted authentication/rate limits. Provider credentials and IDs are excluded from public job responses; provider download URLs never choose the credential destination.


Migration0253 adds tenant-private `hosted_script_projects`. POST `/api/v2/hosted/script-projects` accepts `videoforge-hosted-script-project/v1`, exact project options, script and voice ID with an idempotency key. It saves a real project before a media revision; Queue and detail expose narration state without inventing an audio asset. A project-scoped Workflow and shared driver claim TTS under an account-specific narration guard independent of video admission. Saved provider identity is retrieval-only after uncertainty. Streaming MP3 measurement, private R2 persistence, the existing revision/upload receipt commit and deterministic ASR submission complete the handoff. Direct-audio create/v3 remains unchanged. Queued deletion cancels intake under the project lock; generating/preparing/uncertain work cannot be archived. Rollback preserves accepted intakes and requires draining them before returning to an older application reader.

Migration0254 grants runtime INSERT on the existing forced-RLS `project_inputs` table so the original script accompanies its generated-audio revision. Existing tenant guards and composite keys remain; no SELECT, UPDATE or DELETE permission is added. Production acceptance exposed the missing historical privilege, and native rollback plus runtime own/foreign-account insertion checks cover the correction.

## Mandatory opening contract — 2026-10-04

Fresh revisions pin scheduler-v8/v9 and OPENING_180_V3 without rewriting existing policies,
selections or paid identities. Hosted create/v3 and preflight/v2 retain the same integer
video_coverage_percent field; only the new pinned policy interprets it against duration after
180 seconds. Catalog and estimates expose required_opening_seconds separately. Generation work
manifest/v2 pins scheduler_version and permits zero avatar spans/counts only for V8/V9; historical
v1 keeps its positive-avatar checks. Native rendering consumes the already qualified v3 resolved
manifest: server-owned opening selection/readiness/materialization gates require every opening
scene's successful full clip and translate only the effective overall renderer ceiling. Never
interpret that derived ceiling as the user's remaining coverage choice. Legacy v1/v2/v3 readers,
receipts and immutable outputs remain. Primary budget and fallback rules live in the scheduler
domain; additive migration0267 and its production readback are tracked in CURRENT_STATE.yaml.

Prompt binding/Retry contract: see `PROMPT_PLAN_BINDING_PLAN.md` (2026-10-07).
