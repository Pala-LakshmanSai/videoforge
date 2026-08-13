# RunPod, queue, and lifecycle operations

Status: recommended MVP operational design  
Read when: building Pod templates, dispatch, GPU selection, progress, cancellation, retries, or cost controls.

## One queue and two lanes

Postgres is the only authoritative queue. It owns workspace ordering, immutable revision, lane tasks,
attempts, costs, retries, editorial state, and result lineage. RunPod supplies disposable compute
state; it is not the application queue or recovery ledger.

| Lane | Disposable compute | Persistent model storage | Initial maximum |
|---|---|---|---|
| `mage_image` | Mage worker Pod | Mage-only `EU-RO-1` volume | One Pod |
| `echo_avatar` | Echo worker Pod | Different Echo-only `EU-RO-1` volume | One Pod |

Volumes are never shared or cross-mounted. Future Mage Pods reuse only the Mage volume and future
Echo Pods reuse only the Echo volume. Worker template/image, manifest, preparation marker, locks,
leases, health, attempts, and reconciliation are also lane-scoped.

## Pod baseline

- API-created RunPod Pods, not Serverless endpoints or `/run` jobs.
- One GPU per Pod; at most one Pod in each lane and two total initially.
- Separate immutable Mage and Echo worker images/templates and exact lane volume IDs.
- No model download, update, derivation, or mutable repository resolution during an ordinary boot.
- Mutable inputs/results use short-lived workspace R2 URLs or a verified local path, never a model
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

## Generate and GPU selection

One explicit Generate action may authorize both required Pods. Before provider mutation, locally
decode/probe/hash the voiceover, freeze the revision/input checksum and resumable R2 upload identity,
determine lanes from immutable generation settings, validate recorded model-volume preparation and
compatibility evidence, and reserve the cap. Durable upload, local/CPU transcription, and timeline
preparation may run while both Pods boot. Inference waits for `model_ready`, its exact lane work
plan, and every required R2/local input's durable verification barrier.

Refresh RunPod inventory independently for each lane. Offer only the intersection of current
`EU-RO-1` availability and qualified model/container/VRAM evidence for that lane. The user explicitly
chooses the Mage GPU and Echo GPU separately. There is no `Auto` choice or silent GPU/price fallback.
If one choice disappears, that lane requires refresh/reselection without changing the other.

After both create intents are durable, issue required Mage and Echo creates concurrently. A project
needing one lane creates only one Pod.

## Exact identity and create ambiguity

Persist a unique lane-scoped `create_attempt_id` before calling RunPod, together with workspace,
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

Only the exact `model_ready` Pod may claim a lane task. Transactional leases suppress stale/duplicate
workers before inference. Initially keep one active chunk per lane and checkpoint each accepted
artifact to R2. Mage may process bounded image batches; Echo processes only short selected speech
spans, never a substitute full-voiceover job. Between chunks, the application chooses the next
eligible owner/project. Delete the Pod when its authorized lane work ends instead of holding it for a
future project.

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
workspace/revision, create attempt, Pod ID, manifest, actual GPU, task attempt, monotonic sequence,
time, and available elapsed/billed cost. Verify HMAC/timestamp/nonce and exact active identity before
writing state. A reconciler reads authoritative RunPod state for missing heartbeats and uncertain
create, cancel, or delete outcomes.

## Durable completion and deletion

A lane may delete its Pod only after every required successful output reaches its durable barrier:
upload completion, size/SHA-256/media validation, immutable R2 key, and committed Postgres lineage.
An explicitly local run may use the equivalent verified local file and receipt. Pod scratch files and
provider logs do not count.

After a lane becomes terminal and passes that barrier, immediately delete its exact Pod and retain
its volume. Do not wait for the other lane, another project, or an idle timeout. Deletion is:

1. Persist delete intent for the exact Pod ID/create attempt.
2. Re-read provider state and verify lane, ownership, volume, image, model, and attempt.
3. Send one delete for that exact Pod.
4. Reconcile until exact absence is proven.
5. Only then record `pod_deleted`/`OFFLINE` and clear possible-spend warning.

A lost/ambiguous delete becomes `DELETE_ACK_UNKNOWN`. Never claim stopped or target another resource;
continue reconciling the same Pod. The persistent volume is never part of normal cleanup.

## Cancellation, retries, and CPU work

Cancellation first records `cancel_requested`, prevents new claims, and asks each exact worker to stop
at a safe checkpoint. Preserve artifacts/costs, then run the same independent deletion proof. Mark
the project cancelled only after tasks settle and all Pods are absent or truthfully reconciling.

Retry only bounded transient transport, pre-create capacity, worker crash, or upload failures. A
replacement Mage Pod attaches only the Mage volume; a replacement Echo Pod only the Echo volume.
Never silently substitute model, GPU, volume, precision, fallback, or repair.

whisper.cpp ASR and deterministic FFmpeg render/probe run locally or on separately measured
scale-to-zero CPU compute. They use R2/local artifacts, never either model volume, and never occupy
the Mage GPU.

## Budget and historical boundary

Track reserved, reported, and settled cost per lane and project. Reject creation/additional work that
would exceed the cap; keep persistent-volume cost visible but do not amortize it by idling Pods.
Provider balance/capacity failures are visible and cannot loop creates. The initial global limit is
one Mage Pod plus one Echo Pod.

The former Serverless `/run`, `workersMin`/`workersMax`, endpoint queue, FlashBoot, automatic drain,
GPU priority list, and shared image/media endpoint design is historical only. AvatarForcing,
MuseTalk, and SkyReels endpoint routes are also replay-only. No current work may dispatch them or use
them to justify shared volumes without a new explicit decision and gate.
