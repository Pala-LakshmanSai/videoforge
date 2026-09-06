#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const AUTHORITY_SCHEMA = "videoforge.v2-09-qualified-production-authority/v1";
export const DRY_RUN_SCHEMA = "videoforge.v2-09-qualified-production-dry-run/v1";
export const EXECUTION_SCHEMA = "videoforge.v2-09-qualified-production-execution/v1";
export const BRANCH = "codex/serverless-v2-roadmap-v4";
export const PUSH_REF = `refs/heads/${BRANCH}`;
export const INCREMENTAL_CAP_USD = 2;
export const COMPLETION_CAP_USD = 17.5;

export const QUALIFIED_LANES = Object.freeze([
  Object.freeze({
    lane: "mage",
    image_sha256: "sha256:0f3203ceaedd8d570dcca301e32ca6d0ecb4d1136c32d5cd7d76fdc292a030cb",
    image_source_commit: "aceef8e0d0d678468ea9560f1faa94aa562fc466",
    image_config_sha256: "sha256:fe08710bb809b702d8efe46b4d67d100b9f9630c8969f62efe7fd1b54d069897",
    anonymous_proof_sha256:
      "sha256:eca6cfe6acec62ed63ec1f7c9d40e7fb14e908c6e594da3864f936fa53670704",
    acceptance_sha256: "sha256:aeef45f237fd07e0937cdd51eaaf545ac0d8bb4c90eb105708f1681da787cc79",
    volume_id_sha256: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
    volume_manifest_sha256:
      "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
    volume_size_gb: 50,
    gpu: "NVIDIA GeForce RTX 4090",
    region: "EU-RO-1",
    workers_min: 0,
    workers_max: 1,
    handler_concurrency: 1,
  }),
  Object.freeze({
    lane: "soulx",
    image_sha256: "sha256:f3b1d1414308d0783fe006d33e6482c027e05b6029a07843af66e4a9e1c1380e",
    image_source_commit: "73181707e49be61955af4f2891f4c7185a1c288f",
    image_config_sha256: "sha256:224b2a728490cf1c708b42e56702da2b71bd2374658f0c640dd39ef23e860935",
    anonymous_proof_sha256:
      "sha256:9929d19da89ab2c20e280ac45ad152bc325b8bf56ef1e9c21e83d473c3408bc4",
    acceptance_sha256: "sha256:aec6b4eca1b51db5b1742e806d28a26c32359a1ddecb615afae1a834dbdf15aa",
    volume_id_sha256: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
    volume_manifest_sha256:
      "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
    volume_size_gb: 50,
    gpu: "NVIDIA GeForce RTX 4090",
    region: "EU-RO-1",
    workers_min: 0,
    workers_max: 1,
    handler_concurrency: 1,
  }),
]);

const HASH = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const AUTHORITY_ID = /^v2-09-[a-z0-9][a-z0-9._-]{7,95}$/u;
const AVAILABILITY = new Set(["LOW", "MEDIUM", "HIGH"]);
const EPSILON = 1e-9;
const FRESH_ADMISSION_TTL_MS = 5 * 60 * 1_000;
const ADAPTER_IDENTITY_SCHEMA = "videoforge.v2-09-injected-adapter-identity/v1";
const ADAPTER_SOURCE_IDENTITY_SCHEMA = "videoforge.v2-09-adapter-source-identity/v1";

export const NORMAL_OPERATIONS = Object.freeze([
  Object.freeze({ id: "push-clean-source", boundary: "REMOTE_MUTATION" }),
  Object.freeze({ id: "readback-clean-source", boundary: "READBACK" }),
  Object.freeze({ id: "apply-migrations-0074-0081", boundary: "DATABASE_MUTATION" }),
  Object.freeze({ id: "apply-v209-grants", boundary: "DATABASE_MUTATION" }),
  Object.freeze({ id: "publish-media-worker-0.1.15", boundary: "REMOTE_MUTATION" }),
  Object.freeze({ id: "readback-media-worker-0.1.15", boundary: "READBACK" }),
  Object.freeze({ id: "install-media-worker-0.1.15", boundary: "LOCAL_MUTATION" }),
  // This must remain immediately before the first RunPod mutation.
  Object.freeze({ id: "fresh-read-only-admission", boundary: "READBACK" }),
  Object.freeze({ id: "create-mage-production-lane-max-one", boundary: "REMOTE_MUTATION" }),
  Object.freeze({ id: "create-soulx-production-lane-max-one", boundary: "REMOTE_MUTATION" }),
  Object.freeze({ id: "persist-qualified-production-deployments", boundary: "DATABASE_MUTATION" }),
  Object.freeze({ id: "render-qualified-production-config", boundary: "LOCAL_MUTATION" }),
  Object.freeze({ id: "deploy-cloudflare-disabled-bootstrap", boundary: "REMOTE_MUTATION" }),
  Object.freeze({ id: "upload-cloudflare-production-secrets", boundary: "REMOTE_MUTATION" }),
  Object.freeze({ id: "deploy-cloudflare-qualified-production", boundary: "REMOTE_MUTATION" }),
  Object.freeze({ id: "readback-qualified-production", boundary: "READBACK" }),
  Object.freeze({ id: "import-v209-qualified-activation", boundary: "DATABASE_MUTATION" }),
  Object.freeze({
    id: "run-one-v209-chrome-e2e",
    boundary: "PAID_DISPATCH",
    reserveUsd: INCREMENTAL_CAP_USD,
  }),
  Object.freeze({ id: "verify-private-mp4-lineage", boundary: "READBACK" }),
]);

// This suffix is the only path after a normal-operation failure. It contains no publication,
// deployment, provider dispatch, qualification, or later-checkpoint operation. It is intentionally
// replayable under cleanup-only recovery because reconciliation/readback may have been interrupted.
export const CLEANUP_OPERATIONS = Object.freeze([
  Object.freeze({ id: "reconcile-v209-production-safety", boundary: "CLEANUP" }),
  Object.freeze({ id: "reconcile-attributable-runpod-work", boundary: "CLEANUP" }),
  Object.freeze({ id: "clean-v209-transient-r2", boundary: "CLEANUP" }),
  Object.freeze({ id: "prove-three-zero-compute-reads", boundary: "READBACK" }),
  Object.freeze({ id: "read-settled-billing", boundary: "READBACK" }),
  Object.freeze({ id: "verify-retained-resources", boundary: "READBACK" }),
]);

export const OPERATION_IDS = Object.freeze([
  ...NORMAL_OPERATIONS.map(({ id }) => id),
  ...CLEANUP_OPERATIONS.map(({ id }) => id),
]);

const FORBIDDEN_OPERATION_PATTERN =
  /(?:v2[-_]?(?:0?[67]|1[0-3])|stage[-_ ]?[67]|(?:mage|soulx).*(?:qualif(?:y|ication)))/iu;
const STATE_METHODS = Object.freeze([
  "claimAuthority",
  "beginNormalOperation",
  "completeNormalOperation",
  "enterCleanupOnly",
  "loadCleanupAuthority",
  "recordCleanupOperation",
  "completeCleanup",
  "completeSuccess",
  "reconcileSuccess",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fail(code) {
  throw new Error(code);
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function equalMoney(left, right) {
  return Math.abs(left - right) <= EPSILON;
}

function parseInstant(value, code) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value))
    fail(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code);
  return parsed;
}

function assertAuthorityResponse(value, authorityId, status, operationId) {
  const expectedKeys = operationId
    ? ["authority_id", "operation_id", "status"]
    : ["authority_id", "status"];
  if (
    !exactKeys(value, expectedKeys) ||
    value.authority_id !== authorityId ||
    value.status !== status ||
    (operationId && value.operation_id !== operationId)
  )
    fail("V2_09_AUTHORITY_STORE_RESPONSE_INVALID");
}

