-- Future plans opt in; saved plans/jobs retain their original camera and prompt bytes.
ALTER TABLE public.hosted_video_plans ADD COLUMN motion_policy text NOT NULL DEFAULT 'FIXED_CAMERA_V1'
 CHECK(motion_policy IN('FIXED_CAMERA_V1','NATURAL_HANDHELD_V1'));

CREATE FUNCTION public.videoforge_natural_footage_motion(slot integer) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_catalog AS $$
DECLARE move text; direction text; prompt text;
BEGIN
 IF slot IS NULL OR slot<0 THEN RAISE EXCEPTION 'motion slot invalid' USING ERRCODE='23514'; END IF;
 move:=CASE mod(slot,10) WHEN 2 THEN 'PAN_IN' WHEN 8 THEN 'PAN_IN' WHEN 5 THEN 'PAN_OUT' ELSE 'PAN' END;
 direction:=CASE WHEN mod(slot,2)=0 THEN 'right' ELSE 'left' END;
 prompt:='One continuous casual handheld view of the supplied reference scene. Preserve its subjects, objects, materials, proportions and setting. '
  ||'Slowly pan a few degrees to the '||direction||' with tiny natural hand drift, keeping the main subject in view. '
  ||CASE move WHEN 'PAN_IN' THEN 'At the same time, gently move the viewpoint a few centimeters closer, with subtle natural depth and a slight tightening of the framing, roughly five percent. '
    WHEN 'PAN_OUT' THEN 'At the same time, gently move the viewpoint a few centimeters back, with subtle natural depth and a slight widening of the framing, roughly five percent. '
    ELSE 'Keep approximately the same distance and subject size. ' END
  ||CASE WHEN mod(slot,20) IN(4,11,18) THEN 'If the reference already suggests an activity, continue that same activity with modest, unhurried motion; otherwise keep the subject quiet. '
    ELSE 'Continue at most one small plausible action already suggested by the reference; otherwise only tiny ambient movement. ' END
  ||'Use ordinary available environmental light consistent with the reference, everyday exposure and color, slightly soft natural detail and an unpolished recorded feel. '
  ||'Keep anatomy, object contact and positions coherent throughout. No invented people, props, visible filming equipment or extra observers. '
  ||'No dramatic camera moves, rapid zoom, busy simultaneous actions, cinematic lighting, glossy grading or artificial sharpening. No cuts, text, captions, logos, graphics, borders, watermarks or transitions.';
 RETURN jsonb_build_object('motionPolicy','NATURAL_HANDHELD_V1','cameraMotion',move,'cameraFixed',false,'prompt',prompt);
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_natural_footage_motion(integer) FROM PUBLIC;

DO $patch$
DECLARE definition text; marker text;
BEGIN
 definition:=pg_get_functiondef('public.videoforge_pin_hosted_video_plan(uuid,uuid,uuid,integer,text,integer)'::regprocedure);
 marker:=$old$INSERT INTO hosted_video_plans(account_id,workspace_id,project_revision_id,coverage_percent,replacement_policy,opening_seconds)
 VALUES(a,w,r,supplied_coverage,supplied_policy,supplied_seconds)$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'natural motion pin preimage drift'; END IF;
 definition:=replace(definition,marker,$new$INSERT INTO hosted_video_plans(account_id,workspace_id,project_revision_id,coverage_percent,replacement_policy,opening_seconds,motion_policy)
 VALUES(a,w,r,supplied_coverage,supplied_policy,supplied_seconds,CASE WHEN supplied_policy='FOOTAGE_COMPOSITION_V5' THEN 'NATURAL_HANDHELD_V1' ELSE 'FIXED_CAMERA_V1' END)$new$);
 EXECUTE definition;

 definition:=pg_get_functiondef('public.videoforge_claim_hosted_video_job(uuid,uuid,uuid,uuid,uuid)'::regprocedure);
 marker:=$old$UPDATE hosted_video_jobs SET state='SUBMITTING',claim_id=claim,input_manifest=manifest,$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'natural motion claim preimage drift'; END IF;
 definition:=replace(definition,marker,$new$IF EXISTS(SELECT 1 FROM hosted_video_plans plan WHERE plan.account_id=a AND plan.workspace_id=w AND plan.project_revision_id=j.project_revision_id AND plan.motion_policy='NATURAL_HANDHELD_V1') THEN
  manifest:=manifest||public.videoforge_natural_footage_motion((SELECT (selection.ordinality-1)::integer
   FROM hosted_video_plans plan CROSS JOIN LATERAL jsonb_array_elements(plan.selections) WITH ORDINALITY selection(value,ordinality)
   WHERE plan.account_id=a AND plan.workspace_id=w AND plan.project_revision_id=j.project_revision_id AND selection.value->>'segmentId'=j.segment_id));
 END IF;
 UPDATE hosted_video_jobs SET state='SUBMITTING',claim_id=claim,input_manifest=manifest,$new$);
 EXECUTE definition;
END; $patch$;
