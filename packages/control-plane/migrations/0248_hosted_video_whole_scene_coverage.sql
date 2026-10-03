-- Future revisions pin complete-scene semantics and a finished-video ceiling.
-- Old rows keep prefix semantics and seven percent; accepted jobs are untouched.
ALTER TABLE public.hosted_video_plans DROP CONSTRAINT hosted_video_plans_coverage_percent_check;
ALTER TABLE public.hosted_video_plans ADD COLUMN replacement_policy text NOT NULL DEFAULT 'LEGACY_PREFIX_V1';
ALTER TABLE public.hosted_video_plans ADD CONSTRAINT hosted_video_plans_policy_check CHECK(
 coverage_percent BETWEEN 0 AND 100 AND replacement_policy IN('LEGACY_PREFIX_V1','WHOLE_SCENE_V2')
 AND(replacement_policy<>'LEGACY_PREFIX_V1' OR coverage_percent=7));

CREATE FUNCTION public.videoforge_pin_hosted_video_plan(a uuid,w uuid,r uuid,supplied_coverage integer,supplied_policy text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE plan hosted_video_plans%ROWTYPE;
BEGIN
 IF supplied_coverage IS NULL OR supplied_coverage NOT BETWEEN 0 AND 100 OR supplied_policy IS NULL
  OR supplied_policy NOT IN('LEGACY_PREFIX_V1','WHOLE_SCENE_V2') OR(supplied_policy='LEGACY_PREFIX_V1' AND supplied_coverage<>7) THEN
  RAISE EXCEPTION 'video policy invalid' USING ERRCODE='23514'; END IF;
 IF a IS DISTINCT FROM public.videoforge_current_account_id() OR NOT EXISTS(
  SELECT 1 FROM project_revisions rev JOIN projects p ON p.account_id=rev.account_id AND p.workspace_id=rev.workspace_id AND p.id=rev.project_id
  WHERE rev.account_id=a AND rev.workspace_id=w AND rev.id=r AND p.generation_provider='KIE_FAL' AND p.status='ACTIVE') THEN
  RAISE EXCEPTION 'video plan scope invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=r;
 IF plan.project_revision_id IS NOT NULL THEN
  IF plan.coverage_percent IS DISTINCT FROM supplied_coverage OR plan.replacement_policy IS DISTINCT FROM supplied_policy THEN
   RAISE EXCEPTION 'video policy replay drift' USING ERRCODE='23505'; END IF;
  RETURN to_jsonb(plan); END IF;
 -- Only fresh creation opts in. Never retrofit existing canonical/provider work.
 IF EXISTS(SELECT 1 FROM hosted_canonical_timing_bridges b WHERE b.account_id=a AND b.workspace_id=w AND b.project_revision_id=r)
   OR EXISTS(SELECT 1 FROM hosted_api_generation_jobs j WHERE j.account_id=a AND j.workspace_id=w AND j.project_revision_id=r)
   OR EXISTS(SELECT 1 FROM generation_requests g WHERE g.account_id=a AND g.workspace_id=w AND g.project_revision_id=r) THEN
  RAISE EXCEPTION 'video plan must be pinned before generation' USING ERRCODE='23514'; END IF;
 INSERT INTO hosted_video_plans(account_id,workspace_id,project_revision_id,coverage_percent,replacement_policy) VALUES(a,w,r,supplied_coverage,supplied_policy) ON CONFLICT(project_revision_id) DO NOTHING;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=r;
 IF plan.coverage_percent IS DISTINCT FROM supplied_coverage OR plan.replacement_policy IS DISTINCT FROM supplied_policy THEN
  RAISE EXCEPTION 'video policy concurrent replay drift' USING ERRCODE='23505'; END IF;
 RETURN to_jsonb(plan);
END; $$;

CREATE FUNCTION public.videoforge_copy_hosted_video_plan(a uuid,w uuid,source_revision uuid,target_revision uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE plan hosted_video_plans%ROWTYPE;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() OR NOT EXISTS(
  SELECT 1 FROM project_revisions source JOIN project_revisions target ON target.account_id=source.account_id
   AND target.workspace_id=source.workspace_id AND target.project_id=source.project_id
  WHERE source.account_id=a AND source.workspace_id=w AND source.id=source_revision AND target.id=target_revision) THEN
  RAISE EXCEPTION 'video successor scope invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=source_revision;
 IF plan.project_revision_id IS NULL THEN RETURN NULL; END IF;
 RETURN public.videoforge_pin_hosted_video_plan(a,w,target_revision,plan.coverage_percent,plan.replacement_policy);
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_pin_hosted_video_plan(uuid,uuid,uuid,integer,text), public.videoforge_copy_hosted_video_plan(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_pin_hosted_video_plan(uuid,uuid,uuid,integer,text), public.videoforge_copy_hosted_video_plan(uuid,uuid,uuid,uuid) TO videoforge_v209_runtime_dc9612d6;

CREATE OR REPLACE FUNCTION public.videoforge_plan_hosted_video_selections(a uuid,w uuid,r uuid,supplied_selections jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE plan hosted_video_plans%ROWTYPE; selected jsonb; total_frames bigint; selected_frames bigint:=0; seg timeline_segments%ROWTYPE;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'video selection scope invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=r FOR UPDATE;
 IF plan.project_revision_id IS NULL THEN RETURN NULL; END IF;
 IF supplied_selections IS NULL OR jsonb_typeof(supplied_selections)<>'array' OR jsonb_array_length(supplied_selections)>4096 THEN RAISE EXCEPTION 'video selections invalid' USING ERRCODE='23514'; END IF;
 IF plan.selections IS NOT NULL THEN
  IF plan.selections IS DISTINCT FROM supplied_selections THEN RAISE EXCEPTION 'video selection replay drift' USING ERRCODE='23505'; END IF;
  RETURN to_jsonb(plan);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM hosted_canonical_timing_bridges b WHERE b.account_id=a AND b.workspace_id=w AND b.project_revision_id=r) THEN
  RAISE EXCEPTION 'video canonical timing missing' USING ERRCODE='23514'; END IF;
 SELECT max(end_frame_exclusive) INTO total_frames FROM timeline_segments WHERE account_id=a AND workspace_id=w AND project_revision_id=r;
 IF total_frames IS NULL OR (SELECT count(DISTINCT item->>'segmentId') FROM jsonb_array_elements(supplied_selections) item)<>jsonb_array_length(supplied_selections) THEN
  RAISE EXCEPTION 'video selection coverage invalid' USING ERRCODE='23514'; END IF;
 FOR selected IN SELECT value FROM jsonb_array_elements(supplied_selections) LOOP
  IF jsonb_typeof(selected)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(selected))<>4
    OR NOT(selected ?& ARRAY['segmentId','sourceTaskKey','videoFrameCount','durationSeconds'])
    OR jsonb_typeof(selected->'videoFrameCount') IS DISTINCT FROM 'number' OR jsonb_typeof(selected->'durationSeconds') IS DISTINCT FROM 'number'
    OR selected->>'videoFrameCount' !~ '^[1-9][0-9]*$' OR selected->>'durationSeconds' !~ '^[0-9]+(\.[0-9])?$'
    OR (selected->>'durationSeconds')::numeric NOT BETWEEN 1.2 AND 12 THEN RAISE EXCEPTION 'video selection shape invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO seg FROM timeline_segments WHERE account_id=a AND workspace_id=w AND project_revision_id=r AND segment_key=selected->>'segmentId' AND timeline_composition='IMAGE_FULL';
  IF seg.id IS NULL OR seg.required_slots#>>'{image,task_key}' IS DISTINCT FROM selected->>'sourceTaskKey'
    OR (selected->>'videoFrameCount')::integer>seg.end_frame_exclusive-seg.start_frame
    OR(plan.replacement_policy='WHOLE_SCENE_V2' AND((selected->>'videoFrameCount')::integer<>seg.end_frame_exclusive-seg.start_frame
      OR (selected->>'videoFrameCount')::integer>357 OR (selected->>'durationSeconds')::numeric<greatest(1.2,ceil(((selected->>'videoFrameCount')::numeric+3)/3)/10)))
    OR (selected->>'videoFrameCount')::integer>(selected->>'durationSeconds')::numeric*30
    OR NOT EXISTS(SELECT 1 FROM generation_tasks t WHERE t.account_id=a AND t.workspace_id=w AND t.project_revision_id=r AND t.task_key=selected->>'sourceTaskKey' AND t.lane='IMAGE') THEN
   RAISE EXCEPTION 'video selection must bind its full image scene' USING ERRCODE='23514'; END IF;
  selected_frames:=selected_frames+(selected->>'videoFrameCount')::integer;
 END LOOP;
 IF selected_frames>floor(total_frames*plan.coverage_percent::numeric/100) THEN RAISE EXCEPTION 'video selections exceed pinned coverage' USING ERRCODE='23514'; END IF;
 UPDATE hosted_video_plans SET selections=supplied_selections,
  selection_sha256='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(supplied_selections),'UTF8')),'hex'),planned_at=transaction_timestamp()
 WHERE account_id=a AND workspace_id=w AND project_revision_id=r RETURNING * INTO plan;
 RETURN to_jsonb(plan);
END; $$;

-- Preserve all accepted asset/source/receipt and fallback checks from the installed
-- reader, adding durable policy/budget/whole-scene gates before it is called.
ALTER FUNCTION public.videoforge_hosted_video_manifest_valid(uuid,uuid,uuid,jsonb) RENAME TO videoforge_hosted_video_manifest_valid_legacy248;
CREATE FUNCTION public.videoforge_hosted_video_manifest_valid(a uuid,w uuid,g uuid,manifest jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE plan hosted_video_plans%ROWTYPE; request generation_requests%ROWTYPE; total_frames bigint; selected_frames bigint; selected jsonb; seg timeline_segments%ROWTYPE; segment jsonb; expected integer;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RETURN false; END IF;
 SELECT * INTO request FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g;
 IF request.id IS NULL THEN RETURN false; END IF;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=request.project_revision_id;
 IF plan.project_revision_id IS NULL OR plan.replacement_policy='LEGACY_PREFIX_V1' THEN
  RETURN public.videoforge_hosted_video_manifest_valid_legacy248(a,w,g,manifest); END IF;
 IF manifest IS NULL OR manifest->>'schema_version' IS DISTINCT FROM 'resolved-render-manifest/v3'
  OR jsonb_typeof(manifest->'segments') IS DISTINCT FROM 'array' OR plan.selections IS NULL
  OR manifest->'video_policy' IS DISTINCT FROM jsonb_build_object('coverage_percent',plan.coverage_percent,'replacement_policy',plan.replacement_policy,'selection_sha256',plan.selection_sha256)
  OR plan.selection_sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(plan.selections),'UTF8')),'hex') THEN RETURN false; END IF;
 SELECT max(end_frame_exclusive) INTO total_frames FROM timeline_segments WHERE account_id=a AND workspace_id=w AND project_revision_id=plan.project_revision_id;
 IF total_frames IS NULL OR manifest->>'total_frames' IS DISTINCT FROM total_frames::text THEN RETURN false; END IF;
 selected_frames:=0;
 FOR selected IN SELECT value FROM jsonb_array_elements(plan.selections) LOOP
  SELECT * INTO seg FROM timeline_segments WHERE account_id=a AND workspace_id=w AND project_revision_id=plan.project_revision_id AND segment_key=selected->>'segmentId' AND timeline_composition='IMAGE_FULL';
  IF seg.id IS NULL OR (selected->>'videoFrameCount')::integer<>seg.end_frame_exclusive-seg.start_frame
   OR (selected->>'videoFrameCount')::integer>357
   OR (selected->>'durationSeconds')::numeric<greatest(1.2,ceil(((selected->>'videoFrameCount')::numeric+3)/3)/10)
   OR seg.required_slots#>>'{image,task_key}' IS DISTINCT FROM selected->>'sourceTaskKey'
   OR NOT EXISTS(SELECT 1 FROM hosted_video_jobs j WHERE j.account_id=a AND j.workspace_id=w AND j.generation_request_id=g
    AND j.segment_id=selected->>'segmentId' AND j.source_task_key=selected->>'sourceTaskKey' AND j.video_frame_count=(selected->>'videoFrameCount')::integer
    AND j.duration_seconds=(selected->>'durationSeconds')::numeric) THEN RETURN false; END IF;
  SELECT s INTO segment FROM jsonb_array_elements(manifest->'segments') s WHERE s->>'segment_id'=seg.segment_key OR seg.segment_key='segment:'||(s->>'segment_id');
  IF segment IS NULL OR segment->>'start_frame' IS DISTINCT FROM seg.start_frame::text OR segment->>'end_frame_exclusive' IS DISTINCT FROM seg.end_frame_exclusive::text THEN RETURN false; END IF;
  selected_frames:=selected_frames+(selected->>'videoFrameCount')::integer;
 END LOOP;
 IF selected_frames>floor(total_frames*plan.coverage_percent::numeric/100) THEN RETURN false; END IF;
 SELECT count(*) FILTER(WHERE state='SUCCEEDED') INTO expected FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g;
 RETURN public.videoforge_hosted_video_manifest_valid_legacy248(a,w,g,(manifest-'video_policy')||jsonb_build_object('schema_version',CASE WHEN expected=0 THEN 'resolved-render-manifest/v1' ELSE 'resolved-render-manifest/v2' END));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_video_manifest_valid(uuid,uuid,uuid,jsonb) FROM PUBLIC;

