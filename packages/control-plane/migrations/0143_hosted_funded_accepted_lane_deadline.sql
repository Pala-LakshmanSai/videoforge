-- Accepted lane output stops its funded clock before pair settlement changes attempt state.
CREATE OR REPLACE FUNCTION public.videoforge_hosted_pair_funded_deadlines(supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid)
RETURNS TABLE(lane text,funded_deadline_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'tenant mismatch' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  WITH charged AS (
    SELECT attempt.lane,admission.database_observed_at AS anchor,
      (admission.admission_document#>>'{cost,totalGpuTimeoutSeconds}')::integer AS pool_seconds,
      CASE attempt.lane WHEN 'mage_image' THEN (admission.admission_document#>>'{cost,mageImageTimeoutSeconds}')::integer
      ELSE (admission.admission_document#>>'{cost,soulxAvatarTimeoutSeconds}')::integer END AS hard_seconds,
      greatest(0,extract(epoch FROM least(transaction_timestamp(),coalesce(barrier.completed_at,attempt.provider_terminal_observed_at,CASE WHEN attempt.state IN ('SUCCEEDED','PERMANENT_FAILED','CANCELLED') THEN attempt.updated_at ELSE transaction_timestamp() END))-admission.database_observed_at)) AS charged_seconds,
      (barrier.completed_at IS NOT NULL OR attempt.provider_terminal_observed_at IS NOT NULL OR attempt.state IN ('SUCCEEDED','PERMANENT_FAILED','CANCELLED')) AS terminal
    FROM public.hosted_v209_short_admissions admission JOIN public.serverless_attempts attempt
      ON attempt.account_id=admission.account_id AND attempt.workspace_id=admission.workspace_id
      AND attempt.generation_request_id=admission.generation_request_id
    LEFT JOIN public.serverless_provider_assignments assignment
      ON assignment.account_id=attempt.account_id AND assignment.workspace_id=attempt.workspace_id
      AND assignment.attempt_id=attempt.id AND assignment.is_current
    LEFT JOIN public.hosted_serverless_output_barrier_completions barrier
      ON barrier.account_id=attempt.account_id AND barrier.workspace_id=attempt.workspace_id
      AND barrier.project_id=attempt.project_id AND barrier.project_revision_id=attempt.project_revision_id
      AND barrier.attempt_id=attempt.id AND barrier.lane=attempt.lane
      AND barrier.assignment_id=assignment.id AND barrier.provider_job_id=assignment.provider_job_id
      AND barrier.deployment_id=attempt.deployment_id
      AND barrier.dispatch_token_sha256=attempt.dispatch_token_sha256
    WHERE admission.account_id=supplied_account_id AND admission.workspace_id=supplied_workspace_id
      AND admission.generation_request_id=supplied_generation_request_id
      AND admission.admission_document#>>'{cost,budgetVersion}'='ordinary-video-budget/v1'
      AND attempt.lane IN ('mage_image','soulx_avatar')
  )
  SELECT current_lane.lane,current_lane.anchor+make_interval(secs=>least(current_lane.hard_seconds,
    CASE WHEN other_lane.terminal THEN greatest(0,current_lane.pool_seconds-other_lane.charged_seconds)
      ELSE current_lane.pool_seconds/2.0 END)::double precision)
    FROM charged current_lane JOIN charged other_lane ON other_lane.lane<>current_lane.lane;
END;
$$;