function assertClaimResponse(value, authorityId) {
  if (
    !exactKeys(value, ["authority_id", "consumed_once", "status"]) ||
    value.authority_id !== authorityId ||
    value.status !== "CLAIMED" ||
    value.consumed_once !== true
  )
    fail("V2_09_AUTHORITY_CLAIM_INVALID");
}

function assertNormalStartResponse(value, authorityId, operationId) {
  if (
    !exactKeys(value, ["authority_id", "first_start", "operation_id", "status"]) ||
    value.authority_id !== authorityId ||
    value.operation_id !== operationId ||
    value.status !== "STARTED" ||
    value.first_start !== true
  )
    fail("V2_09_NORMAL_OPERATION_REDISPATCH_FORBIDDEN");
}

function assertSuccessReconciliation(value, authorityId) {
  if (
    !exactKeys(value, ["authority_id", "status"]) ||
    value.authority_id !== authorityId ||
    !["SUCCEEDED_CLEAN", "NOT_SUCCEEDED"].includes(value.status)
  )
    fail("V2_09_SUCCESS_RECONCILIATION_INVALID");
  return value.status;
}

function readClock(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("V2_09_CLOCK_INVALID");
  return value;
}

function validateCostSnapshot(result, authority) {
  if (Object.hasOwn(result, "billing_total_usd")) {
    if (
      !finiteNonNegative(result.billing_total_usd) ||
      result.billing_total_usd > authority.caps.billing_stop_usd + EPSILON ||
      result.billing_total_usd - authority.caps.billing_baseline_usd > INCREMENTAL_CAP_USD + EPSILON
    )
      fail("V2_09_INCREMENTAL_CAP_EXCEEDED");
  }
  if (
    Object.hasOwn(result, "completion_total_usd") &&
    (!finiteNonNegative(result.completion_total_usd) ||
      result.completion_total_usd > authority.caps.completion_stop_usd + EPSILON ||
      result.completion_total_usd > COMPLETION_CAP_USD + EPSILON)
  )
    fail("V2_09_COMPLETION_CAP_EXCEEDED");
}

function costSnapshotExceeded(result, authority) {
  return (
    (Object.hasOwn(result, "billing_total_usd") &&
      (result.billing_total_usd > authority.caps.billing_stop_usd + EPSILON ||
        result.billing_total_usd - authority.caps.billing_baseline_usd >
          INCREMENTAL_CAP_USD + EPSILON)) ||
    (Object.hasOwn(result, "completion_total_usd") &&
      (result.completion_total_usd > authority.caps.completion_stop_usd + EPSILON ||
        result.completion_total_usd > COMPLETION_CAP_USD + EPSILON))
  );
}

function validateAdmission(result, authority, executionNow) {
  const observedAt = parseInstant(result?.observed_at, "V2_09_FRESH_ADMISSION_INVALID");
  const validatedAt = parseInstant(result?.validated_at, "V2_09_FRESH_ADMISSION_INVALID");
  const nowAt = executionNow instanceof Date ? executionNow.getTime() : Date.parse(executionNow);
  if (
    !exactKeys(result, [
      "availability",
      "billing_baseline_usd",
      "catalog_snapshot_sha256",
      "completion_baseline_usd",
      "gpu",
      "observed_at",
      "offering_id_sha256",
      "operation_id",
      "projected_completion_usd",
      "projected_incremental_usd",
      "rate_usd_per_gpu_hour",
      "region",
      "retained_volume_count",
      "schema_version",
      "validated_at",
      "workers_max",
      "workers_min",
      "zero_compute",
    ]) ||
    result.schema_version !== "videoforge.v2-09-rollout-admission/v1" ||
    result.operation_id !== "fresh-read-only-admission" ||
    !equalMoney(result.billing_baseline_usd, authority.caps.billing_baseline_usd) ||
    !equalMoney(result.completion_baseline_usd, authority.caps.completion_baseline_usd) ||
    !finiteNonNegative(result.projected_incremental_usd) ||
    result.projected_incremental_usd > INCREMENTAL_CAP_USD + EPSILON ||
    !finiteNonNegative(result.projected_completion_usd) ||
    !equalMoney(
      result.projected_completion_usd,
      result.completion_baseline_usd + result.projected_incremental_usd,
    ) ||
    result.projected_completion_usd > authority.caps.completion_stop_usd + EPSILON ||
    result.projected_completion_usd > COMPLETION_CAP_USD + EPSILON ||
    result.gpu !== "NVIDIA GeForce RTX 4090" ||
    result.region !== "EU-RO-1" ||
    !AVAILABILITY.has(result.availability) ||
    result.offering_id_sha256 !== authority.offering.offering_id_sha256 ||
    !HASH.test(result.catalog_snapshot_sha256 ?? "") ||
    result.gpu !== authority.offering.gpu ||
    result.region !== authority.offering.region ||
    !Number.isFinite(nowAt) ||
    observedAt < parseInstant(authority.issued_at, "V2_09_FRESH_ADMISSION_INVALID") ||
    observedAt > validatedAt ||
    validatedAt > nowAt ||
    validatedAt >= parseInstant(authority.expires_at, "V2_09_FRESH_ADMISSION_INVALID") ||
    nowAt - observedAt > FRESH_ADMISSION_TTL_MS ||
    !finiteNonNegative(result.rate_usd_per_gpu_hour) ||
    result.rate_usd_per_gpu_hour > authority.offering.max_rate_usd_per_gpu_hour + EPSILON ||
    result.zero_compute !== true ||
    result.retained_volume_count !== 2 ||
    result.workers_min !== 0 ||
    result.workers_max !== 1
  )
    fail("V2_09_FRESH_ADMISSION_INVALID");
}

function resultFrom(priorResults, operationId) {
  return priorResults.find(([id]) => id === operationId)?.[1];
}

