-- Operator-only closure after archived exact-UUID lookup and same-organization
-- provider history prove no task/charge exists. A missing poll response alone is insufficient.
-- Persist evidence identity; keep ordinary request settlement and lease release separate.
CREATE FUNCTION public.videoforge_reconcile_hosted_video_unknown_no_task(
 a uuid,w uuid,g uuid,jid uuid,claim uuid,expected_state text,reason text,evidence_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE j hosted_video_jobs%ROWTYPE; prior repository_mutation_receipts%ROWTYPE;
 receipt_key text:='seedance-no-task:'||jid::text; facts jsonb; facts_hash text; result jsonb;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'video reconciliation scope invalid' USING ERRCODE='42501'; END IF;
 IF expected_state IS DISTINCT FROM 'UNKNOWN_NO_RETRY' OR reason IS DISTINCT FROM 'RUNWARE_ARCHIVE_CONFIRMED_NO_TASK'
  OR evidence_sha256 IS NULL OR evidence_sha256 !~ '^sha256:[0-9a-f]{64}$' OR claim IS NULL THEN
  RAISE EXCEPTION 'video unknown reconciliation authority invalid' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'video unknown reconciliation identity invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO j FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND id=jid AND claim_id=claim FOR UPDATE;
 IF j.id IS NULL OR j.provider_task_id IS NOT NULL OR coalesce(j.output_cost_usd,0)<>0 THEN
  RAISE EXCEPTION 'video unknown reconciliation identity or cost invalid' USING ERRCODE='23514'; END IF;
 facts:=jsonb_build_object('account_id',a,'workspace_id',w,'generation_request_id',g,'job_id',jid,'claim_id',claim,
  'expected_state',expected_state,'reason',reason,'evidence_sha256',evidence_sha256);
 facts_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(facts),'UTF8')),'hex');
 SELECT * INTO prior FROM repository_mutation_receipts WHERE workspace_id=w AND idempotency_key=receipt_key;
 IF prior.workspace_id IS NOT NULL THEN
  IF prior.operation<>'reconcile_hosted_video_unknown_no_task' OR prior.input_hash IS DISTINCT FROM facts_hash
   OR j.state<>'FAILED' OR j.failure_code IS DISTINCT FROM reason THEN
   RAISE EXCEPTION 'video unknown reconciliation replay drift' USING ERRCODE='23505'; END IF;
  RETURN public.videoforge_hosted_video_job_json(j);
 END IF;
 IF j.state IS DISTINCT FROM expected_state THEN RAISE EXCEPTION 'video unknown reconciliation state invalid' USING ERRCODE='23514'; END IF;
 UPDATE hosted_video_jobs SET state='FAILED',failure_code=reason,completed_at=transaction_timestamp(),updated_at=transaction_timestamp()
  WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND id=jid AND claim_id=claim
   AND state=expected_state AND provider_task_id IS NULL AND coalesce(output_cost_usd,0)=0 RETURNING * INTO j;
 IF NOT FOUND THEN RAISE EXCEPTION 'video unknown reconciliation lost state race' USING ERRCODE='40001'; END IF;
 result:=facts||jsonb_build_object('state',j.state,'completed_at',j.completed_at);
 INSERT INTO repository_mutation_receipts(workspace_id,idempotency_key,operation,input_hash,result_codec,result_payload,result_hash)
 VALUES(w,receipt_key,'reconcile_hosted_video_unknown_no_task',facts_hash,'repository-result/v1',result,
  'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(result),'UTF8')),'hex'));
 RETURN public.videoforge_hosted_video_job_json(j);
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_reconcile_hosted_video_unknown_no_task(uuid,uuid,uuid,uuid,uuid,text,text,text)
 FROM PUBLIC,videoforge_v209_runtime_dc9612d6,videoforge_v209_reconciler_dc9612d6;
