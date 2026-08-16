# Data and API contracts

Status: VideoForge V2 target contract; additive implementation remains checkpointed
Read when: changing persistence, tenant isolation, queue admission, Serverless dispatch, artifacts,
attempt lineage, APIs, callbacks, or production manifests.

## Current machine-contract boundary

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

System presets are the only cross-tenant catalog data. They use explicit `scope_kind=SYSTEM`, contain
no user media, and are read-only to ordinary accounts. User-created Avatar Profiles and Image Styles
use `scope_kind=WORKSPACE` and cannot be discovered, selected, mutated, or referenced by another
account.

Invite-only authentication remains. A unique single-use invite is bound to the intended verified
email and redeemed atomically. Authentication is not sufficient by itself: every read, write,
signed-URL issue, queue mutation, callback acceptance, and download also passes ownership checks.

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
| `preset_preview_requests` | Explicit tenant-owned Mage or SoulX preview work, lower priority than every eligible video and governed by the same two-slot/per-account admission lock |
| `global_generation_capacity` | Singleton capacity lock/counter and durable fairness cursor |
| `provider_workload_leases` | Current admitted video or preset-preview slot; unique while active per account and bounded to two different accounts globally |
| `account_queue_heads` | Per-account eligible head and last-served/fairness state |
| `pipeline_tasks` | CPU, prompt, Mage, SoulX, and render tasks for an admitted revision |
| `serverless_attempts` | Logical lane attempt, exact endpoint/runtime/volume/GPU policy, provider job state, timings, and terminal result |
| `dispatch_outbox` | Persisted request token/hash and leased send/reconciliation state |
| `provider_assignments` | Post-assignment binding from one persisted dispatch token to one RunPod job ID |
| `artifact_reservations` | Exact tenant object keys, method, checksum/size/type bounds, expiry, and attempt ownership |
| `artifact_receipts` | Durable object validation and accepted application-signed provenance receipt |
| `cost_events` | Estimated, reserved, reported, possible-duplicate, settled, refunded, and fixed-cost-excluded amounts |
| `workflow_instances` | Cloudflare orchestration plus exact Cloud Run/RunPod child attempts and recovery cursor |
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
- enforces fewer than two workload leases globally and different account owners;
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
The transaction enforces one active provider workload/account and two workloads globally from
different accounts across both request kinds. It considers a preview only when no eligible video
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

Every route derives account/workspace scope from the session and uses owner-scoped repositories.
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
GET    /v2/image-styles
POST   /v2/image-styles

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

## Cloud Run CPU jobs

Whisper transcription and FFmpeg render/probe remain scale-to-zero Cloud Run Jobs in production.
They use the same tenant artifact reservation/receipt rules, have no RunPod credential or model-volume
mount, and cannot keep a GPU worker alive. Local Mac execution is development parity only.

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
- A source used by a queued/running revision cannot be removed. Later erasure may make historical
  revisions non-regenerable and must say so explicitly.
- Job scratch is ephemeral and removed after each attempt; it is never recovery state.
- Serverless workers scale to zero after demand, subject to provider reconciliation.
- The Mage and SoulX model volumes are retained until a separately authorized exact destructive
  operation. Ordinary completion, cancellation, worker cleanup, account deletion, or project
  retention never deletes or mutates them.
