import assert from "node:assert/strict";
import test from "node:test";

import {
  FairAdmissionRepository,
  ServerlessDispatchService,
  SUPERSEDED_RUNTIME_CONTRACT_TABLES,
  VideoRuntimeError,
  VideoRuntimeService,
  trustedTenantActorScope,
  trustedTenantScope,
} from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  FIXED_TIME,
  expectDatabaseError,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";
import {
  RATE_SOURCE,
  SIGNER,
  acceptedUnitsFrom,
  at,
  deploymentFor,
  itemIdsFor,
  laneEndpoint,
  persistCommitReceipts,
  predispatchFor,
  receiptFor,
} from "./support/v2-05-runtime.mjs";

const scopeA = () => trustedTenantScope(IDS.accountA, IDS.workspaceA);
const scopeB = () => trustedTenantScope(IDS.accountB, IDS.workspaceB);
const actorA = () => trustedTenantActorScope(scopeA(), IDS.userA);
const actorB = () => trustedTenantActorScope(scopeB(), IDS.userB);

const MAGE_DEPLOYMENT = deploymentFor("mage_image", 900_001);
const SOULX_DEPLOYMENT = deploymentFor("soulx_avatar", 900_002);

async function seeded(work) {
  return withMigratedDatabase(async (context) => {
    await seedLockedProjects(context.executor);
    const admission = new FairAdmissionRepository(context.executor);
    const dispatch = new ServerlessDispatchService(context.executor, SIGNER);
    const runtime = new VideoRuntimeService(context.executor);
    await dispatch.publishEndpointDeployment(MAGE_DEPLOYMENT);
    await dispatch.publishEndpointDeployment(SOULX_DEPLOYMENT);
    return work({ ...context, admission, dispatch, runtime });
  });
}

async function enqueueVideo(admission, actor, serial, projectId, revisionId) {
  const requestId = uuid(serial);
  await admission.enqueueVideo(actor, {
    requestId,
    projectId,
    projectRevisionId: revisionId,
    idempotencyKey: `v2-05-video-${String(serial)}`,
    now: FIXED_TIME,
    auditId: uuid(serial + 400),
  });
  return requestId;
}

async function promote(admission, serial) {
  return admission.promoteNext({
    leaseId: uuid(serial + 600),
    auditId: uuid(serial + 700),
    ownerTokenSha256: sha256(`v2-05-lease-${String(serial)}`),
    now: at(1),
    expiresAt: at(3600),
  });
}

function laneOf(view, lane) {
  return view.lanes.find((candidate) => candidate.lane === lane);
}

/** Prepares one admitted video: CPU preparation output plus one exact manifest per lane. */
async function prepare(runtime, scope, runtimeId, plans, now = at(2)) {
  await runtime.beginPreparation(scope, { runtimeId, now });
  return runtime.completePreparation(scope, {
    runtimeId,
    preparationManifestSha256: sha256(`preparation-${runtimeId}`),
    lanes: plans,
    now,
  });
}

/**
 * Runs one complete provider-free lane: predispatch, dispatch, observed progress, signed receipt,
 * canonical acceptance, and durable accepted units.
 */
