#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  authorizeCleanupWork,
  authorizeReleaseCertification,
  authorizeWork,
  beginPhase,
  completeCleanupOnly,
  completePhase,
  enterCleanupOnly,
  PHASES,
  recordCleanupProof,
  recordSettledResult,
  recordVerifiedReleaseRef,
  settleWork,
  settleCleanupWork,
  settleReleaseCertification,
  updateState,
  MATERIALIZATION_SEED_ENV,
  STATIC_RELEASE_DESCRIPTOR_ENV,
  validateMaterializationSeedFile,
  validateStaticReleaseDescriptorFile,
  validateState,
  FAILURE_BOUNDARY,
  FAILURE_CODE,
} from "./full-live-orchestration-authority.mjs";
import {
  createConcreteFullLiveAdapters,
  preflightConcreteFullLiveInputs,
  readAuthenticatedGithubTime,
  verifyPrequalificationDatabaseReceipt,
  verifyMaterializationChainFile,
} from "./full-live-adapters.mjs";
import { EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR } from "./validate-full-live-approval.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const EXECUTOR_PATH = "deploy/v2-13/full-live-executor.mjs";
const EXECUTOR_SHA256 = `sha256:${createHash("sha256")
  .update(readFileSync(resolve(ROOT, EXECUTOR_PATH)))
  .digest("hex")}`;
const CONFIRMATION = "EXECUTE_EXACT_V2_13_FULL_LIVE_ONCE";
const APPROVAL_BRANCH = "codex/serverless-v2-roadmap-v4";
const HASH = /^sha256:[0-9a-f]{64}$/u;
const EXACT_DATABASE_IDENTITY_SHA256 =
  "sha256:7f2c802c531f4e5630d6a15b2f26bf65ea04f599b28c19fc3daa5d741c7567d7";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PREQUALIFICATION_SCHEMA = "videoforge.v213-prequalification-database-bootstrap-result/v3";
const PREQUALIFICATION_RECOVERY_MODES = new Set([
  "FRESH_36_TO_45",
  "RESUME_EXACT_PREFIX",
  "VERIFIED_EXISTING_45",
]);
const SOURCE_PINS = Object.freeze({
  "deploy/v2-13/full-live-adapters.mjs":
    "sha256:3d7e6f2dfb320b2fe4f2f36a17bcd8b53b39ad8f271e0c60928ec7d6069033e0",
  "deploy/v2-13/promote-qualified-production.mjs":
    "sha256:2cf4cf6b13c387542a2f3c380d38c519470655aebac237edeca1b2e77f9697d2",
  "deploy/v2-13/guarded-activation.mjs":
    "sha256:7522808e31aa83d92bd5d8bcdc768438ba11ce5cd69f6fd8be45e0671148fa85",
  "apps/web/src/server/providers/v213-full-live-cli.ts":
    "sha256:7fb8b3647dc44d26b0e49c5a0fa206c4e98e4653fbbfe88f990ec0eb6f4890c0",
  "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts":
    "sha256:1982c450b215978528e9688cba62df07f94e014e55e007ec32f0f38500a965c2",
  "packages/control-plane/migrations/0045_hosted_full_live_activation.sql":
    "sha256:1365c546595f57aaca61950c39f0f52c44986dab2543d21eb60b5773af12929b",
  "deploy/v2-13/neon-full-live-operator-grants.sql":
    "sha256:38c80de06ef6eff67a03be35326150cf742393efc07fd43ea0b30780c28afab6",
  "packages/control-plane/migrations/manifest.json":
    "sha256:43f10592907b027afb870d2beb906e91998319da50f07fca7f64ed310fa1db47",
  "deploy/v2-13/full-live-source-closure.json":
    "sha256:4d348ad85f803ad36ea3c3e3df54dfb601af45e308bfd55282c1d9ed1340433b",
});
for (const [path, expected] of Object.entries(SOURCE_PINS)) {
  const actual = `sha256:${createHash("sha256")
    .update(readFileSync(resolve(ROOT, path)))
    .digest("hex")}`;
  if (actual !== expected) throw new Error(`V2_13_FULL_LIVE_EXECUTOR_SOURCE_DRIFT:${path}`);
}
export function validateFullLiveSourceClosure({
  root = ROOT,
  manifestPath = "deploy/v2-13/full-live-source-closure.json",
} = {}) {
  const sourceClosure = JSON.parse(readFileSync(resolve(root, manifestPath), "utf8"));
  if (
    sourceClosure?.schema_version !== "videoforge.v2-13-full-live-source-closure/v1" ||
    !Array.isArray(sourceClosure.entries) ||
    Object.keys(sourceClosure).sort().join(",") !== "entries,schema_version"
  )
    throw new Error("V2_13_FULL_LIVE_SOURCE_CLOSURE_INVALID");
  let priorClosurePath = "";
  for (const entry of sourceClosure.entries) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Object.keys(entry).sort().join(",") !== "path,sha256" ||
      typeof entry.path !== "string" ||
      !/^[.A-Za-z0-9][A-Za-z0-9.$_/-]{1,319}$/u.test(entry.path) ||
      entry.path.includes("..") ||
      entry.path <= priorClosurePath ||
      !HASH.test(entry.sha256)
    )
      throw new Error("V2_13_FULL_LIVE_SOURCE_CLOSURE_INVALID");
    const actual = `sha256:${createHash("sha256")
      .update(readFileSync(resolve(root, entry.path)))
      .digest("hex")}`;
    if (actual !== entry.sha256)
      throw new Error(`V2_13_FULL_LIVE_SOURCE_CLOSURE_DRIFT:${entry.path}`);
    priorClosurePath = entry.path;
  }
  return sourceClosure.entries.length;
}

validateFullLiveSourceClosure();

// This is the only ordered live execution graph. A catalog entry is not executable until a
// concrete, reviewed adapter exists below. Missing adapters fail before authority consumption or
// any external action; arbitrary shell commands cannot be supplied at runtime.
const OPERATIONS = Object.freeze([
  { phase: "publication", id: "release-tag-create", reserveUsd: 0 },
  { phase: "publication", id: "release-tag-push", reserveUsd: 0 },
  { phase: "publication", id: "release-tag-readback", reserveUsd: 0 },
  { phase: "publication", id: "approval-commit-push", reserveUsd: 0 },
  { phase: "publication", id: "mage-image-workflow-dispatch", reserveUsd: 0 },
  { phase: "publication", id: "mage-image-workflow-verification", reserveUsd: 0 },
  { phase: "publication", id: "soulx-image-workflow-dispatch", reserveUsd: 0 },
  { phase: "publication", id: "soulx-image-workflow-verification", reserveUsd: 0 },
  {
    phase: "bootstrap_prequalification_database",
    id: "bootstrap-prequalification-database",
    reserveUsd: 0,
  },
  { phase: "mage_qualification", id: "fresh-live-preflight", reserveUsd: 0 },
  { phase: "mage_qualification", id: "mage-live-qualification", reserveUsd: 4.5 },
  { phase: "soulx_qualification", id: "soulx-live-qualification", reserveUsd: 1 },
  {
    phase: "max_one_control_plane_and_guarded_activation",
    id: "create-exact-max-one-endpoints",
    reserveUsd: 0,
  },
  {
    phase: "max_one_control_plane_and_guarded_activation",
    id: "guarded-activation-once",
    reserveUsd: 0,
  },
  {
    phase: "max_one_control_plane_and_guarded_activation",
    id: "promote-qualified-production",
    reserveUsd: 0,
  },
  {
    phase: "max_one_control_plane_and_guarded_activation",
    id: "record-workflow-start-authority",
    reserveUsd: 0,
  },
  { phase: "v2_09_short_hosted_project", id: "v2-09-short-hosted-project", reserveUsd: 2 },
  {
    phase: "v2_10_operator_free_ranga_pilot",
    id: "v2-10-operator-free-ranga-pilot",
    reserveUsd: 2,
  },
  {
    phase: "v2_11_two_concurrent_owned_projects",
    id: "v2-11-two-concurrent-owned-projects",
    reserveUsd: 4,
  },
  { phase: "v2_12_long_output", id: "v2-12-long-output", reserveUsd: 2 },
  {
    phase: "v2_13_final_two_lane_smoke",
    id: "v2-13-final-two-lane-smoke",
    reserveUsd: 2,
  },
  { phase: "cleanup_and_reconciliation", id: "restore-endpoints-max-one", reserveUsd: 0 },
  { phase: "cleanup_and_reconciliation", id: "prove-zero-workers", reserveUsd: 0 },
  { phase: "cleanup_and_reconciliation", id: "read-settled-billing", reserveUsd: 0 },
  { phase: "cleanup_and_reconciliation", id: "reconcile-exact-resources", reserveUsd: 0 },
  { phase: "cleanup_and_reconciliation", id: "certify-v2-13-release", reserveUsd: 0 },
]);

