import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Download,
  FileAudio,
  Images,
  RefreshCw,
  ShieldCheck,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import {
  Badge,
  Button,
  Disclosure,
  EmptyState,
  Metric,
  Panel,
  ProgressBar,
} from "../components/ui";

const MAX_VOICEOVER_BYTES = 1_073_741_824;
const MAX_AVATAR_BYTES = 20 * 1024 * 1024;
const MAX_STYLE_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_STYLE_REFERENCES = 8;
const MIN_STYLE_REFERENCES = 3;
const DEFAULT_SPEND_CAP_USD = "1.00";
const HOSTED_CREATE_SCHEMA = "videoforge-hosted-project-create/v2";
const VOICEOVER_TYPES = new Set(["audio/wav"]);
export const HOSTED_SHA256_CHUNK_BYTES = 4 * 1024 * 1024;

const SHA256_INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
  0x5be0cd19,
] as const;
const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

export interface CatalogResponse {
  readonly avatars: readonly {
    profile_id: string;
    version_id: string;
    name: string;
    version_number: number;
    state?: string;
    status?: string;
    thumbnail_url?: string | null;
    profile_hash?: string | null;
    compatibility?: string | null;
    rights_status?: string | null;
  }[];
  readonly styles: readonly {
    style_id: string;
    version_id: string;
    name: string;
    version_number: number;
    state?: string;
    status?: string;
    cover_url?: string | null;
    profile_hash?: string | null;
    reference_count?: number;
  }[];
  readonly media_worker_state: "ONLINE" | "WAITING_FOR_YOUR_COMPUTER";
  readonly gpu_transport: "DISABLED_UNQUALIFIED";
  readonly gpu_readiness: {
    readonly schema_version: "videoforge-hosted-gpu-readiness/v1";
    readonly gpu_transport: "DISABLED_UNQUALIFIED";
    readonly provider_calls_authorized: false;
    readonly dispatch_available: false;
    readonly lanes: readonly {
      readonly lane: "MAGE_IMAGE" | "SOULX_AVATAR";
      readonly checkpoint: "V2-07" | "V2-08";
      readonly qualification: "NOT_QUALIFIED";
      readonly visual_approval: "NOT_APPLICABLE" | "APPROVED_EXACT_FULL_AND_SPLIT";
      readonly provider_free_groundwork_commits: readonly string[];
      readonly missing_gates: readonly string[];
    }[];
  };
  readonly project_defaults?: {
    readonly generation_mode?: string;
    readonly spend_cap_usd?: number;
    readonly user_seed?: number | null;
  };
}

const GPU_READINESS_KEYS = [
  "dispatch_available",
  "gpu_transport",
  "lanes",
  "provider_calls_authorized",
  "schema_version",
] as const;
const GPU_LANE_KEYS = [
  "checkpoint",
  "lane",
  "missing_gates",
  "provider_free_groundwork_commits",
  "qualification",
  "visual_approval",
] as const;
const MAGE_GROUNDWORK_COMMITS = ["1283a23248c9b79832b6fb331b00474e1df70f81"] as const;
const MAGE_MISSING_GATES = ["identity_output", "cancellation_timeout", "max2_concurrency"] as const;
const SOULX_GROUNDWORK_COMMITS = [
  "7039092707103ab35e8010c009e14409a6e52f63",
  "84e00881d98e3e77dd8aad121453ed6e7287bc74",
  "e49b93854d58c4faeb8bdd10b9b9df07321026db",
  "f3557059d7d5f0637ea223b3e758389fbd80a52b",
] as const;
const SOULX_MISSING_GATES = [
  "V2_07_MAGE_QUALIFICATION",
  "V2_08_IMAGE_PUBLICATION_AND_ENDPOINT_CONFIGURATION",
  "V2_08_MAX1_LIVE_QUALIFICATION",
] as const;

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isExactStringArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  );
}

export function isFailClosedGpuReadiness(
  value: unknown,
): value is CatalogResponse["gpu_readiness"] {
  if (!value || typeof value !== "object") return false;
  const readiness = value as Partial<CatalogResponse["gpu_readiness"]>;
  if (
    !hasExactKeys(readiness, GPU_READINESS_KEYS) ||
    readiness.schema_version !== "videoforge-hosted-gpu-readiness/v1" ||
    readiness.gpu_transport !== "DISABLED_UNQUALIFIED" ||
    readiness.provider_calls_authorized !== false ||
    readiness.dispatch_available !== false ||
    !Array.isArray(readiness.lanes) ||
    readiness.lanes.length !== 2
  ) {
    return false;
  }
  const [mage, soulx] = readiness.lanes;
  return Boolean(
    mage &&
      hasExactKeys(mage, GPU_LANE_KEYS) &&
      mage.lane === "MAGE_IMAGE" &&
      mage.checkpoint === "V2-07" &&
      mage.qualification === "NOT_QUALIFIED" &&
      mage.visual_approval === "NOT_APPLICABLE" &&
      isExactStringArray(mage.provider_free_groundwork_commits, MAGE_GROUNDWORK_COMMITS) &&
      isExactStringArray(mage.missing_gates, MAGE_MISSING_GATES) &&
      soulx &&
      hasExactKeys(soulx, GPU_LANE_KEYS) &&
      soulx.lane === "SOULX_AVATAR" &&
      soulx.checkpoint === "V2-08" &&
      soulx.qualification === "NOT_QUALIFIED" &&
      soulx.visual_approval === "APPROVED_EXACT_FULL_AND_SPLIT" &&
      isExactStringArray(soulx.provider_free_groundwork_commits, SOULX_GROUNDWORK_COMMITS) &&
      isExactStringArray(soulx.missing_gates, SOULX_MISSING_GATES),
  );
}

async function readHostedCatalog(): Promise<CatalogResponse> {
  const catalog = await readJson<CatalogResponse>("/api/v2/hosted/project-catalog");
  if (!isFailClosedGpuReadiness(catalog.gpu_readiness)) {
    throw new Error("Hosted GPU readiness is unavailable.");
  }
  return catalog;
}

interface HostedAttempt {
  readonly id: string;
  readonly kind: "ASR" | "RENDER" | "MAGE_IMAGE" | "SOULX_AVATAR";
  readonly state: string;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly terminal_at: string | null;
  readonly output_checksum_sha256: string | null;
  readonly approved_at: string | null;
  readonly preview_url: string | null;
  readonly error_code?: string | null;
  readonly error_message?: string | null;
  readonly retry_of_attempt_id?: string | null;
  readonly asset_id?: string | null;
  readonly progress_percent?: number | null;
  readonly queue_position?: number | null;
  readonly timing?: HostedTiming | null;
  readonly cost?: HostedCost | null;
}

interface HostedTiming {
  readonly queue_wait_ms?: number | null;
  readonly initialization_ms?: number | null;
  readonly model_ready_ms?: number | null;
  readonly inference_ms?: number | null;
  readonly upload_ms?: number | null;
  readonly render_ms?: number | null;
  readonly end_to_end_ms?: number | null;
}

interface HostedCost {
  readonly projected_usd?: number | null;
  readonly settled_usd?: number | null;
  readonly cap_usd?: number | null;
  readonly billed_seconds?: number | null;
  readonly provider?: string | null;
}

interface HostedQueueSnapshot {
  readonly position?: number | null;
  readonly ahead?: number | null;
  readonly total?: number | null;
  readonly status?: string | null;
  readonly estimated_wait_ms?: number | null;
  readonly fair_rotation?: string | null;
}

interface HostedStage {
  readonly id?: string;
  readonly name: string;
  readonly status: string;
  readonly progress_percent?: number | null;
  readonly started_at?: string | null;
  readonly completed_at?: string | null;
  readonly detail?: string | null;
  readonly eta_ms?: number | null;
}

interface HostedScaleToZero {
  readonly state: string;
  readonly worker_count?: number | null;
  readonly observed_at?: string | null;
  readonly evidence_id?: string | null;
  readonly detail?: string | null;
}

interface HostedQualityFlag {
  readonly id?: string;
  readonly asset_id?: string | null;
  readonly category: string;
  readonly severity?: string | null;
  readonly status: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly replacement_allowed?: boolean;
}

interface HostedContactSheetItem {
  readonly id?: string;
  readonly asset_id?: string | null;
  readonly image_url: string;
  readonly label?: string | null;
  readonly start_ms?: number | null;
  readonly end_ms?: number | null;
  readonly shot_role?: string | null;
}

interface HostedReviewSnapshot {
  readonly contact_sheet?: readonly HostedContactSheetItem[];
  readonly quality_flags?: readonly HostedQualityFlag[];
  readonly manifest_url?: string | null;
  readonly download_url?: string | null;
}

interface ProjectDetailResponse {
  readonly project: {
    id: string;
    title: string;
    created_at: string;
    revision_id: string;
    revision_state: string;
  };
  readonly attempts: readonly HostedAttempt[];
  readonly gpu_transport: "DISABLED_UNQUALIFIED";
  readonly gpu_readiness: CatalogResponse["gpu_readiness"];
  readonly generation: null | {
    readonly id: string;
    readonly timeline_plan_sha256: string;
    readonly planned_tasks: number | string;
    readonly completed_tasks: number | string;
    readonly failed_tasks: number | string;
    readonly stage: "WAITING_FOR_GPU_QUALIFICATION" | "READY_FOR_RENDER" | "FAILED";
  };
  readonly queue?: HostedQueueSnapshot | null;
  readonly stages?: readonly HostedStage[];
  readonly timing?: HostedTiming | null;
  readonly cost?: HostedCost | null;
  readonly scale_to_zero?: HostedScaleToZero | null;
  readonly review?: HostedReviewSnapshot | null;
  readonly contact_sheet?: readonly HostedContactSheetItem[];
  readonly quality_flags?: readonly HostedQualityFlag[];
  readonly manifest_url?: string | null;
}

