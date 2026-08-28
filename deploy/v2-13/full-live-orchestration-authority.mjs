#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING,
  EXPECTED_PHASE_CAPS,
  validateFullLiveUserApproval,
} from "./validate-full-live-approval.mjs";
import {
  CONFIRMATION as GUARDED_ACTIVATION_CONFIRMATION,
  SECRET_NAMES as GUARDED_SECRET_NAMES,
  validateAuthority as validateGuardedActivationAuthority,
} from "./guarded-activation.mjs";
import { validateProductionConfig } from "./validate-production-config.mjs";
import { validatePromotionRecord } from "./promote-qualified-production.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const AUTHORITY_ID = /^v2-13-[a-z0-9][a-z0-9._-]{7,95}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u;
const RUNPOD_ACCOUNT_ID_SHA256 =
  "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c";
const EXACT_DATABASE_IDENTITY = Object.freeze({
  database: "neondb",
  host: "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech",
  owner_role: "neondb_owner",
});
const CONFIRMATION = "CONSUME_EXACT_V2_13_FULL_LIVE_AUTHORITY";
const MATERIALIZATION_SEED_SCHEMA = "videoforge.v213-full-live-materialization-seed/v1";
const MATERIALIZATION_SEED_ENV = "VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE";
const STATIC_RELEASE_DESCRIPTOR_ENV = "VIDEOFORGE_V2_13_STATIC_RELEASE_DESCRIPTOR_FILE";
const MATERIALIZATION_PRODUCTION_INPUT_VALIDATOR_PATH =
  "deploy/v2-13/validate-materialization-seed-production-input.mts";
const MATERIALIZATION_PRODUCTION_INPUT_VALIDATOR_SHA256 =
  "sha256:d2d8dc879bb29fbf7df207885b2d604d90f0b3047710fbec9e794afd745f4682";
const EXACT_RETAINED_LANES = Object.freeze({
  mage: Object.freeze({
    volumeIdSha256: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
    volumeManifestSha256: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  }),
  soulx: Object.freeze({
    volumeIdSha256: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
    volumeManifestSha256: "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
  }),
});
const PHASES = Object.freeze([
  ["publication", 0],
  ["bootstrap_prequalification_database", 0],
  ["mage_qualification", 4.5],
  ["soulx_qualification", 1],
  ["max_one_control_plane_and_guarded_activation", 0],
  ["v2_09_short_hosted_project", 2],
  ["v2_10_operator_free_ranga_pilot", 2],
  ["v2_11_two_concurrent_owned_projects", 4],
  ["v2_12_long_output", 2],
  ["v2_13_final_two_lane_smoke", 2],
  ["cleanup_and_reconciliation", 0],
]);
const BOOTSTRAP_PHASE = "bootstrap_prequalification_database";
const BOOTSTRAP_OPERATION = "bootstrap-prequalification-database";
const CLEANUP_SAFETY_OPERATION_IDS = Object.freeze([
  "restore-endpoints-max-one",
  "prove-zero-workers",
  "read-settled-billing",
  "reconcile-exact-resources",
]);
const PROPOSAL_RECORD_PATH =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json";
const PROPOSAL_RECORD_ALLOWED_DIFF_PATHS = Object.freeze([
  "project-context/00_START_HERE.md",
  "project-context/CURRENT_STATE.yaml",
  PROPOSAL_RECORD_PATH,
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/validate-candidate.mjs",
  "project-context/tasks/VF-10-13.md",
]);
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
// State and result records are hashed from canonical JSON so a restart can recover a settled
// result without trusting property insertion order. Keep this local to the authority file: the
// outer record must remain usable before the application package has been built.
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const settledResultSha256 = (value) => sha256(Buffer.from(`${canonicalJson(value)}\n`));
const fail = (code) => {
  throw new Error(`V2_13_FULL_LIVE_ORCHESTRATION_${code}`);
};
const parse = (bytes, code) => {
  try {
    return JSON.parse(bytes);
  } catch {
    fail(`${code}_JSON_INVALID`);
  }
};

const MATERIALIZATION_SEED_TOP_LEVEL_KEYS = Object.freeze([
  "activation_record_base",
  "config_activation_base",
  "future_output_hashes_present",
  "production_input_base",
  "promotion_record_base",
  "release_manifest",
  "schema_version",
  "static_only",
]);
const MATERIALIZATION_SEED_FORBIDDEN_FUTURE_KEYS = Object.freeze([
  "mageEndpointId",
  "soulxEndpointId",
  "endpointId",
  "endpointIdSha256",
  "mage_endpoint_id",
  "soulx_endpoint_id",
  "endpoint_id",
  "endpoint_id_sha256",
  "deploymentSnapshotSha256",
  "deployment_snapshot_sha256",
  "mage_deployment_snapshot_sha256",
  "soulx_deployment_snapshot_sha256",
  "imageDigest",
  "image_digest",
  "publicImage",
  "public_image",
  "sourceCommit",
  "source_commit",
  "deploymentSha256",
  "deployment_sha256",
  "publicManifestSha256",
  "public_manifest_sha256",
  "versionId",
  "version_id",
  "versionSha256",
  "version_sha256",
  "disabledVersionId",
  "disabled_version_id",
  "disabledVersionSha256",
  "disabled_version_sha256",
  "futureOutputHash",
  "future_output_hash",
  "futureOutputSha256",
  "future_output_sha256",
  "futureOutputHashes",
  "future_output_hashes",
  "VIDEOFORGE_MAGE_ENDPOINT_ID",
  "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
  "VIDEOFORGE_SOULX_ENDPOINT_ID",
  "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
]);
const MATERIALIZATION_SEED_FORBIDDEN_COMMAND_KEYS = Object.freeze([
  "mageendpointid",
  "soulxendpointid",
  "endpointid",
  "endpointidsha256",
  "mage_endpoint_id",
  "soulx_endpoint_id",
  "endpoint_id",
  "endpoint_id_sha256",
  "publicimage",
  "public_image",
  "sourcecommit",
  "source_commit",
  "deploymentsha256",
  "deployment_sha256",
  "deploymentsnapshotsha256",
  "deployment_snapshot_sha256",
]);
const exactObjectKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const exactEmptyObject = (value) => exactObjectKeys(value, []);
const hasForbiddenSeedKey = (value, forbidden) =>
  value !== null &&
  typeof value === "object" &&
  Object.entries(value).some(
    ([key, nested]) => forbidden.has(key.toLowerCase()) || hasForbiddenSeedKey(nested, forbidden),
  );

const validStaticSeedLane = (value, lane, retained) =>
  exactObjectKeys(value, ["lane", "volumeIdSha256", "volumeManifestSha256"]) &&
  value.lane === lane &&
  value.volumeIdSha256 === retained.volumeIdSha256 &&
  value.volumeManifestSha256 === retained.volumeManifestSha256;

const QUALIFICATION_CASE_KEYS = Object.freeze([
  "mage",
  "soulx10s",
  "soulx2s",
  "soulx4s",
  "soulx6s",
  "soulxCancel",
  "soulxInvalidOutput",
  "soulxTimeout",
]);
const EXACT_QUALIFICATION_CASES = Object.freeze({
  mage: Object.freeze({
    lane: "mage",
    id: "mage-cold-representative",
    seconds: 0,
    mode: "complete",
    cold: true,
  }),
  soulx2s: Object.freeze({
    lane: "soulx",
    id: "soulx-cold-2s",
    seconds: 2,
    mode: "complete",
    cold: true,
  }),
  soulx4s: Object.freeze({
    lane: "soulx",
    id: "soulx-warm-4s",
    seconds: 4,
    mode: "complete",
    cold: false,
  }),
  soulx6s: Object.freeze({
    lane: "soulx",
    id: "soulx-warm-6s",
    seconds: 6,
    mode: "complete",
    cold: false,
  }),
  soulx10s: Object.freeze({
    lane: "soulx",
    id: "soulx-warm-10s",
    seconds: 10,
    mode: "complete",
    cold: false,
  }),
  soulxCancel: Object.freeze({
    lane: "soulx",
    id: "soulx-cancel",
    seconds: 2,
    mode: "cancel",
    cold: false,
  }),
  soulxInvalidOutput: Object.freeze({
    lane: "soulx",
    id: "soulx-invalid-output",
    seconds: 2,
    mode: "invalid",
    cold: false,
  }),
  soulxTimeout: Object.freeze({
    lane: "soulx",
    id: "soulx-timeout",
    seconds: 2,
    mode: "timeout",
    cold: false,
  }),
});
const EXACT_QUALIFICATION_PROTECTED_INPUTS = Object.freeze({
  avatarSource: Object.freeze({
    path: ".videoforge/private/vf-9-24u/new-avatar-sample.png",
    sha256: "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83",
    sizeBytes: 1_912_005,
    contentType: "image/png",
  }),
  soulx2s: Object.freeze({
    path: ".videoforge/private/cp07-inputs/echo-span-2s-padded.wav",
    sha256: "sha256:b7ad261af40caf574e9edadf856f28ccddc306a109d15523c81a427ec38e72d3",
    sizeBytes: 80_278,
    contentType: "audio/wav",
  }),
  soulx4s: Object.freeze({
    path: ".videoforge/private/cp07-inputs/echo-span-4s-padded.wav",
    sha256: "sha256:076f477f512835a3e606b3312682cf1b4a3eb62e211300843023840969d09019",
    sizeBytes: 160_278,
    contentType: "audio/wav",
  }),
  soulx6s: Object.freeze({
    path: ".videoforge/private/cp07-inputs/echo-span-6s-padded.wav",
    sha256: "sha256:c7c67903aae4ca8a235792402c64ffa69be3bd423babd4e0447726db27539761",
    sizeBytes: 212_118,
    contentType: "audio/wav",
  }),
  soulx10s: Object.freeze({
    path: ".videoforge/private/vf-9-24u/new-avatar-third-10.00s.wav",
    sha256: "sha256:51765f504d1a241af1aa05040cd06bbf377768bc3b2806000191f23855e577cb",
    sizeBytes: 320_278,
    contentType: "audio/wav",
  }),
});
const validSourceRef = (value, path) =>
  exactObjectKeys(value, ["path", "sha256"]) &&
  value.path === path &&
  HASH.test(value.sha256 ?? "");

