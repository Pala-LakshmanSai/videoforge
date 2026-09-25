import type { HostedExecutionContext } from "./auth";
import {
  configuredHostedRuntimeConfiguration,
  hostedRuntimeConfiguration,
  type HostedQualifiedGpuActivationDatabaseSource,
  type HostedRuntimeConfiguration,
  type HostedRuntimeEnvironment,
} from "./configuration";
import { createNeonExecutor, createNeonPool } from "./neon";
import type { HostedNeonPool } from "./configuration";
import { continuationRequest } from "./stage-continuation";

/**
 * Scheduled stage continuation.
 *
 * Handing a stage off with `waitUntil` inside the request that completed the previous one only works
 * for short stages: work queued after the response is sent is cut before a multi-minute provider
 * workload finishes, which left a prompt run claimed as DISPATCHING with zero batches recorded and no
 * path back. Long stages therefore run as their own invocation, started here by a per-minute cron.
 *
 * The sweep starts a stage with no durable row and advances a prompt run after each accepted batch.
 * It re-runs the voiceover-context step when its attempt failed before any result was accepted.
 * The bounded
 * redispatch gates in POST /context remain the only retry path, so the budget bound is what keeps
 * the sweep from looping on a provider outage.
 *
 * Every stage handler is imported dynamically at its call site. This module is statically reachable
 * from the Worker entry (the durable `HostedContinuationWorkflow` re-exports the sweep), and the
 * accepted production bundle keeps `hosted-prompt-route` and `hosted-v209-project-dispatch` as their
 * own dynamic entries: a static import here inlined 3.4 MB of route code into the shared entry chunk
 * and dropped both dedicated chunks.
 */

/**
 * The provider/transport classes whose voiceover-context attempt failed before any result was
 * accepted, and which may therefore be redispatched. This mirrors
 * HOSTED_CONTEXT_RETRYABLE_PROBLEM_CODES in voiceover-context.ts; it is inlined rather than imported
 * because this module is statically reachable from the Worker entry and importing the provider module
 * here grows the shared chunk. `stage-continuation-sweep.test.ts` asserts the two lists stay equal.
 */
export const CONTEXT_REDISPATCHABLE_PROBLEM_CODES = Object.freeze([
  "VOICEOVER_CONTEXT_PROVIDER_UNAVAILABLE",
  "VOICEOVER_CONTEXT_NETWORK_UNCERTAIN",
  "VOICEOVER_CONTEXT_RESPONSE_UNCERTAIN",
  "VOICEOVER_CONTEXT_PROVIDER_UNCERTAIN",
  "HOSTED_CONTEXT_EXECUTION_UNKNOWN",
  "HOSTED_CONTEXT_PROVIDER_FAILURE",
  "VOICEOVER_CONTEXT_PROVIDER_REJECTED",
] as const);

/** Mirrors HOSTED_CONTEXT_REDISPATCH_BUDGET in voiceover-context.ts. */
export const CONTEXT_REDISPATCH_BUDGET = 30 as const;

/** Mirrors HOSTED_PROMPT_STALE_RUN_MS in hosted-prompt-route.ts, in seconds for the due query. */
const PROMPT_STALE_RUN_SECONDS = 900 as const;

/**
 * The problem classes the prompt route will redispatch.
 *
 * Written out here instead of imported: POST /prompts is a dedicated dynamic entry, and a static
 * import of that module folds it back into the main bundle (the bundle guard refuses exactly that).
 * A test asserts this list still equals HOSTED_PROMPT_RETRYABLE_PROBLEM_CODES in the route module.
 */
export const PROMPT_REDISPATCHABLE_PROBLEM_CODES = [
  "HOSTED_PROMPT_EXECUTION_UNKNOWN",
  "HOSTED_PROMPT_PROVIDER_UNAVAILABLE",
  "HOSTED_PROMPT_DISPATCH_TIMEOUT",
] as const;

