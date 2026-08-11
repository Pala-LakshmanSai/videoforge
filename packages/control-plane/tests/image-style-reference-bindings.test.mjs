import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  exportMetadataSnapshot,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
} from "../dist/src/index.js";
import { createPGliteControlPlaneRepositories } from "../dist/src/adapters/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { createMigratedDatabase, FIXED_TIME, sha256, uuid } from "./support/pglite.mjs";

const SCOPE_A = Object.freeze({ workspaceId: IDS.workspaceA, actorUserId: IDS.userA });
const SCOPE_B = Object.freeze({ workspaceId: IDS.workspaceB, actorUserId: IDS.userB });
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

const STYLE = Object.freeze({
  ordered: uuid(25_001),
  orderedV1: uuid(25_002),
  invalid: uuid(25_010),
  invalidV1: uuid(25_011),
  nine: uuid(25_020),
  nineV1: uuid(25_021),
  locked: uuid(25_030),
  lockedV1: uuid(25_031),
  persistent: uuid(25_040),
  persistentV1: uuid(25_041),
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

async function createStyleDraft(repositories, styleId, versionId, name) {
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
      versionNumber: 1,
    }),
  ).value;
}

async function createArtifact(repositories, options) {
  const {
    assetId,
    kind,
    hash,
    contentType = "image/jpeg",
    width = 1024,
    height = 768,
    bytes = 900n,
    bind = true,
  } = options;
  expectWrite(
    await repositories.artifacts.registerMetadata(SCOPE_A, {
      idempotencyKey: `asset:${assetId}:metadata`,
      assetId,
      projectId: null,
      projectRevisionId: null,
      sourceAttemptId: null,
      kind,
      objectKey: null,
      contentType,
      metadata: { source: "vf-7-02-fixture" },
    }),
  );
  if (bind) {
    expectWrite(
      await repositories.artifacts.bindBinaryContent(SCOPE_A, {
        idempotencyKey: `asset:${assetId}:binary`,
        assetId,
        binarySha256: hash,
        byteSize: bytes,
        contentType,
        widthPx: width,
        heightPx: height,
        durationMs: null,
        verifiedAt: FIXED_TIME,
      }),
    );
  }
}

async function createArtifactPair(repositories, serial, options = {}) {
  const originalAssetId = uuid(serial);
  const normalizedAssetId = uuid(serial + 1);
  const originalHash = options.originalHash ?? sha256(`original:${serial}`);
  const normalizedHash = options.normalizedHash ?? sha256(`normalized:${serial}`);
  await createArtifact(repositories, {
    assetId: originalAssetId,
    kind: options.originalKind ?? "STYLE_REFERENCE_ORIGINAL",
    hash: originalHash,
    contentType: options.originalContentType,
    width: options.originalWidth,
    height: options.originalHeight,
    bytes: options.originalBytes,
    bind: options.bindOriginal,
  });
  await createArtifact(repositories, {
    assetId: normalizedAssetId,
    kind: options.normalizedKind ?? "STYLE_REFERENCE_NORMALIZED",
    hash: normalizedHash,
    contentType: options.normalizedContentType,
    width: options.normalizedWidth,
    height: options.normalizedHeight,
    bytes: options.normalizedBytes,
    bind: options.bindNormalized,
  });
  return { originalAssetId, normalizedAssetId, originalHash, normalizedHash };
}

function attachCommand(styleId, versionId, referenceId, referenceOrder, pair, overrides = {}) {
  return {
    idempotencyKey: overrides.idempotencyKey ?? `attach:${referenceId}`,
    referenceId,
    styleId,
    versionId,
    originalAssetId: pair.originalAssetId,
    normalizedAssetId: pair.normalizedAssetId,
    referenceOrder,
    rightsBasis: overrides.rightsBasis ?? "OWNED",
    rightsBasisNote: overrides.rightsBasisNote ?? null,
    rightsAttestedAt: overrides.rightsAttestedAt ?? FIXED_TIME,
    originalRetentionPolicy: overrides.originalRetentionPolicy ?? "RETAIN",
  };
}

