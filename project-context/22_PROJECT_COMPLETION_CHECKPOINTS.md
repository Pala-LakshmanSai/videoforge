# VideoForge v2 production checkpoints

Status: authoritative replacement roadmap from the exact 2026-08-15 repository state

Only `V2-00` through `V2-13` are active. Only their briefs belong in the working tree; Git history
records removed planning files. Retain repository evidence only when an active foundation, gate,
artifact identity, cost fact, or audit depends on it.

## Production destination

VideoForge is a private, production-hosted video factory for 5–10 invited people. In V2, one login
maps to one account and one default workspace; team/shared-workspace membership is deferred. Up to
two different accounts may produce one video each concurrently. A second project from the same
account waits in a durable fair queue. Users see only their own projects, presets, source media,
jobs, costs, and outputs; globally supplied built-in presets remain readable by all admitted users.

Ordinary production has no manual GPU or Pod controls. It uses two independent queue-based RunPod
Serverless endpoints in `EU-RO-1`:

| Lane | Exact retained model | Endpoint target |
|---|---|---|
| Images | Mage-Flow INT8 ConvRot on its existing sealed 50 GB Mage-only volume | Flex workers `0–2`, one NVIDIA GeForce RTX 4090 per worker |
| Avatar | SoulX-FlashHead Pro BF16 on its existing sealed 50 GB SoulX-only volume | Flex workers `0–2`, one NVIDIA GeForce RTX 4090 per worker |

The application controls fair admission and dispatch; RunPod controls worker creation and
scale-down. Each lane starts with one resumable complete-batch attempt for a video. A bounded
classified replacement may use a new attempt/token only after the prior attempt is terminal or
uniquely reconciled, and carries every unresolved item as one batch; accepted items are not
regenerated and the controller does not create parallel per-scene provider jobs.
The two model volumes are runtime-read-only application data, mount only at `/runpod-volume`, never
cross-mount, and never hold mutable user media. Inputs and outputs use tenant-isolated private object
storage; each worker uses job-keyed local scratch and erases it on every terminal path.

The output remains deterministic: full avatar, full image, or avatar-left/image-right split; hard
cuts only; subtle centered image zoom; no captions, titles, overlays, borders, motion graphics, or
decorative transitions. The current `$1.00` representative 30-minute variable-cost target and
`$2.00` hard ceiling remain. The two retained-volume charges are fixed infrastructure reported
separately.

As of this reset, RunPod's public Flex planning rates are approximately `$1.10/hour` for RTX 4090
and `$1.58/hour` for RTX 5090; Serverless bills worker initialization, execution, and idle seconds.
Two 50 GB network volumes are `$7/month` combined at `$0.07/GB/month`, even with zero workers.
Rates and inventory must be refreshed read-only before every paid activation. With both lanes at
max `2`, the all-4090 instantaneous ceiling is four workers or about `$4.40/hour`; a future fully
qualified all-5090 configuration would be about `$6.32/hour`, not a mixed-fallback `$5.36/hour`.

## Exact current state

### Done and reusable

- **UI foundation:** the compact application shell, Avatar Hub, Image Styles Hub, Create Project,
  queue/progress/review/download surfaces, responsive layouts, and installed-Chrome fixture journeys
  are implemented and green. Preserve the visual system; change tenancy truth and live statuses,
  not the product's design language.
- **Database foundation:** additive PostgreSQL migrations, repository contracts, recovery ledgers,
  deterministic timing, immutable revisions, preset pinning, and PGlite network-free tests exist.
- **Invite foundation:** provider-free unique email-bound invite redemption, verified identity
  binding, race rejection, and admission tests exist. Production Better Auth/Neon deployment does
  not.
- **Word transcript:** pinned `whisper.cpp 1.8.4 base.en`, exact media normalization, 30-minute
  chunk/reconciliation, word timestamps, durable receipts, replay, restart recovery, and the shared
  local/container entrypoint are implemented.
- **Ranga scheduler:** `scheduler-v2` already produces the three exact compositions, word-boundary
  spans, deterministic variation, 21–22% avatar coverage, near-even full/split duration, selected
  span audio, prompt batches, generation manifests, and render manifests. The 30-minute fixture is
  close to the references: 21.05% avatar, 3.433 appearances/minute, 3.679-second mean avatar span,
  and a 2.7-second full/split difference. Do not rebuild it.
