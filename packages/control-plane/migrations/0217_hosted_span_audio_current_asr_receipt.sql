-- Bind selected-span downloads to the accepted current ASR input receipt, including the exact
-- same-project 0215 recovery alias. Immutable source asset object keys are never rewritten.
-- Preserve the Local same-project source receipt fallback; Cloud requires accepted ASR lineage.
-- Replace only reviewed 0092 clauses, leaving cadence, batching and finalization unchanged.
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_materialize_hosted_v209_span_audio_jobs(uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 IF position($old$    JOIN public.artifact_reservations reservation ON reservation.account_id=s.account_id
      AND reservation.workspace_id=s.workspace_id AND reservation.asset_id=source.id
      AND reservation.object_key=source.object_key AND reservation.method='PUT' AND reservation.state='COMMITTED'
      AND reservation.checksum_sha256=source.binary_sha256 AND reservation.content_length=source.byte_size
      AND reservation.content_type=source.content_type
    JOIN public.artifact_receipts receipt ON receipt.account_id=reservation.account_id
      AND receipt.workspace_id=reservation.workspace_id AND receipt.reservation_id=reservation.id
      AND receipt.deleted_at IS NULL AND receipt.object_key=source.object_key
      AND receipt.checksum_sha256=source.binary_sha256 AND receipt.content_length=source.byte_size
      AND receipt.content_type=source.content_type
$old$ IN definition)=0 OR position($projection$source.object_key source_object_key,source.content_type source_content_type,$projection$ IN definition)=0 THEN
  RAISE EXCEPTION 'selected-span materializer reviewed preimage mismatch' USING ERRCODE='55000';
 END IF;
 definition:=replace(definition,$old$    JOIN public.artifact_reservations reservation ON reservation.account_id=s.account_id
      AND reservation.workspace_id=s.workspace_id AND reservation.asset_id=source.id
      AND reservation.object_key=source.object_key AND reservation.method='PUT' AND reservation.state='COMMITTED'
      AND reservation.checksum_sha256=source.binary_sha256 AND reservation.content_length=source.byte_size
      AND reservation.content_type=source.content_type
    JOIN public.artifact_receipts receipt ON receipt.account_id=reservation.account_id
      AND receipt.workspace_id=reservation.workspace_id AND receipt.reservation_id=reservation.id
      AND receipt.deleted_at IS NULL AND receipt.object_key=source.object_key
      AND receipt.checksum_sha256=source.binary_sha256 AND receipt.content_length=source.byte_size
      AND receipt.content_type=source.content_type
$old$,$new$    JOIN LATERAL (
      SELECT reservation.object_key,receipt.id,
        EXISTS(SELECT 1 FROM public.hosted_canonical_timing_bridges bridge
          JOIN public.hosted_cpu_job_attempts asr ON asr.account_id=bridge.account_id
            AND asr.workspace_id=bridge.workspace_id AND asr.id=bridge.hosted_asr_attempt_id
            AND asr.project_id=bridge.project_id AND asr.project_revision_id=bridge.project_revision_id
            AND asr.kind='ASR' AND asr.state='SUCCEEDED' AND asr.result_receipt_sha256 IS NOT NULL
            AND asr.job_spec_checksum_sha256=bridge.asr_input_sha256
            AND asr.result_checksum_sha256=bridge.asr_result_sha256
          JOIN public.media_worker_input_objects input ON input.account_id=asr.account_id
            AND input.workspace_id=asr.workspace_id AND input.attempt_id=asr.id
            AND input.object_key=reservation.object_key AND input.checksum_sha256=source.binary_sha256
            AND input.content_length=source.byte_size AND input.content_type=source.content_type
          WHERE bridge.account_id=s.account_id AND bridge.workspace_id=s.workspace_id
            AND bridge.project_id=supplied_project_id AND bridge.project_revision_id=revision.id
            AND bridge.timeline_plan_id=head.current_timeline_plan_id
            AND bridge.transcript_id=head.current_transcript_id) AS current_asr_input
      FROM public.artifact_reservations reservation
      JOIN public.artifact_receipts receipt ON receipt.account_id=reservation.account_id
        AND receipt.workspace_id=reservation.workspace_id AND receipt.reservation_id=reservation.id
        AND receipt.deleted_at IS NULL AND receipt.object_key=reservation.object_key
        AND receipt.checksum_sha256=source.binary_sha256 AND receipt.content_length=source.byte_size
        AND receipt.content_type=source.content_type
      WHERE reservation.account_id=s.account_id AND reservation.workspace_id=s.workspace_id
        AND reservation.asset_id=source.id AND reservation.method='PUT' AND reservation.state='COMMITTED'
        AND reservation.checksum_sha256=source.binary_sha256 AND reservation.content_length=source.byte_size
        AND reservation.content_type=source.content_type AND reservation.project_id=supplied_project_id
        AND (reservation.project_revision_id=revision.id OR EXISTS(
          SELECT 1 FROM public.cloud_media_asr_recoveries recovery
           WHERE recovery.account_id=receipt.account_id AND recovery.workspace_id=receipt.workspace_id
             AND recovery.project_id=reservation.project_id AND recovery.project_revision_id=revision.id
             AND recovery.source_receipt_id=receipt.id))
      ORDER BY current_asr_input DESC,(reservation.object_key=source.object_key) DESC,receipt.id
      LIMIT 1
    ) receipt ON receipt.current_asr_input OR (
      revision.media_execution_backend='PERSONAL_WORKER' AND receipt.object_key=source.object_key)
$new$);
 definition:=replace(definition,$projection$source.object_key source_object_key,source.content_type source_content_type,$projection$,$projection$receipt.object_key source_object_key,source.content_type source_content_type,$projection$);
 EXECUTE definition;
END;
$migration$;