async function attachReferences(repositories, styleId, versionId, count, serialBase) {
  const attached = [];
  for (let index = 0; index < count; index += 1) {
    const pair = await createArtifactPair(repositories, serialBase + index * 10);
    const command = attachCommand(
      styleId,
      versionId,
      uuid(serialBase + index * 10 + 2),
      index + 1,
      pair,
    );
    attached.push({
      pair,
      command,
      result: expectWrite(await repositories.imageStyles.attachReference(SCOPE_A, command)),
    });
  }
  return attached;
}

async function attestDisclosure(repositories, styleId, version) {
  return expectWrite(
    await repositories.imageStyles.saveDraftVersion(SCOPE_A, {
      idempotencyKey: `disclosure:${version.versionId}`,
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

function analysisCommand(styleId, versionId, serial) {
  const key = `analysis:${versionId}:1`;
  const taskId = uuid(serial);
  const attemptId = uuid(serial + 1);
  return {
    idempotencyKey: key,
    styleId,
    versionId,
    analysisAttemptId: uuid(serial + 4),
    requestHash: sha256(`${key}:request`),
    provider: "RUNWARE",
    model: "google:gemini@3.5-flash",
    modelRevision: "qualified-2026-08-11",
    reservation: {
      task: {
        taskId,
        owner: {
          ownerType: "IMAGE_STYLE_VERSION",
          ownerId: versionId,
          imageStyleVersionId: versionId,
        },
        taskKey: `style-analysis:${versionId}:1`,
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
        sequence: 1,
        amountMicroUsd: 80_000n,
        idempotencyKey: `${key}:cost`,
        details: { source: "vf-7-02-fixture" },
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
    },
  };
}

test("reference bindings are ordered, workspace scoped, rights-bound, and replay-safe", async () => {
  const context = await createMigratedDatabase();
  try {
    await seedLockedProjects(context.executor);
    const repositories = createPGliteControlPlaneRepositories(context.executor);
    await createStyleDraft(repositories, STYLE.ordered, STYLE.orderedV1, "Ordered Style");
    const pairs = [];
    for (const serial of [26_000, 26_010, 26_020]) {
      pairs.push(await createArtifactPair(repositories, serial));
    }
    const commands = [
      attachCommand(STYLE.ordered, STYLE.orderedV1, uuid(26_002), 3, pairs[2]),
      attachCommand(STYLE.ordered, STYLE.orderedV1, uuid(26_012), 1, pairs[0]),
      attachCommand(STYLE.ordered, STYLE.orderedV1, uuid(26_022), 2, pairs[1], {
        rightsBasis: "OTHER_DOCUMENTED_BASIS",
        rightsBasisNote: "Commissioned reference with processing permission",
        originalRetentionPolicy: "DELETE_AFTER_ANALYSIS",
      }),
    ];
    for (const command of commands) {
      const attached = expectWrite(
        await repositories.imageStyles.attachReference(SCOPE_A, command),
      );
      assert.equal(attached.value.rightsAttestedByUserId, IDS.userA);
    }
    const replay = expectWrite(
      await repositories.imageStyles.attachReference(SCOPE_A, commands[0]),
    );
    assert.equal(replay.replayed, true);
    expectFailure(
      await repositories.imageStyles.attachReference(SCOPE_A, {
        ...commands[0],
        referenceOrder: 4,
      }),
      "CONFLICT",
      "IDEMPOTENCY_KEY_REUSED",
    );

    const listed = expectValue(
      await repositories.imageStyles.listReferences(SCOPE_A, {
        styleId: STYLE.ordered,
        versionId: STYLE.orderedV1,
      }),
    );
    assert.deepEqual(
      listed.map((reference) => reference.referenceOrder),
      [1, 2, 3],
    );
    assert.equal(listed[1].rightsBasis, "OTHER_DOCUMENTED_BASIS");
    assert.equal(listed[1].originalRetentionPolicy, "DELETE_AFTER_ANALYSIS");
    expectFailure(
      await repositories.imageStyles.resolveReference(SCOPE_B, {
        styleId: STYLE.ordered,
        versionId: STYLE.orderedV1,
        referenceId: listed[0].referenceId,
      }),
      "NOT_FOUND",
      "IMAGE_STYLE_REFERENCE",
    );

    const analysis = expectValue(
      await repositories.imageStyles.resolveAnalysisReferenceSet(SCOPE_A, {
        styleId: STYLE.ordered,
        versionId: STYLE.orderedV1,
      }),
    );
    assert.deepEqual(
      analysis.map((reference) => reference.alias),
      ["ref_01", "ref_02", "ref_03"],
    );
    assert.deepEqual(
      analysis.map((reference) => reference.derivativeSha256),
      [pairs[0].normalizedHash, pairs[1].normalizedHash, pairs[2].normalizedHash],
    );
  } finally {
    await context.database.close();
  }
});

test("invalid rights, artifacts, collisions, and analysis-set sizes fail closed", async () => {
  const context = await createMigratedDatabase();
  try {
    await seedLockedProjects(context.executor);
    const repositories = createPGliteControlPlaneRepositories(context.executor);
    const draft = await createStyleDraft(
      repositories,
      STYLE.invalid,
      STYLE.invalidV1,
      "Invalid Style",
    );
    const attached = await attachReferences(
      repositories,
      STYLE.invalid,
      STYLE.invalidV1,
      2,
      27_000,
    );
    expectFailure(
      await repositories.imageStyles.resolveAnalysisReferenceSet(SCOPE_A, {
        styleId: STYLE.invalid,
        versionId: STYLE.invalidV1,
      }),
      "INVARIANT_VIOLATION",
      "IMAGE_STYLE_REFERENCE_SET_INVALID",
    );
    await attestDisclosure(repositories, STYLE.invalid, draft);
    const blocked = analysisCommand(STYLE.invalid, STYLE.invalidV1, 27_100);
    expectFailure(
      await repositories.imageStyles.beginAnalysis(SCOPE_A, blocked),
      "INVARIANT_VIOLATION",
      "IMAGE_STYLE_REFERENCE_SET_INVALID",
    );
    assert.equal(
      expectValue(
        await repositories.imageStyles.resolveVersion(SCOPE_A, {
          styleId: STYLE.invalid,
          versionId: STYLE.invalidV1,
        }),
      ).state,
      "DRAFT",
    );
    const rolledBack = await context.executor.query(
      `SELECT count(*)::int AS count FROM generation_tasks WHERE id = $1`,
      [blocked.reservation.task.taskId],
    );
    assert.equal(rolledBack.rows[0].count, 0);

    const duplicateHash = await createArtifactPair(repositories, 27_200, {
      normalizedHash: attached[0].pair.normalizedHash,
    });
    expectFailure(
      await repositories.imageStyles.attachReference(
        SCOPE_A,
        attachCommand(STYLE.invalid, STYLE.invalidV1, uuid(27_202), 3, duplicateHash),
      ),
      "CONFLICT",
      "IMAGE_STYLE_REFERENCE_CONFLICT",
    );
    const wrongKind = await createArtifactPair(repositories, 27_210, {
      originalKind: "IMAGE",
    });
    expectFailure(
      await repositories.imageStyles.attachReference(
        SCOPE_A,
        attachCommand(STYLE.invalid, STYLE.invalidV1, uuid(27_212), 3, wrongKind),
      ),
      "INVARIANT_VIOLATION",
      "IMAGE_STYLE_REFERENCE_INVALID",
    );
    const unverified = await createArtifactPair(repositories, 27_220, {
      bindNormalized: false,
    });
    expectFailure(
      await repositories.imageStyles.attachReference(
        SCOPE_A,
        attachCommand(STYLE.invalid, STYLE.invalidV1, uuid(27_222), 3, unverified),
      ),
      "INVARIANT_VIOLATION",
      "IMAGE_STYLE_REFERENCE_INVALID",
    );
    const oversized = await createArtifactPair(repositories, 27_230, {
      normalizedBytes: BigInt(MAX_REFERENCE_BYTES + 1),
    });
    expectFailure(
      await repositories.imageStyles.attachReference(
        SCOPE_A,
        attachCommand(STYLE.invalid, STYLE.invalidV1, uuid(27_232), 3, oversized),
      ),
      "INVARIANT_VIOLATION",
      "IMAGE_STYLE_REFERENCE_INVALID",
    );
    const invalidMedia = [
      ["unsupported-mime", 27_250, { normalizedContentType: "image/gif" }],
      ["too-small", 27_260, { originalWidth: 511 }],
      ["too-large", 27_270, { normalizedHeight: 16_385 }],
      ["empty", 27_280, { originalBytes: 0n }],
    ];
    for (const [label, serial, options] of invalidMedia) {
      const pair = await createArtifactPair(repositories, serial, options);
      expectFailure(
        await repositories.imageStyles.attachReference(
          SCOPE_A,
          attachCommand(STYLE.invalid, STYLE.invalidV1, uuid(serial + 2), 3, pair, {
            idempotencyKey: `attach:invalid-media:${label}`,
          }),
        ),
        "INVARIANT_VIOLATION",
        "IMAGE_STYLE_REFERENCE_INVALID",
      );
    }
    const validThird = await createArtifactPair(repositories, 27_240);
    const invalidCommands = [
      ["rights", { rightsBasis: "UNVERIFIED" }],
      ["retention", { originalRetentionPolicy: "ERASE_NOW" }],
      ["untrimmed-note", { rightsBasis: "OTHER_DOCUMENTED_BASIS", rightsBasisNote: " untrimmed" }],
      ["timestamp", { rightsAttestedAt: "not-a-timestamp" }],
    ];
    for (const [label, overrides] of invalidCommands) {
      expectFailure(
        await repositories.imageStyles.attachReference(
          SCOPE_A,
          attachCommand(STYLE.invalid, STYLE.invalidV1, uuid(27_242), 3, validThird, {
            ...overrides,
            idempotencyKey: `attach:invalid-command:${label}`,
          }),
        ),
        "INVARIANT_VIOLATION",
        "IMAGE_STYLE_REFERENCE_INVALID",
      );
    }
    expectFailure(
      await repositories.imageStyles.attachReference(
        SCOPE_A,
        attachCommand(STYLE.invalid, STYLE.invalidV1, uuid(27_242), 3, validThird, {
          rightsBasis: "OTHER_DOCUMENTED_BASIS",
        }),
      ),
      "INVARIANT_VIOLATION",
      "IMAGE_STYLE_REFERENCE_INVALID",
    );
    expectWrite(
      await repositories.imageStyles.attachReference(
        SCOPE_A,
        attachCommand(STYLE.invalid, STYLE.invalidV1, uuid(27_242), 3, validThird, {
          idempotencyKey: "attach:valid-third",
        }),
      ),
    );

    await createStyleDraft(repositories, STYLE.nine, STYLE.nineV1, "Nine Style");
    await attachReferences(repositories, STYLE.nine, STYLE.nineV1, 9, 27_300);
    assert.equal(
      expectValue(
        await repositories.imageStyles.listReferences(SCOPE_A, {
          styleId: STYLE.nine,
          versionId: STYLE.nineV1,
        }),
      ).length,
      9,
    );
    expectFailure(
      await repositories.imageStyles.resolveAnalysisReferenceSet(SCOPE_A, {
        styleId: STYLE.nine,
        versionId: STYLE.nineV1,
      }),
      "INVARIANT_VIOLATION",
      "IMAGE_STYLE_REFERENCE_SET_INVALID",
    );
  } finally {
    await context.database.close();
  }
});

test("detach frees an order before analysis and every binding locks after first attempt", async () => {
  const context = await createMigratedDatabase();
  try {
    await seedLockedProjects(context.executor);
    const repositories = createPGliteControlPlaneRepositories(context.executor);
    const draft = await createStyleDraft(
      repositories,
      STYLE.locked,
      STYLE.lockedV1,
      "Locked Style",
    );
    const attached = await attachReferences(repositories, STYLE.locked, STYLE.lockedV1, 3, 28_000);
    const detach = {
      idempotencyKey: "detach:locked:second",
      styleId: STYLE.locked,
      versionId: STYLE.lockedV1,
      referenceId: attached[1].command.referenceId,
    };
    const detached = expectWrite(await repositories.imageStyles.detachReference(SCOPE_A, detach));
    assert.equal(detached.value.referenceOrder, 2);
    assert.equal(
      expectWrite(await repositories.imageStyles.detachReference(SCOPE_A, detach)).replayed,
      true,
    );
    const replacementPair = await createArtifactPair(repositories, 28_100);
    const replacement = attachCommand(
      STYLE.locked,
      STYLE.lockedV1,
      uuid(28_102),
      2,
      replacementPair,
    );
    expectWrite(await repositories.imageStyles.attachReference(SCOPE_A, replacement));
    expectValue(
      await repositories.imageStyles.resolveAnalysisReferenceSet(SCOPE_A, {
        styleId: STYLE.locked,
        versionId: STYLE.lockedV1,
      }),
    );

    await attestDisclosure(repositories, STYLE.locked, draft);
    const started = expectWrite(
      await repositories.imageStyles.beginAnalysis(
        SCOPE_A,
        analysisCommand(STYLE.locked, STYLE.lockedV1, 28_200),
      ),
    ).value;
    assert.equal(started.version.state, "ANALYZING");
    const failed = expectWrite(
      await repositories.imageStyles.saveDraftVersion(SCOPE_A, {
        idempotencyKey: "analysis:locked:failed",
        styleId: STYLE.locked,
        versionId: STYLE.lockedV1,
        expectedUpdatedAt: started.version.updatedAt,
        nextState: "FAILED",
        profileDocument: null,
        analyzerRequestHash: started.version.analyzerRequestHash,
        analyzerModelSnapshot: started.version.analyzerModelSnapshot,
        disclosureAttestedByUserId: IDS.userA,
      }),
    ).value;
    assert.equal(failed.state, "FAILED");
    expectFailure(
      await repositories.imageStyles.detachReference(SCOPE_A, {
        idempotencyKey: "detach:locked:after-analysis",
        styleId: STYLE.locked,
        versionId: STYLE.lockedV1,
        referenceId: attached[0].command.referenceId,
      }),
      "INVARIANT_VIOLATION",
      "IMAGE_STYLE_REFERENCE_LOCKED",
    );
    const latePair = await createArtifactPair(repositories, 28_300);
    expectFailure(
      await repositories.imageStyles.attachReference(
        SCOPE_A,
        attachCommand(STYLE.locked, STYLE.lockedV1, uuid(28_302), 4, latePair),
      ),
      "INVARIANT_VIOLATION",
      "IMAGE_STYLE_REFERENCE_LOCKED",
    );
  } finally {
    await context.database.close();
  }
});

test("reference bindings survive database reopen and exact metadata restore", async () => {
  const root = await mkdtemp(join(tmpdir(), "videoforge-style-references-"));
  const dataDir = join(root, "pgdata");
  let source;
  let destination;
  try {
    source = await createMigratedDatabase(dataDir);
    await seedLockedProjects(source.executor);
    let repositories = createPGliteControlPlaneRepositories(source.executor);
    await createStyleDraft(
      repositories,
      STYLE.persistent,
      STYLE.persistentV1,
      "Persistent References",
    );
    await attachReferences(repositories, STYLE.persistent, STYLE.persistentV1, 3, 29_000);
    const serialized = serializeMetadataSnapshot(await exportMetadataSnapshot(source.executor));
    await source.database.close();
    source = undefined;

    source = await createMigratedDatabase(dataDir);
    repositories = createPGliteControlPlaneRepositories(source.executor);
    const reopened = expectValue(
      await repositories.imageStyles.resolveAnalysisReferenceSet(SCOPE_A, {
        styleId: STYLE.persistent,
        versionId: STYLE.persistentV1,
      }),
    );
    assert.deepEqual(
      reopened.map((reference) => reference.alias),
      ["ref_01", "ref_02", "ref_03"],
    );

    destination = await createMigratedDatabase();
    const restored = await restoreMetadataSnapshot(destination.executor, serialized);
    assert.equal(restored.alreadyRestored, false);
    const restoredRepositories = createPGliteControlPlaneRepositories(destination.executor);
    assert.deepEqual(
      expectValue(
        await restoredRepositories.imageStyles.resolveAnalysisReferenceSet(SCOPE_A, {
          styleId: STYLE.persistent,
          versionId: STYLE.persistentV1,
        }),
      ),
      reopened,
    );
  } finally {
    if (source !== undefined) await source.database.close();
    if (destination !== undefined) await destination.database.close();
    await rm(root, { recursive: true, force: true });
  }
});
