import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPromptBatch,
  buildRunwarePromptRequest,
  buildRunwarePromptCorrection,
  NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
} from "../../pipeline/dist/src/index.js";
import {
  seedAdaptivePromptRun,
  scenePayload,
  seedSucceededVoiceoverContext,
} from "./hosted-prompt-adaptive-batches-migration.test.mjs";
import { IDS } from "./support/fixtures.mjs";
import { sha256, uuid, withPgcryptoMigratedDatabase } from "./support/pglite.mjs";

for (const policy of ["validated-scenes-v1", "grounded-scenes-v1"])
  for (const fenced of [false, true])
    test(`0282 seals only failed scenes, accepts a merged full batch, and preserves provenance through next ordinal (policy=${policy}, fenced=${fenced})`, async () => {
      await withPgcryptoMigratedDatabase(async ({ executor }) => {
        const run = await seedAdaptivePromptRun(executor, {
          sceneCount: 3,
          plannedBatchCount: 2,
          reservedMicroUsd: 1000000,
        });
        const styleHash = sha256("style");
        const batch = buildPromptBatch({
          batchId: "batch-0",
          projectTitle: "Grocery inspection",
          imageStyleVersionId: "style",
          styleProfileHash: styleHash,
          styleTreatment: {
            schema_version: "image-style-treatment/v2",
            style_profile_hash: styleHash,
            medium_family: "documentary photography",
            realism: "physically believable still image",
            camera_language: "observational",
            image_framing: "crop-safe",
            shot_scale_preferences: ["hands and action"],
            lighting: "daylight",
            palette: { descriptors: ["true-to-life"], approximate_hex: [] },
            contrast_and_exposure: "natural",
            depth_of_field: "natural",
            texture_and_grain: "ordinary",
            imperfection_profile: ["wear"],
            mood: ["grounded"],
          },
          plannerGuidance: "documentary photography",
          storyContext: "Hands inspect bottles in a grocery store aisle.",
          continuityTags: [],
          scenes: [0, 1].map((index) => ({
            sceneId: `scene-${index}`,
            phrase:
              policy === "grounded-scenes-v1" && index === 0
                ? "A chef is not stirring soup in a kitchen."
                : "Hands inspect bottles in a grocery store aisle.",
            sentenceContext:
              policy === "grounded-scenes-v1" && index === 0
                ? "A chef is not stirring soup in a kitchen."
                : "Hands inspect bottles in a grocery store aisle.",
            priorContext: null,
            nextContext: null,
            inImageShotRole: "HANDS_ACTION",
            layout: "IMAGE_FULL",
          })),
        });
        const built = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1, policy);
        const task = built.request,
          original = built.requestBytes,
          payload = JSON.parse(task.messages[0].content),
          inputs = payload.scenes;
        const sourceJson = JSON.stringify({
          batch_id: batch.batchId,
          scenes: [...batch.scenes].reverse().map((scene) => ({
            scene_id: scene.sceneId,
            literal_subject:
              policy === "grounded-scenes-v1" && scene.sceneId === "scene-0" ? "A chef" : "Hands",
            action:
              scene.sceneId === "scene-0"
                ? policy === "grounded-scenes-v1"
                  ? "Stirring soup"
                  : "Reading a printed label on a bottle."
                : "Inspecting an unmarked bottle.",
            environment:
              policy === "grounded-scenes-v1" && scene.sceneId === "scene-0"
                ? "A kitchen"
                : "A grocery store aisle with bottles on shelves.",
            in_image_shot_role: scene.inImageShotRole,
            lighting_context: "available daylight",
            continuity_tags: [],
            prompt_core:
              "Hands inspect bottles in a grocery store aisle with shelves and ordinary daylight. The physical bottles stay visible with realistic surfaces, restrained camera framing and natural texture. Hands hold one bottle and keep the shelving within the frame.",
          })),
        });
        const source = fenced ? "```json\n" + sourceJson + "\n```" : sourceJson;
        const derived = buildRunwarePromptCorrection(batch, source, policy);
        assert.ok(derived);
        if (policy === "grounded-scenes-v1")
          assert.equal(derived.failures[0].reason, "explicit_negation_conflict");
        const repairBuilt = buildRunwarePromptRequest(
          batch,
          batch.scenes,
          2,
          built.requestSha256,
          1,
          policy,
          "no-text-v2",
          derived,
        );
        const replacementPayload = JSON.parse(repairBuilt.request.messages[0].content),
          correction = replacementPayload.correction;
        await executor.query("SELECT videoforge_claim_hosted_prompt_batch($1,0,$2,$3,$4)", [
          run.runId,
          task.taskUUID,
          original,
          sha256(original),
        ]);
        await assert.rejects(
          executor.query(
            "SELECT videoforge_replace_invalid_hosted_prompt_batch($1,0,$2,$3,10000,$4,$5)",
            [
              run.runId,
              task.taskUUID,
              sha256(source),
              repairBuilt.requestBytes,
              repairBuilt.requestSha256,
            ],
          ),
          /replacement request drifted/,
        );
        await executor.query(
          "SELECT videoforge_record_hosted_prompt_response($1,$2,$3,$4::jsonb)",
          [
            run.runId,
            task.taskUUID,
            sha256(original),
            JSON.stringify({
              status: "succeeded",
              outputText: source,
              usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, cachedInputTokens: 0 },
              costUsd: 0.01,
              finishReason: "stop",
              latencyMs: 0,
            }),
          ],
        );
        const makeReplacement = (nextPayload = replacementPayload, changes = {}) =>
          JSON.stringify([
            {
              ...task,
              ...changes,
              taskUUID: uuid(282002),
              messages: [{ role: "user", content: JSON.stringify(nextPayload) }],
            },
          ]);
        const replace = async (bytes) =>
          executor.query(
            "SELECT videoforge_replace_invalid_hosted_prompt_batch($1,0,$2,$3,10000,$4,$5) AS claimed",
            [run.runId, task.taskUUID, sha256(source), bytes, sha256(bytes)],
          );
        for (const bytes of [
          makeReplacement({ ...replacementPayload, project_title: "changed" }),
          makeReplacement({
            ...replacementPayload,
            scenes: [{ ...inputs[0], exact_phrase: "changed" }],
          }),
          makeReplacement({
            ...replacementPayload,
            correction: { ...correction, source_output_text: source + " " },
          }),
          makeReplacement({
            ...replacementPayload,
            correction: { ...correction, failed_scene_ids: ["scene-0", "scene-0"] },
          }),
          makeReplacement({
            ...replacementPayload,
            correction: {
              ...correction,
              failures: [{ scene_id: "scene-0", field: "action", reason: "arbitrary" }],
            },
          }),
          makeReplacement(replacementPayload, { model: "changed" }),
          makeReplacement(replacementPayload, { settings: { ...task.settings, temperature: 0.9 } }),
        ])
          await assert.rejects(replace(bytes), /replacement request drifted/);
        const alteredSource = source + " ";
        await assert.rejects(
          executor.query(
            "SELECT videoforge_replace_invalid_hosted_prompt_batch($1,0,$2,$3,10000,$4,$5)",
            [
              run.runId,
              task.taskUUID,
              sha256(alteredSource),
              makeReplacement({
                ...replacementPayload,
                correction: {
                  ...correction,
                  source_output_text: alteredSource,
                  source_response_sha256: sha256(alteredSource),
                },
              }),
              sha256(
                makeReplacement({
                  ...replacementPayload,
                  correction: {
                    ...correction,
                    source_output_text: alteredSource,
                    source_response_sha256: sha256(alteredSource),
                  },
                }),
              ),
            ],
          ),
          /replacement request drifted/,
        );
        const replacement = repairBuilt.requestBytes;
        const claimRow = (
          await executor.query("SELECT id FROM hosted_prompt_batch_claims WHERE run_id=$1", [
            run.runId,
          ])
        ).rows[0];
        assert.equal(
          (
            await executor.query(
              "SELECT videoforge_hosted_prompt_scene_correction_matches($1::jsonb,$2::jsonb,$3,$4,$5,$6,$7,10000) AS valid",
              [
                JSON.stringify(payload),
                JSON.stringify(replacementPayload),
                sha256(source),
                run.runId,
                claimRow.id,
                task.taskUUID,
                sha256(original),
              ],
            )
          ).rows[0].valid,
          true,
        );

        assert.equal((await replace(replacement)).rows[0].claimed, true);
        assert.equal((await replace(replacement)).rows[0].claimed, false);
        const rawRepair = JSON.stringify({
          batch_id: "batch-0",
          scenes: [{ scene_id: "scene-0", action: "unmarked bottle" }],
        });
        await executor.query("SELECT videoforge_record_hosted_prompt_batch($1,$2::jsonb)", [
          run.runId,
          JSON.stringify({
            batch_ordinal: 0,
            first_scene_ordinal: 0,
            request_bytes: replacement,
            request_hash: sha256(replacement),
            response_bytes: rawRepair,
            response_hash: sha256(rawRepair),
            input_tokens: 1,
            output_tokens: 2,
            reported_cost_micro_usd: 2000,
            scenes: scenePayload(0, 2),
          }),
        ]);
        const prefix = (
          await executor.query(
            "SELECT row_to_json(p) AS row FROM hosted_prompt_batch_progress p WHERE run_id=$1",
            [run.runId],
          )
        ).rows;
        assert.equal(prefix[0].row.scene_count, 2);
        assert.equal(prefix[0].row.response_bytes, rawRepair);
        const next = JSON.stringify([
          {
            ...task,
            taskUUID: uuid(282003),
            messages: [
              {
                role: "user",
                content: JSON.stringify({
                  ...payload,
                  batch_id: "batch-1",
                  scenes: [{ scene_id: "scene-2" }],
                }),
              },
            ],
          },
        ]);
        await executor.query("SELECT videoforge_claim_hosted_prompt_batch($1,1,$2,$3,$4)", [
          run.runId,
          uuid(282003),
          next,
          sha256(next),
        ]);
        assert.deepEqual(
          (
            await executor.query(
              "SELECT row_to_json(p) AS row FROM hosted_prompt_batch_progress p WHERE run_id=$1",
              [run.runId],
            )
          ).rows,
          prefix,
        );
        const state = (
          await executor.query(
            "SELECT discarded_cost_micro_usd, operator_resume_count FROM hosted_prompt_runs WHERE id=$1",
            [run.runId],
          )
        ).rows[0];
        assert.equal(Number(state.discarded_cost_micro_usd), 10000);
        assert.equal(state.operator_resume_count, 0);
      });
    });