- **Prompt/style path:** qualified Runware DeepSeek prompt writing, qualified one-time Gemini style
  analysis, deterministic prompt compilation, immutable Image Style versions, and the built-in
  `documentary_stock_v1` profile exist.
- **Mage model lane:** exact Mage-Flow INT8 ConvRot bytes are sealed on the retained 50 GB
  `EU-RO-1` Mage volume. The immutable worker image and RTX 4090 Pod runtime were qualified with
  eight owned 1280×720 images, offline manifest verification, real warm-up, timings, hashes, cost,
  and zero-compute cleanup.
- **SoulX model lane:** exact SoulX-FlashHead Pro BF16 bytes are sealed on the separate retained
  50 GB `EU-RO-1` SoulX volume. The immutable worker image and RTX 4090 Pod runtime were technically
  qualified offline with native/full/split owned samples, timings, hashes, cost, and zero-compute
  cleanup. Production Avatar Profile visual/crop acceptance and first-party commercial-use terms
  evidence remain open gates.
- **Renderer:** deterministic direct FFmpeg/FFprobe assembly, exact duration/frame contracts,
  hard-cut grammar, image zoom, Chrome-compatible MP4, download, and local parity exist.
- **Fixture orchestration:** complete provider-free single-session orchestration, recovery,
  cancellation, durable barriers, cost accounting, playback, and negative dispatch tests exist.
- **Resource truth at this reset:** zero Pods, endpoints, templates, and active workers were last
  independently proven; exactly the two intended 50 GB model volumes remain. Refresh before any
  provider activation.

### Incomplete or unproven

- Tenant ownership is not the active architecture. Current global catalogs and equal-rights access
  must become account/workspace-private with database-enforced authorization.
- The active queue is one global session with one video. It does not implement one active video per
  account, two global active slots, or fair rotation between accounts.
- Current dispatch authority binds a Pod before work. Serverless requires pre-dispatch endpoint
  authority, a persisted post-assignment binding to the exact provider job ID, and a separate
  VideoForge-signed provenance receipt for observed runtime/output facts; RunPod does not provide a
  documented hardware-attestation guarantee.
- Mage and SoulX images are Pod/API services, not production Serverless queue handlers. Mage still
  has active `/workspace` assumptions; both need exact `/runpod-volume` compatibility and job-local
  scratch/output behavior.
- No immutable Mage or SoulX Serverless image/endpoint is published or qualified. RTX 5090 is not an
  allowed fallback until each exact runtime passes separate compatibility and economics evidence.
- Production Cloudflare hosting, Better Auth integration, Neon persistence, private R2, signed URLs,
  Cloud Run ASR/render Jobs, secrets, callbacks, and observability are not deployed end to end.
- No automatic real video has completed through the hosted multi-tenant system.
- No two-user live Serverless concurrency, fair queue, worker death, duplicate delivery, timeout,
  response-loss, cancellation, or zero-worker-after-drain proof exists.
- The full Mage quality/style suite, SoulX Avatar Profile suite, production-length Ranga review, and
  representative all-in cost/SLO sample are still open.
- Production security, backup/restore, incident response, alerts, quotas, release rollback, and
  operator runbooks are incomplete.

### Active architecture that must be superseded or quarantined

- `generation_sessions.singleton_key='GLOBAL'`, one-active global queue constraints, inherited GPU
  pairs, session GPU selectors/revalidations, lane warm-retention demand, and manual queue reorder by
  unrelated users.
- `pod_lifecycle_attempts`, Pod create/delete events, exact Pod-bound job envelopes, manual Pod
  controller routes, and UI Start/Stop/GPU-selection semantics in ordinary production.
- Global user-created Avatar/Image Style/project/result catalogs and query paths that treat creator
  identity as audit-only metadata.
- Active lane/model names that do not identify the exact SoulX runtime.
- Mage `/workspace` volume paths and any mutable model-volume scratch/cache writes.
- Any superseded endpoint, automatic-GPU route, inactive runtime, repair/fallback route, or obsolete
  image. These remain unreachable from ordinary production.

Add new migrations/contracts and prove cutover. Never rewrite committed migrations. Keep only the
evidence required by active foundations and gates.

## Locked Ranga similarity contract

Two complete pinned references establish the edit target:

