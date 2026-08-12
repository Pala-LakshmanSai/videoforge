const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const errorCodePattern = /^AVATAR_[A-Z0-9_]{1,96}$/u;

export interface SafeAvatarFailureEvidence {
  readonly error_code: string;
  readonly diagnostic_sha256: string;
}

export interface SafeAvatarSuccessEvidence {
  readonly schema_version: "videoforge.avatar-primary-result/v1";
  readonly attempt_id: string;
  readonly output_sha256: string;
  readonly bytes: number;
  readonly duration_ms: number;
  readonly fps: 25;
  readonly width: number;
  readonly height: number;
  readonly source_revision: string;
  readonly weights_revision: string;
  readonly base_revision: string;
  readonly audio_encoder_revision: string;
  readonly upstream_config_sha256: string;
  readonly inference_config_sha256: string;
  readonly source_input_sha256: string;
  readonly audio_input_sha256: string;
  readonly gpu_name: string;
  readonly gpu_vram_total_mb: number;
  readonly peak_vram_mb: number;
  readonly runtime_stages_ms: Readonly<Record<string, number>>;
  readonly bootstrap: Readonly<Record<string, unknown>>;
  readonly measured_spend_usd: number;
}

const revisions = Object.freeze({
  source_revision: "7e89489ca51c0d008fc1963ec6c03fc5bd0b9397",
  weights_revision: "311e176905a8c4c24b240b530488fe636ce4d249",
  base_revision: "fc913c34361f4ec879e2f9c78b4f11ae50a937d1",
  audio_encoder_revision: "3991242c806928916fff4a8c0e4f76acf661b743",
});

const finiteRecord = (value: unknown): value is Readonly<Record<string, number>> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every(
    (item) => typeof item === "number" && Number.isFinite(item) && item >= 0,
  );

export const safeAvatarSuccessEvidence = (
  value: unknown,
  measuredSpendUsd: number,
): SafeAvatarSuccessEvidence | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const bootstrap = result.bootstrap;
  if (
    result.schema_version !== "videoforge.avatar-primary-result/v1" ||
    typeof result.attempt_id !== "string" ||
    result.attempt_id.length < 1 ||
    typeof result.output_sha256 !== "string" ||
    !digestPattern.test(result.output_sha256) ||
    !Number.isSafeInteger(result.bytes) ||
    Number(result.bytes) < 1 ||
    Number(result.bytes) > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(result.duration_ms) ||
    Number(result.duration_ms) < 160 ||
    Number(result.duration_ms) > 10_200 ||
    result.fps !== 25 ||
    !Number.isSafeInteger(result.width) ||
    !Number.isSafeInteger(result.height) ||
    Number(result.width) < 256 ||
    Number(result.height) < 256 ||
    Object.entries(revisions).some(([key, revision]) => result[key] !== revision) ||
    typeof result.upstream_config_sha256 !== "string" ||
    !digestPattern.test(result.upstream_config_sha256) ||
    typeof result.inference_config_sha256 !== "string" ||
    !digestPattern.test(result.inference_config_sha256) ||
    typeof result.source_input_sha256 !== "string" ||
    !digestPattern.test(result.source_input_sha256) ||
    typeof result.audio_input_sha256 !== "string" ||
    !digestPattern.test(result.audio_input_sha256) ||
    typeof result.gpu_name !== "string" ||
    !result.gpu_name.includes("4090") ||
    !Number.isSafeInteger(result.gpu_vram_total_mb) ||
    Number(result.gpu_vram_total_mb) < 24_000 ||
    !Number.isSafeInteger(result.peak_vram_mb) ||
    Number(result.peak_vram_mb) < 0 ||
    !finiteRecord(result.runtime_stages_ms) ||
    !bootstrap ||
    typeof bootstrap !== "object" ||
    Array.isArray(bootstrap) ||
    typeof measuredSpendUsd !== "number" ||
    !Number.isFinite(measuredSpendUsd) ||
    measuredSpendUsd < 0 ||
    measuredSpendUsd > 0.5
  ) {
    return null;
  }
  const safe = { ...result };
  delete safe.output_base64;
  return Object.freeze({
    ...(safe as Omit<SafeAvatarSuccessEvidence, "measured_spend_usd">),
    measured_spend_usd: measuredSpendUsd,
  });
};

export const safeAvatarFailureEvidence = (value: unknown): SafeAvatarFailureEvidence | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.ok !== false ||
    typeof envelope.error_code !== "string" ||
    !errorCodePattern.test(envelope.error_code) ||
    typeof envelope.diagnostic_sha256 !== "string" ||
    !digestPattern.test(envelope.diagnostic_sha256)
  ) {
    return null;
  }
  return Object.freeze({
    error_code: envelope.error_code,
    diagnostic_sha256: envelope.diagnostic_sha256,
  });
};
