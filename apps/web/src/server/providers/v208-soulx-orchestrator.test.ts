// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { canonicalizeJson } from "@videoforge/contracts";

const parseAuthority = vi.hoisted(() => vi.fn());
const authority = (cap = 6) => ({
  proposalSha256: `sha256:${"1".repeat(64)}`,
  authoritySha256: `sha256:${"2".repeat(64)}`,
  finiteCapUsd: cap,
  image: `ghcr.io/example/soulx@sha256:${"3".repeat(64)}`,
  imageSourceCommit: "4".repeat(40),
  runpodAccountIdSha256: `sha256:${"5".repeat(64)}`,
  requiredAvailability: "HIGH" as const,
  billingBaselineUsd: 10,
  cumulativeBillingStopThresholdUsd: 16,
  predecessorClosureSha256:
    "sha256:aeef45f237fd07e0937cdd51eaaf545ac0d8bb4c90eb105708f1681da787cc79",
});

vi.mock("./v208-soulx-qualification.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./v208-soulx-qualification.js")>();
  return {
    ...actual,
    parseV208SoulXAuthority: parseAuthority,
  };
});

import type { V213DualLaneTransport } from "./v213-dual-lane-live.js";
import {
  dispatchV208Durably,
  assertV208StageConsumptionDecision,
  runV208SoulXWithV213Transport,
  validateV208WholeSpanSuccessProof,
  V208ProcessInterruption,
  V208_WORST_CASE_LIABILITY_USD,
  type V208SoulXOrchestratorDependencies,
} from "./v208-soulx-orchestrator.js";
import {
  V208_SOULX_VOLUME_ID_SHA256,
  V208_SOULX_VOLUME_MANIFEST_SHA256,
} from "./v208-soulx-qualification.js";

