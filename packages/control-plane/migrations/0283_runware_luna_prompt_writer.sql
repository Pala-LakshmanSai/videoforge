-- Add a future-only Runware-hosted Luna profile. Existing profile revisions, requests, claims,
-- provider receipts, cost reports, and recovery evidence remain unchanged.
INSERT INTO public.provider_api_policies(provider,max_inflight,min_start_interval_ms)
VALUES ('RUNWARE_TEXT:openai:gpt@6-luna',NULL,0)
ON CONFLICT (provider) DO NOTHING;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.provider_api_policies
    WHERE provider='RUNWARE_TEXT:openai:gpt@6-luna'
      AND max_inflight IS NULL AND min_start_interval_ms=0) THEN
    RAISE EXCEPTION 'Runware Luna text capacity policy drifted';
  END IF;
END;
$$;

-- Resolve a new policy to immutable profile revision 8. Old callers without request_policy retain
-- the exact legacy revision-7 configuration; approved redispatches reuse the run's original profile.
DO $$
DECLARE definition text; old_text text; new_text text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_prepare_hosted_prompt_run(jsonb)'::regprocedure);
  old_text:=$old$  profile_id uuid;$old$;
  new_text:=$new$  profile_id uuid;
  request_policy text:=supplied->>'request_policy';
  profile_name text:='Hosted Runware scene prompts';$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Runware Luna prepare declarations drifted'; END IF;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$  planned_batch_count:=(supplied->>'planned_batch_count')::integer;$old$;
  new_text:=$new$  IF request_policy IS NOT NULL AND request_policy IS DISTINCT FROM 'runware-luna-grounded-v1' THEN
    RAISE EXCEPTION 'hosted prompt request policy is invalid' USING ERRCODE='23514';
  END IF;
  IF request_policy='runware-luna-grounded-v1' THEN
    profile_name:='Hosted Runware GPT-6 Luna scene prompts';
    profile_config:='{"model":"openai:gpt@6-luna","operation":"scene-prompt-writer-v2","provider":"runware","reasoning_effort":"low","request_policy":"runware-luna-grounded-v1","request_version":"runware-gpt-6-luna-prompt-request-v38","transport":"runware_openai_chat_completions","pricing":{"input_micro_usd_per_million":100000,"cached_input_micro_usd_per_million":10000,"cache_write_micro_usd_per_million":125000,"output_micro_usd_per_million":500000}}'::jsonb;
    profile_config_hash:='sha256:'||encode(digest(convert_to(profile_config::text,'UTF8'),'sha256'),'hex');
  END IF;
  planned_batch_count:=(supplied->>'planned_batch_count')::integer;$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Runware Luna request policy boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$  IF existing.id IS NOT NULL AND redispatch THEN
    SELECT CASE WHEN profile.revision=7 THEN 7 ELSE 6 END
      INTO profile_revision
      FROM public.execution_profiles profile
     WHERE profile.id=existing.execution_profile_id
       AND profile.account_id=account_id AND profile.workspace_id=workspace_id;
    IF profile_revision IS NULL THEN
      RAISE EXCEPTION 'hosted prompt execution profile drifted' USING ERRCODE='23514';
    END IF;
    profile_rate:=CASE WHEN profile_revision=7 THEN 8000000 ELSE 2000000 END;
  ELSE
    profile_revision:=7;
    profile_rate:=8000000;
  END IF;$old$;
  new_text:=$new$  IF existing.id IS NOT NULL AND redispatch THEN
    SELECT profile.revision,profile.name,profile.configuration,profile.configuration_hash,
           profile.maximum_rate_micro_usd
      INTO profile_revision,profile_name,profile_config,profile_config_hash,profile_rate
      FROM public.execution_profiles profile
     WHERE profile.id=existing.execution_profile_id
       AND profile.account_id=account_id AND profile.workspace_id=workspace_id
       AND profile.dispatch_target='RUNWARE';
    IF profile_revision IS NULL OR profile_revision NOT IN (6,7,8) THEN
      RAISE EXCEPTION 'hosted prompt execution profile drifted' USING ERRCODE='23514';
    END IF;
    IF profile_revision=8 AND (profile_name<>'Hosted Runware GPT-6 Luna scene prompts'
       OR profile_config IS DISTINCT FROM '{"model":"openai:gpt@6-luna","operation":"scene-prompt-writer-v2","provider":"runware","reasoning_effort":"low","request_policy":"runware-luna-grounded-v1","request_version":"runware-gpt-6-luna-prompt-request-v38","transport":"runware_openai_chat_completions","pricing":{"input_micro_usd_per_million":100000,"cached_input_micro_usd_per_million":10000,"cache_write_micro_usd_per_million":125000,"output_micro_usd_per_million":500000}}'::jsonb
       OR profile_rate<>8000000 OR request_policy IS DISTINCT FROM 'runware-luna-grounded-v1') THEN
      RAISE EXCEPTION 'hosted prompt execution profile drifted' USING ERRCODE='23514';
    END IF;
    IF profile_revision IN (6,7) AND request_policy='runware-luna-grounded-v1' THEN
      RAISE EXCEPTION 'hosted prompt redispatch policy differs from pinned profile' USING ERRCODE='23514';
    END IF;
  ELSE
    profile_revision:=CASE WHEN request_policy='runware-luna-grounded-v1' THEN 8 ELSE 7 END;
    profile_rate:=8000000;
  END IF;$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Runware Luna profile selection boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$'Hosted Runware scene prompts',profile_revision,'PROMPT'$old$;
  new_text:=$new$profile_name,profile_revision,'PROMPT'$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Runware Luna profile insert identity drifted'; END IF;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$profile.name='Hosted Runware scene prompts' AND profile.revision=profile_revision$old$;
  new_text:=$new$profile.name=profile_name AND profile.revision=profile_revision$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Runware Luna profile lookup boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);
  definition:=replace(definition,'''google:gemini@3.5-flash''','(profile_config->>''model'')');
  EXECUTE definition;

  definition:=pg_get_functiondef('public.videoforge_record_hosted_prompt_response(uuid,text,text,jsonb)'::regprocedure);
  old_text:=$old$  receipt_key:='hosted-prompt-response:'||supplied_provider_task_uuid;$old$;
  new_text:=$new$  IF EXISTS (SELECT 1 FROM public.execution_profiles profile
       WHERE profile.id=run.execution_profile_id AND profile.revision=8
         AND profile.name='Hosted Runware GPT-6 Luna scene prompts'
         AND profile.dispatch_target='RUNWARE') THEN
    IF supplied_result->>'costBasis' IS DISTINCT FROM 'PINNED_RATE_ESTIMATE'
       OR coalesce(supplied_result->>'estimatedCostMicroUsd','') !~ '^(0|[1-9][0-9]*)$'
       OR (supplied_result->>'estimatedCostMicroUsd')::numeric NOT BETWEEN 0 AND 250000
       OR (supplied_result->>'costUsd')::numeric*1000000::numeric IS DISTINCT FROM
          (supplied_result->>'estimatedCostMicroUsd')::numeric
       OR coalesce(supplied_result->>'responseId','') !~ '^chatcmpl-[A-Za-z0-9_-]{1,240}$'
       OR coalesce(supplied_result->>'wireHash','') !~ '^sha256:[0-9a-f]{64}$'
       OR supplied_result->>'providerModel' IS DISTINCT FROM 'openai:gpt@6-luna'
       OR coalesce(supplied_result->'usage'->>'cacheWriteTokens','0') !~ '^[0-9]+$'
       OR coalesce(supplied_result->'usage'->>'reasoningTokens','0') !~ '^[0-9]+$'
       OR coalesce(supplied_result->'usage'->>'totalTokens','') !~ '^(0|[1-9][0-9]*)$'
       OR (supplied_result->'usage'->>'totalTokens')::numeric IS DISTINCT FROM
          (supplied_result->'usage'->>'inputTokens')::numeric+
          (supplied_result->'usage'->>'outputTokens')::numeric
       OR (supplied_result->'usage'->>'inputTokens')::numeric>48000
       OR (supplied_result->'usage'->>'outputTokens')::numeric>6144
       OR (supplied_result->'usage'->>'cachedInputTokens')::numeric+
          coalesce((supplied_result->'usage'->>'cacheWriteTokens')::numeric,0)>
          (supplied_result->'usage'->>'inputTokens')::numeric
       OR coalesce((supplied_result->'usage'->>'reasoningTokens')::numeric,0)>
          (supplied_result->'usage'->>'outputTokens')::numeric THEN
      RAISE EXCEPTION 'Runware Luna prompt result identity or usage is invalid' USING ERRCODE='23514';
    END IF;
    IF ceil(((greatest(0,(supplied_result->'usage'->>'inputTokens')::numeric-
           (supplied_result->'usage'->>'cachedInputTokens')::numeric-
           coalesce((supplied_result->'usage'->>'cacheWriteTokens')::numeric,0))*100::numeric)+
           ((supplied_result->'usage'->>'cachedInputTokens')::numeric*10::numeric)+
           (coalesce((supplied_result->'usage'->>'cacheWriteTokens')::numeric,0)*125::numeric)+
           ((supplied_result->'usage'->>'outputTokens')::numeric*500::numeric))/1000::numeric)
       IS DISTINCT FROM (supplied_result->>'estimatedCostMicroUsd')::numeric THEN
      RAISE EXCEPTION 'Runware Luna prompt estimate differs from pinned rates' USING ERRCODE='23514';
    END IF;
  END IF;
  receipt_key:='hosted-prompt-response:'||supplied_provider_task_uuid;$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Runware Luna result receipt boundary drifted'; END IF;
  EXECUTE replace(definition,old_text,new_text);

  definition:=pg_get_functiondef('public.videoforge_claim_hosted_prompt_batch(uuid,integer,text,text,text)'::regprocedure);
  old_text:=$old$  SELECT count(*)::integer INTO prior_batch_count$old$;
  new_text:=$new$  IF EXISTS (SELECT 1 FROM public.execution_profiles profile
       WHERE profile.id=run.execution_profile_id AND profile.revision=8
         AND profile.name='Hosted Runware GPT-6 Luna scene prompts'
         AND profile.dispatch_target='RUNWARE') THEN
    IF supplied_request_bytes::jsonb#>>'{0,model}' IS DISTINCT FROM 'openai:gpt@6-luna' THEN
      RAISE EXCEPTION 'hosted prompt request model differs from pinned profile' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT count(*)::integer INTO prior_batch_count$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Runware Luna claim model boundary drifted'; END IF;
  EXECUTE replace(definition,old_text,new_text);

  definition:=pg_get_functiondef('public.videoforge_replace_invalid_hosted_prompt_batch(uuid,integer,text,text,bigint,text,text)'::regprocedure);
  old_text:=$old$  original:=claim_row.request_bytes::jsonb;$old$;
  new_text:=$new$  IF EXISTS (SELECT 1 FROM public.execution_profiles profile
       WHERE profile.id=run.execution_profile_id AND profile.revision=8
         AND profile.name='Hosted Runware GPT-6 Luna scene prompts'
         AND profile.dispatch_target='RUNWARE')
     AND supplied_request_bytes::jsonb#>>'{0,model}' IS DISTINCT FROM 'openai:gpt@6-luna' THEN
    RAISE EXCEPTION 'hosted prompt replacement model differs from pinned profile' USING ERRCODE='23514';
  END IF;
  original:=claim_row.request_bytes::jsonb;$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Runware Luna replacement model boundary drifted'; END IF;
  EXECUTE replace(definition,old_text,new_text);