interface HostedUsageResponse {
  readonly current_month_provider_cpu_usd: 0;
  readonly current_month_gpu_usd: 0;
  readonly attempts: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly personal_worker_seconds: number;
  readonly retained_bytes: number;
  readonly storage_policy: string;
  readonly as_of?: string | null;
  readonly fixed_recurring_usd?: number | null;
  readonly projects?: readonly {
    readonly project_id: string;
    readonly title: string;
    readonly attempts?: number;
    readonly projected_usd?: number | null;
    readonly settled_usd?: number | null;
    readonly worker_seconds?: number | null;
    readonly queue_wait_ms?: number | null;
    readonly end_to_end_ms?: number | null;
  }[];
  readonly lanes?: readonly {
    readonly lane: string;
    readonly projected_usd?: number | null;
    readonly settled_usd?: number | null;
    readonly billed_seconds?: number | null;
  }[];
}

interface HostedPreflightResponse {
  readonly ok?: boolean;
  readonly ready?: boolean;
  readonly blockers?: readonly {
    readonly code?: string;
    readonly message: string;
    readonly severity?: string;
  }[];
  readonly estimate?: {
    readonly projected_usd?: number | null;
    readonly minimum_usd?: number | null;
    readonly maximum_usd?: number | null;
    readonly cap_usd?: number | null;
    readonly detail?: string | null;
  } | null;
  readonly revision_id?: string | null;
}

interface HostedUploadDescriptor {
  readonly url: string;
  readonly requiredHeaders?: Readonly<Record<string, string>>;
  readonly asset_id?: string;
}

interface HostedPresetMutationResponse {
  readonly id?: string;
  readonly profile_id?: string;
  readonly style_id?: string;
  readonly project_id?: string;
  readonly version_id?: string;
  readonly state?: string;
  readonly upload?: HostedUploadDescriptor | null;
  readonly uploads?: readonly HostedUploadDescriptor[];
  readonly version?: number;
  readonly profile?: Record<string, unknown> | null;
  readonly profile_hash?: string | null;
  readonly thumbnail_url?: string | null;
  readonly cover_url?: string | null;
  readonly summary?: string | null;
}

const FILE_ACCESS_HINT =
  'Chrome could not read the selected file. Open chrome://extensions, choose Details for the ChatGPT browser extension, enable "Allow access to file URLs," then choose the file again.';

export async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const result = await fetch(path, {
    ...init,
    headers: { accept: "application/json", "content-type": "application/json", ...init?.headers },
  });
  const payload = (await result.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | T
    | null;
  if (!result.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload ? payload.error : null;
    throw new Error(error?.message ?? error?.code ?? "VideoForge hosted request failed.");
  }
  return payload as T;
}

async function bounded<T>(promise: Promise<T>, message: string, timeoutMs = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (typeof timer !== "undefined") clearTimeout(timer);
  }
}

/** Blob.arrayBuffer() can remain pending for extension-backed file inputs in Chrome. */
async function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      reader.abort();
      fail();
    }, 10_000);
    const fail = () => {
      if (typeof timeout !== "undefined") clearTimeout(timeout);
      reject(new Error(FILE_ACCESS_HINT));
    };
    reader.onload = () => {
      if (typeof timeout !== "undefined") clearTimeout(timeout);
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else fail();
    };
    reader.onerror = fail;
    reader.onabort = fail;
    reader.readAsArrayBuffer(blob);
  });
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

class IncrementalSha256 {
  readonly #state = new Uint32Array(SHA256_INITIAL_STATE);
  readonly #block = new Uint8Array(64);
  readonly #schedule = new Uint32Array(64);
  #blockLength = 0;
  #bytesHashed = 0;
  #finished = false;

  update(bytes: Uint8Array): void {
    if (this.#finished) throw new Error("SHA-256 digest is already finalized.");
    this.#bytesHashed += bytes.byteLength;
    let offset = 0;

    if (this.#blockLength > 0) {
      const needed = 64 - this.#blockLength;
      const copied = Math.min(needed, bytes.byteLength);
      this.#block.set(bytes.subarray(0, copied), this.#blockLength);
      this.#blockLength += copied;
      offset += copied;
      if (this.#blockLength === 64) {
        this.#compress(this.#block, 0);
        this.#blockLength = 0;
      }
    }

    while (offset + 64 <= bytes.byteLength) {
      this.#compress(bytes, offset);
      offset += 64;
    }
    if (offset < bytes.byteLength) {
      this.#block.set(bytes.subarray(offset), 0);
      this.#blockLength = bytes.byteLength - offset;
    }
  }

  digestHex(): string {
    if (this.#finished) throw new Error("SHA-256 digest is already finalized.");
    this.#finished = true;
    const bitLength = this.#bytesHashed * 8;

    this.#block[this.#blockLength++] = 0x80;
    if (this.#blockLength > 56) {
      this.#block.fill(0, this.#blockLength);
      this.#compress(this.#block, 0);
      this.#blockLength = 0;
    }
    this.#block.fill(0, this.#blockLength, 56);
    const view = new DataView(this.#block.buffer);
    view.setUint32(56, Math.floor(bitLength / 0x1_0000_0000), false);
    view.setUint32(60, bitLength >>> 0, false);
    this.#compress(this.#block, 0);

    return Array.from(this.#state, (word) => word.toString(16).padStart(8, "0")).join("");
  }

  #compress(bytes: Uint8Array, offset: number): void {
    const words = this.#schedule;
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] =
        ((bytes[start]! << 24) |
          (bytes[start + 1]! << 16) |
          (bytes[start + 2]! << 8) |
          bytes[start + 3]!) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const prior15 = words[index - 15]!;
      const prior2 = words[index - 2]!;
      const sigma0 =
        rotateRight(prior15, 7) ^ rotateRight(prior15, 18) ^ (prior15 >>> 3);
      const sigma1 = rotateRight(prior2, 17) ^ rotateRight(prior2, 19) ^ (prior2 >>> 10);
      words[index] =
        (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let a = this.#state[0]!;
    let b = this.#state[1]!;
    let c = this.#state[2]!;
    let d = this.#state[3]!;
    let e = this.#state[4]!;
    let f = this.#state[5]!;
    let g = this.#state[6]!;
    let h = this.#state[7]!;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choose + SHA256_ROUND_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    this.#state[0] = (this.#state[0]! + a) >>> 0;
    this.#state[1] = (this.#state[1]! + b) >>> 0;
    this.#state[2] = (this.#state[2]! + c) >>> 0;
    this.#state[3] = (this.#state[3]! + d) >>> 0;
    this.#state[4] = (this.#state[4]! + e) >>> 0;
    this.#state[5] = (this.#state[5]! + f) >>> 0;
    this.#state[6] = (this.#state[6]! + g) >>> 0;
    this.#state[7] = (this.#state[7]! + h) >>> 0;
  }
}

function abortError(): DOMException {
  return new DOMException("File hashing was cancelled.", "AbortError");
}

interface HostedFileHashOptions {
  readonly signal?: AbortSignal;
  readonly readChunk?: (chunk: Blob) => Promise<ArrayBuffer>;
}

/** Incremental SHA-256 keeps peak file memory bounded to one fixed-size slice. */
export async function hostedFileSha256(
  file: Blob,
  options: HostedFileHashOptions = {},
): Promise<`sha256:${string}`> {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_VOICEOVER_BYTES) {
    throw new Error("The selected file is outside the bounded hashing contract.");
  }
  const hash = new IncrementalSha256();
  const readChunk = options.readChunk ?? readBlobBytes;
  for (let offset = 0; offset < file.size; offset += HOSTED_SHA256_CHUNK_BYTES) {
    if (options.signal?.aborted) throw abortError();
    const end = Math.min(file.size, offset + HOSTED_SHA256_CHUNK_BYTES);
    const buffer = await readChunk(file.slice(offset, end));
    if (options.signal?.aborted) throw abortError();
    if (buffer.byteLength !== end - offset) throw new Error(FILE_ACCESS_HINT);
    hash.update(new Uint8Array(buffer));
    if (end < file.size && end % (HOSTED_SHA256_CHUNK_BYTES * 4) === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return `sha256:${hash.digestHex()}`;
}

function readAscii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(
    ...Array.from({ length }, (_, index) => view.getUint8(offset + index)),
  );
}

/** Read duration from the RIFF/WAVE container without relying on media-element events. */
export function parseWavDurationMs(
  buffer: ArrayBuffer,
  totalByteLength = buffer.byteLength,
): number | null {
  const view = new DataView(buffer);
  if (
    !Number.isSafeInteger(totalByteLength) ||
    totalByteLength < buffer.byteLength ||
    view.byteLength < 12 ||
    readAscii(view, 0, 4) !== "RIFF" ||
    readAscii(view, 8, 4) !== "WAVE"
  ) {
    return null;
  }
  let offset = 12;
  let byteRate = 0;
  let dataBytes = 0;
  while (offset + 8 <= view.byteLength) {
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkId = readAscii(view, offset, 4);
    if (chunkId === "fmt " && chunkSize >= 12 && chunkStart + 12 <= view.byteLength)
      byteRate = view.getUint32(chunkStart + 8, true);
    if (chunkId === "data") {
      if (chunkStart + chunkSize > totalByteLength) return null;
      dataBytes = chunkSize;
      break;
    }
    if (chunkStart + chunkSize > view.byteLength) return null;
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (!Number.isSafeInteger(byteRate) || byteRate <= 0 || !Number.isSafeInteger(dataBytes))
    return null;
  return Math.round((dataBytes / byteRate) * 1_000);
}

function validateAudioDurationMs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 10_000 || value > 3_600_000)
    throw new Error("Voiceover must be between 10 seconds and 60 minutes.");
  return value;
}

export async function audioDurationMs(file: File): Promise<number> {
  if (file.type === "audio/wav" || /\.wav$/iu.test(file.name)) {
    const parsed = parseWavDurationMs(
      await readBlobBytes(file.slice(0, Math.min(file.size, 1024 * 1024))),
      file.size,
    );
    if (parsed !== null) return validateAudioDurationMs(parsed);
  }
  const url = URL.createObjectURL(file);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error("Voiceover duration could not be read."));
      timeout = setTimeout(() => reject(new Error("Voiceover duration could not be read.")), 5_000);
    });
    const value = Math.round(audio.duration * 1_000);
    return validateAudioDurationMs(value);
  } finally {
    if (typeof timeout !== "undefined") clearTimeout(timeout);
    URL.revokeObjectURL(url);
  }
}