test("0283 permits only Luna literal-character corrections after recording the exact invalid response", async () => {
  const styleHash = NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH;
  const treatment = {
    schema_version: "image-style-treatment/v2",
    style_profile_hash: styleHash,
    medium_family: "documentary photography",
    realism: "physically believable still image",
    camera_language: "observational",
    image_framing: "crop-safe",
    shot_scale_preferences: ["hands and action"],
    lighting: "daylight",
    palette: { descriptors: ["true-to-life"], approximate_hex: [] },
    contrast_and_exposure: "natural",
    depth_of_field: "natural",
    texture_and_grain: "ordinary",
    imperfection_profile: ["wear"],
    mood: ["grounded"],
  };
  const batch = {
    ...buildPromptBatch({
      batchId: "luna-literal-batch",
      projectTitle: "Harvest Water Without Pumps",
      imageStyleVersionId: "style",
      styleProfileHash: styleHash,
      styleTreatment: treatment,
      plannerGuidance: "authentic documentary photography",
      storyContext: "Compact documentary account of farm irrigation steps.",
      continuityTags: ["same_farmer", "dry_season"],
      scenes: [0, 1].map((index) => ({
        sceneId: `scene_${String(index + 1).padStart(3, "0")}`,
        phrase: `Hands demonstrate irrigation valve step ${index + 1}`,
        sentenceContext: `Hands demonstrate irrigation valve step ${index + 1}.`,
        priorContext: index === 0 ? null : `Prior step ${index}`,
        nextContext: index === 1 ? null : `Next step ${index + 2}`,
        inImageShotRole: "HANDS_ACTION",
        layout: "IMAGE_FULL",
      })),
    }),
    styleProfileHash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
    styleTreatment: { ...treatment, style_profile_hash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH },
    literalCharacterLimit: 180,
  };
  const original = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    1,
    null,
    1,
    "runware-luna-grounded-v1",
  );
  const originalPayload = JSON.parse(original.request.messages[0].content);
  const rows = originalPayload.scenes.map((scene, index) => ({
    scene_id: scene.scene_id,
    literal_subject: "Hands demonstrate an irrigation valve.",
    action: "Hands demonstrate the irrigation valve step.",
    environment: "Close view shows hands at an irrigation valve.",
    in_image_shot_role: scene.in_image_shot_role,
    lighting_context: "Available daylight.",
    continuity_tags: ["same farmer", "dry season"],
    prompt_core: `Close view of hands demonstrating irrigation valve step ${index + 1} in a farm setting.`,
  }));
  const source = JSON.stringify({
    batch_id: originalPayload.batch_id,
    scenes: rows.map((row, index) =>
      index === 1
        ? {
            ...row,
            literal_subject: `${row.literal_subject} ${"Hands demonstrate the irrigation valve step. ".repeat(2)}`,
            action: `${row.action} ${"Hands demonstrate the irrigation valve step. ".repeat(2)}`,
            environment: `${row.environment} ${"Hands demonstrate the irrigation valve step. ".repeat(2)}`,
          }
        : row,
    ),
  });
  const correction = buildRunwarePromptCorrection(batch, source, "runware-luna-grounded-v1");
  assert.ok(correction);
  assert.deepEqual(correction.failedSceneIds, ["scene_002"]);
  assert.ok(
    correction.failures.some(
      (failure) => failure.field === "scene" && failure.reason === "literal_character_limit",
    ),
  );
  assert.equal(original.requestVersion, "runware-gpt-6-luna-prompt-request-v38");
  const replacement = buildRunwarePromptRequest(
    batch,
    batch.scenes,
    2,
    original.requestSha256,
    1,
    "runware-luna-grounded-v1",
    "no-text-v2",
    correction,
  );
  const replacementPayload = JSON.parse(replacement.request.messages[0].content);
  assert.equal(original.request.model, "openai:gpt@6-luna");
  assert.equal(original.request.settings.thinkingLevel, "low");
  assert(original.request.settings.maxTokens > 0 && original.request.settings.maxTokens <= 6_144);
  assert.deepEqual(replacementPayload.scenes, [originalPayload.scenes[1]]);
  assert.equal(replacement.requestVersion, original.requestVersion);
  assert.deepEqual(replacement.request.jsonSchema, original.request.jsonSchema);

  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const authority = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 2,
      materializeRun: false,
      reservedMicroUsd: 500_000,
    });
    await seedSucceededVoiceoverContext(executor, 2_831_000);
    await executor.query("SELECT videoforge_prepare_hosted_prompt_run($1::jsonb)", [
      JSON.stringify({
        account_id: IDS.accountA,
        workspace_id: IDS.workspaceA,
        user_id: IDS.userA,
        project_id: IDS.projectA,
        revision_id: IDS.revisionA,
        timeline_id: authority.timelineId,
        task_id: authority.taskId,
        attempt_id: authority.attemptId,
        outbox_id: authority.outboxId,
        execution_profile_id: authority.profileId,
        reservation_cost_event_id: uuid(2_831_011),
        run_id: authority.runId,
        input_hash: authority.inputHash,
        claim_token_hash: authority.claimHash,
        timeline_hash: authority.timelineHash,
        batch_plan_hash: authority.batchPlanHash,
        reserved_cost_micro_usd: 500_000,
        planned_batch_count: 2,
        planned_scene_count: 2,
        request_policy: "runware-luna-grounded-v1",
      }),
    ]);
    await executor.query("SELECT videoforge_claim_hosted_prompt_batch($1,0,$2,$3,$4)", [
      authority.runId,
      original.request.taskUUID,
      original.requestBytes,
      sha256(original.requestBytes),
    ]);
    const estimatedCostMicroUsd = 2;
    await executor.query("SELECT videoforge_record_hosted_prompt_response($1,$2,$3,$4::jsonb)", [
      authority.runId,
      original.request.taskUUID,
      original.requestSha256,
      JSON.stringify({
        status: "succeeded",
        outputText: source,
        usage: {
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 12,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 1,
        },
        costUsd: estimatedCostMicroUsd / 1_000_000,
        estimatedCostMicroUsd,
        costBasis: "PINNED_RATE_ESTIMATE",
        responseId: "chatcmpl-luna-literal-invalid",
        wireHash: sha256("actual canonical Luna wire request"),
        providerModel: "openai:gpt@6-luna",
        finishReason: "stop",
        latencyMs: 1,
      }),
    ]);
    const claimId = (
      await executor.query("SELECT id FROM hosted_prompt_batch_claims WHERE run_id=$1", [
        authority.runId,
      ])
    ).rows[0].id;
    const valid = await executor.query(
      "SELECT videoforge_hosted_prompt_scene_correction_matches($1::jsonb,$2::jsonb,$3,$4,$5,$6,$7,$8) AS valid",
      [
        JSON.stringify(originalPayload),
        JSON.stringify(replacementPayload),
        sha256(source),
        authority.runId,
        claimId,
        original.request.taskUUID,
        original.requestSha256,
        estimatedCostMicroUsd,
      ],
    );
    assert.equal(valid.rows[0].valid, true);
    assert.equal(
      (
        await executor.query(
          "SELECT videoforge_replace_invalid_hosted_prompt_batch($1,0,$2,$3,$4,$5,$6) AS claimed",
          [
            authority.runId,
            original.request.taskUUID,
            sha256(source),
            estimatedCostMicroUsd,
            replacement.requestBytes,
            replacement.requestSha256,
          ],
        )
      ).rows[0].claimed,
      true,
    );
    assert.equal(
      (
        await executor.query(
          "SELECT provider_task_uuid,request_bytes FROM hosted_prompt_batch_replacements WHERE run_id=$1",
          [authority.runId],
        )
      ).rows[0].provider_task_uuid,
      replacement.request.taskUUID,
    );
  });

  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const legacy = await seedAdaptivePromptRun(executor, { sceneCount: 2, plannedBatchCount: 1 });
    const result = await executor.query(
      "SELECT videoforge_hosted_prompt_scene_correction_matches($1::jsonb,$2::jsonb,$3,$4,$5,$6,$7,2) AS valid",
      [
        JSON.stringify(originalPayload),
        JSON.stringify(replacementPayload),
        sha256(source),
        legacy.runId,
        uuid(2_831_100),
        original.request.taskUUID,
        original.requestSha256,
      ],
    );
    assert.equal(result.rows[0].valid, false);
  });
});
