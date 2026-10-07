import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { naturalDocumentaryRequiredPrompt } from "../dist/src/prompts/natural-documentary-prompt-policy.js";

import {
  IN_IMAGE_SHOT_ROLES,
  NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
  PHYSICAL_PLACEMENT_WRITER_INSTRUCTION,
  PROMPT_CONTENT_REPAIR_INSTRUCTION,
  PHYSICAL_PLACEMENT_V2_WRITER_INSTRUCTION,
  PipelineDomainError,
  RUNWARE_PROMPT_MAX_OUTPUT_TOKENS,
  RUNWARE_PROMPT_OUTPUT_FIXED_TOKENS,
  RUNWARE_PROMPT_OUTPUT_TOKEN_HEADROOM,
  RUNWARE_PROMPT_OUTPUT_TOKENS_PER_SCENE,
  RUNWARE_PROMPT_MODEL,
  RUNWARE_PROMPT_REQUEST_VERSION,
  RUNWARE_LUNA_PROMPT_MODEL,
  RUNWARE_LUNA_PROMPT_REQUEST_VERSION,
  RUNWARE_LUNA_PROMPT_MAX_OUTPUT_TOKENS,
  RUNWARE_LUNA_UNMARKED_PRODUCT_INSTRUCTION,
  RunwarePromptWriter,
  SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
  buildPromptBatch,
  buildRunwarePromptRequest,
  buildRunwarePromptCorrection,
  projectTextFreePhysicalSurfaces,
  projectRunwareLunaPhysicalProductCategory,
  compileImagePrompt,
  naturalDocumentaryLiteralCharacterLimit,
  plainGeometry,
} from "../dist/src/index.js";

const layouts = ["IMAGE_FULL", "SPLIT_RIGHT_IMAGE"];
const styleGuidance = [
  "authentic documentary photography",
  "warm analog film photography",
  "cool editorial photography",
  "humid reportage photography",
  "low-contrast archival photography",
];

function treatment(styleIndex, styleProfileHash) {
  return {
    schema_version: "image-style-treatment/v2",
    style_profile_hash: styleProfileHash,
    medium_family: styleGuidance[styleIndex],
    realism: "physically believable still-image treatment",
    camera_language: "restrained observational camera language",
    image_framing: "useful crop-safe framing",
    shot_scale_preferences: ["environmental wide", "hands and action"],
    lighting: "available practical light with natural shadow detail",
    palette: {
      descriptors: ["true-to-life", "restrained saturation"],
      approximate_hex: ["#345566", "#B6805E"],
    },
    contrast_and_exposure: "soft natural contrast with recoverable highlights",
    depth_of_field: "natural lens depth with enough environmental context",
    texture_and_grain: "tactile material detail with restrained grain",
    imperfection_profile: ["uneven exposure", "worn materials"],
    mood: ["observational", "grounded"],
  };
}

function makeBatch(count = 25, styleIndex = 0) {
  const hashCharacter = "abcde"[styleIndex];
  const styleProfileHash = `sha256:${hashCharacter.repeat(64)}`;
  return buildPromptBatch({
    batchId: `batch_${count}_${styleIndex}`,
    projectTitle: "Harvest Water Without Pumps",
    imageStyleVersionId: `style_version_${styleIndex + 1}`,
    styleProfileHash,
    styleTreatment: treatment(styleIndex, styleProfileHash),
    plannerGuidance: styleGuidance[styleIndex],
    storyContext: `Compact story context for style ${styleIndex}`,
    continuityTags: ["same_farmer", "dry_season"],
    scenes: Array.from({ length: count }, (_, index) => ({
      sceneId: `scene_${String(index + 1).padStart(3, "0")}`,
      phrase: `Hands demonstrate irrigation valve step ${index + 1}`,
      sentenceContext: `Hands demonstrate irrigation valve step ${index + 1}.`,
      priorContext: index === 0 ? null : `Prior step ${index}`,
      nextContext: index + 1 === count ? null : `Next step ${index + 2}`,
      inImageShotRole: IN_IMAGE_SHOT_ROLES[index % IN_IMAGE_SHOT_ROLES.length],
      layout: layouts[index % layouts.length],
    })),
  });
}

function withScenePhrase(batch, phrase) {
  return {
    ...batch,
    scenes: Object.freeze(
      batch.scenes.map((scene) =>
        Object.freeze({
          ...scene,
          phrase,
          sentenceContext: phrase,
          priorContext: null,
          nextContext: null,
        }),
      ),
    ),
  };
}

function payload(request) {
  return JSON.parse(request.request.messages[0].content);
}

function output(request, options = {}) {
  const requestPayload = payload(request);
  const rows = requestPayload.scenes.map((scene) => ({
    scene_id: scene.scene_id,
    literal_subject: "Hands",
    action: `demonstrating literal action ${options.marker ?? request.attemptIndex}`,
    environment: "irrigation valve step",
    in_image_shot_role: scene.in_image_shot_role,
    lighting_context: "available practical daylight",
    continuity_tags: ["same_farmer", "dry_season"],
    prompt_core: `Close documentary view of ${scene.exact_phrase.toLowerCase()} in an ordinary farm setting, marker ${options.marker ?? request.attemptIndex}`,
  }));
  const changed = options.change ? options.change(rows, requestPayload) : rows;
  const complete =
    request.request.model === RUNWARE_LUNA_PROMPT_MODEL
      ? changed.map((row) => ({
          ...row,
          literal_subject: /[.!?]$/u.test(row.literal_subject)
            ? row.literal_subject
            : `${row.literal_subject}.`,
          action: /[.!?]$/u.test(row.action) ? row.action : `${row.action}.`,
          environment: /[.!?]$/u.test(row.environment) ? row.environment : `${row.environment}.`,
        }))
      : changed;
  return JSON.stringify({ batch_id: requestPayload.batch_id, scenes: complete });
}

const success = (request, options = {}) => ({
  status: "succeeded",
  outputText: options.outputText ?? output(request, options),
  latencyMs: options.latencyMs ?? 25,
  usage: options.usage ?? {
    inputTokens: 1_000,
    outputTokens: 2_000,
    totalTokens: 3_000,
    cachedInputTokens: 0,
  },
  costUsd: options.costUsd ?? 0.001,
  finishReason: options.finishReason ?? "stop",
  providerModel: options.providerModel ?? null,
  ...(options.costBasis ? { costBasis: options.costBasis } : {}),
  ...(options.estimatedCostMicroUsd !== undefined
    ? { estimatedCostMicroUsd: options.estimatedCostMicroUsd }
    : {}),
  ...(options.responseId ? { responseId: options.responseId } : {}),
  ...(options.wireHash ? { wireHash: options.wireHash } : {}),
});

class ScriptedTransport {
  constructor(steps) {
    this.steps = steps;
    this.requests = [];
  }

  async dispatch(request) {
    this.requests.push(request);
    const step = this.steps[this.requests.length - 1];
    if (!step) throw new Error("unexpected transport call");
    return step(request);
  }
}

test("legacy v24-v32 request bytes and UUIDs stay pinned", () => {
  const goldens = [
    [
      false,
      1,
      "sha256:e5bff7f222239c20723898b7c77b4e20672507ec94dd570b3a2638c92db19dea",
      "a3eef738-0ea8-40a4-8f2f-d6c6cac4a42b",
    ],
    [
      false,
      2,
      "sha256:dfda6971c055b4295a39537052383527007be4afd5cefc7d4237defa3bbd4c9a",
      "c98f571a-4cfa-4290-89c5-e4d616b4c481",
    ],
    [
      true,
      1,
      "sha256:9e96e64b4424096daf845d9b0c6d504fc5f77cba23581614654e11aa9c6f4380",
      "433f3485-1aff-4880-b532-b272bf9b8728",
    ],
    [
      true,
      2,
      "sha256:39da9754b4c311ab8e34d75d5a439ee38ffeddf409c903af0469bce777a3e10c",
      "70475eda-d1e4-46e9-a6aa-e1d76a22004b",
    ],
  ];
  for (const [natural, attempt, expectedHash, expectedUuid] of goldens) {
    const base = makeBatch(2);
    const batch = natural
      ? buildPromptBatch({
          ...base,
          projectTitle: base.sanitizedProjectTitle,
          styleProfileHash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
          styleTreatment: {
            ...base.styleTreatment,
            style_profile_hash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
          },
          literalCharacterLimit: 180,
        })
      : base;
    const lineage = attempt === 2 ? `sha256:${"f".repeat(64)}` : null;
    const legacy = buildRunwarePromptRequest(batch, batch.scenes, attempt, lineage, 1, "legacy");
    assert.ok(Buffer.byteLength(legacy.request.settings.systemPrompt) <= 6000);
    assert.equal(legacy.requestSha256, expectedHash);
    assert.equal(legacy.request.taskUUID, expectedUuid);
    assert.equal(
      createHash("sha256").update(legacy.requestBytes).digest("hex"),
      expectedHash.slice(7),
    );
    assert.deepEqual(buildRunwarePromptRequest(batch, batch.scenes, attempt, lineage), legacy);
    for (const [policy, version, instruction] of [
      ["physical-placement-v1", "v26", PHYSICAL_PLACEMENT_WRITER_INSTRUCTION],
      ["physical-placement-v2", "v27", PHYSICAL_PLACEMENT_V2_WRITER_INSTRUCTION],
    ]) {
      const current = buildRunwarePromptRequest(batch, batch.scenes, attempt, lineage, 1, policy);
      assert.ok(Buffer.byteLength(current.request.settings.systemPrompt) <= 7000);
      assert.equal(current.requestVersion, `runware-gemini-3.5-flash-prompt-request-${version}`);
      assert.notEqual(current.request.taskUUID, expectedUuid);
      assert.notEqual(current.requestSha256, expectedHash);
      assert.equal(
        current.request.settings.systemPrompt.replace(` ${instruction}`, ""),
        legacy.request.settings.systemPrompt,
      );
      assert.deepEqual(current.request.messages, legacy.request.messages);
      assert.equal(current.request.settings.maxTokens, legacy.request.settings.maxTokens);
      assert.equal(
        buildRunwarePromptRequest(batch, batch.scenes, attempt, lineage, 1, policy).requestBytes,
        current.requestBytes,
      );
    }
  }
  const batch = makeBatch(2);
  const legacyGoldens = [
    [
      "legacy",
      "runware-gemini-3.5-flash-prompt-request-v24",
      "a3eef738-0ea8-40a4-8f2f-d6c6cac4a42b",
      "sha256:e5bff7f222239c20723898b7c77b4e20672507ec94dd570b3a2638c92db19dea",
    ],
    [
      "physical-placement-v1",
      "runware-gemini-3.5-flash-prompt-request-v26",
      "43e3ed9e-0d89-48a8-979b-ee2082ec77f5",
      "sha256:a61ebfdaf636068e26c9354c635765d32e3cfb42f08f61149183ff4d89be5e8f",
    ],
    [
      "physical-placement-v2",
      "runware-gemini-3.5-flash-prompt-request-v27",
      "2885353b-f0b4-4927-a5d5-3bbf3665507e",
      "sha256:702e1e3617ee5bb792791e74034cc50c3202aa1fbc727cdfb39bd24d9042e7a6",
    ],
    [
      "no-graphics-v1",
      "runware-gemini-3.5-flash-prompt-request-v28",
      "a10d3255-2e24-40bf-b85d-c7f424c2687f",
      "sha256:9b92bfda031a02d95aebc5241a4c7031eedbf120440c7053f7f01dc4c11b7ef3",
    ],
    [
      "no-graphics-v2",
      "runware-gemini-3.5-flash-prompt-request-v29",
      "b15bbd4e-7edd-48ed-99b0-f7add6cb973f",
      "sha256:ed156166e611b930307b006a7487e69d2321ea6cfbfce2948a93194e623e76a2",
    ],
    [
      "no-graphics-async-v1",
      "runware-gemini-3.5-flash-prompt-request-v30",
      "83f4c79c-f03a-406a-8f5b-43b4597b872e",
      "sha256:f882a6c9a119ec1850d311be9d08c6ddb0dc8ff1a2c7b6be79ca5a3bf8e95083",
    ],
    [
      "validated-scenes-v1",
      "runware-gemini-3.5-flash-prompt-request-v31",
      "4fbefd98-4bae-4c82-accd-0bce03531805",
      "sha256:0de063a135255aa43e5093f8330b3b26a06dc9306f996a97adf8269e470d1c59",
    ],
    [
      "grounded-scenes-v1",
      "runware-gemini-3.5-flash-prompt-request-v32",
      "97818803-df60-43fb-84e5-e1181443db4e",
      "sha256:8fef433cfebfea85d2e7c336ff619d354dc1083fb31c2fd15307e3a20733e4f3",
    ],
  ];
  for (const [policy, version, taskUUID, requestSha256] of legacyGoldens) {
    const request = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, policy);
    assert.equal(request.requestVersion, version);
    assert.equal(request.request.taskUUID, taskUUID);
    assert.equal(request.requestSha256, requestSha256);
  }
});

test("fresh Runware Luna request has its own strict schema, identity, and ten-scene token budget", () => {
  const batch = { ...makeBatch(10), literalCharacterLimit: 168 };
  const request = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  assert.equal(request.requestVersion, "runware-gpt-6-luna-prompt-request-v38");
  assert.equal(request.request.taskUUID, "af353312-8262-4a5c-a48e-98e4a65f8d3d");
  assert.equal(
    request.requestSha256,
    "sha256:d3a18d315381426d2a16dc4bdaebcab509aec0b663ce239015cc4887b79b92b1",
  );
  const schema = request.request.jsonSchema.schema;
  const sceneSchema = schema.properties.scenes.items;
  assert.equal(request.request.model, RUNWARE_LUNA_PROMPT_MODEL);
  assert.equal(request.requestVersion, RUNWARE_LUNA_PROMPT_REQUEST_VERSION);
  assert.equal(request.request.settings.thinkingLevel, "low");
  assert.equal("temperature" in request.request.settings, false);
  assert.equal("topP" in request.request.settings, false);
  assert.equal(request.request.settings.maxTokens, RUNWARE_LUNA_PROMPT_MAX_OUTPUT_TOKENS);
  assert.equal(request.request.deliveryMethod, "async");
  assert.match(request.request.settings.systemPrompt, /within 100 characters total/u);
  assert.match(request.request.settings.systemPrompt, /2–4-word place/u);
  assert.match(request.request.settings.systemPrompt, /connected arm\(s\) once/u);
  assert.match(
    request.request.settings.systemPrompt,
    /Interpret each exact phrase with adjacent narration before selecting its visual anchor/u,
  );
  assert.match(
    request.request.settings.systemPrompt,
    /Within that scope, this interpretation overrides exact-phrase precedence and shot-role preference/u,
  );
  assert.doesNotMatch(
    request.request.settings.systemPrompt,
    /Local source precedence: exact_phrase > scene_phrase_context/u,
  );
  assert.equal(
    batch.literalCharacterLimit,
    168,
    "the compiler-owned expanded limit stays unchanged",
  );
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["batch_id", "scenes"]);
  assert.deepEqual(schema.properties.batch_id.enum, [batch.batchId]);
  assert.deepEqual(sceneSchema.required, [
    "scene_id",
    "literal_subject",
    "action",
    "environment",
    "in_image_shot_role",
    "lighting_context",
    "continuity_tags",
    "prompt_core",
  ]);
  assert.deepEqual(
    sceneSchema.properties.scene_id.enum,
    batch.scenes.map((scene) => scene.sceneId),
  );
  assert.deepEqual(
    Object.fromEntries(
      ["literal_subject", "action", "environment"].map((field) => [
        field,
        {
          minLength: sceneSchema.properties[field].minLength,
          hasMaxLength: "maxLength" in sceneSchema.properties[field],
        },
      ]),
    ),
    {
      literal_subject: { minLength: 1, hasMaxLength: false },
      action: { minLength: 1, hasMaxLength: false },
      environment: { minLength: 1, hasMaxLength: false },
    },
  );
  assert.ok(request.request.settings.maxTokens > 0);
  assert.equal("minItems" in schema.properties.scenes, false);
  assert.equal("maxItems" in sceneSchema.properties.continuity_tags, false);
  assert.equal(JSON.parse(request.requestBytes)[0].model, RUNWARE_LUNA_PROMPT_MODEL);
  const legacy = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "grounded-scenes-v1");
  assert.equal(legacy.request.model, RUNWARE_PROMPT_MODEL);
  assert.notEqual(request.request.taskUUID, legacy.request.taskUUID);
  assert.match(request.request.settings.systemPrompt, /Never depict a picture, photo, portrait/u);
  assert.match(
    request.request.settings.systemPrompt,
    /real person or portrait beside a product is allowed/u,
  );
});

test("Luna projects generic store/name-brand categories only when no physical mark is requested", () => {
  for (const [input, expected] of [
    ["Store-brand barbecue sauce bottles", "unmarked barbecue sauce bottles"],
    ["NAME BRAND sauce in a jar", "unmarked sauce in a jar"],
    ["Unmarked store brand bottles", "unmarked bottles"],
    ["Store-brand bottles with no printed name", "unmarked bottles"],
    ["Store-brand bottles with no label", "unmarked bottles"],
    ["Store-brand bottles with no logo", "unmarked bottles"],
  ]) {
    assert.equal(projectRunwareLunaPhysicalProductCategory(input), expected);
  }
  for (const input of [
    "Store-brand bottles with a printed logo",
    "Name-brand sauce jar marked with a logo",
    "Store-brand sauce bottles bearing a quoted word",
    "Store-brand jar reading 'Plain'",
    "Store-brand bottles with branding",
    "Store-brand bottles with a printed logo, but no later logo",
    "Store-brand bottle with a blank label",
    "Store-brand category is mentioned",
  ]) {
    assert.equal(projectRunwareLunaPhysicalProductCategory(input), input);
  }
  assert.equal(
    projectRunwareLunaPhysicalProductCategory("Store-brand bottles with a printed name, no label"),
    "Store-brand bottles with a printed name",
  );
  assert.match(RUNWARE_LUNA_UNMARKED_PRODUCT_INSTRUCTION, /even when narration describes it/u);
});

