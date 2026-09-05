import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { ProvenanceReceiptSigner, type ReceiptExpectation } from "@videoforge/control-plane";
import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";

import type { V208SoulXOrchestratorDependencies } from "./v208-soulx-orchestrator.js";
import { V213_GPU_VRAM_MAX_BYTES, V213_GPU_VRAM_MIN_BYTES } from "./v213-dual-lane-live.js";
import {
  v213SoulxWarmupAttestationSha256,
  verifyV213WorkerReceipt,
} from "./v213-provenance-receipt.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SECONDS = [2, 4, 6, 10] as const;
const execFileAsync = promisify(execFile);
const hashBytes = (value: Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}` as `sha256:${string}`;
const hashText = (value: string) =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}` as `sha256:${string}`;
const hashCanonical = (value: unknown) =>
  `sha256:${createHash("sha256")
    .update(canonicalizeJson(value as JsonValue))
    .digest("hex")}` as `sha256:${string}`;

export interface V208Mp4Probe {
  readonly format: "mp4";
  readonly width: 512;
  readonly height: 512;
  readonly fpsNum: 25;
  readonly fpsDen: 1;
  readonly durationMs: number;
  readonly videoStreams: 1;
  readonly audioStreams: 1;
  readonly videoCodec: "h264";
  readonly audioCodec: "aac";
  readonly audioSampleRate: 16000;
  readonly audioChannels: 1;
  readonly videoFrames: number;
  readonly videoDurationMs: number;
  readonly audioDurationMs: number;
}

