import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicFixtureStyleAnalyzer,
  PipelineDomainError,
  QUALIFIED_GEMINI_STYLE_PROVIDER_SCHEMA_SHA256,
  QUALIFIED_GEMINI_STYLE_SYSTEM_PROMPT_SHA256,
  RUNWARE_GEMINI_STYLE_MODEL,
  RUNWARE_GEMINI_STYLE_PROVIDER_SCHEMA,
  RunwareGeminiStyleAnalyzer,
  buildStyleAnalyzerRequest,
  validateAndAssembleStyleProfile,
} from "../dist/src/index.js";

const NOW = Date.parse("2026-08-11T04:00:00.000Z");
const TASK_IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];

function makeRequest(count = 4) {
  return buildStyleAnalyzerRequest(
    Array.from({ length: count }, (_, index) => ({
      alias: `ref_${String(index + 1).padStart(2, "0")}`,
      derivativeSha256: `sha256:${"abcdef12"[index].repeat(64)}`,
      mimeType: "image/png",
      width: 1_024,
      height: 768,
      bytes: 4_096 + index,
    })),
  );
}

function resolvedReferences(request) {
  return request.references.map((reference) => ({
    alias: reference.alias,
    derivativeSha256: reference.derivativeSha256,
    imageUrl: `https://objects.example.test/private/${reference.alias}.png?private_signature=do-not-record`,
    expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
  }));
}

async function validOutput(request) {
  return new DeterministicFixtureStyleAnalyzer().analyze(request);
}

const validUsage = Object.freeze({
  promptTokens: 3_913,
  completionTokens: 2_963,
  totalTokens: 6_876,
  reasoningTokens: 1_747,
});

function success(transportRequest, output, options = {}) {
  return {
    status: "succeeded",
    taskUUID: options.taskUUID ?? transportRequest.request.taskUUID,
    taskType: options.taskType ?? "textInference",
    outputText: options.outputText ?? JSON.stringify(output),
    latencyMs: options.latencyMs ?? 25,
    usage: options.usage ?? validUsage,
    costUsd: options.costUsd ?? 0.03,
    finishReason: options.finishReason ?? "stop",
    providerModel: Object.hasOwn(options, "providerModel") ? options.providerModel : null,
  };
}

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

function setup(steps, options = {}) {
  const request = options.request ?? makeRequest();
  const resolved = options.resolved ?? resolvedReferences(request);
  const transport = new ScriptedTransport(steps);
  const evidence = [];
  let idIndex = 0;
  let resolverCalls = 0;
  const referenceResolver = options.referenceResolver ?? {
    resolve: async () => {
      resolverCalls += 1;
      return resolved;
    },
  };
  const value = new RunwareGeminiStyleAnalyzer({
    referenceResolver,
    taskIdSource: { next: () => (options.taskIds ?? TASK_IDS)[idIndex++] },
    clock: { nowMs: () => NOW },
    transport,
    evidenceSink: options.evidenceSink ?? { record: (item) => evidence.push(item) },
    maximumReferenceUrlLifetimeMs: options.maximumReferenceUrlLifetimeMs ?? 10 * 60_000,
  });
  return {
    request,
    resolved,
    transport,
    evidence,
    value,
    resolverCallCount: () => resolverCalls,
  };
}

async function expectInvalid(action) {
  await assert.rejects(
    action,
    (error) =>
      error instanceof PipelineDomainError && error.failure.code === "STYLE_OUTPUT_INVALID",
  );
}

test("pins the qualified Gemini request/schema and accepts one exact style result", async () => {
  const request = makeRequest();
  const output = await validOutput(request);
  const fixture = setup([(attempt) => success(attempt, output)], { request });
  assert.deepEqual(await fixture.value.analyze(request), output);
  assert.equal(fixture.resolverCallCount(), 1);
  assert.equal(fixture.transport.requests.length, 1);

  const attempt = fixture.transport.requests[0];
  assert.equal(attempt.request.model, RUNWARE_GEMINI_STYLE_MODEL);
  assert.equal(attempt.request.outputFormat, "JSON");
  assert.equal(attempt.request.jsonSchema.strict, true);
  assert.equal(attempt.request.settings.thinkingLevel, "low");
  assert.equal(attempt.request.settings.temperature, 0.1);
  assert.equal(attempt.request.settings.topP, 0.9);
  assert.equal(attempt.request.settings.maxTokens, 6_000);
  assert.equal(attempt.request.providerSettings.google.mediaResolution, "medium");
  assert.equal("seed" in attempt.request, false);
  assert.equal("tools" in attempt.request, false);
  assert.deepEqual(JSON.parse(attempt.requestBytes), [attempt.request]);
  assert.deepEqual(
    attempt.request.inputs.images,
    fixture.resolved.map((item) => item.imageUrl),
  );
  request.references.forEach((reference, index) =>
    assert.match(
      attempt.request.messages[0].content,
      new RegExp(`${reference.alias} = inputs\\.images\\[${index}\\]`, "u"),
    ),
  );

  const serializedSchema = JSON.stringify(RUNWARE_GEMINI_STYLE_PROVIDER_SCHEMA);
  for (const removed of [
    "$ref",
    "$schema",
    "$id",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minimum",
    "maximum",
  ])
    assert.equal(serializedSchema.includes(`"${removed}"`), false);
  assert.equal(
    QUALIFIED_GEMINI_STYLE_PROVIDER_SCHEMA_SHA256,
    "sha256:78ccf3137849250901ff017a461a33bf22daad757c86ec320fb87942231ebad3",
  );
  assert.equal(
    QUALIFIED_GEMINI_STYLE_SYSTEM_PROMPT_SHA256,
    "sha256:3a0f2d2e27852c0b6c3d657b3a1e851e0ea48764101b38d7b9863dc99d3ea2fa",
  );
  assert.equal(fixture.evidence[0].validationDisposition, "accepted");
  assert.match(fixture.evidence[0].styleProfileHash, /^sha256:[0-9a-f]{64}$/u);
});