describe("V2-08 concrete SoulX orchestrator", () => {
  beforeEach(() => parseAuthority.mockReset().mockReturnValue(authority()));
  it("computes the bounded cold, warm and fault worst-case liability", () => {
    expect(V208_WORST_CASE_LIABILITY_USD).toBeCloseTo((5785 * 1.116) / 3600, 12);
  });

  it("accepts durable RESUME but rejects a consumed replay", () => {
    expect(() => assertV208StageConsumptionDecision("RESUME")).not.toThrow();
    expect(() => assertV208StageConsumptionDecision("REPLAY_REJECTED")).toThrow(
      "V208_AUTHORITY_REPLAY_REJECTED",
    );
  });

  it("reconstructs a durable dispatch on RESUME without redispatch", async () => {
    const providerDispatch = vi.fn();
    const transport = {
      durable: {
        claimOperation: async (operation: Record<string, unknown>) => ({
          action: "RECONCILE",
          record: { ...operation, state: "ACKED", providerId: "job-resumed" },
        }),
        transitionOperation: vi.fn(),
      },
      dispatch: providerDispatch,
      findJobByRequestKey: vi.fn(),
    } as unknown as V213DualLaneTransport;
    await expect(
      dispatchV208Durably(
        transport,
        { endpointId: "endpoint-v208" } as never,
        "soulx-resume",
        { request: { envelope: {} } } as never,
        60_000,
        "authority-v208",
      ),
    ).resolves.toBe("job-resumed");
    expect(providerDispatch).not.toHaveBeenCalled();
  });

  it("journals ACK_UNKNOWN and fails closed when exact dispatch recovery is unavailable", async () => {
    const transitionOperation = vi.fn(async (transition: Record<string, unknown>) => ({
      ...transition,
      state: transition.to,
    }));
    const transport = {
      durable: {
        claimOperation: async (operation: Record<string, unknown>) => ({
          action: "EXECUTE",
          record: { ...operation, state: "IN_FLIGHT" },
        }),
        transitionOperation,
      },
      dispatch: async () => ({ kind: "ACK_UNKNOWN" }),
      findJobByRequestKey: async () => null,
    } as unknown as V213DualLaneTransport;
    await expect(
      dispatchV208Durably(
        transport,
        { endpointId: "endpoint-v208" } as never,
        "soulx-unknown",
        { request: { envelope: {} } } as never,
        60_000,
        "authority-v208",
      ),
    ).rejects.toThrow("V208_DISPATCH_ACK_UNKNOWN");
    expect(transitionOperation).toHaveBeenCalledWith(
      expect.objectContaining({ from: "IN_FLIGHT", to: "ACK_UNKNOWN" }),
    );
  });

  it("rejects missing receipt, media, A/V, item-count, or timing proof", () => {
    const valid = {
      workerReceiptVerified: true,
      outputItemsVerified: 4,
      nativeFullSplitReadbackVerified: true,
      exactAudioVideoProbeVerified: true,
      coldModelReadyMs: 100,
      workerId: "worker-v208",
    };
    expect(() => validateV208WholeSpanSuccessProof(valid)).not.toThrow();
    for (const invalid of [
      { ...valid, workerReceiptVerified: false },
      { ...valid, outputItemsVerified: 3 },
      { ...valid, nativeFullSplitReadbackVerified: false },
      { ...valid, exactAudioVideoProbeVerified: false },
      { ...valid, coldModelReadyMs: Number.NaN },
    ])
      expect(() => validateV208WholeSpanSuccessProof(invalid)).toThrow(
        "V208_WHOLE_SPAN_SUCCESS_PROOF_INVALID",
      );
  });

  it("rejects an insufficient cap before admission, materialization, dispatch or cleanup", async () => {
    parseAuthority.mockReturnValue(authority(0.5));
    const calls = {
      freshAdmission: vi.fn(),
      createLane: vi.fn(),
      materializeQualificationCase: vi.fn(),
      dispatch: vi.fn(),
      deleteLane: vi.fn(),
    };
    const extra = {
      materializeWholeSpan: vi.fn(),
      verifySuccess: vi.fn(),
      cleanupMaterializedInputs: vi.fn(),
      cleanupAmbiguousMaterializedInputs: vi.fn(),
      cleanupOutputKeys: vi.fn(),
      cleanupAttributableResource: vi.fn(),
      serializeEvidence: vi.fn(),
    };
    const dependencies = {
      transport: calls as unknown as V213DualLaneTransport,
      soulx: {} as never,
      ...extra,
    } satisfies V208SoulXOrchestratorDependencies;
    await expect(runV208SoulXWithV213Transport(dependencies, {})).rejects.toThrow(
      "V208_WORST_CASE_LIABILITY_EXCEEDS_CAP",
    );
    for (const call of [...Object.values(calls), ...Object.values(extra)])
      expect(call).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong account", { accountIdSha256: `sha256:${"9".repeat(64)}` }],
    ["low availability", { availability: "LOW" }],
    ["medium availability", { availability: "MEDIUM" }],
    ["billing baseline drift", { cumulativeBillingUsd: 10.000_001 }],
    ["stale observation", { checkedAt: "2026-09-04T23:58:59.999Z" }],
  ])("rejects %s after SQL claim but before provider mutation", async (_label, patch) => {
    const issueStageAuthority = vi.fn(async () => ({
      authorityId: "authority-v208-admission",
    }));
    const claimStageAuthority = vi.fn(async () => ({ decision: "EXECUTE" }));
    const claimOperation = vi.fn(async (operation: Record<string, unknown>) => ({
      action: "EXECUTE",
      record: { ...operation, state: "IN_FLIGHT" },
    }));
    const createLane = vi.fn();
    const admission = {
      checkedAt: "2026-09-05T00:00:00.000Z",
      accountIdSha256: `sha256:${"5".repeat(64)}`,
      gpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      availability: "HIGH",
      flexRateUsdPerGpuHour: 1.116,
      cumulativeBillingUsd: 10,
      runningPods: 0,
      activeWorkers: 0,
      endpoints: 0,
      privateTemplates: 0,
      volumes: [
        {
          idSha256: V208_SOULX_VOLUME_ID_SHA256,
          manifestSha256: V208_SOULX_VOLUME_MANIFEST_SHA256,
          sizeGb: 50,
          region: "EU-RO-1",
        },
      ],
      ...patch,
    };
    const dependencies = {
      soulx: {
        lane: "soulx",
        publicImage: authority().image,
        sourceCommit: authority().imageSourceCommit,
        deploymentSha256: `sha256:${"8".repeat(64)}`,
        volumeIdSha256: V208_SOULX_VOLUME_ID_SHA256,
        volumeManifestSha256: V208_SOULX_VOLUME_MANIFEST_SHA256,
      },
      transport: {
        freshAdmission: async () => admission,
        now: () => new Date("2026-09-05T00:00:00.000Z"),
        durable: { issueStageAuthority, claimStageAuthority, claimOperation },
        createLane,
      } as unknown as V213DualLaneTransport,
      materializeWholeSpan: vi.fn(),
      verifySuccess: vi.fn(),
      cleanupMaterializedInputs: vi.fn(),
      cleanupAmbiguousMaterializedInputs: vi.fn(),
      cleanupOutputKeys: vi.fn(),
      cleanupAttributableResource: vi.fn(),
      serializeEvidence: vi.fn(),
    } satisfies V208SoulXOrchestratorDependencies;
    await expect(runV208SoulXWithV213Transport(dependencies, {})).rejects.toThrow(
      "V208_FRESH_ADMISSION_REJECTED",
    );
    expect(issueStageAuthority).toHaveBeenCalledTimes(1);
    expect(createLane).not.toHaveBeenCalled();
  });

  it("allows paid active-state RESUME admission but performs cleanup only without redispatch", async () => {
    const issueStageAuthority = vi.fn(async () => ({ authorityId: "authority-v208-resume" }));
    const claimStageAuthority = vi.fn(async () => ({ decision: "RESUME" }));
    const claimOperation = vi.fn(async (operation: Record<string, unknown>) => ({
      action: "EXECUTE",
      record: { ...operation, state: "IN_FLIGHT" },
    }));
    const createLane = vi.fn();
    const materializeWholeSpan = vi.fn();
    const materializeQualificationCase = vi.fn();
    const dispatch = vi.fn();
    const cleanupAttributableResource = vi.fn(async () => true as const);
    const cleanupOutputKeys = vi.fn(async () => true as const);
    let inventoryRead = 0;
    const dependencies = {
      soulx: {
        lane: "soulx",
        publicImage: authority().image,
        sourceCommit: authority().imageSourceCommit,
        deploymentSha256: `sha256:${"8".repeat(64)}`,
        volumeIdSha256: V208_SOULX_VOLUME_ID_SHA256,
        volumeManifestSha256: V208_SOULX_VOLUME_MANIFEST_SHA256,
      },
      transport: {
        durable: { issueStageAuthority, claimStageAuthority, claimOperation },
        freshAdmission: async () => ({
          checkedAt: "2026-09-05T00:00:00.000Z",
          accountIdSha256: `sha256:${"5".repeat(64)}`,
          gpu: "unavailable-during-cleanup",
          region: "provider-transient",
          availability: "LOW",
          flexRateUsdPerGpuHour: 9,
          cumulativeBillingUsd: 10.2,
          runningPods: 1,
          activeWorkers: 1,
          endpoints: 1,
          privateTemplates: 1,
          volumes: [
            {
              idSha256: V208_SOULX_VOLUME_ID_SHA256,
              manifestSha256: V208_SOULX_VOLUME_MANIFEST_SHA256,
              sizeGb: 50,
              region: "EU-RO-1",
            },
          ],
        }),
        now: () =>
          new Date(Date.UTC(2026, 8, 5, 0, 0, 0, Math.max(0, inventoryRead - 1) * 2_000)),
        findLaneByResourceKey: vi.fn(async () => null),
        createLane,
        materializeQualificationCase,
        dispatch,
        inventory: async () => ({
          checkedAt: new Date(
            Date.UTC(2026, 8, 5, 0, 0, 0, inventoryRead++ * 2_000),
          ).toISOString(),
          runningPods: 0,
          activeWorkers: 0,
          queuedJobs: 0,
          endpointIdSha256s: [],
          templateIdSha256s: [],
          volumes: [
            {
              idSha256: V208_SOULX_VOLUME_ID_SHA256,
              manifestSha256: V208_SOULX_VOLUME_MANIFEST_SHA256,
              sizeGb: 50,
              region: "EU-RO-1",
            },
          ],
        }),
        billingAmount: async () => 10.2,
        sleep: async () => undefined,
      } as unknown as V213DualLaneTransport,
      materializeWholeSpan,
      verifySuccess: vi.fn(),
      cleanupMaterializedInputs: vi.fn(),
      cleanupAmbiguousMaterializedInputs: vi.fn(),
      cleanupOutputKeys,
      cleanupAttributableResource,
      serializeEvidence: vi.fn(),
    } satisfies V208SoulXOrchestratorDependencies;
    await expect(runV208SoulXWithV213Transport(dependencies, {})).rejects.toThrow(
      "V208_RESUME_REQUIRES_CLEANUP_ONLY",
    );
    expect(cleanupAttributableResource).toHaveBeenCalledTimes(1);
    expect(cleanupOutputKeys).toHaveBeenCalledWith([]);
    expect(createLane).not.toHaveBeenCalled();
    expect(materializeWholeSpan).not.toHaveBeenCalled();
    expect(materializeQualificationCase).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches two true whole-span batches, no Mage, cleans outputs, and reads zero three times", async () => {
    const digest = (value: string) =>
      `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
    const deployment = {
      lane: "soulx" as const,
      purpose: "qualification" as const,
      endpointId: "endpoint-soulx",
      endpointIdSha256: digest("endpoint-soulx"),
      templateId: "template-soulx",
      templateIdSha256: digest("template-soulx"),
      image: authority().image,
      sourceCommit: authority().imageSourceCommit,
      deploymentSha256: `sha256:${"8".repeat(64)}`,
      volumeIdSha256: V208_SOULX_VOLUME_ID_SHA256,
      volumeManifestSha256: V208_SOULX_VOLUME_MANIFEST_SHA256,
      volumeSizeGb: 50 as const,
      volumeMount: "/runpod-volume" as const,
      region: "EU-RO-1" as const,
      gpu: "NVIDIA GeForce RTX 4090" as const,
      gpuCount: 1 as const,
      workersMin: 0 as const,
      workersMax: 1 as const,
      idleTimeoutSeconds: 60 as const,
      handlerConcurrency: 1 as const,
      scalerType: "REQUEST_COUNT" as const,
      scalerValue: 1 as const,
      initTimeoutSeconds: 800,
    };
    const dispatched: string[] = [];
    const dispatchPolicies: Array<{
      requestKey: string;
      executionTimeoutMs: number;
      ttlMs: number;
    }> = [];
    const lifecycle: string[] = [];
    const inputCleanupDispatchCounts: number[] = [];
    let providerLaneDeleted = false;
    let createdIdleTimeout: number | undefined;
    let stageClaims = 0;
    let crashAt:
      | "lane-delete"
      | "attributable-cleanup"
      | "output-delete"
      | "final-zero"
      | null = "lane-delete";
    const durableOperations = new Map<string, Record<string, unknown>>();
    const output = (count: number, id: string) => ({
      schemaVersion: "videoforge.v213-qualification-case-materialization/v1" as const,
      caseDescriptorSha256: `sha256:${"a".repeat(64)}`,
      materializationEvidenceSha256: `sha256:${"b".repeat(64)}`,
      request: {
        input_get_urls: Array.from(
          { length: count === 4 ? 5 : 2 },
          (_, index) => `https://example.test/input-${index}`,
        ),
        ports: {
          inputs: Array.from({ length: count === 4 ? 5 : 2 }, (_, index) => ({
            path: `/tenant/test/${id}/input-${index}`,
          })),
        },
        generated_output_authorities: Array.from({ length: count }, (_, index) => ({
          path: `/tenant/test/${id}/output-${index}.mp4`,
        })),
      },
    });
    let inventoryRead = 0;
    const inventory = vi.fn(async () => ({
      checkedAt: new Date(Date.UTC(2026, 8, 5, 0, 0, 0, inventoryRead++ * 2_000)).toISOString(),
      runningPods: 0,
      activeWorkers: 0,
      queuedJobs: 0,
      endpointIdSha256s: providerLaneDeleted ? [] : [deployment.endpointIdSha256],
      templateIdSha256s: providerLaneDeleted ? [] : [deployment.templateIdSha256],
      volumes: [
        {
          idSha256: V208_SOULX_VOLUME_ID_SHA256,
          manifestSha256: V208_SOULX_VOLUME_MANIFEST_SHA256,
          sizeGb: 50,
          region: "EU-RO-1" as const,
        },
      ],
    }));
    const transport = {
      durable: {
        issueStageAuthority: async (input: Record<string, string>) => ({
          schemaVersion: "videoforge.v213-stage-authority/v1",
          authorityId: "authority-v208",
          stage: "soulx",
          inputSha256: input.inputSha256,
          predecessorHandoffSha256: input.predecessorHandoffSha256,
          nonce: "nonce",
          issuedAt: "2026-09-05T00:00:00.000Z",
          expiresAt: "2026-09-05T01:00:00.000Z",
          singleUse: true,
          signatureBase64: "A".repeat(88),
        }),
        claimStageAuthority: async () => ({
          decision: stageClaims++ === 0 ? "EXECUTE" : "RESUME",
          authorityId: "authority-v208",
          nonceSha256: `sha256:${"c".repeat(64)}`,
          consumedAt: "2026-09-05T00:00:00.000Z",
        }),
        completeStageAuthority: vi.fn(async () => {
          lifecycle.push("complete-authority");
        }),
        claimOperation: async (operation: Record<string, unknown>) => {
          const key = String(operation.operationId);
          const existing = durableOperations.get(key);
          if (existing)
            return {
              action: existing.state === "TERMINAL" ? "DONE" : "RECONCILE",
              record: existing,
            };
          const record = { ...operation, state: "IN_FLIGHT" };
          durableOperations.set(key, record);
          return { action: "EXECUTE", record };
        },
        transitionOperation: async (transition: Record<string, unknown>) => {
          const key = String(transition.operationId);
          const existing = durableOperations.get(key) ?? {};
          const record = {
            ...existing,
            state: transition.to,
            ...(transition.providerId ? { providerId: transition.providerId } : {}),
            ...(transition.evidence ? { evidence: transition.evidence } : {}),
          };
          durableOperations.set(key, record);
          return record;
        },
      },
      freshAdmission: async () => ({
        checkedAt: "2026-09-05T00:00:00.000Z",
        accountIdSha256: `sha256:${"5".repeat(64)}`,
        gpu: "NVIDIA GeForce RTX 4090",
        region: "EU-RO-1",
        availability: "HIGH",
        flexRateUsdPerGpuHour: 1.116,
        cumulativeBillingUsd: 10,
        runningPods: 0,
        activeWorkers: 0,
        endpoints: 0,
        privateTemplates: 0,
        volumes: [
          {
            idSha256: V208_SOULX_VOLUME_ID_SHA256,
            manifestSha256: V208_SOULX_VOLUME_MANIFEST_SHA256,
            sizeGb: 50,
            region: "EU-RO-1",
          },
        ],
      }),
      createLane: async (input: { idleTimeoutSeconds?: number }) => {
        createdIdleTimeout = input.idleTimeoutSeconds;
        return { kind: "ACK", deployment };
      },
      readLane: async () => deployment,
      findLaneByResourceKey: async () => null,
      materializeQualificationCase: async ({ descriptor }: { descriptor: { id: string } }) =>
        output(1, descriptor.id),
      dispatch: async ({
        requestKey,
        policy,
      }: {
        requestKey: string;
        policy: { executionTimeoutMs: number; ttlMs: number };
      }) => {
        dispatched.push(requestKey);
        lifecycle.push(`dispatch:${requestKey}`);
        dispatchPolicies.push({ requestKey, ...policy });
        return { kind: "ACK", jobId: `job-${requestKey}` };
      },
      findJobByRequestKey: async () => null,
      status: async (_endpoint: string, jobId: string) => {
        lifecycle.push(`status:${jobId}`);
        return jobId.includes("cancel")
          ? { jobId, status: "CANCELLED" }
          : jobId.includes("invalid-output")
            ? { jobId, status: "FAILED", failureCode: "SOULX_OUTPUT_CONTRACT_INVALID" }
            : jobId.includes("timeout")
              ? { jobId, status: "TIMED_OUT" }
              : {
                  jobId,
                  status: "COMPLETED",
                  receiptDelivery: {
                    receipt: {} as never,
                    receiptBodyBase64: "c2lnbmVkLXJlY2VpcHQ=",
                  },
                };
      },
      cancel: async (_endpoint: string, jobId: string) => ({ jobId, status: "CANCELLED" }),
      deleteLane: vi.fn(async () => {
        lifecycle.push("delete-lane");
        providerLaneDeleted = true;
      }),
      inventory,
      billingAmount: async () => 10.2,
      sleep: async () => undefined,
      now: () => new Date(Date.UTC(2026, 8, 5, 0, 0, 0, Math.max(0, inventoryRead - 1) * 2_000)),
    } as unknown as V213DualLaneTransport;
    const cleanupOutputKeys = vi.fn(async () => {
      lifecycle.push("delete-outputs");
      return true as const;
    });
    const cleanupMaterializedInputs: V208SoulXOrchestratorDependencies["cleanupMaterializedInputs"] =
      vi.fn(async ({ materialization, terminalOutcome }) => {
        inputCleanupDispatchCounts.push(dispatched.length);
        const inputPaths = (
          materialization.request as { ports: { inputs: Array<{ path: string }> } }
        ).ports.inputs.map(({ path }) => path.slice(1));
        const base = {
          schemaVersion: "videoforge.v213-qualification-input-cleanup/v1" as const,
          requestSha256: `sha256:${"d".repeat(64)}` as const,
          terminalOutcome,
          deletedObjectKeySha256s: inputPaths.map(
            (path) => `sha256:${createHash("sha256").update(path, "utf8").digest("hex")}` as const,
          ),
          absenceVerified: true as const,
        };
        return {
          originalRequestSha256: base.requestSha256,
          evidence: {
            ...base,
            evidenceSha256: `sha256:${createHash("sha256")
              .update(canonicalizeJson(base))
              .digest("hex")}` as `sha256:${string}`,
          },
        };
      });
    const dependencies: V208SoulXOrchestratorDependencies = {
      transport,
      soulx: {
        lane: "soulx",
        publicImage: authority().image,
        sourceCommit: authority().imageSourceCommit,
        deploymentSha256: deployment.deploymentSha256,
        volumeIdSha256: V208_SOULX_VOLUME_ID_SHA256,
        volumeManifestSha256: V208_SOULX_VOLUME_MANIFEST_SHA256,
      },
      materializeWholeSpan: async ({ descriptor }) => output(4, descriptor.id),
      verifySuccess: async ({ descriptor }) => ({
        workerReceiptVerified: true,
        outputItemsVerified: 4,
        nativeFullSplitReadbackVerified: true,
        exactAudioVideoProbeVerified: true,
        coldModelReadyMs: descriptor.cold ? 419_999 : 1_000,
        workerId: "worker-v208",
      }),
      cleanupMaterializedInputs,
      cleanupAmbiguousMaterializedInputs: vi.fn(async () => true as const),
      cleanupOutputKeys,
      cleanupAttributableResource: async () => {
        lifecycle.push("cleanup-resource");
        return true;
      },
      interruptionCheckpoint: async (phase) => {
        if (phase === crashAt) throw new V208ProcessInterruption(phase);
      },
      serializeEvidence: vi.fn(async () => {
        lifecycle.push("serialize-evidence");
      }),
    };
    for (const phase of [
      "lane-delete",
      "attributable-cleanup",
      "output-delete",
      "final-zero",
    ] as const) {
      crashAt = phase;
      await expect(runV208SoulXWithV213Transport(dependencies, {})).rejects.toThrow(phase);
    }
    crashAt = null;
    await expect(runV208SoulXWithV213Transport(dependencies, {})).resolves.toMatchObject({
      qualified: true,
      workerReceiptsVerified: 2,
      outputItemsVerified: 8,
      finalZeroComputeReads: 3,
    });
    expect(dispatched.filter((id) => id.includes("whole-span"))).toHaveLength(2);
    expect(createdIdleTimeout).toBe(60);
    const coldDispatch = lifecycle.indexOf(
      "dispatch:v208-soulx-cold-whole-span-2-4-6-10s",
    );
    const warmDispatch = lifecycle.indexOf(
      "dispatch:v208-soulx-warm-whole-span-2-4-6-10s",
    );
    const coldStatus = lifecycle.indexOf(
      "status:job-v208-soulx-cold-whole-span-2-4-6-10s",
    );
    expect(coldDispatch).toBeGreaterThanOrEqual(0);
    expect(coldStatus).toBeGreaterThan(coldDispatch);
    expect(warmDispatch).toBeGreaterThan(coldStatus);
    expect(inputCleanupDispatchCounts[0]).toBe(2);
    expect(dispatched.some((id) => id.includes("mage"))).toBe(false);
    expect(dispatchPolicies.map(({ requestKey, ...policy }) => [requestKey, policy])).toEqual([
      ["v208-soulx-cold-whole-span-2-4-6-10s", { executionTimeoutMs: 800_000, ttlMs: 7_200_000 }],
      ["v208-soulx-warm-whole-span-2-4-6-10s", { executionTimeoutMs: 800_000, ttlMs: 7_200_000 }],
      ["v208-soulx-cancel", { executionTimeoutMs: 60_000, ttlMs: 7_200_000 }],
      ["v208-soulx-invalid-output", { executionTimeoutMs: 60_000, ttlMs: 7_200_000 }],
      ["v208-soulx-timeout", { executionTimeoutMs: 5_000, ttlMs: 7_200_000 }],
    ]);
    expect(cleanupOutputKeys).toHaveBeenCalled();
    expect(cleanupMaterializedInputs).toHaveBeenCalledTimes(5);
    expect(inventory).toHaveBeenCalledTimes(7);
    expect(transport.deleteLane).toHaveBeenCalledTimes(1);
    expect(cleanupOutputKeys).toHaveBeenCalledTimes(2);
    expect(dispatched).toHaveLength(5);
    expect(lifecycle.filter((event) => event === "cleanup-resource")).toHaveLength(2);
    expect(lifecycle.slice(-5)).toEqual([
      "cleanup-resource",
      "delete-outputs",
      "delete-outputs",
      "complete-authority",
      "serialize-evidence",
    ]);
  });
});
