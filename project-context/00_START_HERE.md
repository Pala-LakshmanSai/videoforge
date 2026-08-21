# VideoForge: start here

Status: V2-06 is complete and independently audited PASS. V2-07 remains NOT_QUALIFIED. Attempt27
accepted one complete 32-image probe with 32 private durable outputs and receipts, then stopped
fail-closed at `RUNPOD_WARM_IDLE_NOT_CONFIRMED`; its authority is consumed. Provider-free repair
`0084f6a13fdaa5a6d4b704e32e8b6cc22cecce14` now requires health-first quiescence plus two stable
exact terminal worker/Pod snapshots before any next dispatch. Fresh Attempt28 proposal
`sha256:12bb46d0d6403c888bc5ba7c965174f681baa5f45f320a90a4b1d4f0cf7f56cf` is unapproved with a
null cap. No provider mutation/GPU use/spend is authorized until exact approval and a fresh positive
numeric cap; V2-08 remains forbidden.
Historically, Attempt25 consumed its exact proposal and authority. Its startup safety proof
passed and one owned job reached `COMPLETED` with output status `SUCCEEDED`, but the run stopped
fail-closed at `output_finalization` with a bounded `UNKNOWN` transport diagnostic before any
accepted batch, durable output, or accepted receipt. Exact cleanup deleted only the disposable
endpoint/template after two stable terminal snapshots; three settled reconciliation reads prove
zero Pods/endpoints/templates/workers, both intended 50 GB EU-RO-1 volumes retained, and `$0`
incremental endpoint spend. Closure evidence is
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-25.json` at
`sha256:4b1d8b14f24b3e38a672cbe15b772590646bf35fe4e92f7a1046f23f13e5daf2`. That closure required a
fresh exact proposal and cap; Attempt27 now supplies separately recorded authority, while V2-08 remains
forbidden.

Attempt26 consumed exact proposal `sha256:0112b0b72254ef286643fc63bee0176fce327edc401ce40de4a3a860a5e68632`
and authority `sha256:bad94e64eab6fcbc03edf6521f02159ddb2f1c49407a6ca30dfc027fecad2d05`.
One owned diagnostic job reached provider `COMPLETED` and output `SUCCEEDED` after 816602 ms queue
delay and 118362 ms execution, then stopped fail-closed at `output_finalization` with
`V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID`; no batch/output/receipt was accepted. Closure
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-26.json` at
`sha256:f2839fefaafbe507ce447a4e374d502a971e75653b466f6703caa1a1f8e7c9ec` proves generated-output
rollback, exact endpoint/template deletion, zero Pods/endpoints/templates/workers, both intended
50 GB EU-RO-1 volumes retained, signer deletion/Worker rollback/stable disabled route, and `$0`
settled incremental endpoint spend. Attempt26 authority is consumed and non-reusable. Attempt27's exact
proposal, consumed cap, authority, and closure are recorded below.

