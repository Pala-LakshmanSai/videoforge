import { describe, expect, it } from "vitest";

import {
  buildV207CertificationLedger,
  hashV207AtomicEvidenceArtifact,
  hashV207CertificationLineage,
  type V207AtomicCertificationEvidence,
  type V207AtomicEvidenceArtifact,
  type V207CertificationGate,
  type V207CertificationLineage,
  type V207CertificationProfile,
} from "./v207-certification-ledger";

const hash = (character: string): string => `sha256:${character.repeat(64)}`;
const lineage: V207CertificationLineage = {
  schema_version: "videoforge.v2-07-certification-lineage/v1",
  worker_image_digest: hash("1"),
  image_source_commit: "2".repeat(40),
  qualification_source_sha256: hash("3"),
  dependency_lock_sha256: hash("a"),
  acceptance_contract_sha256: hash("b"),
  model_manifest_sha256: hash("4"),
  volume_id_sha256: hash("5"),
  volume_manifest_sha256: hash("6"),
  endpoint_template_sha256: hash("c"),
  region: "EU-RO-1",
  gpu: "NVIDIA GeForce RTX 4090",
  max1_config_sha256: hash("7"),
  max2_config_sha256: hash("8"),
};
const profileFor = (gate: V207CertificationGate): V207CertificationProfile =>
  gate === "max2_concurrency" ? "max2" : "max1";
const claimsFor = (gate: V207CertificationGate) => {
  const common = ["billing_settled", "terminal_jobs", "zero_workers", "volume_unchanged"] as const;
  if (gate === "identity_output") {
    return ["durable_outputs", "distinct_replacement_identity", "cold_warm", ...common] as const;
  }
  if (gate === "cancellation_timeout") return ["cancel", "timeout", ...common] as const;
  return ["max2_two_readers", "max1_restored", ...common] as const;
};
const artifact = (gate: V207CertificationGate): V207AtomicEvidenceArtifact => ({
  schema_version: "videoforge.v2-07-atomic-evidence-artifact/v1",
  gate,
  observed_endpoint_id_sha256: hash("d"),
  receipts_sha256: hash("e"),
  timing_sha256: hash("f"),
  cost_sha256: hash("1"),
  cleanup_sha256: hash("2"),
  claims: claimsFor(gate),
});
const evidence = (gate: V207CertificationGate, observedAt: string) => {
  const profile = profileFor(gate);
  const body = artifact(gate);
  const path = `project-context/evidence/acceptance/VF-10-07/${gate}.json`;
  const record: V207AtomicCertificationEvidence = {
    schema_version: "videoforge.v2-07-atomic-certification/v1",
    gate,
    passed: true,
    lineage_sha256: hashV207CertificationLineage(lineage),
    configuration_profile: profile,
    configuration_sha256:
      profile === "max1" ? lineage.max1_config_sha256 : lineage.max2_config_sha256,
    observed_at: observedAt,
    valid_until: new Date(Date.parse(observedAt) + 24 * 60 * 60 * 1_000).toISOString(),
    evidence_path: path,
    evidence_sha256: hashV207AtomicEvidenceArtifact(body),
    claims: claimsFor(gate),
  };
  return { record, artifact: body };
};
const buildInput = (
  records: ReturnType<typeof evidence>[],
  evaluatedAt = "2026-08-25T10:00:00.000Z",
) => ({
  lineage,
  evidence: records.map(({ record }) => record),
  evidenceArtifacts: Object.fromEntries(
    records.map(({ record, artifact: body }) => [record.evidence_path, body]),
  ),
  evaluatedAt,
});

describe("V2-07 cumulative certification ledger", () => {
  it("qualifies Mage after its three atomic gates without requiring the V2-13 release smoke", () => {
    const result = buildV207CertificationLedger(
      buildInput([
        evidence("identity_output", "2026-08-25T08:00:00.000Z"),
        evidence("cancellation_timeout", "2026-08-25T08:30:00.000Z"),
        evidence("max2_concurrency", "2026-08-25T09:00:00.000Z"),
      ]),
    );
    expect(result.reusable_gates).toEqual([
      "identity_output",
      "cancellation_timeout",
      "max2_concurrency",
    ]);
    expect(result.missing_gates).toEqual([]);
    expect(result.qualified).toBe(true);
    expect(result.eligible_for_soulx_certification).toBe(true);
  });

  it("keeps valid partial evidence while marking only an expired gate invalid", () => {
    const result = buildV207CertificationLedger(
      buildInput(
        [
          evidence("identity_output", "2026-08-25T08:00:00.000Z"),
          evidence("cancellation_timeout", "2026-08-25T08:30:00.000Z"),
        ],
        "2026-08-26T08:15:00.000Z",
      ),
    );
    expect(result.reusable_gates).toEqual(["cancellation_timeout"]);
    expect(result.invalid_gates).toEqual([
      { gate: "identity_output", code: "V207_CERTIFICATION_EVIDENCE_EXPIRED" },
    ]);
    expect(result.missing_gates).toEqual(["identity_output", "max2_concurrency"]);
  });

  it("cryptographically binds the record to the supplied evidence artifact", () => {
    const item = evidence("identity_output", "2026-08-25T08:00:00.000Z");
    const result = buildV207CertificationLedger({
      ...buildInput([item]),
      evidenceArtifacts: {
        [item.record.evidence_path]: { ...item.artifact, receipts_sha256: hash("9") },
      },
    });
    expect(result.invalid_gates).toEqual([
      { gate: "identity_output", code: "V207_CERTIFICATION_EVIDENCE_CONTENT_MISMATCH" },
    ]);
    expect(result.qualified).toBe(false);
  });

  it.each([
    ["lineage drift", { lineage_sha256: hash("9") }, "V207_CERTIFICATION_LINEAGE_MISMATCH"],
    [
      "config drift",
      { configuration_sha256: lineage.max2_config_sha256 },
      "V207_CERTIFICATION_CONFIGURATION_MISMATCH",
    ],
    ["missing claim", { claims: ["terminal_jobs"] }, "V207_CERTIFICATION_CLAIMS_INCOMPLETE"],
  ])("invalidates only the affected gate for %s", (_label, patch, code) => {
    const good = evidence("cancellation_timeout", "2026-08-25T08:30:00.000Z");
    const bad = evidence("identity_output", "2026-08-25T08:00:00.000Z");
    const candidate = { ...bad.record, ...patch } as V207AtomicCertificationEvidence;
    const result = buildV207CertificationLedger({
      ...buildInput([good]),
      evidence: [candidate, good.record],
      evidenceArtifacts: {
        [bad.record.evidence_path]: bad.artifact,
        [good.record.evidence_path]: good.artifact,
      },
    });
    expect(result.reusable_gates).toEqual(["cancellation_timeout"]);
    expect(result.invalid_gates).toContainEqual({ gate: "identity_output", code });
  });
});
