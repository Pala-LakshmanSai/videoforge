# V2-06 staging rollback

Rollback is an approved operation, not ambient authority. This runbook is provider-operational
guidance; it is not evidence that rollback has been exercised.

1. Freeze the exact incident scope and record the deployed Worker version, source commit, release
   manifest hash, migration head, and active lease count. Do not delete R2, Neon, releases, or
   installer assets while leases may be active.
2. Stop new claims by deploying the recorded fail-closed Worker version or the prior immutable
   Worker version. Use the mode-0600 rendered config captured with that deployment; the tracked
   `apps/web/wrangler.staging.jsonc` intentionally still contains placeholders and is not a live
   rollback config. Inspect and pin the exact target, config SHA-256, Workflow binding, commit, and
   release manifest before invoking Wrangler:

   ```sh
   CONFIG=/secure/videoforge/v2-06/<recorded-rendered-config>.json
   EXPECTED_ACTIVE_VERSION_ID=<recorded-current-worker-version-id>
   PRIOR_VERSION_ID=<recorded-prior-worker-version-id>
   EXPECTED_CONFIG_SHA256=<recorded-rendered-config-sha256>
   EXPECTED_COMMIT=<recorded-prior-commit-sha>
   EXPECTED_RELEASE_SHA256=<recorded-release-manifest-sha256>
   : "${ROLLBACK_CONFIRM:?Set ROLLBACK_CONFIRM=YES in the approved operator environment}"
   test "$ROLLBACK_CONFIRM" = YES
   test -f "$CONFIG" && test ! -L "$CONFIG"
   test "$(stat -f '%Lp' "$CONFIG" 2>/dev/null || stat -c '%a' "$CONFIG")" = 600
   node - "$CONFIG" "$EXPECTED_CONFIG_SHA256" "$EXPECTED_COMMIT" "$EXPECTED_RELEASE_SHA256" <<'NODE'
   const fs = require("node:fs");
   const crypto = require("node:crypto");
   const [configPath, expectedConfigSha, expectedCommit, expectedReleaseSha] = process.argv.slice(2);
   const bytes = fs.readFileSync(configPath);
   const config = JSON.parse(bytes);
   const actualConfigSha = crypto.createHash("sha256").update(bytes).digest("hex");
   if (actualConfigSha !== expectedConfigSha || config.vars?.VIDEOFORGE_COMMIT !== expectedCommit ||
       config.vars?.MEDIA_WORKER_RELEASE_MANIFEST_SHA256 !== expectedReleaseSha ||
       config.name !== "videoforge-v2-06-staging" || config.vars?.VIDEOFORGE_PROVIDER_MODE !== "staging" ||
       config.r2_buckets?.[0]?.bucket_name !== "videoforge-v2-06-staging-private" ||
       config.workflows?.[0]?.name !== "videoforge-v2-06-staging-video" ||
       config.workflows?.[0]?.class_name !== "HostedVideoWorkflow") process.exit(2);
   NODE
   pnpm --filter @videoforge/web exec wrangler deployments list --json --config "$CONFIG" \
     > /secure/videoforge/v2-06/rollback-before.json
   node deploy/v2-06/verify-rollback-deployment.mjs before \
     /secure/videoforge/v2-06/rollback-before.json \
     "$EXPECTED_ACTIVE_VERSION_ID" "$PRIOR_VERSION_ID"
   pnpm --filter @videoforge/web exec wrangler rollback "$PRIOR_VERSION_ID" --yes \
     --message "V2-06 approved rollback to recorded immutable version" --config "$CONFIG"
   pnpm --filter @videoforge/web exec wrangler deployments list --json --config "$CONFIG" \
     > /secure/videoforge/v2-06/rollback-after.json
   node deploy/v2-06/verify-rollback-deployment.mjs after \
     /secure/videoforge/v2-06/rollback-after.json "$PRIOR_VERSION_ID"
   ```

   The post-rollback JSON must show `PRIOR_VERSION_ID` as the active/latest deployment and the
   Worker/Workflow/bucket/origin/commit/release values must remain exactly those in the recorded
   config. `--yes` is deliberately paired with the explicit shell confirmation and captured JSON;
   it is not a substitute for approval. If the prior config, hash, version, or Workflow class is
   unavailable or mismatched, stop: re-rendering with a different commit is a new activation and
   requires fresh approval and evidence.

3. Revoke only the affected account-owned device credentials, mark their exact active leases
   cancelled, and let the database fence every late completion. Never kill unrelated user processes.
   If a worker is offline, leave the lease to expiry/reconciliation rather than deleting rows.
4. Restore the previously recorded immutable desktop release manifest. A desktop downgrade is
   permitted only when its minimum protocol remains accepted; retain the prior Windows/macOS trust
   metadata and exact hashes.
5. Keep every migration in the committed manifest (currently through 0049) applied. They are
   additive; do not down-migrate auth, tenant, device, lease, upload-authority, receipt, review,
   serverless-output, or render-plan rows. Apply only a separately reviewed forward repair.
6. Retain the encrypted database backup and private R2 objects for the separately approved retention
   period. Delete them only through the recorded cleanup operation after `restore-drill.sh` verifies
   the exact committed migration manifest. Successful final objects are deleted only by the
   authenticated user-facing Delete operation; rollback never performs automatic final-output deletion.
7. Record the before/after deployment JSON, exact config SHA-256, Worker version, Workflow binding,
   desktop release/checksums/trust identities, complete migration-manifest hash, R2 inventory hash,
   active lease count, personal-worker provider CPU spend (`$0` expected), finite settled cost,
   RunPod worker count (`0` expected), and remaining recurring storage before declaring rollback
   complete. A zero personal-worker provider cost does not erase R2, Neon, Runware, retained
   RunPod-volume, or user-device/electricity costs.
