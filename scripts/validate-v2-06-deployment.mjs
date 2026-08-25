import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const fail = (message) => {
  throw new Error(`V2-06 deployment contract: ${message}`);
};
const parseJsonc = (source) => JSON.parse(source.replace(/,\s*([}\]])/gu, "$1"));

const manifest = JSON.parse(await read("packages/control-plane/migrations/manifest.json"));
if (
  manifest?.schema_version !== "videoforge-migration-manifest/v1" ||
  !Array.isArray(manifest.migrations) ||
  manifest.migrations.length === 0
)
  fail("committed migration manifest is invalid");
for (const [index, entry] of manifest.migrations.entries()) {
  if (entry.version !== index + 1) fail("migration manifest is not a contiguous chain");
  const migration = await read(`packages/control-plane/migrations/${entry.filename}`);
  const actualHash = `sha256:${createHash("sha256").update(migration).digest("hex")}`;
  if (entry.sha256 !== actualHash) fail(`migration ${entry.version} hash is stale`);
}
const migrationHead = manifest.migrations.at(-1).version;
for (const [version, name] of [
  [37, "hosted_serverless_output_barrier"],
  [38, "hosted_render_plan_append_contract"],
]) {
  const entry = manifest.migrations.find((candidate) => candidate.version === version);
  if (entry?.name !== name) fail(`required migration ${version} is absent or misidentified`);
}

const wrangler = parseJsonc(await read("apps/web/wrangler.staging.jsonc"));
const viteConfiguration = await read("apps/web/vite.cloudflare.config.ts");
if (
  !viteConfiguration.includes("const requestedMode = process.env.VITE_VIDEOFORGE_PROVIDER_MODE") ||
  !viteConfiguration.includes(
    'const providerMode = requestedMode ?? (command === "build" ? "production" : "fixture")',
  ) ||
  !viteConfiguration.includes('providerMode === "staging"') ||
  !viteConfiguration.includes('"./wrangler.staging.jsonc"')
)
  fail("staging build is not bound to its hosted Worker configuration");
if (wrangler.name !== "videoforge-v2-06-staging") fail("unexpected Worker name");
if (wrangler.main !== "./worker/staging-index.ts")
  fail("staging qualification routes must stay outside the production Worker entrypoint");
if (wrangler.account_id !== "__V2_06_CLOUDFLARE_ACCOUNT_ID__")
  fail("staging deploy must pin the approved Cloudflare account placeholder");
if (wrangler.vars?.VIDEOFORGE_PROVIDER_MODE !== "staging") fail("Worker must be staging-only");
if (wrangler.no_bundle !== true)
  fail("staging build must keep Vite's no-bundle output generation enabled");
if (wrangler.vars?.VIDEOFORGE_COMMIT !== "__V2_06_DEPLOYED_COMMIT__")
  fail("staging deploy must record an immutable source commit");
if (wrangler.r2_buckets?.[0]?.binding !== "PRIVATE_ARTIFACTS") fail("private R2 binding missing");
if (wrangler.r2_buckets?.[0]?.bucket_name !== "videoforge-v2-06-staging-private")
  fail("R2 bucket name drifted");
if (
  wrangler.workflows?.[0]?.binding !== "VIDEO_WORKFLOW" ||
  wrangler.workflows?.[0]?.class_name !== "HostedVideoWorkflow"
)
  fail("Workflow binding drifted");
if (JSON.stringify(wrangler.triggers?.crons) !== JSON.stringify(["17 2 * * *"]))
  fail("bounded retention cron drifted");
if (wrangler.assets?.directory !== "./dist-staging/client")
  fail("staging assets must exclude server build artifacts");
if (
  wrangler.vars?.MEDIA_WORKER_RELEASE_MANIFEST_JSON !==
  "__V2_06_PERSONAL_WORKER_RELEASE_MANIFEST_JSON__"
)
  fail("personal worker release identity placeholder drifted");
if (wrangler.vars?.R2_ACCOUNT_ID !== "__V2_06_CLOUDFLARE_ACCOUNT_ID__")
  fail("non-secret R2 account identity must remain an exact deployment variable");
if (Object.keys(wrangler.vars ?? {}).some((key) => key.startsWith("GCP_")))
  fail("retired Google Cloud compute configuration remains active");

