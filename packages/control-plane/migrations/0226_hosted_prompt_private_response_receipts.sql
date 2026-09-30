-- Preserve the exact returned prompt result before validating/compiling it. The provider archive
-- redacts long strings, so it cannot serve as the only recovery copy. No inference authority here.
CREATE FUNCTION public.videoforge_record_hosted_prompt_response(
  supplied_run_id uuid, supplied_provider_task_uuid text, supplied_request_hash text,
  supplied_result jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
DECLARE
  run public.hosted_prompt_runs%ROWTYPE;
  claim_row public.hosted_prompt_batch_claims%ROWTYPE;
  effective_uuid text;
  effective_hash text;
  receipt public.repository_mutation_receipts%ROWTYPE;
  evidence jsonb;
  receipt_key text;
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id
     OR supplied_result IS NULL OR jsonb_typeof(supplied_result) IS DISTINCT FROM 'object'
     OR octet_length(supplied_result::text)>1048576
     OR supplied_result->>'status' IS DISTINCT FROM 'succeeded'
     OR jsonb_typeof(supplied_result->'outputText') IS DISTINCT FROM 'string'
     OR jsonb_typeof(supplied_result->'usage') IS DISTINCT FROM 'object'
     OR jsonb_typeof(supplied_result->'costUsd') IS DISTINCT FROM 'number'
     OR (supplied_result->>'costUsd')::numeric NOT BETWEEN 0 AND 0.25
     OR jsonb_typeof(supplied_result->'finishReason') IS DISTINCT FROM 'string'
     OR jsonb_typeof(supplied_result->'latencyMs') IS DISTINCT FROM 'number'
     OR (supplied_result->>'latencyMs')::numeric<0
     OR coalesce(supplied_result->'usage'->>'inputTokens','') !~ '^[0-9]+$'
     OR coalesce(supplied_result->'usage'->>'outputTokens','') !~ '^[0-9]+$'
     OR coalesce(supplied_result->'usage'->>'totalTokens','') !~ '^[0-9]+$'
     OR coalesce(supplied_result->'usage'->>'cachedInputTokens','') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'hosted prompt response identity or shape is invalid' USING ERRCODE='23514';
  END IF;
  SELECT c.* INTO claim_row FROM public.hosted_prompt_batch_claims c
   WHERE c.run_id=run.id AND c.account_id=run.account_id AND c.workspace_id=run.workspace_id
     AND c.task_id=run.task_id AND c.attempt_id=run.attempt_id AND c.outbox_id=run.outbox_id
     AND (c.provider_task_uuid=supplied_provider_task_uuid OR EXISTS (
       SELECT 1 FROM public.hosted_prompt_batch_replacements b WHERE b.claim_id=c.id
        AND b.provider_task_uuid=supplied_provider_task_uuid));
  SELECT coalesce(b.provider_task_uuid,claim_row.provider_task_uuid),
         coalesce(b.request_hash,claim_row.request_hash) INTO effective_uuid,effective_hash
    FROM (SELECT 1) seed LEFT JOIN public.hosted_prompt_batch_replacements b ON b.claim_id=claim_row.id;
  IF claim_row.id IS NULL OR effective_uuid IS DISTINCT FROM supplied_provider_task_uuid
     OR effective_hash IS DISTINCT FROM supplied_request_hash THEN
    RAISE EXCEPTION 'hosted prompt response claim is invalid' USING ERRCODE='23514';
  END IF;
  receipt_key:='hosted-prompt-response:'||supplied_provider_task_uuid;
  evidence:=jsonb_build_object('run_id',run.id,'claim_id',claim_row.id,
    'provider_task_uuid',supplied_provider_task_uuid,'request_hash',supplied_request_hash,
    'result',supplied_result);
  SELECT * INTO receipt FROM public.repository_mutation_receipts
   WHERE workspace_id=run.workspace_id AND idempotency_key=receipt_key;
  IF receipt.idempotency_key IS NOT NULL THEN
    IF receipt.operation='hosted_prompt_response' AND receipt.input_hash=supplied_request_hash
       AND receipt.result_payload=evidence THEN RETURN false; END IF;
    RAISE EXCEPTION 'hosted prompt response evidence drifted' USING ERRCODE='23514';
  END IF;
  IF run.state NOT IN ('DISPATCHING','UNKNOWN') OR run.acceptance_fingerprint_hash IS NOT NULL THEN
    RAISE EXCEPTION 'hosted prompt response state is invalid' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.repository_mutation_receipts(workspace_id,idempotency_key,operation,
    input_hash,result_codec,result_payload,result_hash)
  VALUES(run.workspace_id,receipt_key,'hosted_prompt_response',supplied_request_hash,
    'repository-result/v1',evidence,
    'sha256:'||encode(digest(convert_to(evidence::text,'UTF8'),'sha256'),'hex'));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_record_hosted_prompt_response(uuid,text,text,jsonb) FROM PUBLIC;

CREATE FUNCTION public.videoforge_load_hosted_prompt_response(
  supplied_run_id uuid, supplied_provider_task_uuid text, supplied_request_hash text
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
  SELECT receipt.result_payload->'result'
    FROM public.hosted_prompt_runs run JOIN public.repository_mutation_receipts receipt
      ON receipt.workspace_id=run.workspace_id
   WHERE run.id=supplied_run_id AND run.account_id=public.videoforge_current_account_id()
     AND receipt.operation='hosted_prompt_response'
     AND receipt.idempotency_key='hosted-prompt-response:'||supplied_provider_task_uuid
     AND receipt.input_hash=supplied_request_hash
     AND receipt.result_payload->>'run_id'=run.id::text
     AND receipt.result_payload->>'provider_task_uuid'=supplied_provider_task_uuid;
$$;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_prompt_response(uuid,text,text) FROM PUBLIC;
