import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const IMAGE = /^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/u;
const EVIDENCE_PATH = /^project-context\/evidence\/[A-Za-z0-9._/-]+\.json$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const HOUR_MS = 60 * 60 * 1_000;

export const V213_RELEASE_GATES = [
  "mage_certified_ledger",
  "soulx_certified_ledger",
  "v209_short_e2e",
  "v210_automatic_pilot",
  "v211_two_account_queue",
  "v212_production_length_economics",
  "release_identity_current",
  "fresh_bounded_two_lane_smoke",
  "independent_zero_drain",
  "settled_billing",
  "rollback_ready",
  "operations_runbooks_ready",
  "backup_restore_ready",
  "security_clear",
  "production_transport_real",
] as const;
export type V213ReleaseGate = (typeof V213_RELEASE_GATES)[number];

export type V213EvidenceClass = "LIVE_PROVIDER" | "LIVE_HOSTED" | "INDEPENDENT_RELEASE_AUDIT";
export type V213Metric = string | number | boolean;

export interface V213ReleaseIdentity {
  readonly schemaVersion: "videoforge-v213-release-identity/v1";
  readonly sourceCommit: string;
  readonly deployedSourceCommit: string;
  readonly deployedExecutableSha256: Sha256;
  readonly productionUrlSha256: Sha256;
  readonly deploymentConfigSha256: Sha256;
  readonly contractBundleSha256: Sha256;
  readonly mageImageDigest: string;
  readonly soulxImageDigest: string;
  readonly mageEndpointConfigSha256: Sha256;
  readonly soulxEndpointConfigSha256: Sha256;
  readonly mageCertificationLedgerSha256: Sha256;
  readonly soulxCertificationLedgerSha256: Sha256;
  readonly v209AcceptanceSha256: Sha256;
  readonly v210AcceptanceSha256: Sha256;
  readonly v211AcceptanceSha256: Sha256;
  readonly v212AcceptanceSha256: Sha256;
}

