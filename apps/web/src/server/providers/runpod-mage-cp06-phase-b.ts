import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

export const CP06_PHASE_B_ACCOUNT_HASH =
  "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c";
export const CP06_PHASE_B_GPU = "NVIDIA GeForce RTX 4090";
export const CP06_PHASE_B_REGION = "EU-RO-1";
export const CP06_PHASE_B_RATE_CEILING_USD = 0.74;
export const CP06_PHASE_B_EXTERNAL_CAP_USD = 3;
export const CP06_PHASE_B_INTERNAL_STOP_USD = 2.7;
export const CP06_PHASE_B_SAMPLE_TIMEOUT_SECONDS = 120;
export const CP06_PHASE_B_VOLUME_SIZE_GB = 50;
export const CP06_PHASE_B_VOLUME_RATE_USD_PER_GB_MONTH = 0.07;
export const CP06_PHASE_B_VOLUME_NAME = "videoforge-mage-cp06-model-volume-eu-ro-1-50gb";
export const CP06_PHASE_B_TEMPLATE_NAME = "videoforge-mage-cp06-template";
export const CP06_PHASE_B_MODEL_ID = "Comfy-Org/Mage-Flow";
export const CP06_PHASE_B_MODEL_REVISION = "d8c99241f6fa80fbd453014234af2bf337ea21e6";
export const CP06_PHASE_B_COMFYUI_REVISION = "26d7f8556822d9d08c2d3e1878636ac3b4969af9";
export const CP06_PHASE_B_MODEL_BYTES = 13_379_919_280;

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const IMAGE = /^ghcr\.io\/pala-lakshmansai\/videoforge-mage-cp06@sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u;
const SAFE_OBJECT_KEY = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9/_.-]{0,1023}$/u;
const PREP_CONFIRMATION = "DOWNLOAD_EXACT_VIDEOFORGE_MAGE_INT8";
const MAGE_VOLUME_ROOT = "/workspace/mage-model";
const JOURNAL_SCHEMA = "videoforge.cp06-phase-b-journal/v1";
const EVIDENCE_SCHEMA = "videoforge.cp06-phase-b-evidence/v1";

export const CP06_PHASE_B_ATTEMPTS = {
  prep: {
    attemptId: "vf-9-24q-cp06-prep-a01",
    name: "videoforge-mage-cp06-prep-a01",
    maximumRuntimeSeconds: 1_800,
  },
  negativeMissing: {
    attemptId: "vf-9-24q-cp06-negative-missing-a01",
    name: "videoforge-mage-cp06-negative-missing-a01",
    maximumRuntimeSeconds: 600,
  },
  negativeWrongHash: {
    attemptId: "vf-9-24q-cp06-negative-wrong-hash-a01",
    name: "videoforge-mage-cp06-negative-wrong-hash-a01",
    maximumRuntimeSeconds: 600,
  },
  positive1: {
    attemptId: "vf-9-24q-cp06-positive-a01",
    name: "videoforge-mage-cp06-positive-a01",
    maximumRuntimeSeconds: 1_200,
  },
  positive2: {
    attemptId: "vf-9-24q-cp06-positive-a02",
    name: "videoforge-mage-cp06-positive-a02",
    maximumRuntimeSeconds: 1_200,
  },
} as const;

type AttemptRole = keyof typeof CP06_PHASE_B_ATTEMPTS;
type Hash = `sha256:${string}`;

export class Cp06PhaseBError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "Cp06PhaseBError";
  }
}

export interface Cp06RepresentativePrompt {
  readonly sampleId: string;
  readonly positivePrompt: string;
  readonly negativePrompt: string;
  readonly seed: number;
  readonly subjectCategory: "people" | "place" | "object" | "detail";
  readonly styleCategory: "documentary" | "editorial" | "natural-light" | "cinematic-realism";
  readonly cropCategory: "full-16:9" | "split-right-8:9";
}

export const CP06_REPRESENTATIVE_PROMPTS: readonly Cp06RepresentativePrompt[] = Object.freeze([
  {
    sampleId: "cp06-owned-01",
    positivePrompt:
      "Authentic documentary photograph of a multigenerational family loading grocery bags into a car, natural parking-lot light, candid human gestures, realistic skin and fabric, center-safe 16:9 composition, no readable signs.",
    negativePrompt:
      "text, captions, logos, watermark, illustration, duplicate people, malformed anatomy",
    seed: 20_260_601,
    subjectCategory: "people",
    styleCategory: "documentary",
    cropCategory: "full-16:9",
  },
  {
    sampleId: "cp06-owned-02",
    positivePrompt:
      "Editorial photojournalism of a coastal fishing harbor before sunrise, working boats and wet timber docks, believable weather, restrained colors, strong depth, center-safe 16:9 framing, no visible lettering.",
    negativePrompt:
      "text, captions, logos, watermark, fantasy art, oversaturation, malformed structures",
    seed: 20_260_602,
    subjectCategory: "place",
    styleCategory: "editorial",
    cropCategory: "full-16:9",
  },
  {
    sampleId: "cp06-owned-03",
    positivePrompt:
      "Natural-light photograph of worn hand tools on a practical workshop bench, subtle dust and use marks, honest material texture, object grouped in the right half for an 8:9 crop, no labels or readable marks.",
    negativePrompt:
      "text, captions, logos, watermark, product render, plastic texture, impossible geometry",
    seed: 20_260_603,
    subjectCategory: "object",
    styleCategory: "natural-light",
    cropCategory: "split-right-8:9",
  },
  {
    sampleId: "cp06-owned-04",
    positivePrompt:
      "Cinematic realistic close detail of rain collecting on a farmer's weathered gloves beside fresh soil, soft overcast light, physically plausible moisture and texture, detail held in the right panel, no text.",
    negativePrompt:
      "text, captions, logos, watermark, painting, artificial glow, malformed fingers",
    seed: 20_260_604,
    subjectCategory: "detail",
    styleCategory: "cinematic-realism",
    cropCategory: "split-right-8:9",
  },
  {
    sampleId: "cp06-owned-05",
    positivePrompt:
      "Authentic documentary photograph of nurses preparing a quiet rural clinic room, candid working posture, practical fluorescent and window light, realistic equipment, center-safe 16:9 composition, no readable screens.",
    negativePrompt:
      "text, captions, logos, watermark, staged advertising, duplicate people, malformed hands",
    seed: 20_260_605,
    subjectCategory: "people",
    styleCategory: "documentary",
    cropCategory: "full-16:9",
  },
  {
    sampleId: "cp06-owned-06",
    positivePrompt:
      "Editorial photograph of a small railway platform in winter fog, commuters at natural scale, subdued practical lighting, believable architecture and atmosphere, center-safe wide composition, no readable signage.",
    negativePrompt:
      "text, captions, logos, watermark, concept art, dramatic fantasy fog, warped tracks",
    seed: 20_260_606,
    subjectCategory: "place",
    styleCategory: "editorial",
    cropCategory: "full-16:9",
  },
  {
    sampleId: "cp06-owned-07",
    positivePrompt:
      "Natural-light photograph of a repaired ceramic bowl and simple sewing supplies on a lived-in table, real wear and soft shadows, main objects composed for the right-hand 8:9 panel, no printed words.",
    negativePrompt:
      "text, captions, logos, watermark, catalog render, glossy plastic, floating objects",
    seed: 20_260_607,
    subjectCategory: "object",
    styleCategory: "natural-light",
    cropCategory: "split-right-8:9",
  },
  {
    sampleId: "cp06-owned-08",
    positivePrompt:
      "Cinematic realistic close detail of an old map being folded by weathered hands beside a train window, restrained daylight, tactile paper and skin, action framed in the right panel, no legible map labels.",
    negativePrompt:
      "text, captions, logos, watermark, illustration, glowing edges, malformed fingers",
    seed: 20_260_608,
    subjectCategory: "detail",
    styleCategory: "cinematic-realism",
    cropCategory: "split-right-8:9",
  },
]);

export interface Cp06OfferingObservation {
  readonly offeringId: string;
  readonly region: string;
  readonly secureCloud: boolean;
  readonly available: boolean;
  readonly rateUsdPerHour: number;
  readonly gpuMemoryBytes: number;
}

