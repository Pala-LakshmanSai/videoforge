-- Explicit bounded Cloud transcription recovery. Preserve terminal requests and immutable inputs.
CREATE TABLE cloud_media_asr_recoveries (
 failed_attempt_id uuid PRIMARY KEY,
 account_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
 previous_revision_id uuid NOT NULL, project_revision_id uuid NOT NULL UNIQUE,
 source_receipt_id uuid NOT NULL, retry_ordinal integer NOT NULL CHECK(retry_ordinal BETWEEN 2 AND 3),
 created_by_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,workspace_id,failed_attempt_id) REFERENCES hosted_cpu_job_attempts(account_id,workspace_id,id),
 FOREIGN KEY(account_id,workspace_id,previous_revision_id) REFERENCES project_revisions(account_id,workspace_id,id),
 FOREIGN KEY(account_id,workspace_id,project_revision_id) REFERENCES project_revisions(account_id,workspace_id,id),
 FOREIGN KEY(source_receipt_id) REFERENCES artifact_receipts(id)
);
ALTER TABLE cloud_media_asr_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_media_asr_recoveries FORCE ROW LEVEL SECURITY;
CREATE POLICY cloud_media_asr_recovery_tenant ON cloud_media_asr_recoveries
 USING(account_id=public.videoforge_current_account_id()) WITH CHECK(account_id=public.videoforge_current_account_id());
CREATE TRIGGER cloud_media_asr_recovery_tenant_write BEFORE INSERT OR UPDATE ON cloud_media_asr_recoveries
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
REVOKE ALL ON cloud_media_asr_recoveries FROM PUBLIC;
GRANT SELECT ON cloud_media_asr_recoveries TO videoforge_v209_runtime_dc9612d6;

