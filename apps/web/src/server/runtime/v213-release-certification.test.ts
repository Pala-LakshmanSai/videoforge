import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import {
  buildV213ReleaseCertificationLedger,
  hashV213ReleaseIdentity,
  V213_RELEASE_GATES,
  type V213EvidenceClass,
  type V213Metric,
  type V213ReleaseEvidenceArtifact,
  type V213ReleaseEvidenceVerifier,
  type V213ReleaseGate,
  type V213ReleaseIdentity,
  type V213VerifiedReleaseEvidence,
} from "./v213-release-certification.js";

const sha = (label: string): Sha256 => canonicalSha256({ label });
const identity: V213ReleaseIdentity = {
  schemaVersion: "videoforge-v213-release-identity/v1",
  sourceCommit: "a".repeat(40),
  deployedSourceCommit: "a".repeat(40),
  deployedExecutableSha256: sha("executable"),
  productionUrlSha256: sha("production-url"),
  deploymentConfigSha256: sha("deployment-config"),
  contractBundleSha256: sha("contract-bundle"),
  mageImageDigest: `ghcr.io/example/videoforge-mage@${sha("mage-image")}`,
  soulxImageDigest: `ghcr.io/example/videoforge-soulx@${sha("soulx-image")}`,
  mageEndpointConfigSha256: sha("mage-endpoint"),
  soulxEndpointConfigSha256: sha("soulx-endpoint"),
  mageCertificationLedgerSha256: sha("mage-ledger"),
  soulxCertificationLedgerSha256: sha("soulx-ledger"),
  v209AcceptanceSha256: sha("v209"),
  v210AcceptanceSha256: sha("v210"),
  v211AcceptanceSha256: sha("v211"),
  v212AcceptanceSha256: sha("v212"),
};

const artifact = (gate: V213ReleaseGate): V213ReleaseEvidenceArtifact => ({
  schemaVersion: "videoforge-v213-release-evidence-artifact/v1",
  gate,
  evidence: { schema_version: `durable-${gate}/v1`, evidence_kind: "independently_observed" },
});

const gateFacts = (
  gate: V213ReleaseGate,
): {
  readonly evidenceClass: V213EvidenceClass;
  readonly claims: readonly string[];
  readonly metrics: Readonly<Record<string, V213Metric>>;
} => {
  switch (gate) {
    case "mage_certified_ledger":
    case "soulx_certified_ledger":
      return {
        evidenceClass: "LIVE_PROVIDER" as const,
        claims: [
          "certified_ledger_qualified",
          "lineage_current",
          "billing_settled",
          "terminal_jobs",
          "zero_workers",
        ],
        metrics: { qualified: true, billingSettled: true, terminalJobs: 0, activeWorkers: 0 },
      };
    case "fresh_bounded_two_lane_smoke":
      return {
        evidenceClass: "LIVE_PROVIDER" as const,
        claims: [
          "one_mage_dispatch",
          "one_soulx_dispatch",
          "bounded_spend",
          "durable_readback",
          "exact_release_identity",
        ],
        metrics: {
          mageDispatchCount: 1,
          soulxDispatchCount: 1,
          maximumSpendMicroUsd: 500_000,
          mageReadbackPassed: true,
          soulxReadbackPassed: true,
        },
      };
    case "independent_zero_drain":
      return {
        evidenceClass: "LIVE_PROVIDER" as const,
        claims: [
          "independent_observation",
          "zero_endpoint_jobs",
          "zero_mage_workers",
          "zero_soulx_workers",
          "no_unknown_liability",
        ],
        metrics: { endpointJobs: 0, mageWorkers: 0, soulxWorkers: 0, unknownLiabilities: 0 },
      };
    case "settled_billing":
      return {
        evidenceClass: "LIVE_PROVIDER" as const,
        claims: [
          "all_variable_billing_settled",
          "duplicate_cost_visible",
          "recurring_charges_disclosed",
        ],
        metrics: {
          billingSettled: true,
          unsettledItems: 0,
          totalVariableCostMicroUsd: 500_000,
          possibleDuplicateCostMicroUsd: 0,
          recurringChargesDisclosed: true,
        },
      };
    default:
      throw new Error(`test facts are not defined for ${gate}`);
  }
};

