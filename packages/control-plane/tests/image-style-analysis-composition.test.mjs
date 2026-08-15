import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DeterministicFixtureStyleAnalyzer,
  RunwareGeminiStyleAnalyzer,
} from "@videoforge/pipeline";

import { createPGliteControlPlaneRepositories } from "../dist/src/adapters/pglite-repositories.js";
import {
  DURABLE_STYLE_ANALYZER_MODEL,
  DURABLE_STYLE_ANALYZER_PROVIDER,
  DurableImageStyleAnalysisComposition,
  StyleAnalysisCompositionError,
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
const NOW = Date.parse("2026-08-11T04:00:00.000Z");

function writeValue(result) {
  assert.equal(result.ok, true);
  return result.value.value;
}

async function rejectsCode(action, code) {
  await assert.rejects(
    action,
    (error) => error instanceof StyleAnalysisCompositionError && error.code === code,
  );
}

class ObservedAnalyzer {
  constructor(action) {
    this.action = action;
    this.requests = [];
  }

  async analyze(request) {
    this.requests.push(request);
    return this.action(request);
  }
}

async function seedReferences(executor, styleId, versionId, serialBase) {
  const facts = [];
  for (let index = 0; index < 3; index += 1) {
    const originalAssetId = uuid(serialBase + index * 10);
    const normalizedAssetId = uuid(serialBase + index * 10 + 1);
    const referenceId = uuid(serialBase + index * 10 + 2);
    const originalHash = sha256(`composition-original:${serialBase}:${index}`);
    const derivativeSha256 = sha256(`composition-normalized:${serialBase}:${index}`);
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
        originalHash,
        derivativeSha256,
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
    facts.push({
      referenceId,
      normalizedAssetId,
      alias: `ref_${String(index + 1).padStart(2, "0")}`,
      derivativeSha256,
      mimeType: "image/webp",
      width: 1_024 + index,
      height: 768 + index,
      bytes: 4_000 + index,
    });
  }
  return facts;
}

async function provision(executor, repositories, serial, analyzer) {
  const styleId = uuid(serial);
  const versionId = uuid(serial + 1);
  const analysisAttemptId = uuid(serial + 2);
  const taskId = uuid(serial + 3);
  const executionAttemptId = uuid(serial + 4);
  const costEventId = uuid(serial + 5);
  const outboxId = uuid(serial + 6);
  writeValue(
    await repositories.imageStyles.createStyle(SCOPE_A, {
      idempotencyKey: `composition:create:${serial}`,
      styleId,
      name: `Composition ${serial}`,
      normalizedName: `composition ${serial}`,
    }),
  );
  const draft = writeValue(
    await repositories.imageStyles.createDraftVersion(SCOPE_A, {
      idempotencyKey: `composition:draft:${serial}`,
      styleId,
      versionId,
      versionNumber: 1,
    }),
  );
  writeValue(
    await repositories.imageStyles.saveDraftVersion(SCOPE_A, {
      idempotencyKey: `composition:disclosure:${serial}`,
      styleId,
      versionId,
      expectedUpdatedAt: draft.updatedAt,
      nextState: "DRAFT",
      profileDocument: null,
      analyzerRequestHash: null,
      analyzerModelSnapshot: null,
      disclosureAttestedByUserId: IDS.userA,
    }),
  );
  const referenceFacts = await seedReferences(executor, styleId, versionId, serial + 100);
  const service = new DurableImageStyleAnalysisComposition(repositories, analyzer);
  const prepareCommand = Object.freeze({
    styleId,
    versionId,
    analysisAttemptId,
    taskId,
    executionAttemptId,
    provider: DURABLE_STYLE_ANALYZER_PROVIDER,
    model: DURABLE_STYLE_ANALYZER_MODEL,
    modelRevision: MODEL_REVISION,
  });
  const prepared = await service.prepare(SCOPE_A, prepareCommand);
  const claimTokenHash = sha256(`composition:claim:${serial}`);
  const idempotencyKey = `composition:analysis:${serial}`;
  return {
    styleId,
    versionId,
    analysisAttemptId,
    taskId,
    executionAttemptId,
    referenceFacts,
    service,
    prepareCommand,
    prepared,
    claimTokenHash,
    beginCommand: {
      idempotencyKey,
      styleId,
      versionId,
      analysisAttemptId,
      requestHash: prepared.inputFingerprintHash,
      provider: DURABLE_STYLE_ANALYZER_PROVIDER,
      model: DURABLE_STYLE_ANALYZER_MODEL,
      modelRevision: MODEL_REVISION,
      reservation: {
        task: {
          taskId,
          owner: {
            ownerType: "IMAGE_STYLE_VERSION",
            ownerId: versionId,
            imageStyleVersionId: versionId,
          },
          taskKey: `style-analysis:${versionId}`,
          lane: "IMAGE",
          initialState: "READY",
          required: true,
          dependsOn: [],
        },
        attempt: {
          attemptId: executionAttemptId,
          ordinal: 1,
          idempotencyKey,
          executionProfileId: IDS.executionProfileA,
          executionClaimTokenHash: claimTokenHash,
          inputHash: prepared.inputFingerprintHash,
          parentAttemptId: null,
          fallbackReason: null,
        },
        costReservation: {
          costEventId,
          sequence: 1,
          amountMicroUsd: 80_000n,
          idempotencyKey: `${idempotencyKey}:cost`,
          details: { source: "vf-7-03-fixture" },
          occurredAt: FIXED_TIME,
        },
        dispatchOutbox: {
          outboxId,
          dedupeKey: `${idempotencyKey}:dispatch`,
          payloadContractName: "worker-job-envelope",
          payloadContractVersion: "v1",
          payloadHash: sha256(`${idempotencyKey}:payload`),
          payload: { attemptId: executionAttemptId, taskId },
          availableAt: FIXED_TIME,
        },
      },
    },
  };
}

async function begin(repositories, fixture, mutate = (value) => value) {
  return writeValue(
    await repositories.imageStyles.beginAnalysis(
      SCOPE_A,
      mutate(structuredClone(fixture.beginCommand)),
    ),
  );
}

async function acknowledgeAndClaim(repositories, fixture, started) {
  writeValue(
    await repositories.execution.recordDispatchAcknowledged(SCOPE_A, {
      idempotencyKey: `${fixture.beginCommand.idempotencyKey}:ack`,
      taskId: fixture.taskId,
      attemptId: fixture.executionAttemptId,
      externalJobId: `fixture-job-${fixture.taskId}`,
      providerDetails: { provider: "fixture" },
      acknowledgedAt: "2026-08-11T04:01:00.000Z",
    }),
  );
  writeValue(
    await repositories.execution.claimExecution(SCOPE_A, {
      idempotencyKey: `${fixture.beginCommand.idempotencyKey}:claim`,
      taskId: fixture.taskId,
      attemptId: fixture.executionAttemptId,
      presentedClaimTokenHash: fixture.claimTokenHash,
      expectedTaskVersion: started.reservation.task.version,
      claimedAt: "2026-08-11T04:02:00.000Z",
    }),
  );
}

function executeCommand(fixture) {
  return {
    styleId: fixture.styleId,
    versionId: fixture.versionId,
    analysisAttemptId: fixture.analysisAttemptId,
  };
}

test("prepares exact durable inputs and invokes the fixture analyzer only after claim", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    const fixtureAnalyzer = new DeterministicFixtureStyleAnalyzer();
    const analyzer = new ObservedAnalyzer((request) => fixtureAnalyzer.analyze(request));
    const fixture = await provision(executor, repositories, 31_000, analyzer);

    const replay = await fixture.service.prepare(SCOPE_A, fixture.prepareCommand);
    assert.deepEqual(replay, fixture.prepared);
    assert.equal(Object.isFrozen(fixture.prepared), true);
    assert.deepEqual(fixture.prepared.references, fixture.referenceFacts);
    assert.deepEqual(
      fixture.prepared.styleAnalyzerRequest.references,
      fixture.referenceFacts.map(({ alias, derivativeSha256, mimeType, width, height, bytes }) => ({
        alias,
        derivativeSha256,
        mimeType,
        width,
        height,
        bytes,
      })),
    );

    await rejectsCode(
      () => fixture.service.execute(SCOPE_A, executeCommand(fixture)),
      "DURABLE_STATE_INVALID",
    );
    assert.equal(analyzer.requests.length, 0);
    const started = await begin(repositories, fixture);
    await rejectsCode(
      () => fixture.service.execute(SCOPE_A, executeCommand(fixture)),
      "DURABLE_STATE_INVALID",
    );
    await rejectsCode(
      () => fixture.service.execute(SCOPE_B, executeCommand(fixture)),
      "REPOSITORY_FAILURE",
    );
    assert.equal(analyzer.requests.length, 0);

    await acknowledgeAndClaim(repositories, fixture, started);
    const candidate = await fixture.service.execute(SCOPE_A, executeCommand(fixture));
    assert.equal(analyzer.requests.length, 1);
    assert.equal(candidate.kind, "IMAGE_STYLE_ANALYSIS_COMPLETION_CANDIDATE");
    assert.equal(candidate.analyzerRequestHash, fixture.prepared.inputFingerprintHash);
    assert.equal(candidate.referenceSetHash, fixture.prepared.referenceSetHash);
    assert.equal(candidate.analysisAttemptId, fixture.analysisAttemptId);
    assert.equal(candidate.executionAttemptId, fixture.executionAttemptId);
    assert.equal(candidate.disclosureAttestedByUserId, IDS.userA);
    assert.equal(candidate.profileDocument.contractName, "image-style-profile");
    assert.equal(candidate.profileDocument.contractVersion, "v1");
    assert.match(candidate.profileDocument.canonicalDocumentSha256, /^sha256:[0-9a-f]{64}$/u);
    assert.match(candidate.analyzerOutputHash, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(Object.isFrozen(candidate), true);
    assert.equal("rawOutput" in candidate, false);
    assert.equal("providerOutput" in candidate, false);
  });
});

