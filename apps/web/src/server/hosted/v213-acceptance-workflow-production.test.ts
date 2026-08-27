import { canonicalSha256, type TransactionalSqlExecutor } from "@videoforge/control-plane";
import renderResultFixture from "@videoforge/contracts/generated/fixtures/render_job_result.valid.json";
import { describe, expect, it, vi } from "vitest";

import type { HostedPairLiveEnvironment } from "./hosted-pair-live-wiring.js";
import {
  parseV213TechnicalCapturePlan,
  parseV213V211PolicyPlan,
  V213SqlAcceptanceWorkflowPort,
} from "./v213-acceptance-workflow-production.js";
import { hashRunPodV207EndpointIdentity } from "../providers/runpod-control.js";
import type {
  V213AcceptanceWorkflowParameters,
  V213AcceptanceWorkflowPlan,
} from "./v213-acceptance-workflow-runner.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const projectRevisionId = "44444444-4444-4444-8444-444444444444";
const generationRequestId = "55555555-5555-4555-8555-555555555555";
const attemptId = "66666666-6666-4666-8666-666666666666";
const hash = (name: string) => canonicalSha256({ name });

const workflowParams: V213AcceptanceWorkflowParameters = {
  schemaVersion: "videoforge.v213-acceptance-workflow-params/v1",
  kind: "V213_DATABASE_ACCEPTANCE",
  fullLiveAuthorityId: "77777777-7777-4777-8777-777777777777",
  operationId: "v2-10-operator-free-ranga-pilot",
  checkpoint: "V2-10",
  workflowId: "v213-v2-10-execution",
  requestSha256: hash("request"),
};

const plan: V213AcceptanceWorkflowPlan = {
  schemaVersion: "videoforge.v213-acceptance-workflow-plan/v1",
  fullLiveAuthorityId: workflowParams.fullLiveAuthorityId,
  operationId: workflowParams.operationId,
  checkpoint: workflowParams.checkpoint,
  workflowId: workflowParams.workflowId,
  requestSha256: workflowParams.requestSha256,
  workloadDeadlineAt: "2099-01-01T00:00:00.000Z",
  pollIntervalMs: 250,
  scopes: [
    {
      accountId,
      workspaceId,
      projectId,
      projectRevisionId,
      generationRequestId,
      cancelAt: "2098-12-31T23:45:00.000Z",
      stopAt: "2098-12-31T23:55:00.000Z",
    },
  ],
  sameAccountWaiter: null,
  fairnessProbe: null,
  output: null,
};

const prefix =
  `tenant/${accountId}/workspace/${workspaceId}/project/${projectId}` +
  `/revision/${projectRevisionId}/lane/render/job/${attemptId}/artifact/`;

const capturePlan = {
  schemaVersion: "videoforge.v213-acceptance-technical-capture-plan/v1",
  workflowParams,
  checkpoint: "V2-10",
  outputBindingSha256: hash("output-binding"),
  scopes: [
    {
      scopeIndex: 0,
      accountId,
      workspaceId,
      projectId,
      projectRevisionId,
      generationRequestId,
      render: {
        attemptId,
        resultObjectKey: `${prefix}result.json`,
        resultContentType: "application/json",
        resultContentLength: 1_024,
        resultChecksumSha256: hash("result"),
        outputObjectKey: `${prefix}output.mp4`,
        outputContentType: "video/mp4",
        outputContentLength: 4_096,
        outputChecksumSha256: hash("output"),
        resultReceiptSha256: hash("result-receipt"),
      },
      jobs: [
        {
          lane: "mage_image",
          providerJobId: "mage-job",
          provenanceReceiptSha256: hash("mage-receipt"),
        },
        {
          lane: "soulx_avatar",
          providerJobId: "soulx-job",
          provenanceReceiptSha256: hash("soulx-receipt"),
        },
      ],
    },
  ],
} as const;

