# VF-4-01 durable prompt execution evidence

Status: provider-free technical pass at `$0` on 2026-08-11.

- Migration `0009` adds append-only prompt execution, writer-attempt, and scene-result records with
  exact revision, current timeline, published style, task, attempt, outbox, reservation, asset, hash,
  retry, and cost lineage.
- Production `PGlitePromptExecutionStore` resolves authenticated authority and commits accepted
  bytes, output asset, attempts, scenes, cost settlement, attempt state, and task state atomically.
- Focused tests passed 26/26. Full control-plane passed 198/198. Forced full verification passed,
  including Workerd 1/1 and installed Chrome 38/38 with zero skips.
- Fresh, `0008` upgrade, reopen, metadata restore, exact replay, conflicting replay, cancellation,
  stale claims, workspace isolation, partial output, cost drift, and rollback are covered.

No provider call, credential, model download, cloud mutation, GPU action, or external spend occurred.
