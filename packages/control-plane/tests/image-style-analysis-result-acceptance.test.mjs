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
  ImageStyleAnalysisResultAcceptanceError,
  prepareDurableImageStyleAnalysisSuccess,
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
const COMPLETED_AT = "2026-08-11T04:06:00.000Z";
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
  constructor(mismatch = null) {
    this.mismatch = mismatch;
    this.objects = new Map();
    this.calls = 0;
  }

  async putIfAbsent(write) {
    this.calls += 1;
    const actualHash = `sha256:${createHash("sha256").update(write.bytes).digest("hex")}`;
    assert.equal(actualHash, write.binarySha256);
    const existing = this.objects.get(write.objectKey);
    if (existing !== undefined && !Buffer.from(existing).equals(Buffer.from(write.bytes))) {
      throw new Error("immutable object conflict");
    }
    this.objects.set(write.objectKey, Uint8Array.from(write.bytes));
    return {
      objectKey: this.mismatch === "key" ? `${write.objectKey}.wrong` : write.objectKey,
      binarySha256: this.mismatch === "hash" ? sha256("wrong-object") : write.binarySha256,
      byteSize: BigInt(write.bytes.byteLength) + (this.mismatch === "size" ? 1n : 0n),
      replayed: existing !== undefined,
    };
  }
}

class CountingAnalyzer {
  constructor() {
    this.delegate = new DeterministicFixtureStyleAnalyzer();
    this.calls = 0;
  }

