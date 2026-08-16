# V2-06 staging rollback

Rollback is an approved operation, not ambient authority.

1. Stop new browser traffic by deploying the recorded prior Worker version or the fail-closed
   hosted configuration. Do not delete R2, Neon, or Artifact Registry while jobs may be active.
2. Cancel only the exact recorded Cloud Run executions, then wait for every execution to become
   terminal. Cloud Run Jobs remain scale-to-zero and retain no running instances while idle.
3. Restore the two previously recorded Cloud Run Job manifests and prior immutable image digest.
4. Keep migration 0029 applied. It is additive; do not down-migrate auth, tenant, or receipt rows.
5. Retain the encrypted database backup and private R2 objects for the separately approved retention
   period. Delete them only through the recorded cleanup operation after the restore drill passes.
6. Record Worker version, job revisions, image digest, migration hash, R2 inventory hash, active
   execution count, finite settled cost, and remaining recurring storage before declaring rollback.
