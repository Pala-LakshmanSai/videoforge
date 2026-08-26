import {
  canonicalSha256,
  trustedTenantScope,
  type PredispatchCommit,
  type ServerlessLane,
  type Sha256,
} from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import { HostedServerlessCompositionError } from "../runtime/hosted-serverless-runtime";
import { createHostedEnvelopePairSigner, signHostedEnvelopeBody } from "./hosted-envelope-signer";
import {
  cancelHostedPersistedAttempt,
  deriveHostedDispatchIds,
  dispatchHostedPreparedGeneration,
  HostedDispatchCoordinationError,
  reconcileHostedPersistedAttempt,
  type HostedDispatchInspection,
  type HostedDispatchRuntime,
  type HostedPaidAuthorityGate,
  type HostedPersistedDispatchPlan,
  type HostedPersistedServerlessAttempt,
  type HostedPublishedDeploymentBinding,
} from "./hosted-serverless-dispatch-coordinator";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const REVISION = "44444444-4444-4444-8444-444444444444";
const REQUEST = "55555555-5555-4555-8555-555555555555";
const RUNTIME = "66666666-6666-4666-8666-666666666666";
const MAGE_TASK = "77777777-7777-4777-8777-777777777777";
const SOULX_TASK = "88888888-8888-4888-8888-888888888888";
const APPROVAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = "2026-08-25T12:00:00.000Z";
const DB_CLAIMED_AT = "2026-08-25T12:00:01.000Z";
const ENVELOPE_SECRET_HEX = "cd".repeat(32);
const scope = trustedTenantScope(ACCOUNT, WORKSPACE);
const sha256 = (character: string): Sha256 => `sha256:${character.repeat(64)}`;

function deploymentBinding(lane: ServerlessLane): HostedPublishedDeploymentBinding {
  const endpointTemplateIdSha256 = sha256(lane === "mage_image" ? "1" : "2");
  const endpointIdSha256 = sha256(lane === "mage_image" ? "a" : "b");
  const workerImageDigest = sha256(lane === "mage_image" ? "3" : "4");
  const modelManifestSha256 = sha256(lane === "mage_image" ? "5" : "6");
  const volumeIdSha256 = sha256(lane === "mage_image" ? "7" : "8");
  const sealedLineage = {
    endpointIdSha256,
    endpointTemplateIdSha256,
    endpointConfigSha256: sha256("c"),
    workerImageDigest,
    modelManifestSha256,
    volumeIdSha256,
    volumeManifestSha256: sha256("d"),
    imageSourceCommit: "a".repeat(40),
    qualificationSourceSha256: sha256("e"),
    dependencyLockSha256: sha256("f"),
    acceptanceContractSha256: sha256("0"),
    region: "EU-RO-1" as const,
    gpu: "NVIDIA GeForce RTX 4090" as const,
    max1GateConfigSha256: sha256("1"),
    max1EndpointProfileSha256: sha256("2"),
    max2GateConfigSha256: sha256("3"),
    max2EndpointProfileSha256: sha256("4"),
  };
  return {
    deployment: {
      deploymentId: `deployment-${lane}`,
      lane,
      endpointProfileId: `template:${endpointTemplateIdSha256}`,
      endpointIdSha256,
      endpointConfigSha256: sealedLineage.endpointConfigSha256,
      workerImageDigest,
      modelManifestSha256,
      volumeIdSha256,
      volumeManifestSha256: sealedLineage.volumeManifestSha256,
      idleTimeoutSeconds: 5,
      initTimeoutSeconds: 900,
      executionTimeoutSeconds: 2_400,
      requestTtlSeconds: 7_200,
      reconciliationDeadlineSeconds: 1_500,
      pollingIntervalSeconds: 5,
      maxReplacementAttempts: 1,
      timeoutEvidence: { sealed_lineage: sealedLineage },
      deploymentVersion: 1,
      createdAt: "2026-08-25T11:00:00.000Z",
    },
    sealedLineage,
    sealedLineageSha256: canonicalSha256(sealedLineage),
  };
}