export interface V213ReleaseEvidenceArtifact {
  readonly schemaVersion: "videoforge-v213-release-evidence-artifact/v1";
  readonly gate: V213ReleaseGate;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface V213VerifiedReleaseEvidence {
  readonly verifierId: "videoforge-independent-v213-release-evidence-v1";
  readonly accepted: true;
  readonly gate: V213ReleaseGate;
  readonly canonicalEvidenceSha256: Sha256;
  readonly verifierSignatureSha256: Sha256;
  readonly observerId: string;
  readonly evidencePath: string;
  readonly evidenceSha256: Sha256;
  readonly evidenceClass: V213EvidenceClass;
  readonly observedAt: string;
  readonly releaseIdentitySha256: Sha256;
  readonly sourceCommit: string;
  readonly deployedSourceCommit: string;
  readonly contractBundleSha256: Sha256;
  readonly upstreamEvidenceSha256: Sha256 | null;
  readonly fixtureOrFakeTransportUsed: false;
  readonly claims: readonly string[];
  readonly metrics: Readonly<Record<string, V213Metric>>;
}

export interface V213ReleaseEvidenceVerifier {
  /** Verifies an opaque durable artifact; the release gate never trusts artifact booleans itself. */
  verify(artifact: V213ReleaseEvidenceArtifact): Promise<V213VerifiedReleaseEvidence>;
}

export interface V213InvalidReleaseGate {
  readonly gate: V213ReleaseGate;
  readonly code: string;
}

export interface V213ReleaseCertificationLedger {
  readonly schemaVersion: "videoforge-v213-release-certification-ledger/v1";
  readonly evaluatedAt: string;
  readonly releaseIdentitySha256: Sha256;
  readonly reusableGates: readonly V213ReleaseGate[];
  readonly invalidGates: readonly V213InvalidReleaseGate[];
  readonly missingGates: readonly V213ReleaseGate[];
  readonly releaseStatus: "release_blocked" | "release_certified";
  readonly liveReleaseAuthorized: false;
  readonly requiresExplicitReleaseAuthority: true;
  readonly ledgerSha256: Sha256;
}

const REQUIRED_CLASS: Readonly<Record<V213ReleaseGate, V213EvidenceClass>> = Object.freeze({
  mage_certified_ledger: "LIVE_PROVIDER",
  soulx_certified_ledger: "LIVE_PROVIDER",
  v209_short_e2e: "LIVE_HOSTED",
  v210_automatic_pilot: "LIVE_HOSTED",
  v211_two_account_queue: "LIVE_HOSTED",
  v212_production_length_economics: "LIVE_HOSTED",
  release_identity_current: "INDEPENDENT_RELEASE_AUDIT",
  fresh_bounded_two_lane_smoke: "LIVE_PROVIDER",
  independent_zero_drain: "LIVE_PROVIDER",
  settled_billing: "LIVE_PROVIDER",
  rollback_ready: "INDEPENDENT_RELEASE_AUDIT",
  operations_runbooks_ready: "INDEPENDENT_RELEASE_AUDIT",
  backup_restore_ready: "INDEPENDENT_RELEASE_AUDIT",
  security_clear: "INDEPENDENT_RELEASE_AUDIT",
  production_transport_real: "INDEPENDENT_RELEASE_AUDIT",
});

const REQUIRED_CLAIMS: Readonly<Record<V213ReleaseGate, readonly string[]>> = Object.freeze({
  mage_certified_ledger: Object.freeze([
    "certified_ledger_qualified",
    "lineage_current",
    "billing_settled",
    "terminal_jobs",
    "zero_workers",
  ]),
  soulx_certified_ledger: Object.freeze([
    "certified_ledger_qualified",
    "lineage_current",
    "billing_settled",
    "terminal_jobs",
    "zero_workers",
  ]),
  v209_short_e2e: Object.freeze([
    "real_hosted_chrome",
    "private_output_readback",
    "no_manual_media_edit",
    "terminal_jobs",
    "zero_workers",
  ]),
  v210_automatic_pilot: Object.freeze([
    "automatic_3_to_5_minute_output",
    "every_cut_reviewed",
    "user_visual_decision_accepted",
    "settled_itemized_cost",
    "zero_workers",
  ]),
  v211_two_account_queue: Object.freeze([
    "two_distinct_accounts",
    "one_active_per_account",
    "two_active_globally",
    "fair_wait_and_promotion",
    "tenant_private",
    "two_readers_per_lane",
    "config_restored",
    "zero_jobs_zero_workers",
  ]),
  v212_production_length_economics: Object.freeze([
    "automatic_29_to_31_minute_output",
    "quality_accepted",
    "user_decision_accepted",
    "settled_cost_under_hard_ceiling",
    "terminal_jobs",
    "zero_workers",
  ]),
  release_identity_current: Object.freeze([
    "source_current",
    "deployment_current",
    "contracts_current",
    "lane_identities_current",
    "production_url_verified",
  ]),
  fresh_bounded_two_lane_smoke: Object.freeze([
    "one_mage_dispatch",
    "one_soulx_dispatch",
    "bounded_spend",
    "durable_readback",
    "exact_release_identity",
  ]),
  independent_zero_drain: Object.freeze([
    "independent_observation",
    "zero_endpoint_jobs",
    "zero_mage_workers",
    "zero_soulx_workers",
    "no_unknown_liability",
  ]),
  settled_billing: Object.freeze([
    "all_variable_billing_settled",
    "duplicate_cost_visible",
    "recurring_charges_disclosed",
  ]),
  rollback_ready: Object.freeze([
    "rollback_identity_pinned",
    "rollback_readback_passed",
    "release_current_restored",
  ]),
  operations_runbooks_ready: Object.freeze([
    "stuck_job_runbook",
    "provider_outage_runbook",
    "billing_runbook",
    "rollback_runbook",
  ]),
  backup_restore_ready: Object.freeze([
    "backup_readback_passed",
    "restore_evidence_accepted",
    "schema_migration_disposition_recorded",
  ]),
  security_clear: Object.freeze([
    "p0_zero",
    "p1_zero",
    "auth_tenant_boundary_passed",
    "ssrf_path_upload_boundary_passed",
    "secret_log_scan_passed",
    "cost_amplification_guards_passed",
    "legacy_runtime_bundle_scan_passed",
  ]),
  production_transport_real: Object.freeze([
    "hosted_client_api_truth",
    "fixture_controls_absent",
    "fake_gpu_absent",
    "fake_transport_absent",
    "manual_pod_controls_absent",
    "legacy_dispatch_exports_absent",
  ]),
});

const EXPECTED_METRIC_KEYS: Readonly<Record<V213ReleaseGate, readonly string[]>> = Object.freeze({
  mage_certified_ledger: Object.freeze([
    "qualified",
    "billingSettled",
    "terminalJobs",
    "activeWorkers",
  ]),
  soulx_certified_ledger: Object.freeze([
    "qualified",
    "billingSettled",
    "terminalJobs",
    "activeWorkers",
  ]),
  v209_short_e2e: Object.freeze([
    "durationSeconds",
    "chromeAccepted",
    "privateReadbackPassed",
    "terminalJobs",
    "totalActiveWorkers",
  ]),
  v210_automatic_pilot: Object.freeze([
    "durationSeconds",
    "everyCutReviewed",
    "userVisualDecisionAccepted",
    "variableCostSettled",
    "terminalJobs",
    "totalActiveWorkers",
  ]),
  v211_two_account_queue: Object.freeze([
    "distinctAccounts",
    "maxActivePerAccount",
    "maxActiveGlobal",
    "maxGpuWorkers",
    "fairPromotionPassed",
    "foreignAccessCount",
    "twoReadersPerLanePassed",
    "volumesUnchanged",
    "configRestored",
    "terminalJobs",
    "endpointJobs",
    "totalActiveWorkers",
  ]),
  v212_production_length_economics: Object.freeze([
    "durationSeconds",
    "qualityAccepted",
    "userDecisionAccepted",
    "billingSettled",
    "variableCostMicroUsd",
    "terminalJobs",
    "totalActiveWorkers",
  ]),
  release_identity_current: Object.freeze([
    "sourceCurrent",
    "deploymentCurrent",
    "contractsCurrent",
    "laneIdentitiesCurrent",
    "productionUrlVerified",
  ]),
  fresh_bounded_two_lane_smoke: Object.freeze([
    "mageDispatchCount",
    "soulxDispatchCount",
    "maximumSpendMicroUsd",
    "mageReadbackPassed",
    "soulxReadbackPassed",
  ]),
  independent_zero_drain: Object.freeze([
    "endpointJobs",
    "mageWorkers",
    "soulxWorkers",
    "unknownLiabilities",
  ]),
  settled_billing: Object.freeze([
    "billingSettled",
    "unsettledItems",
    "totalVariableCostMicroUsd",
    "possibleDuplicateCostMicroUsd",
    "recurringChargesDisclosed",
  ]),
  rollback_ready: Object.freeze([
    "rollbackIdentityPinned",
    "rollbackReadbackPassed",
    "releaseCurrentRestored",
  ]),
  operations_runbooks_ready: Object.freeze([
    "stuckJobRunbookSha256",
    "providerOutageRunbookSha256",
    "billingRunbookSha256",
    "rollbackRunbookSha256",
  ]),
  backup_restore_ready: Object.freeze([
    "backupReadbackPassed",
    "restoreEvidenceAccepted",
    "schemaMigrationDisposition",
  ]),
  security_clear: Object.freeze([
    "p0Count",
    "p1Count",
    "authTenantPassed",
    "ssrfPathUploadPassed",
    "secretLogScanPassed",
    "costAmplificationGuardsPassed",
    "legacyRuntimeBundleScanPassed",
  ]),
  production_transport_real: Object.freeze([
    "hostedClientApiTruth",
    "fixtureControlsInBundle",
    "fakeGpuProfileInBundle",
    "fakeTransportInBundle",
    "manualPodControlsInBundle",
    "legacyDispatchExportsInBundle",
  ]),
});

const UPSTREAM_HASH_FIELD: Readonly<Partial<Record<V213ReleaseGate, keyof V213ReleaseIdentity>>> =
  Object.freeze({
    mage_certified_ledger: "mageCertificationLedgerSha256",
    soulx_certified_ledger: "soulxCertificationLedgerSha256",
    v209_short_e2e: "v209AcceptanceSha256",
    v210_automatic_pilot: "v210AcceptanceSha256",
    v211_two_account_queue: "v211AcceptanceSha256",
    v212_production_length_economics: "v212AcceptanceSha256",
  });

const parseUtc = (value: string, code: string): number => {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(code);
  }
  return milliseconds;
};

