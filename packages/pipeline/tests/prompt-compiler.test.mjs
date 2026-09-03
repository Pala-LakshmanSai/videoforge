import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicFixturePromptWriter,
  IN_IMAGE_SHOT_ROLES,
  MAX_PROMPT_LOCAL_CONTEXT_CHARS,
  MAX_PROMPT_STORY_CONTEXT_CHARS,
  PipelineDomainError,
  buildPromptBatch,
  compileImagePrompt,
  validatePromptWriterOutput,
  verifyCompiledImagePrompt,
} from "../dist/src/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const layouts = ["IMAGE_FULL", "SPLIT_RIGHT_IMAGE"];

function scenes(count) {
  return Array.from({ length: count }, (_, index) => ({
    sceneId: `scene_${String(index + 1).padStart(3, "0")}`,
    phrase: `Hands demonstrate irrigation valve step ${index + 1}`,
    sentenceContext: `Hands demonstrate irrigation valve step ${index + 1}.`,
    priorContext: index === 0 ? null : `Prior step ${index}`,
    nextContext: index + 1 === count ? null : `Next step ${index + 2}`,
    inImageShotRole: IN_IMAGE_SHOT_ROLES[index % IN_IMAGE_SHOT_ROLES.length],
    layout: layouts[index % layouts.length],
  }));
}

function batch(count = 40) {
  return buildPromptBatch({
    batchId: `batch_${count}`,
    projectTitle: "  Harvest\u0000 Water   Safely  ",
    imageStyleVersionId: "style_version_1",
    styleProfileHash: digest,
    plannerGuidance: "Natural documentary treatment",
    storyContext: "Compact irrigation story context",
    continuityTags: ["same_farmer", "dry_season"],
    scenes: scenes(count),
  });
}

const styles = [
  "authentic documentary photography",
  "warm analog film photograph",
  "cool editorial photography",
  "humid reportage photography",
  "low-contrast archival photography",
];

function style(positiveSuffix = styles[0]) {
  return {
    positiveSuffix,
    negativeSuffix: "illustration, logo, visible text",
    fullImageGuidance: "16:9 frame, key evidence inside center-safe 80%",
    splitImageGuidance: "8:9 right panel, key subject centered away from edges",
  };
}

function expectCode(code, action) {
  assert.throws(
    action,
    (error) => error instanceof PipelineDomainError && error.failure.code === code,
  );
}

test("builds exact 25, 40, and 50 scene batches with sanitized global context", () => {
  for (const count of [25, 40, 50]) {
    const value = batch(count);
    assert.equal(value.scenes.length, count);
    assert.equal(value.sanitizedProjectTitle, "Harvest Water Safely");
    assert.equal(value.plannerGuidance, "Natural documentary treatment");
    assert.deepEqual(value.continuityTags, ["same_farmer", "dry_season"]);
    assert.equal(new Set(value.scenes.map((scene) => scene.sceneId)).size, count);
  }
});

test("batch validation rejects empty batches but permits arbitrary script scene counts", () => {
  expectCode("PROMPT_INPUT_INVALID", () => batch(0));
  assert.equal(batch(1).scenes.length, 1);
  assert.equal(batch(24).scenes.length, 24);
  assert.equal(batch(51).scenes.length, 51);
  const duplicate = scenes(25);
  duplicate[1] = { ...duplicate[1], sceneId: duplicate[0].sceneId };
  expectCode("PROMPT_INPUT_INVALID", () =>
    buildPromptBatch({ ...batch(25), projectTitle: "Title", scenes: duplicate }),
  );
  const badRole = scenes(25);
  badRole[0] = { ...badRole[0], inImageShotRole: "TIMELINE_LAYOUT" };
  expectCode("PROMPT_INPUT_INVALID", () =>
    buildPromptBatch({ ...batch(25), projectTitle: "Title", scenes: badRole }),
  );
  const blank = scenes(25);
  blank[0] = { ...blank[0], phrase: "\u0000\t" };
  expectCode("PROMPT_INPUT_INVALID", () =>
    buildPromptBatch({ ...batch(25), projectTitle: "Title", scenes: blank }),
  );
});

test("batch bounds compact global context once and caps aggregate local context", () => {
  assert.equal(batch(25).storyContext, "Compact irrigation story context");
  expectCode("PROMPT_INPUT_INVALID", () =>
    buildPromptBatch({
      ...batch(25),
      projectTitle: "Title",
      storyContext: "x".repeat(MAX_PROMPT_STORY_CONTEXT_CHARS + 1),
    }),
  );
  const verbose = scenes(50).map((scene) => ({
    ...scene,
    sentenceContext: "s".repeat(2_000),
  }));
  assert.ok(verbose.length * 2_000 > MAX_PROMPT_LOCAL_CONTEXT_CHARS);
  expectCode("PROMPT_INPUT_INVALID", () =>
    buildPromptBatch({ ...batch(50), projectTitle: "Title", scenes: verbose }),
  );
});

