import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicFakeTransport,
  ProviderSandboxHarness,
  createSandboxTaskIdentity,
  hashSandboxAttemptBinding,
  hashSandboxAuthorization,
  hashSandboxEvidence,
} from "../dist/src/index.js";

const NOW = 1_800_000_000_000;
const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;

const clock = Object.freeze({ nowEpochMs: () => NOW });

const task = createSandboxTaskIdentity({
  owner: {
    ownerType: "PROJECT_REVISION",
    ownerId: "revision_fixture_001",
    projectRevisionId: "revision_fixture_001",
  },
  taskId: "task_fixture_001",
  taskKey: "revision_fixture_001:IMAGE:chunk_001",
});

function authorization(overrides = {}) {
  return Object.freeze({
    schemaVersion: "provider-sandbox-authorization/v1",
    authorizationId: "authorization_fixture_001",
    taskHash: task.taskHash,
    enabled: true,
    sandboxExecutionAuthorized: true,
    providerCallsAuthorized: false,
    networkAccessAuthorized: false,
    credentialAccessAuthorized: false,
    authorizedExternalSpendMicroUsd: 0n,
    issuedAtEpochMs: NOW - 1_000,
    expiresAtEpochMs: NOW + 60_000,
    ...overrides,
  });
}

function attempt(attemptId, overrides = {}) {
  return Object.freeze({
    attemptId,
    executionProfileId: "fixture-image-profile-v1",
    executionProfileHash: SHA_A,
    inputHash: SHA_B,
    ...overrides,
  });
}

function request(attemptId, overrides = {}) {
  return Object.freeze({
    authorization: authorization(),
    attempt: attempt(attemptId),
    attemptSubcapMicroUsd: 500_000n,
    reservationMicroUsd: 400_000n,
    deadlineEpochMs: NOW + 30_000,
    cancelRequested: false,
    ...overrides,
  });
}

function harness(cap = 1_000_000n, taskIdentity = task) {
  return new ProviderSandboxHarness({ task: taskIdentity, taskCapMicroUsd: cap, clock });
}

test("missing and disabled authorization fail before transport execution", async () => {
  for (const authorizationValue of [undefined, authorization({ enabled: false })]) {
    const transport = new DeterministicFakeTransport({ scenario: "SUCCESS" });
    const result = await harness().runAttempt(
      request("attempt_auth", { authorization: authorizationValue }),
      transport,
    );

    assert.equal(result.ok, false);
    assert.equal(
      result.error.code,
      authorizationValue === undefined ? "AUTHORIZATION_REQUIRED" : "AUTHORIZATION_DISABLED",
    );
    assert.deepEqual(result.error.transportCalls, []);
    assert.deepEqual(transport.callLog(), []);
    assert.equal(result.error.taskCost.activeReservedMicroUsd, 0n);
  }
});

test("unsafe authorization and unsafe transports are rejected at zero calls", async () => {
  const unsafeAuthorizationTransport = new DeterministicFakeTransport({ scenario: "SUCCESS" });
  const unsafeAuthorizationResult = await harness().runAttempt(
    request("attempt_unsafe_auth", {
      authorization: authorization({ providerCallsAuthorized: true }),
    }),
    unsafeAuthorizationTransport,
  );
  assert.equal(unsafeAuthorizationResult.ok, false);
  assert.equal(unsafeAuthorizationResult.error.code, "UNSAFE_AUTHORIZATION");
  assert.deepEqual(unsafeAuthorizationTransport.callLog(), []);

  const calls = [];
  const unsafeTransport = {
    safety: {
      kind: "DETERMINISTIC_FAKE",
      networkAccess: true,
      credentialAccess: false,
      providerSdkAccess: false,
      maximumExternalSpendMicroUsd: 0n,
    },
    async dispatch() {
      calls.push("dispatch");
      throw new Error("must not run");
    },
    async reconcile() {
      throw new Error("must not run");
    },
    async execute() {
      throw new Error("must not run");
    },
    async cancel() {
      throw new Error("must not run");
    },
    async cleanup() {
      throw new Error("must not run");
    },
    callLog() {
      calls.push("callLog");
      return [...calls];
    },
  };
  const unsafeTransportResult = await harness().runAttempt(
    request("attempt_unsafe_transport"),
    unsafeTransport,
  );
  assert.equal(unsafeTransportResult.ok, false);
  assert.equal(unsafeTransportResult.error.code, "UNSAFE_TRANSPORT");
  assert.deepEqual(calls, []);
});

test("fake constructor rejects malformed option keys and values before use", () => {
  let scenarioReads = 0;
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, "scenario", {
    enumerable: true,
    get() {
      scenarioReads += 1;
      return "SUCCESS";
    },
  });
  const throwAtAccessor = [];
  Object.defineProperty(throwAtAccessor, "0", {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error("throwAt accessor must not execute");
    },
  });
  throwAtAccessor.length = 1;

  const malformed = [
    { scenario: "SUCCESS", scenrio: "TIMEOUT" },
    { scenario: "NOT_A_SCENARIO" },
    { scenario: "SUCCESS", reportedMicroUsd: -1n },
    { scenario: "SUCCESS", executionReportedMicroUsd: 1 },
    { scenario: "SUCCESS", cancellationReportedMicroUsd: undefined },
    { scenario: "SUCCESS", reconciliationOutcome: "MAYBE" },
    { scenario: "SUCCESS", protocolFault: "UNKNOWN_FAULT" },
    { scenario: "SUCCESS", throwAt: "EXECUTION" },
    { scenario: "SUCCESS", throwAt: ["UNKNOWN"] },
    { scenario: "SUCCESS", throwAt: ["EXECUTION", "EXECUTION"] },
    { scenario: "SUCCESS", throwAt: throwAtAccessor },
    { scenario: "SUCCESS", reconciliationOutcome: "STILL_UNKNOWN" },
    { scenario: "SUCCESS", throwAt: ["RECONCILIATION"] },
    { scenario: "SUCCESS", protocolFault: "RECONCILIATION_INVALID_EXTERNAL_JOB_ID" },
    { scenario: "SUCCESS", protocolFault: "EXECUTION_INVALID_TIMEOUT_TIMESTAMP" },
    { scenario: "TIMEOUT", protocolFault: "EXECUTION_INVALID_RESULT_HASH" },
    {
      scenario: "AMBIGUOUS_ACKNOWLEDGEMENT",
      protocolFault: "DISPATCH_INVALID_EXTERNAL_JOB_ID",
    },
    {
      scenario: "AMBIGUOUS_ACKNOWLEDGEMENT",
      protocolFault: "RECONCILIATION_INVALID_EXTERNAL_JOB_ID",
    },
    { scenario: "CAP_EXHAUSTION", protocolFault: "DISPATCH_INVALID_EXTERNAL_JOB_ID" },
    accessorOptions,
  ];
  for (const options of malformed) {
    assert.throws(() => new DeterministicFakeTransport(options), TypeError);
  }
  assert.equal(scenarioReads, 0);
});

