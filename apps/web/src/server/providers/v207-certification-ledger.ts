import { createHash } from "node:crypto";

import { canonicalizeJson } from "@videoforge/contracts";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_COMMIT = /^[a-f0-9]{40}$/u;
const EVIDENCE_PATH = /^project-context\/evidence\/[A-Za-z0-9._/-]+\.json$/u;
const MAX_VALIDITY_MS = 24 * 60 * 60 * 1_000;

export const V207_CERTIFICATION_GATES = [
  "identity_output",
  "cancellation_timeout",
  "max2_concurrency",
] as const;
export type V207CertificationGate = (typeof V207_CERTIFICATION_GATES)[number];
export type V207CertificationProfile = "max1" | "max2";

export const V207_CERTIFICATION_CLAIMS = [
  "durable_outputs",
  "distinct_replacement_identity",
  "cold_warm",
  "cancel",
  "timeout",
  "max2_two_readers",
  "max1_restored",
  "billing_settled",
  "terminal_jobs",
  "zero_workers",
  "volume_unchanged",
] as const;
export type V207CertificationClaim = (typeof V207_CERTIFICATION_CLAIMS)[number];

const COMMON_CLAIMS = [
  "billing_settled",
  "terminal_jobs",
  "zero_workers",
  "volume_unchanged",
] as const;
const REQUIRED_CLAIMS = Object.freeze({
  identity_output: Object.freeze([
    "durable_outputs",
    "distinct_replacement_identity",
    "cold_warm",
    ...COMMON_CLAIMS,
  ]),
  cancellation_timeout: Object.freeze(["cancel", "timeout", ...COMMON_CLAIMS]),
  max2_concurrency: Object.freeze(["max2_two_readers", "max1_restored", ...COMMON_CLAIMS]),
} satisfies Record<V207CertificationGate, readonly V207CertificationClaim[]>);
const REQUIRED_PROFILE: Readonly<Record<V207CertificationGate, V207CertificationProfile>> =
  Object.freeze({
    identity_output: "max1",
    cancellation_timeout: "max1",
    max2_concurrency: "max2",
  });

export interface V207CertificationLineage {
  readonly schema_version: "videoforge.v2-07-certification-lineage/v1";
  readonly worker_image_digest: string;
  readonly image_source_commit: string;
  readonly qualification_source_sha256: string;
  readonly dependency_lock_sha256: string;
  readonly acceptance_contract_sha256: string;
  readonly model_manifest_sha256: string;
  readonly volume_id_sha256: string;
  readonly volume_manifest_sha256: string;
  readonly endpoint_template_sha256: string;
  readonly region: "EU-RO-1";
  readonly gpu: "NVIDIA GeForce RTX 4090";
  readonly max1_config_sha256: string;
  readonly max2_config_sha256: string;
}

export interface V207AtomicEvidenceArtifact {
  readonly schema_version: "videoforge.v2-07-atomic-evidence-artifact/v1";
  readonly gate: V207CertificationGate;
  readonly observed_endpoint_id_sha256: string;
  readonly receipts_sha256: string;
  readonly timing_sha256: string;
  readonly cost_sha256: string;
  readonly cleanup_sha256: string;
  readonly claims: readonly V207CertificationClaim[];
}

export interface V207AtomicCertificationEvidence {
  readonly schema_version: "videoforge.v2-07-atomic-certification/v1";
  readonly gate: V207CertificationGate;
  readonly passed: true;
  readonly lineage_sha256: string;
  readonly configuration_profile: V207CertificationProfile;
  readonly configuration_sha256: string;
  readonly observed_at: string;
  readonly valid_until: string;
  readonly evidence_path: string;
  readonly evidence_sha256: string;
  readonly claims: readonly V207CertificationClaim[];
}

export interface V207InvalidCertificationGate {
  readonly gate: V207CertificationGate;
  readonly code: string;
}

