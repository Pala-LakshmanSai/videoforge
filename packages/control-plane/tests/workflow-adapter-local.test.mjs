import assert from "node:assert/strict";
import test from "node:test";

import {
  LocalWorkflowTransport,
  SignedCallbackProcessor,
  signLocalCallback,
} from "../dist/src/adapters/local-workflow.js";
import { createPGliteControlPlaneRepositories } from "../dist/src/adapters/pglite-repositories.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { createMigratedDatabase, FIXED_TIME, sha256, uuid } from "./support/pglite.mjs";

const SECRET = "local-callback-secret-with-at-least-thirty-two-bytes";

function secondsAfter(seconds) {
  return new Date(Date.parse(FIXED_TIME) + seconds * 1000).toISOString();
}

function owner() {
  return {
    ownerType: "PROJECT_REVISION",
    ownerId: IDS.revisionA,
    projectRevisionId: IDS.revisionA,
  };
}

function reservation(serial, sequence = 1) {
  const taskId = uuid(serial);
  const attemptId = uuid(serial + 1);
  const key = `workflow-local:${serial}:attempt:1`;
  return {
    idempotencyKey: key,
    task: {
      taskId,
      owner: owner(),
      taskKey: `workflow-local:${serial}`,
      lane: "IMAGE",
      initialState: "READY",
      required: true,
      dependsOn: [],
    },
    attempt: {
      attemptId,
      ordinal: 1,
      idempotencyKey: key,
      executionProfileId: IDS.executionProfileA,
      executionClaimTokenHash: sha256(`${key}:claim`),
      inputHash: sha256(`${key}:input`),
      parentAttemptId: null,
      fallbackReason: null,
    },
    costReservation: {
      costEventId: uuid(serial + 2),
      sequence,
      amountMicroUsd: 5000n,
      idempotencyKey: `${key}:cost`,
      details: { mode: "local" },
      occurredAt: FIXED_TIME,
    },
    dispatchOutbox: {
      outboxId: uuid(serial + 3),
      dedupeKey: `${key}:dispatch`,
      payloadContractName: "worker-job-envelope",
      payloadContractVersion: "v1",
      payloadHash: sha256(`${key}:payload`),
      payload: { taskId, attemptId },
      availableAt: FIXED_TIME,
    },
  };
}

async function withContext(work) {
  const context = await createMigratedDatabase();
  try {
    await seedLockedProjects(context.executor);
    const repositories = createPGliteControlPlaneRepositories(context.executor);
    return await work({ ...context, repositories });
  } finally {
    await context.database.close();
  }
}

async function reserve(repositories, command) {
  const result = await repositories.execution.reserveTaskAttempt(
    { workspaceId: IDS.workspaceA },
    command,
  );
  assert.equal(result.ok, true);
  return result.value.value;
}

test("local transport leases once and atomically records a confirmed acknowledgement", async () => {
  await withContext(async ({ executor, repositories }) => {
    const command = reservation(20_000);
    await reserve(repositories, command);
    const observed = [];
    const transport = new LocalWorkflowTransport(
      executor,
      {
        async dispatch(outbox) {
          observed.push(outbox.outboxId);
          return {
            kind: "ACKNOWLEDGED",
            externalJobId: "local-confirmed-001",
            providerDetails: { driver: "fixture" },
            acknowledgedAt: secondsAfter(1),
          };
        },
      },
      { clock: () => secondsAfter(1) },
    );
    const result = await transport.deliverNext({
      workerId: "local-worker-1",
      now: FIXED_TIME,
      leaseExpiresAt: secondsAfter(30),
    });
    assert.equal(result.kind, "DELIVERED");
    assert.equal(result.outbox.state, "DELIVERED");
    assert.equal(result.acknowledgement.externalJobId, "local-confirmed-001");
    assert.deepEqual(observed, [command.dispatchOutbox.outboxId]);

    const attempt = await executor.query(
      "SELECT dispatch_state, external_job_id FROM attempts WHERE id = $1",
      [command.attempt.attemptId],
    );
    assert.equal(attempt.rows[0].dispatch_state, "ACKNOWLEDGED");
    assert.equal(attempt.rows[0].external_job_id, "local-confirmed-001");
    assert.equal(
      await transport.leaseNext({
        workerId: "local-worker-2",
        now: secondsAfter(2),
        leaseExpiresAt: secondsAfter(32),
      }),
      null,
    );
  });
});

