# VF-7-07 style derived-artifact persistence evidence

Status: provider-free technical pass at `$0` on 2026-08-11.

- Migration `0010` adds immutable analysis-root/derived profile artifacts, edit records, current/root
  pointers, accepted-analysis backfill, deferred restore-safe references, and append-only guards.
- Production PGlite persistence locks the version, enforces workspace/revision/idempotency fences,
  records exact JCS bytes and changed pointers, invalidates review, and advances the current artifact
  atomically.
- Publication resolves and pins exact current derived bytes while preserving the immutable root
  analyzer lineage. Metadata export/restore includes every new table and cyclic pointer.
- Focused tests passed 36/36. Full control-plane passed 201/201. Forced full verification passed
  754 tests/journeys, including Workerd 1/1 and installed Chrome 38/38 with zero skips.
- Fresh, migration-`0009` upgrade, backfill, multiple edits, stale/cross-workspace rejection,
  exact/conflicting replay, reopen, restore, rollback, publication, and append-only enforcement are
  covered.

No provider call, credential, model download, cloud mutation, GPU action, or external spend occurred.
