#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BUILDER_PATH = "deploy/v2-13/build-materialization-seed.mjs";
const ENVELOPE_SCHEMA_PATH =
  "project-context/evidence/serverless_worker_job_envelope_v3.schema.json";
const QUALIFICATION_CASE_SOURCE_PATH = "apps/web/src/server/providers/v213-dual-lane-live.ts";
const MAGE_CASE_GENERATOR_PATH = "deploy/v2-13/generate-mage-qualification-case.mjs";
const SOULX_CASE_GENERATOR_PATH = "deploy/v2-13/generate-soulx-qualification-cases.mjs";
const MAGE_CASE_VALIDATOR_PATH =
  "workers/image-media/src/videoforge_image_media/mage_production.py";
const SOULX_CASE_VALIDATOR_PATH = "workers/avatar-primary/soulx_serverless.py";
const APPROVAL_VALIDATOR_PATH = "deploy/v2-13/validate-full-live-approval.mjs";
const PROPOSAL_PATH =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json";
const FACTS_SCHEMA = "videoforge.v213-materialization-seed-facts/v1";
const PROTECTED_INPUT_SCHEMA = "videoforge.v213-materialization-seed-protected-input/v1";
const SEED_SCHEMA = "videoforge.v213-full-live-materialization-seed/v1";
const COMMIT = /^[0-9a-f]{40}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const NON_PRODUCTION_MARKER =
  /(?:^|[^a-z0-9])(fixture|test|testing|fake|mock|dummy|example)(?:[^a-z0-9]|$)/iu;
const EXACT_DATABASE_IDENTITY = Object.freeze({
  database: "neondb",
  host: "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech",
  owner_role: "neondb_owner",
});
const PROPOSAL_RECORD_ALLOWED_DIFF_PATHS = Object.freeze([
  "project-context/00_START_HERE.md",
  "project-context/CURRENT_STATE.yaml",
  PROPOSAL_PATH,
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/validate-candidate.mjs",
  "project-context/tasks/VF-10-13.md",
]);
const RUNPOD_ACCOUNT_ID_SHA256 =
  "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c";