function validateOperationResult(
  operationId,
  result,
  authority,
  { enforceCaps = true, executionNow = new Date(), priorResults = [] } = {},
) {
  if (result === null || typeof result !== "object" || Array.isArray(result))
    fail(`V2_09_OPERATION_RESULT_INVALID:${operationId}`);
  if (result.operation_id !== operationId) fail(`V2_09_OPERATION_RESULT_ID_INVALID:${operationId}`);
  if (operationId === "fresh-read-only-admission")
    validateAdmission(result, authority, executionNow);
  if (
    operationId === "push-clean-source" &&
    (result.source_commit !== authority.source_commit ||
      result.destination_ref !== PUSH_REF ||
      result.push_count !== 1)
  )
    fail("V2_09_SOURCE_PUSH_RESULT_INVALID");
  if (
    operationId === "readback-clean-source" &&
    (result.source_commit !== authority.source_commit || result.destination_ref !== PUSH_REF)
  )
    fail("V2_09_SOURCE_READBACK_INVALID");
  if (
    operationId === "apply-migrations-0074-0081" &&
    !(
      (result.mode === "APPLIED_0074_0081" &&
        result.from_version === 73 &&
        result.to_version === 81 &&
        Array.isArray(result.applied_versions) &&
        result.applied_versions.join(",") === "74,75,76,77,78,79,80,81") ||
      (result.mode === "VERIFIED_EXISTING_0081" &&
        result.from_version === 81 &&
        result.to_version === 81 &&
        Array.isArray(result.applied_versions) &&
        result.applied_versions.length === 0)
    )
  )
    fail("V2_09_MIGRATION_RESULT_INVALID");
  if (
    operationId === "apply-v209-grants" &&
    (!exactKeys(result, [
      "migration_head",
      "operation_id",
      "operator_grants_verified",
      "public_execute_count",
      "reconciler_grants_verified",
      "runtime_grants_verified",
      "schema_version",
    ]) ||
      result.schema_version !== "videoforge.v2-09-grants-result/v1" ||
      result.migration_head !== 81 ||
      result.public_execute_count !== 0 ||
      result.runtime_grants_verified !== true ||
      result.operator_grants_verified !== true ||
      result.reconciler_grants_verified !== true)
  )
    fail("V2_09_GRANTS_RESULT_INVALID");
  if (
    operationId === "publish-media-worker-0.1.15" &&
    (!exactKeys(result, [
      "execution_bundle_sha256",
      "immutable_release",
      "installer_asset_sha256",
      "mode",
      "operation_id",
      "publish_count",
      "release",
      "release_manifest_sha256",
      "schema_version",
      "whisper_model_sha256",
    ]) ||
      result.schema_version !== "videoforge.v2-09-media-worker-publication-result/v1" ||
      result.release !== authority.media_worker.release ||
      result.execution_bundle_sha256 !== authority.media_worker.execution_bundle_sha256 ||
      result.whisper_model_sha256 !== authority.media_worker.whisper_model_sha256 ||
      result.release_manifest_sha256 !== authority.media_worker.release_manifest_sha256 ||
      result.installer_asset_sha256 !== authority.media_worker.installer_asset_sha256 ||
      result.immutable_release !== true ||
      !(
        (result.mode === "PUBLISHED_ONCE" && result.publish_count === 1) ||
        (result.mode === "REUSED_EXACT_EXISTING" && result.publish_count === 0)
      ))
  )
    fail("V2_09_MEDIA_WORKER_PUBLICATION_INVALID");
  if (
    operationId === "readback-media-worker-0.1.15" &&
    (!exactKeys(result, [
      "execution_bundle_sha256",
      "immutable_readback",
      "installer_asset_sha256",
      "operation_id",
      "release",
      "release_asset_count",
      "release_manifest_sha256",
      "schema_version",
      "whisper_model_sha256",
    ]) ||
      result.schema_version !== "videoforge.v2-09-media-worker-readback-result/v1" ||
      result.release !== authority.media_worker.release ||
      result.execution_bundle_sha256 !== authority.media_worker.execution_bundle_sha256 ||
      result.whisper_model_sha256 !== authority.media_worker.whisper_model_sha256 ||
      result.release_manifest_sha256 !== authority.media_worker.release_manifest_sha256 ||
      result.installer_asset_sha256 !== authority.media_worker.installer_asset_sha256 ||
      !Number.isSafeInteger(result.release_asset_count) ||
      result.release_asset_count < 1 ||
      result.immutable_readback !== true)
  )
    fail("V2_09_MEDIA_WORKER_READBACK_INVALID");
  if (
    operationId === "install-media-worker-0.1.15" &&
    (!exactKeys(result, [
      "code_signature_verified",
      "execution_bundle_sha256",
      "installed_release_sha256",
      "installer_asset_sha256",
      "online",
      "online_heartbeat_sha256",
      "operation_id",
      "release",
      "schema_version",
      "signing_identity_sha256",
    ]) ||
      result.schema_version !== "videoforge.v2-09-media-worker-install-result/v1" ||
      result.release !== authority.media_worker.release ||
      result.execution_bundle_sha256 !== authority.media_worker.execution_bundle_sha256 ||
      result.installer_asset_sha256 !== authority.media_worker.installer_asset_sha256 ||
      result.signing_identity_sha256 !== authority.media_worker.signing_identity_sha256 ||
      result.code_signature_verified !== true ||
      result.online !== true ||
      !HASH.test(result.installed_release_sha256 ?? "") ||
      !HASH.test(result.online_heartbeat_sha256 ?? ""))
  )
    fail("V2_09_MEDIA_WORKER_INSTALL_INVALID");
  if (
    operationId === "create-mage-production-lane-max-one" ||
    operationId === "create-soulx-production-lane-max-one"
  ) {
    const expectedLane = operationId.startsWith("create-mage") ? "mage" : "soulx";
    const binding = authority.scope.lanes.find(({ lane }) => lane === expectedLane);
    if (
      !exactKeys(result, [
        "acceptance_sha256",
        "anonymous_proof_sha256",
        "deployment_sha256",
        "endpoint_id_sha256",
        "gpu",
        "handler_concurrency",
        "image_config_sha256",
        "image_sha256",
        "image_source_commit",
        "lane",
        "operation_id",
        "region",
        "retained_volume_size_gb",
        "schema_version",
        "template_id_sha256",
        "volume_id_sha256",
        "volume_manifest_sha256",
        "workers_max",
        "workers_min",
      ]) ||
      result.schema_version !== "videoforge.v2-09-production-lane-result/v1" ||
      result.lane !== expectedLane ||
      result.gpu !== binding.gpu ||
      result.region !== binding.region ||
      result.workers_min !== binding.workers_min ||
      result.workers_max !== binding.workers_max ||
      result.handler_concurrency !== binding.handler_concurrency ||
      result.retained_volume_size_gb !== binding.volume_size_gb ||
      result.image_sha256 !== binding.image_sha256 ||
      result.image_source_commit !== binding.image_source_commit ||
      result.image_config_sha256 !== binding.image_config_sha256 ||
      result.anonymous_proof_sha256 !== binding.anonymous_proof_sha256 ||
      result.acceptance_sha256 !== binding.acceptance_sha256 ||
      result.volume_id_sha256 !== binding.volume_id_sha256 ||
      result.volume_manifest_sha256 !== binding.volume_manifest_sha256 ||
      !HASH.test(result.endpoint_id_sha256 ?? "") ||
      !HASH.test(result.template_id_sha256 ?? "") ||
      !HASH.test(result.deployment_sha256 ?? "")
    )
      fail("V2_09_PRODUCTION_LANE_RESULT_INVALID");
  }
  if (
    operationId === "persist-qualified-production-deployments" &&
    (() => {
      const created = [
        resultFrom(priorResults, "create-mage-production-lane-max-one"),
        resultFrom(priorResults, "create-soulx-production-lane-max-one"),
      ];
      return (
        !exactKeys(result, [
          "deployments",
          "operation_id",
          "persisted_deployment_count",
          "schema_version",
        ]) ||
        result.schema_version !== "videoforge.v2-09-deployment-persistence-result/v1" ||
        result.persisted_deployment_count !== 2 ||
        !Array.isArray(result.deployments) ||
        result.deployments.length !== 2 ||
        result.deployments.some((deployment, index) => {
          const expected = created[index];
          return (
            expected === undefined ||
            !exactKeys(deployment, [
              "deployment_row_id_sha256",
              "deployment_sha256",
              "endpoint_id_sha256",
              "lane",
              "template_id_sha256",
            ]) ||
            deployment.lane !== expected.lane ||
            deployment.deployment_sha256 !== expected.deployment_sha256 ||
            deployment.endpoint_id_sha256 !== expected.endpoint_id_sha256 ||
            deployment.template_id_sha256 !== expected.template_id_sha256 ||
            !HASH.test(deployment.deployment_row_id_sha256 ?? "")
          );
        })
      );
    })()
  )
    fail("V2_09_DEPLOYMENT_PERSISTENCE_INVALID");
  if (
    operationId === "render-qualified-production-config" &&
    (result.config_sha256 !== authority.production.config_sha256 ||
      result.worker_bundle_sha256 !== authority.production.worker_bundle_sha256)
  )
    fail("V2_09_PRODUCTION_CONFIG_INVALID");
  if (
    operationId === "deploy-cloudflare-disabled-bootstrap" &&
    (!exactKeys(result, [
      "bootstrap_deploy_count",
      "config_sha256",
      "deploy_count",
      "full_disabled_deploy_count",
      "gpu_transport",
      "operation_id",
      "schema_version",
      "worker",
    ]) ||
      result.schema_version !== "videoforge.v2-09-disabled-bootstrap-result/v1" ||
      result.worker !== authority.production.worker_name ||
      !HASH.test(result.config_sha256 ?? "") ||
      result.gpu_transport !== "DISABLED_UNQUALIFIED" ||
      result.bootstrap_deploy_count !== 1 ||
      result.full_disabled_deploy_count !== 1 ||
      result.deploy_count !== 2)
  )
    fail("V2_09_DISABLED_BOOTSTRAP_INVALID");
  if (
    operationId === "upload-cloudflare-production-secrets" &&
    (!exactKeys(result, [
      "deploy_count",
      "mutation_count",
      "operation_id",
      "schema_version",
      "secret_allowlist_sha256",
      "secret_count",
      "secret_put_count",
      "transaction_count",
      "worker",
    ]) ||
      result.schema_version !== "videoforge.v2-09-secret-upload-result/v1" ||
      result.worker !== authority.production.worker_name ||
      result.secret_allowlist_sha256 !== authority.production.secret_allowlist_sha256 ||
      result.secret_count !== authority.production.secret_count ||
      result.secret_put_count !== authority.production.secret_count ||
      result.deploy_count !== 1 ||
      result.mutation_count !== authority.production.secret_count + 1 ||
      result.transaction_count !== 1)
  )
    fail("V2_09_SECRET_UPLOAD_INVALID");
  if (
    operationId === "deploy-cloudflare-qualified-production" &&
    (!exactKeys(result, [
      "config_sha256",
      "deploy_count",
      "deployment_id_sha256",
      "operation_id",
      "schema_version",
      "worker",
      "worker_bundle_sha256",
    ]) ||
      result.schema_version !== "videoforge.v2-09-qualified-deploy-result/v1" ||
      result.worker !== authority.production.worker_name ||
      result.config_sha256 !== authority.production.config_sha256 ||
      result.worker_bundle_sha256 !== authority.production.worker_bundle_sha256 ||
      !HASH.test(result.deployment_id_sha256 ?? "") ||
      result.deploy_count !== 1)
  )
    fail("V2_09_QUALIFIED_DEPLOY_INVALID");
  if (
    operationId === "readback-qualified-production" &&
    (!exactKeys(result, [
      "config_sha256",
      "deployment_id_sha256",
      "exact_pair_bound",
      "gpu_transport",
      "operation_id",
      "schema_version",
      "worker",
      "worker_bundle_sha256",
    ]) ||
      result.schema_version !== "videoforge.v2-09-qualified-readback-result/v1" ||
      result.worker !== authority.production.worker_name ||
      result.config_sha256 !== authority.production.config_sha256 ||
      result.worker_bundle_sha256 !== authority.production.worker_bundle_sha256 ||
      result.deployment_id_sha256 !==
        resultFrom(priorResults, "deploy-cloudflare-qualified-production")?.deployment_id_sha256 ||
      result.gpu_transport !== "QUALIFIED_EXACT" ||
      result.exact_pair_bound !== true)
  )
    fail("V2_09_QUALIFIED_PRODUCTION_READBACK_INVALID");
  if (
    operationId === "import-v209-qualified-activation" &&
    (() => {
      const persisted = resultFrom(priorResults, "persist-qualified-production-deployments");
      const cloudflare = resultFrom(priorResults, "readback-qualified-production");
      return (
        !exactKeys(result, [
          "cloudflare_deployment_id_sha256",
          "config_sha256",
          "deployment_row_id_sha256s",
          "import_count",
          "operation_id",
          "qualified_activation_active",
          "schema_version",
          "source_commit",
          "worker_bundle_sha256",
        ]) ||
        result.schema_version !== "videoforge.v2-09-activation-import-result/v1" ||
        result.import_count !== 1 ||
        result.qualified_activation_active !== true ||
        result.source_commit !== authority.source_commit ||
        result.config_sha256 !== authority.production.config_sha256 ||
        result.worker_bundle_sha256 !== authority.production.worker_bundle_sha256 ||
        result.cloudflare_deployment_id_sha256 !== cloudflare?.deployment_id_sha256 ||
        JSON.stringify(result.deployment_row_id_sha256s) !==
          JSON.stringify(
            persisted?.deployments.map((deployment) => deployment.deployment_row_id_sha256),
          )
      );
    })()
  )
    fail("V2_09_ACTIVATION_IMPORT_INVALID");
  if (
    operationId === "verify-private-mp4-lineage" &&
    (() => {
      const chrome = resultFrom(priorResults, "run-one-v209-chrome-e2e");
      return (
        !exactKeys(result, [
          "download_verified",
          "duration_seconds",
          "ffprobe_verified",
          "generation_request_sha256",
          "lineage_evidence_sha256",
          "lineage_verified",
          "mp4_sha256",
          "operation_id",
          "output_id_sha256",
          "playback_verified",
          "private_mp4",
          "project_id_sha256",
          "schema_version",
          "seek_verified",
        ]) ||
        result.schema_version !== "videoforge.v2-09-private-mp4-lineage/v1" ||
        result.project_id_sha256 !== chrome?.project_id_sha256 ||
        result.generation_request_sha256 !== chrome?.generation_request_sha256 ||
        result.output_id_sha256 !== chrome?.output_id_sha256 ||
        result.mp4_sha256 !== chrome?.mp4_sha256 ||
        !HASH.test(result.lineage_evidence_sha256 ?? "") ||
        !finiteNonNegative(result.duration_seconds) ||
        result.duration_seconds < 30 ||
        result.duration_seconds > 60 ||
        result.private_mp4 !== true ||
        result.lineage_verified !== true ||
        result.ffprobe_verified !== true ||
        result.playback_verified !== true ||
        result.seek_verified !== true ||
        result.download_verified !== true ||
        !HASH.test(result.mp4_sha256 ?? "")
      );
    })()
  )
    fail("V2_09_PRIVATE_MP4_PROOF_INVALID");
  if (
    operationId === "run-one-v209-chrome-e2e" &&
    (!exactKeys(result, [
      "billing_total_usd",
      "browser_evidence_sha256",
      "chrome_version_sha256",
      "completion_total_usd",
      "download_verified",
      "duration_seconds",
      "generation_request_sha256",
      "mp4_sha256",
      "operation_id",
      "output_id_sha256",
      "playback_verified",
      "project_id_sha256",
      "redispatch_count",
      "schema_version",
      "seek_verified",
      "submission_count",
    ]) ||
      result.schema_version !== "videoforge.v2-09-one-chrome-e2e-result/v1" ||
      result.submission_count !== 1 ||
      result.redispatch_count !== 0 ||
      !HASH.test(result.project_id_sha256 ?? "") ||
      !HASH.test(result.generation_request_sha256 ?? "") ||
      !HASH.test(result.output_id_sha256 ?? "") ||
      !HASH.test(result.mp4_sha256 ?? "") ||
      !HASH.test(result.browser_evidence_sha256 ?? "") ||
      !HASH.test(result.chrome_version_sha256 ?? "") ||
      !finiteNonNegative(result.duration_seconds) ||
      result.duration_seconds < 30 ||
      result.duration_seconds > 60 ||
      result.playback_verified !== true ||
      result.seek_verified !== true ||
      result.download_verified !== true)
  )
    fail("V2_09_CHROME_E2E_RESULT_INVALID");
  if (enforceCaps) validateCostSnapshot(result, authority);
  return result;
}

