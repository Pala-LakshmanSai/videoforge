import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  applyMigrations,
  MIGRATION_TABLE_NAME,
  RELATIONAL_TABLE_NAMES,
} from "../dist/src/index.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  expectDatabaseError,
  FIXED_TIME,
  loadMigrationSources,
  PGliteExecutor,
  sha256,
  uuid,
} from "./support/pglite.mjs";

test("a fresh PGlite database applies the committed migration chain idempotently", async () => {
  const database = new PGlite();
  try {
    const executor = new PGliteExecutor(database);
    const sources = await loadMigrationSources();
    const versions = sources.map((source) => source.version);

    const first = await applyMigrations(executor, sources);
    assert.deepEqual(first.appliedVersions, versions);
    assert.deepEqual(first.alreadyAppliedVersions, []);

    const second = await applyMigrations(executor, sources);
    assert.deepEqual(second.appliedVersions, []);
    assert.deepEqual(second.alreadyAppliedVersions, versions);

    const inventory = await executor.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name`,
    );
    assert.deepEqual(
      inventory.rows.map((row) => row.table_name),
      [...RELATIONAL_TABLE_NAMES, MIGRATION_TABLE_NAME].sort(),
    );
  } finally {
    await database.close();
  }
});

test("global-session vNext upgrades the complete legacy chain without rewriting legacy rows", async () => {
  const database = new PGlite();
  try {
    const executor = new PGliteExecutor(database);
    const sources = await loadMigrationSources();
    await executor.execute(
      `CREATE TABLE public.videoforge_schema_migrations (
         version integer PRIMARY KEY CHECK (version > 0),
         name text NOT NULL CHECK (name ~ '^[a-z0-9_]+$'),
         filename text NOT NULL UNIQUE,
         sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    for (const migration of sources.slice(0, 13)) {
      await executor.execute(migration.sql);
      await executor.query(
        `INSERT INTO videoforge_schema_migrations (version, name, filename, sha256)
         VALUES ($1, $2, $3, $4)`,
        [migration.version, migration.name, migration.filename, migration.sha256],
      );
    }
    await seedLockedProjects(executor);
    const before = await executor.query(
      `SELECT id, workspace_id, owner_user_id, name, normalized_name, status, version,
              created_at, updated_at, archived_at
         FROM projects ORDER BY id`,
    );

    const upgraded = await applyMigrations(executor, sources);

    assert.deepEqual(upgraded.appliedVersions, [14, 15]);
    assert.deepEqual(
      upgraded.alreadyAppliedVersions,
      Array.from({ length: 13 }, (_, index) => index + 1),
    );
    const after = await executor.query(
      `SELECT id, workspace_id, owner_user_id, name, normalized_name, status, version,
              created_at, updated_at, archived_at
         FROM projects ORDER BY id`,
    );
    assert.deepEqual(after.rows, before.rows);
    const vNextRows = await executor.query(
      `SELECT
         (SELECT count(*)::text FROM generation_sessions) AS sessions,
         (SELECT count(*)::text FROM global_queue_entries) AS queue_entries,
         (SELECT count(*)::text FROM pod_lifecycle_attempts) AS pod_attempts`,
    );
    assert.deepEqual(vNextRows.rows, [{ sessions: "0", queue_entries: "0", pod_attempts: "0" }]);
  } finally {
    await database.close();
  }
});

test("later durable migrations upgrade the five-migration baseline", async () => {
  const database = new PGlite();
  try {
    const executor = new PGliteExecutor(database);
    const sources = await loadMigrationSources();
    await executor.execute(
      `CREATE TABLE public.videoforge_schema_migrations (
         version integer PRIMARY KEY CHECK (version > 0),
         name text NOT NULL CHECK (name ~ '^[a-z0-9_]+$'),
         filename text NOT NULL UNIQUE,
         sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    for (const migration of sources.slice(0, 5)) {
      await executor.execute(migration.sql);
      await executor.query(
        `INSERT INTO videoforge_schema_migrations (version, name, filename, sha256)
         VALUES ($1, $2, $3, $4)`,
        [migration.version, migration.name, migration.filename, migration.sha256],
      );
    }
    await seedLockedProjects(executor);

    const documentId = uuid(31_001);
    const transcriptId = uuid(31_002);
    const wordId = uuid(31_003);
    const segmentId = uuid(31_004);
    const documentHash = sha256("legacy-transcript-document");
    await executor.query(
      `INSERT INTO assets (
         id, workspace_id, kind, state, canonical_contract_name,
         canonical_contract_version, canonical_document_sha256, verified_at
       ) VALUES ($1, $2, 'CANONICAL_DOCUMENT', 'VERIFIED',
                 'transcript-timing', 'v1', $3, $4)`,
      [documentId, IDS.workspaceA, documentHash, FIXED_TIME],
    );
    await executor.query(
      `INSERT INTO transcripts (
         id, workspace_id, project_revision_id, source_asset_id, state,
         model_name, model_hash, duration_ms, contract_name, contract_version,
         canonical_document_asset_id, canonical_document_hash, ready_at, created_at
       ) VALUES ($1, $2, $3, $4, 'READY', 'legacy-fixture', $5, 12000,
                 'transcript-timing', 'v1', $6, $7, $8, $8)`,
      [
        transcriptId,
        IDS.workspaceA,
        IDS.revisionA,
        IDS.voiceoverA,
        sha256("legacy-model"),
        documentId,
        documentHash,
        FIXED_TIME,
      ],
    );
    await executor.query(
      `INSERT INTO transcript_words (
         id, workspace_id, transcript_id, word_index, word, start_ms, end_ms_exclusive
       ) VALUES ($1, $2, $3, 0, 'legacy', 0, 12000)`,
      [wordId, IDS.workspaceA, transcriptId],
    );
    await executor.query(
      `INSERT INTO timeline_segments (
         id, workspace_id, project_revision_id, segment_index, start_frame,
         end_frame_exclusive, timeline_composition, in_image_shot_role,
         narration, required_slots, timeline_plan_hash, created_at
       ) VALUES ($1, $2, $3, 0, 0, 360, 'AVATAR_FULL', NULL,
                 'Legacy segment', '{}'::jsonb, $4, $5)`,
      [segmentId, IDS.workspaceA, IDS.revisionA, HASHES.revisionA, FIXED_TIME],
    );

    const upgraded = await applyMigrations(executor, sources);
    assert.deepEqual(upgraded.appliedVersions, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.deepEqual(upgraded.alreadyAppliedVersions, [1, 2, 3, 4, 5]);
    const legacy = await executor.query(
      `SELECT transcript.lineage_contract_version, transcript.input_fingerprint_hash,
              segment.timeline_plan_id, segment.segment_key
         FROM transcripts transcript
         JOIN timeline_segments segment
           ON segment.workspace_id = transcript.workspace_id
          AND segment.project_revision_id = transcript.project_revision_id
        WHERE transcript.id = $1 AND segment.id = $2`,
      [transcriptId, segmentId],
    );
    assert.deepEqual(legacy.rows, [
      {
        lineage_contract_version: null,
        input_fingerprint_hash: null,
        timeline_plan_id: null,
        segment_key: null,
      },
    ]);

    const styleRoot = await executor.query(
      `SELECT version.root_profile_artifact_id, version.current_profile_artifact_id,
              version.profile_revision, artifact.origin, artifact.profile_hash
         FROM image_style_versions version
         JOIN image_style_profile_artifacts artifact
           ON artifact.workspace_id = version.workspace_id
          AND artifact.id = version.root_profile_artifact_id
        WHERE version.id = $1`,
      [IDS.styleVersionA],
    );
    assert.deepEqual(styleRoot.rows, []);

    const replay = await applyMigrations(executor, sources);
    assert.deepEqual(replay.appliedVersions, []);
    assert.deepEqual(
      replay.alreadyAppliedVersions,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    );
  } finally {
    await database.close();
  }
});

test("reference-contract migration upgrades a clean seven-migration database", async () => {
  const database = new PGlite();
  try {
    const executor = new PGliteExecutor(database);
    const sources = await loadMigrationSources();
    await executor.execute(
      `CREATE TABLE public.videoforge_schema_migrations (
         version integer PRIMARY KEY CHECK (version > 0),
         name text NOT NULL CHECK (name ~ '^[a-z0-9_]+$'),
         filename text NOT NULL UNIQUE,
         sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    for (const migration of sources.slice(0, 7)) {
      await executor.execute(migration.sql);
      await executor.query(
        `INSERT INTO videoforge_schema_migrations (version, name, filename, sha256)
         VALUES ($1, $2, $3, $4)`,
        [migration.version, migration.name, migration.filename, migration.sha256],
      );
    }

    const upgraded = await applyMigrations(executor, sources);
    assert.deepEqual(upgraded.appliedVersions, [8, 9, 10, 11, 12, 13, 14, 15]);
    assert.deepEqual(upgraded.alreadyAppliedVersions, [1, 2, 3, 4, 5, 6, 7]);
  } finally {
    await database.close();
  }
});

test("style artifact migration backfills only accepted analyzer profiles as immutable roots", async () => {
  const database = new PGlite();
  try {
    const executor = new PGliteExecutor(database);
    const sources = await loadMigrationSources();
    await executor.execute(
      `CREATE TABLE public.videoforge_schema_migrations (
         version integer PRIMARY KEY CHECK (version > 0),
         name text NOT NULL CHECK (name ~ '^[a-z0-9_]+$'),
         filename text NOT NULL UNIQUE,
         sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    for (const migration of sources.slice(0, 9)) {
      await executor.execute(migration.sql);
      await executor.query(
        `INSERT INTO videoforge_schema_migrations (version, name, filename, sha256)
         VALUES ($1, $2, $3, $4)`,
        [migration.version, migration.name, migration.filename, migration.sha256],
      );
    }
    await seedLockedProjects(executor);

    const styleId = uuid(31_200);
    const versionId = uuid(31_201);
    const taskId = uuid(31_202);
    const attemptId = uuid(31_203);
    const costId = uuid(31_204);
    const outboxId = uuid(31_205);
    const analysisId = uuid(31_206);
    const outputAssetId = uuid(31_207);
    const requestHash = sha256("migration-10-analysis-request");
    await executor.execute("BEGIN");
    await executor.query(
      `INSERT INTO image_styles (
         id, workspace_id, name, normalized_name, created_by_user_id, created_at, updated_at
       ) VALUES ($1, $2, 'Accepted migration style', 'accepted migration style', $3, $4, $4)`,
      [styleId, IDS.workspaceA, IDS.userA, FIXED_TIME],
    );
    await executor.query(
      `INSERT INTO image_style_versions (
         id, workspace_id, style_id, version_number, state,
         profile_contract_name, profile_contract_version, profile_payload, style_profile_hash,
         analyzer_request_hash, analyzer_model_snapshot, disclosure_attested_by_user_id,
         created_at, updated_at
       )
       SELECT $1, $2, $3, 1, 'NEEDS_REVIEW', profile_contract_name,
              profile_contract_version, profile_payload, style_profile_hash,
              $4, 'fixture-model-snapshot', $5, $6, $6
         FROM image_style_versions WHERE id = $7`,
      [versionId, IDS.workspaceA, styleId, requestHash, IDS.userA, FIXED_TIME, IDS.styleVersionA],
    );
    await executor.query(
      `INSERT INTO assets (
         id, workspace_id, kind, state, object_key, binary_sha256,
         canonical_contract_name, canonical_contract_version, canonical_document_sha256,
         content_type, byte_size, verified_at
       ) VALUES ($1, $2, 'CANONICAL_DOCUMENT', 'ACCEPTED', $3, $4,
                 'image-style-profile', 'v1', $4, 'application/json', 100, $5)`,
      [
        outputAssetId,
        IDS.workspaceA,
        "workspace/migration/style-root.json",
        HASHES.styleA,
        FIXED_TIME,
      ],
    );
    await executor.query(
      `INSERT INTO generation_tasks (
         id, workspace_id, owner_type, owner_id, image_style_version_id,
         task_key, lane, state, created_at, updated_at
       ) VALUES ($1, $2, 'IMAGE_STYLE_VERSION', $3, $3,
                 'migration-style-analysis', 'IMAGE', 'RUNNING', $4, $4)`,
      [taskId, IDS.workspaceA, versionId, FIXED_TIME],
    );
    await executor.query(
      `INSERT INTO attempts (
         id, workspace_id, task_id, ordinal, idempotency_key, state, dispatch_state,
         claim_state, execution_profile_id, execution_claim_token_hash, input_hash,
         output_asset_id, result_disposition, provider_details, claimed_at, started_at, finished_at
       ) VALUES ($1, $2, $3, 1, 'migration-style-attempt', 'SUCCEEDED', 'ACKNOWLEDGED',
                 'CLAIMED', $4, $5, $6, $7, 'ACCEPTED', '{}'::jsonb, $8, $8, $8)`,
      [
        attemptId,
        IDS.workspaceA,
        taskId,
        IDS.executionProfileA,
        sha256("migration-10-claim"),
        requestHash,
        outputAssetId,
        FIXED_TIME,
      ],
    );
    await executor.query(
      `INSERT INTO cost_events (
         id, workspace_id, owner_type, owner_id, task_id, attempt_id, sequence,
         event_type, amount_micro_usd, idempotency_key, details, occurred_at
       ) VALUES ($1, $2, 'IMAGE_STYLE_VERSION', $3, $4, $5, 1,
                 'RESERVED', 0, 'migration-style-reserve', '{}'::jsonb, $6)`,
      [costId, IDS.workspaceA, versionId, taskId, attemptId, FIXED_TIME],
    );
    await executor.query(
      `INSERT INTO outbox (
         id, workspace_id, task_id, attempt_id, kind, state, dedupe_key,
         payload_contract_name, payload_contract_version, payload_hash, payload,
         available_at, delivered_at
       ) VALUES ($1, $2, $3, $4, 'DISPATCH', 'DELIVERED', 'migration-style-dispatch',
                 'style-analysis', 'v1', $5, '{}'::jsonb, $6, $6)`,
      [outboxId, IDS.workspaceA, taskId, attemptId, sha256("migration-10-outbox"), FIXED_TIME],
    );
    await executor.query(
      `INSERT INTO image_style_analysis_attempts (
         id, workspace_id, style_version_id, ordinal, idempotency_key, request_hash,
         state, provider, model, model_revision, response_hash, usage_payload,
         reported_cost_micro_usd, task_id, execution_attempt_id,
         reservation_cost_event_id, outbox_id, started_at, finished_at
       ) VALUES ($1, $2, $3, 1, 'migration-style-analysis', $4,
                 'SUCCEEDED', 'fixture', 'fixture-style', 'v1', $5, '{}'::jsonb,
                 0, $6, $7, $8, $9, $10, $10)`,
      [
        analysisId,
        IDS.workspaceA,
        versionId,
        requestHash,
        sha256("migration-10-response"),
        taskId,
        attemptId,
        costId,
        outboxId,
        FIXED_TIME,
      ],
    );
    await executor.query(
      `UPDATE generation_tasks
          SET state = 'COMPLETE', accepted_attempt_id = $3, finished_at = $4, updated_at = $4
        WHERE workspace_id = $1 AND id = $2`,
      [IDS.workspaceA, taskId, attemptId, FIXED_TIME],
    );
    await executor.execute("COMMIT");

    const upgraded = await applyMigrations(executor, sources);
    assert.deepEqual(upgraded.appliedVersions, [10, 11, 12, 13, 14, 15]);
    const root = await executor.query(
      `SELECT version.root_profile_artifact_id, version.current_profile_artifact_id,
              version.profile_revision, artifact.origin, artifact.profile_hash,
              artifact.source_analysis_attempt_id, artifact.source_analysis_output_asset_id,
              artifact.source_analysis_evidence
         FROM image_style_versions version
         JOIN image_style_profile_artifacts artifact
           ON artifact.workspace_id = version.workspace_id
          AND artifact.id = version.root_profile_artifact_id
        WHERE version.id = $1`,
      [versionId],
    );
    assert.deepEqual(root.rows, [
      {
        root_profile_artifact_id: versionId,
        current_profile_artifact_id: versionId,
        profile_revision: 1,
        origin: "VISION_ANALYSIS",
        profile_hash: HASHES.styleA,
        source_analysis_attempt_id: analysisId,
        source_analysis_output_asset_id: outputAssetId,
        source_analysis_evidence: "HISTORICAL_SOURCE_TRUTH",
      },
    ]);
    await expectDatabaseError(
      () => executor.query("DELETE FROM image_style_profile_artifacts WHERE id = $1", [versionId]),
      "23514",
    );
  } finally {
    await database.close();
  }
});

test("reference-contract migration refuses to invent rights facts for legacy rows", async () => {
  const database = new PGlite();
  try {
    const executor = new PGliteExecutor(database);
    const sources = await loadMigrationSources();
    for (const migration of sources.slice(0, 7)) await executor.execute(migration.sql);
    await seedLockedProjects(executor);
    await executor.query(
      `INSERT INTO image_style_references (
         id, workspace_id, style_id, version_id, asset_id,
         reference_order, rights_attested_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, 1, $6)`,
      [uuid(31_100), IDS.workspaceA, IDS.styleA, IDS.styleVersionA, IDS.outputA1, IDS.userA],
    );

    await expectDatabaseError(() => executor.execute(sources[7].sql), "23514");
    const columns = await executor.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'image_style_references'
       ORDER BY ordinal_position`,
    );
    assert.ok(columns.rows.some((row) => row.column_name === "asset_id"));
    assert.equal(
      columns.rows.some((row) => row.column_name === "original_asset_id"),
      false,
    );
  } finally {
    await database.close();
  }
});
