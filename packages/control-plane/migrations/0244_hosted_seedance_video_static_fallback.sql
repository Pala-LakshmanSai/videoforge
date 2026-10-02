-- Optional motion can fall back to its accepted original image after a definite,
-- bounded failure. Uncertain submissions, cancellation and price changes still fence.
CREATE FUNCTION public.videoforge_hosted_video_static_fallback(state text,code text,cost numeric,duration numeric) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public,pg_catalog AS $$
 SELECT coalesce(state='FAILED' AND code IN('SEEDANCE_RESULT_INVALID','SEEDANCE_CLIP_TOO_SHORT','SEEDANCE_PROVIDER_FAILED','SEEDANCE_SUBMIT_REJECTED','SEEDANCE_INPUT_INVALID')
  AND duration BETWEEN 1.2 AND 12 AND duration::text NOT IN('NaN','Infinity','-Infinity')
  AND (cost IS NULL OR(cost>=0 AND cost::text NOT IN('NaN','Infinity','-Infinity') AND cost<=duration*0.01336*1.10)),false)
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_video_static_fallback(text,text,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_hosted_video_static_fallback(text,text,numeric,numeric) TO videoforge_v209_runtime_dc9612d6;

CREATE OR REPLACE FUNCTION public.videoforge_hosted_videos_ready(a uuid,w uuid,g uuid) RETURNS boolean
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
  LEFT JOIN hosted_api_generation_jobs source ON source.account_id=j.account_id AND source.workspace_id=j.workspace_id AND source.generation_request_id=j.generation_request_id AND source.id=j.source_api_job_id AND source.task_key=j.source_task_key AND source.lane='IMAGE'
  LEFT JOIN assets original ON original.account_id=j.account_id AND original.workspace_id=j.workspace_id AND original.id=source.output_asset_id
  LEFT JOIN artifact_receipts original_receipt ON original_receipt.account_id=j.account_id AND original_receipt.workspace_id=j.workspace_id AND original_receipt.id=source.output_receipt_id
  LEFT JOIN assets asset ON asset.account_id=j.account_id AND asset.workspace_id=j.workspace_id AND asset.id=j.output_asset_id
  LEFT JOIN artifact_receipts receipt ON receipt.account_id=j.account_id AND receipt.workspace_id=j.workspace_id AND receipt.id=j.output_receipt_id
  WHERE j.account_id=a AND j.workspace_id=w AND j.generation_request_id=g AND(
   source.id IS NULL OR source.state<>'SUCCEEDED' OR source.output_sha256 IS DISTINCT FROM j.source_sha256 OR source.output_asset_id IS DISTINCT FROM j.source_asset_id
   OR original.id IS NULL OR original.kind<>'IMAGE' OR original.state<>'ACCEPTED' OR original.object_key IS DISTINCT FROM source.output_object_key OR original.binary_sha256 IS DISTINCT FROM source.output_sha256 OR original.byte_size IS DISTINCT FROM source.output_bytes
   OR original_receipt.id IS NULL OR original_receipt.deleted_at IS NOT NULL OR original_receipt.object_key IS DISTINCT FROM original.object_key OR original_receipt.checksum_sha256 IS DISTINCT FROM original.binary_sha256 OR original_receipt.content_length IS DISTINCT FROM original.byte_size
   OR CASE WHEN public.videoforge_hosted_video_static_fallback(j.state,j.failure_code,j.output_cost_usd,j.duration_seconds) THEN
      j.output_asset_id IS NOT NULL OR j.output_receipt_id IS NOT NULL OR j.output_sha256 IS NOT NULL OR j.output_bytes IS NOT NULL OR j.output_probe IS NOT NULL
    ELSE j.state<>'SUCCEEDED' OR asset.id IS NULL OR asset.kind<>'VIDEO_CLIP' OR asset.state<>'ACCEPTED' OR asset.object_key IS DISTINCT FROM j.output_object_key OR asset.binary_sha256 IS DISTINCT FROM j.output_sha256
     OR asset.byte_size IS DISTINCT FROM j.output_bytes OR receipt.id IS NULL OR receipt.deleted_at IS NOT NULL OR receipt.object_key IS DISTINCT FROM j.output_object_key OR receipt.checksum_sha256 IS DISTINCT FROM j.output_sha256 OR receipt.content_length IS DISTINCT FROM j.output_bytes END));