function formatUsd(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(2)}`
    : "Not reported";
}

function formatMilliseconds(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "Not reported";
  const seconds = Math.round(value / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not reported" : date.toLocaleString();
}

function normalizedStatus(value: string | null | undefined): string {
  return (value ?? "NOT_REPORTED").replaceAll("_", " ");
}

function statusTone(
  value: string | null | undefined,
): "neutral" | "success" | "warning" | "danger" | "info" {
  const status = (value ?? "").toUpperCase();
  if (
    ["SUCCEEDED", "COMPLETE", "COMPLETED", "READY", "PUBLISHED", "APPROVED", "PASSED"].includes(
      status,
    )
  )
    return "success";
  if (["FAILED", "BLOCKED", "REJECTED", "ERROR"].includes(status)) return "danger";
  if (["WAITING", "QUEUED", "RUNNING", "IN_PROGRESS", "REVIEW_REQUIRED"].includes(status))
    return "warning";
  return "info";
}

function preflightReady(value: HostedPreflightResponse | null): boolean {
  return value?.ready === true && value?.ok === true;
}

function attemptLabel(kind: HostedAttempt["kind"]): string {
  if (kind === "ASR") return "Transcribe voiceover";
  if (kind === "MAGE_IMAGE") return "Generate scene image";
  if (kind === "SOULX_AVATAR") return "Generate avatar segment";
  return "Render final video";
}

function preflightBlockers(value: HostedPreflightResponse | null): readonly string[] {
  return (value?.blockers ?? []).map((blocker) =>
    blocker.code ? `${blocker.code}: ${blocker.message}` : blocker.message,
  );
}

async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image dimensions could not be read."));
    });
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("Image dimensions could not be read.");
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function putHostedUpload(upload: HostedUploadDescriptor, file: File): Promise<void> {
  const headers = Object.fromEntries(
    Object.entries(upload.requiredHeaders ?? {}).filter(
      ([key]) => key.toLowerCase() !== "content-length",
    ),
  );
  const result = await bounded(
    fetch(upload.url, { method: "PUT", headers, body: file }),
    "Private upload timed out. Retry this step.",
  );
  if (!result.ok) throw new Error(`Private upload failed (HTTP ${result.status}).`);
}

const ENCODED_UNSAFE_RETURN_TO_CHARACTERS = /%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/iu;

function hasUnsafeReturnToCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return character === "\\" || code <= 0x1f || code === 0x7f;
  });
}

function normalizedInternalPath(value: string, origin: string): string | null {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    hasUnsafeReturnToCharacter(value) ||
    ENCODED_UNSAFE_RETURN_TO_CHARACTERS.test(value)
  ) {
    return null;
  }
  try {
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function normalizeHostedReturnTo(
  value: string | null,
  fallback: string,
  origin = window.location.origin,
): string {
  return (value === null ? null : normalizedInternalPath(value, origin)) ??
    normalizedInternalPath(fallback, origin) ??
    "/";
}

function presetVersionId(
  item: CatalogResponse["avatars"][number] | CatalogResponse["styles"][number],
) {
  return item.version_id;
}

function presetState(item: CatalogResponse["avatars"][number] | CatalogResponse["styles"][number]) {
  return item.status ?? item.state ?? "READY";
}

const HUMAN_PIPELINE_STAGES = [
  "Prepare",
  "Transcribe",
  "Plan",
  "Write image prompts",
  "Generate images",
  "Generate avatar",
  "Assemble",
  "Technical check",
  "Review",
] as const;

function fallbackHostedStages(
  asr: HostedAttempt | undefined,
  render: HostedAttempt | undefined,
  generation: ProjectDetailResponse["generation"],
): readonly HostedStage[] {
  const asrStatus = asr?.state === "SUCCEEDED" ? "COMPLETE" : asr ? asr.state : "NOT_STARTED";
  const planStatus = generation
    ? "COMPLETE"
    : asr?.state === "SUCCEEDED"
      ? "PERSISTENCE_UNAVAILABLE"
      : "WAITING";
  const renderStatus =
    render?.state ?? (generation ? normalizedStatus(generation.stage) : "WAITING");
  return HUMAN_PIPELINE_STAGES.map((name) => ({
    name,
    status:
      name === "Transcribe"
        ? asrStatus
        : name === "Plan"
          ? planStatus
          : name === "Review"
            ? render?.state === "SUCCEEDED"
              ? "REVIEW_REQUIRED"
              : "WAITING"
            : name === "Technical check" || name === "Assemble"
              ? renderStatus
              : "NOT_REPORTED",
    detail: "Durable stage detail was not returned by the hosted service.",
  }));
}

export function HostedCreateProjectScreen() {
  const catalog = useQuery({
    queryKey: ["hosted-project-catalog"],
    queryFn: readHostedCatalog,
  });
  const [title, setTitle] = useState("");
  const [avatarVersionId, setAvatarVersionId] = useState("");
  const [styleVersionId, setStyleVersionId] = useState("");
  const [voiceover, setVoiceover] = useState<File | null>(null);
  const [extraPromptKeywords, setExtraPromptKeywords] = useState("");
  const [applyExtraPromptKeywords, setApplyExtraPromptKeywords] = useState(false);
  const [userSeed, setUserSeed] = useState("");
  const [spendCapUsd, setSpendCapUsd] = useState(DEFAULT_SPEND_CAP_USD);
  const [voiceoverMeta, setVoiceoverMeta] = useState<{
    readonly contentType: string;
    readonly checksumSha256: string;
    readonly durationMs: number;
  } | null>(null);
  const [preflightResult, setPreflightResult] = useState<HostedPreflightResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contentTypeForVoiceover = (file: File): string => {
    if (/\.wav$/iu.test(file.name)) return "audio/wav";
    return file.type === "audio/wav" ? file.type : "";
  };
  const cap = Number(spendCapUsd);
  const capValid = Number.isFinite(cap) && cap >= 0.1 && cap <= 2;
  const keywordsValid = extraPromptKeywords.length <= 500;
  const canPreflight = Boolean(
    title.trim() && avatarVersionId && styleVersionId && voiceover && capValid && keywordsValid,
  );
  const preflightMutation = useMutation({
    mutationFn: async () => {
      if (!voiceover) throw new Error("Choose a voiceover first.");
      const contentType = contentTypeForVoiceover(voiceover);
      if (!VOICEOVER_TYPES.has(contentType))
        throw new Error("Use PCM or IEEE-float WAV audio for hosted generation.");
      if (voiceover.size > MAX_VOICEOVER_BYTES) throw new Error("Voiceover must be at most 1 GB.");
      const checksumSha256 = await hostedFileSha256(voiceover);
      const durationMs = await bounded(
        audioDurationMs(voiceover),
        "Voiceover duration timed out. Choose a valid WAV file and retry.",
        15_000,
      );
      const result = await bounded(
        readJson<HostedPreflightResponse>("/api/v2/hosted/projects/preflight", {
          method: "POST",
          body: JSON.stringify({
            schema_version: "videoforge-hosted-project-preflight/v1",
            title: title.trim(),
            avatar_profile_version_id: avatarVersionId,
            image_style_version_id: styleVersionId,
            extra_prompt_keywords: applyExtraPromptKeywords ? extraPromptKeywords.trim() : "",
            apply_extra_prompt_keywords: applyExtraPromptKeywords,
            user_seed: userSeed.trim() ? Number(userSeed) : null,
            spend_cap_usd: cap,
            voiceover: {
              filename: voiceover.name,
              content_type: contentType,
              content_length: voiceover.size,
              checksum_sha256: checksumSha256,
              duration_ms: durationMs,
            },
          }),
        }),
        "Hosted preflight timed out. Retry the readiness check.",
      );
      return { result, contentType, checksumSha256, durationMs };
    },
    onSuccess: ({ result, contentType, checksumSha256, durationMs }) => {
      setVoiceoverMeta({ contentType, checksumSha256, durationMs });
      setPreflightResult(result);
      setError(null);
    },
    onError: (value) => {
      setPreflightResult(null);
      setError(value instanceof Error ? value.message : "Hosted preflight failed.");
    },
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (!voiceover) throw new Error("Choose a voiceover first.");
      if (!preflightReady(preflightResult))
        throw new Error("Run a successful readiness check before generating.");
      setError(null);
      const metadata =
        voiceoverMeta ??
        (() => {
          throw new Error("Run the readiness check again before generating.");
        })();
      const idempotencyKey = `browser-project-${crypto.randomUUID()}`;
      const created = await bounded(
        readJson<{
          project_id: string;
          state: "UPLOAD_PENDING" | "READY";
          upload: null | {
            url: string;
            requiredHeaders: Readonly<Record<string, string>>;
          };
        }>("/api/v2/hosted/projects", {
          method: "POST",
          headers: { "idempotency-key": idempotencyKey },
          body: JSON.stringify({
            schema_version: HOSTED_CREATE_SCHEMA,
            title: title.trim(),
            avatar_profile_version_id: avatarVersionId,
            image_style_version_id: styleVersionId,
            extra_prompt_keywords: applyExtraPromptKeywords ? extraPromptKeywords.trim() : "",
            apply_extra_prompt_keywords: applyExtraPromptKeywords,
            user_seed: userSeed.trim() ? Number(userSeed) : null,
            spend_cap_usd: cap,
            voiceover: {
              filename: voiceover.name,
              content_type: metadata.contentType,
              content_length: voiceover.size,
              checksum_sha256: metadata.checksumSha256,
              duration_ms: metadata.durationMs,
            },
          }),
        }),
        "Hosted project creation timed out. Retry from Create Project.",
      );
      if (created.upload) {
        const headers = Object.fromEntries(
          Object.entries(created.upload.requiredHeaders).filter(
            ([key]) => key !== "content-length",
          ),
        );
        const uploadController = new AbortController();
        const uploaded = await bounded(
          fetch(created.upload.url, {
            signal: uploadController.signal,
            method: "PUT",
            headers,
            body: voiceover,
          }),
          "Private voiceover upload timed out. Retry from Create Project.",
        ).catch((error) => {
          uploadController.abort();
          throw error;
        });
        if (!uploaded.ok)
          throw new Error(`Private voiceover upload failed (HTTP ${uploaded.status}).`);
      }
      const ready = await bounded(
        readJson<{ project_id: string; cpu_submission: unknown }>(
          `/api/v2/hosted/projects/${created.project_id}/commit`,
          { method: "POST", body: "{}" },
        ),
        "Hosted project commit timed out. Retry from Create Project.",
      );
      await bounded(
        readJson("/api/v2/cpu-attempts", {
          method: "POST",
          body: JSON.stringify(ready.cpu_submission),
        }),
        "Hosted ASR submission timed out. Retry from Create Project.",
      );
      return ready.project_id;
    },
    onSuccess: (projectId) => window.location.assign(`/projects/${projectId}`),
    onError: (value) =>
      setError(value instanceof Error ? value.message : "Project could not be created."),
  });

  if (catalog.isPending)
    return (
      <Panel eyebrow="Hosted project" heading="Loading private catalog">
        <p>Checking presets and your computer…</p>
      </Panel>
    );
  if (catalog.isError || !catalog.data)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Create Project unavailable"
        body="Hosted tenant catalog could not be loaded."
        action={
          <Button variant="secondary" onClick={() => void catalog.refetch()}>
            Retry
          </Button>
        }
      />
    );

  return (
    <>
      <PageHeader
        eyebrow="Private hosted generation"
        title="Create Project"
        description="Review the exact inputs, cap, and measured readiness before generating once."
      />
      {catalog.data.media_worker_state !== "ONLINE" ? (
        <div className="notice" role="status">
          <strong>Waiting for your computer.</strong> Install and connect the worker in Settings
          before generating.
        </div>
      ) : null}
      <div className="grid grid-2">
        <Panel eyebrow="Project" heading="Inputs">
          <label className="field">
            <span>Title</span>
            <input
              value={title}
              maxLength={240}
              onChange={(event) => {
                setTitle(event.target.value);
                setPreflightResult(null);
              }}
            />
          </label>
          <label className="field">
            <span>Final English voiceover</span>
            <input
              aria-label="Final English voiceover"
              type="file"
              accept="audio/wav,.wav"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setPreflightResult(null);
                setVoiceoverMeta(null);
                if (!selected) {
                  setVoiceover(null);
                  setError(FILE_ACCESS_HINT);
                  return;
                }
                if (selected.size > MAX_VOICEOVER_BYTES) {
                  setVoiceover(null);
                  setError("Voiceover must be at most 1 GB.");
                  return;
                }
                setVoiceover(selected);
                setError(null);
              }}
            />
            <small>
              WAV, MP3, M4A/AAC, or FLAC · 10 seconds–60 minutes · at most 1 GB
              {voiceover ? ` · ${(voiceover.size / 1_000_000).toFixed(1)} MB selected` : ""}
            </small>
          </label>
          <label className="field">
            <span>Avatar Profile</span>
            <select
              value={avatarVersionId}
              onChange={(event) => {
                setAvatarVersionId(event.target.value);
                setPreflightResult(null);
              }}
            >
              <option value="">Choose a ready avatar</option>
              {catalog.data.avatars.map((avatar) => (
                <option key={avatar.version_id} value={avatar.version_id}>
                  {avatar.name} · v{avatar.version_number}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Image Style</span>
            <select
              value={styleVersionId}
              onChange={(event) => {
                setStyleVersionId(event.target.value);
                setPreflightResult(null);
              }}
            >
              <option value="">Choose a published style</option>
              {catalog.data.styles.map((style) => (
                <option key={style.version_id} value={style.version_id}>
                  {style.name} · v{style.version_number}
                </option>
              ))}
            </select>
          </label>
          <label className="toggle-row">
            <span>
              <strong>Use extra image-prompt keywords</strong>
              <small>
                Applied to image prompts only; the exact toggle is pinned into the revision.
              </small>
            </span>
            <input
              type="checkbox"
              checked={applyExtraPromptKeywords}
              onChange={(event) => {
                setApplyExtraPromptKeywords(event.target.checked);
                setPreflightResult(null);
              }}
            />
          </label>
          {applyExtraPromptKeywords ? (
            <label className="field">
              <span>Extra prompt keywords</span>
              <textarea
                value={extraPromptKeywords}
                maxLength={500}
                rows={3}
                onChange={(event) => {
                  setExtraPromptKeywords(event.target.value);
                  setPreflightResult(null);
                }}
                placeholder="natural light, tactile materials"
              />
              <small>{extraPromptKeywords.length}/500 characters</small>
            </label>
          ) : null}
          <div className="grid grid-2">
            <label className="field">
              <span>Spend cap (USD)</span>
              <input
                inputMode="decimal"
                type="number"
                min="0.1"
                max="2"
                step="0.01"
                value={spendCapUsd}
                onChange={(event) => {
                  setSpendCapUsd(event.target.value);
                  setPreflightResult(null);
                }}
              />
              <small>Finite cap reserved before provider dispatch.</small>
            </label>
            <label className="field">
              <span>User seed (optional)</span>
              <input
                inputMode="numeric"
                type="number"
                value={userSeed}
                onChange={(event) => {
                  setUserSeed(event.target.value);
                  setPreflightResult(null);
                }}
                placeholder="Deterministic variation"
              />
              <small>Leave blank for the workspace default.</small>
            </label>
          </div>
        </Panel>
        <Panel eyebrow="Readiness" heading="Generation check">
          <p>
            <Check size={16} /> Tenant-private Neon and R2 lineage
          </p>
          <p>
            <Check size={16} /> Personal CPU compute: $0 provider charge
          </p>
          <p>
            <Check size={16} /> GPU transport: {catalog.data.gpu_readiness.gpu_transport}
          </p>
          {catalog.data.gpu_readiness.lanes.map((lane) => (
            <div key={lane.lane}>
              <p>
                <AlertTriangle size={16} /> {lane.checkpoint} {lane.lane}: {lane.qualification}
              </p>
              {lane.visual_approval === "APPROVED_EXACT_FULL_AND_SPLIT" ? (
                <p>Crop: APPROVED_EXACT_FULL_AND_SPLIT</p>
              ) : null}
              <p>Missing gates: {lane.missing_gates.join(", ")}</p>
            </div>
          ))}
          {catalog.data.avatars.length === 0 ? (
            <p className="validation validation-danger">
              Create and approve an Avatar Profile first.
            </p>
          ) : null}
          {catalog.data.styles.length === 0 ? (
            <p className="validation validation-danger">Publish an Image Style first.</p>
          ) : null}
          {preflightResult ? (
            <div
              className={
                preflightReady(preflightResult)
                  ? "validation validation-success"
                  : "validation validation-danger"
              }
            >
              <strong>
                {preflightReady(preflightResult) ? "Ready to generate" : "Generation blocked"}
              </strong>
              {preflightResult.estimate ? (
                <span>
                  {" "}
                  Projected {formatUsd(preflightResult.estimate.projected_usd)}
                  {preflightResult.estimate.minimum_usd !== undefined ||
                  preflightResult.estimate.maximum_usd !== undefined
                    ? ` · range ${formatUsd(preflightResult.estimate.minimum_usd)}–${formatUsd(preflightResult.estimate.maximum_usd)}`
                    : ""}
                </span>
              ) : (
                <span> Estimate not reported.</span>
              )}
            </div>
          ) : null}
          {preflightBlockers(preflightResult).length > 0 ? (
            <div className="validation validation-danger">
              <strong>Resolve these blockers:</strong>
              <ul>
                {preflightBlockers(preflightResult).map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {!capValid ? (
            <p className="validation validation-danger">
              Enter a finite spend cap of at least $0.10.
            </p>
          ) : null}
          {!keywordsValid ? (
            <p className="validation validation-danger">
              Extra prompt keywords must be at most 500 characters.
            </p>
          ) : null}
          {voiceoverMeta ? (
            <p className="helper">
              Verified locally: {formatMilliseconds(voiceoverMeta.durationMs)} ·{" "}
              {voiceoverMeta.contentType} · {voiceoverMeta.checksumSha256}
            </p>
          ) : null}
          <Button
            busy={preflightMutation.isPending || submit.isPending}
            disabled={
              (!canPreflight && !preflightReady(preflightResult)) ||
              preflightMutation.isPending ||
              submit.isPending ||
              (preflightReady(preflightResult) && catalog.data.media_worker_state !== "ONLINE")
            }
            onClick={() => {
              if (preflightReady(preflightResult)) submit.mutate();
              else preflightMutation.mutate();
            }}
          >
            {preflightReady(preflightResult) ? <FileAudio size={16} /> : <Check size={16} />}
            {preflightReady(preflightResult)
              ? "Generate video"
              : catalog.data.media_worker_state === "ONLINE"
                ? "Check estimate & readiness"
                : "Create and transcribe"}
          </Button>
        </Panel>
      </div>
      {error ? (
        <div className="validation validation-danger" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}

type HostedPresetHubKind = "avatars" | "styles";

/**
 * The hosted catalog exposes tenant-owned immutable versions and routes creation through the
 * dedicated preset wizard; project creation never accepts a per-project upload.
 */
function HostedPresetHubScreen({ kind }: { kind: HostedPresetHubKind }) {
  const catalog = useQuery({
    queryKey: ["hosted-project-catalog"],
    queryFn: readHostedCatalog,
  });
  const isAvatar = kind === "avatars";
  const items = catalog.data ? (isAvatar ? catalog.data.avatars : catalog.data.styles) : [];
  const title = isAvatar ? "Avatar Hub" : "Image Styles";
  const itemLabel = isAvatar ? "avatar" : "style";
  const Icon = isAvatar ? UsersRound : Images;

  if (catalog.isPending) {
    return (
      <Panel eyebrow="Private hosted staging" heading={`Loading ${title}`}>
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Loading tenant-owned {itemLabel}s…</p>
        </div>
      </Panel>
    );
  }
  if (catalog.isError || !catalog.data) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title={`${title} unavailable`}
        body="The hosted tenant catalog could not be loaded. No fixture catalog was substituted."
        action={
          <Button variant="secondary" onClick={() => void catalog.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Private hosted staging"
        title={title}
        description={`Only ${itemLabel}s owned by this account can be used for generation.`}
        actions={
          <Link className="button button-primary" to={isAvatar ? "/avatars/new" : "/styles/new"}>
            <Upload size={16} /> New {itemLabel}
          </Link>
        }
      />
      <div className="notice" role="status">
        <strong>Tenant-private immutable versions.</strong> New source uploads are validated,
        reviewed, and approved before they become selectable by a project.
      </div>
      <Panel eyebrow="Tenant-private catalog" heading={`Ready ${itemLabel}s`}>
        {items.length === 0 ? (
          <EmptyState
            icon={<Icon />}
            title={`No ready ${itemLabel}s yet`}
            body={`This account has no ready ${itemLabel} yet. Create one here and complete its private review before generation. If hosted creation is not enabled for this account, an activation owner must provision a bounded fixture.`}
            action={
              <div className="cluster">
                <Link
                  className="button button-primary"
                  to={isAvatar ? "/avatars/new" : "/styles/new"}
                >
                  Create {itemLabel}
                </Link>
                <Link className="button button-secondary" to="/settings">
                  Open Settings
                </Link>
              </div>
            }
          />
        ) : (
          <div className="entity-list">
            {items.map((item) => (
              <article className="entity-row" key={item.version_id}>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    Tenant-owned · version {item.version_number} · {item.version_id}
                  </small>
                  {item.profile_hash ? <small>Profile hash · {item.profile_hash}</small> : null}
                </div>
                <div className="cluster">
                  <Badge tone={statusTone(presetState(item))}>
                    {normalizedStatus(presetState(item))}
                  </Badge>
                  <a
                    className="button button-ghost"
                    href={`${isAvatar ? "/avatars/new" : "/styles/new"}?parentId=${encodeURIComponent(presetVersionId(item))}`}
                  >
                    New version
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
      {items.length > 0 ? (
        <Panel eyebrow="Next step" heading="Use this catalog in a project">
          <p>
            Select the exact {itemLabel} version on Create Project. Personal-worker compute stays at
            $0 provider CPU cost; GPU transport remains disabled until qualification.
          </p>
          <Link className="button button-primary" to="/projects/new">
            Create Project
          </Link>
        </Panel>
      ) : null}
    </>
  );
}

export function HostedAvatarHubScreen() {
  return <HostedPresetHubScreen kind="avatars" />;
}

export function HostedStylesHubScreen() {
  return <HostedPresetHubScreen kind="styles" />;
}

export function HostedPresetCreationUnavailableScreen({ kind }: { kind: HostedPresetHubKind }) {
  const isAvatar = kind === "avatars";
  const title = isAvatar ? "Avatar Hub" : "Image Styles";
  const itemLabel = isAvatar ? "avatar" : "style";
  return (
    <>
      <PageHeader
        eyebrow="Private hosted staging"
        title={`${title} creation unavailable`}
        description="Hosted V2-06 accepts only exact activation-owned presets."
      />
      <EmptyState
        icon={isAvatar ? <UsersRound /> : <Images />}
        title="Read-only hosted catalog"
        body={`The ${itemLabel} creation workflow is intentionally disabled in staging. Open the hub to inspect tenant-owned versions, or return to Settings for worker status.`}
        action={
          <div className="cluster">
            <Link className="button button-secondary" to={isAvatar ? "/avatars" : "/styles"}>
              Open {title}
            </Link>
            <Link className="button button-secondary" to="/settings">
              Settings
            </Link>
          </div>
        }
      />
    </>
  );
}

export function HostedPresetCreationScreen({ kind }: { kind: HostedPresetHubKind }) {
  const isAvatar = kind === "avatars";
  const title = isAvatar ? "New avatar" : "New image style";
  const itemLabel = isAvatar ? "avatar" : "style";
  const params = new URLSearchParams(window.location.search);
  const returnTo = normalizeHostedReturnTo(
    params.get("returnTo"),
    isAvatar ? "/avatars" : "/styles",
  );
  const parentId = params.get("parentId");
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [avatarSource, setAvatarSource] = useState<{
    readonly file: File;
    readonly objectUrl: string;
    readonly width: number;
    readonly height: number;
    readonly checksum: string;
  } | null>(null);
  const [styleSources, setStyleSources] = useState<
    readonly {
      readonly file: File;
      readonly objectUrl: string;
      readonly checksum: string;
    }[]
  >([]);
  const [rights, setRights] = useState(false);
  const [likeness, setLikeness] = useState(false);
  const [disclosure, setDisclosure] = useState(false);
  const [profileNotes, setProfileNotes] = useState("");
  const [created, setCreated] = useState<HostedPresetMutationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const catalog = useQuery({
    queryKey: ["hosted-project-catalog"],
    queryFn: readHostedCatalog,
  });
  const items = catalog.data ? (isAvatar ? catalog.data.avatars : catalog.data.styles) : [];
  const duplicateName = items.some(
    (item) => item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );

  useEffect(
    () => () => {
      if (avatarSource) URL.revokeObjectURL(avatarSource.objectUrl);
      for (const source of styleSources) URL.revokeObjectURL(source.objectUrl);
    },
    [avatarSource, styleSources],
  );

  function cancel() {
    window.location.assign(returnTo);
  }

  async function chooseAvatar(file?: File) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Avatar source must be at most 20 MB.");
      return;
    }
    try {
      const dimensions = await imageDimensions(file);
      if (dimensions.width < 512 || dimensions.height < 512)
        throw new Error("Avatar source must be at least 512×512 pixels.");
      const checksum = await bounded(
        hostedFileSha256(file),
        "Avatar checksum timed out. Try again.",
        15_000,
      );
      if (avatarSource) URL.revokeObjectURL(avatarSource.objectUrl);
      setAvatarSource({
        file,
        objectUrl: URL.createObjectURL(file),
        ...dimensions,
        checksum,
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : "Avatar source validation failed.");
    }
  }

  async function chooseStyleSources(selected: FileList | null) {
    setError(null);
    for (const source of styleSources) URL.revokeObjectURL(source.objectUrl);
    setStyleSources([]);
    const files = Array.from(selected ?? []);
    if (files.length < MIN_STYLE_REFERENCES || files.length > MAX_STYLE_REFERENCES) {
      if (files.length > 0)
        setError(`Choose ${MIN_STYLE_REFERENCES}–${MAX_STYLE_REFERENCES} reference images.`);
      return;
    }
    const oversized = files.find((file) => file.size > MAX_STYLE_REFERENCE_BYTES);
    if (oversized) {
      setError("Each style reference must be at most 20 MB.");
      return;
    }
    setBusy(true);
    try {
      const checksums = await Promise.all(
        files.map((file) =>
          bounded(hostedFileSha256(file), "Style reference checksum timed out. Try again.", 15_000),
        ),
      );
      setStyleSources(
        files.map((file, index) => ({
          file,
          checksum: checksums[index]!,
          objectUrl: URL.createObjectURL(file),
        })),
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : "Style reference validation failed.");
    } finally {
      setBusy(false);
    }
  }

  function resourceId(value: HostedPresetMutationResponse): string {
    const id = value.id ?? value.profile_id ?? value.style_id ?? value.version_id;
    if (!id) throw new Error(`Hosted ${itemLabel} response did not include an id.`);
    return id;
  }

  async function createDraft() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!name.trim()) throw new Error(`Enter a ${itemLabel} name.`);
      if (duplicateName) throw new Error(`Use a unique ${itemLabel} name.`);
      if (isAvatar && !avatarSource) throw new Error("Choose one private avatar source.");
      if (!isAvatar && styleSources.length < MIN_STYLE_REFERENCES)
        throw new Error(
          `Choose ${MIN_STYLE_REFERENCES}–${MAX_STYLE_REFERENCES} private references.`,
        );
      const body = isAvatar
        ? {
            schema_version: "videoforge-hosted-avatar-create/v1",
            name: name.trim(),
            parent_profile_id: parentId,
            source: {
              filename: avatarSource!.file.name,
              content_type: avatarSource!.file.type || "image/png",
              content_length: avatarSource!.file.size,
              checksum_sha256: avatarSource!.checksum,
              width: avatarSource!.width,
              height: avatarSource!.height,
            },
            rights_attested: rights,
            likeness_animation_consent: likeness,
          }
        : {
            schema_version: "videoforge-hosted-style-create/v1",
            name: name.trim(),
            parent_style_id: parentId,
            references: styleSources.map((source, index) => ({
              filename: source.file.name,
              content_type: source.file.type || "image/png",
              content_length: source.file.size,
              checksum_sha256: source.checksum,
              order_index: index,
            })),
            rights_attested: rights,
            processing_disclosure_acknowledged: disclosure,
          };
      const endpoint = isAvatar ? "/api/v2/hosted/avatars" : "/api/v2/hosted/styles";
      const draft = await readJson<HostedPresetMutationResponse>(endpoint, {
        method: "POST",
        headers: { "idempotency-key": `hosted-${kind}-create-${crypto.randomUUID()}` },
        body: JSON.stringify(body),
      });
      const uploads = draft.uploads ?? (draft.upload ? [draft.upload] : []);
      if (isAvatar && uploads[0] && avatarSource)
        await putHostedUpload(uploads[0], avatarSource.file);
      if (!isAvatar) {
        if (uploads.length > 0 && uploads.length !== styleSources.length)
          throw new Error(
            "Hosted style upload instructions did not match the selected references.",
          );
        for (const [index, upload] of uploads.entries()) {
          const source = styleSources[index];
          if (source) await putHostedUpload(upload, source.file);
        }
      }
      const id = resourceId(draft);
      const committed = await readJson<HostedPresetMutationResponse>(
        `${endpoint}/${encodeURIComponent(id)}/commit`,
        { method: "POST", body: "{}" },
      );
      setCreated({ ...draft, ...committed });
      setStep(3);
    } catch (value) {
      setError(value instanceof Error ? value.message : `Hosted ${itemLabel} could not be saved.`);
    } finally {
      setBusy(false);
    }
  }

  async function approveAvatar() {
    if (!created || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = resourceId(created);
      await readJson(`/api/v2/hosted/avatars/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "videoforge-hosted-avatar-approval/v1",
          rights_attested: rights,
          likeness_animation_consent: likeness,
        }),
      });
      await catalog.refetch();
      window.location.assign(returnTo);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Avatar approval failed.");
    } finally {
      setBusy(false);
    }
  }

  async function analyzeStyle() {
    if (!created || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = resourceId(created);
      const analyzed = await readJson<HostedPresetMutationResponse>(
        `/api/v2/hosted/styles/${encodeURIComponent(id)}/analyze`,
        {
          method: "POST",
          body: JSON.stringify({ schema_version: "videoforge-hosted-style-analysis/v1" }),
        },
      );
      setCreated({ ...created, ...analyzed });
      setStep(4);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Style analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  async function publishStyle() {
    if (!created || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = resourceId(created);
      const candidateProfile = created.profile
        ? { ...created.profile, review_notes: profileNotes.trim() }
        : undefined;
      await readJson(`/api/v2/hosted/styles/${encodeURIComponent(id)}/publish`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "videoforge-hosted-style-publish/v1",
          rights_attested: rights,
          processing_disclosure_acknowledged: disclosure,
          candidate_profile: candidateProfile,
        }),
      });
      await catalog.refetch();
      window.location.assign(returnTo);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Style publication failed.");
    } finally {
      setBusy(false);
    }
  }

  const profileSummary =
    (typeof created?.summary === "string" && created.summary) ||
    (typeof created?.profile?.summary === "string" && created.profile.summary) ||
    "No analysis summary was returned; publication remains blocked until review data is available.";

  return (
    <>
      <PageHeader
        eyebrow={`${title} · step ${step} of ${isAvatar ? 3 : 4}`}
        title={title}
        description={
          parentId
            ? `Create an immutable new version from ${parentId}. Existing project pins remain unchanged.`
            : `Upload, review, and approve a private reusable ${itemLabel}.`
        }
        actions={
          <Button variant="ghost" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
        }
      />
      <Panel
        eyebrow="Tenant-private source workflow"
        heading={
          step === 1
            ? "Name and upload"
            : step === 2
              ? "Technical review"
              : isAvatar
                ? "Rights and likeness approval"
                : step === 3
                  ? "Analyze references"
                  : "Review and publish"
        }
      >
        {step === 1 ? (
          <div className="stack">
            <label className="field">
              <span>{isAvatar ? "Avatar Profile name" : "Image Style name"}</span>
              <input
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder={isAvatar ? "Maya — studio presenter" : "Grounded documentary"}
              />
            </label>
            {isAvatar ? (
              <label className="dropzone">
                <input
                  aria-label="Upload avatar source"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={(event) => void chooseAvatar(event.target.files?.[0])}
                />
                {avatarSource ? (
                  <img src={avatarSource.objectUrl} alt="Selected avatar source" />
                ) : (
                  <Upload size={27} />
                )}
                <span>
                  <strong>{avatarSource?.file.name ?? "Choose one private centered source"}</strong>
                  {avatarSource
                    ? `${avatarSource.width}×${avatarSource.height} · checksum verified`
                    : "JPEG, PNG, or WebP · at least 512×512 · 20 MB max"}
                </span>
              </label>
            ) : (
              <label className="dropzone">
                <input
                  aria-label="Upload style references"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={busy}
                  onChange={(event) => void chooseStyleSources(event.target.files)}
                />
                <Images size={27} />
                <span>
                  <strong>
                    {styleSources.length > 0
                      ? `${styleSources.length} references selected`
                      : "Choose private style references"}
                  </strong>
                  {"JPEG, PNG, or WebP · 3–8 references · 20 MB each"}
                </span>
              </label>
            )}
            {duplicateName ? (
              <div className="validation validation-danger">Use a unique {itemLabel} name.</div>
            ) : null}
            <Button
              disabled={
                !name.trim() ||
                duplicateName ||
                (isAvatar ? !avatarSource : styleSources.length < MIN_STYLE_REFERENCES)
              }
              onClick={() => setStep(2)}
            >
              Review source <ArrowRight size={16} />
            </Button>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="stack">
            {isAvatar && avatarSource ? (
              <img
                className="avatar-source-preview"
                src={avatarSource.objectUrl}
                alt="Avatar source preview"
              />
            ) : null}
            {!isAvatar ? (
              <div className="card-grid style-card-grid">
                {styleSources.map((source) => (
                  <img key={source.checksum} src={source.objectUrl} alt={source.file.name} />
                ))}
              </div>
            ) : null}
            <div className="validation validation-success">
              <Check size={16} /> File signatures, browser decode, dimensions, and checksums passed.
            </div>
            <div className="notice notice-warning">
              <strong>Manual review required.</strong> Confirm that the source is centered, usable,
              and free of unsupported text, logos, or watermarks. VideoForge does not infer rights
              or likeness from pixels.
            </div>
            <Button variant="ghost" disabled={busy} onClick={() => setStep(1)}>
              Back
            </Button>
            <Button disabled={busy} onClick={() => setStep(3)}>
              Continue to approval <ArrowRight size={16} />
            </Button>
          </div>
        ) : null}
        {step === 3 && isAvatar ? (
          <div className="stack">
            <label className="toggle-row">
              <span>
                <strong>Image-use rights</strong>
                <small>
                  I own, license, or otherwise have a documented basis to use this source.
                </small>
              </span>
              <input
                type="checkbox"
                checked={rights}
                onChange={(event) => setRights(event.target.checked)}
              />
            </label>
            <label className="toggle-row">
              <span>
                <strong>Likeness animation consent</strong>
                <small>I have the right and consent to animate the depicted likeness.</small>
              </span>
              <input
                type="checkbox"
                checked={likeness}
                onChange={(event) => setLikeness(event.target.checked)}
              />
            </label>
            <Disclosure summary="What is saved">
              <p className="helper">
                Only the tenant-private source lineage, checksums, approved version, and
                compatibility evidence are retained.
              </p>
            </Disclosure>
            <Button variant="ghost" disabled={busy} onClick={() => setStep(2)}>
              Back
            </Button>
            <Button
              busy={busy}
              disabled={!rights || !likeness || !created}
              onClick={() => void approveAvatar()}
            >
              <ShieldCheck size={16} /> Approve and add to Avatar Hub
            </Button>
            {!created ? (
              <Button variant="secondary" busy={busy} onClick={() => void createDraft()}>
                Save private draft
              </Button>
            ) : null}
          </div>
        ) : null}
        {step === 3 && !isAvatar ? (
          <div className="stack">
            <div className="notice">
              <strong>References are uploaded privately before analysis.</strong> Analysis runs once
              for this immutable draft version and never during ordinary video generation.
            </div>
            <label className="toggle-row">
              <span>
                <strong>Image-use rights</strong>
                <small>
                  I own, license, or otherwise have a documented basis to use these references.
                </small>
              </span>
              <input
                type="checkbox"
                checked={rights}
                onChange={(event) => setRights(event.target.checked)}
              />
            </label>
            <label className="toggle-row">
              <span>
                <strong>Processing disclosure</strong>
                <small>
                  I understand normalized references are processed to derive this style profile.
                </small>
              </span>
              <input
                type="checkbox"
                checked={disclosure}
                onChange={(event) => setDisclosure(event.target.checked)}
              />
            </label>
            <Button variant="ghost" disabled={busy} onClick={() => setStep(2)}>
              Back
            </Button>
            {!created ? (
              <Button
                busy={busy}
                disabled={!rights || !disclosure}
                onClick={() => void createDraft()}
              >
                Upload and prepare analysis <ArrowRight size={16} />
              </Button>
            ) : (
              <Button busy={busy} onClick={() => void analyzeStyle()}>
                Analyze this draft once <ArrowRight size={16} />
              </Button>
            )}
          </div>
        ) : null}
        {step === 4 && !isAvatar ? (
          <div className="stack">
            <div className="validation validation-success">
              <Check size={16} /> Exact draft analysis returned for review.
            </div>
            <p>{profileSummary}</p>
            {created?.profile_hash ? <small>Profile hash · {created.profile_hash}</small> : null}
            <label className="field">
              <span>Review notes (optional)</span>
              <textarea
                rows={3}
                value={profileNotes}
                onChange={(event) => setProfileNotes(event.target.value)}
                placeholder="Keep natural practical light and tactile material detail."
              />
            </label>
            <label className="toggle-row">
              <span>
                <strong>Confirm rights and disclosure</strong>
                <small>
                  Publish only after reviewing the generated profile and reference handling.
                </small>
              </span>
              <input
                type="checkbox"
                checked={rights && disclosure}
                onChange={(event) => {
                  setRights(event.target.checked);
                  setDisclosure(event.target.checked);
                }}
              />
            </label>
            <Button variant="ghost" disabled={busy} onClick={() => setStep(3)}>
              Back
            </Button>
            <Button
              busy={busy}
              disabled={!rights || !disclosure || !created?.profile}
              onClick={() => void publishStyle()}
            >
              <ShieldCheck size={16} /> Publish immutable style version
            </Button>
          </div>
        ) : null}
      </Panel>
      {error ? (
        <div className="validation validation-danger" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}

export function HostedProjectScreen({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["hosted-project", projectId],
    queryFn: () => readJson<ProjectDetailResponse>(`/api/v2/hosted/projects/${projectId}`),
    refetchInterval: 5_000,
  });
  const asr = [...(query.data?.attempts ?? [])].reverse().find((attempt) => attempt.kind === "ASR");
  const render = [...(query.data?.attempts ?? [])]
    .reverse()
    .find((attempt) => attempt.kind === "RENDER");
  const renderHandoffAttempt = useRef<string | null>(null);
  const asrHandoff = useMutation({
    mutationFn: async () => {
      const handoff = await readJson<{ cpu_submission: unknown }>(
        `/api/v2/hosted/projects/${projectId}/asr`,
        { method: "POST", body: "{}" },
      );
      return readJson(`/api/v2/cpu-attempts`, {
        method: "POST",
        body: JSON.stringify(handoff.cpu_submission),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  const renderHandoff = useMutation({
    mutationFn: async (asrAttemptId: string) =>
      readJson<{
        state: "WAITING_FOR_GPU_QUALIFICATION";
        missing_lane_gates: readonly { lane: string; gates: readonly string[] }[];
      }>(`/api/v2/hosted/projects/${projectId}/render`, {
        method: "POST",
        body: JSON.stringify({ asr_attempt_id: asrAttemptId }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  useEffect(() => {
    if (asr?.state !== "SUCCEEDED" || render || renderHandoffAttempt.current === asr.id) {
      return;
    }
    renderHandoffAttempt.current = asr.id;
    renderHandoff.mutate(asr.id);
  }, [asr?.id, asr?.state, render?.id, renderHandoff]);
  const cancel = useMutation({
    mutationFn: (attemptId: string) =>
      readJson(`/api/v2/cpu-attempts/${attemptId}`, { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  const retry = useMutation({
    mutationFn: ({ attemptId, assetId }: { attemptId: string; assetId?: string | null }) =>
      readJson(`/api/v2/hosted/projects/${projectId}/retry`, {
        method: "POST",
        body: JSON.stringify({ attempt_id: attemptId, asset_id: assetId ?? null }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  if (query.isPending)
    return (
      <Panel eyebrow="Hosted project" heading="Loading progress">
        <p>Reading durable worker state…</p>
      </Panel>
    );
  if (query.isError || !query.data)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Project unavailable"
        body="No fixture status was substituted."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  const stages = query.data.stages?.length
    ? query.data.stages
    : fallbackHostedStages(asr, render, query.data.generation);
  const timing = query.data.timing;
  const cost = query.data.cost;
  const queue = query.data.queue;
  const scaleToZero = query.data.scale_to_zero;
  return (
    <>
      <PageHeader
        eyebrow={query.data.project.revision_state}
        title={query.data.project.title}
        description="Durable personal-worker progress"
        actions={
          render?.state === "SUCCEEDED" ? (
            <Link
              className="button button-primary"
              to="/projects/$projectId/review"
              params={{ projectId }}
            >
              Review video
            </Link>
          ) : undefined
        }
      />
      <div className="grid grid-3 usage-grid">
        <Metric label="CPU provider" value="$0.00" detail="your computer" tone="success" />
        <Metric
          label="Worker jobs"
          value={String(query.data.attempts.length)}
          detail="ASR and render"
        />
        <Metric
          label="Queue position"
          value={queue?.position ?? "Not reported"}
          detail={
            queue?.total ? `${queue.total} private entries` : "fair rotation detail unavailable"
          }
        />
        <Metric
          label="ETA"
          value={formatMilliseconds(queue?.estimated_wait_ms)}
          detail={queue?.fair_rotation ?? "durable estimate only"}
        />
        <Metric
          label="Projected cost"
          value={formatUsd(cost?.projected_usd)}
          detail={cost?.cap_usd === undefined ? "not reported" : `cap ${formatUsd(cost.cap_usd)}`}
        />
        <Metric
          label="Settled cost"
          value={formatUsd(cost?.settled_usd)}
          detail="provider receipt"
        />
        <Metric label="GPU" value="Disabled" detail="V2-06 firewall" />
      </div>
      <Panel eyebrow="Queue and cost truth" heading="Durable operating details">
        <div className="detail-facts">
          <span>
            <small>Queue</small>
            <strong>
              {queue?.status ? normalizedStatus(queue.status) : "Not reported"}
              {queue?.ahead !== undefined && queue.ahead !== null ? ` · ${queue.ahead} ahead` : ""}
            </strong>
          </span>
          <span>
            <small>Queue wait</small>
            <strong>{formatMilliseconds(timing?.queue_wait_ms)}</strong>
          </span>
          <span>
            <small>Initialization / model ready</small>
            <strong>
              {formatMilliseconds(timing?.initialization_ms)} /{" "}
              {formatMilliseconds(timing?.model_ready_ms)}
            </strong>
          </span>
          <span>
            <small>Inference / upload</small>
            <strong>
              {formatMilliseconds(timing?.inference_ms)} / {formatMilliseconds(timing?.upload_ms)}
            </strong>
          </span>
          <span>
            <small>End to end</small>
            <strong>{formatMilliseconds(timing?.end_to_end_ms)}</strong>
          </span>
          <span>
            <small>Billed seconds</small>
            <strong>
              {cost?.billed_seconds === undefined || cost.billed_seconds === null
                ? "Not reported"
                : `${cost.billed_seconds}s`}
            </strong>
          </span>
        </div>
      </Panel>
      <Panel eyebrow="Exact attempts" heading="Progress">
        <div className="entity-list">
          {query.data.attempts.map((attempt) => (
            <article className="entity-row" key={attempt.id}>
              <div>
                <strong>{attemptLabel(attempt.kind)}</strong>
                <small>{attempt.id}</small>
                {attempt.error_message ? <small>{attempt.error_message}</small> : null}
                {attempt.timing ? (
                  <small>
                    Queue {formatMilliseconds(attempt.timing.queue_wait_ms)} · end to end{" "}
                    {formatMilliseconds(attempt.timing.end_to_end_ms)}
                  </small>
                ) : null}
              </div>
              <Badge
                tone={
                  attempt.state === "SUCCEEDED"
                    ? "success"
                    : attempt.state === "FAILED"
                      ? "danger"
                      : "info"
                }
              >
                {attempt.state.replaceAll("_", " ")}
              </Badge>
              {["OUTBOXED", "SUBMITTED", "RUNNING", "RECONCILING", "CANCEL_REQUESTED"].includes(
                attempt.state,
              ) ? (
                <Button
                  variant="danger"
                  busy={cancel.isPending && cancel.variables === attempt.id}
                  onClick={() => cancel.mutate(attempt.id)}
                >
                  <X size={15} />
                  {attempt.state === "CANCEL_REQUESTED" ? "Settle cancellation" : "Cancel"}
                </Button>
              ) : null}
              {attempt.progress_percent !== undefined && attempt.progress_percent !== null ? (
                <div className="attempt-progress">
                  <ProgressBar
                    value={attempt.progress_percent}
                    label={`${attempt.kind} progress`}
                  />
                  <small>{Math.round(attempt.progress_percent)}%</small>
                </div>
              ) : null}
              {attempt.state === "FAILED" ? (
                <Button
                  variant="secondary"
                  busy={retry.isPending && retry.variables?.attemptId === attempt.id}
                  onClick={() => retry.mutate({ attemptId: attempt.id, assetId: attempt.asset_id })}
                >
                  Retry this stage
                </Button>
              ) : null}
            </article>
          ))}
        </div>
      </Panel>
      <Panel eyebrow="Hosted pipeline" heading="Generation stages">
        <div className="entity-list">
          {stages.map((stage) => (
            <article className="entity-row" key={stage.id ?? stage.name}>
              <div>
                <strong>{stage.name}</strong>
                <small>{stage.detail ?? "Durable stage detail was not returned."}</small>
                {stage.started_at || stage.completed_at ? (
                  <small>
                    Started {formatTimestamp(stage.started_at)} · completed{" "}
                    {formatTimestamp(stage.completed_at)}
                  </small>
                ) : null}
                {stage.progress_percent !== undefined && stage.progress_percent !== null ? (
                  <div className="attempt-progress">
                    <ProgressBar value={stage.progress_percent} label={`${stage.name} progress`} />
                    <small>{Math.round(stage.progress_percent)}%</small>
                  </div>
                ) : null}
              </div>
              <Badge tone={statusTone(stage.status)}>{normalizedStatus(stage.status)}</Badge>
              {stage.eta_ms !== undefined && stage.eta_ms !== null ? (
                <small>ETA {formatMilliseconds(stage.eta_ms)}</small>
              ) : null}
            </article>
          ))}
          {query.data.gpu_readiness.lanes.map((lane) => (
            <article className="entity-row" key={lane.lane}>
              <div>
                <strong>{lane.lane === "MAGE_IMAGE" ? "Image GPU" : "Avatar GPU"}</strong>
                <small>
                  {lane.checkpoint} missing: {lane.missing_gates.join(", ")}
                </small>
              </div>
              <Badge tone="info">{lane.qualification.replaceAll("_", " ")}</Badge>
            </article>
          ))}
          <article className="entity-row">
            <div>
              <strong>Final render</strong>
              <small>Starts only after both GPU lanes produce accepted private artifacts</small>
            </div>
            <Badge tone="info">
              {render
                ? render.state.replaceAll("_", " ")
                : !query.data.generation
                  ? "WAITING FOR CANONICAL PLAN"
                  : query.data.generation.stage === "FAILED"
                    ? "BLOCKED BY FAILED GENERATION"
                    : query.data.generation.stage === "READY_FOR_RENDER"
                      ? "WAITING FOR RENDER WORKER"
                      : "WAITING FOR GPU QUALIFICATION"}
            </Badge>
          </article>
        </div>
      </Panel>
      <Panel eyebrow="Compute lifecycle" heading="Scale-to-zero evidence">
        {scaleToZero ? (
          <div className="detail-facts">
            <span>
              <small>State</small>
              <strong>{normalizedStatus(scaleToZero.state)}</strong>
            </span>
            <span>
              <small>Workers observed</small>
              <strong>{scaleToZero.worker_count ?? "Not reported"}</strong>
            </span>
            <span>
              <small>Observed at</small>
              <strong>{formatTimestamp(scaleToZero.observed_at)}</strong>
            </span>
            <span>
              <small>Evidence</small>
              <strong>{scaleToZero.evidence_id ?? "Not reported"}</strong>
            </span>
          </div>
        ) : (
          <p className="helper">
            Scale-to-zero evidence will appear after the worker reports a durable terminal
            observation. No worker count is inferred from a healthy process.
          </p>
        )}
      </Panel>
      {!asr ? (
        <div className="notice" role="status">
          <strong>Project is ready for durable transcription.</strong>
          {asrHandoff.isError ? <span> {asrHandoff.error.message}</span> : null}
          <Button
            variant="secondary"
            busy={asrHandoff.isPending}
            onClick={() => asrHandoff.mutate()}
          >
            Start transcription
          </Button>
        </div>
      ) : null}
      {asr?.state === "SUCCEEDED" && !render ? (
        <div className="notice" role="status">
          <strong>
            {renderHandoff.isError
              ? "Transcription complete; generation planning could not be verified."
              : renderHandoff.isPending
                ? "Transcription complete; persisting the deterministic generation plan."
                : query.data.generation
                  ? "Planning complete; generation is waiting for GPU qualification."
                  : "Transcription complete; generation planning is starting."}
          </strong>
          {renderHandoff.isError ? <span> {renderHandoff.error.message}</span> : null}
        </div>
      ) : null}
      {retry.isError ? (
        <div className="validation validation-danger" role="alert">
          {retry.error.message}
        </div>
      ) : null}
      <Button variant="secondary" onClick={() => void query.refetch()}>
        <RefreshCw size={15} /> Refresh
      </Button>
    </>
  );
}

export function HostedReviewScreen({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["hosted-project", projectId],
    queryFn: () => readJson<ProjectDetailResponse>(`/api/v2/hosted/projects/${projectId}`),
  });
  const candidate = useMemo(
    () =>
      [...(query.data?.attempts ?? [])]
        .reverse()
        .find((attempt) => attempt.kind === "RENDER" && attempt.state === "SUCCEEDED"),
    [query.data],
  );
  const approve = useMutation({
    mutationFn: () =>
      readJson(`/api/v2/hosted/projects/${projectId}/review`, {
        method: "POST",
        body: JSON.stringify({ attempt_id: candidate?.id }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  const retry = useMutation({
    mutationFn: ({ attemptId, assetId }: { attemptId: string; assetId?: string | null }) =>
      readJson(`/api/v2/hosted/projects/${projectId}/retry`, {
        method: "POST",
        body: JSON.stringify({ attempt_id: attemptId, asset_id: assetId ?? null }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  const review = query.data?.review;
  const contactSheet = review?.contact_sheet ?? query.data?.contact_sheet ?? [];
  const qualityFlags = review?.quality_flags ?? query.data?.quality_flags ?? [];
  const manifestUrl = review?.manifest_url ?? query.data?.manifest_url ?? null;
  const downloadUrl = review?.download_url ?? candidate?.preview_url ?? null;
  if (query.isPending)
    return (
      <Panel eyebrow="Review" heading="Loading candidate">
        <p>Checking exact output receipt…</p>
      </Panel>
    );
  if (query.isError || !candidate?.preview_url)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Output is not ready for review"
        body="A successful checksum-bound render is required. No synthetic preview is shown."
        action={
          <Link
            className="button button-secondary"
            to="/projects/$projectId"
            params={{ projectId }}
          >
            Progress
          </Link>
        }
      />
    );
  return (
    <>
      <PageHeader
        eyebrow={candidate.approved_at ? "Approved" : "Review required"}
        title="Review"
        description={query.data?.project.title}
        actions={
          <Button
            disabled={Boolean(candidate.approved_at)}
            busy={approve.isPending}
            onClick={() => approve.mutate()}
          >
            <ShieldCheck size={16} /> {candidate.approved_at ? "Approved" : "Approve final"}
          </Button>
        }
      />
      <Panel className="review-player" eyebrow="Private R2 candidate" heading="Final output">
        <div className="review-player-frame">
          <video controls preload="metadata" src={candidate.preview_url} />
        </div>
        <div className="review-player-meta">
          <Badge tone={candidate.approved_at ? "success" : "warning"}>
            {candidate.approved_at ? "APPROVED" : "REVIEW NEEDED"}
          </Badge>
          {candidate.approved_at && downloadUrl ? (
            <a
              className="button button-secondary"
              href={downloadUrl}
              download="videoforge-output.mp4"
            >
              <Download size={16} /> Download MP4
            </a>
          ) : (
            <Button variant="secondary" disabled>
              <Download size={16} /> Download after approval
            </Button>
          )}
        </div>
      </Panel>
      <Panel eyebrow="Chronological review" heading="Contact sheet">
        {contactSheet.length > 0 ? (
          <div className="card-grid style-card-grid">
            {contactSheet.map((item, index) => (
              <figure key={item.id ?? item.asset_id ?? `${item.image_url}-${index}`}>
                <img src={item.image_url} alt={item.label ?? `Generated asset ${index + 1}`} />
                <figcaption>
                  {item.label ?? item.shot_role ?? `Asset ${index + 1}`}
                  {item.start_ms !== undefined && item.start_ms !== null
                    ? ` · ${formatMilliseconds(item.start_ms)}–${formatMilliseconds(item.end_ms)}`
                    : ""}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="helper">
            No chronological contact-sheet evidence was returned for this candidate.
          </p>
        )}
      </Panel>
      <Panel eyebrow="Quality gate" heading="Review flags">
        {qualityFlags.length > 0 ? (
          <div className="entity-list">
            {qualityFlags.map((flag, index) => (
              <article className="entity-row" key={flag.id ?? `${flag.category}-${index}`}>
                <div>
                  <strong>{flag.category}</strong>
                  <small>{flag.message}</small>
                  {flag.asset_id ? <small>Asset · {flag.asset_id}</small> : null}
                </div>
                <Badge tone={statusTone(flag.status)}>{normalizedStatus(flag.status)}</Badge>
                {flag.retryable && !candidate.approved_at ? (
                  <Button
                    variant="secondary"
                    busy={retry.isPending && retry.variables?.assetId === flag.asset_id}
                    onClick={() =>
                      retry.mutate({ attemptId: candidate.id, assetId: flag.asset_id })
                    }
                  >
                    Retry this asset
                  </Button>
                ) : null}
                {flag.replacement_allowed ? (
                  <small>Replacement requires an authorized source upload.</small>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="helper">
            No quality flags were returned. This does not substitute for subjective human review.
          </p>
        )}
      </Panel>
      <Panel eyebrow="Provenance" heading="Download evidence">
        {manifestUrl && candidate.approved_at ? (
          <a
            className="button button-secondary"
            href={manifestUrl}
            download="videoforge-provenance.json"
          >
            <Download size={16} /> Download provenance manifest
          </a>
        ) : (
          <p className="helper">
            The manifest becomes available as a private download after explicit approval.
          </p>
        )}
      </Panel>
      {approve.isError ? (
        <div className="validation validation-danger">{approve.error.message}</div>
      ) : null}
      {retry.isError ? (
        <div className="validation validation-danger" role="alert">
          {retry.error.message}
        </div>
      ) : null}
    </>
  );
}

export function HostedUsageScreen() {
  const query = useQuery({
    queryKey: ["hosted-usage"],
    queryFn: () => readJson<HostedUsageResponse>("/api/v2/hosted/usage"),
  });
  if (query.isPending)
    return (
      <Panel eyebrow="Workspace" heading="Loading Usage">
        <p>Reading exact tenant totals…</p>
      </Panel>
    );
  if (query.isError || !query.data)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Usage unavailable"
        body="No estimated spend was substituted."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  return (
    <>
      <PageHeader title="Usage" />
      <div className="grid grid-4 usage-grid">
        <Metric label="CPU provider" value="$0.00" detail="personal worker" tone="success" />
        <Metric label="GPU staging" value="$0.00" detail="disabled" />
        <Metric
          label="Worker time"
          value={`${query.data.personal_worker_seconds}s`}
          detail="measured"
        />
        <Metric
          label="Private R2"
          value={`${(query.data.retained_bytes / 1024 / 1024 / 1024).toFixed(3)} GB`}
          detail="until Delete"
        />
      </div>
      <div className="grid grid-3 usage-grid">
        <Metric label="Attempts" value={String(query.data.attempts)} detail="this month" />
        <Metric label="Succeeded" value={String(query.data.succeeded)} detail="durable" />
        <Metric label="Failed" value={String(query.data.failed)} detail="no hidden estimate" />
      </div>
      <Panel eyebrow="Measured economics" heading="Project and lane detail">
        {query.data.as_of ? (
          <p className="helper">As of {formatTimestamp(query.data.as_of)}.</p>
        ) : null}
        {query.data.fixed_recurring_usd !== undefined && query.data.fixed_recurring_usd !== null ? (
          <div className="notice">
            Fixed retained-volume cost: {formatUsd(query.data.fixed_recurring_usd)} separately from
            per-video spend.
          </div>
        ) : null}
        {query.data.projects?.length ? (
          <div className="entity-list">
            {query.data.projects.map((project) => (
              <article className="entity-row" key={project.project_id}>
                <div>
                  <strong>{project.title}</strong>
                  <small>
                    {project.project_id} · {project.attempts ?? 0} attempts
                  </small>
                </div>
                <span>
                  <small>Projected</small> {formatUsd(project.projected_usd)}
                </span>
                <span>
                  <small>Settled</small> {formatUsd(project.settled_usd)}
                </span>
                <span>
                  <small>Queue / end-to-end</small> {formatMilliseconds(project.queue_wait_ms)} /{" "}
                  {formatMilliseconds(project.end_to_end_ms)}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <p className="helper">Per-project timing and cost records were not returned.</p>
        )}
        {query.data.lanes?.length ? (
          <Disclosure summary="Lane breakdown">
            <div className="entity-list">
              {query.data.lanes.map((lane) => (
                <article className="entity-row" key={lane.lane}>
                  <strong>{lane.lane}</strong>
                  <span>Projected {formatUsd(lane.projected_usd)}</span>
                  <span>Settled {formatUsd(lane.settled_usd)}</span>
                  <span>{lane.billed_seconds ?? "Not reported"} billed seconds</span>
                </article>
              ))}
            </div>
          </Disclosure>
        ) : null}
      </Panel>
    </>
  );
}
