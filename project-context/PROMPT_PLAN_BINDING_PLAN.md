# V2-09 / VF-10-09: canonical prompt plan binding and safe Retry

User2026-10-07 requests exact diagnosis, complete stage tracing, parallel agents,
implementation, verification and production publication. Baseline context3d6fd1f8,
executable4b2c9f7d / Workerc10de8bb / native286. Isolated branch preserves unrelated pricing work.

## Cause and scope

Preparation seals per-scene literal character limits. The dispatcher's duplicate
serializer omits those limits. The actual35-scene/four-batch gardening run fails
in231ms with zero provider claims, zero prompt cost and chargefalse. Offline replay
recreates the saved hash exactly; its old dispatch hash differs. Fixed shared
serialization recreates the original hash and recovers the immutable v39 policy.

Use one canonical serializer for prepare, dispatch and recovery. Preserve legacy
bytes and reject changed budgets. Regression must cross production preparation
into actual dispatch; earlier harnesses used the dispatcher's own incorrect hash.

Manual Retry may repair only a FAILED/INPUT_INVALID run whose exact old input and
plan hashes reconstruct correctly. Native preparation repeats zero-claim, zero
receipt/progress/cost and fully released reservation checks under existing locks.
Reuse normal bounded redispatch identities/ledger; never auto-retry INPUT_INVALID,
change policy, bypass cancellation or repeat uncertain paid work.

## Acceptance and publication

Run red/green production-boundary and legacy/tamper tests, native/PGlite financial,
tenant and cancellation tests, actual project read-only replay, affected types/lint,
build/quarantine, context/secrets and independent review. Publish additive287 and
the exact qualified Worker, preserving bindings/secrets/resources/native worker
pins and all three Workflow identities. Register changed server code and adopt
the existing singleton only at a proven idle boundary. Save write-ahead intents;
reconcile ambiguous mutations through read-only calls.

Real Chrome must show correct progress/Retry and retained Create/Queue/Library.
No new paid provider/media/compute action is authorized by this local qualification.
Original-project paid recovery needs an explicit finite verification scope; its
existing uncharged attempt and upstream accepted data remain intact until then.
Provider availability, full-film output, visual/editorial quality and inherited
broad-CI debt stay separate from this deterministic defect's acceptance.
