-- Stage 5 dispatches one bounded DeepSeek request per narration scene. Persist each locally
-- validated scene before the next provider call so the authenticated progress screen can show
-- real accepted prompt data while the stage is still running. Final prompt_executions acceptance
-- remains atomic; these rows are immutable progress and failure-cost evidence.

CREATE TABLE public.hosted_prompt_scene_progress (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  scene_ordinal integer NOT NULL CHECK (scene_ordinal BETWEEN 0 AND 49),
  scene_id text NOT NULL CHECK (length(scene_id) BETWEEN 1 AND 160),
  request_bytes text NOT NULL CHECK (octet_length(request_bytes) BETWEEN 1 AND 131072),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  response_bytes text NOT NULL CHECK (octet_length(response_bytes) BETWEEN 1 AND 131072),
  response_hash text NOT NULL CHECK (response_hash ~ '^sha256:[0-9a-f]{64}$'),
  writer_output jsonb NOT NULL CHECK (jsonb_typeof(writer_output) = 'object'),
  compiled_prompt jsonb NOT NULL CHECK (jsonb_typeof(compiled_prompt) = 'object'),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  reported_cost_micro_usd bigint NOT NULL CHECK (
    reported_cost_micro_usd BETWEEN 0 AND 800
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, run_id, scene_ordinal),
  UNIQUE (account_id, workspace_id, run_id, scene_id),
  FOREIGN KEY (run_id) REFERENCES public.hosted_prompt_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES public.workspaces(account_id, id) ON DELETE RESTRICT
);

CREATE INDEX hosted_prompt_scene_progress_run_idx
  ON public.hosted_prompt_scene_progress(account_id, workspace_id, run_id, scene_ordinal);

CREATE TRIGGER hosted_prompt_scene_progress_tenant_write_guard
  BEFORE INSERT OR UPDATE ON public.hosted_prompt_scene_progress
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER hosted_prompt_scene_progress_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_prompt_scene_progress
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_immutable_row();
ALTER TABLE public.hosted_prompt_scene_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_prompt_scene_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_prompt_scene_progress_tenant_rls ON public.hosted_prompt_scene_progress
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE FUNCTION public.videoforge_record_hosted_prompt_scene(
  supplied_run_id uuid,
  supplied jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  run public.hosted_prompt_runs%ROWTYPE;
  ordinal integer:=(supplied->>'scene_ordinal')::integer;
  scene_id text:=supplied->>'scene_id';
  scene_cost bigint:=(supplied->>'reported_cost_micro_usd')::bigint;
  accumulated_cost bigint;
  accepted_count integer;
  expected_scene_id text;
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;
  SELECT count(*)::integer,coalesce(sum(progress.reported_cost_micro_usd),0)::bigint
    INTO accepted_count,accumulated_cost
    FROM public.hosted_prompt_scene_progress progress
   WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
     AND progress.run_id=run.id;
  SELECT segment.segment_key INTO expected_scene_id
    FROM public.timeline_segments segment
   WHERE segment.account_id=run.account_id AND segment.workspace_id=run.workspace_id
     AND segment.project_revision_id=run.project_revision_id
     AND segment.timeline_plan_id=run.timeline_plan_id
     AND segment.timeline_composition IN ('IMAGE_FULL','AVATAR_SPLIT_IMAGE')
   ORDER BY segment.segment_index
   OFFSET accepted_count LIMIT 1;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id
     OR run.state<>'DISPATCHING' OR ordinal NOT BETWEEN 0 AND 49
     OR ordinal IS DISTINCT FROM accepted_count OR scene_id IS DISTINCT FROM expected_scene_id
     OR scene_id IS NULL OR length(scene_id) NOT BETWEEN 1 AND 160
     OR supplied->>'request_hash' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'response_hash' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'request_hash' IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(supplied->>'request_bytes','UTF8'),'sha256'),'hex')
     OR supplied->>'response_hash' IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(supplied->>'response_bytes','UTF8'),'sha256'),'hex')
     OR jsonb_typeof(supplied->'writer_output')<>'object'
     OR supplied->'writer_output'->>'scene_id' IS DISTINCT FROM scene_id
     OR jsonb_typeof(supplied->'compiled_prompt')<>'object'
     OR supplied->'compiled_prompt'->>'sceneId' IS DISTINCT FROM scene_id
     OR (supplied->>'input_tokens')::integer<0 OR (supplied->>'output_tokens')::integer<0
     OR scene_cost NOT BETWEEN 0 AND 800
     OR accumulated_cost+scene_cost>run.reserved_cost_micro_usd
     OR EXISTS (SELECT 1 FROM public.hosted_prompt_scene_progress progress
       WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
         AND progress.run_id=run.id
         AND (progress.scene_ordinal=ordinal OR progress.scene_id=scene_id)) THEN
    RAISE EXCEPTION 'hosted prompt scene progress is invalid' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.hosted_prompt_scene_progress(
    id,account_id,workspace_id,run_id,scene_ordinal,scene_id,request_bytes,request_hash,
    response_bytes,response_hash,writer_output,compiled_prompt,input_tokens,output_tokens,
    reported_cost_micro_usd
  ) VALUES(
    gen_random_uuid(),run.account_id,run.workspace_id,run.id,ordinal,scene_id,
    supplied->>'request_bytes',supplied->>'request_hash',supplied->>'response_bytes',
    supplied->>'response_hash',supplied->'writer_output',supplied->'compiled_prompt',
    (supplied->>'input_tokens')::integer,(supplied->>'output_tokens')::integer,scene_cost
  );
  UPDATE public.hosted_prompt_runs
     SET reported_cost_micro_usd=accumulated_cost+scene_cost
   WHERE id=run.id;
  RETURN true;
