-- Future prompt runs gain separate immutable compact scene instructions. No saved profile,
-- prompt, claim, receipt, request or QA policy is changed; model/call/token budgets remain pinned.
DO $$
DECLARE definition text; old_text text; new_text text; target regprocedure;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_prepare_hosted_prompt_run(jsonb)'::regprocedure);
  old_text:=$old$request_policy NOT IN ('runware-luna-grounded-v1','runware-luna-grounded-v2','runware-luna-grounded-v3')$old$;
  new_text:=$new$request_policy NOT IN ('runware-luna-grounded-v1','runware-luna-grounded-v2','runware-luna-grounded-v3','runware-luna-grounded-v4')$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Luna v4 request policy boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$    profile_config_hash:='sha256:'||encode(digest(convert_to(profile_config::text,'UTF8'),'sha256'),'hex');
  END IF;$old$;
  new_text:=$new$    profile_config_hash:='sha256:'||encode(digest(convert_to(profile_config::text,'UTF8'),'sha256'),'hex');
  ELSIF request_policy='runware-luna-grounded-v4' THEN
    profile_name:='Hosted Runware GPT-6 Luna scene prompts';
    profile_config:='{"model":"openai:gpt@6-luna","operation":"scene-prompt-writer-v2","provider":"runware","reasoning_effort":"low","request_policy":"runware-luna-grounded-v4","request_version":"runware-gpt-6-luna-prompt-request-v41","transport":"runware_openai_chat_completions","pricing":{"input_micro_usd_per_million":100000,"cached_input_micro_usd_per_million":10000,"cache_write_micro_usd_per_million":125000,"output_micro_usd_per_million":500000}}'::jsonb;
    profile_config_hash:='sha256:'||encode(digest(convert_to(profile_config::text,'UTF8'),'sha256'),'hex');
  END IF;$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Luna v4 profile config boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$profile_revision NOT IN (6,7,8,9,10)$old$;
  new_text:=$new$profile_revision NOT IN (6,7,8,9,10,11)$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Luna v4 redispatch profile boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$    IF profile_revision IN (6,7) AND request_policy IN ('runware-luna-grounded-v1','runware-luna-grounded-v2','runware-luna-grounded-v3') THEN$old$;
  new_text:=$new$    IF profile_revision=11 AND (profile_name<>'Hosted Runware GPT-6 Luna scene prompts'
       OR profile_config IS DISTINCT FROM '{"model":"openai:gpt@6-luna","operation":"scene-prompt-writer-v2","provider":"runware","reasoning_effort":"low","request_policy":"runware-luna-grounded-v4","request_version":"runware-gpt-6-luna-prompt-request-v41","transport":"runware_openai_chat_completions","pricing":{"input_micro_usd_per_million":100000,"cached_input_micro_usd_per_million":10000,"cache_write_micro_usd_per_million":125000,"output_micro_usd_per_million":500000}}'::jsonb
       OR profile_rate<>8000000 OR request_policy IS DISTINCT FROM 'runware-luna-grounded-v4') THEN
      RAISE EXCEPTION 'hosted prompt execution profile drifted' USING ERRCODE='23514';
    END IF;
    IF profile_revision IN (6,7) AND request_policy IN ('runware-luna-grounded-v1','runware-luna-grounded-v2','runware-luna-grounded-v3','runware-luna-grounded-v4') THEN$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Luna v4 redispatch policy boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$WHEN 'runware-luna-grounded-v3' THEN 10$old$;
  new_text:=$new$WHEN 'runware-luna-grounded-v3' THEN 10
      WHEN 'runware-luna-grounded-v4' THEN 11$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Luna v4 fresh profile selection boundary drifted'; END IF;
  EXECUTE replace(definition,old_text,new_text);

  FOREACH target IN ARRAY ARRAY[
    'public.videoforge_record_hosted_prompt_response(uuid,text,text,jsonb)'::regprocedure,
    'public.videoforge_claim_hosted_prompt_batch(uuid,integer,text,text,text)'::regprocedure,
    'public.videoforge_replace_invalid_hosted_prompt_batch(uuid,integer,text,text,bigint,text,text)'::regprocedure,
    'public.videoforge_hosted_prompt_scene_correction_matches(jsonb,jsonb,text,uuid,uuid,text,text,bigint)'::regprocedure,
    'public.videoforge_label_runware_luna_prompt_estimate()'::regprocedure
  ] LOOP
    definition:=pg_get_functiondef(target);
    old_text:='profile.revision IN (8,9,10)'; new_text:='profile.revision IN (8,9,10,11)';
    IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Luna v4 receipt boundary drifted: %',target; END IF;
    EXECUTE replace(definition,old_text,new_text);
  END LOOP;
END;
$$;
