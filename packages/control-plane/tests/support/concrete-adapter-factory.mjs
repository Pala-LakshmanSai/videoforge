import { createPGliteControlPlaneRepositories } from "../../dist/src/adapters/pglite-repositories.js";
import { IDS, HASHES, seedLockedProjects } from "./fixtures.mjs";
import { createMigratedDatabase, FIXED_TIME, sha256, uuid } from "./pglite.mjs";

const PRIMARY_SCOPE = Object.freeze({ workspaceId: IDS.workspaceA, actorUserId: IDS.userA });
const SECONDARY_SCOPE = Object.freeze({ workspaceId: IDS.workspaceB, actorUserId: IDS.userB });
const OWNER_REVISION_A = Object.freeze({
  ownerType: "PROJECT_REVISION",
  ownerId: IDS.revisionA,
  projectRevisionId: IDS.revisionA,
});

const X = Object.freeze({
  canonicalAsset: uuid(10_001),
  avatarProfile: uuid(10_010),
  avatarVersion: uuid(10_011),
  avatarAnalysisAssessment: uuid(10_012),
  avatarTestAttempt: uuid(10_013),
  style: uuid(10_020),
  styleVersion: uuid(10_021),
  styleAnalysisAttempt: uuid(10_022),
  revisionDraft: uuid(10_030),
  generalTask: uuid(10_100),
  generalAttempt: uuid(10_101),
  generalCost: uuid(10_102),
  generalOutbox: uuid(10_103),
  styleTask: uuid(10_110),
  styleAttempt: uuid(10_111),
  styleCost: uuid(10_112),
  styleOutbox: uuid(10_113),
  avatarTask: uuid(10_120),
  avatarAttempt: uuid(10_121),
  avatarCost: uuid(10_122),
  avatarOutbox: uuid(10_123),
  ambiguityTask: uuid(10_200),
  ambiguityAttempt: uuid(10_201),
  ambiguityUnknownTask: uuid(10_202),
  ambiguityUnknownAttempt: uuid(10_203),
  taskOnlyCancel: uuid(10_210),
  attemptCancelTask: uuid(10_220),
  attemptCancelAttempt: uuid(10_221),
  cancelOutbox: uuid(10_222),
  acceptedTask: uuid(10_300),
  acceptedAttempt1: uuid(10_301),
  acceptedAttempt2: uuid(10_302),
  workflowTask: uuid(10_400),
  workflowAttempt: uuid(10_401),
  workflow: uuid(10_402),
  workflowEvent: uuid(10_403),
  workflowChanged: uuid(10_404),
  workflowNonMonotonic: uuid(10_405),
  costEvent: uuid(10_406),
  costNonMonotonic: uuid(10_407),
  rollbackTypedTask: uuid(10_500),
  rollbackTypedAttempt: uuid(10_501),
  rollbackTypedCost: uuid(10_502),
  rollbackTypedOutbox: uuid(10_503),
  rollbackThrownTask: uuid(10_510),
  rollbackThrownAttempt: uuid(10_511),
  rollbackThrownCost: uuid(10_512),
  rollbackThrownOutbox: uuid(10_513),
  archiveHistoricalTask: uuid(10_600),
  archiveNewRevision: uuid(10_601),
});

const PROFILE_DOCUMENT = Object.freeze({
  contractName: "avatar-profile-version",
  contractVersion: "v1",
  payload: Object.freeze({ source: "concrete-contract" }),
  canonicalDocumentSha256: sha256("concrete-avatar-profile"),
});

const STYLE_DOCUMENT = Object.freeze({
  contractName: "image-style-profile",
  contractVersion: "v1",
  payload: Object.freeze({ source: "concrete-contract" }),
  canonicalDocumentSha256: sha256("concrete-style-profile"),
});

function baseFixture(behaviorId) {
  return {
    behaviorId,
    primaryScope: PRIMARY_SCOPE,
    secondaryScope: SECONDARY_SCOPE,
  };
}

function ownerStyle() {
  return {
    ownerType: "IMAGE_STYLE_VERSION",
    ownerId: X.styleVersion,
    imageStyleVersionId: X.styleVersion,
  };
}

