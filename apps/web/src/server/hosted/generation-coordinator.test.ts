import { validateAndHashContractDocument } from "@videoforge/contracts";
import { describe, expect, it, vi } from "vitest";

import revisionFixture from "../../../../../packages/contracts/generated/fixtures/project_revision_config.valid.json";
import asrInputFixture from "../../../../../packages/contracts/generated/fixtures/asr_job_input.valid.json";
import asrResultFixture from "../../../../../packages/contracts/generated/fixtures/asr_job_result.valid.json";
import { sha256Bytes } from "./crypto";
import {
  coordinateHostedGeneration,
  HostedGenerationCoordinationError,
  type HostedGenerationPersistence,
} from "./generation-coordinator";
import { hostedGpuReadiness } from "./gpu-readiness";

// Account/workspace/user IDs are persisted PostgreSQL UUID values and may be deterministic rather
// than RFC-versioned. Other generated lineage IDs remain strict RFC UUIDs.
const ACCOUNT = "11111111-1111-a111-7111-111111111111";
const WORKSPACE = "22222222-2222-b222-1222-222222222222";
const USER = "33333333-3333-e333-6333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const REVISION = "55555555-5555-4555-8555-555555555555";
const ATTEMPT = "66666666-6666-4666-8666-666666666666";
const VOICEOVER = "77777777-7777-4777-8777-777777777777";
const MODEL = `sha256:${"b".repeat(64)}`;
const PHRASES = [
  [0, 4_500, "A ripe watermelon gives several small clues before it is opened."],
  [4_500, 8_000, "Begin by looking for a creamy yellow field spot."],
  [8_000, 12_000, "The fruit rested on the ground before harvest."],
  [12_000, 16_000, "Compare the weight with another melon of similar size."],
  [16_000, 20_500, "The heavier one usually holds more water."],
  [20_500, 24_000, "Run your fingers across the firm rind."],
  [24_000, 28_000, "Choose a surface that feels firm rather than soft."],
  [28_000, 32_000, "Inspect the stem and listen for a deep sound."],
  [32_000, 36_000, "Tap the center with a steady hand."],
  [36_000, 40_000, "Use all these checks together for the best result."],
] as const;

function transcriptValue() {
  const words: {
    index: number;
    text: string;
    start_ms: number;
    end_ms: number;
    confidence: number;
  }[] = [];
  const phrases = PHRASES.map(([start, end, text], phraseIndex) => {
    const tokens = text.split(/\s+/u);
    const wordStart = words.length;
    tokens.forEach((token, tokenIndex) =>
      words.push({
        index: words.length,
        text: token,
        start_ms: start + Math.floor(((end - start) * tokenIndex) / tokens.length),
        end_ms: start + Math.floor(((end - start) * (tokenIndex + 1)) / tokens.length),
        confidence: 1,
      }),
    );
    return {
      phrase_id: `phrase_${phraseIndex}`,
      sentence_id: `sentence_${Math.floor(phraseIndex / 2)}`,
      word_start: wordStart,
      word_end_exclusive: words.length,
      start_ms: start,
      end_ms: end,
      pause_before_ms: 0,
      pause_after_ms: 0,
      text,
    };
  });
  return {
    schema_version: "transcript-timing/v1" as const,
    project_revision_id: REVISION,
    source: { asset_id: VOICEOVER, sha256: `sha256:${"a".repeat(64)}`, duration_ms: 40_000 },
    engine: {
      name: "whisper.cpp",
      version: "1.8.4",
      model_name: "base.en",
      model_sha256: MODEL,
      language: "en",
    },
    text: PHRASES.map(([, , text]) => text).join(" "),
    words,
    phrases,
  };
}

