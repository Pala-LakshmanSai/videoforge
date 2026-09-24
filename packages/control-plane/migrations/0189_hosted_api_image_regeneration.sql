-- Isolated Kie image regeneration for projects pinned to the API provider.
-- The original accepted image and final MP4 remain immutable.
CREATE TABLE public.hosted_api_image_regeneration_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  generation_request_id uuid NOT NULL,
  image_task_id uuid NOT NULL,
  source_api_job_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  input_manifest jsonb NOT NULL CHECK (jsonb_typeof(input_manifest)='object'),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  output_object_key text NOT NULL,
  state text NOT NULL DEFAULT 'PREPARED' CHECK (state IN
    ('PREPARED','SUBMITTING','SUBMITTED','UNKNOWN_NO_RETRY','SUCCEEDED','FAILED')),
  claim_id uuid,
  provider_task_id text,
  lease_id uuid,
  output_sha256 text CHECK (output_sha256 IS NULL OR output_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  output_bytes bigint CHECK (output_bytes IS NULL OR output_bytes > 0),
  output_content_type text,
  output_asset_id uuid,
  output_receipt_id uuid,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  submitted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(account_id,workspace_id,id),
  UNIQUE(account_id,workspace_id,idempotency_key),
  UNIQUE(account_id,workspace_id,output_object_key),
  FOREIGN KEY(account_id,workspace_id,project_id)
    REFERENCES public.projects(account_id,workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,workspace_id,project_revision_id)
    REFERENCES public.project_revisions(account_id,workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,image_task_id)
    REFERENCES public.generation_tasks(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,workspace_id,source_api_job_id)
    REFERENCES public.hosted_api_generation_jobs(account_id,workspace_id,id) ON DELETE RESTRICT,
  CHECK ((state='PREPARED' AND claim_id IS NULL AND provider_task_id IS NULL AND lease_id IS NULL)
    OR (state='SUBMITTING' AND claim_id IS NOT NULL AND provider_task_id IS NULL AND lease_id IS NOT NULL)
    OR (state='UNKNOWN_NO_RETRY' AND claim_id IS NOT NULL AND lease_id IS NOT NULL)
    OR (state IN ('SUBMITTED','SUCCEEDED') AND claim_id IS NOT NULL AND provider_task_id IS NOT NULL AND lease_id IS NOT NULL)
    OR (state='FAILED' AND claim_id IS NOT NULL AND lease_id IS NOT NULL)),
  CHECK (state<>'SUCCEEDED' OR (output_sha256 IS NOT NULL AND output_bytes IS NOT NULL
    AND output_content_type IS NOT NULL AND output_asset_id IS NOT NULL
    AND output_receipt_id IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX hosted_api_image_regeneration_active_task
  ON public.hosted_api_image_regeneration_jobs(account_id,workspace_id,image_task_id)
  WHERE state IN ('PREPARED','SUBMITTING','SUBMITTED','UNKNOWN_NO_RETRY');
CREATE UNIQUE INDEX hosted_api_image_regeneration_provider_task
  ON public.hosted_api_image_regeneration_jobs(provider_task_id)
  WHERE provider_task_id IS NOT NULL;
CREATE INDEX hosted_api_image_regeneration_project
  ON public.hosted_api_image_regeneration_jobs(account_id,workspace_id,project_id,image_task_id,completed_at DESC);
ALTER TABLE public.hosted_api_image_regeneration_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_api_image_regeneration_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_api_image_regeneration_tenant ON public.hosted_api_image_regeneration_jobs
  USING (account_id=public.videoforge_current_account_id())
  WITH CHECK (account_id=public.videoforge_current_account_id());
CREATE TRIGGER hosted_api_image_regeneration_tenant_write
  BEFORE INSERT OR UPDATE ON public.hosted_api_image_regeneration_jobs
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
REVOKE ALL ON public.hosted_api_image_regeneration_jobs FROM PUBLIC;

ALTER TABLE public.provider_workload_leases
  DROP CONSTRAINT provider_workload_lease_request_identity,
  ADD COLUMN api_image_regeneration_job_id uuid,
  ADD FOREIGN KEY(account_id,workspace_id,api_image_regeneration_job_id)
    REFERENCES public.hosted_api_image_regeneration_jobs(account_id,workspace_id,id);
ALTER TABLE public.provider_workload_leases ADD CONSTRAINT provider_workload_lease_request_identity CHECK(
  (request_kind='VIDEO' AND generation_request_id IS NOT NULL AND preset_preview_request_id IS NULL
    AND image_regeneration_request_id IS NULL AND api_image_regeneration_job_id IS NULL) OR
  (request_kind='PRESET_PREVIEW' AND preset_preview_request_id IS NOT NULL AND generation_request_id IS NULL
    AND image_regeneration_request_id IS NULL AND api_image_regeneration_job_id IS NULL) OR
  (request_kind='IMAGE_REGENERATION' AND image_regeneration_request_id IS NOT NULL
    AND generation_request_id IS NULL AND preset_preview_request_id IS NULL AND api_image_regeneration_job_id IS NULL) OR
  (request_kind='API_IMAGE_REGENERATION' AND api_image_regeneration_job_id IS NOT NULL
    AND generation_request_id IS NULL AND preset_preview_request_id IS NULL AND image_regeneration_request_id IS NULL)
);

CREATE FUNCTION public.videoforge_hosted_api_image_regeneration_json(job public.hosted_api_image_regeneration_jobs)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
  SELECT jsonb_build_object('id',job.id,'accountId',job.account_id,'workspaceId',job.workspace_id,
    'projectId',job.project_id,'projectRevisionId',job.project_revision_id,
    'generationRequestId',job.generation_request_id,'generationTaskId',job.image_task_id,
    'imageTaskId',job.image_task_id,'sourceApiJobId',job.source_api_job_id,
    'generationProvider','KIE_FAL','inputManifest',job.input_manifest,
    'inputSha256',job.input_sha256,'outputObjectKey',job.output_object_key,
    'state',job.state,'claimId',job.claim_id,'providerTaskId',job.provider_task_id,
    'outputSha256',job.output_sha256,'outputBytes',job.output_bytes,
    'outputContentType',job.output_content_type,'outputAssetId',job.output_asset_id,
    'outputReceiptId',job.output_receipt_id,'failureCode',job.failure_code,
    'createdAt',job.created_at,'updatedAt',job.updated_at,
    'submittedAt',job.submitted_at,'completedAt',job.completed_at)
$$;

CREATE FUNCTION public.videoforge_read_hosted_api_image_regeneration_source(
  a uuid,w uuid,p uuid,r uuid,t uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE source_job public.hosted_api_generation_jobs%ROWTYPE;
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
  IF source_job.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('generationProvider','KIE_FAL','sourceApiJobId',source_job.id,
    'generationRequestId',source_job.generation_request_id,
    'sourceInputManifest',source_job.input_manifest,'sourceInputSha256',source_job.input_sha256,
    'imageTaskId',t,'projectId',p,'projectRevisionId',r);
END;
$$;

CREATE FUNCTION public.videoforge_create_hosted_api_image_regeneration(
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
  source_data:=public.videoforge_read_hosted_api_image_regeneration_source(a,w,p,r,t);
  IF source_data IS NULL THEN RAISE EXCEPTION 'current accepted API scene not found' USING ERRCODE='02000'; END IF;
  job_id:=gen_random_uuid();
  output_key:='tenant/'||a::text||'/workspace/'||w::text||'/project/'||p::text||
    '/revision/'||r::text||'/lane/mage-image/job/'||job_id::text||'/artifact/'||t::text;
  manifest:=jsonb_build_object('prompt',prompt,'aspectRatio','16:9',
    'sourceApiJobId',source_data->>'sourceApiJobId',
    'sourceInputSha256',source_data->>'sourceInputSha256');
  INSERT INTO public.hosted_api_image_regeneration_jobs(id,account_id,workspace_id,project_id,
    project_revision_id,generation_request_id,image_task_id,source_api_job_id,idempotency_key,
    input_manifest,input_sha256,output_object_key)
  VALUES(job_id,a,w,p,r,(source_data->>'generationRequestId')::uuid,t,
    (source_data->>'sourceApiJobId')::uuid,supplied_idempotency_key,manifest,
    'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(manifest),'UTF8')),'hex'),
    output_key) RETURNING * INTO found_job;
  RETURN public.videoforge_hosted_api_image_regeneration_json(found_job);
END;
$$;

CREATE FUNCTION public.videoforge_get_hosted_api_image_regeneration(
  a uuid,w uuid,p uuid,t uuid,req uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT public.videoforge_hosted_api_image_regeneration_json(job)
    FROM public.hosted_api_image_regeneration_jobs job
    WHERE a=public.videoforge_current_account_id() AND job.account_id=a
      AND job.workspace_id=w AND job.project_id=p AND job.image_task_id=t AND job.id=req
$$;

CREATE FUNCTION public.videoforge_load_hosted_api_image_regeneration(req uuid,w uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT public.videoforge_hosted_api_image_regeneration_json(job)
    FROM public.hosted_api_image_regeneration_jobs job
    WHERE job.account_id=public.videoforge_current_account_id()
      AND job.workspace_id=w AND job.id=req
$$;

CREATE FUNCTION public.videoforge_claim_hosted_api_image_regeneration(req uuid,claim uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_api_image_regeneration_jobs%ROWTYPE;
  chosen_slot integer; chosen_lease_id uuid; now_at timestamptz:=transaction_timestamp();
BEGIN
  PERFORM 1 FROM public.global_generation_capacity WHERE singleton FOR UPDATE;
  SELECT * INTO job FROM public.hosted_api_image_regeneration_jobs j
    WHERE j.id=req AND j.account_id=public.videoforge_current_account_id() FOR UPDATE;
  IF job.id IS NULL THEN RAISE EXCEPTION 'API regeneration not found' USING ERRCODE='02000'; END IF;
  IF job.state<>'PREPARED' THEN RETURN public.videoforge_hosted_api_image_regeneration_json(job); END IF;
  SELECT s INTO chosen_slot FROM generate_series(1,2) s WHERE NOT EXISTS(
    SELECT 1 FROM public.provider_workload_leases l WHERE l.slot=s AND l.state='ACTIVE')
    ORDER BY s LIMIT 1;
  IF chosen_slot IS NULL OR EXISTS(SELECT 1 FROM public.provider_workload_leases l
      WHERE l.account_id=job.account_id AND l.state='ACTIVE') THEN
    RETURN public.videoforge_hosted_api_image_regeneration_json(job);
  END IF;
  chosen_lease_id:=md5('hosted-api-image-regeneration-lease:'||job.id::text)::uuid;
  INSERT INTO public.provider_workload_leases(id,slot,account_id,workspace_id,request_kind,
    api_image_regeneration_job_id,owner_token_sha256,state,acquired_at,heartbeat_at,expires_at)
  VALUES(chosen_lease_id,chosen_slot,job.account_id,job.workspace_id,'API_IMAGE_REGENERATION',
    job.id,job.input_sha256,'ACTIVE',now_at,now_at,now_at+interval '2 hours');
  UPDATE public.hosted_api_image_regeneration_jobs SET state='SUBMITTING',claim_id=claim,
    lease_id=chosen_lease_id,updated_at=now_at WHERE id=job.id RETURNING * INTO job;
  RETURN public.videoforge_hosted_api_image_regeneration_json(job);
END;
$$;

CREATE FUNCTION public.videoforge_record_hosted_api_image_regeneration_task(
  req uuid,claim uuid,supplied_provider_task_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_api_image_regeneration_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.hosted_api_image_regeneration_jobs j
    WHERE j.id=req AND j.account_id=public.videoforge_current_account_id() FOR UPDATE;
  IF job.id IS NULL THEN RAISE EXCEPTION 'API regeneration not found' USING ERRCODE='02000'; END IF;
  IF job.claim_id IS DISTINCT FROM claim OR length(supplied_provider_task_id) NOT BETWEEN 1 AND 240 THEN
    RAISE EXCEPTION 'API regeneration provider identity invalid' USING ERRCODE='23514';
  END IF;
  IF job.state='SUBMITTED' AND job.provider_task_id=supplied_provider_task_id THEN
    RETURN public.videoforge_hosted_api_image_regeneration_json(job);
  END IF;
  IF job.state NOT IN ('SUBMITTING','UNKNOWN_NO_RETRY') OR job.provider_task_id IS NOT NULL THEN
    RAISE EXCEPTION 'API regeneration provider identity drift' USING ERRCODE='23505';
  END IF;
  UPDATE public.hosted_api_image_regeneration_jobs SET state='SUBMITTED',
    provider_task_id=supplied_provider_task_id,submitted_at=transaction_timestamp(),
    updated_at=transaction_timestamp() WHERE id=job.id RETURNING * INTO job;
  RETURN public.videoforge_hosted_api_image_regeneration_json(job);
END;
$$;

CREATE FUNCTION public.videoforge_mark_hosted_api_image_regeneration_unknown(req uuid,claim uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_api_image_regeneration_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.hosted_api_image_regeneration_jobs j
    WHERE j.id=req AND j.account_id=public.videoforge_current_account_id() FOR UPDATE;
  IF job.id IS NULL THEN RAISE EXCEPTION 'API regeneration not found' USING ERRCODE='02000'; END IF;
  IF job.claim_id IS DISTINCT FROM claim THEN
    RAISE EXCEPTION 'API regeneration claim invalid' USING ERRCODE='23514';
  END IF;
  IF job.state='SUBMITTING' THEN
    UPDATE public.hosted_api_image_regeneration_jobs SET state='UNKNOWN_NO_RETRY',
      updated_at=transaction_timestamp() WHERE id=job.id RETURNING * INTO job;
  END IF;
  RETURN public.videoforge_hosted_api_image_regeneration_json(job);
END;
$$;

CREATE FUNCTION public.videoforge_fail_hosted_api_image_regeneration(req uuid,supplied_failure_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_api_image_regeneration_jobs%ROWTYPE; changed integer;
BEGIN
  SELECT * INTO job FROM public.hosted_api_image_regeneration_jobs j
    WHERE j.id=req AND j.account_id=public.videoforge_current_account_id() FOR UPDATE;
  IF job.id IS NULL THEN RAISE EXCEPTION 'API regeneration not found' USING ERRCODE='02000'; END IF;
  IF job.state='FAILED' AND job.failure_code=supplied_failure_code THEN
    RETURN public.videoforge_hosted_api_image_regeneration_json(job);
  END IF;
  IF job.state NOT IN ('SUBMITTING','SUBMITTED') OR length(supplied_failure_code) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'API regeneration definite failure invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.hosted_api_image_regeneration_jobs SET state='FAILED',failure_code=supplied_failure_code,
    completed_at=transaction_timestamp(),updated_at=transaction_timestamp()
    WHERE id=job.id RETURNING * INTO job;
  UPDATE public.provider_workload_leases SET state='RELEASED',released_at=transaction_timestamp(),
    release_reason='API_IMAGE_REGENERATION_FAILED',version=version+1,
    heartbeat_at=transaction_timestamp(),expires_at=greatest(expires_at,transaction_timestamp()+interval '1 second')
    WHERE id=job.lease_id AND account_id=job.account_id AND state='ACTIVE';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'API regeneration lease release failed' USING ERRCODE='55000'; END IF;
  RETURN public.videoforge_hosted_api_image_regeneration_json(job);
END;
$$;

CREATE FUNCTION public.videoforge_commit_hosted_api_image_regeneration(
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
    jsonb_build_object('provider','KIE_Z_IMAGE','providerTaskId',job.provider_task_id,
      'sourceApiJobId',job.source_api_job_id,'imageTaskId',job.image_task_id,'probe',supplied_probe),now_at);
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

CREATE FUNCTION public.videoforge_read_hosted_api_image_regenerations(a uuid,w uuid,p uuid,r uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE replacements jsonb;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM a THEN
    RAISE EXCEPTION 'API regeneration scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_agg(to_jsonb(selected) ORDER BY selected."imageTaskId")
    INTO replacements FROM (
      SELECT DISTINCT ON (job.image_task_id)
        job.image_task_id AS "imageTaskId",job.source_api_job_id AS "sourceApiJobId",
        job.id AS "jobId",job.input_manifest->>'prompt' AS prompt,
        job.output_object_key AS "objectKey",job.output_sha256 AS sha256,
        job.output_bytes AS "contentLength",job.output_content_type AS "contentType",
        job.output_asset_id AS "assetId",job.output_receipt_id AS "receiptId",
        job.completed_at AS "completedAt"
      FROM public.hosted_api_image_regeneration_jobs job
      JOIN public.assets asset ON asset.account_id=job.account_id AND asset.workspace_id=job.workspace_id
        AND asset.id=job.output_asset_id AND asset.state='ACCEPTED'
        AND asset.object_key=job.output_object_key AND asset.binary_sha256=job.output_sha256
      JOIN public.artifact_receipts receipt ON receipt.account_id=job.account_id
        AND receipt.workspace_id=job.workspace_id AND receipt.id=job.output_receipt_id
        AND receipt.deleted_at IS NULL AND receipt.object_key=job.output_object_key
        AND receipt.checksum_sha256=job.output_sha256 AND receipt.content_length=job.output_bytes
      JOIN public.artifact_reservations reservation ON reservation.account_id=job.account_id
        AND reservation.workspace_id=job.workspace_id AND reservation.id=receipt.reservation_id
        AND reservation.state='COMMITTED' AND reservation.object_key=job.output_object_key
      WHERE job.account_id=a AND job.workspace_id=w AND job.project_id=p
        AND job.project_revision_id=r AND job.state='SUCCEEDED'
      ORDER BY job.image_task_id,job.completed_at DESC,job.id DESC
    ) selected;
  RETURN coalesce(replacements,'[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_hosted_api_image_regeneration_json(public.hosted_api_image_regeneration_jobs) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_api_image_regeneration_source(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_create_hosted_api_image_regeneration(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_get_hosted_api_image_regeneration(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_api_image_regeneration(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_claim_hosted_api_image_regeneration(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_hosted_api_image_regeneration_task(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_mark_hosted_api_image_regeneration_unknown(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_fail_hosted_api_image_regeneration(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_commit_hosted_api_image_regeneration(uuid,text,bigint,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_api_image_regenerations(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT SELECT ON public.hosted_api_image_regeneration_jobs TO videoforge_v209_runtime_dc9612d6;
GRANT EXECUTE ON FUNCTION
  public.videoforge_read_hosted_api_image_regeneration_source(uuid,uuid,uuid,uuid,uuid),
  public.videoforge_create_hosted_api_image_regeneration(uuid,uuid,uuid,uuid,uuid,text,text),
  public.videoforge_get_hosted_api_image_regeneration(uuid,uuid,uuid,uuid,uuid),
  public.videoforge_load_hosted_api_image_regeneration(uuid,uuid),
  public.videoforge_claim_hosted_api_image_regeneration(uuid,uuid),
  public.videoforge_record_hosted_api_image_regeneration_task(uuid,uuid,text),
  public.videoforge_mark_hosted_api_image_regeneration_unknown(uuid,uuid),
  public.videoforge_fail_hosted_api_image_regeneration(uuid,text),
  public.videoforge_commit_hosted_api_image_regeneration(uuid,text,bigint,text,jsonb),
  public.videoforge_read_hosted_api_image_regenerations(uuid,uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;
