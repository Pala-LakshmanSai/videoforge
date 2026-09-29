-- This private proof reuses the normal CPU front door's immutable submission and committed
-- input bindings. It grants neither admission nor result acceptance, and stored plans alone
-- are insufficient. Execution state/deadline/cancellation remain at the admission caller.
-- Cloud media admission may precede the ordinary scene-batch prompt barrier, including after
-- canonical timing exists. Defer only ordinary runtime initialization; retain the exact owner,
-- fair admission, VIDEO lease, ASR deadline and all later provider-ready runtime gates.
-- A failed/cancelled pre-provider span settles only after exact owned compute is independently
-- CLEAN, preserving accepted ASR/media without fabricating ordinary runtime/provider acceptance.
-- Additive exact-preimage patch. Existing Local and runtime-present settlement remain unchanged.
DO $migration$
DECLARE definition text; failure_definition text; old_guard text; new_guard text; old_failure text; new_failure text; old_prompt_proof text; old_runtime_proof text; ready_render text; render_definition text; old_render_failure text; new_render_failure text;
BEGIN
 render_definition:=$function$CREATE FUNCTION public.videoforge_cloud_render_inputs_valid(target_attempt uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE a hosted_cpu_job_attempts%ROWTYPE; plan hosted_render_plans%ROWTYPE;
 input jsonb; declared jsonb; ref jsonb; expected_request jsonb;
BEGIN
 SELECT * INTO a FROM hosted_cpu_job_attempts WHERE id=target_attempt;
 IF a.id IS NULL OR a.account_id IS DISTINCT FROM public.videoforge_current_account_id()
   OR a.kind<>'RENDER' OR a.execution_backend<>'RUNPOD_POD'
   OR a.image_digest !~ '^sha256:[0-9a-f]{64}$' OR a.execution_bundle_sha256 IS DISTINCT FROM a.image_digest
   OR a.job_spec_checksum_sha256 !~ '^sha256:[0-9a-f]{64}$' OR a.job_spec_content_length NOT BETWEEN 1 AND 1048576
   OR a.job_spec_object_key IS DISTINCT FROM 'tenant/'||a.account_id||'/workspace/'||a.workspace_id
    ||'/project/'||a.project_id||'/revision/'||a.project_revision_id||'/lane/render/job/'||a.id||'/artifact/job-spec'
   OR NOT EXISTS(SELECT 1 FROM project_revisions r WHERE r.id=a.project_revision_id
    AND r.account_id=a.account_id AND r.workspace_id=a.workspace_id AND r.project_id=a.project_id
    AND r.status='LOCKED' AND r.media_execution_backend='RUNPOD_POD' AND r.id=(
      SELECT latest.id FROM project_revisions latest WHERE latest.account_id=a.account_id
       AND latest.workspace_id=a.workspace_id AND latest.project_id=a.project_id
       ORDER BY latest.revision_number DESC,latest.id DESC LIMIT 1)) THEN RETURN false; END IF;
 SELECT * INTO plan FROM hosted_render_plans p WHERE p.account_id=a.account_id AND p.workspace_id=a.workspace_id
   AND p.project_id=a.project_id AND p.project_revision_id=a.project_revision_id;
 IF plan.project_revision_id IS NULL OR plan.schema_version<>'videoforge-hosted-cpu-submission/v1'
   OR plan.payload->>'kind' IS DISTINCT FROM 'RENDER'
   OR plan.payload->>'project_id' IS DISTINCT FROM a.project_id::text
   OR plan.payload->>'project_revision_id' IS DISTINCT FROM a.project_revision_id::text
   OR plan.payload_sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(plan.payload),'UTF8')),'hex')
   OR jsonb_typeof(plan.payload->'objects') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 input:=plan.payload->'input_document';
 IF input->>'schema_version' IS DISTINCT FROM 'render-job-input/v1'
   OR input->>'project_revision_id' IS DISTINCT FROM a.project_revision_id::text
   OR jsonb_typeof(input->'resolved_render_manifest') IS DISTINCT FROM 'object'
   OR jsonb_typeof(input->'assets') IS DISTINCT FROM 'array'
   OR jsonb_array_length(input->'assets') NOT BETWEEN 2 AND 20000
   OR jsonb_array_length(plan.payload->'objects') NOT BETWEEN 1 AND 4096 THEN RETURN false; END IF;
 -- request_sha256 hashes the normalized camel-case submission, not its snake-case wire plan.
 expected_request:=jsonb_build_object('idempotencyKey',plan.payload->>'idempotency_key',
  'projectId',a.project_id::text,'projectRevisionId',a.project_revision_id::text,'kind','RENDER',
  'inputDocument',input,'objects',(SELECT jsonb_agg(jsonb_build_object('receiptId',obj->>'artifact_receipt_id','uri',obj->>'uri') ORDER BY ordinal)
   FROM jsonb_array_elements(plan.payload->'objects') WITH ORDINALITY AS declared(obj,ordinal)));
 IF a.request_sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(expected_request),'UTF8')),'hex')
   OR (SELECT count(*) FROM media_worker_input_objects object WHERE object.account_id=a.account_id
     AND object.workspace_id=a.workspace_id AND object.attempt_id=a.id)<>jsonb_array_length(plan.payload->'objects')
   OR (SELECT count(DISTINCT obj->>'uri') FROM jsonb_array_elements(plan.payload->'objects') obj)<>jsonb_array_length(plan.payload->'objects')
   OR (SELECT count(DISTINCT obj->>'artifact_receipt_id') FROM jsonb_array_elements(plan.payload->'objects') obj)<>jsonb_array_length(plan.payload->'objects') THEN RETURN false; END IF;
 FOR ref IN SELECT input->'resolved_render_manifest' UNION ALL SELECT value FROM jsonb_array_elements(input->'assets') LOOP
  IF ref->>'sha256' IS NULL OR ref->>'sha256' !~ '^sha256:[0-9a-f]{64}$'
    OR (ref->>'artifact_uri' ~ ('^vf-local://objects/sha256/'||substring(ref->>'sha256' from 8 for 2)||'/'||substring(ref->>'sha256' from 8)||'\.[a-z0-9]{1,10}$')) IS NOT TRUE
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan.payload->'objects') obj
      JOIN media_worker_input_objects object ON object.uri=obj->>'uri' AND object.account_id=a.account_id
        AND object.workspace_id=a.workspace_id AND object.attempt_id=a.id AND object.checksum_sha256=ref->>'sha256'
      WHERE obj->>'uri'=ref->>'artifact_uri') THEN RETURN false; END IF;
 END LOOP;
 -- Every declaration must be referenced, and every receipt must be committed for this exact
 -- project/revision (or the already established 215 same-project ASR input alias).
 FOR declared IN SELECT value FROM jsonb_array_elements(plan.payload->'objects') LOOP
  IF NOT EXISTS(SELECT 1 FROM (SELECT input->'resolved_render_manifest' AS value UNION ALL
      SELECT value FROM jsonb_array_elements(input->'assets')) refs WHERE refs.value->>'artifact_uri'=declared->>'uri')
   OR NOT EXISTS(SELECT 1 FROM media_worker_input_objects object
    JOIN artifact_receipts receipt ON receipt.id::text=declared->>'artifact_receipt_id'
     AND receipt.account_id=object.account_id AND receipt.workspace_id=object.workspace_id
     AND receipt.object_key=object.object_key AND receipt.content_type=object.content_type
     AND receipt.content_length=object.content_length AND receipt.checksum_sha256=object.checksum_sha256 AND receipt.deleted_at IS NULL
    JOIN artifact_reservations reservation ON reservation.id=receipt.reservation_id
     AND reservation.account_id=receipt.account_id AND reservation.workspace_id=receipt.workspace_id
     AND reservation.object_key=receipt.object_key AND reservation.content_type=receipt.content_type
     AND reservation.content_length=receipt.content_length AND reservation.checksum_sha256=receipt.checksum_sha256
    WHERE object.account_id=a.account_id AND object.workspace_id=a.workspace_id AND object.attempt_id=a.id
     AND object.uri=declared->>'uri' AND object.content_length>0 AND reservation.state='COMMITTED'
     AND reservation.project_id=a.project_id AND (reservation.project_revision_id=a.project_revision_id OR EXISTS(
      SELECT 1 FROM cloud_media_asr_recoveries recovery WHERE recovery.account_id=a.account_id AND recovery.workspace_id=a.workspace_id
       AND recovery.project_id=a.project_id AND recovery.project_revision_id=a.project_revision_id AND recovery.source_receipt_id=receipt.id))) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END; $$;$function$;
 SELECT pg_get_functiondef('public.videoforge_admit_hosted_v209_generation_after_reclaim(uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 SELECT pg_get_functiondef('public.videoforge_settle_cloud_media_cpu_failure(uuid)'::regprocedure) INTO failure_definition;
 old_guard:=$old$    AND NOT EXISTS(SELECT 1 FROM public.hosted_canonical_timing_bridges bridge
      WHERE bridge.account_id=supplied_account_id AND bridge.workspace_id=supplied_workspace_id
        AND bridge.project_id=supplied_project_id AND bridge.project_revision_id=request.project_revision_id)
$old$;
 new_guard:=$new$    AND (NOT EXISTS(SELECT 1 FROM public.hosted_canonical_timing_bridges bridge
      WHERE bridge.account_id=supplied_account_id AND bridge.workspace_id=supplied_workspace_id
        AND bridge.project_id=supplied_project_id AND bridge.project_revision_id=request.project_revision_id)
     OR (NOT EXISTS (
       SELECT 1 FROM public.generation_tasks task
        WHERE task.workspace_id=supplied_workspace_id
          AND task.project_revision_id=request.project_revision_id
          AND task.owner_type='PROJECT_REVISION'
          AND task.lane='PROMPT'
          AND task.task_key LIKE 'prompt:scene-batch:%'
          AND task.state='COMPLETE'
     ) OR EXISTS (
       SELECT 1 FROM public.generation_tasks task
        WHERE task.workspace_id=supplied_workspace_id
          AND task.project_revision_id=request.project_revision_id
          AND task.owner_type='PROJECT_REVISION'
          AND task.lane='PROMPT'
          AND task.task_key LIKE 'prompt:scene-batch:%'
          AND task.required
          AND task.state<>'COMPLETE'
     )))
$new$;
 old_prompt_proof:=$old$NOT EXISTS (
       SELECT 1 FROM public.project_revisions r
       JOIN public.hosted_cpu_job_attempts a ON a.project_revision_id=r.id
         AND a.account_id=r.account_id AND a.workspace_id=r.workspace_id
       WHERE r.id=request.project_revision_id AND r.media_execution_backend='RUNPOD_POD'
         AND a.kind='ASR' AND a.execution_backend='RUNPOD_POD'
         AND a.state IN ('OUTBOXED','RUNNING','SUCCEEDED') AND a.deadline_at>db_now
     )$old$;
 old_runtime_proof:=$old$EXISTS(SELECT 1 FROM public.project_revisions r
      JOIN public.hosted_cpu_job_attempts a ON a.project_revision_id=r.id
        AND a.account_id=r.account_id AND a.workspace_id=r.workspace_id
      WHERE r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id
        AND r.project_id=supplied_project_id AND r.id=request.project_revision_id
        AND r.media_execution_backend='RUNPOD_POD' AND a.execution_backend='RUNPOD_POD'
        AND a.kind='ASR' AND a.state IN ('OUTBOXED','RUNNING','SUCCEEDED') AND a.deadline_at>db_now)$old$;
 ready_render:=$proof$EXISTS(SELECT 1 FROM public.hosted_cpu_job_attempts render
   WHERE render.account_id=supplied_account_id AND render.workspace_id=supplied_workspace_id
    AND render.project_id=supplied_project_id AND render.project_revision_id=request.project_revision_id
    AND render.kind='RENDER' AND render.execution_backend='RUNPOD_POD'
    AND render.state IN ('OUTBOXED','RUNNING') AND render.deadline_at>db_now
    AND render.cancellation_requested_at IS NULL AND render.terminal_at IS NULL
    AND public.videoforge_cloud_render_inputs_valid(render.id))$proof$;
 old_render_failure:=$old$   IF a.kind='ASR' AND (runtime.id IS NOT NULL OR EXISTS(SELECT 1 FROM hosted_api_generation_jobs j WHERE j.generation_request_id=request.id)) THEN
    RAISE EXCEPTION 'cloud ASR failure has downstream execution' USING ERRCODE='23514'; END IF;
$old$;
 new_render_failure:=$new$   IF a.kind IN ('ASR','RENDER') AND (runtime.id IS NOT NULL OR EXISTS(SELECT 1 FROM hosted_api_generation_jobs j WHERE j.generation_request_id=request.id)) THEN
    RAISE EXCEPTION 'cloud early media failure has downstream execution' USING ERRCODE='23514'; END IF;
   IF a.kind='RENDER' THEN
    IF EXISTS(SELECT 1 FROM cloud_media_reservations r WHERE r.account_id=a.account_id AND r.workspace_id=a.workspace_id
      AND r.project_id=a.project_id AND r.project_revision_id=a.project_revision_id
      AND (r.state<>'CLEAN' OR r.cleanup_verified_at IS NULL)) THEN RETURN false; END IF;
    IF NOT public.videoforge_cloud_render_inputs_valid(a.id)
      OR EXISTS(SELECT 1 FROM cloud_media_jobs job WHERE job.attempt_id=a.id AND NOT EXISTS(
       SELECT 1 FROM cloud_media_reservations r WHERE r.id=job.reservation_id
        AND job.account_id=a.account_id AND job.workspace_id=a.workspace_id
        AND r.account_id=a.account_id AND r.workspace_id=a.workspace_id
        AND r.project_id=a.project_id AND r.project_revision_id=a.project_revision_id
        AND r.leased_attempt_id=a.id AND r.state='CLEAN' AND r.cleanup_verified_at IS NOT NULL))
      OR EXISTS(SELECT 1 FROM cloud_media_reservations r WHERE (r.attempt_id=a.id OR r.leased_attempt_id=a.id)
       AND NOT EXISTS(SELECT 1 FROM cloud_media_jobs job WHERE job.attempt_id=a.id
        AND job.account_id=a.account_id AND job.workspace_id=a.workspace_id AND job.reservation_id=r.id))
      OR EXISTS(SELECT 1 FROM serverless_attempts paid WHERE paid.generation_request_id=request.id)
      OR EXISTS(SELECT 1 FROM video_runtime_states v WHERE v.account_id=a.account_id AND v.workspace_id=a.workspace_id
        AND v.project_id=a.project_id AND v.project_revision_id=a.project_revision_id)
      OR EXISTS(SELECT 1 FROM media_worker_leases lease JOIN hosted_cpu_job_attempts personal ON personal.id=lease.attempt_id
       AND personal.account_id=lease.account_id AND personal.workspace_id=lease.workspace_id
       WHERE personal.account_id=a.account_id AND personal.workspace_id=a.workspace_id
        AND personal.project_id=a.project_id AND personal.project_revision_id=a.project_revision_id
        AND lease.state IN ('CLAIMED','RUNNING','COMPLETING')) THEN
     RAISE EXCEPTION 'cloud pre-provider render failure lineage invalid' USING ERRCODE='23514'; END IF;
   END IF;
$new$;
 old_failure:=$old$    IF runtime.id IS NULL OR runtime.stage<>'WAITING_FOR_WORKER' OR runtime.terminal_at IS NOT NULL
      OR materialized.user_id<>request.created_by_user_id THEN
     RAISE EXCEPTION 'cloud span failure runtime invalid' USING ERRCODE='23514'; END IF;
$old$;
 new_failure:=$new$    IF (runtime.id IS NOT NULL AND (runtime.stage<>'WAITING_FOR_WORKER' OR runtime.terminal_at IS NOT NULL))
      OR materialized.user_id<>request.created_by_user_id THEN
     RAISE EXCEPTION 'cloud span failure runtime invalid' USING ERRCODE='23514'; END IF;
    IF runtime.id IS NULL THEN
     -- A pre-provider span has no ordinary runtime. Require accepted same-revision Cloud ASR
     -- and the exact failed span's owned reservation; never invent accepted provider state.
     IF EXISTS(SELECT 1 FROM cloud_media_reservations r WHERE r.account_id=a.account_id
       AND r.workspace_id=a.workspace_id AND r.project_id=a.project_id
       AND r.project_revision_id=a.project_revision_id AND (r.state<>'CLEAN' OR r.cleanup_verified_at IS NULL)) THEN RETURN false; END IF;
     IF NOT EXISTS(SELECT 1 FROM project_revisions revision WHERE revision.id=a.project_revision_id
       AND revision.account_id=a.account_id AND revision.workspace_id=a.workspace_id
       AND revision.project_id=a.project_id AND revision.status='LOCKED'
       AND revision.media_execution_backend='RUNPOD_POD' AND revision.id=(
         SELECT latest.id FROM project_revisions latest WHERE latest.account_id=a.account_id
          AND latest.workspace_id=a.workspace_id AND latest.project_id=a.project_id
          ORDER BY latest.revision_number DESC,latest.id DESC LIMIT 1))
      OR NOT EXISTS(SELECT 1 FROM hosted_canonical_timing_bridges bridge
       JOIN revision_timing_heads head ON head.account_id=bridge.account_id AND head.workspace_id=bridge.workspace_id
        AND head.project_revision_id=bridge.project_revision_id AND head.current_timeline_plan_id=bridge.timeline_plan_id
        AND head.current_transcript_id=bridge.transcript_id
       JOIN hosted_cpu_job_attempts asr ON asr.id=bridge.hosted_asr_attempt_id
        AND asr.account_id=bridge.account_id AND asr.workspace_id=bridge.workspace_id
        AND asr.project_id=bridge.project_id AND asr.project_revision_id=bridge.project_revision_id
        AND asr.kind='ASR' AND asr.execution_backend='RUNPOD_POD' AND asr.state='SUCCEEDED'
        AND asr.result_receipt_sha256 IS NOT NULL AND asr.job_spec_checksum_sha256=bridge.asr_input_sha256
        AND asr.result_checksum_sha256=bridge.asr_result_sha256
       JOIN cloud_media_jobs job ON job.attempt_id=asr.id AND job.account_id=asr.account_id AND job.workspace_id=asr.workspace_id
       JOIN cloud_media_reservations r ON r.id=job.reservation_id AND r.account_id=job.account_id AND r.workspace_id=job.workspace_id
        AND r.project_id=asr.project_id AND r.project_revision_id=asr.project_revision_id
        AND r.leased_attempt_id=asr.id AND r.state='CLEAN' AND r.cleanup_verified_at IS NOT NULL
       WHERE bridge.account_id=a.account_id AND bridge.workspace_id=a.workspace_id
        AND bridge.project_id=a.project_id AND bridge.project_revision_id=a.project_revision_id
        AND bridge.timeline_plan_id=materialized.timeline_plan_id AND bridge.transcript_id=materialized.transcript_id)
      OR NOT EXISTS(SELECT 1 FROM generation_tasks task WHERE task.id=materialized.task_id
       AND task.account_id=a.account_id AND task.workspace_id=a.workspace_id
       AND task.project_revision_id=a.project_revision_id AND task.owner_type='PROJECT_REVISION'
       AND task.owner_id=a.project_revision_id AND task.lane='AVATAR')
      OR NOT EXISTS(SELECT 1 FROM cloud_media_jobs job JOIN cloud_media_reservations r
       ON r.id=job.reservation_id AND r.account_id=job.account_id AND r.workspace_id=job.workspace_id
       WHERE job.attempt_id=a.id AND job.account_id=a.account_id AND job.workspace_id=a.workspace_id
        AND r.project_id=a.project_id AND r.project_revision_id=a.project_revision_id
        AND r.leased_attempt_id=a.id AND r.state='CLEAN' AND r.cleanup_verified_at IS NOT NULL)
      OR EXISTS(SELECT 1 FROM hosted_api_generation_jobs j WHERE j.generation_request_id=request.id)
      OR EXISTS(SELECT 1 FROM serverless_attempts attempt WHERE attempt.generation_request_id=request.id)
      OR EXISTS(SELECT 1 FROM video_runtime_states v WHERE v.account_id=a.account_id AND v.workspace_id=a.workspace_id
        AND v.project_id=a.project_id AND v.project_revision_id=a.project_revision_id)
      OR EXISTS(SELECT 1 FROM media_worker_leases lease JOIN hosted_cpu_job_attempts personal ON personal.id=lease.attempt_id
       AND personal.account_id=lease.account_id AND personal.workspace_id=lease.workspace_id
       WHERE personal.account_id=a.account_id AND personal.workspace_id=a.workspace_id
        AND personal.project_id=a.project_id AND personal.project_revision_id=a.project_revision_id
        AND lease.state IN ('CLAIMED','RUNNING','COMPLETING')) THEN
      RAISE EXCEPTION 'cloud pre-provider span failure lineage invalid' USING ERRCODE='23514'; END IF;
    END IF;
$new$;
 IF (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>3
   OR (length(definition)-length(replace(definition,'PERFORM public.videoforge_prepare_hosted_v209_runtime(','')))
    /length('PERFORM public.videoforge_prepare_hosted_v209_runtime(')<>3
   OR (length(definition)-length(replace(definition,old_prompt_proof,'')))/length(old_prompt_proof)<>1
   OR (length(definition)-length(replace(definition,old_runtime_proof,'')))/length(old_runtime_proof)<>3
   OR (length(failure_definition)-length(replace(failure_definition,old_failure,'')))/length(old_failure)<>1
   OR (length(failure_definition)-length(replace(failure_definition,old_render_failure,'')))/length(old_render_failure)<>1
   OR (length(failure_definition)-length(replace(failure_definition,$kind$a.kind NOT IN ('ASR','SPAN_AUDIO')$kind$,'')))/length($kind$a.kind NOT IN ('ASR','SPAN_AUDIO')$kind$)<>1
   OR (length(failure_definition)-length(replace(failure_definition,
    'finished_at=now_at,version=task.version+1,updated_at=now_at','')))
    /length('finished_at=now_at,version=task.version+1,updated_at=now_at')<>1 THEN
  RAISE EXCEPTION 'cloud pre-provider media reviewed preimage mismatch' USING ERRCODE='55000'; END IF;
 definition:=replace(definition,old_guard,new_guard);
 definition:=replace(definition,old_prompt_proof,'NOT ('||substring(old_prompt_proof from 5)||' OR '||ready_render||')');
 definition:=replace(definition,old_runtime_proof,'('||old_runtime_proof||' OR '||ready_render||')');
 failure_definition:=replace(failure_definition,old_failure,new_failure);
 failure_definition:=replace(failure_definition,old_render_failure,new_render_failure);
 failure_definition:=replace(failure_definition,$kind$a.kind NOT IN ('ASR','SPAN_AUDIO')$kind$,$kind$a.kind NOT IN ('ASR','SPAN_AUDIO','RENDER')$kind$);
 -- Preserve the task cancellation completion contract while using the existing single update.
 failure_definition:=replace(failure_definition,
  'finished_at=now_at,version=task.version+1,updated_at=now_at',
  'finished_at=now_at,cancel_requested_at=CASE WHEN canceled THEN COALESCE(task.cancel_requested_at,now_at)
        ELSE task.cancel_requested_at END,version=task.version+1,updated_at=now_at');
 EXECUTE render_definition;
 REVOKE ALL ON FUNCTION public.videoforge_cloud_render_inputs_valid(uuid) FROM PUBLIC;
 EXECUTE definition;
 EXECUTE failure_definition;
END;
$migration$;
