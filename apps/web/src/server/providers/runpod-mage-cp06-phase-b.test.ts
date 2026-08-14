import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CP06_PHASE_B_ACCOUNT_HASH,
  CP06_PHASE_B_EXTERNAL_CAP_USD,
  CP06_PHASE_B_GPU,
  CP06_PHASE_B_INTERNAL_STOP_USD,
  CP06_PHASE_B_COMFYUI_REVISION,
  CP06_PHASE_B_MODEL_ID,
  CP06_PHASE_B_MODEL_BYTES,
  CP06_PHASE_B_MODEL_REVISION,
  CP06_PHASE_B_REGION,
  CP06_PHASE_B_TEMPLATE_NAME,
  CP06_PHASE_B_VOLUME_NAME,
  CP06_PHASE_B_VOLUME_RATE_USD_PER_GB_MONTH,
  CP06_PHASE_B_VOLUME_SIZE_GB,
  CP06_REPRESENTATIVE_PROMPTS,
  Cp06IntentAttemptJournal,
  Cp06PhaseBError,
  buildCp06PodIntent,
  runCp06MagePhaseB,
  type Cp06ContactSheetResult,
  type Cp06PhaseBConfig,
  type Cp06InventoryObservation,
  type Cp06NegativeBootResult,
  type Cp06PodIntent,
  type Cp06PodNativePort,
  type Cp06PodObservation,
  type Cp06PreparationResult,
  type Cp06ReadyResult,
  type Cp06RepresentativePrompt,
  type Cp06SampleResult,
  type Cp06TemplateObservation,
  type Cp06VolumeObservation,
} from "./runpod-mage-cp06-phase-b";

