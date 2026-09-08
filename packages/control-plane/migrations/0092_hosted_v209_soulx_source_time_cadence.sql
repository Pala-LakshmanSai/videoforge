-- V2-09 forward repair: bridge the immutable 30 fps timeline/source-time contract to the
-- qualified SoulX 25 fps audio cadence. Canonical source selections remain stored unchanged;
-- the provider-bound materialization snaps their working bounds outward to exact 40 ms frames.
-- Ordinary dispatch validates the resulting trim against that exact derived source span rather
-- than against the unrelated absolute 30 fps timeline frame range.

CREATE OR REPLACE FUNCTION public.videoforge_materialize_hosted_v209_ordinary_dispatch(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid,
  supplied_project_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  request public.generation_requests%ROWTYPE;
  revision public.project_revisions%ROWTYPE;
  lease public.provider_workload_leases%ROWTYPE;
  bridge public.hosted_canonical_timing_bridges%ROWTYPE;
  plan public.timeline_plans%ROWTYPE;
  runtime public.video_runtime_states%ROWTYPE;
  stored public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  deployment public.serverless_endpoint_deployments%ROWTYPE;
  qualification public.hosted_serverless_qualification_attestations%ROWTYPE;
  task_row record; prompt_row record; span_row record; lane_name text;
  generation_tasks jsonb; generation_plan jsonb; render_plan jsonb;
  batches jsonb:='[]'::jsonb; batch jsonb; items jsonb; item jsonb;
  mage_work jsonb:='[]'::jsonb; soulx_work jsonb:='[]'::jsonb; work jsonb;
  lane_bindings jsonb:='[]'::jsonb; lane_binding jsonb; pair jsonb:='[]'::jsonb;
  item_manifest jsonb; input_manifest jsonb; reservation_manifest jsonb; reservation_ids jsonb;
  worker_reservation_ids jsonb;
  batch_id uuid; dispatch_task_id uuid; attempt_id uuid; input_id uuid; output_id uuid;
  avatar_input_id uuid;
  output_prefix text; role_name text; artifact_input jsonb; output_reservation jsonb;
  artifact_sha text; work_item jsonb; request_body jsonb; envelope jsonb;
  items_sha text; input_sha text; reservation_sha text; request_sha text; envelope_sha text;
  approval_id uuid; approval_base jsonb; approval_sha text; candidate_base jsonb; candidate_sha text;
  expires_at timestamptz; materialized_replay boolean; attempt_count integer;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.account_id=supplied_account_id
       AND m.workspace_id=supplied_workspace_id AND m.user_id=supplied_user_id AND m.status='ACTIVE')
     OR NOT EXISTS(SELECT 1 FROM public.projects p WHERE p.account_id=supplied_account_id
       AND p.workspace_id=supplied_workspace_id AND p.id=supplied_project_id AND p.status='ACTIVE') THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary project scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT r.* INTO request FROM public.generation_requests r
    WHERE r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id
      AND r.project_id=supplied_project_id AND r.state='ACTIVE' AND r.terminal_at IS NULL
    ORDER BY r.created_at DESC,r.id DESC LIMIT 1 FOR UPDATE;
  IF request.id IS NULL OR request.created_by_user_id<>supplied_user_id THEN
    RAISE EXCEPTION 'hosted V2-09 active generation request unavailable' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(request.id::text,41));
  SELECT c.* INTO stored FROM public.hosted_v209_ordinary_dispatch_candidates c
    WHERE c.account_id=supplied_account_id AND c.workspace_id=supplied_workspace_id
      AND c.generation_request_id=request.id FOR SHARE;
  IF stored.generation_request_id IS NOT NULL THEN
    SELECT count(*)::integer INTO attempt_count FROM public.serverless_attempts a
      WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
        AND a.generation_request_id=request.id;
    IF attempt_count NOT IN (0,2) OR stored.expires_at<=db_now THEN
      RAISE EXCEPTION 'hosted V2-09 candidate is stale or partially dispatched' USING ERRCODE='23505';
    END IF;
    RETURN stored.candidate_document||jsonb_build_object('candidateSha256',stored.candidate_sha256,
      'replayed',true,'pairExists',attempt_count=2,'existingWorkflowId',
      CASE WHEN attempt_count=2 THEN 'hosted-pair-'||request.id::text ELSE NULL END);
  END IF;
  IF EXISTS(SELECT 1 FROM public.serverless_attempts a WHERE a.account_id=supplied_account_id
       AND a.workspace_id=supplied_workspace_id AND a.generation_request_id=request.id) THEN
    RAISE EXCEPTION 'hosted V2-09 redispatch forbidden' USING ERRCODE='23505';
  END IF;
  SELECT r.* INTO revision FROM public.project_revisions r
    WHERE r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id
      AND r.project_id=supplied_project_id AND r.id=request.project_revision_id FOR SHARE;
  SELECT l.* INTO lease FROM public.provider_workload_leases l
    WHERE l.account_id=supplied_account_id AND l.workspace_id=supplied_workspace_id
      AND l.generation_request_id=request.id AND l.request_kind='VIDEO' AND l.state='ACTIVE'
      AND l.released_at IS NULL AND l.expires_at>db_now FOR UPDATE;
  SELECT b.* INTO bridge FROM public.hosted_canonical_timing_bridges b
    WHERE b.account_id=supplied_account_id AND b.workspace_id=supplied_workspace_id
      AND b.project_id=supplied_project_id AND b.project_revision_id=request.project_revision_id FOR SHARE;
  SELECT p.* INTO plan FROM public.timeline_plans p WHERE p.account_id=supplied_account_id
    AND p.workspace_id=supplied_workspace_id AND p.project_revision_id=request.project_revision_id
    AND p.id=bridge.timeline_plan_id FOR SHARE;
  SELECT v.* INTO runtime FROM public.video_runtime_states v WHERE v.account_id=supplied_account_id
    AND v.workspace_id=supplied_workspace_id AND v.generation_request_id=request.id FOR UPDATE;
  IF revision.id IS NULL OR revision.status<>'LOCKED' OR lease.id IS NULL
     OR bridge.hosted_asr_attempt_id IS NULL OR plan.id IS NULL
     OR runtime.id IS NULL OR runtime.project_id<>supplied_project_id
     OR runtime.project_revision_id<>revision.id OR runtime.stage<>'WAITING_FOR_WORKER'
     OR runtime.terminal_at IS NOT NULL
     OR (SELECT count(*) FROM public.video_runtime_lane_states l WHERE l.account_id=supplied_account_id
       AND l.workspace_id=supplied_workspace_id AND l.runtime_id=runtime.id
       AND l.lane IN ('mage_image','soulx_avatar') AND l.state='MANIFEST_DURABLE'
       AND l.current_attempt_id IS NULL)<>2 THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary lineage is not dispatch ready' USING ERRCODE='23514';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('task_id',value->>'id','task_key',value->>'task_key',
      'lane',value->>'lane','state','BLOCKED','timeline_segment_id',value->>'timeline_segment_id',
      'depends_on',value->'depends_on') ORDER BY value->>'task_key')
    INTO generation_tasks FROM jsonb_array_elements(bridge.task_manifest) value;
  generation_plan:=jsonb_build_object('schema_version','videoforge-hosted-generation-plan/v1',
    'project_id',supplied_project_id,'project_revision_id',revision.id,
    'asr_attempt_id',bridge.hosted_asr_attempt_id,'revision_config_sha256',revision.revision_config_hash,
    'transcript_sha256',bridge.transcript_document_hash,'timeline_plan_sha256',bridge.timeline_document_hash,
    'scheduler_config_sha256',plan.scheduler_config_hash,'tasks',generation_tasks,
    'predispatch','WAITING_FOR_GPU_QUALIFICATION');
  IF bridge.generation_plan_sha256<>'sha256:'||encode(sha256(convert_to(
      public.videoforge_canonical_jsonb(generation_plan),'UTF8')),'hex') THEN
    RAISE EXCEPTION 'hosted V2-09 generation plan drifted' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hosted_prompt_runs h JOIN public.prompt_executions e
       ON e.account_id=h.account_id AND e.workspace_id=h.workspace_id AND e.task_id=h.task_id
       WHERE h.account_id=supplied_account_id AND h.workspace_id=supplied_workspace_id
         AND h.project_id=supplied_project_id AND h.project_revision_id=revision.id
         AND h.timeline_plan_id=plan.id AND h.state='SUCCEEDED') THEN
    RAISE EXCEPTION 'hosted V2-09 successful durable prompts unavailable' USING ERRCODE='23514';
  END IF;
  expires_at:=least(db_now+interval '1 hour',lease.expires_at);

  FOREACH lane_name IN ARRAY ARRAY['mage_image','soulx_avatar'] LOOP
    SELECT d.* INTO deployment FROM public.serverless_endpoint_deployments d
      WHERE d.lane=lane_name AND d.is_active FOR SHARE;
    SELECT q.* INTO qualification FROM public.hosted_serverless_qualification_attestations q
      WHERE q.lane=lane_name AND q.deployment_id=deployment.id AND q.independent_audit_accepted
        AND q.verified_at<=db_now AND q.expires_at>db_now ORDER BY q.expires_at DESC LIMIT 1 FOR SHARE;
    IF deployment.id IS NULL OR qualification.id IS NULL OR deployment.worker_count_min<>0
       OR deployment.worker_count_max<>1 OR deployment.handler_concurrency<>1
       OR deployment.region<>'EU-RO-1'
       OR deployment.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
       OR deployment.gpu_count_per_worker<>1 OR deployment.retained_active_workers<>0
       OR deployment.volume_mount<>'/runpod-volume' OR deployment.blind_resubmit_permitted
       OR qualification.expires_at<db_now+make_interval(secs=>deployment.request_ttl_seconds)
       OR qualification.deployment_snapshot_sha256<>
          public.videoforge_hosted_deployment_snapshot_sha256(deployment.id) THEN
      RAISE EXCEPTION 'hosted V2-09 exact qualified max-one lane unavailable' USING ERRCODE='42501';
    END IF;
    expires_at:=least(expires_at,qualification.expires_at);
    dispatch_task_id:=public.videoforge_hosted_v209_uuid('dispatch-task',request.id,lane_name);
    batch_id:=public.videoforge_hosted_v209_uuid('batch',request.id,lane_name);
    attempt_id:=public.videoforge_hosted_dispatch_uuid('attempt',request.id,dispatch_task_id,1);
    avatar_input_id:=CASE WHEN lane_name='soulx_avatar' THEN
      public.videoforge_hosted_v209_uuid('input-reservation',request.id,'avatar-source') ELSE NULL END;
    output_prefix:='tenant/'||supplied_account_id::text||'/workspace/'||supplied_workspace_id::text||
      '/project/'||supplied_project_id::text||'/revision/'||revision.id::text||'/lane/'||
      CASE lane_name WHEN 'mage_image' THEN 'mage-image' ELSE 'soulx-avatar' END||
      '/job/'||attempt_id::text;
    items:='[]'::jsonb;
    FOR task_row IN
      SELECT t.id,t.task_key,t.lane,(m->>'timeline_segment_id')::uuid timeline_segment_id,
        s.segment_key,s.timeline_composition,s.in_image_shot_role,s.required_slots,
        s.start_frame,s.end_frame_exclusive
      FROM jsonb_array_elements(bridge.task_manifest) m
      JOIN public.generation_tasks t ON t.account_id=supplied_account_id
        AND t.workspace_id=supplied_workspace_id AND t.id=(m->>'id')::uuid
      JOIN public.timeline_segments s ON s.account_id=supplied_account_id
        AND s.workspace_id=supplied_workspace_id AND s.project_revision_id=revision.id
        AND s.timeline_plan_id=plan.id AND s.id=(m->>'timeline_segment_id')::uuid
      WHERE m->>'lane'=CASE lane_name WHEN 'mage_image' THEN 'IMAGE' ELSE 'AVATAR' END
        AND t.project_revision_id=revision.id AND t.state='BLOCKED'
      ORDER BY t.task_key
    LOOP
      input_id:=public.videoforge_hosted_v209_uuid('input-reservation',request.id,task_row.id::text);
      output_id:=public.videoforge_hosted_v209_uuid('output-reservation',request.id,task_row.id::text);
      IF lane_name='mage_image' THEN
        SELECT r.id,r.compiled_prompt,r.positive_prompt_hash,r.negative_prompt_hash,
          e.image_style_version_id,e.style_profile_hash
          INTO prompt_row FROM public.prompt_scene_results r
          JOIN public.prompt_executions e ON e.account_id=supplied_account_id
            AND e.workspace_id=supplied_workspace_id AND e.id=r.prompt_execution_id
          WHERE e.project_id=supplied_project_id AND e.project_revision_id=revision.id
            AND e.timeline_plan_id=plan.id AND r.scene_id=task_row.segment_key;
        IF prompt_row.id IS NULL THEN
          RAISE EXCEPTION 'hosted V2-09 prompt/task coverage incomplete' USING ERRCODE='23514';
        END IF;
        role_name:=CASE task_row.timeline_composition WHEN 'IMAGE_FULL' THEN 'image'
          WHEN 'AVATAR_SPLIT_IMAGE' THEN 'right_image' ELSE '' END;
        artifact_sha:='sha256:'||encode(sha256(convert_to(
          public.videoforge_canonical_jsonb(prompt_row.compiled_prompt),'UTF8')),'hex');
        artifact_input:=jsonb_build_object('reservation_id',input_id,'object_key',
          output_prefix||'/artifact/input-'||(jsonb_array_length(items)+1)::text,
          'segment_id',task_row.segment_key,'role',role_name,'asset_id',prompt_row.id,
          'sha256',artifact_sha,'compiled_prompt',prompt_row.compiled_prompt,
          'positive_prompt_sha256',prompt_row.positive_prompt_hash,
          'negative_prompt_sha256',prompt_row.negative_prompt_hash,
          'image_style_version_id',prompt_row.image_style_version_id,
          'style_profile_sha256',prompt_row.style_profile_hash);
        work_item:=jsonb_build_object('taskId',task_row.id,'segmentId',task_row.segment_key,
          'role',role_name,'promptResultId',prompt_row.id,'promptSha256',artifact_sha,
          'compiledPrompt',prompt_row.compiled_prompt,
          'positivePromptSha256',prompt_row.positive_prompt_hash,
          'negativePromptSha256',prompt_row.negative_prompt_hash,
          'styleVersionId',prompt_row.image_style_version_id,
          'styleProfileSha256',prompt_row.style_profile_hash,'inputReservationId',input_id,
          'outputReservationId',output_id,'outputPrefix',output_prefix);
        mage_work:=mage_work||jsonb_build_array(work_item);
      ELSE
        role_name:='avatar';
        SELECT a.*,source.object_key source_object_key,source.content_type source_content_type,
          source.byte_size source_byte_size,avatar.object_key avatar_object_key,
          avatar.content_type avatar_content_type,avatar.byte_size avatar_byte_size,
          audio.object_key span_object_key,audio.content_type span_content_type,
          audio.byte_size span_byte_size,audio.binary_sha256 span_binary_sha256,
          (audio.metadata->>'sample_rate_hz')::integer span_sample_rate_hz,
          (audio.metadata->>'channels')::integer span_channels,
          (audio.metadata->>'padded_samples_48k')::bigint padded_samples_48k,
          (audio.metadata->>'trim_start_sample_48k')::bigint trim_start_sample_48k,
          (audio.metadata->>'trim_end_sample_exclusive_48k')::bigint trim_end_sample_exclusive_48k
          INTO span_row FROM public.selected_span_audio a
          JOIN public.assets source ON source.account_id=a.account_id
            AND source.workspace_id=a.workspace_id AND source.id=a.source_asset_id
            AND source.state IN ('VERIFIED','ACCEPTED')
            AND source.binary_sha256=a.source_binary_sha256
          JOIN public.assets avatar ON avatar.account_id=a.account_id
            AND avatar.workspace_id=a.workspace_id AND avatar.id=revision.avatar_runtime_source_asset_id
            AND avatar.state IN ('VERIFIED','ACCEPTED')
            AND avatar.binary_sha256=revision.avatar_runtime_source_binary_sha256
          JOIN public.assets audio ON audio.account_id=a.account_id
            AND audio.workspace_id=a.workspace_id AND audio.id=a.materialized_asset_id
            AND audio.project_id=supplied_project_id AND audio.project_revision_id=revision.id
            AND audio.kind='AUDIO_SPAN' AND audio.state IN ('VERIFIED','ACCEPTED')
            AND audio.binary_sha256=a.materialized_binary_sha256
          WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
            AND a.project_revision_id=revision.id AND a.timeline_plan_id=plan.id
            AND a.timeline_segment_id=task_row.timeline_segment_id
            AND jsonb_typeof(task_row.required_slots->'avatar')='object'
            AND nullif(task_row.required_slots->'avatar'->>'span_audio_task_key','') IS NOT NULL
            AND a.task_key=task_row.required_slots->'avatar'->>'span_audio_task_key'
            AND a.state='MATERIALIZED';
        IF span_row.id IS NULL OR span_row.source_object_key IS NULL
           OR span_row.source_content_type NOT IN ('audio/flac','audio/mpeg','audio/mp4','audio/wav')
           OR span_row.source_byte_size IS NULL OR span_row.source_byte_size<1
           OR span_row.avatar_object_key IS NULL
           OR span_row.avatar_content_type NOT IN ('image/jpeg','image/png')
           OR span_row.avatar_byte_size IS NULL OR span_row.avatar_byte_size<1
           OR span_row.span_object_key IS NULL
           OR span_row.span_content_type<>'audio/wav'
           OR span_row.span_byte_size IS NULL OR span_row.span_byte_size<1
           OR span_row.span_sample_rate_hz IS DISTINCT FROM 48000
           OR span_row.span_channels IS DISTINCT FROM 1
           OR span_row.padded_samples_48k IS NULL
           OR span_row.trim_start_sample_48k IS NULL
           OR span_row.trim_end_sample_exclusive_48k IS NULL
           OR span_row.padded_samples_48k NOT BETWEEN 144000 AND 485760
           OR span_row.trim_start_sample_48k<0
           OR span_row.trim_start_sample_48k>=span_row.trim_end_sample_exclusive_48k
           OR span_row.trim_end_sample_exclusive_48k>span_row.padded_samples_48k
           OR span_row.padded_samples_48k%1920<>0
           OR span_row.trim_start_sample_48k%1920<>0
           OR span_row.trim_end_sample_exclusive_48k%1920<>0
           OR span_row.trim_end_sample_exclusive_48k-span_row.trim_start_sample_48k
                NOT BETWEEN 96000 AND 480000
           OR span_row.trim_end_sample_exclusive_48k-span_row.trim_start_sample_48k
                <>((((span_row.selected_end_ms_exclusive+39)/40)*40)-
                   ((span_row.selected_start_ms/40)*40))*48 THEN
          RAISE EXCEPTION 'hosted V2-09 avatar span/task coverage incomplete' USING ERRCODE='23514';
        END IF;
        artifact_sha:=span_row.span_binary_sha256;
        artifact_input:=jsonb_build_object('reservation_id',input_id,'object_key',
          span_row.span_object_key,'content_type',span_row.span_content_type,
          'content_length',span_row.span_byte_size,'segment_id',task_row.segment_key,
          'role','avatar','asset_id',span_row.materialized_asset_id,
          'sha256',artifact_sha,'source_voiceover_asset_id',span_row.source_asset_id,
          'source_voiceover_sha256',span_row.source_binary_sha256,
          'source_voiceover_object_key',span_row.source_object_key,
          'source_voiceover_content_type',span_row.source_content_type,
          'source_voiceover_content_length',span_row.source_byte_size,
          'selected_start_ms',span_row.selected_start_ms,
          'selected_end_ms_exclusive',span_row.selected_end_ms_exclusive,
          'padded_start_ms',span_row.padded_start_ms,
          'padded_end_ms_exclusive',span_row.padded_end_ms_exclusive,
          'trim_start_ms',span_row.trim_start_ms,'trim_end_ms_exclusive',span_row.trim_end_ms_exclusive,
          'avatar_source_asset_id',revision.avatar_runtime_source_asset_id,
          'avatar_source_sha256',revision.avatar_runtime_source_binary_sha256,
          'avatar_source_object_key',span_row.avatar_object_key,
          'avatar_source_content_type',span_row.avatar_content_type,
          'avatar_source_content_length',span_row.avatar_byte_size);
        work_item:=jsonb_build_object('taskId',task_row.id,'segmentId',task_row.segment_key,
          'role','avatar','spanAudioId',span_row.id,'spanAudioSha256',artifact_sha,
          'spanAudioAssetId',span_row.materialized_asset_id,
          'spanAudioObjectKey',span_row.span_object_key,
          'spanAudioContentType',span_row.span_content_type,
          'spanAudioContentLength',span_row.span_byte_size,
          'spanAudioSampleRateHz',span_row.span_sample_rate_hz,
          'spanAudioChannels',span_row.span_channels,
          'paddedSamples48k',span_row.padded_samples_48k,
          'trimStartSample48k',span_row.trim_start_sample_48k,
          'trimEndSampleExclusive48k',span_row.trim_end_sample_exclusive_48k,
          'sourceVoiceoverAssetId',span_row.source_asset_id,
          'sourceVoiceoverSha256',span_row.source_binary_sha256,
          'sourceVoiceoverObjectKey',span_row.source_object_key,
          'sourceVoiceoverContentType',span_row.source_content_type,
          'sourceVoiceoverContentLength',span_row.source_byte_size,
          'selectedStartMs',span_row.selected_start_ms,
          'selectedEndMsExclusive',span_row.selected_end_ms_exclusive,
          'paddedStartMs',span_row.padded_start_ms,
          'paddedEndMsExclusive',span_row.padded_end_ms_exclusive,
          'trimStartMs',span_row.trim_start_ms,'trimEndMsExclusive',span_row.trim_end_ms_exclusive,
          'avatarSourceAssetId',revision.avatar_runtime_source_asset_id,
          'avatarSourceSha256',revision.avatar_runtime_source_binary_sha256,
          'avatarSourceObjectKey',span_row.avatar_object_key,
          'avatarSourceContentType',span_row.avatar_content_type,
          'avatarSourceContentLength',span_row.avatar_byte_size,
          'avatarSourceInputReservationId',avatar_input_id,
          'spanAudioInputReservationId',input_id,
          'inputReservationId',input_id,'outputReservationId',output_id,'outputPrefix',output_prefix);
        soulx_work:=soulx_work||jsonb_build_array(work_item);
      END IF;
      IF role_name='' THEN
        RAISE EXCEPTION 'hosted V2-09 task composition invalid' USING ERRCODE='23514';
      END IF;
      output_reservation:=jsonb_build_object('reservation_id',output_id,'object_prefix',output_prefix);
      item:=jsonb_build_object('item_ordinal',jsonb_array_length(items)+1,'item_id',task_row.id,
        'task_id',task_row.id,'task_key',task_row.task_key,
        'timeline_segment_id',task_row.timeline_segment_id,'input_reservation_id',input_id,
        'output_reservation_id',output_id,'artifact_input',artifact_input,
        'output_reservation',output_reservation);
      items:=items||jsonb_build_array(item);
    END LOOP;
    IF jsonb_array_length(items)<1 THEN
      RAISE EXCEPTION 'hosted V2-09 lane has no durable work' USING ERRCODE='23514';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('item_id',value->>'item_id','task_id',value->>'task_id',
        'task_key',value->>'task_key','timeline_segment_id',value->>'timeline_segment_id') ORDER BY ordinal),
      jsonb_agg(value->'artifact_input' ORDER BY ordinal),
      jsonb_agg(jsonb_build_object('input_reservation_id',value->>'input_reservation_id',
        'output_reservation_id',value->>'output_reservation_id','artifact_input',value->'artifact_input',
        'output_reservation',value->'output_reservation') ORDER BY ordinal)
      INTO item_manifest,input_manifest,reservation_manifest
      FROM jsonb_array_elements(items) WITH ORDINALITY e(value,ordinal);
    SELECT jsonb_agg(reservation_id ORDER BY ordinal,reservation_order) INTO reservation_ids
      FROM jsonb_array_elements(items) WITH ORDINALITY entry(value,ordinal)
      CROSS JOIN LATERAL (VALUES(value->>'input_reservation_id',1),
        (value->>'output_reservation_id',2)) reservation(reservation_id,reservation_order);
    IF lane_name='mage_image' THEN
      SELECT jsonb_agg(value->>'output_reservation_id' ORDER BY ordinal)
        INTO worker_reservation_ids
        FROM jsonb_array_elements(items) WITH ORDINALITY entry(value,ordinal);
    ELSE
      worker_reservation_ids:=jsonb_build_array(avatar_input_id)||
        (SELECT jsonb_agg(value->>'input_reservation_id' ORDER BY ordinal)
          FROM jsonb_array_elements(items) WITH ORDINALITY entry(value,ordinal))||
        (SELECT jsonb_agg(value->>'output_reservation_id' ORDER BY ordinal)
          FROM jsonb_array_elements(items) WITH ORDINALITY entry(value,ordinal));
    END IF;
    items_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(item_manifest),'UTF8')),'hex');
    input_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(input_manifest),'UTF8')),'hex');
    reservation_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(reservation_manifest),'UTF8')),'hex');
    request_body:=jsonb_build_object('schema_version','serverless-v3','lane',lane_name,
      'task_id',dispatch_task_id);
    request_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(request_body),'UTF8')),'hex');
    envelope:=jsonb_build_object('schema','serverless-worker-job-envelope/v3',
      'dispatch_token','db-owned-pending-dispatch-token',
      'tenant',jsonb_build_object('account_id',supplied_account_id,'workspace_id',supplied_workspace_id),
      'work',jsonb_build_object('project_revision_id',revision.id,'generation_request_id',request.id,
        'task_id',dispatch_task_id,'attempt_id',attempt_id,'lane',lane_name,
        'items_manifest_sha256',items_sha,'item_count',jsonb_array_length(items)),
      'runtime',jsonb_build_object('endpoint_profile_id',deployment.endpoint_profile_id,
        'deployment_id',deployment.id,'container_digest',deployment.worker_image_digest,
        'model_manifest_sha256',deployment.model_manifest_sha256,'volume_id_sha256',deployment.volume_id_sha256,
        'volume_mount','/runpod-volume','volume_write_policy','APPLICATION_READ_ONLY',
        'scratch_root_policy','JOB_LOCAL_SCRATCH_OUTSIDE_MODEL_VOLUME',
        'gpu_allowlist',to_jsonb(deployment.gpu_allowlist),'region','EU-RO-1'),
      'artifacts',jsonb_build_object('input_manifest_sha256',input_sha,'output_prefix',output_prefix,
        'plan_manifest_sha256',bridge.generation_plan_sha256,
        'transfer_port_reservation_ids',reservation_ids),
      'limits',jsonb_build_object('expires_at',to_char(expires_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'max_items',jsonb_array_length(items),
        'max_input_bytes',CASE lane_name WHEN 'mage_image' THEN 8388608 ELSE 268435456 END,
        'max_output_bytes',2147483648,'execution_timeout_seconds',deployment.execution_timeout_seconds,
        'init_timeout_seconds',deployment.init_timeout_seconds),
      'policy',jsonb_build_object('model_download_permitted',false,'volume_mutation_permitted',false,
        'pod_lifecycle_permitted',false,'queue_purge_permitted',false));
    envelope_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(envelope),'UTF8')),'hex');
    lane_binding:=jsonb_build_object('lane',lane_name,
      'checkpoint_id',CASE lane_name WHEN 'mage_image' THEN 'V2-07' ELSE 'V2-08' END,
      'operations',jsonb_build_array('serverless_run','serverless_status','serverless_cancel'),
      'resources',jsonb_build_array('endpoint:'||deployment.id::text,
        'gpu:nvidia-geforce-rtx-4090-eu-ro-1','image:'||substring(deployment.worker_image_digest FROM 8),
        'volume:'||substring(deployment.volume_id_sha256 FROM 8)),
      'deployment_id',deployment.id,'endpoint_id_sha256',deployment.endpoint_id_sha256,
      'endpoint_config_sha256',deployment.endpoint_config_sha256,
      'worker_image_digest',deployment.worker_image_digest,
      'model_manifest_sha256',deployment.model_manifest_sha256,
      'volume_id_sha256',deployment.volume_id_sha256,
      'volume_manifest_sha256',deployment.volume_manifest_sha256,
      'deployment_snapshot_sha256',qualification.deployment_snapshot_sha256,
      'qualification_attestation_id',qualification.id,
      'qualification_record_sha256',qualification.qualification_record_sha256);
    lane_bindings:=lane_bindings||jsonb_build_array(lane_binding);
    batch:=jsonb_build_object('schema_version','videoforge-hosted-lane-batch/v1','id',batch_id,
      'dispatch_task_id',dispatch_task_id,'lane',lane_name,
      'batch_ordinal',CASE lane_name WHEN 'mage_image' THEN 1 ELSE 2 END,'attempt_ordinal',1,
      'generation_plan_sha256',bridge.generation_plan_sha256,'deployment_id',deployment.id,
      'deployment_snapshot_sha256',qualification.deployment_snapshot_sha256,'items',items,
      'items_manifest_sha256',items_sha,'input_manifest_sha256',input_sha,
      'reservation_manifest_sha256',reservation_sha,'request_body',request_body,
      'request_body_sha256',request_sha,'envelope',envelope,'envelope_sha256',envelope_sha,
      'worker_transfer_port_reservation_ids',worker_reservation_ids,
      'output_prefix',output_prefix,
      'max_input_bytes',CASE lane_name WHEN 'mage_image' THEN 8388608 ELSE 268435456 END,
      'max_output_bytes',2147483648,'spend_ceiling_usd',1,'reservation_usd',0.744,
      'rate_source','V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR','rate_checked_at',
      to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'authority_expires_at',to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'checkpoint_authority',jsonb_build_object('checkpointId',
        CASE lane_name WHEN 'mage_image' THEN 'V2-07' ELSE 'V2-08' END,
        'authorizedOperations',jsonb_build_array('serverless_run','serverless_status','serverless_cancel'),
        'resources',lane_binding->'resources','capUsd',2,'authorizedAt',
        to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',
        to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'rates',jsonb_build_array(jsonb_build_object('resourceId',
          'gpu:nvidia-geforce-rtx-4090-eu-ro-1','checkedAt',
          to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'usdPerGpuHour',1.116))));
    batches:=batches||jsonb_build_array(batch);
  END LOOP;
  IF expires_at<=db_now+interval '30 minutes' THEN
    RAISE EXCEPTION 'hosted V2-09 authority horizon is too short' USING ERRCODE='23514';
  END IF;
  SELECT replayed INTO materialized_replay FROM public.videoforge_materialize_hosted_lane_batches(
    supplied_account_id,supplied_workspace_id,supplied_project_id,revision.id,request.id,
    bridge.generation_plan_sha256,batches);
  work:=jsonb_build_object('mage_image',mage_work,'soulx_avatar',soulx_work);
  pair:=(SELECT jsonb_agg(jsonb_build_object('lane',b->>'lane','batch_id',b->>'id',
      'task_id',b->>'dispatch_task_id','attempt_id',b#>>'{envelope,work,attempt_id}',
      'deployment_id',b->>'deployment_id','deployment_snapshot_sha256',b->>'deployment_snapshot_sha256',
      'request_body_sha256',b->>'request_body_sha256','items_manifest_sha256',b->>'items_manifest_sha256',
      'input_manifest_sha256',b->>'input_manifest_sha256','output_prefix',b->>'output_prefix',
      'unsigned_envelope',b->'envelope','spend_ceiling_usd',b->'spend_ceiling_usd',
      'reservation_usd',b->'reservation_usd','rate_source',b->>'rate_source',
      'rate_checked_at',b->>'rate_checked_at','qualification_attestation_id',
      binding->>'qualification_attestation_id','qualification_record_sha256',
      binding->>'qualification_record_sha256') ORDER BY ordinal)
    FROM jsonb_array_elements(batches) WITH ORDINALITY e(b,ordinal)
    CROSS JOIN LATERAL (SELECT value binding FROM jsonb_array_elements(lane_bindings) value
      WHERE value->>'lane'=b->>'lane') selected);
  render_plan:=jsonb_build_object('schemaVersion','videoforge-v2-09-ordinary-predispatch-plan/v1',
    'generationPlanSha256',bridge.generation_plan_sha256,'timelinePlanId',plan.id,
    'timelineDocumentSha256',bridge.timeline_document_hash,'totalFrames',plan.total_frames,
    'work',work);
  approval_id:=public.videoforge_hosted_v209_uuid('approval',request.id,'pair');
  approval_base:=jsonb_build_object('schemaVersion','videoforge.hosted-v209-paid-approval/v1',
    'accountId',supplied_account_id,'workspaceId',supplied_workspace_id,'projectId',supplied_project_id,
    'projectRevisionId',revision.id,'generationRequestId',request.id,
    'generationPlanSha256',bridge.generation_plan_sha256,'leaseId',lease.id,
    'laneBindings',lane_bindings,'totalCapUsd',2,'expiresAt',
    to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  approval_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(approval_base),'UTF8')),'hex');
  INSERT INTO public.hosted_paid_dispatch_approvals(id,approval_sha256,account_id,workspace_id,
    project_id,project_revision_id,generation_request_id,generation_plan_sha256,lease_id,lane_bindings,
    maximum_cumulative_finite_cap_usd,expires_at,approved_by_operator,approved_at,created_at)
  VALUES(approval_id,approval_sha,supplied_account_id,supplied_workspace_id,supplied_project_id,
    revision.id,request.id,bridge.generation_plan_sha256,lease.id,lane_bindings,2,expires_at,
    'DB_OWNED_V2_09_ORDINARY_GATE',db_now,db_now);
  candidate_base:=jsonb_build_object('schemaVersion','videoforge.hosted-v209-ordinary-dispatch/v1',
    'accountId',supplied_account_id,'workspaceId',supplied_workspace_id,'projectId',supplied_project_id,
    'projectRevisionId',revision.id,'generationRequestId',request.id,
    'generationPlanSha256',bridge.generation_plan_sha256,'leaseId',lease.id,
    'approvalId',approval_id,'approvalSha256',approval_sha,'totalCapUsd',2,
    'avatarSourceInputReservationId',avatar_input_id,
    'expiresAt',to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'laneBindings',lane_bindings,'pair',pair,'batches',batches,'renderPlan',render_plan,
    'work',work,'workManifestSha256','sha256:'||encode(sha256(convert_to(
      public.videoforge_canonical_jsonb(work),'UTF8')),'hex'));
  candidate_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(candidate_base),'UTF8')),'hex');
  INSERT INTO public.hosted_v209_ordinary_dispatch_candidates(generation_request_id,account_id,
    workspace_id,project_id,project_revision_id,lease_id,generation_plan_sha256,work_manifest_sha256,
    candidate_sha256,approval_id,candidate_document,expires_at,created_at)
  VALUES(request.id,supplied_account_id,supplied_workspace_id,supplied_project_id,revision.id,lease.id,
    bridge.generation_plan_sha256,candidate_base->>'workManifestSha256',candidate_sha,approval_id,
    candidate_base,expires_at,db_now);
  RETURN candidate_base||jsonb_build_object('candidateSha256',candidate_sha,'replayed',materialized_replay,
    'pairExists',false,'existingWorkflowId',NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_materialize_hosted_v209_ordinary_dispatch(uuid,uuid,uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.videoforge_materialize_hosted_v209_span_audio_jobs(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid,
  supplied_project_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  request public.generation_requests%ROWTYPE; revision public.project_revisions%ROWTYPE;
  head public.revision_timing_heads%ROWTYPE;
  span_row record; stored public.hosted_v209_span_audio_materializations%ROWTYPE;
  attempt_id uuid; output_asset_id uuid; input_document jsonb; submission jsonb;
  input_sha text; submission_sha text; source_uri text; extension text; jobs jsonb:='[]'::jsonb;
  effective_selected_start bigint; effective_selected_end bigint;
  effective_padded_start bigint; effective_padded_end bigint;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.account_id=supplied_account_id
       AND m.workspace_id=supplied_workspace_id AND m.user_id=supplied_user_id AND m.status='ACTIVE') THEN
    RAISE EXCEPTION 'hosted V2-09 span audio scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT generation.* INTO request FROM public.generation_requests generation
    JOIN public.projects p ON p.account_id=generation.account_id AND p.workspace_id=generation.workspace_id
      AND p.id=generation.project_id AND p.status='ACTIVE'
    WHERE generation.account_id=supplied_account_id AND generation.workspace_id=supplied_workspace_id
      AND generation.project_id=supplied_project_id AND generation.created_by_user_id=supplied_user_id
      AND generation.state='ACTIVE' AND generation.terminal_at IS NULL
    ORDER BY generation.created_at DESC,generation.id DESC LIMIT 1 FOR UPDATE OF generation;
  SELECT r.* INTO revision FROM public.project_revisions r
    WHERE r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id
      AND r.project_id=supplied_project_id AND r.id=request.project_revision_id AND r.status='LOCKED' FOR SHARE;
  IF revision.id IS NULL THEN
    RAISE EXCEPTION 'hosted V2-09 locked revision unavailable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO head FROM public.revision_timing_heads h
    WHERE h.account_id=supplied_account_id AND h.workspace_id=supplied_workspace_id
      AND h.project_revision_id=revision.id AND h.current_timeline_plan_id IS NOT NULL FOR SHARE;
  IF head.project_revision_id IS NULL THEN
    RAISE EXCEPTION 'hosted V2-09 timing head unavailable' USING ERRCODE='23514';
  END IF;
  FOR span_row IN
    SELECT s.*,segment.start_frame,segment.end_frame_exclusive,source.duration_ms source_duration_ms,
      source.object_key source_object_key,source.content_type source_content_type,
      source.byte_size source_byte_size,receipt.id source_receipt_id,
      task.id task_id
    FROM public.selected_span_audio s
    JOIN public.timeline_segments segment ON segment.account_id=s.account_id
      AND segment.workspace_id=s.workspace_id AND segment.id=s.timeline_segment_id
      AND segment.project_revision_id=s.project_revision_id
      AND segment.timeline_plan_id=head.current_timeline_plan_id
    JOIN public.assets source ON source.account_id=s.account_id AND source.workspace_id=s.workspace_id
      AND source.id=s.source_asset_id AND source.kind='VOICEOVER' AND source.state IN ('VERIFIED','ACCEPTED')
      AND source.binary_sha256=s.source_binary_sha256 AND source.object_key IS NOT NULL
      AND source.byte_size>0 AND source.duration_ms>=10000
    JOIN public.artifact_reservations reservation ON reservation.account_id=s.account_id
      AND reservation.workspace_id=s.workspace_id AND reservation.asset_id=source.id
      AND reservation.object_key=source.object_key AND reservation.method='PUT' AND reservation.state='COMMITTED'
      AND reservation.checksum_sha256=source.binary_sha256 AND reservation.content_length=source.byte_size
      AND reservation.content_type=source.content_type
    JOIN public.artifact_receipts receipt ON receipt.account_id=reservation.account_id
      AND receipt.workspace_id=reservation.workspace_id AND receipt.reservation_id=reservation.id
      AND receipt.deleted_at IS NULL AND receipt.object_key=source.object_key
      AND receipt.checksum_sha256=source.binary_sha256 AND receipt.content_length=source.byte_size
      AND receipt.content_type=source.content_type
    JOIN public.generation_tasks task ON task.account_id=s.account_id AND task.workspace_id=s.workspace_id
      AND task.project_revision_id=s.project_revision_id
      AND task.task_key=segment.required_slots->'avatar'->>'task_key'
      AND task.lane='AVATAR' AND task.state='BLOCKED'
    WHERE s.account_id=supplied_account_id AND s.workspace_id=supplied_workspace_id
      AND s.project_revision_id=revision.id AND s.timeline_plan_id=head.current_timeline_plan_id
      AND s.transcript_id=head.current_transcript_id
      AND segment.timeline_composition IN ('AVATAR_FULL','AVATAR_SPLIT_IMAGE')
      AND jsonb_typeof(segment.required_slots->'avatar')='object'
      AND nullif(segment.required_slots->'avatar'->>'task_key','') IS NOT NULL
      AND nullif(segment.required_slots->'avatar'->>'span_audio_task_key','') IS NOT NULL
      AND s.task_key=segment.required_slots->'avatar'->>'span_audio_task_key'
      AND s.state='PLANNED'
    ORDER BY s.task_key COLLATE "C"
  LOOP
    -- The immutable timing plan is 30 fps, while the qualified SoulX input cadence is 25 fps.
    -- Snap the canonical source-audio selection outward to the 40 ms SoulX grid; never derive
    -- source positions from absolute timeline frame numbers.
    effective_selected_start:=(span_row.selected_start_ms/40)*40;
    effective_selected_end:=((span_row.selected_end_ms_exclusive+39)/40)*40;
    effective_padded_start:=(span_row.padded_start_ms/40)*40;
    effective_padded_end:=((span_row.padded_end_ms_exclusive+39)/40)*40;
    IF effective_selected_end-effective_selected_start NOT BETWEEN 2000 AND 10000
       OR effective_padded_start>effective_selected_start
       OR effective_padded_end<effective_selected_end
       OR effective_padded_end>span_row.source_duration_ms+20
       OR (effective_padded_end-effective_padded_start)*48 NOT BETWEEN 144000 AND 485760 THEN
      RAISE EXCEPTION 'hosted V2-09 span cadence or bounds invalid' USING ERRCODE='23514';
    END IF;
    attempt_id:=public.videoforge_hosted_v209_span_uuid('attempt',span_row.id,'personal-worker');
    output_asset_id:=public.videoforge_hosted_v209_span_uuid('output-asset',span_row.id,attempt_id::text);
    extension:=CASE span_row.source_content_type WHEN 'audio/wav' THEN 'wav'
      WHEN 'audio/flac' THEN 'flac' WHEN 'audio/mpeg' THEN 'mp3' WHEN 'audio/mp4' THEN 'm4a'
      ELSE NULL END;
    IF extension IS NULL THEN
      RAISE EXCEPTION 'hosted V2-09 source audio content type invalid' USING ERRCODE='23514';
    END IF;
    source_uri:='vf-local://objects/sha256/'||substring(span_row.source_binary_sha256 FROM 8 FOR 2)||'/'||
      substring(span_row.source_binary_sha256 FROM 8)||'.'||extension;
    input_document:=jsonb_build_object('schema_version','selected-span-audio-job/v1',
      'project_revision_id',revision.id,'attempt_id',attempt_id,'timeline_plan_id',head.current_timeline_plan_id,
      'transcript_id',head.current_transcript_id,'span_id',span_row.id,
      'timeline_segment_id',span_row.timeline_segment_id,'task_key',span_row.task_key,
      'source_voiceover',jsonb_build_object('asset_id',span_row.source_asset_id,
        'sha256',span_row.source_binary_sha256,'artifact_uri',source_uri,'duration_ms',span_row.source_duration_ms),
      'selection',jsonb_build_object('selected_start_ms',effective_selected_start,
        'selected_end_ms_exclusive',effective_selected_end,'padded_start_ms',effective_padded_start,
        'padded_end_ms_exclusive',effective_padded_end,
        'trim_start_ms',effective_selected_start-effective_padded_start,
        'trim_end_ms_exclusive',effective_selected_end-effective_padded_start),
      'output',jsonb_build_object('asset_id',output_asset_id,'result_uri',
        'vf-local-run://'||revision.id::text||'/'||attempt_id::text||'/span-audio-result.json'),
      'cancel_token','span-cancel-'||substring(encode(sha256(convert_to(attempt_id::text,'UTF8')),'hex'),1,48),
      'output_profile','SOULX_PCM16_48K_MONO');
    input_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(input_document),'UTF8')),'hex');
    submission:=jsonb_build_object('schema_version','videoforge-hosted-cpu-submission/v1',
      'idempotency_key','span-audio:'||substring(input_sha FROM 8),'project_id',supplied_project_id,
      'project_revision_id',revision.id,'kind','SPAN_AUDIO','input_document',input_document,
      'objects',jsonb_build_array(jsonb_build_object('artifact_receipt_id',span_row.source_receipt_id,'uri',source_uri)));
    submission_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(submission),'UTF8')),'hex');
    SELECT * INTO stored FROM public.hosted_v209_span_audio_materializations m WHERE m.span_id=span_row.id;
    IF stored.span_id IS NULL THEN
      INSERT INTO public.hosted_v209_span_audio_materializations(span_id,account_id,workspace_id,project_id,
        project_revision_id,generation_request_id,user_id,timeline_plan_id,transcript_id,timeline_segment_id,task_id,attempt_id,
        source_asset_id,source_receipt_id,output_asset_id,input_document,input_document_sha256,
        submission_document,submission_sha256)
      VALUES(span_row.id,supplied_account_id,supplied_workspace_id,supplied_project_id,revision.id,request.id,supplied_user_id,
        head.current_timeline_plan_id,head.current_transcript_id,span_row.timeline_segment_id,span_row.task_id,
        attempt_id,span_row.source_asset_id,span_row.source_receipt_id,output_asset_id,input_document,input_sha,
        submission,submission_sha);
    ELSIF stored.input_document IS DISTINCT FROM input_document
       OR stored.submission_document IS DISTINCT FROM submission THEN
      RAISE EXCEPTION 'hosted V2-09 span audio replay drift' USING ERRCODE='23505';
    END IF;
    jobs:=jobs||jsonb_build_array(jsonb_build_object('spanId',span_row.id,'taskId',span_row.task_id,
      'taskKey',span_row.task_key,
      'attemptId',attempt_id,'idempotencyKey','span-audio:'||substring(input_sha FROM 8),
      'inputDocument',input_document,'submissionDocument',submission,'submissionSha256',submission_sha,
      'objects',submission->'objects','state','PLANNED'));
  END LOOP;
  IF jsonb_array_length(jobs)=0 AND EXISTS(SELECT 1 FROM public.selected_span_audio s
    WHERE s.account_id=supplied_account_id AND s.workspace_id=supplied_workspace_id
      AND s.project_revision_id=revision.id AND s.timeline_plan_id=head.current_timeline_plan_id
      AND s.state='PLANNED') THEN
    RAISE EXCEPTION 'hosted V2-09 planned span inputs are incomplete' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('schemaVersion','videoforge.hosted-v209-span-audio-jobs/v1',
    'accountId',supplied_account_id,'workspaceId',supplied_workspace_id,'projectId',supplied_project_id,
    'projectRevisionId',revision.id,'jobs',jobs);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_materialize_hosted_v209_span_audio_jobs(uuid,uuid,uuid,uuid) FROM PUBLIC;