async function runLane(
  context,
  {
    scope,
    lane,
    deployment,
    runtimeId,
    projectId,
    revisionId,
    requestId,
    serial,
    itemIds,
    endpoint,
    faults = [],
  },
) {
  const { dispatch, runtime, executor } = context;
  const planned = predispatchFor({
    serial,
    scope,
    lane,
    projectId,
    revisionId,
    requestId,
    itemIds,
  });
  const commit = await dispatch.commitPredispatch(scope, planned.input);
  for (const fault of faults) endpoint.injectFault(fault);
  const outcome = await dispatch.dispatchOnce(scope, {
    commit,
    endpoint,
    endpointIdSha256: deployment.endpointIdSha256,
    envelope: { schema: "serverless-worker-job-envelope/v3" },
    requestBodySha256: commit.requestBodySha256,
    assignmentId: uuid(serial + 20),
    leaseId: uuid(serial + 21),
    holderSha256: sha256(`holder-${String(serial)}`),
    now: at(3),
  });
  await runtime.bindLaneAttempt(scope, {
    runtimeId,
    lane,
    attemptId: commit.attemptId,
    attemptOrdinal: 1,
    now: at(3),
  });
  assert.equal(outcome.kind, "ASSIGNED");

  await runtime.observeLaneProgress(scope, {
    runtimeId,
    lane,
    observed: "INITIALIZING",
    now: at(4),
  });
  const assignment = await dispatch.currentAssignment(commit.attemptId);
  let signed;
  endpoint.execute(assignment.provider_job_id, () => {
    signed = receiptFor({
      commit,
      lane,
      deployment,
      scope,
      itemIds,
      options: { providerJobId: assignment.provider_job_id },
    });
    return signed;
  });
  await runtime.observeLaneProgress(scope, { runtimeId, lane, observed: "GENERATING", now: at(5) });
  await dispatch.recordPolledStatus(scope, {
    eventId: uuid(serial + 30),
    attemptId: commit.attemptId,
    providerJobId: assignment.provider_job_id,
    providerStatus: "COMPLETED",
    attemptState: "UPLOADING",
    itemsCompleted: itemIds.length,
    observedAt: at(60),
  });
  const commitHashes = await persistCommitReceipts(executor, commit, signed, serial + 100);
  const acceptance = await dispatch.acceptOutput(scope, {
    outputReceiptId: uuid(serial + 40),
    provenanceRowId: uuid(serial + 41),
    attemptId: commit.attemptId,
    receipt: signed,
    artifactCommitReceiptSha256s: commitHashes,
    now: at(120),
  });
  assert.equal(acceptance, "ACCEPTED_CANONICAL");
  await dispatch.recordCost(scope, {
    costEventId: uuid(serial + 50),
    attemptId: commit.attemptId,
    kind: "SETTLED",
    amountUsd: 0,
    rateSource: RATE_SOURCE,
    rateCheckedAt: FIXED_TIME,
    now: at(130),
  });
  const view = await runtime.acceptLaneUnits(scope, {
    runtimeId,
    lane,
    attemptId: commit.attemptId,
    units: acceptedUnitsFrom(signed),
    now: at(140),
  });
  return { commit, signed, view, assignment };
}

// ------------------------------------------------------------------------------------------------
// Admission gate and independent per-video stage state
// ------------------------------------------------------------------------------------------------

test("a queued video runtime is inert: no preparation, lane manifest, or dispatch exists", async () => {
  await seeded(async ({ admission, runtime, executor }) => {
    const requestId = await enqueueVideo(admission, actorA(), 1_001, IDS.projectA, IDS.revisionA);
    const runtimeId = uuid(1_100);
    const view = await runtime.register(scopeA(), {
      runtimeId,
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      generationRequestId: requestId,
      now: FIXED_TIME,
    });

    assert.equal(view.stage, "QUEUED");
    assert.equal(view.providerCallsAuthorized, false);
    assert.equal(view.authorizedSpendUsd, 0);
    assert.deepEqual(
      view.lanes.map((lane) => [lane.lane, lane.state, lane.plannedItemCount]),
      [
        ["mage_image", "BLOCKED_ON_PREPARATION", 0],
        ["soulx_avatar", "BLOCKED_ON_PREPARATION", 0],
      ],
    );

    // CPU preparation before admission fails closed in the database, not only in the service.
    await expectDatabaseError(
      () => runtime.beginPreparation(scopeA(), { runtimeId, now: at(1) }),
      "55000",
    );

    const attempts = await executor.query(
      `SELECT count(*)::text AS count FROM serverless_attempts`,
    );
    assert.equal(attempts.rows[0].count, "0");
    const units = await executor.query(
      `SELECT count(*)::text AS count FROM video_runtime_accepted_units`,
    );
    assert.equal(units.rows[0].count, "0");
  });
});

