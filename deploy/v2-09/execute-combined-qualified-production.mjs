import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  AUTHORITY_SCHEMA,
  BRANCH,
  CLEANUP_OPERATIONS,
  COMPLETION_CAP_USD,
  COMBINED_EXECUTION_MARKER,
  COMBINED_PRECOMPLETED_OPERATION_IDS,
  COMBINED_RESUME_SCHEMA,
  EXECUTION_SCHEMA,
  INCREMENTAL_CAP_USD,
  NORMAL_OPERATIONS,
  OPERATION_IDS,
  PUSH_REF,
  QUALIFIED_LANES,
  validateAuthority,
  executeQualifiedProduction,
} from "./execute-qualified-production.mjs";
import { runV209ReadOnlyPreflight, secureApiKey } from "./read-only-preflight.mjs";
import {
  MAXIMUM_COMPLETION_BASELINE_MICRO_USD,
  renderGlobalCompletionBaselineSql,
  renderPostMigrationCompletionBaselineSql,
  validateCompletionBaselineReceipt,
  validateGlobalCompletionBaselineReceipt,
} from "./read-durable-completion-baseline.mjs";

export const COMBINED_AUTHORITY_SCHEMA =
  "videoforge.v2-09-combined-qualified-production-authority/v1";
export const COMBINED_EXECUTION_SCHEMA =
  "videoforge.v2-09-combined-qualified-production-execution/v1";
export const STAGED_RECEIPTS_SCHEMA = "videoforge.v2-09-combined-staged-receipts/v1";
export const OUTER_STATE_SCHEMA = "videoforge.v2-09-combined-outer-state/v1";
export const STAGED_OPERATION_IDS = Object.freeze([
  "run-read-only-preflight",
  "read-pre-mutation-completion-baseline",
  "materialize-v209-protected-inputs",
  ...COMBINED_PRECOMPLETED_OPERATION_IDS.slice(0, 4),
  "read-post-migration-completion-baseline",
  ...COMBINED_PRECOMPLETED_OPERATION_IDS.slice(4, 11),
  "materialize-v209-endpoint-secrets",
  ...COMBINED_PRECOMPLETED_OPERATION_IDS.slice(11),
  "materialize-v209-postdeploy-chrome-auth",
  "read-postlogin-tenant-completion-baseline",
  "derive-qualified-production-authority",
  "execute-qualified-production",
]);

const HASH = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const AUTHORITY_ID = /^v2-09-[a-z0-9][a-z0-9._-]{7,95}$/u;
const PREFLIGHT_SCHEMA = "videoforge.v209-read-only-preflight/v1";
const MEDIA_RECEIPT_SCHEMA = "videoforge.v2-09-combined-media-release-receipt/v1";
const LANE_RECEIPT_SCHEMA = "videoforge.v2-09-combined-lane-receipt/v1";
const PRODUCTION_RECEIPT_SCHEMA = "videoforge.v2-09-combined-production-receipt/v1";
const BILLING_RECEIPT_SCHEMA = "videoforge.v2-09-combined-baseline-receipt/v1";
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const COMPLETION_BASELINE_DERIVATION =
  "GENERIC_PROJECT_ATTEMPT_SETTLED_PLUS_MAX_OPEN_RESERVATION_OR_REPORTED_ONCE";
const GLOBAL_COMPLETION_BASELINE_DERIVATION =
  "ALL_PROJECT_ATTEMPTS_SETTLED_PLUS_MAX_OPEN_RESERVATION_OR_REPORTED_ONCE";

function fail(code) {
  throw new Error(code);
}

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

