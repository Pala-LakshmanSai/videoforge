import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalizeJson,
  parseJsonStrict,
  sha256CanonicalJson,
  validateAndHashContractDocument,
  type JsonValue,
  type Sha256Digest,
  type TimelinePlanDocument,
} from "@videoforge/contracts";
import {
  collectRequiredAssetTaskKeys,
  compileCompleteWorkPlan,
  LocalArtifactStore,
  planResolvedRenderManifest,
  resolveProviderAcceptedAssets,
  scheduleTimeline,
  SUPPORTED_RENDER_PROFILE_VERSION,
  SUPPORTED_SCHEDULER_CONFIG,
  type AcceptedAssetBinding,
  type PipelineResult,
  type ProviderAcceptedAssetCandidate,
  type StoredLocalArtifact,
} from "@videoforge/pipeline";
import { LOCAL_SHORT_SLICE_MANIFEST } from "@videoforge/test-fixtures";

import type {
  LocalOwnedVoiceover,
  LocalPipelineRunRequest,
  LocalPipelineRunResult,
  LocalSelectedSpanAudio,
  LocalSliceRunner,
} from "./types";
import { LOCAL_PROJECT_ID, LOCAL_REVISION_ID } from "./types";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
const PUBLIC_ROOT = path.join(REPO_ROOT, "apps/web/public");
const DEFAULT_ARTIFACT_ROOT = path.join(REPO_ROOT, "artifacts/local-media");
const MODEL_PATH = path.resolve(
  process.env.VIDEOFORGE_WHISPER_MODEL ??
    path.join(REPO_ROOT, "weights/whisper.cpp/ggml-base.en.bin"),
);
const MODEL_SHA256 =
  "sha256:a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002" as Sha256Digest;
const WHISPER_VERSION = "1.8.4";
const FFMPEG_VERSION = "8.1.1";
const OWNED_VOICE = "Samantha";
const OWNED_SPEECH_RATE = "55";
const OUTPUT_FILENAME = "videoforge-local-owned-slice.mp4";
const RUNTIME_STATE_FILENAME = "phase2-runtime-state.json";
const RUNTIME_STATE_SCHEMA_VERSION = "videoforge.local-runtime-state/v2";
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const LOCAL_PROCESS_ENVIRONMENT_KEYS = Object.freeze([
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TMP",
  "TMPDIR",
  "USER",
  "XDG_CACHE_HOME",
  "__CF_USER_TEXT_ENCODING",
]);

interface ProcessCapture {
  readonly stdout: string;
  readonly stderr: string;
}

interface PreparedSourceMedia {
  readonly avatarSource: StoredLocalArtifact;
  readonly images: readonly StoredLocalArtifact[];
}

interface PreparedRenderMedia extends PreparedSourceMedia {
  readonly avatarClip: StoredLocalArtifact;
}

interface PinnedToolFacts {
  readonly ffmpegSha256: Sha256Digest;
  readonly ffprobeSha256: Sha256Digest;
  readonly whisperSha256: Sha256Digest;
}

interface PersistedLocalRuntimeState {
  readonly schema_version: typeof RUNTIME_STATE_SCHEMA_VERSION;
  readonly source_voiceover_sha256: Sha256Digest;
  readonly output: {
    readonly filename: string;
    readonly sha256: Sha256Digest;
    readonly bytes: number;
    readonly duration_ms: number;
    readonly total_frames: number;
  };
  readonly documents: {
    readonly transcript_sha256: Sha256Digest;
    readonly timeline_sha256: Sha256Digest;
    readonly generation_work_manifest_sha256: Sha256Digest;
    readonly render_work_manifest_sha256: Sha256Digest;
    readonly resolved_render_manifest_sha256: Sha256Digest;
    readonly render_result_sha256: Sha256Digest;
  };
  readonly selected_span_audio: readonly LocalSelectedSpanAudio[];
  readonly evidence_sha256: Sha256Digest;
}

function localProcessEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of LOCAL_PROCESS_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function objectUriForDigest(sha256: Sha256Digest, extension: string): string {
  const digest = sha256.slice("sha256:".length);
  return `vf-local://objects/sha256/${digest.slice(0, 2)}/${digest}.${extension}`;
}

function objectUri(artifact: StoredLocalArtifact): string {
  return objectUriForDigest(artifact.sha256, artifact.extension);
}