const RETAINED_LANES = Object.freeze({
  mage: Object.freeze({
    volumeIdSha256: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
    volumeManifestSha256: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  }),
  soulx: Object.freeze({
    volumeIdSha256: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
    volumeManifestSha256: "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
  }),
});
const QUALIFICATION_PROTECTED_INPUTS = Object.freeze({
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
const ENVELOPE_KEYS = Object.freeze([
  "mage",
  "soulx10s",
  "soulx2s",
  "soulx4s",
  "soulx6s",
  "soulxCancel",
  "soulxInvalidOutput",
  "soulxTimeout",
]);
const EXPECTED_QUALIFICATION_CASES = Object.freeze({
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

const fail = (code) => {
  throw new Error(`V2_13_MATERIALIZATION_SEED_BUILDER_${code}`);
};
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const canonicalBytes = (value) => Buffer.from(`${canonicalJson(value)}\n`);
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const sameJson = (left, right) => canonicalJson(left) === canonicalJson(right);
// Array.prototype.sort() without a comparator is ordered by UTF-16 code units. Keep the
// source-closure validator on that exact deterministic ordering rather than locale collation.
const compareCodeUnitLexically = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function assertSourceClosureOrder(entries) {
  let previousPath = "";
  const seen = new Set();
  for (const entry of entries) {
    const path = entry?.path;
    if (
      typeof path !== "string" ||
      seen.has(path) ||
      (previousPath !== "" && compareCodeUnitLexically(path, previousPath) <= 0)
    )
      fail("SOURCE_CLOSURE_CONTRACT");
    seen.add(path);
    previousPath = path;
  }
}

function parseJson(bytes, code, { canonical = false } = {}) {
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    fail(`${code}_JSON`);
  }
  if (canonical && Buffer.compare(Buffer.from(bytes), canonicalBytes(value)) !== 0)
    fail(`${code}_NONCANONICAL`);
  return value;
}

function sourcePath(value, code) {
  if (
    typeof value !== "string" ||
    value === "" ||
    isAbsolute(value) ||
    value.includes("\0") ||
    relative(".", value).startsWith("..") ||
    value.split("/").includes("..")
  )
    fail(code);
  return value;
}

function sourceRef(value, code) {
  if (!exactKeys(value, ["path", "sha256"]) || !HASH.test(value.sha256 ?? "")) fail(code);
  sourcePath(value.path, code);
  return value;
}

function readBoundSourceJson(ref, readSourceFile, code) {
  sourceRef(ref, `${code}_BINDING`);
  let bytes;
  try {
    bytes = Buffer.from(readSourceFile(ref.path));
  } catch {
    fail(`${code}_READ`);
  }
  if (sha256(bytes) !== ref.sha256) fail(`${code}_HASH`);
  return Object.freeze({ bytes, value: parseJson(bytes, code) });
}

function readBoundSourceBytes(ref, readSourceFile, code) {
  sourceRef(ref, `${code}_BINDING`);
  let bytes;
  try {
    bytes = Buffer.from(readSourceFile(ref.path));
  } catch {
    fail(`${code}_READ`);
  }
  if (sha256(bytes) !== ref.sha256) fail(`${code}_HASH`);
  return bytes;
}

function validateEnvelopeSchemaDocument(schema) {
  if (
    schema?.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
    schema?.$id !== "https://videoforge.local/schemas/serverless-worker-job-envelope-v3.json" ||
    schema?.properties?.schema?.const !== "serverless-worker-job-envelope/v3" ||
    schema?.additionalProperties !== false
  )
    fail("ENVELOPE_SCHEMA_CONTRACT");
  return schema;
}

function parseQualificationCases(sourceBytes) {
  const source = Buffer.from(sourceBytes).toString("utf8");
  const cases = new Map();
  const pattern =
    /Object\.freeze\(\{\s*key:\s*"([A-Za-z0-9]+)",\s*lane:\s*"(mage|soulx)",\s*id:\s*"([a-z0-9-]+)",\s*seconds:\s*(\d+),\s*mode:\s*"(complete|cancel|invalid|timeout)",\s*cold:\s*(true|false),?\s*\}\)/gu;
  for (const match of source.matchAll(pattern)) {
    const [, key, lane, id, seconds, mode, cold] = match;
    if (cases.has(key)) fail("QUALIFICATION_CASE_SOURCE");
    cases.set(
      key,
      Object.freeze({ lane, id, seconds: Number(seconds), mode, cold: cold === "true" }),
    );
  }
  if (
    !exactKeys(Object.fromEntries(cases), ENVELOPE_KEYS) ||
    !sameJson(Object.fromEntries(cases), EXPECTED_QUALIFICATION_CASES)
  )
    fail("QUALIFICATION_CASE_SOURCE");
  return cases;
}

function containsNonProductionMarker(value) {
  if (typeof value === "string") return NON_PRODUCTION_MARKER.test(value);
  if (Array.isArray(value)) return value.some(containsNonProductionMarker);
  if (value !== null && typeof value === "object")
    return Object.entries(value).some(
      ([key, child]) => NON_PRODUCTION_MARKER.test(key) || containsNonProductionMarker(child),
    );
  return false;
}

function validateFacts(value) {
  if (
    !exactKeys(value, [
      "database",
      "full_live_authority_id",
      "protected_input",
      "retained_volume_manifest_sha256s",
      "schema_version",
      "soulx_crop_evidence",
      "source_evidence",
    ]) ||
    value.schema_version !== FACTS_SCHEMA ||
    !UUID.test(value.full_live_authority_id ?? "") ||
    !exactKeys(value.database, ["database", "host", "owner_role"]) ||
    !sameJson(value.database, EXACT_DATABASE_IDENTITY) ||
    !exactKeys(value.retained_volume_manifest_sha256s, ["mage", "soulx"]) ||
    value.retained_volume_manifest_sha256s.mage !== RETAINED_LANES.mage.volumeManifestSha256 ||
    value.retained_volume_manifest_sha256s.soulx !== RETAINED_LANES.soulx.volumeManifestSha256 ||
    !exactKeys(value.protected_input, ["path", "schema_version", "sha256"]) ||
    value.protected_input.schema_version !== PROTECTED_INPUT_SCHEMA ||
    !HASH.test(value.protected_input.sha256 ?? "") ||
    !exactKeys(value.source_evidence, ["source_readiness"]) ||
    !exactKeys(value.soulx_crop_evidence, ["approval", "candidate"])
  )
    fail("FACTS_CONTRACT");
  sourcePath(value.protected_input.path, "FACTS_PROTECTED_PATH");
  sourceRef(value.source_evidence.source_readiness, "FACTS_READINESS_BINDING");
  sourceRef(value.soulx_crop_evidence.approval, "FACTS_SOULX_APPROVAL_BINDING");
  sourceRef(value.soulx_crop_evidence.candidate, "FACTS_SOULX_CANDIDATE_BINDING");
  return value;
}

function validateProtectedInput(value, facts, proposal) {
  if (
    !exactKeys(value, ["qualification", "schema_version"]) ||
    value.schema_version !== PROTECTED_INPUT_SCHEMA ||
    !exactKeys(value.qualification, ["envelope_signing_key_id"]) ||
    !COMMAND_ID.test(value.qualification.envelope_signing_key_id ?? "") ||
    containsNonProductionMarker(value.qualification.envelope_signing_key_id)
  )
    fail("PROTECTED_INPUT_CONTRACT");
  if (
    proposal.requested_scope.retention.mage_volume_id_sha256 !==
      RETAINED_LANES.mage.volumeIdSha256 ||
    proposal.requested_scope.retention.soulx_volume_id_sha256 !==
      RETAINED_LANES.soulx.volumeIdSha256 ||
    facts.retained_volume_manifest_sha256s.mage !== RETAINED_LANES.mage.volumeManifestSha256 ||
    facts.retained_volume_manifest_sha256s.soulx !== RETAINED_LANES.soulx.volumeManifestSha256
  )
    fail("RETAINED_LANE_BINDING");
  return value;
}

const STATIC_RELEASE_GATE_POLICY = Object.freeze({
  operations_runbooks_ready: Object.freeze({
    claims: Object.freeze([
      "stuck_job_runbook",
      "provider_outage_runbook",
      "billing_runbook",
      "rollback_runbook",
    ]),
    metricKeys: Object.freeze([
      "billingRunbookSha256",
      "providerOutageRunbookSha256",
      "rollbackRunbookSha256",
      "stuckJobRunbookSha256",
    ]),
    metricsPass: (metrics) => Object.values(metrics).every((item) => HASH.test(item ?? "")),
  }),
  backup_restore_ready: Object.freeze({
    claims: Object.freeze([
      "backup_readback_passed",
      "restore_evidence_accepted",
      "schema_migration_disposition_recorded",
    ]),
    metricKeys: Object.freeze([
      "backupReadbackPassed",
      "restoreEvidenceAccepted",
      "schemaMigrationDisposition",
    ]),
    metricsPass: (metrics) =>
      metrics.backupReadbackPassed === true &&
      metrics.restoreEvidenceAccepted === true &&
      metrics.schemaMigrationDisposition === "DISPOSABLE_RESTORE_COMPLETED",
  }),
  security_clear: Object.freeze({
    claims: Object.freeze([
      "p0_zero",
      "p1_zero",
      "auth_tenant_boundary_passed",
      "ssrf_path_upload_boundary_passed",
      "secret_log_scan_passed",
      "cost_amplification_guards_passed",
      "legacy_runtime_bundle_scan_passed",
    ]),
    metricKeys: Object.freeze([
      "authTenantPassed",
      "costAmplificationGuardsPassed",
      "legacyRuntimeBundleScanPassed",
      "p0Count",
      "p1Count",
      "secretLogScanPassed",
      "ssrfPathUploadPassed",
    ]),
    metricsPass: (metrics) =>
      metrics.p0Count === 0 &&
      metrics.p1Count === 0 &&
      metrics.authTenantPassed === true &&
      metrics.ssrfPathUploadPassed === true &&
      metrics.secretLogScanPassed === true &&
      metrics.costAmplificationGuardsPassed === true &&
      metrics.legacyRuntimeBundleScanPassed === true,
  }),
  production_transport_real: Object.freeze({
    claims: Object.freeze([
      "hosted_client_api_truth",
      "fixture_controls_absent",
      "fake_gpu_absent",
      "fake_transport_absent",
      "manual_pod_controls_absent",
      "legacy_dispatch_exports_absent",
    ]),
    metricKeys: Object.freeze([
      "fakeGpuProfileInBundle",
      "fakeTransportInBundle",
      "fixtureControlsInBundle",
      "hostedClientApiTruth",
      "legacyDispatchExportsInBundle",
      "manualPodControlsInBundle",
    ]),
    metricsPass: (metrics) =>
      metrics.hostedClientApiTruth === true &&
      metrics.fixtureControlsInBundle === false &&
      metrics.fakeGpuProfileInBundle === false &&
      metrics.fakeTransportInBundle === false &&
      metrics.manualPodControlsInBundle === false &&
      metrics.legacyDispatchExportsInBundle === false,
  }),
});
const STATIC_RELEASE_GATES = Object.freeze(Object.keys(STATIC_RELEASE_GATE_POLICY));

function validateDescriptor(value, bytes, expectedSha256, sourceCommit, sourceEvidence) {
  if (
    !exactKeys(value, [
      "auditFacts",
      "contractBundleSha256",
      "descriptorSha256",
      "productionUrlSha256",
      "schemaVersion",
      "sourceCommit",
    ]) ||
    value.schemaVersion !== "videoforge.v213-static-release-descriptor/v1" ||
    value.sourceCommit !== sourceCommit ||
    value.descriptorSha256 !== expectedSha256 ||
    value.contractBundleSha256 !== sourceEvidence.readiness.contract_bundle.sha256 ||
    value.productionUrlSha256 !== sourceEvidence.readiness.production_origin.sha256 ||
    !exactKeys(value.auditFacts, STATIC_RELEASE_GATES)
  )
    fail("STATIC_DESCRIPTOR_CONTRACT");
  for (const gate of STATIC_RELEASE_GATES) {
    const fact = value.auditFacts[gate];
    const policy = STATIC_RELEASE_GATE_POLICY[gate];
    if (
      !exactKeys(fact, [
        "claims",
        "evidenceClass",
        "evidencePath",
        "fixtureOrFakeTransportUsed",
        "gate",
        "metrics",
        "observedAt",
        "observerId",
        "sourceEvidenceSha256",
      ]) ||
      fact.gate !== gate ||
      fact.evidenceClass !== sourceEvidence.readiness.evidence_class ||
      fact.sourceEvidenceSha256 !== sourceEvidence.sha256 ||
      typeof fact.observerId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(fact.observerId) ||
      fact.observerId !== sourceEvidence.readiness.observer_id ||
      typeof fact.evidencePath !== "string" ||
      !/^project-context\/evidence\/[A-Za-z0-9._/-]+\.json$/u.test(fact.evidencePath) ||
      fact.evidencePath.includes("..") ||
      fact.evidencePath !== sourceEvidence.path ||
      fact.observedAt !== sourceEvidence.readiness.observed_at ||
      fact.fixtureOrFakeTransportUsed !== sourceEvidence.readiness.fixture_or_fake_transport_used ||
      !Array.isArray(fact.claims) ||
      JSON.stringify([...fact.claims].sort()) !== JSON.stringify([...policy.claims].sort()) ||
      !exactKeys(fact.metrics, policy.metricKeys) ||
      !policy.metricsPass(fact.metrics) ||
      !sameJson(fact.claims, sourceEvidence.readiness.audit_facts[gate].claims) ||
      !sameJson(fact.metrics, sourceEvidence.readiness.audit_facts[gate].metrics)
    )
      fail("STATIC_DESCRIPTOR_FACTS");
  }
  const unsigned = { ...value };
  delete unsigned.descriptorSha256;
  if (
    sha256(Buffer.from(canonicalJson(unsigned))) !== expectedSha256 ||
    Buffer.compare(Buffer.from(bytes), canonicalBytes(value)) !== 0
  )
    fail("STATIC_DESCRIPTOR_HASH");
}

function validateProposal(proposal, proposalPath) {
  const sourceCommit = proposal?.source?.release_source_commit;
  const isV4 = proposal?.schema_version === "videoforge.v2-13-full-live-completion-proposal/v4";
  const executionControl = proposal?.source?.execution_control;
  const executionControlCommit = isV4 ? executionControl?.commit : sourceCommit;
  const executionControlComponents = isV4 ? executionControl?.exact_components : null;
  const factsBinding = proposal?.sealing?.materialization_seed_facts;
  if (
    proposal?.source?.proposal_path !== proposalPath ||
    proposalPath !== PROPOSAL_PATH ||
    !COMMIT.test(sourceCommit ?? "") ||
    !exactKeys(factsBinding, ["commit_field", "full_live_authority_id", "path", "sha256"]) ||
    factsBinding.commit_field !== "source.release_source_commit" ||
    !UUID.test(factsBinding.full_live_authority_id ?? "") ||
    !HASH.test(factsBinding.sha256 ?? "") ||
    !sameJson(factsBinding, proposal?.requested_scope?.materialization_seed_facts)
  )
    fail("PROPOSAL_FACTS_BINDING");
  sourcePath(factsBinding.path, "PROPOSAL_FACTS_PATH");
  const descriptor = proposal?.sealing?.static_release_descriptor;
  if (!exactKeys(descriptor, ["path", "sha256"]) || !HASH.test(descriptor.sha256 ?? ""))
    fail("PROPOSAL_DESCRIPTOR_BINDING");
  sourcePath(descriptor.path, "PROPOSAL_DESCRIPTOR_PATH");
  const requested = proposal.requested_scope;
  const pending = proposal.source.pending_source_contract;
  const origin = pending.account_and_workers_dev_origin;
  const cf = requested.cloudflare_credential_scope;
  const r2 = requested.r2_s3_credential_scope;
  const workflowNames =
    proposal.exact_execution_graph?.cloudflare_credential_origin_policy?.worker_and_workflow_absence
      ?.workflow_names;
  const builderSource = isV4
    ? executionControlComponents?.materialization_seed_builder
    : proposal.source.exact_release_components?.materialization_seed_builder;
  const envelopeSchemaSource =
    proposal.source.exact_release_components?.materialization_seed_envelope_schema;
  const qualificationCaseSource =
    proposal.source.exact_release_components?.materialization_seed_qualification_case_source;
  const mageCaseGenerator =
    proposal.source.exact_release_components?.materialization_seed_mage_case_generator;
  const soulxCaseGenerator =
    proposal.source.exact_release_components?.materialization_seed_soulx_case_generator;
  const mageCaseValidator =
    proposal.source.exact_release_components?.materialization_seed_mage_case_validator;
  const soulxCaseValidator =
    proposal.source.exact_release_components?.materialization_seed_soulx_case_validator;
  const productionConfigValidator =
    proposal.source.exact_release_components?.production_config_validator;
  const approvalValidator = isV4
    ? executionControlComponents?.approval_validator
    : proposal.source.exact_release_components?.approval_validator;
  if (
    requested.maximum_cumulative_finite_runpod_spend_usd !== 17.5 ||
    requested.phase_caps_usd?.mage_qualification !== 4.5 ||
    requested.phase_caps_usd?.soulx_qualification !== 1 ||
    requested.read_only_preflight_binding?.runpod_account_id_sha256 !== RUNPOD_ACCOUNT_ID_SHA256 ||
    requested.retention?.mage_volume_id_sha256 !== RETAINED_LANES.mage.volumeIdSha256 ||
    requested.retention?.soulx_volume_id_sha256 !== RETAINED_LANES.soulx.volumeIdSha256 ||
    typeof origin?.account_id !== "string" ||
    !/^[0-9a-f]{32}$/u.test(origin.account_id) ||
    sha256(Buffer.from(origin.account_id)) !== origin.account_id_sha256 ||
    origin.account_id !== cf?.authenticated_account_id ||
    origin.account_id !== r2?.account_id ||
    origin.worker_name !== "videoforge-production-runtime" ||
    origin.public_origin !==
      `https://${origin.worker_name}.${origin.workers_dev_subdomain}.workers.dev` ||
    !Array.isArray(workflowNames) ||
    workflowNames.length !== 2 ||
    workflowNames[0] !== origin.worker_name ||
    workflowNames[1] !== `${origin.worker_name}-pair` ||
    !/^[a-z][a-z0-9-]{2,62}$/u.test(r2.bucket_name ?? "") ||
    pending.cloudflare_authentication?.protected_config_path_sha256 !==
      cf.protected_config_path_sha256 ||
    !Array.isArray(pending.cloudflare_authentication?.oauth_scopes) ||
    !sameJson(pending.cloudflare_authentication.oauth_scopes, cf.oauth_scopes) ||
    requested.database?.exact_operator_role !== "videoforge_hosted_operator" ||
    requested.database?.exact_runtime_role !== "videoforge_hosted_runtime" ||
    requested.database?.exact_reconciler_role !== "videoforge_hosted_reconciler" ||
    !exactKeys(builderSource, ["path", "sha256"]) ||
    builderSource.path !== BUILDER_PATH ||
    !HASH.test(builderSource.sha256 ?? "") ||
    (!isV4 &&
      pending.release_component_sha256s?.materialization_seed_builder !== builderSource.sha256) ||
    !exactKeys(envelopeSchemaSource, ["path", "sha256"]) ||
    envelopeSchemaSource.path !== ENVELOPE_SCHEMA_PATH ||
    !HASH.test(envelopeSchemaSource.sha256 ?? "") ||
    pending.release_component_sha256s?.materialization_seed_envelope_schema !==
      envelopeSchemaSource.sha256 ||
    !exactKeys(qualificationCaseSource, ["path", "sha256"]) ||
    qualificationCaseSource.path !== QUALIFICATION_CASE_SOURCE_PATH ||
    !HASH.test(qualificationCaseSource.sha256 ?? "") ||
    pending.release_component_sha256s?.materialization_seed_qualification_case_source !==
      qualificationCaseSource.sha256 ||
    [
      [mageCaseGenerator, MAGE_CASE_GENERATOR_PATH, "materialization_seed_mage_case_generator"],
      [soulxCaseGenerator, SOULX_CASE_GENERATOR_PATH, "materialization_seed_soulx_case_generator"],
      [mageCaseValidator, MAGE_CASE_VALIDATOR_PATH, "materialization_seed_mage_case_validator"],
      [soulxCaseValidator, SOULX_CASE_VALIDATOR_PATH, "materialization_seed_soulx_case_validator"],
    ].some(
      ([component, path, key]) =>
        !exactKeys(component, ["path", "sha256"]) ||
        component.path !== path ||
        !HASH.test(component.sha256 ?? "") ||
        pending.release_component_sha256s?.[key] !== component.sha256,
    ) ||
    !exactKeys(productionConfigValidator, ["path", "sha256"]) ||
    productionConfigValidator.path !== "deploy/v2-13/validate-production-config.mjs" ||
    !HASH.test(productionConfigValidator.sha256 ?? "") ||
    pending.release_component_sha256s?.production_config_validator !==
      productionConfigValidator.sha256 ||
    approvalValidator?.path !== APPROVAL_VALIDATOR_PATH ||
    approvalValidator?.source_commit_tree_binding?.tree_entry_path !== APPROVAL_VALIDATOR_PATH ||
    approvalValidator.source_commit_tree_binding.commit_field !==
      (isV4 ? "source.execution_control_commit" : "source.release_source_commit") ||
    !COMMIT.test(executionControlCommit ?? "") ||
    (isV4 &&
      (!exactKeys(executionControl, ["commit", "exact_components"]) ||
        !exactKeys(executionControlComponents, [
          "approval_validator",
          "full_live_adapters",
          "full_live_executor",
          "guarded_activation",
          "materialization_seed_builder",
          "orchestration_authority",
          "source_closure_manifest",
        ]) ||
        Object.values(executionControlComponents).some(
          (component) =>
            component?.path !== APPROVAL_VALIDATOR_PATH &&
            (!exactKeys(component, ["path", "sha256"]) || !HASH.test(component.sha256 ?? "")),
        )))
  )
    fail("PROPOSAL_CONTRACT");
  return Object.freeze({
    accountId: origin.account_id,
    builderSource,
    envelopeSchemaSource,
    mageCaseGenerator,
    mageCaseValidator,
    productionConfigValidator,
    qualificationCaseSource,
    soulxCaseGenerator,
    soulxCaseValidator,
    descriptor,
    executionControlCommit,
    executionControlComponents,
    factsBinding,
    oauthScopes: structuredClone(cf.oauth_scopes),
    publicOrigin: origin.public_origin,
    r2BucketName: r2.bucket_name,
    sourceCommit,
    subdomain: origin.workers_dev_subdomain,
    workerName: origin.worker_name,
    workflowName: workflowNames[0],
  });
}

function deterministicUuid(value) {
  const hex = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function deterministicProductionSecretKeyId(fullLiveAuthorityId, purpose) {
  return `v213-${purpose}-${sha256(Buffer.from(`${fullLiveAuthorityId}\0${purpose}`)).slice(7, 31)}`;
}

function migrationLedgerSha256(proposal, readSourceFile) {
  const binding = proposal?.source?.exact_release_components?.migration_manifest;
  if (
    !exactKeys(binding, ["path", "sha256"]) ||
    binding.path !== "packages/control-plane/migrations/manifest.json" ||
    !HASH.test(binding.sha256 ?? "")
  )
    fail("MIGRATION_MANIFEST_BINDING");
  const { bytes, value } = readBoundSourceJson(binding, readSourceFile, "MIGRATION_MANIFEST");
  if (
    value?.schema_version !== "videoforge-migration-manifest/v1" ||
    !Array.isArray(value.migrations) ||
    value.migrations.length !== 45
  )
    fail("MIGRATION_MANIFEST_CONTRACT");
  value.migrations.forEach((migration, index) => {
    if (
      !exactKeys(migration, ["filename", "name", "sha256", "version"]) ||
      migration.version !== index + 1 ||
      typeof migration.name !== "string" ||
      !/^\d{4}_[a-z0-9_]+\.sql$/u.test(migration.filename ?? "") ||
      !HASH.test(migration.sha256 ?? "")
    )
      fail("MIGRATION_ROW_CONTRACT");
    let migrationBytes;
    try {
      migrationBytes = Buffer.from(
        readSourceFile(`packages/control-plane/migrations/${migration.filename}`),
      );
    } catch {
      fail("MIGRATION_SOURCE_READ");
    }
    if (sha256(migrationBytes) !== migration.sha256) fail("MIGRATION_SOURCE_HASH");
  });
  if (sha256(bytes) !== binding.sha256) fail("MIGRATION_MANIFEST_HASH");
  return sha256(canonicalBytes(value.migrations));
}

function soulxCropApproval(facts, readSourceFile) {
  const approvalRead = readBoundSourceJson(
    facts.soulx_crop_evidence.approval,
    readSourceFile,
    "SOULX_APPROVAL",
  );
  const candidateRead = readBoundSourceJson(
    facts.soulx_crop_evidence.candidate,
    readSourceFile,
    "SOULX_CANDIDATE",
  );
  const approval = approvalRead.value;
  const candidate = candidateRead.value;
  const profile = approval?.approved_profile;
  if (
    approval?.schema_version !== "videoforge.v2-08-soulx-crop-profile-approval/v1" ||
    approval?.activation?.visual_approval_status !== "APPROVED_EXACT_FULL_AND_SPLIT" ||
    approval?.activation?.live_dispatch_authorized !== false ||
    approval?.candidate?.path !== facts.soulx_crop_evidence.candidate.path ||
    approval?.candidate?.sha256 !== facts.soulx_crop_evidence.candidate.sha256 ||
    approval?.candidate?.candidate_id !== candidate?.candidate_id ||
    candidate?.schema_version !== "videoforge.v2-08-soulx-crop-profile-candidate/v1" ||
    profile?.avatar_source_sha256 !== candidate?.owned_inputs?.avatar_source_sha256 ||
    !sameJson(profile?.avatar_source_geometry, candidate?.owned_inputs?.avatar_source_geometry) ||
    profile?.native_sample_sha256 !== candidate?.samples?.native?.sha256 ||
    profile?.full?.sample_sha256 !== candidate?.samples?.full?.sha256 ||
    profile?.split?.sample_sha256 !== candidate?.samples?.split?.sha256
  )
    fail("SOULX_EVIDENCE_CONTRACT");
  return {
    approval_path: facts.soulx_crop_evidence.approval.path,
    approval_sha256: facts.soulx_crop_evidence.approval.sha256,
    candidate_path: facts.soulx_crop_evidence.candidate.path,
    candidate_sha256: facts.soulx_crop_evidence.candidate.sha256,
    profile_group_id: profile.profile_group_id,
    avatar_source_sha256: profile.avatar_source_sha256,
    avatar_source_geometry: structuredClone(profile.avatar_source_geometry),
    native_sample_sha256: profile.native_sample_sha256,
    native_sample_geometry: structuredClone(profile.native_sample_geometry),
    full_profile_id: profile.full.profile_id,
    full_sample_sha256: profile.full.sample_sha256,
    full_output_geometry: structuredClone(profile.full.output_geometry),
    split_profile_id: profile.split.profile_id,
    split_sample_sha256: profile.split.sample_sha256,
    split_output_geometry: structuredClone(profile.split.output_geometry),
  };
}

function validateSourceEvidence(
  facts,
  proposal,
  binding,
  readSourceFile,
  validateSourceEvidenceLineage,
  additionalRequiredPaths = [],
) {
  const readiness = readBoundSourceJson(
    facts.source_evidence.source_readiness,
    readSourceFile,
    "SOURCE_READINESS",
  ).value;
  const readinessFacts = readiness?.audit_facts;
  const sourceClosure =
    binding.executionControlComponents?.source_closure_manifest ??
    proposal?.source?.exact_release_components?.source_closure_manifest;
  const readinessObservedAt = Date.parse(readiness?.observed_at ?? "");
  if (
    readiness?.schema_version !== "videoforge.v2-13-full-live-source-readiness-audit/v1" ||
    readiness.audit_result !== "PASS_READY_TO_RESEAL" ||
    readiness.evidence_class !== "INDEPENDENT_RELEASE_AUDIT" ||
    typeof readiness.observer_id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(readiness.observer_id) ||
    readiness.fixture_or_fake_transport_used !== false ||
    readiness.credential_accessed !== false ||
    readiness.external_calls !== 0 ||
    readiness.gpu_use !== 0 ||
    readiness.provider_mutations !== 0 ||
    readiness.provider_state_observed !== false ||
    !COMMIT.test(readiness.audited_code_commit ?? "") ||
    !RFC3339.test(readiness.observed_at ?? "") ||
    Number.isNaN(readinessObservedAt) ||
    readiness.spend_usd !== 0 ||
    !exactKeys(readinessFacts, [
      "backup_restore_ready",
      "operations_runbooks_ready",
      "production_transport_real",
      "security_clear",
    ]) ||
    readiness?.production_origin?.value !== binding.publicOrigin ||
    readiness.production_origin.sha256 !== sha256(Buffer.from(binding.publicOrigin)) ||
    !exactKeys(sourceClosure, ["path", "sha256"]) ||
    readiness?.source_closure?.path !== sourceClosure.path ||
    readiness.source_closure.sha256 !== sourceClosure.sha256 ||
    readiness.source_closure.exact !== true ||
    readiness?.contract_bundle?.definition !== "CANONICAL_FULL_LIVE_SOURCE_CLOSURE_BYTES" ||
    readiness.contract_bundle.path !== sourceClosure.path ||
    readiness.contract_bundle.sha256 !== sourceClosure.sha256
  )
    fail("SOURCE_READINESS_CONTRACT");
  const closureRead = readBoundSourceJson(sourceClosure, readSourceFile, "SOURCE_CLOSURE");
  const closure = closureRead.value;
  if (
    closure?.schema_version !== "videoforge.v2-13-full-live-source-closure/v1" ||
    !Array.isArray(closure.entries) ||
    closure.entries.length === 0 ||
    readiness.source_closure.entry_count !== closure.entries.length
  )
    fail("SOURCE_CLOSURE_CONTRACT");
  assertSourceClosureOrder(closure.entries);
  const seen = new Set();
  for (const entry of closure.entries) {
    if (
      !exactKeys(entry, ["path", "sha256"]) ||
      !HASH.test(entry.sha256 ?? "") ||
      sourcePath(entry.path, "SOURCE_CLOSURE_PATH") !== entry.path ||
      seen.has(entry.path)
    )
      fail("SOURCE_CLOSURE_CONTRACT");
    const sourceBytes = readBoundSourceBytes(entry, readSourceFile, "SOURCE_CLOSURE_ENTRY");
    if (sha256(sourceBytes) !== entry.sha256) fail("SOURCE_CLOSURE_ENTRY_HASH");
    seen.add(entry.path);
  }
  for (const requiredPath of [
    BUILDER_PATH,
    ENVELOPE_SCHEMA_PATH,
    QUALIFICATION_CASE_SOURCE_PATH,
    binding.productionConfigValidator.path,
    ...additionalRequiredPaths,
  ])
    if (!seen.has(requiredPath)) fail("SOURCE_CLOSURE_REQUIRED_ENTRY");
  if (typeof validateSourceEvidenceLineage !== "function") fail("SOURCE_EVIDENCE_LINEAGE_READER");
  try {
    validateSourceEvidenceLineage({
      auditedCodeCommit: readiness.audited_code_commit,
      closure,
      factsPath: binding.factsBinding.path,
      releaseSourceCommit: binding.executionControlComponents
        ? binding.executionControlCommit
        : binding.sourceCommit,
      sourceReadinessPath: facts.source_evidence.source_readiness.path,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_13_")) throw error;
    fail("SOURCE_EVIDENCE_LINEAGE");
  }
  return Object.freeze({
    path: facts.source_evidence.source_readiness.path,
    sha256: facts.source_evidence.source_readiness.sha256,
    readiness,
  });
}

/**
 * Pure, provider-free assembly boundary. Callers supply exact raw bytes and a reader that returns
 * bytes from proposal.source.release_source_commit; values are never loaded from fixtures or the
 * process environment.
 */
function buildV213MaterializationSeed({
  proposalBytes,
  proposalPath = PROPOSAL_PATH,
  protectedInputBytes,
  readSourceFile,
  staticReleaseDescriptorBytes,
  validateSourceEvidenceLineage,
}) {
  if (typeof readSourceFile !== "function") fail("SOURCE_READER");
  const proposal = parseJson(Buffer.from(proposalBytes), "PROPOSAL");
  const binding = validateProposal(proposal, proposalPath);
  const factsRead = readBoundSourceJson(
    { path: binding.factsBinding.path, sha256: binding.factsBinding.sha256 },
    readSourceFile,
    "FACTS",
  );
  if (Buffer.compare(factsRead.bytes, canonicalBytes(factsRead.value)) !== 0)
    fail("FACTS_NONCANONICAL");
  const facts = validateFacts(factsRead.value);
  if (facts.full_live_authority_id !== binding.factsBinding.full_live_authority_id)
    fail("FACTS_AUTHORITY_BINDING");
  const committedBuilderBytes = readBoundSourceBytes(
    binding.builderSource,
    readSourceFile,
    "BUILDER_SOURCE",
  );
  const runningBuilderBytes = readFileSync(fileURLToPath(import.meta.url));
  if (
    sha256(committedBuilderBytes) !== binding.builderSource.sha256 ||
    sha256(runningBuilderBytes) !== binding.builderSource.sha256
  )
    fail("BUILDER_SOURCE_DRIFT");
  readBoundSourceBytes(
    binding.productionConfigValidator,
    readSourceFile,
    "PRODUCTION_CONFIG_VALIDATOR_SOURCE",
  );
  const envelopeSchemaRead = readBoundSourceJson(
    binding.envelopeSchemaSource,
    readSourceFile,
    "ENVELOPE_SCHEMA",
  );
  validateEnvelopeSchemaDocument(envelopeSchemaRead.value);
  const qualificationCaseSourceBytes = readBoundSourceBytes(
    binding.qualificationCaseSource,
    readSourceFile,
    "QUALIFICATION_CASE_SOURCE",
  );
  const cases = parseQualificationCases(qualificationCaseSourceBytes);
  for (const [component, code] of [
    [binding.mageCaseGenerator, "MAGE_CASE_GENERATOR_SOURCE"],
    [binding.soulxCaseGenerator, "SOULX_CASE_GENERATOR_SOURCE"],
    [binding.mageCaseValidator, "MAGE_CASE_VALIDATOR_SOURCE"],
    [binding.soulxCaseValidator, "SOULX_CASE_VALIDATOR_SOURCE"],
  ])
    readBoundSourceBytes(component, readSourceFile, code);
  const protectedBytes = Buffer.from(protectedInputBytes);
  if (sha256(protectedBytes) !== facts.protected_input.sha256) fail("PROTECTED_INPUT_HASH");
  const protectedInput = parseJson(protectedBytes, "PROTECTED_INPUT", { canonical: true });
  validateProtectedInput(protectedInput, facts, proposal);
  // These records are committed provenance. The builder validates them but never refreshes them
  // through a network, provider, or credential read.
  const sourceEvidence = validateSourceEvidence(
    facts,
    proposal,
    binding,
    readSourceFile,
    validateSourceEvidenceLineage,
    [
      binding.mageCaseGenerator.path,
      binding.soulxCaseGenerator.path,
      binding.mageCaseValidator.path,
      binding.soulxCaseValidator.path,
    ],
  );
  const descriptorBytes = Buffer.from(staticReleaseDescriptorBytes);
  const descriptor = parseJson(descriptorBytes, "STATIC_DESCRIPTOR", { canonical: true });
  validateDescriptor(
    descriptor,
    descriptorBytes,
    binding.descriptor.sha256,
    binding.sourceCommit,
    sourceEvidence,
  );
  const cropApproval = soulxCropApproval(facts, readSourceFile);
  const ledgerSha256 = migrationLedgerSha256(proposal, readSourceFile);
  const fullLiveAuthorityId = facts.full_live_authority_id;
  const envelopeSigningKeyId = deterministicProductionSecretKeyId(fullLiveAuthorityId, "envelope");
  if (protectedInput.qualification.envelope_signing_key_id !== envelopeSigningKeyId)
    fail("PROTECTED_INPUT_ENVELOPE_KEY_ID_AUTHORITY_BINDING");
  const cf = {
    account_id: binding.accountId,
    worker_name: binding.workerName,
    workflow_name: binding.workflowName,
    r2_bucket_name: binding.r2BucketName,
    public_origin: binding.publicOrigin,
  };
  const seed = {
    schema_version: SEED_SCHEMA,
    static_only: true,
    future_output_hashes_present: false,
    production_input_base: {
      schemaVersion: "videoforge.v213-full-live-outer-input/v1",
      fullLiveAuthorityId,
      authorityDocument: {},
      dualLaneInput: {
        accountIdSha256: RUNPOD_ACCOUNT_ID_SHA256,
        mage: {
          lane: "mage",
          volumeIdSha256: RETAINED_LANES.mage.volumeIdSha256,
          volumeManifestSha256: RETAINED_LANES.mage.volumeManifestSha256,
        },
        soulx: {
          lane: "soulx",
          volumeIdSha256: RETAINED_LANES.soulx.volumeIdSha256,
          volumeManifestSha256: RETAINED_LANES.soulx.volumeManifestSha256,
        },
        totalCapUsd: 17.5,
        mageQualificationCapUsd: 4.5,
        soulxQualificationCapUsd: 1,
        qualificationEnvelopeSchemaSha256: binding.envelopeSchemaSource.sha256,
        envelopeSigningKeyId,
        qualificationR2: {
          accountId: binding.accountId,
          bucketName: binding.r2BucketName,
        },
        qualificationCaseDescriptor: {
          schemaVersion: "videoforge.v213-qualification-case-materialization-descriptor/v1",
          caseSource: structuredClone(binding.qualificationCaseSource),
          envelopeSchema: structuredClone(binding.envelopeSchemaSource),
          generators: {
            mage: structuredClone(binding.mageCaseGenerator),
            soulx: structuredClone(binding.soulxCaseGenerator),
          },
          validators: {
            mage: structuredClone(binding.mageCaseValidator),
            soulx: structuredClone(binding.soulxCaseValidator),
          },
          protectedInputs: structuredClone(QUALIFICATION_PROTECTED_INPUTS),
          cases: Object.fromEntries(
            [...cases.entries()].map(([key, value]) => [key, structuredClone(value)]),
          ),
        },
      },
      commandPayloads: {},
    },
    activation_record_base: {
      schema_version: "videoforge-v2-13-guarded-activation/v1",
      checkpoint: "V2-13",
      full_live_authority_id: fullLiveAuthorityId,
      authority: {
        single_use: true,
        gpu_use_authorized: false,
        maximum_cumulative_finite_external_spend_usd: 0,
        exact_quarantine_creation_authorized: true,
        new_paid_retained_resources_authorized: false,
        other_resource_creation_authorized: false,
        plan_change_authorized: false,
        proposal_path: proposalPath,
        confirmation_sha256: sha256(Buffer.from("EXECUTE_EXACT_GUARDED_V2_13_ACTIVATION")),
      },
      release: {},
      database: {
        host: facts.database.host,
        database: facts.database.database,
        owner_role: facts.database.owner_role,
        operator_role: proposal.requested_scope.database.exact_operator_role,
        operator_database_url_sha256: null,
        runtime_role: proposal.requested_scope.database.exact_runtime_role,
        reconciler_role: proposal.requested_scope.database.exact_reconciler_role,
        pgcrypto_required: true,
        first_migration: 37,
        last_migration: 45,
        exact_manifest_ledger_required: true,
      },
      cloudflare: {
        account_id: cf.account_id,
        worker_name: cf.worker_name,
        preexisting_worker_required: false,
        exact_quarantine_creation_authorized: true,
        failure_policy: "KEEP_EXACT_DISABLED_QUARANTINE_ELSE_DELETE_ATTRIBUTABLE",
        preexisting_secret_set_must_be_empty: true,
        r2_bucket_name: cf.r2_bucket_name,
        workflow_name: cf.workflow_name,
        public_origin: cf.public_origin,
        wrangler_oauth_config_path_sha256:
          proposal.source.pending_source_contract.cloudflare_authentication
            .protected_config_path_sha256,
        oauth_scopes: binding.oauthScopes,
        workers_dev_subdomain: binding.subdomain,
      },
      gates: {},
      soulx_crop_approval: cropApproval,
      secret_sha256: null,
    },
    config_activation_base: {
      schema_version: "videoforge-v2-13-production-config-activation/v1",
      checkpoint: "V2-13",
      authority: {
        mode: "APPROVED_CONFIG_RENDER_ONLY",
        config_render_only: true,
        deployment_authorized: false,
        provider_calls_authorized: false,
        credential_access_authorized: false,
        external_spend_usd: 0,
      },
      release: {},
      cloudflare: cf,
      runtime: {
        environment: "production",
        provider_mode: "production",
        gpu_transport: "DISABLED_UNQUALIFIED",
        assets_binding: "ASSETS",
        r2_binding: "PRIVATE_ARTIFACTS",
        workflow_binding: "VIDEO_WORKFLOW",
        version_metadata_binding: "CF_VERSION_METADATA",
        observability_enabled: true,
      },
    },
    release_manifest: null,
    promotion_record_base: {
      schema_version: "videoforge.v2-13-qualified-promotion/v1",
      approval: {},
      release: {},
      database: {
        activation_id: deterministicUuid(`${fullLiveAuthorityId}:database:activation`),
        promotion_id: deterministicUuid(`${fullLiveAuthorityId}:database:promotion`),
        rollback_id: deterministicUuid(`${fullLiveAuthorityId}:database:rollback`),
        migration_ledger_sha256: ledgerSha256,
      },
      lanes: {
        mage_image: {
          deployment_id: deterministicUuid(`${fullLiveAuthorityId}:mage:deployment`),
          qualification_id: deterministicUuid(`${fullLiveAuthorityId}:mage:qualification`),
        },
        soulx_avatar: {
          deployment_id: deterministicUuid(`${fullLiveAuthorityId}:soulx:deployment`),
          qualification_id: deterministicUuid(`${fullLiveAuthorityId}:soulx:qualification`),
        },
      },
      cloudflare: {
        account_id_sha256: sha256(Buffer.from(cf.account_id)),
        public_origin: cf.public_origin,
        worker_name: cf.worker_name,
        workflow_name: cf.workflow_name,
      },
    },
  };
  if (
    !exactKeys(seed, [
      "activation_record_base",
      "config_activation_base",
      "future_output_hashes_present",
      "production_input_base",
      "promotion_record_base",
      "release_manifest",
      "schema_version",
      "static_only",
    ]) ||
    seed.schema_version !== SEED_SCHEMA ||
    seed.static_only !== true ||
    seed.future_output_hashes_present !== false ||
    seed.production_input_base?.schemaVersion !== "videoforge.v213-full-live-outer-input/v1" ||
    !exactKeys(seed.production_input_base.authorityDocument, []) ||
    !exactKeys(seed.production_input_base.commandPayloads, []) ||
    seed.activation_record_base?.database?.operator_database_url_sha256 !== null ||
    seed.activation_record_base?.secret_sha256 !== null
  )
    fail("SEED_CONTRACT");
  const bytes = canonicalBytes(seed);
  return Object.freeze({ bytes, seed: Object.freeze(seed), sha256: sha256(bytes) });
}

function anchoredComponents(anchorRoot, path, code) {
  if (
    typeof anchorRoot !== "string" ||
    typeof path !== "string" ||
    !isAbsolute(anchorRoot) ||
    !isAbsolute(path) ||
    anchorRoot.includes("\0") ||
    path.includes("\0")
  )
    fail(`${code}_PATH`);
  const anchor = resolve(anchorRoot);
  const target = resolve(path);
  const rel = relative(anchor, target);
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) fail(`${code}_PATH`);
  const pieces = rel.split("/");
  let current = anchor;
  const directories = [anchor];
  for (const piece of pieces.slice(0, -1)) {
    current = resolve(current, piece);
    directories.push(current);
  }
  try {
    for (const directory of directories) {
      const status = lstatSync(directory);
      if (!status.isDirectory() || status.isSymbolicLink()) fail(`${code}_MODE_OR_TYPE`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_13_")) throw error;
    fail(`${code}_READ`);
  }
  return Object.freeze({ anchor, parent: dirname(target), target });
}

function secureParent(anchorRoot, path, code) {
  const anchored = anchoredComponents(anchorRoot, path, code);
  let status;
  try {
    status = lstatSync(anchored.parent);
  } catch {
    fail(`${code}_READ`);
  }
  if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o777) !== 0o700)
    fail(`${code}_MODE_OR_TYPE`);
  return Object.freeze({ ...anchored, status });
}

function secureRead(path, code, { anchorRoot = ROOT } = {}) {
  secureParent(anchorRoot, path, code);
  let before;
  try {
    before = lstatSync(path);
  } catch {
    fail(`${code}_READ`);
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    (before.mode & 0o777) !== 0o600 ||
    before.nlink !== 1
  )
    fail(`${code}_MODE_OR_TYPE`);
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      (opened.mode & 0o777) !== 0o600 ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      fail(`${code}_CHECK_OPEN_RACE`);
    const bytes = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor);
    const afterPath = lstatSync(path);
    if (
      afterRead.dev !== opened.dev ||
      afterRead.ino !== opened.ino ||
      afterRead.size !== opened.size ||
      afterPath.isSymbolicLink() ||
      afterPath.dev !== opened.dev ||
      afterPath.ino !== opened.ino
    )
      fail(`${code}_CHECK_OPEN_RACE`);
    closeSync(descriptor);
    descriptor = undefined;
    return bytes;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original fail-closed result.
      }
    }
    if (error instanceof Error && error.message.startsWith("V2_13_")) throw error;
    fail(`${code}_READ`);
  }
}

function gitShow(repositoryRoot, commit, path, code) {
  if (!COMMIT.test(commit ?? "")) fail(`${code}_COMMIT`);
  sourcePath(path, `${code}_PATH`);
  try {
    return execFileSync("git", ["show", `${commit}:${path}`], {
      cwd: repositoryRoot,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
  } catch {
    fail(`${code}_GIT_SHOW`);
  }
}

function gitText(repositoryRoot, args, code) {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    }).trim();
  } catch {
    fail(code);
  }
}

