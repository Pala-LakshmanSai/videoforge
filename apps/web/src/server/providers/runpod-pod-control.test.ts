import { describe, expect, it, vi } from "vitest";

import {
  CP06_MAGE_DATA_CENTER_ID,
  CP06_MAGE_GPU_TYPE_ID,
  CP06_MAGE_HTTP_PORT,
  CP06_MAGE_MODEL_BYTES,
  CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH,
  CP06_MAGE_NETWORK_VOLUME_SIZE_GB,
  CP06_MAGE_PREP_CONFIRMATION,
  CP06_MAGE_WRONG_VOLUME_ID_HASH,
  RunPodPodControlClient,
  RunPodPodControlError,
} from "./runpod-pod-control";

const key = "runpod-test-key-at-least-twenty-characters";
const image = `ghcr.io/pala-lakshmansai/videoforge-mage-cp06@sha256:${"a".repeat(64)}`;
const volumeId = "volume_cp06_01";
const volumeIdHash =
  "sha256:f15c68ae67a3799441e7e1badad3a6fe96a88380a4b2cbfc7748d01f384ea083" as const;

const response = (value: unknown, status = 200): Response =>
  status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });

const expectedStaticEnvironment = {
  HF_HUB_OFFLINE: "1",
  TRANSFORMERS_OFFLINE: "1",
  DIFFUSERS_OFFLINE: "1",
  MAGE_MODEL_ROOT: "/workspace/mage-model",
};

const pod = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "pod_cp06_01",
  adjustedCostPerHr: 0.74,
  costPerHr: "0.74",
  dockerEntrypoint: [],
  dockerStartCmd: [],
  endpointId: null,
  env: {
    ...expectedStaticEnvironment,
    VIDEOFORGE_MAGE_VOLUME_ID_HASH: volumeIdHash,
    VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: image,
    VIDEOFORGE_MAGE_WORKER_TOKEN: "t".repeat(40),
    VIDEOFORGE_MAGE_GPU_OFFERING_ID: CP06_MAGE_GPU_TYPE_ID,
  },
  gpu: { id: CP06_MAGE_GPU_TYPE_ID, count: 1, displayName: "RTX 4090" },
  image,
  interruptible: false,
  machine: {
    gpuTypeId: CP06_MAGE_GPU_TYPE_ID,
    dataCenterId: CP06_MAGE_DATA_CENTER_ID,
    secureCloud: true,
  },
  name: "vf_cp06_mage_qual_a",
  networkVolume: {
    id: volumeId,
    name: "vf_cp06_mage_int8_eu_ro_1_v1",
    size: CP06_MAGE_NETWORK_VOLUME_SIZE_GB,
    dataCenterId: CP06_MAGE_DATA_CENTER_ID,
  },
  ports: [CP06_MAGE_HTTP_PORT],
  templateId: "template_cp06_01",
  volumeInGb: 0,
  volumeMountPath: CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH,
  desiredStatus: "RUNNING",
  lastStartedAt: "2026-08-14T08:00:00.000Z",
  ...overrides,
});

const authority = {
  name: "vf_cp06_mage_qual_a",
  templateId: "template_cp06_01",
  imageDigest: image,
  networkVolumeId: volumeId,
  networkVolumeIdHash: volumeIdHash,
};

