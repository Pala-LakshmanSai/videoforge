import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { ProvenanceReceiptSigner } from "@videoforge/control-plane";

import { createV213RunPodDualLaneTransport } from "./v213-runpod-dual-lane-transport.js";
import {
  V213_QUALIFICATION_CASE_DESCRIPTORS,
  type V213DualLaneInput,
} from "./v213-dual-lane-live.js";

const sha = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const idSha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function input(): V213DualLaneInput {
  const sealed = (lane: "mage" | "soulx", volumeId: string, marker: string) => ({
    lane,
    publicImage: `ghcr.io/example/${lane}@${sha(marker)}`,
    sourceCommit: marker.repeat(40),
    deploymentSha256: sha(marker),
    volumeIdSha256: idSha(volumeId),
    volumeManifestSha256: sha(marker === "a" ? "e" : "f"),
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
    qualificationEnvelopeSchemaSha256: sha("4"),
    envelopeSigningKeyId: "fixture-receipt-key",
    qualificationGeneratorSha256: sha("5"),
    qualificationCaseDescriptors: V213_QUALIFICATION_CASE_DESCRIPTORS,
    qualificationSourceRefs: {
      caseSource: { path: "case.ts", sha256: sha("1") as `sha256:${string}` },
      generators: {
        mage: { path: "mage.mjs", sha256: sha("2") as `sha256:${string}` },
        soulx: { path: "soulx.mjs", sha256: sha("3") as `sha256:${string}` },
      },
      validators: {
        mage: { path: "mage.py", sha256: sha("4") as `sha256:${string}` },
        soulx: { path: "soulx.py", sha256: sha("5") as `sha256:${string}` },
      },
    },
    qualificationProtectedInputDescriptors: Object.fromEntries(
      ["avatarSource", "soulx2s", "soulx4s", "soulx6s", "soulx10s"].map((key) => [
        key,
        {
          path: `.videoforge/private/${key}`,
          sha256: sha("6"),
          sizeBytes: 100,
          contentType: key === "avatarSource" ? "image/png" : "audio/wav",
        },
      ]),
    ) as V213DualLaneInput["qualificationProtectedInputDescriptors"],
    qualificationR2: { accountId: "a".repeat(32), bucketName: "fixture-private" },
  };
}

function fixture(
  options: {
    dispatchAmbiguous?: boolean;
    templateCreateAmbiguous?: boolean;
    templateCreateHardKill?: boolean;
    templateImageOverride?: string;
    templateLaneOverride?: string;
    templatePurposeOverride?: string;
    templateResourceKeyHashOverride?: string;
    boundReceiptKeyIdOverride?: string;
    endpointCreateAmbiguous?: boolean;
    withDelivery?: boolean;
    deletionRemains?: boolean;
    queueNonEmpty?: boolean;
    queueNonEmptyOnCheck?: number;
    startupHealthReadFailures?: number;
    startupHealthFailureCode?: string;
  } = {},
) {
  const model = input();
  const workerEnvironment = Object.freeze({
    envelopeSigningKeyId: model.envelopeSigningKeyId,
    envelopeSigningKeyHex: "11".repeat(32),
    receiptKeyId: model.receiptSigner.keyId,
    receiptSigningKeyHex: "22".repeat(32),
    mageWorkerTokenHex: "33".repeat(32),
  });
  const endpoints: { id: string; idHash: string; name: string }[] = [];
  const templates: { id: string; idHash: string; name: string }[] = [];
  const endpointRaw = new Map<string, Record<string, unknown>>();
  const templateRaw = new Map<string, Record<string, unknown>>();
  const jobs = new Map<string, { id: string; status: string; output?: unknown }>();
  const control = {
    createServerlessTemplate: vi.fn(
      async (
        name: string,
        imageName: string,
        _diskGb: number,
        environment: Readonly<Record<string, string>> = {},
      ) => {
        const id = `template_${templates.length + 1}`;
        const item = { id, idHash: idSha(id), name };
        templates.push(item);
        templateRaw.set(item.id, {
          imageName: options.templateImageOverride ?? imageName,
          isServerless: true,
          containerDiskInGb: 120,
          env: {
            ...environment,
            ...(options.templateLaneOverride === undefined
              ? {}
              : { VIDEOFORGE_V213_LANE: options.templateLaneOverride }),
            ...(options.templatePurposeOverride === undefined
              ? {}
              : { VIDEOFORGE_V213_PURPOSE: options.templatePurposeOverride }),
            ...(options.templateResourceKeyHashOverride === undefined
              ? {}
              : {
                  VIDEOFORGE_V213_RESOURCE_KEY_SHA256: options.templateResourceKeyHashOverride,
                }),
          },
        });
        if (options.templateCreateHardKill) throw new Error("SIMULATED_PROCESS_KILL");
        if (options.templateCreateAmbiguous) throw new Error("template create timed out");
        return item;
      },
    ),
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
    bindV207EndpointIdentity: vi.fn(
      async (
        endpointId: string,
        templateId: string,
        _policy: unknown,
        _placement: unknown,
        environment: Readonly<Record<string, string>>,
      ) => {
        const raw = templateRaw.get(templateId);
        if (!raw) throw new Error("fixture template missing");
        raw.env = {
          ...environment,
          [environment.VIDEOFORGE_V213_LANE === "soulx"
            ? "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256"
            : "VIDEOFORGE_MAGE_ENDPOINT_ID_HASH"]: idSha(endpointId),
          ...(options.boundReceiptKeyIdOverride === undefined
            ? {}
            : { VIDEOFORGE_RECEIPT_KEY_ID: options.boundReceiptKeyIdOverride }),
        };
      },
    ),
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
    resolveExactNetworkVolumeId: vi.fn(async ({ volumeIdSha256 }) => {
      if (volumeIdSha256 === model.mage.volumeIdSha256) return "volume_mage";
      if (volumeIdSha256 === model.soulx.volumeIdSha256) return "volume_soulx";
      throw new Error("RUNPOD_NETWORK_VOLUME_BINDING_UNCONFIRMED");
    }),
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
      if (queueChecks <= (options.startupHealthReadFailures ?? 0)) {
        const code = options.startupHealthFailureCode ?? "RUNPOD_READ_FAILED";
        const error = new Error(code) as Error & { code: string };
        error.code = code;
        throw error;
      }
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
    dispatchWithV208Policy: vi.fn(async (requestKey: string) => {
      if (options.dispatchAmbiguous) throw new Error("lost");
      const job = { id: `job_${requestKey}`, status: "COMPLETED", output: {} };
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
  const sleep = vi.fn(async (_milliseconds: number) => undefined);
  const createJobClient = vi.fn((endpointId: string) => {
    void endpointId;
    return client;
  });
  const makeTransport = (
    transportInput: V213DualLaneInput = model,
    exactWorkerEnvironment: typeof workerEnvironment | null = workerEnvironment,
    withOutputVerifier = true,
  ) =>
    createV213RunPodDualLaneTransport({
      durable: {} as never,
      input: transportInput,
      workerEnvironment: exactWorkerEnvironment,
      control,
      accountPreflight: async () => ({ accountIdHash: model.accountIdSha256 }),
      readAdmissionFacts: async () => ({
        checkedAt: "2026-08-26T00:30:00.000Z",
        availability: "LOW",
        flexRateUsdPerGpuHour: 1.116,
        cumulativeBillingUsd: 1,
      }),
      createJobClient,
      ...(withOutputVerifier ? { verifyOutputReadback } : {}),
      materializeQualificationCase: async () => {
        throw new Error("UNUSED_QUALIFICATION_MATERIALIZER");
      },
      sleep,
      now: () => new Date("2026-08-26T00:30:00.000Z"),
    });
  const transport = makeTransport();
  return {
    transport,
    makeTransport,
    control,
    client,
    model,
    endpointRaw,
    verifyOutputReadback,
    sleep,
    createJobClient,
    workerEnvironment,
  };
}

describe("V213 concrete RunPod dual-lane transport", () => {
  it("resolves the exact retained volume before any template or endpoint mutation", async () => {
    const { transport, control, model } = fixture();
    control.resolveExactNetworkVolumeId.mockRejectedValueOnce(
      new Error("RUNPOD_NETWORK_VOLUME_BINDING_UNCONFIRMED"),
    );
    await expect(
      transport.createLane({
        sealed: model.mage,
        purpose: "qualification",
        resourceKey: "stage:mage:qualification",
        workersMin: 0,
        workersMax: 1,
      }),
    ).rejects.toThrow("RUNPOD_NETWORK_VOLUME_BINDING_UNCONFIRMED");
    expect(control.createServerlessTemplate).not.toHaveBeenCalled();
    expect(control.createScaleZeroEndpoint).not.toHaveBeenCalled();
    expect(control.bindV207EndpointIdentity).not.toHaveBeenCalled();
  });

  it("rejects missing or identity-drifted worker auth before any provider call", async () => {
    const { makeTransport, control, model, workerEnvironment } = fixture();
    for (const transport of [
      makeTransport(model, null),
      makeTransport(model, {
        ...workerEnvironment,
        envelopeSigningKeyId: "different-envelope-key",
      }),
    ]) {
      await expect(
        transport.createLane({
          sealed: model.mage,
          purpose: "qualification",
          resourceKey: "stage:mage:invalid-worker-auth",
          workersMin: 0,
          workersMax: 1,
        }),
      ).rejects.toThrow("V213_WORKER_ENVIRONMENT_AUTHORITY_MISMATCH");
    }
    expect(control.resolveExactNetworkVolumeId).not.toHaveBeenCalled();
    expect(control.createServerlessTemplate).not.toHaveBeenCalled();
    expect(control.createScaleZeroEndpoint).not.toHaveBeenCalled();
  });

  it("injects and reads back exact lane worker auth, image, model, and volume bindings", async () => {
    const { transport, control, model, workerEnvironment } = fixture();
    for (const sealed of [model.mage, model.soulx] as const) {
      const created = await transport.createLane({
        sealed,
        purpose: "qualification",
        resourceKey: `stage:${sealed.lane}:exact-worker-env`,
        workersMin: 0,
        workersMax: 1,
      });
      if (created.kind !== "ACK") throw new Error("fixture");
      await expect(transport.readLane(created.deployment)).resolves.toEqual(created.deployment);
    }
    const mageEnvironment = control.createServerlessTemplate.mock.calls[0]?.[3];
    const soulxEnvironment = control.createServerlessTemplate.mock.calls[1]?.[3];
    expect(mageEnvironment).toMatchObject({
      VIDEOFORGE_ENVELOPE_KEY_ID: workerEnvironment.envelopeSigningKeyId,
      VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: workerEnvironment.envelopeSigningKeyHex,
      VIDEOFORGE_RECEIPT_KEY_ID: workerEnvironment.receiptKeyId,
      VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX: workerEnvironment.receiptSigningKeyHex,
      VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: model.mage.publicImage,
      VIDEOFORGE_MAGE_MANIFEST_SHA256: model.mage.volumeManifestSha256,
      VIDEOFORGE_MAGE_VOLUME_ID_HASH: model.mage.volumeIdSha256,
    });
    expect(soulxEnvironment).toMatchObject({
      VIDEOFORGE_ENVELOPE_KEY_ID: workerEnvironment.envelopeSigningKeyId,
      VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: workerEnvironment.envelopeSigningKeyHex,
      VIDEOFORGE_RECEIPT_KEY_ID: workerEnvironment.receiptKeyId,
      VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX: workerEnvironment.receiptSigningKeyHex,
      VIDEOFORGE_SOULX_CONTAINER_DIGEST: model.soulx.publicImage.split("@")[1],
      VIDEOFORGE_SOULX_MODEL_MANIFEST_SHA256: model.soulx.volumeManifestSha256,
      VIDEOFORGE_SOULX_VOLUME_ID_SHA256: model.soulx.volumeIdSha256,
    });
  });

  it("rejects a worker environment mutation on readback before dispatch", async () => {
    const { transport, control, client, model } = fixture({
      boundReceiptKeyIdOverride: "mutated-receipt-key",
    });
    const created = await transport.createLane({
      sealed: model.soulx,
      purpose: "qualification",
      resourceKey: "stage:soulx:mutated-worker-env",
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    await expect(transport.readLane(created.deployment)).rejects.toThrow(
      "V213_DEPLOYMENT_READBACK_MISSING",
    );
    expect(control.bindV207EndpointIdentity).toHaveBeenCalledOnce();
    expect(client.dispatch).not.toHaveBeenCalled();
  });

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

  it("preserves an explicit 60-second idle timeout through create and readback", async () => {
    const { transport, control, model } = fixture();
    const created = await transport.createLane({
      sealed: model.soulx,
      purpose: "qualification",
      resourceKey: "stage:soulx:v208-idle-window",
      workersMin: 0,
      workersMax: 1,
      idleTimeoutSeconds: 60,
    });
    expect(created).toMatchObject({ kind: "ACK", deployment: { idleTimeoutSeconds: 60 } });
    if (created.kind !== "ACK") throw new Error("fixture");
    expect(control.createScaleZeroEndpoint).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ idleTimeout: 60 }),
      expect.anything(),
      false,
    );
    await expect(transport.readLane(created.deployment)).resolves.toEqual(created.deployment);
  });

  it("rejects an endpoint idle-timeout drift during readback", async () => {
    const { transport, model, endpointRaw } = fixture();
    const created = await transport.createLane({
      sealed: model.mage,
      purpose: "qualification",
      resourceKey: "stage:mage:idle-drift",
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    endpointRaw.get(created.deployment.endpointId)!.idleTimeout = 60;
    await expect(transport.readLane(created.deployment)).rejects.toThrow(
      "V213_DEPLOYMENT_READBACK_MISSING",
    );
  });

  it("recovers an exact template after a create timeout before creating its endpoint", async () => {
    const { transport, control, model } = fixture({ templateCreateAmbiguous: true });
    const resourceKey = "v213-stage_mage-mage-qualification";
    const created = await transport.createLane({
      sealed: model.mage,
      purpose: "qualification",
      resourceKey,
      workersMin: 0,
      workersMax: 1,
    });
    expect(created).toMatchObject({ kind: "ACK", deployment: { templateId: "template_1" } });
    expect(control.createServerlessTemplate).toHaveBeenCalledOnce();
    expect(control.createScaleZeroEndpoint).toHaveBeenCalledOnce();
    expect(control.createScaleZeroEndpoint).toHaveBeenCalledWith(
      expect.any(String),
      "template_1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
    );
  });

  it("stops on an ambiguous conflicting template without endpoint mutation or cleanup", async () => {
    const { transport, control, model } = fixture({
      templateCreateAmbiguous: true,
      templateImageOverride: "ghcr.io/example/other@sha256:" + "c".repeat(64),
    });
    const resourceKey = "v213-stage_mage-mage-qualification";
    await expect(
      transport.createLane({
        sealed: model.mage,
        purpose: "qualification",
        resourceKey,
        workersMin: 0,
        workersMax: 1,
      }),
    ).rejects.toThrow("V213_TEMPLATE_CREATE_RECONCILIATION_IDENTITY_MISMATCH");
    expect(control.createScaleZeroEndpoint).not.toHaveBeenCalled();
    expect(control.bindV207EndpointIdentity).not.toHaveBeenCalled();
    expect(control.deleteEndpoint).not.toHaveBeenCalled();
    expect(control.deleteTemplate).not.toHaveBeenCalled();
    await expect(control.inventoryDisposableResources()).resolves.toMatchObject({
      endpoints: [],
      templates: [{ id: "template_1" }],
    });
  });

  it("requires the journal resource-key marker during ambiguous template recovery", async () => {
    const { transport, control, model } = fixture({
      templateCreateAmbiguous: true,
      templateResourceKeyHashOverride: idSha("different-resource-key"),
    });
    await expect(
      transport.createLane({
        sealed: model.mage,
        purpose: "qualification",
        resourceKey: "v213-stage_mage-mage-qualification",
        workersMin: 0,
        workersMax: 1,
      }),
    ).rejects.toThrow("V213_TEMPLATE_CREATE_RECONCILIATION_IDENTITY_MISMATCH");
    expect(control.createScaleZeroEndpoint).not.toHaveBeenCalled();
    expect(control.deleteEndpoint).not.toHaveBeenCalled();
    expect(control.deleteTemplate).not.toHaveBeenCalled();
  });

  it("stops on an ambiguous unknown template without endpoint mutation or cleanup", async () => {
    const { transport, control, model } = fixture({ templateCreateAmbiguous: true });
    control.inventoryDisposableResources.mockResolvedValueOnce({ endpoints: [], templates: [] });
    await expect(
      transport.createLane({
        sealed: model.soulx,
        purpose: "qualification",
        resourceKey: "v213-stage_soulx-soulx-qualification",
        workersMin: 0,
        workersMax: 1,
      }),
    ).rejects.toThrow("V213_TEMPLATE_CREATE_RECONCILIATION_UNCERTAIN");
    expect(control.createScaleZeroEndpoint).not.toHaveBeenCalled();
    expect(control.bindV207EndpointIdentity).not.toHaveBeenCalled();
    expect(control.deleteEndpoint).not.toHaveBeenCalled();
    expect(control.deleteTemplate).not.toHaveBeenCalled();
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
    await expect(transport.findJobByRequestKey()).resolves.toBeNull();
    expect(client.dispatch).toHaveBeenCalledOnce();
  });

  it("retries only transient startup health reads before the first POST", async () => {
    const { transport, client, sleep, model } = fixture({ startupHealthReadFailures: 2 });
    const created = await transport.createLane({
      sealed: model.soulx,
      purpose: "qualification",
      resourceKey: "stage:soulx:startup-health-retry",
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    await expect(
      transport.dispatch({
        deployment: created.deployment,
        requestKey: "v213-soulx-startup-health-retry",
        envelope: {},
        policy: { executionTimeoutMs: 60_000, ttlMs: 7_200_000 },
      }),
    ).resolves.toMatchObject({ kind: "ACK", jobId: "job_v213-soulx-startup-health-retry" });
    expect(client.confirmStartupQueueEmpty).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([2_000, 2_000]);
    expect(client.dispatchWithV208Policy).toHaveBeenCalledOnce();
    expect(client.dispatch).not.toHaveBeenCalled();
  });

  it("bounds V2-08 startup health propagation retries before posting", async () => {
    const { transport, client, sleep, model } = fixture({ startupHealthReadFailures: 99 });
    const created = await transport.createLane({
      sealed: model.soulx,
      purpose: "qualification",
      resourceKey: "stage:soulx:bounded-startup-health",
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    await expect(
      transport.dispatch({
        deployment: created.deployment,
        requestKey: "v213-soulx-bounded-startup-health",
        envelope: {},
        policy: { executionTimeoutMs: 60_000, ttlMs: 7_200_000 },
      }),
    ).rejects.toThrow("RUNPOD_READ_FAILED");
    expect(client.confirmStartupQueueEmpty).toHaveBeenCalledTimes(12);
    expect(sleep).toHaveBeenCalledTimes(11);
    expect(sleep.mock.calls.every(([milliseconds]) => milliseconds === 2_000)).toBe(true);
    expect(client.dispatchWithV208Policy).not.toHaveBeenCalled();
  });

  it("does not extend ordinary dispatch startup health retries", async () => {
    const { transport, client, sleep, model } = fixture({ startupHealthReadFailures: 1 });
    const created = await transport.createLane({
      sealed: model.soulx,
      purpose: "production",
      resourceKey: "stage:soulx:ordinary-startup-health",
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    await expect(
      transport.dispatch({
        deployment: created.deployment,
        requestKey: "v213-soulx-ordinary-startup-health",
        envelope: {},
      }),
    ).rejects.toThrow("RUNPOD_READ_FAILED");
    expect(client.confirmStartupQueueEmpty).toHaveBeenCalledOnce();
    expect(client.dispatch).not.toHaveBeenCalled();
    expect(client.dispatchWithV208Policy).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("fails immediately on non-transient startup health states without posting", async () => {
    for (const code of [
      "RUNPOD_STARTUP_QUEUE_NOT_CONFIRMED",
      "RUNPOD_READ_AMBIGUOUS",
      "RUNPOD_RESPONSE_INVALID",
    ] as const) {
      const { transport, client, sleep, model } = fixture({
        startupHealthReadFailures: 1,
        startupHealthFailureCode: code,
      });
      const created = await transport.createLane({
        sealed: model.soulx,
        purpose: "qualification",
        resourceKey: `stage:soulx:startup-health-${code.toLowerCase()}`,
        workersMin: 0,
        workersMax: 1,
      });
      if (created.kind !== "ACK") throw new Error("fixture");
      await expect(
        transport.dispatch({
          deployment: created.deployment,
          requestKey: `v213-soulx-startup-health-${code.toLowerCase()}`,
          envelope: {},
        }),
      ).rejects.toThrow(code);
      expect(client.confirmStartupQueueEmpty).toHaveBeenCalledOnce();
      expect(client.dispatch).not.toHaveBeenCalled();
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it("forwards only the exact V2-08 per-request policy to the bounded client method", async () => {
    const { transport, client, model } = fixture();
    const created = await transport.createLane({
      sealed: model.soulx,
      purpose: "qualification",
      resourceKey: "stage:soulx:v208-policy",
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    await transport.dispatch({
      deployment: created.deployment,
      requestKey: "v208-soulx-timeout",
      envelope: { qualification_probe: "RUNPOD_EXECUTION_TIMEOUT_V1" },
      policy: { executionTimeoutMs: 5_000, ttlMs: 7_200_000 },
    });
    expect(client.dispatchWithV208Policy).toHaveBeenCalledWith(
      "v208-soulx-timeout",
      { qualification_probe: "RUNPOD_EXECUTION_TIMEOUT_V1" },
      { executionTimeout: 5_000, ttl: 7_200_000 },
    );
    expect(client.dispatch).not.toHaveBeenCalled();
  });

  it("maps an exact application-level SoulX probe rejection to terminal FAILED", async () => {
    const { transport, client } = fixture();
    client.status.mockResolvedValueOnce({
      id: "job_probe",
      idHash: sha("3"),
      status: "COMPLETED",
      output: {
        status: "FAILED",
        failure_code: "SOULX_OUTPUT_CONTRACT_INVALID",
        error: { code: "SOULX_OUTPUT_CONTRACT_INVALID" },
      },
      executionTimeMs: 1,
      delayTimeMs: 1,
    });
    await expect(transport.status("endpoint-soulx", "job_probe")).resolves.toMatchObject({
      jobId: "job_probe",
      status: "FAILED",
      failureCode: "SOULX_OUTPUT_CONTRACT_INVALID",
    });
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

  it("preserves receipt delivery without falsely claiming output readback", async () => {
    const { makeTransport, model, verifyOutputReadback } = fixture({ withDelivery: true });
    const transport = makeTransport(model, undefined, false);
    const created = await transport.createLane({
      sealed: model.soulx,
      purpose: "qualification",
      resourceKey: "stage:soulx:receipt-only",
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    const ack = await transport.dispatch({
      deployment: created.deployment,
      requestKey: "v208-soulx-receipt-only",
      envelope: {},
    });
    if (ack.kind !== "ACK") throw new Error("fixture");
    const observed = await transport.status(created.deployment.endpointId, ack.jobId);
    expect(observed).toMatchObject({
      receiptDelivery: { receiptBodyBase64: "ZXhhY3QtcmVjZWlwdA==" },
    });
    expect(observed.outputReadbackVerified).toBeUndefined();
    expect(verifyOutputReadback).not.toHaveBeenCalled();
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
    const resourceKey = "v213-stage_mage-mage-qualification";
    const created = await transport.createLane({
      sealed: model.mage,
      purpose: "qualification",
      resourceKey,
      workersMin: 0,
      workersMax: 1,
    });
    expect(created).toMatchObject({
      kind: "ACK_UNKNOWN",
      partial: { templateId: "template_1", resourceKey },
    });
    if (created.kind !== "ACK_UNKNOWN" || !created.partial) throw new Error("fixture");
    await expect(
      transport.cleanupAttributableResources([
        {
          stage: "mage",
          stageAuthorityId: "stage_mage",
          operations: [
            {
              kind: "create",
              resourceKey,
              state: "ACK_UNKNOWN",
              providerId: created.partial.templateId,
              evidence: created.partial,
            },
          ],
        },
      ]),
    ).resolves.toMatchObject({ production: [], deletedTemplateIdSha256s: [expect.any(String)] });
    expect(control.deleteTemplate).toHaveBeenCalledOnce();
  });

  it("discovers and cleans a raw-kill template with an IN_FLIGHT create and no evidence", async () => {
    const { transport, control, client, model } = fixture({ templateCreateHardKill: true });
    const resourceKey = "v213-stage_raw-mage-qualification";
    await expect(
      transport.createLane({
        sealed: model.mage,
        purpose: "qualification",
        resourceKey,
        workersMin: 0,
        workersMax: 1,
      }),
    ).rejects.toThrow("SIMULATED_PROCESS_KILL");
    expect(control.createServerlessTemplate).toHaveBeenCalledOnce();
    expect(control.createScaleZeroEndpoint).not.toHaveBeenCalled();

    await expect(
      transport.cleanupAttributableResources([
        {
          stage: "mage",
          stageAuthorityId: "stage_raw",
          operations: [
            {
              kind: "create",
              resourceKey,
              state: "IN_FLIGHT",
              providerId: null,
              evidence: null,
            },
          ],
        },
      ]),
    ).resolves.toMatchObject({ production: [], deletedTemplateIdSha256s: [expect.any(String)] });
    expect(control.deleteTemplate).toHaveBeenCalledOnce();
    expect(control.createServerlessTemplate).toHaveBeenCalledOnce();
    expect(control.createScaleZeroEndpoint).not.toHaveBeenCalled();
    expect(client.dispatch).not.toHaveBeenCalled();
    expect(client.dispatchWithV208Policy).not.toHaveBeenCalled();
  });

  it("rejects a template-only deterministic candidate when its journaled hash mismatches", async () => {
    const { transport, control, model } = fixture({ endpointCreateAmbiguous: true });
    const resourceKey = "v213-stage_mage-mage-qualification";
    const created = await transport.createLane({
      sealed: model.mage,
      purpose: "qualification",
      resourceKey,
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK_UNKNOWN" || !created.partial) throw new Error("fixture");
    await expect(
      transport.cleanupAttributableResources([
        {
          stage: "mage",
          stageAuthorityId: "stage_mage",
          operations: [
            {
              kind: "create",
              resourceKey,
              state: "ACK_UNKNOWN",
              providerId: null,
              evidence: { templateIdSha256: sha("d") },
            },
          ],
        },
      ]),
    ).rejects.toThrow("V213_CLEANUP_PARTIAL_IDENTITY_DRIFT");
    expect(control.deleteEndpoint).not.toHaveBeenCalled();
    expect(control.deleteTemplate).not.toHaveBeenCalled();
  });

  it("rejects an endpoint-only deterministic candidate when its journaled hash mismatches", async () => {
    const { transport, control, model } = fixture();
    const resourceKey = "v213-stage_mage-mage-qualification";
    const created = await transport.createLane({
      sealed: model.mage,
      purpose: "qualification",
      resourceKey,
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    await control.deleteTemplate(created.deployment.templateId);
    control.deleteTemplate.mockClear();
    await expect(
      transport.cleanupAttributableResources([
        {
          stage: "mage",
          stageAuthorityId: "stage_mage",
          operations: [
            {
              kind: "create",
              resourceKey,
              state: "ACKED",
              providerId: null,
              evidence: { endpointIdSha256: sha("d") },
            },
          ],
        },
      ]),
    ).rejects.toThrow("V213_CLEANUP_PARTIAL_IDENTITY_DRIFT");
    expect(control.deleteEndpoint).not.toHaveBeenCalled();
    expect(control.deleteTemplate).not.toHaveBeenCalled();
  });

  it("proves every attributable production resource absent after a partial pair", async () => {
    const { transport, control, model } = fixture();
    const mageKey = "v213-stage_production-mage-production";
    const created = await transport.createLane({
      sealed: model.mage,
      purpose: "production",
      resourceKey: mageKey,
      workersMin: 0,
      workersMax: 1,
    });
    if (created.kind !== "ACK") throw new Error("fixture");
    await control.deleteTemplate(created.deployment.templateId);
    control.deleteTemplate.mockClear();

    await expect(
      transport.cleanupAttributableResources([
        {
          stage: "production",
          stageAuthorityId: "stage_production",
          operations: [
            {
              kind: "create",
              resourceKey: mageKey,
              state: "ACKED",
              providerId: created.deployment.endpointId,
              evidence: created.deployment,
            },
          ],
        },
      ]),
    ).resolves.toMatchObject({
      production: [],
      productionCleanupState: "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
      productionResourcesAbsent: true,
      deletedEndpointIdSha256s: [expect.any(String)],
      deletedTemplateIdSha256s: [],
    });
    const remaining = await control.inventoryDisposableResources();
    expect(remaining.endpoints).toEqual([]);
    expect(remaining.templates).toEqual([]);
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
      productionCleanupState: "EXACT_MAX_ONE_PAIR_RETAINED",
      productionResourcesAbsent: false,
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

  it("reconciles ACK_UNKNOWN cleanup by exact provider readback with zero mutations", async () => {
    const { transport, control, client, model } = fixture();
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
    const terminalJob = await client.dispatch("cleanup-readback-terminal-job");
    control.createServerlessTemplate.mockClear();
    control.createScaleZeroEndpoint.mockClear();
    control.bindV207EndpointIdentity.mockClear();
    control.deleteEndpoint.mockClear();
    control.deleteTemplate.mockClear();
    client.cancel.mockClear();
    client.dispatch.mockClear();
    const result = await transport.reconcileAttributableCleanupReadback([
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
          {
            kind: "dispatch",
            resourceKey: `${soulxKey}:terminal-job`,
            state: "ACKED",
            providerId: terminalJob.id,
            evidence: null,
          },
          {
            kind: "status",
            resourceKey: `${soulx.deployment.endpointIdSha256}:${terminalJob.id}:0`,
            state: "TERMINAL",
            providerId: terminalJob.id,
            evidence: { jobId: terminalJob.id, status: "COMPLETED" },
          },
        ],
      },
    ]);
    expect(result).toMatchObject({
      productionCleanupState: "EXACT_MAX_ONE_PAIR_RETAINED",
      productionResourcesAbsent: false,
      production: [mage.deployment, soulx.deployment],
      reconciliationReadback: {
        providerMutationPerformed: false,
        runningPods: 0,
        activeWorkers: 0,
        queuedJobs: 0,
        observedJobs: [
          {
            jobIdSha256: idSha(terminalJob.id),
            endpointIdSha256: soulx.deployment.endpointIdSha256,
            status: "COMPLETED",
          },
        ],
        endpointIdSha256s: [
          mage.deployment.endpointIdSha256,
          soulx.deployment.endpointIdSha256,
        ].sort(),
        templateIdSha256s: [
          mage.deployment.templateIdSha256,
          soulx.deployment.templateIdSha256,
        ].sort(),
        volumeIdSha256s: [model.mage.volumeIdSha256, model.soulx.volumeIdSha256].sort(),
      },
    });
    expect(control.createServerlessTemplate).not.toHaveBeenCalled();
    expect(control.createScaleZeroEndpoint).not.toHaveBeenCalled();
    expect(control.bindV207EndpointIdentity).not.toHaveBeenCalled();
    expect(control.deleteEndpoint).not.toHaveBeenCalled();
    expect(control.deleteTemplate).not.toHaveBeenCalled();
    expect(client.dispatch).not.toHaveBeenCalled();
    expect(client.cancel).not.toHaveBeenCalled();
    await expect(
      transport.reconcileAttributableCleanupReadback([
        {
          stage: "mage",
          stageAuthorityId: "stage_mage",
          operations: [
            {
              kind: "dispatch",
              resourceKey: "v213-unknown-job",
              state: "ACK_UNKNOWN",
              providerId: null,
              evidence: null,
            },
          ],
        },
      ]),
    ).rejects.toThrow("V213_CLEANUP_READBACK_JOB_ID_UNAVAILABLE");
    expect(control.deleteEndpoint).not.toHaveBeenCalled();
    expect(control.deleteTemplate).not.toHaveBeenCalled();
    expect(client.cancel).not.toHaveBeenCalled();
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
