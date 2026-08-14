import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  acceptMageResult,
  MAGE_GPU,
  MAGE_IMAGE_REPOSITORY,
  MAGE_GPU_CHOICES,
  MAGE_MODEL_REVISION,
  MAGE_SOURCE_REVISION,
  safeMageFailureCode,
  type MageResultAuthority,
} from "./runpod-mage-result";

const hash = (value: Buffer | string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const crc32 = (value: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (kind: string, payload: Buffer): Buffer => {
  const name = Buffer.from(kind, "ascii");
  const output = Buffer.alloc(payload.length + 12);
  output.writeUInt32BE(payload.length, 0);
  name.copy(output, 4);
  payload.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, payload])), payload.length + 8);
  return output;
};

const png = (): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1280, 0);
  ihdr.writeUInt32BE(720, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1280 * 3 + 1, 32);
  row[0] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: 720 }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const authority: MageResultAuthority = {
  attemptId: "attempt_001",
  sceneId: "scene_001",
  promptSha256: `sha256:${"a".repeat(64)}`,
  negativePromptSha256: `sha256:${"b".repeat(64)}`,
  seed: 1234,
  width: 1280,
  height: 720,
  image: `${MAGE_IMAGE_REPOSITORY}@sha256:${"f".repeat(64)}`,
  modelRevision: MAGE_MODEL_REVISION,
  sourceRevision: MAGE_SOURCE_REVISION,
  gpu: MAGE_GPU,
  podIdHash: `sha256:${"c".repeat(64)}`,
  volumeIdHash: `sha256:${"d".repeat(64)}`,
  volumeManifestSha256: `sha256:${"e".repeat(64)}`,
  maximumCostUsd: 0.1,
};

const validEnvelope = (): Record<string, unknown> => {
  const output = png();
  return {
    ok: true,
    result: {
      schema_version: "videoforge.mage-image-result/v1",
      attempt_id: authority.attemptId,
      scene_id: authority.sceneId,
      output_sha256: hash(output),
      bytes: output.length,
      width: 1280,
      height: 720,
      seed: authority.seed,
      positive_prompt_sha256: authority.promptSha256,
      negative_prompt_sha256: authority.negativePromptSha256,
      source_revision: MAGE_SOURCE_REVISION,
      model_revision: MAGE_MODEL_REVISION,
      renderer_source_profile: "mage-landscape-native-1280x720-v1",
      generation_duration_ms: 23_728,
      output_base64: output.toString("base64"),
      runtime_evidence: {
        schema_version: "videoforge.mage-runtime-evidence/v2",
        pod_id_hash: authority.podIdHash,
        volume_id_hash: authority.volumeIdHash,
        worker_image_digest: authority.image,
        model_revision: MAGE_MODEL_REVISION,
        comfyui_revision: MAGE_SOURCE_REVISION,
        precision: "int8-convrot",
        bootstrap: {
          schema_version: "videoforge.mage-bootstrap/v2",
          manifest_sha256: authority.volumeManifestSha256,
          model_revision: MAGE_MODEL_REVISION,
          comfyui_revision: MAGE_SOURCE_REVISION,
          precision: "int8-convrot",
          downloaded_model_bytes: 0,
          registry_access_allowed: false,
          started_unix_ms: 800_000,
          completed_unix_ms: 900_190,
          duration_ms: 100_190,
        },
        gpu: {
          available: true,
          approved: true,
          device_count: 1,
          name: MAGE_GPU,
          offering_id: MAGE_GPU,
          total_memory_bytes: 25_386_352_640,
          memory_allocated_bytes: 12_000_000_000,
          memory_reserved_bytes: 14_000_000_000,
          peak_memory_allocated_bytes: 18_000_000_000,
          peak_memory_reserved_bytes: 20_000_000_000,
          cuda_version: "13.0",
          torch_version: "2.11.0+cu130",
        },
      },
    },
  };
};

describe("Mage candidate result acceptance", () => {
  it("returns canonical evidence separately from validated PNG bytes", () => {
    const accepted = acceptMageResult(validEnvelope(), authority, 0.0280524074);
    expect(accepted.output.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(accepted.evidence).not.toHaveProperty("output_base64");
    expect(accepted.evidence).toMatchObject({
      attempt_id: "attempt_001",
      model_revision: MAGE_MODEL_REVISION,
      reported_cost_usd: 0.0280524074,
    });
  });

  it("accepts either exact preflight GPU when runtime evidence matches authority", () => {
    const selectedGpu = MAGE_GPU_CHOICES[0];
    const value = validEnvelope();
    const gpu = (
      (value.result as Record<string, unknown>).runtime_evidence as Record<string, unknown>
    ).gpu as Record<string, unknown>;
    gpu.name = selectedGpu;
    gpu.offering_id = selectedGpu;
    const accepted = acceptMageResult(value, { ...authority, gpu: selectedGpu }, 0.02);
    expect(
      (accepted.evidence.runtime_evidence as { gpu: { offering_id: string } }).gpu,
    ).toMatchObject({ offering_id: selectedGpu });
  });

  it("rejects lineage, hash, PNG profile, GPU, timing, and cost drift", () => {
    const cases: [string, (value: Record<string, unknown>) => void][] = [
      ["lineage", (value) => ((value.result as Record<string, unknown>).scene_id = "other")],
      ["hash", (value) => ((value.result as Record<string, unknown>).output_sha256 = hash("bad"))],
      [
        "gpu",
        (value) =>
          ((
            ((value.result as Record<string, unknown>).runtime_evidence as Record<string, unknown>)
              .gpu as Record<string, unknown>
          ).name = "NVIDIA A100 80GB PCIe"),
      ],
      [
        "timing",
        (value) =>
          ((
            ((value.result as Record<string, unknown>).runtime_evidence as Record<string, unknown>)
              .bootstrap as Record<string, unknown>
          ).duration_ms = 1),
      ],
    ];
    for (const [name, mutate] of cases) {
      const value = validEnvelope();
      mutate(value);
      expect(() => acceptMageResult(value, authority, 0.02), name).toThrow(/^MAGE_/u);
    }
    expect(() => acceptMageResult(validEnvelope(), authority, 0.11)).toThrow(
      "MAGE_AUTHORITY_INVALID",
    );
    expect(() =>
      acceptMageResult(
        validEnvelope(),
        { ...authority, image: "unpublished:videoforge-mage-cp06-int8" },
        0.02,
      ),
    ).toThrow("MAGE_AUTHORITY_INVALID");
  });

  it("rejects unknown envelope/result fields and noncanonical base64", () => {
    const envelope = validEnvelope();
    envelope.secret = "must not pass";
    expect(() => acceptMageResult(envelope, authority, 0.02)).toThrow(
      "MAGE_RESULT_ENVELOPE_INVALID",
    );
    const value = validEnvelope();
    (value.result as Record<string, unknown>).output_base64 += "=";
    expect(() => acceptMageResult(value, authority, 0.02)).toThrow("MAGE_OUTPUT_BASE64_INVALID");
  });

  it("retains only bounded Mage failure codes", () => {
    expect(
      safeMageFailureCode({ ok: false, error_code: "MAGE_INFERENCE_TIMEOUT", trace: "x" }),
    ).toBe("MAGE_INFERENCE_TIMEOUT");
    expect(safeMageFailureCode({ ok: false, error_code: "private traceback" })).toBeNull();
  });
});
