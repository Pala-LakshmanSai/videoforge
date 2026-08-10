# `@videoforge/provider-sandbox`

Deterministic, provider-neutral safety harness for `VF-0D-01`. It exercises authorization,
identity binding, task/attempt cost caps, acknowledgement ambiguity, cancellation, timeout, and
cleanup evidence without credentials, network access, provider SDKs, resources, or external spend.

## Safety boundary

- Only an active `provider-sandbox-authorization/v1` envelope bound to the exact task hash is
  accepted.
- Task and authorization checks run before any injected transport method. A private-field guard
  accepts only genuine, non-subclassable, frozen `DeterministicFakeTransport` instances.
- The envelope and transport must prohibit provider calls, network access, credential reads,
  provider SDK access, and external spend.
- Every attempt evidence record binds the exact durable owner hash, task hash, execution-profile
  hash, input hash, authorization hash, task/attempt caps, reservation, deadline, cancellation
  intent, and derived attempt-binding hash.
- Task, owner, request, authorization, and attempt records are copied once from exact own data
  fields. Unknown fields, accessors, and cyclic shapes reject before reservation or transport
  access and never enter evidence hashing.
- All micro-USD values are synthetic ledger values. Evidence always records actual external spend
  as zero.
- Execution and cancellation reports are cumulative. Cancellation may only increase the observed
  amount; a regression is recorded as a protocol failure and the larger amount is reconciled.
- The ledger retains the largest observed cumulative cost as a floor. Unresolved commitment is the
  reservation plus its first-class overrun; final-known overruns settle the actual amount with zero
  refund, preserve `settled + refunded = reserved + overrun`, and never make remaining task
  capacity negative.
- An ambiguous acknowledgement is reconciled before execution. `STILL_UNKNOWN` keeps its
  reservation active and cannot be mistaken for completion or a free retry.
- Every transport result is runtime-validated before settlement. Acknowledged execution failures
  receive best-effort cancellation and cleanup, with each stage, actual cost/overrun, and compound
  failure retained in hashed evidence.
- Cleanup failure is a first-class outcome and never erases execution or cost lineage.
- Fake scenarios are exact runtime-validated fixtures; stage options must be statically compatible
  with the selected scenario. They remain immutable and unauthenticatable by forged objects even
  if mutable JavaScript object/WeakSet intrinsics are poisoned after import.

The deterministic record encoder sorts object keys and serializes bigint micro-USD values as
base-10 strings before hashing. It is scoped to sandbox evidence and does not replace VideoForge's
TypeScript RFC 8785 authority for canonical product contracts.

## Local checks

```bash
pnpm --filter @videoforge/provider-sandbox lint
pnpm --filter @videoforge/provider-sandbox typecheck
pnpm --filter @videoforge/provider-sandbox test
pnpm --filter @videoforge/provider-sandbox build
```
