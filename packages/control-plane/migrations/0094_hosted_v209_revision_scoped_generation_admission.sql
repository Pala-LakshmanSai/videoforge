-- Migration 0094: admit the newest locked revision after older terminal generations.
-- Existing terminal rows remain immutable and only block an exact revision replay.

CREATE OR REPLACE FUNCTION public.videoforge_admit_hosted_v209_generation(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_user_id uuid,
  supplied_project_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  capacity_before public.global_generation_capacity%ROWTYPE;
  capacity_after public.global_generation_capacity%ROWTYPE;
  request public.generation_requests%ROWTYPE;
  selected_request public.generation_requests%ROWTYPE;
  lease public.provider_workload_leases%ROWTYPE;
  revision_id uuid;
  request_count integer;
  terminal_count integer;
  active_lease_count integer;
  available_slot smallint;
  request_version_before integer;
  next_sequence bigint;
  lease_id uuid;
  owner_token_sha256 text;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR NOT EXISTS (
       SELECT 1 FROM public.memberships membership
        WHERE membership.account_id=supplied_account_id
          AND membership.workspace_id=supplied_workspace_id
          AND membership.user_id=supplied_user_id
          AND membership.status='ACTIVE'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.projects project
        WHERE project.account_id=supplied_account_id
          AND project.workspace_id=supplied_workspace_id
          AND project.id=supplied_project_id
          AND project.status='ACTIVE'
          AND coalesce(project.project_kind,'USER')='USER'
     ) THEN
    RAISE EXCEPTION 'hosted V2-09 admission tenant or project scope invalid' USING ERRCODE='42501';
  END IF;

  -- Capacity is the global serialization point used by fair admission.  Lock it before the
  -- account head so promotion and enqueue cannot create two leases for one slot/account.
  SELECT * INTO capacity_before
    FROM public.global_generation_capacity
   WHERE singleton
   FOR UPDATE;
  IF capacity_before.singleton IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'hosted V2-09 global capacity row missing' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.account_queue_heads(account_id)
  VALUES(supplied_account_id)
  ON CONFLICT(account_id) DO NOTHING;
  PERFORM 1 FROM public.account_queue_heads head
   WHERE head.account_id=supplied_account_id
   FOR UPDATE;

  SELECT count(*) INTO request_count
    FROM public.generation_requests row
   WHERE row.account_id=supplied_account_id
     AND row.workspace_id=supplied_workspace_id
     AND row.project_id=supplied_project_id
     AND row.state IN ('WAITING','ADMITTED','ACTIVE','CANCELLING','RETRY_WAIT');
  IF request_count>1 THEN
    RAISE EXCEPTION 'hosted V2-09 project has multiple nonterminal requests' USING ERRCODE='23514';
  END IF;
  IF request_count=1 THEN
    SELECT row.* INTO request
      FROM public.generation_requests row
     WHERE row.account_id=supplied_account_id
       AND row.workspace_id=supplied_workspace_id
       AND row.project_id=supplied_project_id
       AND row.state IN ('WAITING','ADMITTED','ACTIVE','CANCELLING','RETRY_WAIT')
     ORDER BY row.created_at DESC,row.id DESC
     LIMIT 1
     FOR UPDATE;
  ELSE
    -- A terminal request blocks only an exact replay of its revision.  A newer locked
    -- revision gets one fresh request and keeps the older terminal evidence immutable.
    SELECT revision.id INTO revision_id
      FROM public.project_revisions revision
     WHERE revision.account_id=supplied_account_id
       AND revision.workspace_id=supplied_workspace_id
       AND revision.project_id=supplied_project_id
       AND revision.status='LOCKED'
     ORDER BY revision.revision_number DESC,revision.id DESC
     LIMIT 1
     FOR SHARE;
    IF revision_id IS NULL THEN
      RAISE EXCEPTION 'hosted V2-09 locked revision is missing' USING ERRCODE='23514';
    END IF;
    SELECT count(*) INTO terminal_count
      FROM public.generation_requests row
     WHERE row.account_id=supplied_account_id
       AND row.workspace_id=supplied_workspace_id
       AND row.project_id=supplied_project_id
       AND row.project_revision_id=revision_id
       AND row.state IN ('SUCCEEDED','FAILED','CANCELLED');
    IF terminal_count>0 THEN
      RAISE EXCEPTION 'hosted V2-09 terminal generation cannot be replayed' USING ERRCODE='23505';
    END IF;
    INSERT INTO public.generation_requests(
      id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,
      state,queue_order,available_at,attempt_ordinal,idempotency_key,version,
      admitted_at,terminal_at,created_at,updated_at)
    VALUES(
      gen_random_uuid(),supplied_account_id,supplied_workspace_id,supplied_project_id,revision_id,
      supplied_user_id,'WAITING',
      (SELECT coalesce(max(row.queue_order),0)+1 FROM public.generation_requests row
        WHERE row.account_id=supplied_account_id),
      db_now,1,'hosted-v209:'||supplied_project_id::text||':revision:'||revision_id::text||':generation',1,
      NULL,NULL,db_now,db_now)
    RETURNING * INTO request;
    INSERT INTO public.generation_queue_audits(
      id,account_id,workspace_id,actor_user_id,operation,request_kind,request_id,lease_id,
      request_version_before,request_version_after,video_cursor_before,video_cursor_after,
      preview_cursor_before,preview_cursor_after,detail,occurred_at)
    VALUES(
      gen_random_uuid(),supplied_account_id,supplied_workspace_id,supplied_user_id,'ENQUEUE','VIDEO',
      request.id,NULL,NULL,request.version,capacity_before.video_fair_cursor,
      capacity_before.video_fair_cursor,capacity_before.preview_fair_cursor,
      capacity_before.preview_fair_cursor,
      jsonb_build_object('queueOrder',request.queue_order,'providerActionsCreated',false),db_now);
  END IF;

  -- Prompt completion is the browser's only generation readiness handoff.  Bind the check to
  -- this exact request revision, require one complete scene-batch prompt task, and reject any
  -- required scene-batch prompt still in flight.
  IF request.created_by_user_id IS DISTINCT FROM supplied_user_id
     OR NOT EXISTS (
       SELECT 1 FROM public.project_revisions revision
        WHERE revision.account_id=supplied_account_id
          AND revision.workspace_id=supplied_workspace_id
          AND revision.project_id=supplied_project_id
          AND revision.id=request.project_revision_id
          AND revision.status='LOCKED'
     ) THEN
    RAISE EXCEPTION 'hosted V2-09 request revision or principal drifted' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.generation_tasks task
        WHERE task.workspace_id=supplied_workspace_id
          AND task.project_revision_id=request.project_revision_id
          AND task.owner_type='PROJECT_REVISION'
          AND task.lane='PROMPT'
          AND task.task_key LIKE 'prompt:scene-batch:%'
          AND task.state='COMPLETE'
     )
     OR EXISTS (
       SELECT 1 FROM public.generation_tasks task
        WHERE task.workspace_id=supplied_workspace_id
          AND task.project_revision_id=request.project_revision_id
          AND task.owner_type='PROJECT_REVISION'
          AND task.lane='PROMPT'
          AND task.task_key LIKE 'prompt:scene-batch:%'
          AND task.required
          AND task.state<>'COMPLETE'
     ) THEN
    RAISE EXCEPTION 'hosted V2-09 prompts are not ready' USING ERRCODE='55000';
  END IF;

  SELECT count(*) INTO active_lease_count
    FROM public.provider_workload_leases row
   WHERE row.account_id=supplied_account_id
     AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=request.id
     AND row.request_kind='VIDEO'
     AND row.state='ACTIVE';
  IF active_lease_count>1 THEN
    RAISE EXCEPTION 'hosted V2-09 request has multiple active leases' USING ERRCODE='23514';
  END IF;
  SELECT row.* INTO lease
    FROM public.provider_workload_leases row
   WHERE row.account_id=supplied_account_id
     AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=request.id
     AND row.request_kind='VIDEO'
     AND row.state='ACTIVE'
   ORDER BY row.acquired_at DESC,row.id DESC
   LIMIT 1
   FOR UPDATE;
  IF lease.id IS NOT NULL AND lease.expires_at<=db_now THEN
    RAISE EXCEPTION 'hosted V2-09 active lease expired' USING ERRCODE='55000';
  END IF;
  IF request.state='ACTIVE' AND lease.id IS NOT NULL THEN
    IF NOT EXISTS(
      SELECT 1 FROM public.video_runtime_states runtime
       WHERE runtime.account_id=supplied_account_id
         AND runtime.workspace_id=supplied_workspace_id
         AND runtime.generation_request_id=request.id
    ) THEN
      PERFORM public.videoforge_prepare_hosted_v209_runtime(
        supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id,request.id);
    END IF;
    RETURN jsonb_build_object('generationRequestId',request.id,'state','ACTIVE');
  END IF;
  IF request.state IN ('ACTIVE','ADMITTED') THEN
    IF lease.id IS NULL THEN
      RAISE EXCEPTION 'hosted V2-09 active admission lease drifted' USING ERRCODE='23514';
    END IF;
    IF request.state='ADMITTED' THEN
      request_version_before:=request.version;
      UPDATE public.generation_requests
         SET state='ACTIVE',version=version+1,updated_at=db_now
       WHERE account_id=supplied_account_id AND workspace_id=supplied_workspace_id
         AND id=request.id AND version=request_version_before;
      INSERT INTO public.generation_queue_audits(
        id,account_id,workspace_id,actor_user_id,operation,request_kind,request_id,lease_id,
        request_version_before,request_version_after,video_cursor_before,video_cursor_after,
        preview_cursor_before,preview_cursor_after,detail,occurred_at)
      VALUES(
        gen_random_uuid(),supplied_account_id,supplied_workspace_id,supplied_user_id,'PROMOTE','VIDEO',
        request.id,lease.id,request_version_before,request_version_before+1,
        capacity_before.video_fair_cursor,capacity_before.video_fair_cursor,
        capacity_before.preview_fair_cursor,capacity_before.preview_fair_cursor,
        jsonb_build_object('hostedAdmissionHandoff',true,'providerActionsCreated',false),db_now);
    END IF;
    PERFORM public.videoforge_prepare_hosted_v209_runtime(
      supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id,request.id);
    RETURN jsonb_build_object('generationRequestId',request.id,'state','ACTIVE');
  END IF;
  IF request.state='CANCELLING' THEN
    RAISE EXCEPTION 'hosted V2-09 request is cancelling' USING ERRCODE='55000';
  END IF;

  IF capacity_before.active_lease_count>=2 THEN
    RETURN jsonb_build_object('generationRequestId',request.id,'state','WAITING');
  END IF;
  SELECT queued.* INTO selected_request
    FROM public.generation_requests queued
    JOIN public.account_queue_heads head ON head.account_id=queued.account_id
   WHERE queued.state IN ('WAITING','RETRY_WAIT')
     AND queued.available_at<=db_now
     AND NOT EXISTS (
       SELECT 1 FROM public.provider_workload_leases active_lease
        WHERE active_lease.account_id=queued.account_id
          AND active_lease.state='ACTIVE'
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.generation_requests earlier
        WHERE earlier.account_id=queued.account_id
          AND earlier.state IN ('WAITING','RETRY_WAIT')
          AND earlier.available_at<=db_now
          AND (earlier.queue_order,earlier.id)<(queued.queue_order,queued.id)
     )
   ORDER BY head.video_last_served_sequence,queued.account_id,
            queued.queue_order,queued.id
   LIMIT 1
   FOR UPDATE OF queued,head;
  IF selected_request.id IS NULL OR selected_request.id IS DISTINCT FROM request.id THEN
    RETURN jsonb_build_object('generationRequestId',request.id,'state','WAITING');
  END IF;
  SELECT available.slot INTO available_slot
    FROM (VALUES(1::smallint),(2::smallint)) available(slot)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.provider_workload_leases active_lease
      WHERE active_lease.slot=available.slot AND active_lease.state='ACTIVE'
   )
   ORDER BY available.slot
   LIMIT 1;
  IF available_slot IS NULL THEN
    RETURN jsonb_build_object('generationRequestId',request.id,'state','WAITING');
  END IF;

  request_version_before:=request.version;
  UPDATE public.generation_requests
     SET state='ACTIVE',admitted_at=db_now,terminal_at=NULL,
         version=version+1,updated_at=db_now
   WHERE account_id=supplied_account_id AND workspace_id=supplied_workspace_id
     AND id=request.id AND version=request_version_before
     AND state IN ('WAITING','RETRY_WAIT');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hosted V2-09 queue request version changed' USING ERRCODE='40001';
  END IF;
  next_sequence:=capacity_before.schedule_sequence+1;
  UPDATE public.account_queue_heads
     SET video_last_served_sequence=next_sequence,version=version+1,updated_at=db_now
   WHERE account_id=supplied_account_id;
  UPDATE public.global_generation_capacity
     SET schedule_sequence=next_sequence,video_fair_cursor=next_sequence,
         version=version+1,updated_at=db_now
   WHERE singleton;
  lease_id:=gen_random_uuid();
  owner_token_sha256:='sha256:'||encode(sha256(convert_to(
    'hosted-v209-admission:'||request.id::text||':'||db_now::text,'UTF8')),'hex');
  INSERT INTO public.provider_workload_leases(
    id,slot,account_id,workspace_id,request_kind,generation_request_id,preset_preview_request_id,
    owner_token_sha256,state,acquired_at,heartbeat_at,expires_at)
  VALUES(lease_id,available_slot,supplied_account_id,supplied_workspace_id,'VIDEO',request.id,NULL,
    owner_token_sha256,'ACTIVE',db_now,db_now,db_now+interval '1 hour');
  SELECT * INTO capacity_after FROM public.global_generation_capacity WHERE singleton FOR UPDATE;
  INSERT INTO public.generation_queue_audits(
    id,account_id,workspace_id,actor_user_id,operation,request_kind,request_id,lease_id,
    request_version_before,request_version_after,video_cursor_before,video_cursor_after,
    preview_cursor_before,preview_cursor_after,detail,occurred_at)
  VALUES(
    gen_random_uuid(),supplied_account_id,supplied_workspace_id,supplied_user_id,'PROMOTE','VIDEO',
    request.id,lease_id,request_version_before,request_version_before+1,
    capacity_before.video_fair_cursor,capacity_after.video_fair_cursor,
    capacity_before.preview_fair_cursor,capacity_after.preview_fair_cursor,
    jsonb_build_object('slot',available_slot,'hostedAdmissionHandoff',true,'providerActionsCreated',false),db_now);
  PERFORM public.videoforge_prepare_hosted_v209_runtime(
    supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id,request.id);
  RETURN jsonb_build_object('generationRequestId',request.id,'state','ACTIVE');
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_admit_hosted_v209_generation(uuid,uuid,uuid,uuid) FROM PUBLIC;