function validInstant(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function assertSelfHash(value, code) {
  if (!HASH.test(value?.receipt_sha256 ?? "")) fail(code);
  const unsigned = { ...value };
  delete unsigned.receipt_sha256;
  if (sha256(canonical(unsigned)) !== value.receipt_sha256) fail(code);
}

function assertPreflight(value, authority) {
  if (
    !exactKeys(value, [
      "authority",
      "checkedAt",
      "checkpoint",
      "expectedCleanSource",
      "images",
      "proofSha256",
      "runpod",
      "schemaVersion",
    ]) ||
    value.schemaVersion !== PREFLIGHT_SCHEMA ||
    value.checkpoint !== "V2-09" ||
    value.expectedCleanSource !== authority.source_commit ||
    !validInstant(value.checkedAt) ||
    !HASH.test(value.proofSha256 ?? "")
  )
    fail("V2_09_COMBINED_PREFLIGHT_INVALID");
  const unsigned = { ...value };
  delete unsigned.proofSha256;
  if (sha256(canonical(unsigned)) !== value.proofSha256)
    fail("V2_09_COMBINED_PREFLIGHT_HASH_INVALID");
  if (
    !exactKeys(value.authority, [
      "credentialReads",
      "databaseCalls",
      "externalSpendUsd",
      "gpuJobs",
      "providerMutations",
      "r2Calls",
      "runpodJobPosts",
      "stage6Reruns",
      "stage7Reruns",
    ]) ||
    value.authority.credentialReads !== 1 ||
    Object.entries(value.authority).some(([key, count]) => key !== "credentialReads" && count !== 0)
  )
    fail("V2_09_COMBINED_PREFLIGHT_NOT_READ_ONLY");
  const offering = value.runpod?.offering;
  const inventory = value.runpod?.inventory;
  if (
    offering?.gpu !== authority.offering.gpu ||
    offering?.region !== authority.offering.region ||
    !["LOW", "MEDIUM", "HIGH"].includes(offering?.availability) ||
    !HASH.test(offering?.catalogSha256 ?? "") ||
    !finiteNonNegative(offering?.serverlessFlexRateUsdPerGpuHour) ||
    offering?.serverlessFlexRateUsdPerGpuHour > authority.offering.max_rate_usd_per_gpu_hour ||
    inventory?.activeWorkers !== 0 ||
    inventory?.pods !== 0 ||
    inventory?.endpoints !== 0 ||
    inventory?.privateTemplates !== 0
  )
    fail("V2_09_COMBINED_PREFLIGHT_ADMISSION_INVALID");
  const imageLanes = ["mage_image", "soulx_avatar"];
  if (
    !Array.isArray(value.images) ||
    value.images.length !== authority.frozen_lanes.length ||
    value.images.some((image, index) => {
      const lane = authority.frozen_lanes[index];
      return (
        image?.lane !== imageLanes[index] ||
        image?.manifestDigest !== lane.image_sha256 ||
        image?.configDigest !== lane.image_config_sha256 ||
        image?.sourceCommit !== lane.image_source_commit ||
        image?.frozenAnonymousProofSha256 !== lane.anonymous_proof_sha256 ||
        !HASH.test(image?.proofSha256 ?? "")
      );
    })
  )
    fail("V2_09_COMBINED_PREFLIGHT_IMAGE_INVALID");
  return value;
}

export function validateCombinedAuthority(
  authority,
  { sourceCommit, now = new Date(), cleanupOnly = false } = {},
) {
  if (
    !exactKeys(authority, [
      "authority_id",
      "caps",
      "credential_reads",
      "execution",
      "expires_at",
      "frozen_lanes",
      "issued_at",
      "job_limits",
      "media_worker_inputs",
      "offering",
      "operations",
      "production_inputs",
      "proposal_sha256",
      "schema_version",
      "single_use",
      "source_commit",
    ]) ||
    authority.schema_version !== COMBINED_AUTHORITY_SCHEMA ||
    !AUTHORITY_ID.test(authority.authority_id ?? "") ||
    !HASH.test(authority.proposal_sha256 ?? "") ||
    !COMMIT.test(authority.source_commit ?? "") ||
    authority.source_commit !== sourceCommit ||
    authority.single_use !== true ||
    authority.execution !== "V2_09_PREFLIGHT_THEN_QUALIFIED_PRODUCTION_ONCE" ||
    !validInstant(authority.issued_at) ||
    !validInstant(authority.expires_at)
  )
    fail("V2_09_COMBINED_AUTHORITY_INVALID");
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (
    !Number.isFinite(current) ||
    current < Date.parse(authority.issued_at) ||
    (!cleanupOnly && current >= Date.parse(authority.expires_at))
  )
    fail("V2_09_COMBINED_AUTHORITY_NOT_CURRENT");
  if (
    !exactKeys(authority.caps, ["max_completion_usd", "max_incremental_usd"]) ||
    authority.caps.max_incremental_usd !== INCREMENTAL_CAP_USD ||
    authority.caps.max_completion_usd !== COMPLETION_CAP_USD ||
    JSON.stringify(authority.operations) !== JSON.stringify(OPERATION_IDS) ||
    JSON.stringify(authority.frozen_lanes) !== JSON.stringify(QUALIFIED_LANES)
  )
    fail("V2_09_COMBINED_SCOPE_INVALID");
  if (
    !exactKeys(authority.credential_reads, [
      "database_operator_url_exact",
      "database_owner_url_exact",
      "inner_protected_snapshot_max",
      "preflight_runpod_api_key_exact",
      "receipt_derivation_protected_snapshot_exact",
      "staging_protected_snapshot_max",
    ]) ||
    authority.credential_reads.database_operator_url_exact !== 1 ||
    authority.credential_reads.database_owner_url_exact !== 1 ||
    authority.credential_reads.preflight_runpod_api_key_exact !== 1 ||
    authority.credential_reads.staging_protected_snapshot_max !== 2 ||
    authority.credential_reads.receipt_derivation_protected_snapshot_exact !== 1 ||
    authority.credential_reads.inner_protected_snapshot_max !== 2
  )
    fail("V2_09_COMBINED_CREDENTIAL_READ_LIMIT_INVALID");
  if (
    !exactKeys(authority.job_limits, [
      "chrome_e2e_runs",
      "generation_requests",
      "redispatches",
      "stage_6_jobs",
      "stage_7_jobs",
    ]) ||
    authority.job_limits.chrome_e2e_runs !== 1 ||
    authority.job_limits.generation_requests !== 1 ||
    authority.job_limits.redispatches !== 0 ||
    authority.job_limits.stage_6_jobs !== 0 ||
    authority.job_limits.stage_7_jobs !== 0
  )
    fail("V2_09_COMBINED_JOB_LIMIT_INVALID");
  if (
    !exactKeys(authority.offering, [
      "availability_floor",
      "gpu",
      "max_rate_usd_per_gpu_hour",
      "region",
    ]) ||
    authority.offering.gpu !== "NVIDIA GeForce RTX 4090" ||
    authority.offering.region !== "EU-RO-1" ||
    authority.offering.availability_floor !== "LOW" ||
    authority.offering.max_rate_usd_per_gpu_hour !== 1.116
  )
    fail("V2_09_COMBINED_OFFERING_INVALID");
  if (
    !exactKeys(authority.media_worker_inputs, [
      "execution_bundle_sha256",
      "materialization_mode",
      "release",
      "whisper_model_sha256",
    ]) ||
    authority.media_worker_inputs.release !== "0.1.15" ||
    authority.media_worker_inputs.materialization_mode !== "PREAUTHORIZED_STAGED_ONCE" ||
    !HASH.test(authority.media_worker_inputs.execution_bundle_sha256 ?? "") ||
    !HASH.test(authority.media_worker_inputs.whisper_model_sha256 ?? "")
  )
    fail("V2_09_COMBINED_MEDIA_INPUT_INVALID");
  const inputs = authority.production_inputs;
  if (
    !exactKeys(inputs, [
      "chrome_bootstrap_plan_sha256",
      "materialization_input_sha256",
      "secret_allowlist_sha256",
      "secret_count",
      "worker_name",
    ]) ||
    inputs.worker_name !== "videoforge-production-runtime" ||
    [
      inputs.chrome_bootstrap_plan_sha256,
      inputs.materialization_input_sha256,
      inputs.secret_allowlist_sha256,
    ].some((value) => !HASH.test(value ?? "")) ||
    inputs.secret_count !== 22
  )
    fail("V2_09_COMBINED_PROTECTED_INPUT_INVALID");
  return authority;
}

function validateStagedReceipts(staged, authority, preflight) {
  if (
    !exactKeys(staged, [
      "adapter",
      "baseline",
      "configuration",
      "lanes",
      "media_release",
      "outer_receipts_sha256",
      "production",
      "schema_version",
    ]) ||
    staged.schema_version !== STAGED_RECEIPTS_SCHEMA ||
    !HASH.test(staged.outer_receipts_sha256 ?? "") ||
    !exactKeys(staged.adapter, [
      "adapter_set_sha256",
      "preflight_proof_sha256",
      "receipt_sha256",
    ]) ||
    !HASH.test(staged.adapter.adapter_set_sha256 ?? "") ||
    staged.adapter.preflight_proof_sha256 !== preflight.proofSha256
  )
    fail("V2_09_COMBINED_STAGED_RECEIPTS_INVALID");
  assertSelfHash(staged.adapter, "V2_09_COMBINED_ADAPTER_RECEIPT_HASH_INVALID");

  const media = staged.media_release;
  if (
    !exactKeys(media, [
      "execution_bundle_sha256",
      "installer_asset_sha256",
      "preflight_proof_sha256",
      "receipt_sha256",
      "release",
      "release_manifest_sha256",
      "schema_version",
      "signing_identity_sha256",
      "whisper_model_sha256",
    ]) ||
    media.schema_version !== MEDIA_RECEIPT_SCHEMA ||
    media.preflight_proof_sha256 !== preflight.proofSha256 ||
    media.release !== "0.1.15" ||
    [
      media.execution_bundle_sha256,
      media.installer_asset_sha256,
      media.release_manifest_sha256,
      media.signing_identity_sha256,
      media.whisper_model_sha256,
    ].some((value) => !HASH.test(value ?? ""))
  )
    fail("V2_09_COMBINED_MEDIA_RECEIPT_INVALID");
  assertSelfHash(media, "V2_09_COMBINED_MEDIA_RECEIPT_HASH_INVALID");

  if (!Array.isArray(staged.lanes) || staged.lanes.length !== QUALIFIED_LANES.length)
    fail("V2_09_COMBINED_LANE_RECEIPTS_INVALID");
  staged.lanes.forEach((receipt, index) => {
    if (
      !exactKeys(receipt, [
        "lane",
        "preflight_proof_sha256",
        "qualified_lane",
        "receipt_sha256",
        "schema_version",
      ]) ||
      receipt.schema_version !== LANE_RECEIPT_SCHEMA ||
      receipt.preflight_proof_sha256 !== preflight.proofSha256 ||
      receipt.lane !== QUALIFIED_LANES[index].lane ||
      JSON.stringify(receipt.qualified_lane) !== JSON.stringify(QUALIFIED_LANES[index])
    )
      fail("V2_09_COMBINED_LANE_RECEIPTS_INVALID");
    assertSelfHash(receipt, "V2_09_COMBINED_LANE_RECEIPT_HASH_INVALID");
  });

  const production = staged.production;
  if (
    !exactKeys(production, [
      "config_sha256",
      "preflight_proof_sha256",
      "protected_static_inputs",
      "receipt_sha256",
      "schema_version",
      "worker_bundle_sha256",
      "chrome_auth_state_sha256",
      "chrome_request_sha256",
    ]) ||
    production.schema_version !== PRODUCTION_RECEIPT_SCHEMA ||
    production.preflight_proof_sha256 !== preflight.proofSha256 ||
    JSON.stringify(production.protected_static_inputs) !==
      JSON.stringify(authority.production_inputs) ||
    !HASH.test(production.config_sha256 ?? "") ||
    !HASH.test(production.worker_bundle_sha256 ?? "") ||
    !HASH.test(production.chrome_auth_state_sha256 ?? "") ||
    !HASH.test(production.chrome_request_sha256 ?? "")
  )
    fail("V2_09_COMBINED_PRODUCTION_RECEIPT_INVALID");
  assertSelfHash(production, "V2_09_COMBINED_PRODUCTION_RECEIPT_HASH_INVALID");

  const baseline = staged.baseline;
  if (
    !exactKeys(baseline, [
      "billing_baseline_usd",
      "billing_rows_sha256",
      "completion_baseline_derivation",
      "completion_baseline_receipt_sha256",
      "completion_baseline_usd",
      "global_completion_baseline_receipt_sha256",
      "global_completion_baseline_derivation",
      "preflight_proof_sha256",
      "receipt_sha256",
      "schema_version",
    ]) ||
    baseline.schema_version !== BILLING_RECEIPT_SCHEMA ||
    baseline.preflight_proof_sha256 !== preflight.proofSha256 ||
    baseline.billing_baseline_usd !== preflight.runpod?.billing?.cumulativeEndpointBillingUsd ||
    baseline.billing_rows_sha256 !== preflight.runpod?.billing?.rowsSha256 ||
    baseline.completion_baseline_derivation !== COMPLETION_BASELINE_DERIVATION ||
    baseline.global_completion_baseline_derivation !== GLOBAL_COMPLETION_BASELINE_DERIVATION ||
    !HASH.test(baseline.completion_baseline_receipt_sha256 ?? "") ||
    !HASH.test(baseline.global_completion_baseline_receipt_sha256 ?? "") ||
    !finiteNonNegative(baseline.completion_baseline_usd) ||
    baseline.completion_baseline_usd + INCREMENTAL_CAP_USD > COMPLETION_CAP_USD
  )
    fail("V2_09_COMBINED_BASELINE_RECEIPT_INVALID");
  assertSelfHash(baseline, "V2_09_COMBINED_BASELINE_RECEIPT_HASH_INVALID");
  if (
    staged.configuration === null ||
    typeof staged.configuration !== "object" ||
    Array.isArray(staged.configuration)
  )
    fail("V2_09_COMBINED_CONFIGURATION_INVALID");
  return staged;
}

export function deriveQualifiedProductionAuthority(authority, preflight, staged) {
  validateStagedReceipts(staged, authority, preflight);
  const inputs = authority.production_inputs;
  const baseline = staged.baseline;
  const media = staged.media_release;
  // Bind the inner authority to every staged fact, not merely the outer ID and preflight. This
  // makes a changed lane, persistence, media, baseline, configuration, or adapter receipt derive a
  // different single-use authority before the Cloudflare/Chrome suffix can start.
  const stagedReceiptsSha256 = sha256(canonical(staged));
  const innerAuthorityId = `v2-09-inner-${sha256(
    canonical({
      outerAuthorityId: authority.authority_id,
      preflightProof: preflight.proofSha256,
      stagedReceiptsSha256,
    }),
  ).slice(7, 31)}`;
  return Object.freeze({
    authority_id: innerAuthorityId,
    adapter_set_sha256: staged.adapter.adapter_set_sha256,
    branch: BRANCH,
    caps: Object.freeze({
      billing_baseline_usd: baseline.billing_baseline_usd,
      billing_stop_usd: baseline.billing_baseline_usd + INCREMENTAL_CAP_USD,
      completion_baseline_usd: baseline.completion_baseline_usd,
      completion_cap_usd: COMPLETION_CAP_USD,
      completion_stop_usd: baseline.completion_baseline_usd + INCREMENTAL_CAP_USD,
      incremental_cap_usd: INCREMENTAL_CAP_USD,
    }),
    execution: "V2_09_QUALIFIED_PRODUCTION_ONCE",
    expires_at: authority.expires_at,
    issued_at: authority.issued_at,
    media_worker: Object.freeze({
      execution_bundle_sha256: media.execution_bundle_sha256,
      installer_asset_sha256: media.installer_asset_sha256,
      release: media.release,
      release_manifest_sha256: media.release_manifest_sha256,
      signing_identity_sha256: media.signing_identity_sha256,
      whisper_model_sha256: media.whisper_model_sha256,
    }),
    offering: Object.freeze({
      ...authority.offering,
      offering_id_sha256: sha256(
        canonical({
          catalog_sha256: preflight.runpod.offering.catalogSha256,
          gpu: preflight.runpod.offering.gpu,
          region: preflight.runpod.offering.region,
        }),
      ),
    }),
    production: Object.freeze({
      worker_name: inputs.worker_name,
      chrome_auth_state_sha256: staged.production.chrome_auth_state_sha256,
      chrome_request_sha256: staged.production.chrome_request_sha256,
      secret_allowlist_sha256: inputs.secret_allowlist_sha256,
      secret_count: inputs.secret_count,
      config_sha256: staged.production.config_sha256,
      worker_bundle_sha256: staged.production.worker_bundle_sha256,
    }),
    proposal_sha256: authority.proposal_sha256,
    push_ref: PUSH_REF,
    schema_version: AUTHORITY_SCHEMA,
    scope: Object.freeze({
      operations: [...OPERATION_IDS],
      stage_6: "FROZEN_QUALIFIED_NO_RERUN",
      stage_7: "FROZEN_QUALIFIED_NO_RERUN",
      allow_stage_6_or_7_qualification: false,
      allow_v2_10_plus: false,
      allow_redispatch: false,
      cleanup_only_recovery: true,
      lanes: QUALIFIED_LANES.map((lane) => ({ ...lane })),
      allow_image_publication: false,
      allow_gpu_fallback: false,
      allow_region_fallback: false,
      allow_model_download: false,
      allow_retained_volume_mutation: false,
      media_worker_release: "0.1.15",
    }),
    single_use: true,
    source_commit: authority.source_commit,
  });
}

function validateOuterState(value, authority) {
  if (
    !exactKeys(value, [
      "consumed_once",
      "inner_authority_id",
      "inner_authority_sha256",
      "operations",
      "outer_authority_id",
      "proposal_sha256",
      "schema_version",
      "source_commit",
      "status",
    ]) ||
    value.schema_version !== OUTER_STATE_SCHEMA ||
    value.outer_authority_id !== authority.authority_id ||
    value.proposal_sha256 !== authority.proposal_sha256 ||
    value.source_commit !== authority.source_commit ||
    value.consumed_once !== true ||
    ![
      "CLAIMED",
      "AWAITING_INTERACTIVE_CHROME_LOGIN",
      "CLEANUP_ONLY",
      "FAILED_CLEAN",
      "SUCCEEDED_CLEAN",
    ].includes(value.status) ||
    !Array.isArray(value.operations) ||
    value.operations.length !== STAGED_OPERATION_IDS.length ||
    value.operations.some(
      (operation, index) =>
        !exactKeys(operation, ["id", "result", "result_sha256", "status"]) ||
        operation.id !== STAGED_OPERATION_IDS[index] ||
        !["PENDING", "STARTED", "COMPLETED"].includes(operation.status) ||
        (operation.status === "COMPLETED") !== (operation.result !== null) ||
        (operation.status === "COMPLETED") !== HASH.test(operation.result_sha256 ?? "") ||
        (operation.status === "COMPLETED" &&
          sha256(canonical(operation.result)) !== operation.result_sha256),
    ) ||
    (value.inner_authority_id !== null && !AUTHORITY_ID.test(value.inner_authority_id)) ||
    (value.inner_authority_sha256 !== null && !HASH.test(value.inner_authority_sha256)) ||
    (value.inner_authority_id === null) !== (value.inner_authority_sha256 === null)
  )
    fail("V2_09_COMBINED_OUTER_STATE_INVALID");
  return value;
}

function securePrivateJson(path, code) {
  if (typeof path !== "string" || !isAbsolute(path)) fail(code);
  const absolute = resolve(path);
  const parent = lstatSync(dirname(absolute));
  if (
    parent.isSymbolicLink() ||
    !parent.isDirectory() ||
    (parent.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && parent.uid !== process.getuid())
  )
    fail(code);
  let descriptor;
  try {
    const before = lstatSync(absolute, { bigint: true });
    if (before.isSymbolicLink()) fail(code);
    descriptor = openSync(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stats = fstatSync(descriptor, { bigint: true });
    if (
      !stats.isFile() ||
      (stats.mode & 0o777n) !== 0o600n ||
      stats.nlink !== 1n ||
      stats.size <= 0n ||
      stats.size > BigInt(4 * 1024 * 1024) ||
      (typeof process.getuid === "function" && stats.uid !== BigInt(process.getuid())) ||
      ["dev", "ino", "mode", "nlink", "uid", "gid", "size", "mtimeNs", "ctimeNs"].some(
        (key) => before[key] !== stats[key],
      )
    )
      fail(code);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(absolute, { bigint: true });
    if (
      pathAfter.isSymbolicLink() ||
      ["dev", "ino", "mode", "nlink", "uid", "gid", "size", "mtimeNs", "ctimeNs"].some(
        (key) => stats[key] !== after[key] || after[key] !== pathAfter[key],
      )
    )
      fail(code);
    const value = JSON.parse(bytes.toString("utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
    return value;
  } catch {
    fail(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function securePrivateText(path, code) {
  if (typeof path !== "string" || !isAbsolute(path)) fail(code);
  const absolute = resolve(path);
  const parent = lstatSync(dirname(absolute));
  if (
    parent.isSymbolicLink() ||
    !parent.isDirectory() ||
    (parent.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && parent.uid !== process.getuid())
  )
    fail(code);
  let descriptor;
  try {
    const before = lstatSync(absolute, { bigint: true });
    if (before.isSymbolicLink()) fail(code);
    descriptor = openSync(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      (opened.mode & 0o777n) !== 0o600n ||
      opened.nlink !== 1n ||
      opened.size <= 0n ||
      opened.size > 16_384n ||
      (typeof process.getuid === "function" && opened.uid !== BigInt(process.getuid())) ||
      ["dev", "ino", "mode", "nlink", "uid", "gid", "size", "mtimeNs", "ctimeNs"].some(
        (key) => before[key] !== opened[key],
      )
    )
      fail(code);
    const value = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(absolute, { bigint: true });
    if (
      value.trim() !== value ||
      pathAfter.isSymbolicLink() ||
      ["dev", "ino", "mode", "nlink", "uid", "gid", "size", "mtimeNs", "ctimeNs"].some(
        (key) => opened[key] !== after[key] || after[key] !== pathAfter[key],
      )
    )
      fail(code);
    return value;
  } catch {
    fail(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function atomicPrivateWrite(path, value) {
  const absolute = resolve(path);
  const temporary = `${absolute}.next.${process.pid}.${Date.now()}`;
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    writeFileSync(descriptor, `${canonical(value)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, absolute);
    const parentDescriptor = openSync(dirname(absolute), fsConstants.O_RDONLY);
    try {
      fsyncSync(parentDescriptor);
    } finally {
      closeSync(parentDescriptor);
    }
  } catch {
    if (descriptor !== undefined) closeSync(descriptor);
    fail("V2_09_COMBINED_STATE_WRITE_FAILED");
  }
}

function atomicPrivateCreate(path, value) {
  const absolute = resolve(path);
  let descriptor;
  try {
    descriptor = openSync(
      absolute,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    writeFileSync(descriptor, `${canonical(value)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const parentDescriptor = openSync(dirname(absolute), fsConstants.O_RDONLY);
    try {
      fsyncSync(parentDescriptor);
    } finally {
      closeSync(parentDescriptor);
    }
    return true;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error?.code === "EEXIST") return false;
    fail("V2_09_COMBINED_STATE_WRITE_FAILED");
  }
}

export function createDurableOuterState(statePath) {
  if (typeof statePath !== "string" || !isAbsolute(statePath))
    fail("V2_09_COMBINED_STATE_PATH_INVALID");
  const absolute = resolve(statePath);
  const parent = lstatSync(dirname(absolute));
  if (
    parent.isSymbolicLink() ||
    !parent.isDirectory() ||
    (parent.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && parent.uid !== process.getuid())
  )
    fail("V2_09_COMBINED_STATE_PATH_INVALID");
  const read = () => securePrivateJson(absolute, "V2_09_COMBINED_STATE_READ_FAILED");
  const write = (value) => {
    atomicPrivateWrite(absolute, value);
    return value;
  };
  return Object.freeze({
    loadOrClaim({ authority }) {
      const initial = {
        schema_version: OUTER_STATE_SCHEMA,
        outer_authority_id: authority.authority_id,
        inner_authority_id: null,
        inner_authority_sha256: null,
        proposal_sha256: authority.proposal_sha256,
        source_commit: authority.source_commit,
        consumed_once: true,
        status: "CLAIMED",
        operations: STAGED_OPERATION_IDS.map((id) => ({
          id,
          status: "PENDING",
          result: null,
          result_sha256: null,
        })),
      };
      return atomicPrivateCreate(absolute, initial)
        ? initial
        : validateOuterState(read(), authority);
    },
    beginOperation({ operationId }) {
      const value = read();
      const operation = value.operations.find(({ id }) => id === operationId);
      if (!operation || operation.status !== "PENDING") return value;
      operation.status = "STARTED";
      return write(value);
    },
    completeOperation({ operationId, result }) {
      const value = read();
      const operation = value.operations.find(({ id }) => id === operationId);
      if (!operation || operation.status !== "STARTED")
        fail("V2_09_COMBINED_OPERATION_STATE_INVALID");
      operation.status = "COMPLETED";
      operation.result = result;
      operation.result_sha256 = sha256(canonical(result));
      if (
        operationId === "materialize-v209-postdeploy-chrome-auth" &&
        value.status === "AWAITING_INTERACTIVE_CHROME_LOGIN"
      )
        value.status = "CLAIMED";
      return write(value);
    },
    bindInnerAuthority({ innerAuthorityId, innerAuthoritySha256 }) {
      const value = read();
      if (
        !AUTHORITY_ID.test(innerAuthorityId ?? "") ||
        !HASH.test(innerAuthoritySha256 ?? "") ||
        (value.inner_authority_id !== null && value.inner_authority_id !== innerAuthorityId) ||
        (value.inner_authority_sha256 !== null &&
          value.inner_authority_sha256 !== innerAuthoritySha256)
      )
        fail("V2_09_COMBINED_INNER_ID_BINDING_INVALID");
      value.inner_authority_id = innerAuthorityId;
      value.inner_authority_sha256 = innerAuthoritySha256;
      return write(value);
    },
    awaitInteractiveChromeLogin() {
      const value = read();
      if (
        !["CLAIMED", "AWAITING_INTERACTIVE_CHROME_LOGIN"].includes(value.status) ||
        value.inner_authority_id !== null ||
        value.operations.find(({ id }) => id === "materialize-v209-postdeploy-chrome-auth")
          ?.status !== "STARTED"
      )
        fail("V2_09_COMBINED_CHROME_PAUSE_INVALID");
      value.status = "AWAITING_INTERACTIVE_CHROME_LOGIN";
      return write(value);
    },
    resumeInteractiveChromeLogin() {
      const value = read();
      if (value.status !== "AWAITING_INTERACTIVE_CHROME_LOGIN")
        fail("V2_09_COMBINED_CHROME_RESUME_INVALID");
      return value;
    },
    enterCleanupOnly() {
      const value = read();
      value.status = "CLEANUP_ONLY";
      return write(value);
    },
    completeSuccess() {
      const value = read();
      value.status = "SUCCEEDED_CLEAN";
      return write(value);
    },
    completeCleanup() {
      const value = read();
      value.status = "FAILED_CLEAN";
      return write(value);
    },
    reconcileSuccess() {
      return read();
    },
  });
}

function completedResult(state, operationId) {
  return state.operations.find(({ id }) => id === operationId)?.result ?? null;
}

function assertTerminalExecution(value, innerAuthorityId) {
  if (
    !exactKeys(value, [
      "authority_id",
      "operations",
      "paid_dispatch_count",
      "redispatch_count",
      "schema_version",
      "status",
    ]) ||
    value.schema_version !== EXECUTION_SCHEMA ||
    value.authority_id !== innerAuthorityId ||
    value.status !== "SUCCEEDED_CLEAN" ||
    JSON.stringify(value.operations) !== JSON.stringify(OPERATION_IDS) ||
    value.paid_dispatch_count !== 1 ||
    value.redispatch_count !== 0
  )
    fail("V2_09_COMBINED_INNER_TERMINAL_INVALID");
  return value;
}

function isInteractiveChromePause(error) {
  return (
    error instanceof Error &&
    error.message === "V2_09_CHROME_BOOTSTRAP_AWAITING_INTERACTIVE_CHROME_LOGIN" &&
    error.resumable === true &&
    error.code === error.message
  );
}

function awaitingChromeReceipt(authority, state, preflight) {
  return Object.freeze({
    schema_version: COMBINED_EXECUTION_SCHEMA,
    authority_id: authority.authority_id,
    inner_authority_id: state.inner_authority_id,
    status: "AWAITING_INTERACTIVE_CHROME_LOGIN",
    preflight_proof_sha256: preflight.proofSha256,
    production_execution: null,
  });
}

async function beginAndRun({ authority, operationId, outerState, run }) {
  let state = validateOuterState(await outerState.reconcileSuccess(), authority);
  const existing = state.operations.find(({ id }) => id === operationId);
  if (existing.status === "COMPLETED") return existing.result;
  if (existing.status === "STARTED") fail("V2_09_COMBINED_INTERRUPTED_NO_REPLAY");
  state = validateOuterState(await outerState.beginOperation({ operationId }), authority);
  if (state.operations.find(({ id }) => id === operationId)?.status !== "STARTED")
    fail("V2_09_COMBINED_OPERATION_START_INVALID");
  const result = await run();
  validateOuterState(await outerState.completeOperation({ operationId, result }), authority);
  return result;
}

function stagedDocument(results, configuration) {
  const derived = results["derive-qualified-production-authority"];
  return { ...derived.staged_receipts, configuration };
}

async function reconstructInnerForCleanup({
  authority,
  sourceCommit,
  now,
  state,
  loadConfiguration,
}) {
  const preflight = assertPreflight(completedResult(state, "run-read-only-preflight"), authority);
  const results = Object.fromEntries(
    state.operations.filter(({ result }) => result !== null).map(({ id, result }) => [id, result]),
  );
  const configuration = await loadConfiguration();
  const inner = deriveQualifiedProductionAuthority(
    authority,
    preflight,
    stagedDocument(results, configuration),
  );
  validateAuthority(inner, { sourceCommit, now, cleanupOnly: true });
  if (
    state.inner_authority_id !== inner.authority_id ||
    state.inner_authority_sha256 !== sha256(canonical(inner))
  )
    fail("V2_09_COMBINED_INNER_ID_BINDING_INVALID");
  return {
    configuration,
    inner,
    combinedExecution: combinedExecutionReceipt(
      authority,
      preflight,
      results,
      stagedDocument(results, configuration),
      inner,
    ),
  };
}

function combinedExecutionReceipt(authority, preflight, prefixResults, staged, innerAuthority) {
  const unsigned = {
    schema_version: COMBINED_RESUME_SCHEMA,
    execution_marker: COMBINED_EXECUTION_MARKER,
    outer_authority_id: authority.authority_id,
    preflight_proof_sha256: preflight.proofSha256,
    staged_receipts_sha256: sha256(canonical(staged)),
    inner_authority_sha256: sha256(canonical(innerAuthority)),
    operations: COMBINED_PRECOMPLETED_OPERATION_IDS.map((operationId) => ({
      operation_id: operationId,
      result: prefixResults[operationId],
      result_sha256: sha256(canonical(prefixResults[operationId])),
    })),
  };
  return Object.freeze({ ...unsigned, receipt_sha256: sha256(canonical(unsigned)) });
}

function assertStableCompletionBaseline(before, after) {
  for (const value of [before, after])
    validateGlobalCompletionBaselineReceipt(value, MAXIMUM_COMPLETION_BASELINE_MICRO_USD);
  const unstableKeys = new Set(["observedAt", "receiptSha256"]);
  const stableBefore = Object.fromEntries(
    Object.entries(before).filter(([key]) => !unstableKeys.has(key)),
  );
  const stableAfter = Object.fromEntries(
    Object.entries(after).filter(([key]) => !unstableKeys.has(key)),
  );
  if (canonical(stableBefore) !== canonical(stableAfter))
    fail("V2_09_COMBINED_COMPLETION_BASELINE_DRIFT");
  return after;
}

function assertPreMutationCompletionBaseline(value) {
  return validateGlobalCompletionBaselineReceipt(value, MAXIMUM_COMPLETION_BASELINE_MICRO_USD);
}

export async function executeCombinedQualifiedProductionForTest({
  authority,
  sourceCommit,
  now = new Date(),
  loadApiKey,
  runPreflight,
  stageOperation,
  materializeStagedReceipts,
  loadConfiguration,
  executeProduction,
  cleanupStaged,
  cleanupProtected,
  hasProtectedCleanup,
  hasInnerCleanup,
  readInnerSuccess,
  outerState,
}) {
  validateCombinedAuthority(authority, { sourceCommit, now, cleanupOnly: true });
  if (
    typeof loadApiKey !== "function" ||
    typeof runPreflight !== "function" ||
    typeof stageOperation !== "function" ||
    typeof materializeStagedReceipts !== "function" ||
    typeof loadConfiguration !== "function" ||
    typeof executeProduction !== "function" ||
    typeof cleanupStaged !== "function" ||
    typeof cleanupProtected !== "function" ||
    typeof hasProtectedCleanup !== "function" ||
    typeof hasInnerCleanup !== "function" ||
    typeof readInnerSuccess !== "function" ||
    [
      "loadOrClaim",
      "beginOperation",
      "completeOperation",
      "bindInnerAuthority",
      "awaitInteractiveChromeLogin",
      "resumeInteractiveChromeLogin",
      "enterCleanupOnly",
      "completeSuccess",
      "completeCleanup",
      "reconcileSuccess",
    ].some((method) => typeof outerState?.[method] !== "function")
  )
    fail("V2_09_COMBINED_DEPENDENCY_INVALID");

  let state = validateOuterState(await outerState.loadOrClaim({ authority }), authority);
  if (state.status === "SUCCEEDED_CLEAN") {
    const preflight = assertPreflight(completedResult(state, "run-read-only-preflight"), authority);
    const configuration = await loadConfiguration();
    const staged = stagedDocument(
      Object.fromEntries(
        state.operations
          .filter(({ result }) => result !== null)
          .map(({ id, result }) => [id, result]),
      ),
      configuration,
    );
    const inner = deriveQualifiedProductionAuthority(authority, preflight, staged);
    if (state.inner_authority_sha256 !== sha256(canonical(inner)))
      fail("V2_09_COMBINED_INNER_HASH_BINDING_INVALID");
    const execution = assertTerminalExecution(
      completedResult(state, "execute-qualified-production"),
      inner.authority_id,
    );
    return Object.freeze({
      schema_version: COMBINED_EXECUTION_SCHEMA,
      authority_id: authority.authority_id,
      inner_authority_id: state.inner_authority_id,
      status: "SUCCEEDED_CLEAN",
      preflight_proof_sha256: completedResult(state, "run-read-only-preflight").proofSha256,
      production_execution: execution,
    });
  }
  if (state.status === "FAILED_CLEAN") fail("V2_09_COMBINED_FAILED_CLEAN");

  const interruptedChromeAuth =
    state.status === "CLAIMED" &&
    state.inner_authority_id === null &&
    state.operations.find(({ id }) => id === "materialize-v209-postdeploy-chrome-auth")?.status ===
      "STARTED";
  if (interruptedChromeAuth) {
    // A process may die after Chrome durably wrote its claim-bound auth state but before the outer
    // receipt was acknowledged. Only adopt that exact STARTED auth operation; never treat it as a
    // generic staged failure or replay any deployment operation.
    try {
      validateCombinedAuthority(authority, { sourceCommit, now });
      state = validateOuterState(await outerState.awaitInteractiveChromeLogin(), authority);
    } catch {
      // Expired or otherwise invalid authority must not launch Chrome. The generic interrupted
      // path below performs cleanup-only recovery instead.
    }
  }

  if (state.status === "AWAITING_INTERACTIVE_CHROME_LOGIN") {
    // This is an external browser/auth action, so revalidate the current non-cleanup authority
    // before every adoption attempt.
    try {
      validateCombinedAuthority(authority, { sourceCommit, now });
    } catch (error) {
      validateOuterState(await outerState.enterCleanupOnly(), authority);
      await cleanupStaged({ authority, state });
      validateOuterState(await outerState.completeCleanup(), authority);
      throw error;
    }
    const preflight = assertPreflight(completedResult(state, "run-read-only-preflight"), authority);
    const resumedResults = Object.fromEntries(
      state.operations
        .filter(({ result }) => result !== null)
        .map(({ id, result }) => [id, result]),
    );
    if (state.inner_authority_id === null) {
      const chromeOperation = state.operations.find(
        ({ id }) => id === "materialize-v209-postdeploy-chrome-auth",
      );
      if (chromeOperation?.status !== "STARTED") fail("V2_09_COMBINED_CHROME_RESUME_INVALID");
      validateOuterState(await outerState.resumeInteractiveChromeLogin(), authority);
      let chromeResult;
      try {
        chromeResult = await stageOperation({
          operationId: "materialize-v209-postdeploy-chrome-auth",
          authority,
          preflight,
          priorResults: resumedResults,
          resumeInteractiveChrome: true,
        });
      } catch (error) {
        if (isInteractiveChromePause(error))
          return awaitingChromeReceipt(authority, state, preflight);
        validateOuterState(await outerState.enterCleanupOnly(), authority);
        await cleanupStaged({ authority, state });
        validateOuterState(await outerState.completeCleanup(), authority);
        throw error;
      }
      validateOuterState(
        await outerState.completeOperation({
          operationId: "materialize-v209-postdeploy-chrome-auth",
          result: chromeResult,
        }),
        authority,
      );
      state = validateOuterState(await outerState.reconcileSuccess(), authority);
      // Continue through the ordinary idempotent coordinator below. Completed prefix operations
      // are read from the durable outer state and are never replayed.
    } else fail("V2_09_COMBINED_CHROME_RESUME_INVALID");
  }

  const adoptInnerSuccess = async (candidate) => {
    const executeOperation = candidate.operations.find(
      ({ id }) => id === "execute-qualified-production",
    );
    if (
      !["CLAIMED", "CLEANUP_ONLY"].includes(candidate.status) ||
      candidate.inner_authority_id === null ||
      !["STARTED", "COMPLETED"].includes(executeOperation?.status)
    )
      return null;
    const { configuration, inner, combinedExecution } = await reconstructInnerForCleanup({
      authority,
      sourceCommit,
      now,
      state: candidate,
      loadConfiguration,
    });
    const adoptedExecution = await readInnerSuccess({
      authority: inner,
      configuration,
      combinedExecution,
      state: candidate,
    });
    if (adoptedExecution === null) return null;
    const terminal = assertTerminalExecution(adoptedExecution, inner.authority_id);
    if (executeOperation.status === "STARTED") {
      try {
        candidate = validateOuterState(
          await outerState.completeOperation({
            operationId: "execute-qualified-production",
            result: terminal,
          }),
          authority,
        );
      } catch {
        candidate = validateOuterState(await outerState.reconcileSuccess(), authority);
        assertTerminalExecution(
          completedResult(candidate, "execute-qualified-production"),
          inner.authority_id,
        );
      }
    } else if (
      canonical(
        assertTerminalExecution(
          completedResult(candidate, "execute-qualified-production"),
          inner.authority_id,
        ),
      ) !== canonical(terminal)
    )
      fail("V2_09_COMBINED_TERMINAL_EXECUTION_DRIFT");
    try {
      candidate = validateOuterState(await outerState.completeSuccess(), authority);
    } catch {
      candidate = validateOuterState(await outerState.reconcileSuccess(), authority);
    }
    if (candidate.status !== "SUCCEEDED_CLEAN") fail("V2_09_COMBINED_SUCCESS_ACK_UNKNOWN");
    return Object.freeze({
      schema_version: COMBINED_EXECUTION_SCHEMA,
      authority_id: authority.authority_id,
      inner_authority_id: inner.authority_id,
      status: "SUCCEEDED_CLEAN",
      preflight_proof_sha256: combinedExecution.preflight_proof_sha256,
      production_execution: terminal,
    });
  };

  const recoveredSuccess = await adoptInnerSuccess(state);
  if (recoveredSuccess !== null) return recoveredSuccess;

  const interrupted = state.operations.find(({ status }) => status === "STARTED");
  if (state.status === "CLEANUP_ONLY" || interrupted) {
    if (state.status !== "CLEANUP_ONLY")
      state = validateOuterState(await outerState.enterCleanupOnly(), authority);
    if (state.status === "CLEANUP_ONLY" && (await hasProtectedCleanup({ authority, state }))) {
      validateOuterState(await outerState.completeCleanup(), authority);
      fail("V2_09_COMBINED_CLEANUP_ONLY");
    }
    const executeStatus = state.operations.find(
      ({ id }) => id === "execute-qualified-production",
    )?.status;
    if (state.inner_authority_id && ["STARTED", "COMPLETED"].includes(executeStatus)) {
      const { configuration, inner, combinedExecution } = await reconstructInnerForCleanup({
        authority,
        sourceCommit,
        now,
        state,
        loadConfiguration,
      });
      if (
        !(await hasInnerCleanup({
          authority: inner,
          configuration,
          combinedExecution,
          state,
        }))
      )
        await executeProduction({
          authority: inner,
          configuration,
          mode: "CLEANUP_ONLY",
          sourceCommit,
          combinedExecution,
        });
      await cleanupProtected({ authority, state });
    } else {
      await cleanupStaged({ authority, state });
    }
    validateOuterState(await outerState.completeCleanup(), authority);
    fail("V2_09_COMBINED_CLEANUP_ONLY");
  }
  try {
    validateCombinedAuthority(authority, { sourceCommit, now });
  } catch (error) {
    validateOuterState(await outerState.enterCleanupOnly(), authority);
    throw error;
  }

  const results = {};
  try {
    results["run-read-only-preflight"] = await beginAndRun({
      authority,
      operationId: "run-read-only-preflight",
      outerState,
      run: async () => {
        const apiKey = await loadApiKey();
        if (typeof apiKey !== "string" || apiKey.length < 20)
          fail("V2_09_COMBINED_API_KEY_INVALID");
        return assertPreflight(
          await runPreflight({ expectedSource: authority.source_commit, apiKey }),
          authority,
        );
      },
    });
    const preflight = assertPreflight(results["run-read-only-preflight"], authority);
    results["read-pre-mutation-completion-baseline"] = await beginAndRun({
      authority,
      operationId: "read-pre-mutation-completion-baseline",
      outerState,
      run: () =>
        stageOperation({
          operationId: "read-pre-mutation-completion-baseline",
          authority,
          preflight,
          priorResults: { ...results },
        }),
    });
    assertPreMutationCompletionBaseline(results["read-pre-mutation-completion-baseline"]);
    results["materialize-v209-protected-inputs"] = await beginAndRun({
      authority,
      operationId: "materialize-v209-protected-inputs",
      outerState,
      run: () =>
        stageOperation({
          operationId: "materialize-v209-protected-inputs",
          authority,
          preflight,
          priorResults: { ...results },
        }),
    });
    for (const operationId of COMBINED_PRECOMPLETED_OPERATION_IDS.slice(0, 4)) {
      results[operationId] = await beginAndRun({
        authority,
        operationId,
        outerState,
        run: () =>
          stageOperation({ operationId, authority, preflight, priorResults: { ...results } }),
      });
    }
    results["read-post-migration-completion-baseline"] = await beginAndRun({
      authority,
      operationId: "read-post-migration-completion-baseline",
      outerState,
      run: () =>
        stageOperation({
          operationId: "read-post-migration-completion-baseline",
          authority,
          preflight,
          priorResults: { ...results },
        }),
    });
    assertStableCompletionBaseline(
      results["read-pre-mutation-completion-baseline"],
      results["read-post-migration-completion-baseline"],
    );
    for (const operationId of COMBINED_PRECOMPLETED_OPERATION_IDS.slice(4, 11)) {
      results[operationId] = await beginAndRun({
        authority,
        operationId,
        outerState,
        run: () =>
          stageOperation({ operationId, authority, preflight, priorResults: { ...results } }),
      });
    }
    results["materialize-v209-endpoint-secrets"] = await beginAndRun({
      authority,
      operationId: "materialize-v209-endpoint-secrets",
      outerState,
      run: () =>
        stageOperation({
          operationId: "materialize-v209-endpoint-secrets",
          authority,
          preflight,
          priorResults: { ...results },
        }),
    });
    for (const operationId of COMBINED_PRECOMPLETED_OPERATION_IDS.slice(11)) {
      results[operationId] = await beginAndRun({
        authority,
        operationId,
        outerState,
        run: () =>
          stageOperation({ operationId, authority, preflight, priorResults: { ...results } }),
      });
    }
    results["materialize-v209-postdeploy-chrome-auth"] = await beginAndRun({
      authority,
      operationId: "materialize-v209-postdeploy-chrome-auth",
      outerState,
      run: () =>
        stageOperation({
          operationId: "materialize-v209-postdeploy-chrome-auth",
          authority,
          preflight,
          priorResults: { ...results },
        }),
    });
    results["read-postlogin-tenant-completion-baseline"] = await beginAndRun({
      authority,
      operationId: "read-postlogin-tenant-completion-baseline",
      outerState,
      run: () =>
        stageOperation({
          operationId: "read-postlogin-tenant-completion-baseline",
          authority,
          preflight,
          priorResults: { ...results },
        }),
    });
    const tenantBaseline = results["read-postlogin-tenant-completion-baseline"];
    validateCompletionBaselineReceipt(tenantBaseline, {
      accountId: tenantBaseline?.accountId,
      workspaceId: tenantBaseline?.workspaceId,
      maximumMicroUsd: MAXIMUM_COMPLETION_BASELINE_MICRO_USD,
    });
    if (
      tenantBaseline.completionBaselineMicroUsd >
      results["read-post-migration-completion-baseline"].completionBaselineMicroUsd
    )
      fail("V2_09_COMBINED_TENANT_BASELINE_EXCEEDS_GLOBAL");
    const configuration = await loadConfiguration();
    results["derive-qualified-production-authority"] = await beginAndRun({
      authority,
      operationId: "derive-qualified-production-authority",
      outerState,
      run: async () => ({
        staged_receipts: {
          ...(await materializeStagedReceipts({
            authority,
            preflight,
            baseline: results["read-post-migration-completion-baseline"],
            prefixResults: Object.fromEntries(
              [
                ...COMBINED_PRECOMPLETED_OPERATION_IDS,
                "materialize-v209-postdeploy-chrome-auth",
                "read-postlogin-tenant-completion-baseline",
              ].map((id) => [id, results[id]]),
            ),
            configuration,
          })),
          outer_receipts_sha256: sha256(canonical(results)),
        },
      }),
    });
    const staged = stagedDocument(results, configuration);
    const innerAuthority = deriveQualifiedProductionAuthority(authority, preflight, staged);
    validateAuthority(innerAuthority, { sourceCommit, now });
    state = validateOuterState(await outerState.reconcileSuccess(), authority);
    if (state.inner_authority_id === null) {
      // Bind the derived ID durably before the only mutating inner operation starts.
      const operation = state.operations.find(({ id }) => id === "execute-qualified-production");
      if (operation.status !== "PENDING") fail("V2_09_COMBINED_INNER_ID_BINDING_INVALID");
      state = validateOuterState(
        await outerState.bindInnerAuthority({
          innerAuthorityId: innerAuthority.authority_id,
          innerAuthoritySha256: sha256(canonical(innerAuthority)),
        }),
        authority,
      );
    }
    results["execute-qualified-production"] = await beginAndRun({
      authority,
      operationId: "execute-qualified-production",
      outerState,
      run: () =>
        executeProduction({
          authority: innerAuthority,
          configuration,
          mode: "EXECUTE",
          sourceCommit,
          combinedExecution: combinedExecutionReceipt(
            authority,
            preflight,
            results,
            staged,
            innerAuthority,
          ),
        }),
    });
    assertTerminalExecution(results["execute-qualified-production"], innerAuthority.authority_id);
    try {
      state = validateOuterState(await outerState.completeSuccess(), authority);
    } catch {
      state = validateOuterState(await outerState.reconcileSuccess(), authority);
      if (state.status !== "SUCCEEDED_CLEAN") {
        assertTerminalExecution(
          completedResult(state, "execute-qualified-production"),
          innerAuthority.authority_id,
        );
        try {
          state = validateOuterState(await outerState.completeSuccess(), authority);
        } catch {
          state = validateOuterState(await outerState.reconcileSuccess(), authority);
        }
      }
    }
    if (state.status !== "SUCCEEDED_CLEAN") fail("V2_09_COMBINED_SUCCESS_ACK_UNKNOWN");
    return Object.freeze({
      schema_version: COMBINED_EXECUTION_SCHEMA,
      authority_id: authority.authority_id,
      inner_authority_id: innerAuthority.authority_id,
      status: "SUCCEEDED_CLEAN",
      preflight_proof_sha256: preflight.proofSha256,
      production_execution: results["execute-qualified-production"],
    });
  } catch (error) {
    const latest = validateOuterState(await outerState.reconcileSuccess(), authority);
    const recoveredSuccess = await adoptInnerSuccess(latest);
    if (recoveredSuccess !== null) return recoveredSuccess;
    if (isInteractiveChromePause(error)) {
      const waitingAtChromeAuth =
        latest.inner_authority_id === null &&
        latest.operations.find(({ id }) => id === "materialize-v209-postdeploy-chrome-auth")
          ?.status === "STARTED";
      const waitingInsideExecution =
        latest.inner_authority_id !== null &&
        latest.operations.find(({ id }) => id === "execute-qualified-production")?.status ===
          "STARTED";
      if (!waitingAtChromeAuth && !waitingInsideExecution) throw error;
      const paused = validateOuterState(await outerState.awaitInteractiveChromeLogin(), authority);
      return awaitingChromeReceipt(authority, paused, results["run-read-only-preflight"]);
    }
    if (
      error instanceof Error &&
      /^V2_09_ROLLOUT_FAILED_CLEAN(?::|$)/u.test(error.message) &&
      latest.inner_authority_id !== null
    ) {
      validateOuterState(await outerState.enterCleanupOnly(), authority);
      await cleanupProtected({ authority, state: latest });
      validateOuterState(await outerState.completeCleanup(), authority);
      throw error;
    }
    if (latest.status !== "SUCCEEDED_CLEAN") {
      validateOuterState(await outerState.enterCleanupOnly(), authority);
      const innerStarted = latest.operations.find(
        ({ id }) => id === "execute-qualified-production",
      )?.status;
      if (latest.inner_authority_id && ["STARTED", "COMPLETED"].includes(innerStarted)) {
        const { configuration, inner, combinedExecution } = await reconstructInnerForCleanup({
          authority,
          sourceCommit,
          now,
          state: latest,
          loadConfiguration,
        });
        if (
          !(await hasInnerCleanup({
            authority: inner,
            configuration,
            combinedExecution,
            state: latest,
          }))
        )
          await executeProduction({
            authority: inner,
            configuration,
            mode: "CLEANUP_ONLY",
            sourceCommit,
            combinedExecution,
          });
        await cleanupProtected({ authority, state: latest });
      } else if (
        latest.operations.some(
          ({ id, status }) =>
            (COMBINED_PRECOMPLETED_OPERATION_IDS.includes(id) ||
              id === "materialize-v209-protected-inputs" ||
              id === "materialize-v209-endpoint-secrets") &&
            status !== "PENDING",
        )
      )
        await cleanupStaged({ authority, state: latest });
      validateOuterState(await outerState.completeCleanup(), authority);
    }
    throw error;
  }
}

async function composeCombinedQualifiedProduction(options, dependencies) {
  if (!exactKeys(options, ["authority", "configurationPath", "sourceCommit", "statePath"]))
    fail("V2_09_COMBINED_LIVE_OPTION_INVALID");
  return executeCombinedQualifiedProductionForTest({
    authority: options.authority,
    sourceCommit: options.sourceCommit,
    loadApiKey: () => dependencies.loadApiKey(),
    runPreflight: async ({ expectedSource, apiKey }) => {
      const { head, trackedClean } = await dependencies.gitState();
      return dependencies.runPreflight({ expectedSource, apiKey }, { head, trackedClean });
    },
    stageOperation: dependencies.stageOperation,
    materializeStagedReceipts: dependencies.materializeStagedReceipts,
    loadConfiguration: dependencies.loadConfiguration,
    executeProduction: dependencies.executeProduction,
    cleanupStaged: dependencies.cleanupStaged,
    cleanupProtected: dependencies.cleanupProtected,
    hasProtectedCleanup: dependencies.hasProtectedCleanup,
    hasInnerCleanup: dependencies.hasInnerCleanup,
    readInnerSuccess: dependencies.readInnerSuccess,
    outerState: dependencies.createOuterState(options.statePath),
  });
}

function postgresEnvironment(databaseUrl, path) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("V2_09_COMBINED_DATABASE_URL_INVALID");
  }
  if (
    !new Set(["postgres:", "postgresql:"]).has(parsed.protocol) ||
    !parsed.username ||
    !parsed.hostname
  )
    fail("V2_09_COMBINED_DATABASE_URL_INVALID");
  if (typeof path !== "string" || path.length === 0 || path.includes("\0"))
    fail("V2_09_COMBINED_DATABASE_PATH_INVALID");
  return {
    PATH: path,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: parsed.pathname.slice(1),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: parsed.searchParams.get("sslmode") || "require",
  };
}

async function psqlJson(configuration, urlFile, sql) {
  const { spawnSync } = await import("node:child_process");
  const databaseUrl = securePrivateText(urlFile, "V2_09_COMBINED_DATABASE_URL_INVALID");
  const result = spawnSync(
    "psql",
    ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet", "--tuples-only", "--no-align"],
    {
      cwd: configuration.root,
      encoding: "utf8",
      env: postgresEnvironment(databaseUrl, configuration.environment.PATH),
      input: sql,
    },
  );
  if (result.status !== 0) fail("V2_09_COMBINED_BASELINE_READ_FAILED");
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    fail("V2_09_COMBINED_BASELINE_READ_INVALID");
  }
}

async function psqlJsonWithUrl(configuration, databaseUrl, sql) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    "psql",
    ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet", "--tuples-only", "--no-align"],
    {
      cwd: configuration.root,
      encoding: "utf8",
      env: postgresEnvironment(databaseUrl, configuration.environment.PATH),
      input: sql,
    },
  );
  if (result.status !== 0) fail("V2_09_COMBINED_BASELINE_READ_FAILED");
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    fail("V2_09_COMBINED_BASELINE_READ_INVALID");
  }
}

function stagingAuthority(outer, preflight, baseline, mediaWorker) {
  const completion = baseline?.completionBaselineMicroUsd ?? 0;
  return {
    authority_id: outer.authority_id,
    proposal_sha256: outer.proposal_sha256,
    source_commit: outer.source_commit,
    issued_at: outer.issued_at,
    expires_at: outer.expires_at,
    execution: COMBINED_EXECUTION_MARKER,
    offering: {
      ...outer.offering,
      offering_id_sha256: sha256(
        canonical({
          catalog_sha256: preflight.runpod.offering.catalogSha256,
          gpu: outer.offering.gpu,
          region: outer.offering.region,
        }),
      ),
    },
    caps: {
      billing_baseline_usd: preflight.runpod.billing.cumulativeEndpointBillingUsd,
      billing_stop_usd: preflight.runpod.billing.cumulativeEndpointBillingUsd + INCREMENTAL_CAP_USD,
      incremental_cap_usd: INCREMENTAL_CAP_USD,
      completion_baseline_usd: completion / 1_000_000,
      completion_cap_usd: COMPLETION_CAP_USD,
      completion_stop_usd: completion / 1_000_000 + INCREMENTAL_CAP_USD,
    },
    media_worker: mediaWorker,
    production: { ...outer.production_inputs },
    scope: {
      operations: [...OPERATION_IDS],
      lanes: QUALIFIED_LANES.map((lane) => ({ ...lane })),
      stage_6: "FROZEN_QUALIFIED_NO_RERUN",
      stage_7: "FROZEN_QUALIFIED_NO_RERUN",
      allow_stage_6_or_7_qualification: false,
      allow_v2_10_plus: false,
      allow_redispatch: false,
      cleanup_only_recovery: true,
      allow_image_publication: false,
      allow_gpu_fallback: false,
      allow_region_fallback: false,
      allow_model_download: false,
      allow_retained_volume_mutation: false,
      allow_media_worker_materialization_once: true,
      media_worker_release: "0.1.15",
    },
  };
}

function createLiveMaterializer(
  options,
  loadConfiguration,
  loadMaterializationPlan,
  testDependencies = null,
) {
  let runtime;
  let ownerUrl;
  const readOwnerUrlOnce = async () => {
    if (ownerUrl !== undefined) return ownerUrl;
    const { deriveOwnerDatabaseUrl } = await import("./protected-input-materializer.mjs");
    ownerUrl = deriveOwnerDatabaseUrl(
      (await loadMaterializationPlan()).protected_input_materialization.databaseOwner,
    );
    return ownerUrl;
  };
  const initialize = async (authority, preflight, priorResults, resume = false) => {
    if (runtime) return runtime;
    const configuration = await loadConfiguration();
    const stagingConfiguration = {
      ...configuration,
      journalPath: `${options.statePath}.staging-journal`,
    };
    const { createConcreteQualifiedProductionStagingAdapters } = await import(
      "./concrete-qualified-production-adapters.mjs"
    );
    const adapters = createConcreteQualifiedProductionStagingAdapters(stagingConfiguration);
    const initial = stagingAuthority(authority, preflight, null, authority.media_worker_inputs);
    if (!resume) await adapters.state.claimAuthority({ authority: initial });
    runtime = {
      adapters,
      configuration,
      stagingConfiguration,
      mediaWorker: authority.media_worker_inputs,
      priorResults,
    };
    return runtime;
  };
  const restoreMediaWorker = async (authority, priorResults) => {
    const publication = priorResults["publish-media-worker-0.1.15"];
    if (!publication?.release_manifest_sha256) return authority.media_worker_inputs;
    const { V209_MEDIA_WORKER_ADHOC_SIGNING_IDENTITY_SHA256 } = await import(
      "./media-worker-production-operator.mjs"
    );
    return {
      release: publication.release,
      execution_bundle_sha256: publication.execution_bundle_sha256,
      whisper_model_sha256: publication.whisper_model_sha256,
      release_manifest_sha256: publication.release_manifest_sha256,
      installer_asset_sha256: publication.installer_asset_sha256,
      signing_identity_sha256: V209_MEDIA_WORKER_ADHOC_SIGNING_IDENTITY_SHA256,
    };
  };
  const cleanupProtectedInputs = async (authority) => {
    const configuration = await loadConfiguration();
    const { cleanupV209ProtectedInputs } = await import("./protected-input-materializer.mjs");
    const { spawnSync } = await import("node:child_process");
    await cleanupV209ProtectedInputs({
      authorityId: authority.authority_id,
      configuration,
      materialization: (await loadMaterializationPlan()).protected_input_materialization,
      derivedOwnerUrl: await readOwnerUrlOnce(),
      runPsql: async ({ env, sql }) => {
        const result = spawnSync("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet"], {
          cwd: configuration.root,
          encoding: "utf8",
          env,
          input: sql,
        });
        if (result.status !== 0) fail("V2_09_COMBINED_ROLE_CLEANUP_FAILED");
      },
    });
  };
  return {
    async run({ operationId, authority, preflight, priorResults }) {
      const configuration = await loadConfiguration();
      if (operationId === "read-postlogin-tenant-completion-baseline") {
        const chrome = securePrivateJson(
          configuration.chromeRequestFile,
          "V2_09_COMBINED_CHROME_REQUEST_INVALID",
        );
        const input = {
          accountId: chrome.request?.accountId,
          workspaceId: chrome.request?.workspaceId,
          maximumMicroUsd: MAXIMUM_COMPLETION_BASELINE_MICRO_USD,
        };
        const value = await psqlJson(
          configuration,
          configuration.databaseOperatorUrlFile,
          renderPostMigrationCompletionBaselineSql(input),
        );
        return validateCompletionBaselineReceipt(value, input);
      }
      if (
        [
          "read-pre-mutation-completion-baseline",
          "read-post-migration-completion-baseline",
        ].includes(operationId)
      ) {
        const value = await psqlJsonWithUrl(
          configuration,
          await readOwnerUrlOnce(),
          renderGlobalCompletionBaselineSql(MAXIMUM_COMPLETION_BASELINE_MICRO_USD),
        );
        return validateGlobalCompletionBaselineReceipt(
          value,
          MAXIMUM_COMPLETION_BASELINE_MICRO_USD,
        );
      }
      if (operationId === "materialize-v209-protected-inputs") {
        const { materializeV209ProtectedInputs } = await import(
          "./protected-input-materializer.mjs"
        );
        const { spawnSync } = await import("node:child_process");
        return materializeV209ProtectedInputs({
          authorityId: authority.authority_id,
          configuration,
          materialization: (await loadMaterializationPlan()).protected_input_materialization,
          derivedOwnerUrl: await readOwnerUrlOnce(),
          runPsql: async ({ env, sql }) => {
            const result = spawnSync(
              "psql",
              ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet"],
              { cwd: configuration.root, encoding: "utf8", env, input: sql },
            );
            if (result.status !== 0) fail("V2_09_COMBINED_ROLE_MATERIALIZATION_FAILED");
          },
        });
      }
      if (operationId === "materialize-v209-postdeploy-chrome-auth") {
        // Tenant/workspace and ready preset IDs are intentionally discovered only after the new
        // BETTER_AUTH_SECRET deployment is live. Use the hardened one-step post-deploy bootstrap;
        // the split auth API is only valid when a tenant-bound request was materialized earlier.
        const materializeV209ChromeBootstrap =
          testDependencies?.materializeChromeBootstrap ??
          (await import("./chrome-production-bootstrap.mjs")).materializeV209ChromeBootstrap;
        const result = await materializeV209ChromeBootstrap(
          (await loadMaterializationPlan()).chrome_bootstrap,
          { authorityExpiresAt: authority.expires_at },
        );
        const stagingConfiguration = {
          ...configuration,
          journalPath: `${options.statePath}.staging-journal`,
        };
        const mediaWorker = await restoreMediaWorker(authority, priorResults);
        const staged = stagingAuthority(
          authority,
          preflight,
          priorResults["read-post-migration-completion-baseline"],
          mediaWorker,
        );
        runtime = {
          ...(runtime ?? {}),
          configuration,
          stagingConfiguration,
          mediaWorker,
          priorResults,
          latestAuthority: staged,
          latestResults: priorResults,
        };
        return result;
      }
      const active = await initialize(authority, preflight, priorResults);
      const baseline = priorResults["read-post-migration-completion-baseline"];
      let staged = stagingAuthority(authority, preflight, baseline, active.mediaWorker);
      active.latestAuthority = staged;
      active.latestResults = priorResults;
      if (operationId === "materialize-v209-endpoint-secrets") {
        const deployments = active.adapters.readPersistedDeploymentBindings({
          authority: staged,
          priorResults,
        });
        const { materializeV209EndpointSecrets } = await import(
          "./protected-input-materializer.mjs"
        );
        const result = materializeV209EndpointSecrets({ configuration, deployments });
        const { createConcreteQualifiedProductionDeploymentAdapters } = await import(
          "./concrete-qualified-production-adapters.mjs"
        );
        active.deploymentAdapters = createConcreteQualifiedProductionDeploymentAdapters(
          active.stagingConfiguration,
          { authority: staged, priorResults },
        );
        return result;
      }
      const operation = NORMAL_OPERATIONS.find(({ id }) => id === operationId);
      await active.adapters.state.beginNormalOperation({
        authorityId: authority.authority_id,
        operationId,
        redispatchAllowed: false,
      });
      const orderedPrior = Object.freeze(
        COMBINED_PRECOMPLETED_OPERATION_IDS.filter((id) => priorResults[id] !== undefined).map(
          (id) => [id, priorResults[id]],
        ),
      );
      const operationAdapters = active.deploymentAdapters ?? active.adapters;
      let result = await operationAdapters.operations[operationId]({
        authority: staged,
        operation,
        priorResults: orderedPrior,
        ...(operationId === "render-qualified-production-config"
          ? { receiptBindingMode: "STAGED_OBSERVED" }
          : {}),
      });
      if (operationId === "publish-media-worker-0.1.15" && result.mode === "MATERIALIZED_ONCE") {
        const { validateV209MediaWorkerMaterializationReceipt } = await import(
          "./media-worker-production-operator.mjs"
        );
        active.mediaWorker = validateV209MediaWorkerMaterializationReceipt(
          result.materialization_receipt,
          staged,
          authority.source_commit,
        );
        result = {
          schema_version: "videoforge.v2-09-media-worker-publication-result/v1",
          operation_id: operationId,
          mode: "PUBLISHED_ONCE",
          publish_count: 1,
          release: active.mediaWorker.release,
          execution_bundle_sha256: active.mediaWorker.execution_bundle_sha256,
          whisper_model_sha256: active.mediaWorker.whisper_model_sha256,
          release_manifest_sha256: active.mediaWorker.release_manifest_sha256,
          installer_asset_sha256: active.mediaWorker.installer_asset_sha256,
          immutable_release: true,
        };
        active.latestAuthority = stagingAuthority(
          authority,
          preflight,
          baseline,
          active.mediaWorker,
        );
      }
      await active.adapters.state.completeNormalOperation({
        authorityId: authority.authority_id,
        operationId,
        result,
      });
      return result;
    },
    async receipts({ authority, preflight, baseline, prefixResults, configuration }) {
      const render = prefixResults["render-qualified-production-config"];
      const chromeAuth = prefixResults["materialize-v209-postdeploy-chrome-auth"];
      const tenantBaseline = prefixResults["read-postlogin-tenant-completion-baseline"];
      if (
        !HASH.test(chromeAuth?.auth_state_sha256 ?? "") ||
        !HASH.test(chromeAuth?.chrome_request_sha256 ?? "") ||
        chromeAuth?.generate_clicks !== 0 ||
        chromeAuth?.post_deploy_authentication !== true
      )
        fail("V2_09_COMBINED_POSTDEPLOY_CHROME_RECEIPT_INVALID");
      let active = runtime;
      if (!active) {
        const stagingConfiguration = {
          ...configuration,
          journalPath: `${options.statePath}.staging-journal`,
        };
        const mediaWorker = await restoreMediaWorker(authority, prefixResults);
        active = runtime = {
          configuration,
          stagingConfiguration,
          mediaWorker,
          priorResults: prefixResults,
          latestAuthority: stagingAuthority(authority, preflight, baseline, mediaWorker),
          latestResults: prefixResults,
        };
      }
      if (!active.resumedAdapters) {
        const createResumedAdapters =
          testDependencies?.createResumedAdapters ??
          (await import("./concrete-qualified-production-adapters.mjs"))
            .createConcreteQualifiedProductionResumedAdapters;
        active.resumedAdapters = createResumedAdapters(active.stagingConfiguration, {
          authority: active.latestAuthority,
          priorResults: active.latestResults,
        });
      }
      const makeReceipt = (value) => ({ ...value, receipt_sha256: sha256(canonical(value)) });
      const lanes = QUALIFIED_LANES.map((lane) =>
        makeReceipt({
          schema_version: LANE_RECEIPT_SCHEMA,
          preflight_proof_sha256: preflight.proofSha256,
          lane: lane.lane,
          qualified_lane: { ...lane },
        }),
      );
      const derivedAdapters = active.resumedAdapters;
      if (!derivedAdapters) fail("V2_09_COMBINED_FINAL_ADAPTER_MISSING");
      return {
        schema_version: STAGED_RECEIPTS_SCHEMA,
        media_release: makeReceipt({
          schema_version: MEDIA_RECEIPT_SCHEMA,
          preflight_proof_sha256: preflight.proofSha256,
          ...active.mediaWorker,
        }),
        lanes,
        production: makeReceipt({
          schema_version: PRODUCTION_RECEIPT_SCHEMA,
          preflight_proof_sha256: preflight.proofSha256,
          protected_static_inputs: { ...authority.production_inputs },
          config_sha256: render.config_sha256,
          worker_bundle_sha256: render.worker_bundle_sha256,
          chrome_auth_state_sha256: chromeAuth.auth_state_sha256,
          chrome_request_sha256: chromeAuth.chrome_request_sha256,
        }),
        adapter: makeReceipt({
          adapter_set_sha256: derivedAdapters.identity_sha256,
          preflight_proof_sha256: preflight.proofSha256,
        }),
        baseline: makeReceipt({
          schema_version: BILLING_RECEIPT_SCHEMA,
          preflight_proof_sha256: preflight.proofSha256,
          billing_baseline_usd: preflight.runpod.billing.cumulativeEndpointBillingUsd,
          billing_rows_sha256: preflight.runpod.billing.rowsSha256,
          completion_baseline_derivation: COMPLETION_BASELINE_DERIVATION,
          global_completion_baseline_derivation: GLOBAL_COMPLETION_BASELINE_DERIVATION,
          completion_baseline_receipt_sha256: tenantBaseline.receiptSha256,
          global_completion_baseline_receipt_sha256: baseline.receiptSha256,
          completion_baseline_usd: tenantBaseline.completionBaselineMicroUsd / 1_000_000,
        }),
      };
    },
    cleanupProtected({ authority }) {
      return cleanupProtectedInputs(authority);
    },
    async hasProtectedCleanup({ authority }) {
      const { hasV209ProtectedInputCleanup } = await import("./protected-input-materializer.mjs");
      return hasV209ProtectedInputCleanup({
        authorityId: authority.authority_id,
        configuration: await loadConfiguration(),
        materialization: (await loadMaterializationPlan()).protected_input_materialization,
      });
    },
    async hasInnerCleanup({ authority, configuration, combinedExecution }) {
      const { hasV209InnerFailedClean } = await import(
        "./concrete-qualified-production-adapters.mjs"
      );
      return hasV209InnerFailedClean({
        configuration: {
          ...configuration,
          journalPath: `${options.statePath}.staging-journal`,
        },
        executionAuthority: authority,
        journalAuthorityId: combinedExecution.outer_authority_id,
        combinedExecution,
        priorResults: Object.fromEntries(
          combinedExecution.operations.map(({ operation_id, result }) => [operation_id, result]),
        ),
      });
    },
    async readInnerSuccess({ authority, configuration, combinedExecution }) {
      const { readV209InnerSucceededClean } = await import(
        "./concrete-qualified-production-adapters.mjs"
      );
      return readV209InnerSucceededClean({
        configuration: {
          ...configuration,
          journalPath: `${options.statePath}.staging-journal`,
        },
        executionAuthority: authority,
        journalAuthorityId: combinedExecution.outer_authority_id,
        combinedExecution,
        priorResults: Object.fromEntries(
          combinedExecution.operations.map(({ operation_id, result }) => [operation_id, result]),
        ),
      });
    },
    async cleanup({ authority, state }) {
      const protectedInputOperation = state.operations.find(
        ({ id }) => id === "materialize-v209-protected-inputs",
      );
      if (protectedInputOperation?.status === "STARTED") {
        // No later operation can have started. Reconcile the possibly partial role/file write
        // directly because a staging adapter cannot safely snapshot incomplete protected inputs.
        await cleanupProtectedInputs(authority);
        return;
      }
      if (!runtime) {
        const results = Object.fromEntries(
          state.operations
            .filter(({ result }) => result !== null)
            .map(({ id, result }) => [id, result]),
        );
        const preflight = results["run-read-only-preflight"];
        if (!preflight) return;
        const active = await initialize(authority, preflight, results, true);
        const publication = results["publish-media-worker-0.1.15"];
        if (publication?.release_manifest_sha256) {
          const { V209_MEDIA_WORKER_ADHOC_SIGNING_IDENTITY_SHA256 } = await import(
            "./media-worker-production-operator.mjs"
          );
          active.mediaWorker = {
            release: publication.release,
            execution_bundle_sha256: publication.execution_bundle_sha256,
            whisper_model_sha256: publication.whisper_model_sha256,
            release_manifest_sha256: publication.release_manifest_sha256,
            installer_asset_sha256: publication.installer_asset_sha256,
            signing_identity_sha256: V209_MEDIA_WORKER_ADHOC_SIGNING_IDENTITY_SHA256,
          };
        }
        active.latestAuthority = stagingAuthority(
          authority,
          preflight,
          results["read-post-migration-completion-baseline"],
          active.mediaWorker,
        );
        active.latestResults = results;
        if (results["materialize-v209-endpoint-secrets"]) {
          const { createConcreteQualifiedProductionDeploymentAdapters } = await import(
            "./concrete-qualified-production-adapters.mjs"
          );
          active.deploymentAdapters = createConcreteQualifiedProductionDeploymentAdapters(
            active.stagingConfiguration,
            { authority: active.latestAuthority, priorResults: results },
          );
        }
      }
      if (
        !runtime.deploymentAdapters &&
        runtime.latestResults?.["materialize-v209-endpoint-secrets"]
      ) {
        const { createConcreteQualifiedProductionDeploymentAdapters } = await import(
          "./concrete-qualified-production-adapters.mjs"
        );
        runtime.deploymentAdapters = createConcreteQualifiedProductionDeploymentAdapters(
          runtime.stagingConfiguration,
          { authority: runtime.latestAuthority, priorResults: runtime.latestResults },
        );
      }
      if (runtime.deploymentAdapters)
        await runtime.deploymentAdapters.cleanupDeploymentSuffix({
          authority: runtime.latestAuthority,
        });
      else await runtime.adapters.cleanupStagedRunPod({ authority: runtime.latestAuthority });
      // Keep credentials available until every independent Cloudflare/database/RunPod cleanup
      // attempt has completed. This also removes partial endpoint-secret files from a crashed seal.
      if (protectedInputOperation?.status === "COMPLETED") await cleanupProtectedInputs(authority);
    },
  };
}

export function createLiveMaterializerForTest({
  options,
  loadConfiguration,
  loadMaterializationPlan,
  createResumedAdapters,
  materializeChromeBootstrap,
  testOnly,
}) {
  if (
    testOnly !== true ||
    typeof loadConfiguration !== "function" ||
    typeof loadMaterializationPlan !== "function" ||
    typeof createResumedAdapters !== "function" ||
    (materializeChromeBootstrap !== undefined && typeof materializeChromeBootstrap !== "function")
  )
    fail("V2_09_COMBINED_MATERIALIZER_TEST_INJECTION_FORBIDDEN");
  return createLiveMaterializer(options, loadConfiguration, loadMaterializationPlan, {
    createResumedAdapters,
    materializeChromeBootstrap,
  });
}

export async function executeCombinedQualifiedProduction(options) {
  let materializationPlan;
  let configuration;
  const loadMaterializationPlan = async () => {
    if (materializationPlan === undefined) {
      materializationPlan = securePrivateJson(
        options.configurationPath,
        "V2_09_COMBINED_MATERIALIZATION_PLAN_INVALID",
      );
      if (
        !exactKeys(materializationPlan, [
          "chrome_bootstrap",
          "production_configuration",
          "protected_input_materialization",
          "schema_version",
        ]) ||
        materializationPlan.schema_version !==
          "videoforge.v2-09-combined-materialization-plan/v1" ||
        typeof materializationPlan.production_configuration?.runpodApiKeyFile !== "string" ||
        materializationPlan.production_configuration.runpodApiKeyFile !==
          materializationPlan.protected_input_materialization?.reusableSecretFiles
            ?.RUNPOD_API_KEY ||
        sha256(
          canonical({
            production_configuration: materializationPlan.production_configuration,
            protected_input_materialization: materializationPlan.protected_input_materialization,
          }),
        ) !== options.authority.production_inputs.materialization_input_sha256 ||
        sha256(canonical(materializationPlan.chrome_bootstrap)) !==
          options.authority.production_inputs.chrome_bootstrap_plan_sha256
      )
        fail("V2_09_COMBINED_MATERIALIZATION_PLAN_INVALID");
    }
    return materializationPlan;
  };
  const loadConfiguration = async () => {
    if (configuration === undefined) {
      configuration = (await loadMaterializationPlan()).production_configuration;
    }
    return configuration;
  };
  const materializer = createLiveMaterializer(options, loadConfiguration, loadMaterializationPlan);
  // Reject a plan that points preflight at a future materialized copy before claiming the
  // single-use authority. Preflight and materialization must share the exact approved source.
  await loadMaterializationPlan();
  return composeCombinedQualifiedProduction(options, {
    loadApiKey: async () => secureApiKey((await loadConfiguration()).runpodApiKeyFile),
    runPreflight: runV209ReadOnlyPreflight,
    executeProduction: (context) =>
      executeQualifiedProduction({
        ...context,
        configuration: {
          ...context.configuration,
          journalPath: `${options.statePath}.staging-journal`,
        },
      }),
    createOuterState: createDurableOuterState,
    stageOperation: (context) => materializer.run(context),
    materializeStagedReceipts: (context) => materializer.receipts(context),
    loadConfiguration,
    cleanupStaged: (context) => materializer.cleanup(context),
    cleanupProtected: (context) => materializer.cleanupProtected(context),
    hasProtectedCleanup: (context) => materializer.hasProtectedCleanup(context),
    hasInnerCleanup: (context) => materializer.hasInnerCleanup(context),
    readInnerSuccess: (context) => materializer.readInnerSuccess(context),
    async gitState() {
      const { spawnSync } = await import("node:child_process");
      const head = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: ROOT,
        encoding: "utf8",
        shell: false,
      });
      const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
        cwd: ROOT,
        encoding: "utf8",
        shell: false,
      });
      if (head.status !== 0 || status.status !== 0) fail("V2_09_COMBINED_GIT_READ_FAILED");
      return { head: head.stdout.trim(), trackedClean: status.stdout.trim() === "" };
    },
  });
}

