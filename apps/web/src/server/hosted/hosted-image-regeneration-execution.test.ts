// @vitest-environment node

import { createHash } from "node:crypto";

import { canonicalizeJson, type JsonValue, sha256CanonicalJson } from "@videoforge/contracts";
import {
  PROVENANCE_ATTESTATION_SCOPE,
  ProvenanceReceiptSigner,
  canonicalSha256,
  digestUtf8,
  type ProvenanceReceiptBody,
  type Sha256,
  type TransactionalSqlExecutor,
} from "@videoforge/control-plane";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedRuntimeEnvironment } from "./configuration";
import { observeHostedImageRegeneration } from "./hosted-image-regeneration-execution";

const mocks = vi.hoisted(() => {
  const state: {
    row: Record<string, unknown> | null;
    claim: Record<string, unknown> | null;
    lineage: Record<string, unknown> | null;
    terminalStore: Record<string, unknown> | null;
    replacements: unknown[];
    releases: unknown[];
    releaseResult: boolean;
    failedQueued: string[];
  } = {
    row: null,
    claim: null,
    lineage: null,
    terminalStore: null,
    replacements: [],
    releases: [],
    releaseResult: true,
    failedQueued: [],
  };

  class FakeImageRegenerationStore {
    async loadApi() { return null; }
    async databaseNow() {
      return new Date().toISOString();
    }
    async admitCost() {}
    async cancelUnsent() {
      if (state.claim?.state === "PREPARED") {
        state.claim = { ...state.claim, state: "CANCELLED" };
        if (state.row) state.row = { ...state.row, state: "CANCELLED" };
      }
    }
    async load(input: string | Record<string, unknown>) {
      return typeof input === "string" ? state.row : state.lineage;
    }

    async failQueued(requestId: string) {
      state.failedQueued.push(requestId);
      if (state.row) state.row = { ...state.row, state: "FAILED" };
    }

    async prepare() {
      if (!state.claim) throw new Error("test claim missing");
      return state.claim;
    }

    async beginSend() {
      if (!state.claim) throw new Error("test claim missing");
      return { claim: state.claim, acquired: false };
    }

    async finishSend(input: { state: string; providerJobId: string | null }) {
      if (!state.claim) throw new Error("test claim missing");
      state.claim = { ...state.claim, state: input.state, providerJobId: input.providerJobId };
      return state.claim;
    }

    async finishTerminal(input: { state: string }) {
      if (!state.claim) throw new Error("test claim missing");
      state.claim = { ...state.claim, state: input.state };
      if (state.row) state.row = { ...state.row, state: input.state };
      return state.claim;
    }

    async replaceAcceptedScene(input: { accepted: unknown }) {
      if (!state.claim) throw new Error("test claim missing");
      state.replacements.push(input.accepted);
      state.claim = { ...state.claim, state: "COMPLETED" };
      if (state.row) state.row = { ...state.row, state: "COMPLETED", accepted: input.accepted };
      return state.claim;
    }

    async release(_requestId: string, proof: unknown) {
      state.releases.push(proof);
      return state.releaseResult;
    }

    terminalStore() {
      return state.terminalStore;
    }
  }

  return {
    state,
    FakeImageRegenerationStore,
    createHostedRunPodPair: vi.fn(),
  };
});

vi.mock("./hosted-image-regeneration-store", () => ({
  HostedSqlImageRegenerationStore: mocks.FakeImageRegenerationStore,
}));
vi.mock("./hosted-pair-live-wiring", () => ({
  createHostedRunPodPair: mocks.createHostedRunPodPair,
}));
vi.mock("./hosted-pair-production-composition", () => ({
  hostedPairProductionBindingState: () => ({ state: "QUALIFIED_EXACT" }),
}));
vi.mock("./hosted-image-regeneration-cost", () => ({
  readImageRegenerationCost: vi.fn(async () => ({ maximum_cost_micro_usd: 2_000_000 })),
}));

const ids = Object.freeze({
  account: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspace: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  project: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  revision: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  attempt: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  task: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  reservation: "11111111-1111-4111-8111-111111111111",
});
const dispatchToken = "dispatch-token-0123456789abcdef0123456789abcdef";
const receiptKey = Buffer.alloc(32, 17);
const receiptKeyId = "hosted-regeneration-receipt-v1";
const endpointHash = canonicalSha256({ endpoint: "mage" });
const artifactBytes = Buffer.from("regenerated-png", "utf8");
const artifactSha = `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}` as Sha256;
const prefix =
  `tenant/${ids.account}/workspace/${ids.workspace}/project/${ids.project}` +
  `/revision/${ids.revision}/lane/mage-image/job/${ids.attempt}`;