const RELEASE_CERTIFICATION_OPERATION_ID = "certify-v2-13-release";
const RELEASE_CERTIFICATION_PREDECESSORS = Object.freeze([
  ["v2-13-final-two-lane-smoke", "signedSmokeEvidenceSha256"],
  ["restore-endpoints-max-one", "proofSha256"],
  ["prove-zero-workers", "proofSha256"],
  ["read-settled-billing", "proofSha256"],
  ["reconcile-exact-resources", "proofSha256"],
]);
const RELEASE_CERTIFICATION_RESULT_SCHEMA = "videoforge.v213-final-release-certification-result/v1";
const V213_SMOKE_RESULT_SCHEMA = "videoforge.v213-fresh-two-lane-smoke-result/v1";
const CLEANUP_SAFETY_OPERATION_IDS = new Set([
  "restore-endpoints-max-one",
  "prove-zero-workers",
  "read-settled-billing",
  "reconcile-exact-resources",
]);

// The early cleanup child is a no-op only while the graph has not crossed a RunPod mutation
// boundary.  A durable authorization record is itself enough to make that boundary unknown: the
// process may have reached the provider before it failed, so cleanup must use the normal
// operator-backed path and prove the provider state instead of claiming an empty no-op proof.
const RUNPOD_MUTATION_OPERATION_IDS = new Set([
  "mage-live-qualification",
  "soulx-live-qualification",
  "create-exact-max-one-endpoints",
  "v2-09-short-hosted-project",
  "v2-10-operator-free-ranga-pilot",
  "v2-11-two-concurrent-owned-projects",
  "v2-12-long-output",
  "v2-13-final-two-lane-smoke",
]);

function runPodMutationBoundaryReached(state) {
  if (state === null || typeof state !== "object") return true;
  for (const operation of OPERATIONS) {
    if (!RUNPOD_MUTATION_OPERATION_IDS.has(operation.id)) continue;
    const workId = `${state.authority_id}:${operation.id}`.toLowerCase();
    if (state.phases?.[operation.phase]?.work?.[workId] !== undefined) return true;
  }
  return false;
}

function canUseEarlyCleanup(state) {
  return state?.operator_role_verified !== true && !runPodMutationBoundaryReached(state);
}

function requiresBootstrapPartialCleanup(state) {
  if (state?.operator_role_verified === true) return false;
  const workId = `${state?.authority_id}:bootstrap-prequalification-database`.toLowerCase();
  return (
    state?.phases?.bootstrap_prequalification_database?.work?.[workId]?.state ===
    "AUTHORIZED_ONCE_NOT_REDISPATCHABLE"
  );
}

function cleanupModeFor(state) {
  if (!canUseEarlyCleanup(state)) return "NORMAL_OPERATOR_CLEANUP";
  return requiresBootstrapPartialCleanup(state)
    ? "BOOTSTRAP_PARTIAL_CLEANUP"
    : "EARLY_NO_DATABASE_CLEANUP";
}

// Guarded activation is real, but it cannot safely run before the preceding image, qualification,
// endpoint, and evidence adapters exist. Keep the closed-world live surface empty until all of the
// graph is callable and independently reviewed.
const CONCRETE_LIVE_ADAPTERS = createConcreteFullLiveAdapters();

const fail = (code, detail = "") => {
  throw new Error(`V2_13_FULL_LIVE_EXECUTOR_${code}${detail ? `:${detail}` : ""}`);
};

const FAILURE_BOUNDARIES = Object.freeze({
  initialStaticReleaseDescriptor: "INITIAL_STATIC_RELEASE_DESCRIPTOR",
  initialMaterializationSeed: "INITIAL_MATERIALIZATION_SEED",
  initialPreflight: "INITIAL_PREFLIGHT",
  preOperationTrustedTime: "PRE_OPERATION_TRUSTED_TIME",
  phaseMutationTrustedTime: "PHASE_MUTATION_TRUSTED_TIME",
  operationStaticReleaseDescriptor: "OPERATION_STATIC_RELEASE_DESCRIPTOR",
  operationMaterializationSeed: "OPERATION_MATERIALIZATION_SEED",
  operationAuthorization: "OPERATION_AUTHORIZATION",
  operationExecution: "OPERATION_EXECUTION",
  operationResultValidation: "OPERATION_RESULT_VALIDATION",
  settledResultHydration: "SETTLED_RESULT_HYDRATION",
  materializationChainVerification: "MATERIALIZATION_CHAIN_VERIFICATION",
  bootstrapReconciliation: "BOOTSTRAP_RECONCILIATION",
  stagedPreflight: "STAGED_PREFLIGHT",
  cleanupPreflight: "CLEANUP_PREFLIGHT",
  cleanupProof: "CLEANUP_PROOF",
  certificationStaticReleaseDescriptor: "CERTIFICATION_STATIC_RELEASE_DESCRIPTOR",
  certificationMaterializationSeed: "CERTIFICATION_MATERIALIZATION_SEED",
  certificationTrustedTime: "CERTIFICATION_TRUSTED_TIME",
  certificationAuthorization: "CERTIFICATION_AUTHORIZATION",
  certificationExecution: "CERTIFICATION_EXECUTION",
  certificationResultValidation: "CERTIFICATION_RESULT_VALIDATION",
});

const SAFE_ERROR_PREFIXES = Object.freeze([
  "V2_13_FULL_LIVE_EXECUTOR_",
  "V2_13_FULL_LIVE_ORCHESTRATION_",
  "V2_13_FULL_LIVE_ADAPTER_",
  "V2_13_FULL_LIVE_APPROVAL_",
  "V2_13_QUALIFIED_PROMOTION_",
]);

/**
 * Return only a bounded internal code.  Exception text is intentionally never returned: adapter
 * and child-process errors may include paths, provider bodies, IDs, or credential material.  A
 * code produced by one of the reviewed VideoForge prefixes is safe after its detail suffix is
 * removed; everything else is represented by the caller's stable fallback category.
 */
export function boundedFailureCode(error, fallbackCode = "UNCLASSIFIED_FAILURE") {
  const message = typeof error?.message === "string" ? error.message : "";
  for (const prefix of SAFE_ERROR_PREFIXES) {
    if (!message.startsWith(prefix)) continue;
    const candidate = message.slice(prefix.length).split(":", 1)[0];
    if (FAILURE_CODE.test(candidate)) return candidate;
  }
  return FAILURE_CODE.test(fallbackCode) ? fallbackCode : "UNCLASSIFIED_FAILURE";
}

const eventId = (authorityId, operationId, suffix) =>
  `${authorityId}:${operationId}:${suffix}`.toLowerCase();