END;
$$;

-- Completion may only seal the exact scene set and cumulative cost already exposed as progress.
CREATE FUNCTION public.videoforge_validate_hosted_prompt_completion() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog AS $$
DECLARE progress_count integer; progress_cost bigint; expected_count integer;
BEGIN
  IF OLD.state='DISPATCHING' AND NEW.state='SUCCEEDED' THEN
    SELECT count(*)::integer,coalesce(sum(reported_cost_micro_usd),0)::bigint
      INTO progress_count,progress_cost
      FROM public.hosted_prompt_scene_progress progress
     WHERE progress.account_id=NEW.account_id AND progress.workspace_id=NEW.workspace_id
       AND progress.run_id=NEW.id;
    SELECT count(*)::integer INTO expected_count FROM public.timeline_segments segment
     WHERE segment.account_id=NEW.account_id AND segment.workspace_id=NEW.workspace_id
       AND segment.project_revision_id=NEW.project_revision_id
       AND segment.timeline_plan_id=NEW.timeline_plan_id
       AND segment.timeline_composition IN ('IMAGE_FULL','AVATAR_SPLIT_IMAGE');
    IF progress_count<>expected_count OR progress_cost IS DISTINCT FROM NEW.reported_cost_micro_usd
       OR NOT EXISTS (
         SELECT 1 FROM public.prompt_executions execution
          WHERE execution.account_id=NEW.account_id AND execution.workspace_id=NEW.workspace_id
            AND execution.task_id=NEW.task_id
            AND execution.reported_cost_micro_usd=progress_cost
       ) OR EXISTS (
         SELECT 1 FROM public.hosted_prompt_scene_progress progress
         LEFT JOIN public.prompt_executions execution
           ON execution.account_id=progress.account_id
          AND execution.workspace_id=progress.workspace_id
          AND execution.task_id=NEW.task_id
         LEFT JOIN public.prompt_scene_results result
           ON result.account_id=execution.account_id
          AND result.workspace_id=execution.workspace_id
          AND result.prompt_execution_id=execution.id
          AND result.scene_ordinal=progress.scene_ordinal
        WHERE progress.account_id=NEW.account_id AND progress.workspace_id=NEW.workspace_id
          AND progress.run_id=NEW.id
          AND (result.id IS NULL OR result.scene_id IS DISTINCT FROM progress.scene_id
            OR result.writer_output IS DISTINCT FROM progress.writer_output
            OR result.compiled_prompt IS DISTINCT FROM progress.compiled_prompt)
       ) THEN
      RAISE EXCEPTION 'hosted prompt completion progress drifted' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hosted_prompt_runs_completion_progress_guard
  BEFORE UPDATE ON public.hosted_prompt_runs
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_hosted_prompt_completion();

