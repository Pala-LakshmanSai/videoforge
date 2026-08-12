# Implementation execution plan

Status: `VF-9-24I` FP8 long-video RTX sample selected
Read when: selecting, implementing, integrating, or handing off one task.

## Authority

`CURRENT_STATE.yaml` selects exactly one task. Fixture stays default. Every task ends with a small
green commit, push, hosted CI, refreshed state, and exactly one successor brief. Private inputs,
outputs, weights, and credentials never enter Git.

Historical AvatarForcing/MuseTalk/SkyReels decisions and evidence remain immutable replay history.
They authorize no new dispatch. LongCat remains excluded.

## Ordered sample-first execution

1. `VF-9-22` — complete: add `DEC_AVATAR_007`, pin source/weights/base/audio revisions and exact
   public license/access/file evidence, keep `GATE_AVATAR_001` open, add `GATE_AVATAR_004`, and
   preserve `VF-9-21` spend/evidence.
2. `VF-9-23` — complete: replaced generic `workers/avatar-primary` internals with a pinned
   EchoMimicV3-Flash worker and bounded RTX 4090 sample runner. Provider spend `$0`; one hosted image
   build only after local green. Pin digest and prove full local/hosted verification.
3. `VF-9-24` — stopped: its sole job caused RunPod to create three `EXITED` worker records before
   output. The guard cancelled execution, no MP4 was produced, observed balance delta was `$0`, and
   three independent post-cleanup inventories proved absolute zero. No retry is authorized.
3a. `VF-9-24A` through `VF-9-24H` — complete/stopped history: repaired observability and model
   pins, proved RTX 4090 BF16 OOM, then A100 capacity/download/cost limits. `VF-9-24H` remained
   active for about 21m54.9s and produced no MP4 before its cost stop. RunPod cleanup is absolute
   zero; cumulative lane spend is `$1.8200686945`.
3b. `VF-9-24I` — selected: publish a pinned TorchAO FP8 dynamic activation-and-weight worker,
   enable upstream Long Video CFG with 81-frame partial windows, then run the same exact 253-frame
   sample once on RTX 4090 after a fresh cumulative spend cap. Return MP4/timings and prove global
   zero.
4. `VF-9-25` — only after explicit sample approval: durable provider acceptance/application
   integration at `$0`, additive migration `0014`, measured crop profile, no production promotion.
5. `VF-9-26` — separate later budget: 12–20-clip representative full Echo qualification.

## VF-9-24I ownership

- One serial lane owns the exact private inputs, pinned worker dispatch, evidence, and cleanup.
- Preserve signed transfer, checksum, cancellation, deadline, redaction, cost, unique-output,
  transient cleanup, and independent-zero boundaries.
- Exact pinned weights bootstrap into a temporary persistent cache only after spend authority.
- RTX 4090 24 GB only. `workersMin=0`, `workersMax=1`, one job, no ambiguity redispatch.
- Source/image work may proceed at `$0`; RunPod mutation waits for a fresh cumulative cap.

## Verification

- Focused tests, then `pnpm verify:fast`.
- Milestone: `CI=1 TURBO_FORCE=true pnpm verify`, `pnpm context:validate`, `pnpm secret:scan`,
  `pnpm format:check`, `pnpm audit:dependencies`, and `git diff --check`.
- Push each completed task and confirm hosted CI/image build. Stop owned servers; tracked worktree
  clean except ignored private inputs/outputs.

## Stop conditions

Stop on dirty unexplained tracked state, source/manifest mismatch, dependency/container failure,
test/CI failure, GPU substitution, nonzero preflight inventory, provider ambiguity, cap/watchdog
risk, cleanup not independently proven, or missing new user authority.

No retry, other-model fallback, repair, application integration, deployment, production promotion,
or roadmap continuation after the sample without exact later authority.
