-- API generation is a new dispatch path for fresh ordinary requests. Existing RunPod
-- attempts and their append-only receipts remain untouched.
CREATE TABLE public.hosted_api_generation_jobs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  generation_request_id uuid NOT NULL,
  generation_task_id uuid NOT NULL,
  task_key text NOT NULL,
  lane text NOT NULL CHECK (lane IN ('IMAGE','AVATAR')),
  input_manifest jsonb NOT NULL CHECK (jsonb_typeof(input_manifest)='object'),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  output_object_key text NOT NULL,
  state text NOT NULL DEFAULT 'PREPARED' CHECK (state IN
    ('PREPARED','SUBMITTING','SUBMITTED','UNKNOWN_NO_RETRY','SUCCEEDED','FAILED')),
  claim_id uuid,
  provider_task_id text,
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
  UNIQUE(generation_request_id,generation_task_id),
  UNIQUE(account_id,workspace_id,output_object_key),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,workspace_id,project_revision_id)
    REFERENCES public.project_revisions(account_id,workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,generation_task_id)
    REFERENCES public.generation_tasks(workspace_id,id) ON DELETE RESTRICT,
  CHECK (length(task_key) BETWEEN 1 AND 240),
  CHECK (output_object_key ~ '^tenant/[a-z0-9-]+/workspace/[a-z0-9-]+/project/[a-z0-9-]+/revision/[a-z0-9-]+/lane/(mage-image|soulx-avatar)/job/[a-z0-9-]+/artifact/[a-z0-9-]+$'),
  CHECK ((state='PREPARED' AND claim_id IS NULL AND provider_task_id IS NULL)
    OR (state='SUBMITTING' AND claim_id IS NOT NULL AND provider_task_id IS NULL)
    OR (state='UNKNOWN_NO_RETRY' AND claim_id IS NOT NULL)
    OR (state IN ('SUBMITTED','SUCCEEDED') AND claim_id IS NOT NULL AND provider_task_id IS NOT NULL)
    OR (state='FAILED' AND claim_id IS NOT NULL)),
  CHECK (state<>'SUCCEEDED' OR (output_sha256 IS NOT NULL AND output_bytes IS NOT NULL
    AND output_content_type IS NOT NULL AND output_asset_id IS NOT NULL
    AND output_receipt_id IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX hosted_api_generation_jobs_provider_task_uq
  ON public.hosted_api_generation_jobs(lane,provider_task_id)
  WHERE provider_task_id IS NOT NULL;
CREATE INDEX hosted_api_generation_jobs_request_idx
  ON public.hosted_api_generation_jobs(account_id,workspace_id,generation_request_id,lane,state);
ALTER TABLE public.hosted_api_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_api_generation_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_api_generation_jobs_tenant ON public.hosted_api_generation_jobs
  USING (account_id=public.videoforge_current_account_id())
  WITH CHECK (account_id=public.videoforge_current_account_id());
CREATE TRIGGER hosted_api_generation_jobs_tenant_write
  BEFORE INSERT OR UPDATE ON public.hosted_api_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
REVOKE ALL ON public.hosted_api_generation_jobs FROM PUBLIC;

-- An accepted API unit carries its own immutable job identity. The old FK still
-- protects every RunPod row, and exactly one provenance path is required.
ALTER TABLE public.video_runtime_accepted_units
  ADD COLUMN api_job_id uuid;
ALTER TABLE public.video_runtime_accepted_units
  ALTER COLUMN accepted_attempt_id DROP NOT NULL;
ALTER TABLE public.video_runtime_accepted_units
  ADD CONSTRAINT video_runtime_accepted_units_api_job_fk
  FOREIGN KEY(account_id,workspace_id,api_job_id)
  REFERENCES public.hosted_api_generation_jobs(account_id,workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE public.video_runtime_accepted_units
  ADD CONSTRAINT video_runtime_accepted_units_one_provenance_ck
  CHECK ((accepted_attempt_id IS NULL) <> (api_job_id IS NULL));

CREATE FUNCTION public.videoforge_hosted_api_job_json(job public.hosted_api_generation_jobs)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
  SELECT jsonb_build_object('id',job.id,'generationRequestId',job.generation_request_id,
    'generationTaskId',job.generation_task_id,'taskKey',job.task_key,
    'lane',job.lane,'inputManifest',job.input_manifest,'inputSha256',job.input_sha256,
    'outputObjectKey',job.output_object_key,'state',job.state,
    'claimId',job.claim_id,'providerTaskId',job.provider_task_id,
    'outputSha256',job.output_sha256,'outputBytes',job.output_bytes,
    'outputContentType',job.output_content_type,'outputAssetId',job.output_asset_id,
    'outputReceiptId',job.output_receipt_id,'failureCode',job.failure_code)
$$;

CREATE FUNCTION public.videoforge_read_hosted_api_jobs(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE jobs jsonb; request_id uuid;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'API generation scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT id INTO request_id FROM public.generation_requests WHERE account_id=supplied_account_id
    AND workspace_id=supplied_workspace_id AND id=supplied_generation_request_id;
  IF request_id IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_agg(public.videoforge_hosted_api_job_json(j) ORDER BY j.lane,j.task_key)
    INTO jobs FROM public.hosted_api_generation_jobs j
    WHERE j.account_id=supplied_account_id AND j.workspace_id=supplied_workspace_id
      AND j.generation_request_id=supplied_generation_request_id;
  RETURN jsonb_build_object('generationRequestId',request_id,'jobs',coalesce(jobs,'[]'::jsonb));
END;
$$;

CREATE FUNCTION public.videoforge_materialize_hosted_api_jobs(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_user_id uuid,supplied_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  request public.generation_requests%ROWTYPE;
  revision public.project_revisions%ROWTYPE;
  bridge public.hosted_canonical_timing_bridges%ROWTYPE;
  runtime public.video_runtime_states%ROWTYPE;
  task_row record; prompt_row record; span_row record; input jsonb; input_hash text;
  job_id uuid; output_key text; expected_count integer:=0; stored public.hosted_api_generation_jobs%ROWTYPE;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.account_id=supplied_account_id
       AND m.workspace_id=supplied_workspace_id AND m.user_id=supplied_user_id AND m.status='ACTIVE')
     OR NOT EXISTS(SELECT 1 FROM public.projects p WHERE p.account_id=supplied_account_id
       AND p.workspace_id=supplied_workspace_id AND p.id=supplied_project_id AND p.status='ACTIVE') THEN
    RAISE EXCEPTION 'API generation scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT * INTO request FROM public.generation_requests r WHERE r.account_id=supplied_account_id
    AND r.workspace_id=supplied_workspace_id AND r.project_id=supplied_project_id
    AND r.state='ACTIVE' AND r.terminal_at IS NULL ORDER BY r.created_at DESC,r.id DESC LIMIT 1 FOR UPDATE;
  IF request.id IS NULL OR request.created_by_user_id<>supplied_user_id THEN
    RAISE EXCEPTION 'API generation request unavailable' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(request.id::text,41));
  IF EXISTS(SELECT 1 FROM public.hosted_v209_ordinary_dispatch_candidates c
      WHERE c.generation_request_id=request.id)
     OR EXISTS(SELECT 1 FROM public.serverless_attempts a WHERE a.generation_request_id=request.id) THEN
    RAISE EXCEPTION 'GPU generation identity already consumed' USING ERRCODE='23505';
  END IF;
  SELECT * INTO revision FROM public.project_revisions r WHERE r.account_id=supplied_account_id
    AND r.workspace_id=supplied_workspace_id AND r.id=request.project_revision_id
    AND r.project_id=supplied_project_id AND r.status='LOCKED' FOR SHARE;
  SELECT * INTO bridge FROM public.hosted_canonical_timing_bridges b WHERE b.account_id=supplied_account_id
    AND b.workspace_id=supplied_workspace_id AND b.project_revision_id=request.project_revision_id FOR SHARE;
  SELECT * INTO runtime FROM public.video_runtime_states v WHERE v.account_id=supplied_account_id
    AND v.workspace_id=supplied_workspace_id AND v.generation_request_id=request.id FOR SHARE;
  IF revision.id IS NULL OR bridge.hosted_asr_attempt_id IS NULL OR runtime.id IS NULL
     OR runtime.stage<>'WAITING_FOR_WORKER' OR runtime.terminal_at IS NOT NULL
     OR NOT EXISTS(SELECT 1 FROM public.avatar_profile_versions v JOIN public.assets a
       ON a.account_id=supplied_account_id AND a.workspace_id=v.workspace_id
       AND a.id=v.runtime_source_asset_id AND a.binary_sha256=v.runtime_source_binary_sha256
       AND a.state IN ('VERIFIED','ACCEPTED') AND a.object_key IS NOT NULL
       WHERE v.workspace_id=supplied_workspace_id AND v.id=revision.avatar_profile_version_id
         AND v.profile_id=revision.avatar_profile_id AND v.state='READY'
         AND v.runtime_source_asset_id=revision.avatar_runtime_source_asset_id
         AND v.runtime_source_binary_sha256=revision.avatar_runtime_source_binary_sha256)
     OR (SELECT count(*) FROM public.video_runtime_lane_states l
       WHERE l.runtime_id=runtime.id AND l.lane IN ('mage_image','soulx_avatar')
         AND l.state IN ('MANIFEST_DURABLE','SUCCEEDED') AND l.current_attempt_id IS NULL)<>2 THEN
    RAISE EXCEPTION 'API generation inputs not ready' USING ERRCODE='23514';
  END IF;
  FOR task_row IN
    SELECT t.id,t.task_key,t.lane,s.segment_key,s.id segment_id,
      s.timeline_composition,s.required_slots
    FROM jsonb_array_elements(bridge.task_manifest) m
    JOIN public.generation_tasks t ON t.account_id=supplied_account_id
      AND t.workspace_id=supplied_workspace_id AND t.id=(m->>'id')::uuid
      AND t.project_revision_id=request.project_revision_id
    JOIN public.timeline_segments s ON s.account_id=supplied_account_id
      AND s.workspace_id=supplied_workspace_id AND s.id=(m->>'timeline_segment_id')::uuid
      AND s.project_revision_id=request.project_revision_id AND s.timeline_plan_id=bridge.timeline_plan_id
    WHERE t.lane IN ('IMAGE','AVATAR') AND t.state IN ('BLOCKED','COMPLETE')
      AND m->>'lane'=t.lane ORDER BY t.lane,t.task_key
  LOOP
    expected_count:=expected_count+1;
    job_id:=md5('hosted-api-generation-job:'||request.id::text||':'||task_row.id::text)::uuid;
    output_key:='tenant/'||supplied_account_id::text||'/workspace/'||supplied_workspace_id::text||
      '/project/'||supplied_project_id::text||'/revision/'||request.project_revision_id::text||
      '/lane/'||CASE task_row.lane WHEN 'IMAGE' THEN 'mage-image' ELSE 'soulx-avatar' END||
      '/job/'||job_id::text||'/artifact/'||task_row.id::text;
    IF task_row.lane='IMAGE' THEN
      SELECT r.id,r.compiled_prompt,r.positive_prompt_hash,r.negative_prompt_hash,
        e.image_style_version_id,e.style_profile_hash INTO prompt_row
      FROM public.prompt_scene_results r JOIN public.prompt_executions e
        ON e.account_id=supplied_account_id AND e.workspace_id=supplied_workspace_id
        AND e.id=r.prompt_execution_id
      WHERE e.project_id=supplied_project_id AND e.project_revision_id=request.project_revision_id
        AND e.timeline_plan_id=bridge.timeline_plan_id AND r.scene_id=task_row.segment_key
      ORDER BY e.accepted_at DESC,r.id DESC LIMIT 1;
      IF NOT FOUND OR task_row.timeline_composition NOT IN ('IMAGE_FULL','AVATAR_SPLIT_IMAGE') THEN
        RAISE EXCEPTION 'API image prompt coverage incomplete' USING ERRCODE='23514';
      END IF;
      input:=jsonb_build_object('taskId',task_row.id,'segmentId',task_row.segment_key,
        'role',CASE task_row.timeline_composition WHEN 'IMAGE_FULL' THEN 'image' ELSE 'right_image' END,
        'promptResultId',prompt_row.id,'compiledPrompt',prompt_row.compiled_prompt,
        'aspectRatio','16:9',
        'positivePromptSha256',prompt_row.positive_prompt_hash,
        'negativePromptSha256',prompt_row.negative_prompt_hash,
        'styleVersionId',prompt_row.image_style_version_id,
        'styleProfileSha256',prompt_row.style_profile_hash);
    ELSE
      SELECT span.id,span.materialized_asset_id,span.materialized_binary_sha256,
        audio.object_key audio_object_key,audio.content_type audio_content_type,
        audio.byte_size audio_byte_size,avatar.object_key avatar_object_key,
        avatar.content_type avatar_content_type,avatar.byte_size avatar_byte_size,
        span.selected_start_ms,span.selected_end_ms_exclusive,
        span.trim_start_ms,span.trim_end_ms_exclusive INTO span_row
      FROM public.selected_span_audio span
      JOIN public.assets audio ON audio.account_id=supplied_account_id
        AND audio.workspace_id=span.workspace_id AND audio.id=span.materialized_asset_id
        AND audio.binary_sha256=span.materialized_binary_sha256
        AND audio.kind='AUDIO_SPAN' AND audio.state IN ('VERIFIED','ACCEPTED')
      JOIN public.assets avatar ON avatar.account_id=supplied_account_id
        AND avatar.workspace_id=span.workspace_id AND avatar.id=revision.avatar_runtime_source_asset_id
        AND avatar.binary_sha256=revision.avatar_runtime_source_binary_sha256
        AND avatar.state IN ('VERIFIED','ACCEPTED')
      WHERE span.account_id=supplied_account_id AND span.workspace_id=supplied_workspace_id
        AND span.project_revision_id=request.project_revision_id
        AND span.timeline_plan_id=bridge.timeline_plan_id
        AND span.timeline_segment_id=task_row.segment_id
        AND span.task_key=task_row.required_slots#>>'{avatar,span_audio_task_key}'
        AND span.state='MATERIALIZED';
      IF NOT FOUND OR span_row.audio_object_key IS NULL OR span_row.audio_byte_size<1
         OR span_row.audio_content_type<>'audio/wav' OR span_row.avatar_object_key IS NULL
         OR span_row.avatar_byte_size<1 OR span_row.avatar_content_type NOT IN ('image/png','image/jpeg') THEN
        RAISE EXCEPTION 'API avatar input coverage incomplete' USING ERRCODE='23514';
      END IF;
      input:=jsonb_build_object('taskId',task_row.id,'segmentId',task_row.segment_key,
        'spanAudioId',span_row.id,'spanAudioAssetId',span_row.materialized_asset_id,
        'spanAudioSha256',span_row.materialized_binary_sha256,
        'spanAudioObjectKey',span_row.audio_object_key,
        'spanAudioContentType',span_row.audio_content_type,
        'spanAudioContentLength',span_row.audio_byte_size,
        'avatarSourceAssetId',revision.avatar_runtime_source_asset_id,
        'avatarSourceSha256',revision.avatar_runtime_source_binary_sha256,
        'avatarSourceObjectKey',span_row.avatar_object_key,
        'avatarSourceContentType',span_row.avatar_content_type,
        'avatarSourceContentLength',span_row.avatar_byte_size,
        'selectedStartMs',span_row.selected_start_ms,
        'selectedEndMsExclusive',span_row.selected_end_ms_exclusive,
        'expectedDurationMs',span_row.selected_end_ms_exclusive-span_row.selected_start_ms,
        'trimStartMs',span_row.trim_start_ms,
        'trimEndMsExclusive',span_row.trim_end_ms_exclusive);
    END IF;
    input_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(input),'UTF8')),'hex');
    INSERT INTO public.hosted_api_generation_jobs(id,account_id,workspace_id,project_id,
      project_revision_id,generation_request_id,generation_task_id,task_key,lane,
      input_manifest,input_sha256,output_object_key)
    VALUES(job_id,supplied_account_id,supplied_workspace_id,supplied_project_id,
      request.project_revision_id,request.id,task_row.id,task_row.task_key,task_row.lane,
      input,input_hash,output_key)
    ON CONFLICT(generation_request_id,generation_task_id) DO NOTHING;
    SELECT * INTO stored FROM public.hosted_api_generation_jobs j WHERE j.generation_request_id=request.id
      AND j.generation_task_id=task_row.id;
    IF stored.id IS DISTINCT FROM job_id OR stored.account_id<>supplied_account_id
       OR stored.workspace_id<>supplied_workspace_id
       OR (CASE WHEN task_row.lane='IMAGE' THEN stored.input_manifest-'prompt'
            ELSE stored.input_manifest END) IS DISTINCT FROM input
       OR stored.input_sha256<>'sha256:'||encode(sha256(convert_to(
            public.videoforge_canonical_jsonb(stored.input_manifest),'UTF8')),'hex')
       OR stored.output_object_key<>output_key THEN
      RAISE EXCEPTION 'API generation immutable job drift' USING ERRCODE='23505';
    END IF;
  END LOOP;
  IF expected_count=0 OR (SELECT count(*) FROM public.hosted_api_generation_jobs j
      WHERE j.generation_request_id=request.id)<>expected_count THEN
    RAISE EXCEPTION 'API generation task set incomplete' USING ERRCODE='23514';
  END IF;
  RETURN public.videoforge_read_hosted_api_jobs(supplied_account_id,supplied_workspace_id,request.id);
