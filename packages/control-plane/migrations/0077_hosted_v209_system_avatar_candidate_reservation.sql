-- Bind the SYSTEM avatar reference to the exact input reservation identity frozen by 0074.
-- 0076 was never deployed with provider mutation; fail closed rather than guessing if its obsolete
-- revision-derived identity was materialized before this additive repair is applied.

DO $obsolete_reference$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.artifact_reservations
     WHERE method='GET' AND lane='INPUT' AND job_id LIKE 'v209-system-avatar-%'
  ) THEN
    RAISE EXCEPTION 'pre-0077 SYSTEM avatar references require exact operator reconciliation'
      USING ERRCODE='55000';
  END IF;
END
$obsolete_reference$;

CREATE FUNCTION public.videoforge_hosted_v209_system_avatar_candidate_reservation_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
  IF NEW.method='GET' AND NEW.lane='INPUT' AND NEW.job_id LIKE 'v209-system-avatar-%'
     AND public.videoforge_is_hosted_v209_system_avatar_reference(NEW.account_id,NEW.workspace_id,
       NEW.project_id,NEW.project_revision_id,NEW.asset_id,NEW.object_key,NEW.content_type,
       NEW.content_length,NEW.checksum_sha256,NEW.job_id,NEW.artifact_id)
     AND NOT EXISTS(SELECT 1 FROM public.generation_requests request
       WHERE request.account_id=NEW.account_id AND request.workspace_id=NEW.workspace_id
         AND request.project_id=NEW.project_id AND request.project_revision_id=NEW.project_revision_id
         AND NEW.id=public.videoforge_hosted_v209_uuid(
           'input-reservation',request.id,'avatar-source')) THEN
    RAISE EXCEPTION 'SYSTEM avatar reference does not match its exact 0074 candidate reservation'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER artifact_reservations_v209_system_candidate_guard
  BEFORE INSERT ON public.artifact_reservations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_hosted_v209_system_avatar_candidate_reservation_guard();

CREATE OR REPLACE FUNCTION public.videoforge_materialize_hosted_v209_system_avatar_reference(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid, supplied_project_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE scope_target record; target record; materialized_reservation_id uuid;
  materialized_receipt_id uuid; db_now timestamptz:=transaction_timestamp();
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
      AND tenant_version.profile_hash=revision.avatar_profile_hash
      AND tenant_version.runtime_source_asset_id=revision.avatar_runtime_source_asset_id
      AND tenant_version.runtime_source_binary_sha256=revision.avatar_runtime_source_binary_sha256
      AND tenant_version.scope_kind='WORKSPACE' AND tenant_version.state='READY'
    JOIN public.avatar_profile_assets tenant_link ON tenant_link.account_id=tenant_version.account_id
      AND tenant_link.workspace_id=tenant_version.workspace_id AND tenant_link.version_id=tenant_version.id
      AND tenant_link.asset_id=tenant_version.runtime_source_asset_id AND tenant_link.role='RUNTIME'
      AND tenant_link.retention_state='RETAIN' AND tenant_link.binary_sha256=tenant_version.runtime_source_binary_sha256
    JOIN public.assets tenant_asset ON tenant_asset.account_id=tenant_version.account_id
      AND tenant_asset.workspace_id=tenant_version.workspace_id AND tenant_asset.id=tenant_version.runtime_source_asset_id
      AND tenant_asset.kind='AVATAR_RUNTIME' AND tenant_asset.state IN ('VERIFIED','ACCEPTED')
      AND tenant_asset.binary_sha256=tenant_version.runtime_source_binary_sha256
      AND tenant_asset.metadata->>'system_source_scope'='SYSTEM'
      AND tenant_asset.metadata->>'materialization'='hosted-system-preset-snapshot-v1'
    JOIN public.assets system_asset ON system_asset.account_id='ffffffff-ffff-4fff-8fff-000000000001'::uuid
      AND system_asset.workspace_id='ffffffff-ffff-4fff-8fff-000000000011'::uuid
      AND system_asset.id=(tenant_asset.metadata->>'system_source_asset_id')::uuid
      AND system_asset.kind='AVATAR_RUNTIME' AND system_asset.state IN ('VERIFIED','ACCEPTED')
      AND system_asset.object_key=tenant_asset.object_key AND system_asset.binary_sha256=tenant_asset.binary_sha256
      AND system_asset.content_type=tenant_asset.content_type AND system_asset.byte_size=tenant_asset.byte_size
    JOIN public.avatar_profile_versions system_version ON system_version.account_id=system_asset.account_id
      AND system_version.workspace_id=system_asset.workspace_id AND system_version.runtime_source_asset_id=system_asset.id
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
      AND system_link.workspace_id=system_version.workspace_id AND system_link.version_id=system_version.id
      AND system_link.asset_id=system_asset.id AND system_link.role='RUNTIME'
      AND system_link.retention_state='RETAIN' AND system_link.binary_sha256=system_asset.binary_sha256
   WHERE request.id=scope_target.generation_request_id AND request.account_id=supplied_account_id
     AND request.workspace_id=supplied_workspace_id AND request.project_id=supplied_project_id
   ORDER BY system_version.id LIMIT 1 FOR SHARE OF request,revision,tenant_version,tenant_link,
     tenant_asset,system_asset,system_version,system_profile,system_link;
  IF target.generation_request_id IS NULL OR NOT public.videoforge_is_hosted_v209_system_avatar_reference(
      supplied_account_id,supplied_workspace_id,supplied_project_id,target.project_revision_id,
      target.tenant_asset_id,target.object_key,target.content_type,target.byte_size,target.binary_sha256,
      'v209-system-avatar-'||target.project_revision_id::text,target.tenant_asset_id::text) THEN
    RAISE EXCEPTION 'hosted V2-09 exact SYSTEM avatar source unavailable' USING ERRCODE='23514';
  END IF;
  materialized_reservation_id:=public.videoforge_hosted_v209_uuid(
    'input-reservation',target.generation_request_id,'avatar-source');
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
      target.project_revision_id,target.tenant_asset_id,'INPUT',
      'v209-system-avatar-'||target.project_revision_id::text,target.tenant_asset_id::text,
      target.object_key,'GET',target.content_type,target.byte_size,target.binary_sha256,
      db_now+interval '100 years',1,1,'COMMITTED','PROJECT',supplied_account_id,db_now,db_now);
    INSERT INTO public.artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,
      content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at,created_at)
    VALUES(materialized_receipt_id,supplied_account_id,supplied_workspace_id,materialized_reservation_id,
      'v209-system-avatar-reference-'||materialized_receipt_id::text,target.object_key,
      target.content_type,target.byte_size,target.binary_sha256,facts,receipt_sha,db_now,db_now);
  END IF;
  RETURN jsonb_build_object('schemaVersion','videoforge.hosted-v209-system-avatar-reference/v1',
    'accountId',supplied_account_id,'workspaceId',supplied_workspace_id,'projectId',supplied_project_id,
    'projectRevisionId',target.project_revision_id,'generationRequestId',target.generation_request_id,
    'assetId',target.tenant_asset_id,'receiptId',materialized_receipt_id,
    'reservationId',materialized_reservation_id,'objectKey',target.object_key,
    'checksumSha256',target.binary_sha256,'referenceRequired',true,'referenceReady',true,
    'replayed',replayed);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_materialize_hosted_v209_system_avatar_reference(
  uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_hosted_v209_system_avatar_candidate_reservation_guard()
  FROM PUBLIC;
