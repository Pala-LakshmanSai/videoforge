-- Additive, future-only configurable opening. Saved policies and all accepted
-- identities remain unchanged; legacy OPENING_180_V3 resolves to 180 seconds.
ALTER TABLE public.hosted_video_plans ADD COLUMN opening_seconds integer NOT NULL DEFAULT 0;
ALTER TABLE public.hosted_video_plans DROP CONSTRAINT hosted_video_plans_policy_check;
ALTER TABLE public.hosted_video_plans ADD CONSTRAINT hosted_video_plans_policy_check CHECK(
 coverage_percent BETWEEN 0 AND 100
 AND replacement_policy IN('LEGACY_PREFIX_V1','WHOLE_SCENE_V2','OPENING_180_V3','OPENING_CONFIG_V4')
 AND(replacement_policy<>'LEGACY_PREFIX_V1' OR coverage_percent=7)
 AND((replacement_policy='OPENING_CONFIG_V4' AND opening_seconds BETWEEN 6 AND 3600 AND mod(opening_seconds,6)=0)
  OR(replacement_policy='OPENING_180_V3' AND opening_seconds IN(0,180))
  OR(replacement_policy IN('LEGACY_PREFIX_V1','WHOLE_SCENE_V2') AND opening_seconds=0)));

CREATE FUNCTION public.videoforge_hosted_video_opening_seconds(a uuid,w uuid,r uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT CASE replacement_policy WHEN 'OPENING_180_V3' THEN 180 WHEN 'OPENING_CONFIG_V4' THEN opening_seconds ELSE 0 END
 FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=r
 AND a IS NOT DISTINCT FROM public.videoforge_current_account_id();
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_video_opening_seconds(uuid,uuid,uuid) FROM PUBLIC;

-- The established five-argument function is preserved byte-for-byte. New callers
-- explicitly bind seconds; old policies retain their exact existing overload.
CREATE FUNCTION public.videoforge_pin_hosted_video_plan(a uuid,w uuid,r uuid,supplied_coverage integer,supplied_policy text,supplied_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE plan hosted_video_plans%ROWTYPE;
BEGIN
 IF supplied_seconds IS NULL THEN RAISE EXCEPTION 'video opening seconds invalid' USING ERRCODE='23514'; END IF;
 IF supplied_policy IS DISTINCT FROM 'OPENING_CONFIG_V4' THEN
  IF supplied_seconds<>0 THEN RAISE EXCEPTION 'video old policy opening seconds invalid' USING ERRCODE='23514'; END IF;
  RETURN public.videoforge_pin_hosted_video_plan(a,w,r,supplied_coverage,supplied_policy);
 END IF;
 IF supplied_coverage IS NULL OR supplied_coverage NOT BETWEEN 0 AND 100
  OR supplied_seconds NOT BETWEEN 6 AND 3600 OR mod(supplied_seconds,6)<>0 THEN
  RAISE EXCEPTION 'video configurable opening policy invalid' USING ERRCODE='23514'; END IF;
 IF a IS DISTINCT FROM public.videoforge_current_account_id() OR NOT EXISTS(
  SELECT 1 FROM project_revisions rev JOIN projects p ON p.account_id=rev.account_id AND p.workspace_id=rev.workspace_id AND p.id=rev.project_id
  WHERE rev.account_id=a AND rev.workspace_id=w AND rev.id=r AND p.generation_provider='KIE_FAL' AND p.status='ACTIVE') THEN
  RAISE EXCEPTION 'video plan scope invalid' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM project_revisions rev WHERE rev.account_id=a AND rev.workspace_id=w AND rev.id=r
  AND rev.revision_config_payload->'ai_video_opening_seconds' IS NOT DISTINCT FROM to_jsonb(supplied_seconds)
  AND rev.revision_config_payload->>'scheduler_version' IN('scheduler-v10','scheduler-v11')) THEN
  RAISE EXCEPTION 'video configurable opening revision binding invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=r;
 IF plan.project_revision_id IS NOT NULL THEN
  IF plan.coverage_percent IS DISTINCT FROM supplied_coverage OR plan.replacement_policy IS DISTINCT FROM supplied_policy
   OR plan.opening_seconds IS DISTINCT FROM supplied_seconds THEN RAISE EXCEPTION 'video policy replay drift' USING ERRCODE='23505'; END IF;
  RETURN to_jsonb(plan);
 END IF;
 IF EXISTS(SELECT 1 FROM hosted_canonical_timing_bridges b WHERE b.account_id=a AND b.workspace_id=w AND b.project_revision_id=r)
  OR EXISTS(SELECT 1 FROM hosted_api_generation_jobs j WHERE j.account_id=a AND j.workspace_id=w AND j.project_revision_id=r)
  OR EXISTS(SELECT 1 FROM generation_requests g WHERE g.account_id=a AND g.workspace_id=w AND g.project_revision_id=r) THEN
  RAISE EXCEPTION 'video plan must be pinned before generation' USING ERRCODE='23514'; END IF;
 INSERT INTO hosted_video_plans(account_id,workspace_id,project_revision_id,coverage_percent,replacement_policy,opening_seconds)
 VALUES(a,w,r,supplied_coverage,supplied_policy,supplied_seconds) ON CONFLICT(project_revision_id) DO NOTHING;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=r;
 IF plan.coverage_percent IS DISTINCT FROM supplied_coverage OR plan.replacement_policy IS DISTINCT FROM supplied_policy
  OR plan.opening_seconds IS DISTINCT FROM supplied_seconds THEN RAISE EXCEPTION 'video policy concurrent replay drift' USING ERRCODE='23505'; END IF;
 RETURN to_jsonb(plan);
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_pin_hosted_video_plan(uuid,uuid,uuid,integer,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_pin_hosted_video_plan(uuid,uuid,uuid,integer,text,integer) TO videoforge_v209_runtime_dc9612d6;

CREATE OR REPLACE FUNCTION public.videoforge_copy_hosted_video_plan(a uuid,w uuid,source_revision uuid,target_revision uuid) RETURNS jsonb
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
 RETURN public.videoforge_pin_hosted_video_plan(a,w,target_revision,plan.coverage_percent,plan.replacement_policy,
  CASE WHEN plan.replacement_policy='OPENING_CONFIG_V4' THEN plan.opening_seconds ELSE 0 END);
END; $$;

CREATE OR REPLACE FUNCTION public.videoforge_hosted_video_opening_selections_valid(a uuid,w uuid,r uuid,chosen jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE opening_frames bigint; plan hosted_video_plans%ROWTYPE; total_frames bigint; crossing bigint; optional_frames bigint;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() OR jsonb_typeof(chosen) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=r AND replacement_policy IN('OPENING_180_V3','OPENING_CONFIG_V4');
 opening_frames:=public.videoforge_hosted_video_opening_seconds(a,w,r)*30;
 IF plan.project_revision_id IS NULL THEN RETURN false; END IF;
 IF plan.replacement_policy='OPENING_CONFIG_V4' AND NOT EXISTS(
  SELECT 1 FROM project_revisions rev JOIN hosted_canonical_timing_bridges b
   ON b.account_id=rev.account_id AND b.workspace_id=rev.workspace_id AND b.project_revision_id=rev.id
  JOIN timeline_plans t ON t.account_id=b.account_id AND t.workspace_id=b.workspace_id AND t.id=b.timeline_plan_id AND t.project_revision_id=rev.id
  WHERE rev.account_id=a AND rev.workspace_id=w AND rev.id=r
   AND rev.revision_config_payload->'ai_video_opening_seconds' IS NOT DISTINCT FROM to_jsonb(plan.opening_seconds)
   AND rev.revision_config_payload->>'scheduler_version' IN('scheduler-v10','scheduler-v11')
   AND t.scheduler_version=rev.revision_config_payload->>'scheduler_version') THEN RETURN false; END IF;
 SELECT max(end_frame_exclusive),coalesce(sum(greatest(end_frame_exclusive-opening_frames,0)) FILTER(WHERE start_frame<opening_frames),0)
  INTO total_frames,crossing FROM timeline_segments WHERE account_id=a AND workspace_id=w AND project_revision_id=r;
 IF total_frames IS NULL OR total_frames<=0 OR EXISTS(
  SELECT 1 FROM(SELECT start_frame,end_frame_exclusive,
   coalesce(lag(end_frame_exclusive) OVER(ORDER BY start_frame),0) previous_end
   FROM timeline_segments WHERE account_id=a AND workspace_id=w AND project_revision_id=r) timeline
  WHERE start_frame<>previous_end OR end_frame_exclusive<=start_frame) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM timeline_segments segment WHERE segment.account_id=a AND segment.workspace_id=w AND segment.project_revision_id=r
  AND segment.start_frame<opening_frames AND(segment.timeline_composition<>'IMAGE_FULL' OR segment.end_frame_exclusive-segment.start_frame>357
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(chosen) selected WHERE selected->>'segmentId'=segment.segment_key
    AND selected->>'sourceTaskKey'=segment.required_slots#>>'{image,task_key}'
    AND selected->>'videoFrameCount'=(segment.end_frame_exclusive-segment.start_frame)::text))) THEN RETURN false; END IF;
 SELECT coalesce(sum((selected->>'videoFrameCount')::bigint),0) INTO optional_frames
  FROM jsonb_array_elements(chosen) selected JOIN timeline_segments segment ON segment.account_id=a AND segment.workspace_id=w
   AND segment.project_revision_id=r AND segment.segment_key=selected->>'segmentId' WHERE segment.start_frame>=opening_frames;
 -- A whole scene straddling the pinned opening is compulsory even at Off. Its suffix consumes
 -- the optional post-opening allowance before any additional scene is selected.
 RETURN optional_frames<=greatest(0,floor(greatest(total_frames-opening_frames,0)*plan.coverage_percent::numeric/100)-crossing);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION public.videoforge_hosted_video_opening_wire_policy(a uuid,w uuid,r uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE opening_frames bigint; plan hosted_video_plans%ROWTYPE; total_frames bigint; mandatory bigint; crossing bigint; ceiling_percent integer;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RETURN NULL; END IF;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=r AND replacement_policy IN('OPENING_180_V3','OPENING_CONFIG_V4');
 opening_frames:=public.videoforge_hosted_video_opening_seconds(a,w,r)*30;
 IF plan.project_revision_id IS NULL OR plan.selections IS NULL THEN RETURN NULL; END IF;
 SELECT max(end_frame_exclusive),coalesce(sum(end_frame_exclusive-start_frame) FILTER(WHERE start_frame<opening_frames),0),
  coalesce(sum(greatest(end_frame_exclusive-opening_frames,0)) FILTER(WHERE start_frame<opening_frames),0)
  INTO total_frames,mandatory,crossing FROM timeline_segments WHERE account_id=a AND workspace_id=w AND project_revision_id=r;
 IF total_frames IS NULL OR total_frames<=0 THEN RETURN NULL; END IF;
 ceiling_percent:=least(100,ceil((mandatory+greatest(0,floor(greatest(total_frames-opening_frames,0)*plan.coverage_percent::numeric/100)-crossing))*100/total_frames))::integer;
 RETURN jsonb_build_object('coverage_percent',ceiling_percent,'replacement_policy','WHOLE_SCENE_V2','selection_sha256',plan.selection_sha256);
END; $$;

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
    OR(plan.replacement_policy IN('WHOLE_SCENE_V2','OPENING_180_V3','OPENING_CONFIG_V4') AND((selected->>'videoFrameCount')::integer<>seg.end_frame_exclusive-seg.start_frame
      OR (selected->>'videoFrameCount')::integer>357 OR (selected->>'durationSeconds')::numeric<greatest(1.2,ceil(((selected->>'videoFrameCount')::numeric+3)/3)/10)))
    OR (selected->>'videoFrameCount')::integer>(selected->>'durationSeconds')::numeric*30
    OR NOT EXISTS(SELECT 1 FROM generation_tasks t WHERE t.account_id=a AND t.workspace_id=w AND t.project_revision_id=r AND t.task_key=selected->>'sourceTaskKey' AND t.lane='IMAGE') THEN
   RAISE EXCEPTION 'video selection must bind its full image scene' USING ERRCODE='23514'; END IF;
  selected_frames:=selected_frames+(selected->>'videoFrameCount')::integer;
 END LOOP;
 IF plan.replacement_policy IN('OPENING_180_V3','OPENING_CONFIG_V4') THEN
  IF NOT public.videoforge_hosted_video_opening_selections_valid(a,w,r,supplied_selections) THEN
   RAISE EXCEPTION 'video opening selections or post-opening coverage invalid' USING ERRCODE='23514'; END IF;
 ELSIF selected_frames>floor(total_frames*plan.coverage_percent::numeric/100) THEN
  RAISE EXCEPTION 'video selections exceed pinned coverage' USING ERRCODE='23514'; END IF;
 UPDATE hosted_video_plans SET selections=supplied_selections,
  selection_sha256='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(supplied_selections),'UTF8')),'hex'),planned_at=transaction_timestamp()
 WHERE account_id=a AND workspace_id=w AND project_revision_id=r RETURNING * INTO plan;
 RETURN to_jsonb(plan);
END; $$;

CREATE OR REPLACE FUNCTION public.videoforge_hosted_video_manifest_valid(a uuid,w uuid,g uuid,manifest jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE opening_frames bigint; plan hosted_video_plans%ROWTYPE; request generation_requests%ROWTYPE; selected jsonb; seg timeline_segments%ROWTYPE;
 segment jsonb; total_frames bigint; expected integer;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RETURN false; END IF;
 SELECT * INTO request FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g;
 IF request.id IS NULL THEN RETURN false; END IF;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=request.project_revision_id;
 opening_frames:=public.videoforge_hosted_video_opening_seconds(a,w,plan.project_revision_id)*30;
 IF plan.project_revision_id IS NULL OR plan.replacement_policy NOT IN('OPENING_180_V3','OPENING_CONFIG_V4') THEN
  RETURN public.videoforge_hosted_video_manifest_valid_before_opening267(a,w,g,manifest); END IF;
 IF manifest IS NULL OR manifest->>'schema_version' IS DISTINCT FROM 'resolved-render-manifest/v3'
  OR jsonb_typeof(manifest->'segments') IS DISTINCT FROM 'array' OR plan.selections IS NULL
  OR manifest->'video_policy' IS DISTINCT FROM public.videoforge_hosted_video_opening_wire_policy(a,w,plan.project_revision_id)
  OR plan.selection_sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(plan.selections),'UTF8')),'hex')
  OR NOT public.videoforge_hosted_video_opening_selections_valid(a,w,plan.project_revision_id,plan.selections) THEN RETURN false; END IF;
 SELECT max(end_frame_exclusive) INTO total_frames FROM timeline_segments WHERE account_id=a AND workspace_id=w AND project_revision_id=plan.project_revision_id;
 IF manifest->>'total_frames' IS DISTINCT FROM total_frames::text OR jsonb_array_length(manifest->'segments')<>(
  SELECT count(*) FROM timeline_segments WHERE account_id=a AND workspace_id=w AND project_revision_id=plan.project_revision_id) THEN RETURN false; END IF;
 -- Bind every scene to canonical timing/composition, including unselected scenes.
 FOR seg IN SELECT * FROM timeline_segments WHERE account_id=a AND workspace_id=w AND project_revision_id=plan.project_revision_id LOOP
  IF(SELECT count(*) FROM jsonb_array_elements(manifest->'segments') s
   WHERE s->>'segment_id'=seg.segment_key OR seg.segment_key='segment:'||(s->>'segment_id'))<>1 THEN RETURN false; END IF;
  SELECT s INTO segment FROM jsonb_array_elements(manifest->'segments') s
   WHERE s->>'segment_id'=seg.segment_key OR seg.segment_key='segment:'||(s->>'segment_id');
  IF segment->>'start_frame' IS DISTINCT FROM seg.start_frame::text OR segment->>'end_frame_exclusive' IS DISTINCT FROM seg.end_frame_exclusive::text
   OR segment->>'timeline_composition' IS DISTINCT FROM seg.timeline_composition THEN RETURN false; END IF;
  IF seg.start_frame<opening_frames AND(segment#>'{accepted_assets,video}' IS NULL OR segment#>'{accepted_assets,video}'='null'::jsonb
   OR segment#>>'{render,video_frame_count}' IS DISTINCT FROM(seg.end_frame_exclusive-seg.start_frame)::text) THEN RETURN false; END IF;
 END LOOP;
 FOR selected IN SELECT value FROM jsonb_array_elements(plan.selections) LOOP
  SELECT * INTO seg FROM timeline_segments WHERE account_id=a AND workspace_id=w AND project_revision_id=plan.project_revision_id
   AND segment_key=selected->>'segmentId' AND timeline_composition='IMAGE_FULL';
  IF seg.id IS NULL OR (selected->>'videoFrameCount')::integer<>seg.end_frame_exclusive-seg.start_frame
   OR (selected->>'videoFrameCount')::integer>357
   OR (selected->>'durationSeconds')::numeric<greatest(1.2,ceil(((selected->>'videoFrameCount')::numeric+3)/3)/10)
   OR seg.required_slots#>>'{image,task_key}' IS DISTINCT FROM selected->>'sourceTaskKey'
   OR NOT EXISTS(SELECT 1 FROM hosted_video_jobs j WHERE j.account_id=a AND j.workspace_id=w AND j.generation_request_id=g
    AND j.project_revision_id=plan.project_revision_id AND j.segment_id=selected->>'segmentId'
    AND j.source_task_key=selected->>'sourceTaskKey' AND j.video_frame_count=(selected->>'videoFrameCount')::integer
    AND j.duration_seconds=(selected->>'durationSeconds')::numeric AND(seg.start_frame>=opening_frames OR j.state='SUCCEEDED')) THEN RETURN false; END IF;
 END LOOP;
 SELECT count(*) FILTER(WHERE state='SUCCEEDED') INTO expected FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g;
 RETURN public.videoforge_hosted_video_manifest_valid_legacy248(a,w,g,(manifest-'video_policy')||jsonb_build_object(
  'schema_version',CASE WHEN expected=0 THEN 'resolved-render-manifest/v1' ELSE 'resolved-render-manifest/v2' END));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION public.videoforge_hosted_video_render_input_valid(a uuid,w uuid,r uuid,input jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=r AND replacement_policy IN('OPENING_180_V3','OPENING_CONFIG_V4')) THEN
  RETURN coalesce(input->>'schema_version'='render-job-input/v3'
   AND input->'video_policy' IS NOT DISTINCT FROM public.videoforge_hosted_video_opening_wire_policy(a,w,r)
   AND EXISTS(SELECT 1 FROM hosted_v209_ordinary_resolved_render_manifests m WHERE m.account_id=a AND m.workspace_id=w AND m.project_revision_id=r
    AND m.manifest_sha256=input#>>'{resolved_render_manifest,sha256}' AND public.videoforge_hosted_video_manifest_valid(a,w,m.generation_request_id,m.manifest_document)),false);
 END IF;
 RETURN public.videoforge_hosted_video_render_input_valid_before_opening267(a,w,r,input);
END; $$;

-- Extend the existing contextual failure classification only for this pinned
-- policy. The prefix still excludes the unchanged optional fallback whitelist.
DO $failure$
DECLARE definition text; marker text:=$old$p.replacement_policy='OPENING_180_V3'
    AND s.segment_key=j.segment_id AND s.start_frame<5400$old$;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_fail_hosted_video_job(uuid,uuid,uuid,uuid,text)'::regprocedure) INTO definition;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'configurable opening failure preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$p.replacement_policy IN('OPENING_180_V3','OPENING_CONFIG_V4')
    AND s.segment_key=j.segment_id AND s.start_frame<public.videoforge_hosted_video_opening_seconds(a,w,j.project_revision_id)*30$new$);
END; $failure$;

CREATE OR REPLACE FUNCTION public.videoforge_hosted_video_empty_avatar_allowed(a uuid,w uuid,r uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT a IS NOT DISTINCT FROM public.videoforge_current_account_id() AND EXISTS(
  SELECT 1 FROM hosted_video_plans p JOIN hosted_canonical_timing_bridges b
   ON b.account_id=p.account_id AND b.workspace_id=p.workspace_id AND b.project_revision_id=p.project_revision_id
  JOIN timeline_plans t ON t.account_id=b.account_id AND t.workspace_id=b.workspace_id AND t.id=b.timeline_plan_id AND t.project_revision_id=b.project_revision_id
  WHERE p.account_id=a AND p.workspace_id=w AND p.project_revision_id=r
   AND((p.replacement_policy='OPENING_180_V3' AND t.scheduler_version IN('scheduler-v8','scheduler-v9'))
    OR(p.replacement_policy='OPENING_CONFIG_V4' AND t.scheduler_version IN('scheduler-v10','scheduler-v11')
     AND EXISTS(SELECT 1 FROM project_revisions rev WHERE rev.account_id=a AND rev.workspace_id=w AND rev.id=r
      AND rev.revision_config_payload->'ai_video_opening_seconds' IS NOT DISTINCT FROM to_jsonb(p.opening_seconds)
      AND rev.revision_config_payload->>'scheduler_version'=t.scheduler_version)))
   AND NOT EXISTS(SELECT 1 FROM generation_tasks task WHERE task.account_id=a AND task.workspace_id=w AND task.project_revision_id=r AND task.lane='AVATAR')
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b.task_manifest) item WHERE item->>'lane'='AVATAR')
   AND EXISTS(SELECT 1 FROM timeline_segments s WHERE s.account_id=a AND s.workspace_id=w AND s.project_revision_id=r AND s.timeline_plan_id=t.id)
   AND NOT EXISTS(SELECT 1 FROM timeline_segments s WHERE s.account_id=a AND s.workspace_id=w AND s.project_revision_id=r AND s.timeline_plan_id=t.id AND s.timeline_composition<>'IMAGE_FULL'));
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_video_empty_avatar_allowed(uuid,uuid,uuid) FROM PUBLIC;
