-- A terminal video and an uncertain Cloud rental have separate lifecycles.
-- Keep UNKNOWN/STOPPING, rental capacity, budget debit and reconciliation intact.
-- Only Local videos may proceed after every execution of the failed video is fenced.
CREATE FUNCTION public.videoforge_cloud_cleanup_only(target_reservation uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT COALESCE(EXISTS(
  SELECT 1 FROM cloud_media_reservations r
  JOIN cloud_media_budget_authorities b ON b.id=r.budget_authority_id
  JOIN hosted_cpu_job_attempts a ON a.id=r.leased_attempt_id
    AND a.account_id=r.account_id AND a.workspace_id=r.workspace_id
    AND a.project_id=r.project_id AND a.project_revision_id=r.project_revision_id
  WHERE r.id=target_reservation AND r.account_id=public.videoforge_current_account_id()
    AND r.state='STOPPING' AND r.launch_outcome='UNKNOWN' AND r.pod_id IS NULL
    AND r.cleanup_verified_at IS NULL AND r.deadline_at<=now()
    AND (NOT b.enabled OR b.expires_at<=now())
    AND a.state IN ('FAILED','CANCELLED','EXPIRED') AND a.terminal_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM hosted_cpu_job_attempts sibling
      WHERE sibling.account_id=r.account_id AND sibling.workspace_id=r.workspace_id
        AND sibling.project_id=r.project_id AND sibling.project_revision_id=r.project_revision_id
        AND (sibling.state NOT IN ('SUCCEEDED','FAILED','CANCELLED','EXPIRED') OR sibling.terminal_at IS NULL))
    AND NOT EXISTS(SELECT 1 FROM hosted_api_generation_jobs j
      WHERE j.account_id=r.account_id AND j.workspace_id=r.workspace_id
        AND j.project_id=r.project_id AND j.project_revision_id=r.project_revision_id)
    AND NOT EXISTS(SELECT 1 FROM media_worker_leases l JOIN hosted_cpu_job_attempts personal
      ON personal.id=l.attempt_id AND personal.account_id=l.account_id AND personal.workspace_id=l.workspace_id
      WHERE personal.account_id=r.account_id AND personal.workspace_id=r.workspace_id
        AND personal.project_id=r.project_id AND personal.project_revision_id=r.project_revision_id
        AND l.state IN ('CLAIMED','RUNNING','COMPLETING'))
 ),false);
