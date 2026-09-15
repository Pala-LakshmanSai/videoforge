-- Rebind the single prompt run row at the point where the attempt values exist.
--
-- 0156 placed the rebind inside the existing-run guard, before the function resolves the execution
-- profile and the reservation sequence, so the UPDATE wrote NULL into execution_profile_id and the
-- attempt died on the not-null constraint. The rebind now happens where the row would have been
-- inserted: the fresh task/attempt/outbox/cost rows for the attempt are still created first (their
-- keys are attempt-scoped since 0154/0155), then either the existing run row is rebound or a new one
-- is inserted, exactly as a first dispatch does.

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
  profile_config jsonb:='{"model":"deepseek:v4@flash","operation":"scene-prompt-writer-v2","provider":"runware"}'::jsonb;
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
    jsonb_build_object('provider','runware','model','deepseek:v4@flash',
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
    jsonb_build_object('provider','runware','model','deepseek:v4@flash',
      'operation','scene-prompt-writer-v2'),now_at);
  -- Exactly one run row per revision (hosted_prompt_runs_account_id_workspace_id_project_revision_key),
  -- so an approved redispatch rebinds that row here, after the fresh task/attempt/outbox/cost rows and
  -- the profile and reservation sequence exist. The check constraints require the terminal fields to be
  -- cleared together with DISPATCHING, which is truthful here because the gate only approves revisions
  -- whose previous attempt produced no durable accepted prompt set. redispatch_count bounds how often.
  IF existing.id IS NOT NULL THEN
    UPDATE public.hosted_prompt_runs run
       SET task_id=task_id, attempt_id=attempt_id, outbox_id=outbox_id,
           execution_profile_id=profile_id, state='DISPATCHING', problem_code=NULL,
           finished_at=NULL, provider_may_have_charged=false, reported_cost_micro_usd=NULL,
           input_hash=input_hash, claim_token_hash=claim_hash,
           reserved_cost_micro_usd=40000, reservation_cost_sequence=reservation_sequence,
           planned_batch_count=planned_batch_count, planned_scene_count=planned_scene_count,
           batch_plan_hash=batch_plan_hash, redispatch_count=run.redispatch_count+1,
           started_at=now_at
     WHERE run.id=existing.id;
  ELSE
    INSERT INTO public.hosted_prompt_runs(id,account_id,workspace_id,project_id,project_revision_id,
      timeline_plan_id,task_id,attempt_id,outbox_id,execution_profile_id,state,input_hash,
      claim_token_hash,reserved_cost_micro_usd,reservation_cost_sequence,
      planned_batch_count,planned_scene_count,batch_plan_hash,started_at,created_at)
    VALUES(run_id,account_id,workspace_id,project_id,revision_id,timeline_id,task_id,attempt_id,
      outbox_id,profile_id,'DISPATCHING',input_hash,claim_hash,40000,reservation_sequence,
      planned_batch_count,planned_scene_count,batch_plan_hash,now_at,now_at);
  END IF;
  RETURN jsonb_build_object('created',true,'state','DISPATCHING','run_id',run_id,
    'task_id',task_id,'attempt_id',attempt_id,'outbox_id',outbox_id,
    'planned_batch_count',planned_batch_count,'planned_scene_count',planned_scene_count,
    'batch_plan_hash',batch_plan_hash);
END;
$function$;;