test("two admitted tenant videos run concurrently while a third account waits", async () => {
  await seeded(async ({ admission, runtime }) => {
    const requestA = await enqueueVideo(admission, actorA(), 2_001, IDS.projectA, IDS.revisionA);
    const requestB = await enqueueVideo(admission, actorB(), 2_002, IDS.projectB, IDS.revisionB);
    assert.notEqual(await promote(admission, 2_001), null);
    assert.notEqual(await promote(admission, 2_002), null);
    // Both global slots are held by different accounts, so no third workload can start.
    assert.equal(await promote(admission, 2_003), null);

    const runtimeA = uuid(2_100);
    const runtimeB = uuid(2_101);
    await runtime.register(scopeA(), {
      runtimeId: runtimeA,
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      generationRequestId: requestA,
      now: FIXED_TIME,
    });
    await runtime.register(scopeB(), {
      runtimeId: runtimeB,
      projectId: IDS.projectB,
      projectRevisionId: IDS.revisionB,
      generationRequestId: requestB,
      now: FIXED_TIME,
    });

    const preparedA = await prepare(runtime, scopeA(), runtimeA, [
      { lane: "mage_image", itemsManifestSha256: sha256("a-mage"), itemIds: ["image-1"] },
      { lane: "soulx_avatar", itemsManifestSha256: sha256("a-soulx"), itemIds: ["span-1"] },
    ]);
    assert.equal(preparedA.stage, "WAITING_FOR_WORKER");

    // Account B's video keeps its own independent stage while account A advances.
    const viewB = await runtime.view(scopeB(), runtimeB);
    assert.equal(viewB.stage, "QUEUED");
    await prepare(runtime, scopeB(), runtimeB, [
      { lane: "mage_image", itemsManifestSha256: sha256("b-mage"), itemIds: ["image-1"] },
      { lane: "soulx_avatar", itemsManifestSha256: sha256("b-soulx"), itemIds: ["span-1"] },
    ]);
    assert.equal((await runtime.view(scopeA(), runtimeA)).stage, "WAITING_FOR_WORKER");
    assert.equal((await runtime.view(scopeB(), runtimeB)).stage, "WAITING_FOR_WORKER");

    // Neither account can observe or address the other account's runtime.
    await assert.rejects(
      () => runtime.view(scopeA(), runtimeB),
      (error) => error instanceof VideoRuntimeError && error.code === "RUNTIME_NOT_FOUND",
    );
    await assert.rejects(
      () => runtime.view(scopeB(), runtimeA),
      (error) => error instanceof VideoRuntimeError && error.code === "RUNTIME_NOT_FOUND",
    );
    assert.deepEqual(
      (await runtime.listOwned(scopeA())).map((view) => view.runtimeId),
      [runtimeA],
    );
  });
});

// ------------------------------------------------------------------------------------------------
// Dispatch preconditions and lane independence
// ------------------------------------------------------------------------------------------------

test("a lane cannot be dispatched before its own manifest and durable authority exist", async () => {
  await seeded(async ({ admission, runtime, dispatch, executor }) => {
    const requestId = await enqueueVideo(admission, actorA(), 3_001, IDS.projectA, IDS.revisionA);
    await promote(admission, 3_001);
    const runtimeId = uuid(3_100);
    await runtime.register(scopeA(), {
      runtimeId,
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      generationRequestId: requestId,
      now: FIXED_TIME,
    });
    await runtime.beginPreparation(scopeA(), { runtimeId, now: at(1) });

    const itemIds = itemIdsFor("mage_image", 2);
    const planned = predispatchFor({
      serial: 3_200,
      scope: scopeA(),
      lane: "mage_image",
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
      requestId,
      itemIds,
    });

    // No lane manifest yet: the service refuses to bind an attempt.
    const commit = await dispatch.commitPredispatch(scopeA(), planned.input);
    await assert.rejects(
      () =>
        runtime.bindLaneAttempt(scopeA(), {
          runtimeId,
          lane: "mage_image",
          attemptId: commit.attemptId,
          attemptOrdinal: 1,
          now: at(4),
        }),
      (error) => error instanceof VideoRuntimeError && error.code === "PREPARATION_REQUIRED",
    );

    await runtime.completePreparation(scopeA(), {
      runtimeId,
      preparationManifestSha256: sha256(`preparation-${runtimeId}`),
      lanes: [
        { lane: "mage_image", itemsManifestSha256: planned.itemsManifestSha256, itemIds },
        { lane: "soulx_avatar", itemsManifestSha256: sha256("soulx-empty"), itemIds: ["span-1"] },
      ],
      now: at(5),
    });

    // A manifest that is not this lane's exact durable manifest fails closed in the database.
    const foreign = predispatchFor({
      serial: 3_300,
      scope: scopeA(),
      lane: "mage_image",
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
      requestId,
      itemIds: ["image-9"],
    });
    await expectDatabaseError(
      () =>
        executor.query(
          `UPDATE video_runtime_lane_states
              SET state = 'WAITING_FOR_WORKER', current_attempt_id = $2, attempt_ordinal = 1,
                  version = version + 1, updated_at = $3
            WHERE runtime_id = $1 AND lane = 'mage_image'`,
          [runtimeId, foreign.attemptId, at(6)],
        ),
      ["23503", "55000"],
    );

    const bound = await runtime.bindLaneAttempt(scopeA(), {
      runtimeId,
      lane: "mage_image",
      attemptId: commit.attemptId,
      attemptOrdinal: 1,
      now: at(7),
    });
    assert.equal(laneOf(bound, "mage_image").state, "WAITING_FOR_WORKER");
    assert.equal(laneOf(bound, "soulx_avatar").state, "MANIFEST_DURABLE");
  });
});

