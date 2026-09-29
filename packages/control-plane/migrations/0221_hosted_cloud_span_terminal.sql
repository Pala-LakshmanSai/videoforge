-- Accepted Cloud spans use their exact immutable reservation membership and receipt.
-- A desktop device/lease is never fabricated for a Linux Pod. The completion event
-- was published atomically with the CPU receipt after the controller's exact fence check.
CREATE FUNCTION public.videoforge_cloud_span_completion_proven(
 supplied_account_id uuid,supplied_workspace_id uuid,supplied_attempt_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT coalesce(supplied_account_id=public.videoforge_current_account_id() AND EXISTS(
  SELECT 1 FROM public.hosted_cpu_job_attempts a
  JOIN public.cloud_media_jobs j ON j.attempt_id=a.id
    AND j.account_id=a.account_id AND j.workspace_id=a.workspace_id
  JOIN public.cloud_media_reservations r ON r.id=j.reservation_id
    AND r.account_id=a.account_id AND r.workspace_id=a.workspace_id
    AND r.project_id=a.project_id AND r.project_revision_id=a.project_revision_id
  JOIN public.cloud_media_jobs current_job ON current_job.reservation_id=r.id
    AND current_job.attempt_id=r.leased_attempt_id AND current_job.claim_ordinal=r.span_job_count
    AND current_job.account_id=r.account_id AND current_job.workspace_id=r.workspace_id
  JOIN public.hosted_cpu_job_attempts current_attempt ON current_attempt.id=r.leased_attempt_id
    AND current_attempt.account_id=r.account_id AND current_attempt.workspace_id=r.workspace_id
    AND current_attempt.project_id=r.project_id AND current_attempt.project_revision_id=r.project_revision_id
    AND current_attempt.kind='SPAN_AUDIO' AND current_attempt.execution_backend='RUNPOD_POD'
    AND current_attempt.image_digest=r.source_sha256 AND current_attempt.execution_bundle_sha256=r.source_sha256
  JOIN public.hosted_cpu_job_events e ON e.attempt_id=a.id
    AND e.account_id=a.account_id AND e.workspace_id=a.workspace_id AND e.kind='SUCCEEDED'
    AND e.facts_sha256='sha256:'||encode(sha256(convert_to(
      r.id::text||':SUCCEEDED:'||a.result_receipt_sha256,'UTF8')),'hex')
  WHERE a.id=supplied_attempt_id AND a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
    AND a.kind='SPAN_AUDIO' AND a.execution_backend='RUNPOD_POD' AND a.state='SUCCEEDED'
    AND a.terminal_at IS NOT NULL AND a.terminal_at>=j.claimed_at
    AND a.cancellation_requested_at IS NULL AND a.result_receipt_sha256 IS NOT NULL
    AND a.result_object_key IS NOT NULL AND a.result_content_length>0 AND a.result_checksum_sha256 IS NOT NULL
    AND a.image_digest=r.source_sha256 AND a.execution_bundle_sha256=r.source_sha256
    AND r.fence_id IS NOT NULL AND r.launch_outcome='CONFIRMED' AND r.verified_at IS NOT NULL
    AND r.pod_id IS NOT NULL AND r.state IN('STARTING','DOWNLOADING','RENDERING','CHECKING','SAVING','STOPPING','CLEAN')
    AND (r.state<>'CLEAN' OR r.cleanup_verified_at IS NOT NULL)
    AND j.claim_ordinal BETWEEN 1 AND r.span_job_count
    AND (j.attempt_id=r.leased_attempt_id OR j.claim_ordinal<current_job.claim_ordinal)
 ),false);
$$;
REVOKE ALL ON FUNCTION public.videoforge_cloud_span_completion_proven(uuid,uuid,uuid) FROM PUBLIC;

DO $migration$
DECLARE definition text; old_guard text; new_guard text; definer boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosecdef,p.proconfig INTO definition,definer,settings
 FROM pg_proc p WHERE p.oid='public.videoforge_finalize_hosted_v209_span_audio(uuid,uuid,uuid,jsonb)'::regprocedure;
 old_guard:=$old$     OR NOT EXISTS(SELECT 1 FROM public.media_worker_leases l
       WHERE l.account_id=supplied_account_id AND l.workspace_id=supplied_workspace_id
         AND l.attempt_id=supplied_attempt_id AND l.state='SUCCEEDED')$old$;
 new_guard:=$new$     OR NOT ((attempt.execution_backend='PERSONAL_WORKER' AND EXISTS(
       SELECT 1 FROM public.media_worker_leases l
       WHERE l.account_id=supplied_account_id AND l.workspace_id=supplied_workspace_id
         AND l.attempt_id=supplied_attempt_id AND l.state='SUCCEEDED'))
       OR (attempt.execution_backend='RUNPOD_POD' AND public.videoforge_cloud_span_completion_proven(
         supplied_account_id,supplied_workspace_id,supplied_attempt_id)))$new$;
 IF definer IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=public, pg_catalog']
   OR strpos(definition,'attempt.execution_backend NOT IN (''PERSONAL_WORKER'',''RUNPOD_POD'')')=0
   OR strpos(definition,'IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id')=0
   OR (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1 THEN
  RAISE EXCEPTION 'cloud span terminal reviewed preimage mismatch' USING ERRCODE='55000';
 END IF;
 -- CREATE OR REPLACE preserves the existing, independently verified runtime EXECUTE ACL.
 EXECUTE replace(definition,old_guard,new_guard);
END;
$migration$;