test("WeakSet prototype poisoning cannot authenticate a forged transport", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(WeakSet.prototype, "has");
  assert.notEqual(descriptor, undefined);
  const calls = [];
  const forged = {
    safety: {
      kind: "DETERMINISTIC_FAKE",
      networkAccess: false,
      credentialAccess: false,
      providerSdkAccess: false,
      maximumExternalSpendMicroUsd: 0n,
    },
    async dispatch() {
      calls.push("dispatch");
      throw new Error("must not execute");
    },
    async reconcile() {
      calls.push("reconcile");
      throw new Error("must not execute");
    },
    async execute() {
      calls.push("execute");
      throw new Error("must not execute");
    },
    async cancel() {
      calls.push("cancel");
      throw new Error("must not execute");
    },
    async cleanup() {
      calls.push("cleanup");
      throw new Error("must not execute");
    },
    callLog() {
      calls.push("callLog");
      return calls;
    },
  };

  try {
    Object.defineProperty(WeakSet.prototype, "has", {
      ...descriptor,
      value: () => true,
    });
    const result = await harness().runAttempt(request("attempt_weakset_poison"), forged);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "UNSAFE_TRANSPORT");
    assert.deepEqual(calls, []);
  } finally {
    Object.defineProperty(WeakSet.prototype, "has", descriptor);
  }
});

test("captured freezing keeps genuine fakes immutable after Object.freeze poisoning", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Object, "freeze");
  assert.notEqual(descriptor, undefined);
  const capturedIsFrozen = Object.isFrozen;
  try {
    Object.defineProperty(Object, "freeze", {
      ...descriptor,
      value: (value) => value,
    });
    const transport = new DeterministicFakeTransport({ scenario: "SUCCESS" });
    assert.equal(capturedIsFrozen(transport), true);
    assert.equal(capturedIsFrozen(transport.safety), true);
    assert.throws(() => {
      transport.execute = async () => {
        throw new Error("forged override");
      };
    }, TypeError);

    const result = await harness().runAttempt(request("attempt_freeze_poison"), transport);
    assert.equal(result.ok, true);
    assert.deepEqual(result.evidence.transportCalls, ["dispatch", "execute", "cleanup"]);
  } finally {
    Object.defineProperty(Object, "freeze", descriptor);
  }
});

test("task and authorization failures occur before every injected transport method", async () => {
  const calls = [];
  const selfDeclaredFake = {
    safety: {
      kind: "DETERMINISTIC_FAKE",
      networkAccess: false,
      credentialAccess: false,
      providerSdkAccess: false,
      maximumExternalSpendMicroUsd: 0n,
    },
    async dispatch() {
      calls.push("dispatch");
      throw new Error("must not run");
    },
    async reconcile() {
      calls.push("reconcile");
      throw new Error("must not run");
    },
    async execute() {
      calls.push("execute");
      throw new Error("must not run");
    },
    async cancel() {
      calls.push("cancel");
      throw new Error("must not run");
    },
    async cleanup() {
      calls.push("cleanup");
      throw new Error("must not run");
    },
    callLog() {
      calls.push("callLog");
      return [...calls];
    },
  };

  const missingAuthorization = await harness().runAttempt(
    request("attempt_preflight_auth", { authorization: undefined }),
    selfDeclaredFake,
  );
  assert.equal(missingAuthorization.ok, false);
  assert.equal(missingAuthorization.error.code, "AUTHORIZATION_REQUIRED");
  assert.deepEqual(calls, []);

  const malformedOwnerTask = {
    ...task,
    owner: {
      ownerType: "WORKSPACE",
      ownerId: "workspace_fixture_001",
      workspaceId: "workspace_fixture_001",
    },
  };
  const malformedOwner = await harness(1_000_000n, malformedOwnerTask).runAttempt(
    request("attempt_preflight_owner"),
    selfDeclaredFake,
  );
  assert.equal(malformedOwner.ok, false);
  assert.equal(malformedOwner.error.code, "IDENTITY_INVALID");
  assert.deepEqual(calls, []);

  const selfDeclaration = await harness().runAttempt(
    request("attempt_self_declared_fake"),
    selfDeclaredFake,
  );
  assert.equal(selfDeclaration.ok, false);
  assert.equal(selfDeclaration.error.code, "UNSAFE_TRANSPORT");
  assert.deepEqual(calls, []);
});