const expectedSecrets = [
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MEDIA_WORKER_TOKEN_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "WORKFLOW_CALLBACK_SECRET",
].sort();
const secretAllowlist = JSON.parse(await read("deploy/v2-06/secrets.allowlist.json"));
const actualSecrets = [...(secretAllowlist.required ?? [])].sort();
if (JSON.stringify(actualSecrets) !== JSON.stringify(expectedSecrets))
  fail("least-privilege secret allowlist drifted");
if (
  JSON.stringify([...(secretAllowlist.optional_together ?? [])].sort()) !== JSON.stringify([]) ||
  secretAllowlist.email_provider !== "NONE" ||
  JSON.stringify([...(secretAllowlist.forbidden ?? [])].sort()) !==
    JSON.stringify(["EMAIL_DELIVERY_API_KEY", "EMAIL_DELIVERY_ENDPOINT"])
)
  fail("email-delivery policy must be disabled and unambiguous");
if (JSON.stringify(secretAllowlist.non_secret_vars ?? []) !== JSON.stringify(["R2_ACCOUNT_ID"]))
  fail("non-secret deployment variables drifted");
if (
  secretAllowlist.scopes?.R2_ACCESS_KEY_ID !==
    "Cloudflare R2 S3 credential scoped to videoforge-v2-06-staging-private" ||
  secretAllowlist.scopes?.R2_SECRET_ACCESS_KEY !==
    "Cloudflare R2 S3 credential scoped to videoforge-v2-06-staging-private"
)
  fail("R2 credentials are not explicitly bucket-scoped");
if ("secrets" in wrangler)
  fail("Wrangler config must not contain a nonstandard or secret-bearing secrets field");

const neonRuntimeGrants = await read("deploy/v2-06/neon-runtime-grants.sql");
if (!neonRuntimeGrants.includes("GRANT EXECUTE ON FUNCTION public.videoforge_current_account_id()"))
  fail("RLS tenant-principal function grant is missing");
if (!neonRuntimeGrants.includes('GRANT SELECT ON workspaces TO :"runtime_role";'))
  fail("hosted tenant workspace read grant is missing");
if (!neonRuntimeGrants.includes('GRANT SELECT ON hosted_render_plans TO :"runtime_role";'))
  fail("immutable hosted render-plan read grant is missing");
if (
  !neonRuntimeGrants.includes(
    "GRANT EXECUTE ON FUNCTION public.videoforge_append_hosted_render_plan(",
  )
)
  fail("exact hosted render-plan append function grant is missing");
if (
  /GRANT\s+[^;\n]*(?:INSERT|UPDATE|DELETE)[^;\n]*\bON\s+hosted_render_plans\b/iu.test(
    neonRuntimeGrants,
  )
)
  fail("hosted render plans must never be writable by the runtime role");
if (
  !neonRuntimeGrants.includes("Neon hosted owners cannot ALTER ROLE attributes") ||
  !neonRuntimeGrants.includes("NOBYPASSRLS") ||
  !neonRuntimeGrants.includes('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"runtime_role";') ||
  !neonRuntimeGrants.includes('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"runtime_role";')
)
  fail("Neon runtime role is not explicitly non-owner/non-bypass and default-revoked");
if (
  neonRuntimeGrants.includes("global_generation_capacity") ||
  neonRuntimeGrants.includes("provider_workload_leases") ||
  neonRuntimeGrants.includes("workflow_instances")
)
  fail("superseded global/provider tables entered the personal-worker runtime grants");

const activation = JSON.parse(await read("deploy/v2-06/activation.template.json"));
if (
  activation.checkpoint !== "V2-06" ||
  activation.gpu?.transport !== "FAKE_DISABLED" ||
  activation.gpu?.runpod_calls !== 0
)
  fail("checkpoint or GPU firewall drifted");
if (activation.authority?.maximum_cumulative_finite_external_spend_usd !== null)
  fail("template must not invent a spend cap");
if (activation.authority?.email_provider !== "NONE")
  fail("activation template must keep email/password delivery disabled");
