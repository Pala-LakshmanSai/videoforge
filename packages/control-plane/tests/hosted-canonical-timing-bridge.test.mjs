import assert from "node:assert/strict";
import test from "node:test";

import {
  exportMetadataSnapshot,
  prepareDurableDeterministicTimeline,
  prepareDurableLocalTranscription,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
  trustedTenantActorScope,
  trustedTenantScope,
} from "../dist/src/index.js";
import { validateAndHashContractDocument } from "../../contracts/dist/src/index.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  createMigratedDatabase,
  expectDatabaseError,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

const SIGNATURE =
  "public.videoforge_append_hosted_canonical_timing(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)";
const FINISHED = "2026-08-25T12:00:00.000Z";

function revisionConfig() {
  return {
    schema_version: "project-revision-config/v2",
    project_id: IDS.projectA,
    project_revision_id: IDS.revisionA,
    title: "Owned Revision A",
    voiceover_asset_id: IDS.voiceoverA,
    voiceover_sha256: HASHES.voiceoverA,
    avatar_binding: {
      avatar_profile_id: IDS.avatarProfileA,
      avatar_profile_version_id: IDS.avatarVersionA,
      avatar_display_name_snapshot: "Owned Avatar A",
      avatar_profile_hash: HASHES.avatarProfileA,
      runtime_source_asset_id: IDS.avatarRuntimeA,
      runtime_source_sha256: HASHES.avatarRuntimeA,
      source_preparation_version: "owned-preparation-v1",
      source_validation_profile_version: "owned-validation-v1",
      compatibility_state_at_preflight: "UNTESTED",
      compatibility_evidence: null,
    },
    optional_script: null,
    image_style_version_id: IDS.styleVersionA,
    style_profile_hash: HASHES.styleA,
    extra_prompt_keywords: "",
    apply_extra_prompt_keywords: false,
    generation_mode: "LOWEST_COST",
    execution_profiles: {
      image_media_profile_id: "serverless-mage-image-v1",
      avatar_primary_profile_id: "serverless-soulx-flashhead-pro-v1",
      avatar_repair_profile_id: null,
      avatar_quality_profile_id: null,
    },
    spend_cap_usd: 1.5,
    scheduler_version: "scheduler-v2",
    scheduler_seed: 42,
    prompt_writer_version: "scene-prompt-writer-v1",
    prompt_compiler_version: "mage-prompt-compiler-v1",
  };
}

function transcriptDocument(modelHash) {
  const starts = Array.from({ length: 10 }, (_, index) => 500 + index * 4_000);
  const words = [];
  const phrases = starts.map((startMs, index) => {
    const wordStart = words.length;
    const endMs = Math.min(startMs + 3_000, 39_000);
    for (let offset = 0; offset < endMs - startMs; offset += 500) {
      words.push({
        index: words.length,
        text: `phrase-${String(index)}-word-${String(offset / 500)}${offset + 500 === endMs - startMs ? "." : ""}`,
        start_ms: startMs + offset,
        end_ms: startMs + offset + 500,
        confidence: 0.99,
      });
    }
    return {
      phrase_id: `phrase_${String(index).padStart(2, "0")}`,
      sentence_id: `sentence_${String(index).padStart(2, "0")}`,
      word_start: wordStart,
      word_end_exclusive: words.length,
      start_ms: startMs,
      end_ms: endMs,
      pause_before_ms: index === 0 ? 500 : 1_000,
      pause_after_ms: 1_000,
      text: words
        .slice(wordStart)
        .map((word) => word.text)
        .join(" "),
    };
  });
  return {
    schema_version: "transcript-timing/v1",
    project_revision_id: IDS.revisionA,
    source: { asset_id: IDS.voiceoverA, sha256: HASHES.voiceoverA, duration_ms: 40_000 },
    engine: {
      name: "whisper.cpp",
      version: "1.8.4",
      model_name: "base.en",
      model_sha256: modelHash,
      language: "en",
    },
    text: words.map((word) => word.text).join(" "),
    words,
    phrases,
  };
}

