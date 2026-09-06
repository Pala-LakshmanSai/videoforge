-- Exact tenant-private reference to an immutable SYSTEM avatar runtime source.
-- No object is copied and no caller supplies an object identity: PostgreSQL derives the active
-- SYSTEM READY version, retained runtime link, source asset, tenant clone, locked revision, and
-- active generation request before it records a project/revision-scoped input receipt.

ALTER TABLE public.artifact_reservations
  DROP CONSTRAINT IF EXISTS artifact_reservations_account_id_workspace_id_object_key_me_key;
ALTER TABLE public.artifact_reservations
  DROP CONSTRAINT artifact_reservations_object_key_check;
ALTER TABLE public.artifact_reservations
  ADD CONSTRAINT artifact_reservations_object_key_check CHECK (
    object_key ~ '^tenant/[A-Za-z0-9._:-]+/workspace/[A-Za-z0-9._:-]+/project/[A-Za-z0-9._:-]+/revision/[A-Za-z0-9._:-]+/lane/(input|mage-image|soulx-avatar|render|provenance)/job/[A-Za-z0-9._:-]+/artifact/[A-Za-z0-9._:-]+$'
    OR (
      method='GET' AND lane='INPUT'
      AND object_key ~ '^tenant/ffffffff-ffff-4fff-8fff-000000000001/workspace/ffffffff-ffff-4fff-8fff-000000000011/avatar-profile/[0-9a-f-]{36}/version/[0-9a-f-]{36}/canonical/avatar\.(png|jpg)$'
    )
  );
CREATE UNIQUE INDEX artifact_reservations_owned_non_get_object_uq
  ON public.artifact_reservations(account_id,workspace_id,object_key,method)
  WHERE method<>'GET';
CREATE UNIQUE INDEX artifact_reservations_owned_get_reference_uq
  ON public.artifact_reservations(account_id,workspace_id,project_revision_id,object_key,method)
  WHERE method='GET';

