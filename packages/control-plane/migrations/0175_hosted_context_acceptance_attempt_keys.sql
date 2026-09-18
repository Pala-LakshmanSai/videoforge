-- Scopes the acceptance's cost events to the attempt, in both acceptance paths, and opens the
-- stage-3 allowance to thirty.
--
-- Both the direct acceptance and the reconciliation acceptance wrote their cost events under keys
-- that carry only the revision ('hosted-voiceover-context:<revision>:reported|settled|released'), so a
-- revision could be accepted exactly once: every later attempt - including a redispatch that finally
-- succeeded after the provider side was repaired - died on the cost_events idempotency key. The live
-- rows show the released key already present from an earlier attempt, which is why the acceptance
-- failed for every model. The keys now carry the attempt's reservation sequence, which keeps a replay
-- of the same attempt idempotent while letting a later attempt settle on its own.
--
-- The allowance moves to thirty so the revision that spent every previous attempt on these causes can
-- finish; every attempt stays separately reserved and the bound stays a small constant.

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
    'hosted-voiceover-context:'||target.project_revision_id||':reported:'||(target.reservation_cost_sequence+1)::text,
    jsonb_build_object('context_hash',supplied_context_hash),now_at,now_at),
    (gen_random_uuid(),target.account_id,target.workspace_id,'PROJECT_REVISION',
    target.project_revision_id,target.task_id,target.attempt_id,
    target.reservation_cost_sequence+2,'SETTLED',supplied_reported_cost,
    'hosted-voiceover-context:'||target.project_revision_id||':settled:'||(target.reservation_cost_sequence+2)::text,
    jsonb_build_object('context_hash',supplied_context_hash),now_at,now_at);
  IF target.reserved_cost_micro_usd > supplied_reported_cost THEN
    INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
      sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at,created_at)
    VALUES(gen_random_uuid(),target.account_id,target.workspace_id,'PROJECT_REVISION',
      target.project_revision_id,target.task_id,target.attempt_id,
      target.reservation_cost_sequence+3,'RELEASED',
      target.reserved_cost_micro_usd-supplied_reported_cost,
      'hosted-voiceover-context:'||target.project_revision_id||':released:'||(target.reservation_cost_sequence+3)::text,
      jsonb_build_object('context_hash',supplied_context_hash,
        'unused_reservation_micro_usd',target.reserved_cost_micro_usd-supplied_reported_cost),
      now_at,now_at);
  END IF;
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

REVOKE ALL ON FUNCTION public.videoforge_complete_hosted_voiceover_context(jsonb)
FROM PUBLIC;

-- Reconciled UNKNOWN results use the same reservation accounting as direct completion.
-- Preserve the existing claim/replay fences while recording any unused remainder.