function plan(): HostedPersistedDispatchPlan {
  const task = (lane: ServerlessLane, taskId: string, character: string) => {
    const binding = deploymentBinding(lane);
    const deployment = binding.deployment;
    const ids = deriveHostedDispatchIds({
      generationRequestId: REQUEST,
      taskId,
      attemptOrdinal: 1,
    });
    const requestBody = { schema_version: "serverless-v3", lane, task_id: taskId };
    const itemsManifestSha256 = sha256(character);
    const inputManifestSha256 = sha256(character === "a" ? "c" : "d");
    const outputPrefix =
      `tenant/${ACCOUNT}/workspace/${WORKSPACE}/project/${PROJECT}/revision/${REVISION}` +
      `/lane/${lane === "mage_image" ? "mage-image" : "soulx-avatar"}/job/${ids.attemptId}`;
    const resources = [
      `endpoint:${deployment.deploymentId}`,
      "gpu:nvidia-geforce-rtx-4090-eu-ro-1",
      `image:${deployment.workerImageDigest.slice(7)}`,
      `volume:${deployment.volumeIdSha256.slice(7)}`,
    ];
    return {
      taskId,
      lane,
      state: "READY" as const,
      attemptOrdinal: 1,
      itemIds: [`${lane}-batch-item`],
      itemsManifestSha256,
      inputManifestSha256,
      outputPrefix,
      maxInputBytes: 1_000_000,
      maxOutputBytes: 10_000_000,
      requestBody,
      requestBodySha256: canonicalSha256(requestBody),
      envelope: {
        schema: "serverless-worker-job-envelope/v3",
        dispatch_token: "pending-dispatch-token-0000000000000000",
        tenant: { account_id: ACCOUNT, workspace_id: WORKSPACE },
        work: {
          project_revision_id: REVISION,
          generation_request_id: REQUEST,
          task_id: taskId,
          attempt_id: ids.attemptId,
          lane,
          items_manifest_sha256: itemsManifestSha256,
          item_count: 1,
        },
        runtime: {
          endpoint_profile_id: deployment.endpointProfileId,
          deployment_id: deployment.deploymentId,
          container_digest: deployment.workerImageDigest,
          model_manifest_sha256: deployment.modelManifestSha256,
          volume_id_sha256: deployment.volumeIdSha256,
          volume_mount: "/runpod-volume",
          volume_write_policy: "APPLICATION_READ_ONLY",
          scratch_root_policy: "JOB_LOCAL_SCRATCH_OUTSIDE_MODEL_VOLUME",
          gpu_allowlist: ["NVIDIA GeForce RTX 4090"],
          region: "EU-RO-1",
        },
        artifacts: {
          input_manifest_sha256: inputManifestSha256,
          output_prefix: outputPrefix,
          plan_manifest_sha256: sha256("9"),
          transfer_port_reservation_ids: [`reservation-${lane}`],
        },
        limits: {
          expires_at: "2026-08-25T13:00:00.000Z",
          max_items: 1,
          max_input_bytes: 1_000_000,
          max_output_bytes: 10_000_000,
          execution_timeout_seconds: deployment.executionTimeoutSeconds,
          init_timeout_seconds: deployment.initTimeoutSeconds,
        },
        policy: {
          model_download_permitted: false,
          volume_mutation_permitted: false,
          pod_lifecycle_permitted: false,
          queue_purge_permitted: false,
        },
      },
      spendCeilingUsd: 1,
      reservationUsd: 0.75,
      rateSource: "approved-qualified-fixture-no-provider-call",
      rateCheckedAt: NOW,
      checkpointAuthority: {
        checkpointId: lane === "mage_image" ? "V2-07" : "V2-08",
        mode: "paid" as const,
        provider: "RunPod Serverless",
        capUsd: 2,
        nonTransferable: true,
        resources,
        allowedOperations: ["serverless_run", "serverless_status", "serverless_cancel"],
        authorizedOperations: ["serverless_run", "serverless_status", "serverless_cancel"],
        rateSnapshot: resources.map((resourceId) => ({
          resourceId,
          billingUnit: "fixture-unit",
          usdPerUnit: 0,
          checkedAt: NOW,
        })),
        authorizedByUserAt: "2026-08-25T11:00:00.000Z",
        modelId: deployment.modelManifestSha256,
      },
      authorityExpiresAt: "2026-08-25T13:00:00.000Z",
    };
  };
  return {
    accountId: ACCOUNT,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    projectRevisionId: REVISION,
    generationRequestId: REQUEST,
    generationPlanSha256: sha256("9"),
    paidAuthority: {
      approvalId: APPROVAL,
      approvalSha256: sha256("f"),
      totalCapUsd: 2,
      expiresAt: "2026-08-25T13:00:00.000Z",
    },
    // Deliberately reversed: dispatch order must be stable, not persistence-order dependent.
    tasks: [task("soulx_avatar", SOULX_TASK, "b"), task("mage_image", MAGE_TASK, "a")],
  };
}

function runtimeView(source = plan()) {
  return {
    runtimeId: RUNTIME,
    projectId: source.projectId,
    projectRevisionId: source.projectRevisionId,
    generationRequestId: source.generationRequestId,
    stage: "WAITING_FOR_WORKER" as const,
    terminalReason: null,
    preparationManifestSha256: sha256("8"),
    renderManifestSha256: null,
    finalOutputSha256: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    lanes: source.tasks.map((task) => ({
      lane: task.lane,
      state: "MANIFEST_DURABLE" as const,
      plannedItemCount: task.itemIds.length,
      acceptedItemCount: 0,
      attemptOrdinal: 0,
      maxAttemptOrdinal: 3,
      currentAttemptId: null,
      itemsManifestSha256: task.itemsManifestSha256,
    })),
    providerCallsAuthorized: false as const,
    authorizedSpendUsd: 0 as const,
  };
}

function commit(
  attemptId: string,
  outboxId: string,
  dispatchToken = `token-${attemptId}`,
  envelope: Readonly<Record<string, unknown>> = { schema: "serverless-worker-job-envelope/v3" },
): PredispatchCommit {
  return {
    attemptId,
    dispatchToken,
    dispatchTokenSha256: sha256("1"),
    outboxId,
    endpointIdSha256: sha256("2"),
    requestBodySha256: sha256("3"),
    envelopeSha256: canonicalSha256(envelope),
    outputPrefix: `tenant/${ACCOUNT}/output/`,
    authority: {
      document: {},
      authoritySha256: sha256("a"),
      dispatchTokenSha256: sha256("1"),
    },
    deadlineAt: "2026-08-25T13:00:00.000Z",
    reconciliationDeadlineAt: "2026-08-25T12:20:00.000Z",
    requestTtlSeconds: 3600,
  };
}

