import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSha256 } from "../dist/src/index.js";
import { IDS } from "./support/fixtures.mjs";
import { expectDatabaseError, sha256, uuid, withMigratedDatabase } from "./support/pglite.mjs";
import { seedMaterialization } from "./hosted-lane-batch-materialization.test.mjs";

async function fixture(executor) {
  const seeded = await seedMaterialization(executor, { canonicalV209: true });
  const runtime = (
    await executor.query("SELECT id FROM video_runtime_states WHERE generation_request_id=$1", [
      seeded.generationRequestId,
    ])
  ).rows[0];
  const lease = (
    await executor.query("SELECT id FROM provider_workload_leases WHERE generation_request_id=$1", [
      seeded.generationRequestId,
    ])
  ).rows[0];
  const attemptId = uuid(2_090_083);
  const manifestSha256 = sha256("0083-manifest");
  const outputSha256 = sha256("0083-output");
  const resultSha256 = sha256("0083-result");
  const primaryKey = `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/render/job/${attemptId}/artifact/result`;
  const resultKey = `${primaryKey}-document`;
  const payload = {
    schema_version: "videoforge-hosted-cpu-submission/v1",
    kind: "RENDER",
    project_id: IDS.projectA,
    project_revision_id: IDS.revisionA,
    input_document: {
      schema_version: "render-job-input/v1",
      project_revision_id: IDS.revisionA,
      resolved_render_manifest: { sha256: manifestSha256 },
    },
  };
  const payloadSha256 = canonicalSha256(payload);
  await executor.execute("ALTER TABLE video_runtime_states DISABLE TRIGGER ALL");
  await executor.query(
    `UPDATE video_runtime_states SET stage='RENDERING',render_manifest_sha256=$2,
      version=version+1,updated_at=transaction_timestamp() WHERE id=$1`,
    [runtime.id, manifestSha256],
  );
  await executor.execute("ALTER TABLE video_runtime_states ENABLE TRIGGER ALL");
  await executor.query(
    `UPDATE provider_workload_leases SET state='RELEASED',released_at=transaction_timestamp(),
      release_reason='HOSTED_PAIR_OUTPUTS_ACCEPTED',version=version+1 WHERE id=$1`,
    [lease.id],
  );
  await executor.query(
    `INSERT INTO hosted_render_plans(account_id,workspace_id,project_id,project_revision_id,
      schema_version,payload,payload_sha256) VALUES($1,$2,$3,$4,
      'videoforge-hosted-cpu-submission/v1',$5::jsonb,$6)`,
    [IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.revisionA, JSON.stringify(payload), payloadSha256],
  );
  await executor.query(
    `INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,
      project_revision_id,kind,state,request_sha256,job_spec_object_key,
      job_spec_content_length,job_spec_checksum_sha256,result_object_key,result_content_type,
      result_max_bytes,image_digest,callback_token_sha256,result_receipt_sha256,
      result_content_length,result_checksum_sha256,deadline_at,submitted_at,terminal_at,created_at,
      updated_at) VALUES($1,$2,$3,$4,$5,'RENDER','SUCCEEDED',$6,$7,1,$8,$9,
      'application/json',1048576,$10,$11,$12,321,$13,transaction_timestamp()+interval '1 hour',
      transaction_timestamp(),transaction_timestamp(),transaction_timestamp(),transaction_timestamp())`,
    [
      attemptId,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      payloadSha256,
      `${primaryKey}-spec`,
      sha256("0083-spec"),
      resultKey,
      sha256("0083-image"),
      sha256("0083-callback"),
      sha256("0083-result-receipt"),
      resultSha256,
    ],
  );
  for (const [index, source, objectKey, contentType, length, checksum] of [
    [1, "PRIMARY_RESULT_OUTPUT", primaryKey, "video/mp4", 1234, outputSha256],
    [2, "RESULT_DOCUMENT", resultKey, "application/json", 321, resultSha256],
  ]) {
    await executor.query(
      `INSERT INTO hosted_cpu_upload_authorities(id,account_id,workspace_id,attempt_id,source,
       object_key,content_type,max_bytes,issued_content_length,issued_checksum_sha256,issued_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,1048576,$8,$9,transaction_timestamp())`,
      [
        uuid(2_090_083 + index),
        IDS.accountA,
        IDS.workspaceA,
        attemptId,
        source,
        objectKey,
        contentType,
        length,
        checksum,
      ],
    );
  }
  const probe = {
    schema_version: "technical-probe/v1",
    asset_id: "final-output",
    sha256: outputSha256,
    bytes: 1234,
    container: "mp4",
    duration_ms: 30_000,
    total_frames: 900,
    video: { codec: "h264", pixel_format: "yuv420p", width: 1920, height: 1080, fps_num: 30, fps_den: 1 },
    audio: { codec: "aac", sample_rate_hz: 48_000 },
    stream_counts: { video: 1, audio: 1, subtitle: 0, data: 0 },
    decode_ok: true,
  };
  return {
    attemptId,
    generationRequestId: seeded.generationRequestId,
    runtimeId: runtime.id,
    leaseId: lease.id,
    finalOutput: {
      assetId: "final-output",
      checksumSha256: outputSha256,
      contentLength: 1234,
      contentType: "video/mp4",
      objectKey: primaryKey,
      probe,
      renderManifestSha256: manifestSha256,
      resultDocumentSha256: resultSha256,
    },
  };
}