test("rejects durable state, owner, hash, and reference drift before analyzer invocation", async (context) => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);

    await context.test("state drift", async () => {
      const analyzer = new ObservedAnalyzer(() => ({}));
      const fixture = await provision(executor, repositories, 32_000, analyzer);
      const started = await begin(repositories, fixture);
      await acknowledgeAndClaim(repositories, fixture, started);
      writeValue(
        await repositories.imageStyles.saveDraftVersion(SCOPE_A, {
          idempotencyKey: "composition:state-drift",
          styleId: fixture.styleId,
          versionId: fixture.versionId,
          expectedUpdatedAt: started.version.updatedAt,
          nextState: "FAILED",
          profileDocument: null,
          analyzerRequestHash: started.version.analyzerRequestHash,
          analyzerModelSnapshot: started.version.analyzerModelSnapshot,
          disclosureAttestedByUserId: IDS.userA,
        }),
      );
      await rejectsCode(
        () => fixture.service.execute(SCOPE_A, executeCommand(fixture)),
        "DURABLE_STATE_INVALID",
      );
      assert.equal(analyzer.requests.length, 0);
    });

    await context.test("owner drift", async () => {
      const analyzer = new ObservedAnalyzer(() => ({}));
      const fixture = await provision(executor, repositories, 33_000, analyzer);
      const started = await begin(repositories, fixture);
      await acknowledgeAndClaim(repositories, fixture, started);
      const driftedRepositories = {
        ...repositories,
        execution: {
          ...repositories.execution,
          resolveTask: async (...args) => {
            const result = await repositories.execution.resolveTask(...args);
            if (!result.ok) return result;
            return {
              ...result,
              value: {
                ...result.value,
                owner: { ...result.value.owner, ownerId: fixture.styleId },
              },
            };
          },
        },
      };
      const service = new DurableImageStyleAnalysisComposition(driftedRepositories, analyzer);
      await rejectsCode(
        () => service.execute(SCOPE_A, executeCommand(fixture)),
        "DURABLE_STATE_INVALID",
      );
      assert.equal(analyzer.requests.length, 0);
    });

    await context.test("hash drift", async () => {
      const analyzer = new ObservedAnalyzer(() => ({}));
      const fixture = await provision(executor, repositories, 34_000, analyzer);
      const started = await begin(repositories, fixture, (command) => ({
        ...command,
        requestHash: sha256("composition:drifted-request"),
        reservation: {
          ...command.reservation,
          attempt: {
            ...command.reservation.attempt,
            inputHash: sha256("composition:drifted-request"),
          },
        },
      }));
      await acknowledgeAndClaim(repositories, fixture, started);
      await rejectsCode(
        () => fixture.service.execute(SCOPE_A, executeCommand(fixture)),
        "DURABLE_STATE_INVALID",
      );
      assert.equal(analyzer.requests.length, 0);
    });

    await context.test("general attempt input hash drift", async () => {
      const analyzer = new ObservedAnalyzer(() => ({}));
      const fixture = await provision(executor, repositories, 34_500, analyzer);
      const started = await begin(repositories, fixture, (command) => ({
        ...command,
        reservation: {
          ...command.reservation,
          attempt: {
            ...command.reservation.attempt,
            inputHash: sha256("composition:drifted-general-input"),
          },
        },
      }));
      await acknowledgeAndClaim(repositories, fixture, started);
      await rejectsCode(
        () => fixture.service.execute(SCOPE_A, executeCommand(fixture)),
        "DURABLE_STATE_INVALID",
      );
      assert.equal(analyzer.requests.length, 0);
    });

    await context.test("reference drift", async () => {
      const analyzer = new ObservedAnalyzer(() => ({}));
      const fixture = await provision(executor, repositories, 35_000, analyzer);
      const replacementId = uuid(35_500);
      await executor.query(
        `INSERT INTO assets (
           id, workspace_id, kind, state, binary_sha256, content_type,
           byte_size, width_px, height_px, verified_at
         ) VALUES ($1, $2, 'STYLE_REFERENCE_NORMALIZED', 'VERIFIED', $3,
           'image/webp', 4100, 1024, 768, $4)`,
        [replacementId, IDS.workspaceA, sha256("composition:replacement"), FIXED_TIME],
      );
      await executor.query(
        `UPDATE image_style_references SET normalized_asset_id = $1
         WHERE workspace_id = $2 AND id = $3`,
        [replacementId, IDS.workspaceA, fixture.referenceFacts[0].referenceId],
      );
      const started = await begin(repositories, fixture);
      await acknowledgeAndClaim(repositories, fixture, started);
      await rejectsCode(
        () => fixture.service.execute(SCOPE_A, executeCommand(fixture)),
        "DURABLE_STATE_INVALID",
      );
      assert.equal(analyzer.requests.length, 0);
    });
  });
});