test("unknown undefined or cyclic task/attempt fields reject before transport and reservation", async () => {
  const cyclicAttempt = { ...attempt("attempt_cyclic_extra") };
  cyclicAttempt.extra = cyclicAttempt;
  const malformedAttempts = [
    { ...attempt("attempt_undefined_extra"), extra: undefined },
    cyclicAttempt,
  ];
  for (const malformedAttempt of malformedAttempts) {
    const transport = new DeterministicFakeTransport({ scenario: "SUCCESS" });
    const result = await harness().runAttempt(
      request(malformedAttempt.attemptId, { attempt: malformedAttempt }),
      transport,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "IDENTITY_INVALID");
    assert.equal(result.error.taskCost.activeCommitmentMicroUsd, 0n);
    assert.deepEqual(transport.callLog(), []);
  }

  const cyclicTask = { ...task };
  cyclicTask.extra = cyclicTask;
  const transport = new DeterministicFakeTransport({ scenario: "SUCCESS" });
  const result = await harness(1_000_000n, cyclicTask).runAttempt(
    request("attempt_task_cyclic_extra"),
    transport,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "IDENTITY_INVALID");
  assert.equal(result.error.taskCost.activeCommitmentMicroUsd, 0n);
  assert.deepEqual(transport.callLog(), []);

  const knownFieldCycle = { ...task };
  knownFieldCycle.owner = knownFieldCycle;
  const knownCycleTransport = new DeterministicFakeTransport({ scenario: "SUCCESS" });
  const knownCycle = await harness(1_000_000n, knownFieldCycle).runAttempt(
    request("attempt_task_known_cycle"),
    knownCycleTransport,
  );
  assert.equal(knownCycle.ok, false);
  assert.equal(knownCycle.error.code, "IDENTITY_INVALID");
  assert.equal(knownCycle.error.taskCost.activeCommitmentMicroUsd, 0n);
  assert.deepEqual(knownCycleTransport.callLog(), []);
});

test("request, authorization, and attempt accessors reject without being invoked", async () => {
  const cases = [];

  let requestReads = 0;
  const requestAccessor = { ...request("attempt_request_accessor") };
  Object.defineProperty(requestAccessor, "attempt", {
    enumerable: true,
    get() {
      requestReads += 1;
      return attempt("attempt_request_accessor");
    },
  });
  cases.push({ value: requestAccessor, reads: () => requestReads, code: "IDENTITY_INVALID" });

  let authorizationReads = 0;
  const authorizationAccessor = { ...authorization() };
  Object.defineProperty(authorizationAccessor, "enabled", {
    enumerable: true,
    get() {
      authorizationReads += 1;
      return true;
    },
  });
  cases.push({
    value: request("attempt_authorization_accessor", { authorization: authorizationAccessor }),
    reads: () => authorizationReads,
    code: "AUTHORIZATION_REQUIRED",
  });

  let attemptReads = 0;
  const attemptAccessor = { ...attempt("attempt_identity_accessor") };
  Object.defineProperty(attemptAccessor, "inputHash", {
    enumerable: true,
    get() {
      attemptReads += 1;
      return SHA_B;
    },
  });
  cases.push({
    value: request("attempt_identity_accessor", { attempt: attemptAccessor }),
    reads: () => attemptReads,
    code: "IDENTITY_INVALID",
  });

  for (const testCase of cases) {
    const transport = new DeterministicFakeTransport({ scenario: "SUCCESS" });
    const result = await harness().runAttempt(testCase.value, transport);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, testCase.code);
    assert.equal(testCase.reads(), 0);
    assert.equal(result.error.taskCost.activeCommitmentMicroUsd, 0n);
    assert.deepEqual(transport.callLog(), []);
  }
});

test("task accessors reject without cloning or invoking caller properties", async () => {
  let reads = 0;
  const taskAccessor = { ...task };
  Object.defineProperty(taskAccessor, "taskId", {
    enumerable: true,
    get() {
      reads += 1;
      return "task_accessor";
    },
  });
  const transport = new DeterministicFakeTransport({ scenario: "SUCCESS" });
  const result = await harness(1_000_000n, taskAccessor).runAttempt(
    request("attempt_task_accessor"),
    transport,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "IDENTITY_INVALID");
  assert.equal(reads, 0);
  assert.equal(result.error.taskCost.activeCommitmentMicroUsd, 0n);
  assert.deepEqual(transport.callLog(), []);
});

test("exact owner, task, profile, and input hashes are validated and bound immutably", async () => {
  const changedOwner = {
    ...task,
    owner: { ...task.owner, projectRevisionId: "revision_tampered" },
  };
  const ownerTransport = new DeterministicFakeTransport({ scenario: "SUCCESS" });
  const ownerResult = await harness(1_000_000n, changedOwner).runAttempt(
    request("attempt_owner_tamper"),
    ownerTransport,
  );
  assert.equal(ownerResult.ok, false);
  assert.equal(ownerResult.error.code, "IDENTITY_INVALID");
  assert.deepEqual(ownerTransport.callLog(), []);

  const hashTransport = new DeterministicFakeTransport({ scenario: "SUCCESS" });
  const hashResult = await harness().runAttempt(
    request("attempt_bad_hash", {
      attempt: attempt("attempt_bad_hash", { inputHash: "sha256:not-a-digest" }),
    }),
    hashTransport,
  );
  assert.equal(hashResult.ok, false);
  assert.equal(hashResult.error.code, "INVALID_HASH");
  assert.deepEqual(hashTransport.callLog(), []);

  const identity = attempt("attempt_bound");
  const transport = new DeterministicFakeTransport({ scenario: "SUCCESS" });
  const result = await harness().runAttempt(
    request(identity.attemptId, { attempt: identity }),
    transport,
  );
  assert.equal(result.ok, true);
  assert.equal(result.evidence.task.ownerHash, task.ownerHash);
  assert.equal(result.evidence.task.taskHash, task.taskHash);
  assert.equal(result.evidence.attempt.executionProfileHash, SHA_A);
  assert.equal(result.evidence.attempt.inputHash, SHA_B);
  assert.equal(
    result.evidence.bindingHash,
    hashSandboxAttemptBinding({
      task,
      attempt: identity,
      facts: result.evidence.bindingFacts,
    }),
  );
  assert.equal(
    result.evidence.bindingFacts.authorizationHash,
    hashSandboxAuthorization(authorization()),
  );
  assert.equal(Object.isFrozen(result.evidence), true);
  assert.equal(Object.isFrozen(result.evidence.task.owner), true);
});