function assertCommitLineage(
  repositoryRoot,
  releaseSourceCommit,
  proposalRecordCommit,
  proposalPath,
  proposalSha256,
) {
  if (
    !COMMIT.test(releaseSourceCommit ?? "") ||
    !COMMIT.test(proposalRecordCommit ?? "") ||
    releaseSourceCommit === proposalRecordCommit ||
    proposalPath !== PROPOSAL_PATH ||
    !HASH.test(proposalSha256 ?? "")
  )
    fail("COMMIT_LINEAGE");
  if (
    gitText(repositoryRoot, ["rev-parse", `${releaseSourceCommit}^{commit}`], "COMMIT_LINEAGE") !==
      releaseSourceCommit ||
    gitText(repositoryRoot, ["rev-parse", `${proposalRecordCommit}^{commit}`], "COMMIT_LINEAGE") !==
      proposalRecordCommit
  )
    fail("COMMIT_LINEAGE");
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", releaseSourceCommit, proposalRecordCommit],
      {
        cwd: repositoryRoot,
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 15_000,
      },
    );
  } catch {
    fail("COMMIT_LINEAGE");
  }
  const chain = gitText(
    repositoryRoot,
    ["rev-list", "--first-parent", "--reverse", `${releaseSourceCommit}..${proposalRecordCommit}`],
    "COMMIT_LINEAGE",
  )
    .split("\n")
    .filter(Boolean);
  if (chain.length === 0) fail("COMMIT_LINEAGE");
  const allowed = new Set(PROPOSAL_RECORD_ALLOWED_DIFF_PATHS);
  const changed = new Set();
  let parent = releaseSourceCommit;
  for (const commit of chain) {
    const parents = gitText(
      repositoryRoot,
      ["rev-list", "--parents", "-n", "1", commit],
      "COMMIT_LINEAGE",
    )
      .split(/\s+/u)
      .slice(1);
    if (parents.length !== 1 || parents[0] !== parent) fail("COMMIT_LINEAGE");
    const paths = gitText(
      repositoryRoot,
      ["diff-tree", "--no-commit-id", "--no-ext-diff", "--no-renames", "--name-only", "-r", commit],
      "COMMIT_LINEAGE",
    )
      .split("\n")
      .filter(Boolean);
    if (paths.length === 0 || paths.some((path) => !allowed.has(path))) fail("COMMIT_LINEAGE");
    paths.forEach((path) => changed.add(path));
    parent = commit;
  }
  if (!changed.has(PROPOSAL_PATH)) fail("COMMIT_LINEAGE");
  const committedProposal = gitShow(
    repositoryRoot,
    proposalRecordCommit,
    proposalPath,
    "PROPOSAL_RECORD",
  );
  if (sha256(committedProposal) !== proposalSha256) fail("COMMIT_LINEAGE");
}

