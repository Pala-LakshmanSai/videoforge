# V2-06 staging rollback

Rollback is an approved operation, not ambient authority. This runbook is provider-operational
guidance; it is not evidence that rollback has been exercised.

1. Freeze the exact incident scope and record the deployed Worker version, source commit, release
   manifest hash, migration head, and active lease count. Do not delete R2, Neon, releases, or
   installer assets while leases may be active.
2. Stop new claims by deploying the recorded fail-closed Worker version or the prior immutable
   Worker version. For the Cloudflare CLI, inspect first and confirm the exact target explicitly:

   ```sh
   cd apps/web
   pnpm exec wrangler deployments list --config wrangler.staging.jsonc
   ROLLBACK_CONFIRM=YES pnpm exec wrangler rollback <recorded-prior-version-id> \
     --config wrangler.staging.jsonc
   ```

   The `ROLLBACK_CONFIRM=YES` marker is an operator reminder; Wrangler's own confirmation remains
   authoritative. Verify the active deployment version after the command before reopening claims.

3. Revoke only the affected account-owned device credentials, mark their exact active leases
   cancelled, and let the database fence every late completion. Never kill unrelated user processes.
   If a worker is offline, leave the lease to expiry/reconciliation rather than deleting rows.
4. Restore the previously recorded immutable desktop release manifest. A desktop downgrade is
   permitted only when its minimum protocol remains accepted; retain the prior Windows/macOS trust
   metadata and exact hashes.
5. Keep migrations 0029-0034 applied. They are additive; do not down-migrate auth, tenant, device,
   lease, upload-authority, receipt, or review rows. Apply only a separately reviewed forward repair.
6. Retain the encrypted database backup and private R2 objects for the separately approved retention
   period. Delete them only through the recorded cleanup operation after `restore-drill.sh` verifies
   migration head 34. Successful final objects are deleted only by the authenticated user-facing
   Delete operation; rollback never performs automatic final-output deletion.
7. Record Cloudflare Worker version, desktop release/checksums/trust identities, migration hash, R2
   inventory hash, active lease count, personal-worker provider CPU spend (`$0` expected), finite
   settled cost, RunPod worker count (`0` expected), and remaining recurring storage before declaring
   rollback complete. A zero personal-worker provider cost does not erase R2, Neon, Runware, retained
   RunPod-volume, or user-device/electricity costs.
