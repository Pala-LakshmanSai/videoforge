-- V2-09 span finalization must verify the request hash of the parsed server-side
-- submission object.  The SQL materializer persists the wire document in
-- snake_case, while handleCpuSubmission hashes the exact parsed camelCase
-- object before creating hosted_cpu_job_attempts.
CREATE OR REPLACE FUNCTION public.videoforge_finalize_hosted_v209_span_audio(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_attempt_id uuid,
  supplied_result_document jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  materialized public.hosted_v209_span_audio_materializations%ROWTYPE;
  attempt public.hosted_cpu_job_attempts%ROWTYPE;
  authority public.hosted_cpu_upload_authorities%ROWTYPE;
  span public.selected_span_audio%ROWTYPE; existing_asset public.assets%ROWTYPE;
  input_document jsonb; audio jsonb; result_sha text; expected_uri text;
  expected_authority_key text;
  padded_samples bigint; trim_start_samples bigint; trim_end_samples bigint;
  output_reservation_id uuid; output_receipt_id uuid; output_receipt_sha text; receipt_facts jsonb;
  pair_ready boolean; db_now timestamptz:=transaction_timestamp();
  expected_submission_sha text; expected_request_sha text;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR jsonb_typeof(supplied_result_document)<>'object' THEN
    RAISE EXCEPTION 'hosted V2-09 span audio finalization scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT * INTO materialized FROM public.hosted_v209_span_audio_materializations m
    WHERE m.account_id=supplied_account_id AND m.workspace_id=supplied_workspace_id
      AND m.attempt_id=supplied_attempt_id FOR UPDATE;
  SELECT * INTO attempt FROM public.hosted_cpu_job_attempts a
    WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
      AND a.id=supplied_attempt_id FOR UPDATE;
  IF materialized.attempt_id IS NULL
     OR jsonb_typeof(materialized.submission_document)<>'object'
     OR (SELECT array_agg(key ORDER BY key)
           FROM jsonb_object_keys(CASE WHEN jsonb_typeof(materialized.submission_document)='object'
                                       THEN materialized.submission_document ELSE '{}'::jsonb END) key)
       IS DISTINCT FROM ARRAY['idempotency_key','input_document','kind','objects','project_id',
         'project_revision_id','schema_version']::text[]
     OR materialized.submission_document->>'schema_version'<>'videoforge-hosted-cpu-submission/v1'
     OR materialized.submission_document->>'kind'<>'SPAN_AUDIO'
     OR materialized.submission_document->>'project_id' IS DISTINCT FROM materialized.project_id::text
     OR materialized.submission_document->>'project_revision_id' IS DISTINCT FROM materialized.project_revision_id::text
     OR coalesce(materialized.submission_document->>'idempotency_key','') !~
       '^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$'
     OR jsonb_typeof(materialized.submission_document->'input_document')<>'object'
     OR jsonb_typeof(materialized.submission_document->'objects')<>'array'
     OR (CASE WHEN jsonb_typeof(materialized.submission_document->'objects')='array'
              THEN jsonb_array_length(materialized.submission_document->'objects') ELSE -1 END)<>1
     OR (SELECT array_agg(key ORDER BY key)
           FROM jsonb_object_keys(CASE
             WHEN jsonb_typeof(materialized.submission_document->'objects'->0)='object'
             THEN materialized.submission_document->'objects'->0 ELSE '{}'::jsonb END) key)
       IS DISTINCT FROM ARRAY['artifact_receipt_id','uri']::text[]
     OR materialized.submission_document->'objects'->0->>'artifact_receipt_id'
       IS DISTINCT FROM materialized.source_receipt_id::text
     OR materialized.submission_document->'objects'->0->>'uri'
       IS DISTINCT FROM materialized.input_document#>>'{source_voiceover,artifact_uri}' THEN
    RAISE EXCEPTION 'hosted V2-09 span submission document invalid' USING ERRCODE='23514';
  END IF;
  expected_submission_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(materialized.submission_document),'UTF8')),'hex');
  expected_request_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(jsonb_build_object(
      'idempotencyKey',materialized.submission_document->>'idempotency_key',
      'projectId',materialized.submission_document->>'project_id',
      'projectRevisionId',materialized.submission_document->>'project_revision_id',
      'kind',materialized.submission_document->>'kind',
      'inputDocument',materialized.submission_document->'input_document',
      'objects',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'receiptId',object_row.value->>'artifact_receipt_id','uri',object_row.value->>'uri')
        ORDER BY object_row.ordinality),'[]'::jsonb)
        FROM jsonb_array_elements(materialized.submission_document->'objects')
          WITH ORDINALITY AS object_row(value,ordinality))
    )),'UTF8')),'hex');
  IF materialized.attempt_id IS NULL OR attempt.id IS NULL OR attempt.kind<>'SPAN_AUDIO'
     OR attempt.execution_backend<>'PERSONAL_WORKER' OR attempt.state<>'SUCCEEDED'
     OR materialized.submission_sha256<>expected_submission_sha
     OR attempt.request_sha256<>expected_request_sha
     OR attempt.result_checksum_sha256 IS NULL
     OR NOT EXISTS(SELECT 1 FROM public.media_worker_leases l
       WHERE l.account_id=supplied_account_id AND l.workspace_id=supplied_workspace_id
         AND l.attempt_id=supplied_attempt_id AND l.state='SUCCEEDED') THEN
    RAISE EXCEPTION 'hosted V2-09 successful span attempt unavailable' USING ERRCODE='23514';
  END IF;
  result_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(supplied_result_document),'UTF8')),'hex');
  IF result_sha<>attempt.result_checksum_sha256
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied_result_document) key)
       IS DISTINCT FROM ARRAY['attempt_id','audio','error','schema_version','selection','source_voiceover',
         'span_id','status','task_key','timeline_plan_id','timeline_segment_id','transcript_id']::text[]
     OR supplied_result_document->>'schema_version'<>'selected-span-audio-result/v1'
     OR supplied_result_document->>'status'<>'SUCCEEDED'
     OR supplied_result_document->'error'<>'null'::jsonb THEN
    RAISE EXCEPTION 'hosted V2-09 span result document invalid' USING ERRCODE='23514';
  END IF;
  input_document:=materialized.input_document;
  audio:=supplied_result_document->'audio';
  IF supplied_result_document->>'attempt_id'<>supplied_attempt_id::text
     OR supplied_result_document->>'span_id'<>materialized.span_id::text
     OR supplied_result_document->>'timeline_plan_id'<>materialized.timeline_plan_id::text
     OR supplied_result_document->>'transcript_id'<>materialized.transcript_id::text
     OR supplied_result_document->>'timeline_segment_id'<>materialized.timeline_segment_id::text
     OR supplied_result_document->>'task_key'<>input_document->>'task_key'
     OR supplied_result_document->'source_voiceover' IS DISTINCT FROM
       ((input_document -> 'source_voiceover'::text) - 'artifact_uri'::text)
     OR supplied_result_document->'selection' IS DISTINCT FROM input_document->'selection'
     OR jsonb_typeof(audio)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(audio) key)
       IS DISTINCT FROM ARRAY['artifact_uri','asset_id','byte_size','channels','content_type','duration_ms',
         'sample_rate_hz','sha256']::text[]
     OR audio->>'asset_id'<>materialized.output_asset_id::text
     OR audio->>'sha256' !~ '^sha256:[0-9a-f]{64}$'
     OR audio->>'content_type'<>'audio/wav'
     OR (audio->>'byte_size')::bigint<45
     OR (audio->>'sample_rate_hz')::integer<>48000 OR (audio->>'channels')::integer<>1
     OR (audio->>'duration_ms')::bigint<>(input_document#>>'{selection,padded_end_ms_exclusive}')::bigint-
       (input_document#>>'{selection,padded_start_ms}')::bigint THEN
    RAISE EXCEPTION 'hosted V2-09 span result lineage mismatch' USING ERRCODE='23514';
  END IF;
  expected_uri:='vf-local://objects/sha256/'||substring(audio->>'sha256' FROM 8 FOR 2)||'/'||
    substring(audio->>'sha256' FROM 8)||'.wav';
  IF audio->>'artifact_uri'<>expected_uri THEN
    RAISE EXCEPTION 'hosted V2-09 span result URI mismatch' USING ERRCODE='23514';
  END IF;
  expected_authority_key:='tenant/'||supplied_account_id::text||'/workspace/'||supplied_workspace_id::text||
    '/project/'||materialized.project_id::text||'/revision/'||materialized.project_revision_id::text||
    '/lane/input/job/'||supplied_attempt_id::text||'/artifact/span-audio';
  SELECT * INTO authority FROM public.hosted_cpu_upload_authorities u
    WHERE u.account_id=supplied_account_id AND u.workspace_id=supplied_workspace_id
      AND u.attempt_id=supplied_attempt_id AND u.source='PRIMARY_RESULT_OUTPUT'
      AND u.object_key=expected_authority_key FOR SHARE;
  IF authority.id IS NULL OR materialized.project_id IS NULL OR materialized.project_revision_id IS NULL
     OR materialized.project_id<>attempt.project_id OR materialized.project_revision_id<>attempt.project_revision_id
     OR authority.account_id<>supplied_account_id OR authority.workspace_id<>supplied_workspace_id
     OR authority.attempt_id<>supplied_attempt_id OR authority.source<>'PRIMARY_RESULT_OUTPUT'
     OR authority.object_key<>expected_authority_key OR authority.content_type<>'audio/wav' OR authority.issued_at IS NULL
     OR authority.issued_content_length<>(audio->>'byte_size')::bigint
     OR authority.issued_checksum_sha256<>audio->>'sha256' THEN
    RAISE EXCEPTION 'hosted V2-09 span output authority mismatch' USING ERRCODE='23514';
  END IF;
  padded_samples:=((input_document#>>'{selection,padded_end_ms_exclusive}')::bigint-
    (input_document#>>'{selection,padded_start_ms}')::bigint)*48;
  trim_start_samples:=(input_document#>>'{selection,trim_start_ms}')::bigint*48;
  trim_end_samples:=(input_document#>>'{selection,trim_end_ms_exclusive}')::bigint*48;
  IF padded_samples%1920<>0 OR trim_start_samples%1920<>0 OR trim_end_samples%1920<>0
     OR padded_samples NOT BETWEEN 144000 AND 485760
     OR trim_end_samples-trim_start_samples NOT BETWEEN 96000 AND 480000 THEN
    RAISE EXCEPTION 'hosted V2-09 span sample cadence mismatch' USING ERRCODE='23514';
  END IF;
  SELECT * INTO span FROM public.selected_span_audio s WHERE s.id=materialized.span_id FOR UPDATE;
  SELECT * INTO existing_asset FROM public.assets a
    WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
      AND a.id=materialized.output_asset_id;
  IF existing_asset.id IS NULL THEN
    INSERT INTO public.assets(id,account_id,workspace_id,project_id,project_revision_id,kind,state,
      object_key,binary_sha256,content_type,byte_size,duration_ms,metadata,verified_at)
    VALUES(materialized.output_asset_id,supplied_account_id,supplied_workspace_id,materialized.project_id,
      materialized.project_revision_id,'AUDIO_SPAN','VERIFIED',authority.object_key,audio->>'sha256',
      'audio/wav',(audio->>'byte_size')::bigint,(audio->>'duration_ms')::bigint,
      jsonb_build_object('worker','image-media','job_type','SELECTED_SPAN_AUDIO',
        'dispatch_target','PERSONAL_WORKER','span_audio_input_hash',materialized.input_document_sha256,
        'span_audio_result_hash',result_sha,'span_id',materialized.span_id,
        'timeline_plan_id',materialized.timeline_plan_id,'transcript_id',materialized.transcript_id,
        'timeline_segment_id',materialized.timeline_segment_id,'task_key',input_document->>'task_key',
        'source_asset_id',materialized.source_asset_id,
        'source_binary_sha256',input_document#>>'{source_voiceover,sha256}',
        'selected_start_ms',(input_document#>>'{selection,selected_start_ms}')::bigint,
        'selected_end_ms_exclusive',(input_document#>>'{selection,selected_end_ms_exclusive}')::bigint,
        'padded_start_ms',(input_document#>>'{selection,padded_start_ms}')::bigint,
        'padded_end_ms_exclusive',(input_document#>>'{selection,padded_end_ms_exclusive}')::bigint,
        'trim_start_ms',(input_document#>>'{selection,trim_start_ms}')::bigint,
        'trim_end_ms_exclusive',(input_document#>>'{selection,trim_end_ms_exclusive}')::bigint,
        'sample_rate_hz',48000,'channels',1,'padded_samples_48k',padded_samples,
        'trim_start_sample_48k',trim_start_samples,
        'trim_end_sample_exclusive_48k',trim_end_samples),authority.issued_at);
  ELSIF existing_asset.kind<>'AUDIO_SPAN' OR existing_asset.state NOT IN ('VERIFIED','ACCEPTED')
     OR existing_asset.object_key<>authority.object_key OR existing_asset.binary_sha256<>audio->>'sha256'
     OR existing_asset.content_type<>'audio/wav' OR existing_asset.byte_size<>(audio->>'byte_size')::bigint
     OR existing_asset.metadata->>'span_audio_input_hash'<>materialized.input_document_sha256
     OR existing_asset.metadata->>'span_audio_result_hash'<>result_sha THEN
    RAISE EXCEPTION 'hosted V2-09 span asset replay drift' USING ERRCODE='23505';
  END IF;
  IF span.state='PLANNED' THEN
    UPDATE public.selected_span_audio SET state='MATERIALIZED',materialized_asset_id=materialized.output_asset_id,
      materialized_binary_sha256=audio->>'sha256',materialized_at=authority.issued_at,version=version+1
      WHERE id=span.id AND state='PLANNED';
  ELSIF span.state<>'MATERIALIZED' OR span.materialized_asset_id<>materialized.output_asset_id
     OR span.materialized_binary_sha256<>audio->>'sha256' THEN
    RAISE EXCEPTION 'hosted V2-09 span materialization replay drift' USING ERRCODE='23505';
  END IF;
  output_reservation_id:=public.videoforge_hosted_v209_span_uuid('reservation',materialized.span_id,
    supplied_attempt_id::text);
  output_receipt_id:=public.videoforge_hosted_v209_span_uuid('receipt',materialized.span_id,
    supplied_attempt_id::text);
  receipt_facts:=jsonb_build_object('schema_version','artifact-commit-receipt/v3',
    'receipt_id',output_receipt_id,'reservation_id',output_reservation_id,
    'account_id',supplied_account_id,'workspace_id',supplied_workspace_id,
    'object_key',authority.object_key,'callback_id','span-audio-'||output_receipt_id::text,
    'content_type','audio/wav','content_length',(audio->>'byte_size')::bigint,
    'checksum_sha256',audio->>'sha256','probe',jsonb_build_object('sample_rate_hz',48000,'channels',1,
      'duration_ms',(audio->>'duration_ms')::bigint),'retention_class','PROJECT','retain_until',NULL,
    'committed_at',to_char(authority.issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  output_receipt_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(receipt_facts),'UTF8')),'hex');
  INSERT INTO public.artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,
    asset_id,lane,job_id,artifact_id,object_key,method,content_type,content_length,checksum_sha256,
    expires_at,max_uses,used_count,state,retention_class,retain_until,deletion_owner_account_id)
  VALUES(output_reservation_id,supplied_account_id,supplied_workspace_id,materialized.project_id,
    materialized.project_revision_id,materialized.output_asset_id,'INPUT',supplied_attempt_id::text,
    'span-audio',expected_authority_key,'PUT','audio/wav',(audio->>'byte_size')::bigint,
    audio->>'sha256',attempt.deadline_at,1,1,'COMMITTED','PROJECT',NULL,supplied_account_id)
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,
    content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at)
  VALUES(output_receipt_id,supplied_account_id,supplied_workspace_id,output_reservation_id,
    'span-audio-'||output_receipt_id::text,authority.object_key,'audio/wav',(audio->>'byte_size')::bigint,
    audio->>'sha256',receipt_facts->'probe',output_receipt_sha,authority.issued_at)
  ON CONFLICT(account_id,workspace_id,reservation_id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.artifact_receipts receipt
    JOIN public.artifact_reservations reservation ON reservation.account_id=receipt.account_id
      AND reservation.workspace_id=receipt.workspace_id AND reservation.id=receipt.reservation_id
    WHERE receipt.account_id=supplied_account_id AND receipt.workspace_id=supplied_workspace_id
      AND receipt.id=output_receipt_id AND receipt.receipt_sha256=output_receipt_sha
      AND receipt.reservation_id=output_reservation_id AND receipt.object_key=expected_authority_key
      AND receipt.content_type='audio/wav' AND receipt.content_length=(audio->>'byte_size')::bigint
      AND receipt.checksum_sha256=audio->>'sha256'
      AND reservation.id=output_reservation_id AND reservation.project_id=materialized.project_id
      AND reservation.project_revision_id=materialized.project_revision_id
      AND reservation.asset_id=materialized.output_asset_id AND reservation.lane='INPUT'
      AND reservation.job_id=supplied_attempt_id::text AND reservation.artifact_id='span-audio'
      AND reservation.object_key=expected_authority_key AND reservation.method='PUT'
      AND reservation.content_type='audio/wav' AND reservation.content_length=(audio->>'byte_size')::bigint
      AND reservation.checksum_sha256=audio->>'sha256' AND reservation.state='COMMITTED') THEN
    RAISE EXCEPTION 'hosted V2-09 span artifact receipt replay drift' USING ERRCODE='23505';
  END IF;
  SELECT NOT EXISTS(SELECT 1 FROM public.selected_span_audio pending
    WHERE pending.account_id=supplied_account_id AND pending.workspace_id=supplied_workspace_id
      AND pending.project_revision_id=materialized.project_revision_id AND pending.state<>'MATERIALIZED')
    INTO pair_ready;
  RETURN jsonb_build_object('schemaVersion','videoforge.hosted-v209-span-audio-finalization/v1',
    'accountId',materialized.account_id,'workspaceId',materialized.workspace_id,'userId',materialized.user_id,
    'projectId',materialized.project_id,'projectRevisionId',materialized.project_revision_id,
    'generationRequestId',materialized.generation_request_id,'attemptId',supplied_attempt_id,
    'spanId',materialized.span_id,'assetId',materialized.output_asset_id,'artifactReceiptId',output_receipt_id,
    'objectKey',authority.object_key,'checksumSha256',audio->>'sha256',
    'replayed',existing_asset.id IS NOT NULL,'pairReady',pair_ready);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_finalize_hosted_v209_span_audio(uuid,uuid,uuid,jsonb) FROM PUBLIC;