const objectKey = `${prefix}/artifact/${ids.task}`;
const issuedAt = "2099-09-14T01:00:00.000Z";
const observedAt = "2099-09-14T01:01:00.000Z";

async function outputFixture() {
  const envelope = {
    schema: "serverless-worker-job-envelope/v3",
    dispatch_token: dispatchToken,
    tenant: { account_id: ids.account, workspace_id: ids.workspace },
  };
  const requestBody = {
    envelope,
    batch: { attempt_id: ids.attempt, items: [{ scene_id: ids.task }] },
    generated_output_authorities: [
      {
        reservation_id: ids.reservation,
        path: `/${objectKey}`,
        content_type: "image/png",
        max_uses: 1,
      },
    ],
  };
  const requestWithoutEnvelope = Object.fromEntries(
    Object.entries(requestBody).filter(([key]) => key !== "envelope"),
  );
  const envelopeSha256 = await sha256CanonicalJson(envelope);
  const requestSha256 = canonicalSha256(requestWithoutEnvelope);
  const binding = {
    accountId: ids.account,
    workspaceId: ids.workspace,
    projectId: ids.project,
    projectRevisionId: ids.revision,
    lane: "mage_image",
    attemptId: ids.attempt,
    providerJobId: "provider-job-1",
    dispatchTokenSha256: digestUtf8(dispatchToken),
    envelopeSha256,
    requestSha256,
    deploymentId: "deployment-mage-1",
    endpointIdSha256: endpointHash,
    endpointConfigSha256: canonicalSha256({ endpointConfig: "mage" }),
    workerImageDigest: canonicalSha256({ image: "mage" }),
    modelManifestSha256: canonicalSha256({ model: "mage" }),
    volumeIdSha256: canonicalSha256({ volume: "mage" }),
    volumeManifestSha256: canonicalSha256({ manifest: "mage" }),
  };
  const probe = { width: 1280, height: 720, format: "png" };
  const receiptBody: ProvenanceReceiptBody = {
    schema_version: "serverless-provenance-receipt/v1",
    receipt_id: `mage-${ids.attempt}`,
    attestation_scope: PROVENANCE_ATTESTATION_SCOPE,
    dispatch_token: dispatchToken,
    envelope_sha256: envelopeSha256,
    request_sha256: requestSha256,
    attempt_id: ids.attempt,
    provider_job_id: "provider-job-1",
    worker_id: "worker-1",
    tenant: { account_id: ids.account, workspace_id: ids.workspace },
    lane: "mage_image",
    deployment: {
      deployment_id: binding.deploymentId,
      endpoint_id_sha256: binding.endpointIdSha256,
      container_digest: binding.workerImageDigest,
      intended_region: "EU-RO-1",
      intended_volume_id_sha256: binding.volumeIdSha256,
      model_manifest_sha256: binding.modelManifestSha256,
    },
    runtime_probe: {
      gpu_name: "NVIDIA GeForce RTX 4090",
      gpu_count: 1,
      total_vram_bytes: 24 * 1024 ** 3,
      peak_vram_bytes: 12 * 1024 ** 3,
      gpu_uuid_sha256: null,
      driver_version: "550.90.07",
      cuda_version: "12.4",
      probe_source: "WORKER_RUNTIME_SELF_REPORT",
    },
    volume_verification: {
      manifest_sha256_before: binding.volumeManifestSha256,
      manifest_sha256_after: binding.volumeManifestSha256,
      mutation_detected: false,
      cross_mount_detected: false,
    },
    model_ready_evidence: {
      state: "MODEL_READY",
      warmup_completed: true,
      warmup_output_sha256: canonicalSha256({ warmup: "mage" }),
    },
    timings: {
      allocation_ms: 1,
      container_ready_ms: 2,
      volume_verified_ms: 3,
      model_load_ms: 4,
      warmup_ms: 5,
      first_inference_ms: 6,
      upload_ms: 7,
      total_ms: 28,
    },
    items: [
      {
        item_id: ids.task,
        state: "SUCCEEDED",
        output_object_key: objectKey,
        output_sha256: artifactSha,
        output_bytes: artifactBytes.byteLength,
        probe,
      },
    ],
    scratch_cleanup: { terminal_reason: "SUCCESS", removed: true, scratch_on_model_volume: false },
    receipt_nonce: 1,
    issued_at: issuedAt,
  };
  const receiptBytes = Buffer.from(canonicalizeJson(receiptBody as unknown as JsonValue), "utf8");
  const receipt = new ProvenanceReceiptSigner(receiptKeyId, receiptKey).signOverBytes(
    receiptBody,
    receiptBytes,
  );
  const output = {
    status: "SUCCEEDED",
    items: [
      {
        item_id: ids.task,
        output_port_reservation_id: ids.reservation,
        output_object_key: objectKey,
        output_sha256: artifactSha,
        output_bytes: artifactBytes.byteLength,
        probe,
      },
    ],
    provenance_receipt: receipt,
    provenance_receipt_body_base64: receiptBytes.toString("base64"),
  };
  return { binding, envelope, requestBody, output, receipt };
}