- 21.63–21.76% total avatar time.
- Approximately equal full and split avatar time.
- 3.742–3.745-second mean avatar appearance; normal range 2–6 seconds.
- About 3.47 avatar appearances/minute and 10–13-second median non-avatar gaps.
- Full avatar at frame zero; first literal full evidence around 3–6 seconds; first split by 18
  seconds.
- Nearly strict full/split alternation, clean 50/50 seam, speaker left, physical evidence right.
- Mean visual-change interval target 4.0–4.8 seconds.
- Literal evidence progression: environment, person/action, hands, object, macro detail, result.
- Hard cuts; no border, captions, branding, graphic callouts, title cards, or decorative effects.

Deterministic checks enforce geometry/cadence. Human review scores literal relevance and visual
quality: `2=direct exact evidence`, `1=relevant context`, `0=generic/unrelated`. Qualification
targets mean `>=1.8`, no zero in the opening minute or critical instructional claims, and zero
accepted pseudo-text/logo/anatomy/style defects. Per-avatar crops require exact profile evidence and
user approval; no universal crop is silently imposed.

Ranga uses real moving footage while VideoForge currently uses AI stills with slow zoom. VideoForge
can closely match composition, cadence, evidence choice, and documentary appearance, but cannot
claim identical natural camera/subject motion. A separate later experiment—not hidden scope—would
be required to add stock or generated B-roll video.

## Dependency map

```text
V2-00 roadmap reset
  -> V2-01 tenant-private identity and data cutover
  -> V2-02 tenant-private artifacts, signed transfer, and scratch
  -> V2-03 fair two-slot admission and queue
  -> V2-04 Serverless v3 authority, transport, outbox, and recovery contracts
  -> V2-05 provider-free runtime cutover, UI truth, and firewall
  -> V2-06 hosted staging foundation and CPU media jobs
  -> V2-07 Mage Serverless lane on the existing Mage volume
  -> V2-08 SoulX Serverless lane on the existing SoulX volume
  -> V2-09 one short real integrated hosted project
  -> V2-10 one real 3–5-minute Ranga-style automatic video
  -> V2-11 two-user concurrency, autoscaling, and recovery proof
  -> V2-12 production-length quality, speed, and economics qualification
  -> V2-13 security hardening, production release, and operating proof
```

Do not implement around an incomplete predecessor. V2-07 and V2-08 have disjoint worker code after
V2-05, but checkpoint promotion remains serial so shared contracts and paid authority cannot drift.

## V2-00 — Architecture, reference, and roadmap reset

**Outcome:** Every active planning source describes the same tenant-private, two-slot,
scale-to-zero Serverless destination and the entirely new checkpoint sequence.

- Keep only V2 task briefs in `project-context/tasks/`; Git history records removed planning files.
- Remove dangling references to removed briefs/checkpoints/profiles from active context, selectors,
  validators, and source indexes. Keep evidence only when an active foundation, gate, artifact
  identity, cost fact, or audit depends on it.
- Supersede the global-data, one-session, manual-compute, and Pod-bound dispatch decisions.
- Replace the checkpoint and prompt packs, selectors, implementation plan, acceptance routing,
  cost/operations summaries, and current handoff.
- Pin official Serverless sources and Ranga metrics; leave changing prices/availability as fresh
  activation-time checks.

**Proof:** context/schema validation; a contradiction/dangling-reference scan proving only V2 task
briefs remain and no obsolete checkpoint selector or validator branch is active; clean commit;
copy-ready prompts; and an independent read-only audit.

**Authority:** local planning/context only; `$0`; no credentials or provider mutation.

## V2-01 — Tenant-private identity and data cutover

**Outcome:** Every normal user can access only their account/workspace data; built-in defaults are
the only globally readable product records.

- Add immutable `account_id` and `workspace_id` ownership to projects, revisions, assets, Avatar
  Profiles/versions, Image Styles/versions, queue jobs, attempts, outputs, costs, approvals, and
  audits. Backfill pre-V2 rows into an explicit legacy/system scope without granting users
  cross-tenant access.
- Add database constraints and RLS-equivalent/query-guard enforcement. Every repository method
  requires a trusted principal; no client-supplied owner field grants access.
- Keep invite-only Better Auth semantics, but bind admission to exactly one account/workspace.
- Change user-created Avatar and Image Style Hubs to tenant-private. Built-in default records use an
  explicit immutable global scope.
