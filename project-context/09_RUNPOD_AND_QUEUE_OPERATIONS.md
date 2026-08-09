# RunPod, queue, and lifecycle operations

Status: recommended MVP operational design  
Read when: building endpoint templates, dispatch, GPU selection, progress, cancellation, retries, or cost controls.

## Two queue layers

1. **Application queue in Postgres:** authoritative ownership, ordering, revision, task, cost, retry, and editorial state.
2. **RunPod endpoint queue:** transport/execution after a task has been durably reserved and dispatched.

Never use RunPod's queue as the only record. A provider job can expire, a callback can be lost, or a user can cancel while the application still needs a truthful audit trail.

## Endpoint baseline

- Asynchronous `/run` dispatch.
- `workersMin = 0`.
- `workersMax = 1` initially per expensive lane.
- FlashBoot/model caching enabled where compatible.
- One GPU per worker.
- Network volume mounted read-only for pinned weights.
- Mutable inputs/results through short-lived R2 URLs.
- Execution timeout/TTL sized from measured worst-case chunk runtime, not default guesswork.
- Async result/status reconciliation well inside RunPod's short result-retention window; application results are uploaded to R2 and never depend on provider result storage.
- Health: container ready is distinct from model ready.
- 30–60 second drain window after the application lane reaches zero queued/active work; tune with boot measurements.

Serverless owns worker scale-to-zero. Do not implement a manual Stop button that races provider autoscaling. The UI can show “worker will scale down after queue drains.”

### Endpoint configuration reconciliation

RunPod currently caps a higher endpoint `workersMax` at 2 after three request-free days and reduces it to 0 after seven; incoming requests reset the timer, but an already reduced endpoint remains reduced. Because VideoForge initially uses `workersMax=1`, the seven-day reduction is the normal practical case, while Faster profiles may also exercise the three-day cap. The docs mention raising it in the console, while RunPod's official read/update endpoint APIs expose `workersMax`; VideoForge therefore reconciles/restores the approved profile through those APIs and never asks the user to repair it manually. The same preflight covers other configuration drift.

The preflight verifies:

- endpoint ID/config revision and `workersMin=0`;
- approved `workersMax` and ordered GPU priorities;
- active workers, queue, endpoint health, container template digest, model volume, data center, and volume/DC compatibility;
- per-job execution timeout and queue+run TTL;
- current rate snapshot and maximum reservation;
- signed input URL validity beyond worst-case queue delay;
- callback/reconciliation identifiers.

RunPod's public defaults and retention are not production values: execution timeout may default to about 600 seconds and async results are retained only briefly (currently 30 minutes). Store provider job IDs immediately, poll stale jobs well before expiry, and persist every artifact/status/cost in VideoForge's own systems.

## Chunking and fairness

Avoid both extremes:

- One job per image reloads/queues too much.
- One entire 300-image/105-avatar-clip job can monopolize the lane and make recovery coarse.

Initial chunks:

- Prompts: 25–50 scenes.
- Mage: 32–64 images per RunPod job, checkpointing each artifact.
- AvatarForcing: 15–30 selected spans per job, uploading each accepted primary attempt.
- MuseTalk/SkyReels: one or a few failed short clips per job.
- Render: one immutable project revision.

The orchestrator dispatches the next chunk only when allowed, enabling round-robin fairness across project owners. A warm worker keeps the model resident across queued chunks.

Do not prefill RunPod's internal queue with an entire project. Per lane, allow at most one active and normally one provider-queued chunk per project. After an item/chunk checkpoints, transactionally select the next eligible owner/project before dispatching again. This is what makes application fairness real.

## Project/task state

Project high-level flow:

```text
DRAFT → UPLOADING → TRANSCRIBING → COMPILING_TIMELINE
      → GENERATING → TECHNICAL_QA → RENDERING → READY_FOR_REVIEW → APPROVED
                    ↘ AWAITING_FALLBACK_APPROVAL / BLOCKED_BUDGET
```

Cancellation path: `CANCEL_REQUESTED → CANCELLING → CANCELLED`. Recovery may expose `RECONCILING`. Terminal alternatives: `FAILED`, `CANCELLED`.