const upstreamFor = (gate: V213ReleaseGate): Sha256 | null => {
  if (gate === "mage_certified_ledger") return identity.mageCertificationLedgerSha256;
  if (gate === "soulx_certified_ledger") return identity.soulxCertificationLedgerSha256;
  return null;
};

const verification = (
  value: V213ReleaseEvidenceArtifact,
  observedAt: string,
  observerId = `independent-${value.gate}`,
): V213VerifiedReleaseEvidence => {
  const facts = gateFacts(value.gate);
  return {
    verifierId: "videoforge-independent-v213-release-evidence-v1",
    accepted: true,
    gate: value.gate,
    canonicalEvidenceSha256: canonicalSha256(value),
    verifierSignatureSha256: sha(`signature-${value.gate}`),
    observerId,
    evidencePath: `project-context/evidence/acceptance/VF-10-13/${value.gate}.json`,
    evidenceSha256: canonicalSha256(value.evidence),
    evidenceClass: facts.evidenceClass,
    observedAt,
    releaseIdentitySha256: hashV213ReleaseIdentity(identity),
    sourceCommit: identity.sourceCommit,
    deployedSourceCommit: identity.deployedSourceCommit,
    contractBundleSha256: identity.contractBundleSha256,
    upstreamEvidenceSha256: upstreamFor(value.gate),
    fixtureOrFakeTransportUsed: false,
    claims: facts.claims,
    metrics: facts.metrics,
  };
};

const verifierFor = (
  transform?: (
    result: V213VerifiedReleaseEvidence,
    artifact: V213ReleaseEvidenceArtifact,
  ) => V213VerifiedReleaseEvidence,
): V213ReleaseEvidenceVerifier => ({
  verify: vi.fn(async (value) => {
    const observedAt =
      value.gate === "independent_zero_drain"
        ? "2026-08-25T11:45:00.000Z"
        : "2026-08-25T11:30:00.000Z";
    const result = verification(value, observedAt);
    return transform?.(result, value) ?? result;
  }),
});

const evaluate = (
  evidenceArtifacts: Readonly<Partial<Record<V213ReleaseGate, V213ReleaseEvidenceArtifact>>>,
  verifier = verifierFor(),
  evaluatedAt = "2026-08-25T12:00:00.000Z",
) =>
  buildV213ReleaseCertificationLedger({
    releaseIdentity: identity,
    evidenceArtifacts,
    verifier,
    evaluatedAt,
  });