CREATE FUNCTION public.videoforge_is_hosted_v209_system_avatar_reference(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_project_id uuid,
  supplied_project_revision_id uuid, supplied_asset_id uuid, supplied_object_key text,
  supplied_content_type text, supplied_content_length bigint, supplied_checksum_sha256 text,
  supplied_job_id text, supplied_artifact_id text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.project_revisions revision
    JOIN public.projects project ON project.account_id=revision.account_id
      AND project.workspace_id=revision.workspace_id AND project.id=revision.project_id
      AND project.status='ACTIVE'
    JOIN public.avatar_profile_versions tenant_version ON tenant_version.account_id=revision.account_id
      AND tenant_version.workspace_id=revision.workspace_id
      AND tenant_version.id=revision.avatar_profile_version_id
      AND tenant_version.profile_hash=revision.avatar_profile_hash
      AND tenant_version.runtime_source_asset_id=revision.avatar_runtime_source_asset_id
      AND tenant_version.runtime_source_binary_sha256=revision.avatar_runtime_source_binary_sha256
      AND tenant_version.scope_kind='WORKSPACE' AND tenant_version.state='READY'
    JOIN public.avatar_profiles tenant_profile ON tenant_profile.account_id=tenant_version.account_id
      AND tenant_profile.workspace_id=tenant_version.workspace_id
      AND tenant_profile.id=tenant_version.profile_id AND tenant_profile.scope_kind='WORKSPACE'
      AND tenant_profile.status='ACTIVE'
    JOIN public.avatar_profile_assets tenant_link ON tenant_link.account_id=tenant_version.account_id
      AND tenant_link.workspace_id=tenant_version.workspace_id
      AND tenant_link.profile_id=tenant_version.profile_id AND tenant_link.version_id=tenant_version.id
      AND tenant_link.asset_id=tenant_version.runtime_source_asset_id
      AND tenant_link.role='RUNTIME' AND tenant_link.retention_state='RETAIN'
      AND tenant_link.binary_sha256=tenant_version.runtime_source_binary_sha256
    JOIN public.assets tenant_asset ON tenant_asset.account_id=tenant_version.account_id
      AND tenant_asset.workspace_id=tenant_version.workspace_id
      AND tenant_asset.id=tenant_version.runtime_source_asset_id
      AND tenant_asset.kind='AVATAR_RUNTIME' AND tenant_asset.state IN ('VERIFIED','ACCEPTED')
      AND tenant_asset.binary_sha256=tenant_version.runtime_source_binary_sha256
      AND tenant_asset.metadata->>'system_source_scope'='SYSTEM'
      AND tenant_asset.metadata->>'materialization'='hosted-system-preset-snapshot-v1'
    JOIN public.assets system_asset ON system_asset.account_id='ffffffff-ffff-4fff-8fff-000000000001'::uuid
      AND system_asset.workspace_id='ffffffff-ffff-4fff-8fff-000000000011'::uuid
      AND system_asset.id=(tenant_asset.metadata->>'system_source_asset_id')::uuid
      AND system_asset.kind='AVATAR_RUNTIME' AND system_asset.state IN ('VERIFIED','ACCEPTED')
      AND system_asset.object_key=tenant_asset.object_key
      AND system_asset.binary_sha256=tenant_asset.binary_sha256
      AND system_asset.content_type=tenant_asset.content_type
      AND system_asset.byte_size=tenant_asset.byte_size
    JOIN public.avatar_profile_versions system_version
      ON system_version.account_id=system_asset.account_id
      AND system_version.workspace_id=system_asset.workspace_id
      AND system_version.runtime_source_asset_id=system_asset.id
      AND system_version.runtime_source_binary_sha256=system_asset.binary_sha256
      AND system_version.profile_hash=tenant_version.profile_hash
      AND system_version.source_preparation_profile=tenant_version.source_preparation_profile
      AND system_version.source_validation_profile=tenant_version.source_validation_profile
      AND system_version.scope_kind='SYSTEM' AND system_version.state='READY'
    JOIN public.avatar_profiles system_profile ON system_profile.account_id=system_version.account_id
      AND system_profile.workspace_id=system_version.workspace_id
      AND system_profile.id=system_version.profile_id AND system_profile.scope_kind='SYSTEM'
      AND system_profile.status='ACTIVE' AND system_profile.active_version_id=system_version.id
    JOIN public.avatar_profile_assets system_link ON system_link.account_id=system_version.account_id
      AND system_link.workspace_id=system_version.workspace_id
      AND system_link.profile_id=system_version.profile_id AND system_link.version_id=system_version.id
      AND system_link.asset_id=system_asset.id AND system_link.role='RUNTIME'
      AND system_link.retention_state='RETAIN' AND system_link.binary_sha256=system_asset.binary_sha256
    WHERE revision.account_id=supplied_account_id AND revision.workspace_id=supplied_workspace_id
      AND revision.id=supplied_project_revision_id AND revision.project_id=supplied_project_id
      AND revision.status='LOCKED' AND tenant_asset.id=supplied_asset_id
      AND system_asset.object_key=supplied_object_key
      AND system_asset.content_type=supplied_content_type
      AND system_asset.byte_size=supplied_content_length
      AND system_asset.binary_sha256=supplied_checksum_sha256
      AND supplied_job_id='v209-system-avatar-'||revision.id::text
      AND supplied_artifact_id=tenant_asset.id::text
      AND 1=(SELECT count(*) FROM public.avatar_profile_versions unique_version
        JOIN public.avatar_profiles unique_profile ON unique_profile.account_id=unique_version.account_id
          AND unique_profile.workspace_id=unique_version.workspace_id
          AND unique_profile.id=unique_version.profile_id AND unique_profile.scope_kind='SYSTEM'
          AND unique_profile.status='ACTIVE' AND unique_profile.active_version_id=unique_version.id
        JOIN public.avatar_profile_assets unique_link ON unique_link.account_id=unique_version.account_id
          AND unique_link.workspace_id=unique_version.workspace_id
          AND unique_link.version_id=unique_version.id AND unique_link.asset_id=system_asset.id
          AND unique_link.role='RUNTIME' AND unique_link.retention_state='RETAIN'
          AND unique_link.binary_sha256=system_asset.binary_sha256
        WHERE unique_version.account_id=system_asset.account_id
          AND unique_version.workspace_id=system_asset.workspace_id
          AND unique_version.runtime_source_asset_id=system_asset.id
          AND unique_version.runtime_source_binary_sha256=system_asset.binary_sha256
          AND unique_version.profile_hash=tenant_version.profile_hash
          AND unique_version.source_preparation_profile=tenant_version.source_preparation_profile
          AND unique_version.source_validation_profile=tenant_version.source_validation_profile
          AND unique_version.scope_kind='SYSTEM' AND unique_version.state='READY')
      AND system_asset.object_key='tenant/'||system_asset.account_id::text||'/workspace/'||
        system_asset.workspace_id::text||'/avatar-profile/'||system_profile.id::text||'/version/'||
        system_version.id::text||'/canonical/avatar.'||
        CASE system_asset.content_type WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpg' ELSE '' END
  );
