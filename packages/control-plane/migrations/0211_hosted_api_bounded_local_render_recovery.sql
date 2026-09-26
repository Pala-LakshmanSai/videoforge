-- Up to five total local render attempts, independent of failure order.
-- No provider calls, paid-work replay, or accepted output replacement.
-- Keep the accepted Kie/Fal jobs, receipts, render plan, and generation identity intact.
CREATE TABLE public.hosted_api_local_render_recoveries (
  generation_request_id uuid NOT NULL,
  retry_ordinal integer NOT NULL CHECK (retry_ordinal BETWEEN 2 AND 5),
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  runtime_id uuid NOT NULL,
  failed_attempt_id uuid NOT NULL,
  retry_attempt_id uuid NOT NULL UNIQUE,
  replacement_bundle_sha256 text NOT NULL CHECK (replacement_bundle_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('PREPARING','CONSUMED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (generation_request_id,failed_attempt_id),
  UNIQUE (generation_request_id,retry_ordinal),
  FOREIGN KEY (account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id),
  FOREIGN KEY (account_id,workspace_id,runtime_id)
    REFERENCES public.video_runtime_states(account_id,workspace_id,id),
  FOREIGN KEY (account_id,workspace_id,failed_attempt_id)
    REFERENCES public.hosted_cpu_job_attempts(account_id,workspace_id,id)
);
ALTER TABLE public.hosted_api_local_render_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_api_local_render_recoveries FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_api_local_render_recoveries_tenant
  ON public.hosted_api_local_render_recoveries
  USING (account_id=public.videoforge_current_account_id())
  WITH CHECK (account_id=public.videoforge_current_account_id());
REVOKE ALL ON public.hosted_api_local_render_recoveries FROM PUBLIC;

-- The terminal-state trigger accepts only this transaction-local PREPARING proof.
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.videoforge_validate_video_runtime_state()'::regprocedure)
    INTO definition;
  IF strpos(definition,$old$  IF OLD.stage IN ('COMPLETE', 'FAILED', 'CANCELED') THEN$old$)=0
     OR strpos(definition,'hosted_api_fourth_render_output_recoveries')=0 THEN
    RAISE EXCEPTION 'local render recovery runtime trigger preimage drifted';
  END IF;
  definition:=replace(definition,
    $old$  IF OLD.stage IN ('COMPLETE', 'FAILED', 'CANCELED') THEN$old$,
    $new$  IF OLD.stage='FAILED' AND OLD.terminal_reason='RENDER_FAILURE'
     AND NEW.stage='RENDERING' AND NEW.terminal_reason IS NULL
     AND NEW.terminal_at IS NULL AND NEW.final_output_sha256 IS NULL
     AND NEW.render_manifest_sha256 IS NOT DISTINCT FROM OLD.render_manifest_sha256
     AND EXISTS (
       SELECT 1 FROM public.hosted_api_local_render_recoveries recovery
       JOIN public.generation_requests request ON request.id=recovery.generation_request_id
       WHERE recovery.account_id=OLD.account_id AND recovery.workspace_id=OLD.workspace_id
         AND recovery.project_id=OLD.project_id AND recovery.project_revision_id=OLD.project_revision_id
         AND recovery.runtime_id=OLD.id AND recovery.generation_request_id=OLD.generation_request_id
         AND recovery.state='PREPARING' AND request.state='ACTIVE'
         AND request.terminal_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.video_runtime_lane_states lane
       WHERE lane.runtime_id=OLD.id AND lane.state<>'SUCCEEDED') THEN
    RETURN NEW;
  END IF;
  IF OLD.stage IN ('COMPLETE', 'FAILED', 'CANCELED') THEN$new$);
  EXECUTE definition;
END;
$migration$;

CREATE FUNCTION public.videoforge_prepare_hosted_api_local_render_recovery(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid,
  supplied_project_id uuid, supplied_failed_attempt_id uuid, supplied_retry_attempt_id uuid,
  supplied_replacement_bundle_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
DECLARE
  request public.generation_requests%ROWTYPE;
  runtime public.video_runtime_states%ROWTYPE;
  failed public.hosted_cpu_job_attempts%ROWTYPE;
  recovery public.hosted_api_local_render_recoveries%ROWTYPE;
  provider_lease public.provider_workload_leases%ROWTYPE;
  db_now timestamptz:=transaction_timestamp();
  attempt_count integer;
  failure_code text;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_retry_attempt_id IS NULL
     OR supplied_replacement_bundle_sha256 IS NULL
     OR supplied_replacement_bundle_sha256 !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'local render recovery tenant or identity invalid' USING ERRCODE='42501';
  END IF;
  SELECT row.* INTO request FROM public.generation_requests row
    WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
      AND row.project_id=supplied_project_id
    ORDER BY row.created_at DESC,row.id DESC LIMIT 1 FOR UPDATE;
  IF request.id IS NULL THEN
    RAISE EXCEPTION 'local render recovery request missing' USING ERRCODE='23514';
  END IF;
  SELECT row.* INTO recovery FROM public.hosted_api_local_render_recoveries row
    WHERE row.generation_request_id=request.id
      AND row.failed_attempt_id=supplied_failed_attempt_id FOR UPDATE;
  IF recovery.generation_request_id IS NOT NULL THEN
    IF recovery.failed_attempt_id<>supplied_failed_attempt_id
       OR recovery.replacement_bundle_sha256<>supplied_replacement_bundle_sha256
       OR recovery.state<>'CONSUMED' THEN
      RAISE EXCEPTION 'local render recovery identity drift' USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('schema_version','videoforge-hosted-render-disk-recovery/v1',
      'revision_id',recovery.project_revision_id,'retry_attempt_id',recovery.retry_attempt_id,
      'recovery_kind','LOCAL','recovery_key','render-local-recovery:'||recovery.retry_attempt_id::text,'replayed',true);
  END IF;
  SELECT row.* INTO runtime FROM public.video_runtime_states row
    WHERE row.account_id=request.account_id AND row.workspace_id=request.workspace_id
      AND row.generation_request_id=request.id FOR UPDATE;
  SELECT row.* INTO failed FROM public.hosted_cpu_job_attempts row
    WHERE row.account_id=request.account_id AND row.workspace_id=request.workspace_id
      AND row.id=supplied_failed_attempt_id AND row.project_id=request.project_id
      AND row.project_revision_id=request.project_revision_id AND row.kind='RENDER' FOR UPDATE;
  SELECT row.* INTO provider_lease FROM public.provider_workload_leases row
    WHERE row.account_id=request.account_id AND row.workspace_id=request.workspace_id
      AND row.generation_request_id=request.id FOR UPDATE;
  SELECT count(*) INTO attempt_count FROM public.hosted_cpu_job_attempts job
    WHERE job.account_id=request.account_id AND job.workspace_id=request.workspace_id
      AND job.project_revision_id=request.project_revision_id AND job.kind='RENDER';
  SELECT lease.failure_code INTO failure_code FROM public.media_worker_leases lease
    WHERE lease.account_id=failed.account_id AND lease.workspace_id=failed.workspace_id
      AND lease.attempt_id=failed.id AND lease.state='FAILED'
    ORDER BY lease.created_at DESC LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM public.projects project
       WHERE project.account_id=request.account_id AND project.workspace_id=request.workspace_id
         AND project.id=request.project_id AND project.status='ACTIVE'
         AND project.generation_provider='KIE_FAL')
     OR request.state<>'FAILED' OR request.terminal_at IS NULL
     OR request.created_by_user_id<>supplied_user_id
     OR runtime.id IS NULL OR runtime.stage<>'FAILED'
     OR runtime.terminal_reason<>'RENDER_FAILURE' OR runtime.terminal_at IS NULL
     OR runtime.final_output_sha256 IS NOT NULL OR runtime.render_manifest_sha256 IS NULL
     OR failed.id IS NULL OR failed.state<>'FAILED' OR failed.terminal_at IS NULL
     OR failed.result_content_length IS NOT NULL OR failed.result_checksum_sha256 IS NOT NULL
     OR failed.result_receipt_sha256 IS NOT NULL
     OR failed.image_digest IS NULL OR failed.image_digest !~ '^sha256:[0-9a-f]{64}$'
     OR failed.execution_bundle_sha256 IS DISTINCT FROM failed.image_digest
     OR (failure_code IN ('RENDER_INPUT_INVALID','RENDER_OUTPUT_INVALID')
       AND supplied_replacement_bundle_sha256=failed.image_digest)
     OR EXISTS (SELECT 1 FROM public.hosted_cpu_upload_authorities authority
       WHERE authority.account_id=failed.account_id AND authority.workspace_id=failed.workspace_id
         AND authority.attempt_id=failed.id AND authority.issued_at IS NOT NULL)
     OR attempt_count NOT BETWEEN 1 AND 4
     OR failure_code IS NULL OR failure_code NOT IN (
       'RENDER_INPUT_INVALID','RENDER_OUTPUT_INVALID','RENDER_PROCESS_FAILED',
       'MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT','MEDIA_EXECUTION_IO_FAILED',
       'MEDIA_EXECUTION_TIMEOUT','MEDIA_EXECUTION_SUBPROCESS_FAILED','MEDIA_EXECUTION_FAILED')
     OR EXISTS (SELECT 1 FROM public.hosted_cpu_job_attempts later
       WHERE later.account_id=request.account_id AND later.workspace_id=request.workspace_id
         AND later.project_revision_id=request.project_revision_id AND later.kind='RENDER'
         AND (later.created_at,later.id)>(failed.created_at,failed.id))
     OR EXISTS (SELECT 1 FROM public.media_worker_leases lease
       WHERE lease.attempt_id=failed.id AND lease.state IN ('CLAIMED','RUNNING','COMPLETING'))
     OR provider_lease.id IS NULL OR provider_lease.state<>'RELEASED'
     OR provider_lease.release_reason<>'HOSTED_API_OUTPUTS_ACCEPTED'
     OR EXISTS (SELECT 1 FROM public.provider_workload_leases active_lease
       WHERE active_lease.generation_request_id=request.id AND active_lease.state='ACTIVE')
     OR EXISTS (SELECT 1 FROM public.serverless_attempts paid
       WHERE paid.generation_request_id=request.id)
     OR NOT public.videoforge_v209_api_outputs_accepted(
       request.account_id,request.workspace_id,request.id,runtime.id)
     OR NOT EXISTS (SELECT 1 FROM public.hosted_render_plans plan
       WHERE plan.account_id=request.account_id AND plan.workspace_id=request.workspace_id
         AND plan.project_id=request.project_id AND plan.project_revision_id=request.project_revision_id
         AND plan.schema_version='videoforge-hosted-cpu-submission/v1'
         AND plan.payload->>'kind'='RENDER'
         AND plan.payload_sha256='sha256:'||encode(sha256(convert_to(
           public.videoforge_canonical_jsonb(plan.payload),'UTF8')),'hex'))
     OR EXISTS (SELECT 1 FROM public.video_runtime_events event
       WHERE event.runtime_id=runtime.id AND event.reason='FINAL_OUTPUT_DURABLE') THEN
    RAISE EXCEPTION 'local render recovery evidence rejected' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.hosted_api_local_render_recoveries(
    generation_request_id,retry_ordinal,account_id,workspace_id,project_id,project_revision_id,
    runtime_id,failed_attempt_id,retry_attempt_id,replacement_bundle_sha256,state)
  VALUES(request.id,attempt_count+1,request.account_id,request.workspace_id,request.project_id,
    request.project_revision_id,runtime.id,failed.id,supplied_retry_attempt_id,
    supplied_replacement_bundle_sha256,'PREPARING');
  UPDATE public.generation_requests
    SET state='ACTIVE',terminal_at=NULL,version=version+1,updated_at=db_now
    WHERE id=request.id AND state='FAILED';
  UPDATE public.video_runtime_states
    SET stage='RENDERING',terminal_reason=NULL,terminal_at=NULL,
        version=version+1,updated_at=db_now
    WHERE id=runtime.id AND stage='FAILED';
  UPDATE public.hosted_api_local_render_recoveries SET state='CONSUMED'
    WHERE generation_request_id=request.id AND failed_attempt_id=failed.id AND state='PREPARING';
  INSERT INTO public.video_runtime_events(
    id,account_id,workspace_id,runtime_id,project_revision_id,lane,
    from_state,to_state,reason,detail,occurred_at)
  VALUES(md5('hosted-api-local-render-recovery:'||failed.id::text)::uuid,
    request.account_id,request.workspace_id,runtime.id,request.project_revision_id,NULL,
    'FAILED','RENDERING','LOCAL_RENDER_RECOVERY',
    jsonb_build_object('failed_attempt_id',failed.id,'retry_attempt_id',supplied_retry_attempt_id,
      'replacement_bundle_sha256',supplied_replacement_bundle_sha256,
      'provider_actions_created',false),db_now);
  RETURN jsonb_build_object('schema_version','videoforge-hosted-render-disk-recovery/v1',
    'revision_id',request.project_revision_id,'retry_attempt_id',supplied_retry_attempt_id,
    'recovery_kind','LOCAL','recovery_key','render-local-recovery:'||supplied_retry_attempt_id::text,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_prepare_hosted_api_local_render_recovery(
  uuid,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;


-- Preserve response replay for every already-consumed legacy recovery.
ALTER FUNCTION public.videoforge_prepare_hosted_api_render_recovery(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text)
  RENAME TO videoforge_prepare_hosted_api_legacy_render_recovery;
CREATE FUNCTION public.videoforge_prepare_hosted_api_render_recovery(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid,
  supplied_project_id uuid, supplied_failed_attempt_id uuid, supplied_retry_attempt_id uuid,
  supplied_replacement_bundle_sha256 text, supplied_replacement_worker_version text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM (
    SELECT account_id,workspace_id,project_id,failed_attempt_id FROM public.hosted_api_render_recoveries
    UNION ALL SELECT account_id,workspace_id,project_id,failed_attempt_id FROM public.hosted_api_render_io_recoveries
    UNION ALL SELECT account_id,workspace_id,project_id,failed_attempt_id FROM public.hosted_api_render_input_recoveries
    UNION ALL SELECT account_id,workspace_id,project_id,failed_attempt_id FROM public.hosted_api_first_render_input_recoveries
    UNION ALL SELECT account_id,workspace_id,project_id,failed_attempt_id FROM public.hosted_api_second_render_process_recoveries
    UNION ALL SELECT account_id,workspace_id,project_id,failed_attempt_id FROM public.hosted_api_third_render_signal_recoveries
    UNION ALL SELECT account_id,workspace_id,project_id,failed_attempt_id FROM public.hosted_api_fourth_render_output_recoveries
  ) prior WHERE prior.account_id=supplied_account_id AND prior.workspace_id=supplied_workspace_id
    AND prior.project_id=supplied_project_id AND prior.failed_attempt_id=supplied_failed_attempt_id) THEN
    RETURN public.videoforge_prepare_hosted_api_legacy_render_recovery(
      supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id,
      supplied_failed_attempt_id,supplied_retry_attempt_id,supplied_replacement_bundle_sha256,
      supplied_replacement_worker_version);
  END IF;
  IF supplied_replacement_worker_version IS NULL
     OR supplied_replacement_worker_version !~ '^[0-9]+\.[0-9]+\.[0-9]+$'
     OR string_to_array(supplied_replacement_worker_version,'.')::integer[] < ARRAY[0,1,39] THEN
    RAISE EXCEPTION 'local render recovery requires worker 0.1.39 or later' USING ERRCODE='23514';
  END IF;
  RETURN public.videoforge_prepare_hosted_api_local_render_recovery(
    supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id,
    supplied_failed_attempt_id,supplied_retry_attempt_id,supplied_replacement_bundle_sha256);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_prepare_hosted_api_render_recovery(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_prepare_hosted_api_render_recovery(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text) TO videoforge_v209_runtime_dc9612d6;

CREATE FUNCTION public.videoforge_read_hosted_api_render_recovery_status(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_user_id uuid,
  supplied_project_id uuid,supplied_bundle_sha256 text
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
WITH candidate AS (
  SELECT request.*,runtime.id AS runtime_id,runtime.stage AS runtime_stage,
    runtime.terminal_reason,runtime.final_output_sha256,runtime.render_manifest_sha256,
    failed.id AS failed_id,failed.state AS failed_state,failed.execution_bundle_sha256,failed.image_digest,
    failed.result_content_length,failed.result_checksum_sha256,failed.result_receipt_sha256,
    failure.failure_code,
    (SELECT count(*) FROM hosted_cpu_job_attempts a WHERE a.account_id=request.account_id
      AND a.workspace_id=request.workspace_id AND a.project_revision_id=request.project_revision_id
      AND a.kind='RENDER') AS attempt_count
  FROM generation_requests request
  JOIN projects project ON project.account_id=request.account_id AND project.workspace_id=request.workspace_id
    AND project.id=request.project_id AND project.generation_provider='KIE_FAL' AND project.status='ACTIVE'
  JOIN video_runtime_states runtime ON runtime.account_id=request.account_id
    AND runtime.workspace_id=request.workspace_id AND runtime.generation_request_id=request.id
  JOIN LATERAL (SELECT a.* FROM hosted_cpu_job_attempts a WHERE a.account_id=request.account_id
    AND a.workspace_id=request.workspace_id AND a.project_revision_id=request.project_revision_id
    AND a.kind='RENDER' ORDER BY a.created_at DESC,a.id DESC LIMIT 1) failed ON true
  JOIN LATERAL (SELECT l.failure_code FROM media_worker_leases l WHERE l.account_id=failed.account_id
    AND l.workspace_id=failed.workspace_id AND l.attempt_id=failed.id AND l.state='FAILED'
    ORDER BY l.created_at DESC LIMIT 1) failure ON true
  WHERE request.account_id=supplied_account_id AND request.workspace_id=supplied_workspace_id
    AND request.project_id=supplied_project_id AND request.created_by_user_id=supplied_user_id
    AND public.videoforge_current_account_id()=supplied_account_id
  ORDER BY request.created_at DESC,request.id DESC LIMIT 1
), status AS (
  SELECT failed_id,CASE
    WHEN state<>'FAILED' OR failed_state<>'FAILED' OR runtime_stage<>'FAILED'
      OR terminal_reason<>'RENDER_FAILURE' THEN 'NOT_FAILED'
    WHEN attempt_count>=5 THEN 'RETRY_LIMIT_REACHED'
    WHEN failure_code IN ('RENDER_INPUT_INVALID','RENDER_OUTPUT_INVALID')
      AND execution_bundle_sha256=supplied_bundle_sha256 THEN 'WORKER_UPDATE_REQUIRED'
    WHEN failure_code NOT IN ('RENDER_INPUT_INVALID','RENDER_OUTPUT_INVALID','RENDER_PROCESS_FAILED',
      'MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT','MEDIA_EXECUTION_IO_FAILED',
      'MEDIA_EXECUTION_TIMEOUT','MEDIA_EXECUTION_SUBPROCESS_FAILED','MEDIA_EXECUTION_FAILED')
      THEN 'FAILURE_NOT_RECOVERABLE'
    WHEN image_digest IS NULL OR image_digest !~ '^sha256:[0-9a-f]{64}$'
      OR execution_bundle_sha256 IS DISTINCT FROM image_digest
      OR attempt_count NOT BETWEEN 1 AND 4
      OR final_output_sha256 IS NOT NULL OR render_manifest_sha256 IS NULL
      OR result_content_length IS NOT NULL OR result_checksum_sha256 IS NOT NULL
      OR result_receipt_sha256 IS NOT NULL
      OR EXISTS (SELECT 1 FROM hosted_cpu_upload_authorities a WHERE a.attempt_id=failed_id AND a.issued_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM serverless_attempts a WHERE a.generation_request_id=candidate.id)
      OR NOT EXISTS (SELECT 1 FROM provider_workload_leases l WHERE l.generation_request_id=candidate.id
        AND l.state='RELEASED' AND l.release_reason='HOSTED_API_OUTPUTS_ACCEPTED')
      OR EXISTS (SELECT 1 FROM provider_workload_leases l WHERE l.generation_request_id=candidate.id AND l.state='ACTIVE')
      OR NOT EXISTS (SELECT 1 FROM hosted_render_plans p WHERE p.account_id=candidate.account_id
        AND p.workspace_id=candidate.workspace_id AND p.project_id=candidate.project_id
        AND p.project_revision_id=candidate.project_revision_id AND p.payload->>'kind'='RENDER'
        AND p.payload_sha256='sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb(p.payload),'UTF8')),'hex'))
      OR EXISTS (SELECT 1 FROM video_runtime_events e WHERE e.runtime_id=candidate.runtime_id AND e.reason='FINAL_OUTPUT_DURABLE')
      OR NOT public.videoforge_v209_api_outputs_accepted(account_id,workspace_id,id,runtime_id)
      THEN 'ACCEPTED_INPUTS_NOT_READY'
    ELSE 'ELIGIBLE' END AS reason
  FROM candidate
)
SELECT COALESCE((SELECT jsonb_build_object('eligible',reason='ELIGIBLE','reason',reason,
  'failed_attempt_id',failed_id,'attempt_limit',5,'provider_calls_authorized',false) FROM status),
  jsonb_build_object('eligible',false,'reason','NOT_FAILED','attempt_limit',5,'provider_calls_authorized',false));
$$;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_api_render_recovery_status(uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_read_hosted_api_render_recovery_status(uuid,uuid,uuid,uuid,text)
  TO videoforge_v209_runtime_dc9612d6;