export async function executeCombinedQualifiedProductionWithDependenciesForTest(
  options,
  dependencies,
) {
  if (
    dependencies?.testOnlyInjectedDependencies !== true ||
    [
      "loadApiKey",
      "runPreflight",
      "executeProduction",
      "createOuterState",
      "gitState",
      "stageOperation",
      "materializeStagedReceipts",
      "loadConfiguration",
      "cleanupStaged",
      "cleanupProtected",
      "hasProtectedCleanup",
      "hasInnerCleanup",
      "readInnerSuccess",
    ].some((key) => typeof dependencies[key] !== "function")
  )
    fail("V2_09_COMBINED_TEST_DEPENDENCY_INJECTION_FORBIDDEN");
  const injected = { ...dependencies };
  delete injected.testOnlyInjectedDependencies;
  return composeCombinedQualifiedProduction(options, injected);
}

export async function main(argv = process.argv.slice(2)) {
  const expected = ["--authority", "--configuration", "--state"];
  if (argv.length !== expected.length * 2) fail("V2_09_COMBINED_LIVE_ARGUMENTS_INVALID");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!expected.includes(argv[index]) || values.has(argv[index]))
      fail("V2_09_COMBINED_LIVE_ARGUMENTS_INVALID");
    values.set(argv[index], argv[index + 1]);
  }
  if (values.size !== expected.length) fail("V2_09_COMBINED_LIVE_ARGUMENTS_INVALID");
  const authority = securePrivateJson(
    values.get("--authority"),
    "V2_09_COMBINED_AUTHORITY_FILE_INVALID",
  );
  const result = await executeCombinedQualifiedProduction({
    authority,
    sourceCommit: authority.source_commit,
    configurationPath: values.get("--configuration"),
    statePath: values.get("--state"),
  });
  process.stdout.write(`${canonical(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "V2_09_COMBINED_FAILED"}\n`);
    process.exitCode = 1;
  });
}
