-- Ordinary hosted V2-09 pre-GPU span audio and post-GPU terminal seams.
-- Browser callers never supply provider, endpoint, artifact, or authority identities.

ALTER TABLE public.hosted_cpu_job_attempts
  DROP CONSTRAINT hosted_cpu_job_attempts_kind_check;
ALTER TABLE public.hosted_cpu_job_attempts
  ADD CONSTRAINT hosted_cpu_job_attempts_kind_check
  CHECK(kind IN ('ASR','SPAN_AUDIO','RENDER'));

CREATE TABLE public.hosted_v209_span_audio_materializations (
  span_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  generation_request_id uuid NOT NULL,
  user_id uuid NOT NULL,
  timeline_plan_id uuid NOT NULL,
  transcript_id uuid NOT NULL,
  timeline_segment_id uuid NOT NULL,
  task_id uuid NOT NULL,
  attempt_id uuid NOT NULL UNIQUE,
  source_asset_id uuid NOT NULL,
  source_receipt_id uuid NOT NULL,
  output_asset_id uuid NOT NULL UNIQUE,
  input_document jsonb NOT NULL CHECK(jsonb_typeof(input_document)='object'),
  input_document_sha256 text NOT NULL CHECK(input_document_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  submission_document jsonb NOT NULL CHECK(jsonb_typeof(submission_document)='object'),
  submission_sha256 text NOT NULL CHECK(submission_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(account_id,workspace_id,span_id),
  UNIQUE(account_id,workspace_id,attempt_id),
  FOREIGN KEY(account_id,workspace_id,project_id)
    REFERENCES public.projects(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,project_revision_id)
    REFERENCES public.project_revisions(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,span_id)
    REFERENCES public.selected_span_audio(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,task_id)
    REFERENCES public.generation_tasks(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,source_asset_id)
    REFERENCES public.assets(account_id,workspace_id,id),
  FOREIGN KEY(source_receipt_id) REFERENCES public.artifact_receipts(id)
);

CREATE TRIGGER hosted_v209_span_audio_materializations_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_v209_span_audio_materializations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_v209_span_audio_materializations_tenant_write_guard
  BEFORE INSERT ON public.hosted_v209_span_audio_materializations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_v209_span_audio_materializations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_v209_span_audio_materializations FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_v209_span_audio_materializations_tenant_rls
  ON public.hosted_v209_span_audio_materializations
  USING(account_id=public.videoforge_current_account_id())
  WITH CHECK(account_id=public.videoforge_current_account_id());

CREATE TABLE public.hosted_v209_ordinary_resolved_render_manifests (
  generation_request_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  asset_id uuid NOT NULL UNIQUE,
  reservation_id uuid NOT NULL UNIQUE,
  manifest_sha256 text NOT NULL UNIQUE CHECK(manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  manifest_document jsonb NOT NULL CHECK(jsonb_typeof(manifest_document)='object'),
  object_key text NOT NULL,
  content_length bigint NOT NULL CHECK(content_length BETWEEN 1 AND 1048576),
  receipt_sha256 text NOT NULL UNIQUE CHECK(receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(account_id,workspace_id,generation_request_id),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,project_id)
    REFERENCES public.projects(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,project_revision_id)
    REFERENCES public.project_revisions(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,asset_id)
    REFERENCES public.assets(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,reservation_id)
    REFERENCES public.artifact_reservations(account_id,workspace_id,id)
);
CREATE TRIGGER hosted_v209_ordinary_resolved_render_manifests_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_v209_ordinary_resolved_render_manifests
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_v209_ordinary_resolved_render_manifests_tenant_write_guard
  BEFORE INSERT ON public.hosted_v209_ordinary_resolved_render_manifests
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_v209_ordinary_resolved_render_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_v209_ordinary_resolved_render_manifests FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_v209_ordinary_resolved_render_manifests_tenant_rls
  ON public.hosted_v209_ordinary_resolved_render_manifests
  USING(account_id=public.videoforge_current_account_id())
  WITH CHECK(account_id=public.videoforge_current_account_id());

CREATE FUNCTION public.videoforge_hosted_v209_span_uuid(
  supplied_kind text, supplied_span_id uuid, supplied_discriminator text
) RETURNS uuid LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public,pg_catalog AS $$
DECLARE digest text;
BEGIN
  IF supplied_kind NOT IN ('attempt','output-asset','receipt','reservation')
     OR length(supplied_discriminator) NOT BETWEEN 1 AND 240 THEN
    RAISE EXCEPTION 'hosted V2-09 span UUID input invalid' USING ERRCODE='22023';
  END IF;
  digest:=encode(sha256(convert_to('hosted-v209-span-'||supplied_kind||':'||
    supplied_span_id::text||':'||supplied_discriminator,'UTF8')),'hex');
  digest:=substring(digest,1,12)||'5'||substring(digest,14,3)||'8'||substring(digest,18,15);
  RETURN (substring(digest,1,8)||'-'||substring(digest,9,4)||'-'||substring(digest,13,4)||'-'||
    substring(digest,17,4)||'-'||substring(digest,21,12))::uuid;
END;
$$;

-- V2-09 added the exact persisted worker request after 0037. Keep the generic barrier trigger,
-- but derive its two request identities from predispatch authority and require the ordinary
-- materialization to agree when one exists.
CREATE OR REPLACE FUNCTION public.videoforge_derive_hosted_output_barrier_completion()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE
  attempt public.serverless_attempts%ROWTYPE; assignment public.serverless_provider_assignments%ROWTYPE;
  deployment public.serverless_endpoint_deployments%ROWTYPE;
  provenance public.serverless_provenance_receipts%ROWTYPE;
  authority public.serverless_predispatch_authorities%ROWTYPE;
  materialized public.hosted_v209_ordinary_lane_materializations%ROWTYPE;
  canonical_objects jsonb; derived jsonb; object_count integer; distinct_hashes integer;
  request_sha text;
BEGIN
  SELECT * INTO attempt FROM public.serverless_attempts a WHERE a.id=NEW.attempt_id FOR UPDATE;
  SELECT * INTO assignment FROM public.serverless_provider_assignments a
    WHERE a.attempt_id=NEW.attempt_id AND a.is_current FOR SHARE;
  SELECT * INTO deployment FROM public.serverless_endpoint_deployments d
    WHERE d.id=attempt.deployment_id AND d.lane=attempt.lane FOR SHARE;
  SELECT * INTO provenance FROM public.serverless_provenance_receipts p
    WHERE p.account_id=attempt.account_id AND p.workspace_id=attempt.workspace_id
      AND p.attempt_id=attempt.id AND p.assignment_id=assignment.id
      AND p.receipt_sha256=NEW.provenance_receipt_sha256 FOR SHARE;
  SELECT * INTO materialized FROM public.hosted_v209_ordinary_lane_materializations m
    WHERE m.account_id=attempt.account_id AND m.workspace_id=attempt.workspace_id
      AND m.attempt_id=attempt.id;
  IF attempt.id IS NULL OR assignment.id IS NULL OR deployment.id IS NULL OR provenance.id IS NULL
     OR attempt.account_id<>NEW.account_id OR attempt.workspace_id<>NEW.workspace_id
     OR assignment.dispatch_token_sha256<>attempt.dispatch_token_sha256
     OR assignment.project_revision_id<>attempt.project_revision_id
     OR provenance.provider_job_id IS DISTINCT FROM assignment.provider_job_id
     OR provenance.project_revision_id<>attempt.project_revision_id
     OR NOT (provenance.gpu_name=ANY(deployment.gpu_allowlist))
     OR provenance.intended_region<>deployment.region
     OR provenance.intended_volume_id_sha256<>deployment.volume_id_sha256
     OR provenance.manifest_sha256_before<>deployment.volume_manifest_sha256
     OR provenance.manifest_sha256_after<>deployment.volume_manifest_sha256
     OR provenance.mutation_detected OR provenance.cross_mount_detected THEN
    RAISE EXCEPTION 'hosted output completion lineage invalid' USING ERRCODE='23514';
  END IF;
  IF materialized.attempt_id IS NOT NULL THEN
    SELECT * INTO authority FROM public.serverless_predispatch_authorities a
      WHERE a.account_id=attempt.account_id AND a.workspace_id=attempt.workspace_id
        AND a.attempt_id=attempt.id AND a.dispatch_token_sha256=attempt.dispatch_token_sha256 FOR SHARE;
    request_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
      materialized.request_body-'envelope'),'UTF8')),'hex');
    IF authority.id IS NULL OR materialized.envelope_sha256<>authority.envelope_sha256
       OR materialized.full_request_sha256<>authority.request_body_sha256
       OR materialized.full_request_sha256<>'sha256:'||encode(sha256(convert_to(
         public.videoforge_canonical_jsonb(materialized.request_body),'UTF8')),'hex') THEN
      RAISE EXCEPTION 'hosted output completion materialization drift' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT count(DISTINCT value),count(*) INTO distinct_hashes,object_count
    FROM jsonb_array_elements_text(NEW.artifact_commit_receipt_sha256s) value;
  IF object_count<>attempt.item_count OR distinct_hashes<>object_count
     OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.artifact_commit_receipt_sha256s) value
       WHERE value !~ '^sha256:[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'hosted output completion receipt set invalid' USING ERRCODE='23514';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('item_id',reservation.artifact_id,
      'object_key',receipt.object_key,'content_type',receipt.content_type,
      'content_length',receipt.content_length,'checksum_sha256',receipt.checksum_sha256)
      ORDER BY reservation.artifact_id COLLATE "C"),count(*) INTO canonical_objects,object_count
    FROM public.artifact_receipts receipt JOIN public.artifact_reservations reservation
      ON reservation.account_id=receipt.account_id AND reservation.workspace_id=receipt.workspace_id
      AND reservation.id=receipt.reservation_id
    WHERE receipt.account_id=attempt.account_id AND receipt.workspace_id=attempt.workspace_id
      AND receipt.deleted_at IS NULL AND receipt.receipt_sha256 IN
        (SELECT jsonb_array_elements_text(NEW.artifact_commit_receipt_sha256s))
      AND reservation.project_id=attempt.project_id AND reservation.project_revision_id=attempt.project_revision_id
      AND reservation.job_id=attempt.id::text AND reservation.state='COMMITTED'
      AND reservation.lane=CASE attempt.lane WHEN 'mage_image' THEN 'MAGE_IMAGE' ELSE 'SOULX_AVATAR' END
      AND reservation.object_key=attempt.output_prefix||'/artifact/'||reservation.artifact_id
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(provenance.items) signed
        WHERE signed->>'item_id'=reservation.artifact_id AND signed->>'state'='SUCCEEDED'
          AND signed->>'output_object_key'=receipt.object_key
          AND signed->>'output_sha256'=receipt.checksum_sha256
          AND (signed->>'output_bytes')::bigint=receipt.content_length AND signed->'probe'=receipt.probe);
  IF object_count<>attempt.item_count OR jsonb_array_length(provenance.items)<>attempt.item_count THEN
    RAISE EXCEPTION 'hosted output completion objects incomplete' USING ERRCODE='23514';
  END IF;
  derived:=jsonb_build_object('account_id',attempt.account_id,'workspace_id',attempt.workspace_id,
    'project_id',attempt.project_id,'project_revision_id',attempt.project_revision_id,'lane',attempt.lane,
    'attempt_id',attempt.id,'provider_job_id',assignment.provider_job_id,
    'dispatch_token_sha256',attempt.dispatch_token_sha256,'deployment_id',deployment.id,
    'endpoint_id_sha256',deployment.endpoint_id_sha256,'endpoint_config_sha256',deployment.endpoint_config_sha256,
    'worker_image_digest',deployment.worker_image_digest,'model_manifest_sha256',deployment.model_manifest_sha256,
    'volume_id_sha256',deployment.volume_id_sha256,'volume_manifest_sha256',deployment.volume_manifest_sha256,
    'expected_objects',canonical_objects);
  IF materialized.attempt_id IS NOT NULL THEN
    derived:=derived||jsonb_build_object('envelope_sha256',authority.envelope_sha256,
      'request_sha256',request_sha);
  END IF;
  IF NEW.binding_components IS DISTINCT FROM derived
     OR (materialized.attempt_id IS NOT NULL AND
       NEW.binding_sha256<>'sha256:'||encode(sha256(convert_to(
         public.videoforge_canonical_jsonb(derived),'UTF8')),'hex')) THEN
    RAISE EXCEPTION 'hosted output completion binding hash invalid' USING ERRCODE='23514';
  END IF;
  -- Preserve the named 0037 lineage assertions: bound_assignment.dispatch_token_sha256 and
  -- bound_provenance.project_revision_id are checked above through assignment/provenance aliases.
  NEW.project_id:=attempt.project_id; NEW.project_revision_id:=attempt.project_revision_id;
  NEW.lane:=attempt.lane; NEW.assignment_id:=assignment.id; NEW.provider_job_id:=assignment.provider_job_id;
  NEW.dispatch_token_sha256:=attempt.dispatch_token_sha256; NEW.deployment_id:=deployment.id;
  NEW.endpoint_id_sha256:=deployment.endpoint_id_sha256;
  NEW.endpoint_config_sha256:=deployment.endpoint_config_sha256;
  NEW.worker_image_digest:=deployment.worker_image_digest;
  NEW.model_manifest_sha256:=deployment.model_manifest_sha256;
  NEW.volume_id_sha256:=deployment.volume_id_sha256;
  NEW.volume_manifest_sha256:=deployment.volume_manifest_sha256; NEW.region:=deployment.region;
  NEW.gpu_allowlist:=deployment.gpu_allowlist; NEW.expected_objects:=canonical_objects;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_generation_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  request public.generation_requests%ROWTYPE; revision public.project_revisions%ROWTYPE;
  bridge public.hosted_canonical_timing_bridges%ROWTYPE; candidate public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  voiceover jsonb; avatar jsonb; visuals jsonb; manifest_asset_id uuid; manifest_reservation_id uuid;
  object_key text; has_avatar_full boolean;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RETURN NULL;
  END IF;
  SELECT * INTO request FROM public.generation_requests r WHERE r.account_id=supplied_account_id
    AND r.workspace_id=supplied_workspace_id AND r.id=supplied_generation_request_id;
  SELECT * INTO revision FROM public.project_revisions r WHERE r.account_id=supplied_account_id
    AND r.workspace_id=supplied_workspace_id AND r.id=request.project_revision_id AND r.status='LOCKED';
  SELECT * INTO bridge FROM public.hosted_canonical_timing_bridges b WHERE b.account_id=supplied_account_id
    AND b.workspace_id=supplied_workspace_id AND b.project_revision_id=request.project_revision_id;
  SELECT * INTO candidate FROM public.hosted_v209_ordinary_dispatch_candidates c
    WHERE c.account_id=supplied_account_id AND c.workspace_id=supplied_workspace_id
      AND c.generation_request_id=supplied_generation_request_id;
  IF request.id IS NULL OR revision.id IS NULL OR bridge.hosted_asr_attempt_id IS NULL
     OR candidate.generation_request_id IS NULL
     OR (SELECT count(*) FROM public.hosted_serverless_output_barrier_completions barrier
       JOIN public.serverless_attempts attempt ON attempt.id=barrier.attempt_id
       WHERE attempt.account_id=supplied_account_id AND attempt.workspace_id=supplied_workspace_id
         AND attempt.generation_request_id=supplied_generation_request_id)<>2 THEN
    RETURN NULL;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.timeline_segments segment
    WHERE segment.account_id=supplied_account_id AND segment.workspace_id=supplied_workspace_id
      AND segment.project_revision_id=request.project_revision_id
      AND segment.timeline_plan_id=bridge.timeline_plan_id
      AND segment.timeline_composition='AVATAR_FULL') INTO has_avatar_full;
  SELECT jsonb_build_object('assetId',asset.id,'sha256',asset.binary_sha256,'objectKey',asset.object_key,
      'contentType',asset.content_type,'contentLength',asset.byte_size,'receiptId',receipt.id)
    INTO voiceover FROM public.assets asset JOIN public.artifact_reservations reservation
      ON reservation.account_id=asset.account_id AND reservation.workspace_id=asset.workspace_id
      AND reservation.asset_id=asset.id AND reservation.state='COMMITTED'
    JOIN public.artifact_receipts receipt ON receipt.account_id=reservation.account_id
      AND receipt.workspace_id=reservation.workspace_id AND receipt.reservation_id=reservation.id
      AND receipt.deleted_at IS NULL
    WHERE asset.account_id=supplied_account_id AND asset.workspace_id=supplied_workspace_id
      AND asset.id=revision.voiceover_asset_id AND asset.binary_sha256=revision.voiceover_binary_sha256
      AND asset.state IN ('VERIFIED','ACCEPTED') ORDER BY receipt.committed_at DESC LIMIT 1;
  SELECT jsonb_build_object('assetId',asset.id,'sha256',asset.binary_sha256,'objectKey',asset.object_key,
      'contentType',asset.content_type,'contentLength',asset.byte_size,'receiptId',receipt.id)
    INTO avatar FROM public.assets asset JOIN public.artifact_reservations reservation
      ON reservation.account_id=asset.account_id AND reservation.workspace_id=asset.workspace_id
      AND reservation.asset_id=asset.id AND reservation.state='COMMITTED'
    JOIN public.artifact_receipts receipt ON receipt.account_id=reservation.account_id
      AND receipt.workspace_id=reservation.workspace_id AND receipt.reservation_id=reservation.id
      AND receipt.deleted_at IS NULL
    WHERE asset.account_id=supplied_account_id AND asset.workspace_id=supplied_workspace_id
      AND asset.id=revision.avatar_runtime_source_asset_id
      AND asset.binary_sha256=revision.avatar_runtime_source_binary_sha256
      AND has_avatar_full
      AND asset.state IN ('VERIFIED','ACCEPTED') ORDER BY receipt.committed_at DESC LIMIT 1;
  SELECT jsonb_agg(jsonb_build_object('taskId',work->>'taskId','taskKey',task.task_key,
      'acceptedAttemptId',attempt.id,'assetId',reservation.artifact_id,
      'sha256',receipt.checksum_sha256,'objectKey',receipt.object_key,'contentType',receipt.content_type,
      'contentLength',receipt.content_length,'receiptId',receipt.id,'lane',attempt.lane)
      ORDER BY attempt.lane,work->>'taskId') INTO visuals
    FROM public.serverless_attempts attempt
    JOIN public.hosted_serverless_output_barrier_completions barrier ON barrier.attempt_id=attempt.id
    JOIN public.hosted_v209_ordinary_dispatch_candidates c ON c.generation_request_id=attempt.generation_request_id
    CROSS JOIN LATERAL jsonb_array_elements(c.candidate_document->'work'->attempt.lane) work
    JOIN public.generation_tasks task ON task.account_id=attempt.account_id
      AND task.workspace_id=attempt.workspace_id AND task.project_revision_id=attempt.project_revision_id
      AND task.id=(work->>'taskId')::uuid
      AND task.lane=CASE attempt.lane WHEN 'mage_image' THEN 'IMAGE' ELSE 'AVATAR' END
    JOIN public.artifact_reservations reservation ON reservation.account_id=attempt.account_id
      AND reservation.workspace_id=attempt.workspace_id AND reservation.job_id=attempt.id::text
      AND reservation.artifact_id=work->>'taskId' AND reservation.state='COMMITTED'
    JOIN public.artifact_receipts receipt ON receipt.account_id=reservation.account_id
      AND receipt.workspace_id=reservation.workspace_id AND receipt.reservation_id=reservation.id
      AND receipt.deleted_at IS NULL
    WHERE attempt.account_id=supplied_account_id AND attempt.workspace_id=supplied_workspace_id
      AND attempt.generation_request_id=supplied_generation_request_id;
  IF voiceover IS NULL OR (has_avatar_full AND avatar IS NULL) OR jsonb_array_length(visuals)<>
     jsonb_array_length(candidate.candidate_document#>'{work,mage_image}')+
       jsonb_array_length(candidate.candidate_document#>'{work,soulx_avatar}') THEN
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

CREATE FUNCTION public.videoforge_commit_hosted_v209_resolved_render_manifest(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_generation_request_id uuid,
  supplied_manifest jsonb, supplied_manifest_sha256 text, supplied_object_key text,
  supplied_content_length bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  ready jsonb; existing public.hosted_v209_ordinary_resolved_render_manifests%ROWTYPE;
  asset_id uuid; reservation_id uuid; receipt_id uuid; receipt_hash text; receipt_facts jsonb;
  expected_sha text; committed_at timestamptz:=transaction_timestamp(); visual jsonb;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'hosted V2-09 render manifest scope invalid' USING ERRCODE='42501';
  END IF;
  ready:=public.videoforge_read_hosted_v209_ready_render_inputs(supplied_account_id,
    supplied_workspace_id,supplied_generation_request_id);
  expected_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(supplied_manifest),'UTF8')),'hex');
  IF ready IS NULL OR jsonb_typeof(supplied_manifest)<>'object'
     OR supplied_manifest->>'schema_version'<>'resolved-render-manifest/v1'
     OR supplied_manifest->>'project_revision_id'<>ready#>>'{revision,snapshot,id}'
     OR supplied_manifest->>'revision_config_hash'<>ready#>>'{revision,snapshot,revision_config_hash}'
     OR supplied_manifest->>'timeline_plan_hash'<>ready#>>'{timing,timelineSha256}'
     OR supplied_manifest->>'render_profile_version'<>'ffmpeg-render-v3'
     OR supplied_manifest#>>'{voiceover,asset_id}'<>ready#>>'{voiceover,assetId}'
     OR supplied_manifest#>>'{voiceover,sha256}'<>ready#>>'{voiceover,sha256}'
     OR supplied_manifest_sha256<>expected_sha
     OR supplied_content_length NOT BETWEEN 1 AND 1048576
     OR supplied_object_key<>ready#>>'{manifestReservation,objectKey}' THEN
    RAISE EXCEPTION 'hosted V2-09 resolved render manifest invalid' USING ERRCODE='23514';
  END IF;
  FOR visual IN SELECT value FROM jsonb_array_elements(ready->'acceptedVisuals') value LOOP
    IF NOT jsonb_path_exists(supplied_manifest,'$.segments[*].accepted_assets.* ? (@.asset_id == $asset && @.sha256 == $sha)',
      jsonb_build_object('asset',visual->>'assetId','sha',visual->>'sha256')) THEN
      RAISE EXCEPTION 'hosted V2-09 resolved render manifest task set incomplete' USING ERRCODE='23514';
    END IF;
  END LOOP;
  SELECT * INTO existing FROM public.hosted_v209_ordinary_resolved_render_manifests m
    WHERE m.generation_request_id=supplied_generation_request_id;
  IF existing.generation_request_id IS NOT NULL THEN
    IF existing.account_id<>supplied_account_id OR existing.workspace_id<>supplied_workspace_id
       OR existing.manifest_sha256<>supplied_manifest_sha256
       OR existing.manifest_document IS DISTINCT FROM supplied_manifest
       OR existing.object_key<>supplied_object_key OR existing.content_length<>supplied_content_length THEN
      RAISE EXCEPTION 'hosted V2-09 resolved render manifest replay drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('schemaVersion','videoforge.hosted-v209-resolved-render-manifest/v1',
      'replayed',true,'artifact',jsonb_build_object('assetId',existing.asset_id,
        'receiptId',(SELECT id FROM public.artifact_receipts WHERE receipt_sha256=existing.receipt_sha256),
        'objectKey',existing.object_key,'contentType','application/json','contentLength',existing.content_length,
        'sha256',existing.manifest_sha256,'kind','RESOLVED_RENDER_MANIFEST','lane','RENDER',
        'commitKind','COMMITTED_MANIFEST'));
  END IF;
  asset_id:=(ready#>>'{manifestReservation,assetId}')::uuid;
  reservation_id:=(ready#>>'{manifestReservation,reservationId}')::uuid;
  receipt_id:=md5('hosted-v209-render-manifest-receipt:'||supplied_generation_request_id::text)::uuid;
  INSERT INTO public.assets(id,account_id,workspace_id,project_id,project_revision_id,kind,state,
    object_key,binary_sha256,canonical_contract_name,canonical_contract_version,
    canonical_document_sha256,content_type,byte_size,metadata,verified_at)
  VALUES(asset_id,supplied_account_id,supplied_workspace_id,
    (SELECT project_id FROM public.generation_requests WHERE id=supplied_generation_request_id),
    (ready#>>'{revision,snapshot,id}')::uuid,'CANONICAL_DOCUMENT','VERIFIED',supplied_object_key,
    supplied_manifest_sha256,'resolved-render-manifest','v1',supplied_manifest_sha256,'application/json',
    supplied_content_length,jsonb_build_object('generation_request_id',supplied_generation_request_id),committed_at);
  INSERT INTO public.artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,
    asset_id,lane,job_id,artifact_id,object_key,method,content_type,content_length,checksum_sha256,
    expires_at,max_uses,used_count,state,retention_class,retain_until,deletion_owner_account_id)
  VALUES(reservation_id,supplied_account_id,supplied_workspace_id,
    (SELECT project_id FROM public.generation_requests WHERE id=supplied_generation_request_id),
    (ready#>>'{revision,snapshot,id}')::uuid,asset_id,'RENDER',supplied_generation_request_id::text,
    'resolved-render-manifest',supplied_object_key,'PUT','application/json',supplied_content_length,
    supplied_manifest_sha256,committed_at+interval '1 hour',1,1,'COMMITTED','PROJECT',NULL,supplied_account_id);
  receipt_facts:=jsonb_build_object('schema_version','artifact-commit-receipt/v3','receipt_id',receipt_id,
    'reservation_id',reservation_id,'account_id',supplied_account_id,'workspace_id',supplied_workspace_id,
    'object_key',supplied_object_key,'callback_id','resolved-render-manifest-'||receipt_id::text,
    'content_type','application/json','content_length',supplied_content_length,
    'checksum_sha256',supplied_manifest_sha256,'probe',jsonb_build_object('schemaVersion','resolved-render-manifest/v1'),
    'retention_class','PROJECT','retain_until',NULL,'committed_at',
    to_char(committed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  receipt_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(receipt_facts),'UTF8')),'hex');
  INSERT INTO public.artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,
    content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at)
  VALUES(receipt_id,supplied_account_id,supplied_workspace_id,reservation_id,
    'resolved-render-manifest-'||receipt_id::text,supplied_object_key,'application/json',supplied_content_length,
    supplied_manifest_sha256,receipt_facts->'probe',receipt_hash,committed_at);
  INSERT INTO public.hosted_v209_ordinary_resolved_render_manifests(generation_request_id,account_id,
    workspace_id,project_id,project_revision_id,asset_id,reservation_id,manifest_sha256,manifest_document,
    object_key,content_length,receipt_sha256)
  SELECT supplied_generation_request_id,supplied_account_id,supplied_workspace_id,request.project_id,
    request.project_revision_id,asset_id,reservation_id,supplied_manifest_sha256,supplied_manifest,
    supplied_object_key,supplied_content_length,receipt_hash
  FROM public.generation_requests request WHERE request.id=supplied_generation_request_id;
  RETURN jsonb_build_object('schemaVersion','videoforge.hosted-v209-resolved-render-manifest/v1',
    'replayed',false,'artifact',jsonb_build_object('assetId',asset_id,'receiptId',receipt_id,
      'objectKey',supplied_object_key,'contentType','application/json','contentLength',supplied_content_length,
      'sha256',supplied_manifest_sha256,'kind','RESOLVED_RENDER_MANIFEST','lane','RENDER',
      'commitKind','COMMITTED_MANIFEST'));
END;
$$;

CREATE FUNCTION public.videoforge_read_hosted_v209_terminal_lineage(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_attempt_id uuid,
  supplied_lane text, supplied_provider_job_id text
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT jsonb_build_object('schemaVersion','videoforge.hosted-v209-terminal-lineage/v1',
    'binding',jsonb_build_object('accountId',attempt.account_id,'workspaceId',attempt.workspace_id,
      'projectId',attempt.project_id,'projectRevisionId',attempt.project_revision_id,
      'generationRequestId',attempt.generation_request_id,'lane',attempt.lane,'attemptId',attempt.id,
      'providerJobId',assignment.provider_job_id,'dispatchTokenSha256',attempt.dispatch_token_sha256,
      'envelopeSha256',materialized.envelope_sha256,
      'requestSha256','sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
        materialized.request_body-'envelope'),'UTF8')),'hex'),
      'deploymentId',deployment.id,'endpointIdSha256',deployment.endpoint_id_sha256,
      'endpointConfigSha256',deployment.endpoint_config_sha256,
      'workerImageDigest',deployment.worker_image_digest,
      'modelManifestSha256',deployment.model_manifest_sha256,
      'volumeIdSha256',deployment.volume_id_sha256,
      'volumeManifestSha256',deployment.volume_manifest_sha256),
    'deadlineAt',to_char(attempt.deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'requestBody',materialized.request_body,'candidateWork',candidate.candidate_document->'work'->attempt.lane)||
    CASE WHEN accepted.attempt_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('accepted',
      jsonb_build_object('completedAt',to_char(accepted.completed_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'bindingSha256',accepted.binding_sha256,'terminalSha256',accepted.callback_sha256,
        'provenanceReceiptSha256',accepted.provenance_receipt_sha256,
        'artifactCommitReceiptSha256s',accepted.artifact_commit_receipt_sha256s)) END
  FROM public.serverless_attempts attempt
  JOIN public.serverless_provider_assignments assignment ON assignment.account_id=attempt.account_id
    AND assignment.workspace_id=attempt.workspace_id AND assignment.attempt_id=attempt.id
    AND assignment.is_current AND assignment.provider_job_id=supplied_provider_job_id
  JOIN public.serverless_endpoint_deployments deployment ON deployment.id=attempt.deployment_id
    AND deployment.lane=attempt.lane AND deployment.is_active
  JOIN public.hosted_v209_ordinary_lane_materializations materialized
    ON materialized.account_id=attempt.account_id AND materialized.workspace_id=attempt.workspace_id
    AND materialized.attempt_id=attempt.id
  JOIN public.hosted_v209_ordinary_dispatch_candidates candidate
    ON candidate.account_id=attempt.account_id AND candidate.workspace_id=attempt.workspace_id
    AND candidate.generation_request_id=attempt.generation_request_id
  LEFT JOIN public.hosted_serverless_output_barrier_completions accepted
    ON accepted.account_id=attempt.account_id AND accepted.workspace_id=attempt.workspace_id
    AND accepted.attempt_id=attempt.id AND accepted.provider_job_id=assignment.provider_job_id
  WHERE attempt.account_id=supplied_account_id AND attempt.workspace_id=supplied_workspace_id
    AND attempt.id=supplied_attempt_id AND attempt.lane=supplied_lane
    AND (attempt.state IN ('ASSIGNED','IN_QUEUE','IN_PROGRESS','UPLOADING','RECONCILING')
      OR accepted.attempt_id IS NOT NULL)
    AND supplied_lane IN ('mage_image','soulx_avatar')
    AND public.videoforge_current_account_id() IS NOT DISTINCT FROM supplied_account_id
    AND materialized.full_request_sha256='sha256:'||encode(sha256(convert_to(
      public.videoforge_canonical_jsonb(materialized.request_body),'UTF8')),'hex')
    AND jsonb_array_length(candidate.candidate_document->'work'->attempt.lane)=attempt.item_count;
$$;

CREATE FUNCTION public.videoforge_accept_hosted_v209_terminal_output(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_attempt_id uuid,
  supplied_provider_job_id text, supplied_binding_sha256 text, supplied_terminal_sha256 text,
  supplied_receipt jsonb, supplied_artifacts jsonb, supplied_completed_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  attempt public.serverless_attempts%ROWTYPE; assignment public.serverless_provider_assignments%ROWTYPE;
  deployment public.serverless_endpoint_deployments%ROWTYPE;
  materialized public.hosted_v209_ordinary_lane_materializations%ROWTYPE;
  candidate public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  existing public.hosted_serverless_output_barrier_completions%ROWTYPE;
  artifact jsonb; work_item jsonb; receipt_id uuid; receipt_hashes jsonb:='[]'::jsonb;
  canonical_objects jsonb; binding_components jsonb; provenance_id uuid;
  expected_receipt_sha text; artifact_facts jsonb; expected_content_type text;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_binding_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_terminal_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(supplied_receipt)<>'object' OR jsonb_typeof(supplied_artifacts)<>'array'
     OR supplied_completed_at>transaction_timestamp() THEN
    RAISE EXCEPTION 'hosted V2-09 terminal output input invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO attempt FROM public.serverless_attempts a
    WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
      AND a.id=supplied_attempt_id FOR UPDATE;
  SELECT * INTO assignment FROM public.serverless_provider_assignments a
    WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
      AND a.attempt_id=supplied_attempt_id AND a.is_current FOR SHARE;
  SELECT * INTO deployment FROM public.serverless_endpoint_deployments d
    WHERE d.id=attempt.deployment_id AND d.lane=attempt.lane AND d.is_active FOR SHARE;
  SELECT * INTO materialized FROM public.hosted_v209_ordinary_lane_materializations m
    WHERE m.account_id=supplied_account_id AND m.workspace_id=supplied_workspace_id
      AND m.attempt_id=supplied_attempt_id FOR SHARE;
  SELECT * INTO candidate FROM public.hosted_v209_ordinary_dispatch_candidates c
    WHERE c.account_id=supplied_account_id AND c.workspace_id=supplied_workspace_id
      AND c.generation_request_id=attempt.generation_request_id FOR SHARE;
  SELECT * INTO existing FROM public.hosted_serverless_output_barrier_completions b
    WHERE b.attempt_id=supplied_attempt_id;
  IF existing.attempt_id IS NOT NULL THEN
    IF existing.account_id<>supplied_account_id OR existing.workspace_id<>supplied_workspace_id
       OR existing.provider_job_id<>supplied_provider_job_id
       OR existing.binding_sha256<>supplied_binding_sha256
       OR existing.callback_sha256<>supplied_terminal_sha256
       OR existing.provenance_receipt_sha256<>supplied_receipt->>'receipt_sha256' THEN
      RAISE EXCEPTION 'hosted V2-09 terminal output replay drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('state','DUPLICATE_IDEMPOTENT',
      'artifactCommitReceiptSha256s',existing.artifact_commit_receipt_sha256s);
  END IF;
  IF attempt.id IS NULL OR assignment.id IS NULL OR deployment.id IS NULL OR materialized.attempt_id IS NULL
     OR candidate.generation_request_id IS NULL
     OR assignment.provider_job_id<>supplied_provider_job_id
     OR attempt.state NOT IN ('ASSIGNED','IN_QUEUE','IN_PROGRESS','UPLOADING','RECONCILING')
     OR supplied_completed_at>=attempt.deadline_at
     OR materialized.full_request_sha256<>'sha256:'||encode(sha256(convert_to(
       public.videoforge_canonical_jsonb(materialized.request_body),'UTF8')),'hex')
     OR jsonb_array_length(supplied_artifacts)<>attempt.item_count
     OR jsonb_array_length(candidate.candidate_document->'work'->attempt.lane)<>attempt.item_count THEN
    RAISE EXCEPTION 'hosted V2-09 terminal lineage unavailable' USING ERRCODE='23514';
  END IF;
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied_receipt) key)
       IS DISTINCT FROM ARRAY['attempt_id','attestation_scope','deployment','dispatch_token','envelope_sha256',
         'issued_at','items','lane','model_ready_evidence','provider_job_id','receipt_id','receipt_nonce',
         'receipt_sha256','request_sha256','runtime_probe','schema_version','scratch_cleanup','signature',
         'tenant','timings','volume_verification','worker_id']::text[]
     OR supplied_receipt->>'schema_version'<>'serverless-provenance-receipt/v1'
     OR supplied_receipt->>'attestation_scope'<>'VIDEOFORGE_APPLICATION_SIGNED_FACTS_NOT_PROVIDER_HARDWARE_ATTESTATION'
     OR supplied_receipt->>'attempt_id'<>attempt.id::text OR supplied_receipt->>'lane'<>attempt.lane
     OR supplied_receipt->>'provider_job_id'<>assignment.provider_job_id
     OR supplied_receipt#>>'{tenant,account_id}'<>attempt.account_id::text
     OR supplied_receipt#>>'{tenant,workspace_id}'<>attempt.workspace_id::text
     OR supplied_receipt->>'envelope_sha256'<>materialized.envelope_sha256
     OR supplied_receipt->>'request_sha256'<>'sha256:'||encode(sha256(convert_to(
       public.videoforge_canonical_jsonb(materialized.request_body-'envelope'),'UTF8')),'hex')
     OR supplied_receipt#>>'{deployment,deployment_id}'<>deployment.id::text
     OR supplied_receipt#>>'{deployment,endpoint_id_sha256}'<>deployment.endpoint_id_sha256
     OR supplied_receipt#>>'{deployment,container_digest}'<>deployment.worker_image_digest
     OR supplied_receipt#>>'{deployment,intended_region}'<>deployment.region
     OR supplied_receipt#>>'{deployment,intended_volume_id_sha256}'<>deployment.volume_id_sha256
     OR supplied_receipt#>>'{deployment,model_manifest_sha256}'<>deployment.model_manifest_sha256
     OR NOT (supplied_receipt#>>'{runtime_probe,gpu_name}'=ANY(deployment.gpu_allowlist))
     OR (supplied_receipt#>>'{runtime_probe,gpu_count}')::integer<>1
     OR supplied_receipt#>>'{volume_verification,manifest_sha256_before}'<>deployment.volume_manifest_sha256
     OR supplied_receipt#>>'{volume_verification,manifest_sha256_after}'<>deployment.volume_manifest_sha256
     OR (supplied_receipt#>>'{volume_verification,mutation_detected}')::boolean
     OR (supplied_receipt#>>'{volume_verification,cross_mount_detected}')::boolean
     OR supplied_receipt#>>'{model_ready_evidence,state}'<>'MODEL_READY'
     OR (supplied_receipt#>>'{model_ready_evidence,warmup_completed}')::boolean IS DISTINCT FROM true
     OR (supplied_receipt#>>'{scratch_cleanup,removed}')::boolean IS DISTINCT FROM true
     OR (supplied_receipt#>>'{scratch_cleanup,scratch_on_model_volume}')::boolean IS DISTINCT FROM false
     OR supplied_receipt->>'receipt_sha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_receipt#>>'{signature,algorithm}'<>'HMAC-SHA256'
     OR supplied_receipt#>>'{signature,key_id}' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'
     OR supplied_receipt#>>'{signature,value}' !~ '^[0-9a-f]{64}$'
     OR jsonb_array_length(supplied_receipt->'items')<>attempt.item_count THEN
    RAISE EXCEPTION 'hosted V2-09 terminal receipt lineage mismatch' USING ERRCODE='23514';
  END IF;
  expected_content_type:=CASE attempt.lane WHEN 'mage_image' THEN 'image/png' ELSE 'video/mp4' END;
  FOR artifact IN SELECT value FROM jsonb_array_elements(supplied_artifacts) value LOOP
    IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(artifact) key)
         IS DISTINCT FROM ARRAY['callback_id','checksum_sha256','content_length','content_type','expires_at',
           'item_id','object_key','probe','receipt_id','receipt_sha256','reservation_id']::text[]
       OR artifact->>'reservation_id' !~ '^[0-9a-f-]{36}$'
       OR artifact->>'receipt_id' !~ '^[0-9a-f-]{36}$'
       OR artifact->>'item_id' !~ '^[0-9a-f-]{36}$'
       OR artifact->>'checksum_sha256' !~ '^sha256:[0-9a-f]{64}$'
       OR artifact->>'receipt_sha256' !~ '^sha256:[0-9a-f]{64}$'
       OR artifact->>'content_type'<>expected_content_type
       OR (artifact->>'content_length')::bigint NOT BETWEEN 1 AND
         (CASE attempt.lane WHEN 'mage_image' THEN 16777216 ELSE 134217728 END)
       OR (artifact->>'expires_at')::timestamptz<>attempt.deadline_at
       OR artifact->>'object_key'<>attempt.output_prefix||'/artifact/'||artifact->>'item_id'
       OR jsonb_typeof(artifact->'probe')<>'object' THEN
      RAISE EXCEPTION 'hosted V2-09 terminal artifact invalid' USING ERRCODE='23514';
    END IF;
    SELECT value INTO work_item FROM jsonb_array_elements(candidate.candidate_document->'work'->attempt.lane) value
      WHERE value->>'taskId'=artifact->>'item_id' AND value->>'outputReservationId'=artifact->>'reservation_id';
    IF work_item IS NULL OR work_item->>'outputPrefix'<>attempt.output_prefix
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(supplied_receipt->'items') item
         WHERE item->>'item_id'=artifact->>'item_id' AND item->>'state'='SUCCEEDED'
           AND item->>'output_object_key'=artifact->>'object_key'
           AND item->>'output_sha256'=artifact->>'checksum_sha256'
           AND (item->>'output_bytes')::bigint=(artifact->>'content_length')::bigint
           AND item->'probe'=artifact->'probe') THEN
      RAISE EXCEPTION 'hosted V2-09 terminal artifact work mismatch' USING ERRCODE='23514';
    END IF;
    artifact_facts:=jsonb_build_object('schema_version','artifact-commit-receipt/v3',
      'receipt_id',artifact->>'receipt_id','reservation_id',artifact->>'reservation_id',
      'account_id',attempt.account_id,'workspace_id',attempt.workspace_id,
      'object_key',artifact->>'object_key','callback_id',artifact->>'callback_id',
      'content_type',artifact->>'content_type','content_length',(artifact->>'content_length')::bigint,
      'checksum_sha256',artifact->>'checksum_sha256','probe',artifact->'probe',
      'retention_class','PROJECT','retain_until',NULL,'committed_at',
      to_char(supplied_completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    expected_receipt_sha:='sha256:'||encode(sha256(convert_to(
      public.videoforge_canonical_jsonb(artifact_facts),'UTF8')),'hex');
    IF artifact->>'receipt_sha256'<>expected_receipt_sha THEN
      RAISE EXCEPTION 'hosted V2-09 artifact receipt hash mismatch' USING ERRCODE='23514';
    END IF;
    INSERT INTO public.artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,
      lane,job_id,artifact_id,object_key,method,content_type,content_length,checksum_sha256,expires_at,
      max_uses,used_count,state,retention_class,retain_until,deletion_owner_account_id)
    VALUES((artifact->>'reservation_id')::uuid,attempt.account_id,attempt.workspace_id,attempt.project_id,
      attempt.project_revision_id,CASE attempt.lane WHEN 'mage_image' THEN 'MAGE_IMAGE' ELSE 'SOULX_AVATAR' END,
      attempt.id::text,artifact->>'item_id',artifact->>'object_key','PUT',artifact->>'content_type',
      (artifact->>'content_length')::bigint,artifact->>'checksum_sha256',attempt.deadline_at,
      1,1,'COMMITTED','PROJECT',NULL,attempt.account_id) ON CONFLICT(id) DO NOTHING;
    INSERT INTO public.artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,
      content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at)
    VALUES((artifact->>'receipt_id')::uuid,attempt.account_id,attempt.workspace_id,
      (artifact->>'reservation_id')::uuid,artifact->>'callback_id',artifact->>'object_key',
      artifact->>'content_type',(artifact->>'content_length')::bigint,artifact->>'checksum_sha256',
      artifact->'probe',artifact->>'receipt_sha256',supplied_completed_at)
    ON CONFLICT(account_id,workspace_id,reservation_id) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM public.artifact_receipts receipt
      WHERE receipt.account_id=attempt.account_id AND receipt.workspace_id=attempt.workspace_id
        AND receipt.reservation_id=(artifact->>'reservation_id')::uuid
        AND receipt.receipt_sha256=artifact->>'receipt_sha256') THEN
      RAISE EXCEPTION 'hosted V2-09 terminal artifact replay drift' USING ERRCODE='23505';
    END IF;
    receipt_hashes:=receipt_hashes||jsonb_build_array(artifact->>'receipt_sha256');
  END LOOP;
  provenance_id:=md5('hosted-v209-provenance:'||supplied_receipt->>'receipt_sha256')::uuid;
  INSERT INTO public.serverless_provenance_receipts(id,account_id,workspace_id,project_revision_id,
    attempt_id,assignment_id,receipt_nonce,attestation_scope,worker_id,provider_job_id,gpu_name,
    gpu_uuid_sha256,driver_version,cuda_version,intended_region,intended_volume_id_sha256,
    manifest_sha256_before,manifest_sha256_after,mutation_detected,cross_mount_detected,model_ready,
    timings,items,receipt_sha256,signature_key_id,signature_value,issued_at,accepted_at,
    peak_vram_bytes,scratch_removed,scratch_on_model_volume)
  VALUES(provenance_id,attempt.account_id,attempt.workspace_id,attempt.project_revision_id,attempt.id,
    assignment.id,(supplied_receipt->>'receipt_nonce')::bigint,supplied_receipt->>'attestation_scope',
    supplied_receipt->>'worker_id',assignment.provider_job_id,supplied_receipt#>>'{runtime_probe,gpu_name}',
    NULLIF(supplied_receipt#>>'{runtime_probe,gpu_uuid_sha256}',''),
    supplied_receipt#>>'{runtime_probe,driver_version}',supplied_receipt#>>'{runtime_probe,cuda_version}',
    deployment.region,deployment.volume_id_sha256,deployment.volume_manifest_sha256,
    deployment.volume_manifest_sha256,false,false,true,supplied_receipt->'timings',supplied_receipt->'items',
    supplied_receipt->>'receipt_sha256',supplied_receipt#>>'{signature,key_id}',
    supplied_receipt#>>'{signature,value}',(supplied_receipt->>'issued_at')::timestamptz,supplied_completed_at,
    (supplied_receipt#>>'{runtime_probe,peak_vram_bytes}')::bigint,true,false);
  SELECT jsonb_agg(jsonb_build_object('item_id',artifact->>'item_id','object_key',artifact->>'object_key',
      'content_type',artifact->>'content_type','content_length',(artifact->>'content_length')::bigint,
      'checksum_sha256',artifact->>'checksum_sha256')
      ORDER BY artifact->>'item_id' COLLATE "C") INTO canonical_objects
    FROM jsonb_array_elements(supplied_artifacts) artifact;
  binding_components:=jsonb_build_object('account_id',attempt.account_id,'workspace_id',attempt.workspace_id,
    'project_id',attempt.project_id,'project_revision_id',attempt.project_revision_id,'lane',attempt.lane,
    'attempt_id',attempt.id,'provider_job_id',assignment.provider_job_id,
    'dispatch_token_sha256',attempt.dispatch_token_sha256,'deployment_id',deployment.id,
    'envelope_sha256',materialized.envelope_sha256,
    'request_sha256','sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
      materialized.request_body-'envelope'),'UTF8')),'hex'),
    'endpoint_id_sha256',deployment.endpoint_id_sha256,'endpoint_config_sha256',deployment.endpoint_config_sha256,
    'worker_image_digest',deployment.worker_image_digest,'model_manifest_sha256',deployment.model_manifest_sha256,
    'volume_id_sha256',deployment.volume_id_sha256,'volume_manifest_sha256',deployment.volume_manifest_sha256,
    'expected_objects',canonical_objects);
  SELECT jsonb_agg(value ORDER BY value COLLATE "C") INTO receipt_hashes
    FROM jsonb_array_elements_text(receipt_hashes) value;
  IF supplied_binding_sha256<>'sha256:'||encode(sha256(convert_to(
       public.videoforge_canonical_jsonb(binding_components),'UTF8')),'hex')
     OR supplied_terminal_sha256<>'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
       jsonb_build_object('schema_version','videoforge-hosted-serverless-terminal-output/v1',
         'transport_status','COMPLETED','provenance_receipt_sha256',supplied_receipt->>'receipt_sha256',
         'artifact_commit_receipt_sha256s',receipt_hashes)),'UTF8')),'hex') THEN
    RAISE EXCEPTION 'hosted V2-09 terminal binding hash mismatch' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.hosted_serverless_output_barrier_completions(attempt_id,account_id,workspace_id,
    project_id,project_revision_id,lane,assignment_id,provider_job_id,dispatch_token_sha256,deployment_id,
    endpoint_id_sha256,endpoint_config_sha256,worker_image_digest,model_manifest_sha256,volume_id_sha256,
    volume_manifest_sha256,region,gpu_allowlist,expected_objects,binding_components,binding_sha256,
    callback_sha256,provenance_receipt_sha256,artifact_commit_receipt_sha256s,completed_at)
  VALUES(attempt.id,attempt.account_id,attempt.workspace_id,attempt.project_id,attempt.project_revision_id,
    attempt.lane,assignment.id,assignment.provider_job_id,attempt.dispatch_token_sha256,deployment.id,
    deployment.endpoint_id_sha256,deployment.endpoint_config_sha256,deployment.worker_image_digest,
    deployment.model_manifest_sha256,deployment.volume_id_sha256,deployment.volume_manifest_sha256,
    deployment.region,deployment.gpu_allowlist,canonical_objects,binding_components,supplied_binding_sha256,
    supplied_terminal_sha256,supplied_receipt->>'receipt_sha256',receipt_hashes,supplied_completed_at);
  RETURN jsonb_build_object('state','LANE_COMPLETED','artifactCommitReceiptSha256s',receipt_hashes);