test("binding hash covers every dispatch-critical authorization, budget, deadline, and cancellation fact", async () => {
  const identity = attempt("attempt_binding_domain");
  const result = await harness().runAttempt(
    request(identity.attemptId, { attempt: identity }),
    new DeterministicFakeTransport({ scenario: "SUCCESS" }),
  );
  assert.equal(result.ok, true);
  const base = {
    task,
    attempt: identity,
    facts: result.evidence.bindingFacts,
  };
  assert.equal(hashSandboxAttemptBinding(base), result.evidence.bindingHash);

  const mutations = [
    { authorizationHash: SHA_C },
    { taskCapMicroUsd: 1_000_001n },
    { attemptSubcapMicroUsd: 500_001n },
    { reservationMicroUsd: 400_001n },
    { deadlineEpochMs: NOW + 30_001 },
    { cancelRequested: true },
  ];
  for (const mutation of mutations) {
    assert.notEqual(
      hashSandboxAttemptBinding({
        ...base,
        facts: { ...base.facts, ...mutation },
      }),
      result.evidence.bindingHash,
    );
  }
});

test("attempt and authorization inputs are snapshotted before asynchronous transport work", async () => {
  const mutableAttempt = {
    attemptId: "attempt_snapshot",
    executionProfileId: "fixture-image-profile-v1",
    executionProfileHash: SHA_A,
    inputHash: SHA_B,
  };
  const mutableAuthorization = { ...authorization(), authorizationId: "authorization_snapshot" };
  const mutableRequest = {
    authorization: mutableAuthorization,
    attempt: mutableAttempt,
    attemptSubcapMicroUsd: 500_000n,
    reservationMicroUsd: 400_000n,
    deadlineEpochMs: NOW + 30_000,
    cancelRequested: false,
  };
  const transport = new DeterministicFakeTransport({ scenario: "SUCCESS" });
  const pending = harness().runAttempt(mutableRequest, transport);

  mutableAttempt.executionProfileHash = SHA_B;
  mutableAttempt.inputHash = SHA_A;
  mutableAuthorization.authorizationId = "authorization_mutated";
  mutableRequest.cancelRequested = true;

  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.evidence.authorizationId, "authorization_snapshot");
  assert.equal(result.evidence.attempt.executionProfileHash, SHA_A);
  assert.equal(result.evidence.attempt.inputHash, SHA_B);
  assert.equal(result.evidence.outcome, "SUCCEEDED");
  assert.deepEqual(result.evidence.transportCalls, ["dispatch", "execute", "cleanup"]);
});

test("success deterministically reconciles reserved, reported, settled, and refunded USD", async () => {
  const run = async () => {
    const transport = new DeterministicFakeTransport({
      scenario: "SUCCESS",
      reportedMicroUsd: 250_000n,
    });
    const result = await harness().runAttempt(request("attempt_success"), transport);
    assert.equal(result.ok, true);
    return result.evidence;
  };

  const first = await run();
  const second = await run();
  assert.equal(first.outcome, "SUCCEEDED");
  assert.deepEqual(first.transportCalls, ["dispatch", "execute", "cleanup"]);
  assert.deepEqual(
    first.cost.events.map(({ sequence, eventType, amountMicroUsd }) => [
      sequence,
      eventType,
      amountMicroUsd,
    ]),
    [
      [1, "RESERVED", 400_000n],
      [2, "REPORTED", 250_000n],
      [3, "SETTLED", 250_000n],
      [4, "REFUNDED", 150_000n],
    ],
  );
  assert.equal(first.cost.reconciled, true);
  assert.equal(first.cost.activeReservedMicroUsd, 0n);
  assert.equal(first.taskCostAfter.settledMicroUsd, 250_000n);
  assert.equal(first.taskCostAfter.availableMicroUsd, 750_000n);
  assert.deepEqual(first.safety, {
    providerCalls: 0,
    networkCalls: 0,
    credentialReads: 0,
    providerSdkCalls: 0,
    externalSpendMicroUsd: 0n,
  });
  const payload = { ...first };
  delete payload.evidenceHash;
  assert.equal(first.evidenceHash, hashSandboxEvidence(payload));
  assert.equal(first.evidenceHash, second.evidenceHash);
});

test("attempt sub-cap and cumulative retry task cap reject before transport", async () => {
  const subcapTransport = new DeterministicFakeTransport({ scenario: "CAP_EXHAUSTION" });
  const subcapResult = await harness().runAttempt(
    request("attempt_subcap", {
      attemptSubcapMicroUsd: 300_000n,
      reservationMicroUsd: 400_000n,
    }),
    subcapTransport,
  );
  assert.equal(subcapResult.ok, false);
  assert.equal(subcapResult.error.code, "ATTEMPT_SUBCAP_EXCEEDED");
  assert.deepEqual(subcapTransport.callLog(), []);

  const retryHarness = harness();
  const first = await retryHarness.runAttempt(
    request("attempt_retry_1", {
      attemptSubcapMicroUsd: 700_000n,
      reservationMicroUsd: 700_000n,
    }),
    new DeterministicFakeTransport({ scenario: "SUCCESS", reportedMicroUsd: 700_000n }),
  );
  assert.equal(first.ok, true);

  const exhaustedTransport = new DeterministicFakeTransport({ scenario: "CAP_EXHAUSTION" });
  const second = await retryHarness.runAttempt(
    request("attempt_retry_2", {
      attemptSubcapMicroUsd: 400_000n,
      reservationMicroUsd: 400_000n,
    }),
    exhaustedTransport,
  );
  assert.equal(second.ok, false);
  assert.equal(second.error.code, "TASK_CAP_EXCEEDED");
  assert.deepEqual(exhaustedTransport.callLog(), []);
  assert.equal(second.error.taskCost.settledMicroUsd, 700_000n);
});