function appendPayload(accountId, preparedTranscript, preparedTimeline, tasks) {
  const transcript = preparedTranscript.transcriptPersistence;
  const timeline = preparedTimeline.timelinePersistence;
  return {
    schema_version: "videoforge-hosted-canonical-timing-append/v1",
    asr_input_sha256: sha256("hosted-job-template-bytes"),
    asr_result_sha256: sha256("hosted-result-document-bytes"),
    generation_plan_sha256: sha256("hosted-generation-plan"),
    transcript: {
      asset: {
        id: preparedTranscript.transcriptDocumentAssetId,
        object_key: `tenant/${accountId}/${preparedTranscript.canonicalDocumentWrite.objectKey}`,
        byte_size: preparedTranscript.canonicalDocumentWrite.bytes.byteLength,
        hash: preparedTranscript.transcriptDocumentHash,
        metadata: {
          asr_input_canonical_hash: preparedTranscript.asrInputHash,
          asr_result_canonical_hash: preparedTranscript.asrResultHash,
        },
      },
      row: {
        id: preparedTranscript.transcriptId,
        source_asset_id: transcript.sourceAssetId,
        model_name: transcript.modelName,
        model_hash: transcript.modelSha256,
        duration_ms: transcript.sourceDurationMs,
        source_binary_sha256: transcript.sourceBinarySha256,
        engine_name: transcript.engineName,
        engine_version: transcript.engineVersion,
        language: transcript.language,
        transcription_config_hash: transcript.transcriptionConfigHash,
        optional_script_hash: transcript.optionalScriptHash,
        input_fingerprint_hash: transcript.inputFingerprintHash,
        idempotency_key: transcript.idempotencyKey,
        created_at: transcript.createdAt,
      },
      words: transcript.words.map((word) => ({
        id: word.wordId,
        index: word.index,
        text: word.text,
        start_ms: word.startMs,
        end_ms: word.endMsExclusive,
        confidence: word.confidence,
      })),
      sentences: transcript.sentences.map((sentence) => ({
        id: sentence.sentenceId,
        key: sentence.sentenceKey,
        index: sentence.index,
        word_start: sentence.wordStart,
        word_end: sentence.wordEndExclusive,
        start_ms: sentence.startMs,
        end_ms: sentence.endMsExclusive,
        text: sentence.text,
      })),
      phrases: transcript.phrases.map((phrase) => ({
        id: phrase.phraseId,
        sentence_id: phrase.sentenceId,
        key: phrase.phraseKey,
        index: phrase.index,
        word_start: phrase.wordStart,
        word_end: phrase.wordEndExclusive,
        start_ms: phrase.startMs,
        end_ms: phrase.endMsExclusive,
        pause_before_ms: phrase.pauseBeforeMs,
        pause_after_ms: phrase.pauseAfterMs,
        text: phrase.text,
      })),
    },
    timeline: {
      asset: {
        id: preparedTimeline.timelineDocumentAssetId,
        object_key: `tenant/${accountId}/${preparedTimeline.canonicalDocumentWrite.objectKey}`,
        byte_size: preparedTimeline.canonicalDocumentWrite.bytes.byteLength,
        hash: preparedTimeline.timelineDocumentHash,
        metadata: preparedTimeline.artifactRegistration.metadata,
      },
      row: {
        id: preparedTimeline.timelinePlanId,
        transcript_id: timeline.transcriptId,
        revision_config_hash: timeline.revisionConfigHash,
        transcript_document_hash: timeline.transcriptDocumentHash,
        scheduler_version: timeline.schedulerVersion,
        scheduler_config_hash: timeline.schedulerConfigHash,
        seed: timeline.seed.toString(),
        input_fingerprint_hash: timeline.inputFingerprintHash,
        idempotency_key: timeline.idempotencyKey,
        total_frames: timeline.totalFrames,
        created_at: timeline.createdAt,
      },
      segments: timeline.segments.map((segment) => ({
        id: segment.segmentId,
        key: segment.segmentKey,
        index: segment.index,
        start_frame: segment.startFrame,
        end_frame: segment.endFrameExclusive,
        source_start_ms: segment.sourceAudioStartMs,
        source_end_ms: segment.sourceAudioEndMsExclusive,
        word_start: segment.wordStart,
        word_end: segment.wordEndExclusive,
        composition: segment.timelineComposition,
        image_role: segment.inImageShotRole,
        narration: segment.narration,
        required_slots: segment.requiredSlots,
      })),
      spans: timeline.selectedSpanAudio.map((span) => ({
        id: span.spanId,
        timeline_segment_id: span.timelineSegmentId,
        transcript_id: span.transcriptId,
        key: span.spanKey,
        task_key: span.taskKey,
        source_asset_id: span.sourceAssetId,
        source_sha256: span.sourceBinarySha256,
        selected_start_ms: span.selectedStartMs,
        selected_end_ms: span.selectedEndMsExclusive,
        padded_start_ms: span.paddedStartMs,
        padded_end_ms: span.paddedEndMsExclusive,
        trim_start_ms: span.trimStartMs,
        trim_end_ms: span.trimEndMsExclusive,
      })),
    },
    tasks,
  };
}

