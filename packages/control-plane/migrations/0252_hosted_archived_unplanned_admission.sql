-- An archived, unplanned video must not retain its admission slot after a planning failure.
-- Archive's existing guards run first. Never release provider-bound or uncertain work here.
DO $migration$
DECLARE definition text; old_return text; new_return text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_archive_hosted_project(uuid,uuid,uuid)'::regprocedure) INTO definition;
 old_return:=$old$  project_id := supplied_project_id;$old$;
 new_return:=$new$  -- Replaying archive can settle a previously archived pre-planning request too.
  PERFORM public.videoforge_retire_archived_unplanned_admission(
    supplied_account_id,supplied_workspace_id,supplied_project_id);
  project_id := supplied_project_id;$new$;
 IF (length(definition)-length(replace(definition,old_return,'')))/length(old_return)<>1 THEN
  RAISE EXCEPTION 'archive admission preimage changed'; END IF;
 EXECUTE replace(definition,old_return,new_return);
END; $migration$;

CREATE FUNCTION public.videoforge_retire_archived_unplanned_admission(a uuid,w uuid,p uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE request public.generation_requests%ROWTYPE; lease public.provider_workload_leases%ROWTYPE;
 now_at timestamptz:=transaction_timestamp(); changed integer;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN
  RAISE EXCEPTION 'archive admission tenant mismatch' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=p AND account_id=a AND workspace_id=w AND status='ARCHIVED') THEN RETURN false; END IF;
 PERFORM 1 FROM public.global_generation_capacity WHERE singleton FOR UPDATE;
 SELECT * INTO request FROM public.generation_requests g WHERE g.account_id=a AND g.workspace_id=w
  AND g.project_id=p AND g.state IN('ACTIVE','ADMITTED') ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF request.id IS NULL THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(request.id::text,43));
 IF EXISTS(SELECT 1 FROM public.video_runtime_states WHERE generation_request_id=request.id)
  OR EXISTS(SELECT 1 FROM public.serverless_attempts WHERE generation_request_id=request.id)
  OR EXISTS(SELECT 1 FROM public.hosted_api_generation_jobs WHERE generation_request_id=request.id)
  OR EXISTS(SELECT 1 FROM public.hosted_video_jobs WHERE generation_request_id=request.id)
  OR EXISTS(SELECT 1 FROM public.hosted_v209_ordinary_lane_materializations WHERE generation_request_id=request.id)
  OR EXISTS(SELECT 1 FROM public.hosted_cpu_job_attempts WHERE account_id=a AND workspace_id=w AND project_id=p
    AND (state NOT IN('SUCCEEDED','FAILED','CANCELLED','EXPIRED') OR terminal_at IS NULL))
  OR EXISTS(SELECT 1 FROM public.cloud_media_reservations WHERE account_id=a AND workspace_id=w AND project_id=p AND state<>'CLEAN') THEN RETURN false; END IF;
 SELECT * INTO lease FROM public.provider_workload_leases l WHERE l.account_id=a AND l.workspace_id=w
  AND l.generation_request_id=request.id AND l.request_kind='VIDEO' AND l.state='ACTIVE' FOR UPDATE;
 IF lease.id IS NULL THEN RETURN false; END IF;
 UPDATE public.generation_tasks SET state='CANCELLED',cancel_requested_at=now_at,finished_at=now_at,
  version=version+1,updated_at=now_at WHERE account_id=a AND workspace_id=w
  AND project_revision_id=request.project_revision_id AND state NOT IN('COMPLETE','FAILED','CANCELLED');
 UPDATE public.generation_requests SET state='CANCELLED',terminal_at=now_at,version=version+1,updated_at=now_at WHERE id=request.id;
 UPDATE public.provider_workload_leases SET state='RELEASED',released_at=now_at,
  release_reason='ARCHIVED_UNPLANNED_VIDEO',heartbeat_at=now_at,
  expires_at=greatest(expires_at,now_at+interval '1 second'),version=version+1 WHERE id=lease.id AND state='ACTIVE';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'archive exact admission release failed' USING ERRCODE='55000'; END IF;
 INSERT INTO public.generation_queue_audits(id,account_id,workspace_id,actor_user_id,operation,request_kind,
  request_id,lease_id,request_version_before,request_version_after,video_cursor_before,video_cursor_after,
  preview_cursor_before,preview_cursor_after,detail,occurred_at)
 SELECT md5('archive-unplanned-admission:'||request.id)::uuid,a,w,request.created_by_user_id,'TERMINAL_RELEASE','VIDEO',
  request.id,lease.id,request.version,request.version+1,video_fair_cursor,video_fair_cursor,
  preview_fair_cursor,preview_fair_cursor,jsonb_build_object('reason','ARCHIVED_UNPLANNED_VIDEO',
   'providerActionsCreated',false,'redispatch',false),now_at FROM public.global_generation_capacity WHERE singleton;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_retire_archived_unplanned_admission(uuid,uuid,uuid) FROM PUBLIC;
