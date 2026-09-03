import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import {
  LOCKED_MAGE_GPU,
  LOCKED_MAGE_GPU_CHOICES,
  LOCKED_MAGE_IMAGE,
  LOCKED_MAGE_MODEL_REVISION,
  LOCKED_MAGE_SOURCE_REVISION,
  type ImageExecutionAuthority,
} from "@videoforge/control-plane";
import { compileImagePrompt } from "@videoforge/pipeline";
import { describe, expect, it } from "vitest";

import { composeDurableMageResult } from "./runpod-mage-durable";
import type { MageResultAuthority } from "./runpod-mage-result";

const hash = (value: Buffer | string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const compiled = compileImagePrompt({
  writerOutput: {
    scene_id: "scene_001",
    literal_subject: "families loading groceries into cars",
    action: "placing grocery bags in open trunks",
    environment: "blank warehouse supermarket parking lot at night",
    in_image_shot_role: "ENVIRONMENTAL_WIDE",
    lighting_context: "natural parking-lot lighting",
    continuity_tags: [],
    prompt_core:
      "Families place grocery bags into open car trunks in a warehouse supermarket parking lot at night.",
  },
  expectedScene: {
    sceneId: "scene_001",
    phrase: "Families loaded groceries.",
    sentenceContext: "Families loaded groceries.",
    priorContext: null,
    nextContext: null,
    inImageShotRole: "ENVIRONMENTAL_WIDE",
    layout: "IMAGE_FULL",
  },
  style: {
    positiveSuffix: "authentic photojournalism",
    negativeSuffix: "visible text, logo, duplicate people, malformed anatomy",
    fullImageGuidance: "16:9 center-safe evidence",
    splitImageGuidance: "8:9 evidence centered in the right-hand panel",
  },
  extraPromptKeywords: null,
  applyExtraPromptKeywords: false,
});

const ids = {
  workspace: "00000000-0000-5000-8000-000000000001",
  user: "00000000-0000-5000-8000-000000000002",
  project: "00000000-0000-5000-8000-000000000003",
  revision: "00000000-0000-5000-8000-000000000004",
  timeline: "00000000-0000-5000-8000-000000000005",
  style: "00000000-0000-5000-8000-000000000006",
  styleVersion: "00000000-0000-5000-8000-000000000007",
  prompt: "00000000-0000-5000-8000-000000000008",
  promptScene: "00000000-0000-5000-8000-000000000009",
  task: "00000000-0000-5000-8000-000000000010",
  attempt: "00000000-0000-5000-8000-000000000011",
  outbox: "00000000-0000-5000-8000-000000000012",
  callback: "00000000-0000-5000-8000-000000000013",
} as const;

const durableAuthority: ImageExecutionAuthority = {
  workspaceId: ids.workspace,
  projectId: ids.project,
  revisionId: ids.revision,
  revisionState: "GENERATING",
  timelineId: ids.timeline,
  timelineHash: hash("timeline"),
  timelineState: "CURRENT",
  imageStyleId: ids.style,
  imageStyleVersionId: ids.styleVersion,
  styleProfileArtifactId: null,
  styleProfileHash: hash("style"),
  styleState: "PUBLISHED",
  promptExecutionId: ids.prompt,
  promptSceneResultId: ids.promptScene,
  sceneId: "scene_001",
  layout: "IMAGE_FULL",
  compiledPrompt: compiled,
  taskId: ids.task,
  taskState: "RUNNING",
  attemptId: ids.attempt,
  attemptOrdinal: 1,
  attemptState: "CLAIMED",
  claimTokenHash: hash("claim"),
  recordedInputHash: hash("input"),
  outboxId: ids.outbox,
  outboxState: "ACKNOWLEDGED",
  callbackReceiptId: ids.callback,
  callbackPayloadHash: hash("pending"),
  callbackKind: "mage_image_result",
  callbackState: "RECEIVED",
  reservedCostMicroUsd: 50_000,
  accepted: null,
};

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
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1280, 0);
  header.writeUInt32BE(720, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1280 * 3 + 1, 91);
  row[0] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: 720 }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const media = png();
const providerAuthority: MageResultAuthority = {
  attemptId: ids.attempt,
  sceneId: "scene_001",
  promptSha256: compiled.positivePromptSha256,
  negativePromptSha256: compiled.negativePromptSha256,
  seed: 20260812,
  width: 1280,
  height: 720,
  image: LOCKED_MAGE_IMAGE,
  modelRevision: LOCKED_MAGE_MODEL_REVISION,
  sourceRevision: LOCKED_MAGE_SOURCE_REVISION,
  gpu: LOCKED_MAGE_GPU,
  podIdHash: `sha256:${"c".repeat(64)}`,
  volumeIdHash: `sha256:${"d".repeat(64)}`,
  volumeManifestSha256: `sha256:${"e".repeat(64)}`,
  maximumCostUsd: 0.05,
};