$$;

CREATE OR REPLACE FUNCTION public.videoforge_artifact_reservation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE expected_key text; lane_path text; exact_system_reference boolean;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.method='GET' AND OLD.job_id LIKE 'v209-system-avatar-%' THEN
      RAISE EXCEPTION 'system avatar reference reservation is append-only' USING ERRCODE='55000';
    END IF;
    IF (to_jsonb(NEW)-ARRAY['used_count','state','updated_at']::text[])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['used_count','state','updated_at']::text[])
       OR NEW.used_count<OLD.used_count THEN
      RAISE EXCEPTION 'artifact reservation identity and scope are immutable' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  lane_path:=CASE NEW.lane WHEN 'INPUT' THEN 'input' WHEN 'MAGE_IMAGE' THEN 'mage-image'
    WHEN 'SOULX_AVATAR' THEN 'soulx-avatar' WHEN 'RENDER' THEN 'render'
    WHEN 'PROVENANCE' THEN 'provenance' END;
  expected_key:='tenant/'||NEW.account_id||'/workspace/'||NEW.workspace_id||
    '/project/'||NEW.project_id||'/revision/'||NEW.project_revision_id||'/lane/'||lane_path||
    '/job/'||NEW.job_id||'/artifact/'||NEW.artifact_id;
  exact_system_reference:=public.videoforge_is_hosted_v209_system_avatar_reference(
    NEW.account_id,NEW.workspace_id,NEW.project_id,NEW.project_revision_id,NEW.asset_id,
    NEW.object_key,NEW.content_type,NEW.content_length,NEW.checksum_sha256,NEW.job_id,NEW.artifact_id);
  IF NEW.object_key<>expected_key
     AND NOT (exact_system_reference AND NEW.method='GET' AND NEW.lane='INPUT'
       AND NEW.state='COMMITTED' AND NEW.retention_class='PROJECT'
       AND NEW.used_count=1 AND NEW.max_uses=1) THEN
    RAISE EXCEPTION 'artifact object key does not match trusted ownership lineage' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.videoforge_artifact_receipt_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE reserved public.artifact_reservations%ROWTYPE; exact_system_reference boolean;
