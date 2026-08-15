# VideoForge: start here

Status: V2-00 complete and independently green; V2-01 ready for explicit implementation invocation
Context schema: `2.0`
Last updated: `2026-08-15`

VideoForge is an invite-only voiceover-to-video product for 5–10 people. Each admitted account has
one default workspace. User-created projects, queues, Avatar Profiles, Image Styles, media, manifests,
usage, and results are private to that account/workspace. Only explicitly built-in presets, such as
`documentary_stock_v1`, are global. Authentication identity and workspace ownership are enforced by
the database and every server boundary; a client-supplied owner ID is never authority.

Input is a title, final English voiceover, exact ready Avatar Profile version, and immutable Image
Style version. Output is an automatically assembled 1920x1080 MP4. The product flow requires no
Premiere work, provider console, manual Pod start/stop, model knowledge, or prompt writing.

The output grammar is only `AVATAR_FULL`, `IMAGE_FULL`, and `AVATAR_SPLIT_IMAGE`. Hard cuts only.
Every image-containing scene has a slow, smooth centered zoom. Never add captions, titles, text
overlays, lower thirds, borders, watermarks, motion graphics, decorative graphics, title cards, or
decorative transitions.

## Active production architecture

The v2 target uses a scale-to-zero control plane plus two isolated RunPod queue-based Serverless
endpoints in `EU-RO-1`:

| Lane | Exact model/runtime | Existing retained storage | Serverless bound |
|---|---|---|---|
| Images | `Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6`, pinned ComfyUI, INT8 ConvRot, 4 steps, guidance 1.0, 1280x720 | Sealed Mage-only 50 GB volume | `workersMin=0`, `workersMax=2`, `REQUEST_COUNT=1`, handler concurrency 1, one GPU/worker |
| Avatar | `Soul-AILab/SoulX-FlashHead-1_3B@59119b6c681230c3eeee157e224ae1941746711e#Model_Pro`, BF16, four distilled steps | Sealed SoulX-only 50 GB volume | `workersMin=0`, `workersMax=2`, `REQUEST_COUNT=1`, handler concurrency 1, one GPU/worker |

Each endpoint mounts only its own existing volume at `/runpod-volume`. Model bytes and manifests are
immutable/read-only by application policy; RunPod does not supply a documented read-only
network-volume mount. Every worker verifies the full sealed manifest before load and after its job,
downloads nothing at runtime, resolves no mutable model reference, and writes all caches, temporary
files, inputs, and outputs to a project-isolated local scratch directory. Missing, modified,
cross-mounted, incomplete, or writable-model-path behavior fails closed.

RTX 4090 is the only active GPU class. RTX 5090 may be added to a lane only after that exact lane's
image, volume, runtime, cold/warm timing, VRAM, output, concurrency, and cost suite passes. Do not list
an unqualified fallback: RunPod may place work on any GPU type configured for an endpoint.

Private R2 is the durable artifact plane. Keys are account/workspace/project/attempt scoped, accepted
objects are checksum-bound, and signed URLs are short-lived. Model volumes never hold user media.
Cloud Run Jobs remain the production target for pinned whisper.cpp transcription and FFmpeg
render/probe; the Mac path is development parity only. Hosted deployment is still unproven.

## Admission, queue, and authority

- One provider workload per account may be active; the global hard limit is two workloads from
  different accounts. Ordinary videos therefore remain capped at one/account and two globally.
- Explicit Mage/SoulX preset previews use the same locks/slots, become eligible only after every
  video queue head, and never change the video fairness cursor.
- A durable fair scheduler rotates eligible accounts. RunPod's endpoint queue is transport capacity,
  not product fairness or admission truth.
- A waiting account may have queued work, but no GPU/CPU generation begins before database admission.
- Users may inspect, cancel, or reorder only their own work. An account-local reorder cannot defeat
  cross-account fair rotation. No user can see or mutate another account's project or catalog.
- One active video's lane work may be sent as a bounded whole-video request so the loaded model is
  reused across its images or short avatar spans. Handler concurrency remains one.
- Provider dispatch uses two phases: durable predispatch authority/outbox before `/run`, then exact
  provider job/worker/GPU/output binding after assignment. Recovery accepts at most one result.

RunPod `/run` returns a job ID, but its public contract does not promise client idempotency,
exactly-once execution, or zero duplicate billing. VideoForge must never claim those guarantees.
Persist a unique dispatch token and cost reservation before the POST, reconcile the exact job via
`/status`, accept at most one checksum-bound output, and expose any duplicate-compute/cost risk.
Async results expire after 30 minutes, so a signed private R2 receipt is durable truth; webhooks are
an acceleration hint, not the sole completion channel. TTL includes queue time and can remove a
running job. Execution and initialization timeouts therefore come from measured lane evidence, not
provider defaults. Ordinary queue purge is forbidden.