CREATE OR REPLACE FUNCTION public.videoforge_reconcile_unknown_hosted_voiceover_context(
  supplied jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
#variable_conflict use_variable
DECLARE
  account_id uuid:=(supplied->>'account_id')::uuid;
  workspace_id uuid:=(supplied->>'workspace_id')::uuid;
  user_id uuid:=(supplied->>'user_id')::uuid;
  project_id uuid:=(supplied->>'project_id')::uuid;
  revision_id uuid:=(supplied->>'revision_id')::uuid;
  context_id uuid:=(supplied->>'context_id')::uuid;
  output_asset_id uuid:=(supplied->>'output_asset_id')::uuid;
  transcript_hash text:=supplied->>'transcript_hash';
  request_hash text:=supplied->>'request_hash';
  response_bytes text:=supplied->>'response_bytes';
  response_hash text:=supplied->>'response_hash';
  context_bytes text:=supplied->>'context_bytes';
  context_hash text:=supplied->>'context_hash';
  reported bigint:=(supplied->>'reported_cost_micro_usd')::bigint;
  target public.hosted_voiceover_contexts%ROWTYPE;
  execution_attempt public.attempts%ROWTYPE;
  task public.generation_tasks%ROWTYPE;
  reservation public.cost_events%ROWTYPE;
  now_at timestamptz:=clock_timestamp();
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM account_id
     OR NOT EXISTS (SELECT 1 FROM public.memberships membership
       WHERE membership.account_id=account_id AND membership.workspace_id=workspace_id
         AND membership.user_id=user_id AND membership.status='ACTIVE')
     OR transcript_hash !~ '^sha256:[0-9a-f]{64}$'
     OR request_hash !~ '^sha256:[0-9a-f]{64}$'
     OR response_hash !~ '^sha256:[0-9a-f]{64}$'
     OR context_hash !~ '^sha256:[0-9a-f]{64}$'
     OR response_bytes IS NULL OR context_bytes IS NULL
     OR reported IS NULL THEN
    RAISE EXCEPTION 'hosted voiceover context reconciliation authority is invalid'
      USING ERRCODE='42501';
  END IF;

  SELECT * INTO target FROM public.hosted_voiceover_contexts context
   WHERE context.id=context_id FOR UPDATE;
  IF target.id IS NULL
     OR target.account_id IS DISTINCT FROM account_id
     OR target.workspace_id IS DISTINCT FROM workspace_id
     OR target.project_id IS DISTINCT FROM project_id
     OR target.project_revision_id IS DISTINCT FROM revision_id
     OR target.transcript_hash IS DISTINCT FROM transcript_hash
     OR target.request_hash IS DISTINCT FROM request_hash
     OR reported NOT BETWEEN 0 AND target.reserved_cost_micro_usd
     OR context_hash IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(context_bytes,'UTF8'),'sha256'),'hex')
     OR response_hash IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(response_bytes,'UTF8'),'sha256'),'hex')
     OR jsonb_typeof(context_bytes::jsonb)<>'object' THEN
    RAISE EXCEPTION 'hosted voiceover context reconciliation result is invalid'
      USING ERRCODE='23514';
  END IF;

  SELECT * INTO execution_attempt FROM public.attempts attempt
   WHERE attempt.account_id=target.account_id AND attempt.workspace_id=target.workspace_id
     AND attempt.task_id=target.task_id AND attempt.id=target.attempt_id FOR UPDATE;
  SELECT * INTO task FROM public.generation_tasks generation_task
   WHERE generation_task.account_id=target.account_id
     AND generation_task.workspace_id=target.workspace_id
     AND generation_task.id=target.task_id FOR UPDATE;
  SELECT * INTO reservation FROM public.cost_events event
   WHERE event.account_id=target.account_id AND event.workspace_id=target.workspace_id
     AND event.owner_type='PROJECT_REVISION' AND event.owner_id=target.project_revision_id
     AND event.task_id=target.task_id AND event.attempt_id=target.attempt_id
     AND event.sequence=target.reservation_cost_sequence FOR SHARE;

  -- Exact successful replay is read-only and returns the already accepted durable identity.
  IF target.state='SUCCEEDED' THEN
    IF target.provider_may_have_charged OR target.problem_code IS NOT NULL
       OR target.context_hash IS DISTINCT FROM context_hash
       OR target.response_hash IS DISTINCT FROM response_hash
       OR target.context_document IS DISTINCT FROM context_bytes::jsonb
       OR target.reported_cost_micro_usd IS DISTINCT FROM reported
       OR execution_attempt.state<>'SUCCEEDED'
       OR execution_attempt.dispatch_state<>'RECONCILED'
       OR execution_attempt.result_disposition<>'ACCEPTED'
       OR execution_attempt.output_asset_id IS DISTINCT FROM output_asset_id
       OR task.state<>'COMPLETE' OR task.accepted_attempt_id IS DISTINCT FROM target.attempt_id
       OR reservation.id IS NULL OR reservation.event_type<>'RESERVED'
       OR reservation.amount_micro_usd<>target.reserved_cost_micro_usd
       OR NOT EXISTS (SELECT 1 FROM public.assets asset
         WHERE asset.account_id=target.account_id AND asset.workspace_id=target.workspace_id
           AND asset.id=output_asset_id AND asset.project_id=target.project_id
           AND asset.project_revision_id=target.project_revision_id
           AND asset.kind='CANONICAL_DOCUMENT' AND asset.state='ACCEPTED'
           AND asset.canonical_contract_name='voiceover-story-context'
           AND asset.canonical_contract_version='v1'
           AND asset.canonical_document_sha256=context_hash)
       OR NOT EXISTS (SELECT 1 FROM public.cost_events event
         WHERE event.account_id=target.account_id AND event.workspace_id=target.workspace_id
           AND event.task_id=target.task_id AND event.attempt_id=target.attempt_id
           AND event.sequence=target.reservation_cost_sequence+1
           AND event.event_type='REPORTED' AND event.amount_micro_usd=reported)
       OR NOT EXISTS (SELECT 1 FROM public.cost_events event
         WHERE event.account_id=target.account_id AND event.workspace_id=target.workspace_id
           AND event.task_id=target.task_id AND event.attempt_id=target.attempt_id
           AND event.sequence=target.reservation_cost_sequence+2
           AND event.event_type='SETTLED' AND event.amount_micro_usd=reported)
       OR (target.reserved_cost_micro_usd > reported AND NOT EXISTS (
         SELECT 1 FROM public.cost_events event
          WHERE event.account_id=target.account_id AND event.workspace_id=target.workspace_id
            AND event.task_id=target.task_id AND event.attempt_id=target.attempt_id
            AND event.sequence=target.reservation_cost_sequence+3
            AND event.event_type='RELEASED'
            AND event.amount_micro_usd=target.reserved_cost_micro_usd-reported))
       OR (target.reserved_cost_micro_usd = reported AND EXISTS (
         SELECT 1 FROM public.cost_events event
          WHERE event.account_id=target.account_id AND event.workspace_id=target.workspace_id
            AND event.task_id=target.task_id AND event.attempt_id=target.attempt_id
            AND event.sequence=target.reservation_cost_sequence+3))
       OR (target.reserved_cost_micro_usd > reported AND
         (SELECT count(*) FROM public.cost_events event
           WHERE event.account_id=target.account_id AND event.workspace_id=target.workspace_id
             AND event.task_id=target.task_id AND event.attempt_id=target.attempt_id)<>4)
       OR (target.reserved_cost_micro_usd = reported AND
         (SELECT count(*) FROM public.cost_events event
           WHERE event.account_id=target.account_id AND event.workspace_id=target.workspace_id
             AND event.task_id=target.task_id AND event.attempt_id=target.attempt_id)<>3) THEN
      RAISE EXCEPTION 'hosted voiceover context reconciliation replay drifted'
        USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('reconciled',false,'replayed',true,'context_id',target.id,
      'task_id',target.task_id,'attempt_id',target.attempt_id,'output_asset_id',output_asset_id);
  END IF;

  IF target.state<>'UNKNOWN' OR NOT target.provider_may_have_charged
     OR target.problem_code IS NULL OR target.finished_at IS NULL
     OR execution_attempt.id IS NULL OR execution_attempt.state<>'UNKNOWN'
     OR execution_attempt.dispatch_state<>'AMBIGUOUS'
     OR execution_attempt.result_disposition<>'PENDING'
     OR execution_attempt.output_asset_id IS NOT NULL OR execution_attempt.finished_at IS NOT NULL
     OR task.id IS NULL OR task.state<>'FAILED' OR task.accepted_attempt_id IS NOT NULL
     OR reservation.id IS NULL OR reservation.event_type<>'RESERVED'
     OR reservation.amount_micro_usd<>target.reserved_cost_micro_usd
     OR EXISTS (SELECT 1 FROM public.cost_events event
       WHERE event.account_id=target.account_id AND event.workspace_id=target.workspace_id
         AND event.owner_type='PROJECT_REVISION' AND event.owner_id=target.project_revision_id
         AND event.sequence IN (
           target.reservation_cost_sequence+1,
           target.reservation_cost_sequence+2,
           target.reservation_cost_sequence+3
         )) THEN
    RAISE EXCEPTION 'hosted voiceover context is not reconcilable'
      USING ERRCODE='23514';
  END IF;

  INSERT INTO public.assets(id,account_id,workspace_id,project_id,project_revision_id,kind,state,
    canonical_contract_name,canonical_contract_version,canonical_document_sha256,content_type,
    byte_size,metadata,verified_at,created_at)
  VALUES(output_asset_id,target.account_id,target.workspace_id,target.project_id,
    target.project_revision_id,'CANONICAL_DOCUMENT','ACCEPTED','voiceover-story-context','v1',
    context_hash,'application/json',octet_length(context_bytes),
    jsonb_build_object('source','hosted-voiceover-context-reconciliation',
      'original_request_hash',target.request_hash),now_at,now_at);
  INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
    sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at,created_at)
  VALUES(gen_random_uuid(),target.account_id,target.workspace_id,'PROJECT_REVISION',
    target.project_revision_id,target.task_id,target.attempt_id,
    target.reservation_cost_sequence+1,'REPORTED',reported,
    'hosted-voiceover-context:'||target.project_revision_id||':reported:'||(target.reservation_cost_sequence+1)::text,
    jsonb_build_object('context_hash',context_hash,'reconciled',true),now_at,now_at),
    (gen_random_uuid(),target.account_id,target.workspace_id,'PROJECT_REVISION',
    target.project_revision_id,target.task_id,target.attempt_id,
    target.reservation_cost_sequence+2,'SETTLED',reported,
    'hosted-voiceover-context:'||target.project_revision_id||':settled:'||(target.reservation_cost_sequence+2)::text,
    jsonb_build_object('context_hash',context_hash,'reconciled',true),now_at,now_at);
  IF target.reserved_cost_micro_usd > reported THEN
    INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
      sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at,created_at)
    VALUES(gen_random_uuid(),target.account_id,target.workspace_id,'PROJECT_REVISION',
      target.project_revision_id,target.task_id,target.attempt_id,
      target.reservation_cost_sequence+3,'RELEASED',
      target.reserved_cost_micro_usd-reported,
      'hosted-voiceover-context:'||target.project_revision_id||':released:'||(target.reservation_cost_sequence+3)::text,
      jsonb_build_object('context_hash',context_hash,'reconciled',true,
        'unused_reservation_micro_usd',target.reserved_cost_micro_usd-reported),
      now_at,now_at);
  END IF;
  UPDATE public.attempts SET state='SUCCEEDED',dispatch_state='RECONCILED',
    output_asset_id=output_asset_id,result_disposition='ACCEPTED',problem_code=NULL,
    finished_at=now_at WHERE workspace_id=target.workspace_id
    AND task_id=target.task_id AND id=target.attempt_id;
  UPDATE public.generation_tasks SET state='COMPLETE',accepted_attempt_id=target.attempt_id,
    version=version+1,finished_at=now_at,updated_at=now_at
    WHERE workspace_id=target.workspace_id AND id=target.task_id;
  UPDATE public.hosted_voiceover_contexts SET state='SUCCEEDED',
    context_document=context_bytes::jsonb,context_hash=context_hash,response_hash=response_hash,
    reported_cost_micro_usd=reported,problem_code=NULL,provider_may_have_charged=false,
    finished_at=now_at WHERE id=target.id;

  RETURN jsonb_build_object('reconciled',true,'replayed',false,'context_id',target.id,
    'task_id',target.task_id,'attempt_id',target.attempt_id,'output_asset_id',output_asset_id);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_reconcile_unknown_hosted_voiceover_context(jsonb)
FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.videoforge_redispatch_hosted_voiceover_context(supplied jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public, pg_catalog
AS $function$
#variable_conflict use_variable
DECLARE
  account_id uuid:=(supplied->>'account_id')::uuid;
  workspace_id uuid:=(supplied->>'workspace_id')::uuid;
  user_id uuid:=(supplied->>'user_id')::uuid;
  project_id uuid:=(supplied->>'project_id')::uuid;
  revision_id uuid:=(supplied->>'revision_id')::uuid;
  asr_attempt_id uuid:=(supplied->>'asr_attempt_id')::uuid;
  task_id uuid:=(supplied->>'task_id')::uuid;
  attempt_id uuid:=(supplied->>'attempt_id')::uuid;
  outbox_id uuid:=(supplied->>'outbox_id')::uuid;
  requested_profile_id uuid:=(supplied->>'execution_profile_id')::uuid;
  profile_id uuid;
  cost_id uuid:=(supplied->>'reservation_cost_event_id')::uuid;
  transcript_hash text:=supplied->>'transcript_hash';
  request_hash text:=supplied->>'request_hash';
  claim_hash text:=supplied->>'claim_token_hash';
  existing public.hosted_voiceover_contexts%ROWTYPE;
  existing_profile public.execution_profiles%ROWTYPE;
  reservation_sequence integer;
  next_ordinal integer;
  profile_config jsonb:='{"model":"google:gemma@4-31b","operation":"voiceover-context-v11","provider":"runware"}'::jsonb;
  profile_config_hash text:='sha256:'||encode(digest(convert_to(profile_config::text,'UTF8'),'sha256'),'hex');
  outbox_payload jsonb:='{"stage":"voiceover_context"}'::jsonb;
  now_at timestamptz:=clock_timestamp();
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM account_id
     OR transcript_hash !~ '^sha256:[0-9a-f]{64}$'
     OR request_hash !~ '^sha256:[0-9a-f]{64}$'
     OR claim_hash !~ '^sha256:[0-9a-f]{64}$'
     OR (supplied->>'reserved_cost_micro_usd')::bigint<>10000
     OR NOT EXISTS (SELECT 1 FROM public.memberships membership
       WHERE membership.account_id=account_id AND membership.workspace_id=workspace_id
         AND membership.user_id=user_id AND membership.status='ACTIVE')
     OR NOT EXISTS (SELECT 1 FROM public.hosted_cpu_job_attempts cpu_attempt
       JOIN public.project_revisions revision ON revision.account_id=cpu_attempt.account_id
        AND revision.workspace_id=cpu_attempt.workspace_id
        AND revision.id=cpu_attempt.project_revision_id
       WHERE cpu_attempt.account_id=account_id AND cpu_attempt.workspace_id=workspace_id
         AND cpu_attempt.project_id=project_id AND cpu_attempt.project_revision_id=revision_id
         AND cpu_attempt.id=asr_attempt_id AND cpu_attempt.kind='ASR'
         AND cpu_attempt.state='SUCCEEDED' AND revision.status='LOCKED'
         AND TRUE) THEN
    RAISE EXCEPTION 'hosted voiceover context authority is invalid' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.workspaces workspace
   WHERE workspace.account_id=account_id AND workspace.id=workspace_id FOR UPDATE;
  PERFORM 1 FROM public.project_revisions revision
   WHERE revision.account_id=account_id AND revision.workspace_id=workspace_id
     AND revision.id=revision_id FOR UPDATE;
  SELECT * INTO existing FROM public.hosted_voiceover_contexts context
   WHERE context.account_id=account_id AND context.workspace_id=workspace_id
     AND context.project_revision_id=revision_id FOR UPDATE;
  IF existing.id IS NULL THEN
    RAISE EXCEPTION 'hosted voiceover context is missing' USING ERRCODE='23514';
  END IF;
  -- A redispatch is only ever allowed when the previous attempt demonstrably produced nothing.
  IF existing.context_hash IS NOT NULL OR existing.context_document IS NOT NULL THEN
    RAISE EXCEPTION 'hosted voiceover context already produced an accepted result'
      USING ERRCODE='23514';
  END IF;
  IF existing.state NOT IN ('FAILED','UNKNOWN') THEN
    RAISE EXCEPTION 'hosted voiceover context is not in a retryable failure state'
      USING ERRCODE='23514';
  END IF;
  IF existing.problem_code IS NULL
     OR existing.problem_code NOT IN ('VOICEOVER_CONTEXT_PROVIDER_UNAVAILABLE',
       'VOICEOVER_CONTEXT_NETWORK_UNCERTAIN','VOICEOVER_CONTEXT_RESPONSE_UNCERTAIN',
       'VOICEOVER_CONTEXT_PROVIDER_UNCERTAIN', 'HOSTED_CONTEXT_EXECUTION_UNKNOWN',
       'HOSTED_CONTEXT_PROVIDER_FAILURE', 'VOICEOVER_CONTEXT_PROVIDER_REJECTED') THEN
    RAISE EXCEPTION 'hosted voiceover context failure is not retryable' USING ERRCODE='23514';
  END IF;
  IF existing.redispatch_count >= 30 THEN
    RAISE EXCEPTION 'hosted voiceover context redispatch budget is spent' USING ERRCODE='23514';
  END IF;
  -- Derive the ordinal from the tasks that already exist rather than from the budget counter:
  -- a redispatch that was rejected still created its task row, so counting only successful
  -- redispatches would collide on generation_tasks_workspace_id_owner_type_owner_id_task_key_key.
  SELECT coalesce(max(split_part(task.task_key,':',3)::integer),1)+1 INTO next_ordinal
    FROM public.generation_tasks task
   WHERE task.workspace_id=workspace_id AND task.owner_type='PROJECT_REVISION'
     AND task.owner_id=revision_id AND task.task_key LIKE 'prompt:voiceover-context:%';
  profile_id:=requested_profile_id;
  SELECT * INTO existing_profile FROM public.execution_profiles profile
   WHERE profile.account_id=account_id AND profile.workspace_id=workspace_id
     AND profile.name='Hosted Runware voiceover context' AND profile.revision=10 FOR SHARE;
  IF existing_profile.id IS NULL OR existing_profile.lane<>'PROMPT'
     OR existing_profile.state<>'TESTED' OR existing_profile.dispatch_target<>'RUNWARE'
     OR existing_profile.configuration IS DISTINCT FROM profile_config
     OR existing_profile.configuration_hash<>profile_config_hash
     OR existing_profile.maximum_rate_micro_usd<>10000 THEN
    RAISE EXCEPTION 'hosted voiceover context execution profile drifted' USING ERRCODE='23514';
  END IF;
  profile_id:=existing_profile.id;
  SELECT coalesce(max(event.sequence),0)+1 INTO reservation_sequence
    FROM public.cost_events event WHERE event.workspace_id=workspace_id
     AND event.owner_type='PROJECT_REVISION' AND event.owner_id=revision_id;
  INSERT INTO public.generation_tasks(id,account_id,workspace_id,owner_type,owner_id,
    project_revision_id,task_key,lane,state,required,depends_on,created_at,updated_at)
  VALUES(task_id,account_id,workspace_id,'PROJECT_REVISION',revision_id,revision_id,
    'prompt:voiceover-context:'||next_ordinal,'PROMPT','RUNNING',true,'[]'::jsonb,now_at,now_at);
  INSERT INTO public.attempts(id,account_id,workspace_id,task_id,ordinal,idempotency_key,state,
    dispatch_state,claim_state,execution_profile_id,execution_claim_token_hash,input_hash,
    result_disposition,provider_details,created_at,claimed_at,started_at)
  VALUES(attempt_id,account_id,workspace_id,task_id,next_ordinal,
    'hosted-voiceover-context:'||revision_id||':'||next_ordinal,
    'RUNNING','ACKNOWLEDGED','CLAIMED',profile_id,claim_hash,transcript_hash,'PENDING',
    jsonb_build_object('provider','runware','model','google:gemma@4-31b','redispatch',true),
    now_at,now_at,now_at);
  INSERT INTO public.outbox(id,account_id,workspace_id,task_id,attempt_id,kind,state,dedupe_key,
    payload_contract_name,payload_contract_version,payload_hash,payload,available_at,delivered_at,
    created_at,updated_at)
  VALUES(outbox_id,account_id,workspace_id,task_id,attempt_id,'DISPATCH','DELIVERED',
    'hosted-voiceover-context:'||revision_id||':'||next_ordinal,'voiceover-context-dispatch','v1',
    'sha256:'||encode(digest(convert_to(outbox_payload::text,'UTF8'),'sha256'),'hex'),
    outbox_payload,now_at,now_at,now_at,now_at);
  INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
    sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
  VALUES(cost_id,account_id,workspace_id,'PROJECT_REVISION',revision_id,task_id,attempt_id,
    reservation_sequence,'RESERVED',10000,
    'hosted-voiceover-context:'||revision_id||':reserved:'||next_ordinal,
    jsonb_build_object('provider','runware','model','google:gemma@4-31b','redispatch',true),now_at);
  UPDATE public.hosted_voiceover_contexts context
     SET task_id=task_id, attempt_id=attempt_id, outbox_id=outbox_id,
         execution_profile_id=profile_id, state='DISPATCHING',
         transcript_hash=transcript_hash, request_hash=request_hash, claim_token_hash=claim_hash,
         reserved_cost_micro_usd=10000, reservation_cost_sequence=reservation_sequence,
         problem_code=NULL, provider_may_have_charged=false, started_at=now_at, finished_at=NULL,
         redispatch_count=existing.redispatch_count+1
   WHERE context.id=existing.id;
  RETURN jsonb_build_object('created',true,'state','DISPATCHING','redispatch',true,
    'context_id',existing.id,'task_id',task_id,'attempt_id',attempt_id,'outbox_id',outbox_id);
END;
$function$;
