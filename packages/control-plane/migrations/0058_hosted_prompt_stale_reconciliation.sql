-- Migration 0056's UNKNOWN failure handlers set attempts.finished_at, but the durable attempt
-- contract requires UNKNOWN to remain unresolved: finished_at NULL, result PENDING, dispatch
-- AMBIGUOUS. Repair both handlers before adding stale-claim recovery.
CREATE OR REPLACE FUNCTION public.videoforge_fail_hosted_voiceover_context(
  supplied_context_id uuid,
  supplied_state text,
  supplied_problem_code text,
  supplied_provider_may_have_charged boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE context public.hosted_voiceover_contexts%ROWTYPE; now_at timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO context FROM public.hosted_voiceover_contexts
   WHERE id=supplied_context_id FOR UPDATE;
  IF context.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM context.account_id
     OR context.state<>'DISPATCHING' OR supplied_state NOT IN ('FAILED','UNKNOWN')
     OR supplied_problem_code !~ '^[A-Z0-9_]{3,80}$'
     OR supplied_provider_may_have_charged<>(supplied_state='UNKNOWN') THEN
    RAISE EXCEPTION 'hosted voiceover context failure is invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.attempts
     SET state=CASE supplied_state WHEN 'UNKNOWN' THEN 'UNKNOWN' ELSE 'FAILED' END,
         dispatch_state=CASE supplied_state WHEN 'UNKNOWN' THEN 'AMBIGUOUS' ELSE dispatch_state END,
         problem_code=supplied_problem_code,
         finished_at=CASE supplied_state WHEN 'UNKNOWN' THEN NULL ELSE now_at END
   WHERE workspace_id=context.workspace_id AND task_id=context.task_id AND id=context.attempt_id;
  UPDATE public.generation_tasks SET state='FAILED',version=version+1,finished_at=now_at,
    updated_at=now_at WHERE workspace_id=context.workspace_id AND id=context.task_id;
  UPDATE public.hosted_voiceover_contexts SET state=supplied_state,
    problem_code=supplied_problem_code,
    provider_may_have_charged=supplied_provider_may_have_charged,
    finished_at=now_at WHERE id=context.id;
  IF supplied_state='FAILED' THEN
    INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
      sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
    VALUES(gen_random_uuid(),context.account_id,context.workspace_id,'PROJECT_REVISION',
      context.project_revision_id,context.task_id,context.attempt_id,
      context.reservation_cost_sequence+1,'RELEASED',context.reserved_cost_micro_usd,
      'hosted-voiceover-context:'||context.project_revision_id||':released',
      jsonb_build_object('problem_code',supplied_problem_code),now_at);
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.videoforge_fail_hosted_prompt_run(
  supplied_run_id uuid,
  supplied_state text,
  supplied_problem_code text,
  supplied_provider_may_have_charged boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE run public.hosted_prompt_runs%ROWTYPE; now_at timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id
     OR run.state<>'DISPATCHING' OR supplied_state NOT IN ('FAILED','UNKNOWN')
     OR supplied_problem_code !~ '^[A-Z0-9_]{3,80}$'
     OR supplied_provider_may_have_charged<>(supplied_state='UNKNOWN') THEN
    RAISE EXCEPTION 'hosted prompt failure is invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.attempts
     SET state=CASE supplied_state WHEN 'UNKNOWN' THEN 'UNKNOWN' ELSE 'FAILED' END,
         dispatch_state=CASE supplied_state WHEN 'UNKNOWN' THEN 'AMBIGUOUS' ELSE dispatch_state END,
         problem_code=supplied_problem_code,
         finished_at=CASE supplied_state WHEN 'UNKNOWN' THEN NULL ELSE now_at END
   WHERE workspace_id=run.workspace_id AND task_id=run.task_id AND id=run.attempt_id;
  UPDATE public.generation_tasks SET state='FAILED',version=version+1,finished_at=now_at,
    updated_at=now_at WHERE workspace_id=run.workspace_id AND id=run.task_id;
  UPDATE public.hosted_prompt_runs SET state=supplied_state,problem_code=supplied_problem_code,
    provider_may_have_charged=supplied_provider_may_have_charged,finished_at=now_at WHERE id=run.id;
  IF supplied_state='FAILED' THEN
    INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
      sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
    VALUES(gen_random_uuid(),run.account_id,run.workspace_id,'PROJECT_REVISION',run.project_revision_id,
      run.task_id,run.attempt_id,run.reservation_cost_sequence+1,'RELEASED',
      run.reserved_cost_micro_usd,
      'hosted-prompt:'||run.project_revision_id||':released',
      jsonb_build_object('problem_code',supplied_problem_code),now_at);
  END IF;
  RETURN true;
END;
$$;

-- A browser/edge request can end after a provider dispatch is durably claimed but before the
-- provider result or the catch-path is persisted. Reconcile only claims older than the fixed
-- provider deadline, mark them UNKNOWN, and preserve their reservation because the provider may
-- have received the request. This function never creates or redispatches work.
CREATE FUNCTION public.videoforge_reconcile_stale_hosted_prompt_dispatches(
  supplied_project_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  current_account_id uuid:=public.videoforge_current_account_id();
  stale_before timestamptz:=clock_timestamp()-interval '3 minutes';
  context_row record;
  prompt_row record;
  context_count integer:=0;
  prompt_count integer:=0;
BEGIN
  IF current_account_id IS NULL THEN
    RAISE EXCEPTION 'hosted prompt reconciliation requires tenant scope' USING ERRCODE='42501';
  END IF;

  FOR context_row IN
    SELECT context.id
      FROM public.hosted_voiceover_contexts AS context
     WHERE context.account_id=current_account_id
       AND context.project_id=supplied_project_id
       AND context.state='DISPATCHING'
       AND context.started_at<=stale_before
     FOR UPDATE
  LOOP
    PERFORM public.videoforge_fail_hosted_voiceover_context(
      context_row.id,
      'UNKNOWN',
      'HOSTED_CONTEXT_DISPATCH_TIMEOUT',
      true
    );
    context_count:=context_count+1;
  END LOOP;

  FOR prompt_row IN
    SELECT run.id
      FROM public.hosted_prompt_runs AS run
     WHERE run.account_id=current_account_id
       AND run.project_id=supplied_project_id
       AND run.state='DISPATCHING'
       AND run.started_at<=stale_before
     FOR UPDATE
  LOOP
    PERFORM public.videoforge_fail_hosted_prompt_run(
      prompt_row.id,
      'UNKNOWN',
      'HOSTED_PROMPT_DISPATCH_TIMEOUT',
      true
    );
    prompt_count:=prompt_count+1;
  END LOOP;

  RETURN jsonb_build_object(
    'context_reconciled',context_count,
    'prompt_reconciled',prompt_count,
    'redispatched',false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_reconcile_stale_hosted_prompt_dispatches(uuid)
FROM PUBLIC;
