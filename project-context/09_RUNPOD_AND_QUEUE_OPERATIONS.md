# RunPod Serverless, queue, and lifecycle operations

Status: approved VideoForge V2 target; provider-free implementation and live Serverless qualification remain open
Read when: building admission, dispatch, Serverless handlers/endpoints, progress, cancellation,
reconciliation, storage isolation, or cost controls.

## Boundary and preserved evidence

Postgres is the authoritative admission, fairness, task, attempt, artifact, and cost ledger. RunPod's
endpoint queue is execution backpressure only. It does not decide which account runs next, prove
exactly-once execution, own recovery, or authorize another job.

The exact Mage INT8 ConvRot runtime and exact SoulX-FlashHead Pro runtime already have isolated,
sealed 50 GB `EU-RO-1` network volumes and successful bounded disposable-Pod evidence. Preserve
their manifests, hashes, samples, timings, and cost records. That evidence proves the model bytes and
Pod-era offline boot path; it does **not** prove a Serverless handler, template, endpoint, concurrent
read safety, autoscaling, or production dispatch. EchoMimic is historical and non-dispatchable.

No planning or provider-free checkpoint may mutate RunPod. Endpoint/template publication, live
requests, paid workers, or volume changes require the exact external-checkpoint authority.

## Active production topology

| Lane | RunPod transport | Persistent storage | Endpoint ceiling |
|---|---|---|---:|
| `mage_image` | One queue-based Serverless endpoint | Existing Mage-only 50 GB `EU-RO-1` volume | `workersMax=2` |
| `soulx_avatar` | Different queue-based Serverless endpoint | Existing SoulX-only 50 GB `EU-RO-1` volume | `workersMax=2` |

Each endpoint uses:

- `workersMin=0`, so there are no always-on Active workers. Demand-created workers are Flex
  workers and scale back to zero.
- One GPU per worker.
- RTX 4090 as the only allowed GPU SKU until each lane independently qualifies RTX 5090 for exact
  container, model, volume, VRAM, output, latency, and cost compatibility. Do not put an unqualified
  5090 or any other GPU in an automatic priority/fallback list.
- The lane's exact immutable container digest, exact volume ID, `EU-RO-1`, and mount path
  `/runpod-volume`.
- A measured execution timeout, request TTL, idle timeout, scaling policy, and
  `RUNPOD_INIT_TIMEOUT`. Provider defaults are not acceptance evidence.

`workersMax=2` is per endpoint and counts that endpoint's Active plus Flex workers. Application
admission limits work to two active provider workloads from different accounts globally, so at most
two jobs can be intentionally active on either lane. Ordinary videos remain capped at one/account
and two globally; explicit preset previews consume the same slots and never outrank an eligible
video. Do not infer this business limit from RunPod configuration alone.

## Tenant-private fair admission

Every authenticated account owns one default workspace. Projects, presets, inputs, outputs, queue
rows, attempts, costs, and audit events are account/workspace scoped and enforced by database-side
composite ownership constraints. The client never supplies an authority-bearing tenant scope.

Admission rules are durable and transactional:

1. At most one provider workload—video or explicit preset preview—may be active per account.
2. At most two workloads from different accounts may be active globally; this preserves the upper
   bounds of one active video/account and two active videos globally.
3. FIFO is preserved inside each account unless that account reorders its own waiting work.
4. Global video promotion is fair across account heads, using a durable round-robin/last-served cursor
   with deterministic tie-breaking. A busy account cannot monopolize both slots while another
   eligible account waits. Preset previews become eligible only when no video head is eligible and use
   a separate cursor that never alters video fairness.
5. Users may inspect, reorder, cancel, or remove only their own rows. A mutation cannot move work
   ahead of another account's already-eligible fair turn.
6. Only a transactionally admitted workload can materialize GPU/CPU/provider outbox rows. Waiting
   video and preview work creates no RunPod request, CPU job, prompt call, signed artifact URL, or
   model-volume write.