test("fixture writer covers all six shot roles without choosing or changing layout", async () => {
  const input = batch(40);
  const output = await new DeterministicFixturePromptWriter().write(input);
  const validated = validatePromptWriterOutput(input, output);
  assert.deepEqual(
    new Set(validated.scenes.map((scene) => scene.in_image_shot_role)),
    new Set(IN_IMAGE_SHOT_ROLES),
  );
  validated.scenes.forEach((scene, index) =>
    assert.equal(scene.in_image_shot_role, input.scenes[index].inImageShotRole),
  );
});

test("writer output rejects missing, duplicate, unknown, changed-role, extra-field, accessor, and cyclic shapes", async () => {
  const input = batch(25);
  const fixture = await new DeterministicFixturePromptWriter().write(input);
  const mutable = () => structuredClone(fixture);

  const missing = mutable();
  missing.scenes.pop();
  expectCode("PROMPT_OUTPUT_INVALID", () => validatePromptWriterOutput(input, missing));

  const duplicate = mutable();
  duplicate.scenes[1].scene_id = duplicate.scenes[0].scene_id;
  expectCode("PROMPT_OUTPUT_INVALID", () => validatePromptWriterOutput(input, duplicate));

  const unknown = mutable();
  unknown.scenes[0].scene_id = "scene_unknown";
  expectCode("PROMPT_OUTPUT_INVALID", () => validatePromptWriterOutput(input, unknown));

  const changedRole = mutable();
  changedRole.scenes[0].in_image_shot_role = "MACRO_DETAIL";
  expectCode("PROMPT_OUTPUT_INVALID", () => validatePromptWriterOutput(input, changedRole));

  const badContinuity = mutable();
  badContinuity.scenes[0].continuity_tags[0] = "bad\u0000tag";
  expectCode("PROMPT_OUTPUT_INVALID", () => validatePromptWriterOutput(input, badContinuity));

  const extra = mutable();
  extra.scenes[0].timeline_composition = "IMAGE_FULL";
  expectCode("PROMPT_OUTPUT_INVALID", () => validatePromptWriterOutput(input, extra));

  const accessor = mutable();
  Object.defineProperty(accessor.scenes[0], "action", { enumerable: true, get: () => "late read" });
  expectCode("PROMPT_OUTPUT_INVALID", () => validatePromptWriterOutput(input, accessor));

  const cyclic = mutable();
  cyclic.loop = cyclic;
  expectCode("PROMPT_OUTPUT_INVALID", () => validatePromptWriterOutput(input, cyclic));
});

test("compiler preserves normative order, layout crop rules, five styles, and deterministic hashes", async () => {
  const input = batch(40);
  const output = validatePromptWriterOutput(
    input,
    await new DeterministicFixturePromptWriter().write(input),
  );
  for (const [index, positiveSuffix] of styles.entries()) {
    const sceneIndex = index * 2 + 1;
    const compiled = compileImagePrompt({
      writerOutput: output.scenes[sceneIndex],
      expectedScene: input.scenes[sceneIndex],
      style: style(positiveSuffix),
      extraPromptKeywords: "unused hidden logo request",
      applyExtraPromptKeywords: false,
    });
    assert.equal(compiled.components.extraPromptKeywords, null);
    assert.equal(compiled.positivePrompt.includes("unused hidden logo request"), false);
    assert.equal(compiled.positivePrompt.includes(positiveSuffix), true);
    assert.equal(compiled.positivePrompt.includes("8:9 right panel"), true);
    assert.ok(
      compiled.positivePrompt.indexOf(compiled.components.literalContent) <
        compiled.positivePrompt.indexOf(compiled.components.cropGuidance),
    );
    assert.ok(
      compiled.positivePrompt.indexOf(compiled.components.cropGuidance) <
        compiled.positivePrompt.indexOf(compiled.components.stylePositiveSuffix),
    );
    verifyCompiledImagePrompt(compiled);
    assert.deepEqual(
      compiled,
      compileImagePrompt({
        writerOutput: output.scenes[sceneIndex],
        expectedScene: input.scenes[sceneIndex],
        style: style(positiveSuffix),
        extraPromptKeywords: "different disabled text",
        applyExtraPromptKeywords: false,
      }),
    );
  }

  const full = compileImagePrompt({
    writerOutput: output.scenes[0],
    expectedScene: input.scenes[0],
    style: style(),
    extraPromptKeywords: null,
    applyExtraPromptKeywords: false,
  });
  assert.equal(full.positivePrompt.includes("center-safe 80%"), true);

  const noStyleNegative = compileImagePrompt({
    writerOutput: output.scenes[0],
    expectedScene: input.scenes[0],
    style: { ...style(), negativeSuffix: "" },
    extraPromptKeywords: null,
    applyExtraPromptKeywords: false,
  });
  assert.equal(noStyleNegative.negativePrompt.startsWith(","), false);
  assert.equal(noStyleNegative.components.styleNegativeSuffix, "");
});

