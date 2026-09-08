-- V2-09 forward repair: preserve the immutable visual task identity while resolving
-- selected span audio through its distinct required_slots.avatar.span_audio_task_key.
-- The timeline contract owns two keys per avatar segment:
--   avatar:<segment>     -> generation_tasks AVATAR task / GPU work item
--   audio-span:<segment> -> selected_span_audio / personal-worker preparation
-- Historical bridge, task, span, candidate, and evidence rows remain append-only.

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
    effective_selected_start:=span_row.start_frame*40;
    effective_selected_end:=span_row.end_frame_exclusive*40;
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
