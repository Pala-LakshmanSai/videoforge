-- Extend the existing render terminal capability for immutable KIE_FAL projects.
-- Reuse the accepted API render barrier and keep the historical RunPod branches intact.
CREATE FUNCTION public.videoforge_v209_api_outputs_accepted(
  checked_account_id uuid, checked_workspace_id uuid,
  checked_generation_request_id uuid, checked_runtime_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,pg_catalog AS $$
DECLARE
  ready jsonb;
  expected_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.generation_requests request
    JOIN public.projects project ON project.account_id=request.account_id
      AND project.workspace_id=request.workspace_id AND project.id=request.project_id
    JOIN public.video_runtime_states runtime ON runtime.account_id=request.account_id
      AND runtime.workspace_id=request.workspace_id AND runtime.generation_request_id=request.id
    WHERE request.account_id=checked_account_id AND request.workspace_id=checked_workspace_id
      AND request.id=checked_generation_request_id AND runtime.id=checked_runtime_id
      AND runtime.project_id=request.project_id
      AND runtime.project_revision_id=request.project_revision_id
      AND project.generation_provider='KIE_FAL'
  ) THEN RETURN false; END IF;

  SELECT count(*) INTO expected_count
    FROM public.generation_requests request
    JOIN public.hosted_canonical_timing_bridges bridge
      ON bridge.account_id=request.account_id AND bridge.workspace_id=request.workspace_id
      AND bridge.project_revision_id=request.project_revision_id,
      jsonb_array_elements(bridge.task_manifest) item
    WHERE request.account_id=checked_account_id AND request.workspace_id=checked_workspace_id
      AND request.id=checked_generation_request_id AND item->>'lane' IN ('IMAGE','AVATAR');
  IF expected_count<1 OR
     (SELECT count(*) FROM public.hosted_api_generation_jobs job
       WHERE job.account_id=checked_account_id AND job.workspace_id=checked_workspace_id
         AND job.generation_request_id=checked_generation_request_id)<>expected_count THEN
    RETURN false;
  END IF;

  ready:=public.videoforge_read_hosted_v209_ready_render_inputs(
    checked_account_id,checked_workspace_id,checked_generation_request_id);
  IF ready IS NULL OR jsonb_array_length(ready->'acceptedVisuals')<>expected_count THEN
    RETURN false;
  END IF;

  -- The ready reader checks successful jobs, both completed lanes, accepted assets,
  -- live receipts, and accepted units. Also bind every expected task pointer and unit
  -- to this exact request and runtime before the final MP4 becomes durable.
  RETURN NOT EXISTS (
    SELECT 1 FROM public.generation_requests request
    JOIN public.hosted_canonical_timing_bridges bridge
      ON bridge.account_id=request.account_id AND bridge.workspace_id=request.workspace_id
      AND bridge.project_revision_id=request.project_revision_id
    CROSS JOIN LATERAL jsonb_array_elements(bridge.task_manifest) item
    LEFT JOIN public.generation_tasks task ON task.account_id=request.account_id
      AND task.workspace_id=request.workspace_id AND task.id=(item->>'id')::uuid
      AND task.project_revision_id=request.project_revision_id
    LEFT JOIN public.hosted_api_generation_jobs job ON job.account_id=request.account_id
      AND job.workspace_id=request.workspace_id AND job.generation_request_id=request.id
      AND job.generation_task_id=task.id AND job.lane=item->>'lane'
    LEFT JOIN public.video_runtime_accepted_units unit ON unit.account_id=request.account_id
      AND unit.workspace_id=request.workspace_id AND unit.runtime_id=checked_runtime_id
      AND unit.project_revision_id=request.project_revision_id AND unit.api_job_id=job.id
      AND unit.item_id=task.id::text
      AND unit.lane=CASE item->>'lane' WHEN 'IMAGE' THEN 'mage_image' ELSE 'soulx_avatar' END
      AND unit.object_key=job.output_object_key AND unit.checksum_sha256=job.output_sha256
      AND unit.content_length=job.output_bytes
    WHERE request.account_id=checked_account_id AND request.workspace_id=checked_workspace_id
      AND request.id=checked_generation_request_id AND item->>'lane' IN ('IMAGE','AVATAR')
      AND (task.id IS NULL OR task.state<>'COMPLETE' OR task.finished_at IS NULL
        OR task.accepted_attempt_id IS NOT NULL OR task.accepted_api_job_id IS DISTINCT FROM job.id
        OR job.id IS NULL OR job.state<>'SUCCEEDED' OR job.completed_at IS NULL
        OR unit.id IS NULL)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_v209_api_outputs_accepted(uuid,uuid,uuid,uuid)
  FROM PUBLIC;

DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.videoforge_read_v209_render_terminal_candidate(uuid,uuid,uuid)'::regprocedure)
    INTO definition;
  IF strpos(definition,$old$'projectId',attempt.project_id,'projectRevisionId',attempt.project_revision_id,$old$)=0
     OR strpos(definition,$old$FROM public.hosted_cpu_job_attempts attempt
    JOIN public.hosted_render_plans plan$old$)=0 THEN
    RAISE EXCEPTION 'API render candidate preimage drifted';
  END IF;
  definition:=replace(definition,
    $old$'projectId',attempt.project_id,'projectRevisionId',attempt.project_revision_id,$old$,
    $new$'projectId',attempt.project_id,'projectRevisionId',attempt.project_revision_id,
    'generationProvider',project.generation_provider,
    'apiOutputsAccepted',CASE WHEN project.generation_provider='KIE_FAL' THEN
      public.videoforge_v209_api_outputs_accepted(attempt.account_id,attempt.workspace_id,
        runtime.generation_request_id,runtime.id) ELSE false END,$new$);
  definition:=replace(definition,
    $old$FROM public.hosted_cpu_job_attempts attempt
    JOIN public.hosted_render_plans plan$old$,
    $new$FROM public.hosted_cpu_job_attempts attempt
    JOIN public.projects project ON project.account_id=attempt.account_id
      AND project.workspace_id=attempt.workspace_id AND project.id=attempt.project_id
    JOIN public.hosted_render_plans plan$new$);
  EXECUTE definition;

  SELECT pg_get_functiondef('public.videoforge_finalize_v209_render_terminal(jsonb)'::regprocedure)
    INTO definition;
  IF strpos(definition,$old$(lease.release_reason<>'HOSTED_PAIR_OUTPUTS_ACCEPTED' AND NOT (
      lease.release_reason='HOSTED_PAIR_PROVIDER_TERMINAL' AND
      (SELECT count(DISTINCT a.lane) FROM public.hosted_serverless_output_barrier_completions b
       JOIN public.serverless_attempts a ON a.id=b.attempt_id
       WHERE a.account_id=account_id AND a.workspace_id=workspace_id
         AND a.generation_request_id=request.id AND a.state='SUCCEEDED')=2))$old$)=0 THEN
    RAISE EXCEPTION 'API render finalizer preimage drifted';
  END IF;
  definition:=replace(definition,
    $old$(lease.release_reason<>'HOSTED_PAIR_OUTPUTS_ACCEPTED' AND NOT (
      lease.release_reason='HOSTED_PAIR_PROVIDER_TERMINAL' AND
      (SELECT count(DISTINCT a.lane) FROM public.hosted_serverless_output_barrier_completions b
       JOIN public.serverless_attempts a ON a.id=b.attempt_id
       WHERE a.account_id=account_id AND a.workspace_id=workspace_id
         AND a.generation_request_id=request.id AND a.state='SUCCEEDED')=2))$old$,
    $new$(lease.release_reason<>'HOSTED_PAIR_OUTPUTS_ACCEPTED' AND NOT (
      (lease.release_reason='HOSTED_PAIR_PROVIDER_TERMINAL' AND
       (SELECT count(DISTINCT a.lane) FROM public.hosted_serverless_output_barrier_completions b
        JOIN public.serverless_attempts a ON a.id=b.attempt_id
        WHERE a.account_id=account_id AND a.workspace_id=workspace_id
          AND a.generation_request_id=request.id AND a.state='SUCCEEDED')=2)
      OR (lease.release_reason='HOSTED_API_OUTPUTS_ACCEPTED' AND
        public.videoforge_v209_api_outputs_accepted(account_id,workspace_id,request.id,runtime.id))))$new$);
  EXECUTE definition;
END;
$migration$;
