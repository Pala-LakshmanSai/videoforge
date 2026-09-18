-- Pins the cheap reader for stage 3, in its own profile revision, and opens the allowance once more.
--
-- Two replacements' defects burned the previous allowance: the first model billed its own reasoning
-- over this stage's reservation (and truncated its answer at the old token ceiling), which the account
-- measured at $0.0163 for a realistic transcript. `google:gemma@4-31b` measured the identical request
-- at $0.00007 with the exact document shape, so the context reader moves to it under a new contract
-- version. As always for this product, a model change is a new profile revision (10 here) rather than
-- an edit of an immutable snapshot, and the capability is recreated to read it. The redispatch
-- allowance moves to eighteen so the revision that spent every attempt on those provider-side causes
-- can finish; each attempt is still separately reserved.

UPDATE public.execution_profiles
   SET state = 'RETIRED', retired_at = now()
 WHERE name = 'Hosted Runware voiceover context' AND revision = 9;
INSERT INTO public.execution_profiles(id,account_id,workspace_id,name,revision,lane,state,
  dispatch_target,configuration,configuration_hash,maximum_rate_micro_usd,checked_at,created_at)
SELECT gen_random_uuid(),profile.account_id,profile.workspace_id,
       'Hosted Runware voiceover context',10,'PROMPT','TESTED','RUNWARE',
       cfg.configuration,'sha256:'||encode(sha256(convert_to(cfg.configuration::text,'UTF8')),'hex'),
       10000,now(),now()
  FROM (SELECT DISTINCT account_id,workspace_id FROM public.execution_profiles
         WHERE name='Hosted Runware voiceover context' AND revision=7) profile
 CROSS JOIN (SELECT '{"model":"google:gemma@4-31b","operation":"voiceover-context-v11","provider":"runware"}'::jsonb AS configuration) cfg
 ON CONFLICT ON CONSTRAINT execution_profiles_workspace_id_name_revision_key DO NOTHING;
DO $$
DECLARE
  stored text;
  expected text := 'sha256:'||encode(sha256(convert_to(('{"model":"google:gemma@4-31b","operation":"voiceover-context-v11","provider":"runware"}'::jsonb)::text,'UTF8')),'hex');
