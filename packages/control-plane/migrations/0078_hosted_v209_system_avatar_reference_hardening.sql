-- Harden the additive SYSTEM avatar reference seam without changing 0076/0077 evidence bytes.

CREATE OR REPLACE FUNCTION public.videoforge_artifact_receipt_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE reserved public.artifact_reservations%ROWTYPE;
  structural_system_reference boolean:=false; exact_system_reference boolean:=false;
BEGIN
  SELECT * INTO reserved FROM public.artifact_reservations
   WHERE account_id=COALESCE(NEW.account_id,OLD.account_id)
     AND workspace_id=COALESCE(NEW.workspace_id,OLD.workspace_id)
     AND id=COALESCE(NEW.reservation_id,OLD.reservation_id);
  structural_system_reference:=reserved.id IS NOT NULL AND reserved.method='GET'
    AND reserved.lane='INPUT' AND reserved.state='COMMITTED' AND reserved.retention_class='PROJECT'
    AND reserved.used_count=1 AND reserved.max_uses=1
    AND reserved.job_id='v209-system-avatar-'||reserved.project_revision_id::text
    AND reserved.artifact_id=reserved.asset_id::text
    AND reserved.object_key ~ '^tenant/ffffffff-ffff-4fff-8fff-000000000001/workspace/ffffffff-ffff-4fff-8fff-000000000011/avatar-profile/[0-9a-f-]{36}/version/[0-9a-f-]{36}/canonical/avatar\.(png|jpg)$'
    AND EXISTS(SELECT 1 FROM public.project_revisions revision
      JOIN public.assets tenant_asset ON tenant_asset.account_id=revision.account_id
        AND tenant_asset.workspace_id=revision.workspace_id
        AND tenant_asset.id=revision.avatar_runtime_source_asset_id
        AND tenant_asset.id=reserved.asset_id AND tenant_asset.kind='AVATAR_RUNTIME'
        AND tenant_asset.binary_sha256=revision.avatar_runtime_source_binary_sha256
        AND tenant_asset.object_key=reserved.object_key
        AND tenant_asset.content_type=reserved.content_type
        AND tenant_asset.byte_size=reserved.content_length
        AND tenant_asset.binary_sha256=reserved.checksum_sha256
      JOIN public.generation_requests request ON request.account_id=revision.account_id
        AND request.workspace_id=revision.workspace_id AND request.project_id=revision.project_id
        AND request.project_revision_id=revision.id
        AND reserved.id=public.videoforge_hosted_v209_uuid(
          'input-reservation',request.id,'avatar-source')
      WHERE revision.account_id=reserved.account_id AND revision.workspace_id=reserved.workspace_id
        AND revision.project_id=reserved.project_id AND revision.id=reserved.project_revision_id
        AND revision.status='LOCKED');
  exact_system_reference:=structural_system_reference AND
    public.videoforge_is_hosted_v209_system_avatar_reference(reserved.account_id,reserved.workspace_id,
      reserved.project_id,reserved.project_revision_id,reserved.asset_id,reserved.object_key,
      reserved.content_type,reserved.content_length,reserved.checksum_sha256,
      reserved.job_id,reserved.artifact_id);
  IF TG_OP='UPDATE' THEN
    IF structural_system_reference THEN
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
     OR NOT (reserved.method='PUT' OR exact_system_reference) THEN
    RAISE EXCEPTION 'artifact receipt does not match a live exact upload or system reference reservation'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.videoforge_read_hosted_v209_system_avatar_projection(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_project_revision_id uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT jsonb_build_object('sourceScopeKind','SYSTEM','systemSourceReferenceVerified',true,
    'systemAvatarProfileId',system_profile.id,'systemAvatarProfileVersionId',system_version.id,
    'systemRuntimeSourceAssetId',system_asset.id,
    'systemRuntimeProfileAssetLinkId',system_link.id)
  FROM public.project_revisions revision
  JOIN public.avatar_profile_versions tenant_version ON tenant_version.account_id=revision.account_id
    AND tenant_version.workspace_id=revision.workspace_id
    AND tenant_version.id=revision.avatar_profile_version_id
    AND tenant_version.profile_id=revision.avatar_profile_id
    AND tenant_version.profile_hash=revision.avatar_profile_hash
    AND tenant_version.runtime_source_asset_id=revision.avatar_runtime_source_asset_id
    AND tenant_version.runtime_source_binary_sha256=revision.avatar_runtime_source_binary_sha256
    AND tenant_version.source_preparation_profile=revision.avatar_source_preparation_profile
    AND tenant_version.source_validation_profile=revision.avatar_source_validation_profile
    AND tenant_version.scope_kind='WORKSPACE' AND tenant_version.state='READY'
  JOIN public.assets tenant_asset ON tenant_asset.account_id=tenant_version.account_id
    AND tenant_asset.workspace_id=tenant_version.workspace_id
    AND tenant_asset.id=tenant_version.runtime_source_asset_id
    AND tenant_asset.kind='AVATAR_RUNTIME' AND tenant_asset.state IN ('VERIFIED','ACCEPTED')
    AND tenant_asset.binary_sha256=tenant_version.runtime_source_binary_sha256
    AND tenant_asset.metadata->>'system_source_scope'='SYSTEM'
    AND tenant_asset.metadata->>'materialization'='hosted-system-preset-snapshot-v1'
  JOIN public.artifact_reservations reservation ON reservation.account_id=revision.account_id
    AND reservation.workspace_id=revision.workspace_id AND reservation.project_id=revision.project_id
    AND reservation.project_revision_id=revision.id AND reservation.asset_id=tenant_asset.id
    AND reservation.method='GET' AND reservation.lane='INPUT' AND reservation.state='COMMITTED'
    AND reservation.job_id='v209-system-avatar-'||revision.id::text
    AND reservation.artifact_id=tenant_asset.id::text
  JOIN public.generation_requests request ON request.account_id=revision.account_id
    AND request.workspace_id=revision.workspace_id AND request.project_id=revision.project_id
    AND request.project_revision_id=revision.id
    AND reservation.id=public.videoforge_hosted_v209_uuid(
      'input-reservation',request.id,'avatar-source')
  JOIN public.artifact_receipts receipt ON receipt.account_id=reservation.account_id
    AND receipt.workspace_id=reservation.workspace_id AND receipt.reservation_id=reservation.id
    AND receipt.object_key=reservation.object_key AND receipt.content_type=reservation.content_type
    AND receipt.content_length=reservation.content_length
    AND receipt.checksum_sha256=reservation.checksum_sha256 AND receipt.deleted_at IS NULL
  JOIN public.assets system_asset ON system_asset.account_id='ffffffff-ffff-4fff-8fff-000000000001'::uuid
    AND system_asset.workspace_id='ffffffff-ffff-4fff-8fff-000000000011'::uuid
    AND system_asset.id=(tenant_asset.metadata->>'system_source_asset_id')::uuid
    AND system_asset.kind='AVATAR_RUNTIME' AND system_asset.state IN ('VERIFIED','ACCEPTED')
    AND system_asset.object_key=tenant_asset.object_key
    AND system_asset.binary_sha256=tenant_asset.binary_sha256
    AND system_asset.content_type=tenant_asset.content_type AND system_asset.byte_size=tenant_asset.byte_size
  JOIN public.avatar_profile_versions system_version ON system_version.account_id=system_asset.account_id
    AND system_version.workspace_id=system_asset.workspace_id
    AND system_version.runtime_source_asset_id=system_asset.id
    AND system_version.runtime_source_binary_sha256=system_asset.binary_sha256
    AND system_version.profile_hash=tenant_version.profile_hash
    AND system_version.source_preparation_profile=tenant_version.source_preparation_profile
    AND system_version.source_validation_profile=tenant_version.source_validation_profile
    AND system_version.scope_kind='SYSTEM' AND system_version.state='READY'
  JOIN public.avatar_profiles system_profile ON system_profile.account_id=system_version.account_id
    AND system_profile.workspace_id=system_version.workspace_id AND system_profile.id=system_version.profile_id
    AND system_profile.scope_kind='SYSTEM' AND system_profile.status='ACTIVE'
    AND system_profile.active_version_id=system_version.id
  JOIN public.avatar_profile_assets system_link ON system_link.account_id=system_version.account_id
    AND system_link.workspace_id=system_version.workspace_id AND system_link.profile_id=system_profile.id
    AND system_link.version_id=system_version.id AND system_link.asset_id=system_asset.id
    AND system_link.role='RUNTIME' AND system_link.retention_state='RETAIN'
    AND system_link.binary_sha256=system_asset.binary_sha256
  WHERE revision.account_id=supplied_account_id AND revision.workspace_id=supplied_workspace_id
    AND revision.id=supplied_project_revision_id AND revision.status='LOCKED'
    AND public.videoforge_current_account_id() IS NOT DISTINCT FROM supplied_account_id
    AND 1=(SELECT count(*) FROM public.avatar_profile_versions unique_version
      JOIN public.avatar_profiles unique_profile ON unique_profile.account_id=unique_version.account_id
        AND unique_profile.workspace_id=unique_version.workspace_id
        AND unique_profile.id=unique_version.profile_id AND unique_profile.scope_kind='SYSTEM'
        AND unique_profile.status='ACTIVE' AND unique_profile.active_version_id=unique_version.id
      JOIN public.avatar_profile_assets unique_link ON unique_link.account_id=unique_version.account_id
        AND unique_link.workspace_id=unique_version.workspace_id
        AND unique_link.profile_id=unique_profile.id AND unique_link.version_id=unique_version.id
        AND unique_link.asset_id=system_asset.id AND unique_link.role='RUNTIME'
        AND unique_link.retention_state='RETAIN'
        AND unique_link.binary_sha256=system_asset.binary_sha256
      WHERE unique_version.account_id=system_asset.account_id
        AND unique_version.workspace_id=system_asset.workspace_id
        AND unique_version.runtime_source_asset_id=system_asset.id
        AND unique_version.runtime_source_binary_sha256=system_asset.binary_sha256
        AND unique_version.profile_hash=tenant_version.profile_hash
        AND unique_version.source_preparation_profile=tenant_version.source_preparation_profile
        AND unique_version.source_validation_profile=tenant_version.source_validation_profile
        AND unique_version.scope_kind='SYSTEM' AND unique_version.state='READY')
    AND public.videoforge_is_hosted_v209_system_avatar_reference(reservation.account_id,
      reservation.workspace_id,reservation.project_id,reservation.project_revision_id,
      reservation.asset_id,reservation.object_key,reservation.content_type,reservation.content_length,
      reservation.checksum_sha256,reservation.job_id,reservation.artifact_id);
$$;

ALTER FUNCTION public.videoforge_materialize_hosted_v209_system_avatar_reference(uuid,uuid,uuid,uuid)
  RENAME TO videoforge_materialize_hosted_v209_system_avatar_reference_v2;
CREATE FUNCTION public.videoforge_materialize_hosted_v209_system_avatar_reference(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid, supplied_project_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE identity record; result jsonb;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.account_id=supplied_account_id
       AND m.workspace_id=supplied_workspace_id AND m.user_id=supplied_user_id AND m.status='ACTIVE') THEN
    RAISE EXCEPTION 'hosted V2-09 system avatar reference scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT request.id generation_request_id,revision.id project_revision_id
    INTO identity FROM public.generation_requests request
    JOIN public.project_revisions revision ON revision.account_id=request.account_id
      AND revision.workspace_id=request.workspace_id AND revision.id=request.project_revision_id
      AND revision.project_id=request.project_id AND revision.status='LOCKED'
   WHERE request.account_id=supplied_account_id AND request.workspace_id=supplied_workspace_id
     AND request.project_id=supplied_project_id AND request.created_by_user_id=supplied_user_id
     AND request.state='ACTIVE' AND request.terminal_at IS NULL
   ORDER BY request.created_at DESC LIMIT 1;
  IF identity.generation_request_id IS NULL THEN
    RAISE EXCEPTION 'hosted V2-09 active locked avatar source unavailable' USING ERRCODE='23514';
  END IF;
  -- Use the exact 0074 candidate lock so reference and candidate materialization serialize in one
  -- order even when recovery reaches either seam first. The request identity already binds the
  -- tenant, project, and locked revision.
  PERFORM pg_advisory_xact_lock(hashtextextended(identity.generation_request_id::text,41));
  result:=public.videoforge_materialize_hosted_v209_system_avatar_reference_v2(
    supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id);
  IF result->>'projectRevisionId'<>identity.project_revision_id::text
     OR result->>'generationRequestId'<>identity.generation_request_id::text THEN
    RAISE EXCEPTION 'hosted V2-09 SYSTEM avatar materialization identity changed while locked'
      USING ERRCODE='40001';
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_materialize_hosted_v209_system_avatar_reference_v2(
  uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_materialize_hosted_v209_system_avatar_reference(
  uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_v209_system_avatar_projection(uuid,uuid,uuid)
  FROM PUBLIC;
