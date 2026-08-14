import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CP06_PHASE_B_ACCOUNT_HASH,
  CP06_PHASE_B_ATTEMPTS,
  CP06_PHASE_B_GPU,
  CP06_PHASE_B_REGION,
  CP06_PHASE_B_TEMPLATE_NAME,
  CP06_PHASE_B_VOLUME_NAME,
  Cp06IntentAttemptJournal,
} from "./runpod-mage-cp06-phase-b";
import { RunPodCp06LiveAdapter, persistCp06PhaseBEvidence } from "./runpod-mage-cp06-phase-b-live";
import type { RunPodPodControlClient, RunPodMagePod } from "./runpod-pod-control";

const IMAGE = `ghcr.io/pala-lakshmansai/videoforge-mage-cp06@sha256:${"a".repeat(64)}`;
const MANIFEST = `sha256:${"b".repeat(64)}`;
const hash = (value: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const roots: string[] = [];

const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cp06-live-adapter-"));
  roots.push(root);
  return {
    root,
    journalPath: path.join(root, "journal.jsonl"),
    artifactRoot: path.join(root, "outputs"),
  };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const emptyPodClient = () =>
  ({
    findMageNetworkVolumeByName: async () => null,
    findMagePodTemplateByName: async () => null,
  }) as unknown as RunPodPodControlClient;

describe("CP-06 live adapter provider-free boundary", () => {
  it("parses only the exact observed v2 RTX 4090 catalog shape", async () => {
    const files = await fixture();
    const adapter = new RunPodCp06LiveAdapter({
      apiKey: "k".repeat(32),
      podClient: emptyPodClient(),
      inventoryClient: { inventory: async () => ({}) } as never,
      artifactRoot: files.artifactRoot,
      journalPath: files.journalPath,
      workerImageDigest: IMAGE,
      assertAccount: async () => ({ accountIdHash: CP06_PHASE_B_ACCOUNT_HASH }),
      fetch: async () =>
        new Response(
          JSON.stringify({
            gpus: [
              {
                id: "NVIDIA GeForce RTX 4090",
                name: "RTX 4090",
                pool: "ADA_24",
                manufacturer: "NVIDIA",
                memory: 24,
                secure: true,
                community: true,
                price: { secure: 0.74, community: 0.34 },
                maxCount: { secure: 8, community: 2 },
                availability: "HIGH",
                dataCenters: [{ id: "EU-RO-1", name: "Romania", availability: "HIGH" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(adapter.getOffering(CP06_PHASE_B_GPU, CP06_PHASE_B_REGION)).resolves.toEqual({
      offeringId: CP06_PHASE_B_GPU,
      region: CP06_PHASE_B_REGION,
      secureCloud: true,
      available: true,
      rateUsdPerHour: 0.74,
      gpuMemoryBytes: 24 * 1024 * 1024 * 1024,
    });
  });

  it("proves the exact GHCR digest through an anonymous public-pull token flow", async () => {
    const files = await fixture();
    const calls: { url: string; authorization: string | null }[] = [];
    const digest = IMAGE.split("@")[1] ?? "";
    const adapter = new RunPodCp06LiveAdapter({
      apiKey: "k".repeat(32),
      podClient: emptyPodClient(),
      inventoryClient: { inventory: async () => ({}) } as never,
      artifactRoot: files.artifactRoot,
      journalPath: files.journalPath,
      workerImageDigest: IMAGE,
      assertAccount: async () => ({ accountIdHash: CP06_PHASE_B_ACCOUNT_HASH }),
      fetch: async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        calls.push({ url, authorization: headers.get("authorization") });
        if (url.startsWith("https://ghcr.io/token?")) {
          return new Response(JSON.stringify({ token: "anonymous-public-pull-token" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (headers.get("authorization") === null) {
          return new Response(null, {
            status: 401,
            headers: {
              "www-authenticate":
                'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:pala-lakshmansai/videoforge-mage-cp06:pull"',
            },
          });
        }
        return new Response(null, {
          status: 200,
          headers: { "docker-content-digest": digest },
        });
      },
    });

    await expect(adapter.assertWorkerImagePubliclyPullable(IMAGE)).resolves.toBeUndefined();
    expect(calls).toHaveLength(3);
    expect(calls[0]?.authorization).toBeNull();
    expect(calls[1]?.authorization).toBeNull();
    expect(calls[2]?.authorization).toBe("Bearer anonymous-public-pull-token");
  });

  it("reconstructs an exact open Pod and prep manifest in a fresh process", async () => {
    const files = await fixture();
    let nowIso = "2026-08-14T08:40:00.000Z";
    let generationResponse = new Response(JSON.stringify({ ok: true, result: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const journal = await Cp06IntentAttemptJournal.open(files.journalPath);
    await journal.append("volume_ready", {
      volumeId: "volume_cp06",
      volumeIdHash: hash("volume_cp06"),
    });
    await journal.append("template_ready", { templateId: "template_cp06" });
    await journal.append("stage_complete", { stage: "prep", evidence: MANIFEST });
    await journal.append("pod_create_intent", {
      attemptId: CP06_PHASE_B_ATTEMPTS.positive1.attemptId,
      role: "positive1",
      name: CP06_PHASE_B_ATTEMPTS.positive1.name,
    });
    await journal.append("pod_create_acknowledged", {
      attemptId: CP06_PHASE_B_ATTEMPTS.positive1.attemptId,
      role: "positive1",
      podId: "pod_restarted",
    });
    const providerPod: RunPodMagePod = {
      id: "pod_restarted",
      idHash: hash("pod_restarted"),
      name: CP06_PHASE_B_ATTEMPTS.positive1.name,
      templateId: "template_cp06",
      image: IMAGE,
      networkVolumeIdHash: hash("volume_cp06"),
      dataCenterId: CP06_PHASE_B_REGION,
      gpuTypeId: CP06_PHASE_B_GPU,
      costPerHourUsd: 0.74,
      desiredStatus: "RUNNING",
      lastStartedAt: "2026-08-14T08:30:00.000Z",
    };
    let deleteCalls = 0;
    const podClient = {
      findMageNetworkVolumeByName: async (name: string) =>
        name === CP06_PHASE_B_VOLUME_NAME
          ? { id: "volume_cp06", idHash: hash("volume_cp06") }
          : null,
      findMagePodTemplateByName: async (name: string) =>
        name === CP06_PHASE_B_TEMPLATE_NAME
          ? { id: "template_cp06", idHash: hash("template_cp06") }
          : null,
      listMagePodsByExactName: async () => [providerPod],
      deleteMagePodAndConfirmAbsent: async () => {
        deleteCalls += 1;
      },
      confirmMagePodAbsent: async () => true,
      settledMagePodBillingStable: async (_id: string, startTime: string) => {
        expect(startTime).toBe(providerPod.lastStartedAt);
        return {
          podIdHash: providerPod.idHash,
          recordCount: 1,
          amountUsd: 0.03,
          timeBilledMs: 100_000,
          startTime,
          endTime: "2026-08-14T08:40:00.000Z",
        };
      },
    } as unknown as RunPodPodControlClient;
    const inventoryClient = {
      inventory: async () => ({
        pods: [{ idHash: providerPod.idHash }],
        networkVolumes: [{ idHash: hash("volume_cp06"), sizeGb: 50 }],
        endpoints: [],
        privateTemplateCount: 1,
        runningPodCount: 1,
        activeServerlessWorkerCount: 0,
      }),
    };
    const adapter = new RunPodCp06LiveAdapter({
      apiKey: "k".repeat(32),
      podClient,
      inventoryClient,
      artifactRoot: files.artifactRoot,
      journalPath: files.journalPath,
      workerImageDigest: IMAGE,
      now: () => new Date(nowIso),
      sleep: async () => undefined,
      assertAccount: async () => ({ accountIdHash: CP06_PHASE_B_ACCOUNT_HASH }),
      fetch: async () => generationResponse,
    });

    const inventory = await adapter.inspectInventory();
    expect(inventory.pods).toHaveLength(1);
    expect(inventory.pods[0]).toMatchObject({ podId: "pod_restarted", role: "positive1" });
    await expect(
      adapter.assertSampleSpendAllowed("pod_restarted", {
        reservedCumulativeSpendUsd: 1.2,
        internalStopUsd: 2.7,
        externalCapUsd: 3,
        attemptMaximumRuntimeSeconds: 1_200,
        remainingSampleCount: 4,
        perSampleMaximumSeconds: 120,
      }),
    ).resolves.toBeUndefined();
    nowIso = "2026-08-14T08:43:00.000Z";
    await expect(
      adapter.assertSampleSpendAllowed("pod_restarted", {
        reservedCumulativeSpendUsd: 1.2,
        internalStopUsd: 2.7,
        externalCapUsd: 3,
        attemptMaximumRuntimeSeconds: 1_200,
        remainingSampleCount: 4,
        perSampleMaximumSeconds: 120,
      }),
    ).rejects.toMatchObject({ code: "CP06_SAMPLE_RUNTIME_STOP" });
    nowIso = "2026-08-14T08:40:00.000Z";
    await expect(
      adapter.generateOwnedSample("pod_restarted", {
        sampleId: "cp06-owned-01",
        positivePrompt: "owned prompt",
        negativePrompt: "text",
        seed: 1,
        subjectCategory: "people",
        styleCategory: "documentary",
        cropCategory: "full-16:9",
      }),
    ).rejects.toMatchObject({ code: "CP06_GENERATION_RESULT_REJECTED" });
    generationResponse = new Response(
      JSON.stringify({ error: '{"detail":{"code":"MAGE_COMFY_TRANSPORT_FAILED"}}' }),
      { status: 422, headers: { "content-type": "application/json" } },
    );
    await expect(
      adapter.generateOwnedSample("pod_restarted", {
        sampleId: "cp06-owned-01",
        positivePrompt: "owned prompt",
        negativePrompt: "text",
        seed: 1,
        subjectCategory: "people",
        styleCategory: "documentary",
        cropCategory: "full-16:9",
      }),
    ).rejects.toMatchObject({
      code: "CP06_GENERATION_FAILED_HTTP_422_MAGE_COMFY_TRANSPORT_FAILED",
    });
    await expect(
      readFile(path.join(files.artifactRoot, "generation-failure-response.private.txt"), "utf8"),
    ).resolves.toContain("MAGE_COMFY_TRANSPORT_FAILED");
    await expect(adapter.deletePod("pod_restarted")).resolves.toEqual({
      absenceProven: true,
      settledCostUsd: 0.03,
    });
    expect(deleteCalls).toBe(1);
  });

  it("uses the strict prep-health validator and propagates its exact manifest", async () => {
    const files = await fixture();
    const journal = await Cp06IntentAttemptJournal.open(files.journalPath);
    await journal.append("volume_ready", { volumeId: "volume_cp06" });
    await journal.append("template_ready", { templateId: "template_cp06" });
    await journal.append("pod_create_intent", {
      attemptId: CP06_PHASE_B_ATTEMPTS.prep.attemptId,
      role: "prep",
      name: CP06_PHASE_B_ATTEMPTS.prep.name,
    });
    const providerPod: RunPodMagePod = {
      id: "pod_prep",
      idHash: hash("pod_prep"),
      name: CP06_PHASE_B_ATTEMPTS.prep.name,
      templateId: "template_cp06",
      image: IMAGE,
      networkVolumeIdHash: hash("volume_cp06"),
      dataCenterId: CP06_PHASE_B_REGION,
      gpuTypeId: CP06_PHASE_B_GPU,
      costPerHourUsd: 0.74,
      desiredStatus: "RUNNING",
      lastStartedAt: "2026-08-14T08:30:00.000Z",
    };
    let validationCalls = 0;
    const podClient = {
      findMageNetworkVolumeByName: async () => ({ id: "volume_cp06" }),
      findMagePodTemplateByName: async () => ({ id: "template_cp06" }),
      listMagePodsByExactName: async () => [providerPod],
      validateMagePrepHealth: (candidate: unknown) => {
        validationCalls += 1;
        const value = candidate as { phase?: unknown; volume?: { manifest_sha256?: unknown } };
        if (value.phase !== "ready" || value.volume?.manifest_sha256 !== MANIFEST)
          throw new Error();
        return {
          phase: "ready",
          prepared: true,
          failureCode: null,
          volumeIdHash: hash("volume_cp06"),
          modelBytes: 13_379_919_280,
          manifestSha256: MANIFEST,
        };
      },
    } as unknown as RunPodPodControlClient;
    const adapter = new RunPodCp06LiveAdapter({
      apiKey: "k".repeat(32),
      podClient,
      inventoryClient: { inventory: async () => ({}) } as never,
      artifactRoot: files.artifactRoot,
      journalPath: files.journalPath,
      workerImageDigest: IMAGE,
      now: () => new Date("2026-08-14T08:31:00.000Z"),
      sleep: async () => undefined,
      assertAccount: async () => ({ accountIdHash: CP06_PHASE_B_ACCOUNT_HASH }),
      fetch: async () =>
        new Response(
          JSON.stringify({
            schema_version: "videoforge.mage-volume-preparation/v1",
            process: { status: "ok" },
            phase: "ready",
            failure_code: null,
            model: {},
            volume: { manifest_sha256: MANIFEST },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    await adapter.listPodsByExactName(CP06_PHASE_B_ATTEMPTS.prep.name);
    await expect(adapter.awaitPreparation("pod_prep", 1_800)).resolves.toMatchObject({
      manifestSha256: MANIFEST,
      completedMarkerWritten: true,
    });
    expect(validationCalls).toBe(1);
  });

  it("deletes every strictly matched duplicate exact-name Pod before failing closed", async () => {
    const files = await fixture();
    const pods = ["pod_duplicate_1", "pod_duplicate_2"].map(
      (id): RunPodMagePod => ({
        id,
        idHash: hash(id),
        name: CP06_PHASE_B_ATTEMPTS.positive1.name,
        templateId: "template_cp06",
        image: IMAGE,
        networkVolumeIdHash: hash("volume_cp06"),
        dataCenterId: CP06_PHASE_B_REGION,
        gpuTypeId: CP06_PHASE_B_GPU,
        costPerHourUsd: 0.74,
        desiredStatus: "RUNNING",
        lastStartedAt: "2026-08-14T08:30:00.000Z",
      }),
    );
    const deleted: string[] = [];
    const podClient = {
      findMageNetworkVolumeByName: async () => ({ id: "volume_cp06" }),
      findMagePodTemplateByName: async () => ({ id: "template_cp06" }),
      listMagePodsByExactName: async () => pods,
      deleteMagePodAndConfirmAbsent: async (podId: string) => {
        deleted.push(podId);
      },
      confirmMagePodAbsent: async () => true,
      settledMagePodBillingStable: async () => {
        throw new Error("billing lag");
      },
    } as unknown as RunPodPodControlClient;
    const adapter = new RunPodCp06LiveAdapter({
      apiKey: "k".repeat(32),
      podClient,
      inventoryClient: { inventory: async () => ({}) } as never,
      artifactRoot: files.artifactRoot,
      journalPath: files.journalPath,
      workerImageDigest: IMAGE,
      now: () => new Date("2026-08-14T08:40:00.000Z"),
      sleep: async () => undefined,
      assertAccount: async () => ({ accountIdHash: CP06_PHASE_B_ACCOUNT_HASH }),
    });

    const originalAppend = Cp06IntentAttemptJournal.prototype.append;
    let preDeleteJournalFailed = false;
    const appendSpy = vi
      .spyOn(Cp06IntentAttemptJournal.prototype, "append")
      .mockImplementation(async function (this: Cp06IntentAttemptJournal, event, fields) {
        if (event === "pod_delete_intent" && !preDeleteJournalFailed) {
          preDeleteJournalFailed = true;
          throw new Error("local journal interruption");
        }
        return originalAppend.call(this, event, fields);
      });
    try {
      await expect(
        adapter.listPodsByExactName(CP06_PHASE_B_ATTEMPTS.positive1.name),
      ).rejects.toMatchObject({ code: "CP06_POD_NAME_AMBIGUOUS" });
    } finally {
      appendSpy.mockRestore();
    }
    expect(deleted).toEqual(["pod_duplicate_1", "pod_duplicate_2"]);
    const records = (await readFile(files.journalPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.filter((record) => record.event === "pod_absence_confirmed")).toHaveLength(2);
  });

  it("continues duplicate cleanup after the first exact Pod cannot be proven absent", async () => {
    const files = await fixture();
    const pods = ["pod_unresolved_1", "pod_cleaned_2"].map(
      (id): RunPodMagePod => ({
        id,
        idHash: hash(id),
        name: CP06_PHASE_B_ATTEMPTS.positive1.name,
        templateId: "template_cp06",
        image: IMAGE,
        networkVolumeIdHash: hash("volume_cp06"),
        dataCenterId: CP06_PHASE_B_REGION,
        gpuTypeId: CP06_PHASE_B_GPU,
        costPerHourUsd: 0.74,
        desiredStatus: "RUNNING",
        lastStartedAt: "2026-08-14T08:30:00.000Z",
      }),
    );
    const attempted: string[] = [];
    const podClient = {
      findMageNetworkVolumeByName: async () => ({ id: "volume_cp06" }),
      findMagePodTemplateByName: async () => ({ id: "template_cp06" }),
      listMagePodsByExactName: async () => pods,
      deleteMagePodAndConfirmAbsent: async (podId: string) => {
        attempted.push(podId);
        if (podId === "pod_unresolved_1") throw new Error("absence unproven");
      },
      confirmMagePodAbsent: async () => true,
      settledMagePodBillingStable: async () => {
        throw new Error("billing lag");
      },
    } as unknown as RunPodPodControlClient;
    const adapter = new RunPodCp06LiveAdapter({
      apiKey: "k".repeat(32),
      podClient,
      inventoryClient: { inventory: async () => ({}) } as never,
      artifactRoot: files.artifactRoot,
      journalPath: files.journalPath,
      workerImageDigest: IMAGE,
      now: () => new Date("2026-08-14T08:40:00.000Z"),
      sleep: async () => undefined,
      assertAccount: async () => ({ accountIdHash: CP06_PHASE_B_ACCOUNT_HASH }),
    });

    await expect(
      adapter.listPodsByExactName(CP06_PHASE_B_ATTEMPTS.positive1.name),
    ).rejects.toMatchObject({ code: "CP06_POD_DUPLICATE_CLEANUP_INCOMPLETE" });
    expect(attempted).toEqual(["pod_unresolved_1", "pod_cleaned_2"]);
    const records = (await readFile(files.journalPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.some((record) => record.event === "pod_absence_unknown")).toBe(true);
    expect(
      records.some(
        (record) => record.event === "pod_absence_confirmed" && record.podId === "pod_cleaned_2",
      ),
    ).toBe(true);
  });

  it("persists final evidence idempotently with mode 0600", async () => {
    const files = await fixture();
    const filePath = path.join(files.root, ".videoforge", "cp06-phase-b", "evidence.json");
    const evidence = { schemaVersion: "videoforge.cp06-phase-b-evidence/v1" } as never;

    await persistCp06PhaseBEvidence(filePath, evidence);
    await persistCp06PhaseBEvidence(filePath, evidence);

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(evidence);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });
});
