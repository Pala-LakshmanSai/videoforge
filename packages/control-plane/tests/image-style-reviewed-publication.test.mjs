import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalizeJson } from "@videoforge/contracts";
import { DeterministicFixtureStyleAnalyzer } from "@videoforge/pipeline";

import { createPGliteControlPlaneRepositories } from "../dist/src/adapters/pglite-repositories.js";
import {
  DURABLE_STYLE_ANALYZER_MODEL,
  DURABLE_STYLE_ANALYZER_PROVIDER,
  DurableImageStyleAnalysisComposition,
  DurableImageStyleAnalysisResultAcceptance,
  ImageStyleDerivedArtifactEditService,
  ImageStyleReviewedPublicationError,
  PGliteImageStyleDerivedEditPersistence,
  ReviewedImageStylePublicationService,
  deriveImageStylePublicationIdempotencyKey,
  exportMetadataSnapshot,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
} from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  createMigratedDatabase,
  FIXED_TIME,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

const SCOPE_A = Object.freeze({
  accountId: IDS.accountA,
  workspaceId: IDS.workspaceA,
  actorUserId: IDS.userA,
});
const SCOPE_B = Object.freeze({
  accountId: IDS.accountB,
  workspaceId: IDS.workspaceB,
  actorUserId: IDS.userB,
});
const MODEL_REVISION = "qualified-2026-08-11";
const COMPLETED_AT = "2026-08-11T06:06:00.000Z";
const PUBLISHED_AT = "2026-08-11T06:07:00.000Z";
const USAGE = Object.freeze({
  schema_version: "videoforge.image-style-analysis-usage/v1",
  provider_attempt_count: 1,
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  reasoning_tokens: 0,
});

function diagnostic(value) {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}

function writeValue(result) {
  assert.equal(result.ok, true, diagnostic(result));
  return result.value.value;
}

class MemoryCanonicalStore {
  constructor() {
    this.objects = new Map();
  }

  async putIfAbsent(write) {
    const actualHash = `sha256:${createHash("sha256").update(write.bytes).digest("hex")}`;
    assert.equal(actualHash, write.binarySha256);
    const existing = this.objects.get(write.objectKey);
    if (existing !== undefined && !Buffer.from(existing).equals(Buffer.from(write.bytes))) {
      throw new Error("immutable object conflict");
    }
    this.objects.set(write.objectKey, Uint8Array.from(write.bytes));
    return {
      objectKey: write.objectKey,
      binarySha256: write.binarySha256,
      byteSize: BigInt(write.bytes.byteLength),
      replayed: existing !== undefined,
    };
  }
}

async function seedReferences(executor, styleId, versionId, serialBase) {
  for (let index = 0; index < 3; index += 1) {
    const originalAssetId = uuid(serialBase + index * 10);
    const normalizedAssetId = uuid(serialBase + index * 10 + 1);
    const referenceId = uuid(serialBase + index * 10 + 2);
    await executor.query(
      `INSERT INTO assets (
         id, workspace_id, kind, state, binary_sha256, content_type,
         byte_size, width_px, height_px, verified_at
       ) VALUES
         ($1, $3, 'STYLE_REFERENCE_ORIGINAL', 'VERIFIED', $4, 'image/jpeg', 5000, 1280, 960, $6),
         ($2, $3, 'STYLE_REFERENCE_NORMALIZED', 'VERIFIED', $5, 'image/webp', $7, $8, $9, $6)`,
      [
        originalAssetId,
        normalizedAssetId,
        IDS.workspaceA,
        sha256(`publication-original:${serialBase}:${index}`),
        sha256(`publication-normalized:${serialBase}:${index}`),
        FIXED_TIME,
        4_000 + index,
        1_024 + index,
        768 + index,
      ],
    );
    await executor.query(
      `INSERT INTO image_style_references (
         id, workspace_id, style_id, version_id, original_asset_id,
         normalized_asset_id, reference_order, rights_attested_by_user_id,
         rights_basis, rights_attested_at, original_retention_policy
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OWNED', $9, 'RETAIN')`,
      [
        referenceId,
        IDS.workspaceA,
        styleId,
        versionId,
        originalAssetId,
        normalizedAssetId,
        index + 1,
        IDS.userA,
        FIXED_TIME,
      ],
    );
  }
}

