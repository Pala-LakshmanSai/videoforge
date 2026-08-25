-- V2-09 hosted ASR -> canonical timing bridge. The runtime receives one append capability only;
-- it cannot create generic attempts, generation requests, outbox rows, authority, or transport.

CREATE TABLE public.hosted_canonical_timing_bridges (
  hosted_asr_attempt_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  transcript_id uuid NOT NULL,
  transcript_document_hash text NOT NULL CHECK (transcript_document_hash ~ '^sha256:[0-9a-f]{64}$'),
  timeline_plan_id uuid NOT NULL,
  timeline_document_hash text NOT NULL CHECK (timeline_document_hash ~ '^sha256:[0-9a-f]{64}$'),
  asr_input_sha256 text NOT NULL CHECK (asr_input_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  asr_result_sha256 text NOT NULL CHECK (asr_result_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  generation_plan_sha256 text NOT NULL CHECK (generation_plan_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  task_manifest jsonb NOT NULL CHECK (
    jsonb_typeof(task_manifest) = 'array' AND jsonb_array_length(task_manifest) BETWEEN 1 AND 4096
  ),
  append_payload jsonb NOT NULL CHECK (
    jsonb_typeof(append_payload) = 'object'
    AND append_payload->>'schema_version' = 'videoforge-hosted-canonical-timing-append/v1'
  ),
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, hosted_asr_attempt_id),
  UNIQUE (account_id, workspace_id, project_revision_id),
  FOREIGN KEY (account_id, workspace_id) REFERENCES public.workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_id)
    REFERENCES public.projects (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_revision_id)
    REFERENCES public.project_revisions (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, hosted_asr_attempt_id)
    REFERENCES public.hosted_cpu_job_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, transcript_id)
    REFERENCES public.transcripts (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, timeline_plan_id)
    REFERENCES public.timeline_plans (account_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER hosted_canonical_timing_bridges_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_canonical_timing_bridges
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_canonical_timing_bridges_tenant_write_guard
  BEFORE INSERT ON public.hosted_canonical_timing_bridges
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_canonical_timing_bridges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_canonical_timing_bridges FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_canonical_timing_bridges_tenant_rls
  ON public.hosted_canonical_timing_bridges
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE FUNCTION public.videoforge_append_hosted_canonical_timing(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_user_id uuid,
  supplied_project_id uuid,
  supplied_project_revision_id uuid,
  supplied_hosted_asr_attempt_id uuid,
  supplied_payload jsonb
) RETURNS TABLE (replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  target public.hosted_cpu_job_attempts%ROWTYPE;
  existing public.hosted_canonical_timing_bridges%ROWTYPE;
  authority public.hosted_cpu_upload_authorities%ROWTYPE;
  transcript jsonb := supplied_payload->'transcript';
  timeline jsonb := supplied_payload->'timeline';
  item jsonb;
  finished_at timestamptz;
  transcript_id uuid;
  timeline_id uuid;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_payload->>'schema_version' <> 'videoforge-hosted-canonical-timing-append/v1'
     OR supplied_payload->>'asr_input_sha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_payload->>'asr_result_sha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_payload->>'generation_plan_sha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(transcript) <> 'object' OR jsonb_typeof(timeline) <> 'object'
     OR jsonb_typeof(supplied_payload->'tasks') <> 'array'
     OR jsonb_array_length(supplied_payload->'tasks') NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'hosted canonical timing authority is invalid' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO target FROM public.hosted_cpu_job_attempts
   WHERE account_id = supplied_account_id AND workspace_id = supplied_workspace_id
     AND project_id = supplied_project_id AND project_revision_id = supplied_project_revision_id
     AND id = supplied_hosted_asr_attempt_id FOR SHARE;
  SELECT * INTO authority FROM public.hosted_cpu_upload_authorities
   WHERE account_id = supplied_account_id AND workspace_id = supplied_workspace_id
     AND attempt_id = supplied_hosted_asr_attempt_id
     AND source = 'RESULT_DOCUMENT' AND issued_at IS NOT NULL FOR SHARE;
  IF target.id IS NULL OR target.kind <> 'ASR' OR target.state <> 'SUCCEEDED'
     OR target.terminal_at IS NULL OR target.retention_deleted_at IS NOT NULL
     OR target.job_spec_checksum_sha256 <> supplied_payload->>'asr_input_sha256'
     OR target.result_checksum_sha256 <> supplied_payload->>'asr_result_sha256'
     OR target.job_spec_object_key NOT LIKE
       ('tenant/' || supplied_account_id::text || '/workspace/' || supplied_workspace_id::text ||
        '/project/' || supplied_project_id::text || '/revision/' ||
        supplied_project_revision_id::text || '/lane/input/job/' ||
        supplied_hosted_asr_attempt_id::text || '/artifact/%')
     OR target.result_object_key NOT LIKE
       ('tenant/' || supplied_account_id::text || '/workspace/' || supplied_workspace_id::text ||
        '/project/' || supplied_project_id::text || '/revision/' ||
        supplied_project_revision_id::text || '/lane/input/job/' ||
        supplied_hosted_asr_attempt_id::text || '/artifact/%')
     OR authority.attempt_id IS NULL
     OR authority.object_key <> target.result_object_key
     OR authority.content_type <> 'application/json'
     OR authority.issued_checksum_sha256 <> target.result_checksum_sha256
     OR authority.issued_content_length <> target.result_content_length
     OR NOT EXISTS (
       SELECT 1 FROM public.project_revisions revision
        WHERE revision.account_id = supplied_account_id
          AND revision.workspace_id = supplied_workspace_id
          AND revision.project_id = supplied_project_id
          AND revision.id = supplied_project_revision_id AND revision.status = 'LOCKED'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.memberships membership
        WHERE membership.account_id = supplied_account_id
          AND membership.workspace_id = supplied_workspace_id
          AND membership.user_id = supplied_user_id AND membership.status = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION 'hosted canonical timing requires exact successful retained ASR lineage'
      USING ERRCODE = '23514';
  END IF;

  transcript_id := (transcript->'row'->>'id')::uuid;
  timeline_id := (timeline->'row'->>'id')::uuid;
  finished_at := (transcript->'row'->>'created_at')::timestamptz;
  IF finished_at IS DISTINCT FROM target.terminal_at
     OR timeline->'row'->>'created_at' IS DISTINCT FROM transcript->'row'->>'created_at'
     OR timeline->'row'->>'transcript_id' IS DISTINCT FROM transcript_id::text
     OR transcript->'asset'->>'object_key' !~ ('^tenant/' || supplied_account_id::text || '/workspace/' || supplied_workspace_id::text || '/')
     OR timeline->'asset'->>'object_key' !~ ('^tenant/' || supplied_account_id::text || '/workspace/' || supplied_workspace_id::text || '/') THEN
    RAISE EXCEPTION 'hosted canonical timing payload lineage is inconsistent' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO existing FROM public.hosted_canonical_timing_bridges
   WHERE hosted_asr_attempt_id = supplied_hosted_asr_attempt_id FOR UPDATE;
  IF existing.hosted_asr_attempt_id IS NOT NULL THEN
    IF existing.account_id <> supplied_account_id OR existing.workspace_id <> supplied_workspace_id
       OR existing.project_id <> supplied_project_id
       OR existing.project_revision_id <> supplied_project_revision_id
       OR existing.transcript_id <> transcript_id OR existing.timeline_plan_id <> timeline_id
       OR existing.transcript_document_hash <> transcript->'asset'->>'hash'
       OR existing.timeline_document_hash <> timeline->'asset'->>'hash'
       OR existing.asr_input_sha256 <> supplied_payload->>'asr_input_sha256'
       OR existing.asr_result_sha256 <> supplied_payload->>'asr_result_sha256'
       OR existing.generation_plan_sha256 <> supplied_payload->>'generation_plan_sha256'
       OR existing.task_manifest IS DISTINCT FROM supplied_payload->'tasks'
       OR existing.append_payload IS DISTINCT FROM supplied_payload THEN
      RAISE EXCEPTION 'hosted canonical timing idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT true;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.revision_timing_heads head
              WHERE head.workspace_id = supplied_workspace_id
                AND head.project_revision_id = supplied_project_revision_id)
     OR EXISTS (SELECT 1 FROM public.generation_tasks task
                 WHERE task.workspace_id = supplied_workspace_id
                   AND task.project_revision_id = supplied_project_revision_id
                   AND task.lane IN ('IMAGE', 'AVATAR')) THEN
    RAISE EXCEPTION 'hosted canonical timing requires an empty canonical head and task set'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.assets (
    id, account_id, workspace_id, project_id, project_revision_id, source_attempt_id,
    kind, state, object_key, binary_sha256, canonical_contract_name,
    canonical_contract_version, canonical_document_sha256, content_type, byte_size,
    metadata, verified_at, created_at
  ) VALUES
    ((transcript->'asset'->>'id')::uuid, supplied_account_id, supplied_workspace_id,
     supplied_project_id, supplied_project_revision_id, NULL, 'CANONICAL_DOCUMENT', 'VERIFIED',
     transcript->'asset'->>'object_key', transcript->'asset'->>'hash', 'transcript-timing', 'v1',
     transcript->'asset'->>'hash', 'application/json', (transcript->'asset'->>'byte_size')::bigint,
     jsonb_build_object(
       'bridge', 'HOSTED_CPU_ASR',
       'hosted_cpu_asr_attempt_id', supplied_hosted_asr_attempt_id,
       'job_spec_sha256', target.job_spec_checksum_sha256,
       'result_object_sha256', target.result_checksum_sha256,
       'asr_input_canonical_hash', transcript->'asset'->'metadata'->>'asr_input_canonical_hash',
       'asr_result_canonical_hash', transcript->'asset'->'metadata'->>'asr_result_canonical_hash',
       'transcription_config_hash', transcript->'row'->>'transcription_config_hash',
       'input_fingerprint_hash', transcript->'row'->>'input_fingerprint_hash'
     ), finished_at, finished_at),
    ((timeline->'asset'->>'id')::uuid, supplied_account_id, supplied_workspace_id,
     supplied_project_id, supplied_project_revision_id, NULL, 'CANONICAL_DOCUMENT', 'VERIFIED',
     timeline->'asset'->>'object_key', timeline->'asset'->>'hash', 'timeline-plan', 'v1',
     timeline->'asset'->>'hash', 'application/json', (timeline->'asset'->>'byte_size')::bigint,
     timeline->'asset'->'metadata', finished_at, finished_at);

  INSERT INTO public.transcripts (
    id, account_id, workspace_id, project_revision_id, source_asset_id, state, model_name,
    model_hash, duration_ms, contract_name, contract_version, canonical_document_asset_id,
    canonical_document_hash, ready_at, lineage_contract_version, source_binary_sha256,
    engine_name, engine_version, language, transcription_config_hash, optional_script_hash,
    input_fingerprint_hash, idempotency_key, lineage_sequence, supersedes_transcript_id, created_at
  ) VALUES (
    transcript_id, supplied_account_id, supplied_workspace_id, supplied_project_revision_id,
    (transcript->'row'->>'source_asset_id')::uuid, 'READY', transcript->'row'->>'model_name',
    transcript->'row'->>'model_hash', (transcript->'row'->>'duration_ms')::bigint,
    'transcript-timing', 'v1', (transcript->'asset'->>'id')::uuid,
    transcript->'asset'->>'hash', finished_at, 'timing-lineage/v1',
    transcript->'row'->>'source_binary_sha256', transcript->'row'->>'engine_name',
    transcript->'row'->>'engine_version', transcript->'row'->>'language',
    transcript->'row'->>'transcription_config_hash', transcript->'row'->>'optional_script_hash',
    transcript->'row'->>'input_fingerprint_hash', transcript->'row'->>'idempotency_key',
    1, NULL, finished_at
  );
  FOR item IN SELECT value FROM jsonb_array_elements(transcript->'words') LOOP
    INSERT INTO public.transcript_words (id,account_id,workspace_id,transcript_id,word_index,word,start_ms,end_ms_exclusive,confidence,created_at)
    VALUES ((item->>'id')::uuid,supplied_account_id,supplied_workspace_id,transcript_id,(item->>'index')::int,item->>'text',(item->>'start_ms')::bigint,(item->>'end_ms')::bigint,(item->>'confidence')::numeric,finished_at);
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(transcript->'sentences') LOOP
    INSERT INTO public.transcript_sentences (id,account_id,workspace_id,transcript_id,sentence_key,sentence_index,word_start,word_end_exclusive,start_ms,end_ms_exclusive,text,created_at)
    VALUES ((item->>'id')::uuid,supplied_account_id,supplied_workspace_id,transcript_id,item->>'key',(item->>'index')::int,(item->>'word_start')::int,(item->>'word_end')::int,(item->>'start_ms')::bigint,(item->>'end_ms')::bigint,item->>'text',finished_at);
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(transcript->'phrases') LOOP
    INSERT INTO public.transcript_phrases (id,account_id,workspace_id,transcript_id,sentence_id,phrase_key,phrase_index,word_start,word_end_exclusive,start_ms,end_ms_exclusive,pause_before_ms,pause_after_ms,text,created_at)
    VALUES ((item->>'id')::uuid,supplied_account_id,supplied_workspace_id,transcript_id,(item->>'sentence_id')::uuid,item->>'key',(item->>'index')::int,(item->>'word_start')::int,(item->>'word_end')::int,(item->>'start_ms')::bigint,(item->>'end_ms')::bigint,(item->>'pause_before_ms')::bigint,(item->>'pause_after_ms')::bigint,item->>'text',finished_at);
  END LOOP;

  INSERT INTO public.timeline_plans (
    id,account_id,workspace_id,project_revision_id,transcript_id,plan_sequence,
    supersedes_timeline_plan_id,revision_config_hash,transcript_document_hash,scheduler_version,
    scheduler_config_hash,seed,input_fingerprint_hash,contract_name,contract_version,
    canonical_document_asset_id,canonical_document_hash,output_fps_num,output_fps_den,total_frames,
    idempotency_key,created_by_user_id,created_at
  ) VALUES (timeline_id,supplied_account_id,supplied_workspace_id,supplied_project_revision_id,
    transcript_id,1,NULL,timeline->'row'->>'revision_config_hash',timeline->'row'->>'transcript_document_hash',
    timeline->'row'->>'scheduler_version',timeline->'row'->>'scheduler_config_hash',
    (timeline->'row'->>'seed')::bigint,timeline->'row'->>'input_fingerprint_hash','timeline-plan','v1',
    (timeline->'asset'->>'id')::uuid,timeline->'asset'->>'hash',30,1,
    (timeline->'row'->>'total_frames')::int,timeline->'row'->>'idempotency_key',supplied_user_id,finished_at);
  FOR item IN SELECT value FROM jsonb_array_elements(timeline->'segments') LOOP
    INSERT INTO public.timeline_segments (id,account_id,workspace_id,project_revision_id,timeline_plan_id,segment_key,segment_index,start_frame,end_frame_exclusive,source_audio_start_ms,source_audio_end_ms_exclusive,word_start,word_end_exclusive,timeline_composition,in_image_shot_role,narration,required_slots,timeline_plan_hash,created_at)
    VALUES ((item->>'id')::uuid,supplied_account_id,supplied_workspace_id,supplied_project_revision_id,timeline_id,item->>'key',(item->>'index')::int,(item->>'start_frame')::int,(item->>'end_frame')::int,(item->>'source_start_ms')::bigint,(item->>'source_end_ms')::bigint,(item->>'word_start')::int,(item->>'word_end')::int,item->>'composition',item->>'image_role',item->>'narration',item->'required_slots',timeline->'asset'->>'hash',finished_at);
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(timeline->'spans') LOOP
    INSERT INTO public.selected_span_audio (id,account_id,workspace_id,project_revision_id,timeline_plan_id,timeline_segment_id,transcript_id,span_key,task_key,source_asset_id,source_binary_sha256,selected_start_ms,selected_end_ms_exclusive,padded_start_ms,padded_end_ms_exclusive,trim_start_ms,trim_end_ms_exclusive,state,created_at)
    VALUES ((item->>'id')::uuid,supplied_account_id,supplied_workspace_id,supplied_project_revision_id,timeline_id,(item->>'timeline_segment_id')::uuid,transcript_id,item->>'key',item->>'task_key',(item->>'source_asset_id')::uuid,item->>'source_sha256',(item->>'selected_start_ms')::bigint,(item->>'selected_end_ms')::bigint,(item->>'padded_start_ms')::bigint,(item->>'padded_end_ms')::bigint,(item->>'trim_start_ms')::bigint,(item->>'trim_end_ms')::bigint,'PLANNED',finished_at);
  END LOOP;

  INSERT INTO public.revision_timing_heads (account_id,workspace_id,project_revision_id,version,current_transcript_id,current_timeline_plan_id,transcript_input_fingerprint_hash,timeline_input_fingerprint_hash,updated_at)
  VALUES (supplied_account_id,supplied_workspace_id,supplied_project_revision_id,2,transcript_id,timeline_id,transcript->'row'->>'input_fingerprint_hash',timeline->'row'->>'input_fingerprint_hash',finished_at);
  FOR item IN SELECT value FROM jsonb_array_elements(supplied_payload->'tasks') LOOP
    INSERT INTO public.generation_tasks (id,account_id,workspace_id,owner_type,owner_id,project_revision_id,task_key,lane,state,required,depends_on,created_at,updated_at)
    VALUES ((item->>'id')::uuid,supplied_account_id,supplied_workspace_id,'PROJECT_REVISION',supplied_project_revision_id,supplied_project_revision_id,item->>'task_key',item->>'lane','BLOCKED',true,item->'depends_on',finished_at,finished_at);
  END LOOP;
  INSERT INTO public.hosted_canonical_timing_bridges (hosted_asr_attempt_id,account_id,workspace_id,project_id,project_revision_id,transcript_id,transcript_document_hash,timeline_plan_id,timeline_document_hash,asr_input_sha256,asr_result_sha256,generation_plan_sha256,task_manifest,append_payload,completed_at)
  VALUES (supplied_hosted_asr_attempt_id,supplied_account_id,supplied_workspace_id,supplied_project_id,supplied_project_revision_id,transcript_id,transcript->'asset'->>'hash',timeline_id,timeline->'asset'->>'hash',supplied_payload->>'asr_input_sha256',supplied_payload->>'asr_result_sha256',supplied_payload->>'generation_plan_sha256',supplied_payload->'tasks',supplied_payload,finished_at);
  RETURN QUERY SELECT false;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_append_hosted_canonical_timing(uuid,uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC;