const envelope = (): Record<string, unknown> => ({
  ok: true,
  result: {
    schema_version: "videoforge.mage-image-result/v1",
    attempt_id: ids.attempt,
    scene_id: "scene_001",
    output_sha256: hash(media),
    bytes: media.length,
    width: 1280,
    height: 720,
    seed: 20260812,
    positive_prompt_sha256: compiled.positivePromptSha256,
    negative_prompt_sha256: compiled.negativePromptSha256,
    source_revision: LOCKED_MAGE_SOURCE_REVISION,
    model_revision: LOCKED_MAGE_MODEL_REVISION,
    renderer_source_profile: "mage-landscape-native-1280x720-v1",
    generation_duration_ms: 4_756,
    output_base64: media.toString("base64"),
    runtime_evidence: {
      schema_version: "videoforge.mage-runtime-evidence/v3",
      pod_id_hash: providerAuthority.podIdHash,
      volume_id_hash: providerAuthority.volumeIdHash,
      worker_image_digest: LOCKED_MAGE_IMAGE,
      model_revision: LOCKED_MAGE_MODEL_REVISION,
      comfyui_revision: LOCKED_MAGE_SOURCE_REVISION,
      precision: "int8-convrot",
      bootstrap: {
        schema_version: "videoforge.mage-bootstrap/v2",
        manifest_sha256: providerAuthority.volumeManifestSha256,
        model_revision: LOCKED_MAGE_MODEL_REVISION,
        comfyui_revision: LOCKED_MAGE_SOURCE_REVISION,
        precision: "int8-convrot",
        downloaded_model_bytes: 0,
        registry_access_allowed: false,
        started_unix_ms: 900_000,
        completed_unix_ms: 950_000,
        duration_ms: 50_000,
      },
      gpu: {
        available: true,
        approved: true,
        device_count: 1,
        name: LOCKED_MAGE_GPU,
        offering_id: LOCKED_MAGE_GPU,
        total_memory_bytes: 25_386_352_640,
        memory_allocated_bytes: 12_000_000_000,
        memory_reserved_bytes: 14_000_000_000,
        peak_memory_allocated_bytes: 18_000_000_000,
        peak_memory_reserved_bytes: 20_000_000_000,
        ready_vram_used_bytes: 18_500_000_000,
        peak_vram_used_bytes: 21_000_000_000,
        cuda_version: "13.0",
        torch_version: "2.11.0+cu130",
      },
    },
  },
});

const objectKey = `workspace/${ids.workspace}/project/${ids.project}/revision/${ids.revision}/images/${ids.attempt}.png`;
const review = {
  state: "PASSED" as const,
  reviewerUserId: ids.user,
  reviewedAt: "2026-08-12T08:00:00.000Z",
  findings: ["No visible prohibited output."],
};

describe("durable Mage composition", () => {
  it("converts only exact validated provider bytes into truthful durable lineage", () => {
    const observed = composeDurableMageResult(
      envelope(),
      providerAuthority,
      durableAuthority,
      0.0308072963,
      objectKey,
      review,
    );
    expect(observed.media).toEqual(media);
    expect(observed.result).toMatchObject({
      schemaVersion: "videoforge.mage-durable-image-result/v1",
      reportedCostMicroUsd: 30_808,
      positivePromptHash: compiled.positivePromptSha256,
      negativePromptHash: compiled.negativePromptSha256,
      providerModel: { image: LOCKED_MAGE_IMAGE, gpu: LOCKED_MAGE_GPU },
      qualityReview: review,
    });
  });

  it("persists the exact alternate preflight GPU selected by provider authority", () => {
    const selectedGpu = LOCKED_MAGE_GPU_CHOICES[0];
    const selectedEnvelope = envelope();
    const gpu = (
      (selectedEnvelope.result as Record<string, unknown>).runtime_evidence as Record<
        string,
        unknown
      >
    ).gpu as Record<string, unknown>;
    gpu.name = selectedGpu;
    gpu.offering_id = selectedGpu;
    const observed = composeDurableMageResult(
      selectedEnvelope,
      { ...providerAuthority, gpu: selectedGpu },
      durableAuthority,
      0.03,
      objectKey,
      review,
    );
    expect(observed.result.providerModel.gpu).toBe(selectedGpu);
  });

  it("rejects authority drift, provider-byte drift, and failed visual review before persistence", () => {
    expect(() =>
      composeDurableMageResult(
        envelope(),
        { ...providerAuthority, sceneId: "scene_other" },
        durableAuthority,
        0.01,
        objectKey,
        review,
      ),
    ).toThrow("MAGE_DURABLE_AUTHORITY_MISMATCH");
    const drifted = envelope();
    (drifted.result as Record<string, unknown>).output_sha256 = hash("wrong");
    expect(() =>
      composeDurableMageResult(
        drifted,
        providerAuthority,
        durableAuthority,
        0.01,
        objectKey,
        review,
      ),
    ).toThrow("MAGE_OUTPUT_HASH_INVALID");
    expect(() =>
      composeDurableMageResult(envelope(), providerAuthority, durableAuthority, 0.01, objectKey, {
        ...review,
        state: "REJECTED",
      } as never),
    ).toThrow("Mage visual review is absent or invalid");
  });
});