BEGIN
  SELECT configuration_hash INTO stored FROM public.execution_profiles
   WHERE name='Hosted Runware voiceover context' AND revision=10 LIMIT 1;
  IF stored IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'voiceover context profile hash does not match the capability computation' USING ERRCODE='23514';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.videoforge_prepare_hosted_voiceover_context(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
#variable_conflict use_variable
DECLARE
  account_id uuid:=(supplied->>'account_id')::uuid;
  workspace_id uuid:=(supplied->>'workspace_id')::uuid;
  user_id uuid:=(supplied->>'user_id')::uuid;
  project_id uuid:=(supplied->>'project_id')::uuid;
  revision_id uuid:=(supplied->>'revision_id')::uuid;
  asr_attempt_id uuid:=(supplied->>'asr_attempt_id')::uuid;
  context_id uuid:=(supplied->>'context_id')::uuid;
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
  now_at timestamptz:=clock_timestamp();
  profile_config jsonb:='{"model":"google:gemma@4-31b","operation":"voiceover-context-v11","provider":"runware"}'::jsonb;
  profile_config_hash text:='sha256:'||encode(digest(convert_to(profile_config::text,'UTF8'),'sha256'),'hex');
  outbox_payload jsonb:='{"stage":"voiceover_context"}'::jsonb;
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
         AND revision.maximum_cost_micro_usd>=10000) THEN
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
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('created',false,'state',existing.state,'context_id',existing.id,
      'task_id',existing.task_id,'attempt_id',existing.attempt_id,'outbox_id',existing.outbox_id);
  END IF;
  profile_id:=requested_profile_id;
  INSERT INTO public.execution_profiles(id,account_id,workspace_id,name,revision,lane,state,
    dispatch_target,configuration,configuration_hash,maximum_rate_micro_usd,checked_at,created_at)
  VALUES(profile_id,account_id,workspace_id,'Hosted Runware voiceover context',10,'PROMPT','TESTED',
    'RUNWARE',profile_config,profile_config_hash,10000,now_at,now_at)
  ON CONFLICT ON CONSTRAINT execution_profiles_workspace_id_name_revision_key DO NOTHING;
  SELECT * INTO existing_profile FROM public.execution_profiles profile
   WHERE profile.account_id=account_id AND profile.workspace_id=workspace_id
     AND profile.name='Hosted Runware voiceover context' AND profile.revision=10 FOR SHARE;
  IF existing_profile.id IS NULL OR existing_profile.lane<>'PROMPT'
     OR existing_profile.state<>'TESTED' OR existing_profile.dispatch_target<>'RUNWARE'
     OR existing_profile.configuration IS DISTINCT FROM profile_config
     OR existing_profile.configuration_hash<>profile_config_hash
     OR existing_profile.maximum_rate_micro_usd<>10000 THEN
    RAISE EXCEPTION 'hosted voiceover context execution profile drifted'
      USING ERRCODE='23514';
  END IF;
  profile_id:=existing_profile.id;
  SELECT coalesce(max(event.sequence),0)+1 INTO reservation_sequence
    FROM public.cost_events event WHERE event.workspace_id=workspace_id
     AND event.owner_type='PROJECT_REVISION' AND event.owner_id=revision_id;
  INSERT INTO public.generation_tasks(id,account_id,workspace_id,owner_type,owner_id,
    project_revision_id,task_key,lane,state,required,depends_on,created_at,updated_at)
  VALUES(task_id,account_id,workspace_id,'PROJECT_REVISION',revision_id,revision_id,
    'prompt:voiceover-context:1','PROMPT','RUNNING',true,'[]'::jsonb,now_at,now_at);
  INSERT INTO public.attempts(id,account_id,workspace_id,task_id,ordinal,idempotency_key,state,
    dispatch_state,claim_state,execution_profile_id,execution_claim_token_hash,input_hash,
    result_disposition,provider_details,created_at,claimed_at,started_at)
  VALUES(attempt_id,account_id,workspace_id,task_id,1,'hosted-voiceover-context:'||revision_id,
    'RUNNING','ACKNOWLEDGED','CLAIMED',profile_id,claim_hash,transcript_hash,'PENDING',
    jsonb_build_object('provider','runware','model','google:gemma@4-31b'),now_at,now_at,now_at);
  INSERT INTO public.outbox(id,account_id,workspace_id,task_id,attempt_id,kind,state,dedupe_key,
    payload_contract_name,payload_contract_version,payload_hash,payload,available_at,delivered_at,
    created_at,updated_at)
  VALUES(outbox_id,account_id,workspace_id,task_id,attempt_id,'DISPATCH','DELIVERED',
    'hosted-voiceover-context:'||revision_id,'voiceover-context-dispatch','v1',
    'sha256:'||encode(digest(convert_to(outbox_payload::text,'UTF8'),'sha256'),'hex'),
    outbox_payload,now_at,now_at,now_at,now_at);
  INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
    sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
  VALUES(cost_id,account_id,workspace_id,'PROJECT_REVISION',revision_id,task_id,attempt_id,
    reservation_sequence,'RESERVED',10000,'hosted-voiceover-context:'||revision_id||':reserved',
    jsonb_build_object('provider','runware','model','google:gemma@4-31b'),now_at);
  INSERT INTO public.hosted_voiceover_contexts(id,account_id,workspace_id,project_id,
    project_revision_id,asr_attempt_id,task_id,attempt_id,outbox_id,execution_profile_id,state,
    transcript_hash,request_hash,claim_token_hash,reserved_cost_micro_usd,
    reservation_cost_sequence)
  VALUES(context_id,account_id,workspace_id,project_id,revision_id,asr_attempt_id,task_id,
    attempt_id,outbox_id,profile_id,'DISPATCHING',transcript_hash,request_hash,claim_hash,10000,
    reservation_sequence);
  RETURN jsonb_build_object('created',true,'state','DISPATCHING','context_id',context_id,
    'task_id',task_id,'attempt_id',attempt_id,'outbox_id',outbox_id);