function validateQualificationCaseDescriptor(value) {
  return (
    exactObjectKeys(value, [
      "caseSource",
      "cases",
      "envelopeSchema",
      "generators",
      "protectedInputs",
      "schemaVersion",
      "validators",
    ]) &&
    value.schemaVersion === "videoforge.v213-qualification-case-materialization-descriptor/v1" &&
    validSourceRef(value.caseSource, "apps/web/src/server/providers/v213-dual-lane-live.ts") &&
    validSourceRef(
      value.envelopeSchema,
      "project-context/evidence/serverless_worker_job_envelope_v3.schema.json",
    ) &&
    exactObjectKeys(value.generators, ["mage", "soulx"]) &&
    validSourceRef(value.generators.mage, "deploy/v2-13/generate-mage-qualification-case.mjs") &&
    validSourceRef(value.generators.soulx, "deploy/v2-13/generate-soulx-qualification-cases.mjs") &&
    exactObjectKeys(value.validators, ["mage", "soulx"]) &&
    validSourceRef(
      value.validators.mage,
      "workers/image-media/src/videoforge_image_media/mage_production.py",
    ) &&
    validSourceRef(value.validators.soulx, "workers/avatar-primary/soulx_serverless.py") &&
    canonicalJson(value.protectedInputs) === canonicalJson(EXACT_QUALIFICATION_PROTECTED_INPUTS) &&
    exactObjectKeys(value.cases, QUALIFICATION_CASE_KEYS) &&
    canonicalJson(value.cases) === canonicalJson(EXACT_QUALIFICATION_CASES)
  );
}

function deterministicProductionSecretKeyId(fullLiveAuthorityId, purpose) {
  return `v213-${purpose}-${sha256(Buffer.from(`${fullLiveAuthorityId}\0${purpose}`)).slice(7, 31)}`;
}

function validateStaticDualLaneInput(value, fullLiveAuthorityId) {
  if (
    !exactObjectKeys(value, [
      "accountIdSha256",
      "envelopeSigningKeyId",
      "mage",
      "mageQualificationCapUsd",
      "qualificationCaseDescriptor",
      "qualificationEnvelopeSchemaSha256",
      "qualificationR2",
      "soulx",
      "soulxQualificationCapUsd",
      "totalCapUsd",
    ]) ||
    value.accountIdSha256 !== RUNPOD_ACCOUNT_ID_SHA256 ||
    value.totalCapUsd !== 17.5 ||
    value.mageQualificationCapUsd !== 4.5 ||
    value.soulxQualificationCapUsd !== 1 ||
    !COMMAND_ID.test(value.envelopeSigningKeyId ?? "") ||
    value.envelopeSigningKeyId !==
      deterministicProductionSecretKeyId(fullLiveAuthorityId, "envelope") ||
    !validStaticSeedLane(value.mage, "mage", EXACT_RETAINED_LANES.mage) ||
    !validStaticSeedLane(value.soulx, "soulx", EXACT_RETAINED_LANES.soulx) ||
    !validateQualificationCaseDescriptor(value.qualificationCaseDescriptor) ||
    value.qualificationEnvelopeSchemaSha256 !==
      value.qualificationCaseDescriptor.envelopeSchema.sha256 ||
    !exactObjectKeys(value.qualificationR2, ["accountId", "bucketName"]) ||
    !/^[0-9a-f]{32}$/u.test(value.qualificationR2.accountId ?? "") ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(value.qualificationR2.bucketName ?? "")
  )
    return false;
  return true;
}

const proof = (letter) => `sha256:${letter.repeat(64)}`;
const deterministicUuid = (value) => {
  const hex = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
};

function validateActivationRecordBase(value, fullLiveAuthorityId) {
  if (
    !exactObjectKeys(value, [
      "authority",
      "checkpoint",
      "cloudflare",
      "database",
      "full_live_authority_id",
      "gates",
      "release",
      "schema_version",
      "secret_sha256",
      "soulx_crop_approval",
    ]) ||
    value.schema_version !== "videoforge-v2-13-guarded-activation/v1" ||
    value.checkpoint !== "V2-13" ||
    value.full_live_authority_id !== fullLiveAuthorityId ||
    !exactObjectKeys(value.authority, [
      "confirmation_sha256",
      "exact_quarantine_creation_authorized",
      "gpu_use_authorized",
      "maximum_cumulative_finite_external_spend_usd",
      "new_paid_retained_resources_authorized",
      "other_resource_creation_authorized",
      "plan_change_authorized",
      "proposal_path",
      "single_use",
    ]) ||
    value.authority.proposal_path !== PROPOSAL_RECORD_PATH ||
    value.authority.single_use !== true ||
    value.authority.gpu_use_authorized !== false ||
    value.authority.maximum_cumulative_finite_external_spend_usd !== 0 ||
    value.authority.exact_quarantine_creation_authorized !== true ||
    value.authority.new_paid_retained_resources_authorized !== false ||
    value.authority.other_resource_creation_authorized !== false ||
    value.authority.plan_change_authorized !== false ||
    value.authority.confirmation_sha256 !== sha256(Buffer.from(GUARDED_ACTIVATION_CONFIRMATION)) ||
    !exactEmptyObject(value.release) ||
    !exactEmptyObject(value.gates) ||
    value.secret_sha256 !== null ||
    !exactObjectKeys(value.database, [
      "database",
      "exact_manifest_ledger_required",
      "first_migration",
      "host",
      "last_migration",
      "owner_role",
      "operator_role",
      "operator_database_url_sha256",
      "pgcrypto_required",
      "reconciler_role",
      "runtime_role",
    ]) ||
    value.database.host !== EXACT_DATABASE_IDENTITY.host ||
    value.database.database !== EXACT_DATABASE_IDENTITY.database ||
    value.database.owner_role !== EXACT_DATABASE_IDENTITY.owner_role ||
    value.database.operator_database_url_sha256 !== null
  )
    return false;
  const filled = structuredClone(value);
  Object.assign(filled.authority, {
    mode: "APPROVED_EXECUTE",
    authority_id: "v2-13-materialization-seed-validation",
    proposal_sha256: proof("1"),
    approval_sha256: proof("2"),
    approval_path:
      "project-context/evidence/acceptance/VF-10-13/materialization-seed/user-approval.json",
    approved_at: "2026-08-27T00:00:00.000Z",
    expires_at: "2026-08-28T00:00:00.000Z",
    execute_authorized: true,
    credential_access_authorized: true,
    database_mutation_authorized: true,
    cloudflare_secret_mutation_authorized: true,
    deployment_authorized: true,
    provider_calls_authorized: true,
  });
  Object.assign(filled.release, {
    commit: "1".repeat(40),
    migration_manifest_sha256: proof("3"),
    operator_grants_sha256: proof("4"),
    production_config_activation_sha256: proof("5"),
    media_worker_release_manifest_sha256: proof("6"),
  });
  Object.assign(filled.gates, {
    mage_qualification_sha256: proof("7"),
    soulx_qualification_sha256: proof("8"),
    mage_deployment_snapshot_sha256: proof("9"),
    soulx_deployment_snapshot_sha256: proof("a"),
    paid_dispatch_authority_sha256: proof("b"),
  });
  // Only the final, post-bootstrap activation document carries this fingerprint. Use a validator-
  // local proof value to exercise the real guarded contract without requiring or reading a
  // credential before the outer single-use authority has been consumed.
  filled.database.operator_database_url_sha256 = proof("d");
  Object.assign(filled.cloudflare, {
    workers_dev_subdomain_readback_sha256: proof("e"),
    pre_mutation_account_readback_sha256: proof("f"),
    pre_mutation_worker_absence_sha256: proof("1"),
    pre_mutation_workflow_inventory_sha256: proof("2"),
    pre_mutation_r2_inventory_sha256: proof("3"),
    pre_mutation_route_content_type: "text/html; charset=UTF-8",
    pre_mutation_route_body_length: 19984,
    pre_mutation_route_readback_sha256:
      "sha256:2000e6b28a1517ba1268e1649cd3163326ef839492edfdba31e8959830580976",
  });
  filled.secret_sha256 = Object.fromEntries(GUARDED_SECRET_NAMES.map((name) => [name, proof("c")]));
  try {
    validateGuardedActivationAuthority(filled);
    return true;
  } catch {
    return false;
  }
}

