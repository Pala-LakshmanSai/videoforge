-- 0161_hosted_v209_archived_project_queue_settlement.sql
--
-- An archived project can never be dispatched again, yet a queued WAITING request left behind by
-- that project stays at the head of the account's video queue. The promotion gate only clears
-- earlier same-account waiting requests, so every later project's dispatch answered WAITING
-- forever while an abandoned row it cannot see held the slot (observed 2026-09-16: archived
-- project 42bc0841's WAITING request blocked every other dispatch in the account).
--
-- Archive already refuses active work, but a queued request is not active work, so the gap is
-- exactly this row class. Settle it immediately before admission, and only on evidence that the
-- request never crossed the provider boundary: no active lease, no outbox send attempt, and no
-- attempt in a provider-owned state. Anything with live or pending work is untouched.

CREATE FUNCTION public.videoforge_settle_archived_project_queued_requests(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  capacity public.global_generation_capacity%ROWTYPE;
  abandoned public.generation_requests%ROWTYPE;
  settled integer:=0;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'hosted V2-09 archived project queue settlement tenant scope invalid'
      USING ERRCODE='42501';
  END IF;
  SELECT * INTO capacity FROM public.global_generation_capacity WHERE singleton;
  FOR abandoned IN
    SELECT row.* FROM public.generation_requests row
      JOIN public.projects project ON project.id=row.project_id
     WHERE row.account_id=supplied_account_id
       AND row.workspace_id=supplied_workspace_id
       AND row.state IN ('WAITING','RETRY_WAIT')
       AND project.status IS DISTINCT FROM 'ACTIVE'
       AND NOT EXISTS (
         SELECT 1 FROM public.provider_workload_leases lease
          WHERE lease.generation_request_id=row.id
            AND lease.state='ACTIVE' AND lease.released_at IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM public.serverless_dispatch_outbox outbox
          WHERE outbox.project_revision_id=row.project_revision_id
            AND outbox.send_attempt_count>0)
       AND NOT EXISTS (
         SELECT 1 FROM public.serverless_attempts attempt
          WHERE attempt.project_revision_id=row.project_revision_id
            AND attempt.state NOT IN ('PLANNED','FAILED','PERMANENT_FAILED','CANCELLED','EXPIRED',
              'DEAD_LETTER'))
     ORDER BY row.queue_order,row.id
     FOR UPDATE OF row
  LOOP
    UPDATE public.generation_requests
       SET state='FAILED',terminal_at=db_now,version=version+1,updated_at=db_now
     WHERE id=abandoned.id AND state IN ('WAITING','RETRY_WAIT');
    INSERT INTO public.generation_queue_audits(
      id,account_id,workspace_id,actor_user_id,operation,request_kind,request_id,lease_id,
      request_version_before,request_version_after,video_cursor_before,video_cursor_after,
      preview_cursor_before,preview_cursor_after,detail,occurred_at)
    VALUES(
      md5('v209-archived-project-queue-settlement:'||abandoned.id::text)::uuid,
      supplied_account_id,supplied_workspace_id,supplied_user_id,'TERMINAL_RELEASE','VIDEO',
      abandoned.id,NULL,abandoned.version,abandoned.version+1,
      capacity.video_fair_cursor,capacity.video_fair_cursor,
      capacity.preview_fair_cursor,capacity.preview_fair_cursor,
      jsonb_build_object('source','V209_ARCHIVED_PROJECT_QUEUE_SETTLEMENT','terminalState','FAILED',
        'providerBoundaryCrossed',false,'providerActionsCreated',false),db_now)
    ON CONFLICT(id) DO NOTHING;
    settled:=settled+1;
  END LOOP;
  RETURN settled;
END;
$function$;

REVOKE ALL ON FUNCTION public.videoforge_settle_archived_project_queued_requests(uuid,uuid,uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_settle_archived_project_queued_requests(uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;

-- Preserve the reviewed admission body verbatim and settle the abandoned queue rows immediately
-- before it, exactly like the stranded-request reclaim in 0147.
ALTER FUNCTION public.videoforge_admit_hosted_v209_generation(uuid,uuid,uuid,uuid)
  RENAME TO videoforge_admit_hosted_v209_generation_after_archive_settle;

REVOKE ALL ON FUNCTION
  public.videoforge_admit_hosted_v209_generation_after_archive_settle(uuid,uuid,uuid,uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.videoforge_admit_hosted_v209_generation_after_archive_settle(uuid,uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;

CREATE FUNCTION public.videoforge_admit_hosted_v209_generation(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid, supplied_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  PERFORM public.videoforge_settle_archived_project_queued_requests(
    supplied_account_id,supplied_workspace_id,supplied_user_id);
  RETURN public.videoforge_admit_hosted_v209_generation_after_archive_settle(
    supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.videoforge_admit_hosted_v209_generation(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_admit_hosted_v209_generation(uuid,uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;