END;
$$;

CREATE FUNCTION public.videoforge_claim_hosted_api_job(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid,
  supplied_generation_task_id uuid,supplied_claim_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_api_generation_jobs%ROWTYPE;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'API generation scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT * INTO job FROM public.hosted_api_generation_jobs j
    WHERE j.account_id=supplied_account_id AND j.workspace_id=supplied_workspace_id
      AND j.generation_request_id=supplied_generation_request_id
      AND j.generation_task_id=supplied_generation_task_id FOR UPDATE;
  IF job.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.generation_requests r
      WHERE r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id
        AND r.id=supplied_generation_request_id AND r.state='ACTIVE') THEN
    RAISE EXCEPTION 'API generation job unavailable' USING ERRCODE='23514';
  END IF;
  IF job.state<>'PREPARED' THEN
    RETURN public.videoforge_hosted_api_job_json(job);
  END IF;
  IF job.lane='IMAGE' AND (job.input_manifest->>'prompt') IS NULL THEN
    RAISE EXCEPTION 'API image prompt not bound' USING ERRCODE='23514';
  END IF;
  UPDATE public.hosted_api_generation_jobs SET state='SUBMITTING',claim_id=supplied_claim_id,
    updated_at=transaction_timestamp() WHERE id=job.id RETURNING * INTO job;
  RETURN public.videoforge_hosted_api_job_json(job);