test("retries the exact whole set once after deterministic validation failure", async () => {
  const request = makeRequest();
  const output = await validOutput(request);
  const invalid = structuredClone(output);
  invalid.summary = "";
  const fixture = setup(
    [(attempt) => success(attempt, invalid), (attempt) => success(attempt, output)],
    { request },
  );
  const result = await fixture.value.analyze(request);
  const trusted = await validateAndAssembleStyleProfile(request, output);
  assert.deepEqual(result, output);
  assert.equal(fixture.transport.requests.length, 2);
  assert.deepEqual(
    fixture.transport.requests.map((attempt) => attempt.referenceAliases),
    [
      request.references.map((reference) => reference.alias),
      request.references.map((reference) => reference.alias),
    ],
  );
  assert.equal(
    fixture.transport.requests[1].retryOfRequestSha256,
    fixture.transport.requests[0].requestSha256,
  );
  assert.notEqual(
    fixture.transport.requests[1].request.taskUUID,
    fixture.transport.requests[0].request.taskUUID,
  );
  assert.match(fixture.transport.requests[1].request.messages[0].content, /correcting only/u);
  assert.deepEqual(
    fixture.evidence.map((item) => item.validationDisposition),
    ["retry", "accepted"],
  );
  assert.equal(fixture.evidence[1].styleProfileHash, trusted.styleProfileHash);
});

test("refuses retry when its exact reservation would exceed the total cap", async () => {
  const request = makeRequest();
  const invalid = structuredClone(await validOutput(request));
  invalid.summary = "";
  const fixture = setup([(attempt) => success(attempt, invalid, { costUsd: 0.075 })], {
    request,
  });
  await expectInvalid(() => fixture.value.analyze(request));
  assert.equal(fixture.transport.requests.length, 1);
  assert.equal(fixture.evidence[0].validationDisposition, "rejected");
});

test("strict malformed and duplicate-key JSON may recover only through the one bounded retry", async (context) => {
  const request = makeRequest();
  const output = await validOutput(request);
  for (const [name, outputText] of [
    ["malformed", "{"],
    ["duplicate key", '{"summary":"first","summary":"second"}'],
  ]) {
    await context.test(name, async () => {
      const fixture = setup(
        [
          (attempt) => success(attempt, output, { outputText }),
          (attempt) => success(attempt, output),
        ],
        { request },
      );
      assert.deepEqual(await fixture.value.analyze(request), output);
      assert.equal(fixture.transport.requests.length, 2);
      assert.equal(fixture.evidence[0].validationErrorCode, "STYLE_OUTPUT_INVALID");
    });
  }
});

test("second deterministic semantic failure rejects without a third call", async () => {
  const request = makeRequest();
  const leaked = structuredClone(await validOutput(request));
  leaked.prompt_profile.positive_suffix = "copy the same person from every reference";
  const fixture = setup(
    [(attempt) => success(attempt, leaked), (attempt) => success(attempt, leaked)],
    { request },
  );
  await expectInvalid(() => fixture.value.analyze(request));
  assert.equal(fixture.transport.requests.length, 2);
  assert.deepEqual(
    fixture.evidence.map((item) => item.validationDisposition),
    ["retry", "rejected"],
  );
  assert.deepEqual(
    fixture.evidence.map((item) => item.validationErrorCode),
    ["STYLE_CONTENT_LEAKAGE", "STYLE_CONTENT_LEAKAGE"],
  );
});

test("response identity, usage, cost, finish, latency, and model drift never retry", async (context) => {
  const request = makeRequest();
  const output = await validOutput(request);
  const cases = [
    ["task UUID", { taskUUID: "33333333-3333-4333-8333-333333333333" }],
    ["task type", { taskType: "imageInference" }],
    [
      "usage",
      {
        usage: {
          promptTokens: 3_913,
          completionTokens: 2_963,
          totalTokens: 1,
          reasoningTokens: 1_747,
        },
      },
    ],
    ["cost", { costUsd: 0.081 }],
    ["finish", { finishReason: "length" }],
    ["latency", { latencyMs: -1 }],
    ["model", { providerModel: "google:gemini@mutable" }],
  ];
  for (const [name, options] of cases) {
    await context.test(name, async () => {
      const fixture = setup([(attempt) => success(attempt, output, options)], { request });
      await expectInvalid(() => fixture.value.analyze(request));
      assert.equal(fixture.transport.requests.length, 1);
      assert.equal(fixture.evidence[0].validationDisposition, "rejected");
    });
  }
});

