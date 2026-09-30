import type { HostedRuntimeEnvironment } from "./configuration";

// R2 documents 5 GiB with a 5 MiB safety subtraction in the upload-limit footnote.
export const SINGLE_PUT_MAX_BYTES = 5 * 1024 ** 3 - 5 * 1024 ** 2;
export const MULTIPART_PART_BYTES = 64 * 1024 ** 2;
export const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export interface CloudMediaConfiguration {
  readonly enabled: true;
  readonly image: string;
  readonly registryId?: string;
  readonly imageDigest: string;
  readonly sourceSha256: string;
  readonly executionBundleSha256: string;
  readonly runtimeSha256: string;
  readonly tooling: Readonly<Record<string, string>>;
  readonly apiKey: string;
  readonly budgetAuthorityId: string;
  readonly maxHourlyUsd: number;
  readonly budgetUsd: number;
  readonly maxRentalSeconds: number;
  readonly spanBatchProtocol?: 1 | 2;
}

/** Absent configuration preserves every desktop path. Enabling requires a qualified Linux release. */
export function cloudMediaConfiguration(env: HostedRuntimeEnvironment): CloudMediaConfiguration | undefined {
  if (env.VIDEOFORGE_CLOUD_MEDIA_ENABLED !== "true") return undefined;
  const image = env.VIDEOFORGE_CLOUD_MEDIA_IMAGE ?? "";
  const sourceSha256 = env.VIDEOFORGE_CLOUD_MEDIA_SOURCE_SHA256 ?? "";
  const apiKey = env.RUNPOD_API_KEY?.trim() ?? "";
  const registryId=env.VIDEOFORGE_CLOUD_MEDIA_REGISTRY_ID;
  const budgetAuthorityId = env.VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID ?? "";
  const maxHourlyUsd = Number(env.VIDEOFORGE_CLOUD_MEDIA_MAX_HOURLY_USD);
  const budgetUsd = Number(env.VIDEOFORGE_CLOUD_MEDIA_BUDGET_USD);
  const maxRentalSeconds = Number(env.VIDEOFORGE_CLOUD_MEDIA_MAX_RENTAL_SECONDS);
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(env.VIDEOFORGE_CLOUD_MEDIA_RUNTIME_MANIFEST_JSON ?? ""); }
  catch { throw new Error("CLOUD_MEDIA_RUNTIME_UNQUALIFIED"); }
  const tooling = manifest.tooling as Record<string, string> | undefined;
  if (!/^[a-z0-9./:_-]+@sha256:[0-9a-f]{64}$/u.test(image) || !SHA256.test(sourceSha256) || !apiKey ||
    (registryId !== undefined && !/^[A-Za-z0-9_-]{1,80}$/u.test(registryId)) ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(budgetAuthorityId) ||
    manifest.schema_version !== "videoforge-runpod-media-release/v1" || manifest.qualified !== true ||
    manifest.source_sha256 !== sourceSha256 || !SHA256.test(String(manifest.runtime_sha256)) ||
    manifest.platform !== "linux/amd64" || !tooling ||
    (manifest.span_batch_protocol !== undefined && ![1,2].includes(manifest.span_batch_protocol as number)) ||
    !["ffmpeg_sha256", "ffprobe_sha256", "whisper_sha256", "whisper_model_sha256"].every(k => SHA256.test(tooling[k] ?? "")) ||
    tooling.ffmpeg_version !== "8.1.2" || tooling.ffprobe_version !== "8.1.2" || tooling.whisper_version !== "1.8.4" ||
    ![maxHourlyUsd, budgetUsd].every(n => Number.isFinite(n) && n > 0) ||
    !Number.isSafeInteger(maxRentalSeconds) || maxRentalSeconds < 60 || maxRentalSeconds > 14_400) {
    throw new Error("CLOUD_MEDIA_RUNTIME_UNQUALIFIED");
  }
  return Object.freeze({enabled: true, image, registryId, imageDigest: image.split("@")[1]!, sourceSha256,
    executionBundleSha256: sourceSha256, runtimeSha256: String(manifest.runtime_sha256),
    tooling: Object.freeze({...tooling}), apiKey, budgetAuthorityId, maxHourlyUsd, budgetUsd, maxRentalSeconds,
    spanBatchProtocol: manifest.span_batch_protocol === 2 ? 2 : 1});
}