function ownerAvatar() {
  return {
    ownerType: "AVATAR_PROFILE_VERSION",
    ownerId: IDS.avatarVersionA,
    avatarProfileVersionId: IDS.avatarVersionA,
  };
}

function reservation({
  taskId,
  attemptId,
  costEventId,
  outboxId,
  owner = OWNER_REVISION_A,
  sequence = 1,
  key,
  taskKey,
  ordinal = 1,
}) {
  return {
    idempotencyKey: key,
    task: {
      taskId,
      owner,
      taskKey,
      lane: "IMAGE",
      initialState: "READY",
      required: true,
      dependsOn: [],
    },
    attempt: {
      attemptId,
      ordinal,
      idempotencyKey: key,
      executionProfileId: IDS.executionProfileA,
      executionClaimTokenHash: sha256(`${key}:claim`),
      inputHash: sha256(`${key}:input`),
      parentAttemptId: null,
      fallbackReason: null,
    },
    costReservation: {
      costEventId,
      sequence,
      amountMicroUsd: 12_345n,
      idempotencyKey: `${key}:cost`,
      details: { source: "concrete-contract" },
      occurredAt: FIXED_TIME,
    },
    dispatchOutbox: {
      outboxId,
      dedupeKey: `${key}:dispatch`,
      payloadContractName: "worker-job-envelope",
      payloadContractVersion: "v1",
      payloadHash: sha256(`${key}:payload`),
      payload: { taskId, attemptId },
      availableAt: FIXED_TIME,
    },
  };
}

async function insertTask(executor, { taskId, taskKey, state = "READY" }) {
  await executor.query(
    `INSERT INTO generation_tasks (
       id, workspace_id, owner_type, owner_id, project_revision_id, task_key, lane, state
     ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $3, $4, 'IMAGE', $5)`,
    [taskId, IDS.workspaceA, IDS.revisionA, taskKey, state],
  );
}

async function insertAttempt(executor, { taskId, attemptId, ordinal, key }) {
  await executor.query(
    `INSERT INTO attempts (
       id, workspace_id, task_id, ordinal, idempotency_key, state,
       dispatch_state, claim_state, execution_profile_id, execution_claim_token_hash, input_hash
     ) VALUES ($1, $2, $3, $4, $5, 'CREATED', 'NOT_SENT', 'UNCLAIMED', $6, $7, $8)`,
    [
      attemptId,
      IDS.workspaceA,
      taskId,
      ordinal,
      key,
      IDS.executionProfileA,
      sha256(`${key}:claim`),
      sha256(`${key}:input`),
    ],
  );
}

async function insertTaskAttempt(executor, values) {
  await insertTask(executor, values);
  await insertAttempt(executor, values);
}

async function seedAvatarDraft(executor) {
  await executor.query(
    `INSERT INTO avatar_profiles (
       id, workspace_id, name, normalized_name, created_by_user_id, created_at, updated_at
     ) VALUES ($1, $2, 'Contract Presenter', 'contract presenter', $3, $4, $4)`,
    [X.avatarProfile, IDS.workspaceA, IDS.userA, FIXED_TIME],
  );
  await executor.query(
    `INSERT INTO avatar_profile_versions (
       id, workspace_id, profile_id, version_number, state, created_at, updated_at
     ) VALUES ($1, $2, $3, 1, 'DRAFT', $4, $4)`,
    [X.avatarVersion, IDS.workspaceA, X.avatarProfile, FIXED_TIME],
  );
}

async function seedStyleDraft(executor) {
  await executor.query(
    `INSERT INTO image_styles (
       id, workspace_id, name, normalized_name, created_by_user_id, created_at, updated_at
     ) VALUES ($1, $2, 'Contract Documentary', 'contract documentary', $3, $4, $4)`,
    [X.style, IDS.workspaceA, IDS.userA, FIXED_TIME],
  );
  await executor.query(
    `INSERT INTO image_style_versions (
       id, workspace_id, style_id, version_number, state, created_at, updated_at
     ) VALUES ($1, $2, $3, 1, 'DRAFT', $4, $4)`,
    [X.styleVersion, IDS.workspaceA, X.style, FIXED_TIME],
  );
}

