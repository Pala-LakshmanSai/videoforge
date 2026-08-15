import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryTelemetryAdapter,
  NoopTelemetryAdapter,
  TELEMETRY_EVENT_SCHEMA_VERSION,
  TelemetryStream,
  canonicalTelemetryJson,
  instrumentLocalOperation,
  normalizeTelemetryEvent,
} from "../dist/src/telemetry/index.js";
import {
  LocalWorkflowTransport,
  createPGliteControlPlaneRepositories,
} from "../dist/src/adapters/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { createMigratedDatabase, FIXED_TIME, sha256, uuid } from "./support/pglite.mjs";

const CORRELATION = Object.freeze({
  requestId: "request-001",
  workspaceId: "workspace-001",
  projectId: "project-001",
  revisionId: "revision-001",
  taskId: "task-001",
  attemptId: "attempt-002",
  outboxId: null,
  providerJobId: null,
});
const RETRY = Object.freeze({
  attemptNumber: 2,
  maximumAttempts: 3,
  parentAttemptId: "attempt-001",
});
const COST = Object.freeze({
  reservedMicroUsd: 5_000,
  reportedMicroUsd: 4_900,
  settledMicroUsd: 4_900,
});

function secondsAfter(seconds) {
  return new Date(Date.parse(FIXED_TIME) + seconds * 1000).toISOString();
}

function localReservation(serial, costSequence = 1) {
  const taskId = uuid(serial);
  const attemptId = uuid(serial + 1);
  const idempotencyKey = `telemetry-local:${serial}:attempt:1`;
  return {
    idempotencyKey,
    task: {
      taskId,
      owner: {
        ownerType: "PROJECT_REVISION",
        ownerId: IDS.revisionA,
        projectRevisionId: IDS.revisionA,
      },
      taskKey: `telemetry-local:${serial}`,
      lane: "IMAGE",
      initialState: "READY",
      required: true,
      dependsOn: [],
    },
    attempt: {
      attemptId,
      ordinal: 1,
      idempotencyKey,
      executionProfileId: IDS.executionProfileA,
      executionClaimTokenHash: sha256(`${idempotencyKey}:claim`),
      inputHash: sha256(`${idempotencyKey}:input`),
      parentAttemptId: null,
      fallbackReason: null,
    },
    costReservation: {
      costEventId: uuid(serial + 2),
      sequence: costSequence,
      amountMicroUsd: 5_000n,
      idempotencyKey: `${idempotencyKey}:cost`,
      details: { mode: "fixture" },
      occurredAt: FIXED_TIME,
    },
    dispatchOutbox: {
      outboxId: uuid(serial + 3),
      dedupeKey: `${idempotencyKey}:dispatch`,
      payloadContractName: "worker-job-envelope",
      payloadContractVersion: "v1",
      payloadHash: sha256(`${idempotencyKey}:payload`),
      payload: { privatePayloadMarker: "payload-marker-never-telemetry" },
      availableAt: FIXED_TIME,
    },
  };
}

function event(overrides = {}) {
  return {
    schemaVersion: TELEMETRY_EVENT_SCHEMA_VERSION,
    streamId: "attempt-002",
    sequence: 1,
    eventName: "dispatch.started",
    occurredAt: "2026-08-11T10:00:00.000Z",
    correlation: CORRELATION,
    stage: "dispatch",
    providerOperation: "fixture.dispatch",
    retry: RETRY,
    queueWaitMs: 125,
    durationMs: null,
    cost: COST,
    outcome: "STARTED",
    error: null,
    ...overrides,
  };
}

test("in-memory adapter records immutable canonical lifecycle, retry, latency, and cost facts", () => {
  const telemetry = new InMemoryTelemetryAdapter();
  telemetry.record(event());
  telemetry.record(
    event({
      sequence: 2,
      eventName: "dispatch.succeeded",
      durationMs: 42.5,
      outcome: "SUCCEEDED",
    }),
  );

  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.length, 2);
  assert.deepEqual(
    snapshot.map(({ sequence, eventName, outcome, durationMs }) => ({
      sequence,
      eventName,
      outcome,
      durationMs,
    })),
    [
      {
        sequence: 1,
        eventName: "dispatch.started",
        outcome: "STARTED",
        durationMs: null,
      },
      {
        sequence: 2,
        eventName: "dispatch.succeeded",
        outcome: "SUCCEEDED",
        durationMs: 42.5,
      },
    ],
  );
  assert.deepEqual(snapshot[1].retry, RETRY);
  assert.deepEqual(snapshot[1].cost, COST);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot[1]), true);
  assert.equal(Object.isFrozen(snapshot[1].correlation), true);
  assert.equal(Object.isFrozen(snapshot[1].retry), true);
  assert.equal(Object.isFrozen(snapshot[1].cost), true);
  assert.throws(() => snapshot.push(event()), TypeError);
  assert.throws(() => {
    snapshot[1].correlation.taskId = "changed";
  }, TypeError);
  assert.equal(
    canonicalTelemetryJson(snapshot[1]),
    '{"schemaVersion":"telemetry-event/v1","streamId":"attempt-002","sequence":2,"eventName":"dispatch.succeeded","occurredAt":"2026-08-11T10:00:00.000Z","correlation":{"requestId":"request-001","workspaceId":"workspace-001","projectId":"project-001","revisionId":"revision-001","taskId":"task-001","attemptId":"attempt-002","outboxId":null,"providerJobId":null},"stage":"dispatch","providerOperation":"fixture.dispatch","retry":{"attemptNumber":2,"maximumAttempts":3,"parentAttemptId":"attempt-001"},"queueWaitMs":125,"durationMs":42.5,"cost":{"reservedMicroUsd":5000,"reportedMicroUsd":4900,"settledMicroUsd":4900},"outcome":"SUCCEEDED","error":null}',
  );
});