- Change project/result/settings routes, searches, signed-URL requests, audit reads, and UI fixtures
  to tenant scope.

**Proof:** fresh/upgrade/restore migrations; two-account read/write/delete/hash-existence negative
matrix; forged-ID and stale-session tests; installed Chrome showing separate libraries; zero
provider calls.

**Stop:** any route or query can observe another tenant's metadata, object existence, cost, status,
or URL.

## V2-02 — Tenant-private artifacts, signed transfer, and scratch

**Outcome:** voiceovers, source portraits, generated assets, lane receipts, previews, and final MP4s
have one tenant-owned private-storage contract before any production service is connected.

- Reuse the existing workspace-prefixed private-artifact routes and two-account negative tests;
  promote them into the active V2 repository/port boundary instead of creating a second upload path.
- Define opaque tenant/workspace/project/revision object keys, immutable content hashes, MIME and
  byte limits, retention state, and ownership rows. Object-key possession never grants access.
- Issue short-lived URLs scoped to one object key, method, content type, byte range, checksum, and
  principal. Never persist query signatures or reveal cross-tenant object existence.
- Make direct multipart upload, worker input download, worker output upload, final download,
  expiry/revocation, retry, and orphan cleanup deterministic and auditable.
- Define lane-local job scratch and cache variables. Mutable tenant bytes never touch either model
  volume; terminal cleanup runs for success, failure, cancel, timeout, and worker refresh.
- Keep the storage adapter provider-free in this checkpoint. Real private R2 composition belongs to
  V2-06 and cannot be inferred from passing port tests.

**Proof:** fresh/upgrade/restore schemas; two-account upload/download/delete/existence matrix;
forged key/URL/method/MIME/size/hash/expiry tests; interrupted multipart and orphan recovery;
scratch cleanup tests; zero provider calls.

## V2-03 — Fair two-slot admission, queue, and concurrency locks

**Outcome:** up to two different accounts produce concurrently; each account has at most one active
provider workload, which preserves at most one active video/account and two active videos globally,
with a durable fair queue for later work.

- Replace the singleton global session and manually ordered shared queue with account-owned queue
  entries, a database-enforced per-account active-job lock, and a global two-slot capacity lease.
- Use deterministic round-robin/fair rotation across accounts. One account's waiting entries cannot
  occupy both global slots. A user may cancel or reorder only their own waiting entries; this never
  changes the account-level fair rotation or another account's order.
- Represent explicit Mage/SoulX `preset_preview` work as tenant-owned lower-priority requests using
  the same account lock and two slots. A preview is eligible only when no video head is eligible and
  never changes the video fairness cursor.
- Make promotion, cancellation, terminal release, retry ownership, and slot reclamation atomic and
  restart-safe. Waiting work performs no provider action before admission.
- Remove ordinary GPU selectors and Pod Start/Stop/Delete controls. Endpoint configuration is an
  operator-owned immutable deployment choice, not a per-project user decision.
- Preserve the existing UI design while showing private queued/active jobs and factual stages.

**Proof:** high-contention PGlite/Postgres race tests, crash/restart reconstruction, fairness across
5–10 accounts, same-account double-submit rejection, two-account concurrent activation, no third
slot, preview/video priority and capacity cases, cancellation/release, and two-user Chrome journeys
at `$0`.

## V2-04 — Serverless v3 authority, transport, outbox, and recovery

**Outcome:** provider-free contracts safely connect a tenant-owned admitted video to two
queue-based Serverless lane jobs without knowing the eventual worker identity in advance.

- Define immutable endpoint deployment records: endpoint identity/hash, endpoint-configuration
  hash, exact worker-image digest, allowed GPU list, `EU-RO-1`, one exact lane volume/manifest,
  min/max workers, scaler, handler concurrency, idle/init/execution timeout, TTL, and version.
- Implement two-phase authority. Pre-dispatch binds tenant, revision, lane batch, endpoint/config,
  runtime/volume, payload hash, deadline, and spend ceiling. After RunPod returns a job ID—or bounded
  reconciliation proves one unique assignment—persist a `provider_assignment` joining that job ID to
  the predispatch token and attempt before status/output acceptance. A separate signed VideoForge
  provenance receipt records worker ID when exposed, runtime GPU/driver/CUDA probes, intended
  volume/manifest, model-ready evidence, timings, and output hashes. Do not call this provider
  hardware attestation; RunPod does not document that guarantee.