$$;
REVOKE ALL ON FUNCTION public.videoforge_cloud_cleanup_only(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_cloud_cleanup_only(uuid) TO videoforge_v209_runtime_dc9612d6;

DO $migration$
DECLARE definition text; old_guard text; new_guard text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_settle_cloud_media_cpu_failure(uuid)'::regprocedure) INTO definition;
 old_guard:=$old$ canceled:=a.state='CANCELLED';$old$;
 new_guard:=$new$ canceled:=a.state='CANCELLED';
 -- An early-media failure with no API jobs may retire its VIDEO admission only.
 -- The Cloud resource remains fenced and the reconciler continues to own cleanup.
 IF a.kind IN ('ASR','SPAN_AUDIO') AND EXISTS(SELECT 1 FROM cloud_media_reservations r
     WHERE r.account_id=a.account_id AND r.workspace_id=a.workspace_id AND r.project_id=a.project_id
       AND r.project_revision_id=a.project_revision_id AND public.videoforge_cloud_cleanup_only(r.id))
   AND NOT EXISTS(SELECT 1 FROM cloud_media_reservations r WHERE r.account_id=a.account_id
     AND r.workspace_id=a.workspace_id AND r.project_id=a.project_id AND r.project_revision_id=a.project_revision_id
     AND r.state<>'CLEAN' AND NOT public.videoforge_cloud_cleanup_only(r.id)) THEN
  SELECT * INTO request FROM generation_requests g WHERE g.account_id=a.account_id AND g.workspace_id=a.workspace_id
    AND g.project_id=a.project_id AND g.project_revision_id=a.project_revision_id
    ORDER BY g.created_at DESC,g.id DESC LIMIT 1 FOR UPDATE;
  IF request.id IS NULL THEN RETURN false; END IF;
  IF request.state IN ('FAILED','CANCELLED') THEN RETURN NOT EXISTS(
    SELECT 1 FROM provider_workload_leases l WHERE l.generation_request_id=request.id AND l.state='ACTIVE'); END IF;
  IF request.state NOT IN ('ACTIVE','ADMITTED','CANCELLING') OR request.terminal_at IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=request.project_id AND p.account_id=a.account_id
      AND p.workspace_id=a.workspace_id AND p.owner_user_id=request.created_by_user_id AND p.generation_provider='KIE_FAL')
    OR EXISTS(SELECT 1 FROM video_runtime_states v WHERE v.generation_request_id=request.id
      AND (v.stage<>'WAITING_FOR_WORKER' OR v.terminal_at IS NOT NULL)) THEN RETURN false; END IF;
  UPDATE generation_tasks SET state=CASE WHEN canceled THEN 'CANCELLED' ELSE 'FAILED' END,
    finished_at=now_at,version=version+1,updated_at=now_at
    WHERE account_id=a.account_id AND workspace_id=a.workspace_id AND project_revision_id=a.project_revision_id
      AND state NOT IN ('COMPLETE','FAILED','CANCELLED');
  UPDATE video_runtime_lane_states lane SET state=CASE WHEN canceled THEN 'CANCELED' ELSE 'FAILED' END,
    version=lane.version+1,updated_at=now_at FROM video_runtime_states v
    WHERE v.id=lane.runtime_id AND v.generation_request_id=request.id AND lane.state NOT IN ('SUCCEEDED','FAILED','CANCELED');
  UPDATE video_runtime_states SET stage=CASE WHEN canceled THEN 'CANCELED' ELSE 'FAILED' END,
    terminal_reason=CASE WHEN canceled THEN 'OWNER_CANCELLED' ELSE 'LANE_PERMANENT_FAILURE' END,
    terminal_at=now_at,version=version+1,updated_at=now_at WHERE generation_request_id=request.id;
  UPDATE generation_requests SET state=CASE WHEN canceled THEN 'CANCELLED' ELSE 'FAILED' END,
    terminal_at=now_at,version=version+1,updated_at=now_at WHERE id=request.id;
  UPDATE provider_workload_leases SET state='RELEASED',released_at=now_at,release_reason='CLOUD_CLEANUP_ISOLATED',
    version=version+1,heartbeat_at=now_at,expires_at=GREATEST(expires_at,now_at+interval '1 second')
    WHERE account_id=a.account_id AND workspace_id=a.workspace_id AND generation_request_id=request.id
      AND request_kind='VIDEO' AND state='ACTIVE';
  GET DIAGNOSTICS lease_count=ROW_COUNT;
  IF lease_count<>1 THEN RAISE EXCEPTION 'Cloud isolation exact video lease missing' USING ERRCODE='55000'; END IF;
  RETURN true;
 END IF;$new$;
 IF (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1 THEN
  RAISE EXCEPTION 'Cloud failure settlement preimage drifted'; END IF;
 EXECUTE replace(definition,old_guard,new_guard);

 SELECT pg_get_functiondef('public.videoforge_guard_admission_against_cloud_cleanup()'::regprocedure) INTO definition;
 old_guard:=$old$AND r.state NOT IN ('WAITING_CAPACITY','CLEAN') AND (NEW.request_kind<>'VIDEO' OR NOT EXISTS($old$;
 new_guard:=$new$AND r.state NOT IN ('WAITING_CAPACITY','CLEAN')
   AND NOT (public.videoforge_cloud_cleanup_only(r.id) AND NEW.request_kind='VIDEO' AND EXISTS(
     SELECT 1 FROM generation_requests local_request JOIN project_revisions revision
       ON revision.id=local_request.project_revision_id AND revision.account_id=local_request.account_id
       AND revision.workspace_id=local_request.workspace_id AND revision.project_id=local_request.project_id
     WHERE local_request.id=NEW.generation_request_id AND local_request.account_id=NEW.account_id
       AND local_request.workspace_id=NEW.workspace_id AND revision.media_execution_backend='PERSONAL_WORKER'))
   AND (NEW.request_kind<>'VIDEO' OR NOT EXISTS($new$;
 IF (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1 THEN
  RAISE EXCEPTION 'Cloud admission cleanup preimage drifted'; END IF;
 EXECUTE replace(definition,old_guard,new_guard);
END;
$migration$;