test("event sequence is strictly monotonic per stream and independent across concurrent streams", async () => {
  const telemetry = new InMemoryTelemetryAdapter();
  telemetry.record(event({ streamId: "stream-a", sequence: 1 }));
  telemetry.record(event({ streamId: "stream-b", sequence: 1 }));
  telemetry.record(event({ streamId: "stream-a", sequence: 3 }));
  telemetry.record(event({ streamId: "stream-b", sequence: 2 }));
  assert.throws(
    () => telemetry.record(event({ streamId: "stream-a", sequence: 3 })),
    /must be greater than 3/,
  );
  assert.throws(
    () => telemetry.record(event({ streamId: "stream-b", sequence: 1 })),
    /must be greater than 2/,
  );

  const clockA = ["2026-08-11T10:00:01.000Z", "2026-08-11T10:00:03.000Z"];
  const clockB = ["2026-08-11T10:00:02.000Z", "2026-08-11T10:00:04.000Z"];
  const streamA = new TelemetryStream({
    port: telemetry,
    streamId: "stream-c",
    correlation: { ...CORRELATION, attemptId: "attempt-c" },
    clock: () => clockA.shift(),
  });
  const streamB = new TelemetryStream({
    port: telemetry,
    streamId: "stream-d",
    correlation: { ...CORRELATION, attemptId: "attempt-d" },
    clock: () => clockB.shift(),
  });
  await Promise.all([
    streamA.record({
      eventName: "work.started",
      stage: "work",
      providerOperation: null,
      retry: null,
      queueWaitMs: 0,
      durationMs: null,
      cost: null,
      outcome: "STARTED",
      error: null,
    }),
    streamB.record({
      eventName: "work.started",
      stage: "work",
      providerOperation: null,
      retry: null,
      queueWaitMs: 0,
      durationMs: null,
      cost: null,
      outcome: "STARTED",
      error: null,
    }),
  ]);
  assert.deepEqual(
    telemetry
      .snapshot()
      .filter(({ streamId }) => streamId === "stream-c" || streamId === "stream-d")
      .map(({ streamId, sequence }) => [streamId, sequence]),
    [
      ["stream-c", 1],
      ["stream-d", 1],
    ],
  );
});

test("validation rejects payload, URL, header, stack, credential, media, and unsafe numeric input", () => {
  const hostile = [
    event({ prompt: "raw prompt" }),
    event({ correlation: { ...CORRELATION, providerJobId: "https://private.example/job" } }),
    event({ headers: { authorization: "Bearer value" } }),
    event({
      error: { code: "FAILED", classification: "INTERNAL", retryable: false, stack: "at x" },
    }),
    event({ credential: "sk-not-allowed" }),
    event({ media: new Uint8Array([1, 2, 3]) }),
    event({ durationMs: Number.NaN }),
    event({ queueWaitMs: -1 }),
    event({ cost: { ...COST, reportedMicroUsd: 1.5 } }),
    event({ retry: { ...RETRY, attemptNumber: 4 } }),
  ];
  for (const input of hostile) assert.throws(() => normalizeTelemetryEvent(input));

  const accessor = event();
  Object.defineProperty(accessor, "stage", { get: () => "dispatch", enumerable: true });
  assert.throws(() => normalizeTelemetryEvent(accessor), /must be a data field/);
  assert.throws(
    () =>
      normalizeTelemetryEvent(
        event({
          outcome: "SUCCEEDED",
          error: { code: "STACK_TRACE", classification: "INTERNAL", retryable: false },
        }),
      ),
    /allowed only/,
  );
  assert.throws(
    () => normalizeTelemetryEvent(event({ outcome: "FAILED", error: null })),
    /requires a redaction-safe error/,
  );
});

