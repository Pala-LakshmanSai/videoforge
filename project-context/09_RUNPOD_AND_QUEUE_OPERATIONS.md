# RunPod, queue, and lifecycle operations

Status: recommended MVP operational design  
Read when: building Pod templates, dispatch, GPU selection, progress, cancellation, retries, or cost controls.

## One global queue, one session, and two lanes

Postgres is the only authoritative queue and generation-session ledger. It owns the single global
project order, immutable revisions, lane tasks, attempts, costs, retries, editorial state, exact locked
GPU pair, and result lineage. RunPod supplies disposable compute state; it is not the application
queue or recovery ledger. All 5–10 accepted users see the same data and have the same queue mutation
rights. Creator identity is audit metadata, not ownership or scheduling priority.

| Lane | Disposable compute | Persistent model storage | MVP maximum |
|---|---|---|---|
| `mage_image` | Mage worker Pod | Mage-only `EU-RO-1` volume | One Pod |
| `echo_avatar` | Echo worker Pod | Different Echo-only `EU-RO-1` volume | One Pod |

Volumes are never shared or cross-mounted. Future Mage Pods reuse only the Mage volume and future
Echo Pods reuse only the Echo volume. Worker template/image, manifest, preparation marker, locks,
leases, health, attempts, and reconciliation are also lane-scoped.

At most one global generation session, one active video, and one Pod per lane may exist at a time.
There are no per-user Pod pairs, parallel sessions, cross-project lane pipelining, automatic
fairness, or automatic GPU switching. The session state is durable:

```text
IDLE → LOCKING → ACTIVE → DRAINING → IDLE
```

`IDLE` requires no active or waiting project, no active lane work, provider-verified absence of both
Pods, and both persistent volumes retained. Only then are live GPU selectors editable. `ACTIVE`
holds one exact Mage/Echo GPU pair for every project admitted to that session, but exactly one project
may execute. A control-plane restart restores this state from Postgres and reconciles exact Pod
attempts before accepting mutations.

## Pod baseline

- API-created RunPod Pods, not Serverless endpoints or `/run` jobs.
- One GPU per Pod; at most one Pod in each lane and two total in MVP.
- Separate immutable Mage and Echo worker images/templates and exact lane volume IDs.
- No model download, update, derivation, or mutable repository resolution during an ordinary boot.
- Mutable inputs/results use short-lived application R2 URLs or a verified local path, never a model
  volume.
- Signed worker health/progress and authenticated task claims.
- Exact create, readiness, cancellation, and deletion reconciliation.

The user accepts persistent-volume billing. Pod cost ends only when provider absence is proven, not
when the app changes a label. Never retain a Pod merely for possible later work.

## One-time preparation

Volume preparation is separately authorized setup, never part of Generate. For its own lane it
downloads only pinned sources, builds the approved runtime, records every source/derived path,
size/SHA-256/configuration/toolchain identity, independently reopens and verifies the mounted
manifest, and writes the completion marker last. Partial content is not bootable.

Mage preparation implements the exact ImageForge
`Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6` INT8 ConvRot profile through
`Comfy-Org/ComfyUI@26d7f8556822d9d08c2d3e1878636ac3b4969af9`. Echo preparation derives the
VideoForge-owned FP8 runtime from its pinned first-party Flash, Wan base, and audio-encoder sources;
compatible transformer linears use `float8_e4m3fn` dynamic activation-and-weight quantization and
other tensors remain BF16.

One lane cannot read, write, mount, or bless the other lane's volume. A model change requires a new
explicit preparation/version operation; a billed ordinary Pod never repairs model storage.

## Generate, atomic session locking, and GPU selection

Before accepting Generate, locally decode/probe/hash the voiceover, freeze the revision/input checksum
and resumable R2 upload identity, determine both lane requirements from immutable generation settings,
validate recorded model-volume preparation and compatibility evidence, and reserve the project cap.
For the active project only, durable upload, Cloud Run CPU transcription, timeline preparation, prompt
compilation, and scheduled-span audio materialization may overlap Pod boot. Inference waits for
`model_ready`, its exact lane work plan, and every required R2/local input's durable verification
barrier.

While the session is `IDLE`, refresh RunPod inventory independently for each lane. Offer only the
intersection of current `EU-RO-1` availability and qualified model/container/VRAM evidence for that
lane. The user explicitly chooses Mage and Echo GPUs separately. There is no `Auto`, static priority
choice, or silent GPU/price fallback.

The first accepted Generate uses one serializable transaction/compare-and-swap to:

