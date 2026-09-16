import type { HostedExecutionContext } from "./auth";
import {
  hostedRuntimeConfiguration,
  type HostedNeonPool,
  type HostedRuntimeConfiguration,
  type HostedRuntimeEnvironment,
} from "./configuration";
import { ensureHostedPairWorkflow } from "./hosted-pair-live-wiring";
import { createNeonExecutor, createNeonPool } from "./neon";

/**
 * Self-heal a pair that is running with nobody watching it.
 *
 * `commitAndScheduleHostedPair` submits the RunPod jobs and only then creates the observing workflow.
 * When that handoff failed on 2026-09-15 the lanes ran from 16:20:44 to 17:44 with zero observations;
 * by the time the observer started the provider had purged both job records, so the one observation it
 * could make settled both lanes PERMANENT_FAILED with nothing accepted. Nothing retried the handoff
 * until a later browser dispatch happened to, which is far too late to ingest output.
 *
 * `ensureHostedPairWorkflow` is idempotent -- it creates the canonical instance or recovers the
 * running one -- so this can run on every worker poll. It is deliberately narrow: it only touches a
 * generation whose lanes are assigned and whose runtime has not settled.
 */
const UNSETTLED_PAIR_QUERY = `
SELECT DISTINCT candidate.id AS generation_request_id,
       candidate.account_id,
       candidate.workspace_id
  FROM public.generation_requests candidate
  JOIN public.video_runtime_lane_states lane
    ON lane.project_revision_id = candidate.project_revision_id
 WHERE candidate.state = 'ACTIVE'
   AND candidate.account_id = $1
   AND lane.state IN ('ASSIGNED', 'RUNNING')
   AND NOT EXISTS (
     SELECT 1 FROM public.hosted_pair_runtime_states runtime
      WHERE runtime.generation_request_id = candidate.id
        AND runtime.phase = 'SETTLED'
   )
 LIMIT 2
`;

interface UnsettledPairRow {
  readonly generation_request_id: string;
  readonly account_id: string;
  readonly workspace_id: string;
}

/**
 * Read the unsettled pairs for every admitted account, each inside its own tenant transaction.
 *
 * The hosted tables are RLS-forced on `videoforge_current_account_id()`, and before this the guard
 * read them with no tenant context at all: the query returned zero rows on every poll, so a pair
 * whose observing workflow never started stayed unwatched (the 2026-09-15 stall this guard exists
 * for) while the guard reported `observers: 0` as if nothing were wrong.
 */
export async function unsettledPairsAcrossAccounts(
  pool: HostedNeonPool,
): Promise<readonly UnsettledPairRow[]> {
  const executor = createNeonExecutor(pool);
  const accounts = await pool.query<{ account_id: string }>(
    "SELECT account_id FROM public.videoforge_admitted_hosted_account_ids()",
  );
  const rows: UnsettledPairRow[] = [];
  for (const account of accounts.rows) {
    const tenantRows = await executor.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        account.account_id,
      ]);
      const result = await transaction.query(UNSETTLED_PAIR_QUERY, [account.account_id]);
      return result.rows as unknown as UnsettledPairRow[];
    });
    rows.push(...tenantRows);
  }
  return Object.freeze(rows);
}

export async function ensureHostedPairObservers(
  environment: HostedRuntimeEnvironment,
  executionContext: HostedExecutionContext,
): Promise<number> {
  const config: HostedRuntimeConfiguration = hostedRuntimeConfiguration(environment);
  const pool = createNeonPool(config.neon.databaseUrl);
  let ensured = 0;
  try {
    const pending = await unsettledPairsAcrossAccounts(pool);
    for (const row of pending) {
      try {
        await ensureHostedPairWorkflow(
          environment as Parameters<typeof ensureHostedPairWorkflow>[0],
          createNeonExecutor(pool),
          createNeonExecutor(pool),
          {
            accountId: row.account_id,
            workspaceId: row.workspace_id,
            generationRequestId: row.generation_request_id,
          },
        );
        ensured += 1;
      } catch (error) {
        console.warn(
          `hosted_pair_observer_ensure_failed request=${row.generation_request_id} message=${String(
            (error as { message?: unknown })?.message ?? error,
          ).slice(0, 160)}`,
        );
      }
    }
  } catch {
    // Self-healing must never break the caller.
  } finally {
    await pool.end();
  }
  void executionContext;
  return ensured;
}

/** Exactly one driver per deployment, not one per poll: this is the Workflow instance id. */
const HOSTED_CONTINUATION_DRIVER_ID = "hosted-continuation-driver";
const HOSTED_CONTINUATION_DRIVER_REASON = "personal-worker-claim";
/** Workflow instance states from which `restart()` starts a fresh run of the same instance. */
const TERMINAL_WORKFLOW_STATES = ["complete", "errored", "terminated"] as const;
/** A probe is three Workflow API round trips; keep it off the hot claim path without making the
 * restart window long enough to stall the pipeline. */
const DRIVER_ENSURE_INTERVAL_MS = 60_000;
let lastContinuationDriverEnsureAt = 0;
let lastContinuationDriverFailureLogAt = 0;

function workflowStatusState(status: unknown): string | null {
  if (typeof status !== "object" || status === null || Array.isArray(status)) return null;
  const state = (status as { readonly status?: unknown }).status;
  return typeof state === "string" ? state : null;
}

function described(error: unknown): string {
  return String((error as { readonly message?: unknown })?.message ?? error).slice(0, 140);
}

/**
 * Start the durable stage-continuation driver (stages 3-8) exactly once.
 *
 * The per-minute cron never reached its handler in this deployment, so the driver is started from
 * the one trigger that is proven to be delivered: the desktop worker's `/claim` poll, alongside the
 * pair-observer guard. `create` with a stable id is the idempotency key -- an already-running
 * instance is left alone. The driver is bounded to ~24 hours, so a terminal instance is RESTARTED
 * instead of being left dead; that restart is how the cadence survives past the bound with no
 * operator and no reliable schedule.
 *
 * Returns true only when this call created or restarted the driver.
 */
export async function ensureHostedContinuationDriver(
  environment: HostedRuntimeEnvironment,
): Promise<boolean> {
  const workflow = environment.HOSTED_CONTINUATION_WORKFLOW;
  if (!workflow) return false;
  const now = Date.now();
  if (now - lastContinuationDriverEnsureAt < DRIVER_ENSURE_INTERVAL_MS) return false;
  lastContinuationDriverEnsureAt = now;
  try {
    const created = await workflow.create({
      id: HOSTED_CONTINUATION_DRIVER_ID,
      params: { reason: HOSTED_CONTINUATION_DRIVER_REASON },
    });
    return created.id === HOSTED_CONTINUATION_DRIVER_ID;
  } catch (error) {
    try {
      const existing = await workflow.get(HOSTED_CONTINUATION_DRIVER_ID);
      const state = workflowStatusState(await existing.status());
      // Running (or queued/paused/waiting) driver: nothing to do, and deliberately no log line --
      // this path runs on every claim poll while a driver is alive.
      if (state === null || !(TERMINAL_WORKFLOW_STATES as readonly string[]).includes(state))
        return false;
      if (!existing.restart) return false;
      await existing.restart();
      return true;
    } catch (inspectionError) {
      if (now - lastContinuationDriverFailureLogAt >= DRIVER_ENSURE_INTERVAL_MS) {
        lastContinuationDriverFailureLogAt = now;
        console.warn(
          `hosted_continuation_driver_ensure_failed create=${described(error)} inspect=${described(
            inspectionError,
          )}`,
        );
      }
      return false;
    }
  }
}
