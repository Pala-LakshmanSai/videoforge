-- A manual retry may replace a provably provider-free input rejection after the application
-- reconstructs its exact sealed plan. All existing reservation/profile/admission rules remain.
DO $$
DECLARE definition text; old_text text; new_text text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_prepare_hosted_prompt_run(jsonb)'::regprocedure);
  old_text:=$old$  existing public.hosted_prompt_runs%ROWTYPE;$old$;
  new_text:=$new$  repair_request public.generation_requests%ROWTYPE;
  existing public.hosted_prompt_runs%ROWTYPE;$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt input repair declaration drifted'; END IF;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$  PERFORM 1 FROM public.workspaces workspace$old$;
  new_text:=$new$  IF coalesce((supplied->>'input_repair_redispatch')::boolean,false) THEN
    -- Match owner cancellation's request -> advisory -> run order before preparing new work.
    SELECT generation.* INTO repair_request FROM public.generation_requests generation
      WHERE generation.account_id=account_id AND generation.workspace_id=workspace_id
        AND generation.project_id=project_id AND generation.project_revision_id=revision_id
      ORDER BY generation.created_at DESC,generation.id DESC LIMIT 1 FOR UPDATE;
    IF repair_request.id IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(repair_request.id::text,43));
      IF repair_request.state NOT IN ('WAITING','RETRY_WAIT','ADMITTED','ACTIVE') THEN
        RAISE EXCEPTION 'hosted prompt generation is terminal or cancelling' USING ERRCODE='55000';
      END IF;
    END IF;
  END IF;
  PERFORM 1 FROM public.workspaces workspace$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt input repair owner lock boundary drifted'; END IF;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$  IF (existing.id IS NULL AND requested_reserved IS DISTINCT FROM$old$;
  new_text:=$new$  IF coalesce((supplied->>'input_repair_redispatch')::boolean,false)
     OR (redispatch AND existing.problem_code='HOSTED_PROMPT_INPUT_INVALID') THEN
    IF NOT redispatch OR supplied->>'input_repair_redispatch' IS DISTINCT FROM 'true'
       OR existing.id IS NULL OR existing.state IS DISTINCT FROM 'FAILED'
       OR existing.problem_code IS DISTINCT FROM 'HOSTED_PROMPT_INPUT_INVALID'
       OR supplied->>'original_run_id' IS DISTINCT FROM existing.id::text
       OR supplied->>'original_input_hash' IS DISTINCT FROM existing.input_hash
       OR supplied->>'original_batch_plan_hash' IS DISTINCT FROM existing.batch_plan_hash
       OR supplied->>'original_planned_batch_count' IS DISTINCT FROM existing.planned_batch_count::text
       OR supplied->>'original_planned_scene_count' IS DISTINCT FROM existing.planned_scene_count::text
       OR supplied->>'original_reserved_cost_micro_usd' IS DISTINCT FROM existing.reserved_cost_micro_usd::text
       OR planned_batch_count IS DISTINCT FROM existing.planned_batch_count
       OR planned_scene_count IS DISTINCT FROM existing.planned_scene_count
       OR requested_reserved IS DISTINCT FROM existing.reserved_cost_micro_usd
       OR existing.provider_may_have_charged IS DISTINCT FROM false
       OR existing.reported_cost_micro_usd IS DISTINCT FROM 0
       OR existing.discarded_cost_micro_usd IS DISTINCT FROM 0
       OR existing.settled_cost_micro_usd IS DISTINCT FROM 0
       OR existing.acceptance_fingerprint_hash IS NOT NULL
       OR existing.redispatch_count NOT BETWEEN 0 AND 28
       OR existing.operator_resume_count<>0
       OR EXISTS (SELECT 1 FROM public.hosted_prompt_batch_claims claim WHERE claim.run_id=existing.id)
       OR EXISTS (SELECT 1 FROM public.hosted_prompt_batch_replacements replacement WHERE replacement.run_id=existing.id)
       OR EXISTS (SELECT 1 FROM public.hosted_prompt_batch_progress progress WHERE progress.run_id=existing.id)
       OR EXISTS (SELECT 1 FROM public.hosted_prompt_scene_progress progress WHERE progress.run_id=existing.id)
       OR EXISTS (SELECT 1 FROM public.repository_mutation_receipts receipt
         WHERE receipt.workspace_id=existing.workspace_id
           AND receipt.operation IN ('hosted_prompt_response','hosted_prompt_invalid_batch')
           AND receipt.result_payload->>'run_id'=existing.id::text)
       OR NOT EXISTS (SELECT 1 FROM public.attempts attempt
         WHERE attempt.id=existing.attempt_id AND attempt.task_id=existing.task_id
           AND attempt.account_id=account_id AND attempt.workspace_id=workspace_id
           AND attempt.state='FAILED' AND attempt.problem_code='HOSTED_PROMPT_INPUT_INVALID'
           AND attempt.claim_state='CLAIMED' AND attempt.input_hash=existing.input_hash)
       OR NOT EXISTS (SELECT 1 FROM public.generation_tasks task
         WHERE task.id=existing.task_id AND task.account_id=account_id AND task.workspace_id=workspace_id
           AND task.project_revision_id=revision_id AND task.state='FAILED' AND task.required)
       OR (SELECT coalesce(sum(event.amount_micro_usd) FILTER (WHERE event.event_type='RESERVED'),0)
             FROM public.cost_events event WHERE event.account_id=account_id AND event.workspace_id=workspace_id
               AND event.task_id=existing.task_id AND event.attempt_id=existing.attempt_id)
            IS DISTINCT FROM existing.reserved_cost_micro_usd
       OR (SELECT coalesce(sum(event.amount_micro_usd) FILTER (WHERE event.event_type='RELEASED'),0)
             FROM public.cost_events event WHERE event.account_id=account_id AND event.workspace_id=workspace_id
               AND event.task_id=existing.task_id AND event.attempt_id=existing.attempt_id)
            IS DISTINCT FROM existing.reserved_cost_micro_usd
       OR EXISTS (SELECT 1 FROM public.cost_events event
         WHERE event.account_id=account_id AND event.workspace_id=workspace_id
           AND event.task_id=existing.task_id AND event.attempt_id=existing.attempt_id
           AND event.event_type IN ('REPORTED','SETTLED') AND event.amount_micro_usd<>0) THEN
      RAISE EXCEPTION 'hosted prompt input repair evidence is invalid' USING ERRCODE='23514';
    END IF;
  END IF;
  IF (existing.id IS NULL AND requested_reserved IS DISTINCT FROM$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt input repair locked boundary drifted'; END IF;
  EXECUTE replace(definition,old_text,new_text);
END;
$$;