Regenerating a selected segment from `READY_FOR_REVIEW` creates a new versioned review candidate and returns the project through the affected generation/technical-QA/render stages. `APPROVED` is immutable; changes after approval require a new project revision.

Task flow:

```text
QUEUED → RESERVED → DISPATCHING → DISPATCHED → RUNNING → UPLOADING → SUCCEEDED
                         │              │             ├→ RETRYABLE_FAILED
                         │              │             ├→ PERMANENT_FAILED
                         │              │             └→ CANCELLING → CANCELLED
                         └→ DISPATCH_ACK_UNKNOWN → RECONCILING
                                                    ├→ DISPATCHED/RUNNING
                                                    └→ RETRYABLE_FAILED
```

State transitions are compare-and-swap/transactional. Provider callbacks can only advance a matching active attempt; stale callbacks are recorded but cannot overwrite a newer accepted result.

## Idempotency and outbox

Canonical idempotency key:

```text
{project_revision_id}:{stage}:{segment_or_chunk_id}:{attempt_number}
avatar-profile:{avatar_profile_version_id}:compatibility:{assessment_id}:{attempt_number}
```

The first form owns ordinary video work. The second owns an optional explicit Avatar Hub compatibility test and dispatches all three short test clips as one bounded chunk so a cold model is loaded once. Merely saving, selecting, or reusing a profile creates no RunPod task.

Before any external call:

1. Reserve budget in the same transaction as task/attempt creation.
2. Insert an outbox record with the idempotency key.
3. Dispatch from the outbox worker/workflow.
4. Store the external job ID immediately.
5. Mark the outbox item complete only after a confirmed provider acknowledgement.

Retried dispatches reuse the same task UUID when provider semantics allow it. Duplicate callbacks are safe.

The application idempotency key is not proof that RunPod's public `/run` API provides at-most-once dispatch or billing. If acknowledgement is ambiguous, move to `DISPATCH_ACK_UNKNOWN` and reconcile by recorded provider job ID/status before retrying. Every worker must acquire a single task-attempt execution claim from the control plane before loading the costly model; duplicate workers exit and record `DUPLICATE_SUPPRESSED`. The product guarantees one accepted result and reconciled lineage, not zero duplicate provider billing until a provider-semantics gate proves that stronger claim.

## Progress and callbacks

Workers send signed events such as:

- `worker_starting`
- `model_loading`
- `model_ready`
- `item_started`
- `item_uploaded`
- `item_failed`
- `job_completed`

Each event includes `owner_type/owner_id`, attempt, ordinal/total, monotonic sequence, timestamp, GPU SKU, elapsed/billed seconds, and cumulative cost when available. Project events also include project/revision; Avatar Profile test events include profile/version/assessment.

The control API verifies HMAC/timestamp/nonce, writes the event, updates derived status transactionally, and broadcasts UI updates. Use Postgres/realtime polling or SSE with polling fallback; the owner-scoped workflow-event table remains the source.

A scheduled reconciler checks dispatched/running attempts whose heartbeat is stale against RunPod's authoritative status. A lost callback must not strand a project or Avatar Profile test.

## GPU selection

Default UI choice is `Auto: cheapest compatible`. The user selects an immutable tested **execution profile**, not an arbitrary per-job GPU mutation. RunPod Serverless GPU priorities are endpoint configuration; do not change a shared endpoint configuration for every project.

Lowest cost/Balanced/Faster resolves one profile ID per lane. Advanced input may override only an exposed tested lane profile. The immutable revision stores the resolved `image_media`, `avatar_primary`, optional `avatar_repair`, and optional `avatar_quality` profile IDs; each attempt separately records the profile and actual GPU that executed.

Create Project exposes two compact primary controls: `Image generation` for `image_media` and `Avatar generation` for `avatar_primary`. Each control shows the selected profile's truthful readiness/availability state. While `GATE_GPU_001` is open, planned GPU/profile candidates may be listed only as disabled `Benchmark required` options; a provider's public GPU inventory or account balance alone is not endpoint/model compatibility evidence. Fixture mode may select only an explicitly synthetic no-GPU profile and must label it as such.

