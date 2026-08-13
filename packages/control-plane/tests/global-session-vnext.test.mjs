import assert from "node:assert/strict";
import test from "node:test";

import {
  GlobalSessionContractError,
  GlobalSessionRepository,
  exportMetadataSnapshot,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
} from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { createMigratedDatabase, expectDatabaseError, sha256, uuid } from "./support/pglite.mjs";

const NOW = "2026-08-13T10:00:00.000Z";
const LATER = "2026-08-13T10:01:00.000Z";

const ID = Object.freeze({
  admissionA: uuid(90_001),
  admissionB: uuid(90_002),
  projectC: uuid(90_003),
  revisionC: uuid(90_004),
  mageVolume: uuid(90_010),
  mageManifest: uuid(90_011),
  echoVolume: uuid(90_012),
  echoManifest: uuid(90_013),
  mageReceipt: uuid(90_020),
  echoReceipt: uuid(90_021),
  staleMageReceipt: uuid(90_022),
  refreshedMageReceipt: uuid(90_023),
  sessionA: uuid(90_030),
  sessionB: uuid(90_031),
  sessionStale: uuid(90_032),
  queueA: uuid(90_040),
  queueB: uuid(90_041),
  queueC: uuid(90_042),
  queueStale: uuid(90_043),
  runA: uuid(90_050),
  runB: uuid(90_051),
  runC: uuid(90_052),
  runStale: uuid(90_053),
  magePodA: uuid(90_060),
  echoPodA: uuid(90_061),
  magePodB: uuid(90_062),
  echoPodB: uuid(90_063),
  staleMagePod: uuid(90_064),
  staleEchoPod: uuid(90_065),
  revalidation: uuid(90_070),
});

function expectContractCode(code) {
  return (error) => {
    assert.ok(error instanceof GlobalSessionContractError);
    assert.equal(error.code, code);
    return true;
  };
}

async function seedThirdLockedRevision(executor) {
  await executor.query(
    `INSERT INTO projects (id, workspace_id, owner_user_id, name, normalized_name)
     VALUES ($1, $2, $3, 'Owned Project C', 'owned project c')`,
    [ID.projectC, IDS.workspaceA, IDS.userA],
  );
  await executor.query(
    `INSERT INTO project_revisions (
       id, workspace_id, project_id, revision_number, status, title,
       voiceover_asset_id, voiceover_binary_sha256,
       avatar_profile_id, avatar_profile_version_id, avatar_profile_hash,
       avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
       avatar_source_preparation_profile, avatar_source_validation_profile,
       avatar_compatibility_state, avatar_compatibility_assessment_id,
       avatar_compatibility_evidence_hash,
       image_style_id, image_style_version_id, style_profile_hash,
       extra_prompt_keywords, apply_extra_prompt_keywords, generation_mode,
       maximum_cost_micro_usd, seed, revision_config_contract_name,
       revision_config_contract_version, revision_config_payload, revision_config_hash,
       created_by_user_id, locked_at
     ) SELECT
       $1, workspace_id, $2, 1, 'LOCKED', 'Owned Revision C',
       voiceover_asset_id, voiceover_binary_sha256,
       avatar_profile_id, avatar_profile_version_id, avatar_profile_hash,
       avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
       avatar_source_preparation_profile, avatar_source_validation_profile,
       avatar_compatibility_state, avatar_compatibility_assessment_id,
       avatar_compatibility_evidence_hash,
       image_style_id, image_style_version_id, style_profile_hash,
       extra_prompt_keywords, apply_extra_prompt_keywords, generation_mode,
       maximum_cost_micro_usd, 43, revision_config_contract_name,
       revision_config_contract_version, revision_config_payload, $3,
       created_by_user_id, $4
       FROM project_revisions WHERE id = $5`,
    [ID.revisionC, ID.projectC, sha256("revision-c"), NOW, IDS.revisionA],
  );
}