describe("V213 acceptance technical capture plan", () => {
  it("accepts only the exact DB-owned R2 and provider binding", () => {
    expect(parseV213TechnicalCapturePlan(capturePlan, plan, workflowParams)).toEqual(capturePlan);
  });

  it("rejects cross-scope R2 paths, lane order drift, and extra keys", () => {
    expect(() =>
      parseV213TechnicalCapturePlan(
        {
          ...capturePlan,
          scopes: [
            {
              ...capturePlan.scopes[0],
              render: { ...capturePlan.scopes[0].render, resultObjectKey: "foreign/result.json" },
            },
          ],
        },
        plan,
        workflowParams,
      ),
    ).toThrow("V213_ACCEPTANCE_TECHNICAL_CAPTURE_PLAN_INVALID");
    expect(() =>
      parseV213TechnicalCapturePlan(
        {
          ...capturePlan,
          scopes: [
            {
              ...capturePlan.scopes[0],
              jobs: [...capturePlan.scopes[0].jobs].reverse(),
            },
          ],
        },
        plan,
        workflowParams,
      ),
    ).toThrow("V213_ACCEPTANCE_TECHNICAL_CAPTURE_PLAN_INVALID");
    expect(() =>
      parseV213TechnicalCapturePlan({ ...capturePlan, callerEvidence: true }, plan, workflowParams),
    ).toThrow("V213_ACCEPTANCE_TECHNICAL_CAPTURE_PLAN_INVALID");
  });
});

const v211Plan: V213AcceptanceWorkflowPlan = {
  ...plan,
  operationId: "v2-11-two-concurrent-owned-projects",
  checkpoint: "V2-11",
  scopes: [
    plan.scopes[0]!,
    {
      accountId: "88888888-8888-4888-8888-888888888888",
      workspaceId: "99999999-9999-4999-8999-999999999999",
      projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      projectRevisionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      generationRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      cancelAt: "2098-12-31T23:45:00.000Z",
      stopAt: "2098-12-31T23:55:00.000Z",
    },
  ],
  sameAccountWaiter: {
    accountId,
    workspaceId,
    projectId,
    projectRevisionId,
    generationRequestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  },
  fairnessProbe: {
    accountId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    workspaceId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    projectId: "12121212-1212-4212-8212-121212121212",
    projectRevisionId: "13131313-1313-4313-8313-131313131313",
    generationRequestId: "14141414-1414-4414-8414-141414141414",
  },
};

function v211PolicyPlan(action: "APPLY_MAX2" | "RESTORE_MAX1") {
  const lane = (name: "mage_image" | "soulx_avatar") => {
    const short = name === "mage_image" ? "mage" : "soulx";
    return {
      lane: name,
      endpointId: `endpoint_${short}`,
      endpointIdSha256: hashRunPodV207EndpointIdentity(`endpoint_${short}`),
      templateId: `template_${short}`,
      templateIdSha256: hashRunPodV207EndpointIdentity(`template_${short}`),
      volumeIdSha256: hashRunPodV207EndpointIdentity(`volume_${short}`),
      volumeManifestSha256: hash(`${short}-manifest`),
    };
  };
  return {
    schemaVersion: "videoforge.v213-v211-policy-action-plan/v1",
    workflowParams: { ...workflowParams, operationId: v211Plan.operationId, checkpoint: "V2-11" },
    action,
    lanes: [lane("mage_image"), lane("soulx_avatar")],
  } as const;
}