const assertReleaseIdentity = (identity: V213ReleaseIdentity): void => {
  if (identity.schemaVersion !== "videoforge-v213-release-identity/v1") {
    throw new Error("V213_RELEASE_IDENTITY_SCHEMA_INVALID");
  }
  if (
    !COMMIT.test(identity.sourceCommit) ||
    !COMMIT.test(identity.deployedSourceCommit) ||
    identity.sourceCommit !== identity.deployedSourceCommit
  ) {
    throw new Error("V213_RELEASE_SOURCE_DEPLOYMENT_DRIFT");
  }
  for (const value of [
    identity.deployedExecutableSha256,
    identity.productionUrlSha256,
    identity.deploymentConfigSha256,
    identity.contractBundleSha256,
    identity.mageEndpointConfigSha256,
    identity.soulxEndpointConfigSha256,
    identity.mageCertificationLedgerSha256,
    identity.soulxCertificationLedgerSha256,
    identity.v209AcceptanceSha256,
    identity.v210AcceptanceSha256,
    identity.v211AcceptanceSha256,
    identity.v212AcceptanceSha256,
  ]) {
    if (!SHA256.test(value)) throw new Error("V213_RELEASE_IDENTITY_HASH_INVALID");
  }
  if (!IMAGE.test(identity.mageImageDigest) || !IMAGE.test(identity.soulxImageDigest)) {
    throw new Error("V213_RELEASE_IMAGE_DIGEST_INVALID");
  }
  if (identity.mageImageDigest === identity.soulxImageDigest) {
    throw new Error("V213_RELEASE_LANE_IMAGE_IDENTITIES_NOT_DISTINCT");
  }
};

