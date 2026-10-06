import assert from "node:assert/strict";
import test from "node:test";
import {
  seedAdaptivePromptRun,
  scenePayload,
} from "./hosted-prompt-adaptive-batches-migration.test.mjs";
import { IDS } from "./support/fixtures.mjs";
import { sha256, uuid, withPgcryptoMigratedDatabase } from "./support/pglite.mjs";

test("0281 retains terminal settlement guards and grants with a distinct archive disposition", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const definitions = (
      await executor.query(`SELECT
      pg_get_functiondef('videoforge_adjudicate_invalid_hosted_prompt_batch(uuid,text,text,bigint)'::regprocedure) AS original,
      pg_get_functiondef('videoforge_adjudicate_unavailable_hosted_prompt_archive(uuid,text,text,bigint)'::regprocedure) AS archive`)
    ).rows[0];
    const expected = definitions.original
      .replaceAll(
        "videoforge_adjudicate_invalid_hosted_prompt_batch",
        "videoforge_adjudicate_unavailable_hosted_prompt_archive",
      )
      .replaceAll("HOSTED_PROMPT_OUTPUT_INVALID", "HOSTED_PROMPT_ARCHIVE_UNAVAILABLE")
      .replaceAll("hosted-prompt-invalid:", "hosted-prompt-archive-unavailable:")
      .replaceAll("hosted_prompt_invalid_batch", "hosted_prompt_archive_unavailable")
      .replaceAll("hosted prompt invalid output", "hosted prompt unavailable archive");
    assert.equal(definitions.archive, expected);
    const permissions = (
      await executor.query(`SELECT
      has_function_privilege('videoforge_v209_runtime_dc9612d6','videoforge_adjudicate_invalid_hosted_prompt_batch(uuid,text,text,bigint)','EXECUTE') AS original,
      has_function_privilege('videoforge_v209_runtime_dc9612d6','videoforge_adjudicate_unavailable_hosted_prompt_archive(uuid,text,text,bigint)','EXECUTE') AS archive,
      EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
        WHERE p.oid='videoforge_adjudicate_unavailable_hosted_prompt_archive(uuid,text,text,bigint)'::regprocedure
        AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute`)
    ).rows[0];
    assert.equal(permissions.archive, permissions.original);
    assert.equal(permissions.public_execute, false);
  });
});

test("0281 settles an exhausted archive once while preserving prefix, claims, and paid bounds", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const run = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 2,
      reservedMicroUsd: 500000,
    });
    const request = (ordinal, attempt = 1) =>
      JSON.stringify([
        {
          taskType: "textInference",
          taskUUID: uuid(281000 + ordinal * 2 + attempt),
          model: "google:gemini@3.5-flash",
          deliveryMethod: "sync",
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                batch_id: `batch-${ordinal}`,
                attempt_index: attempt,
                scenes: [{ scene_id: `scene-${ordinal}` }],
              }),
            },
          ],
        },
      ]);
    const claim = (ordinal, bytes) =>
      executor.query("SELECT videoforge_claim_hosted_prompt_batch($1,$2,$3,$4,$5)", [
        run.runId,
        ordinal,
        JSON.parse(bytes)[0].taskUUID,
        bytes,
        sha256(bytes),
      ]);
    const first = request(0);
    await claim(0, first);
    await executor.query("SELECT videoforge_record_hosted_prompt_batch($1,$2::jsonb)", [
      run.runId,
      JSON.stringify({
        batch_ordinal: 0,
        first_scene_ordinal: 0,
        request_bytes: first,
        request_hash: sha256(first),
        response_bytes: "accepted",
        response_hash: sha256("accepted"),
        input_tokens: 10,
        output_tokens: 20,
        reported_cost_micro_usd: 123,
        scenes: scenePayload(0, 1),
      }),
    ]);
    const prefix = (
      await executor.query(
        "SELECT row_to_json(p) AS row FROM hosted_prompt_batch_progress p WHERE run_id=$1",
        [run.runId],
      )
    ).rows;
    const original = request(1),
      replacement = request(1, 2);
    await claim(1, original);
    await executor.query(
      "SELECT videoforge_fail_hosted_prompt_run($1,'UNKNOWN','HOSTED_PROMPT_EXECUTION_UNKNOWN',true,0)",
      [run.runId],
    );
    await executor.query(
      "SELECT videoforge_replace_invalid_hosted_prompt_batch($1,1,$2,$3,76130,$4,$5)",
      [
        run.runId,
        JSON.parse(original)[0].taskUUID,
        sha256("original archived response"),
        replacement,
        sha256(replacement),
      ],
    );
    await executor.query(
      "SELECT videoforge_fail_hosted_prompt_run($1,'UNKNOWN','HOSTED_PROMPT_EXECUTION_UNKNOWN',true,0)",
      [run.runId],
    );
    const sql =
      "SELECT videoforge_adjudicate_unavailable_hosted_prompt_archive($1,$2,$3,$4) AS settled";
    const args = [
      run.runId,
      JSON.parse(replacement)[0].taskUUID,
      sha256("replacement archived response"),
      3000,
    ];
    await assert.rejects(
      executor.query(sql, [uuid(281099), ...args.slice(1)]),
      /identity is invalid/,
    );
    await assert.rejects(
      executor.query(sql, [args[0], JSON.parse(original)[0].taskUUID, ...args.slice(2)]),
      /claim is invalid/,
    );
    await assert.rejects(executor.query(sql, [...args.slice(0, 3), 250001]), /identity is invalid/);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [uuid(281098)]);
    await assert.rejects(executor.query(sql, args), /identity is invalid/);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
    assert.equal((await executor.query(sql, args)).rows[0].settled, true);
    assert.equal((await executor.query(sql, args)).rows[0].settled, false);
    await assert.rejects(executor.query(sql, [...args.slice(0, 3), 3001]), /evidence drifted/);
    const state = (
      await executor.query(
        "SELECT state,problem_code,reported_cost_micro_usd,discarded_cost_micro_usd,operator_resume_count FROM hosted_prompt_runs WHERE id=$1",
        [run.runId],
      )
    ).rows[0];
    assert.deepEqual(state, {
      state: "FAILED",
      problem_code: "HOSTED_PROMPT_ARCHIVE_UNAVAILABLE",
      reported_cost_micro_usd: 79253,
      discarded_cost_micro_usd: 76130,
      operator_resume_count: 0,
    });
    assert.deepEqual(
      (
        await executor.query(
          "SELECT row_to_json(p) AS row FROM hosted_prompt_batch_progress p WHERE run_id=$1",
          [run.runId],
        )
      ).rows,
      prefix,
    );
    const counts = (
      await executor.query(
        "SELECT (SELECT count(*)::int FROM hosted_prompt_batch_claims WHERE run_id=$1) AS claims,(SELECT count(*)::int FROM hosted_prompt_batch_replacements WHERE run_id=$1) AS replacements,(SELECT count(*)::int FROM repository_mutation_receipts WHERE operation='hosted_prompt_archive_unavailable') AS receipts",
        [run.runId],
      )
    ).rows[0];
    assert.deepEqual(counts, { claims: 2, replacements: 1, receipts: 1 });
  });
});
