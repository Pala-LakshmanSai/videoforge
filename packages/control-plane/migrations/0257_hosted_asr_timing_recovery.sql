-- Operator-only recovery of an accepted but unschedulable Cloud ASR result.
-- The operator must verify exact accepted output bytes and timing outliers before calling.
-- Preserve historical ASR/context/revision evidence; retain a scoped input alias and paid-stage hold.
ALTER TABLE public.cloud_media_asr_recoveries ADD COLUMN preparation_only boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.videoforge_prepare_hosted_asr_timing_recovery(
 supplied_account_id uuid,supplied_workspace_id uuid,supplied_user_id uuid,
 supplied_project_id uuid,supplied_revision_id uuid,supplied_attempt_id uuid,supplied_output_sha256 text
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE accepted public.hosted_cpu_job_attempts%ROWTYPE; previous public.project_revisions%ROWTYPE;
 recovery public.cloud_media_asr_recoveries%ROWTYPE; source_receipt public.artifact_receipts%ROWTYPE;
 request public.generation_requests%ROWTYPE; lease public.provider_workload_leases%ROWTYPE;
 next_revision uuid:=gen_random_uuid(); next_payload jsonb; total_attempts integer;
 now_at timestamptz:=transaction_timestamp(); changed integer;
BEGIN
 IF supplied_account_id IS DISTINCT FROM public.videoforge_current_account_id() OR NOT EXISTS(
  SELECT 1 FROM public.memberships m WHERE m.account_id=supplied_account_id AND m.workspace_id=supplied_workspace_id
   AND m.user_id=supplied_user_id AND m.status='ACTIVE') THEN
  RAISE EXCEPTION 'ASR timing recovery owner rejected' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.projects p WHERE p.id=supplied_project_id AND p.account_id=supplied_account_id
  AND p.workspace_id=supplied_workspace_id AND p.owner_user_id=supplied_user_id AND p.status='ACTIVE'
  AND p.generation_provider='KIE_FAL' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ASR timing recovery project rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO recovery FROM public.cloud_media_asr_recoveries WHERE failed_attempt_id=supplied_attempt_id;
 SELECT * INTO accepted FROM public.hosted_cpu_job_attempts a WHERE a.id=supplied_attempt_id
  AND a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id AND a.project_id=supplied_project_id
  AND a.project_revision_id=supplied_revision_id FOR UPDATE;
 IF accepted.id IS NULL OR accepted.kind<>'ASR' OR accepted.state<>'SUCCEEDED' OR accepted.terminal_at IS NULL
  OR accepted.execution_backend<>'RUNPOD_POD' OR accepted.result_receipt_sha256 IS NULL
  OR supplied_output_sha256 IS NULL OR accepted.result_checksum_sha256 IS DISTINCT FROM supplied_output_sha256 THEN
  RAISE EXCEPTION 'ASR timing recovery accepted identity rejected' USING ERRCODE='23514'; END IF;
 IF recovery.failed_attempt_id IS NOT NULL THEN
  IF (recovery.account_id,recovery.workspace_id,recovery.project_id,recovery.previous_revision_id,recovery.created_by_user_id)
    IS DISTINCT FROM (supplied_account_id,supplied_workspace_id,supplied_project_id,supplied_revision_id,supplied_user_id)
    OR NOT recovery.preparation_only THEN
   RAISE EXCEPTION 'ASR timing recovery replay rejected' USING ERRCODE='42501'; END IF;
  RETURN recovery.project_revision_id;
 END IF;
 SELECT * INTO previous FROM public.project_revisions r WHERE r.id=supplied_revision_id
  AND r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id AND r.project_id=supplied_project_id;
 IF previous.id IS NULL OR previous.status<>'LOCKED' OR previous.media_execution_backend<>'RUNPOD_POD'
  OR previous.revision_config_hash IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(previous.revision_config_payload),'UTF8')),'hex')
  OR previous.revision_config_payload->>'project_id' IS DISTINCT FROM supplied_project_id::text
  OR previous.revision_config_payload->>'project_revision_id' IS DISTINCT FROM supplied_revision_id::text
  OR previous.id IS DISTINCT FROM (SELECT r.id FROM public.project_revisions r WHERE r.project_id=supplied_project_id
    AND r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id ORDER BY revision_number DESC,id DESC LIMIT 1)
  OR EXISTS(SELECT 1 FROM public.hosted_cpu_job_attempts a WHERE a.project_id=supplied_project_id
    AND a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id AND a.id<>accepted.id
    AND (a.project_revision_id=previous.id OR a.state NOT IN('SUCCEEDED','FAILED','CANCELLED','EXPIRED')))
  OR EXISTS(SELECT 1 FROM public.cloud_media_reservations r WHERE r.account_id=supplied_account_id AND r.state<>'CLEAN'
    AND (r.project_id=supplied_project_id OR NOT public.videoforge_cloud_cleanup_only(r.id)))
  OR EXISTS(SELECT 1 FROM public.media_worker_leases l JOIN public.hosted_cpu_job_attempts a ON a.id=l.attempt_id
    WHERE a.account_id=supplied_account_id AND a.project_id=supplied_project_id AND l.state IN('CLAIMED','RUNNING','COMPLETING'))
  OR EXISTS(SELECT 1 FROM public.hosted_prompt_runs p WHERE p.project_revision_id=previous.id)
  OR EXISTS(SELECT 1 FROM public.generation_tasks t WHERE t.project_revision_id=previous.id AND
    (t.lane<>'PROMPT' OR t.state<>'COMPLETE'))
  OR EXISTS(SELECT 1 FROM public.video_runtime_states v WHERE v.project_revision_id=previous.id)
  OR EXISTS(SELECT 1 FROM public.hosted_api_generation_jobs j WHERE j.project_revision_id=previous.id)
  OR EXISTS(SELECT 1 FROM public.hosted_video_jobs j WHERE j.project_revision_id=previous.id)
  OR EXISTS(SELECT 1 FROM public.hosted_canonical_timing_bridges b WHERE b.project_revision_id=previous.id)
  OR EXISTS(SELECT 1 FROM public.timeline_plans p WHERE p.project_revision_id=previous.id) THEN
  RAISE EXCEPTION 'ASR timing recovery downstream or cleanup not eligible' USING ERRCODE='23514'; END IF;
 SELECT * INTO request FROM public.generation_requests g WHERE g.project_revision_id=previous.id
  AND g.account_id=supplied_account_id AND g.workspace_id=supplied_workspace_id AND g.state='ACTIVE' FOR UPDATE;
 IF request.id IS NULL OR (SELECT count(*) FROM public.generation_requests g WHERE g.account_id=supplied_account_id
   AND g.project_id=supplied_project_id AND g.state NOT IN('SUCCEEDED','FAILED','CANCELLED'))<>1
  OR EXISTS(SELECT 1 FROM public.serverless_attempts a WHERE a.generation_request_id=request.id)
  OR EXISTS(SELECT 1 FROM public.hosted_v209_ordinary_lane_materializations m WHERE m.generation_request_id=request.id) THEN
  RAISE EXCEPTION 'ASR timing recovery admission not eligible' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(request.id::text,43));
 PERFORM 1 FROM public.global_generation_capacity WHERE singleton FOR UPDATE;
 SELECT * INTO lease FROM public.provider_workload_leases l WHERE l.generation_request_id=request.id
  AND l.account_id=supplied_account_id AND l.workspace_id=supplied_workspace_id AND l.request_kind='VIDEO' AND l.state='ACTIVE' FOR UPDATE;
 IF lease.id IS NULL THEN RAISE EXCEPTION 'ASR timing recovery active lease missing' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO total_attempts FROM public.hosted_cpu_job_attempts a JOIN public.project_revisions r ON r.id=a.project_revision_id
  WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id AND a.project_id=supplied_project_id
   AND a.kind='ASR' AND r.voiceover_binary_sha256=previous.voiceover_binary_sha256;
 IF total_attempts<1 OR total_attempts>=3 THEN
  RAISE EXCEPTION 'ASR timing recovery bounded limit reached' USING ERRCODE='23514'; END IF;
 SELECT receipt.* INTO source_receipt FROM artifact_receipts receipt JOIN artifact_reservations reserved ON reserved.id=receipt.reservation_id
  AND reserved.account_id=receipt.account_id AND reserved.workspace_id=receipt.workspace_id
  WHERE receipt.account_id=supplied_account_id AND receipt.workspace_id=supplied_workspace_id AND receipt.deleted_at IS NULL
    AND reserved.project_id=supplied_project_id AND reserved.asset_id=previous.voiceover_asset_id
    AND reserved.state='COMMITTED' AND reserved.lane='INPUT' AND receipt.checksum_sha256=previous.voiceover_binary_sha256
    AND (reserved.project_revision_id=previous.id OR EXISTS(SELECT 1 FROM cloud_media_asr_recoveries prior
      WHERE prior.project_revision_id=previous.id AND prior.source_receipt_id=receipt.id
        AND prior.account_id=supplied_account_id AND prior.workspace_id=supplied_workspace_id AND prior.project_id=supplied_project_id))
  ORDER BY receipt.committed_at,receipt.id LIMIT 1;
 IF source_receipt.id IS NULL OR NOT EXISTS(SELECT 1 FROM assets a WHERE a.id=previous.voiceover_asset_id
  AND a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id AND a.kind='VOICEOVER' AND a.state='VERIFIED'
  AND a.binary_sha256=source_receipt.checksum_sha256) THEN
  RAISE EXCEPTION 'cloud ASR recovery retained voiceover missing' USING ERRCODE='23514'; END IF;
 next_payload:=previous.revision_config_payload||jsonb_build_object('project_revision_id',next_revision::text);
 INSERT INTO project_revisions SELECT (jsonb_populate_record(NULL::project_revisions,to_jsonb(previous)||jsonb_build_object(
  'id',next_revision,'revision_number',previous.revision_number+1,'created_at',now_at,'locked_at',now_at,
  'created_by_user_id',supplied_user_id,'revision_config_payload',next_payload,
  'revision_config_hash','sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(next_payload),'UTF8')),'hex')))).*;
 INSERT INTO cloud_media_asr_recoveries(failed_attempt_id,account_id,workspace_id,project_id,previous_revision_id,
  project_revision_id,source_receipt_id,retry_ordinal,created_by_user_id,preparation_only)
 VALUES(accepted.id,supplied_account_id,supplied_workspace_id,supplied_project_id,previous.id,next_revision,
  source_receipt.id,total_attempts+1,supplied_user_id,true);
 PERFORM public.videoforge_copy_hosted_video_plan(supplied_account_id,supplied_workspace_id,previous.id,next_revision)
  WHERE EXISTS(SELECT 1 FROM public.hosted_video_plans WHERE project_revision_id=previous.id
   AND account_id=supplied_account_id AND workspace_id=supplied_workspace_id);
 UPDATE public.generation_requests SET state='CANCELLED',terminal_at=now_at,version=version+1,updated_at=now_at
  WHERE id=request.id AND state='ACTIVE' AND version=request.version;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'ASR timing recovery request changed' USING ERRCODE='55000'; END IF;
 UPDATE public.provider_workload_leases SET state='RELEASED',released_at=now_at,release_reason='ASR_TIMING_RECOVERY_BEFORE_PLANNING',
  heartbeat_at=now_at,expires_at=greatest(expires_at,now_at+interval '1 second'),version=version+1
  WHERE id=lease.id AND state='ACTIVE' AND version=lease.version;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'ASR timing recovery lease changed' USING ERRCODE='55000'; END IF;
 INSERT INTO public.generation_queue_audits(id,account_id,workspace_id,actor_user_id,operation,request_kind,
  request_id,lease_id,request_version_before,request_version_after,video_cursor_before,video_cursor_after,
  preview_cursor_before,preview_cursor_after,detail,occurred_at)
 SELECT md5('ASR-timing-recovery:'||request.id)::uuid,supplied_account_id,supplied_workspace_id,supplied_user_id,
  'TERMINAL_RELEASE','VIDEO',request.id,lease.id,request.version,request.version+1,
  video_fair_cursor,video_fair_cursor,preview_fair_cursor,preview_fair_cursor,
  jsonb_build_object('reason','ASR_TIMING_RECOVERY_BEFORE_PLANNING','accepted_attempt_id',accepted.id,
   'accepted_output_sha256',supplied_output_sha256,'successor_revision_id',next_revision,'preparation_only',true,
   'providerActionsCreated',false,'redispatch',false),now_at
  FROM public.global_generation_capacity WHERE singleton;
 RETURN next_revision;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_prepare_hosted_asr_timing_recovery(uuid,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
-- No runtime grant: only a privileged operator with exact verified output may prepare this recovery.

DO $migration$
DECLARE definition text; preimage text:='  WITH latest_revision AS ('; replacement text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_load_hosted_prompt_plan(uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 replacement:=$hold$  IF EXISTS(SELECT 1 FROM public.cloud_media_asr_recoveries recovery
    WHERE recovery.account_id=supplied_account_id AND recovery.workspace_id=supplied_workspace_id
      AND recovery.project_id=supplied_project_id AND recovery.preparation_only
      AND recovery.project_revision_id=(SELECT r.id FROM public.project_revisions r
        WHERE r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id
          AND r.project_id=supplied_project_id ORDER BY r.revision_number DESC,r.id DESC LIMIT 1)) THEN
    RETURN jsonb_build_object('preparation_only',true);
  END IF;
  WITH latest_revision AS ($hold$;
 IF (length(definition)-length(replace(definition,preimage,'')))/length(preimage)<>1 THEN
  RAISE EXCEPTION 'ASR timing recovery prompt preimage changed'; END IF;
 EXECUTE replace(definition,preimage,replacement);
END; $migration$;