function validateConfigActivationBase(value) {
  if (
    !exactObjectKeys(value, [
      "authority",
      "checkpoint",
      "cloudflare",
      "release",
      "runtime",
      "schema_version",
    ]) ||
    value.schema_version !== "videoforge-v2-13-production-config-activation/v1" ||
    value.checkpoint !== "V2-13" ||
    !exactObjectKeys(value.authority, [
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
    !exactEmptyObject(value.release) ||
    !exactObjectKeys(value.cloudflare, [
      "account_id",
      "public_origin",
      "r2_bucket_name",
      "worker_name",
      "workflow_name",
    ]) ||
    !/^[0-9a-f]{32}$/u.test(value.cloudflare.account_id ?? "") ||
    value.cloudflare.worker_name !== "videoforge-production-runtime" ||
    !/^[a-z][a-z0-9-]{2,62}$/u.test(value.cloudflare.workflow_name ?? "") ||
    !/^[a-z][a-z0-9-]{2,62}$/u.test(value.cloudflare.r2_bucket_name ?? "") ||
    !/^https:\/\/[a-z0-9.-]+$/u.test(value.cloudflare.public_origin ?? "") ||
    !exactObjectKeys(value.runtime, [
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
    return false;
  const config = JSON.parse(
    readFileSync(resolve(ROOT, "apps/web/wrangler.production.jsonc"), "utf8")
      .replace(/^\s*\/\/.*$/gmu, "")
      .replace(/,\s*([}\]])/gu, "$1"),
  );
  config.main = resolve(ROOT, "apps/web/dist-cloudflare/videoforge_production_runtime/index.js");
  config.assets.directory = resolve(ROOT, "apps/web/dist-cloudflare/client");
  config.account_id = value.cloudflare.account_id;
  config.r2_buckets[0].bucket_name = value.cloudflare.r2_bucket_name;
  config.workflows[0].name = value.cloudflare.workflow_name;
  config.workflows[1].name = `${value.cloudflare.workflow_name}-pair`;
  Object.assign(config.vars, {
    VIDEOFORGE_COMMIT: "1".repeat(40),
    VIDEOFORGE_PUBLIC_ORIGIN: value.cloudflare.public_origin,
    R2_ACCOUNT_ID: value.cloudflare.account_id,
    VIDEOFORGE_R2_BUCKET_NAME: value.cloudflare.r2_bucket_name,
    MEDIA_WORKER_RELEASE_MANIFEST_JSON: JSON.stringify({}),
  });
  try {
    // Validate the static renderer identities without accepting the placeholder media manifest.
    config.vars.MEDIA_WORKER_RELEASE_MANIFEST_JSON = JSON.stringify({
      schema_version: "videoforge-media-worker-release/v1",
      version: "1.0.0",
      minimum_protocol_version: 1,
      execution_bundle_sha256: proof("d"),
      whisper_model_sha256: proof("e"),
      windows: {
        url: "https://downloads.videoforge.example/worker.exe",
        sha256: proof("f"),
        size_bytes: 1,
        trust: "UNSIGNED_BETA",
      },
      macos: {
        url: "https://downloads.videoforge.example/worker.dmg",
        sha256: proof("0"),
        size_bytes: 1,
        trust: "AD_HOC_BETA",
      },
    });
    validateProductionConfig(config, { mode: "activated" });
    return true;
  } catch {
    return false;
  }
}

function validatePromotionRecordBase(value) {
  if (
    !exactObjectKeys(value, [
      "approval",
      "cloudflare",
      "database",
      "lanes",
      "release",
      "schema_version",
    ]) ||
    value.schema_version !== "videoforge.v2-13-qualified-promotion/v1" ||
    !exactEmptyObject(value.approval) ||
    !exactEmptyObject(value.release) ||
    !exactObjectKeys(value.database, [
      "activation_id",
      "migration_ledger_sha256",
      "promotion_id",
      "rollback_id",
    ]) ||
    !UUID.test(value.database.activation_id ?? "") ||
    !UUID.test(value.database.promotion_id ?? "") ||
    !UUID.test(value.database.rollback_id ?? "") ||
    !HASH.test(value.database.migration_ledger_sha256 ?? "") ||
    !exactObjectKeys(value.lanes, ["mage_image", "soulx_avatar"]) ||
    [value.lanes.mage_image, value.lanes.soulx_avatar].some(
      (lane) =>
        !exactObjectKeys(lane, ["deployment_id", "qualification_id"]) ||
        !UUID.test(lane.deployment_id ?? "") ||
        !UUID.test(lane.qualification_id ?? ""),
    ) ||
    !exactObjectKeys(value.cloudflare, [
      "account_id_sha256",
      "public_origin",
      "worker_name",
      "workflow_name",
    ]) ||
    !HASH.test(value.cloudflare.account_id_sha256 ?? "") ||
    value.cloudflare.worker_name !== "videoforge-production-runtime" ||
    !/^[a-z][a-z0-9-]{2,62}$/u.test(value.cloudflare.workflow_name ?? "") ||
    !/^https:\/\/[a-z0-9.-]+$/u.test(value.cloudflare.public_origin ?? "")
  )
    return false;
  const filled = structuredClone(value);
  Object.assign(filled.approval, {
    authority_id: "v2-13-materialization-seed-validation",
    proposal_sha256: proof("1"),
    approval_sha256: proof("2"),
    approved_at: "2026-08-27T00:00:00.000Z",
    expires_at: "2026-08-28T00:00:00.000Z",
    single_use: true,
  });
  Object.assign(filled.release, {
    commit: "1".repeat(40),
    disabled_config_sha256: proof("3"),
    enabled_config_sha256: proof("4"),
  });
  Object.assign(filled.database, {
    full_live_authority_id: "11111111-1111-4111-8111-111111111111",
    authority_document_sha256: proof("5"),
    executor_sha256: proof("6"),
    paid_approval_sha256: proof("7"),
  });
  Object.assign(filled.lanes.mage_image, {
    qualification_record_sha256: proof("8"),
    deployment_snapshot_sha256: proof("9"),
  });
  Object.assign(filled.lanes.soulx_avatar, {
    qualification_record_sha256: proof("a"),
    deployment_snapshot_sha256: proof("b"),
  });
  Object.assign(filled.cloudflare, {
    disabled_version_id: "22222222-2222-4222-8222-222222222222",
    disabled_version_sha256: sha256(Buffer.from("22222222-2222-4222-8222-222222222222")),
  });
  try {
    validatePromotionRecord(filled);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate the complete nested static seed contract before the one-shot authority is consumed.
 * This is also reused by the materializer, keeping the outer and first-use boundaries identical.
 */
function validateMaterializationSeedShape(value) {
  const forbiddenFutureKeys = new Set(
    MATERIALIZATION_SEED_FORBIDDEN_FUTURE_KEYS.map((key) => key.toLowerCase()),
  );
  const forbiddenCommandKeys = new Set(MATERIALIZATION_SEED_FORBIDDEN_COMMAND_KEYS);
  const hasForbiddenCommandSelector = (item) =>
    item !== null &&
    typeof item === "object" &&
    Object.entries(item).some(
      ([key, nested]) =>
        forbiddenCommandKeys.has(key.toLowerCase()) || hasForbiddenCommandSelector(nested),
    );
  const production = value?.production_input_base;
  const lanes = production?.dualLaneInput;
  const dynamicSeedValues = [
    lanes?.mage?.publicImage,
    lanes?.mage?.deploymentSha256,
    lanes?.mage?.sourceCommit,
    lanes?.soulx?.publicImage,
    lanes?.soulx?.deploymentSha256,
    lanes?.soulx?.sourceCommit,
    value?.activation_record_base?.release?.production_config_activation_sha256,
    value?.activation_record_base?.release?.media_worker_release_manifest_sha256,
    value?.activation_record_base?.gates?.mage_qualification_sha256,
    value?.activation_record_base?.gates?.soulx_qualification_sha256,
    value?.activation_record_base?.gates?.mage_deployment_snapshot_sha256,
    value?.activation_record_base?.gates?.soulx_deployment_snapshot_sha256,
    value?.activation_record_base?.gates?.paid_dispatch_authority_sha256,
    value?.activation_record_base?.database?.operator_database_url_sha256,
    value?.promotion_record_base?.release?.disabled_config_sha256,
    value?.promotion_record_base?.release?.enabled_config_sha256,
    value?.promotion_record_base?.database?.authority_document_sha256,
    value?.promotion_record_base?.lanes?.mage_image?.qualification_record_sha256,
    value?.promotion_record_base?.lanes?.mage_image?.deployment_snapshot_sha256,
    value?.promotion_record_base?.lanes?.soulx_avatar?.qualification_record_sha256,
    value?.promotion_record_base?.lanes?.soulx_avatar?.deployment_snapshot_sha256,
    value?.promotion_record_base?.cloudflare?.disabled_version_id,
    value?.promotion_record_base?.cloudflare?.disabled_version_sha256,
  ];
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.schema_version === MATERIALIZATION_SEED_SCHEMA &&
    value.static_only === true &&
    value.future_output_hashes_present === false &&
    exactObjectKeys(value, MATERIALIZATION_SEED_TOP_LEVEL_KEYS) &&
    !hasForbiddenSeedKey(value, forbiddenFutureKeys) &&
    !hasForbiddenCommandSelector(value.production_input_base?.commandPayloads) &&
    exactObjectKeys(production, [
      "authorityDocument",
      "commandPayloads",
      "dualLaneInput",
      "fullLiveAuthorityId",
      "schemaVersion",
    ]) &&
    production.schemaVersion === "videoforge.v213-full-live-outer-input/v1" &&
    UUID.test(production.fullLiveAuthorityId ?? "") &&
    exactEmptyObject(production.authorityDocument) &&
    validateStaticDualLaneInput(lanes, production.fullLiveAuthorityId) &&
    exactEmptyObject(production.commandPayloads) &&
    validateActivationRecordBase(value.activation_record_base, production.fullLiveAuthorityId) &&
    validateConfigActivationBase(value.config_activation_base) &&
    value.release_manifest === null &&
    validatePromotionRecordBase(value.promotion_record_base) &&
    value.activation_record_base.cloudflare.account_id ===
      value.config_activation_base.cloudflare.account_id &&
    value.activation_record_base.cloudflare.public_origin ===
      value.config_activation_base.cloudflare.public_origin &&
    value.activation_record_base.cloudflare.r2_bucket_name ===
      value.config_activation_base.cloudflare.r2_bucket_name &&
    lanes.qualificationR2.accountId === value.activation_record_base.cloudflare.account_id &&
    lanes.qualificationR2.bucketName === value.activation_record_base.cloudflare.r2_bucket_name &&
    value.activation_record_base.cloudflare.worker_name ===
      value.config_activation_base.cloudflare.worker_name &&
    value.activation_record_base.cloudflare.workflow_name ===
      value.config_activation_base.cloudflare.workflow_name &&
    value.promotion_record_base.cloudflare.account_id_sha256 ===
      sha256(Buffer.from(value.config_activation_base.cloudflare.account_id)) &&
    value.promotion_record_base.cloudflare.public_origin ===
      value.config_activation_base.cloudflare.public_origin &&
    value.promotion_record_base.cloudflare.worker_name ===
      value.config_activation_base.cloudflare.worker_name &&
    value.promotion_record_base.cloudflare.workflow_name ===
      value.config_activation_base.cloudflare.workflow_name &&
    value.promotion_record_base.lanes.mage_image.deployment_id ===
      deterministicUuid(`${production.fullLiveAuthorityId}:mage:deployment`) &&
    value.promotion_record_base.lanes.mage_image.qualification_id ===
      deterministicUuid(`${production.fullLiveAuthorityId}:mage:qualification`) &&
    value.promotion_record_base.lanes.soulx_avatar.deployment_id ===
      deterministicUuid(`${production.fullLiveAuthorityId}:soulx:deployment`) &&
    value.promotion_record_base.lanes.soulx_avatar.qualification_id ===
      deterministicUuid(`${production.fullLiveAuthorityId}:soulx:qualification`) &&
    dynamicSeedValues.every((item) => item === undefined || item === null)
  );
}

/**
 * Verify the protected static materialization seed before the one-shot authority can be
 * consumed.  The adapter owns the complete nested seed contract; the outer boundary only binds
 * the exact canonical JSON hash and protected file seam so a restart cannot silently read a
 * different seed.  This function deliberately does not inspect credentials or call a provider.
 */
function validateMaterializationSeedFile({ path, expectedSha256, expectedFullLiveAuthorityId }) {
  if (
    !HASH.test(expectedSha256 ?? "") ||
    typeof path !== "string" ||
    path === "" ||
    !path.startsWith("/") ||
    path.includes("\0")
  )
    fail("MATERIALIZATION_SEED_BINDING");
  let file;
  let directory;
  try {
    file = lstatSync(path);
    directory = lstatSync(dirname(path));
  } catch {
    fail("MATERIALIZATION_SEED_INPUT");
  }
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o777) !== 0o700 ||
    !file.isFile() ||
    file.isSymbolicLink() ||
    (file.mode & 0o777) !== 0o600
  )
    fail("MATERIALIZATION_SEED_MODE_OR_TYPE");
  let bytes;
  let value;
  try {
    bytes = readFileSync(path);
    value = JSON.parse(bytes);
  } catch {
    fail("MATERIALIZATION_SEED_JSON");
  }
  if (!validateMaterializationSeedShape(value)) fail("MATERIALIZATION_SEED_CONTRACT");
  if (
    expectedFullLiveAuthorityId !== undefined &&
    (value.production_input_base.fullLiveAuthorityId !== expectedFullLiveAuthorityId ||
      !UUID.test(expectedFullLiveAuthorityId))
  )
    fail("MATERIALIZATION_SEED_AUTHORITY_BINDING");
  const canonicalBytes = Buffer.from(`${canonicalJson(value)}\n`);
  if (Buffer.compare(bytes, canonicalBytes) !== 0) fail("MATERIALIZATION_SEED_CANONICAL_BYTES");
  if (sha256(canonicalBytes) !== expectedSha256) fail("MATERIALIZATION_SEED_HASH");
  if (
    sha256(readFileSync(resolve(ROOT, MATERIALIZATION_PRODUCTION_INPUT_VALIDATOR_PATH))) !==
    MATERIALIZATION_PRODUCTION_INPUT_VALIDATOR_SHA256
  )
    fail("MATERIALIZATION_SEED_PRODUCTION_VALIDATOR_DRIFT");
  const childEnvironment = Object.fromEntries(
    ["HOME", "PATH", "PNPM_HOME", "TMPDIR"]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
  try {
    execFileSync(
      "pnpm",
      [
        "--filter",
        "@videoforge/web",
        "exec",
        "tsx",
        "../../deploy/v2-13/validate-materialization-seed-production-input.mts",
        path,
      ],
      {
        cwd: ROOT,
        env: childEnvironment,
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 30_000,
        maxBuffer: 1_048_576,
      },
    );
  } catch {
    fail("MATERIALIZATION_SEED_PRODUCTION_INPUT");
  }
  return Object.freeze({ value, sha256: expectedSha256 });
}

/** Verify canonical protected descriptor bytes before one-shot authority consumption or restart. */
function validateStaticReleaseDescriptorFile({ path, expectedSha256, expectedSourceCommit }) {
  if (
    !HASH.test(expectedSha256 ?? "") ||
    !/^[0-9a-f]{40}$/u.test(expectedSourceCommit ?? "") ||
    typeof path !== "string" ||
    path === "" ||
    !path.startsWith("/") ||
    path.includes("\0")
  )
    fail("STATIC_RELEASE_DESCRIPTOR_BINDING");
  let file;
  let directory;
  let bytes;
  let value;
  try {
    file = lstatSync(path);
    directory = lstatSync(dirname(path));
    bytes = readFileSync(path);
    value = JSON.parse(bytes);
  } catch {
    fail("STATIC_RELEASE_DESCRIPTOR_INPUT");
  }
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o777) !== 0o700 ||
    !file.isFile() ||
    file.isSymbolicLink() ||
    (file.mode & 0o777) !== 0o600
  )
    fail("STATIC_RELEASE_DESCRIPTOR_MODE_OR_TYPE");
  if (
    !exactObjectKeys(value, [
      "auditFacts",
      "contractBundleSha256",
      "descriptorSha256",
      "productionUrlSha256",
      "schemaVersion",
      "sourceCommit",
    ]) ||
    value.schemaVersion !== "videoforge.v213-static-release-descriptor/v1" ||
    value.sourceCommit !== expectedSourceCommit ||
    !HASH.test(value.productionUrlSha256 ?? "") ||
    !HASH.test(value.contractBundleSha256 ?? "") ||
    !HASH.test(value.descriptorSha256 ?? "") ||
    value.descriptorSha256 !== expectedSha256 ||
    !exactObjectKeys(value.auditFacts, [
      "backup_restore_ready",
      "operations_runbooks_ready",
      "production_transport_real",
      "security_clear",
    ])
  )
    fail("STATIC_RELEASE_DESCRIPTOR_CONTRACT");
  const unsigned = { ...value };
  delete unsigned.descriptorSha256;
  if (
    sha256(Buffer.from(canonicalJson(unsigned))) !== value.descriptorSha256 ||
    Buffer.compare(bytes, Buffer.from(`${canonicalJson(value)}\n`)) !== 0
  )
    fail("STATIC_RELEASE_DESCRIPTOR_HASH");
  return Object.freeze(value);
}
const finiteUsd = (value, code) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(code);
  return Math.round(value * 1_000_000) / 1_000_000;
};
const phaseMap = () =>
  Object.fromEntries(
    PHASES.map(([name, cap]) => [
      name,
      { cap_usd: cap, state: "PENDING", reserved_usd: 0, settled_usd: 0, work: {} },
    ]),
  );