test("each lane owns independent state, and a bounded retry preserves accepted units", async () => {
  await seeded(async (context) => {
    const { admission, runtime } = context;
    const requestId = await enqueueVideo(admission, actorA(), 4_001, IDS.projectA, IDS.revisionA);
    await promote(admission, 4_001);
    const runtimeId = uuid(4_100);
    await runtime.register(scopeA(), {
      runtimeId,
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      generationRequestId: requestId,
      now: FIXED_TIME,
    });
    const mageItems = itemIdsFor("mage_image", 3);
    const avatarItems = itemIdsFor("soulx_avatar", 2);
    await prepare(runtime, scopeA(), runtimeId, [
      {
        lane: "mage_image",
        itemsManifestSha256: sha256(`mage_image-items-${mageItems.join("|")}`),
        itemIds: mageItems,
      },
      {
        lane: "soulx_avatar",
        itemsManifestSha256: sha256(`soulx_avatar-items-${avatarItems.join("|")}`),
        itemIds: avatarItems,
      },
    ]);

    // The avatar lane succeeds while the image lane is still working.
    const soulx = laneEndpoint("soulx_avatar");
    const avatarRun = await runLane(context, {
      scope: scopeA(),
      lane: "soulx_avatar",
      deployment: SOULX_DEPLOYMENT,
      runtimeId,
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
      requestId,
      serial: 4_200,
      itemIds: avatarItems,
      endpoint: soulx,
    });
    assert.equal(laneOf(avatarRun.view, "soulx_avatar").state, "SUCCEEDED");
    assert.equal(laneOf(avatarRun.view, "mage_image").state, "MANIFEST_DURABLE");

    // The image lane accepts two of three units, then fails retryably.
    const mage = laneEndpoint("mage_image");
    const partial = predispatchFor({
      serial: 4_400,
      scope: scopeA(),
      lane: "mage_image",
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
      requestId,
      itemIds: mageItems,
    });
    const commit = await context.dispatch.commitPredispatch(scopeA(), partial.input);
    await context.dispatch.dispatchOnce(scopeA(), {
      commit,
      endpoint: mage,
      endpointIdSha256: MAGE_DEPLOYMENT.endpointIdSha256,
      envelope: { schema: "serverless-worker-job-envelope/v3" },
      requestBodySha256: commit.requestBodySha256,
      assignmentId: uuid(4_420),
      leaseId: uuid(4_421),
      holderSha256: sha256("holder-4400"),
      now: at(3),
    });
    await runtime.bindLaneAttempt(scopeA(), {
      runtimeId,
      lane: "mage_image",
      attemptId: commit.attemptId,
      attemptOrdinal: 1,
      now: at(3),
    });
    const assignment = await context.dispatch.currentAssignment(commit.attemptId);
    let signed;
    mage.execute(assignment.provider_job_id, () => {
      signed = receiptFor({
        commit,
        lane: "mage_image",
        deployment: MAGE_DEPLOYMENT,
        scope: scopeA(),
        itemIds: mageItems.slice(0, 2),
        options: { providerJobId: assignment.provider_job_id },
      });
      return signed;
    });
    await persistCommitReceipts(context.executor, commit, signed, 4_500);
    await runtime.acceptLaneUnits(scopeA(), {
      runtimeId,
      lane: "mage_image",
      attemptId: commit.attemptId,
      units: acceptedUnitsFrom(signed),
      now: at(70),
    });

    // The dead worker's attempt is classified terminal in the dispatch contract first.
    await context.dispatch.cancel(scopeA(), {
      cancellationId: uuid(4_550),
      attemptId: commit.attemptId,
      requestedBy: "SYSTEM_DEADLINE",
      endpoint: mage,
      settledCostUsd: 0,
      now: at(79),
    });
    const failed = await runtime.failLaneAttempt(scopeA(), {
      runtimeId,
      lane: "mage_image",
      classification: "RETRYABLE",
      reason: "WORKER_DEATH",
      now: at(80),
    });
    const laneAfterFailure = laneOf(failed, "mage_image");
    assert.equal(laneAfterFailure.state, "MANIFEST_DURABLE");
    assert.equal(laneAfterFailure.acceptedItemCount, 2);
    assert.equal(laneAfterFailure.currentAttemptId, null);
    // The avatar lane is untouched by the image lane's failure.
    assert.equal(laneOf(failed, "soulx_avatar").state, "SUCCEEDED");
    assert.equal(failed.stage, "WAITING_FOR_WORKER");

    const remaining = await runtime.remainingUnits(scopeA(), runtimeId, "mage_image", mageItems);
    assert.deepEqual(remaining, ["image-3"]);

    // The retry generates only the remaining unit and the lane then succeeds.
    const retry = predispatchFor({
      serial: 4_600,
      scope: scopeA(),
      lane: "mage_image",
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
      requestId,
      itemIds: remaining,
    });
    const retryCommit = await context.dispatch.commitPredispatch(scopeA(), {
      ...retry.input,
      attemptOrdinal: 2,
    });
    await context.dispatch.dispatchOnce(scopeA(), {
      commit: retryCommit,
      endpoint: mage,
      endpointIdSha256: MAGE_DEPLOYMENT.endpointIdSha256,
      envelope: { schema: "serverless-worker-job-envelope/v3" },
      requestBodySha256: retryCommit.requestBodySha256,
      assignmentId: uuid(4_620),
      leaseId: uuid(4_621),
      holderSha256: sha256("holder-4600"),
      now: at(90),
    });
    await runtime.bindLaneAttempt(scopeA(), {
      runtimeId,
      lane: "mage_image",
      attemptId: retryCommit.attemptId,
      attemptOrdinal: 2,
      now: at(90),
    });
    const retryAssignment = await context.dispatch.currentAssignment(retryCommit.attemptId);
    let retrySigned;
    mage.execute(retryAssignment.provider_job_id, () => {
      retrySigned = receiptFor({
        commit: retryCommit,
        lane: "mage_image",
        deployment: MAGE_DEPLOYMENT,
        scope: scopeA(),
        itemIds: remaining,
        options: { providerJobId: retryAssignment.provider_job_id },
      });
      return retrySigned;
    });
    await persistCommitReceipts(context.executor, retryCommit, retrySigned, 4_700);
    const resumed = await runtime.acceptLaneUnits(scopeA(), {
      runtimeId,
      lane: "mage_image",
      attemptId: retryCommit.attemptId,
      units: acceptedUnitsFrom(retrySigned),
      now: at(100),
    });
    assert.equal(laneOf(resumed, "mage_image").state, "SUCCEEDED");
    assert.equal(laneOf(resumed, "mage_image").acceptedItemCount, 3);

    // Replaying an accepted unit is idempotent rather than duplicated.
    const replayed = await runtime.acceptLaneUnits(scopeA(), {
      runtimeId,
      lane: "mage_image",
      attemptId: retryCommit.attemptId,
      units: acceptedUnitsFrom(retrySigned),
      now: at(101),
    });
    assert.equal(laneOf(replayed, "mage_image").acceptedItemCount, 3);
  });
});

