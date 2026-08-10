# VF-1-06 durable mock recovery convergence

Status: technically verified; VF-1-06 complete

Commit `dc86938972e776c8479637f2fb3ca9706999eed4` closes every finding preserved in
`CURRENT_STATE.yaml.paused_handoff`. The provider-free recovery composition now reconstructs one
bounded task snapshot from durable PGlite truth, keeps ambiguous dispatch quarantined, safely
re-delivers a definitely-not-sent dispatch without reserving a second attempt, fences terminal and
cancellation state, suppresses only safe sibling work before acceptance, and validates exact
per-attempt cost conservation.

## Audit closure

- `VF-1-06-AUDIT-01`: `NOT_DISPATCHED_CONFIRMED` restores the same attempt and requeues exactly one
  existing dispatch outbox. The local workflow regression proves the next delivery uses the same
  attempt, reservation, and outbox lineage.
- `VF-1-06-AUDIT-02`: acknowledgement, unknown, reconciliation, success, claim, acceptance, and
  terminal mutations reject cancelled or terminal task/attempt state. The cancellation regression
  exercises every late mutation and proves no later dispatch.
- `VF-1-06-AUDIT-03`: reservation and claim require eligible task and unfinished attempt state; the
  durable attempt cap is 32. The bounded regression proves terminal work is unclaimable and a 33rd
  attempt cannot be reserved.
- `VF-1-06-AUDIT-04`: acceptance atomically suppresses safe undispatched siblings, rejects active or
  finished-pending siblings, dead-letters runnable dispatches, and proves no work remains after
  `COMPLETE`. The rollback case proves an active sibling leaves no partial acceptance.
- `VF-1-06-AUDIT-05`: cost truth is summed per attempt without clamping or event minima. Every
  attempt must conserve reserved, released/refunded, reported, and settled totals exactly. Overrun,
  compound finalization, and over-finalization regressions prove transactional rollback.
- `VF-1-06-AUDIT-06`: recovery inspection uses one bounded aggregate SQL statement for at most 32
  attempts. Task-only cancellation uses atomic safe-state updates plus one-row unsafe-state fences
  rather than materializing unbounded outbox or attempt sets.
- `VF-1-06-AUDIT-07`: installed Chrome shows failed/cancelled work as stopped with no false retry;
  failed status uses terminal danger presentation. Desktop and compact recovery journeys pass.

Three fresh read-only post-commit audits independently covered UI truthfulness, repository/workflow
convergence, and cost/terminal invariants. No high or medium finding remained.

## Verification

The final uncached `TURBO_FORCE=true pnpm verify` exited 0 at the implementation commit with zero
Turbo cache hits. It passed format, JavaScript/Python lint, typecheck, the complete package and
worker suites, database checks, 47-file contract synchronization, context/schema validation,
tracked-file secret scan, generated-route/build stability, local Workerd parity (1/1), and installed
Chrome (36/36, zero skips). The control-plane suite passed 111/111 and the web suite passed 147/147.

The first root-gate attempt reached the runtime stage but correctly rejected port 4173 because the
recorded owned fixture server was still running. Only that owned server was stopped; the complete
uncached command was then rerun from the beginning and passed. Separate `pnpm context:validate`,
`pnpm secret:scan`, `pnpm audit:dependencies`, `git diff --check`, and clean-worktree checks also
passed. The dependency audit reported no known high-severity vulnerabilities.

All fixtures and artifacts were owned, synthetic, and local. Provider calls remained disabled,
external spend was `$0`, and no remote, cloud/account, credential, model-download, deployment,
public-tunnel, or LAN mutation occurred. Isolated staging remains awaiting separate authority.
