import type { HostedExecutionContext } from "./auth";
import type { CompiledImagePrompt } from "@videoforge/pipeline/prompts";
import type { HostedRuntimeConfiguration } from "./configuration";
import { sha256 } from "./crypto";
import {
  hostedPromptAuthority,
  hostedPromptBatchPlan,
  hostedPromptBatchPlanDocument,
  compileAndPersistHostedPromptBatch,
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
import type { ContinuationScope } from "./stage-continuation";
import {
  HOSTED_PROMPT_RESERVATION_MICRO_USD,
  HostedPromptExecutionError,
  HostedPromptArchivedOutputInvalidError,
  hostedPromptReservationMicroUsd,
  hostedPromptBatchPlanHash,
  recoverClaimedHostedPromptBatch,
  dispatchOneHostedPromptBatch,
  type HostedPromptBatchPlanBinding,
  type HostedRecoveredPromptBatch,
} from "./runware-prompt-execution";
import { canonicalJson } from "./submission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const PROMPTS_PATH = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/prompts$/u;

type PromptBatchReceipt = Parameters<
  NonNullable<Parameters<typeof runHostedPromptExecution>[0]["persistBatch"]>
>[0];

async function claimHostedPromptBatch(
  pool: ReturnType<typeof createNeonPool>,
  accountId: string,
  runId: string,
  request: { batchOrdinal: number; taskUUID: string; requestBytes: string; requestHash: string },
): Promise<boolean> {
  return createNeonExecutor(pool).transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1, $2, true)", [
      "videoforge.account_id",
      accountId,
    ]);
    const result = await transaction.query<{ claimed: boolean }>(
      "SELECT public.videoforge_claim_hosted_prompt_batch($1,$2,$3,$4,$5) AS claimed",
      [runId, request.batchOrdinal, request.taskUUID, request.requestBytes, request.requestHash],
    );
    return result.rows[0]?.claimed === true;
  });
}

async function recordHostedPromptBatch(
  pool: ReturnType<typeof createNeonPool>,
  accountId: string,
  runId: string,
  batch: PromptBatchReceipt,
  recoveredTaskUUID?: string,
): Promise<void> {
  const recorded = await createNeonExecutor(pool).transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1, $2, true)", [
      "videoforge.account_id",
      accountId,
    ]);
    const payload = JSON.stringify({
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
    });
    const result = recoveredTaskUUID
      ? await transaction.query<{ recorded: boolean }>(
          "SELECT public.videoforge_recover_hosted_prompt_batch($1,$2,$3::jsonb) AS recorded",
          [runId, recoveredTaskUUID, payload],
        )
      : await transaction.query<{ recorded: boolean }>(
          "SELECT public.videoforge_record_hosted_prompt_batch($1,$2::jsonb) AS recorded",
          [runId, payload],
        );
    return result.rows[0]?.recorded === true;
  });
  if (!recorded) throw new Error("HOSTED_PROMPT_BATCH_PROGRESS_REJECTED");
}

