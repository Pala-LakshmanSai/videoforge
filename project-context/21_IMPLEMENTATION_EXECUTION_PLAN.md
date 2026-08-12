# Implementation execution plan

Status: `VF-9-22` EchoMimicV3-Flash decision/preflight complete; `VF-9-23` selected
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
2. `VF-9-23` — selected: replace generic `workers/avatar-primary` internals with a pinned
   EchoMimicV3-Flash worker and bounded RTX 4090 sample runner. Provider spend `$0`; one hosted image
   build only after local green. Pin digest and prove full local/hosted verification.
3. `VF-9-24` — author/select only after `VF-9-23` passes: one native 10.12-second Elias RTX 4090
   attempt, maximum `$0.50`, one job, no retry, exact evidence, cleanup, installed-Chrome playback,
   then `READY_FOR_USER_REVIEW` and stop.
4. `VF-9-25` — only after explicit sample approval: durable provider acceptance/application
   integration at `$0`, additive migration `0014`, measured crop profile, no production promotion.
5. `VF-9-26` — separate later budget: 12–20-clip representative full Echo qualification.

## VF-9-23 ownership

- One serial lane owns `workers/avatar-primary`, its RunPod qualification runner, GHCR workflow,
  shared context, tests, and integration.
- Preserve signed transfer, checksum, cancellation, deadline, redaction, cost, unique-output,
  transient cleanup, and independent-zero boundaries.
- Exact Echo source and minimal dependencies enter image; model weights do not.
- Exact weights bootstrap into ephemeral `/models`; 100 GB container disk, no persistent volume.
- RTX 4090 24 GB only. `workersMin=0`, `workersMax=1`, one job, no ambiguity redispatch.

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

No tuning, retry, fallback, repair, application integration, deployment, production promotion, or
roadmap continuation after the sample without exact later authority.
