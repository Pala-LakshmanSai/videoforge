import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { canonicalizeJson } from "@videoforge/contracts";

import {
  DurableFixturePromptWriter,
  DurablePromptExecutionService,
  PromptExecutionError,
  hashCanonical,
  hashUtf8,
  promptExecutionInputHash,
} from "../dist/src/prompts/index.js";

const FIXED_TIME = "2026-08-11T12:00:00.000Z";
const NEXT_TIME = "2026-08-11T12:00:01.000Z";
const hash = (label) => hashUtf8(label);
const ids = Object.freeze({
  workspace: "workspace_prompt_001",
  otherWorkspace: "workspace_prompt_002",
  actor: "user_prompt_001",
  project: "project_prompt_001",
  revision: "revision_prompt_001",
  timeline: "timeline_prompt_001",
  style: "style_version_prompt_001",
  task: "task_prompt_001",
  attempt: "attempt_prompt_001",
  outbox: "outbox_prompt_001",
});
const scope = Object.freeze({ workspaceId: ids.workspace, actorUserId: ids.actor });

function scenes(count = 25) {
  const roles = [
    "ENVIRONMENTAL_WIDE",
    "HUMAN_MEDIUM",
    "HANDS_ACTION",
    "OBJECT_EVIDENCE",
    "MACRO_DETAIL",
    "REACTION_RESULT",
  ];
  return Object.freeze(
    Array.from({ length: count }, (_, index) =>
      Object.freeze({
        sceneId: `scene_${String(index + 1).padStart(3, "0")}`,
        phrase: `Literal narration phrase ${index + 1}`,
        sentenceContext: `Literal narration phrase ${index + 1}.`,
        priorContext: index === 0 ? null : `Prior phrase ${index}`,
        nextContext: index + 1 === count ? null : `Next phrase ${index + 2}`,
        inImageShotRole: roles[index % roles.length],
        layout: index % 2 === 0 ? "IMAGE_FULL" : "SPLIT_RIGHT_IMAGE",
      }),
    ),
  );
}

function authority(overrides = {}) {
  const base = {
    workspaceId: ids.workspace,
    projectId: ids.project,
    revisionId: ids.revision,
    projectTitle: "A literal documentary project",
    revisionState: "GENERATING",
    timelineId: ids.timeline,
    timelineHash: hash("timeline"),
    timelineState: "CURRENT",
    imageStyleVersionId: ids.style,
    styleProfileHash: hash("style"),
    styleState: "PUBLISHED",
    plannerGuidance: "Use literal observational documentary evidence.",
    storyContext: "Compact literal documentary story context",
    style: {
      positiveSuffix: "authentic observational documentary photography",
      negativeSuffix: "illustration, CGI, visible text",
      fullImageGuidance: "16:9 frame with the evidence centered in the center-safe area",
      splitImageGuidance: "8:9 crop with evidence centered in the right-hand panel",
    },
    extraPromptKeywords: "natural imperfection",
    applyExtraPromptKeywords: true,
    continuityTags: ["same_place", "daylight"],
    scenes: scenes(),
    taskId: ids.task,
    taskState: "RUNNING",
    attemptId: ids.attempt,
    attemptOrdinal: 1,
    attemptState: "CLAIMED",
    claimTokenHash: hash("claim"),
    recordedInputHash: hash("placeholder"),
    outboxId: ids.outbox,
    outboxState: "ACKNOWLEDGED",
    reservedCostMicroUsd: 100,
    accepted: null,
    ...overrides,
  };
  return Object.freeze({ ...base, recordedInputHash: promptExecutionInputHash(base) });
}

function command(overrides = {}) {
  return Object.freeze({
    projectId: ids.project,
    revisionId: ids.revision,
    timelineId: ids.timeline,
    taskId: ids.task,
    attemptId: ids.attempt,
    outboxId: ids.outbox,
    presentedClaimTokenHash: hash("claim"),
    ...overrides,
  });
}

class MemoryStore {
  constructor(value = authority()) {
    this.value = structuredClone(value);
    this.acceptCalls = 0;
  }

  async resolve() {
    return structuredClone(this.value);
  }

  async accept(_scope, request) {
    this.acceptCalls += 1;
    if (this.value.accepted !== null) {
      if (
        this.value.accepted.acceptanceFingerprintHash !==
        request.acceptance.acceptanceFingerprintHash
      )
        throw new Error("IDEMPOTENCY_CONFLICT");
      return { accepted: structuredClone(this.value.accepted), replayed: true };
    }
    this.value = structuredClone({
      ...this.value,
      taskState: "SUCCEEDED",
      attemptState: "SUCCEEDED",
      accepted: request.acceptance,
    });
    return { accepted: structuredClone(request.acceptance), replayed: false };
  }
}

class PGlitePromptStore {
  constructor(database) {
    this.database = database;
  }

