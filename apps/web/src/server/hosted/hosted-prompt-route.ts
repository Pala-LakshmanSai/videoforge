import type { HostedExecutionContext } from "./auth";
import type { HostedRuntimeConfiguration } from "./configuration";
import { sha256 } from "./crypto";
import {
  hostedPromptAuthority,
  hostedPromptBatchPlan,
  hostedPromptBatchPlanDocument,
  runHostedPromptExecution,
  type HostedPromptIdentity,
} from "./hosted-prompt-run";
import {
  parseHostedJson,
  plainRecord,
  response,
  sameOrigin,
  sessionScope,
} from "./hosted-product-route-common";
import { createNeonExecutor, createNeonPool } from "./neon";
import {
  HOSTED_PROMPT_RESERVATION_MICRO_USD,
  HostedPromptExecutionError,
  type HostedPromptBatchPlanBinding,
} from "./runware-prompt-execution";
import { canonicalJson } from "./submission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const PROMPTS_PATH = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/prompts$/u;

/**
 * How many prompt-writing attempts one revision may spend in total (the first run plus bounded
 * redispatches) before the product stops re-dispatching it.
 *
 * Runware's text backend is intermittently unavailable: the same request that returned a valid
 * result can answer `502 Bad Gateway` from the provider's own proxy several times in a row, and a
 * provider failure during prompt writing leaves no durable accepted prompt set. With a budget of
 * one the revision stranded at stage 5 forever, so this mirrors the voiceover-context rule with
 * enough headroom to ride out a bad provider window. Each attempt is separately reserved and the
 * spend guard is unchanged.
 */
const HOSTED_PROMPT_ATTEMPT_BUDGET = 6;

/**
 * Problem codes that mean the provider never gave a usable prompt set, so the attempt carries no
 * information about the plan or the style and a redispatch is the only path forward.
 *
 * Deliberately excluded: `HOSTED_PROMPT_OUTPUT_INVALID` / `HOSTED_PROMPT_*_REJECTED` (the provider
 * answered, and the answer was wrong -- retrying the same request reproduces the same defect), and
 * every acceptance-path code, because those already produced a durable result.
 */
const HOSTED_PROMPT_RETRYABLE_PROBLEM_CODES = new Set([
  "HOSTED_PROMPT_EXECUTION_UNKNOWN",
  "HOSTED_PROMPT_PROVIDER_UNAVAILABLE",
]);

/**
 * Whether an existing prompt run may be replaced by one bounded redispatch.
 *
 * True only when the stored run failed in a provider/transport class, it never produced a durable
 * accepted prompt set (so no accepted work can be lost or paid for twice), and the revision still
 * has attempts left. An in-flight run, a rejected or invalid result, or a spent budget all refuse.
 */
export function hostedPromptRedispatchable(planRecord: Record<string, unknown>): boolean {
  const state = planRecord.existing_run_state;
  if (state !== "FAILED" && state !== "UNKNOWN") return false;
  if (planRecord.existing_run_has_accepted_set === true) return false;
  const problemCode =
    typeof planRecord.existing_run_problem_code === "string" ? planRecord.existing_run_problem_code : "";
  if (!HOSTED_PROMPT_RETRYABLE_PROBLEM_CODES.has(problemCode)) return false;
  const attemptsSoFar = Number(planRecord.existing_run_count ?? 0);
  return (
    Number.isInteger(attemptsSoFar) && attemptsSoFar > 0 && attemptsSoFar < HOSTED_PROMPT_ATTEMPT_BUDGET
  );
}