if (
  activation.cloudflare?.r2_storage_class !== "STANDARD" ||
  activation.spend_truth?.finite_external_spend_usd !== null ||
  activation.spend_truth?.cloudflare_worker_compute_usd !== 0 ||
  activation.spend_truth?.neon_compute_usd !== 0 ||
  activation.spend_truth?.r2_storage_and_operations_usd !== 0 ||
  activation.spend_truth?.personal_worker_provider_compute_usd !== 0 ||
  activation.spend_truth?.runpod_compute_usd !== 0 ||
  activation.secret_policy?.runtime_role !== "NON_SUPERUSER_NO_BYPASS_RLS" ||
  activation.secret_policy?.r2_credential_scope !== "BUCKET_ONLY"
)
  fail("zero-spend or least-privilege activation policy drifted");
if (
  activation.personal_media_workers?.release_manifest_sha256 !== "__V2_06_RELEASE_MANIFEST_SHA256__"
)
  fail("activation template must require an immutable release manifest SHA-256 pin");
for (const [label, value] of [
  ["Worker", activation.cloudflare?.worker],
  ["Workflow", activation.cloudflare?.workflow],
  ["R2 bucket", activation.cloudflare?.r2_bucket],
  ["R2 location", activation.cloudflare?.r2_location],
  ["staging domain", activation.cloudflare?.domain],
]) {
  if (typeof value !== "string" || value.length === 0)
    fail(`activation template lost its ${label} pin`);
}

const r2Cors = JSON.parse(await read("deploy/v2-06/r2-cors.template.json"));
if (
  !r2Cors ||
  !Array.isArray(r2Cors.rules) ||
  r2Cors.rules.length !== 1 ||
  JSON.stringify(r2Cors.rules[0]?.allowed?.origins) !==
    JSON.stringify(["__V2_06_EXACT_PUBLIC_ORIGIN__"]) ||
  JSON.stringify([...(r2Cors.rules[0]?.allowed?.methods ?? [])].sort()) !==
    JSON.stringify(["GET", "HEAD", "PUT"].sort()) ||
  JSON.stringify([...(r2Cors.rules[0]?.allowed?.headers ?? [])].sort()) !==
    JSON.stringify(["Content-Type", "x-amz-checksum-sha256"].sort()) ||
  !r2Cors.rules[0]?.exposeHeaders?.includes("ETag") ||
  r2Cors.rules[0]?.maxAgeSeconds !== 3600
)
  fail("origin-exact R2 browser upload CORS contract drifted");
if (JSON.stringify(r2Cors).includes("AllowedOrigins") || JSON.stringify(r2Cors).includes('"*"'))
  fail("R2 CORS must use Wrangler's lowercase rules shape without wildcard access");

const releaseTemplate = JSON.parse(await read("deploy/v2-06/media-worker-release.template.json"));
if (
  releaseTemplate.schema_version !== "videoforge-media-worker-release/v1" ||
  releaseTemplate.minimum_protocol_version !== 1 ||
  releaseTemplate.windows?.trust !== "UNSIGNED_BETA" ||
  releaseTemplate.macos?.trust !== "AD_HOC_BETA" ||
  !String(releaseTemplate.windows?.url).startsWith("https://") ||
  !String(releaseTemplate.macos?.url).startsWith("https://")
)
  fail("personal worker release template drifted");
for (const path of [
  "apps/media-worker-desktop/videoforge-worker.spec",
  "apps/media-worker-desktop/windows-installer.iss",
  "apps/media-worker-desktop/compute_execution_bundle_sha256.py",
  "workers/media-local/src/videoforge_media_local/personal_worker.py",
  ".github/workflows/media-worker-release.yml",
]) {
  if ((await read(path)).trim().length < 100) fail(`${path} is incomplete`);
}
const personalWorkerSource = await read(
  "workers/media-local/src/videoforge_media_local/personal_worker.py",
);
if (/^from \./mu.test(personalWorkerSource))
  fail("frozen worker entry still depends on package-relative imports");
const windowsInstaller = await read("apps/media-worker-desktop/windows-installer.iss");
if (
  !windowsInstaller.includes('Parameters: "/C taskkill /IM ""{#WorkerExe}"" /T /F"') ||
  /Parameters:.*\\"/u.test(windowsInstaller)
)
  fail("Windows uninstall command must use Inno Setup doubled-quote escaping");
