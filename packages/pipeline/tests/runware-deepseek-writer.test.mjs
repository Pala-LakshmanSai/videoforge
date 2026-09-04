import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  IN_IMAGE_SHOT_ROLES,
  PipelineDomainError,
  RUNWARE_PROMPT_MAX_OUTPUT_TOKENS,
  RUNWARE_PROMPT_OUTPUT_FIXED_TOKENS,
  RUNWARE_PROMPT_OUTPUT_TOKEN_HEADROOM,
  RUNWARE_PROMPT_OUTPUT_TOKENS_PER_SCENE,
  RUNWARE_PROMPT_MODEL,
  RUNWARE_PROMPT_REQUEST_VERSION,
  RunwarePromptWriter,
  SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
  buildPromptBatch,
  buildRunwarePromptRequest,
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
  return JSON.stringify({ batch_id: requestPayload.batch_id, scenes: changed });
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

function writer(steps, maximumBatchCostUsd = 0.01) {
  const transport = new ScriptedTransport(steps);
  const evidence = [];
  return {
    transport,
    evidence,
    value: new RunwarePromptWriter({
      transport,
      evidenceSink: { record: (item) => evidence.push(item) },
      maximumBatchCostUsd,
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
    assert.equal(request.request.outputFormat, "JSON");
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
    assert.equal(request.request.model, "deepseek:v4@flash");
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
    assert.equal(request.request.jsonSchema.strict, true);
    assert.doesNotMatch(
      JSON.stringify(request.request.jsonSchema),
      /"(?:minLength|maxLength|uniqueItems)"/u,
    );
    assert.equal(request.request.jsonSchema.schema.properties.scenes.minItems, count);
    assert.equal(request.request.jsonSchema.schema.properties.scenes.maxItems, count);
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
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /never substitute symbolism or metaphor/u);
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /style_treatment object as visual treatment/u);
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /without importing concrete people, places, objects, products, logos/u,
  );
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /believable anatomy, materials, scale/u);
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /translate its meaning into .*concrete visual evidence/u,
  );
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /authoritative structured scene facts/u);
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /downstream compiler derives the final literal image description/u,
  );
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /preserve that action semantically in action/u);
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /static, stative, or abstract/u);
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /Never substitute a contradictory action/u);
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /When narration names a location, preserve that location in environment/u,
  );
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /at most 12 unique continuity_tags/u);
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
    storyContext:
      "A household explainer about a brown hydrogen peroxide bottle kept in a medicine cabinet.",
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
            "A hand with a small superficial cut beside a brown hydrogen peroxide bottle";
          rows[0].action = "bubbling on contact with the fresh cut";
          rows[0].environment =
            "a lived-in home bathroom counter below an open medicine cabinet, with a cotton pad nearby";
          rows[0].prompt_core =
            "Hydrogen peroxide bubbles on a small fresh cut beside its brown bottle on a lived-in bathroom counter below an open medicine cabinet.";
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
    storyContext:
      "A household explainer about a brown hydrogen peroxide bottle stored in a medicine cabinet.",
    scenes: [
      {
        ...base.scenes[0],
        phrase: "Hydrogen peroxide is a common household cleaning product",
        sentenceContext: "Hydrogen peroxide is a common household cleaning product.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A brown hydrogen peroxide bottle";
          rows[0].action = "resting unopened on a medicine cabinet shelf";
          rows[0].environment = "inside a lived-in home medicine cabinet";
          rows[0].prompt_core =
            "A brown hydrogen peroxide bottle rests unopened on a worn shelf inside a lived-in home medicine cabinet.";
          return rows;
        },
      }),
  ]);
  const result = await setup.value.write(batch);
  assert.equal(result.scenes.length, 1);
});

test("scene relevance keeps plural household uses and minor cuts out of action inference", async () => {
  for (const phrase of [
    "Hydrogen peroxide has many household uses",
    "Hydrogen peroxide is a cleaning product for minor cuts",
  ]) {
    const base = makeBatch(1);
    const batch = {
      ...base,
      storyContext:
        "A household explainer about a brown hydrogen peroxide bottle stored in a medicine cabinet.",
      scenes: [{ ...base.scenes[0], phrase, sentenceContext: `${phrase}.` }],
    };
    const setup = writer([
      (request) =>
        success(request, {
          change: (rows) => {
            rows[0].literal_subject = "A brown hydrogen peroxide bottle";
            rows[0].action = "resting unopened on a medicine cabinet shelf";
            rows[0].environment = "inside a lived-in home medicine cabinet";
            rows[0].prompt_core =
              "A brown hydrogen peroxide bottle rests unopened on a worn shelf inside a lived-in home medicine cabinet.";
            return rows;
          },
        }),
    ]);
    const result = await setup.value.write(batch);
    assert.equal(result.scenes.length, 1, phrase);
  }
});

test("scene relevance accepts a stored bottle rendered as resting in place", async () => {
  const base = makeBatch(1);
  const batch = {
    ...base,
    storyContext:
      "A household explainer about a brown hydrogen peroxide bottle stored in a medicine cabinet.",
    scenes: [
      {
        ...base.scenes[0],
        phrase: "A bottle of hydrogen peroxide tucked into the back of the medicine cabinet",
        sentenceContext:
          "A bottle of hydrogen peroxide tucked into the back of the medicine cabinet.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A brown hydrogen peroxide bottle";
          rows[0].action = "resting unopened on a cabinet shelf";
          rows[0].environment = "inside a lived-in home medicine cabinet";
          rows[0].prompt_core =
            "A brown hydrogen peroxide bottle rests unopened on a worn shelf inside a lived-in home medicine cabinet.";
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
        phrase: "back of the medicine cabinet just waiting for a scrape",
        sentenceContext:
          "Most of us have a bottle of hydrogen peroxide tucked into the back of the medicine cabinet just waiting for a scrape.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A brown hydrogen peroxide bottle";
          rows[0].action = "resting unopened at the back of the cabinet";
          rows[0].environment = "inside a lived-in home medicine cabinet";
          rows[0].prompt_core =
            "A brown hydrogen peroxide bottle rests unopened at the back of a lived-in home medicine cabinet shelf.";
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
        sentenceContext:
          "After years of daily use, the brown hydrogen peroxide bottle is tucked into the medicine cabinet.",
      },
    ],
  };
  const setup = writer([
    (request) =>
      success(request, {
        change: (rows) => {
          rows[0].literal_subject = "A worn brown hydrogen peroxide bottle";
          rows[0].action = "resting at the back of a medicine cabinet";
          rows[0].environment = "inside a lived-in home medicine cabinet";
          rows[0].prompt_core =
            "A worn brown hydrogen peroxide bottle rests at the back of a lived-in home medicine cabinet shelf.";
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