test("v41 constrains exact original and corrective scene counts without changing v40 bytes", () => {
  const base = makeBatch(10);
  const batch = {
    ...base,
    literalCharacterLimits: Object.fromEntries(base.scenes.map((scene) => [scene.sceneId, 300])),
  };
  const old = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v3",
  );
  const fresh = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v4",
  );
  assert.equal(fresh.requestVersion, "runware-gpt-6-luna-prompt-request-v41");
  assert.notEqual(fresh.request.taskUUID, old.request.taskUUID);
  assert.deepEqual(fresh.request.settings, old.request.settings);
  assert.deepEqual(fresh.request.messages, old.request.messages);
  assert.equal(fresh.request.model, old.request.model);
  const schema = fresh.request.jsonSchema.schema.properties.scenes;
  assert.equal(schema.minItems, 10);
  assert.equal(schema.maxItems, 10);
  assert.equal(old.request.jsonSchema.schema.properties.scenes.minItems, undefined);
  const source = output(fresh, {
    change: (rows) =>
      rows.map((row, index) =>
        index === 3 ? { ...row, literal_subject: "A visible caption." } : row,
      ),
  });
  const correction = buildRunwarePromptCorrection(batch, source, "runware-luna-grounded-v4");
  assert.deepEqual(correction.failedSceneIds, [batch.scenes[3].sceneId]);
  const retry = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    2,
    fresh.requestSha256,
    1,
    "runware-luna-grounded-v4",
    false,
    correction,
  );
  const retrySchema = retry.request.jsonSchema.schema.properties.scenes;
  assert.equal(retrySchema.minItems, 1);
  assert.equal(retrySchema.maxItems, 1);
  assert.deepEqual(retrySchema.items.properties.scene_id.enum, correction.failedSceneIds);
  assert.deepEqual(
    buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "runware-luna-grounded-v3"),
    old,
  );
});

test("v40 replaces caption-like action guidance without increasing requests or changing sealed v39", () => {
  const base = makeBatch(10);
  const batch = {
    ...base,
    literalCharacterLimits: Object.fromEntries(base.scenes.map((scene) => [scene.sceneId, 174])),
  };
  const legacy = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v2",
  );
  assert.equal(legacy.request.taskUUID, "32de5cd1-f456-4624-ae5e-f076fd35e87c");
  assert.equal(
    legacy.requestSha256,
    "sha256:0308eff41e336891949e78eef1bcbb6fc323aa64081042ee22650979be9ac8b4",
  );
  const fresh = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v3",
  );
  assert.equal(fresh.requestVersion, "runware-gpt-6-luna-prompt-request-v40");
  assert.notEqual(fresh.request.taskUUID, legacy.request.taskUUID);
  assert.equal(fresh.request.model, legacy.request.model);
  assert.equal(fresh.request.settings.maxTokens, legacy.request.settings.maxTokens);
  assert.equal(fresh.request.settings.thinkingLevel, legacy.request.settings.thinkingLevel);
  assert.deepEqual(fresh.request.jsonSchema, legacy.request.jsonSchema);
  assert.deepEqual(fresh.request.messages, legacy.request.messages);
  assert.equal(fresh.request.deliveryMethod, legacy.request.deliveryMethod);
  assert.ok(
    fresh.request.settings.systemPrompt.length < legacy.request.settings.systemPrompt.length,
  );
  assert.match(
    fresh.request.settings.systemPrompt,
    /visible posture, contact or physical condition/u,
  );
  assert.match(
    fresh.request.settings.systemPrompt,
    /never a headline, slogan, summary or quoted narration/u,
  );
  assert.doesNotMatch(fresh.request.settings.systemPrompt, /complete standalone description/u);
  assert.doesNotMatch(
    fresh.request.settings.systemPrompt,
    /Offers short-term assistance|Is partly cleared for redevelopment/u,
  );
  for (const term of [
    "pseudo-text",
    "captions",
    "logos",
    "watermarks",
    "overlays",
    "motion graphics",
    "source-supported",
    "800 characters",
  ])
    assert.ok(fresh.request.settings.systemPrompt.includes(term), term);
  assert.deepEqual(
    buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "runware-luna-grounded-v2"),
    legacy,
  );
});

for (const policy of ["runware-luna-grounded-v2", "runware-luna-grounded-v3"]) {
  test(`Luna ${policy} accepts the reproducible 174-character scene at its exact cap and rejects an absent or tight cap`, async () => {
    const phrase = "Hands demonstrate irrigation valve step 1.";
    const base = withScenePhrase(makeBatch(1), phrase);
    const literals = {
      literal_subject: phrase,
      action: "The hands demonstrate the irrigation valve.",
      environment:
        "The valve rests on dry farm soil beside a water channel in the open field during the day.",
    };
    assert.equal(
      literals.literal_subject.length + literals.action.length + literals.environment.length,
      174,
    );
    const run = async (literalCharacterLimits) => {
      const batch = { ...base, literalCharacterLimits };
      const transport = new ScriptedTransport([
        (request) =>
          success(request, {
            change: (rows) => [
              {
                ...rows[0],
                ...literals,
                prompt_core:
                  "Hands demonstrate the irrigation valve on dry farm soil beside a water channel.",
              },
            ],
          }),
      ]);
      const writer = new RunwarePromptWriter({
        requestPolicy: policy,
        semanticQualityMode: "advisory",
        allowPartialRetry: false,
        transport,
        evidenceSink: { record() {} },
        maximumBatchCostUsd: 0.01,
      });
      return { result: await writer.write(batch), transport };
    };

    const { result, transport } = await run({ [base.scenes[0].sceneId]: 174 });
    assert.equal(transport.requests.length, 1);
    assert.equal(result.scenes[0].literal_subject, phrase);

    await expectInvalid(() => run({ [base.scenes[0].sceneId]: 173 }));
    await expectInvalid(() => run({}));
  });
}

test("Luna accepts generic store-brand category without depicting a product mark", async () => {
  const batch = withScenePhrase(
    makeBatch(1),
    "A shopper is holding a store-brand barbecue sauce bottle.",
  );
  const transport = new ScriptedTransport([
    (request) =>
      success(request, {
        change: (rows) => [
          {
            ...rows[0],
            literal_subject: "Store-brand barbecue sauce bottle",
            action: "A shopper holds the sauce bottle",
            environment: "Grocery aisle beside the sauce shelf",
            prompt_core:
              "A shopper holds an unmarked barbecue sauce bottle beside the grocery shelf.",
          },
        ],
      }),
  ]);
  const writer = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    transport,
    evidenceSink: { record() {} },
    maximumBatchCostUsd: 0.01,
  });
  const result = await writer.write(batch);
  assert.equal(transport.requests.length, 1);
  assert.equal(result.scenes[0].literal_subject, "unmarked barbecue sauce bottle.");
});

test("Luna rejects a bare state action that invents an unsupported same-container companion", async () => {
  const phrase = "A plain, unmarked barbecue sauce bottle beside a grocery register.";
  const batch = withScenePhrase(makeBatch(1), phrase);
  const request = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const source = output(request, {
    change: (rows) => [
      {
        ...rows[0],
        literal_subject: phrase,
        action: "Rests beside a barbecue sauce bottle.",
        environment: "Grocery checkout counter.",
        prompt_core: "A plain, unmarked barbecue sauce bottle rests beside a grocery register.",
      },
    ],
  });
  const correction = buildRunwarePromptCorrection(batch, source, "runware-luna-grounded-v1");
  assert.deepEqual(correction.failedSceneIds, [batch.scenes[0].sceneId]);
  assert.ok(
    correction.failures.some(
      (failure) =>
        failure.sceneId === batch.scenes[0].sceneId &&
        failure.field === "action" &&
        failure.reason === "required_fact_invalid",
    ),
  );

  const evidence = [];
  const writer = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    semanticQualityMode: "advisory",
    transport: new ScriptedTransport([(attempt) => success(attempt, { outputText: source })]),
    evidenceSink: {
      record(value) {
        evidence.push(value);
      },
    },
    maximumBatchCostUsd: 0.01,
  });
  await expectInvalid(() => writer.write(batch));
  assert.equal(evidence[0].validationDiagnostic.category, "scene_quality");
});

test("Luna rejects an explicit container actor beside an unsupported same-kind companion", () => {
  const batch = withScenePhrase(
    makeBatch(1),
    "A plain, unmarked barbecue sauce bottle beside a grocery register.",
  );
  const request = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const source = output(request, {
    change: (rows) => [
      {
        ...rows[0],
        literal_subject: "A plain, unmarked barbecue sauce bottle beside the register.",
        action: "The bottle rests beside another barbecue sauce bottle.",
        environment: "Grocery checkout counter.",
        prompt_core: "A plain, unmarked barbecue sauce bottle rests beside another bottle.",
      },
    ],
  });
  const correction = buildRunwarePromptCorrection(batch, source, "runware-luna-grounded-v1");
  assert.deepEqual(correction.failedSceneIds, [batch.scenes[0].sceneId]);
  assert.ok(
    correction.failures.some(
      (failure) => failure.field === "action" && failure.reason === "required_fact_invalid",
    ),
  );
});

test("Luna rejects an unsupported scanner companion without container-name special cases", () => {
  const phrase = "An idle grocery checkout scanner beside the counter.";
  const batch = withScenePhrase(makeBatch(1), phrase);
  const request = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const source = output(request, {
    change: (rows) => [
      {
        ...rows[0],
        literal_subject: phrase,
        action: "Rests beside the checkout scanner.",
        environment: "Grocery checkout counter.",
        prompt_core: "An idle grocery checkout scanner rests beside the checkout scanner.",
      },
    ],
  });
  const correction = buildRunwarePromptCorrection(batch, source, "runware-luna-grounded-v1");
  assert.deepEqual(correction.failedSceneIds, [batch.scenes[0].sceneId]);
  assert.ok(
    correction.failures.some(
      (failure) => failure.field === "action" && failure.reason === "required_fact_invalid",
    ),
  );
});

test("Luna still checks a scanner-led scene when a cashier is also present", () => {
  const phrase = "An idle grocery checkout scanner beside the cashier.";
  const batch = withScenePhrase(makeBatch(1), phrase);
  const request = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const source = output(request, {
    change: (rows) => [
      {
        ...rows[0],
        literal_subject: phrase,
        action: "Rests beside the checkout scanner.",
        environment: "A cashier stands at the register.",
        prompt_core: "An idle grocery checkout scanner rests beside the checkout scanner.",
      },
    ],
  });
  const correction = buildRunwarePromptCorrection(batch, source, "runware-luna-grounded-v1");
  assert.deepEqual(correction.failedSceneIds, [batch.scenes[0].sceneId]);
  assert.ok(
    correction.failures.some(
      (failure) => failure.field === "action" && failure.reason === "required_fact_invalid",
    ),
  );
});

test("Luna allows source-supported container pairs and real people beside one product", async () => {
  const cases = [
    {
      phrase: "Two barbecue sauce bottles sit beside a grocery register.",
      subject: "Two plain barbecue sauce bottles beside a grocery register.",
      action: "Sits beside another barbecue sauce bottle.",
      environment: "Grocery checkout counter.",
      core: "Two plain barbecue sauce bottles rest beside a grocery register.",
    },
    {
      phrase: "Two grocery checkout scanners sit beside the counter.",
      subject: "Two idle grocery checkout scanners beside the counter.",
      action: "One scanner sits beside another checkout scanner.",
      environment: "Grocery checkout counter.",
      core: "Two idle grocery checkout scanners sit beside the checkout counter.",
    },
    {
      phrase: "A shopper stands beside a barbecue sauce bottle at checkout.",
      subject: "A shopper beside a plain barbecue sauce bottle.",
      action: "A shopper stands beside the sauce bottle.",
      environment: "Grocery checkout counter.",
      core: "A shopper stands beside a plain barbecue sauce bottle.",
    },
  ];
  for (const item of cases) {
    const batch = withScenePhrase(makeBatch(1), item.phrase);
    const request = buildRunwarePromptRequest(
      batch,
      batch.scenes,
      1,
      null,
      1,
      "runware-luna-grounded-v1",
    );
    const candidate = output(request, {
      change: (rows) => [
        {
          ...rows[0],
          literal_subject: item.subject,
          action: item.action,
          environment: item.environment,
          prompt_core: item.core,
        },
      ],
    });
    assert.equal(
      buildRunwarePromptCorrection(batch, candidate, "runware-luna-grounded-v1"),
      null,
      `supported pair should not need correction: ${item.phrase}`,
    );
    const transport = new ScriptedTransport([
      (request) => success(request, { outputText: candidate }),
    ]);
    const writer = new RunwarePromptWriter({
      requestPolicy: "runware-luna-grounded-v1",
      transport,
      evidenceSink: { record() {} },
      maximumBatchCostUsd: 0.01,
    });
    const result = await writer.write(batch);
    assert.equal(transport.requests.length, 1);
    assert.equal(result.scenes.length, 1);
  }
});

test("Luna allows a register-led subject with one bottle in its adjacent relation", async () => {
  const phrase = "A grocery register beside an unmarked sauce bottle.";
  const batch = withScenePhrase(makeBatch(1), phrase);
  const transport = new ScriptedTransport([
    (request) =>
      success(request, {
        change: (rows) => [
          {
            ...rows[0],
            literal_subject: phrase,
            action: "The register rests beside a barbecue sauce bottle.",
            environment: "Grocery checkout counter.",
            prompt_core: "A grocery register beside an unmarked barbecue sauce bottle.",
          },
        ],
      }),
  ]);
  const writer = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    transport,
    evidenceSink: { record() {} },
    maximumBatchCostUsd: 0.01,
  });
  const result = await writer.write(batch);
  assert.equal(transport.requests.length, 1);
  assert.equal(result.scenes.length, 1);
});

test("Luna never lets later negation erase an earlier printed name, label, or logo request", () => {
  const batch = withScenePhrase(
    makeBatch(1),
    "A shopper is holding a store-brand barbecue sauce bottle.",
  );
  const cases = [
    "Store-brand barbecue sauce bottle with a printed name, no printed name",
    "Name-brand barbecue sauce bottle with a logo, no logo",
    "Store-brand barbecue sauce bottle with a label, no label",
  ];
  for (const literal_subject of cases) {
    const request = buildRunwarePromptRequest(
      batch,
      batch.scenes,
      1,
      null,
      1,
      "runware-luna-grounded-v1",
    );
    const source = output(request, {
      change: (rows) => [
        {
          ...rows[0],
          literal_subject,
          action: "A shopper holds the sauce bottle",
          environment: "Grocery aisle beside the shelf",
          prompt_core:
            "A shopper holds an unmarked barbecue sauce bottle beside the grocery shelf.",
        },
      ],
    });
    const correction = buildRunwarePromptCorrection(batch, source, "runware-luna-grounded-v1");
    assert.deepEqual(correction.failedSceneIds, [batch.scenes[0].sceneId]);
    assert.ok(
      correction.failures.some(
        (failure) =>
          failure.sceneId === batch.scenes[0].sceneId &&
          failure.field === "literal_subject" &&
          failure.reason === "hard_conflict",
      ),
    );
  }
});

test("Luna rejects package imagery that conflicts with the unmarked-product policy", async () => {
  const cases = [
    {
      phrase: "A golden honey barbecue bottle has a honeycomb picture on its front.",
      subject: "Large golden barbecue sauce bottle",
      action: "Bottle front shows honey-themed picture",
      environment: "Grocery shelf with sauce bottles",
      failingField: "action",
    },
    {
      phrase: "A barbecue bottle has oversized honey imagery on the front.",
      subject: "Golden barbecue sauce bottle on shelf",
      action: "Bottle front has oversized honey imagery",
      environment: "Grocery shelf beside other bottles",
      failingField: "action",
    },
    {
      phrase: "A honey barbecue sauce bottle shows a bee image on its front.",
      subject: "Golden barbecue sauce bottle on shelf",
      action: "Front shows a honeycomb picture",
      environment: "Grocery shelf beside other bottles",
      failingField: "action",
    },
    {
      phrase: "Marlene examines sauce bottles bearing celebrity faces and imagery.",
      subject: "Marlene chest-up examining sauce bottles with depicted celebrity faces",
      action: "Marlene examines bottles with celebrity imagery",
      environment: "Grocery aisle beside the sauce shelf",
      failingField: "literal_subject",
    },
    {
      phrase: "A sauce bottle has a picture on its front.",
      subject: "Sauce bottle front",
      action: "Shows honey-themed picture",
      environment: "Grocery shelf beside other bottles",
      failingField: "action",
    },
  ];
  for (const item of cases) {
    const batch = withScenePhrase(makeBatch(1), item.phrase);
    const request = buildRunwarePromptRequest(
      batch,
      batch.scenes,
      1,
      null,
      1,
      "runware-luna-grounded-v1",
    );
    const source = output(request, {
      change: (rows) => [
        {
          ...rows[0],
          literal_subject: item.subject,
          action: item.action,
          environment: item.environment,
          prompt_core: `${item.subject}; ${item.action}; ${item.environment}`,
        },
      ],
    });
    const correction = buildRunwarePromptCorrection(batch, source, "runware-luna-grounded-v1");
    assert.deepEqual(correction.failedSceneIds, [batch.scenes[0].sceneId]);
    assert.ok(
      correction.failures.some(
        (failure) =>
          failure.sceneId === batch.scenes[0].sceneId &&
          failure.field === item.failingField &&
          failure.reason === "hard_conflict",
      ),
      `${item.failingField} should carry a hard-conflict diagnostic`,
    );
    const evidence = [];
    const writer = new RunwarePromptWriter({
      requestPolicy: "runware-luna-grounded-v1",
      transport: new ScriptedTransport([(attempt) => success(attempt, { outputText: source })]),
      evidenceSink: {
        record(value) {
          evidence.push(value);
        },
      },
      maximumBatchCostUsd: 0.01,
    });
    await expectInvalid(() => writer.write(batch));
    assert.equal(evidence[0].validationDiagnostic.category, "scene_quality");
  }
});

test("Luna permits a real face and portrait beside products without surface imagery", async () => {
  const batch = withScenePhrase(
    makeBatch(1),
    "Marlene is examining barbecue sauce bottles in the grocery aisle.",
  );
  const transport = new ScriptedTransport([
    (request) =>
      success(request, {
        change: (rows) => [
          {
            ...rows[0],
            literal_subject: "Documentary portrait of Marlene beside plain sauce bottles",
            action: "Marlene examines the sauce bottles",
            environment: "Grocery aisle beside the shelf",
            prompt_core:
              "A documentary portrait of Marlene as she examines plain barbecue sauce bottles.",
          },
        ],
      }),
  ]);
  const writer = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    semanticQualityMode: "advisory",
    transport,
    evidenceSink: { record() {} },
    maximumBatchCostUsd: 0.01,
  });
  const result = await writer.write(batch);
  assert.equal(
    result.scenes[0].literal_subject,
    "Documentary portrait of Marlene beside plain sauce bottles.",
  );

  const separatedPortraitBatch = withScenePhrase(
    makeBatch(1),
    "Marlene poses in a documentary portrait beside the barbecue sauce display.",
  );
  const separatedPortraitTransport = new ScriptedTransport([
    (request) =>
      success(request, {
        change: (rows) => [
          {
            ...rows[0],
            literal_subject: "Plain sauce bottles in front of Marlene",
            action: "Marlene watches the grocery shelf",
            environment: "Documentary portrait shows Marlene in the aisle",
            prompt_core: "Marlene watches plain sauce bottles from the grocery aisle.",
          },
        ],
      }),
  ]);
  const separatedPortraitWriter = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    semanticQualityMode: "advisory",
    transport: separatedPortraitTransport,
    evidenceSink: { record() {} },
    maximumBatchCostUsd: 0.01,
  });
  const separatedPortraitResult = await separatedPortraitWriter.write(separatedPortraitBatch);
  assert.match(separatedPortraitResult.scenes[0].environment, /portrait shows Marlene/u);
});