async function loadAcceptedPromptBatches(
  pool: ReturnType<typeof createNeonPool>,
  accountId: string,
  workspaceId: string,
  runId: string,
): Promise<{
  readonly batches: HostedRecoveredPromptBatch[];
  readonly compiledPrompts: ReadonlyMap<string, CompiledImagePrompt>;
}> {
  return createNeonExecutor(pool).transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1, $2, true)", [
      "videoforge.account_id",
      accountId,
    ]);
    const batches = await transaction.query<{
      id: string;
      batch_ordinal: number;
      first_scene_ordinal: number;
      request_bytes: string;
      request_hash: string;
      response_bytes: string;
      response_hash: string;
      input_tokens: number;
      output_tokens: number;
      reported_cost_micro_usd: number;
    }>(
      `SELECT id,batch_ordinal,first_scene_ordinal,request_bytes,request_hash,response_bytes,
              response_hash,input_tokens,output_tokens,
              reported_cost_micro_usd::integer AS reported_cost_micro_usd
         FROM public.hosted_prompt_batch_progress
        WHERE account_id=$1 AND workspace_id=$2 AND run_id=$3 ORDER BY batch_ordinal`,
      [accountId, workspaceId, runId],
    );
    const scenes = await transaction.query<{
      batch_progress_id: string;
      scene_ordinal: number;
      scene_id: string;
      writer_output: HostedRecoveredPromptBatch["scenes"][number]["writerOutput"];
      compiled_prompt: CompiledImagePrompt;
    }>(
      `SELECT batch_progress_id,scene_ordinal,scene_id,writer_output,compiled_prompt
         FROM public.hosted_prompt_scene_progress
        WHERE account_id=$1 AND workspace_id=$2 AND run_id=$3 ORDER BY scene_ordinal`,
      [accountId, workspaceId, runId],
    );
    const compiledPrompts = new Map<string, CompiledImagePrompt>();
    for (const scene of scenes.rows) {
      if (compiledPrompts.has(scene.scene_id)) throw new Error("HOSTED_PROMPT_SCENE_DUPLICATE");
      compiledPrompts.set(scene.scene_id, scene.compiled_prompt);
    }
    const acceptedBatches = batches.rows.map((batch) => ({
      batchOrdinal: batch.batch_ordinal,
      firstSceneOrdinal: batch.first_scene_ordinal,
      scenes: scenes.rows
        .filter((scene) => scene.batch_progress_id === batch.id)
        .map((scene) => ({
          sceneOrdinal: scene.scene_ordinal,
          sceneId: scene.scene_id,
          writerOutput: scene.writer_output,
        })),
      requestBytes: batch.request_bytes,
      requestHash: batch.request_hash as HostedRecoveredPromptBatch["requestHash"],
      responseBytes: batch.response_bytes,
      responseHash: batch.response_hash as HostedRecoveredPromptBatch["responseHash"],
      inputTokens: batch.input_tokens,
      outputTokens: batch.output_tokens,
      reportedCostMicroUsd: batch.reported_cost_micro_usd,
    }));
    if (acceptedBatches.reduce((sum, batch) => sum + batch.scenes.length, 0) !== compiledPrompts.size)
      throw new Error("HOSTED_PROMPT_ACCEPTED_SCENE_COUNT_DRIFT");
    return { batches: acceptedBatches, compiledPrompts };
  });
}

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
// Bounded like the stage-3 context budget (30), and for the same reason: a recovery path that gives
// up after a handful of attempts strands the run again, while every attempt is still a bounded,
// recorded provider call. The window the sweep needs is measured from the attempt's own start, so a
// live batch is never replaced.
const HOSTED_PROMPT_ATTEMPT_BUDGET = 30;

/**
 * How long a prompt run may read DISPATCHING with no accepted scene before the route treats it as
 * stranded.
 *
 * The continuation sweep uses this window to notice a stranded attempt. The route keeps that
 * attempt on hold because the provider may have processed a request before the runner stopped.
 */
export const HOSTED_PROMPT_STALE_RUN_MS = 15 * 60 * 1000;

/**
 * Problem codes that mean the provider never gave a usable prompt set, so the attempt carries no
 * information about the plan or the style and a redispatch is the only path forward.
 *
 * Deliberately excluded: `HOSTED_PROMPT_OUTPUT_INVALID` / `HOSTED_PROMPT_*_REJECTED` (the provider
 * answered, and the answer was wrong -- retrying the same request reproduces the same defect), and
 * every acceptance-path code, because those already produced a durable result.
 */
/** Exported so the continuation sweep offers exactly the classes this route will accept. */
export const HOSTED_PROMPT_RETRYABLE_PROBLEM_CODES = new Set([
  "HOSTED_PROMPT_EXECUTION_UNKNOWN",
  "HOSTED_PROMPT_PROVIDER_UNAVAILABLE",
  // Set by the stale-dispatch reconciliation when a run's dispatch died in flight and was settled as
  // UNKNOWN. Nothing was accepted, so it is the same provider/transport class as the codes above, and
  // without it in this set the reconciliation's own verdict could never be redispatched.
  "HOSTED_PROMPT_DISPATCH_TIMEOUT",
]);

/**
 * Whether an existing prompt run may be replaced by one bounded redispatch.
 *
 * True only when the stored run has a definite provider-free failure, no accepted prompt set, and
 * attempts left. An in-flight or potentially charged run remains on hold.
 */
