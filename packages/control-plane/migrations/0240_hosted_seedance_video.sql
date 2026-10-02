-- Future-only, immutable Seedance selections. Existing image/avatar acceptance remains intact.
CREATE TABLE public.hosted_video_plans (
  account_id uuid NOT NULL, workspace_id uuid NOT NULL, project_revision_id uuid PRIMARY KEY,
  model text NOT NULL DEFAULT 'bytedance:2@2' CHECK(model='bytedance:2@2'),
  width integer NOT NULL DEFAULT 1248 CHECK(width=1248), height integer NOT NULL DEFAULT 704 CHECK(height=704),
  coverage_percent integer NOT NULL DEFAULT 7 CHECK(coverage_percent=7),
  price_per_second_usd numeric NOT NULL DEFAULT 0.01336 CHECK(price_per_second_usd=0.01336),
  selections jsonb CHECK(selections IS NULL OR jsonb_typeof(selections)='array'),
  selection_sha256 text CHECK(selection_sha256 IS NULL OR selection_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), planned_at timestamptz,
  UNIQUE(account_id,workspace_id,project_revision_id),
  FOREIGN KEY(account_id,workspace_id,project_revision_id) REFERENCES public.project_revisions(account_id,workspace_id,id) ON DELETE RESTRICT,
  CHECK((selections IS NULL)=(selection_sha256 IS NULL)), CHECK((selections IS NULL)=(planned_at IS NULL))
);
ALTER TABLE public.artifact_receipts ADD CONSTRAINT artifact_receipts_tenant_id_uq UNIQUE(account_id,workspace_id,id);
CREATE TABLE public.hosted_video_jobs (
  id uuid PRIMARY KEY CHECK(id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'), account_id uuid NOT NULL, workspace_id uuid NOT NULL,
  project_id uuid NOT NULL, project_revision_id uuid NOT NULL, generation_request_id uuid NOT NULL,
  segment_id text NOT NULL, source_task_key text NOT NULL, video_frame_count integer NOT NULL CHECK(video_frame_count>0),
  duration_seconds numeric NOT NULL CHECK(duration_seconds BETWEEN 1.2 AND 12 AND duration_seconds*10=trunc(duration_seconds*10)),
  state text NOT NULL DEFAULT 'PREPARED' CHECK(state IN('PREPARED','SUBMITTING','SUBMITTED','UNKNOWN_NO_RETRY','SUCCEEDED','FAILED')),
  claim_id uuid, provider_task_id text, input_manifest jsonb, input_sha256 text,
  source_api_job_id uuid, source_asset_id uuid, source_sha256 text,
  output_object_key text NOT NULL, output_sha256 text, output_bytes bigint, output_asset_id uuid, output_receipt_id uuid,
  output_probe jsonb, output_cost_usd numeric, failure_code text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), submitted_at timestamptz, completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(account_id,workspace_id,id), UNIQUE(generation_request_id,segment_id), UNIQUE(account_id,workspace_id,output_object_key),
  FOREIGN KEY(account_id,workspace_id,generation_request_id) REFERENCES public.generation_requests(account_id,workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,workspace_id,project_revision_id) REFERENCES public.hosted_video_plans(account_id,workspace_id,project_revision_id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,workspace_id,source_api_job_id) REFERENCES public.hosted_api_generation_jobs(account_id,workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,workspace_id,source_asset_id) REFERENCES public.assets(account_id,workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,workspace_id,output_asset_id) REFERENCES public.assets(account_id,workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,workspace_id,output_receipt_id) REFERENCES public.artifact_receipts(account_id,workspace_id,id) ON DELETE RESTRICT,
  CHECK(video_frame_count<=duration_seconds*30),
  CHECK(provider_task_id IS NULL OR provider_task_id=id::text),
  CHECK(input_sha256 IS NULL OR input_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK(source_sha256 IS NULL OR source_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK(output_sha256 IS NULL OR output_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK(output_cost_usd IS NULL OR output_cost_usd BETWEEN 0 AND 1),
  CHECK(output_object_key='tenant/'||account_id||'/workspace/'||workspace_id||'/project/'||project_id||'/revision/'||project_revision_id||'/lane/scene-video/job/'||id||'/artifact/'||id),
  CHECK((state='PREPARED' AND claim_id IS NULL AND provider_task_id IS NULL AND input_manifest IS NULL)
    OR(state IN('SUBMITTING','UNKNOWN_NO_RETRY') AND claim_id IS NOT NULL AND input_manifest IS NOT NULL)
    OR(state IN('SUBMITTED','SUCCEEDED') AND claim_id IS NOT NULL AND provider_task_id IS NOT NULL AND input_manifest IS NOT NULL)
    OR(state='FAILED' AND claim_id IS NOT NULL)),
  CHECK(state<>'SUCCEEDED' OR(output_sha256 IS NOT NULL AND output_bytes IS NOT NULL AND output_bytes>0 AND output_asset_id IS NOT NULL
    AND output_receipt_id IS NOT NULL AND completed_at IS NOT NULL AND output_probe IS NOT NULL AND output_cost_usd IS NOT NULL))
);
CREATE INDEX hosted_video_jobs_request_idx ON public.hosted_video_jobs(account_id,workspace_id,generation_request_id,state);
ALTER TABLE public.hosted_video_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_video_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_video_plans_tenant ON public.hosted_video_plans USING(account_id=public.videoforge_current_account_id()) WITH CHECK(account_id=public.videoforge_current_account_id());
ALTER TABLE public.hosted_video_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_video_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_video_jobs_tenant ON public.hosted_video_jobs USING(account_id=public.videoforge_current_account_id()) WITH CHECK(account_id=public.videoforge_current_account_id());
CREATE TRIGGER hosted_video_plans_tenant_write BEFORE INSERT OR UPDATE ON public.hosted_video_plans FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER hosted_video_jobs_tenant_write BEFORE INSERT OR UPDATE ON public.hosted_video_jobs FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
REVOKE ALL ON public.hosted_video_plans,public.hosted_video_jobs FROM PUBLIC;

CREATE FUNCTION public.videoforge_hosted_video_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'video lineage is retained' USING ERRCODE='55000'; END IF;
 IF TG_TABLE_NAME='hosted_video_plans' THEN
  IF(to_jsonb(NEW)-ARRAY['selections','selection_sha256','planned_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['selections','selection_sha256','planned_at']) OR
    (OLD.selections IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
   RAISE EXCEPTION 'video plan is immutable' USING ERRCODE='23505'; END IF;
 ELSE
  IF(to_jsonb(NEW)-ARRAY['state','claim_id','provider_task_id','input_manifest','input_sha256','source_api_job_id','source_asset_id','source_sha256','output_sha256','output_bytes','output_asset_id','output_receipt_id','output_probe','output_cost_usd','failure_code','submitted_at','completed_at','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','claim_id','provider_task_id','input_manifest','input_sha256','source_api_job_id','source_asset_id','source_sha256','output_sha256','output_bytes','output_asset_id','output_receipt_id','output_probe','output_cost_usd','failure_code','submitted_at','completed_at','updated_at'])
    OR(OLD.state IN('SUCCEEDED','FAILED') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD))
    OR(OLD.input_manifest IS NOT NULL AND (NEW.input_manifest IS DISTINCT FROM OLD.input_manifest OR NEW.input_sha256 IS DISTINCT FROM OLD.input_sha256
      OR NEW.source_api_job_id IS DISTINCT FROM OLD.source_api_job_id OR NEW.source_asset_id IS DISTINCT FROM OLD.source_asset_id OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256))
    OR(OLD.output_cost_usd IS NOT NULL AND NEW.output_cost_usd IS DISTINCT FROM OLD.output_cost_usd)
    OR(OLD.claim_id IS NOT NULL AND NEW.claim_id IS DISTINCT FROM OLD.claim_id)
    OR(OLD.provider_task_id IS NOT NULL AND NEW.provider_task_id IS DISTINCT FROM OLD.provider_task_id)
    OR(NEW.state='PREPARED' AND OLD.state<>'PREPARED') THEN
   RAISE EXCEPTION 'video job identity is immutable and cannot replay' USING ERRCODE='23505'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER hosted_video_plans_immutable BEFORE UPDATE OR DELETE ON public.hosted_video_plans FOR EACH ROW EXECUTE FUNCTION public.videoforge_hosted_video_identity_guard();
CREATE TRIGGER hosted_video_jobs_immutable BEFORE UPDATE OR DELETE ON public.hosted_video_jobs FOR EACH ROW EXECUTE FUNCTION public.videoforge_hosted_video_identity_guard();

CREATE FUNCTION public.videoforge_pin_hosted_video_plan(a uuid,w uuid,r uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE plan hosted_video_plans%ROWTYPE;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() OR NOT EXISTS(
  SELECT 1 FROM project_revisions rev JOIN projects p ON p.account_id=rev.account_id AND p.workspace_id=rev.workspace_id AND p.id=rev.project_id
  WHERE rev.account_id=a AND rev.workspace_id=w AND rev.id=r AND p.generation_provider='KIE_FAL' AND p.status='ACTIVE') THEN
  RAISE EXCEPTION 'video plan scope invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=r;
 IF plan.project_revision_id IS NOT NULL THEN RETURN to_jsonb(plan); END IF;
 -- Only fresh creation opts in. Never retrofit existing canonical/provider work.
 IF EXISTS(SELECT 1 FROM hosted_canonical_timing_bridges b WHERE b.account_id=a AND b.workspace_id=w AND b.project_revision_id=r)
   OR EXISTS(SELECT 1 FROM hosted_api_generation_jobs j WHERE j.account_id=a AND j.workspace_id=w AND j.project_revision_id=r)
   OR EXISTS(SELECT 1 FROM generation_requests g WHERE g.account_id=a AND g.workspace_id=w AND g.project_revision_id=r) THEN
  RAISE EXCEPTION 'video plan must be pinned before generation' USING ERRCODE='23514'; END IF;
 INSERT INTO hosted_video_plans(account_id,workspace_id,project_revision_id) VALUES(a,w,r) ON CONFLICT(project_revision_id) DO NOTHING;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=r;
 RETURN to_jsonb(plan);
END; $$;

CREATE FUNCTION public.videoforge_plan_hosted_video_selections(a uuid,w uuid,r uuid,supplied_selections jsonb) RETURNS jsonb
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
    OR selected->>'videoFrameCount' !~ '^[1-9][0-9]*$' OR selected->>'durationSeconds' !~ '^[0-9]+(\.[0-9])?$'
    OR (selected->>'durationSeconds')::numeric NOT BETWEEN 1.2 AND 12 THEN RAISE EXCEPTION 'video selection shape invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO seg FROM timeline_segments WHERE account_id=a AND workspace_id=w AND project_revision_id=r AND segment_key=selected->>'segmentId' AND timeline_composition='IMAGE_FULL';
  IF seg.id IS NULL OR seg.required_slots#>>'{image,task_key}' IS DISTINCT FROM selected->>'sourceTaskKey'
    OR (selected->>'videoFrameCount')::integer>seg.end_frame_exclusive-seg.start_frame
    OR (selected->>'videoFrameCount')::integer>(selected->>'durationSeconds')::numeric*30
    OR NOT EXISTS(SELECT 1 FROM generation_tasks t WHERE t.account_id=a AND t.workspace_id=w AND t.project_revision_id=r AND t.task_key=selected->>'sourceTaskKey' AND t.lane='IMAGE') THEN
   RAISE EXCEPTION 'video selection must bind its full image scene' USING ERRCODE='23514'; END IF;
  selected_frames:=selected_frames+(selected->>'videoFrameCount')::integer;
 END LOOP;
 IF selected_frames>floor(total_frames*0.07) THEN RAISE EXCEPTION 'video selections exceed seven percent' USING ERRCODE='23514'; END IF;
 UPDATE hosted_video_plans SET selections=supplied_selections,
  selection_sha256='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(supplied_selections),'UTF8')),'hex'),planned_at=transaction_timestamp()
 WHERE account_id=a AND workspace_id=w AND project_revision_id=r RETURNING * INTO plan;
 RETURN to_jsonb(plan);
END; $$;

CREATE FUNCTION public.videoforge_hosted_video_job_json(j public.hosted_video_jobs) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT jsonb_build_object('id',j.id,'segmentId',j.segment_id,'taskKey','video:'||j.segment_id,'sourceTaskKey',j.source_task_key,
  'videoFrameCount',j.video_frame_count,'durationSeconds',j.duration_seconds,'state',j.state,'claimId',j.claim_id,'providerTaskId',j.provider_task_id,
  'inputManifest',coalesce(j.input_manifest,'{}'::jsonb),'inputSha256',j.input_sha256,'outputObjectKey',j.output_object_key,'failureCode',j.failure_code,
  'sourceSha256',j.source_sha256,'outputCostUsd',j.output_cost_usd,'createdAt',j.created_at,'submittedAt',j.submitted_at,'completedAt',j.completed_at,
  'sourceReady',EXISTS(SELECT 1 FROM hosted_api_generation_jobs source WHERE source.account_id=j.account_id AND source.workspace_id=j.workspace_id
    AND source.generation_request_id=j.generation_request_id AND source.task_key=j.source_task_key AND source.lane='IMAGE' AND source.state='SUCCEEDED'))
$$;
CREATE FUNCTION public.videoforge_read_hosted_video_jobs(a uuid,w uuid,g uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'video jobs scope invalid' USING ERRCODE='42501'; END IF;
 SELECT jsonb_agg(public.videoforge_hosted_video_job_json(j) ORDER BY j.segment_id) INTO result FROM hosted_video_jobs j WHERE j.account_id=a AND j.workspace_id=w AND j.generation_request_id=g;
 RETURN jsonb_build_object('generationRequestId',g,'jobs',coalesce(result,'[]'::jsonb),'requestState',(SELECT request.state FROM generation_requests request WHERE request.account_id=a AND request.workspace_id=w AND request.id=g),'hasPlan',EXISTS(SELECT 1 FROM hosted_video_plans p JOIN generation_requests request ON request.account_id=p.account_id AND request.workspace_id=p.workspace_id AND request.project_revision_id=p.project_revision_id WHERE p.account_id=a AND p.workspace_id=w AND request.id=g),
  'plannedJobCount',(SELECT jsonb_array_length(p.selections) FROM hosted_video_plans p JOIN generation_requests request ON request.account_id=p.account_id AND request.workspace_id=p.workspace_id AND request.project_revision_id=p.project_revision_id WHERE p.account_id=a AND p.workspace_id=w AND request.id=g));
END; $$;
CREATE FUNCTION public.videoforge_materialize_hosted_video_jobs(a uuid,w uuid,g uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE request generation_requests%ROWTYPE; plan hosted_video_plans%ROWTYPE; selected jsonb; source hosted_api_generation_jobs%ROWTYPE; jid uuid; output_key text; stored hosted_video_jobs%ROWTYPE;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'video jobs scope invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO request FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g AND state='ACTIVE' FOR UPDATE;
 IF request.id IS NULL THEN RAISE EXCEPTION 'video generation inactive' USING ERRCODE='23514'; END IF;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=request.project_revision_id;
 IF plan.project_revision_id IS NULL THEN RETURN public.videoforge_read_hosted_video_jobs(a,w,g); END IF;
 IF plan.selections IS NULL THEN RAISE EXCEPTION 'video selections unplanned' USING ERRCODE='23514'; END IF;
 FOR selected IN SELECT value FROM jsonb_array_elements(plan.selections) LOOP
  SELECT * INTO source FROM hosted_api_generation_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND task_key=selected->>'sourceTaskKey' AND lane='IMAGE';
  IF source.id IS NULL OR source.input_manifest->>'prompt' IS NULL THEN RAISE EXCEPTION 'video source image not materialized' USING ERRCODE='23514'; END IF;
  jid:=overlay(overlay(md5('hosted-seedance-video:'||g||':'||(selected->>'segmentId')) placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid;
  output_key:='tenant/'||a||'/workspace/'||w||'/project/'||request.project_id||'/revision/'||request.project_revision_id||'/lane/scene-video/job/'||jid||'/artifact/'||jid;
  INSERT INTO hosted_video_jobs(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,segment_id,source_task_key,video_frame_count,duration_seconds,output_object_key)
  VALUES(jid,a,w,request.project_id,request.project_revision_id,g,selected->>'segmentId',selected->>'sourceTaskKey',(selected->>'videoFrameCount')::integer,(selected->>'durationSeconds')::numeric,output_key)
  ON CONFLICT(generation_request_id,segment_id) DO NOTHING;
  SELECT * INTO stored FROM hosted_video_jobs WHERE generation_request_id=g AND segment_id=selected->>'segmentId';
  IF stored.id IS DISTINCT FROM jid OR stored.account_id<>a OR stored.workspace_id<>w OR stored.project_revision_id<>request.project_revision_id
   OR stored.source_task_key<>selected->>'sourceTaskKey' OR stored.video_frame_count<>(selected->>'videoFrameCount')::integer
   OR stored.duration_seconds<>(selected->>'durationSeconds')::numeric OR stored.output_object_key<>output_key THEN RAISE EXCEPTION 'video job materialization drift' USING ERRCODE='23505'; END IF;
 END LOOP;
 RETURN public.videoforge_read_hosted_video_jobs(a,w,g);
END; $$;

CREATE FUNCTION public.videoforge_claim_hosted_video_job(a uuid,w uuid,g uuid,jid uuid,claim uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE j hosted_video_jobs%ROWTYPE; source hosted_api_generation_jobs%ROWTYPE; manifest jsonb;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() OR claim IS NULL THEN RAISE EXCEPTION 'video claim scope invalid' USING ERRCODE='42501'; END IF;
 -- Request lock is the shared fence against terminalization and concurrent paid claims.
 PERFORM 1 FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g AND state='ACTIVE' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'video generation inactive' USING ERRCODE='23514'; END IF;
 SELECT * INTO j FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND id=jid FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'video job missing' USING ERRCODE='23514'; END IF;
 IF j.state<>'PREPARED' THEN RETURN public.videoforge_hosted_video_job_json(j); END IF;
 IF (SELECT count(*) FROM hosted_video_jobs WHERE generation_request_id=g AND state IN('SUBMITTING','SUBMITTED'))>=4
   OR EXISTS(SELECT 1 FROM hosted_video_jobs WHERE generation_request_id=g AND(state IN('UNKNOWN_NO_RETRY','FAILED') OR(state='SUBMITTING' AND claim_id IS DISTINCT FROM claim)))
   OR EXISTS(SELECT 1 FROM hosted_api_generation_jobs WHERE generation_request_id=g AND state IN('SUBMITTING','UNKNOWN_NO_RETRY','FAILED'))
   OR NOT EXISTS(SELECT 1 FROM provider_workload_leases WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND state='ACTIVE') THEN
  RETURN public.videoforge_hosted_video_job_json(j); END IF;
 SELECT * INTO source FROM hosted_api_generation_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND task_key=j.source_task_key AND lane='IMAGE' AND state='SUCCEEDED' FOR SHARE;
 IF source.id IS NULL THEN RETURN public.videoforge_hosted_video_job_json(j); END IF;
 IF NOT EXISTS(SELECT 1 FROM assets asset JOIN artifact_receipts receipt ON receipt.account_id=asset.account_id AND receipt.workspace_id=asset.workspace_id AND receipt.id=source.output_receipt_id
    WHERE asset.account_id=a AND asset.workspace_id=w AND asset.id=source.output_asset_id AND asset.state='ACCEPTED'
    AND asset.object_key=source.output_object_key AND asset.binary_sha256=source.output_sha256
    AND receipt.deleted_at IS NULL AND receipt.object_key=asset.object_key AND receipt.checksum_sha256=asset.binary_sha256 AND receipt.content_length=asset.byte_size) THEN
  RAISE EXCEPTION 'video source acceptance invalid' USING ERRCODE='23514'; END IF;
 manifest:=jsonb_build_object('model','bytedance:2@2','taskUUID',j.id,'width',1248,'height',704,'durationSeconds',j.duration_seconds,
  'prompt',(source.input_manifest->>'prompt')||' Animate this exact scene with subtle realistic physical movement. Preserve subject identity, materials, proportions and lighting. One continuous documentary shot. No cuts, text, captions, logos, graphics, borders or transitions.','cameraFixed',true,'sourceImageAssetId',source.output_asset_id,'sourceImageObjectKey',source.output_object_key,
  'sourceImageSha256',source.output_sha256,'sourceImageContentType',source.output_content_type,'sourceImageContentLength',source.output_bytes,
  'segmentId',j.segment_id,'sourceTaskKey',j.source_task_key,'videoFrameCount',j.video_frame_count,'pricePerSecondUsd',0.01336);
 UPDATE hosted_video_jobs SET state='SUBMITTING',claim_id=claim,input_manifest=manifest,
  input_sha256='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(manifest),'UTF8')),'hex'),
  source_api_job_id=source.id,source_asset_id=source.output_asset_id,source_sha256=source.output_sha256,updated_at=transaction_timestamp()
 WHERE id=j.id RETURNING * INTO j;
 RETURN public.videoforge_hosted_video_job_json(j);
END; $$;

CREATE FUNCTION public.videoforge_record_hosted_video_task(a uuid,w uuid,g uuid,jid uuid,claim uuid,task text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE j hosted_video_jobs%ROWTYPE;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'video task scope invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND id=jid FOR UPDATE;
 IF j.id IS NULL OR j.claim_id IS DISTINCT FROM claim OR task IS DISTINCT FROM j.id::text THEN RAISE EXCEPTION 'video task identity drift' USING ERRCODE='23505'; END IF;
 IF j.state IN('SUBMITTED','SUCCEEDED','FAILED') THEN
  IF j.provider_task_id IS DISTINCT FROM task THEN RAISE EXCEPTION 'video task replay drift' USING ERRCODE='23505'; END IF;
  RETURN public.videoforge_hosted_video_job_json(j);
 END IF;
 IF j.state NOT IN('SUBMITTING','UNKNOWN_NO_RETRY') THEN RAISE EXCEPTION 'video task state invalid' USING ERRCODE='23514'; END IF;
 UPDATE hosted_video_jobs SET state='SUBMITTED',provider_task_id=task,submitted_at=transaction_timestamp(),updated_at=transaction_timestamp() WHERE id=j.id RETURNING * INTO j;
 RETURN public.videoforge_hosted_video_job_json(j);
END; $$;
CREATE FUNCTION public.videoforge_mark_hosted_video_unknown(a uuid,w uuid,g uuid,jid uuid,claim uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE j hosted_video_jobs%ROWTYPE;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'video unknown scope invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND id=jid FOR UPDATE;
 IF j.id IS NULL OR j.claim_id IS DISTINCT FROM claim THEN RAISE EXCEPTION 'video claim identity drift' USING ERRCODE='23505'; END IF;
 IF j.state='SUBMITTING' THEN UPDATE hosted_video_jobs SET state='UNKNOWN_NO_RETRY',updated_at=transaction_timestamp() WHERE id=j.id RETURNING * INTO j; END IF;
 RETURN public.videoforge_hosted_video_job_json(j);
END; $$;
CREATE FUNCTION public.videoforge_fail_hosted_video_job(a uuid,w uuid,g uuid,jid uuid,code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE j hosted_video_jobs%ROWTYPE;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() OR code !~ '^[A-Z][A-Z0-9_]{1,119}$' THEN RAISE EXCEPTION 'video failure scope invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND id=jid FOR UPDATE;
 IF j.id IS NULL OR j.state NOT IN('SUBMITTING','SUBMITTED','FAILED') THEN RAISE EXCEPTION 'video failure state invalid' USING ERRCODE='23514'; END IF;
 IF j.state='FAILED' THEN
  IF j.failure_code IS DISTINCT FROM code THEN RAISE EXCEPTION 'video failure replay drift' USING ERRCODE='23505'; END IF;
 ELSE UPDATE hosted_video_jobs SET state='FAILED',failure_code=code,completed_at=transaction_timestamp(),updated_at=transaction_timestamp() WHERE id=j.id RETURNING * INTO j;
 END IF;
 RETURN public.videoforge_hosted_video_job_json(j);
END; $$;

-- Explicit media kinds and transfer lane; preserve every established kind/key.
ALTER TABLE public.assets DROP CONSTRAINT assets_kind_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_kind_check CHECK(kind IN('VOICEOVER','OPTIONAL_SCRIPT','AVATAR_ORIGINAL','AVATAR_RUNTIME','AVATAR_THUMBNAIL','STYLE_REFERENCE_ORIGINAL','STYLE_REFERENCE_NORMALIZED','CANONICAL_DOCUMENT','IMAGE','AVATAR_CLIP','AUDIO_SPAN','RENDER_PREVIEW','FINAL_VIDEO','OTHER','VIDEO_CLIP'));
ALTER TABLE public.artifact_reservations DROP CONSTRAINT artifact_reservations_lane_check;
ALTER TABLE public.artifact_reservations ADD CONSTRAINT artifact_reservations_lane_check CHECK(lane IN('INPUT','MAGE_IMAGE','SOULX_AVATAR','RENDER','PROVENANCE','SCENE_VIDEO'));
ALTER TABLE public.artifact_reservations DROP CONSTRAINT artifact_reservations_object_key_check;
ALTER TABLE public.artifact_reservations ADD CONSTRAINT artifact_reservations_object_key_check CHECK(object_key ~ '^tenant/[A-Za-z0-9._:-]+/workspace/[A-Za-z0-9._:-]+/project/[A-Za-z0-9._:-]+/revision/[A-Za-z0-9._:-]+/lane/(input|mage-image|soulx-avatar|render|provenance|scene-video)/job/[A-Za-z0-9._:-]+/artifact/[A-Za-z0-9._:-]+$');
DO $patch$
DECLARE definition text; marker text:=$old$WHEN 'PROVENANCE' THEN 'provenance'$old$;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_artifact_reservation_guard()'::regprocedure) INTO definition;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video artifact guard preimage drift'; END IF;
 EXECUTE replace(definition,marker,marker||E'\n    WHEN ''SCENE_VIDEO'' THEN ''scene-video''');
END; $patch$;

CREATE FUNCTION public.videoforge_hosted_videos_ready(a uuid,w uuid,g uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE plan hosted_video_plans%ROWTYPE; request generation_requests%ROWTYPE;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RETURN false; END IF;
 SELECT * INTO request FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g;
 IF request.id IS NULL THEN RETURN false; END IF;
 SELECT * INTO plan FROM hosted_video_plans WHERE account_id=a AND workspace_id=w AND project_revision_id=request.project_revision_id;
 IF plan.project_revision_id IS NULL THEN RETURN true; END IF;
 IF plan.selections IS NULL OR (SELECT count(*) FROM hosted_video_jobs j WHERE j.account_id=a AND j.workspace_id=w AND j.generation_request_id=g)<>jsonb_array_length(plan.selections) THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM hosted_video_jobs j
  LEFT JOIN assets asset ON asset.account_id=j.account_id AND asset.workspace_id=j.workspace_id AND asset.id=j.output_asset_id
  LEFT JOIN artifact_receipts receipt ON receipt.account_id=j.account_id AND receipt.workspace_id=j.workspace_id AND receipt.id=j.output_receipt_id
  LEFT JOIN hosted_api_generation_jobs source ON source.account_id=j.account_id AND source.workspace_id=j.workspace_id AND source.id=j.source_api_job_id
  WHERE j.account_id=a AND j.workspace_id=w AND j.generation_request_id=g AND(j.state<>'SUCCEEDED' OR asset.id IS NULL
   OR asset.kind<>'VIDEO_CLIP' OR asset.state<>'ACCEPTED' OR asset.object_key IS DISTINCT FROM j.output_object_key OR asset.binary_sha256 IS DISTINCT FROM j.output_sha256
   OR asset.byte_size IS DISTINCT FROM j.output_bytes OR receipt.id IS NULL OR receipt.deleted_at IS NOT NULL
   OR receipt.object_key IS DISTINCT FROM j.output_object_key OR receipt.checksum_sha256 IS DISTINCT FROM j.output_sha256 OR receipt.content_length IS DISTINCT FROM j.output_bytes
   OR source.id IS NULL OR source.state<>'SUCCEEDED' OR source.output_sha256 IS DISTINCT FROM j.source_sha256 OR source.output_asset_id IS DISTINCT FROM j.source_asset_id));
END; $$;

CREATE FUNCTION public.videoforge_commit_hosted_video_output(a uuid,w uuid,g uuid,jid uuid,digest text,bytes bigint,content_type text,probe jsonb,cost numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE j hosted_video_jobs%ROWTYPE; runtime video_runtime_states%ROWTYPE;
 asset uuid; reservation uuid; receipt uuid; now_at timestamptz:=transaction_timestamp(); facts jsonb; changed integer;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() OR digest IS NULL OR digest !~ '^sha256:[0-9a-f]{64}$'
  OR bytes IS NULL OR bytes NOT BETWEEN 1024 AND 33554432 OR content_type IS DISTINCT FROM 'video/mp4' OR probe IS NULL
  OR jsonb_typeof(probe)<>'object' OR cost IS NULL OR cost<0 OR cost>1 THEN RAISE EXCEPTION 'video output invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO j FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND id=jid FOR UPDATE;
 IF j.id IS NULL OR (probe->>'width')::integer IS DISTINCT FROM 1248 OR (probe->>'height')::integer IS DISTINCT FROM 704
  OR (probe->>'durationMs')::integer IS NULL OR abs((probe->>'durationMs')::integer-j.duration_seconds*1000)>100
  OR cost>j.duration_seconds*0.01336*1.10 THEN RAISE EXCEPTION 'video output contract or price invalid' USING ERRCODE='23514'; END IF;
 IF j.output_cost_usd IS NOT NULL AND j.output_cost_usd IS DISTINCT FROM cost THEN RAISE EXCEPTION 'video cost replay drift' USING ERRCODE='23505'; END IF;
 IF j.state='SUCCEEDED' THEN
  IF j.output_sha256 IS DISTINCT FROM digest OR j.output_bytes IS DISTINCT FROM bytes OR j.output_probe IS DISTINCT FROM probe OR j.output_cost_usd IS DISTINCT FROM cost THEN
   RAISE EXCEPTION 'video output replay drift' USING ERRCODE='23505'; END IF;
  RETURN public.videoforge_hosted_video_job_json(j);
 END IF;
 IF j.state<>'SUBMITTED' OR NOT EXISTS(SELECT 1 FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g AND state IN('ACTIVE','CANCELLING')) THEN
  RAISE EXCEPTION 'video output state invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO runtime FROM video_runtime_states WHERE account_id=a AND workspace_id=w AND generation_request_id=g FOR UPDATE;
 IF runtime.id IS NULL OR runtime.terminal_at IS NOT NULL OR runtime.stage<>'WAITING_FOR_WORKER' THEN RAISE EXCEPTION 'video output runtime invalid' USING ERRCODE='23514'; END IF;
 asset:=md5('hosted-video-asset:'||j.id)::uuid; reservation:=md5('hosted-video-reservation:'||j.id)::uuid; receipt:=md5('hosted-video-receipt:'||j.id)::uuid;
 INSERT INTO assets(id,account_id,workspace_id,project_id,project_revision_id,kind,state,object_key,binary_sha256,content_type,byte_size,width_px,height_px,duration_ms,metadata,verified_at)
 VALUES(asset,a,w,j.project_id,j.project_revision_id,'VIDEO_CLIP','ACCEPTED',j.output_object_key,digest,'video/mp4',bytes,1248,704,(probe->>'durationMs')::integer,
  jsonb_build_object('provider','RUNWARE_SEEDANCE','model','bytedance:2@2','providerTaskId',j.provider_task_id,'sourceAssetId',j.source_asset_id,'sourceSha256',j.source_sha256,'generationRequestId',g,'probe',probe,'costUsd',cost),now_at);
 INSERT INTO artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,asset_id,lane,job_id,artifact_id,object_key,method,content_type,content_length,checksum_sha256,expires_at,max_uses,used_count,state,retention_class,retain_until,deletion_owner_account_id)
 VALUES(reservation,a,w,j.project_id,j.project_revision_id,asset,'SCENE_VIDEO',j.id::text,j.id::text,j.output_object_key,'PUT','video/mp4',bytes,digest,now_at+interval '1 hour',1,1,'COMMITTED','PROJECT',NULL,a);
 facts:=jsonb_build_object('schema_version','artifact-commit-receipt/v3','receipt_id',receipt,'reservation_id',reservation,'account_id',a,'workspace_id',w,
  'object_key',j.output_object_key,'callback_id','hosted-video-'||receipt,'content_type','video/mp4','content_length',bytes,'checksum_sha256',digest,'probe',probe,
  'retention_class','PROJECT','retain_until',NULL,'committed_at',to_char(now_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 INSERT INTO artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at)
 VALUES(receipt,a,w,reservation,'hosted-video-'||receipt,j.output_object_key,'video/mp4',bytes,digest,probe,'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(facts),'UTF8')),'hex'),now_at);
 UPDATE hosted_video_jobs SET state='SUCCEEDED',output_sha256=digest,output_bytes=bytes,output_asset_id=asset,output_receipt_id=receipt,output_probe=probe,output_cost_usd=cost,completed_at=now_at,updated_at=now_at WHERE id=j.id RETURNING * INTO j;
 IF EXISTS(SELECT 1 FROM generation_requests WHERE id=g AND state='ACTIVE') AND public.videoforge_hosted_videos_ready(a,w,g) AND (SELECT count(*) FROM video_runtime_lane_states WHERE runtime_id=runtime.id AND lane IN('mage_image','soulx_avatar') AND state='SUCCEEDED')=2 THEN
  UPDATE video_runtime_states SET stage='RENDERING',version=version+1,updated_at=now_at WHERE id=runtime.id AND stage='WAITING_FOR_WORKER';
  UPDATE provider_workload_leases SET state='RELEASED',released_at=now_at,release_reason='HOSTED_API_OUTPUTS_ACCEPTED',version=version+1,heartbeat_at=now_at,expires_at=greatest(expires_at,now_at+interval '1 second')
  WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND state='ACTIVE';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'video exact lease release missing' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN public.videoforge_hosted_video_job_json(j);
END; $$;

-- Defer only the established final-lane transition. The output itself still commits normally.
DO $barrier$
DECLARE definition text; marker text:=$old$IF (SELECT count(*) FROM public.video_runtime_lane_states completed_lane$old$;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_commit_hosted_api_output(uuid,uuid,uuid,uuid,text,bigint,text,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video output barrier preimage drift'; END IF;

 marker:=$old$r.id=supplied_generation_request_id AND r.state='ACTIVE')$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video output cancellation preimage drift'; END IF;
 definition:=replace(definition,marker,$new$r.id=supplied_generation_request_id AND(r.state='ACTIVE' OR(r.state='CANCELLING' AND EXISTS(
  SELECT 1 FROM hosted_video_plans vp WHERE vp.account_id=supplied_account_id AND vp.workspace_id=supplied_workspace_id AND vp.project_revision_id=r.project_revision_id))))$new$);
 -- Repeat the barrier patch on the original definition before execution of both changes.
 definition:=replace(definition,$old$IF (SELECT count(*) FROM public.video_runtime_lane_states completed_lane$old$,
 $new$IF public.videoforge_hosted_videos_ready(supplied_account_id,supplied_workspace_id,supplied_generation_request_id)
     AND EXISTS(SELECT 1 FROM generation_requests WHERE id=supplied_generation_request_id AND state='ACTIVE')
     AND (SELECT count(*) FROM public.video_runtime_lane_states completed_lane$new$);
 EXECUTE definition;
END; $barrier$;

ALTER FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid) RENAME TO videoforge_read_hosted_v209_ready_render_inputs_before_video;
CREATE FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(a uuid,w uuid,g uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE ready jsonb; plan jsonb; videos jsonb;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() OR NOT public.videoforge_hosted_videos_ready(a,w,g) THEN RETURN NULL; END IF;
 ready:=public.videoforge_read_hosted_v209_ready_render_inputs_before_video(a,w,g);
 IF ready IS NULL THEN RETURN NULL; END IF;
 SELECT to_jsonb(p) INTO plan FROM hosted_video_plans p JOIN generation_requests request ON request.account_id=p.account_id AND request.workspace_id=p.workspace_id AND request.project_revision_id=p.project_revision_id
  WHERE p.account_id=a AND p.workspace_id=w AND request.id=g;
 IF plan IS NULL THEN RETURN ready; END IF;
 SELECT jsonb_agg(jsonb_build_object('taskId',j.id,'taskKey','video:'||j.segment_id,'segmentId',j.segment_id,'sourceTaskKey',j.source_task_key,
  'sourceSha256',j.source_sha256,'videoFrameCount',j.video_frame_count,'durationSeconds',j.duration_seconds,'acceptedAttemptId',j.id,'assetId',j.output_asset_id,
  'sha256',j.output_sha256,'objectKey',j.output_object_key,'contentType','video/mp4','contentLength',j.output_bytes,'receiptId',j.output_receipt_id,'lane','seedance_video','kind','VIDEO','costUsd',j.output_cost_usd) ORDER BY j.segment_id)
 INTO videos FROM hosted_video_jobs j WHERE j.account_id=a AND j.workspace_id=w AND j.generation_request_id=g AND j.state='SUCCEEDED';
 RETURN ready||jsonb_build_object('videoPlan',plan,'acceptedVideos',coalesce(videos,'[]'::jsonb));
END; $$;

-- Definite video failure shares the existing drain-before-terminalization policy.
ALTER FUNCTION public.videoforge_settle_hosted_api_failure(uuid,uuid,uuid) RENAME TO videoforge_settle_hosted_api_failure_before_video;
CREATE FUNCTION public.videoforge_settle_hosted_api_failure(a uuid,w uuid,g uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE request generation_requests%ROWTYPE; runtime video_runtime_states%ROWTYPE; changed integer; now_at timestamptz:=transaction_timestamp();
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'video settlement scope invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO request FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g FOR UPDATE;
 PERFORM 1 FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND state IN('SUBMITTING','UNKNOWN_NO_RETRY','SUBMITTED')) THEN RETURN jsonb_build_object('state','WAITING'); END IF;
 IF NOT EXISTS(SELECT 1 FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND state='FAILED') THEN
  RETURN public.videoforge_settle_hosted_api_failure_before_video(a,w,g);
 END IF;
 IF request.state='FAILED' THEN RETURN jsonb_build_object('state','SETTLED'); END IF;
 IF request.id IS NULL OR request.state<>'ACTIVE' THEN RAISE EXCEPTION 'video settlement request invalid' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM hosted_api_generation_jobs WHERE generation_request_id=g AND state IN('SUBMITTING','UNKNOWN_NO_RETRY','SUBMITTED')) THEN RETURN jsonb_build_object('state','WAITING'); END IF;
 SELECT * INTO runtime FROM video_runtime_states WHERE account_id=a AND workspace_id=w AND generation_request_id=g FOR UPDATE;
 IF runtime.id IS NULL OR runtime.stage<>'WAITING_FOR_WORKER' OR runtime.terminal_at IS NOT NULL THEN RAISE EXCEPTION 'video settlement runtime invalid' USING ERRCODE='23514'; END IF;
 UPDATE generation_tasks task SET state='FAILED',finished_at=now_at,version=task.version+1,updated_at=now_at FROM hosted_api_generation_jobs job
  WHERE job.account_id=a AND job.workspace_id=w AND job.generation_request_id=g AND job.generation_task_id=task.id AND task.state='BLOCKED' AND job.state IN('PREPARED','FAILED');
 UPDATE video_runtime_lane_states SET state='FAILED',version=version+1,updated_at=now_at WHERE runtime_id=runtime.id AND state NOT IN('SUCCEEDED','FAILED','CANCELED');
 UPDATE video_runtime_states SET stage='FAILED',terminal_reason='LANE_PERMANENT_FAILURE',terminal_at=now_at,version=version+1,updated_at=now_at WHERE id=runtime.id;
 UPDATE generation_requests SET state='FAILED',terminal_at=now_at,version=version+1,updated_at=now_at WHERE id=g;
 UPDATE provider_workload_leases SET state='RELEASED',released_at=now_at,release_reason='HOSTED_API_PROVIDER_FAILED',version=version+1,heartbeat_at=now_at,expires_at=greatest(expires_at,now_at+interval '1 second') WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND state='ACTIVE';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'video failure exact lease release missing' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object('state','SETTLED');
END; $$;

-- Guard every release/Cloud terminal path, including functions outside API generation.
CREATE FUNCTION public.videoforge_hosted_video_resource_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='provider_workload_leases' THEN
  IF OLD.state='ACTIVE' AND NEW.state<>'ACTIVE' AND EXISTS(SELECT 1 FROM hosted_video_jobs j WHERE j.account_id=NEW.account_id AND j.workspace_id=NEW.workspace_id AND j.generation_request_id=NEW.generation_request_id AND j.state IN('SUBMITTING','UNKNOWN_NO_RETRY','SUBMITTED')) THEN
   RAISE EXCEPTION 'video paid identities must settle before lease release' USING ERRCODE='55000'; END IF;
 ELSIF NEW.state='CLEAN' AND EXISTS(SELECT 1 FROM hosted_video_jobs j WHERE j.account_id=NEW.account_id AND j.workspace_id=NEW.workspace_id AND j.project_revision_id=NEW.project_revision_id AND j.state IN('SUBMITTING','UNKNOWN_NO_RETRY','SUBMITTED')) THEN
  RAISE EXCEPTION 'video provider state is unsettled' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER hosted_video_lease_guard BEFORE UPDATE ON public.provider_workload_leases FOR EACH ROW EXECUTE FUNCTION public.videoforge_hosted_video_resource_guard();
CREATE TRIGGER hosted_video_cloud_guard BEFORE UPDATE ON public.cloud_media_reservations FOR EACH ROW EXECUTE FUNCTION public.videoforge_hosted_video_resource_guard();

-- An owner stop prevents new POSTs, drains exact persisted identities, and retains accepted media.
CREATE FUNCTION public.videoforge_settle_hosted_video_cancellation(a uuid,w uuid,g uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE request generation_requests%ROWTYPE; runtime video_runtime_states%ROWTYPE; now_at timestamptz:=transaction_timestamp(); changed integer;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'video cancellation scope invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO request FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g FOR UPDATE;
 IF request.state='CANCELLED' THEN RETURN jsonb_build_object('state','SETTLED'); END IF;
 IF request.id IS NULL OR request.state<>'CANCELLING' OR NOT EXISTS(SELECT 1 FROM hosted_video_plans p WHERE p.account_id=a AND p.workspace_id=w AND p.project_revision_id=request.project_revision_id) THEN
  RETURN jsonb_build_object('state','NOT_CANCELLING'); END IF;
 PERFORM 1 FROM hosted_api_generation_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g ORDER BY id FOR UPDATE;
 PERFORM 1 FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM hosted_api_generation_jobs WHERE generation_request_id=g AND state IN('SUBMITTING','UNKNOWN_NO_RETRY','SUBMITTED'))
  OR EXISTS(SELECT 1 FROM hosted_video_jobs WHERE generation_request_id=g AND state IN('SUBMITTING','UNKNOWN_NO_RETRY','SUBMITTED')) THEN
  RETURN jsonb_build_object('state','WAITING'); END IF;
 SELECT * INTO runtime FROM video_runtime_states WHERE account_id=a AND workspace_id=w AND generation_request_id=g FOR UPDATE;
 IF runtime.id IS NULL OR runtime.stage<>'WAITING_FOR_WORKER' OR runtime.terminal_at IS NOT NULL THEN RAISE EXCEPTION 'video cancellation runtime invalid' USING ERRCODE='23514'; END IF;
 UPDATE generation_tasks task SET state='CANCELLED',finished_at=now_at,version=task.version+1,updated_at=now_at FROM hosted_api_generation_jobs job
  WHERE job.account_id=a AND job.workspace_id=w AND job.generation_request_id=g AND job.generation_task_id=task.id AND task.state='BLOCKED' AND job.state='FAILED';
 UPDATE video_runtime_lane_states SET state='CANCELED',version=version+1,updated_at=now_at WHERE runtime_id=runtime.id AND state NOT IN('SUCCEEDED','FAILED','CANCELED');
 UPDATE video_runtime_states SET stage='CANCELED',terminal_reason='OWNER_CANCELLED',terminal_at=now_at,version=version+1,updated_at=now_at WHERE id=runtime.id;
 UPDATE generation_requests SET state='CANCELLED',terminal_at=now_at,version=version+1,updated_at=now_at WHERE id=g;
 UPDATE provider_workload_leases SET state='RELEASED',released_at=now_at,release_reason='OWNER_CANCELLED_VIDEO_DRAINED',version=version+1,heartbeat_at=now_at,expires_at=greatest(expires_at,now_at+interval '1 second') WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND state='ACTIVE';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'video cancellation exact lease release missing' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object('state','SETTLED');
END; $$;
ALTER FUNCTION public.videoforge_cancel_hosted_project_predispatch(uuid,uuid,uuid) RENAME TO videoforge_cancel_hosted_project_predispatch_before_video;
CREATE FUNCTION public.videoforge_cancel_hosted_project_predispatch(a uuid,w uuid,p uuid)
RETURNS TABLE(project_id uuid,generation_request_id uuid,state text,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE request generation_requests%ROWTYPE; now_at timestamptz:=transaction_timestamp(); result jsonb; was_cancelling boolean;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'video cancellation scope invalid' USING ERRCODE='42501'; END IF;
 SELECT g.* INTO request FROM generation_requests g JOIN hosted_video_plans plan ON plan.account_id=g.account_id AND plan.workspace_id=g.workspace_id AND plan.project_revision_id=g.project_revision_id
  WHERE g.account_id=a AND g.workspace_id=w AND g.project_id=p AND g.state IN('ACTIVE','CANCELLING')
   AND EXISTS(SELECT 1 FROM hosted_api_generation_jobs api WHERE api.account_id=a AND api.workspace_id=w AND api.generation_request_id=g.id)
  ORDER BY g.created_at DESC,g.id DESC LIMIT 1 FOR UPDATE OF g;
 IF request.id IS NULL THEN RETURN QUERY SELECT * FROM public.videoforge_cancel_hosted_project_predispatch_before_video(a,w,p); RETURN; END IF;
 -- Render/CPU cancellation keeps its original exact authority path.
 IF NOT EXISTS(SELECT 1 FROM video_runtime_states runtime WHERE runtime.account_id=a AND runtime.workspace_id=w AND runtime.generation_request_id=request.id AND runtime.stage='WAITING_FOR_WORKER' AND runtime.terminal_at IS NULL) THEN
  RETURN QUERY SELECT * FROM public.videoforge_cancel_hosted_project_predispatch_before_video(a,w,p); RETURN; END IF;
 was_cancelling:=request.state='CANCELLING';
 PERFORM 1 FROM hosted_api_generation_jobs WHERE account_id=a AND workspace_id=w AND hosted_api_generation_jobs.generation_request_id=request.id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND hosted_video_jobs.generation_request_id=request.id ORDER BY id FOR UPDATE;
 UPDATE generation_requests SET state='CANCELLING',version=version+1,updated_at=now_at WHERE id=request.id AND generation_requests.state='ACTIVE';
 UPDATE hosted_api_generation_jobs SET state='FAILED',claim_id=md5('owner-video-cancel:'||id)::uuid,failure_code='OWNER_CANCELLED_BEFORE_SUBMIT',completed_at=now_at,updated_at=now_at
  WHERE account_id=a AND workspace_id=w AND hosted_api_generation_jobs.generation_request_id=request.id AND hosted_api_generation_jobs.state='PREPARED';
 UPDATE hosted_video_jobs SET state='FAILED',claim_id=md5('owner-video-cancel:'||id)::uuid,failure_code='OWNER_CANCELLED_BEFORE_SUBMIT',completed_at=now_at,updated_at=now_at
  WHERE account_id=a AND workspace_id=w AND hosted_video_jobs.generation_request_id=request.id AND hosted_video_jobs.state='PREPARED';
 result:=public.videoforge_settle_hosted_video_cancellation(a,w,request.id);
 RETURN QUERY SELECT p,request.id,CASE WHEN result->>'state'='SETTLED' THEN 'CANCELLED' ELSE 'CANCELLING' END,was_cancelling;
END; $$;

-- New capabilities only; renamed predecessors keep their original restricted grants.
DO $permissions$
DECLARE fn record;
BEGIN
 FOR fn IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname LIKE 'videoforge_%hosted_video_%' OR p.proname='videoforge_hosted_videos_ready')
 LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||fn.signature||' FROM PUBLIC'; END LOOP;
END; $permissions$;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid),public.videoforge_settle_hosted_api_failure(uuid,uuid,uuid),public.videoforge_cancel_hosted_project_predispatch(uuid,uuid,uuid) FROM PUBLIC;
GRANT SELECT ON public.hosted_video_plans,public.hosted_video_jobs TO videoforge_v209_runtime_dc9612d6;
GRANT EXECUTE ON FUNCTION public.videoforge_pin_hosted_video_plan(uuid,uuid,uuid),public.videoforge_plan_hosted_video_selections(uuid,uuid,uuid,jsonb),public.videoforge_materialize_hosted_video_jobs(uuid,uuid,uuid),public.videoforge_read_hosted_video_jobs(uuid,uuid,uuid),public.videoforge_claim_hosted_video_job(uuid,uuid,uuid,uuid,uuid),public.videoforge_record_hosted_video_task(uuid,uuid,uuid,uuid,uuid,text),public.videoforge_mark_hosted_video_unknown(uuid,uuid,uuid,uuid,uuid),public.videoforge_fail_hosted_video_job(uuid,uuid,uuid,uuid,text),public.videoforge_commit_hosted_video_output(uuid,uuid,uuid,uuid,text,bigint,text,jsonb,numeric),public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid),public.videoforge_settle_hosted_api_failure(uuid,uuid,uuid),public.videoforge_cancel_hosted_project_predispatch(uuid,uuid,uuid) TO videoforge_v209_runtime_dc9612d6;

GRANT EXECUTE ON FUNCTION public.videoforge_settle_hosted_video_cancellation(uuid,uuid,uuid) TO videoforge_v209_runtime_dc9612d6;

-- The v2 manifest adds only accepted video bindings; all original image/avatar proofs remain.
CREATE FUNCTION public.videoforge_hosted_video_manifest_valid(a uuid,w uuid,g uuid,manifest jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE expected integer; video hosted_video_jobs%ROWTYPE; segment jsonb;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() OR manifest IS NULL OR jsonb_typeof(manifest->'segments') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 SELECT count(*) INTO expected FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g;
 IF expected=0 THEN RETURN manifest->>'schema_version'='resolved-render-manifest/v1' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(manifest->'segments') s WHERE s#>'{accepted_assets,video}' IS NOT NULL); END IF;
 IF manifest->>'schema_version' IS DISTINCT FROM 'resolved-render-manifest/v2' OR NOT public.videoforge_hosted_videos_ready(a,w,g)
  OR (SELECT count(*) FROM jsonb_array_elements(manifest->'segments') s WHERE s#>'{accepted_assets,video}' IS NOT NULL)<>expected THEN RETURN false; END IF;
 FOR video IN SELECT * FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(manifest->'segments') s WHERE s->>'segment_id'=video.segment_id)<>1 THEN RETURN false; END IF;
  SELECT s INTO segment FROM jsonb_array_elements(manifest->'segments') s WHERE s->>'segment_id'=video.segment_id;
  IF segment IS NULL OR segment->>'timeline_composition' IS DISTINCT FROM 'IMAGE_FULL'
   OR segment#>>'{accepted_assets,video,asset_id}' IS DISTINCT FROM video.output_asset_id::text
   OR segment#>>'{accepted_assets,video,sha256}' IS DISTINCT FROM video.output_sha256
   OR segment#>>'{accepted_assets,image,asset_id}' IS DISTINCT FROM video.source_asset_id::text
   OR segment#>>'{accepted_assets,image,sha256}' IS DISTINCT FROM video.source_sha256
   OR segment#>>'{render,video_source_profile}' IS DISTINCT FROM 'seedance-pro-fast-1248x704-v1'
   OR segment#>>'{render,video_frame_count}' IS DISTINCT FROM video.video_frame_count::text THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END; $$;
CREATE FUNCTION public.videoforge_hosted_video_render_input_valid(a uuid,w uuid,r uuid,input jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RETURN false; END IF;
 IF input->>'schema_version'='render-job-input/v1' THEN
  RETURN NOT EXISTS(SELECT 1 FROM hosted_video_plans p WHERE p.account_id=a AND p.workspace_id=w AND p.project_revision_id=r AND p.selections IS NOT NULL AND jsonb_array_length(p.selections)>0);
 END IF;
 RETURN input->>'schema_version'='render-job-input/v2' AND EXISTS(
  SELECT 1 FROM hosted_v209_ordinary_resolved_render_manifests m WHERE m.account_id=a AND m.workspace_id=w AND m.project_revision_id=r
   AND m.manifest_sha256=input#>>'{resolved_render_manifest,sha256}' AND public.videoforge_hosted_video_manifest_valid(a,w,m.generation_request_id,m.manifest_document));
END; $$;
DO $manifest$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_commit_hosted_v209_resolved_render_manifest(uuid,uuid,uuid,jsonb,text,text,bigint)'::regprocedure) INTO definition;
 marker:=$old$supplied_manifest->>'schema_version'<>'resolved-render-manifest/v1'$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video manifest version preimage drift'; END IF;
 definition:=replace(definition,marker,$new$NOT public.videoforge_hosted_video_manifest_valid(supplied_account_id,supplied_workspace_id,supplied_generation_request_id,supplied_manifest)$new$);
 marker:=$old$'resolved-render-manifest','v1',supplied_manifest_sha256$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video manifest metadata preimage drift'; END IF;
 definition:=replace(definition,marker,$new$'resolved-render-manifest',CASE supplied_manifest->>'schema_version' WHEN 'resolved-render-manifest/v2' THEN 'v2' ELSE 'v1' END,supplied_manifest_sha256$new$);
 marker:=$old$jsonb_build_object('schemaVersion','resolved-render-manifest/v1')$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video manifest receipt preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$jsonb_build_object('schemaVersion',supplied_manifest->>'schema_version')$new$);
 SELECT pg_get_functiondef('public.videoforge_finalize_v209_render_terminal_legacy222(jsonb)'::regprocedure) INTO definition;
 marker:=$old$plan.payload#>>'{input_document,schema_version}'<>'render-job-input/v1'$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video render terminal version preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$NOT public.videoforge_hosted_video_render_input_valid(account_id,workspace_id,attempt.project_revision_id,plan.payload->'input_document')$new$);
 SELECT pg_get_functiondef('public.videoforge_cloud_render_inputs_valid(uuid)'::regprocedure) INTO definition;
 marker:=$old$input->>'schema_version' IS DISTINCT FROM 'render-job-input/v1'$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video Cloud input version preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$NOT public.videoforge_hosted_video_render_input_valid(a.account_id,a.workspace_id,a.project_revision_id,input)$new$);
END; $manifest$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_video_manifest_valid(uuid,uuid,uuid,jsonb),public.videoforge_hosted_video_render_input_valid(uuid,uuid,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.videoforge_record_hosted_video_cost(a uuid,w uuid,g uuid,jid uuid,cost numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE j hosted_video_jobs%ROWTYPE;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() OR cost IS NULL OR cost<0 OR cost>1 THEN RAISE EXCEPTION 'video cost invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO j FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND id=jid FOR UPDATE;
 IF j.id IS NULL OR j.state='PREPARED' OR cost>j.duration_seconds*0.01336*1.10 THEN RAISE EXCEPTION 'video cost state or price invalid' USING ERRCODE='23514'; END IF;
 IF j.output_cost_usd IS NOT NULL THEN
  IF j.output_cost_usd IS DISTINCT FROM cost THEN RAISE EXCEPTION 'video cost replay drift' USING ERRCODE='23505'; END IF;
 ELSE
  IF j.state IN('FAILED','SUCCEEDED') THEN RAISE EXCEPTION 'video cost must precede terminal output' USING ERRCODE='23514'; END IF;
  UPDATE hosted_video_jobs SET output_cost_usd=cost,updated_at=transaction_timestamp() WHERE id=j.id RETURNING * INTO j;
 END IF;
 RETURN public.videoforge_hosted_video_job_json(j);
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_record_hosted_video_cost(uuid,uuid,uuid,uuid,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_record_hosted_video_cost(uuid,uuid,uuid,uuid,numeric) TO videoforge_v209_runtime_dc9612d6;