function setup(
  input: {
    readonly existing?: HostedPersistedServerlessAttempt | null;
    readonly unqualified?: boolean;
    readonly ackUnknownLane?: ServerlessLane;
    readonly published?: boolean;
    readonly gateCapUsd?: number;
    readonly gateGenerationRequestId?: string;
  } = {},
) {
  const persisted = plan();
  const readPlan = vi.fn(async () => persisted);
  const readAttempt = vi.fn(async () => input.existing ?? null);
  const readPublishedDeployment = vi.fn(async (lane: ServerlessLane) =>
    input.published === false ? null : deploymentBinding(lane),
  );
  const inspection: HostedDispatchInspection = {
    readPlan,
    readAttempt,
    readPublishedDeployment,
  };
  const publish = new Map<ServerlessLane, ReturnType<typeof vi.fn>>();
  const predispatch = new Map<ServerlessLane, ReturnType<typeof vi.fn>>();
  const dispatch = new Map<ServerlessLane, ReturnType<typeof vi.fn>>();
  const cleanup = new Map<
    ServerlessLane,
    { cancel: ReturnType<typeof vi.fn>; reconcile: ReturnType<typeof vi.fn> }
  >();
  const services = Object.fromEntries(
    (["mage_image", "soulx_avatar"] as const).map((lane) => {
      const publishDeployment = vi.fn(async () => undefined);
      const commitPredispatch = vi.fn(async (_scope, operation) =>
        commit(
          operation.attemptId,
          operation.outboxId,
          operation.dispatchToken,
          operation.envelope,
        ),
      );
      const dispatchOnce = vi.fn(async () =>
        input.ackUnknownLane === lane
          ? ({ kind: "DISPATCH_ACK_UNKNOWN" } as const)
          : ({
              kind: "ASSIGNED",
              providerJobId: `provider-${lane}`,
              assignmentId: "bound",
            } as const),
      );
      const cancel = vi.fn(async () => ({ providerTerminalState: "CANCELLED" as const }));
      const reconcile = vi.fn(async () => "AMBIGUOUS_STOP" as const);
      const verifiedDeployment = deploymentBinding(lane);
      publish.set(lane, publishDeployment);
      predispatch.set(lane, commitPredispatch);
      dispatch.set(lane, dispatchOnce);
      cleanup.set(lane, { cancel, reconcile });
      return [
        lane,
        {
          lane,
          deploymentId: verifiedDeployment.deployment.deploymentId,
          verifiedDeployment,
          publishDeployment,
          commitPredispatch,
          dispatchOnce,
          reconcile,
          cancel,
        },
      ];
    }),
  ) as Record<ServerlessLane, never>;
  const listOwned = vi.fn(async () => [
    {
      requestKind: "VIDEO" as const,
      requestId: REQUEST,
      state: "ACTIVE" as const,
      queueOrder: 1n,
      version: 3,
      attemptOrdinal: 0,
      availableAt: NOW,
      leaseId: "99999999-9999-4999-8999-999999999999",
      leaseSlot: 1 as const,
      leaseExpiresAt: "2026-08-25T13:00:00.000Z",
    },
  ]);
  const byGenerationRequest = vi.fn(async () => runtimeView(persisted));
  const bindLaneAttempt = vi.fn(async () => runtimeView(persisted));
  const requireLane = vi.fn(async (lane: ServerlessLane) => {
    if (input.unqualified) {
      throw new HostedServerlessCompositionError("HOSTED_SERVERLESS_LANE_UNQUALIFIED");
    }
    return services[lane];
  });
  const requireCleanupLane = vi.fn(async (lane: ServerlessLane) => services[lane]);
  const runtime = {
    fairAdmission: { listOwned },
    videoRuntime: { byGenerationRequest, bindLaneAttempt },
    requireLane,
    requireCleanupLane,
  } as unknown as HostedDispatchRuntime;
  let claimed = false;
  const claimOnce = vi.fn<HostedPaidAuthorityGate["claimOnce"]>(async (claim) => {
    if (claimed) throw new Error("HOSTED_PAID_AUTHORITY_REPLAY");
    if (
      claim.totalCapUsd > (input.gateCapUsd ?? 2) ||
      claim.generationRequestId !== (input.gateGenerationRequestId ?? REQUEST)
    ) {
      throw new Error("HOSTED_PAID_AUTHORITY_SCOPE_OR_CAP_REJECTED");
    }
    claimed = true;
    return {
      approvalId: claim.approvalId,
      approvalSha256: claim.approvalSha256,
      claimId: claim.claimId,
      accountId: claim.scope.accountId,
      workspaceId: claim.scope.workspaceId,
      generationRequestId: claim.generationRequestId,
      totalCapUsd: claim.totalCapUsd,
      cumulativeReservationUsd: claim.cumulativeReservationUsd,
      expiresAt: claim.expiresAt,
      claimedAt: DB_CLAIMED_AT,
    };
  });
  const paidAuthorityGate: HostedPaidAuthorityGate = { claimOnce };
  const envelopeSigner = createHostedEnvelopePairSigner({
    keyId: "qualified-envelope-key",
    secretHex: ENVELOPE_SECRET_HEX,
  });
  return {
    persisted,
    inspection,
    runtime,
    readPlan,
    readAttempt,
    readPublishedDeployment,
    listOwned,
    byGenerationRequest,
    bindLaneAttempt,
    requireLane,
    requireCleanupLane,
    publish,
    predispatch,
    dispatch,
    cleanup,
    paidAuthorityGate,
    envelopeSigner,
    claimOnce,
  };
}