function assertSourceEvidenceLineage(
  repositoryRoot,
  { auditedCodeCommit, closure, factsPath, releaseSourceCommit, sourceReadinessPath },
) {
  if (
    !COMMIT.test(auditedCodeCommit ?? "") ||
    !COMMIT.test(releaseSourceCommit ?? "") ||
    auditedCodeCommit === releaseSourceCommit ||
    sourcePath(factsPath, "SOURCE_EVIDENCE_LINEAGE_PATH") !== factsPath ||
    sourcePath(sourceReadinessPath, "SOURCE_EVIDENCE_LINEAGE_PATH") !== sourceReadinessPath
  )
    fail("SOURCE_EVIDENCE_LINEAGE");
  if (
    gitText(
      repositoryRoot,
      ["rev-parse", `${auditedCodeCommit}^{commit}`],
      "SOURCE_EVIDENCE_LINEAGE",
    ) !== auditedCodeCommit ||
    gitText(
      repositoryRoot,
      ["rev-parse", `${releaseSourceCommit}^{commit}`],
      "SOURCE_EVIDENCE_LINEAGE",
    ) !== releaseSourceCommit
  )
    fail("SOURCE_EVIDENCE_LINEAGE");
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", auditedCodeCommit, releaseSourceCommit], {
      cwd: repositoryRoot,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 15_000,
    });
  } catch {
    fail("SOURCE_EVIDENCE_LINEAGE");
  }
  const chain = gitText(
    repositoryRoot,
    ["rev-list", "--first-parent", "--reverse", `${auditedCodeCommit}..${releaseSourceCommit}`],
    "SOURCE_EVIDENCE_LINEAGE",
  )
    .split("\n")
    .filter(Boolean);
  if (chain.length === 0) fail("SOURCE_EVIDENCE_LINEAGE");
  let parent = auditedCodeCommit;
  let factsObserved = false;
  let readinessObserved = false;
  for (const commit of chain) {
    const parents = gitText(
      repositoryRoot,
      ["rev-list", "--parents", "-n", "1", commit],
      "SOURCE_EVIDENCE_LINEAGE",
    )
      .split(/\s+/u)
      .slice(1);
    if (parents.length !== 1 || parents[0] !== parent) fail("SOURCE_EVIDENCE_LINEAGE");
    const rows = gitText(
      repositoryRoot,
      [
        "diff-tree",
        "--no-commit-id",
        "--no-ext-diff",
        "--find-renames",
        "--name-status",
        "-r",
        commit,
      ],
      "SOURCE_EVIDENCE_LINEAGE",
    )
      .split("\n")
      .filter(Boolean);
    if (rows.length === 0) fail("SOURCE_EVIDENCE_LINEAGE");
    for (const row of rows) {
      const [status, ...paths] = row.split("\t");
      if (
        !/^[AM]$/u.test(status) ||
        paths.length !== 1 ||
        ![factsPath, sourceReadinessPath].includes(paths[0])
      )
        fail("SOURCE_EVIDENCE_LINEAGE");
      if (paths[0] === factsPath) factsObserved = true;
      if (paths[0] === sourceReadinessPath) readinessObserved = true;
    }
    parent = commit;
  }
  if (!factsObserved || !readinessObserved) fail("SOURCE_EVIDENCE_LINEAGE");
  for (const entry of closure.entries) {
    const auditedBytes = gitShow(
      repositoryRoot,
      auditedCodeCommit,
      entry.path,
      "AUDITED_SOURCE_CLOSURE",
    );
    const releaseBytes = gitShow(
      repositoryRoot,
      releaseSourceCommit,
      entry.path,
      "RELEASE_SOURCE_CLOSURE",
    );
    if (sha256(auditedBytes) !== entry.sha256 || sha256(releaseBytes) !== entry.sha256)
      fail("SOURCE_EVIDENCE_LINEAGE_CLOSURE");
  }
}