async function setup() {
  const revision = structuredClone(revisionFixture);
  revision.project_id = PROJECT;
  revision.project_revision_id = REVISION;
  revision.voiceover_asset_id = VOICEOVER;
  revision.voiceover_sha256 = `sha256:${"a".repeat(64)}`;
  revision.scheduler_version = "scheduler-v2";
  const revisionRef = await validateAndHashContractDocument("projectRevisionConfig", revision);
  const transcript = transcriptValue();
  const asrInput = structuredClone(asrInputFixture);
  asrInput.project_revision_id = REVISION;
  asrInput.attempt_id = ATTEMPT;
  asrInput.voiceover.asset_id = VOICEOVER;
  asrInput.voiceover.sha256 = revision.voiceover_sha256;
  asrInput.voiceover.duration_ms = 40_000;
  asrInput.model.sha256 = MODEL;
  asrInput.output.result_uri = `vf-local-run://${REVISION}/${ATTEMPT}/asr-result.json`;
  asrInput.cancel_token = ATTEMPT;
  const prefix =
    `tenant/${ACCOUNT}/workspace/${WORKSPACE}/project/${PROJECT}/revision/${REVISION}` +
    `/lane/input/job/${ATTEMPT}/artifact/`;
  const resultDocumentKey = `${prefix}result-document`;
  const jobTemplate = {
    schema_version: "videoforge-personal-worker-job-template/v1",
    attempt_id: ATTEMPT,
    kind: "ASR",
    input_document: asrInput,
    outputs: [
      {
        source: "PRIMARY_RESULT_OUTPUT",
        object_key: `${prefix}primary-result`,
        content_type: "application/json",
        max_bytes: 16 * 1024 ** 2,
      },
    ],
    result: { object_key: resultDocumentKey, max_bytes: 1_048_576 },
    tooling: {
      whisper_model_sha256: MODEL,
      whisper_version: "1.8.4",
      ffmpeg_version: "8.1.2",
      ffprobe_version: "8.1.2",
    },
  };
  const inputBytes = new TextEncoder().encode(JSON.stringify(jobTemplate)).buffer as ArrayBuffer;
  const asrResult = structuredClone(asrResultFixture);
  asrResult.attempt_id = ATTEMPT;
  asrResult.source_voiceover_sha256 = revision.voiceover_sha256;
  asrResult.model_sha256 = MODEL;
  asrResult.transcript = transcript;
  asrResult.diagnostics.source_duration_ms = 40_000;
  const bytes = new TextEncoder().encode(JSON.stringify(asrResult)).buffer as ArrayBuffer;
  const outputSha256 = await sha256Bytes(bytes);
  const persist = vi.fn<HostedGenerationPersistence["persistProviderInertPlan"]>(async () => ({
    replayed: false,
  }));
  const persistence: HostedGenerationPersistence = { persistProviderInertPlan: persist };
  return {
    bytes,
    inputBytes,
    persist,
    persistence,
    snapshot: {
      accountId: ACCOUNT,
      workspaceId: WORKSPACE,
      userId: USER,
      projectId: PROJECT,
      projectRevisionId: REVISION,
      asrAttemptId: ATTEMPT,
      asrState: "SUCCEEDED" as const,
      asrFinishedAt: "2026-08-25T12:00:00.000Z",
      asrInputObjectKey:
        `tenant/${ACCOUNT}/workspace/${WORKSPACE}/project/${PROJECT}/revision/${REVISION}` +
        `/lane/input/job/${ATTEMPT}/artifact/job-spec`,
      asrInputContentLength: inputBytes.byteLength,
      asrInputSha256: await sha256Bytes(inputBytes),
      asrOutputObjectKey: resultDocumentKey,
      asrOutputContentType: "application/json" as const,
      asrOutputContentLength: bytes.byteLength,
      asrOutputSha256: outputSha256,
      expectedWhisperModelSha256: MODEL,
      revisionConfig: revisionRef.value,
      revisionConfigSha256: revisionRef.sha256,
    },
  };
}