- Replace Pod envelopes/events with Serverless request/attempt/output contracts. Quarantine
  superseded schemas behind read-only compatibility tests; they cannot authorize v3 dispatch.
- Enforce checkpoint-generic V2 read-only/paid authority validation while retaining strict
  non-transferable operations/resources/rates/caps.
- Persist a transactional outbox and unique dispatch token before `/run`. RunPod creates the job ID
  and documents no client idempotency key or exactly-once billing guarantee. Enforce at most one
  accepted output per token; bound, expose, reconcile, and charge any duplicate compute to an
  incident budget. Never blindly resubmit after an unknown acknowledgement.
- Start each video/lane with one resumable complete-batch attempt. A bounded classified replacement
  uses a new token only after the prior attempt is terminal or uniquely reconciled and carries all
  unresolved items as one batch. Poll `/status` until the durable signed receipt and output are
  stored; the provider's approximately 30-minute async-result window and limited webhook retry are
  not durability truth.
- Implement private R2 port contracts with short-lived tenant/path/method/content-length scoped
  URLs. Never send broad bucket credentials to clients or store inputs/results on model volumes.
- Use `/runpod-volume` only for sealed model reads and job-keyed local scratch for mutable files;
  erase scratch on success, failure, cancellation, timeout, and worker refresh.
- Add fake `/run`, `/status`, `/cancel`, progress, webhook/replay, duplicate delivery, unknown
  acknowledgement, timeout, TTL expiry, and worker-death transport tests. Ordinary application code
  must never call endpoint-wide `/purge-queue`.
- Measure lane-specific init/execution/TTL envelopes: provider TTL begins at submission and covers
  provider queue, cold start, handler execution, and its output upload; it does not cover control-plane
  reconciliation. Set a separate bounded reconciliation deadline inside the approximately 30-minute
  async-result window. Treat SoulX's measured 672-second bounded-worker start-to-ready observation
  as a warning, not a Serverless timeout value.

**Proof:** schemas, migrations, TypeScript/Python parity, adversarial ownership/authority tests,
durable replay, cost conservation, zero provider calls, and canonical verification.

## V2-05 — Provider-free Serverless cutover, UI truth, and runtime firewall

**Outcome:** every application path uses the tenant/fair-queue/Serverless-v3 contracts with fake
transport; ordinary production can no longer reach the global-session or manual-Pod runtime.

- Add migrations and adapters that supersede the committed `generation_sessions`, global queue,
  Pod-lifecycle, Pod-bound envelope, and GPU-pair contracts without rewriting committed migrations.
- Compose V2 tenant repositories, private artifacts, admission/outbox, lane orchestration, signed
  receipts, cost reservations, recovery, and fake Mage/SoulX handlers end to end.
- Preserve the approved UI design while removing Start/Stop/Delete Pod and per-project GPU choices.
  Show private factual queue/stage/retry/cancel/cost state only.
- Extend the active-runtime and dispatch firewalls so production builds reject superseded global-
  session routes, Pod creation/controllers, `/workspace` model mounts, inactive-runtime/fallback
  aliases, broad R2 keys, and unadmitted Serverless dispatch.
- Prove worker/job isolation, accepted-unit resume, unknown-ack reconciliation, cancellation, process
  restart, and two tenant projects at every provider-free barrier.

**Proof:** canonical contracts and migration tests, provider-free full journeys, adversarial runtime
firewall, installed-Chrome two-account acceptance, no legacy production dispatch, and zero provider
calls.

## V2-06 — Hosted staging foundation and CPU media jobs

**Outcome:** a private staging application runs independently of the user's Mac with production
auth, tenant database/storage, durable orchestration, word transcription, and FFmpeg rendering.

- Deploy the existing app/API to the selected Cloudflare environment, Better Auth with email and
  Google plus atomic invite admission, Neon PostgreSQL, and private R2.
- Apply the V2 migrations and tenant query boundary. Use environment-scoped secrets and least
  privilege.
- Deploy the pinned `whisper.cpp` and FFmpeg/FFprobe containers as scale-to-zero Cloud Run Jobs.
  Prove the same contract/hash behavior as local parity.