test("rejects malformed analyzer output and opaque analyzer failure without a candidate", async (context) => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);

    await context.test("malformed output", async () => {
      const analyzer = new ObservedAnalyzer(() => ({}));
      const fixture = await provision(executor, repositories, 36_000, analyzer);
      const started = await begin(repositories, fixture);
      await acknowledgeAndClaim(repositories, fixture, started);
      await rejectsCode(
        () => fixture.service.execute(SCOPE_A, executeCommand(fixture)),
        "OUTPUT_INVALID",
      );
      assert.equal(analyzer.requests.length, 1);
    });

    await context.test("adapter failure", async () => {
      const analyzer = new ObservedAnalyzer(() => {
        throw new Error("private adapter detail");
      });
      const fixture = await provision(executor, repositories, 37_000, analyzer);
      const started = await begin(repositories, fixture);
      await acknowledgeAndClaim(repositories, fixture, started);
      await rejectsCode(
        () => fixture.service.execute(SCOPE_A, executeCommand(fixture)),
        "ANALYZER_FAILED",
      );
      assert.equal(analyzer.requests.length, 1);
    });
  });
});

test("composes the qualified Gemini adapter only through fake resolver and transport seams", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    const deterministic = new DeterministicFixtureStyleAnalyzer();
    const evidence = [];
    const transportRequests = [];
    let resolverCalls = 0;
    let analyzerInput;
    const analyzer = new RunwareGeminiStyleAnalyzer({
      referenceResolver: {
        resolve: async (references) => {
          resolverCalls += 1;
          analyzerInput = { analyzerVersion: "style-analyzer-v1", references };
          return references.map((reference) => ({
            alias: reference.alias,
            derivativeSha256: reference.derivativeSha256,
            imageUrl: `https://objects.example.test/private/${reference.alias}.webp?private_signature=never-record`,
            expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
          }));
        },
      },
      taskIdSource: { next: () => uuid(38_900) },
      clock: { nowMs: () => NOW },
      transport: {
        dispatch: async (request) => {
          transportRequests.push(request);
          assert.notEqual(analyzerInput, undefined);
          const output = await deterministic.analyze(analyzerInput);
          return {
            status: "succeeded",
            taskUUID: request.request.taskUUID,
            taskType: "textInference",
            outputText: JSON.stringify(output),
            latencyMs: 25,
            usage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
              reasoningTokens: 10,
            },
            costUsd: 0.03,
            finishReason: "stop",
            providerModel: null,
          };
        },
      },
      evidenceSink: { record: (item) => evidence.push(item) },
      maximumReferenceUrlLifetimeMs: 10 * 60_000,
    });
    const fixture = await provision(executor, repositories, 38_000, analyzer);
    const started = await begin(repositories, fixture);
    await acknowledgeAndClaim(repositories, fixture, started);
    const candidate = await fixture.service.execute(SCOPE_A, executeCommand(fixture));

    assert.equal(resolverCalls, 1);
    assert.equal(transportRequests.length, 1);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].validationDisposition, "accepted");
    assert.equal(candidate.profileDocument.contractName, "image-style-profile");
    const serializedEvidence = JSON.stringify(evidence);
    assert.equal(serializedEvidence.includes("private_signature"), false);
    assert.equal(serializedEvidence.includes("https://"), false);
    assert.equal(serializedEvidence.includes("PRIVATE_PROVIDER"), false);
  });
});

