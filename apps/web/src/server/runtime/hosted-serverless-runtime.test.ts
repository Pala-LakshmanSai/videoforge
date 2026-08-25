import {
  FakeServerlessEndpoint,
  FakeServerlessTransport,
  FairAdmissionRepository,
  ProvenanceReceiptSigner,
  VideoRuntimeService,
  canonicalSha256,
  type EndpointDeploymentInput,
  type ServerlessLane,
  type Sha256,
  type TransactionalSqlExecutor,
} from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import {
  HostedServerlessCompositionError,
  createHostedServerlessRuntimeComposition,
  type HostedQualificationVerification,
  type HostedQualificationVerifier,
  type HostedServerlessLaneBinding,
} from "./hosted-serverless-runtime";

const sha256 = (character: string): Sha256 => `sha256:${character.repeat(64)}`;
const NOW = "2026-08-25T12:00:00.000Z";

function database(): TransactionalSqlExecutor {
  const executor: TransactionalSqlExecutor = {
    execute: vi.fn(async () => undefined),
    query: vi.fn(async () => ({ rows: [], affectedRows: 0 })),
    transaction: vi.fn(async (work) => work(executor)),
  };
  return executor;
}

function deployment(lane: ServerlessLane): EndpointDeploymentInput {
  const templateSha256 = sha256(lane === "mage_image" ? "7" : "8");
  const endpointIdSha256 = sha256(lane === "mage_image" ? "a" : "b");
  const endpointConfigSha256 = sha256("c");
  const workerImageDigest = sha256("d");
  const modelManifestSha256 = sha256("e");
  const volumeIdSha256 = sha256("f");
  const volumeManifestSha256 = sha256("0");
  const sealedLineage = {
    endpointIdSha256,
    endpointTemplateIdSha256: templateSha256,
    endpointConfigSha256,
    workerImageDigest,
    modelManifestSha256,
    volumeIdSha256,
    volumeManifestSha256,
    imageSourceCommit: "a".repeat(40),
    qualificationSourceSha256: sha256("3"),
    dependencyLockSha256: sha256("4"),
    acceptanceContractSha256: sha256("5"),
    region: "EU-RO-1" as const,
    gpu: "NVIDIA GeForce RTX 4090" as const,
    max1GateConfigSha256: sha256("6"),
    max1EndpointProfileSha256: sha256("7"),
    max2GateConfigSha256: sha256("8"),
    max2EndpointProfileSha256: sha256("9"),
  };
  return {
    deploymentId: `deployment-${lane}`,
    lane,
    endpointProfileId: `template:${templateSha256}`,
    endpointIdSha256,
    endpointConfigSha256,
    workerImageDigest,
    modelManifestSha256,
    volumeIdSha256,
    volumeManifestSha256,
    idleTimeoutSeconds: 5,
    initTimeoutSeconds: 800,
    executionTimeoutSeconds: 2_400,
    requestTtlSeconds: 7_200,
    reconciliationDeadlineSeconds: 1_500,
    pollingIntervalSeconds: 5,
    maxReplacementAttempts: 1,
    timeoutEvidence: Object.freeze({
      source: "accepted-provider-free-fixture",
      sealed_lineage: sealedLineage,
    }),
    deploymentVersion: 1,
    createdAt: new Date(0).toISOString(),
  };
}

function binding(lane: ServerlessLane): HostedServerlessLaneBinding {
  const acceptedDeployment = deployment(lane);
  return {
    deployment: acceptedDeployment,
    transportEndpointIdSha256: acceptedDeployment.endpointIdSha256,
    transport: new FakeServerlessTransport(
      new FakeServerlessEndpoint({
        endpointIdSha256: acceptedDeployment.endpointIdSha256,
        callbackTokenSha256: sha256("1"),
      }),
    ),
    qualificationArtifact: Object.freeze({
      schema_version: "videoforge-independent-qualification-artifact/v1",
      evidence_id: `accepted-${lane}`,
    }),
  };
}

function acceptedVerification(
  accepted: HostedServerlessLaneBinding,
  overrides: Partial<HostedQualificationVerification> = {},
): HostedQualificationVerification {
  const deployment = accepted.deployment;
  const sealedLineage = deployment.timeoutEvidence
    .sealed_lineage as HostedQualificationVerification["lineage"];
  return {
    verifierId: "videoforge-independent-qualification-v1",
    accepted: true,
    lane: deployment.lane,
    checkpointId: deployment.lane === "mage_image" ? "V2-07" : "V2-08",
    canonicalArtifactSha256: canonicalSha256(accepted.qualificationArtifact),
    verifiedAt: "2026-08-25T11:00:00.000Z",
    expiresAt: "2026-08-25T13:00:00.000Z",
    lineage: sealedLineage,
    ...overrides,
  };
}