test("Luna rejects picture-complement continuation transfer but allows an independent physical correction", async () => {
  const base = withScenePhrase(
    makeBatch(1),
    "smoke curling up off a rack of ribs. You would think that sauce spent hours next to a fire somewhere in Texas.",
  );
  const batch = {
    ...base,
    scenes: Object.freeze(
      base.scenes.map((scene) =>
        Object.freeze({
          ...scene,
          priorContext:
            "Pit smoked. There is a picture of a big black smoker, maybe a little wisp of",
          nextContext: "Texas. Turn it around, read the ingredients and way down near the bottom",
        }),
      ),
    ),
  };
  const request = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  assert.match(
    request.request.settings.systemPrompt,
    /Omit the content of depictions and conjectural product claims entirely/u,
  );
  assert.match(
    request.request.settings.systemPrompt,
    /When an exact phrase completes an adjacent depiction, or states a denial or conjecture, the contextual interpretation outranks exact-phrase anchoring and shot-role preference/u,
  );
  assert.match(
    request.request.settings.systemPrompt,
    /A locally named real product\/object may be used when nearby narration establishes it as physical and scoped continuity resolves its identity/u,
  );
  const picturedOutput = output(request, {
    change: (rows) => [
      {
        ...rows[0],
        literal_subject: "Rack of ribs with a wisp of smoke",
        action: "Smoke curls above ribs on a rack",
        environment: "Ribs on a rack beside an outdoor fire",
        prompt_core: "A small wisp of smoke curls above ribs on a rack beside an outdoor fire.",
      },
    ],
  });
  const correction = buildRunwarePromptCorrection(
    batch,
    picturedOutput,
    "runware-luna-grounded-v1",
  );
  assert.deepEqual(correction.failedSceneIds, [batch.scenes[0].sceneId]);
  assert.ok(
    correction.failures.some(
      (failure) => failure.field === "scene" && failure.reason === "depiction_transfer",
    ),
  );
  const invalidWriter = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    semanticQualityMode: "advisory",
    transport: new ScriptedTransport([
      (attempt) => success(attempt, { outputText: picturedOutput }),
    ]),
    evidenceSink: { record() {} },
    maximumBatchCostUsd: 0.01,
  });
  await expectInvalid(() => invalidWriter.write(batch));

  const absenceRequest = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const absenceOnlyOutput = output(absenceRequest, {
    change: (rows) => [
      {
        ...rows[0],
        literal_subject: "Plain barbecue sauce bottle without a smoker scene",
        action: "No real ribs or fire are present",
        environment: "The imagined smoker scene remains only a blank",
        prompt_core: "A plain barbecue sauce bottle rests on a grocery shelf.",
      },
    ],
  });
  const absenceCorrection = buildRunwarePromptCorrection(
    batch,
    absenceOnlyOutput,
    "runware-luna-grounded-v1",
  );
  assert.ok(absenceCorrection);
  assert.ok(
    absenceCorrection.failures.some(
      (failure) => failure.field === "action" && failure.reason === "required_fact_invalid",
    ),
  );
  assert.ok(
    absenceCorrection.failures.some(
      (failure) => failure.field === "environment" && failure.reason === "required_fact_invalid",
    ),
  );
  assert.equal(
    absenceCorrection.failures.some((failure) => failure.reason === "depiction_transfer"),
    false,
  );

  const replacement = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    2,
    request.requestSha256,
    1,
    "runware-luna-grounded-v1",
    false,
    correction,
  );
  assert.match(
    replacement.request.settings.systemPrompt,
    /For a depiction_transfer correction, do not reuse concepts from that pictured, denied or conjectural content as physical facts in any field/u,
  );
  assert.match(
    replacement.request.settings.systemPrompt,
    /replace the failed scene with an independently factual local or adjacent physical anchor/u,
  );
  const bottleImageOutput = output(replacement, {
    change: (rows) => [
      {
        ...rows[0],
        literal_subject: "A sauce bottle with depicted ribs and smoke",
        action: "Smoke curls over a rack of ribs",
        environment: "A bottle with an unmarked surface",
        prompt_core: "A sauce bottle with depicted ribs and smoke sits on a shelf.",
      },
    ],
  });
  const bottleImageCorrection = buildRunwarePromptCorrection(
    batch,
    bottleImageOutput,
    "runware-luna-grounded-v1",
  );
  assert.ok(bottleImageCorrection);
  assert.ok(
    bottleImageCorrection.failures.some(
      (failure) => failure.field === "literal_subject" && failure.reason === "hard_conflict",
    ),
  );
  const bottleCorrection = output(replacement, {
    change: (rows) => [
      {
        ...rows[0],
        literal_subject: "Unmarked barbecue sauce bottle",
        action: "A shopper studies the sauce bottle",
        environment: "Grocery aisle beside the sauce shelf",
        prompt_core: "A shopper studies an unmarked barbecue sauce bottle in a grocery aisle.",
      },
    ],
  });
  const validCorrection = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    semanticQualityMode: "advisory",
    correction,
    transport: new ScriptedTransport([
      (attempt) => success(attempt, { outputText: bottleCorrection }),
    ]),
    evidenceSink: { record() {} },
    maximumBatchCostUsd: 0.01,
  });
  const corrected = await validCorrection.write(batch, request.requestSha256);
  assert.equal(corrected.scenes[0].literal_subject, "Unmarked barbecue sauce bottle.");
});

test("Luna keeps positively narrated cooking and fire physical when no depiction continuation exists", async () => {
  const batch = withScenePhrase(
    makeBatch(1),
    "Ribs cook over an actual fire as smoke rises from the rack.",
  );
  const transport = new ScriptedTransport([
    (request) =>
      success(request, {
        change: (rows) => [
          {
            ...rows[0],
            literal_subject: "Ribs over an active cooking fire",
            action: "Ribs cook over the open fire",
            environment: "Outdoor grill beside a steady flame",
            prompt_core: "Ribs cook over an open fire at an outdoor grill.",
          },
        ],
      }),
  ]);
  const writer = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    semanticQualityMode: "advisory",
    transport,
    evidenceSink: { record() {} },
    maximumBatchCostUsd: 0.01,
  });
  const result = await writer.write(batch);
  assert.match(result.scenes[0].action, /cook over the open fire/u);

  const photographerBatch = withScenePhrase(
    makeBatch(1),
    "A photographer documents a cook tending ribs beside a sauce bottle.",
  );
  const photographerWriter = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    semanticQualityMode: "advisory",
    transport: new ScriptedTransport([
      (request) =>
        success(request, {
          change: (rows) => [
            {
              ...rows[0],
              literal_subject: "Photographer beside a cook and sauce bottle",
              action: "Photographer documents the cook tending ribs",
              environment: "Kitchen prep area beside the open grill",
              prompt_core:
                "A photographer documents a cook tending ribs beside a sauce bottle near an open grill.",
            },
          ],
        }),
    ]),
    evidenceSink: { record() {} },
    maximumBatchCostUsd: 0.01,
  });
  const photographerResult = await photographerWriter.write(photographerBatch);
  assert.match(photographerResult.scenes[0].literal_subject, /Photographer/u);
});

test("Luna rejects incomplete capped fields and saved product, negation, and checkout misreads", async () => {
  const schemaBatch = withScenePhrase(makeBatch(1), "A barbecue sauce bottle rests on a shelf.");
  const request = buildRunwarePromptRequest(
    schemaBatch,
    schemaBatch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const rawRows = payload(request).scenes.map((scene) => ({
    scene_id: scene.scene_id,
    literal_subject: "A sauce bottle",
    action: "Rests on a shelf",
    environment: "Grocery aisle",
    in_image_shot_role: scene.in_image_shot_role,
    lighting_context: "daylight",
    continuity_tags: [],
    prompt_core: "A sauce bottle rests on a grocery shelf.",
  }));
  rawRows[0].literal_subject = "A large barbecue sauce bottle with a printed smoker illustration";
  const capCut = JSON.stringify({ batch_id: schemaBatch.batchId, scenes: rawRows });
  const correction = buildRunwarePromptCorrection(schemaBatch, capCut, "runware-luna-grounded-v1");
  assert.ok(correction);
  assert.ok(correction.failures.some((failure) => failure.reason === "hard_conflict"));

  const incompleteRows = rawRows.map((row) => ({
    ...row,
    literal_subject: "A large barbecue sauce b",
    action: "Rests on a shelf",
    environment: "Grocery aisle",
  }));
  const incomplete = buildRunwarePromptCorrection(
    schemaBatch,
    JSON.stringify({ batch_id: schemaBatch.batchId, scenes: incompleteRows }),
    "runware-luna-grounded-v1",
  );
  assert.ok(incomplete);
  assert.ok(incomplete.failures.some((failure) => failure.field === "literal_subject"));

  const negativeScene = withScenePhrase(
    makeBatch(1),
    "never saw smoke. Hickory smoked barbecue sauce carries the name itself.",
  );
  const negativeRequest = buildRunwarePromptRequest(
    negativeScene,
    negativeScene.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const promoted = output(negativeRequest, {
    change: (rows) => [
      {
        ...rows[0],
        literal_subject: "Rack of ribs over a grill",
        action: "Ribs cook over the fire",
        environment: "Outdoor cooking area",
        prompt_core: "Ribs cook over a fire at an outdoor grill.",
      },
    ],
  });
  const promotedCorrection = buildRunwarePromptCorrection(
    negativeScene,
    promoted,
    "runware-luna-grounded-v1",
  );
  assert.ok(
    promotedCorrection?.failures.some((failure) => failure.reason === "depiction_transfer"),
  );

  const imageScene = withScenePhrase(makeBatch(1), "A plain sauce bottle stands on a table.");
  const imageRequest = buildRunwarePromptRequest(
    imageScene,
    imageScene.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const bearsImage = output(imageRequest, {
    change: (rows) => [
      {
        ...rows[0],
        literal_subject: "Unmarked barbecue sauce bottle",
        action: "A bottle bears a smoker illustration",
        environment: "Close view of bottle surface",
      },
    ],
  });
  const imageCorrection = buildRunwarePromptCorrection(
    imageScene,
    bearsImage,
    "runware-luna-grounded-v1",
  );
  assert.ok(imageCorrection?.failures.some((failure) => failure.reason === "hard_conflict"));

  const checkout = withScenePhrase(
    makeBatch(1),
    "At checkout, I put my belt on the conveyor beside the sauce bottle.",
  );
  const checkoutRequest = buildRunwarePromptRequest(
    checkout,
    checkout.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const clothingBelt = output(checkoutRequest, {
    change: (rows) => [
      {
        ...rows[0],
        literal_subject: "A leather belt around a cashier's waist",
        action: "The cashier wears a belt",
        environment: "At a grocery checkout register",
      },
    ],
  });
  const beltCorrection = buildRunwarePromptCorrection(
    checkout,
    clothingBelt,
    "runware-luna-grounded-v1",
  );
  assert.ok(beltCorrection?.failures.some((failure) => failure.reason === "required_fact_invalid"));
});

test("Luna completeness allows a finished phrasal verb but rejects an unfinished preposition", async () => {
  const batch = withScenePhrase(makeBatch(1), "Marlene turns the sauce bottle around.");
  const accepted = output(
    buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "runware-luna-grounded-v1"),
    {
      change: (rows) => [
        {
          ...rows[0],
          literal_subject: "Marlene beside the sauce bottle",
          action: "Marlene turns the sauce bottle around",
          environment: "A grocery aisle",
          prompt_core: "Marlene turns the sauce bottle around in a grocery aisle.",
        },
      ],
    },
  );
  const writer = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    semanticQualityMode: "advisory",
    transport: new ScriptedTransport([(request) => success(request, { outputText: accepted })]),
    evidenceSink: { record() {} },
    maximumBatchCostUsd: 0.01,
  });
  const result = await writer.write(batch);
  assert.equal(result.scenes[0].action, "Marlene turns the sauce bottle around.");

  const unfinishedRequest = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const unfinishedRows = payload(unfinishedRequest).scenes.map((scene) => ({
    scene_id: scene.scene_id,
    literal_subject: "A sauce bottle seen from",
    action: "Rests on a shelf",
    environment: "A grocery aisle",
    in_image_shot_role: scene.in_image_shot_role,
    lighting_context: "daylight",
    continuity_tags: [],
    prompt_core: "A sauce bottle rests on a grocery shelf.",
  }));
  const correction = buildRunwarePromptCorrection(
    batch,
    JSON.stringify({ batch_id: batch.batchId, scenes: unfinishedRows }),
    "runware-luna-grounded-v1",
  );
  assert.ok(
    correction?.failures.some(
      (failure) =>
        failure.field === "literal_subject" && failure.reason === "required_fact_invalid",
    ),
  );

  for (const sample of [
    {
      phrase: "Marlene holds the sauce bottle before her at checkout.",
      subject: "Marlene beside a sauce bottle",
      action: "Marlene holds the sauce bottle before her",
      environment: "Grocery checkout, viewed from beside her",
    },
    {
      phrase: "Marlene says the bottle is his at checkout.",
      subject: "Marlene beside a sauce bottle",
      action: "The sauce bottle is his",
      environment: "Grocery checkout interior",
    },
    {
      phrase: "She turns the bottle over on the grocery counter.",
      subject: "A shopper beside the bottle",
      action: "She turns the bottle over",
      environment: "Grocery counter",
    },
    {
      phrase: "A shopper walks by the sauce bottles in the aisle.",
      subject: "A shopper beside the sauce bottles",
      action: "A shopper walks by",
      environment: "Grocery aisle",
    },
    {
      phrase: "The lamp is on above the grocery checkout.",
      subject: "A lamp above the checkout",
      action: "The lamp is on",
      environment: "Grocery checkout interior",
    },
    {
      phrase: "The bottle was taken from the cardboard box at checkout.",
      subject: "A sauce bottle at checkout",
      action: "The bottle rests on the counter",
      environment: "The box the bottle was taken from",
    },
  ]) {
    const pronounBatch = withScenePhrase(makeBatch(1), sample.phrase);
    const pronounOutput = output(
      buildRunwarePromptRequest(
        pronounBatch,
        pronounBatch.scenes,
        1,
        null,
        1,
        "runware-luna-grounded-v1",
      ),
      {
        change: (rows) => [
          {
            ...rows[0],
            literal_subject: sample.subject,
            action: sample.action,
            environment: sample.environment,
            prompt_core: "Marlene holds the sauce bottle at the grocery checkout.",
          },
        ],
      },
    );
    const pronounWriter = new RunwarePromptWriter({
      requestPolicy: "runware-luna-grounded-v1",
      semanticQualityMode: "advisory",
      transport: new ScriptedTransport([
        (request) => success(request, { outputText: pronounOutput }),
      ]),
      evidenceSink: { record() {} },
      maximumBatchCostUsd: 0.01,
    });
    await pronounWriter.write(pronounBatch);
  }
});

test("Luna accepts compact connected-person handling within the new raw target", async () => {
  const batch = {
    ...withScenePhrase(
      makeBatch(1),
      "Marlene slides a sauce bottle across the grocery checkout scanner.",
    ),
    literalCharacterLimit: 168,
  };
  const request = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const resultText = output(request, {
    change: (rows) => [
      {
        ...rows[0],
        literal_subject: "Marlene’s torso and connected arm.",
        action: "Slides sauce bottle.",
        environment: "Beside scanner, side view.",
        prompt_core: "Marlene slides a sauce bottle across a checkout scanner.",
      },
    ],
  });
  const literalTotal = (() => {
    const row = JSON.parse(resultText).scenes[0];
    return row.literal_subject.length + row.action.length + row.environment.length;
  })();
  assert.ok(literalTotal <= Math.floor(batch.literalCharacterLimit * 0.6));
  const writer = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    semanticQualityMode: "advisory",
    transport: new ScriptedTransport([(attempt) => success(attempt, { outputText: resultText })]),
    evidenceSink: { record() {} },
    maximumBatchCostUsd: 0.01,
  });
  const accepted = await writer.write(batch);
  assert.equal(accepted.scenes[0].literal_subject, "Marlene’s torso and connected arm.");
  assert.equal(accepted.scenes[0].environment, "Beside scanner, side view.");
});

test("Luna allows directly negated product imagery but never lets later negation erase a positive request", async () => {
  const negativeBatch = withScenePhrase(
    makeBatch(1),
    "A shopper is holding a plain barbecue sauce bottle without a picture.",
  );
  const negativeTransport = new ScriptedTransport([
    (request) =>
      success(request, {
        change: (rows) => [
          {
            ...rows[0],
            literal_subject: "A plain barbecue sauce bottle without a picture",
            action: "A shopper holds the bottle with no printed faces",
            environment: "Grocery aisle beside the shelf",
            prompt_core: "A shopper holds a plain unmarked sauce bottle in the grocery aisle.",
          },
        ],
      }),
  ]);
  const negativeWriter = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    semanticQualityMode: "advisory",
    transport: negativeTransport,
    evidenceSink: { record() {} },
    maximumBatchCostUsd: 0.01,
  });
  const negativeResult = await negativeWriter.write(negativeBatch);
  assert.equal(negativeResult.scenes[0].literal_subject, "A plain barbecue sauce bottle.");
  assert.equal(negativeResult.scenes[0].action, "A shopper holds the bottle.");

  const positiveBatch = withScenePhrase(
    makeBatch(1),
    "A sauce bottle shows a celebrity face on the front.",
  );
  const request = buildRunwarePromptRequest(
    positiveBatch,
    positiveBatch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const positiveOutput = output(request, {
    change: (rows) => [
      {
        ...rows[0],
        literal_subject: "A sauce bottle front with a celebrity face",
        action: "Bottle shows a celebrity face, but no printed imagery",
        environment: "Grocery shelf with sauce bottles",
        prompt_core: "An unmarked sauce bottle sits on the grocery shelf.",
      },
    ],
  });
  const correction = buildRunwarePromptCorrection(
    positiveBatch,
    positiveOutput,
    "runware-luna-grounded-v1",
  );
  assert.ok(correction.failedSceneIds.includes(positiveBatch.scenes[0].sceneId));
  assert.ok(
    correction.failures.some(
      (failure) => failure.field === "literal_subject" && failure.reason === "hard_conflict",
    ),
  );
});