test("ambiguous acknowledgement is quarantined and never blindly redispatched", async () => {
  await withContext(async ({ executor, repositories }) => {
    const command = reservation(20_100);
    await reserve(repositories, command);
    let dispatches = 0;
    const transport = new LocalWorkflowTransport(
      executor,
      {
        async dispatch() {
          dispatches += 1;
          return {
            kind: "ACKNOWLEDGEMENT_UNKNOWN",
            providerDetails: { driver: "fixture", response: "lost" },
            ambiguityReason: "connection closed after request bytes",
            observedAt: secondsAfter(1),
          };
        },
      },
      { clock: () => secondsAfter(1) },
    );
    const result = await transport.deliverNext({
      workerId: "local-worker-1",
      now: FIXED_TIME,
      leaseExpiresAt: secondsAfter(30),
    });
    assert.equal(result.kind, "ACKNOWLEDGEMENT_UNKNOWN");
    assert.equal(result.outbox.state, "DEAD_LETTER");
    assert.equal(result.ambiguity.dispatchState, "AMBIGUOUS");
    assert.equal(dispatches, 1);
    assert.equal(
      await transport.leaseNext({
        workerId: "local-worker-2",
        now: secondsAfter(31),
        leaseExpiresAt: secondsAfter(61),
      }),
      null,
    );
    assert.equal(dispatches, 1);

    const reconciled = await repositories.execution.reconcileDispatch(
      { workspaceId: IDS.workspaceA },
      {
        idempotencyKey: "workflow-local:reconcile:not-dispatched",
        taskId: command.task.taskId,
        attemptId: command.attempt.attemptId,
        evidence: {
          outcome: "NOT_DISPATCHED_CONFIRMED",
          evidenceHash: sha256("local-not-dispatched-evidence"),
        },
        reconciledAt: secondsAfter(40),
      },
    );
    assert.equal(reconciled.ok, true);
    assert.equal(reconciled.value.value.dispatchState, "RECONCILED");
  });
});

test("definite not-sent outcome enters retry wait without changing attempt dispatch state", async () => {
  await withContext(async ({ executor, repositories }) => {
    const command = reservation(20_200);
    await reserve(repositories, command);
    const transport = new LocalWorkflowTransport(
      executor,
      {
        async dispatch() {
          return {
            kind: "DEFINITELY_NOT_SENT",
            reason: "local queue full before request bytes",
            classifiedAt: secondsAfter(1),
            retryAt: secondsAfter(60),
          };
        },
      },
      { clock: () => secondsAfter(1) },
    );
    const result = await transport.deliverNext({
      workerId: "local-worker-1",
      now: FIXED_TIME,
      leaseExpiresAt: secondsAfter(30),
    });
    assert.equal(result.kind, "RETRY_WAIT");
    assert.equal(result.outbox.state, "RETRY_WAIT");
    assert.equal(result.outbox.availableAt, secondsAfter(60));
    const attempt = await executor.query("SELECT dispatch_state FROM attempts WHERE id = $1", [
      command.attempt.attemptId,
    ]);
    assert.equal(attempt.rows[0].dispatch_state, "NOT_SENT");
  });
});

test("an unclassified driver failure is ambiguous and cannot enter automatic retry", async () => {
  await withContext(async ({ executor, repositories }) => {
    const command = reservation(20_250);
    await reserve(repositories, command);
    const transport = new LocalWorkflowTransport(
      executor,
      {
        async dispatch() {
          throw new Error("connection reset after an unknown number of request bytes");
        },
      },
      { clock: () => secondsAfter(1) },
    );
    const result = await transport.deliverNext({
      workerId: "local-worker-1",
      now: FIXED_TIME,
      leaseExpiresAt: secondsAfter(30),
    });
    assert.equal(result.kind, "ACKNOWLEDGEMENT_UNKNOWN");
    assert.equal(result.outbox.state, "DEAD_LETTER");
    assert.equal(result.ambiguity.dispatchState, "AMBIGUOUS");
    const attempt = await executor.query("SELECT dispatch_state FROM attempts WHERE id = $1", [
      command.attempt.attemptId,
    ]);
    assert.equal(attempt.rows[0].dispatch_state, "AMBIGUOUS");
  });
});

test("a stale worker cannot settle after another worker acquires the expired lease", async () => {
  await withContext(async ({ executor, repositories }) => {
    const command = reservation(20_270);
    await reserve(repositories, command);
    const secondTransport = new LocalWorkflowTransport(executor, {
      async dispatch() {
        throw new Error("not called");
      },
    });
    const firstTransport = new LocalWorkflowTransport(
      executor,
      {
        async dispatch(outbox) {
          await executor.query(
            "UPDATE outbox SET lease_expires_at = $2 WHERE id = $1 AND state = 'LEASED'",
            [outbox.outboxId, secondsAfter(1)],
          );
          const stolen = await secondTransport.leaseNext({
            workerId: "local-worker-2",
            now: secondsAfter(2),
            leaseExpiresAt: secondsAfter(32),
          });
          assert.equal(stolen.leaseOwner, "local-worker-2");
          return {
            kind: "ACKNOWLEDGED",
            externalJobId: "stale-worker-job",
            providerDetails: { driver: "stale-fixture" },
            acknowledgedAt: secondsAfter(3),
          };
        },
      },
      { clock: () => secondsAfter(3) },
    );
    const result = await firstTransport.deliverNext({
      workerId: "local-worker-1",
      now: FIXED_TIME,
      leaseExpiresAt: secondsAfter(30),
    });
    assert.equal(result.kind, "LEASE_LOST");
    assert.equal(result.outbox.leaseOwner, "local-worker-2");
    const attempt = await executor.query(
      "SELECT dispatch_state, external_job_id FROM attempts WHERE id = $1",
      [command.attempt.attemptId],
    );
    assert.deepEqual(attempt.rows[0], { dispatch_state: "NOT_SENT", external_job_id: null });
  });
});