async function writeProjectPrompts(
  request: Request,
  projectId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!config.styleAnalysis)
    return response({ error: { code: "HOSTED_PROMPT_PROVIDER_UNAVAILABLE" } }, 503);
  const promptApiKey = config.styleAnalysis.apiKey;
  const pool = createNeonPool(config.neon.databaseUrl);
  let runId: string | null = null;
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const body = await parseHostedJson(request, "HOSTED_PROMPT_REQUEST_REJECTED", 4_096);
    if (body instanceof Response) return body;
    if (plainRecord(body)?.maximum_prompt_spend_micro_usd !== HOSTED_PROMPT_RESERVATION_MICRO_USD)
      return response({ error: { code: "HOSTED_PROMPT_SPEND_CONFIRMATION_REQUIRED" } }, 400);
    const plan = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const loaded = await transaction.query<{ plan: unknown }>(
        "SELECT public.videoforge_load_hosted_prompt_plan($1,$2,$3,$4) AS plan",
        [scope.account_id, scope.workspace_id, scope.user_id, projectId],
      );
      return loaded.rows[0]?.plan ?? null;
    });
    const planRecord = plainRecord(plan);
    if (!planRecord) return response({ error: { code: "HOSTED_PROMPT_PLAN_NOT_READY" } }, 409);
    const existingState = planRecord.existing_run_state;
    if (existingState === "SUCCEEDED")
      return response({
        schema_version: "videoforge-hosted-prompt-response/v1",
        state: "COMPLETE",
        replayed: true,
      });
    // A provider failure that left no accepted prompt set used to strand the revision here
    // forever: every later POST /prompts answered 409, so the pipeline could never leave stage 5.
    // The gate grants a bounded redispatch for exactly that case and refuses everything else, so the
    // spend guard and the acceptance rules are unchanged. The approval also has to reach the
    // authority, which otherwise refuses any plan that already owns a run.
    const redispatchApproved = existingState !== null && hostedPromptRedispatchable(planRecord);
    if (existingState !== null && !redispatchApproved)
      return response(
        {
          error: {
            code: "HOSTED_PROMPT_EXECUTION_ALREADY_CLAIMED",
            message:
              "The prompt request already has a durable terminal or in-flight claim and cannot be redispatched.",
          },
        },
        409,
      );
    const identity: HostedPromptIdentity = {
      runId: crypto.randomUUID(),
      taskId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      outboxId: crypto.randomUUID(),
      executionProfileId: crypto.randomUUID(),
      reservationCostEventId: crypto.randomUUID(),
      claimTokenHash: await sha256(`hosted-prompt-claim:${crypto.randomUUID()}:${projectId}`),
    };
    const authority = hostedPromptAuthority({
      plan,
      identity,
      reservedCostMicroUsd: HOSTED_PROMPT_RESERVATION_MICRO_USD,
      redispatchApproved,
    });
    const batchPlan = hostedPromptBatchPlan(authority);
    const batchPlanHash = await sha256(canonicalJson(hostedPromptBatchPlanDocument(batchPlan)));
    const prepared = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<{ prepared: unknown }>(
        "SELECT public.videoforge_prepare_hosted_prompt_run($1::jsonb) AS prepared",
        [
          JSON.stringify({
            account_id: scope.account_id,
            workspace_id: scope.workspace_id,
            user_id: scope.user_id,
            project_id: projectId,
            revision_id: authority.revisionId,
            timeline_id: authority.timelineId,
            timeline_hash: authority.timelineHash,
            run_id: identity.runId,
            task_id: identity.taskId,
            attempt_id: identity.attemptId,
            outbox_id: identity.outboxId,
            execution_profile_id: identity.executionProfileId,
            reservation_cost_event_id: identity.reservationCostEventId,
            input_hash: authority.recordedInputHash,
            claim_token_hash: identity.claimTokenHash,
            reserved_cost_micro_usd: HOSTED_PROMPT_RESERVATION_MICRO_USD,
            planned_batch_count: batchPlan.batchCount,
            planned_scene_count: batchPlan.totalScenes,
            batch_plan_hash: batchPlanHash,
            // Only ever true when the provider-failure gate above approved replacing an attempt that
            // produced no accepted prompt set; the claim function refuses otherwise.
            redispatch: redispatchApproved,
          }),
        ],
      );
      return plainRecord(result.rows[0]?.prepared);
    });
    if (!prepared || prepared.created !== true)
      return response({ error: { code: "HOSTED_PROMPT_EXECUTION_ALREADY_CLAIMED" } }, 409);
    runId = identity.runId;
    const preparedBatchCount = prepared.planned_batch_count;
    const preparedSceneCount = prepared.planned_scene_count;
    const preparedBatchPlanHash = prepared.batch_plan_hash;
    if (
      typeof preparedBatchCount !== "number" ||
      !Number.isSafeInteger(preparedBatchCount) ||
      preparedBatchCount < 1 ||
      typeof preparedSceneCount !== "number" ||
      !Number.isSafeInteger(preparedSceneCount) ||
      preparedSceneCount < 1 ||
      typeof preparedBatchPlanHash !== "string" ||
      !SHA256.test(preparedBatchPlanHash) ||
      !SHA256.test(batchPlanHash) ||
      preparedBatchCount !== batchPlan.batchCount ||
      preparedSceneCount !== batchPlan.totalScenes ||
      preparedBatchPlanHash !== batchPlanHash
    ) {
      throw new HostedPromptExecutionError("HOSTED_PROMPT_INPUT_INVALID", "FAILED", false, null);
    }
    const persistedBatchPlanBinding: HostedPromptBatchPlanBinding = {
      plannedBatchCount: preparedBatchCount,
      plannedSceneCount: preparedSceneCount,
      batchPlanHash: preparedBatchPlanHash as HostedPromptBatchPlanBinding["batchPlanHash"],
    };
    const accepted = await runHostedPromptExecution({
      scope: { workspaceId: scope.workspace_id, actorUserId: scope.user_id },
      authority,
      batchPlan,
      persistedBatchPlanBinding,
      command: {
        projectId,
        revisionId: authority.revisionId,
        timelineId: authority.timelineId,
        taskId: identity.taskId,
        attemptId: identity.attemptId,
        outboxId: identity.outboxId,
        presentedClaimTokenHash: identity.claimTokenHash,
      },
      apiKey: promptApiKey,
      persistBatch: async (batch) => {
        const recorded = await createNeonExecutor(pool).transaction(async (transaction) => {
          await transaction.query("SELECT set_config($1, $2, true)", [
            "videoforge.account_id",
            scope.account_id,
          ]);
          const result = await transaction.query<{ recorded: boolean }>(
            "SELECT public.videoforge_record_hosted_prompt_batch($1,$2::jsonb) AS recorded",
            [
              identity.runId,
              JSON.stringify({
                batch_ordinal: batch.batchOrdinal,
                first_scene_ordinal: batch.firstSceneOrdinal,
                request_bytes: batch.requestBytes,
                request_hash: batch.requestHash,
                response_bytes: batch.responseBytes,
                response_hash: batch.responseHash,
                input_tokens: batch.inputTokens,
                output_tokens: batch.outputTokens,
                reported_cost_micro_usd: batch.reportedCostMicroUsd,
                scenes: batch.scenes.map((scene) => ({
                  scene_ordinal: scene.sceneOrdinal,
                  scene_id: scene.sceneId,
                  writer_output: scene.writerOutput,
                  compiled_prompt: scene.compiledPrompt,
                })),
              }),
            ],
          );
          return result.rows[0]?.recorded === true;
        });
        if (!recorded) throw new Error("HOSTED_PROMPT_BATCH_PROGRESS_REJECTED");
      },
      persist: async (acceptance) => {
        const completed = await createNeonExecutor(pool).transaction(async (transaction) => {
          await transaction.query("SELECT set_config($1, $2, true)", [
            "videoforge.account_id",
            scope.account_id,
          ]);
          const result = await transaction.query<{ completed: boolean }>(
            "SELECT public.videoforge_complete_hosted_prompt_run($1::jsonb) AS completed",
            [
              JSON.stringify({
                run_id: identity.runId,
                output_asset_id: crypto.randomUUID(),
                prompt_execution_id: crypto.randomUUID(),
                acceptance,
              }),
            ],
          );
          return result.rows[0]?.completed === true;
        });
        if (!completed) throw new Error("HOSTED_PROMPT_ACCEPTANCE_REJECTED");
      },
    });
    return response(
      {
        schema_version: "videoforge-hosted-prompt-response/v1",
        state: "COMPLETE",
        replayed: false,
        scene_count: accepted.compiledPrompts.length,
        prompt_cost_usd: accepted.reportedCostMicroUsd / 1_000_000,
      },
      202,
    );
  } catch (error) {
    const promptFailure =
      error instanceof HostedPromptExecutionError
        ? error
        : new HostedPromptExecutionError("HOSTED_PROMPT_EXECUTION_UNKNOWN", "UNKNOWN", true, null);
    if (runId) {
      try {
        const scope = await sessionScope(request, config, pool, executionContext);
        if (!(scope instanceof Response)) {
          await createNeonExecutor(pool).transaction(async (transaction) => {
            await transaction.query("SELECT set_config($1, $2, true)", [
              "videoforge.account_id",
              scope.account_id,
            ]);
            await transaction.query(
              "SELECT public.videoforge_fail_hosted_prompt_run($1,$2,$3,$4,$5)",
              [
                runId,
                promptFailure.terminalState,
                promptFailure.problemCode,
                promptFailure.providerMayHaveCharged,
                promptFailure.additionalKnownCostMicroUsd,
              ],
            );
          });
        }
      } catch {
        // The durable DISPATCHING claim still prevents a blind provider redispatch.
      }
    }
    console.error("HOSTED_PROMPT_EXECUTION_FAILURE", {
      error_name: error instanceof Error ? error.name : "Error",
      problem_code: promptFailure.problemCode,
      terminal_state: promptFailure.terminalState,
      provider_may_have_charged: promptFailure.providerMayHaveCharged,
      additional_known_cost_micro_usd: promptFailure.additionalKnownCostMicroUsd,
      stage: promptFailure.diagnostic?.stage ?? null,
      http_status: promptFailure.diagnostic?.httpStatus ?? null,
      provider_code: promptFailure.diagnostic?.providerCode ?? null,
      provider_parameter: promptFailure.diagnostic?.providerParameter ?? null,
      validation_category: promptFailure.validationDiagnostic?.category ?? null,
      validation_reason: promptFailure.validationDiagnostic?.reason ?? null,
      requested_scene_count: promptFailure.validationDiagnostic?.requestedSceneCount ?? null,
      returned_scene_count: promptFailure.validationDiagnostic?.returnedSceneCount ?? null,
      locally_valid_scene_count: promptFailure.validationDiagnostic?.locallyValidSceneCount ?? null,
      unresolved_scene_count: promptFailure.validationDiagnostic?.unresolvedSceneCount ?? null,
    });
    return response(
      {
        error: {
          code: promptFailure.problemCode,
          message:
            promptFailure.terminalState === "FAILED"
              ? "Image prompt writing was rejected before VideoForge accepted a result. The request will not be automatically repeated."
              : "Image prompt writing stopped without a durable accepted result. The request will not be automatically repeated.",
        },
      },
      409,
    );
  } finally {
    await pool.end();
  }
}

export async function handleHostedPromptRequest(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response | null> {
  const match = PROMPTS_PATH.exec(new URL(request.url).pathname);
  if (request.method !== "POST" || !match) return null;
  return writeProjectPrompts(request, match[1]!, config, executionContext);
}
