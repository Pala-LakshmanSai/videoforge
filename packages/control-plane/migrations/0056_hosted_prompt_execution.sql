-- Private hosted-beta story-context and prompt execution. The runtime receives only seven narrow
-- functions to create/close one context claim and then load/create/close one prompt claim. It never
-- receives direct prompt/task/attempt/outbox/cost table DML.

ALTER TABLE public.execution_profiles
  DROP CONSTRAINT execution_profiles_lane_check;
ALTER TABLE public.execution_profiles
  ADD CONSTRAINT execution_profiles_lane_check CHECK (
    lane IN ('LOCAL_MEDIA','IMAGE_MEDIA','AVATAR_PRIMARY','AVATAR_REPAIR','AVATAR_QUALITY','PROMPT')
  );

CREATE TABLE public.hosted_voiceover_contexts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  asr_attempt_id uuid NOT NULL,
  task_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  outbox_id uuid NOT NULL,
  outbox_kind text GENERATED ALWAYS AS ('DISPATCH') STORED,
  execution_profile_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('DISPATCHING','SUCCEEDED','FAILED','UNKNOWN')),
  transcript_hash text NOT NULL CHECK (transcript_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  claim_token_hash text NOT NULL CHECK (claim_token_hash ~ '^sha256:[0-9a-f]{64}$'),
  response_hash text CHECK (response_hash IS NULL OR response_hash ~ '^sha256:[0-9a-f]{64}$'),
  context_hash text CHECK (context_hash IS NULL OR context_hash ~ '^sha256:[0-9a-f]{64}$'),
  context_document jsonb,
  reserved_cost_micro_usd bigint NOT NULL CHECK (reserved_cost_micro_usd = 10000),
  reservation_cost_sequence integer NOT NULL CHECK (reservation_cost_sequence > 0),
  reported_cost_micro_usd bigint CHECK (
    reported_cost_micro_usd IS NULL OR
    reported_cost_micro_usd BETWEEN 0 AND reserved_cost_micro_usd
  ),
  problem_code text,
  provider_may_have_charged boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, project_revision_id),
  UNIQUE (account_id, workspace_id, task_id),
  UNIQUE (account_id, workspace_id, attempt_id),
  UNIQUE (account_id, workspace_id, outbox_id),
  FOREIGN KEY (account_id, workspace_id) REFERENCES public.workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_id)
    REFERENCES public.projects (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_revision_id)
    REFERENCES public.project_revisions (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, asr_attempt_id)
    REFERENCES public.hosted_cpu_job_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id)
    REFERENCES public.generation_tasks (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id, attempt_id)
    REFERENCES public.attempts (workspace_id, task_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id, attempt_id, outbox_id, outbox_kind)
    REFERENCES public.outbox (workspace_id, task_id, attempt_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, execution_profile_id)
    REFERENCES public.execution_profiles (workspace_id, id) ON DELETE RESTRICT,
  CHECK ((state = 'DISPATCHING') = (finished_at IS NULL)),
  CHECK ((state = 'SUCCEEDED') = (
    context_document IS NOT NULL AND context_hash IS NOT NULL AND response_hash IS NOT NULL
    AND reported_cost_micro_usd IS NOT NULL
  )),
  CHECK ((state IN ('FAILED','UNKNOWN')) = (problem_code IS NOT NULL)),
  CHECK (provider_may_have_charged = (state = 'UNKNOWN'))
);