function revisionSnapshot() {
  return {
    title: "Contract Revision Draft",
    voiceoverAssetId: IDS.voiceoverA,
    voiceoverBinarySha256: HASHES.voiceoverA,
    avatarProfileId: IDS.avatarProfileA,
    avatarProfileVersionId: IDS.avatarVersionA,
    avatarProfileHash: HASHES.avatarProfileA,
    avatarRuntimeSourceAssetId: IDS.avatarRuntimeA,
    avatarRuntimeSourceBinarySha256: HASHES.avatarRuntimeA,
    avatarSourcePreparationProfile: "owned-preparation-v1",
    avatarSourceValidationProfile: "owned-validation-v1",
    avatarCompatibility: { state: "UNTESTED", assessmentId: null, evidenceHash: null },
    imageStyleId: IDS.styleA,
    imageStyleVersionId: IDS.styleVersionA,
    styleProfileHash: HASHES.styleA,
    extraPromptKeywords: null,
    applyExtraPromptKeywords: false,
    generationMode: "LOWEST_COST",
    maximumCostMicroUsd: 1_500_000n,
    currency: "USD",
    seed: 42n,
    revisionConfig: {
      contractName: "project-revision-config",
      contractVersion: "v2",
      payload: { source: "concrete-contract" },
      canonicalDocumentSha256: sha256("contract-revision-draft"),
    },
  };
}

