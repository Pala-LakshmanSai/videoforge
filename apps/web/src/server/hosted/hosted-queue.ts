import { createHostedAuth, type HostedExecutionContext } from "./auth";
import type { HostedRuntimeConfiguration } from "./configuration";
import { createNeonExecutor, createNeonPool } from "./neon";
import { qualifiedPersonalWorkers } from "./personal-worker-readiness";

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-videoforge-runtime": "hosted-v2-06",
    },
  });
}

interface HostedQueueRow extends Record<string, unknown> {
  readonly script_state: string | null;
  readonly project_id: string;
  readonly title: string;
  readonly state: string;
  readonly stage: string;
  readonly cancellable_attempt_id: string | null;
  readonly active_kind: string | null;
  readonly latest_kind: string | null;
  readonly latest_state: string | null;
  readonly execution_backend: string;
  readonly cloud_phase: string | null;
  readonly cloud_reservation_count: string | number | null;
  readonly active_request_count: string | number | null;
  readonly active_cpu_count: string | number | null;
  readonly total_serverless_count: string | number | null;
  readonly nonplanned_serverless_count: string | number | null;
  readonly active_serverless_count: string | number | null;
  readonly dispatching_side_effect_count: string | number | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

function hostedQueueCount(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function handleHostedQueue(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const session = await createHostedAuth({ config, pool, executionContext }).api.getSession({
      headers: request.headers,
    });
    if (!session?.user?.id) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    const scope = await pool.query(`SELECT * FROM videoforge_hosted_session_scope($1)`, [
      session.session.token,
    ]);
    const accountId = scope.rows[0]?.account_id;
    const workspaceId = scope.rows[0]?.workspace_id;
    if (typeof accountId !== "string" || typeof workspaceId !== "string") {
      return json({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, 403);
    }
    const result = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        accountId,
      ]);
      const projects = await transaction.query<HostedQueueRow>(
        `SELECT project.id AS project_id, project.name AS title, script.state AS script_state,
                CASE
                  WHEN script.state IN ('FAILED','UNKNOWN_NO_RETRY') THEN 'NEEDS_ATTENTION'
                  WHEN script.state='WAITING' THEN 'WAITING'
                  WHEN script.state IN ('GENERATING','PREPARING') THEN 'IN_PROGRESS'
                  WHEN cloud.state NOT IN ('WAITING_CAPACITY','CLEAN') THEN 'IN_PROGRESS'
                  WHEN active_attempt.id IS NOT NULL THEN 'IN_PROGRESS'
                  WHEN cloud.state='WAITING_CAPACITY' THEN 'WAITING'
                  WHEN latest_generation.state='FAILED' THEN 'NEEDS_ATTENTION'
                  WHEN latest_generation.state='CANCELLED' THEN 'CANCELLED'
                  WHEN latest_generation.state='ACTIVE' THEN 'IN_PROGRESS'
                  WHEN context.state IN ('FAILED','UNKNOWN')
                    OR prompt_task.state IN ('FAILED','BLOCKED')
                    OR latest_attempt.state IN ('FAILED','EXPIRED') THEN 'NEEDS_ATTENTION'
                  WHEN latest_attempt.kind='ASR' AND latest_attempt.state='SUCCEEDED'
                    AND context.id IS NULL THEN 'ACTION_REQUIRED'
                  WHEN latest_attempt.state='CANCELLED' THEN 'CANCELLED'
                  ELSE 'WAITING'
                END AS state,
                CASE
                  WHEN script.state IS NOT NULL AND script.state<>'COMPLETE' THEN 'Generate voiceover'
                  WHEN cloud.state IS NOT NULL AND cloud.state<>'CLEAN' THEN
                    CASE cloud.kind WHEN 'ASR' THEN 'Transcription' WHEN 'SPAN_AUDIO' THEN 'Audio preparation'
                      WHEN 'RENDER' THEN 'Final assembly' ELSE 'Video generation' END
                  WHEN active_attempt.kind='ASR' OR (latest_attempt.kind='ASR'
                    AND latest_attempt.state IN ('FAILED','EXPIRED','CANCELLED')) THEN 'Transcription'
                  WHEN active_attempt.kind='RENDER' OR (latest_attempt.kind='RENDER'
                    AND latest_attempt.state IN ('FAILED','EXPIRED','CANCELLED')) THEN 'Final assembly'
                  WHEN latest_generation.state IN ('ACTIVE','FAILED','CANCELLED') THEN 'Video generation'
                  WHEN context.state IN ('FAILED','UNKNOWN') OR (context.id IS NULL
                    AND latest_attempt.kind='ASR' AND latest_attempt.state='SUCCEEDED')
                    THEN 'Voiceover context'
                  WHEN prompt_task.state IN ('FAILED','BLOCKED') THEN 'Image prompts'
                  ELSE 'Project setup'
                END AS stage,
                CASE WHEN cloud.state IS NOT NULL AND cloud.state<>'CLEAN' THEN 'RUNPOD_POD'
                  ELSE COALESCE(active_attempt.execution_backend,latest_attempt.execution_backend,
                    revision.media_execution_backend,script.options->>'execution_backend','PERSONAL_WORKER') END AS execution_backend,
                CASE WHEN cloud.state='CLEAN' AND latest_attempt.state='SUCCEEDED'
                    AND latest_generation.state IS DISTINCT FROM 'ACTIVE' THEN 'COMPLETE'
                  WHEN cloud.state<>'CLEAN' THEN cloud.state ELSE NULL END AS cloud_phase,
                active_attempt.id AS cancellable_attempt_id,
                COALESCE(active_attempt.kind,CASE WHEN cloud.state<>'CLEAN' THEN cloud.kind END) AS active_kind,
                latest_attempt.kind AS latest_kind,
                latest_attempt.state AS latest_state,
                capability.active_request_count,
                capability.active_cpu_count,
                capability.total_serverless_count,
                capability.nonplanned_serverless_count,
                capability.active_serverless_count,
                capability.dispatching_side_effect_count,
                capability.cloud_reservation_count,
                project.created_at,
                GREATEST(project.created_at, COALESCE(latest_attempt.updated_at,project.created_at),
                  COALESCE(context.finished_at,context.started_at,project.created_at),
                  COALESCE(latest_generation.updated_at,project.created_at)) AS updated_at
           FROM projects AS project
            LEFT JOIN hosted_script_projects script ON script.project_id=project.id AND script.account_id=project.account_id AND script.workspace_id=project.workspace_id
            LEFT JOIN LATERAL (
              SELECT revision.media_execution_backend FROM project_revisions AS revision
               WHERE revision.account_id=project.account_id AND revision.workspace_id=project.workspace_id
                 AND revision.project_id=project.id
               ORDER BY revision.revision_number DESC LIMIT 1
            ) AS revision ON true
            LEFT JOIN LATERAL (
              SELECT request.state,request.updated_at
                FROM generation_requests AS request
               WHERE request.account_id=project.account_id
                 AND request.workspace_id=project.workspace_id
                 AND request.project_id=project.id
               ORDER BY request.created_at DESC,request.id DESC LIMIT 1
            ) AS latest_generation ON true
            LEFT JOIN LATERAL (
             SELECT attempt.id,attempt.kind,attempt.state,attempt.updated_at,attempt.execution_backend,
                    attempt.project_revision_id
               FROM hosted_cpu_job_attempts AS attempt
              WHERE attempt.account_id=project.account_id
                AND attempt.workspace_id=project.workspace_id
                AND attempt.project_id=project.id
                AND attempt.retention_deleted_at IS NULL
                AND attempt.state IN ('OUTBOXED','SUBMITTED','RUNNING','RECONCILING','CANCEL_REQUESTED')
              ORDER BY attempt.created_at DESC,attempt.id DESC LIMIT 1
           ) AS active_attempt ON true
           LEFT JOIN LATERAL (
             SELECT attempt.id,attempt.kind,attempt.state,attempt.updated_at,attempt.execution_backend,
                    attempt.project_revision_id
               FROM hosted_cpu_job_attempts AS attempt
              WHERE attempt.account_id=project.account_id
                AND attempt.workspace_id=project.workspace_id
                AND attempt.project_id=project.id
                AND attempt.retention_deleted_at IS NULL
              ORDER BY attempt.created_at DESC,attempt.id DESC LIMIT 1
           ) AS latest_attempt ON true
           LEFT JOIN LATERAL (
             SELECT reservation.state,attempt.kind
               FROM cloud_media_jobs AS job
               JOIN cloud_media_reservations AS reservation
                 ON reservation.account_id=job.account_id AND reservation.workspace_id=job.workspace_id
                AND reservation.id=job.reservation_id AND reservation.leased_attempt_id=job.attempt_id
               JOIN hosted_cpu_job_attempts AS attempt
                 ON attempt.account_id=job.account_id AND attempt.workspace_id=job.workspace_id
                AND attempt.id=job.attempt_id AND attempt.execution_backend='RUNPOD_POD'
              WHERE job.account_id=project.account_id AND job.workspace_id=project.workspace_id
                AND attempt.project_id=project.id AND reservation.project_id=project.id
                AND reservation.project_revision_id=attempt.project_revision_id
                AND reservation.fence_id IS NOT NULL
                AND (reservation.state<>'CLEAN' OR job.attempt_id=COALESCE(active_attempt.id,latest_attempt.id))
              ORDER BY CASE WHEN reservation.state NOT IN ('WAITING_CAPACITY','CLEAN') THEN 0
                WHEN reservation.state='WAITING_CAPACITY' THEN 1 ELSE 2 END,attempt.created_at DESC,attempt.id DESC
              LIMIT 1
           ) AS cloud ON true
           LEFT JOIN LATERAL (
             SELECT context.id,context.state,context.started_at,context.finished_at
               FROM hosted_voiceover_contexts AS context
              WHERE context.account_id=project.account_id
                AND context.workspace_id=project.workspace_id
                AND context.project_id=project.id
              ORDER BY context.created_at DESC LIMIT 1
           ) AS context ON true
           LEFT JOIN LATERAL (
             SELECT task.state
               FROM generation_tasks AS task
              WHERE task.account_id=project.account_id
                AND task.workspace_id=project.workspace_id
                AND task.project_revision_id IN (
                  SELECT revision.id FROM project_revisions AS revision
                   WHERE revision.account_id=project.account_id
                     AND revision.workspace_id=project.workspace_id
                     AND revision.project_id=project.id
                )
                AND task.task_key LIKE 'prompt:scene-batch:%'
              ORDER BY task.created_at DESC,task.id DESC LIMIT 1
           ) AS prompt_task ON true
           LEFT JOIN LATERAL (
             SELECT
               (SELECT count(*) FROM generation_requests AS request
                 WHERE request.account_id=project.account_id
                   AND request.workspace_id=project.workspace_id
                   AND request.project_id=project.id
                   AND request.state IN ('WAITING','RETRY_WAIT','ADMITTED','ACTIVE','CANCELLING')
               ) AS active_request_count,
               (SELECT count(*) FROM hosted_cpu_job_attempts AS attempt
                 WHERE attempt.account_id=project.account_id
                   AND attempt.workspace_id=project.workspace_id
                   AND attempt.project_id=project.id
                   AND attempt.state IN ('PLANNED','OUTBOXED','SUBMITTED','RUNNING',
                     'RECONCILING','CANCEL_REQUESTED')
               ) AS active_cpu_count,
               (SELECT count(*) FROM serverless_attempts AS attempt
                 WHERE attempt.account_id=project.account_id
                   AND attempt.workspace_id=project.workspace_id
                   AND attempt.project_id=project.id
               ) AS total_serverless_count,
               (SELECT count(*) FROM serverless_attempts AS attempt
                 WHERE attempt.account_id=project.account_id
                   AND attempt.workspace_id=project.workspace_id
                   AND attempt.project_id=project.id
                   AND attempt.state<>'PLANNED'
               ) AS nonplanned_serverless_count,
               (SELECT count(*) FROM serverless_attempts AS attempt
                 WHERE attempt.account_id=project.account_id
                   AND attempt.workspace_id=project.workspace_id
                   AND attempt.project_id=project.id
                   AND attempt.state IN ('PLANNED','OUTBOXED','DISPATCHING','ASSIGNED','IN_QUEUE',
                     'IN_PROGRESS','UPLOADING','RECONCILING','CANCELLING')
               ) AS active_serverless_count,
               (SELECT count(*) FROM hosted_voiceover_contexts AS context
                 WHERE context.account_id=project.account_id
                   AND context.workspace_id=project.workspace_id
                   AND context.project_id=project.id
                   AND context.state='DISPATCHING'
               ) + (SELECT count(*) FROM hosted_prompt_runs AS prompt_run
                 WHERE prompt_run.account_id=project.account_id
                   AND prompt_run.workspace_id=project.workspace_id
                   AND prompt_run.project_id=project.id
                   AND prompt_run.state='DISPATCHING'
               ) AS dispatching_side_effect_count,
               (SELECT count(*) FROM cloud_media_reservations AS reservation
                 WHERE reservation.account_id=project.account_id
                   AND reservation.workspace_id=project.workspace_id
                   AND reservation.project_id=project.id AND reservation.state<>'CLEAN'
               ) AS cloud_reservation_count
           ) AS capability ON true
          WHERE project.account_id=$1 AND project.workspace_id=$2
            AND project.status='ACTIVE'
            AND project.project_kind='USER'
            AND (active_attempt.id IS NOT NULL OR (cloud.state IS NOT NULL AND cloud.state<>'CLEAN') OR NOT EXISTS (
              SELECT 1 FROM hosted_cpu_job_attempts AS completed_render
               WHERE completed_render.account_id=project.account_id
                 AND completed_render.workspace_id=project.workspace_id
               AND completed_render.project_id=project.id
                 AND completed_render.kind='RENDER' AND completed_render.state='SUCCEEDED'
            ))
          ORDER BY updated_at DESC,project.id DESC`,
        [accountId, workspaceId],
      );
      const workers = await qualifiedPersonalWorkers(
        transaction,
        config.mediaWorkerRelease,
        accountId,
        workspaceId,
      );
      return { projects: projects.rows, workers };
    });
    return json({
      schema_version: "videoforge-hosted-queue/v2",
      worker_state: result.workers.state,
      cloud_media_available: Boolean(config.cloudMedia?.enabled),
      projects: result.projects.map((project) => {
        const activeCpu = hostedQueueCount(project.active_cpu_count);
        const totalServerless = hostedQueueCount(project.total_serverless_count);
        const nonplannedServerless = hostedQueueCount(project.nonplanned_serverless_count);
        const activeServerless = hostedQueueCount(project.active_serverless_count);
        const dispatchingSideEffects = hostedQueueCount(project.dispatching_side_effect_count);
        return {
          project_id: project.project_id,
          title: project.title,
          state: project.state,
          stage: project.stage,
          execution_backend: project.execution_backend,
          cloud_phase: project.cloud_phase,
          cancellable_attempt_id: project.cancellable_attempt_id,
          active_job_kind: project.active_kind ?? null,
          latest_job_kind: project.latest_kind ?? null,
          latest_job_state: project.latest_state ?? null,
          // Mirrors videoforge_cancel_hosted_project_predispatch: one active generation request,
          // no live CPU attempt and only PLANNED provider attempts may be cancelled by the owner.
          can_cancel_project:
            hostedQueueCount(project.active_request_count) === 1 &&
            activeCpu === 0 &&
            (totalServerless === 0 || totalServerless === 2) &&
            nonplannedServerless === 0 &&
            hostedQueueCount(project.cloud_reservation_count) === 0,
          // Mirrors videoforge_archive_hosted_project: no live CPU, provider or dispatching work.
          can_delete_project:
            !["GENERATING", "PREPARING", "UNKNOWN_NO_RETRY"].includes(project.script_state ?? "") &&
            activeCpu === 0 &&
            activeServerless === 0 &&
            dispatchingSideEffects === 0 &&
            hostedQueueCount(project.cloud_reservation_count) === 0,
          created_at: new Date(project.created_at).toISOString(),
          updated_at: new Date(project.updated_at).toISOString(),
        };
      }),
    });
  } finally {
    await pool.end();
  }
}