function writeCanonicalSeed(path, bytes, { anchorRoot = ROOT, onStep } = {}) {
  const parent = secureParent(anchorRoot, path, "OUTPUT_PARENT");
  const expected = Buffer.from(bytes);
  const stageName = `.${basename(path)}.stage-${sha256(expected).slice("sha256:".length)}`;
  const temporary = resolve(parent.parent, stageName);
  const stagePrefix = `.${basename(path)}.stage-`;
  const stages = readdirSync(parent.parent).filter((name) => name.startsWith(stagePrefix));
  if (stages.some((name) => name !== stageName)) fail("OUTPUT_FOREIGN_STAGE");
  const readExactFile = (candidate, code, allowedLinks) => {
    let before;
    let descriptor;
    try {
      before = lstatSync(candidate);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        (before.mode & 0o777) !== 0o600 ||
        !allowedLinks.includes(before.nlink)
      )
        fail(`${code}_MODE_OR_TYPE`);
      descriptor = openSync(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const opened = fstatSync(descriptor);
      if (
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        opened.size !== before.size ||
        !allowedLinks.includes(opened.nlink)
      )
        fail(`${code}_CHECK_OPEN_RACE`);
      const value = readFileSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      if (Buffer.compare(value, expected) !== 0) fail("OUTPUT_REPLAY_DRIFT");
      return Object.freeze({ bytes: value, status: opened });
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          // Preserve the original result.
        }
      }
      if (error instanceof Error && error.message.startsWith("V2_13_")) throw error;
      return null;
    }
  };
  const existingStage = stages.includes(stageName)
    ? readExactFile(temporary, "OUTPUT_STAGE", [1, 2])
    : null;
  const existingFinal = readExactFile(path, "OUTPUT", [1, 2]);
  if (existingFinal) {
    let parentDescriptor;
    try {
      parentDescriptor = openSync(
        parent.parent,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
      );
      if (existingFinal.status.nlink === 2) {
        if (
          !existingStage ||
          existingStage.status.dev !== existingFinal.status.dev ||
          existingStage.status.ino !== existingFinal.status.ino
        )
          fail("OUTPUT_ORPHANED_HARDLINK");
        unlinkSync(temporary);
        fsyncSync(parentDescriptor);
      } else if (existingStage) {
        if (existingStage.status.nlink !== 1) fail("OUTPUT_STAGE_LINK_COUNT");
        unlinkSync(temporary);
        fsyncSync(parentDescriptor);
      }
      closeSync(parentDescriptor);
      parentDescriptor = undefined;
      const reconciled = secureRead(path, "OUTPUT", { anchorRoot });
      if (Buffer.compare(reconciled, expected) !== 0) fail("OUTPUT_REPLAY_DRIFT");
      return false;
    } finally {
      if (parentDescriptor !== undefined) closeSync(parentDescriptor);
    }
  }
  let descriptor;
  let parentDescriptor;
  let published = false;
  let preserveTemporary = false;
  try {
    if (!existingStage) {
      descriptor = openSync(
        temporary,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(descriptor, expected);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
    } else if (existingStage.status.nlink !== 1) {
      fail("OUTPUT_STAGE_LINK_COUNT");
    }
    onStep?.("TEMP_FSYNCED", temporary);
    parentDescriptor = openSync(
      parent.parent,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    );
    const openedParent = fstatSync(parentDescriptor);
    if (openedParent.dev !== parent.status.dev || openedParent.ino !== parent.status.ino)
      fail("OUTPUT_PARENT_CHECK_OPEN_RACE");
    onStep?.("BEFORE_PUBLISH", temporary);
    try {
      linkSync(temporary, path);
      published = true;
      fsyncSync(parentDescriptor);
      onStep?.("AFTER_PUBLISH", path);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const raced = readExactFile(path, "OUTPUT_RACE", [1, 2]);
      if (!raced) fail("OUTPUT_RACE_READ");
      if (raced.status.nlink === 2) {
        const staged = lstatSync(temporary);
        if (staged.dev !== raced.status.dev || staged.ino !== raced.status.ino)
          fail("OUTPUT_RACE_HARDLINK");
      }
    }
    unlinkSync(temporary);
    fsyncSync(parentDescriptor);
    closeSync(parentDescriptor);
    parentDescriptor = undefined;
    onStep?.(published ? "PUBLISHED" : "RACE_RECONCILED", path);
    return published;
  } catch (error) {
    preserveTemporary = error?.code === "SIMULATED_CRASH";
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original error.
      }
    }
    if (parentDescriptor !== undefined) {
      try {
        closeSync(parentDescriptor);
      } catch {
        // Preserve the original error.
      }
    }
    if (!preserveTemporary) {
      try {
        unlinkSync(temporary);
      } catch {
        // There may be no temporary file to remove.
      }
    }
    if (error instanceof Error && error.message.startsWith("V2_13_")) throw error;
    if (preserveTemporary) throw error;
    fail("OUTPUT_WRITE");
  }
}