function validateCleanupResult(operationId, result, authority, outcome, priorResults) {
  validateOperationResult(operationId, result, authority, { enforceCaps: false, priorResults });
  if (
    operationId === "reconcile-v209-production-safety" &&
    (result.admission_state !== (outcome === "SUCCESS" ? "ACTIVE_QUALIFIED" : "DISABLED_CLEAN") ||
      result.partial_resources_absent !== true)
  )
    fail("V2_09_PRODUCTION_SAFETY_PROOF_INVALID");
  if (
    operationId === "reconcile-attributable-runpod-work" &&
    (result.active_worker_count !== 0 ||
      result.queued_job_count !== 0 ||
      result.in_progress_job_count !== 0 ||
      result.running_pod_count !== 0 ||
      result.partial_resources_absent !== true ||
      result.production_pair_retained !== (outcome === "SUCCESS"))
  )
    fail("V2_09_RUNPOD_RECONCILIATION_PROOF_INVALID");
  if (operationId === "clean-v209-transient-r2" && result.transient_keys_absent !== true)
    fail("V2_09_R2_CLEANUP_PROOF_INVALID");
  if (
    operationId === "prove-three-zero-compute-reads" &&
    (() => {
      const expectedEndpointIds = [
        resultFrom(priorResults, "create-mage-production-lane-max-one")?.endpoint_id_sha256,
        resultFrom(priorResults, "create-soulx-production-lane-max-one")?.endpoint_id_sha256,
      ]
        .filter(Boolean)
        .sort();
      const readTimes = Array.isArray(result.reads)
        ? result.reads.map((read) =>
            parseInstant(read.observed_at, "V2_09_ZERO_COMPUTE_PROOF_INVALID"),
          )
        : [];
      const validatedAt = parseInstant(result.validated_at, "V2_09_ZERO_COMPUTE_PROOF_INVALID");
      return (
        result.zero_compute_read_count !== 3 ||
        !Array.isArray(result.reads) ||
        result.reads.length !== 3 ||
        result.reads.some(
          (read) =>
            !exactKeys(read, [
              "active_worker_count",
              "attributable_running_pod_id_sha256s",
              "endpoint_id_sha256s",
              "in_progress_job_count",
              "observed_at",
              "queued_job_count",
              "running_pod_count",
            ]) ||
            parseInstant(read.observed_at, "V2_09_ZERO_COMPUTE_PROOF_INVALID") < 0 ||
            read.active_worker_count !== 0 ||
            read.queued_job_count !== 0 ||
            read.in_progress_job_count !== 0 ||
            read.running_pod_count !== 0 ||
            JSON.stringify(read.endpoint_id_sha256s) !== JSON.stringify(expectedEndpointIds) ||
            !Array.isArray(read.attributable_running_pod_id_sha256s) ||
            read.attributable_running_pod_id_sha256s.length !== 0,
        ) ||
        readTimes.length !== 3 ||
        readTimes[1] - readTimes[0] < 1_000 ||
        readTimes[2] - readTimes[1] < 1_000 ||
        validatedAt < readTimes[2] ||
        validatedAt - readTimes[2] > FRESH_ADMISSION_TTL_MS
      );
    })()
  )
    fail("V2_09_ZERO_COMPUTE_PROOF_INVALID");
  if (
    operationId === "read-settled-billing" &&
    (() => {
      const expectedCount = outcome === "SUCCESS" ? 2 : undefined;
      const jobsValid =
        Array.isArray(result.terminal_jobs) &&
        (expectedCount === undefined
          ? result.terminal_jobs.length <= 2
          : result.terminal_jobs.length === 2) &&
        result.terminal_jobs.every(
          (job) =>
            exactKeys(job, ["cost_usd", "job_id_sha256", "lane", "status"]) &&
            HASH.test(job.job_id_sha256 ?? "") &&
            ["mage", "soulx"].includes(job.lane) &&
            (outcome === "SUCCESS"
              ? job.status === "COMPLETED"
              : ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(job.status)) &&
            finiteNonNegative(job.cost_usd),
        ) &&
        new Set(result.terminal_jobs.map(({ lane }) => lane)).size === result.terminal_jobs.length;
      const mageUsd = result.terminal_jobs?.find(({ lane }) => lane === "mage")?.cost_usd ?? 0;
      const soulxUsd = result.terminal_jobs?.find(({ lane }) => lane === "soulx")?.cost_usd ?? 0;
      return (
        result.settled !== true ||
        !equalMoney(result.billing_baseline_usd, authority.caps.billing_baseline_usd) ||
        !finiteNonNegative(result.billing_total_usd) ||
        !finiteNonNegative(result.completion_total_usd) ||
        result.redispatch_count !== 0 ||
        result.duplicate_compute_usd !== 0 ||
        !jobsValid ||
        !exactKeys(result.cost_itemization, ["mage_usd", "soulx_usd", "total_usd"]) ||
        !equalMoney(result.cost_itemization.mage_usd, mageUsd) ||
        !equalMoney(result.cost_itemization.soulx_usd, soulxUsd) ||
        !equalMoney(result.cost_itemization.total_usd, mageUsd + soulxUsd) ||
        result.billing_total_usd + EPSILON <
          authority.caps.billing_baseline_usd + result.cost_itemization.total_usd
      );
    })()
  )
    fail("V2_09_SETTLED_BILLING_PROOF_INVALID");
  if (
    operationId === "verify-retained-resources" &&
    (result.retained_volume_count !== 2 ||
      result.retained_volume_mutated !== false ||
      !equalMoney(result.retained_volume_monthly_usd, 7) ||
      !Array.isArray(result.volumes) ||
      result.volumes.length !== 2 ||
      result.volumes.some((volume, index) => {
        const expected = authority.scope.lanes[index];
        return (
          !exactKeys(volume, [
            "lane",
            "mutated",
            "volume_id_sha256",
            "volume_manifest_sha256",
            "volume_size_gb",
          ]) ||
          volume.lane !== expected.lane ||
          volume.volume_id_sha256 !== expected.volume_id_sha256 ||
          volume.volume_manifest_sha256 !== expected.volume_manifest_sha256 ||
          volume.volume_size_gb !== expected.volume_size_gb ||
          volume.mutated !== false
        );
      }) ||
      result.production_pair_retained !== (outcome === "SUCCESS"))
  )
    fail("V2_09_RETAINED_RESOURCE_PROOF_INVALID");
  return result;
}