CREATE TRIGGER hosted_voiceover_contexts_tenant_write_guard
  BEFORE INSERT OR UPDATE ON public.hosted_voiceover_contexts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_voiceover_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_voiceover_contexts FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_voiceover_contexts_tenant_rls ON public.hosted_voiceover_contexts
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE FUNCTION public.videoforge_prepare_hosted_voiceover_context(supplied jsonb) RETURNS jsonb
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
  profile_id uuid:=(supplied->>'execution_profile_id')::uuid;
  cost_id uuid:=(supplied->>'reservation_cost_event_id')::uuid;
  transcript_hash text:=supplied->>'transcript_hash';
  request_hash text:=supplied->>'request_hash';
  claim_hash text:=supplied->>'claim_token_hash';
  existing public.hosted_voiceover_contexts%ROWTYPE;
  reservation_sequence integer;
  now_at timestamptz:=clock_timestamp();
  profile_config jsonb:='{"model":"deepseek:v4@flash","operation":"voiceover-context-v1","provider":"runware"}'::jsonb;
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
  SELECT * INTO existing FROM public.hosted_voiceover_contexts context
   WHERE context.account_id=account_id AND context.workspace_id=workspace_id
     AND context.project_revision_id=revision_id FOR UPDATE;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('created',false,'state',existing.state,'context_id',existing.id,
      'task_id',existing.task_id,'attempt_id',existing.attempt_id,'outbox_id',existing.outbox_id);
  END IF;
  PERFORM 1 FROM public.project_revisions revision
   WHERE revision.account_id=account_id AND revision.workspace_id=workspace_id
     AND revision.id=revision_id FOR UPDATE;
  SELECT coalesce(max(event.sequence),0)+1 INTO reservation_sequence
    FROM public.cost_events event WHERE event.workspace_id=workspace_id
     AND event.owner_type='PROJECT_REVISION' AND event.owner_id=revision_id;
  INSERT INTO public.execution_profiles(id,account_id,workspace_id,name,revision,lane,state,
    dispatch_target,configuration,configuration_hash,maximum_rate_micro_usd,checked_at,created_at)
  VALUES(profile_id,account_id,workspace_id,'Hosted Runware voiceover context',1,'PROMPT','TESTED',
    'RUNWARE',profile_config,
    'sha256:'||encode(digest(convert_to(profile_config::text,'UTF8'),'sha256'),'hex'),
    10000,now_at,now_at);
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

