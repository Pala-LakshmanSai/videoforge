-- One final provider-free render attempt after the exact disk, I/O, and input-invalid failures.
-- All three attempts must have zero output, and the replacement worker bundle must differ.
CREATE TABLE public.hosted_api_render_input_recoveries (
  generation_request_id uuid PRIMARY KEY REFERENCES public.hosted_api_render_io_recoveries(generation_request_id),
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  runtime_id uuid NOT NULL,
  failed_attempt_id uuid NOT NULL,
  retry_attempt_id uuid NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('PREPARING','CONSUMED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id),
  FOREIGN KEY (account_id,workspace_id,runtime_id)
    REFERENCES public.video_runtime_states(account_id,workspace_id,id),
  FOREIGN KEY (account_id,workspace_id,failed_attempt_id)
    REFERENCES public.hosted_cpu_job_attempts(account_id,workspace_id,id)
);
ALTER TABLE public.hosted_api_render_input_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_api_render_input_recoveries FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_api_render_input_recoveries_tenant ON public.hosted_api_render_input_recoveries
  USING (account_id=public.videoforge_current_account_id())
  WITH CHECK (account_id=public.videoforge_current_account_id());
REVOKE ALL ON public.hosted_api_render_input_recoveries FROM PUBLIC;

-- Retain 0197/0198's terminal-state exceptions and add one transaction-local proof.
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.videoforge_validate_video_runtime_state()'::regprocedure)
    INTO definition;
  IF strpos(definition,$old$  IF OLD.stage IN ('COMPLETE', 'FAILED', 'CANCELED') THEN$old$)=0
     OR strpos(definition,'hosted_api_render_recoveries')=0
     OR strpos(definition,'hosted_api_render_io_recoveries')=0 THEN
    RAISE EXCEPTION 'render input recovery runtime trigger preimage drifted';
  END IF;
  definition:=replace(definition,
    $old$  IF OLD.stage IN ('COMPLETE', 'FAILED', 'CANCELED') THEN$old$,
    $new$  IF OLD.stage='FAILED' AND OLD.terminal_reason='RENDER_FAILURE'
     AND NEW.stage='RENDERING' AND NEW.terminal_reason IS NULL
     AND NEW.terminal_at IS NULL AND NEW.final_output_sha256 IS NULL
     AND NEW.render_manifest_sha256 IS NOT DISTINCT FROM OLD.render_manifest_sha256
     AND EXISTS (
       SELECT 1 FROM public.hosted_api_render_input_recoveries recovery
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

CREATE FUNCTION public.videoforge_prepare_hosted_api_render_input_recovery(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid,
  supplied_project_id uuid, supplied_failed_attempt_id uuid, supplied_retry_attempt_id uuid,
  supplied_replacement_bundle_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
DECLARE
  request public.generation_requests%ROWTYPE;
  runtime public.video_runtime_states%ROWTYPE;
  first_recovery public.hosted_api_render_recoveries%ROWTYPE;
  second_recovery public.hosted_api_render_io_recoveries%ROWTYPE;
  third_recovery public.hosted_api_render_input_recoveries%ROWTYPE;
  failed public.hosted_cpu_job_attempts%ROWTYPE;
  second_attempt public.hosted_cpu_job_attempts%ROWTYPE;
  original public.hosted_cpu_job_attempts%ROWTYPE;
  provider_lease public.provider_workload_leases%ROWTYPE;
  db_now timestamptz:=transaction_timestamp();
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_retry_attempt_id IS NULL THEN
    RAISE EXCEPTION 'render input recovery tenant or identity invalid' USING ERRCODE='42501';
  END IF;
  SELECT row.* INTO request FROM public.generation_requests row
    WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
      AND row.project_id=supplied_project_id
    ORDER BY row.created_at DESC,row.id DESC LIMIT 1 FOR UPDATE;
  IF request.id IS NULL THEN
    RAISE EXCEPTION 'render input recovery request missing' USING ERRCODE='23514';
  END IF;
  SELECT row.* INTO first_recovery FROM public.hosted_api_render_recoveries row
    WHERE row.generation_request_id=request.id FOR UPDATE;
  SELECT row.* INTO second_recovery FROM public.hosted_api_render_io_recoveries row
    WHERE row.generation_request_id=request.id FOR UPDATE;
  SELECT row.* INTO third_recovery FROM public.hosted_api_render_input_recoveries row
    WHERE row.generation_request_id=request.id FOR UPDATE;
  IF third_recovery.generation_request_id IS NOT NULL THEN
    IF third_recovery.failed_attempt_id<>supplied_failed_attempt_id
       OR third_recovery.state<>'CONSUMED' THEN
      RAISE EXCEPTION 'render input recovery identity drift' USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('schema_version','videoforge-hosted-render-disk-recovery/v1',
      'revision_id',third_recovery.project_revision_id,
      'retry_attempt_id',third_recovery.retry_attempt_id,
      'recovery_kind','INPUT','replayed',true);
  END IF;
  SELECT row.* INTO runtime FROM public.video_runtime_states row
    WHERE row.account_id=request.account_id AND row.workspace_id=request.workspace_id
      AND row.generation_request_id=request.id FOR UPDATE;
  SELECT row.* INTO failed FROM public.hosted_cpu_job_attempts row
    WHERE row.account_id=request.account_id AND row.workspace_id=request.workspace_id
      AND row.id=supplied_failed_attempt_id AND row.project_id=request.project_id
      AND row.project_revision_id=request.project_revision_id AND row.kind='RENDER' FOR UPDATE;
  SELECT row.* INTO second_attempt FROM public.hosted_cpu_job_attempts row
    WHERE row.account_id=request.account_id AND row.workspace_id=request.workspace_id
      AND row.id=second_recovery.failed_attempt_id AND row.project_id=request.project_id
      AND row.project_revision_id=request.project_revision_id AND row.kind='RENDER' FOR UPDATE;
  SELECT row.* INTO original FROM public.hosted_cpu_job_attempts row
    WHERE row.account_id=request.account_id AND row.workspace_id=request.workspace_id
      AND row.id=first_recovery.failed_attempt_id AND row.project_id=request.project_id
      AND row.project_revision_id=request.project_revision_id AND row.kind='RENDER' FOR UPDATE;
  SELECT row.* INTO provider_lease FROM public.provider_workload_leases row
    WHERE row.account_id=request.account_id AND row.workspace_id=request.workspace_id
      AND row.generation_request_id=request.id FOR UPDATE;
  IF first_recovery.generation_request_id IS NULL OR first_recovery.state<>'CONSUMED'
     OR first_recovery.account_id<>request.account_id
     OR first_recovery.workspace_id<>request.workspace_id
     OR first_recovery.project_id<>request.project_id
     OR first_recovery.project_revision_id<>request.project_revision_id
     OR first_recovery.runtime_id<>runtime.id
     OR second_recovery.generation_request_id IS NULL OR second_recovery.state<>'CONSUMED'
     OR second_recovery.account_id<>request.account_id
     OR second_recovery.workspace_id<>request.workspace_id
     OR second_recovery.project_id<>request.project_id
     OR second_recovery.project_revision_id<>request.project_revision_id
     OR second_recovery.runtime_id<>runtime.id
     OR second_recovery.failed_attempt_id<>first_recovery.retry_attempt_id
     OR second_recovery.retry_attempt_id<>supplied_failed_attempt_id
     OR NOT EXISTS (SELECT 1 FROM public.projects project
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
     OR supplied_replacement_bundle_sha256 IS NULL
     OR supplied_replacement_bundle_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_replacement_bundle_sha256=failed.image_digest
     OR second_attempt.id IS NULL OR second_attempt.state<>'FAILED'
     OR second_attempt.terminal_at IS NULL
     OR second_attempt.result_content_length IS NOT NULL
     OR second_attempt.result_checksum_sha256 IS NOT NULL
     OR second_attempt.result_receipt_sha256 IS NOT NULL
     OR original.id IS NULL OR original.state<>'FAILED' OR original.terminal_at IS NULL
     OR original.result_content_length IS NOT NULL OR original.result_checksum_sha256 IS NOT NULL
     OR original.result_receipt_sha256 IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.hosted_cpu_upload_authorities authority
       WHERE authority.account_id=request.account_id AND authority.workspace_id=request.workspace_id
         AND authority.attempt_id IN (failed.id,second_attempt.id,original.id)
         AND authority.issued_at IS NOT NULL)
     OR (SELECT count(*) FROM public.hosted_cpu_job_attempts job
       WHERE job.account_id=request.account_id AND job.workspace_id=request.workspace_id
         AND job.project_revision_id=request.project_revision_id AND job.kind='RENDER')<>3
     OR NOT EXISTS (SELECT 1 FROM public.media_worker_leases lease
       WHERE lease.account_id=failed.account_id AND lease.workspace_id=failed.workspace_id
         AND lease.attempt_id=failed.id AND lease.state='FAILED'
         AND lease.failure_code='RENDER_INPUT_INVALID')
     OR NOT EXISTS (SELECT 1 FROM public.media_worker_leases lease
       WHERE lease.account_id=second_attempt.account_id
         AND lease.workspace_id=second_attempt.workspace_id
         AND lease.attempt_id=second_attempt.id AND lease.state='FAILED'
         AND lease.failure_code='MEDIA_EXECUTION_IO_FAILED')
     OR NOT EXISTS (SELECT 1 FROM public.media_worker_leases lease
       WHERE lease.account_id=original.account_id AND lease.workspace_id=original.workspace_id
         AND lease.attempt_id=original.id AND lease.state='FAILED'
         AND lease.failure_code='MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT')
     OR EXISTS (SELECT 1 FROM public.media_worker_leases lease
       WHERE lease.attempt_id IN (failed.id,second_attempt.id,original.id)
         AND lease.state IN ('CLAIMED','RUNNING','COMPLETING'))
     OR provider_lease.id IS NULL OR provider_lease.state<>'RELEASED'
     OR provider_lease.release_reason<>'HOSTED_API_OUTPUTS_ACCEPTED'
     OR EXISTS (SELECT 1 FROM public.provider_workload_leases active_lease
       WHERE active_lease.account_id=request.account_id
         AND active_lease.workspace_id=request.workspace_id
         AND active_lease.generation_request_id=request.id AND active_lease.state='ACTIVE')
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
    RAISE EXCEPTION 'render input recovery evidence rejected' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.hosted_api_render_input_recoveries(
    generation_request_id,account_id,workspace_id,project_id,project_revision_id,
    runtime_id,failed_attempt_id,retry_attempt_id,state)
  VALUES(request.id,request.account_id,request.workspace_id,request.project_id,
    request.project_revision_id,runtime.id,failed.id,supplied_retry_attempt_id,'PREPARING');
  UPDATE public.generation_requests
    SET state='ACTIVE',terminal_at=NULL,version=version+1,updated_at=db_now
    WHERE id=request.id AND state='FAILED';
  UPDATE public.video_runtime_states
    SET stage='RENDERING',terminal_reason=NULL,terminal_at=NULL,
        version=version+1,updated_at=db_now
    WHERE id=runtime.id AND stage='FAILED';
  UPDATE public.hosted_api_render_input_recoveries SET state='CONSUMED'
    WHERE generation_request_id=request.id AND state='PREPARING';
  INSERT INTO public.video_runtime_events(
    id,account_id,workspace_id,runtime_id,project_revision_id,lane,
    from_state,to_state,reason,detail,occurred_at)
  VALUES(md5('hosted-api-render-input-recovery:'||request.id::text)::uuid,
    request.account_id,request.workspace_id,runtime.id,request.project_revision_id,NULL,
    'FAILED','RENDERING','LOCAL_RENDER_INPUT_RECOVERY',
    jsonb_build_object('failed_attempt_id',failed.id,'retry_attempt_id',supplied_retry_attempt_id,
      'replacement_bundle_sha256',supplied_replacement_bundle_sha256,
      'provider_actions_created',false),db_now);
  RETURN jsonb_build_object('schema_version','videoforge-hosted-render-disk-recovery/v1',
    'revision_id',request.project_revision_id,'retry_attempt_id',supplied_retry_attempt_id,
    'recovery_kind','INPUT','replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_prepare_hosted_api_render_input_recovery(
  uuid,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;

-- The seven-argument route entry point keeps the first two recovery capabilities unchanged.
CREATE FUNCTION public.videoforge_prepare_hosted_api_render_recovery(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid,
  supplied_project_id uuid, supplied_failed_attempt_id uuid, supplied_retry_attempt_id uuid,
  supplied_replacement_bundle_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.hosted_api_render_io_recoveries recovery
    WHERE recovery.account_id=supplied_account_id
      AND recovery.workspace_id=supplied_workspace_id
      AND recovery.project_id=supplied_project_id
      AND recovery.retry_attempt_id=supplied_failed_attempt_id) THEN
    RETURN public.videoforge_prepare_hosted_api_render_input_recovery(
      supplied_account_id,supplied_workspace_id,supplied_user_id,
      supplied_project_id,supplied_failed_attempt_id,supplied_retry_attempt_id,
      supplied_replacement_bundle_sha256);
  END IF;
  RETURN public.videoforge_prepare_hosted_api_render_recovery(
    supplied_account_id,supplied_workspace_id,supplied_user_id,
    supplied_project_id,supplied_failed_attempt_id,supplied_retry_attempt_id);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_prepare_hosted_api_render_recovery(
  uuid,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_prepare_hosted_api_render_recovery(
  uuid,uuid,uuid,uuid,uuid,uuid,text) TO videoforge_v209_runtime_dc9612d6;
