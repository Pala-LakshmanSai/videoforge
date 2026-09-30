-- Concurrent continuation readers may finish the same exact result. Repeated acceptance is
-- idempotent; evidence drift is still rejected by the existing acceptance function.
CREATE FUNCTION public.videoforge_hosted_prompt_batch_matches_saved(supplied_run_id uuid,supplied jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hosted_prompt_runs run JOIN public.hosted_prompt_batch_progress p ON p.run_id=run.id
     WHERE run.id=supplied_run_id AND run.account_id=public.videoforge_current_account_id()
       AND p.account_id=run.account_id AND p.workspace_id=run.workspace_id
       AND p.batch_ordinal::text=supplied->>'batch_ordinal'
       AND p.first_scene_ordinal::text=supplied->>'first_scene_ordinal'
       AND p.request_bytes=supplied->>'request_bytes' AND p.request_hash=supplied->>'request_hash'
       AND p.response_bytes=supplied->>'response_bytes' AND p.response_hash=supplied->>'response_hash'
       AND p.input_tokens::text=supplied->>'input_tokens' AND p.output_tokens::text=supplied->>'output_tokens'
       AND p.reported_cost_micro_usd::text=supplied->>'reported_cost_micro_usd'
       AND supplied->'scenes'=(SELECT jsonb_agg(jsonb_build_object('scene_ordinal',s.scene_ordinal,
         'scene_id',s.scene_id,'writer_output',s.writer_output,'compiled_prompt',s.compiled_prompt) ORDER BY s.scene_ordinal)
         FROM public.hosted_prompt_scene_progress s WHERE s.run_id=run.id AND s.batch_progress_id=p.id
           AND s.account_id=run.account_id AND s.workspace_id=run.workspace_id)
  );
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_prompt_batch_matches_saved(uuid,jsonb) FROM PUBLIC;
DO $$
DECLARE definition text; signature text; old_text text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['public.videoforge_record_hosted_prompt_batch(uuid,jsonb)',
    'public.videoforge_recover_hosted_prompt_batch(uuid,text,jsonb)'] LOOP
    definition:=pg_get_functiondef(signature::regprocedure);
    old_text:='WHERE id=supplied_run_id FOR UPDATE;';
    IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt duplicate acceptance lock boundary drifted'; END IF;
    definition:=replace(definition,old_text,old_text||'
  IF public.videoforge_hosted_prompt_batch_matches_saved(supplied_run_id,supplied) THEN');
    -- Recovery additionally binds the supplied effective UUID, including a replaced claim.
    IF signature LIKE '%recover%' THEN
      definition:=replace(definition,'matches_saved(supplied_run_id,supplied) THEN',
        'matches_saved(supplied_run_id,supplied) AND EXISTS (
          SELECT 1 FROM public.hosted_prompt_batch_progress p
          JOIN public.hosted_prompt_batch_claims c ON c.id=p.claim_id
          WHERE p.run_id=run.id AND p.batch_ordinal=batch_ordinal
            AND coalesce((SELECT b.provider_task_uuid FROM public.hosted_prompt_batch_replacements b
              WHERE b.claim_id=c.id ORDER BY b.replacement_index DESC LIMIT 1),c.provider_task_uuid)
              =supplied_provider_task_uuid) THEN');
    END IF;
    -- Insert the return exactly at the injected predicate, before any state/order check.
    old_text:=CASE WHEN signature LIKE '%recover%' THEN '=supplied_provider_task_uuid) THEN'
      ELSE 'matches_saved(supplied_run_id,supplied) THEN' END;
    definition:=replace(definition,old_text,old_text||' RETURN true; END IF;');
    EXECUTE definition;
  END LOOP;
END;
$$;

-- Reopen only a contiguous, wholly accepted prefix with no unresolved provider claim. Existing
-- reservation/attempt identities remain exact. This creates no claim and spends no money.
DO $$
DECLARE definition text; old_text text; new_text text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_reopen_complete_hosted_prompt_run(uuid)'::regprocedure);
  definition:=replace(definition,'videoforge_reopen_complete_hosted_prompt_run','videoforge_reopen_saved_hosted_prompt_prefix');
  old_text:='IF run.id IS NULL';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt prefix state boundary drifted'; END IF;
  definition:=replace(definition,old_text,
    'IF run.id IS NOT NULL AND public.videoforge_current_account_id()=run.account_id AND run.state=''DISPATCHING'' THEN RETURN false; END IF;
  '||old_text);
  definition:=replace(definition,'IF batch_count<>run.planned_batch_count',
    'IF batch_count<1 OR batch_count>run.planned_batch_count');
  definition:=replace(definition,'scene_count<>run.planned_scene_count','scene_count>run.planned_scene_count');
  definition:=replace(definition,'recorded_scene_count>run.planned_scene_count','recorded_scene_count<>scene_count');
  definition:=replace(definition,'claim_count<>run.planned_batch_count','claim_count<>batch_count');
  definition:=replace(definition,'generate_series(0,run.planned_batch_count-1)','generate_series(0,batch_count-1)');
  definition:=replace(definition,'AND (event.owner_type<>''PROJECT_REVISION''',
    'AND event.sequence>=run.reservation_cost_sequence AND (event.owner_type<>''PROJECT_REVISION''');
  old_text:='OR reservation_count<>1';
  definition:=replace(definition,old_text,old_text||'
     OR (SELECT coalesce(sum(amount_micro_usd),0) FROM public.cost_events
          WHERE account_id=run.account_id AND workspace_id=run.workspace_id AND task_id=run.task_id
            AND attempt_id=run.attempt_id AND event_type=''SETTLED'' AND sequence<run.reservation_cost_sequence)
        <>run.settled_cost_micro_usd');
  old_text:='UPDATE public.hosted_prompt_runs';
  new_text:='UPDATE public.attempts SET state=''RUNNING'',dispatch_state=''RECONCILED'',problem_code=NULL,finished_at=NULL
     WHERE account_id=run.account_id AND workspace_id=run.workspace_id AND task_id=run.task_id AND id=run.attempt_id;
  UPDATE public.generation_tasks SET state=''RUNNING'',version=version+1,finished_at=NULL,updated_at=now()
     WHERE account_id=run.account_id AND workspace_id=run.workspace_id AND id=run.task_id;
  '||old_text;
  definition:=replace(definition,old_text,new_text);
  EXECUTE definition;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_reopen_saved_hosted_prompt_prefix(uuid) FROM PUBLIC;

DO $$
DECLARE principal record;
BEGIN
  FOR principal IN SELECT DISTINCT pg_get_userbyid(acl.grantee) AS role_name
    FROM pg_proc proc CROSS JOIN LATERAL aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl
    WHERE proc.oid='public.videoforge_reopen_complete_hosted_prompt_run(uuid)'::regprocedure
      AND acl.privilege_type='EXECUTE' AND acl.grantee<>0 AND acl.grantee<>proc.proowner
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.videoforge_reopen_saved_hosted_prompt_prefix(uuid) TO %I',principal.role_name);
  END LOOP;
END;
$$;
