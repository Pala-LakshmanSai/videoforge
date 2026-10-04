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

// UNKNOWN next claims use retrieval-only recovery for active work. Fully saved runs need
// exact matching claim/progress ordinals before finalization. Admission may precede API/span
// materialization; its continuation reuses the existing ACTIVE generation request.
export async function continuationDueQuery(): Promise<string> {
  const query = await import("./stage-continuation-query");
  return query.buildContinuationDueQuery(
    CONTEXT_REDISPATCHABLE_PROBLEM_CODES_SQL,
    CONTEXT_REDISPATCH_BUDGET,
    PLAN_STAGE_REVISION_CONFIG_SCHEMA_VERSION,
    PROMPT_STALE_RUN_SECONDS,
    PROMPT_REDISPATCHABLE_PROBLEM_CODES_SQL,
  );
}

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
export async function continuationOutcome(
  response: Response | null,
): Promise<{ ok: boolean; detail: string; waiting?: boolean }> {
  // The GPU-dispatch coordinator may answer with nothing at all; that is not progress either.
  if (response === null) return { ok: false, detail: "no-response" };
  if (response.ok) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as { state?: unknown } | null;
    if (body?.state === "WAITING")
      return { ok: false, waiting: true, detail: `${response.status}:WAITING` };
    return { ok: true, detail: `${response.status}` };
  }
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
  if ((await import("./cloud-media-qualification")).cloudMediaQualificationOnly(environment))
    return [];
  console.info("hosted_continuation_phase", {
    phase: "configuration",
    target: target?.step ?? null,
  });
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
    if (!target && config.apiGeneration && environment.HOSTED_PAIR_WORKFLOW) {
      const recovered = await restartPendingImageRegenerationWorkflows(environment, pool);
      dispatched.push(...recovered.dispatched);
      failures.push(...recovered.failures);
    }
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
          response = await (
            await import("./hosted-prompt-next-stage")
          ).dispatchHostedProject(row.project_id, scope, environment, config, executionContext);
        } else {
          const { writeProjectPrompts } = await import("./hosted-prompt-route");
          const acceptedHandoff = config.apiGeneration
            ? (await import("./hosted-prompt-next-stage")).dispatchAcceptedHostedPrompts.bind(
                null,
                environment,
                config,
                executionContext,
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
          if (outcome.waiting) continue;
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
    failures.push(
      `sweep:${String((error as { message?: unknown })?.message ?? error).slice(0, 180)}`,
    );
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
  const DUE_QUERY = await continuationDueQuery();
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

export async function restartPendingImageRegenerationWorkflows(
  environment: HostedRuntimeEnvironment,
  pool: HostedNeonPool,
): Promise<{ dispatched: string[]; failures: string[] }> {
  const continuation = await import("./image-regeneration-continuation");
  return continuation.restartPendingImageRegenerationWorkflows(environment, pool);
}

export { ensureHostedPairObservers } from "./pair-observer-guard";
