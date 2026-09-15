import type { HostedExecutionContext } from "./auth";
import {
  hostedRuntimeConfiguration,
  type HostedRuntimeConfiguration,
  type HostedRuntimeEnvironment,
} from "./configuration";
import { createNeonPool } from "./neon";
import { createHostedV209SpanAudioLiveCoordinator } from "./app";
import { defaults as dispatchDefaults, handleHostedV209ProjectDispatch } from "./hosted-v209-project-dispatch";
import { writeProjectPrompts } from "./hosted-prompt-route";
import { createVoiceoverContext, renderHandoff } from "./product";
import { continuationRequest } from "./stage-continuation";

/**
 * Scheduled stage continuation.
 *
 * Handing a stage off with `waitUntil` inside the request that completed the previous one only works
 * for short stages: work queued after the response is sent is cut before a multi-minute provider
 * workload finishes, which left a prompt run claimed as DISPATCHING with zero batches recorded and no
 * path back. Long stages therefore run as their own invocation, started here by a per-minute cron.
 *
 * The sweep only STARTS a stage that has no durable row yet. It never retries a failed one, so the
 * bounded redispatch gates stay the only retry path and the sweep cannot loop on a provider outage.
 */

const DUE_QUERY = `
WITH revision AS (
  SELECT project.id AS project_id, project.account_id, project.workspace_id, locked.id AS revision_id,
         (SELECT member.user_id FROM public.memberships member
           WHERE member.workspace_id = project.workspace_id
           ORDER BY member.created_at LIMIT 1) AS user_id
    FROM public.projects project
    JOIN LATERAL (
      SELECT candidate.id FROM public.project_revisions candidate
       WHERE candidate.project_id = project.id AND candidate.status = 'LOCKED'
       ORDER BY candidate.created_at DESC LIMIT 1
    ) locked ON true
   WHERE project.status = 'ACTIVE'
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
    (SELECT count(*) FROM public.timeline_plans plan
      WHERE plan.project_revision_id = revision.revision_id) AS plan_count,
    (SELECT run.state FROM public.hosted_prompt_runs run
      WHERE run.project_revision_id = revision.revision_id
      ORDER BY run.created_at DESC LIMIT 1) AS prompt_state,
    (SELECT run.acceptance_fingerprint_hash FROM public.hosted_prompt_runs run
      WHERE run.project_revision_id = revision.revision_id
      ORDER BY run.created_at DESC LIMIT 1) AS prompt_accepted_set,
    (SELECT count(*) FROM public.hosted_cpu_job_attempts attempt
      WHERE attempt.project_revision_id = revision.revision_id AND attempt.kind = 'SPAN_AUDIO') AS span_jobs,
    (SELECT count(*) FROM public.generation_requests request
      WHERE request.project_revision_id = revision.revision_id) AS generation_requests
  FROM revision
)
SELECT project_id, account_id, workspace_id, user_id, revision_id, asr_attempt_id, next_step
  FROM (
    SELECT project_id, account_id, workspace_id, user_id, revision_id, asr_attempt_id,
           CASE
             WHEN asr_state = 'SUCCEEDED' AND context_state IS NULL THEN 'context'
             WHEN asr_state = 'SUCCEEDED' AND context_state = 'SUCCEEDED' AND plan_count = 0 THEN 'plan'
             WHEN plan_count > 0 AND prompt_state IS NULL THEN 'prompts'
             WHEN prompt_accepted_set IS NOT NULL AND generation_requests = 0 AND span_jobs = 0
               THEN 'dispatch'
             ELSE NULL
           END AS next_step
      FROM state
  ) due
 WHERE next_step IS NOT NULL
 LIMIT 3`;

interface DueRow {
  readonly project_id: string;
  readonly asr_attempt_id: string | null;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly user_id: string;
  readonly next_step: "context" | "plan" | "prompts" | "dispatch";
}

export async function runHostedContinuation(
  environment: HostedRuntimeEnvironment,
  executionContext: HostedExecutionContext,
): Promise<string[]> {
  const config: HostedRuntimeConfiguration = hostedRuntimeConfiguration(environment);
  const pool = createNeonPool(config.neon.databaseUrl);
  const dispatched: string[] = [];
  try {
    const due = await pool.query<DueRow>(DUE_QUERY);
    for (const row of due.rows) {
      const scope = {
        account_id: row.account_id,
        workspace_id: row.workspace_id,
        user_id: row.user_id,
      };
      try {
        if (row.next_step === "context") {
          await createVoiceoverContext(
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
          await renderHandoff(
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
          const spanAudio = await createHostedV209SpanAudioLiveCoordinator(environment, config);
          await handleHostedV209ProjectDispatch(
            continuationRequest(config, `/api/v2/hosted/projects/${row.project_id}/gpu-dispatch`, {}),
            environment,
            config,
            executionContext,
            { ...dispatchDefaults, scope: async () => scope },
            spanAudio,
          );
        } else {
          await writeProjectPrompts(
            continuationRequest(config, `/api/v2/hosted/projects/${row.project_id}/prompts`, {
              maximum_prompt_spend_micro_usd: 40_000,
            }),
            row.project_id,
            config,
            executionContext,
            scope,
          );
        }
        dispatched.push(`${row.project_id}:${row.next_step}`);
      } catch (error) {
        // One stalled project must not stop the sweep for the others.
        console.warn(
          `hosted_continuation_step_failed project=${row.project_id} step=${row.next_step} message=${String(
            (error as { message?: unknown })?.message ?? error,
          ).slice(0, 180)}`,
        );
      }
    }
  } finally {
    await pool.end();
  }
  return dispatched;
}
