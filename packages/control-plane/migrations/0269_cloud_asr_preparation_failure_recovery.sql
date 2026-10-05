-- A CPU submission may fail in application preparation before generation admission
-- or any rental exists. Accept only the exact immutable preparation-failure marker;
-- retain every owner, revision, receipt, latest-attempt and cleanup guard from 0215/0265.
DO $migration$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_prepare_cloud_media_asr_recovery(uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 marker:=$old$OR NOT EXISTS(SELECT 1 FROM generation_requests g WHERE g.project_revision_id=previous.id
    AND g.account_id=supplied_account_id AND g.workspace_id=supplied_workspace_id AND g.state='FAILED' AND g.terminal_at IS NOT NULL)$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'ASR preparation recovery preimage mismatch'; END IF;
 EXECUTE replace(definition,marker,$new$OR (NOT EXISTS(SELECT 1 FROM generation_requests g WHERE g.project_revision_id=previous.id
    AND g.account_id=supplied_account_id AND g.workspace_id=supplied_workspace_id AND g.state='FAILED' AND g.terminal_at IS NOT NULL)
   AND NOT(
    NOT EXISTS(SELECT 1 FROM generation_requests g WHERE g.project_revision_id=previous.id)
    AND failed.provider_operation_name IS NULL AND failed.provider_operation_name_sha256 IS NULL
    AND failed.provider_execution_name IS NULL AND failed.execution_name_sha256 IS NULL
    AND failed.result_receipt_sha256 IS NULL AND failed.result_content_length IS NULL AND failed.result_checksum_sha256 IS NULL
    AND failed.failure_code IS NULL AND failed.replay_count=0 AND failed.cancellation_requested_at IS NULL AND failed.retention_deleted_at IS NULL
    AND EXISTS(SELECT 1 FROM hosted_cpu_job_events e WHERE e.account_id=supplied_account_id
     AND e.workspace_id=supplied_workspace_id AND e.attempt_id=failed.id
     AND e.id=md5(failed.id::text||':preparation-failed:1')::uuid AND e.sequence=1 AND e.kind='FAILED'
     AND e.facts_sha256='sha256:'||encode(sha256(convert_to('PREPARATION_FAILED:'||failed.job_spec_checksum_sha256,'UTF8')),'hex')
     AND e.occurred_at=failed.terminal_at)
    AND NOT EXISTS(SELECT 1 FROM hosted_cpu_job_events e WHERE e.attempt_id=failed.id
     AND (e.id<>md5(failed.id::text||':preparation-failed:1')::uuid OR e.sequence<>1 OR e.kind<>'FAILED'))
    AND NOT EXISTS(SELECT 1 FROM cloud_media_reservations rental WHERE rental.project_revision_id=previous.id)
    AND NOT EXISTS(SELECT 1 FROM cloud_media_jobs job JOIN hosted_cpu_job_attempts attempt ON attempt.id=job.attempt_id
     WHERE attempt.project_revision_id=previous.id)
    AND NOT EXISTS(SELECT 1 FROM media_worker_leases lease JOIN hosted_cpu_job_attempts attempt ON attempt.id=lease.attempt_id
     WHERE attempt.project_revision_id=previous.id)
   ))$new$);
END; $migration$;
