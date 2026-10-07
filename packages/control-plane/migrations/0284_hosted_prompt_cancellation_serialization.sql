-- Serialize prompt claims and owner cancellation on the owning generation request.
-- A claim that may have crossed the provider boundary keeps its durable identity and prevents
-- cancellation; a terminal request prevents any later claim. No claim/receipt/checkpoint is deleted.
DO $migration$
DECLARE
  definition text;
  old_text text;
  new_text text;
BEGIN
  definition:=pg_get_functiondef(
    'public.videoforge_claim_next_hosted_prompt_batch(uuid,integer,text,text,text)'::regprocedure);
  old_text:=$old$DECLARE run public.hosted_prompt_runs%ROWTYPE; existing public.hosted_prompt_batch_claims%ROWTYPE;$old$;
  new_text:=$new$DECLARE run public.hosted_prompt_runs%ROWTYPE;
  request public.generation_requests%ROWTYPE;
  existing public.hosted_prompt_batch_claims%ROWTYPE;$new$;
  IF position(old_text IN definition)=0 THEN
    RAISE EXCEPTION 'prompt cancellation claim declaration preimage drift';
  END IF;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;$old$;
  new_text:=$new$  -- Resolve the immutable prompt owner first, then use the same request -> advisory
  -- -> prompt-run order as cancellation. Legacy synthetic runs without a request retain their path.
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id THEN
    RAISE EXCEPTION 'hosted next prompt claim tenant is invalid' USING ERRCODE='42501';
  END IF;
  SELECT generation.* INTO request FROM public.generation_requests generation
   WHERE generation.account_id=run.account_id AND generation.workspace_id=run.workspace_id
     AND generation.project_id=run.project_id AND generation.project_revision_id=run.project_revision_id
   ORDER BY generation.created_at DESC,generation.id DESC LIMIT 1 FOR UPDATE;
  IF request.id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(request.id::text,43));
    IF request.state NOT IN ('WAITING','RETRY_WAIT','ADMITTED','ACTIVE') THEN
      RAISE EXCEPTION 'hosted prompt generation is terminal or cancelling' USING ERRCODE='55000';
    END IF;
  END IF;
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;$new$;
  IF position(old_text IN definition)=0 THEN
    RAISE EXCEPTION 'prompt cancellation claim lock preimage drift';
  END IF;
  definition:=replace(definition,old_text,new_text);
  EXECUTE definition;

  -- The lower-level initial-claim entrypoint is also executable and is called by the next-batch
  -- wrapper. Keep it safe when invoked directly, using the same owner-before-run lock order.
  definition:=pg_get_functiondef(
    'public.videoforge_claim_hosted_prompt_batch(uuid,integer,text,text,text)'::regprocedure);
  old_text:=$old$  existing public.hosted_prompt_batch_claims%ROWTYPE;$old$;
  new_text:=$new$  request public.generation_requests%ROWTYPE;
  existing public.hosted_prompt_batch_claims%ROWTYPE;$new$;
  IF position(old_text IN definition)=0 THEN
    RAISE EXCEPTION 'prompt direct claim declaration preimage drift';
  END IF;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$  SELECT run_row.* INTO run
    FROM public.hosted_prompt_runs run_row
   WHERE run_row.id=supplied_run_id
   FOR UPDATE;$old$;
  new_text:=$new$  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id THEN
    RAISE EXCEPTION 'hosted prompt batch claim tenant is invalid' USING ERRCODE='42501';
  END IF;
  SELECT generation.* INTO request FROM public.generation_requests generation
   WHERE generation.account_id=run.account_id AND generation.workspace_id=run.workspace_id
     AND generation.project_id=run.project_id AND generation.project_revision_id=run.project_revision_id
   ORDER BY generation.created_at DESC,generation.id DESC LIMIT 1 FOR UPDATE;
  IF request.id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(request.id::text,43));
    IF request.state NOT IN ('WAITING','RETRY_WAIT','ADMITTED','ACTIVE') THEN
      RAISE EXCEPTION 'hosted prompt generation is terminal or cancelling' USING ERRCODE='55000';
    END IF;
  END IF;
  SELECT run_row.* INTO run FROM public.hosted_prompt_runs run_row
   WHERE run_row.id=supplied_run_id FOR UPDATE;$new$;
  IF position(old_text IN definition)=0 THEN
    RAISE EXCEPTION 'prompt direct claim lock preimage drift';
  END IF;
  EXECUTE replace(definition,old_text,new_text);

  -- A failed-batch correction is another possible provider submission. It therefore takes the
  -- same generation-request/advisory locks before the run and cannot outlive owner cancellation.
  definition:=pg_get_functiondef(
    'public.videoforge_replace_invalid_hosted_prompt_batch(uuid,integer,text,text,bigint,text,text)'::regprocedure);
  old_text:=$old$  claim_row public.hosted_prompt_batch_claims%ROWTYPE;$old$;
  new_text:=$new$  request public.generation_requests%ROWTYPE;
  claim_row public.hosted_prompt_batch_claims%ROWTYPE;$new$;
  IF position(old_text IN definition)=0 THEN
    RAISE EXCEPTION 'prompt replacement declaration preimage drift';
  END IF;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;$old$;
  new_text:=$new$  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id THEN
    RAISE EXCEPTION 'hosted prompt replacement tenant is invalid' USING ERRCODE='42501';
  END IF;
  SELECT generation.* INTO request FROM public.generation_requests generation
   WHERE generation.account_id=run.account_id AND generation.workspace_id=run.workspace_id
     AND generation.project_id=run.project_id AND generation.project_revision_id=run.project_revision_id
   ORDER BY generation.created_at DESC,generation.id DESC LIMIT 1 FOR UPDATE;
  IF request.id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(request.id::text,43));
    IF request.state NOT IN ('WAITING','RETRY_WAIT','ADMITTED','ACTIVE') THEN
      RAISE EXCEPTION 'hosted prompt generation is terminal or cancelling' USING ERRCODE='55000';
    END IF;
  END IF;
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;$new$;
  IF position(old_text IN definition)=0 THEN
    RAISE EXCEPTION 'prompt replacement lock preimage drift';
  END IF;
  EXECUTE replace(definition,old_text,new_text);

  -- The non-video cancellation path owns the same request row and advisory lock. Once a claimed
  -- prompt batch exists, cancellation is deferred so response receipts and checkpoints remain live.
  definition:=pg_get_functiondef(
    'public.videoforge_cancel_hosted_project_predispatch_before_video(uuid,uuid,uuid)'::regprocedure);
  old_text:=$old$  PERFORM pg_advisory_xact_lock(hashtextextended(target_request.id::text,43));$old$;
  new_text:=$new$  PERFORM pg_advisory_xact_lock(hashtextextended(target_request.id::text,43));
  IF EXISTS (
    SELECT 1 FROM public.hosted_prompt_runs prompt_run
    WHERE prompt_run.account_id=supplied_account_id
      AND prompt_run.workspace_id=supplied_workspace_id
      AND prompt_run.project_id=supplied_project_id
      AND prompt_run.project_revision_id=target_request.project_revision_id
      AND prompt_run.state IN ('DISPATCHING','UNKNOWN')
      AND EXISTS (SELECT 1 FROM public.hosted_prompt_batch_claims claim
        WHERE claim.account_id=prompt_run.account_id AND claim.workspace_id=prompt_run.workspace_id
          AND claim.run_id=prompt_run.id)
  ) THEN
    RAISE EXCEPTION 'hosted prompt provider claim must reconcile before cancellation' USING ERRCODE='55000';
  END IF;$new$;
  IF position(old_text IN definition)=0 THEN
    RAISE EXCEPTION 'prompt cancellation base guard preimage drift';
  END IF;
  EXECUTE replace(definition,old_text,new_text);

  -- The video-aware wrapper can settle cancellation without calling its pre-video predecessor.
  -- Apply the same guard before either that path or delegation to the predecessor.
  definition:=pg_get_functiondef(
    'public.videoforge_cancel_hosted_project_predispatch(uuid,uuid,uuid)'::regprocedure);
  old_text:=$old$ IF request.id IS NULL THEN RETURN QUERY SELECT * FROM public.videoforge_cancel_hosted_project_predispatch_before_video(a,w,p); RETURN; END IF;$old$;
  new_text:=$new$ IF request.id IS NULL THEN RETURN QUERY SELECT * FROM public.videoforge_cancel_hosted_project_predispatch_before_video(a,w,p); RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(request.id::text,43));
 IF EXISTS (
   SELECT 1 FROM public.hosted_prompt_runs prompt_run
   WHERE prompt_run.account_id=a AND prompt_run.workspace_id=w AND prompt_run.project_id=p
     AND prompt_run.project_revision_id=request.project_revision_id
     AND prompt_run.state IN ('DISPATCHING','UNKNOWN')
     AND EXISTS (SELECT 1 FROM public.hosted_prompt_batch_claims claim
       WHERE claim.account_id=prompt_run.account_id AND claim.workspace_id=prompt_run.workspace_id
         AND claim.run_id=prompt_run.id)
 ) THEN
   RAISE EXCEPTION 'hosted prompt provider claim must reconcile before cancellation' USING ERRCODE='55000';
 END IF;$new$;
  IF position(old_text IN definition)=0 THEN
    RAISE EXCEPTION 'prompt cancellation video guard preimage drift';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END;
$migration$;
