import type { HostedExecutionContext } from "./auth";
import {
  hostedRuntimeConfiguration,
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
   AND lane.state IN ('ASSIGNED', 'RUNNING')
   AND NOT EXISTS (
     SELECT 1 FROM public.hosted_pair_runtime_states runtime
      WHERE runtime.generation_request_id = candidate.id
        AND runtime.phase = 'SETTLED'
   )
 LIMIT 2
`;

export async function ensureHostedPairObservers(
  environment: HostedRuntimeEnvironment,
  executionContext: HostedExecutionContext,
): Promise<number> {
  const config: HostedRuntimeConfiguration = hostedRuntimeConfiguration(environment);
  const pool = createNeonPool(config.neon.databaseUrl);
  let ensured = 0;
  try {
    const pending = await pool.query<{
      generation_request_id: string;
      account_id: string;
      workspace_id: string;
    }>(UNSETTLED_PAIR_QUERY);
    for (const row of pending.rows) {
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