END;
$$;

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
  IF existing.redispatch_count >= 18 THEN
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

CREATE OR REPLACE FUNCTION public.videoforge_prepare_hosted_prompt_run(supplied jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
#variable_conflict use_variable
DECLARE
  account_id uuid:=(supplied->>'account_id')::uuid;
  workspace_id uuid:=(supplied->>'workspace_id')::uuid;
  user_id uuid:=(supplied->>'user_id')::uuid;
  project_id uuid:=(supplied->>'project_id')::uuid;
  revision_id uuid:=(supplied->>'revision_id')::uuid;
  timeline_id uuid:=(supplied->>'timeline_id')::uuid;
  task_id uuid:=(supplied->>'task_id')::uuid;
  attempt_id uuid:=(supplied->>'attempt_id')::uuid;
  outbox_id uuid:=(supplied->>'outbox_id')::uuid;
  requested_profile_id uuid:=(supplied->>'execution_profile_id')::uuid;
  profile_id uuid;
  cost_id uuid:=(supplied->>'reservation_cost_event_id')::uuid;
  run_id uuid:=(supplied->>'run_id')::uuid;
  input_hash text:=supplied->>'input_hash';
  claim_hash text:=supplied->>'claim_token_hash';
  timeline_hash text:=supplied->>'timeline_hash';
  batch_plan_hash text:=supplied->>'batch_plan_hash';
  planned_batch_count integer;
  planned_scene_count integer;
  expected_scene_count integer;
  redispatch boolean:=coalesce((supplied->>'redispatch')::boolean, false);
  existing public.hosted_prompt_runs%ROWTYPE;
  existing_profile public.execution_profiles%ROWTYPE;
  context_task_id uuid;
  reservation_sequence integer;
  now_at timestamptz:=clock_timestamp();
  profile_config jsonb:='{"model":"google:gemma@4-31b","operation":"scene-prompt-writer-v2","provider":"runware"}'::jsonb;
  profile_config_hash text:='sha256:'||encode(digest(convert_to(profile_config::text,'UTF8'),'sha256'),'hex');
  outbox_payload jsonb;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM account_id
     OR input_hash !~ '^sha256:[0-9a-f]{64}$' OR claim_hash !~ '^sha256:[0-9a-f]{64}$'
     OR timeline_hash !~ '^sha256:[0-9a-f]{64}$'
     OR batch_plan_hash !~ '^sha256:[0-9a-f]{64}$'
     OR (supplied->>'reserved_cost_micro_usd')::bigint<>40000
     OR (supplied->>'planned_batch_count') IS NULL
     OR (supplied->>'planned_scene_count') IS NULL
     OR (supplied->>'planned_batch_count') !~ '^[1-9][0-9]*$'
     OR (supplied->>'planned_scene_count') !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'hosted prompt authority is invalid' USING ERRCODE='42501';
  END IF;
  IF (supplied->>'planned_batch_count')::numeric>2147483647
     OR (supplied->>'planned_scene_count')::numeric>2147483647 THEN
    RAISE EXCEPTION 'hosted prompt authority is invalid' USING ERRCODE='42501';
  END IF;
  planned_batch_count:=(supplied->>'planned_batch_count')::integer;
  planned_scene_count:=(supplied->>'planned_scene_count')::integer;
  IF planned_batch_count>planned_scene_count THEN
    RAISE EXCEPTION 'hosted prompt authority is invalid' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships membership
     WHERE membership.account_id=account_id AND membership.workspace_id=workspace_id
       AND membership.user_id=user_id AND membership.status='ACTIVE'
  ) THEN
    RAISE EXCEPTION 'hosted prompt plan is not executable' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::integer INTO expected_scene_count
    FROM public.timeline_segments segment
   WHERE segment.account_id=account_id AND segment.workspace_id=workspace_id
     AND segment.project_revision_id=revision_id AND segment.timeline_plan_id=timeline_id
     AND segment.timeline_composition IN ('IMAGE_FULL','AVATAR_SPLIT_IMAGE');
  IF NOT EXISTS (
       SELECT 1 FROM public.project_revisions revision
       JOIN public.revision_timing_heads head ON head.account_id=revision.account_id
        AND head.workspace_id=revision.workspace_id AND head.project_revision_id=revision.id
       JOIN public.timeline_plans plan ON plan.account_id=head.account_id
        AND plan.workspace_id=head.workspace_id AND plan.project_revision_id=head.project_revision_id
        AND plan.id=head.current_timeline_plan_id
       JOIN public.image_style_versions style ON style.account_id=revision.account_id
        AND style.workspace_id=revision.workspace_id AND style.id=revision.image_style_version_id
      WHERE revision.account_id=account_id AND revision.workspace_id=workspace_id
        AND revision.project_id=project_id AND revision.id=revision_id
        AND revision.status='LOCKED' AND head.current_timeline_plan_id=timeline_id
        AND plan.canonical_document_hash=timeline_hash
        AND style.state='PUBLISHED' AND style.style_profile_hash=revision.style_profile_hash
        AND TRUE
     ) OR expected_scene_count<>planned_scene_count THEN
    RAISE EXCEPTION 'hosted prompt plan is not executable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.hosted_voiceover_contexts context
     WHERE context.account_id=account_id AND context.workspace_id=workspace_id
       AND context.project_id=project_id AND context.project_revision_id=revision_id
       AND context.state='SUCCEEDED'
  ) THEN
    RAISE EXCEPTION 'hosted prompt plan is not executable' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.workspaces workspace
   WHERE workspace.account_id=account_id AND workspace.id=workspace_id FOR UPDATE;
  PERFORM 1 FROM public.project_revisions revision
   WHERE revision.account_id=account_id AND revision.workspace_id=workspace_id
     AND revision.id=revision_id FOR UPDATE;
  SELECT * INTO existing FROM public.hosted_prompt_runs run
   WHERE run.account_id=account_id AND run.workspace_id=workspace_id
     AND run.project_revision_id=revision_id FOR UPDATE;
  IF existing.id IS NOT NULL AND NOT redispatch THEN
    RETURN jsonb_build_object('created',false,'state',existing.state,'run_id',existing.id,
      'task_id',existing.task_id,'attempt_id',existing.attempt_id,'outbox_id',existing.outbox_id,
      'planned_batch_count',existing.planned_batch_count,
      'planned_scene_count',existing.planned_scene_count,
      'batch_plan_hash',existing.batch_plan_hash);
  END IF;
  INSERT INTO public.execution_profiles(id,account_id,workspace_id,name,revision,lane,state,
    dispatch_target,configuration,configuration_hash,maximum_rate_micro_usd,checked_at,created_at)
  VALUES(requested_profile_id,account_id,workspace_id,'Hosted Runware scene prompts',4,'PROMPT',
    'TESTED','RUNWARE',profile_config,profile_config_hash,40000,now_at,now_at)
  ON CONFLICT ON CONSTRAINT execution_profiles_workspace_id_name_revision_key DO NOTHING;
  SELECT * INTO existing_profile FROM public.execution_profiles profile
   WHERE profile.account_id=account_id AND profile.workspace_id=workspace_id
     AND profile.name='Hosted Runware scene prompts' AND profile.revision=4 FOR SHARE;
  IF existing_profile.id IS NULL OR existing_profile.lane<>'PROMPT'
     OR existing_profile.state<>'TESTED' OR existing_profile.dispatch_target<>'RUNWARE'
     OR existing_profile.configuration IS DISTINCT FROM profile_config
     OR existing_profile.configuration_hash<>profile_config_hash
     OR existing_profile.maximum_rate_micro_usd<>40000 THEN
    RAISE EXCEPTION 'hosted prompt execution profile drifted' USING ERRCODE='23514';
  END IF;
  profile_id:=existing_profile.id;
  SELECT context.task_id INTO context_task_id FROM public.hosted_voiceover_contexts context
   WHERE context.account_id=account_id AND context.workspace_id=workspace_id
     AND context.project_revision_id=revision_id AND context.state='SUCCEEDED';
  SELECT coalesce(max(event.sequence),0)+1 INTO reservation_sequence
    FROM public.cost_events event WHERE event.workspace_id=workspace_id
     AND event.owner_type='PROJECT_REVISION' AND event.owner_id=revision_id;
  outbox_payload:=jsonb_build_object(
    'batch_mode','adaptive','planned_batch_count',planned_batch_count,
    'planned_scene_count',planned_scene_count,'batch_plan_hash',batch_plan_hash,
    'continuity_tags',jsonb_build_array()
  );
  INSERT INTO public.generation_tasks(id,account_id,workspace_id,owner_type,owner_id,
    project_revision_id,task_key,lane,state,required,depends_on,created_at,updated_at)
  VALUES(task_id,account_id,workspace_id,'PROJECT_REVISION',revision_id,revision_id,
    'prompt:scene-batch:1'||CASE WHEN redispatch THEN ':'||attempt_id::text ELSE '' END,
    'PROMPT','RUNNING',true,jsonb_build_array(context_task_id),now_at,now_at);
  INSERT INTO public.attempts(id,account_id,workspace_id,task_id,ordinal,idempotency_key,state,
    dispatch_state,claim_state,execution_profile_id,execution_claim_token_hash,input_hash,
    result_disposition,provider_details,created_at,claimed_at,started_at)
  VALUES(attempt_id,account_id,workspace_id,task_id,1,'hosted-prompt:'||revision_id||CASE WHEN redispatch THEN ':'||attempt_id::text ELSE '' END,
    'RUNNING','ACKNOWLEDGED','CLAIMED',profile_id,claim_hash,input_hash,'PENDING',
    jsonb_build_object('provider','runware','model','google:gemma@4-31b',
      'operation','scene-prompt-writer-v2'),now_at,now_at,now_at);
  INSERT INTO public.outbox(id,account_id,workspace_id,task_id,attempt_id,kind,state,dedupe_key,
    payload_contract_name,payload_contract_version,payload_hash,payload,available_at,delivered_at,
    created_at,updated_at)
  VALUES(outbox_id,account_id,workspace_id,task_id,attempt_id,'DISPATCH','DELIVERED',
    'hosted-prompt:'||revision_id||CASE WHEN redispatch THEN ':'||attempt_id::text ELSE '' END,'prompt-execution-dispatch','v1',
    'sha256:'||encode(digest(convert_to(outbox_payload::text,'UTF8'),'sha256'),'hex'),
    outbox_payload,now_at,now_at,now_at,now_at);
  INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
    sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
  VALUES(cost_id,account_id,workspace_id,'PROJECT_REVISION',revision_id,task_id,attempt_id,
    reservation_sequence,'RESERVED',40000,'hosted-prompt:'||revision_id||':reserved'||CASE WHEN redispatch THEN ':'||attempt_id::text ELSE '' END,
    jsonb_build_object('provider','runware','model','google:gemma@4-31b',
      'operation','scene-prompt-writer-v2'),now_at);
  INSERT INTO public.hosted_prompt_runs(id,account_id,workspace_id,project_id,project_revision_id,
    timeline_plan_id,task_id,attempt_id,outbox_id,execution_profile_id,state,input_hash,
    claim_token_hash,reserved_cost_micro_usd,reservation_cost_sequence,
    planned_batch_count,planned_scene_count,batch_plan_hash,started_at,created_at)
  VALUES(run_id,account_id,workspace_id,project_id,revision_id,timeline_id,task_id,attempt_id,
    outbox_id,profile_id,'DISPATCHING',input_hash,claim_hash,40000,reservation_sequence,
    planned_batch_count,planned_scene_count,batch_plan_hash,now_at,now_at);
  RETURN jsonb_build_object('created',true,'state','DISPATCHING','run_id',run_id,
    'task_id',task_id,'attempt_id',attempt_id,'outbox_id',outbox_id,
    'planned_batch_count',planned_batch_count,'planned_scene_count',planned_scene_count,
    'batch_plan_hash',batch_plan_hash);
END;
$function$;