END;
$$;

-- The Luna writer reports a single explicit literal-budget diagnostic. Permit it only for
-- this immutable revision-8 profile; keep every historical correction reason unchanged.
DO $$
DECLARE definition text; old_text text; new_text text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_hosted_prompt_scene_correction_matches(jsonb,jsonb,text,uuid,uuid,text,text,bigint)'::regprocedure);
  old_text:=$old$coalesce(failure->>'reason','') NOT IN ('hard_conflict','required_fact_invalid','explicit_negation_conflict','global_topic_substitution','depiction_transfer')$old$;
  new_text:=$new$NOT (
       coalesce(failure->>'reason','') IN ('hard_conflict','required_fact_invalid','explicit_negation_conflict','global_topic_substitution','depiction_transfer')
       OR (failure->>'field'='scene' AND failure->>'reason'='literal_character_limit'
         AND EXISTS (SELECT 1 FROM public.hosted_prompt_runs correction_run
           JOIN public.execution_profiles correction_profile
             ON correction_profile.id=correction_run.execution_profile_id
           WHERE correction_run.id=supplied_run_id
             AND correction_run.account_id=public.videoforge_current_account_id()
             AND correction_profile.revision=8
             AND correction_profile.name='Hosted Runware GPT-6 Luna scene prompts'
             AND correction_profile.dispatch_target='RUNWARE')))$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Luna literal-budget correction boundary drifted'; END IF;
  EXECUTE replace(definition,old_text,new_text);
