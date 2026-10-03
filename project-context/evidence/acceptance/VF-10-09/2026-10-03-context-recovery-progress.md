# Context recovery progress repair

Checkpoint V2-09, profile `v2_09_short_live_e2e`, branch `codex/seedance-video`. The user authorizes diagnosis, repair, functional verification and production publication. The isolated published release checkout preserves unrelated primary-workspace changes. Rollback baseline is source `8a4dae91` / Worker `e58efab8`.

## Exact cause

The original context attempt was `UNKNOWN` / `AMBIGUOUS` with `VOICEOVER_CONTEXT_NETWORK_UNCERTAIN`, after a request started at 16:29:23 UTC. The transport has a 120-second deadline; the diagnostic records a fetch failure but does not preserve whether its underlying cause was timeout or a connection error. The existing bounded server continuation created one replacement at 16:31:47 UTC. That replacement succeeded and settled at 16:33:47 UTC for 563 micro-USD. Prompt writing began at 16:33:55 UTC. At the user's 22:14 IST screenshot, its roughly ten-minute elapsed display was correct.

The server presented every UNKNOWN context as a FAILED stage. `hostedProjectPollInterval` then treated that stage as terminal and returned false, stopping background reads despite pending automatic server recovery. The first screenshot therefore retained a failed snapshot while the server had advanced. A later browser refresh/focus/read caught up and exposed the accumulated prompt elapsed time. Two prepatch regressions reproduce false rather than the required 2000ms poll interval. The error response also said no automatic retry while stage detail promised automatic retry.

## Repair and preservation

Project detail derives `automatic_retry_pending` from the same successful-ASR, FAILED/UNKNOWN, absent-context-hash, retryable-code and remaining-30-attempt gates used by the existing continuation. Pending recovery presents RETRY_WAIT; the UI maps that to RETRYING, keeps two-second background polling and uses consistent recovery copy. Invalid results, unknown deadlines outside that policy, exhausted retries and accepted-result fences remain terminal. An old retrieval error does not override a pending recovery notice. HTTP error text defers to current Progress status.

No provider dispatch, replacement policy, task identity, cost reservation, model, native worker, schema migration, scheduler, stage timestamp or timer calculation changes. Existing bounded paid recovery and historical ambiguity remain independently accountable; this patch adds no paid request or replay.

## Verification

432 web checks pass across product routes, complete hosted screens, context extraction and continuation sweep. New coverage includes UNKNOWN/FAILED polling, real component refresh without a focus event, RETRYING and no misleading project-stopped message, removal of stale errors after recovery, the original ten-minute prompt timestamp, no context inference POST, budget boundary, invalid response, request deadline, succeeded result and accepted-hash fences. Web and Worker types, changed-file lint, production and staging builds/firewalls, context validation, secret scan and diff checks pass.

Canonical provider-free verify was attempted: Workerd smoke passes, but existing formatting debt (132 files) and absent pinned uv 0.8.13 prevent aggregate completion. These are separate baseline limitations; no unrelated formatting or dependency changes are included.

Private inspection, test/build/publication receipts and authenticated compatibility evidence are retained under primary-checkout `.videoforge/context-recovery-20261003/`. Production and Chrome verification are recorded after publication below. No fresh paid full-film, installed Local, editorial, performance or invoice acceptance is claimed.