describe("V213 V2-11 provider policy producer", () => {
  it("binds the exact protected endpoint, template, volume, and manifest plan", () => {
    const expected = v211PolicyPlan("APPLY_MAX2");
    expect(
      parseV213V211PolicyPlan(expected, v211Plan, "APPLY_MAX2", {
        VIDEOFORGE_MAGE_ENDPOINT_ID: "endpoint_mage",
        VIDEOFORGE_SOULX_ENDPOINT_ID: "endpoint_soulx",
      }),
    ).toEqual(expected);
    expect(() =>
      parseV213V211PolicyPlan(
        {
          ...expected,
          lanes: [{ ...expected.lanes[0], endpointId: "endpoint_drift" }, expected.lanes[1]],
        },
        v211Plan,
        "APPLY_MAX2",
        {
          VIDEOFORGE_MAGE_ENDPOINT_ID: "endpoint_mage",
          VIDEOFORGE_SOULX_ENDPOINT_ID: "endpoint_soulx",
        },
      ),
    ).toThrow("V213_ACCEPTANCE_V211_POLICY_PLAN_INVALID");
  });

  it("records two HMAC-signed max-two provider readbacks after zero-worker checks", async () => {
    const recorded: unknown[] = [];
    const policyCalls: Array<{ endpointId: string; workersMax: number }> = [];
    const expectedPlan = v211PolicyPlan("APPLY_MAX2");
    const runtime = sqlExecutor(async (sql) => {
      expect(sql).toContain("videoforge_prepare_v213_v211_policy_action");
      return expectedPlan;
    });
    const reconciler = sqlExecutor(async (sql, parameters) => {
      expect(sql).toContain("videoforge_record_v213_v211_policy_action");
      recorded.push(JSON.parse(String(parameters[0])));
      return { recorded: true };
    });
    const drained = {
      workersTotal: 0 as const,
      queuedJobs: 0 as const,
      observedAt: "2026-08-28T00:00:00.000Z",
    };
    const pair = vi.fn(async () => ({
      clients: {
        mage_image: { confirmDrained: vi.fn(async () => drained) },
        soulx_avatar: { confirmDrained: vi.fn(async () => drained) },
      },
      transports: {},
    }));
    const control = {
      resolveV207EndpointPlacement: vi.fn(async (expected: { endpointId: string }) => ({
        networkVolumeId: expected.endpointId === "endpoint_mage" ? "volume_mage" : "volume_soulx",
        dataCenterIds: ["EU-RO-1"] as const,
      })),
      enforceV207EndpointPolicy: vi.fn(
        async (
          endpointId: string,
          templateId: string,
          policy: { workersMax: 1 | 2 },
          placement: { networkVolumeId: string },
        ) => {
          policyCalls.push({ endpointId, workersMax: policy.workersMax });
          return {
            schemaVersion: "videoforge.runpod-v207-endpoint-policy-readback/v1" as const,
            endpointIdSha256: hashRunPodV207EndpointIdentity(endpointId),
            templateIdSha256: hashRunPodV207EndpointIdentity(templateId),
            volumeIdSha256: hashRunPodV207EndpointIdentity(placement.networkVolumeId),
            region: "EU-RO-1" as const,
            gpu: "NVIDIA GeForce RTX 4090" as const,
            workersMin: 0 as const,
            workersMax: policy.workersMax,
            gpuCount: 1 as const,
            idleTimeout: 5 as const,
            executionTimeoutMs: 2_400_000 as const,
            scalerType: "REQUEST_COUNT" as const,
            scalerValue: 1 as const,
          };
        },
      ),
    };
    const environment = {
      RUNPOD_API_KEY: "runpod-test-key",
      VIDEOFORGE_MAGE_ENDPOINT_ID: "endpoint_mage",
      VIDEOFORGE_SOULX_ENDPOINT_ID: "endpoint_soulx",
      VIDEOFORGE_PROVIDER_PROOF_KEY_ID: "v211-policy-test-key",
      VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: "ab".repeat(32),
    } as unknown as ConstructorParameters<typeof V213SqlAcceptanceWorkflowPort>[0];
    const port = new V213SqlAcceptanceWorkflowPort(
      environment,
      runtime,
      reconciler,
      pair as never,
      () => control,
    );
    await port.prepareV211Scenario(v211Plan);
    expect(policyCalls).toEqual([
      { endpointId: "endpoint_mage", workersMax: 2 },
      { endpointId: "endpoint_soulx", workersMax: 2 },
    ]);
    expect(recorded[0]).toMatchObject({
      action: "APPLY_MAX2",
      receipts: [
        { lane: "mage_image", signature: { algorithm: "HMAC-SHA256" } },
        { lane: "soulx_avatar", signature: { algorithm: "HMAC-SHA256" } },
      ],
    });
  });

  it("cancels a fenced promoted fairness probe through DB queue reconciliation only", async () => {
    const params = {
      ...workflowParams,
      operationId: v211Plan.operationId,
      checkpoint: "V2-11" as const,
    };
    const cancellationSha256 = hash("fairness-probe-cancellation");
    const reconciliationSha256 = hash("fairness-probe-reconciliation");
    const scenarioStep = {
      schemaVersion: "videoforge.v213-v211-scenario-step/v1",
      workflowParams: params,
      action: "CANCEL_PROMOTED_PROBE",
      promotedProbe: v211Plan.fairnessProbe,
    };
    const runtime = sqlExecutor(async (sql) => {
      if (sql.includes("prepare_v213_v211_scenario_step")) return scenarioStep;
      expect(sql).toContain("cancel_v213_v211_promoted_probe");
      return {
        schemaVersion: "videoforge.v213-v211-promoted-probe-cancel/v1",
        workflowParams: params,
        generationRequestId: v211Plan.fairnessProbe!.generationRequestId,
        providerDispatchFenced: true,
        providerJob: null,
        cancellationSha256,
      };
    });
    const recorded: Array<Record<string, unknown>> = [];
    const reconciler = sqlExecutor(async (sql, values) => {
      const input = JSON.parse(String(values[0])) as Record<string, unknown>;
      recorded.push(input);
      if (sql.includes("promoted_probe_reconciliation"))
        return {
          schemaVersion: "videoforge.v213-v211-promoted-probe-reconciliation/v1",
          workflowParams: params,
          generationRequestId: v211Plan.fairnessProbe!.generationRequestId,
          cancellationSha256,
          providerDispatchFenced: true,
          providerRaceReconciled: false,
          providerRaceActualUsd: 0,
          providerRaceJobId: null,
          providerRaceReceiptSha256: null,
          terminalState: "CANCELLED",
          activeLeaseAbsent: true,
          reconciliationSha256,
        };
      expect(sql).toContain("record_v213_v211_scenario_step");
      return { recorded: true };
    });
    const runPodPair = vi.fn();
    const createLiveComposition = vi.fn();
    const port = new V213SqlAcceptanceWorkflowPort(
      {
        VIDEOFORGE_PROVIDER_PROOF_KEY_ID: "v211-policy-test-key",
        VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: "ab".repeat(32),
      } as never,
      runtime,
      reconciler,
      runPodPair,
      (() => ({})) as never,
      createLiveComposition,
    );
    await expect(port.advanceV211Scenario(v211Plan)).resolves.toEqual({ recorded: true });
    expect(runPodPair).not.toHaveBeenCalled();
    expect(createLiveComposition).not.toHaveBeenCalled();
    expect(recorded).toEqual([
      { workflowParams: params, cancellationSha256, providerReadback: null },
      {
        workflowParams: params,
        action: "CANCEL_PROMOTED_PROBE",
        promotedProbe: v211Plan.fairnessProbe,
        cancellationSha256,
        reconciliationSha256,
      },
    ]);
  });

  it("reconciles a real promoted-probe provider race through direct cancel only", async () => {
    const params = {
      ...workflowParams,
      operationId: v211Plan.operationId,
      checkpoint: "V2-11" as const,
    };
    const providerJobId = "fairness-job-1";
    const providerJobIdSha256 = hashRunPodV207EndpointIdentity(providerJobId);
    const cancellationSha256 = hash("race-cancellation");
    const reconciliationSha256 = hash("race-reconciliation");
    const runtime = sqlExecutor(async (sql) =>
      sql.includes("prepare_v213_v211_scenario_step")
        ? {
            schemaVersion: "videoforge.v213-v211-scenario-step/v1",
            workflowParams: params,
            action: "CANCEL_PROMOTED_PROBE",
            promotedProbe: v211Plan.fairnessProbe,
          }
        : {
            schemaVersion: "videoforge.v213-v211-promoted-probe-cancel/v1",
            workflowParams: params,
            generationRequestId: v211Plan.fairnessProbe!.generationRequestId,
            providerDispatchFenced: false,
            providerJob: {
              lane: "mage_image",
              providerJobId,
              providerJobIdSha256,
            },
            cancellationSha256,
          },
    );
    const recorded: Array<Record<string, unknown>> = [];
    const reconciler = sqlExecutor(async (sql, values) => {
      const input = JSON.parse(String(values[0])) as Record<string, unknown>;
      recorded.push(input);
      if (sql.includes("promoted_probe_reconciliation")) {
        const providerReadback = input.providerReadback as Record<string, unknown>;
        return {
          schemaVersion: "videoforge.v213-v211-promoted-probe-reconciliation/v1",
          workflowParams: params,
          generationRequestId: v211Plan.fairnessProbe!.generationRequestId,
          cancellationSha256,
          providerDispatchFenced: false,
          providerRaceReconciled: true,
          providerRaceActualUsd: 0.25,
          providerRaceJobId: providerJobId,
          providerRaceReceiptSha256: providerReadback.receiptSha256,
          terminalState: "CANCELLED",
          activeLeaseAbsent: true,
          reconciliationSha256,
        };
      }
      return { recorded: true };
    });
    const status = vi.fn(async () => ({
      id: providerJobId,
      idHash: providerJobIdSha256,
      status: "IN_QUEUE",
      delayTimeMs: 0,
      executionTimeMs: null,
    }));
    const cancel = vi.fn(async () => ({
      id: providerJobId,
      idHash: providerJobIdSha256,
      status: "CANCELLED",
      delayTimeMs: 2,
      executionTimeMs: 0,
    }));
    const runPodPair = vi.fn(async () => ({
      clients: {
        mage_image: { status, cancel },
        soulx_avatar: { status: vi.fn(), cancel: vi.fn() },
      },
      transports: {},
    }));
    const createLiveComposition = vi.fn();
    const port = new V213SqlAcceptanceWorkflowPort(
      {
        VIDEOFORGE_PROVIDER_PROOF_KEY_ID: "v211-policy-test-key",
        VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: "ab".repeat(32),
      } as never,
      runtime,
      reconciler,
      runPodPair as never,
      (() => ({})) as never,
      createLiveComposition,
    );
    await expect(port.advanceV211Scenario(v211Plan)).resolves.toEqual({ recorded: true });
    expect(status).toHaveBeenCalledWith(providerJobId);
    expect(cancel).toHaveBeenCalledWith(providerJobId);
    expect(createLiveComposition).not.toHaveBeenCalled();
    expect(recorded[0]?.providerReadback).toMatchObject({
      schemaVersion: "videoforge.v213-v211-provider-race-cancel-receipt/v1",
      providerJobId,
      providerJobIdSha256,
      status: "CANCELLED",
      signature: { algorithm: "HMAC-SHA256" },
    });
  });
});