describe("V2-13 final two-lane release certification gate", () => {
  it("returns release_blocked with every exact gate when current live evidence is absent", async () => {
    const verifier = verifierFor();
    const result = await evaluate({}, verifier);

    expect(result.releaseStatus).toBe("release_blocked");
    expect(result.reusableGates).toEqual([]);
    expect(result.invalidGates).toEqual([]);
    expect(result.missingGates).toEqual(V213_RELEASE_GATES);
    expect(result.liveReleaseAuthorized).toBe(false);
    expect(result.requiresExplicitReleaseAuthority).toBe(true);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("consumes exact current Mage and SoulX ledger hashes but stays blocked on later gates", async () => {
    const mage = artifact("mage_certified_ledger");
    const soulx = artifact("soulx_certified_ledger");
    const result = await evaluate({ mage_certified_ledger: mage, soulx_certified_ledger: soulx });

    expect(result.reusableGates).toEqual(["mage_certified_ledger", "soulx_certified_ledger"]);
    expect(result.missingGates).toEqual(V213_RELEASE_GATES.slice(2));
    expect(result.releaseStatus).toBe("release_blocked");
    expect(result.liveReleaseAuthorized).toBe(false);
  });

  it("rejects fixture or fake transport provenance instead of treating it as live proof", async () => {
    const mage = artifact("mage_certified_ledger");
    const verifier = verifierFor(
      (result) =>
        ({
          ...result,
          fixtureOrFakeTransportUsed: true,
        }) as unknown as V213VerifiedReleaseEvidence,
    );
    const result = await evaluate({ mage_certified_ledger: mage }, verifier);

    expect(result.invalidGates).toEqual([
      { gate: "mage_certified_ledger", code: "V213_RELEASE_EVIDENCE_PROVENANCE_INVALID" },
    ]);
    expect(result.missingGates).toEqual(V213_RELEASE_GATES);
  });

  it("rejects an expired release smoke even when its claims and metrics look complete", async () => {
    const smoke = artifact("fresh_bounded_two_lane_smoke");
    const verifier = verifierFor((result) => ({
      ...result,
      observedAt: "2026-08-25T09:00:00.000Z",
    }));
    const result = await evaluate({ fresh_bounded_two_lane_smoke: smoke }, verifier);

    expect(result.invalidGates).toContainEqual({
      gate: "fresh_bounded_two_lane_smoke",
      code: "V213_RELEASE_EVIDENCE_STALE",
    });
    expect(result.releaseStatus).toBe("release_blocked");
  });

  it("requires a distinct independent drain observer after the two-lane smoke", async () => {
    const smoke = artifact("fresh_bounded_two_lane_smoke");
    const drain = artifact("independent_zero_drain");
    const verifier = verifierFor((result) => ({ ...result, observerId: "same-observer" }));
    const result = await evaluate(
      { fresh_bounded_two_lane_smoke: smoke, independent_zero_drain: drain },
      verifier,
    );

    expect(result.reusableGates).toEqual(["fresh_bounded_two_lane_smoke"]);
    expect(result.invalidGates).toContainEqual({
      gate: "independent_zero_drain",
      code: "V213_RELEASE_DRAIN_NOT_INDEPENDENT_OR_ORDERED",
    });
    expect(result.releaseStatus).toBe("release_blocked");
  });

  it("rejects an independent drain observed at the same instant as the smoke", async () => {
    const smoke = artifact("fresh_bounded_two_lane_smoke");
    const drain = artifact("independent_zero_drain");
    const verifier = verifierFor((result) => ({
      ...result,
      observedAt: "2026-08-25T11:30:00.000Z",
    }));
    const result = await evaluate(
      { fresh_bounded_two_lane_smoke: smoke, independent_zero_drain: drain },
      verifier,
    );

    expect(result.reusableGates).toEqual(["fresh_bounded_two_lane_smoke"]);
    expect(result.invalidGates).toContainEqual({
      gate: "independent_zero_drain",
      code: "V213_RELEASE_DRAIN_NOT_INDEPENDENT_OR_ORDERED",
    });
  });

  it("rejects settled billing observed at the same instant as the accepted drain", async () => {
    const smoke = artifact("fresh_bounded_two_lane_smoke");
    const drain = artifact("independent_zero_drain");
    const billing = artifact("settled_billing");
    const verifier = verifierFor((result) => ({
      ...result,
      observedAt:
        result.gate === "fresh_bounded_two_lane_smoke"
          ? "2026-08-25T11:30:00.000Z"
          : "2026-08-25T11:45:00.000Z",
    }));
    const result = await evaluate(
      {
        fresh_bounded_two_lane_smoke: smoke,
        independent_zero_drain: drain,
        settled_billing: billing,
      },
      verifier,
    );

    expect(result.reusableGates).toEqual([
      "fresh_bounded_two_lane_smoke",
      "independent_zero_drain",
    ]);
    expect(result.invalidGates).toContainEqual({
      gate: "settled_billing",
      code: "V213_RELEASE_BILLING_PRECEDES_DRAIN",
    });
  });

  it("rejects source/deployment drift before evaluating any release evidence", async () => {
    await expect(
      buildV213ReleaseCertificationLedger({
        releaseIdentity: { ...identity, deployedSourceCommit: "b".repeat(40) },
        evidenceArtifacts: {},
        verifier: verifierFor(),
        evaluatedAt: "2026-08-25T12:00:00.000Z",
      }),
    ).rejects.toThrow("V213_RELEASE_SOURCE_DEPLOYMENT_DRIFT");
  });
});
