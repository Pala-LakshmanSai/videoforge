import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPromptBatch,
  buildRunwarePromptRequest,
  compileImagePrompt,
  derivePromptStyleTreatment,
  promptStyleTreatmentPositiveSuffix,
  planPromptBatches,
  naturalDocumentaryLiteralCharacterLimit,
  naturalDocumentaryRequiredPrompt,
  SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
  naturalDocumentaryWriterSystemPrompt,
} from "../dist/src/prompts/runtime.js";
import { NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH as hash } from "../dist/src/prompts/natural-documentary-style.js";

const profile = JSON.parse(
  readFileSync(
    new URL(
      "../../../project-context/evidence/natural_documentary_image_style_v1.json",
      import.meta.url,
    ),
  ),
);
const treatment = derivePromptStyleTreatment(profile.visual_profile, hash);
const style = {
  positiveSuffix: promptStyleTreatmentPositiveSuffix(treatment),
  negativeSuffix: profile.prompt_profile.negative_suffix,
  fullImageGuidance: profile.prompt_profile.full_image_guidance,
  splitImageGuidance: profile.prompt_profile.split_image_guidance,
};
const scene = {
  sceneId: "scene_001",
  phrase: "The worker turns the valve.",
  sentenceContext: "The worker turns the valve.",
  priorContext: null,
  nextContext: null,
  inImageShotRole: "HANDS_ACTION",
  layout: "IMAGE_FULL",
};
const authority = {
  styleProfileHash: hash,
  style,
  extraPromptKeywords: null,
  applyExtraPromptKeywords: false,
  scenes: [scene],
};
const batchInput = {
  batchId: "batch_001",
  projectTitle: "Valve inspection",
  imageStyleVersionId: "style_001",
  styleProfileHash: hash,
  styleTreatment: treatment,
  plannerGuidance: "Documentary stills",
  storyContext: "A worker adjusts a valve.",
  continuityTags: [],
  scenes: [scene],
};
const output = {
  scene_id: scene.sceneId,
  literal_subject: "A worker's hand on a valve wheel",
  action: "turning the wheel",
  environment: "an irrigation pipe",
  in_image_shot_role: scene.inImageShotRole,
  lighting_context: "available light",
  continuity_tags: [],
  prompt_core: "A worker turns a valve wheel on an irrigation pipe.",
};

test("legacy v24 system bytes remain exact; new default instructions and token settings do not grow", () => {
  assert.equal(
    createHash("sha256").update(SCENE_PROMPT_WRITER_SYSTEM_PROMPT).digest("hex"),
    "b435ff7e65c85beecf48af3932c48b9114d3d105535f3265047f34deb1a8c011",
  );
  const limit = naturalDocumentaryLiteralCharacterLimit(authority);
  const modern = buildRunwarePromptRequest(
    buildPromptBatch({ ...batchInput, literalCharacterLimit: limit }),
    [scene],
    1,
  );
  const oldHash = `sha256:${"a".repeat(64)}`;
  const legacy = buildRunwarePromptRequest(
    buildPromptBatch({
      ...batchInput,
      styleProfileHash: oldHash,
      styleTreatment: { ...treatment, style_profile_hash: oldHash },
    }),
    [scene],
    1,
  );
  assert.equal(legacy.requestVersion, "runware-gemini-3.5-flash-prompt-request-v24");
  assert.equal(modern.requestVersion, "runware-gemini-3.5-flash-prompt-request-v25");
  assert.equal(
    legacy.request.settings.systemPrompt.split("\n")[0],
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
  );
  assert.ok(
    Buffer.byteLength(modern.request.settings.systemPrompt) <=
      Buffer.byteLength(legacy.request.settings.systemPrompt),
  );
  assert.ok(modern.requestBytes.length <= legacy.requestBytes.length);
  assert.deepEqual(
    { ...modern.request.settings, systemPrompt: "" },
    { ...legacy.request.settings, systemPrompt: "" },
  );
  assert.equal(modern.request.model, legacy.request.model);
  assert.match(
    naturalDocumentaryWriterSystemPrompt(limit),
    new RegExp(`ceiling: ${limit} characters`),
  );
  assert.match(naturalDocumentaryWriterSystemPrompt(limit), /complete head/);
  assert.deepEqual(
    buildRunwarePromptRequest(
      buildPromptBatch({ ...batchInput, literalCharacterLimit: limit }),
      [scene],
      1,
    ),
    modern,
  );
});

test("fixed budget rejects impossible keywords before writer request construction and propagates through planning", () => {
  const limit = naturalDocumentaryLiteralCharacterLimit(authority);
  assert.ok(limit >= 90);
  assert.equal(
    naturalDocumentaryLiteralCharacterLimit({ ...authority, styleProfileHash: "legacy" }),
    undefined,
  );
  assert.throws(
    () =>
      naturalDocumentaryLiteralCharacterLimit({
        ...authority,
        applyExtraPromptKeywords: true,
        extraPromptKeywords: "x".repeat(500),
      }),
    /800-character|fewer than 90/,
  );
  const { batchId, ...rest } = batchInput;
  const plan = planPromptBatches({ ...rest, batchIdPrefix: batchId, literalCharacterLimit: limit });
  assert.equal(plan.batches[0].batch.literalCharacterLimit, limit);
  assert.throws(
    () => buildRunwarePromptRequest(buildPromptBatch(batchInput), [scene], 1),
    /allowance/,
  );
});

