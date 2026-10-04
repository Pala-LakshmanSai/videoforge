-- Render uses the reconciler principal. Expose only an exact retained voiceover origin,
-- without granting that principal direct access to recovery rows or source receipts.
CREATE FUNCTION public.videoforge_read_cloud_asr_recovery_voiceover_origin(
 supplied_account_id uuid,supplied_workspace_id uuid,supplied_project_id uuid,supplied_revision_id uuid,
 supplied_receipt_id uuid,supplied_asset_id uuid,supplied_object_key text,supplied_sha256 text,
 supplied_content_length bigint,supplied_content_type text
) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT reserved.project_revision_id
 FROM public.cloud_media_asr_recoveries recovery
 JOIN public.artifact_receipts receipt ON receipt.id=recovery.source_receipt_id
   AND receipt.account_id=recovery.account_id AND receipt.workspace_id=recovery.workspace_id
 JOIN public.artifact_reservations reserved ON reserved.id=receipt.reservation_id
   AND reserved.account_id=receipt.account_id AND reserved.workspace_id=receipt.workspace_id
 JOIN public.assets asset ON asset.id=reserved.asset_id
   AND asset.account_id=reserved.account_id AND asset.workspace_id=reserved.workspace_id
 JOIN public.project_revisions revision ON revision.id=recovery.project_revision_id
   AND revision.account_id=recovery.account_id AND revision.workspace_id=recovery.workspace_id
 WHERE public.videoforge_current_account_id()=supplied_account_id
   AND recovery.account_id=supplied_account_id AND recovery.workspace_id=supplied_workspace_id
   AND recovery.project_id=supplied_project_id AND recovery.project_revision_id=supplied_revision_id
   AND revision.project_id=recovery.project_id AND revision.status='LOCKED'
   AND receipt.id=supplied_receipt_id AND asset.id=supplied_asset_id
   AND asset.id=revision.voiceover_asset_id AND asset.kind='VOICEOVER'
   AND reserved.project_id=recovery.project_id AND reserved.lane='INPUT' AND reserved.state='COMMITTED'
   AND receipt.deleted_at IS NULL AND receipt.object_key=supplied_object_key
   AND reserved.object_key=receipt.object_key AND receipt.checksum_sha256=supplied_sha256
   AND asset.binary_sha256=receipt.checksum_sha256
   AND revision.voiceover_binary_sha256=receipt.checksum_sha256
   AND receipt.content_length=supplied_content_length AND receipt.content_type=supplied_content_type
   AND asset.state IN ('VERIFIED','ACCEPTED');
$$;
REVOKE ALL ON FUNCTION public.videoforge_read_cloud_asr_recovery_voiceover_origin(uuid,uuid,uuid,uuid,uuid,uuid,text,text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_read_cloud_asr_recovery_voiceover_origin(uuid,uuid,uuid,uuid,uuid,uuid,text,text,bigint,text)
 TO videoforge_v209_runtime_dc9612d6,videoforge_v209_reconciler_dc9612d6;
