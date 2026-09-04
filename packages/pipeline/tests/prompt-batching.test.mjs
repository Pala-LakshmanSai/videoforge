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
  derivePromptStyleTreatment,
  promptStyleTreatmentPositiveSuffix,
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

function styleTreatment(styleProfileHash = digest) {
  return {
    schema_version: "image-style-treatment/v2",
    style_profile_hash: styleProfileHash,
    medium_family: "documentary photography",
    realism: "physically believable still image",
    camera_language: "restrained observational camera",
    image_framing: "crop-safe contextual framing",
    shot_scale_preferences: ["environmental wide", "hands and action"],
    lighting: "available practical light",
    palette: { descriptors: ["true-to-life", "restrained saturation"], approximate_hex: [] },
    contrast_and_exposure: "soft natural contrast",
    depth_of_field: "natural lens depth",
    texture_and_grain: "tactile texture with restrained grain",
    imperfection_profile: ["ordinary wear"],
    mood: ["observational", "grounded"],
  };
}

function planningInput(count, options = {}) {
  return {
    batchIdPrefix: "task_prompt",
    projectTitle: "A practical documentary",
    imageStyleVersionId: "style_version_1",
    styleProfileHash: digest,
    styleTreatment: styleTreatment(),
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

test("style treatment is a deterministic semantic projection, not reference content", () => {
  const profile = {
    visual_profile: {
      medium_family: "analog photography",
      realism: "true to life",
      subject_treatment: "Professional and focused on product interaction or retail display",
      camera_language: "eye-level lens",
      image_framing: "wide contextual frame",
      shot_scale_preferences: ["Medium shot", "Close-up"],
      lighting: "soft window light",
      color: {
        descriptors: ["Neutral", "Cool-toned", "Clean", "Professional"],
        approximate_hex: ["#AA7733"],
      },
      contrast_and_exposure: "soft contrast",
      depth_of_field: "natural depth",
      texture_and_grain: "fine grain",
      human_rendering: "Portrait of John in every frame",
      environment_and_material_detail:
        "Organized retail spaces with fabric textures and product presentation",
      imperfection_profile: ["Minimal", "Clean digital aesthetic"],
      mood: ["Professional", "Approachable", "Calm", "Organized"],
      continuity_rules: ["same location"],
      must_include: ["reference product"],
      must_avoid: ["copied logo"],
      flexible_properties: ["weather"],
    },
  };
  const projected = derivePromptStyleTreatment(profile.visual_profile, digest);
  assert.equal(projected.style_profile_hash, digest);
  assert.equal(projected.image_framing, "wide contextual frame");
  assert.deepEqual(projected.shot_scale_preferences, ["Medium shot", "Close-up"]);
  assert.deepEqual(projected.palette.descriptors, [
    "Neutral",
    "Cool-toned",
    "Clean",
    "Professional",
  ]);
  assert.deepEqual(projected.imperfection_profile, ["Minimal", "Clean digital aesthetic"]);
  assert.deepEqual(projected.mood, ["Professional", "Approachable", "Calm", "Organized"]);
  assert.equal(Object.hasOwn(projected, "subject_treatment"), false);
  assert.equal(Object.hasOwn(projected, "human_rendering"), false);
  assert.equal(Object.hasOwn(projected, "environment_and_material_detail"), false);
  assert.doesNotMatch(promptStyleTreatmentPositiveSuffix(projected), /retail|product|John/iu);
  assert.equal(Object.hasOwn(projected, "must_include"), false);
  assert.equal(Object.hasOwn(projected, "continuity_rules"), false);
  assert.equal(Object.hasOwn(projected, "planner_guidance"), false);
});

test("style treatment rejects reference-specific content from an already-published profile", () => {
  const input = planningInput(1);
  const visualProfile = {
    medium_family: "Portrait of John",
    realism: input.styleTreatment.realism,
    subject_treatment: "Portrait of John",
    camera_language: input.styleTreatment.camera_language,
    image_framing: input.styleTreatment.image_framing,
    shot_scale_preferences: input.styleTreatment.shot_scale_preferences,
    lighting: input.styleTreatment.lighting,
    color: input.styleTreatment.palette,
    contrast_and_exposure: input.styleTreatment.contrast_and_exposure,
    depth_of_field: input.styleTreatment.depth_of_field,
    texture_and_grain: input.styleTreatment.texture_and_grain,
    human_rendering: "believable anatomy and materials",
    environment_and_material_detail: "credible real-world surfaces and material response",
    imperfection_profile: input.styleTreatment.imperfection_profile,
    mood: input.styleTreatment.mood,
    continuity_rules: [],
    must_include: [],
    must_avoid: [],
    flexible_properties: [],
  };
  assert.throws(
    () => derivePromptStyleTreatment(visualProfile, digest),
    /Pinned style contains reference-specific content/u,
  );
  assert.throws(
    () =>
      planPromptBatches({
        ...input,
        styleTreatment: { ...input.styleTreatment, camera_language: "Portrait of John" },
      }),
    (error) =>
      error instanceof PipelineDomainError &&
      error.failure.code === "PROMPT_INPUT_INVALID" &&
      /reference-specific content/u.test(error.failure.message),
  );
});

test("prompt batches preserve title-cased abstract style trait lists", () => {
  const input = planningInput(1);
  const treatment = {
    ...input.styleTreatment,
    shot_scale_preferences: ["Medium shot", "Close-up"],
    palette: {
      ...input.styleTreatment.palette,
      descriptors: ["Neutral", "Cool-toned", "Clean", "Professional"],
    },
    imperfection_profile: ["Minimal", "Clean digital aesthetic"],
    mood: ["Professional", "Approachable", "Calm", "Organized"],
  };
  const batch = buildPromptBatch({ ...input, styleTreatment: treatment });
  assert.deepEqual(batch.styleTreatment?.shot_scale_preferences, ["Medium shot", "Close-up"]);
  assert.deepEqual(batch.styleTreatment?.palette.descriptors, [
    "Neutral",
    "Cool-toned",
    "Clean",
    "Professional",
  ]);
  assert.deepEqual(batch.styleTreatment?.mood, [
    "Professional",
    "Approachable",
    "Calm",
    "Organized",
  ]);

  assert.throws(
    () => buildPromptBatch({ ...input, styleTreatment: { ...treatment, medium_family: "Rolex" } }),
    (error) =>
      error instanceof PipelineDomainError &&
      error.failure.code === "PROMPT_INPUT_INVALID" &&
      /reference-specific content/u.test(error.failure.message),
  );
});

test("style positive suffix emits only bounded runtime-pinned high-value cues", () => {
  const maximum = styleTreatment();
  maximum.medium_family = `MEDIUM_MARKER ${"photography ".repeat(20)}`;
  maximum.realism = `REALISM_MARKER ${"physically believable still image ".repeat(40)}detail`;
  maximum.camera_language = `CAMERA_MARKER ${"observational lens language ".repeat(30)}`;
  maximum.image_framing = `FRAMING_MARKER ${"balanced contextual frame ".repeat(30)}`;
  maximum.shot_scale_preferences = [`SCALE_MARKER ${"environmental wide ".repeat(20)}`];
  maximum.lighting = `LIGHT_MARKER ${"soft practical illumination ".repeat(30)}`;
  maximum.palette.descriptors = Array.from(
    { length: 20 },
    (_, index) => `PALETTE_MARKER_${index} restrained natural color`,
  );
  maximum.palette.approximate_hex = ["#123456"];
  maximum.contrast_and_exposure = `CONTRAST_MARKER ${"protected exposure ".repeat(30)}`;
  maximum.depth_of_field = `DEPTH_MARKER ${"contextual lens depth ".repeat(30)}`;
  maximum.texture_and_grain = `TEXTURE_MARKER ${"tactile restrained grain ".repeat(30)}`;
  maximum.imperfection_profile = Array.from(
    { length: 20 },
    (_, index) => `IMPERFECTION_MARKER_${index} ordinary material variation`,
  );
  maximum.mood = Array.from(
    { length: 20 },
    (_, index) => `MOOD_MARKER_${index} grounded observational mood`,
  );
  const suffix = promptStyleTreatmentPositiveSuffix(maximum);
  assert.ok(suffix.length <= 500);
  assert.equal(suffix, suffix.trim());
  assert.equal(/\s$/u.test(suffix), false);
  for (const marker of ["MEDIUM_MARKER", "REALISM_MARKER", "CAMERA_MARKER", "LIGHT_MARKER"])
    assert.ok(suffix.includes(marker), `missing compacted style field ${marker}`);
  for (const omitted of [
    "FRAMING_MARKER",
    "SCALE_MARKER",
    "PALETTE_MARKER_0",
    "#123456",
    "CONTRAST_MARKER",
    "DEPTH_MARKER",
    "TEXTURE_MARKER",
    "IMPERFECTION_MARKER_0",
    "MOOD_MARKER_0",
  ])
    assert.equal(suffix.includes(omitted), false, `unexpected low-value style field ${omitted}`);
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
    styleTreatment: styleTreatment(),
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
  assert.equal(request.requestVersion, "runware-deepseek-v4-flash-prompt-request-v18");
  assert.equal(request.request.model, "deepseek:v4@flash");
});
