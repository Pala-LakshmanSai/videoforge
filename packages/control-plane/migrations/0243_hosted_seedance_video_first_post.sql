-- Operator-only first network POST after exact native evidence proves the former
-- fetch was rejected before network dispatch. Never a generalized UNKNOWN retry.
-- The immutable receipt is consumed before the external call: a lost response or
-- process exit burns this authority and can only be polled under the same UUID.
CREATE FUNCTION public.videoforge_authorize_hosted_video_first_post(
 a uuid,w uuid,g uuid,jid uuid,claim uuid,expected_input_sha256 text,evidence_sha256 text,
 reason text,remaining_budget_usd numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE j hosted_video_jobs%ROWTYPE; prior repository_mutation_receipts%ROWTYPE;
 receipt_key text:='seedance-first-post:'||jid::text; facts jsonb; facts_hash text; result jsonb; quote numeric;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'video first POST scope invalid' USING ERRCODE='42501'; END IF;
 IF reason IS DISTINCT FROM 'WORKER_FETCH_REJECTED_BEFORE_NETWORK' OR claim IS NULL
  OR expected_input_sha256 IS NULL OR expected_input_sha256 !~ '^sha256:[0-9a-f]{64}$'
  OR evidence_sha256 IS NULL OR evidence_sha256 !~ '^sha256:[0-9a-f]{64}$'
  OR remaining_budget_usd IS NULL OR remaining_budget_usd<=0 OR remaining_budget_usd>4
  OR remaining_budget_usd::text IN('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'video first POST authority invalid' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'video first POST request invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO j FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND id=jid AND claim_id=claim FOR UPDATE;
 IF j.id IS NULL OR j.input_sha256 IS DISTINCT FROM expected_input_sha256
  OR expected_input_sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(j.input_manifest),'UTF8')),'hex') THEN
  RAISE EXCEPTION 'video first POST identity invalid' USING ERRCODE='23514'; END IF;
 quote:=j.duration_seconds*0.01336;
 facts:=jsonb_build_object('account_id',a,'workspace_id',w,'generation_request_id',g,'job_id',jid,'claim_id',claim,
  'input_sha256',expected_input_sha256,'evidence_sha256',evidence_sha256,'reason',reason,
  'remaining_budget_usd',remaining_budget_usd,'quote_usd',quote);
 facts_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(facts),'UTF8')),'hex');
 SELECT * INTO prior FROM repository_mutation_receipts WHERE workspace_id=w AND idempotency_key=receipt_key;
 IF prior.workspace_id IS NOT NULL THEN
  IF prior.operation<>'authorize_hosted_video_first_post' OR prior.input_hash IS DISTINCT FROM facts_hash THEN
   RAISE EXCEPTION 'video first POST evidence replay drift' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('authorized',false,'job',public.videoforge_hosted_video_job_json(j),'receiptKey',receipt_key);
 END IF;
 IF j.state<>'UNKNOWN_NO_RETRY' OR j.provider_task_id IS NOT NULL OR coalesce(j.output_cost_usd,0)<>0
  OR j.output_sha256 IS NOT NULL OR j.output_asset_id IS NOT NULL OR j.output_receipt_id IS NOT NULL
  OR quote>remaining_budget_usd
  OR NOT EXISTS(SELECT 1 FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g AND state='ACTIVE')
  OR NOT EXISTS(SELECT 1 FROM provider_workload_leases WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND request_kind='VIDEO' AND state='ACTIVE' AND expires_at>transaction_timestamp())
  OR (SELECT count(*) FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND id<>jid AND state IN('SUBMITTING','SUBMITTED'))>=4
  OR EXISTS(SELECT 1 FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g
    AND (output_cost_usd>duration_seconds*0.01336*1.10 OR (id<>jid AND state IN('SUBMITTING','UNKNOWN_NO_RETRY','FAILED'))))
  OR EXISTS(SELECT 1 FROM hosted_api_generation_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND state IN('SUBMITTING','UNKNOWN_NO_RETRY','FAILED')) THEN
  RAISE EXCEPTION 'video first POST state lease or budget invalid' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM hosted_api_generation_jobs source
  JOIN assets asset ON asset.account_id=source.account_id AND asset.workspace_id=source.workspace_id AND asset.id=source.output_asset_id
  JOIN artifact_receipts receipt ON receipt.account_id=source.account_id AND receipt.workspace_id=source.workspace_id AND receipt.id=source.output_receipt_id
  WHERE source.account_id=a AND source.workspace_id=w AND source.generation_request_id=g AND source.id=j.source_api_job_id
   AND source.task_key=j.source_task_key AND source.lane='IMAGE' AND source.state='SUCCEEDED'
   AND source.output_asset_id=j.source_asset_id AND source.output_sha256=j.source_sha256
   AND asset.state='ACCEPTED' AND asset.binary_sha256=j.source_sha256 AND asset.object_key=source.output_object_key
   AND receipt.deleted_at IS NULL AND receipt.object_key=asset.object_key AND receipt.checksum_sha256=asset.binary_sha256
   AND receipt.content_length=asset.byte_size AND j.input_manifest->>'sourceImageObjectKey'=asset.object_key
   AND j.input_manifest->>'sourceImageAssetId'=asset.id::text AND j.input_manifest->>'sourceImageSha256'=asset.binary_sha256) THEN
  RAISE EXCEPTION 'video first POST accepted source invalid' USING ERRCODE='23514'; END IF;
 result:=facts||jsonb_build_object('authorized_at',transaction_timestamp(),'transition','UNKNOWN_NO_RETRY_TO_SUBMITTING');
 INSERT INTO repository_mutation_receipts(workspace_id,idempotency_key,operation,input_hash,result_codec,result_payload,result_hash)
 VALUES(w,receipt_key,'authorize_hosted_video_first_post',facts_hash,'repository-result/v1',result,
  'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(result),'UTF8')),'hex'));
 UPDATE hosted_video_jobs SET state='SUBMITTING',updated_at=transaction_timestamp() WHERE id=j.id RETURNING * INTO j;
 RETURN jsonb_build_object('authorized',true,'job',public.videoforge_hosted_video_job_json(j),'receiptKey',receipt_key);
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_authorize_hosted_video_first_post(uuid,uuid,uuid,uuid,uuid,text,text,text,numeric)
 FROM PUBLIC,videoforge_v209_runtime_dc9612d6,videoforge_v209_reconciler_dc9612d6;
