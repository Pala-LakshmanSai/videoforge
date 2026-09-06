-- Fail closed on the exact V2-09 ordinary SoulX avatar before any cost observation or paid seam.
-- Historical 0074-0080 bytes remain immutable; the public entry points are wrapped below.

CREATE FUNCTION public.videoforge_assert_hosted_v209_ordinary_avatar_source(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_generation_request_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  exact_source_sha constant text:=
    'sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83';
  exact_model_profile constant text:='serverless-soulx-flashhead-pro-v1';
  target record; assessment record; candidate record;
  binding jsonb; config_evidence jsonb;
  projection jsonb; receipt_facts jsonb; receipt_sha text;
  exact_receipt_count integer; invalid_work_count integer;
  config_assessed_at timestamptz;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary avatar tenant mismatch' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_generation_request_id::text,41));
  SELECT request.id generation_request_id,request.project_id,revision.*,
      asset.object_key avatar_object_key,asset.content_type avatar_content_type,
      asset.byte_size avatar_byte_size,asset.width_px avatar_width_px,
      asset.height_px avatar_height_px,asset.binary_sha256 avatar_asset_sha256
    INTO target
    FROM public.generation_requests request
    JOIN public.project_revisions revision ON revision.account_id=request.account_id
      AND revision.workspace_id=request.workspace_id AND revision.id=request.project_revision_id
      AND revision.project_id=request.project_id
    JOIN public.assets asset ON asset.account_id=revision.account_id
      AND asset.workspace_id=revision.workspace_id
      AND asset.id=revision.avatar_runtime_source_asset_id
      AND asset.kind='AVATAR_RUNTIME' AND asset.state IN ('VERIFIED','ACCEPTED')
   WHERE request.id=supplied_generation_request_id
     AND request.account_id=supplied_account_id AND request.workspace_id=supplied_workspace_id
     AND request.state='ACTIVE' AND request.terminal_at IS NULL
   FOR SHARE OF request,revision,asset;
  IF target.generation_request_id IS NULL OR target.status<>'LOCKED'
     OR target.avatar_runtime_source_binary_sha256<>exact_source_sha
     OR target.avatar_asset_sha256<>exact_source_sha
     OR target.avatar_content_type<>'image/png' OR target.avatar_byte_size<>1912005
     OR target.avatar_width_px<>1672 OR target.avatar_height_px<>941 THEN
    RAISE EXCEPTION 'hosted V2-09 exact PNG SoulX avatar source unavailable'
      USING ERRCODE='23514';
  END IF;
  IF target.revision_config_contract_name<>'project-revision-config'
     OR target.revision_config_contract_version<>'v2'
     OR target.revision_config_payload->>'schema_version' IS DISTINCT FROM 'project-revision-config/v2'
     OR target.revision_config_hash<>'sha256:'||encode(sha256(convert_to(
       public.videoforge_canonical_jsonb(target.revision_config_payload),'UTF8')),'hex')
     OR target.revision_config_payload->>'project_id' IS DISTINCT FROM target.project_id::text
     OR target.revision_config_payload->>'project_revision_id' IS DISTINCT FROM target.id::text
     OR target.revision_config_payload->'execution_profiles' IS DISTINCT FROM jsonb_build_object(
       'image_media_profile_id','serverless-mage-image-v1',
       'avatar_primary_profile_id',exact_model_profile,
       'avatar_repair_profile_id',NULL,'avatar_quality_profile_id',NULL) THEN
    RAISE EXCEPTION 'hosted V2-09 revision configuration identity drifted'
      USING ERRCODE='23514';
  END IF;
  binding:=target.revision_config_payload->'avatar_binding';
  IF jsonb_typeof(binding) IS DISTINCT FROM 'object'
     OR binding->>'avatar_profile_id' IS DISTINCT FROM target.avatar_profile_id::text
     OR binding->>'avatar_profile_version_id' IS DISTINCT FROM target.avatar_profile_version_id::text
     OR binding->>'avatar_profile_hash' IS DISTINCT FROM target.avatar_profile_hash
     OR binding->>'runtime_source_asset_id' IS DISTINCT FROM target.avatar_runtime_source_asset_id::text
     OR binding->>'runtime_source_sha256' IS DISTINCT FROM target.avatar_runtime_source_binary_sha256
     OR binding->>'source_preparation_version' IS DISTINCT FROM target.avatar_source_preparation_profile
     OR binding->>'source_validation_profile_version'
          IS DISTINCT FROM target.avatar_source_validation_profile
     OR binding->>'compatibility_state_at_preflight'
          IS DISTINCT FROM target.avatar_compatibility_state THEN
    RAISE EXCEPTION 'hosted V2-09 relational and configuration avatar snapshots differ'
      USING ERRCODE='23514';
  END IF;
  config_evidence:=binding->'compatibility_evidence';
  IF target.avatar_compatibility_state='FAILED' THEN
    RAISE EXCEPTION 'hosted V2-09 avatar is known incompatible with SoulX'
      USING ERRCODE='23514';
  END IF;
  IF target.avatar_compatibility_state IN ('UNTESTED','RUNNING') THEN
    IF target.avatar_compatibility_assessment_id IS NOT NULL
       OR target.avatar_compatibility_evidence_hash IS NOT NULL
       OR config_evidence IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'hosted V2-09 nonterminal avatar compatibility has evidence'
        USING ERRCODE='23514';
    END IF;
  ELSIF target.avatar_compatibility_state IN ('PASSED','FAILED','STALE','CANCELLED') THEN
    SELECT compatibility.*,profile.name execution_profile_name,profile.lane execution_profile_lane,
        profile.state execution_profile_state,profile.dispatch_target execution_dispatch_target,
        profile.configuration execution_configuration,
        profile.configuration_hash execution_configuration_hash
      INTO assessment
      FROM public.avatar_compatibility_assessments compatibility
      JOIN public.execution_profiles profile ON profile.account_id=compatibility.account_id
        AND profile.workspace_id=compatibility.workspace_id
        AND profile.id=compatibility.execution_profile_id
     WHERE compatibility.account_id=supplied_account_id
       AND compatibility.workspace_id=supplied_workspace_id
       AND compatibility.id=target.avatar_compatibility_assessment_id
       AND compatibility.avatar_profile_version_id=target.avatar_profile_version_id;
    IF coalesce(config_evidence->>'assessed_at','') !~
         '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$' THEN
      RAISE EXCEPTION 'hosted V2-09 terminal compatibility timestamp is invalid'
        USING ERRCODE='23514';
    END IF;
    BEGIN
      config_assessed_at:=(config_evidence->>'assessed_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'hosted V2-09 terminal compatibility timestamp is invalid'
        USING ERRCODE='23514';
    END;
    IF assessment.id IS NULL OR assessment.state<>target.avatar_compatibility_state
       OR assessment.evidence_hash<>target.avatar_compatibility_evidence_hash
       OR assessment.evidence_payload IS NULL OR assessment.model_snapshot_hash IS NULL
       OR assessment.finished_at IS NULL
       OR assessment.execution_profile_name<>exact_model_profile
       OR assessment.execution_profile_lane<>'AVATAR_PRIMARY'
       OR (target.avatar_compatibility_state='PASSED'
         AND assessment.execution_profile_state<>'TESTED')
       OR (target.avatar_compatibility_state IN ('STALE','CANCELLED')
         AND assessment.execution_profile_state NOT IN ('TESTED','RETIRED'))
       OR assessment.execution_dispatch_target<>'RUNPOD'
       OR assessment.execution_configuration_hash<>'sha256:'||encode(sha256(convert_to(
         public.videoforge_canonical_jsonb(assessment.execution_configuration),'UTF8')),'hex')
       OR jsonb_typeof(config_evidence) IS DISTINCT FROM 'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(config_evidence) key)
            IS DISTINCT FROM ARRAY['assessed_at','assessment_hash','assessment_id',
              'model_profile_id','status']::text[]
       OR config_evidence->>'assessment_id' IS DISTINCT FROM assessment.id::text
       OR config_evidence->>'assessment_hash' IS DISTINCT FROM assessment.evidence_hash
       OR config_evidence->>'status' IS DISTINCT FROM assessment.state
       OR config_evidence->>'model_profile_id' IS DISTINCT FROM assessment.execution_profile_name
       OR config_assessed_at IS DISTINCT FROM assessment.finished_at THEN
      RAISE EXCEPTION 'hosted V2-09 terminal avatar compatibility evidence drifted'
        USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'hosted V2-09 avatar compatibility state is invalid' USING ERRCODE='23514';
  END IF;

  projection:=public.videoforge_read_hosted_v209_system_avatar_projection(
    supplied_account_id,supplied_workspace_id,target.id);
  IF projection IS NULL OR projection->>'sourceScopeKind'<>'SYSTEM'
     OR projection->>'systemSourceReferenceVerified'<>'true' THEN
    RAISE EXCEPTION 'hosted V2-09 exact SYSTEM avatar lineage unavailable'
      USING ERRCODE='23514';
  END IF;
  receipt_facts:=jsonb_build_object(
    'schema_version','videoforge-hosted-v209-system-avatar-reference/v1',
    'account_id',supplied_account_id,'workspace_id',supplied_workspace_id,
    'project_id',target.project_id,'project_revision_id',target.id,
    'generation_request_id',target.generation_request_id,
    'tenant_runtime_source_asset_id',target.avatar_runtime_source_asset_id,
    'system_avatar_profile_id',(projection->>'systemAvatarProfileId')::uuid,
    'system_avatar_profile_version_id',(projection->>'systemAvatarProfileVersionId')::uuid,
    'system_runtime_source_asset_id',(projection->>'systemRuntimeSourceAssetId')::uuid,
    'system_runtime_profile_asset_link_id',(projection->>'systemRuntimeProfileAssetLinkId')::uuid,
    'object_key',target.avatar_object_key,'content_type','image/png',
    'content_length',target.avatar_byte_size,'checksum_sha256',exact_source_sha,
    'reservation_id',public.videoforge_hosted_v209_uuid(
      'input-reservation',target.generation_request_id,'avatar-source'),
    'receipt_id',md5('hosted-v209-system-avatar-receipt:'||target.id::text)::uuid);
  receipt_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(receipt_facts),'UTF8')),'hex');
  SELECT count(*)::integer INTO exact_receipt_count
    FROM public.artifact_reservations reservation
    JOIN public.artifact_receipts receipt ON receipt.account_id=reservation.account_id
      AND receipt.workspace_id=reservation.workspace_id
      AND receipt.reservation_id=reservation.id
   WHERE reservation.account_id=supplied_account_id
     AND reservation.workspace_id=supplied_workspace_id
     AND reservation.id=(receipt_facts->>'reservation_id')::uuid
     AND reservation.project_id=target.project_id
     AND reservation.project_revision_id=target.id
     AND reservation.asset_id=target.avatar_runtime_source_asset_id
     AND reservation.method='GET' AND reservation.lane='INPUT'
     AND reservation.state='COMMITTED' AND reservation.used_count=1 AND reservation.max_uses=1
     AND reservation.object_key=target.avatar_object_key
     AND reservation.content_type='image/png' AND reservation.content_length=target.avatar_byte_size
     AND reservation.checksum_sha256=exact_source_sha
     AND receipt.id=(receipt_facts->>'receipt_id')::uuid
     AND receipt.object_key=reservation.object_key
     AND receipt.content_type=reservation.content_type
     AND receipt.content_length=reservation.content_length
     AND receipt.checksum_sha256=reservation.checksum_sha256
     AND receipt.probe=receipt_facts AND receipt.receipt_sha256=receipt_sha
     AND receipt.deleted_at IS NULL
     AND EXISTS(SELECT 1 FROM public.assets system_source
       WHERE system_source.account_id='ffffffff-ffff-4fff-8fff-000000000001'::uuid
         AND system_source.workspace_id='ffffffff-ffff-4fff-8fff-000000000011'::uuid
         AND system_source.id=(projection->>'systemRuntimeSourceAssetId')::uuid
         AND system_source.kind='AVATAR_RUNTIME'
         AND system_source.state IN ('VERIFIED','ACCEPTED')
         AND system_source.object_key=target.avatar_object_key
         AND system_source.binary_sha256=exact_source_sha
         AND system_source.content_type='image/png' AND system_source.byte_size=1912005
         AND system_source.width_px=1672 AND system_source.height_px=941);
  IF exact_receipt_count<>1 THEN
    RAISE EXCEPTION 'hosted V2-09 exact SYSTEM avatar receipt unavailable'
      USING ERRCODE='23514';
  END IF;

  SELECT candidate_row.* INTO candidate
    FROM public.hosted_v209_ordinary_dispatch_candidates candidate_row
   WHERE candidate_row.account_id=supplied_account_id
     AND candidate_row.workspace_id=supplied_workspace_id
     AND candidate_row.generation_request_id=target.generation_request_id;
  IF candidate.generation_request_id IS NOT NULL THEN
    SELECT count(*)::integer INTO invalid_work_count
      FROM jsonb_array_elements(candidate.candidate_document#>'{work,soulx_avatar}') work_item
     WHERE work_item->>'avatarSourceAssetId' IS DISTINCT FROM target.avatar_runtime_source_asset_id::text
        OR work_item->>'avatarSourceSha256' IS DISTINCT FROM exact_source_sha
        OR work_item->>'avatarSourceObjectKey' IS DISTINCT FROM target.avatar_object_key
        OR work_item->>'avatarSourceContentType' IS DISTINCT FROM 'image/png'
        OR (work_item->>'avatarSourceContentLength')::bigint IS DISTINCT FROM target.avatar_byte_size
        OR work_item->>'avatarSourceInputReservationId' IS DISTINCT FROM
          public.videoforge_hosted_v209_uuid(
            'input-reservation',target.generation_request_id,'avatar-source')::text;
    IF candidate.project_revision_id<>target.id
       OR candidate.candidate_document->>'projectRevisionId' IS DISTINCT FROM target.id::text
       OR candidate.candidate_document->>'generationRequestId'
            IS DISTINCT FROM target.generation_request_id::text
       OR candidate.candidate_document->>'avatarSourceInputReservationId' IS DISTINCT FROM
          public.videoforge_hosted_v209_uuid(
            'input-reservation',target.generation_request_id,'avatar-source')::text
       OR candidate.candidate_sha256<>'sha256:'||encode(sha256(convert_to(
         public.videoforge_canonical_jsonb(candidate.candidate_document),'UTF8')),'hex')
       OR coalesce(jsonb_array_length(candidate.candidate_document#>'{work,soulx_avatar}'),0)<1
       OR invalid_work_count<>0 THEN
      RAISE EXCEPTION 'hosted V2-09 SoulX candidate avatar binding drifted'
        USING ERRCODE='23514';
    END IF;
  END IF;
END;
$$;

ALTER FUNCTION public.videoforge_materialize_hosted_v209_ordinary_dispatch(uuid,uuid,uuid,uuid)
  RENAME TO videoforge_v209_ordinary_materialize_legacy_0081;
ALTER FUNCTION public.videoforge_commit_hosted_v209_ordinary_pair(uuid,uuid,uuid,uuid,jsonb)
  RENAME TO videoforge_v209_ordinary_pair_legacy_0081;
ALTER FUNCTION public.videoforge_load_hosted_v209_ordinary_lane_materialization(uuid,uuid,uuid,text)
  RENAME TO videoforge_v209_ordinary_load_lane_legacy_0081;
ALTER FUNCTION public.videoforge_commit_hosted_v209_ordinary_lane_materialization(
  uuid,uuid,uuid,text,uuid,text,jsonb,text)
  RENAME TO videoforge_v209_ordinary_commit_lane_legacy_0081;
ALTER FUNCTION public.videoforge_begin_hosted_v209_ordinary_send(uuid,uuid,uuid,text,uuid,text,text)
  RENAME TO videoforge_v209_ordinary_begin_send_legacy_0081;

CREATE FUNCTION public.videoforge_materialize_hosted_v209_ordinary_dispatch(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_user_id uuid,supplied_project_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE request_id uuid; result jsonb;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary project scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT request.id INTO request_id FROM public.generation_requests request
   WHERE request.account_id=supplied_account_id AND request.workspace_id=supplied_workspace_id
     AND request.project_id=supplied_project_id AND request.created_by_user_id=supplied_user_id
     AND request.state='ACTIVE' AND request.terminal_at IS NULL
   ORDER BY request.created_at DESC,request.id DESC LIMIT 1;
  IF request_id IS NULL THEN
    RAISE EXCEPTION 'hosted V2-09 active generation request unavailable' USING ERRCODE='23514';
  END IF;
  PERFORM public.videoforge_assert_hosted_v209_ordinary_avatar_source(
    supplied_account_id,supplied_workspace_id,request_id);
  result:=public.videoforge_v209_ordinary_materialize_legacy_0081(
    supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id);
  IF result->>'generationRequestId' IS DISTINCT FROM request_id::text THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary candidate request identity changed'
      USING ERRCODE='40001';
  END IF;
  PERFORM public.videoforge_assert_hosted_v209_ordinary_avatar_source(
    supplied_account_id,supplied_workspace_id,request_id);
  RETURN result;
END;
$$;

CREATE FUNCTION public.videoforge_commit_hosted_v209_ordinary_pair(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_user_id uuid,
  supplied_project_id uuid,supplied_admission jsonb
) RETURNS TABLE(lane text,attempt_id uuid,authority_id uuid,outbox_id uuid,dispatch_token text,
  dispatch_token_sha256 text,unsigned_envelope jsonb,unsigned_envelope_sha256 text,
  request_body_sha256 text,endpoint_id_sha256 text,output_prefix text,authority_sha256 text,
  request_ttl_seconds integer,deadline_at timestamptz,reconciliation_deadline_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE request_id uuid; legacy_row record;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary pair input invalid' USING ERRCODE='42501';
  END IF;
  SELECT request.id INTO request_id FROM public.generation_requests request
   WHERE request.account_id=supplied_account_id AND request.workspace_id=supplied_workspace_id
     AND request.project_id=supplied_project_id AND request.created_by_user_id=supplied_user_id
     AND request.state='ACTIVE' AND request.terminal_at IS NULL
   ORDER BY request.created_at DESC,request.id DESC LIMIT 1;
  PERFORM public.videoforge_assert_hosted_v209_ordinary_avatar_source(
    supplied_account_id,supplied_workspace_id,request_id);
  FOR legacy_row IN SELECT * FROM public.videoforge_v209_ordinary_pair_legacy_0081(
    supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id,supplied_admission)
  LOOP
    IF NOT EXISTS(SELECT 1 FROM public.serverless_attempts attempt
      WHERE attempt.id=legacy_row.attempt_id AND attempt.account_id=supplied_account_id
        AND attempt.workspace_id=supplied_workspace_id
        AND attempt.generation_request_id=request_id) THEN
      RAISE EXCEPTION 'hosted V2-09 ordinary pair request identity changed'
        USING ERRCODE='40001';
    END IF;
    lane:=legacy_row.lane;attempt_id:=legacy_row.attempt_id;authority_id:=legacy_row.authority_id;
    outbox_id:=legacy_row.outbox_id;dispatch_token:=legacy_row.dispatch_token;
    dispatch_token_sha256:=legacy_row.dispatch_token_sha256;
    unsigned_envelope:=legacy_row.unsigned_envelope;
    unsigned_envelope_sha256:=legacy_row.unsigned_envelope_sha256;
    request_body_sha256:=legacy_row.request_body_sha256;
    endpoint_id_sha256:=legacy_row.endpoint_id_sha256;output_prefix:=legacy_row.output_prefix;
    authority_sha256:=legacy_row.authority_sha256;
    request_ttl_seconds:=legacy_row.request_ttl_seconds;deadline_at:=legacy_row.deadline_at;
    reconciliation_deadline_at:=legacy_row.reconciliation_deadline_at;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE FUNCTION public.videoforge_load_hosted_v209_ordinary_lane_materialization(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid,
  supplied_lane text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  PERFORM public.videoforge_assert_hosted_v209_ordinary_avatar_source(
    supplied_account_id,supplied_workspace_id,supplied_generation_request_id);
  RETURN public.videoforge_v209_ordinary_load_lane_legacy_0081(
    supplied_account_id,supplied_workspace_id,supplied_generation_request_id,supplied_lane);
END;
$$;

CREATE FUNCTION public.videoforge_commit_hosted_v209_ordinary_lane_materialization(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid,
  supplied_lane text,supplied_expected_attempt_id uuid,supplied_expected_envelope_sha256 text,
  supplied_request_body jsonb,supplied_request_body_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  PERFORM public.videoforge_assert_hosted_v209_ordinary_avatar_source(
    supplied_account_id,supplied_workspace_id,supplied_generation_request_id);
  RETURN public.videoforge_v209_ordinary_commit_lane_legacy_0081(
    supplied_account_id,supplied_workspace_id,supplied_generation_request_id,supplied_lane,
    supplied_expected_attempt_id,supplied_expected_envelope_sha256,supplied_request_body,
    supplied_request_body_sha256);
END;
$$;

CREATE FUNCTION public.videoforge_begin_hosted_v209_ordinary_send(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid,
  supplied_lane text,supplied_expected_attempt_id uuid,supplied_expected_envelope_sha256 text,
  supplied_expected_request_body_sha256 text
) RETURNS TABLE(lane text,attempt_id uuid,dispatch_token text,dispatch_token_sha256 text,
  endpoint_id_sha256 text,request_body_sha256 text,deployment_id uuid,phase text,
  expected_envelope_sha256 text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  PERFORM public.videoforge_assert_hosted_v209_ordinary_avatar_source(
    supplied_account_id,supplied_workspace_id,supplied_generation_request_id);
  RETURN QUERY SELECT * FROM public.videoforge_v209_ordinary_begin_send_legacy_0081(
    supplied_account_id,supplied_workspace_id,supplied_generation_request_id,supplied_lane,
    supplied_expected_attempt_id,supplied_expected_envelope_sha256,
    supplied_expected_request_body_sha256);
END;
$$;

DO $revoke_legacy$
DECLARE target_function oid; grantee_oid oid; target_signature text;
BEGIN
  FOREACH target_signature IN ARRAY ARRAY[
    'public.videoforge_v209_ordinary_materialize_legacy_0081(uuid,uuid,uuid,uuid)',
    'public.videoforge_v209_ordinary_pair_legacy_0081(uuid,uuid,uuid,uuid,jsonb)',
    'public.videoforge_v209_ordinary_load_lane_legacy_0081(uuid,uuid,uuid,text)',
    'public.videoforge_v209_ordinary_commit_lane_legacy_0081(uuid,uuid,uuid,text,uuid,text,jsonb,text)',
    'public.videoforge_v209_ordinary_begin_send_legacy_0081(uuid,uuid,uuid,text,uuid,text,text)'
  ] LOOP
    target_function:=target_signature::regprocedure::oid;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',target_signature);
    FOR grantee_oid IN
      SELECT DISTINCT acl.grantee FROM pg_catalog.pg_proc procedure,
        LATERAL aclexplode(coalesce(procedure.proacl,acldefault('f',procedure.proowner))) acl
       WHERE procedure.oid=target_function AND acl.grantee<>0
         AND acl.grantee<>procedure.proowner AND acl.privilege_type='EXECUTE'
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',target_signature,
        pg_catalog.pg_get_userbyid(grantee_oid));
    END LOOP;
  END LOOP;
END
$revoke_legacy$;

REVOKE ALL ON FUNCTION public.videoforge_assert_hosted_v209_ordinary_avatar_source(uuid,uuid,uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_materialize_hosted_v209_ordinary_dispatch(uuid,uuid,uuid,uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_commit_hosted_v209_ordinary_pair(uuid,uuid,uuid,uuid,jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_v209_ordinary_lane_materialization(uuid,uuid,uuid,text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_commit_hosted_v209_ordinary_lane_materialization(
  uuid,uuid,uuid,text,uuid,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_begin_hosted_v209_ordinary_send(
  uuid,uuid,uuid,text,uuid,text,text) FROM PUBLIC;

-- Advance both production activation loaders through the fail-closed V2-09 avatar guard.

CREATE OR REPLACE FUNCTION public.videoforge_load_hosted_pair_activation_v2(uuid,uuid,uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE snapshot jsonb;
BEGIN
  snapshot:=public.videoforge_load_hosted_pair_activation($1,$2,$3);
  RETURN jsonb_set(snapshot,'{migrationLedger}',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'version',m.version,'sha256',m.sha256) ORDER BY m.version) FROM public.videoforge_schema_migrations m
    WHERE m.version BETWEEN 37 AND 81),'[]'::jsonb));
END; $$;

CREATE OR REPLACE FUNCTION public.videoforge_load_hosted_gpu_activation_v2() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  activation public.hosted_v209_qualified_activations%ROWTYPE;
  mage_d public.serverless_endpoint_deployments%ROWTYPE;
  soulx_d public.serverless_endpoint_deployments%ROWTYPE;
  mage_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  soulx_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  ledger jsonb; gate jsonb; evidence jsonb; evidence_hash text; gate_hash text;
  verification_expiry timestamptz;
BEGIN
  SELECT * INTO activation FROM public.hosted_v209_qualified_activations
    WHERE observed_at<=db_now AND observed_at>=db_now-interval '5 minutes'
    ORDER BY imported_at DESC LIMIT 1;
  IF activation.id IS NULL THEN
    RAISE EXCEPTION 'hosted GPU activation v2 unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO mage_d FROM public.serverless_endpoint_deployments WHERE id=activation.mage_deployment_id;
  SELECT * INTO soulx_d FROM public.serverless_endpoint_deployments WHERE id=activation.soulx_deployment_id;
  SELECT * INTO mage_q FROM public.hosted_serverless_qualification_attestations WHERE id=activation.mage_qualification_id;
  SELECT * INTO soulx_q FROM public.hosted_serverless_qualification_attestations WHERE id=activation.soulx_qualification_id;
  IF NOT mage_d.is_active OR NOT soulx_d.is_active OR mage_d.worker_count_min<>0
     OR soulx_d.worker_count_min<>0 OR mage_d.worker_count_max<>1 OR soulx_d.worker_count_max<>1
     OR mage_d.handler_concurrency<>1 OR soulx_d.handler_concurrency<>1
     OR mage_d.region<>'EU-RO-1' OR soulx_d.region<>'EU-RO-1'
     OR mage_d.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
     OR soulx_d.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
     OR mage_q.expires_at<=db_now OR soulx_q.expires_at<=db_now
     OR mage_q.deployment_snapshot_sha256<>
        public.videoforge_hosted_deployment_snapshot_sha256(mage_d.id)
     OR soulx_q.deployment_snapshot_sha256<>
        public.videoforge_hosted_deployment_snapshot_sha256(soulx_d.id)
     OR NOT mage_q.independent_audit_accepted OR NOT soulx_q.independent_audit_accepted THEN
    RAISE EXCEPTION 'hosted GPU activation v2 drifted' USING ERRCODE='23514';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('version',version,'sha256',sha256) ORDER BY version)
    INTO ledger FROM public.videoforge_schema_migrations WHERE version BETWEEN 37 AND 81;
  gate:=jsonb_build_object('gpuTransport','QUALIFIED_EXACT','migrationLedger',ledger,
    'now',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cloudflare',jsonb_build_object('sourceCommit',activation.source_commit,
      'versionIdSha256',activation.cloudflare_version_id_sha256,
      'deployedConfigSha256',activation.deployed_config_sha256,
      'readbackSha256',activation.readback_sha256,
      'observedAt',to_char(activation.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'qualifications',jsonb_build_object(
      'mage_image',jsonb_build_object('accepted',true,
        'verifiedAt',to_char(mage_q.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt',to_char(mage_q.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'qualificationRecordSha256',mage_q.qualification_record_sha256,
        'deploymentSnapshotSha256',mage_q.deployment_snapshot_sha256),
      'soulx_avatar',jsonb_build_object('accepted',true,
        'verifiedAt',to_char(soulx_q.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt',to_char(soulx_q.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'qualificationRecordSha256',soulx_q.qualification_record_sha256,
        'deploymentSnapshotSha256',soulx_q.deployment_snapshot_sha256)),
    'deployments',jsonb_build_object(
      'mage_image',jsonb_build_object('deploymentId',mage_d.id,'endpointIdSha256',mage_d.endpoint_id_sha256,
        'endpointConfigSha256',mage_d.endpoint_config_sha256,'workerImageDigest',mage_d.worker_image_digest,
        'modelManifestSha256',mage_d.model_manifest_sha256,'volumeIdSha256',mage_d.volume_id_sha256,
        'volumeManifestSha256',mage_d.volume_manifest_sha256,'region',mage_d.region,
        'gpuAllowlist',mage_d.gpu_allowlist,'deploymentSnapshotSha256',mage_q.deployment_snapshot_sha256,
        'authority',jsonb_build_object('endpointConfigSha256',mage_d.endpoint_config_sha256,
          'endpointIdSha256',mage_d.endpoint_id_sha256,'gpuAllowlist',mage_d.gpu_allowlist,
          'modelManifestSha256',mage_d.model_manifest_sha256,'region',mage_d.region,
          'volumeIdSha256',mage_d.volume_id_sha256,'volumeManifestSha256',mage_d.volume_manifest_sha256,
          'workerImageDigest',mage_d.worker_image_digest)),
      'soulx_avatar',jsonb_build_object('deploymentId',soulx_d.id,'endpointIdSha256',soulx_d.endpoint_id_sha256,
        'endpointConfigSha256',soulx_d.endpoint_config_sha256,'workerImageDigest',soulx_d.worker_image_digest,
        'modelManifestSha256',soulx_d.model_manifest_sha256,'volumeIdSha256',soulx_d.volume_id_sha256,
        'volumeManifestSha256',soulx_d.volume_manifest_sha256,'region',soulx_d.region,
        'gpuAllowlist',soulx_d.gpu_allowlist,'deploymentSnapshotSha256',soulx_q.deployment_snapshot_sha256,
        'authority',jsonb_build_object('endpointConfigSha256',soulx_d.endpoint_config_sha256,
          'endpointIdSha256',soulx_d.endpoint_id_sha256,'gpuAllowlist',soulx_d.gpu_allowlist,
          'modelManifestSha256',soulx_d.model_manifest_sha256,'region',soulx_d.region,
          'volumeIdSha256',soulx_d.volume_id_sha256,'volumeManifestSha256',soulx_d.volume_manifest_sha256,
          'workerImageDigest',soulx_d.worker_image_digest))),
    'paidApproval',jsonb_build_object('approved',true,'exact',true,
      'expiresAt',to_char(least(mage_q.expires_at,soulx_q.expires_at) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'bindings',jsonb_build_object('runtimeDatabase','VIDEOFORGE_RUNTIME_DATABASE',
      'reconcilerDatabase','VIDEOFORGE_RECONCILER_DATABASE',
      'dispatchTokenKey','VIDEOFORGE_DISPATCH_TOKEN_KEY',
      'envelopeSignerKey','VIDEOFORGE_ENVELOPE_SIGNING_KEY',
      'providerProofVerifierKey','VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY',
      'workflowOperatorToken','VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN'));
  gate_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(gate),'UTF8')),'hex');
  evidence:=activation.evidence_document||jsonb_build_object(
    'enabledConfigSha256',activation.deployed_config_sha256);
  evidence_hash:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(evidence),'UTF8')),'hex');
  verification_expiry:=least(mage_q.expires_at,soulx_q.expires_at,db_now+interval '5 minutes');
  RETURN jsonb_build_object('evidence',evidence,'verification',jsonb_build_object(
    'verifierId','videoforge-hosted-qualified-gpu-activation-verifier-v1','accepted',true,
    'signatureVerified',true,'canonicalEvidenceSha256',evidence_hash,
    'verifierSignatureSha256',activation.evidence_sha256,'sourceCommit',activation.source_commit,
    'databaseObservedAt',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(verification_expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'activationSnapshotSha256',gate_hash,'paidApprovalLedgerSha256',activation.evidence_sha256,
    'gate',gate));
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_load_hosted_pair_activation_v2(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_gpu_activation_v2() FROM PUBLIC;