test("a worker cannot backdate an outcome to settle after its lease expires", async () => {
  await withContext(async ({ executor, repositories }) => {
    const command = reservation(20_280);
    await reserve(repositories, command);
    const transport = new LocalWorkflowTransport(
      executor,
      {
        async dispatch() {
          return {
            kind: "ACKNOWLEDGED",
            externalJobId: "backdated-stale-job",
            providerDetails: { driver: "backdated-fixture" },
            acknowledgedAt: secondsAfter(1),
          };
        },
      },
      { clock: () => secondsAfter(31) },
    );
    const result = await transport.deliverNext({
      workerId: "local-worker-expired",
      now: FIXED_TIME,
      leaseExpiresAt: secondsAfter(30),
    });
    assert.equal(result.kind, "LEASE_LOST");
    assert.equal(result.outbox.state, "LEASED");
    assert.equal(result.outbox.leaseOwner, "local-worker-expired");
    const attempt = await executor.query(
      "SELECT dispatch_state, external_job_id FROM attempts WHERE id = $1",
      [command.attempt.attemptId],
    );
    assert.deepEqual(attempt.rows[0], { dispatch_state: "NOT_SENT", external_job_id: null });
  });
});

test("ambiguous CANCEL transport preserves the prior dispatch state and cancellation request", async () => {
  await withContext(async ({ executor, repositories }) => {
    const command = reservation(20_290);
    await reserve(repositories, command);
    await executor.query(
      `UPDATE outbox SET state = 'DELIVERED', delivered_at = $2, updated_at = $2
       WHERE id = $1`,
      [command.dispatchOutbox.outboxId, FIXED_TIME],
    );
    const cancellation = await repositories.execution.requestCancellation(
      { workspaceId: IDS.workspaceA },
      {
        idempotencyKey: "workflow-local:cancel:ambiguous",
        target: "ATTEMPT",
        taskId: command.task.taskId,
        attemptId: command.attempt.attemptId,
        expectedTaskVersion: 1,
        requestedAt: secondsAfter(1),
        outbox: {
          outboxId: uuid(20_294),
          kind: "CANCEL",
          dedupeKey: "workflow-local:cancel:ambiguous:outbox",
          payloadContractName: "worker-cancel-envelope",
          payloadContractVersion: "v1",
          payloadHash: sha256("workflow-local-cancel-ambiguous"),
          payload: { taskId: command.task.taskId, attemptId: command.attempt.attemptId },
          availableAt: secondsAfter(1),
        },
      },
    );
    assert.equal(cancellation.ok, true);
    const transport = new LocalWorkflowTransport(
      executor,
      {
        async dispatch() {
          return {
            kind: "ACKNOWLEDGEMENT_UNKNOWN",
            providerDetails: { driver: "fixture" },
            ambiguityReason: "cancel acknowledgement lost",
            observedAt: secondsAfter(2),
          };
        },
      },
      { clock: () => secondsAfter(2) },
    );
    const result = await transport.deliverNext({
      workerId: "local-worker-1",
      now: secondsAfter(1),
      leaseExpiresAt: secondsAfter(31),
    });
    assert.equal(result.kind, "ACKNOWLEDGEMENT_UNKNOWN");
    assert.equal(result.outbox.kind, "CANCEL");
    assert.equal(result.outbox.state, "DEAD_LETTER");
    assert.equal(result.ambiguity, null);
    const rows = await executor.query(
      `SELECT task.state AS task_state, attempt.dispatch_state
       FROM generation_tasks task
       JOIN attempts attempt ON attempt.task_id = task.id
       WHERE task.id = $1 AND attempt.id = $2`,
      [command.task.taskId, command.attempt.attemptId],
    );
    assert.deepEqual(rows.rows[0], {
      task_state: "CANCEL_REQUESTED",
      dispatch_state: "NOT_SENT",
    });
  });
});

test("execution claims are single-use before costly local work starts", async () => {
  await withContext(async ({ repositories }) => {
    const command = reservation(20_300);
    const reserved = await reserve(repositories, command);
    const claim = {
      idempotencyKey: "workflow-local:claim:first",
      taskId: command.task.taskId,
      attemptId: command.attempt.attemptId,
      presentedClaimTokenHash: command.attempt.executionClaimTokenHash,
      expectedTaskVersion: reserved.task.version,
      claimedAt: secondsAfter(1),
    };
    const first = await repositories.execution.claimExecution(
      { workspaceId: IDS.workspaceA },
      claim,
    );
    assert.equal(first.ok, true);
    assert.equal(first.value.replayed, false);
    const replay = await repositories.execution.claimExecution(
      { workspaceId: IDS.workspaceA },
      claim,
    );
    assert.equal(replay.ok, true);
    assert.equal(replay.value.replayed, true);
    const duplicate = await repositories.execution.claimExecution(
      { workspaceId: IDS.workspaceA },
      { ...claim, idempotencyKey: "workflow-local:claim:duplicate", claimedAt: secondsAfter(2) },
    );
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.kind, "CONFLICT");
    assert.equal(duplicate.code, "CLAIM_ALREADY_CONSUMED");
  });
});