async function seedRevisionDraft(executor) {
  const snapshot = revisionSnapshot();
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
       maximum_cost_micro_usd, currency, seed,
       revision_config_contract_name, revision_config_contract_version,
       revision_config_payload, revision_config_hash, created_by_user_id, created_at
     ) VALUES (
       $1, $2, $3, 2, 'DRAFT', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       'UNTESTED', NULL, NULL, $14, $15, $16, NULL, false, 'LOWEST_COST', $17, 'USD', $18,
       $19, $20, $21::jsonb, $22, $23, $24
     )`,
    [
      X.revisionDraft,
      IDS.workspaceA,
      IDS.projectA,
      snapshot.title,
      snapshot.voiceoverAssetId,
      snapshot.voiceoverBinarySha256,
      snapshot.avatarProfileId,
      snapshot.avatarProfileVersionId,
      snapshot.avatarProfileHash,
      snapshot.avatarRuntimeSourceAssetId,
      snapshot.avatarRuntimeSourceBinarySha256,
      snapshot.avatarSourcePreparationProfile,
      snapshot.avatarSourceValidationProfile,
      snapshot.imageStyleId,
      snapshot.imageStyleVersionId,
      snapshot.styleProfileHash,
      snapshot.maximumCostMicroUsd,
      snapshot.seed,
      snapshot.revisionConfig.contractName,
      snapshot.revisionConfig.contractVersion,
      JSON.stringify(snapshot.revisionConfig.payload),
      snapshot.revisionConfig.canonicalDocumentSha256,
      IDS.userA,
      FIXED_TIME,
    ],
  );
  return snapshot;
}

function cancellationOutbox() {
  return {
    outboxId: X.cancelOutbox,
    kind: "CANCEL",
    dedupeKey: "contract:cancel:dispatch",
    payloadContractName: "worker-cancel-envelope",
    payloadContractVersion: "v1",
    payloadHash: sha256("contract-cancel-payload"),
    payload: { taskId: X.attemptCancelTask, attemptId: X.attemptCancelAttempt },
    availableAt: FIXED_TIME,
  };
}

async function fixtureFor(behaviorId, executor) {
  switch (behaviorId) {
    case "explicit-workspace-isolation":
      return {
        ...baseFixture(behaviorId),
        revisionLookup: { projectId: IDS.projectA, revisionId: IDS.revisionA },
      };
    case "membership-authorization":
      return { ...baseFixture(behaviorId), memberLookup: { userId: IDS.userA } };
    case "avatar-publication-immutability": {
      await seedAvatarDraft(executor);
      const publish = {
        idempotencyKey: "contract:avatar:publish",
        profileId: X.avatarProfile,
        versionId: X.avatarVersion,
        expectedUpdatedAt: FIXED_TIME,
        profileDocument: PROFILE_DOCUMENT,
        originalAssetId: IDS.avatarOriginalA,
        runtimeSourceAssetId: IDS.avatarRuntimeA,
        runtimeSourceBinarySha256: HASHES.avatarRuntimeA,
        sourcePreparationProfile: "owned-preparation-v1",
        sourceValidationProfile: "owned-validation-v1",
        rightsAttestedByUserId: IDS.userA,
        likenessAttestedByUserId: IDS.userA,
        readyAt: FIXED_TIME,
      };
      return {
        ...baseFixture(behaviorId),
        publish,
        lookup: { profileId: X.avatarProfile, versionId: X.avatarVersion, use: "NEW_REVISION" },
        mutatePublished: {
          idempotencyKey: "contract:avatar:mutate-published",
          profileId: X.avatarProfile,
          versionId: X.avatarVersion,
          expectedUpdatedAt: FIXED_TIME,
          nextState: "NEEDS_REVIEW",
          profileDocument: PROFILE_DOCUMENT,
          originalAssetId: IDS.avatarOriginalA,
          runtimeSourceAssetId: IDS.avatarRuntimeA,
          runtimeSourceBinarySha256: HASHES.avatarRuntimeA,
          sourcePreparationProfile: "changed-preparation",
          sourceValidationProfile: "owned-validation-v1",
          rightsAttestedByUserId: IDS.userA,
          likenessAttestedByUserId: IDS.userA,
        },
      };
    }
    case "style-publication-immutability": {
      await seedStyleDraft(executor);
      const publish = {
        idempotencyKey: "contract:style:publish",
        styleId: X.style,
        versionId: X.styleVersion,
        expectedUpdatedAt: FIXED_TIME,
        profileDocument: STYLE_DOCUMENT,
        analyzerRequestHash: sha256("contract-style-request"),
        analyzerModelSnapshot: "fixture-model-v1",
        disclosureAttestedByUserId: IDS.userA,
        publishedAt: FIXED_TIME,
      };
      return {
        ...baseFixture(behaviorId),
        publish,
        lookup: { styleId: X.style, versionId: X.styleVersion, use: "NEW_REVISION" },
        mutatePublished: {
          idempotencyKey: "contract:style:mutate-published",
          styleId: X.style,
          versionId: X.styleVersion,
          expectedUpdatedAt: FIXED_TIME,
          nextState: "NEEDS_REVIEW",
          profileDocument: STYLE_DOCUMENT,
          analyzerRequestHash: sha256("changed-style-request"),
          analyzerModelSnapshot: "fixture-model-v2",
          disclosureAttestedByUserId: IDS.userA,
        },
      };
    }
    case "revision-lock-immutability": {
      const snapshot = await seedRevisionDraft(executor);
      const lock = {
        idempotencyKey: "contract:revision:lock",
        projectId: IDS.projectA,
        revisionId: X.revisionDraft,
        expectedProjectVersion: 1,
        expectedRevisionConfigHash: snapshot.revisionConfig.canonicalDocumentSha256,
        lockedAt: FIXED_TIME,
      };
      return {
        ...baseFixture(behaviorId),
        lock,
        lookup: { projectId: IDS.projectA, revisionId: X.revisionDraft },
        relock: { ...lock, idempotencyKey: "contract:revision:relock" },
      };
    }
    case "content-address-binding": {
      const canonicalHash = sha256("contract-canonical-document");
      await executor.query(
        `UPDATE assets SET canonical_contract_name = 'contract-document',
           canonical_contract_version = 'v1', canonical_document_sha256 = $3
         WHERE workspace_id = $1 AND id = $2`,
        [IDS.workspaceA, IDS.outputA1, canonicalHash],
      );
      return {
        ...baseFixture(behaviorId),
        assetId: IDS.outputA1,
        binaryLookup: { kind: "BINARY", sha256: HASHES.outputA1 },
        canonicalLookup: {
          kind: "CANONICAL_DOCUMENT",
          contractName: "contract-document",
          contractVersion: "v1",
          sha256: canonicalHash,
        },
      };
    }
    case "atomic-task-attempt-reservation": {
      await seedStyleDraft(executor);
      const general = reservation({
        taskId: X.generalTask,
        attemptId: X.generalAttempt,
        costEventId: X.generalCost,
        outboxId: X.generalOutbox,
        key: "contract:general:attempt:1",
        taskKey: "contract:general",
      });
      const styleReservation = reservation({
        taskId: X.styleTask,
        attemptId: X.styleAttempt,
        costEventId: X.styleCost,
        outboxId: X.styleOutbox,
        owner: ownerStyle(),
        key: "contract:style-analysis:attempt:1",
        taskKey: "contract:style-analysis",
      });
      const styleAnalysis = {
        idempotencyKey: styleReservation.idempotencyKey,
        styleId: X.style,
        versionId: X.styleVersion,
        analysisAttemptId: X.styleAnalysisAttempt,
        requestHash: sha256("contract-style-analysis-request"),
        provider: "LOCAL_FAKE",
        model: "fixture",
        modelRevision: "v1",
        reservation: withoutOuterKey(styleReservation),
      };
      const avatarReservation = reservation({
        taskId: X.avatarTask,
        attemptId: X.avatarAttempt,
        costEventId: X.avatarCost,
        outboxId: X.avatarOutbox,
        owner: ownerAvatar(),
        key: "contract:avatar-test:attempt:1",
        taskKey: "contract:avatar-test",
      });
      const avatarCompatibilityTest = {
        idempotencyKey: avatarReservation.idempotencyKey,
        profileId: IDS.avatarProfileA,
        versionId: IDS.avatarVersionA,
        assessmentId: X.avatarAnalysisAssessment,
        testAttemptId: X.avatarTestAttempt,
        reservation: withoutOuterKey(avatarReservation),
      };
      return {
        ...baseFixture(behaviorId),
        reservation: general,
        invalidStyleAnalysis: {
          ...styleAnalysis,
          reservation: {
            ...styleAnalysis.reservation,
            task: {
              ...styleAnalysis.reservation.task,
              owner: {
                ownerType: "IMAGE_STYLE_VERSION",
                ownerId: IDS.styleVersionA,
                imageStyleVersionId: IDS.styleVersionA,
              },
            },
          },
        },
        styleAnalysis,
        invalidAvatarCompatibilityTest: {
          ...avatarCompatibilityTest,
          reservation: {
            ...avatarCompatibilityTest.reservation,
            task: {
              ...avatarCompatibilityTest.reservation.task,
              owner: {
                ownerType: "AVATAR_PROFILE_VERSION",
                ownerId: IDS.avatarVersionB,
                avatarProfileVersionId: IDS.avatarVersionB,
              },
            },
          },
        },
        avatarCompatibilityTest,
      };
    }
    case "reservation-idempotency": {
      const original = reservation({
        taskId: X.generalTask,
        attemptId: X.generalAttempt,
        costEventId: X.generalCost,
        outboxId: X.generalOutbox,
        key: "contract:idempotent:attempt:1",
        taskKey: "contract:idempotent",
      });
      return {
        ...baseFixture(behaviorId),
        reservation: original,
        changedReservation: {
          ...original,
          attempt: { ...original.attempt, inputHash: sha256("changed-reservation-input") },
        },
      };
    }
    case "dispatch-ambiguity-is-not-completion": {
      await insertTaskAttempt(executor, {
        taskId: X.ambiguityTask,
        attemptId: X.ambiguityAttempt,
        ordinal: 1,
        key: "contract:ambiguity:attempt",
        taskKey: "contract:ambiguity",
      });
      await insertTaskAttempt(executor, {
        taskId: X.ambiguityUnknownTask,
        attemptId: X.ambiguityUnknownAttempt,
        ordinal: 1,
        key: "contract:ambiguity-unknown:attempt",
        taskKey: "contract:ambiguity-unknown",
      });
      await insertTask(executor, {
        taskId: X.taskOnlyCancel,
        taskKey: "contract:task-only-cancel",
      });
      await insertTaskAttempt(executor, {
        taskId: X.attemptCancelTask,
        attemptId: X.attemptCancelAttempt,
        ordinal: 1,
        key: "contract:attempt-cancel:attempt",
        taskKey: "contract:attempt-cancel",
      });
      return {
        ...baseFixture(behaviorId),
        acknowledged: {
          idempotencyKey: "contract:dispatch:ack",
          taskId: X.ambiguityTask,
          attemptId: X.ambiguityAttempt,
          externalJobId: "local-job-001",
          providerDetails: { transport: "local" },
          acknowledgedAt: FIXED_TIME,
        },
        acknowledgementUnknown: {
          idempotencyKey: "contract:dispatch:unknown",
          taskId: X.ambiguityUnknownTask,
          attemptId: X.ambiguityUnknownAttempt,
          providerDetails: { transport: "local", response: "lost" },
          ambiguityReason: "acknowledgement lost",
          observedAt: FIXED_TIME,
        },
        unknownAttempt: {
          idempotencyKey: "contract:attempt:unknown",
          taskId: X.ambiguityUnknownTask,
          attemptId: X.ambiguityUnknownAttempt,
          problemCode: "CALLBACK_MISSING",
          providerDetails: { reconciliation: "required" },
          observedAt: FIXED_TIME,
        },
        taskOnlyCancellation: {
          idempotencyKey: "contract:cancel:task-only",
          target: "TASK_ONLY",
          taskId: X.taskOnlyCancel,
          expectedTaskVersion: 1,
          requestedAt: FIXED_TIME,
        },
        attemptCancellation: {
          idempotencyKey: "contract:cancel:attempt",
          target: "ATTEMPT",
          taskId: X.attemptCancelTask,
          attemptId: X.attemptCancelAttempt,
          expectedTaskVersion: 1,
          requestedAt: FIXED_TIME,
          outbox: cancellationOutbox(),
        },
      };
    }
    case "one-accepted-result": {
      await insertTask(executor, { taskId: X.acceptedTask, taskKey: "contract:accepted" });
      await insertAttempt(executor, {
        taskId: X.acceptedTask,
        attemptId: X.acceptedAttempt1,
        ordinal: 1,
        key: "contract:accepted:attempt:1",
      });
      await insertAttempt(executor, {
        taskId: X.acceptedTask,
        attemptId: X.acceptedAttempt2,
        ordinal: 2,
        key: "contract:accepted:attempt:2",
      });
      return {
        ...baseFixture(behaviorId),
        firstResult: successfulResult(
          X.acceptedTask,
          X.acceptedAttempt1,
          IDS.outputA1,
          HASHES.outputA1,
          1,
        ),
        secondResult: successfulResult(
          X.acceptedTask,
          X.acceptedAttempt2,
          IDS.outputA2,
          HASHES.outputA2,
          2,
        ),
        firstAcceptance: { idempotencyKey: "contract:accept:first", acceptedAt: FIXED_TIME },
        secondAcceptance: { idempotencyKey: "contract:accept:second", acceptedAt: FIXED_TIME },
      };
    }
    case "append-only-monotonic-events": {
      await insertTaskAttempt(executor, {
        taskId: X.workflowTask,
        attemptId: X.workflowAttempt,
        ordinal: 1,
        key: "contract:events:attempt",
        taskKey: "contract:events",
      });
      await executor.query(
        `INSERT INTO workflow_instances (
           id, workspace_id, owner_type, owner_id, task_id, workflow_type,
           state, external_system, idempotency_key
         ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $4, 'GENERATE', 'QUEUED', 'LOCAL', $5)`,
        [X.workflow, IDS.workspaceA, IDS.revisionA, X.workflowTask, "contract:workflow"],
      );
      const workflowEvent = {
        idempotencyKey: "contract:event:1",
        eventId: X.workflowEvent,
        workflowInstanceId: X.workflow,
        aggregate: {
          aggregateType: "ATTEMPT",
          aggregateId: X.workflowAttempt,
          taskId: X.workflowTask,
          attemptId: X.workflowAttempt,
        },
        sequence: 1,
        kind: "ATTEMPT_CREATED",
        payloadContractName: "workflow-event",
        payloadContractVersion: "v1",
        payloadHash: sha256("contract-workflow-event"),
        payload: { state: "CREATED" },
        occurredAt: FIXED_TIME,
      };
      const costEvent = {
        idempotencyKey: "contract:cost-event:1",
        costEventId: X.costEvent,
        owner: OWNER_REVISION_A,
        taskId: X.workflowTask,
        attemptId: X.workflowAttempt,
        sequence: 1,
        eventType: "REPORTED",
        amountMicroUsd: 9_999n,
        providerReference: "local-cost-001",
        details: { source: "local" },
        occurredAt: FIXED_TIME,
      };
      return {
        ...baseFixture(behaviorId),
        workflowEvent,
        changedWorkflowEvent: {
          ...workflowEvent,
          idempotencyKey: "contract:event:changed",
          payloadHash: sha256("contract-workflow-event-changed"),
          payload: { state: "CHANGED" },
        },
        nonMonotonicWorkflowEvent: {
          ...workflowEvent,
          idempotencyKey: "contract:event:non-monotonic",
          eventId: X.workflowNonMonotonic,
          payloadHash: sha256("contract-workflow-event-non-monotonic"),
        },
        workflowList: { workflowInstanceId: X.workflow, afterSequence: null, limit: 20 },
        costEvent,
        nonMonotonicCostEvent: {
          ...costEvent,
          idempotencyKey: "contract:cost-event:non-monotonic",
          costEventId: X.costNonMonotonic,
        },
        costList: { owner: OWNER_REVISION_A, afterSequence: null, limit: 20 },
      };
    }
    case "unit-of-work-rollback":
      return {
        ...baseFixture(behaviorId),
        typedFailureReservation: reservation({
          taskId: X.rollbackTypedTask,
          attemptId: X.rollbackTypedAttempt,
          costEventId: X.rollbackTypedCost,
          outboxId: X.rollbackTypedOutbox,
          key: "contract:rollback:typed",
          taskKey: "contract:rollback:typed",
          sequence: 1,
        }),
        thrownFailureReservation: reservation({
          taskId: X.rollbackThrownTask,
          attemptId: X.rollbackThrownAttempt,
          costEventId: X.rollbackThrownCost,
          outboxId: X.rollbackThrownOutbox,
          key: "contract:rollback:thrown",
          taskKey: "contract:rollback:thrown",
          sequence: 2,
        }),
      };
    case "archive-preserves-lineage": {
      await insertTask(executor, {
        taskId: X.archiveHistoricalTask,
        taskKey: "contract:archive:historical",
      });
      return {
        ...baseFixture(behaviorId),
        archive: {
          idempotencyKey: "contract:archive:project",
          projectId: IDS.projectA,
          expectedVersion: 1,
          archivedAt: FIXED_TIME,
        },
        historicalRevision: { projectId: IDS.projectA, revisionId: IDS.revisionA },
        historicalTask: { taskId: X.archiveHistoricalTask },
        newRevision: {
          idempotencyKey: "contract:archive:new-revision",
          revisionId: X.archiveNewRevision,
          projectId: IDS.projectA,
          revisionNumber: 2,
          expectedProjectVersion: 2,
          ...revisionSnapshot(),
        },
      };
    }
    default:
      throw new Error(`unsupported concrete behavior ${behaviorId}`);
  }
}

function withoutOuterKey(value) {
  const reservationWithoutOuterKey = { ...value };
  delete reservationWithoutOuterKey.idempotencyKey;
  return reservationWithoutOuterKey;
}

function successfulResult(taskId, attemptId, outputAssetId, outputBinarySha256, ordinal) {
  return {
    idempotencyKey: `contract:result:${ordinal}`,
    taskId,
    attemptId,
    outputAssetId,
    outputBinarySha256,
    providerDetails: { provider: "local", ordinal },
    finishedAt: FIXED_TIME,
  };
}

export const concretePGliteAdapterFactory = Object.freeze({
  async create(behavior) {
    const context = await createMigratedDatabase();
    try {
      await seedLockedProjects(context.executor);
      const fixture = await fixtureFor(behavior.id, context.executor);
      return {
        repositories: createPGliteControlPlaneRepositories(context.executor),
        fixture,
        async dispose() {
          await context.database.close();
        },
      };
    } catch (error) {
      await context.database.close();
      throw error;
    }
  },
});