async function provision(executor, repositories, serial, options = {}) {
  const ids = {
    styleId: options.styleId ?? uuid(serial),
    versionId: uuid(serial + 1),
    analysisAttemptId: uuid(serial + 2),
    taskId: uuid(serial + 3),
    executionAttemptId: uuid(serial + 4),
    reservationCostEventId: uuid(serial + 5),
    outboxId: uuid(serial + 6),
  };
  if (options.styleId === undefined) {
    writeValue(
      await repositories.imageStyles.createStyle(SCOPE_A, {
        idempotencyKey: `publication:create:${serial}`,
        styleId: ids.styleId,
        name: `Publication ${serial}`,
        normalizedName: `publication ${serial}`,
      }),
    );
  }
  const draft = writeValue(
    await repositories.imageStyles.createDraftVersion(SCOPE_A, {
      idempotencyKey: `publication:draft:${serial}`,
      styleId: ids.styleId,
      versionId: ids.versionId,
      versionNumber: options.versionNumber ?? 1,
    }),
  );
  writeValue(
    await repositories.imageStyles.saveDraftVersion(SCOPE_A, {
      idempotencyKey: `publication:disclosure:${serial}`,
      styleId: ids.styleId,
      versionId: ids.versionId,
      expectedUpdatedAt: draft.updatedAt,
      nextState: "DRAFT",
      profileDocument: null,
      analyzerRequestHash: null,
      analyzerModelSnapshot: null,
      disclosureAttestedByUserId: IDS.userA,
    }),
  );
  await seedReferences(executor, ids.styleId, ids.versionId, serial + 100);
  const analyzer = new DeterministicFixtureStyleAnalyzer();
  const composition = new DurableImageStyleAnalysisComposition(repositories, analyzer);
  const prepared = await composition.prepare(SCOPE_A, {
    styleId: ids.styleId,
    versionId: ids.versionId,
    analysisAttemptId: ids.analysisAttemptId,
    taskId: ids.taskId,
    executionAttemptId: ids.executionAttemptId,
    provider: DURABLE_STYLE_ANALYZER_PROVIDER,
    model: DURABLE_STYLE_ANALYZER_MODEL,
    modelRevision: MODEL_REVISION,
  });
  const claimTokenHash = sha256(`publication:claim:${serial}`);
  const logicalKey = `publication:analysis:${serial}`;
  const started = writeValue(
    await repositories.imageStyles.beginAnalysis(SCOPE_A, {
      idempotencyKey: logicalKey,
      styleId: ids.styleId,
      versionId: ids.versionId,
      analysisAttemptId: ids.analysisAttemptId,
      requestHash: prepared.inputFingerprintHash,
      provider: DURABLE_STYLE_ANALYZER_PROVIDER,
      model: DURABLE_STYLE_ANALYZER_MODEL,
      modelRevision: MODEL_REVISION,
      reservation: {
        task: {
          taskId: ids.taskId,
          owner: {
            ownerType: "IMAGE_STYLE_VERSION",
            ownerId: ids.versionId,
            imageStyleVersionId: ids.versionId,
          },
          taskKey: `style-analysis:${ids.versionId}`,
          lane: "IMAGE",
          initialState: "READY",
          required: true,
          dependsOn: [],
        },
        attempt: {
          attemptId: ids.executionAttemptId,
          ordinal: 1,
          idempotencyKey: logicalKey,
          executionProfileId: IDS.executionProfileA,
          executionClaimTokenHash: claimTokenHash,
          inputHash: prepared.inputFingerprintHash,
          parentAttemptId: null,
          fallbackReason: null,
        },
        costReservation: {
          costEventId: ids.reservationCostEventId,
          sequence: 1,
          amountMicroUsd: 80_000n,
          idempotencyKey: `${logicalKey}:reserve`,
          details: { source: "vf-7-05-synthetic" },
          occurredAt: FIXED_TIME,
        },
        dispatchOutbox: {
          outboxId: ids.outboxId,
          dedupeKey: `${logicalKey}:dispatch`,
          payloadContractName: "worker-job-envelope",
          payloadContractVersion: "v1",
          payloadHash: sha256(`${logicalKey}:payload`),
          payload: { attemptId: ids.executionAttemptId, taskId: ids.taskId },
          availableAt: FIXED_TIME,
        },
      },
    }),
  );
  writeValue(
    await repositories.execution.recordDispatchAcknowledged(SCOPE_A, {
      idempotencyKey: `${logicalKey}:ack`,
      taskId: ids.taskId,
      attemptId: ids.executionAttemptId,
      externalJobId: `fixture-${ids.taskId}`,
      providerDetails: { provider: "fixture" },
      acknowledgedAt: "2026-08-11T06:01:00.000Z",
    }),
  );
  writeValue(
    await repositories.execution.claimExecution(SCOPE_A, {
      idempotencyKey: `${logicalKey}:claim`,
      taskId: ids.taskId,
      attemptId: ids.executionAttemptId,
      presentedClaimTokenHash: claimTokenHash,
      expectedTaskVersion: started.reservation.task.version,
      claimedAt: "2026-08-11T06:02:00.000Z",
    }),
  );
  const candidate = await composition.execute(SCOPE_A, {
    styleId: ids.styleId,
    versionId: ids.versionId,
    analysisAttemptId: ids.analysisAttemptId,
  });
  const acceptance = new DurableImageStyleAnalysisResultAcceptance(
    repositories,
    options.store ?? new MemoryCanonicalStore(),
  );
  const accepted = await acceptance.accept(SCOPE_A, {
    completionCandidate: candidate,
    usageSummary: USAGE,
    reportedCostMicroUsd: 0n,
    costEvents: [
      {
        costEventId: uuid(serial + 20),
        sequence: 2,
        eventType: "REPORTED",
        amountMicroUsd: 0n,
        idempotencyKey: `publication:reported:${ids.analysisAttemptId}`,
        occurredAt: "2026-08-11T06:03:00.000Z",
      },
      {
        costEventId: uuid(serial + 21),
        sequence: 3,
        eventType: "SETTLED",
        amountMicroUsd: 0n,
        idempotencyKey: `publication:settled:${ids.analysisAttemptId}`,
        occurredAt: "2026-08-11T06:04:00.000Z",
      },
      {
        costEventId: uuid(serial + 22),
        sequence: 4,
        eventType: "REFUNDED",
        amountMicroUsd: 80_000n,
        idempotencyKey: `publication:refunded:${ids.analysisAttemptId}`,
        occurredAt: "2026-08-11T06:05:00.000Z",
      },
    ],
    completedAt: COMPLETED_AT,
  });
  assert.equal(accepted.ok, true, diagnostic(accepted));
  return { ...ids, candidate, accepted: accepted.value };
}

