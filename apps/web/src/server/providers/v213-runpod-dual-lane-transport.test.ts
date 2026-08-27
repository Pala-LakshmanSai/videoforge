import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { ProvenanceReceiptSigner } from "@videoforge/control-plane";

import { createV213RunPodDualLaneTransport } from "./v213-runpod-dual-lane-transport.js";
import type { V213DualLaneInput } from "./v213-dual-lane-live.js";

const sha = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const idSha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function input(): V213DualLaneInput {
  const sealed = (lane: "mage" | "soulx", volumeId: string, marker: string) => ({
    lane,
    publicImage: `ghcr.io/example/${lane}@${sha(marker)}`,
    sourceCommit: marker.repeat(40),
    deploymentSha256: sha(marker),
    volumeId,
    volumeIdSha256: idSha(volumeId),
    volumeManifestSha256: sha(marker === "a" ? "e" : "f"),
    receiptKeyId: "fixture-receipt-key",
  });
  return {
    accountIdSha256: sha("9"),
    mage: sealed("mage", "volume_mage", "a"),
    soulx: sealed("soulx", "volume_soulx", "b"),
    billingBaselineUsd: 1,
    totalCapUsd: 17.5,
    mageQualificationCapUsd: 4.5,
    soulxQualificationCapUsd: 1,
    stageAuthorityPublicKeyPem: "fixture",
    receiptSigner: new ProvenanceReceiptSigner("fixture-receipt-key", new Uint8Array(32).fill(7)),
    envelopes: {
      mage: {},
      soulx2s: {},
      soulx4s: {},
      soulx6s: {},
      soulx10s: {},
      soulxCancel: {},
      soulxInvalidOutput: {},
      soulxTimeout: {},
    },
  };
}

