-- Release a proven terminal prompt workload when this account next requests admission.
-- Existing render reclaim is unchanged. Unknown/provider-active/unclean work stays fenced.
-- Applying this migration changes functions only; it never resumes or cancels saved projects.
DO $migration$
DECLARE definition text; old_text text; new_text text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_settle_stranded_hosted_v209_requests(uuid,uuid,uuid)'::regprocedure);
  old_text:='  settled integer:=0;';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'terminal prompt declaration boundary drifted'; END IF;
  definition:=replace(definition,old_text,old_text||E'\n  prompt public.hosted_prompt_runs%ROWTYPE;');
  old_text:=$old$  RETURN settled;$old$;
  new_text:=$new$  -- Project/generation/advisory/run locks also fence CPU submission and owner cancellation.
  FOR stranded IN
    SELECT g.* FROM public.generation_requests g
     WHERE g.account_id=supplied_account_id AND g.workspace_id=supplied_workspace_id
       AND g.state IN ('ADMITTED','ACTIVE')
       AND EXISTS (SELECT 1 FROM public.hosted_prompt_runs r
         WHERE r.account_id=g.account_id AND r.workspace_id=g.workspace_id
           AND r.project_id=g.project_id AND r.project_revision_id=g.project_revision_id
           AND r.state='FAILED' AND NOT r.provider_may_have_charged)
     ORDER BY g.created_at,g.id
  LOOP
    PERFORM 1 FROM public.projects p WHERE p.id=stranded.project_id
      AND p.account_id=supplied_account_id AND p.workspace_id=supplied_workspace_id FOR UPDATE;
    SELECT g.* INTO stranded FROM public.generation_requests g WHERE g.id=stranded.id
      AND g.account_id=supplied_account_id AND g.workspace_id=supplied_workspace_id
      AND g.state IN ('ADMITTED','ACTIVE') FOR UPDATE;
    IF stranded.id IS NULL THEN CONTINUE; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(stranded.id::text,43));
    SELECT r.* INTO prompt FROM public.hosted_prompt_runs r
     WHERE r.account_id=stranded.account_id AND r.workspace_id=stranded.workspace_id
       AND r.project_id=stranded.project_id AND r.project_revision_id=stranded.project_revision_id
     FOR UPDATE;
    IF prompt.id IS NULL OR prompt.state<>'FAILED' OR prompt.provider_may_have_charged
       OR prompt.finished_at IS NULL OR prompt.reported_cost_micro_usd IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.generation_tasks t JOIN public.attempts a
          ON a.workspace_id=t.workspace_id AND a.task_id=t.id
         WHERE t.id=prompt.task_id AND t.account_id=prompt.account_id
           AND t.workspace_id=prompt.workspace_id AND t.project_revision_id=prompt.project_revision_id
           AND t.state='FAILED' AND a.id=prompt.attempt_id AND a.state='FAILED'
           AND a.finished_at IS NOT NULL AND a.dispatch_state<>'AMBIGUOUS')
       OR NOT EXISTS (SELECT 1 FROM public.hosted_prompt_batch_claims c WHERE c.run_id=prompt.id)
       OR EXISTS (
         SELECT 1 FROM (
           SELECT c.id AS claim_id,c.provider_task_uuid,c.request_hash
             FROM public.hosted_prompt_batch_claims c WHERE c.run_id=prompt.id
           UNION ALL
           SELECT r.claim_id,r.provider_task_uuid,r.request_hash
             FROM public.hosted_prompt_batch_replacements r WHERE r.run_id=prompt.id
         ) wire WHERE NOT EXISTS (
           SELECT 1 FROM public.repository_mutation_receipts receipt
            WHERE receipt.account_id=prompt.account_id AND receipt.workspace_id=prompt.workspace_id
              AND receipt.operation='hosted_prompt_response' AND receipt.input_hash=wire.request_hash
              AND receipt.idempotency_key='hosted-prompt-response:'||wire.provider_task_uuid
              AND receipt.result_payload->>'run_id'=prompt.id::text
              AND receipt.result_payload->>'claim_id'=wire.claim_id::text
              AND receipt.result_payload->>'provider_task_uuid'=wire.provider_task_uuid
              AND receipt.result_payload->>'request_hash'=wire.request_hash
              AND receipt.result_payload#>>'{result,status}'='succeeded'))
       OR NOT EXISTS (
         SELECT 1 FROM public.cost_events e
          WHERE e.account_id=prompt.account_id AND e.workspace_id=prompt.workspace_id
            AND e.task_id=prompt.task_id AND e.attempt_id=prompt.attempt_id
          HAVING coalesce(sum(e.amount_micro_usd) FILTER (WHERE e.event_type='SETTLED'),0)=prompt.reported_cost_micro_usd
            AND coalesce(sum(e.amount_micro_usd) FILTER (WHERE e.event_type='RESERVED'),0)>0
            AND coalesce(sum(e.amount_micro_usd) FILTER (WHERE e.event_type='RESERVED'),0)
              =coalesce(sum(e.amount_micro_usd) FILTER (WHERE e.event_type IN ('SETTLED','RELEASED')),0))
       OR EXISTS (SELECT 1 FROM public.hosted_prompt_runs r WHERE r.project_revision_id=stranded.project_revision_id
          AND r.state IN ('DISPATCHING','UNKNOWN'))
       OR EXISTS (SELECT 1 FROM public.video_runtime_states r WHERE r.generation_request_id=stranded.id)
       OR EXISTS (SELECT 1 FROM public.serverless_attempts a WHERE a.generation_request_id=stranded.id)
       OR EXISTS (SELECT 1 FROM public.hosted_v209_ordinary_lane_materializations m WHERE m.generation_request_id=stranded.id)
       OR EXISTS (SELECT 1 FROM public.hosted_pair_runtime_states r WHERE r.generation_request_id=stranded.id)
       OR EXISTS (SELECT 1 FROM public.hosted_api_generation_jobs j WHERE j.project_revision_id=stranded.project_revision_id)
       OR EXISTS (SELECT 1 FROM public.hosted_video_jobs j WHERE j.project_revision_id=stranded.project_revision_id)
       OR EXISTS (SELECT 1 FROM public.hosted_cpu_job_attempts j WHERE j.project_id=stranded.project_id
          AND (j.state NOT IN ('SUCCEEDED','FAILED','CANCELLED','EXPIRED','PERMANENT_FAILED','DEAD_LETTER') OR j.terminal_at IS NULL))
       OR EXISTS (SELECT 1 FROM public.media_worker_leases l JOIN public.hosted_cpu_job_attempts j ON j.id=l.attempt_id
          WHERE j.project_id=stranded.project_id AND l.state IN ('CLAIMED','RUNNING','COMPLETING'))
       OR EXISTS (SELECT 1 FROM public.cloud_media_reservations r WHERE r.project_id=stranded.project_id
          AND (r.state<>'CLEAN' OR r.cleanup_verified_at IS NULL)) THEN
      CONTINUE;
    END IF;
    UPDATE public.provider_workload_leases
       SET state='RELEASED',released_at=db_now,release_reason='HOSTED_PROMPT_TERMINAL_FAILED',
           version=version+1,heartbeat_at=db_now,expires_at=greatest(expires_at,db_now+interval '1 second')
     WHERE generation_request_id=stranded.id AND state='ACTIVE' AND released_at IS NULL;
    UPDATE public.generation_requests
       SET state='FAILED',terminal_at=db_now,version=version+1,updated_at=db_now
     WHERE id=stranded.id AND state IN ('ADMITTED','ACTIVE') AND version=stranded.version;
    INSERT INTO public.generation_queue_audits(
      id,account_id,workspace_id,actor_user_id,operation,request_kind,request_id,lease_id,
      request_version_before,request_version_after,video_cursor_before,video_cursor_after,
      preview_cursor_before,preview_cursor_after,detail,occurred_at)
    VALUES(md5('v209-terminal-prompt-reclaim:'||stranded.id::text)::uuid,
      supplied_account_id,supplied_workspace_id,supplied_user_id,'TERMINAL_RELEASE','VIDEO',
      stranded.id,NULL,stranded.version,stranded.version+1,
      capacity.video_fair_cursor,capacity.video_fair_cursor,capacity.preview_fair_cursor,capacity.preview_fair_cursor,
      jsonb_build_object('source','V209_TERMINAL_PROMPT_RECLAIM','terminalState','FAILED',
        'promptRunId',prompt.id,'providerActionsCreated',false,'redispatch',false),db_now);
    settled:=settled+1;
  END LOOP;
  RETURN settled;$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'terminal prompt return boundary drifted'; END IF;
  EXECUTE replace(definition,old_text,new_text);
END;
$migration$;