test("enabled extras normalize once, support negative refinements, and count Unicode UTF-8 bytes", async () => {
  const input = batch(25);
  const output = validatePromptWriterOutput(
    input,
    await new DeterministicFixturePromptWriter().write(input),
  );
  const extra = "  café   texture, no logo, no text, no AI look  ";
  const compiled = compileImagePrompt({
    writerOutput: output.scenes[0],
    expectedScene: input.scenes[0],
    style: style(),
    extraPromptKeywords: extra,
    applyExtraPromptKeywords: true,
  });
  assert.equal(
    compiled.components.extraPromptKeywords,
    "café texture, no logo, no text, no AI look",
  );
  assert.equal(compiled.positivePrompt.match(/café texture/gu)?.length, 1);
  assert.equal(
    compiled.positivePromptUtf8Bytes,
    Buffer.byteLength(compiled.positivePrompt, "utf8"),
  );
});

test("compiler caps verbose outputs and removes exact duplicate prompt components", () => {
  const input = batch(25);
  const repeated = "Farmer opens an irrigation valve";
  const compiled = compileImagePrompt({
    writerOutput: {
      scene_id: input.scenes[0].sceneId,
      literal_subject: repeated,
      action: repeated,
      environment: repeated,
      in_image_shot_role: input.scenes[0].inImageShotRole,
      lighting_context: repeated,
      continuity_tags: [],
      prompt_core: repeated,
    },
    expectedScene: input.scenes[0],
    style: style(),
    extraPromptKeywords: null,
    applyExtraPromptKeywords: false,
  });
  assert.equal(compiled.components.literalContent, repeated);
  assert.equal(compiled.positivePrompt.match(/Farmer opens an irrigation valve/gu)?.length, 1);
  assert.ok(compiled.positivePrompt.length <= 6_500);
  assert.ok(compiled.negativePrompt.length <= 3_000);
});

test("compiler rejects enabled blank, oversized, control-only, forbidden extras, and conflicting style clauses", async () => {
  const input = batch(25);
  const output = validatePromptWriterOutput(
    input,
    await new DeterministicFixturePromptWriter().write(input),
  );
  const base = { writerOutput: output.scenes[0], expectedScene: input.scenes[0], style: style() };
  for (const extraPromptKeywords of [null, "   ", "\u0000\t", "x".repeat(501)]) {
    expectCode("PROMPT_INPUT_INVALID", () =>
      compileImagePrompt({ ...base, extraPromptKeywords, applyExtraPromptKeywords: true }),
    );
  }
  for (const extraPromptKeywords of [
    "add a caption",
    "add text",
    "show a logo",
    "with infographic",
    "place avatar on the right",
    "logo on a bottle",
  ]) {
    expectCode("PROMPT_CONFLICT", () =>
      compileImagePrompt({ ...base, extraPromptKeywords, applyExtraPromptKeywords: true }),
    );
  }
  expectCode("PROMPT_CONFLICT", () =>
    compileImagePrompt({
      ...base,
      style: style("documentary photo, add a watermark"),
      extraPromptKeywords: null,
      applyExtraPromptKeywords: false,
    }),
  );
  for (const changedStyle of [
    { ...style(), fullImageGuidance: "4:3 frame, subject at the edge" },
    { ...style(), splitImageGuidance: "8:9 image on the left, avatar on the right" },
  ]) {
    expectCode("PROMPT_CONFLICT", () =>
      compileImagePrompt({
        ...base,
        style: changedStyle,
        extraPromptKeywords: null,
        applyExtraPromptKeywords: false,
      }),
    );
  }
});

test("verification rejects prompt, component, byte-count, and hash tampering", async () => {
  const input = batch(25);
  const output = validatePromptWriterOutput(
    input,
    await new DeterministicFixturePromptWriter().write(input),
  );
  const compiled = compileImagePrompt({
    writerOutput: output.scenes[0],
    expectedScene: input.scenes[0],
    style: style(),
    extraPromptKeywords: null,
    applyExtraPromptKeywords: false,
  });
  for (const changed of [
    { ...compiled, positivePrompt: `${compiled.positivePrompt} altered` },
    { ...compiled, positivePromptUtf8Bytes: compiled.positivePromptUtf8Bytes + 1 },
    { ...compiled, positivePromptSha256: digest },
    { ...compiled, components: { ...compiled.components, cropGuidance: "tampered" } },
  ]) {
    expectCode("PROMPT_HASH_MISMATCH", () => verifyCompiledImagePrompt(changed));
  }
});
