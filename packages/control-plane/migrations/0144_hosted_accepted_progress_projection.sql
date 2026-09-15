-- Expose only tenant-bound accepted counts/timestamps to the product reader.
CREATE FUNCTION public.videoforge_hosted_accepted_lane_progress(
  supplied_account_id uuid, supplied_workspace_id uuid,
  supplied_project_id uuid, supplied_revision_id uuid
) RETURNS TABLE(attempt_id uuid, accepted_count integer, completed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF supplied_account_id IS NULL OR supplied_workspace_id IS NULL
    OR supplied_project_id IS NULL OR supplied_revision_id IS NULL
    OR public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'tenant mismatch' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT barrier.attempt_id,jsonb_array_length(barrier.expected_objects),barrier.completed_at
    FROM public.hosted_serverless_output_barrier_completions barrier
    JOIN public.serverless_attempts attempt ON attempt.id=barrier.attempt_id
      AND attempt.account_id=barrier.account_id AND attempt.workspace_id=barrier.workspace_id
      AND attempt.project_id=barrier.project_id AND attempt.project_revision_id=barrier.project_revision_id
      AND attempt.lane=barrier.lane AND attempt.deployment_id=barrier.deployment_id
      AND attempt.dispatch_token_sha256=barrier.dispatch_token_sha256
    JOIN public.serverless_provider_assignments assignment ON assignment.id=barrier.assignment_id
      AND assignment.account_id=barrier.account_id AND assignment.workspace_id=barrier.workspace_id
      AND assignment.attempt_id=barrier.attempt_id AND assignment.provider_job_id=barrier.provider_job_id
      AND assignment.is_current
    WHERE barrier.account_id=supplied_account_id AND barrier.workspace_id=supplied_workspace_id
      AND barrier.project_id=supplied_project_id AND barrier.project_revision_id=supplied_revision_id;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_accepted_lane_progress(uuid,uuid,uuid,uuid) FROM PUBLIC;
DO $migration$
DECLARE principal record;
BEGIN
  FOR principal IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='serverless_attempts' AND privilege_type='SELECT'
      AND grantee<>'PUBLIC'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.videoforge_hosted_accepted_lane_progress(uuid,uuid,uuid,uuid) TO %I',principal.grantee);
  END LOOP;
END;
$migration$;
