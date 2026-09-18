-- Aligns the hosted voiceover-context redispatch budget with the application constant.
--
-- The product bounds its automatic redispatch of a context attempt that produced no accepted result
-- with HOSTED_CONTEXT_REDISPATCH_BUDGET = 6 (voiceover-context.ts, mirrored by the continuation
-- sweep), and it documents why six: a Runware bad window answered 502 five times in a row and then
-- succeeded twice, so a small budget strands the revision at stage 3 for a transient outage.
--
-- The capability replaced here still enforced two, so from the third failure on, the sweep kept
-- selecting the revision while this function answered 'hosted voiceover context redispatch budget is
-- spent': the run stopped at stage 3 with four attempts the product believed it still had, and the
-- heartbeat recorded the refusal every sweep. This migration recreates the same body with the budget
-- at six so the database and the application agree.
--
-- Everything else is unchanged: a redispatch is still a fresh, separately reserved attempt (its own
-- task/attempt/outbox/cost-event trio), it is still allowed only when the previous attempt produced
-- no accepted result, and the retryable problem-code gate is untouched.
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
  profile_config jsonb:='{"model":"deepseek:v4@flash","operation":"voiceover-context-v9","provider":"runware"}'::jsonb;
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
       'HOSTED_CONTEXT_PROVIDER_FAILURE') THEN
    RAISE EXCEPTION 'hosted voiceover context failure is not retryable' USING ERRCODE='23514';
  END IF;
  IF existing.redispatch_count >= 6 THEN
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
     AND profile.name='Hosted Runware voiceover context' AND profile.revision=7 FOR SHARE;
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
    jsonb_build_object('provider','runware','model','deepseek:v4@flash','redispatch',true),
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
    jsonb_build_object('provider','runware','model','deepseek:v4@flash','redispatch',true),now_at);
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
