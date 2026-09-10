import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseProductionConfig,
  validateMediaWorkerReleaseManifest,
  validateProductionConfig,
} from "../v2-13/validate-production-config.mjs";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const TEMPLATE_PATH = resolve(ROOT, "apps/web/wrangler.production.jsonc");
export const MAGE_QUALIFICATION_SHA256 =
  "sha256:12bc1b0fa85606ed1adad23b0b6df97d5c16e1e5d0f8e417fadad0403076be5f";
export const SOULX_QUALIFICATION_SHA256 =
  "sha256:586c235e3854ece80ca17b7728d3bdddea47e4e4f3b9fb445584bd7cd2fc17b5";
export const MAGE_IMAGE_DIGEST =
  "sha256:26680786552e7a40f88a312e97720dffa6944173eb83080a100989beac2216b0";
export const SOULX_IMAGE_DIGEST =
  "sha256:047881a3e85fcb98683c2851989ec064628fa803123588ac25929bd6ca6b243a";

const HASH = /^sha256:[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const ACCOUNT_ID = /^[0-9a-f]{32}$/u;
const NAME = /^[a-z][a-z0-9-]{2,62}$/u;
const PLACEHOLDER =
  /(?:^|[^a-z])(?:replace[_-]with|placeholder|unresolved)(?:[^a-z]|$)|__V2_[A-Z0-9_]+__|^0+$/iu;
const FORBIDDEN_KEY =
  /(?:api[_-]?key|secret|password|private[_-]?key|authorization|raw[_-]?endpoint|endpoint[_-]?id)$/iu;

export const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const exactKeys = (value, expected) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

const fail = (message) => {
  throw new Error(`V2-09 qualified production config validator: ${message}`);
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
      parsed.origin === value &&
      !parsed.hostname.includes("*")
    );
  } catch {
    return false;
  }
}

function rejectSecretsAndPlaceholders(value, label) {
  const visit = (entry) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (entry && typeof entry === "object") {
      for (const [key, nested] of Object.entries(entry)) {
        if (FORBIDDEN_KEY.test(key)) fail(`${label} contains forbidden secret or raw identity key`);
        visit(nested);
      }
      return;
    }
    if (typeof entry === "string" && PLACEHOLDER.test(entry))
      fail(`${label} contains a placeholder`);
  };
  visit(value);
}

function validateLane(value, expectedQualification, expectedImage, label) {
  if (
    !exactKeys(value, [
      "endpoint_id_sha256",
      "qualification_record_sha256",
      "worker_image_digest",
    ]) ||
    value.qualification_record_sha256 !== expectedQualification ||
    value.worker_image_digest !== expectedImage ||
    !HASH.test(value.endpoint_id_sha256 ?? "") ||
    /^sha256:0{64}$/u.test(value.endpoint_id_sha256)
  )
    fail(`${label} frozen qualification, image, or endpoint hash drifted`);
}

export function validatePreparationBinding(value) {
  if (
    !exactKeys(value, ["authority", "lanes", "production", "release", "schema_version"]) ||
    value.schema_version !== "videoforge-v2-09-qualified-production-config-preparation/v1"
  )
    fail("binding top-level contract drifted");
  if (
    !exactKeys(value.authority, [
      "credential_access_authorized",
      "deployment_authorized",
      "external_spend_usd",
      "mode",
      "provider_calls_authorized",
    ]) ||
    value.authority.mode !== "PROVIDER_FREE_CONFIG_PREPARATION" ||
    value.authority.credential_access_authorized !== false ||
    value.authority.deployment_authorized !== false ||
    value.authority.provider_calls_authorized !== false ||
    value.authority.external_spend_usd !== 0
  )
    fail("binding authority is not exact provider-free preparation");
  if (
    !exactKeys(value.release, ["media_worker_release_manifest_sha256", "source_commit"]) ||
    !GIT_SHA.test(value.release.source_commit ?? "") ||
    /^0{40}$/u.test(value.release.source_commit) ||
    !HASH.test(value.release.media_worker_release_manifest_sha256 ?? "")
  )
    fail("release binding is malformed");
  if (
    !exactKeys(value.production, [
      "account_id",
      "assets_binding",
      "pair_workflow_binding",
      "pair_workflow_name",
      "provenance_receipt_key_id_binding",
      "provenance_receipt_secret_binding",
      "public_origin",
      "r2_binding",
      "r2_bucket_name",
      "video_workflow_binding",
      "video_workflow_name",
      "worker_name",
    ]) ||
    !ACCOUNT_ID.test(value.production.account_id ?? "") ||
    /^0{32}$/u.test(value.production.account_id) ||
    value.production.worker_name !== "videoforge-production-runtime" ||
    value.production.assets_binding !== "ASSETS" ||
    value.production.r2_binding !== "PRIVATE_ARTIFACTS" ||
    value.production.video_workflow_binding !== "VIDEO_WORKFLOW" ||
    value.production.pair_workflow_binding !== "HOSTED_PAIR_WORKFLOW" ||
    value.production.provenance_receipt_secret_binding !== "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY" ||
    value.production.provenance_receipt_key_id_binding !== "VIDEOFORGE_PROVIDER_PROOF_KEY_ID" ||
    !NAME.test(value.production.r2_bucket_name ?? "") ||
    !NAME.test(value.production.video_workflow_name ?? "") ||
    !NAME.test(value.production.pair_workflow_name ?? "") ||
    value.production.video_workflow_name === value.production.pair_workflow_name ||
    !exactOrigin(value.production.public_origin)
  )
    fail("production Worker, R2, assets, Workflow, or origin identity is malformed");
  if (!exactKeys(value.lanes, ["mage_image", "soulx_avatar"]))
    fail("lane binding contract drifted");
  validateLane(value.lanes.mage_image, MAGE_QUALIFICATION_SHA256, MAGE_IMAGE_DIGEST, "Mage");
  validateLane(value.lanes.soulx_avatar, SOULX_QUALIFICATION_SHA256, SOULX_IMAGE_DIGEST, "SoulX");
  rejectSecretsAndPlaceholders(value, "binding");
  return value;
}