END; $$;

-- Close the existing render barrier when the final optional job failed safely.
-- This never accepts a video asset or changes its immutable FAILED identity.
CREATE FUNCTION public.videoforge_finalize_hosted_video_readiness(a uuid,w uuid,g uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE runtime video_runtime_states%ROWTYPE; changed integer; now_at timestamptz:=transaction_timestamp();
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'video readiness scope invalid' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g AND state='ACTIVE' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM hosted_video_plans p JOIN generation_requests request ON request.account_id=p.account_id AND request.workspace_id=p.workspace_id AND request.project_revision_id=p.project_revision_id WHERE p.account_id=a AND p.workspace_id=w AND request.id=g) OR NOT public.videoforge_hosted_videos_ready(a,w,g) THEN RETURN false; END IF;
 SELECT * INTO runtime FROM video_runtime_states WHERE account_id=a AND workspace_id=w AND generation_request_id=g FOR UPDATE;
 IF runtime.id IS NULL OR runtime.terminal_at IS NOT NULL THEN RETURN false; END IF;
 IF runtime.stage='RENDERING' THEN RETURN true; END IF;
 IF runtime.stage<>'WAITING_FOR_WORKER' OR (SELECT count(*) FROM video_runtime_lane_states WHERE runtime_id=runtime.id AND lane IN('mage_image','soulx_avatar') AND state='SUCCEEDED')<>2 THEN RETURN false; END IF;
 UPDATE video_runtime_states SET stage='RENDERING',version=version+1,updated_at=now_at WHERE id=runtime.id;
 UPDATE provider_workload_leases SET state='RELEASED',released_at=now_at,release_reason='HOSTED_API_OUTPUTS_ACCEPTED',version=version+1,heartbeat_at=now_at,expires_at=greatest(expires_at,now_at+interval '1 second') WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND state='ACTIVE';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'video readiness exact lease release missing' USING ERRCODE='55000'; END IF;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_finalize_hosted_video_readiness(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_finalize_hosted_video_readiness(uuid,uuid,uuid) TO videoforge_v209_runtime_dc9612d6;

CREATE OR REPLACE FUNCTION public.videoforge_hosted_video_manifest_valid(a uuid,w uuid,g uuid,manifest jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE expected integer; planned integer; video hosted_video_jobs%ROWTYPE; segment jsonb;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() OR manifest IS NULL OR jsonb_typeof(manifest->'segments') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 SELECT count(*),count(*) FILTER(WHERE state='SUCCEEDED') INTO planned,expected FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g;
 IF planned=0 THEN RETURN manifest->>'schema_version'='resolved-render-manifest/v1' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(manifest->'segments') s WHERE s#>'{accepted_assets,video}' IS NOT NULL); END IF;
 IF manifest->>'schema_version' IS DISTINCT FROM (CASE WHEN expected=0 THEN 'resolved-render-manifest/v1' ELSE 'resolved-render-manifest/v2' END)
  OR NOT public.videoforge_hosted_videos_ready(a,w,g) OR (SELECT count(*) FROM jsonb_array_elements(manifest->'segments') s WHERE s#>'{accepted_assets,video}' IS NOT NULL)<>expected THEN RETURN false; END IF;
 FOR video IN SELECT * FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(manifest->'segments') s WHERE s->>'segment_id'=video.segment_id)<>1 THEN RETURN false; END IF;
  SELECT s INTO segment FROM jsonb_array_elements(manifest->'segments') s WHERE s->>'segment_id'=video.segment_id;
  IF segment IS NULL OR segment->>'timeline_composition' IS DISTINCT FROM 'IMAGE_FULL'
   OR segment#>>'{accepted_assets,image,asset_id}' IS DISTINCT FROM video.source_asset_id::text OR segment#>>'{accepted_assets,image,sha256}' IS DISTINCT FROM video.source_sha256 THEN RETURN false; END IF;
  IF video.state='SUCCEEDED' THEN
   IF segment#>>'{accepted_assets,video,asset_id}' IS DISTINCT FROM video.output_asset_id::text OR segment#>>'{accepted_assets,video,sha256}' IS DISTINCT FROM video.output_sha256
    OR segment#>>'{render,video_source_profile}' IS DISTINCT FROM 'seedance-pro-fast-1248x704-v1' OR segment#>>'{render,video_frame_count}' IS DISTINCT FROM video.video_frame_count::text THEN RETURN false; END IF;
  ELSIF NOT public.videoforge_hosted_video_static_fallback(video.state,video.failure_code,video.output_cost_usd,video.duration_seconds)
   OR segment#>'{accepted_assets,video}' IS NOT NULL OR segment#>'{render,video_source_profile}' IS NOT NULL OR segment#>'{render,video_frame_count}' IS NOT NULL THEN RETURN false;
  END IF;
 END LOOP;
 RETURN true;
END; $$;

DO $patch$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_hosted_video_job_json(public.hosted_video_jobs)'::regprocedure) INTO definition;
 marker:=$old$'sourceSha256',j.source_sha256$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video fallback JSON preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$'staticFallback',public.videoforge_hosted_video_static_fallback(j.state,j.failure_code,j.output_cost_usd,j.duration_seconds),'sourceSha256',j.source_sha256$new$);
 SELECT pg_get_functiondef('public.videoforge_claim_hosted_video_job(uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 marker:=$old$state IN('UNKNOWN_NO_RETRY','FAILED')$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video fallback claim preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$(state='UNKNOWN_NO_RETRY' OR(state='FAILED' AND NOT public.videoforge_hosted_video_static_fallback(state,failure_code,output_cost_usd,duration_seconds)))$new$);
 SELECT pg_get_functiondef('public.videoforge_settle_hosted_api_failure(uuid,uuid,uuid)'::regprocedure) INTO definition;
 marker:=$old$generation_request_id=g AND state='FAILED')$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video fallback settlement preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$generation_request_id=g AND state='FAILED' AND NOT public.videoforge_hosted_video_static_fallback(state,failure_code,output_cost_usd,duration_seconds))$new$);
 SELECT pg_get_functiondef('public.videoforge_fail_hosted_video_job(uuid,uuid,uuid,uuid,text)'::regprocedure) INTO definition;
 marker:=$old$ SELECT * INTO j FROM hosted_video_jobs$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video fallback failure lock preimage drift'; END IF;
 definition:=replace(definition,marker,$new$ PERFORM 1 FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g FOR UPDATE;
 SELECT * INTO j FROM hosted_video_jobs$new$);
 marker:=$old$ RETURN public.videoforge_hosted_video_job_json(j);$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video fallback failure readiness preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$ PERFORM public.videoforge_finalize_hosted_video_readiness(a,w,g);
 RETURN public.videoforge_hosted_video_job_json(j);$new$);
 SELECT pg_get_functiondef('public.videoforge_hosted_video_render_input_valid(uuid,uuid,uuid,jsonb)'::regprocedure) INTO definition;
 marker:=$old$RETURN NOT EXISTS(SELECT 1 FROM hosted_video_plans p WHERE p.account_id=a AND p.workspace_id=w AND p.project_revision_id=r AND p.selections IS NOT NULL AND jsonb_array_length(p.selections)>0);$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video fallback render input preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$RETURN NOT EXISTS(SELECT 1 FROM hosted_video_plans p WHERE p.account_id=a AND p.workspace_id=w AND p.project_revision_id=r AND p.selections IS NOT NULL AND jsonb_array_length(p.selections)>0)
   OR EXISTS(SELECT 1 FROM hosted_v209_ordinary_resolved_render_manifests m WHERE m.account_id=a AND m.workspace_id=w AND m.project_revision_id=r AND m.manifest_sha256=input#>>'{resolved_render_manifest,sha256}' AND m.manifest_document->>'schema_version'='resolved-render-manifest/v1' AND public.videoforge_hosted_video_manifest_valid(a,w,m.generation_request_id,m.manifest_document));$new$);
END; $patch$;