  async resolve(scopeValue, input) {
    const result = await this.database.query(
      `SELECT authority_json FROM vf_prompt_execution_test
       WHERE workspace_id = $1 AND task_id = $2 AND attempt_id = $3`,
      [scopeValue.workspaceId, input.taskId, input.attemptId],
    );
    return result.rows[0] ? JSON.parse(result.rows[0].authority_json) : null;
  }

  async accept(scopeValue, request) {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query(
        `SELECT authority_json FROM vf_prompt_execution_test
         WHERE workspace_id = $1 AND task_id = $2 AND attempt_id = $3 FOR UPDATE`,
        [scopeValue.workspaceId, request.authority.taskId, request.authority.attemptId],
      );
      assert.equal(result.rows.length, 1);
      const current = JSON.parse(result.rows[0].authority_json);
      if (current.accepted !== null) {
        if (
          current.accepted.acceptanceFingerprintHash !==
          request.acceptance.acceptanceFingerprintHash
        )
          throw new Error("IDEMPOTENCY_CONFLICT");
        return { accepted: current.accepted, replayed: true };
      }
      const next = {
        ...current,
        taskState: "SUCCEEDED",
        attemptState: "SUCCEEDED",
        accepted: request.acceptance,
      };
      await transaction.query(
        `UPDATE vf_prompt_execution_test SET authority_json = $3
         WHERE workspace_id = $1 AND task_id = $2`,
        [scopeValue.workspaceId, request.authority.taskId, JSON.stringify(next)],
      );
      return { accepted: request.acceptance, replayed: false };
    });
  }
}

class Clock {
  constructor() {
    this.index = 0;
  }

  now() {
    this.index += 1;
    return this.index === 1 ? FIXED_TIME : NEXT_TIME;
  }
}

class RecordingTelemetry {
  constructor() {
    this.events = [];
  }

  record(event) {
    this.events.push(structuredClone(event));
  }
}

async function rejectsCode(action, expected) {
  await assert.rejects(
    action,
    (error) => error instanceof PromptExecutionError && error.code === expected,
  );
}