const releaseWorkflow = await read(".github/workflows/media-worker-release.yml");
const executionBundleScript = await read(
  "apps/media-worker-desktop/compute_execution_bundle_sha256.py",
);
if (
  !executionBundleScript.includes(
    'SCHEMA_VERSION = "videoforge-personal-worker-execution-bundle/v1"',
  ) ||
  !executionBundleScript.includes("execution bundle identity requires a clean Git worktree") ||
  !executionBundleScript.includes("pinned_release_inputs")
)
  fail("personal worker execution identity must be canonical and clean-worktree bound");
if (
  !releaseWorkflow.includes("publish_release:") ||
  !releaseWorkflow.includes("compute_execution_bundle_sha256.py") ||
  !releaseWorkflow.includes('test "$computed" = "$EXECUTION_BUNDLE_SHA256"') ||
  !releaseWorkflow.includes('codesign --force --deep --sign - "dist/VideoForge Worker.app"') ||
  !releaseWorkflow.includes("grep -q 'Signature=adhoc'") ||
  !/hdiutil verify "VideoForge-Worker-[0-9]+\.[0-9]+\.[0-9]+\.dmg"/u.test(releaseWorkflow) ||
  !releaseWorkflow.includes('"UNSIGNED_BETA"') ||
  !releaseWorkflow.includes('"AD_HOC_BETA"') ||
  !releaseWorkflow.includes("gh release create") ||
  !/notarytool submit "VideoForge-Worker-[0-9]+\.[0-9]+\.[0-9]+\.dmg"/u.test(releaseWorkflow) ||
  !/stapler staple "VideoForge-Worker-[0-9]+\.[0-9]+\.[0-9]+\.dmg"/u.test(releaseWorkflow)
)
  fail("ImageForge-style beta and optional signed worker publication gates are incomplete");
const hostedApp = await read("apps/web/src/server/hosted/app.ts");
const hostedAuth = await read("apps/web/src/server/hosted/auth.ts");
const hostedPersonalWorker = await read("apps/web/src/server/hosted/personal-worker.ts");
const hostedWorkflow = await read("apps/web/worker/hosted-workflow.ts");
const hostedGoogleOnlyMigration = await read(
  "packages/control-plane/migrations/0036_v2_06_google_only_replay_boundaries.sql",
);
const hostedR2 = await read("apps/web/src/server/hosted/r2.ts");
const hostedRetention = await read("apps/web/src/server/hosted/retention.ts");
if (
  !hostedAuth.includes("emailAndPassword: { enabled: false }") ||
  /emailAndPassword:[\s\S]{0,240}?enabled:\s*true/u.test(hostedAuth) ||
  !hostedApp.includes('authentication: ["GOOGLE"]')
)
  fail("V2-06 hosted auth must keep email/password disabled and Google-only");
if (
  !hostedPersonalWorker.includes("ABANDONED_PERSONAL_WORKER_LEASE_DURING_CLAIM") ||
  !hostedPersonalWorker.includes("RETURNING attempt.id") ||
  !hostedPersonalWorker.includes("kind = $5 AND facts_sha256 = $4") ||
  !hostedPersonalWorker.includes("replay_count >= 32") ||
  !hostedPersonalWorker.includes("PERSONAL_WORKER_REPLAY_LIMIT") ||
  !hostedWorkflow.includes("replay_count + 1") ||
  !hostedWorkflow.includes('kind: "CANCELLED" | "EXPIRED" | "FAILED" | "REPLAYED"')
)
  fail("personal-worker recovery must append bounded, idempotent hosted events");
if (
  !hostedGoogleOnlyMigration.includes("hosted_auth_accounts_google_only_check") ||
  !hostedGoogleOnlyMigration.includes("provider_id = 'google'") ||
  !hostedGoogleOnlyMigration.includes("hosted identity has no supported Google auth account")
)
  fail("hosted Google-only identity must be enforced by the database migration");
if (
  !hostedApp.includes("handleCpuOutputDelete(") ||
  !hostedApp.includes('request.method === "DELETE"') ||
  !hostedApp.includes('reason: "EXPLICIT_USER_DELETE"')
)
  fail("explicit owned-output R2 deletion route is absent");
if (
  !hostedR2.includes("deleteHostedR2ObjectsAndVerify") ||
  !hostedR2.includes("Hosted R2 post-delete verification found retained objects") ||
  !hostedApp.includes("post_delete_verification: deletion") ||
  !hostedRetention.includes("deleteHostedR2ObjectsAndVerify(bucket, row.object_prefix, deleted)")
)
  fail("hosted R2 deletion must verify the exact attempt prefix before durable deletion state");