export interface Cp06VolumeObservation {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly sizeGb: number;
  readonly storageType: "STANDARD";
  readonly rateUsdPerGbMonth: number;
}

export interface Cp06TemplateObservation {
  readonly id: string;
  readonly name: string;
  readonly imageDigest: string;
  readonly isServerless: false;
}

export interface Cp06PodIntent {
  readonly attemptId: string;
  readonly name: string;
  readonly role: AttemptRole;
  readonly imageDigest: string;
  readonly templateId: string;
  readonly volumeId: string | null;
  readonly volumeMountPath: "/workspace" | null;
  readonly region: typeof CP06_PHASE_B_REGION;
  readonly gpuOfferingId: typeof CP06_PHASE_B_GPU;
  readonly gpuCount: 1;
  readonly rateCeilingUsdPerHour: typeof CP06_PHASE_B_RATE_CEILING_USD;
  readonly maximumRuntimeSeconds: number;
  readonly environment: Readonly<Record<string, string>>;
  readonly entrypointOverride: readonly string[] | null;
}

export interface Cp06PodObservation extends Cp06PodIntent {
  readonly podId: string;
}

export interface Cp06InventoryObservation {
  readonly pods: readonly Cp06PodObservation[];
  readonly volumes: readonly Cp06VolumeObservation[];
}

export interface Cp06PreparationResult {
  readonly phase: "ready";
  readonly prepared: true;
  readonly manifestSha256: Hash;
  readonly modelBytes: number;
  readonly completedMarkerWritten: true;
}

export interface Cp06NegativeBootResult {
  readonly bootSucceeded: false;
  readonly modelStatus: "error";
  readonly failureCode: "MAGE_VOLUME_MARKER_INVALID" | "MAGE_VOLUME_ID_MISMATCH";
  readonly registryAccessAllowed: false;
  readonly downloadedModelBytes: 0;
}

export interface Cp06ReadyResult {
  readonly manifestSha256: Hash;
  readonly registryAccessAllowed: false;
  readonly downloadedModelBytes: 0;
  readonly modelReadyMs: number;
  readonly peakVramBytes: number;
}

export interface Cp06SampleResult {
  readonly sampleId: string;
  readonly outputObjectKey: string;
  readonly outputSha256: Hash;
  readonly bytes: number;
  readonly width: 1280;
  readonly height: 720;
  readonly mediaType: "image/png";
  readonly positivePromptSha256: Hash;
  readonly negativePromptSha256: Hash;
  readonly inferenceMs: number;
  readonly uploadMs: number;
  readonly peakVramBytes: number;
}

export interface Cp06ContactSheetResult {
  readonly outputObjectKey: string;
  readonly outputSha256: Hash;
  readonly bytes: number;
  readonly mediaType: "image/png";
  readonly sampleIds: readonly string[];
}

export interface Cp06PodNativePort {
  assertAccountIdentity(expectedAccountIdHash: string): Promise<{ readonly accountIdHash: string }>;
  getOffering(offeringId: string, region: string): Promise<Cp06OfferingObservation>;
  inspectInventory(): Promise<Cp06InventoryObservation>;
  assertWorkerImagePubliclyPullable(imageDigest: string): Promise<void>;
  reconcileVolumesByExactName(name: string): Promise<readonly Cp06VolumeObservation[]>;
  createVolume(input: {
    readonly name: typeof CP06_PHASE_B_VOLUME_NAME;
    readonly region: typeof CP06_PHASE_B_REGION;
    readonly sizeGb: typeof CP06_PHASE_B_VOLUME_SIZE_GB;
    readonly storageType: "STANDARD";
    readonly rateUsdPerGbMonth: typeof CP06_PHASE_B_VOLUME_RATE_USD_PER_GB_MONTH;
  }): Promise<Cp06VolumeObservation>;
  reconcileTemplatesByExactName(
    name: string,
    imageDigest: string,
  ): Promise<readonly Cp06TemplateObservation[]>;
  createPodTemplate(input: {
    readonly name: typeof CP06_PHASE_B_TEMPLATE_NAME;
    readonly imageDigest: string;
    readonly isServerless: false;
  }): Promise<Cp06TemplateObservation>;
  listPodsByExactName(name: string): Promise<readonly Cp06PodObservation[]>;
  createPod(intent: Cp06PodIntent): Promise<Cp06PodObservation>;
  awaitPreparation(podId: string, maximumRuntimeSeconds: number): Promise<Cp06PreparationResult>;
  awaitMissingVolumeBootFailure(
    podId: string,
    maximumRuntimeSeconds: number,
  ): Promise<Cp06NegativeBootResult>;
  awaitWrongVolumeHashBootFailure(
    podId: string,
    maximumRuntimeSeconds: number,
  ): Promise<Cp06NegativeBootResult>;
  awaitModelReady(podId: string, maximumRuntimeSeconds: number): Promise<Cp06ReadyResult>;
  assertSampleSpendAllowed(
    podId: string,
    input: {
      readonly reservedCumulativeSpendUsd: number;
      readonly internalStopUsd: typeof CP06_PHASE_B_INTERNAL_STOP_USD;
      readonly externalCapUsd: typeof CP06_PHASE_B_EXTERNAL_CAP_USD;
      readonly attemptMaximumRuntimeSeconds: number;
      readonly remainingSampleCount: number;
      readonly perSampleMaximumSeconds: typeof CP06_PHASE_B_SAMPLE_TIMEOUT_SECONDS;
    },
  ): Promise<void>;
  generateOwnedSample(podId: string, prompt: Cp06RepresentativePrompt): Promise<Cp06SampleResult>;
  createContactSheet(samples: readonly Cp06SampleResult[]): Promise<Cp06ContactSheetResult>;
  accruedPodCostUpperBound(
    podId: string,
    maximumRuntimeSeconds: number,
    rateUsdPerHour: number,
  ): Promise<number>;
  deletePod(podId: string): Promise<{
    readonly absenceProven: true;
    readonly settledCostUsd: number | null;
  }>;
  confirmPodAbsent(podId: string): Promise<void>;
  deletePodTemplate(templateId: string): Promise<void>;
  confirmPodTemplateAbsent(templateId: string): Promise<void>;
}

export interface Cp06PhaseBConfig {
  readonly workerImageDigest: string;
  readonly journalPath: string;
  readonly externalCapUsd: typeof CP06_PHASE_B_EXTERNAL_CAP_USD;
  readonly internalStopUsd: typeof CP06_PHASE_B_INTERNAL_STOP_USD;
}

interface JournalRecord {
  readonly schema: typeof JOURNAL_SCHEMA;
  readonly sequence: number;
  readonly at: string;
  readonly event: string;
  readonly [key: string]: unknown;
}

export interface Cp06SanitizedSampleEvidence {
  readonly sampleId: string;
  readonly subjectCategory: Cp06RepresentativePrompt["subjectCategory"];
  readonly styleCategory: Cp06RepresentativePrompt["styleCategory"];
  readonly cropCategory: Cp06RepresentativePrompt["cropCategory"];
  readonly seed: number;
  readonly positivePromptSha256: Hash;
  readonly negativePromptSha256: Hash;
  readonly outputObjectKey: string;
  readonly outputSha256: Hash;
  readonly bytes: number;
  readonly width: 1280;
  readonly height: 720;
  readonly inferenceMs: number;
  readonly uploadMs: number;
  readonly peakVramBytes: number;
  readonly podAttemptId: string;
  readonly podIdHash: Hash;
}

