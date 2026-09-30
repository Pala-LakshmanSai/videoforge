-- One explicit operator recovery after a terminal, financially reconciled replacement failure.
-- Preserve all accepted progress/claims and the prior settlement. Fund only the unspent ceiling.
-- Ordinary runtime receives no EXECUTE on the operator mutation.
ALTER TABLE public.hosted_prompt_runs
  ADD COLUMN settled_cost_micro_usd bigint NOT NULL DEFAULT 0
    CHECK (settled_cost_micro_usd BETWEEN 0 AND reserved_cost_micro_usd),
  ADD COLUMN operator_resume_count integer NOT NULL DEFAULT 0 CHECK (operator_resume_count BETWEEN 0 AND 1);
ALTER TABLE public.hosted_prompt_batch_replacements
  ADD COLUMN replacement_index integer NOT NULL DEFAULT 1 CHECK (replacement_index BETWEEN 1 AND 2),
  ADD COLUMN retry_of_request_hash text CHECK (retry_of_request_hash IS NULL OR retry_of_request_hash ~ '^sha256:[0-9a-f]{64}$'),
  DROP CONSTRAINT hosted_prompt_batch_replacements_pkey,
  ADD PRIMARY KEY (claim_id,replacement_index),
  ADD CHECK ((replacement_index=1 AND retry_of_request_hash IS NULL)
          OR (replacement_index=2 AND retry_of_request_hash IS NOT NULL));