RunPod queue position is never shown as the application fairness order. The UI shows the user's own
durable state and a privacy-safe capacity/wait estimate without exposing another tenant's project,
asset, queue metadata, or cost.

## Whole-video lane requests

After admission and deterministic preparation, each video/lane starts with one bounded whole-video
batch attempt:

- Mage receives the immutable list of image prompts/settings/output destinations.
- SoulX receives only scheduled short-span audio assets plus the exact pinned avatar source and
  output destinations; it never receives a full voiceover as an unscheduled generation request.
- A lane with zero required work receives no request.

At most one current attempt exists per video/lane. After the prior attempt is terminal or uniquely
reconciled, a bounded classified replacement uses a new attempt/token and carries all unresolved lane
items as one batch; accepted items are not regenerated and no parallel per-scene fragmentation is
allowed. Batching amortizes cold start and model load while retaining item-level checksums, retry
state, timings, validation, and cost attribution. It does not authorize unbounded payloads: item
counts, input bytes, expected duration, deadline, and cost reservation are validated before dispatch.

## Model-volume contract

The two volumes are never shared, cross-mounted, repaired, updated, or deleted by an ordinary worker.
Normal boot performs no model download, package install, repository resolution, quantization, or
preparation. Each handler verifies the sealed manifest before model load and fails closed for a
missing, incomplete, changed, wrong-model, wrong-region, or cross-lane volume.

RunPod documentation does not establish a provider-enforced read-only network-volume mount. The
application therefore enforces a read-only runtime contract:

- open model/runtime files read-only;
- set model/cache/config homes to job-local scratch or an immutable packaged path;
- block writes, lockfiles, downloads, compilation, and cache creation below `/runpod-volume`;
- use a unique scratch directory for every attempt and remove it after durable upload;
- record pre/post manifest hashes during qualification;
- prove two concurrent workers can read the same lane volume without mutation or corruption before
  setting `workersMax=2` live.

Inputs and results never use the model volume as durable storage. They move through tenant-private
R2 with short-lived, least-privilege signed URLs and exact object-key/checksum bindings.

## Dispatch and ambiguity

RunPod `/run` returns a provider job ID, but the public contract does not promise client-controlled
idempotency, exactly-once execution, or exactly-once billing. VideoForge therefore promises only
**at most one accepted output** per logical lane attempt, while measuring and exposing any bounded
duplicate-compute/cost risk.

Before the first provider call, one database transaction persists:

- logical task and attempt IDs;
- opaque unique `dispatch_token` and request-body hash;
- account/workspace/revision/lane ownership;
- endpoint/template/image/model/volume/manifest bindings;
- input and output artifact manifests;
- deadline, TTL, execution/init timeout profile, rate snapshot, reservation, and authority hash;
- a durable outbox row in `READY_TO_DISPATCH`.

The dispatcher leases the outbox row, sends once, then records the exact provider job ID and response.
A transport timeout or lost response becomes `DISPATCH_ACK_UNKNOWN`; it is not proof that no job was
created. Do not blindly POST again. Reconcile the persisted token/request lineage, provider status,
callbacks, durable output prefix, and cost evidence. If unique provider adoption cannot be proved,
stop new dispatch for that logical attempt, surface possible spend, and require bounded operational
resolution. A replacement attempt uses a new token and can start only after policy permits it.

Completion is a compare-and-swap on the current logical attempt. Late, duplicate, wrong-tenant,
wrong-endpoint, wrong-manifest, or superseded outputs are quarantined and never promoted. This
prevents duplicate acceptance; it cannot claim duplicate compute or billing was impossible.

## Boot and readiness

Worker state is explicit:

```text
ALLOCATING -> CONTAINER_READY -> VOLUME_VERIFIED -> MODEL_LOADING -> WARMING -> MODEL_READY
```

