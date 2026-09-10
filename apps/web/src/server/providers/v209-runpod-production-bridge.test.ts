import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";

import { runV209RunPodProductionBridge } from "../../../../../deploy/v2-09/v209-runpod-production-bridge";

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const SOURCE = "a".repeat(40);

function input(lane: "mage" | "soulx" = "mage") {
  return {
    schema_version: "videoforge.v2-09-runpod-production-bridge/v1",
    command: "CREATE_OR_READ_LANE",
    authority_id: "v2-09-runpod-production-test",
    source_commit: SOURCE,
    api_key: "test-runpod-key-never-returned",
    lane,
    lanes: [
      {
        lane: "mage",
        image_sha256: "sha256:5aff610dd00075ac0601eda9dbd3caf07d7ebf96a73fca849d075a215e4e7161",
        image_source_commit: "b".repeat(40),
        image_config_sha256: hash("mage-config"),
        anonymous_proof_sha256: hash("mage-anonymous"),
        acceptance_sha256: hash("mage-acceptance"),
        volume_id_sha256: hash("mage-volume"),
        volume_manifest_sha256: hash("mage-volume-manifest"),
      },
      {
        lane: "soulx",
        image_sha256: "sha256:7bf51f87035928a4ec1f2826021fa688ef526973887ee9f80117ae4619315bff",
        image_source_commit: "c".repeat(40),
        image_config_sha256: hash("soulx-config"),
        anonymous_proof_sha256: hash("soulx-anonymous"),
        acceptance_sha256: hash("soulx-acceptance"),
        volume_id_sha256: hash("soulx-volume"),
        volume_manifest_sha256: hash("soulx-volume-manifest"),
      },
    ],
    worker_environment: {
      envelopeSigningKeyId: "v209-envelope",
      envelopeSigningKeyHex: "1".repeat(64),
      receiptKeyId: "v209-receipt",
      receiptSigningKeyHex: "2".repeat(64),
      mageWorkerTokenHex: "3".repeat(64),
    },
  } as const;
}

function deployment(lane: "mage" | "soulx") {
  const selected = input(lane).lanes.find((item) => item.lane === lane)!;
  return {
    lane,
    purpose: "production",
    resourceKey: `v2-09-runpod-production-test-${lane}-production`,
    endpointId: `${lane}-endpoint-id`,
    templateId: `${lane}-template-id`,
    endpointIdSha256: hash(`${lane}-endpoint-id`),
    templateIdSha256: hash(`${lane}-template-id`),
    deploymentSha256: hash(`${lane}-deployment`),
    image:
      lane === "mage"
        ? `ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@${selected.image_sha256}`
        : `ghcr.io/pala-lakshmansai/videoforge-soulx-serverless-v2-08@${selected.image_sha256}`,
    sourceCommit: SOURCE,
    volumeIdSha256: selected.volume_id_sha256,
    volumeManifestSha256: selected.volume_manifest_sha256,
    volumeSizeGb: 50,
    volumeMount: "/runpod-volume",
    region: "EU-RO-1",
    gpu: "NVIDIA GeForce RTX 4090",
    gpuCount: 1,
    workersMin: 0,
    workersMax: 1,
    idleTimeoutSeconds: 5,
    handlerConcurrency: 1,
    scalerType: "REQUEST_COUNT",
    scalerValue: 1,
    initTimeoutSeconds: 800,
  };
}

function resourceName(lane: "mage" | "soulx", suffix: "endpoint" | "template") {
  const key = `v2-09-runpod-production-test-${lane}-production`;
  return `vf_v213_${createHash("sha256").update(key).digest("hex").slice(0, 24)}_${suffix}`;
}

