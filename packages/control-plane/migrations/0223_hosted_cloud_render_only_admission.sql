-- Explicit accepted-media rerenders share fair VIDEO admission but never initialize a
-- second provider runtime. 218's pre-provider defer predicate is intentionally false
-- once the source bridge/prompts are complete; this exact new-request branch is separate.
DO $migration$
DECLARE definition text; old_guard text; new_guard text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_admit_hosted_v209_generation_after_reclaim(uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 old_guard:=$old$IF NOT (
    (EXISTS(SELECT 1 FROM public.project_revisions r$old$;
 new_guard:=$new$IF NOT (
    EXISTS(SELECT 1 FROM public.hosted_render_only_runs run
     JOIN public.hosted_cpu_job_attempts render ON render.id=run.id
      AND render.account_id=run.account_id AND render.workspace_id=run.workspace_id
      AND render.project_id=run.project_id AND render.project_revision_id=run.project_revision_id
     WHERE run.account_id=supplied_account_id AND run.workspace_id=supplied_workspace_id
      AND run.project_id=supplied_project_id AND run.project_revision_id=request.project_revision_id
      AND run.generation_request_id=request.id AND run.created_by_user_id=supplied_user_id
      AND run.state='PREPARING' AND run.execution_bundle_sha256=render.execution_bundle_sha256
      AND render.submission_idempotency_key='render-only:'||run.id::text
      AND render.kind='RENDER' AND render.execution_backend='RUNPOD_POD'
      AND render.state IN ('OUTBOXED','RUNNING') AND render.deadline_at>db_now
      AND render.cancellation_requested_at IS NULL AND render.terminal_at IS NULL
      AND public.videoforge_render_only_source_valid(run.id)
      AND public.videoforge_cloud_render_inputs_valid(render.id)) OR
    (EXISTS(SELECT 1 FROM public.project_revisions r$new$;
 IF (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>3
  OR (length(definition)-length(replace(definition,'PERFORM public.videoforge_prepare_hosted_v209_runtime(','')))
   /length('PERFORM public.videoforge_prepare_hosted_v209_runtime(')<>3 THEN
  RAISE EXCEPTION 'render-only admission reviewed preimage mismatch' USING ERRCODE='55000'; END IF;
 EXECUTE replace(definition,old_guard,new_guard);
END; $migration$;
