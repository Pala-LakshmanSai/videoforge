import assert from "node:assert/strict";
import test from "node:test";

import {
  IN_IMAGE_SHOT_ROLES,
  PipelineDomainError,
  DEFAULT_PROMPT_BATCH_MAX_OUTPUT_TOKENS,
  RUNWARE_PROMPT_MAX_OUTPUT_TOKENS,
  RUNWARE_PROMPT_OUTPUT_FIXED_TOKENS,
  RUNWARE_PROMPT_OUTPUT_TOKEN_HEADROOM,
  RUNWARE_PROMPT_OUTPUT_TOKENS_PER_SCENE,
  buildPromptBatch,
  buildRunwarePromptRequest,
  planPromptBatches,
} from "../dist/src/index.js";

const digest = `sha256:${"a".repeat(64)}`;

function scenes(count, options = {}) {
  return Array.from({ length: count }, (_, index) => {
    const sentence = Math.floor(index / (options.sentenceSize ?? 3));
    return {
      sceneId: `scene_${String(index + 1).padStart(4, "0")}`,
      phrase: `A person performs the literal documented action ${index + 1}.`,
      sentenceContext: `Containing sentence ${sentence}.`,
      priorContext: index === 0 ? null : `Previous scene context ${index}.`,
      nextContext: index + 1 === count ? null : `Next scene context ${index + 2}.`,
      inImageShotRole: IN_IMAGE_SHOT_ROLES[index % IN_IMAGE_SHOT_ROLES.length],
      layout: index % 2 === 0 ? "IMAGE_FULL" : "SPLIT_RIGHT_IMAGE",
    };
  });
}

function planningInput(count, options = {}) {
  return {
    batchIdPrefix: "task_prompt",
    projectTitle: "A practical documentary",
    imageStyleVersionId: "style_version_1",
    styleProfileHash: digest,
    plannerGuidance: "Natural documentary photography with ordinary physical evidence",
    storyContext: "A compact story about a person demonstrating a practical process.",
    continuityTags: ["same_person", "same_place"],
    scenes: scenes(count, options),
    options: options.options,
  };
}