function validateApprovalBinding({
  approvalBytes,
  expectedApprovalSha256,
  proposal,
  proposalBytes,
  proposalRecordCommit,
  proposalSha256,
  validatorBytes,
}) {
  if (!HASH.test(expectedApprovalSha256 ?? "") || sha256(approvalBytes) !== expectedApprovalSha256)
    fail("APPROVAL_SHA256");
  const payload = Buffer.from(
    JSON.stringify({
      approval: Buffer.from(approvalBytes).toString("base64"),
      proposal: Buffer.from(proposalBytes).toString("base64"),
      proposalRecordCommit,
      proposalSha256,
      releaseSourceCommit: proposal.source.release_source_commit,
    }),
  );
  const wrapper = `\nconst __fs = await import("node:fs");\nconst __payload = JSON.parse(__fs.readFileSync(0, "utf8"));\nconst __validated = validateFullLiveUserApproval({proposalBytes: Buffer.from(__payload.proposal, "base64"), approvalBytes: Buffer.from(__payload.approval, "base64"), expectedProposalSha256: __payload.proposalSha256, expectedProposalRecordCommit: __payload.proposalRecordCommit, expectedReleaseSourceCommit: __payload.releaseSourceCommit});\nprocess.stdout.write(JSON.stringify(__validated));\n`;
  let validated;
  try {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `${Buffer.from(validatorBytes).toString("utf8")}${wrapper}`,
      ],
      {
        encoding: "utf8",
        input: payload,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 15_000,
      },
    );
    validated = JSON.parse(output);
  } catch {
    fail("CANONICAL_APPROVAL_VALIDATION");
  }
  if (
    validated?.approvalSha256 !== expectedApprovalSha256 ||
    validated.proposalSha256 !== proposalSha256 ||
    validated.fullLiveAuthorityId !==
      proposal.sealing.materialization_seed_facts.full_live_authority_id ||
    validated.proposalRecordCommit !== proposalRecordCommit ||
    validated.releaseSourceCommit !== proposal.source.release_source_commit ||
    validated.staticReleaseDescriptorPath !== proposal.sealing.static_release_descriptor.path ||
    validated.staticReleaseDescriptorSha256 !== proposal.sealing.static_release_descriptor.sha256
  )
    fail("CANONICAL_APPROVAL_BINDING");
  return Object.freeze(validated);
}