// ------------------------------------------------------------------------------------------------
// Asset barrier, complete journey, restart, and cancellation
// ------------------------------------------------------------------------------------------------

test("render waits for every lane, and a complete provider-free journey drains to zero workers", async () => {
  await seeded(async (context) => {
    const { admission, runtime, executor } = context;
    const requestId = await enqueueVideo(admission, actorA(), 5_001, IDS.projectA, IDS.revisionA);
    await promote(admission, 5_001);
    const runtimeId = uuid(5_100);
    await runtime.register(scopeA(), {
      runtimeId,
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      generationRequestId: requestId,
      now: FIXED_TIME,
    });
    const mageItems = itemIdsFor("mage_image", 3);
    const avatarItems = itemIdsFor("soulx_avatar", 2);
    await prepare(runtime, scopeA(), runtimeId, [
      {
        lane: "mage_image",
        itemsManifestSha256: sha256(`mage_image-items-${mageItems.join("|")}`),
        itemIds: mageItems,
      },
      {
        lane: "soulx_avatar",
        itemsManifestSha256: sha256(`soulx_avatar-items-${avatarItems.join("|")}`),
        itemIds: avatarItems,
      },
    ]);

    // The asset barrier is a database rule, not an application convention.
    await expectDatabaseError(
      () =>
        runtime.beginRender(scopeA(), {
          runtimeId,
          renderManifestSha256: sha256("premature-render"),
          now: at(10),
        }),
      "55000",
    );

    const mageEndpoint = laneEndpoint("mage_image");
    const soulxEndpoint = laneEndpoint("soulx_avatar");
    await runLane(context, {
      scope: scopeA(),
      lane: "mage_image",
      deployment: MAGE_DEPLOYMENT,
      runtimeId,
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
      requestId,
      serial: 5_300,
      itemIds: mageItems,
      endpoint: mageEndpoint,
    });
    await runLane(context, {
      scope: scopeA(),
      lane: "soulx_avatar",
      deployment: SOULX_DEPLOYMENT,
      runtimeId,
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
      requestId,
      serial: 5_600,
      itemIds: avatarItems,
      endpoint: soulxEndpoint,
    });
    await runtime.beginRender(scopeA(), {
      runtimeId,
      renderManifestSha256: sha256(`render-${runtimeId}`),
      now: at(200),
    });
    const complete = await runtime.completeRender(scopeA(), {
      runtimeId,
      finalOutputSha256: sha256(`final-${runtimeId}`),
      now: at(260),
    });
    assert.equal(complete.stage, "COMPLETE");
    assert.equal(complete.terminalReason, "SUCCEEDED");
    assert.ok(complete.finalOutputSha256.startsWith("sha256:"));

    // Every fake job is terminal and no worker remains after drain.
    for (const endpoint of [mageEndpoint, soulxEndpoint]) {
      assert.equal(endpoint.acceptedJobCount(), 1);
    }
    const live = await executor.query(
      `SELECT count(*)::text AS count FROM serverless_attempts
        WHERE state NOT IN ('SUCCEEDED', 'PERMANENT_FAILED', 'CANCELLED')`,
    );
    assert.equal(live.rows[0].count, "0");

    // Settled provider-free cost is attributed to this tenant at exactly $0.
    const cost = await executor.query(
      `SELECT coalesce(sum(amount_usd), 0)::text AS total
         FROM serverless_cost_events WHERE account_id = $1 AND kind = 'SETTLED'`,
      [IDS.accountA],
    );
    assert.equal(Number(cost.rows[0].total), 0);
  });
});

