import assert from "node:assert/strict";
import test from "node:test";
import {
  seedAdaptivePromptRun,
  scenePayload,
} from "./hosted-prompt-adaptive-batches-migration.test.mjs";
import { IDS, HASHES } from "./support/fixtures.mjs";
import { FIXED_TIME, sha256, uuid, withPgcryptoMigratedDatabase } from "./support/pglite.mjs";

for (const outcome of ["complete", "failed"])
  test(`0227 preserves accepted prefix and prior settlement on operator resume to ${outcome}`, async () => {
    await withPgcryptoMigratedDatabase(async ({ executor }) => {
      const run = await seedAdaptivePromptRun(executor, {
        sceneCount: 2,
        plannedBatchCount: 2,
        reservedMicroUsd: 500000,
      });
      const request = (ordinal, attempt, identity) =>
        JSON.stringify([
          {
            taskType: "textInference",
            taskUUID: uuid(identity),
            model: "google:gemini@3.5-flash",
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
      const payload = (ordinal, bytes, cost) => ({
        batch_ordinal: ordinal,
        first_scene_ordinal: ordinal,
        request_bytes: bytes,
        request_hash: sha256(bytes),
        response_bytes: `response-${ordinal}`,
        response_hash: sha256(`response-${ordinal}`),
        input_tokens: 10,
        output_tokens: 20,
        reported_cost_micro_usd: cost,
        scenes: scenePayload(ordinal, 1),
      });
      const claim = async (ordinal, bytes) =>
        executor.query("SELECT videoforge_claim_hosted_prompt_batch($1,$2,$3,$4,$5)", [
          run.runId,
          ordinal,
          JSON.parse(bytes)[0].taskUUID,
          bytes,
          sha256(bytes),
        ]);
      const first = request(0, 1, 227001),
        original = request(1, 1, 227002),
        second = request(1, 2, 227003),
        third = request(1, 2, 227004);
      await claim(0, first);
      await executor.query("SELECT videoforge_record_hosted_prompt_batch($1,$2::jsonb)", [
        run.runId,
        JSON.stringify(payload(0, first, 123)),
      ]);
      const prefix = (
        await executor.query(
          "SELECT row_to_json(p) AS row FROM hosted_prompt_batch_progress p WHERE run_id=$1",
          [run.runId],
        )
      ).rows;
      await claim(1, original);
      await executor.query(
        "SELECT videoforge_replace_invalid_hosted_prompt_batch($1,1,$2,$3,77804,$4,$5)",
        [
          run.runId,
          JSON.parse(original)[0].taskUUID,
          sha256("original invalid"),
          second,
          sha256(second),
        ],
      );
      await executor.query(
        "SELECT videoforge_fail_hosted_prompt_run($1,'UNKNOWN','HOSTED_PROMPT_EXECUTION_UNKNOWN',true,0)",
        [run.runId],
      );
      await executor.query(
        "SELECT videoforge_adjudicate_invalid_hosted_prompt_batch($1,$2,$3,77543)",
        [run.runId, JSON.parse(second)[0].taskUUID, sha256("second invalid")],
      );
      const costsBefore = (
        await executor.query(
          "SELECT row_to_json(c) AS row FROM cost_events c WHERE attempt_id=$1 ORDER BY sequence",
          [run.attemptId],
        )
      ).rows;
      const resume =
        "SELECT videoforge_resume_failed_hosted_prompt_batch($1,$2,$3,$4,$5,$6) AS resumed";
      const args = [
        run.runId,
        JSON.parse(second)[0].taskUUID,
        sha256("second invalid"),
        77543,
        third,
        sha256(third),
      ];
      await assert.rejects(
        executor.query(resume, [...args.slice(0, 2), sha256("wrong"), ...args.slice(3)]),
        /evidence or budget is invalid/,
      );
      const drift = third.replace("scene-1", "other-scene");
      await assert.rejects(
        executor.query(resume, [...args.slice(0, 4), drift, sha256(drift)]),
        /request drifted/,
      );
      await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
      await assert.rejects(executor.query(resume, args), /identity is invalid/);
      await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
      assert.equal((await executor.query(resume, args)).rows[0].resumed, true);
      assert.equal((await executor.query(resume, args)).rows[0].resumed, false);
      await assert.rejects(
        executor.query(resume, [
          ...args.slice(0, 4),
          request(1, 2, 227005),
          sha256(request(1, 2, 227005)),
        ]),
        /exhausted or evidence drifted/,
      );
      assert.deepEqual(
        (
          await executor.query(
            "SELECT row_to_json(p) AS row FROM hosted_prompt_batch_progress p WHERE run_id=$1",
            [run.runId],
          )
        ).rows,
        prefix,
      );
      const allCosts = (
        await executor.query(
          "SELECT row_to_json(c) AS row FROM cost_events c WHERE attempt_id=$1 ORDER BY sequence",
          [run.attemptId],
        )
      ).rows;
      assert.deepEqual(allCosts.slice(0, costsBefore.length), costsBefore);
      const raw = {
        status: "succeeded",
        outputText: "private result",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, cachedInputTokens: 0 },
        costUsd: 0.000456,
        finishReason: "stop",
        providerModel: "google:gemini@3.5-flash",
        latencyMs: 100,
      };
      await executor.query("SELECT videoforge_record_hosted_prompt_response($1,$2,$3,$4::jsonb)", [
        run.runId,
        JSON.parse(third)[0].taskUUID,
        sha256(third),
        JSON.stringify(raw),
      ]);
      await assert.rejects(
        executor.query("SELECT videoforge_record_hosted_prompt_response($1,$2,$3,$4::jsonb)", [
          run.runId,
          JSON.parse(second)[0].taskUUID,
          sha256(second),
          JSON.stringify(raw),
        ]),
        /claim is invalid/,
      );
      if (outcome === "complete") {
        await executor.query(
          "SELECT videoforge_fail_hosted_prompt_run($1,'UNKNOWN','HOSTED_PROMPT_EXECUTION_UNKNOWN',true,0)",
          [run.runId],
        );
        await executor.query("SELECT videoforge_recover_hosted_prompt_batch($1,$2,$3::jsonb)", [
          run.runId,
          JSON.parse(third)[0].taskUUID,
          JSON.stringify(payload(1, third, 456)),
        ]);
        // A delayed duplicate callback may mark a fully accepted resumed run uncertain.
        await executor.query(
          "SELECT videoforge_fail_hosted_prompt_run($1,'UNKNOWN','HOSTED_PROMPT_EXECUTION_UNKNOWN',true,0)",
          [run.runId],
        );
        assert.equal(
          (
            await executor.query(
              "SELECT videoforge_reopen_saved_hosted_prompt_prefix($1) AS reopened",
              [run.runId],
            )
          ).rows[0].reopened,
          true,
        );
        const scenes = scenePayload(0, 2);
        const accepted = {
          workspaceId: IDS.workspaceA,
          projectId: IDS.projectA,
          revisionId: IDS.revisionA,
          timelineId: run.timelineId,
          taskId: run.taskId,
          attemptId: run.attemptId,
          outboxId: uuid(971008),
          inputHash: run.inputHash,
          schemaVersion: "videoforge.durable-prompt-execution/v1",
          requestHash: sha256("requests"),
          responseHash: sha256("responses"),
          compiledOutputHash: sha256("compiled"),
          acceptanceFingerprintHash: sha256("acceptance"),
          timelineHash: run.timelineHash,
          styleProfileHash: HASHES.styleA,
          reportedCostMicroUsd: 579,
          acceptedAt: FIXED_TIME,
          writerAttempts: [
            {
              attemptIndex: 1,
              requestedSceneIds: scenes.map((s) => s.scene_id),
              requestBytes: "requests",
              requestHash: sha256("requests"),
              responseBytes: "responses",
              responseHash: sha256("responses"),
              retryOfRequestHash: null,
              acceptedSceneIds: scenes.map((s) => s.scene_id),
              unresolvedSceneIds: [],
              inputTokens: 20,
              outputTokens: 40,
              reportedCostMicroUsd: 579,
            },
          ],
          writerOutput: { scenes: scenes.map((s) => s.writer_output) },
          compiledPrompts: scenes.map((s) => s.compiled_prompt),
        };
        await executor.query("SELECT videoforge_complete_hosted_prompt_run($1::jsonb)", [
          JSON.stringify({
            run_id: run.runId,
            output_asset_id: uuid(227100),
            prompt_execution_id: uuid(227101),
            acceptance: accepted,
          }),
        ]);
      } else {
        await executor.query(
          "SELECT videoforge_fail_hosted_prompt_run($1,'UNKNOWN','HOSTED_PROMPT_EXECUTION_UNKNOWN',true,0)",
          [run.runId],
        );
        await executor.query(
          "SELECT videoforge_adjudicate_invalid_hosted_prompt_batch($1,$2,$3,456)",
          [run.runId, JSON.parse(third)[0].taskUUID, sha256("third invalid")],
        );
      }
      const events = (
        await executor.query(
          "SELECT event_type,amount_micro_usd FROM cost_events WHERE attempt_id=$1 ORDER BY sequence",
          [run.attemptId],
        )
      ).rows;
      assert.deepEqual(events, [
        { event_type: "RESERVED", amount_micro_usd: 500000 },
        { event_type: "REPORTED", amount_micro_usd: 155470 },
        { event_type: "SETTLED", amount_micro_usd: 155470 },
        { event_type: "RELEASED", amount_micro_usd: 344530 },
        { event_type: "RESERVED", amount_micro_usd: 344530 },
        { event_type: "REPORTED", amount_micro_usd: 456 },
        { event_type: "SETTLED", amount_micro_usd: 456 },
        { event_type: "RELEASED", amount_micro_usd: 344074 },
      ]);
      assert.equal(
        (
          await executor.query(
            "SELECT reported_cost_micro_usd FROM hosted_prompt_runs WHERE id=$1",
            [run.runId],
          )
        ).rows[0].reported_cost_micro_usd,
        155926,
      );
      if (outcome === "complete")
        assert.equal(
          (
            await executor.query(
              "SELECT reported_cost_micro_usd FROM prompt_executions WHERE task_id=$1",
              [run.taskId],
            )
          ).rows[0].reported_cost_micro_usd,
          579,
        );
      const acl = (
        await executor.query(
          "SELECT proacl FROM pg_proc WHERE oid='videoforge_resume_failed_hosted_prompt_batch(uuid,text,text,bigint,text,text)'::regprocedure",
        )
      ).rows[0].proacl;
      assert.ok(acl.every((a) => !a.startsWith("=") && !a.includes("videoforge_v209_runtime")));
    });
  });