function sqlExecutor(
  query: (sql: string, parameters: readonly unknown[]) => Promise<unknown>,
): TransactionalSqlExecutor {
  type TestTransaction = {
    query<Row extends Record<string, unknown>>(
      sql: string,
      parameters?: readonly unknown[],
    ): Promise<{ readonly rows: readonly Row[] }>;
  };
  return {
    transaction: async <Value>(work: (transaction: TestTransaction) => Promise<Value>) =>
      work({
        query: async <Row extends Record<string, unknown>>(
          sql: string,
          parameters: readonly unknown[] = [],
        ) => ({ rows: [{ value: await query(sql, parameters) }] as unknown as readonly Row[] }),
      }),
  } as unknown as TransactionalSqlExecutor;
}

async function sha256Bytes(bytes: Uint8Array) {
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copied.buffer);
  return `sha256:${Buffer.from(digest).toString("hex")}`;
}

interface CaptureFixture {
  capture: Record<string, unknown>;
  object: null | { size: number; contentType: string; bytes: Uint8Array };
  provider: Record<"mage_image" | "soulx_avatar", Record<string, unknown>>;
}

async function captureFixture(mutate?: (fixture: CaptureFixture) => void): Promise<CaptureFixture> {
  const outputSha256 = String(renderResultFixture.output.sha256);
  const outputBytes = Number(renderResultFixture.output.bytes);
  const document = structuredClone(renderResultFixture) as Record<string, unknown> & {
    attempt_id: string;
  };
  document.attempt_id = attemptId;
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  const fixture: CaptureFixture = {
    capture: structuredClone(capturePlan) as unknown as Record<string, unknown>,
    object: { size: bytes.byteLength, contentType: "application/json", bytes },
    provider: {
      mage_image: {
        id: "mage-job",
        idHash: await sha256Bytes(new TextEncoder().encode("mage-job")),
        status: "COMPLETED",
        delayTimeMs: 20,
        executionTimeMs: 200,
        output: {
          provenance_receipt: { receipt_sha256: hash("mage-receipt") },
        },
      },
      soulx_avatar: {
        id: "soulx-job",
        idHash: await sha256Bytes(new TextEncoder().encode("soulx-job")),
        status: "COMPLETED",
        delayTimeMs: 30,
        executionTimeMs: 300,
        output: {
          provenance_receipt: { receipt_sha256: hash("soulx-receipt") },
        },
      },
    },
  };
  const scope = (fixture.capture.scopes as Array<Record<string, unknown>>)[0]!;
  scope.render = {
    ...(scope.render as Record<string, unknown>),
    outputChecksumSha256: outputSha256,
    outputContentLength: outputBytes,
    resultContentLength: bytes.byteLength,
    resultChecksumSha256: await sha256Bytes(bytes),
  };
  mutate?.(fixture);
  return fixture;
}