END;
$$;

-- Rates are a local estimate, not an invoice. Label only future cost events for the new profile.
CREATE FUNCTION public.videoforge_label_runware_luna_prompt_estimate()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
  IF NEW.event_type IN ('REPORTED','SETTLED','RELEASED') AND EXISTS (
    SELECT 1 FROM public.hosted_prompt_runs run
    JOIN public.execution_profiles profile ON profile.id=run.execution_profile_id
    WHERE run.account_id=NEW.account_id AND run.workspace_id=NEW.workspace_id
      AND run.task_id=NEW.task_id AND run.attempt_id=NEW.attempt_id
      AND profile.revision=8 AND profile.name='Hosted Runware GPT-6 Luna scene prompts'
      AND profile.dispatch_target='RUNWARE'
  ) THEN
    NEW.details:=coalesce(NEW.details,'{}'::jsonb)||jsonb_build_object(
      'provider','RUNWARE','cost_basis','PINNED_RATE_ESTIMATE',
      'rate_version','runware-air-gpt-6-luna-standard-2026-10-06','invoice_verified',false);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cost_events_runware_luna_prompt_estimate
  BEFORE INSERT ON public.cost_events FOR EACH ROW
  EXECUTE FUNCTION public.videoforge_label_runware_luna_prompt_estimate();