function startCommand({
  variant,
  sessionId,
  queueEntryId,
  runId,
  projectRevisionId,
  admissionId,
  mageReceiptId = ID.mageReceipt,
  magePodId,
  echoPodId,
}) {
  return {
    proposedSessionId: sessionId,
    queueEntryId,
    computeRunPlanId: runId,
    computeRunPlanSha256: sha256(`run-${variant}`),
    projectRevisionId,
    admissionId,
    idempotencyKey: `global-session:${variant}`,
    gpuPairHash: sha256(`pair-${variant}`),
    now: NOW,
    hardCeilingMicroUsd: 2_000_000n,
    reserveMicroUsd: 100_000n,
    reserveCostEventId: uuid(91_000 + variant * 10),
    reserveCostIdempotencyKey: `global-session:${variant}:cost`,
    openedEventId: uuid(91_001 + variant * 10),
    openedEventPayloadSha256: sha256(`opened-${variant}`),
    addedEventId: uuid(91_002 + variant * 10),
    addedEventPayloadSha256: sha256(`added-${variant}`),
    lanes: [
      {
        lane: "mage_image",
        inventoryReceiptId: mageReceiptId,
        modelVolumeId: ID.mageVolume,
        manifestId: ID.mageManifest,
        offeringId: "offering-mage-fixture",
        selectedGpuSku: "NVIDIA GeForce RTX 4090",
        rateCeilingMicroUsdPerHour: 350_000n,
        podAttemptId: magePodId,
        createAttemptKey: `create:mage:${variant}`,
        expectedPodTag: `vf-session-${variant}-mage`,
      },
      {
        lane: "echo_avatar",
        inventoryReceiptId: ID.echoReceipt,
        modelVolumeId: ID.echoVolume,
        manifestId: ID.echoManifest,
        offeringId: "offering-echo-fixture",
        selectedGpuSku: "NVIDIA L40S",
        rateCeilingMicroUsdPerHour: 550_000n,
        podAttemptId: echoPodId,
        createAttemptKey: `create:echo:${variant}`,
        expectedPodTag: `vf-session-${variant}-echo`,
      },
    ],
  };
}

async function seedGlobalFoundation(executor, repository) {
  await seedLockedProjects(executor);
  await seedThirdLockedRevision(executor);
  await repository.registerAdmission({
    admissionId: ID.admissionA,
    userId: IDS.userA,
    normalizedEmail: "owner-a@example.test",
    emailVerifiedAt: NOW,
    inviteRedemptionId: uuid(92_001),
    authMethods: ["EMAIL_PASSWORD"],
    admittedAt: NOW,
  });
  await repository.registerAdmission({
    admissionId: ID.admissionB,
    userId: IDS.userB,
    normalizedEmail: "owner-b@example.test",
    emailVerifiedAt: NOW,
    inviteRedemptionId: uuid(92_002),
    authMethods: ["GOOGLE"],
    admittedAt: NOW,
  });
  await repository.registerLaneVolume({
    lane: "mage_image",
    modelVolumeId: ID.mageVolume,
    providerVolumeId: "provider-volume-mage-fixture",
    modelRevision: "d8c99241f6fa80fbd453014234af2bf337ea21e6",
    manifestId: ID.mageManifest,
    manifestSha256: sha256("mage-manifest"),
    fileCount: 12,
    totalBytes: 12_000n,
    verifiedAt: NOW,
  });
  await repository.registerLaneVolume({
    lane: "echo_avatar",
    modelVolumeId: ID.echoVolume,
    providerVolumeId: "provider-volume-echo-fixture",
    modelRevision: "echomimic-v3-flash-fp8-fixture-revision",
    manifestId: ID.echoManifest,
    manifestSha256: sha256("echo-manifest"),
    fileCount: 9,
    totalBytes: 9_000n,
    verifiedAt: NOW,
  });
  await repository.recordInventoryReceipt({
    receiptId: ID.mageReceipt,
    lane: "mage_image",
    offeringId: "offering-mage-fixture",
    gpuSku: "NVIDIA GeForce RTX 4090",
    availableCount: 2,
    observedRateMicroUsdPerHour: 340_000n,
    normalizedPayloadSha256: sha256("mage-inventory"),
    observedAt: "2026-08-13T09:59:00.000Z",
    expiresAt: "2026-08-13T10:05:00.000Z",
  });
  await repository.recordInventoryReceipt({
    receiptId: ID.echoReceipt,
    lane: "echo_avatar",
    offeringId: "offering-echo-fixture",
    gpuSku: "NVIDIA L40S",
    availableCount: 1,
    observedRateMicroUsdPerHour: 520_000n,
    normalizedPayloadSha256: sha256("echo-inventory"),
    observedAt: "2026-08-13T09:59:00.000Z",
    expiresAt: "2026-08-13T10:05:00.000Z",
  });
  await repository.recordInventoryReceipt({
    receiptId: ID.staleMageReceipt,
    lane: "mage_image",
    offeringId: "offering-mage-fixture",
    gpuSku: "NVIDIA GeForce RTX 4090",
    availableCount: 2,
    observedRateMicroUsdPerHour: 340_000n,
    normalizedPayloadSha256: sha256("stale-mage-inventory"),
    observedAt: "2026-08-13T09:50:00.000Z",
    expiresAt: "2026-08-13T09:55:00.000Z",
  });
}