Attempt27 candidate and closed execution:
`evidence/acceptance/VF-10-07/2026-08-21-attempt27-hosted-png-crc32-repair-candidate/combined-live-proposal.json`
at `sha256:5cb96aa79a4bb6f1fda3e6dadba7d6997421cc87cd2ed27f6a8ed92bee9fe7ae`. It binds the unchanged
published image, Mage model/manifest, sealed 50 GB EU-RO-1 volume at `/runpod-volume`, FlashBoot=true,
LOW EU-RO-1, RTX 4090 only, max-one `sha256:07749793fe28e158bad4314dbec128c30c6dcb3df52e7912837ec6dd10e27372`,
and max-two `sha256:1673a27538aef7796a364e125e812c26dc22c2c9a2b7c7671f615fa5af603a25`. It adds the
provider-free hosted PNG CRC32 table repair `1960ea9307bb7fcb591c842b84fc1c622aec49eb` while preserving
RunPod control `b8666dd8b8bc12578ffae8925f6ce73dbf53a841`. The proposal bytes retain a null cap by
design. The user approved this exact proposal with FlashBoot=true, LOW EU-RO-1 availability, and a
fresh maximum cumulative finite spend of `$4`. Append-only authority
`evidence/acceptance/VF-10-07/2026-08-21-attempt27-hosted-png-crc32-repair-candidate/approved-authority.json`
is recorded at `sha256:3bf923fb59df2ab0a0ff648ad8773ed549b2296aba66e82db9635c9fa7b66b10`.
The authority and reconciled context were committed and validated before execution; the authority is now
consumed and non-reusable. The accepted probe completed in 32,954 ms queue time and 115,855 ms execution,
with peak VRAM `14,177,206,272` bytes; its recorded timings are volume verification 18,911 ms,
model load 5,858 ms, warm-up 4,843 ms, first inference 763 ms, total 84,900 ms, and upload 18,572 ms.
Closure evidence is
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-27.json` at
`sha256:ffd622c4ee0a6a37311a51f191ce9c3ccbb0ae91620e51f64a03dfef932fb20d`.
Exact cleanup deleted only the disposable endpoint/template; three stable reconciliation reads prove
zero Pods/endpoints/private templates/active workers/running Pods, both intended 50 GB EU-RO-1 volumes
retained, baseline and final endpoint spend both `$0.29846311127766967`, and `$0` settled incremental
spend. The signer was deleted, the captured Worker version restored, and the route returned to a stable
`404 V207_ROUTE_DISABLED`. No image republication, model download/quantization, retained-volume mutation,
fallback GPU/region, public sample publication, V2-08, or successor work is authorized; a fresh exact
proposal and fresh positive numeric cap are required for any retry.

Historical Attempt24 exact template/endpoint identity work reached the pre-dispatch safety guard,
but `RUNPOD_QUIESCENT_NOT_CONFIRMED` stopped before `/run/job`; zero jobs and zero batches were
submitted. Historical Attempt24 control `63517e6` retains only structurally branded verification-stage diagnostics for
any future completed-job non-success, then stops without retry. Exact cleanup and three stable
reconciliation reads prove zero RunPod disposable resources, both intended 50 GB EU-RO-1 volumes
retained, billing from USD 0.18311072164215147 to USD 0.22078647126909345, and USD
0.03767574962694198 settled Attempt24 increment. Attempt24 proposal
`sha256:be17430ce61a48a823a1ac87a128e83e44cfb88b01163331c285280e95274137` and authority
`sha256:fccd60a68ee93f522d9e378012c5ccbefb182f6b03e26fde1b5940506ab9c412` are consumed and
closed. The user approved Attempt25 proposal
`sha256:c8baa8a45b8e3e108904cac5f04f472ad22da2936dad75daa2a59d23476a8946` with FlashBoot=true,
LOW EU-RO-1 availability, and a fresh `$4` cap. Authority
`sha256:2fc6072b88ca5069eef5510e6f0699faad977102565455495f89b56b02444b7c` is recorded and consumed;
no provider execution remains authorized. No image republication, model or retained-volume
mutation, fallback GPU/region, public sample publication, V2-08, or successor work is authorized.

Historical Attempt26 candidate: `evidence/acceptance/VF-10-07/2026-08-21-attempt26-finalize-transport-repair-candidate/combined-live-proposal.json`
at `sha256:0112b0b72254ef286643fc63bee0176fce327edc401ce40de4a3a860a5e68632`. It binds the exact
published image, Mage model/manifest, sealed 50 GB EU-RO-1 volume at `/runpod-volume`, FlashBoot=true,
LOW EU-RO-1, RTX 4090, Attempt25 closure `sha256:4b1d8b14f24b3e38a672cbe15b772590646bf35fe4e92f7a1046f23f13e5daf2`,
and local FINALIZE transport repair `b8666dd8b8bc12578ffae8925f6ce73dbf53a841`. Max-one is
`sha256:b64d008bac42fb13ec342028675a1bb498836981c553e884529ad846d6cdf964`; max-two is
`sha256:10f887ba47e8a7cac952374eb236fed08cb67962171769b65d96a4f0d3a7acf7`. The user approved the
exact proposal with FlashBoot=true, LOW EU-RO-1, and a fresh `$4` cap. Append-only authority
`evidence/acceptance/VF-10-07/2026-08-21-attempt26-finalize-transport-repair-candidate/approved-authority.json`
is `sha256:bad94e64eab6fcbc03edf6521f02159ddb2f1c49407a6ca30dfc027fecad2d05`. That authority is now
consumed by the failed-closed execution above; V2-08 remains forbidden.

Attempt 25 candidate path: `evidence/acceptance/VF-10-07/2026-08-21-attempt25-startup-terminal-inventory-candidate/combined-live-proposal.json`.
Attempt 25 startup-terminal-inventory candidate was approved and executed once under the exact
recorded authority and fresh `$4` cap; both are now consumed and non-reusable.
Attempt 25 proposal SHA-256: `sha256:c8baa8a45b8e3e108904cac5f04f472ad22da2936dad75daa2a59d23476a8946`.
It binds control `bb9abc03f286cae56bf874fe47dc1d7ebddb1fe9`, unchanged image/source/model/manifest,
the sealed Mage volume, FlashBoot=true, LOW EU-RO-1, and RTX 4090 only. The startup fallback is
allowed only before any owned job when health.jobs is present with inQueue=0 and inProgress=0 and
two matching terminal worker/Pod inventory snapshots are stable; post-dispatch, cancellation,
concurrent-reader, and drain checks remain health-first. Max-one is
`sha256:d7a5791c80fa96f997994c70486208af5faea93989a1cc3fe5033a0a911ddacd`; max-two is
`sha256:e1edf2d61b188428ce16e6f5597ceadc6ce7d58aa50dda4f8a7ea09e96bd0e38`. Authority record:
`evidence/acceptance/VF-10-07/2026-08-21-attempt25-startup-terminal-inventory-candidate/approved-authority.json`
at `sha256:2fc6072b88ca5069eef5510e6f0699faad977102565455495f89b56b02444b7c`. That provider authority
is consumed; V2-07 remains NOT_QUALIFIED and any retry requires fresh authority and cap.

Attempt 23 candidate path: `evidence/acceptance/VF-10-07/2026-08-21-attempt23-output-contract-diagnostic-candidate/combined-live-proposal.json`.
Attempt 23 proposal SHA-256: `sha256:386dd8330f8e626d9afe8c8de8bbd1385fd9664b9fefbc472c24722105f917f9`.
It pinned FlashBoot=true, LOW EU-RO-1, the unchanged Mage image/source, exact sealed volume, and
RTX 4090, with max-one then separately hashed max-two staged definitions. Max-one was
`sha256:45f8d447829d63517b78807ce710af7fbd81a9ff06d67cafe1a5a6bf37a15959`; max-two was
`sha256:6b02604fd7a58ee98c350429663c038bbc5c93ea2e0786e64ac3a6ef3f476e8b`. Attempt23 closure is
`failed-attempt-23.json` at
`sha256:0f48f3bc82b6d0b7fb48e723c4a3fc36a142129de578447acd30d77157e1ca1b`; the output status,
failure code, and shape remained unproven. Fresh exact approval and a fresh positive numeric cap
are required before any provider mutation or GPU use.

Attempt 23 closure: the authority is consumed, exact cleanup and final reconciliation are complete,
V2-07 remains NOT_QUALIFIED, and a fresh exact proposal and fresh positive numeric cap are required
for any retry. V2-08 remains forbidden.

Attempt 24 verification-stage diagnostic candidate: provider-free control
`63517e605d441fa23020bea8bff2987cc4bc99c5` retains only structurally branded
`output_failure_stage`, output status, failure-code, and shape facts from the first completed-job
non-success; unsafe or unbranded diagnostics fail closed, and no provider body or raw output is
retained. Candidate:
`evidence/acceptance/VF-10-07/2026-08-21-attempt24-verification-stage-diagnostic-candidate/combined-live-proposal.json`
at `sha256:be17430ce61a48a823a1ac87a128e83e44cfb88b01163331c285280e95274137`. It binds the
unchanged image/source, exact Mage manifest, sealed 50 GB EU-RO-1 volume at `/runpod-volume`,
FlashBoot=true, LOW EU-RO-1, RTX 4090, max-one
`sha256:345072150945c7dfa686c6b90b36565accd65ad5666f5c2917e160d5cf9f308a`, and max-two
`sha256:173e52dde1443d61f9a678e54ff859f2709797a3f4aa818f0402772887c2be8a`. The exact authority
is recorded below; provider mutation, publication, GPU use, or spend are authorized only after
the authority commit and within the fresh `$4` cap. Attempt23 closure is
`failed-attempt-23.json` at
`sha256:0f48f3bc82b6d0b7fb48e723c4a3fc36a142129de578447acd30d77157e1ca1b`.

Attempt 24 exact authority was recorded at
`evidence/acceptance/VF-10-07/2026-08-21-attempt24-verification-stage-diagnostic-candidate/approved-authority.json`
with SHA-256 `sha256:fccd60a68ee93f522d9e378012c5ccbefb182f6b03e26fde1b5940506ab9c412`. The user
approved proposal `sha256:be17430ce61a48a823a1ac87a128e83e44cfb88b01163331c285280e95274137`
with FlashBoot=true, LOW EU-RO-1 availability, and a fresh maximum cumulative finite spend of
`$4`. The authority bound the unchanged image/source/control, exact Mage volume and manifest,
RTX 4090, max-one then separately hashed max-two configurations, bounded output diagnostics,
cleanup/rollback, and V2-08 prohibition. It is consumed and closed: the pre-dispatch guard raised
`RUNPOD_QUIESCENT_NOT_CONFIRMED` before `/run/job`, and closure evidence
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-24.json` records exact
cleanup, zero disposable compute, retained volumes, and the settled USD 0.03767574962694198
increment. No provider authority remains; V2-07 remains NOT_QUALIFIED and any retry requires a
fresh exact proposal and fresh positive numeric cap.

