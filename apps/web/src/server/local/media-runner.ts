import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
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
  validateAndHashContractDocument,
  type JsonValue,
  type Sha256Digest,
} from "@videoforge/contracts";
import {
  collectRequiredAssetTaskKeys,
  LocalArtifactStore,
  planResolvedRenderManifest,
  resolveAcceptedAssets,
  scheduleTimeline,
  SUPPORTED_RENDER_PROFILE_VERSION,
  type AcceptedAssetBinding,
  type PipelineResult,
  type StoredLocalArtifact,
} from "@videoforge/pipeline";
import { LOCAL_SHORT_SLICE_MANIFEST } from "@videoforge/test-fixtures";

import type {
  LocalOwnedVoiceover,
  LocalPipelineRunRequest,
  LocalPipelineRunResult,
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
  if (
    !whisper.includes(`/whisper-cpp/${WHISPER_VERSION}/`) &&
    process.env.VIDEOFORGE_WHISPER_CPP_VERSION !== WHISPER_VERSION
  ) {
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
    const capture = await runProcess(
      python,
      ["-m", "videoforge_image_media.local_cli", command, ...arguments_],
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
      scheduler_version: "scheduler-v1",
      scheduler_seed: request.createRequest.user_seed ?? 982_341,
      prompt_writer_version: "fixture-prompt-writer-v1",
      prompt_compiler_version: "fixture-prompt-compiler-v1",
    });
    const timeline = requirePipeline(
      await scheduleTimeline({ revision, transcript, determinism }),
      "Deterministic timeline scheduling",
    );
    const timelineCompositionCoverage = requireCompositionCoverage(
      timeline.value.segments,
      "Deterministic timeline",
    );

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
    const candidates = requiredTaskKeys.map((taskKey, index) => {
      if (taskKey.startsWith("avatar:")) {
        return {
          taskKey,
          assetId: `asset_avatar_clip_${renderMedia.avatarClip.sha256.slice(7, 31)}`,
          sha256: renderMedia.avatarClip.sha256,
          kind: "AVATAR_CLIP" as const,
          rendererSourceProfile: "avatarforcing-centered-832x480p25-v1",
        };
      }
      const image = renderMedia.images[index % renderMedia.images.length];
      if (!image) throw new Error("Owned image fixture set is empty.");
      return {
        taskKey,
        assetId: `asset_image_${image.sha256.slice(7, 31)}`,
        sha256: image.sha256,
        kind: "IMAGE" as const,
      };
    });
    const acceptedAssets = requirePipeline(
      resolveAcceptedAssets({ timeline, requiredTaskKeys, candidates }),
      "Accepted fixture asset resolution",
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
    const evidencePath = await store.resolveRunFile(
      request.revisionId,
      renderAttemptId,
      "acceptance-evidence.json",
    );
    await writeFile(
      evidencePath,
      canonicalizeJson({
        schema_version: "videoforge.local-slice-evidence/v1",
        provider_calls_authorized: false,
        external_spend_usd: 0,
        source_fixture_id: LOCAL_SHORT_SLICE_MANIFEST.fixtureId,
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
          resolved_render_manifest_sha256: resolvedManifest.sha256,
          render_input_sha256: renderInput.sha256,
          render_result_sha256: renderResult.sha256,
        },
        output: {
          ...renderResult.value.output,
          probe: renderResult.value.probe,
        },
        grammar: {
          ...LOCAL_SHORT_SLICE_MANIFEST.expectedOutput,
          actual_composition_coverage: timelineCompositionCoverage,
        },
      }),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );

    return Object.freeze({
      artifactRoot: store.root,
      filename: renderResult.value.output.filename,
      sha256: outputSha256,
      bytes: renderResult.value.output.bytes,
      durationMs: renderResult.value.probe.duration_ms,
      totalFrames: renderResult.value.probe.total_frames,
      transcriptSha256: transcript.sha256,
      timelineSha256: timeline.sha256,
      resolvedRenderManifestSha256: resolvedManifest.sha256,
      renderResultSha256: renderResult.sha256,
      evidencePath,
    });
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