function missingConcreteTools(adapters = CONCRETE_LIVE_ADAPTERS) {
  return OPERATIONS.filter((operation) => typeof adapters[operation.id] !== "function").map(
    (operation) => operation.id,
  );
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

const canonicalSha256 = (value) =>
  `sha256:${createHash("sha256")
    .update(Buffer.from(canonicalJson(value)))
    .digest("hex")}`;

/** The final certification consumes only current-run, already-settled evidence. This check runs
 * before its zero-spend adapter is invoked, so a missing or ambiguous receipt cannot cause even a
 * read-only certification dispatch. */
export function certificationPredecessorEvidence(results) {
  const evidence = {};
  for (const [operationId, field] of RELEASE_CERTIFICATION_PREDECESSORS) {
    const result = results.get(operationId);
    const sha256 = result?.[field];
    if (!HASH.test(sha256 ?? "")) fail("CERTIFICATION_PREDECESSOR", operationId);
    evidence[operationId] = sha256;
  }
  const smoke = results.get("v2-13-final-two-lane-smoke");
  const restoration = results.get("restore-endpoints-max-one");
  if (
    smoke?.schemaVersion !== V213_SMOKE_RESULT_SCHEMA ||
    smoke.smokeOnly !== true ||
    smoke.releaseCertified !== false ||
    smoke.twoLaneSmoke !== true ||
    smoke.evidenceSha256 !== smoke.signedSmokeEvidenceSha256 ||
    results.get("prove-zero-workers")?.zeroWorkers !== true ||
    results.get("read-settled-billing")?.withinCumulativeCap !== true ||
    results.get("reconcile-exact-resources")?.onlyApprovedRetainedVolumes !== true ||
    restoration?.productionCleanupState !== "EXACT_MAX_ONE_PAIR_RETAINED" ||
    restoration.bothEndpointsMaxWorkersOne !== true ||
    restoration.retainedProductionEndpoints !== 2 ||
    restoration.productionResourcesAbsent !== false
  )
    fail("CERTIFICATION_PREDECESSOR_STATE");
  return Object.freeze(evidence);
}

export function cleanupProofEvidence(results) {
  const zero = results.get("prove-zero-workers");
  const billing = results.get("read-settled-billing");
  const resources = results.get("reconcile-exact-resources");
  const maxOne = results.get("restore-endpoints-max-one");
  if (
    !HASH.test(zero?.proofSha256 ?? "") ||
    zero?.zeroWorkers !== true ||
    !HASH.test(billing?.proofSha256 ?? "") ||
    billing?.withinCumulativeCap !== true ||
    !HASH.test(resources?.proofSha256 ?? "") ||
    resources?.onlyApprovedRetainedVolumes !== true ||
    !HASH.test(maxOne?.proofSha256 ?? "") ||
    !(
      (maxOne?.productionCleanupState === "EXACT_MAX_ONE_PAIR_RETAINED" &&
        maxOne?.bothEndpointsMaxWorkersOne === true &&
        maxOne?.retainedProductionEndpoints === 2 &&
        maxOne?.productionResourcesAbsent === false) ||
      (maxOne?.productionCleanupState === "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT" &&
        maxOne?.bothEndpointsMaxWorkersOne === false &&
        maxOne?.retainedProductionEndpoints === 0 &&
        maxOne?.productionResourcesAbsent === true)
    )
  )
    fail("CLEANUP_PROOF_READBACK");
  return Object.freeze({ zero, billing, resources, maxOne });
}

export function assertResult(
  operation,
  result,
  state,
  results,
  { authorizedOuterStateSha256 } = {},
) {
  if (result === null || typeof result !== "object" || Array.isArray(result))
    fail("RESULT_CONTRACT", operation.id);
  if (
    typeof result.actualUsd !== "number" ||
    !Number.isFinite(result.actualUsd) ||
    result.actualUsd < 0 ||
    result.actualUsd > operation.reserveUsd
  )
    fail("RESULT_COST", operation.id);

  if (operation.id === "release-tag-create") {
    if (
      result.exactTagReady !== true ||
      result.targetCommit !== state.release_ref.exact_target_commit ||
      (state.release_ref.mode === "PREDECESSOR_BOUND_RECONCILIATION_ONLY" &&
        (result.created !== false || result.mutationPerformed !== false))
    )
      fail("RELEASE_REF_CREATE", operation.id);
  }
  if (operation.id === "release-tag-push") {
    if (
      result.tagName !== state.release_ref.exact_tag_name ||
      result.targetCommit !== state.release_ref.exact_target_commit ||
      typeof result.pushPerformed !== "boolean" ||
      (state.release_ref.mode === "PREDECESSOR_BOUND_RECONCILIATION_ONLY" &&
        (result.pushPerformed !== false || result.mutationPerformed !== false)) ||
      result.forceUsed !== false
    )
      fail("RELEASE_REF_PUSH", operation.id);
  }
  if (operation.id === "release-tag-readback") {
    if (
      result.tagName !== state.release_ref.exact_tag_name ||
      result.targetCommit !== state.release_ref.exact_target_commit ||
      (state.release_ref.mode === "PREDECESSOR_BOUND_RECONCILIATION_ONLY" &&
        result.mutationPerformed !== false)
    )
      fail("RELEASE_REF_READBACK", operation.id);
  }
  if (operation.id === "approval-commit-push") {
    if (
      result.commit !== state.authority_record_commit ||
      result.exactRemoteReadback !== true ||
      result.branch !== APPROVAL_BRANCH
    )
      fail("APPROVAL_COMMIT_READBACK", operation.id);
  }
  if (operation.id.endsWith("image-workflow-dispatch")) {
    if (
      !/^[1-9][0-9]*$/u.test(String(result.runId ?? "")) ||
      result.headSha !== state.release_source_commit ||
      result.dispatchAccepted !== true
    )
      fail("WORKFLOW_DISPATCH_READBACK", operation.id);
  }
  if (operation.id.endsWith("image-workflow-verification")) {
    const dispatchId = operation.id.replace("verification", "dispatch");
    const dispatch = results.get(dispatchId);
    if (
      result.runId !== dispatch?.runId ||
      result.headSha !== state.release_source_commit ||
      !HASH.test(result.imageDigest ?? "") ||
      !HASH.test(result.evidenceSha256 ?? "") ||
      !HASH.test(result.publicManifestSha256 ?? "") ||
      result.publicAllBlobsVerified !== true ||
      result.conclusion !== "success"
    )
      fail("WORKFLOW_EVIDENCE_READBACK", operation.id);
  }
  if (operation.id === "fresh-live-preflight") {
    if (
      result.exactGpu !== "NVIDIA GeForce RTX 4090" ||
      result.region !== "EU-RO-1" ||
      !["LOW", "MEDIUM", "HIGH"].includes(result.availability) ||
      typeof result.flexUsdPerGpuHour !== "number" ||
      !Number.isFinite(result.flexUsdPerGpuHour) ||
      result.flexUsdPerGpuHour < 0 ||
      result.flexUsdPerGpuHour > EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR ||
      result.noFallback !== true ||
      !HASH.test(result.inventorySha256 ?? "") ||
      !HASH.test(result.billingBaselineSha256 ?? "")
    )
      fail("PREFLIGHT_READBACK", operation.id);
  }
  if (operation.id === "bootstrap-prequalification-database") {
    const bootstrapKeys = [
      "actualUsd",
      "application_secret_reads",
      "cloudflare_calls",
      "database_role_credential_bundle_sha256",
      "database_identity_sha256",
      "credential_bootstrap_receipt_sha256",
      "production_secret_bootstrap_sha256",
      "production_secrets_sha256",
      "production_secret_file_sha256s",
      "internal_credential_key_ids",
      "external_spend_usd",
      "full_live_authority_id",
      "gpu_use",
      "ledger_after_sha256",
      "ledger_before_count",
      "ledger_before_sha256",
      "operator_acl_sha256",
      "operator_database_url_sha256",
      "outer_state_sha256",
      "materialization_seed_sha256",
      "pgcrypto_sha256",
      "prequalification_database_bootstrap_sha256",
      "recovery_mode",
      "reconciler_database_url_sha256",
      "runpod_calls",
      "runtime_database_url_sha256",
      "schema_version",
    ];
    if (
      JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(bootstrapKeys.sort()) ||
      result.schema_version !== PREQUALIFICATION_SCHEMA ||
      result.full_live_authority_id !== state.full_live_authority_id ||
      !HASH.test(result.outer_state_sha256 ?? "") ||
      (authorizedOuterStateSha256 !== undefined &&
        result.outer_state_sha256 !== authorizedOuterStateSha256) ||
      !Number.isInteger(result.ledger_before_count) ||
      ![36, 37, 38, 39, 40, 41, 42, 43, 44, 45].includes(result.ledger_before_count) ||
      !HASH.test(result.ledger_after_sha256 ?? "") ||
      !HASH.test(result.ledger_before_sha256 ?? "") ||
      !HASH.test(result.operator_acl_sha256 ?? "") ||
      !HASH.test(result.operator_database_url_sha256 ?? "") ||
      !HASH.test(result.runtime_database_url_sha256 ?? "") ||
      !HASH.test(result.reconciler_database_url_sha256 ?? "") ||
      !HASH.test(result.database_role_credential_bundle_sha256 ?? "") ||
      result.database_identity_sha256 !== EXACT_DATABASE_IDENTITY_SHA256 ||
      !HASH.test(result.credential_bootstrap_receipt_sha256 ?? "") ||
      !HASH.test(result.production_secret_bootstrap_sha256 ?? "") ||
      !HASH.test(result.production_secrets_sha256 ?? "") ||
      typeof result.production_secret_file_sha256s !== "object" ||
      result.production_secret_file_sha256s === null ||
      Object.values(result.production_secret_file_sha256s).some((item) => !HASH.test(item)) ||
      typeof result.internal_credential_key_ids !== "object" ||
      result.internal_credential_key_ids === null ||
      !HASH.test(result.materialization_seed_sha256 ?? "") ||
      result.materialization_seed_sha256 !== state.materialization_seed_sha256 ||
      new Set([
        result.operator_database_url_sha256,
        result.runtime_database_url_sha256,
        result.reconciler_database_url_sha256,
      ]).size !== 3 ||
      !HASH.test(result.pgcrypto_sha256 ?? "") ||
      !HASH.test(result.prequalification_database_bootstrap_sha256 ?? "") ||
      !PREQUALIFICATION_RECOVERY_MODES.has(result.recovery_mode) ||
      result.runpod_calls !== 0 ||
      result.cloudflare_calls !== 0 ||
      result.application_secret_reads !== 5 ||
      result.gpu_use !== false ||
      result.external_spend_usd !== 0
    )
      fail("PREQUALIFICATION_DATABASE_BOOTSTRAP_READBACK", operation.id);
    if (
      (result.recovery_mode === "FRESH_36_TO_45" && result.ledger_before_count !== 36) ||
      (result.recovery_mode === "RESUME_EXACT_PREFIX" &&
        ![37, 38, 39, 40, 41, 42, 43, 44].includes(result.ledger_before_count)) ||
      (result.recovery_mode === "VERIFIED_EXISTING_45" && result.ledger_before_count !== 45)
    )
      fail("PREQUALIFICATION_RECOVERY_MODE", operation.id);
  }
  if (
    operation.id === "guarded-activation-once" &&
    (result.executedOnce !== true || !HASH.test(result.evidenceSha256 ?? ""))
  )
    fail("GUARDED_ACTIVATION_READBACK", operation.id);
  if (
    operation.id === "promote-qualified-production" &&
    (result.enabled !== true ||
      result.state !== "QUALIFIED_EXACT" ||
      result.gpuDispatchPerformed !== false ||
      result.cloudflareMutationPerformed !== true ||
      !HASH.test(result.evidenceSha256 ?? "") ||
      !HASH.test(result.versionSha256 ?? "") ||
      !HASH.test(result.databasePromotionSha256 ?? ""))
  )
    fail("QUALIFIED_PROMOTION_READBACK", operation.id);
  if (operation.id === "record-workflow-start-authority") {
    if (
      JSON.stringify(Object.keys(result).sort()) !==
        JSON.stringify(["actualUsd", "authorityId", "expiresAt", "tokenSha256"].sort()) ||
      !UUID.test(result.authorityId ?? "") ||
      !HASH.test(result.tokenSha256 ?? "") ||
      typeof result.expiresAt !== "string" ||
      Number.isNaN(Date.parse(result.expiresAt))
    )
      fail("WORKFLOW_START_AUTHORITY_READBACK", operation.id);
  }
  if (operation.id === "create-exact-max-one-endpoints") {
    if (
      result.createdExactTwoEndpoints !== true ||
      result.distinctEndpointIds !== true ||
      result.bothMaxWorkersOne !== true ||
      result.bothWorkersMinZero !== true ||
      !HASH.test(result.evidenceSha256 ?? "")
    )
      fail("MAX_ONE_ENDPOINT_READBACK", operation.id);
  }
  if (operation.id === "restore-endpoints-max-one") {
    const exactPairRetained =
      result.productionCleanupState === "EXACT_MAX_ONE_PAIR_RETAINED" &&
      result.bothEndpointsMaxWorkersOne === true &&
      result.retainedProductionEndpoints === 2 &&
      result.productionResourcesAbsent === false;
    const allProductionAbsent =
      result.productionCleanupState === "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT" &&
      result.bothEndpointsMaxWorkersOne === false &&
      result.retainedProductionEndpoints === 0 &&
      result.productionResourcesAbsent === true;
    if (!exactPairRetained && !allProductionAbsent) fail("CLEANUP_PRODUCTION_STATE", operation.id);
  }
  if (operation.id === "reconcile-exact-resources") {
    const localCleanup = result.localDatabaseCredentialCleanup;
    if (requiresBootstrapPartialCleanup(state)) {
      if (
        !exactKeys(localCleanup, [
          "cleanupSha256",
          "cleanupState",
          "credentialBundleSha256",
          "fullLiveAuthorityId",
          "operatorRoleAbsent",
          "removedArtifactCount",
          "runtimeAndReconcilerRolesAbsent",
          "schemaVersion",
        ]) ||
        localCleanup.schemaVersion !== "videoforge.v213-database-role-credential-cleanup/v1" ||
        localCleanup.fullLiveAuthorityId !== state.full_live_authority_id ||
        ![
          "REMOVED_AUTHORITY_BOUND_FILES",
          "REMOVED_INCOMPLETE_AUTHORITY_BOUND_STAGING",
          "ALREADY_ABSENT",
        ].includes(localCleanup.cleanupState) ||
        localCleanup.operatorRoleAbsent !== true ||
        localCleanup.runtimeAndReconcilerRolesAbsent !== true ||
        !Number.isInteger(localCleanup.removedArtifactCount) ||
        localCleanup.removedArtifactCount < 0 ||
        localCleanup.removedArtifactCount > 56 ||
        (localCleanup.cleanupState === "REMOVED_AUTHORITY_BOUND_FILES" &&
          (!HASH.test(localCleanup.credentialBundleSha256 ?? "") ||
            localCleanup.removedArtifactCount < 1)) ||
        (localCleanup.cleanupState === "REMOVED_INCOMPLETE_AUTHORITY_BOUND_STAGING" &&
          (localCleanup.credentialBundleSha256 !== null ||
            localCleanup.removedArtifactCount !== 1)) ||
        (localCleanup.cleanupState === "ALREADY_ABSENT" &&
          (localCleanup.credentialBundleSha256 !== null || localCleanup.removedArtifactCount !== 0))
      )
        fail("PREQUALIFICATION_PARTIAL_CLEANUP_READBACK", operation.id);
      const { cleanupSha256, ...cleanupBody } = localCleanup;
      const expectedProofSha256 = canonicalSha256({
        providerCleanupEvidenceSha256: result.evidenceSha256,
        localDatabaseCredentialCleanupSha256: cleanupSha256,
      });
      if (
        cleanupSha256 !== canonicalSha256(cleanupBody) ||
        result.proofSha256 !== expectedProofSha256
      )
        fail("PREQUALIFICATION_PARTIAL_CLEANUP_READBACK", operation.id);
    } else if (localCleanup !== undefined) {
      fail("PREQUALIFICATION_PARTIAL_CLEANUP_UNAUTHORIZED", operation.id);
    }
  }
  if (operation.phase.includes("qualification") && operation.id.includes("live-qualification")) {
    if (
      result.qualified !== true ||
      !HASH.test(result.evidenceSha256 ?? "") ||
      !HASH.test(result.deploymentSha256 ?? "") ||
      result.zeroWorkersAfter !== true
    )
      fail("QUALIFICATION_READBACK", operation.id);
  }
  if (operation.id.startsWith("v2-")) {
    if (
      result.accepted !== true ||
      result.terminal !== true ||
      !HASH.test(result.evidenceSha256 ?? "") ||
      result.zeroWorkersAfter !== true
    )
      fail("ACCEPTANCE_READBACK", operation.id);
  }
  if (
    operation.id === "v2-09-short-hosted-project" &&
    (result.durationSeconds < 30 || result.durationSeconds > 60)
  )
    fail("V2_09_DURATION", operation.id);
  if (
    operation.id === "v2-10-operator-free-ranga-pilot" &&
    (result.durationSeconds < 180 ||
      result.durationSeconds > 300 ||
      result.operatorIntervention !== false)
  )
    fail("V2_10_SCOPE", operation.id);
  if (
    operation.id === "v2-11-two-concurrent-owned-projects" &&
    (result.projectCount !== 2 || result.concurrent !== true || result.ownershipIsolated !== true)
  )
    fail("V2_11_SCOPE", operation.id);
  if (
    operation.id === "v2-12-long-output" &&
    (result.durationSeconds < 1740 || result.durationSeconds > 1860)
  )
    fail("V2_12_DURATION", operation.id);
  if (operation.id === "v2-13-final-two-lane-smoke") {
    if (
      result.schemaVersion !== V213_SMOKE_RESULT_SCHEMA ||
      result.twoLaneSmoke !== true ||
      result.smokeOnly !== true ||
      result.releaseCertified !== false ||
      !HASH.test(result.signedSmokeEvidenceSha256 ?? "") ||
      result.signedSmokeEvidenceSha256 !== result.evidenceSha256
    )
      fail("V2_13_SCOPE", operation.id);
  }
  if (operation.id === RELEASE_CERTIFICATION_OPERATION_ID) {
    const predecessors = certificationPredecessorEvidence(results);
    if (
      result.schemaVersion !== RELEASE_CERTIFICATION_RESULT_SCHEMA ||
      result.actualUsd !== 0 ||
      result.externalSpendUsd !== 0 ||
      result.gpuUse !== false ||
      result.providerMutationPerformed !== false ||
      result.currentRunEvidence !== true ||
      result.certified !== true ||
      result.releaseStatus !== "release_certified" ||
      result.gateCount !== 15 ||
      result.missingGateCount !== 0 ||
      result.invalidGateCount !== 0 ||
      result.liveReleaseAuthorized !== false ||
      result.requiresExplicitReleaseAuthority !== true ||
      !HASH.test(result.releaseIdentitySha256 ?? "") ||
      !HASH.test(result.ledgerSha256 ?? "") ||
      result.evidenceSha256 !== result.ledgerSha256 ||
      !exactKeys(result.predecessorEvidenceSha256s, Object.keys(predecessors)) ||
      Object.entries(predecessors).some(
        ([operationId, sha256]) => result.predecessorEvidenceSha256s[operationId] !== sha256,
      )
    )
      fail("RELEASE_CERTIFICATION_READBACK", operation.id);
  }
  return result;
}

function stateMutation(statePath, currentSha256, operation) {
  const updated = updateState(statePath, currentSha256, operation);
  return { state: updated.state, sha256: updated.sha256 };
}

async function executeFullLive({
  statePath,
  expectedStateSha256,
  runOperation,
  runCleanupOperation,
  runEarlyCleanupOperation,
  preflight,
  trustedTime,
  loadSettledResult,
  verifyMaterializationChain,
  verifyChain,
  verifyMaterializationSeed,
  verifyStaticReleaseDescriptor,
  verifyPrequalificationReceipt,
}) {
  if (typeof runOperation !== "function") fail("RUNNER_REQUIRED");
  if (typeof trustedTime !== "function") fail("TRUSTED_TIME_REQUIRED");
  if (runCleanupOperation !== undefined && typeof runCleanupOperation !== "function")
    fail("CLEANUP_RUNNER_CONTRACT");
  if (runEarlyCleanupOperation !== undefined && typeof runEarlyCleanupOperation !== "function")
    fail("EARLY_CLEANUP_RUNNER_CONTRACT");
  if (preflight !== undefined && typeof preflight !== "function") fail("PREFLIGHT_CONTRACT");
  if (loadSettledResult !== undefined && typeof loadSettledResult !== "function")
    fail("SETTLED_RESULT_LOADER_CONTRACT");
  const chainVerifier = verifyMaterializationChain ?? verifyChain;
  if (chainVerifier !== undefined && typeof chainVerifier !== "function")
    fail("CHAIN_VERIFIER_CONTRACT");
  if (typeof verifyMaterializationSeed !== "function")
    fail("MATERIALIZATION_SEED_VERIFIER_REQUIRED");
  if (typeof verifyStaticReleaseDescriptor !== "function")
    fail("STATIC_RELEASE_DESCRIPTOR_VERIFIER_REQUIRED");
  if (
    verifyPrequalificationReceipt !== undefined &&
    typeof verifyPrequalificationReceipt !== "function"
  )
    fail("PREQUALIFICATION_RECEIPT_VERIFIER_CONTRACT");
  let current = { state: null, sha256: expectedStateSha256 };
  const results = new Map();
  // A settled bootstrap receipt is the durable boundary proving the operator role/ACL.  Do not
  // infer that boundary from whether the initial preflight happened: bootstrap can fail after
  // preflight, and a restarted process must derive it from settled work only.
  let operatorRoleVerified = false;
  const first = OPERATIONS[0];
  if (!first) fail("EMPTY_GRAPH");
  current = stateMutation(statePath, current.sha256, (state) => {
    validateState(state);
    if (
      state.full_live_executor_path !== EXECUTOR_PATH ||
      state.full_live_executor_sha256 !== EXECUTOR_SHA256
    )
      fail("EXECUTOR_SOURCE_DRIFT");
    return state;
  });
  operatorRoleVerified = current.state.operator_role_verified === true;
  if (
    [
      "CONSUMED_SINGLE_EXECUTION_COMPLETE",
      "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY",
    ].includes(current.state.state)
  )
    fail("NOT_IN_PROGRESS");

  let failureBoundary = FAILURE_BOUNDARIES.initialStaticReleaseDescriptor;
  const enterFailureCleanup = (error, fallbackCode) => {
    const boundary = FAILURE_BOUNDARY.test(failureBoundary)
      ? failureBoundary
      : "UNCLASSIFIED_FAILURE_BOUNDARY";
    const code = boundedFailureCode(error, fallbackCode);
    current = stateMutation(statePath, current.sha256, (state) =>
      enterCleanupOnly(state, {
        failureBoundary: boundary,
        failureCode: code,
        eventId: eventId(state.authority_id, "cleanup-entry", "failed"),
      }),
    );
    results.set("failure", {
      failure_boundary: boundary,
      failure_code: code,
    });
  };

  const verifySeed = async (context = {}) => {
    const staticBoundary = context.localCertification
      ? FAILURE_BOUNDARIES.certificationStaticReleaseDescriptor
      : context.operationId
        ? FAILURE_BOUNDARIES.operationStaticReleaseDescriptor
        : FAILURE_BOUNDARIES.initialStaticReleaseDescriptor;
    const seedBoundary = context.localCertification
      ? FAILURE_BOUNDARIES.certificationMaterializationSeed
      : context.operationId
        ? FAILURE_BOUNDARIES.operationMaterializationSeed
        : FAILURE_BOUNDARIES.initialMaterializationSeed;
    failureBoundary = staticBoundary;
    const descriptor = await verifyStaticReleaseDescriptor(
      structuredClone(current.state),
      current.sha256,
      structuredClone(context),
    );
    if (descriptor === false)
      fail("STATIC_RELEASE_DESCRIPTOR_VERIFICATION", context.operationId ?? "");
    failureBoundary = seedBoundary;
    const result = await verifyMaterializationSeed(
      structuredClone(current.state),
      current.sha256,
      structuredClone(context),
    );
    if (result === false) fail("MATERIALIZATION_SEED_VERIFICATION", context.operationId ?? "");
  };
  if (current.state.state !== "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY") {
    try {
      await verifySeed({
        restart: current.state.current_phase_index > 0,
        recovery: false,
      });
    } catch (error) {
      if (current.state.state !== "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS") throw error;
      enterFailureCleanup(error, "FULL_LIVE_OPERATION_FAILED");
    }
  }

  const begin = (phase) => {
    current = stateMutation(statePath, current.sha256, (state) => beginPhase(state, phase));
  };
  const complete = (phase) => {
    current = stateMutation(statePath, current.sha256, (state) => completePhase(state, phase));
  };

  const workIdFor = (operation, state = current.state) =>
    `${state.authority_id}:${operation.id}`.toLowerCase();
  const workFor = (operation, state = current.state) =>
    state.phases[operation.phase]?.work?.[workIdFor(operation, state)];
  const isSettled = (operation, state = current.state) =>
    workFor(operation, state)?.state === "SETTLED_TERMINAL";

  const durableResult = (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      fail("RESULT_CONTRACT");
    try {
      const parsed = JSON.parse(JSON.stringify(value));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
        fail("RESULT_CONTRACT");
      return parsed;
    } catch {
      fail("RESULT_NOT_SERIALIZABLE");
    }
  };

  const checkTrustedTime = async (boundary = FAILURE_BOUNDARIES.preOperationTrustedTime) => {
    failureBoundary = boundary;
    const trustedIso = await trustedTime(structuredClone(current.state));
    const trustedMs = Date.parse(trustedIso ?? "");
    if (
      Number.isNaN(trustedMs) ||
      trustedMs < Date.parse(current.state.approved_at) ||
      trustedMs > Date.parse(current.state.expires_at)
    )
      fail("TRUSTED_TIME_EXPIRED_OR_FORGED");
  };

  let earlyCleanupFailure = false;

  const verifyChainAtBoundary = async (operation, boundary) => {
    if (chainVerifier === undefined) return;
    await chainVerifier(structuredClone(current.state), new Map(results), {
      operation: structuredClone(operation),
      boundary,
      outerStateSha256: current.sha256,
      settledResultSha256:
        current.state.phases[operation.phase]?.work?.[workIdFor(operation)]?.settled_result_sha256,
      earlyFailure:
        current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY" &&
        canUseEarlyCleanup(current.state),
    });
  };

  // Rebuild the in-memory predecessor map in graph order before any resumed adapter is called.
  // Settled work is terminal: a missing durable result is a hard stop, never a reason to invoke
  // the adapter again. A deployment may provide a separate read-only result store for states
  // written by an older executor that did not embed the result, but it must return the exact
  // operation result and is persisted back through the state CAS below.
  const hydrateSettledResults = async () => {
    for (const operation of OPERATIONS) {
      const existing = workFor(operation);
      if (existing?.state !== "SETTLED_TERMINAL") continue;
      failureBoundary = FAILURE_BOUNDARIES.settledResultHydration;
      let prior = existing.settled_result;
      if (prior === undefined && loadSettledResult !== undefined) {
        prior = await loadSettledResult({
          operation: structuredClone(operation),
          state: structuredClone(current.state),
          workId: workIdFor(operation),
          work: structuredClone(existing),
          outerStateSha256: current.sha256,
        });
        prior = durableResult(prior);
        const loaded = assertResult(operation, prior, current.state, results);
        current = stateMutation(statePath, current.sha256, (state) =>
          recordSettledResult(state, {
            phaseName: operation.phase,
            workId: workIdFor(operation),
            result: loaded,
          }),
        );
        prior = loaded;
      }
      if (prior === undefined) fail("SETTLED_RESULT_UNAVAILABLE", operation.id);
      const result = assertResult(operation, durableResult(prior), current.state, results);
      if (
        operation.id === "bootstrap-prequalification-database" &&
        current.state.operator_role_verified !== true
      ) {
        current = stateMutation(statePath, current.sha256, (state) =>
          recordSettledResult(state, {
            phaseName: operation.phase,
            workId: workIdFor(operation),
            result,
          }),
        );
      }
      results.set(operation.id, result);
      operatorRoleVerified = current.state.operator_role_verified === true;
      failureBoundary = FAILURE_BOUNDARIES.materializationChainVerification;
      await verifyChainAtBoundary(operation, "hydrated");
    }
  };

  const runOne = async (operation) => {
    const workId = workIdFor(operation);
    const existing = workFor(operation);
    const cleanupSafetyRecovery =
      current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY" &&
      CLEANUP_SAFETY_OPERATION_IDS.has(operation.id);
    // A missing or drifted protected seed is itself a cleanup trigger. Once the durable state is
    // cleanup-only, do not let the same failed normal-input verifier prevent the four closed
    // safety operations from draining and proving provider state. Their adapters have separate
    // cleanup-only contracts and may not resume normal or paid work.
    if (!cleanupSafetyRecovery)
      await verifySeed({
        operationId: operation.id,
        resumed: existing !== undefined,
        recovery: current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY",
      });
    if (existing?.state === "SETTLED_TERMINAL") {
      failureBoundary = FAILURE_BOUNDARIES.settledResultHydration;
      let prior = results.get(operation.id) ?? existing.settled_result;
      if (prior === undefined && loadSettledResult !== undefined) {
        prior = await loadSettledResult({
          operation: structuredClone(operation),
          state: structuredClone(current.state),
          workId,
          work: structuredClone(existing),
          outerStateSha256: current.sha256,
        });
        prior = durableResult(prior);
        const loaded = assertResult(operation, prior, current.state, results);
        current = stateMutation(statePath, current.sha256, (state) =>
          recordSettledResult(state, { phaseName: operation.phase, workId, result: loaded }),
        );
        prior = loaded;
      }
      if (prior === undefined) fail("SETTLED_RESULT_UNAVAILABLE", operation.id);
      const result = assertResult(operation, durableResult(prior), current.state, results);
      if (
        operation.id === "bootstrap-prequalification-database" &&
        current.state.operator_role_verified !== true
      ) {
        current = stateMutation(statePath, current.sha256, (state) =>
          recordSettledResult(state, { phaseName: operation.phase, workId, result }),
        );
      }
      results.set(operation.id, result);
      operatorRoleVerified = current.state.operator_role_verified === true;
      failureBoundary = FAILURE_BOUNDARIES.materializationChainVerification;
      await verifyChainAtBoundary(operation, "settled");
      return result;
    }
    if (existing?.state === "AUTHORIZED_ONCE_NOT_REDISPATCHABLE") {
      if (
        operation.id === "bootstrap-prequalification-database" &&
        current.state.state === "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS"
      ) {
        const authorizedOuterStateSha256 = current.sha256;
        failureBoundary = FAILURE_BOUNDARIES.bootstrapReconciliation;
        const raw = await runOperation(
          operation,
          structuredClone(current.state),
          new Map(results),
          authorizedOuterStateSha256,
          {
            operationId: operation.id,
            cleanupOnly: false,
            earlyFailure: false,
            endpointFree: false,
            operatorRoleVerified: false,
            resumed: true,
            authorizedUnsettled: true,
            reconciliationOnly: true,
            providerDispatchForbidden: true,
          },
        );
        failureBoundary = FAILURE_BOUNDARIES.operationResultValidation;
        const result = assertResult(operation, durableResult(raw), current.state, results, {
          authorizedOuterStateSha256,
        });
        current = stateMutation(statePath, current.sha256, (state) =>
          settleWork(state, {
            phaseName: operation.phase,
            workId,
            actualUsd: result.actualUsd,
            eventId: eventId(state.authority_id, operation.id, "reconciled"),
            result,
          }),
        );
        results.set(operation.id, result);
        operatorRoleVerified = current.state.operator_role_verified === true;
        failureBoundary = FAILURE_BOUNDARIES.materializationChainVerification;
        await verifyChainAtBoundary(operation, "bootstrap-reconciled");
        return result;
      }
      if (
        current.state.state !== "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY" ||
        !CLEANUP_SAFETY_OPERATION_IDS.has(operation.id)
      )
        fail("REDISPATCH_FORBIDDEN", operation.id);
      // A cleanup transport gap is not permission to repeat paid/live work. It is permission only
      // to reconcile the already-authorized safety operation through idempotent cleanup/readback.
      const earlyCleanup = canUseEarlyCleanup(current.state);
      const cleanupMode = cleanupModeFor(current.state);
      const runner =
        earlyCleanup && runEarlyCleanupOperation !== undefined
          ? runEarlyCleanupOperation
          : (runCleanupOperation ?? runOperation);
      failureBoundary = FAILURE_BOUNDARIES.operationExecution;
      const raw = await runner(
        operation,
        structuredClone(current.state),
        new Map(results),
        current.sha256,
        {
          operationId: operation.id,
          cleanupOnly: true,
          earlyFailure: earlyCleanup,
          endpointFree: earlyCleanup,
          cleanupMode,
          operatorRoleVerified,
          resumed: true,
          authorizedUnsettled: true,
          reconciliationOnly: true,
          providerDispatchForbidden: true,
        },
      );
      failureBoundary = FAILURE_BOUNDARIES.operationResultValidation;
      const result = assertResult(operation, durableResult(raw), current.state, results);
      failureBoundary = FAILURE_BOUNDARIES.operationAuthorization;
      current = stateMutation(statePath, current.sha256, (state) =>
        settleCleanupWork(state, {
          workId,
          eventId: eventId(state.authority_id, operation.id, "reconciled"),
          result,
        }),
      );
      results.set(operation.id, result);
      failureBoundary = FAILURE_BOUNDARIES.materializationChainVerification;
      await verifyChainAtBoundary(operation, "cleanup-reconciled");
      return result;
    }
    if (operation.id === RELEASE_CERTIFICATION_OPERATION_ID) {
      failureBoundary = FAILURE_BOUNDARIES.certificationResultValidation;
      certificationPredecessorEvidence(results);
    }
    failureBoundary = FAILURE_BOUNDARIES.operationAuthorization;
    current = stateMutation(statePath, current.sha256, (state) => {
      const event = eventId(state.authority_id, operation.id, "reserved");
      if (state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY")
        return authorizeCleanupWork(state, { workId, eventId: event });
      return authorizeWork(state, {
        phaseName: operation.phase,
        workId,
        reservationUsd: operation.reserveUsd,
        eventId: event,
      });
    });
    // The reservation is durably written before this call. An ambiguous exit therefore leaves a
    // non-redispatchable work ID and can proceed only to cleanup.
    const cleanupOnly = current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY";
    const earlyCleanup = cleanupOnly && canUseEarlyCleanup(current.state);
    const runner =
      earlyCleanup && runEarlyCleanupOperation !== undefined
        ? runEarlyCleanupOperation
        : cleanupOnly && runCleanupOperation !== undefined
          ? runCleanupOperation
          : runOperation;
    const executionContext = {
      operationId: operation.id,
      cleanupOnly,
      earlyFailure: earlyCleanup,
      endpointFree: earlyCleanup,
      providerDispatchForbidden: earlyCleanup,
      cleanupMode: cleanupOnly ? cleanupModeFor(current.state) : undefined,
      operatorRoleVerified,
      resumed: existing !== undefined,
    };
    const authorizedOuterStateSha256 = current.sha256;
    failureBoundary = FAILURE_BOUNDARIES.operationExecution;
    const raw = await runner(
      operation,
      structuredClone(current.state),
      new Map(results),
      authorizedOuterStateSha256,
      executionContext,
    );
    failureBoundary = FAILURE_BOUNDARIES.operationResultValidation;
    const result = assertResult(
      operation,
      durableResult(raw),
      current.state,
      results,
      operation.id === "bootstrap-prequalification-database"
        ? { authorizedOuterStateSha256 }
        : undefined,
    );
    if (operation.id === "release-tag-readback") {
      current = stateMutation(statePath, current.sha256, (state) =>
        recordVerifiedReleaseRef(state, {
          tagName: result.tagName,
          targetCommit: result.targetCommit,
          eventId: eventId(state.authority_id, operation.id, "verified"),
        }),
      );
    }
    current = stateMutation(statePath, current.sha256, (state) => {
      const event = eventId(state.authority_id, operation.id, "settled");
      if (state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY")
        return settleCleanupWork(state, { workId, eventId: event, result });
      return settleWork(state, {
        phaseName: operation.phase,
        workId,
        actualUsd: result.actualUsd,
        eventId: event,
        result,
      });
    });
    operatorRoleVerified = current.state.operator_role_verified === true;
    results.set(operation.id, result);
    failureBoundary = FAILURE_BOUNDARIES.materializationChainVerification;
    await verifyChainAtBoundary(operation, "settled");
    return result;
  };

  let cleanupPreflightDone = false;
  const runCleanupPreflight = async () => {
    if (cleanupPreflightDone) return;
    earlyCleanupFailure = canUseEarlyCleanup(current.state);
    const cleanupMode = cleanupModeFor(current.state);
    if (preflight !== undefined && !earlyCleanupFailure) {
      failureBoundary = FAILURE_BOUNDARIES.cleanupPreflight;
      const mode = {
        cleanupOnly: true,
        earlyFailure: earlyCleanupFailure,
        endpointFree: earlyCleanupFailure,
        providerDispatchForbidden: earlyCleanupFailure,
        cleanupMode,
        operatorRoleVerified,
        bootstrapOnly: false,
        operatorOnly: true,
        initial: true,
        staged: false,
        requireEndpointSecrets: false,
      };
      if (verifyPrequalificationReceipt !== undefined)
        await verifyPrequalificationReceipt(
          structuredClone(current.state),
          current.sha256,
          mode,
          new Map(results),
        );
      await preflight(structuredClone(current.state), current.sha256, mode, new Map(results));
    }
    cleanupPreflightDone = true;
  };

  const resumedCleanupOnly = current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY";
  if (resumedCleanupOnly) {
    // Hydrate before selecting the cleanup seam.  A restart must not widen a cleanup-only child
    // merely because its in-memory predecessor map started empty.
    await hydrateSettledResults();
    earlyCleanupFailure = canUseEarlyCleanup(current.state);
  }
  if (!resumedCleanupOnly) {
    const bootstrapAtEntry = OPERATIONS.find(
      (operation) => operation.id === "bootstrap-prequalification-database",
    );
    // A process that starts from an already-authorized bootstrap is itself the single allowed
    // reconciliation attempt. If that readback fails, enter cleanup-only instead of issuing a
    // duplicate provider-free database read in the same resumed process.
    let sameProcessBootstrapReconciliationAttempted =
      bootstrapAtEntry !== undefined &&
      workFor(bootstrapAtEntry)?.state === "AUTHORIZED_ONCE_NOT_REDISPATCHABLE";
    while (true) {
      try {
        failureBoundary = FAILURE_BOUNDARIES.settledResultHydration;
        await hydrateSettledResults();
        if (
          OPERATIONS.filter((operation) => CLEANUP_SAFETY_OPERATION_IDS.has(operation.id)).some(
            (operation) => workFor(operation)?.state === "AUTHORIZED_ONCE_NOT_REDISPATCHABLE",
          )
        )
          fail("AUTHORIZED_CLEANUP_WORK_AMBIGUOUS");
        if (preflight !== undefined) {
          failureBoundary = FAILURE_BOUNDARIES.initialPreflight;
          const bootstrapOperation = OPERATIONS.find(
            (operation) => operation.id === "bootstrap-prequalification-database",
          );
          const bootstrapReconciliation =
            bootstrapOperation !== undefined &&
            workFor(bootstrapOperation)?.state === "AUTHORIZED_ONCE_NOT_REDISPATCHABLE";
          await preflight(
            structuredClone(current.state),
            current.sha256,
            {
              cleanupOnly: false,
              earlyFailure: false,
              endpointFree: false,
              operatorRoleVerified,
              bootstrapOnly: true,
              bootstrapReconciliation,
              operatorOnly: false,
              initial: true,
              staged: false,
              requireEndpointSecrets: false,
            },
            new Map(results),
          );
        }
        const normalPhases = [
          ...new Set(
            OPERATIONS.filter((operation) => operation.phase !== "cleanup_and_reconciliation").map(
              (operation) => operation.phase,
            ),
          ),
        ];
        for (const phaseName of normalPhases) {
          const phase = current.state.phases[phaseName];
          if (phase?.state === "COMPLETE") continue;
          const expectedPhaseIndex = PHASES.findIndex(([name]) => name === phaseName);
          if (
            expectedPhaseIndex < 0 ||
            current.state.current_phase_index !== expectedPhaseIndex ||
            !phase
          )
            fail("PHASE_ORDER");
          if (phase.state === "PENDING") {
            // The trusted clock must be checked before even the local phase reservation/mutation.
            // A stale/forged clock therefore leaves the phase with no work history and enters the
            // existing cleanup-only seam without authorizing the first operation.
            await checkTrustedTime(FAILURE_BOUNDARIES.phaseMutationTrustedTime);
            begin(phaseName);
          } else if (phase.state !== "ACTIVE") fail("PHASE_ORDER");
          for (const operation of OPERATIONS.filter((item) => item.phase === phaseName)) {
            if (!isSettled(operation))
              await checkTrustedTime(FAILURE_BOUNDARIES.preOperationTrustedTime);
            await runOne(operation);
            if (operation.id === "fresh-live-preflight" && preflight !== undefined) {
              await checkTrustedTime(FAILURE_BOUNDARIES.preOperationTrustedTime);
              failureBoundary = FAILURE_BOUNDARIES.stagedPreflight;
              await preflight(
                structuredClone(current.state),
                current.sha256,
                {
                  cleanupOnly: false,
                  earlyFailure: false,
                  endpointFree: false,
                  operatorRoleVerified,
                  bootstrapOnly: false,
                  operatorOnly: false,
                  initial: false,
                  staged: true,
                  requireEndpointSecrets: false,
                },
                new Map(results),
              );
            }
          }
          if (current.state.phases[phaseName].state === "ACTIVE") {
            await checkTrustedTime(FAILURE_BOUNDARIES.phaseMutationTrustedTime);
            complete(phaseName);
          }
        }
        const cleanupPhase = current.state.phases.cleanup_and_reconciliation;
        if (cleanupPhase.state === "PENDING") begin("cleanup_and_reconciliation");
        else if (cleanupPhase.state !== "ACTIVE") fail("PHASE_ORDER");
        break;
      } catch (caught) {
        let error = caught;
        const bootstrap = OPERATIONS.find(
          (operation) => operation.id === "bootstrap-prequalification-database",
        );
        if (
          !sameProcessBootstrapReconciliationAttempted &&
          bootstrap !== undefined &&
          current.state.state === "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS" &&
          workFor(bootstrap)?.state === "AUTHORIZED_ONCE_NOT_REDISPATCHABLE"
        ) {
          sameProcessBootstrapReconciliationAttempted = true;
          try {
            // A thrown psql result can be a lost acknowledgement after the one transaction that
            // creates the operator role and exact grants. Re-enter only the bootstrap's explicit
            // provider-free, readback-only reconciliation before making cleanup-only irreversible.
            await runOne(bootstrap);
            continue;
          } catch (reconciliationError) {
            error = reconciliationError;
            failureBoundary = FAILURE_BOUNDARIES.bootstrapReconciliation;
          }
        }
        if (current.state.state === "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS") {
          earlyCleanupFailure = canUseEarlyCleanup(current.state);
          enterFailureCleanup(error, "FULL_LIVE_OPERATION_FAILED");
          break;
        }
        throw error;
      }
    }
  }

  // A hard crash can leave an authorized cleanup safety work item while the outer state still says
  // in-progress. Once that ambiguity is forced into cleanup-only above, run the same protected
  // cleanup preflight as an ordinary cleanup-only restart before any reconciliation call.
  if (current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY") await runCleanupPreflight();

  try {
    const cleanupOperations = OPERATIONS.filter(
      (item) =>
        item.phase === "cleanup_and_reconciliation" &&
        item.id !== RELEASE_CERTIFICATION_OPERATION_ID,
    );
    for (const operation of cleanupOperations) await runOne(operation);

    failureBoundary = FAILURE_BOUNDARIES.cleanupProof;
    const { zero, billing, resources, maxOne } = cleanupProofEvidence(results);
    // The aggregate proof is permanently scoped to the four safety operations. Certification is a
    // separate transport-free, zero-spend state transition, so a bad local certification result can
    // never strand drain, billing, or retained-resource closure.
    if (current.state.cleanup_proof === null) {
      current = stateMutation(statePath, current.sha256, (state) =>
        recordCleanupProof(state, {
          zeroWorkerProofSha256: zero.proofSha256,
          billingProofSha256: billing.proofSha256,
          resourceProofSha256: resources.proofSha256,
          maxOneProofSha256: maxOne.proofSha256,
          eventId: eventId(state.authority_id, "cleanup-proof", "verified"),
        }),
      );
    } else if (
      current.state.cleanup_proof.zero_worker_proof_sha256 !== zero.proofSha256 ||
      current.state.cleanup_proof.billing_proof_sha256 !== billing.proofSha256 ||
      current.state.cleanup_proof.resource_reconciliation_sha256 !== resources.proofSha256 ||
      current.state.cleanup_proof.max_one_restoration_sha256 !== maxOne.proofSha256
    ) {
      fail("CLEANUP_PROOF_RESULT_DRIFT");
    }

    if (current.state.state !== "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY") {
      const certification = OPERATIONS.find(({ id }) => id === RELEASE_CERTIFICATION_OPERATION_ID);
      if (!certification) fail("RELEASE_CERTIFICATION_OPERATION_MISSING");
      const certificationWorkId = `${current.state.authority_id}:${certification.id}`.toLowerCase();
      if (current.state.release_certification?.state !== "SETTLED_TERMINAL") {
        const reconciling =
          current.state.release_certification?.state === "AUTHORIZED_ONCE_RECONCILIATION_ONLY";
        await verifySeed({
          operationId: certification.id,
          resumed: reconciling,
          recovery: false,
          localCertification: true,
          reconciliationOnly: reconciling,
        });
        failureBoundary = FAILURE_BOUNDARIES.certificationResultValidation;
        certificationPredecessorEvidence(results);
        if (!reconciling) {
          // No seed, provider, database, or other work may occur between this authenticated time
          // read and the durable one-use authorization for the certification call.
          await checkTrustedTime(FAILURE_BOUNDARIES.certificationTrustedTime);
          failureBoundary = FAILURE_BOUNDARIES.certificationAuthorization;
          current = stateMutation(statePath, current.sha256, (state) =>
            authorizeReleaseCertification(state, {
              workId: certificationWorkId,
              eventId: `${certificationWorkId}:authorized`,
            }),
          );
        }
        failureBoundary = FAILURE_BOUNDARIES.certificationExecution;
        const raw = await runOperation(
          certification,
          structuredClone(current.state),
          new Map(results),
          current.sha256,
          {
            operationId: certification.id,
            cleanupOnly: false,
            earlyFailure: false,
            endpointFree: false,
            operatorRoleVerified,
            resumed: reconciling,
            localCertification: true,
            providerDispatchForbidden: true,
            authorizedUnsettled: reconciling,
            reconciliationOnly: reconciling,
            persistenceForbidden: reconciling,
            dispatchForbidden: reconciling,
          },
        );
        failureBoundary = FAILURE_BOUNDARIES.certificationResultValidation;
        const result = assertResult(certification, durableResult(raw), current.state, results);
        current = stateMutation(statePath, current.sha256, (state) =>
          settleReleaseCertification(state, {
            workId: certificationWorkId,
            result,
            eventId: `${certificationWorkId}:settled`,
          }),
        );
        results.set(certification.id, result);
        failureBoundary = FAILURE_BOUNDARIES.materializationChainVerification;
        await verifyChainAtBoundary(certification, "certified");
      } else {
        const result = assertResult(
          certification,
          durableResult(current.state.release_certification.settled_result),
          current.state,
          results,
        );
        results.set(certification.id, result);
      }
    }
    current = stateMutation(statePath, current.sha256, (state) => {
      if (state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY")
        return completeCleanupOnly(state);
      return completePhase(state, "cleanup_and_reconciliation");
    });
  } catch (error) {
    if (current.state.state === "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS") {
      enterFailureCleanup(error, "FULL_LIVE_CLEANUP_FAILED");
    }
    throw error;
  }
  return {
    ...current,
    results,
    failed:
      results.has("failure") ||
      current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY",
  };
}

function parseArgs(argv) {
  const args = new Map();
  let execute = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--execute") {
      execute = true;
      continue;
    }
    if (!token.startsWith("--") || index + 1 >= argv.length) fail("ARGUMENTS");
    args.set(token.slice(2), argv[index + 1]);
    index += 1;
  }
  return { args, execute };
}

async function main() {
  const { args, execute } = parseArgs(process.argv.slice(2));
  const gaps = missingConcreteTools();
  if (!execute) {
    process.stdout.write(
      `${JSON.stringify({ state: "NO_ACTION", external_calls: 0, mutations: 0, gpu_use: 0, spend_usd: 0, ordered_operations: OPERATIONS.map(({ phase, id, reserveUsd }) => ({ phase, id, reserve_usd: reserveUsd })), missing_concrete_tools: gaps })}\n`,
    );
    return;
  }
  if (args.get("confirm") !== CONFIRMATION) fail("CONFIRMATION");
  if (gaps.length > 0) fail("MISSING_CONCRETE_TOOLING", gaps.join(","));
  const statePath = resolve(ROOT, args.get("state-file") ?? "");
  const expectedStateSha256 = args.get("expected-state-sha256");
  if (!HASH.test(expectedStateSha256 ?? "")) fail("EXPECTED_STATE_SHA256");
  const runConcreteOperation = async (
    operation,
    state,
    priorResults,
    outerStateSha256,
    executionContext,
  ) =>
    CONCRETE_LIVE_ADAPTERS[operation.id](
      { ROOT, operation, state, priorResults, outerStateSha256, ...executionContext },
      state,
      priorResults,
      outerStateSha256,
      executionContext,
    );
  const result = await executeFullLive({
    statePath,
    expectedStateSha256,
    preflight: async (state, _sha256, mode, priorResults) => {
      if (mode.staged === true)
        await verifyPrequalificationDatabaseReceipt({
          environment: process.env,
          state,
          priorResults,
        });
      return preflightConcreteFullLiveInputs({
        state,
        cleanupOnly: mode.cleanupOnly,
        bootstrapOnly: mode.bootstrapOnly === true,
        operatorOnly: mode.operatorOnly === true,
        requireEndpointSecrets: mode.requireEndpointSecrets === true,
        allowUnmaterializedProductionInput: true,
      });
    },
    trustedTime: () => readAuthenticatedGithubTime(),
    runOperation: runConcreteOperation,
    runCleanupOperation: runConcreteOperation,
    runEarlyCleanupOperation: runConcreteOperation,
    verifyMaterializationSeed: (state) =>
      validateMaterializationSeedFile({
        path: process.env[MATERIALIZATION_SEED_ENV],
        expectedSha256: state.materialization_seed_sha256,
      }),
    verifyStaticReleaseDescriptor: (state) =>
      validateStaticReleaseDescriptorFile({
        path: process.env[STATIC_RELEASE_DESCRIPTOR_ENV],
        expectedSha256: state.static_release_descriptor_sha256,
        expectedSourceCommit: state.release_source_commit,
      }),
    verifyPrequalificationReceipt: async (state, _outerStateSha256, _mode, priorResults) =>
      verifyPrequalificationDatabaseReceipt({
        environment: process.env,
        state,
        priorResults,
      }),
    verifyMaterializationChain: (state, priorResults, context) =>
      verifyMaterializationChainFile({
        environment: process.env,
        state,
        priorResults,
        operation: context.operation,
        earlyFailure: context.earlyFailure === true,
      }),
  });
  process.stdout.write(
    `${JSON.stringify({ state_file: statePath, state_sha256: result.sha256, state: result.state.state, failed: result.failed })}\n`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export {
  CONFIRMATION,
  CONCRETE_LIVE_ADAPTERS,
  executeFullLive,
  FAILURE_BOUNDARIES,
  missingConcreteTools,
  OPERATIONS,
  runPodMutationBoundaryReached,
};
