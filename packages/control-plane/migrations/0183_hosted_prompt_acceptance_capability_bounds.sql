-- 0183_hosted_prompt_acceptance_capability_bounds.sql
--
-- More pinned bounds inside the acceptance capabilities themselves, measured against the real work on
-- 2026-09-18 (a 10-scene batch costs 50088-59649 micro-USD, about 5000-6000 per scene):
--   videoforge_record_hosted_prompt_batch: batch_cost_number>40000 refused every real batch
--   videoforge_record_hosted_prompt_scene: scene_cost NOT BETWEEN 0 AND 800 refused every real scene
--   videoforge_complete_hosted_prompt_run: reserved_cost_micro_usd<>40000 refused the new reservation
-- The batch bound moves to the run's reservation (600000) and the scene bound to a tenth of it
-- (60000); the reservation check follows the reservation. All stay bounds, and the run-level checks
-- (accumulated cost may never exceed run.reserved_cost_micro_usd) are untouched.

CREATE OR REPLACE FUNCTION public.videoforge_record_hosted_prompt_batch(
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
     OR batch_cost_number>600000 OR input_tokens_number>2147483647
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
     OR scene_cost NOT BETWEEN 0 AND 60000
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