test("Luna enforces the combined natural-scene character budget and corrections isolate overages", async () => {
  const base = makeBatch(2);
  const style = {
    positiveSuffix: "documentary photography",
    negativeSuffix: "CGI",
    fullImageGuidance: "16:9 center-safe",
    splitImageGuidance: "8:9 center-safe right panel",
  };
  const batch = {
    ...base,
    styleProfileHash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
    styleTreatment: {
      ...base.styleTreatment,
      style_profile_hash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
    },
    literalCharacterLimit: 180,
  };
  const overBudget = output(
    buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "runware-luna-grounded-v1"),
    {
      change: (rows) =>
        rows.map((row, index) =>
          index === 1
            ? {
                ...row,
                literal_subject: `${row.literal_subject} ${"ordinary jar surface ".repeat(3)}`,
                action: `${row.action} ${"resting on wood ".repeat(2)}`,
                environment: `${row.environment} ${"kitchen table nearby ".repeat(2)}`,
              }
            : row,
        ),
    },
  );
  const transport = new ScriptedTransport([
    (request) => success(request, { outputText: overBudget }),
  ]);
  const evidence = [];
  const writer = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    transport,
    evidenceSink: { record: (value) => evidence.push(value) },
    maximumBatchCostUsd: 0.01,
    semanticQualityMode: "advisory",
  });
  await expectInvalid(() => writer.write(batch));
  assert.equal(evidence[0].validationDiagnostic.reason, "scene_quality");
  const correction = buildRunwarePromptCorrection(batch, overBudget, "runware-luna-grounded-v1");
  assert.deepEqual(correction.failedSceneIds, [batch.scenes[1].sceneId]);
  assert.ok(
    correction.failures.some(
      (failure) =>
        failure.sceneId === batch.scenes[1].sceneId && failure.reason === "literal_character_limit",
    ),
  );

  const fitAround = (prefix, suffix, length) => {
    const fill = "x ".repeat(Math.ceil((length - prefix.length - suffix.length) / 2));
    return `${prefix}${fill.slice(0, length - prefix.length - suffix.length)}${suffix}`;
  };
  const geometryOutput = output(
    buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "runware-luna-grounded-v1"),
    {
      change: (rows) =>
        rows.map((row, index) =>
          index === 1
            ? {
                ...row,
                literal_subject: fitAround("Hands and irrigation valve ", "16:9", 72),
                action: fitAround("demonstrating irrigation ", "16:9", 54),
                environment: fitAround("farm irrigation pipe ", "16:9", 49),
              }
            : row,
        ),
    },
  );
  const geometryRow = JSON.parse(geometryOutput).scenes[1];
  const rawLiteralChars = [
    geometryRow.literal_subject,
    geometryRow.action,
    geometryRow.environment,
  ].reduce((sum, value) => sum + value.length, 0);
  const projectedLiteralChars = [
    geometryRow.literal_subject,
    geometryRow.action,
    geometryRow.environment,
  ].reduce((sum, value) => sum + plainGeometry(value).length, 0);
  assert.ok(rawLiteralChars <= batch.literalCharacterLimit);
  assert.ok(projectedLiteralChars > batch.literalCharacterLimit);
  const geometryEvidence = [];
  const geometryWriter = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    transport: new ScriptedTransport([
      (request) => success(request, { outputText: geometryOutput }),
    ]),
    evidenceSink: { record: (value) => geometryEvidence.push(value) },
    maximumBatchCostUsd: 0.01,
    semanticQualityMode: "advisory",
  });
  await expectInvalid(() => geometryWriter.write(batch));
  assert.equal(geometryEvidence[0].validationDiagnostic.reason, "scene_quality");
  const geometryCorrection = buildRunwarePromptCorrection(
    batch,
    geometryOutput,
    "runware-luna-grounded-v1",
  );
  assert.deepEqual(geometryCorrection.failedSceneIds, [batch.scenes[1].sceneId]);
  assert.ok(
    geometryCorrection.failures.some((failure) => failure.reason === "literal_character_limit"),
  );

  const limit = naturalDocumentaryLiteralCharacterLimit({
    styleProfileHash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
    style,
    extraPromptKeywords: null,
    applyExtraPromptKeywords: false,
    scenes: [batch.scenes[0]],
  });
  assert.ok(limit >= 90);
  const subjectLimit = Math.floor(limit * 0.4);
  const actionLimit = Math.floor(limit * 0.3);
  const environmentLimit = limit - subjectLimit - actionLimit;
  const pad = (value, length) =>
    `${value}${" x".repeat(Math.ceil((length - value.length) / 2))}`.slice(0, length);
  const compiled = compileImagePrompt({
    expectedScene: batch.scenes[0],
    writerOutput: {
      scene_id: batch.scenes[0].sceneId,
      literal_subject: pad("A glass jar", subjectLimit),
      action: pad("Resting on table", actionLimit),
      environment: pad("In a kitchen", environmentLimit),
      in_image_shot_role: batch.scenes[0].inImageShotRole,
      lighting_context: "available daylight",
      continuity_tags: [],
      prompt_core: "A jar rests on an ordinary kitchen table",
    },
    style,
    extraPromptKeywords: null,
    applyExtraPromptKeywords: false,
  });
  assert.ok(naturalDocumentaryRequiredPrompt(compiled.components).length <= 800);
});

test("new writer policy dispatches its exact selected request once", async () => {
  const batch = makeBatch(1);
  const transport = new ScriptedTransport([(request) => success(request)]);
  const value = new RunwarePromptWriter({
    requestPolicy: "physical-placement-v2",
    transport,
    evidenceSink: { record() {} },
    maximumBatchCostUsd: 0.01,
  });
  await value.write(batch);
  assert.equal(transport.requests.length, 1);
  assert.equal(
    transport.requests[0].requestBytes,
    buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "physical-placement-v2")
      .requestBytes,
  );
  assert.match(PHYSICAL_PLACEMENT_V2_WRITER_INSTRUCTION, /Exempt genuine HANDS_ACTION close-ups/u);
  assert.match(PHYSICAL_PLACEMENT_V2_WRITER_INSTRUCTION, /Preserve every narrated collaborator/u);
  assert.throws(() => buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "unknown"));
});

test("Luna result model identity and reasoning usage reach accepted evidence", async () => {
  const batch = makeBatch(1);
  let evidence;
  const writer = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    transport: new ScriptedTransport([
      (request) =>
        success(request, {
          providerModel: RUNWARE_LUNA_PROMPT_MODEL,
          costBasis: "PINNED_RATE_ESTIMATE",
          estimatedCostMicroUsd: 123,
          responseId: "resp_luna_test",
          wireHash: `sha256:${"a".repeat(64)}`,
          usage: {
            inputTokens: 1_000,
            outputTokens: 2_000,
            totalTokens: 3_000,
            cachedInputTokens: 100,
            reasoningTokens: 250,
            cacheWriteTokens: 75,
          },
        }),
    ]),
    evidenceSink: {
      record(value) {
        evidence = value;
      },
    },
    maximumBatchCostUsd: 0.01,
  });
  await writer.write(batch);
  assert.equal(evidence.model, RUNWARE_LUNA_PROMPT_MODEL);
  assert.equal(evidence.requestVersion, RUNWARE_LUNA_PROMPT_REQUEST_VERSION);
  assert.equal(evidence.usage.reasoningTokens, 250);
  assert.equal(evidence.usage.cacheWriteTokens, 75);
  assert.equal(evidence.costBasis, "PINNED_RATE_ESTIMATE");
  assert.equal(evidence.estimatedCostMicroUsd, 123);
  assert.equal(evidence.responseId, "resp_luna_test");
  assert.match(evidence.wireHash, /^sha256:[a-f0-9]{64}$/u);

  let mismatchEvidence;
  const mismatch = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    transport: new ScriptedTransport([
      (request) => success(request, { providerModel: RUNWARE_PROMPT_MODEL }),
    ]),
    evidenceSink: {
      record(value) {
        mismatchEvidence = value;
      },
    },
    maximumBatchCostUsd: 0.01,
  });
  await assert.rejects(() => mismatch.write(batch));
  assert.equal(mismatchEvidence.validationDiagnostic.reason, "provider_model");

  let invalidUsageEvidence;
  const invalidCacheWrite = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    transport: new ScriptedTransport([
      (request) =>
        success(request, {
          providerModel: RUNWARE_LUNA_PROMPT_MODEL,
          usage: {
            inputTokens: 1_000,
            outputTokens: 2_000,
            totalTokens: 3_000,
            cachedInputTokens: 900,
            cacheWriteTokens: 101,
          },
        }),
    ]),
    evidenceSink: {
      record(value) {
        invalidUsageEvidence = value;
      },
    },
    maximumBatchCostUsd: 0.01,
  });
  await assert.rejects(() => invalidCacheWrite.write(batch));
  assert.equal(invalidUsageEvidence.validationDiagnostic.reason, "usage");
});

test("request construction revalidates the exact style-only v2 projection", () => {
  const batch = makeBatch(1);
  const forged = {
    ...batch,
    styleTreatment: {
      ...batch.styleTreatment,
      subject_treatment: "retail product display",
    },
  };
  assert.throws(
    () => buildRunwarePromptRequest(forged, forged.scenes, 1),
    (error) =>
      error instanceof PipelineDomainError &&
      error.failure.code === "PROMPT_INPUT_INVALID" &&
      /unknown or missing semantic fields/u.test(error.failure.message),
  );
});

function writer(steps, maximumBatchCostUsd = 0.01, semanticQualityMode = "enforce") {
  const transport = new ScriptedTransport(steps);
  const evidence = [];
  return {
    transport,
    evidence,
    value: new RunwarePromptWriter({
      transport,
      evidenceSink: { record: (item) => evidence.push(item) },
      maximumBatchCostUsd,
      semanticQualityMode,
    }),
  };
}

async function expectInvalid(action) {
  await assert.rejects(
    action,
    (error) =>
      error instanceof PipelineDomainError && error.failure.code === "PROMPT_OUTPUT_INVALID",
  );
}

test("shot guidance reaches each batch once and authoritative framing survives compilation", async () => {
  for (const count of [6, 50]) {
    const input = makeBatch(count);
    const run = writer([
      (request) =>
        success(request, {
          change: (rows) =>
            rows.map((row) => ({
              ...row,
              literal_subject: "Weathered hands in close unobstructed view",
              action: "demonstrating an irrigation valve step with a simple grip",
              environment: "irrigation valve step on a farm pipe with the hand contact centered",
            })),
        }),
    ]);
    const accepted = await run.value.write(input);
    const request = run.transport.requests[0];
    assert.equal(request.requestVersion, "runware-gemini-3.5-flash-prompt-request-v24");
    assert.ok(
      Buffer.byteLength(request.request.settings.systemPrompt, "utf8") <= 6_000,
      "Repeated batch instructions exceed the compact input budget",
    );
    assert.equal(
      request.request.settings.systemPrompt.match(/Shot quality selection:/gu)?.length,
      1,
    );
    assert.doesNotMatch(request.request.messages[0].content, /Shot quality selection:/u);
    for (const role of IN_IMAGE_SHOT_ROLES)
      assert.ok(request.request.settings.systemPrompt.includes(role));
    assert.deepEqual(
      accepted.scenes.map((row) => row.in_image_shot_role),
      input.scenes.map((row) => row.inImageShotRole),
    );
    const compiled = compileImagePrompt({
      expectedScene: input.scenes[0],
      writerOutput: accepted.scenes[0],
      style: {
        positiveSuffix: "documentary photo",
        negativeSuffix: "CGI",
        fullImageGuidance: "16:9 center-safe",
        splitImageGuidance: "8:9 center-safe right panel",
      },
      extraPromptKeywords: "",
      applyExtraPromptKeywords: false,
    });
    assert.match(compiled.components.literalContent, /close unobstructed view/u);
    assert.match(compiled.components.literalContent, /simple grip/u);
  }
});

test("pins exact AIR/schema and deterministically handles 25/50 scenes across five styles", async () => {
  for (let styleIndex = 0; styleIndex < styleGuidance.length; styleIndex += 1) {
    const count = styleIndex % 2 === 0 ? 25 : 50;
    const first = writer([(request) => success(request)]);
    const second = writer([(request) => success(request)]);
    const [firstOutput, secondOutput] = await Promise.all([
      first.value.write(makeBatch(count, styleIndex)),
      second.value.write(makeBatch(count, styleIndex)),
    ]);
    assert.deepEqual(firstOutput, secondOutput);
    assert.equal(firstOutput.scenes.length, count);
    const request = first.transport.requests[0];
    assert.equal(request.request.model, RUNWARE_PROMPT_MODEL);
    // Google Gemini rejects outputFormat/jsonSchema with providerBadRequest, so the request carries
    // neither field and the exact document shape lives in the system prompt instead; the strict parse
    // and schema validation still run over the answer.
    assert.equal("outputFormat" in request.request, false);
    assert.equal("jsonSchema" in request.request, false);
    assert.match(request.request.settings.systemPrompt, /JSON/u);
    assert.match(request.request.settings.systemPrompt, /scene_id/u);
    assert.deepEqual(Object.keys(request.request.settings).sort(), [
      "maxTokens",
      "systemPrompt",
      "temperature",
      "thinkingLevel",
      "topP",
    ]);
    assert.match(
      request.request.taskUUID,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    assert.equal(request.request.model, "google:gemini@3.5-flash");
    assert.equal(request.request.settings.thinkingLevel, "off");
    assert.equal(request.request.settings.temperature, 0.2);
    assert.equal(request.request.settings.topP, 0.9);
    assert.equal(request.requestVersion, RUNWARE_PROMPT_REQUEST_VERSION);
    assert.equal(
      request.request.settings.maxTokens,
      Math.min(
        RUNWARE_PROMPT_MAX_OUTPUT_TOKENS,
        RUNWARE_PROMPT_OUTPUT_FIXED_TOKENS +
          count * RUNWARE_PROMPT_OUTPUT_TOKENS_PER_SCENE +
          RUNWARE_PROMPT_OUTPUT_TOKEN_HEADROOM,
      ),
    );
    // The provider no longer receives a jsonSchema or outputFormat: Google Gemini rejects structured
    // output with providerBadRequest, so the exact document contract lives in the system prompt and
    // the strict parse plus schema validation in the writer still refuse anything that does not match.
    assert.equal("jsonSchema" in request.request, false);
    assert.equal("outputFormat" in request.request, false);
    assert.match(request.request.settings.systemPrompt, /exactly these eight keys/u);
    assert.match(request.request.settings.systemPrompt, /one scene object per requested scene/u);
    assert.match(request.request.settings.systemPrompt, /one JSON object and nothing else/u);
    assert.equal(request.requestSha256, second.transport.requests[0].requestSha256);
    assert.equal(request.requestBytes, second.transport.requests[0].requestBytes);
    assert.equal(Object.hasOwn(payload(request), "planner_guidance"), false);
    assert.deepEqual(payload(request).style_treatment, makeBatch(count, styleIndex).styleTreatment);
    assert.equal(payload(request).story_context, `Compact story context for style ${styleIndex}`);
    assert.equal(
      request.request.messages[0].content.match(
        new RegExp(`Compact story context for style ${styleIndex}`, "gu"),
      )?.length,
      1,
    );
    assert.ok(
      request.request.messages[0].content.indexOf('"scenes"') <
        request.request.messages[0].content.indexOf('"story_context"'),
    );
    assert.equal(Object.hasOwn(payload(request).scenes[0], "story_context"), false);
    assert.deepEqual(
      Object.keys(payload(request).scenes[1]).sort(),
      [
        "next_scene_phrase",
        "prior_scene_phrase",
        "scene_phrase_context",
        "exact_phrase",
        "exact_phrase_sha256",
        "fixed_layout",
        "in_image_shot_role",
        "scene_id",
      ].sort(),
    );
    assert.equal(
      payload(request).scenes[1].scene_phrase_context,
      "Hands demonstrate irrigation valve step 2.",
    );
    assert.equal(payload(request).scenes[1].prior_scene_phrase, "Prior step 1");
    assert.equal(payload(request).scenes[1].next_scene_phrase, "Next step 3");
    assert.equal(
      payload(request).scenes[1].exact_phrase_sha256,
      `sha256:${createHash("sha256").update(payload(request).scenes[1].exact_phrase).digest("hex")}`,
    );
    assert.equal(
      payload(request).style_profile_hash,
      makeBatch(count, styleIndex).styleProfileHash,
    );
    assert.equal(
      request.request.messages[0].content.match(/Harvest Water Without Pumps/gu)?.length,
      1,
    );
  }
});

test("writer contract requires relatable physical evidence and applies style as treatment only", () => {
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /one camera-capturable moment/u);
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /physically plausible visible action/u);
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /familiar human behavior, ordinary locations/u);
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /never symbolism or metaphor when literal evidence exists/u,
  );
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /exact_phrase > scene_phrase_context > prior_scene_phrase > next_scene_phrase/u,
  );
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /story_context only to resolve locally unresolved/u,
  );
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /Only style_treatment supplies reusable/u);
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /without imported reference people, places, objects, products, logos/u,
  );
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /believable anatomy, materials, scale/u);
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /Show concrete visible evidence of the exact phrase/u,
  );
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /authoritative structured scene facts/u);
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /must not repeat style suffixes, palette\/hex colors, lighting/u,
  );
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /Word targets: literal_subject\/action\/environment at most 20 each, lighting_context 10, prompt_core 45/u,
  );
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /downstream compiler derives final literal image description/u,
  );
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /Preserve narrated actions semantically in action/u,
  );
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /static, stative or abstract/u);
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /never invent events or contradict narration/u);
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /Preserve named locations in environment/u);
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /continuity_tags: at most 12 unique/u);
  assert.doesNotMatch(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /Copy each required_literal_anchor/u);
});

test("rejects verbose prompt cores without retrying the accepted batch", async () => {
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].prompt_core = `Concrete visual evidence ${"detail ".repeat(100)}`;
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(makeBatch(25)));
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(setup.evidence[0].validationDisposition, "rejected");
  assert.deepEqual(setup.evidence[0].acceptedSceneIds, []);
});

test("accepts reordered output but restores original scene order", async () => {
  const setup = writer([(request) => success(request, { change: (rows) => rows.toReversed() })]);
  const result = await setup.value.write(makeBatch(25));
  assert.deepEqual(
    result.scenes.map((scene) => scene.scene_id),
    makeBatch(25).scenes.map((scene) => scene.sceneId),
  );
  assert.equal(setup.evidence[0].validationDisposition, "accepted");
  assert.deepEqual(
    setup.evidence[0].acceptedSceneIds,
    makeBatch(25).scenes.map((scene) => scene.sceneId),
  );
});