  async analyze(request) {
    this.calls += 1;
    return this.delegate.analyze(request);
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
        sha256(`accept-original:${serialBase}:${index}`),
        sha256(`accept-normalized:${serialBase}:${index}`),
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

async function provision(executor, repositories, serial) {
  const ids = {
    styleId: uuid(serial),
    versionId: uuid(serial + 1),
    analysisAttemptId: uuid(serial + 2),
    taskId: uuid(serial + 3),
    executionAttemptId: uuid(serial + 4),
    reservationCostEventId: uuid(serial + 5),
    outboxId: uuid(serial + 6),
  };
  writeValue(
    await repositories.imageStyles.createStyle(SCOPE_A, {
      idempotencyKey: `accept:create:${serial}`,
      styleId: ids.styleId,
      name: `Acceptance ${serial}`,
      normalizedName: `acceptance ${serial}`,
    }),
  );
  const draft = writeValue(
    await repositories.imageStyles.createDraftVersion(SCOPE_A, {
      idempotencyKey: `accept:draft:${serial}`,
      styleId: ids.styleId,
      versionId: ids.versionId,
      versionNumber: 1,
    }),
  );
  writeValue(
    await repositories.imageStyles.saveDraftVersion(SCOPE_A, {
      idempotencyKey: `accept:disclosure:${serial}`,
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
  const analyzer = new CountingAnalyzer();
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
  const claimTokenHash = sha256(`accept:claim:${serial}`);
  const logicalKey = `accept:analysis:${serial}`;
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
          details: { source: "vf-7-04-synthetic" },
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
      acknowledgedAt: "2026-08-11T04:01:00.000Z",
    }),
  );
  writeValue(
    await repositories.execution.claimExecution(SCOPE_A, {
      idempotencyKey: `${logicalKey}:claim`,
      taskId: ids.taskId,
      attemptId: ids.executionAttemptId,
      presentedClaimTokenHash: claimTokenHash,
      expectedTaskVersion: started.reservation.task.version,
      claimedAt: "2026-08-11T04:02:00.000Z",
    }),
  );
  const candidate = await composition.execute(SCOPE_A, {
    styleId: ids.styleId,
    versionId: ids.versionId,
    analysisAttemptId: ids.analysisAttemptId,
  });
  assert.equal(analyzer.calls, 1);
  return { ...ids, candidate, analyzer };
}

function acceptanceCommand(fixture, overrides = {}) {
  return {
    completionCandidate: overrides.completionCandidate ?? fixture.candidate,
    usageSummary: overrides.usageSummary ?? USAGE,
    reportedCostMicroUsd: overrides.reportedCostMicroUsd ?? 0n,
    costEvents: overrides.costEvents ?? [
      {
        costEventId: uuid(overrides.serialBase ?? 900_001),
        sequence: 2,
        eventType: "REPORTED",
        amountMicroUsd: 0n,
        idempotencyKey: `accept:cost:reported:${fixture.analysisAttemptId}`,
        occurredAt: "2026-08-11T04:03:00.000Z",
      },
      {
        costEventId: uuid((overrides.serialBase ?? 900_001) + 1),
        sequence: 3,
        eventType: "SETTLED",
        amountMicroUsd: 0n,
        idempotencyKey: `accept:cost:settled:${fixture.analysisAttemptId}`,
        occurredAt: "2026-08-11T04:04:00.000Z",
      },
      {
        costEventId: uuid((overrides.serialBase ?? 900_001) + 2),
        sequence: 4,
        eventType: "REFUNDED",
        amountMicroUsd: 80_000n,
        idempotencyKey: `accept:cost:refund:${fixture.analysisAttemptId}`,
        occurredAt: "2026-08-11T04:05:00.000Z",
      },
    ],
    completedAt: overrides.completedAt ?? COMPLETED_AT,
  };
}

async function rejectsAcceptance(action, code) {
  await assert.rejects(
    action,
    (error) => error instanceof ImageStyleAnalysisResultAcceptanceError && error.code === code,
  );
}

async function assertUnchanged(executor, fixture) {
  const version = await executor.query(
    "SELECT state, profile_payload FROM image_style_versions WHERE id = $1",
    [fixture.versionId],
  );
  assert.deepEqual(version.rows, [{ state: "ANALYZING", profile_payload: null }]);
  const specialized = await executor.query(
    `SELECT state, response_hash, usage_payload, reported_cost_micro_usd
       FROM image_style_analysis_attempts WHERE id = $1`,
    [fixture.analysisAttemptId],
  );
  assert.deepEqual(specialized.rows, [
    {
      state: "CREATED",
      response_hash: null,
      usage_payload: null,
      reported_cost_micro_usd: null,
    },
  ]);
  const task = await executor.query(
    "SELECT state, accepted_attempt_id FROM generation_tasks WHERE id = $1",
    [fixture.taskId],
  );
  assert.deepEqual(task.rows, [{ state: "RUNNING", accepted_attempt_id: null }]);
  const general = await executor.query(
    "SELECT state, result_disposition, output_asset_id FROM attempts WHERE id = $1",
    [fixture.executionAttemptId],
  );
  assert.deepEqual(general.rows, [
    { state: "CLAIMED", result_disposition: "PENDING", output_asset_id: null },
  ]);
}

test("accepts and replays one canonical Image Style result across database reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "videoforge-style-result-"));
  const dataDir = join(root, "pgdata");
  const store = new MemoryCanonicalStore();
  let context;
  try {
    context = await createMigratedDatabase(dataDir);
    await seedLockedProjects(context.executor);
    let repositories = createPGliteControlPlaneRepositories(context.executor);
    const fixture = await provision(context.executor, repositories, 51_000);
    const command = acceptanceCommand(fixture, { serialBase: 910_001 });
    let service = new DurableImageStyleAnalysisResultAcceptance(repositories, store);
    const accepted = await service.accept(SCOPE_A, command);
    assert.equal(accepted.ok, true, diagnostic(accepted));
    assert.equal(accepted.value.replayed, false);
    assert.equal(accepted.value.result.version.state, "NEEDS_REVIEW");
    assert.equal(accepted.value.result.analysisAttempt.state, "SUCCEEDED");
    assert.equal(
      accepted.value.result.analysisAttempt.responseHash,
      fixture.candidate.analyzerOutputHash,
    );
    assert.deepEqual(accepted.value.result.analysisAttempt.usagePayload, USAGE);
    assert.equal(accepted.value.result.analysisAttempt.reportedCostMicroUsd, 0n);
    assert.equal(accepted.value.acceptedAttempt.completion, "ACCEPTED");
    assert.equal(accepted.value.artifact.kind, "CANONICAL_DOCUMENT");
    assert.equal(accepted.value.artifact.sourceAttemptId, fixture.executionAttemptId);
    assert.equal(
      accepted.value.artifact.canonicalDocumentSha256,
      fixture.candidate.profileDocument.canonicalDocumentSha256,
    );
    assert.equal(accepted.value.cost.reservedMicroUsd, 80_000n);
    assert.equal(accepted.value.cost.reportedMicroUsd, 0n);
    assert.equal(accepted.value.cost.settledMicroUsd, 0n);
    assert.equal(accepted.value.cost.refundedMicroUsd, 80_000n);
    assert.equal(accepted.value.cost.activeReservationMicroUsd, 0n);
    const stored = store.objects.get(accepted.value.canonicalDocumentObjectKey);
    assert.notEqual(stored, undefined);
    assert.equal(
      new TextDecoder().decode(stored),
      canonicalizeJson(fixture.candidate.profileDocument.payload),
    );
    assert.equal(fixture.analyzer.calls, 1);

    const persisted = await context.executor.query(
      `SELECT asset.metadata, attempt.provider_details, analysis.usage_payload
         FROM assets asset
         JOIN attempts attempt ON attempt.id = asset.source_attempt_id
         JOIN image_style_analysis_attempts analysis
           ON analysis.execution_attempt_id = attempt.id
        WHERE asset.id = $1`,
      [accepted.value.artifact.assetId],
    );
    const serialized = JSON.stringify(persisted.rows);
    for (const forbidden of ["https://", "signed", "private", "raw_output", "provider_output"]) {
      assert.equal(serialized.toLowerCase().includes(forbidden), false, forbidden);
    }

    await context.database.close();
    context = undefined;
    context = await createMigratedDatabase(dataDir);
    repositories = createPGliteControlPlaneRepositories(context.executor);
    service = new DurableImageStyleAnalysisResultAcceptance(repositories, store);
    const replay = await service.accept(SCOPE_A, command);
    assert.equal(replay.ok, true, diagnostic(replay));
    assert.equal(replay.value.replayed, true);
    assert.equal(store.objects.size, 1);
    assert.equal(fixture.analyzer.calls, 1);
  } finally {
    if (context !== undefined) await context.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects malformed, cross-workspace, drifted, and unclaimed candidates before storage", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    const fixture = await provision(executor, repositories, 52_000);
    const store = new MemoryCanonicalStore();
    const service = new DurableImageStyleAnalysisResultAcceptance(repositories, store);
    const base = acceptanceCommand(fixture, { serialBase: 920_001 });

    await rejectsAcceptance(
      () =>
        service.accept(SCOPE_A, {
          ...base,
          completionCandidate: { ...fixture.candidate, unknown: true },
        }),
      "CANDIDATE_INVALID",
    );
    await rejectsAcceptance(
      () =>
        service.accept(SCOPE_A, {
          ...base,
          completionCandidate: {
            ...fixture.candidate,
            profileDocument: {
              ...fixture.candidate.profileDocument,
              payload: { ...fixture.candidate.profileDocument.payload, summary: "drifted" },
            },
          },
        }),
      "CANDIDATE_INVALID",
    );
    await rejectsAcceptance(
      () => service.accept(SCOPE_A, { ...base, usageSummary: { ...USAGE, total_tokens: 1 } }),
      "USAGE_INVALID",
    );
    await rejectsAcceptance(() => service.accept(SCOPE_B, base), "CANDIDATE_INVALID");
    await rejectsAcceptance(
      () =>
        service.accept(SCOPE_A, {
          ...base,
          completionCandidate: {
            ...fixture.candidate,
            referenceSetHash: sha256("drifted-reference-set"),
          },
        }),
      "DURABLE_STATE_INVALID",
    );
    assert.equal(store.calls, 0);

    await executor.query(
      `UPDATE attempts
          SET state = 'CREATED', claim_state = 'UNCLAIMED', claimed_at = NULL, started_at = NULL
        WHERE id = $1`,
      [fixture.executionAttemptId],
    );
    await rejectsAcceptance(() => service.accept(SCOPE_A, base), "DURABLE_STATE_INVALID");
    assert.equal(store.calls, 0);
  });
});

