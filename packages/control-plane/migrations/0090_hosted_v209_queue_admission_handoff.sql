-- V2-09 hosted queue admission handoff.
-- The hosted login remains SELECT-only on queue tables.  This function is the sole narrowly
-- scoped mutation boundary that turns a qualified browser request into one fair, capped,
-- tenant-owned ACTIVE request and lease.  It creates no provider attempt, outbox, or work row.

CREATE OR REPLACE FUNCTION public.videoforge_prepare_hosted_v209_runtime(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_user_id uuid,
  supplied_project_id uuid,
  supplied_generation_request_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  request public.generation_requests%ROWTYPE;
  bridge public.hosted_canonical_timing_bridges%ROWTYPE;
  runtime public.video_runtime_states%ROWTYPE;
  expected_runtime_id uuid;
  lane_name text;
  task_lane text;
  item_manifest jsonb;
  items_sha text;
  item_count integer;
  expected_item_count integer;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'hosted V2-09 runtime tenant scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT row.* INTO request FROM public.generation_requests row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.id=supplied_generation_request_id AND row.project_id=supplied_project_id
     AND row.created_by_user_id=supplied_user_id AND row.state='ACTIVE'
     AND row.admitted_at IS NOT NULL AND row.terminal_at IS NULL
   FOR UPDATE;
  IF request.id IS NULL THEN
    RAISE EXCEPTION 'hosted V2-09 admitted request unavailable' USING ERRCODE='23514';
  END IF;
  SELECT row.* INTO bridge FROM public.hosted_canonical_timing_bridges row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.project_id=supplied_project_id
     AND row.project_revision_id=request.project_revision_id
   FOR SHARE;
  IF bridge.hosted_asr_attempt_id IS NULL OR bridge.generation_plan_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(bridge.task_manifest) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'hosted V2-09 canonical timing bridge unavailable' USING ERRCODE='23514';
  END IF;
  expected_runtime_id:=md5('hosted-v209-runtime:'||request.id::text)::uuid;
  INSERT INTO public.video_runtime_states(
    id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,
    stage,preparation_manifest_sha256,admitted_at,prepared_at,version,created_at,updated_at)
  VALUES(expected_runtime_id,supplied_account_id,supplied_workspace_id,supplied_project_id,
    request.project_revision_id,request.id,'WAITING_FOR_WORKER',bridge.generation_plan_sha256,
    request.admitted_at,db_now,1,db_now,db_now)
  ON CONFLICT(generation_request_id) DO NOTHING;
  SELECT row.* INTO runtime FROM public.video_runtime_states row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=request.id FOR UPDATE;
  IF runtime.id IS DISTINCT FROM expected_runtime_id OR runtime.project_id IS DISTINCT FROM supplied_project_id
     OR runtime.project_revision_id IS DISTINCT FROM request.project_revision_id
     OR runtime.stage IS DISTINCT FROM 'WAITING_FOR_WORKER'
     OR runtime.preparation_manifest_sha256 IS DISTINCT FROM bridge.generation_plan_sha256
     OR runtime.admitted_at IS NULL OR runtime.prepared_at IS NULL OR runtime.terminal_at IS NOT NULL THEN
    RAISE EXCEPTION 'hosted V2-09 runtime replay drifted' USING ERRCODE='23514';
  END IF;
  FOREACH lane_name IN ARRAY ARRAY['mage_image','soulx_avatar'] LOOP
    task_lane:=CASE lane_name WHEN 'mage_image' THEN 'IMAGE' ELSE 'AVATAR' END;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'item_id',task.id,'task_id',task.id,'task_key',task.task_key,
        'timeline_segment_id',segment.id) ORDER BY task.task_key),'[]'::jsonb)
      INTO item_manifest
      FROM jsonb_array_elements(bridge.task_manifest) manifest
      JOIN public.generation_tasks task
        ON task.account_id=supplied_account_id
       AND task.workspace_id=supplied_workspace_id
       AND task.project_revision_id=request.project_revision_id
       AND task.id=(manifest->>'id')::uuid
       AND task.task_key=manifest->>'task_key'
       AND task.lane=task_lane
       AND task.state='BLOCKED'
      JOIN public.timeline_segments segment
        ON segment.account_id=supplied_account_id
       AND segment.workspace_id=supplied_workspace_id
       AND segment.project_revision_id=request.project_revision_id
       AND segment.timeline_plan_id=bridge.timeline_plan_id
       AND segment.id=(manifest->>'timeline_segment_id')::uuid
     WHERE manifest->>'lane'=task_lane;
    item_count:=jsonb_array_length(item_manifest);
    SELECT count(*)::integer INTO expected_item_count
      FROM jsonb_array_elements(bridge.task_manifest) manifest
     WHERE manifest->>'lane'=task_lane;
    IF item_count<1 OR item_count<>expected_item_count OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(item_manifest) value
       WHERE coalesce(value->>'item_id','') !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR coalesce(value->>'timeline_segment_id','') !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR coalesce(value->>'task_key','')=''
    ) THEN
      RAISE EXCEPTION 'hosted V2-09 runtime task manifest invalid' USING ERRCODE='23514';
    END IF;
    items_sha:='sha256:'||encode(sha256(convert_to(
      public.videoforge_canonical_jsonb(item_manifest),'UTF8')),'hex');
    INSERT INTO public.video_runtime_lane_states(
      id,account_id,workspace_id,runtime_id,project_revision_id,lane,state,
      items_manifest_sha256,planned_item_count,accepted_item_count,attempt_ordinal,
      max_attempt_ordinal,current_attempt_id,version,created_at,updated_at)
    VALUES(md5('hosted-v209-runtime-lane:'||request.id::text||':'||lane_name)::uuid,
      supplied_account_id,supplied_workspace_id,runtime.id,request.project_revision_id,lane_name,
      'MANIFEST_DURABLE',items_sha,item_count,0,0,2,NULL,1,db_now,db_now)
    ON CONFLICT(runtime_id,lane) DO NOTHING;
    IF NOT EXISTS(
      SELECT 1 FROM public.video_runtime_lane_states row
       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
         AND row.runtime_id=runtime.id AND row.project_revision_id=request.project_revision_id
         AND row.lane=lane_name AND row.state='MANIFEST_DURABLE'
         AND row.items_manifest_sha256=items_sha AND row.planned_item_count=item_count
         AND row.accepted_item_count=0 AND row.attempt_ordinal=0
         AND row.current_attempt_id IS NULL
    ) THEN
      RAISE EXCEPTION 'hosted V2-09 runtime lane replay drifted' USING ERRCODE='23514';
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_prepare_hosted_v209_runtime(uuid,uuid,uuid,uuid,uuid)
  FROM PUBLIC;