test("no-op adapter stores nothing but enforces contract", () => {
  const telemetry = new NoopTelemetryAdapter();
  assert.equal(telemetry.record(event()), undefined);
  assert.throws(() => telemetry.record(event({ rawPrompt: "do not log" })));
});

test("fixture/local operation emits exact success events without changing domain result", async () => {
  const telemetry = new InMemoryTelemetryAdapter();
  const timestamps = ["2026-08-11T10:01:00.000Z", "2026-08-11T10:01:00.025Z"];
  const monotonic = [1_000, 1_025];
  const stream = new TelemetryStream({
    port: telemetry,
    streamId: "attempt-002-local",
    correlation: CORRELATION,
    clock: () => timestamps.shift(),
  });
  const domainState = { dispatches: 0 };
  const result = await instrumentLocalOperation(
    stream,
    {
      operationName: "local_dispatch",
      stage: "dispatch",
      providerOperation: "fixture.dispatch",
      retry: RETRY,
      queueWaitMs: 125,
      cost: COST,
      monotonicClock: () => monotonic.shift(),
    },
    () => {
      domainState.dispatches += 1;
      return Object.freeze({ kind: "DELIVERED", externalJobId: "fixture-job-001" });
    },
  );
  assert.deepEqual(result, { kind: "DELIVERED", externalJobId: "fixture-job-001" });
  assert.deepEqual(domainState, { dispatches: 1 });
  assert.deepEqual(
    telemetry.snapshot().map(({ sequence, eventName, outcome, durationMs }) => ({
      sequence,
      eventName,
      outcome,
      durationMs,
    })),
    [
      { sequence: 1, eventName: "local_dispatch.started", outcome: "STARTED", durationMs: null },
      {
        sequence: 2,
        eventName: "local_dispatch.succeeded",
        outcome: "SUCCEEDED",
        durationMs: 25,
      },
    ],
  );
});

test("sink and classifier failures never alter local domain success or original failure", async () => {
  let sinkCalls = 0;
  const failingPort = {
    async record() {
      sinkCalls += 1;
      throw new Error("telemetry sink unavailable");
    },
  };
  const stream = new TelemetryStream({
    port: failingPort,
    streamId: "isolated-stream",
    correlation: CORRELATION,
    clock: () => "2026-08-11T10:03:00.000Z",
  });
  let domainMutations = 0;
  const success = await instrumentLocalOperation(
    stream,
    {
      operationName: "local_work",
      stage: "fixture",
      providerOperation: null,
      retry: null,
      queueWaitMs: 0,
      cost: null,
      monotonicClock: () => {
        throw new Error("monotonic clock unavailable");
      },
    },
    () => {
      domainMutations += 1;
      return "domain-ok";
    },
  );
  assert.equal(success, "domain-ok");
  assert.equal(domainMutations, 1);

  const domainError = new Error("private raw failure detail");
  await assert.rejects(
    instrumentLocalOperation(
      stream,
      {
        operationName: "local_work",
        stage: "fixture",
        providerOperation: null,
        retry: null,
        queueWaitMs: 0,
        cost: null,
        classifyError() {
          throw new Error("classifier unavailable");
        },
      },
      () => {
        domainMutations += 1;
        throw domainError;
      },
    ),
    (error) => error === domainError,
  );
  assert.equal(domainMutations, 2);
  assert.equal(sinkCalls, 4, "both lifecycle events reached and survived the failing sink");
});

test("failure event exposes classification only and never raw domain error", async () => {
  const telemetry = new InMemoryTelemetryAdapter();
  const timestamps = ["2026-08-11T10:02:00.000Z", "2026-08-11T10:02:00.010Z"];
  const monotonic = [2_000, 2_010];
  const stream = new TelemetryStream({
    port: telemetry,
    streamId: "failure-stream",
    correlation: CORRELATION,
    clock: () => timestamps.shift(),
  });
  const domainError = new Error("Bearer private-credential at https://private.example");
  domainError.stack = "private stack trace";
  await assert.rejects(
    instrumentLocalOperation(
      stream,
      {
        operationName: "local_dispatch",
        stage: "dispatch",
        providerOperation: "fixture.dispatch",
        retry: RETRY,
        queueWaitMs: 5,
        cost: COST,
        monotonicClock: () => monotonic.shift(),
        classifyError: () => ({
          code: "DISPATCH_ACK_UNKNOWN",
          classification: "TRANSIENT",
          retryable: true,
        }),
      },
      () => {
        throw domainError;
      },
    ),
    (error) => error === domainError,
  );
  const failure = telemetry.snapshot()[1];
  assert.deepEqual(failure.error, {
    code: "DISPATCH_ACK_UNKNOWN",
    classification: "TRANSIENT",
    retryable: true,
  });
  const serialized = canonicalTelemetryJson(failure);
  assert.equal(serialized.includes("private"), false);
  assert.equal(serialized.includes("Bearer"), false);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("stack"), false);
});