function fixture(
  options: {
    dispatchAmbiguous?: boolean;
    endpointCreateAmbiguous?: boolean;
    withDelivery?: boolean;
    deletionRemains?: boolean;
    queueNonEmpty?: boolean;
    queueNonEmptyOnCheck?: number;
  } = {},
) {
  const model = input();
  const endpoints: { id: string; idHash: string; name: string }[] = [];
  const templates: { id: string; idHash: string; name: string }[] = [];
  const endpointRaw = new Map<string, Record<string, unknown>>();
  const templateRaw = new Map<string, Record<string, unknown>>();
  const jobs = new Map<string, { id: string; status: string; output?: unknown }>();
  const control = {
    createServerlessTemplate: vi.fn(async (name: string, imageName: string) => {
      const id = `template_${templates.length + 1}`;
      const item = { id, idHash: idSha(id), name };
      templates.push(item);
      templateRaw.set(item.id, { imageName });
      return item;
    }),
    createScaleZeroEndpoint: vi.fn(
      async (
        name: string,
        templateId: string,
        gpuTypeIds: readonly string[],
        policy: { workersMin: number; workersMax: number; gpuCount: number },
        placement: { networkVolumeId: string },
      ) => {
        if (options.endpointCreateAmbiguous) throw new Error("lost endpoint create");
        const id = `endpoint_${endpoints.length + 1}`;
        const item = { id, idHash: idSha(id), name };
        endpoints.push(item);
        endpointRaw.set(item.id, { templateId, gpuTypeIds, ...policy, ...placement });
        return item;
      },
    ),
    bindV207EndpointIdentity: vi.fn(async () => undefined),
    inventoryDisposableResources: vi.fn(async () => ({
      endpoints: endpoints.map((item) => ({ ...item, raw: endpointRaw.get(item.id)! })),
      templates: templates.map((item) => ({ ...item, raw: templateRaw.get(item.id)! })),
    })),
    inventory: vi.fn(async () => ({
      checkedAt: "2026-08-26T00:30:00.000Z",
      pods: [],
      endpoints: endpoints.map((item) => ({
        idHash: item.idHash,
        workersMin: 0,
        workersMax: 1,
        workerRecordsReported: true,
        workerRecordCount: 0,
        activeWorkerCount: 0,
        exitedWorkerCount: 0,
        workerStatuses: [],
        scaleZeroCompliant: true,
      })),
      privateTemplateCount: templates.length,
      networkVolumes: [
        { idHash: model.mage.volumeIdSha256, sizeGb: 50, dataCenterId: "EU-RO-1" },
        { idHash: model.soulx.volumeIdSha256, sizeGb: 50, dataCenterId: "EU-RO-1" },
      ],
      runningPodCount: 0,
      activeServerlessWorkerCount: 0,
    })),
    deleteEndpoint: vi.fn(async (id: string) => {
      if (options.deletionRemains) return;
      endpoints.splice(
        endpoints.findIndex((item) => item.id === id),
        1,
      );
    }),
    deleteTemplate: vi.fn(async (id: string) => {
      if (options.deletionRemains) return;
      templates.splice(
        templates.findIndex((item) => item.id === id),
        1,
      );
    }),
  };
  let queueChecks = 0;
  const client = {
    confirmStartupQueueEmpty: vi.fn(async () => {
      queueChecks += 1;
      if (options.queueNonEmpty || options.queueNonEmptyOnCheck === queueChecks)
        throw new Error("V213_STARTUP_QUEUE_NOT_CONFIRMED");
    }),
    dispatch: vi.fn(async (requestKey: string) => {
      if (options.dispatchAmbiguous) throw new Error("lost");
      const job = {
        id: `job_${requestKey}`,
        status: "COMPLETED",
        output: options.withDelivery
          ? {
              provenance_receipt: { schema_version: "serverless-provenance-receipt/v1" },
              provenance_receipt_body_base64: "ZXhhY3QtcmVjZWlwdA==",
            }
          : {},
      };
      jobs.set(job.id, job);
      return { ...job, idHash: sha("3"), executionTimeMs: 1, delayTimeMs: 1 };
    }),
    status: vi.fn(async (id: string) => ({
      ...jobs.get(id)!,
      idHash: sha("3"),
      executionTimeMs: 1,
      delayTimeMs: 1,
    })),
    cancel: vi.fn(async (id: string) => ({
      id,
      idHash: sha("3"),
      status: "CANCELLED",
      executionTimeMs: 1,
      delayTimeMs: 1,
    })),
  };
  const verifyOutputReadback = vi.fn(async () => true as const);
  const createJobClient = vi.fn((_endpointId: string) => client);
  const makeTransport = (transportInput: V213DualLaneInput = model) =>
    createV213RunPodDualLaneTransport({
      durable: {} as never,
      input: transportInput,
      control,
      accountPreflight: async () => ({ accountIdHash: model.accountIdSha256 }),
      readAdmissionFacts: async () => ({
        checkedAt: "2026-08-26T00:30:00.000Z",
        availability: "LOW",
        flexRateUsdPerGpuHour: 1.116,
        cumulativeBillingUsd: 1,
      }),
      createJobClient,
      verifyOutputReadback,
      sleep: async () => undefined,
      now: () => new Date("2026-08-26T00:30:00.000Z"),
    });
  const transport = makeTransport();
  return {
    transport,
    makeTransport,
    control,
    client,
    model,
    verifyOutputReadback,
    createJobClient,
  };
}