END;
$$;

CREATE FUNCTION public.videoforge_bind_hosted_api_image_prompt(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid,
  supplied_generation_task_id uuid,supplied_prompt text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_api_generation_jobs%ROWTYPE; bound_manifest jsonb; bound_hash text;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_prompt IS NULL OR length(supplied_prompt) NOT BETWEEN 1 AND 1000
     OR supplied_prompt<>btrim(supplied_prompt) THEN
    RAISE EXCEPTION 'API image prompt invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO job FROM public.hosted_api_generation_jobs j
    WHERE j.account_id=supplied_account_id AND j.workspace_id=supplied_workspace_id
      AND j.generation_request_id=supplied_generation_request_id
      AND j.generation_task_id=supplied_generation_task_id FOR UPDATE;
  IF job.id IS NULL OR job.lane<>'IMAGE' THEN
    RAISE EXCEPTION 'API image job unavailable' USING ERRCODE='23514';
  END IF;
  IF job.input_manifest ? 'prompt' THEN
    IF job.input_manifest->>'prompt' IS DISTINCT FROM supplied_prompt THEN
      RAISE EXCEPTION 'API image prompt replay drift' USING ERRCODE='23505';
    END IF;
    RETURN public.videoforge_hosted_api_job_json(job);
  END IF;
  IF job.state<>'PREPARED' THEN
    RAISE EXCEPTION 'API image prompt already dispatched' USING ERRCODE='23505';
  END IF;
  bound_manifest:=job.input_manifest||jsonb_build_object('prompt',supplied_prompt);
  bound_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(bound_manifest),'UTF8')),'hex');
  UPDATE public.hosted_api_generation_jobs SET input_manifest=bound_manifest,input_sha256=bound_hash,
    updated_at=transaction_timestamp() WHERE id=job.id RETURNING * INTO job;
  RETURN public.videoforge_hosted_api_job_json(job);