function capturePort(fixture: CaptureFixture, recorded: unknown[]) {
  const runtime = sqlExecutor(async (sql) => {
    expect(sql).toContain("videoforge_prepare_v213_acceptance_technical_capture");
    return fixture.capture;
  });
  const reconciler = sqlExecutor(async (sql, parameters) => {
    expect(sql).toContain("videoforge_record_v213_acceptance_technical_capture");
    recorded.push(JSON.parse(String(parameters[0])));
    return { recorded: true };
  });
  const environment = {
    PRIVATE_ARTIFACTS: {
      get: vi.fn(async () =>
        fixture.object
          ? {
              size: fixture.object.size,
              httpMetadata: { contentType: fixture.object.contentType },
              arrayBuffer: async () => fixture.object!.bytes.slice().buffer,
            }
          : null,
      ),
    },
  } as unknown as HostedPairLiveEnvironment & {
    PRIVATE_ARTIFACTS: NonNullable<
      ConstructorParameters<typeof V213SqlAcceptanceWorkflowPort>[0]["PRIVATE_ARTIFACTS"]
    >;
  };
  const runPodPair = vi.fn(async () => ({
    clients: {
      mage_image: {
        status: vi.fn(async () => fixture.provider.mage_image),
      },
      soulx_avatar: {
        status: vi.fn(async () => fixture.provider.soulx_avatar),
      },
    },
    transports: {},
  }));
  return new V213SqlAcceptanceWorkflowPort(
    environment,
    runtime,
    reconciler,
    runPodPair as unknown as ConstructorParameters<typeof V213SqlAcceptanceWorkflowPort>[3],
  );
}