export function validateAuthority(
  authority,
  { sourceCommit, now = new Date(), cleanupOnly = false } = {},
) {
  if (
    !exactKeys(authority, [
      "authority_id",
      "adapter_set_sha256",
      "branch",
      "caps",
      "execution",
      "expires_at",
      "issued_at",
      "media_worker",
      "offering",
      "proposal_sha256",
      "push_ref",
      "schema_version",
      "scope",
      "single_use",
      "source_commit",
      "production",
    ]) ||
    authority.schema_version !== AUTHORITY_SCHEMA ||
    !AUTHORITY_ID.test(authority.authority_id ?? "") ||
    !HASH.test(authority.proposal_sha256 ?? "") ||
    !HASH.test(authority.adapter_set_sha256 ?? "") ||
    !COMMIT.test(authority.source_commit ?? "") ||
    authority.branch !== BRANCH ||
    authority.push_ref !== PUSH_REF ||
    authority.single_use !== true ||
    authority.execution !== "V2_09_QUALIFIED_PRODUCTION_ONCE"
  )
    fail("V2_09_AUTHORITY_INVALID");

  if (!COMMIT.test(sourceCommit ?? "") || sourceCommit !== authority.source_commit)
    fail("V2_09_AUTHORITY_SOURCE_MISMATCH");

  const issuedAt = parseInstant(authority.issued_at, "V2_09_AUTHORITY_TIME_INVALID");
  const expiresAt = parseInstant(authority.expires_at, "V2_09_AUTHORITY_TIME_INVALID");
  const nowAt = now instanceof Date ? now.getTime() : Date.parse(now);
  if (
    !Number.isFinite(nowAt) ||
    expiresAt <= issuedAt ||
    nowAt < issuedAt ||
    (!cleanupOnly && nowAt >= expiresAt)
  )
    fail("V2_09_AUTHORITY_NOT_CURRENT");

  const offering = authority.offering;
  if (
    !exactKeys(offering, [
      "availability_floor",
      "gpu",
      "max_rate_usd_per_gpu_hour",
      "offering_id_sha256",
      "region",
    ]) ||
    !HASH.test(offering.offering_id_sha256 ?? "") ||
    offering.gpu !== "NVIDIA GeForce RTX 4090" ||
    offering.region !== "EU-RO-1" ||
    offering.availability_floor !== "LOW" ||
    offering.max_rate_usd_per_gpu_hour !== 1.116
  )
    fail("V2_09_AUTHORITY_OFFERING_INVALID");

  if (
    !exactKeys(authority.media_worker, [
      "execution_bundle_sha256",
      "installer_asset_sha256",
      "release",
      "release_manifest_sha256",
      "signing_identity_sha256",
      "whisper_model_sha256",
    ]) ||
    authority.media_worker.release !== "0.1.15" ||
    !HASH.test(authority.media_worker.execution_bundle_sha256 ?? "") ||
    !HASH.test(authority.media_worker.release_manifest_sha256 ?? "") ||
    !HASH.test(authority.media_worker.installer_asset_sha256 ?? "") ||
    !HASH.test(authority.media_worker.signing_identity_sha256 ?? "") ||
    !HASH.test(authority.media_worker.whisper_model_sha256 ?? "")
  )
    fail("V2_09_AUTHORITY_MEDIA_WORKER_INVALID");
  if (
    !exactKeys(authority.production, [
      "chrome_auth_state_sha256",
      "chrome_request_sha256",
      "config_sha256",
      "secret_allowlist_sha256",
      "secret_count",
      "worker_bundle_sha256",
      "worker_name",
    ]) ||
    authority.production.worker_name !== "videoforge-production-runtime" ||
    !HASH.test(authority.production.chrome_auth_state_sha256 ?? "") ||
    !HASH.test(authority.production.chrome_request_sha256 ?? "") ||
    !HASH.test(authority.production.config_sha256 ?? "") ||
    !HASH.test(authority.production.worker_bundle_sha256 ?? "") ||
    !HASH.test(authority.production.secret_allowlist_sha256 ?? "") ||
    !Number.isSafeInteger(authority.production.secret_count) ||
    authority.production.secret_count <= 0
  )
    fail("V2_09_AUTHORITY_PRODUCTION_INVALID");

  const caps = authority.caps;
  if (
    !exactKeys(caps, [
      "billing_baseline_usd",
      "billing_stop_usd",
      "completion_baseline_usd",
      "completion_cap_usd",
      "completion_stop_usd",
      "incremental_cap_usd",
    ]) ||
    !finiteNonNegative(caps.billing_baseline_usd) ||
    caps.incremental_cap_usd !== INCREMENTAL_CAP_USD ||
    !equalMoney(caps.billing_stop_usd, caps.billing_baseline_usd + INCREMENTAL_CAP_USD) ||
    !finiteNonNegative(caps.completion_baseline_usd) ||
    caps.completion_cap_usd !== COMPLETION_CAP_USD ||
    !equalMoney(caps.completion_stop_usd, caps.completion_baseline_usd + INCREMENTAL_CAP_USD) ||
    caps.completion_stop_usd > COMPLETION_CAP_USD + EPSILON
  )
    fail("V2_09_AUTHORITY_CAPS_INVALID");

  const scope = authority.scope;
  if (
    !exactKeys(scope, [
      "allow_gpu_fallback",
      "allow_image_publication",
      "allow_model_download",
      "allow_redispatch",
      "allow_region_fallback",
      "allow_retained_volume_mutation",
      "allow_stage_6_or_7_qualification",
      "allow_v2_10_plus",
      "cleanup_only_recovery",
      "lanes",
      "media_worker_release",
      "operations",
      "stage_6",
      "stage_7",
    ]) ||
    !Array.isArray(scope.operations) ||
    scope.operations.length !== OPERATION_IDS.length ||
    scope.operations.some((id, index) => id !== OPERATION_IDS[index]) ||
    scope.operations.some((id) => FORBIDDEN_OPERATION_PATTERN.test(id)) ||
    scope.stage_6 !== "FROZEN_QUALIFIED_NO_RERUN" ||
    scope.stage_7 !== "FROZEN_QUALIFIED_NO_RERUN" ||
    scope.allow_stage_6_or_7_qualification !== false ||
    scope.allow_v2_10_plus !== false ||
    scope.allow_redispatch !== false ||
    scope.cleanup_only_recovery !== true ||
    JSON.stringify(scope.lanes) !== JSON.stringify(QUALIFIED_LANES) ||
    scope.allow_image_publication !== false ||
    scope.allow_gpu_fallback !== false ||
    scope.allow_region_fallback !== false ||
    scope.allow_model_download !== false ||
    scope.allow_retained_volume_mutation !== false ||
    scope.media_worker_release !== "0.1.15"
  )
    fail("V2_09_AUTHORITY_SCOPE_INVALID");

  return authority;
}