Each execution profile stores:

- Endpoint ID and configuration revision.
- Allowed GPU SKU IDs in provider priority order.
- Minimum VRAM.
- Measured cold/warm runtime.
- Current hourly/per-second price fetched from RunPod.
- Data-center/volume compatibility.
- Last successful worker image digest.
- Per-job execution timeout/TTL and maximum reservation rate.
- Availability and estimate timestamp.

Suggested initial test matrix:

- Mage: RTX 4090 first; RTX 5090/L40S faster candidates; 3090/A5000 only if measured quality/throughput remains economical.
- AvatarForcing: RTX 4090 first; L40S/RTX 6000 Ada fallback if VRAM/ops require 48 GB.
- MuseTalk: 24 GB class should be sufficient, but validate the production container.
- SkyReels: 48 GB preferred for low-VRAM/offload bakeoff; do not promise under-24 GB speed.

Expose only profiles whose intersection is valid across benchmarked model/container/VRAM support, endpoint GPU priorities, network-volume data center, and live availability. Lowest cost/Balanced/Faster may map to separate tested endpoint profiles or to documented fallback priorities. If no compatible profile is available, queue with a clear price/time choice. Never silently select an incompatible card or a much more expensive fallback.

The progress surface reports `image_media` and `avatar_primary` separately so parallel work is obvious. Show the resolved profile state before dispatch and the actual executing GPU only after authoritative provider/worker evidence exists; never fill that field from a planned priority list.

## Warm-up modes

- Lowest cost: do not prewarm; dispatch when the EDL/prompt batch is ready.
- Balanced: start per-job avatar source preprocessing/image-avatar cold start during ASR when estimated idle cost remains within cap. Reuse a profile preparation cache only after the exact model proves that cache is safe, keyed by source hash + model/preparation revision.
- Faster: prewarm both lanes immediately and allow higher compatible GPU priority/concurrency.

Record warm-up idle cost so faster mode is honest.

## Cancellation

- User cancellation marks the revision `cancel_requested` first.
- Stop new dispatches immediately.
- Call RunPod cancellation for dispatched jobs where supported.
- Worker checks cancellation between items and before uploads.
- Preserve completed artifacts/cost events; do not pretend charges vanished.
- Final state becomes `CANCELLED` only after active attempts settle or reconciliation confirms termination.

Avatar Profile compatibility-test cancellation follows the same attempt rules but changes the assessment—not any project revision—to `CANCELLED` with retry metadata. It never changes the immutable ready source or charges a project cap.

## Retry policy

Automatic infrastructure retry only for transient transport, provider capacity, worker crash, or upload failure. Use bounded exponential backoff and a maximum attempt count.

Creative/model failures use the explicit per-clip avatar router or an image regenerate action. Never automatically rerun an entire 30-minute project because one scene failed.

## Budget circuit breaker

Track `reserved`, `reported`, and `settled` cost.

- Reject a dispatch when `settled + active reserved + new estimate > hard cap`.
- Whole-frame SkyReels fallback always recomputes the forecast.
- Default 30-minute cap is $1.50; allow deliberate adjustment only within the versioned MVP contract ceiling of $2.00.
- Workspace daily/monthly caps prevent ten simultaneous users from creating uncontrolled spend.
- Provider balance errors are visible and do not cause infinite retry.
- Optional Avatar Profile tests reserve against a separate profile-version onboarding cap, use the same outbox/ambiguous-ack/cancel/reconciliation rules, and never consume a project's video cap.

## Hourly Pod optimization, later only

If measured volume makes Serverless premiums material, add a lane implementation that creates and stops hourly Pods through RunPod's API. It requires:

- Owner-bound idempotent create.
- One active lease per worker.
- Authoritative RunPod state reconciliation.
- Start on first queued work.
- Worker long-poll/claim.
- Stop only after zero queued/active jobs and drain timeout.
- Fail closed on ambiguous create/stop responses.

This is an adapter behind the same task contract, not MVP infrastructure.