test("mutation receipts preserve exact results and reject changed or cross-operation retries", async () => {
  await withContext(async ({ executor, repositories }) => {
    const scope = { workspaceId: IDS.workspaceA };
    const reservedCommand = reservation(20_320, 20);
    const reserved = await reserve(repositories, reservedCommand);
    const reservationReplay = await repositories.execution.reserveTaskAttempt(
      scope,
      structuredClone(reservedCommand),
    );
    assert.equal(reservationReplay.ok, true);
    assert.equal(reservationReplay.value.replayed, true);
    assert.deepEqual(reservationReplay.value.value, reserved);
    assert.equal(typeof reservationReplay.value.value.costReservation.amountMicroUsd, "bigint");
    const changedReservation = await repositories.execution.reserveTaskAttempt(scope, {
      ...structuredClone(reservedCommand),
      task: { ...reservedCommand.task, taskKey: "workflow-local:changed-task-key" },
    });
    assert.equal(changedReservation.ok, false);
    assert.equal(changedReservation.code, "IDEMPOTENCY_KEY_REUSED");

    const claim = {
      idempotencyKey: "workflow-local:receipt:claim",
      taskId: reservedCommand.task.taskId,
      attemptId: reservedCommand.attempt.attemptId,
      presentedClaimTokenHash: reservedCommand.attempt.executionClaimTokenHash,
      expectedTaskVersion: reserved.task.version,
      claimedAt: secondsAfter(1),
    };
    const claimed = await repositories.execution.claimExecution(scope, claim);
    assert.equal(claimed.ok, true);
    assert.equal(claimed.value.replayed, false);
    const crossOperation = await repositories.execution.recordUnknownAttempt(scope, {
      idempotencyKey: claim.idempotencyKey,
      taskId: reservedCommand.task.taskId,
      attemptId: reservedCommand.attempt.attemptId,
      problemCode: "CROSS_OPERATION_SHOULD_NOT_APPLY",
      providerDetails: { source: "changed-operation" },
      observedAt: secondsAfter(2),
    });
    assert.equal(crossOperation.ok, false);
    assert.equal(crossOperation.code, "IDEMPOTENCY_KEY_REUSED");
    const claimReplay = await repositories.execution.claimExecution(scope, structuredClone(claim));
    assert.equal(claimReplay.ok, true);
    assert.equal(claimReplay.value.replayed, true);
    assert.deepEqual(claimReplay.value.value, claimed.value.value);

    const unknownCommandReservation = reservation(20_340, 21);
    await reserve(repositories, unknownCommandReservation);
    const unknownOriginal = {
      idempotencyKey: "workflow-local:receipt:unknown",
      taskId: unknownCommandReservation.task.taskId,
      attemptId: unknownCommandReservation.attempt.attemptId,
      problemCode: "CALLBACK_MISSING",
      providerDetails: { reconciliation: "required" },
      observedAt: secondsAfter(2),
    };
    const mutableUnknown = structuredClone(unknownOriginal);
    const unknownPromise = repositories.execution.recordUnknownAttempt(scope, mutableUnknown);
    mutableUnknown.problemCode = "MUTATED_AFTER_CALL";
    mutableUnknown.providerDetails.reconciliation = "mutated";
    const unknown = await unknownPromise;
    assert.equal(unknown.ok, true);
    assert.equal(unknown.value.value.attempt.problemCode, "CALLBACK_MISSING");
    const unknownReplay = await repositories.execution.recordUnknownAttempt(
      scope,
      structuredClone(unknownOriginal),
    );
    assert.equal(unknownReplay.ok, true);
    assert.equal(unknownReplay.value.replayed, true);
    assert.deepEqual(unknownReplay.value.value, unknown.value.value);
    const changedUnknown = await repositories.execution.recordUnknownAttempt(scope, {
      ...structuredClone(unknownOriginal),
      problemCode: "DIFFERENT_PROBLEM",
    });
    assert.equal(changedUnknown.ok, false);
    assert.equal(changedUnknown.code, "IDEMPOTENCY_KEY_REUSED");

    const dispatchReservation = reservation(20_360, 22);
    await reserve(repositories, dispatchReservation);
    const acknowledgementUnknown = {
      idempotencyKey: "workflow-local:receipt:ack-unknown",
      taskId: dispatchReservation.task.taskId,
      attemptId: dispatchReservation.attempt.attemptId,
      providerDetails: { transport: "local", response: "lost" },
      ambiguityReason: "connection closed after request bytes",
      observedAt: secondsAfter(3),
    };
    const ambiguous = await repositories.execution.recordDispatchAckUnknown(
      scope,
      acknowledgementUnknown,
    );
    assert.equal(ambiguous.ok, true);
    const changedAmbiguity = await repositories.execution.recordDispatchAckUnknown(scope, {
      ...structuredClone(acknowledgementUnknown),
      ambiguityReason: "different ambiguity",
    });
    assert.equal(changedAmbiguity.ok, false);
    assert.equal(changedAmbiguity.code, "IDEMPOTENCY_KEY_REUSED");
    const reconciliation = {
      idempotencyKey: "workflow-local:receipt:reconcile",
      taskId: dispatchReservation.task.taskId,
      attemptId: dispatchReservation.attempt.attemptId,
      evidence: {
        outcome: "NOT_DISPATCHED_CONFIRMED",
        evidenceHash: sha256("workflow-local-receipt-reconcile"),
      },
      reconciledAt: secondsAfter(4),
    };
    const reconciled = await repositories.execution.reconcileDispatch(scope, reconciliation);
    assert.equal(reconciled.ok, true);
    const ambiguityReplay = await repositories.execution.recordDispatchAckUnknown(
      scope,
      structuredClone(acknowledgementUnknown),
    );
    assert.equal(ambiguityReplay.ok, true);
    assert.equal(ambiguityReplay.value.replayed, true);
    assert.deepEqual(ambiguityReplay.value.value, ambiguous.value.value);
    const reconcileReplay = await repositories.execution.reconcileDispatch(
      scope,
      structuredClone(reconciliation),
    );
    assert.equal(reconcileReplay.ok, true);
    assert.equal(reconcileReplay.value.replayed, true);
    assert.deepEqual(reconcileReplay.value.value, reconciled.value.value);

    const terminalCommand = {
      idempotencyKey: "workflow-local:receipt:terminal",
      taskId: dispatchReservation.task.taskId,
      attemptId: dispatchReservation.attempt.attemptId,
      state: "FAILED",
      problemCode: "LOCAL_TERMINAL",
      providerDetails: { source: "fixture" },
      finishedAt: secondsAfter(5),
    };
    const terminal = await repositories.execution.recordTerminalResult(scope, terminalCommand);
    assert.equal(terminal.ok, true);
    const terminalReplay = await repositories.execution.recordTerminalResult(
      scope,
      structuredClone(terminalCommand),
    );
    assert.equal(terminalReplay.ok, true);
    assert.equal(terminalReplay.value.replayed, true);
    assert.deepEqual(terminalReplay.value.value, terminal.value.value);
    const changedTerminal = await repositories.execution.recordTerminalResult(scope, {
      ...structuredClone(terminalCommand),
      finishedAt: secondsAfter(6),
    });
    assert.equal(changedTerminal.ok, false);
    assert.equal(changedTerminal.code, "IDEMPOTENCY_KEY_REUSED");

    const acceptedReservation = reservation(20_380, 23);
    await reserve(repositories, acceptedReservation);
    const successful = await repositories.execution.recordSuccessfulResult(scope, {
      idempotencyKey: "workflow-local:receipt:successful",
      taskId: acceptedReservation.task.taskId,
      attemptId: acceptedReservation.attempt.attemptId,
      outputAssetId: IDS.outputA1,
      outputBinarySha256: HASHES.outputA1,
      providerDetails: { provider: "local" },
      finishedAt: secondsAfter(7),
    });
    assert.equal(successful.ok, true);
    const acceptance = {
      idempotencyKey: "workflow-local:receipt:accept",
      candidateReference: successful.value.value.reference,
      acceptedAt: secondsAfter(8),
    };
    const accepted = await repositories.execution.acceptSuccessfulResult(scope, acceptance);
    assert.equal(accepted.ok, true);
    const acceptedReplay = await repositories.execution.acceptSuccessfulResult(
      scope,
      structuredClone(acceptance),
    );
    assert.equal(acceptedReplay.ok, true);
    assert.equal(acceptedReplay.value.replayed, true);
    assert.deepEqual(acceptedReplay.value.value, accepted.value.value);
    const changedAcceptance = await repositories.execution.acceptSuccessfulResult(scope, {
      ...structuredClone(acceptance),
      acceptedAt: secondsAfter(9),
    });
    assert.equal(changedAcceptance.ok, false);
    assert.equal(changedAcceptance.code, "IDEMPOTENCY_KEY_REUSED");

    const accessorClaim = {
      ...structuredClone(claim),
      idempotencyKey: "workflow-local:receipt:accessor",
    };
    Object.defineProperty(accessorClaim, "claimedAt", {
      enumerable: true,
      get() {
        return secondsAfter(10);
      },
    });
    await assert.rejects(
      repositories.execution.claimExecution(scope, accessorClaim),
      /cannot encode accessors/,
    );

    let deeplyNestedDetails = { leaf: true };
    for (let depth = 0; depth < 100; depth += 1) {
      deeplyNestedDetails = { child: deeplyNestedDetails };
    }
    const deepReceiptKey = "workflow-local:receipt:depth-limit";
    await assert.rejects(
      repositories.execution.recordUnknownAttempt(scope, {
        idempotencyKey: deepReceiptKey,
        taskId: unknownCommandReservation.task.taskId,
        attemptId: unknownCommandReservation.attempt.attemptId,
        problemCode: "DEPTH_LIMIT",
        providerDetails: deeplyNestedDetails,
        observedAt: secondsAfter(10),
      }),
      /repository receipt codec depth exceeds 64/,
    );
    const rejectedDeepReceipt = await executor.query(
      "SELECT count(*)::int AS receipts FROM repository_mutation_receipts WHERE idempotency_key = $1",
      [deepReceiptKey],
    );
    assert.equal(rejectedDeepReceipt.rows[0].receipts, 0);

    const receiptRows = await executor.query(
      `SELECT operation, input_hash, result_codec, result_hash
       FROM repository_mutation_receipts WHERE workspace_id = $1 ORDER BY operation`,
      [IDS.workspaceA],
    );
    assert.ok(receiptRows.rows.length >= 11);
    assert.ok(
      receiptRows.rows.every(
        (row) =>
          row.result_codec === "repository-result/v1" &&
          /^sha256:[0-9a-f]{64}$/.test(row.input_hash) &&
          /^sha256:[0-9a-f]{64}$/.test(row.result_hash),
      ),
    );
  });
});

