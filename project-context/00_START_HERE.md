# VideoForge: start here

Status: V2-06 is complete and independently audited PASS. V2-07 is active but NOT_QUALIFIED after
Attempt 19 passed the exact-ID PATCH acknowledgement and failed the required complete GET readback
before dispatch. Exact cleanup and three stable reads prove zero RunPod disposable resources, both
intended volumes retained, and USD 0 Attempt 19 spend. Proposal
`sha256:ce11e4efb3b97f47c9ca70f83451ce6535e8467ac506b682527466f9327dafde`
and authority `sha256:b824bea61e30c4ad1b5eda4bf8113c390c0ae0eff0a03c6fb279210e81d9e5c2`
are consumed and closed. The signer is absent, the Worker is restored, and 16/16 disabled-route
probes passed. Provider-free repair `b35f4a6` permits only omitted GET `computeType`/`dataCenterIds`
while preserving exact values if present and every other strict readback fence. Fresh proposal
`sha256:9d3f9ff254692f61b5efbd8ef55659094183b0df15c077db4eb23ce81e30bb5d`
requires exact approval and a fresh positive numeric cap; V2-08 is unauthorized.
Context schema: `2.0`
Last updated: `2026-08-21`

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
Pinned whisper.cpp transcription and FFmpeg render/probe run on an account-owned Windows or macOS
personal media worker. The worker installs like a normal desktop application, pairs once through the
already-authenticated browser, starts at login, uses outbound HTTPS only, and receives no database,
R2, RunPod, Runware, Google, or admin credential. If that account's worker is offline, its job waits
truthfully for the computer; it never borrows another tenant's device. V2-06 proved the hosted plane
and immutable beta releases: Windows is unsigned; macOS is ad-hoc sealed and non-notarized.

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

V2-00 and its independent audit are green. V2-01 is complete and independently re-audited green: additive migration
`0018_tenant_private_scope.sql` gives projects, revisions, assets, Avatar Profiles/versions, Image
Styles/versions, queue entries, attempts, outputs, costs, approvals, and audits an `account_id`
joined to `workspaces (account_id, id)`, so a cross-tenant row cannot be represented. Ownership is
derived by the database from the already-authorized parent row, which means a client-supplied owner
is overwritten rather than honoured. Pre-V2 rows are adopted by a reserved LEGACY account that no
identity can authenticate into, and pre-V2 admissions receive fresh empty accounts instead. Every
repository call now snapshots its inputs, binds `videoforge.account_id`, and validates the account's
ownership of the workspace in the same transaction. The active shared-app fixture also projects
tenant-local queue metadata, audits, orchestration, costs, outputs, and downloads, with foreign
reads and mutations returning non-revealing not-found responses. Invite redemption atomically creates exactly one
account, one default workspace, and one membership. Built-in presets are the only globally readable
records and reject every update and delete. The approved UI geometry is unchanged.

V2-02 is complete and independently re-audited green. Append-only migrations
`0019_tenant_artifact_receipts.sql` and `0020_tenant_artifact_isolation_repair.sql` provide canonical
v3 artifact identity, transfer-port, and commit-receipt contracts plus exact database key and
retention enforcement. The fake-R2 adapter has no list/copy/move/global-hash surface and cannot
replace an accepted immutable key. Object keys derive only from trusted
account/workspace/project/revision/lane/job/artifact identity. Exact
method/path/type/length/checksum ports are short-lived and bounded-replay; durable receipts bind
hashes, probes, retention, and deletion ownership. The superseded raw-key route is fixture-only and
fails construction without its explicit legacy firewall. Both model lanes accept scoped ports,
pin `/runpod-volume` as application-read-only policy, and route every mutable cache/output to
job-local scratch with path, ancestor/internal symlink, cross-mount, crash, refresh, and every
terminal-path cleanup negative. This remains provider-free proof, not real R2, hosted RLS, or
published Serverless-worker proof.

