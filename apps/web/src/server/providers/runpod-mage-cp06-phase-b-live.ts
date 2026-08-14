import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

import { loadSujalRunPodApiKeyFromKeychain } from "./keychain";
import { assertSujalRunPodAccount } from "./runpod-account";
import { RunPodControlClient } from "./runpod-control";
import {
  CP06_PHASE_B_ATTEMPTS,
  CP06_PHASE_B_ACCOUNT_HASH,
  CP06_PHASE_B_COMFYUI_REVISION,
  CP06_PHASE_B_EXTERNAL_CAP_USD,
  CP06_PHASE_B_GPU,
  CP06_PHASE_B_INTERNAL_STOP_USD,
  CP06_PHASE_B_MODEL_BYTES,
  CP06_PHASE_B_MODEL_REVISION,
  CP06_PHASE_B_REGION,
  CP06_PHASE_B_RATE_CEILING_USD,
  CP06_PHASE_B_SAMPLE_TIMEOUT_SECONDS,
  CP06_PHASE_B_TEMPLATE_NAME,
  CP06_PHASE_B_VOLUME_NAME,
  CP06_PHASE_B_VOLUME_RATE_USD_PER_GB_MONTH,
  CP06_PHASE_B_VOLUME_SIZE_GB,
  Cp06PhaseBError,
  Cp06IntentAttemptJournal,
  buildCp06PodIntent,
  runCp06MagePhaseB,
  type Cp06ContactSheetResult,
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
import { acceptMageResult } from "./runpod-mage-result";
import {
  RunPodPodControlClient,
  RunPodPodControlError,
  type CreateRunPodMagePodInput,
  type RunPodMagePod,
} from "./runpod-pod-control";

const CATALOG_URL =
  "https://api.runpod.io/v2/catalog/gpus?include=AVAILABILITY&product=POD&count=1&cloud=SECURE&minCudaVersion=13.0";
const GHCR_REPOSITORY = "pala-lakshmansai/videoforge-mage-cp06";
const GHCR_TOKEN_REALM = "https://ghcr.io/token";
const GHCR_PULL_SCOPE = `repository:${GHCR_REPOSITORY}:pull`;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PROXY = /^https:\/\/[A-Za-z0-9_-]+-8000\.proxy\.runpod\.net$/u;

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface InventoryPort {
  inventory(): Promise<{
    readonly pods: readonly { readonly idHash: string }[];
    readonly networkVolumes: readonly { readonly idHash: string; readonly sizeGb: number | null }[];
    readonly endpoints: readonly unknown[];
    readonly privateTemplateCount: number;
    readonly runningPodCount: number;
    readonly activeServerlessWorkerCount: number;
  }>;
}

export interface Cp06LiveAdapterOptions {
  readonly apiKey: string;
  readonly podClient: RunPodPodControlClient;
  readonly inventoryClient: InventoryPort;
  readonly artifactRoot: string;
  readonly journalPath: string;
  readonly workerImageDigest: string;
  readonly fetch?: FetchPort;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly workerToken?: string;
  readonly assertAccount?: (
    apiKey: string,
    options?: { readonly fetch?: FetchPort },
  ) => Promise<{ readonly accountIdHash: string }>;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const mageFailureCode = (value: unknown): string | null => {
  const pending: unknown[] = [value];
  for (let inspected = 0; pending.length > 0 && inspected < 100; inspected += 1) {
    const candidate = pending.shift();
    if (typeof candidate === "string") {
      const match = candidate.match(/\bMAGE_[A-Z0-9_]{1,100}\b/u);
      if (match?.[0]) return match[0];
      continue;
    }
    if (Array.isArray(candidate)) {
      pending.push(...candidate);
      continue;
    }
    const object = record(candidate);
    if (object !== null) pending.push(...Object.values(object));
  }
  return null;
};

const hash = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const writeExactArtifact = async (filePath: string, bytes: Buffer): Promise<void> => {
  try {
    await writeFile(filePath, bytes, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(filePath);
    if (hash(existing) !== hash(bytes)) {
      throw new Cp06PhaseBError("CP06_ARTIFACT_REPLAY_MISMATCH");
    }
  }
  await chmod(filePath, 0o600);
};

const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const lastIndexOf = <T>(values: readonly T[], predicate: (value: T) => boolean): number => {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== undefined && predicate(value)) return index;
  }
  return -1;
};

const proxyUrl = (podId: string): string => {
  const value = `https://${podId}-8000.proxy.runpod.net`;
  if (!PROXY.test(value)) throw new Cp06PhaseBError("CP06_PROXY_URL_INVALID");
  return value;
};

const exactPodAuthority = (
  intent: Cp06PodIntent,
  actualVolumeId: string,
  workerToken: string,
): CreateRunPodMagePodInput => ({
  name: intent.name,
  templateId: intent.templateId,
  imageDigest: intent.imageDigest,
  networkVolumeId: actualVolumeId,
  networkVolumeIdHash: hash(actualVolumeId),
  workerToken,
});

const toPodObservation = (pod: RunPodMagePod, intent: Cp06PodIntent): Cp06PodObservation => ({
  ...intent,
  podId: pod.id,
});

const crc32 = (bytes: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (kind: string, payload: Buffer): Buffer => {
  const name = Buffer.from(kind, "ascii");
  const output = Buffer.alloc(payload.length + 12);
  output.writeUInt32BE(payload.length, 0);
  name.copy(output, 4);
  payload.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, payload])), payload.length + 8);
  return output;
};

interface RgbImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Buffer;
}