Attempt 24 closure SHA-256: `sha256:12ca4be38d063f761537cc4184b387ae83feeaebc6e9bb102260feff6c347bcb`.

Attempt 22 candidate path: `evidence/acceptance/VF-10-07/2026-08-21-attempt22-template-environment-readback-candidate/combined-live-proposal.json`.
Attempt 22 proposal SHA-256: `sha256:96ead6591874229d93537af46a3159002e2fe86c93cc2905c42bbb1326ccece7`.
The user approved FlashBoot=true, LOW EU-RO-1, and a fresh USD 4 cap. That consumed authority is at
`evidence/acceptance/VF-10-07/2026-08-21-attempt22-template-environment-readback-candidate/approved-authority.json`
with SHA-256 `sha256:fecdfa6dee640d483a1787a726723bef08cdeaf455f5b7df0a2fbcdf3c3699f6`.
Attempt22 closure evidence: `evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-22.json`.
Closure evidence SHA-256: `sha256:43f9db51e67a39e4a837614be5af14299d91c4fbdd446b9d78ecc51260da517a`.
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
and its USD 4 authority were consumed after Attempt 19. Provider-free repair `b35f4a6` then allowed
only documented GET omissions. Attempt 20 under proposal
`sha256:9e9675dcf6943dce35b4bf6155fdfc39f8dade5e9775bcc3ee9a427980d39e02`
still failed GET identity binding before dispatch. Exact cleanup restored zero disposable resources,
both retained volumes, unchanged billing, signer absence, Worker version, and the disabled route.
Its USD 4 authority is consumed; no current cap or provider authority exists. Image republication,
volume mutation, fallback, public sample publication, and V2-08 remain forbidden. The ordered
checkpoints and copy-ready implementation/audit prompts supersede every removed planning file. Git
history records removed briefs; only evidence required by active foundations and gates remains in
the working tree.