test("one synthetic global session fails closed, drains both Pods, retains volumes, and restores", async () => {
  const source = await createMigratedDatabase();
  let destination;
  try {
    const repository = new GlobalSessionRepository(source.executor);
    await seedGlobalFoundation(source.executor, repository);

    const wrongOffering = startCommand({
      variant: 7,
      sessionId: uuid(90_034),
      queueEntryId: uuid(90_044),
      runId: uuid(90_054),
      projectRevisionId: IDS.revisionA,
      admissionId: ID.admissionA,
      magePodId: uuid(90_068),
      echoPodId: uuid(90_069),
    });
    wrongOffering.lanes[0].offeringId = "unobserved-offering";
    await assert.rejects(
      repository.startOrEnqueue(wrongOffering),
      expectContractCode("GPU_OFFERING_UNAVAILABLE"),
    );

    const overCeiling = startCommand({
      variant: 8,
      sessionId: uuid(90_035),
      queueEntryId: uuid(90_045),
      runId: uuid(90_055),
      projectRevisionId: IDS.revisionA,
      admissionId: ID.admissionA,
      magePodId: uuid(90_071),
      echoPodId: uuid(90_072),
    });
    overCeiling.lanes[0].rateCeilingMicroUsdPerHour = 330_000n;
    await assert.rejects(
      repository.startOrEnqueue(overCeiling),
      expectContractCode("GPU_PRICE_CHANGED"),
    );

    await assert.rejects(
      repository.startOrEnqueue(
        startCommand({
          variant: 9,
          sessionId: ID.sessionStale,
          queueEntryId: ID.queueStale,
          runId: ID.runStale,
          projectRevisionId: IDS.revisionA,
          admissionId: ID.admissionA,
          mageReceiptId: ID.staleMageReceipt,
          magePodId: ID.staleMagePod,
          echoPodId: ID.staleEchoPod,
        }),
      ),
      expectContractCode("GPU_INVENTORY_STALE"),
    );
    assert.equal(
      Number(
        (await source.executor.query("SELECT count(*)::text AS count FROM generation_sessions"))
          .rows[0].count,
      ),
      0,
    );

    const starts = await Promise.all([
      repository.startOrEnqueue(
        startCommand({
          variant: 1,
          sessionId: ID.sessionA,
          queueEntryId: ID.queueA,
          runId: ID.runA,
          projectRevisionId: IDS.revisionA,
          admissionId: ID.admissionA,
          magePodId: ID.magePodA,
          echoPodId: ID.echoPodA,
        }),
      ),
      repository.startOrEnqueue(
        startCommand({
          variant: 2,
          sessionId: ID.sessionB,
          queueEntryId: ID.queueB,
          runId: ID.runB,
          projectRevisionId: IDS.revisionB,
          admissionId: ID.admissionB,
          magePodId: ID.magePodB,
          echoPodId: ID.echoPodB,
        }),
      ),
    ]);
    assert.deepEqual(starts.map(({ outcome }) => outcome).sort(), ["STARTED", "WAITING"]);
    const winner = starts.find(({ outcome }) => outcome === "STARTED");
    const loser = starts.find(({ outcome }) => outcome === "WAITING");
    assert.ok(winner && loser);

    const activeCommand =
      winner.queueEntryId === ID.queueA
        ? { magePodId: ID.magePodA, echoPodId: ID.echoPodA, variant: 1 }
        : { magePodId: ID.magePodB, echoPodId: ID.echoPodB, variant: 2 };
    const activeQueueEntryId = winner.queueEntryId;
    const waitingQueueEntryId = loser.queueEntryId;
    const sessionId = winner.generationSessionId;

    const persisted = await source.executor.query(
      `SELECT
         (SELECT count(*)::int FROM generation_sessions WHERE state = 'ACTIVE') AS sessions,
         (SELECT count(*)::int FROM global_queue_entries WHERE state = 'ACTIVE') AS active,
         (SELECT count(*)::int FROM global_queue_entries WHERE state = 'WAITING') AS waiting,
         (SELECT count(*)::int FROM compute_run_plans) AS run_plans,
         (SELECT count(*)::int FROM pod_lifecycle_attempts) AS pod_attempts,
         (SELECT queue_version FROM generation_sessions WHERE id = $1) AS queue_version`,
      [sessionId],
    );
    assert.deepEqual(persisted.rows, [
      { sessions: 1, active: 1, waiting: 1, run_plans: 1, pod_attempts: 2, queue_version: 2 },
    ]);
    await expectDatabaseError(() =>
      source.executor.query(`UPDATE generation_sessions SET gpu_pair_hash = $2 WHERE id = $1`, [
        sessionId,
        sha256("mutated-pair"),
      ]),
    );

    await repository.startOrEnqueue(
      startCommand({
        variant: 3,
        sessionId: uuid(90_033),
        queueEntryId: ID.queueC,
        runId: ID.runC,
        projectRevisionId: ID.revisionC,
        admissionId: ID.admissionA,
        magePodId: uuid(90_066),
        echoPodId: uuid(90_067),
      }),
    );
    await assert.rejects(
      repository.moveWaiting({
        generationSessionId: sessionId,
        queueEntryId: activeQueueEntryId,
        targetWaitingIndex: 0,
        expectedQueueVersion: 3,
        actorAdmissionId: ID.admissionB,
        eventId: uuid(90_100),
        eventPayloadSha256: sha256("active-move"),
        now: LATER,
      }),
      expectContractCode("QUEUE_ENTRY_ACTIVE"),
    );
    const movedVersion = await repository.moveWaiting({
      generationSessionId: sessionId,
      queueEntryId: ID.queueC,
      targetWaitingIndex: 0,
      expectedQueueVersion: 3,
      actorAdmissionId: ID.admissionB,
      eventId: uuid(90_101),
      eventPayloadSha256: sha256("waiting-move"),
      now: LATER,
    });
    assert.equal(movedVersion, 4);
    await assert.rejects(
      repository.removeWaiting({
        generationSessionId: sessionId,
        queueEntryId: activeQueueEntryId,
        expectedQueueVersion: 4,
        actorAdmissionId: ID.admissionA,
        eventId: uuid(90_102),
        eventPayloadSha256: sha256("active-remove"),
        now: LATER,
      }),
      expectContractCode("QUEUE_ENTRY_ACTIVE"),
    );
    const removedVersion = await repository.removeWaiting({
      generationSessionId: sessionId,
      queueEntryId: waitingQueueEntryId,
      expectedQueueVersion: 4,
      actorAdmissionId: ID.admissionA,
      eventId: uuid(90_103),
      eventPayloadSha256: sha256("waiting-remove"),
      now: LATER,
    });
    assert.equal(removedVersion, 5);
    assert.deepEqual(
      (
        await source.executor.query(
          `SELECT id, position, state FROM global_queue_entries
            WHERE generation_session_id = $1 ORDER BY position, id`,
          [sessionId],
        )
      ).rows,
      [
        { id: activeQueueEntryId, position: 0, state: "ACTIVE" },
        { id: ID.queueC, position: 1, state: "WAITING" },
        {
          id: waitingQueueEntryId,
          position: 2,
          state: "REMOVED",
        },
      ],
    );
    assert.equal(
      Number(
        (
          await source.executor.query(
            `SELECT count(*)::text AS count
               FROM compute_run_plans plan
               JOIN global_queue_entries entry ON entry.id = plan.queue_entry_id
              WHERE entry.state = 'WAITING'`,
          )
        ).rows[0].count,
      ),
      0,
    );

    const mageObservation = {
      providerPodId: "pod-mage-active",
      podTag: `vf-session-${activeCommand.variant}-mage`,
      gpuSku: "NVIDIA GeForce RTX 4090",
      modelVolumeId: ID.mageVolume,
      manifestId: ID.mageManifest,
    };
    const echoObservation = {
      providerPodId: "pod-echo-active",
      podTag: `vf-session-${activeCommand.variant}-echo`,
      gpuSku: "NVIDIA L40S",
      modelVolumeId: ID.echoVolume,
      manifestId: ID.echoManifest,
    };
    assert.equal(
      await repository.observeCreate({
        podAttemptId: activeCommand.echoPodId,
        observed: [echoObservation, { ...echoObservation, providerPodId: "pod-echo-duplicate" }],
        now: LATER,
      }),
      "AMBIGUOUS",
    );
    await expectDatabaseError(() =>
      source.executor.query(
        `INSERT INTO pod_lifecycle_attempts (
           id, generation_session_id, lane, origin_queue_entry_id, create_attempt_key,
           expected_pod_tag, create_state, model_volume_id, manifest_id, selected_gpu_sku,
           delete_state, created_at, updated_at
         ) VALUES ($1, $2, 'echo_avatar', $3, 'duplicate-create', 'duplicate-tag',
                   'REQUESTED', $4, $5, 'NVIDIA L40S', 'NOT_REQUESTED', $6, $6)`,
        [uuid(90_120), sessionId, activeQueueEntryId, ID.echoVolume, ID.echoManifest, LATER],
      ),
    );
    assert.equal(
      await repository.observeCreate({
        podAttemptId: activeCommand.echoPodId,
        observed: [echoObservation],
        now: LATER,
      }),
      "ACKNOWLEDGED",
    );
    assert.equal(
      await repository.observeCreate({
        podAttemptId: activeCommand.magePodId,
        observed: [mageObservation],
        now: LATER,
      }),
      "ACKNOWLEDGED",
    );
    await expectDatabaseError(() =>
      repository.recordModelReady({
        podAttemptId: activeCommand.magePodId,
        actualGpuSku: "NVIDIA GeForce RTX 4090",
        containerReadyAt: LATER,
        volumeVerifiedAt: null,
        warmupPassedAt: LATER,
        modelReadyAt: LATER,
      }),
    );
    await expectDatabaseError(() =>
      repository.recordModelReady({
        podAttemptId: activeCommand.echoPodId,
        actualGpuSku: "NVIDIA RTX 6000 Ada",
        containerReadyAt: LATER,
        volumeVerifiedAt: LATER,
        warmupPassedAt: LATER,
        modelReadyAt: LATER,
      }),
    );
    await expectDatabaseError(() =>
      source.executor.query(
        `UPDATE pod_lifecycle_attempts SET model_volume_id = $2, manifest_id = $3 WHERE id = $1`,
        [activeCommand.magePodId, ID.echoVolume, ID.echoManifest],
      ),
    );
    await repository.recordModelReady({
      podAttemptId: activeCommand.magePodId,
      actualGpuSku: "NVIDIA GeForce RTX 4090",
      containerReadyAt: LATER,
      volumeVerifiedAt: LATER,
      warmupPassedAt: LATER,
      modelReadyAt: LATER,
    });
    await repository.recordModelReady({
      podAttemptId: activeCommand.echoPodId,
      actualGpuSku: "NVIDIA L40S",
      containerReadyAt: LATER,
      volumeVerifiedAt: LATER,
      warmupPassedAt: LATER,
      modelReadyAt: LATER,
    });
    await repository.recordDurableOutput({
      outputId: uuid(90_130),
      generationSessionId: sessionId,
      queueEntryId: activeQueueEntryId,
      lane: "mage_image",
      podAttemptId: activeCommand.magePodId,
      artifactId: "artifact-mage-durable",
      artifactSha256: sha256("artifact-mage-durable"),
      byteSize: 1024n,
      verifiedAt: LATER,
    });
    assert.equal(
      await repository.settleLaneDemand({
        generationSessionId: sessionId,
        lane: "mage_image",
        podAttemptId: activeCommand.magePodId,
        now: LATER,
      }),
      "WAITING_WARM",
    );
    assert.equal(
      await repository.settleLaneDemand({
        generationSessionId: sessionId,
        lane: "echo_avatar",
        podAttemptId: activeCommand.echoPodId,
        now: LATER,
      }),
      "WAITING_WARM",
    );

    await repository.requestPodDelete({
      generationSessionId: sessionId,
      lane: "mage_image",
      podAttemptId: activeCommand.magePodId,
      requestedAt: "2026-08-13T10:02:00.000Z",
    });
    await repository.recordDeleteAmbiguous({
      podAttemptId: activeCommand.magePodId,
      observedAt: "2026-08-13T10:02:10.000Z",
    });
    await assert.rejects(
      repository.recordPodAbsence({
        podAttemptId: activeCommand.magePodId,
        absenceReceiptSha256: sha256("false-absence"),
        verifiedAt: "2026-08-13T10:02:20.000Z",
      }),
      expectContractCode("POD_DELETE_UNVERIFIED"),
    );
    await repository.recordDeleteAcknowledged({
      podAttemptId: activeCommand.magePodId,
      acknowledgedAt: "2026-08-13T10:02:30.000Z",
    });
    await repository.recordPodAbsence({
      podAttemptId: activeCommand.magePodId,
      absenceReceiptSha256: sha256("mage-old-absence"),
      verifiedAt: "2026-08-13T10:02:40.000Z",
    });
    await expectDatabaseError(() =>
      source.executor.query(
        `INSERT INTO pod_lifecycle_attempts (
           id, generation_session_id, lane, origin_queue_entry_id, create_attempt_key,
           expected_pod_tag, create_state, model_volume_id, manifest_id, selected_gpu_sku,
           delete_state, created_at, updated_at
         ) VALUES ($1, $2, 'mage_image', $3, 'waiter-create', 'waiter-create-tag',
                   'REQUESTED', $4, $5, 'NVIDIA GeForce RTX 4090', 'NOT_REQUESTED', $6, $6)`,
        [uuid(90_140), sessionId, ID.queueC, ID.mageVolume, ID.mageManifest, LATER],
      ),
    );

    await repository.markActiveTerminal({
      generationSessionId: sessionId,
      queueEntryId: activeQueueEntryId,
      now: "2026-08-13T10:03:00.000Z",
    });
    await assert.rejects(
      repository.activateNext({
        generationSessionId: sessionId,
        queueEntryId: ID.queueC,
        computeRunPlanId: ID.runC,
        computeRunPlanSha256: sha256("run-c-promoted"),
        now: "2026-08-13T10:03:10.000Z",
        missingLaneAttempts: [],
      }),
      expectContractCode("GPU_INVENTORY_STALE"),
    );
    await repository.recordInventoryReceipt({
      receiptId: ID.refreshedMageReceipt,
      lane: "mage_image",
      offeringId: "offering-mage-fixture",
      gpuSku: "NVIDIA GeForce RTX 4090",
      availableCount: 1,
      observedRateMicroUsdPerHour: 345_000n,
      normalizedPayloadSha256: sha256("mage-inventory-refreshed"),
      observedAt: "2026-08-13T10:03:00.000Z",
      expiresAt: "2026-08-13T10:08:00.000Z",
    });
    await repository.recordRevalidation({
      revalidationId: ID.revalidation,
      generationSessionId: sessionId,
      lane: "mage_image",
      inventoryReceiptId: ID.refreshedMageReceipt,
      revalidatedAt: "2026-08-13T10:03:20.000Z",
    });
    const magePodNext = uuid(90_141);
    await repository.activateNext({
      generationSessionId: sessionId,
      queueEntryId: ID.queueC,
      computeRunPlanId: ID.runC,
      computeRunPlanSha256: sha256("run-c-promoted"),
      now: "2026-08-13T10:03:30.000Z",
      missingLaneAttempts: [
        {
          lane: "mage_image",
          revalidationId: ID.revalidation,
          podAttemptId: magePodNext,
          createAttemptKey: "create:mage:next",
          expectedPodTag: "vf-session-next-mage",
        },
      ],
    });
    assert.equal(
      Number(
        (
          await source.executor.query(
            `SELECT count(*)::text AS count FROM pod_lifecycle_attempts
              WHERE generation_session_id = $1 AND lane = 'echo_avatar'`,
            [sessionId],
          )
        ).rows[0].count,
      ),
      1,
    );
    assert.equal(
      await repository.observeCreate({
        podAttemptId: magePodNext,
        observed: [
          {
            providerPodId: "pod-mage-next",
            podTag: "vf-session-next-mage",
            gpuSku: "NVIDIA GeForce RTX 4090",
            modelVolumeId: ID.mageVolume,
            manifestId: ID.mageManifest,
          },
        ],
        now: "2026-08-13T10:03:40.000Z",
      }),
      "ACKNOWLEDGED",
    );
    await repository.recordModelReady({
      podAttemptId: magePodNext,
      actualGpuSku: "NVIDIA GeForce RTX 4090",
      containerReadyAt: "2026-08-13T10:03:50.000Z",
      volumeVerifiedAt: "2026-08-13T10:03:50.000Z",
      warmupPassedAt: "2026-08-13T10:03:50.000Z",
      modelReadyAt: "2026-08-13T10:03:50.000Z",
    });

    assert.equal(
      await repository.settleLaneDemand({
        generationSessionId: sessionId,
        lane: "mage_image",
        podAttemptId: magePodNext,
        now: "2026-08-13T10:04:00.000Z",
      }),
      "DELETE_REQUESTED",
    );
    assert.equal(
      await repository.settleLaneDemand({
        generationSessionId: sessionId,
        lane: "echo_avatar",
        podAttemptId: activeCommand.echoPodId,
        now: "2026-08-13T10:04:00.000Z",
      }),
      "DELETE_REQUESTED",
    );
    await repository.markActiveTerminal({
      generationSessionId: sessionId,
      queueEntryId: ID.queueC,
      now: "2026-08-13T10:04:10.000Z",
    });
    await assert.rejects(
      repository.closeDrainedSession({
        generationSessionId: sessionId,
        closingAt: "2026-08-13T10:04:20.000Z",
        closedAt: "2026-08-13T10:04:21.000Z",
      }),
      expectContractCode("SESSION_NOT_DRAINED"),
    );
    await repository.recordDeleteAcknowledged({
      podAttemptId: magePodNext,
      acknowledgedAt: "2026-08-13T10:04:30.000Z",
    });
    await repository.recordPodAbsence({
      podAttemptId: magePodNext,
      absenceReceiptSha256: sha256("mage-next-absence"),
      verifiedAt: "2026-08-13T10:04:40.000Z",
    });
    await repository.recordDeleteAcknowledged({
      podAttemptId: activeCommand.echoPodId,
      acknowledgedAt: "2026-08-13T10:04:30.000Z",
    });
    await assert.rejects(
      repository.closeDrainedSession({
        generationSessionId: sessionId,
        closingAt: "2026-08-13T10:04:45.000Z",
        closedAt: "2026-08-13T10:04:46.000Z",
      }),
      expectContractCode("SESSION_NOT_DRAINED"),
    );
    await repository.recordPodAbsence({
      podAttemptId: activeCommand.echoPodId,
      absenceReceiptSha256: sha256("echo-absence"),
      verifiedAt: "2026-08-13T10:04:50.000Z",
    });
    await expectDatabaseError(() =>
      source.executor.query(
        `UPDATE generation_sessions
            SET state = 'CLOSED', closing_at = $2, closed_at = $3
          WHERE id = $1 AND state = 'ACTIVE'`,
        [sessionId, "2026-08-13T10:04:55.000Z", "2026-08-13T10:04:56.000Z"],
      ),
    );
    await repository.closeDrainedSession({
      generationSessionId: sessionId,
      closingAt: "2026-08-13T10:05:00.000Z",
      closedAt: "2026-08-13T10:05:01.000Z",
    });
    assert.deepEqual(
      (
        await source.executor.query(
          `SELECT state,
                  (SELECT count(*)::int FROM model_volumes WHERE retention_state = 'RETAINED') AS retained,
                  (SELECT count(DISTINCT lane)::int FROM pod_lifecycle_attempts
                    WHERE generation_session_id = $1 AND delete_state = 'ABSENCE_VERIFIED') AS absent
             FROM generation_sessions WHERE id = $1`,
          [sessionId],
        )
      ).rows,
      [{ state: "CLOSED", retained: 2, absent: 2 }],
    );
    await expectDatabaseError(() =>
      source.executor.query("DELETE FROM model_volumes WHERE id = $1", [ID.mageVolume]),
    );

    const serialized = serializeMetadataSnapshot(await exportMetadataSnapshot(source.executor));
    destination = await createMigratedDatabase();
    const restored = await restoreMetadataSnapshot(destination.executor, serialized);
    assert.ok(restored.restoredRows > 0);
    assert.deepEqual(
      (
        await destination.executor.query(
          `SELECT state,
                  (SELECT count(*)::int FROM model_volumes WHERE retention_state = 'RETAINED') AS retained,
                  (SELECT count(DISTINCT lane)::int FROM pod_lifecycle_attempts
                    WHERE generation_session_id = $1 AND delete_state = 'ABSENCE_VERIFIED') AS absent
             FROM generation_sessions WHERE id = $1`,
          [sessionId],
        )
      ).rows,
      [{ state: "CLOSED", retained: 2, absent: 2 }],
    );
  } finally {
    await destination?.database.close();
    await source.database.close();
  }
});