test("an attempt ID cannot be replayed with a changed immutable sub-cap", async () => {
  const runHarness = harness();
  const first = await runHarness.runAttempt(
    request("attempt_immutable_subcap"),
    new DeterministicFakeTransport({ scenario: "SUCCESS" }),
  );
  assert.equal(first.ok, true);

  const retryTransport = new DeterministicFakeTransport({ scenario: "CAP_EXHAUSTION" });
  const replay = await runHarness.runAttempt(
    request("attempt_immutable_subcap", {
      attemptSubcapMicroUsd: 900_000n,
      reservationMicroUsd: 800_000n,
    }),
    retryTransport,
  );
  assert.equal(replay.ok, false);
  assert.equal(replay.error.code, "ATTEMPT_ID_REUSED");
  assert.deepEqual(retryTransport.callLog(), []);
});

test("ambiguous acknowledgement is reconciled and remains reserved while still unknown", async () => {
  const runHarness = harness();
  const transport = new DeterministicFakeTransport({
    scenario: "AMBIGUOUS_ACKNOWLEDGEMENT",
    reconciliationOutcome: "STILL_UNKNOWN",
  });
  const result = await runHarness.runAttempt(request("attempt_ambiguous"), transport);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.outcome, "RECONCILIATION_REQUIRED");
  assert.deepEqual(result.evidence.transportCalls, ["dispatch", "reconcile"]);
  assert.deepEqual(result.evidence.reconciliation, { outcome: "STILL_UNKNOWN" });
  assert.deepEqual(result.evidence.cleanup, { outcome: "DEFERRED_RECONCILIATION" });
  assert.equal(result.evidence.cost.reconciled, false);
  assert.equal(result.evidence.cost.activeReservedMicroUsd, 400_000n);

  const retryTransport = new DeterministicFakeTransport({ scenario: "CAP_EXHAUSTION" });
  const retry = await runHarness.runAttempt(
    request("attempt_ambiguous_retry", {
      attemptSubcapMicroUsd: 700_000n,
      reservationMicroUsd: 700_000n,
    }),
    retryTransport,
  );
  assert.equal(retry.ok, false);
  assert.equal(retry.error.code, "TASK_CAP_EXCEEDED");
  assert.deepEqual(retryTransport.callLog(), []);
});

test("confirmed ambiguous acknowledgement proceeds only after reconciliation", async () => {
  const transport = new DeterministicFakeTransport({
    scenario: "AMBIGUOUS_ACKNOWLEDGEMENT",
    reconciliationOutcome: "ACKNOWLEDGEMENT_CONFIRMED",
    reportedMicroUsd: 50_000n,
  });
  const result = await harness().runAttempt(request("attempt_ambiguous_confirmed"), transport);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.outcome, "SUCCEEDED");
  assert.deepEqual(result.evidence.transportCalls, ["dispatch", "reconcile", "execute", "cleanup"]);
  assert.equal(result.evidence.dispatch.state, "AMBIGUOUS");
  assert.equal(result.evidence.reconciliation.outcome, "ACKNOWLEDGEMENT_CONFIRMED");
});

test("confirmed non-dispatch refunds the full reservation without execution or cleanup", async () => {
  const transport = new DeterministicFakeTransport({
    scenario: "AMBIGUOUS_ACKNOWLEDGEMENT",
    reconciliationOutcome: "NOT_DISPATCHED_CONFIRMED",
  });
  const result = await harness().runAttempt(request("attempt_not_dispatched"), transport);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.outcome, "NOT_DISPATCHED");
  assert.deepEqual(result.evidence.transportCalls, ["dispatch", "reconcile"]);
  assert.deepEqual(result.evidence.cleanup, { outcome: "NOT_REQUIRED" });
  assert.equal(result.evidence.cost.settledMicroUsd, 0n);
  assert.equal(result.evidence.cost.refundedMicroUsd, 400_000n);
});

test("cancellation stops before execution and preserves reconciled synthetic cost", async () => {
  const transport = new DeterministicFakeTransport({
    scenario: "CANCELLATION",
    reportedMicroUsd: 75_000n,
  });
  const result = await harness().runAttempt(
    request("attempt_cancelled", { cancelRequested: true }),
    transport,
  );
  assert.equal(result.ok, true);
  assert.equal(result.evidence.outcome, "CANCELLED");
  assert.deepEqual(result.evidence.transportCalls, ["dispatch", "cancel", "cleanup"]);
  assert.equal(result.evidence.execution, null);
  assert.equal(result.evidence.cancellation.outcome, "CANCELLED");
  assert.equal(result.evidence.cost.settledMicroUsd, 75_000n);
});

test("timeout is terminal only after cancellation, cleanup, and cost reconciliation", async () => {
  const transport = new DeterministicFakeTransport({
    scenario: "TIMEOUT",
    reportedMicroUsd: 100_000n,
  });
  const result = await harness().runAttempt(request("attempt_timeout"), transport);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.outcome, "TIMED_OUT");
  assert.deepEqual(result.evidence.transportCalls, ["dispatch", "execute", "cancel", "cleanup"]);
  assert.equal(result.evidence.execution.outcome, "TIMED_OUT");
  assert.equal(result.evidence.execution.timedOutAtEpochMs, NOW + 30_000);
  assert.equal(result.evidence.cancellation.outcome, "CANCELLED");
  assert.equal(result.evidence.cost.reconciled, true);
});