const observability = JSON.parse(await read("deploy/v2-06/observability.template.json"));
if (observability.logs?.secret_values !== false || observability.logs?.signed_urls !== false)
  fail("observability redaction drifted");
if (!Array.isArray(observability.alerts) || observability.alerts.length < 5)
  fail("hosted alert coverage is incomplete");
for (const path of [
  "deploy/v2-06/backup.sh",
  "deploy/v2-06/restore-drill.sh",
  "deploy/v2-06/rollback.md",
  "deploy/v2-06/verify-r2-cors.sh",
  "deploy/v2-06/verify-r2-cors.mjs",
  "deploy/v2-06/render-r2-cors.mjs",
  "deploy/v2-06/apply-migrations-and-grants.mjs",
  "deploy/v2-06/render-staging-config.mjs",
  "deploy/v2-06/verify-rollback-deployment.mjs",
]) {
  if ((await read(path)).trim().length < 100) fail(`${path} is incomplete`);
}
const backupScript = await read("deploy/v2-06/backup.sh");
const restoreScript = await read("deploy/v2-06/restore-drill.sh");
const rollbackRunbook = await read("deploy/v2-06/rollback.md");
const deploymentRunbook = await read("deploy/v2-06/README.md");
const configRenderer = await read("deploy/v2-06/render-staging-config.mjs");
const corsRenderer = await read("deploy/v2-06/render-r2-cors.mjs");
const migrationActivation = await read("deploy/v2-06/apply-migrations-and-grants.mjs");
const tenantPresetSeed = await read("deploy/v2-06/seed-tenant-presets.mjs");
const ownedRenderFixture = await read("deploy/v2-06/provision-owned-render-fixture.mjs");
const ownedFixtureProvisioner = await read("deploy/v2-06/provision-owned-fixture.mjs");
if (
  !rollbackRunbook.includes("verify-rollback-deployment.mjs before") ||
  !rollbackRunbook.includes("verify-rollback-deployment.mjs after")
)
  fail("rollback runbook must use the pinned deployment snapshot verifier");
if (
  tenantPresetSeed.length < 1000 ||
  !tenantPresetSeed.includes("V2_06_MIGRATION_DATABASE_URL") ||
  !tenantPresetSeed.includes("V2_06_SEED_CONFIRM=YES") ||
  !tenantPresetSeed.includes("V2_06_AVATAR_RIGHTS_CONFIRM=YES") ||
  !tenantPresetSeed.includes("DEFAULT_AVATAR_ENVELOPE_HASH") ||
  !tenantPresetSeed.includes("DEFAULT_STYLE_PROFILE_HASH") ||
  !tenantPresetSeed.includes("MIGRATION_HEAD") ||
  !tenantPresetSeed.includes("does not match its manifest hash") ||
  !tenantPresetSeed.includes("requires the exact committed migration ledger") ||
  !tenantPresetSeed.includes("SET LOCAL videoforge.account_id") ||
  !tenantPresetSeed.includes("ON CONFLICT (id) DO NOTHING") ||
  !tenantPresetSeed.includes(
    "all three avatar assets must already be tenant-owned VERIFIED bytes",
  ) ||
  !tenantPresetSeed.includes(
    "existing deterministic avatar version is not an exact immutable match",
  ) ||
  !tenantPresetSeed.includes(
    "existing deterministic style version is not an exact immutable match",
  ) ||
  !tenantPresetSeed.includes(
    "existing deterministic avatar asset links are not exact immutable matches",
  ) ||
  /\b(?:DROP|DELETE)\s+/iu.test(tenantPresetSeed)
)
  fail("tenant-owned activation preset seed is not fail-closed and idempotent");