function unimplementedAdapter(operationId) {
  return async () => fail(`V2_09_ADAPTER_NOT_IMPLEMENTED:${operationId}`);
}

function unimplementedState(method) {
  return async () => fail(`V2_09_AUTHORITY_STORE_NOT_IMPLEMENTED:${method}`);
}

export function deriveInjectedAdapterIdentity({ operations, source_identity, state }) {
  if (
    !exactKeys(source_identity, [
      "capability_source_sha256s",
      "implementation_sha256",
      "schema_version",
    ]) ||
    source_identity.schema_version !== ADAPTER_SOURCE_IDENTITY_SCHEMA ||
    !HASH.test(source_identity.implementation_sha256 ?? "") ||
    !exactKeys(source_identity.capability_source_sha256s, [...OPERATION_IDS, ...STATE_METHODS]) ||
    [...OPERATION_IDS, ...STATE_METHODS].some(
      (name) => !HASH.test(source_identity.capability_source_sha256s[name] ?? ""),
    ) ||
    !exactKeys(operations, OPERATION_IDS) ||
    OPERATION_IDS.some((id) => typeof operations[id] !== "function") ||
    !exactKeys(state, STATE_METHODS) ||
    STATE_METHODS.some((method) => typeof state[method] !== "function")
  )
    fail("V2_09_ADAPTER_SOURCE_IDENTITY_INVALID");
  const actualFunctionSourceSha256s = {
    operations: Object.fromEntries(
      OPERATION_IDS.map((id) => [id, sha256(Function.prototype.toString.call(operations[id]))]),
    ),
    state: Object.fromEntries(
      STATE_METHODS.map((method) => [
        method,
        sha256(Function.prototype.toString.call(state[method])),
      ]),
    ),
  };
  return sha256(
    canonical({
      schema_version: ADAPTER_IDENTITY_SCHEMA,
      actual_function_source_sha256s: actualFunctionSourceSha256s,
      source_identity,
    }),
  );
}

