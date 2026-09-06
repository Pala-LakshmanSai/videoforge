-- Keep existing SYSTEM reference receipts append-only even if mutable asset metadata later drifts.
-- Fresh receipt insertion still requires the complete current SYSTEM lineage through the exact helper.

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
      JOIN public.generation_requests request ON request.account_id=revision.account_id
        AND request.workspace_id=revision.workspace_id AND request.project_id=revision.project_id
        AND request.project_revision_id=revision.id
        AND reserved.id=public.videoforge_hosted_v209_uuid(
          'input-reservation',request.id,'avatar-source')
      WHERE revision.account_id=reserved.account_id AND revision.workspace_id=reserved.workspace_id
        AND revision.project_id=reserved.project_id AND revision.id=reserved.project_revision_id
        AND revision.avatar_runtime_source_asset_id=reserved.asset_id
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

REVOKE ALL ON FUNCTION public.videoforge_artifact_receipt_guard() FROM PUBLIC;