const paeth = (a: number, b: number, c: number): number => {
  const estimate = a + b - c;
  const pa = Math.abs(estimate - a);
  const pb = Math.abs(estimate - b);
  const pc = Math.abs(estimate - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

const decodePng = (bytes: Buffer): RgbImage => {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Cp06PhaseBError("CP06_CONTACT_SOURCE_PNG_INVALID");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const compressed: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (offset + 12 + length > bytes.length) {
      throw new Cp06PhaseBError("CP06_CONTACT_SOURCE_PNG_INVALID");
    }
    if (kind === "IHDR") {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      const bitDepth = payload[8];
      const colorType = payload[9];
      if (
        bitDepth !== 8 ||
        (colorType !== 2 && colorType !== 6) ||
        payload[10] !== 0 ||
        payload[11] !== 0 ||
        payload[12] !== 0
      ) {
        throw new Cp06PhaseBError("CP06_CONTACT_SOURCE_PNG_UNSUPPORTED");
      }
      channels = colorType === 2 ? 3 : 4;
    } else if (kind === "IDAT") {
      compressed.push(payload);
    } else if (kind === "IEND") {
      break;
    }
    offset += length + 12;
  }
  if (width < 1 || height < 1 || channels === 0 || compressed.length === 0) {
    throw new Cp06PhaseBError("CP06_CONTACT_SOURCE_PNG_INVALID");
  }
  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: (rowBytes + 1) * height });
  if (raw.length !== (rowBytes + 1) * height) {
    throw new Cp06PhaseBError("CP06_CONTACT_SOURCE_PNG_INVALID");
  }
  const decoded = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (rowBytes + 1)] ?? 255;
    for (let x = 0; x < rowBytes; x += 1) {
      const source = raw[y * (rowBytes + 1) + x + 1] ?? 0;
      const left = x >= channels ? (decoded[y * rowBytes + x - channels] ?? 0) : 0;
      const up = y > 0 ? (decoded[(y - 1) * rowBytes + x] ?? 0) : 0;
      const upperLeft =
        y > 0 && x >= channels ? (decoded[(y - 1) * rowBytes + x - channels] ?? 0) : 0;
      const value =
        filter === 0
          ? source
          : filter === 1
            ? source + left
            : filter === 2
              ? source + up
              : filter === 3
                ? source + Math.floor((left + up) / 2)
                : filter === 4
                  ? source + paeth(left, up, upperLeft)
                  : Number.NaN;
      if (!Number.isFinite(value)) {
        throw new Cp06PhaseBError("CP06_CONTACT_SOURCE_PNG_UNSUPPORTED");
      }
      decoded[y * rowBytes + x] = value & 0xff;
    }
  }
  const pixels = Buffer.alloc(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    pixels[pixel * 3] = decoded[pixel * channels] ?? 0;
    pixels[pixel * 3 + 1] = decoded[pixel * channels + 1] ?? 0;
    pixels[pixel * 3 + 2] = decoded[pixel * channels + 2] ?? 0;
  }
  return { width, height, pixels };
};

const encodePng = (image: RgbImage): Buffer => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    image.pixels.copy(
      rows,
      y * (image.width * 3 + 1) + 1,
      y * image.width * 3,
      (y + 1) * image.width * 3,
    );
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

const contactSheetPng = (sources: readonly Buffer[]): Buffer => {
  if (sources.length !== 8) throw new Cp06PhaseBError("CP06_CONTACT_SAMPLE_COUNT_INVALID");
  const images = sources.map(decodePng);
  const tileWidth = 320;
  const tileHeight = 180;
  const canvas: RgbImage = { width: 1_280, height: 360, pixels: Buffer.alloc(1_280 * 360 * 3) };
  images.forEach((image, index) => {
    const offsetX = (index % 4) * tileWidth;
    const offsetY = Math.floor(index / 4) * tileHeight;
    for (let y = 0; y < tileHeight; y += 1) {
      const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / tileHeight));
      for (let x = 0; x < tileWidth; x += 1) {
        const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / tileWidth));
        const source = (sourceY * image.width + sourceX) * 3;
        const target = ((offsetY + y) * canvas.width + offsetX + x) * 3;
        image.pixels.copy(canvas.pixels, target, source, source + 3);
      }
    }
  });
  return encodePng(canvas);
};

export class RunPodCp06LiveAdapter implements Cp06PodNativePort {
  private readonly fetch: FetchPort;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly workerToken: string;
  private readonly assertAccount: NonNullable<Cp06LiveAdapterOptions["assertAccount"]>;
  private volume: Cp06VolumeObservation | null = null;
  private template: Cp06TemplateObservation | null = null;
  private readonly intents = new Map<string, Cp06PodIntent>();
  private readonly activePods = new Map<string, Cp06PodObservation>();
  private readonly startedAt = new Map<string, string>();
  private preparedManifest: `sha256:${string}` | null = null;
  private hydratePromise: Promise<void> | null = null;

  constructor(private readonly options: Cp06LiveAdapterOptions) {
    if (!path.isAbsolute(options.artifactRoot) || !path.isAbsolute(options.journalPath)) {
      throw new Cp06PhaseBError("CP06_ARTIFACT_ROOT_NOT_ABSOLUTE");
    }
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.workerToken = options.workerToken ?? randomBytes(32).toString("base64url");
    this.assertAccount = options.assertAccount ?? assertSujalRunPodAccount;
    if (this.workerToken.length < 32 || /\s/u.test(this.workerToken)) {
      throw new Cp06PhaseBError("CP06_WORKER_TOKEN_INVALID");
    }
  }

  private podMode(
    role: Cp06PodIntent["role"],
  ): "runtime" | "prepare" | "negativeMissing" | "negativeWrongHash" {
    return role === "prep"
      ? "prepare"
      : role === "negativeMissing"
        ? "negativeMissing"
        : role === "negativeWrongHash"
          ? "negativeWrongHash"
          : "runtime";
  }

  private async queryPodsForIntent(intent: Cp06PodIntent): Promise<readonly RunPodMagePod[]> {
    if (this.volume === null) throw new Cp06PhaseBError("CP06_VOLUME_NOT_RESOLVED");
    return this.options.podClient.listMagePodsByExactName(
      exactPodAuthority(intent, this.volume.id, this.workerToken),
      this.podMode(intent.role),
    );
  }

  private async hydrate(): Promise<void> {
    if (this.hydratePromise !== null) return this.hydratePromise;
    this.hydratePromise = this.hydrateFromJournal();
    return this.hydratePromise;
  }