export interface V207CertificationLedger {
  readonly schema_version: "videoforge.v2-07-certification-ledger/v1";
  readonly lineage_sha256: string;
  readonly evaluated_at: string;
  readonly maximum_evidence_validity_hours: 24;
  readonly reusable_gates: readonly V207CertificationGate[];
  readonly invalid_gates: readonly V207InvalidCertificationGate[];
  readonly missing_gates: readonly V207CertificationGate[];
  readonly qualified: boolean;
  readonly eligible_for_soulx_certification: boolean;
  readonly ledger_sha256: string;
}

const sha256 = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex")}`;
export const hashV207AtomicEvidenceArtifact = (artifact: V207AtomicEvidenceArtifact): string =>
  sha256(artifact);
export const hashV207CertificationLineage = (lineage: V207CertificationLineage): string => {
  assertV207CertificationLineage(lineage);
  return sha256(lineage);
};
const parseUtc = (value: string, code: string): number => {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(code);
  }
  return milliseconds;
};

export const assertV207CertificationLineage = (lineage: V207CertificationLineage): void => {
  if (lineage.schema_version !== "videoforge.v2-07-certification-lineage/v1") {
    throw new Error("V207_CERTIFICATION_LINEAGE_SCHEMA_INVALID");
  }
  for (const value of [
    lineage.worker_image_digest,
    lineage.qualification_source_sha256,
    lineage.dependency_lock_sha256,
    lineage.acceptance_contract_sha256,
    lineage.model_manifest_sha256,
    lineage.volume_id_sha256,
    lineage.volume_manifest_sha256,
    lineage.endpoint_template_sha256,
    lineage.max1_config_sha256,
    lineage.max2_config_sha256,
  ]) {
    if (!SHA256.test(value)) throw new Error("V207_CERTIFICATION_LINEAGE_HASH_INVALID");
  }
  if (!SOURCE_COMMIT.test(lineage.image_source_commit)) {
    throw new Error("V207_CERTIFICATION_SOURCE_COMMIT_INVALID");
  }
  if (lineage.region !== "EU-RO-1" || lineage.gpu !== "NVIDIA GeForce RTX 4090") {
    throw new Error("V207_CERTIFICATION_PLACEMENT_INVALID");
  }
  if (lineage.max1_config_sha256 === lineage.max2_config_sha256) {
    throw new Error("V207_CERTIFICATION_CONFIG_PROFILES_NOT_DISTINCT");
  }
};

const invalidCodeForEvidence = (input: {
  readonly evidence: V207AtomicCertificationEvidence;
  readonly artifact: V207AtomicEvidenceArtifact | undefined;
  readonly lineage: V207CertificationLineage;
  readonly lineageSha256: string;
  readonly evaluatedAtMs: number;
}): string | undefined => {
  const { evidence, artifact, lineage, lineageSha256, evaluatedAtMs } = input;
  if (
    evidence.schema_version !== "videoforge.v2-07-atomic-certification/v1" ||
    evidence.passed !== true ||
    !V207_CERTIFICATION_GATES.includes(evidence.gate)
  )
    return "V207_CERTIFICATION_EVIDENCE_SCHEMA_INVALID";
  if (evidence.lineage_sha256 !== lineageSha256) return "V207_CERTIFICATION_LINEAGE_MISMATCH";
  const requiredProfile = REQUIRED_PROFILE[evidence.gate];
  const requiredConfigurationHash =
    requiredProfile === "max1" ? lineage.max1_config_sha256 : lineage.max2_config_sha256;
  if (
    evidence.configuration_profile !== requiredProfile ||
    evidence.configuration_sha256 !== requiredConfigurationHash
  )
    return "V207_CERTIFICATION_CONFIGURATION_MISMATCH";
  if (!EVIDENCE_PATH.test(evidence.evidence_path) || evidence.evidence_path.includes("..")) {
    return "V207_CERTIFICATION_EVIDENCE_PATH_INVALID";
  }
  if (!SHA256.test(evidence.evidence_sha256)) return "V207_CERTIFICATION_EVIDENCE_HASH_INVALID";
  if (!artifact || hashV207AtomicEvidenceArtifact(artifact) !== evidence.evidence_sha256) {
    return "V207_CERTIFICATION_EVIDENCE_CONTENT_MISMATCH";
  }
  if (
    artifact.schema_version !== "videoforge.v2-07-atomic-evidence-artifact/v1" ||
    artifact.gate !== evidence.gate
  )
    return "V207_CERTIFICATION_EVIDENCE_ARTIFACT_SCHEMA_INVALID";
  for (const value of [
    artifact.observed_endpoint_id_sha256,
    artifact.receipts_sha256,
    artifact.timing_sha256,
    artifact.cost_sha256,
    artifact.cleanup_sha256,
  ]) {
    if (!SHA256.test(value)) return "V207_CERTIFICATION_EVIDENCE_ARTIFACT_HASH_INVALID";
  }
  let observedAtMs: number;
  let validUntilMs: number;
  try {
    observedAtMs = parseUtc(evidence.observed_at, "V207_CERTIFICATION_OBSERVED_AT_INVALID");
    validUntilMs = parseUtc(evidence.valid_until, "V207_CERTIFICATION_VALID_UNTIL_INVALID");
  } catch (error) {
    return error instanceof Error ? error.message : "V207_CERTIFICATION_TIME_INVALID";
  }
  if (
    validUntilMs <= observedAtMs ||
    validUntilMs - observedAtMs > MAX_VALIDITY_MS ||
    evaluatedAtMs < observedAtMs ||
    evaluatedAtMs > validUntilMs
  )
    return "V207_CERTIFICATION_EVIDENCE_EXPIRED";
  const uniqueClaims = new Set(evidence.claims);
  if (
    uniqueClaims.size !== evidence.claims.length ||
    evidence.claims.some((claim) => !V207_CERTIFICATION_CLAIMS.includes(claim)) ||
    REQUIRED_CLAIMS[evidence.gate].some((claim) => !uniqueClaims.has(claim)) ||
    canonicalizeJson(artifact.claims) !== canonicalizeJson(evidence.claims)
  )
    return "V207_CERTIFICATION_CLAIMS_INCOMPLETE";
  return undefined;
};