CREATE FUNCTION public.videoforge_complete_hosted_voiceover_context(supplied jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  context public.hosted_voiceover_contexts%ROWTYPE;
  context_bytes text:=supplied->>'context_bytes';
  response_bytes text:=supplied->>'response_bytes';
  context_hash text:=supplied->>'context_hash';
  response_hash text:=supplied->>'response_hash';
  reported bigint:=(supplied->>'reported_cost_micro_usd')::bigint;
  output_asset_id uuid:=(supplied->>'output_asset_id')::uuid;
  now_at timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO context FROM public.hosted_voiceover_contexts
   WHERE id=(supplied->>'context_id')::uuid FOR UPDATE;
  IF context.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM context.account_id
     OR context.state<>'DISPATCHING' OR reported NOT BETWEEN 0 AND context.reserved_cost_micro_usd
     OR context_hash IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(context_bytes,'UTF8'),'sha256'),'hex')
     OR response_hash IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(response_bytes,'UTF8'),'sha256'),'hex')
     OR context_bytes::jsonb IS NULL OR jsonb_typeof(context_bytes::jsonb)<>'object' THEN
    RAISE EXCEPTION 'hosted voiceover context acceptance is invalid' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.assets(id,account_id,workspace_id,project_id,project_revision_id,kind,state,
    canonical_contract_name,canonical_contract_version,canonical_document_sha256,content_type,
    byte_size,metadata,verified_at,created_at)
  VALUES(output_asset_id,context.account_id,context.workspace_id,context.project_id,
    context.project_revision_id,'CANONICAL_DOCUMENT','ACCEPTED','voiceover-story-context','v1',
    context_hash,'application/json',octet_length(context_bytes),
    jsonb_build_object('source','hosted-voiceover-context'),now_at,now_at);
  INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
    sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at,created_at)
  VALUES(gen_random_uuid(),context.account_id,context.workspace_id,'PROJECT_REVISION',
    context.project_revision_id,context.task_id,context.attempt_id,
    context.reservation_cost_sequence+1,'REPORTED',reported,
    'hosted-voiceover-context:'||context.project_revision_id||':reported',
    jsonb_build_object('context_hash',context_hash),now_at,now_at),
    (gen_random_uuid(),context.account_id,context.workspace_id,'PROJECT_REVISION',
    context.project_revision_id,context.task_id,context.attempt_id,
    context.reservation_cost_sequence+2,'SETTLED',reported,
    'hosted-voiceover-context:'||context.project_revision_id||':settled',
    jsonb_build_object('context_hash',context_hash),now_at,now_at);
  UPDATE public.attempts SET state='SUCCEEDED',output_asset_id=output_asset_id,
    result_disposition='ACCEPTED',finished_at=now_at WHERE workspace_id=context.workspace_id
    AND task_id=context.task_id AND id=context.attempt_id;
  UPDATE public.generation_tasks SET state='COMPLETE',accepted_attempt_id=context.attempt_id,
    version=version+1,finished_at=now_at,updated_at=now_at
    WHERE workspace_id=context.workspace_id AND id=context.task_id;
  UPDATE public.hosted_voiceover_contexts SET state='SUCCEEDED',context_document=context_bytes::jsonb,
    context_hash=context_hash,response_hash=response_hash,reported_cost_micro_usd=reported,
    finished_at=now_at WHERE id=context.id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.videoforge_fail_hosted_voiceover_context(
  supplied_context_id uuid,
  supplied_state text,
  supplied_problem_code text,
  supplied_provider_may_have_charged boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE context public.hosted_voiceover_contexts%ROWTYPE; now_at timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO context FROM public.hosted_voiceover_contexts
   WHERE id=supplied_context_id FOR UPDATE;
  IF context.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM context.account_id
     OR context.state<>'DISPATCHING' OR supplied_state NOT IN ('FAILED','UNKNOWN')
     OR supplied_problem_code !~ '^[A-Z0-9_]{3,80}$'
     OR supplied_provider_may_have_charged<>(supplied_state='UNKNOWN') THEN
    RAISE EXCEPTION 'hosted voiceover context failure is invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.attempts SET state=CASE supplied_state WHEN 'UNKNOWN' THEN 'UNKNOWN' ELSE 'FAILED' END,
    problem_code=supplied_problem_code,finished_at=now_at WHERE workspace_id=context.workspace_id
    AND task_id=context.task_id AND id=context.attempt_id;
  UPDATE public.generation_tasks SET state='FAILED',version=version+1,finished_at=now_at,
    updated_at=now_at WHERE workspace_id=context.workspace_id AND id=context.task_id;
  UPDATE public.hosted_voiceover_contexts SET state=supplied_state,
    problem_code=supplied_problem_code,
    provider_may_have_charged=supplied_provider_may_have_charged,
    finished_at=now_at WHERE id=context.id;
  IF supplied_state='FAILED' THEN
    INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
      sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
    VALUES(gen_random_uuid(),context.account_id,context.workspace_id,'PROJECT_REVISION',
      context.project_revision_id,context.task_id,context.attempt_id,
      context.reservation_cost_sequence+1,'RELEASED',context.reserved_cost_micro_usd,
      'hosted-voiceover-context:'||context.project_revision_id||':released',
      jsonb_build_object('problem_code',supplied_problem_code),now_at);
  END IF;
  RETURN true;
END;
$$;

-- Migration 0052 created the tenant-owned style-analysis ledger after the general tenant cutover.
-- Bring it under the same immutable account/write guard before adding the prompt ledger.
CREATE TRIGGER hosted_style_analysis_runs_tenant_write_guard
  BEFORE INSERT OR UPDATE ON public.hosted_style_analysis_runs
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.execution_profiles
  DROP CONSTRAINT execution_profiles_dispatch_target_check;
ALTER TABLE public.execution_profiles
  ADD CONSTRAINT execution_profiles_dispatch_target_check CHECK (
    dispatch_target IN ('FIXTURE','LOCAL','RUNPOD','RUNWARE')
  );

CREATE TABLE public.hosted_prompt_runs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  timeline_plan_id uuid NOT NULL,
  task_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  outbox_id uuid NOT NULL,
  outbox_kind text GENERATED ALWAYS AS ('DISPATCH') STORED,
  execution_profile_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('DISPATCHING','SUCCEEDED','FAILED','UNKNOWN')),
  input_hash text NOT NULL CHECK (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  claim_token_hash text NOT NULL CHECK (claim_token_hash ~ '^sha256:[0-9a-f]{64}$'),
  reserved_cost_micro_usd bigint NOT NULL CHECK (reserved_cost_micro_usd = 40000),
  reservation_cost_sequence integer NOT NULL CHECK (reservation_cost_sequence > 0),
  reported_cost_micro_usd bigint CHECK (
    reported_cost_micro_usd IS NULL OR
    reported_cost_micro_usd BETWEEN 0 AND reserved_cost_micro_usd
  ),
  acceptance_fingerprint_hash text CHECK (
    acceptance_fingerprint_hash IS NULL OR
    acceptance_fingerprint_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  problem_code text,
  provider_may_have_charged boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, project_revision_id),
  UNIQUE (account_id, workspace_id, task_id),
  UNIQUE (account_id, workspace_id, attempt_id),
  UNIQUE (account_id, workspace_id, outbox_id),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES public.workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_id)
    REFERENCES public.projects (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_revision_id)
    REFERENCES public.project_revisions (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_revision_id, timeline_plan_id)
    REFERENCES public.timeline_plans (workspace_id, project_revision_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id)
    REFERENCES public.generation_tasks (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id, attempt_id)
    REFERENCES public.attempts (workspace_id, task_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id, attempt_id, outbox_id, outbox_kind)
    REFERENCES public.outbox (workspace_id, task_id, attempt_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, execution_profile_id)
    REFERENCES public.execution_profiles (workspace_id, id) ON DELETE RESTRICT,
  CHECK ((state = 'DISPATCHING') = (finished_at IS NULL)),
  CHECK ((state = 'SUCCEEDED') = (acceptance_fingerprint_hash IS NOT NULL)),
  CHECK ((state IN ('FAILED','UNKNOWN')) = (problem_code IS NOT NULL)),
  CHECK (provider_may_have_charged = (state = 'UNKNOWN'))
);