if (
  ownedRenderFixture.length < 8_000 ||
  !ownedRenderFixture.includes("render-job-input/v1") ||
  !ownedRenderFixture.includes("hosted_render_submission") ||
  !ownedRenderFixture.includes("local_short_slice_owned_001") ||
  !ownedRenderFixture.includes("V2_06_RENDER_FIXTURE_CONFIRM") ||
  !ownedRenderFixture.includes("V2_06_RENDER_FIXTURE_R2_CONFIRM") ||
  !ownedRenderFixture.includes("V2_06_RENDER_FIXTURE_DB_CONFIRM") ||
  !ownedRenderFixture.includes("createRequire") ||
  !ownedRenderFixture.includes("@neondatabase/serverless") ||
  !ownedRenderFixture.includes("aws4fetch") ||
  !ownedRenderFixture.includes("hosted_render_plans") ||
  !ownedRenderFixture.includes("videoforge_append_hosted_render_plan") ||
  /INSERT INTO hosted_render_plans\b/iu.test(ownedRenderFixture) ||
  !ownedRenderFixture.includes("repository_mutation_receipts") ||
  !ownedRenderFixture.includes("APPROVED_R2_ACCOUNT_ID") ||
  !ownedRenderFixture.includes("APPROVED_R2_BUCKET") ||
  !ownedRenderFixture.includes("APPROVED_NEON_HOST") ||
  !ownedRenderFixture.includes('await client.query("BEGIN")') ||
  !ownedRenderFixture.includes("ROLLBACK") ||
  !ownedRenderFixture.includes("verified R2 objects were intentionally left in place") ||
  !ownedRenderFixture.includes("client.sign") ||
  !ownedRenderFixture.includes("fetchImpl(signed)") ||
  !ownedRenderFixture.includes("database_mutation=SKIPPED_DRY_RUN") ||
  !ownedRenderFixture.includes("R2_ACCOUNT_ID") ||
  /DROP\s+TABLE|DELETE\s+FROM|client\.delete\s*\(/iu.test(ownedRenderFixture) ||
  /RUNPOD_API_KEY\s*[:=]|run\.googleapis\.com|CloudRunJobsClient/u.test(ownedRenderFixture)
)
  fail("owned render fixture planner is not a bounded default-dry-run plan");
if (
  ownedFixtureProvisioner.length < 1000 ||
  !ownedFixtureProvisioner.includes("V2_06_OWNED_FIXTURE_CONFIRM=YES") ||
  !ownedFixtureProvisioner.includes("V2_06_OWNED_FIXTURE_R2_CONFIRM=YES") ||
  !ownedFixtureProvisioner.includes("V2_06_OWNED_FIXTURE_DATABASE_CONFIRM=YES") ||
  !ownedFixtureProvisioner.includes("owned_synthetic_fixture") ||
  !ownedFixtureProvisioner.includes("source_manifest_sha256") ||
  !ownedFixtureProvisioner.includes("ON CONFLICT (id) DO NOTHING") ||
  !ownedFixtureProvisioner.includes("repository_mutation_receipts") ||
  !ownedFixtureProvisioner.includes("AVATAR_HUB_CANONICAL_PROFILE_VERSION_KEYS") ||
  !ownedFixtureProvisioner.includes("expected_avatar_profile_keys_only") ||
  !ownedFixtureProvisioner.includes("APPROVED_CLOUDFLARE_ACCOUNT_ID") ||
  !ownedFixtureProvisioner.includes("APPROVED_R2_BUCKET") ||
  !ownedFixtureProvisioner.includes("APPROVED_NEON_HOST") ||
  !ownedFixtureProvisioner.includes("MIGRATION_LEDGER_JSON_SQL_LITERAL") ||
  !ownedFixtureProvisioner.includes("requires the exact committed migration ledger") ||
  !ownedFixtureProvisioner.includes("fetch(signed)") ||
  ownedFixtureProvisioner.includes("V2_06_OWNED_FIXTURE_PROJECT_ID") ||
  ownedFixtureProvisioner.includes("V2_06_OWNED_FIXTURE_REVISION_ID") ||
  ownedFixtureProvisioner.includes("INSERT INTO artifact_reservations") ||
  ownedFixtureProvisioner.includes("INSERT INTO artifact_receipts") ||
  /\b(?:DROP|DELETE)\s+/iu.test(ownedFixtureProvisioner) ||
  /runpod|run\.googleapis|cloudrun/iu.test(ownedFixtureProvisioner)
)
  fail("owned synthetic fixture provisioner is not fail-closed, tenant-bound, and provider-free");
if (
  !backupScript.includes("BACKUP_PASSPHRASE_FILE") ||
  !backupScript.includes("PGSERVICEFILE") ||
  !backupScript.includes("PGPASSFILE") ||
  !backupScript.includes("DATABASE_URL and PGPASSWORD are forbidden") ||
  !backupScript.includes("apply-migrations-and-grants.mjs") ||
  !backupScript.includes("--verify-only --owner-only") ||
  !backupScript.includes("backup-envelope.mjs") ||
  !backupScript.includes('ln "$envelope_backup" "$backup_output"') ||
  !restoreScript.includes("videoforge_v2_06_disposable_drill") ||
  !restoreScript.includes("public_relation_count") ||
  !restoreScript.includes("apply-migrations-and-grants.mjs") ||
  !restoreScript.includes("--verify-only --apply-grants") ||
  !backupScript.includes("openssl enc -aes-256-cbc -pbkdf2") ||
  !backupScript.includes("refusing to overwrite") ||
  !restoreScript.includes("RESTORE_DRILL_CONFIRM") ||
  !restoreScript.includes("RESTORE_TARGET_LABEL") ||
  !restoreScript.includes("derives the current head") ||
  !configRenderer.includes("refusing to overwrite the tracked template") ||
  !configRenderer.includes("__V2_06_PERSONAL_WORKER_RELEASE_MANIFEST_JSON__") ||
  !configRenderer.includes('const stagingBuildRoot = resolve(root, "apps/web/dist-staging")') ||
  !configRenderer.includes('resolve(stagingBuildRoot, "videoforge_v2_06_staging/index.js")') ||
  !configRenderer.includes('resolve(stagingBuildRoot, "client")') ||
  !configRenderer.includes("rendered.no_bundle = false") ||
  !configRenderer.includes("commit must be the full 40-hex Git commit SHA") ||
  !configRenderer.includes('["cat-file", "-e", `${commit}^{commit}`]') ||
  !configRenderer.includes('["diff", "--quiet"]') ||
  !configRenderer.includes('["diff", "--cached", "--quiet"]') ||
  !configRenderer.includes('["rev-parse", "HEAD"]') ||
  !configRenderer.includes("commit must exactly equal the current HEAD") ||
  !configRenderer.includes("no non-empty regular client asset") ||
  !configRenderer.includes("is missing; run pnpm --filter @videoforge/web build:staging first") ||
  !configRenderer.includes("rendered config must be written outside the repository") ||
  !configRenderer.includes("activation record must be explicitly approved") ||
  !configRenderer.includes("account ID does not match the approved activation record") ||
  !configRenderer.includes("release manifest bytes do not match the approved activation record") ||
  !configRenderer.includes("origin hostname does not match the approved activation record") ||
  !corsRenderer.includes("exact V2-06 policy") ||
  !corsRenderer.includes("rendered CORS config must be written outside the repository") ||
  !migrationActivation.includes("V2_06_PG_SERVICEFILE") ||
  !migrationActivation.includes("migration ledger position") ||
  !migrationActivation.includes("rolbypassrls") ||
  !migrationActivation.includes("FORCE RLS") ||
  !migrationActivation.includes("hosted render plans are not read-only") ||
  !migrationActivation.includes("hosted render-plan append function capability") ||
  !deploymentRunbook.includes("r2 bucket cors set") ||
  !deploymentRunbook.includes('--file "$CORS_CONFIG" --force') ||
  !deploymentRunbook.includes("secret list --format json") ||
  !rollbackRunbook.includes("Keep every migration in the committed manifest") ||
  !rollbackRunbook.includes(`currently through ${String(migrationHead).padStart(4, "0")}`)
)
  fail("backup/restore encryption guard or forward-only rollback contract drifted");

// The activation policy is allowed to name forbidden legacy credentials as a negative control;
// transport scanning therefore covers only the executable Worker configuration and entrypoints.
const combined = [
  JSON.stringify(wrangler),
  await read("apps/web/worker/production-index.ts"),
  await read("apps/web/worker/hosted-workflow.ts"),
].join("\n");
if (/RUNPOD_API_KEY|api\.runpod\.(?:io|ai)|\/purge-queue/iu.test(combined))
  fail("RunPod transport entered V2-06 hosted surfaces");
if (/GCP_RUN_INVOKER|run\.googleapis\.com|CloudRunJobsClient/u.test(combined))
  fail("retired Google Cloud compute transport entered active V2-06 surfaces");

console.log(
  "V2-06 provider-free deployment templates are fail-closed, personal-worker-only, and internally consistent.",
);
