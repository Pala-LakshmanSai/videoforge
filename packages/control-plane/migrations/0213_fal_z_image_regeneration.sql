-- New regenerations pin Fal Z-Image Turbo in their immutable input manifest.
-- Existing Kie jobs retain their provider and must never be resubmitted through Fal.
ALTER TABLE public.hosted_api_image_regeneration_jobs
  ALTER COLUMN source_api_job_id DROP NOT NULL,
  ADD COLUMN source_attempt_id uuid,
  ADD FOREIGN KEY(account_id,workspace_id,source_attempt_id)
    REFERENCES public.serverless_attempts(account_id,workspace_id,id),
  ADD CONSTRAINT hosted_api_image_regeneration_source_identity
    CHECK (num_nonnulls(source_api_job_id,source_attempt_id)=1);

CREATE OR REPLACE FUNCTION public.videoforge_read_hosted_api_image_regeneration_source(
  a uuid,w uuid,p uuid,r uuid,t uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE source_job public.hosted_api_generation_jobs%ROWTYPE; legacy_source jsonb;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM a THEN
    RAISE EXCEPTION 'API regeneration scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT job.* INTO source_job FROM public.projects project
    JOIN public.project_revisions revision ON revision.account_id=a AND revision.workspace_id=w
      AND revision.project_id=project.id
    JOIN public.generation_tasks task ON task.account_id=a AND task.workspace_id=w
      AND task.project_revision_id=revision.id AND task.id=t AND task.lane='IMAGE'
      AND task.state='COMPLETE'
    JOIN public.video_runtime_accepted_units unit ON unit.account_id=a AND unit.workspace_id=w
      AND unit.project_revision_id=r AND unit.item_id=t::text AND unit.lane='mage_image'
    JOIN public.hosted_api_generation_jobs job ON job.account_id=a AND job.workspace_id=w
      AND job.id=unit.api_job_id AND job.project_id=p AND job.project_revision_id=r
      AND job.generation_task_id=t AND job.lane='IMAGE' AND job.state='SUCCEEDED'
      AND unit.object_key=job.output_object_key AND unit.checksum_sha256=job.output_sha256
      AND unit.content_length=job.output_bytes
    JOIN public.assets asset ON asset.account_id=a AND asset.workspace_id=w
      AND asset.id=job.output_asset_id AND asset.state='ACCEPTED'
      AND asset.object_key=job.output_object_key AND asset.binary_sha256=job.output_sha256
    JOIN public.artifact_receipts receipt ON receipt.account_id=a AND receipt.workspace_id=w
      AND receipt.id=job.output_receipt_id AND receipt.deleted_at IS NULL
      AND receipt.object_key=job.output_object_key AND receipt.checksum_sha256=job.output_sha256
      AND receipt.content_length=job.output_bytes
    JOIN public.artifact_reservations reservation ON reservation.account_id=a
      AND reservation.workspace_id=w AND reservation.id=receipt.reservation_id
      AND reservation.state='COMMITTED' AND reservation.object_key=job.output_object_key
    WHERE project.account_id=a AND project.workspace_id=w AND project.id=p
      AND project.generation_provider='KIE_FAL' AND project.status='ACTIVE'
      AND revision.id=r AND revision.status='LOCKED'
      AND NOT EXISTS(SELECT 1 FROM public.project_revisions newer
        WHERE newer.account_id=a AND newer.workspace_id=w AND newer.project_id=p
          AND newer.revision_number>revision.revision_number);
  IF source_job.id IS NULL THEN
    -- A new Fal attempt may replace a historical still; the original RunPod attempt is untouched.
    SELECT jsonb_build_object('generationProvider','RUNPOD','sourceAttemptId',attempt.id,
      'generationRequestId',attempt.generation_request_id,
      'sourceInputManifest',jsonb_build_object('compiledPrompt',item.value->'compiledPrompt'),
      'sourceInputSha256','sha256:'||encode(sha256(convert_to(
        public.videoforge_canonical_jsonb(item.value->'compiledPrompt'),'UTF8')),'hex'),
      'imageTaskId',t,'projectId',p,'projectRevisionId',r)
      INTO legacy_source
      FROM public.projects project
      JOIN public.project_revisions revision ON revision.account_id=a AND revision.workspace_id=w
        AND revision.project_id=project.id AND revision.id=r AND revision.status='LOCKED'
      JOIN public.generation_tasks task ON task.account_id=a AND task.workspace_id=w
        AND task.project_revision_id=r AND task.id=t AND task.lane='IMAGE' AND task.state='COMPLETE'
      JOIN public.video_runtime_accepted_units unit ON unit.account_id=a AND unit.workspace_id=w
        AND unit.project_revision_id=r AND unit.item_id=t::text AND unit.lane='mage_image'
      JOIN public.serverless_attempts attempt ON attempt.account_id=a AND attempt.workspace_id=w
        AND attempt.id=unit.accepted_attempt_id AND attempt.project_id=p AND attempt.project_revision_id=r
      JOIN public.hosted_v209_ordinary_dispatch_candidates candidate ON candidate.account_id=a
        AND candidate.workspace_id=w AND candidate.generation_request_id=attempt.generation_request_id
        AND candidate.project_id=p AND candidate.project_revision_id=r
      JOIN public.artifact_reservations reservation ON reservation.account_id=a AND reservation.workspace_id=w
        AND reservation.project_id=p AND reservation.project_revision_id=r AND reservation.job_id=attempt.id::text
        AND reservation.artifact_id=t::text AND reservation.object_key=unit.object_key AND reservation.state='COMMITTED'
      JOIN public.artifact_receipts receipt ON receipt.account_id=a AND receipt.workspace_id=w
        AND receipt.reservation_id=reservation.id AND receipt.deleted_at IS NULL
        AND receipt.object_key=unit.object_key AND receipt.checksum_sha256=unit.checksum_sha256
        AND receipt.content_length=unit.content_length
      CROSS JOIN LATERAL jsonb_array_elements(candidate.candidate_document->'work'->'mage_image') item(value)
      WHERE project.account_id=a AND project.workspace_id=w AND project.id=p AND project.status='ACTIVE'
        AND project.generation_provider='RUNPOD' AND item.value->>'taskId'=t::text
        AND jsonb_typeof(item.value->'compiledPrompt')='object'
        AND NOT EXISTS(SELECT 1 FROM public.project_revisions newer WHERE newer.account_id=a
          AND newer.workspace_id=w AND newer.project_id=p AND newer.revision_number>revision.revision_number);
    RETURN legacy_source;
  END IF;
  RETURN jsonb_build_object('generationProvider','KIE_FAL','sourceApiJobId',source_job.id,
    'generationRequestId',source_job.generation_request_id,
    'sourceInputManifest',source_job.input_manifest,'sourceInputSha256',source_job.input_sha256,
    'imageTaskId',t,'projectId',p,'projectRevisionId',r);
END;
$$;

CREATE OR REPLACE FUNCTION public.videoforge_create_hosted_api_image_regeneration(
  a uuid,w uuid,p uuid,r uuid,t uuid,prompt text,supplied_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE found_job public.hosted_api_image_regeneration_jobs%ROWTYPE;
  source_data jsonb; job_id uuid; output_key text; manifest jsonb;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM a
     OR length(btrim(prompt)) NOT BETWEEN 1 AND 1000
     OR prompt IS DISTINCT FROM btrim(prompt)
     OR length(supplied_idempotency_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'API regeneration request invalid' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.global_generation_capacity WHERE singleton FOR UPDATE;
  SELECT * INTO found_job FROM public.hosted_api_image_regeneration_jobs job
    WHERE job.account_id=a AND job.workspace_id=w AND job.idempotency_key=supplied_idempotency_key;
  IF found_job.id IS NOT NULL THEN
    IF found_job.project_id IS DISTINCT FROM p OR found_job.project_revision_id IS DISTINCT FROM r
       OR found_job.image_task_id IS DISTINCT FROM t
       OR found_job.input_manifest->>'prompt' IS DISTINCT FROM prompt THEN
      RAISE EXCEPTION 'API regeneration idempotency conflict' USING ERRCODE='23505';
    END IF;
    RETURN public.videoforge_hosted_api_image_regeneration_json(found_job);
  END IF;
  IF EXISTS(SELECT 1 FROM public.hosted_image_regeneration_requests legacy
      WHERE legacy.account_id=a AND legacy.workspace_id=w AND legacy.image_task_id=t
        AND legacy.state IN ('QUEUED','PREPARED','SENT','ASSIGNED','DISPATCH_ACK_UNKNOWN')) THEN
    RAISE EXCEPTION 'historical image regeneration is still active' USING ERRCODE='55000';
  END IF;
  source_data:=public.videoforge_read_hosted_api_image_regeneration_source(a,w,p,r,t);
  IF source_data IS NULL THEN RAISE EXCEPTION 'current accepted API scene not found' USING ERRCODE='02000'; END IF;
  job_id:=gen_random_uuid();
  output_key:='tenant/'||a::text||'/workspace/'||w::text||'/project/'||p::text||
    '/revision/'||r::text||'/lane/mage-image/job/'||job_id::text||'/artifact/'||t::text;
  manifest:=jsonb_build_object('prompt',prompt,'aspectRatio','16:9',
    'provider','FAL_Z_IMAGE','model','fal-ai/z-image/turbo',
    'sourceApiJobId',source_data->>'sourceApiJobId',
    'sourceAttemptId',source_data->>'sourceAttemptId',
    'sourceInputSha256',source_data->>'sourceInputSha256');
  INSERT INTO public.hosted_api_image_regeneration_jobs(id,account_id,workspace_id,project_id,
    project_revision_id,generation_request_id,image_task_id,source_api_job_id,source_attempt_id,idempotency_key,
    input_manifest,input_sha256,output_object_key)
  VALUES(job_id,a,w,p,r,(source_data->>'generationRequestId')::uuid,t,
    (source_data->>'sourceApiJobId')::uuid,(source_data->>'sourceAttemptId')::uuid,supplied_idempotency_key,manifest,
    'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(manifest),'UTF8')),'hex'),
    output_key) RETURNING * INTO found_job;
  RETURN public.videoforge_hosted_api_image_regeneration_json(found_job);
END;
$$;

CREATE OR REPLACE FUNCTION public.videoforge_commit_hosted_api_image_regeneration(
  req uuid,supplied_sha256 text,supplied_bytes bigint,supplied_content_type text,supplied_probe jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_api_image_regeneration_jobs%ROWTYPE;
  asset_id uuid; reservation_id uuid; receipt_id uuid; receipt_facts jsonb;
  receipt_hash text; now_at timestamptz:=transaction_timestamp(); changed integer;
BEGIN
  SELECT * INTO job FROM public.hosted_api_image_regeneration_jobs j
    WHERE j.id=req AND j.account_id=public.videoforge_current_account_id() FOR UPDATE;
  IF job.id IS NULL THEN RAISE EXCEPTION 'API regeneration not found' USING ERRCODE='02000'; END IF;
  IF job.state='SUCCEEDED' THEN
    IF job.output_sha256 IS DISTINCT FROM supplied_sha256 OR job.output_bytes IS DISTINCT FROM supplied_bytes
       OR job.output_content_type IS DISTINCT FROM supplied_content_type THEN
      RAISE EXCEPTION 'API regeneration output replay drift' USING ERRCODE='23505';
    END IF;
    RETURN public.videoforge_hosted_api_image_regeneration_json(job);
  END IF;
  IF job.state<>'SUBMITTED' OR job.provider_task_id IS NULL
     OR supplied_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_bytes NOT BETWEEN 1 AND 10737418240
     OR supplied_content_type NOT IN ('image/png','image/jpeg')
     OR jsonb_typeof(supplied_probe)<>'object'
     OR (supplied_probe->>'width')::integer NOT BETWEEN 1 AND 16384
     OR (supplied_probe->>'height')::integer NOT BETWEEN 1 AND 16384 THEN
    RAISE EXCEPTION 'API regeneration output invalid' USING ERRCODE='23514';
  END IF;
  asset_id:=md5('hosted-api-image-regeneration-asset:'||job.id::text)::uuid;
  reservation_id:=md5('hosted-api-image-regeneration-reservation:'||job.id::text)::uuid;
  receipt_id:=md5('hosted-api-image-regeneration-receipt:'||job.id::text)::uuid;
  INSERT INTO public.assets(id,account_id,workspace_id,project_id,project_revision_id,
    kind,state,object_key,binary_sha256,content_type,byte_size,width_px,height_px,metadata,verified_at)
  VALUES(asset_id,job.account_id,job.workspace_id,job.project_id,job.project_revision_id,
    'IMAGE','ACCEPTED',job.output_object_key,supplied_sha256,supplied_content_type,supplied_bytes,
    (supplied_probe->>'width')::integer,(supplied_probe->>'height')::integer,
    jsonb_build_object('provider',coalesce(job.input_manifest->>'provider','KIE_Z_IMAGE'),
      'model',coalesce(job.input_manifest->>'model','z-image'),'providerTaskId',job.provider_task_id,
      'sourceApiJobId',job.source_api_job_id,'sourceAttemptId',job.source_attempt_id,'imageTaskId',job.image_task_id,'probe',supplied_probe),now_at);
  INSERT INTO public.artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,
    asset_id,lane,job_id,artifact_id,object_key,method,content_type,content_length,
    checksum_sha256,expires_at,max_uses,used_count,state,retention_class,retain_until,
    deletion_owner_account_id)
  VALUES(reservation_id,job.account_id,job.workspace_id,job.project_id,job.project_revision_id,
    asset_id,'MAGE_IMAGE',job.id::text,job.image_task_id::text,job.output_object_key,'PUT',
    supplied_content_type,supplied_bytes,supplied_sha256,now_at+interval '1 hour',1,1,
    'COMMITTED','PROJECT',NULL,job.account_id);
  receipt_facts:=jsonb_build_object('schema_version','artifact-commit-receipt/v3',
    'receipt_id',receipt_id,'reservation_id',reservation_id,'account_id',job.account_id,
    'workspace_id',job.workspace_id,'object_key',job.output_object_key,
    'callback_id','hosted-api-image-regeneration-'||receipt_id::text,
    'content_type',supplied_content_type,'content_length',supplied_bytes,
    'checksum_sha256',supplied_sha256,'probe',supplied_probe,'retention_class','PROJECT',
    'retain_until',NULL,'committed_at',
    to_char(now_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  receipt_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(receipt_facts),'UTF8')),'hex');
  INSERT INTO public.artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,
    object_key,content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at)
  VALUES(receipt_id,job.account_id,job.workspace_id,reservation_id,
    'hosted-api-image-regeneration-'||receipt_id::text,job.output_object_key,
    supplied_content_type,supplied_bytes,supplied_sha256,supplied_probe,receipt_hash,now_at);
  UPDATE public.hosted_api_image_regeneration_jobs SET state='SUCCEEDED',
    output_sha256=supplied_sha256,output_bytes=supplied_bytes,
    output_content_type=supplied_content_type,output_asset_id=asset_id,
    output_receipt_id=receipt_id,completed_at=now_at,updated_at=now_at
    WHERE id=job.id RETURNING * INTO job;
  UPDATE public.provider_workload_leases SET state='RELEASED',released_at=now_at,
    release_reason='API_IMAGE_REGENERATION_ACCEPTED',version=version+1,
    heartbeat_at=now_at,expires_at=greatest(expires_at,now_at+interval '1 second')
    WHERE id=job.lease_id AND account_id=job.account_id AND state='ACTIVE';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'API regeneration lease release failed' USING ERRCODE='55000'; END IF;
  RETURN public.videoforge_hosted_api_image_regeneration_json(job);
END;
$$;