test("LocalWorkflowTransport instruments actual driver dispatch and isolates sink failure", async () => {
  const context = await createMigratedDatabase();
  try {
    await seedLockedProjects(context.executor);
    const repositories = createPGliteControlPlaneRepositories(context.executor);
    const first = localReservation(90_000);
    const firstReservation = await repositories.execution.reserveTaskAttempt(
      { accountId: IDS.accountA, workspaceId: IDS.workspaceA },
      first,
    );
    assert.equal(firstReservation.ok, true);

    const telemetry = new InMemoryTelemetryAdapter();
    const telemetryTimes = ["2026-08-11T10:04:01.000Z", "2026-08-11T10:04:01.020Z"];
    const monotonicTimes = [10_000, 10_020];
    const transport = new LocalWorkflowTransport(
      context.executor,
      {
        async dispatch(outbox) {
          assert.equal(outbox.outboxId, first.dispatchOutbox.outboxId);
          return {
            kind: "ACKNOWLEDGED",
            externalJobId: "fixture-job-telemetry-001",
            providerDetails: { driver: "fixture" },
            acknowledgedAt: secondsAfter(2),
          };
        },
      },
      {
        clock: () => secondsAfter(3),
        telemetry,
        telemetryClock: () => telemetryTimes.shift(),
        telemetryMonotonicClock: () => monotonicTimes.shift(),
      },
    );
    const delivered = await transport.deliverNext({
      workerId: "telemetry-worker-1",
      now: secondsAfter(1),
      leaseExpiresAt: secondsAfter(30),
    });
    assert.equal(delivered.kind, "DELIVERED");
    const events = telemetry.snapshot();
    assert.deepEqual(
      events.map(({ sequence, eventName, outcome, queueWaitMs, durationMs }) => ({
        sequence,
        eventName,
        outcome,
        queueWaitMs,
        durationMs,
      })),
      [
        {
          sequence: 1,
          eventName: "local_driver_dispatch.started",
          outcome: "STARTED",
          queueWaitMs: 1_000,
          durationMs: null,
        },
        {
          sequence: 2,
          eventName: "local_driver_dispatch.succeeded",
          outcome: "SUCCEEDED",
          queueWaitMs: 1_000,
          durationMs: 20,
        },
      ],
    );
    assert.deepEqual(events[0].correlation, {
      requestId: null,
      workspaceId: IDS.workspaceA,
      projectId: null,
      revisionId: null,
      taskId: first.task.taskId,
      attemptId: first.attempt.attemptId,
      outboxId: first.dispatchOutbox.outboxId,
      providerJobId: null,
    });
    assert.equal(events[0].streamId, first.dispatchOutbox.outboxId);
    assert.equal(events[0].providerOperation, "local.dispatch");
    assert.equal(events[0].retry, null);
    assert.equal(events[0].cost, null);
    assert.equal(JSON.stringify(events).includes("payload-marker-never-telemetry"), false);

    const second = localReservation(90_100, 2);
    const secondReservation = await repositories.execution.reserveTaskAttempt(
      { accountId: IDS.accountA, workspaceId: IDS.workspaceA },
      second,
    );
    assert.equal(secondReservation.ok, true);
    let sinkCalls = 0;
    const failingTransport = new LocalWorkflowTransport(
      context.executor,
      {
        async dispatch() {
          return {
            kind: "ACKNOWLEDGED",
            externalJobId: "fixture-job-telemetry-002",
            providerDetails: { driver: "fixture" },
            acknowledgedAt: secondsAfter(5),
          };
        },
      },
      {
        clock: () => secondsAfter(6),
        telemetry: {
          async record() {
            sinkCalls += 1;
            throw new Error("injected telemetry sink failure");
          },
        },
        telemetryClock: () => "2026-08-11T10:04:02.000Z",
        telemetryMonotonicClock: () => 20_000,
      },
    );
    const deliveredWithFailedSink = await failingTransport.deliverNext({
      workerId: "telemetry-worker-2",
      now: secondsAfter(4),
      leaseExpiresAt: secondsAfter(40),
    });
    assert.equal(deliveredWithFailedSink.kind, "DELIVERED");
    assert.equal(deliveredWithFailedSink.outbox.state, "DELIVERED");
    assert.equal(sinkCalls, 2);
  } finally {
    await context.database.close();
  }
});