ALTER FUNCTION public.videoforge_hosted_video_render_input_valid(uuid,uuid,uuid,jsonb) RENAME TO videoforge_hosted_video_render_input_valid_legacy248;
CREATE FUNCTION public.videoforge_hosted_video_render_input_valid(a uuid,w uuid,r uuid,input jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE plan hosted_video_plans%ROWTYPE;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RETURN false; END IF;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=r;
 IF plan.replacement_policy='WHOLE_SCENE_V2' THEN
  RETURN input->>'schema_version'='render-job-input/v3' AND input->'video_policy' IS NOT DISTINCT FROM
   jsonb_build_object('coverage_percent',plan.coverage_percent,'replacement_policy',plan.replacement_policy,'selection_sha256',plan.selection_sha256)
   AND EXISTS(SELECT 1 FROM hosted_v209_ordinary_resolved_render_manifests m WHERE m.account_id=a AND m.workspace_id=w AND m.project_revision_id=r
    AND m.manifest_sha256=input#>>'{resolved_render_manifest,sha256}' AND public.videoforge_hosted_video_manifest_valid(a,w,m.generation_request_id,m.manifest_document));
 END IF;
 RETURN public.videoforge_hosted_video_render_input_valid_legacy248(a,w,r,input);
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_video_render_input_valid(uuid,uuid,uuid,jsonb) FROM PUBLIC;

DO $metadata$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_commit_hosted_v209_resolved_render_manifest(uuid,uuid,uuid,jsonb,text,text,bigint)'::regprocedure) INTO definition;
 marker:=$old$CASE supplied_manifest->>'schema_version' WHEN 'resolved-render-manifest/v2' THEN 'v2' ELSE 'v1' END$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video manifest v3 metadata preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$CASE supplied_manifest->>'schema_version' WHEN 'resolved-render-manifest/v3' THEN 'v3' WHEN 'resolved-render-manifest/v2' THEN 'v2' ELSE 'v1' END$new$);
END; $metadata$;