test("accepts concise concrete visual descriptions", async () => {
  const setup = writer([(request) => success(request)]);
  const result = await setup.value.write(makeBatch(25));
  assert.equal(result.scenes.length, 25);
  assert.ok(
    result.scenes.every((scene) =>
      scene.prompt_core.startsWith("Close documentary view of hands demonstrate irrigation valve"),
    ),
  );
});

test("scene relevance accepts a concrete visual description", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "Farmers repair irrigation pumps",
        sentenceContext:
          "Farmers repair a worn irrigation pump by hand beside an irrigation channel in a cultivated field before sunrise.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A farmer beside an irrigation channel";
          rows[0].action = "repairing a worn pump by hand";
          rows[0].environment = "a cultivated field before sunrise";
          rows[0].prompt_core =
            "A farmer repairs a worn irrigation pump beside a cultivated field before sunrise.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance rejects one incidental generic overlap without retry", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman repairs a bicycle in a public park",
        sentenceContext: "A woman repairs a bicycle in a public park.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A person";
          rows[0].action = "standing still";
          rows[0].environment = "a public setting";
          rows[0].prompt_core = "A person stands still in a public setting.";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(batch));
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(setup.evidence[0].validationDiagnostic.reason, "scene_relevance_structure");
});

test("scene relevance accepts entity and environment paraphrase with an action anchor", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A farmer repairs a broken irrigation pump",
        sentenceContext:
          "An agricultural worker repairs a damaged water machine at a cultivated field before the next harvest.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "An agricultural worker";
          rows[0].action = "repairing a damaged water machine";
          rows[0].environment = "a cultivated field before the next harvest";
          rows[0].prompt_core =
            "An agricultural worker fixes a damaged water machine by hand in a cultivated field.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance rejects a detailed but unrelated fox and alpine lake", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman repairs a bicycle in a public park",
        sentenceContext: "A woman repairs a bicycle in a public park before sunset.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A red fox";
          rows[0].action = "watching quietly";
          rows[0].environment = "beside an alpine lake in a rugged mountain valley";
          rows[0].prompt_core =
            "A red fox watches quietly beside an alpine lake in a rugged mountain valley at dawn.";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(batch));
  assert.equal(setup.transport.requests.length, 1);
  assert.deepEqual(setup.evidence[0].validationDiagnostic, {
    category: "scene_quality",
    reason: "scene_relevance_action_conflict",
    requestedSceneCount: 1,
    returnedSceneCount: 1,
    locallyValidSceneCount: 0,
    unresolvedSceneCount: 1,
  });
});

test("scene relevance uses adjacent narration to ground a pronoun-only phrase", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "She does it there",
        sentenceContext: "She does it there.",
        priorContext:
          "A cyclist adjusts a bicycle chain by hand beside a public park service stand.",
        nextContext: "The repaired bicycle is ready for the rider.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A cyclist";
          rows[0].action = "adjusting a bicycle chain by hand";
          rows[0].environment = "beside a public park service stand";
          rows[0].prompt_core =
            "A cyclist adjusts a bicycle chain by hand beside a public park service stand.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance rejects a global subject when adjacent narration resolves the pronoun", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    storyContext: "A chef prepares soup in a restaurant kitchen.",
    scenes: [
      {
        ...base.scenes[0],
        phrase: "She does it there",
        sentenceContext: "She does it there.",
        priorContext:
          "A cyclist adjusts a bicycle chain by hand beside a public park service stand.",
        nextContext: "The repaired bicycle is ready for the rider.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A chef";
          rows[0].action = "adjusting a bicycle chain by hand";
          rows[0].environment = "inside a restaurant kitchen";
          rows[0].prompt_core =
            "A chef adjusts a bicycle chain by hand inside a restaurant kitchen.";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(batch));
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(setup.evidence[0].validationDiagnostic.reason, "scene_relevance_subject");
});

test("scene relevance rejects matching entities when the narrated action is wrong", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman repairs a bicycle in a public park",
        sentenceContext: "A woman repairs a bicycle in a public park.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A woman with a bicycle";
          rows[0].action = "riding through the park";
          rows[0].environment = "a public park path with trees";
          rows[0].prompt_core =
            "A woman rides a bicycle through a public park path with trees in soft daylight.";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(batch));
  assert.equal(setup.evidence[0].validationDiagnostic.reason, "scene_relevance_action_conflict");
});

test("advisory scene relevance never rejects a contract-valid hosted response", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman repairs a bicycle in a public park",
        sentenceContext: "A woman repairs a bicycle in a public park.",
      },
    ],
  };
  const setup = writer(
    [
      (request) =>
        success(request, {
          change: (rows) => {
            rows[0].literal_subject = "A woman with a bicycle";
            rows[0].action = "riding through the park";
            rows[0].environment = "a public park path with trees";
            rows[0].prompt_core =
              "A woman rides a bicycle through a public park path with trees in soft daylight.";
            return rows;
          },
        }),
    ],
    0.01,
    "advisory",
  );

  const result = await setup.value.write(batch);
  assert.equal(result.scenes.length, 1);
  assert.equal(setup.evidence[0].validationDisposition, "accepted");
  assert.equal(setup.evidence[0].validationDiagnostic.reason, "scene_relevance_action_conflict");
  assert.deepEqual(setup.evidence[0].unresolvedSceneIds, []);
});

test("advisory hosted output repairs harmless field and continuity formatting defects", async () => {
  const setup = writer(
    [
      (request) =>
        success(request, {
          change: (rows) => {
            rows[0].literal_subject = "  Hands\u0000 beside the irrigation valve  ";
            rows[0].action = `demonstrating ${"a".repeat(300)}`;
            rows[0].environment = "ordinary\u0001 irrigation valve area";
            rows[0].lighting_context = "";
            rows[0].continuity_tags = [
              " same farmer ",
              "SAME FARMER",
              "\u0000",
              `detail ${"x".repeat(100)}`,
            ];
            rows[0].prompt_core = `provider compatibility prose ${"p".repeat(700)}`;
            return rows;
          },
        }),
    ],
    0.01,
    "advisory",
  );

  const result = await setup.value.write(makeBatch(1));
  const scene = result.scenes[0];
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(setup.evidence[0].validationDisposition, "accepted");
  assert.ok(scene.literal_subject.length > 0 && scene.literal_subject.length <= 240);
  assert.ok(scene.action.length > 0 && scene.action.length <= 240);
  assert.ok(scene.environment.length > 0 && scene.environment.length <= 240);
  assert.ok(scene.lighting_context.length > 0 && scene.lighting_context.length <= 120);
  assert.ok(scene.prompt_core.length > 0 && scene.prompt_core.length <= 600);
  assert.deepEqual(
    scene.continuity_tags.map((tag) => tag.toLowerCase()),
    ["same farmer", `detail ${"x".repeat(73)}`],
  );
  assert.ok(
    Array.from(JSON.stringify(scene)).every((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint > 31 && (codePoint < 127 || codePoint > 159);
    }),
  );
});

test("blank shelf evidence preserves all required facts and compiles in every field", async () => {
  for (const field of ["literal_subject", "action", "environment"]) {
    const setup = writer(
      [
        (request) =>
          success(request, {
            change: (rows) => {
              rows[0][field] = "A finger pointing to the corner of a blank shelf tag.";
              rows[1][field] = "A shopper's face and hand close to a blank shelf tag.";
              return rows;
            },
          }),
      ],
      0.01,
      "advisory",
    );
    const batch = makeBatch(10);
    const result = await setup.value.write(batch);
    assert.equal(result.scenes.length, 10);
    assert.equal(setup.transport.requests.length, 1);
    for (const [index, scene] of result.scenes.entries()) {
      const compiled = compileImagePrompt({
        expectedScene: batch.scenes[index],
        writerOutput: scene,
        style: {
          positiveSuffix: "documentary photo",
          negativeSuffix: "CGI",
          fullImageGuidance: "16:9 center-safe",
          splitImageGuidance: "8:9 center-safe right panel",
        },
        extraPromptKeywords: "",
        applyExtraPromptKeywords: false,
      });
      assert.doesNotMatch(compiled.components.literalContent, /\b(?:shelf|price)[- ]tags?\b/iu);
    }
    assert.equal(
      result.scenes[0][field],
      "A finger pointing to the corner of an unmarked shelf card.",
    );
    assert.equal(
      result.scenes[1][field],
      "A shopper's face and hand close to an unmarked shelf card.",
    );
  }
});

test("advisory canonicalizes blank packaging and shelf surfaces without accepting text or graphics", async () => {
  for (const field of ["literal_subject", "action", "environment"]) {
    for (const [description, expected] of [
      [
        "holding a bottle to show its blank back label",
        "holding a bottle to show its unmarked back surface",
      ],
      ["bottles with blank labels", "bottles with unmarked surfaces"],
      ["A bottle with a blank LABEL.", "A bottle with an unmarked surface."],
      ["A shelf with blank SHELF-TAGS.", "A shelf with unmarked shelf cards."],
      [
        "A finger pointing to the corner of a blank shelf tag.",
        "A finger pointing to the corner of an unmarked shelf card.",
      ],
      [
        "A shopper's face and hand close to a blank shelf tag.",
        "A shopper's face and hand close to an unmarked shelf card.",
      ],
      [
        "Leaning in to inspect a blank, unmarked paper shelf tag.",
        "Leaning in to inspect an unmarked paper shelf card.",
      ],
      [
        "A grocery store shelf with blank price tags.",
        "A grocery store shelf with unmarked cards.",
      ],
      ["Pointing at a blank price-tag.", "Pointing at an unmarked card."],
      ["a bottle with a blank green label.", "a bottle with an unmarked green surface."],
      ["a bottle with a blank brown label.", "a bottle with an unmarked brown surface."],
      ["pointing at a blank white back label.", "pointing at an unmarked white back surface."],
      ["showing a blank back white paper label", "showing an unmarked back white paper surface"],
      [
        "showing a blank white label with no text",
        "showing an unmarked white surface with no text",
      ],
      ["Pointing to a blank label on a bottle.", "Pointing to an unmarked surface on a bottle."],
      [
        "displaying a blank, unmarked white label area",
        "displaying an unmarked white surface area",
      ],
      [
        "Reaching for an unmarked yellow-labeled bottle",
        "Reaching for an unmarked bottle with a yellow surface",
      ],
      [
        "showing a blank unmarked white label area on a bottle.",
        "showing an unmarked white surface area on a bottle.",
      ],
      [
        "showing blank white back labels of the jar",
        "showing unmarked white back surfaces of the jar",
      ],
    ]) {
      const setup = writer(
        [
          (request) =>
            success(request, {
              change: (rows) => {
                rows[0][field] = description;
                return rows;
              },
            }),
        ],
        0.01,
        "advisory",
      );
      const result = await setup.value.write(makeBatch(1));
      assert.equal(result.scenes[0][field], expected);
      assert.equal(setup.transport.requests.length, 1);
      assert.equal(setup.evidence[0].validationDisposition, "accepted");
      const compiled = compileImagePrompt({
        expectedScene: makeBatch(1).scenes[0],
        writerOutput: result.scenes[0],
        style: {
          positiveSuffix: "documentary photo",
          negativeSuffix: "CGI",
          fullImageGuidance: "16:9 center-safe",
          splitImageGuidance: "8:9 center-safe right panel",
        },
        extraPromptKeywords: "",
        applyExtraPromptKeywords: false,
      });
      assert.doesNotMatch(compiled.components.literalContent, /\blabels?\b/iu);
    }
    for (const description of [
      "Honey on a blank shelf tag.",
      "Honey on the blank, unmarked paper shelf tag.",
      "5 on a blank shelf tag.",
      "Honey onto a blank price tag.",
      "A portrait across the blank shelf tag.",
      "A finger pointing to a shelf tag.",
      "A finger pointing to a blank printed shelf tag.",
      "reading Honey from a blank shelf tag",
      "A blank shelf tag with a price of $5",
      "A blank shelf tag with printed text",
      "A blank shelf tag and a logo",
      "A portrait illustration on a blank shelf tag.",
      "A bottle of sauce with a stylized, unmarked portrait illustration on its label.",
      "holding a bottle with a printed label",
      "holding a bottle with a blank printed label",
      "holding a bottle with a blank, unmarked printed label area",
      "holding an unmarked bottle with a gold-trimmed label",
      "holding a yellow-labeled bottle",
      "holding an unmarked yellow-labeled Honey bottle",
      "holding an unmarked yellow-labeled bottle with printed writing",
      "holding a printed unmarked red-labeled bottle",
      "reading Honey from an unmarked red-labeled bottle",
      "holding a numbered unmarked red-labeled bottle",
      "holding an inscribed unmarked red-labeled bottle",
      "holding a printed bottle with a blank label",
      "holding a bottle with a blank Honey label",
      "holding a bottle with a blank label reading Honey",
      "holding a bottle with a blank unmarked white label area reading Honey",
      "holding a bottle with a blank label and a logo",
      "holding a bottle with a blank label; showing its ingredient list",
      "holding a bottle with a blank label, barcode",
      "pointing to a blank label on a bottle reading Honey",
      "pointing to a blank label on a bottle and a logo",
    ]) {
      const setup = writer(
        [
          (request) =>
            success(request, {
              change: (rows) => {
                rows[0][field] = description;
                return rows;
              },
            }),
        ],
        0.01,
        "advisory",
      );
      await expectInvalid(() => setup.value.write(makeBatch(1)));
      assert.equal(setup.transport.requests.length, 1);
    }
  }
});

test("advisory mode preserves compatibility-only prose but rejects forbidden required facts", async () => {
  const coreOnly = writer(
    [
      (request) =>
        success(request, {
          change: (rows) => {
            rows[0].prompt_core = "Show a visible logo in compatibility-only prose";
            return rows;
          },
        }),
    ],
    0.01,
    "advisory",
  );
  const result = await coreOnly.value.write(makeBatch(1));
  assert.equal(result.scenes.length, 1);
  assert.equal(coreOnly.evidence[0].validationDisposition, "accepted");

  const compiledFields = writer(
    [
      (request) =>
        success(request, {
          change: (rows) => {
            rows[0].literal_subject = "bottle with a visible lo\u0000go";
            rows[0].action = "showing a visible title";
            rows[0].continuity_tags = ["visible logo"];
            return rows;
          },
        }),
    ],
    0.01,
    "advisory",
  );
  await expectInvalid(() => compiledFields.value.write(makeBatch(1)));
  assert.equal(compiledFields.transport.requests.length, 1);
  assert.equal(compiledFields.evidence[0].validationDisposition, "rejected");
  assert.equal(compiledFields.evidence[0].validationDiagnostic.reason, "scene_quality");
});

for (const [field, invalidValue] of [
  ["action", "Pointing at a blueprint layout of a residential development"],
  ["literal_subject", "the narration-supported physical subject"],
  ["action", "depicting the narration-supported visible moment"],
  ["environment", "the narration-supported physical environment"],
  ["literal_subject", " \u0000 "],
  ["action", ""],
  ["environment", "   "],
]) {
  for (const mode of ["advisory", "enforce"]) {
    test(`${mode} rejects unusable required ${field}: ${JSON.stringify(invalidValue)}`, async () => {
      const setup = writer(
        [
          (request) =>
            success(request, {
              change: (rows) => {
                rows[0][field] = invalidValue;
                return rows;
              },
            }),
        ],
        0.01,
        mode,
      );
      await expectInvalid(() => setup.value.write(makeBatch(1)));
      assert.equal(setup.transport.requests.length, 1, "writer must not dispatch a retry");
      assert.equal(setup.evidence[0].validationDisposition, "rejected");
      assert.deepEqual(setup.evidence[0].acceptedSceneIds, []);
      assert.deepEqual(setup.evidence[0].validationDiagnostic, {
        category: "scene_quality",
        reason: "scene_quality",
        requestedSceneCount: 1,
        returnedSceneCount: 1,
        locallyValidSceneCount: 0,
        unresolvedSceneCount: 1,
      });
    });
  }
}

for (const facts of [
  {
    literal_subject: "A gardener's two hands",
    action: "holding a clay flowerpot by its rim",
    environment: "a garden workbench outdoors",
  },
  {
    literal_subject: "Two gardeners beside a workbench",
    action: "lifting a clay flowerpot together",
    environment: "a garden workbench outdoors",
  },
]) {
  test(`advisory preserves ordinary human interaction: ${facts.literal_subject}`, async () => {
    const setup = writer(
      [
        (request) =>
          success(request, {
            change: (rows) => {
              Object.assign(rows[0], facts);
              rows[0].lighting_context = "visible logo";
              rows[0].continuity_tags = ["visible logo", "same garden"];
              return rows;
            },
          }),
      ],
      0.01,
      "advisory",
    );
    const result = await setup.value.write(makeBatch(1));
    assert.equal(setup.transport.requests.length, 1);
    for (const [field, value] of Object.entries(facts))
      assert.equal(result.scenes[0][field], value);
    assert.equal(
      result.scenes[0].lighting_context,
      "lighting consistent with the supplied scene context",
    );
    assert.deepEqual(result.scenes[0].continuity_tags, ["same garden"]);
  });
}

test("scene relevance accepts a matching action field prefixed by its subject", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman repairs a bicycle in a public park",
        sentenceContext: "A woman repairs a bicycle in a public park.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A woman with a bicycle";
          rows[0].action = "A woman repairing the bicycle by hand";
          rows[0].environment = "a public park work area with trees";
          rows[0].prompt_core =
            "A woman repairs a bicycle in a public park work area with trees, soft daylight, and ordinary wear.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance rejects an ungrounded second subject", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman repairs a bicycle in a public park",
        sentenceContext: "A woman repairs a bicycle in a public park.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A woman and a red fox";
          rows[0].action = "repairing a bicycle by hand";
          rows[0].environment = "in a public park work area";
          rows[0].prompt_core =
            "A woman repairs a bicycle in a public park work area under soft daylight with visible tools and ordinary wear.";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(batch));
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(setup.evidence[0].validationDiagnostic.reason, "scene_relevance_subject");
});