-- Every consumer must bind the latest effective request, never return two replacement rows.
DO $$
DECLARE definition text; signature text; old_text text; new_text text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.videoforge_record_hosted_prompt_batch(uuid,jsonb)',
    'public.videoforge_recover_hosted_prompt_batch(uuid,text,jsonb)',
    'public.videoforge_adjudicate_invalid_hosted_prompt_batch(uuid,text,text,bigint)',
    'public.videoforge_record_hosted_prompt_response(uuid,text,text,jsonb)'
  ] LOOP
    definition:=pg_get_functiondef(signature::regprocedure);
    IF signature LIKE '%record_hosted_prompt_batch%' THEN
      old_text:='WHERE replacement.claim_id=claim_row.id)';
      new_text:='WHERE replacement.claim_id=claim_row.id ORDER BY replacement.replacement_index DESC LIMIT 1)';
    ELSIF signature LIKE '%record_hosted_prompt_response%' THEN
      old_text:='LEFT JOIN public.hosted_prompt_batch_replacements b ON b.claim_id=claim_row.id;';
      new_text:='LEFT JOIN public.hosted_prompt_batch_replacements b ON b.claim_id=claim_row.id
        ORDER BY b.replacement_index DESC LIMIT 1;';
    ELSE
      old_text:='FROM public.hosted_prompt_batch_replacements WHERE claim_id=claim_row.id;';
      new_text:='FROM public.hosted_prompt_batch_replacements WHERE claim_id=claim_row.id
        ORDER BY replacement_index DESC LIMIT 1;';
    END IF;
    IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt latest replacement boundary drifted: %',signature; END IF;
    definition:=replace(definition,old_text,new_text);
    IF signature LIKE '%adjudicate_invalid%' THEN
      old_text:=$receipt$receipt_key:='hosted-prompt-invalid:'||claim_row.id;$receipt$;
      IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt invalid receipt boundary drifted'; END IF;
      definition:=replace(definition,old_text,$receipt$receipt_key:='hosted-prompt-invalid:'||claim_row.id||
        CASE WHEN run.operator_resume_count>0 THEN ':resume:'||run.reservation_cost_sequence ELSE '' END;$receipt$);
    END IF;
    EXECUTE definition;
  END LOOP;
  -- Automatic replacement still means the first replacement only.
  definition:=pg_get_functiondef('public.videoforge_replace_invalid_hosted_prompt_batch(uuid,integer,text,text,bigint,text,text)'::regprocedure);
  old_text:='WHERE claim_id=claim_row.id;';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt first replacement boundary drifted'; END IF;
  EXECUTE replace(definition,old_text,'WHERE claim_id=claim_row.id AND replacement_index=1;');

  -- Canonical accepted evidence retains the full accepted cost. Ledger writes charge the delta
  -- after an operator resume, and settlement/release keys bind the current reservation sequence.
  definition:=pg_get_functiondef('public.videoforge_complete_hosted_prompt_run(jsonb)'::regprocedure);
  old_text:='AND reservation.event_type=''RESERVED''';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt reservation join drifted'; END IF;
  definition:=replace(definition,old_text,old_text||' AND reservation.sequence=run.reservation_cost_sequence');
  old_text:='''REPORTED'',reported,';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt reported delta boundary drifted'; END IF;
  definition:=replace(definition,old_text,'''REPORTED'',reported-run.settled_cost_micro_usd,');
  definition:=replace(definition,'''SETTLED'',reported,','''SETTLED'',reported-run.settled_cost_micro_usd,');
  definition:=replace(definition,'''batch_count'',batch_count',
    '''batch_count'',batch_count,''previously_settled_micro_usd'',run.settled_cost_micro_usd');
  FOREACH old_text IN ARRAY ARRAY['reported','settled','released'] LOOP
    new_text:=format($key$'hosted-prompt:'||run.project_revision_id||':%s'$key$,old_text);
    IF position(new_text IN definition)=0 THEN RAISE EXCEPTION 'prompt completion key boundary drifted'; END IF;
    definition:=replace(definition,new_text,new_text||$suffix$||CASE WHEN run.operator_resume_count>0 THEN ':resume:'||run.reservation_cost_sequence ELSE '' END$suffix$);
  END LOOP;
  EXECUTE definition;

  definition:=pg_get_functiondef('public.videoforge_fail_hosted_prompt_run(uuid,text,text,boolean,bigint)'::regprocedure);
  definition:=replace(definition,'IF known_cost>0 THEN','IF known_cost>run.settled_cost_micro_usd THEN');
  definition:=replace(definition,'''REPORTED'',known_cost,','''REPORTED'',known_cost-run.settled_cost_micro_usd,');
  definition:=replace(definition,'''SETTLED'',known_cost,','''SETTLED'',known_cost-run.settled_cost_micro_usd,');
  definition:=replace(definition,'OR known_cost>run.reserved_cost_micro_usd',
    'OR known_cost<run.settled_cost_micro_usd OR known_cost>run.reserved_cost_micro_usd');
  FOREACH old_text IN ARRAY ARRAY['partial-reported','partial-settled','released'] LOOP
    new_text:=format($key$'hosted-prompt:'||run.project_revision_id||':%s'$key$,old_text);
    IF position(new_text IN definition)=0 THEN RAISE EXCEPTION 'prompt failure key boundary drifted'; END IF;
    definition:=replace(definition,new_text,new_text||$suffix$||CASE WHEN run.operator_resume_count>0 THEN ':resume:'||run.reservation_cost_sequence ELSE '' END$suffix$);
  END LOOP;
  EXECUTE definition;

  definition:=pg_get_functiondef('public.videoforge_reopen_complete_hosted_prompt_run(uuid)'::regprocedure);
  definition:=replace(definition,'event.amount_micro_usd=run.reserved_cost_micro_usd',
    'event.amount_micro_usd=run.reserved_cost_micro_usd-run.settled_cost_micro_usd');
  definition:=replace(definition,'event.amount_micro_usd<>run.reserved_cost_micro_usd',
    'event.amount_micro_usd<>run.reserved_cost_micro_usd-run.settled_cost_micro_usd');
  EXECUTE definition;
END;
$$;

CREATE FUNCTION public.videoforge_resume_failed_hosted_prompt_batch(
  supplied_run_id uuid, supplied_provider_task_uuid text, supplied_response_hash text,
  supplied_known_cost_micro_usd bigint, supplied_request_bytes text, supplied_request_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
DECLARE
  run public.hosted_prompt_runs%ROWTYPE;
  prior public.hosted_prompt_batch_replacements%ROWTYPE;
  claim_row public.hosted_prompt_batch_claims%ROWTYPE;
  terminal public.repository_mutation_receipts%ROWTYPE;
  next_request jsonb;
  accepted_cost bigint;
  accepted_batches integer;
  settled bigint;
  released bigint;
  reserved bigint;
  next_sequence integer;
  changed integer;
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id THEN
    RAISE EXCEPTION 'prompt operator resume identity is invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO prior FROM public.hosted_prompt_batch_replacements
    WHERE run_id=run.id AND provider_task_uuid=supplied_provider_task_uuid AND replacement_index=1;
  SELECT * INTO claim_row FROM public.hosted_prompt_batch_claims WHERE id=prior.claim_id;
  IF run.operator_resume_count=1 THEN
    IF EXISTS (SELECT 1 FROM public.hosted_prompt_batch_replacements b WHERE b.claim_id=prior.claim_id
      AND b.replacement_index=2 AND b.request_hash=supplied_request_hash
      AND b.request_bytes=supplied_request_bytes AND b.invalid_response_hash=supplied_response_hash
      AND b.known_cost_micro_usd=supplied_known_cost_micro_usd) THEN RETURN false; END IF;
    RAISE EXCEPTION 'prompt operator resume exhausted or evidence drifted' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::integer,coalesce(sum(reported_cost_micro_usd),0)::bigint
    INTO accepted_batches,accepted_cost FROM public.hosted_prompt_batch_progress WHERE run_id=run.id;
  SELECT * INTO terminal FROM public.repository_mutation_receipts
    WHERE workspace_id=run.workspace_id AND idempotency_key='hosted-prompt-invalid:'||prior.claim_id;
  IF prior.claim_id IS NULL OR claim_row.task_id IS DISTINCT FROM run.task_id
    OR claim_row.attempt_id IS DISTINCT FROM run.attempt_id OR claim_row.outbox_id IS DISTINCT FROM run.outbox_id
    OR claim_row.batch_ordinal<>accepted_batches OR accepted_batches=0 OR accepted_batches>=run.planned_batch_count
    OR run.state<>'FAILED' OR run.problem_code<>'HOSTED_PROMPT_OUTPUT_INVALID'
    OR run.provider_may_have_charged IS NOT FALSE OR run.acceptance_fingerprint_hash IS NOT NULL
    OR terminal.operation IS DISTINCT FROM 'hosted_prompt_invalid_batch'
    OR terminal.input_hash IS DISTINCT FROM supplied_response_hash
    OR terminal.result_payload->>'provider_task_uuid' IS DISTINCT FROM supplied_provider_task_uuid
    OR terminal.result_payload->>'request_hash' IS DISTINCT FROM prior.request_hash
    OR (terminal.result_payload->>'known_cost_micro_usd')::bigint IS DISTINCT FROM supplied_known_cost_micro_usd
    OR run.reported_cost_micro_usd IS DISTINCT FROM accepted_cost+run.discarded_cost_micro_usd+supplied_known_cost_micro_usd
    OR run.reported_cost_micro_usd+250000>run.reserved_cost_micro_usd
    OR supplied_request_hash IS DISTINCT FROM 'sha256:'||encode(digest(convert_to(supplied_request_bytes,'UTF8'),'sha256'),'hex')
    OR octet_length(supplied_request_bytes) NOT BETWEEN 1 AND 8388608 THEN
    RAISE EXCEPTION 'prompt operator resume evidence or budget is invalid' USING ERRCODE='23514';
  END IF;
  next_request:=supplied_request_bytes::jsonb;
  IF jsonb_array_length(next_request)<>1 OR next_request#>>'{0,taskUUID}' IS NULL
    OR next_request#>>'{0,taskUUID}'=supplied_provider_task_uuid
    OR (next_request->0)-'taskUUID' IS DISTINCT FROM (prior.request_bytes::jsonb->0)-'taskUUID' THEN
    RAISE EXCEPTION 'prompt operator resume request drifted' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(amount_micro_usd) FILTER (WHERE event_type='RESERVED'),0),
    coalesce(sum(amount_micro_usd) FILTER (WHERE event_type='SETTLED'),0),
    coalesce(sum(amount_micro_usd) FILTER (WHERE event_type='RELEASED'),0)
    INTO reserved,settled,released FROM public.cost_events WHERE account_id=run.account_id
    AND workspace_id=run.workspace_id AND task_id=run.task_id AND attempt_id=run.attempt_id;
  IF reserved<>run.reserved_cost_micro_usd OR settled IS DISTINCT FROM run.reported_cost_micro_usd
     OR reserved<>settled+released THEN
    RAISE EXCEPTION 'prompt operator resume prior settlement is invalid' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(max(sequence),0)+1 INTO next_sequence FROM public.cost_events
    WHERE workspace_id=run.workspace_id AND owner_type='PROJECT_REVISION' AND owner_id=run.project_revision_id;
  INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
    sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
  VALUES(gen_random_uuid(),run.account_id,run.workspace_id,'PROJECT_REVISION',run.project_revision_id,
    run.task_id,run.attempt_id,next_sequence,'RESERVED',run.reserved_cost_micro_usd-settled,
    'hosted-prompt:'||run.project_revision_id||':resume-reserved:'||next_sequence,
    jsonb_build_object('operation','scene-prompt-writer-v2','previously_settled_micro_usd',settled,
      'accepted_prefix_batches',accepted_batches,'cumulative_cap_micro_usd',run.reserved_cost_micro_usd),now());
  INSERT INTO public.hosted_prompt_batch_replacements(claim_id,account_id,workspace_id,run_id,
    provider_task_uuid,request_bytes,request_hash,invalid_response_hash,known_cost_micro_usd,
    replacement_index,retry_of_request_hash)
  VALUES(prior.claim_id,run.account_id,run.workspace_id,run.id,next_request#>>'{0,taskUUID}',
    supplied_request_bytes,supplied_request_hash,supplied_response_hash,supplied_known_cost_micro_usd,
    2,prior.request_hash);
  UPDATE public.attempts SET state='RUNNING',dispatch_state='RECONCILED',problem_code=NULL,finished_at=NULL
    WHERE account_id=run.account_id AND workspace_id=run.workspace_id AND id=run.attempt_id
    AND task_id=run.task_id AND state='FAILED' AND claim_state='CLAIMED';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'prompt operator resume attempt is invalid' USING ERRCODE='23514'; END IF;
  UPDATE public.generation_tasks SET state='RUNNING',version=version+1,finished_at=NULL,updated_at=now()
    WHERE account_id=run.account_id AND workspace_id=run.workspace_id AND id=run.task_id
    AND project_revision_id=run.project_revision_id AND state='FAILED';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'prompt operator resume task is invalid' USING ERRCODE='23514'; END IF;
  UPDATE public.hosted_prompt_runs SET state='DISPATCHING',problem_code=NULL,finished_at=NULL,
    provider_may_have_charged=false,discarded_cost_micro_usd=discarded_cost_micro_usd+supplied_known_cost_micro_usd,
    settled_cost_micro_usd=settled,reservation_cost_sequence=next_sequence,operator_resume_count=1 WHERE id=run.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_resume_failed_hosted_prompt_batch(uuid,text,text,bigint,text,text) FROM PUBLIC;
