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

test("durable timing and empty reference-contract migrations upgrade the five-migration baseline", async () => {
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
    assert.deepEqual(upgraded.appliedVersions, [6, 7, 8]);
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

    const replay = await applyMigrations(executor, sources);
    assert.deepEqual(replay.appliedVersions, []);
    assert.deepEqual(replay.alreadyAppliedVersions, [1, 2, 3, 4, 5, 6, 7, 8]);
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
    assert.deepEqual(upgraded.appliedVersions, [8]);
    assert.deepEqual(upgraded.alreadyAppliedVersions, [1, 2, 3, 4, 5, 6, 7]);
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