test("object mismatch and incomplete cost settlement cannot partially mutate durable state", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);

    const objectFixture = await provision(executor, repositories, 53_000);
    const mismatchStore = new MemoryCanonicalStore("hash");
    const mismatchService = new DurableImageStyleAnalysisResultAcceptance(
      repositories,
      mismatchStore,
    );
    await rejectsAcceptance(
      () =>
        mismatchService.accept(SCOPE_A, acceptanceCommand(objectFixture, { serialBase: 930_001 })),
      "OBJECT_STORE_MISMATCH",
    );
    await assertUnchanged(executor, objectFixture);

    const rollbackFixture = await provision(executor, repositories, 54_000);
    const store = new MemoryCanonicalStore();
    const service = new DurableImageStyleAnalysisResultAcceptance(repositories, store);
    const valid = acceptanceCommand(rollbackFixture, { serialBase: 940_001 });
    const incomplete = { ...valid, costEvents: valid.costEvents.slice(0, 2) };
    const failed = await service.accept(SCOPE_A, incomplete);
    assert.equal(failed.ok, false);
    assert.equal(failed.kind, "INVARIANT_VIOLATION");
    assert.equal(failed.code, "INVALID_MONEY");
    await assertUnchanged(executor, rollbackFixture);
    const artifactCount = await executor.query(
      "SELECT count(*)::int AS count FROM assets WHERE source_attempt_id = $1",
      [rollbackFixture.executionAttemptId],
    );
    assert.equal(artifactCount.rows[0].count, 0);
    const costCount = await executor.query(
      "SELECT count(*)::int AS count FROM cost_events WHERE attempt_id = $1",
      [rollbackFixture.executionAttemptId],
    );
    assert.equal(costCount.rows[0].count, 1);
    assert.equal(store.objects.size, 1);

    const retried = await service.accept(SCOPE_A, valid);
    assert.equal(retried.ok, true, diagnostic(retried));
    assert.equal(retried.value.result.version.state, "NEEDS_REVIEW");
  });
});