-- Known completed scene requests are charged even when a later scene is definitely rejected.
-- UNKNOWN keeps the original reservation because the last provider result is still ambiguous.
DROP FUNCTION public.videoforge_fail_hosted_prompt_run(uuid,text,text,boolean);
CREATE FUNCTION public.videoforge_fail_hosted_prompt_run(
  supplied_run_id uuid,
  supplied_state text,
  supplied_problem_code text,
  supplied_provider_may_have_charged boolean,
  supplied_additional_known_cost_micro_usd bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  run public.hosted_prompt_runs%ROWTYPE;
  now_at timestamptz:=clock_timestamp();
  known_cost bigint;
  next_sequence integer;
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;
  SELECT coalesce(sum(progress.reported_cost_micro_usd),0)::bigint
    + supplied_additional_known_cost_micro_usd INTO known_cost
    FROM public.hosted_prompt_scene_progress progress
   WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
     AND progress.run_id=run.id;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id
     OR run.state<>'DISPATCHING' OR supplied_state NOT IN ('FAILED','UNKNOWN')
     OR supplied_problem_code !~ '^[A-Z0-9_]{3,80}$'
     OR supplied_provider_may_have_charged<>(supplied_state='UNKNOWN')
     OR supplied_additional_known_cost_micro_usd NOT BETWEEN 0 AND 800
     OR (supplied_state='UNKNOWN' AND supplied_additional_known_cost_micro_usd<>0)
     OR known_cost>run.reserved_cost_micro_usd THEN
    RAISE EXCEPTION 'hosted prompt failure is invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.attempts
     SET state=CASE supplied_state WHEN 'UNKNOWN' THEN 'UNKNOWN' ELSE 'FAILED' END,
         dispatch_state=CASE supplied_state WHEN 'UNKNOWN' THEN 'AMBIGUOUS' ELSE dispatch_state END,
         problem_code=supplied_problem_code,
         finished_at=CASE supplied_state WHEN 'UNKNOWN' THEN NULL ELSE now_at END
   WHERE workspace_id=run.workspace_id AND task_id=run.task_id AND id=run.attempt_id;
  UPDATE public.generation_tasks SET state='FAILED',version=version+1,finished_at=now_at,
    updated_at=now_at WHERE workspace_id=run.workspace_id AND id=run.task_id;
  UPDATE public.hosted_prompt_runs SET state=supplied_state,problem_code=supplied_problem_code,
    provider_may_have_charged=supplied_provider_may_have_charged,
    reported_cost_micro_usd=CASE supplied_state WHEN 'FAILED' THEN known_cost
      ELSE reported_cost_micro_usd END,
    finished_at=now_at WHERE id=run.id;
  IF supplied_state='FAILED' THEN
    next_sequence:=run.reservation_cost_sequence+1;
    IF known_cost>0 THEN
      INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,
        attempt_id,sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
      VALUES(gen_random_uuid(),run.account_id,run.workspace_id,'PROJECT_REVISION',
        run.project_revision_id,run.task_id,run.attempt_id,next_sequence,'REPORTED',known_cost,
        'hosted-prompt:'||run.project_revision_id||':partial-reported',
        jsonb_build_object('problem_code',supplied_problem_code),now_at);
      INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,
        attempt_id,sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
      VALUES(gen_random_uuid(),run.account_id,run.workspace_id,'PROJECT_REVISION',
        run.project_revision_id,run.task_id,run.attempt_id,next_sequence+1,'SETTLED',known_cost,
        'hosted-prompt:'||run.project_revision_id||':partial-settled',
        jsonb_build_object('problem_code',supplied_problem_code),now_at);
      next_sequence:=next_sequence+2;
    END IF;
    IF run.reserved_cost_micro_usd-known_cost>0 THEN
      INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,
        attempt_id,sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
      VALUES(gen_random_uuid(),run.account_id,run.workspace_id,'PROJECT_REVISION',
        run.project_revision_id,run.task_id,run.attempt_id,next_sequence,'RELEASED',
        run.reserved_cost_micro_usd-known_cost,
        'hosted-prompt:'||run.project_revision_id||':released',
        jsonb_build_object('problem_code',supplied_problem_code),now_at);
    END IF;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON TABLE public.hosted_prompt_scene_progress FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_hosted_prompt_scene(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_validate_hosted_prompt_completion() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_fail_hosted_prompt_run(uuid,text,text,boolean,bigint) FROM PUBLIC;
