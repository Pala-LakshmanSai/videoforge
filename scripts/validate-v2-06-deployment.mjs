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
if (wrangler.vars?.VIDEOFORGE_PROVIDER_MODE !== "staging") fail("Worker must be staging-only");
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
if (Object.keys(wrangler.vars ?? {}).some((key) => key.startsWith("GCP_")))
  fail("retired Google Cloud compute configuration remains active");

const expectedSecrets = [
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MEDIA_WORKER_TOKEN_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
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
if ("secrets" in wrangler)
  fail("Wrangler config must not contain a nonstandard or secret-bearing secrets field");

const neonRuntimeGrants = await read("deploy/v2-06/neon-runtime-grants.sql");
if (!neonRuntimeGrants.includes('GRANT SELECT ON workspaces TO :"runtime_role";'))
  fail("hosted tenant workspace read grant is missing");

const activation = JSON.parse(await read("deploy/v2-06/activation.template.json"));
if (
  activation.checkpoint !== "V2-06" ||
  activation.gpu?.transport !== "FAKE_DISABLED" ||
  activation.gpu?.runpod_calls !== 0
)
  fail("checkpoint or GPU firewall drifted");
if (activation.authority?.maximum_cumulative_finite_external_spend_usd !== null)
  fail("template must not invent a spend cap");

const releaseTemplate = JSON.parse(await read("deploy/v2-06/media-worker-release.template.json"));
if (
  releaseTemplate.schema_version !== "videoforge-media-worker-release/v1" ||
  releaseTemplate.minimum_protocol_version !== 1 ||
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
  !releaseWorkflow.includes("inputs.signed_release") ||
  !releaseWorkflow.includes("gh release create") ||
  !releaseWorkflow.includes('notarytool submit "VideoForge-Worker-0.1.0.dmg"') ||
  !releaseWorkflow.includes('stapler staple "VideoForge-Worker-0.1.0.dmg"')
)
  fail("signed, notarized immutable worker publication gate is incomplete");
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
]) {
  if ((await read(path)).trim().length < 100) fail(`${path} is incomplete`);
}

const manifest = JSON.parse(await read("packages/control-plane/migrations/manifest.json"));
for (const version of [29, 30, 31, 32, 33]) {
  const entry = manifest.migrations.find((candidate) => candidate.version === version);
  if (!entry) fail(`migration ${version} is absent`);
  const migration = await read(`packages/control-plane/migrations/${entry.filename}`);
  const actualHash = `sha256:${createHash("sha256").update(migration).digest("hex")}`;
  if (entry.sha256 !== actualHash) fail(`migration ${version} hash is stale`);
}

const combined = [
  JSON.stringify(wrangler),
  JSON.stringify(activation),
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
