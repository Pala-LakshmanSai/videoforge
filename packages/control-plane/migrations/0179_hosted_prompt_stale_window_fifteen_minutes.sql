-- 0179_hosted_prompt_stale_window_fifteen_minutes.sql
--
-- Widens the stale-dispatch reconciliation's window from three minutes to fifteen. A healthy prompt
-- batch drives a provider call that runs for minutes; with a three-minute window the reconciliation
-- settled live attempts as timed out, and each settled attempt was then replaced by the next
-- redispatch, so no batch could ever finish. This file also re-states the fifth-argument call
-- repaired in 0178 so the function is correct whichever order the two are applied in.

CREATE OR REPLACE FUNCTION public.videoforge_reconcile_stale_hosted_prompt_dispatches(
  supplied_project_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  current_account_id uuid:=public.videoforge_current_account_id();
  stale_before timestamptz:=clock_timestamp()-interval '3 minutes';
  -- The prompt window is wider than the context window on purpose: a prompt batch drives a provider
  -- call that legitimately runs for minutes, so a three-minute window settled live attempts as timed
  -- out and each settled attempt was replaced by the next redispatch, so no batch could ever finish.
  -- A genuinely dead dispatch is still recovered, and the redispatch budget bounds repetition.
  prompt_stale_before timestamptz:=clock_timestamp()-interval '15 minutes';
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
       AND run.started_at<=prompt_stale_before
     FOR UPDATE
  LOOP
    PERFORM public.videoforge_fail_hosted_prompt_run(
      prompt_row.id,
      'UNKNOWN',
      'HOSTED_PROMPT_DISPATCH_TIMEOUT',
      true,
      0
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