async function publicationCommand(snapshot, scope = SCOPE_A, overrides = {}) {
  const withoutKey = {
    styleId: overrides.styleId ?? snapshot.styleId,
    versionId: overrides.versionId ?? snapshot.versionId,
    expectedUpdatedAt: overrides.expectedUpdatedAt ?? snapshot.expectedUpdatedAt,
    reviewedProfileHash: overrides.reviewedProfileHash ?? snapshot.styleProfileHash,
    publishedAt: overrides.publishedAt ?? PUBLISHED_AT,
  };
  return {
    ...withoutKey,
    idempotencyKey:
      overrides.idempotencyKey ??
      (await deriveImageStylePublicationIdempotencyKey(scope, withoutKey)),
  };
}

async function rejectsService(action, code) {
  await assert.rejects(
    action,
    (error) => error instanceof ImageStyleReviewedPublicationError && error.code === code,
  );
}

function reviewLookup(fixture) {
  return { styleId: fixture.styleId, versionId: fixture.versionId };
}

test("returns one safe frozen review snapshot and publishes exact bytes with reopen replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "videoforge-style-publication-"));
  const dataDir = join(root, "pgdata");
  const store = new MemoryCanonicalStore();
  let context;
  try {
    context = await createMigratedDatabase(dataDir);
    await seedLockedProjects(context.executor);
    let repositories = createPGliteControlPlaneRepositories(context.executor);
    const fixture = await provision(context.executor, repositories, 61_000, { store });
    let service = new ReviewedImageStylePublicationService(repositories);
    const snapshot = await service.getReviewSnapshot(SCOPE_A, reviewLookup(fixture));
    assert.equal(snapshot.state, "NEEDS_REVIEW");
    assert.equal(snapshot.expectedUpdatedAt, COMPLETED_AT);
    assert.equal(
      snapshot.styleProfileHash,
      fixture.candidate.profileDocument.canonicalDocumentSha256,
    );
    assert.deepEqual(snapshot.profileDocument, fixture.candidate.profileDocument);
    assert.equal(snapshot.analysisLineage.analysisAttemptId, fixture.analysisAttemptId);
    assert.equal(snapshot.analysisLineage.taskId, fixture.taskId);
    assert.equal(snapshot.analysisLineage.executionAttemptId, fixture.executionAttemptId);
    assert.equal(snapshot.analysisLineage.outputAssetId, fixture.accepted.artifact.assetId);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.profileDocument.payload), true);
    const serialized = JSON.stringify(snapshot).toLowerCase();
    for (const forbidden of ["https://", "signed", "private", "objectkey", "provider_output"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }

    const command = await publicationCommand(snapshot);
    const published = await service.publish(SCOPE_A, command);
    assert.equal(published.ok, true, diagnostic(published));
    assert.equal(published.value.version.state, "PUBLISHED");
    assert.equal(published.value.activeVersionId, fixture.versionId);
    assert.equal(published.value.reviewerUserId, IDS.userA);
    assert.equal(published.value.reviewedProfileHash, snapshot.styleProfileHash);
    assert.equal(published.value.replayed, false);

    await context.database.close();
    context = undefined;
    context = await createMigratedDatabase(dataDir);
    repositories = createPGliteControlPlaneRepositories(context.executor);
    service = new ReviewedImageStylePublicationService(repositories);
    const replay = await service.publish(SCOPE_A, command);
    assert.equal(replay.ok, true, diagnostic(replay));
    assert.equal(replay.value.replayed, true);
    assert.deepEqual(replay.value.version.profileDocument, snapshot.profileDocument);
    await rejectsService(
      () => service.getReviewSnapshot(SCOPE_A, reviewLookup(fixture)),
      "REVIEW_STATE_INVALID",
    );
  } finally {
    if (context !== undefined) await context.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects stale, changed, malformed, cross-workspace, and actor-forged publication", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    const fixture = await provision(executor, repositories, 62_000);
    const service = new ReviewedImageStylePublicationService(repositories);
    const snapshot = await service.getReviewSnapshot(SCOPE_A, reviewLookup(fixture));

    await rejectsService(
      async () =>
        service.publish(SCOPE_A, { ...(await publicationCommand(snapshot)), extra: true }),
      "INPUT_INVALID",
    );
    await rejectsService(
      async () =>
        service.publish(SCOPE_A, {
          ...(await publicationCommand(snapshot)),
          idempotencyKey: "random-retry-key",
        }),
      "INPUT_INVALID",
    );
    await rejectsService(
      async () =>
        service.publish(
          SCOPE_A,
          await publicationCommand(snapshot, SCOPE_A, {
            expectedUpdatedAt: "2026-08-11T06:05:59.000Z",
          }),
        ),
      "REVIEW_STATE_INVALID",
    );
    await rejectsService(
      async () =>
        service.publish(
          SCOPE_A,
          await publicationCommand(snapshot, SCOPE_A, { reviewedProfileHash: sha256("changed") }),
        ),
      "REVIEW_STATE_INVALID",
    );
    await rejectsService(
      () => service.getReviewSnapshot(SCOPE_B, reviewLookup(fixture)),
      "REVIEW_STATE_INVALID",
    );
    await rejectsService(
      () =>
        service.getReviewSnapshot(
          { accountId: IDS.accountA, workspaceId: IDS.workspaceA, actorUserId: "" },
          reviewLookup(fixture),
        ),
      "INPUT_INVALID",
    );
    await rejectsService(
      () =>
        service.getReviewSnapshot(
          {
            accountId: IDS.accountA,
            workspaceId: IDS.workspaceA,
            actorUserId: IDS.userA,
            reviewerUserId: IDS.userB,
          },
          reviewLookup(fixture),
        ),
      "AUTHORIZATION_REQUIRED",
    );

    const version = await repositories.imageStyles.resolveVersion(SCOPE_A, fixture);
    const style = await repositories.imageStyles.resolveStyle(SCOPE_A, fixture.styleId);
    assert.equal(version.ok, true);
    assert.equal(version.value.state, "NEEDS_REVIEW");
    assert.equal(style.ok, true);
    assert.equal(style.value.activeVersionId, null);
  });
});

