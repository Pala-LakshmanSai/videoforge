-- Stage 5 adaptive prompt batches.  Migration 0070 remains the historical per-scene
-- compatibility surface; new runs record one transport receipt per accepted batch and
-- append the batch's ordered scene rows in one transaction.

ALTER TABLE public.hosted_prompt_runs
  ADD COLUMN planned_batch_count integer,
  ADD COLUMN planned_scene_count integer,
  ADD COLUMN batch_plan_hash text;

ALTER TABLE public.hosted_prompt_runs
  ADD CONSTRAINT hosted_prompt_runs_planned_batch_count_check CHECK (
    planned_batch_count IS NULL OR planned_batch_count > 0
  ),
  ADD CONSTRAINT hosted_prompt_runs_planned_scene_count_check CHECK (
    planned_scene_count IS NULL OR planned_scene_count > 0
  ),
  ADD CONSTRAINT hosted_prompt_runs_batch_plan_hash_check CHECK (
    batch_plan_hash IS NULL OR batch_plan_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT hosted_prompt_runs_planned_batch_metadata_check CHECK (
    (planned_batch_count IS NULL AND planned_scene_count IS NULL AND batch_plan_hash IS NULL)
    OR (planned_batch_count IS NOT NULL AND planned_scene_count IS NOT NULL
        AND batch_plan_hash IS NOT NULL AND planned_batch_count <= planned_scene_count)
  ),
  ADD CONSTRAINT hosted_prompt_runs_account_workspace_id_uq
    UNIQUE (account_id, workspace_id, id);

CREATE TABLE public.hosted_prompt_batch_progress (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  batch_ordinal integer NOT NULL CHECK (batch_ordinal >= 0),
  first_scene_ordinal integer NOT NULL CHECK (first_scene_ordinal >= 0),
  scene_count integer NOT NULL CHECK (scene_count > 0),
  last_scene_ordinal integer GENERATED ALWAYS AS
    (first_scene_ordinal + scene_count - 1) STORED,
  request_bytes text NOT NULL CHECK (octet_length(request_bytes) BETWEEN 1 AND 8388608),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  response_bytes text NOT NULL CHECK (octet_length(response_bytes) BETWEEN 1 AND 8388608),
  response_hash text NOT NULL CHECK (response_hash ~ '^sha256:[0-9a-f]{64}$'),
  accepted_scene_ids jsonb NOT NULL CHECK (jsonb_typeof(accepted_scene_ids) = 'array'),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  reported_cost_micro_usd bigint NOT NULL CHECK (
    reported_cost_micro_usd BETWEEN 0 AND 40000
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (account_id, workspace_id, run_id, batch_ordinal),
  UNIQUE (account_id, workspace_id, run_id, first_scene_ordinal),
  FOREIGN KEY (account_id, workspace_id, run_id)
    REFERENCES public.hosted_prompt_runs(account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES public.workspaces(account_id, id) ON DELETE RESTRICT
);

CREATE INDEX hosted_prompt_batch_progress_run_idx
  ON public.hosted_prompt_batch_progress(account_id, workspace_id, run_id, batch_ordinal);

CREATE TRIGGER hosted_prompt_batch_progress_tenant_write_guard
  BEFORE INSERT OR UPDATE ON public.hosted_prompt_batch_progress
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER hosted_prompt_batch_progress_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_prompt_batch_progress
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_immutable_row();
ALTER TABLE public.hosted_prompt_batch_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_prompt_batch_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_prompt_batch_progress_tenant_rls ON public.hosted_prompt_batch_progress
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

-- The old table remains the read surface for accepted scenes.  Historical 0070 rows retain
-- their per-scene request/response evidence; new rows point to exactly one batch receipt and
-- keep transport bytes in that receipt, avoiding duplicated cost/evidence per scene.
ALTER TABLE public.hosted_prompt_scene_progress
  DROP CONSTRAINT IF EXISTS hosted_prompt_scene_progress_scene_ordinal_check,
  ADD COLUMN batch_progress_id uuid,
  ALTER COLUMN request_bytes DROP NOT NULL,
  ALTER COLUMN request_hash DROP NOT NULL,
  ALTER COLUMN response_bytes DROP NOT NULL,
  ALTER COLUMN response_hash DROP NOT NULL,
  ADD CONSTRAINT hosted_prompt_scene_progress_scene_ordinal_check
    CHECK (scene_ordinal >= 0),
  ADD CONSTRAINT hosted_prompt_scene_progress_evidence_mode_check CHECK (
    (batch_progress_id IS NULL AND request_bytes IS NOT NULL AND request_hash IS NOT NULL
      AND response_bytes IS NOT NULL AND response_hash IS NOT NULL)
    OR (batch_progress_id IS NOT NULL AND request_bytes IS NULL AND request_hash IS NULL
      AND response_bytes IS NULL AND response_hash IS NULL)
  ),
  ADD CONSTRAINT hosted_prompt_scene_progress_batch_fk
    FOREIGN KEY (account_id, workspace_id, batch_progress_id)
    REFERENCES public.hosted_prompt_batch_progress(account_id, workspace_id, id)
    ON DELETE RESTRICT;

CREATE INDEX hosted_prompt_scene_progress_batch_idx
  ON public.hosted_prompt_scene_progress(account_id, workspace_id, batch_progress_id, scene_ordinal);

-- Revision-local plan sequences restart at one, so the historical loader's plan-only ordering
-- could tie across project revisions.  Select the newest revision first and always follow that
-- revision's authoritative timing head.
CREATE OR REPLACE FUNCTION public.videoforge_load_hosted_prompt_plan(
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
  WITH latest_revision AS (
    SELECT revision.*
      FROM public.projects project
      JOIN public.project_revisions revision
        ON revision.account_id=project.account_id AND revision.workspace_id=project.workspace_id
       AND revision.project_id=project.id
     WHERE project.account_id=supplied_account_id AND project.workspace_id=supplied_workspace_id
       AND project.id=supplied_project_id AND project.status='ACTIVE'
       AND project.project_kind='USER'
     ORDER BY revision.revision_number DESC, revision.id DESC
     LIMIT 1
  ), selected AS (
    SELECT revision.id revision_id,revision.title,revision.status revision_state,
           revision.image_style_version_id,revision.style_profile_hash revision_style_hash,
           revision.extra_prompt_keywords,revision.apply_extra_prompt_keywords,
           (revision.revision_config_payload->>'spend_cap_usd')::numeric spend_cap_usd,
           head.current_timeline_plan_id timeline_id,plan.canonical_document_hash timeline_hash,
           style.state style_state,style.style_profile_hash,style.profile_payload
      FROM latest_revision revision
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
     ORDER BY plan.plan_sequence DESC
     LIMIT 1
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

CREATE FUNCTION public.videoforge_record_hosted_prompt_batch(
  supplied_run_id uuid,
  supplied jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
#variable_conflict use_variable
DECLARE
  run public.hosted_prompt_runs%ROWTYPE;
  batch_id uuid:=gen_random_uuid();
  batch_ordinal_text text:=supplied->>'batch_ordinal';
  first_scene_ordinal_text text:=supplied->>'first_scene_ordinal';
  batch_cost_text text:=supplied->>'reported_cost_micro_usd';
  input_tokens_text text:=supplied->>'input_tokens';
  output_tokens_text text:=supplied->>'output_tokens';
  batch_ordinal integer;
  first_scene_ordinal integer;
  batch_scene_count integer;
  scene_index integer:=0;
  prior_batch_count integer;
  prior_scene_count integer;
  prior_cost bigint;
  batch_cost bigint;
  input_tokens integer;
  output_tokens integer;
  batch_ordinal_number numeric;
  first_scene_ordinal_number numeric;
  batch_cost_number numeric;
  input_tokens_number numeric;
  output_tokens_number numeric;
  scene jsonb;
  scene_ordinal integer;
  scene_ordinal_text text;
  scene_id text;
  expected_scene_id text;
  accepted_scene_ids jsonb:='[]'::jsonb;
  scenes jsonb:=supplied->'scenes';
  request_bytes text:=supplied->>'request_bytes';
  request_hash text:=supplied->>'request_hash';
  response_bytes text:=supplied->>'response_bytes';
  response_hash text:=supplied->>'response_hash';
  now_at timestamptz:=clock_timestamp();
BEGIN
  IF batch_ordinal_text IS NULL OR batch_ordinal_text !~ '^(0|[1-9][0-9]*)$'
     OR first_scene_ordinal_text IS NULL
     OR first_scene_ordinal_text !~ '^(0|[1-9][0-9]*)$'
     OR batch_cost_text IS NULL OR batch_cost_text !~ '^[0-9]+$'
     OR input_tokens_text IS NULL OR input_tokens_text !~ '^[0-9]+$'
     OR output_tokens_text IS NULL OR output_tokens_text !~ '^[0-9]+$'
     OR jsonb_typeof(scenes)<>'array'
     OR jsonb_array_length(scenes)<1 THEN
    RAISE EXCEPTION 'hosted prompt batch progress is invalid' USING ERRCODE='23514';
  END IF;
  batch_ordinal_number:=batch_ordinal_text::numeric;
  first_scene_ordinal_number:=first_scene_ordinal_text::numeric;
  batch_cost_number:=batch_cost_text::numeric;
  input_tokens_number:=input_tokens_text::numeric;
  output_tokens_number:=output_tokens_text::numeric;
  IF batch_ordinal_number>2147483647 OR first_scene_ordinal_number>2147483647
     OR batch_cost_number>40000 OR input_tokens_number>2147483647
     OR output_tokens_number>2147483647 THEN
    RAISE EXCEPTION 'hosted prompt batch progress is invalid' USING ERRCODE='23514';
  END IF;
  batch_ordinal:=batch_ordinal_number::integer;
  first_scene_ordinal:=first_scene_ordinal_number::integer;
  batch_cost:=batch_cost_number::bigint;
  input_tokens:=input_tokens_number::integer;
  output_tokens:=output_tokens_number::integer;
  batch_scene_count:=jsonb_array_length(scenes);

  SELECT * INTO run FROM public.hosted_prompt_runs
   WHERE id=supplied_run_id FOR UPDATE;
  SELECT count(*)::integer, coalesce(sum(progress.scene_count),0)::integer,
         coalesce(sum(progress.reported_cost_micro_usd),0)::bigint
    INTO prior_batch_count,prior_scene_count,prior_cost
    FROM public.hosted_prompt_batch_progress progress
   WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
     AND progress.run_id=run.id;

  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id
     OR run.state<>'DISPATCHING'
     OR run.planned_batch_count IS NULL OR run.planned_scene_count IS NULL
     OR batch_ordinal<>prior_batch_count OR first_scene_ordinal<>prior_scene_count
     OR batch_ordinal>=run.planned_batch_count
     OR first_scene_ordinal+batch_scene_count>run.planned_scene_count
     OR request_bytes IS NULL OR octet_length(request_bytes) NOT BETWEEN 1 AND 8388608
     OR response_bytes IS NULL OR octet_length(response_bytes) NOT BETWEEN 1 AND 8388608
     OR request_hash IS NULL OR request_hash !~ '^sha256:[0-9a-f]{64}$'
     OR response_hash IS NULL OR response_hash !~ '^sha256:[0-9a-f]{64}$'
     OR request_hash IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(request_bytes,'UTF8'),'sha256'),'hex')
     OR response_hash IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(response_bytes,'UTF8'),'sha256'),'hex')
     OR batch_cost IS NULL OR batch_cost NOT BETWEEN 0 AND run.reserved_cost_micro_usd
     OR prior_cost+batch_cost>run.reserved_cost_micro_usd
     OR EXISTS (SELECT 1 FROM public.hosted_prompt_scene_progress legacy
       WHERE legacy.account_id=run.account_id AND legacy.workspace_id=run.workspace_id
         AND legacy.run_id=run.id AND legacy.batch_progress_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.hosted_prompt_batch_progress prior
       WHERE prior.account_id=run.account_id AND prior.workspace_id=run.workspace_id
         AND prior.run_id=run.id AND prior.batch_ordinal=batch_ordinal) THEN
    RAISE EXCEPTION 'hosted prompt batch progress is invalid' USING ERRCODE='23514';
  END IF;

  FOR scene IN SELECT value FROM jsonb_array_elements(scenes) LOOP
    scene_ordinal_text:=scene->>'scene_ordinal';
    IF jsonb_typeof(scene)<>'object' OR scene_ordinal_text IS NULL
       OR scene_ordinal_text !~ '^(0|[1-9][0-9]*)$'
       OR (scene_ordinal_text::numeric)>2147483647
       OR scene->>'scene_id' IS NULL OR length(scene->>'scene_id') NOT BETWEEN 1 AND 160
       OR jsonb_typeof(scene->'writer_output')<>'object'
       OR jsonb_typeof(scene->'compiled_prompt')<>'object'
       OR scene->'writer_output'->>'scene_id' IS DISTINCT FROM scene->>'scene_id'
       OR scene->'compiled_prompt'->>'sceneId' IS DISTINCT FROM scene->>'scene_id' THEN
      RAISE EXCEPTION 'hosted prompt batch scene is invalid' USING ERRCODE='23514';
    END IF;
    scene_ordinal:=(scene_ordinal_text::numeric)::integer;
    scene_id:=scene->>'scene_id';
    SELECT ordered.segment_key INTO expected_scene_id
      FROM (
        SELECT segment.segment_key,
               row_number() OVER (ORDER BY segment.segment_index)-1 AS image_ordinal
          FROM public.timeline_segments segment
         WHERE segment.account_id=run.account_id AND segment.workspace_id=run.workspace_id
           AND segment.project_revision_id=run.project_revision_id
           AND segment.timeline_plan_id=run.timeline_plan_id
           AND segment.timeline_composition IN ('IMAGE_FULL','AVATAR_SPLIT_IMAGE')
      ) ordered
     WHERE ordered.image_ordinal=first_scene_ordinal+scene_index;
    IF scene_ordinal<>first_scene_ordinal+scene_index
       OR scene_id IS DISTINCT FROM expected_scene_id THEN
      RAISE EXCEPTION 'hosted prompt batch scene order drifted' USING ERRCODE='23514';
    END IF;
    accepted_scene_ids:=accepted_scene_ids||jsonb_build_array(scene_id);
    scene_index:=scene_index+1;
  END LOOP;

  INSERT INTO public.hosted_prompt_batch_progress(
    id,account_id,workspace_id,run_id,batch_ordinal,first_scene_ordinal,scene_count,
    request_bytes,request_hash,response_bytes,response_hash,accepted_scene_ids,
    input_tokens,output_tokens,reported_cost_micro_usd,created_at
  ) VALUES (
    batch_id,run.account_id,run.workspace_id,run.id,batch_ordinal,first_scene_ordinal,
    batch_scene_count,request_bytes,request_hash,response_bytes,response_hash,
    accepted_scene_ids,input_tokens,output_tokens,
    batch_cost,now_at
  );

  -- Scene rows deliberately carry no duplicated transport bytes or batch cost.  The batch
  -- receipt is the sole transport/cost evidence; each scene remains independently queryable.
  scene_index:=0;
  FOR scene IN SELECT value FROM jsonb_array_elements(scenes) LOOP
    INSERT INTO public.hosted_prompt_scene_progress(
      id,account_id,workspace_id,run_id,scene_ordinal,scene_id,batch_progress_id,
      request_bytes,request_hash,response_bytes,response_hash,writer_output,compiled_prompt,
      input_tokens,output_tokens,reported_cost_micro_usd,created_at
    ) VALUES (
      gen_random_uuid(),run.account_id,run.workspace_id,run.id,
      first_scene_ordinal+scene_index,scene->>'scene_id',batch_id,
      NULL,NULL,NULL,NULL,scene->'writer_output',scene->'compiled_prompt',
      0,0,0,now_at
    );
    scene_index:=scene_index+1;
  END LOOP;
  UPDATE public.hosted_prompt_runs
     SET reported_cost_micro_usd=prior_cost+batch_cost
   WHERE id=run.id;
  RETURN true;
END;
$$;

-- Keep the 0070 recorder available only for genuinely historical runs.  An adaptive run may
-- never fall back to per-scene transport evidence, otherwise completion could pair a batch plan
-- with legacy rows and charge the same provider work twice.
CREATE OR REPLACE FUNCTION public.videoforge_record_hosted_prompt_scene(
  supplied_run_id uuid,
  supplied jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
#variable_conflict use_variable
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
     OR run.state<>'DISPATCHING'
     OR run.planned_batch_count IS NOT NULL OR run.planned_scene_count IS NOT NULL
     OR run.batch_plan_hash IS NOT NULL
     OR ordinal NOT BETWEEN 0 AND 49 OR ordinal IS DISTINCT FROM accepted_count
     OR scene_id IS DISTINCT FROM expected_scene_id
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

-- New preparation metadata is supplied by the deterministic batch planner.  The database checks
-- it against the saved timeline before claiming work; historical runs remain valid with NULL
-- metadata and continue through the 0070 compatibility path below.
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
  timeline_hash text:=supplied->>'timeline_hash';
  batch_plan_hash text:=supplied->>'batch_plan_hash';
  planned_batch_count integer;
  planned_scene_count integer;
  expected_scene_count integer;
  existing public.hosted_prompt_runs%ROWTYPE;
  existing_profile public.execution_profiles%ROWTYPE;
  context_task_id uuid;
  reservation_sequence integer;
  now_at timestamptz:=clock_timestamp();
  profile_config jsonb:='{"model":"deepseek:v4@flash","operation":"scene-prompt-writer-v1","provider":"runware"}'::jsonb;
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
        AND revision.maximum_cost_micro_usd>=50000
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
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('created',false,'state',existing.state,'run_id',existing.id,
      'task_id',existing.task_id,'attempt_id',existing.attempt_id,'outbox_id',existing.outbox_id,
      'planned_batch_count',existing.planned_batch_count,
      'planned_scene_count',existing.planned_scene_count,
      'batch_plan_hash',existing.batch_plan_hash);
  END IF;
  INSERT INTO public.execution_profiles(id,account_id,workspace_id,name,revision,lane,state,
    dispatch_target,configuration,configuration_hash,maximum_rate_micro_usd,checked_at,created_at)
  VALUES(requested_profile_id,account_id,workspace_id,'Hosted Runware scene prompts',1,'PROMPT',
    'TESTED','RUNWARE',profile_config,profile_config_hash,40000,now_at,now_at)
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
  outbox_payload:=jsonb_build_object(
    'batch_mode','adaptive','planned_batch_count',planned_batch_count,
    'planned_scene_count',planned_scene_count,'batch_plan_hash',batch_plan_hash,
    'continuity_tags',jsonb_build_array()
  );
  INSERT INTO public.generation_tasks(id,account_id,workspace_id,owner_type,owner_id,
    project_revision_id,task_key,lane,state,required,depends_on,created_at,updated_at)
  VALUES(task_id,account_id,workspace_id,'PROJECT_REVISION',revision_id,revision_id,
    'prompt:scene-batch:1','PROMPT','RUNNING',true,jsonb_build_array(context_task_id),now_at,now_at);
  INSERT INTO public.attempts(id,account_id,workspace_id,task_id,ordinal,idempotency_key,state,
    dispatch_state,claim_state,execution_profile_id,execution_claim_token_hash,input_hash,
    result_disposition,provider_details,created_at,claimed_at,started_at)
  VALUES(attempt_id,account_id,workspace_id,task_id,1,'hosted-prompt:'||revision_id,
    'RUNNING','ACKNOWLEDGED','CLAIMED',profile_id,claim_hash,input_hash,'PENDING',
    jsonb_build_object('provider','runware','model','deepseek:v4@flash',
      'operation','scene-prompt-writer-v1'),now_at,now_at,now_at);
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
    jsonb_build_object('provider','runware','model','deepseek:v4@flash',
      'operation','scene-prompt-writer-v1'),now_at);
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
$$;

-- Completion accepts either the new adaptive-batch evidence or the historical 0070 per-scene
-- evidence.  Mixed evidence is rejected so a cost cannot be counted twice.
CREATE OR REPLACE FUNCTION public.videoforge_validate_hosted_prompt_completion() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog AS $$
DECLARE
  batch_count integer;
  batch_scene_count integer;
  batch_cost bigint;
  legacy_count integer;
  expected_count integer;
  result_count integer;
BEGIN
  IF OLD.state='DISPATCHING' AND NEW.state='SUCCEEDED' THEN
    SELECT count(*)::integer,coalesce(sum(batch.scene_count),0)::integer,
           coalesce(sum(batch.reported_cost_micro_usd),0)::bigint
      INTO batch_count,batch_scene_count,batch_cost
      FROM public.hosted_prompt_batch_progress batch
     WHERE batch.account_id=NEW.account_id AND batch.workspace_id=NEW.workspace_id
       AND batch.run_id=NEW.id;
    SELECT count(*)::integer INTO legacy_count
      FROM public.hosted_prompt_scene_progress progress
     WHERE progress.account_id=NEW.account_id AND progress.workspace_id=NEW.workspace_id
       AND progress.run_id=NEW.id AND progress.batch_progress_id IS NULL;
    SELECT count(*)::integer INTO expected_count FROM public.timeline_segments segment
     WHERE segment.account_id=NEW.account_id AND segment.workspace_id=NEW.workspace_id
       AND segment.project_revision_id=NEW.project_revision_id
       AND segment.timeline_plan_id=NEW.timeline_plan_id
       AND segment.timeline_composition IN ('IMAGE_FULL','AVATAR_SPLIT_IMAGE');
    SELECT count(*)::integer INTO result_count
      FROM public.prompt_scene_results result
      JOIN public.prompt_executions execution
        ON execution.account_id=NEW.account_id AND execution.workspace_id=NEW.workspace_id
       AND execution.id=result.prompt_execution_id
     WHERE result.account_id=NEW.account_id AND result.workspace_id=NEW.workspace_id
       AND execution.task_id=NEW.task_id;
    IF (
         (NEW.planned_batch_count IS NULL OR NEW.planned_scene_count IS NULL
            OR NEW.batch_plan_hash IS NULL)
         AND (NEW.planned_batch_count IS NOT NULL OR NEW.planned_scene_count IS NOT NULL
            OR NEW.batch_plan_hash IS NOT NULL)
       )
       OR (
         NEW.planned_batch_count IS NOT NULL AND NEW.planned_scene_count IS NOT NULL
            AND NEW.batch_plan_hash IS NOT NULL
         AND (batch_count=0 OR legacy_count<>0
            OR batch_count<>NEW.planned_batch_count
            OR batch_scene_count<>NEW.planned_scene_count
            OR batch_cost IS DISTINCT FROM NEW.reported_cost_micro_usd
            OR batch_cost>NEW.reserved_cost_micro_usd
            OR result_count<>expected_count)
       )
       OR (
         NEW.planned_batch_count IS NULL AND NEW.planned_scene_count IS NULL
            AND NEW.batch_plan_hash IS NULL
         AND (batch_count<>0 OR legacy_count<>expected_count)
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.prompt_executions execution
          WHERE execution.account_id=NEW.account_id AND execution.workspace_id=NEW.workspace_id
            AND execution.task_id=NEW.task_id
            AND execution.reported_cost_micro_usd=NEW.reported_cost_micro_usd
       )
       OR EXISTS (
         SELECT 1 FROM public.hosted_prompt_scene_progress progress
         LEFT JOIN public.prompt_executions execution
           ON execution.account_id=progress.account_id AND execution.workspace_id=progress.workspace_id
          AND execution.task_id=NEW.task_id
         LEFT JOIN public.prompt_scene_results result
           ON result.account_id=execution.account_id AND result.workspace_id=execution.workspace_id
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

-- Complete a run against the cost already evidenced by its selected mode.  Adaptive runs use the
-- sum of batch transport receipts; historical runs use the sum of their 0070 scene receipts.  The
-- unused portion of the fixed reservation is explicitly released so RESERVED = SETTLED + RELEASED.
CREATE OR REPLACE FUNCTION public.videoforge_complete_hosted_prompt_run(supplied jsonb) RETURNS boolean
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
  batch_count integer;
  batch_scene_count integer;
  batch_cost bigint;
  legacy_count integer;
  legacy_cost bigint;
  expected_count integer;
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=(supplied->>'run_id')::uuid FOR UPDATE;
  SELECT count(*)::integer,coalesce(sum(batch.scene_count),0)::integer,
         coalesce(sum(batch.reported_cost_micro_usd),0)::bigint
    INTO batch_count,batch_scene_count,batch_cost
    FROM public.hosted_prompt_batch_progress batch
   WHERE batch.account_id=run.account_id AND batch.workspace_id=run.workspace_id
     AND batch.run_id=run.id;
  SELECT count(*)::integer,coalesce(sum(progress.reported_cost_micro_usd),0)::bigint
    INTO legacy_count,legacy_cost
    FROM public.hosted_prompt_scene_progress progress
   WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
     AND progress.run_id=run.id AND progress.batch_progress_id IS NULL;
  SELECT count(*)::integer INTO expected_count
    FROM public.timeline_segments segment
   WHERE segment.account_id=run.account_id AND segment.workspace_id=run.workspace_id
     AND segment.project_revision_id=run.project_revision_id
     AND segment.timeline_plan_id=run.timeline_plan_id
     AND segment.timeline_composition IN ('IMAGE_FULL','AVATAR_SPLIT_IMAGE');
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id
     OR run.state<>'DISPATCHING' OR acceptance->>'workspaceId'<>run.workspace_id::text
     OR acceptance->>'projectId'<>run.project_id::text
     OR acceptance->>'revisionId'<>run.project_revision_id::text
     OR acceptance->>'timelineId'<>run.timeline_plan_id::text
     OR acceptance->>'taskId'<>run.task_id::text OR acceptance->>'attemptId'<>run.attempt_id::text
     OR acceptance->>'outboxId'<>run.outbox_id::text OR acceptance->>'inputHash'<>run.input_hash
     OR acceptance->>'schemaVersion'<>'videoforge.durable-prompt-execution/v1'
     OR acceptance->>'acceptanceFingerprintHash' !~ '^sha256:[0-9a-f]{64}$'
     OR reported IS NULL OR reported NOT BETWEEN 0 AND run.reserved_cost_micro_usd
     OR jsonb_typeof(acceptance->'writerAttempts')<>'array'
     OR jsonb_array_length(acceptance->'writerAttempts') NOT BETWEEN 1 AND 2
     OR jsonb_typeof(acceptance->'compiledPrompts')<>'array'
     OR jsonb_array_length(acceptance->'compiledPrompts')<>expected_count
     OR (
         (run.planned_batch_count IS NULL OR run.planned_scene_count IS NULL
            OR run.batch_plan_hash IS NULL)
         AND (run.planned_batch_count IS NOT NULL OR run.planned_scene_count IS NOT NULL
            OR run.batch_plan_hash IS NOT NULL)
       )
     OR (
         run.planned_batch_count IS NOT NULL AND run.planned_scene_count IS NOT NULL
            AND run.batch_plan_hash IS NOT NULL
         AND (batch_count=0 OR legacy_count<>0
            OR batch_count<>run.planned_batch_count
            OR batch_scene_count<>run.planned_scene_count
            OR batch_cost IS DISTINCT FROM reported
            OR batch_cost>run.reserved_cost_micro_usd)
       )
     OR (
         run.planned_batch_count IS NULL AND run.planned_scene_count IS NULL
            AND run.batch_plan_hash IS NULL
         AND (batch_count<>0 OR legacy_count<>expected_count OR legacy_cost IS DISTINCT FROM reported)
       ) THEN
    RAISE EXCEPTION 'hosted prompt acceptance is invalid' USING ERRCODE='23514';
  END IF;

  -- Use the validated evidence total as the canonical amount persisted in the execution and
  -- ledger.  This keeps the success path cost-conserving even if acceptance JSON is reordered.
  IF run.planned_batch_count IS NOT NULL THEN
    reported:=batch_cost;
  ELSE
    reported:=legacy_cost;
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
    jsonb_build_object('acceptance_fingerprint_hash',acceptance->>'acceptanceFingerprintHash',
      'batch_count',batch_count),accepted_at,accepted_at),
    (gen_random_uuid(),run.account_id,run.workspace_id,'PROJECT_REVISION',run.project_revision_id,
    run.task_id,run.attempt_id,run.reservation_cost_sequence+2,'SETTLED',reported,
    'hosted-prompt:'||run.project_revision_id||':settled',
    jsonb_build_object('acceptance_fingerprint_hash',acceptance->>'acceptanceFingerprintHash',
      'batch_count',batch_count),accepted_at,accepted_at);
  IF run.reserved_cost_micro_usd-reported>0 THEN
    INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
      sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at,created_at)
    VALUES(gen_random_uuid(),run.account_id,run.workspace_id,'PROJECT_REVISION',run.project_revision_id,
      run.task_id,run.attempt_id,run.reservation_cost_sequence+3,'RELEASED',
      run.reserved_cost_micro_usd-reported,
      'hosted-prompt:'||run.project_revision_id||':released',
      jsonb_build_object('acceptance_fingerprint_hash',acceptance->>'acceptanceFingerprintHash',
        'batch_count',batch_count,'unused_reservation_micro_usd',run.reserved_cost_micro_usd-reported),
      accepted_at,accepted_at);
  END IF;
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

-- Known accepted batch transport costs are charged on definite failure.  Historical 0070
-- failures continue summing their per-scene evidence; UNKNOWN remains reservation-preserving.
CREATE OR REPLACE FUNCTION public.videoforge_fail_hosted_prompt_run(
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
  batch_count integer;
  legacy_count integer;
  known_cost bigint;
  additional_cost bigint:=coalesce(supplied_additional_known_cost_micro_usd,0);
  next_sequence integer;
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;
  SELECT count(*)::integer,coalesce(sum(batch.reported_cost_micro_usd),0)::bigint
    INTO batch_count,known_cost
    FROM public.hosted_prompt_batch_progress batch
   WHERE batch.account_id=run.account_id AND batch.workspace_id=run.workspace_id
     AND batch.run_id=run.id;
  SELECT count(*)::integer INTO legacy_count
    FROM public.hosted_prompt_scene_progress progress
   WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
     AND progress.run_id=run.id AND progress.batch_progress_id IS NULL;
  IF batch_count=0 THEN
    SELECT coalesce(sum(progress.reported_cost_micro_usd),0)::bigint INTO known_cost
      FROM public.hosted_prompt_scene_progress progress
     WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
       AND progress.run_id=run.id AND progress.batch_progress_id IS NULL;
  END IF;
  known_cost:=known_cost+additional_cost;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id
     OR run.state<>'DISPATCHING' OR supplied_state NOT IN ('FAILED','UNKNOWN')
     OR supplied_problem_code !~ '^[A-Z0-9_]{3,80}$'
     OR supplied_provider_may_have_charged<>(supplied_state='UNKNOWN')
     OR supplied_additional_known_cost_micro_usd NOT BETWEEN 0 AND 40000
     OR (supplied_state='UNKNOWN' AND supplied_additional_known_cost_micro_usd<>0)
     OR (batch_count>0 AND legacy_count>0)
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
        jsonb_build_object('problem_code',supplied_problem_code,'batch_count',batch_count),now_at);
      INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,
        attempt_id,sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
      VALUES(gen_random_uuid(),run.account_id,run.workspace_id,'PROJECT_REVISION',
        run.project_revision_id,run.task_id,run.attempt_id,next_sequence+1,'SETTLED',known_cost,
        'hosted-prompt:'||run.project_revision_id||':partial-settled',
        jsonb_build_object('problem_code',supplied_problem_code,'batch_count',batch_count),now_at);
      next_sequence:=next_sequence+2;
    END IF;
    IF run.reserved_cost_micro_usd-known_cost>0 THEN
      INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,
        attempt_id,sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
      VALUES(gen_random_uuid(),run.account_id,run.workspace_id,'PROJECT_REVISION',
        run.project_revision_id,run.task_id,run.attempt_id,next_sequence,'RELEASED',
        run.reserved_cost_micro_usd-known_cost,
        'hosted-prompt:'||run.project_revision_id||':released',
        jsonb_build_object('problem_code',supplied_problem_code,'batch_count',batch_count),now_at);
    END IF;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON TABLE public.hosted_prompt_batch_progress FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_prompt_plan(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_hosted_prompt_batch(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_prepare_hosted_prompt_run(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_validate_hosted_prompt_completion() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_fail_hosted_prompt_run(uuid,text,text,boolean,bigint) FROM PUBLIC;