/** Probes the exact downloaded bytes, never a provider URL or worker-supplied probe. */
export async function probeV208Mp4Bytes(bytes: Uint8Array): Promise<V208Mp4Probe> {
  if (bytes.byteLength === 0) throw new Error("V208_OUTPUT_READBACK_EMPTY");
  const directory = await mkdtemp(join(tmpdir(), "videoforge-v208-probe-"));
  const file = join(directory, "readback.mp4");
  try {
    await writeFile(file, bytes, { mode: 0o600, flag: "wx" });
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-count_frames",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,r_frame_rate,duration,nb_read_frames,sample_rate,channels:format=format_name,duration",
      "-of",
      "json",
      file,
    ]);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const streams = Array.isArray(parsed.streams)
      ? parsed.streams.filter(
          (stream): stream is Record<string, unknown> =>
            Boolean(stream) && typeof stream === "object" && !Array.isArray(stream),
        )
      : [];
    const video = streams.filter((stream) => stream.codec_type === "video");
    const audio = streams.filter((stream) => stream.codec_type === "audio");
    const format =
      parsed.format && typeof parsed.format === "object" && !Array.isArray(parsed.format)
        ? (parsed.format as Record<string, unknown>)
        : null;
    const durationMs = Number(format?.duration) * 1_000;
    const videoDurationMs = Number(video[0]?.duration) * 1_000;
    const audioDurationMs = Number(audio[0]?.duration) * 1_000;
    const videoFrames = Number(video[0]?.nb_read_frames);
    if (
      video.length !== 1 ||
      audio.length !== 1 ||
      video[0]?.width !== 512 ||
      video[0]?.height !== 512 ||
      video[0]?.r_frame_rate !== "25/1" ||
      video[0]?.codec_name !== "h264" ||
      audio[0]?.codec_name !== "aac" ||
      audio[0]?.sample_rate !== "16000" ||
      audio[0]?.channels !== 1 ||
      !Number.isSafeInteger(videoFrames) ||
      videoFrames < 1 ||
      !Number.isFinite(videoDurationMs) ||
      !Number.isFinite(audioDurationMs) ||
      Math.abs(videoDurationMs - audioDurationMs) > 80 ||
      typeof format?.format_name !== "string" ||
      !format.format_name.split(",").includes("mp4") ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0
    )
      throw new Error("V208_OUTPUT_FFPROBE_INVALID");
    return {
      format: "mp4",
      width: 512,
      height: 512,
      fpsNum: 25,
      fpsDen: 1,
      durationMs,
      videoStreams: 1,
      audioStreams: 1,
      videoCodec: "h264",
      audioCodec: "aac",
      audioSampleRate: 16000,
      audioChannels: 1,
      videoFrames,
      videoDurationMs,
      audioDurationMs,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function createV208SoulXReceiptVerifier(input: {
  readonly signer: ProvenanceReceiptSigner;
  readonly readOutput: (objectKey: string) => Promise<Uint8Array>;
  readonly probeMp4: (bytes: Uint8Array) => Promise<V208Mp4Probe>;
}): V208SoulXOrchestratorDependencies["verifySuccess"] {
  const seenNonces = new Set<number>();
  return async ({ descriptor, jobId, deployment, materialization, observed }) => {
    if (descriptor.lane !== "soulx" || descriptor.mode !== "complete" || descriptor.seconds !== 22)
      throw new Error("V208_RECEIPT_DESCRIPTOR_INVALID");
    if (!observed.receiptDelivery) throw new Error("V208_RECEIPT_UNPROVEN");
    const request = materialization.request as Record<string, JsonValue>;
    const envelope = request.envelope as Record<string, JsonValue>;
    const tenant = envelope.tenant as Record<string, JsonValue>;
    const work = envelope.work as Record<string, JsonValue>;
    const runtime = envelope.runtime as Record<string, JsonValue>;
    const dispatchToken = envelope.dispatch_token;
    if (
      typeof tenant?.account_id !== "string" ||
      typeof tenant.workspace_id !== "string" ||
      typeof work?.attempt_id !== "string" ||
      typeof runtime?.deployment_id !== "string" ||
      typeof dispatchToken !== "string"
    )
      throw new Error("V208_RECEIPT_EXPECTATION_INVALID");
    const { envelope: _envelope, ...requestBody } = request;
    void _envelope;
    const expectation: ReceiptExpectation = {
      dispatchTokenSha256: hashText(dispatchToken),
      envelopeSha256: hashCanonical(envelope),
      requestSha256: hashCanonical(requestBody),
      attemptId: work.attempt_id,
      providerJobId: jobId,
      accountId: tenant.account_id,
      workspaceId: tenant.workspace_id,
      deploymentId: runtime.deployment_id,
      endpointIdSha256: deployment.endpointIdSha256 as `sha256:${string}`,
      containerDigest: deployment.image.slice(
        deployment.image.indexOf("sha256:"),
      ) as `sha256:${string}`,
      volumeIdSha256: deployment.volumeIdSha256 as `sha256:${string}`,
      volumeManifestSha256: deployment.volumeManifestSha256 as `sha256:${string}`,
      modelManifestSha256: deployment.volumeManifestSha256 as `sha256:${string}`,
      warmupAttestationSha256: v213SoulxWarmupAttestationSha256(
        deployment.image.slice(deployment.image.indexOf("sha256:")) as `sha256:${string}`,
      ),
      gpuAllowlist: ["NVIDIA GeForce RTX 4090"],
      seenNonces,
    };
    const receipt = verifyV213WorkerReceipt(
      input.signer,
      observed.receiptDelivery,
      expectation,
    ).receipt;
    const workerId = receipt.worker_id;
    const authorities = request.generated_output_authorities;
    if (
      receipt.lane !== "soulx_avatar" ||
      typeof workerId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(workerId) ||
      receipt.signature.key_id !== input.signer.keyId ||
      seenNonces.has(receipt.receipt_nonce) ||
      receipt.items.length !== 4 ||
      !Array.isArray(authorities) ||
      authorities.length !== 4 ||
      receipt.runtime_probe.total_vram_bytes < V213_GPU_VRAM_MIN_BYTES ||
      receipt.runtime_probe.total_vram_bytes > V213_GPU_VRAM_MAX_BYTES ||
      receipt.runtime_probe.peak_vram_bytes <= 0 ||
      receipt.runtime_probe.peak_vram_bytes > receipt.runtime_probe.total_vram_bytes
    )
      throw new Error("V208_RECEIPT_CONTRACT_INVALID");
    for (const [index, seconds] of SECONDS.entries()) {
      const item = receipt.items[index]!;
      const authorityPath = (authorities[index] as Record<string, JsonValue>).path;
      if (
        item.item_id !== `soulx-${seconds}s` ||
        item.state !== "SUCCEEDED" ||
        typeof item.output_object_key !== "string" ||
        authorityPath !== `/${item.output_object_key}` ||
        typeof item.output_sha256 !== "string" ||
        !SHA256.test(item.output_sha256) ||
        item.probe.native_clip_reused_for_full_and_split !== true ||
        item.probe.runtime_cache_hit !== !descriptor.cold ||
        item.probe.format !== "mp4" ||
        item.probe.width !== 512 ||
        item.probe.height !== 512 ||
        item.probe.fps_num !== 25 ||
        item.probe.fps_den !== 1 ||
        typeof item.probe.duration_ms !== "number" ||
        Math.abs(item.probe.duration_ms - seconds * 1_000) > 80
      )
        throw new Error("V208_RECEIPT_ITEM_INVALID");
      const bytes = await input.readOutput(item.output_object_key);
      const probe = await input.probeMp4(bytes);
      if (
        bytes.byteLength !== item.output_bytes ||
        hashBytes(bytes) !== item.output_sha256 ||
        probe.format !== "mp4" ||
        probe.width !== 512 ||
        probe.height !== 512 ||
        probe.fpsNum !== 25 ||
        probe.fpsDen !== 1 ||
        probe.videoStreams !== 1 ||
        probe.audioStreams !== 1 ||
        probe.videoCodec !== "h264" ||
        probe.audioCodec !== "aac" ||
        probe.audioSampleRate !== 16_000 ||
        probe.audioChannels !== 1 ||
        probe.videoFrames !== seconds * 25 ||
        Math.abs(probe.videoDurationMs - seconds * 1_000) > 80 ||
        Math.abs(probe.audioDurationMs - seconds * 1_000) > 80 ||
        Math.abs(probe.videoDurationMs - probe.audioDurationMs) > 80 ||
        Math.abs(probe.durationMs - seconds * 1_000) > 80
      )
        throw new Error("V208_OUTPUT_READBACK_INVALID");
    }
    const modelReadyMs = receipt.timings.container_ready_ms;
    if (typeof modelReadyMs !== "number" || !Number.isSafeInteger(modelReadyMs) || modelReadyMs < 0)
      throw new Error("V208_MODEL_READY_TIMING_INVALID");
    seenNonces.add(receipt.receipt_nonce);
    return {
      workerReceiptVerified: true,
      outputItemsVerified: 4,
      nativeFullSplitReadbackVerified: true,
      exactAudioVideoProbeVerified: true,
      coldModelReadyMs: modelReadyMs,
      workerId,
    };
  };
}
