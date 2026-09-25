-- Recover only an archived result for the exact uncertain prompt batch claim.
-- The caller validates getTaskDetails and compiles the output before this transaction.
-- Reopening and recording are one operation: no caller can reopen an UNKNOWN run alone.
CREATE FUNCTION public.videoforge_recover_hosted_prompt_batch(
  supplied_run_id uuid,
  supplied_provider_task_uuid text,
  supplied jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
#variable_conflict use_variable
DECLARE
  run public.hosted_prompt_runs%ROWTYPE;
  claim_row public.hosted_prompt_batch_claims%ROWTYPE;
  batch_ordinal_text text:=supplied->>'batch_ordinal';
  batch_ordinal integer;
  prior_batch_count integer;
  changed integer;
  now_at timestamptz:=clock_timestamp();
BEGIN
  IF batch_ordinal_text IS NULL OR batch_ordinal_text !~ '^(0|[1-9][0-9]*)$'
     OR batch_ordinal_text::numeric>2147483647 THEN
    RAISE EXCEPTION 'hosted prompt recovery identity is invalid' USING ERRCODE='23514';
  END IF;
  batch_ordinal:=batch_ordinal_text::integer;
  SELECT * INTO run FROM public.hosted_prompt_runs
   WHERE id=supplied_run_id FOR UPDATE;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id
     OR run.state<>'UNKNOWN' OR run.provider_may_have_charged IS NOT TRUE
     OR run.problem_code NOT IN ('HOSTED_PROMPT_DISPATCH_TIMEOUT','HOSTED_PROMPT_EXECUTION_UNKNOWN')
     OR run.acceptance_fingerprint_hash IS NOT NULL
     OR batch_ordinal>=run.planned_batch_count THEN
    RAISE EXCEPTION 'hosted prompt recovery state is invalid' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::integer INTO prior_batch_count
    FROM public.hosted_prompt_batch_progress progress
   WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
     AND progress.run_id=run.id;
  SELECT * INTO claim_row FROM public.hosted_prompt_batch_claims claim
   WHERE claim.account_id=run.account_id AND claim.workspace_id=run.workspace_id
     AND claim.run_id=run.id AND claim.task_id=run.task_id
     AND claim.attempt_id=run.attempt_id AND claim.outbox_id=run.outbox_id
     AND claim.batch_ordinal=batch_ordinal
   FOR UPDATE;
  IF prior_batch_count<>batch_ordinal OR claim_row.id IS NULL
     OR claim_row.provider_task_uuid IS DISTINCT FROM supplied_provider_task_uuid
     OR claim_row.request_bytes IS DISTINCT FROM supplied->>'request_bytes'
     OR claim_row.request_hash IS DISTINCT FROM supplied->>'request_hash'
     OR EXISTS (SELECT 1 FROM public.hosted_prompt_batch_progress progress
       WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
         AND progress.run_id=run.id AND progress.batch_ordinal=batch_ordinal) THEN
    RAISE EXCEPTION 'hosted prompt recovery claim is invalid' USING ERRCODE='23514';
  END IF;

  UPDATE public.attempts
     SET state='RUNNING',dispatch_state='RECONCILED',problem_code=NULL,finished_at=NULL
   WHERE workspace_id=run.workspace_id AND task_id=run.task_id AND id=run.attempt_id
     AND state='UNKNOWN' AND dispatch_state='AMBIGUOUS'
     AND claim_state='CLAIMED' AND problem_code=run.problem_code;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed<>1 THEN
    RAISE EXCEPTION 'hosted prompt recovery attempt is invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.generation_tasks
     SET state='RUNNING',version=version+1,finished_at=NULL,updated_at=now_at
   WHERE workspace_id=run.workspace_id AND id=run.task_id
     AND project_revision_id=run.project_revision_id AND state='FAILED';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed<>1 THEN
    RAISE EXCEPTION 'hosted prompt recovery task is invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.hosted_prompt_runs
     SET state='DISPATCHING',problem_code=NULL,provider_may_have_charged=false,finished_at=NULL
   WHERE id=run.id;
  PERFORM public.videoforge_record_hosted_prompt_batch(run.id,supplied);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_recover_hosted_prompt_batch(uuid,text,jsonb) FROM PUBLIC;