test("timeout reconciliation never undercounts a regressed cancellation cost report", async () => {
  const transport = new DeterministicFakeTransport({
    scenario: "TIMEOUT",
    executionReportedMicroUsd: 200_000n,
    cancellationReportedMicroUsd: 50_000n,
  });
  const result = await harness().runAttempt(request("attempt_timeout_regression"), transport);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "TRANSPORT_PROTOCOL_FAILURE");
  const evidence = result.error.evidence;
  assert.equal(evidence.outcome, "PROTOCOL_FAILED");
  assert.equal(evidence.execution.outcome, "TIMED_OUT");
  assert.equal(evidence.cancellation.outcome, "CANCELLED");
  assert.equal(evidence.reportedCostFacts.executionReportedMicroUsd, 200_000n);
  assert.equal(evidence.reportedCostFacts.cancellationReportedMicroUsd, 50_000n);
  assert.equal(evidence.reportedCostFacts.conservativeReportedMicroUsd, 200_000n);
  assert.equal(evidence.reportedCostFacts.cumulativeMonotonic, false);
  assert.equal(evidence.cost.settledMicroUsd, 200_000n);
  assert.equal(evidence.cost.refundedMicroUsd, 200_000n);
  assert.deepEqual(
    evidence.issues.map(({ stage, code }) => [stage, code]),
    [["COST_RECONCILIATION", "CUMULATIVE_COST_REGRESSION"]],
  );
});

test("cleanup failure stays visible without erasing execution or settled cost", async () => {
  const transport = new DeterministicFakeTransport({
    scenario: "CLEANUP_FAILURE",
    reportedMicroUsd: 125_000n,
  });
  const result = await harness().runAttempt(request("attempt_cleanup_failure"), transport);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.outcome, "CLEANUP_FAILED");
  assert.equal(result.evidence.execution.outcome, "SUCCEEDED");
  assert.equal(result.evidence.cleanup.outcome, "FAILED");
  assert.match(result.evidence.cleanup.reason, /cleanup failure/u);
  assert.equal(result.evidence.cost.settledMicroUsd, 125_000n);
  assert.deepEqual(result.evidence.transportCalls, ["dispatch", "execute", "cleanup"]);
});

test("valid cleanup failure combines with execution, cancellation, or cost issues", async (context) => {
  const cases = [
    {
      name: "execution issue",
      attemptId: "attempt_cleanup_execution_compound",
      options: {
        scenario: "CLEANUP_FAILURE",
        protocolFault: "EXECUTION_INVALID_RESULT_HASH",
      },
      overrides: {},
    },
    {
      name: "cancellation issue",
      attemptId: "attempt_cleanup_cancellation_compound",
      options: {
        scenario: "CLEANUP_FAILURE",
        protocolFault: "CANCELLATION_NEGATIVE_COST",
      },
      overrides: { cancelRequested: true },
    },
    {
      name: "cost issue",
      attemptId: "attempt_cleanup_cost_compound",
      options: { scenario: "CLEANUP_FAILURE", reportedMicroUsd: 450_000n },
      overrides: {},
    },
  ];

  for (const testCase of cases) {
    await context.test(testCase.name, async () => {
      const result = await harness().runAttempt(
        request(testCase.attemptId, testCase.overrides),
        new DeterministicFakeTransport(testCase.options),
      );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "COMPOUND_FAILURE");
      assert.equal(result.error.evidence.outcome, "COMPOUND_FAILURE");
      assert.equal(result.error.evidence.cleanup.outcome, "FAILED");
      assert.match(result.error.evidence.cleanup.reason, /cleanup failure/u);
      assert.equal(
        result.error.evidence.issues.some(
          ({ stage, code, message }) =>
            stage === "CLEANUP" && code === "CLEANUP_FAILED" && /cleanup failure/u.test(message),
        ),
        true,
      );
      assert.match(result.error.message, /cleanup failure/u);
    });
  }
});

test("final known cost above reservation settles actual spend with zero refund", async () => {
  const transport = new DeterministicFakeTransport({
    scenario: "SUCCESS",
    reportedMicroUsd: 400_001n,
  });
  const result = await harness().runAttempt(request("attempt_cost_overrun"), transport);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "COST_RECONCILIATION_FAILED");
  assert.deepEqual(result.error.transportCalls, ["dispatch", "execute", "cleanup"]);
  assert.equal(result.error.taskCost.activeReservedMicroUsd, 0n);
  assert.equal(result.error.taskCost.settledMicroUsd, 400_001n);
  assert.equal(result.error.taskCost.knownReportedMicroUsd, 400_001n);
  assert.equal(result.error.evidence.execution.outcome, "SUCCEEDED");
  assert.equal(result.error.evidence.cleanup.outcome, "SUCCEEDED");
  assert.equal(result.error.evidence.reportedCostFacts.conservativeReportedMicroUsd, 400_001n);
  assert.equal(result.error.evidence.reportedCostFacts.reservationOverrunMicroUsd, 1n);
  assert.equal(result.error.evidence.cost.reconciled, true);
  assert.equal(result.error.evidence.cost.refundedMicroUsd, 0n);
  assert.equal(result.error.evidence.cost.overrunMicroUsd, 1n);
  assert.equal(
    result.error.evidence.cost.settledMicroUsd + result.error.evidence.cost.refundedMicroUsd,
    result.error.evidence.cost.reservedMicroUsd + result.error.evidence.cost.overrunMicroUsd,
  );
});