function verifier(result: HostedQualificationVerification): HostedQualificationVerifier {
  return { verify: vi.fn(async () => result) };
}

function signer(): ProvenanceReceiptSigner {
  return new ProvenanceReceiptSigner("hosted-composition-test", Buffer.alloc(32, 7));
}

describe("hosted provider-free Serverless composition", () => {
  it("composes durable repositories without querying or activating anything", () => {
    const executor = database();
    const mage = binding("mage_image");
    const composition = createHostedServerlessRuntimeComposition({
      database: executor,
      signer: signer(),
      qualificationVerifier: verifier(acceptedVerification(mage)),
    });

    expect(composition.fairAdmission).toBeInstanceOf(FairAdmissionRepository);
    expect(composition.videoRuntime).toBeInstanceOf(VideoRuntimeService);
    expect("dispatch" in composition).toBe(false);
    expect(executor.execute).not.toHaveBeenCalled();
    expect(executor.query).not.toHaveBeenCalled();
    expect(executor.transaction).not.toHaveBeenCalled();
  });

  it("fails closed when neither predecessor-qualified lane is injected", async () => {
    const mage = binding("mage_image");
    const composition = createHostedServerlessRuntimeComposition({
      database: database(),
      signer: signer(),
      qualificationVerifier: verifier(acceptedVerification(mage)),
    });

    for (const lane of ["mage_image", "soulx_avatar"] as const) {
      await expect(composition.requireLane(lane)).rejects.toEqual(
        expect.objectContaining<Partial<HostedServerlessCompositionError>>({
          code: "HOSTED_SERVERLESS_LANE_UNQUALIFIED",
        }),
      );
    }
  });

  it("returns only an exact lane-scoped facade and publishes after fresh re-verification", async () => {
    const mage = binding("mage_image");
    const run = vi.spyOn(mage.transport, "run");
    const executor = database();
    const qualificationVerifier = verifier(acceptedVerification(mage));
    const composition = createHostedServerlessRuntimeComposition({
      database: executor,
      signer: signer(),
      qualificationVerifier,
      now: () => new Date(NOW),
      lanes: { mage_image: mage },
    });

    const lane = await composition.requireLane("mage_image");
    expect(lane.lane).toBe("mage_image");
    expect(lane.deploymentId).toBe(mage.deployment.deploymentId);
    expect(lane.verifiedDeployment).toMatchObject({
      deployment: mage.deployment,
      sealedLineageSha256: canonicalSha256(
        acceptedVerification(mage).lineage as unknown as Readonly<Record<string, unknown>>,
      ),
    });
    expect(lane.verifiedDeployment.sealedLineage).toEqual(acceptedVerification(mage).lineage);
    expect(Object.isFrozen(lane.verifiedDeployment)).toBe(true);
    expect(Object.isFrozen(lane.verifiedDeployment.deployment)).toBe(true);
    expect(Object.isFrozen(lane.verifiedDeployment.sealedLineage)).toBe(true);
    expect(() => {
      (lane.verifiedDeployment.sealedLineage as { region: string }).region = "EU-CZ-1";
    }).toThrow();
    expect("transport" in lane).toBe(false);
    expect("dispatch" in lane).toBe(false);
    await lane.publishDeployment();
    expect(qualificationVerifier.verify).toHaveBeenCalledTimes(2);
    expect(executor.transaction).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("blocks expired, forged, or lineage-drift evidence before SQL or transport access", async () => {
    const cases = [
      (mage: HostedServerlessLaneBinding) =>
        acceptedVerification(mage, { expiresAt: "2026-08-25T11:30:00.000Z" }),
      (mage: HostedServerlessLaneBinding) =>
        acceptedVerification(mage, { canonicalArtifactSha256: sha256("9") }),
      (mage: HostedServerlessLaneBinding) =>
        acceptedVerification(mage, {
          lineage: { ...acceptedVerification(mage).lineage, workerImageDigest: sha256("9") },
        }),
      ...(
        [
          ["endpointIdSha256", sha256("9")],
          ["endpointTemplateIdSha256", sha256("a")],
          ["endpointConfigSha256", sha256("a")],
          ["modelManifestSha256", sha256("a")],
          ["volumeIdSha256", sha256("a")],
          ["volumeManifestSha256", sha256("a")],
          ["imageSourceCommit", "b".repeat(40)],
          ["qualificationSourceSha256", sha256("a")],
          ["dependencyLockSha256", sha256("a")],
          ["acceptanceContractSha256", sha256("a")],
          ["region", "EU-CZ-1"],
          ["gpu", "NVIDIA L40S"],
          ["max1GateConfigSha256", sha256("a")],
          ["max1EndpointProfileSha256", sha256("a")],
          ["max2GateConfigSha256", sha256("a")],
          ["max2EndpointProfileSha256", sha256("a")],
        ] as const
      ).map(
        ([key, value]) =>
          (mage: HostedServerlessLaneBinding) =>
            acceptedVerification(mage, {
              lineage: { ...acceptedVerification(mage).lineage, [key]: value },
            }),
      ),
    ];

    for (const result of cases) {
      const mage = binding("mage_image");
      const executor = database();
      const run = vi.spyOn(mage.transport, "run");
      const composition = createHostedServerlessRuntimeComposition({
        database: executor,
        signer: signer(),
        qualificationVerifier: verifier(result(mage)),
        now: () => new Date(NOW),
        lanes: { mage_image: mage },
      });
      await expect(composition.requireLane("mage_image")).rejects.toBeInstanceOf(
        HostedServerlessCompositionError,
      );
      expect(executor.execute).not.toHaveBeenCalled();
      expect(executor.query).not.toHaveBeenCalled();
      expect(executor.transaction).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("re-verifies freshness before a retained facade can publish", async () => {
    const mage = binding("mage_image");
    const executor = database();
    let current = new Date(NOW);
    const composition = createHostedServerlessRuntimeComposition({
      database: executor,
      signer: signer(),
      qualificationVerifier: verifier(acceptedVerification(mage)),
      now: () => current,
      lanes: { mage_image: mage },
    });
    const lane = await composition.requireLane("mage_image");
    current = new Date("2026-08-25T14:00:00.000Z");

    await expect(lane.publishDeployment()).rejects.toMatchObject({
      code: "HOSTED_SERVERLESS_VERIFICATION_EXPIRED",
    });
    expect(executor.transaction).not.toHaveBeenCalled();
  });

  it("rejects a transport endpoint identity that drifts from sealed deployment lineage", async () => {
    const exact = binding("mage_image");
    const drifted = { ...exact, transportEndpointIdSha256: sha256("9") };
    const executor = database();
    const composition = createHostedServerlessRuntimeComposition({
      database: executor,
      signer: signer(),
      qualificationVerifier: verifier(acceptedVerification(exact)),
      now: () => new Date(NOW),
      lanes: { mage_image: drifted },
    });

    await expect(composition.requireLane("mage_image")).rejects.toMatchObject({
      code: "HOSTED_SERVERLESS_VERIFICATION_REJECTED",
    });
    expect(executor.transaction).not.toHaveBeenCalled();
  });

  it("restarts cleanup from expired exact evidence without exposing new-work operations", async () => {
    const mage = binding("mage_image");
    const expired = acceptedVerification(mage, {
      verifiedAt: "2026-08-24T12:00:00.000Z",
      expiresAt: "2026-08-25T11:30:00.000Z",
    });
    const firstProcess = createHostedServerlessRuntimeComposition({
      database: database(),
      signer: signer(),
      qualificationVerifier: verifier(expired),
      now: () => new Date(NOW),
      lanes: { mage_image: mage },
    });
    await expect(firstProcess.requireLane("mage_image")).rejects.toMatchObject({
      code: "HOSTED_SERVERLESS_VERIFICATION_EXPIRED",
    });

    const forgedRecovery = createHostedServerlessRuntimeComposition({
      database: database(),
      signer: signer(),
      qualificationVerifier: verifier(
        acceptedVerification(mage, { canonicalArtifactSha256: sha256("9") }),
      ),
      now: () => new Date(NOW),
      lanes: { mage_image: mage },
    });
    await expect(forgedRecovery.requireCleanupLane("mage_image")).rejects.toMatchObject({
      code: "HOSTED_SERVERLESS_VERIFICATION_REJECTED",
    });

    const restartedProcess = createHostedServerlessRuntimeComposition({
      database: database(),
      signer: signer(),
      qualificationVerifier: verifier(expired),
      now: () => new Date(NOW),
      lanes: { mage_image: mage },
    });
    const cleanup = await restartedProcess.requireCleanupLane("mage_image");
    expect(cleanup.lane).toBe("mage_image");
    expect(Object.keys(cleanup).sort()).toEqual(["cancel", "deploymentId", "lane", "reconcile"]);
    expect("publishDeployment" in cleanup).toBe(false);
    expect("commitPredispatch" in cleanup).toBe(false);
    expect("dispatchOnce" in cleanup).toBe(false);
  });
});