function workerEnvironment(lane: "mage" | "soulx", endpointId?: string) {
  const base = input(lane);
  const binding = base.lanes.find((item) => item.lane === lane)!;
  const common = {
    LOG_LEVEL: "INFO",
    RUNPOD_INIT_TIMEOUT: "800",
    VIDEOFORGE_V213_RESOURCE_KEY_SHA256: hash(`v2-09-runpod-production-test-${lane}-production`),
    VIDEOFORGE_V213_LANE: lane,
    VIDEOFORGE_V213_PURPOSE: "production",
    VIDEOFORGE_ENVELOPE_KEY_ID: base.worker_environment.envelopeSigningKeyId,
    VIDEOFORGE_ENVELOPE_KEY_SHA256: `sha256:${createHash("sha256")
      .update(Buffer.from(base.worker_environment.envelopeSigningKeyHex, "hex"))
      .digest("hex")}`,
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: base.worker_environment.envelopeSigningKeyHex,
    VIDEOFORGE_RECEIPT_KEY_ID: base.worker_environment.receiptKeyId,
    VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX: base.worker_environment.receiptSigningKeyHex,
  };
  return lane === "mage"
    ? {
        ...common,
        VIDEOFORGE_MAGE_GPU_OFFERING_ID: "NVIDIA GeForce RTX 4090",
        VIDEOFORGE_MAGE_MANIFEST_SHA256: binding.volume_manifest_sha256,
        VIDEOFORGE_MAGE_VOLUME_ID_HASH: binding.volume_id_sha256,
        VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: `ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@${binding.image_sha256}`,
        VIDEOFORGE_MAGE_WORKER_TOKEN: base.worker_environment.mageWorkerTokenHex,
        ...(endpointId ? { VIDEOFORGE_MAGE_ENDPOINT_ID_HASH: hash(endpointId) } : {}),
      }
    : {
        ...common,
        VIDEOFORGE_SOULX_CONTAINER_DIGEST: binding.image_sha256,
        VIDEOFORGE_SOULX_MODEL_MANIFEST_SHA256: binding.volume_manifest_sha256,
        VIDEOFORGE_SOULX_VOLUME_ID_SHA256: binding.volume_id_sha256,
        ...(endpointId ? { VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256: hash(endpointId) } : {}),
      };
}

function cleanupRequest() {
  const base = input();
  return {
    schema_version: base.schema_version,
    command: "DELETE_ATTRIBUTABLE_PAIR" as const,
    authority_id: base.authority_id,
    source_commit: base.source_commit,
    api_key: base.api_key,
    lanes: base.lanes,
    worker_environment: base.worker_environment,
    deployments: [],
    jobs: [],
  };
}

test("creates exactly one max-one production lane and reads it back", async () => {
  const calls: Array<{ name: string; value?: unknown }> = [];
  const expected = deployment("mage");
  const result = await runV209RunPodProductionBridge(input(), {
    createControl: () => ({}) as never,
    createTransport: (() => ({
      createLane: async (value: unknown) => {
        calls.push({ name: "create", value });
        return { kind: "ACK", deployment: expected };
      },
      readLane: async (value: unknown) => {
        calls.push({ name: "read", value });
        return expected;
      },
      findLaneByResourceKey: async () => {
        calls.push({ name: "find" });
        return null;
      },
    })) as never,
  });
  assert.deepEqual(
    calls.map(({ name }) => name),
    ["create", "read"],
  );
  assert.equal(result.deployment, expected);
  const create = calls[0]?.value as Record<string, unknown>;
  assert.equal(create.purpose, "production");
  assert.equal(create.workersMin, 0);
  assert.equal(create.workersMax, 1);
  assert.equal(create.idleTimeoutSeconds, 5);
});

test("ACK_UNKNOWN performs deterministic lookup without redispatch", async () => {
  let createCount = 0;
  let findCount = 0;
  const expected = deployment("soulx");
  const result = await runV209RunPodProductionBridge(input("soulx"), {
    createControl: () => ({}) as never,
    createTransport: (() => ({
      createLane: async () => {
        createCount += 1;
        return { kind: "ACK_UNKNOWN" };
      },
      findLaneByResourceKey: async () => {
        findCount += 1;
        return expected;
      },
      readLane: async () => expected,
    })) as never,
  });
  assert.equal(result.deployment, expected);
  assert.equal(createCount, 1);
  assert.equal(findCount, 1);
});

test("rejects widened or wrong-image requests before constructing provider clients", async () => {
  let controlCount = 0;
  const widened = structuredClone(input()) as Record<string, unknown>;
  (widened.lanes as Array<Record<string, unknown>>)[0]!.image_sha256 = hash("wrong-image");
  await assert.rejects(
    runV209RunPodProductionBridge(widened, {
      createControl: () => {
        controlCount += 1;
        return {} as never;
      },
    }),
    /V2_09_RUNPOD_BRIDGE_LANE_INVALID/u,
  );
  assert.equal(controlCount, 0);
});