export function validateReleaseManifest(bytes, expectedSha256) {
  if (sha256(bytes) !== expectedSha256) fail("media worker release manifest hash drifted");
  let manifest;
  try {
    manifest = validateMediaWorkerReleaseManifest(JSON.parse(bytes.toString("utf8")));
  } catch {
    fail("media worker release manifest is malformed");
  }
  if (
    manifest.version !== "0.1.17" ||
    !manifest.windows.url.includes("/media-worker-v0.1.17/") ||
    !manifest.macos.url.includes("/media-worker-v0.1.17/")
  )
    fail("media worker release is not exact immutable 0.1.17");
  rejectSecretsAndPlaceholders(manifest, "media worker release");
  return manifest;
}

export function validateQualifiedRenderedConfig(config, binding, releaseManifest) {
  if (config?.no_bundle !== false) fail("rendered qualified config bundle mode drifted");
  const sharedValidationConfig = structuredClone(config);
  sharedValidationConfig.no_bundle = true;
  validateProductionConfig(sharedValidationConfig, { mode: "qualified" });
  const production = binding.production;
  if (
    releaseManifest.version !== "0.1.17" ||
    config.name !== production.worker_name ||
    config.account_id !== production.account_id ||
    config.assets.binding !== production.assets_binding ||
    config.r2_buckets[0].binding !== production.r2_binding ||
    config.r2_buckets[0].bucket_name !== production.r2_bucket_name ||
    config.workflows[0].binding !== production.video_workflow_binding ||
    config.workflows[0].name !== production.video_workflow_name ||
    config.workflows[1].binding !== production.pair_workflow_binding ||
    config.workflows[1].name !== production.pair_workflow_name ||
    config.vars.VIDEOFORGE_COMMIT !== binding.release.source_commit ||
    config.vars.VIDEOFORGE_PUBLIC_ORIGIN !== production.public_origin ||
    config.vars.R2_ACCOUNT_ID !== production.account_id ||
    config.vars.VIDEOFORGE_R2_BUCKET_NAME !== production.r2_bucket_name ||
    config.vars.MEDIA_WORKER_RELEASE_MANIFEST_JSON !== JSON.stringify(releaseManifest) ||
    config.vars.VIDEOFORGE_GPU_TRANSPORT !== "QUALIFIED_EXACT"
  )
    fail("rendered qualified config identity drifted");
  rejectSecretsAndPlaceholders(config, "rendered config");
  return Object.freeze({ valid: true, gpu_transport: "QUALIFIED_EXACT" });
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 6 ||
    args[0] !== "--binding" ||
    args[2] !== "--release-manifest" ||
    args[4] !== "--config"
  )
    fail(
      "usage: validate-qualified-production-config.mjs --binding path --release-manifest path --config path",
    );
  const binding = validatePreparationBinding(JSON.parse(await readFile(resolve(args[1]), "utf8")));
  const releaseBytes = await readFile(resolve(args[3]));
  const release = validateReleaseManifest(
    releaseBytes,
    binding.release.media_worker_release_manifest_sha256,
  );
  const config = parseProductionConfig(await readFile(resolve(args[5]), "utf8"));
  const result = validateQualifiedRenderedConfig(config, binding, release);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
