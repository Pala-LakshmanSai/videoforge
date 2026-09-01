-- Generation-task and attempt accepted-result checks are deferred until transaction commit. The
-- hosted canonical append inserts BLOCKED tasks through a SECURITY DEFINER function, but commit
-- occurs after PostgreSQL restores the restricted runtime role. Execute only this read-only trigger
-- validator as its owner; the runtime keeps no direct timing/task-table access and no helper grant.

ALTER FUNCTION public.videoforge_enforce_task_accepted_result() SECURITY DEFINER;
ALTER FUNCTION public.videoforge_enforce_task_accepted_result()
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.videoforge_enforce_task_accepted_result() FROM PUBLIC;