describe("hosted generation coordinator", () => {
  it("validates private ASR lineage, plans deterministically, then persists a provider-inert wait", async () => {
    const fixture = await setup();
    const order: string[] = [];
    fixture.persist.mockImplementation(async (value) => {
      order.push("persist");
      expect(value.tasks.length).toBeGreaterThan(0);
      expect(value.tasks.every((task) => task.state === "BLOCKED")).toBe(true);
      expect(value.generationPlan).toMatchObject({
        schema_version: "videoforge-hosted-generation-plan/v1",
        predispatch: "WAITING_FOR_GPU_QUALIFICATION",
      });
      return { replayed: false };
    });
    const result = await coordinateHostedGeneration({
      snapshot: fixture.snapshot,
      asrInputBytes: fixture.inputBytes,
      asrOutputBytes: fixture.bytes,
      persistence: fixture.persistence,
      readGpuReadiness: () => {
        order.push("readiness");
        return hostedGpuReadiness();
      },
    });

    expect(order).toEqual(["readiness", "persist"]);
    expect(result).toMatchObject({
      state: "WAITING_FOR_GPU_QUALIFICATION",
      project_id: PROJECT,
      project_revision_id: REVISION,
      asr_attempt_id: ATTEMPT,
      serverless_attempt_count: 0,
      outbox_count: 0,
      authority_count: 0,
      transport_call_count: 0,
      provider_call_count: 0,
      spend_usd: 0,
      idempotent_replay: false,
    });
    expect(result.missing_lane_gates).toEqual(
      hostedGpuReadiness().lanes.map((lane) => ({ lane: lane.lane, gates: lane.missing_gates })),
    );
  });

  it("replays only through the same provider-inert persistence boundary", async () => {
    const fixture = await setup();
    fixture.persist.mockResolvedValue({ replayed: true });
    await expect(
      coordinateHostedGeneration({
        snapshot: fixture.snapshot,
        asrInputBytes: fixture.inputBytes,
        asrOutputBytes: fixture.bytes,
        persistence: fixture.persistence,
      }),
    ).resolves.toMatchObject({ idempotent_replay: true, serverless_attempt_count: 0 });
  });

  it("rejects a valid transcript presented without its canonical ASR result envelope", async () => {
    const fixture = await setup();
    const bytes = new TextEncoder().encode(JSON.stringify(transcriptValue())).buffer as ArrayBuffer;
    await expect(
      coordinateHostedGeneration({
        snapshot: {
          ...fixture.snapshot,
          asrOutputContentLength: bytes.byteLength,
          asrOutputSha256: await sha256Bytes(bytes),
        },
        asrInputBytes: fixture.inputBytes,
        asrOutputBytes: bytes,
        persistence: fixture.persistence,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_GENERATION_ASR_RESULT_DOCUMENT_INVALID" });
    expect(fixture.persist).not.toHaveBeenCalled();
  });

  it("accepts a JSON-encoded revision document returned by the hosted database driver", async () => {
    const fixture = await setup();
    await expect(
      coordinateHostedGeneration({
        snapshot: {
          ...fixture.snapshot,
          revisionConfig: JSON.stringify(fixture.snapshot.revisionConfig),
        },
        asrInputBytes: fixture.inputBytes,
        asrOutputBytes: fixture.bytes,
        persistence: fixture.persistence,
      }),
    ).resolves.toMatchObject({
      state: "WAITING_FOR_GPU_QUALIFICATION",
      serverless_attempt_count: 0,
      provider_call_count: 0,
      spend_usd: 0,
    });
  });

  it("rejects malformed stored revision JSON before persistence", async () => {
    const fixture = await setup();
    await expect(
      coordinateHostedGeneration({
        snapshot: { ...fixture.snapshot, revisionConfig: "{" },
        asrInputBytes: fixture.inputBytes,
        asrOutputBytes: fixture.bytes,
        persistence: fixture.persistence,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_GENERATION_PROJECT_REVISION_JSON_INVALID" });
    expect(fixture.persist).not.toHaveBeenCalled();
  });

  it("separates a stored revision schema failure from JSON decoding", async () => {
    const fixture = await setup();
    await expect(
      coordinateHostedGeneration({
        snapshot: {
          ...fixture.snapshot,
          revisionConfig: JSON.stringify({ schema_version: "project-revision-config/v1" }),
        },
        asrInputBytes: fixture.inputBytes,
        asrOutputBytes: fixture.bytes,
        persistence: fixture.persistence,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_GENERATION_PROJECT_REVISION_SCHEMA_INVALID" });
    expect(fixture.persist).not.toHaveBeenCalled();
  });

  it("rejects an ASR input document that is not wrapped in the exact stored personal-worker template", async () => {
    const fixture = await setup();
    const wrapper = JSON.parse(new TextDecoder().decode(fixture.inputBytes));
    const bytes = new TextEncoder().encode(JSON.stringify(wrapper.input_document))
      .buffer as ArrayBuffer;
    await expect(
      coordinateHostedGeneration({
        snapshot: {
          ...fixture.snapshot,
          asrInputContentLength: bytes.byteLength,
          asrInputSha256: await sha256Bytes(bytes),
        },
        asrInputBytes: bytes,
        asrOutputBytes: fixture.bytes,
        persistence: fixture.persistence,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_GENERATION_ASR_JOB_TEMPLATE_INVALID" });
    expect(fixture.persist).not.toHaveBeenCalled();
  });

  it("fails closed when canonical persistence is unavailable without inventing dispatch state", async () => {
    const fixture = await setup();
    const persistence: HostedGenerationPersistence = {
      persistProviderInertPlan: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    };
    await expect(
      coordinateHostedGeneration({
        snapshot: fixture.snapshot,
        asrInputBytes: fixture.inputBytes,
        asrOutputBytes: fixture.bytes,
        persistence,
      }),
    ).rejects.toThrow("database unavailable");
  });

  it.each([
    [
      "checksum",
      (fixture: Awaited<ReturnType<typeof setup>>) => ({
        ...fixture.snapshot,
        asrOutputSha256: `sha256:${"0".repeat(64)}`,
      }),
    ],
    [
      "tenant object key",
      (fixture: Awaited<ReturnType<typeof setup>>) => ({
        ...fixture.snapshot,
        asrOutputObjectKey: fixture.snapshot.asrOutputObjectKey.replace(ACCOUNT, USER),
      }),
    ],
    [
      "model",
      (fixture: Awaited<ReturnType<typeof setup>>) => ({
        ...fixture.snapshot,
        expectedWhisperModelSha256: `sha256:${"0".repeat(64)}`,
      }),
    ],
  ])("rejects drifted %s lineage before persistence", async (_label, mutate) => {
    const fixture = await setup();
    await expect(
      coordinateHostedGeneration({
        snapshot: mutate(fixture),
        asrInputBytes: fixture.inputBytes,
        asrOutputBytes: fixture.bytes,
        persistence: fixture.persistence,
      }),
    ).rejects.toBeInstanceOf(HostedGenerationCoordinationError);
    expect(fixture.persist).not.toHaveBeenCalled();
  });
});
