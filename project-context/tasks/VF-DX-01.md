# VF-DX-01 — Fast, non-duplicating local verification graph

Status: exact provider-free implementation brief; selected after VF-7-06

## Identity and dependencies

- Milestone: `devex_verification_feedback`.
- Depends on the green VF-7-06 preserve-and-detach decision handoff and the accepted application,
  contract, fixture, Workerd, and installed-Chrome baselines remaining unchanged.
- Read profile: `devex_verification_feedback`.
- Provider mode remains `fixture`; this task has no product, provider, cloud, or UI authority.

## Goal

Make ordinary engineering feedback materially faster without weakening the canonical gate: every
control-plane test and generated package build executes once per full verification graph, a warm
`pnpm verify:fast` completes within two minutes, and forced full local verification is at least 30%
faster than the recorded same-machine baseline with the identical test/suite inventory and zero new
skips.

## In scope

- Record a before-change, dependency-warm, `TURBO_FORCE=true pnpm verify` baseline from the clean
  VF-7-06 parent/implementation graph, including wall time, command/suite counts, test pass/skip
  counts, build executions, machine/runtime versions, and Git commit.
- Restructure root/package scripts and the Turbo DAG so build prerequisites are represented once.
  Package test commands must not recursively rebuild a package already built by the graph, and
  `pnpm db:check` must not cause a second full control-plane test run inside `pnpm verify`.
- Add `pnpm verify:fast` for provider-free format/static/type/generated/contract checks plus the
  deterministic unit/package/worker suites. It excludes local Workerd and installed-Chrome
  journeys, clearly says so in docs/output, and never becomes release evidence.
- Preserve `pnpm verify` as the canonical provider-free aggregate containing every current check,
  including local Workerd parity and all installed-Chrome journeys.
- Declare accurate Turbo inputs, environment dependencies, persistent/cache behavior, and outputs.
  A no-emit package must not claim `dist/**`; generated/compiled outputs may be cached only when
  their real source/config/runtime inputs are declared.
- Add deterministic verification-graph tests or an inspectable dry-run assertion proving the full
  graph contains one control-plane test task and one build task per emitting package.
- Record cold/forced and warm timings plus exact before/after inventory under
  `evidence/acceptance/VF-DX-01/verification-feedback-loop`.
- Update `README.md`, `19_IMPLEMENTATION_PLAYBOOK.md`, `CURRENT_STATE.yaml`, and only the minimum
  other context required to keep command truth consistent.

## Out of scope

- No GitHub Actions job split, required-check change, CI matrix, JUnit upload, or Chrome/FFmpeg
  install optimization; those belong to `VF-DX-02` after this local graph is stable.
- No `doctor --json`, `dev:stop`, environment-name centralization, telemetry, product behavior,
  route/UI/schema/database/provider adapter, migration, deployment, cloud/account mutation,
  credential access, model download, provider call, GPU/RunPod action, or spend.
- Do not delete, skip, shard away, loosen, or mark flaky any existing test/check to meet the target.

## Files and ownership

- One integration owner only. Own root `package.json`, `turbo.json`, the minimum affected package
  manifests/scripts/tests, command documentation, task evidence, and `CURRENT_STATE.yaml`.
- Lockfile changes are allowed only if strictly required by an approved existing dependency; adding
  a timing/task-runner dependency is not required and should be avoided.
- Preserve the stable loopback server/Chrome ownership rules; full verification may start only the
  test server instances it owns.

## Acceptance

- Baseline and final timing use the same machine, runtime versions, dependency state, provider-free
  environment, and forced-cache policy. Final forced `pnpm verify` wall time is at most 70% of the
  baseline. Timing noise must be reported, not hidden by comparing unlike cache states.
- Two consecutive warm `pnpm verify:fast` runs each finish in at most 120 seconds.
- Full before/after inventory is identical for test files/suites and pass/intentional-skip counts;
  Workerd and installed-Chrome counts are unchanged. No suite disappears behind a cache hit in the
  forced acceptance run.
- The full graph executes control-plane tests once and each emitting package build once. Generated
  contract/binding checks remain exact and leave no generated diff.
- `pnpm verify:fast`, `TURBO_FORCE=true pnpm verify`, `pnpm context:validate`,
  `pnpm secret:scan`, `pnpm audit:dependencies`, Prettier, and `git diff --check` pass at `$0`.
- One small implementation commit and one evidence/context handoff commit leave a clean worktree
  and select exactly one next dependency-ready provider-free brief.

## Safety and rollback

- `provider_calls_authorized: false`; remote/cloud mutations, credentials, downloads, and external
  spend are forbidden.
- Preserve canonical `pnpm verify` semantics. If the speed target requires fewer checks, weaker
  assertions, hidden skips, or environment-dependent caching, stop and report the measured blocker.
- Roll back with a normal Git revert of the narrow commits; never reset or rewrite accepted history.

## Required handoff

Record exact baseline/final durations and percentage, graph/build/test inventory, commands, commit,
and known limits. Select `VF-DX-02` only if this graph is green and an exact CI-split brief exists;
otherwise select the next already dependency-ready provider-free task without inventing authority.