1. Revalidate the exact selected offerings and inventory receipts.
2. Lock one new global session with both GPU SKUs, rate ceilings, model/container/volume profiles, and
   selection actor/time.
3. Freeze, enqueue, and activate the first project revision.
4. Materialize its CPU/lane tasks and persist both required lane create intents before any provider
   mutation.

After commit, issue the Mage and Echo creates concurrently. Concurrent Generate requests cannot create
a second session or pair. The transaction winner establishes the pair; another otherwise valid request
re-reads the winner, recomputes its estimate/cap against that locked pair, and appends one waiting row
at the queue tail. It creates no executable work or provider intent. If its cap or immutable inputs no
longer validate, it fails without queue or provider mutation.

While any project is active/waiting or either lane has work, the session pair is immutable and
selectors are hidden/locked. Every later accepted Generate only freezes and appends a waiting project
which inherits that pair. A waiting entry is orchestration-inert: no ASR, scheduling, prompt
compilation, image generation, avatar generation, render, task claim, attempt, or dispatch outbox may
start for it. No user may select a per-project or per-user pair, and no scheduler may create a parallel
session. If a locked GPU becomes unavailable, its lane waits; the session never substitutes or
automatically switches GPU, model, volume, region, precision, or rate policy.

Every accepted user may reorder or remove only `WAITING` projects. Mutations use queue-version
compare-and-swap and record actor, time, prior/new position or removal, reason when supplied, and
request identity. Promotion and a reorder/remove of the same row serialize atomically—never both.
New projects append at the current tail; there is no fairness, per-user quota, or ownership
preference.

## Exact identity and create ambiguity

Persist a unique lane-scoped `create_attempt_id` before calling RunPod, together with global session,
revision, lane, expected Pod tag, template/image digest/API version, exact volume/DC/mount, model
revision/precision/manifest hash, selected GPU/count, compatibility evidence, rate/reservation, and
callback/deletion authority.

Before adoption, provider state and worker health must agree on Pod ID, create attempt, GPU, volume,
DC, image, worker, and model identity. Reject same-name, wrong-attempt, wrong-image, or cross-volume
Pods.

A lost/ambiguous create response becomes `CREATE_ACK_UNKNOWN`; do not create again. Reconcile by the
exact attempt tag and expected identity, adopting only one exact match. Multiple/unprovable matches
fail closed and display possible spend. Another create requires authoritative absence or explicit
resolution of the first attempt. An idempotency key does not prove provider at-most-once billing.

## Offline boot and readiness

Ordinary boot reads the prepared volume without contacting model registries:

```text
CREATING → container_ready → volume_ready → model_loading → model_ready
```

- `container_ready`: expected immutable container and health API are reachable; model is not ready.
- `volume_ready`: lane volume, completion marker, paths, sizes, hashes, revision, precision, and
  preparation identity verify.
- `model_loading`: verified bytes load into the selected GPU; inference is rejected.
- `model_ready`: actual GPU/full identity and a real warm-up pass without OOM, NaN, or contract error.

Missing, changed, incomplete, or cross-mounted content fails; never download a substitute. Boot must
pass with model registries unavailable, while authenticated R2/control-plane access remains. Record
provisioning, container, volume check, model load, warm-up, first output, completion, and deletion
timings separately. UI “ready” means `model_ready`, not merely a running container.

## Claims, chunks, and task truth

Only the exact `model_ready` Pod may claim a lane task for the one `ACTIVE` project. Transactional
leases suppress stale/duplicate workers before inference. Initially keep one active chunk per lane and
checkpoint each accepted artifact to R2. Mage may process bounded image batches; Echo processes only
short selected speech spans, never a substitute full-voiceover job. No lane may claim or prepare work
for a `WAITING` project, even after its own lane finishes the active project. No lane runs two chunks
concurrently and neither lane uses creator identity as priority.

Mage and Echo can work concurrently and complete, fail, retry, accrue cost, and shut down
independently. Task state uses transactional compare-and-swap:

```text
QUEUED → RESERVED → CLAIMED → RUNNING → UPLOADING → SUCCEEDED
                    └→ RETRYABLE_FAILED / PERMANENT_FAILED / CANCELLING → CANCELLED
```

Pod lifecycle is separate. Task success does not prove deletion; deletion does not erase task/result
or cost evidence. Task idempotency keys are
`{project_revision_id}:{lane}:{segment_or_chunk_id}:{attempt_number}`. Write budget and outbox intent
before each external mutation. Only a matching current callback may advance state.

## Events and reconciliation