function validateOuterAuthority({ proposalBytes, approvalBytes, authorityBytes }) {
  const authority = parse(authorityBytes, "AUTHORITY");
  const combined = authority.combined_execution_authority;
  if (
    authority.schema_version !== "videoforge.v2-13-full-live-approved-authority/v1" ||
    !AUTHORITY_ID.test(authority.authority_id ?? "") ||
    !UUID.test(authority.full_live_authority_id ?? "") ||
    authority.status !== "APPROVED_UNCONSUMED_PENDING_FRESH_EXECUTION_INPUTS" ||
    authority.single_use !== true ||
    authority.consumed !== false ||
    combined?.maximum_cumulative_finite_runpod_spend_usd !== 17.5 ||
    combined.redispatch_authorized !== false ||
    [
      "execute_authorized",
      "credential_access_authorized",
      "database_mutation_authorized",
      "cloudflare_secret_mutation_authorized",
      "deployment_authorized",
      "provider_calls_authorized",
      "provider_mutations_authorized",
      "gpu_use_authorized",
      "external_runpod_spend_authorized",
    ].some((key) => combined[key] !== true) ||
    combined.new_volume_authorized !== false ||
    combined.new_paid_retained_resource_authorized !== false ||
    combined.recurring_plan_change_authorized !== false ||
    !HASH.test(authority.materialization_seed_sha256 ?? "") ||
    !exactObjectKeys(authority.static_release_descriptor, ["path", "sha256"]) ||
    typeof authority.static_release_descriptor.path !== "string" ||
    authority.static_release_descriptor.path.startsWith("/") ||
    authority.static_release_descriptor.path.split("/").includes("..") ||
    !authority.static_release_descriptor.path.endsWith(".json") ||
    !HASH.test(authority.static_release_descriptor.sha256 ?? "") ||
    JSON.stringify(authority.phase_caps_usd) !== JSON.stringify(EXPECTED_PHASE_CAPS)
  )
    fail("AUTHORITY_CONTRACT");
  const validated = validateFullLiveUserApproval({
    proposalBytes,
    approvalBytes,
    expectedProposalSha256: authority.lineage?.proposal_sha256,
    expectedProposalRecordCommit: authority.lineage?.proposal_record_commit,
    expectedReleaseSourceCommit: authority.lineage?.release_source_commit,
  });
  if (
    authority.authority_id !== validated.authorityId ||
    authority.full_live_authority_id !== validated.fullLiveAuthorityId ||
    authority.lineage?.user_approval_sha256 !== validated.approvalSha256 ||
    authority.static_release_descriptor.path !== validated.staticReleaseDescriptorPath ||
    authority.static_release_descriptor.sha256 !== validated.staticReleaseDescriptorSha256 ||
    authority.approved_at !== validated.approvedAt ||
    authority.expires_at !== validated.expiresAt ||
    validated.proposalSchema !== "videoforge.v2-13-full-live-completion-proposal/v3" ||
    authority.github_release_ref?.status !== "AUTHORIZED_EXACT_SINGLE_REF_PENDING_CREATION" ||
    authority.github_release_ref?.ref_creation_authorized_by_approved_proposal !== true ||
    authority.github_release_ref?.exact_tag_name !== "videoforge-v2-13-release-20260826-v3" ||
    authority.github_release_ref?.exact_target_commit !== validated.releaseSourceCommit ||
    authority.github_release_ref?.external_action_taken !== false
  )
    fail("AUTHORITY_LINEAGE");
  const approvalValidatorPath = authority.outer_orchestration?.approval_schema_validator_path;
  const approvalValidatorSha256 = authority.outer_orchestration?.approval_schema_validator_sha256;
  if (
    approvalValidatorPath !== EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING.tree_entry_path ||
    EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING.commit_field !== "source.release_source_commit" ||
    EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING.verification !==
      "GIT_SHOW_EXACT_COMMIT_PATH_THEN_SHA256" ||
    !HASH.test(approvalValidatorSha256 ?? "")
  )
    fail("APPROVAL_VALIDATOR_TREE_BINDING");
  let resolvedReleaseCommit;
  try {
    resolvedReleaseCommit = execFileSync(
      "git",
      ["rev-parse", `${validated.releaseSourceCommit}^{commit}`],
      {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch {
    fail("APPROVAL_VALIDATOR_RELEASE_COMMIT");
  }
  if (resolvedReleaseCommit !== validated.releaseSourceCommit)
    fail("APPROVAL_VALIDATOR_RELEASE_COMMIT");
  let committedApprovalValidatorBytes;
  try {
    committedApprovalValidatorBytes = execFileSync(
      "git",
      ["show", `${validated.releaseSourceCommit}:${approvalValidatorPath}`],
      { cwd: ROOT, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    fail("APPROVAL_VALIDATOR_TREE_ENTRY_UNAVAILABLE");
  }
  if (
    sha256(committedApprovalValidatorBytes) !== approvalValidatorSha256 ||
    sha256(readFileSync(resolve(ROOT, approvalValidatorPath))) !== approvalValidatorSha256
  )
    fail("APPROVAL_VALIDATOR_TREE_BYTES");
  for (const [pathKey, hashKey] of [
    ["orchestration_tool_path", "orchestration_tool_sha256"],
    ["guarded_activation_path", "guarded_activation_sha256"],
    ["full_live_executor_path", "full_live_executor_sha256"],
  ]) {
    const sourcePath = authority.outer_orchestration?.[pathKey];
    const expected = authority.outer_orchestration?.[hashKey];
    if (
      typeof sourcePath !== "string" ||
      sourcePath.startsWith("/") ||
      sourcePath.includes("..") ||
      !HASH.test(expected ?? "") ||
      sha256(readFileSync(resolve(ROOT, sourcePath))) !== expected
    )
      fail("ORCHESTRATION_SOURCE_DRIFT");
  }
  if (
    authority.outer_orchestration?.consumption_record_created !== false ||
    authority.outer_orchestration?.consumption_record_sha256 !== null ||
    authority.outer_orchestration?.consumption_required_before_credentials_or_external_calls !==
      true ||
    authority.outer_orchestration
      ?.state_updates_require_exact_prior_state_sha256_and_exclusive_lock !== true ||
    authority.outer_orchestration?.phase_order_caps_cumulative_cap_and_no_redispatch_enforced !==
      true
  )
    fail("ORCHESTRATION_SEAL");
  return { authority, validated };
}

function assertTrustedTime(approvedAt, expiresAt, trustedIso) {
  const trusted = Date.parse(trustedIso ?? "");
  if (Number.isNaN(trusted) || trusted < Date.parse(approvedAt) || trusted > Date.parse(expiresAt))
    fail("TRUSTED_TIME");
}

function readAuthenticatedTrustedTime() {
  const output = execFileSync(
    "curl",
    [
      "--disable",
      "--silent",
      "--show-error",
      "--head",
      "--proto",
      "=https",
      "--tlsv1.2",
      "--connect-timeout",
      "5",
      "--max-time",
      "10",
      "https://api.github.com/rate_limit",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        NO_PROXY: "*",
        no_proxy: "*",
      },
      timeout: 12_000,
    },
  );
  const dates = output
    .split(/\r?\n/u)
    .filter((line) => /^date:/iu.test(line))
    .map((line) => line.slice(line.indexOf(":") + 1).trim());
  if (dates.length !== 1 || Number.isNaN(Date.parse(dates[0]))) fail("TRUSTED_TIME_READBACK");
  return new Date(Date.parse(dates[0])).toISOString();
}

function initialConsumptionRecord(authority, authorityBytes, validated) {
  return {
    schema_version: "videoforge.v2-13-full-live-orchestration-consumption/v2",
    authority_id: authority.authority_id,
    full_live_authority_id: authority.full_live_authority_id,
    authority_sha256: sha256(authorityBytes),
    proposal_sha256: validated.proposalSha256,
    approval_sha256: validated.approvalSha256,
    proposal_record_commit: validated.proposalRecordCommit,
    authority_record_commit: validated.authorityRecordCommit,
    approval_record_path: validated.approvalRecordPath,
    authority_record_path: validated.authorityRecordPath,
    release_source_commit: validated.releaseSourceCommit,
    full_live_executor_path: authority.outer_orchestration.full_live_executor_path,
    full_live_executor_sha256: authority.outer_orchestration.full_live_executor_sha256,
    materialization_seed_sha256: authority.materialization_seed_sha256,
    static_release_descriptor_path: validated.staticReleaseDescriptorPath,
    static_release_descriptor_sha256: validated.staticReleaseDescriptorSha256,
    approved_at: validated.approvedAt,
    expires_at: validated.expiresAt,
    state: "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS",
    maximum_cumulative_finite_runpod_spend_usd: 17.5,
    total_reserved_usd: 0,
    total_settled_usd: 0,
    no_redispatch: true,
    // This is the durable boundary for the operator-only cleanup seam.  It is set in the same
    // state CAS that settles the bootstrap result and is repaired during result hydration after
    // a restart; never infer it from a preflight having run.
    operator_role_verified: false,
    current_phase_index: 0,
    phases: phaseMap(),
    event_ids: [],
    work_ids: [],
    release_ref: {
      exact_tag_name: "videoforge-v2-13-release-20260826-v3",
      exact_target_commit: validated.releaseSourceCommit,
      state: "AUTHORIZED_PENDING_CREATION",
      verification_event_id: null,
    },
    cleanup_proof: null,
    release_certification: null,
    terminal: null,
  };
}

function validateState(state) {
  if (
    state?.schema_version !== "videoforge.v2-13-full-live-orchestration-consumption/v2" ||
    !AUTHORITY_ID.test(state.authority_id ?? "") ||
    !UUID.test(state.full_live_authority_id ?? "") ||
    !HASH.test(state.authority_sha256 ?? "") ||
    !/^[0-9a-f]{40}$/u.test(state.authority_record_commit ?? "") ||
    ![state.approval_record_path, state.authority_record_path].every(
      (path) =>
        typeof path === "string" &&
        path !== "" &&
        !path.startsWith("/") &&
        !path.split("/").includes(".."),
    ) ||
    state.maximum_cumulative_finite_runpod_spend_usd !== 17.5 ||
    state.full_live_executor_path !== "deploy/v2-13/full-live-executor.mjs" ||
    state.full_live_executor_sha256 !==
      "sha256:d9efa4761be27c4f3f8cd5871128fa54bcc981e2c41c200c0e711447e1ef3f80" ||
    !HASH.test(state.materialization_seed_sha256 ?? "") ||
    typeof state.static_release_descriptor_path !== "string" ||
    state.static_release_descriptor_path.startsWith("/") ||
    state.static_release_descriptor_path.split("/").includes("..") ||
    !state.static_release_descriptor_path.endsWith(".json") ||
    !HASH.test(state.static_release_descriptor_sha256 ?? "") ||
    state.no_redispatch !== true ||
    typeof state.operator_role_verified !== "boolean" ||
    !Object.hasOwn(state, "release_certification") ||
    ![
      "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS",
      "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY",
      "CONSUMED_SINGLE_EXECUTION_COMPLETE",
      "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY",
    ].includes(state.state) ||
    JSON.stringify(Object.keys(state.phases ?? {})) !== JSON.stringify(PHASES.map(([name]) => name))
  )
    fail("STATE_CONTRACT");
  for (const [name, cap] of PHASES) {
    const phase = state.phases[name];
    if (
      phase.cap_usd !== cap ||
      !["PENDING", "ACTIVE", "COMPLETE", "FAILED_CLEANUP_ONLY"].includes(phase.state) ||
      finiteUsd(phase.reserved_usd, "PHASE_RESERVED") > cap ||
      finiteUsd(phase.settled_usd, "PHASE_SETTLED") > phase.reserved_usd ||
      phase.work === null ||
      typeof phase.work !== "object" ||
      Array.isArray(phase.work)
    )
      fail("PHASE_CONTRACT");
    for (const [workId, work] of Object.entries(phase.work)) {
      const hasSettledResult = work?.settled_result !== undefined;
      const hasSettledResultHash = work?.settled_result_sha256 !== undefined;
      if (
        !/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(workId) ||
        !["AUTHORIZED_ONCE_NOT_REDISPATCHABLE", "SETTLED_TERMINAL"].includes(work?.state) ||
        finiteUsd(work.reservation_usd, "WORK_RESERVATION") > cap ||
        !/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(work.authorization_event_id ?? "") ||
        !state.event_ids.includes(work.authorization_event_id) ||
        (work.state === "AUTHORIZED_ONCE_NOT_REDISPATCHABLE" && work.settled_usd !== null) ||
        (work.state === "SETTLED_TERMINAL" &&
          (finiteUsd(work.settled_usd, "WORK_SETTLEMENT") > work.reservation_usd ||
            !/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(work.settlement_event_id ?? "") ||
            !state.event_ids.includes(work.settlement_event_id))) ||
        hasSettledResult !== hasSettledResultHash ||
        (hasSettledResult &&
          (work.state !== "SETTLED_TERMINAL" ||
            work.settled_result === null ||
            typeof work.settled_result !== "object" ||
            Array.isArray(work.settled_result) ||
            !HASH.test(work.settled_result_sha256 ?? "") ||
            settledResultSha256(work.settled_result) !== work.settled_result_sha256)) ||
        (work.state === "AUTHORIZED_ONCE_NOT_REDISPATCHABLE" &&
          (hasSettledResult || hasSettledResultHash))
      )
        fail("WORK_CONTRACT");
    }
  }
  const certificationWorkId = `${state.authority_id}:certify-v2-13-release`.toLowerCase();
  const actualWorkIds = [
    ...Object.values(state.phases).flatMap((phase) => Object.keys(phase.work)),
    ...(state.release_certification === null ? [] : [state.release_certification.work_id]),
  ];
  const bootstrapWorkId = `${state.authority_id}:${BOOTSTRAP_OPERATION}`.toLowerCase();
  const bootstrapWork = state.phases[BOOTSTRAP_PHASE]?.work?.[bootstrapWorkId];
  if (
    state.operator_role_verified === true &&
    (bootstrapWork?.state !== "SETTLED_TERMINAL" ||
      bootstrapWork?.settled_result === undefined ||
      bootstrapWork?.settled_result === null)
  )
    fail("OPERATOR_ROLE_VERIFICATION");
  const reserved = finiteUsd(
    Object.values(state.phases).reduce((sum, phase) => sum + phase.reserved_usd, 0),
    "TOTAL_RESERVED",
  );
  const settled = finiteUsd(
    Object.values(state.phases).reduce((sum, phase) => sum + phase.settled_usd, 0),
    "TOTAL_SETTLED",
  );
  if (
    reserved !== state.total_reserved_usd ||
    settled !== state.total_settled_usd ||
    reserved > 17.5 ||
    settled > reserved ||
    new Set(state.event_ids).size !== state.event_ids.length ||
    new Set(state.work_ids).size !== state.work_ids.length ||
    JSON.stringify([...actualWorkIds].sort()) !== JSON.stringify([...state.work_ids].sort()) ||
    state.release_ref?.exact_tag_name !== "videoforge-v2-13-release-20260826-v3" ||
    state.release_ref?.exact_target_commit !== state.release_source_commit ||
    !["AUTHORIZED_PENDING_CREATION", "VERIFIED_EXACT_REMOTE"].includes(state.release_ref?.state)
  )
    fail("CUMULATIVE_CAP_OR_EVENT_REPLAY");
  if (
    state.release_ref.state === "VERIFIED_EXACT_REMOTE" &&
    !/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(state.release_ref.verification_event_id ?? "")
  )
    fail("RELEASE_REF_EVENT");
  if (state.cleanup_proof !== null) {
    const exactCleanupWorkIds = CLEANUP_SAFETY_OPERATION_IDS.map((operationId) =>
      `${state.authority_id}:${operationId}`.toLowerCase(),
    ).sort();
    if (
      JSON.stringify(Object.keys(state.cleanup_proof)) !==
        JSON.stringify([
          "zero_worker_proof_sha256",
          "billing_proof_sha256",
          "resource_reconciliation_sha256",
          "max_one_restoration_sha256",
          "cleanup_work_ids",
          "event_id",
        ]) ||
      ![
        state.cleanup_proof.zero_worker_proof_sha256,
        state.cleanup_proof.billing_proof_sha256,
        state.cleanup_proof.resource_reconciliation_sha256,
        state.cleanup_proof.max_one_restoration_sha256,
      ].every((value) => HASH.test(value ?? "")) ||
      !Array.isArray(state.cleanup_proof.cleanup_work_ids) ||
      JSON.stringify(state.cleanup_proof.cleanup_work_ids) !==
        JSON.stringify(Object.keys(state.phases.cleanup_and_reconciliation.work).sort()) ||
      JSON.stringify(state.cleanup_proof.cleanup_work_ids) !==
        JSON.stringify(exactCleanupWorkIds) ||
      !state.event_ids.includes(state.cleanup_proof.event_id)
    )
      fail("CLEANUP_PROOF_CONTRACT");
  }
  if (state.release_certification !== null) {
    const certification = state.release_certification;
    const authorizedKeys = ["work_id", "state", "authorization_event_id"].sort();
    const settledKeys = [
      ...authorizedKeys,
      "settled_result",
      "settled_result_sha256",
      "settlement_event_id",
    ].sort();
    if (
      certification.work_id !== certificationWorkId ||
      !["AUTHORIZED_ONCE_RECONCILIATION_ONLY", "SETTLED_TERMINAL"].includes(certification.state) ||
      certification.authorization_event_id !== `${certificationWorkId}:authorized` ||
      !state.event_ids.includes(certification.authorization_event_id) ||
      JSON.stringify(Object.keys(certification).sort()) !==
        JSON.stringify(certification.state === "SETTLED_TERMINAL" ? settledKeys : authorizedKeys) ||
      (certification.state === "SETTLED_TERMINAL" &&
        (certification.settled_result === null ||
          typeof certification.settled_result !== "object" ||
          Array.isArray(certification.settled_result) ||
          !HASH.test(certification.settled_result_sha256 ?? "") ||
          settledResultSha256(certification.settled_result) !==
            certification.settled_result_sha256 ||
          certification.settlement_event_id !== `${certificationWorkId}:settled` ||
          !state.event_ids.includes(certification.settlement_event_id)))
    )
      fail("RELEASE_CERTIFICATION_CONTRACT");
  }
  const phaseStates = PHASES.map(([name]) => state.phases[name].state);
  if (state.state === "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS") {
    if (
      !Number.isInteger(state.current_phase_index) ||
      state.current_phase_index < 0 ||
      state.current_phase_index >= PHASES.length ||
      state.terminal !== null ||
      phaseStates.slice(0, state.current_phase_index).some((value) => value !== "COMPLETE") ||
      !["PENDING", "ACTIVE"].includes(phaseStates[state.current_phase_index]) ||
      phaseStates.slice(state.current_phase_index + 1).some((value) => value !== "PENDING")
    )
      fail("IN_PROGRESS_STATE_INVARIANT");
  } else if (state.state === "CONSUMED_SINGLE_EXECUTION_COMPLETE") {
    if (
      state.current_phase_index !== PHASES.length ||
      phaseStates.some((value) => value !== "COMPLETE") ||
      state.cleanup_proof === null ||
      state.release_certification?.state !== "SETTLED_TERMINAL" ||
      state.terminal !== "CLEANUP_ZERO_WORKER_BILLING_RECONCILED"
    )
      fail("COMPLETE_STATE_INVARIANT");
  } else if (state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY") {
    if (
      state.current_phase_index !== PHASES.length - 1 ||
      state.phases.cleanup_and_reconciliation.state !== "ACTIVE" ||
      state.terminal !== null ||
      !/^[A-Z0-9][A-Z0-9_]{7,127}$/u.test(state.cleanup_failure_code ?? "")
    )
      fail("CLEANUP_ONLY_STATE_INVARIANT");
  } else if (state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY") {
    if (
      state.current_phase_index !== PHASES.length ||
      state.phases.cleanup_and_reconciliation.state !== "COMPLETE" ||
      state.cleanup_proof === null ||
      state.terminal !== "CLEANUP_PROOFS_RECORDED_ZERO_WORKER_BILLING_RESOURCES_RECONCILED" ||
      !/^[A-Z0-9][A-Z0-9_]{7,127}$/u.test(state.cleanup_failure_code ?? "")
    )
      fail("CLEANUP_COMPLETE_STATE_INVARIANT");
  }
  return state;
}

function requireInProgress(state) {
  if (state.state !== "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS") fail("NOT_IN_PROGRESS");
}

function beginPhase(state, phaseName) {
  validateState(state);
  requireInProgress(state);
  const index = PHASES.findIndex(([name]) => name === phaseName);
  if (index < 0 || index !== state.current_phase_index) fail("PHASE_ORDER");
  if (index > 0 && state.phases[PHASES[index - 1][0]].state !== "COMPLETE")
    fail("PREVIOUS_PHASE_INCOMPLETE");
  if (state.phases[phaseName].state !== "PENDING") fail("PHASE_ALREADY_STARTED");
  state.phases[phaseName].state = "ACTIVE";
  return validateState(state);
}

function authorizeWork(state, { phaseName, workId, reservationUsd, eventId }) {
  validateState(state);
  requireInProgress(state);
  const phase = state.phases[phaseName];
  const reserve = finiteUsd(reservationUsd, "RESERVATION_INVALID");
  if (phase?.state !== "ACTIVE") fail("PHASE_NOT_ACTIVE");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(workId ?? "")) fail("WORK_ID");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "")) fail("EVENT_ID");
  if (state.event_ids.includes(eventId) || state.work_ids.includes(workId) || phase.work[workId])
    fail("REDISPATCH_OR_EVENT_REPLAY");
  if (phase.reserved_usd + reserve > phase.cap_usd || state.total_reserved_usd + reserve > 17.5)
    fail("CAP_EXCEEDED");
  phase.work[workId] = {
    state: "AUTHORIZED_ONCE_NOT_REDISPATCHABLE",
    reservation_usd: reserve,
    settled_usd: null,
    authorization_event_id: eventId,
  };
  phase.reserved_usd = finiteUsd(phase.reserved_usd + reserve, "PHASE_RESERVE_SUM");
  state.total_reserved_usd = finiteUsd(state.total_reserved_usd + reserve, "TOTAL_RESERVE_SUM");
  state.event_ids.push(eventId);
  state.work_ids.push(workId);
  return validateState(state);
}

function recordVerifiedReleaseRef(state, { tagName, targetCommit, eventId }) {
  validateState(state);
  requireInProgress(state);
  if (state.phases.publication.state !== "ACTIVE") fail("PUBLICATION_NOT_ACTIVE");
  if (
    state.release_ref.state !== "AUTHORIZED_PENDING_CREATION" ||
    tagName !== state.release_ref.exact_tag_name ||
    targetCommit !== state.release_ref.exact_target_commit ||
    !/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "") ||
    state.event_ids.includes(eventId)
  )
    fail("RELEASE_REF_VERIFICATION");
  state.release_ref.state = "VERIFIED_EXACT_REMOTE";
  state.release_ref.verification_event_id = eventId;
  state.event_ids.push(eventId);
  return validateState(state);
}