`MODEL_READY` requires exact runtime identity, actual RTX 4090 identity, sealed-volume verification,
successful GPU load, and a real lane warm-up without OOM, NaN, contract error, or volume mutation.
An allocated worker, open port, handler import, or log message is not ready.

Measure allocation, container import, volume verification, model load, warm-up, first inference,
each item, upload, and total billed time separately. Historical SoulX Pod start-to-ready evidence was
approximately 672 seconds, beyond RunPod's documented seven-minute unhealthy-worker cold-start
threshold. The SoulX Serverless checkpoint must set and qualify `RUNPOD_INIT_TIMEOUT` deliberately;
it may not inherit an unsafe default or call the Pod timing a Serverless result.

## Timeout and result retention

- RunPod request TTL includes time in the provider queue **and** execution. Expiry can remove a job
  that has already started, so derive TTL from bounded queue plus measured cold/run/upload time.
- The default execution timeout is not accepted for either lane. Measure worst-case bounded batches,
  include upload/cleanup headroom, and set an explicit finite value.
- Set `RUNPOD_INIT_TIMEOUT` from measured container/model initialization and a finite stop policy.
- Asynchronous RunPod results are retained for only 30 minutes. Persist accepted state and artifact
  receipts immediately; recovery must not depend on reading an old provider result later.

## Status, callback, and durable completion

The control plane polls `/status/{provider_job_id}` until a terminal state or its own bounded
reconciliation deadline. A webhook may reduce latency, but it is never the sole source of truth:
documented webhook delivery has bounded retries and no provider signature guarantee sufficient for
VideoForge authority.

Workers return or upload an application-defined signed provenance receipt containing the dispatch
token, task/attempt, tenant/revision/lane, exact runtime and manifest hashes, actual GPU, input/output
checksums, media probes, timings, and receipt nonce. Validate its application signature and all
expected bindings. This is **VideoForge provenance**, not a provider attestation of hardware,
billing, or exactly-once execution.

A lane succeeds only after every required artifact is present at the exact tenant R2 key, checksum
and media validation pass, the receipt is accepted, and Postgres commits lineage. A provider
`COMPLETED` status, worker-local file, webhook, or signed URL alone is insufficient.

## Cancellation, retries, and queue safety

Cancellation first commits local intent, prevents new item work, and calls the exact job cancel route
when applicable. Continue reconciliation until provider terminal state and settled/possible cost are
recorded. Cancellation cannot promise already-consumed compute is refunded.

Retry only bounded, classified failures. Pre-dispatch validation may reuse the same logical task;
provider execution uses a new attempt/token after the prior attempt is terminal or explicitly
resolved. Never silently change tenant, endpoint, model, precision, volume, region, GPU, settings,
artifact, or cost authority.

Ordinary application and operations code must never call RunPod's queue-wide purge operation. A
purge can affect unrelated admitted work and bypass per-tenant cancellation, lineage, and cost
settlement. Cancel only exact owned provider job IDs after database authorization.

## Scale-to-zero and retained cost

After terminal reconciliation the endpoint autoscaler may return Flex workers to zero. Acceptance
must independently prove zero total workers (`Active + Flex`) and zero endpoint jobs for the test
scope; an app label is not provider evidence. No manual Pod should remain from a Serverless
qualification.

Zero workers means zero ongoing GPU compute, not zero fixed storage billing. The existing Mage and
SoulX 50 GB volumes remain retained at their separately accepted rate until an explicit destructive
volume decision. Every handoff reports both facts: current compute state and current retained-volume
state/rate.

## Stop conditions

Stop dispatch and report truthfully on tenant mismatch, stale or missing authority, endpoint/image/
model/volume drift, non-4090 GPU, manifest mutation, timeout/cap risk, ambiguous dispatch, invalid
artifact, unbounded duplicate risk, or uncertain cleanup. Do not repair, substitute, cross-mount,
purge, enlarge a volume, publish a new image, or allocate fallback compute without the exact new
checkpoint authority.
