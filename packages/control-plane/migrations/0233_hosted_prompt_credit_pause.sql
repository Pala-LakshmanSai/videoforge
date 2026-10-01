-- A credit check never creates a provider claim or changes the existing cost reservation.
CREATE FUNCTION public.videoforge_pause_hosted_prompt_for_credits(supplied_run_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE run public.hosted_prompt_runs%ROWTYPE;
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;
  IF run.id IS NULL OR run.account_id IS DISTINCT FROM public.videoforge_current_account_id()
     OR run.state NOT IN ('DISPATCHING','UNKNOWN') OR run.acceptance_fingerprint_hash IS NOT NULL THEN
    RAISE EXCEPTION 'prompt credit pause state is invalid' USING ERRCODE='23514';
  END IF;
  IF run.state='DISPATCHING' THEN
    PERFORM public.videoforge_fail_hosted_prompt_run(run.id,'UNKNOWN','HOSTED_PROMPT_PROVIDER_CREDITS_LOW',true,0);
  ELSE
    IF run.problem_code IS NULL OR run.problem_code NOT IN ('HOSTED_PROMPT_DISPATCH_TIMEOUT','HOSTED_PROMPT_EXECUTION_UNKNOWN','HOSTED_PROMPT_PROVIDER_CREDITS_LOW')
       OR (run.problem_code<>'HOSTED_PROMPT_PROVIDER_CREDITS_LOW' AND NOT EXISTS
         (SELECT 1 FROM public.hosted_prompt_batch_claims WHERE run_id=run.id)) THEN
      RAISE EXCEPTION 'prompt credit pause evidence is invalid' USING ERRCODE='23514';
    END IF;
    UPDATE public.hosted_prompt_runs SET problem_code='HOSTED_PROMPT_PROVIDER_CREDITS_LOW' WHERE id=run.id;
    UPDATE public.attempts SET problem_code='HOSTED_PROMPT_PROVIDER_CREDITS_LOW'
      WHERE id=run.attempt_id AND account_id=run.account_id AND workspace_id=run.workspace_id
        AND task_id=run.task_id AND state='UNKNOWN';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_pause_hosted_prompt_for_credits(uuid) FROM PUBLIC;

-- Credit pauses pass through the existing exact-identity recovery and bounded replacement gates.
DO $$
DECLARE definition text; signature text; old_text text; principal record;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.videoforge_reopen_complete_hosted_prompt_run(uuid)',
    'public.videoforge_reopen_saved_hosted_prompt_prefix(uuid)',
    'public.videoforge_recover_hosted_prompt_batch(uuid,text,jsonb)',
    'public.videoforge_adjudicate_invalid_hosted_prompt_batch(uuid,text,text,bigint)',
    'public.videoforge_replace_invalid_hosted_prompt_batch(uuid,integer,text,text,bigint,text,text)'] LOOP
    definition:=pg_get_functiondef(signature::regprocedure);
    old_text:='(''HOSTED_PROMPT_DISPATCH_TIMEOUT'',''HOSTED_PROMPT_EXECUTION_UNKNOWN'')';
    IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt recovery credit boundary drifted: %',signature; END IF;
    definition:=replace(definition,old_text,'(''HOSTED_PROMPT_DISPATCH_TIMEOUT'',''HOSTED_PROMPT_EXECUTION_UNKNOWN'',''HOSTED_PROMPT_PROVIDER_CREDITS_LOW'')');
    IF signature LIKE '%reopen_saved%' THEN
      old_text:='IF batch_count<1 OR';
      IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt empty prefix boundary drifted'; END IF;
      -- A pause before the first claim has no provider ambiguity. All existing claim, ledger,
      -- tenant, and contiguous-prefix checks still apply, including claim_count=batch_count=0.
      definition:=replace(definition,old_text,
        'IF (batch_count<1 AND run.problem_code<>''HOSTED_PROMPT_PROVIDER_CREDITS_LOW'') OR');
      old_text:='OR run.reported_cost_micro_usd IS DISTINCT FROM batch_cost+run.discarded_cost_micro_usd';
      IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt empty prefix cost boundary drifted'; END IF;
      definition:=replace(definition,old_text,
        'OR (run.reported_cost_micro_usd IS DISTINCT FROM batch_cost+run.discarded_cost_micro_usd AND NOT
          (batch_count=0 AND batch_cost=0 AND run.discarded_cost_micro_usd=0 AND run.reported_cost_micro_usd IS NULL
            AND run.problem_code=''HOSTED_PROMPT_PROVIDER_CREDITS_LOW''))');
    END IF;
    EXECUTE definition;
  END LOOP;
  FOR principal IN SELECT DISTINCT pg_get_userbyid(acl.grantee) AS role_name
    FROM pg_proc proc CROSS JOIN LATERAL aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl
    WHERE proc.oid='public.videoforge_fail_hosted_prompt_run(uuid,text,text,boolean,bigint)'::regprocedure
      AND acl.privilege_type='EXECUTE' AND acl.grantee<>0 AND acl.grantee<>proc.proowner
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.videoforge_pause_hosted_prompt_for_credits(uuid) TO %I',principal.role_name);
  END LOOP;
END;
$$;