export function createDefaultAdapters(overrides = {}, expectedIdentitySha256) {
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides))
    fail("V2_09_ADAPTERS_INVALID");
  for (const key of Object.keys(overrides)) {
    if (!new Set(["identity_sha256", "operations", "source_identity", "state"]).has(key))
      fail(`V2_09_UNKNOWN_ADAPTER_GROUP:${key}`);
  }
  const operationOverrides = overrides.operations ?? {};
  const stateOverrides = overrides.state ?? {};
  if (
    operationOverrides === null ||
    typeof operationOverrides !== "object" ||
    Array.isArray(operationOverrides) ||
    stateOverrides === null ||
    typeof stateOverrides !== "object" ||
    Array.isArray(stateOverrides)
  )
    fail("V2_09_ADAPTERS_INVALID");
  for (const id of Object.keys(operationOverrides)) {
    if (!OPERATION_IDS.includes(id)) fail(`V2_09_UNKNOWN_OPERATION:${id}`);
    if (typeof operationOverrides[id] !== "function") fail(`V2_09_ADAPTER_INVALID:${id}`);
  }
  for (const method of Object.keys(stateOverrides)) {
    if (!STATE_METHODS.includes(method)) fail(`V2_09_UNKNOWN_STATE_ADAPTER:${method}`);
    if (typeof stateOverrides[method] !== "function") fail(`V2_09_STATE_ADAPTER_INVALID:${method}`);
  }
  const operations = Object.freeze(
    Object.fromEntries(
      OPERATION_IDS.map((id) => [id, operationOverrides[id] ?? unimplementedAdapter(id)]),
    ),
  );
  const state = Object.freeze(
    Object.fromEntries(
      STATE_METHODS.map((method) => [method, stateOverrides[method] ?? unimplementedState(method)]),
    ),
  );
  const derivedIdentitySha256 = deriveInjectedAdapterIdentity({
    operations,
    source_identity: overrides.source_identity,
    state,
  });
  if (
    !HASH.test(expectedIdentitySha256 ?? "") ||
    overrides.identity_sha256 !== derivedIdentitySha256 ||
    expectedIdentitySha256 !== derivedIdentitySha256
  )
    fail("V2_09_ADAPTER_SET_IDENTITY_MISMATCH");
  return Object.freeze({ identity_sha256: derivedIdentitySha256, operations, state });
}

export function dryRunPlan() {
  return Object.freeze({
    schema_version: DRY_RUN_SCHEMA,
    action: "NO_ACTION",
    provider_calls: 0,
    remote_mutations: 0,
    gpu_jobs: 0,
    spend_usd: 0,
    branch: BRANCH,
    push_ref: PUSH_REF,
    hard_caps: Object.freeze({
      incremental_usd: INCREMENTAL_CAP_USD,
      completion_usd: COMPLETION_CAP_USD,
    }),
    normal_operations: NORMAL_OPERATIONS.map(({ id }) => id),
    cleanup_only_operations: CLEANUP_OPERATIONS.map(({ id }) => id),
    stage_6_stage_7: "FROZEN_QUALIFIED_NO_RERUN",
    v2_10_plus: "FORBIDDEN",
    redispatch: "FORBIDDEN",
    default_adapters: "FAIL_CLOSED",
  });
}

async function runCleanup({
  authority,
  adapters,
  currentTime,
  failureOperationId,
  outcome,
  results,
  sourceCommit,
}) {
  for (const operation of CLEANUP_OPERATIONS) {
    validateAuthority(authority, {
      cleanupOnly: true,
      now: readClock(currentTime),
      sourceCommit,
    });
    const context = Object.freeze({
      authority,
      cleanupOnly: true,
      failureOperationId,
      operation,
      outcome,
      priorResults: Object.freeze([...results]),
    });
    const result = validateCleanupResult(
      operation.id,
      await adapters.operations[operation.id](context),
      authority,
      outcome,
      results,
    );
    assertAuthorityResponse(
      await adapters.state.recordCleanupOperation({
        authorityId: authority.authority_id,
        operationId: operation.id,
        outcome,
        result,
      }),
      authority.authority_id,
      "CLEANUP_RECORDED",
      operation.id,
    );
    results.push([operation.id, result]);
  }
}

