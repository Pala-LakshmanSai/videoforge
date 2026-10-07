import type { SqlExecutor } from "@videoforge/control-plane";
import type { ProjectApiCost } from "../../lib/cloud-compute";

// Incurred work across every revision/attempt; reservations are not billed charges.
// Kie/Fal do not persist invoice amounts. Their existing planning rates remain estimates.
export const PROJECT_API_COST_SQL = `
WITH unresolved_prompt_receipts AS (
  -- Load only unsettled attempts. The scoped native loader verifies tenant, run, UUID and hash;
  -- originals and corrective calls are distinct paid requests, including discarded output.
  SELECT run.attempt_id,run.task_id,
         sum(ceil(CASE WHEN jsonb_typeof(saved.result->'costUsd')='number'
                       THEN (saved.result->>'costUsd')::numeric END * 1000000)) / 1000000 AS usd,
         bool_or(saved.result->>'costBasis'='PINNED_RATE_ESTIMATE') AS estimated
    FROM hosted_prompt_runs run
    JOIN hosted_prompt_batch_claims claim ON claim.run_id=run.id AND claim.account_id=run.account_id
      AND claim.workspace_id=run.workspace_id AND claim.task_id=run.task_id AND claim.attempt_id=run.attempt_id
    CROSS JOIN LATERAL (
      SELECT claim.provider_task_uuid AS uuid,claim.request_hash AS hash
      UNION
      SELECT replacement.provider_task_uuid,replacement.request_hash
        FROM hosted_prompt_batch_replacements replacement WHERE replacement.claim_id=claim.id
    ) call
    CROSS JOIN LATERAL (
      SELECT public.videoforge_load_hosted_prompt_response(run.id,call.uuid,call.hash) AS result
    ) saved
   WHERE run.account_id=$1 AND run.workspace_id=$2 AND run.project_id=$3
     AND run.state IN ('DISPATCHING','UNKNOWN') AND call.uuid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM cost_events settled WHERE settled.account_id=run.account_id
       AND settled.workspace_id=run.workspace_id AND settled.attempt_id=run.attempt_id
       AND settled.task_id=run.task_id AND settled.event_type='SETTLED')
     AND saved.result->>'status'='succeeded'
     AND jsonb_typeof(saved.result->'costUsd')='number'
     AND CASE WHEN jsonb_typeof(saved.result->'costUsd')='number'
              THEN (saved.result->>'costUsd')::numeric END BETWEEN 0 AND 0.25
   GROUP BY run.attempt_id,run.task_id
), project_prompt_cost AS (
  SELECT event.attempt_id,
         CASE WHEN task.task_key LIKE 'prompt:voiceover-context:%' THEN 'Context analysis'
              WHEN bool_or(event.event_type IN ('REPORTED','SETTLED','RELEASED')
                           AND event.details->>'rate_version'='runware-air-gpt-6-luna-standard-2026-10-06')
                THEN 'Scene prompts (GPT-6 Luna)'
              ELSE 'Scene prompts' END AS label,
         COALESCE(sum(event.amount_micro_usd) FILTER (WHERE event.event_type='SETTLED'),
                  greatest(max(event.amount_micro_usd) FILTER (WHERE event.event_type='REPORTED'),
                           receipt.usd * 1000000),
                  0)::numeric / 1000000
           - COALESCE(sum(event.amount_micro_usd) FILTER (WHERE event.event_type='REFUNDED'),0)::numeric / 1000000 AS usd,
         NOT bool_or(event.event_type IN ('SETTLED','RELEASED'))
           OR coalesce(bool_or(prompt_run.state IN ('DISPATCHING','UNKNOWN')),false) AS unconfirmed,
         bool_or(event.details->>'cost_basis'='PINNED_RATE_ESTIMATE'
                 AND event.details->>'invoice_verified' IS DISTINCT FROM 'true')
           OR coalesce(receipt.estimated,false) AS estimated
    FROM cost_events event
    JOIN project_revisions revision ON revision.account_id=event.account_id
      AND revision.workspace_id=event.workspace_id AND revision.id=event.owner_id
    JOIN generation_tasks task ON task.account_id=event.account_id
      AND task.workspace_id=event.workspace_id AND task.id=event.task_id
    LEFT JOIN hosted_prompt_runs prompt_run ON prompt_run.account_id=event.account_id
      AND prompt_run.workspace_id=event.workspace_id AND prompt_run.task_id=event.task_id
      AND prompt_run.attempt_id=event.attempt_id
    LEFT JOIN unresolved_prompt_receipts receipt ON receipt.attempt_id=event.attempt_id
      AND receipt.task_id=event.task_id
   WHERE event.account_id=$1 AND event.workspace_id=$2 AND revision.project_id=$3
     AND event.owner_type='PROJECT_REVISION' AND task.lane='PROMPT'
   GROUP BY event.attempt_id, task.task_key,receipt.usd,receipt.estimated
), project_api_charges AS (
  SELECT label, greatest(usd,0) AS usd, unconfirmed, estimated FROM project_prompt_cost
  UNION ALL
  SELECT 'Legacy generation APIs',
         CASE WHEN ledger.id IS NOT NULL AND (ledger.settled_usd>0 OR ledger.reported_usd>0)
              THEN greatest(0,CASE WHEN ledger.settled_usd>0 THEN ledger.settled_usd
                                   ELSE ledger.reported_usd END - ledger.refunded_usd)
              ELSE NULL END,
         ledger.id IS NULL OR ledger.settled_usd=0 OR ledger.possible_duplicate_usd>0,
         ledger.id IS NOT NULL AND ledger.settled_usd=0 AND ledger.reported_usd=0
    FROM serverless_attempts attempt
    LEFT JOIN serverless_cost_ledgers ledger ON ledger.account_id=attempt.account_id
      AND ledger.workspace_id=attempt.workspace_id AND ledger.attempt_id=attempt.id
   WHERE attempt.account_id=$1 AND attempt.workspace_id=$2 AND attempt.project_id=$3
     AND attempt.state NOT IN ('PLANNED','OUTBOXED')
  UNION ALL
  SELECT CASE WHEN job.lane='IMAGE' THEN 'Generated images' ELSE 'Avatar footage' END,
         CASE WHEN job.provider_task_id IS NOT NULL OR job.submitted_at IS NOT NULL OR job.state='SUCCEEDED'
              THEN CASE WHEN job.lane='IMAGE' THEN 0.004
                        ELSE (job.input_manifest->>'expectedDurationMs')::numeric / 1000 * 0.005 END
              ELSE NULL END,
         job.state IN ('SUBMITTING','UNKNOWN_NO_RETRY','FAILED'), true
    FROM hosted_api_generation_jobs job
   WHERE job.account_id=$1 AND job.workspace_id=$2 AND job.project_id=$3
     AND job.state<>'PREPARED'
     AND COALESCE(job.failure_code,'') NOT LIKE '%BEFORE_SUBMIT'
     AND NOT (job.provider_task_id IS NULL AND COALESCE(job.failure_code,'')='PROVIDER_REQUEST_REJECTED')
  UNION ALL
  SELECT 'Scene footage',
         COALESCE(job.output_cost_usd,
           CASE WHEN job.provider_task_id IS NOT NULL OR job.submitted_at IS NOT NULL OR job.state='SUCCEEDED'
                THEN job.duration_seconds * plan.price_per_second_usd ELSE NULL END),
         job.output_cost_usd IS NULL AND job.state IN ('SUBMITTING','UNKNOWN_NO_RETRY','FAILED'),
         job.output_cost_usd IS NULL
    FROM hosted_video_jobs job
    LEFT JOIN hosted_video_plans plan ON plan.account_id=job.account_id
      AND plan.workspace_id=job.workspace_id AND plan.project_revision_id=job.project_revision_id
   WHERE job.account_id=$1 AND job.workspace_id=$2 AND job.project_id=$3
     AND job.state<>'PREPARED'
     AND COALESCE(job.failure_code,'') NOT LIKE '%BEFORE_SUBMIT'
  UNION ALL
  SELECT 'Image text checks', reported_cost_micro_usd::numeric / 1000000,
         state='RESERVED', false
    FROM hosted_image_text_qa_runs
   WHERE account_id=$1 AND workspace_id=$2 AND project_id=$3
  UNION ALL
  SELECT 'Replacement images',
         CASE WHEN job.provider_task_id IS NOT NULL OR job.submitted_at IS NOT NULL OR job.state='SUCCEEDED'
              THEN CASE WHEN job.input_manifest->>'provider'='FAL_Z_IMAGE'
                        THEN 1280 * 720 / 1000000.0 * 0.005
                        WHEN job.input_manifest->>'provider' IS NULL
                          OR job.input_manifest->>'provider'='KIE_Z_IMAGE' THEN 0.004
                        ELSE NULL END
              ELSE NULL END,
         job.state IN ('SUBMITTING','UNKNOWN_NO_RETRY','FAILED'), true
    FROM hosted_api_image_regeneration_jobs job
   WHERE job.account_id=$1 AND job.workspace_id=$2 AND job.project_id=$3
     AND job.state<>'PREPARED'
     AND COALESCE(job.failure_code,'') NOT LIKE '%BEFORE_SUBMIT'
     AND NOT (job.provider_task_id IS NULL AND COALESCE(job.failure_code,'')='PROVIDER_REQUEST_REJECTED')
  UNION ALL
  -- J1 returns job state/audio, but no monetary charge. Never invent a zero price.
  SELECT 'Generated narration', NULL::numeric, true, false
    FROM hosted_script_projects intake
   WHERE intake.account_id=$1 AND intake.workspace_id=$2 AND intake.project_id=$3
     AND intake.state NOT IN ('WAITING','CANCELLED')
), project_usage_rows AS (
  SELECT CASE WHEN job.lane='IMAGE' THEN 'Generated images' ELSE 'Avatar footage' END AS label,
         CASE WHEN job.lane='IMAGE' THEN 'KIE' ELSE 'FAL' END AS provider,
         CASE WHEN job.lane='IMAGE' THEN 'z-image' ELSE 'fal-ai/flashhead/audio-to-video' END AS model,
         job.state, job.provider_task_id IS NOT NULL OR job.submitted_at IS NOT NULL OR job.state='SUCCEEDED' AS submitted,
         CASE WHEN job.lane='AVATAR' THEN (job.input_manifest->>'expectedDurationMs')::numeric / 1000 END AS seconds,
         CASE WHEN job.lane='IMAGE' THEN 0.004 ELSE 0.005 END AS rate,
         CASE WHEN job.lane='IMAGE' THEN 'request' ELSE 'second' END AS rate_unit,
         'PINNED_RATE_ESTIMATE'::text AS basis
    FROM hosted_api_generation_jobs job
   WHERE job.account_id=$1 AND job.workspace_id=$2 AND job.project_id=$3 AND job.state<>'PREPARED'
     AND COALESCE(job.failure_code,'') NOT LIKE '%BEFORE_SUBMIT'
     AND NOT (job.provider_task_id IS NULL AND COALESCE(job.failure_code,'')='PROVIDER_REQUEST_REJECTED')
  UNION ALL
  SELECT 'Scene footage', 'RUNWARE', COALESCE(job.input_manifest->>'model','Unrecorded model'), job.state,
         job.provider_task_id IS NOT NULL OR job.submitted_at IS NOT NULL OR job.state='SUCCEEDED',
         job.duration_seconds, plan.price_per_second_usd, 'second',
         CASE WHEN job.output_cost_usd IS NULL THEN 'PINNED_RATE_ESTIMATE' ELSE 'PROVIDER_REPORTED' END
    FROM hosted_video_jobs job LEFT JOIN hosted_video_plans plan
      ON plan.account_id=job.account_id AND plan.workspace_id=job.workspace_id AND plan.project_revision_id=job.project_revision_id
   WHERE job.account_id=$1 AND job.workspace_id=$2 AND job.project_id=$3 AND job.state<>'PREPARED'
     AND COALESCE(job.failure_code,'') NOT LIKE '%BEFORE_SUBMIT'
  UNION ALL
  SELECT 'Replacement images',
         CASE WHEN job.input_manifest->>'provider'='FAL_Z_IMAGE' THEN 'FAL'
              WHEN job.input_manifest->>'provider' IS NULL OR job.input_manifest->>'provider'='KIE_Z_IMAGE' THEN 'KIE'
              ELSE 'Unrecorded provider' END,
         CASE WHEN job.input_manifest->>'provider'='FAL_Z_IMAGE' THEN 'fal-ai/z-image/turbo'
              WHEN job.input_manifest->>'provider' IS NULL OR job.input_manifest->>'provider'='KIE_Z_IMAGE' THEN 'z-image'
              ELSE 'Unrecorded model' END, job.state,
         job.provider_task_id IS NOT NULL OR job.submitted_at IS NOT NULL OR job.state='SUCCEEDED', NULL::numeric,
         CASE WHEN job.input_manifest->>'provider'='FAL_Z_IMAGE' THEN 1280*720/1000000.0*0.005
              WHEN job.input_manifest->>'provider' IS NULL OR job.input_manifest->>'provider'='KIE_Z_IMAGE' THEN 0.004 END,
         'request','PINNED_RATE_ESTIMATE'
    FROM hosted_api_image_regeneration_jobs job
   WHERE job.account_id=$1 AND job.workspace_id=$2 AND job.project_id=$3 AND job.state<>'PREPARED'
     AND COALESCE(job.failure_code,'') NOT LIKE '%BEFORE_SUBMIT'
     AND NOT (job.provider_task_id IS NULL AND COALESCE(job.failure_code,'')='PROVIDER_REQUEST_REJECTED')
), project_usage AS (
  SELECT label, jsonb_agg(usage ORDER BY provider,model,rate,basis) AS usage FROM (
    SELECT label,provider,model,rate,basis,jsonb_build_object(
      'provider',provider,'model',model,'submittedRequests',count(*) FILTER(WHERE submitted),
      'completedRequests',count(*) FILTER(WHERE state='SUCCEEDED'),
      'failedRequests',count(*) FILTER(WHERE state='FAILED'),
      'uncertainRequests',count(*) FILTER(WHERE state IN ('SUBMITTING','UNKNOWN_NO_RETRY')),
      'requestedSeconds',sum(seconds) FILTER(WHERE submitted),'pinnedRateUsd',rate,
      'rateUnit',rate_unit,'costBasis',basis) AS usage
    FROM project_usage_rows GROUP BY label,provider,model,rate,rate_unit,basis
  ) groups GROUP BY label
)
SELECT charge.label, sum(charge.usd) AS usd, bool_or(charge.unconfirmed OR charge.usd IS NULL) AS unconfirmed,
       bool_or(charge.estimated) AS estimated, usage.usage
  FROM project_api_charges charge LEFT JOIN project_usage usage ON usage.label=charge.label
 GROUP BY charge.label,usage.usage ORDER BY charge.label`;

export async function readProjectApiCost(
  sql: SqlExecutor,
  accountId: string,
  workspaceId: string,
  projectId: string,
): Promise<ProjectApiCost> {
  const { rows } = await sql.query(PROJECT_API_COST_SQL, [accountId, workspaceId, projectId]);
  const breakdown = rows.map((row) => {
    const amount = row.usd === null ? null : Number(row.usd);
    const usd = amount !== null && Number.isFinite(amount) && amount >= 0 ? amount : null;
    return {
      label: String(row.label),
      usd,
      estimated: row.estimated === true,
      unconfirmed: row.unconfirmed === true || usd === null,
      ...(Array.isArray(row.usage)
        ? { usage: row.usage as NonNullable<ProjectApiCost["breakdown"][number]["usage"]> }
        : {}),
    };
  });
  const known = breakdown.filter((charge) => charge.usd !== null);
  return {
    usd:
      known.length || !rows.length
        ? known.reduce((sum, charge) => sum + (charge.usd ?? 0), 0)
        : null,
    unconfirmed: breakdown.some((row) => row.unconfirmed),
    estimated: breakdown.some((charge) => charge.estimated),
    breakdown,
  };
}