/**
 * The stored revision-config document the plan stage will accept.
 *
 * `renderHandoff` validates the locked revision's stored `revision_config_payload` against the
 * precompiled hosted v2 `projectRevisionConfig` contract and refuses any other document as
 * HOSTED_GENERATION_PROJECT_REVISION_SCHEMA_INVALID, which the route answers as 409
 * HOSTED_PROJECT_PLANNING_FAILED. Offering the step for a revision pinned to another contract - the
 * V2-06 owned-render acceptance fixtures store `videoforge-hosted-revision-config/v1` - re-ran that
 * same 409 every tick and kept dead fixtures inside the sweep's five-row limit. Pinned to the
 * generated schema's own const; a test asserts the two stay equal.
 */
export const PLAN_STAGE_REVISION_CONFIG_SCHEMA_VERSION = "project-revision-config/v2" as const;

const PROMPT_REDISPATCHABLE_PROBLEM_CODES_SQL = `ARRAY[${[...PROMPT_REDISPATCHABLE_PROBLEM_CODES]
  .map((code) => `'${code.replaceAll("'", "''")}'`)
  .join(",")}]::text[]`;

const CONTEXT_REDISPATCHABLE_PROBLEM_CODES_SQL = `ARRAY[${CONTEXT_REDISPATCHABLE_PROBLEM_CODES.map(
  (code) => `'${code.replaceAll("'", "''")}'`,
).join(", ")}]::text[]`;

export const DUE_QUERY = `
WITH revision AS (
  SELECT project.id AS project_id, project.account_id, project.workspace_id, locked.id AS revision_id,
         project.created_at AS project_created_at,
         locked.revision_config_payload->>'schema_version' AS revision_config_schema,
         (SELECT member.user_id FROM public.memberships member
           WHERE member.workspace_id = project.workspace_id
           ORDER BY member.created_at LIMIT 1) AS user_id
    FROM public.projects project
    JOIN LATERAL (
      SELECT candidate.id, candidate.revision_config_payload
        FROM public.project_revisions candidate
       WHERE candidate.project_id = project.id AND candidate.status = 'LOCKED'
       ORDER BY candidate.created_at DESC LIMIT 1
    ) locked ON true
   WHERE project.status = 'ACTIVE'
     AND project.account_id = $1
), state AS (
  SELECT revision.*,
    (SELECT attempt.id FROM public.hosted_cpu_job_attempts attempt
      WHERE attempt.project_revision_id = revision.revision_id AND attempt.kind = 'ASR'
      ORDER BY attempt.created_at DESC LIMIT 1) AS asr_attempt_id,
    (SELECT attempt.state FROM public.hosted_cpu_job_attempts attempt
      WHERE attempt.project_revision_id = revision.revision_id AND attempt.kind = 'ASR'
      ORDER BY attempt.created_at DESC LIMIT 1) AS asr_state,
    (SELECT context.state FROM public.hosted_voiceover_contexts context
      WHERE context.project_revision_id = revision.revision_id
      ORDER BY context.created_at DESC LIMIT 1) AS context_state,
    (SELECT context.context_hash FROM public.hosted_voiceover_contexts context
      WHERE context.project_revision_id = revision.revision_id
      ORDER BY context.created_at DESC LIMIT 1) AS context_hash,
    (SELECT context.problem_code FROM public.hosted_voiceover_contexts context
      WHERE context.project_revision_id = revision.revision_id
      ORDER BY context.created_at DESC LIMIT 1) AS context_problem_code,
    (SELECT context.redispatch_count FROM public.hosted_voiceover_contexts context
      WHERE context.project_revision_id = revision.revision_id
      ORDER BY context.created_at DESC LIMIT 1) AS context_redispatch_count,
    (SELECT count(*) FROM public.timeline_plans plan
      WHERE plan.project_revision_id = revision.revision_id) AS plan_count,
    (SELECT run.state FROM public.hosted_prompt_runs run
      WHERE run.project_revision_id = revision.revision_id
      ORDER BY run.created_at DESC LIMIT 1) AS prompt_state,
    (SELECT coalesce(run.started_at, run.created_at) FROM public.hosted_prompt_runs run
      WHERE run.project_revision_id = revision.revision_id
      ORDER BY run.created_at DESC LIMIT 1) AS prompt_run_started_at,
    (SELECT run.problem_code FROM public.hosted_prompt_runs run
      WHERE run.project_revision_id = revision.revision_id
      ORDER BY run.created_at DESC LIMIT 1) AS prompt_problem_code,
    (SELECT run.redispatch_count FROM public.hosted_prompt_runs run
      WHERE run.project_revision_id = revision.revision_id
      ORDER BY run.created_at DESC LIMIT 1) AS prompt_redispatch_count,
    (SELECT run.acceptance_fingerprint_hash FROM public.hosted_prompt_runs run
      WHERE run.project_revision_id = revision.revision_id
      ORDER BY run.created_at DESC LIMIT 1) AS prompt_accepted_set,
    (SELECT run.id FROM public.hosted_prompt_runs run
      WHERE run.project_revision_id = revision.revision_id
      ORDER BY run.created_at DESC LIMIT 1) AS prompt_run_id,
    (SELECT run.planned_batch_count FROM public.hosted_prompt_runs run
      WHERE run.project_revision_id = revision.revision_id
      ORDER BY run.created_at DESC LIMIT 1) AS prompt_planned_batches,
    (SELECT count(*) FROM public.hosted_cpu_job_attempts attempt
      WHERE attempt.project_revision_id = revision.revision_id AND attempt.kind = 'SPAN_AUDIO') AS span_jobs,
    (SELECT count(*) FROM public.generation_requests request
      WHERE request.project_revision_id = revision.revision_id) AS generation_requests
  FROM revision
)
SELECT project_id, account_id, workspace_id, user_id, revision_id, asr_attempt_id, next_step
  FROM (
    SELECT project_id, account_id, workspace_id, user_id, revision_id, asr_attempt_id, project_created_at,
           CASE
             WHEN asr_state = 'SUCCEEDED' AND context_state IS NULL THEN 'context'
             WHEN asr_state = 'SUCCEEDED' AND context_state IN ('FAILED', 'UNKNOWN')
               AND context_hash IS NULL
               AND context_problem_code = ANY(${CONTEXT_REDISPATCHABLE_PROBLEM_CODES_SQL})
               AND COALESCE(context_redispatch_count, 0) < ${CONTEXT_REDISPATCH_BUDGET}
               THEN 'context'
             WHEN asr_state = 'SUCCEEDED' AND context_state = 'SUCCEEDED' AND plan_count = 0
               AND revision_config_schema = '${PLAN_STAGE_REVISION_CONFIG_SCHEMA_VERSION}'
               THEN 'plan'
             WHEN plan_count > 0 AND prompt_state IS NULL THEN 'prompts'
             WHEN prompt_state = 'DISPATCHING' AND prompt_accepted_set IS NULL
               AND prompt_run_id IS NOT NULL AND $2::uuid IS NOT NULL
               THEN 'prompts'
             WHEN prompt_state = 'DISPATCHING' AND prompt_accepted_set IS NULL
               AND prompt_run_id IS NOT NULL
               AND (SELECT count(*) FROM public.hosted_prompt_batch_progress progress
                    WHERE progress.run_id = prompt_run_id) > 0
               AND (SELECT count(*) FROM public.hosted_prompt_batch_claims claim_row
                    WHERE claim_row.run_id = prompt_run_id)
                   = (SELECT count(*) FROM public.hosted_prompt_batch_progress progress
                      WHERE progress.run_id = prompt_run_id)
               AND (SELECT count(*) FROM public.hosted_prompt_batch_progress progress
                    WHERE progress.run_id = prompt_run_id) <= prompt_planned_batches
               THEN 'prompts'
             WHEN prompt_state = 'DISPATCHING' AND prompt_accepted_set IS NULL
               AND prompt_run_started_at IS NOT NULL
               AND prompt_run_started_at < now() - make_interval(secs => ${PROMPT_STALE_RUN_SECONDS})
               THEN 'prompts'
             WHEN prompt_state = 'UNKNOWN' AND prompt_accepted_set IS NULL
               AND prompt_problem_code IN ('HOSTED_PROMPT_EXECUTION_UNKNOWN','HOSTED_PROMPT_DISPATCH_TIMEOUT')
               AND prompt_run_id IS NOT NULL AND prompt_planned_batches > 0
               AND (SELECT count(*) FROM public.hosted_prompt_batch_progress progress
                    WHERE progress.run_id = prompt_run_id) = prompt_planned_batches
               AND (SELECT count(*) FROM public.hosted_prompt_batch_claims claim_row
                    WHERE claim_row.run_id = prompt_run_id) = prompt_planned_batches
               AND NOT EXISTS (
                 SELECT 1 FROM public.hosted_prompt_batch_claims claim_row
                  WHERE claim_row.run_id = prompt_run_id
                    AND NOT EXISTS (
                      SELECT 1 FROM public.hosted_prompt_batch_progress progress
                       WHERE progress.run_id = prompt_run_id
                         AND progress.batch_ordinal = claim_row.batch_ordinal))
               THEN 'prompts'
             WHEN prompt_state IN ('FAILED', 'UNKNOWN') AND prompt_accepted_set IS NULL
               AND prompt_problem_code = ANY(${PROMPT_REDISPATCHABLE_PROBLEM_CODES_SQL})
               AND COALESCE(prompt_redispatch_count, 0) < 28
               AND NOT EXISTS (SELECT 1 FROM public.hosted_prompt_batch_progress progress
                                WHERE progress.run_id = prompt_run_id)
               THEN 'prompts'
             WHEN prompt_accepted_set IS NOT NULL AND generation_requests = 0 AND span_jobs = 0
               THEN 'dispatch'
             ELSE NULL
           END AS next_step
      FROM state
  ) due
 WHERE next_step IS NOT NULL
   AND ($2::uuid IS NULL OR project_id = $2::uuid)
   AND ($3::text IS NULL OR next_step = $3::text)
   AND ($4::uuid IS NULL OR revision_id = $4::uuid)
   AND asr_attempt_id IS NOT NULL
 ORDER BY project_created_at DESC
 LIMIT 5`;

interface DueRow {
  readonly project_id: string;
  readonly asr_attempt_id: string | null;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly user_id: string;
  readonly next_step: "context" | "plan" | "prompts" | "dispatch";
}

export interface HostedContinuationTarget {
  readonly accountId: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly step: "context" | "prompts";
}

/**
 * Reads a continuation handler's response.
 *
 * Every stage handler returns its own Response instead of throwing, so a 409/500 used to be counted
 * as `dispatched` in the heartbeat while the database showed no progress at all - which is exactly how
 * a stage sat stranded with a green-looking sweep. The status and the route's own error code are the
 * signal; the body is never trusted beyond that.
 */
async function continuationOutcome(
  response: Response | null,
): Promise<{ ok: boolean; detail: string }> {
  // The GPU-dispatch coordinator may answer with nothing at all; that is not progress either.
  if (response === null) return { ok: false, detail: "no-response" };
  if (response.ok) return { ok: true, detail: `${response.status}` };
  let code = "";
  try {
    const body = (await response.clone().json()) as { error?: { code?: unknown } };
    code = typeof body?.error?.code === "string" ? body.error.code.slice(0, 60) : "";
  } catch {
    // The body shape is not guaranteed; the status alone is still worth recording.
  }
  return { ok: false, detail: code ? `${response.status}:${code}` : `${response.status}` };
}

/** Where the sweep's verified configuration comes from; the default is the app's own DB seam. */
export interface HostedContinuationConfigurationDependencies {
  readonly databaseSource?: (
    environment: HostedRuntimeEnvironment,
    disabled: HostedRuntimeConfiguration,
  ) => HostedQualifiedGpuActivationDatabaseSource | undefined;
}

/**
 * Resolves the configuration the continuation sweep dispatches with.
 *
 * The env-only configuration is always `DISABLED_UNQUALIFIED` (the flag is necessary, never
 * sufficient), and the GPU-dispatch route refuses anything but the verified activation. Building the
 * sweep's config from the flag alone therefore made its dispatch step answer
 * `503 GPU_TRANSPORT_DISABLED_UNQUALIFIED` on every tick — stages 6-8 stayed browser-only while the
 * sweep reported the failure — so resolve through the same trusted database seam every request path
 * uses. `./app` is imported dynamically: this module is statically reachable from the Worker entry
 * and the accepted production bundle keeps an exact no-growth ceiling.
 */
export async function resolveContinuationConfiguration(
  environment: HostedRuntimeEnvironment,
  dependencies: HostedContinuationConfigurationDependencies = {},
): Promise<HostedRuntimeConfiguration> {
  const disabled = hostedRuntimeConfiguration(environment);
  try {
    const databaseSource = dependencies.databaseSource
      ? dependencies.databaseSource(environment, disabled)
      : (await import("./app")).hostedGpuActivationDatabaseSource(environment, disabled);
    return await configuredHostedRuntimeConfiguration({
      source: environment,
      databaseSource,
    });
  } catch {
    return disabled;
  }
}

export async function runHostedContinuation(
  environment: HostedRuntimeEnvironment,
  executionContext: HostedExecutionContext,
  target?: HostedContinuationTarget,
  onPromptResponse?: (response: Response) => Promise<void>,
): Promise<string[]> {
  console.info("hosted_continuation_phase", { phase: "configuration", target: target?.step ?? null });
  const config: HostedRuntimeConfiguration = await resolveContinuationConfiguration(environment);
  console.info("hosted_continuation_phase", { phase: "configuration_ready" });
  const pool = createNeonPool(config.neon.databaseUrl);
  const dispatched: string[] = [];
  const failures: string[] = [];
  let dueCount = 0;
  try {
    // Every hosted table is RLS-forced on `videoforge_current_account_id()`, so one cross-tenant
    // SELECT sees zero rows: the scheduled driver reported `dispatched: 0` every minute and never
    // advanced a project until the sweep queried each admitted account inside its own tenant
    // transaction, exactly like every request path does.
    console.info("hosted_continuation_phase", { phase: "due_start" });
    const due = await dueRowsAcrossAccounts(pool, target);
    dueCount = due.length;
    console.info("hosted_continuation_phase", { phase: "due", due_count: dueCount });
    for (const row of due) {
      console.info("hosted_continuation_phase", {
        phase: "handler_start",
        project: row.project_id,
        step: row.next_step,
      });
      const scope = {
        account_id: row.account_id,
        workspace_id: row.workspace_id,
        user_id: row.user_id,
      };
      try {
        let response: Response | null;
        if (row.next_step === "context") {
          const { createVoiceoverContext } = await import("./product");
          response = await createVoiceoverContext(
            continuationRequest(config, `/api/v2/hosted/projects/${row.project_id}/context`, {
              asr_attempt_id: row.asr_attempt_id,
              maximum_context_spend_micro_usd: 10_000,
            }),
            row.project_id,
            environment,
            config,
            executionContext,
            scope,
          );
        } else if (row.next_step === "plan") {
          const { renderHandoff } = await import("./product");
          response = await renderHandoff(
            continuationRequest(config, `/api/v2/hosted/projects/${row.project_id}/render`, {
              asr_attempt_id: row.asr_attempt_id,
            }),
            row.project_id,
            environment,
            config,
            executionContext,
            scope,
          );
        } else if (row.next_step === "dispatch") {
          // Stages 6-8 hang off GPU dispatch, which was the fourth and last browser-only handoff:
          // without it a finished prompt set sat with stages 6-8 pending forever.
          response = await (await import("./hosted-prompt-next-stage")).dispatchHostedProject(
            row.project_id, scope, environment, config, executionContext,
          );
        } else {
          const { writeProjectPrompts } = await import("./hosted-prompt-route");
          const acceptedHandoff = config.apiGeneration
            ? (await import("./hosted-prompt-next-stage")).dispatchAcceptedHostedPrompts.bind(
                null, environment, config, executionContext,
              )
            : undefined;
          response = await writeProjectPrompts(
            continuationRequest(config, `/api/v2/hosted/projects/${row.project_id}/prompts`, {
              maximum_prompt_spend_micro_usd: 8_000_000,
            }),
            row.project_id,
            config,
            executionContext,
            scope,
            acceptedHandoff,
          );
          if (onPromptResponse) await onPromptResponse(response);
        }
        const outcome = await continuationOutcome(response);
        console.info("hosted_continuation_phase", {
          phase: "handler_end",
          project: row.project_id,
          step: row.next_step,
          result: outcome.detail,
        });
        if (!outcome.ok) {
          // A handler that answers with an error is not progress: record it, so the heartbeat and the
          // log tell the truth about the stage instead of reporting a dispatch that never happened.
          failures.push(`${row.project_id}:${row.next_step}:${outcome.detail}`);
          console.warn(
            `hosted_continuation_step_failed project=${row.project_id} step=${row.next_step} message=${outcome.detail}`,
          );
          continue;
        }
        dispatched.push(`${row.project_id}:${row.next_step}`);
      } catch (error) {
        // One stalled project must not stop the sweep for the others.
        const message = String((error as { message?: unknown })?.message ?? error).slice(0, 180);
        failures.push(`${row.project_id}:${row.next_step}:${message}`);
        console.warn(
          `hosted_continuation_step_failed project=${row.project_id} step=${row.next_step} message=${message}`,
        );
      }
    }
  } catch (error) {
    failures.push(`sweep:${String((error as { message?: unknown })?.message ?? error).slice(0, 180)}`);
  } finally {
    console.info("hosted_continuation_phase", { phase: "heartbeat_start", due_count: dueCount });
    // `wrangler tail` does not show scheduled invocations, so without this row a sweep that never
    // runs and one that finds nothing due are indistinguishable in production.
    try {
      await pool.query(
        `INSERT INTO public.hosted_continuation_heartbeats (cron, due_count, dispatched, failure)
         VALUES ($1, $2, $3, $4)`,
        [
          "continuation",
          dueCount,
          dispatched,
          failures.length === 0 ? null : failures.join(" | ").slice(0, 400),
        ],
      );
      await pool.query("SELECT public.videoforge_trim_hosted_continuation_heartbeats()");
    } catch {
      // Observability must never break the sweep.
    }
    console.info("hosted_continuation_phase", { phase: "pool_end_start" });
    await pool.end();
    console.info("hosted_continuation_phase", { phase: "pool_end_complete" });
  }
  return dispatched;
}

/**
 * Read the due projects for every admitted account, each inside its own tenant transaction.
 * `videoforge_admitted_hosted_account_ids()` is the service-owned accessor for the account list;
 * the accounts table itself is never queried from here.
 */
export async function dueRowsAcrossAccounts(
  pool: HostedNeonPool,
  target?: HostedContinuationTarget,
): Promise<readonly DueRow[]> {
  const executor = createNeonExecutor(pool);
  const accounts = target
    ? { rows: [{ account_id: target.accountId }] }
    : await pool.query<{ account_id: string }>(
        "SELECT account_id FROM public.videoforge_admitted_hosted_account_ids()",
      );
  const rows: DueRow[] = [];
  for (const account of accounts.rows) {
    const tenantRows = await executor.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        account.account_id,
      ]);
      const result = await transaction.query(DUE_QUERY, [
        account.account_id,
        target?.projectId ?? null,
        target?.step ?? null,
        target?.revisionId ?? null,
      ]);
      return result.rows as unknown as DueRow[];
    });
    rows.push(...tenantRows);
  }
  return Object.freeze(rows);
}

export { ensureHostedPairObservers } from "./pair-observer-guard";