Scale-to-zero means `workersMin=0`: no Active worker is retained. Autoscaled work uses Flex workers,
and `workersMax` counts both Active and Flex workers. The control plane must prove zero running/idle
workers after drain and continue billing only for the two explicitly retained volumes.

## Preserved green foundations

- Word timing: exact word-level whisper.cpp contract, deterministic chunk overlap/reconciliation, durable
  receipts/replay, and real Linux FFmpeg/whisper.cpp parity.
- Scheduling: deterministic `scheduler-v2`, exact 30 fps coverage, three-composition manifests, natural
  word/clause cuts, selected-span audio, and provider-free Chrome playback.
- Fixture orchestration: complete provider-free recovery/cancellation/fail-closed evidence,
  useful UI shell, and final MP4 playback/download. Its singleton global-session and manual-Pod
  semantics are superseded, not production truth.
- Mage foundation: exact INT8 runtime and sealed 50 GB volume, accepted visual quality, valid offline
  worker proof, and zero-compute settlement. Bounded worker qualification does not prove Serverless compatibility.
- SoulX foundation: exact Pro runtime and sealed 50 GB volume, valid offline worker samples,
  source-aware full/split review outputs, measured RTX 4090 behavior, and zero compute. The latest
  Avatar Profile visual/crop approval remains open. Pod proof does not prove Serverless handler,
  endpoint, scale-to-zero, concurrency, or recovery behavior.

No inactive avatar runtime, repair route, model substitute, or alternate volume is dispatchable.
Only the exact Mage and SoulX lanes named above belong to the active production plan.

## Locked editorial contract

The pinned Ranga studies remain the style target, while respecting VideoForge's still-image medium:

- exactly three compositions; frame 0 is full avatar;
- full and split avatar alternate; normal avatar spans are 2–6 seconds and opener may reach 7;
- total avatar coverage 21–22%, mean avatar span 3.5–4.0 seconds, and 3.3–3.7 appearances/minute;
- median non-avatar gap 10–13 seconds; first literal evidence 3–6 seconds; first split by 18 seconds;
- mean visual change 4.0–4.8 seconds and median 3.6–4.7 seconds;
- one native avatar clip serves full and split; split boundary is exactly x=960 at 1920x1080;
- narration relevance is literal, shot roles vary deterministically, and every cut follows a natural
  word/clause boundary rather than a randomized duration.

The scheduler's owned 30-minute fixture already reached 21.05% avatar, 3.433 appearances/minute, 3.679-second
mean avatar span, and 4.569-second mean scene duration. Preserve it. Remaining quality work is
literal image relevance, per-avatar crop/lip/background review, authentic-feeling imagery, and real
full-length acceptance. Ranga uses moving stock/UGC; stills plus zoom can match composition, cadence,
and evidence selection, not source-footage motion.

## Current handoff

The V2 roadmap/context reset and its independent V2-00 audit are complete and green at `806edba`.
`CURRENT_STATE.yaml` selects V2-01 as the next checkpoint, ready only when the user explicitly
invokes its provider-free implementation prompt. This handoff does not itself authorize application
implementation. All prior provider authorities are consumed and cannot be reused. The ordered
checkpoints and copy-ready implementation/audit prompts supersede every removed planning file. Git
history records removed briefs; only evidence required by active foundations and gates remains in
the working tree.

## Context navigation

Read `MANIFEST.yaml`, `CURRENT_STATE.yaml`, then only the selected profile and task. Normative
decisions: `15_DECISIONS_AND_OPEN_GATES.md`; architecture: `06_SYSTEM_ARCHITECTURE.md`; models:
`08_MODELS_AND_PROVIDERS.md`; pipeline: `07_PIPELINE_AND_SCHEDULER.md`; RunPod:
`09_RUNPOD_AND_QUEUE_OPERATIONS.md`; contracts: `10_DATA_AND_API_CONTRACTS.md`; cost:
`11_COST_SPEED_BUDGET.md`; acceptance: `14_TESTING_AND_ACCEPTANCE.md`; execution:
`21_IMPLEMENTATION_EXECUTION_PLAN.md`; completion checkpoints:
`22_PROJECT_COMPLETION_CHECKPOINTS.md`; copy-ready prompts:
`templates/CHECKPOINT_CHAT_PROMPTS.md`; maintenance: `16_CONTEXT_MAINTENANCE.md`.