describe("V213 concrete RunPod dual-lane transport", () => {
  it("creates deterministic max-one resources, runs one job and deletes only after zero", async () => {
    const { transport, control, client, model } = fixture();
    const created = await transport.createLane({
      sealed: model.mage,
      purpose: "qualification",
      resourceKey: "stage:mage:qualification",
      workersMin: 0,
      workersMax: 1,
    });
    expect(created.kind).toBe("ACK");
    if (created.kind !== "ACK") throw new Error("fixture");
    expect(created.deployment).toMatchObject({ workersMin: 0, workersMax: 1, region: "EU-RO-1" });
    await expect(transport.readLane(created.deployment)).resolves.toEqual(created.deployment);
    await expect(
      transport.dispatch({
        deployment: created.deployment,
        requestKey: "v213-mage",
        envelope: {},
      }),
    ).resolves.toMatchObject({ kind: "ACK", jobId: "job_v213-mage" });
    await expect(
      transport.status(created.deployment.endpointId, "job_v213-mage"),
    ).resolves.toMatchObject({
      status: "COMPLETED",
    });
    await transport.deleteLane(created.deployment);
    expect(control.deleteEndpoint).toHaveBeenCalledOnce();
    expect(control.deleteTemplate).toHaveBeenCalledOnce();
    expect(client.dispatch).toHaveBeenCalledOnce();
  });

  it("returns ACK_UNKNOWN and never redispatches or guesses a provider job", async () => {
    const { transport, client, model } = fixture({ dispatchAmbiguous: true });
    const created = await transport.createLane({
      sealed: model.soulx,
      purpose: "qualification",
      resourceKey: "stage:soulx:qualification",
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    await expect(
      transport.dispatch({
        deployment: created.deployment,
        requestKey: "v213-soulx-2s",
        envelope: {},
      }),
    ).resolves.toEqual({ kind: "ACK_UNKNOWN" });
    await expect(
      transport.findJobByRequestKey({
        endpointId: created.deployment.endpointId,
        requestKey: "v213-soulx-2s",
      }),
    ).resolves.toBeNull();
    expect(client.dispatch).toHaveBeenCalledOnce();
  });

  it("dispatches each production lane only through its own endpoint", async () => {
    const { transport, model, createJobClient } = fixture();
    const mage = await transport.createLane({
      sealed: model.mage,
      purpose: "production",
      resourceKey: "v213-stage_production-mage-production",
      workersMin: 0,
      workersMax: 1,
    });
    const soulx = await transport.createLane({
      sealed: model.soulx,
      purpose: "production",
      resourceKey: "v213-stage_production-soulx-production",
      workersMin: 0,
      workersMax: 1,
    });
    if (mage.kind !== "ACK" || soulx.kind !== "ACK") throw new Error("fixture");
    await transport.dispatch({
      deployment: mage.deployment,
      requestKey: "production-mage-job",
      envelope: {},
    });
    await transport.dispatch({
      deployment: soulx.deployment,
      requestKey: "production-soulx-job",
      envelope: {},
    });
    expect(createJobClient.mock.calls.slice(-2).map(([endpointId]) => endpointId)).toEqual([
      mage.deployment.endpointId,
      soulx.deployment.endpointId,
    ]);
    expect(mage.deployment.endpointId).not.toBe(soulx.deployment.endpointId);
  });

  it("builds exact admission and inventory from authenticated provider reads", async () => {
    const { transport, model } = fixture();
    await expect(transport.freshAdmission()).resolves.toMatchObject({
      accountIdSha256: model.accountIdSha256,
      gpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      endpoints: 0,
      privateTemplates: 0,
      volumes: [{ sizeGb: 50 }, { sizeGb: 50 }],
    });
  });

  it("delivers raw HMAC receipt bytes only after independent output readback", async () => {
    const { transport, model, verifyOutputReadback } = fixture({ withDelivery: true });
    const created = await transport.createLane({
      sealed: model.mage,
      purpose: "qualification",
      resourceKey: "stage:mage:receipt",
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    const ack = await transport.dispatch({
      deployment: created.deployment,
      requestKey: "v213-mage-receipt",
      envelope: {},
    });
    if (ack.kind !== "ACK") throw new Error("fixture");
    await expect(transport.status(created.deployment.endpointId, ack.jobId)).resolves.toMatchObject(
      {
        outputReadbackVerified: true,
        receiptDelivery: { receiptBodyBase64: "ZXhhY3QtcmVjZWlwdA==" },
      },
    );
    expect(verifyOutputReadback).toHaveBeenCalledOnce();
  });

  it("reconstructs exact resources and reads an ACKed job after a process restart", async () => {
    const { transport, makeTransport, model } = fixture();
    const resourceKey = "v213-authority_1-mage-qualification";
    const created = await transport.createLane({
      sealed: model.mage,
      purpose: "qualification",
      resourceKey,
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    const ack = await transport.dispatch({
      deployment: created.deployment,
      requestKey: "restart-job",
      envelope: {},
    });
    if (ack.kind !== "ACK") throw new Error("fixture");
    const restarted = makeTransport();
    await expect(restarted.findLaneByResourceKey(resourceKey)).resolves.toEqual(created.deployment);
    await expect(restarted.status(created.deployment.endpointId, ack.jobId)).resolves.toMatchObject(
      {
        jobId: ack.jobId,
        status: "COMPLETED",
      },
    );
  });

  it("does not claim deletion while either exact provider resource remains", async () => {
    const { transport, model } = fixture({ deletionRemains: true });
    const created = await transport.createLane({
      sealed: model.soulx,
      purpose: "production",
      resourceKey: "v213-authority_2-soulx-production",
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    await expect(transport.deleteLane(created.deployment)).rejects.toThrow(
      "V213_DELETE_ABSENCE_NOT_PROVEN",
    );
  });

  it("derives template inventory from provider readback and proves every endpoint queue empty", async () => {
    const { transport, client, model } = fixture();
    await transport.createLane({
      sealed: model.mage,
      purpose: "production",
      resourceKey: "v213-authority_3-mage-production",
      workersMin: 0,
      workersMax: 1,
    });
    await expect(transport.inventory()).resolves.toMatchObject({
      queuedJobs: 0,
      templateIdSha256s: [expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)],
    });
    expect(client.confirmStartupQueueEmpty).toHaveBeenCalled();
  });

  it("cleans a template-only lost endpoint create by deterministic authority name", async () => {
    const { transport, control, model } = fixture({ endpointCreateAmbiguous: true });
    await expect(
      transport.createLane({
        sealed: model.mage,
        purpose: "qualification",
        resourceKey: "v213-stage_mage-mage-qualification",
        workersMin: 0,
        workersMax: 1,
      }),
    ).resolves.toMatchObject({
      kind: "ACK_UNKNOWN",
      partial: { templateId: "template_1", resourceKey: "v213-stage_mage-mage-qualification" },
    });
    await expect(
      transport.cleanupAttributableResources([
        { stage: "mage", stageAuthorityId: "stage_mage", operations: [] },
      ]),
    ).resolves.toMatchObject({ production: [], deletedTemplateIdSha256s: [expect.any(String)] });
    expect(control.deleteTemplate).toHaveBeenCalledOnce();
  });

  it("cleans partial Mage and SoulX qualification resources before max-one", async () => {
    const { transport, model } = fixture();
    for (const [stageAuthorityId, sealed] of [
      ["stage_mage", model.mage],
      ["stage_soulx", model.soulx],
    ] as const) {
      await transport.createLane({
        sealed,
        purpose: "qualification",
        resourceKey: `v213-${stageAuthorityId}-${sealed.lane}-qualification`,
        workersMin: 0,
        workersMax: 1,
      });
    }
    await expect(
      transport.cleanupAttributableResources([
        { stage: "mage", stageAuthorityId: "stage_mage", operations: [] },
        { stage: "soulx", stageAuthorityId: "stage_soulx", operations: [] },
      ]),
    ).resolves.toMatchObject({
      production: [],
      deletedEndpointIdSha256s: [expect.any(String), expect.any(String)],
      deletedTemplateIdSha256s: [expect.any(String), expect.any(String)],
    });
  });

  it("removes qualification partials but retains the exact full max-one production pair", async () => {
    const { transport, model } = fixture();
    for (const [stageAuthorityId, sealed, purpose] of [
      ["stage_mage", model.mage, "qualification"],
      ["stage_soulx", model.soulx, "qualification"],
      ["stage_production", model.mage, "production"],
      ["stage_production", model.soulx, "production"],
    ] as const) {
      await transport.createLane({
        sealed,
        purpose,
        resourceKey: `v213-${stageAuthorityId}-${sealed.lane}-${purpose}`,
        workersMin: 0,
        workersMax: 1,
      });
    }
    await expect(
      transport.cleanupAttributableResources([
        { stage: "mage", stageAuthorityId: "stage_mage", operations: [] },
        { stage: "soulx", stageAuthorityId: "stage_soulx", operations: [] },
        { stage: "production", stageAuthorityId: "stage_production", operations: [] },
      ]),
    ).resolves.toMatchObject({
      production: [
        { lane: "mage", workersMax: 1 },
        { lane: "soulx", workersMax: 1 },
      ],
      deletedEndpointIdSha256s: [expect.any(String), expect.any(String)],
    });
  });

  it("preserves the exact production pair with hash-only cleanup descriptors", async () => {
    const { transport, makeTransport, control, model } = fixture();
    const mageKey = "v213-stage_production-mage-production";
    const soulxKey = "v213-stage_production-soulx-production";
    const mage = await transport.createLane({
      sealed: model.mage,
      purpose: "production",
      resourceKey: mageKey,
      workersMin: 0,
      workersMax: 1,
    });
    const soulx = await transport.createLane({
      sealed: model.soulx,
      purpose: "production",
      resourceKey: soulxKey,
      workersMin: 0,
      workersMax: 1,
    });
    if (mage.kind !== "ACK" || soulx.kind !== "ACK") throw new Error("fixture");
    const hashOnlyInput = {
      ...model,
      mage: {
        lane: "mage",
        volumeIdSha256: model.mage.volumeIdSha256,
        volumeManifestSha256: model.mage.volumeManifestSha256,
      },
      soulx: {
        lane: "soulx",
        volumeIdSha256: model.soulx.volumeIdSha256,
        volumeManifestSha256: model.soulx.volumeManifestSha256,
      },
    } as never as V213DualLaneInput;
    const restarted = makeTransport(hashOnlyInput);
    await expect(
      restarted.cleanupAttributableResources([
        {
          stage: "production",
          stageAuthorityId: "stage_production",
          operations: [
            {
              kind: "create",
              resourceKey: mageKey,
              state: "ACKED",
              providerId: mage.deployment.endpointId,
              evidence: mage.deployment,
            },
            {
              kind: "create",
              resourceKey: soulxKey,
              state: "ACKED",
              providerId: soulx.deployment.endpointId,
              evidence: soulx.deployment,
            },
          ],
        },
      ]),
    ).resolves.toMatchObject({
      production: [
        { lane: "mage", purpose: "production", workersMin: 0, workersMax: 1 },
        { lane: "soulx", purpose: "production", workersMin: 0, workersMax: 1 },
      ],
      deletedEndpointIdSha256s: [],
      deletedTemplateIdSha256s: [],
    });
    expect(control.deleteEndpoint).not.toHaveBeenCalled();
    expect(control.deleteTemplate).not.toHaveBeenCalled();
  });

  it("rejects production cleanup when journaled volume binding drifts from hash-only scope", async () => {
    const { transport, makeTransport, control, model } = fixture();
    const resourceKey = "v213-stage_production-mage-production";
    const created = await transport.createLane({
      sealed: model.mage,
      purpose: "production",
      resourceKey,
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    const hashOnlyInput = {
      ...model,
      mage: {
        lane: "mage",
        volumeIdSha256: model.mage.volumeIdSha256,
        volumeManifestSha256: model.mage.volumeManifestSha256,
      },
      soulx: {
        lane: "soulx",
        volumeIdSha256: model.soulx.volumeIdSha256,
        volumeManifestSha256: model.soulx.volumeManifestSha256,
      },
    } as never as V213DualLaneInput;
    await expect(
      makeTransport(hashOnlyInput).cleanupAttributableResources([
        {
          stage: "production",
          stageAuthorityId: "stage_production",
          operations: [
            {
              kind: "create",
              resourceKey,
              state: "ACKED",
              providerId: created.deployment.endpointId,
              evidence: {
                ...created.deployment,
                volumeIdSha256: `sha256:${"e".repeat(64)}`,
              },
            },
          ],
        },
      ]),
    ).rejects.toThrow("V213_CLEANUP_PRODUCTION_BINDING_DRIFT");
    expect(control.deleteEndpoint).not.toHaveBeenCalled();
    expect(control.deleteTemplate).not.toHaveBeenCalled();
  });

  it("stops production cleanup on readback ambiguity without deleting resources", async () => {
    const { transport, control, model } = fixture();
    const resourceKey = "v213-stage_production-mage-production";
    await transport.createLane({
      sealed: model.mage,
      purpose: "production",
      resourceKey,
      workersMin: 0,
      workersMax: 1,
    });
    const firstRead = await control.inventoryDisposableResources();
    control.inventoryDisposableResources
      .mockImplementationOnce(async () => firstRead)
      .mockImplementationOnce(async () => {
        throw new Error("V213_PROVIDER_READBACK_AMBIGUOUS");
      });
    await expect(
      transport.cleanupAttributableResources([
        { stage: "production", stageAuthorityId: "stage_production", operations: [] },
      ]),
    ).rejects.toThrow("V213_PROVIDER_READBACK_AMBIGUOUS");
    expect(control.deleteEndpoint).not.toHaveBeenCalled();
    expect(control.deleteTemplate).not.toHaveBeenCalled();
  });

  it("stops before endpoint or template deletion when an owned queue is nonempty", async () => {
    const { transport, control, model, client } = fixture({ queueNonEmpty: true });
    await transport.createLane({
      sealed: model.mage,
      purpose: "qualification",
      resourceKey: "v213-stage_mage-mage-qualification",
      workersMin: 0,
      workersMax: 1,
    });
    await expect(
      transport.cleanupAttributableResources([
        { stage: "mage", stageAuthorityId: "stage_mage", operations: [] },
      ]),
    ).rejects.toThrow("V213_STARTUP_QUEUE_NOT_CONFIRMED");
    expect(client.confirmStartupQueueEmpty).toHaveBeenCalledOnce();
    expect(control.deleteEndpoint).not.toHaveBeenCalled();
    expect(control.deleteTemplate).not.toHaveBeenCalled();
  });

  it("proves all owned queues before deleting any endpoint or template", async () => {
    const { transport, control, model, client } = fixture({ queueNonEmptyOnCheck: 2 });
    for (const [stageAuthorityId, sealed] of [
      ["stage_mage", model.mage],
      ["stage_soulx", model.soulx],
    ] as const) {
      await transport.createLane({
        sealed,
        purpose: "qualification",
        resourceKey: `v213-${stageAuthorityId}-${sealed.lane}-qualification`,
        workersMin: 0,
        workersMax: 1,
      });
    }
    await expect(
      transport.cleanupAttributableResources([
        { stage: "mage", stageAuthorityId: "stage_mage", operations: [] },
        { stage: "soulx", stageAuthorityId: "stage_soulx", operations: [] },
      ]),
    ).rejects.toThrow("V213_STARTUP_QUEUE_NOT_CONFIRMED");
    expect(client.confirmStartupQueueEmpty).toHaveBeenCalledTimes(2);
    expect(control.deleteEndpoint).not.toHaveBeenCalled();
    expect(control.deleteTemplate).not.toHaveBeenCalled();
  });
});
