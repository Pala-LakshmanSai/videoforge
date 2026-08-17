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
  wrangler.vars?.GCP_ASR_IMAGE_DIGEST !== "__V2_06_ASR_IMAGE_SHA256__" ||
  wrangler.vars?.GCP_RENDER_IMAGE_DIGEST !== "__V2_06_RENDER_IMAGE_SHA256__"
)
  fail("Cloud Run image identity placeholders drifted");

const expectedSecrets = [
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "EMAIL_DELIVERY_API_KEY",
  "EMAIL_DELIVERY_ENDPOINT",
  "GCP_RUN_INVOKER_SERVICE_ACCOUNT_JSON",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
  "R2_SECRET_ACCESS_KEY",
  "WORKFLOW_CALLBACK_SECRET",
].sort();
const secretAllowlist = JSON.parse(await read("deploy/v2-06/secrets.allowlist.json"));
const actualSecrets = [...(secretAllowlist.required ?? [])].sort();
if (JSON.stringify(actualSecrets) !== JSON.stringify(expectedSecrets))
  fail("least-privilege secret allowlist drifted");
if ("secrets" in wrangler)
  fail("Wrangler config must not contain a nonstandard or secret-bearing secrets field");

const activation = JSON.parse(await read("deploy/v2-06/activation.template.json"));
if (
  activation.checkpoint !== "V2-06" ||
  activation.gpu?.transport !== "FAKE_DISABLED" ||
  activation.gpu?.runpod_calls !== 0
)
  fail("checkpoint or GPU firewall drifted");
if (activation.authority?.maximum_cumulative_finite_external_spend_usd !== null)
  fail("template must not invent a spend cap");

for (const path of [
  "deploy/v2-06/cloud-run-asr.job.yaml",
  "deploy/v2-06/cloud-run-render.job.yaml",
]) {
  const manifest = await read(path);
  if (!manifest.includes("__V2_06_MEDIA_IMAGE_DIGEST_URI__") || /:\s*latest\b/u.test(manifest))
    fail(`${path} is not digest-gated`);
  if (!manifest.includes("serviceAccountName: __V2_06_CPU_JOB_SERVICE_ACCOUNT__"))
    fail(`${path} lacks the job-only identity placeholder`);
  if (!manifest.includes("maxRetries: 0"))
    fail(`${path} must not create an untracked duplicate-cost retry`);
  if (/gpu|runpod/iu.test(manifest)) fail(`${path} must stay CPU-only and RunPod-free`);
}

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
for (const version of [29, 30, 31]) {
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

console.log(
  "V2-06 provider-free deployment templates are fail-closed, CPU-only, and internally consistent.",
);
