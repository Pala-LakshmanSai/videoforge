-- Backend-aware read projection only; existing guarded recovery functions remain authoritative.
CREATE OR REPLACE FUNCTION public.videoforge_read_hosted_api_render_recovery_status(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_user_id uuid,
  supplied_project_id uuid,supplied_bundle_sha256 text
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
WITH candidate AS (
  SELECT request.*,runtime.id AS runtime_id,runtime.stage AS runtime_stage,
    runtime.terminal_reason,runtime.final_output_sha256,runtime.render_manifest_sha256,
    failed.id AS failed_id,failed.state AS failed_state,failed.execution_bundle_sha256,failed.image_digest,
    failed.result_content_length,failed.result_checksum_sha256,failed.result_receipt_sha256,
    failed.execution_backend,
    CASE WHEN failed.execution_backend='RUNPOD_POD' THEN failed.failure_code ELSE failure.failure_code END AS failure_code,
    (SELECT count(*) FROM hosted_cpu_job_attempts a WHERE a.account_id=request.account_id
      AND a.workspace_id=request.workspace_id AND a.project_revision_id=request.project_revision_id
      AND a.kind='RENDER') AS attempt_count
  FROM generation_requests request
  JOIN projects project ON project.account_id=request.account_id AND project.workspace_id=request.workspace_id
    AND project.id=request.project_id AND project.generation_provider='KIE_FAL' AND project.status='ACTIVE'
  JOIN video_runtime_states runtime ON runtime.account_id=request.account_id
    AND runtime.workspace_id=request.workspace_id AND runtime.generation_request_id=request.id
  JOIN LATERAL (SELECT a.* FROM hosted_cpu_job_attempts a WHERE a.account_id=request.account_id
    AND a.workspace_id=request.workspace_id AND a.project_revision_id=request.project_revision_id
    AND a.kind='RENDER' ORDER BY a.created_at DESC,a.id DESC LIMIT 1) failed ON true
  LEFT JOIN LATERAL (SELECT l.failure_code FROM media_worker_leases l WHERE l.account_id=failed.account_id
    AND l.workspace_id=failed.workspace_id AND l.attempt_id=failed.id AND l.state='FAILED'
    ORDER BY l.created_at DESC LIMIT 1) failure ON true
  WHERE request.account_id=supplied_account_id AND request.workspace_id=supplied_workspace_id
    AND request.project_id=supplied_project_id AND request.created_by_user_id=supplied_user_id
    AND public.videoforge_current_account_id()=supplied_account_id
    AND (failed.execution_backend='RUNPOD_POD' OR failure.failure_code IS NOT NULL)
  ORDER BY request.created_at DESC,request.id DESC LIMIT 1
), status AS (
  SELECT failed_id,CASE
    WHEN state<>'FAILED' OR failed_state<>'FAILED' OR runtime_stage<>'FAILED'
      OR terminal_reason<>'RENDER_FAILURE' THEN 'NOT_FAILED'
    WHEN attempt_count>=5 THEN 'RETRY_LIMIT_REACHED'
    WHEN failure_code IN ('RENDER_INPUT_INVALID','RENDER_OUTPUT_INVALID')
      AND execution_bundle_sha256=supplied_bundle_sha256 THEN 'WORKER_UPDATE_REQUIRED'
    WHEN failure_code IS NULL OR (failure_code NOT IN ('RENDER_INPUT_INVALID','RENDER_OUTPUT_INVALID','RENDER_PROCESS_FAILED',
      'MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT','MEDIA_EXECUTION_IO_FAILED',
      'MEDIA_EXECUTION_TIMEOUT','MEDIA_EXECUTION_SUBPROCESS_FAILED','MEDIA_EXECUTION_FAILED')
      AND NOT (execution_backend='RUNPOD_POD' AND failure_code IN (
        'CLOUD_MEDIA_CAPACITY_EXHAUSTED','CLOUD_MEDIA_DEADLINE_EXCEEDED','CLOUD_MEDIA_PROVIDER_FAILED',
        'CLOUD_MEDIA_RUNTIME_MISMATCH','CLOUD_MEDIA_RUNTIME_PIN_MISMATCH','CLOUD_MEDIA_RUNTIME_REJECTED',
        'CLOUD_MEDIA_UPLOAD_FAILED','CLOUD_MEDIA_FAILED','CLOUD_MEDIA_PLACEMENT_REJECTED')))
      THEN 'FAILURE_NOT_RECOVERABLE'
    WHEN execution_backend='RUNPOD_POD' AND EXISTS (
      SELECT 1 FROM cloud_media_reservations r WHERE r.account_id=candidate.account_id
        AND (r.state<>'CLEAN' OR r.cleanup_verified_at IS NULL)) THEN 'CLEANUP_PENDING'
    WHEN image_digest IS NULL OR image_digest !~ '^sha256:[0-9a-f]{64}$'
      OR execution_bundle_sha256 IS DISTINCT FROM image_digest
      OR attempt_count NOT BETWEEN 1 AND 4
      OR final_output_sha256 IS NOT NULL OR render_manifest_sha256 IS NULL
      OR result_content_length IS NOT NULL OR result_checksum_sha256 IS NOT NULL
      OR result_receipt_sha256 IS NOT NULL
      OR EXISTS (SELECT 1 FROM hosted_cpu_upload_authorities a WHERE a.attempt_id=failed_id AND a.issued_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM serverless_attempts a WHERE a.generation_request_id=candidate.id)
      OR NOT EXISTS (SELECT 1 FROM provider_workload_leases l WHERE l.generation_request_id=candidate.id
        AND l.state='RELEASED' AND l.release_reason='HOSTED_API_OUTPUTS_ACCEPTED')
      OR EXISTS (SELECT 1 FROM provider_workload_leases l WHERE l.generation_request_id=candidate.id AND l.state='ACTIVE')
      OR NOT EXISTS (SELECT 1 FROM hosted_render_plans p WHERE p.account_id=candidate.account_id
        AND p.workspace_id=candidate.workspace_id AND p.project_id=candidate.project_id
        AND p.project_revision_id=candidate.project_revision_id AND p.payload->>'kind'='RENDER'
        AND p.payload_sha256='sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb(p.payload),'UTF8')),'hex'))
      OR EXISTS (SELECT 1 FROM video_runtime_events e WHERE e.runtime_id=candidate.runtime_id AND e.reason='FINAL_OUTPUT_DURABLE')
      OR NOT public.videoforge_v209_api_outputs_accepted(account_id,workspace_id,id,runtime_id)
      THEN 'ACCEPTED_INPUTS_NOT_READY'
    ELSE 'ELIGIBLE' END AS reason
  FROM candidate
)
SELECT COALESCE((SELECT jsonb_build_object('eligible',reason='ELIGIBLE','reason',reason,
  'failed_attempt_id',failed_id,'attempt_limit',5,'provider_calls_authorized',false) FROM status),
  jsonb_build_object('eligible',false,'reason','NOT_FAILED','attempt_limit',5,'provider_calls_authorized',false));
$$;
REVOKE ALL ON FUNCTION public.videoforge_read_hosted_api_render_recovery_status(uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_read_hosted_api_render_recovery_status(uuid,uuid,uuid,uuid,text)
  TO videoforge_v209_runtime_dc9612d6;
