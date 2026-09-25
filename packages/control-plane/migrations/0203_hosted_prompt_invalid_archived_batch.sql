-- An archived provider task answered, but its output failed strict prompt validation.
-- Resolve only the exact claimed task; preserve accepted batches and the immutable claim.
-- This is a terminal cost settlement, never authority for another provider POST.
-- 0071's failure path still had the original 40,000 micro-USD single-batch ceiling,
-- although 0182/0183 raised the real batch acceptance bound. Keep its settlement logic.
DO $$
DECLARE
  definition text:=pg_get_functiondef('public.videoforge_fail_hosted_prompt_run(uuid,text,text,boolean,bigint)'::regprocedure);
  old_guard text:='supplied_additional_known_cost_micro_usd NOT BETWEEN 0 AND 40000';
BEGIN
  IF position(old_guard IN definition)=0 THEN
    RAISE EXCEPTION 'hosted prompt failure cost guard has drifted' USING ERRCODE='23514';
  END IF;
  EXECUTE replace(definition,old_guard,
    'supplied_additional_known_cost_micro_usd NOT BETWEEN 0 AND 250000');
END;
$$;

CREATE FUNCTION public.videoforge_adjudicate_invalid_hosted_prompt_batch(
  supplied_run_id uuid,
  supplied_provider_task_uuid text,
  supplied_response_hash text,
  supplied_known_cost_micro_usd bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
#variable_conflict use_variable
DECLARE
  run public.hosted_prompt_runs%ROWTYPE;
  claim_row public.hosted_prompt_batch_claims%ROWTYPE;
  receipt public.repository_mutation_receipts%ROWTYPE;
  prior_batch_count integer;
  prior_cost bigint;
  receipt_key text;
  evidence jsonb;
  changed integer;
  now_at timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id
     OR supplied_response_hash IS NULL OR supplied_response_hash !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_known_cost_micro_usd IS NULL
     OR supplied_known_cost_micro_usd NOT BETWEEN 0 AND 250000 THEN
    RAISE EXCEPTION 'hosted prompt invalid output identity is invalid' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::integer,coalesce(sum(progress.reported_cost_micro_usd),0)::bigint
    INTO prior_batch_count,prior_cost
    FROM public.hosted_prompt_batch_progress progress
   WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
     AND progress.run_id=run.id;
  SELECT * INTO claim_row FROM public.hosted_prompt_batch_claims claim
   WHERE claim.account_id=run.account_id AND claim.workspace_id=run.workspace_id
     AND claim.run_id=run.id AND claim.task_id=run.task_id
     AND claim.attempt_id=run.attempt_id AND claim.outbox_id=run.outbox_id
     AND claim.batch_ordinal=prior_batch_count FOR UPDATE;
  IF claim_row.id IS NULL
     OR claim_row.provider_task_uuid IS DISTINCT FROM supplied_provider_task_uuid
     OR prior_batch_count>=run.planned_batch_count
     OR prior_cost+supplied_known_cost_micro_usd>run.reserved_cost_micro_usd
     OR EXISTS (SELECT 1 FROM public.hosted_prompt_batch_progress progress
       WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
         AND progress.run_id=run.id AND progress.batch_ordinal=prior_batch_count) THEN
    RAISE EXCEPTION 'hosted prompt invalid output claim is invalid' USING ERRCODE='23514';
  END IF;
  receipt_key:='hosted-prompt-invalid:'||claim_row.id;
  evidence:=jsonb_build_object(
    'run_id',run.id,'claim_id',claim_row.id,'provider_task_uuid',claim_row.provider_task_uuid,
    'batch_ordinal',claim_row.batch_ordinal,'request_hash',claim_row.request_hash,
    'response_hash',supplied_response_hash,
    'known_cost_micro_usd',supplied_known_cost_micro_usd
  );
  SELECT * INTO receipt FROM public.repository_mutation_receipts
   WHERE workspace_id=run.workspace_id AND idempotency_key=receipt_key FOR UPDATE;
  IF receipt.idempotency_key IS NOT NULL THEN
    IF receipt.operation='hosted_prompt_invalid_batch'
       AND receipt.input_hash=supplied_response_hash
       AND receipt.result_payload=evidence
       AND run.state='FAILED' AND run.problem_code='HOSTED_PROMPT_OUTPUT_INVALID'
       AND run.reported_cost_micro_usd=prior_cost+supplied_known_cost_micro_usd THEN
      RETURN false;
    END IF;
    RAISE EXCEPTION 'hosted prompt invalid output evidence drifted' USING ERRCODE='23514';
  END IF;
  IF run.state<>'UNKNOWN' OR run.provider_may_have_charged IS NOT TRUE
     OR run.problem_code NOT IN ('HOSTED_PROMPT_DISPATCH_TIMEOUT','HOSTED_PROMPT_EXECUTION_UNKNOWN')
     OR run.acceptance_fingerprint_hash IS NOT NULL THEN
    RAISE EXCEPTION 'hosted prompt invalid output state is invalid' USING ERRCODE='23514';
  END IF;

  INSERT INTO public.repository_mutation_receipts(
    workspace_id,idempotency_key,operation,input_hash,result_codec,result_payload,result_hash
  ) VALUES (
    run.workspace_id,receipt_key,'hosted_prompt_invalid_batch',supplied_response_hash,
    'repository-result/v1',evidence,
    'sha256:'||encode(digest(convert_to(evidence::text,'UTF8'),'sha256'),'hex')
  );
  UPDATE public.attempts
     SET state='RUNNING',dispatch_state='RECONCILED',problem_code=NULL,finished_at=NULL
   WHERE workspace_id=run.workspace_id AND task_id=run.task_id AND id=run.attempt_id
     AND state='UNKNOWN' AND dispatch_state='AMBIGUOUS'
     AND claim_state='CLAIMED' AND problem_code=run.problem_code;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed<>1 THEN
    RAISE EXCEPTION 'hosted prompt invalid output attempt is invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.generation_tasks
     SET state='RUNNING',version=version+1,finished_at=NULL,updated_at=now_at
   WHERE workspace_id=run.workspace_id AND id=run.task_id
     AND project_revision_id=run.project_revision_id AND state='FAILED';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed<>1 THEN
    RAISE EXCEPTION 'hosted prompt invalid output task is invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.hosted_prompt_runs
     SET state='DISPATCHING',problem_code=NULL,provider_may_have_charged=false,finished_at=NULL
   WHERE id=run.id;
  PERFORM public.videoforge_fail_hosted_prompt_run(
    run.id,'FAILED','HOSTED_PROMPT_OUTPUT_INVALID',false,supplied_known_cost_micro_usd
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_adjudicate_invalid_hosted_prompt_batch(uuid,text,text,bigint) FROM PUBLIC;