test("new hash compiles full and split as v4 with complete treatment, geometry, role and keywords", () => {
  for (const layout of ["IMAGE_FULL", "SPLIT_RIGHT_IMAGE"]) {
    const compiled = compileImagePrompt({
      styleProfileHash: hash,
      writerOutput: output,
      expectedScene: { ...scene, layout },
      style,
      extraPromptKeywords: "muted color",
      applyExtraPromptKeywords: true,
    });
    assert.equal(compiled.promptCompilerVersion, "prompt-compiler-v4");
    const wire = naturalDocumentaryRequiredPrompt(compiled.components);
    for (const part of [
      compiled.components.literalContent,
      compiled.components.cropGuidance,
      style.positiveSuffix,
      "viewpoint: hands action",
      "muted color",
    ])
      assert.ok(wire.includes(part));
    assert.doesNotMatch(wire, /right panel|split screen/);
    assert.ok(wire.length <= 800);
  }
  assert.throws(
    () =>
      compileImagePrompt({
        styleProfileHash: hash,
        writerOutput: { ...output, environment: "ordinary room ".repeat(17).trim() },
        expectedScene: scene,
        style,
        extraPromptKeywords: null,
        applyExtraPromptKeywords: false,
      }),
    /800-character/,
  );
});

test("new assembly retains role and keywords through exact 799/800 bounds and rejects 801", () => {
  const parts = {
    literalContent: "x",
    cropGuidance: "continuous photo",
    stylePositiveSuffix: "documentary",
    continuityAndShotRole: "viewpoint: hands action",
    extraPromptKeywords: "natural light",
  };
  const fixed = naturalDocumentaryRequiredPrompt(parts).length - 1;
  for (const length of [799, 800]) {
    const wire = naturalDocumentaryRequiredPrompt({
      ...parts,
      literalContent: "x".repeat(length - fixed),
    });
    assert.equal(wire.length, length);
    assert.ok(wire.endsWith("viewpoint: hands action. natural light"));
  }
  assert.throws(
    () => naturalDocumentaryRequiredPrompt({ ...parts, literalContent: "x".repeat(801 - fixed) }),
    /800-character/,
  );
});

test("preflight keywords use the compiler's NFKC, controls, whitespace and geometry normalization", () => {
  const variants = ["ｎａｔｕｒａｌ\t light", "ﬃ skin", "16:9", "soft\u0000 light"];
  for (const extraPromptKeywords of variants) {
    const limit = naturalDocumentaryLiteralCharacterLimit({
      ...authority,
      extraPromptKeywords,
      applyExtraPromptKeywords: true,
    });
    const compiled = compileImagePrompt({
      styleProfileHash: hash,
      writerOutput: output,
      expectedScene: scene,
      style,
      extraPromptKeywords,
      applyExtraPromptKeywords: true,
    });
    const noExtras = naturalDocumentaryLiteralCharacterLimit(authority);
    assert.equal(noExtras - limit, compiled.components.extraPromptKeywords.length + 2);
  }
  assert.throws(
    () =>
      naturalDocumentaryLiteralCharacterLimit({
        ...authority,
        extraPromptKeywords: "ﬃ".repeat(200),
        applyExtraPromptKeywords: true,
      }),
    /normalized characters/,
  );
});

test("v4 HUMAN_MEDIUM reserves and retains complete-head framing at the exact hard boundary", () => {
  const expectedScene = { ...scene, inImageShotRole: "HUMAN_MEDIUM" };
  const limit = naturalDocumentaryLiteralCharacterLimit({ ...authority, scenes: [expectedScene] });
  const literalSubject = "A kitchen worker";
  const action = "stirs soup";
  const environment = "k".repeat(limit - literalSubject.length - action.length);
  const writerOutput = {
    ...output,
    in_image_shot_role: "HUMAN_MEDIUM",
    literal_subject: literalSubject,
    action,
    environment,
  };
  const compiled = compileImagePrompt({
    styleProfileHash: hash,
    writerOutput,
    expectedScene,
    style,
    extraPromptKeywords: null,
    applyExtraPromptKeywords: false,
  });
  const wire = naturalDocumentaryRequiredPrompt(compiled.components);
  assert.equal(wire.length, 800);
  assert.ok(
    wire.startsWith(
      "Complete head and face visible, chest-up working view. subject: A kitchen worker",
    ),
  );
  assert.equal(wire.match(/complete head/gi)?.length, 1);
  assert.throws(
    () =>
      compileImagePrompt({
        styleProfileHash: hash,
        writerOutput: { ...writerOutput, environment: `${environment}x` },
        expectedScene,
        style,
        extraPromptKeywords: null,
        applyExtraPromptKeywords: false,
      }),
    /800-character/,
  );
  const legacy = compileImagePrompt({
    writerOutput,
    expectedScene,
    style,
    extraPromptKeywords: null,
    applyExtraPromptKeywords: false,
  });
  assert.equal(legacy.promptCompilerVersion, "prompt-compiler-v3");
  assert.equal(
    legacy.components.continuityAndShotRole,
    "same subject/setting/state, viewpoint: human medium",
  );
  assert.doesNotMatch(legacy.positivePrompt, /complete head/);
});
