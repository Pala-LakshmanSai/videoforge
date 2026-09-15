-- 0147_hosted_v209_stranded_request_reclaim.sql
--
-- The pair-settle path deliberately keeps a generation request ACTIVE while CPU rendering owns
-- RENDERING -> COMPLETE (0043). Nothing settled a request whose render then reached a terminal
-- failure, so one abandoned video held the account's single active-video slot forever: every
-- later dispatch inserted a queued request, the promotion to ACTIVE collided with
-- generation_requests_one_active_video_per_account_uq, and the whole admission transaction rolled
-- back as a generic dispatch rejection that named no cause.
--
-- 0115 reclaimed a stranded lease whose holder had stopped observing. This reclaims the stranded
-- request those leases belonged to, and only on evidence that the work is definitively over:
-- no unexpired active lease, a runtime that is FAILED or still RENDERING, at least one terminal
-- RENDER job, and no in-flight RENDER job. A request with any live or pending work is untouched.

CREATE FUNCTION public.videoforge_settle_stranded_hosted_v209_requests(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  stranded public.generation_requests%ROWTYPE;
  capacity public.global_generation_capacity%ROWTYPE;
  settled integer:=0;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'hosted V2-09 stranded request reclaim tenant scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT * INTO capacity FROM public.global_generation_capacity WHERE singleton;
  FOR stranded IN
    SELECT row.* FROM public.generation_requests row
     WHERE row.account_id=supplied_account_id
       AND row.workspace_id=supplied_workspace_id
       AND row.state IN ('ADMITTED','ACTIVE','CANCELLING')
       AND NOT EXISTS (
         SELECT 1 FROM public.provider_workload_leases lease
          WHERE lease.generation_request_id=row.id
            AND lease.state='ACTIVE' AND lease.released_at IS NULL AND lease.expires_at>db_now)
       AND EXISTS (
         SELECT 1 FROM public.video_runtime_states runtime
          WHERE runtime.generation_request_id=row.id AND runtime.stage IN ('FAILED','RENDERING'))
       AND EXISTS (
         SELECT 1 FROM public.hosted_cpu_job_attempts job
          WHERE job.project_id=row.project_id AND job.project_revision_id=row.project_revision_id
            AND job.kind='RENDER'
            AND job.state IN ('FAILED','PERMANENT_FAILED','CANCELLED','EXPIRED','DEAD_LETTER'))
       AND NOT EXISTS (
         SELECT 1 FROM public.hosted_cpu_job_attempts job
          WHERE job.project_id=row.project_id AND job.project_revision_id=row.project_revision_id
            AND job.kind='RENDER'
            AND job.state IN ('PLANNED','OUTBOXED','SUBMITTED','RUNNING','RECONCILING','CANCEL_REQUESTED'))
     ORDER BY row.created_at,row.id
     FOR UPDATE
  LOOP
    UPDATE public.video_runtime_states
       SET stage='FAILED',terminal_reason='RENDER_FAILURE',terminal_at=db_now,
           version=version+1,updated_at=db_now
     WHERE generation_request_id=stranded.id AND stage='RENDERING';
    UPDATE public.provider_workload_leases
       SET state='RELEASED',released_at=COALESCE(released_at,db_now),
           release_reason=COALESCE(release_reason,'HOSTED_PAIR_RENDER_TERMINAL_FAILED'),
           version=version+1,heartbeat_at=db_now,
           expires_at=greatest(expires_at,db_now+interval '1 second')
     WHERE generation_request_id=stranded.id AND state='ACTIVE' AND released_at IS NULL;
    UPDATE public.generation_requests
       SET state='FAILED',terminal_at=db_now,version=version+1,updated_at=db_now
     WHERE id=stranded.id AND state IN ('ADMITTED','ACTIVE','CANCELLING');
    INSERT INTO public.generation_queue_audits(
      id,account_id,workspace_id,actor_user_id,operation,request_kind,request_id,lease_id,
      request_version_before,request_version_after,video_cursor_before,video_cursor_after,
      preview_cursor_before,preview_cursor_after,detail,occurred_at)
    VALUES(
      md5('v209-stranded-request-reclaim:'||stranded.id::text)::uuid,
      supplied_account_id,supplied_workspace_id,supplied_user_id,'TERMINAL_RELEASE','VIDEO',
      stranded.id,NULL,stranded.version,stranded.version+1,
      capacity.video_fair_cursor,capacity.video_fair_cursor,
      capacity.preview_fair_cursor,capacity.preview_fair_cursor,
      jsonb_build_object('source','V209_STRANDED_REQUEST_RECLAIM','terminalState','FAILED',
        'runtimeStage','RENDER_TERMINAL_RETRY_EXHAUSTED','providerActionsCreated',false),db_now)
    ON CONFLICT(id) DO NOTHING;
    settled:=settled+1;
  END LOOP;
  RETURN settled;
END;
$function$;

REVOKE ALL ON FUNCTION public.videoforge_settle_stranded_hosted_v209_requests(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_settle_stranded_hosted_v209_requests(uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;

-- Preserve the reviewed admission body verbatim and reclaim immediately before it, so a stranded
-- request can never occupy the one-active-video-per-account slot at the moment of promotion.
ALTER FUNCTION public.videoforge_admit_hosted_v209_generation(uuid,uuid,uuid,uuid)
  RENAME TO videoforge_admit_hosted_v209_generation_after_reclaim;

REVOKE ALL ON FUNCTION public.videoforge_admit_hosted_v209_generation_after_reclaim(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_admit_hosted_v209_generation_after_reclaim(uuid,uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;

CREATE FUNCTION public.videoforge_admit_hosted_v209_generation(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid, supplied_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  PERFORM public.videoforge_settle_stranded_hosted_v209_requests(
    supplied_account_id,supplied_workspace_id,supplied_user_id);
  RETURN public.videoforge_admit_hosted_v209_generation_after_reclaim(
    supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.videoforge_admit_hosted_v209_generation(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_admit_hosted_v209_generation(uuid,uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;
