import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVATED_ASSETS_PATH,
  ACTIVATED_MAIN_PATH,
  parseProductionConfig,
  TEMPLATE_PATH,
  validateMediaWorkerReleaseManifest,
  validateProductionConfig,
} from "./validate-production-config.mjs";

const fail = (message) => {
  throw new Error(`V2-13 production config renderer: ${message}`);
};
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const exactKeys = (value, expected) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

function approvedActivation(value) {
  if (
    !exactKeys(value, [
      "authority",
      "checkpoint",
      "cloudflare",
      "release",
      "runtime",
      "schema_version",
    ]) ||
    value.schema_version !== "videoforge-v2-13-production-config-activation/v1" ||
    value.checkpoint !== "V2-13" ||
    !exactKeys(value.authority, [
      "approved_at",
      "config_render_only",
      "credential_access_authorized",
      "deployment_authorized",
      "external_spend_usd",
      "mode",
      "provider_calls_authorized",
    ]) ||
    value.authority.mode !== "APPROVED_CONFIG_RENDER_ONLY" ||
    value.authority.config_render_only !== true ||
    value.authority.deployment_authorized !== false ||
    value.authority.provider_calls_authorized !== false ||
    value.authority.credential_access_authorized !== false ||
    value.authority.external_spend_usd !== 0 ||
    typeof value.authority.approved_at !== "string" ||
    Number.isNaN(Date.parse(value.authority.approved_at))
  )
    fail("activation authority is not exact config-render-only approval");
  if (
    !exactKeys(value.release, ["commit", "media_worker_release_manifest_sha256"]) ||
    !/^[0-9a-f]{40}$/u.test(value.release.commit) ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.release.media_worker_release_manifest_sha256)
  )
    fail("release identity is malformed");
  if (
    !exactKeys(value.cloudflare, [
      "account_id",
      "public_origin",
      "r2_bucket_name",
      "worker_name",
      "workflow_name",
    ]) ||
    !/^[0-9a-f]{32}$/u.test(value.cloudflare.account_id)
  )
    fail("Cloudflare activation identity is malformed");
  if (value.cloudflare.worker_name !== "videoforge-production-runtime")
    fail("Cloudflare activation must retain the quarantined production Worker name");
  if (
    !exactKeys(value.runtime, [
      "assets_binding",
      "environment",
      "gpu_transport",
      "observability_enabled",
      "provider_mode",
      "r2_binding",
      "version_metadata_binding",
      "workflow_binding",
    ]) ||
    value.runtime.environment !== "production" ||
    value.runtime.provider_mode !== "production" ||
    value.runtime.gpu_transport !== "DISABLED_UNQUALIFIED" ||
    value.runtime.assets_binding !== "ASSETS" ||
    value.runtime.r2_binding !== "PRIVATE_ARTIFACTS" ||
    value.runtime.workflow_binding !== "VIDEO_WORKFLOW" ||
    value.runtime.version_metadata_binding !== "CF_VERSION_METADATA" ||
    value.runtime.observability_enabled !== true
  )
    fail("runtime activation contract drifted");
  return value;
}

function renderConfig(template, activation, releaseJson) {
  const rendered = structuredClone(template);
  rendered.main = ACTIVATED_MAIN_PATH;
  rendered.assets.directory = ACTIVATED_ASSETS_PATH;
  rendered.account_id = activation.cloudflare.account_id;
  rendered.r2_buckets[0].bucket_name = activation.cloudflare.r2_bucket_name;
  rendered.workflows[0].name = activation.cloudflare.workflow_name;
  rendered.workflows[1].name = `${activation.cloudflare.workflow_name}-pair`;
  Object.assign(rendered.vars, {
    VIDEOFORGE_COMMIT: activation.release.commit,
    VIDEOFORGE_PUBLIC_ORIGIN: activation.cloudflare.public_origin,
    R2_ACCOUNT_ID: activation.cloudflare.account_id,
    VIDEOFORGE_R2_BUCKET_NAME: activation.cloudflare.r2_bucket_name,
    MEDIA_WORKER_RELEASE_MANIFEST_JSON: releaseJson,
  });
  validateProductionConfig(rendered, { mode: "activated" });
  return rendered;
}

async function main() {
  const tokens = process.argv.slice(2);
  const activateIndex = tokens.indexOf("--activate");
  const activate = activateIndex >= 0;
  if (activate) tokens.splice(activateIndex, 1);
  const args = new Map();
  for (let index = 0; index < tokens.length; index += 2) {
    if (
      !tokens[index]?.startsWith("--") ||
      tokens[index + 1] === undefined ||
      tokens[index + 1].startsWith("--")
    )
      fail("arguments must be --name value pairs");
    args.set(tokens[index].slice(2), tokens[index + 1]);
  }
  const template = parseProductionConfig(await readFile(TEMPLATE_PATH, "utf8"));
  validateProductionConfig(template, { mode: "template" });
  if (!activate) {
    if (args.size > 0)
      fail("dry-run accepts no activation inputs; add --activate for local rendering");
    process.stdout.write(
      `${JSON.stringify({
        schema_version: "videoforge-v2-13-production-config-dry-run/v1",
        state: "DISABLED_UNQUALIFIED",
        placeholders_resolved: false,
        config_written: false,
        deployment_authorized: false,
        provider_calls: 0,
        credential_reads: 0,
        external_spend_usd: 0,
      })}\n`,
    );
    return;
  }
  for (const key of ["activation-record", "release-manifest-file", "output"]) {
    if (!args.has(key)) fail(`--${key} is required with --activate`);
  }
  if (
    [...args.keys()].some(
      (key) => !["activation-record", "release-manifest-file", "output"].includes(key),
    )
  )
    fail("unknown activation argument");
  let activation;
  try {
    activation = approvedActivation(
      JSON.parse(await readFile(resolve(args.get("activation-record")), "utf8")),
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2-13")) throw error;
    fail("activation record is not readable exact JSON");
  }
  const releaseBytes = await readFile(resolve(args.get("release-manifest-file")));
  if (sha256(releaseBytes) !== activation.release.media_worker_release_manifest_sha256)
    fail("release manifest bytes do not match activation");
  let releaseJson;
  try {
    releaseJson = JSON.stringify(
      validateMediaWorkerReleaseManifest(JSON.parse(releaseBytes.toString("utf8"))),
    );
  } catch {
    fail("release manifest is not readable JSON");
  }
  const rendered = renderConfig(template, activation, releaseJson);
  await writeFile(resolve(args.get("output")), `${JSON.stringify(rendered, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify({
      schema_version: "videoforge-v2-13-production-config-render/v1",
      state: "DISABLED_UNQUALIFIED",
      config_written: true,
      deployment_authorized: false,
      provider_calls: 0,
      credential_reads: 0,
      external_spend_usd: 0,
    })}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
