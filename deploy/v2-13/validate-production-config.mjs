import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const TEMPLATE_PATH = resolve(ROOT, "apps/web/wrangler.production.jsonc");
export const ACTIVATED_MAIN_PATH = resolve(
  ROOT,
  "apps/web/dist-cloudflare/videoforge_production_runtime/index.js",
);
export const ACTIVATED_ASSETS_PATH = resolve(ROOT, "apps/web/dist-cloudflare/client");

const PLACEHOLDERS = Object.freeze([
  "00000000000000000000000000000000",
  "0000000000000000000000000000000000000000",
  "__V2_13_MEDIA_WORKER_RELEASE_MANIFEST_JSON__",
  "https://v2-13-public-origin-unresolved.invalid",
  "videoforge-v2-13-r2-unresolved",
  "videoforge-v2-13-workflow-unresolved",
  "videoforge-v2-13-pair-workflow-unresolved",
]);

const exactKeys = (value, expected) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

const fail = (message) => {
  throw new Error(`V2-13 production config validator: ${message}`);
};

function exactOrigin(value) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      !parsed.hostname.includes("*") &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

function exactHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}

export function validateMediaWorkerReleaseManifest(value) {
  if (
    !exactKeys(value, [
      "execution_bundle_sha256",
      "macos",
      "minimum_protocol_version",
      "schema_version",
      "version",
      "whisper_model_sha256",
      "windows",
    ]) ||
    value.schema_version !== "videoforge-media-worker-release/v1" ||
    typeof value.version !== "string" ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u.test(value.version) ||
    !Number.isSafeInteger(value.minimum_protocol_version) ||
    value.minimum_protocol_version < 1 ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.execution_bundle_sha256) ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.whisper_model_sha256)
  )
    fail("media worker release manifest identity is malformed");
  for (const platform of ["windows", "macos"]) {
    const file = value[platform];
    const trust =
      platform === "windows"
        ? ["UNSIGNED_BETA", "AUTHENTICODE_SIGNED"]
        : ["AD_HOC_BETA", "DEVELOPER_ID_NOTARIZED"];
    if (
      !exactKeys(file, ["sha256", "size_bytes", "trust", "url"]) ||
      !exactHttpsUrl(file.url) ||
      !/^sha256:[0-9a-f]{64}$/u.test(file.sha256) ||
      !Number.isSafeInteger(file.size_bytes) ||
      file.size_bytes < 1 ||
      !trust.includes(file.trust)
    )
      fail(`${platform} media worker release identity is malformed`);
  }
  return value;
}

export function parseProductionConfig(bytes, label = "production config") {
  try {
    const withoutLineComments = bytes.replace(/^\s*\/\/.*$/gmu, "");
    const value = JSON.parse(withoutLineComments.replace(/,\s*([}\]])/gu, "$1"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(`${label} must be an object`);
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2-13")) throw error;
    fail(`${label} must be readable JSONC`);
  }
}

