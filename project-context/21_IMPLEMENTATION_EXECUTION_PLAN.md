# Implementation execution plan

Status: execution router for the balanced MVP checkpoint roadmap
Read when: selecting, implementing, integrating, or handing off one task.

## Authority and routing

`22_PROJECT_COMPLETION_CHECKPOINTS.md` owns the canonical `CP-00` through `CP-12` order and
completion proof. `CURRENT_STATE.yaml` selects exactly one current task/read profile, and the exact
task brief controls files, dependencies, provider/credential/cloud/model-download authority, spend
cap, evidence, cleanup, rollback, and stop conditions.

Default is fixture mode, `$0`, no external mutation. No old task cap transfers forward. In
particular, historical Serverless/Echo attempts, endpoint resources, temporary volumes, and their
former `$8` authority are evidence only.

For `CP-06` through `CP-12`, the user's checkpoint implementation request starts a two-stage task:

1. **Provider-free activation and preflight.** Create/select a missing narrow brief/read profile,
   update and validate the selectors, implement and test all bounded local work, and perform only
   the prompt's allowlisted read-only inventory/rate queries through existing credentials. This
   stage permits no mutation, publication, model download, compute allocation, or spend.
2. **Paid execution.** At the first external mutation or paid boundary, make one combined request
   for the exact operations, exact selected offering/rate, numeric finite-action cap, derived volume
   size and recurring retention price/consent when relevant, and stop conditions. Record approval
   in the brief and current state, then execute without asking again unless that approved proposal
   changes or the cap is at risk.

A missing profile, brief, or paid authorization does not block safe stage-one work. A missing prior
checkpoint dependency or irreconcilable source/identity conflict still blocks promotion.

## Required checkpoint order

1. `CP-00`: context, reference, and roadmap lock.
2. `CP-01`: global-session vNext contracts and legacy dispatch firewall.
3. `CP-02`: shared admission, simple global queue, and idle-only GPU UX.
4. `CP-03`: production-grade word transcript and Cloud Run-compatible contract.
5. `CP-04`: deterministic three-composition scheduler and complete work plan.
6. `CP-05`: provider-free complete MVP orchestration and legacy cutover.
7. `CP-06`: exact Mage INT8 worker, isolated persistent volume, and real sample.
8. `CP-07`: exact Echo FP8 worker, isolated persistent volume, real clips, and crop lock.
9. `CP-08`: durable hosted staging, invite auth, private R2/Neon/Workflow, and Cloud Run Jobs.
10. `CP-09`: one real automatic three-composition MP4.
11. `CP-10`: real shared-session queue and automatic shutdown.
12. `CP-11`: 5–10-user reliability, quality, speed, cost, and recovery qualification.
13. `CP-12`: production release and operating proof.

Do not duplicate checkpoint acceptance here. Read its exact section in
`22_PROJECT_COMPLETION_CHECKPOINTS.md`, create/refine one bounded task brief, and stop if the prior
checkpoint is not accepted.

## Runtime serialization rules

- Exactly one global generation session and one active project exist in MVP. Mage and Echo may run
  concurrently only for that active project.
- Waiting entries are inert. They may be added, reordered, or removed, but cannot run prompts, ASR,
  model work, rendering, or artifact mutation before activation.
- The first idle Generate locks one exact receipt-bound Mage/Echo GPU pair. Every waiting entry
  inherits it; no user pair, mid-session GPU switch, or silent substitute is allowed.
- Waiting work may keep an already-running lane Pod warm. If a lane was already deleted, a late
  enqueue does not recreate it. Recreate only when the next project becomes active, using the same
  session GPU after fresh availability/rate revalidation.
- At zero waiting demand when a lane completes, delete it immediately even if the other lane or
  Cloud Run render continues. Queue drain requires both Pods absent before session close/unlock.
- Mage INT8 and Echo FP8 retain separate `EU-RO-1` model volumes. Routine stop/delete never targets
  either volume.
- Production whisper.cpp and FFmpeg execute in scale-to-zero Cloud Run Jobs over private R2. Mac
  execution is provider-free development parity only.

## Engineering parallelism

Runtime serialization does not prohibit agents from working on disjoint modules. After shared vNext
contracts lock, Mage-worker and Echo-worker implementation may proceed in parallel; isolated tests
may follow their owned modules. Serialize shared schemas, migrations, session/queue state, root UI,
provider mutations, context, commits, and integration through one owner.

No cross-project pipelining, advanced fairness engine, roles, multi-tenancy, per-user Pod pair,
parallel project execution, fallback, repair, or model substitution enters MVP.

## Verification and handoff

- Run focused tests, then the checkpoint's required provider-free or real-provider proof.
- Run context/schema validation and `git diff --check` whenever contracts/context change.
- Use real Chrome for user-visible behavior; fixture output never proves a real provider path.
- Paid checkpoints must record exact model/container/volume/GPU/rate identity, timings, settled
  cost, hashes/probes, durable receipts, deletion, and independent Pod absence.
- Thirty-minute variable generation targets `≤$1.00` and must not exceed `$2.00`; fixed retained
  volume billing stays separate.
- Update `CURRENT_STATE.yaml` and create one small green checkpoint commit before selecting the next
  checkpoint.

Stop external execution at missing paid authority, cap risk, stale/unavailable selected GPU,
cross-volume/model identity, runtime model download, ambiguous provider mutation without
reconciliation, unverified durable output, Pod absence failure, unexpected volume deletion,
schema/context failure, or dependency drift. Continue safe provider-free work when only paid
authority is missing.