test("rejects archived, incomplete-lineage, and hostile stored review state", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    const archived = await provision(executor, repositories, 63_000);
    const service = new ReviewedImageStylePublicationService(repositories);
    const style = await repositories.imageStyles.resolveStyle(SCOPE_A, archived.styleId);
    assert.equal(style.ok, true);
    writeValue(
      await repositories.imageStyles.archiveStyle(SCOPE_A, {
        idempotencyKey: `publication:archive:${archived.styleId}`,
        styleId: archived.styleId,
        expectedUpdatedAt: style.value.updatedAt,
        archivedAt: PUBLISHED_AT,
      }),
    );
    await rejectsService(
      () => service.getReviewSnapshot(SCOPE_A, reviewLookup(archived)),
      "REVIEW_STATE_INVALID",
    );

    const incomplete = await provision(executor, repositories, 64_000);
    await executor.query(
      "UPDATE image_style_analysis_attempts SET response_hash = NULL WHERE id = $1",
      [incomplete.analysisAttemptId],
    );
    await rejectsService(
      () => service.getReviewSnapshot(SCOPE_A, reviewLookup(incomplete)),
      "LINEAGE_INVALID",
    );

    const artifactDrift = await provision(executor, repositories, 64_500);
    await executor.query(
      `UPDATE assets
          SET metadata = jsonb_set(metadata, '{analyzer_output_hash}', to_jsonb($2::text))
        WHERE id = $1`,
      [artifactDrift.accepted.artifact.assetId, sha256("artifact-drift")],
    );
    await rejectsService(
      () => service.getReviewSnapshot(SCOPE_A, reviewLookup(artifactDrift)),
      "LINEAGE_INVALID",
    );

    const hostile = await provision(executor, repositories, 65_000);
    const payload = structuredClone(hostile.candidate.profileDocument.payload);
    payload.prompt_profile.positive_suffix = "include title text and logo";
    const hash = `sha256:${createHash("sha256")
      .update(canonicalizeJson(payload), "utf8")
      .digest("hex")}`;
    await assert.rejects(
      executor.query(
        `UPDATE image_style_versions
            SET profile_payload = $2::jsonb, style_profile_hash = $3
          WHERE id = $1`,
        [hostile.versionId, JSON.stringify(payload), hash],
      ),
      (error) => error instanceof Error && error.code === "23514",
    );
  });
});

