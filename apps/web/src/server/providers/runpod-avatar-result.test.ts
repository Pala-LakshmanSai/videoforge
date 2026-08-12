import { describe, expect, it } from "vitest";

import { safeAvatarFailureEvidence, safeAvatarSuccessEvidence } from "./runpod-avatar-result";

describe("safeAvatarFailureEvidence", () => {
  it("retains only a stable code and diagnostic digest", () => {
    expect(
      safeAvatarFailureEvidence({
        ok: false,
        error_code: "AVATAR_INFERENCE_CUDA_OOM",
        diagnostic_sha256: `sha256:${"a".repeat(64)}`,
        raw_stderr: "must not cross the boundary",
      }),
    ).toEqual({
      error_code: "AVATAR_INFERENCE_CUDA_OOM",
      diagnostic_sha256: `sha256:${"a".repeat(64)}`,
    });
  });

  it("rejects malformed or unrestricted failure envelopes", () => {
    expect(
      safeAvatarFailureEvidence({
        ok: false,
        error_code: "raw traceback",
        diagnostic_sha256: "not-a-digest",
      }),
    ).toBeNull();
  });
});

describe("safeAvatarSuccessEvidence", () => {
  const valid = {
    schema_version: "videoforge.avatar-primary-result/v1",
    attempt_id: "vf9_24_sample",
    output_sha256: `sha256:${"a".repeat(64)}`,
    bytes: 8_000_000,
    duration_ms: 10_120,
    fps: 25,
    width: 832,
    height: 480,
    source_revision: "7e89489ca51c0d008fc1963ec6c03fc5bd0b9397",
    weights_revision: "311e176905a8c4c24b240b530488fe636ce4d249",
    base_revision: "fc913c34361f4ec879e2f9c78b4f11ae50a937d1",
    audio_encoder_revision: "3991242c806928916fff4a8c0e4f76acf661b743",
    upstream_config_sha256: `sha256:${"b".repeat(64)}`,
    inference_config_sha256: `sha256:${"c".repeat(64)}`,
    source_input_sha256: `sha256:${"d".repeat(64)}`,
    audio_input_sha256: `sha256:${"e".repeat(64)}`,
    gpu_name: "NVIDIA GeForce RTX 4090",
    gpu_vram_total_mb: 24564,
    peak_vram_mb: 23000,
    runtime_stages_ms: { model_load_and_inference_encode: 120_000 },
    bootstrap: { cache_hit: false, bootstrap_ms: 60_000 },
    output_base64: "private bytes omitted",
  };

  it("pins lineage, runtime, output, GPU, and bounded cost", () => {
    const result = safeAvatarSuccessEvidence(valid, 0.12);
    expect(result?.measured_spend_usd).toBe(0.12);
    expect(result).not.toHaveProperty("output_base64");
  });

  it("rejects revision, GPU, output, and cap drift", () => {
    expect(safeAvatarSuccessEvidence({ ...valid, source_revision: "main" }, 0.12)).toBeNull();
    expect(safeAvatarSuccessEvidence({ ...valid, gpu_name: "NVIDIA A100" }, 0.12)).toBeNull();
    expect(safeAvatarSuccessEvidence({ ...valid, bytes: 70 * 1024 * 1024 }, 0.12)).toBeNull();
    expect(safeAvatarSuccessEvidence(valid, 0.51)).toBeNull();
  });
});