export function hostedPromptRedispatchable(
  planRecord: Record<string, unknown>,
  staleInFlight = false,
): boolean {
  const state = planRecord.existing_run_state;
  // A stranded request may have reached Runware before its Worker invocation ended. A missing
  // response is not proof that the provider did no work, so leave it for identity-based review.
  if (state === "DISPATCHING" || planRecord.existing_run_provider_may_have_charged !== false)
    return false;
  const retryable =
    state === "FAILED" || state === "UNKNOWN" || (staleInFlight && state === "DISPATCHING");
  if (!retryable) return false;
  if (planRecord.existing_run_has_accepted_set === true) return false;
  const problemCode =
    typeof planRecord.existing_run_problem_code === "string"
      ? planRecord.existing_run_problem_code
      : "";
  // A stale in-flight run records no problem code at all: its batch request died before the provider
  // answered, which is the same provider-side class the retryable set exists for.
  if (!staleInFlight && !HOSTED_PROMPT_RETRYABLE_PROBLEM_CODES.has(problemCode)) return false;
  const redispatchesSoFar = Number(planRecord.existing_run_redispatch_count ?? 0);
  return (
    Number.isInteger(redispatchesSoFar) &&
    redispatchesSoFar >= 0 &&
    redispatchesSoFar < HOSTED_PROMPT_ATTEMPT_BUDGET - 1
  );
}