test("publication rollback keeps prior version immutable and active pointer unchanged", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    const first = await provision(executor, repositories, 66_000);
    const firstService = new ReviewedImageStylePublicationService(repositories);
    const firstSnapshot = await firstService.getReviewSnapshot(SCOPE_A, reviewLookup(first));
    const firstPublished = await firstService.publish(
      SCOPE_A,
      await publicationCommand(firstSnapshot),
    );
    assert.equal(firstPublished.ok, true, diagnostic(firstPublished));

    const second = await provision(executor, repositories, 67_000, {
      styleId: first.styleId,
      versionNumber: 2,
    });
    const secondSnapshot = await firstService.getReviewSnapshot(SCOPE_A, reviewLookup(second));
    await executor.execute(`
      CREATE FUNCTION vf_reject_test_active_pointer() RETURNS trigger AS $$
      BEGIN
        IF NEW.active_version_id = '${second.versionId}'::uuid THEN
          RAISE EXCEPTION 'forced active pointer failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER vf_reject_test_active_pointer
      BEFORE UPDATE OF active_version_id ON image_styles
      FOR EACH ROW EXECUTE FUNCTION vf_reject_test_active_pointer();
    `);
    const secondCommand = await publicationCommand(secondSnapshot);
    await assert.rejects(() => firstService.publish(SCOPE_A, secondCommand));
    const rows = await executor.query(
      `SELECT id, state, style_profile_hash FROM image_style_versions
        WHERE id IN ($1, $2) ORDER BY version_number`,
      [first.versionId, second.versionId],
    );
    assert.equal(rows.rows[0].state, "PUBLISHED");
    assert.equal(rows.rows[0].style_profile_hash, firstSnapshot.styleProfileHash);
    assert.equal(rows.rows[1].state, "NEEDS_REVIEW");
    assert.equal(rows.rows[1].style_profile_hash, secondSnapshot.styleProfileHash);
    const parent = await repositories.imageStyles.resolveStyle(SCOPE_A, first.styleId);
    assert.equal(parent.ok, true);
    assert.equal(parent.value.activeVersionId, first.versionId);
  });
});

