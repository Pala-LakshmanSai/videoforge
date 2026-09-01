-- Reuse each workspace's immutable hosted Runware execution profile. Migration 0056 created a
-- fresh profile UUID for every project while the durable schema permits only one name/revision per
-- workspace, so the second project stopped before provider dispatch. These replacements retain the
-- exact provider configuration and fail closed on any existing-profile drift.

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
  profile_config jsonb:='{"model":"deepseek:v4@flash","operation":"voiceover-context-v1","provider":"runware"}'::jsonb;
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
  VALUES(profile_id,account_id,workspace_id,'Hosted Runware voiceover context',1,'PROMPT','TESTED',
    'RUNWARE',profile_config,profile_config_hash,10000,now_at,now_at)
  ON CONFLICT ON CONSTRAINT execution_profiles_workspace_id_name_revision_key DO NOTHING;
  SELECT * INTO existing_profile FROM public.execution_profiles profile
   WHERE profile.account_id=account_id AND profile.workspace_id=workspace_id
     AND profile.name='Hosted Runware voiceover context' AND profile.revision=1 FOR SHARE;
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
    jsonb_build_object('provider','runware','model','deepseek:v4@flash'),now_at,now_at,now_at);
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
    jsonb_build_object('provider','runware','model','deepseek:v4@flash'),now_at);
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

CREATE OR REPLACE FUNCTION public.videoforge_prepare_hosted_prompt_run(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
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
  existing public.hosted_prompt_runs%ROWTYPE;
  existing_profile public.execution_profiles%ROWTYPE;
  context_task_id uuid;
  reservation_sequence integer;
  now_at timestamptz:=clock_timestamp();
  profile_config jsonb:='{"model":"deepseek:v4@flash","operation":"scene-prompt-writer-v1","provider":"runware"}'::jsonb;
  profile_config_hash text:='sha256:'||encode(digest(convert_to(profile_config::text,'UTF8'),'sha256'),'hex');
  outbox_payload jsonb:='{"continuity_tags":[]}'::jsonb;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM account_id
     OR input_hash !~ '^sha256:[0-9a-f]{64}$' OR claim_hash !~ '^sha256:[0-9a-f]{64}$'
     OR (supplied->>'reserved_cost_micro_usd')::bigint<>40000 THEN
    RAISE EXCEPTION 'hosted prompt authority is invalid' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.memberships membership WHERE membership.account_id=account_id
      AND membership.workspace_id=workspace_id AND membership.user_id=user_id
      AND membership.status='ACTIVE')
     OR NOT EXISTS (SELECT 1 FROM public.project_revisions revision
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
        AND plan.canonical_document_hash=supplied->>'timeline_hash'
        AND style.state='PUBLISHED' AND style.style_profile_hash=revision.style_profile_hash
        AND revision.maximum_cost_micro_usd>=50000)
     OR NOT EXISTS (SELECT 1 FROM public.hosted_voiceover_contexts context
       WHERE context.account_id=account_id AND context.workspace_id=workspace_id
         AND context.project_id=project_id AND context.project_revision_id=revision_id
         AND context.state='SUCCEEDED')
     OR (SELECT count(*) FROM public.timeline_segments segment WHERE segment.account_id=account_id
       AND segment.workspace_id=workspace_id AND segment.project_revision_id=revision_id
       AND segment.timeline_plan_id=timeline_id
       AND segment.timeline_composition IN ('IMAGE_FULL','AVATAR_SPLIT_IMAGE')) NOT BETWEEN 25 AND 50 THEN
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
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('created',false,'state',existing.state,'run_id',existing.id,
      'task_id',existing.task_id,'attempt_id',existing.attempt_id,'outbox_id',existing.outbox_id);
  END IF;
  profile_id:=requested_profile_id;
  INSERT INTO public.execution_profiles(id,account_id,workspace_id,name,revision,lane,state,
    dispatch_target,configuration,configuration_hash,maximum_rate_micro_usd,checked_at,created_at)
  VALUES(profile_id,account_id,workspace_id,'Hosted Runware scene prompts',1,'PROMPT','TESTED',
    'RUNWARE',profile_config,profile_config_hash,40000,now_at,now_at)
  ON CONFLICT ON CONSTRAINT execution_profiles_workspace_id_name_revision_key DO NOTHING;
  SELECT * INTO existing_profile FROM public.execution_profiles profile
   WHERE profile.account_id=account_id AND profile.workspace_id=workspace_id
     AND profile.name='Hosted Runware scene prompts' AND profile.revision=1 FOR SHARE;
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
  INSERT INTO public.generation_tasks(id,account_id,workspace_id,owner_type,owner_id,
    project_revision_id,task_key,lane,state,required,depends_on,created_at,updated_at)
  VALUES(task_id,account_id,workspace_id,'PROJECT_REVISION',revision_id,revision_id,
    'prompt:scene-batch:1','PROMPT','RUNNING',true,jsonb_build_array(context_task_id),now_at,now_at);
  INSERT INTO public.attempts(id,account_id,workspace_id,task_id,ordinal,idempotency_key,state,
    dispatch_state,claim_state,execution_profile_id,execution_claim_token_hash,input_hash,
    result_disposition,provider_details,created_at,claimed_at,started_at)
  VALUES(attempt_id,account_id,workspace_id,task_id,1,'hosted-prompt:'||revision_id,
    'RUNNING','ACKNOWLEDGED','CLAIMED',profile_id,claim_hash,input_hash,'PENDING',
    jsonb_build_object('provider','runware','model','deepseek:v4@flash'),now_at,now_at,now_at);
  INSERT INTO public.outbox(id,account_id,workspace_id,task_id,attempt_id,kind,state,dedupe_key,
    payload_contract_name,payload_contract_version,payload_hash,payload,available_at,delivered_at,
    created_at,updated_at)
  VALUES(outbox_id,account_id,workspace_id,task_id,attempt_id,'DISPATCH','DELIVERED',
    'hosted-prompt:'||revision_id,'prompt-execution-dispatch','v1',
    'sha256:'||encode(digest(convert_to(outbox_payload::text,'UTF8'),'sha256'),'hex'),
    outbox_payload,now_at,now_at,now_at,now_at);
  INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
    sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
  VALUES(cost_id,account_id,workspace_id,'PROJECT_REVISION',revision_id,task_id,attempt_id,
    reservation_sequence,'RESERVED',40000,'hosted-prompt:'||revision_id||':reserved',
    jsonb_build_object('provider','runware','model','deepseek:v4@flash'),now_at);
  INSERT INTO public.hosted_prompt_runs(id,account_id,workspace_id,project_id,project_revision_id,
    timeline_plan_id,task_id,attempt_id,outbox_id,execution_profile_id,state,input_hash,
    claim_token_hash,reserved_cost_micro_usd,reservation_cost_sequence,started_at,created_at)
  VALUES(run_id,account_id,workspace_id,project_id,revision_id,timeline_id,task_id,attempt_id,
    outbox_id,profile_id,'DISPATCHING',input_hash,claim_hash,40000,reservation_sequence,now_at,now_at);
  RETURN jsonb_build_object('created',true,'state','DISPATCHING','run_id',run_id,
    'task_id',task_id,'attempt_id',attempt_id,'outbox_id',outbox_id);
END;
$$;
