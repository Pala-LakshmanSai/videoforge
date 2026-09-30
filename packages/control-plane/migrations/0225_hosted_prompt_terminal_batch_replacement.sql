-- One replacement for an identity-verified, finished, unusable prompt response.
-- Original claims and accepted progress remain immutable. UNKNOWN alone grants no retry.
ALTER TABLE public.hosted_prompt_runs ADD COLUMN discarded_cost_micro_usd bigint NOT NULL
  DEFAULT 0 CHECK (discarded_cost_micro_usd BETWEEN 0 AND reserved_cost_micro_usd);

CREATE TABLE public.hosted_prompt_batch_replacements (
  claim_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  provider_task_uuid text NOT NULL,
  request_bytes text NOT NULL CHECK (octet_length(request_bytes) BETWEEN 1 AND 8388608),
  request_hash text NOT NULL CHECK (
    request_hash ~ '^sha256:[0-9a-f]{64}$' AND
    request_hash='sha256:'||encode(digest(convert_to(request_bytes,'UTF8'),'sha256'),'hex')),
  invalid_response_hash text NOT NULL CHECK (invalid_response_hash ~ '^sha256:[0-9a-f]{64}$'),
  known_cost_micro_usd bigint NOT NULL CHECK (known_cost_micro_usd BETWEEN 0 AND 250000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id,workspace_id,run_id,provider_task_uuid),
  FOREIGN KEY (account_id,workspace_id,claim_id)
    REFERENCES public.hosted_prompt_batch_claims(account_id,workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id,workspace_id,run_id)
    REFERENCES public.hosted_prompt_runs(account_id,workspace_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER hosted_prompt_batch_replacements_tenant_write_guard
  BEFORE INSERT OR UPDATE ON public.hosted_prompt_batch_replacements
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER hosted_prompt_batch_replacements_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_prompt_batch_replacements
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_immutable_row();
ALTER TABLE public.hosted_prompt_batch_replacements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_prompt_batch_replacements FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_prompt_batch_replacements_tenant_rls ON public.hosted_prompt_batch_replacements
  USING (account_id=public.videoforge_current_account_id())
  WITH CHECK (account_id=public.videoforge_current_account_id());
REVOKE ALL ON TABLE public.hosted_prompt_batch_replacements FROM PUBLIC;

CREATE FUNCTION public.videoforge_replace_invalid_hosted_prompt_batch(
  supplied_run_id uuid, supplied_batch_ordinal integer, supplied_provider_task_uuid text,
  supplied_response_hash text, supplied_known_cost_micro_usd bigint,
  supplied_request_bytes text, supplied_request_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
#variable_conflict use_variable
DECLARE
  run public.hosted_prompt_runs%ROWTYPE;
  claim_row public.hosted_prompt_batch_claims%ROWTYPE;
  existing public.hosted_prompt_batch_replacements%ROWTYPE;
  original jsonb;
  replacement jsonb;
  original_payload jsonb;
  replacement_payload jsonb;
  prior_batch_count integer;
  prior_cost bigint;
  changed integer;
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id
     OR supplied_batch_ordinal IS NULL OR supplied_batch_ordinal<0
     OR supplied_response_hash IS NULL OR supplied_response_hash !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_known_cost_micro_usd IS NULL
     OR supplied_known_cost_micro_usd NOT BETWEEN 0 AND 250000
     OR supplied_request_bytes IS NULL
     OR octet_length(supplied_request_bytes) NOT BETWEEN 1 AND 8388608
     OR supplied_request_hash IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(supplied_request_bytes,'UTF8'),'sha256'),'hex') THEN
    RAISE EXCEPTION 'hosted prompt replacement identity is invalid' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::integer,coalesce(sum(reported_cost_micro_usd),0)::bigint
    INTO prior_batch_count,prior_cost FROM public.hosted_prompt_batch_progress
   WHERE account_id=run.account_id AND workspace_id=run.workspace_id AND run_id=run.id;
  SELECT * INTO claim_row FROM public.hosted_prompt_batch_claims
   WHERE account_id=run.account_id AND workspace_id=run.workspace_id AND run_id=run.id
     AND task_id=run.task_id AND attempt_id=run.attempt_id AND outbox_id=run.outbox_id
     AND batch_ordinal=supplied_batch_ordinal FOR UPDATE;
  IF claim_row.id IS NULL OR claim_row.provider_task_uuid IS DISTINCT FROM supplied_provider_task_uuid THEN
    RAISE EXCEPTION 'hosted prompt replacement claim is invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.hosted_prompt_batch_replacements WHERE claim_id=claim_row.id;
  IF existing.claim_id IS NOT NULL THEN
    IF existing.request_bytes=supplied_request_bytes AND existing.request_hash=supplied_request_hash
       AND existing.invalid_response_hash=supplied_response_hash
       AND existing.known_cost_micro_usd=supplied_known_cost_micro_usd THEN RETURN false; END IF;
    RAISE EXCEPTION 'hosted prompt replacement evidence drifted' USING ERRCODE='23514';
  END IF;
  IF run.state NOT IN ('DISPATCHING','UNKNOWN') OR run.acceptance_fingerprint_hash IS NOT NULL
     OR (run.state='UNKNOWN' AND (run.provider_may_have_charged IS NOT TRUE
       OR run.problem_code NOT IN ('HOSTED_PROMPT_DISPATCH_TIMEOUT','HOSTED_PROMPT_EXECUTION_UNKNOWN')))
     OR prior_batch_count<>supplied_batch_ordinal OR prior_batch_count>=run.planned_batch_count
     OR prior_cost+run.discarded_cost_micro_usd+supplied_known_cost_micro_usd+250000
       >run.reserved_cost_micro_usd THEN
    RAISE EXCEPTION 'hosted prompt replacement state or budget is invalid' USING ERRCODE='23514';
  END IF;
  original:=claim_row.request_bytes::jsonb;
  replacement:=supplied_request_bytes::jsonb;
  original_payload:=(original#>>'{0,messages,0,content}')::jsonb;
  replacement_payload:=(replacement#>>'{0,messages,0,content}')::jsonb;
  IF jsonb_array_length(original)<>1 OR jsonb_array_length(replacement)<>1
     OR original#>>'{0,taskType}' IS DISTINCT FROM 'textInference'
     OR original#>>'{0,taskUUID}' IS DISTINCT FROM supplied_provider_task_uuid
     OR replacement#>>'{0,taskUUID}' IS NULL
     OR replacement#>>'{0,taskUUID}'=supplied_provider_task_uuid
     OR (original->0)-'taskUUID'-'messages' IS DISTINCT FROM (replacement->0)-'taskUUID'-'messages'
     OR jsonb_array_length(replacement#>'{0,messages}')<>1
     OR replacement#>>'{0,messages,0,role}' IS DISTINCT FROM 'user'
     OR original_payload->>'attempt_index' IS DISTINCT FROM '1'
     OR replacement_payload->>'attempt_index' IS DISTINCT FROM '2'
     OR original_payload-'attempt_index' IS DISTINCT FROM replacement_payload-'attempt_index' THEN
    RAISE EXCEPTION 'hosted prompt replacement request drifted' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.hosted_prompt_batch_replacements(
    claim_id,account_id,workspace_id,run_id,provider_task_uuid,request_bytes,request_hash,
    invalid_response_hash,known_cost_micro_usd
  ) VALUES (claim_row.id,run.account_id,run.workspace_id,run.id,
    replacement#>>'{0,taskUUID}',supplied_request_bytes,supplied_request_hash,
    supplied_response_hash,supplied_known_cost_micro_usd);
  IF run.state='UNKNOWN' THEN
    UPDATE public.attempts SET state='RUNNING',dispatch_state='RECONCILED',problem_code=NULL,finished_at=NULL
     WHERE workspace_id=run.workspace_id AND task_id=run.task_id AND id=run.attempt_id
       AND state='UNKNOWN' AND dispatch_state='AMBIGUOUS' AND claim_state='CLAIMED'
       AND problem_code=run.problem_code;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'hosted prompt replacement attempt is invalid' USING ERRCODE='23514'; END IF;
    UPDATE public.generation_tasks SET state='RUNNING',version=version+1,finished_at=NULL,updated_at=now()
     WHERE workspace_id=run.workspace_id AND id=run.task_id AND project_revision_id=run.project_revision_id
       AND state='FAILED';
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'hosted prompt replacement task is invalid' USING ERRCODE='23514'; END IF;
  END IF;
  UPDATE public.hosted_prompt_runs SET state='DISPATCHING',problem_code=NULL,
    provider_may_have_charged=false,finished_at=NULL,
    discarded_cost_micro_usd=discarded_cost_micro_usd+supplied_known_cost_micro_usd WHERE id=run.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_replace_invalid_hosted_prompt_batch(uuid,integer,text,text,bigint,text,text) FROM PUBLIC;

-- Patch only the existing authoritative validation/settlement boundaries. Fail on drift.
DO $$
DECLARE definition text; old_text text; new_text text; signature text;
BEGIN
  signature:='public.videoforge_record_hosted_prompt_batch(uuid,jsonb)';
  definition:=pg_get_functiondef(signature::regprocedure);
  old_text:='AND claim_row.batch_ordinal=batch_ordinal AND claim_row.request_hash=request_hash;';
  new_text:='AND claim_row.batch_ordinal=batch_ordinal AND
    coalesce((SELECT replacement.request_hash FROM public.hosted_prompt_batch_replacements replacement
      WHERE replacement.claim_id=claim_row.id),claim_row.request_hash)=request_hash;';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt record claim boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);
  old_text:='prior_cost+batch_cost>run.reserved_cost_micro_usd';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt record budget boundary drifted'; END IF;
  definition:=replace(definition,old_text,'prior_cost+batch_cost+run.discarded_cost_micro_usd>run.reserved_cost_micro_usd');
  definition:=replace(definition,'reported_cost_micro_usd=prior_cost+batch_cost',
    'reported_cost_micro_usd=prior_cost+batch_cost+run.discarded_cost_micro_usd');
  EXECUTE definition;

  FOREACH signature IN ARRAY ARRAY[
    'public.videoforge_recover_hosted_prompt_batch(uuid,text,jsonb)',
    'public.videoforge_adjudicate_invalid_hosted_prompt_batch(uuid,text,text,bigint)'
  ] LOOP
    definition:=pg_get_functiondef(signature::regprocedure);
    old_text:=CASE WHEN signature LIKE '%adjudicate%' THEN 'IF claim_row.id IS NULL'
      ELSE 'IF prior_batch_count<>batch_ordinal' END;
    new_text:='IF EXISTS (SELECT 1 FROM public.hosted_prompt_batch_replacements WHERE claim_id=claim_row.id) THEN
      SELECT provider_task_uuid,request_bytes,request_hash
        INTO claim_row.provider_task_uuid,claim_row.request_bytes,claim_row.request_hash
        FROM public.hosted_prompt_batch_replacements WHERE claim_id=claim_row.id;
    END IF;
  '||old_text;
    IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt recovery claim boundary drifted'; END IF;
    definition:=replace(definition,old_text,new_text);
    definition:=replace(definition,'prior_cost+supplied_known_cost_micro_usd>run.reserved_cost_micro_usd',
      'prior_cost+run.discarded_cost_micro_usd+supplied_known_cost_micro_usd>run.reserved_cost_micro_usd');
    definition:=replace(definition,'run.reported_cost_micro_usd=prior_cost+supplied_known_cost_micro_usd',
      'run.reported_cost_micro_usd=prior_cost+run.discarded_cost_micro_usd+supplied_known_cost_micro_usd');
    EXECUTE definition;
  END LOOP;

  definition:=pg_get_functiondef('public.videoforge_fail_hosted_prompt_run(uuid,text,text,boolean,bigint)'::regprocedure);
  old_text:='known_cost:=known_cost+additional_cost;';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt failure cost boundary drifted'; END IF;
  EXECUTE replace(definition,old_text,'known_cost:=known_cost+additional_cost+run.discarded_cost_micro_usd;');

  definition:=pg_get_functiondef('public.videoforge_complete_hosted_prompt_run(jsonb)'::regprocedure);
  old_text:='OR batch_cost>run.reserved_cost_micro_usd';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt completion budget boundary drifted'; END IF;
  definition:=replace(definition,old_text,'OR batch_cost+run.discarded_cost_micro_usd>run.reserved_cost_micro_usd');
  -- Accepted prompt evidence continues to report accepted batches only. The financial ledger
  -- settles both accepted and discarded provider work, then releases the exact remainder.
  old_text:='INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt completion settlement boundary drifted'; END IF;
  definition:=replace(definition,old_text,'reported:=reported+run.discarded_cost_micro_usd;
  '||old_text);
  -- This INSERT spelling appears again in the conditional RELEASED event. Add the cost once.
  definition:=replace(definition,'IF run.reserved_cost_micro_usd-reported>0 THEN
    reported:=reported+run.discarded_cost_micro_usd;', 'IF run.reserved_cost_micro_usd-reported>0 THEN');
  definition:=replace(definition,'''batch_count'',batch_count',
    '''batch_count'',batch_count,''discarded_cost_micro_usd'',run.discarded_cost_micro_usd');
  EXECUTE definition;

  definition:=pg_get_functiondef('public.videoforge_validate_hosted_prompt_completion()'::regprocedure);
  old_text:='batch_cost IS DISTINCT FROM NEW.reported_cost_micro_usd';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt completion trigger drifted'; END IF;
  definition:=replace(definition,old_text,'batch_cost+NEW.discarded_cost_micro_usd IS DISTINCT FROM NEW.reported_cost_micro_usd');
  definition:=replace(definition,'batch_cost>NEW.reserved_cost_micro_usd',
    'batch_cost+NEW.discarded_cost_micro_usd>NEW.reserved_cost_micro_usd');
  definition:=replace(definition,'execution.reported_cost_micro_usd=NEW.reported_cost_micro_usd',
    'execution.reported_cost_micro_usd+NEW.discarded_cost_micro_usd=NEW.reported_cost_micro_usd');
  EXECUTE definition;

  definition:=pg_get_functiondef('public.videoforge_reopen_complete_hosted_prompt_run(uuid)'::regprocedure);
  old_text:='run.reported_cost_micro_usd IS DISTINCT FROM batch_cost';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt complete recovery budget drifted'; END IF;
  definition:=replace(definition,old_text,'run.reported_cost_micro_usd IS DISTINCT FROM batch_cost+run.discarded_cost_micro_usd');
  definition:=replace(definition,'batch_cost>run.reserved_cost_micro_usd',
    'batch_cost+run.discarded_cost_micro_usd>run.reserved_cost_micro_usd');
  EXECUTE definition;
END;
$$;