test("ambiguous, timeout, failed, and thrown transports never retry", async (context) => {
  for (const disposition of ["ambiguous", "timeout", "failed", "exception"]) {
    await context.test(disposition, async () => {
      const step =
        disposition === "exception"
          ? () => {
              throw new Error("private transport detail");
            }
          : () => ({ status: disposition, latencyMs: 50 });
      const fixture = setup([step]);
      await expectInvalid(() => fixture.value.analyze(fixture.request));
      assert.equal(fixture.transport.requests.length, 1);
      assert.equal(fixture.evidence[0].transportDisposition, disposition);
    });
  }
});

test("resolver identity, URL, expiry, and exception failures stop before transport", async (context) => {
  const request = makeRequest();
  const valid = resolvedReferences(request);
  const cases = [
    ["reordered", () => valid.toReversed()],
    [
      "hash drift",
      () =>
        valid.map((item, index) =>
          index === 0 ? { ...item, derivativeSha256: `sha256:${"f".repeat(64)}` } : item,
        ),
    ],
    [
      "non-HTTPS",
      () => valid.map((item) => ({ ...item, imageUrl: item.imageUrl.replace("https:", "http:") })),
    ],
    [
      "expired",
      () => valid.map((item) => ({ ...item, expiresAt: new Date(NOW - 1).toISOString() })),
    ],
    [
      "overlong lifetime",
      () =>
        valid.map((item) => ({ ...item, expiresAt: new Date(NOW + 20 * 60_000).toISOString() })),
    ],
  ];
  for (const [name, mutate] of cases) {
    await context.test(name, async () => {
      const fixture = setup([], { request, resolved: mutate() });
      await expectInvalid(() => fixture.value.analyze(request));
      assert.equal(fixture.transport.requests.length, 0);
    });
  }
  await context.test("resolver exception", async () => {
    const fixture = setup([], {
      request,
      referenceResolver: {
        resolve: async () => {
          throw new Error("private resolver detail");
        },
      },
    });
    await expectInvalid(() => fixture.value.analyze(request));
    assert.equal(fixture.transport.requests.length, 0);
  });
});

test("retry requires a fresh UUID before any second dispatch", async () => {
  const request = makeRequest();
  const invalid = structuredClone(await validOutput(request));
  invalid.summary = "";
  const fixture = setup([(attempt) => success(attempt, invalid)], {
    request,
    taskIds: [TASK_IDS[0], TASK_IDS[0]],
  });
  await expectInvalid(() => fixture.value.analyze(request));
  assert.equal(fixture.transport.requests.length, 1);
});

test("redacted evidence excludes signed URLs, pixels, provider text, and resolver secrets", async () => {
  const request = makeRequest();
  const output = structuredClone(await validOutput(request));
  output.summary = "PRIVATE_PROVIDER_TRAIT_SENTINEL naturalistic treatment";
  const fixture = setup([(attempt) => success(attempt, output)], { request });
  await fixture.value.analyze(request);
  const serialized = JSON.stringify(fixture.evidence);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("private_signature"), false);
  assert.equal(serialized.includes("do-not-record"), false);
  assert.equal(serialized.includes("PRIVATE_PROVIDER_TRAIT_SENTINEL"), false);
  assert.equal(serialized.includes("inputs.images"), false);
});

test("fixed inputs replay exact request bytes and accepted hashes at zero implicit activity", async () => {
  const request = makeRequest();
  const output = await validOutput(request);
  const first = setup([(attempt) => success(attempt, output)], { request });
  const second = setup([(attempt) => success(attempt, output)], { request });
  assert.equal(first.transport.requests.length, 0);
  assert.equal(second.transport.requests.length, 0);
  await Promise.all([first.value.analyze(request), second.value.analyze(request)]);
  assert.equal(first.transport.requests[0].requestBytes, second.transport.requests[0].requestBytes);
  assert.equal(
    first.transport.requests[0].requestSha256,
    second.transport.requests[0].requestSha256,
  );
  assert.equal(first.evidence[0].analyzerOutputSha256, second.evidence[0].analyzerOutputSha256);
  assert.equal(first.evidence[0].styleProfileHash, second.evidence[0].styleProfileHash);
});

test("evidence sink failure stops after the accepted transport result", async () => {
  const request = makeRequest();
  const output = await validOutput(request);
  const fixture = setup([(attempt) => success(attempt, output)], {
    request,
    evidenceSink: {
      record: () => {
        throw new Error("private sink detail");
      },
    },
  });
  await expectInvalid(() => fixture.value.analyze(request));
  assert.equal(fixture.transport.requests.length, 1);
});