export async function writeProjectPrompts(
  request: Request,
  projectId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
  /** Set only by server-side stage continuation, which already holds a validated scope. */
  internalScope?: ContinuationScope,
  acceptedHandoff?: (scope: ContinuationScope, projectId: string) => Promise<void>,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!config.styleAnalysis)
    return response({ error: { code: "HOSTED_PROMPT_PROVIDER_UNAVAILABLE" } }, 503);
  const promptApiKey = config.styleAnalysis.apiKey;
  const pool = createNeonPool(config.neon.databaseUrl);
  const startedAt = Date.now();
  const trace = (phase: string) =>
    console.warn(
      `hosted_prompt_phase project=${projectId} phase=${phase} elapsed_ms=${Date.now() - startedAt}`,
    );
  let runId: string | null = null;
  // The settle below needs the same tenant scope the handler derived. A continuation request (the
  // sweep) carries no cookie, so re-deriving it there returns a 401 Response, the settle is skipped
  // and a failed run stays DISPATCHING with nothing recording why. Keep the resolved scope instead.
  let settleScope: { readonly account_id: string } | null = null;
  try {
    const scope = internalScope ?? (await sessionScope(request, config, pool, executionContext));
    if (scope instanceof Response) return scope;
    trace("scope");
    settleScope = scope;
    const body = await parseHostedJson(request, "HOSTED_PROMPT_REQUEST_REJECTED", 4_096);
    if (body instanceof Response) return body;
    if (plainRecord(body)?.maximum_prompt_spend_micro_usd !== HOSTED_PROMPT_RESERVATION_MICRO_USD)
      return response({ error: { code: "HOSTED_PROMPT_SPEND_CONFIRMATION_REQUIRED" } }, 400);
    const plan = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const loaded = await transaction.query<{
        plan: unknown;
        run_started_at: string | null;
        run_reserved_cost_micro_usd: number | null;
      }>(
        `SELECT public.videoforge_load_hosted_prompt_plan($1,$2,$3,$4) AS plan,
                (SELECT coalesce(run.started_at, run.created_at)::text
                   FROM public.hosted_prompt_runs run
                   JOIN public.project_revisions revision ON revision.id = run.project_revision_id
                  WHERE run.account_id = $1 AND run.workspace_id = $2 AND revision.project_id = $4
                  ORDER BY run.created_at DESC LIMIT 1) AS run_started_at,
                (SELECT run.reserved_cost_micro_usd::integer
                   FROM public.hosted_prompt_runs run
                   JOIN public.project_revisions revision ON revision.id = run.project_revision_id
                  WHERE run.account_id = $1 AND run.workspace_id = $2 AND revision.project_id = $4
                  ORDER BY run.created_at DESC LIMIT 1) AS run_reserved_cost_micro_usd`,
        [scope.account_id, scope.workspace_id, scope.user_id, projectId],
      );
      return {
        plan: loaded.rows[0]?.plan ?? null,
        runStartedAt: loaded.rows[0]?.run_started_at ?? null,
        runReservedCostMicroUsd: loaded.rows[0]?.run_reserved_cost_micro_usd ?? null,
      };
    });
    trace("plan");
    const planRecord = plainRecord(plan.plan);
    if (!planRecord) return response({ error: { code: "HOSTED_PROMPT_PLAN_NOT_READY" } }, 409);
    const existingState = planRecord.existing_run_state;
    if (existingState === "SUCCEEDED")
      return response({
        schema_version: "videoforge-hosted-prompt-response/v1",
        state: "COMPLETE",
        replayed: true,
      });
    if (existingState === "DISPATCHING" || existingState === "UNKNOWN") {
      const original = await createNeonExecutor(pool).transaction(async (transaction) => {
        await transaction.query("SELECT set_config($1, $2, true)", [
          "videoforge.account_id",
          scope.account_id,
        ]);
        const run = await transaction.query<{
          id: string;
          task_id: string;
          attempt_id: string;
          outbox_id: string;
          execution_profile_id: string;
          claim_token_hash: string;
          input_hash: string;
          reserved_cost_micro_usd: number;
          planned_batch_count: number;
          planned_scene_count: number;
          batch_plan_hash: string;
          accepted_batch_count: number;
          accepted_scene_count: number;
          accepted_cost_micro_usd: number;
        }>(
          `SELECT run.id,run.task_id,run.attempt_id,run.outbox_id,run.execution_profile_id,
                  run.claim_token_hash,run.input_hash,run.reserved_cost_micro_usd::integer AS reserved_cost_micro_usd,
                  run.planned_batch_count,run.planned_scene_count,run.batch_plan_hash,
                  (SELECT count(*)::integer FROM public.hosted_prompt_batch_progress progress
                    WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
                      AND progress.run_id=run.id) AS accepted_batch_count,
                  (SELECT coalesce(sum(progress.scene_count),0)::integer
                     FROM public.hosted_prompt_batch_progress progress
                    WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
                      AND progress.run_id=run.id) AS accepted_scene_count,
                  (SELECT coalesce(sum(progress.reported_cost_micro_usd),0)::integer
                     FROM public.hosted_prompt_batch_progress progress
                    WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
                      AND progress.run_id=run.id) AS accepted_cost_micro_usd
             FROM public.hosted_prompt_runs run
            WHERE run.account_id=$1 AND run.workspace_id=$2 AND run.project_id=$3
              AND run.project_revision_id=$4 AND run.state=$5
            LIMIT 1`,
          [
            scope.account_id,
            scope.workspace_id,
            projectId,
            typeof planRecord.revision_id === "string" ? planRecord.revision_id : "",
            existingState,
          ],
        );
        const saved = run.rows[0];
        if (!saved) return null;
        const claim = await transaction.query<{
          batch_ordinal: number;
          provider_task_uuid: string;
          request_bytes: string;
          request_hash: string;
        }>(
          `SELECT claim.batch_ordinal,claim.provider_task_uuid,claim.request_bytes,claim.request_hash
             FROM public.hosted_prompt_batch_claims claim
            WHERE claim.account_id=$1 AND claim.workspace_id=$2 AND claim.run_id=$3
              AND claim.task_id=$4 AND claim.attempt_id=$5 AND claim.outbox_id=$6
              AND claim.batch_ordinal=$7`,
          [
            scope.account_id,
            scope.workspace_id,
            saved.id,
            saved.task_id,
            saved.attempt_id,
            saved.outbox_id,
            saved.accepted_batch_count,
          ],
        );
        return { run: saved, claim: claim.rows[0] ?? null };
      });
      trace("original");
      if (original) {
        const saved = original.run;
        const identity: HostedPromptIdentity = {
          runId: saved.id,
          taskId: saved.task_id,
          attemptId: saved.attempt_id,
          outboxId: saved.outbox_id,
          executionProfileId: saved.execution_profile_id,
          reservationCostEventId: saved.id,
          claimTokenHash: saved.claim_token_hash as HostedPromptIdentity["claimTokenHash"],
        };
        const authority = hostedPromptAuthority({
          plan: planRecord,
          identity,
          reservedCostMicroUsd: saved.reserved_cost_micro_usd,
          redispatchApproved: true,
        });
        const batchPlan = hostedPromptBatchPlan(authority);
        const binding: HostedPromptBatchPlanBinding = {
          plannedBatchCount: saved.planned_batch_count,
          plannedSceneCount: saved.planned_scene_count,
          batchPlanHash: saved.batch_plan_hash as HostedPromptBatchPlanBinding["batchPlanHash"],
        };
        if (
          authority.recordedInputHash !== saved.input_hash ||
          batchPlan.batchCount !== binding.plannedBatchCount ||
          batchPlan.totalScenes !== binding.plannedSceneCount ||
          (await hostedPromptBatchPlanHash(batchPlan)) !== binding.batchPlanHash
        )
          throw new HostedPromptExecutionError(
            "HOSTED_PROMPT_INPUT_INVALID",
            "FAILED",
            false,
            null,
          );
        const completeAcceptedRun = async (): Promise<Response> => {
          trace("accepted_load_start");
          const storedProgress = await loadAcceptedPromptBatches(
            pool,
            scope.account_id,
            scope.workspace_id,
            saved.id,
          );
          trace("accepted_load_done");
          trace("execution_start");
          const accepted = await runHostedPromptExecution({
            scope: { workspaceId: scope.workspace_id, actorUserId: scope.user_id },
            authority,
            batchPlan,
            persistedBatchPlanBinding: binding,
            continuation: {
              reservationMicroUsd: saved.reserved_cost_micro_usd,
              acceptedBatches: storedProgress.batches,
              beforeBatchSubmit: async () => {
                throw new Error("HOSTED_PROMPT_COMPLETION_MUST_NOT_SUBMIT");
              },
            },
            acceptedCompiledPrompts: storedProgress.compiledPrompts,
            command: {
              projectId,
              revisionId: authority.revisionId,
              timelineId: authority.timelineId,
              taskId: saved.task_id,
              attemptId: saved.attempt_id,
              outboxId: saved.outbox_id,
              presentedClaimTokenHash: identity.claimTokenHash,
            },
            apiKey: promptApiKey,
            persist: async (acceptance) => {
              trace("persist_start");
              const completed = await createNeonExecutor(pool).transaction(async (transaction) => {
                await transaction.query("SELECT set_config($1, $2, true)", [
                  "videoforge.account_id",
                  scope.account_id,
                ]);
                if (existingState === "UNKNOWN") {
                  const reopened = await transaction.query<{ reopened: boolean }>(
                    "SELECT public.videoforge_reopen_complete_hosted_prompt_run($1::uuid) AS reopened",
                    [saved.id],
                  );
                  if (reopened.rows[0]?.reopened !== true)
                    throw new Error("HOSTED_PROMPT_ACCEPTED_REOPEN_REJECTED");
                }
                const result = await transaction.query<{ completed: boolean }>(
                  "SELECT public.videoforge_complete_hosted_prompt_run($1::jsonb) AS completed",
                  [
                    JSON.stringify({
                      run_id: saved.id,
                      output_asset_id: crypto.randomUUID(),
                      prompt_execution_id: crypto.randomUUID(),
                      acceptance,
                    }),
                  ],
                );
                return result.rows[0]?.completed === true;
              });
              if (!completed) throw new Error("HOSTED_PROMPT_ACCEPTANCE_REJECTED");
              trace("persist_done");
            },
          });
          trace("execution_done");
          trace("handoff_start");
          await handoffAcceptedHostedPrompts(
            config.apiGeneration !== undefined,
            acceptedHandoff,
            scope,
            projectId,
          );
          trace("handoff_done");
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
        };
        if (
          !original.claim &&
          (existingState === "DISPATCHING" || existingState === "UNKNOWN") &&
          saved.accepted_batch_count === saved.planned_batch_count &&
          saved.accepted_scene_count === saved.planned_scene_count
        )
          return await completeAcceptedRun();
        if (existingState === "UNKNOWN" && !original.claim)
          return response({ error: { code: "HOSTED_PROMPT_EXECUTION_ALREADY_CLAIMED" } }, 409);
        let acceptedBatch: Awaited<ReturnType<typeof recoverClaimedHostedPromptBatch>> | null;
        try {
          acceptedBatch = original.claim
          ? await recoverClaimedHostedPromptBatch({
              apiKey: promptApiKey,
              plan: batchPlan,
              persistedBinding: binding,
              batchOrdinal: original.claim.batch_ordinal,
              taskUUID: original.claim.provider_task_uuid,
              requestBytes: original.claim.request_bytes,
              requestHash: original.claim
                .request_hash as HostedPromptBatchPlanBinding["batchPlanHash"],
              reservationMicroUsd: saved.reserved_cost_micro_usd,
            })
          : existingState === "DISPATCHING" &&
              saved.accepted_batch_count < saved.planned_batch_count
            ? await dispatchOneHostedPromptBatch({
                apiKey: promptApiKey,
                plan: batchPlan,
                persistedBinding: binding,
                batchOrdinal: saved.accepted_batch_count,
                remainingReservationMicroUsd:
                  saved.reserved_cost_micro_usd - saved.accepted_cost_micro_usd,
                claim: (claim) => claimHostedPromptBatch(pool, scope.account_id, saved.id, claim),
              })
            : null;
        } catch (error) {
          if (!original.claim || !(error instanceof HostedPromptArchivedOutputInvalidError))
            throw error;
          const invalidClaim = original.claim;
          await createNeonExecutor(pool).transaction(async (transaction) => {
            await transaction.query("SELECT set_config($1, $2, true)", [
              "videoforge.account_id",
              scope.account_id,
            ]);
            await transaction.query(
              "SELECT public.videoforge_adjudicate_invalid_hosted_prompt_batch($1,$2,$3,$4)",
              [saved.id, invalidClaim.provider_task_uuid, error.responseHash, error.knownCostMicroUsd],
            );
          });
          return response({ error: { code: "HOSTED_PROMPT_OUTPUT_INVALID" } }, 409);
        }
        if (acceptedBatch)
          await compileAndPersistHostedPromptBatch(authority, acceptedBatch, (batch) =>
            recordHostedPromptBatch(
              pool,
              scope.account_id,
              saved.id,
              batch,
              existingState === "UNKNOWN" ? original.claim?.provider_task_uuid : undefined,
            ),
          );
        if (acceptedBatch && saved.accepted_batch_count + 1 === saved.planned_batch_count)
          return await completeAcceptedRun();
        return response(
          {
            schema_version: "videoforge-hosted-prompt-response/v1",
            state: "RUNNING",
            replayed: false,
            accepted_batch_count: saved.accepted_batch_count + (acceptedBatch ? 1 : 0),
            accepted_scene_count: saved.accepted_scene_count + (acceptedBatch?.scenes.length ?? 0),
            planned_batch_count: saved.planned_batch_count,
          },
          202,
        );
      }
    }
    // A provider failure that left no accepted prompt set used to strand the revision here
    // forever: every later POST /prompts answered 409, so the pipeline could never leave stage 5.
    // The gate grants a bounded redispatch for exactly that case and refuses everything else, so the
    // spend guard and the acceptance rules are unchanged. The approval also has to reach the
    // authority, which otherwise refuses any plan that already owns a run.
    //
    // A stale DISPATCHING run still has an uncertain provider outcome. The gate below refuses it.
    const runStartedAtMs =
      typeof plan.runStartedAt === "string" ? Date.parse(plan.runStartedAt) : Number.NaN;
    const staleInFlight =
      Number.isFinite(runStartedAtMs) && Date.now() - runStartedAtMs > HOSTED_PROMPT_STALE_RUN_MS;
    const redispatchApproved =
      existingState !== null && hostedPromptRedispatchable(planRecord, staleInFlight);
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
    const ceilingAuthority = hostedPromptAuthority({
      plan: planRecord,
      identity,
      reservedCostMicroUsd: HOSTED_PROMPT_RESERVATION_MICRO_USD,
      redispatchApproved,
    });
    const batchPlan = hostedPromptBatchPlan(ceilingAuthority);
    if (redispatchApproved && plan.runReservedCostMicroUsd === null)
      throw new HostedPromptExecutionError("HOSTED_PROMPT_INPUT_INVALID", "FAILED", false, null);
    const reservedCostMicroUsd = hostedPromptReservationMicroUsd(
      batchPlan.batchCount,
      redispatchApproved ? plan.runReservedCostMicroUsd : null,
    );
    const authority = Object.freeze({
      ...ceilingAuthority,
      reservedCostMicroUsd,
    });
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
            reserved_cost_micro_usd: reservedCostMicroUsd,
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
    // The claim tells us which run row it owns. A first dispatch creates it; an approved redispatch
    // rebinds the row that already exists and keeps its id. Every later step -- batch progress and the
    // failure settle -- must address the persisted run, not the freshly generated identity, or a
    // redispatch would report progress and failures against a run id that does not exist.
    const persistedRunId =
      typeof prepared.run_id === "string" && prepared.run_id.length > 0
        ? prepared.run_id
        : identity.runId;
    runId = persistedRunId;
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
    const firstBatch = await dispatchOneHostedPromptBatch({
      apiKey: promptApiKey,
      plan: batchPlan,
      persistedBinding: persistedBatchPlanBinding,
      batchOrdinal: 0,
      remainingReservationMicroUsd: reservedCostMicroUsd,
      claim: (claim) => claimHostedPromptBatch(pool, scope.account_id, persistedRunId, claim),
    });
    if (firstBatch)
      await compileAndPersistHostedPromptBatch(authority, firstBatch, (batch) =>
        recordHostedPromptBatch(pool, scope.account_id, persistedRunId, batch),
      );
    return response(
      {
        schema_version: "videoforge-hosted-prompt-response/v1",
        state: "RUNNING",
        replayed: false,
        accepted_batch_count: firstBatch ? 1 : 0,
        accepted_scene_count: firstBatch?.scenes.length ?? 0,
        planned_batch_count: batchPlan.batchCount,
      },
      202,
    );
  } catch (error) {
    const promptFailure =
      error instanceof HostedPromptExecutionError
        ? error
        : new HostedPromptExecutionError("HOSTED_PROMPT_EXECUTION_UNKNOWN", "UNKNOWN", true, null);
    // A non-typed throw here (a TypeError from plan validation, a SQLSTATE from the claim function)
    // is collapsed into HOSTED_PROMPT_EXECUTION_UNKNOWN for the caller, which hides the cause in
    // production. Record it once so the blocker is identifiable without reproducing locally.
    if (!(error instanceof HostedPromptExecutionError)) {
      const detail = error as { code?: unknown; message?: unknown };
      console.warn(
        `hosted_prompt_unexpected_failure project=${projectId} sqlstate=${
          typeof detail?.code === "string" ? detail.code : "-"
        } message=${String(detail?.message ?? error).slice(0, 200)}`,
      );
    }
    if (runId) {
      try {
        const scope = settleScope ?? (await sessionScope(request, config, pool, executionContext));
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
      } catch (settleError) {
        // The durable DISPATCHING claim still prevents a blind provider redispatch, but a settle that
        // fails silently leaves the run stuck in DISPATCHING with no way to see why. One failed
        // redispatch was invisible exactly this way (2026-09-15: settle addressed a run id the claim
        // had not created), so record the cause.
        const detail = settleError as { code?: unknown; message?: unknown };
        console.warn(
          `hosted_prompt_settle_failed project=${projectId} run=${runId} sqlstate=${
            typeof detail?.code === "string" ? detail.code : "-"
          } message=${String(detail?.message ?? settleError).slice(0, 200)}`,
        );
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
    trace("pool_end_start");
    await pool.end();
    trace("pool_end_done");
  }
}

/** A failed next-stage handoff cannot turn a durably accepted prompt set into an UNKNOWN run. */
export async function handoffAcceptedHostedPrompts(
  apiGeneration: boolean,
  handoff: ((scope: ContinuationScope, projectId: string) => Promise<void>) | undefined,
  scope: ContinuationScope,
  projectId: string,
): Promise<void> {
  if (!apiGeneration || !handoff) return;
  try {
    await handoff(scope, projectId);
  } catch (error) {
    console.warn(
      `hosted_prompt_next_stage_failed project=${projectId} message=${String((error as { message?: unknown })?.message ?? error).slice(0, 180)}`,
    );
  }
}

export async function handleHostedPromptRequest(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
  acceptedHandoff?: (scope: ContinuationScope, projectId: string) => Promise<void>,
): Promise<Response | null> {
  const match = PROMPTS_PATH.exec(new URL(request.url).pathname);
  if (request.method !== "POST" || !match) return null;
  return writeProjectPrompts(
    request,
    match[1]!,
    config,
    executionContext,
    undefined,
    acceptedHandoff,
  );
}
