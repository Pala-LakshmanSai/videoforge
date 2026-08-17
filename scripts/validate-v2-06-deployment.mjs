import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const fail = (message) => {
  throw new Error(`V2-06 deployment contract: ${message}`);
};
const parseJsonc = (source) => JSON.parse(source.replace(/,\s*([}\]])/gu, "$1"));

const wrangler = parseJsonc(await read("apps/web/wrangler.staging.jsonc"));
const viteConfiguration = await read("apps/web/vite.cloudflare.config.ts");
if (
  !viteConfiguration.includes('VITE_VIDEOFORGE_PROVIDER_MODE === "staging"') ||
  !viteConfiguration.includes('"./wrangler.staging.jsonc"')
)
  fail("staging build is not bound to its hosted Worker configuration");
if (wrangler.name !== "videoforge-v2-06-staging") fail("unexpected Worker name");
if (wrangler.account_id !== "__V2_06_CLOUDFLARE_ACCOUNT_ID__")
  fail("staging deploy must pin the approved Cloudflare account placeholder");
if (wrangler.vars?.VIDEOFORGE_PROVIDER_MODE !== "staging") fail("Worker must be staging-only");
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
  JSON.stringify([...(secretAllowlist.optional_together ?? [])].sort()) !==
  JSON.stringify(["EMAIL_DELIVERY_API_KEY", "EMAIL_DELIVERY_ENDPOINT"])
)
  fail("optional email secret pair drifted");
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
if (!neonRuntimeGrants.includes('GRANT SELECT ON workspaces TO :"runtime_role";'))
  fail("hosted tenant workspace read grant is missing");
if (
  !neonRuntimeGrants.includes('ALTER ROLE :"runtime_role"') ||
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
const releaseWorkflow = await read(".github/workflows/media-worker-release.yml");
if (
  !releaseWorkflow.includes("publish_release:") ||
  !releaseWorkflow.includes('codesign --force --deep --sign - "dist/VideoForge Worker.app"') ||
  !releaseWorkflow.includes("grep -q 'Signature=adhoc'") ||
  !releaseWorkflow.includes('hdiutil verify "VideoForge-Worker-0.1.0.dmg"') ||
  !releaseWorkflow.includes('"UNSIGNED_BETA"') ||
  !releaseWorkflow.includes('"AD_HOC_BETA"') ||
  !releaseWorkflow.includes("gh release create") ||
  !releaseWorkflow.includes('notarytool submit "VideoForge-Worker-0.1.0.dmg"') ||
  !releaseWorkflow.includes('stapler staple "VideoForge-Worker-0.1.0.dmg"')
)
  fail("ImageForge-style beta and optional signed worker publication gates are incomplete");
const hostedApp = await read("apps/web/src/server/hosted/app.ts");
if (
  !hostedApp.includes("handleCpuOutputDelete(") ||
  !hostedApp.includes('request.method === "DELETE"') ||
  !hostedApp.includes('reason: "EXPLICIT_USER_DELETE"')
)
  fail("explicit owned-output R2 deletion route is absent");

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
  "deploy/v2-06/render-staging-config.mjs",
]) {
  if ((await read(path)).trim().length < 100) fail(`${path} is incomplete`);
}
const backupScript = await read("deploy/v2-06/backup.sh");
const restoreScript = await read("deploy/v2-06/restore-drill.sh");
const rollbackRunbook = await read("deploy/v2-06/rollback.md");
const configRenderer = await read("deploy/v2-06/render-staging-config.mjs");
if (
  !backupScript.includes("BACKUP_PASSPHRASE_FILE") ||
  !backupScript.includes("openssl enc -aes-256-cbc -pbkdf2") ||
  !backupScript.includes("refusing to overwrite") ||
  !restoreScript.includes("RESTORE_DRILL_CONFIRM") ||
  !restoreScript.includes("RESTORE_TARGET_LABEL") ||
  !restoreScript.includes("migration head 34") ||
  !configRenderer.includes("refusing to overwrite the tracked template") ||
  !configRenderer.includes("__V2_06_PERSONAL_WORKER_RELEASE_MANIFEST_JSON__") ||
  !rollbackRunbook.includes("Keep migrations 0029-0034 applied") ||
  rollbackRunbook.includes("Keep migrations 0029-0032 applied")
)
  fail("backup/restore encryption guard or forward-only rollback contract drifted");

const manifest = JSON.parse(await read("packages/control-plane/migrations/manifest.json"));
for (const version of [29, 30, 31, 32, 33, 34]) {
  const entry = manifest.migrations.find((candidate) => candidate.version === version);
  if (!entry) fail(`migration ${version} is absent`);
  const migration = await read(`packages/control-plane/migrations/${entry.filename}`);
  const actualHash = `sha256:${createHash("sha256").update(migration).digest("hex")}`;
  if (entry.sha256 !== actualHash) fail(`migration ${version} hash is stale`);
}

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