CREATE TRIGGER hosted_prompt_runs_tenant_write_guard
  BEFORE INSERT OR UPDATE ON public.hosted_prompt_runs
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_prompt_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_prompt_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_prompt_runs_tenant_rls ON public.hosted_prompt_runs
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE FUNCTION public.videoforge_load_hosted_prompt_plan(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_user_id uuid,
  supplied_project_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR NOT EXISTS (
       SELECT 1 FROM public.memberships membership
        WHERE membership.account_id=supplied_account_id
          AND membership.workspace_id=supplied_workspace_id
          AND membership.user_id=supplied_user_id AND membership.status='ACTIVE'
     ) THEN
    RAISE EXCEPTION 'hosted prompt plan scope is invalid' USING ERRCODE='42501';
  END IF;
  WITH selected AS (
    SELECT revision.id revision_id,revision.title,revision.status revision_state,
           revision.image_style_version_id,revision.style_profile_hash revision_style_hash,
           revision.extra_prompt_keywords,revision.apply_extra_prompt_keywords,
           (revision.revision_config_payload->>'spend_cap_usd')::numeric spend_cap_usd,
           head.current_timeline_plan_id timeline_id,plan.canonical_document_hash timeline_hash,
           style.state style_state,style.style_profile_hash,style.profile_payload
      FROM public.projects project
      JOIN public.project_revisions revision
        ON revision.account_id=project.account_id AND revision.workspace_id=project.workspace_id
       AND revision.project_id=project.id
      JOIN public.revision_timing_heads head
        ON head.account_id=revision.account_id AND head.workspace_id=revision.workspace_id
       AND head.project_revision_id=revision.id
      JOIN public.timeline_plans plan
        ON plan.account_id=head.account_id AND plan.workspace_id=head.workspace_id
       AND plan.project_revision_id=head.project_revision_id
       AND plan.id=head.current_timeline_plan_id
      JOIN public.image_style_versions style
        ON style.account_id=revision.account_id AND style.workspace_id=revision.workspace_id
       AND style.id=revision.image_style_version_id
      JOIN public.hosted_voiceover_contexts context
        ON context.account_id=revision.account_id AND context.workspace_id=revision.workspace_id
       AND context.project_revision_id=revision.id AND context.state='SUCCEEDED'
     WHERE project.account_id=supplied_account_id AND project.workspace_id=supplied_workspace_id
       AND project.id=supplied_project_id
     ORDER BY plan.plan_sequence DESC LIMIT 1
  ), ordered_segments AS (
    SELECT segment.*,lag(segment.narration) OVER(ORDER BY segment.segment_index) prior_narration,
           lead(segment.narration) OVER(ORDER BY segment.segment_index) next_narration
      FROM public.timeline_segments segment JOIN selected
        ON segment.account_id=supplied_account_id AND segment.workspace_id=supplied_workspace_id
       AND segment.project_revision_id=selected.revision_id
       AND segment.timeline_plan_id=selected.timeline_id
  )
  SELECT jsonb_build_object(
    'workspace_id',supplied_workspace_id,'project_id',supplied_project_id,
    'revision_id',selected.revision_id,'project_title',selected.title,
    'revision_state',selected.revision_state,'timeline_id',selected.timeline_id,
    'timeline_hash',selected.timeline_hash,
    'image_style_version_id',selected.image_style_version_id,
    'revision_style_hash',selected.revision_style_hash,
    'style_state',selected.style_state,'style_profile_hash',selected.style_profile_hash,
    'profile_payload',selected.profile_payload,
    'story_context',(SELECT context.context_document::text FROM public.hosted_voiceover_contexts context
      WHERE context.account_id=supplied_account_id AND context.workspace_id=supplied_workspace_id
        AND context.project_revision_id=selected.revision_id AND context.state='SUCCEEDED'),
    'extra_prompt_keywords',selected.extra_prompt_keywords,
    'apply_extra_prompt_keywords',selected.apply_extra_prompt_keywords,
    'spend_cap_usd',selected.spend_cap_usd,
    'existing_run_state',(SELECT run.state FROM public.hosted_prompt_runs run
      WHERE run.account_id=supplied_account_id AND run.workspace_id=supplied_workspace_id
        AND run.project_revision_id=selected.revision_id),
    'all_segments',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'scene_id',segment_key,'segment_index',segment_index,'phrase',narration)
      ORDER BY segment_index) FROM ordered_segments),'[]'::jsonb),
    'scenes',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'scene_id',segment_key,'phrase',narration,'prior_context',prior_narration,
      'next_context',next_narration,'in_image_shot_role',in_image_shot_role,
      'layout',CASE timeline_composition WHEN 'IMAGE_FULL' THEN 'IMAGE_FULL'
                ELSE 'SPLIT_RIGHT_IMAGE' END) ORDER BY segment_index)
      FROM ordered_segments WHERE timeline_composition IN ('IMAGE_FULL','AVATAR_SPLIT_IMAGE')),'[]'::jsonb)
  ) INTO result FROM selected;
  RETURN result;
