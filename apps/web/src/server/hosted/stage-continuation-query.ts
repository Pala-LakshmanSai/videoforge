export function buildContinuationDueQuery(
  CONTEXT_REDISPATCHABLE_PROBLEM_CODES_SQL: string,
  CONTEXT_REDISPATCH_BUDGET: number,
  PLAN_STAGE_REVISION_CONFIG_SCHEMA_VERSION: string,
  PROMPT_STALE_RUN_SECONDS: number,
  PROMPT_REDISPATCHABLE_PROBLEM_CODES_SQL: string,
) {
  return `
WITH revision AS (
  SELECT project.id AS project_id, project.account_id, project.workspace_id, locked.id AS revision_id,
         project.generation_provider,
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
    (SELECT profile.revision FROM public.hosted_prompt_runs run
      JOIN public.execution_profiles profile ON profile.id=run.execution_profile_id
      WHERE run.project_revision_id = revision.revision_id
      ORDER BY run.created_at DESC LIMIT 1) AS prompt_profile_revision,
    (SELECT coalesce(replacement.created_at,claim_row.created_at)
       FROM public.hosted_prompt_runs run
      JOIN public.hosted_prompt_batch_claims claim_row ON claim_row.run_id=run.id
       LEFT JOIN LATERAL (SELECT candidate.* FROM public.hosted_prompt_batch_replacements candidate
         WHERE candidate.claim_id=claim_row.id ORDER BY candidate.replacement_index DESC LIMIT 1)
         replacement ON true
      WHERE run.id=(SELECT latest.id FROM public.hosted_prompt_runs latest
        WHERE latest.project_revision_id=revision.revision_id
        ORDER BY latest.created_at DESC LIMIT 1)
        AND claim_row.batch_ordinal=(SELECT count(*) FROM public.hosted_prompt_batch_progress
                                    WHERE run_id=run.id)
      ORDER BY run.created_at DESC LIMIT 1) AS prompt_current_claim_started_at,
    coalesce((SELECT public.videoforge_load_hosted_prompt_response(run.id,
        coalesce(replacement.provider_task_uuid,claim_row.provider_task_uuid),
        coalesce(replacement.request_hash,claim_row.request_hash)) IS NOT NULL
       FROM public.hosted_prompt_runs run
      JOIN public.hosted_prompt_batch_claims claim_row ON claim_row.run_id=run.id
       LEFT JOIN LATERAL (SELECT candidate.* FROM public.hosted_prompt_batch_replacements candidate
         WHERE candidate.claim_id=claim_row.id ORDER BY candidate.replacement_index DESC LIMIT 1)
         replacement ON true
      WHERE run.id=(SELECT latest.id FROM public.hosted_prompt_runs latest
        WHERE latest.project_revision_id=revision.revision_id
        ORDER BY latest.created_at DESC LIMIT 1)
        AND claim_row.batch_ordinal=(SELECT count(*) FROM public.hosted_prompt_batch_progress
                                    WHERE run_id=run.id)
      ORDER BY run.created_at DESC LIMIT 1),false) AS prompt_current_receipt_available,
    (SELECT count(*) FROM public.hosted_cpu_job_attempts attempt
      WHERE attempt.project_revision_id = revision.revision_id AND attempt.kind = 'SPAN_AUDIO') AS span_jobs,
    (SELECT count(*) FROM public.generation_requests request
      WHERE request.project_revision_id = revision.revision_id) AS generation_requests,
    (SELECT count(*) FROM public.generation_requests request
      WHERE request.project_revision_id = revision.revision_id AND request.state = 'ACTIVE') AS active_generation_requests,
    (SELECT count(*) FROM public.generation_requests request
      WHERE request.project_revision_id = revision.revision_id AND request.state = 'WAITING') AS waiting_generation_requests,
    (SELECT count(*) FROM public.hosted_api_generation_jobs job
      WHERE job.project_revision_id = revision.revision_id) AS api_jobs
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
               AND (prompt_profile_revision IS DISTINCT FROM 8
                 OR prompt_current_claim_started_at IS NULL
                 OR prompt_current_receipt_available)
               THEN 'prompts'
             WHEN prompt_state = 'UNKNOWN' AND prompt_accepted_set IS NULL
               AND prompt_problem_code IN ('HOSTED_PROMPT_EXECUTION_UNKNOWN','HOSTED_PROMPT_DISPATCH_TIMEOUT','HOSTED_PROMPT_PROVIDER_CREDITS_LOW')
               AND (prompt_profile_revision IS DISTINCT FROM 8
                 OR prompt_current_claim_started_at IS NULL
                 OR prompt_current_receipt_available)
               AND (
                 ((active_generation_requests=1 OR $2::uuid IS NOT NULL) AND EXISTS (
                   SELECT 1 FROM public.hosted_prompt_batch_claims claim_row
                    WHERE claim_row.run_id=prompt_run_id AND claim_row.batch_ordinal=(
                      SELECT count(*) FROM public.hosted_prompt_batch_progress WHERE run_id=prompt_run_id)))
                 OR ((active_generation_requests=1 OR (SELECT count(*) FROM public.hosted_prompt_batch_progress WHERE run_id=prompt_run_id)=prompt_planned_batches)
                   AND (SELECT count(*) BETWEEN 1 AND prompt_planned_batches AND count(*)=(SELECT count(*) FROM public.hosted_prompt_batch_progress WHERE run_id=prompt_run_id) AND bool_and(EXISTS (
                     SELECT 1 FROM public.hosted_prompt_batch_progress progress
                      WHERE progress.run_id=prompt_run_id AND progress.batch_ordinal=claim_row.batch_ordinal))
                     FROM public.hosted_prompt_batch_claims claim_row WHERE claim_row.run_id=prompt_run_id)))
               THEN 'prompts'
             WHEN prompt_state IN ('FAILED', 'UNKNOWN') AND prompt_accepted_set IS NULL
               AND prompt_problem_code = ANY(${PROMPT_REDISPATCHABLE_PROBLEM_CODES_SQL})
               AND (prompt_profile_revision IS DISTINCT FROM 8
                 OR prompt_current_claim_started_at IS NULL
                 OR prompt_current_receipt_available)
               AND COALESCE(prompt_redispatch_count, 0) < 28
               AND NOT EXISTS (SELECT 1 FROM public.hosted_prompt_batch_progress progress
                                WHERE progress.run_id = prompt_run_id)
               THEN 'prompts'
             WHEN prompt_accepted_set IS NOT NULL AND generation_requests = 0 AND span_jobs = 0
               THEN 'dispatch'
             WHEN prompt_accepted_set IS NOT NULL AND generation_provider = 'KIE_FAL'
               AND generation_requests = 1 AND (active_generation_requests = 1 OR waiting_generation_requests = 1)
               AND span_jobs = 0 AND api_jobs = 0 THEN 'dispatch'
             -- A capacity wait can outlive the bounded Workflow. Re-enter its exact
             -- saved identity; claim CAS remains the only authority for a new POST.
             WHEN prompt_accepted_set IS NOT NULL AND generation_provider = 'KIE_FAL'
               AND generation_requests = 1 AND active_generation_requests = 1
               AND EXISTS (SELECT 1 FROM public.hosted_api_generation_jobs job
                 WHERE job.project_revision_id = revision_id AND job.state IN ('PREPARED','SUBMITTED'))
               AND NOT EXISTS (SELECT 1 FROM public.hosted_api_generation_jobs job
                 WHERE job.project_revision_id = revision_id AND job.state IN ('SUBMITTING','UNKNOWN_NO_RETRY','FAILED'))
               AND NOT EXISTS (SELECT 1 FROM public.hosted_video_jobs job
                 WHERE job.project_revision_id = revision_id AND job.state IN ('UNKNOWN_NO_RETRY','FAILED'))
               AND NOT EXISTS (SELECT 1 FROM public.hosted_cpu_job_attempts cpu
                 WHERE cpu.project_revision_id = revision_id AND cpu.kind IN ('ASR','SPAN_AUDIO')
                   AND cpu.state IN ('FAILED','CANCELLED','EXPIRED'))
               THEN 'dispatch'
             -- The coordinator can stop between accepted media and its next clip/render step.
             -- Re-enter the saved Workflow only; existing claims and render attempts stay authoritative.
             WHEN prompt_accepted_set IS NOT NULL AND generation_provider = 'KIE_FAL'
               AND generation_requests = 1 AND active_generation_requests = 1 AND api_jobs > 0
               AND NOT EXISTS (SELECT 1 FROM public.hosted_api_generation_jobs job
                 WHERE job.project_revision_id = revision_id AND job.state <> 'SUCCEEDED')
               AND NOT EXISTS (SELECT 1 FROM public.hosted_cpu_job_attempts cpu
                 WHERE cpu.project_revision_id = revision_id AND cpu.kind IN ('ASR','SPAN_AUDIO')
                   AND cpu.state IN ('FAILED','CANCELLED','EXPIRED'))
               AND (
                 (EXISTS (SELECT 1 FROM public.hosted_video_jobs job
                   WHERE job.project_revision_id = revision_id AND job.state = 'PREPARED')
                  AND NOT EXISTS (SELECT 1 FROM public.hosted_video_jobs job
                    WHERE job.project_revision_id = revision_id
                      AND job.state NOT IN ('PREPARED','SUBMITTED','SUCCEEDED')))
                 OR (EXISTS (SELECT 1 FROM public.video_runtime_states runtime
                   WHERE runtime.project_revision_id = revision_id AND runtime.stage = 'RENDERING'
                     AND public.videoforge_hosted_videos_ready(
                       state.account_id, state.workspace_id, runtime.generation_request_id))
                  AND NOT EXISTS (SELECT 1 FROM public.hosted_cpu_job_attempts cpu
                    WHERE cpu.project_revision_id = revision_id AND cpu.kind = 'RENDER'))
               ) THEN 'dispatch'
             -- A stopped generation Workflow can outlive every image/avatar result.
             -- Dispatch only ensures the exact saved Workflow; it never reclaims paid clips.
             WHEN prompt_accepted_set IS NOT NULL AND generation_provider = 'KIE_FAL'
               AND active_generation_requests = 1 AND api_jobs > 0
               AND NOT EXISTS (SELECT 1 FROM public.hosted_api_generation_jobs job
                 WHERE job.project_revision_id = revision_id AND job.state <> 'SUCCEEDED')
               AND EXISTS (SELECT 1 FROM public.hosted_video_jobs job
                 WHERE job.project_revision_id = revision_id
                   AND job.state IN ('SUBMITTING','SUBMITTED','UNKNOWN_NO_RETRY'))
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
}