function finalize(executor, target, overrides = {}) {
  return executor.query("SELECT videoforge_finalize_v209_render_terminal($1::jsonb) AS value", [
    JSON.stringify({
      schemaVersion: "videoforge.v2-09-render-terminal-finalize/v1",
      accountId: IDS.accountA,
      workspaceId: IDS.workspaceA,
      attemptId: target.attemptId,
      finalOutput: target.finalOutput,
      ...overrides,
    }),
  ]);
}

test("0083 atomically finalizes and exactly replays the released V2-09 render", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const target = await fixture(executor);
    const candidate = await executor.query(
      "SELECT videoforge_read_v209_render_terminal_candidate($1,$2,$3) AS value",
      [IDS.accountA, IDS.workspaceA, target.attemptId],
    );
    assert.equal(candidate.rows[0].value.runtimeStage, "RENDERING");
    const first = (await finalize(executor, target)).rows[0].value;
    assert.equal(first.state, "SUCCEEDED");
    assert.equal(first.replayed, false);
    const replay = (await finalize(executor, target)).rows[0].value;
    assert.equal(replay.state, "SUCCEEDED");
    assert.equal(replay.replayed, true);
    const state = await executor.query(
      `SELECT r.stage,r.terminal_reason,g.state request_state,l.state lease_state,l.version,
        (SELECT count(*)::int FROM video_runtime_events e WHERE e.runtime_id=r.id
          AND e.reason='FINAL_OUTPUT_DURABLE') event_count,
        (SELECT count(*)::int FROM artifact_receipts ar
          JOIN artifact_reservations av ON av.id=ar.reservation_id
          WHERE av.job_id=$2 AND av.retention_class='FINAL') receipt_count
        ,(SELECT count(*)::int FROM generation_queue_audits audit
          WHERE audit.request_id=g.id AND audit.operation='TERMINAL_RELEASE') terminal_audit_count
        ,(SELECT count(*)::int FROM generation_queue_audits audit
          WHERE audit.request_id=g.id AND audit.operation='PROMOTE') promotion_audit_count
       FROM video_runtime_states r JOIN generation_requests g ON g.id=r.generation_request_id
       JOIN provider_workload_leases l ON l.generation_request_id=g.id
       WHERE r.generation_request_id=$1`,
      [target.generationRequestId, target.attemptId],
    );
    assert.deepEqual(state.rows[0], {
      stage: "COMPLETE",
      terminal_reason: "SUCCEEDED",
      request_state: "SUCCEEDED",
      lease_state: "RELEASED",
      version: 2,
      event_count: 1,
      receipt_count: 1,
      terminal_audit_count: 1,
      promotion_audit_count: 0,
    });
    const audit = await executor.query(
      `SELECT operation,request_kind,request_id,lease_id,request_version_before,
        request_version_after,video_cursor_before,video_cursor_after,
        preview_cursor_before,preview_cursor_after,detail
       FROM generation_queue_audits WHERE request_id=$1 AND operation='TERMINAL_RELEASE'`,
      [target.generationRequestId],
    );
    assert.deepEqual(audit.rows[0], {
      operation: "TERMINAL_RELEASE",
      request_kind: "VIDEO",
      request_id: target.generationRequestId,
      lease_id: target.leaseId,
      request_version_before: 1,
      request_version_after: 2,
      video_cursor_before: 0,
      video_cursor_after: 0,
      preview_cursor_before: 0,
      preview_cursor_after: 0,
      detail: {
        source: "HOSTED_V209_RENDER_TERMINAL",
        terminalState: "SUCCEEDED",
        runtimeId: target.runtimeId,
        renderAttemptId: target.attemptId,
        finalOutputSha256: target.finalOutput.checksumSha256,
        finalOutputReceiptSha256: first.finalOutputReceiptSha256,
      },
    });
    await executor.execute("ALTER TABLE generation_queue_audits DISABLE TRIGGER ALL");
    await executor.query(
      `UPDATE generation_queue_audits SET detail=jsonb_set(detail,'{terminalState}','"FAILED"')
       WHERE request_id=$1 AND operation='TERMINAL_RELEASE'`,
      [target.generationRequestId],
    );
    await executor.execute("ALTER TABLE generation_queue_audits ENABLE TRIGGER ALL");
    await expectDatabaseError(() => finalize(executor, target), "55000");
    const noMutation = await executor.query(
      `SELECT request.version request_version,lease.version lease_version,
        (SELECT count(*)::int FROM generation_queue_audits audit
         WHERE audit.request_id=request.id) audit_count
       FROM generation_requests request JOIN provider_workload_leases lease
         ON lease.generation_request_id=request.id WHERE request.id=$1`,
      [target.generationRequestId],
    );
    assert.deepEqual(noMutation.rows[0], {
      request_version: 2,
      lease_version: 2,
      audit_count: 1,
    });
  });
});

test("0083 rejects tenant/output drift atomically", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const target = await fixture(executor);
    await expectDatabaseError(
      () =>
        finalize(executor, target, {
          finalOutput: { ...target.finalOutput, checksumSha256: sha256("drift") },
        }),
      "23514",
    );
    const state = await executor.query(
      "SELECT stage FROM video_runtime_states WHERE generation_request_id=$1",
      [target.generationRequestId],
    );
    assert.equal(state.rows[0].stage, "RENDERING");
  });
});