describe("V213 acceptance technical capture production", () => {
  it("atomically records exact R2 bytes, contract output, and both provider reads", async () => {
    const fixture = await captureFixture();
    const recorded: unknown[] = [];
    await expect(capturePort(fixture, recorded).captureTechnicalEvidence(plan)).resolves.toEqual({
      recorded: true,
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      workflowParams,
      outputBindingSha256: hash("output-binding"),
      captures: [
        {
          scopeIndex: 0,
          resultBytesSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
          resultDocument: { schema_version: "render-job-result/v1", attempt_id: attemptId },
          provider: [
            {
              lane: "mage_image",
              status: "COMPLETED",
              provenanceReceiptSha256: hash("mage-receipt"),
            },
            {
              lane: "soulx_avatar",
              status: "COMPLETED",
              provenanceReceiptSha256: hash("soulx-receipt"),
            },
          ],
        },
      ],
    });
  });

  it.each([
    ["missing R2 object", (value: CaptureFixture) => (value.object = null)],
    [
      "R2 size",
      (value: CaptureFixture) => {
        value.object!.size += 1;
      },
    ],
    [
      "R2 content type",
      (value: CaptureFixture) => {
        value.object!.contentType = "text/plain";
      },
    ],
    [
      "R2 hash",
      (value: CaptureFixture) => {
        value.object!.bytes[0] = 0;
      },
    ],
    [
      "R2 JSON",
      (value: CaptureFixture) => {
        value.object!.bytes.fill(0x7b);
      },
    ],
    [
      "result schema",
      async (value: CaptureFixture) => {
        const document = JSON.parse(new TextDecoder().decode(value.object!.bytes));
        document.extra = true;
        value.object!.bytes = new TextEncoder().encode(JSON.stringify(document));
        value.object!.size = value.object!.bytes.byteLength;
        const scope = (value.capture.scopes as Array<Record<string, unknown>>)[0]!;
        scope.render = {
          ...(scope.render as Record<string, unknown>),
          resultContentLength: value.object!.bytes.byteLength,
          resultChecksumSha256: await sha256Bytes(value.object!.bytes),
        };
      },
    ],
    [
      "output lineage",
      (value: CaptureFixture) => {
        const scope = (value.capture.scopes as Array<Record<string, unknown>>)[0]!;
        scope.render = {
          ...(scope.render as Record<string, unknown>),
          outputChecksumSha256: hash("drift"),
        };
      },
    ],
    ["provider status", (value: CaptureFixture) => (value.provider.mage_image.status = "FAILED")],
    ["provider job", (value: CaptureFixture) => (value.provider.mage_image.id = "other-job")],
    ["provider hash", (value: CaptureFixture) => (value.provider.mage_image.idHash = "bad")],
    ["provider timing", (value: CaptureFixture) => (value.provider.mage_image.delayTimeMs = -1)],
    [
      "provider receipt",
      (value: CaptureFixture) =>
        (value.provider.mage_image.output = {
          provenance_receipt: { receipt_sha256: hash("other") },
        }),
    ],
  ])("rejects %s drift before the record SQL", async (_name, mutate) => {
    const fixture = await captureFixture();
    await mutate(fixture);
    const recorded: unknown[] = [];
    await expect(capturePort(fixture, recorded).captureTechnicalEvidence(plan)).rejects.toThrow();
    expect(recorded).toHaveLength(0);
  });
});
