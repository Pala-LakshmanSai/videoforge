import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalizeJson } from "@videoforge/contracts";

import { createPGliteControlPlaneRepositories } from "../dist/src/adapters/pglite-repositories.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  createMigratedDatabase,
  FIXED_TIME,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

const SCOPE_A = Object.freeze({ workspaceId: IDS.workspaceA, actorUserId: IDS.userA });
const SCOPE_B = Object.freeze({ workspaceId: IDS.workspaceB, actorUserId: IDS.userB });
const PROFILE_PAYLOAD = JSON.parse(
  readFileSync(
    new URL("../../../project-context/evidence/default_image_style_v1.json", import.meta.url),
    "utf8",
  ),
);
const PROFILE_HASH = `sha256:${createHash("sha256")
  .update(canonicalizeJson(PROFILE_PAYLOAD), "utf8")
  .digest("hex")}`;
const PROFILE_DOCUMENT = Object.freeze({
  contractName: "image-style-profile",
  contractVersion: "v1",
  payload: PROFILE_PAYLOAD,
  canonicalDocumentSha256: PROFILE_HASH,
});

const STYLE = Object.freeze({
  alpha: uuid(20_001),
  alphaV1: uuid(20_002),
  zebra: uuid(20_003),
  zebraV1: uuid(20_004),
  lifecycle: uuid(20_010),
  lifecycleV1: uuid(20_011),
  lifecycleV2: uuid(20_012),
  lifecycleV3: uuid(20_013),
  rollback: uuid(20_020),
  rollbackV1: uuid(20_021),
  persistent: uuid(20_030),
  persistentV1: uuid(20_031),
  persistentV2: uuid(20_032),
});

function expectWrite(result) {
  assert.equal(result.ok, true);
  return result.value;
}

function expectValue(result) {
  assert.equal(result.ok, true);
  return result.value;
}

function expectFailure(result, kind, code) {
  assert.equal(result.ok, false);
  assert.equal(result.kind, kind);
  assert.equal(result.code ?? result.entity, code);
}

function reservation(
  versionId,
  serial,
  key,
  executionProfileId = IDS.executionProfileA,
  ordinal = 1,
) {
  const taskId = uuid(serial);
  const attemptId = uuid(serial + 1);
  return {
    task: {
      taskId,
      owner: {
        ownerType: "IMAGE_STYLE_VERSION",
        ownerId: versionId,
        imageStyleVersionId: versionId,
      },
      taskKey: `style-analysis:${versionId}:${serial}`,
      lane: "IMAGE",
      initialState: "READY",
      required: true,
      dependsOn: [],
    },
    attempt: {
      attemptId,
      ordinal,
      idempotencyKey: key,
      executionProfileId,
      executionClaimTokenHash: sha256(`${key}:claim`),
      inputHash: sha256(`${key}:input`),
      parentAttemptId: null,
      fallbackReason: null,
    },
    costReservation: {
      costEventId: uuid(serial + 2),
      sequence: ordinal,
      amountMicroUsd: 80_000n,
      idempotencyKey: `${key}:cost`,
      details: { source: "vf-7-01-fixture" },
      occurredAt: FIXED_TIME,
    },
    dispatchOutbox: {
      outboxId: uuid(serial + 3),
      dedupeKey: `${key}:dispatch`,
      payloadContractName: "worker-job-envelope",
      payloadContractVersion: "v1",
      payloadHash: sha256(`${key}:payload`),
      payload: { attemptId, taskId },
      availableAt: FIXED_TIME,
    },
  };
}

function beginCommand(styleId, versionId, serial, key, executionProfileId, ordinal = 1) {
  return {
    idempotencyKey: key,
    styleId,
    versionId,
    analysisAttemptId: uuid(serial + 4),
    requestHash: sha256(`${key}:request`),
    provider: "RUNWARE",
    model: "google:gemini@3.5-flash",
    modelRevision: "qualified-2026-08-11",
    reservation: reservation(versionId, serial, key, executionProfileId, ordinal),
  };
}

async function createStyleAndDraft(repositories, styleId, versionId, name, versionNumber = 1) {
  expectWrite(
    await repositories.imageStyles.createStyle(SCOPE_A, {
      idempotencyKey: `create:${styleId}`,
      styleId,
      name,
      normalizedName: name.toLowerCase(),
    }),
  );
  return expectWrite(
    await repositories.imageStyles.createDraftVersion(SCOPE_A, {
      idempotencyKey: `draft:${versionId}`,
      styleId,
      versionId,
      versionNumber,
    }),
  ).value;
}