describe("RunPod Pod-native CP-06 control", () => {
  it("creates only the exact private non-Serverless Mage template", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
      expect(JSON.parse(String(init?.body))).toEqual({
        category: "NVIDIA",
        containerDiskInGb: 50,
        dockerEntrypoint: [],
        dockerStartCmd: [],
        env: expectedStaticEnvironment,
        imageName: image,
        isPublic: false,
        isServerless: false,
        name: "vf_cp06_mage_int8_template",
        ports: [CP06_MAGE_HTTP_PORT],
        readme: "VideoForge CP-06 exact Mage INT8 Pod worker",
        volumeInGb: 0,
        volumeMountPath: CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH,
      });
      return response({
        id: "template_cp06_01",
        category: "NVIDIA",
        containerDiskInGb: 50,
        dockerEntrypoint: [],
        dockerStartCmd: [],
        env: expectedStaticEnvironment,
        imageName: image,
        isPublic: false,
        isServerless: false,
        name: "vf_cp06_mage_int8_template",
        ports: [CP06_MAGE_HTTP_PORT],
        volumeInGb: 0,
        volumeMountPath: CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH,
      });
    });
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.createMagePodTemplate("vf_cp06_mage_int8_template", image),
    ).resolves.toEqual({
      id: "template_cp06_01",
      idHash: "sha256:92fb3e5520e49f8d43ad3a75075c25491227c965fa4a5b0440723a98e927f0f4",
    });
  });

  it("fails closed on a Serverless or public template and preserves its returned ID", async () => {
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch: async () =>
        response({
          id: "template_unsafe_01",
          category: "NVIDIA",
          containerDiskInGb: 50,
          dockerEntrypoint: [],
          dockerStartCmd: [],
          env: expectedStaticEnvironment,
          imageName: image,
          isPublic: true,
          isServerless: true,
          name: "vf_cp06_mage_int8_template",
          ports: [CP06_MAGE_HTTP_PORT],
          volumeInGb: 0,
          volumeMountPath: CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH,
        }),
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.createMagePodTemplate("vf_cp06_mage_int8_template", image),
    ).rejects.toMatchObject({
      code: "RUNPOD_MAGE_TEMPLATE_IDENTITY_UNCONFIRMED",
      resourceId: "template_unsafe_01",
    });
  });

  it("creates exactly one 50 GB EU-RO-1 network volume", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        dataCenterId: CP06_MAGE_DATA_CENTER_ID,
        name: "vf_cp06_mage_int8_eu_ro_1_v1",
        size: 50,
      });
      return response({
        dataCenterId: CP06_MAGE_DATA_CENTER_ID,
        id: volumeId,
        name: "vf_cp06_mage_int8_eu_ro_1_v1",
        size: 50,
      });
    });
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(client.createMageNetworkVolume("vf_cp06_mage_int8_eu_ro_1_v1")).resolves.toEqual({
      id: volumeId,
      idHash: volumeIdHash,
    });
  });

  it("recovers zero-or-one exact volume and fails closed on duplicate names", async () => {
    const exactVolume = {
      dataCenterId: CP06_MAGE_DATA_CENTER_ID,
      id: volumeId,
      name: "vf_cp06_mage_int8_eu_ro_1_v1",
      size: 50,
    };
    for (const [body, expected] of [
      [[], null],
      [[exactVolume], { id: volumeId, idHash: volumeIdHash }],
    ] as const) {
      const client = new RunPodPodControlClient({
        apiKey: key,
        fetch: async () => response(body),
        baseUrl: "http://127.0.0.1:43123",
      });
      await expect(
        client.findMageNetworkVolumeByName("vf_cp06_mage_int8_eu_ro_1_v1"),
      ).resolves.toEqual(expected);
    }
    const duplicateClient = new RunPodPodControlClient({
      apiKey: key,
      fetch: async () => response([exactVolume, { ...exactVolume, id: "volume_cp06_02" }]),
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      duplicateClient.findMageNetworkVolumeByName("vf_cp06_mage_int8_eu_ro_1_v1"),
    ).rejects.toMatchObject({
      code: "RUNPOD_MAGE_VOLUME_NAME_AMBIGUOUS",
      resourceIds: [volumeId, "volume_cp06_02"],
    });
  });

  it("recovers only one exact private Pod template by deterministic name", async () => {
    const exactTemplate = {
      id: "template_cp06_01",
      category: "NVIDIA",
      containerDiskInGb: 50,
      dockerEntrypoint: [],
      dockerStartCmd: [],
      env: expectedStaticEnvironment,
      imageName: image,
      isPublic: false,
      isServerless: false,
      name: "vf_cp06_mage_int8_template",
      ports: [CP06_MAGE_HTTP_PORT],
      volumeInGb: 0,
      volumeMountPath: CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH,
    };
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("includePublicTemplates")).toBe("false");
      expect(url.searchParams.get("includeRunpodTemplates")).toBe("false");
      return response([exactTemplate]);
    });
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.findMagePodTemplateByName("vf_cp06_mage_int8_template", image),
    ).resolves.toEqual({
      id: "template_cp06_01",
      idHash: "sha256:92fb3e5520e49f8d43ad3a75075c25491227c965fa4a5b0440723a98e927f0f4",
    });
  });

  it("creates an exact Secure EU-RO-1 RTX 4090 Pod with the owned volume", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        allowedCudaVersions: ["13.0"],
        cloudType: "SECURE",
        computeType: "GPU",
        dataCenterIds: [CP06_MAGE_DATA_CENTER_ID],
        dataCenterPriority: "custom",
        globalNetworking: false,
        gpuCount: 1,
        gpuTypeIds: [CP06_MAGE_GPU_TYPE_ID],
        gpuTypePriority: "custom",
        imageName: image,
        interruptible: false,
        name: authority.name,
        networkVolumeId: volumeId,
        ports: [CP06_MAGE_HTTP_PORT],
        supportPublicIp: false,
        templateId: authority.templateId,
        volumeInGb: 0,
        volumeMountPath: CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH,
      });
      expect(body.env).toEqual({
        ...expectedStaticEnvironment,
        VIDEOFORGE_MAGE_VOLUME_ID_HASH: volumeIdHash,
        VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: image,
        VIDEOFORGE_MAGE_WORKER_TOKEN: "t".repeat(40),
        VIDEOFORGE_MAGE_GPU_OFFERING_ID: CP06_MAGE_GPU_TYPE_ID,
      });
      return response(pod());
    });
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.createMagePod({ ...authority, workerToken: "t".repeat(40) }),
    ).resolves.toMatchObject({
      id: "pod_cp06_01",
      dataCenterId: CP06_MAGE_DATA_CENTER_ID,
      gpuTypeId: CP06_MAGE_GPU_TYPE_ID,
      costPerHourUsd: 0.74,
      networkVolumeIdHash: volumeIdHash,
      desiredStatus: "RUNNING",
      lastStartedAt: "2026-08-14T08:00:00.000Z",
    });
  });

  it("creates a dedicated prep-service Pod with the exact raw volume authority", async () => {
    const prepEntrypoint = ["python", "/opt/videoforge/mage_prepare_service.py"];
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.dockerEntrypoint).toEqual(prepEntrypoint);
      expect(body.dockerStartCmd).toEqual([]);
      expect(body.env).toEqual({
        ...expectedStaticEnvironment,
        VIDEOFORGE_MAGE_VOLUME_ID: volumeId,
        VIDEOFORGE_MAGE_DOWNLOAD_CONFIRMATION: CP06_MAGE_PREP_CONFIRMATION,
      });
      expect(JSON.stringify(body)).not.toContain("VIDEOFORGE_MAGE_WORKER_TOKEN");
      return response(
        pod({
          name: "vf_cp06_mage_prep",
          dockerEntrypoint: prepEntrypoint,
          dockerStartCmd: [],
          env: body.env,
        }),
      );
    });
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.createMagePrepPod({ ...authority, name: "vf_cp06_mage_prep" }),
    ).resolves.toMatchObject({
      id: "pod_cp06_01",
      name: "vf_cp06_mage_prep",
      networkVolumeIdHash: volumeIdHash,
    });
  });

  it("creates only the exact missing-volume negative Pod without a network volume or mount", async () => {
    const token = "m".repeat(40);
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).not.toHaveProperty("networkVolumeId");
      expect(body).not.toHaveProperty("volumeMountPath");
      expect(body.env).toMatchObject({
        VIDEOFORGE_MAGE_VOLUME_ID_HASH: volumeIdHash,
        VIDEOFORGE_MAGE_WORKER_TOKEN: token,
      });
      return response(
        pod({
          name: "vf_cp06_mage_missing_volume",
          env: body.env,
          networkVolume: null,
          volumeMountPath: null,
        }),
      );
    });
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.createMageMissingVolumeNegativePod({
        ...authority,
        name: "vf_cp06_mage_missing_volume",
        workerToken: token,
      }),
    ).resolves.toMatchObject({
      id: "pod_cp06_01",
      negativeKind: "MISSING_VOLUME",
      expectedWorkerError: "MAGE_VOLUME_MARKER_INVALID",
    });
  });

  it("creates only the exact wrong-volume-hash negative Pod with the intended volume attached", async () => {
    const token = "w".repeat(40);
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.networkVolumeId).toBe(volumeId);
      expect(body.volumeMountPath).toBe(CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH);
      expect(body.env).toMatchObject({
        VIDEOFORGE_MAGE_VOLUME_ID_HASH: CP06_MAGE_WRONG_VOLUME_ID_HASH,
        VIDEOFORGE_MAGE_WORKER_TOKEN: token,
      });
      return response(
        pod({
          name: "vf_cp06_mage_wrong_volume_hash",
          env: body.env,
        }),
      );
    });
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.createMageWrongVolumeHashNegativePod({
        ...authority,
        name: "vf_cp06_mage_wrong_volume_hash",
        workerToken: token,
      }),
    ).resolves.toMatchObject({
      id: "pod_cp06_01",
      negativeKind: "WRONG_VOLUME_HASH",
      expectedWorkerError: "MAGE_VOLUME_ID_MISMATCH",
    });
  });

  it("lists every exact-name Pod with raw IDs for duplicate cleanup", async () => {
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch: async (input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("name")).toBe(authority.name);
        expect(url.searchParams.get("includeWorkers")).toBe("false");
        return response([pod(), pod({ id: "pod_cp06_02" })]);
      },
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(client.listMagePodsByExactName(authority, "runtime")).resolves.toMatchObject([
      { id: "pod_cp06_01" },
      { id: "pod_cp06_02" },
    ]);
  });

  it("recovers exact negative Pods by name without adopting a positive Pod", async () => {
    const missingName = "vf_cp06_mage_missing_volume";
    const missingClient = new RunPodPodControlClient({
      apiKey: key,
      fetch: async () =>
        response([
          pod({
            name: missingName,
            env: {
              ...expectedStaticEnvironment,
              VIDEOFORGE_MAGE_VOLUME_ID_HASH: volumeIdHash,
              VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: image,
              VIDEOFORGE_MAGE_WORKER_TOKEN: "m".repeat(40),
              VIDEOFORGE_MAGE_GPU_OFFERING_ID: CP06_MAGE_GPU_TYPE_ID,
            },
            networkVolume: null,
            volumeMountPath: null,
          }),
        ]),
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      missingClient.listMagePodsByExactName({ ...authority, name: missingName }, "negativeMissing"),
    ).resolves.toMatchObject([{ id: "pod_cp06_01", negativeKind: "MISSING_VOLUME" }]);

    const wrongName = "vf_cp06_mage_wrong_volume_hash";
    const wrongClient = new RunPodPodControlClient({
      apiKey: key,
      fetch: async () =>
        response([
          pod({
            name: wrongName,
            env: {
              ...expectedStaticEnvironment,
              VIDEOFORGE_MAGE_VOLUME_ID_HASH: CP06_MAGE_WRONG_VOLUME_ID_HASH,
              VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: image,
              VIDEOFORGE_MAGE_WORKER_TOKEN: "w".repeat(40),
              VIDEOFORGE_MAGE_GPU_OFFERING_ID: CP06_MAGE_GPU_TYPE_ID,
            },
          }),
        ]),
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      wrongClient.listMagePodsByExactName({ ...authority, name: wrongName }, "negativeWrongHash"),
    ).resolves.toMatchObject([{ id: "pod_cp06_01", negativeKind: "WRONG_VOLUME_HASH" }]);
  });

  it("accepts prep completion only from the exact ready health evidence", () => {
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch: async () => response({}),
      baseUrl: "http://127.0.0.1:43123",
    });
    const health = {
      schema_version: "videoforge.mage-volume-preparation/v1",
      process: { status: "ok" },
      phase: "ready",
      failure_code: null,
      model: {
        id: "Comfy-Org/Mage-Flow",
        revision: "d8c99241f6fa80fbd453014234af2bf337ea21e6",
        precision: "int8-convrot",
        exact_bytes: CP06_MAGE_MODEL_BYTES,
        status: "ready",
      },
      volume: {
        id_hash: volumeIdHash,
        requested_size_gb: 50,
        manifest_sha256: `sha256:${"b".repeat(64)}`,
      },
    };
    expect(
      client.validateMagePrepHealth(health, { ...authority, name: "vf_cp06_mage_prep" }),
    ).toEqual({
      phase: "ready",
      prepared: true,
      failureCode: null,
      volumeIdHash,
      modelBytes: CP06_MAGE_MODEL_BYTES,
      manifestSha256: `sha256:${"b".repeat(64)}`,
    });
    expect(() =>
      client.validateMagePrepHealth(
        { ...health, volume: { ...health.volume, id_hash: `sha256:${"c".repeat(64)}` } },
        { ...authority, name: "vf_cp06_mage_prep" },
      ),
    ).toThrowError("RUNPOD_MAGE_PREP_HEALTH_UNCONFIRMED");
  });

  it("rejects wrong region, GPU, volume, image, or rate with the created Pod ID", async () => {
    for (const unsafe of [
      { machine: { gpuTypeId: CP06_MAGE_GPU_TYPE_ID, dataCenterId: "US-TX-1", secureCloud: true } },
      {
        machine: {
          gpuTypeId: "NVIDIA A100-SXM4-80GB",
          dataCenterId: CP06_MAGE_DATA_CENTER_ID,
          secureCloud: true,
        },
      },
      { networkVolume: { id: "foreign_volume", size: 50, dataCenterId: CP06_MAGE_DATA_CENTER_ID } },
      { image: `ghcr.io/pala-lakshmansai/foreign@sha256:${"b".repeat(64)}` },
      { adjustedCostPerHr: 0.75 },
    ]) {
      const client = new RunPodPodControlClient({
        apiKey: key,
        fetch: async () => response(pod(unsafe)),
        baseUrl: "http://127.0.0.1:43123",
      });
      await expect(
        client.createMagePod({ ...authority, workerToken: "t".repeat(40) }),
      ).rejects.toMatchObject({
        code: "RUNPOD_MAGE_POD_IDENTITY_UNCONFIRMED",
        resourceId: "pod_cp06_01",
      });
    }
  });

  it("gets, deletes, and confirms exact Pod absence by ID", async () => {
    let deleted = false;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname;
      if (init?.method === "DELETE") {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      expect(path).toBe("/pods/pod_cp06_01");
      expect(url.searchParams.get("includeMachine")).toBe("true");
      expect(url.searchParams.get("includeNetworkVolume")).toBe("true");
      expect(url.searchParams.get("includeTemplate")).toBe("true");
      return deleted ? response({ code: "NOT_FOUND" }, 404) : response(pod());
    });
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(client.getMagePod("pod_cp06_01", authority)).resolves.toMatchObject({
      id: "pod_cp06_01",
    });
    await expect(client.deleteMagePod("pod_cp06_01")).resolves.toBeUndefined();
    await expect(client.confirmMagePodAbsent("pod_cp06_01")).resolves.toBe(true);
    await expect(client.getMagePod("pod_cp06_01", authority)).resolves.toBeNull();
  });

  it("uses a raw mutation ID to poll through ambiguous delete acknowledgement until absence", async () => {
    let reads = 0;
    const sleep = vi.fn(async () => undefined);
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch: async (_input, init) => {
        if (init?.method === "DELETE") throw new Error("acknowledgement lost");
        reads += 1;
        return reads < 3 ? response(pod()) : response({ code: "NOT_FOUND" }, 404);
      },
      sleep,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.deleteMagePodAndConfirmAbsent("pod_cp06_01", {
        maximumAttempts: 4,
        intervalMs: 1,
      }),
    ).resolves.toBeUndefined();
    expect(reads).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("preserves the raw Pod ID when bounded delete absence cannot be proven", async () => {
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch: async (_input, init) =>
        init?.method === "DELETE" ? response(null, 204) : response(pod()),
      sleep: async () => undefined,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.deleteMagePodAndConfirmAbsent("pod_cp06_01", {
        maximumAttempts: 2,
        intervalMs: 0,
      }),
    ).rejects.toMatchObject({
      code: "RUNPOD_MAGE_POD_ABSENCE_UNCONFIRMED",
      resourceId: "pod_cp06_01",
    });
  });

  it("deletes the exact private template and confirms 404 absence", async () => {
    let deleted = false;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/templates/template_cp06_01");
      if (init?.method === "DELETE") {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      return deleted ? response({ code: "NOT_FOUND" }, 404) : response({});
    });
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(client.deleteMagePodTemplate("template_cp06_01")).resolves.toBeUndefined();
    await expect(client.confirmMagePodTemplateAbsent("template_cp06_01")).resolves.toBe(true);
  });

  it("sums official settled Pod billing records for only the exact Pod", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/billing/pods");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        bucketSize: "hour",
        grouping: "podId",
        podId: "pod_cp06_01",
        startTime: "2026-08-14T08:00:00.000Z",
        endTime: "2026-08-14T10:00:00.000Z",
      });
      return response([
        {
          amount: 0.12,
          gpuTypeId: CP06_MAGE_GPU_TYPE_ID,
          podId: "pod_cp06_01",
          time: "2026-08-14T08:00:00.000Z",
          timeBilledMs: 600_000,
        },
        {
          amount: 0.08,
          podId: "pod_cp06_01",
          time: "2026-08-14T09:00:00.000Z",
          timeBilledMs: 400_000,
        },
      ]);
    });
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.settledMagePodBilling(
        "pod_cp06_01",
        "2026-08-14T08:00:00.000Z",
        "2026-08-14T10:00:00.000Z",
      ),
    ).resolves.toEqual({
      podIdHash: "sha256:5c0cbef4df21f93cdc5b917635d1fec8a61c8eb5214426f0d884c5c73f01f8b6",
      recordCount: 2,
      amountUsd: 0.2,
      timeBilledMs: 1_000_000,
      startTime: "2026-08-14T08:00:00.000Z",
      endTime: "2026-08-14T10:00:00.000Z",
    });
  });

  it("rejects foreign Pod billing rows and invalid adoption timestamps", async () => {
    const billingClient = new RunPodPodControlClient({
      apiKey: key,
      fetch: async () => response([{ amount: 0.1, podId: "foreign_pod", timeBilledMs: 1 }]),
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      billingClient.settledMagePodBilling(
        "pod_cp06_01",
        "2026-08-14T08:00:00.000Z",
        "2026-08-14T10:00:00.000Z",
      ),
    ).rejects.toThrowError("RUNPOD_BILLING_RESPONSE_INVALID");

    const podClient = new RunPodPodControlClient({
      apiKey: key,
      fetch: async () => response(pod({ lastStartedAt: "not-an-iso-time" })),
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(podClient.getMagePod("pod_cp06_01", authority)).rejects.toMatchObject({
      code: "RUNPOD_MAGE_POD_IDENTITY_UNCONFIRMED",
      resourceId: "pod_cp06_01",
    });
  });

  it("accepts billing only after repeated identical non-empty observations", async () => {
    const amounts = [0.1, 0.2, 0.2];
    const sleep = vi.fn(async () => undefined);
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch: async () => {
        const amount = amounts.shift() ?? 0.2;
        return response([
          {
            amount,
            gpuTypeId: CP06_MAGE_GPU_TYPE_ID,
            podId: "pod_cp06_01",
            timeBilledMs: amount === 0.1 ? 100_000 : 200_000,
          },
        ]);
      },
      sleep,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.settledMagePodBillingStable(
        "pod_cp06_01",
        "2026-08-14T08:00:00.000Z",
        "2026-08-14T10:00:00.000Z",
        { maximumAttempts: 4, requiredStableObservations: 2, intervalMs: 1 },
      ),
    ).resolves.toMatchObject({ amountUsd: 0.2, recordCount: 1, timeBilledMs: 200_000 });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("fails closed when billing never stabilizes", async () => {
    let amount = 0;
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch: async () => {
        amount += 0.01;
        return response([{ amount, podId: "pod_cp06_01", timeBilledMs: amount * 100_000 }]);
      },
      sleep: async () => undefined,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.settledMagePodBillingStable(
        "pod_cp06_01",
        "2026-08-14T08:00:00.000Z",
        "2026-08-14T10:00:00.000Z",
        { maximumAttempts: 3, requiredStableObservations: 2, intervalMs: 0 },
      ),
    ).rejects.toMatchObject({
      code: "RUNPOD_POD_BILLING_UNSTABLE",
      resourceId: "pod_cp06_01",
    });
  });

  it("maps network ambiguity to a secret-free code", async () => {
    const client = new RunPodPodControlClient({
      apiKey: key,
      fetch: async () => Promise.reject(new Error(key)),
      baseUrl: "http://127.0.0.1:43123",
    });
    let observed: unknown;
    try {
      await client.createMageNetworkVolume("vf_cp06_mage_int8_eu_ro_1_v1");
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(RunPodPodControlError);
    expect(String(observed)).toContain("RUNPOD_POD_MUTATION_AMBIGUOUS");
    expect(String(observed)).not.toContain(key);
  });
});