function writeV213MaterializationSeed({
  approvalFile,
  approvalSha256,
  outputFile,
  proposalPath = PROPOSAL_PATH,
  proposalRecordCommit,
  proposalSha256,
  protectedInputFile,
  repositoryRoot = ROOT,
  staticReleaseDescriptorFile,
  onOutputStep,
}) {
  if (typeof repositoryRoot !== "string" || !isAbsolute(repositoryRoot)) fail("REPOSITORY_ROOT");
  if (!HASH.test(proposalSha256 ?? "")) fail("PROPOSAL_RECORD_SHA256");
  const proposalBytes = gitShow(
    repositoryRoot,
    proposalRecordCommit,
    proposalPath,
    "PROPOSAL_RECORD",
  );
  if (sha256(proposalBytes) !== proposalSha256) fail("PROPOSAL_RECORD_SHA256");
  const proposal = parseJson(proposalBytes, "PROPOSAL_RECORD");
  const binding = validateProposal(proposal, proposalPath);
  const sourceCommit = binding.sourceCommit;
  const executionControlCommit = binding.executionControlCommit;
  assertCommitLineage(
    repositoryRoot,
    executionControlCommit,
    proposalRecordCommit,
    proposalPath,
    proposalSha256,
  );
  const executionControlPaths = new Set(
    Object.values(binding.executionControlComponents ?? {}).map((component) => component.path),
  );
  for (const [name, component] of Object.entries(binding.executionControlComponents ?? {})) {
    const bytes = gitShow(
      repositoryRoot,
      executionControlCommit,
      component.path,
      "EXECUTION_CONTROL_SOURCE",
    );
    if (name !== "approval_validator" && sha256(bytes) !== component.sha256)
      fail("EXECUTION_CONTROL_SOURCE_HASH");
  }
  executionControlPaths.add(binding.factsBinding.path);
  const readSourceFile = (path) =>
    gitShow(
      repositoryRoot,
      executionControlPaths.has(path) ? executionControlCommit : sourceCommit,
      path,
      "SOURCE_RECORD",
    );
  const factsRead = readBoundSourceJson(
    { path: binding.factsBinding.path, sha256: binding.factsBinding.sha256 },
    readSourceFile,
    "FACTS",
  );
  if (Buffer.compare(factsRead.bytes, canonicalBytes(factsRead.value)) !== 0)
    fail("FACTS_NONCANONICAL");
  const facts = validateFacts(factsRead.value);
  executionControlPaths.add(facts.source_evidence.source_readiness.path);
  if (
    typeof staticReleaseDescriptorFile !== "string" ||
    typeof protectedInputFile !== "string" ||
    typeof outputFile !== "string" ||
    typeof approvalFile !== "string"
  )
    fail("PROTECTED_PATH_BINDING");
  if (
    resolve(repositoryRoot, binding.descriptor.path) !== resolve(staticReleaseDescriptorFile) ||
    resolve(repositoryRoot, facts.protected_input.path) !== resolve(protectedInputFile) ||
    resolve(outputFile) === resolve(staticReleaseDescriptorFile) ||
    resolve(outputFile) === resolve(protectedInputFile) ||
    [approvalFile, outputFile, protectedInputFile, staticReleaseDescriptorFile].some((path) => {
      const rel = relative(resolve(repositoryRoot), resolve(path));
      return rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel);
    })
  )
    fail("PROTECTED_PATH_BINDING");
  const approvalBytes = secureRead(approvalFile, "APPROVAL", { anchorRoot: repositoryRoot });
  const sourceClosureRef =
    binding.executionControlComponents?.source_closure_manifest ??
    proposal.source.exact_release_components.source_closure_manifest;
  readBoundSourceJson(sourceClosureRef, readSourceFile, "APPROVAL_SOURCE_CLOSURE");
  const approvalValidator =
    binding.executionControlComponents?.approval_validator ??
    proposal.source.exact_release_components?.approval_validator;
  if (
    !exactKeys(approvalValidator, ["path", "source_commit_tree_binding"]) ||
    approvalValidator.path !== APPROVAL_VALIDATOR_PATH ||
    !exactKeys(approvalValidator.source_commit_tree_binding, [
      "mode",
      "commit_field",
      "tree_entry_path",
      "verification",
      "embedded_current_file_sha256",
      "self_hash_forbidden",
    ]) ||
    approvalValidator.source_commit_tree_binding.mode !== "EXTERNAL_GIT_COMMIT_TREE_ENTRY" ||
    approvalValidator.source_commit_tree_binding.commit_field !==
      (binding.executionControlComponents
        ? "source.execution_control_commit"
        : "source.release_source_commit") ||
    approvalValidator.source_commit_tree_binding.tree_entry_path !== APPROVAL_VALIDATOR_PATH ||
    approvalValidator.source_commit_tree_binding.verification !==
      "GIT_SHOW_EXACT_COMMIT_PATH_THEN_SHA256" ||
    approvalValidator.source_commit_tree_binding.embedded_current_file_sha256 !== false ||
    approvalValidator.source_commit_tree_binding.self_hash_forbidden !== true
  )
    fail("APPROVAL_VALIDATOR_TREE_BINDING");
  // The validator deliberately uses an external tree-entry binding. Keeping it out of the
  // closure avoids a self-referential source-closure hash while still executing the exact bytes
  // from the proposal's immutable release source commit.
  const validatorBytes = gitShow(
    repositoryRoot,
    binding.executionControlCommit,
    approvalValidator.path,
    "APPROVAL_VALIDATOR_SOURCE",
  );
  validateApprovalBinding({
    approvalBytes,
    expectedApprovalSha256: approvalSha256,
    proposal,
    proposalBytes,
    proposalRecordCommit,
    proposalSha256,
    validatorBytes,
  });
  const staticReleaseDescriptorBytes = secureRead(
    staticReleaseDescriptorFile,
    "STATIC_DESCRIPTOR",
    {
      anchorRoot: repositoryRoot,
    },
  );
  const protectedInputBytes = secureRead(protectedInputFile, "PROTECTED_INPUT", {
    anchorRoot: repositoryRoot,
  });
  const result = buildV213MaterializationSeed({
    proposalBytes,
    proposalPath,
    protectedInputBytes,
    readSourceFile,
    staticReleaseDescriptorBytes,
    validateSourceEvidenceLineage: (input) => assertSourceEvidenceLineage(repositoryRoot, input),
  });
  const created = writeCanonicalSeed(outputFile, result.bytes, {
    anchorRoot: repositoryRoot,
    onStep: onOutputStep,
  });
  return Object.freeze({ ...result, created, outputFile });
}