V2-03 implementation at audited HEAD `9fe0cfa3d470247e0b91eae50b012bd69ec34696` failed its first
independent audit. The four bounded findings were repaired at `fa01480fe6b4356ce986a6bd105b72a04ebdca8a`
and independently re-audited green at `268e26cb6cc28880854d6ca5d4290da05ee502e8`. Additive migrations `0021_fair_generation_admission.sql`
and `0022_v2_03_admission_audit_repairs.sql` plus the fair-admission
repository persist tenant-owned video and Mage/SoulX preview requests, deterministic account
last-served rotation, one active provider workload/account, and exactly two distinct-account global
leases. Videos always outrank previews; previews use a separate cursor. Owned waiting reorder/cancel,
retry, terminal release, lease heartbeat/expiry, reclamation, restart reconstruction, stale-version
fencing, and append-only audits are atomic. Ten-account contention yields exactly two winners, no
third slot, and complete video-account rotations before previews; explicit 1-, 2-, and 5-account
reports cover boundary distributions. Duplicate Generate replays idempotently, concurrent
cancel/promote is serialized, preview requests pin an owned or immutable built-in exact preset
version, and every reconstruction capacity correction is audited, including stale nonzero to zero.
Waiting rows create no task, outbox, artifact, ASR, render, or provider work. The active Node
Generate and Queue routes now use the same PGlite-backed `FairAdmissionRepository` and committed
migration chain; installed Chrome proves two different accounts active at the same time. The
ordinary Queue/Create UI exposes only private factual queue state and no GPU or Pod lifecycle
controls. The previous global-session fixture remains only for downstream provider-free media
execution and recovery compatibility; it is no longer admission or queue truth. Durable terminal
release promotes the next fair request while that compatibility executor retains its serial media
lifecycle, so earlier fixture recovery evidence remains valid without becoming admission truth.

At the V2-01 handoff, row level security was declared on every tenant table but not behaviourally
proven because PGlite connects as a superuser and bypasses it; the local proof came from the tenant
write guard and the `videoforge_tenant_*` views. V2-06 final live closure subsequently proved the
runtime role is non-superuser/non-`BYPASSRLS`, every tenant table uses forced RLS, and real private-R2
tenant isolation/deletion holds. `GATE_TENANCY_001` and `GATE_STORAGE_001` are closed.

V2-04 is complete, repaired, and provider-free. Its first audit at
`698f96ffd527df0e05e570687b93d2eb594a5c08` failed five trust-boundary checks; repair commit
`9da626cae846a524f282a1fa36be52455a60b03e` closes them with additive migration
`0025_serverless_v2_04_audit_repairs.sql`, exact assignment-gated status, verified reconciliation
receipts, exact non-null output job binding, typed paid resources/rate membership, and enforced
provider-result-window polling. A later audit at `d5825158073a5e255133a20ccfce560d60ae3f3f`
found that the result window still began at local attempt creation and that a signed receipt could
revive a cancelled attempt. Repair commit `2f530885fc6aed61688427c324e26606d8d5eac3`
adds migration `0026_serverless_result_window_and_cancellation_fence.sql`, starts request TTL at
provider submission, persists terminal observation/result expiry, and serializes cancellation and
canonical output acceptance with an application lock plus database trigger. Its provider-free
same-chat re-audit passes; no separate-agent independence is claimed. A subsequent independent
audit at `8d14fda8a4510866590c95684b345143a1612182` found two remaining semantic gaps: incomplete or
caller-authored artifact rows could be accepted behind one detached commit-receipt hash, and an
assignment was called terminal without observing `/status` while terminal discovery stopped at TTL.
Repair `3c219dd6a006dc22e6cddae3314fc79c8c2b5ea8` adds migration
`0027_serverless_output_binding_and_result_discovery.sql`, derives every canonical artifact from one
live tenant-owned commit receipt per batch item, exact-matches those facts to the separate signed
provenance items, and polls assigned jobs through the worst-case TTL-plus-1800-second horizon until
terminal observation. Its provider-free same-chat re-audit passes; no independent repair audit is
claimed. Additive migrations
`0023_serverless_attempts_and_outbox.sql` and
`0024_serverless_cost_and_reconciliation.sql`, canonical TypeScript/Python v3 contracts, and the
fake transport bind exact tenant/revision/lane/endpoint/config/image/model/volume/input/deadline/spend
facts before dispatch. A stable token and outbox exist before fake `/run`; provider assignment is
durable before status or output acceptance. Separate signed VideoForge provenance and exact
tenant-artifact commit receipts,
bounded unknown-ack reconciliation, advisory webhooks, cancellation/restart/TTL recovery, accepted-unit
resume, cost conservation, and at-most-one canonical output with visible duplicate compute/cost all
pass. Superseded Pod schemas are read-only compatibility evidence and cannot authorize v3 dispatch.
Canonical verification passed 28/28 package tasks and 44/44 installed-Chrome tests. No credential,
provider call, endpoint/image/volume mutation, worker, GPU, or spend occurred.