test("restart reconstruction and owner cancellation keep durable rows as the only truth", async () => {
  await seeded(async (context) => {
    const { admission, runtime, executor } = context;
    const requestId = await enqueueVideo(admission, actorA(), 6_001, IDS.projectA, IDS.revisionA);
    await promote(admission, 6_001);
    const runtimeId = uuid(6_100);
    await runtime.register(scopeA(), {
      runtimeId,
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      generationRequestId: requestId,
      now: FIXED_TIME,
    });
    const mageItems = itemIdsFor("mage_image", 2);
    await prepare(runtime, scopeA(), runtimeId, [
      {
        lane: "mage_image",
        itemsManifestSha256: sha256(`mage_image-items-${mageItems.join("|")}`),
        itemIds: mageItems,
      },
      { lane: "soulx_avatar", itemsManifestSha256: sha256("cancel-soulx"), itemIds: ["span-1"] },
    ]);
    const mage = laneEndpoint("mage_image");
    const planned = predispatchFor({
      serial: 6_200,
      scope: scopeA(),
      lane: "mage_image",
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
      requestId,
      itemIds: mageItems,
    });
    const commit = await context.dispatch.commitPredispatch(scopeA(), planned.input);
    await context.dispatch.dispatchOnce(scopeA(), {
      commit,
      endpoint: mage,
      endpointIdSha256: MAGE_DEPLOYMENT.endpointIdSha256,
      envelope: { schema: "serverless-worker-job-envelope/v3" },
      requestBodySha256: commit.requestBodySha256,
      assignmentId: uuid(6_220),
      leaseId: uuid(6_221),
      holderSha256: sha256("holder-6200"),
      now: at(3),
    });
    await runtime.bindLaneAttempt(scopeA(), {
      runtimeId,
      lane: "mage_image",
      attemptId: commit.attemptId,
      attemptOrdinal: 1,
      now: at(3),
    });

    // A restarted process reconstructs the exact nonterminal runtime and its lane bindings.
    const reconstructed = await new VideoRuntimeService(executor).reconstructAfterRestart();
    assert.equal(reconstructed.length, 1);
    assert.equal(reconstructed[0].runtimeId, runtimeId);
    assert.equal(
      reconstructed[0].lanes.find((lane) => lane.lane === "mage_image").currentAttemptId,
      commit.attemptId,
    );

    await context.dispatch.cancel(scopeA(), {
      cancellationId: uuid(6_300),
      attemptId: commit.attemptId,
      requestedBy: "OWNER_ACCOUNT",
      endpoint: mage,
      settledCostUsd: 0,
      now: at(150),
    });
    const canceled = await runtime.cancel(scopeA(), {
      runtimeId,
      requestedBy: "OWNER_ACCOUNT",
      now: at(151),
    });
    assert.equal(canceled.stage, "CANCELED");
    assert.equal(canceled.terminalReason, "OWNER_CANCELLED");
    assert.deepEqual(
      canceled.lanes.map((lane) => lane.state),
      ["mage_image", "soulx_avatar"].map(() => "CANCELED"),
    );

    // A canceled runtime is terminal: no late transition can revive it.
    await assert.rejects(
      () =>
        runtime.beginRender(scopeA(), {
          runtimeId,
          renderManifestSha256: sha256("late"),
          now: at(160),
        }),
      (error) => error instanceof VideoRuntimeError && error.code === "RUNTIME_TERMINAL",
    );
    assert.deepEqual(await new VideoRuntimeService(executor).reconstructAfterRestart(), []);
  });
});