function recordSettledResult(state, { phaseName, workId, result }) {
  validateState(state);
  const work = state.phases[phaseName]?.work?.[workId];
  if (
    work?.state !== "SETTLED_TERMINAL" ||
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result)
  )
    fail("SETTLED_RESULT_CONTRACT");
  const resultSha256 = settledResultSha256(result);
  if (work.settled_result !== undefined) {
    if (
      work.settled_result_sha256 !== resultSha256 ||
      settledResultSha256(work.settled_result) !== resultSha256
    )
      fail("SETTLED_RESULT_REPLAY");
    if (
      phaseName === BOOTSTRAP_PHASE &&
      workId === `${state.authority_id}:${BOOTSTRAP_OPERATION}`.toLowerCase()
    )
      state.operator_role_verified = true;
    return validateState(state);
  }
  work.settled_result = result;
  work.settled_result_sha256 = resultSha256;
  if (
    phaseName === BOOTSTRAP_PHASE &&
    workId === `${state.authority_id}:${BOOTSTRAP_OPERATION}`.toLowerCase()
  )
    state.operator_role_verified = true;
  return validateState(state);
}

function settleWork(state, { phaseName, workId, actualUsd, eventId, result }) {
  validateState(state);
  requireInProgress(state);
  const phase = state.phases[phaseName];
  const work = phase?.work?.[workId];
  const actual = finiteUsd(actualUsd, "ACTUAL_INVALID");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "")) fail("EVENT_ID");
  if (phase?.state !== "ACTIVE" || work?.state !== "AUTHORIZED_ONCE_NOT_REDISPATCHABLE")
    fail("WORK_NOT_SETTLEABLE");
  if (actual > work.reservation_usd || state.event_ids.includes(eventId))
    fail("SETTLEMENT_OR_EVENT");
  if (
    phaseName === BOOTSTRAP_PHASE &&
    workId === `${state.authority_id}:${BOOTSTRAP_OPERATION}`.toLowerCase() &&
    (result === undefined || result === null || typeof result !== "object" || Array.isArray(result))
  )
    fail("OPERATOR_ROLE_VERIFICATION");
  work.state = "SETTLED_TERMINAL";
  work.settled_usd = actual;
  work.settlement_event_id = eventId;
  if (result !== undefined) {
    if (result === null || typeof result !== "object" || Array.isArray(result))
      fail("SETTLED_RESULT_CONTRACT");
    work.settled_result = result;
    work.settled_result_sha256 = settledResultSha256(result);
  }
  if (
    phaseName === BOOTSTRAP_PHASE &&
    workId === `${state.authority_id}:${BOOTSTRAP_OPERATION}`.toLowerCase()
  )
    state.operator_role_verified = true;
  phase.settled_usd = finiteUsd(phase.settled_usd + actual, "PHASE_SETTLE_SUM");
  state.total_settled_usd = finiteUsd(state.total_settled_usd + actual, "TOTAL_SETTLE_SUM");
  state.event_ids.push(eventId);
  return validateState(state);
}