END;
$$;

CREATE FUNCTION public.videoforge_record_hosted_api_task(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid,
  supplied_generation_task_id uuid,supplied_claim_id uuid,supplied_provider_task_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_api_generation_jobs%ROWTYPE;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_provider_task_id IS NULL OR length(supplied_provider_task_id) NOT BETWEEN 1 AND 240
     OR supplied_provider_task_id<>btrim(supplied_provider_task_id) THEN
    RAISE EXCEPTION 'API generation task identity invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO job FROM public.hosted_api_generation_jobs j
    WHERE j.account_id=supplied_account_id AND j.workspace_id=supplied_workspace_id
      AND j.generation_request_id=supplied_generation_request_id
      AND j.generation_task_id=supplied_generation_task_id FOR UPDATE;
  IF job.id IS NULL OR job.claim_id IS DISTINCT FROM supplied_claim_id THEN
    RAISE EXCEPTION 'API generation claim mismatch' USING ERRCODE='23505';
  END IF;
  IF job.state IN ('SUBMITTED','SUCCEEDED','FAILED') THEN
    IF job.provider_task_id IS DISTINCT FROM supplied_provider_task_id THEN
      RAISE EXCEPTION 'API generation task identity drift' USING ERRCODE='23505';
    END IF;
    RETURN public.videoforge_hosted_api_job_json(job);
  END IF;
  IF job.state NOT IN ('SUBMITTING','UNKNOWN_NO_RETRY') THEN
    RAISE EXCEPTION 'API generation task state invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.hosted_api_generation_jobs SET state='SUBMITTED',
    provider_task_id=supplied_provider_task_id,submitted_at=transaction_timestamp(),
    updated_at=transaction_timestamp() WHERE id=job.id RETURNING * INTO job;
  RETURN public.videoforge_hosted_api_job_json(job);
END;
$$;

CREATE FUNCTION public.videoforge_mark_hosted_api_unknown(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid,
  supplied_generation_task_id uuid,supplied_claim_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_api_generation_jobs%ROWTYPE;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'API generation scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT * INTO job FROM public.hosted_api_generation_jobs j
    WHERE j.account_id=supplied_account_id AND j.workspace_id=supplied_workspace_id
      AND j.generation_request_id=supplied_generation_request_id
      AND j.generation_task_id=supplied_generation_task_id FOR UPDATE;
  IF job.id IS NULL OR job.claim_id IS DISTINCT FROM supplied_claim_id THEN
    RAISE EXCEPTION 'API generation claim mismatch' USING ERRCODE='23505';
  END IF;
  IF job.state='SUBMITTING' THEN
    UPDATE public.hosted_api_generation_jobs SET state='UNKNOWN_NO_RETRY',
      updated_at=transaction_timestamp() WHERE id=job.id RETURNING * INTO job;
  END IF;
  RETURN public.videoforge_hosted_api_job_json(job);
END;
$$;

CREATE FUNCTION public.videoforge_fail_hosted_api_job(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid,
  supplied_generation_task_id uuid,supplied_failure_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_api_generation_jobs%ROWTYPE;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_failure_code !~ '^[A-Z][A-Z0-9_]{1,119}$' THEN
    RAISE EXCEPTION 'API generation failure input invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO job FROM public.hosted_api_generation_jobs j
    WHERE j.account_id=supplied_account_id AND j.workspace_id=supplied_workspace_id
      AND j.generation_request_id=supplied_generation_request_id
      AND j.generation_task_id=supplied_generation_task_id FOR UPDATE;
  IF job.id IS NULL OR job.state NOT IN ('SUBMITTING','SUBMITTED','FAILED') THEN
    RAISE EXCEPTION 'API generation failure state invalid' USING ERRCODE='23514';
  END IF;
  IF job.state='FAILED' THEN
    IF job.failure_code IS DISTINCT FROM supplied_failure_code THEN
      RAISE EXCEPTION 'API generation failure replay drift' USING ERRCODE='23505';
    END IF;
    RETURN public.videoforge_hosted_api_job_json(job);
  END IF;
  UPDATE public.hosted_api_generation_jobs SET state='FAILED',failure_code=supplied_failure_code,
    completed_at=transaction_timestamp(),updated_at=transaction_timestamp()
    WHERE id=job.id RETURNING * INTO job;
  RETURN public.videoforge_hosted_api_job_json(job);
END;
$$;

-- Caller must HEAD/GET the private object and verify bytes, SHA-256 and media probe
-- before invoking this commit. The database pins the resulting asset and receipt.
CREATE FUNCTION public.videoforge_commit_hosted_api_output(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid,
  supplied_generation_task_id uuid,supplied_sha256 text,supplied_bytes bigint,
  supplied_content_type text,supplied_probe jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  job public.hosted_api_generation_jobs%ROWTYPE;
  runtime public.video_runtime_states%ROWTYPE;
  lane public.video_runtime_lane_states%ROWTYPE;
  asset_id uuid; reservation_id uuid; receipt_id uuid; unit_id uuid;
  receipt_facts jsonb; receipt_hash text; now_at timestamptz:=transaction_timestamp();
  lane_name text; accepted_count integer;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_sha256 !~ '^sha256:[0-9a-f]{64}$' OR supplied_bytes NOT BETWEEN 1 AND 10737418240
     OR jsonb_typeof(supplied_probe)<>'object' THEN
    RAISE EXCEPTION 'API generation output invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO job FROM public.hosted_api_generation_jobs j
    WHERE j.account_id=supplied_account_id AND j.workspace_id=supplied_workspace_id
      AND j.generation_request_id=supplied_generation_request_id
      AND j.generation_task_id=supplied_generation_task_id FOR UPDATE;
  IF job.id IS NULL OR (job.lane='IMAGE' AND supplied_content_type<>'image/png')
     OR (job.lane='AVATAR' AND supplied_content_type<>'video/mp4') THEN
    RAISE EXCEPTION 'API generation output kind invalid' USING ERRCODE='23514';
  END IF;
  IF job.state='SUCCEEDED' THEN
    IF job.output_sha256 IS DISTINCT FROM supplied_sha256
       OR job.output_bytes IS DISTINCT FROM supplied_bytes
       OR job.output_content_type IS DISTINCT FROM supplied_content_type THEN
      RAISE EXCEPTION 'API generation output replay drift' USING ERRCODE='23505';
    END IF;
    RETURN public.videoforge_hosted_api_job_json(job);
  END IF;
  IF job.state<>'SUBMITTED' OR job.provider_task_id IS NULL
     OR NOT EXISTS(SELECT 1 FROM public.generation_requests r
       WHERE r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id
         AND r.id=supplied_generation_request_id AND r.state='ACTIVE') THEN
    RAISE EXCEPTION 'API generation output state invalid' USING ERRCODE='23514';
  END IF;
  asset_id:=md5('hosted-api-asset:'||job.id::text)::uuid;
  reservation_id:=md5('hosted-api-reservation:'||job.id::text)::uuid;
  receipt_id:=md5('hosted-api-receipt:'||job.id::text)::uuid;
  unit_id:=md5('hosted-api-accepted-unit:'||job.id::text)::uuid;
  lane_name:=CASE job.lane WHEN 'IMAGE' THEN 'mage_image' ELSE 'soulx_avatar' END;
  SELECT * INTO runtime FROM public.video_runtime_states v
    WHERE v.account_id=supplied_account_id AND v.workspace_id=supplied_workspace_id
      AND v.generation_request_id=supplied_generation_request_id FOR UPDATE;
  SELECT * INTO lane FROM public.video_runtime_lane_states l
    WHERE l.account_id=supplied_account_id AND l.workspace_id=supplied_workspace_id
      AND l.runtime_id=runtime.id AND l.lane=lane_name FOR UPDATE;
  IF runtime.id IS NULL OR runtime.terminal_at IS NOT NULL OR lane.id IS NULL
     OR lane.current_attempt_id IS NOT NULL OR lane.state NOT IN ('MANIFEST_DURABLE','SUCCEEDED') THEN
    RAISE EXCEPTION 'API generation runtime not accepting output' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.assets(id,account_id,workspace_id,project_id,project_revision_id,
    kind,state,object_key,binary_sha256,content_type,byte_size,width_px,height_px,duration_ms,
    metadata,verified_at)
  VALUES(asset_id,supplied_account_id,supplied_workspace_id,job.project_id,job.project_revision_id,
    CASE job.lane WHEN 'IMAGE' THEN 'IMAGE' ELSE 'AVATAR_CLIP' END,'ACCEPTED',
    job.output_object_key,supplied_sha256,supplied_content_type,supplied_bytes,
    CASE WHEN job.lane='IMAGE' THEN (supplied_probe->>'width')::integer ELSE NULL END,
    CASE WHEN job.lane='IMAGE' THEN (supplied_probe->>'height')::integer ELSE NULL END,
    CASE WHEN job.lane='AVATAR' THEN (supplied_probe->>'durationMs')::bigint ELSE NULL END,
    jsonb_build_object('provider',CASE job.lane WHEN 'IMAGE' THEN 'KIE_Z_IMAGE' ELSE 'FAL_FLASHHEAD' END,
      'providerTaskId',job.provider_task_id,'generationRequestId',job.generation_request_id,
      'generationTaskId',job.generation_task_id,'probe',supplied_probe),now_at);
  INSERT INTO public.artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,
    asset_id,lane,job_id,artifact_id,object_key,method,content_type,content_length,
    checksum_sha256,expires_at,max_uses,used_count,state,retention_class,retain_until,
    deletion_owner_account_id)
  VALUES(reservation_id,supplied_account_id,supplied_workspace_id,job.project_id,job.project_revision_id,
    asset_id,CASE job.lane WHEN 'IMAGE' THEN 'MAGE_IMAGE' ELSE 'SOULX_AVATAR' END,
    job.id::text,job.generation_task_id::text,job.output_object_key,'PUT',supplied_content_type,
    supplied_bytes,supplied_sha256,now_at+interval '1 hour',1,1,'COMMITTED','PROJECT',NULL,
    supplied_account_id);
  receipt_facts:=jsonb_build_object('schema_version','artifact-commit-receipt/v3',
    'receipt_id',receipt_id,'reservation_id',reservation_id,'account_id',supplied_account_id,
    'workspace_id',supplied_workspace_id,'object_key',job.output_object_key,
    'callback_id','hosted-api-'||receipt_id::text,'content_type',supplied_content_type,
    'content_length',supplied_bytes,'checksum_sha256',supplied_sha256,'probe',supplied_probe,
    'retention_class','PROJECT','retain_until',NULL,'committed_at',
    to_char(now_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  receipt_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(receipt_facts),'UTF8')),'hex');
  INSERT INTO public.artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,
    object_key,content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at)
  VALUES(receipt_id,supplied_account_id,supplied_workspace_id,reservation_id,
    'hosted-api-'||receipt_id::text,job.output_object_key,supplied_content_type,supplied_bytes,
    supplied_sha256,supplied_probe,receipt_hash,now_at);
  UPDATE public.hosted_api_generation_jobs SET state='SUCCEEDED',output_sha256=supplied_sha256,
    output_bytes=supplied_bytes,output_content_type=supplied_content_type,
    output_asset_id=asset_id,output_receipt_id=receipt_id,completed_at=now_at,updated_at=now_at
    WHERE id=job.id RETURNING * INTO job;
  INSERT INTO public.video_runtime_accepted_units(id,account_id,workspace_id,runtime_id,
    project_revision_id,lane,item_id,object_key,checksum_sha256,content_length,
    accepted_attempt_id,api_job_id,accepted_at)
  VALUES(unit_id,supplied_account_id,supplied_workspace_id,runtime.id,job.project_revision_id,
    lane_name,job.generation_task_id::text,job.output_object_key,supplied_sha256,supplied_bytes,
    NULL,job.id,now_at);
  SELECT count(*) INTO accepted_count FROM public.video_runtime_accepted_units u
    WHERE u.runtime_id=runtime.id AND u.lane=lane_name;
  IF accepted_count>lane.planned_item_count OR lane.planned_item_count<1 THEN
    RAISE EXCEPTION 'API generation lane count invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.video_runtime_lane_states SET accepted_item_count=accepted_count,
    state=CASE WHEN accepted_count=planned_item_count THEN 'SUCCEEDED' ELSE state END,
    version=version+1,updated_at=now_at WHERE id=lane.id;
  RETURN public.videoforge_hosted_api_job_json(job);
END;
$$;

CREATE OR REPLACE FUNCTION public.videoforge_validate_video_runtime_accepted_unit()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE
  bound_attempt public.serverless_attempts%ROWTYPE;
  api_job public.hosted_api_generation_jobs%ROWTYPE;
  runtime_revision uuid;
BEGIN
  SELECT project_revision_id INTO runtime_revision FROM public.video_runtime_states
    WHERE id=NEW.runtime_id;
  IF runtime_revision IS NULL OR runtime_revision<>NEW.project_revision_id THEN
    RAISE EXCEPTION 'accepted unit does not bind its video revision' USING ERRCODE='23514';
  END IF;
  IF NEW.api_job_id IS NOT NULL THEN
    SELECT * INTO api_job FROM public.hosted_api_generation_jobs WHERE id=NEW.api_job_id;
    IF api_job.id IS NULL OR api_job.account_id<>NEW.account_id
       OR api_job.workspace_id<>NEW.workspace_id
       OR api_job.project_revision_id<>NEW.project_revision_id
       OR api_job.generation_request_id<>(SELECT generation_request_id
          FROM public.video_runtime_states WHERE id=NEW.runtime_id)
       OR (NEW.lane='mage_image' AND api_job.lane<>'IMAGE')
       OR (NEW.lane='soulx_avatar' AND api_job.lane<>'AVATAR')
       OR api_job.state<>'SUCCEEDED' OR api_job.generation_task_id::text<>NEW.item_id
       OR api_job.output_object_key<>NEW.object_key
       OR api_job.output_sha256<>NEW.checksum_sha256
       OR api_job.output_bytes<>NEW.content_length THEN
      RAISE EXCEPTION 'accepted unit does not bind an accepted API job' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO bound_attempt FROM public.serverless_attempts WHERE id=NEW.accepted_attempt_id;
    IF bound_attempt.id IS NULL OR bound_attempt.lane<>NEW.lane
       OR bound_attempt.project_revision_id<>NEW.project_revision_id
       OR bound_attempt.account_id<>NEW.account_id THEN
      RAISE EXCEPTION 'accepted unit does not bind an attempt of this video lane' USING ERRCODE='23514';
    END IF;
    IF NEW.object_key<>bound_attempt.output_prefix||'/artifact/'||NEW.item_id THEN
      RAISE EXCEPTION 'accepted unit key is outside its attempt output prefix' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.artifact_receipts receipt
      JOIN public.artifact_reservations reservation
        ON reservation.account_id=receipt.account_id AND reservation.workspace_id=receipt.workspace_id
        AND reservation.id=receipt.reservation_id
      WHERE receipt.account_id=NEW.account_id AND receipt.workspace_id=NEW.workspace_id
        AND receipt.deleted_at IS NULL AND receipt.object_key=NEW.object_key
        AND receipt.checksum_sha256=NEW.checksum_sha256
        AND receipt.content_length=NEW.content_length
        AND reservation.project_revision_id=NEW.project_revision_id
        AND reservation.artifact_id=NEW.item_id) THEN
    RAISE EXCEPTION 'accepted unit has no live tenant artifact commit receipt' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

