-- Carry accepted Fal audio padding into rendering; historical GPU reader unchanged.
CREATE OR REPLACE FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  request public.generation_requests%ROWTYPE;
  revision public.project_revisions%ROWTYPE;
  bridge public.hosted_canonical_timing_bridges%ROWTYPE;
  voiceover jsonb; visuals jsonb;
  expected_count integer; job_count integer;
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
  SELECT jsonb_agg(jsonb_build_object('taskId',job.generation_task_id,
      'taskKey',job.task_key,'acceptedAttemptId',job.id,'assetId',asset.id,
      'sha256',receipt.checksum_sha256,'objectKey',receipt.object_key,
      'contentType',receipt.content_type,'contentLength',receipt.content_length,
      'receiptId',receipt.id,'lane',CASE job.lane WHEN 'IMAGE' THEN 'mage_image'
        ELSE 'soulx_avatar' END,'rendererSourceProfile',CASE job.lane WHEN 'AVATAR'
        THEN 'fal-flashhead-512x512p25-v1' ELSE NULL END,
      'avatarTrimStartMs',job.input_manifest->'trimStartMs',
      'avatarSelectedStartMs',job.input_manifest->'selectedStartMs')
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
  IF voiceover IS NULL OR visuals IS NULL OR jsonb_array_length(visuals)<>expected_count THEN
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
      'reservationId',manifest_reservation_id,'objectKey',object_key));
END;
$$;