  private async deleteAmbiguousExactPods(
    intent: Cp06PodIntent,
    pods: readonly RunPodMagePod[],
  ): Promise<never> {
    const journal = await Cp06IntentAttemptJournal.open(this.options.journalPath, this.now);
    let unresolvedPods = 0;
    for (const pod of pods) {
      const observed = toPodObservation(pod, intent);
      this.intents.set(pod.id, intent);
      this.activePods.set(pod.id, observed);
      this.startedAt.set(pod.id, pod.lastStartedAt);
      const accruedCostUsd = await this.accruedPodCostUpperBound(
        pod.id,
        intent.maximumRuntimeSeconds,
        intent.rateCeilingUsdPerHour,
      );
      const accruedCostMicroUsd = Math.ceil(accruedCostUsd * 1_000_000);
      try {
        await journal.append("pod_delete_intent", {
          attemptId: intent.attemptId,
          podId: pod.id,
          podIdHash: hash(pod.id),
          accountedCostMicroUsd: accruedCostMicroUsd,
          reason: "exact_name_ambiguity",
        });
      } catch {
        // Provider cleanup must still run; confirmed absence is recorded afterward when possible.
      }
      try {
        const deletion = await this.deletePod(pod.id);
        await this.confirmPodAbsent(pod.id);
        const settledCostMicroUsd =
          deletion.settledCostUsd === null ? null : Math.ceil(deletion.settledCostUsd * 1_000_000);
        const accountedCostMicroUsd = Math.max(accruedCostMicroUsd, settledCostMicroUsd ?? 0);
        await journal.append("pod_absence_confirmed", {
          attemptId: intent.attemptId,
          role: intent.role,
          podId: pod.id,
          podIdHash: hash(pod.id),
          accountedCostMicroUsd,
          settledCostMicroUsd,
          costBasis:
            settledCostMicroUsd !== null && settledCostMicroUsd >= accruedCostMicroUsd
              ? "settled"
              : "conservative_elapsed",
          reason: "exact_name_ambiguity",
        });
      } catch {
        unresolvedPods += 1;
        try {
          await journal.append("pod_absence_unknown", {
            attemptId: intent.attemptId,
            role: intent.role,
            podId: pod.id,
            podIdHash: hash(pod.id),
            accountedCostMicroUsd: accruedCostMicroUsd,
            reason: "exact_name_ambiguity",
          });
        } catch {
          // The next exact Pod must still be cleaned even when local evidence persistence fails.
        }
      }
    }
    if (unresolvedPods > 0) {
      throw new Cp06PhaseBError("CP06_POD_DUPLICATE_CLEANUP_INCOMPLETE");
    }
    throw new Cp06PhaseBError("CP06_POD_NAME_AMBIGUOUS");
  }

  private async hydrateFromJournal(): Promise<void> {
    const journal = await Cp06IntentAttemptJournal.open(this.options.journalPath, this.now);
    const records = journal.all() as readonly Record<string, unknown>[];
    const providerVolume =
      await this.options.podClient.findMageNetworkVolumeByName(CP06_PHASE_B_VOLUME_NAME);
    if (providerVolume !== null) {
      const recorded = [...records]
        .reverse()
        .find((candidate) => candidate.event === "volume_ready")?.volumeId;
      if (recorded !== undefined && recorded !== providerVolume.id) {
        throw new Cp06PhaseBError("CP06_JOURNAL_VOLUME_IDENTITY_MISMATCH");
      }
      this.volume = {
        id: providerVolume.id,
        name: CP06_PHASE_B_VOLUME_NAME,
        region: CP06_PHASE_B_REGION,
        sizeGb: CP06_PHASE_B_VOLUME_SIZE_GB,
        storageType: "STANDARD",
        rateUsdPerGbMonth: CP06_PHASE_B_VOLUME_RATE_USD_PER_GB_MONTH,
      };
    }
    const providerTemplate = await this.options.podClient.findMagePodTemplateByName(
      CP06_PHASE_B_TEMPLATE_NAME,
      this.options.workerImageDigest,
    );
    if (providerTemplate !== null) {
      const recorded = [...records]
        .reverse()
        .find((candidate) => candidate.event === "template_ready");
      const absence = [...records]
        .reverse()
        .find(
          (candidate) =>
            candidate.event === "template_absence_confirmed" &&
            candidate.templateId === providerTemplate.id,
        );
      if (
        (absence !== undefined &&
          (finite(absence.sequence) ?? 0) > (finite(recorded?.sequence) ?? 0)) ||
        (recorded?.templateId !== undefined && recorded.templateId !== providerTemplate.id)
      ) {
        throw new Cp06PhaseBError("CP06_JOURNAL_TEMPLATE_IDENTITY_MISMATCH");
      }
      this.template = {
        id: providerTemplate.id,
        name: CP06_PHASE_B_TEMPLATE_NAME,
        imageDigest: this.options.workerImageDigest,
        isServerless: false,
      };
    }
    const prepEvidence = [...records]
      .reverse()
      .find(
        (candidate) => candidate.event === "stage_complete" && candidate.stage === "prep",
      )?.evidence;
    if (typeof prepEvidence === "string" && SHA256.test(prepEvidence)) {
      this.preparedManifest = prepEvidence as `sha256:${string}`;
    }
    if (this.volume === null || this.template === null) return;
    for (const [role, attempt] of Object.entries(CP06_PHASE_B_ATTEMPTS) as [
      Cp06PodIntent["role"],
      (typeof CP06_PHASE_B_ATTEMPTS)[Cp06PodIntent["role"]],
    ][]) {
      const createIndex = lastIndexOf(
        records,
        (candidate) =>
          candidate.event === "pod_create_intent" && candidate.attemptId === attempt.attemptId,
      );
      if (createIndex < 0) continue;
      const absenceIndex = lastIndexOf(
        records,
        (candidate) =>
          candidate.event === "pod_absence_confirmed" && candidate.attemptId === attempt.attemptId,
      );
      if (absenceIndex > createIndex) continue;
      const intent = buildCp06PodIntent(
        role,
        this.options.workerImageDigest,
        this.template.id,
        this.volume.id,
      );
      const pods = await this.queryPodsForIntent(intent);
      if (pods.length > 1) await this.deleteAmbiguousExactPods(intent, pods);
      const pod = pods[0];
      if (pod === undefined) continue;
      const acknowledged = records
        .slice(createIndex)
        .find(
          (candidate) =>
            candidate.event === "pod_create_acknowledged" &&
            candidate.attemptId === attempt.attemptId,
        )?.podId;
      if (acknowledged !== undefined && acknowledged !== pod.id) {
        throw new Cp06PhaseBError("CP06_JOURNAL_POD_IDENTITY_MISMATCH");
      }
      const observed = toPodObservation(pod, intent);
      this.intents.set(pod.id, intent);
      this.activePods.set(pod.id, observed);
      this.startedAt.set(pod.id, pod.lastStartedAt);
    }
  }

