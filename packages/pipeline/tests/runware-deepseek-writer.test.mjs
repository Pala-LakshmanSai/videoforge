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
} from "../dist/src/index.js";

const layouts = ["IMAGE_FULL", "SPLIT_RIGHT_IMAGE"];
const styleGuidance = [
  "authentic documentary photography",
  "warm analog film photography",
  "cool editorial photography",
  "humid reportage photography",
  "low-contrast archival photography",
];

function makeBatch(count = 25, styleIndex = 0) {
  const hashCharacter = "abcde"[styleIndex];
  return buildPromptBatch({
    batchId: `batch_${count}_${styleIndex}`,
    projectTitle: "Harvest Water Without Pumps",
    imageStyleVersionId: `style_version_${styleIndex + 1}`,
    styleProfileHash: `sha256:${hashCharacter.repeat(64)}`,
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
    literal_subject: scene.exact_phrase,
    action: `shows literal action ${options.marker ?? request.attemptIndex}`,
    environment: "an ordinary real-world farm setting",
    in_image_shot_role: scene.in_image_shot_role,
    lighting_context: "available practical daylight",
    continuity_tags: ["same_farmer", "dry_season"],
    prompt_core: `Close documentary view of practical irrigation work in an ordinary farm setting, marker ${options.marker ?? request.attemptIndex}`,
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
    assert.equal(payload(request).planner_guidance, styleGuidance[styleIndex]);
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
        "containing_sentence",
        "exact_phrase",
        "exact_phrase_sha256",
        "fixed_layout",
        "in_image_shot_role",
        "next_context",
        "prior_context",
        "scene_id",
      ].sort(),
    );
    assert.equal(
      payload(request).scenes[1].containing_sentence,
      "Hands demonstrate irrigation valve step 2.",
    );
    assert.equal(payload(request).scenes[1].prior_context, "Prior step 1");
    assert.equal(payload(request).scenes[1].next_context, "Next step 3");
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
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /pinned style's visual treatment/u);
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /without importing people, places, objects/u);
  assert.match(SCENE_PROMPT_WRITER_SYSTEM_PROMPT, /believable anatomy, materials, scale/u);
  assert.match(
    SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
    /translate its meaning into concrete visual evidence/u,
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

test("accepts concise visual paraphrases without requiring narration prose in prompt_core", async () => {
  const setup = writer([(request) => success(request)]);
  const result = await setup.value.write(makeBatch(25));
  assert.equal(result.scenes.length, 25);
  assert.ok(
    result.scenes.every((scene) =>
      scene.prompt_core.startsWith("Close documentary view of practical irrigation work"),
    ),
  );
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
          rows[2].action = "show a visible logo";
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
