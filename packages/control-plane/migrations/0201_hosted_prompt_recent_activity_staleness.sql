-- Keep long prompt runs alive while claims or accepted batches show recent progress.
CREATE OR REPLACE FUNCTION public.videoforge_reconcile_stale_hosted_prompt_dispatches(
  supplied_project_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  current_account_id uuid:=public.videoforge_current_account_id();
  stale_before timestamptz:=clock_timestamp()-interval '3 minutes';
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
       AND GREATEST(
         run.started_at,
         COALESCE((
           SELECT max(claim_row.created_at)
             FROM public.hosted_prompt_batch_claims AS claim_row
            WHERE claim_row.account_id=run.account_id
              AND claim_row.workspace_id=run.workspace_id
              AND claim_row.run_id=run.id
              AND claim_row.task_id=run.task_id
              AND claim_row.attempt_id=run.attempt_id
              AND claim_row.outbox_id=run.outbox_id
         ),run.started_at),
         COALESCE((
           SELECT max(progress.created_at)
             FROM public.hosted_prompt_batch_progress AS progress
            WHERE progress.account_id=run.account_id
              AND progress.workspace_id=run.workspace_id
              AND progress.run_id=run.id
              AND (progress.claim_id IS NULL OR EXISTS (
                SELECT 1 FROM public.hosted_prompt_batch_claims AS claim_row
                 WHERE claim_row.account_id=progress.account_id
                   AND claim_row.workspace_id=progress.workspace_id
                   AND claim_row.id=progress.claim_id
                   AND claim_row.task_id=run.task_id
                   AND claim_row.attempt_id=run.attempt_id
                   AND claim_row.outbox_id=run.outbox_id
              ))
         ),run.started_at)
       )<=prompt_stale_before
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