export interface Cp06PhaseBEvidence {
  readonly schemaVersion: typeof EVIDENCE_SCHEMA;
  readonly status: "READY_FOR_USER_REVIEW";
  readonly accountIdHash: typeof CP06_PHASE_B_ACCOUNT_HASH;
  readonly workerImageDigest: string;
  readonly gpu: typeof CP06_PHASE_B_GPU;
  readonly region: typeof CP06_PHASE_B_REGION;
  readonly rateUsdPerHour: number;
  readonly model: {
    readonly id: typeof CP06_PHASE_B_MODEL_ID;
    readonly revision: typeof CP06_PHASE_B_MODEL_REVISION;
    readonly precision: "int8-convrot";
    readonly comfyUiRevision: typeof CP06_PHASE_B_COMFYUI_REVISION;
  };
  readonly volume: {
    readonly idHash: Hash;
    readonly name: typeof CP06_PHASE_B_VOLUME_NAME;
    readonly sizeGb: typeof CP06_PHASE_B_VOLUME_SIZE_GB;
    readonly rateUsdPerGbMonth: typeof CP06_PHASE_B_VOLUME_RATE_USD_PER_GB_MONTH;
    readonly ongoingUsdPerMonth: 3.5;
    readonly manifestSha256: Hash;
  };
  readonly attempts: readonly {
    readonly attemptId: string;
    readonly role: AttemptRole;
    readonly podIdHash: Hash;
    readonly accountedCostUsd: number;
    readonly settledCostUsd: number | null;
    readonly costBasis: "settled" | "conservative_elapsed";
    readonly createMs: number | null;
    readonly deleteMs: number | null;
    readonly timingStatus: "measured" | "unavailable_legacy_journal";
  }[];
  readonly positivePodReadiness: readonly {
    readonly attemptId: string;
    readonly podIdHash: Hash;
    readonly modelReadyMs: number | null;
    readonly readyPeakVramBytes: number | null;
    readonly measurementStatus: "measured" | "unavailable_legacy_journal";
  }[];
  readonly samples: readonly Cp06SanitizedSampleEvidence[];
  readonly contactSheet: Cp06ContactSheetResult;
  readonly budgetAccountedSpendUsd: number;
  readonly settledSpendUsd: number | null;
  readonly finiteCapUsd: typeof CP06_PHASE_B_EXTERNAL_CAP_USD;
  readonly internalStopUsd: typeof CP06_PHASE_B_INTERNAL_STOP_USD;
  readonly zeroPodsProven: true;
}

const sha256 = (value: string): Hash =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

const usdToMicro = (value: number, code: string): number => {
  const micro = Math.ceil(value * 1_000_000);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(micro)) {
    throw new Cp06PhaseBError(code);
  }
  return micro;
};

const assertSafeObjectKey = (value: string): void => {
  if (!SAFE_OBJECT_KEY.test(value) || value.includes("?") || value.includes(":")) {
    throw new Cp06PhaseBError("CP06_OUTPUT_KEY_UNSAFE");
  }
};

const assertExactPod = (observed: Cp06PodObservation, expected: Cp06PodIntent): void => {
  const actual = JSON.stringify({
    attemptId: observed.attemptId,
    name: observed.name,
    role: observed.role,
    imageDigest: observed.imageDigest,
    templateId: observed.templateId,
    volumeId: observed.volumeId,
    volumeMountPath: observed.volumeMountPath,
    region: observed.region,
    gpuOfferingId: observed.gpuOfferingId,
    gpuCount: observed.gpuCount,
    rateCeilingUsdPerHour: observed.rateCeilingUsdPerHour,
    maximumRuntimeSeconds: observed.maximumRuntimeSeconds,
    environment: observed.environment,
    entrypointOverride: observed.entrypointOverride,
  });
  if (!SAFE_ID.test(observed.podId) || actual !== JSON.stringify(expected)) {
    throw new Cp06PhaseBError("CP06_POD_IDENTITY_MISMATCH");
  }
};

export class Cp06IntentAttemptJournal {
  private records: JournalRecord[] = [];

  private constructor(
    readonly filePath: string,
    private readonly now: () => Date,
  ) {}

