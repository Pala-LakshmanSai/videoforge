# Implementation execution plan

Status: execution router for the VideoForge v2 production roadmap
Read when: activating, implementing, auditing, or handing off one checkpoint.

## Source of truth and activation

The exact checkpoint acceptance contract lives in `22_PROJECT_COMPLETION_CHECKPOINTS.md`.
`CURRENT_STATE.yaml` selects one current checkpoint, narrow read profile, and task brief. The brief
owns file scope, dependencies, authority, evidence, rollback, cleanup, and stop conditions. If the
matching selector records are absent, create and validate narrow records before implementation; do
not load unrelated history.

The former checkpoint series, manual-Pod runtime, global session, and prior provider approvals are
historical only. Preserve their bytes and evidence, but never use an old cap, resource grant, or
acceptance as authority for a v2 operation.

## Required order

1. `V2-00`: reset active architecture, references, roadmap, selectors, and prompts.
2. `V2-01`: enforce tenant-private identity and data access.
3. `V2-02`: enforce private object namespaces, signed ports, and scratch isolation.
4. `V2-03`: implement one active provider workload/account, two global slots, video-first fair
   durable admission, and explicit lower-priority preset previews on the same capacity locks.
5. `V2-04`: implement provider-free Serverless v3 authority, transport, outbox, receipts, and
   recovery.
6. `V2-05`: cut the app to the provider-free v3 runtime and remove live manual-Pod/GPU controls.
7. `V2-06`: deploy private hosted staging with auth, Neon, R2, Cloudflare, and Cloud Run CPU jobs.
8. `V2-07`: qualify Mage Serverless using the existing sealed Mage-only volume.
9. `V2-08`: qualify SoulX Serverless using the existing sealed SoulX-only volume.
10. `V2-09`: run one short real hosted end-to-end project.
11. `V2-10`: run and visually accept one real 3-5 minute Ranga-style pilot.
12. `V2-11`: prove two-user concurrency, fair queueing, autoscaling, and failure recovery.
13. `V2-12`: qualify representative 20-30 minute quality, speed, and economics; qualify RTX 5090
    separately only if it is explicitly proposed and approved.
14. `V2-13`: harden security, release production, and prove operations/rollback.

Checkpoint promotion stays serial. Disjoint worker code may be built in parallel after V2-04, but
shared contracts, provider resources, and acceptance do not advance out of order.

## External-boundary protocol

Every checkpoint begins in fixture/provider-free mode. Local code, migrations, manifests, tests,
owned fixtures, and documentation are completed before external activation. A checkpoint prompt may
also allow narrowly scoped read-only inventory, identity, quota, and current-rate lookups through
already configured credentials at a `$0` cap. Such lookups may not print secrets or mutate,
publish, deploy, download, allocate, generate, retain a new resource, or spend.

At the first external mutation or paid boundary, stop once and present one combined proposal with:

- every exact create/update/publish/deploy/submit/cancel/delete/retain operation;
- exact account, region, image digest, endpoint/configuration, volume, model manifest, GPU offering,
  service size, and current rate that matters;
- finite-action estimate, separately stated recurring charges, intended retained resources, and
  cleanup/rollback operations;
- stop conditions and the numeric maximum cumulative finite external spend that the user must
  supply. Never invent the cap.

Record the user's exact approval, timestamp, operations, resources, rates, recurring-charge consent,
and numeric cap in the task brief and `CURRENT_STATE.yaml`. Continue without another confirmation
only while the exact proposal remains true. Stop before exceeding the cap or changing scope, rate,
region, capacity, retained resources, or cleanup. Authorization from any other task is invalid.

## Locked runtime contracts

- Tenant and revision lineage is mandatory from queue entry through artifact, request, attempt,
  output, cost, review, and audit. No client-supplied owner identifier grants access.
- One account can hold one active-provider-workload lock. At most two different accounts hold global
  capacity leases. Ordinary videos therefore remain capped at one/account and two globally. Explicit
  preset previews consume the same locks/slots, become eligible only after every video head, and do
  not change the video fairness cursor. Fair account rotation is database truth, not RunPod queue
  behavior. A user may reorder or cancel only their own waiting entries without changing account
  rotation or another user's order.
- Each admitted video may dispatch at most one complete Mage lane batch and one complete SoulX lane
  batch at a time. Waiting work never calls a provider.
- Pre-dispatch authority binds the tenant, immutable revision/work manifest, endpoint/config hash,
  model/volume manifest, input hashes, deadline, and spend ceiling. After a unique RunPod job is
  returned or reconciled, persist a `provider_assignment` binding its request ID to the token and
  attempt before accepting status/output. A separate signed VideoForge provenance receipt records
  worker ID when exposed, runtime GPU/driver/CUDA probes, intended region/volume, ready state,
  timings, and output hashes. It is not provider hardware attestation.
- Persist an outbox record and stable dispatch token before `/run`. RunPod does not promise client
  idempotency, exactly-once execution, or no duplicate billing. Reconcile `/status`, accept at most
  one canonical durable output, and record any bounded duplicate compute/cost rather than hiding it.
- Async provider results are temporary and may expire after 30 minutes. A signed durable R2 receipt
  plus polling/reconciliation is system truth; a webhook alone is not. Never use `/purge-queue` for
  routine recovery.
- TTL covers time from submission and may terminate queued or running work. Measure and pin safe
  queue TTL, execution timeout, `RUNPOD_INIT_TIMEOUT`, scaler, idle timeout, and retry bounds. Do not
  inherit service defaults. `workersMin=0` means no always-on Active workers; autoscaled work is
  Flex. `workersMax` counts Active and Flex workers together.
- Mage and SoulX use different existing sealed 50 GB `EU-RO-1` volumes at `/runpod-volume`. Model
  bytes are verified and application-read-only. User artifacts and mutable cache never touch those
  volumes; job-local scratch is erased after success, failure, cancellation, timeout, and refresh.
- RTX 4090 is the initial exact qualification target. RTX 5090 is neither fallback nor allowed in an
  endpoint GPU list until the exact lane runtime has separate compatibility, quality, timing, VRAM,
  and cost evidence plus explicit bounded approval.

## Verification and handoff

Use focused tests before canonical verification. Required proof grows with risk:

- migrations: fresh, upgrade, restore, constraints, and adversarial ownership;
- contracts: TypeScript/Python parity, valid/invalid fixtures, replay, races, response loss, worker
  death, cancellation, timeout, duplicate delivery, and cost conservation;
- visible behavior: installed real Chrome with separate accounts and no fixture/provider ambiguity;
- live work: immutable account/region/image/endpoint/config/volume/model/GPU/rate identity, raw
  timings, VRAM, hashes/probes, durable receipts, settled finite cost, retained fixed charges, and
  independent zero-worker-after-drain proof.

Update evidence, gates, context, and `CURRENT_STATE.yaml`; commit one bounded green checkpoint; and
do not begin its successor. If cleanup or worker state is uncertain, stop dispatch, reconcile it,
and report the active-cost risk rather than claiming completion.