V2-05 is complete and provider-free. Additive migration `0028_v2_05_runtime_cutover.sql` gives
every admitted video independent durable stage state, per-lane state, append-only accepted units,
append-only runtime events, and a superseded-contract registry whose write fence rejects ordinary
production writes to `generation_sessions`, the session GPU pair tables, `global_queue_entries`,
`compute_run_plans`, the Pod lifecycle and dispatch tables, and `durable_generation_outputs`, while
leaving those rows readable as compatibility evidence. A runtime leaves `QUEUED` only behind a
durable admission, a lane binds an attempt only with its own durable items manifest plus exactly one
predispatch authority and coverage of exactly the unaccepted planned units, accepted units are
append-only facts of the video joined to live tenant artifact commit receipts, and render is fenced
behind every lane succeeding. The application composition carries two tenants' videos concurrently
through preparation, both exact lane batches, the asset barrier, render, and completion with zero
live attempts and `$0` settled cost, and proves queued inertness, lane independence, unknown
acknowledgement, duplicate-execution visibility, restart reconstruction, cancellation fencing, and
non-revealing cross-tenant negatives. `pnpm ci:static` now also runs the V2-05 runtime firewall.

The application now serves that truth end to end: Generate registers the durable runtime, private
queue views report factual owned stages and lane facts, waiting work remains inert, and finalization
requires a live tenant-private render receipt whose SHA-256, bytes, H.264/AAC probe, project,
revision, and render manifest all agree. Installed Chrome proves two accounts, the three locked
compositions, real 1920x1080 MP4 download/playback, cross-tenant refusal, and zero fake jobs/workers
after drain. V2 routes cannot call the compatibility orchestrator. At the V2-05 handoff, the emitted
production worker was import-free and failed API traffic closed pending V2-06 hosted adapters; its client bundle
contains no v1 shared-app route, manual Pod/GPU selector, inactive Echo route, repair override, or
fallback vocabulary. Local compatibility fixtures remain explicitly gated and the production UI
visibly says fixtures are not live.

V2-06 final live closure deployed executable source `e673527b7ac3dbb4db64f66a19a766cf1cf1d422`
and proved migration `0036`; two-account auth/RLS/R2/device/lease isolation; ASR/render; Workflow
recovery/cancel/replay fences; durable delete and inventory restoration; backup/restore; two-step
rollback health; Chrome playback; and Windows/macOS worker `0.1.11`. New spend was USD 0 under the
separate USD 1 cap; no recurring resource was created. RunPod stayed read-only at zero compute, with
two existing 50 GB volumes untouched. The final evidence-only audit passed and closed
`GATE_HOSTING_001`. Immutable provider evidence is not current authority; live refresh requires a
new read-only grant. V2-07 Attempt 18 independently reconciled RunPod to zero compute/resources and
both retained volumes after a successful endpoint PATCH response failed the complete matcher before
GET or dispatch. Cloudflare rollback and its 30-second route-stability window passed; cumulative
billing remained USD 0.12480033212341368 for a settled USD 0 attempt increment. The consumed
proposal `sha256:2752b61dfe4481eaa15ef349f859d91650160971a828d7d19af2638f7c8715be`
and its USD 4 authority cannot be reused. Provider-free control now accepts only an exact-ID,
non-conflicting partial PATCH acknowledgement while preserving complete exact GET readback. Fresh
proposal `sha256:ce11e4efb3b97f47c9ca70f83451ce6535e8467ac506b682527466f9327dafde`
and its USD 4 authority are consumed after Attempt 19 failed complete GET readback before dispatch.
Exact cleanup restored zero disposable resources, both retained volumes, unchanged billing, signer
absence, Worker version, and the disabled route. Image republication, volume mutation, fallback,
public sample publication, and V2-08 remain forbidden. The ordered
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