const IMAGE = `ghcr.io/pala-lakshmansai/videoforge-mage-cp06@sha256:${"a".repeat(64)}`;
const MANIFEST = `sha256:${"b".repeat(64)}` as const;
const hash = (value: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

class FakePodPort implements Cp06PodNativePort {
  readonly calls: string[] = [];
  readonly createdIntents: Cp06PodIntent[] = [];
  readonly deletedPodIds: string[] = [];
  readonly absentPodIds: string[] = [];
  readonly generatedSampleIds: string[] = [];
  readonly pods: Cp06PodObservation[] = [];
  readonly templates: Cp06TemplateObservation[] = [];
  readonly volumes: Cp06VolumeObservation[] = [];
  accountHash = CP06_PHASE_B_ACCOUNT_HASH;
  offeringRate = 0.74;
  failOnSampleId: string | null = null;
  ambiguousCreateRole: Cp06PodIntent["role"] | null = null;
  deleteFailure = false;
  readonly deleteFailurePodIds = new Set<string>();
  billingSettled = true;

  async assertAccountIdentity(): Promise<{ readonly accountIdHash: string }> {
    this.calls.push("account");
    return { accountIdHash: this.accountHash };
  }

  async getOffering(): Promise<{
    readonly offeringId: string;
    readonly region: string;
    readonly secureCloud: boolean;
    readonly available: boolean;
    readonly rateUsdPerHour: number;
    readonly gpuMemoryBytes: number;
  }> {
    this.calls.push("offering");
    return {
      offeringId: CP06_PHASE_B_GPU,
      region: CP06_PHASE_B_REGION,
      secureCloud: true,
      available: true,
      rateUsdPerHour: this.offeringRate,
      gpuMemoryBytes: 24 * 1024 * 1024 * 1024,
    };
  }

  async inspectInventory(): Promise<Cp06InventoryObservation> {
    this.calls.push("inventory");
    return { pods: [...this.pods], volumes: [...this.volumes] };
  }

  async assertWorkerImagePubliclyPullable(): Promise<void> {
    this.calls.push("public-image");
  }

  async reconcileVolumesByExactName(name: string): Promise<readonly Cp06VolumeObservation[]> {
    this.calls.push("reconcile-volume");
    return this.volumes.filter((volume) => volume.name === name);
  }

  async createVolume(): Promise<Cp06VolumeObservation> {
    this.calls.push("create-volume");
    const volume: Cp06VolumeObservation = {
      id: "volume_cp06_50gb",
      name: CP06_PHASE_B_VOLUME_NAME,
      region: CP06_PHASE_B_REGION,
      sizeGb: CP06_PHASE_B_VOLUME_SIZE_GB,
      storageType: "STANDARD",
      rateUsdPerGbMonth: CP06_PHASE_B_VOLUME_RATE_USD_PER_GB_MONTH,
    };
    this.volumes.push(volume);
    return volume;
  }

  async reconcileTemplatesByExactName(name: string): Promise<readonly Cp06TemplateObservation[]> {
    this.calls.push("reconcile-template");
    return this.templates.filter((template) => template.name === name);
  }

  async createPodTemplate(): Promise<Cp06TemplateObservation> {
    this.calls.push("create-template");
    const template: Cp06TemplateObservation = {
      id: `template_cp06_${this.templates.length + 1}`,
      name: CP06_PHASE_B_TEMPLATE_NAME,
      imageDigest: IMAGE,
      isServerless: false,
    };
    this.templates.push(template);
    return template;
  }

  async listPodsByExactName(name: string): Promise<readonly Cp06PodObservation[]> {
    this.calls.push(`list-pod:${name}`);
    return this.pods.filter((pod) => pod.name === name);
  }

  async createPod(intent: Cp06PodIntent): Promise<Cp06PodObservation> {
    this.calls.push(`create-pod:${intent.role}`);
    this.createdIntents.push(intent);
    const pod: Cp06PodObservation = {
      ...intent,
      podId: `pod_${intent.role}_${this.createdIntents.length}`,
    };
    if (this.ambiguousCreateRole === intent.role) {
      this.pods.push(pod);
      throw new Error("response lost");
    }
    this.pods.push(pod);
    return pod;
  }

  async awaitPreparation(): Promise<Cp06PreparationResult> {
    this.calls.push("prepare");
    return {
      phase: "ready",
      prepared: true,
      manifestSha256: MANIFEST,
      modelBytes: CP06_PHASE_B_MODEL_BYTES,
      completedMarkerWritten: true,
    };
  }

  async awaitMissingVolumeBootFailure(podId: string): Promise<Cp06NegativeBootResult> {
    this.calls.push("negative-missing");
    expect(this.pods.find((pod) => pod.podId === podId)).toMatchObject({
      role: "negativeMissing",
      volumeId: null,
      volumeMountPath: null,
    });
    return {
      bootSucceeded: false,
      modelStatus: "error",
      failureCode: "MAGE_VOLUME_MARKER_INVALID",
      registryAccessAllowed: false,
      downloadedModelBytes: 0,
    };
  }

  async awaitWrongVolumeHashBootFailure(podId: string): Promise<Cp06NegativeBootResult> {
    this.calls.push("negative-wrong-hash");
    const pod = this.pods.find((candidate) => candidate.podId === podId);
    expect(pod?.volumeId).toBe("volume_cp06_50gb");
    expect(pod?.environment.VIDEOFORGE_MAGE_VOLUME_ID_HASH).not.toBe(hash("volume_cp06_50gb"));
    return {
      bootSucceeded: false,
      modelStatus: "error",
      failureCode: "MAGE_VOLUME_ID_MISMATCH",
      registryAccessAllowed: false,
      downloadedModelBytes: 0,
    };
  }

  async awaitModelReady(): Promise<Cp06ReadyResult> {
    this.calls.push("ready");
    return {
      manifestSha256: MANIFEST,
      registryAccessAllowed: false,
      downloadedModelBytes: 0,
      modelReadyMs: 93_000,
      peakVramBytes: 20_000_000_000,
    };
  }

  async assertSampleSpendAllowed(): Promise<void> {
    this.calls.push("sample-spend-guard");
  }

  async generateOwnedSample(
    _podId: string,
    prompt: Cp06RepresentativePrompt,
  ): Promise<Cp06SampleResult> {
    this.calls.push(`sample:${prompt.sampleId}`);
    this.generatedSampleIds.push(prompt.sampleId);
    if (this.failOnSampleId === prompt.sampleId) throw new Error("inference interrupted");
    return {
      sampleId: prompt.sampleId,
      outputObjectKey: `private/cp06/${prompt.sampleId}.png`,
      outputSha256: hash(`output:${prompt.sampleId}`),
      bytes: 100_000,
      width: 1280,
      height: 720,
      mediaType: "image/png",
      positivePromptSha256: hash(prompt.positivePrompt),
      negativePromptSha256: hash(prompt.negativePrompt),
      inferenceMs: 5_000,
      uploadMs: 800,
      peakVramBytes: 20_000_000_000,
    };
  }

  async createContactSheet(samples: readonly Cp06SampleResult[]): Promise<Cp06ContactSheetResult> {
    this.calls.push("contact-sheet");
    return {
      outputObjectKey: "private/cp06/contact-sheet.png",
      outputSha256: hash("contact-sheet"),
      bytes: 200_000,
      mediaType: "image/png",
      sampleIds: samples.map((sample) => sample.sampleId),
    };
  }

  async accruedPodCostUpperBound(): Promise<number> {
    return 0.021;
  }

  async deletePod(podId: string): Promise<{
    readonly absenceProven: true;
    readonly settledCostUsd: number | null;
  }> {
    this.calls.push(`delete-pod:${podId}`);
    if (this.deleteFailure || this.deleteFailurePodIds.has(podId)) {
      throw new Error("delete response lost");
    }
    this.deletedPodIds.push(podId);
    const index = this.pods.findIndex((pod) => pod.podId === podId);
    if (index >= 0) this.pods.splice(index, 1);
    return { absenceProven: true, settledCostUsd: this.billingSettled ? 0.02 : null };
  }

  async confirmPodAbsent(podId: string): Promise<void> {
    this.calls.push(`absent-pod:${podId}`);
    if (this.pods.some((pod) => pod.podId === podId)) throw new Error("still present");
    this.absentPodIds.push(podId);
  }

  async deletePodTemplate(templateId: string): Promise<void> {
    this.calls.push(`delete-template:${templateId}`);
    const index = this.templates.findIndex((template) => template.id === templateId);
    if (index >= 0) this.templates.splice(index, 1);
  }

  async confirmPodTemplateAbsent(templateId: string): Promise<void> {
    this.calls.push(`absent-template:${templateId}`);
    if (this.templates.some((template) => template.id === templateId)) {
      throw new Error("template still present");
    }
  }
}

const roots: string[] = [];
const fixture = async (): Promise<{ root: string; journalPath: string }> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "videoforge-cp06-"));
  roots.push(root);
  return { root, journalPath: path.join(root, ".videoforge", "cp06", "journal.jsonl") };
};
const config = (journalPath: string): Cp06PhaseBConfig => ({
  workerImageDigest: IMAGE,
  journalPath,
  externalCapUsd: CP06_PHASE_B_EXTERNAL_CAP_USD,
  internalStopUsd: CP06_PHASE_B_INTERNAL_STOP_USD,
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CP-06 Phase B Pod orchestrator", () => {
  it("reserves one maximum runtime for repeated intents of the same logical attempt", async () => {
    const { journalPath } = await fixture();
    const journal = await Cp06IntentAttemptJournal.open(journalPath);
    for (let index = 0; index < 5; index += 1) {
      await journal.append("pod_create_intent", {
        attemptId: "vf-9-24q-cp06-prep-a01",
        reservationMicroUsd: 370_000,
      });
    }
    expect(journal.accountedCostMicroUsd()).toBe(370_000);
  });

  it("runs exact prep, two fail-closed negatives, and eight samples split 4+4 over fresh Pods", async () => {
    const { journalPath } = await fixture();
    const port = new FakePodPort();
    port.ambiguousCreateRole = "prep";

    const evidence = await runCp06MagePhaseB(port, config(journalPath));

    expect(evidence).toMatchObject({
      status: "READY_FOR_USER_REVIEW",
      accountIdHash: CP06_PHASE_B_ACCOUNT_HASH,
      gpu: CP06_PHASE_B_GPU,
      region: CP06_PHASE_B_REGION,
      settledSpendUsd: 0.1,
      budgetAccountedSpendUsd: 1.110002,
      zeroPodsProven: true,
      volume: {
        name: CP06_PHASE_B_VOLUME_NAME,
        sizeGb: 50,
        ongoingUsdPerMonth: 3.5,
        manifestSha256: MANIFEST,
      },
    });
    expect(port.createdIntents.map((intent) => intent.role)).toEqual([
      "prep",
      "negativeMissing",
      "negativeWrongHash",
      "positive1",
      "positive2",
    ]);
    expect(port.calls.indexOf("public-image")).toBeGreaterThan(port.calls.indexOf("inventory"));
    expect(port.calls.indexOf("public-image")).toBeLessThan(port.calls.indexOf("create-volume"));
    expect(port.createdIntents[0]?.entrypointOverride).toEqual([
      "python",
      "/opt/videoforge/mage_prepare_service.py",
    ]);
    expect(port.createdIntents[0]?.environment).toMatchObject({
      MAGE_MODEL_ROOT: "/workspace/mage-model",
      VIDEOFORGE_MAGE_VOLUME_ID: "volume_cp06_50gb",
      VIDEOFORGE_MAGE_DOWNLOAD_CONFIRMATION: "DOWNLOAD_EXACT_VIDEOFORGE_MAGE_INT8",
    });
    expect(port.createdIntents.slice(3).map((intent) => intent.environment)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          HF_HUB_OFFLINE: "1",
          TRANSFORMERS_OFFLINE: "1",
          DIFFUSERS_OFFLINE: "1",
        }),
      ]),
    );
    expect(evidence.samples.map((sample) => sample.podAttemptId)).toEqual([
      ...Array<string>(4).fill("vf-9-24q-cp06-positive-a01"),
      ...Array<string>(4).fill("vf-9-24q-cp06-positive-a02"),
    ]);
    expect(evidence.samples.map((sample) => sample.sampleId)).toEqual(
      CP06_REPRESENTATIVE_PROMPTS.map((prompt) => prompt.sampleId),
    );
    expect(new Set(evidence.samples.map((sample) => sample.podIdHash)).size).toBe(2);
    expect(port.calls.filter((call) => call === "sample-spend-guard")).toHaveLength(8);
    expect(evidence.model).toEqual({
      id: CP06_PHASE_B_MODEL_ID,
      revision: CP06_PHASE_B_MODEL_REVISION,
      precision: "int8-convrot",
      comfyUiRevision: CP06_PHASE_B_COMFYUI_REVISION,
    });
    expect(evidence.positivePodReadiness).toEqual([
      expect.objectContaining({
        modelReadyMs: 93_000,
        readyPeakVramBytes: 20_000_000_000,
        measurementStatus: "measured",
      }),
      expect.objectContaining({
        modelReadyMs: 93_000,
        readyPeakVramBytes: 20_000_000_000,
        measurementStatus: "measured",
      }),
    ]);
    expect(evidence.attempts.every((attempt) => attempt.timingStatus === "measured")).toBe(true);
    expect(
      evidence.attempts.every((attempt) => attempt.createMs !== null && attempt.deleteMs !== null),
    ).toBe(true);
    expect(port.pods).toEqual([]);
    expect(port.templates).toEqual([]);
    expect(port.volumes).toHaveLength(1);
    expect(port.deletedPodIds).toHaveLength(5);
    expect(port.absentPodIds).toEqual(port.deletedPodIds);

    const journalMode = (await stat(journalPath)).mode & 0o777;
    expect(journalMode).toBe(0o600);
    const journal = await readFile(journalPath, "utf8");
    expect(journal).not.toContain(CP06_REPRESENTATIVE_PROMPTS[0]?.positivePrompt);
    expect(JSON.stringify(evidence)).not.toContain("pod_positive");
    expect(JSON.stringify(evidence)).not.toContain("?");
  });

  it("deletes and proves absence in finally when positive inference fails", async () => {
    const { journalPath } = await fixture();
    const port = new FakePodPort();
    port.failOnSampleId = "cp06-owned-05";

    await expect(runCp06MagePhaseB(port, config(journalPath))).rejects.toThrow(
      "inference interrupted",
    );
    expect(port.pods).toEqual([]);
    expect(port.deletedPodIds.at(-1)).toContain("positive2");
    expect(port.absentPodIds).toEqual(port.deletedPodIds);
  });

  it("resumes from completed stages after restart and reruns only the interrupted four-sample Pod", async () => {
    const { journalPath } = await fixture();
    const port = new FakePodPort();
    port.failOnSampleId = "cp06-owned-05";
    await expect(runCp06MagePhaseB(port, config(journalPath))).rejects.toThrow();
    port.failOnSampleId = null;

    const evidence = await runCp06MagePhaseB(port, config(journalPath));

    expect(evidence.samples).toHaveLength(8);
    expect(port.createdIntents.filter((intent) => intent.role === "prep")).toHaveLength(1);
    expect(port.createdIntents.filter((intent) => intent.role === "negativeMissing")).toHaveLength(
      1,
    );
    expect(
      port.createdIntents.filter((intent) => intent.role === "negativeWrongHash"),
    ).toHaveLength(1);
    expect(port.createdIntents.filter((intent) => intent.role === "positive1")).toHaveLength(1);
    expect(port.createdIntents.filter((intent) => intent.role === "positive2")).toHaveLength(2);
    expect(port.pods).toEqual([]);
  });

  it("revalidates resumed sample evidence and rejects a tampered completed batch", async () => {
    const { journalPath } = await fixture();
    const port = new FakePodPort();
    port.failOnSampleId = "cp06-owned-05";
    await expect(runCp06MagePhaseB(port, config(journalPath))).rejects.toThrow();
    const records = (await readFile(journalPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const positive = records.find(
      (record) => record.event === "stage_complete" && record.stage === "positive1",
    );
    const samples = positive?.evidence as Record<string, unknown>[];
    if (samples[0]) samples[0].seed = -1;
    await writeFile(journalPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    port.failOnSampleId = null;

    await expect(runCp06MagePhaseB(port, config(journalPath))).rejects.toMatchObject({
      code: "CP06_SAMPLE_EVIDENCE_INVALID",
    });
  });

  it("reasserts Sujal identity and zero-compute inventory before accepting a prior handoff", async () => {
    const { journalPath } = await fixture();
    const port = new FakePodPort();
    await runCp06MagePhaseB(port, config(journalPath));
    port.calls.length = 0;

    await runCp06MagePhaseB(port, config(journalPath));

    expect(port.calls.slice(0, 3)).toEqual(["account", "offering", "inventory"]);
    expect(port.calls).not.toContain("create-volume");
  });

  it("hydrates legacy completed evidence without fabricating unavailable ready metrics", async () => {
    const { journalPath } = await fixture();
    const port = new FakePodPort();
    await runCp06MagePhaseB(port, config(journalPath));
    const records = (await readFile(journalPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record.event !== "model_ready_confirmed");
    const handoff = records.find((record) => record.event === "handoff_complete");
    const legacyEvidence = handoff?.evidence as Record<string, unknown>;
    delete legacyEvidence.model;
    delete legacyEvidence.positivePodReadiness;
    for (const attempt of legacyEvidence.attempts as Record<string, unknown>[]) {
      delete attempt.createMs;
      delete attempt.deleteMs;
      delete attempt.timingStatus;
    }
    records.forEach((record, index) => {
      record.sequence = index + 1;
    });
    await writeFile(journalPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    port.calls.length = 0;

    const evidence = await runCp06MagePhaseB(port, config(journalPath));

    expect(evidence.model.revision).toBe(CP06_PHASE_B_MODEL_REVISION);
    expect(evidence.positivePodReadiness).toEqual([
      expect.objectContaining({
        modelReadyMs: null,
        readyPeakVramBytes: null,
        measurementStatus: "unavailable_legacy_journal",
      }),
      expect.objectContaining({
        modelReadyMs: null,
        readyPeakVramBytes: null,
        measurementStatus: "unavailable_legacy_journal",
      }),
    ]);
    expect(evidence.attempts.every((attempt) => attempt.timingStatus === "measured")).toBe(true);
    expect(port.calls.slice(0, 3)).toEqual(["account", "offering", "inventory"]);
  });

  it("records conservative cost and completes cleanup when provider billing lags", async () => {
    const { journalPath } = await fixture();
    const port = new FakePodPort();
    port.billingSettled = false;

    const evidence = await runCp06MagePhaseB(port, config(journalPath));

    expect(evidence.settledSpendUsd).toBeNull();
    expect(evidence.attempts.every((attempt) => attempt.costBasis === "conservative_elapsed")).toBe(
      true,
    );
    expect(evidence.budgetAccountedSpendUsd).toBe(1.110002);
    expect(port.pods).toEqual([]);
  });

  it("cleans an exact stale owned Pod before any resumed mutation", async () => {
    const { journalPath } = await fixture();
    const port = new FakePodPort();
    await port.createVolume();
    const template = await port.createPodTemplate();
    const stale: Cp06PodObservation = {
      attemptId: "vf-9-24q-cp06-positive-a01",
      name: "videoforge-mage-cp06-positive-a01",
      role: "positive1",
      imageDigest: IMAGE,
      templateId: template.id,
      volumeId: port.volumes[0]?.id ?? "missing",
      volumeMountPath: "/workspace",
      region: CP06_PHASE_B_REGION,
      gpuOfferingId: CP06_PHASE_B_GPU,
      gpuCount: 1,
      rateCeilingUsdPerHour: 0.74,
      maximumRuntimeSeconds: 1_200,
      environment: {
        VIDEOFORGE_CP06_ATTEMPT_ID: "vf-9-24q-cp06-positive-a01",
        VIDEOFORGE_MAGE_VOLUME_ID_HASH: hash("volume_cp06_50gb"),
        VIDEOFORGE_MAGE_MODEL_REVISION: "d8c99241f6fa80fbd453014234af2bf337ea21e6",
        VIDEOFORGE_MAGE_COMFYUI_REVISION: "26d7f8556822d9d08c2d3e1878636ac3b4969af9",
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        DIFFUSERS_OFFLINE: "1",
      },
      entrypointOverride: null,
      podId: "pod_stale_exact",
    };
    port.pods.push(stale);

    await runCp06MagePhaseB(port, config(journalPath));

    expect(port.calls.indexOf("delete-pod:pod_stale_exact")).toBeLessThan(
      port.calls.indexOf("reconcile-volume"),
    );
    expect(port.pods).toEqual([]);
  });

  it("attempts every validated restart Pod even when the first cleanup is unresolved", async () => {
    const { journalPath } = await fixture();
    const port = new FakePodPort();
    const volume = await port.createVolume();
    const template = await port.createPodTemplate();
    const first: Cp06PodObservation = {
      ...buildCp06PodIntent("positive1", IMAGE, template.id, volume.id),
      podId: "pod_restart_unresolved_1",
    };
    const second: Cp06PodObservation = {
      ...buildCp06PodIntent("positive2", IMAGE, template.id, volume.id),
      podId: "pod_restart_cleaned_2",
    };
    port.pods.push(first, second);
    port.deleteFailurePodIds.add(first.podId);
    port.calls.length = 0;

    await expect(runCp06MagePhaseB(port, config(journalPath))).rejects.toMatchObject({
      code: "CP06_RESTART_POD_CLEANUP_INCOMPLETE",
    });

    expect(port.calls).toContain(`delete-pod:${first.podId}`);
    expect(port.calls).toContain(`delete-pod:${second.podId}`);
    expect(port.absentPodIds).toContain(second.podId);
    expect(port.pods.map((pod) => pod.podId)).toEqual([first.podId]);
  });

  it("fails before mutation on account, rate, or authority drift", async () => {
    const first = await fixture();
    const wrongAccount = new FakePodPort();
    wrongAccount.accountHash = `sha256:${"0".repeat(64)}`;
    await expect(runCp06MagePhaseB(wrongAccount, config(first.journalPath))).rejects.toMatchObject({
      code: "CP06_ACCOUNT_NOT_SUJAL",
    });
    expect(wrongAccount.calls).toEqual(["account"]);

    const second = await fixture();
    const highRate = new FakePodPort();
    highRate.offeringRate = 0.740_001;
    await expect(runCp06MagePhaseB(highRate, config(second.journalPath))).rejects.toMatchObject({
      code: "CP06_OFFERING_DRIFT",
    });
    expect(highRate.calls).toEqual(["account", "offering"]);

    const third = await fixture();
    const invalidConfig = new FakePodPort();
    await expect(
      runCp06MagePhaseB(invalidConfig, {
        ...config(third.journalPath),
        externalCapUsd: 3.01,
      } as unknown as Cp06PhaseBConfig),
    ).rejects.toMatchObject({ code: "CP06_AUTHORITY_CONFIG_INVALID" });
    expect(invalidConfig.calls).toEqual([]);
  });

  it("enforces the conservative $2.70 internal stop before creating another Pod", async () => {
    const { journalPath } = await fixture();
    const journal = await Cp06IntentAttemptJournal.open(journalPath);
    await journal.append("pod_absence_confirmed", {
      attemptId: "historical_cp06_exact",
      role: "prep",
      podId: "historical_pod",
      podIdHash: hash("historical_pod"),
      settledCostMicroUsd: 2_600_000,
    });
    const port = new FakePodPort();

    await expect(runCp06MagePhaseB(port, config(journalPath))).rejects.toMatchObject({
      code: "CP06_INTERNAL_SPEND_STOP",
    });
    expect(port.createdIntents).toEqual([]);
    expect(port.calls).not.toContain("create-volume");
    expect(port.calls).not.toContain("create-template");
  });

  it("does not claim cleanup when exact Pod deletion is ambiguous", async () => {
    const { journalPath } = await fixture();
    const port = new FakePodPort();
    port.deleteFailure = true;

    await expect(runCp06MagePhaseB(port, config(journalPath))).rejects.toMatchObject({
      code: "CP06_POD_DELETE_AMBIGUOUS",
    });
    expect(port.pods).toHaveLength(1);
    const records = (await readFile(journalPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.at(-1)).toMatchObject({ event: "pod_delete_ack_unknown" });
    expect(records.some((record) => record.event === "handoff_complete")).toBe(false);
  });

  it("deletes and proves absence even when the pre-delete journal intent cannot be persisted", async () => {
    const { journalPath } = await fixture();
    const port = new FakePodPort();
    const originalAppend = Cp06IntentAttemptJournal.prototype.append;
    let failed = false;
    const appendSpy = vi
      .spyOn(Cp06IntentAttemptJournal.prototype, "append")
      .mockImplementation(async function (this: Cp06IntentAttemptJournal, event, fields) {
        if (event === "pod_delete_intent" && !failed) {
          failed = true;
          throw new Error("journal unavailable");
        }
        return originalAppend.call(this, event, fields);
      });
    try {
      await expect(runCp06MagePhaseB(port, config(journalPath))).rejects.toMatchObject({
        code: "CP06_POD_CLEANUP_EVIDENCE_INCOMPLETE",
      });
    } finally {
      appendSpy.mockRestore();
    }

    expect(port.deletedPodIds).toHaveLength(1);
    expect(port.absentPodIds).toEqual(port.deletedPodIds);
    expect(port.pods).toEqual([]);
    const records = (await readFile(journalPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.some((record) => record.event === "pod_absence_confirmed")).toBe(true);
  });

  it("does not repeat volume or template creation after an unresolved prior create intent", async () => {
    const volumeFixture = await fixture();
    const volumeJournal = await Cp06IntentAttemptJournal.open(volumeFixture.journalPath);
    await volumeJournal.append("volume_create_intent", {
      name: CP06_PHASE_B_VOLUME_NAME,
      sizeGb: CP06_PHASE_B_VOLUME_SIZE_GB,
    });
    const volumePort = new FakePodPort();

    await expect(
      runCp06MagePhaseB(volumePort, config(volumeFixture.journalPath)),
    ).rejects.toMatchObject({ code: "CP06_VOLUME_CREATE_AMBIGUOUS" });
    expect(volumePort.calls).not.toContain("create-volume");

    const templateFixture = await fixture();
    const templateJournal = await Cp06IntentAttemptJournal.open(templateFixture.journalPath);
    await templateJournal.append("template_create_intent", {
      name: CP06_PHASE_B_TEMPLATE_NAME,
      imageDigest: IMAGE,
    });
    const templatePort = new FakePodPort();
    await templatePort.createVolume();
    templatePort.calls.length = 0;

    await expect(
      runCp06MagePhaseB(templatePort, config(templateFixture.journalPath)),
    ).rejects.toMatchObject({ code: "CP06_TEMPLATE_CREATE_AMBIGUOUS" });
    expect(templatePort.calls).not.toContain("create-template");
  });

  it("rejects unsafe journal symlinks", async () => {
    const { root } = await fixture();
    const file = path.join(root, "real.jsonl");
    const target = path.join(root, "journal.jsonl");
    await Cp06IntentAttemptJournal.open(file);
    const { symlink } = await import("node:fs/promises");
    await symlink(file, target);

    await expect(Cp06IntentAttemptJournal.open(target)).rejects.toBeInstanceOf(Cp06PhaseBError);
  });
});