export const hashV213ReleaseIdentity = (identity: V213ReleaseIdentity): Sha256 => {
  assertReleaseIdentity(identity);
  return canonicalSha256(identity);
};

const metricKeysAreExact = (gate: V213ReleaseGate, metrics: Readonly<Record<string, V213Metric>>) =>
  JSON.stringify(Object.keys(metrics).sort()) ===
  JSON.stringify([...EXPECTED_METRIC_KEYS[gate]].sort());

const hasExactClaims = (gate: V213ReleaseGate, claims: readonly string[]): boolean =>
  new Set(claims).size === claims.length &&
  JSON.stringify([...claims].sort()) === JSON.stringify([...REQUIRED_CLAIMS[gate]].sort());

const metricsPass = (
  gate: V213ReleaseGate,
  metrics: Readonly<Record<string, V213Metric>>,
): boolean => {
  if (!metricKeysAreExact(gate, metrics)) return false;
  switch (gate) {
    case "mage_certified_ledger":
    case "soulx_certified_ledger":
      return (
        metrics.qualified === true &&
        metrics.billingSettled === true &&
        metrics.terminalJobs === 0 &&
        metrics.activeWorkers === 0
      );
    case "v209_short_e2e":
      return (
        typeof metrics.durationSeconds === "number" &&
        metrics.durationSeconds >= 30 &&
        metrics.durationSeconds <= 60 &&
        metrics.chromeAccepted === true &&
        metrics.privateReadbackPassed === true &&
        metrics.terminalJobs === 0 &&
        metrics.totalActiveWorkers === 0
      );
    case "v210_automatic_pilot":
      return (
        typeof metrics.durationSeconds === "number" &&
        metrics.durationSeconds >= 180 &&
        metrics.durationSeconds <= 300 &&
        metrics.everyCutReviewed === true &&
        metrics.userVisualDecisionAccepted === true &&
        metrics.variableCostSettled === true &&
        metrics.terminalJobs === 0 &&
        metrics.totalActiveWorkers === 0
      );
    case "v211_two_account_queue":
      return (
        metrics.distinctAccounts === 2 &&
        metrics.maxActivePerAccount === 1 &&
        metrics.maxActiveGlobal === 2 &&
        metrics.maxGpuWorkers === 4 &&
        metrics.fairPromotionPassed === true &&
        metrics.foreignAccessCount === 0 &&
        metrics.twoReadersPerLanePassed === true &&
        metrics.volumesUnchanged === true &&
        metrics.configRestored === true &&
        metrics.terminalJobs === 0 &&
        metrics.endpointJobs === 0 &&
        metrics.totalActiveWorkers === 0
      );
    case "v212_production_length_economics":
      return (
        typeof metrics.durationSeconds === "number" &&
        metrics.durationSeconds >= 29 * 60 &&
        metrics.durationSeconds <= 31 * 60 &&
        metrics.qualityAccepted === true &&
        metrics.userDecisionAccepted === true &&
        metrics.billingSettled === true &&
        Number.isSafeInteger(metrics.variableCostMicroUsd) &&
        (metrics.variableCostMicroUsd as number) >= 0 &&
        (metrics.variableCostMicroUsd as number) <= 2_000_000 &&
        metrics.terminalJobs === 0 &&
        metrics.totalActiveWorkers === 0
      );
    case "release_identity_current":
      return Object.values(metrics).every((value) => value === true);
    case "fresh_bounded_two_lane_smoke":
      return (
        metrics.mageDispatchCount === 1 &&
        metrics.soulxDispatchCount === 1 &&
        Number.isSafeInteger(metrics.maximumSpendMicroUsd) &&
        (metrics.maximumSpendMicroUsd as number) > 0 &&
        metrics.mageReadbackPassed === true &&
        metrics.soulxReadbackPassed === true
      );
    case "independent_zero_drain":
      return (
        metrics.endpointJobs === 0 &&
        metrics.mageWorkers === 0 &&
        metrics.soulxWorkers === 0 &&
        metrics.unknownLiabilities === 0
      );
    case "settled_billing":
      return (
        metrics.billingSettled === true &&
        metrics.unsettledItems === 0 &&
        Number.isSafeInteger(metrics.totalVariableCostMicroUsd) &&
        (metrics.totalVariableCostMicroUsd as number) >= 0 &&
        Number.isSafeInteger(metrics.possibleDuplicateCostMicroUsd) &&
        (metrics.possibleDuplicateCostMicroUsd as number) >= 0 &&
        metrics.recurringChargesDisclosed === true
      );
    case "rollback_ready":
      return Object.values(metrics).every((value) => value === true);
    case "operations_runbooks_ready":
      return Object.values(metrics).every(
        (value) => typeof value === "string" && SHA256.test(value),
      );
    case "backup_restore_ready":
      return (
        metrics.backupReadbackPassed === true &&
        metrics.restoreEvidenceAccepted === true &&
        (metrics.schemaMigrationDisposition === "DISPOSABLE_RESTORE_COMPLETED" ||
          metrics.schemaMigrationDisposition === "V206_RESTORE_REUSED_NO_SCHEMA_CHANGE")
      );
    case "security_clear":
      return (
        metrics.p0Count === 0 &&
        metrics.p1Count === 0 &&
        metrics.authTenantPassed === true &&
        metrics.ssrfPathUploadPassed === true &&
        metrics.secretLogScanPassed === true &&
        metrics.costAmplificationGuardsPassed === true &&
        metrics.legacyRuntimeBundleScanPassed === true
      );
    case "production_transport_real":
      return (
        metrics.hostedClientApiTruth === true &&
        metrics.fixtureControlsInBundle === false &&
        metrics.fakeGpuProfileInBundle === false &&
        metrics.fakeTransportInBundle === false &&
        metrics.manualPodControlsInBundle === false &&
        metrics.legacyDispatchExportsInBundle === false
      );
  }
};