END;
$$;

CREATE FUNCTION public.videoforge_materialize_hosted_v209_span_audio_jobs(
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
      AND task.project_revision_id=s.project_revision_id AND task.task_key=s.task_key
      AND task.lane='AVATAR' AND task.state='BLOCKED'
    WHERE s.account_id=supplied_account_id AND s.workspace_id=supplied_workspace_id
      AND s.project_revision_id=revision.id AND s.timeline_plan_id=head.current_timeline_plan_id
      AND s.transcript_id=head.current_transcript_id AND s.state='PLANNED'
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

CREATE FUNCTION public.videoforge_finalize_hosted_v209_span_audio(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_attempt_id uuid,
  supplied_result_document jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  materialized public.hosted_v209_span_audio_materializations%ROWTYPE;
  attempt public.hosted_cpu_job_attempts%ROWTYPE;
  authority public.hosted_cpu_upload_authorities%ROWTYPE;
  span public.selected_span_audio%ROWTYPE; existing_asset public.assets%ROWTYPE;
  input_document jsonb; audio jsonb; result_sha text; expected_uri text;
  padded_samples bigint; trim_start_samples bigint; trim_end_samples bigint;
  output_reservation_id uuid; output_receipt_id uuid; output_receipt_sha text; receipt_facts jsonb;
  pair_ready boolean; db_now timestamptz:=transaction_timestamp();
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
  IF materialized.attempt_id IS NULL OR attempt.id IS NULL OR attempt.kind<>'SPAN_AUDIO'
     OR attempt.execution_backend<>'PERSONAL_WORKER' OR attempt.state<>'SUCCEEDED'
     OR attempt.request_sha256<>materialized.submission_sha256
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
       (input_document->'source_voiceover'-'artifact_uri')
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
  SELECT * INTO authority FROM public.hosted_cpu_upload_authorities u
    WHERE u.account_id=supplied_account_id AND u.workspace_id=supplied_workspace_id
      AND u.attempt_id=supplied_attempt_id AND u.source='PRIMARY_RESULT_OUTPUT' FOR SHARE;
  IF authority.id IS NULL OR authority.content_type<>'audio/wav' OR authority.issued_at IS NULL
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
    materialized.span_id::text,authority.object_key,'PUT','audio/wav',(audio->>'byte_size')::bigint,
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
      AND reservation.id=output_reservation_id AND reservation.asset_id=materialized.output_asset_id
      AND reservation.state='COMMITTED') THEN
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

REVOKE ALL ON TABLE public.hosted_v209_span_audio_materializations FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_v209_ordinary_resolved_render_manifests FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_hosted_v209_span_uuid(text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_materialize_hosted_v209_span_audio_jobs(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_finalize_hosted_v209_span_audio(uuid,uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_v209_terminal_lineage(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_accept_hosted_v209_terminal_output(uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_commit_hosted_v209_resolved_render_manifest(uuid,uuid,uuid,jsonb,text,text,bigint) FROM PUBLIC;