- Implement durable callback/poll reconciliation, signed artifact exchange, stage checkpoints,
  cancellation, expiry, retention, and restart recovery.
- Keep GPU transport fake/disabled in staging until V2-07/V2-08 activation.

**Proof:** two real invited accounts with isolated data and objects, production-auth negative suite,
real hosted ASR/render of owned fixtures, restart/replay, no Mac dependency, infrastructure cost
evidence, and real Chrome staging acceptance.

**Authority:** provider-free work first; stop once before any hosting mutation or paid service use
with one exact bounded activation proposal.

## V2-07 — Mage Serverless lane on the existing volume

**Outcome:** the exact qualified Mage runtime processes a complete video image batch through one
scale-to-zero queue endpoint using the existing sealed Mage volume.

- Convert the existing runtime into a queue handler; do not download, rebuild, or mutate model
  bytes. Replace `/workspace` model paths with exact `/runpod-volume` paths.
- Verify the sealed manifest before model load, perform real warm-up during worker initialization,
  keep runtime model files read-only by application policy, and use local job scratch only.
- Consume the exact V2 lane-batch envelope, download private inputs by scoped URL, resume accepted
  units, generate all required images, upload each durable output with metadata/hash, and emit the
  signed VideoForge provenance receipt for the complete batch.
- Publish one immutable Serverless worker image. Create one queue endpoint restricted to
  `EU-RO-1`, the exact Mage volume, one GPU/worker, RTX 4090 only initially, min workers `0`,
  request-count scaler `1`, and handler concurrency `1`. Qualify at max workers `1`, then apply the
  separately hashed max `2` configuration only for the bounded concurrent-reader proof.
- Measure safe init/execution/TTL/idle settings and FlashBoot behavior. Qualify cold/warm starts,
  two simultaneous workers reading the same volume, manifest hashes before/after, timeout/cancel/
  duplicate delivery, output durability, scale-down to zero, and current Flex cost.

**Proof:** exact image/endpoint/config/volume/manifest identities, 1280×720 samples and one realistic
batch, hashes/probes, init/load/warm/inference/upload timings, peak VRAM, settled cost, two-worker
read-only concurrency, zero endpoint jobs and zero total workers (`Active + Flex`) after drain,
unchanged two-volume inventory, and the continuing fixed storage charge reported separately.

**Authority:** local work/read-only inventory first; one combined proposal before publication,
endpoint mutation, GPU use, or spend. RTX 5090 remains forbidden until separately qualified.

## V2-08 — SoulX Serverless lane on the existing volume

**Outcome:** the exact qualified SoulX-FlashHead Pro runtime processes all selected avatar spans for
one video through one scale-to-zero queue endpoint using the existing sealed SoulX volume.

- Wrap the current exact Pro BF16 runtime as a queue handler; no model download, volume mutation,
  repair, enhancement, fallback, or substitution.
- Verify `/runpod-volume`, sealed manifest, real load/compile warm-up, one-worker concurrency, exact
  short-span padding/trim/output contracts, job-isolated scratch, and complete lane batching.
- Upload every native clip durably and return exact trim/crop/profile plus worker/GPU/timing/output
  lineage in the signed VideoForge provenance receipt before the batch is accepted.
- Resolve and record first-party code/weights access, commercial-use, redistribution, and container
  publication terms before calling the runtime production-cleared. Do not silently inherit Mage's
  separately accepted terms risk.
- Publish one immutable Serverless image and create one queue endpoint with the same staged
  `EU-RO-1`, one GPU, RTX 4090-only, min `0`, max `1` then max `2`, request-count `1`, and handler
  concurrency `1` policy as Mage, using only the SoulX volume.
- Qualify cold/warm start, two simultaneous read-only workers, span resume, cancellation, timeout,
  duplicate delivery, 2/4/6/10-second samples, scale-down, and current Flex cost.

**Proof:** playable native/full/split clips, hashes/ffprobe/A-V duration, exact endpoint/image/
manifest/volume identity, cold/warm/init/load/compile/inference/upload timings, VRAM, settled cost,
zero endpoint jobs and zero total workers (`Active + Flex`) after drain, and user approval of each
Avatar Profile's full/split composition before
activation.

## V2-09 — Integrated multi-tenant production pipeline

