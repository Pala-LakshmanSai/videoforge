-- Expose one tenant-bound style-analysis terminal state without granting the
-- hosted runtime direct access to the append-only spend-guard table.
CREATE FUNCTION public.videoforge_read_hosted_style_analysis_state(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_style_version_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT run.state
    FROM public.hosted_style_analysis_runs AS run
   WHERE public.videoforge_current_account_id() = supplied_account_id
     AND run.account_id = supplied_account_id
     AND run.workspace_id = supplied_workspace_id
     AND run.style_version_id = supplied_style_version_id
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.videoforge_read_hosted_style_analysis_state(uuid, uuid, uuid) FROM PUBLIC;