test("artifact identity drift rolls back result, cost, and lifecycle mutations", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    const fixture = await provision(executor, repositories, 55_000);
    const command = acceptanceCommand(fixture, { serialBase: 950_001 });
    const prepared = await prepareDurableImageStyleAnalysisSuccess(SCOPE_A, command);
    await executor.query(
      `INSERT INTO assets (id, workspace_id, kind, state, object_key, metadata)
       VALUES ($1, $2, 'OTHER', 'UPLOADING', $3, '{"drifted":true}'::jsonb)`,
      [prepared.outputAssetId, IDS.workspaceA, "workspace/drifted/object.bin"],
    );
    const service = new DurableImageStyleAnalysisResultAcceptance(
      repositories,
      new MemoryCanonicalStore(),
    );
    const failed = await service.accept(SCOPE_A, command);
    assert.equal(failed.ok, false);
    assert.equal(failed.kind, "CONFLICT");
    await assertUnchanged(executor, fixture);
    const costCount = await executor.query(
      "SELECT count(*)::int AS count FROM cost_events WHERE attempt_id = $1",
      [fixture.executionAttemptId],
    );
    assert.equal(costCount.rows[0].count, 1);
  });
});

test("acceptance source has no analyzer, credential, environment, or network capability", async () => {
  const source = await readFile(
    new URL("../src/styles/durable-analysis-result.ts", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    ".analyze(",
    "fetch(",
    "process.env",
    "node:fs",
    "imageUrl",
    "signedUrl",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
