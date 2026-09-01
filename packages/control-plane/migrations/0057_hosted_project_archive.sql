-- Tenant-scoped archive-only capability for hosted projects.
--
-- Project deletion in the hosted product is intentionally logical: the project disappears from
-- active product surfaces and cannot accept more work, while immutable revisions, attempts,
-- receipts, and cost/security lineage remain available for audit and retention enforcement.

CREATE FUNCTION public.videoforge_archive_hosted_project(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_project_id uuid
) RETURNS TABLE (
  project_id uuid,
  state text,
  retained_attempt_count bigint
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_account_id uuid := public.videoforge_current_account_id();
  target_status text;
  attempt_count bigint;
BEGIN
  IF current_account_id IS NULL OR current_account_id IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'hosted project tenant mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.workspaces AS workspace
     WHERE workspace.account_id = supplied_account_id
       AND workspace.id = supplied_workspace_id
       AND workspace.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'hosted project workspace mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT project.status
    INTO target_status
    FROM public.projects AS project
   WHERE project.account_id = supplied_account_id
     AND project.workspace_id = supplied_workspace_id
     AND project.id = supplied_project_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.hosted_cpu_job_attempts AS attempt
     WHERE attempt.account_id = supplied_account_id
       AND attempt.workspace_id = supplied_workspace_id
       AND attempt.project_id = supplied_project_id
       AND attempt.state IN (
         'PLANNED', 'OUTBOXED', 'SUBMITTED', 'RUNNING', 'RECONCILING', 'CANCEL_REQUESTED'
       )
  ) THEN
    RAISE EXCEPTION 'hosted project has active work' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.hosted_voiceover_contexts AS context
     WHERE context.account_id = supplied_account_id
       AND context.workspace_id = supplied_workspace_id
       AND context.project_id = supplied_project_id
       AND context.state = 'DISPATCHING'
  ) OR EXISTS (
    SELECT 1
      FROM public.hosted_prompt_runs AS prompt_run
     WHERE prompt_run.account_id = supplied_account_id
       AND prompt_run.workspace_id = supplied_workspace_id
       AND prompt_run.project_id = supplied_project_id
       AND prompt_run.state = 'DISPATCHING'
  ) OR EXISTS (
    SELECT 1
      FROM public.serverless_attempts AS attempt
     WHERE attempt.account_id = supplied_account_id
       AND attempt.workspace_id = supplied_workspace_id
       AND attempt.project_id = supplied_project_id
       AND attempt.state IN (
         'PLANNED', 'OUTBOXED', 'DISPATCHING', 'ASSIGNED', 'IN_QUEUE', 'IN_PROGRESS',
         'UPLOADING', 'RECONCILING', 'CANCELLING'
       )
  ) THEN
    RAISE EXCEPTION 'hosted project has active work' USING ERRCODE = '55000';
  END IF;

  SELECT count(*)
    INTO attempt_count
    FROM public.hosted_cpu_job_attempts AS attempt
   WHERE attempt.account_id = supplied_account_id
     AND attempt.workspace_id = supplied_workspace_id
     AND attempt.project_id = supplied_project_id;

  IF target_status = 'ACTIVE' THEN
    UPDATE public.projects AS project
       SET status = 'ARCHIVED',
           archived_at = COALESCE(project.archived_at, now()),
           updated_at = now(),
           version = project.version + 1
     WHERE project.account_id = supplied_account_id
       AND project.workspace_id = supplied_workspace_id
       AND project.id = supplied_project_id
       AND project.status = 'ACTIVE';
    target_status := 'ARCHIVED';
  END IF;

  project_id := supplied_project_id;
  state := target_status;
  retained_attempt_count := attempt_count;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.videoforge_archive_hosted_project(uuid, uuid, uuid) IS
  'Archive one tenant-owned hosted project only when it has no active work. Immutable revisions, attempts, receipts, artifacts, and cost/security lineage are retained.';

REVOKE ALL ON FUNCTION public.videoforge_archive_hosted_project(uuid, uuid, uuid) FROM PUBLIC;