test("unit-of-work scope mismatch taints and rolls back even when its failure is ignored", async () => {
  await withContext(async ({ executor, repositories }) => {
    const command = reservation(20_450, 30);
    const result = await repositories.unitOfWork.execute(
      { workspaceId: IDS.workspaceA },
      async (transactionRepositories) => {
        const reserved = await transactionRepositories.execution.reserveTaskAttempt(
          { workspaceId: IDS.workspaceA },
          command,
        );
        assert.equal(reserved.ok, true);
        const crossWorkspace = await transactionRepositories.projects.archiveProject(
          { workspaceId: IDS.workspaceB, actorUserId: IDS.userB },
          {
            idempotencyKey: "workflow-local:uow:cross-workspace",
            projectId: IDS.projectB,
            expectedVersion: 1,
            archivedAt: secondsAfter(1),
          },
        );
        assert.equal(crossWorkspace.ok, false);
        assert.equal(crossWorkspace.code, "CROSS_WORKSPACE_REFERENCE");
        return { ok: true, value: "caller incorrectly ignored the scope failure" };
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.kind, "INVARIANT_VIOLATION");
    assert.equal(result.code, "CROSS_WORKSPACE_REFERENCE");

    const rolledBack = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM generation_tasks WHERE id = $1) AS tasks,
         (SELECT count(*)::int FROM attempts WHERE id = $2) AS attempts,
         (SELECT count(*)::int FROM repository_mutation_receipts
           WHERE idempotency_key IN ($3, $4)) AS receipts,
         (SELECT status FROM projects WHERE workspace_id = $5 AND id = $6) AS project_b_status`,
      [
        command.task.taskId,
        command.attempt.attemptId,
        command.idempotencyKey,
        "workflow-local:uow:cross-workspace",
        IDS.workspaceB,
        IDS.projectB,
      ],
    );
    assert.deepEqual(rolledBack.rows[0], {
      tasks: 0,
      attempts: 0,
      receipts: 0,
      project_b_status: "ACTIVE",
    });
  });
});

test("signed callback receipt, event append, and nonce claim commit together", async () => {
  await withContext(async ({ executor, repositories }) => {
    const command = reservation(20_400);
    await reserve(repositories, command);
    const workflowId = uuid(20_410);
    await executor.query(
      `INSERT INTO workflow_instances (
         id, workspace_id, owner_type, owner_id, task_id, workflow_type,
         state, external_system, idempotency_key
       ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $4, 'GENERATE', 'RUNNING', 'LOCAL', $5)`,
      [workflowId, IDS.workspaceA, IDS.revisionA, command.task.taskId, "workflow-local:callback"],
    );
    const rawPayload = JSON.stringify({ state: "RUNNING", progress: 1 });
    const event = {
      idempotencyKey: "workflow-local:callback:event:1",
      eventId: uuid(20_411),
      workflowInstanceId: workflowId,
      aggregate: {
        aggregateType: "ATTEMPT",
        aggregateId: command.attempt.attemptId,
        taskId: command.task.taskId,
        attemptId: command.attempt.attemptId,
      },
      sequence: 1,
      kind: "DISPATCH_ACKNOWLEDGED",
      payloadContractName: "worker-progress",
      payloadContractVersion: "v1",
      payloadHash: sha256(rawPayload),
      payload: { state: "RUNNING", progress: 1 },
      occurredAt: secondsAfter(10),
    };
    const unsigned = {
      receiptId: uuid(20_412),
      scope: { workspaceId: IDS.workspaceA },
      taskId: command.task.taskId,
      attemptId: command.attempt.attemptId,
      callbackKind: "worker_progress",
      nonce: "nonce-local-callback-0001",
      signatureKeyId: "local-fixture-key-v1",
      signedAt: FIXED_TIME,
      expiresAt: secondsAfter(300),
      rawPayload,
      workflowEvent: event,
    };
    const envelope = { ...unsigned, signature: signLocalCallback(unsigned, SECRET) };
    const processor = new SignedCallbackProcessor(executor, {
      id: "local-fixture-key-v1",
      secret: SECRET,
      clock: () => secondsAfter(10),
    });
    const alteredEvent = {
      ...envelope,
      workflowEvent: { ...event, kind: "ATTEMPT_FAILED" },
    };
    const alteredResult = await processor.process(alteredEvent);
    assert.equal(alteredResult.ok, false);
    assert.equal(alteredResult.code, "CALLBACK_SIGNATURE_INVALID");
    const alteredReceipt = await processor.process({ ...envelope, receiptId: uuid(20_427) });
    assert.equal(alteredReceipt.ok, false);
    assert.equal(alteredReceipt.code, "CALLBACK_SIGNATURE_INVALID");
    const beforeAccepted = await executor.query(
      "SELECT count(*)::int AS receipts FROM callback_receipts",
    );
    assert.equal(beforeAccepted.rows[0].receipts, 0);

    const payloadMismatchUnsigned = {
      ...unsigned,
      receiptId: uuid(20_416),
      nonce: "nonce-local-callback-0004",
      workflowEvent: { ...event, eventId: uuid(20_417), payload: { state: "FAILED" } },
    };
    const payloadMismatch = await processor.process({
      ...payloadMismatchUnsigned,
      signature: signLocalCallback(payloadMismatchUnsigned, SECRET),
    });
    assert.equal(payloadMismatch.ok, false);
    assert.equal(payloadMismatch.code, "CALLBACK_PAYLOAD_HASH_MISMATCH");

    const linkageMismatchUnsigned = {
      ...unsigned,
      receiptId: uuid(20_418),
      nonce: "nonce-local-callback-0005",
      attemptId: uuid(20_419),
      workflowEvent: { ...event, eventId: uuid(20_420) },
    };
    const linkageMismatch = await processor.process({
      ...linkageMismatchUnsigned,
      signature: signLocalCallback(linkageMismatchUnsigned, SECRET),
    });
    assert.equal(linkageMismatch.ok, false);
    assert.equal(linkageMismatch.code, "CALLBACK_EVENT_REJECTED");

    let deeplyNestedCallbackPayload = { leaf: true };
    for (let depth = 0; depth < 100; depth += 1) {
      deeplyNestedCallbackPayload = { child: deeplyNestedCallbackPayload };
    }
    const deepRawPayload = JSON.stringify(deeplyNestedCallbackPayload);
    const deepCallback = {
      ...unsigned,
      receiptId: uuid(20_428),
      nonce: "nonce-local-callback-depth-limit",
      rawPayload: deepRawPayload,
      workflowEvent: {
        ...event,
        idempotencyKey: "workflow-local:callback:event:depth-limit",
        eventId: uuid(20_429),
        payloadHash: sha256(deepRawPayload),
        payload: deeplyNestedCallbackPayload,
      },
      signature: `sha256:${"0".repeat(64)}`,
    };
    const deepCallbackResult = await processor.process(deepCallback);
    assert.equal(deepCallbackResult.ok, false);
    assert.equal(deepCallbackResult.code, "CALLBACK_PAYLOAD_HASH_MISMATCH");
    assert.match(deepCallbackResult.message, /callback JSON depth exceeds 64/);
    const deepCallbackRows = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM callback_receipts WHERE id = $1) AS receipts,
         (SELECT count(*)::int FROM workflow_events WHERE id = $2) AS events`,
      [deepCallback.receiptId, deepCallback.workflowEvent.eventId],
    );
    assert.deepEqual(deepCallbackRows.rows[0], { receipts: 0, events: 0 });

    const mutableEnvelope = {
      ...envelope,
      workflowEvent: { ...event, payload: { ...event.payload } },
    };
    const acceptedPromise = processor.process(mutableEnvelope);
    mutableEnvelope.workflowEvent.payload.state = "MUTATED_AFTER_PROCESS_CALL";
    mutableEnvelope.rawPayload = JSON.stringify({ state: "MUTATED_AFTER_PROCESS_CALL" });
    const accepted = await acceptedPromise;
    assert.equal(accepted.ok, true);
    assert.equal(accepted.event.eventId, event.eventId);
    const receipt = await executor.query(
      `SELECT nonce_hash, payload_hash, workflow_event_id, received_at
       FROM callback_receipts WHERE workspace_id = $1 AND id = $2`,
      [IDS.workspaceA, unsigned.receiptId],
    );
    assert.equal(receipt.rows.length, 1);
    assert.equal(receipt.rows[0].payload_hash, sha256(rawPayload));
    assert.equal(receipt.rows[0].workflow_event_id, event.eventId);
    assert.equal(receipt.rows[0].received_at.toISOString(), secondsAfter(10));
    const persistedEvent = await executor.query(
      "SELECT payload FROM workflow_events WHERE workspace_id = $1 AND id = $2",
      [IDS.workspaceA, event.eventId],
    );
    assert.deepEqual(persistedEvent.rows[0].payload, { state: "RUNNING", progress: 1 });

    const replay = await processor.process(envelope);
    assert.deepEqual(replay, {
      ok: false,
      code: "CALLBACK_REPLAY",
      message: "callback nonce was already used",
    });
    const counts = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM callback_receipts) AS receipts,
         (SELECT count(*)::int FROM workflow_events) AS events`,
    );
    assert.deepEqual(counts.rows[0], { receipts: 1, events: 1 });

    const rejectedEvent = {
      ...event,
      idempotencyKey: "workflow-local:callback:event:non-monotonic",
      eventId: uuid(20_413),
      payloadHash: sha256(JSON.stringify({ state: "STALE" })),
      payload: { state: "STALE" },
    };
    const rejectedUnsigned = {
      ...unsigned,
      receiptId: uuid(20_414),
      nonce: "nonce-local-callback-0002",
      rawPayload: JSON.stringify({ state: "STALE" }),
      workflowEvent: rejectedEvent,
    };
    const rejected = await processor.process({
      ...rejectedUnsigned,
      signature: signLocalCallback(rejectedUnsigned, SECRET),
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "CALLBACK_EVENT_REJECTED");
    const rolledBack = await executor.query(
      "SELECT count(*)::int AS receipts FROM callback_receipts WHERE id = $1",
      [rejectedUnsigned.receiptId],
    );
    assert.equal(rolledBack.rows[0].receipts, 0);

    const badSignature = await processor.process({
      ...rejectedUnsigned,
      receiptId: uuid(20_415),
      nonce: "nonce-local-callback-0003",
      signature: `sha256:${"0".repeat(64)}`,
    });
    assert.equal(badSignature.ok, false);
    assert.equal(badSignature.code, "CALLBACK_SIGNATURE_INVALID");

    const expiredFirstUseUnsigned = {
      ...unsigned,
      receiptId: uuid(20_421),
      nonce: "nonce-local-callback-expired-first-use",
      // This untrusted compatibility extra must not override the processor's clock.
      receivedAt: secondsAfter(10),
      workflowEvent: {
        ...event,
        idempotencyKey: "workflow-local:callback:event:expired-first-use",
        eventId: uuid(20_422),
      },
    };
    const expiredProcessor = new SignedCallbackProcessor(executor, {
      id: "local-fixture-key-v1",
      secret: SECRET,
      clock: () => secondsAfter(301),
    });
    const expired = await expiredProcessor.process({
      ...expiredFirstUseUnsigned,
      signature: signLocalCallback(expiredFirstUseUnsigned, SECRET),
    });
    assert.equal(expired.ok, false);
    assert.equal(expired.code, "CALLBACK_EXPIRED");
    const expiredReceipt = await executor.query(
      "SELECT count(*)::int AS receipts FROM callback_receipts WHERE id = $1",
      [expiredFirstUseUnsigned.receiptId],
    );
    assert.equal(expiredReceipt.rows[0].receipts, 0);

    const accessorPayload = {};
    Object.defineProperty(accessorPayload, "state", {
      enumerable: true,
      get() {
        return "RUNNING";
      },
    });
    assert.throws(
      () =>
        signLocalCallback(
          {
            ...unsigned,
            receiptId: uuid(20_423),
            nonce: "nonce-local-callback-accessor",
            workflowEvent: {
              ...event,
              idempotencyKey: "workflow-local:callback:event:accessor",
              eventId: uuid(20_424),
              payload: accessorPayload,
            },
          },
          SECRET,
        ),
      /accessors are not allowed/,
    );

    const boundedProcessor = new SignedCallbackProcessor(executor, {
      id: "local-fixture-key-v1",
      secret: SECRET,
      maximumPayloadBytes: 8,
      clock: () => secondsAfter(10),
    });
    const oversizedUnsigned = {
      ...unsigned,
      receiptId: uuid(20_425),
      nonce: "nonce-local-callback-oversized",
      workflowEvent: {
        ...event,
        idempotencyKey: "workflow-local:callback:event:oversized",
        eventId: uuid(20_426),
      },
    };
    const oversized = await boundedProcessor.process({
      ...oversizedUnsigned,
      signature: signLocalCallback(oversizedUnsigned, SECRET),
    });
    assert.equal(oversized.ok, false);
    assert.equal(oversized.code, "CALLBACK_PAYLOAD_TOO_LARGE");
  });
});