-- The RunPod reader remains the exact predecessor for existing attempts. Fresh
-- API generations use the same render document shape and receipt validation.
ALTER FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid)
  RENAME TO videoforge_read_hosted_v209_ready_render_inputs_gpu;
CREATE FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  request public.generation_requests%ROWTYPE;
  revision public.project_revisions%ROWTYPE;
  bridge public.hosted_canonical_timing_bridges%ROWTYPE;
  voiceover jsonb; avatar jsonb; visuals jsonb;
  has_avatar_full boolean; expected_count integer; job_count integer;
  manifest_asset_id uuid; manifest_reservation_id uuid; object_key text;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO job_count FROM public.hosted_api_generation_jobs j
    WHERE j.account_id=supplied_account_id AND j.workspace_id=supplied_workspace_id
      AND j.generation_request_id=supplied_generation_request_id;
  IF job_count=0 THEN
    RETURN public.videoforge_read_hosted_v209_ready_render_inputs_gpu(
      supplied_account_id,supplied_workspace_id,supplied_generation_request_id);
  END IF;
  SELECT * INTO request FROM public.generation_requests r WHERE r.account_id=supplied_account_id
    AND r.workspace_id=supplied_workspace_id AND r.id=supplied_generation_request_id;
  SELECT * INTO revision FROM public.project_revisions r WHERE r.account_id=supplied_account_id
    AND r.workspace_id=supplied_workspace_id AND r.id=request.project_revision_id AND r.status='LOCKED';
  SELECT * INTO bridge FROM public.hosted_canonical_timing_bridges b
    WHERE b.account_id=supplied_account_id AND b.workspace_id=supplied_workspace_id
      AND b.project_revision_id=request.project_revision_id;
  SELECT count(*) INTO expected_count FROM jsonb_array_elements(bridge.task_manifest) item
    WHERE item->>'lane' IN ('IMAGE','AVATAR');
  IF request.id IS NULL OR revision.id IS NULL OR bridge.hosted_asr_attempt_id IS NULL
     OR expected_count=0 OR job_count<>expected_count
     OR EXISTS(SELECT 1 FROM public.hosted_api_generation_jobs j
       WHERE j.generation_request_id=supplied_generation_request_id AND j.state<>'SUCCEEDED')
     OR (SELECT count(*) FROM public.video_runtime_lane_states lane
       JOIN public.video_runtime_states runtime ON runtime.id=lane.runtime_id
       WHERE runtime.generation_request_id=supplied_generation_request_id
         AND lane.state='SUCCEEDED' AND lane.lane IN ('mage_image','soulx_avatar'))<>2 THEN
    RETURN NULL;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.timeline_segments segment
    WHERE segment.account_id=supplied_account_id AND segment.workspace_id=supplied_workspace_id
      AND segment.project_revision_id=request.project_revision_id
      AND segment.timeline_plan_id=bridge.timeline_plan_id
      AND segment.timeline_composition='AVATAR_FULL') INTO has_avatar_full;
  SELECT jsonb_build_object('assetId',asset.id,'sha256',asset.binary_sha256,
      'objectKey',asset.object_key,'contentType',asset.content_type,
      'contentLength',asset.byte_size,'receiptId',receipt.id)
    INTO voiceover FROM public.assets asset JOIN public.artifact_reservations reservation
      ON reservation.account_id=asset.account_id AND reservation.workspace_id=asset.workspace_id
      AND reservation.asset_id=asset.id AND reservation.state='COMMITTED'
    JOIN public.artifact_receipts receipt ON receipt.account_id=reservation.account_id
      AND receipt.workspace_id=reservation.workspace_id AND receipt.reservation_id=reservation.id
      AND receipt.deleted_at IS NULL
    WHERE asset.account_id=supplied_account_id AND asset.workspace_id=supplied_workspace_id
      AND asset.id=revision.voiceover_asset_id
      AND asset.binary_sha256=revision.voiceover_binary_sha256
      AND asset.state IN ('VERIFIED','ACCEPTED') ORDER BY receipt.committed_at DESC LIMIT 1;
  SELECT jsonb_build_object('assetId',asset.id,'sha256',asset.binary_sha256,
      'objectKey',asset.object_key,'contentType',asset.content_type,
      'contentLength',asset.byte_size,'receiptId',receipt.id)
    INTO avatar FROM public.assets asset JOIN public.artifact_reservations reservation
      ON reservation.account_id=asset.account_id AND reservation.workspace_id=asset.workspace_id
      AND reservation.asset_id=asset.id AND reservation.state='COMMITTED'
    JOIN public.artifact_receipts receipt ON receipt.account_id=reservation.account_id
      AND receipt.workspace_id=reservation.workspace_id AND receipt.reservation_id=reservation.id
      AND receipt.deleted_at IS NULL
    WHERE asset.account_id=supplied_account_id AND asset.workspace_id=supplied_workspace_id
      AND asset.id=revision.avatar_runtime_source_asset_id
      AND asset.binary_sha256=revision.avatar_runtime_source_binary_sha256
      AND has_avatar_full AND asset.state IN ('VERIFIED','ACCEPTED')
    ORDER BY receipt.committed_at DESC LIMIT 1;
  SELECT jsonb_agg(jsonb_build_object('taskId',job.generation_task_id,
      'taskKey',job.task_key,'acceptedAttemptId',job.id,'assetId',asset.id,
      'sha256',receipt.checksum_sha256,'objectKey',receipt.object_key,
      'contentType',receipt.content_type,'contentLength',receipt.content_length,
      'receiptId',receipt.id,'lane',CASE job.lane WHEN 'IMAGE' THEN 'mage_image'
        ELSE 'soulx_avatar' END,'rendererSourceProfile',CASE job.lane WHEN 'AVATAR'
        THEN 'fal-flashhead-512x512p25-v1' ELSE NULL END)
      ORDER BY job.lane,job.task_key) INTO visuals
    FROM public.hosted_api_generation_jobs job
    JOIN public.assets asset ON asset.account_id=job.account_id
      AND asset.workspace_id=job.workspace_id AND asset.id=job.output_asset_id
      AND asset.binary_sha256=job.output_sha256 AND asset.state='ACCEPTED'
    JOIN public.artifact_receipts receipt ON receipt.account_id=job.account_id
      AND receipt.workspace_id=job.workspace_id AND receipt.id=job.output_receipt_id
      AND receipt.checksum_sha256=job.output_sha256 AND receipt.deleted_at IS NULL
    JOIN public.video_runtime_accepted_units unit ON unit.account_id=job.account_id
      AND unit.workspace_id=job.workspace_id AND unit.api_job_id=job.id
      AND unit.object_key=receipt.object_key AND unit.checksum_sha256=receipt.checksum_sha256
    WHERE job.account_id=supplied_account_id AND job.workspace_id=supplied_workspace_id
      AND job.generation_request_id=supplied_generation_request_id AND job.state='SUCCEEDED';
  IF voiceover IS NULL OR (has_avatar_full AND avatar IS NULL)
     OR visuals IS NULL OR jsonb_array_length(visuals)<>expected_count THEN
    RETURN NULL;
  END IF;
  manifest_asset_id:=md5('hosted-v209-render-manifest-asset:'||supplied_generation_request_id::text)::uuid;
  manifest_reservation_id:=md5('hosted-v209-render-manifest-reservation:'||supplied_generation_request_id::text)::uuid;
  object_key:='tenant/'||supplied_account_id::text||'/workspace/'||supplied_workspace_id::text||
    '/project/'||request.project_id::text||'/revision/'||request.project_revision_id::text||
    '/lane/render/job/'||supplied_generation_request_id::text||'/artifact/'||manifest_asset_id::text;
  RETURN jsonb_build_object('schemaVersion','videoforge.hosted-v209-ready-render-inputs/v1',
    'accountId',supplied_account_id,'workspaceId',supplied_workspace_id,
    'generationRequestId',supplied_generation_request_id,
    'revision',jsonb_build_object('snapshot',to_jsonb(revision)-'account_id'-'workspace_id',
      'document',revision.revision_config_payload),
    'timing',jsonb_build_object('transcript',bridge.append_payload->'transcript',
      'transcriptSha256',bridge.transcript_document_hash,'timeline',bridge.append_payload->'timeline',
      'timelineSha256',bridge.timeline_document_hash,
      'timelineTranscriptSha256',bridge.append_payload#>>'{timeline,row,transcript_document_hash}'),
    'voiceover',voiceover,'acceptedVisuals',visuals,
    'tools',jsonb_build_object('ffmpegVersion','8.1.2','ffprobeVersion','8.1.2'),
    'manifestReservation',jsonb_build_object('assetId',manifest_asset_id,
      'reservationId',manifest_reservation_id,'objectKey',object_key))||
    CASE WHEN has_avatar_full THEN jsonb_build_object('avatarSource',avatar) ELSE '{}'::jsonb END;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_hosted_api_job_json(public.hosted_api_generation_jobs) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_api_jobs(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_materialize_hosted_api_jobs(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_claim_hosted_api_job(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_bind_hosted_api_image_prompt(uuid,uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_hosted_api_task(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_mark_hosted_api_unknown(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_fail_hosted_api_job(uuid,uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_commit_hosted_api_output(uuid,uuid,uuid,uuid,text,bigint,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs_gpu(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_read_hosted_api_jobs(uuid,uuid,uuid),
  public.videoforge_materialize_hosted_api_jobs(uuid,uuid,uuid,uuid),
  public.videoforge_claim_hosted_api_job(uuid,uuid,uuid,uuid,uuid),
  public.videoforge_bind_hosted_api_image_prompt(uuid,uuid,uuid,uuid,text),
  public.videoforge_record_hosted_api_task(uuid,uuid,uuid,uuid,uuid,text),
  public.videoforge_mark_hosted_api_unknown(uuid,uuid,uuid,uuid,uuid),
  public.videoforge_fail_hosted_api_job(uuid,uuid,uuid,uuid,text),
  public.videoforge_commit_hosted_api_output(uuid,uuid,uuid,uuid,text,bigint,text,jsonb),
  public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;
