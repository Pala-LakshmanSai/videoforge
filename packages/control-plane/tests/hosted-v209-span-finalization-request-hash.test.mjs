import assert from "node:assert/strict";
import test from "node:test";

import { withPgcryptoMigratedDatabase } from "./support/pglite.mjs";

const submission = {
  schema_version: "videoforge-hosted-cpu-submission/v1",
  idempotency_key: "span-audio:00000000-0000-4000-8000-000000000931",
  project_id: "00000000-0000-4000-8000-000000000932",
  project_revision_id: "00000000-0000-4000-8000-000000000933",
  kind: "SPAN_AUDIO",
  input_document: {
    schema_version: "selected-span-audio-job/v1",
    project_revision_id: "00000000-0000-4000-8000-000000000933",
    attempt_id: "00000000-0000-4000-8000-000000000934",
    timeline_plan_id: "00000000-0000-4000-8000-000000000935",
    transcript_id: "00000000-0000-4000-8000-000000000936",
    span_id: "00000000-0000-4000-8000-000000000937",
    timeline_segment_id: "00000000-0000-4000-8000-000000000938",
    task_key: "00000000-0000-4000-8000-000000000938",
    source_voiceover: {
      asset_id: "00000000-0000-4000-8000-000000000939",
      sha256: `sha256:${"a".repeat(64)}`,
      artifact_uri: `vf-local://objects/sha256/aa/${"a".repeat(64)}.wav`,
      duration_ms: 30_000,
    },
    selection: {
      selected_start_ms: 1_000,
      selected_end_ms_exclusive: 2_000,
      padded_start_ms: 960,
      padded_end_ms_exclusive: 2_040,
      trim_start_ms: 40,
      trim_end_ms_exclusive: 1_040,
    },
    output: {
      asset_id: "00000000-0000-4000-8000-000000000940",
      result_uri:
        "vf-local-run://00000000-0000-4000-8000-000000000933/00000000-0000-4000-8000-000000000934/span-audio-result.json",
    },
    cancel_token: "00000000-0000-4000-8000-000000000934",
    output_profile: "SOULX_PCM16_48K_MONO",
  },
  objects: [
    {
      artifact_receipt_id: "00000000-0000-4000-8000-000000000941",
      uri: `vf-local://objects/sha256/aa/${"a".repeat(64)}.wav`,
    },
  ],
};

const hashProjectionSql = `
  WITH fixture AS (
    SELECT $1::jsonb AS submission_document,
           $2::text AS submission_sha256,
           $3::text AS request_sha256
  ), expected AS (
    SELECT fixture.*,
      'sha256:'||encode(sha256(convert_to(
        public.videoforge_canonical_jsonb(fixture.submission_document),'UTF8')),'hex')
        AS expected_submission_sha256,
      'sha256:'||encode(sha256(convert_to(
        public.videoforge_canonical_jsonb(jsonb_build_object(
          'idempotencyKey',fixture.submission_document->>'idempotency_key',
          'projectId',fixture.submission_document->>'project_id',
          'projectRevisionId',fixture.submission_document->>'project_revision_id',
          'kind',fixture.submission_document->>'kind',
          'inputDocument',fixture.submission_document->'input_document',
          'objects',(SELECT coalesce(jsonb_agg(jsonb_build_object(
            'receiptId',object_row.value->>'artifact_receipt_id','uri',object_row.value->>'uri')
            ORDER BY object_row.ordinality),'[]'::jsonb)
            FROM jsonb_array_elements(fixture.submission_document->'objects')
              WITH ORDINALITY AS object_row(value,ordinality))
        )),'UTF8')),'hex') AS expected_request_sha256
    FROM fixture
  )
  SELECT expected_submission_sha256, expected_request_sha256,
         submission_sha256 = expected_submission_sha256
           AND request_sha256 = expected_request_sha256 AS accepted
    FROM expected`;

test("0093 accepts parsed submission lineage and rejects request or materialization substitution", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const hashes = await executor.query(
      hashProjectionSql.replace(
        "SELECT expected_submission_sha256, expected_request_sha256,\n         submission_sha256 = expected_submission_sha256\n           AND request_sha256 = expected_request_sha256 AS accepted",
        "SELECT expected_submission_sha256, expected_request_sha256",
      ),
      [JSON.stringify(submission), "", ""],
    );
    const expectedSubmissionSha256 = hashes.rows[0].expected_submission_sha256;
    const expectedRequestSha256 = hashes.rows[0].expected_request_sha256;

    assert.notEqual(expectedSubmissionSha256, expectedRequestSha256);

    const valid = await executor.query(hashProjectionSql, [
      JSON.stringify(submission),
      expectedSubmissionSha256,
      expectedRequestSha256,
    ]);
    assert.equal(valid.rows[0].accepted, true);

    const substitutedRequest = await executor.query(hashProjectionSql, [
      JSON.stringify(submission),
      expectedSubmissionSha256,
      `sha256:${"b".repeat(64)}`,
    ]);
    assert.equal(substitutedRequest.rows[0].accepted, false);

    const substitutedDocument = structuredClone(submission);
    substitutedDocument.input_document.selection.selected_start_ms = 1_040;
    const substitutedMaterialization = await executor.query(hashProjectionSql, [
      JSON.stringify(substitutedDocument),
      expectedSubmissionSha256,
      expectedRequestSha256,
    ]);
    assert.equal(substitutedMaterialization.rows[0].accepted, false);
  });
});

test("0093 installs the parsed camelCase request hash invariant without dropping finalization guards", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const result = await executor.query(
      `SELECT pg_get_functiondef(
         'public.videoforge_finalize_hosted_v209_span_audio(uuid,uuid,uuid,jsonb)'::regprocedure
       ) AS definition`,
    );
    const definition = result.rows[0].definition;
    assert.match(definition, /expected_submission_sha/u);
    assert.match(definition, /expected_request_sha/u);
    assert.match(definition, /'idempotencyKey'/u);
    assert.match(definition, /'projectRevisionId'/u);
    assert.match(definition, /'receiptId'/u);
    assert.match(
      definition,
      /jsonb_object_keys\(CASE WHEN jsonb_typeof\(materialized\.submission_document\)='object'/u,
    );
    assert.match(definition, /jsonb_array_length\(materialized\.submission_document->'objects'\)/u);
    assert.match(definition, /materialized\.source_receipt_id::text/u);
    assert.match(definition, /materialized\.input_document#>>'\{source_voiceover,artifact_uri\}'/u);
    assert.match(definition, /materialized\.submission_sha256<>expected_submission_sha/u);
    assert.match(definition, /attempt\.request_sha256<>expected_request_sha/u);
    assert.match(definition, /attempt\.result_checksum_sha256 IS NULL/u);
    assert.match(definition, /l\.state='SUCCEEDED'/u);
    assert.doesNotMatch(definition, /attempt\.request_sha256<>materialized\.submission_sha256/u);
  });
});