function isBoundary(left, right) {
  return left.sentenceContext !== right.sentenceContext || /[.!?]["')\]]*$/u.test(left.phrase);
}

test("buildPromptBatch accepts one scene and arbitrary counts without a script cap", () => {
  for (const count of [1, 2, 24, 51, 200]) {
    const batch = buildPromptBatch({
      batchId: `batch_${count}`,
      projectTitle: "A practical documentary",
      imageStyleVersionId: "style_version_1",
      styleProfileHash: digest,
      plannerGuidance: "Natural documentary photography",
      storyContext: "A compact story.",
      continuityTags: [],
      scenes: scenes(count),
    });
    assert.equal(batch.scenes.length, count);
  }
  assert.throws(
    () =>
      buildPromptBatch({
        batchId: "empty",
        projectTitle: "A practical documentary",
        imageStyleVersionId: "style_version_1",
        styleProfileHash: digest,
        plannerGuidance: "Natural documentary photography",
        storyContext: "A compact story.",
        continuityTags: [],
        scenes: [],
      }),
    (error) =>
      error instanceof PipelineDomainError && error.failure.code === "PROMPT_INPUT_INVALID",
  );
});

test("planner is deterministic, contiguous, complete, and quality-bounds larger responses", () => {
  const small = planPromptBatches(planningInput(24));
  assert.equal(small.batchCount, 1);
  assert.equal(small.maxOutputTokens, DEFAULT_PROMPT_BATCH_MAX_OUTPUT_TOKENS);

  const first = planPromptBatches(planningInput(31));
  const second = planPromptBatches(planningInput(31));
  assert.deepEqual(first, second);
  assert.equal(first.totalScenes, 31);
  assert.equal(first.batchCount, 2);
  assert.deepEqual(
    first.batches.map((entry) => entry.sceneIds.length).sort((left, right) => left - right),
    [15, 16],
  );
  assert.equal(first.maxOutputTokens, DEFAULT_PROMPT_BATCH_MAX_OUTPUT_TOKENS);
  assert.deepEqual(
    first.batches.flatMap((entry) => entry.sceneIds),
    scenes(31).map((scene) => scene.sceneId),
  );
  for (const entry of first.batches) {
    assert.ok(entry.estimatedInputTokens <= first.maxInputTokens);
    assert.ok(entry.maxOutputTokens <= first.maxOutputTokens);
    assert.ok(
      entry.estimatedOutputTokens + RUNWARE_PROMPT_OUTPUT_TOKEN_HEADROOM <= first.maxOutputTokens,
    );
  }
});

test("planner splits long scripts by conservative input/output budgets without a script limit", () => {
  const result = planPromptBatches(
    planningInput(240, {
      sentenceSize: 4,
      options: { maxInputTokens: 8_000, maxOutputTokens: 12_000 },
    }),
  );
  assert.ok(result.batchCount > 1);
  assert.equal(result.totalScenes, 240);
  assert.deepEqual(
    result.batches.flatMap((entry) => entry.sceneIds),
    scenes(240).map((scene) => scene.sceneId),
  );
  for (const [index, entry] of result.batches.entries()) {
    assert.ok(entry.estimatedInputTokens <= result.maxInputTokens);
    assert.ok(entry.maxOutputTokens <= result.maxOutputTokens);
    assert.equal(entry.ordinal, index + 1);
    if (index + 1 < result.batches.length) {
      const left = scenes(240)[entry.sceneEndIndexExclusive - 1];
      const right = scenes(240)[entry.sceneEndIndexExclusive];
      assert.ok(left && right);
      // A natural boundary is preferred when one is close to the budget edge.
      assert.equal(entry.endsAtNaturalBoundary, isBoundary(left, right));
    }
  }
});

test("planner retains balanced contiguous remainder when a boundary would leave one scene", () => {
  const result = planPromptBatches(
    planningInput(31, {
      options: { maxInputTokens: 8_000, maxOutputTokens: 7_500 },
    }),
  );
  assert.ok(result.batches.every((entry) => entry.sceneIds.length > 1));
  assert.deepEqual(
    result.batches.flatMap((entry) => entry.sceneIds),
    scenes(31).map((scene) => scene.sceneId),
  );
});

test("planner treats the aggregate local-context ceiling as a batch boundary", () => {
  const verboseScenes = scenes(80).map((scene) => ({
    ...scene,
    sentenceContext: `${scene.sentenceContext} ${"visible ordinary evidence ".repeat(55)}`,
  }));
  const result = planPromptBatches({ ...planningInput(80), scenes: verboseScenes });
  assert.ok(result.batchCount > 1);
  assert.deepEqual(
    result.batches.flatMap((entry) => entry.sceneIds),
    verboseScenes.map((scene) => scene.sceneId),
  );
});

test("planner never trades a minimum request count for a nearby sentence boundary", () => {
  const source = scenes(200).map((scene, index) => ({
    ...scene,
    phrase: `Action ${index}${index === 95 || index === 195 ? "." : ""}`,
    sentenceContext: `sentence ${index < 96 ? 0 : index < 196 ? 1 : 2}`,
  }));
  const result = planPromptBatches({
    ...planningInput(200),
    scenes: source,
    options: { maxOutputTokens: RUNWARE_PROMPT_MAX_OUTPUT_TOKENS },
  });
  assert.equal(result.batchCount, 2);
  assert.ok(result.batches.every((entry) => entry.sceneIds.length > 1));
});

test("request maxTokens includes fixed and per-scene headroom and allows short batches", () => {
  const batch = buildPromptBatch({
    batchId: "batch_short",
    projectTitle: "A practical documentary",
    imageStyleVersionId: "style_version_1",
    styleProfileHash: digest,
    plannerGuidance: "Natural documentary photography",
    storyContext: "A compact story.",
    continuityTags: [],
    scenes: scenes(2),
  });
  const request = buildRunwarePromptRequest(batch, batch.scenes, 1);
  assert.equal(
    request.request.settings.maxTokens,
    RUNWARE_PROMPT_OUTPUT_FIXED_TOKENS +
      2 * RUNWARE_PROMPT_OUTPUT_TOKENS_PER_SCENE +
      RUNWARE_PROMPT_OUTPUT_TOKEN_HEADROOM,
  );
  assert.equal(request.requestVersion, "runware-deepseek-v4-flash-prompt-request-v9");
  assert.equal(request.request.model, "deepseek:v4@flash");
});