test("a known overrun consumes task capacity and blocks a cumulative cap breach", async () => {
  const runHarness = harness(500n);
  const first = await runHarness.runAttempt(
    request("attempt_known_overrun", {
      attemptSubcapMicroUsd: 500n,
      reservationMicroUsd: 400n,
    }),
    new DeterministicFakeTransport({
      scenario: "SUCCESS",
      executionReportedMicroUsd: 450n,
    }),
  );
  assert.equal(first.ok, false);
  assert.equal(first.error.code, "COST_RECONCILIATION_FAILED");
  assert.equal(first.error.evidence.cost.reservedMicroUsd, 400n);
  assert.equal(first.error.evidence.cost.reportedMicroUsd, 450n);
  assert.equal(first.error.evidence.cost.settledMicroUsd, 450n);
  assert.equal(first.error.evidence.cost.refundedMicroUsd, 0n);
  assert.equal(first.error.evidence.cost.overrunMicroUsd, 50n);
  assert.equal(
    first.error.evidence.reportedCostFacts.reservationOverrunMicroUsd,
    first.error.evidence.cost.overrunMicroUsd,
  );
  assert.deepEqual(
    first.error.evidence.cost.events.map(({ eventType, amountMicroUsd }) => [
      eventType,
      amountMicroUsd,
    ]),
    [
      ["RESERVED", 400n],
      ["REPORTED", 450n],
      ["RESERVATION_OVERRUN", 50n],
      ["SETTLED", 450n],
      ["REFUNDED", 0n],
    ],
  );
  assert.equal(
    first.error.evidence.cost.settledMicroUsd + first.error.evidence.cost.refundedMicroUsd,
    first.error.evidence.cost.reservedMicroUsd + first.error.evidence.cost.overrunMicroUsd,
  );
  assert.equal(first.error.taskCost.knownReportedMicroUsd, 450n);
  assert.equal(first.error.taskCost.availableMicroUsd, 50n);

  const secondTransport = new DeterministicFakeTransport({ scenario: "CAP_EXHAUSTION" });
  const second = await runHarness.runAttempt(
    request("attempt_would_breach_cap", {
      attemptSubcapMicroUsd: 100n,
      reservationMicroUsd: 100n,
    }),
    secondTransport,
  );
  assert.equal(second.ok, false);
  assert.equal(second.error.code, "TASK_CAP_EXCEEDED");
  assert.equal(second.error.taskCost.settledMicroUsd, 450n);
  assert.equal(second.error.taskCost.knownReportedMicroUsd, 450n);
  assert.deepEqual(secondTransport.callLog(), []);
});

test("overrun remains an active observed floor when cancellation and cleanup fail", async () => {
  const runHarness = harness(500n);
  const result = await runHarness.runAttempt(
    request("attempt_unsettled_overrun", {
      attemptSubcapMicroUsd: 500n,
      reservationMicroUsd: 400n,
    }),
    new DeterministicFakeTransport({
      scenario: "TIMEOUT",
      executionReportedMicroUsd: 450n,
      throwAt: ["CANCELLATION", "CLEANUP"],
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "COMPOUND_FAILURE");
  const evidence = result.error.evidence;
  assert.equal(evidence.execution.outcome, "TIMED_OUT");
  assert.equal(evidence.cancellation.failureKind, "TRANSPORT_EXCEPTION");
  assert.equal(evidence.cleanup.failureKind, "TRANSPORT_EXCEPTION");
  assert.equal(evidence.cost.reportedMicroUsd, 450n);
  assert.equal(evidence.cost.settledMicroUsd, 0n);
  assert.equal(evidence.cost.activeCommitmentMicroUsd, 450n);
  assert.equal(evidence.cost.overrunMicroUsd, 50n);
  assert.equal(evidence.taskCostAfter.knownReportedMicroUsd, 450n);
  assert.equal(evidence.taskCostAfter.availableMicroUsd, 50n);
  assert.deepEqual(
    evidence.cost.events.map(({ eventType, amountMicroUsd }) => [eventType, amountMicroUsd]),
    [
      ["RESERVED", 400n],
      ["REPORTED", 450n],
      ["RESERVATION_OVERRUN", 50n],
    ],
  );

  const retryTransport = new DeterministicFakeTransport({ scenario: "CAP_EXHAUSTION" });
  const retry = await runHarness.runAttempt(
    request("attempt_after_unsettled_overrun", {
      attemptSubcapMicroUsd: 51n,
      reservationMicroUsd: 51n,
    }),
    retryTransport,
  );
  assert.equal(retry.ok, false);
  assert.equal(retry.error.code, "TASK_CAP_EXCEEDED");
  assert.deepEqual(retryTransport.callLog(), []);
});

test("acknowledged execution exceptions trigger best-effort cancellation and cleanup with full evidence", async () => {
  const transport = new DeterministicFakeTransport({
    scenario: "SUCCESS",
    cancellationReportedMicroUsd: 80_000n,
    throwAt: ["EXECUTION"],
  });
  const result = await harness().runAttempt(request("attempt_execution_exception"), transport);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "TRANSPORT_PROTOCOL_FAILURE");
  const evidence = result.error.evidence;
  assert.equal(evidence.dispatch.state, "ACKNOWLEDGED");
  assert.deepEqual(evidence.transportCalls, ["dispatch", "execute", "cancel", "cleanup"]);
  assert.deepEqual(evidence.execution, {
    outcome: "FAILED",
    failureKind: "TRANSPORT_EXCEPTION",
    message: "synthetic execution transport exception",
  });
  assert.equal(evidence.cancellation.outcome, "CANCELLED");
  assert.equal(evidence.cleanup.outcome, "SUCCEEDED");
  assert.equal(evidence.reportedCostFacts.cancellationReportedMicroUsd, 80_000n);
  assert.equal(evidence.cost.settledMicroUsd, 80_000n);
});

test("compound transport failures retain every stage and keep unknown cost reserved", async () => {
  const transport = new DeterministicFakeTransport({
    scenario: "SUCCESS",
    throwAt: ["EXECUTION", "CANCELLATION", "CLEANUP"],
  });
  const result = await harness().runAttempt(request("attempt_compound_exception"), transport);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "COMPOUND_FAILURE");
  const evidence = result.error.evidence;
  assert.equal(evidence.outcome, "COMPOUND_FAILURE");
  assert.equal(evidence.dispatch.state, "ACKNOWLEDGED");
  assert.equal(evidence.execution.failureKind, "TRANSPORT_EXCEPTION");
  assert.equal(evidence.cancellation.failureKind, "TRANSPORT_EXCEPTION");
  assert.equal(evidence.cleanup.failureKind, "TRANSPORT_EXCEPTION");
  assert.deepEqual(evidence.transportCalls, ["dispatch", "execute", "cancel", "cleanup"]);
  assert.deepEqual(
    evidence.issues.map(({ stage, code }) => [stage, code]),
    [
      ["EXECUTION", "TRANSPORT_EXCEPTION"],
      ["CANCELLATION", "TRANSPORT_EXCEPTION"],
      ["CLEANUP", "TRANSPORT_EXCEPTION"],
    ],
  );
  assert.equal(evidence.reportedCostFacts.conservativeReportedMicroUsd, null);
  assert.equal(evidence.cost.reconciled, false);
  assert.equal(evidence.cost.activeReservedMicroUsd, 400_000n);
});

