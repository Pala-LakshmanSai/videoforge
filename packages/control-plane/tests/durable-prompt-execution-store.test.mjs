import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { canonicalizeJson } from "@videoforge/contracts";

import {
  applyMigrations,
  DurableFixturePromptWriter,
  DurablePromptExecutionService,
  exportMetadataSnapshot,
  PGlitePromptExecutionStore,
  PromptExecutionError,
  promptExecutionInputHash,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
} from "../dist/src/index.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  createMigratedDatabase,
  FIXED_TIME,
  loadMigrationSources,
  PGliteExecutor,
  sha256,
  uuid,
} from "./support/pglite.mjs";

const TIMELINE_ID = uuid(41_001);
const TRANSCRIPT_ID = uuid(41_002);
const TRANSCRIPT_ASSET_ID = uuid(41_003);
const TIMELINE_ASSET_ID = uuid(41_004);
const TASK_ID = uuid(41_005);
const ATTEMPT_ID = uuid(41_006);
const OUTBOX_ID = uuid(41_007);
const RESERVATION_ID = uuid(41_008);
const CLAIM_HASH = sha256("prompt-store-claim");
const TIMELINE_HASH = sha256("prompt-store-timeline");
const TRANSCRIPT_HASH = sha256("prompt-store-transcript");
const TRANSCRIPT_INPUT_HASH = sha256("prompt-store-transcript-input");
const TIMELINE_INPUT_HASH = sha256("prompt-store-timeline-input");
const SCOPE = Object.freeze({
  accountId: IDS.accountA,
  workspaceId: IDS.workspaceA,
  actorUserId: IDS.userA,
});

const STYLE_PROFILE = Object.freeze({
  prompt_profile: Object.freeze({
    planner_guidance: "Write literal observational evidence.",
    positive_suffix: "authentic observational documentary photography",
    negative_suffix: "illustration, CGI, visible text",
    full_image_guidance: "16:9 center-safe evidence",
    split_image_guidance: "8:9 evidence centered in the right-hand panel",
  }),
});

const command = (overrides = {}) =>
  Object.freeze({
    projectId: IDS.projectA,
    revisionId: IDS.revisionA,
    timelineId: TIMELINE_ID,
    taskId: TASK_ID,
    attemptId: ATTEMPT_ID,
    outboxId: OUTBOX_ID,
    presentedClaimTokenHash: CLAIM_HASH,
    ...overrides,
  });

class FixedClock {
  now() {
    return FIXED_TIME;
  }
}