test("claimed composition survives database reopen without ambient I/O", async () => {
  const root = await mkdtemp(join(tmpdir(), "videoforge-style-composition-"));
  const dataDir = join(root, "pgdata");
  let context;
  try {
    context = await createMigratedDatabase(dataDir);
    await seedLockedProjects(context.executor);
    let repositories = createPGliteControlPlaneRepositories(context.executor);
    const deterministic = new DeterministicFixtureStyleAnalyzer();
    let analyzer = new ObservedAnalyzer((request) => deterministic.analyze(request));
    const fixture = await provision(context.executor, repositories, 39_000, analyzer);
    const started = await begin(repositories, fixture);
    await acknowledgeAndClaim(repositories, fixture, started);
    await context.database.close();
    context = undefined;

    context = await createMigratedDatabase(dataDir);
    repositories = createPGliteControlPlaneRepositories(context.executor);
    analyzer = new ObservedAnalyzer((request) => deterministic.analyze(request));
    const service = new DurableImageStyleAnalysisComposition(repositories, analyzer);
    const candidate = await service.execute(SCOPE_A, executeCommand(fixture));
    assert.equal(analyzer.requests.length, 1);
    assert.equal(candidate.analyzerRequestHash, fixture.prepared.inputFingerprintHash);

    const source = await readFile(
      new URL("../src/styles/durable-analysis.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "fetch(",
      "process.env",
      "node:fs",
      "readFile",
      "imageUrl",
      "objectKey",
    ])
      assert.equal(source.includes(forbidden), false, `composition source contains ${forbidden}`);
  } finally {
    if (context !== undefined) await context.database.close();
    await rm(root, { recursive: true, force: true });
  }
});
