-- Reopen only a fully accepted UNKNOWN prompt run for immediate atomic completion.
-- The caller must invoke videoforge_complete_hosted_prompt_run in the same transaction.
-- Any completion error rolls this change back; this function never dispatches a provider call.
CREATE FUNCTION public.videoforge_reopen_complete_hosted_prompt_run(
  supplied_run_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  run public.hosted_prompt_runs%ROWTYPE;
  batch_count integer;
  scene_count integer;
  batch_cost bigint;
  recorded_scene_count integer;
  claim_count integer;
  reservation_count integer;
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs
   WHERE id=supplied_run_id FOR UPDATE;
  IF run.id IS NULL
     OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id
     OR run.state<>'UNKNOWN' OR run.provider_may_have_charged IS NOT TRUE
     OR run.problem_code NOT IN ('HOSTED_PROMPT_DISPATCH_TIMEOUT','HOSTED_PROMPT_EXECUTION_UNKNOWN')
     OR run.acceptance_fingerprint_hash IS NOT NULL
     OR run.planned_batch_count IS NULL OR run.planned_scene_count IS NULL
     OR run.batch_plan_hash IS NULL THEN
    RAISE EXCEPTION 'hosted prompt complete recovery state is invalid' USING ERRCODE='23514';
  END IF;

  SELECT count(*)::integer,coalesce(sum(progress.scene_count),0)::integer,
         coalesce(sum(progress.reported_cost_micro_usd),0)::bigint
    INTO batch_count,scene_count,batch_cost
    FROM public.hosted_prompt_batch_progress progress
   WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
     AND progress.run_id=run.id;
  SELECT count(*)::integer INTO recorded_scene_count
    FROM public.hosted_prompt_scene_progress scene
   WHERE scene.account_id=run.account_id AND scene.workspace_id=run.workspace_id
     AND scene.run_id=run.id;
  SELECT count(*)::integer INTO claim_count
    FROM public.hosted_prompt_batch_claims claim
   WHERE claim.account_id=run.account_id AND claim.workspace_id=run.workspace_id
     AND claim.run_id=run.id;
  SELECT count(*)::integer INTO reservation_count
    FROM public.cost_events event
   WHERE event.account_id=run.account_id AND event.workspace_id=run.workspace_id
     AND event.task_id=run.task_id AND event.attempt_id=run.attempt_id
     AND event.owner_type='PROJECT_REVISION' AND event.owner_id=run.project_revision_id
     AND event.event_type='RESERVED' AND event.sequence=run.reservation_cost_sequence
     AND event.amount_micro_usd=run.reserved_cost_micro_usd;

  IF batch_count<>run.planned_batch_count
     OR scene_count<>run.planned_scene_count
     OR recorded_scene_count<>run.planned_scene_count
     OR run.reported_cost_micro_usd IS DISTINCT FROM batch_cost
     OR batch_cost>run.reserved_cost_micro_usd
     OR claim_count<>run.planned_batch_count
     OR reservation_count<>1
     OR EXISTS (
       SELECT 1 FROM public.cost_events event
        WHERE event.account_id=run.account_id AND event.workspace_id=run.workspace_id
          AND event.task_id=run.task_id AND event.attempt_id=run.attempt_id
          AND (event.owner_type<>'PROJECT_REVISION'
               OR event.owner_id<>run.project_revision_id
               OR event.event_type<>'RESERVED'
               OR event.sequence<>run.reservation_cost_sequence
               OR event.amount_micro_usd<>run.reserved_cost_micro_usd)
     )
     OR EXISTS (
       SELECT 1 FROM public.prompt_executions execution
        WHERE execution.account_id=run.account_id AND execution.workspace_id=run.workspace_id
          AND (execution.task_id=run.task_id OR execution.attempt_id=run.attempt_id
               OR execution.outbox_id=run.outbox_id)
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.attempts attempt
        WHERE attempt.workspace_id=run.workspace_id AND attempt.task_id=run.task_id
          AND attempt.id=run.attempt_id AND attempt.state='UNKNOWN'
          AND attempt.dispatch_state='AMBIGUOUS' AND attempt.claim_state='CLAIMED'
          AND attempt.problem_code=run.problem_code
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.generation_tasks task
        WHERE task.workspace_id=run.workspace_id AND task.id=run.task_id
          AND task.project_revision_id=run.project_revision_id AND task.state='FAILED'
     )
     OR EXISTS (
       SELECT 1 FROM generate_series(0,run.planned_batch_count-1) AS expected(batch_ordinal)
       LEFT JOIN public.hosted_prompt_batch_progress progress
         ON progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
        AND progress.run_id=run.id AND progress.batch_ordinal=expected.batch_ordinal
       LEFT JOIN public.hosted_prompt_batch_claims claim
         ON claim.account_id=run.account_id AND claim.workspace_id=run.workspace_id
        AND claim.run_id=run.id AND claim.batch_ordinal=expected.batch_ordinal
        AND claim.id=progress.claim_id AND claim.task_id=run.task_id
        AND claim.attempt_id=run.attempt_id AND claim.outbox_id=run.outbox_id
       WHERE progress.id IS NULL OR claim.id IS NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.hosted_prompt_batch_progress progress
       LEFT JOIN public.hosted_prompt_scene_progress scene
         ON scene.account_id=progress.account_id AND scene.workspace_id=progress.workspace_id
        AND scene.run_id=progress.run_id AND scene.batch_progress_id=progress.id
       WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
         AND progress.run_id=run.id
       GROUP BY progress.id,progress.scene_count,progress.first_scene_ordinal
       HAVING count(scene.id)<>progress.scene_count
          OR min(scene.scene_ordinal)<>progress.first_scene_ordinal
          OR max(scene.scene_ordinal)<>progress.first_scene_ordinal+progress.scene_count-1
     )
     OR EXISTS (
       SELECT 1 FROM public.hosted_prompt_scene_progress scene
        WHERE scene.account_id=run.account_id AND scene.workspace_id=run.workspace_id
          AND scene.run_id=run.id AND scene.batch_progress_id IS NULL
     ) THEN
    RAISE EXCEPTION 'hosted prompt complete recovery evidence is invalid' USING ERRCODE='23514';
  END IF;

  UPDATE public.hosted_prompt_runs
     SET state='DISPATCHING',problem_code=NULL,provider_may_have_charged=false,finished_at=NULL
   WHERE id=run.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_reopen_complete_hosted_prompt_run(uuid) FROM PUBLIC;
-- Owner-only migration activation does not run the separate runtime-grants file. Copy the
-- existing completion capability's named grantees; never grant to PUBLIC.
DO $$
DECLARE principal record;
BEGIN
  FOR principal IN
    SELECT DISTINCT pg_get_userbyid(acl.grantee) AS role_name
      FROM pg_proc proc
      CROSS JOIN LATERAL aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl
     WHERE proc.oid='public.videoforge_complete_hosted_prompt_run(jsonb)'::regprocedure
       AND acl.privilege_type='EXECUTE' AND acl.grantee<>0
       AND acl.grantee<>proc.proowner
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.videoforge_reopen_complete_hosted_prompt_run(uuid) TO %I',principal.role_name);
  END LOOP;
END;
$$;

-- Prevent the stale reconciler from treating a fully accepted finalization gap as provider uncertainty.
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
       -- A complete, durably accepted run is waiting for finalization, not provider output.
       -- Keep it DISPATCHING so a delayed finalization can settle the original reservation.
       AND NOT (
         run.planned_batch_count IS NOT NULL AND run.planned_scene_count IS NOT NULL
         AND (SELECT count(*)::integer FROM public.hosted_prompt_batch_progress progress
               WHERE progress.account_id=run.account_id AND progress.workspace_id=run.workspace_id
                 AND progress.run_id=run.id)=run.planned_batch_count
         AND (SELECT count(*)::integer FROM public.hosted_prompt_scene_progress scene
               WHERE scene.account_id=run.account_id AND scene.workspace_id=run.workspace_id
                 AND scene.run_id=run.id)=run.planned_scene_count
         AND NOT EXISTS (
           SELECT 1 FROM public.hosted_prompt_batch_claims claim
           LEFT JOIN public.hosted_prompt_batch_progress progress
             ON progress.account_id=claim.account_id AND progress.workspace_id=claim.workspace_id
            AND progress.run_id=claim.run_id AND progress.claim_id=claim.id
           WHERE claim.account_id=run.account_id AND claim.workspace_id=run.workspace_id
             AND claim.run_id=run.id AND progress.id IS NULL
         )
       )
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
