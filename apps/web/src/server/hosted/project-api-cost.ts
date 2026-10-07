import type { SqlExecutor } from "@videoforge/control-plane";
import type { ProjectApiCost } from "../../lib/cloud-compute";

// Incurred work across every revision/attempt; reservations are not billed charges.
// Kie/Fal do not persist invoice amounts. Their existing planning rates remain estimates.
export const PROJECT_API_COST_SQL = `
WITH project_prompt_cost AS (
  SELECT event.attempt_id,
         CASE WHEN task.task_key LIKE 'prompt:voiceover-context:%' THEN 'Context analysis'
              WHEN bool_or(event.event_type IN ('REPORTED','SETTLED','RELEASED')
                           AND event.details->>'rate_version'='runware-air-gpt-6-luna-standard-2026-10-06')
                THEN 'Scene prompts (GPT-6 Luna)'
              ELSE 'Scene prompts' END AS label,
         COALESCE(sum(event.amount_micro_usd) FILTER (WHERE event.event_type='SETTLED'),
                  max(event.amount_micro_usd) FILTER (WHERE event.event_type='REPORTED'),
                  0)::numeric / 1000000
           - COALESCE(sum(event.amount_micro_usd) FILTER (WHERE event.event_type='REFUNDED'),0)::numeric / 1000000 AS usd,
         NOT bool_or(event.event_type IN ('SETTLED','RELEASED')) AS unconfirmed,
         bool_or(event.details->>'cost_basis'='PINNED_RATE_ESTIMATE'
                 AND event.details->>'invoice_verified' IS DISTINCT FROM 'true') AS estimated
    FROM cost_events event
    JOIN project_revisions revision ON revision.account_id=event.account_id
      AND revision.workspace_id=event.workspace_id AND revision.id=event.owner_id
    JOIN generation_tasks task ON task.account_id=event.account_id
      AND task.workspace_id=event.workspace_id AND task.id=event.task_id
   WHERE event.account_id=$1 AND event.workspace_id=$2 AND revision.project_id=$3
     AND event.owner_type='PROJECT_REVISION' AND task.lane='PROMPT'
   GROUP BY event.attempt_id, task.task_key
), project_api_charges AS (
  SELECT label, greatest(usd,0) AS usd, unconfirmed, estimated FROM project_prompt_cost
  UNION ALL
  SELECT 'Legacy generation APIs',
         CASE WHEN ledger.id IS NOT NULL THEN greatest(0,
           CASE WHEN ledger.settled_usd>0 THEN ledger.settled_usd
                WHEN ledger.reported_usd>0 THEN ledger.reported_usd
                ELSE greatest(ledger.estimated_usd,ledger.reserved_usd) END
           + ledger.possible_duplicate_usd - ledger.refunded_usd) ELSE NULL END,
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
    JOIN hosted_video_plans plan ON plan.account_id=job.account_id
      AND plan.workspace_id=job.workspace_id AND plan.project_revision_id=job.project_revision_id
   WHERE job.account_id=$1 AND job.workspace_id=$2 AND job.project_id=$3
     AND job.state<>'PREPARED'
     AND COALESCE(job.failure_code,'') NOT LIKE '%BEFORE_SUBMIT'
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
  UNION ALL
  -- J1 returns job state/audio, but no monetary charge. Never invent a zero price.
  SELECT 'Generated narration', NULL::numeric, true, false
    FROM hosted_script_projects intake
   WHERE intake.account_id=$1 AND intake.workspace_id=$2 AND intake.project_id=$3
     AND intake.state NOT IN ('WAITING','CANCELLED')
)
SELECT label, sum(usd) AS usd, bool_or(unconfirmed OR usd IS NULL) AS unconfirmed,
       bool_or(estimated) AS estimated
  FROM project_api_charges GROUP BY label ORDER BY label`;

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