test("scene relevance accepts anchored ordinary physical detail that narration leaves implicit", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    storyContext: "A household explainer about treating a small fresh cut at home.",
    scenes: [
      {
        ...base.scenes[0],
        phrase: "Hydrogen peroxide bubbles on contact with a fresh cut",
        sentenceContext: "Hydrogen peroxide bubbles on contact with a fresh cut.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject =
            "A hand with a small superficial cut foaming with hydrogen peroxide";
          rows[0].action = "bubbling on contact with the fresh cut";
          rows[0].environment =
            "a lived-in home bathroom counter below an open medicine cabinet, with a cotton pad nearby";
          rows[0].prompt_core =
            "Hydrogen peroxide foams on a small fresh cut on a lived-in bathroom counter below an open medicine cabinet, with a folded gauze pad nearby.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance accepts an ordinary inferred environment when narration names none", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    storyContext: "A practical explainer about restoring mechanical wristwatches.",
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A watchmaker repairs a wristwatch",
        sentenceContext: "A watchmaker repairs a wristwatch.",
        priorContext: null,
        nextContext: "The restored watch begins ticking again.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A watchmaker holding an open wristwatch";
          rows[0].action = "repairing the wristwatch with a small hand tool";
          rows[0].environment = "at a scratched wooden workbench beneath an adjustable task lamp";
          rows[0].prompt_core =
            "A watchmaker repairs an open wristwatch with a small hand tool at a scratched wooden workbench beneath an adjustable task lamp.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance accepts natural leading action modifiers without losing the narrated action", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A mechanic repairs a bicycle inside a neighborhood workshop",
        sentenceContext:
          "A mechanic repairs a bicycle inside a neighborhood workshop before the owner returns.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A bicycle mechanic";
          rows[0].action = "carefully repairing the bicycle chain with a hand tool";
          rows[0].environment = "inside a neighborhood bicycle workshop";
          rows[0].prompt_core =
            "A bicycle mechanic carefully repairs a bicycle chain with a hand tool inside a neighborhood workshop.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance keeps gross semantic corruptions outside the permissive boundary", async () => {
  const cases = [
    {
      name: "grossly unrelated scene",
      literalSubject: "A red fox",
      action: "watching birds fly overhead",
      environment: "beside an alpine lake in a rugged mountain valley",
    },
    {
      name: "wrong action with matching nouns",
      literalSubject: "A mechanic beside a bicycle",
      action: "riding the bicycle through the workshop",
      environment: "inside a neighborhood bicycle workshop",
    },
    {
      name: "invented second subject",
      literalSubject: "A mechanic and a red fox beside a bicycle",
      action: "repairing the bicycle chain with a hand tool",
      environment: "inside a neighborhood bicycle workshop",
    },
  ];

  for (const sceneCase of cases) {
    const base = makeBatch(1);
    const batch = {
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          phrase: "A mechanic repairs a bicycle inside a neighborhood workshop",
          sentenceContext: "A mechanic repairs a bicycle inside a neighborhood workshop.",
        },
      ],
    };
    const setup = writer([
      (request) =>
        success(request, {
          change: (rows) => {
            rows[0].literal_subject = sceneCase.literalSubject;
            rows[0].action = sceneCase.action;
            rows[0].environment = sceneCase.environment;
            rows[0].prompt_core = `${sceneCase.literalSubject} ${sceneCase.action} ${sceneCase.environment} under natural daylight with visible materials and ordinary wear.`;
            return rows;
          },
        }),
    ]);
    await expectInvalid(() => setup.value.write(batch));
    assert.equal(setup.transport.requests.length, 1, sceneCase.name);
    const expectedReason =
      sceneCase.name === "invented second subject"
        ? "scene_relevance_subject"
        : "scene_relevance_action_conflict";
    assert.equal(setup.evidence[0].validationDiagnostic.reason, expectedReason, sceneCase.name);
  }
});

test("scene relevance rejects an un-narrated coordinated second action", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman repairs a bicycle in a public park",
        sentenceContext: "A woman repairs a bicycle in a public park.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A woman";
          rows[0].action = "repairing a bicycle while riding through the park";
          rows[0].environment = "a public park work area with repair tools";
          rows[0].prompt_core =
            "A woman repairs a bicycle in a public park work area with visible tools, natural daylight, and ordinary wear.";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(batch));
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(setup.evidence[0].validationDiagnostic.reason, "scene_relevance_action_conflict");
});

test("scene relevance rejects un-narrated and/but action tails", async () => {
  for (const connector of ["and", "but"]) {
    const base = makeBatch(1);
    const batch = {
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          phrase: "A woman repairs a bicycle in a public park",
          sentenceContext: "A woman repairs a bicycle in a public park.",
        },
      ],
    };
    const setup = writer([
      (request) =>
        success(request, {
          change: (rows) => {
            rows[0].literal_subject = "A woman";
            rows[0].action = `repairing a bicycle ${connector} riding through the park`;
            rows[0].environment = "a public park work area with repair tools";
            rows[0].prompt_core =
              "A woman repairs a bicycle in a public park work area with visible tools, natural daylight, and ordinary wear.";
            return rows;
          },
        }),
    ]);
    await expectInvalid(() => setup.value.write(batch));
    assert.equal(setup.transport.requests.length, 1, connector);
    assert.equal(
      setup.evidence[0].validationDiagnostic.reason,
      "scene_relevance_action_conflict",
      connector,
    );
  }
});

test("scene relevance allows an and-list of objects without a second action", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A mechanic repairs a bicycle and a chain",
        sentenceContext:
          "A mechanic repairs a bicycle and a chain by hand in a neighborhood workshop.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A mechanic";
          rows[0].action = "repairing a bicycle and a chain by hand";
          rows[0].environment = "inside a neighborhood workshop";
          rows[0].prompt_core =
            "A mechanic repairs a bicycle and a chain by hand inside a neighborhood workshop under daylight with visible tools and ordinary wear.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance accepts a narrated and action chain", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman repairs a bicycle and talks with a neighbor",
        sentenceContext:
          "A woman repairs a bicycle and talks with a neighbor in a public park work area.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A woman beside a neighbor";
          rows[0].action = "repairing a bicycle and talking with a neighbor";
          rows[0].environment = "in a public park work area";
          rows[0].prompt_core =
            "A woman repairs a bicycle and talks with a neighbor in a public park work area under daylight with visible tools and ordinary wear.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance accepts narration-grounded inflected action anchors", async () => {
  const cases = [
    {
      phrase: "A child eats breakfast",
      action: "eating breakfast at a kitchen table",
      subject: "A child",
      environment: "inside a lived-in kitchen",
    },
    {
      phrase: "A driver drives to work",
      action: "driving to work on an ordinary city street",
      subject: "A driver",
      environment: "on an ordinary city street",
    },
    {
      phrase: "A cyclist rides a bicycle",
      action: "riding a bicycle along a neighborhood path",
      subject: "A cyclist",
      environment: "along a neighborhood path",
    },
    {
      phrase: "A mechanic uses a wrench",
      action: "using a wrench beside a repair bench",
      subject: "A mechanic",
      environment: "beside a repair bench in a workshop",
    },
    {
      phrase: "A child goes to school",
      action: "going to school along the sidewalk",
      subject: "A child",
      environment: "along a neighborhood sidewalk",
    },
    {
      phrase: "A cook tries a new recipe",
      action: "trying a new recipe in the kitchen",
      subject: "A cook",
      environment: "inside a home kitchen",
    },
    {
      phrase: "A worker repairs a pump",
      action: "repairing a pump by hand",
      subject: "A worker",
      environment: "beside a practical field workshop",
    },
    {
      phrase: "A shopper purchases groceries",
      action: "purchasing groceries at a checkout",
      subject: "A shopper",
      environment: "inside a neighborhood market",
    },
    {
      phrase: "A porter carries a suitcase",
      action: "carrying a suitcase through a station",
      subject: "A porter",
      environment: "inside a busy train station",
    },
  ];

  for (const [index, sceneCase] of cases.entries()) {
    const base = makeBatch(1);
    const batch = {
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          phrase: sceneCase.phrase,
          sentenceContext: `${sceneCase.phrase} ${sceneCase.action} ${sceneCase.environment} in a realistic everyday moment.`,
        },
      ],
    };
    const setup = writer([
      (request) =>
        success(request, {
          change: (rows) => {
            rows[0].literal_subject = sceneCase.subject;
            rows[0].action = sceneCase.action;
            rows[0].environment = sceneCase.environment;
            rows[0].prompt_core = `${sceneCase.subject} ${sceneCase.action} ${sceneCase.environment} under natural daylight with visible materials and ordinary wear, case ${index}.`;
            return rows;
          },
        }),
    ]);
    let result;
    try {
      result = await setup.value.write(batch);
    } catch (error) {
      throw new Error(
        `failed morphology case ${index}: ${sceneCase.phrase}: ${JSON.stringify(setup.evidence[0]?.validationDiagnostic)}`,
        { cause: error },
      );
    }
    assert.equal(result.scenes.length, 1, sceneCase.phrase);
  }
});

test("scene relevance accepts a coordinated action when narration includes it", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman repairs a bicycle while talking with a neighbor",
        sentenceContext:
          "A woman repairs a bicycle while talking with a neighbor in a public park work area.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A woman beside a neighbor";
          rows[0].action = "repairing a bicycle while talking with a neighbor";
          rows[0].environment = "in a public park work area";
          rows[0].prompt_core =
            "A woman repairs a bicycle while talking with a neighbor in a public park work area under daylight with visible tools and ordinary wear.";
          return rows;
        },
      }),
  ]);
  let result;
  try {
    result = await setup.value.write(batch);
  } catch (error) {
    throw new Error(JSON.stringify(setup.evidence[0]?.validationDiagnostic), { cause: error });
  }
  assert.equal(result.scenes.length, 1);
});

test("scene relevance ignores a raw prompt core mismatch when structured facts are grounded", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman repairs a bicycle in a public park",
        sentenceContext: "A woman repairs a bicycle in a public park.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          // The structured metadata is correct. The compiler now derives
          // literal content from it, so raw prompt_core may be a natural
          // compatibility paraphrase without controlling the image action.
          rows[0].literal_subject = "A woman";
          rows[0].action = "repairing a bicycle";
          rows[0].environment = "in a public park";
          rows[0].prompt_core =
            "A woman rides a bicycle through a public park path with trees in soft daylight.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance rejects an unseen stealing action when nouns are shared", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman purchases a bicycle",
        sentenceContext: "A woman purchases a bicycle from a bicycle shop.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A woman";
          rows[0].action = "stealing a bicycle";
          rows[0].environment = "inside a bicycle shop aisle";
          rows[0].prompt_core =
            "A woman moves through a bicycle shop aisle in natural daylight with visible shelves and ordinary wear.";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(batch));
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(setup.evidence[0].validationDiagnostic.reason, "scene_relevance_action_conflict");
});

test("scene relevance accepts a purchase action anchor with a raw prompt core paraphrase", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman purchases groceries",
        sentenceContext:
          "A female shopper purchases groceries by paying for food at a grocery checkout in a neighborhood market.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A female shopper";
          rows[0].action = "purchasing groceries by paying for food";
          rows[0].environment = "at a grocery checkout";
          rows[0].prompt_core =
            "An observational checkout moment shows a shopper beside a basket under natural daylight with realistic materials and ordinary wear.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance accepts a concrete contextual rendering of an abstract phrase", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "This changed everything",
        sentenceContext:
          "Village residents watch water flow again through a village irrigation channel from the village irrigation pump.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "Village residents beside an irrigation pump";
          rows[0].action = "watching water flow again";
          rows[0].environment = "a village irrigation channel";
          rows[0].prompt_core =
            "Village residents watch water flow again from the repaired irrigation pump.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance treats a cleaning-product modifier as stative, not as a cleaning action", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    storyContext: "A household explainer about a stiff broom kept in a pantry.",
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A stiff broom is a common household cleaning tool",
        sentenceContext: "A stiff broom is a common household cleaning tool.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A stiff straw broom";
          rows[0].action = "resting against a pantry wall";
          rows[0].environment = "inside a lived-in home pantry";
          rows[0].prompt_core =
            "A stiff straw broom rests against a worn pantry wall inside a lived-in home pantry.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance keeps plural household uses and minor cuts out of action inference", async () => {
  for (const phrase of [
    "A stiff broom has many household uses",
    "A stiff broom is a cleaning tool for minor spills",
  ]) {
    const base = makeBatch(1);
    const batch = {
      ...base,
      storyContext: "A household explainer about a stiff broom kept in a pantry.",
      scenes: [{ ...base.scenes[0], phrase, sentenceContext: `${phrase}.` }],
    };
    const setup = writer([
      (request) =>
        success(request, {
          change: (rows) => {
            rows[0].literal_subject = "A stiff straw broom";
            rows[0].action = "resting upright on a pantry floor";
            rows[0].environment = "inside a lived-in home pantry";
            rows[0].prompt_core =
              "A stiff straw broom rests upright on a worn pantry floor inside a lived-in home pantry.";
            return rows;
          },
        }),
    ]);
    const result = await setup.value.write(batch);
    assert.equal(result.scenes.length, 1, phrase);
  }
});

test("scene relevance accepts a stored object rendered as resting in place", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    storyContext: "A household explainer about a stiff broom kept in a pantry.",
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A stiff broom tucked into the back of the pantry",
        sentenceContext: "A stiff broom tucked into the back of the pantry.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A stiff straw broom";
          rows[0].action = "resting against a pantry wall";
          rows[0].environment = "inside a lived-in home pantry";
          rows[0].prompt_core =
            "A stiff straw broom rests against a worn pantry wall inside a lived-in home pantry.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance preserves real actions after a local stative clause and in present perfect", async () => {
  for (const phrase of [
    "A mechanic has tools and repairs a bicycle",
    "A mechanic has repaired a bicycle",
  ]) {
    const base = makeBatch(1);
    const batch = {
      ...base,
      scenes: [{ ...base.scenes[0], phrase, sentenceContext: `${phrase}.` }],
    };
    const setup = writer([
      (request) =>
        success(request, {
          change: (rows) => {
            rows[0].literal_subject = "A mechanic with a bicycle";
            rows[0].action = "riding the bicycle through the workshop";
            rows[0].environment = "inside a neighborhood bicycle workshop";
            rows[0].prompt_core =
              "A mechanic rides a bicycle through a neighborhood workshop in practical daylight with visible tools.";
            return rows;
          },
        }),
    ]);
    await expectInvalid(() => setup.value.write(batch));
    assert.equal(
      setup.evidence[0].validationDiagnostic.reason,
      "scene_relevance_action_conflict",
      phrase,
    );
  }
});

test("scene relevance finds the real action after a noun homonym", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A fresh cut starts to bubble when hydrogen peroxide touches it",
        sentenceContext:
          "A fresh cut starts to bubble when hydrogen peroxide touches it on a person's hand.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A hand with a small fresh cut";
          rows[0].action = "visibly bubbling where hydrogen peroxide touches the cut";
          rows[0].environment = "above a lived-in home bathroom counter";
          rows[0].prompt_core =
            "A small fresh cut on a hand visibly bubbles above a lived-in bathroom counter in practical daylight.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance keeps visibly different actions distinct", async () => {
  const cases = [
    ["A worker fills a container", "A worker", "emptying the container"],
    ["A farmer plants seeds", "A farmer", "harvesting the seeds"],
    ["A child eats breakfast", "A child", "drinking breakfast"],
    ["A visitor stands beside a window", "A visitor", "sitting beside the window"],
  ];
  for (const [phrase, literalSubject, action] of cases) {
    const base = makeBatch(1);
    const batch = {
      ...base,
      scenes: [{ ...base.scenes[0], phrase, sentenceContext: `${phrase}.` }],
    };
    const setup = writer([
      (request) =>
        success(request, {
          change: (rows) => {
            rows[0].literal_subject = literalSubject;
            rows[0].action = action;
            rows[0].environment = "inside an ordinary lived-in work area";
            rows[0].prompt_core = `${literalSubject} ${action} inside an ordinary lived-in work area with practical daylight and visible wear.`;
            return rows;
          },
        }),
    ]);
    await expectInvalid(() => setup.value.write(batch));
    assert.equal(
      setup.evidence[0].validationDiagnostic.reason,
      "scene_relevance_action_conflict",
      phrase,
    );
  }
});

test("scene relevance does not treat a shared action word as subject grounding", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman repairs a bicycle",
        sentenceContext: "A woman repairs a bicycle in a public park.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A repair tool";
          rows[0].action = "repairing a damaged roof";
          rows[0].environment = "at an urban construction site";
          rows[0].prompt_core =
            "A repair tool lies beside a damaged roof at an urban construction site in practical daylight.";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(batch));
  assert.equal(setup.evidence[0].validationDiagnostic.reason, "scene_relevance_subject");
});

test("scene relevance uses the output predicate, not a later action-shaped noun", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman repairs a bicycle",
        sentenceContext: "A woman repairs a bicycle beside a neighborhood repair shop.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A woman with a bicycle";
          rows[0].action = "riding the bicycle toward a repair shop";
          rows[0].environment = "on a neighborhood street";
          rows[0].prompt_core =
            "A woman rides a bicycle toward a neighborhood repair shop on an ordinary street in practical daylight.";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(batch));
  assert.equal(setup.evidence[0].validationDiagnostic.reason, "scene_relevance_action_conflict");
});

test("scene relevance does not substitute a different clause from the containing sentence", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A brown bottle remains on the shelf",
        sentenceContext:
          "A brown bottle remains on the shelf while a woman repairs a bicycle beside it.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A woman";
          rows[0].action = "repairing a bicycle by hand";
          rows[0].environment = "beside a medicine cabinet shelf";
          rows[0].prompt_core =
            "A woman repairs a bicycle beside a medicine cabinet shelf in practical daylight with visible tools.";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(batch));
  assert.equal(setup.evidence[0].validationDiagnostic.reason, "scene_relevance_action_conflict");
});

test("scene relevance lets a lowercase split fragment resolve its subject from the containing sentence", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "back of the pantry just waiting for a sweep",
        sentenceContext:
          "Most of us have a stiff broom tucked into the back of the pantry just waiting for a sweep.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A stiff straw broom";
          rows[0].action = "resting at the back of the pantry";
          rows[0].environment = "inside a lived-in home pantry";
          rows[0].prompt_core =
            "A stiff straw broom rests at the back of a lived-in home pantry floor.";
          return rows;
        },
      }),
  ]);
  let result;
  try {
    result = await setup.value.write(batch);
  } catch (error) {
    throw new Error(JSON.stringify(setup.evidence[0]?.validationDiagnostic), { cause: error });
  }
  assert.equal(result.scenes.length, 1);
});

test("scene relevance does not treat a lowercase sentence start as a split fragment", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "the brown bottle near the shelf",
        sentenceContext:
          "The brown bottle near the shelf remains still while a woman repairs a bicycle.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A woman with a bicycle";
          rows[0].action = "repairing the bicycle by hand";
          rows[0].environment = "beside a household shelf";
          rows[0].prompt_core =
            "A woman repairs a bicycle beside a household shelf in practical daylight with visible tools and ordinary wear.";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(batch));
  assert.equal(setup.evidence[0].validationDiagnostic.reason, "scene_relevance_subject");
});