Attempt 21 then consumed the exact diagnostic-readback proposal under its fresh USD 4 authority.
RunPod again stopped before `/run` with `RUNPOD_ENDPOINT_ID_BINDING_READBACK_UNCONFIRMED`; only
the bounded `environment` category was retained. Exact cleanup deleted the disposable endpoint and
template, both intended 50 GB EU-RO-1 volumes remain retained, cumulative billing stayed
`USD 0.12480033212341368`, and the Attempt 21 increment was USD 0. Closure evidence is
`evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-21.json` at
`sha256:cd7200aca5f532a3e9062b37c296cf412bce974605f44278156c23674710bd68`. V2-07 remains
NOT_QUALIFIED. Attempt22 later consumed its exact authority; no retry is currently authorized.

Attempt 22 is now historical consumed evidence. Control `54af72f1e9a29eed7f53e47ecdda9f6a34abb7df`
POSTs the endpoint-hash environment update, GETs exact template identity/environment, then PATCHes
documented endpoint fields and requires strict endpoint configuration readback. Endpoint environment
omission is accepted only after the exact template proof; any present endpoint environment must match.
The exact candidate is
`evidence/acceptance/VF-10-07/2026-08-21-attempt22-template-environment-readback-candidate/combined-live-proposal.json`
at `sha256:96ead6591874229d93537af46a3159002e2fe86c93cc2905c42bbb1326ccece7`, with approved
authority `sha256:fecdfa6dee640d483a1787a726723bef08cdeaf455f5b7df0a2fbcdf3c3699f6`, FlashBoot=true,
LOW EU-RO-1, and the consumed USD 4 cap. One job reached `COMPLETED` but no batch/output receipt was
accepted. Cleanup and reconciliation are complete; provider-free diagnosis is next and V2-08 remains
forbidden.