function bucket() {
  return {
    head: vi.fn(async () => ({
      size: artifactBytes.byteLength,
      httpMetadata: { contentType: "image/png" },
      checksums: {},
    })),
    get: vi.fn(async () => ({
      size: artifactBytes.byteLength,
      httpMetadata: { contentType: "image/png" },
      async arrayBuffer() {
        return artifactBytes.buffer.slice(
          artifactBytes.byteOffset,
          artifactBytes.byteOffset + artifactBytes.byteLength,
        );
      },
    })),
  };
}

async function prepareHarness(state: "PREPARED" | "QUEUED" | "DISPATCH_ACK_UNKNOWN" | "ASSIGNED") {
  const value = await outputFixture();
  const requestBodyHash = canonicalSha256(value.requestBody);
  const claim = {
    state,
    requestId: "regeneration-request-1",
    sceneId: ids.task,
    dispatchToken,
    endpointIdSha256: endpointHash,
    requestBodySha256: requestBodyHash,
    envelopeSha256: value.binding.envelopeSha256,
    providerJobId: state === "ASSIGNED" ? "provider-job-1" : null,
  };
  const row = {
    account_id: ids.account,
    workspace_id: ids.workspace,
    attempt_id: ids.attempt,
    image_task_id: ids.task,
    edited_prompt: "edited prompt",
    envelope: value.envelope,
    request_body: value.requestBody,
    endpoint_id_sha256: endpointHash,
    dispatch_token: dispatchToken,
    created_at: "2099-09-14T01:00:00.000Z",
    deadline_at: "2099-09-14T02:00:00.000Z",
    state,
  };
  const terminalStore = {
    atomicBarrier: true as const,
    load: vi.fn(
      async () =>
        value.binding && {
          binding: value.binding,
          deadlineAt: "2099-09-14T02:00:00.000Z",
          requestBody: value.requestBody,
          candidateWork: [
            { taskId: ids.task, outputReservationId: ids.reservation, outputPrefix: prefix },
          ],
        },
    ),
    commitArtifacts: vi.fn(
      async ({ artifacts }: { artifacts: readonly Record<string, unknown>[] }) => ({
        state: "LANE_COMPLETED" as const,
        receiptSha256s: [canonicalSha256({ committed: artifacts[0] })],
      }),
    ),
  };
  mocks.state.row = row;
  mocks.state.claim = claim;
  mocks.state.lineage = null;
  mocks.state.terminalStore = terminalStore;
  mocks.state.replacements = [];
  mocks.state.releases = [];
  const transport = {
    run: vi.fn(async () => ({ id: "provider-job-2" })),
    status: vi.fn(async () => ({
      id: "provider-job-1",
      status: "COMPLETED" as const,
      output: value.output,
    })),
    cancel: vi.fn(async () => ({ id: "provider-job-1", status: "CANCELLED" as const })),
  };
  const confirmDrained = vi.fn(async () => ({
    billableWorkers: "0",
    queuedJobs: "0",
    observedAt,
  }));
  mocks.createHostedRunPodPair.mockReset();
  const confirmOrdinaryStartupQueueEmpty = vi.fn();
  mocks.createHostedRunPodPair.mockResolvedValue({
    transports: { mage_image: transport, soulx_avatar: transport },
    clients: {
      mage_image: { confirmDrained, confirmOrdinaryStartupQueueEmpty },
      soulx_avatar: { confirmDrained },
    },
  });
  const environment = {
    PRIVATE_ARTIFACTS: bucket(),
    VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: receiptKey.toString("hex"),
    VIDEOFORGE_PROVIDER_PROOF_KEY_ID: receiptKeyId,
  } as unknown as HostedRuntimeEnvironment;
  return {
    value,
    row,
    terminalStore,
    transport,
    confirmDrained,
    confirmOrdinaryStartupQueueEmpty,
    environment,
  };
}

const params = {
  schema_version: "videoforge-image-regeneration-workflow/v1" as const,
  accountId: ids.account,
  workspaceId: ids.workspace,
  requestId: "regeneration-request-1",
};