test("failure cleanup recovers endpoint-only and template-only names and deletes without dispatch", async () => {
  const request = cleanupRequest();
  const calls: string[] = [];
  let disposableRead = 0;
  const mageEndpoint = {
    id: "mage-partial-endpoint",
    name: resourceName("mage", "endpoint"),
    raw: {
      workersMin: 0,
      workersMax: 1,
      idleTimeout: 5,
      gpuCount: 1,
      gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
      networkVolumeId: "mage-volume",
      dataCenterIds: ["EU-RO-1"],
    },
  };
  const soulxTemplate = {
    id: "soulx-partial-template",
    name: resourceName("soulx", "template"),
    raw: {
      imageName:
        "ghcr.io/pala-lakshmansai/videoforge-soulx-serverless-v2-08@sha256:7bf51f87035928a4ec1f2826021fa688ef526973887ee9f80117ae4619315bff",
      isServerless: true,
      containerDiskInGb: 120,
      env: workerEnvironment("soulx"),
    },
  };
  const result = await runV209RunPodProductionBridge(request, {
    createControl: () =>
      ({
        inventoryDisposableResources: async () => {
          disposableRead += 1;
          return disposableRead === 1
            ? { endpoints: [mageEndpoint], templates: [soulxTemplate] }
            : { endpoints: [], templates: [] };
        },
        inventory: async () => ({ runningPodCount: 0, activeServerlessWorkerCount: 0 }),
        deleteEndpoint: async (id: string) => calls.push(`delete-endpoint:${id}`),
        deleteTemplate: async (id: string) => calls.push(`delete-template:${id}`),
      }) as never,
    createJobClient: () =>
      ({
        confirmStartupQueueEmpty: async () => calls.push("queue-empty:mage"),
      }) as never,
    createTransport: (() => ({
      inventory: async () => ({
        checkedAt: "2026-09-06T12:00:00Z",
        runningPods: 0,
        activeWorkers: 0,
        queuedJobs: 0,
        endpointIdSha256s: [],
        templateIdSha256s: [],
        volumes: [],
      }),
    })) as never,
  });
  assert.deepEqual(calls, [
    "queue-empty:mage",
    "delete-template:soulx-partial-template",
    "delete-endpoint:mage-partial-endpoint",
  ]);
  assert.equal(result.command, "DELETE_ATTRIBUTABLE_PAIR");
  assert.deepEqual(result.inventory?.endpointIdSha256s, []);
});

test("cleanup accepts an exact full pre-bind pair and deletes endpoint before base-env template", async () => {
  const request = cleanupRequest();
  const templateId = "mage-prebind-template";
  const endpointId = "mage-prebind-endpoint";
  const endpoint = {
    id: endpointId,
    name: resourceName("mage", "endpoint"),
    raw: {
      templateId,
      workersMin: 0,
      workersMax: 1,
      idleTimeout: 5,
      gpuCount: 1,
      gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
      networkVolumeId: "mage-volume",
      dataCenterIds: ["EU-RO-1"],
    },
  };
  const template = {
    id: templateId,
    name: resourceName("mage", "template"),
    raw: {
      imageName:
        "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:5aff610dd00075ac0601eda9dbd3caf07d7ebf96a73fca849d075a215e4e7161",
      isServerless: true,
      containerDiskInGb: 120,
      env: workerEnvironment("mage"),
    },
  };
  const calls: string[] = [];
  let readCount = 0;
  const result = await runV209RunPodProductionBridge(request, {
    createControl: () =>
      ({
        inventoryDisposableResources: async () =>
          readCount++ === 0
            ? { endpoints: [endpoint], templates: [template] }
            : { endpoints: [], templates: [] },
        inventory: async () => ({ runningPodCount: 0, activeServerlessWorkerCount: 0 }),
        deleteEndpoint: async (id: string) => calls.push(`endpoint:${id}`),
        deleteTemplate: async (id: string) => calls.push(`template:${id}`),
      }) as never,
    createJobClient: () =>
      ({ confirmStartupQueueEmpty: async () => calls.push("queue-empty") }) as never,
    createTransport: (() => ({
      inventory: async () => ({
        checkedAt: "2026-09-06T12:00:00Z",
        runningPods: 0,
        activeWorkers: 0,
        queuedJobs: 0,
        endpointIdSha256s: [],
        templateIdSha256s: [],
        volumes: [],
      }),
    })) as never,
  });
  assert.deepEqual(calls, ["queue-empty", `endpoint:${endpointId}`, `template:${templateId}`]);
  assert.deepEqual(result.inventory?.endpointIdSha256s, []);
});