async function attestDisclosure(repositories, styleId, version) {
  return expectWrite(
    await repositories.imageStyles.saveDraftVersion(SCOPE_A, {
      idempotencyKey: `disclosure:${version.versionId}:${version.updatedAt}`,
      styleId,
      versionId: version.versionId,
      expectedUpdatedAt: version.updatedAt,
      nextState: "DRAFT",
      profileDocument: null,
      analyzerRequestHash: null,
      analyzerModelSnapshot: null,
      disclosureAttestedByUserId: IDS.userA,
    }),
  ).value;
}

async function seedAnalysisReferences(executor, styleId, versionId, serialBase) {
  for (let index = 0; index < 3; index += 1) {
    const originalAssetId = uuid(serialBase + index * 10);
    const normalizedAssetId = uuid(serialBase + index * 10 + 1);
    await executor.query(
      `INSERT INTO assets (
         id, workspace_id, kind, state, binary_sha256, content_type,
         byte_size, width_px, height_px, verified_at
       ) VALUES
         ($1, $3, 'STYLE_REFERENCE_ORIGINAL', 'VERIFIED', $4, 'image/jpeg', 1000, 1024, 768, $6),
         ($2, $3, 'STYLE_REFERENCE_NORMALIZED', 'VERIFIED', $5, 'image/jpeg', 900, 1024, 768, $6)`,
      [
        originalAssetId,
        normalizedAssetId,
        IDS.workspaceA,
        sha256(`style-reference-original:${serialBase}:${index}`),
        sha256(`style-reference-normalized:${serialBase}:${index}`),
        FIXED_TIME,
      ],
    );
    await executor.query(
      `INSERT INTO image_style_references (
         id, workspace_id, style_id, version_id, original_asset_id,
         normalized_asset_id, reference_order, rights_attested_by_user_id,
         rights_basis, rights_attested_at, original_retention_policy
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OWNED', $9, 'RETAIN')`,
      [
        uuid(serialBase + index * 10 + 2),
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

test("style and version reads are deterministic and workspace scoped", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    await createStyleAndDraft(repositories, STYLE.zebra, STYLE.zebraV1, "Zebra Style");
    const alpha = await createStyleAndDraft(
      repositories,
      STYLE.alpha,
      STYLE.alphaV1,
      "Alpha Style",
    );

    assert.deepEqual(
      expectValue(
        await repositories.imageStyles.listStyles(SCOPE_A, { includeArchived: false }),
      ).map((style) => style.name),
      ["Alpha Style", "Owned Documentary", "Zebra Style"],
    );
    assert.deepEqual(
      expectValue(
        await repositories.imageStyles.listStyles(SCOPE_B, { includeArchived: false }),
      ).map((style) => style.name),
      ["Owned Documentary"],
    );
    expectFailure(
      await repositories.imageStyles.resolveStyle(SCOPE_B, STYLE.alpha),
      "NOT_FOUND",
      "IMAGE_STYLE",
    );
    expectFailure(
      await repositories.imageStyles.resolveVersion(SCOPE_B, {
        styleId: STYLE.alpha,
        versionId: STYLE.alphaV1,
      }),
      "NOT_FOUND",
      "IMAGE_STYLE_VERSION",
    );

    const archived = expectWrite(
      await repositories.imageStyles.archiveStyle(SCOPE_A, {
        idempotencyKey: "archive:alpha",
        styleId: STYLE.alpha,
        expectedUpdatedAt: expectValue(
          await repositories.imageStyles.resolveStyle(SCOPE_A, STYLE.alpha),
        ).updatedAt,
        archivedAt: "2026-08-11T05:00:00.000Z",
      }),
    ).value;
    assert.equal(archived.status, "ARCHIVED");
    assert.equal(
      expectValue(
        await repositories.imageStyles.listStyles(SCOPE_A, { includeArchived: false }),
      ).some((style) => style.styleId === STYLE.alpha),
      false,
    );
    assert.equal(
      expectValue(
        await repositories.imageStyles.listStyles(SCOPE_A, { includeArchived: true }),
      ).some((style) => style.styleId === STYLE.alpha),
      true,
    );
    assert.deepEqual(
      expectValue(await repositories.imageStyles.listVersions(SCOPE_A, STYLE.alpha)).map(
        (version) => version.versionNumber,
      ),
      [alpha.versionNumber],
    );
  });
});

test("style lifecycle state survives reopen and remains writable", async () => {
  const root = await mkdtemp(join(tmpdir(), "videoforge-style-lifecycle-"));
  const dataDir = join(root, "pgdata");
  let context;
  try {
    context = await createMigratedDatabase(dataDir);
    await seedLockedProjects(context.executor);
    let repositories = createPGliteControlPlaneRepositories(context.executor);
    const v1 = await createStyleAndDraft(
      repositories,
      STYLE.persistent,
      STYLE.persistentV1,
      "Persistent Style",
    );
    await context.database.close();
    context = undefined;

    context = await createMigratedDatabase(dataDir);
    repositories = createPGliteControlPlaneRepositories(context.executor);
    assert.equal(
      expectValue(
        await repositories.imageStyles.resolveVersion(SCOPE_A, {
          styleId: STYLE.persistent,
          versionId: STYLE.persistentV1,
        }),
      ).state,
      "DRAFT",
    );
    expectWrite(
      await repositories.imageStyles.abandonVersion(SCOPE_A, {
        idempotencyKey: "abandon:persistent:v1",
        styleId: STYLE.persistent,
        versionId: STYLE.persistentV1,
        expectedUpdatedAt: v1.updatedAt,
        abandonedAt: "2026-08-11T05:01:00.000Z",
      }),
    );
    assert.equal(
      expectWrite(
        await repositories.imageStyles.createDraftVersion(SCOPE_A, {
          idempotencyKey: "draft:persistent:v2",
          styleId: STYLE.persistent,
          versionId: STYLE.persistentV2,
          versionNumber: 2,
        }),
      ).value.state,
      "DRAFT",
    );
  } finally {
    if (context !== undefined) await context.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("analysis start is disclosure-gated, atomic, replay-safe, and fail-closed", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    const draft = await createStyleAndDraft(
      repositories,
      STYLE.lifecycle,
      STYLE.lifecycleV1,
      "Lifecycle Style",
    );
    const command = beginCommand(
      STYLE.lifecycle,
      STYLE.lifecycleV1,
      21_000,
      "analysis:lifecycle:v1:1",
    );
    expectFailure(
      await repositories.imageStyles.beginAnalysis(SCOPE_A, command),
      "INVARIANT_VIOLATION",
      "IMAGE_STYLE_DISCLOSURE_REQUIRED",
    );
    const before = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM generation_tasks WHERE image_style_version_id = $1) AS tasks,
         (SELECT count(*)::int FROM attempts WHERE id = $2) AS attempts,
         (SELECT count(*)::int FROM cost_events WHERE attempt_id = $2) AS costs,
         (SELECT count(*)::int FROM outbox WHERE attempt_id = $2) AS outbox`,
      [STYLE.lifecycleV1, command.reservation.attempt.attemptId],
    );
    assert.deepEqual(before.rows[0], { tasks: 0, attempts: 0, costs: 0, outbox: 0 });

    await attestDisclosure(repositories, STYLE.lifecycle, draft);
    await seedAnalysisReferences(executor, STYLE.lifecycle, STYLE.lifecycleV1, 24_000);
    const started = expectWrite(await repositories.imageStyles.beginAnalysis(SCOPE_A, command));
    assert.equal(started.replayed, false);
    assert.equal(started.value.version.state, "ANALYZING");
    assert.equal(started.value.version.analyzerRequestHash, command.requestHash);
    assert.equal(
      started.value.analysisAttempt.executionAttemptId,
      command.reservation.attempt.attemptId,
    );
    const replay = expectWrite(await repositories.imageStyles.beginAnalysis(SCOPE_A, command));
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.value, started.value);

    const counts = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM generation_tasks WHERE image_style_version_id = $1) AS tasks,
         (SELECT count(*)::int FROM attempts WHERE task_id = $2) AS attempts,
         (SELECT count(*)::int FROM cost_events WHERE task_id = $2) AS costs,
         (SELECT count(*)::int FROM outbox WHERE task_id = $2) AS outbox,
         (SELECT count(*)::int FROM image_style_analysis_attempts WHERE task_id = $2) AS specialized`,
      [STYLE.lifecycleV1, command.reservation.task.taskId],
    );
    assert.deepEqual(counts.rows[0], {
      tasks: 1,
      attempts: 1,
      costs: 1,
      outbox: 1,
      specialized: 1,
    });

    const failed = expectWrite(
      await repositories.imageStyles.saveDraftVersion(SCOPE_A, {
        idempotencyKey: "analysis:lifecycle:v1:failed",
        styleId: STYLE.lifecycle,
        versionId: STYLE.lifecycleV1,
        expectedUpdatedAt: started.value.version.updatedAt,
        nextState: "FAILED",
        profileDocument: null,
        analyzerRequestHash: started.value.version.analyzerRequestHash,
        analyzerModelSnapshot: started.value.version.analyzerModelSnapshot,
        disclosureAttestedByUserId: IDS.userA,
      }),
    ).value;
    assert.equal(failed.state, "FAILED");
    const retried = expectWrite(
      await repositories.imageStyles.beginAnalysis(
        SCOPE_A,
        beginCommand(
          STYLE.lifecycle,
          STYLE.lifecycleV1,
          21_050,
          "analysis:lifecycle:v1:2",
          IDS.executionProfileA,
          2,
        ),
      ),
    ).value;
    assert.equal(retried.version.state, "ANALYZING");
    assert.equal(retried.analysisAttempt.ordinal, 2);

    let rollbackDraft = await createStyleAndDraft(
      repositories,
      STYLE.rollback,
      STYLE.rollbackV1,
      "Rollback Style",
    );
    rollbackDraft = await attestDisclosure(repositories, STYLE.rollback, rollbackDraft);
    await seedAnalysisReferences(executor, STYLE.rollback, STYLE.rollbackV1, 24_100);
    const bad = beginCommand(
      STYLE.rollback,
      STYLE.rollbackV1,
      21_100,
      "analysis:rollback:v1:1",
      uuid(999_999),
    );
    expectFailure(
      await repositories.imageStyles.beginAnalysis(SCOPE_A, bad),
      "NOT_FOUND",
      "EXECUTION_PROFILE",
    );
    assert.equal(
      expectValue(
        await repositories.imageStyles.resolveVersion(SCOPE_A, {
          styleId: STYLE.rollback,
          versionId: STYLE.rollbackV1,
        }),
      ).state,
      "DRAFT",
    );
    const rolledBack = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM generation_tasks WHERE id = $1) AS tasks,
         (SELECT count(*)::int FROM attempts WHERE id = $2) AS attempts,
         (SELECT count(*)::int FROM image_style_analysis_attempts WHERE id = $3) AS specialized`,
      [bad.reservation.task.taskId, bad.reservation.attempt.attemptId, bad.analysisAttemptId],
    );
    assert.deepEqual(rolledBack.rows[0], { tasks: 0, attempts: 0, specialized: 0 });
    assert.equal(rollbackDraft.state, "DRAFT");
  });
});

test("only a reviewed canonical profile publishes and moves the active pointer", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    const v2 = expectWrite(
      await repositories.imageStyles.createDraftVersion(SCOPE_A, {
        idempotencyKey: "draft:owned-documentary:v2",
        styleId: IDS.styleA,
        versionId: STYLE.lifecycleV2,
        versionNumber: 2,
      }),
    ).value;
    await attestDisclosure(repositories, IDS.styleA, v2);
    await seedAnalysisReferences(executor, IDS.styleA, STYLE.lifecycleV2, 24_200);
    const command = beginCommand(
      IDS.styleA,
      STYLE.lifecycleV2,
      22_000,
      "analysis:owned-documentary:v2:1",
    );
    const started = expectWrite(
      await repositories.imageStyles.beginAnalysis(SCOPE_A, command),
    ).value;

    expectFailure(
      await repositories.imageStyles.saveDraftVersion(SCOPE_A, {
        idempotencyKey: "save:forged-analyzing",
        styleId: IDS.styleA,
        versionId: STYLE.lifecycleV2,
        expectedUpdatedAt: started.version.updatedAt,
        nextState: "ANALYZING",
        profileDocument: null,
        analyzerRequestHash: started.version.analyzerRequestHash,
        analyzerModelSnapshot: started.version.analyzerModelSnapshot,
        disclosureAttestedByUserId: IDS.userA,
      }),
      "INVARIANT_VIOLATION",
      "INVALID_STATE_TRANSITION",
    );
    const malformedPayload = {};
    const invalidDocuments = [
      ["wrong-contract", { ...PROFILE_DOCUMENT, contractName: "image-style-profile-wrong" }],
      [
        "malformed-payload",
        {
          ...PROFILE_DOCUMENT,
          payload: malformedPayload,
          canonicalDocumentSha256: `sha256:${createHash("sha256")
            .update(canonicalizeJson(malformedPayload), "utf8")
            .digest("hex")}`,
        },
      ],
      ["drifted-hash", { ...PROFILE_DOCUMENT, canonicalDocumentSha256: sha256("drifted-profile") }],
    ];
    for (const [name, profileDocument] of invalidDocuments) {
      expectFailure(
        await repositories.imageStyles.saveDraftVersion(SCOPE_A, {
          idempotencyKey: `save:invalid-profile:${name}`,
          styleId: IDS.styleA,
          versionId: STYLE.lifecycleV2,
          expectedUpdatedAt: started.version.updatedAt,
          nextState: "NEEDS_REVIEW",
          profileDocument,
          analyzerRequestHash: started.version.analyzerRequestHash,
          analyzerModelSnapshot: started.version.analyzerModelSnapshot,
          disclosureAttestedByUserId: IDS.userA,
        }),
        "INVARIANT_VIOLATION",
        "IMAGE_STYLE_PROFILE_INVALID",
      );
    }
    const drifted = invalidDocuments[2][1];

    const reviewed = expectWrite(
      await repositories.imageStyles.saveDraftVersion(SCOPE_A, {
        idempotencyKey: "save:reviewed-profile",
        styleId: IDS.styleA,
        versionId: STYLE.lifecycleV2,
        expectedUpdatedAt: started.version.updatedAt,
        nextState: "NEEDS_REVIEW",
        profileDocument: PROFILE_DOCUMENT,
        analyzerRequestHash: started.version.analyzerRequestHash,
        analyzerModelSnapshot: started.version.analyzerModelSnapshot,
        disclosureAttestedByUserId: IDS.userA,
      }),
    ).value;
    assert.equal(reviewed.state, "NEEDS_REVIEW");
    assert.equal(
      expectValue(await repositories.imageStyles.resolveStyle(SCOPE_A, IDS.styleA)).activeVersionId,
      IDS.styleVersionA,
    );

    expectFailure(
      await repositories.imageStyles.publishVersion(SCOPE_A, {
        idempotencyKey: "publish:drifted-profile",
        styleId: IDS.styleA,
        versionId: STYLE.lifecycleV2,
        expectedUpdatedAt: reviewed.updatedAt,
        profileDocument: drifted,
        analyzerRequestHash: reviewed.analyzerRequestHash,
        analyzerModelSnapshot: reviewed.analyzerModelSnapshot,
        disclosureAttestedByUserId: IDS.userA,
        publishedAt: "2026-08-11T05:10:00.000Z",
      }),
      "INVARIANT_VIOLATION",
      "IMAGE_STYLE_PROFILE_INVALID",
    );
    const published = expectWrite(
      await repositories.imageStyles.publishVersion(SCOPE_A, {
        idempotencyKey: "publish:reviewed-profile",
        styleId: IDS.styleA,
        versionId: STYLE.lifecycleV2,
        expectedUpdatedAt: reviewed.updatedAt,
        profileDocument: PROFILE_DOCUMENT,
        analyzerRequestHash: reviewed.analyzerRequestHash,
        analyzerModelSnapshot: reviewed.analyzerModelSnapshot,
        disclosureAttestedByUserId: IDS.userA,
        publishedAt: "2026-08-11T05:10:00.000Z",
      }),
    ).value;
    assert.equal(published.state, "PUBLISHED");
    assert.equal(
      expectValue(await repositories.imageStyles.resolveStyle(SCOPE_A, IDS.styleA)).activeVersionId,
      STYLE.lifecycleV2,
    );
    assert.equal(
      expectValue(
        await repositories.imageStyles.resolveExactPublishedVersion(SCOPE_A, {
          styleId: IDS.styleA,
          versionId: IDS.styleVersionA,
          use: "HISTORICAL_LINEAGE",
        }),
      ).versionId,
      IDS.styleVersionA,
    );
    assert.deepEqual(
      expectValue(await repositories.imageStyles.listVersions(SCOPE_A, IDS.styleA)).map(
        (version) => [version.versionNumber, version.state],
      ),
      [
        [1, "PUBLISHED"],
        [2, "PUBLISHED"],
      ],
    );
  });
});

test("abandon is optimistic, immutable, and frees the one-open-version invariant", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    const v1 = await createStyleAndDraft(
      repositories,
      STYLE.lifecycle,
      STYLE.lifecycleV1,
      "Lifecycle Style",
    );
    expectFailure(
      await repositories.imageStyles.publishVersion(SCOPE_A, {
        idempotencyKey: "publish:draft",
        styleId: STYLE.lifecycle,
        versionId: STYLE.lifecycleV1,
        expectedUpdatedAt: v1.updatedAt,
        profileDocument: PROFILE_DOCUMENT,
        analyzerRequestHash: null,
        analyzerModelSnapshot: null,
        disclosureAttestedByUserId: IDS.userA,
        publishedAt: "2026-08-11T05:19:00.000Z",
      }),
      "INVARIANT_VIOLATION",
      "INVALID_STATE_TRANSITION",
    );
    expectFailure(
      await repositories.imageStyles.abandonVersion(SCOPE_A, {
        idempotencyKey: "abandon:stale",
        styleId: STYLE.lifecycle,
        versionId: STYLE.lifecycleV1,
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        abandonedAt: "2026-08-11T05:20:00.000Z",
      }),
      "CONFLICT",
      "EXPECTED_VERSION_MISMATCH",
    );
    const abandonCommand = {
      idempotencyKey: "abandon:lifecycle:v1",
      styleId: STYLE.lifecycle,
      versionId: STYLE.lifecycleV1,
      expectedUpdatedAt: v1.updatedAt,
      abandonedAt: "2026-08-11T05:20:00.000Z",
    };
    const abandoned = expectWrite(
      await repositories.imageStyles.abandonVersion(SCOPE_A, abandonCommand),
    );
    assert.equal(abandoned.value.state, "ABANDONED");
    assert.equal(
      expectWrite(await repositories.imageStyles.abandonVersion(SCOPE_A, abandonCommand)).replayed,
      true,
    );

    const v2 = expectWrite(
      await repositories.imageStyles.createDraftVersion(SCOPE_A, {
        idempotencyKey: "draft:lifecycle:v2",
        styleId: STYLE.lifecycle,
        versionId: STYLE.lifecycleV2,
        versionNumber: 2,
      }),
    ).value;
    assert.equal(v2.state, "DRAFT");
    expectFailure(
      await repositories.imageStyles.abandonVersion(SCOPE_A, {
        idempotencyKey: "abandon:published",
        styleId: IDS.styleA,
        versionId: IDS.styleVersionA,
        expectedUpdatedAt: expectValue(
          await repositories.imageStyles.resolveVersion(SCOPE_A, {
            styleId: IDS.styleA,
            versionId: IDS.styleVersionA,
          }),
        ).updatedAt,
        abandonedAt: "2026-08-11T05:21:00.000Z",
      }),
      "INVARIANT_VIOLATION",
      "IMMUTABLE_RECORD",
    );

    const disclosed = await attestDisclosure(repositories, STYLE.lifecycle, v2);
    await seedAnalysisReferences(executor, STYLE.lifecycle, STYLE.lifecycleV2, 24_300);
    const running = expectWrite(
      await repositories.imageStyles.beginAnalysis(
        SCOPE_A,
        beginCommand(STYLE.lifecycle, STYLE.lifecycleV2, 23_000, "analysis:lifecycle:v2:1"),
      ),
    ).value.version;
    assert.equal(disclosed.state, "DRAFT");
    expectFailure(
      await repositories.imageStyles.abandonVersion(SCOPE_A, {
        idempotencyKey: "abandon:running",
        styleId: STYLE.lifecycle,
        versionId: STYLE.lifecycleV2,
        expectedUpdatedAt: running.updatedAt,
        abandonedAt: "2026-08-11T05:22:00.000Z",
      }),
      "INVARIANT_VIOLATION",
      "INVALID_STATE_TRANSITION",
    );
  });
});
