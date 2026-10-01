-- A replacement is a new bounded request against an old immutable claim. Its timestamp is
-- provider activity, so a concurrent progress read cannot reap it using the original claim's age.
DO $$
DECLARE definition text; old_text text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_reconcile_stale_hosted_prompt_dispatches(uuid)'::regprocedure);
  old_text:='AND GREATEST(
         run.started_at,';
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt replacement freshness boundary drifted'; END IF;
  definition:=replace(definition,old_text,old_text||'
         COALESCE((
           SELECT max(replacement.created_at)
             FROM public.hosted_prompt_batch_replacements replacement
             JOIN public.hosted_prompt_batch_claims claim ON claim.id=replacement.claim_id
            WHERE replacement.account_id=run.account_id AND replacement.workspace_id=run.workspace_id
              AND replacement.run_id=run.id AND claim.account_id=run.account_id
              AND claim.workspace_id=run.workspace_id AND claim.run_id=run.id
              AND claim.task_id=run.task_id AND claim.attempt_id=run.attempt_id
              AND claim.outbox_id=run.outbox_id
         ),run.started_at),');
  EXECUTE definition;
END;
$$;