BEGIN
  SELECT * INTO reserved FROM public.artifact_reservations
   WHERE account_id=COALESCE(NEW.account_id,OLD.account_id)
     AND workspace_id=COALESCE(NEW.workspace_id,OLD.workspace_id)
     AND id=COALESCE(NEW.reservation_id,OLD.reservation_id);
  exact_system_reference:=reserved.id IS NOT NULL AND
    public.videoforge_is_hosted_v209_system_avatar_reference(reserved.account_id,reserved.workspace_id,
      reserved.project_id,reserved.project_revision_id,reserved.asset_id,reserved.object_key,
      reserved.content_type,reserved.content_length,reserved.checksum_sha256,reserved.job_id,reserved.artifact_id);
  IF TG_OP='UPDATE' THEN
    IF exact_system_reference THEN
      RAISE EXCEPTION 'system avatar reference receipt is append-only' USING ERRCODE='55000';
    END IF;
    IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL
       OR (to_jsonb(NEW)-ARRAY['deleted_at','deletion_reason']::text[])
          IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['deleted_at','deletion_reason']::text[]) THEN
      RAISE EXCEPTION 'artifact receipt is append-only except one owned deletion tombstone' USING ERRCODE='55000';
    END IF;
    IF reserved.id IS NULL OR reserved.deletion_owner_account_id<>NEW.account_id
       OR reserved.retention_class='LEGAL_HOLD'
       OR (reserved.retain_until IS NOT NULL AND NEW.deleted_at<reserved.retain_until) THEN
      RAISE EXCEPTION 'artifact receipt deletion violates ownership or retention' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF reserved.id IS NULL OR reserved.object_key<>NEW.object_key
     OR reserved.content_type<>NEW.content_type OR reserved.content_length<>NEW.content_length
     OR reserved.checksum_sha256<>NEW.checksum_sha256 OR reserved.expires_at<=NEW.committed_at
     OR NOT (reserved.method='PUT' OR (reserved.method='GET' AND reserved.state='COMMITTED'
       AND exact_system_reference)) THEN
    RAISE EXCEPTION 'artifact receipt does not match a live exact upload or system reference reservation'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.videoforge_materialize_hosted_v209_system_avatar_reference(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid, supplied_project_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE scope_target record; target record; materialized_reservation_id uuid;
  materialized_receipt_id uuid;
  db_now timestamptz:=transaction_timestamp();
  facts jsonb; receipt_sha text; replayed boolean:=false;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.account_id=supplied_account_id
       AND m.workspace_id=supplied_workspace_id AND m.user_id=supplied_user_id AND m.status='ACTIVE') THEN
    RAISE EXCEPTION 'hosted V2-09 system avatar reference scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT request.id generation_request_id,revision.id project_revision_id,
      asset.id tenant_asset_id,asset.metadata
    INTO scope_target
    FROM public.generation_requests request
    JOIN public.project_revisions revision ON revision.account_id=request.account_id
      AND revision.workspace_id=request.workspace_id AND revision.id=request.project_revision_id
      AND revision.project_id=request.project_id AND revision.status='LOCKED'
    JOIN public.assets asset ON asset.account_id=revision.account_id
      AND asset.workspace_id=revision.workspace_id AND asset.id=revision.avatar_runtime_source_asset_id
      AND asset.kind='AVATAR_RUNTIME' AND asset.state IN ('VERIFIED','ACCEPTED')
      AND asset.binary_sha256=revision.avatar_runtime_source_binary_sha256
   WHERE request.account_id=supplied_account_id AND request.workspace_id=supplied_workspace_id
     AND request.project_id=supplied_project_id AND request.created_by_user_id=supplied_user_id
     AND request.state='ACTIVE' AND request.terminal_at IS NULL
   ORDER BY request.created_at DESC LIMIT 1 FOR SHARE OF request,revision,asset;
  IF scope_target.generation_request_id IS NULL THEN
    RAISE EXCEPTION 'hosted V2-09 active locked avatar source unavailable' USING ERRCODE='23514';
  END IF;
  IF NOT (scope_target.metadata?'system_source_scope')
     AND NOT (scope_target.metadata?'materialization')
     AND NOT (scope_target.metadata?'system_source_asset_id') THEN
    RETURN jsonb_build_object('schemaVersion','videoforge.hosted-v209-system-avatar-reference/v1',
      'accountId',supplied_account_id,'workspaceId',supplied_workspace_id,
      'projectId',supplied_project_id,'projectRevisionId',scope_target.project_revision_id,
      'generationRequestId',scope_target.generation_request_id,'referenceRequired',false,
      'referenceReady',true,'replayed',true);
  END IF;
  IF scope_target.metadata->>'system_source_scope'<>'SYSTEM'
     OR scope_target.metadata->>'materialization'<>'hosted-system-preset-snapshot-v1'
     OR coalesce(scope_target.metadata->>'system_source_asset_id','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'hosted V2-09 SYSTEM avatar clone lineage invalid' USING ERRCODE='23514';
  END IF;
  SELECT request.id generation_request_id,revision.id project_revision_id,
      tenant_asset.id tenant_asset_id,tenant_asset.object_key,tenant_asset.content_type,
      tenant_asset.byte_size,tenant_asset.binary_sha256,
      system_profile.id system_profile_id,system_version.id system_version_id,
      system_asset.id system_asset_id,system_link.id system_link_id
    INTO target
    FROM public.generation_requests request
    JOIN public.project_revisions revision ON revision.account_id=request.account_id
      AND revision.workspace_id=request.workspace_id AND revision.id=request.project_revision_id
      AND revision.project_id=request.project_id AND revision.status='LOCKED'
    JOIN public.avatar_profile_versions tenant_version ON tenant_version.account_id=revision.account_id
      AND tenant_version.workspace_id=revision.workspace_id AND tenant_version.id=revision.avatar_profile_version_id
      AND tenant_version.runtime_source_asset_id=revision.avatar_runtime_source_asset_id
      AND tenant_version.runtime_source_binary_sha256=revision.avatar_runtime_source_binary_sha256
      AND tenant_version.scope_kind='WORKSPACE' AND tenant_version.state='READY'
    JOIN public.avatar_profile_assets tenant_link ON tenant_link.account_id=tenant_version.account_id
      AND tenant_link.workspace_id=tenant_version.workspace_id AND tenant_link.version_id=tenant_version.id
      AND tenant_link.asset_id=tenant_version.runtime_source_asset_id AND tenant_link.role='RUNTIME'
      AND tenant_link.retention_state='RETAIN' AND tenant_link.binary_sha256=tenant_version.runtime_source_binary_sha256
    JOIN public.assets tenant_asset ON tenant_asset.account_id=tenant_version.account_id
      AND tenant_asset.workspace_id=tenant_version.workspace_id AND tenant_asset.id=tenant_version.runtime_source_asset_id
      AND tenant_asset.metadata->>'system_source_scope'='SYSTEM'
      AND tenant_asset.metadata->>'materialization'='hosted-system-preset-snapshot-v1'
    JOIN public.assets system_asset ON system_asset.account_id='ffffffff-ffff-4fff-8fff-000000000001'::uuid
      AND system_asset.workspace_id='ffffffff-ffff-4fff-8fff-000000000011'::uuid
      AND system_asset.id=(tenant_asset.metadata->>'system_source_asset_id')::uuid
      AND system_asset.object_key=tenant_asset.object_key AND system_asset.binary_sha256=tenant_asset.binary_sha256
      AND system_asset.content_type=tenant_asset.content_type AND system_asset.byte_size=tenant_asset.byte_size
    JOIN public.avatar_profile_versions system_version ON system_version.account_id=system_asset.account_id
      AND system_version.workspace_id=system_asset.workspace_id AND system_version.runtime_source_asset_id=system_asset.id
      AND system_version.profile_hash=tenant_version.profile_hash
      AND system_version.source_preparation_profile=tenant_version.source_preparation_profile
      AND system_version.source_validation_profile=tenant_version.source_validation_profile
      AND system_version.scope_kind='SYSTEM' AND system_version.state='READY'
    JOIN public.avatar_profiles system_profile ON system_profile.account_id=system_version.account_id
      AND system_profile.workspace_id=system_version.workspace_id AND system_profile.id=system_version.profile_id
      AND system_profile.scope_kind='SYSTEM' AND system_profile.status='ACTIVE'
      AND system_profile.active_version_id=system_version.id
    JOIN public.avatar_profile_assets system_link ON system_link.account_id=system_version.account_id
      AND system_link.workspace_id=system_version.workspace_id AND system_link.version_id=system_version.id
      AND system_link.asset_id=system_asset.id AND system_link.role='RUNTIME'
      AND system_link.retention_state='RETAIN' AND system_link.binary_sha256=system_asset.binary_sha256
   WHERE request.account_id=supplied_account_id AND request.workspace_id=supplied_workspace_id
     AND request.project_id=supplied_project_id AND request.created_by_user_id=supplied_user_id
     AND request.state='ACTIVE' AND request.terminal_at IS NULL
     AND 1=(SELECT count(*) FROM public.avatar_profile_versions unique_version
       JOIN public.avatar_profiles unique_profile ON unique_profile.account_id=unique_version.account_id
         AND unique_profile.workspace_id=unique_version.workspace_id
         AND unique_profile.id=unique_version.profile_id AND unique_profile.scope_kind='SYSTEM'
         AND unique_profile.status='ACTIVE' AND unique_profile.active_version_id=unique_version.id
       JOIN public.avatar_profile_assets unique_link ON unique_link.account_id=unique_version.account_id
         AND unique_link.workspace_id=unique_version.workspace_id
         AND unique_link.version_id=unique_version.id AND unique_link.asset_id=system_asset.id
         AND unique_link.role='RUNTIME' AND unique_link.retention_state='RETAIN'
         AND unique_link.binary_sha256=system_asset.binary_sha256
       WHERE unique_version.account_id=system_asset.account_id
         AND unique_version.workspace_id=system_asset.workspace_id
         AND unique_version.runtime_source_asset_id=system_asset.id
         AND unique_version.runtime_source_binary_sha256=system_asset.binary_sha256
         AND unique_version.profile_hash=tenant_version.profile_hash
         AND unique_version.source_preparation_profile=tenant_version.source_preparation_profile
         AND unique_version.source_validation_profile=tenant_version.source_validation_profile
         AND unique_version.scope_kind='SYSTEM' AND unique_version.state='READY')
   ORDER BY request.created_at DESC LIMIT 1 FOR SHARE OF request,revision,tenant_version,tenant_link,
     tenant_asset,system_asset,system_version,system_profile,system_link;
  IF target.generation_request_id IS NULL OR NOT public.videoforge_is_hosted_v209_system_avatar_reference(
      supplied_account_id,supplied_workspace_id,supplied_project_id,target.project_revision_id,
      target.tenant_asset_id,target.object_key,target.content_type,target.byte_size,target.binary_sha256,
      'v209-system-avatar-'||target.project_revision_id::text,target.tenant_asset_id::text) THEN
    RAISE EXCEPTION 'hosted V2-09 exact SYSTEM avatar source unavailable' USING ERRCODE='23514';
  END IF;
  materialized_reservation_id:=md5(
    'hosted-v209-system-avatar-reservation:'||target.project_revision_id::text)::uuid;
  materialized_receipt_id:=md5(
    'hosted-v209-system-avatar-receipt:'||target.project_revision_id::text)::uuid;
  facts:=jsonb_build_object('schema_version','videoforge-hosted-v209-system-avatar-reference/v1',
    'account_id',supplied_account_id,'workspace_id',supplied_workspace_id,'project_id',supplied_project_id,
    'project_revision_id',target.project_revision_id,'generation_request_id',target.generation_request_id,
    'tenant_runtime_source_asset_id',target.tenant_asset_id,'system_avatar_profile_id',target.system_profile_id,
    'system_avatar_profile_version_id',target.system_version_id,'system_runtime_source_asset_id',target.system_asset_id,
    'system_runtime_profile_asset_link_id',target.system_link_id,'object_key',target.object_key,
    'content_type',target.content_type,'content_length',target.byte_size,'checksum_sha256',target.binary_sha256,
    'reservation_id',materialized_reservation_id,'receipt_id',materialized_receipt_id);
  receipt_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(facts),'UTF8')),'hex');
  IF EXISTS(SELECT 1 FROM public.artifact_reservations r WHERE r.id=materialized_reservation_id) THEN
    replayed:=true;
    IF NOT EXISTS(SELECT 1 FROM public.artifact_reservations r JOIN public.artifact_receipts p
      ON p.account_id=r.account_id AND p.workspace_id=r.workspace_id AND p.reservation_id=r.id
      WHERE r.id=materialized_reservation_id AND r.account_id=supplied_account_id
        AND r.workspace_id=supplied_workspace_id
        AND r.project_id=supplied_project_id AND r.project_revision_id=target.project_revision_id
        AND r.asset_id=target.tenant_asset_id AND r.object_key=target.object_key AND r.method='GET'
        AND r.state='COMMITTED' AND p.id=materialized_receipt_id
        AND p.receipt_sha256=receipt_sha AND p.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'hosted V2-09 SYSTEM avatar reference replay drift' USING ERRCODE='23505';
    END IF;
  ELSE
    INSERT INTO public.artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,
      asset_id,lane,job_id,artifact_id,object_key,method,content_type,content_length,checksum_sha256,
      expires_at,max_uses,used_count,state,retention_class,deletion_owner_account_id,created_at,updated_at)
    VALUES(materialized_reservation_id,supplied_account_id,supplied_workspace_id,supplied_project_id,
      target.project_revision_id,
      target.tenant_asset_id,'INPUT','v209-system-avatar-'||target.project_revision_id::text,
      target.tenant_asset_id::text,target.object_key,'GET',target.content_type,target.byte_size,
      target.binary_sha256,db_now+interval '100 years',1,1,'COMMITTED','PROJECT',supplied_account_id,db_now,db_now);
    INSERT INTO public.artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,
      content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at,created_at)
    VALUES(materialized_receipt_id,supplied_account_id,supplied_workspace_id,materialized_reservation_id,
      'v209-system-avatar-reference-'||materialized_receipt_id::text,target.object_key,
      target.content_type,target.byte_size,
      target.binary_sha256,facts,receipt_sha,db_now,db_now);
  END IF;
  RETURN jsonb_build_object('schemaVersion','videoforge.hosted-v209-system-avatar-reference/v1',
    'accountId',supplied_account_id,'workspaceId',supplied_workspace_id,'projectId',supplied_project_id,
    'projectRevisionId',target.project_revision_id,'generationRequestId',target.generation_request_id,
    'assetId',target.tenant_asset_id,'receiptId',materialized_receipt_id,
    'reservationId',materialized_reservation_id,
    'objectKey',target.object_key,'checksumSha256',target.binary_sha256,'referenceRequired',true,
    'referenceReady',true,'replayed',replayed);