function parseArgs(argv) {
  const allowed = new Set([
    "approval-file",
    "approval-sha256",
    "output-file",
    "proposal-path",
    "proposal-record-commit",
    "proposal-sha256",
    "protected-input-file",
    "repository-root",
    "static-release-descriptor-file",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    if (!token?.startsWith("--") || argv[index + 1] === undefined) fail("CLI_ARGUMENTS");
    const name = token.slice(2);
    if (!allowed.has(name) || values.has(name)) fail("CLI_ARGUMENTS");
    values.set(name, argv[index + 1]);
  }
  for (const required of [
    "approval-file",
    "approval-sha256",
    "output-file",
    "proposal-record-commit",
    "proposal-sha256",
    "protected-input-file",
    "static-release-descriptor-file",
  ])
    if (!values.has(required)) fail("CLI_ARGUMENTS");
  return values;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = writeV213MaterializationSeed({
    approvalFile: resolve(args.get("approval-file")),
    approvalSha256: args.get("approval-sha256"),
    outputFile: resolve(args.get("output-file")),
    proposalPath: args.get("proposal-path") ?? PROPOSAL_PATH,
    proposalRecordCommit: args.get("proposal-record-commit"),
    proposalSha256: args.get("proposal-sha256"),
    protectedInputFile: resolve(args.get("protected-input-file")),
    repositoryRoot: resolve(args.get("repository-root") ?? ROOT),
    staticReleaseDescriptorFile: resolve(args.get("static-release-descriptor-file")),
  });
  process.stdout.write(
    `${JSON.stringify({ created: result.created, output_file: result.outputFile, sha256: result.sha256 })}\n`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();

export {
  assertCommitLineage,
  assertSourceClosureOrder,
  assertSourceEvidenceLineage,
  buildV213MaterializationSeed,
  canonicalBytes,
  canonicalJson,
  FACTS_SCHEMA,
  main,
  PROTECTED_INPUT_SCHEMA,
  PROPOSAL_PATH,
  sha256,
  secureRead,
  validateApprovalBinding,
  writeCanonicalSeed,
  writeV213MaterializationSeed,
};