// ------------------------------------------------------------------------------------------------
// Superseded contract quarantine
// ------------------------------------------------------------------------------------------------

test("superseded global-session and Pod contracts reject every ordinary production write", async () => {
  await seeded(async ({ executor }) => {
    const registry = await executor.query(
      `SELECT table_name, superseded_by FROM superseded_runtime_contracts ORDER BY table_name`,
    );
    assert.deepEqual(
      registry.rows.map((row) => row.table_name).sort(),
      [...SUPERSEDED_RUNTIME_CONTRACT_TABLES].sort(),
    );

    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO generation_sessions (
             id, singleton_key, state, gpu_pair_hash, selected_by_admission_id, opened_at
           ) VALUES ($1, 'GLOBAL', 'LOCKING', $2, $3, $4)`,
          [uuid(7_001), sha256("pair"), uuid(7_002), FIXED_TIME],
        ),
      "55000",
    );

    // Superseded rows stay readable as compatibility evidence.
    const readable = await executor.query(
      `SELECT count(*)::text AS count FROM generation_sessions`,
    );
    assert.equal(readable.rows[0].count, "0");
  });
});

// ------------------------------------------------------------------------------------------------
// Transport faults and cross-tenant negatives inside the composed runtime
// ------------------------------------------------------------------------------------------------

test("a lost run response and a duplicate execution resolve to one accepted unit set", async () => {
  await seeded(async (context) => {
    const { admission, runtime, dispatch, executor } = context;
    const requestId = await enqueueVideo(admission, actorA(), 8_001, IDS.projectA, IDS.revisionA);
    await promote(admission, 8_001);
    const runtimeId = uuid(8_100);
    await runtime.register(scopeA(), {
      runtimeId,
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      generationRequestId: requestId,
      now: FIXED_TIME,
    });
    const itemIds = itemIdsFor("mage_image", 2);
    await prepare(runtime, scopeA(), runtimeId, [
      {
        lane: "mage_image",
        itemsManifestSha256: sha256(`mage_image-items-${itemIds.join("|")}`),
        itemIds,
      },
      { lane: "soulx_avatar", itemsManifestSha256: sha256("loss-soulx"), itemIds: ["span-1"] },
    ]);

    const mage = laneEndpoint("mage_image");
    const planned = predispatchFor({
      serial: 8_200,
      scope: scopeA(),
      lane: "mage_image",
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
      requestId,
      itemIds,
    });
    const commit = await dispatch.commitPredispatch(scopeA(), planned.input);
    mage.injectFault("RUN_RESPONSE_LOST_AFTER_ACCEPT");
    mage.injectFault("DUPLICATE_EXECUTION");
    const outcome = await dispatch.dispatchOnce(scopeA(), {
      commit,
      endpoint: mage,
      endpointIdSha256: MAGE_DEPLOYMENT.endpointIdSha256,
      envelope: { schema: "serverless-worker-job-envelope/v3" },
      requestBodySha256: commit.requestBodySha256,
      assignmentId: uuid(8_220),
      leaseId: uuid(8_221),
      holderSha256: sha256("holder-8200"),
      now: at(3),
    });
    assert.equal(outcome.kind, "DISPATCH_ACK_UNKNOWN");
    // An unknown acknowledgement never becomes a lane binding: the video keeps waiting.
    assert.equal(
      laneOf(await runtime.view(scopeA(), runtimeId), "mage_image").state,
      "MANIFEST_DURABLE",
    );

    // The provider executed twice and both executions signed durable receipts.
    const acceptedJobId = `mage-0001`;
    let firstSigned;
    mage.execute(acceptedJobId, (executionOrdinal) => {
      const signed = receiptFor({
        commit,
        lane: "mage_image",
        deployment: MAGE_DEPLOYMENT,
        scope: scopeA(),
        itemIds,
        options: { providerJobId: acceptedJobId, nonce: executionOrdinal },
      });
      firstSigned ??= signed;
      return signed;
    });

    const reconciliation = await dispatch.reconcile(scopeA(), {
      reconciliationId: uuid(8_300),
      attemptId: commit.attemptId,
      assignmentId: uuid(8_301),
      outboxId: commit.outboxId,
      trigger: "DISPATCH_ACK_UNKNOWN",
      durableReceipts: mage.provenanceReceiptsForTokenHash(commit.dispatchTokenSha256),
      endpoint: mage,
      possibleDuplicateComputeUsd: 0,
      now: at(200),
    });
    // Recovery proves the unique assignment from the durable signed receipts, and may already
    // observe the provider's terminal state in the same pass.
    assert.ok(["UNIQUE_ASSIGNMENT_PROVED", "TERMINAL_CONFIRMED"].includes(reconciliation));

    await runtime.bindLaneAttempt(scopeA(), {
      runtimeId,
      lane: "mage_image",
      attemptId: commit.attemptId,
      attemptOrdinal: 1,
      now: at(201),
    });
    await persistCommitReceipts(executor, commit, firstSigned, 8_400);
    const view = await runtime.acceptLaneUnits(scopeA(), {
      runtimeId,
      lane: "mage_image",
      attemptId: commit.attemptId,
      units: acceptedUnitsFrom(firstSigned),
      now: at(210),
    });
    assert.equal(laneOf(view, "mage_image").acceptedItemCount, 2);

    // Duplicate compute stays visible; the accepted unit set is still exactly the plan.
    const units = await executor.query(
      `SELECT count(*)::text AS count FROM video_runtime_accepted_units WHERE runtime_id = $1`,
      [runtimeId],
    );
    assert.equal(units.rows[0].count, "2");
    assert.ok(mage.totalBilledSeconds() > 60);
  });
});

test("a foreign account cannot observe, bind, accept, or cancel another account's runtime", async () => {
  await seeded(async ({ admission, runtime }) => {
    const requestId = await enqueueVideo(admission, actorA(), 9_001, IDS.projectA, IDS.revisionA);
    await promote(admission, 9_001);
    const runtimeId = uuid(9_100);
    await runtime.register(scopeA(), {
      runtimeId,
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      generationRequestId: requestId,
      now: FIXED_TIME,
    });
    await prepare(runtime, scopeA(), runtimeId, [
      { lane: "mage_image", itemsManifestSha256: sha256("negative-mage"), itemIds: ["image-1"] },
      { lane: "soulx_avatar", itemsManifestSha256: sha256("negative-soulx"), itemIds: ["span-1"] },
    ]);

    const foreignAttempts = [
      () => runtime.view(scopeB(), runtimeId),
      () => runtime.beginPreparation(scopeB(), { runtimeId, now: at(20) }),
      () =>
        runtime.bindLaneAttempt(scopeB(), {
          runtimeId,
          lane: "mage_image",
          attemptId: uuid(9_200),
          attemptOrdinal: 1,
          now: at(21),
        }),
      () =>
        runtime.acceptLaneUnits(scopeB(), {
          runtimeId,
          lane: "mage_image",
          attemptId: uuid(9_200),
          units: [],
          now: at(22),
        }),
      () => runtime.cancel(scopeB(), { runtimeId, requestedBy: "OWNER_ACCOUNT", now: at(23) }),
    ];
    for (const attempt of foreignAttempts) {
      await assert.rejects(
        attempt,
        (error) => error instanceof VideoRuntimeError && error.code === "RUNTIME_NOT_FOUND",
        "a foreign account must receive a non-revealing not-found result",
      );
    }
    assert.deepEqual(await runtime.listOwned(scopeB()), []);
    assert.equal((await runtime.view(scopeA(), runtimeId)).stage, "WAITING_FOR_WORKER");
  });
});
