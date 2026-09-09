-- Tenant-owned cancellation for a hosted video that has not crossed the provider boundary.
--
-- Project archive already refuses active work.  This capability closes the matching product
-- gap: it can terminalize an admitted ordinary generation only while every provider attempt is
-- still PLANNED and no outbox send, assignment, materialization, or provider reconciliation exists.

CREATE FUNCTION public.videoforge_cancel_hosted_project_predispatch(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_project_id uuid
) RETURNS TABLE (
  project_id uuid,
  generation_request_id uuid,
  state text,
  replayed boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_account_id uuid := public.videoforge_current_account_id();
  target_request public.generation_requests%ROWTYPE;
  target_runtime public.video_runtime_states%ROWTYPE;
  target_lease public.provider_workload_leases%ROWTYPE;
  capacity public.global_generation_capacity%ROWTYPE;
  request_count integer;
  request_version_before integer;
  active_cpu_count integer;
  attempt_count integer;
  provider_boundary_count integer;
  db_now timestamptz := transaction_timestamp();
BEGIN
  IF current_account_id IS NULL OR current_account_id IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'hosted project cancellation tenant mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces workspace
     WHERE workspace.account_id=supplied_account_id
       AND workspace.id=supplied_workspace_id AND workspace.status='ACTIVE'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.projects project
     WHERE project.account_id=supplied_account_id
       AND project.workspace_id=supplied_workspace_id
       AND project.id=supplied_project_id AND project.status='ACTIVE'
  ) THEN
    RAISE EXCEPTION 'hosted project cancellation scope unavailable' USING ERRCODE='42501';
  END IF;

  SELECT count(*) INTO request_count
    FROM public.generation_requests request
   WHERE request.account_id=supplied_account_id
     AND request.workspace_id=supplied_workspace_id
     AND request.project_id=supplied_project_id
     AND request.state IN ('WAITING','RETRY_WAIT','ADMITTED','ACTIVE','CANCELLING');
  IF request_count<>1 THEN
    RAISE EXCEPTION 'hosted project active generation unavailable' USING ERRCODE='55000';
  END IF;

  SELECT request.* INTO target_request
    FROM public.generation_requests request
   WHERE request.account_id=supplied_account_id
     AND request.workspace_id=supplied_workspace_id
     AND request.project_id=supplied_project_id
     AND request.state IN ('WAITING','RETRY_WAIT','ADMITTED','ACTIVE','CANCELLING')
   FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_request.id::text,43));

  SELECT count(*) INTO active_cpu_count
    FROM public.hosted_cpu_job_attempts attempt
   WHERE attempt.account_id=supplied_account_id
     AND attempt.workspace_id=supplied_workspace_id
     AND attempt.project_id=supplied_project_id
     AND attempt.state IN ('PLANNED','OUTBOXED','SUBMITTED','RUNNING','RECONCILING','CANCEL_REQUESTED');
  IF active_cpu_count<>0 THEN
    RAISE EXCEPTION 'hosted project CPU cancellation required' USING ERRCODE='55000';
  END IF;

  SELECT count(*) INTO attempt_count FROM public.serverless_attempts attempt
   WHERE attempt.account_id=supplied_account_id
     AND attempt.workspace_id=supplied_workspace_id
     AND attempt.generation_request_id=target_request.id;
  IF attempt_count NOT IN (0,2) OR EXISTS (
    SELECT 1 FROM public.serverless_attempts attempt
     WHERE attempt.account_id=supplied_account_id
       AND attempt.workspace_id=supplied_workspace_id
       AND attempt.generation_request_id=target_request.id
       AND attempt.state<>'PLANNED'
  ) THEN
    RAISE EXCEPTION 'hosted project provider-safe cancellation unavailable' USING ERRCODE='55000';
  END IF;

  SELECT
    (SELECT count(*) FROM public.serverless_provider_assignments assignment
      JOIN public.serverless_attempts attempt ON attempt.id=assignment.attempt_id
     WHERE attempt.account_id=supplied_account_id
       AND attempt.workspace_id=supplied_workspace_id
       AND attempt.generation_request_id=target_request.id)
    +(SELECT count(*) FROM public.serverless_dispatch_outbox outbox
      JOIN public.serverless_attempts attempt ON attempt.id=outbox.attempt_id
     WHERE attempt.account_id=supplied_account_id
       AND attempt.workspace_id=supplied_workspace_id
       AND attempt.generation_request_id=target_request.id
       AND (outbox.send_attempt_count<>0 OR outbox.state IN
         ('SENT','DISPATCH_ACK_UNKNOWN','ASSIGNED','TERMINAL')))
    +(SELECT count(*) FROM public.hosted_v209_ordinary_lane_materializations materialization
     WHERE materialization.account_id=supplied_account_id
       AND materialization.workspace_id=supplied_workspace_id
       AND materialization.generation_request_id=target_request.id)
    +(SELECT count(*) FROM public.serverless_progress_events event
      JOIN public.serverless_attempts attempt ON attempt.id=event.attempt_id
     WHERE attempt.account_id=supplied_account_id
       AND attempt.workspace_id=supplied_workspace_id
       AND attempt.generation_request_id=target_request.id)
    +(SELECT count(*) FROM public.serverless_output_receipts receipt
      JOIN public.serverless_attempts attempt ON attempt.id=receipt.attempt_id
     WHERE attempt.account_id=supplied_account_id
       AND attempt.workspace_id=supplied_workspace_id
       AND attempt.generation_request_id=target_request.id)
    +(SELECT count(*) FROM public.serverless_cancellations cancellation
      JOIN public.serverless_attempts attempt ON attempt.id=cancellation.attempt_id
     WHERE attempt.account_id=supplied_account_id
       AND attempt.workspace_id=supplied_workspace_id
       AND attempt.generation_request_id=target_request.id)
    +(SELECT count(*) FROM public.serverless_reconciliations reconciliation
      JOIN public.serverless_attempts attempt ON attempt.id=reconciliation.attempt_id
     WHERE attempt.account_id=supplied_account_id
       AND attempt.workspace_id=supplied_workspace_id
       AND attempt.generation_request_id=target_request.id)
    INTO provider_boundary_count;
  IF provider_boundary_count<>0 THEN
    RAISE EXCEPTION 'hosted project provider reconciliation required' USING ERRCODE='55000';
  END IF;

  SELECT runtime.* INTO target_runtime FROM public.video_runtime_states runtime
   WHERE runtime.account_id=supplied_account_id
     AND runtime.workspace_id=supplied_workspace_id
     AND runtime.generation_request_id=target_request.id FOR UPDATE;
  IF target_runtime.id IS NULL OR target_runtime.stage IN ('COMPLETE','FAILED','CANCELED') THEN
    RAISE EXCEPTION 'hosted project runtime cancellation unavailable' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hosted_pair_runtime_states pair
    WHERE pair.account_id=supplied_account_id AND pair.workspace_id=supplied_workspace_id
      AND pair.generation_request_id=target_request.id) THEN
    RAISE EXCEPTION 'hosted project provider runtime reconciliation required' USING ERRCODE='55000';
  END IF;

  SELECT lease.* INTO target_lease FROM public.provider_workload_leases lease
   WHERE lease.account_id=supplied_account_id AND lease.workspace_id=supplied_workspace_id
     AND lease.generation_request_id=target_request.id AND lease.state='ACTIVE' FOR UPDATE;
  IF target_request.state IN ('ADMITTED','ACTIVE','CANCELLING') AND target_lease.id IS NULL THEN
    RAISE EXCEPTION 'hosted project active lease unavailable' USING ERRCODE='55000';
  END IF;

  UPDATE public.serverless_dispatch_outbox outbox
     SET state='DEAD_LETTER',lease_id=NULL,lease_holder_sha256=NULL,
         leased_at=NULL,lease_expires_at=NULL,version=outbox.version+1,updated_at=db_now
    FROM public.serverless_attempts attempt
   WHERE attempt.id=outbox.attempt_id
     AND attempt.account_id=supplied_account_id
     AND attempt.workspace_id=supplied_workspace_id
     AND attempt.generation_request_id=target_request.id
     AND outbox.send_attempt_count=0 AND outbox.state IN ('READY_TO_DISPATCH','LEASED');
  UPDATE public.serverless_attempts attempt
     SET state='CANCELLED',terminal_at=db_now,version=attempt.version+1,updated_at=db_now
   WHERE attempt.account_id=supplied_account_id
     AND attempt.workspace_id=supplied_workspace_id
     AND attempt.generation_request_id=target_request.id AND attempt.state='PLANNED';
  UPDATE public.video_runtime_lane_states lane
     SET state='CANCELED',current_attempt_id=NULL,version=lane.version+1,updated_at=db_now
   WHERE lane.account_id=supplied_account_id AND lane.workspace_id=supplied_workspace_id
     AND lane.runtime_id=target_runtime.id AND lane.state NOT IN ('SUCCEEDED','FAILED','CANCELED');
  UPDATE public.video_runtime_states runtime
     SET stage='CANCELED',
         terminal_reason=CASE WHEN runtime.admitted_at IS NULL
           THEN 'SYSTEM_CANCELLED' ELSE 'OWNER_CANCELLED' END,
         terminal_at=db_now,
         version=runtime.version+1,updated_at=db_now
   WHERE runtime.id=target_runtime.id AND runtime.account_id=supplied_account_id
     AND runtime.workspace_id=supplied_workspace_id AND runtime.version=target_runtime.version;
  UPDATE public.generation_tasks task
     SET state='CANCELLED',cancel_requested_at=db_now,finished_at=db_now,
         version=task.version+1,updated_at=db_now
   WHERE task.account_id=supplied_account_id AND task.workspace_id=supplied_workspace_id
     AND task.project_revision_id=target_request.project_revision_id
     AND task.state NOT IN ('FAILED','CANCELLED','COMPLETE');
  IF target_lease.id IS NOT NULL THEN
    UPDATE public.provider_workload_leases lease
       SET state='RELEASED',released_at=db_now,
           release_reason='OWNER_CANCELLED_BEFORE_PROVIDER_DISPATCH',
           heartbeat_at=db_now,expires_at=greatest(lease.expires_at,db_now+interval '1 second'),
           version=lease.version+1
     WHERE lease.id=target_lease.id AND lease.state='ACTIVE';
  END IF;
  request_version_before:=target_request.version;
  UPDATE public.generation_requests request
     SET state='CANCELLED',terminal_at=db_now,version=request.version+1,updated_at=db_now
   WHERE request.id=target_request.id AND request.account_id=supplied_account_id
     AND request.workspace_id=supplied_workspace_id AND request.version=target_request.version;

  SELECT row.* INTO capacity FROM public.global_generation_capacity row WHERE row.singleton FOR SHARE;
  INSERT INTO public.generation_queue_audits(
    id,account_id,workspace_id,actor_user_id,operation,request_kind,request_id,lease_id,
    request_version_before,request_version_after,video_cursor_before,video_cursor_after,
    preview_cursor_before,preview_cursor_after,detail,occurred_at)
  VALUES(md5('hosted-project-owner-predispatch-cancel:'||target_request.id::text)::uuid,
    target_request.account_id,target_request.workspace_id,target_request.created_by_user_id,
    CASE WHEN target_lease.id IS NULL THEN 'CANCEL_WAITING' ELSE 'TERMINAL_RELEASE' END,
    'VIDEO',target_request.id,target_lease.id,request_version_before,request_version_before+1,
    capacity.video_fair_cursor,capacity.video_fair_cursor,
    capacity.preview_fair_cursor,capacity.preview_fair_cursor,
    jsonb_build_object('reason','OWNER_CANCELLED_BEFORE_PROVIDER_DISPATCH',
      'providerActionsCreated',false,'redispatch',false),db_now);

  IF EXISTS (SELECT 1 FROM public.provider_workload_leases lease
      WHERE lease.generation_request_id=target_request.id AND lease.state='ACTIVE')
     OR EXISTS (SELECT 1 FROM public.serverless_attempts attempt
      WHERE attempt.generation_request_id=target_request.id AND attempt.state<>'CANCELLED')
     OR NOT EXISTS (SELECT 1 FROM public.generation_requests request
      WHERE request.id=target_request.id AND request.state='CANCELLED')
     OR NOT EXISTS (SELECT 1 FROM public.video_runtime_states runtime
      WHERE runtime.id=target_runtime.id AND runtime.stage='CANCELED'
        AND runtime.terminal_reason=CASE WHEN target_runtime.admitted_at IS NULL
          THEN 'SYSTEM_CANCELLED' ELSE 'OWNER_CANCELLED' END) THEN
    RAISE EXCEPTION 'hosted project cancellation postcondition failed' USING ERRCODE='55000';
  END IF;

  project_id:=supplied_project_id;
  generation_request_id:=target_request.id;
  state:='CANCELLED';
  replayed:=false;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.videoforge_cancel_hosted_project_predispatch(uuid,uuid,uuid) IS
  'Cancel one tenant-owned hosted generation only before any provider dispatch evidence exists.';
REVOKE ALL ON FUNCTION public.videoforge_cancel_hosted_project_predispatch(uuid,uuid,uuid)
  FROM PUBLIC;