export const buildV207CertificationLedger = (input: {
  readonly lineage: V207CertificationLineage;
  readonly evidence: readonly V207AtomicCertificationEvidence[];
  readonly evidenceArtifacts: Readonly<Record<string, V207AtomicEvidenceArtifact>>;
  readonly evaluatedAt: string;
}): V207CertificationLedger => {
  assertV207CertificationLineage(input.lineage);
  const lineageSha256 = sha256(input.lineage);
  const evaluatedAtMs = parseUtc(input.evaluatedAt, "V207_CERTIFICATION_EVALUATED_AT_INVALID");
  const evidenceByGate = new Map<V207CertificationGate, V207AtomicCertificationEvidence>();
  for (const evidence of input.evidence) {
    if (evidenceByGate.has(evidence.gate)) throw new Error("V207_CERTIFICATION_DUPLICATE_GATE");
    evidenceByGate.set(evidence.gate, evidence);
  }
  const invalidGates: V207InvalidCertificationGate[] = [];
  const reusableGates: V207CertificationGate[] = [];
  for (const gate of V207_CERTIFICATION_GATES) {
    const evidence = evidenceByGate.get(gate);
    if (!evidence) continue;
    const code = invalidCodeForEvidence({
      evidence,
      artifact: input.evidenceArtifacts[evidence.evidence_path],
      lineage: input.lineage,
      lineageSha256,
      evaluatedAtMs,
    });
    if (code) invalidGates.push(Object.freeze({ gate, code }));
    else reusableGates.push(gate);
  }
  const missingGates = V207_CERTIFICATION_GATES.filter((gate) => !reusableGates.includes(gate));
  const qualified = missingGates.length === 0;
  const unsigned = Object.freeze({
    schema_version: "videoforge.v2-07-certification-ledger/v1" as const,
    lineage_sha256: lineageSha256,
    evaluated_at: input.evaluatedAt,
    maximum_evidence_validity_hours: 24 as const,
    reusable_gates: Object.freeze(reusableGates),
    invalid_gates: Object.freeze(invalidGates),
    missing_gates: Object.freeze(missingGates),
    qualified,
    eligible_for_soulx_certification: qualified,
  });
  return Object.freeze({ ...unsigned, ledger_sha256: sha256(unsigned) });
};