**Outcome:** one owned short project proves the hosted app can automatically carry an admitted
private voiceover to a durable reviewable MP4 through the exact live pipeline before longer or
concurrent paid runs.

- Connect production auth, tenant repositories, fair admission, private R2, ASR, existing
  transcript, existing `scheduler-v2`, DeepSeek prompt batches, Mage lane batch, SoulX lane batch,
  asset barrier, FFmpeg render, QA, review, approval, and download.
- Start CPU preparation immediately after admission. Dispatch each GPU lane only when its exact
  work manifest and pre-dispatch authority are durable.
- Run Mage and SoulX concurrently for this one video while keeping tenant/revision lineage exact.
  The global two-slot contracts remain enabled, but live two-user load belongs to V2-11.
- Persist truthful progress: queued, waiting for GPU, worker starting, model loading, generating
  images/avatar, rendering, completed/failed. Provider state is not durability truth.
- Preserve successful units across retries; never regenerate accepted images/clips after unrelated
  failure.
- Remove live ordinary-production access to manual Pod controllers and superseded global-session
  paths; quarantine compatibility fixtures from production imports and dispatch.

**Proof:** provider-free two-tenant full journeys first, then one bounded 30–90-second real hosted
project, exact manifests/cost ledger/recovery, real Chrome playback/download, no cross-tenant
visibility, and zero endpoint jobs plus zero total workers (`Active + Flex`) after drain. Endpoint
configurations and two retained volumes may remain; their fixed charges are stated separately.

## V2-10 — One real automatic Ranga-style video

**Outcome:** one owned 3–5-minute project completes without operator intervention and passes cut-by-
cut Ranga-style and technical review.

- Use a real final voiceover, ready tenant-owned Avatar Profile, and published Image Style.
- Review every cut and asset for literal relevance, documentary realism, crop, lips/head/background,
  pacing, image zoom, exact A/V, and prohibited graphics.
- Enforce the deterministic and statistical Ranga metrics, including opening rhythm, 21–22% avatar,
  mean span/appearance rate, visual-change cadence, clean split, and shot-role diversity.
- Require semantic score mean `>=1.8`, no zero in opening/critical claims, and zero accepted visible
  pseudo-text/logo/anatomy/style defects.
- Record complete wall-clock, stage, cold/warm, provider, retry, render, storage, and cost evidence.

**Proof:** playable final MP4 in real Chrome, production manifest, hashes/probes, contact sheets,
metric report, itemized cost, user visual decision, and drained zero-worker proof.

## V2-11 — Two-user concurrency, autoscaling, and recovery proof

**Outcome:** the production-shaped system safely runs two different users concurrently, queues all
additional demand fairly, and scales both endpoints back to zero.

- Exercise 5–10 signed-in accounts, two active projects, same-account second jobs, and multiple
  waiting accounts. Verify round-robin fairness and private UI/state.
- Prove each endpoint scales `0→1→2→0`; at most four total GPU workers can exist across two lanes.
  No app action manually starts or stops a Pod.
- Test worker death, unhealthy init, capacity delay, duplicate delivery, callback loss, timeout,
  TTL expiry, cancel-before-start, cancel-running, partial success, provider 429/5xx, database
  restart, object-store delay, and control-plane redeploy.
- Verify at most one output is accepted per dispatch token, duplicate compute is detected and
  itemized, and cancellation never terminates a worker that may be processing another authorized
  job. Do not claim exactly-once provider execution or billing.
- Measure queue delay separately from execution; keep the locked `REQUEST_COUNT=1` scaler and tune
  only the shortest safe idle timeout from evidence. Any scaler-policy change requires a new
  decision, context update, and requalification.

**Proof:** adversarial provider-free suite plus bounded live two-user run, fairness metrics, P70/P90/
P98 queue/execution/cold-start data, exact billing, zero leaked jobs/workers, and two retained
volumes.

## V2-12 — Production-length quality, speed, and economics qualification

**Outcome:** representative evidence—not sample extrapolation—shows whether VideoForge meets its
quality, throughput, and cost targets.

- Run the full Mage 40-prompt/300-image style/relevance suite and exact SoulX Avatar Profile suite.
- Run one owned 20–30-minute Ranga-style video and at least ten representative completed jobs for
  cold/warm p50/p90 evidence.