  async assertAccountIdentity(
    expectedAccountIdHash: string,
  ): Promise<{ readonly accountIdHash: string }> {
    if (expectedAccountIdHash !== CP06_PHASE_B_ACCOUNT_HASH) {
      throw new Cp06PhaseBError("CP06_ACCOUNT_AUTHORITY_INVALID");
    }
    return this.assertAccount(this.options.apiKey, { fetch: this.fetch });
  }

  async getOffering(offeringId: string, region: string) {
    if (offeringId !== CP06_PHASE_B_GPU || region !== CP06_PHASE_B_REGION) {
      throw new Cp06PhaseBError("CP06_OFFERING_REQUEST_INVALID");
    }
    const response = await this.fetch(CATALOG_URL, {
      headers: { authorization: `Bearer ${this.options.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Cp06PhaseBError("CP06_CATALOG_READ_FAILED");
    const body = record(await response.json());
    const gpus = Array.isArray(body?.gpus) ? body.gpus : [];
    const gpu = gpus.map(record).find((candidate) => candidate?.id === CP06_PHASE_B_GPU);
    const price = record(gpu?.price);
    const maximumCount = record(gpu?.maxCount);
    const dataCenters = Array.isArray(gpu?.dataCenters) ? gpu.dataCenters : [];
    const dataCenter = dataCenters
      .map(record)
      .find((candidate) => candidate?.id === CP06_PHASE_B_REGION);
    const securePrice = finite(price?.secure);
    const memoryGb = finite(gpu?.memory);
    const available = (value: unknown): boolean =>
      value === "LOW" || value === "MEDIUM" || value === "HIGH";
    if (
      !gpu ||
      !dataCenter ||
      gpu.name !== "RTX 4090" ||
      gpu.pool !== "ADA_24" ||
      gpu.manufacturer !== "NVIDIA" ||
      gpu.secure !== true ||
      securePrice === null ||
      memoryGb === null ||
      memoryGb < 24 ||
      !available(gpu.availability) ||
      !available(dataCenter.availability) ||
      finite(maximumCount?.secure) === null ||
      (finite(maximumCount?.secure) ?? 0) < 1
    ) {
      throw new Cp06PhaseBError("CP06_CATALOG_OFFERING_UNCONFIRMED");
    }
    return {
      offeringId: CP06_PHASE_B_GPU,
      region: CP06_PHASE_B_REGION,
      secureCloud: true,
      available: true,
      rateUsdPerHour: securePrice,
      gpuMemoryBytes: memoryGb * 1024 * 1024 * 1024,
    } as const;
  }

  async inspectInventory(): Promise<Cp06InventoryObservation> {
    await this.hydrate();
    const inventory = await this.options.inventoryClient.inventory();
    const expectedPodHashes = [...this.activePods.keys()].map(hash).sort();
    const actualPodHashes = inventory.pods.map((pod) => pod.idHash).sort();
    const expectedVolumeHashes = this.volume === null ? [] : [hash(this.volume.id)];
    const actualVolumeHashes = inventory.networkVolumes.map((volume) => volume.idHash).sort();
    if (
      JSON.stringify(actualPodHashes) !== JSON.stringify(expectedPodHashes) ||
      JSON.stringify(actualVolumeHashes) !== JSON.stringify(expectedVolumeHashes) ||
      inventory.networkVolumes.some((volume) => volume.sizeGb !== CP06_PHASE_B_VOLUME_SIZE_GB) ||
      inventory.endpoints.length !== 0 ||
      inventory.activeServerlessWorkerCount !== 0 ||
      inventory.privateTemplateCount !== (this.template === null ? 0 : 1) ||
      inventory.runningPodCount > this.activePods.size
    ) {
      throw new Cp06PhaseBError("CP06_ACCOUNT_INVENTORY_IDENTITY_MISMATCH");
    }
    return {
      pods: [...this.activePods.values()],
      volumes: this.volume === null ? [] : [this.volume],
    };
  }

  async assertWorkerImagePubliclyPullable(imageDigest: string): Promise<void> {
    if (imageDigest !== this.options.workerImageDigest) {
      throw new Cp06PhaseBError("CP06_PUBLIC_IMAGE_DIGEST_INVALID");
    }
    const digest = imageDigest.slice(imageDigest.indexOf("@") + 1);
    if (!SHA256.test(digest)) throw new Cp06PhaseBError("CP06_PUBLIC_IMAGE_DIGEST_INVALID");
    const manifestUrl = `https://ghcr.io/v2/${GHCR_REPOSITORY}/manifests/${digest}`;
    const manifestHeaders = {
      accept:
        "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
    };
    const anonymous = await this.fetch(manifestUrl, {
      method: "HEAD",
      headers: manifestHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    let manifest = anonymous;
    if (anonymous.status === 401) {
      const challenge = anonymous.headers.get("www-authenticate");
      if (challenge === null || !challenge.startsWith("Bearer ")) {
        throw new Cp06PhaseBError("CP06_PUBLIC_IMAGE_AUTH_INVALID");
      }
      const parameters = new Map<string, string>();
      for (const match of challenge.matchAll(/([a-z]+)="([^"]+)"/gu)) {
        const key = match[1];
        const value = match[2];
        if (key === undefined || value === undefined || parameters.has(key)) {
          throw new Cp06PhaseBError("CP06_PUBLIC_IMAGE_AUTH_INVALID");
        }
        parameters.set(key, value);
      }
      if (
        parameters.size !== 3 ||
        parameters.get("realm") !== GHCR_TOKEN_REALM ||
        parameters.get("service") !== "ghcr.io" ||
        parameters.get("scope") !== GHCR_PULL_SCOPE
      ) {
        throw new Cp06PhaseBError("CP06_PUBLIC_IMAGE_AUTH_INVALID");
      }
      const tokenUrl = new URL(GHCR_TOKEN_REALM);
      tokenUrl.searchParams.set("service", "ghcr.io");
      tokenUrl.searchParams.set("scope", GHCR_PULL_SCOPE);
      const tokenResponse = await this.fetch(tokenUrl, {
        signal: AbortSignal.timeout(30_000),
      });
      const tokenBody = record(tokenResponse.ok ? await tokenResponse.json() : null);
      const token = tokenBody?.token;
      if (typeof token !== "string" || token.length < 20 || /\s/u.test(token)) {
        throw new Cp06PhaseBError("CP06_PUBLIC_IMAGE_TOKEN_INVALID");
      }
      manifest = await this.fetch(manifestUrl, {
        method: "HEAD",
        headers: { ...manifestHeaders, authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    }
    if (!manifest.ok || manifest.headers.get("docker-content-digest") !== digest) {
      throw new Cp06PhaseBError("CP06_PUBLIC_IMAGE_PULL_UNPROVEN");
    }
  }

  async reconcileVolumesByExactName(name: string): Promise<readonly Cp06VolumeObservation[]> {
    await this.hydrate();
    const value = await this.options.podClient.findMageNetworkVolumeByName(name);
    if (value === null) return [];
    this.volume = {
      id: value.id,
      name: CP06_PHASE_B_VOLUME_NAME,
      region: CP06_PHASE_B_REGION,
      sizeGb: CP06_PHASE_B_VOLUME_SIZE_GB,
      storageType: "STANDARD",
      rateUsdPerGbMonth: CP06_PHASE_B_VOLUME_RATE_USD_PER_GB_MONTH,
    };
    return [this.volume];
  }

  async createVolume(): Promise<Cp06VolumeObservation> {
    const value = await this.options.podClient.createMageNetworkVolume(CP06_PHASE_B_VOLUME_NAME);
    this.volume = {
      id: value.id,
      name: CP06_PHASE_B_VOLUME_NAME,
      region: CP06_PHASE_B_REGION,
      sizeGb: CP06_PHASE_B_VOLUME_SIZE_GB,
      storageType: "STANDARD",
      rateUsdPerGbMonth: CP06_PHASE_B_VOLUME_RATE_USD_PER_GB_MONTH,
    };
    return this.volume;
  }

  async reconcileTemplatesByExactName(
    name: string,
    imageDigest: string,
  ): Promise<readonly Cp06TemplateObservation[]> {
    await this.hydrate();
    const value = await this.options.podClient.findMagePodTemplateByName(name, imageDigest);
    if (value === null) return [];
    const template: Cp06TemplateObservation = {
      id: value.id,
      name: CP06_PHASE_B_TEMPLATE_NAME,
      imageDigest,
      isServerless: false,
    };
    this.template = template;
    return [template];
  }

  async createPodTemplate(input: {
    readonly name: typeof CP06_PHASE_B_TEMPLATE_NAME;
    readonly imageDigest: string;
    readonly isServerless: false;
  }): Promise<Cp06TemplateObservation> {
    const value = await this.options.podClient.createMagePodTemplate(input.name, input.imageDigest);
    this.template = { id: value.id, ...input };
    return this.template;
  }

  async listPodsByExactName(name: string): Promise<readonly Cp06PodObservation[]> {
    await this.hydrate();
    let known = [...this.intents.values()].find((intent) => intent.name === name);
    if (known === undefined && this.volume !== null && this.template !== null) {
      const role = (
        Object.entries(CP06_PHASE_B_ATTEMPTS) as [
          Cp06PodIntent["role"],
          (typeof CP06_PHASE_B_ATTEMPTS)[Cp06PodIntent["role"]],
        ][]
      ).find(([, attempt]) => attempt.name === name)?.[0];
      if (role !== undefined) {
        known = buildCp06PodIntent(
          role,
          this.options.workerImageDigest,
          this.template.id,
          this.volume.id,
        );
        this.intents.set(known.attemptId, known);
      }
    }
    if (known === undefined) return [];
    const pods = await this.queryPodsForIntent(known);
    if (pods.length > 1) await this.deleteAmbiguousExactPods(known, pods);
    const observed = pods.map((pod) => {
      this.startedAt.set(pod.id, pod.lastStartedAt);
      const value = toPodObservation(pod, known);
      this.activePods.set(pod.id, value);
      return value;
    });
    if (observed.length === 0) {
      for (const [podId, pod] of this.activePods) {
        if (pod.name === name) this.activePods.delete(podId);
      }
    }
    return observed;
  }

  async createPod(intent: Cp06PodIntent): Promise<Cp06PodObservation> {
    if (this.volume === null) throw new Cp06PhaseBError("CP06_VOLUME_NOT_RESOLVED");
    const authority = exactPodAuthority(intent, this.volume.id, this.workerToken);
    let pod: RunPodMagePod;
    try {
      if (intent.role === "prep") {
        pod = await this.options.podClient.createMagePrepPod(authority);
      } else if (intent.role === "negativeMissing") {
        pod = await this.options.podClient.createMageMissingVolumeNegativePod(authority);
      } else if (intent.role === "negativeWrongHash") {
        pod = await this.options.podClient.createMageWrongVolumeHashNegativePod(authority);
      } else {
        pod = await this.options.podClient.createMagePod(authority);
      }
    } catch (error) {
      if (error instanceof RunPodPodControlError && error.resourceId !== undefined) {
        await this.options.podClient.deleteMagePodAndConfirmAbsent(error.resourceId, {
          maximumAttempts: 12,
          intervalMs: 2_000,
        });
        throw new RunPodPodControlError(
          "RUNPOD_MAGE_POD_IDENTITY_REJECTED_AND_DELETED",
          undefined,
          undefined,
          error.providerStatus,
          error.providerMessage,
        );
      }
      throw error;
    }
    const observed = toPodObservation(pod, intent);
    this.intents.set(pod.id, intent);
    this.activePods.set(pod.id, observed);
    this.startedAt.set(pod.id, pod.lastStartedAt);
    return observed;
  }

  private startedTimestamp(podId: string): number | null {
    const value = this.startedAt.get(podId);
    if (value === undefined) return null;
    const timestamp = new Date(value);
    return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value
      ? timestamp.getTime()
      : null;
  }

  private remainingStageMs(podId: string, maximumRuntimeSeconds: number): number {
    const started = this.startedTimestamp(podId);
    if (started === null) throw new Cp06PhaseBError("CP06_POD_START_TIME_MISSING");
    return started + maximumRuntimeSeconds * 1_000 - this.now().getTime();
  }

  private async readHealth(podId: string, route: string): Promise<Record<string, unknown>> {
    const response = await this.fetch(`${proxyUrl(podId)}${route}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Cp06PhaseBError("CP06_WORKER_HEALTH_UNAVAILABLE");
    const value = record(await response.json());
    if (!value) throw new Cp06PhaseBError("CP06_WORKER_HEALTH_INVALID");
    return value;
  }

  private async pollHealth(
    podId: string,
    route: string,
    maximumRuntimeSeconds: number,
    complete: (health: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    const started = this.startedTimestamp(podId);
    if (started === null) throw new Cp06PhaseBError("CP06_POD_START_TIME_MISSING");
    const deadline = started + maximumRuntimeSeconds * 1_000;
    let last: Record<string, unknown> | null = null;
    while (this.now().getTime() <= deadline) {
      try {
        last = await this.readHealth(podId, route);
        if (complete(last)) return last;
      } catch (error) {
        if (error instanceof Cp06PhaseBError && error.code !== "CP06_WORKER_HEALTH_UNAVAILABLE") {
          throw error;
        }
      }
      await this.sleep(2_000);
    }
    throw new Cp06PhaseBError(
      last === null ? "CP06_WORKER_HEALTH_TIMEOUT" : "CP06_WORKER_TERMINAL_STATE_TIMEOUT",
    );
  }

  async awaitPreparation(
    podId: string,
    maximumRuntimeSeconds: number,
  ): Promise<Cp06PreparationResult> {
    const health = await this.pollHealth(
      podId,
      "/v1/prepare/health",
      maximumRuntimeSeconds,
      (value) => value.phase === "ready" || value.phase === "failed",
    );
    const intent = this.intents.get(podId);
    if (intent?.role !== "prep" || this.volume === null) {
      throw new Cp06PhaseBError("CP06_PREPARATION_HEALTH_INVALID");
    }
    let validated: ReturnType<RunPodPodControlClient["validateMagePrepHealth"]>;
    try {
      validated = this.options.podClient.validateMagePrepHealth(
        health,
        exactPodAuthority(intent, this.volume.id, this.workerToken),
      );
    } catch {
      throw new Cp06PhaseBError("CP06_PREPARATION_HEALTH_INVALID");
    }
    if (
      validated.phase !== "ready" ||
      validated.prepared !== true ||
      validated.failureCode !== null ||
      validated.modelBytes !== CP06_PHASE_B_MODEL_BYTES ||
      validated.manifestSha256 === null
    ) {
      throw new Cp06PhaseBError("CP06_PREPARATION_HEALTH_INVALID");
    }
    this.preparedManifest = validated.manifestSha256;
    return {
      phase: "ready",
      prepared: true,
      manifestSha256: this.preparedManifest,
      modelBytes: CP06_PHASE_B_MODEL_BYTES,
      completedMarkerWritten: true,
    };
  }

  private async awaitNegative(
    podId: string,
    maximumRuntimeSeconds: number,
    failureCode: Cp06NegativeBootResult["failureCode"],
  ): Promise<Cp06NegativeBootResult> {
    const health = await this.pollHealth(
      podId,
      "/v1/health",
      maximumRuntimeSeconds,
      (value) => value.phase === "error" || value.phase === "ready",
    );
    const model = record(health.model);
    const error = record(health.error);
    if (
      health.schema_version !== "videoforge.mage-worker-health/v2" ||
      health.phase !== "error" ||
      model?.status !== "error" ||
      error?.code !== failureCode
    ) {
      throw new Cp06PhaseBError("CP06_NEGATIVE_HEALTH_INVALID");
    }
    return {
      bootSucceeded: false,
      modelStatus: "error",
      failureCode,
      registryAccessAllowed: false,
      downloadedModelBytes: 0,
    };
  }

  async awaitMissingVolumeBootFailure(podId: string, maximumRuntimeSeconds: number) {
    return this.awaitNegative(podId, maximumRuntimeSeconds, "MAGE_VOLUME_MARKER_INVALID");
  }

  async awaitWrongVolumeHashBootFailure(podId: string, maximumRuntimeSeconds: number) {
    return this.awaitNegative(podId, maximumRuntimeSeconds, "MAGE_VOLUME_ID_MISMATCH");
  }

  async awaitModelReady(podId: string, maximumRuntimeSeconds: number): Promise<Cp06ReadyResult> {
    const health = await this.pollHealth(
      podId,
      "/v1/health",
      maximumRuntimeSeconds,
      (value) => value.phase === "ready" || value.phase === "error",
    );
    const model = record(health.model);
    const gpu = record(health.gpu);
    const timings = record(health.phase_timings_ms);
    if (
      health.schema_version !== "videoforge.mage-worker-health/v2" ||
      health.phase !== "ready" ||
      model?.revision !== CP06_PHASE_B_MODEL_REVISION ||
      model.precision !== "int8-convrot" ||
      model.status !== "ready" ||
      gpu?.offering_id !== CP06_PHASE_B_GPU ||
      gpu.approved !== true ||
      this.preparedManifest === null
    ) {
      throw new Cp06PhaseBError("CP06_MODEL_READY_HEALTH_INVALID");
    }
    const modelReadyMs = Object.values(timings ?? {}).reduce<number>(
      (sum, value) => sum + (finite(value) ?? 0),
      0,
    );
    return {
      manifestSha256: this.preparedManifest,
      registryAccessAllowed: false,
      downloadedModelBytes: 0,
      modelReadyMs: Math.max(1, Math.round(modelReadyMs)),
      readyVramUsedBytes: Math.round(finite(gpu.ready_vram_used_bytes) ?? 0),
    };
  }

  async assertSampleSpendAllowed(
    podId: string,
    input: {
      readonly reservedCumulativeSpendUsd: number;
      readonly internalStopUsd: typeof CP06_PHASE_B_INTERNAL_STOP_USD;
      readonly externalCapUsd: typeof CP06_PHASE_B_EXTERNAL_CAP_USD;
      readonly attemptMaximumRuntimeSeconds: number;
      readonly remainingSampleCount: number;
      readonly perSampleMaximumSeconds: typeof CP06_PHASE_B_SAMPLE_TIMEOUT_SECONDS;
    },
  ): Promise<void> {
    const intent = this.intents.get(podId);
    if (
      intent === undefined ||
      (intent.role !== "positive1" && intent.role !== "positive2") ||
      input.internalStopUsd !== CP06_PHASE_B_INTERNAL_STOP_USD ||
      input.externalCapUsd !== CP06_PHASE_B_EXTERNAL_CAP_USD ||
      input.attemptMaximumRuntimeSeconds !== intent.maximumRuntimeSeconds ||
      input.perSampleMaximumSeconds !== CP06_PHASE_B_SAMPLE_TIMEOUT_SECONDS ||
      !Number.isSafeInteger(input.remainingSampleCount) ||
      input.remainingSampleCount < 1 ||
      input.remainingSampleCount > 4 ||
      !Number.isFinite(input.reservedCumulativeSpendUsd) ||
      input.reservedCumulativeSpendUsd > CP06_PHASE_B_INTERNAL_STOP_USD ||
      input.reservedCumulativeSpendUsd > CP06_PHASE_B_EXTERNAL_CAP_USD
    ) {
      throw new Cp06PhaseBError("CP06_SAMPLE_SPEND_STOP");
    }
    const requiredMs = input.remainingSampleCount * input.perSampleMaximumSeconds * 1_000;
    if (this.remainingStageMs(podId, intent.maximumRuntimeSeconds) < requiredMs) {
      throw new Cp06PhaseBError("CP06_SAMPLE_RUNTIME_STOP");
    }
  }

  async generateOwnedSample(
    podId: string,
    prompt: Cp06RepresentativePrompt,
  ): Promise<Cp06SampleResult> {
    const started = this.now().getTime();
    const intent = this.intents.get(podId);
    if (intent === undefined) throw new Cp06PhaseBError("CP06_GENERATION_AUTHORITY_MISSING");
    const response = await this.fetch(`${proxyUrl(podId)}/v1/generate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.workerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "INLINE_QUALIFICATION_V1",
        attempt_id: prompt.sampleId,
        model_revision: CP06_PHASE_B_MODEL_REVISION,
        items: [
          {
            scene_id: prompt.sampleId,
            positive_prompt: prompt.positivePrompt,
            positive_prompt_sha256: hash(prompt.positivePrompt),
            negative_prompt: prompt.negativePrompt,
            negative_prompt_sha256: hash(prompt.negativePrompt),
            seed: prompt.seed,
            width: 1280,
            height: 720,
          },
        ],
      }),
      signal: AbortSignal.timeout(
        Math.min(
          CP06_PHASE_B_SAMPLE_TIMEOUT_SECONDS * 1_000,
          Math.max(1, this.remainingStageMs(podId, intent.maximumRuntimeSeconds)),
        ),
      ),
    });
    if (!response.ok) {
      let workerCode = "UNSPECIFIED";
      let responseBody = "";
      try {
        responseBody = await response.text();
        workerCode = mageFailureCode(responseBody) ?? workerCode;
      } catch {
        // Status plus a fixed fallback remains safe and actionable.
      }
      const privateFailurePath = path.join(
        this.options.artifactRoot,
        "generation-failure-response.private.txt",
      );
      await mkdir(this.options.artifactRoot, { recursive: true, mode: 0o700 });
      await writeFile(privateFailurePath, responseBody, { mode: 0o600 });
      await chmod(privateFailurePath, 0o600);
      throw new Cp06PhaseBError(`CP06_GENERATION_FAILED_HTTP_${response.status}_${workerCode}`);
    }
    const envelope = record(await response.json());
    if (envelope === null || this.volume === null || this.preparedManifest === null) {
      throw new Cp06PhaseBError("CP06_GENERATION_AUTHORITY_MISSING");
    }
    let accepted: ReturnType<typeof acceptMageResult>;
    try {
      accepted = acceptMageResult(
        envelope,
        {
          attemptId: prompt.sampleId,
          sceneId: prompt.sampleId,
          promptSha256: hash(prompt.positivePrompt),
          negativePromptSha256: hash(prompt.negativePrompt),
          seed: prompt.seed,
          width: 1280,
          height: 720,
          image: intent.imageDigest,
          modelRevision: CP06_PHASE_B_MODEL_REVISION,
          sourceRevision: CP06_PHASE_B_COMFYUI_REVISION,
          gpu: CP06_PHASE_B_GPU,
          podIdHash: hash(podId),
          volumeIdHash: hash(this.volume.id),
          volumeManifestSha256: this.preparedManifest,
          maximumCostUsd: 0.5,
        },
        0,
      );
    } catch {
      throw new Cp06PhaseBError("CP06_GENERATION_RESULT_REJECTED");
    }
    const runtime = record(record(accepted.evidence.runtime_evidence)?.gpu);
    const bytes = accepted.output;
    const directory = path.join(this.options.artifactRoot, "samples");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const filePath = path.join(directory, `${prompt.sampleId}.png`);
    await writeExactArtifact(filePath, bytes);
    const completed = this.now().getTime();
    return {
      sampleId: prompt.sampleId,
      outputObjectKey: `samples/${prompt.sampleId}.png`,
      outputSha256: hash(bytes),
      bytes: bytes.length,
      width: 1280,
      height: 720,
      mediaType: "image/png",
      positivePromptSha256: hash(prompt.positivePrompt),
      negativePromptSha256: hash(prompt.negativePrompt),
      inferenceMs: Math.round(
        finite(accepted.evidence.generation_duration_ms) ?? completed - started,
      ),
      uploadMs: Math.max(
        0,
        completed - started - Math.round(finite(accepted.evidence.generation_duration_ms) ?? 0),
      ),
      peakVramBytes: Math.round(finite(runtime?.peak_vram_used_bytes) ?? 0),
    };
  }

  async createContactSheet(samples: readonly Cp06SampleResult[]): Promise<Cp06ContactSheetResult> {
    const sources = await Promise.all(
      samples.map((sample) =>
        readFile(path.join(this.options.artifactRoot, sample.outputObjectKey)),
      ),
    );
    const bytes = contactSheetPng(sources);
    await mkdir(this.options.artifactRoot, { recursive: true, mode: 0o700 });
    await chmod(this.options.artifactRoot, 0o700);
    const outputPath = path.join(this.options.artifactRoot, "contact-sheet.png");
    await writeExactArtifact(outputPath, bytes);
    return {
      outputObjectKey: "contact-sheet.png",
      outputSha256: hash(bytes),
      bytes: bytes.length,
      mediaType: "image/png",
      sampleIds: samples.map((sample) => sample.sampleId),
    };
  }

  async accruedPodCostUpperBound(
    podId: string,
    maximumRuntimeSeconds: number,
    rateUsdPerHour: number,
  ): Promise<number> {
    const started = this.startedTimestamp(podId);
    const now = this.now().getTime();
    const accruedSeconds =
      started === null || now < started
        ? maximumRuntimeSeconds
        : Math.ceil((now - started) / 1_000) + 60;
    const rate =
      Number.isFinite(rateUsdPerHour) &&
      rateUsdPerHour >= 0 &&
      rateUsdPerHour <= CP06_PHASE_B_RATE_CEILING_USD
        ? rateUsdPerHour
        : CP06_PHASE_B_RATE_CEILING_USD;
    return Math.ceil((accruedSeconds / 3_600) * rate * 1_000_000) / 1_000_000;
  }

  async deletePod(podId: string): Promise<{
    readonly absenceProven: true;
    readonly settledCostUsd: number | null;
  }> {
    const startedAt = this.startedAt.get(podId);
    if (startedAt === undefined) throw new Cp06PhaseBError("CP06_POD_START_TIME_MISSING");
    await this.options.podClient.deleteMagePodAndConfirmAbsent(podId, {
      maximumAttempts: 12,
      intervalMs: 2_000,
    });
    this.activePods.delete(podId);
    const endTime = this.now().toISOString();
    try {
      const billing = await this.options.podClient.settledMagePodBillingStable(
        podId,
        startedAt,
        endTime,
        { maximumAttempts: 12, intervalMs: 5_000, requiredStableObservations: 3 },
      );
      return { absenceProven: true, settledCostUsd: billing.amountUsd };
    } catch {
      return { absenceProven: true, settledCostUsd: null };
    }
  }

  async confirmPodAbsent(podId: string): Promise<void> {
    if (!(await this.options.podClient.confirmMagePodAbsent(podId))) {
      throw new Cp06PhaseBError("CP06_POD_STILL_PRESENT");
    }
    this.activePods.delete(podId);
  }

  async deletePodTemplate(templateId: string): Promise<void> {
    await this.options.podClient.deleteMagePodTemplate(templateId);
  }

  async confirmPodTemplateAbsent(templateId: string): Promise<void> {
    if (!(await this.options.podClient.confirmMagePodTemplateAbsent(templateId))) {
      throw new Cp06PhaseBError("CP06_TEMPLATE_STILL_PRESENT");
    }
    this.template = null;
  }
}

export async function persistCp06PhaseBEvidence(
  filePath: string,
  evidence: Awaited<ReturnType<typeof runCp06MagePhaseB>>,
): Promise<void> {
  if (!path.isAbsolute(filePath)) throw new Cp06PhaseBError("CP06_EVIDENCE_PATH_NOT_ABSOLUTE");
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(filePath), 0o700);
  await writeExactArtifact(filePath, Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8"));
}

export async function main(): Promise<void> {
  const imageDigest = process.env.VIDEOFORGE_CP06_WORKER_IMAGE_DIGEST;
  if (!imageDigest) throw new Cp06PhaseBError("CP06_WORKER_IMAGE_DIGEST_REQUIRED");
  const apiKey = await loadSujalRunPodApiKeyFromKeychain();
  const root = path.resolve(process.cwd(), ".videoforge", "cp06-phase-b");
  const port = new RunPodCp06LiveAdapter({
    apiKey,
    podClient: new RunPodPodControlClient({ apiKey }),
    inventoryClient: new RunPodControlClient({ apiKey }),
    artifactRoot: path.join(root, "outputs"),
    journalPath: path.join(root, "intent-attempt-journal.jsonl"),
    workerImageDigest: imageDigest,
  });
  const evidence = await runCp06MagePhaseB(port, {
    workerImageDigest: imageDigest,
    journalPath: path.join(root, "intent-attempt-journal.jsonl"),
    externalCapUsd: CP06_PHASE_B_EXTERNAL_CAP_USD,
    internalStopUsd: CP06_PHASE_B_INTERNAL_STOP_USD,
  });
  await persistCp06PhaseBEvidence(path.join(root, "evidence.json"), evidence);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