  static async open(
    filePath: string,
    now: () => Date = () => new Date(),
  ): Promise<Cp06IntentAttemptJournal> {
    if (!path.isAbsolute(filePath)) throw new Cp06PhaseBError("CP06_JOURNAL_PATH_NOT_ABSOLUTE");
    const parent = path.dirname(filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await chmod(parent, 0o700);
    try {
      const stat = await lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Cp06PhaseBError("CP06_JOURNAL_PATH_UNSAFE");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const handle = await open(filePath, "a", 0o600);
    await handle.chmod(0o600);
    await handle.close();
    const journal = new Cp06IntentAttemptJournal(filePath, now);
    const body = await readFile(filePath, "utf8");
    if (body.length > 16 * 1024 * 1024) throw new Cp06PhaseBError("CP06_JOURNAL_TOO_LARGE");
    const lines = body.split("\n").filter(Boolean);
    journal.records = lines.map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Cp06PhaseBError("CP06_JOURNAL_INVALID");
      }
      if (
        !value ||
        typeof value !== "object" ||
        (value as JournalRecord).schema !== JOURNAL_SCHEMA ||
        (value as JournalRecord).sequence !== index + 1
      ) {
        throw new Cp06PhaseBError("CP06_JOURNAL_INVALID");
      }
      return value as JournalRecord;
    });
    return journal;
  }

  all(): readonly JournalRecord[] {
    return this.records;
  }

  has(event: string, predicate: (record: JournalRecord) => boolean = () => true): boolean {
    return this.records.some((record) => record.event === event && predicate(record));
  }

  last(event: string): JournalRecord | null {
    return [...this.records].reverse().find((record) => record.event === event) ?? null;
  }

  accountedCostMicroUsd(): number {
    const perAttemptReservation = new Map<string, number>();
    for (const record of this.records) {
      if (record.event !== "pod_create_intent") continue;
      const attemptKey = String(record.attemptId ?? `sequence:${record.sequence}`);
      const reservation = Number(record.reservationMicroUsd ?? 0);
      perAttemptReservation.set(
        attemptKey,
        Math.max(perAttemptReservation.get(attemptKey) ?? 0, reservation),
      );
    }
    const reserved = [...perAttemptReservation.values()].reduce((sum, cost) => sum + cost, 0);
    const perPod = new Map<string, number>();
    for (const record of this.records) {
      if (record.event !== "pod_delete_intent" && record.event !== "pod_absence_confirmed")
        continue;
      const podKey = String(record.podIdHash ?? record.podId ?? "");
      if (podKey.length === 0) continue;
      const cost = Number(record.accountedCostMicroUsd ?? record.settledCostMicroUsd ?? 0);
      perPod.set(podKey, Math.max(perPod.get(podKey) ?? 0, cost));
    }
    const observed = [...perPod.values()].reduce((sum, cost) => sum + cost, 0);
    return Math.max(reserved, observed);
  }

  async append(event: string, fields: Readonly<Record<string, unknown>> = {}): Promise<void> {
    const record: JournalRecord = {
      schema: JOURNAL_SCHEMA,
      sequence: this.records.length + 1,
      at: this.now().toISOString(),
      event,
      ...fields,
    };
    const handle = await open(this.filePath, "a", 0o600);
    try {
      await handle.chmod(0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.records.push(record);
  }
}

const exactAttemptFor = (observed: Cp06PodObservation): AttemptRole | null =>
  (Object.entries(CP06_PHASE_B_ATTEMPTS).find(
    ([, attempt]) => attempt.attemptId === observed.attemptId && attempt.name === observed.name,
  )?.[0] as AttemptRole | undefined) ?? null;

const assertRestartPodSafeToDelete = (
  observed: Cp06PodObservation,
  role: AttemptRole,
  workerImageDigest: string,
): void => {
  if (
    observed.role !== role ||
    observed.imageDigest !== workerImageDigest ||
    observed.region !== CP06_PHASE_B_REGION ||
    observed.gpuOfferingId !== CP06_PHASE_B_GPU ||
    observed.gpuCount !== 1 ||
    observed.rateCeilingUsdPerHour !== CP06_PHASE_B_RATE_CEILING_USD ||
    !SAFE_ID.test(observed.podId) ||
    !SAFE_ID.test(observed.templateId) ||
    (role === "negativeMissing"
      ? observed.volumeId !== null || observed.volumeMountPath !== null
      : observed.volumeId === null ||
        !SAFE_ID.test(observed.volumeId) ||
        observed.volumeMountPath !== "/workspace")
  ) {
    throw new Cp06PhaseBError("CP06_RESTART_POD_IDENTITY_MISMATCH");
  }
};

const assertOffering = (offering: Cp06OfferingObservation): void => {
  if (
    offering.offeringId !== CP06_PHASE_B_GPU ||
    offering.region !== CP06_PHASE_B_REGION ||
    offering.secureCloud !== true ||
    offering.available !== true ||
    !Number.isFinite(offering.rateUsdPerHour) ||
    offering.rateUsdPerHour < 0 ||
    offering.rateUsdPerHour > CP06_PHASE_B_RATE_CEILING_USD ||
    offering.gpuMemoryBytes < 24 * 1024 * 1024 * 1024
  ) {
    throw new Cp06PhaseBError("CP06_OFFERING_DRIFT");
  }
};

const assertVolume = (volume: Cp06VolumeObservation): void => {
  if (
    !SAFE_ID.test(volume.id) ||
    volume.name !== CP06_PHASE_B_VOLUME_NAME ||
    volume.region !== CP06_PHASE_B_REGION ||
    volume.sizeGb !== CP06_PHASE_B_VOLUME_SIZE_GB ||
    volume.storageType !== "STANDARD" ||
    volume.rateUsdPerGbMonth !== CP06_PHASE_B_VOLUME_RATE_USD_PER_GB_MONTH
  ) {
    throw new Cp06PhaseBError("CP06_VOLUME_IDENTITY_MISMATCH");
  }
};

export const buildCp06PodIntent = (
  role: AttemptRole,
  imageDigest: string,
  templateId: string,
  volumeId: string,
): Cp06PodIntent => {
  const attempt = CP06_PHASE_B_ATTEMPTS[role];
  const environment: Record<string, string> = {
    VIDEOFORGE_CP06_ATTEMPT_ID: attempt.attemptId,
    VIDEOFORGE_MAGE_VOLUME_ID_HASH: sha256(volumeId),
    VIDEOFORGE_MAGE_MODEL_REVISION: CP06_PHASE_B_MODEL_REVISION,
    VIDEOFORGE_MAGE_COMFYUI_REVISION: CP06_PHASE_B_COMFYUI_REVISION,
  };
  let entrypointOverride: readonly string[] | null = null;
  if (role === "prep") {
    Object.assign(environment, {
      MAGE_MODEL_ROOT: MAGE_VOLUME_ROOT,
      VIDEOFORGE_MAGE_VOLUME_ID: volumeId,
      VIDEOFORGE_MAGE_DOWNLOAD_CONFIRMATION: PREP_CONFIRMATION,
    });
    entrypointOverride = ["python", "/opt/videoforge/mage_prepare_service.py"];
  } else {
    Object.assign(environment, {
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
      DIFFUSERS_OFFLINE: "1",
    });
    if (role === "negativeWrongHash") {
      environment.VIDEOFORGE_MAGE_VOLUME_ID_HASH = sha256(
        "videoforge-mage-cp06-deliberately-wrong-volume",
      );
    }
  }
  return Object.freeze({
    attemptId: attempt.attemptId,
    name: attempt.name,
    role,
    imageDigest,
    templateId,
    volumeId: role === "negativeMissing" ? null : volumeId,
    volumeMountPath: role === "negativeMissing" ? null : "/workspace",
    region: CP06_PHASE_B_REGION,
    gpuOfferingId: CP06_PHASE_B_GPU,
    gpuCount: 1,
    rateCeilingUsdPerHour: CP06_PHASE_B_RATE_CEILING_USD,
    maximumRuntimeSeconds: attempt.maximumRuntimeSeconds,
    environment: Object.freeze(environment),
    entrypointOverride,
  });
};

const assertBudgetForAttempt = (
  journal: Cp06IntentAttemptJournal,
  maximumRuntimeSeconds: number,
  rateUsdPerHour: number,
): void => {
  const reservationMicro = usdToMicro(
    (maximumRuntimeSeconds / 3_600) * rateUsdPerHour,
    "CP06_BUDGET_INVALID",
  );
  const internalStopMicro = usdToMicro(CP06_PHASE_B_INTERNAL_STOP_USD, "CP06_BUDGET_INVALID");
  const externalCapMicro = usdToMicro(CP06_PHASE_B_EXTERNAL_CAP_USD, "CP06_BUDGET_INVALID");
  if (
    journal.accountedCostMicroUsd() + reservationMicro > internalStopMicro ||
    journal.accountedCostMicroUsd() + reservationMicro > externalCapMicro
  ) {
    throw new Cp06PhaseBError("CP06_INTERNAL_SPEND_STOP");
  }
};

const assertBudgetForRemainingPlan = (
  journal: Cp06IntentAttemptJournal,
  rateUsdPerHour: number,
): void => {
  const remainingSeconds = (
    Object.entries(CP06_PHASE_B_ATTEMPTS) as [
      AttemptRole,
      (typeof CP06_PHASE_B_ATTEMPTS)[AttemptRole],
    ][]
  )
    .filter(([role]) => !journal.has("stage_complete", (record) => record.stage === role))
    .reduce((sum, [, attempt]) => sum + attempt.maximumRuntimeSeconds, 0);
  const remainingMicro = usdToMicro(
    (remainingSeconds / 3_600) * rateUsdPerHour,
    "CP06_BUDGET_INVALID",
  );
  if (
    journal.accountedCostMicroUsd() + remainingMicro >
      usdToMicro(CP06_PHASE_B_INTERNAL_STOP_USD, "CP06_BUDGET_INVALID") ||
    journal.accountedCostMicroUsd() + remainingMicro >
      usdToMicro(CP06_PHASE_B_EXTERNAL_CAP_USD, "CP06_BUDGET_INVALID")
  ) {
    throw new Cp06PhaseBError("CP06_INTERNAL_SPEND_STOP");
  }
};

const cleanupPod = async (
  port: Cp06PodNativePort,
  journal: Cp06IntentAttemptJournal,
  pod: Cp06PodObservation,
): Promise<void> => {
  const accruedCostUsd = await port.accruedPodCostUpperBound(
    pod.podId,
    pod.maximumRuntimeSeconds,
    pod.rateCeilingUsdPerHour,
  );
  const accruedCostMicroUsd = usdToMicro(accruedCostUsd, "CP06_ACCRUED_COST_INVALID");
  let preDeleteIntentPersistenceFailed = false;
  try {
    await journal.append("pod_delete_intent", {
      attemptId: pod.attemptId,
      podId: pod.podId,
      podIdHash: sha256(pod.podId),
      accountedCostMicroUsd: accruedCostMicroUsd,
    });
  } catch {
    preDeleteIntentPersistenceFailed = true;
  }
  let deletion: Awaited<ReturnType<Cp06PodNativePort["deletePod"]>>;
  try {
    deletion = await port.deletePod(pod.podId);
  } catch {
    await journal.append("pod_delete_ack_unknown", {
      attemptId: pod.attemptId,
      podId: pod.podId,
    });
    throw new Cp06PhaseBError("CP06_POD_DELETE_AMBIGUOUS");
  }
  if (deletion.absenceProven !== true) {
    throw new Cp06PhaseBError("CP06_POD_ABSENCE_UNPROVEN");
  }
  const settledCostMicroUsd =
    deletion.settledCostUsd === null
      ? null
      : usdToMicro(deletion.settledCostUsd, "CP06_SETTLED_COST_INVALID");
  const accountedCostMicroUsd = Math.max(accruedCostMicroUsd, settledCostMicroUsd ?? 0);
  try {
    await port.confirmPodAbsent(pod.podId);
  } catch {
    await journal.append("pod_absence_unknown", {
      attemptId: pod.attemptId,
      podId: pod.podId,
      accountedCostMicroUsd,
      settledCostMicroUsd,
    });
    throw new Cp06PhaseBError("CP06_POD_ABSENCE_UNPROVEN");
  }
  await journal.append("pod_absence_confirmed", {
    attemptId: pod.attemptId,
    role: pod.role,
    podId: pod.podId,
    podIdHash: sha256(pod.podId),
    accountedCostMicroUsd,
    settledCostMicroUsd,
    costBasis:
      settledCostMicroUsd !== null && settledCostMicroUsd >= accruedCostMicroUsd
        ? "settled"
        : "conservative_elapsed",
  });
  if (preDeleteIntentPersistenceFailed) {
    throw new Cp06PhaseBError("CP06_POD_CLEANUP_EVIDENCE_INCOMPLETE");
  }
};

const runPodStage = async <T>(
  role: AttemptRole,
  port: Cp06PodNativePort,
  journal: Cp06IntentAttemptJournal,
  imageDigest: string,
  templateId: string,
  volumeId: string,
  rateUsdPerHour: number,
  work: (pod: Cp06PodObservation, intent: Cp06PodIntent) => Promise<T>,
): Promise<T> => {
  const intent = buildCp06PodIntent(role, imageDigest, templateId, volumeId);
  assertBudgetForAttempt(journal, intent.maximumRuntimeSeconds, rateUsdPerHour);
  await journal.append("pod_create_intent", {
    attemptId: intent.attemptId,
    role,
    name: intent.name,
    maximumRuntimeSeconds: intent.maximumRuntimeSeconds,
    reservationMicroUsd: usdToMicro(
      (intent.maximumRuntimeSeconds / 3_600) * rateUsdPerHour,
      "CP06_BUDGET_INVALID",
    ),
  });
  let pod: Cp06PodObservation | null = null;
  let podIdentityVerified = false;
  let result!: T;
  let workError: unknown = null;
  try {
    const existing = await port.listPodsByExactName(intent.name);
    if (existing.length > 1) throw new Cp06PhaseBError("CP06_POD_CREATE_AMBIGUOUS");
    if (existing.length === 1) {
      pod = existing[0] ?? null;
    } else {
      try {
        pod = await port.createPod(intent);
      } catch (createError) {
        const recovered = await port.listPodsByExactName(intent.name);
        if (recovered.length !== 1) {
          const definiteProviderRejection =
            createError !== null &&
            typeof createError === "object" &&
            "code" in createError &&
            (createError.code === "RUNPOD_POD_MUTATION_FAILED" ||
              createError.code === "RUNPOD_MAGE_POD_IDENTITY_REJECTED_AND_DELETED");
          if (recovered.length === 0 && definiteProviderRejection) throw createError;
          throw new Cp06PhaseBError("CP06_POD_CREATE_AMBIGUOUS");
        }
        pod = recovered[0] ?? null;
      }
    }
    if (pod === null) throw new Cp06PhaseBError("CP06_POD_CREATE_AMBIGUOUS");
    assertExactPod(pod, intent);
    podIdentityVerified = true;
    await journal.append("pod_create_acknowledged", {
      attemptId: intent.attemptId,
      role,
      podId: pod.podId,
      podIdHash: sha256(pod.podId),
    });
    result = await work(pod, intent);
  } catch (error) {
    workError = error;
  }
  let cleanupError: unknown = null;
  if (pod !== null && podIdentityVerified) {
    try {
      await cleanupPod(port, journal, pod);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (cleanupError !== null) throw cleanupError;
  if (workError !== null) throw workError;
  return result;
};

const assertSample = (sample: Cp06SampleResult, prompt: Cp06RepresentativePrompt): void => {
  assertSafeObjectKey(sample.outputObjectKey);
  if (
    sample.sampleId !== prompt.sampleId ||
    !SHA256.test(sample.outputSha256) ||
    !SHA256.test(sample.positivePromptSha256) ||
    !SHA256.test(sample.negativePromptSha256) ||
    sample.positivePromptSha256 !== sha256(prompt.positivePrompt) ||
    sample.negativePromptSha256 !== sha256(prompt.negativePrompt) ||
    !Number.isSafeInteger(sample.bytes) ||
    sample.bytes < 45 ||
    sample.width !== 1280 ||
    sample.height !== 720 ||
    sample.mediaType !== "image/png" ||
    !Number.isSafeInteger(sample.inferenceMs) ||
    sample.inferenceMs < 1 ||
    !Number.isSafeInteger(sample.uploadMs) ||
    sample.uploadMs < 0 ||
    !Number.isSafeInteger(sample.peakVramBytes) ||
    sample.peakVramBytes < 1
  ) {
    throw new Cp06PhaseBError("CP06_SAMPLE_EVIDENCE_INVALID");
  }
};

const sampleEvidence = (
  prompt: Cp06RepresentativePrompt,
  sample: Cp06SampleResult,
  podAttemptId: string,
  podIdHash: Hash,
): Cp06SanitizedSampleEvidence => ({
  sampleId: prompt.sampleId,
  subjectCategory: prompt.subjectCategory,
  styleCategory: prompt.styleCategory,
  cropCategory: prompt.cropCategory,
  seed: prompt.seed,
  positivePromptSha256: sample.positivePromptSha256,
  negativePromptSha256: sample.negativePromptSha256,
  outputObjectKey: sample.outputObjectKey,
  outputSha256: sample.outputSha256,
  bytes: sample.bytes,
  width: sample.width,
  height: sample.height,
  inferenceMs: sample.inferenceMs,
  uploadMs: sample.uploadMs,
  peakVramBytes: sample.peakVramBytes,
  podAttemptId,
  podIdHash,
});

const assertSanitizedSampleEvidence = (
  sample: Cp06SanitizedSampleEvidence,
  prompt: Cp06RepresentativePrompt,
  attemptId: string,
): void => {
  assertSafeObjectKey(sample.outputObjectKey);
  if (
    sample.sampleId !== prompt.sampleId ||
    sample.subjectCategory !== prompt.subjectCategory ||
    sample.styleCategory !== prompt.styleCategory ||
    sample.cropCategory !== prompt.cropCategory ||
    sample.seed !== prompt.seed ||
    sample.positivePromptSha256 !== sha256(prompt.positivePrompt) ||
    sample.negativePromptSha256 !== sha256(prompt.negativePrompt) ||
    !SHA256.test(sample.outputSha256) ||
    !Number.isSafeInteger(sample.bytes) ||
    sample.bytes < 45 ||
    sample.width !== 1280 ||
    sample.height !== 720 ||
    !Number.isSafeInteger(sample.inferenceMs) ||
    sample.inferenceMs < 1 ||
    !Number.isSafeInteger(sample.uploadMs) ||
    sample.uploadMs < 0 ||
    !Number.isSafeInteger(sample.peakVramBytes) ||
    sample.peakVramBytes < 1 ||
    sample.podAttemptId !== attemptId ||
    !SHA256.test(sample.podIdHash)
  ) {
    throw new Cp06PhaseBError("CP06_SAMPLE_EVIDENCE_INVALID");
  }
};

const assertSampleMatrix = (samples: readonly Cp06SanitizedSampleEvidence[]): void => {
  if (samples.length !== CP06_REPRESENTATIVE_PROMPTS.length) {
    throw new Cp06PhaseBError("CP06_SAMPLE_MATRIX_INCOMPLETE");
  }
  for (const [index, prompt] of CP06_REPRESENTATIVE_PROMPTS.entries()) {
    const sample = samples[index];
    if (sample === undefined) throw new Cp06PhaseBError("CP06_SAMPLE_MATRIX_INCOMPLETE");
    const attemptId =
      index < 4
        ? CP06_PHASE_B_ATTEMPTS.positive1.attemptId
        : CP06_PHASE_B_ATTEMPTS.positive2.attemptId;
    assertSanitizedSampleEvidence(sample, prompt, attemptId);
  }
  const firstHashes = new Set(samples.slice(0, 4).map((sample) => sample.podIdHash));
  const secondHashes = new Set(samples.slice(4, 8).map((sample) => sample.podIdHash));
  if (
    firstHashes.size !== 1 ||
    secondHashes.size !== 1 ||
    firstHashes.values().next().value === secondHashes.values().next().value
  ) {
    throw new Cp06PhaseBError("CP06_POSITIVE_PODS_NOT_DISTINCT");
  }
};

const futureRuntimeSecondsAfter = (role: "positive1" | "positive2"): number =>
  role === "positive1" ? CP06_PHASE_B_ATTEMPTS.positive2.maximumRuntimeSeconds : 0;

const journalStageEvidence = (journal: Cp06IntentAttemptJournal, stage: string): unknown =>
  [...journal.all()]
    .reverse()
    .find((record) => record.event === "stage_complete" && record.stage === stage)?.evidence;

const journalStageEvidenceInCurrentTemplateEpoch = (
  journal: Cp06IntentAttemptJournal,
  stage: string,
): unknown => {
  const templateReady = [...journal.all()]
    .reverse()
    .find((record) => record.event === "template_ready");
  if (templateReady === undefined) return undefined;
  return [...journal.all()]
    .reverse()
    .find(
      (record) =>
        record.event === "stage_complete" &&
        record.stage === stage &&
        record.sequence > templateReady.sequence,
    )?.evidence;
};

const journalDurationMs = (start: JournalRecord | undefined, end: JournalRecord): number | null => {
  if (start === undefined) return null;
  const startMs = new Date(start.at).getTime();
  const endMs = new Date(end.at).getTime();
  const duration = endMs - startMs;
  return Number.isSafeInteger(duration) && duration >= 0 ? duration : null;
};

const attemptEvidenceFromJournal = (
  journal: Cp06IntentAttemptJournal,
): Cp06PhaseBEvidence["attempts"] => {
  const records = journal.all();
  return records
    .map((record, absenceIndex) => ({ record, absenceIndex }))
    .filter(({ record }) => record.event === "pod_absence_confirmed")
    .map(({ record, absenceIndex }) => {
      const preceding = records.slice(0, absenceIndex + 1);
      const acknowledged = [...preceding]
        .reverse()
        .find(
          (candidate) =>
            candidate.event === "pod_create_acknowledged" && candidate.podId === record.podId,
        );
      const createIntent = [...preceding]
        .reverse()
        .find(
          (candidate) =>
            candidate.event === "pod_create_intent" &&
            candidate.attemptId === record.attemptId &&
            candidate.sequence < (acknowledged?.sequence ?? Number.POSITIVE_INFINITY),
        );
      const deleteIntent = [...preceding]
        .reverse()
        .find(
          (candidate) =>
            candidate.event === "pod_delete_intent" && candidate.podId === record.podId,
        );
      const createMs = acknowledged ? journalDurationMs(createIntent, acknowledged) : null;
      const deleteMs = journalDurationMs(deleteIntent, record);
      const settledCostMicroUsd =
        record.settledCostMicroUsd === null || record.settledCostMicroUsd === undefined
          ? null
          : Number(record.settledCostMicroUsd);
      return {
        attemptId: String(record.attemptId),
        role: record.role as AttemptRole,
        podIdHash: String(record.podIdHash) as Hash,
        accountedCostUsd:
          Number(record.accountedCostMicroUsd ?? record.settledCostMicroUsd ?? 0) / 1_000_000,
        settledCostUsd: settledCostMicroUsd === null ? null : settledCostMicroUsd / 1_000_000,
        costBasis: (record.costBasis ??
          (settledCostMicroUsd === null ? "conservative_elapsed" : "settled")) as
          | "settled"
          | "conservative_elapsed",
        createMs,
        deleteMs,
        timingStatus:
          createMs === null || deleteMs === null ? "unavailable_legacy_journal" : "measured",
      } as const;
    })
    .filter(
      (attempt, index, attempts) =>
        attempts.findIndex((candidate) => candidate.podIdHash === attempt.podIdHash) === index,
    );
};

const readinessEvidenceFromJournal = (
  journal: Cp06IntentAttemptJournal,
  samples: readonly Cp06SanitizedSampleEvidence[],
): Cp06PhaseBEvidence["positivePodReadiness"] =>
  (["positive1", "positive2"] as const).map((role, index) => {
    const podIdHash = samples[index * 4]?.podIdHash;
    if (!podIdHash) throw new Cp06PhaseBError("CP06_SAMPLE_MATRIX_INCOMPLETE");
    const ready = [...journal.all()]
      .reverse()
      .find(
        (record) =>
          record.event === "model_ready_confirmed" &&
          record.attemptId === CP06_PHASE_B_ATTEMPTS[role].attemptId &&
          record.podIdHash === podIdHash,
      );
    const modelReadyMs = Number(ready?.modelReadyMs);
    const readyPeakVramBytes = Number(ready?.readyPeakVramBytes);
    const measured =
      ready !== undefined &&
      Number.isSafeInteger(modelReadyMs) &&
      modelReadyMs > 0 &&
      Number.isSafeInteger(readyPeakVramBytes) &&
      readyPeakVramBytes > 0;
    return {
      attemptId: CP06_PHASE_B_ATTEMPTS[role].attemptId,
      podIdHash,
      modelReadyMs: measured ? modelReadyMs : null,
      readyPeakVramBytes: measured ? readyPeakVramBytes : null,
      measurementStatus: measured ? "measured" : "unavailable_legacy_journal",
    } as const;
  });

const enrichEvidenceFromJournal = (
  evidence: Omit<Cp06PhaseBEvidence, "model" | "attempts" | "positivePodReadiness"> &
    Partial<Pick<Cp06PhaseBEvidence, "model" | "attempts" | "positivePodReadiness">>,
  journal: Cp06IntentAttemptJournal,
): Cp06PhaseBEvidence => ({
  ...evidence,
  model: {
    id: CP06_PHASE_B_MODEL_ID,
    revision: CP06_PHASE_B_MODEL_REVISION,
    precision: "int8-convrot",
    comfyUiRevision: CP06_PHASE_B_COMFYUI_REVISION,
  },
  attempts: attemptEvidenceFromJournal(journal),
  positivePodReadiness: readinessEvidenceFromJournal(journal, evidence.samples),
});

const hasUnresolvedCreateIntent = (
  journal: Cp06IntentAttemptJournal,
  intentEvent: string,
  resolvedEvent: string,
): boolean => {
  const records = journal.all();
  let intentIndex = -1;
  let resolvedIndex = -1;
  records.forEach((record, index) => {
    if (record.event === intentEvent) intentIndex = index;
    if (record.event === resolvedEvent) resolvedIndex = index;
  });
  return intentIndex > resolvedIndex;
};

const assertCompletedHandoff = (
  value: unknown,
  config: Cp06PhaseBConfig,
  inventory: Cp06InventoryObservation,
  journal: Cp06IntentAttemptJournal,
): Cp06PhaseBEvidence => {
  const evidence = value as Cp06PhaseBEvidence;
  if (
    !evidence ||
    evidence.schemaVersion !== EVIDENCE_SCHEMA ||
    evidence.status !== "READY_FOR_USER_REVIEW" ||
    evidence.accountIdHash !== CP06_PHASE_B_ACCOUNT_HASH ||
    evidence.workerImageDigest !== config.workerImageDigest ||
    evidence.gpu !== CP06_PHASE_B_GPU ||
    evidence.region !== CP06_PHASE_B_REGION ||
    evidence.finiteCapUsd !== CP06_PHASE_B_EXTERNAL_CAP_USD ||
    evidence.internalStopUsd !== CP06_PHASE_B_INTERNAL_STOP_USD ||
    evidence.zeroPodsProven !== true ||
    !Array.isArray(evidence.samples) ||
    inventory.pods.length !== 0 ||
    inventory.volumes.length !== 1 ||
    sha256(inventory.volumes[0]?.id ?? "") !== evidence.volume?.idHash
  ) {
    throw new Cp06PhaseBError("CP06_STALE_HANDOFF_INVALID");
  }
  assertVolume(inventory.volumes[0] as Cp06VolumeObservation);
  assertSampleMatrix(evidence.samples);
  return enrichEvidenceFromJournal(evidence, journal);
};

export async function runCp06MagePhaseB(
  port: Cp06PodNativePort,
  config: Cp06PhaseBConfig,
): Promise<Cp06PhaseBEvidence> {
  if (
    !IMAGE.test(config.workerImageDigest) ||
    config.externalCapUsd !== CP06_PHASE_B_EXTERNAL_CAP_USD ||
    config.internalStopUsd !== CP06_PHASE_B_INTERNAL_STOP_USD
  ) {
    throw new Cp06PhaseBError("CP06_AUTHORITY_CONFIG_INVALID");
  }
  const journal = await Cp06IntentAttemptJournal.open(config.journalPath);
  const completed = journal.last("handoff_complete")?.evidence;

  const account = await port.assertAccountIdentity(CP06_PHASE_B_ACCOUNT_HASH);
  if (account.accountIdHash !== CP06_PHASE_B_ACCOUNT_HASH) {
    throw new Cp06PhaseBError("CP06_ACCOUNT_NOT_SUJAL");
  }
  const offering = await port.getOffering(CP06_PHASE_B_GPU, CP06_PHASE_B_REGION);
  assertOffering(offering);

  const initialInventory = await port.inspectInventory();
  if (completed !== undefined) {
    return assertCompletedHandoff(completed, config, initialInventory, journal);
  }
  const restartPods: { readonly pod: Cp06PodObservation; readonly role: AttemptRole }[] = [];
  let unexpectedPodPresent = false;
  let restartIdentityMismatch = false;
  for (const pod of initialInventory.pods) {
    const role = exactAttemptFor(pod);
    if (role === null) {
      unexpectedPodPresent = true;
      continue;
    }
    try {
      assertRestartPodSafeToDelete(pod, role, config.workerImageDigest);
      restartPods.push({ pod, role });
    } catch {
      restartIdentityMismatch = true;
    }
  }
  let restartCleanupFailed = false;
  for (const { pod } of restartPods) {
    try {
      await cleanupPod(port, journal, pod);
    } catch {
      restartCleanupFailed = true;
    }
  }
  if (restartCleanupFailed) {
    throw new Cp06PhaseBError("CP06_RESTART_POD_CLEANUP_INCOMPLETE");
  }
  if (unexpectedPodPresent) {
    throw new Cp06PhaseBError("CP06_UNEXPECTED_POD_PRESENT");
  }
  if (restartIdentityMismatch) {
    throw new Cp06PhaseBError("CP06_RESTART_POD_IDENTITY_MISMATCH");
  }
  if ((await port.inspectInventory()).pods.length !== 0) {
    throw new Cp06PhaseBError("CP06_ZERO_PODS_NOT_PROVEN");
  }
  await port.assertWorkerImagePubliclyPullable(config.workerImageDigest);
  assertBudgetForRemainingPlan(journal, offering.rateUsdPerHour);

  let matchingVolumes = await port.reconcileVolumesByExactName(CP06_PHASE_B_VOLUME_NAME);
  if (matchingVolumes.length > 1) throw new Cp06PhaseBError("CP06_VOLUME_CREATE_AMBIGUOUS");
  if (matchingVolumes.length === 0) {
    if (hasUnresolvedCreateIntent(journal, "volume_create_intent", "volume_ready")) {
      throw new Cp06PhaseBError("CP06_VOLUME_CREATE_AMBIGUOUS");
    }
    await journal.append("volume_create_intent", {
      name: CP06_PHASE_B_VOLUME_NAME,
      sizeGb: CP06_PHASE_B_VOLUME_SIZE_GB,
    });
    try {
      const created = await port.createVolume({
        name: CP06_PHASE_B_VOLUME_NAME,
        region: CP06_PHASE_B_REGION,
        sizeGb: CP06_PHASE_B_VOLUME_SIZE_GB,
        storageType: "STANDARD",
        rateUsdPerGbMonth: CP06_PHASE_B_VOLUME_RATE_USD_PER_GB_MONTH,
      });
      matchingVolumes = [created];
    } catch {
      matchingVolumes = await port.reconcileVolumesByExactName(CP06_PHASE_B_VOLUME_NAME);
    }
  }
  if (matchingVolumes.length !== 1) throw new Cp06PhaseBError("CP06_VOLUME_CREATE_AMBIGUOUS");
  const volume = matchingVolumes[0];
  if (!volume) throw new Cp06PhaseBError("CP06_VOLUME_CREATE_AMBIGUOUS");
  assertVolume(volume);
  await journal.append("volume_ready", {
    volumeId: volume.id,
    volumeIdHash: sha256(volume.id),
  });

  let matchingTemplates = await port.reconcileTemplatesByExactName(
    CP06_PHASE_B_TEMPLATE_NAME,
    config.workerImageDigest,
  );
  if (matchingTemplates.length > 1) throw new Cp06PhaseBError("CP06_TEMPLATE_CREATE_AMBIGUOUS");
  if (matchingTemplates.length === 0) {
    if (hasUnresolvedCreateIntent(journal, "template_create_intent", "template_ready")) {
      throw new Cp06PhaseBError("CP06_TEMPLATE_CREATE_AMBIGUOUS");
    }
    await journal.append("template_create_intent", {
      name: CP06_PHASE_B_TEMPLATE_NAME,
      imageDigest: config.workerImageDigest,
    });
    try {
      const created = await port.createPodTemplate({
        name: CP06_PHASE_B_TEMPLATE_NAME,
        imageDigest: config.workerImageDigest,
        isServerless: false,
      });
      matchingTemplates = [created];
    } catch {
      matchingTemplates = await port.reconcileTemplatesByExactName(
        CP06_PHASE_B_TEMPLATE_NAME,
        config.workerImageDigest,
      );
    }
  }
  if (matchingTemplates.length !== 1) {
    throw new Cp06PhaseBError("CP06_TEMPLATE_CREATE_AMBIGUOUS");
  }
  const template = matchingTemplates[0];
  if (!template) throw new Cp06PhaseBError("CP06_TEMPLATE_CREATE_AMBIGUOUS");
  if (
    !SAFE_ID.test(template.id) ||
    template.name !== CP06_PHASE_B_TEMPLATE_NAME ||
    template.imageDigest !== config.workerImageDigest ||
    template.isServerless !== false
  ) {
    throw new Cp06PhaseBError("CP06_TEMPLATE_IDENTITY_MISMATCH");
  }
  const latestTemplateReady = journal.last("template_ready");
  if (
    latestTemplateReady?.templateId !== template.id ||
    (typeof latestTemplateReady.imageDigest === "string" &&
      latestTemplateReady.imageDigest !== config.workerImageDigest)
  ) {
    await journal.append("template_ready", {
      templateId: template.id,
      imageDigest: config.workerImageDigest,
    });
  }

  let manifestSha256 = journalStageEvidence(journal, "prep") as Hash | undefined;
  if (!journal.has("stage_complete", (record) => record.stage === "prep")) {
    manifestSha256 = await runPodStage(
      "prep",
      port,
      journal,
      config.workerImageDigest,
      template.id,
      volume.id,
      offering.rateUsdPerHour,
      async (pod, intent) => {
        if (
          intent.entrypointOverride?.join("\u0000") !==
            ["python", "/opt/videoforge/mage_prepare_service.py"].join("\u0000") ||
          intent.environment.MAGE_MODEL_ROOT !== MAGE_VOLUME_ROOT ||
          intent.environment.VIDEOFORGE_MAGE_VOLUME_ID !== volume.id ||
          intent.environment.VIDEOFORGE_MAGE_DOWNLOAD_CONFIRMATION !== PREP_CONFIRMATION
        ) {
          throw new Cp06PhaseBError("CP06_PREP_COMMAND_INVALID");
        }
        const prepared = await port.awaitPreparation(pod.podId, intent.maximumRuntimeSeconds);
        if (
          prepared.phase !== "ready" ||
          prepared.prepared !== true ||
          !SHA256.test(prepared.manifestSha256) ||
          prepared.modelBytes !== CP06_PHASE_B_MODEL_BYTES ||
          prepared.completedMarkerWritten !== true
        ) {
          throw new Cp06PhaseBError("CP06_PREPARATION_INVALID");
        }
        return prepared.manifestSha256;
      },
    );
    await journal.append("stage_complete", { stage: "prep", evidence: manifestSha256 });
  }
  if (!manifestSha256 || !SHA256.test(manifestSha256)) {
    throw new Cp06PhaseBError("CP06_PREPARATION_EVIDENCE_MISSING");
  }

  for (const [role, failureCode, awaitFailure] of [
    [
      "negativeMissing",
      "MAGE_VOLUME_MARKER_INVALID",
      port.awaitMissingVolumeBootFailure.bind(port),
    ],
    [
      "negativeWrongHash",
      "MAGE_VOLUME_ID_MISMATCH",
      port.awaitWrongVolumeHashBootFailure.bind(port),
    ],
  ] as const) {
    if (journalStageEvidenceInCurrentTemplateEpoch(journal, role) === true) continue;
    await runPodStage(
      role,
      port,
      journal,
      config.workerImageDigest,
      template.id,
      volume.id,
      offering.rateUsdPerHour,
      async (pod, intent) => {
        const negative = await awaitFailure(pod.podId, intent.maximumRuntimeSeconds);
        if (
          negative.bootSucceeded !== false ||
          negative.modelStatus !== "error" ||
          negative.failureCode !== failureCode ||
          negative.registryAccessAllowed !== false ||
          negative.downloadedModelBytes !== 0
        ) {
          throw new Cp06PhaseBError("CP06_NEGATIVE_BOOT_DID_NOT_FAIL_CLOSED");
        }
      },
    );
    await journal.append("stage_complete", { stage: role, evidence: true });
  }

  const allSamples: Cp06SanitizedSampleEvidence[] = [];
  for (const [role, prompts] of [
    ["positive1", CP06_REPRESENTATIVE_PROMPTS.slice(0, 4)],
    ["positive2", CP06_REPRESENTATIVE_PROMPTS.slice(4, 8)],
  ] as const) {
    const stage = role;
    const resumed = journalStageEvidenceInCurrentTemplateEpoch(journal, stage) as
      | readonly Cp06SanitizedSampleEvidence[]
      | undefined;
    if (resumed !== undefined) {
      if (!Array.isArray(resumed) || resumed.length !== prompts.length) {
        throw new Cp06PhaseBError("CP06_SAMPLE_EVIDENCE_INVALID");
      }
      resumed.forEach((sample, index) => {
        const prompt = prompts[index];
        if (prompt === undefined) throw new Cp06PhaseBError("CP06_SAMPLE_EVIDENCE_INVALID");
        assertSanitizedSampleEvidence(sample, prompt, CP06_PHASE_B_ATTEMPTS[role].attemptId);
      });
      allSamples.push(...resumed);
      continue;
    }
    const evidence = await runPodStage(
      role,
      port,
      journal,
      config.workerImageDigest,
      template.id,
      volume.id,
      offering.rateUsdPerHour,
      async (pod, intent) => {
        const ready = await port.awaitModelReady(pod.podId, intent.maximumRuntimeSeconds);
        if (
          ready.manifestSha256 !== manifestSha256 ||
          ready.registryAccessAllowed !== false ||
          ready.downloadedModelBytes !== 0 ||
          !Number.isSafeInteger(ready.modelReadyMs) ||
          ready.modelReadyMs < 1 ||
          !Number.isSafeInteger(ready.peakVramBytes) ||
          ready.peakVramBytes < 1
        ) {
          throw new Cp06PhaseBError("CP06_MODEL_READY_INVALID");
        }
        await journal.append("model_ready_confirmed", {
          attemptId: intent.attemptId,
          podIdHash: sha256(pod.podId),
          manifestSha256: ready.manifestSha256,
          modelReadyMs: ready.modelReadyMs,
          readyPeakVramBytes: ready.peakVramBytes,
        });
        const batch: Cp06SanitizedSampleEvidence[] = [];
        for (const [index, prompt] of prompts.entries()) {
          const futureRuntimeSeconds = futureRuntimeSecondsAfter(role);
          const futureReservationUsd = (futureRuntimeSeconds / 3_600) * offering.rateUsdPerHour;
          await port.assertSampleSpendAllowed(pod.podId, {
            reservedCumulativeSpendUsd:
              journal.accountedCostMicroUsd() / 1_000_000 + futureReservationUsd,
            internalStopUsd: CP06_PHASE_B_INTERNAL_STOP_USD,
            externalCapUsd: CP06_PHASE_B_EXTERNAL_CAP_USD,
            attemptMaximumRuntimeSeconds: intent.maximumRuntimeSeconds,
            remainingSampleCount: prompts.length - index,
            perSampleMaximumSeconds: CP06_PHASE_B_SAMPLE_TIMEOUT_SECONDS,
          });
          const sample = await port.generateOwnedSample(pod.podId, prompt);
          assertSample(sample, prompt);
          batch.push(sampleEvidence(prompt, sample, intent.attemptId, sha256(pod.podId)));
        }
        return batch;
      },
    );
    await journal.append("stage_complete", { stage, evidence });
    allSamples.push(...evidence);
  }

  assertSampleMatrix(allSamples);

  const contactSheet = await port.createContactSheet(
    allSamples.map((sample) => ({
      sampleId: sample.sampleId,
      outputObjectKey: sample.outputObjectKey,
      outputSha256: sample.outputSha256,
      bytes: sample.bytes,
      width: sample.width,
      height: sample.height,
      mediaType: "image/png",
      positivePromptSha256: sample.positivePromptSha256,
      negativePromptSha256: sample.negativePromptSha256,
      inferenceMs: sample.inferenceMs,
      uploadMs: sample.uploadMs,
      peakVramBytes: sample.peakVramBytes,
    })),
  );
  assertSafeObjectKey(contactSheet.outputObjectKey);
  if (
    !SHA256.test(contactSheet.outputSha256) ||
    !Number.isSafeInteger(contactSheet.bytes) ||
    contactSheet.bytes < 45 ||
    contactSheet.mediaType !== "image/png" ||
    contactSheet.sampleIds.join("\u0000") !==
      allSamples.map((sample) => sample.sampleId).join("\u0000")
  ) {
    throw new Cp06PhaseBError("CP06_CONTACT_SHEET_INVALID");
  }

  await journal.append("template_delete_intent", { templateId: template.id });
  try {
    await port.deletePodTemplate(template.id);
  } catch {
    const recovered = await port.reconcileTemplatesByExactName(
      CP06_PHASE_B_TEMPLATE_NAME,
      config.workerImageDigest,
    );
    if (recovered.length !== 0) throw new Cp06PhaseBError("CP06_TEMPLATE_DELETE_AMBIGUOUS");
  }
  try {
    await port.confirmPodTemplateAbsent(template.id);
  } catch {
    throw new Cp06PhaseBError("CP06_TEMPLATE_ABSENCE_UNPROVEN");
  }
  await journal.append("template_absence_confirmed", { templateId: template.id });

  const finalInventory = await port.inspectInventory();
  if (
    finalInventory.pods.length !== 0 ||
    finalInventory.volumes.length !== 1 ||
    finalInventory.volumes[0]?.id !== volume.id
  ) {
    throw new Cp06PhaseBError("CP06_FINAL_RESOURCE_STATE_INVALID");
  }
  const budgetAccountedSpendUsd = journal.accountedCostMicroUsd() / 1_000_000;
  if (
    budgetAccountedSpendUsd > CP06_PHASE_B_INTERNAL_STOP_USD ||
    budgetAccountedSpendUsd > CP06_PHASE_B_EXTERNAL_CAP_USD
  ) {
    throw new Cp06PhaseBError("CP06_SPEND_CAP_EXCEEDED");
  }
  const attempts = attemptEvidenceFromJournal(journal);
  const settledSpendUsd = attempts.every((attempt) => attempt.settledCostUsd !== null)
    ? attempts.reduce((sum, attempt) => sum + (attempt.settledCostUsd ?? 0), 0)
    : null;
  const evidence: Cp06PhaseBEvidence = {
    schemaVersion: EVIDENCE_SCHEMA,
    status: "READY_FOR_USER_REVIEW",
    accountIdHash: CP06_PHASE_B_ACCOUNT_HASH,
    workerImageDigest: config.workerImageDigest,
    gpu: CP06_PHASE_B_GPU,
    region: CP06_PHASE_B_REGION,
    rateUsdPerHour: offering.rateUsdPerHour,
    model: {
      id: CP06_PHASE_B_MODEL_ID,
      revision: CP06_PHASE_B_MODEL_REVISION,
      precision: "int8-convrot",
      comfyUiRevision: CP06_PHASE_B_COMFYUI_REVISION,
    },
    volume: {
      idHash: sha256(volume.id),
      name: CP06_PHASE_B_VOLUME_NAME,
      sizeGb: CP06_PHASE_B_VOLUME_SIZE_GB,
      rateUsdPerGbMonth: CP06_PHASE_B_VOLUME_RATE_USD_PER_GB_MONTH,
      ongoingUsdPerMonth: 3.5,
      manifestSha256,
    },
    attempts,
    positivePodReadiness: readinessEvidenceFromJournal(journal, allSamples),
    samples: allSamples,
    contactSheet,
    budgetAccountedSpendUsd,
    settledSpendUsd,
    finiteCapUsd: CP06_PHASE_B_EXTERNAL_CAP_USD,
    internalStopUsd: CP06_PHASE_B_INTERNAL_STOP_USD,
    zeroPodsProven: true,
  };
  await journal.append("handoff_complete", { evidence });
  return evidence;
}