Signed events include `container_ready`, `volume_ready`, `model_loading`, `model_ready`, item
start/upload/failure, `lane_completed`, `pod_delete_requested`, and `pod_deleted`. Each carries lane,
global session/revision, create attempt, Pod ID, manifest, actual GPU, task attempt, monotonic sequence,
time, and available elapsed/billed cost. Verify HMAC/timestamp/nonce and exact active identity before
writing state. A reconciler reads authoritative RunPod state for missing heartbeats and uncertain
create, cancel, or delete outcomes.

## Durable completion and deletion

A lane task completes only after every required successful output reaches its durable barrier: upload
completion, size/SHA-256/media validation, immutable R2 key, and committed Postgres lineage. An
explicitly local run may use the equivalent verified local file and receipt. Pod scratch files and
provider logs do not count.

After a lane finishes the active project's durable work, an existing Pod may stay warm only when at
least one `WAITING` project remains in the same locked session. Warm retention authorizes no waiting
work. When no waiting project exists, immediately delete that lane's exact Pod and retain its volume;
do not wait for the other lane, final render, or an idle timeout. Deletion is:

1. Persist delete intent for the exact Pod ID/create attempt.
2. Re-read provider state and verify lane, global session, volume, image, model, and attempt.
3. Send one delete for that exact Pod.
4. Reconcile until exact absence is proven.
5. Only then record `pod_deleted`/`OFFLINE` and clear possible-spend warning.

A lost/ambiguous delete becomes `DELETE_ACK_UNKNOWN`. Never claim stopped or target another resource;
continue reconciling the same Pod. The persistent volume is never part of normal cleanup.

Appending or reordering a waiting entry never creates or recreates a Pod. When the active project
becomes terminal, one serializable transaction either promotes the next waiting row to `ACTIVE` and
materializes only that project's work, or begins session drain when no row remains. A still-running
exact lane Pod may then serve the promoted project. For each absent required lane, refresh inventory,
revalidate the same session-locked offering and approved rate, persist a new lane create attempt, and
recreate against the same retained lane volume. Unavailability blocks that active lane truthfully;
never substitute or request new selection mid-session. When no active/waiting project remains,
reconcile and prove both Pods absent, prove both volumes retained, close the session, and only then
return to `IDLE` and unlock live selection.

## Cancellation, retries, and CPU work

Cancellation by any accepted user first records actor/time and `cancel_requested`, prevents new claims
for that project, and asks a worker currently executing its task to stop at a safe checkpoint. Preserve
artifacts/costs and settle that project's lane tasks. No waiting project begins until the cancelled
project is terminal and the atomic promotion rule runs. An existing lane Pod may remain warm when a
waiting row exists; otherwise run its independent deletion proof. Pod absence remains a separate
lane/session fact and is required before session close, not before promoting work to a still-running
exact Pod.

Retry only bounded transient transport, pre-create capacity, worker crash, or upload failures. A
replacement Mage Pod attaches only the Mage volume; a replacement Echo Pod only the Echo volume.
Never silently substitute model, GPU, volume, precision, fallback, or repair.

For the active project only, production whisper.cpp ASR and deterministic FFmpeg render/probe run as
separately measured scale-to-zero Cloud Run Jobs over private R2. The same entrypoints may run
locally only for development/provider-free parity. They never use a model volume or GPU lane.
Waiting entries dispatch neither CPU nor GPU work.

## Budget and historical boundary

Track reserved, reported, and settled cost per lane, project, and global session. Shared boot/deletion
cost attribution must be deterministic and auditable. The former target of at most `$1.00` and hard
MVP ceiling of `$2.00` for a representative 30-minute output is not achieved by the exact CP-07 Echo
runtime: fresh RTX 5090 measurements project `$12.10-$16.85` for the Echo lane alone when one Pod stays
warm across the accepted fixture's 481.32 seconds of padded span audio. Treat the old target as an open product-cost
gate, not an admission default. Reject a project or additional work that would exceed its explicit
current cap; keep accepted persistent-volume cost visible as separate fixed infrastructure and do not
amortize it by idling Pods. Provider balance/capacity failures are visible and cannot loop creates.
The global limit is one Mage Pod plus one Echo Pod in one session.

The former Serverless `/run`, `workersMin`/`workersMax`, endpoint queue, FlashBoot, automatic drain,
GPU priority list, and shared image/media endpoint design is historical only. AvatarForcing,
MuseTalk, and SkyReels endpoint routes are also replay-only. No current work may dispatch them or use
them to justify shared volumes without a new explicit decision and gate.