function completePhase(state, phaseName) {
  validateState(state);
  requireInProgress(state);
  const phase = state.phases[phaseName];
  if (phase?.state !== "ACTIVE") fail("PHASE_NOT_ACTIVE");
  if (Object.values(phase.work).some((work) => work.state !== "SETTLED_TERMINAL"))
    fail("WORK_UNSETTLED");
  if (phaseName === "publication" && state.release_ref.state !== "VERIFIED_EXACT_REMOTE")
    fail("RELEASE_REF_NOT_VERIFIED");
  if (phaseName === "cleanup_and_reconciliation" && state.cleanup_proof === null)
    fail("CLEANUP_PROOF_REQUIRED");
  if (
    phaseName === "cleanup_and_reconciliation" &&
    state.release_certification?.state !== "SETTLED_TERMINAL"
  )
    fail("RELEASE_CERTIFICATION_REQUIRED");
  phase.state = "COMPLETE";
  state.current_phase_index += 1;
  if (state.current_phase_index === PHASES.length) {
    state.state = "CONSUMED_SINGLE_EXECUTION_COMPLETE";
    state.terminal = "CLEANUP_ZERO_WORKER_BILLING_RECONCILED";
  }
  return validateState(state);
}

function enterCleanupOnly(state, { failureCode, eventId }) {
  validateState(state);
  if (state.state !== "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS") fail("NOT_IN_PROGRESS");
  if (!/^[A-Z0-9][A-Z0-9_]{7,127}$/u.test(failureCode ?? "")) fail("FAILURE_CODE");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "") || state.event_ids.includes(eventId))
    fail("EVENT_ID");
  state.state = "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY";
  const current = PHASES[state.current_phase_index]?.[0];
  if (current && state.phases[current].state !== "COMPLETE")
    state.phases[current].state = "FAILED_CLEANUP_ONLY";
  state.current_phase_index = PHASES.length - 1;
  state.phases.cleanup_and_reconciliation.state = "ACTIVE";
  state.cleanup_failure_code = failureCode;
  state.event_ids.push(eventId);
  return validateState(state);
}