- Review every image/clip/cut of the production-length bakeoff with the locked semantic and defect
  rubric; retain immutable release regression evidence.
- Measure all variable components: prompt/style calls, worker start/init/load/warm/inference/idle,
  retries, ASR, object storage/operations, rendering, and transfer. Report fixed volume/container
  costs separately.
- Optimize container import/startup, FlashBoot, sequential item execution, lossless transfer
  overhead, idle timeout, and durable retry behavior without changing model/quality contracts.
  `REQUEST_COUNT=1`, Mage 1280x720 output, and complete-batch attempt cardinality remain locked; any
  change requires a new decision, context update, and requalification.
- Keep the representative 30-minute target `<= $1.00` and hard ceiling `<= $2.00`. If evidence
  misses either, stop release and present the measured dominant costs plus bounded alternatives;
  never hide fixed or failed-attempt cost.

**Proof:** accepted full-length MP4, immutable evidence pack, settled itemized cost, p50/p90 speed,
quality scores, rejection/retry rates, queue-delay separation, and user acceptance.

**Optional RTX 5090 gate:** only after the RTX 4090 baseline, independently qualify each lane's
exact image, model, volume, VRAM, output parity, cold/warm timing, availability, and settled cost.
RunPod GPU lists are automatic fallback lists, so a GPU is never added to production merely because
it is compatible or currently available.

## V2-13 — Security hardening, production release, and operating proof

**Outcome:** VideoForge is safely operable by the invited 5–10-person team without developer or
manual GPU intervention.

- Complete OWASP-oriented auth/session/CSRF/CORS/CSP/rate-limit/SSRF/upload/decompression-bomb/
  signed-URL/webhook/secrets/log-redaction tests and cross-tenant penetration matrix.
- Add structured tenant/job/request/lane metrics, traces, cost guards, alerts, dashboards, queue and
  endpoint saturation warnings, zero-worker drain alerts, and audit exports.
- Prove backup/restore, migration rollback/roll-forward, artifact retention/erasure, disaster
  recovery, endpoint/image rollback, and immutable configuration history.
- Add global hourly/cumulative spend stops, per-project cap enforcement, provider balance/capacity
  blockers, and operator-only aggregate analytics with separate authorization.
- Finish accessibility/responsive/cross-browser real-Chrome acceptance while preserving the
  approved UI. Remove fixture/developer controls from production builds.
- Write concise operator runbooks for invite management, incidents, stuck jobs, provider outage,
  billing anomaly, endpoint rollback, model-volume protection, and release rollback.
- Deploy production, run one final private project, verify playback/download, and prove both
  endpoints have zero jobs and zero total workers (`Active + Flex`) after drain.

**Proof:** independent security/release audit with no P0/P1 findings, green CI and browser matrix,
restore drill, alerts/runbooks, immutable release manifest, exact production URL/commit/images/
endpoint configs, final cost, zero endpoint jobs, zero total workers (`Active + Flex`), two retained
isolated volumes, and user sign-off.

## Every-checkpoint completion contract

Each implementation chat works on exactly one selected checkpoint and must:

1. Read mandatory context, its exact new brief/profile, and only the needed domain evidence.
2. Verify the predecessor is accepted; never implement around an incomplete dependency.
3. Start provider-free. For any external mutation or spend, finish local work/read-only preflight,
   then ask once with exact operations, resources, current rates, recurring costs, stop conditions,
   and a user-supplied numeric finite cap.
4. Add focused positive, negative, race/restart, and ownership tests proportional to the checkpoint.
5. Run context/schema checks, focused suites, canonical verification, and real Chrome for visible
   behavior.
6. Preserve private/model/credential bytes outside Git and retain only evidence required by active
   foundations, gates, artifact identities, cost facts, or audits.
7. Record exact evidence, remaining gates, provider/spend state, and zero-worker/endpoint/volume
   truth where applicable.
8. Update `CURRENT_STATE.yaml`, commit one green handoff, and stop before the next checkpoint.
9. Run the checkpoint's independent audit prompt in a separate chat. Audit does not fix; any P0/P1
   finding returns to the same checkpoint for repair and re-audit.

Provider qualification never equals production integration. Fixture evidence never equals hosted
proof. Technical validity never equals user visual approval. A persistent endpoint configuration is
not active compute; an active worker is billed compute and must scale to zero after queue drain.
