-- Fresh Luna runs use a separate immutable profile/request contract. Existing v38/profile-8
-- requests and claims remain available for byte-exact recovery.
DO $$
DECLARE definition text; old_text text; new_text text; target regprocedure;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_prepare_hosted_prompt_run(jsonb)'::regprocedure);
  old_text:=$old$IF request_policy IS NOT NULL AND request_policy IS DISTINCT FROM 'runware-luna-grounded-v1' THEN$old$;
  new_text:=$new$IF request_policy IS NOT NULL AND request_policy NOT IN ('runware-luna-grounded-v1','runware-luna-grounded-v2') THEN$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Luna v2 request policy boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$    profile_config_hash:='sha256:'||encode(digest(convert_to(profile_config::text,'UTF8'),'sha256'),'hex');
  END IF;$old$;
  new_text:=$new$    profile_config_hash:='sha256:'||encode(digest(convert_to(profile_config::text,'UTF8'),'sha256'),'hex');
  ELSIF request_policy='runware-luna-grounded-v2' THEN
    profile_name:='Hosted Runware GPT-6 Luna scene prompts';
    profile_config:='{"model":"openai:gpt@6-luna","operation":"scene-prompt-writer-v2","provider":"runware","reasoning_effort":"low","request_policy":"runware-luna-grounded-v2","request_version":"runware-gpt-6-luna-prompt-request-v39","transport":"runware_openai_chat_completions","pricing":{"input_micro_usd_per_million":100000,"cached_input_micro_usd_per_million":10000,"cache_write_micro_usd_per_million":125000,"output_micro_usd_per_million":500000}}'::jsonb;
    profile_config_hash:='sha256:'||encode(digest(convert_to(profile_config::text,'UTF8'),'sha256'),'hex');
  END IF;$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Luna v2 profile config boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$IF profile_revision IS NULL OR profile_revision NOT IN (6,7,8) THEN$old$;
  new_text:=$new$IF profile_revision IS NULL OR profile_revision NOT IN (6,7,8,9) THEN$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Luna v2 redispatch profile boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$    IF profile_revision IN (6,7) AND request_policy='runware-luna-grounded-v1' THEN$old$;
  new_text:=$new$    IF profile_revision=9 AND (profile_name<>'Hosted Runware GPT-6 Luna scene prompts'
       OR profile_config IS DISTINCT FROM '{"model":"openai:gpt@6-luna","operation":"scene-prompt-writer-v2","provider":"runware","reasoning_effort":"low","request_policy":"runware-luna-grounded-v2","request_version":"runware-gpt-6-luna-prompt-request-v39","transport":"runware_openai_chat_completions","pricing":{"input_micro_usd_per_million":100000,"cached_input_micro_usd_per_million":10000,"cache_write_micro_usd_per_million":125000,"output_micro_usd_per_million":500000}}'::jsonb
       OR profile_rate<>8000000 OR request_policy IS DISTINCT FROM 'runware-luna-grounded-v2') THEN
      RAISE EXCEPTION 'hosted prompt execution profile drifted' USING ERRCODE='23514';
    END IF;
    IF profile_revision IN (6,7) AND request_policy IN ('runware-luna-grounded-v1','runware-luna-grounded-v2') THEN$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Luna v2 redispatch policy boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$profile_revision:=CASE WHEN request_policy='runware-luna-grounded-v1' THEN 8 ELSE 7 END;$old$;
  new_text:=$new$profile_revision:=CASE request_policy
      WHEN 'runware-luna-grounded-v1' THEN 8
      WHEN 'runware-luna-grounded-v2' THEN 9
      ELSE 7 END;$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Luna v2 fresh profile selection boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);
  EXECUTE definition;

  -- The immutable receipt, claim, replacement, scene-correction and cost-label checks apply to
  -- both pinned Luna revisions. The configuration is validated at run preparation above.
  FOREACH target IN ARRAY ARRAY[
    'public.videoforge_record_hosted_prompt_response(uuid,text,text,jsonb)'::regprocedure,
    'public.videoforge_claim_hosted_prompt_batch(uuid,integer,text,text,text)'::regprocedure,
    'public.videoforge_replace_invalid_hosted_prompt_batch(uuid,integer,text,text,bigint,text,text)'::regprocedure,
    'public.videoforge_hosted_prompt_scene_correction_matches(jsonb,jsonb,text,uuid,uuid,text,text,bigint)'::regprocedure
  ] LOOP
    definition:=pg_get_functiondef(target);
    definition:=replace(definition,'profile.revision=8','profile.revision IN (8,9)');
    definition:=replace(definition,'correction_profile.revision=8','correction_profile.revision IN (8,9)');
    EXECUTE definition;
  END LOOP;

  definition:=pg_get_functiondef('public.videoforge_label_runware_luna_prompt_estimate()'::regprocedure);
  old_text:='profile.revision=8'; new_text:='profile.revision IN (8,9)';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'Luna v2 cost-label boundary drifted'; END IF;
  EXECUTE replace(definition,old_text,new_text);
END;
$$;