END;
$$;

CREATE FUNCTION public.videoforge_prepare_hosted_prompt_run(supplied jsonb) RETURNS jsonb
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
  profile_id uuid:=(supplied->>'execution_profile_id')::uuid;
  cost_id uuid:=(supplied->>'reservation_cost_event_id')::uuid;
  run_id uuid:=(supplied->>'run_id')::uuid;
  input_hash text:=supplied->>'input_hash';
  claim_hash text:=supplied->>'claim_token_hash';
  existing public.hosted_prompt_runs%ROWTYPE;
  context_task_id uuid;
  reservation_sequence integer;
  now_at timestamptz:=clock_timestamp();
  profile_config jsonb:='{"model":"deepseek:v4@flash","operation":"scene-prompt-writer-v1","provider":"runware"}'::jsonb;
  outbox_payload jsonb:='{"continuity_tags":[]}'::jsonb;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM account_id
     OR input_hash !~ '^sha256:[0-9a-f]{64}$' OR claim_hash !~ '^sha256:[0-9a-f]{64}$'
     OR (supplied->>'reserved_cost_micro_usd')::bigint<>40000 THEN
    RAISE EXCEPTION 'hosted prompt authority is invalid' USING ERRCODE='42501';
  END IF;
  SELECT * INTO existing FROM public.hosted_prompt_runs run
   WHERE run.account_id=account_id AND run.workspace_id=workspace_id
     AND run.project_revision_id=revision_id FOR UPDATE;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('created',false,'state',existing.state,'run_id',existing.id,
      'task_id',existing.task_id,'attempt_id',existing.attempt_id,'outbox_id',existing.outbox_id);
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
  PERFORM 1 FROM public.project_revisions revision
   WHERE revision.account_id=account_id AND revision.workspace_id=workspace_id
     AND revision.id=revision_id FOR UPDATE;
  SELECT context.task_id INTO context_task_id FROM public.hosted_voiceover_contexts context
   WHERE context.account_id=account_id AND context.workspace_id=workspace_id
     AND context.project_revision_id=revision_id AND context.state='SUCCEEDED';
  SELECT coalesce(max(event.sequence),0)+1 INTO reservation_sequence
    FROM public.cost_events event WHERE event.workspace_id=workspace_id
     AND event.owner_type='PROJECT_REVISION' AND event.owner_id=revision_id;
  INSERT INTO public.execution_profiles(id,account_id,workspace_id,name,revision,lane,state,
    dispatch_target,configuration,configuration_hash,maximum_rate_micro_usd,checked_at,created_at)
  VALUES(profile_id,account_id,workspace_id,'Hosted Runware scene prompts',1,'PROMPT','TESTED',
    'RUNWARE',profile_config,'sha256:'||encode(digest(convert_to(profile_config::text,'UTF8'),'sha256'),'hex'),
    40000,now_at,now_at);
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
    reservation_sequence,
    'RESERVED',40000,'hosted-prompt:'||revision_id||':reserved',
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