export function validateProductionConfig(config, { mode = "template" } = {}) {
  const expectedMain = mode === "activated" ? ACTIVATED_MAIN_PATH : "./worker/production-index.ts";
  const expectedAssets = mode === "activated" ? ACTIVATED_ASSETS_PATH : "./dist-cloudflare/client";
  if (
    !exactKeys(config, [
      "$schema",
      "account_id",
      "assets",
      "compatibility_date",
      "compatibility_flags",
      "main",
      "name",
      "no_bundle",
      "observability",
      "placement",
      "r2_buckets",
      "triggers",
      "vars",
      "version_metadata",
      "workflows",
    ])
  )
    fail("top-level keys are not the exact closed-world production contract");
  if (
    config.$schema !== "./node_modules/wrangler/config-schema.json" ||
    config.compatibility_date !== "2026-08-08" ||
    JSON.stringify(config.compatibility_flags) !== JSON.stringify(["nodejs_compat"]) ||
    config.no_bundle !== true ||
    config.main !== expectedMain
  )
    fail("Worker entry or compatibility identity drifted");
  if (
    !exactKeys(config.assets, ["binding", "directory", "not_found_handling", "run_worker_first"]) ||
    config.assets.binding !== "ASSETS" ||
    config.assets.directory !== expectedAssets ||
    config.assets.not_found_handling !== "single-page-application" ||
    JSON.stringify(config.assets.run_worker_first) !== JSON.stringify(["/api/*"])
  )
    fail("assets binding drifted");
  if (
    !exactKeys(config.placement, ["mode"]) ||
    config.placement.mode !== "smart" ||
    !exactKeys(config.version_metadata, ["binding"]) ||
    config.version_metadata.binding !== "CF_VERSION_METADATA" ||
    !exactKeys(config.triggers, ["crons"]) ||
    JSON.stringify(config.triggers.crons) !== JSON.stringify(["17 2 * * *"])
  )
    fail("placement, metadata, or retention trigger drifted");
  if (
    !exactKeys(config.observability, ["enabled", "head_sampling_rate", "logs"]) ||
    config.observability.enabled !== true ||
    config.observability.head_sampling_rate !== 1 ||
    !exactKeys(config.observability.logs, ["enabled", "invocation_logs"]) ||
    config.observability.logs.enabled !== true ||
    config.observability.logs.invocation_logs !== true
  )
    fail("observability must remain fully enabled");
  if (
    !Array.isArray(config.r2_buckets) ||
    config.r2_buckets.length !== 1 ||
    !exactKeys(config.r2_buckets[0], ["binding", "bucket_name"]) ||
    config.r2_buckets[0].binding !== "PRIVATE_ARTIFACTS" ||
    !Array.isArray(config.workflows) ||
    config.workflows.length !== 2 ||
    !exactKeys(config.workflows[0], ["binding", "class_name", "name"]) ||
    config.workflows[0].binding !== "VIDEO_WORKFLOW" ||
    config.workflows[0].class_name !== "HostedVideoWorkflow" ||
    !exactKeys(config.workflows[1], ["binding", "class_name", "name"]) ||
    config.workflows[1].binding !== "HOSTED_PAIR_WORKFLOW" ||
    config.workflows[1].class_name !== "HostedPairWorkflow"
  )
    fail("R2 or Workflow binding drifted");
  const expectedVars = [
    "MEDIA_WORKER_RELEASE_MANIFEST_JSON",
    "R2_ACCOUNT_ID",
    "VIDEOFORGE_COMMIT",
    "VIDEOFORGE_ENVIRONMENT",
    "VIDEOFORGE_GPU_TRANSPORT",
    "VIDEOFORGE_PROVIDER_MODE",
    "VIDEOFORGE_PUBLIC_ORIGIN",
    "VIDEOFORGE_R2_BUCKET_NAME",
    "VIDEOFORGE_R2_REGION",
  ];
  if (
    !exactKeys(config.vars, expectedVars) ||
    config.vars.VIDEOFORGE_ENVIRONMENT !== "production" ||
    config.vars.VIDEOFORGE_PROVIDER_MODE !== "production" ||
    config.vars.VIDEOFORGE_GPU_TRANSPORT !== "DISABLED_UNQUALIFIED" ||
    config.vars.VIDEOFORGE_R2_REGION !== "auto"
  )
    fail("production variables drifted");
  const serialized = JSON.stringify(config);
  for (const token of [
    "fixture",
    "fake",
    "RUNPOD_API_KEY",
    "Start Pod",
    "Stop Pod",
    "Delete Pod",
    "purge-queue",
    "manual_gpu",
    "pod_lifecycle",
  ]) {
    if (serialized.toLowerCase().includes(token.toLowerCase()))
      fail(`forbidden production token: ${token}`);
  }
  for (const secret of [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "WORKFLOW_CALLBACK_SECRET",
    "MEDIA_WORKER_TOKEN_SECRET",
    "VIDEOFORGE_RECONCILER_DATABASE_URL",
    "VIDEOFORGE_DISPATCH_TOKEN_KEY",
    "VIDEOFORGE_DISPATCH_TOKEN_KEY_ID",
    "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX",
    "VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID",
    "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
    "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
    "RUNPOD_API_KEY",
    "RUNPOD_API_BASE_URL",
    "VIDEOFORGE_MAGE_ENDPOINT_ID",
    "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
    "VIDEOFORGE_SOULX_ENDPOINT_ID",
    "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
  ]) {
    if (Object.hasOwn(config.vars, secret))
      fail(`secret ${secret} must use a secret binding, never vars`);
  }
  if (mode === "template") {
    for (const placeholder of PLACEHOLDERS) {
      if (!serialized.includes(placeholder)) fail(`template is missing placeholder ${placeholder}`);
    }
  } else if (mode === "activated") {
    if (/__V2_13_[A-Z0-9_]+__|v2-13-[a-z-]+-unresolved/u.test(serialized))
      fail("activated config retains a placeholder");
    if (
      !/^[0-9a-f]{32}$/u.test(config.account_id) ||
      /^0{32}$/u.test(config.account_id) ||
      config.vars.R2_ACCOUNT_ID !== config.account_id
    )
      fail("activated account identity is malformed or inconsistent");
    if (
      !/^[0-9a-f]{40}$/u.test(config.vars.VIDEOFORGE_COMMIT) ||
      /^0{40}$/u.test(config.vars.VIDEOFORGE_COMMIT)
    )
      fail("activated commit is not full Git SHA");
    if (
      !/^[a-z][a-z0-9-]{2,62}$/u.test(config.name) ||
      !/^[a-z][a-z0-9-]{2,62}$/u.test(config.r2_buckets[0].bucket_name) ||
      !config.workflows.every(({ name }) => /^[a-z][a-z0-9-]{2,62}$/u.test(name)) ||
      config.workflows[0].name === config.workflows[1].name
    )
      fail("activated Worker, R2, or Workflow name is malformed");
    if (config.name !== "videoforge-production-runtime")
      fail("activated Worker name is not the quarantined production identity");
    if (
      config.vars.VIDEOFORGE_R2_BUCKET_NAME !== config.r2_buckets[0].bucket_name ||
      !exactOrigin(config.vars.VIDEOFORGE_PUBLIC_ORIGIN)
    )
      fail("activated R2 or public origin drifted");
    let releaseManifest;
    try {
      releaseManifest = JSON.parse(config.vars.MEDIA_WORKER_RELEASE_MANIFEST_JSON);
    } catch {
      fail("activated release manifest is not JSON");
    }
    validateMediaWorkerReleaseManifest(releaseManifest);
  } else fail("validation mode must be template or activated");
  return Object.freeze({ mode, gpu_transport: "DISABLED_UNQUALIFIED", valid: true });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 2 || (args.length === 2 && args[0] !== "--config"))
    fail("usage: validate-production-config.mjs [--config path]");
  const path = args.length === 2 ? resolve(args[1]) : TEMPLATE_PATH;
  const config = parseProductionConfig(await readFile(path, "utf8"));
  const result = validateProductionConfig(config, {
    mode: args.length === 2 ? "activated" : "template",
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
