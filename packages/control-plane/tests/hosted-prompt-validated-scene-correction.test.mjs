import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPromptBatch,
  buildRunwarePromptRequest,
  buildRunwarePromptCorrection,
} from "../../pipeline/dist/src/index.js";
import {
  seedAdaptivePromptRun,
  scenePayload,
} from "./hosted-prompt-adaptive-batches-migration.test.mjs";
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