test("fixture execution persists exact canonical hashes and correlated zero-cost telemetry", async () => {
  const store = new MemoryStore();
  const telemetry = new RecordingTelemetry();
  const service = new DurablePromptExecutionService(
    store,
    new DurableFixturePromptWriter(),
    telemetry,
    new Clock(),
  );
  let outboundCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    outboundCalls += 1;
    throw new Error("outbound network forbidden");
  };
  try {
    const result = await service.execute(scope, command());
    assert.equal(result.replayed, false);
    assert.equal(result.accepted.compiledPrompts.length, 25);
    assert.equal(result.accepted.reportedCostMicroUsd, 0);
    assert.equal(result.accepted.inputHash, authority().recordedInputHash);
    assert.equal(result.accepted.responseHash, hashCanonical(result.accepted.writerOutput));
    assert.equal(
      result.accepted.compiledOutputHash,
      hashCanonical(result.accepted.compiledPrompts),
    );
    assert.match(result.accepted.compiledPrompts[0].positivePrompt, /natural imperfection/u);
    assert.match(result.accepted.compiledPrompts[0].positivePrompt, /no visible text/u);
    assert.equal(outboundCalls, 0);
    assert.deepEqual(
      telemetry.events.map((event) => [event.sequence, event.outcome]),
      [
        [1, "STARTED"],
        [2, "SUCCEEDED"],
      ],
    );
    assert.deepEqual(telemetry.events[1].correlation, {
      requestId: null,
      workspaceId: ids.workspace,
      projectId: ids.project,
      revisionId: ids.revision,
      taskId: ids.task,
      attemptId: ids.attempt,
      outboxId: ids.outbox,
      providerJobId: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fresh and reopened PGlite returns byte-identical replay without invoking writer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "videoforge-prompt-"));
  try {
    let database = new PGlite(directory);
    await database.exec(`CREATE TABLE vf_prompt_execution_test (
      workspace_id text NOT NULL,
      task_id text NOT NULL,
      attempt_id text NOT NULL,
      authority_json text NOT NULL,
      PRIMARY KEY (workspace_id, task_id, attempt_id)
    )`);
    await database.query(`INSERT INTO vf_prompt_execution_test VALUES ($1, $2, $3, $4)`, [
      ids.workspace,
      ids.task,
      ids.attempt,
      JSON.stringify(authority()),
    ]);
    const first = await new DurablePromptExecutionService(
      new PGlitePromptStore(database),
      new DurableFixturePromptWriter(),
      { record() {} },
      new Clock(),
    ).execute(scope, command());
    await database.close();

    database = new PGlite(directory);
    let calls = 0;
    const replay = await new DurablePromptExecutionService(
      new PGlitePromptStore(database),
      {
        operation: "qualified_fake.write",
        async write() {
          calls += 1;
          throw new Error("writer cannot run during replay");
        },
      },
      { record() {} },
      new Clock(),
    ).execute(scope, command());
    assert.equal(replay.replayed, true);
    assert.equal(calls, 0);
    assert.equal(canonicalizeJson(replay.accepted), canonicalizeJson(first.accepted));
    await database.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("qualified fake seam accepts one exact unresolved-row retry and conserves cost", async () => {
  const fixture = new DurableFixturePromptWriter();
  const writer = {
    operation: "qualified_fake.write",
    async write(batch) {
      const complete = await fixture.write(batch);
      const all = batch.scenes.map((scene) => scene.sceneId);
      const unresolved = [all.at(-1)];
      const firstRequestBytes = canonicalizeJson({ attempt: 1, scenes: all });
      const secondRequestBytes = canonicalizeJson({ attempt: 2, scenes: unresolved });
      const firstResponseBytes = canonicalizeJson({ accepted: all.slice(0, -1), unresolved });
      const secondResponseBytes = canonicalizeJson({ accepted: unresolved, unresolved: [] });
      const firstHash = hashUtf8(firstRequestBytes);
      return {
        output: complete.output,
        attempts: [
          {
            attemptIndex: 1,
            requestedSceneIds: all,
            requestBytes: firstRequestBytes,
            requestHash: firstHash,
            responseBytes: firstResponseBytes,
            responseHash: hashUtf8(firstResponseBytes),
            retryOfRequestHash: null,
            acceptedSceneIds: all.slice(0, -1),
            unresolvedSceneIds: unresolved,
            inputTokens: 250,
            outputTokens: 100,
            reportedCostMicroUsd: 40,
          },
          {
            attemptIndex: 2,
            requestedSceneIds: unresolved,
            requestBytes: secondRequestBytes,
            requestHash: hashUtf8(secondRequestBytes),
            responseBytes: secondResponseBytes,
            responseHash: hashUtf8(secondResponseBytes),
            retryOfRequestHash: firstHash,
            acceptedSceneIds: unresolved,
            unresolvedSceneIds: [],
            inputTokens: 10,
            outputTokens: 5,
            reportedCostMicroUsd: 20,
          },
        ],
      };
    },
  };
  const result = await new DurablePromptExecutionService(
    new MemoryStore(),
    writer,
    { record() {} },
    new Clock(),
  ).execute(scope, command());
  assert.equal(result.accepted.writerAttempts.length, 2);
  assert.equal(result.accepted.reportedCostMicroUsd, 60);
  assert.deepEqual(result.accepted.writerAttempts[1].requestedSceneIds, ["scene_025"]);
});

test("fails closed on stale claim, cancellation, and workspace mismatch before writer", async () => {
  for (const [value, scopeValue, input, code] of [
    [authority(), scope, command({ presentedClaimTokenHash: hash("wrong") }), "CLAIM_STALE"],
    [authority({ taskState: "CANCELLED" }), scope, command(), "CANCELLED"],
    [authority({ workspaceId: ids.otherWorkspace }), scope, command(), "WORKSPACE_MISMATCH"],
  ]) {
    let calls = 0;
    const service = new DurablePromptExecutionService(
      new MemoryStore(value),
      {
        operation: "qualified_fake.write",
        async write() {
          calls += 1;
          throw new Error("must not execute");
        },
      },
      { record() {} },
      new Clock(),
    );
    await rejectsCode(() => service.execute(scopeValue, input), code);
    assert.equal(calls, 0);
  }
});

test("fails closed on timeline/style drift and exact input hash mismatch", async () => {
  for (const value of [
    authority({ timelineState: "STALE" }),
    authority({ styleState: "DRAFT" }),
    Object.freeze({ ...authority(), recordedInputHash: hash("tampered") }),
  ]) {
    await rejectsCode(
      () =>
        new DurablePromptExecutionService(
          new MemoryStore(value),
          new DurableFixturePromptWriter(),
          { record() {} },
          new Clock(),
        ).execute(scope, command()),
      value.recordedInputHash === authority().recordedInputHash
        ? "DURABLE_STATE_INVALID"
        : "HASH_MISMATCH",
    );
  }
});

test("rejects request/response hash tampering and cost above reservation atomically", async () => {
  const fixture = new DurableFixturePromptWriter();
  for (const mutation of [
    (result) => ({
      ...result,
      attempts: [{ ...result.attempts[0], responseHash: hash("tampered") }],
    }),
    (result) => ({
      ...result,
      attempts: [{ ...result.attempts[0], reportedCostMicroUsd: 101 }],
    }),
  ]) {
    const store = new MemoryStore();
    const writer = {
      operation: "qualified_fake.write",
      async write(batch) {
        return mutation(await fixture.write(batch));
      },
    };
    await rejectsCode(
      () =>
        new DurablePromptExecutionService(store, writer, { record() {} }, new Clock()).execute(
          scope,
          command(),
        ),
      mutation.toString().includes("responseHash") ? "HASH_MISMATCH" : "COST_MISMATCH",
    );
    assert.equal(store.acceptCalls, 0);
  }
});

test("rejects malformed or partial writer output and leaves durable state unchanged", async () => {
  const store = new MemoryStore();
  const writer = {
    operation: "qualified_fake.write",
    async write(batch) {
      const fixture = await new DurableFixturePromptWriter().write(batch);
      return {
        ...fixture,
        output: { ...fixture.output, scenes: fixture.output.scenes.slice(0, -1) },
      };
    },
  };
  await rejectsCode(
    () =>
      new DurablePromptExecutionService(store, writer, { record() {} }, new Clock()).execute(
        scope,
        command(),
      ),
    "OUTPUT_INVALID",
  );
  assert.equal(store.acceptCalls, 0);
});

test("rejects overlapping accepted and unresolved retry partitions", async () => {
  const store = new MemoryStore();
  const fixture = new DurableFixturePromptWriter();
  const writer = {
    operation: "qualified_fake.write",
    async write(batch) {
      const result = await fixture.write(batch);
      const all = batch.scenes.map((scene) => scene.sceneId);
      return {
        ...result,
        attempts: [
          {
            ...result.attempts[0],
            acceptedSceneIds: all.slice(0, -1),
            unresolvedSceneIds: [all[0]],
          },
        ],
      };
    },
  };
  await rejectsCode(
    () =>
      new DurablePromptExecutionService(store, writer, { record() {} }, new Clock()).execute(
        scope,
        command(),
      ),
    "OUTPUT_INVALID",
  );
  assert.equal(store.acceptCalls, 0);
});

test("emits redaction-safe failed telemetry after start without replacing domain error", async () => {
  const telemetry = new RecordingTelemetry();
  const original = new PromptExecutionError("HASH_MISMATCH", "private raw details stay out");
  const service = new DurablePromptExecutionService(
    new MemoryStore(),
    {
      operation: "qualified_fake.write",
      async write() {
        throw original;
      },
    },
    telemetry,
    new Clock(),
  );
  await assert.rejects(
    () => service.execute(scope, command()),
    (error) => error === original,
  );
  assert.deepEqual(
    telemetry.events.map((event) => [event.sequence, event.outcome]),
    [
      [1, "STARTED"],
      [2, "FAILED"],
    ],
  );
  assert.deepEqual(telemetry.events[1].error, {
    code: "HASH_MISMATCH",
    classification: "VALIDATION",
    retryable: false,
  });
  assert.doesNotMatch(canonicalizeJson(telemetry.events[1]), /private raw details/u);
});

test("emits cancelled telemetry after start and preserves cancellation error identity", async () => {
  const telemetry = new RecordingTelemetry();
  const original = new PromptExecutionError("CANCELLED", "cancelled after durable claim");
  const service = new DurablePromptExecutionService(
    new MemoryStore(),
    {
      operation: "qualified_fake.write",
      async write() {
        throw original;
      },
    },
    telemetry,
    new Clock(),
  );
  await assert.rejects(
    () => service.execute(scope, command()),
    (error) => error === original,
  );
  assert.equal(telemetry.events[1].outcome, "CANCELLED");
  assert.equal(telemetry.events[1].error, null);
  assert.equal(telemetry.events[1].eventName, "prompt.cancelled");
});

test("telemetry sink failure cannot change accepted durable bytes", async () => {
  const store = new MemoryStore();
  const result = await new DurablePromptExecutionService(
    store,
    new DurableFixturePromptWriter(),
    {
      record() {
        throw new Error("telemetry unavailable");
      },
    },
    new Clock(),
  ).execute(scope, command());
  assert.equal(result.replayed, false);
  assert.equal(result.accepted.compiledPrompts.length, 25);
  assert.equal(store.acceptCalls, 1);
});

test("conflicting replay bytes fail closed without invoking writer", async () => {
  const store = new MemoryStore();
  const first = await new DurablePromptExecutionService(
    store,
    new DurableFixturePromptWriter(),
    { record() {} },
    new Clock(),
  ).execute(scope, command());
  store.value.accepted.compiledPrompts[0].positivePromptSha256 = hash("conflict");
  let calls = 0;
  await rejectsCode(
    () =>
      new DurablePromptExecutionService(
        store,
        {
          operation: "qualified_fake.write",
          async write() {
            calls += 1;
            throw new Error("must not run");
          },
        },
        { record() {} },
        new Clock(),
      ).execute(scope, command()),
    "HASH_MISMATCH",
  );
  assert.equal(first.replayed, false);
  assert.equal(calls, 0);
});