test("compound cleanup exception and cost overrun preserve the actual report and both failures", async () => {
  const transport = new DeterministicFakeTransport({
    scenario: "SUCCESS",
    executionReportedMicroUsd: 450_000n,
    throwAt: ["CLEANUP"],
  });
  const result = await harness().runAttempt(request("attempt_compound_overrun"), transport);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "COMPOUND_FAILURE");
  const evidence = result.error.evidence;
  assert.equal(evidence.execution.outcome, "SUCCEEDED");
  assert.equal(evidence.cleanup.failureKind, "TRANSPORT_EXCEPTION");
  assert.equal(evidence.reportedCostFacts.executionReportedMicroUsd, 450_000n);
  assert.equal(evidence.reportedCostFacts.conservativeReportedMicroUsd, 450_000n);
  assert.equal(evidence.reportedCostFacts.reservationOverrunMicroUsd, 50_000n);
  assert.equal(evidence.cost.settledMicroUsd, 450_000n);
  assert.equal(evidence.cost.activeReservedMicroUsd, 0n);
  assert.deepEqual(
    evidence.issues.map(({ stage, code }) => [stage, code]),
    [
      ["CLEANUP", "TRANSPORT_EXCEPTION"],
      ["COST_RECONCILIATION", "RESERVATION_OVERRUN"],
    ],
  );
});

test("every transport result is runtime-validated before ledger settlement", async (context) => {
  const cases = [
    {
      name: "dispatch external ID",
      options: { scenario: "SUCCESS", protocolFault: "DISPATCH_INVALID_EXTERNAL_JOB_ID" },
      overrides: {},
      calls: ["dispatch"],
      stage: "DISPATCH",
      evidenceField: "dispatch",
    },
    {
      name: "reconciliation external ID",
      options: {
        scenario: "AMBIGUOUS_ACKNOWLEDGEMENT",
        reconciliationOutcome: "ACKNOWLEDGEMENT_CONFIRMED",
        protocolFault: "RECONCILIATION_INVALID_EXTERNAL_JOB_ID",
      },
      overrides: {},
      calls: ["dispatch", "reconcile"],
      stage: "RECONCILIATION",
      evidenceField: "reconciliation",
    },
    {
      name: "execution result hash",
      options: {
        scenario: "SUCCESS",
        protocolFault: "EXECUTION_INVALID_RESULT_HASH",
        executionReportedMicroUsd: 135_000n,
        cancellationReportedMicroUsd: 160_000n,
      },
      overrides: {},
      calls: ["dispatch", "execute", "cancel", "cleanup"],
      stage: "EXECUTION",
      evidenceField: "execution",
    },
    {
      name: "timeout timestamp",
      options: { scenario: "TIMEOUT", protocolFault: "EXECUTION_INVALID_TIMEOUT_TIMESTAMP" },
      overrides: {},
      calls: ["dispatch", "execute", "cancel", "cleanup"],
      stage: "EXECUTION",
      evidenceField: "execution",
    },
    {
      name: "cancellation cost",
      options: { scenario: "CANCELLATION", protocolFault: "CANCELLATION_NEGATIVE_COST" },
      overrides: { cancelRequested: true },
      calls: ["dispatch", "cancel", "cleanup"],
      stage: "CANCELLATION",
      evidenceField: "cancellation",
    },
    {
      name: "cleanup evidence hash",
      options: { scenario: "SUCCESS", protocolFault: "CLEANUP_INVALID_EVIDENCE_HASH" },
      overrides: {},
      calls: ["dispatch", "execute", "cleanup"],
      stage: "CLEANUP",
      evidenceField: "cleanup",
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    await context.test(testCase.name, async () => {
      const transport = new DeterministicFakeTransport(testCase.options);
      const result = await harness().runAttempt(
        request(`attempt_protocol_${index}`, testCase.overrides),
        transport,
      );
      assert.equal(result.ok, false);
      const evidence = result.error.evidence;
      assert.deepEqual(evidence.transportCalls, testCase.calls);
      assert.equal(
        evidence[testCase.evidenceField].outcome ?? evidence[testCase.evidenceField].state,
        "FAILED",
      );
      assert.equal(
        evidence.issues.some(
          ({ stage, code }) => stage === testCase.stage && code === "RESULT_INVALID",
        ),
        true,
      );
      if (testCase.name === "execution result hash") {
        assert.equal(evidence.reportedCostFacts.executionReportedMicroUsd, 135_000n);
        assert.equal(evidence.reportedCostFacts.cancellationReportedMicroUsd, 160_000n);
        assert.equal(evidence.reportedCostFacts.conservativeReportedMicroUsd, 160_000n);
        assert.equal(evidence.cost.settledMicroUsd, 160_000n);
      }
      if (
        testCase.stage === "DISPATCH" ||
        testCase.stage === "RECONCILIATION" ||
        testCase.stage === "CANCELLATION"
      ) {
        assert.equal(evidence.cost.reconciled, false);
      }
    });
  }
});