END;
$$;

-- Add the explicit verified SYSTEM marker to the existing reconciler projection without changing
-- ordinary WORKSPACE avatar receipt semantics.
CREATE OR REPLACE FUNCTION public.videoforge_read_hosted_v209_system_avatar_projection(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_project_revision_id uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT jsonb_build_object('sourceScopeKind','SYSTEM','systemSourceReferenceVerified',true,
    'systemAvatarProfileId',system_profile.id,'systemAvatarProfileVersionId',system_version.id,
    'systemRuntimeSourceAssetId',system_asset.id,
    'systemRuntimeProfileAssetLinkId',system_link.id)
  FROM public.project_revisions revision
  JOIN public.assets tenant_asset ON tenant_asset.account_id=revision.account_id
    AND tenant_asset.workspace_id=revision.workspace_id AND tenant_asset.id=revision.avatar_runtime_source_asset_id
  JOIN public.artifact_reservations reservation ON reservation.account_id=revision.account_id
    AND reservation.workspace_id=revision.workspace_id AND reservation.project_id=revision.project_id
    AND reservation.project_revision_id=revision.id AND reservation.asset_id=tenant_asset.id
    AND reservation.method='GET' AND reservation.state='COMMITTED'
  JOIN public.artifact_receipts receipt ON receipt.account_id=reservation.account_id
    AND receipt.workspace_id=reservation.workspace_id AND receipt.reservation_id=reservation.id
    AND receipt.deleted_at IS NULL
  JOIN public.assets system_asset ON system_asset.account_id='ffffffff-ffff-4fff-8fff-000000000001'::uuid
    AND system_asset.workspace_id='ffffffff-ffff-4fff-8fff-000000000011'::uuid
    AND system_asset.id=(tenant_asset.metadata->>'system_source_asset_id')::uuid
    AND system_asset.object_key=receipt.object_key AND system_asset.binary_sha256=receipt.checksum_sha256
  JOIN public.avatar_profile_versions system_version ON system_version.account_id=system_asset.account_id
    AND system_version.workspace_id=system_asset.workspace_id AND system_version.runtime_source_asset_id=system_asset.id
    AND system_version.scope_kind='SYSTEM' AND system_version.state='READY'
  JOIN public.avatar_profiles system_profile ON system_profile.account_id=system_version.account_id
    AND system_profile.workspace_id=system_version.workspace_id AND system_profile.id=system_version.profile_id
    AND system_profile.scope_kind='SYSTEM' AND system_profile.status='ACTIVE'
    AND system_profile.active_version_id=system_version.id
  JOIN public.avatar_profile_assets system_link ON system_link.account_id=system_version.account_id
    AND system_link.workspace_id=system_version.workspace_id AND system_link.version_id=system_version.id
    AND system_link.asset_id=system_asset.id AND system_link.role='RUNTIME'
    AND system_link.retention_state='RETAIN' AND system_link.binary_sha256=system_asset.binary_sha256
  WHERE revision.account_id=supplied_account_id AND revision.workspace_id=supplied_workspace_id
    AND revision.id=supplied_project_revision_id AND revision.status='LOCKED'
    AND public.videoforge_is_hosted_v209_system_avatar_reference(reservation.account_id,
      reservation.workspace_id,reservation.project_id,reservation.project_revision_id,
      reservation.asset_id,reservation.object_key,reservation.content_type,reservation.content_length,
      reservation.checksum_sha256,reservation.job_id,reservation.artifact_id)
    AND public.videoforge_current_account_id() IS NOT DISTINCT FROM supplied_account_id;
$$;

ALTER FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid)
  RENAME TO videoforge_read_hosted_v209_ready_render_inputs_v1;
CREATE FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_generation_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE base jsonb; system_projection jsonb; revision_id uuid;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RETURN NULL;
  END IF;
  base:=public.videoforge_read_hosted_v209_ready_render_inputs_v1(
    supplied_account_id,supplied_workspace_id,supplied_generation_request_id);
  IF base IS NULL OR NOT (base?'avatarSource') THEN
    RETURN base;
  END IF;
  SELECT r.project_revision_id INTO revision_id FROM public.generation_requests r
   WHERE r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id
     AND r.id=supplied_generation_request_id;
  system_projection:=public.videoforge_read_hosted_v209_system_avatar_projection(
    supplied_account_id,supplied_workspace_id,revision_id);
  IF system_projection IS NULL THEN
    RETURN base;
  END IF;
  RETURN jsonb_set(base,'{avatarSource}',base->'avatarSource'||system_projection,false);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_is_hosted_v209_system_avatar_reference(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_materialize_hosted_v209_system_avatar_reference(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_v209_system_avatar_projection(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs_v1(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid) FROM PUBLIC;