test("migration 0039 exposes one least-privilege atomic hosted timing append", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const definition = await executor.query(
      `SELECT prosecdef, proconfig, pg_get_functiondef(oid) AS definition
         FROM pg_catalog.pg_proc
        WHERE proname = 'videoforge_append_hosted_canonical_timing'`,
    );
    assert.equal(definition.rows.length, 1);
    assert.equal(definition.rows[0].prosecdef, true);
    assert.deepEqual(definition.rows[0].proconfig, ["search_path=public, pg_catalog"]);
    assert.match(definition.rows[0].definition, /kind <> 'ASR'/u);
    assert.match(definition.rows[0].definition, /state <> 'SUCCEEDED'/u);
    assert.match(definition.rows[0].definition, /job_spec_checksum_sha256/u);
    assert.match(definition.rows[0].definition, /RESULT_DOCUMENT/u);
    assert.match(definition.rows[0].definition, /source_attempt_id/u);
    assert.match(definition.rows[0].definition, /NULL/u);
    assert.match(definition.rows[0].definition, /generation_tasks/u);
    assert.match(definition.rows[0].definition, /'BLOCKED'/u);
    assert.match(definition.rows[0].definition, /FOR UPDATE/u);
    assert.match(definition.rows[0].definition, /task_manifest IS DISTINCT FROM/u);
    assert.match(definition.rows[0].definition, /RETURN QUERY SELECT true/u);
    assert.match(definition.rows[0].definition, /RETURN QUERY SELECT false/u);
    assert.doesNotMatch(
      definition.rows[0].definition,
      /INSERT INTO public\.(attempts|generation_requests|serverless_attempts|serverless_dispatch_outbox|serverless_predispatch_authorities)/u,
    );
    const privilege = await executor.query(
      `SELECT has_function_privilege('public', $1, 'EXECUTE') AS public_execute`,
      [SIGNATURE],
    );
    assert.deepEqual(privilege.rows, [{ public_execute: false }]);

    const deferredValidators = await executor.query(
      `SELECT proname, prosecdef, proconfig,
              has_function_privilege('public', oid, 'EXECUTE') AS public_execute
         FROM pg_catalog.pg_proc
        WHERE proname IN (
          'videoforge_enforce_task_accepted_result',
          'videoforge_enforce_transcript_completeness',
          'videoforge_validate_timeline_plan'
        )
        ORDER BY proname`,
    );
    assert.deepEqual(deferredValidators.rows, [
      {
        proname: "videoforge_enforce_task_accepted_result",
        prosecdef: true,
        proconfig: ["search_path=pg_catalog, public"],
        public_execute: false,
      },
      {
        proname: "videoforge_enforce_transcript_completeness",
        prosecdef: true,
        proconfig: ["search_path=pg_catalog, public"],
        public_execute: false,
      },
      {
        proname: "videoforge_validate_timeline_plan",
        prosecdef: true,
        proconfig: ["search_path=pg_catalog, public"],
        public_execute: false,
      },
    ]);

    const columns = await executor.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'hosted_canonical_timing_bridges'
        ORDER BY ordinal_position`,
    );
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      [
        "hosted_asr_attempt_id",
        "account_id",
        "workspace_id",
        "project_id",
        "project_revision_id",
        "transcript_id",
        "transcript_document_hash",
        "timeline_plan_id",
        "timeline_document_hash",
        "asr_input_sha256",
        "asr_result_sha256",
        "generation_plan_sha256",
        "task_manifest",
        "append_payload",
        "completed_at",
        "created_at",
      ],
    );
  });
});

test("atomically appends, exactly replays, rejects drift, and survives populated backup restore", async () => {
  const source = await createMigratedDatabase();
  const destination = await createMigratedDatabase();
  try {
    const revision = await validateAndHashContractDocument(
      "projectRevisionConfig",
      revisionConfig(),
    );
    await seedLockedProjects(source.executor, {
      revisionA: {
        revisionHash: revision.sha256,
        revisionConfigPayload: revision.value,
        seed: 42,
      },
    });
    const attemptId = uuid(1_390_001);
    const modelHash = sha256("hosted-whisper-model");
    const input = {
      schema_version: "asr-job-input/v1",
      project_revision_id: IDS.revisionA,
      attempt_id: attemptId,
      voiceover: {
        asset_id: IDS.voiceoverA,
        sha256: HASHES.voiceoverA,
        artifact_uri: `vf-local://objects/sha256/${HASHES.voiceoverA.slice(7, 9)}/${HASHES.voiceoverA.slice(7)}.wav`,
        media_type: "audio/wav",
        duration_ms: 40_000,
      },
      model: {
        engine: "whisper.cpp",
        name: "base.en",
        sha256: modelHash,
        language: "en",
      },
      options: {
        threads: 4,
        processors: 1,
        flash_attention: true,
        greedy: true,
        split_on_word: true,
      },
      output: {
        result_uri: `vf-local-run://${IDS.revisionA}/${attemptId}/asr-result.json`,
      },
      cancel_token: attemptId,
    };
    const transcript = transcriptDocument(modelHash);
    const result = {
      schema_version: "asr-job-result/v1",
      attempt_id: attemptId,
      status: "SUCCEEDED",
      source_voiceover_sha256: HASHES.voiceoverA,
      model_sha256: modelHash,
      transcript,
      diagnostics: {
        tool_version: "1.8.4",
        source_duration_ms: 40_000,
        decode_duration_ms: 1_000,
      },
      error: null,
    };
    const scope = trustedTenantActorScope(
      trustedTenantScope(IDS.accountA, IDS.workspaceA),
      IDS.userA,
    );
    const preparedTranscript = await prepareDurableLocalTranscription(scope, {
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      taskId: attemptId,
      attemptId,
      expectedHeadVersion: 0,
      lineageSequence: 1,
      supersedesTranscriptId: null,
      optionalScriptHash: null,
      asrInput: input,
      asrResult: result,
      finishedAt: FINISHED,
    });
    const preparedTimeline = await prepareDurableDeterministicTimeline(scope, {
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      transcriptId: preparedTranscript.transcriptId,
      expectedHeadVersion: 1,
      planSequence: 1,
      supersedesTimelinePlanId: null,
      revision: revision.value,
      transcript,
      createdAt: FINISHED,
    });
    const timeline = preparedTimeline.timelinePersistence.canonicalDocument.payload;
    const tasks = [];
    for (const segment of timeline.segments) {
      const slots =
        segment.timeline_composition === "IMAGE_FULL"
          ? [[segment.required_slots.image.task_key, "IMAGE", []]]
          : segment.timeline_composition === "AVATAR_FULL"
            ? [
                [
                  segment.required_slots.avatar.task_key,
                  "AVATAR",
                  [segment.required_slots.avatar.span_audio_task_key],
                ],
              ]
            : [
                [
                  segment.required_slots.avatar.task_key,
                  "AVATAR",
                  [segment.required_slots.avatar.span_audio_task_key],
                ],
                [segment.required_slots.right_image.task_key, "IMAGE", []],
              ];
      for (const [taskKey, lane, dependsOn] of slots) {
        tasks.push({
          id: uuid(1_391_000 + tasks.length),
          task_key: taskKey,
          lane,
          timeline_segment_id: segment.segment_id,
          depends_on: dependsOn,
        });
      }
    }
    const payload = appendPayload(IDS.accountA, preparedTranscript, preparedTimeline, tasks);
    const prefix =
      `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}` +
      `/revision/${IDS.revisionA}/lane/input/job/${attemptId}/artifact/`;
    const jobSpecKey = `${prefix}job-spec`;
    const resultKey = `${prefix}result-document`;
    await source.executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [
      IDS.accountA,
    ]);
    await source.executor.query(
      `INSERT INTO hosted_cpu_job_attempts (
         id, account_id, workspace_id, project_id, project_revision_id, kind, state,
         request_sha256, job_spec_object_key, job_spec_content_length,
         job_spec_checksum_sha256, result_object_key, result_content_type, result_max_bytes,
         image_digest, callback_token_sha256, result_receipt_sha256, result_content_length,
         result_checksum_sha256, deadline_at, submitted_at, terminal_at, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,'ASR','SUCCEEDED',$6,$7,1024,$8,$9,'application/json',4096,
         $10,$11,$12,2048,$13,'2026-08-26T12:00:00.000Z',$14,$14,$15,$15
       )`,
      [
        attemptId,
        IDS.accountA,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        sha256("request"),
        jobSpecKey,
        payload.asr_input_sha256,
        resultKey,
        sha256("image"),
        sha256("callback"),
        sha256("receipt"),
        payload.asr_result_sha256,
        FINISHED,
        "2026-08-25T11:00:00.000Z",
      ],
    );
    await source.executor.query(
      `INSERT INTO hosted_cpu_upload_authorities (
         id, account_id, workspace_id, attempt_id, source, object_key, content_type,
         max_bytes, issued_content_length, issued_checksum_sha256, issued_at, created_at
       ) VALUES ($1,$2,$3,$4,'RESULT_DOCUMENT',$5,'application/json',4096,2048,$6,$7,$7)`,
      [
        uuid(1_390_002),
        IDS.accountA,
        IDS.workspaceA,
        attemptId,
        resultKey,
        payload.asr_result_sha256,
        FINISHED,
      ],
    );
    const append = (candidate) =>
      source.executor.query(
        `SELECT replayed FROM videoforge_append_hosted_canonical_timing($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          IDS.accountA,
          IDS.workspaceA,
          IDS.userA,
          IDS.projectA,
          IDS.revisionA,
          attemptId,
          JSON.stringify(candidate),
        ],
      );
    assert.deepEqual((await append(payload)).rows, [{ replayed: false }]);
    assert.deepEqual((await append(payload)).rows, [{ replayed: true }]);
    for (const drift of [
      (candidate) => {
        candidate.transcript.asset.byte_size += 1;
      },
      (candidate) => {
        candidate.timeline.asset.metadata.foreign = true;
      },
      (candidate) => {
        candidate.tasks[0].depends_on.push("foreign-task");
      },
    ]) {
      const candidate = structuredClone(payload);
      drift(candidate);
      await expectDatabaseError(() => append(candidate), "23505");
    }

    const snapshot = await exportMetadataSnapshot(source.executor);
    for (const tableName of [
      "hosted_cpu_job_attempts",
      "hosted_cpu_upload_authorities",
      "hosted_canonical_timing_bridges",
    ]) {
      assert.ok(snapshot.tables.find((table) => table.tableName === tableName)?.rowCount > 0);
    }
    const serialized = serializeMetadataSnapshot(snapshot);
    const restored = await restoreMetadataSnapshot(destination.executor, serialized);
    assert.equal(restored.alreadyRestored, false);
    assert.equal(
      serializeMetadataSnapshot(await exportMetadataSnapshot(destination.executor)),
      serialized,
    );
  } finally {
    await source.database.close();
    await destination.database.close();
  }
});