test("scene relevance resolves a sentence-opening dependent fragment", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "After years of daily use",
        sentenceContext: "After years of daily use, the stiff broom is tucked into the pantry.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A worn stiff straw broom";
          rows[0].action = "resting at the back of a pantry";
          rows[0].environment = "inside a lived-in home pantry";
          rows[0].prompt_core =
            "A worn stiff straw broom rests at the back of a lived-in home pantry floor.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance rejects an action hidden in an un-narrated coordinated tail", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A woman repairs a bicycle and its chain",
        sentenceContext: "A woman repairs a bicycle and its chain in a public park.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A woman";
          rows[0].action = "repairing a bicycle and stealing its chain";
          rows[0].environment = "inside a public park work area";
          rows[0].prompt_core =
            "A woman repairs a bicycle inside a public park work area with visible tools and ordinary wear.";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(batch));
  assert.equal(setup.evidence[0].validationDiagnostic.reason, "scene_relevance_action_conflict");
});

test("scene relevance rejects a destructive action absent from repair narration", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A mechanic repairs a bicycle",
        sentenceContext: "A mechanic repairs a bicycle inside a neighborhood workshop.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A mechanic with a bicycle";
          rows[0].action = "smashing the bicycle frame";
          rows[0].environment = "inside a neighborhood workshop";
          rows[0].prompt_core =
            "A mechanic smashes a bicycle frame inside a neighborhood workshop with visible tools and ordinary wear.";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(batch));
  assert.equal(setup.evidence[0].validationDiagnostic.reason, "scene_relevance_action_conflict");
});

test("rejects duplicate normalized prompt cores across scenes", async () => {
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[1].prompt_core = `  ${rows[0].prompt_core.replaceAll(" ", "   ")}  `;
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(makeBatch(25)));
  assert.equal(setup.transport.requests.length, 1);
  assert.deepEqual(setup.evidence[0].validationDiagnostic, {
    category: "scene_quality",
    reason: "duplicate_prompt_core",
    requestedSceneCount: 25,
    returnedSceneCount: 25,
    locallyValidSceneCount: 25,
    unresolvedSceneCount: 25,
  });
});

test("does not retry invalid or missing rows", async () => {
  const setup = writer([
    (request) =>
      success(request, {
        marker: "first",
        change: (rows) => {
          rows[1].action = "";
          return rows.filter((_, index) => index !== 3);
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(makeBatch(25)));
  assert.equal(setup.transport.requests.length, 1);
  assert.deepEqual(
    setup.evidence.map((item) => item.validationDisposition),
    ["rejected"],
  );
});

test("a forbidden visual instruction stops after the single request", async () => {
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[2].action = "demonstrating a visible logo";
          return rows;
        },
      }),
  ]);
  await expectInvalid(() => setup.value.write(makeBatch(25)));
  assert.equal(setup.transport.requests.length, 1);
  assert.deepEqual(setup.evidence[0].acceptedSceneIds, []);
  assert.deepEqual(setup.evidence[0].validationDiagnostic, {
    category: "scene_quality",
    reason: "scene_quality",
    requestedSceneCount: 25,
    returnedSceneCount: 25,
    locallyValidSceneCount: 24,
    unresolvedSceneCount: 1,
  });
});

test("a failed batch has no partial result", async () => {
  const invalidateFirst = (request) =>
    success(request, {
      change: (rows) => {
        rows[0].action = "";
        return rows;
      },
    });
  const setup = writer([invalidateFirst]);
  await expectInvalid(() => setup.value.write(makeBatch(25)));
  assert.equal(setup.transport.requests.length, 1);
  assert.deepEqual(
    setup.evidence.map((item) => item.validationDisposition),
    ["rejected"],
  );
});

test("malformed JSON and top-level schema fail without retry", async (context) => {
  for (const [name, outputText] of [
    ["invalid JSON", "{"],
    ["duplicate JSON key", '{"batch_id":"x","batch_id":"x","scenes":[]}'],
    ["top-level array", "[]"],
    ["unknown top field", JSON.stringify({ batch_id: "batch_25_0", scenes: [], extra: true })],
  ]) {
    await context.test(name, async () => {
      const setup = writer([(request) => success(request, { outputText })]);
      await expectInvalid(() => setup.value.write(makeBatch(25)));
      assert.equal(setup.transport.requests.length, 1);
      assert.equal(setup.evidence[0].validationDisposition, "rejected");
    });
  }
});

test("unknown, duplicate, identity-less, and changed-role rows fail without retry", async (context) => {
  const cases = [
    ["unknown", (rows) => ((rows[0].scene_id = "scene_unknown"), rows)],
    ["duplicate", (rows) => ((rows[1].scene_id = rows[0].scene_id), rows)],
    ["identity-less", (rows) => (delete rows[0].scene_id, rows)],
    ["changed role", (rows) => ((rows[0].in_image_shot_role = "MACRO_DETAIL"), rows)],
  ];
  for (const [name, change] of cases) {
    await context.test(name, async () => {
      const setup = writer([(request) => success(request, { change })]);
      await expectInvalid(() => setup.value.write(makeBatch(25)));
      assert.equal(setup.transport.requests.length, 1);
    });
  }
});

test("usage, cost, latency, finish, and returned-model drift fail closed", async (context) => {
  const cases = [
    [
      "usage",
      { usage: { inputTokens: 1_000, outputTokens: 2_000, totalTokens: 1, cachedInputTokens: 0 } },
    ],
    ["cost", { costUsd: 0.02 }],
    ["latency", { latencyMs: -1 }],
    ["finish", { finishReason: "length" }],
    ["model", { providerModel: "deepseek:mutable-alias" }],
  ];
  for (const [name, options] of cases) {
    await context.test(name, async () => {
      const setup = writer([(request) => success(request, options)]);
      await expectInvalid(() => setup.value.write(makeBatch(25)));
      assert.equal(setup.transport.requests.length, 1);
      assert.equal(setup.evidence[0].validationDisposition, "rejected");
    });
  }
});

test("a single request cost cannot drift above the caller-owned batch ceiling", async () => {
  const setup = writer(
    [
      (request) =>
        success(request, {
          costUsd: 0.02,
          change: (rows) => {
            rows[0].action = "";
            return rows;
          },
        }),
    ],
    0.01,
  );
  await expectInvalid(() => setup.value.write(makeBatch(25)));
  assert.equal(setup.transport.requests.length, 1);
  assert.equal(setup.evidence[0].costUsd, 0.02);
  assert.equal(setup.evidence[0].validationDisposition, "rejected");
});

test("ambiguous, timeout, explicit failure, and transport exception never auto-retry", async (context) => {
  for (const status of ["ambiguous", "timeout", "failed"]) {
    await context.test(status, async () => {
      const setup = writer([async () => ({ status, latencyMs: 10 })]);
      await expectInvalid(() => setup.value.write(makeBatch(25)));
      assert.equal(setup.transport.requests.length, 1);
      assert.equal(setup.evidence[0].transportDisposition, status);
    });
  }
  await context.test("exception", async () => {
    const setup = writer([
      async () => {
        throw new Error("opaque credential-bearing transport error");
      },
    ]);
    await expectInvalid(() => setup.value.write(makeBatch(25)));
    assert.equal(setup.transport.requests.length, 1);
    assert.equal(setup.evidence[0].transportDisposition, "exception");
  });
});

test("attempt evidence is hash-only/redacted and sink failure blocks output", async () => {
  const setup = writer([(request) => success(request)]);
  await setup.value.write(makeBatch(25));
  const serialized = JSON.stringify(setup.evidence);
  assert.doesNotMatch(serialized, /Hands demonstrate irrigation/u);
  assert.doesNotMatch(serialized, /outputText|requestBytes|systemPrompt|prompt_core/u);
  assert.match(setup.evidence[0].requestSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.match(setup.evidence[0].responseSha256, /^sha256:[0-9a-f]{64}$/u);

  const transport = new ScriptedTransport([(request) => success(request)]);
  const blocked = new RunwarePromptWriter({
    transport,
    evidenceSink: {
      record: () => {
        throw new Error("sink unavailable");
      },
    },
    maximumBatchCostUsd: 0.01,
  });
  await expectInvalid(() => blocked.write(makeBatch(25)));
});

test("constructor rejects missing finite cost authority", () => {
  const transport = new ScriptedTransport([]);
  for (const maximumBatchCostUsd of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () =>
        new RunwarePromptWriter({
          transport,
          evidenceSink: { record: () => undefined },
          maximumBatchCostUsd,
        }),
      TypeError,
    );
  }
});

test("no-graphics requests and bounded repairs preserve legacy inputs and reject chart facts", async () => {
  const batch = makeBatch(1);
  const original = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "physical-placement-v2",
  );
  const legacyRetry = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    2,
    original.requestSha256,
    1,
    "physical-placement-v2",
  );
  const repaired = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    2,
    original.requestSha256,
    1,
    "physical-placement-v2",
    true,
  );
  const current = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "no-graphics-v1");
  assert.equal(
    repaired.request.settings.systemPrompt,
    legacyRetry.request.settings.systemPrompt + "\n" + PROMPT_CONTENT_REPAIR_INSTRUCTION,
  );
  assert.deepEqual(repaired.request.messages, legacyRetry.request.messages);
  assert.notEqual(repaired.request.taskUUID, legacyRetry.request.taskUUID);
  assert.notEqual(repaired.requestSha256, legacyRetry.requestSha256);
  assert.equal(current.requestVersion, "runware-gemini-3.5-flash-prompt-request-v28");
  assert.ok(
    current.request.settings.systemPrompt.includes(PHYSICAL_PLACEMENT_V2_WRITER_INSTRUCTION),
  );
  assert.ok(current.request.settings.systemPrompt.endsWith(PROMPT_CONTENT_REPAIR_INSTRUCTION));
  for (const facts of [
    {
      literal_subject: "A hand drawn paper sea chart with a compass rose",
      action: "Lying flat on a wooden table",
      environment: "Dimly lit ship cabin",
    },
    {
      literal_subject: "A hand holding a brass divider compass",
      action: "marking a point on a paper sea chart",
      environment: "A wooden table inside a ship cabin",
    },
  ]) {
    let calls = 0;
    const writer = new RunwarePromptWriter({
      requestPolicy: "no-graphics-v1",
      semanticQualityMode: "advisory",
      maximumBatchCostUsd: 1,
      transport: {
        dispatch: async (request) => {
          calls++;
          return success(request, { change: (rows) => rows.map((row) => ({ ...row, ...facts })) });
        },
      },
      evidenceSink: { record() {} },
    });
    await assert.rejects(writer.write(batch));
    assert.equal(calls, 1);
  }
});

test("v29 forbids narrated writing and label reading without changing v28 identity", () => {
  const batch = makeBatch(1);
  const v28 = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "no-graphics-v1");
  const v29 = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "no-graphics-v2");
  assert.equal(v29.requestVersion, "runware-gemini-3.5-flash-prompt-request-v29");
  assert.notEqual(v29.request.taskUUID, v28.request.taskUUID);
  assert.deepEqual(v29.request.messages, v28.request.messages);
  assert.ok(v29.request.settings.systemPrompt.startsWith(v28.request.settings.systemPrompt + "\n"));
  assert.ok(v29.request.settings.systemPrompt.includes("narration explicitly mentions writing"));
  assert.ok(v29.request.settings.systemPrompt.includes("never a pen or pencil writing on paper"));
  assert.ok(v29.request.settings.systemPrompt.includes("unmarked surfaces"));
  assert.equal(
    buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "no-graphics-v1").requestBytes,
    v28.requestBytes,
  );
});

test("v30 async delivery preserves v29 instructions and sealed legacy identities", () => {
  const batch = makeBatch(1);
  const legacy = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "no-graphics-v2");
  const current = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "no-graphics-async-v1",
  );
  assert.equal(legacy.request.deliveryMethod, "sync");
  assert.equal(current.request.deliveryMethod, "async");
  assert.equal(current.requestVersion, "runware-gemini-3.5-flash-prompt-request-v30");
  assert.notEqual(current.request.taskUUID, legacy.request.taskUUID);
  assert.deepEqual(current.request.settings, legacy.request.settings);
  assert.deepEqual(current.request.messages, legacy.request.messages);
  const replacement = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    2,
    current.requestSha256,
    1,
    "no-graphics-async-v1",
    "no-text-v2",
  );
  assert.equal(replacement.request.deliveryMethod, "async");
  assert.equal(replacement.requestVersion, current.requestVersion);
  assert.equal(replacement.request.settings.systemPrompt, current.request.settings.systemPrompt);
  assert.notEqual(replacement.request.taskUUID, current.request.taskUUID);
  assert.equal(replacement.retryOfRequestSha256, current.requestSha256);
  assert.equal(
    buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "no-graphics-v2").requestBytes,
    legacy.requestBytes,
  );
});

test("bounded v2 repairs use distinct identities and preserve v1 request bytes", () => {
  const batch = makeBatch(1);
  for (const policy of [
    "legacy",
    "physical-placement-v1",
    "physical-placement-v2",
    "no-graphics-v1",
  ]) {
    const first = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, policy);
    const v1 = buildRunwarePromptRequest(
      batch,
      batch.scenes,
      2,
      first.requestSha256,
      1,
      policy,
      true,
    );
    const v2 = buildRunwarePromptRequest(
      batch,
      batch.scenes,
      2,
      first.requestSha256,
      1,
      policy,
      "no-text-v2",
    );
    assert.notEqual(v1.request.taskUUID, v2.request.taskUUID);
    assert.deepEqual(v1.request.messages, v2.request.messages);
    assert.equal(v2.requestVersion, "runware-prompt-content-repair-v2");
    assert.ok(v2.request.settings.systemPrompt.startsWith(v1.request.settings.systemPrompt + "\n"));
    assert.ok(v2.request.settings.systemPrompt.includes("never a pen or pencil writing on paper"));
    assert.equal(
      buildRunwarePromptRequest(batch, batch.scenes, 2, first.requestSha256, 1, policy, true)
        .requestBytes,
      v1.requestBytes,
    );
  }
});

test("physical surface projection preserves relationships and rejects text-bearing ambiguity", () => {
  for (const [source, expected] of [
    [
      "An unmarked white shelf tag with a blank yellow corner",
      "An unmarked white shelf card with a blank yellow corner",
    ],
    [
      "Two unmarked white shelf tags side by side on a metal shelf edge",
      "Two unmarked white shelf cards side by side on a metal shelf edge",
    ],
    [
      "a bottle with a blank green and brown label",
      "a bottle with an unmarked green and brown surface",
    ],
    [
      "an unmarked price tag holder on a metal shelf edge",
      "an unmarked card holder on a metal shelf edge",
    ],
    ["A blank, unmarked price tag on a grocery shelf", "an unmarked card on a grocery shelf"],
    [
      "A finger pointing at a small blank white price tag",
      "A finger pointing at a small unmarked white card",
    ],
    [
      "An unmarked paper shelf tag attached to a metal shelf",
      "An unmarked paper shelf card attached to a metal shelf",
    ],
    ["Blank labels on the jars", "unmarked surfaces on the jars"],
    ["staring closely at an unmarked bottle label", "staring closely at an unmarked bottle label"],
    [
      "A shopper beside a blank label on a bottle",
      "A shopper beside an unmarked surface on a bottle",
    ],
    ["A blank label on an unmarked bottle", "an unmarked surface on an unmarked bottle"],
    ["A blank shelf tag on an unmarked shelf", "an unmarked shelf card on an unmarked shelf"],
    [
      "Two small, blank, unmarked white shelf tags side-by-side.",
      "Two small, unmarked white shelf cards side-by-side.",
    ],
    [
      "Two blank price cards side by side on the grocery shelf.",
      "Two unmarked cards side by side on the grocery shelf.",
    ],
  ]) {
    assert.equal(projectTextFreePhysicalSurfaces(source), expected);
    assert.equal(projectTextFreePhysicalSurfaces(expected), expected);
  }
  assert.equal(
    projectTextFreePhysicalSurfaces("staring closely at an unmarked bottle label"),
    "staring closely at an unmarked bottle label",
  );
  assert.equal(
    projectTextFreePhysicalSurfaces("staring closely at an unmarked bottle label", {
      includeProductContainerModifiers: true,
    }),
    "staring closely at an unmarked bottle surface",
  );
  for (const source of [
    "An unmarked white shelf tag with a yellow corner number",
    "A blank green and brown label with printed text",
    "A blank shelf tag with a price in its corner",
    "A blank label on a shelf edge with a portrait",
    "Honey on a blank shelf tag",
    "5 on a blank label",
    "a blank label Honey",
    "a blank label with printed text",
    "a blank price tag on a branded shelf",
    "a photo of a chef on a blank label",
    "a blank label with a portrait",
    "a blank label reading Honey",
    "reading a portrait printed on an unmarked bottle label",
    "pointing at a printed label on a jar",
    "an unmarked shelf tag with a barcode",
    "Honey on an unmarked red-labeled bottle",
    "Honey on the small blank shelf tag",
    "rea\u0000ding Honey from a blank label",
  ]) {
    assert.equal(projectTextFreePhysicalSurfaces(source), source);
  }
});

test("v31 structured JSON and corrective subset preserve valid original scenes and provenance", async () => {
  const batch = makeBatch(3);
  const original = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "validated-scenes-v1",
  );
  const source = output(original, {
    change: (rows) => {
      rows[1].literal_subject = "A portrait illustration on a bottle label";
      return rows;
    },
  });
  const correction = buildRunwarePromptCorrection(batch, source);
  assert.ok(correction);
  assert.deepEqual(correction.failedSceneIds, [batch.scenes[1].sceneId]);
  assert.deepEqual(correction.failures, [
    { sceneId: batch.scenes[1].sceneId, field: "literal_subject", reason: "hard_conflict" },
  ]);
  const repair = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    2,
    original.requestSha256,
    1,
    "validated-scenes-v1",
    "no-text-v2",
    correction,
  );
  assert.equal(original.requestVersion, "runware-gemini-3.5-flash-prompt-request-v31");
  assert.equal(original.request.outputFormat, "JSON");
  assert.deepEqual(original.request.jsonSchema, repair.request.jsonSchema);
  assert.deepEqual(original.request.settings, repair.request.settings);
  assert.deepEqual(
    payload(repair).scenes.map((s) => s.scene_id),
    correction.failedSceneIds,
  );
  assert.equal(payload(repair).correction.source_output_text, source);
  assert.notEqual(repair.request.taskUUID, original.request.taskUUID);
  const transport = new ScriptedTransport([(request) => success(request)]),
    evidence = [];
  const writer = new RunwarePromptWriter({
    transport,
    evidenceSink: {
      record(value) {
        evidence.push(value);
      },
    },
    maximumBatchCostUsd: 0.25,
    requestPolicy: "validated-scenes-v1",
    semanticQualityMode: "advisory",
    contentRepair: "no-text-v2",
    correction,
  });
  const result = await writer.write(batch, original.requestSha256);
  const originalRows = JSON.parse(source).scenes;
  assert.deepEqual(
    result.scenes.map((s) => s.scene_id),
    batch.scenes.map((s) => s.sceneId),
  );
  assert.deepEqual(result.scenes[0], originalRows[0]);
  assert.deepEqual(result.scenes[2], originalRows[2]);
  assert.deepEqual(evidence[0].acceptedSceneIds, correction.failedSceneIds);
  assert.deepEqual(evidence[0].reusedSceneIds, [batch.scenes[0].sceneId, batch.scenes[2].sceneId]);
  assert.equal(evidence[0].sourceResponseSha256, correction.sourceResponseSha256);
  assert.equal(
    evidence[0].responseSha256,
    `sha256:${createHash("sha256").update(output(transport.requests[0])).digest("hex")}`,
  );
  assert.equal(transport.requests.length, 1);
});

