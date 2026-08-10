# VF-2-01 durable timing contract lock

Status: technically verified; VF-2-01 complete

Implementation commit `973d78affb6ca556b1eabf7d84f1d28a06705643` adds the additive
timing-lineage migration, canonical schema, repository contract, PGlite adapter, and acceptance
coverage. Corrective commit `d31100bc4345457d95d1bc1e2288de012239f268` closes Python contract
registry parity. The final verification below ran at `d31100b`.

## Contract and persistence proof

- `durable-timing-lineage/v1` links the existing immutable `transcript-timing/v1` and
  `timeline-plan/v1` documents; it does not create a competing timing or EDL payload.
- Migration 6 additively persists exact source, model, configuration, canonical-document, seed,
  selected span-audio, frame, word, and supersession lineage. Fresh application, upgrade from the
  exact five-migration baseline, and idempotent replay pass without rewriting legacy rows.
- Repository writes are workspace scoped, mutation-receipt idempotent, and guarded by optimistic
  timing-head versions. Cross-workspace reads and writes fail generically; stale revision hashes,
  stale transcript hashes, stale heads, malformed coverage, and mismatched span ownership fail
  closed.
- Words, sentences, phrases, timeline plans, durable segments, and invalidation events are
  immutable. Deferred database checks independently enforce exact partitions, source timing,
  complete frame and word coverage, canonical asset ownership, and ordered supersession.

## Determinism, invalidation, and recovery proof

- The same source/configuration/seed resolves the exact persisted transcript and timeline plan.
  Exact retries return the mutation-receipt result with `replayed: true`.
- A changed input appends one invalidation event, advances the optimistic head, and clears only the
  mutable selection. Byte-for-byte snapshots prove that the prior transcript, words, sentences,
  phrases, plan, segments, and selected spans are unchanged.
- Replacement transcript and plan generations explicitly supersede earlier immutable lineage.
- A metadata snapshot containing both generations and the invalidation restores into a clean
  migrated database, re-exports byte-identically, and resolves the exact replacement plan. The
  self-referential lineage FKs are transaction-deferred, so restore never disables triggers or
  mutates immutable rows after insertion.
- Adversarial direct SQL proves that a frame gap rolls back the complete transaction and that
  durable word/segment history rejects update or deletion.

## Audit findings closed

The corrective audit found and closed three material integration defects before acceptance:

1. The Phase 1 one-ready-transcript index initially blocked replacement lineage; it is now limited
   to legacy rows.
2. Snapshot restore initially deferred self-reference columns through post-insert updates, which
   conflicted with immutability; exact self references now restore under deferred FKs.
3. The first repository-wide verify exposed a missing hand-maintained Python registry/model entry;
   `d31100b` adds it, and both Python fixtures now validate through the same synchronized schema.

No high or medium audit finding remains. Source inspection found no external transport, ambient
environment read, credential operation, provider dispatch, cloud/account mutation, model download,
or spend path in the VF-2-01 change. The dependency-registry audit was intentionally not invoked
because this task's standing authority forbids external provider calls; all required local audit and
verification gates passed.

## Verification

The final `TURBO_FORCE=true pnpm verify` exited 0 at `d31100b` with zero Turbo cache hits. It passed
formatting, JavaScript/Python lint, TypeScript checks, generated parity, context/schema validation,
tracked-file secret scan, stable generated routes, local Workerd parity, and installed Chrome.

- Control plane: 119 passed, 0 failed, 0 skipped.
- Pipeline: 37 passed, 0 failed, 0 skipped.
- Web unit/integration: 148 passed, 0 failed, 0 skipped.
- Canonical contracts: TypeScript 53 passed; Python 42 passed.
- Local Workerd: 1 passed.
- Installed Chrome: 36 passed, zero skips.
- Synchronized canonical files: 50.

Separate `pnpm context:validate`, `pnpm secret:scan`, `git diff --check`, clean-worktree, and free
port `4173` checks passed after the full run. All database state and test media were local and
synthetic. External provider calls, cloud/account changes, credentials, model downloads, remote
publication, and spend remained disabled; external spend was `$0`.
