# `@videoforge/provider-sandbox`

Deterministic, provider-neutral safety harness for `VF-0D-01`. It exercises authorization,
identity binding, task/attempt cost caps, acknowledgement ambiguity, cancellation, timeout, and
cleanup evidence without credentials, network access, provider SDKs, resources, or external spend.

## Safety boundary

- Only an active `provider-sandbox-authorization/v1` envelope bound to the exact task hash is
  accepted.
- The envelope and transport must prohibit provider calls, network access, credential reads,
  provider SDK access, and external spend.
- Every attempt evidence record binds the exact durable owner hash, task hash, execution-profile
  hash, input hash, and derived attempt-binding hash.
- All micro-USD values are synthetic ledger values. Evidence always records actual external spend
  as zero.
- An ambiguous acknowledgement is reconciled before execution. `STILL_UNKNOWN` keeps its
  reservation active and cannot be mistaken for completion or a free retry.
- Cleanup failure is a first-class final outcome and never erases execution or cost lineage.

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
