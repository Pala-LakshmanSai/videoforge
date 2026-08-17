# V2-06 staging rollback

Rollback is an approved operation, not ambient authority.

1. Stop new claims by deploying the recorded prior Worker version or the fail-closed hosted
   configuration. Do not delete R2, Neon, releases, or installer assets while leases may be active.
2. Revoke only the affected account-owned device credentials, mark their exact active leases
   cancelled, and let the database fence every late completion. Never kill unrelated user processes.
3. Restore the previously recorded Cloudflare Worker version and prior immutable signed desktop
   release manifest. A desktop downgrade is permitted only when its protocol remains accepted.
4. Keep migrations 0029-0032 applied. They are additive; do not down-migrate auth, tenant, device,
   lease, or receipt rows.
5. Retain the encrypted database backup and private R2 objects for the separately approved retention
   period. Delete them only through the recorded cleanup operation after the restore drill passes.
6. Record Cloudflare Worker version, desktop release/checksums/signing identities, migration hash, R2
   inventory hash, active lease count, provider CPU spend ($0 expected), finite settled cost, and
   remaining recurring storage before declaring rollback.