CREATE FUNCTION public.videoforge_prepare_cloud_media_asr_recovery(
 supplied_account_id uuid,supplied_workspace_id uuid,supplied_user_id uuid,
 supplied_project_id uuid,supplied_failed_attempt_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE failed hosted_cpu_job_attempts%ROWTYPE; previous project_revisions%ROWTYPE;
 recovery cloud_media_asr_recoveries%ROWTYPE; source_receipt artifact_receipts%ROWTYPE;
 next_revision uuid:=gen_random_uuid(); next_payload jsonb; total_attempts integer; now_at timestamptz:=transaction_timestamp();
BEGIN
 IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id OR NOT EXISTS(
   SELECT 1 FROM memberships m WHERE m.account_id=supplied_account_id AND m.workspace_id=supplied_workspace_id
    AND m.user_id=supplied_user_id AND m.status='ACTIVE') THEN
  RAISE EXCEPTION 'cloud ASR recovery owner rejected' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM projects p WHERE p.id=supplied_project_id AND p.account_id=supplied_account_id
  AND p.workspace_id=supplied_workspace_id AND p.owner_user_id=supplied_user_id AND p.status='ACTIVE'
  AND p.generation_provider='KIE_FAL' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'cloud ASR recovery project rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO recovery FROM cloud_media_asr_recoveries WHERE failed_attempt_id=supplied_failed_attempt_id;
 IF recovery.failed_attempt_id IS NOT NULL THEN
  IF (recovery.account_id,recovery.workspace_id,recovery.project_id,recovery.created_by_user_id) IS DISTINCT FROM
    (supplied_account_id,supplied_workspace_id,supplied_project_id,supplied_user_id) THEN
   RAISE EXCEPTION 'cloud ASR recovery replay owner rejected' USING ERRCODE='42501'; END IF;
  RETURN recovery.project_revision_id;
 END IF;
 SELECT * INTO failed FROM hosted_cpu_job_attempts a WHERE a.id=supplied_failed_attempt_id
  AND a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
  AND a.project_id=supplied_project_id FOR UPDATE;
 SELECT * INTO previous FROM project_revisions r WHERE r.id=failed.project_revision_id
  AND r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id AND r.project_id=supplied_project_id;
 IF failed.id IS NULL OR failed.kind<>'ASR' OR failed.execution_backend<>'RUNPOD_POD'
  OR failed.state<>'FAILED' OR failed.terminal_at IS NULL OR failed.result_receipt_sha256 IS NOT NULL
  OR previous.id IS NULL OR previous.status<>'LOCKED' OR previous.media_execution_backend<>'RUNPOD_POD'
  OR previous.revision_config_payload->>'project_id' IS DISTINCT FROM previous.project_id::text
  OR previous.revision_config_payload->>'project_revision_id' IS DISTINCT FROM previous.id::text
  OR previous.revision_config_hash IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(previous.revision_config_payload),'UTF8')),'hex')
  OR previous.id IS DISTINCT FROM (SELECT r.id FROM project_revisions r WHERE r.project_id=supplied_project_id
    AND r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id ORDER BY r.revision_number DESC,r.id DESC LIMIT 1)
  OR failed.id IS DISTINCT FROM (SELECT a.id FROM hosted_cpu_job_attempts a WHERE a.project_revision_id=previous.id
    AND a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id AND a.kind='ASR'
    ORDER BY a.created_at DESC,a.id DESC LIMIT 1)
  OR NOT EXISTS(SELECT 1 FROM generation_requests g WHERE g.project_revision_id=previous.id
    AND g.account_id=supplied_account_id AND g.workspace_id=supplied_workspace_id AND g.state='FAILED' AND g.terminal_at IS NOT NULL)
  OR EXISTS(SELECT 1 FROM generation_requests g WHERE g.project_id=supplied_project_id
    AND g.account_id=supplied_account_id AND g.workspace_id=supplied_workspace_id AND g.state NOT IN ('SUCCEEDED','FAILED','CANCELLED'))
  OR EXISTS(SELECT 1 FROM cloud_media_reservations r WHERE r.account_id=supplied_account_id
    AND (r.state<>'CLEAN' OR (r.project_revision_id=previous.id AND r.failure_settled_at IS NULL)))
  OR EXISTS(SELECT 1 FROM provider_workload_leases l WHERE l.account_id=supplied_account_id AND l.state='ACTIVE')
  OR EXISTS(SELECT 1 FROM media_worker_leases l JOIN hosted_cpu_job_attempts a ON a.id=l.attempt_id
    WHERE a.account_id=supplied_account_id AND a.project_id=supplied_project_id AND l.state IN ('CLAIMED','RUNNING','COMPLETING'))
  OR EXISTS(SELECT 1 FROM hosted_cpu_job_attempts a WHERE a.project_revision_id=previous.id AND
    (a.state='SUCCEEDED' OR a.result_receipt_sha256 IS NOT NULL OR a.state IN ('RUNNING','SUBMITTED','RECONCILING','CANCEL_REQUESTED')))
  OR EXISTS(SELECT 1 FROM hosted_voiceover_contexts c WHERE c.project_revision_id=previous.id
    AND (c.context_hash IS NOT NULL OR c.state<>'FAILED'))
  OR EXISTS(SELECT 1 FROM hosted_prompt_runs p WHERE p.project_revision_id=previous.id)
  OR EXISTS(SELECT 1 FROM generation_tasks t WHERE t.project_revision_id=previous.id AND t.lane='PROMPT')
  OR EXISTS(SELECT 1 FROM video_runtime_states v WHERE v.project_revision_id=previous.id)
  OR EXISTS(SELECT 1 FROM hosted_api_generation_jobs j WHERE j.project_revision_id=previous.id)
  OR EXISTS(SELECT 1 FROM hosted_canonical_timing_bridges b WHERE b.project_revision_id=previous.id) THEN
  RAISE EXCEPTION 'cloud ASR recovery not eligible' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO total_attempts FROM hosted_cpu_job_attempts a JOIN project_revisions r ON r.id=a.project_revision_id
  WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id AND a.project_id=supplied_project_id
    AND a.kind='ASR' AND r.voiceover_binary_sha256=previous.voiceover_binary_sha256;
 -- Cloud failures consume the ordinary substantive ceiling. The independent total ceiling remains explicit.
 IF total_attempts<1 OR total_attempts>=3 OR total_attempts>=12 THEN
  RAISE EXCEPTION 'cloud ASR recovery bounded limit reached' USING ERRCODE='23514'; END IF;
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
  project_revision_id,source_receipt_id,retry_ordinal,created_by_user_id)
 VALUES(failed.id,supplied_account_id,supplied_workspace_id,supplied_project_id,previous.id,next_revision,
  source_receipt.id,total_attempts+1,supplied_user_id);
 -- Old unstarted siblings cannot rent later. Accepted and executing work failed the guards above.
 UPDATE hosted_cpu_job_attempts a SET state='CANCELLED',submitted_at=COALESCE(submitted_at,now_at),terminal_at=now_at,
  retain_until=GREATEST(a.deadline_at,now_at+interval '30 minutes'),version=version+1,updated_at=now_at
 WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id AND a.project_revision_id=previous.id
   AND a.execution_backend='RUNPOD_POD' AND a.kind IN ('SPAN_AUDIO','RENDER') AND a.state IN ('PLANNED','OUTBOXED')
   AND a.result_receipt_sha256 IS NULL AND NOT EXISTS(SELECT 1 FROM cloud_media_jobs j WHERE j.attempt_id=a.id);
 RETURN next_revision;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_prepare_cloud_media_asr_recovery(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_prepare_cloud_media_asr_recovery(uuid,uuid,uuid,uuid,uuid)
 TO videoforge_v209_runtime_dc9612d6;