CREATE FUNCTION public.videoforge_complete_hosted_prompt_run(supplied jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  run public.hosted_prompt_runs%ROWTYPE;
  acceptance jsonb:=supplied->'acceptance';
  writer_attempt jsonb;
  compiled jsonb;
  writer_row jsonb;
  compiled_ordinal integer:=0;
  v_output_asset_id uuid:=(supplied->>'output_asset_id')::uuid;
  execution_id uuid:=(supplied->>'prompt_execution_id')::uuid;
  accepted_at timestamptz:=(acceptance->>'acceptedAt')::timestamptz;
  reported bigint:=(acceptance->>'reportedCostMicroUsd')::bigint;
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=(supplied->>'run_id')::uuid FOR UPDATE;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id
     OR run.state<>'DISPATCHING' OR acceptance->>'workspaceId'<>run.workspace_id::text
     OR acceptance->>'projectId'<>run.project_id::text
     OR acceptance->>'revisionId'<>run.project_revision_id::text
     OR acceptance->>'timelineId'<>run.timeline_plan_id::text
     OR acceptance->>'taskId'<>run.task_id::text OR acceptance->>'attemptId'<>run.attempt_id::text
     OR acceptance->>'outboxId'<>run.outbox_id::text OR acceptance->>'inputHash'<>run.input_hash
     OR acceptance->>'schemaVersion'<>'videoforge.durable-prompt-execution/v1'
     OR acceptance->>'acceptanceFingerprintHash' !~ '^sha256:[0-9a-f]{64}$'
     OR reported NOT BETWEEN 0 AND run.reserved_cost_micro_usd
     OR jsonb_array_length(acceptance->'writerAttempts') NOT BETWEEN 1 AND 2
     OR jsonb_array_length(acceptance->'compiledPrompts')<>(SELECT count(*) FROM public.timeline_segments s
       WHERE s.account_id=run.account_id AND s.workspace_id=run.workspace_id
         AND s.project_revision_id=run.project_revision_id AND s.timeline_plan_id=run.timeline_plan_id
         AND s.timeline_composition IN ('IMAGE_FULL','AVATAR_SPLIT_IMAGE')) THEN
    RAISE EXCEPTION 'hosted prompt acceptance is invalid' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.assets(id,account_id,workspace_id,project_id,project_revision_id,kind,state,
    canonical_contract_name,canonical_contract_version,canonical_document_sha256,content_type,
    byte_size,metadata,verified_at,created_at)
  VALUES(v_output_asset_id,run.account_id,run.workspace_id,run.project_id,run.project_revision_id,
    'CANONICAL_DOCUMENT','ACCEPTED','durable-prompt-execution','v1',
    acceptance->>'acceptanceFingerprintHash','application/json',octet_length(acceptance::text),
    jsonb_build_object('source','hosted-prompt-execution','embedded_table','prompt_executions'),
    accepted_at,accepted_at);
  INSERT INTO public.prompt_executions(id,account_id,workspace_id,project_id,project_revision_id,
    timeline_plan_id,image_style_id,image_style_version_id,task_id,attempt_id,outbox_id,
    reservation_cost_event_id,output_asset_id,schema_version,input_hash,request_hash,response_hash,
    compiled_output_hash,acceptance_fingerprint_hash,timeline_hash,style_profile_hash,
    reserved_cost_micro_usd,reported_cost_micro_usd,acceptance_payload,accepted_at,created_at)
  SELECT execution_id,run.account_id,run.workspace_id,run.project_id,run.project_revision_id,
    run.timeline_plan_id,revision.image_style_id,revision.image_style_version_id,run.task_id,
    run.attempt_id,run.outbox_id,reservation.id,v_output_asset_id,acceptance->>'schemaVersion',
    acceptance->>'inputHash',acceptance->>'requestHash',acceptance->>'responseHash',
    acceptance->>'compiledOutputHash',acceptance->>'acceptanceFingerprintHash',
    acceptance->>'timelineHash',acceptance->>'styleProfileHash',run.reserved_cost_micro_usd,
    reported,acceptance,accepted_at,accepted_at
  FROM public.project_revisions revision JOIN public.cost_events reservation
    ON reservation.account_id=run.account_id AND reservation.workspace_id=run.workspace_id
   AND reservation.task_id=run.task_id AND reservation.attempt_id=run.attempt_id
   AND reservation.event_type='RESERVED'
  WHERE revision.account_id=run.account_id AND revision.workspace_id=run.workspace_id
    AND revision.id=run.project_revision_id;
  FOR writer_attempt IN SELECT value FROM jsonb_array_elements(acceptance->'writerAttempts') LOOP
    IF writer_attempt->>'requestHash' IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(writer_attempt->>'requestBytes','UTF8'),'sha256'),'hex')
       OR writer_attempt->>'responseHash' IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(writer_attempt->>'responseBytes','UTF8'),'sha256'),'hex') THEN
      RAISE EXCEPTION 'hosted prompt attempt bytes drifted' USING ERRCODE='23514';
    END IF;
    INSERT INTO public.prompt_writer_attempts(id,account_id,workspace_id,prompt_execution_id,
      execution_attempt_id,attempt_index,requested_scene_ids,request_bytes,request_hash,
      response_bytes,response_hash,retry_of_request_hash,accepted_scene_ids,unresolved_scene_ids,
      input_tokens,output_tokens,reported_cost_micro_usd,created_at)
    VALUES(gen_random_uuid(),run.account_id,run.workspace_id,execution_id,run.attempt_id,
      (writer_attempt->>'attemptIndex')::int,writer_attempt->'requestedSceneIds',
      writer_attempt->>'requestBytes',writer_attempt->>'requestHash',
      writer_attempt->>'responseBytes',writer_attempt->>'responseHash',
      writer_attempt->>'retryOfRequestHash',writer_attempt->'acceptedSceneIds',
      writer_attempt->'unresolvedSceneIds',(writer_attempt->>'inputTokens')::int,
      (writer_attempt->>'outputTokens')::int,(writer_attempt->>'reportedCostMicroUsd')::bigint,
      accepted_at);
  END LOOP;
  FOR compiled IN SELECT value FROM jsonb_array_elements(acceptance->'compiledPrompts') LOOP
    SELECT value INTO writer_row FROM jsonb_array_elements(acceptance->'writerOutput'->'scenes')
      WHERE value->>'scene_id'=compiled->>'sceneId';
    IF writer_row IS NULL OR compiled->>'positivePromptSha256' IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(compiled->>'positivePrompt','UTF8'),'sha256'),'hex')
       OR compiled->>'negativePromptSha256' IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(compiled->>'negativePrompt','UTF8'),'sha256'),'hex') THEN
      RAISE EXCEPTION 'hosted compiled prompt bytes drifted' USING ERRCODE='23514';
    END IF;
    INSERT INTO public.prompt_scene_results(id,account_id,workspace_id,prompt_execution_id,
      execution_attempt_id,scene_ordinal,scene_id,writer_output,compiled_prompt,
      positive_prompt_hash,negative_prompt_hash,created_at)
    VALUES(gen_random_uuid(),run.account_id,run.workspace_id,execution_id,run.attempt_id,
      compiled_ordinal,compiled->>'sceneId',writer_row,compiled,
      compiled->>'positivePromptSha256',compiled->>'negativePromptSha256',accepted_at);
    compiled_ordinal:=compiled_ordinal+1;
  END LOOP;
  INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
    sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at,created_at)
  VALUES(gen_random_uuid(),run.account_id,run.workspace_id,'PROJECT_REVISION',run.project_revision_id,
    run.task_id,run.attempt_id,run.reservation_cost_sequence+1,'REPORTED',reported,
    'hosted-prompt:'||run.project_revision_id||':reported',
    jsonb_build_object('acceptance_fingerprint_hash',acceptance->>'acceptanceFingerprintHash'),
    accepted_at,accepted_at),
    (gen_random_uuid(),run.account_id,run.workspace_id,'PROJECT_REVISION',run.project_revision_id,
    run.task_id,run.attempt_id,run.reservation_cost_sequence+2,'SETTLED',reported,
    'hosted-prompt:'||run.project_revision_id||':settled',
    jsonb_build_object('acceptance_fingerprint_hash',acceptance->>'acceptanceFingerprintHash'),
    accepted_at,accepted_at);
  UPDATE public.attempts SET state='SUCCEEDED',output_asset_id=v_output_asset_id,
    result_disposition='ACCEPTED',finished_at=accepted_at WHERE workspace_id=run.workspace_id
    AND task_id=run.task_id AND id=run.attempt_id;
  UPDATE public.generation_tasks SET state='COMPLETE',accepted_attempt_id=run.attempt_id,
    version=version+1,finished_at=accepted_at,updated_at=accepted_at
    WHERE workspace_id=run.workspace_id AND id=run.task_id;
  UPDATE public.hosted_prompt_runs SET state='SUCCEEDED',reported_cost_micro_usd=reported,
    acceptance_fingerprint_hash=acceptance->>'acceptanceFingerprintHash',finished_at=accepted_at
    WHERE id=run.id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.videoforge_fail_hosted_prompt_run(
  supplied_run_id uuid,
  supplied_state text,
  supplied_problem_code text,
  supplied_provider_may_have_charged boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE run public.hosted_prompt_runs%ROWTYPE; now_at timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id
     OR run.state<>'DISPATCHING' OR supplied_state NOT IN ('FAILED','UNKNOWN')
     OR supplied_problem_code !~ '^[A-Z0-9_]{3,80}$'
     OR supplied_provider_may_have_charged<>(supplied_state='UNKNOWN') THEN
    RAISE EXCEPTION 'hosted prompt failure is invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.attempts SET state=CASE supplied_state WHEN 'UNKNOWN' THEN 'UNKNOWN' ELSE 'FAILED' END,
    problem_code=supplied_problem_code,finished_at=now_at WHERE workspace_id=run.workspace_id
    AND task_id=run.task_id AND id=run.attempt_id;
  UPDATE public.generation_tasks SET state='FAILED',version=version+1,finished_at=now_at,
    updated_at=now_at WHERE workspace_id=run.workspace_id AND id=run.task_id;
  UPDATE public.hosted_prompt_runs SET state=supplied_state,problem_code=supplied_problem_code,
    provider_may_have_charged=supplied_provider_may_have_charged,finished_at=now_at WHERE id=run.id;
  IF supplied_state='FAILED' THEN
    INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
      sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
    VALUES(gen_random_uuid(),run.account_id,run.workspace_id,'PROJECT_REVISION',run.project_revision_id,
      run.task_id,run.attempt_id,run.reservation_cost_sequence+1,'RELEASED',
      run.reserved_cost_micro_usd,
      'hosted-prompt:'||run.project_revision_id||':released',
      jsonb_build_object('problem_code',supplied_problem_code),now_at);
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_prepare_hosted_voiceover_context(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_complete_hosted_voiceover_context(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_fail_hosted_voiceover_context(uuid,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_prompt_plan(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_prepare_hosted_prompt_run(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_complete_hosted_prompt_run(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_fail_hosted_prompt_run(uuid,text,text,boolean) FROM PUBLIC;
