import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LocalWorkflowTransport,
  createPGliteControlPlaneRepositories,
} from "../dist/src/adapters/index.js";
import { DurableRecoveryCoordinator } from "../dist/src/recovery/index.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { createMigratedDatabase, FIXED_TIME, sha256, uuid } from "./support/pglite.mjs";

const SCOPE = Object.freeze({ workspaceId: IDS.workspaceA });
const OWNER = Object.freeze({
  ownerType: "PROJECT_REVISION",
  ownerId: IDS.revisionA,
  projectRevisionId: IDS.revisionA,
});

function secondsAfter(seconds) {
  return new Date(Date.parse(FIXED_TIME) + seconds * 1000).toISOString();
}

function reservation(serial, costSequence) {
  const taskId = uuid(serial);
  const attemptId = uuid(serial + 1);
  const idempotencyKey = `recovery:${serial}:attempt:1`;
  return {
    idempotencyKey,
    task: {
      taskId,
      owner: OWNER,
      taskKey: `recovery:${serial}`,
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
      idempotencyKey: `${idempotencyKey}:cost:reserved`,
      details: { transport: "deterministic-local" },
      occurredAt: FIXED_TIME,
    },
    dispatchOutbox: {
      outboxId: uuid(serial + 3),
      dedupeKey: `${idempotencyKey}:dispatch`,
      payloadContractName: "worker-job-envelope",
      payloadContractVersion: "v1",
      payloadHash: sha256(`${idempotencyKey}:payload`),
      payload: { taskId, attemptId, provider: "none" },
      availableAt: FIXED_TIME,
    },
  };
}

function costEvent(command, serial, sequence, eventType, amountMicroUsd, occurredAt) {
  return {
    costEventId: uuid(serial),
    owner: OWNER,
    taskId: command.task.taskId,
    attemptId: command.attempt.attemptId,
    sequence,
    eventType,
    amountMicroUsd,
    idempotencyKey: `${command.idempotencyKey}:cost:${eventType.toLowerCase()}`,
    providerReference: null,
    details: { provider: "none", source: "durable-recovery-test" },
    occurredAt,
  };
}

function cancellationOutbox(command, serial, availableAt) {
  return {
    kind: "CANCEL",
    outboxId: uuid(serial),
    dedupeKey: `${command.idempotencyKey}:cancel`,
    payloadContractName: "worker-cancellation",
    payloadContractVersion: "v1",
    payloadHash: sha256(`${command.idempotencyKey}:cancel-payload`),
    payload: {
      taskId: command.task.taskId,
      attemptId: command.attempt.attemptId,
      provider: "none",
    },
    availableAt,
  };
}

function coordinator(context, driver, clock) {
  const repositories = createPGliteControlPlaneRepositories(context.executor);
  const workflow = new LocalWorkflowTransport(context.executor, driver, { clock });
  return {
    repositories,
    recovery: new DurableRecoveryCoordinator(context.executor, repositories, workflow),
  };
}

function ok(result) {
  assert.equal(result.ok, true);
  return result.value;
}