test("cleanup rejects a pre-bind pair whose base template environment is not exact", async () => {
  const request = cleanupRequest();
  let deleteCount = 0;
  await assert.rejects(
    runV209RunPodProductionBridge(request, {
      createControl: () =>
        ({
          inventoryDisposableResources: async () => ({
            endpoints: [
              {
                id: "mage-prebind-endpoint",
                name: resourceName("mage", "endpoint"),
                raw: {
                  templateId: "mage-prebind-template",
                  workersMin: 0,
                  workersMax: 1,
                  idleTimeout: 5,
                  gpuCount: 1,
                  gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
                  networkVolumeId: "mage-volume",
                  dataCenterIds: ["EU-RO-1"],
                },
              },
            ],
            templates: [
              {
                id: "mage-prebind-template",
                name: resourceName("mage", "template"),
                raw: {
                  imageName:
                    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:5aff610dd00075ac0601eda9dbd3caf07d7ebf96a73fca849d075a215e4e7161",
                  isServerless: true,
                  containerDiskInGb: 120,
                  env: { ...workerEnvironment("mage"), FORBIDDEN_EXTRA: "1" },
                },
              },
            ],
          }),
          deleteEndpoint: async () => {
            deleteCount += 1;
          },
          deleteTemplate: async () => {
            deleteCount += 1;
          },
        }) as never,
    }),
    /V2_09_RUNPOD_BRIDGE_ATTRIBUTABLE_TEMPLATE_DRIFT/u,
  );
  assert.equal(deleteCount, 0);
});

test("terminal reconciliation cancels an exact assigned job without deleting its lane", async () => {
  const base = input();
  let cancelCount = 0;
  let deleteCount = 0;
  const result = await runV209RunPodProductionBridge(
    {
      schema_version: base.schema_version,
      command: "RECONCILE_TERMINAL_JOBS",
      authority_id: base.authority_id,
      source_commit: base.source_commit,
      api_key: base.api_key,
      lanes: base.lanes,
      worker_environment: base.worker_environment,
      deployments: [deployment("mage")],
      jobs: [{ lane: "mage", job_id: "mage-job", status: "IN_PROGRESS" }],
    },
    {
      createControl: () =>
        ({
          deleteEndpoint: async () => {
            deleteCount += 1;
          },
          deleteTemplate: async () => {
            deleteCount += 1;
          },
        }) as never,
      createJobClient: () =>
        ({
          status: async () => ({ id: "mage-job", status: "IN_PROGRESS" }),
          cancel: async () => {
            cancelCount += 1;
            return { id: "mage-job", status: "CANCELLED", executionTimeMs: null };
          },
        }) as never,
      createTransport: (() => ({
        inventory: async () => ({
          checkedAt: "2026-09-06T12:00:00Z",
          runningPods: 0,
          activeWorkers: 0,
          queuedJobs: 0,
          endpointIdSha256s: [hash("mage-endpoint-id")],
          templateIdSha256s: [hash("mage-template-id")],
          volumes: [],
        }),
      })) as never,
    },
  );
  assert.equal(cancelCount, 1);
  assert.equal(deleteCount, 0);
  assert.equal(result.command, "RECONCILE_TERMINAL_JOBS");
  assert.equal(result.terminal_jobs?.[0]?.status, "CANCELLED");
  assert.equal(result.terminal_jobs?.[0]?.execution_time_ms, null);
});

test("staging 23-key deployment requires the exact reconstructed V2-09 resource key", async () => {
  const request = cleanupRequest();
  const { resourceKey: _fixtureKey, ...staged } = deployment("mage");
  assert.equal(Object.keys(staged).length, 23);
  assert.equal(Object.hasOwn(staged, "resourceKey"), false);
  let controlCalls = 0;
  const ports = {
    createControl: () => {
      controlCalls += 1;
      throw new Error("FIXTURE_VALIDATED_BEFORE_PROVIDER_ACCESS");
    },
  };
  await assert.rejects(
    runV209RunPodProductionBridge({ ...request, deployments: [staged] }, ports),
    /V2_09_RUNPOD_BRIDGE_DEPLOYMENT_INVALID/u,
  );
  assert.equal(controlCalls, 0);
  const resourceKey = `${request.authority_id}-mage-production`;
  await assert.rejects(
    runV209RunPodProductionBridge({ ...request, deployments: [{ ...staged, resourceKey }] }, ports),
    /FIXTURE_VALIDATED_BEFORE_PROVIDER_ACCESS/u,
  );
  assert.equal(controlCalls, 1);
  for (const wrongKey of [
    "foreign-authority-mage-production",
    `${request.authority_id}-soulx-production`,
  ]) {
    await assert.rejects(
      runV209RunPodProductionBridge(
        { ...request, deployments: [{ ...staged, resourceKey: wrongKey }] },
        ports,
      ),
      /V2_09_RUNPOD_BRIDGE_DEPLOYMENT_INVALID/u,
    );
  }
  assert.equal(controlCalls, 1);
});
