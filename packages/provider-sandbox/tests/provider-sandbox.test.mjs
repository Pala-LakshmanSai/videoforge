import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicFakeTransport,
  ProviderSandboxHarness,
  createSandboxTaskIdentity,
  hashSandboxAttemptBinding,
  hashSandboxEvidence,
} from "../dist/src/index.js";

const NOW = 1_800_000_000_000;
const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;

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
  assert.equal(result.evidence.bindingHash, hashSandboxAttemptBinding(task, identity));
  assert.equal(Object.isFrozen(result.evidence), true);
  assert.equal(Object.isFrozen(result.evidence.task.owner), true);
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

test("reported cost above reservation fails closed and leaves the reservation visible", async () => {
  const transport = new DeterministicFakeTransport({
    scenario: "SUCCESS",
    reportedMicroUsd: 400_001n,
  });
  const result = await harness().runAttempt(request("attempt_cost_overrun"), transport);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "COST_RECONCILIATION_FAILED");
  assert.deepEqual(result.error.transportCalls, ["dispatch", "execute", "cleanup"]);
  assert.equal(result.error.taskCost.activeReservedMicroUsd, 400_000n);
  assert.equal(result.error.taskCost.settledMicroUsd, 0n);
});