const freshnessHours = (gate: V213ReleaseGate): number | null => {
  if (
    gate === "fresh_bounded_two_lane_smoke" ||
    gate === "independent_zero_drain" ||
    gate === "settled_billing"
  )
    return 2;
  if (
    gate === "mage_certified_ledger" ||
    gate === "soulx_certified_ledger" ||
    gate === "release_identity_current" ||
    gate === "rollback_ready" ||
    gate === "operations_runbooks_ready" ||
    gate === "backup_restore_ready" ||
    gate === "security_clear" ||
    gate === "production_transport_real"
  )
    return 24;
  return null;
};

const invalidEvidenceCode = (input: {
  readonly artifact: V213ReleaseEvidenceArtifact;
  readonly verification: V213VerifiedReleaseEvidence;
  readonly identity: V213ReleaseIdentity;
  readonly identitySha256: Sha256;
  readonly evaluatedAtMs: number;
}): string | undefined => {
  const { artifact, verification, identity, identitySha256, evaluatedAtMs } = input;
  if (
    artifact.schemaVersion !== "videoforge-v213-release-evidence-artifact/v1" ||
    artifact.gate !== verification.gate ||
    verification.verifierId !== "videoforge-independent-v213-release-evidence-v1" ||
    verification.accepted !== true ||
    !V213_RELEASE_GATES.includes(verification.gate)
  )
    return "V213_RELEASE_EVIDENCE_SCHEMA_INVALID";
  if (canonicalSha256(artifact) !== verification.canonicalEvidenceSha256) {
    return "V213_RELEASE_EVIDENCE_CONTENT_MISMATCH";
  }
  if (canonicalSha256(artifact.evidence) !== verification.evidenceSha256) {
    return "V213_RELEASE_EVIDENCE_HASH_MISMATCH";
  }
  if (
    !SHA256.test(verification.verifierSignatureSha256) ||
    !SHA256.test(verification.evidenceSha256) ||
    !IDENTIFIER.test(verification.observerId)
  )
    return "V213_RELEASE_EVIDENCE_SIGNATURE_INVALID";
  if (
    !EVIDENCE_PATH.test(verification.evidencePath) ||
    verification.evidencePath.includes("..") ||
    verification.evidenceClass !== REQUIRED_CLASS[verification.gate] ||
    verification.fixtureOrFakeTransportUsed !== false
  )
    return "V213_RELEASE_EVIDENCE_PROVENANCE_INVALID";
  if (
    verification.releaseIdentitySha256 !== identitySha256 ||
    verification.sourceCommit !== identity.sourceCommit ||
    verification.deployedSourceCommit !== identity.deployedSourceCommit ||
    verification.contractBundleSha256 !== identity.contractBundleSha256
  )
    return "V213_RELEASE_EVIDENCE_IDENTITY_MISMATCH";
  const upstreamField = UPSTREAM_HASH_FIELD[verification.gate];
  const expectedUpstream = upstreamField ? identity[upstreamField] : null;
  if (verification.upstreamEvidenceSha256 !== expectedUpstream) {
    return "V213_RELEASE_UPSTREAM_EVIDENCE_MISMATCH";
  }
  let observedAtMs: number;
  try {
    observedAtMs = parseUtc(verification.observedAt, "V213_RELEASE_OBSERVED_AT_INVALID");
  } catch (error) {
    return error instanceof Error ? error.message : "V213_RELEASE_OBSERVED_AT_INVALID";
  }
  const maximumAgeHours = freshnessHours(verification.gate);
  if (
    observedAtMs > evaluatedAtMs ||
    (maximumAgeHours !== null && evaluatedAtMs - observedAtMs > maximumAgeHours * HOUR_MS)
  )
    return "V213_RELEASE_EVIDENCE_STALE";
  if (!hasExactClaims(verification.gate, verification.claims)) {
    return "V213_RELEASE_CLAIMS_INCOMPLETE";
  }
  if (!metricsPass(verification.gate, verification.metrics)) {
    return "V213_RELEASE_METRICS_NOT_ACCEPTED";
  }
  return undefined;
};