describe("hosted image regeneration execution", () => {
  it("blocks dispatch when the existing provider startup preflight fails", async () => {
    const value = await prepareHarness("PREPARED");
    value.confirmOrdinaryStartupQueueEmpty.mockRejectedValueOnce(new Error("queue occupied"));
    await expect(
      observeHostedImageRegeneration(value.environment, {} as TransactionalSqlExecutor, params),
    ).resolves.toMatchObject({ state: "CANCELLED", leaseReleased: true });
    expect(value.transport.run).not.toHaveBeenCalled();
    expect(value.transport.status).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    mocks.state.row = null;
    mocks.state.claim = null;
    mocks.state.lineage = null;
    mocks.state.terminalStore = null;
    mocks.state.replacements = [];
    mocks.state.releases = [];
    mocks.state.releaseResult = true;
    mocks.state.failedQueued = [];
  });

  it("fails an expired queued request without starting provider work", async () => {
    const value = await prepareHarness("QUEUED");
    value.row.created_at = "2000-01-01T00:00:00.000Z";

    await expect(
      observeHostedImageRegeneration(value.environment, {} as TransactionalSqlExecutor, params),
    ).resolves.toEqual({
      requestId: params.requestId,
      state: "FAILED",
      providerJobId: null,
      replaced: false,
      leaseReleased: true,
    });

    expect(mocks.state.failedQueued).toEqual([params.requestId]);
    expect(mocks.createHostedRunPodPair).not.toHaveBeenCalled();
    expect(value.transport.run).not.toHaveBeenCalled();
    expect(value.transport.status).not.toHaveBeenCalled();
    expect(value.transport.cancel).not.toHaveBeenCalled();
    expect(value.confirmDrained).not.toHaveBeenCalled();
    expect(mocks.state.releases).toHaveLength(0);
  });

  it("never resends an unknown dispatch acknowledgement across observations", async () => {
    const value = await prepareHarness("DISPATCH_ACK_UNKNOWN");

    await expect(
      observeHostedImageRegeneration(value.environment, {} as TransactionalSqlExecutor, params),
    ).resolves.toMatchObject({
      state: "DISPATCH_ACK_UNKNOWN",
      leaseReleased: false,
    });
    await expect(
      observeHostedImageRegeneration(value.environment, {} as TransactionalSqlExecutor, params),
    ).resolves.toMatchObject({
      state: "DISPATCH_ACK_UNKNOWN",
      leaseReleased: false,
    });

    expect(value.transport.run).not.toHaveBeenCalled();
    expect(value.transport.status).not.toHaveBeenCalled();
    expect(value.transport.cancel).not.toHaveBeenCalled();
    expect(value.confirmDrained).not.toHaveBeenCalled();
    expect(mocks.state.releases).toHaveLength(0);
  });

  it("accepts a verified provider artifact before replacing the selected scene and releasing the lease", async () => {
    const value = await prepareHarness("ASSIGNED");

    await expect(
      observeHostedImageRegeneration(value.environment, {} as TransactionalSqlExecutor, params),
    ).resolves.toMatchObject({
      state: "COMPLETED",
      providerJobId: "provider-job-1",
      replaced: true,
      leaseReleased: true,
    });

    expect(value.transport.run).not.toHaveBeenCalled();
    expect(value.transport.status).toHaveBeenCalledWith("provider-job-1");
    expect(value.terminalStore.commitArtifacts).toHaveBeenCalledOnce();
    expect(value.terminalStore.commitArtifacts.mock.calls[0]?.[0].artifacts).toEqual([
      {
        reservationId: ids.reservation,
        itemId: ids.task,
        objectKey,
        contentType: "image/png",
        contentLength: artifactBytes.byteLength,
        checksumSha256: artifactSha,
        probe: { width: 1280, height: 720, format: "png" },
      },
    ]);
    expect(mocks.state.replacements).toHaveLength(1);
    expect(mocks.state.replacements[0]).toMatchObject({
      state: "LANE_COMPLETED",
      acceptedItemCount: 1,
      lane: "mage_image",
    });
    expect(value.confirmDrained).toHaveBeenCalledWith(6, {
      allowStandbyWorkers: true,
      deadlineMs: 30_000,
    });
    expect(mocks.state.releases).toEqual([{ billableWorkers: "0", queuedJobs: "0", observedAt }]);
  });

  it("finishes terminal observation when lease was already released", async () => {
    const value = await prepareHarness("ASSIGNED");
    mocks.state.releaseResult = false;

    await expect(
      observeHostedImageRegeneration(value.environment, {} as TransactionalSqlExecutor, params),
    ).resolves.toMatchObject({
      state: "COMPLETED",
      leaseReleased: true,
    });

    expect(value.confirmDrained).toHaveBeenCalledWith(6, {
      allowStandbyWorkers: true,
      deadlineMs: 30_000,
    });
    expect(mocks.state.releases).toHaveLength(1);
  });
});