-- Runtime replay reads only the immutable full request committed by 0074. It permits the two
-- safe send states and the already-assigned result, and never reconstructs or resets work.
CREATE FUNCTION public.videoforge_resume_hosted_v209_ordinary_lane_materialization(
  supplied_account_id uuid, supplied_workspace_id uuid,
  supplied_generation_request_id uuid, supplied_lane text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  token_key text:=current_setting('videoforge.dispatch_token_key',true);
  target record;
  candidate public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  materialized public.hosted_v209_ordinary_lane_materializations%ROWTYPE;
  raw_token text;
  pair_sendable boolean;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_lane NOT IN ('mage_image','soulx_avatar')
     OR token_key IS NULL OR length(token_key)<32 THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary resume scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT
    (count(*) FILTER(WHERE attempt.state='OUTBOXED' AND outbox.state='READY_TO_DISPATCH'
      AND outbox.send_attempt_count=0)=2)
    OR (
      count(*) FILTER(WHERE attempt.lane='mage_image' AND attempt.state='ASSIGNED'
        AND outbox.state='ASSIGNED' AND outbox.send_attempt_count=1
        AND assignment.provider_job_id IS NOT NULL)=1
      AND count(*) FILTER(WHERE attempt.lane='soulx_avatar' AND attempt.state='OUTBOXED'
        AND outbox.state='READY_TO_DISPATCH' AND outbox.send_attempt_count=0)=1
    )
    OR (count(*) FILTER(WHERE attempt.state='ASSIGNED' AND outbox.state='ASSIGNED'
      AND outbox.send_attempt_count=1 AND assignment.provider_job_id IS NOT NULL)=2)
    INTO pair_sendable
    FROM public.serverless_attempts attempt
    JOIN public.serverless_dispatch_outbox outbox ON outbox.attempt_id=attempt.id
    LEFT JOIN public.serverless_provider_assignments assignment
      ON assignment.attempt_id=attempt.id AND assignment.is_current
   WHERE attempt.account_id=supplied_account_id
     AND attempt.workspace_id=supplied_workspace_id
     AND attempt.generation_request_id=supplied_generation_request_id;
  IF NOT coalesce(pair_sendable,false) THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary pair is not safely resumable' USING ERRCODE='55000';
  END IF;
  SELECT attempt.id attempt_id,attempt.state attempt_state,attempt.dispatch_token_sha256,
      attempt.deadline_at,outbox.state outbox_state,outbox.send_attempt_count,
      attempt.deployment_id,deployment.endpoint_id_sha256,deployment.provider_endpoint_id,
      vault.token_ciphertext,assignment.provider_job_id
    INTO target
    FROM public.serverless_attempts attempt
    JOIN public.serverless_dispatch_outbox outbox ON outbox.attempt_id=attempt.id
    JOIN public.serverless_endpoint_deployments deployment
      ON deployment.id=attempt.deployment_id AND deployment.lane=attempt.lane
    JOIN public.hosted_dispatch_token_vault vault ON vault.attempt_id=attempt.id
    LEFT JOIN public.serverless_provider_assignments assignment
      ON assignment.attempt_id=attempt.id AND assignment.is_current
   WHERE attempt.account_id=supplied_account_id
     AND attempt.workspace_id=supplied_workspace_id
     AND attempt.generation_request_id=supplied_generation_request_id
     AND attempt.lane=supplied_lane
   FOR SHARE OF attempt,outbox,deployment,vault;
  SELECT * INTO candidate FROM public.hosted_v209_ordinary_dispatch_candidates row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=supplied_generation_request_id FOR SHARE;
  SELECT * INTO materialized FROM public.hosted_v209_ordinary_lane_materializations row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=supplied_generation_request_id AND row.lane=supplied_lane
   FOR SHARE;
  IF target.attempt_id IS NULL OR candidate.id IS NULL OR materialized.attempt_id IS NULL
     OR candidate.expires_at<=transaction_timestamp() OR target.deadline_at<=transaction_timestamp()
     OR materialized.attempt_id<>target.attempt_id OR target.provider_endpoint_id IS NULL
     OR materialized.full_request_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR materialized.envelope_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(materialized.request_body) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary resume lineage invalid' USING ERRCODE='23514';
  END IF;
  raw_token:=pgp_sym_decrypt(target.token_ciphertext,token_key);
  IF 'sha256:'||encode(sha256(convert_to(raw_token,'UTF8')),'hex')<>target.dispatch_token_sha256 THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary resume token invalid' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'schemaVersion','videoforge.hosted-v209-ordinary-runtime-resume/v1',
    'lane',supplied_lane,'attemptId',target.attempt_id,'dispatchToken',raw_token,
    'dispatchTokenSha256',target.dispatch_token_sha256,
    'endpointIdSha256',target.endpoint_id_sha256,'deploymentId',target.deployment_id,
    'attemptState',target.attempt_state,'outboxState',target.outbox_state,
    'providerJobId',target.provider_job_id,
    'existingMaterialization',jsonb_build_object('requestBody',materialized.request_body,
      'requestBodySha256',materialized.full_request_sha256,
      'envelopeSha256',materialized.envelope_sha256));
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_resume_hosted_v209_ordinary_lane_materialization(
  uuid,uuid,uuid,text
) FROM PUBLIC;

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
  SELECT count(*) INTO terminal_count
    FROM public.generation_requests row
   WHERE row.account_id=supplied_account_id
     AND row.workspace_id=supplied_workspace_id
     AND row.project_id=supplied_project_id
     AND row.state IN ('SUCCEEDED','FAILED','CANCELLED');

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
  ELSIF terminal_count>0 THEN
    RAISE EXCEPTION 'hosted V2-09 terminal generation cannot be replayed' USING ERRCODE='23505';
  ELSE
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
    INSERT INTO public.generation_requests(
      id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,
      state,queue_order,available_at,attempt_ordinal,idempotency_key,version,
      admitted_at,terminal_at,created_at,updated_at)
    VALUES(
      gen_random_uuid(),supplied_account_id,supplied_workspace_id,supplied_project_id,revision_id,
      supplied_user_id,'WAITING',
      (SELECT coalesce(max(row.queue_order),0)+1 FROM public.generation_requests row
        WHERE row.account_id=supplied_account_id),
      db_now,1,'hosted-v209:'||supplied_project_id::text||':generation',1,
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

CREATE OR REPLACE FUNCTION public.videoforge_has_hosted_v209_ordinary_candidate(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_generation_request_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT public.videoforge_current_account_id()=supplied_account_id
     AND EXISTS (
       SELECT 1 FROM public.hosted_v209_ordinary_dispatch_candidates candidate
        WHERE candidate.account_id=supplied_account_id
          AND candidate.workspace_id=supplied_workspace_id
          AND candidate.generation_request_id=supplied_generation_request_id
     )
$$;

REVOKE ALL ON FUNCTION public.videoforge_admit_hosted_v209_generation(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_has_hosted_v209_ordinary_candidate(uuid,uuid,uuid) FROM PUBLIC;