function authorizeCleanupWork(state, { workId, eventId }) {
  validateState(state);
  if (
    state.state !== "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY" ||
    state.phases.cleanup_and_reconciliation.state !== "ACTIVE" ||
    state.cleanup_proof !== null
  )
    fail("CLEANUP_NOT_ACTIVE");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(workId ?? "")) fail("WORK_ID");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "")) fail("EVENT_ID");
  if (state.work_ids.includes(workId) || state.event_ids.includes(eventId))
    fail("REDISPATCH_OR_EVENT_REPLAY");
  state.phases.cleanup_and_reconciliation.work[workId] = {
    state: "AUTHORIZED_ONCE_NOT_REDISPATCHABLE",
    reservation_usd: 0,
    settled_usd: null,
    authorization_event_id: eventId,
  };
  state.work_ids.push(workId);
  state.event_ids.push(eventId);
  return validateState(state);
}

function settleCleanupWork(state, { workId, eventId, result }) {
  validateState(state);
  const work = state.phases.cleanup_and_reconciliation.work[workId];
  if (
    state.state !== "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY" ||
    state.phases.cleanup_and_reconciliation.state !== "ACTIVE" ||
    work?.state !== "AUTHORIZED_ONCE_NOT_REDISPATCHABLE"
  )
    fail("CLEANUP_WORK_NOT_SETTLEABLE");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "")) fail("EVENT_ID");
  if (state.event_ids.includes(eventId)) fail("SETTLEMENT_OR_EVENT");
  work.state = "SETTLED_TERMINAL";
  work.settled_usd = 0;
  work.settlement_event_id = eventId;
  if (result !== undefined) {
    if (result === null || typeof result !== "object" || Array.isArray(result))
      fail("SETTLED_RESULT_CONTRACT");
    work.settled_result = result;
    work.settled_result_sha256 = settledResultSha256(result);
  }
  state.event_ids.push(eventId);
  return validateState(state);
}

function recordCleanupProof(
  state,
  { zeroWorkerProofSha256, billingProofSha256, resourceProofSha256, maxOneProofSha256, eventId },
) {
  validateState(state);
  if (
    !["CONSUMED_SINGLE_EXECUTION_IN_PROGRESS", "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY"].includes(
      state.state,
    ) ||
    state.phases.cleanup_and_reconciliation.state !== "ACTIVE"
  )
    fail("CLEANUP_NOT_ACTIVE");
  if (state.cleanup_proof !== null) fail("CLEANUP_PROOF_REPLAY");
  const exactCleanupWorkIds = CLEANUP_SAFETY_OPERATION_IDS.map((operationId) =>
    `${state.authority_id}:${operationId}`.toLowerCase(),
  ).sort();
  if (
    JSON.stringify(Object.keys(state.phases.cleanup_and_reconciliation.work).sort()) !==
    JSON.stringify(exactCleanupWorkIds)
  )
    fail("CLEANUP_WORK_SET");
  if (
    Object.values(state.phases.cleanup_and_reconciliation.work).some(
      (work) => work.state !== "SETTLED_TERMINAL",
    )
  )
    fail("CLEANUP_WORK_UNSETTLED");
  if (
    ![zeroWorkerProofSha256, billingProofSha256, resourceProofSha256, maxOneProofSha256].every(
      (value) => HASH.test(value ?? ""),
    ) ||
    !/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "") ||
    state.event_ids.includes(eventId)
  )
    fail("CLEANUP_PROOF");
  state.cleanup_proof = {
    zero_worker_proof_sha256: zeroWorkerProofSha256,
    billing_proof_sha256: billingProofSha256,
    resource_reconciliation_sha256: resourceProofSha256,
    max_one_restoration_sha256: maxOneProofSha256,
    cleanup_work_ids: Object.keys(state.phases.cleanup_and_reconciliation.work).sort(),
    event_id: eventId,
  };
  state.event_ids.push(eventId);
  return validateState(state);
}

function authorizeReleaseCertification(state, { workId, eventId }) {
  validateState(state);
  if (
    state.state !== "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS" ||
    state.phases.cleanup_and_reconciliation.state !== "ACTIVE" ||
    state.cleanup_proof === null
  )
    fail("RELEASE_CERTIFICATION_NOT_READY");
  if (state.release_certification !== null) fail("RELEASE_CERTIFICATION_REPLAY");
  const exactWorkId = `${state.authority_id}:certify-v2-13-release`.toLowerCase();
  if (
    workId !== exactWorkId ||
    eventId !== `${exactWorkId}:authorized` ||
    state.work_ids.includes(workId) ||
    state.event_ids.includes(eventId)
  )
    fail("RELEASE_CERTIFICATION_AUTHORIZATION");
  state.release_certification = {
    work_id: workId,
    state: "AUTHORIZED_ONCE_RECONCILIATION_ONLY",
    authorization_event_id: eventId,
  };
  state.work_ids.push(workId);
  state.event_ids.push(eventId);
  return validateState(state);
}

function settleReleaseCertification(state, { workId, result, eventId }) {
  validateState(state);
  const certification = state.release_certification;
  if (
    state.state !== "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS" ||
    state.phases.cleanup_and_reconciliation.state !== "ACTIVE" ||
    certification?.state !== "AUTHORIZED_ONCE_RECONCILIATION_ONLY" ||
    workId !== certification.work_id ||
    eventId !== `${workId}:settled` ||
    state.event_ids.includes(eventId)
  )
    fail("RELEASE_CERTIFICATION_NOT_SETTLEABLE");
  if (result === null || typeof result !== "object" || Array.isArray(result))
    fail("RELEASE_CERTIFICATION_RESULT");
  certification.state = "SETTLED_TERMINAL";
  certification.settled_result = result;
  certification.settled_result_sha256 = settledResultSha256(result);
  certification.settlement_event_id = eventId;
  state.event_ids.push(eventId);
  return validateState(state);
}

function completeCleanupOnly(state) {
  validateState(state);
  if (
    state.state !== "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY" ||
    state.phases.cleanup_and_reconciliation.state !== "ACTIVE" ||
    state.cleanup_proof === null
  )
    fail("CLEANUP_INCOMPLETE");
  state.phases.cleanup_and_reconciliation.state = "COMPLETE";
  state.current_phase_index = PHASES.length;
  state.state = "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY";
  state.terminal = "CLEANUP_PROOFS_RECORDED_ZERO_WORKER_BILLING_RESOURCES_RECONCILED";
  return validateState(state);
}

function parseArgs(argv) {
  const args = new Map();
  let command = "dry-run";
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (
      [
        "--consume",
        "--begin-phase",
        "--record-release-ref",
        "--authorize-work",
        "--settle-work",
        "--complete-phase",
        "--enter-cleanup-only",
        "--authorize-cleanup-work",
        "--settle-cleanup-work",
        "--record-cleanup-proof",
        "--complete-cleanup-only",
      ].includes(token)
    ) {
      if (command !== "dry-run") fail("ONE_COMMAND_ONLY");
      command = token.slice(2);
      continue;
    }
    if (!token.startsWith("--") || index + 1 >= argv.length) fail("ARGUMENTS");
    args.set(token.slice(2), argv[index + 1]);
    index += 1;
  }
  return { command, args };
}

function exactPath(path, type, permissions, label) {
  const metadata = lstatSync(path);
  if (
    metadata.isSymbolicLink() ||
    (type === "file" ? !metadata.isFile() : !metadata.isDirectory()) ||
    (metadata.mode & 0o777) !== permissions
  )
    fail(`${label}_MODE_OR_TYPE`);
}

function writeExclusive(path, value) {
  exactPath(dirname(path), "directory", 0o700, "STATE_DIRECTORY");
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  exactPath(path, "file", 0o600, "STATE_FILE");
}

function updateState(path, expectedSha256, operation) {
  exactPath(dirname(path), "directory", 0o700, "STATE_DIRECTORY");
  exactPath(path, "file", 0o600, "STATE_FILE");
  const lockPath = `${path}.lock`;
  let lock;
  try {
    lock = openSync(lockPath, "wx", 0o600);
  } catch {
    fail("STATE_LOCKED");
  }
  try {
    const bytes = readFileSync(path);
    if (sha256(bytes) !== expectedSha256) fail("STATE_SHA256");
    const next = operation(parse(bytes, "STATE"));
    const temporary = `${path}.next`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    exactPath(temporary, "file", 0o600, "NEXT_STATE_FILE");
    renameSync(temporary, path);
    exactPath(path, "file", 0o600, "STATE_FILE");
    return { state: next, sha256: sha256(readFileSync(path)) };
  } finally {
    if (lock !== undefined) closeSync(lock);
    rmSync(lockPath, { force: true });
  }
}