export const buildV213ReleaseCertificationLedger = async (input: {
  readonly releaseIdentity: V213ReleaseIdentity;
  readonly evidenceArtifacts: Readonly<
    Partial<Record<V213ReleaseGate, V213ReleaseEvidenceArtifact>>
  >;
  readonly verifier: V213ReleaseEvidenceVerifier;
  readonly evaluatedAt: string;
}): Promise<V213ReleaseCertificationLedger> => {
  const identitySha256 = hashV213ReleaseIdentity(input.releaseIdentity);
  const evaluatedAtMs = parseUtc(input.evaluatedAt, "V213_RELEASE_EVALUATED_AT_INVALID");
  const reusableGates: V213ReleaseGate[] = [];
  const invalidGates: V213InvalidReleaseGate[] = [];
  const acceptedEvidence = new Map<V213ReleaseGate, V213VerifiedReleaseEvidence>();

  for (const gate of V213_RELEASE_GATES) {
    const artifact = input.evidenceArtifacts[gate];
    if (!artifact) continue;
    if (artifact.gate !== gate) {
      invalidGates.push({ gate, code: "V213_RELEASE_EVIDENCE_GATE_MISMATCH" });
      continue;
    }
    let verification: V213VerifiedReleaseEvidence;
    try {
      verification = await input.verifier.verify(artifact);
    } catch {
      invalidGates.push({ gate, code: "V213_RELEASE_EVIDENCE_VERIFICATION_FAILED" });
      continue;
    }
    const code = invalidEvidenceCode({
      artifact,
      verification,
      identity: input.releaseIdentity,
      identitySha256,
      evaluatedAtMs,
    });
    if (code) invalidGates.push({ gate, code });
    else acceptedEvidence.set(gate, verification);
  }

  const smoke = acceptedEvidence.get("fresh_bounded_two_lane_smoke");
  const drain = acceptedEvidence.get("independent_zero_drain");
  if (drain && !smoke) {
    invalidGates.push({
      gate: "independent_zero_drain",
      code: "V213_RELEASE_DRAIN_REQUIRES_SMOKE",
    });
    acceptedEvidence.delete("independent_zero_drain");
  } else if (smoke && drain) {
    if (
      drain.observerId === smoke.observerId ||
      Date.parse(drain.observedAt) <= Date.parse(smoke.observedAt)
    ) {
      invalidGates.push({
        gate: "independent_zero_drain",
        code: "V213_RELEASE_DRAIN_NOT_INDEPENDENT_OR_ORDERED",
      });
      acceptedEvidence.delete("independent_zero_drain");
    }
  }
  const acceptedDrain = acceptedEvidence.get("independent_zero_drain");
  const billing = acceptedEvidence.get("settled_billing");
  if (billing && !acceptedDrain) {
    invalidGates.push({
      gate: "settled_billing",
      code: "V213_RELEASE_BILLING_REQUIRES_DRAIN",
    });
    acceptedEvidence.delete("settled_billing");
  } else if (
    billing &&
    acceptedDrain &&
    Date.parse(billing.observedAt) <= Date.parse(acceptedDrain.observedAt)
  ) {
    invalidGates.push({
      gate: "settled_billing",
      code: "V213_RELEASE_BILLING_PRECEDES_DRAIN",
    });
    acceptedEvidence.delete("settled_billing");
  }

  for (const gate of V213_RELEASE_GATES) {
    if (acceptedEvidence.has(gate)) reusableGates.push(gate);
  }
  const missingGates = V213_RELEASE_GATES.filter((gate) => !acceptedEvidence.has(gate));
  const releaseStatus = missingGates.length === 0 ? "release_certified" : "release_blocked";
  const unsigned = Object.freeze({
    schemaVersion: "videoforge-v213-release-certification-ledger/v1" as const,
    evaluatedAt: input.evaluatedAt,
    releaseIdentitySha256: identitySha256,
    reusableGates: Object.freeze(reusableGates),
    invalidGates: Object.freeze(invalidGates.map((gate) => Object.freeze(gate))),
    missingGates: Object.freeze(missingGates),
    releaseStatus,
    liveReleaseAuthorized: false as const,
    requiresExplicitReleaseAuthority: true as const,
  });
  return Object.freeze({ ...unsigned, ledgerSha256: canonicalSha256(unsigned) });
};