describe("hosted Serverless dispatch coordinator", () => {
  it("returns exact DISABLED_UNQUALIFIED after read-only inspection and creates nothing", async () => {
    const fixture = setup({ unqualified: true });
    const blocked = fixture.persisted.tasks.map((task) => ({ ...task, state: "BLOCKED" as const }));
    fixture.readPlan.mockResolvedValue({
      ...fixture.persisted,
      tasks: [
        ...blocked,
        {
          ...blocked[0]!,
          taskId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          itemIds: ["second-soulx-segment"],
        },
      ],
    });
    await expect(
      dispatchHostedPreparedGeneration({
        scope,
        generationRequestId: REQUEST,
        inspection: fixture.inspection,
        runtime: fixture.runtime,
        paidAuthorityGate: fixture.paidAuthorityGate,
        envelopeSigner: fixture.envelopeSigner,
        now: NOW,
      }),
    ).resolves.toEqual({
      state: "DISABLED_UNQUALIFIED",
      reason: "HOSTED_SERVERLESS_LANE_UNQUALIFIED",
      inspectedTaskCount: 3,
      serverlessAttemptCount: 0,
      outboxCount: 0,
      authorityCount: 0,
      transportCallCount: 0,
    });
    expect(fixture.readPlan).toHaveBeenCalledTimes(1);
    expect(fixture.listOwned).not.toHaveBeenCalled();
    expect(fixture.byGenerationRequest).not.toHaveBeenCalled();
    expect(fixture.readAttempt).not.toHaveBeenCalled();
    expect(fixture.readPublishedDeployment).not.toHaveBeenCalled();
    for (const lane of ["mage_image", "soulx_avatar"] as const) {
      expect(fixture.publish.get(lane)).not.toHaveBeenCalled();
      expect(fixture.predispatch.get(lane)).not.toHaveBeenCalled();
      expect(fixture.dispatch.get(lane)).not.toHaveBeenCalled();
    }
    expect(fixture.bindLaneAttempt).not.toHaveBeenCalled();
  });

  it("reuses exact active deployment records without republishing global configuration", async () => {
    const fixture = setup({ published: true });
    await expect(
      dispatchHostedPreparedGeneration({
        scope,
        generationRequestId: REQUEST,
        inspection: fixture.inspection,
        runtime: fixture.runtime,
        paidAuthorityGate: fixture.paidAuthorityGate,
        envelopeSigner: fixture.envelopeSigner,
        now: NOW,
      }),
    ).resolves.toMatchObject({ state: "DISPATCHED" });
    expect(fixture.readPublishedDeployment).toHaveBeenCalledTimes(2);
    expect(fixture.publish.get("mage_image")).not.toHaveBeenCalled();
    expect(fixture.publish.get("soulx_avatar")).not.toHaveBeenCalled();
  });

  it("maps two qualified lane batches to deterministic attempts, authorities, outboxes and one send", async () => {
    const fixture = setup();
    const result = await dispatchHostedPreparedGeneration({
      scope,
      generationRequestId: REQUEST,
      inspection: fixture.inspection,
      runtime: fixture.runtime,
      paidAuthorityGate: fixture.paidAuthorityGate,
      envelopeSigner: fixture.envelopeSigner,
      now: NOW,
    });
    expect(result.state).toBe("DISPATCHED");
    if (result.state !== "DISPATCHED") throw new Error("expected dispatch");
    expect(result.committed.map((entry) => entry.lane)).toEqual(["mage_image", "soulx_avatar"]);
    for (const [lane, taskId] of [
      ["mage_image", MAGE_TASK],
      ["soulx_avatar", SOULX_TASK],
    ] as const) {
      const ids = deriveHostedDispatchIds({
        generationRequestId: REQUEST,
        taskId,
        attemptOrdinal: 1,
      });
      expect(result.committed.find((entry) => entry.lane === lane)).toMatchObject({
        taskId,
        lane,
        attemptId: ids.attemptId,
        authorityId: ids.authorityId,
        outboxId: ids.outboxId,
        providerJobId: `provider-${lane}`,
      });
      expect(fixture.publish.get(lane)).not.toHaveBeenCalled();
      expect(fixture.predispatch.get(lane)).toHaveBeenCalledWith(
        scope,
        expect.objectContaining({
          taskId,
          attemptId: ids.attemptId,
          authorityId: ids.authorityId,
          outboxId: ids.outboxId,
          now: DB_CLAIMED_AT,
        }),
      );
      expect(fixture.dispatch.get(lane)).toHaveBeenCalledTimes(1);
      expect(fixture.dispatch.get(lane)).toHaveBeenCalledWith(
        scope,
        expect.objectContaining({
          now: DB_CLAIMED_AT,
          envelope: expect.objectContaining({
            schema: "serverless-worker-job-envelope/v3",
            dispatch_token: expect.stringMatching(/^dt-[0-9a-f]+$/u),
            authority_sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
            signature: expect.objectContaining({
              algorithm: "HMAC-SHA256",
              key_id: "qualified-envelope-key",
              value: expect.stringMatching(/^[0-9a-f]{64}$/u),
            }),
            tenant: { account_id: ACCOUNT, workspace_id: WORKSPACE },
            work: expect.objectContaining({
              task_id: taskId,
              attempt_id: ids.attemptId,
              lane,
            }),
          }),
        }),
      );
      const committedOperation = fixture.predispatch.get(lane)!.mock.calls[0]![1];
      const dispatchedOperation = fixture.dispatch.get(lane)!.mock.calls[0]![1];
      expect(committedOperation.dispatchToken).toBe(
        (dispatchedOperation.envelope as { dispatch_token: string }).dispatch_token,
      );
      expect(canonicalSha256(committedOperation.envelope)).toBe(
        canonicalSha256(dispatchedOperation.envelope),
      );
      expect(dispatchedOperation.commit.envelopeSha256).toBe(
        canonicalSha256(committedOperation.envelope),
      );
      const sent = fixture.dispatch.get(lane)!.mock.calls[0]![1].envelope as Record<
        string,
        unknown
      >;
      const { authority_sha256, signature, ...sentBody } = sent;
      await expect(
        signHostedEnvelopeBody(sentBody as never, {
          keyId: "qualified-envelope-key",
          secretHex: ENVELOPE_SECRET_HEX,
        }),
      ).resolves.toMatchObject({ authoritySha256: authority_sha256, signature });
    }
    expect(fixture.bindLaneAttempt).toHaveBeenCalledTimes(2);
    expect(fixture.bindLaneAttempt).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ now: DB_CLAIMED_AT }),
    );
    expect(fixture.claimOnce).toHaveBeenCalledTimes(1);
    expect(fixture.claimOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: APPROVAL,
        approvalSha256: sha256("f"),
        generationRequestId: REQUEST,
        generationPlanSha256: sha256("9"),
        leaseId: "99999999-9999-4999-8999-999999999999",
        totalCapUsd: 2,
        cumulativeReservationUsd: 1.5,
        lanes: [
          expect.objectContaining({ lane: "mage_image", checkpointId: "V2-07" }),
          expect.objectContaining({ lane: "soulx_avatar", checkpointId: "V2-08" }),
        ],
      }),
    );
  });

  it("fails closed without a composed pair signer before authority or transport mutation", async () => {
    const fixture = setup();
    await expect(
      dispatchHostedPreparedGeneration({
        scope,
        generationRequestId: REQUEST,
        inspection: fixture.inspection,
        runtime: fixture.runtime,
        paidAuthorityGate: fixture.paidAuthorityGate,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_SERVERLESS_ENVELOPE_SIGNER_REQUIRED" });
    expect(fixture.claimOnce).not.toHaveBeenCalled();
    expect(fixture.predispatch.get("mage_image")).not.toHaveBeenCalled();
    expect(fixture.predispatch.get("soulx_avatar")).not.toHaveBeenCalled();
    expect(fixture.dispatch.get("mage_image")).not.toHaveBeenCalled();
    expect(fixture.dispatch.get("soulx_avatar")).not.toHaveBeenCalled();
  });

  it("rejects pair-signature drift before any predispatch record or transport", async () => {
    const fixture = setup();
    const envelopeSigner = {
      signPair: vi.fn(async (bodies: Parameters<typeof fixture.envelopeSigner.signPair>[0]) => {
        const signed = await fixture.envelopeSigner.signPair(bodies);
        return signed.map((entry, index) =>
          index === 0 ? { ...entry, authoritySha256: sha256("0") } : entry,
        );
      }),
      verifyPair: fixture.envelopeSigner.verifyPair.bind(fixture.envelopeSigner),
    };
    await expect(
      dispatchHostedPreparedGeneration({
        scope,
        generationRequestId: REQUEST,
        inspection: fixture.inspection,
        runtime: fixture.runtime,
        paidAuthorityGate: fixture.paidAuthorityGate,
        envelopeSigner,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_SERVERLESS_ENVELOPE_SIGNATURE_INVALID" });
    expect(fixture.predispatch.get("mage_image")).not.toHaveBeenCalled();
    expect(fixture.predispatch.get("soulx_avatar")).not.toHaveBeenCalled();
    expect(fixture.dispatch.get("mage_image")).not.toHaveBeenCalled();
    expect(fixture.dispatch.get("soulx_avatar")).not.toHaveBeenCalled();
  });

  it.each(["wrong signature", "wrong key hash"] as const)(
    "cryptographically rejects %s before either transport",
    async (failure) => {
      const fixture = setup();
      const envelopeSigner = {
        signPair: vi.fn(async (bodies: Parameters<typeof fixture.envelopeSigner.signPair>[0]) => {
          const signed = await fixture.envelopeSigner.signPair(bodies);
          return signed.map((entry, index) => {
            if (index !== 0) return entry;
            return failure === "wrong signature"
              ? {
                  ...entry,
                  signature: { ...entry.signature, value: "0".repeat(64) },
                }
              : { ...entry, keyHash: sha256("0") };
          });
        }),
        verifyPair: fixture.envelopeSigner.verifyPair.bind(fixture.envelopeSigner),
      };
      await expect(
        dispatchHostedPreparedGeneration({
          scope,
          generationRequestId: REQUEST,
          inspection: fixture.inspection,
          runtime: fixture.runtime,
          paidAuthorityGate: fixture.paidAuthorityGate,
          envelopeSigner,
          now: NOW,
        }),
      ).rejects.toMatchObject({ code: "HOSTED_SERVERLESS_ENVELOPE_SIGNATURE_INVALID" });
      expect(fixture.predispatch.get("mage_image")).not.toHaveBeenCalled();
      expect(fixture.predispatch.get("soulx_avatar")).not.toHaveBeenCalled();
      expect(fixture.bindLaneAttempt).not.toHaveBeenCalled();
      expect(fixture.dispatch.get("mage_image")).not.toHaveBeenCalled();
      expect(fixture.dispatch.get("soulx_avatar")).not.toHaveBeenCalled();
    },
  );

  it("derives each task ordinal from its matching runtime lane, never the generation-request epoch", async () => {
    const fixture = setup();
    fixture.listOwned.mockResolvedValue([
      {
        requestKind: "VIDEO" as const,
        requestId: REQUEST,
        state: "ACTIVE" as const,
        queueOrder: 1n,
        version: 3,
        attemptOrdinal: 2,
        availableAt: NOW,
        leaseId: "99999999-9999-4999-8999-999999999999",
        leaseSlot: 1 as const,
        leaseExpiresAt: "2026-08-25T13:00:00.000Z",
      },
    ]);
    await expect(
      dispatchHostedPreparedGeneration({
        scope,
        generationRequestId: REQUEST,
        inspection: fixture.inspection,
        runtime: fixture.runtime,
        paidAuthorityGate: fixture.paidAuthorityGate,
        envelopeSigner: fixture.envelopeSigner,
        now: NOW,
      }),
    ).resolves.toMatchObject({ state: "DISPATCHED" });

    const mismatch = setup();
    mismatch.listOwned.mockResolvedValue([
      {
        requestKind: "VIDEO" as const,
        requestId: REQUEST,
        state: "ACTIVE" as const,
        queueOrder: 1n,
        version: 3,
        attemptOrdinal: 2,
        availableAt: NOW,
        leaseId: "99999999-9999-4999-8999-999999999999",
        leaseSlot: 1 as const,
        leaseExpiresAt: "2026-08-25T13:00:00.000Z",
      },
    ]);
    mismatch.readPlan.mockResolvedValue({
      ...mismatch.persisted,
      tasks: mismatch.persisted.tasks.map((task) =>
        task.lane === "mage_image"
          ? {
              ...task,
              attemptOrdinal: 2,
              outputPrefix:
                `tenant/${ACCOUNT}/workspace/${WORKSPACE}/project/${PROJECT}/revision/${REVISION}` +
                `/lane/mage-image/job/${deriveHostedDispatchIds({ generationRequestId: REQUEST, taskId: task.taskId, attemptOrdinal: 2 }).attemptId}`,
            }
          : task,
      ),
    });
    await expect(
      dispatchHostedPreparedGeneration({
        scope,
        generationRequestId: REQUEST,
        inspection: mismatch.inspection,
        runtime: mismatch.runtime,
        paidAuthorityGate: mismatch.paidAuthorityGate,
        envelopeSigner: mismatch.envelopeSigner,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_SERVERLESS_ADMISSION_REQUIRED" });
  });

  it("atomically rejects an exact approval replay before a second predispatch", async () => {
    const fixture = setup();
    const dispatch = () =>
      dispatchHostedPreparedGeneration({
        scope,
        generationRequestId: REQUEST,
        inspection: fixture.inspection,
        runtime: fixture.runtime,
        paidAuthorityGate: fixture.paidAuthorityGate,
        envelopeSigner: fixture.envelopeSigner,
        now: NOW,
      });
    await expect(dispatch()).resolves.toMatchObject({ state: "DISPATCHED" });
    await expect(dispatch()).rejects.toThrow("HOSTED_PAID_AUTHORITY_REPLAY");
    expect(fixture.claimOnce).toHaveBeenCalledTimes(2);
    expect(fixture.predispatch.get("mage_image")).toHaveBeenCalledTimes(1);
    expect(fixture.predispatch.get("soulx_avatar")).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["insufficient aggregate cap", { gateCapUsd: 1 }],
    [
      "cross-generation approval",
      { gateGenerationRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    ],
  ] as const)("rejects %s atomically before predispatch", async (_label, gateInput) => {
    const fixture = setup(gateInput);
    await expect(
      dispatchHostedPreparedGeneration({
        scope,
        generationRequestId: REQUEST,
        inspection: fixture.inspection,
        runtime: fixture.runtime,
        paidAuthorityGate: fixture.paidAuthorityGate,
        envelopeSigner: fixture.envelopeSigner,
        now: NOW,
      }),
    ).rejects.toThrow("HOSTED_PAID_AUTHORITY_SCOPE_OR_CAP_REJECTED");
    expect(fixture.claimOnce).toHaveBeenCalledTimes(1);
    expect(fixture.predispatch.get("mage_image")).not.toHaveBeenCalled();
    expect(fixture.predispatch.get("soulx_avatar")).not.toHaveBeenCalled();
  });

  it("rejects a generation-plan manifest mismatch before authority claim or predispatch", async () => {
    const fixture = setup();
    fixture.readPlan.mockResolvedValue({
      ...fixture.persisted,
      tasks: fixture.persisted.tasks.map((task) => ({
        ...task,
        envelope: {
          ...task.envelope,
          artifacts: {
            ...(task.envelope.artifacts as Record<string, unknown>),
            plan_manifest_sha256: sha256("0"),
          },
        },
      })),
    });
    await expect(
      dispatchHostedPreparedGeneration({
        scope,
        generationRequestId: REQUEST,
        inspection: fixture.inspection,
        runtime: fixture.runtime,
        paidAuthorityGate: fixture.paidAuthorityGate,
        envelopeSigner: fixture.envelopeSigner,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_SERVERLESS_ENVELOPE_BINDING_INVALID" });
    expect(fixture.claimOnce).not.toHaveBeenCalled();
    expect(fixture.predispatch.get("mage_image")).not.toHaveBeenCalled();
  });

  it("rejects full sealed active-deployment drift before authority claim or predispatch", async () => {
    const fixture = setup();
    fixture.readPublishedDeployment.mockImplementation(async (lane) => {
      const binding = deploymentBinding(lane);
      return lane === "mage_image" ? { ...binding, sealedLineageSha256: sha256("0") } : binding;
    });
    await expect(
      dispatchHostedPreparedGeneration({
        scope,
        generationRequestId: REQUEST,
        inspection: fixture.inspection,
        runtime: fixture.runtime,
        paidAuthorityGate: fixture.paidAuthorityGate,
        envelopeSigner: fixture.envelopeSigner,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_SERVERLESS_ACTIVE_DEPLOYMENT_DRIFT" });
    expect(fixture.claimOnce).not.toHaveBeenCalled();
    expect(fixture.predispatch.get("mage_image")).not.toHaveBeenCalled();
  });

  it("stops before publication when a deterministic attempt already exists", async () => {
    const task = plan().tasks.find((candidate) => candidate.lane === "mage_image")!;
    const ids = deriveHostedDispatchIds({
      generationRequestId: REQUEST,
      taskId: task.taskId,
      attemptOrdinal: task.attemptOrdinal,
    });
    const fixture = setup({
      existing: {
        accountId: ACCOUNT,
        workspaceId: WORKSPACE,
        projectId: PROJECT,
        projectRevisionId: REVISION,
        generationRequestId: REQUEST,
        taskId: task.taskId,
        lane: task.lane,
        attemptOrdinal: task.attemptOrdinal,
        attemptId: ids.attemptId,
        outboxId: ids.outboxId,
        state: "DISPATCH_ACK_UNKNOWN",
      },
    });
    await expect(
      dispatchHostedPreparedGeneration({
        scope,
        generationRequestId: REQUEST,
        inspection: fixture.inspection,
        runtime: fixture.runtime,
        paidAuthorityGate: fixture.paidAuthorityGate,
        envelopeSigner: fixture.envelopeSigner,
        now: NOW,
      }),
    ).resolves.toMatchObject({
      state: "RECONCILIATION_REQUIRED",
      reason: "EXISTING_ATTEMPT",
      attemptId: ids.attemptId,
    });
    for (const lane of ["mage_image", "soulx_avatar"] as const) {
      expect(fixture.publish.get(lane)).not.toHaveBeenCalled();
      expect(fixture.dispatch.get(lane)).not.toHaveBeenCalled();
    }
  });

  it("predispatches and signs the pair but never sends a second lane after acknowledgement-unknown", async () => {
    const fixture = setup({ ackUnknownLane: "mage_image" });
    await expect(
      dispatchHostedPreparedGeneration({
        scope,
        generationRequestId: REQUEST,
        inspection: fixture.inspection,
        runtime: fixture.runtime,
        paidAuthorityGate: fixture.paidAuthorityGate,
        envelopeSigner: fixture.envelopeSigner,
        now: NOW,
      }),
    ).resolves.toMatchObject({
      state: "RECONCILIATION_REQUIRED",
      reason: "DISPATCH_ACK_UNKNOWN",
      lane: "mage_image",
    });
    expect(fixture.dispatch.get("mage_image")).toHaveBeenCalledTimes(1);
    expect(fixture.predispatch.get("soulx_avatar")).toHaveBeenCalledTimes(1);
    expect(fixture.dispatch.get("soulx_avatar")).not.toHaveBeenCalled();
  });

  it.each(["authority", "envelope"] as const)(
    "rejects invalid %s before attempt, authority, outbox, runtime bind, or transport",
    async (invalid) => {
      const fixture = setup();
      fixture.readPlan.mockResolvedValue({
        ...fixture.persisted,
        tasks: fixture.persisted.tasks.map((task) =>
          task.lane !== "mage_image"
            ? task
            : invalid === "authority"
              ? {
                  ...task,
                  checkpointAuthority: {
                    ...task.checkpointAuthority,
                    mode: "none" as const,
                    provider: null,
                    capUsd: 0,
                    resources: [],
                    allowedOperations: [],
                    authorizedOperations: [],
                    rateSnapshot: [],
                    authorizedByUserAt: null,
                    modelId: null,
                  },
                }
              : {
                  ...task,
                  envelope: {
                    ...task.envelope,
                    work: {
                      ...(task.envelope.work as Record<string, unknown>),
                      task_id: SOULX_TASK,
                    },
                  },
                },
        ),
      });
      await expect(
        dispatchHostedPreparedGeneration({
          scope,
          generationRequestId: REQUEST,
          inspection: fixture.inspection,
          runtime: fixture.runtime,
          paidAuthorityGate: fixture.paidAuthorityGate,
          envelopeSigner: fixture.envelopeSigner,
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(HostedDispatchCoordinationError);
      for (const lane of ["mage_image", "soulx_avatar"] as const) {
        expect(fixture.publish.get(lane)).not.toHaveBeenCalled();
        expect(fixture.predispatch.get(lane)).not.toHaveBeenCalled();
        expect(fixture.dispatch.get(lane)).not.toHaveBeenCalled();
      }
      expect(fixture.bindLaneAttempt).not.toHaveBeenCalled();
    },
  );

  it("fails foreign plan lineage and unbatched task cardinality before qualification or mutation", async () => {
    for (const [mutate, qualificationCalls] of [
      [(source: HostedPersistedDispatchPlan) => ({ ...source, accountId: WORKSPACE }), 0],
      [(source: HostedPersistedDispatchPlan) => ({ ...source, tasks: [source.tasks[0]!] }), 2],
    ] as const) {
      const fixture = setup();
      fixture.readPlan.mockResolvedValue(mutate(fixture.persisted));
      await expect(
        dispatchHostedPreparedGeneration({
          scope,
          generationRequestId: REQUEST,
          inspection: fixture.inspection,
          runtime: fixture.runtime,
          paidAuthorityGate: fixture.paidAuthorityGate,
          envelopeSigner: fixture.envelopeSigner,
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(HostedDispatchCoordinationError);
      expect(fixture.requireLane).toHaveBeenCalledTimes(qualificationCalls);
      expect(fixture.listOwned).not.toHaveBeenCalled();
    }
  });

  it("keeps cancellation and reconciliation on exact cleanup-only facades", async () => {
    const task = plan().tasks.find((candidate) => candidate.lane === "mage_image")!;
    const ids = deriveHostedDispatchIds({
      generationRequestId: REQUEST,
      taskId: task.taskId,
      attemptOrdinal: task.attemptOrdinal,
    });
    const existing: HostedPersistedServerlessAttempt = {
      accountId: ACCOUNT,
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      projectRevisionId: REVISION,
      generationRequestId: REQUEST,
      taskId: task.taskId,
      lane: task.lane,
      attemptOrdinal: task.attemptOrdinal,
      attemptId: ids.attemptId,
      outboxId: ids.outboxId,
      state: "RECONCILING",
    };
    const fixture = setup({ existing });
    fixture.readPlan.mockResolvedValue({
      ...fixture.persisted,
      tasks: [
        {
          ...fixture.persisted.tasks.find((candidate) => candidate.lane === "soulx_avatar")!,
          state: "BLOCKED",
        },
      ],
    });
    await expect(
      cancelHostedPersistedAttempt({
        scope,
        generationRequestId: REQUEST,
        taskId: task.taskId,
        attemptOrdinal: 1,
        inspection: fixture.inspection,
        runtime: fixture.runtime,
        requestedBy: "OWNER_ACCOUNT",
        settledCostUsd: 0,
        now: NOW,
      }),
    ).resolves.toEqual({ providerTerminalState: "CANCELLED" });
    await expect(
      reconcileHostedPersistedAttempt({
        scope,
        generationRequestId: REQUEST,
        taskId: task.taskId,
        attemptOrdinal: 1,
        inspection: fixture.inspection,
        runtime: fixture.runtime,
        trigger: "DISPATCH_ACK_UNKNOWN",
        durableReceipts: [],
        possibleDuplicateComputeUsd: 0,
        now: NOW,
      }),
    ).resolves.toBe("AMBIGUOUS_STOP");
    expect(fixture.requireCleanupLane).toHaveBeenCalledTimes(2);
    expect(fixture.cleanup.get("mage_image")?.cancel).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ attemptId: ids.attemptId }),
    );
    expect(fixture.cleanup.get("mage_image")?.reconcile).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ attemptId: ids.attemptId, outboxId: ids.outboxId }),
    );
    expect(fixture.requireLane).not.toHaveBeenCalled();
    expect(fixture.dispatch.get("mage_image")).not.toHaveBeenCalled();
  });
});
