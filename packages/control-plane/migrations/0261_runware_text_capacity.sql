-- Runware publishes no hard text concurrency limit. Keep model-specific cooldowns only.
INSERT INTO public.provider_api_policies(provider,max_inflight,min_start_interval_ms) VALUES
 ('RUNWARE_TEXT:google:gemini@3.5-flash',NULL,0),
 ('RUNWARE_TEXT:deepseek:v4@flash',NULL,0),
 ('RUNWARE_TEXT:google:gemma@4-31b',NULL,0),
 ('RUNWARE_TEXT:google:gemini@3.1-flash-lite',NULL,0);
ALTER FUNCTION public.videoforge_provider_api_waiter_eligible(text,uuid,uuid)
 RENAME TO videoforge_provider_api_waiter_eligible_media;
CREATE FUNCTION public.videoforge_provider_api_waiter_eligible(k text,a uuid,j uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT CASE k
 WHEN 'PROMPT' THEN EXISTS(SELECT 1 FROM hosted_prompt_runs WHERE id=j AND account_id=a
   AND state IN('DISPATCHING','UNKNOWN') AND acceptance_fingerprint_hash IS NULL
   AND NOT EXISTS(SELECT 1 FROM repository_mutation_receipts m WHERE m.workspace_id=hosted_prompt_runs.workspace_id
     AND m.operation='hosted_prompt_capacity_rejected' AND m.result_payload->>'run_id'=j::text))
 WHEN 'CONTEXT' THEN EXISTS(SELECT 1 FROM projects WHERE id=j AND account_id=a AND status='ACTIVE'
   AND NOT EXISTS(SELECT 1 FROM hosted_voiceover_contexts c WHERE c.project_id=j AND c.account_id=a
     AND c.project_revision_id=(SELECT id FROM project_revisions WHERE project_id=j AND account_id=a
       ORDER BY revision_number DESC,id DESC LIMIT 1) AND c.state IN('DISPATCHING','SUCCEEDED')))
 WHEN 'STYLE' THEN EXISTS(SELECT 1 FROM image_style_versions v JOIN image_styles s ON s.id=v.style_id
   WHERE v.id=j AND v.account_id=a AND v.state='DRAFT' AND s.status='ACTIVE')
 ELSE public.videoforge_provider_api_waiter_eligible_media(k,a,j) END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_provider_api_waiter_eligible(text,uuid,uuid) FROM PUBLIC;
-- Narrow runtime entrypoint; provider identity cannot be supplied by an ordinary browser.
CREATE FUNCTION public.videoforge_acquire_runware_text(model text,kind text,job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF (kind='CONTEXT' AND model='google:gemma@4-31b') OR
    (kind='STYLE' AND model='google:gemini@3.1-flash-lite') THEN
   RETURN public.videoforge_try_acquire_provider_api('RUNWARE_TEXT:'||model,public.videoforge_current_account_id(),kind,job);
 END IF;
 RAISE EXCEPTION 'Runware text gate identity invalid' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION public.videoforge_acquire_runware_text(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_acquire_runware_text(text,text,uuid) TO videoforge_v209_runtime_dc9612d6;
DO $gate$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_claim_next_hosted_prompt_batch(uuid,integer,text,text,text)'::regprocedure) INTO definition;
 marker:='  PERFORM public.videoforge_reopen_saved_hosted_prompt_prefix(run.id);';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'prompt capacity next claim preimage drift'; END IF;
 EXECUTE replace(definition,marker,'  IF NOT (public.videoforge_try_acquire_provider_api(''RUNWARE_TEXT:''||(supplied_request_bytes::jsonb#>>''{0,model}''),run.account_id,''PROMPT'',run.id)->>''acquired'')::boolean THEN RETURN false; END IF;'||chr(10)||marker);
 SELECT pg_get_functiondef('public.videoforge_replace_invalid_hosted_prompt_batch(uuid,integer,text,text,bigint,text,text)'::regprocedure) INTO definition;
 marker:='  INSERT INTO public.hosted_prompt_batch_replacements(';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'prompt capacity replacement preimage drift'; END IF;
 EXECUTE replace(definition,marker,'  IF NOT (public.videoforge_try_acquire_provider_api(''RUNWARE_TEXT:''||(supplied_request_bytes::jsonb#>>''{0,model}''),run.account_id,''PROMPT'',run.id)->>''acquired'')::boolean THEN RETURN false; END IF;'||chr(10)||marker);
END $gate$;

-- Preserve exact rejected identity. This never deletes claims or grants replacement authority.
CREATE FUNCTION public.videoforge_pause_hosted_prompt_capacity(r uuid,t text,response_hash text,retry_ms integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE run hosted_prompt_runs%ROWTYPE; c hosted_prompt_batch_claims%ROWTYPE; request_bytes text; claim_uuid uuid;
BEGIN
 SELECT * INTO run FROM hosted_prompt_runs WHERE id=r FOR UPDATE;
 IF run.id IS NULL OR run.account_id IS DISTINCT FROM public.videoforge_current_account_id()
   OR run.state NOT IN('DISPATCHING','UNKNOWN') OR response_hash !~ '^sha256:[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'prompt capacity pause scope invalid' USING ERRCODE='23514'; END IF;
 SELECT original.* INTO c FROM hosted_prompt_batch_claims original WHERE original.run_id=r
  AND (original.provider_task_uuid=t OR EXISTS(SELECT 1 FROM hosted_prompt_batch_replacements b
    WHERE b.claim_id=original.id AND b.provider_task_uuid=t));
 IF EXISTS(SELECT 1 FROM repository_mutation_receipts WHERE workspace_id=run.workspace_id
   AND idempotency_key='hosted-prompt-capacity:'||t AND input_hash=response_hash) THEN RETURN; END IF;
 IF c.id IS NULL OR EXISTS(SELECT 1 FROM hosted_prompt_batch_progress WHERE claim_id=c.id) THEN
   RAISE EXCEPTION 'prompt capacity pause claim invalid' USING ERRCODE='23514'; END IF;
 SELECT coalesce(b.request_bytes,c.request_bytes),coalesce(b.provider_task_uuid,c.provider_task_uuid)::uuid
 INTO request_bytes,claim_uuid FROM (SELECT 1) seed LEFT JOIN hosted_prompt_batch_replacements b ON b.claim_id=c.id AND b.provider_task_uuid=t;
 PERFORM public.videoforge_defer_provider_api('RUNWARE_TEXT:'||(request_bytes::jsonb#>>'{0,model}'),run.account_id,'PROMPT',r,claim_uuid,retry_ms);
 INSERT INTO repository_mutation_receipts(workspace_id,idempotency_key,operation,input_hash,result_codec,result_payload,result_hash)
 VALUES(run.workspace_id,'hosted-prompt-capacity:'||t,'hosted_prompt_capacity_rejected',response_hash,'repository-result/v1',
  jsonb_build_object('run_id',r,'task_uuid',t,'response_hash',response_hash),
  'sha256:'||encode(digest(convert_to(jsonb_build_object('run_id',r,'task_uuid',t,'response_hash',response_hash)::text,'UTF8'),'sha256'),'hex'))
 ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.videoforge_pause_hosted_prompt_capacity(uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_pause_hosted_prompt_capacity(uuid,text,text,integer) TO videoforge_v209_runtime_dc9612d6;

CREATE FUNCTION public.videoforge_record_runware_text_capacity(k text,j uuid,c uuid,h text,response_hash text,retry_ms integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE a uuid:=public.videoforge_current_account_id(); model text;
BEGIN
 IF response_hash IS NULL OR response_hash !~ '^sha256:[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Runware capacity response invalid' USING ERRCODE='23514'; END IF;
 IF k='CONTEXT' THEN
  PERFORM 1 FROM hosted_voiceover_contexts WHERE project_id=j AND account_id=a AND attempt_id=c
   AND request_hash=h AND state='DISPATCHING' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Runware context capacity claim invalid' USING ERRCODE='23514'; END IF;
  model:='google:gemma@4-31b';
 ELSIF k='STYLE' THEN
  PERFORM 1 FROM hosted_style_analysis_runs WHERE style_version_id=j AND account_id=a AND id=c
   AND request_hash=h AND state='RESERVED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Runware style capacity claim invalid' USING ERRCODE='23514'; END IF;
  model:='google:gemini@3.1-flash-lite';
 ELSE RAISE EXCEPTION 'Runware capacity kind invalid' USING ERRCODE='23514'; END IF;
 PERFORM public.videoforge_defer_provider_api('RUNWARE_TEXT:'||model,a,k,j,c,retry_ms);
END $$;
REVOKE ALL ON FUNCTION public.videoforge_record_runware_text_capacity(text,uuid,uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_record_runware_text_capacity(text,uuid,uuid,text,text,integer) TO videoforge_v209_runtime_dc9612d6;