async function withPersistentDatabase(work) {
  const root = await mkdtemp(join(tmpdir(), "videoforge-recovery-"));
  const dataDir = join(root, "pgdata");
  try {
    await work(dataDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("ambiguous dispatch survives restart and converges to one claimed, accepted, costed result", async () => {
  await withPersistentDatabase(async (dataDir) => {
    const command = reservation(30_000, 1);
    let dispatchCalls = 0;
    let context = await createMigratedDatabase(dataDir);
    try {
      await seedLockedProjects(context.executor);
      const first = coordinator(
        context,
        {
          async dispatch() {
            dispatchCalls += 1;
            return {
              kind: "ACKNOWLEDGEMENT_UNKNOWN",
              providerDetails: { transport: "local", response: "connection-closed" },
              ambiguityReason: "connection closed after request bytes",
              observedAt: secondsAfter(1),
            };
          },
        },
        () => secondsAfter(1),
      );
      ok(await first.recovery.reserve(SCOPE, command));
      assert.equal(
        ok(await first.recovery.inspect(SCOPE, command.task.taskId)).displayState,
        "PENDING",
      );
      const delivery = await first.recovery.dispatch({
        workerId: "recovery-dispatcher-1",
        now: FIXED_TIME,
        leaseExpiresAt: secondsAfter(30),
      });
      assert.equal(delivery.kind, "ACKNOWLEDGEMENT_UNKNOWN");
      const ambiguous = ok(await first.recovery.inspect(SCOPE, command.task.taskId));
      assert.equal(ambiguous.displayState, "RECONCILING");
      assert.equal(ambiguous.ambiguousAttemptCount, 1);
      assert.equal(ambiguous.deadLetterOutboxCount, 1);
      assert.equal(dispatchCalls, 1);
    } finally {
      await context.database.close();
    }

    context = await createMigratedDatabase(dataDir);
    try {
      const restarted = coordinator(
        context,
        {
          async dispatch() {
            dispatchCalls += 1;
            throw new Error("dead-letter dispatch must not run after restart");
          },
        },
        () => secondsAfter(31),
      );
      const recovered = ok(await restarted.recovery.inspect(SCOPE, command.task.taskId));
      assert.equal(recovered.displayState, "RECONCILING");
      assert.equal(recovered.task.acceptedAttemptId, null);
      assert.equal(
        (
          await restarted.recovery.dispatch({
            workerId: "recovery-dispatcher-2",
            now: secondsAfter(31),
            leaseExpiresAt: secondsAfter(61),
          })
        ).kind,
        "NO_WORK",
      );
      assert.equal(dispatchCalls, 1);

      ok(
        await restarted.recovery.reconcile(SCOPE, {
          idempotencyKey: `${command.idempotencyKey}:reconcile`,
          taskId: command.task.taskId,
          attemptId: command.attempt.attemptId,
          evidence: {
            outcome: "ACKNOWLEDGEMENT_CONFIRMED",
            externalJobId: "local-recovered-job-001",
            evidenceHash: sha256("local-recovered-job-001:evidence"),
          },
          reconciledAt: secondsAfter(32),
        }),
      );
      const running = ok(await restarted.recovery.inspect(SCOPE, command.task.taskId));
      assert.equal(running.displayState, "RUNNING");
      assert.equal(running.ambiguousAttemptCount, 0);

      const claim = {
        taskId: command.task.taskId,
        attemptId: command.attempt.attemptId,
        presentedClaimTokenHash: command.attempt.executionClaimTokenHash,
        expectedTaskVersion: running.task.version,
      };
      const [firstClaim, duplicateClaim] = await Promise.all([
        restarted.recovery.claim(SCOPE, {
          ...claim,
          idempotencyKey: `${command.idempotencyKey}:claim:worker-1`,
          claimedAt: secondsAfter(33),
        }),
        restarted.recovery.claim(SCOPE, {
          ...claim,
          idempotencyKey: `${command.idempotencyKey}:claim:worker-2`,
          claimedAt: secondsAfter(34),
        }),
      ]);
      assert.deepEqual([firstClaim.ok, duplicateClaim.ok].sort(), [false, true]);
      const rejectedClaim = firstClaim.ok ? duplicateClaim : firstClaim;
      assert.equal(rejectedClaim.kind, "CONFLICT");
      assert.equal(rejectedClaim.code, "CLAIM_ALREADY_CONSUMED");

      const completion = {
        successfulResult: {
          idempotencyKey: `${command.idempotencyKey}:success`,
          taskId: command.task.taskId,
          attemptId: command.attempt.attemptId,
          outputAssetId: IDS.outputA1,
          outputBinarySha256: HASHES.outputA1,
          providerDetails: { provider: "none", recovered: true },
          finishedAt: secondsAfter(40),
        },
        costEvents: [
          costEvent(command, 30_004, 2, "REPORTED", 4_200n, secondsAfter(40)),
          costEvent(command, 30_005, 3, "SETTLED", 4_200n, secondsAfter(41)),
          costEvent(command, 30_006, 4, "REFUNDED", 800n, secondsAfter(41)),
        ],
        acceptance: {
          idempotencyKey: `${command.idempotencyKey}:accept`,
          acceptedAt: secondsAfter(42),
        },
      };
      const incompleteCompletion = await restarted.recovery.complete(SCOPE, {
        ...structuredClone(completion),
        costEvents: structuredClone(completion.costEvents.slice(0, 2)),
      });
      assert.equal(incompleteCompletion.ok, false);
      assert.equal(incompleteCompletion.kind, "INVARIANT_VIOLATION");
      assert.equal(incompleteCompletion.code, "INVALID_MONEY");
      const rolledBackCompletion = ok(await restarted.recovery.inspect(SCOPE, command.task.taskId));
      assert.equal(rolledBackCompletion.displayState, "RUNNING");
      assert.equal(rolledBackCompletion.acceptedAttemptCount, 0);
      assert.equal(rolledBackCompletion.cost.eventCount, 1);
      const mismatchedSettlement = structuredClone(completion);
      mismatchedSettlement.costEvents[1].amountMicroUsd = 4_199n;
      mismatchedSettlement.costEvents[2].amountMicroUsd = 801n;
      const mismatchedCompletion = await restarted.recovery.complete(SCOPE, mismatchedSettlement);
      assert.equal(mismatchedCompletion.ok, false);
      assert.equal(mismatchedCompletion.kind, "INVARIANT_VIOLATION");
      assert.equal(mismatchedCompletion.code, "INVALID_MONEY");
      assert.equal(
        ok(await restarted.recovery.inspect(SCOPE, command.task.taskId)).cost.eventCount,
        1,
      );
      const accepted = ok(await restarted.recovery.complete(SCOPE, completion));
      assert.equal(accepted.replayed, false);
      assert.equal(accepted.value.completion, "ACCEPTED");
      const replay = ok(await restarted.recovery.complete(SCOPE, structuredClone(completion)));
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.value, accepted.value);

      const ready = ok(await restarted.recovery.inspect(SCOPE, command.task.taskId));
      assert.equal(ready.displayState, "READY");
      assert.equal(ready.attemptCount, 1);
      assert.equal(ready.claimedAttemptCount, 1);
      assert.equal(ready.acceptedAttemptCount, 1);
      assert.equal(ready.activeAttemptCount, 0);
      assert.equal(ready.dispatchOutboxCount, 1);
      assert.equal(ready.deadLetterOutboxCount, 1);
      assert.deepEqual(ready.cost, {
        reservedMicroUsd: 5_000n,
        reportedMicroUsd: 4_200n,
        settledMicroUsd: 4_200n,
        releasedMicroUsd: 0n,
        refundedMicroUsd: 800n,
        activeReservationMicroUsd: 0n,
        eventCount: 4,
      });
    } finally {
      await context.database.close();
    }

    context = await createMigratedDatabase(dataDir);
    try {
      const repositories = createPGliteControlPlaneRepositories(context.executor);
      const finalRecovery = new DurableRecoveryCoordinator(context.executor, repositories, {
        async deliverNext() {
          throw new Error("terminal recovery inspection must not dispatch");
        },
      });
      const persisted = ok(await finalRecovery.inspect(SCOPE, command.task.taskId));
      assert.equal(persisted.displayState, "READY");
      assert.equal(persisted.acceptedAttemptCount, 1);
      assert.equal(persisted.cost.activeReservationMicroUsd, 0n);
      const rows = await context.executor.query(
        `SELECT
           count(*)::int AS attempts,
           count(*) FILTER (WHERE result_disposition = 'ACCEPTED')::int AS accepted
         FROM attempts WHERE workspace_id = $1 AND task_id = $2`,
        [IDS.workspaceA, command.task.taskId],
      );
      assert.deepEqual(rows.rows[0], { attempts: 1, accepted: 1 });
    } finally {
      await context.database.close();
    }
  });
});

test("cancellation converges before dispatch, after dispatch, during reconciliation, and after terminal state", async () => {
  const context = await createMigratedDatabase();
  try {
    await seedLockedProjects(context.executor);
    const ambiguousTasks = new Set();
    const { recovery, repositories } = coordinator(
      context,
      {
        async dispatch(outbox) {
          if (outbox.kind === "DISPATCH" && ambiguousTasks.has(outbox.taskId)) {
            return {
              kind: "ACKNOWLEDGEMENT_UNKNOWN",
              providerDetails: { provider: "none", response: "lost" },
              ambiguityReason: "connection closed after request bytes",
              observedAt: secondsAfter(10),
            };
          }
          return {
            kind: "ACKNOWLEDGED",
            externalJobId: `local-${outbox.kind.toLowerCase()}-${outbox.taskId}`,
            providerDetails: { provider: "none" },
            acknowledgedAt: secondsAfter(11),
          };
        },
      },
      () => secondsAfter(11),
    );

    const pending = reservation(31_000, 1);
    const pendingReservation = ok(await recovery.reserve(SCOPE, pending));
    const pendingCancellation = {
      cancellation: {
        idempotencyKey: `${pending.idempotencyKey}:cancel-before-dispatch`,
        target: "TASK_ONLY",
        taskId: pending.task.taskId,
        expectedTaskVersion: pendingReservation.value.task.version,
        requestedAt: secondsAfter(1),
      },
      costEvents: [costEvent(pending, 31_004, 2, "RELEASED", 5_000n, secondsAfter(1))],
    };
    const incompletePendingCancellation = await recovery.cancelPending(SCOPE, {
      ...structuredClone(pendingCancellation),
      costEvents: [
        {
          ...structuredClone(pendingCancellation.costEvents[0]),
          amountMicroUsd: 4_999n,
        },
      ],
    });
    assert.equal(incompletePendingCancellation.ok, false);
    assert.equal(incompletePendingCancellation.kind, "INVARIANT_VIOLATION");
    assert.equal(incompletePendingCancellation.code, "INVALID_MONEY");
    const rolledBackPendingCancellation = ok(await recovery.inspect(SCOPE, pending.task.taskId));
    assert.equal(rolledBackPendingCancellation.displayState, "PENDING");
    assert.equal(rolledBackPendingCancellation.activeAttemptCount, 1);
    assert.equal(rolledBackPendingCancellation.deadLetterOutboxCount, 0);
    assert.equal(rolledBackPendingCancellation.cost.eventCount, 1);
    const locallyCancelled = ok(await recovery.cancelPending(SCOPE, pendingCancellation));
    assert.equal(locallyCancelled.value.task.state, "CANCELLED");
    assert.equal(locallyCancelled.value.outbox, null);
    assert.equal(
      ok(await recovery.cancelPending(SCOPE, structuredClone(pendingCancellation))).replayed,
      true,
    );
    const pendingSnapshot = ok(await recovery.inspect(SCOPE, pending.task.taskId));
    assert.equal(pendingSnapshot.displayState, "CANCELLED");
    assert.equal(pendingSnapshot.activeAttemptCount, 0);
    assert.equal(pendingSnapshot.cancellationOutboxCount, 0);
    assert.equal(pendingSnapshot.cost.activeReservationMicroUsd, 0n);

    const acknowledged = reservation(31_100, 3);
    ok(await recovery.reserve(SCOPE, acknowledged));
    assert.equal(
      (
        await recovery.dispatch({
          workerId: "cancel-dispatcher-1",
          now: FIXED_TIME,
          leaseExpiresAt: secondsAfter(30),
        })
      ).kind,
      "DELIVERED",
    );
    const acknowledgedSnapshot = ok(await recovery.inspect(SCOPE, acknowledged.task.taskId));
    assert.equal(acknowledgedSnapshot.displayState, "RUNNING");
    const requestedAfterDispatch = ok(
      await recovery.requestAttemptCancellation(SCOPE, {
        idempotencyKey: `${acknowledged.idempotencyKey}:cancel-after-dispatch`,
        target: "ATTEMPT",
        taskId: acknowledged.task.taskId,
        attemptId: acknowledged.attempt.attemptId,
        expectedTaskVersion: acknowledgedSnapshot.task.version,
        requestedAt: secondsAfter(12),
        outbox: cancellationOutbox(acknowledged, 31_104, secondsAfter(12)),
      }),
    );
    assert.equal(requestedAfterDispatch.value.task.state, "CANCEL_REQUESTED");
    assert.equal(
      (
        await recovery.dispatch({
          workerId: "cancel-dispatcher-2",
          now: secondsAfter(12),
          leaseExpiresAt: secondsAfter(42),
        })
      ).kind,
      "DELIVERED",
    );
    const settledAfterDispatch = ok(
      await recovery.settleCancellation(SCOPE, {
        terminalAttempt: {
          idempotencyKey: `${acknowledged.idempotencyKey}:terminal-cancelled`,
          taskId: acknowledged.task.taskId,
          attemptId: acknowledged.attempt.attemptId,
          state: "CANCELLED",
          problemCode: "USER_CANCELLED",
          providerDetails: { provider: "none", acknowledged: true },
          finishedAt: secondsAfter(13),
        },
        costEvents: [
          costEvent(acknowledged, 31_105, 4, "REPORTED", 1_200n, secondsAfter(13)),
          costEvent(acknowledged, 31_106, 5, "SETTLED", 1_200n, secondsAfter(14)),
          costEvent(acknowledged, 31_107, 6, "RELEASED", 3_800n, secondsAfter(14)),
        ],
        settlement: {
          idempotencyKey: `${acknowledged.idempotencyKey}:settle-cancellation`,
          taskId: acknowledged.task.taskId,
          attemptId: acknowledged.attempt.attemptId,
          expectedTaskVersion: requestedAfterDispatch.value.task.version,
          settledAt: secondsAfter(14),
        },
      }),
    );
    assert.equal(settledAfterDispatch.value.task.state, "CANCELLED");
    const acknowledgedCancelled = ok(await recovery.inspect(SCOPE, acknowledged.task.taskId));
    assert.equal(acknowledgedCancelled.displayState, "CANCELLED");
    assert.equal(acknowledgedCancelled.cancellationOutboxCount, 1);
    assert.equal(acknowledgedCancelled.cost.activeReservationMicroUsd, 0n);

    const reconciling = reservation(31_200, 7);
    ambiguousTasks.add(reconciling.task.taskId);
    ok(await recovery.reserve(SCOPE, reconciling));
    assert.equal(
      (
        await recovery.dispatch({
          workerId: "cancel-dispatcher-3",
          now: secondsAfter(15),
          leaseExpiresAt: secondsAfter(45),
        })
      ).kind,
      "ACKNOWLEDGEMENT_UNKNOWN",
    );
    const reconcilingSnapshot = ok(await recovery.inspect(SCOPE, reconciling.task.taskId));
    assert.equal(reconcilingSnapshot.displayState, "RECONCILING");
    const requestedDuringReconciliation = ok(
      await recovery.requestAttemptCancellation(SCOPE, {
        idempotencyKey: `${reconciling.idempotencyKey}:cancel-during-reconcile`,
        target: "ATTEMPT",
        taskId: reconciling.task.taskId,
        attemptId: reconciling.attempt.attemptId,
        expectedTaskVersion: reconcilingSnapshot.task.version,
        requestedAt: secondsAfter(16),
        outbox: cancellationOutbox(reconciling, 31_204, secondsAfter(16)),
      }),
    );
    ok(
      await recovery.reconcile(SCOPE, {
        idempotencyKey: `${reconciling.idempotencyKey}:reconcile-while-cancelling`,
        taskId: reconciling.task.taskId,
        attemptId: reconciling.attempt.attemptId,
        evidence: {
          outcome: "ACKNOWLEDGEMENT_CONFIRMED",
          externalJobId: "local-reconciled-cancel-job",
          evidenceHash: sha256("local-reconciled-cancel-job:evidence"),
        },
        reconciledAt: secondsAfter(17),
      }),
    );
    assert.equal(
      (
        await recovery.dispatch({
          workerId: "cancel-dispatcher-4",
          now: secondsAfter(17),
          leaseExpiresAt: secondsAfter(47),
        })
      ).kind,
      "DELIVERED",
    );
    ok(
      await recovery.settleCancellation(SCOPE, {
        terminalAttempt: {
          idempotencyKey: `${reconciling.idempotencyKey}:terminal-cancelled`,
          taskId: reconciling.task.taskId,
          attemptId: reconciling.attempt.attemptId,
          state: "CANCELLED",
          problemCode: "USER_CANCELLED_AFTER_RECONCILIATION",
          providerDetails: { provider: "none", reconciled: true },
          finishedAt: secondsAfter(18),
        },
        costEvents: [
          costEvent(reconciling, 31_205, 8, "REPORTED", 800n, secondsAfter(18)),
          costEvent(reconciling, 31_206, 9, "SETTLED", 800n, secondsAfter(19)),
          costEvent(reconciling, 31_207, 10, "RELEASED", 4_200n, secondsAfter(19)),
        ],
        settlement: {
          idempotencyKey: `${reconciling.idempotencyKey}:settle-cancellation`,
          taskId: reconciling.task.taskId,
          attemptId: reconciling.attempt.attemptId,
          expectedTaskVersion: requestedDuringReconciliation.value.task.version,
          settledAt: secondsAfter(19),
        },
      }),
    );
    const reconciledCancellation = ok(await recovery.inspect(SCOPE, reconciling.task.taskId));
    assert.equal(reconciledCancellation.displayState, "CANCELLED");
    assert.equal(reconciledCancellation.ambiguousAttemptCount, 0);
    assert.equal(reconciledCancellation.cost.activeReservationMicroUsd, 0n);

    const terminalRetry = await repositories.execution.requestCancellation(SCOPE, {
      idempotencyKey: `${reconciling.idempotencyKey}:new-cancel-after-terminal`,
      target: "ATTEMPT",
      taskId: reconciling.task.taskId,
      attemptId: reconciling.attempt.attemptId,
      expectedTaskVersion: reconciledCancellation.task.version,
      requestedAt: secondsAfter(20),
      outbox: cancellationOutbox(reconciling, 31_208, secondsAfter(20)),
    });
    assert.equal(terminalRetry.ok, false);
    assert.equal(terminalRetry.kind, "CONFLICT");
    assert.equal(terminalRetry.code, "STATE_CONFLICT");
    assert.equal(
      ok(await recovery.inspect(SCOPE, reconciling.task.taskId)).displayState,
      "CANCELLED",
    );
  } finally {
    await context.database.close();
  }
});

test("task-only cancellation loses safely to an already leased dispatch", async () => {
  const context = await createMigratedDatabase();
  try {
    await seedLockedProjects(context.executor);
    const repositories = createPGliteControlPlaneRepositories(context.executor);
    const workflow = new LocalWorkflowTransport(context.executor, {
      async dispatch() {
        throw new Error("lease-only regression must not dispatch");
      },
    });
    const recovery = new DurableRecoveryCoordinator(context.executor, repositories, workflow);
    const command = reservation(31_300, 1);
    const reserved = ok(await recovery.reserve(SCOPE, command));
    const leased = await workflow.leaseNext({
      workerId: "lease-race-winner",
      now: FIXED_TIME,
      leaseExpiresAt: secondsAfter(30),
    });
    assert.equal(leased?.state, "LEASED");

    const cancellation = await recovery.cancelPending(SCOPE, {
      cancellation: {
        idempotencyKey: `${command.idempotencyKey}:task-only-lost-race`,
        target: "TASK_ONLY",
        taskId: command.task.taskId,
        expectedTaskVersion: reserved.value.task.version,
        requestedAt: secondsAfter(1),
      },
      costEvents: [costEvent(command, 31_304, 2, "RELEASED", 5_000n, secondsAfter(1))],
    });
    assert.equal(cancellation.ok, false);
    assert.equal(cancellation.kind, "CONFLICT");
    assert.equal(cancellation.code, "STATE_CONFLICT");

    const snapshot = ok(await recovery.inspect(SCOPE, command.task.taskId));
    assert.equal(snapshot.displayState, "PENDING");
    assert.equal(snapshot.task.cancelRequestedAt, null);
    assert.equal(snapshot.activeAttemptCount, 1);
    assert.equal(snapshot.cost.eventCount, 1);
    const outbox = await context.executor.query(
      "SELECT state, lease_owner FROM outbox WHERE workspace_id = $1 AND id = $2",
      [IDS.workspaceA, command.dispatchOutbox.outboxId],
    );
    assert.deepEqual(outbox.rows[0], { state: "LEASED", lease_owner: "lease-race-winner" });
  } finally {
    await context.database.close();
  }
});

test("one attempt cost overrun cannot conceal another attempt's open reservation", async () => {
  const context = await createMigratedDatabase();
  try {
    await seedLockedProjects(context.executor);
    const repositories = createPGliteControlPlaneRepositories(context.executor);
    const recovery = new DurableRecoveryCoordinator(context.executor, repositories, {
      async deliverNext() {
        throw new Error("cost isolation regression must not dispatch");
      },
    });
    const first = reservation(31_400, 1);
    const siblingSeed = reservation(31_410, 2);
    const sibling = {
      ...siblingSeed,
      task: structuredClone(first.task),
      attempt: {
        ...siblingSeed.attempt,
        ordinal: 2,
        parentAttemptId: first.attempt.attemptId,
        fallbackReason: "DUPLICATE_RECOVERY",
      },
    };
    ok(await recovery.reserve(SCOPE, first));
    ok(await recovery.reserve(SCOPE, sibling));
    ok(
      await repositories.events.appendCostEvent(
        SCOPE,
        costEvent(first, 31_420, 3, "REPORTED", 10_000n, secondsAfter(1)),
      ),
    );
    ok(
      await repositories.events.appendCostEvent(
        SCOPE,
        costEvent(first, 31_421, 4, "SETTLED", 10_000n, secondsAfter(2)),
      ),
    );

    const beforeCancellation = ok(await recovery.inspect(SCOPE, first.task.taskId));
    assert.equal(beforeCancellation.attemptCount, 2);
    assert.equal(beforeCancellation.cost.reservedMicroUsd, 10_000n);
    assert.equal(beforeCancellation.cost.settledMicroUsd, 10_000n);
    assert.equal(beforeCancellation.cost.activeReservationMicroUsd, 5_000n);

    const cancellation = {
      idempotencyKey: `${first.idempotencyKey}:cancel-two-attempts`,
      target: "TASK_ONLY",
      taskId: first.task.taskId,
      expectedTaskVersion: beforeCancellation.task.version,
      requestedAt: secondsAfter(3),
    };
    const hiddenOpenReservation = await recovery.cancelPending(SCOPE, {
      cancellation,
      costEvents: [],
    });
    assert.equal(hiddenOpenReservation.ok, false);
    assert.equal(hiddenOpenReservation.kind, "INVARIANT_VIOLATION");
    assert.equal(hiddenOpenReservation.code, "INVALID_MONEY");
    assert.equal(ok(await recovery.inspect(SCOPE, first.task.taskId)).displayState, "PENDING");

    const cancelled = ok(
      await recovery.cancelPending(SCOPE, {
        cancellation,
        costEvents: [costEvent(sibling, 31_422, 5, "RELEASED", 5_000n, secondsAfter(3))],
      }),
    );
    assert.equal(cancelled.value.task.state, "CANCELLED");
    const finalSnapshot = ok(await recovery.inspect(SCOPE, first.task.taskId));
    assert.equal(finalSnapshot.attemptCount, 2);
    assert.equal(finalSnapshot.activeAttemptCount, 0);
    assert.equal(finalSnapshot.cost.activeReservationMicroUsd, 0n);
  } finally {
    await context.database.close();
  }
});
