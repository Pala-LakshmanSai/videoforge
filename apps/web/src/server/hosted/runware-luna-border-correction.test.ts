import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalizeJson } from "@videoforge/contracts";
import {
  NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
  derivePromptStyleTreatment,
  promptStyleTreatmentPositiveSuffix,
  planPromptBatches,
  buildRunwarePromptRequest,
  buildRunwarePromptCorrection,
  recoverRunwarePromptCorrection,
  RunwarePromptWriter,
  type RunwarePromptCorrection,
} from "@videoforge/pipeline";
import { expect, it, vi } from "vitest";
import { compileAndPersistHostedPromptBatch } from "./hosted-prompt-run";
import {
  HostedPromptArchivedOutputInvalidError,
  hostedPromptBatchPlanHash,
  recoverClaimedHostedPromptBatch,
} from "./runware-prompt-execution";
import { buildRunwareLunaPromptWireRequest } from "../providers/runware-luna-prompt-transport";
import { buildKieScenePrompt } from "../providers/kie-image-prompt";

const sha = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}` as const;
const profile = JSON.parse(
  readFileSync("../../project-context/evidence/natural_documentary_image_style_v1.json", "utf8"),
);
const styleTreatment = derivePromptStyleTreatment(
  profile.visual_profile,
  NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
);
const sceneId = "scene_004";

async function fixture(preGrammar = false) {
  const scenes = Array.from({ length: 10 }, (_, index) => ({
    sceneId: `scene_${String(index + 1).padStart(3, "0")}`,
    phrase: "Safest places to park money and the government.",
    sentenceContext: "Safest places to park money and the government.",
    priorContext: "Investors see Dutch soil as one of the safest places.",
    nextContext: "The government itself buys land for nature and nitrogen space.",
    inImageShotRole: "HUMAN_MEDIUM" as const,
    layout: "IMAGE_FULL" as const,
  }));
  const plan = planPromptBatches({
    batchIdPrefix: "sealed-geographic-border",
    projectTitle: "Dutch farmland",
    imageStyleVersionId: "10000000-0000-4000-8000-000000000001",
    styleProfileHash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
    styleTreatment,
    plannerGuidance: profile.prompt_profile.planner_guidance,
    storyContext: "Subject: Dutch farmland purchases and land for nature",
    continuityTags: [],
    scenes,
    literalCharacterLimits: Object.fromEntries(scenes.map((scene) => [scene.sceneId, 173])),
    options: { requestPolicy: "runware-luna-grounded-v3", maxOutputTokens: 6144 },
  });
  expect(plan.batchCount).toBe(1);
  const batch = plan.batches[0]!.batch;
  const output = {
    batch_id: batch.batchId,
    scenes: scenes.map((scene) => ({
      scene_id: scene.sceneId,
      in_image_shot_role: scene.inImageShotRole,
      literal_subject: "Cultivated land beside a natural grassland area.",
      action:
        scene.sceneId === sceneId
          ? preGrammar
            ? "A drainage canal borders reclaimed fields."
            : "A field borders a natural grassland area."
          : preGrammar && scene.sceneId === "scene_001"
            ? "A field borders a natural grassland area."
            : "Cultivated land lies beside natural grassland.",
      environment: "Dutch countryside fields.",
      lighting_context: "Natural daylight.",
      continuity_tags: [],
      prompt_core: "A grounded view of farmland meeting uncultivated grassland.",
    })),
  };
  const sourceText = canonicalizeJson(output);
  const sealed: RunwarePromptCorrection = {
    sourceResponseSha256: sha(sourceText),
    sourceOutputText: sourceText,
    failedSceneIds: [sceneId],
    failures: [{ sceneId, field: "action", reason: "hard_conflict" }],
  };
  const original = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, plan.requestPolicy);
  const request = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    2,
    original.requestSha256,
    1,
    plan.requestPolicy,
    "no-text-v2",
    sealed,
  );
  const corrected = {
    ...output.scenes.find((scene) => scene.scene_id === sceneId)!,
    action: preGrammar
      ? "A dyke borders reclaimed land."
      : "A cultivated parcel borders natural land.",
  };
  const result = {
    status: "succeeded" as const,
    outputText: canonicalizeJson({ batch_id: batch.batchId, scenes: [corrected] }),
    latencyMs: 1,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    },
    costUsd: 0.000035,
    estimatedCostMicroUsd: 35,
    costBasis: "PINNED_RATE_ESTIMATE" as const,
    finishReason: "stop",
    providerModel: "openai:gpt@6-luna",
    responseId: "chatcmpl-saved_border",
    wireHash: (await buildRunwareLunaPromptWireRequest(request)).wireHash,
  };
  const binding = {
    plannedBatchCount: plan.batchCount,
    plannedSceneCount: plan.totalScenes,
    batchPlanHash: await hostedPromptBatchPlanHash(plan),
  };
  return { plan, batch, output, sealed, original, request, result, binding };
}

it("replays the sealed historical border correction through writer, receipt recovery and compilation", async () => {
  const f = await fixture();
  expect(
    buildRunwarePromptCorrection(f.batch, f.sealed.sourceOutputText, f.plan.requestPolicy),
  ).toBeNull();
  expect(
    recoverRunwarePromptCorrection(
      f.batch,
      f.sealed.sourceOutputText,
      f.sealed,
      f.plan.requestPolicy,
    ),
  ).toEqual(f.sealed);
  const writer = new RunwarePromptWriter({
    requestPolicy: f.plan.requestPolicy,
    correction: f.sealed,
    contentRepair: "no-text-v2",
    semanticQualityMode: "advisory",
    minimumBatchScenes: 1,
    allowPartialRetry: false,
    maximumBatchCostUsd: 0.25,
    evidenceSink: { record() {} },
    transport: {
      async dispatch(request) {
        expect(request.requestBytes).toBe(f.request.requestBytes);
        return f.result;
      },
    },
  });
  const written = await writer.write(f.batch, f.original.requestSha256);
  expect(written.scenes).toHaveLength(10);
  const noHttp = vi.fn(async () => {
    throw new Error("NETWORK_FORBIDDEN");
  });
  const accepted = await recoverClaimedHostedPromptBatch({
    apiKey: "offline-no-provider-credentials",
    plan: f.plan,
    persistedBinding: f.binding,
    batchOrdinal: 0,
    taskUUID: f.request.request.taskUUID,
    requestBytes: f.request.requestBytes,
    requestHash: f.request.requestSha256,
    retryOfRequestHash: f.original.requestSha256,
    reservationMicroUsd: 500_000,
    recordedResult: f.result,
    sourceRecordedResult: { ...f.result, outputText: f.sealed.sourceOutputText },
    fetcher: noHttp,
  });
  expect(accepted.requestBytes).toBe(f.request.requestBytes);
  expect(accepted.responseBytes).toBe(f.result.outputText);
  for (const scene of accepted.scenes.filter((scene) => scene.scene.sceneId !== sceneId)) {
    expect(scene.writerOutput).toEqual(
      f.output.scenes.find((row) => row.scene_id === scene.scene.sceneId),
    );
  }
  const compiled: unknown[] = [];
  await compileAndPersistHostedPromptBatch(
    {
      scenes: f.batch.scenes,
      styleProfileHash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
      style: {
        positiveSuffix: promptStyleTreatmentPositiveSuffix(styleTreatment),
        negativeSuffix: profile.prompt_profile.negative_suffix,
        fullImageGuidance: profile.prompt_profile.full_image_guidance,
        splitImageGuidance: profile.prompt_profile.split_image_guidance,
      },
      extraPromptKeywords: null,
      applyExtraPromptKeywords: false,
    } as never,
    accepted,
    async (batch) => {
      for (const scene of batch.scenes) {
        expect(
          buildKieScenePrompt(scene.compiledPrompt, { handAnatomy: true }).length,
        ).toBeLessThanOrEqual(800);
        compiled.push(scene);
      }
    },
    "local-evidence-v1",
  );
  expect(compiled).toHaveLength(10);
  expect(noHttp).not.toHaveBeenCalled();
});

it.each(["scene", "field", "reason", "sourceHash", "sourceText"])(
  "rejects tampered historical correction %s before any transport",
  async (change) => {
    const f = await fixture();
    const changed = { ...structuredClone(f.sealed) };
    if (change === "scene") changed.failedSceneIds = ["scene_001"];
    if (change === "field")
      changed.failures = [{ sceneId, field: "literal_subject", reason: "hard_conflict" }];
    if (change === "reason")
      changed.failures = [{ sceneId, field: "action", reason: "required_fact_invalid" }];
    if (change === "sourceHash") changed.sourceResponseSha256 = sha("wrong source");
    if (change === "sourceText") changed.sourceOutputText += " ";
    expect(
      recoverRunwarePromptCorrection(
        f.batch,
        changed.sourceOutputText,
        changed,
        f.plan.requestPolicy,
      ),
    ).toBeNull();
    expect(() =>
      buildRunwarePromptRequest(
        f.batch,
        f.batch.scenes,
        2,
        f.original.requestSha256,
        1,
        f.plan.requestPolicy,
        "no-text-v2",
        changed,
      ),
    ).toThrow();
    const body = JSON.parse(f.request.requestBytes);
    const input = JSON.parse(body[0].messages[0].content);
    input.correction = {
      source_response_sha256: changed.sourceResponseSha256,
      source_output_text: changed.sourceOutputText,
      failed_scene_ids: changed.failedSceneIds,
      failures: changed.failures.map((failure) => ({
        scene_id: failure.sceneId,
        field: failure.field,
        reason: failure.reason,
      })),
    };
    body[0].messages[0].content = canonicalizeJson(input);
    const requestBytes = canonicalizeJson(body);
    const noHttp = vi.fn(async () => {
      throw new Error("NETWORK_FORBIDDEN");
    });
    await expect(
      recoverClaimedHostedPromptBatch({
        apiKey: "offline-no-provider-credentials",
        plan: f.plan,
        persistedBinding: f.binding,
        batchOrdinal: 0,
        taskUUID: f.request.request.taskUUID,
        requestBytes,
        requestHash: sha(requestBytes),
        retryOfRequestHash: f.original.requestSha256,
        reservationMicroUsd: 500_000,
        recordedResult: f.result,
        sourceRecordedResult: { ...f.result, outputText: f.sealed.sourceOutputText },
        fetcher: noHttp,
      }),
    ).rejects.toMatchObject({ problemCode: "HOSTED_PROMPT_INPUT_INVALID" });
    expect(noHttp).not.toHaveBeenCalled();
  },
);

it("keeps decorative borders forbidden in the corrected output", async () => {
  const f = await fixture();
  const bad = JSON.parse(f.result.outputText);
  bad.scenes[0].action = "A decorative border surrounds the photograph.";
  const noHttp = vi.fn(async () => {
    throw new Error("NETWORK_FORBIDDEN");
  });
  await expect(
    recoverClaimedHostedPromptBatch({
      apiKey: "offline-no-provider-credentials",
      plan: f.plan,
      persistedBinding: f.binding,
      batchOrdinal: 0,
      taskUUID: f.request.request.taskUUID,
      requestBytes: f.request.requestBytes,
      requestHash: f.request.requestSha256,
      retryOfRequestHash: f.original.requestSha256,
      reservationMicroUsd: 500_000,
      recordedResult: { ...f.result, outputText: canonicalizeJson(bad) },
      sourceRecordedResult: { ...f.result, outputText: f.sealed.sourceOutputText },
      fetcher: noHttp,
    }),
  ).rejects.toBeInstanceOf(HostedPromptArchivedOutputInvalidError);
  expect(noHttp).not.toHaveBeenCalled();
});

it("recovers the narrow historical validator without reclassifying its already valid field scene", async () => {
  const f = await fixture(true);
  expect(
    buildRunwarePromptCorrection(f.batch, f.sealed.sourceOutputText, f.plan.requestPolicy),
  ).toBeNull();
  expect(
    recoverRunwarePromptCorrection(
      f.batch,
      f.sealed.sourceOutputText,
      f.sealed,
      f.plan.requestPolicy,
    ),
  ).toEqual(f.sealed);
  const noHttp = vi.fn(async () => {
    throw new Error("NETWORK_FORBIDDEN");
  });
  const accepted = await recoverClaimedHostedPromptBatch({
    apiKey: "offline-no-credentials",
    plan: f.plan,
    persistedBinding: f.binding,
    batchOrdinal: 0,
    taskUUID: f.request.request.taskUUID,
    requestBytes: f.request.requestBytes,
    requestHash: f.request.requestSha256,
    retryOfRequestHash: f.original.requestSha256,
    reservationMicroUsd: 500_000,
    recordedResult: f.result,
    sourceRecordedResult: { ...f.result, outputText: f.sealed.sourceOutputText },
    fetcher: noHttp,
  });
  expect(accepted.scenes).toHaveLength(10);
  expect(accepted.scenes.find((s) => s.scene.sceneId === "scene_001")?.writerOutput.action).toBe(
    "A field borders a natural grassland area.",
  );
  expect(accepted.scenes.find((s) => s.scene.sceneId === sceneId)?.writerOutput.action).toBe(
    "A dyke borders reclaimed land.",
  );
  const tampered = { ...f.sealed, failedSceneIds: ["scene_001"] };
  expect(
    recoverRunwarePromptCorrection(
      f.batch,
      f.sealed.sourceOutputText,
      tampered,
      f.plan.requestPolicy,
    ),
  ).toBeNull();
  expect(noHttp).not.toHaveBeenCalled();
});