function deterministicUuid(label) {
  const bytes = createHash("sha256").update(label, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function initializePromptInputHash(executor) {
  const store = new PGlitePromptExecutionStore(executor);
  const initial = await store.resolve(SCOPE, command());
  assert.notEqual(initial, null);
  await executor.query(
    `UPDATE public.attempts SET input_hash = $4
      WHERE workspace_id = $1 AND task_id = $2 AND id = $3`,
    [IDS.workspaceA, TASK_ID, ATTEMPT_ID, promptExecutionInputHash(initial)],
  );
}

async function seedPromptAuthority(executor, { initializeInputHash = true } = {}) {
  await executor.transaction(async (transaction) => {
    await seedLockedProjects(transaction, { styleAProfilePayload: STYLE_PROFILE });
    await transaction.query(
      `INSERT INTO public.assets (
         id, workspace_id, project_id, project_revision_id, kind, state, object_key,
         canonical_contract_name, canonical_contract_version, canonical_document_sha256,
         content_type, byte_size, verified_at
       ) VALUES
         ($1, $2, $3, $4, 'CANONICAL_DOCUMENT', 'VERIFIED', $5,
          'transcript-timing', 'v1', $6, 'application/json', 1024, $7),
         ($8, $2, $3, $4, 'CANONICAL_DOCUMENT', 'VERIFIED', $9,
          'timeline-plan', 'v1', $10, 'application/json', 2048, $7)`,
      [
        TRANSCRIPT_ASSET_ID,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        "workspace/prompt/transcript.json",
        TRANSCRIPT_HASH,
        FIXED_TIME,
        TIMELINE_ASSET_ID,
        "workspace/prompt/timeline.json",
        TIMELINE_HASH,
      ],
    );
    await transaction.query(
      `INSERT INTO public.transcripts (
         id, workspace_id, project_revision_id, source_asset_id, state, model_name, model_hash,
         duration_ms, contract_name, contract_version, canonical_document_asset_id,
         canonical_document_hash, created_at, ready_at, lineage_contract_version,
         source_binary_sha256, engine_name, engine_version, language,
         transcription_config_hash, input_fingerprint_hash, idempotency_key
       ) VALUES ($1, $2, $3, $4, 'READY', 'fixture-base-en', $5, 75000,
                 'transcript-timing', 'v1', $6, $7, $8, $8, 'timing-lineage/v1',
                 $9, 'fixture', '1.0.0', 'en', $10, $11, 'prompt-transcript-v1')`,
      [
        TRANSCRIPT_ID,
        IDS.workspaceA,
        IDS.revisionA,
        IDS.voiceoverA,
        sha256("prompt-model"),
        TRANSCRIPT_ASSET_ID,
        TRANSCRIPT_HASH,
        FIXED_TIME,
        HASHES.voiceoverA,
        sha256("prompt-transcription-config"),
        TRANSCRIPT_INPUT_HASH,
      ],
    );
    for (let index = 0; index < 25; index += 1) {
      const start = index * 3000;
      const end = start + 3000;
      const wordId = uuid(41_100 + index);
      const sentenceId = uuid(41_200 + index);
      await transaction.query(
        `INSERT INTO public.transcript_words (
           id, workspace_id, transcript_id, word_index, word, start_ms, end_ms_exclusive, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [wordId, IDS.workspaceA, TRANSCRIPT_ID, index, `phrase-${index}`, start, end, FIXED_TIME],
      );
      await transaction.query(
        `INSERT INTO public.transcript_sentences (
           id, workspace_id, transcript_id, sentence_key, sentence_index, word_start,
           word_end_exclusive, start_ms, end_ms_exclusive, text, created_at
         ) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10)`,
        [
          sentenceId,
          IDS.workspaceA,
          TRANSCRIPT_ID,
          `sentence-${index}`,
          index,
          index + 1,
          start,
          end,
          `Literal narration phrase ${index + 1}`,
          FIXED_TIME,
        ],
      );
      await transaction.query(
        `INSERT INTO public.transcript_phrases (
           id, workspace_id, transcript_id, sentence_id, phrase_key, phrase_index,
           word_start, word_end_exclusive, start_ms, end_ms_exclusive,
           pause_before_ms, pause_after_ms, text, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, 0, 0, $10, $11)`,
        [
          uuid(41_300 + index),
          IDS.workspaceA,
          TRANSCRIPT_ID,
          sentenceId,
          `phrase-${index}`,
          index,
          index + 1,
          start,
          end,
          `Literal narration phrase ${index + 1}`,
          FIXED_TIME,
        ],
      );
    }
    await transaction.query(
      `INSERT INTO public.timeline_plans (
         id, workspace_id, project_revision_id, transcript_id, plan_sequence,
         revision_config_hash, transcript_document_hash, scheduler_version,
         scheduler_config_hash, seed, input_fingerprint_hash, contract_name,
         contract_version, canonical_document_asset_id, canonical_document_hash,
         output_fps_num, output_fps_den, total_frames, idempotency_key,
         created_by_user_id, created_at
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, 'fixture-scheduler-v1', $7, 42, $8,
                 'timeline-plan', 'v1', $9, $10, 30, 1, 2250,
                 'prompt-timeline-v1', $11, $12)`,
      [
        TIMELINE_ID,
        IDS.workspaceA,
        IDS.revisionA,
        TRANSCRIPT_ID,
        HASHES.revisionA,
        TRANSCRIPT_HASH,
        sha256("prompt-scheduler-config"),
        TIMELINE_INPUT_HASH,
        TIMELINE_ASSET_ID,
        TIMELINE_HASH,
        IDS.userA,
        FIXED_TIME,
      ],
    );
    const roles = [
      "ENVIRONMENTAL_WIDE",
      "HUMAN_MEDIUM",
      "HANDS_ACTION",
      "OBJECT_EVIDENCE",
      "MACRO_DETAIL",
      "REACTION_RESULT",
    ];
    for (let index = 0; index < 25; index += 1) {
      await transaction.query(
        `INSERT INTO public.timeline_segments (
           id, workspace_id, project_revision_id, segment_index, start_frame,
           end_frame_exclusive, timeline_composition, in_image_shot_role, narration,
           required_slots, timeline_plan_hash, created_at, timeline_plan_id, segment_key,
           source_audio_start_ms, source_audio_end_ms_exclusive, word_start, word_end_exclusive
         ) VALUES ($1, $2, $3, $4, $5, $6, 'IMAGE_FULL', $7, $8, $9::jsonb,
                   $10, $11, $12, $13, $14, $15, $4, $16)`,
        [
          uuid(41_400 + index),
          IDS.workspaceA,
          IDS.revisionA,
          index,
          index * 90,
          (index + 1) * 90,
          roles[index % roles.length],
          `Literal narration phrase ${index + 1}`,
          JSON.stringify({ image: { task_key: `image-${index}` } }),
          TIMELINE_HASH,
          FIXED_TIME,
          TIMELINE_ID,
          `scene-${String(index + 1).padStart(3, "0")}`,
          index * 3000,
          (index + 1) * 3000,
          index + 1,
        ],
      );
    }
    await transaction.query(
      `INSERT INTO public.revision_timing_heads (
         workspace_id, project_revision_id, version, current_transcript_id,
         current_timeline_plan_id, transcript_input_fingerprint_hash,
         timeline_input_fingerprint_hash, updated_at
       ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7)`,
      [
        IDS.workspaceA,
        IDS.revisionA,
        TRANSCRIPT_ID,
        TIMELINE_ID,
        TRANSCRIPT_INPUT_HASH,
        TIMELINE_INPUT_HASH,
        FIXED_TIME,
      ],
    );
    await transaction.query(
      `INSERT INTO public.generation_tasks (
         id, workspace_id, owner_type, owner_id, project_revision_id,
         task_key, lane, state, created_at, updated_at
       ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $3,
                 'prompt:batch:001', 'PROMPT', 'RUNNING', $4, $4)`,
      [TASK_ID, IDS.workspaceA, IDS.revisionA, FIXED_TIME],
    );
    await transaction.query(
      `INSERT INTO public.attempts (
         id, workspace_id, task_id, ordinal, idempotency_key, state, dispatch_state,
         claim_state, execution_profile_id, execution_claim_token_hash, input_hash,
         claimed_at, started_at
       ) VALUES ($1, $2, $3, 1, 'prompt-attempt-001', 'CLAIMED', 'ACKNOWLEDGED',
                 'CLAIMED', $4, $5, $6, $7, $7)`,
      [
        ATTEMPT_ID,
        IDS.workspaceA,
        TASK_ID,
        IDS.executionProfileA,
        CLAIM_HASH,
        sha256("prompt-input-placeholder"),
        FIXED_TIME,
      ],
    );
    await transaction.query(
      `INSERT INTO public.cost_events (
         id, workspace_id, owner_type, owner_id, task_id, attempt_id, sequence,
         event_type, amount_micro_usd, idempotency_key, details, occurred_at
       ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $4, $5, 1,
                 'RESERVED', 100, 'prompt-reservation-001', '{}'::jsonb, $6)`,
      [RESERVATION_ID, IDS.workspaceA, IDS.revisionA, TASK_ID, ATTEMPT_ID, FIXED_TIME],
    );
    await transaction.query(
      `INSERT INTO public.outbox (
         id, workspace_id, task_id, attempt_id, kind, state, dedupe_key,
         payload_contract_name, payload_contract_version, payload_hash, payload,
         available_at, delivered_at
       ) VALUES ($1, $2, $3, $4, 'DISPATCH', 'DELIVERED', 'prompt-dispatch-001',
                 'prompt-dispatch', 'v1', $5, $6::jsonb, $7, $7)`,
      [
        OUTBOX_ID,
        IDS.workspaceA,
        TASK_ID,
        ATTEMPT_ID,
        sha256("prompt-outbox"),
        JSON.stringify({ continuity_tags: ["same_place", "daylight"] }),
        FIXED_TIME,
      ],
    );
  });
  if (initializeInputHash) await initializePromptInputHash(executor);
}

async function execute(executor, writer = new DurableFixturePromptWriter()) {
  return new DurablePromptExecutionService(
    new PGlitePromptExecutionStore(executor),
    writer,
    { record() {} },
    new FixedClock(),
  ).execute(SCOPE, command());
}

async function rejectsCode(action, expected) {
  await assert.rejects(
    action,
    (error) => error instanceof PromptExecutionError && error.code === expected,
  );
}

test("production PGlite store atomically accepts exact authority and replays without writer", async () => {
  const context = await createMigratedDatabase();
  try {
    await seedPromptAuthority(context.executor);
    const first = await execute(context.executor);
    assert.equal(first.replayed, false);
    assert.equal(first.accepted.compiledPrompts.length, 25);
    let writerCalls = 0;
    const replay = await execute(context.executor, {
      operation: "qualified_fake.write",
      async write() {
        writerCalls += 1;
        throw new Error("writer must not run on replay");
      },
    });
    assert.equal(replay.replayed, true);
    assert.equal(writerCalls, 0);
    assert.equal(canonicalizeJson(replay.accepted), canonicalizeJson(first.accepted));

    const state = await context.executor.query(
      `SELECT
         (SELECT count(*)::int FROM prompt_executions) AS executions,
         (SELECT count(*)::int FROM prompt_writer_attempts) AS writer_attempts,
         (SELECT count(*)::int FROM prompt_scene_results) AS scenes,
         (SELECT count(*)::int FROM cost_events WHERE attempt_id = $1) AS costs,
         task.state AS task_state, task.accepted_attempt_id,
         attempt.state AS attempt_state, attempt.result_disposition,
         asset.state AS asset_state
       FROM generation_tasks task
       JOIN attempts attempt ON attempt.workspace_id = task.workspace_id AND attempt.id = $1
       JOIN assets asset ON asset.workspace_id = attempt.workspace_id
                        AND asset.id = attempt.output_asset_id
      WHERE task.workspace_id = $2 AND task.id = $3`,
      [ATTEMPT_ID, IDS.workspaceA, TASK_ID],
    );
    assert.deepEqual(state.rows[0], {
      executions: 1,
      writer_attempts: 1,
      scenes: 25,
      costs: 3,
      task_state: "COMPLETE",
      accepted_attempt_id: ATTEMPT_ID,
      attempt_state: "SUCCEEDED",
      result_disposition: "ACCEPTED",
      asset_state: "ACCEPTED",
    });
  } finally {
    await context.database.close();
  }
});

test("store rejects stale claim, cancellation, and cross-workspace access before writer", async () => {
  const context = await createMigratedDatabase();
  try {
    await seedPromptAuthority(context.executor);
    let calls = 0;
    const service = new DurablePromptExecutionService(
      new PGlitePromptExecutionStore(context.executor),
      {
        operation: "qualified_fake.write",
        async write() {
          calls += 1;
          throw new Error("must not run");
        },
      },
      { record() {} },
      new FixedClock(),
    );
    await rejectsCode(
      () => service.execute(SCOPE, command({ presentedClaimTokenHash: sha256("stale") })),
      "CLAIM_STALE",
    );
    await rejectsCode(
      () =>
        service.execute(
          { accountId: IDS.accountB, workspaceId: IDS.workspaceB, actorUserId: IDS.userB },
          command(),
        ),
      "REPOSITORY_FAILURE",
    );
    await context.executor.query(
      `UPDATE generation_tasks SET state = 'CANCEL_REQUESTED', cancel_requested_at = $3
        WHERE workspace_id = $1 AND id = $2`,
      [IDS.workspaceA, TASK_ID, FIXED_TIME],
    );
    await rejectsCode(() => service.execute(SCOPE, command()), "CANCELLED");
    assert.equal(calls, 0);
  } finally {
    await context.database.close();
  }
});

test("cost drift and storage conflict roll back every acceptance mutation", async () => {
  for (const mode of ["cost", "storage"]) {
    const context = await createMigratedDatabase();
    try {
      await seedPromptAuthority(context.executor);
      if (mode === "storage") {
        await context.executor.query(
          `INSERT INTO assets (id, workspace_id, kind, state, canonical_contract_name,
                               canonical_contract_version, canonical_document_sha256, verified_at)
           VALUES ($1, $2, 'CANONICAL_DOCUMENT', 'VERIFIED', 'conflict', 'v1', $3, $4)`,
          [
            deterministicUuid(`prompt-output:${ATTEMPT_ID}`),
            IDS.workspaceA,
            sha256("conflict"),
            FIXED_TIME,
          ],
        );
      }
      const fixture = new DurableFixturePromptWriter();
      const writer =
        mode === "cost"
          ? {
              operation: "qualified_fake.write",
              async write(batch) {
                const result = await fixture.write(batch);
                return {
                  ...result,
                  attempts: [{ ...result.attempts[0], reportedCostMicroUsd: 101 }],
                };
              },
            }
          : fixture;
      await rejectsCode(
        () => execute(context.executor, writer),
        mode === "cost" ? "COST_MISMATCH" : "REPOSITORY_FAILURE",
      );
      const rows = await context.executor.query(
        `SELECT
           (SELECT count(*)::int FROM prompt_executions) AS executions,
           (SELECT count(*)::int FROM cost_events WHERE attempt_id = $1) AS costs,
           (SELECT state FROM generation_tasks WHERE id = $2) AS task_state`,
        [ATTEMPT_ID, TASK_ID],
      );
      assert.deepEqual(rows.rows[0], { executions: 0, costs: 1, task_state: "RUNNING" });
    } finally {
      await context.database.close();
    }
  }
});

test("accepted prompt authority survives metadata restore and fresh-process replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "videoforge-prompt-store-"));
  const destinationPath = join(root, "destination");
  const source = await createMigratedDatabase();
  let destination = await createMigratedDatabase(destinationPath);
  try {
    await seedPromptAuthority(source.executor);
    const first = await execute(source.executor);
    const serialized = serializeMetadataSnapshot(await exportMetadataSnapshot(source.executor));
    await restoreMetadataSnapshot(destination.executor, serialized);
    await destination.database.close();
    destination = await createMigratedDatabase(destinationPath);
    let calls = 0;
    const replay = await execute(destination.executor, {
      operation: "qualified_fake.write",
      async write() {
        calls += 1;
        throw new Error("restored replay must not execute writer");
      },
    });
    assert.equal(replay.replayed, true);
    assert.equal(calls, 0);
    assert.equal(canonicalizeJson(replay.accepted), canonicalizeJson(first.accepted));
  } finally {
    await source.database.close();
    await destination.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("migrations 0009-0017 upgrade live migration-0008 prompt authority and execute", async () => {
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
    for (const migration of sources.slice(0, 8)) {
      await executor.execute(migration.sql);
      await executor.query(
        `INSERT INTO videoforge_schema_migrations (version, name, filename, sha256)
         VALUES ($1, $2, $3, $4)`,
        [migration.version, migration.name, migration.filename, migration.sha256],
      );
    }
    await seedPromptAuthority(executor, { initializeInputHash: false });
    const upgraded = await applyMigrations(executor, sources);
    assert.deepEqual(upgraded.appliedVersions, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    await initializePromptInputHash(executor);
    const result = await execute(executor);
    assert.equal(result.replayed, false);
  } finally {
    await database.close();
  }
});
