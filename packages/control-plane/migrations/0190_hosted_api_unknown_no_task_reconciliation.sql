-- Operator-only closure for a Fal submission whose account history confirms no task exists.
-- Keep the provider lease active until the ordinary request settlement function runs separately.
CREATE FUNCTION public.videoforge_reconcile_hosted_api_unknown_no_task(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_generation_request_id uuid,
  supplied_generation_task_id uuid,
  supplied_job_id uuid,
  supplied_claim_id uuid,
  supplied_expected_state text,
  supplied_reason_code text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_api_generation_jobs%ROWTYPE;
BEGIN
  IF supplied_expected_state IS DISTINCT FROM 'UNKNOWN_NO_RETRY'
     OR supplied_reason_code IS DISTINCT FROM 'FAL_HISTORY_CONFIRMED_NO_TASK' THEN
    RAISE EXCEPTION 'API unknown reconciliation authority invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO job FROM public.hosted_api_generation_jobs j
    WHERE j.account_id=supplied_account_id AND j.workspace_id=supplied_workspace_id
      AND j.generation_request_id=supplied_generation_request_id
      AND j.generation_task_id=supplied_generation_task_id AND j.id=supplied_job_id
      AND j.claim_id=supplied_claim_id AND j.lane='AVATAR'
      AND j.state=supplied_expected_state AND j.provider_task_id IS NULL
    FOR UPDATE;
  IF job.id IS NULL THEN
    RAISE EXCEPTION 'API unknown reconciliation identity invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.hosted_api_generation_jobs SET state='FAILED',
    failure_code=supplied_reason_code,completed_at=transaction_timestamp(),
    updated_at=transaction_timestamp()
    WHERE id=job.id AND account_id=supplied_account_id AND workspace_id=supplied_workspace_id
      AND generation_request_id=supplied_generation_request_id
      AND generation_task_id=supplied_generation_task_id AND claim_id=supplied_claim_id
      AND state=supplied_expected_state AND provider_task_id IS NULL
    RETURNING * INTO job;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'API unknown reconciliation lost state race' USING ERRCODE='40001';
  END IF;
  RETURN public.videoforge_hosted_api_job_json(job);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_reconcile_hosted_api_unknown_no_task(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,videoforge_v209_runtime_dc9612d6;