function trustedCommitLineage(
  validated,
  { proposalPath = PROPOSAL_RECORD_PATH, proposalBytes } = {},
) {
  const commit = /^[0-9a-f]{40}$/u;
  if (
    !commit.test(validated?.releaseSourceCommit ?? "") ||
    !commit.test(validated?.proposalRecordCommit ?? "") ||
    validated.releaseSourceCommit === validated.proposalRecordCommit ||
    proposalPath !== PROPOSAL_RECORD_PATH ||
    !Buffer.isBuffer(proposalBytes) ||
    sha256(proposalBytes) !== validated.proposalSha256
  )
    fail("COMMIT_LINEAGE");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
  try {
    if (
      git("rev-parse", `${validated.releaseSourceCommit}^{commit}`) !==
        validated.releaseSourceCommit ||
      git("rev-parse", `${validated.proposalRecordCommit}^{commit}`) !==
        validated.proposalRecordCommit
    )
      fail("COMMIT_LINEAGE");
    execFileSync(
      "git",
      [
        "merge-base",
        "--is-ancestor",
        validated.releaseSourceCommit,
        validated.proposalRecordCommit,
      ],
      { cwd: ROOT, stdio: "ignore" },
    );
    const chain = git(
      "rev-list",
      "--first-parent",
      "--reverse",
      `${validated.releaseSourceCommit}..${validated.proposalRecordCommit}`,
    )
      .split("\n")
      .filter(Boolean);
    if (chain.length === 0) fail("COMMIT_LINEAGE");
    const allowed = new Set(PROPOSAL_RECORD_ALLOWED_DIFF_PATHS);
    const changed = new Set();
    let parent = validated.releaseSourceCommit;
    for (const commitSha of chain) {
      const parents = git("rev-list", "--parents", "-n", "1", commitSha).split(/\s+/u).slice(1);
      if (parents.length !== 1 || parents[0] !== parent) fail("COMMIT_LINEAGE");
      const paths = git(
        "diff-tree",
        "--no-commit-id",
        "--no-ext-diff",
        "--no-renames",
        "--name-only",
        "-r",
        commitSha,
      )
        .split("\n")
        .filter(Boolean);
      if (paths.length === 0 || paths.some((path) => !allowed.has(path))) fail("COMMIT_LINEAGE");
      for (const path of paths) changed.add(path);
      parent = commitSha;
    }
    if (!changed.has(PROPOSAL_RECORD_PATH)) fail("COMMIT_LINEAGE");
    const committedProposal = execFileSync(
      "git",
      ["show", `${validated.proposalRecordCommit}:${proposalPath}`],
      { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 },
    );
    if (sha256(committedProposal) !== validated.proposalSha256) fail("COMMIT_LINEAGE");
  } catch (error) {
    if (error?.message === "V2_13_FULL_LIVE_ORCHESTRATION_COMMIT_LINEAGE") throw error;
    fail("COMMIT_LINEAGE");
  }
}

function validateAuthorityRecordCommit({
  authority,
  approvalBytes,
  authorityBytes,
  authorityRecordCommit,
}) {
  if (!/^[0-9a-f]{40}$/u.test(authorityRecordCommit ?? "")) fail("AUTHORITY_RECORD_COMMIT");
  const approvalPath = authority.lineage?.user_approval_path;
  const authorityPath = authority.lineage?.authority_record_path;
  for (const [path, code] of [
    [approvalPath, "APPROVAL_RECORD_PATH"],
    [authorityPath, "AUTHORITY_RECORD_PATH"],
  ])
    if (
      typeof path !== "string" ||
      path === "" ||
      path.startsWith("/") ||
      path.split("/").includes("..")
    )
      fail(code);
  const git = (...args) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).trim();
  if (
    git("rev-parse", `${authorityRecordCommit}^{commit}`) !== authorityRecordCommit ||
    git("rev-parse", `${authorityRecordCommit}^`) !== authority.lineage.proposal_record_commit
  )
    fail("AUTHORITY_RECORD_LINEAGE");
  const committedApproval = execFileSync(
    "git",
    ["show", `${authorityRecordCommit}:${approvalPath}`],
    { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 },
  );
  const committedAuthority = execFileSync(
    "git",
    ["show", `${authorityRecordCommit}:${authorityPath}`],
    { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 },
  );
  if (sha256(committedApproval) !== sha256(approvalBytes)) fail("APPROVAL_RECORD_TREE_BYTES");
  if (sha256(committedAuthority) !== sha256(authorityBytes)) fail("AUTHORITY_RECORD_TREE_BYTES");
  return Object.freeze({
    authorityRecordCommit,
    approvalRecordPath: approvalPath,
    authorityRecordPath: authorityPath,
  });
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === "dry-run") {
    process.stdout.write(
      `${JSON.stringify({ state: "NO_AUTHORITY_CONSUMED", external_calls: 0, mutations: 0, gpu_use: 0, spend_usd: 0 })}\n`,
    );
    return;
  }
  if (command === "consume") {
    if (args.get("confirm") !== CONFIRMATION) fail("CONFIRMATION");
    const proposalBytes = readFileSync(resolve(args.get("proposal-file")));
    const approvalBytes = readFileSync(resolve(args.get("approval-file")));
    const authorityBytes = readFileSync(resolve(args.get("authority-file")));
    const { authority, validated } = validateOuterAuthority({
      proposalBytes,
      approvalBytes,
      authorityBytes,
    });
    const record = validateAuthorityRecordCommit({
      authority,
      approvalBytes,
      authorityBytes,
      authorityRecordCommit: args.get("authority-record-commit"),
    });
    validateStaticReleaseDescriptorFile({
      path: process.env[STATIC_RELEASE_DESCRIPTOR_ENV],
      expectedSha256: authority.static_release_descriptor.sha256,
      expectedSourceCommit: validated.releaseSourceCommit,
    });
    validateMaterializationSeedFile({
      path: process.env[MATERIALIZATION_SEED_ENV],
      expectedSha256: authority.materialization_seed_sha256,
      expectedFullLiveAuthorityId: authority.full_live_authority_id,
    });
    if (args.has("trusted-iso")) fail("CALLER_TRUSTED_TIME_FORBIDDEN");
    assertTrustedTime(validated.approvedAt, validated.expiresAt, readAuthenticatedTrustedTime());
    trustedCommitLineage(validated, {
      proposalPath: authority.lineage?.proposal_path,
      proposalBytes,
    });
    const state = validateState(
      initialConsumptionRecord(authority, authorityBytes, { ...validated, ...record }),
    );
    const statePath = resolve(args.get("state-file"));
    writeExclusive(statePath, state);
    process.stdout.write(
      `${JSON.stringify({ state_file: statePath, state_sha256: sha256(readFileSync(statePath)), authority_id: authority.authority_id })}\n`,
    );
    return;
  }
  const statePath = resolve(args.get("state-file"));
  const expected = args.get("expected-state-sha256");
  if (!HASH.test(expected ?? "")) fail("EXPECTED_STATE_SHA256");
  const phaseName = args.get("phase");
  let operation;
  if (command === "begin-phase") operation = (state) => beginPhase(state, phaseName);
  else if (command === "record-release-ref")
    operation = (state) =>
      recordVerifiedReleaseRef(state, {
        tagName: args.get("tag-name"),
        targetCommit: args.get("target-commit"),
        eventId: args.get("event-id"),
      });
  else if (command === "authorize-work")
    operation = (state) =>
      authorizeWork(state, {
        phaseName,
        workId: args.get("work-id"),
        reservationUsd: Number(args.get("reservation-usd")),
        eventId: args.get("event-id"),
      });
  else if (command === "settle-work")
    operation = (state) =>
      settleWork(state, {
        phaseName,
        workId: args.get("work-id"),
        actualUsd: Number(args.get("actual-usd")),
        eventId: args.get("event-id"),
      });
  else if (command === "complete-phase") operation = (state) => completePhase(state, phaseName);
  else if (command === "enter-cleanup-only")
    operation = (state) =>
      enterCleanupOnly(state, {
        failureCode: args.get("failure-code"),
        eventId: args.get("event-id"),
      });
  else if (command === "authorize-cleanup-work")
    operation = (state) =>
      authorizeCleanupWork(state, {
        workId: args.get("work-id"),
        eventId: args.get("event-id"),
      });
  else if (command === "settle-cleanup-work")
    operation = (state) =>
      settleCleanupWork(state, {
        workId: args.get("work-id"),
        eventId: args.get("event-id"),
      });
  else if (command === "record-cleanup-proof")
    operation = (state) =>
      recordCleanupProof(state, {
        zeroWorkerProofSha256: args.get("zero-worker-proof-sha256"),
        billingProofSha256: args.get("billing-proof-sha256"),
        resourceProofSha256: args.get("resource-proof-sha256"),
        maxOneProofSha256: args.get("max-one-proof-sha256"),
        eventId: args.get("event-id"),
      });
  else if (command === "complete-cleanup-only") operation = completeCleanupOnly;
  else fail("COMMAND");
  const result = updateState(statePath, expected, operation);
  process.stdout.write(
    `${JSON.stringify({ state_file: statePath, state_sha256: result.sha256, state: result.state.state })}\n`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export {
  authorizeCleanupWork,
  authorizeReleaseCertification,
  authorizeWork,
  beginPhase,
  completeCleanupOnly,
  completePhase,
  CONFIRMATION,
  enterCleanupOnly,
  initialConsumptionRecord,
  MATERIALIZATION_SEED_ENV,
  MATERIALIZATION_SEED_SCHEMA,
  STATIC_RELEASE_DESCRIPTOR_ENV,
  PHASES,
  recordCleanupProof,
  recordSettledResult,
  recordVerifiedReleaseRef,
  settleWork,
  settleCleanupWork,
  settleReleaseCertification,
  trustedCommitLineage,
  updateState,
  validateOuterAuthority,
  validateMaterializationSeedFile,
  validateMaterializationSeedShape,
  validateStaticReleaseDescriptorFile,
  validateAuthorityRecordCommit,
  validateState,
  readAuthenticatedTrustedTime,
  writeExclusive,
};