function requireSha256Digest(value: string, label: string): Sha256Digest {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} is not a canonical SHA-256 digest.`);
  }
  return value as Sha256Digest;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\u0000") !== [...keys].sort().join("\u0000")
  ) {
    throw new Error(`${label} has invalid fields.`);
  }
  return value as Record<string, unknown>;
}

function exactInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
}

function exactString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function parseSelectedSpanAudio(value: unknown, index: number): LocalSelectedSpanAudio {
  const label = `Persisted selected span ${String(index + 1)}`;
  const record = exactRecord(
    value,
    [
      "spanId",
      "artifactId",
      "timelineSegmentId",
      "taskKey",
      "selectedStartMs",
      "selectedEndMsExclusive",
      "paddedStartMs",
      "paddedEndMsExclusive",
      "trimStartMs",
      "trimEndMsExclusive",
      "sha256",
      "bytes",
      "durationMs",
    ],
    label,
  );
  const selectedStartMs = exactInteger(record.selectedStartMs, `${label} selected start`);
  const selectedEndMsExclusive = exactInteger(
    record.selectedEndMsExclusive,
    `${label} selected end`,
    1,
  );
  const paddedStartMs = exactInteger(record.paddedStartMs, `${label} padded start`);
  const paddedEndMsExclusive = exactInteger(record.paddedEndMsExclusive, `${label} padded end`, 1);
  const trimStartMs = exactInteger(record.trimStartMs, `${label} trim start`);
  const trimEndMsExclusive = exactInteger(record.trimEndMsExclusive, `${label} trim end`, 1);
  const durationMs = exactInteger(record.durationMs, `${label} duration`, 1);
  if (
    paddedStartMs > selectedStartMs ||
    selectedStartMs >= selectedEndMsExclusive ||
    selectedEndMsExclusive > paddedEndMsExclusive ||
    trimStartMs !== selectedStartMs - paddedStartMs ||
    trimEndMsExclusive !== trimStartMs + selectedEndMsExclusive - selectedStartMs ||
    durationMs !== paddedEndMsExclusive - paddedStartMs
  ) {
    throw new Error(`${label} timing lineage is inconsistent.`);
  }
  return Object.freeze({
    spanId: exactString(record.spanId, `${label} ID`),
    artifactId: exactString(record.artifactId, `${label} artifact ID`),
    timelineSegmentId: exactString(record.timelineSegmentId, `${label} segment ID`),
    taskKey: exactString(record.taskKey, `${label} task key`),
    selectedStartMs,
    selectedEndMsExclusive,
    paddedStartMs,
    paddedEndMsExclusive,
    trimStartMs,
    trimEndMsExclusive,
    sha256: requireSha256Digest(exactString(record.sha256, `${label} checksum`), label),
    bytes: exactInteger(record.bytes, `${label} bytes`, 45),
    durationMs,
  });
}

function parseRuntimeState(value: unknown): PersistedLocalRuntimeState {
  const state = exactRecord(
    value,
    [
      "schema_version",
      "source_voiceover_sha256",
      "output",
      "documents",
      "selected_span_audio",
      "evidence_sha256",
    ],
    "Persisted local runtime state",
  );
  if (state.schema_version !== RUNTIME_STATE_SCHEMA_VERSION) {
    throw new Error("Persisted local runtime state schema is unsupported.");
  }
  const output = exactRecord(
    state.output,
    ["filename", "sha256", "bytes", "duration_ms", "total_frames"],
    "Persisted output",
  );
  const documents = exactRecord(
    state.documents,
    [
      "transcript_sha256",
      "timeline_sha256",
      "generation_work_manifest_sha256",
      "render_work_manifest_sha256",
      "resolved_render_manifest_sha256",
      "render_result_sha256",
    ],
    "Persisted documents",
  );
  if (!Array.isArray(state.selected_span_audio) || state.selected_span_audio.length === 0) {
    throw new Error("Persisted selected span audio is missing.");
  }
  const selectedSpanAudio = Object.freeze(
    state.selected_span_audio.map((span, index) => parseSelectedSpanAudio(span, index)),
  );
  if (
    new Set(selectedSpanAudio.map((span) => span.timelineSegmentId)).size !==
    selectedSpanAudio.length
  ) {
    throw new Error("Persisted selected span audio contains duplicate timeline segments.");
  }
  const filename = exactString(output.filename, "Persisted output filename");
  if (filename !== OUTPUT_FILENAME) {
    throw new Error("Persisted output filename is invalid.");
  }
  return Object.freeze({
    schema_version: RUNTIME_STATE_SCHEMA_VERSION,
    source_voiceover_sha256: requireSha256Digest(
      exactString(state.source_voiceover_sha256, "Persisted source checksum"),
      "Persisted source checksum",
    ),
    output: Object.freeze({
      filename,
      sha256: requireSha256Digest(
        exactString(output.sha256, "Persisted output checksum"),
        "Persisted output checksum",
      ),
      bytes: exactInteger(output.bytes, "Persisted output bytes", 1),
      duration_ms: exactInteger(output.duration_ms, "Persisted output duration", 1),
      total_frames: exactInteger(output.total_frames, "Persisted output frames", 1),
    }),
    documents: Object.freeze({
      transcript_sha256: requireSha256Digest(
        exactString(documents.transcript_sha256, "Persisted transcript checksum"),
        "Persisted transcript checksum",
      ),
      timeline_sha256: requireSha256Digest(
        exactString(documents.timeline_sha256, "Persisted timeline checksum"),
        "Persisted timeline checksum",
      ),
      generation_work_manifest_sha256: requireSha256Digest(
        exactString(
          documents.generation_work_manifest_sha256,
          "Persisted generation work manifest checksum",
        ),
        "Persisted generation work manifest checksum",
      ),
      render_work_manifest_sha256: requireSha256Digest(
        exactString(
          documents.render_work_manifest_sha256,
          "Persisted render work manifest checksum",
        ),
        "Persisted render work manifest checksum",
      ),
      resolved_render_manifest_sha256: requireSha256Digest(
        exactString(
          documents.resolved_render_manifest_sha256,
          "Persisted render manifest checksum",
        ),
        "Persisted render manifest checksum",
      ),
      render_result_sha256: requireSha256Digest(
        exactString(documents.render_result_sha256, "Persisted render result checksum"),
        "Persisted render result checksum",
      ),
    }),
    selected_span_audio: selectedSpanAudio,
    evidence_sha256: requireSha256Digest(
      exactString(state.evidence_sha256, "Persisted evidence checksum"),
      "Persisted evidence checksum",
    ),
  });
}

function verifySelectedSpanLineage(
  timeline: TimelinePlanDocument,
  sourceDurationMs: number,
  selectedSpanAudio: readonly LocalSelectedSpanAudio[],
): void {
  const avatarSegments = timeline.segments.filter(
    (segment) => segment.timeline_composition !== "IMAGE_FULL",
  );
  const spanBySegment = new Map(
    selectedSpanAudio.map((span) => [span.timelineSegmentId, span] as const),
  );
  if (
    avatarSegments.length === 0 ||
    avatarSegments.length !== selectedSpanAudio.length ||
    spanBySegment.size !== selectedSpanAudio.length
  ) {
    throw new Error("Persisted selected span audio does not cover the exact avatar plan.");
  }
  const paddingMs = SUPPORTED_SCHEDULER_CONFIG.selected_span_context_padding_ms;
  for (const segment of avatarSegments) {
    const span = spanBySegment.get(segment.segment_id);
    const paddedStartMs = Math.max(0, segment.source_audio_start_ms - paddingMs);
    const paddedEndMsExclusive = Math.min(
      sourceDurationMs,
      segment.source_audio_end_ms + paddingMs,
    );
    if (
      !span ||
      span.taskKey !== segment.required_slots.avatar.span_audio_task_key ||
      span.selectedStartMs !== segment.source_audio_start_ms ||
      span.selectedEndMsExclusive !== segment.source_audio_end_ms ||
      span.paddedStartMs !== paddedStartMs ||
      span.paddedEndMsExclusive !== paddedEndMsExclusive ||
      span.trimStartMs !== segment.source_audio_start_ms - paddedStartMs ||
      span.trimEndMsExclusive !==
        segment.source_audio_start_ms -
          paddedStartMs +
          segment.source_audio_end_ms -
          segment.source_audio_start_ms ||
      span.durationMs !== paddedEndMsExclusive - paddedStartMs
    ) {
      throw new Error(`Persisted selected span ${segment.segment_id} has mismatched lineage.`);
    }
  }
}

function stableId(namespace: string, stableKey: string): string {
  let hash = 0x811c9dc5;
  for (const character of `${namespace}:${stableKey}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `seg_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const determinism = Object.freeze({
  clock: Object.freeze({
    nowIso(): string {
      throw new Error("The deterministic local scheduler must not read a wall clock.");
    },
  }),
  ids: Object.freeze({ idFor: stableId }),
});

function requirePipeline<T>(result: PipelineResult<T>, label: string): T {
  if (result.ok) return result.value;
  throw new Error(`${label} failed (${result.error.code}): ${result.error.message}`);
}

function requireCompositionCoverage(
  segments: readonly { readonly timeline_composition: string }[],
  label: string,
): readonly string[] {
  const actual = new Set(segments.map((segment) => segment.timeline_composition));
  for (const expected of LOCAL_SHORT_SLICE_MANIFEST.expectedOutput.compositionCoverage) {
    if (!actual.has(expected)) {
      throw new Error(`${label} omitted required composition ${expected}.`);
    }
  }
  return Object.freeze(
    LOCAL_SHORT_SLICE_MANIFEST.expectedOutput.compositionCoverage.filter((composition) =>
      actual.has(composition),
    ),
  );
}

async function exactFileSha256(filename: string): Promise<Sha256Digest> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

function localProviderAcceptance(
  candidate: AcceptedAssetBinding,
  index: number,
): ProviderAcceptedAssetCandidate["acceptance"] {
  const acceptanceFingerprintHash = `sha256:${createHash("sha256")
    .update(
      `fake-provider-acceptance:${candidate.taskKey}:${candidate.assetId}:${candidate.sha256}`,
    )
    .digest("hex")}` as Sha256Digest;
  return Object.freeze({
    schemaVersion:
      candidate.kind === "IMAGE"
        ? "videoforge.mage-image-acceptance/v1"
        : "videoforge.avatar-fixture-acceptance/v1",
    acceptanceFingerprintHash,
    acceptedAttemptId: `attempt_fake_provider_${String(index + 1).padStart(3, "0")}`,
    acceptedAssetId: candidate.assetId,
    acceptedBinarySha256: candidate.sha256,
    qaState: "PASSED",
    qaResultId: `qa_fake_provider_${String(index + 1).padStart(3, "0")}`,
    resultDisposition: "ACCEPTED",
    providerOperation:
      candidate.kind === "IMAGE" ? "fake.runpod.mage.image.accept" : "fixture.avatar.accept",
    modelLineage: Object.freeze({
      provider: "fake-provider-shaped",
      model:
        candidate.kind === "IMAGE" ? "Mage-Flow-Turbo BF16" : "EchoMimicV3-Flash fixture contract",
    }),
    promptLineage: Object.freeze({
      promptHash: `sha256:${createHash("sha256").update(candidate.taskKey).digest("hex")}`,
    }),
    runtimeEvidence: Object.freeze({ mode: "local", externalActivity: false }),
    qualityReview: Object.freeze({ state: "PASSED", reviewer: "owned-synthetic-fixture" }),
    cost: Object.freeze({ reservedMicroUsd: 0, reportedMicroUsd: 0, settledMicroUsd: 0 }),
  });
}

async function executable(name: string): Promise<string> {
  const capture = await runProcess("/usr/bin/which", [name], `locate ${name}`);
  const result = capture.stdout.trim();
  if (!path.isAbsolute(result)) throw new Error(`Pinned local tool '${name}' is unavailable.`);
  return realpath(result);
}

async function verifyPinnedTools(
  ffmpeg: string,
  ffprobe: string,
  whisper: string,
): Promise<PinnedToolFacts> {
  const [ffmpegVersion, ffprobeVersion, ffmpegSha256, ffprobeSha256, whisperSha256] =
    await Promise.all([
      runProcess(ffmpeg, ["-version"], "inspect FFmpeg version"),
      runProcess(ffprobe, ["-version"], "inspect FFprobe version"),
      exactFileSha256(ffmpeg),
      exactFileSha256(ffprobe),
      exactFileSha256(whisper),
    ]);
  if (!ffmpegVersion.stdout.startsWith(`ffmpeg version ${FFMPEG_VERSION} `)) {
    throw new Error(`Local FFmpeg must be pinned to ${FFMPEG_VERSION}.`);
  }
  if (!ffprobeVersion.stdout.startsWith(`ffprobe version ${FFMPEG_VERSION} `)) {
    throw new Error(`Local FFprobe must be pinned to ${FFMPEG_VERSION}.`);
  }
  if (!whisper.includes(`/whisper-cpp/${WHISPER_VERSION}/`)) {
    throw new Error(`Local whisper.cpp must be pinned to ${WHISPER_VERSION}.`);
  }
  return Object.freeze({ ffmpegSha256, ffprobeSha256, whisperSha256 });
}

function runProcess(
  command: string,
  arguments_: readonly string[],
  label: string,
  signal?: AbortSignal,
): Promise<ProcessCapture> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(`${label} was cancelled.`));
      return;
    }
    const child = spawn(command, arguments_, {
      cwd: REPO_ROOT,
      env: localProcessEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      reject(error);
    };
    const abort = () => {
      child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_CAPTURE_BYTES) {
        child.kill("SIGTERM");
        fail(new Error(`${label} exceeded its bounded output.`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_CAPTURE_BYTES) {
        child.kill("SIGTERM");
        fail(new Error(`${label} exceeded its bounded diagnostics.`));
        return;
      }
      stderr.push(chunk);
    });
    child.once("error", () => fail(new Error(`${label} could not start.`)));
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(new Error(`${label} was cancelled.`));
        return;
      }
      if (code !== 0) {
        const diagnostic = Buffer.concat(stderr)
          .toString("utf8")
          .slice(-2_000)
          .replaceAll(REPO_ROOT, "<repo>")
          .trim();
        reject(
          new Error(
            diagnostic
              ? `${label} exited with code ${String(code)}: ${diagnostic}`
              : `${label} exited with code ${String(code)} without diagnostics.`,
          ),
        );
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function cancellationMarker(root: string, token: string): string {
  const digest = createHash("sha256").update(token, "utf8").digest("hex");
  return path.join(root, "cancellations", `${digest}.cancel`);
}

async function runPythonBridge(
  command: "transcribe" | "render",
  arguments_: readonly string[],
  artifactRoot: string,
  cancelToken: string,
  signal: AbortSignal,
): Promise<unknown> {
  const python = path.join(REPO_ROOT, ".venv/bin/python");
  await access(python);
  const marker = cancellationMarker(artifactRoot, cancelToken);
  let markerWrite = Promise.resolve();
  let markerFailure: Error | null = null;
  const markCancelled = () => {
    markerWrite = markerWrite.then(async () => {
      try {
        await writeFile(marker, "cancelled\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
      } catch (error) {
        if (errorCode(error) !== "EEXIST") {
          markerFailure = new Error("Local cancellation marker could not be persisted.");
        }
      }
    });
  };
  await mkdir(path.dirname(marker), { recursive: true, mode: 0o700 });
  await unlink(marker).catch((error: unknown) => {
    if (errorCode(error) !== "ENOENT") throw error;
  });
  if (signal.aborted) throw new Error(`Local ${command} job was cancelled before launch.`);
  signal.addEventListener("abort", markCancelled, { once: true });
  try {
    const moduleName = "videoforge_image_media.local_cli";
    const capture = await runProcess(
      python,
      ["-m", moduleName, command, ...arguments_],
      `local ${command} job`,
    );
    await markerWrite;
    if (markerFailure) throw markerFailure;
    if (signal.aborted) throw new Error(`Local ${command} job was cancelled.`);
    try {
      return parseJsonStrict(capture.stdout);
    } catch {
      throw new Error(`Local ${command} job returned unreadable JSON.`);
    }
  } finally {
    signal.removeEventListener("abort", markCancelled);
    await markerWrite;
    await unlink(marker).catch((error: unknown) => {
      if (errorCode(error) !== "ENOENT") throw error;
    });
  }
}

async function safePublicSource(publicPath: string): Promise<string> {
  if (!publicPath.startsWith("/fixtures/")) {
    throw new Error("Owned local media must come from the tracked fixture namespace.");
  }
  const resolved = await realpath(path.join(PUBLIC_ROOT, publicPath.slice(1)));
  const relative = path.relative(PUBLIC_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Owned fixture path escaped the public asset root.");
  }
  return resolved;
}

async function writeCanonicalRunDocument(
  store: LocalArtifactStore,
  revisionId: string,
  attemptId: string,
  filename: string,
  value: JsonValue,
): Promise<string> {
  const destination = await store.resolveRunFile(revisionId, attemptId, filename);
  await writeFile(destination, canonicalizeJson(value), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return destination;
}

export interface LocalMediaPipelineRunnerOptions {
  readonly artifactRoot?: string;
}

export class LocalMediaPipelineRunner implements LocalSliceRunner {
  private readonly artifactRoot: string;
  private storePromise: Promise<LocalArtifactStore> | null = null;
  private attemptSequence = 0;

  constructor(options: LocalMediaPipelineRunnerOptions = {}) {
    this.artifactRoot = path.resolve(
      options.artifactRoot ?? process.env.VIDEOFORGE_LOCAL_ARTIFACT_ROOT ?? DEFAULT_ARTIFACT_ROOT,
    );
  }

  private store(): Promise<LocalArtifactStore> {
    this.storePromise ??= LocalArtifactStore.create(this.artifactRoot);
    return this.storePromise;
  }

  async prepareOwnedVoiceover(): Promise<LocalOwnedVoiceover> {
    const store = await this.store();
    const temporary = await mkdtemp(path.join(tmpdir(), "videoforge-owned-voiceover-"));
    const aiffPath = path.join(temporary, "owned-narration.aiff");
    const wavPath = path.join(temporary, "owned-narration.wav");
    try {
      await runProcess(
        "/usr/bin/say",
        [
          "-v",
          OWNED_VOICE,
          "-r",
          OWNED_SPEECH_RATE,
          "-o",
          aiffPath,
          LOCAL_SHORT_SLICE_MANIFEST.narration.text,
        ],
        "owned narration generation",
      );
      const ffmpeg = await executable("ffmpeg");
      await runProcess(
        ffmpeg,
        [
          "-hide_banner",
          "-nostdin",
          "-loglevel",
          "error",
          "-y",
          "-i",
          aiffPath,
          "-map",
          "0:a:0",
          "-vn",
          "-map_metadata",
          "-1",
          "-fflags",
          "+bitexact",
          "-flags:a",
          "+bitexact",
          "-ar",
          "48000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          wavPath,
        ],
        "owned narration normalization",
      );
      const ffprobe = await executable("ffprobe");
      const probe = await runProcess(
        ffprobe,
        ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath],
        "owned narration probe",
      );
      const durationSeconds = Number(probe.stdout.trim());
      const envelope = LOCAL_SHORT_SLICE_MANIFEST.narration.durationEnvelopeMs;
      if (
        !Number.isFinite(durationSeconds) ||
        durationSeconds * 1_000 < envelope.min ||
        durationSeconds * 1_000 > envelope.max
      ) {
        throw new Error("Owned narration duration is outside its immutable acceptance envelope.");
      }
      const artifact = await store.putObject(await readFile(wavPath), "wav");
      return Object.freeze({
        assetId: `fixture_voiceover_sha256_${artifact.sha256.slice("sha256:".length)}`,
        checksum: artifact.sha256,
        filename: "videoforge-owned-local-slice.wav",
        absolutePath: artifact.absolutePath,
        bytes: artifact.bytes,
        durationSeconds,
        sampleRate: 48_000,
        channels: 1,
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async restoreLatest(): Promise<LocalPipelineRunResult | null> {
    const store = await this.store();
    const revisionRunRoot = path.join(store.root, "runs", LOCAL_REVISION_ID);
    let entries;
    try {
      entries = await readdir(revisionRunRoot, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
    const attempts = entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          /^attempt_render_local_[0-9]{3}$/u.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, "en"));
    if (attempts.length === 0) return null;
    const attemptId = attempts[0]!;
    const statePath = await store.resolveRunFile(
      LOCAL_REVISION_ID,
      attemptId,
      RUNTIME_STATE_FILENAME,
    );
    let stateBytes: Buffer;
    try {
      stateBytes = await readFile(statePath);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw new Error("The latest local render attempt has no restorable runtime state.");
      }
      throw error;
    }
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    const state = parseRuntimeState(parseJsonStrict(decoder.decode(stateBytes)));
    const [
      source,
      output,
      transcript,
      timeline,
      generationWork,
      renderWork,
      manifest,
      renderResult,
      evidence,
      ...spans
    ] = await Promise.all([
      store.verifyObject(state.source_voiceover_sha256, "wav"),
      store.verifyObject(state.output.sha256, "mp4"),
      store.readObject(state.documents.transcript_sha256, "json"),
      store.readObject(state.documents.timeline_sha256, "json"),
      store.readObject(state.documents.generation_work_manifest_sha256, "json"),
      store.readObject(state.documents.render_work_manifest_sha256, "json"),
      store.readObject(state.documents.resolved_render_manifest_sha256, "json"),
      store.readObject(state.documents.render_result_sha256, "json"),
      store.readObject(state.evidence_sha256, "json"),
      ...state.selected_span_audio.map((span) => store.verifyObject(span.sha256, "wav")),
    ]);
    if (
      source.sha256 !== state.source_voiceover_sha256 ||
      output.bytes !== state.output.bytes ||
      transcript.sha256 !== state.documents.transcript_sha256 ||
      timeline.sha256 !== state.documents.timeline_sha256 ||
      generationWork.sha256 !== state.documents.generation_work_manifest_sha256 ||
      renderWork.sha256 !== state.documents.render_work_manifest_sha256 ||
      manifest.sha256 !== state.documents.resolved_render_manifest_sha256 ||
      renderResult.sha256 !== state.documents.render_result_sha256 ||
      evidence.sha256 !== state.evidence_sha256 ||
      spans.some((span, index) => span.bytes !== state.selected_span_audio[index]?.bytes)
    ) {
      throw new Error("The latest persisted local runtime state does not match its artifacts.");
    }
    const [
      transcriptDocument,
      timelineDocument,
      generationWorkDocument,
      renderWorkDocument,
      manifestDocument,
      renderResultDocument,
    ] = await Promise.all([
      validateAndHashContractDocument(
        "transcriptTiming",
        parseJsonStrict(decoder.decode(transcript.content)),
      ),
      validateAndHashContractDocument(
        "timelinePlan",
        parseJsonStrict(decoder.decode(timeline.content)),
      ),
      validateAndHashContractDocument(
        "generationWorkManifest",
        parseJsonStrict(decoder.decode(generationWork.content)),
      ),
      validateAndHashContractDocument(
        "renderWorkManifest",
        parseJsonStrict(decoder.decode(renderWork.content)),
      ),
      validateAndHashContractDocument(
        "resolvedRenderManifest",
        parseJsonStrict(decoder.decode(manifest.content)),
      ),
      validateAndHashContractDocument(
        "renderJobResult",
        parseJsonStrict(decoder.decode(renderResult.content)),
      ),
    ]);
    if (
      transcriptDocument.sha256 !== state.documents.transcript_sha256 ||
      timelineDocument.sha256 !== state.documents.timeline_sha256 ||
      generationWorkDocument.sha256 !== state.documents.generation_work_manifest_sha256 ||
      renderWorkDocument.sha256 !== state.documents.render_work_manifest_sha256 ||
      manifestDocument.sha256 !== state.documents.resolved_render_manifest_sha256 ||
      renderResultDocument.sha256 !== state.documents.render_result_sha256 ||
      transcriptDocument.value.project_revision_id !== LOCAL_REVISION_ID ||
      timelineDocument.value.project_revision_id !== LOCAL_REVISION_ID ||
      generationWorkDocument.value.project_revision_id !== LOCAL_REVISION_ID ||
      renderWorkDocument.value.project_revision_id !== LOCAL_REVISION_ID ||
      manifestDocument.value.project_revision_id !== LOCAL_REVISION_ID ||
      transcriptDocument.value.source.sha256 !== state.source_voiceover_sha256 ||
      manifestDocument.value.timeline_plan_hash !== state.documents.timeline_sha256 ||
      generationWorkDocument.value.timeline_plan_hash !== state.documents.timeline_sha256 ||
      renderWorkDocument.value.timeline_plan_hash !== state.documents.timeline_sha256 ||
      renderWorkDocument.value.generation_work_manifest_hash !==
        state.documents.generation_work_manifest_sha256 ||
      manifestDocument.value.voiceover.sha256 !== state.source_voiceover_sha256 ||
      timelineDocument.value.total_frames !== state.output.total_frames ||
      renderResultDocument.value.status !== "SUCCEEDED" ||
      renderResultDocument.value.output === null ||
      renderResultDocument.value.probe === null ||
      renderResultDocument.value.output.filename !== state.output.filename ||
      renderResultDocument.value.output.sha256 !== state.output.sha256 ||
      renderResultDocument.value.output.bytes !== state.output.bytes ||
      renderResultDocument.value.probe.duration_ms !== state.output.duration_ms ||
      renderResultDocument.value.probe.total_frames !== state.output.total_frames
    ) {
      throw new Error("The latest persisted local contracts do not bind to one accepted result.");
    }
    verifySelectedSpanLineage(
      timelineDocument.value,
      transcriptDocument.value.source.duration_ms,
      state.selected_span_audio,
    );
    const evidenceRecord = exactRecord(
      parseJsonStrict(decoder.decode(evidence.content)),
      [
        "schema_version",
        "provider_calls_authorized",
        "external_spend_usd",
        "source_fixture_id",
        "attempts",
        "source_voiceover",
        "tools",
        "documents",
        "provider_acceptance_proofs",
        "output",
        "selected_span_audio",
        "grammar",
      ],
      "Persisted acceptance evidence",
    );
    const evidenceSource = exactRecord(
      evidenceRecord.source_voiceover,
      ["asset_id", "sha256", "bytes", "duration_ms", "narrator", "speech_rate"],
      "Persisted evidence source",
    );
    const evidenceDocuments = exactRecord(
      evidenceRecord.documents,
      [
        "revision_config_sha256",
        "asr_input_sha256",
        "asr_result_sha256",
        "transcript_sha256",
        "timeline_sha256",
        "generation_work_manifest_sha256",
        "render_work_manifest_sha256",
        "resolved_render_manifest_sha256",
        "render_input_sha256",
        "render_result_sha256",
      ],
      "Persisted evidence documents",
    );
    const evidenceProofs = exactRecord(
      evidenceRecord.provider_acceptance_proofs,
      collectRequiredAssetTaskKeys(timelineDocument.value),
      "Persisted provider acceptance proofs",
    );
    for (const [taskKey, value] of Object.entries(evidenceProofs)) {
      const proof = exactRecord(
        value,
        [
          "schemaVersion",
          "acceptanceFingerprintHash",
          "acceptedAttemptId",
          "acceptedAssetId",
          "acceptedBinarySha256",
          "qaState",
          "qaResultId",
          "resultDisposition",
          "providerOperation",
          "modelLineage",
          "promptLineage",
          "runtimeEvidence",
          "qualityReview",
          "cost",
        ],
        `Persisted provider proof ${taskKey}`,
      );
      requireSha256Digest(
        exactString(proof.acceptanceFingerprintHash, `${taskKey} acceptance fingerprint`),
        `${taskKey} acceptance fingerprint`,
      );
      requireSha256Digest(
        exactString(proof.acceptedBinarySha256, `${taskKey} accepted checksum`),
        `${taskKey} accepted checksum`,
      );
      if (proof.qaState !== "PASSED" || proof.resultDisposition !== "ACCEPTED")
        throw new Error(`Persisted provider proof ${taskKey} is no longer accepted.`);
    }
    const evidenceOutput = exactRecord(
      evidenceRecord.output,
      ["asset_id", "sha256", "bytes", "artifact_uri", "filename", "probe"],
      "Persisted evidence output",
    );
    const evidenceProbe = exactRecord(
      evidenceOutput.probe,
      [
        "schema_version",
        "asset_id",
        "sha256",
        "bytes",
        "container",
        "duration_ms",
        "total_frames",
        "video",
        "audio",
        "stream_counts",
        "av_drift_ms",
        "decode_ok",
        "loudness",
        "tools",
      ],
      "Persisted evidence probe",
    );
    if (
      evidenceRecord.schema_version !== "videoforge.local-slice-evidence/v1" ||
      evidenceRecord.provider_calls_authorized !== false ||
      evidenceRecord.external_spend_usd !== 0 ||
      evidenceSource.sha256 !== state.source_voiceover_sha256 ||
      evidenceDocuments.transcript_sha256 !== state.documents.transcript_sha256 ||
      evidenceDocuments.timeline_sha256 !== state.documents.timeline_sha256 ||
      evidenceDocuments.generation_work_manifest_sha256 !==
        state.documents.generation_work_manifest_sha256 ||
      evidenceDocuments.render_work_manifest_sha256 !==
        state.documents.render_work_manifest_sha256 ||
      evidenceDocuments.resolved_render_manifest_sha256 !==
        state.documents.resolved_render_manifest_sha256 ||
      evidenceDocuments.render_result_sha256 !== state.documents.render_result_sha256 ||
      evidenceOutput.filename !== state.output.filename ||
      evidenceOutput.sha256 !== state.output.sha256 ||
      evidenceOutput.bytes !== state.output.bytes ||
      evidenceProbe.duration_ms !== state.output.duration_ms ||
      evidenceProbe.total_frames !== state.output.total_frames ||
      canonicalizeJson(evidenceRecord.selected_span_audio as JsonValue) !==
        canonicalizeJson(state.selected_span_audio as unknown as JsonValue)
    ) {
      throw new Error("The latest persisted local evidence does not bind to runtime state.");
    }
    const evidencePath = await store.resolveRunFile(
      LOCAL_REVISION_ID,
      attemptId,
      "acceptance-evidence.json",
    );
    if ((await exactFileSha256(evidencePath)) !== state.evidence_sha256) {
      throw new Error("The latest persisted local acceptance evidence has drifted.");
    }
    return Object.freeze({
      artifactRoot: store.root,
      sourceVoiceoverSha256: state.source_voiceover_sha256,
      filename: state.output.filename,
      sha256: state.output.sha256,
      bytes: state.output.bytes,
      durationMs: state.output.duration_ms,
      totalFrames: state.output.total_frames,
      transcriptSha256: state.documents.transcript_sha256,
      timelineSha256: state.documents.timeline_sha256,
      generationWorkManifestSha256: state.documents.generation_work_manifest_sha256,
      renderWorkManifestSha256: state.documents.render_work_manifest_sha256,
      resolvedRenderManifestSha256: state.documents.resolved_render_manifest_sha256,
      renderResultSha256: state.documents.render_result_sha256,
      selectedSpanAudio: state.selected_span_audio,
      evidencePath,
      evidenceSha256: state.evidence_sha256,
    });
  }

  async run(request: LocalPipelineRunRequest): Promise<LocalPipelineRunResult> {
    if (
      request.projectId !== LOCAL_PROJECT_ID ||
      request.revisionId !== LOCAL_REVISION_ID ||
      request.createRequest.voiceover_asset_id !== request.voiceover.assetId ||
      request.createRequest.avatar_profile_version_id !==
        LOCAL_SHORT_SLICE_MANIFEST.pinnedProfiles.avatarProfileVersionId ||
      request.createRequest.image_style_version_id !==
        LOCAL_SHORT_SLICE_MANIFEST.pinnedProfiles.imageStyleVersionId
    ) {
      throw new Error("Local runner inputs do not match the immutable owned walking slice.");
    }
    const store = await this.store();
    const ordinal = await this.nextAttemptOrdinal(store, request.revisionId);
    const suffix = String(ordinal).padStart(3, "0");
    const asrAttemptId = `attempt_asr_local_${suffix}`;
    const renderAttemptId = `attempt_render_local_${suffix}`;
    const asrCancelToken = `local-asr-cancel-token-${suffix}-${"0".repeat(24)}`;
    const renderCancelToken = `local-render-cancel-token-${suffix}-${"0".repeat(21)}`;
    const [ffmpeg, ffprobe, whisper] = await Promise.all([
      executable("ffmpeg"),
      executable("ffprobe"),
      executable("whisper-cli"),
    ]);
    const toolFacts = await verifyPinnedTools(ffmpeg, ffprobe, whisper);
    const model = await realpath(MODEL_PATH);
    if ((await exactFileSha256(model)) !== MODEL_SHA256) {
      throw new Error("Pinned local whisper.cpp base.en model checksum does not match.");
    }

    request.onProgress({
      stage: "TRANSCRIBING",
      detail: "Pinned whisper.cpp base.en is producing real local word timing",
    });
    const asrInput = await validateAndHashContractDocument("asrJobInput", {
      schema_version: "asr-job-input/v1",
      project_revision_id: request.revisionId,
      attempt_id: asrAttemptId,
      voiceover: {
        asset_id: request.voiceover.assetId,
        sha256: request.voiceover.checksum,
        artifact_uri: objectUri(await store.verifyObject(request.voiceover.checksum, "wav")),
        media_type: "audio/wav",
        duration_ms: Math.round(request.voiceover.durationSeconds * 1_000),
      },
      model: {
        engine: "whisper.cpp",
        name: "base.en",
        sha256: MODEL_SHA256,
        language: "en",
      },
      options: {
        threads: 4,
        processors: 1,
        flash_attention: true,
        greedy: true,
        split_on_word: true,
      },
      output: {
        result_uri: `vf-local-run://${request.revisionId}/${asrAttemptId}/asr-result.json`,
      },
      cancel_token: asrCancelToken,
    });
    const asrInputPath = await writeCanonicalRunDocument(
      store,
      request.revisionId,
      asrAttemptId,
      "asr-input.json",
      asrInput.value,
    );
    const asrRaw = await runPythonBridge(
      "transcribe",
      [
        "--artifact-root",
        store.root,
        "--input",
        asrInputPath,
        "--whisper",
        whisper,
        "--model",
        model,
        "--whisper-version",
        WHISPER_VERSION,
        "--ffmpeg",
        ffmpeg,
        "--ffprobe",
        ffprobe,
      ],
      store.root,
      asrCancelToken,
      request.signal,
    );
    const asrResult = await validateAndHashContractDocument("asrJobResult", asrRaw);
    if (
      asrResult.value.attempt_id !== asrAttemptId ||
      asrResult.value.source_voiceover_sha256 !== request.voiceover.checksum ||
      asrResult.value.model_sha256 !== MODEL_SHA256
    ) {
      throw new Error("Local transcription result does not bind to the current ASR input.");
    }
    if (asrResult.value.status !== "SUCCEEDED" || asrResult.value.transcript === null) {
      throw new Error(
        asrResult.value.error?.message ?? "Local transcription did not produce a transcript.",
      );
    }
    const transcript = await validateAndHashContractDocument(
      "transcriptTiming",
      asrResult.value.transcript,
    );
    if (
      transcript.value.project_revision_id !== request.revisionId ||
      transcript.value.source.asset_id !== request.voiceover.assetId ||
      transcript.value.source.sha256 !== request.voiceover.checksum ||
      transcript.value.source.duration_ms !== asrInput.value.voiceover.duration_ms ||
      transcript.value.engine.model_sha256 !== MODEL_SHA256 ||
      transcript.value.engine.version !== WHISPER_VERSION
    ) {
      throw new Error(
        "Local transcript identity does not bind to the current revision and source.",
      );
    }

    request.onProgress({
      stage: "SCHEDULING",
      detail: "Pinning source checksums and compiling the seeded 30 fps timeline",
    });
    const sources = await this.prepareSourceMedia(store, request.signal);
    const revision = await validateAndHashContractDocument("projectRevisionConfig", {
      schema_version: "project-revision-config/v2",
      project_id: request.projectId,
      project_revision_id: request.revisionId,
      title: request.createRequest.title,
      voiceover_asset_id: request.voiceover.assetId,
      voiceover_sha256: request.voiceover.checksum,
      avatar_binding: {
        avatar_profile_id: "avatar_profile_fixture_001",
        avatar_profile_version_id: request.createRequest.avatar_profile_version_id,
        avatar_display_name_snapshot: "Amish Farm Host",
        avatar_profile_hash:
          "sha256:aa4f5236269ba63ae3ffdbd5ce6ed7e1c7c2cd31e93ea42b7f427afcd502d1ea",
        runtime_source_asset_id: `asset_avatar_source_${sources.avatarSource.sha256.slice(7, 31)}`,
        runtime_source_sha256: sources.avatarSource.sha256,
        source_preparation_version: "avatar-source-prep-v1",
        source_validation_profile_version: "avatar-source-validation-v1",
        compatibility_state_at_preflight: "UNTESTED",
        compatibility_evidence: null,
      },
      optional_script: request.createRequest.optional_script ?? null,
      image_style_version_id: request.createRequest.image_style_version_id,
      style_profile_hash: "sha256:a0be214b3a153a9a9641734102a53ed450af0ad99b8ecfb8b0196a7b83cdb0a2",
      extra_prompt_keywords: request.createRequest.extra_prompt_keywords,
      apply_extra_prompt_keywords: request.createRequest.apply_extra_prompt_keywords,
      generation_mode: request.createRequest.generation_mode,
      execution_profiles: {
        image_media_profile_id: "exec_image_media_local_v1",
        avatar_primary_profile_id: "exec_avatar_local_fixture_v1",
        avatar_repair_profile_id: null,
        avatar_quality_profile_id: null,
      },
      spend_cap_usd: request.createRequest.spend_cap_usd,
      scheduler_version: "scheduler-v2",
      scheduler_seed: request.createRequest.user_seed ?? 982_341,
      prompt_writer_version: "fixture-prompt-writer-v1",
      prompt_compiler_version: "fixture-prompt-compiler-v1",
    });
    const timeline = requirePipeline(
      await scheduleTimeline({ revision, transcript, determinism }),
      "Deterministic timeline scheduling",
    );
    const [transcriptArtifact, timelineArtifact] = await Promise.all([
      store.putObject(Buffer.from(canonicalizeJson(transcript.value), "utf8"), "json"),
      store.putObject(Buffer.from(canonicalizeJson(timeline.value), "utf8"), "json"),
    ]);
    if (
      transcriptArtifact.sha256 !== transcript.sha256 ||
      timelineArtifact.sha256 !== timeline.sha256
    ) {
      throw new Error("Persisted timing document bytes do not match their canonical hashes.");
    }
    const timelineCompositionCoverage = requireCompositionCoverage(
      timeline.value.segments,
      "Deterministic timeline",
    );
    const selectedSpanAudio = await this.materializeSelectedSpanAudio(
      store,
      request.voiceover,
      timeline.value,
      ffmpeg,
      ffprobe,
      request.signal,
    );
    const schedulerConfigHash = await sha256CanonicalJson(SUPPORTED_SCHEDULER_CONFIG);
    const completeWorkPlan = requirePipeline(
      await compileCompleteWorkPlan({
        revision,
        transcript,
        timeline,
        schedulerConfigHash,
        selectedSpanAudio,
      }),
      "Complete generation and render work planning",
    );
    const [generationWorkArtifact, renderWorkArtifact] = await Promise.all([
      store.putObject(
        Buffer.from(canonicalizeJson(completeWorkPlan.generationWorkManifest.value), "utf8"),
        "json",
      ),
      store.putObject(
        Buffer.from(canonicalizeJson(completeWorkPlan.renderWorkManifest.value), "utf8"),
        "json",
      ),
    ]);
    if (
      generationWorkArtifact.sha256 !== completeWorkPlan.generationWorkManifest.sha256 ||
      renderWorkArtifact.sha256 !== completeWorkPlan.renderWorkManifest.sha256
    ) {
      throw new Error("Persisted work manifest bytes do not match their canonical hashes.");
    }

    request.onProgress({
      stage: "RESOLVING_ASSETS",
      detail: "Binding owned fixture images and the synthetic avatar clip by exact checksum",
    });
    const renderMedia = await this.prepareRenderMedia(
      store,
      sources,
      timeline.value.total_frames,
      ffmpeg,
      request.signal,
    );
    const requiredTaskKeys = collectRequiredAssetTaskKeys(timeline.value);
    const candidates: readonly ProviderAcceptedAssetCandidate[] = requiredTaskKeys.map(
      (taskKey, index) => {
        if (taskKey.startsWith("avatar:")) {
          const binding: AcceptedAssetBinding = {
            taskKey,
            assetId: `asset_avatar_clip_${renderMedia.avatarClip.sha256.slice(7, 31)}`,
            sha256: renderMedia.avatarClip.sha256,
            kind: "AVATAR_CLIP" as const,
            rendererSourceProfile: "avatarforcing-centered-832x480p25-v1",
          };
          return Object.freeze({
            ...binding,
            acceptance: localProviderAcceptance(binding, index),
          });
        }
        const image = renderMedia.images[index % renderMedia.images.length];
        if (!image) throw new Error("Owned image fixture set is empty.");
        const binding: AcceptedAssetBinding = {
          taskKey,
          assetId: `asset_image_${image.sha256.slice(7, 31)}`,
          sha256: image.sha256,
          kind: "IMAGE" as const,
        };
        return Object.freeze({ ...binding, acceptance: localProviderAcceptance(binding, index) });
      },
    );
    const acceptedAssets = requirePipeline(
      resolveProviderAcceptedAssets({ timeline, requiredTaskKeys, candidates }),
      "Accepted fake-provider-shaped asset resolution",
    );
    const voiceoverBinding: AcceptedAssetBinding = {
      taskKey: "voiceover",
      assetId: request.voiceover.assetId,
      sha256: request.voiceover.checksum,
      kind: "VOICEOVER",
    };
    const resolvedManifest = requirePipeline(
      await planResolvedRenderManifest({
        revision,
        timeline,
        voiceover: voiceoverBinding,
        acceptedAssets,
        renderProfileVersion: SUPPORTED_RENDER_PROFILE_VERSION,
      }),
      "Resolved render manifest planning",
    );
    requireCompositionCoverage(resolvedManifest.value.segments, "Resolved render manifest");
    const manifestArtifact = await store.putObject(
      Buffer.from(canonicalizeJson(resolvedManifest.value), "utf8"),
      "json",
    );
    if (manifestArtifact.sha256 !== resolvedManifest.sha256) {
      throw new Error("Canonical resolved manifest bytes do not match their JCS hash.");
    }

    const artifactByIdentity = new Map<
      string,
      { readonly artifact: StoredLocalArtifact; readonly kind: "AVATAR_CLIP" | "IMAGE" }
    >();
    for (const candidate of candidates) {
      if (candidate.kind === "VOICEOVER")
        throw new Error("Provider visual candidate cannot be a voiceover.");
      const artifact =
        candidate.kind === "AVATAR_CLIP"
          ? renderMedia.avatarClip
          : renderMedia.images.find((image) => image.sha256 === candidate.sha256);
      if (!artifact) throw new Error(`Accepted local asset ${candidate.assetId} is unavailable.`);
      artifactByIdentity.set(candidate.assetId, { artifact, kind: candidate.kind });
    }
    const renderAssets = [
      {
        asset_id: request.voiceover.assetId,
        sha256: request.voiceover.checksum,
        artifact_uri: objectUri(await store.verifyObject(request.voiceover.checksum, "wav")),
        kind: "VOICEOVER" as const,
      },
      ...[...artifactByIdentity].map(([assetId, binding]) => ({
        asset_id: assetId,
        sha256: binding.artifact.sha256,
        artifact_uri: objectUri(binding.artifact),
        kind: binding.kind,
      })),
    ];

    request.onProgress({
      stage: "RENDERING",
      detail: "Direct FFmpeg is compiling hard cuts, fixed crops, and smooth image zooms",
    });
    const renderInput = await validateAndHashContractDocument("renderJobInput", {
      schema_version: "render-job-input/v1",
      project_revision_id: request.revisionId,
      attempt_id: renderAttemptId,
      resolved_render_manifest: {
        asset_id: `asset_render_manifest_${manifestArtifact.sha256.slice(7, 31)}`,
        sha256: manifestArtifact.sha256,
        artifact_uri: objectUri(manifestArtifact),
      },
      assets: renderAssets,
      output: {
        result_uri: `vf-local-run://${request.revisionId}/${renderAttemptId}/${OUTPUT_FILENAME}`,
        filename: OUTPUT_FILENAME,
      },
      tools: {
        ffmpeg_version: FFMPEG_VERSION,
        ffprobe_version: FFMPEG_VERSION,
      },
      cancel_token: renderCancelToken,
    });
    const renderInputPath = await writeCanonicalRunDocument(
      store,
      request.revisionId,
      renderAttemptId,
      "render-input.json",
      renderInput.value,
    );
    const renderRaw = await runPythonBridge(
      "render",
      [
        "--artifact-root",
        store.root,
        "--input",
        renderInputPath,
        "--claimed-attempt-id",
        renderAttemptId,
        "--ffmpeg",
        ffmpeg,
        "--ffprobe",
        ffprobe,
        "--ffmpeg-version",
        FFMPEG_VERSION,
        "--ffprobe-version",
        FFMPEG_VERSION,
      ],
      store.root,
      renderCancelToken,
      request.signal,
    );
    const renderResult = await validateAndHashContractDocument("renderJobResult", renderRaw);
    if (renderResult.value.attempt_id !== renderAttemptId) {
      throw new Error("Local render result does not bind to the current render attempt.");
    }
    if (
      renderResult.value.status !== "SUCCEEDED" ||
      renderResult.value.output === null ||
      renderResult.value.probe === null
    ) {
      throw new Error(renderResult.value.error?.message ?? "Local render did not produce an MP4.");
    }
    request.onProgress({
      stage: "PROBING",
      detail: "FFprobe and full decode accepted the exact 1080p30 H.264/AAC output",
    });
    const outputSha256 = requireSha256Digest(
      renderResult.value.output.sha256,
      "Rendered output checksum",
    );
    if (
      renderResult.value.output.filename !== OUTPUT_FILENAME ||
      renderResult.value.output.artifact_uri !== objectUriForDigest(outputSha256, "mp4")
    ) {
      throw new Error(
        "Local render output does not bind to the requested filename and object URI.",
      );
    }
    const output = await store.verifyObject(outputSha256, "mp4");
    if (output.bytes !== renderResult.value.output.bytes) {
      throw new Error("Published local MP4 byte count drifted after technical acceptance.");
    }
    const renderResultArtifact = await store.putObject(
      Buffer.from(canonicalizeJson(renderResult.value), "utf8"),
      "json",
    );
    if (renderResultArtifact.sha256 !== renderResult.sha256) {
      throw new Error("Canonical render result bytes do not match their JCS hash.");
    }
    const evidencePath = await store.resolveRunFile(
      request.revisionId,
      renderAttemptId,
      "acceptance-evidence.json",
    );
    const evidenceBytes = Buffer.from(
      canonicalizeJson({
        schema_version: "videoforge.local-slice-evidence/v1",
        provider_calls_authorized: false,
        external_spend_usd: 0,
        source_fixture_id: LOCAL_SHORT_SLICE_MANIFEST.fixtureId,
        attempts: {
          asr: asrAttemptId,
          render: renderAttemptId,
        },
        source_voiceover: {
          asset_id: request.voiceover.assetId,
          sha256: request.voiceover.checksum,
          bytes: request.voiceover.bytes,
          duration_ms: transcript.value.source.duration_ms,
          narrator: OWNED_VOICE,
          speech_rate: Number(OWNED_SPEECH_RATE),
        },
        tools: {
          whisper_cpp: WHISPER_VERSION,
          whisper_executable_sha256: toolFacts.whisperSha256,
          whisper_model_name: "base.en",
          whisper_model_sha256: MODEL_SHA256,
          ffmpeg: FFMPEG_VERSION,
          ffmpeg_executable_sha256: toolFacts.ffmpegSha256,
          ffprobe: FFMPEG_VERSION,
          ffprobe_executable_sha256: toolFacts.ffprobeSha256,
        },
        documents: {
          revision_config_sha256: revision.sha256,
          asr_input_sha256: asrInput.sha256,
          asr_result_sha256: asrResult.sha256,
          transcript_sha256: transcript.sha256,
          timeline_sha256: timeline.sha256,
          generation_work_manifest_sha256: completeWorkPlan.generationWorkManifest.sha256,
          render_work_manifest_sha256: completeWorkPlan.renderWorkManifest.sha256,
          resolved_render_manifest_sha256: resolvedManifest.sha256,
          render_input_sha256: renderInput.sha256,
          render_result_sha256: renderResult.sha256,
        },
        provider_acceptance_proofs: acceptedAssets.acceptanceProofsByTaskKey,
        output: {
          ...renderResult.value.output,
          probe: renderResult.value.probe,
        },
        selected_span_audio: selectedSpanAudio,
        grammar: {
          ...LOCAL_SHORT_SLICE_MANIFEST.expectedOutput,
          actual_composition_coverage: timelineCompositionCoverage,
        },
      }),
      "utf8",
    );
    const evidenceArtifact = await store.putObject(evidenceBytes, "json");
    await writeFile(evidencePath, evidenceBytes, { flag: "wx", mode: 0o600 });
    const runtimeState: PersistedLocalRuntimeState = Object.freeze({
      schema_version: RUNTIME_STATE_SCHEMA_VERSION,
      source_voiceover_sha256: request.voiceover.checksum,
      output: Object.freeze({
        filename: renderResult.value.output.filename,
        sha256: outputSha256,
        bytes: renderResult.value.output.bytes,
        duration_ms: renderResult.value.probe.duration_ms,
        total_frames: renderResult.value.probe.total_frames,
      }),
      documents: Object.freeze({
        transcript_sha256: transcript.sha256,
        timeline_sha256: timeline.sha256,
        generation_work_manifest_sha256: completeWorkPlan.generationWorkManifest.sha256,
        render_work_manifest_sha256: completeWorkPlan.renderWorkManifest.sha256,
        resolved_render_manifest_sha256: resolvedManifest.sha256,
        render_result_sha256: renderResult.sha256,
      }),
      selected_span_audio: selectedSpanAudio,
      evidence_sha256: evidenceArtifact.sha256,
    });
    await writeCanonicalRunDocument(
      store,
      request.revisionId,
      renderAttemptId,
      RUNTIME_STATE_FILENAME,
      runtimeState as unknown as JsonValue,
    );

    return Object.freeze({
      artifactRoot: store.root,
      sourceVoiceoverSha256: request.voiceover.checksum,
      filename: renderResult.value.output.filename,
      sha256: outputSha256,
      bytes: renderResult.value.output.bytes,
      durationMs: renderResult.value.probe.duration_ms,
      totalFrames: renderResult.value.probe.total_frames,
      transcriptSha256: transcript.sha256,
      timelineSha256: timeline.sha256,
      generationWorkManifestSha256: completeWorkPlan.generationWorkManifest.sha256,
      renderWorkManifestSha256: completeWorkPlan.renderWorkManifest.sha256,
      resolvedRenderManifestSha256: resolvedManifest.sha256,
      renderResultSha256: renderResult.sha256,
      selectedSpanAudio,
      evidencePath,
      evidenceSha256: evidenceArtifact.sha256,
    });
  }

  private async materializeSelectedSpanAudio(
    store: LocalArtifactStore,
    voiceover: LocalOwnedVoiceover,
    timeline: TimelinePlanDocument,
    ffmpeg: string,
    ffprobe: string,
    signal: AbortSignal,
  ): Promise<readonly LocalSelectedSpanAudio[]> {
    const paddingMs = SUPPORTED_SCHEDULER_CONFIG.selected_span_context_padding_ms;
    const avatarSegments = timeline.segments.filter(
      (segment) => segment.timeline_composition !== "IMAGE_FULL",
    );
    if (avatarSegments.length === 0) {
      throw new Error("The deterministic timeline selected no avatar audio spans.");
    }
    const temporary = await mkdtemp(path.join(tmpdir(), "videoforge-selected-spans-"));
    try {
      const selected: LocalSelectedSpanAudio[] = [];
      for (const [index, segment] of avatarSegments.entries()) {
        const selectedStartMs = segment.source_audio_start_ms;
        const selectedEndMsExclusive = segment.source_audio_end_ms;
        const sourceDurationMs = Math.round(voiceover.durationSeconds * 1_000);
        const paddedStartMs = Math.max(0, selectedStartMs - paddingMs);
        const paddedEndMsExclusive = Math.min(sourceDurationMs, selectedEndMsExclusive + paddingMs);
        const trimStartMs = selectedStartMs - paddedStartMs;
        const trimEndMsExclusive = trimStartMs + selectedEndMsExclusive - selectedStartMs;
        const output = path.join(temporary, `span-${String(index + 1).padStart(3, "0")}.wav`);
        await runProcess(
          ffmpeg,
          [
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-i",
            voiceover.absolutePath,
            "-map",
            "0:a:0",
            "-vn",
            "-af",
            `atrim=start_sample=${String(paddedStartMs * 48)}:end_sample=${String(paddedEndMsExclusive * 48)},asetpts=PTS-STARTPTS,aresample=16000`,
            "-map_metadata",
            "-1",
            "-fflags",
            "+bitexact",
            "-flags:a",
            "+bitexact",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            output,
          ],
          `selected span audio ${String(index + 1)}`,
          signal,
        );
        const probe = await runProcess(
          ffprobe,
          ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", output],
          `selected span audio probe ${String(index + 1)}`,
          signal,
        );
        const durationMs = Math.round(Number(probe.stdout.trim()) * 1_000);
        if (durationMs !== paddedEndMsExclusive - paddedStartMs) {
          throw new Error(`Selected span ${segment.segment_id} duration drifted after extraction.`);
        }
        const artifact = await store.putObject(await readFile(output), "wav");
        selected.push(
          Object.freeze({
            spanId: stableId("selected-span", segment.segment_id).replace(/^seg_/u, "span_"),
            artifactId: `asset_span_audio_${artifact.sha256.slice(7, 31)}`,
            timelineSegmentId: segment.segment_id,
            taskKey: segment.required_slots.avatar.span_audio_task_key,
            selectedStartMs,
            selectedEndMsExclusive,
            paddedStartMs,
            paddedEndMsExclusive,
            trimStartMs,
            trimEndMsExclusive,
            sha256: artifact.sha256,
            bytes: artifact.bytes,
            durationMs,
          }),
        );
      }
      return Object.freeze(selected);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async nextAttemptOrdinal(store: LocalArtifactStore, revisionId: string): Promise<number> {
    for (let offset = 1; offset <= 999; offset += 1) {
      const ordinal = this.attemptSequence + offset;
      const attemptId = `attempt_asr_local_${String(ordinal).padStart(3, "0")}`;
      const candidate = await store.resolveRunFile(revisionId, attemptId, "asr-input.json");
      try {
        await access(candidate);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
        this.attemptSequence = ordinal;
        return ordinal;
      }
    }
    throw new Error("Local attempt namespace is exhausted.");
  }

  private async prepareSourceMedia(
    store: LocalArtifactStore,
    signal: AbortSignal,
  ): Promise<PreparedSourceMedia> {
    const temporary = await mkdtemp(path.join(tmpdir(), "videoforge-owned-sources-"));
    try {
      const sourcePaths = [
        LOCAL_SHORT_SLICE_MANIFEST.sources.avatar,
        ...LOCAL_SHORT_SLICE_MANIFEST.sources.styleExamples,
      ];
      const artifacts: StoredLocalArtifact[] = [];
      for (const source of sourcePaths) {
        const input = await safePublicSource(source.publicPath);
        const output = path.join(temporary, `${source.assetId}.png`);
        await runProcess(
          "/usr/bin/sips",
          ["-s", "format", "png", input, "--out", output],
          "owned SVG rasterization",
          signal,
        );
        artifacts.push(await store.putObject(await readFile(output), "png"));
      }
      const avatarSource = artifacts[0];
      if (!avatarSource) throw new Error("Owned avatar source was not prepared.");
      return Object.freeze({ avatarSource, images: Object.freeze(artifacts.slice(1)) });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async prepareRenderMedia(
    store: LocalArtifactStore,
    sources: PreparedSourceMedia,
    totalFrames: number,
    ffmpeg: string,
    signal: AbortSignal,
  ): Promise<PreparedRenderMedia> {
    const temporary = await mkdtemp(path.join(tmpdir(), "videoforge-owned-avatar-"));
    const output = path.join(temporary, "owned-avatar-832x480p25.mp4");
    try {
      const sourceFrames = Math.ceil((totalFrames * 25) / 30) + 2;
      await runProcess(
        ffmpeg,
        [
          "-hide_banner",
          "-nostdin",
          "-loglevel",
          "error",
          "-y",
          "-loop",
          "1",
          "-framerate",
          "25",
          "-i",
          sources.avatarSource.absolutePath,
          "-vf",
          "scale=832:480:force_original_aspect_ratio=increase,crop=832:480,setsar=1,fps=25,format=yuv420p",
          "-frames:v",
          String(sourceFrames),
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "18",
          "-map_metadata",
          "-1",
          "-movflags",
          "+faststart",
          output,
        ],
        "owned synthetic avatar clip preparation",
        signal,
      );
      const avatarClip = await store.putObject(await readFile(output), "mp4");
      return Object.freeze({ ...sources, avatarClip });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

export function createLocalMediaPipelineRunner(
  options: LocalMediaPipelineRunnerOptions = {},
): LocalMediaPipelineRunner {
  return new LocalMediaPipelineRunner(options);
}