test("production PGlite edits survive reopen/restore and publication pins exact derived bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "videoforge-style-derived-persistence-"));
  const dataDir = join(root, "source");
  let source;
  let destination;
  try {
    source = await createMigratedDatabase(dataDir);
    await seedLockedProjects(source.executor);
    let repositories = createPGliteControlPlaneRepositories(source.executor);
    const fixture = await provision(source.executor, repositories, 69_000);
    let persistence = new PGliteImageStyleDerivedEditPersistence(source.executor);
    let editService = new ImageStyleDerivedArtifactEditService(persistence);
    const candidate = structuredClone(fixture.candidate.profileDocument.payload);
    candidate.summary = "Derived exact-current documentary profile.";
    candidate.visual_profile.lighting = "soft directional practical window light";
    const editCommand = {
      styleId: fixture.styleId,
      versionId: fixture.versionId,
      expectedRevision: 1,
      expectedCurrentArtifactHash: fixture.candidate.profileDocument.canonicalDocumentSha256,
      idempotencyKey: "style-derived-pglite-69",
      candidateProfile: candidate,
      editedAt: "2026-08-11T06:06:30.000Z",
    };
    const edited = await editService.edit(SCOPE_A, editCommand);
    assert.equal(edited.replayed, false);
    assert.deepEqual(edited.changedPointers, ["/summary", "/visual_profile/lighting"]);
    const secondCandidate = structuredClone(candidate);
    secondCandidate.prompt_profile.positive_suffix =
      "restrained documentary realism, softer practical light, exact material detail";
    const secondCommand = {
      ...editCommand,
      expectedRevision: 2,
      expectedCurrentArtifactHash: edited.derivedArtifactHash,
      idempotencyKey: "style-derived-pglite-69-second",
      candidateProfile: secondCandidate,
      editedAt: "2026-08-11T06:06:45.000Z",
    };
    const secondEdit = await editService.edit(SCOPE_A, secondCommand);
    assert.equal(secondEdit.parentArtifactId, edited.derivedArtifactId);
    assert.equal(secondEdit.resultRevision, 3);
    await assert.rejects(
      editService.edit(SCOPE_A, {
        ...editCommand,
        idempotencyKey: "style-derived-pglite-69-stale",
      }),
      (error) => error instanceof Error && error.code === "STYLE_VERSION_CONFLICT",
    );
    const rows = await source.executor.query(
      `SELECT version.profile_revision, version.root_profile_artifact_id,
              version.current_profile_artifact_id, version.style_profile_hash,
              version.review_snapshot_id, version.review_invalidated_at,
              (SELECT count(*)::int FROM image_style_profile_artifacts
                WHERE workspace_id = version.workspace_id AND version_id = version.id) AS artifacts,
              (SELECT count(*)::int FROM image_style_profile_edits
                WHERE workspace_id = version.workspace_id AND version_id = version.id) AS edits
         FROM image_style_versions version WHERE version.id = $1`,
      [fixture.versionId],
    );
    assert.deepEqual(rows.rows, [
      {
        profile_revision: 3,
        root_profile_artifact_id: fixture.versionId,
        current_profile_artifact_id: secondEdit.derivedArtifactId,
        style_profile_hash: secondEdit.derivedArtifactHash,
        review_snapshot_id: null,
        review_invalidated_at: new Date(secondCommand.editedAt),
        artifacts: 3,
        edits: 2,
      },
    ]);
    await assert.rejects(
      source.executor.query(
        "UPDATE image_style_profile_artifacts SET origin = origin WHERE id = $1",
        [fixture.versionId],
      ),
      (error) => error instanceof Error && error.code === "23514",
    );
    await assert.rejects(
      editService.edit(SCOPE_B, secondCommand),
      (error) => error instanceof Error && error.code === "STYLE_NOT_FOUND",
    );

    const serialized = serializeMetadataSnapshot(await exportMetadataSnapshot(source.executor));
    await source.database.close();
    source = await createMigratedDatabase(dataDir);
    repositories = createPGliteControlPlaneRepositories(source.executor);
    persistence = new PGliteImageStyleDerivedEditPersistence(source.executor);
    editService = new ImageStyleDerivedArtifactEditService(persistence);
    assert.equal((await editService.edit(SCOPE_A, secondCommand)).replayed, true);

    const publication = new ReviewedImageStylePublicationService(repositories, persistence);
    const review = await publication.getReviewSnapshot(SCOPE_A, reviewLookup(fixture));
    assert.equal(review.styleProfileHash, secondEdit.derivedArtifactHash);
    assert.equal(review.profileDocument.payload.summary, candidate.summary);
    assert.deepEqual(review.profileDocument.payload.analysis, {
      analysis_kind: "MANUAL_EDIT",
      overall_confidence: null,
      trait_evidence: [],
      uncertain_fields: [],
      outlier_reference_aliases: [],
      content_leakage_warnings: [],
    });
    const publishCommand = await publicationCommand(review);
    const published = await publication.publish(SCOPE_A, publishCommand);
    assert.equal(published.ok, true, diagnostic(published));
    assert.equal(
      published.value.version.profileDocument.canonicalDocumentSha256,
      secondEdit.derivedArtifactHash,
    );
    const publishReplay = await publication.publish(SCOPE_A, publishCommand);
    assert.equal(publishReplay.ok, true, diagnostic(publishReplay));
    assert.equal(publishReplay.value.replayed, true);
    await assert.rejects(
      editService.edit(SCOPE_A, {
        ...editCommand,
        idempotencyKey: "style-derived-after-publish",
        expectedRevision: 3,
        expectedCurrentArtifactHash: secondEdit.derivedArtifactHash,
      }),
      (error) => error instanceof Error && error.code === "STYLE_VERSION_IMMUTABLE",
    );

    destination = await createMigratedDatabase();
    await restoreMetadataSnapshot(destination.executor, serialized);
    const restoredRepositories = createPGliteControlPlaneRepositories(destination.executor);
    const restoredPersistence = new PGliteImageStyleDerivedEditPersistence(destination.executor);
    const restoredReview = await new ReviewedImageStylePublicationService(
      restoredRepositories,
      restoredPersistence,
    ).getReviewSnapshot(SCOPE_A, reviewLookup(fixture));
    assert.equal(restoredReview.styleProfileHash, secondEdit.derivedArtifactHash);
    assert.equal(restoredReview.expectedUpdatedAt, secondCommand.editedAt);
  } finally {
    if (source !== undefined) await source.database.close();
    if (destination !== undefined) await destination.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("production PGlite edit transaction rolls back every derived row on injected failure", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    const fixture = await provision(executor, repositories, 70_000);
    const failing = {
      execute: (sql) => executor.execute(sql),
      query: (sql, parameters) => executor.query(sql, parameters),
      transaction: (work) =>
        executor.transaction((transaction) =>
          work({
            execute: (sql) => transaction.execute(sql),
            query: async (sql, parameters) => {
              const result = await transaction.query(sql, parameters);
              if (sql.includes("UPDATE public.image_style_versions")) {
                throw new Error("injected pointer failure");
              }
              return result;
            },
          }),
        ),
    };
    const candidate = structuredClone(fixture.candidate.profileDocument.payload);
    candidate.summary = "Rollback candidate.";
    await assert.rejects(
      new ImageStyleDerivedArtifactEditService(
        new PGliteImageStyleDerivedEditPersistence(failing),
      ).edit(SCOPE_A, {
        styleId: fixture.styleId,
        versionId: fixture.versionId,
        expectedRevision: 1,
        expectedCurrentArtifactHash: fixture.candidate.profileDocument.canonicalDocumentSha256,
        idempotencyKey: "style-derived-rollback-70",
        candidateProfile: candidate,
        editedAt: "2026-08-11T06:06:30.000Z",
      }),
      (error) => error instanceof Error && error.code === "REPOSITORY_FAILURE",
    );
    const counts = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM image_style_profile_artifacts WHERE version_id = $1) AS artifacts,
         (SELECT count(*)::int FROM image_style_profile_edits WHERE version_id = $1) AS edits,
         (SELECT profile_revision FROM image_style_versions WHERE id = $1) AS revision`,
      [fixture.versionId],
    );
    assert.deepEqual(counts.rows, [{ artifacts: 1, edits: 0, revision: 1 }]);
  });
});

test("style persistence/publication source has no analyzer, credential, environment, network, or byte I/O", async () => {
  const source = (
    await Promise.all(
      ["reviewed-publication.ts", "pglite-derived-artifact-edit.ts"].map((filename) =>
        readFile(new URL(`../src/styles/${filename}`, import.meta.url), "utf8"),
      ),
    )
  ).join("\n");
  for (const forbidden of [
    "process.env",
    "fetch(",
    "node:fs",
    "readfile(",
    "writefile(",
    "signed_url",
    ".analyze(",
    "runware",
    "runpod",
  ]) {
    assert.equal(source.toLowerCase().includes(forbidden), false, forbidden);
  }
});
