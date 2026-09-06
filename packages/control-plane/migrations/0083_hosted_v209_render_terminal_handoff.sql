-- V2-09 tenant-private CPU render terminal handoff.
-- The reconciler receives two narrow SECURITY DEFINER capabilities and no table DML. The read
-- capability exposes only one exact owned RENDER attempt. The finalizer atomically commits/replays
-- its FINAL receipt, RENDERING -> COMPLETE event, and ACTIVE -> SUCCEEDED request after the GPU
-- pair has already released its sole provider lease. Neither function can dispatch or promote.

CREATE FUNCTION public.videoforge_read_v209_render_terminal_candidate(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_attempt_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
DECLARE candidate jsonb;
BEGIN
  IF supplied_account_id IS NULL OR supplied_workspace_id IS NULL OR supplied_attempt_id IS NULL THEN
    RAISE EXCEPTION 'V2-09 render terminal identity invalid' USING ERRCODE='23514';
  END IF;
  PERFORM set_config('videoforge.account_id',supplied_account_id::text,true);
  SELECT jsonb_build_object(
    'schemaVersion','videoforge.v2-09-render-terminal-candidate/v1',
    'accountId',attempt.account_id,'workspaceId',attempt.workspace_id,
    'attemptId',attempt.id,'attemptState',attempt.state,
    'attemptRequestSha256',attempt.request_sha256,
    'resultObjectKey',attempt.result_object_key,
    'resultContentLength',attempt.result_content_length,
    'resultChecksumSha256',attempt.result_checksum_sha256,
    'resultReceiptSha256',attempt.result_receipt_sha256,
    'projectId',attempt.project_id,'projectRevisionId',attempt.project_revision_id,
    'planPayload',plan.payload,'planPayloadSha256',plan.payload_sha256,
    'primaryObjectKey',primary_output.object_key,
    'primaryContentType',primary_output.content_type,
    'primaryContentLength',primary_output.issued_content_length,
    'primaryChecksumSha256',primary_output.issued_checksum_sha256,
    'resultAuthorityObjectKey',result_output.object_key,
    'resultAuthorityContentType',result_output.content_type,
    'resultAuthorityContentLength',result_output.issued_content_length,
    'resultAuthorityChecksumSha256',result_output.issued_checksum_sha256,
    'runtimeId',runtime.id,'runtimeStage',runtime.stage,
    'renderManifestSha256',runtime.render_manifest_sha256,
    'finalOutputSha256',runtime.final_output_sha256,
    'generationRequestId',runtime.generation_request_id,
    'generationRequestState',request.state,
    'leaseId',lease.id,'leaseState',lease.state,'leaseVersion',lease.version,
    'leaseReleaseReason',lease.release_reason,
    'renderAttemptCount',(SELECT count(*) FROM public.hosted_cpu_job_attempts row
      WHERE row.account_id=attempt.account_id AND row.workspace_id=attempt.workspace_id
        AND row.project_id=attempt.project_id AND row.project_revision_id=attempt.project_revision_id
        AND row.kind='RENDER'),
    'runtimeCount',(SELECT count(*) FROM public.video_runtime_states row
      WHERE row.account_id=attempt.account_id AND row.workspace_id=attempt.workspace_id
        AND row.project_id=attempt.project_id AND row.project_revision_id=attempt.project_revision_id),
    'leaseCount',(SELECT count(*) FROM public.provider_workload_leases row
      WHERE row.account_id=runtime.account_id AND row.workspace_id=runtime.workspace_id
        AND row.generation_request_id=runtime.generation_request_id),
    'finalEventCount',(SELECT count(*) FROM public.video_runtime_events event
      WHERE event.account_id=runtime.account_id AND event.workspace_id=runtime.workspace_id
        AND event.runtime_id=runtime.id AND event.reason='FINAL_OUTPUT_DURABLE'
        AND event.to_state='COMPLETE'),
    'finalReceiptSha256',(SELECT min(event.detail->>'final_output_receipt_sha256')
      FROM public.video_runtime_events event
      WHERE event.account_id=runtime.account_id AND event.workspace_id=runtime.workspace_id
        AND event.runtime_id=runtime.id AND event.reason='FINAL_OUTPUT_DURABLE'
        AND event.to_state='COMPLETE'),
    'finalArtifact',CASE WHEN runtime.stage='COMPLETE' THEN jsonb_build_object(
      'assetId',final_receipt.probe->>'output_asset_id','objectKey',final_receipt.object_key,
      'contentType',final_receipt.content_type,'contentLength',final_receipt.content_length,
      'checksumSha256',final_receipt.checksum_sha256,
      'resultDocumentSha256',final_receipt.probe->>'render_result_sha256',
      'probe',final_receipt.probe->'technical_probe') ELSE NULL END,
    'databaseNow',to_char(transaction_timestamp() AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    INTO candidate
    FROM public.hosted_cpu_job_attempts attempt
    JOIN public.hosted_render_plans plan ON plan.account_id=attempt.account_id
      AND plan.workspace_id=attempt.workspace_id AND plan.project_id=attempt.project_id
      AND plan.project_revision_id=attempt.project_revision_id
    JOIN public.hosted_cpu_upload_authorities primary_output
      ON primary_output.account_id=attempt.account_id
      AND primary_output.workspace_id=attempt.workspace_id AND primary_output.attempt_id=attempt.id
      AND primary_output.source='PRIMARY_RESULT_OUTPUT' AND primary_output.issued_at IS NOT NULL
    JOIN public.hosted_cpu_upload_authorities result_output
      ON result_output.account_id=attempt.account_id
      AND result_output.workspace_id=attempt.workspace_id AND result_output.attempt_id=attempt.id
      AND result_output.source='RESULT_DOCUMENT' AND result_output.issued_at IS NOT NULL
    JOIN public.video_runtime_states runtime ON runtime.account_id=attempt.account_id
      AND runtime.workspace_id=attempt.workspace_id AND runtime.project_id=attempt.project_id
      AND runtime.project_revision_id=attempt.project_revision_id
    JOIN public.generation_requests request ON request.account_id=runtime.account_id
      AND request.workspace_id=runtime.workspace_id AND request.id=runtime.generation_request_id
    JOIN public.provider_workload_leases lease ON lease.account_id=request.account_id
      AND lease.workspace_id=request.workspace_id AND lease.generation_request_id=request.id
    LEFT JOIN public.artifact_reservations final_reservation
      ON final_reservation.id=md5('v209-final-reservation:'||attempt.id::text)::uuid
      AND final_reservation.account_id=attempt.account_id
      AND final_reservation.workspace_id=attempt.workspace_id
    LEFT JOIN public.artifact_receipts final_receipt
      ON final_receipt.id=md5('v209-final-receipt:'||attempt.id::text)::uuid
      AND final_receipt.account_id=attempt.account_id
      AND final_receipt.workspace_id=attempt.workspace_id
      AND final_receipt.reservation_id=final_reservation.id
   WHERE attempt.account_id=supplied_account_id AND attempt.workspace_id=supplied_workspace_id
     AND attempt.id=supplied_attempt_id AND attempt.kind='RENDER';
  RETURN candidate;
END;
$$;

CREATE FUNCTION public.videoforge_finalize_v209_render_terminal(supplied jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
#variable_conflict use_variable
DECLARE
  account_id uuid; workspace_id uuid; attempt_id uuid; output jsonb; probe jsonb;
  attempt public.hosted_cpu_job_attempts%ROWTYPE; plan public.hosted_render_plans%ROWTYPE;
  runtime public.video_runtime_states%ROWTYPE; request public.generation_requests%ROWTYPE;
  lease public.provider_workload_leases%ROWTYPE;
  primary_output public.hosted_cpu_upload_authorities%ROWTYPE;
  result_output public.hosted_cpu_upload_authorities%ROWTYPE;
  reservation public.artifact_reservations%ROWTYPE; receipt public.artifact_receipts%ROWTYPE;
  capacity public.global_generation_capacity%ROWTYPE;
  queue_audit public.generation_queue_audits%ROWTYPE;
  reservation_id uuid; receipt_id uuid; event_id uuid; receipt_sha text; receipt_facts jsonb;
  queue_audit_id uuid; queue_audit_detail jsonb; request_version_before integer;
  db_now timestamptz:=transaction_timestamp(); initial_path boolean:=false;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)<>
        ARRAY['accountId','attemptId','finalOutput','schemaVersion','workspaceId']::text[]
     OR supplied->>'schemaVersion'<>'videoforge.v2-09-render-terminal-finalize/v1'
     OR jsonb_typeof(supplied->'finalOutput')<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied->'finalOutput') key)<>
        ARRAY['assetId','checksumSha256','contentLength','contentType','objectKey','probe',
          'renderManifestSha256','resultDocumentSha256']::text[] THEN
    RAISE EXCEPTION 'V2-09 render terminal request invalid' USING ERRCODE='23514';
  END IF;
  account_id:=(supplied->>'accountId')::uuid;
  workspace_id:=(supplied->>'workspaceId')::uuid;
  attempt_id:=(supplied->>'attemptId')::uuid;
  output:=supplied->'finalOutput'; probe:=output->'probe';
  IF output->>'contentType'<>'video/mp4'
     OR output->>'assetId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
     OR output->>'checksumSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR output->>'resultDocumentSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR output->>'renderManifestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(output->'contentLength')<>'number'
     OR (output->>'contentLength')::numeric<>trunc((output->>'contentLength')::numeric)
     OR (output->>'contentLength')::numeric<1
     OR (output->>'contentLength')::numeric>9223372036854775807
     OR jsonb_typeof(probe)<>'object'
     OR probe->>'schema_version'<>'technical-probe/v1'
     OR probe->>'asset_id'<>output->>'assetId'
     OR probe->>'sha256'<>output->>'checksumSha256'
     OR jsonb_typeof(probe->'bytes')<>'number'
     OR (probe->>'bytes')::numeric<>trunc((probe->>'bytes')::numeric)
     OR (probe->>'bytes')::numeric<1
     OR (probe->>'bytes')::bigint<>(output->>'contentLength')::bigint
     OR jsonb_typeof(probe->'duration_ms')<>'number'
     OR (probe->>'duration_ms')::numeric<>trunc((probe->>'duration_ms')::numeric)
     OR (probe->>'duration_ms')::bigint<1
     OR jsonb_typeof(probe->'total_frames')<>'number'
     OR (probe->>'total_frames')::numeric<>trunc((probe->>'total_frames')::numeric)
     OR (probe->>'total_frames')::bigint<1
     OR probe->>'container'<>'mp4' OR probe->>'decode_ok'<>'true'
     OR jsonb_typeof(probe->'decode_ok')<>'boolean'
     OR probe#>>'{video,codec}'<>'h264' OR probe#>>'{video,pixel_format}'<>'yuv420p'
     OR probe#>>'{video,width}'<>'1920' OR probe#>>'{video,height}'<>'1080'
     OR probe#>>'{video,fps_num}'<>'30' OR probe#>>'{video,fps_den}'<>'1'
     OR probe#>>'{audio,codec}'<>'aac' OR probe#>>'{audio,sample_rate_hz}'<>'48000'
     OR probe#>>'{stream_counts,video}'<>'1' OR probe#>>'{stream_counts,audio}'<>'1'
     OR probe#>>'{stream_counts,subtitle}'<>'0' OR probe#>>'{stream_counts,data}'<>'0' THEN
    RAISE EXCEPTION 'V2-09 render terminal output invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(account_id::text||':'||attempt_id::text,20983));
  PERFORM set_config('videoforge.account_id',account_id::text,true);
  SELECT * INTO attempt FROM public.hosted_cpu_job_attempts row
   WHERE row.account_id=account_id AND row.workspace_id=workspace_id AND row.id=attempt_id
     AND row.kind='RENDER' FOR UPDATE;
  SELECT * INTO plan FROM public.hosted_render_plans row
   WHERE row.account_id=account_id AND row.workspace_id=workspace_id
     AND row.project_id=attempt.project_id AND row.project_revision_id=attempt.project_revision_id
   FOR UPDATE;
  SELECT * INTO runtime FROM public.video_runtime_states row
   WHERE row.account_id=account_id AND row.workspace_id=workspace_id
     AND row.project_id=attempt.project_id AND row.project_revision_id=attempt.project_revision_id
   FOR UPDATE;
  SELECT * INTO request FROM public.generation_requests row
   WHERE row.account_id=account_id AND row.workspace_id=workspace_id
     AND row.id=runtime.generation_request_id FOR UPDATE;
  SELECT * INTO lease FROM public.provider_workload_leases row
   WHERE row.account_id=account_id AND row.workspace_id=workspace_id
     AND row.generation_request_id=request.id FOR UPDATE;
  SELECT * INTO primary_output FROM public.hosted_cpu_upload_authorities row
   WHERE row.account_id=account_id AND row.workspace_id=workspace_id
     AND row.attempt_id=attempt_id AND row.source='PRIMARY_RESULT_OUTPUT' FOR UPDATE;
  SELECT * INTO result_output FROM public.hosted_cpu_upload_authorities row
   WHERE row.account_id=account_id AND row.workspace_id=workspace_id
     AND row.attempt_id=attempt_id AND row.source='RESULT_DOCUMENT' FOR UPDATE;
  IF attempt.id IS NULL OR attempt.state<>'SUCCEEDED'
     OR attempt.result_content_type<>'application/json'
     OR attempt.result_object_key<>result_output.object_key
     OR attempt.result_content_length<>result_output.issued_content_length
     OR attempt.result_checksum_sha256<>result_output.issued_checksum_sha256
     OR attempt.result_checksum_sha256<>output->>'resultDocumentSha256'
     OR attempt.result_receipt_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR primary_output.issued_at IS NULL OR result_output.issued_at IS NULL
     OR primary_output.object_key<>output->>'objectKey'
     OR primary_output.content_type<>'video/mp4'
     OR primary_output.issued_content_length<>(output->>'contentLength')::bigint
     OR primary_output.issued_checksum_sha256<>output->>'checksumSha256'
     OR plan.payload_sha256<>attempt.request_sha256
     OR plan.payload_sha256<>'sha256:'||encode(sha256(convert_to(
       public.videoforge_canonical_jsonb(plan.payload),'UTF8')),'hex')
     OR plan.payload->>'schema_version'<>'videoforge-hosted-cpu-submission/v1'
     OR plan.payload->>'kind'<>'RENDER'
     OR plan.payload->>'project_id'<>attempt.project_id::text
     OR plan.payload->>'project_revision_id'<>attempt.project_revision_id::text
     OR plan.payload#>>'{input_document,schema_version}'<>'render-job-input/v1'
     OR plan.payload#>>'{input_document,project_revision_id}'<>attempt.project_revision_id::text
     OR plan.payload#>>'{input_document,resolved_render_manifest,sha256}'<>
        output->>'renderManifestSha256'
     OR runtime.render_manifest_sha256<>output->>'renderManifestSha256'
     OR (SELECT count(*) FROM public.hosted_cpu_job_attempts row
       WHERE row.account_id=account_id AND row.workspace_id=workspace_id
         AND row.project_id=attempt.project_id AND row.project_revision_id=attempt.project_revision_id
         AND row.kind='RENDER')<>1
     OR (SELECT count(*) FROM public.video_runtime_states row
       WHERE row.account_id=account_id AND row.workspace_id=workspace_id
         AND row.project_id=attempt.project_id AND row.project_revision_id=attempt.project_revision_id)<>1
     OR lease.id IS NULL OR lease.request_kind<>'VIDEO' OR lease.state<>'RELEASED'
     OR lease.released_at IS NULL
     OR lease.release_reason<>'HOSTED_PAIR_OUTPUTS_ACCEPTED'
     OR (SELECT count(*) FROM public.provider_workload_leases row
       WHERE row.account_id=account_id AND row.workspace_id=workspace_id
         AND row.generation_request_id=request.id)<>1 THEN
    RAISE EXCEPTION 'V2-09 render terminal lineage invalid' USING ERRCODE='42501';
  END IF;
  reservation_id:=md5('v209-final-reservation:'||attempt.id::text)::uuid;
  receipt_id:=md5('v209-final-receipt:'||attempt.id::text)::uuid;
  event_id:=md5('v209-final-event:'||attempt.id::text)::uuid;
  receipt_facts:=jsonb_build_object(
    'accountId',account_id,'workspaceId',workspace_id,'projectId',attempt.project_id,
    'projectRevisionId',attempt.project_revision_id,'renderAttemptId',attempt.id,
    'renderManifestSha256',output->>'renderManifestSha256',
    'resultDocumentSha256',output->>'resultDocumentSha256','objectKey',output->>'objectKey',
    'outputAssetId',output->>'assetId','outputBytes',(output->>'contentLength')::bigint,
    'outputSha256',output->>'checksumSha256','probe',probe);
  receipt_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(receipt_facts),'UTF8')),'hex');
  initial_path:=runtime.stage='RENDERING' AND request.state='ACTIVE';
  IF NOT (
       (initial_path AND runtime.final_output_sha256 IS NULL AND runtime.terminal_reason IS NULL
         AND runtime.terminal_at IS NULL
         AND (SELECT count(*) FROM public.video_runtime_events event
           WHERE event.runtime_id=runtime.id AND event.reason='FINAL_OUTPUT_DURABLE')=0)
       OR
       (runtime.stage='COMPLETE' AND runtime.terminal_reason='SUCCEEDED'
         AND runtime.terminal_at IS NOT NULL
         AND runtime.final_output_sha256=output->>'checksumSha256'
         AND request.state IN ('ACTIVE','SUCCEEDED'))
     ) THEN
    RAISE EXCEPTION 'V2-09 render terminal state invalid' USING ERRCODE='55000';
  END IF;
  IF initial_path THEN
    INSERT INTO public.artifact_reservations (
      id,account_id,workspace_id,project_id,project_revision_id,lane,job_id,artifact_id,
      object_key,method,content_type,content_length,checksum_sha256,expires_at,max_uses,used_count,
      state,retention_class,deletion_owner_account_id,created_at,updated_at
    ) VALUES (reservation_id,account_id,workspace_id,attempt.project_id,attempt.project_revision_id,
      'RENDER',attempt.id::text,regexp_replace(output->>'objectKey','^.*/artifact/',''),
      output->>'objectKey','PUT','video/mp4',
      (output->>'contentLength')::bigint,output->>'checksumSha256',db_now+interval '1 hour',1,1,
      'COMMITTED','FINAL',account_id,db_now,db_now) ON CONFLICT(id) DO NOTHING;
    INSERT INTO public.artifact_receipts (
      id,account_id,workspace_id,reservation_id,callback_id,object_key,content_type,content_length,
      checksum_sha256,probe,receipt_sha256,committed_at
    ) VALUES (receipt_id,account_id,workspace_id,reservation_id,attempt.id::text,
      output->>'objectKey','video/mp4',(output->>'contentLength')::bigint,
      output->>'checksumSha256',jsonb_build_object(
        'render_manifest_sha256',output->>'renderManifestSha256',
        'render_result_sha256',output->>'resultDocumentSha256','technical_probe',probe,
        'output_asset_id',output->>'assetId',
        'width',1920,'height',1080,'video_codec','h264','audio_codec','aac',
        'duration_ms',(probe->>'duration_ms')::bigint,'total_frames',(probe->>'total_frames')::bigint,
        'renderer','ffmpeg-render-v3'),receipt_sha,db_now) ON CONFLICT(id) DO NOTHING;
  END IF;
  SELECT * INTO reservation FROM public.artifact_reservations row WHERE row.id=reservation_id;
  SELECT * INTO receipt FROM public.artifact_receipts row WHERE row.id=receipt_id;
  IF reservation.id IS NULL OR receipt.id IS NULL OR reservation.account_id<>account_id
     OR reservation.workspace_id<>workspace_id OR reservation.project_id<>attempt.project_id
     OR reservation.project_revision_id<>attempt.project_revision_id OR reservation.lane<>'RENDER'
     OR reservation.job_id<>attempt.id::text
     OR reservation.artifact_id<>regexp_replace(output->>'objectKey','^.*/artifact/','')
     OR reservation.object_key<>output->>'objectKey' OR reservation.content_type<>'video/mp4'
     OR reservation.content_length<>(output->>'contentLength')::bigint
     OR reservation.checksum_sha256<>output->>'checksumSha256'
     OR reservation.state<>'COMMITTED' OR reservation.retention_class<>'FINAL'
     OR receipt.reservation_id<>reservation.id OR receipt.deleted_at IS NOT NULL
     OR receipt.object_key<>output->>'objectKey' OR receipt.content_type<>'video/mp4'
     OR receipt.content_length<>(output->>'contentLength')::bigint
     OR receipt.checksum_sha256<>output->>'checksumSha256'
     OR receipt.receipt_sha256<>receipt_sha
     OR receipt.probe->>'render_manifest_sha256'<>output->>'renderManifestSha256'
     OR receipt.probe->>'render_result_sha256'<>output->>'resultDocumentSha256'
     OR receipt.probe->>'output_asset_id'<>output->>'assetId'
     OR receipt.probe->'technical_probe'<>probe THEN
    RAISE EXCEPTION 'V2-09 FINAL receipt replay drifted' USING ERRCODE='23514';
  END IF;
  IF initial_path THEN
    UPDATE public.video_runtime_states SET stage='COMPLETE',final_output_sha256=output->>'checksumSha256',
      terminal_reason='SUCCEEDED',terminal_at=db_now,version=version+1,updated_at=db_now
      WHERE id=runtime.id AND stage='RENDERING';
    INSERT INTO public.video_runtime_events (
      id,account_id,workspace_id,runtime_id,project_revision_id,lane,from_state,to_state,reason,
      detail,occurred_at
    ) VALUES (event_id,account_id,workspace_id,runtime.id,runtime.project_revision_id,NULL,
      'RENDERING','COMPLETE','FINAL_OUTPUT_DURABLE',jsonb_build_object(
        'final_output_sha256',output->>'checksumSha256',
        'final_output_receipt_sha256',receipt_sha),db_now) ON CONFLICT(id) DO NOTHING;
    SELECT * INTO runtime FROM public.video_runtime_states row WHERE row.id=runtime.id FOR UPDATE;
  END IF;
  IF runtime.stage<>'COMPLETE' OR runtime.terminal_reason<>'SUCCEEDED'
     OR runtime.final_output_sha256<>output->>'checksumSha256'
     OR (SELECT count(*) FROM public.video_runtime_events event WHERE event.runtime_id=runtime.id
       AND event.reason='FINAL_OUTPUT_DURABLE' AND event.to_state='COMPLETE'
       AND event.detail->>'final_output_sha256'=output->>'checksumSha256'
       AND event.detail->>'final_output_receipt_sha256'=receipt_sha)<>1
     OR request.state NOT IN ('ACTIVE','SUCCEEDED') THEN
    RAISE EXCEPTION 'V2-09 render terminal state invalid' USING ERRCODE='55000';
  END IF;
  IF request.state='ACTIVE' THEN
    request_version_before:=request.version;
    SELECT * INTO capacity FROM public.global_generation_capacity WHERE singleton FOR SHARE;
    queue_audit_id:=md5('v209-render-terminal-release:'||request.id::text)::uuid;
    queue_audit_detail:=jsonb_build_object(
      'source','HOSTED_V209_RENDER_TERMINAL','terminalState','SUCCEEDED',
      'runtimeId',runtime.id,'renderAttemptId',attempt.id,
      'finalOutputSha256',runtime.final_output_sha256,
      'finalOutputReceiptSha256',receipt_sha);
    UPDATE public.generation_requests SET state='SUCCEEDED',terminal_at=db_now,
      version=version+1,updated_at=db_now WHERE id=request.id AND state='ACTIVE';
    INSERT INTO public.generation_queue_audits(id,account_id,workspace_id,actor_user_id,
      operation,request_kind,request_id,lease_id,request_version_before,request_version_after,
      video_cursor_before,video_cursor_after,preview_cursor_before,preview_cursor_after,
      detail,occurred_at)
    VALUES(queue_audit_id,account_id,workspace_id,request.created_by_user_id,
      'TERMINAL_RELEASE','VIDEO',request.id,lease.id,request_version_before,
      request_version_before+1,capacity.video_fair_cursor,capacity.video_fair_cursor,
      capacity.preview_fair_cursor,capacity.preview_fair_cursor,queue_audit_detail,db_now)
    ON CONFLICT(id) DO NOTHING;
  END IF;
  SELECT * INTO request FROM public.generation_requests row WHERE row.id=request.id FOR UPDATE;
  queue_audit_id:=md5('v209-render-terminal-release:'||request.id::text)::uuid;
  queue_audit_detail:=jsonb_build_object(
    'source','HOSTED_V209_RENDER_TERMINAL','terminalState','SUCCEEDED',
    'runtimeId',runtime.id,'renderAttemptId',attempt.id,
    'finalOutputSha256',runtime.final_output_sha256,
    'finalOutputReceiptSha256',receipt_sha);
  SELECT * INTO queue_audit FROM public.generation_queue_audits row
   WHERE row.id=queue_audit_id;
  IF request.state<>'SUCCEEDED'
     OR queue_audit.id IS NULL OR queue_audit.account_id<>account_id
     OR queue_audit.workspace_id<>workspace_id
     OR queue_audit.actor_user_id<>request.created_by_user_id
     OR queue_audit.operation<>'TERMINAL_RELEASE' OR queue_audit.request_kind<>'VIDEO'
     OR queue_audit.request_id<>request.id OR queue_audit.lease_id<>lease.id
     OR queue_audit.request_version_before<>request.version-1
     OR queue_audit.request_version_after<>request.version
     OR queue_audit.video_cursor_before<>queue_audit.video_cursor_after
     OR queue_audit.preview_cursor_before<>queue_audit.preview_cursor_after
     OR queue_audit.detail<>queue_audit_detail
     OR EXISTS(SELECT 1 FROM public.provider_workload_leases row
       WHERE row.generation_request_id=request.id AND row.state='ACTIVE') THEN
    RAISE EXCEPTION 'V2-09 render terminal postcondition failed' USING ERRCODE='55000';
  END IF;
  RETURN jsonb_build_object(
    'schemaVersion','videoforge.v2-09-render-terminal-result/v1','state','SUCCEEDED',
    'accountId',account_id,'workspaceId',workspace_id,'generationRequestId',request.id,
    'runtimeId',runtime.id,'renderAttemptId',attempt.id,
    'finalOutputSha256',runtime.final_output_sha256,'finalOutputReceiptSha256',receipt_sha,
    'replayed',NOT initial_path);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_read_v209_render_terminal_candidate(uuid,uuid,uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_finalize_v209_render_terminal(jsonb) FROM PUBLIC;