Attempt 23 is the approved pre-execution output-contract diagnostic. Control `9f5a15c3382c03af675392dacc487b96811674ed` records only
the safe `output_contract` category plus output status, failure-code, shape-kind, and shape-key facts
for the first completed-job non-success; it retains no provider body or raw output and stops without
retry, warm batch, reader dispatch, or duplicate submission. The candidate proposal is
`evidence/acceptance/VF-10-07/2026-08-21-attempt23-output-contract-diagnostic-candidate/combined-live-proposal.json`
at `sha256:386dd8330f8e626d9afe8c8de8bbd1385fd9664b9fefbc472c24722105f917f9`. The user approved
FlashBoot=true/LOW EU-RO-1 and a fresh USD 4 cap. Authority
`sha256:c59bd74673263eeeafed828dade74fe36ae2f27ed7914d413e37bfd6722a3b35` is recorded; provider
execution remains pending and is bounded to this exact proposal.

## Context navigation

Read `MANIFEST.yaml`, `CURRENT_STATE.yaml`, then only the selected profile and task. Normative
decisions: `15_DECISIONS_AND_OPEN_GATES.md`; architecture: `06_SYSTEM_ARCHITECTURE.md`; models:
`08_MODELS_AND_PROVIDERS.md`; pipeline: `07_PIPELINE_AND_SCHEDULER.md`; RunPod:
`09_RUNPOD_AND_QUEUE_OPERATIONS.md`; contracts: `10_DATA_AND_API_CONTRACTS.md`; cost:
`11_COST_SPEED_BUDGET.md`; acceptance: `14_TESTING_AND_ACCEPTANCE.md`; execution:
`21_IMPLEMENTATION_EXECUTION_PLAN.md`; completion checkpoints:
`22_PROJECT_COMPLETION_CHECKPOINTS.md`; copy-ready prompts:
`templates/CHECKPOINT_CHAT_PROMPTS.md`; maintenance: `16_CONTEXT_MAINTENANCE.md`.