for (const policy of ["runware-luna-grounded-v2", "runware-luna-grounded-v3"]) {
  test(`Luna ${policy} partial correction preserves the sealed eight-scene budget table`, () => {
    const base = makeBatch(8);
    const failedOrdinals = [1, 4, 7];
    const batch = {
      ...base,
      literalCharacterLimits: Object.fromEntries(
        base.scenes.map((scene, index) => [
          scene.sceneId,
          failedOrdinals.includes(index) ? 90 : 300,
        ]),
      ),
    };
    const original = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, policy);
    const source = output(original, {
      change: (rows) =>
        rows.map((row, index) =>
          failedOrdinals.includes(index)
            ? {
                ...row,
                environment:
                  "An irrigation valve on dry farm soil beside the ordinary water channel in the open field.",
              }
            : row,
        ),
    });
    const correction = buildRunwarePromptCorrection(batch, source, policy);
    assert.deepEqual(
      correction.failedSceneIds,
      failedOrdinals.map((index) => batch.scenes[index].sceneId),
    );
    const replacement = buildRunwarePromptRequest(
      batch,
      batch.scenes,
      2,
      original.requestSha256,
      1,
      policy,
      "no-text-v2",
      correction,
    );
    assert.equal(replacement.request.settings.systemPrompt, original.request.settings.systemPrompt);
    assert.deepEqual(replacement.request.jsonSchema, original.request.jsonSchema);
    assert.deepEqual(
      payload(replacement).scenes.map((scene) => scene.scene_id),
      correction.failedSceneIds,
    );
    assert.equal(payload(replacement).scenes.length, 3);
    for (const scene of batch.scenes)
      assert.ok(
        replacement.request.settings.systemPrompt.includes(
          `${scene.sceneId}: ${batch.literalCharacterLimits[scene.sceneId]} characters`,
        ),
      );
  });
}

test("Luna correction keeps the original strict schema while requesting only failed scenes", async () => {
  const batch = { ...makeBatch(3), literalCharacterLimit: 168 };
  const original = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const source = output(original, {
    change: (rows) => {
      rows[1].literal_subject = "A portrait illustration on a bottle label";
      return rows;
    },
  });
  const correction = buildRunwarePromptCorrection(batch, source, "runware-luna-grounded-v1");
  assert.ok(correction);
  const replacement = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    2,
    original.requestSha256,
    1,
    "runware-luna-grounded-v1",
    false,
    correction,
  );
  assert.deepEqual(replacement.request.jsonSchema, original.request.jsonSchema);
  assert.deepEqual(
    JSON.parse(replacement.request.messages[0].content).scenes.map((scene) => scene.scene_id),
    correction.failedSceneIds,
  );

  const transport = new ScriptedTransport([
    (request) =>
      success(request, {
        outputText: output(request, {
          change: (rows) => [
            ...rows,
            {
              ...rows[0],
              scene_id: batch.scenes.find((scene) => scene.sceneId !== correction.failedSceneIds[0])
                .sceneId,
            },
          ],
        }),
      }),
  ]);
  const writer = new RunwarePromptWriter({
    requestPolicy: "runware-luna-grounded-v1",
    correction,
    transport,
    evidenceSink: { record() {} },
    maximumBatchCostUsd: 0.01,
  });
  await assert.rejects(() => writer.write(batch, original.requestSha256));
  assert.deepEqual(transport.requests[0].request.jsonSchema, original.request.jsonSchema);
  assert.deepEqual(
    JSON.parse(transport.requests[0].request.messages[0].content).scenes.map(
      (scene) => scene.scene_id,
    ),
    correction.failedSceneIds,
  );
});

test("v31 correction refuses forged diagnostics, schema drift and oversized source before dispatch", async () => {
  const batch = makeBatch(2),
    original = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "validated-scenes-v1");
  const source = output(original, {
    change: (rows) => {
      rows[0].action = "Writing a price on a label";
      return rows;
    },
  });
  const correction = buildRunwarePromptCorrection(batch, source);
  assert.ok(correction);
  for (const changed of [
    { ...correction, sourceResponseSha256: `sha256:${"0".repeat(64)}` },
    { ...correction, failedSceneIds: [batch.scenes[1].sceneId] },
    { ...correction, failures: [] },
  ]) {
    const transport = new ScriptedTransport([]);
    const writer = new RunwarePromptWriter({
      transport,
      evidenceSink: { record() {} },
      maximumBatchCostUsd: 0.25,
      requestPolicy: "validated-scenes-v1",
      semanticQualityMode: "advisory",
      correction: changed,
    });
    await assert.rejects(() => writer.write(batch, original.requestSha256));
    assert.equal(transport.requests.length, 0);
  }
  for (const changed of [
    "{",
    JSON.stringify({ ...JSON.parse(source), batch_id: "other" }),
    JSON.stringify({ ...JSON.parse(source), scenes: JSON.parse(source).scenes.slice(1) }),
  ])
    assert.equal(buildRunwarePromptCorrection(batch, changed), null);
  assert.equal(buildRunwarePromptCorrection(batch, output(original)), null);
  const oversized = output(original, {
    change: (rows) => {
      rows[0].action = "Writing on a label";
      rows[1].prompt_core = "physical evidence ".repeat(10000);
      return rows;
    },
  });
  const largeCorrection = buildRunwarePromptCorrection(batch, oversized);
  assert.ok(largeCorrection);
  const transport = new ScriptedTransport([]),
    writer = new RunwarePromptWriter({
      transport,
      evidenceSink: { record() {} },
      maximumBatchCostUsd: 0.25,
      requestPolicy: "validated-scenes-v1",
      semanticQualityMode: "advisory",
      correction: largeCorrection,
    });
  await assert.rejects(() => writer.write(batch, original.requestSha256), /input budget/);
  assert.equal(transport.requests.length, 0);
});

test("v31 correction rejects extra or forbidden repaired scenes without another dispatch", async () => {
  const batch = makeBatch(2),
    original = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "validated-scenes-v1");
  const correction = buildRunwarePromptCorrection(
    batch,
    output(original, {
      change: (rows) => {
        rows[1].action = "Writing on a label";
        return rows;
      },
    }),
  );
  for (const step of [
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].action = "Drawing a diagram";
          return rows;
        },
      }),
    (request) =>
      success(request, {
        change: (rows) => [...rows, { ...rows[0], scene_id: batch.scenes[0].sceneId }],
      }),
  ]) {
    const transport = new ScriptedTransport([step]),
      writer = new RunwarePromptWriter({
        transport,
        evidenceSink: { record() {} },
        maximumBatchCostUsd: 0.25,
        requestPolicy: "validated-scenes-v1",
        semanticQualityMode: "advisory",
        correction,
      });
    await assert.rejects(() => writer.write(batch, original.requestSha256));
    assert.equal(transport.requests.length, 1);
  }
});

function groundingCase(source, subject, action, environment, options = {}) {
  const base = makeBatch(1),
    batch = {
      ...base,
      storyContext:
        options.storyContext ??
        "Subject: barbecue sauce | Visual facts: ribs being brushed with sauce; grocery store aisles | Continuity: Mira, a retired grocery cashier | Resolve: she = Mira",
      scenes: [
        {
          ...base.scenes[0],
          phrase: source,
          sentenceContext: source,
          priorContext: options.prior ?? null,
          nextContext: options.next ?? null,
        },
      ],
    };
  const original = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "validated-scenes-v1",
  );
  const raw = output(original, {
    change: (rows) => {
      Object.assign(rows[0], { literal_subject: subject, action, environment });
      return rows;
    },
  });
  return { batch, raw };
}

test("v32 rejects observed source contradictions while v31 stays reconstruction-compatible", () => {
  for (const [source, subject, action, environment, reason] of [
    [
      "A person is not in a kitchen stirring sauce.",
      "A chef",
      "stirring a large pot",
      "A commercial kitchen",
      "explicit_negation_conflict",
    ],
    [
      "The worker does not pour water into the jar.",
      "A worker",
      "pouring water into a jar",
      "A workshop",
      "explicit_negation_conflict",
    ],
    [
      "At the grocery register, I am retired and free to share my opinions.",
      "A hand holding a basting brush",
      "coating ribs with sauce",
      "An outdoor grill",
      "global_topic_substitution",
    ],
    [
      "This hardly has any honey. That is the familiar option.",
      "A basting brush",
      "spreading sauce onto ribs",
      "A grill",
      "global_topic_substitution",
    ],
    [
      "The famous chef smiling from the label is a portrait.",
      "A chef",
      "smiles warmly",
      "A kitchen",
      "depiction_transfer",
    ],
    [
      "A chef holds a photo of a farmer.",
      "A farmer",
      "standing beside a field",
      "A rural farm",
      "depiction_transfer",
    ],
  ]) {
    const { batch, raw } = groundingCase(source, subject, action, environment);
    assert.equal(buildRunwarePromptCorrection(batch, raw), null);
    const correction = buildRunwarePromptCorrection(batch, raw, "grounded-scenes-v1");
    assert.ok(correction, source);
    assert.ok(
      correction.failures.some((f) => f.reason === reason),
      source,
    );
    const lunaCorrection = buildRunwarePromptCorrection(batch, raw, "runware-luna-grounded-v1");
    assert.ok(lunaCorrection, source);
    assert.ok(
      lunaCorrection.failures.some((failure) => failure.reason === reason),
      source,
    );
    const lunaReplacement = buildRunwarePromptRequest(
      batch,
      batch.scenes,
      2,
      `sha256:${createHash("sha256").update(raw).digest("hex")}`,
      1,
      "runware-luna-grounded-v1",
      false,
      lunaCorrection,
    );
    assert.equal(lunaReplacement.request.model, RUNWARE_LUNA_PROMPT_MODEL);
    assert.equal(lunaReplacement.request.settings.thinkingLevel, "low");
    assert.deepEqual(
      JSON.parse(lunaReplacement.request.messages[0].content).correction.failed_scene_ids,
      lunaCorrection.failedSceneIds,
    );
  }
});

test("v32 keeps legitimate negation, paraphrase, actors and local visual evidence", () => {
  for (const [source, subject, action, environment, options] of [
    [
      "The chef is not only stirring but tasting the sauce.",
      "A chef",
      "stirring sauce in a pot",
      "A kitchen",
    ],
    ["Do not forget to stir the sauce.", "A chef", "stirring sauce in a pot", "A kitchen"],
    ["The chef cannot stop stirring.", "A chef", "stirring sauce in a pot", "A kitchen"],
    [
      "The chef is not stirring; the assistant is stirring.",
      "An assistant",
      "stirring sauce in a pot",
      "A kitchen",
    ],
    [
      "The chef waits nearby. He is not stirring the sauce. The assistant stirs it.",
      "An assistant",
      "stirring sauce in a pot",
      "A kitchen",
    ],
    ["The chef is stirring the sauce.", "A chef", "stirring sauce in a pot", "A kitchen"],
    [
      "The chef is not in the kitchen stirring; he is stirring outside.",
      "A chef",
      "stirring sauce in a pot",
      "An outdoor courtyard",
    ],
    ["A chef smiles beside a portrait.", "A chef with a visible torso", "smiling", "A kitchen"],
    ["A chef holds a photo of a farmer.", "A chef", "holding an unmarked card", "A kitchen"],
    [
      "A chef stands beside a portrait of a chef.",
      "A chef",
      "standing beside an unmarked wall",
      "A kitchen",
    ],
    [
      "A chef poses beside a portrait of the chef.",
      "A chef",
      "posing beside an unmarked wall",
      "A kitchen",
    ],
    [
      "A smiling chef is on the bottle label.",
      "A shopper",
      "inspecting an unmarked bottle",
      "A grocery store",
    ],
    [
      "She pauses at the checkout.",
      "Mira, a retired cashier",
      "pausing at the grocery counter",
      "A supermarket",
      { prior: "Mira, the retired cashier, is shopping" },
    ],
    ["A cyclist services a bicycle.", "A rider and bike", "repairing the cycle", "A workshop"],
    [
      "A hand holds a basting brush near the ribs.",
      "A hand holding a basting brush",
      "coating ribs with sauce",
      "An outdoor grill",
    ],
    [
      "Look closely at this.",
      "A basting brush",
      "coating ribs with sauce",
      "An outdoor grill",
      { prior: "Ribs are being brushed with sauce" },
    ],
    [
      "Una persona está pincelando costillas con salsa.",
      "A basting brush",
      "coating ribs with sauce",
      "An outdoor grill",
    ],
    [
      "Un cocinero cubre costillas con salsa.",
      "A basting brush",
      "coating ribs with sauce",
      "An outdoor grill",
    ],
    ["She is there.", "Mira", "standing at the counter", "A grocery store"],
  ]) {
    const { batch, raw } = groundingCase(source, subject, action, environment, options);
    assert.equal(buildRunwarePromptCorrection(batch, raw, "grounded-scenes-v1"), null, source);
  }
});

test("v32 context scopes identity and seals new request bytes without changing v31", () => {
  const { batch } = groundingCase(
    "She looks at the unmarked bottle",
    "Mira",
    "inspecting the bottle",
    "A grocery aisle",
  );
  const old = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "validated-scenes-v1"),
    fresh = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "grounded-scenes-v1");
  assert.equal(fresh.requestVersion, "runware-gemini-3.5-flash-prompt-request-v32");
  assert.notEqual(old.requestSha256, fresh.requestSha256);
  assert.equal(payload(old).story_context, batch.storyContext);
  assert.doesNotMatch(payload(fresh).story_context, /Subject:|Visual facts:|ribs/);
  assert.match(payload(fresh).story_context, /Mira/);
  assert.deepEqual(old.request.jsonSchema, fresh.request.jsonSchema);
  assert.deepEqual(
    buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, "validated-scenes-v1"),
    old,
  );
});

test("v32 scopes a denied action to its object and preserves denied kitchen actions", () => {
  const differentObject = groundingCase(
    "Shoppers never look at the corner of a tag. They notice a large bottle.",
    "A shopper",
    "looking at a large unmarked bottle on a shelf",
    "A grocery store aisle",
  );
  assert.equal(
    buildRunwarePromptCorrection(differentObject.batch, differentObject.raw, "grounded-scenes-v1"),
    null,
  );
  for (const [source, subject, action, environment] of [
    [
      "People never look at that bottle. They look at the aisle.",
      "A shopper",
      "looking at the bottle",
      "A grocery store aisle",
    ],
    [
      "A chef is not in the kitchen stirring; he is stirring outside.",
      "A chef",
      "stirring a large pot",
      "A kitchen",
    ],
    [
      "A person is not in a kitchen stirring sauce.",
      "A chef",
      "stirring a large pot",
      "A commercial kitchen",
    ],
  ]) {
    const { batch, raw } = groundingCase(source, subject, action, environment);
    const correction = buildRunwarePromptCorrection(batch, raw, "grounded-scenes-v1");
    assert.ok(
      correction?.failures.some((failure) => failure.reason === "explicit_negation_conflict"),
      source,
    );
    assert.equal(buildRunwarePromptCorrection(batch, raw, "validated-scenes-v1"), null);
  }
});

test("v32 catches an imagined packaging actor made real in any scene field", () => {
  const source = "A jar has painted packaging that wants you to picture an old man tending a fire.";
  for (const [subject, action, environment, field] of [
    ["An older man", "tending a smoking grill", "A backyard patio", "literal_subject"],
    ["An unmarked bottle", "being held by an older man", "A backyard patio", "action"],
    [
      "An unmarked glass bottle of barbecue sauce",
      "resting on a wooden outdoor table",
      "A backyard patio with an older man tending a smoking grill in the blurred background",
      "environment",
    ],
  ]) {
    const { batch, raw } = groundingCase(source, subject, action, environment, {
      next: "That package image suggests an imagined scene.",
    });
    const correction = buildRunwarePromptCorrection(batch, raw, "grounded-scenes-v1");
    assert.ok(
      correction?.failures.some(
        (failure) => failure.field === field && failure.reason === "depiction_transfer",
      ),
      field,
    );
    assert.equal(buildRunwarePromptCorrection(batch, raw, "validated-scenes-v1"), null);
  }
  for (const [source, subject, action, environment] of [
    [
      "There is a picture on the wall while a man stands by a table.",
      "A man",
      "standing by a table",
      "A room with an unmarked wall",
    ],
    [
      "A picture of the city is nearby while a man stands by a table.",
      "A man",
      "standing by a table",
      "A room with an unmarked wall",
    ],
    ["A chef holds a photo of a farmer.", "A chef", "holding an unmarked card", "A kitchen"],
    [
      "A man stands beside a picture of an old man.",
      "A man",
      "standing beside an unmarked wall",
      "A room",
    ],
    ["Imagine a chef stirring soup.", "A chef", "stirring soup", "A kitchen"],
    ["Picture an old man tending a fire.", "An older man", "tending a fire", "A backyard"],
    [
      "A chef dances beside a photo of the chef.",
      "A chef",
      "dancing beside an unmarked wall",
      "A kitchen",
    ],
    [
      "A chef waves beside a photo of the chef.",
      "A chef",
      "waving beside an unmarked wall",
      "A kitchen",
    ],
    [
      "A chef holds a bottle with a farmer smiling at you from the label.",
      "A chef",
      "holding an unmarked bottle",
      "A kitchen",
    ],
  ]) {
    const { batch, raw } = groundingCase(source, subject, action, environment);
    assert.equal(buildRunwarePromptCorrection(batch, raw, "grounded-scenes-v1"), null, source);
  }
});
