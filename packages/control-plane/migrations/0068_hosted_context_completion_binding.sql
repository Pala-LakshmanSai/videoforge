-- The original Stage 3 completion function used output_asset_id, context_hash, and response_hash
-- as both PL/pgSQL variable names and table column names. PostgreSQL rejects those references as
-- ambiguous only when a valid provider result reaches durable acceptance. Use explicit input names
-- so a schema-valid context can be committed atomically.

CREATE OR REPLACE FUNCTION public.videoforge_complete_hosted_voiceover_context(supplied jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  target public.hosted_voiceover_contexts%ROWTYPE;
  supplied_context_bytes text:=supplied->>'context_bytes';
  supplied_response_bytes text:=supplied->>'response_bytes';
  supplied_context_hash text:=supplied->>'context_hash';
  supplied_response_hash text:=supplied->>'response_hash';
  supplied_reported_cost bigint:=(supplied->>'reported_cost_micro_usd')::bigint;
  supplied_output_asset_id uuid:=(supplied->>'output_asset_id')::uuid;
  now_at timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO target FROM public.hosted_voiceover_contexts context
   WHERE context.id=(supplied->>'context_id')::uuid FOR UPDATE;
  IF target.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM target.account_id
     OR target.state<>'DISPATCHING'
     OR supplied_reported_cost NOT BETWEEN 0 AND target.reserved_cost_micro_usd
     OR supplied_context_hash IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(supplied_context_bytes,'UTF8'),'sha256'),'hex')
     OR supplied_response_hash IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(supplied_response_bytes,'UTF8'),'sha256'),'hex')
     OR supplied_context_bytes::jsonb IS NULL
     OR jsonb_typeof(supplied_context_bytes::jsonb)<>'object' THEN
    RAISE EXCEPTION 'hosted voiceover context acceptance is invalid' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.assets(id,account_id,workspace_id,project_id,project_revision_id,kind,state,
    canonical_contract_name,canonical_contract_version,canonical_document_sha256,content_type,
    byte_size,metadata,verified_at,created_at)
  VALUES(supplied_output_asset_id,target.account_id,target.workspace_id,target.project_id,
    target.project_revision_id,'CANONICAL_DOCUMENT','ACCEPTED','voiceover-story-context','v1',
    supplied_context_hash,'application/json',octet_length(supplied_context_bytes),
    jsonb_build_object('source','hosted-voiceover-context'),now_at,now_at);
  INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
    sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at,created_at)
  VALUES(gen_random_uuid(),target.account_id,target.workspace_id,'PROJECT_REVISION',
    target.project_revision_id,target.task_id,target.attempt_id,
    target.reservation_cost_sequence+1,'REPORTED',supplied_reported_cost,
    'hosted-voiceover-context:'||target.project_revision_id||':reported',
    jsonb_build_object('context_hash',supplied_context_hash),now_at,now_at),
    (gen_random_uuid(),target.account_id,target.workspace_id,'PROJECT_REVISION',
    target.project_revision_id,target.task_id,target.attempt_id,
    target.reservation_cost_sequence+2,'SETTLED',supplied_reported_cost,
    'hosted-voiceover-context:'||target.project_revision_id||':settled',
    jsonb_build_object('context_hash',supplied_context_hash),now_at,now_at);
  UPDATE public.attempts SET state='SUCCEEDED',output_asset_id=supplied_output_asset_id,
    result_disposition='ACCEPTED',finished_at=now_at WHERE workspace_id=target.workspace_id
    AND task_id=target.task_id AND id=target.attempt_id;
  UPDATE public.generation_tasks SET state='COMPLETE',accepted_attempt_id=target.attempt_id,
    version=version+1,finished_at=now_at,updated_at=now_at
    WHERE workspace_id=target.workspace_id AND id=target.task_id;
  UPDATE public.hosted_voiceover_contexts SET state='SUCCEEDED',
    context_document=supplied_context_bytes::jsonb,
    context_hash=supplied_context_hash,response_hash=supplied_response_hash,
    reported_cost_micro_usd=supplied_reported_cost,finished_at=now_at WHERE id=target.id;
  RETURN true;
END;
$$;