async function executeWithInjectedAdapters({
  mode = "DRY_RUN",
  authority,
  sourceCommit,
  now = new Date(),
  currentTime = () => new Date(),
  adapters: adapterOverrides = {},
} = {}) {
  if (mode === "DRY_RUN") return dryRunPlan();
  if (mode !== "EXECUTE" && mode !== "CLEANUP_ONLY") fail("V2_09_EXECUTION_MODE_INVALID");
  validateAuthority(authority, { sourceCommit, now, cleanupOnly: mode === "CLEANUP_ONLY" });
  const adapters = createDefaultAdapters(adapterOverrides, authority.adapter_set_sha256);
  const authorityId = authority.authority_id;
  const results = [];

  if (mode === "CLEANUP_ONLY") {
    assertAuthorityResponse(
      await adapters.state.loadCleanupAuthority({ authority }),
      authorityId,
      "CLEANUP_ONLY",
    );
    await runCleanup({
      authority,
      adapters,
      currentTime,
      outcome: "FAILURE",
      failureOperationId: "PRIOR_INTERRUPTED_EXECUTION",
      results,
      sourceCommit,
    });
    assertAuthorityResponse(
      await adapters.state.completeCleanup({ authorityId }),
      authorityId,
      "FAILED_CLEAN",
    );
    return Object.freeze({
      schema_version: EXECUTION_SCHEMA,
      authority_id: authorityId,
      status: "FAILED_CLEAN",
      operations: results.map(([id]) => id),
      paid_dispatch_count: 0,
      redispatch_count: 0,
    });
  }

  assertClaimResponse(await adapters.state.claimAuthority({ authority }), authorityId);

  let failedOperationId;
  try {
    for (const operation of NORMAL_OPERATIONS) {
      failedOperationId = operation.id;
      if (
        ["REMOTE_MUTATION", "DATABASE_MUTATION", "LOCAL_MUTATION", "PAID_DISPATCH"].includes(
          operation.boundary,
        )
      )
        validateAuthority(authority, {
          sourceCommit,
          now: readClock(currentTime),
          cleanupOnly: false,
        });
      assertNormalStartResponse(
        await adapters.state.beginNormalOperation({
          authorityId,
          operationId: operation.id,
          redispatchAllowed: false,
        }),
        authorityId,
        operation.id,
      );
      const rawResult = await adapters.operations[operation.id](
        Object.freeze({
          authority,
          cleanupOnly: false,
          operation,
          priorResults: Object.freeze([...results]),
        }),
      );
      const result = validateOperationResult(operation.id, rawResult, authority, {
        executionNow: readClock(currentTime),
        priorResults: results,
      });
      assertAuthorityResponse(
        await adapters.state.completeNormalOperation({
          authorityId,
          operationId: operation.id,
          result,
        }),
        authorityId,
        "COMPLETED",
        operation.id,
      );
      results.push([operation.id, result]);
    }
  } catch {
    try {
      assertAuthorityResponse(
        await adapters.state.enterCleanupOnly({
          authorityId,
          failureCode: "V2_09_NORMAL_OPERATION_FAILED",
          failureOperationId: failedOperationId,
        }),
        authorityId,
        "CLEANUP_ONLY",
      );
      await runCleanup({
        authority,
        adapters,
        currentTime,
        outcome: "FAILURE",
        failureOperationId: failedOperationId,
        results,
        sourceCommit,
      });
      assertAuthorityResponse(
        await adapters.state.completeCleanup({ authorityId }),
        authorityId,
        "FAILED_CLEAN",
      );
    } catch {
      fail(`V2_09_ROLLOUT_FAILED_CLEANUP_INCOMPLETE:${failedOperationId}`);
    }
    fail(`V2_09_ROLLOUT_FAILED_CLEAN:${failedOperationId}`);
  }

  try {
    await runCleanup({
      authority,
      adapters,
      currentTime,
      outcome: "SUCCESS",
      failureOperationId: null,
      results,
      sourceCommit,
    });
  } catch {
    try {
      assertAuthorityResponse(
        await adapters.state.enterCleanupOnly({
          authorityId,
          failureCode: "V2_09_SUCCESS_FINALIZATION_FAILED",
          failureOperationId: "SUCCESS_FINALIZATION",
        }),
        authorityId,
        "CLEANUP_ONLY",
      );
      await runCleanup({
        authority,
        adapters,
        currentTime,
        outcome: "FAILURE",
        failureOperationId: "SUCCESS_FINALIZATION",
        results,
        sourceCommit,
      });
      assertAuthorityResponse(
        await adapters.state.completeCleanup({ authorityId }),
        authorityId,
        "FAILED_CLEAN",
      );
    } catch {
      fail("V2_09_ROLLOUT_FAILED_CLEANUP_INCOMPLETE:SUCCESS_FINALIZATION");
    }
    fail("V2_09_ROLLOUT_FAILED_CLEAN:SUCCESS_FINALIZATION");
  }

  const settlement = results.find(([id]) => id === "read-settled-billing")?.[1];
  if (settlement === undefined) fail("V2_09_SETTLED_BILLING_PROOF_MISSING");
  if (costSnapshotExceeded(settlement, authority)) {
    try {
      assertAuthorityResponse(
        await adapters.state.enterCleanupOnly({
          authorityId,
          failureCode: "V2_09_FINAL_CAP_EXCEEDED",
          failureOperationId: "read-settled-billing",
        }),
        authorityId,
        "CLEANUP_ONLY",
      );
      await runCleanup({
        authority,
        adapters,
        currentTime,
        outcome: "FAILURE",
        failureOperationId: "read-settled-billing",
        results,
        sourceCommit,
      });
      assertAuthorityResponse(
        await adapters.state.completeCleanup({ authorityId }),
        authorityId,
        "FAILED_CLEAN",
      );
    } catch {
      fail("V2_09_ROLLOUT_FAILED_CLEANUP_INCOMPLETE:read-settled-billing");
    }
    fail("V2_09_ROLLOUT_FAILED_CLEAN:read-settled-billing");
  }

  try {
    assertAuthorityResponse(
      await adapters.state.completeSuccess({ authorityId }),
      authorityId,
      "SUCCEEDED_CLEAN",
    );
  } catch {
    let reconciledStatus;
    try {
      reconciledStatus = assertSuccessReconciliation(
        await adapters.state.reconcileSuccess({ authorityId }),
        authorityId,
      );
    } catch {
      reconciledStatus = "NOT_SUCCEEDED";
    }
    if (reconciledStatus !== "SUCCEEDED_CLEAN") {
      try {
        assertAuthorityResponse(
          await adapters.state.enterCleanupOnly({
            authorityId,
            failureCode: "V2_09_SUCCESS_COMPLETION_ACK_UNKNOWN",
            failureOperationId: "SUCCESS_COMPLETION_ACK_UNKNOWN",
          }),
          authorityId,
          "CLEANUP_ONLY",
        );
        await runCleanup({
          authority,
          adapters,
          currentTime,
          outcome: "FAILURE",
          failureOperationId: "SUCCESS_COMPLETION_ACK_UNKNOWN",
          results,
          sourceCommit,
        });
        assertAuthorityResponse(
          await adapters.state.completeCleanup({ authorityId }),
          authorityId,
          "FAILED_CLEAN",
        );
      } catch {
        fail("V2_09_ROLLOUT_FAILED_CLEANUP_INCOMPLETE:SUCCESS_COMPLETION_ACK_UNKNOWN");
      }
      fail("V2_09_ROLLOUT_FAILED_CLEAN:SUCCESS_COMPLETION_ACK_UNKNOWN");
    }
  }

  return Object.freeze({
    schema_version: EXECUTION_SCHEMA,
    authority_id: authorityId,
    status: "SUCCEEDED_CLEAN",
    operations: results.map(([id]) => id),
    paid_dispatch_count: 1,
    redispatch_count: 0,
  });
}

// This is the only injected-adapter entrypoint. Its name and explicit flag keep arbitrary test
// callbacks unreachable from the live CLI/composition path.
export async function executeQualifiedProductionForTest(options = {}) {
  if (options.testOnlyInjectedAdapters !== true) fail("V2_09_TEST_ADAPTER_INJECTION_FORBIDDEN");
  const execution = { ...options };
  delete execution.testOnlyInjectedAdapters;
  return executeWithInjectedAdapters(execution);
}

export async function executeQualifiedProduction(options = {}) {
  if (options.mode === undefined || options.mode === "DRY_RUN") return dryRunPlan();
  if (Object.hasOwn(options, "adapters")) fail("V2_09_LIVE_ADAPTER_INJECTION_FORBIDDEN");
  if (
    Object.keys(options).some(
      (key) => !["authority", "configuration", "mode", "sourceCommit"].includes(key),
    )
  )
    fail("V2_09_LIVE_OPTION_INVALID");
  if (options.configuration === null || typeof options.configuration !== "object")
    fail("V2_09_LIVE_CONFIGURATION_REQUIRED");
  const { createConcreteQualifiedProductionAdapters } = await import(
    "./concrete-qualified-production-adapters.mjs"
  );
  const adapters = createConcreteQualifiedProductionAdapters(options.configuration);
  return executeWithInjectedAdapters({
    mode: options.mode,
    authority: options.authority,
    sourceCommit: options.sourceCommit,
    now: new Date(),
    currentTime: () => new Date(),
    adapters,
  });
}

function readPrivateJson(path, code) {
  if (typeof path !== "string" || !isAbsolute(path)) fail(code);
  const absolute = resolve(path);
  const parentPath = dirname(absolute);
  let parent;
  try {
    parent = lstatSync(parentPath);
  } catch {
    fail(code);
  }
  if (
    parent.isSymbolicLink() ||
    !parent.isDirectory() ||
    (parent.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && parent.uid !== process.getuid())
  )
    fail(code);
  let descriptor;
  try {
    descriptor = openSync(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stats = fstatSync(descriptor);
    if (
      !stats.isFile() ||
      (stats.mode & 0o777) !== 0o600 ||
      stats.size <= 0 ||
      stats.size > 1024 * 1024 ||
      (typeof process.getuid === "function" && stats.uid !== process.getuid())
    )
      fail(code);
    const value = JSON.parse(readFileSync(descriptor, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
    return value;
  } catch {
    fail(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--dry-run")) {
    process.stdout.write(`${JSON.stringify(dryRunPlan(), null, 2)}\n`);
    return;
  }
  if (
    argv.length !== 5 ||
    !["--execute", "--cleanup-only"].includes(argv[0]) ||
    argv[1] !== "--authority" ||
    argv[3] !== "--configuration"
  )
    fail("V2_09_LIVE_ARGUMENTS_INVALID");
  const authority = readPrivateJson(argv[2], "V2_09_AUTHORITY_FILE_INVALID");
  const configuration = readPrivateJson(argv[4], "V2_09_CONFIGURATION_FILE_INVALID");
  const result = await executeQualifiedProduction({
    mode: argv[0] === "--execute" ? "EXECUTE" : "CLEANUP_ONLY",
    authority,
    sourceCommit: authority.source_commit,
    configuration,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "V2_09_EXECUTOR_FAILED"}\n`);
    process.exitCode = 1;
  });
}
