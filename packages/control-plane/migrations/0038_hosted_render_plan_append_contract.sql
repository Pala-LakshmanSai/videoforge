-- V2-09 narrow hosted render-plan insertion capability.
--
-- The hosted application still has no table-wide write authority. This function admits only one
-- exact, tenant-scoped plan for an already locked revision and treats an exact replay as a no-op.

CREATE FUNCTION public.videoforge_append_hosted_render_plan(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_project_id uuid,
  supplied_project_revision_id uuid,
  supplied_schema_version text,
  supplied_payload jsonb,
  supplied_payload_sha256 text
) RETURNS TABLE (inserted boolean, payload jsonb, payload_sha256 text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  current_account_id uuid;
  inserted_count integer;
  stored hosted_render_plans%ROWTYPE;
BEGIN
  current_account_id := public.videoforge_current_account_id();
  IF current_account_id IS NULL OR current_account_id <> supplied_account_id
     OR supplied_schema_version <> 'videoforge-hosted-cpu-submission/v1'
     OR supplied_payload_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(supplied_payload) <> 'object'
     OR supplied_payload->>'schema_version' IS DISTINCT FROM supplied_schema_version
     OR supplied_payload->>'project_id' IS DISTINCT FROM supplied_project_id::text
     OR supplied_payload->>'project_revision_id'
          IS DISTINCT FROM supplied_project_revision_id::text THEN
    RAISE EXCEPTION 'hosted render plan insertion authority is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM workspaces AS workspace
      JOIN projects AS project
        ON project.account_id = workspace.account_id
       AND project.workspace_id = workspace.id
      JOIN project_revisions AS revision
        ON revision.account_id = project.account_id
       AND revision.workspace_id = project.workspace_id
       AND revision.project_id = project.id
     WHERE workspace.account_id = supplied_account_id
       AND workspace.id = supplied_workspace_id
       AND project.id = supplied_project_id
       AND revision.id = supplied_project_revision_id
       AND revision.status = 'LOCKED'
  ) THEN
    RAISE EXCEPTION 'hosted render plan requires the exact owned locked revision'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO hosted_render_plans (
    account_id, workspace_id, project_id, project_revision_id,
    schema_version, payload, payload_sha256
  ) VALUES (
    supplied_account_id, supplied_workspace_id, supplied_project_id,
    supplied_project_revision_id, supplied_schema_version, supplied_payload,
    supplied_payload_sha256
  )
  ON CONFLICT (account_id, workspace_id, project_id, project_revision_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT plan.* INTO stored
    FROM hosted_render_plans AS plan
   WHERE plan.account_id = supplied_account_id
     AND plan.workspace_id = supplied_workspace_id
     AND plan.project_id = supplied_project_id
     AND plan.project_revision_id = supplied_project_revision_id;
  IF stored.project_revision_id IS NULL
     OR stored.schema_version <> supplied_schema_version
     OR stored.payload IS DISTINCT FROM supplied_payload
     OR stored.payload_sha256 <> supplied_payload_sha256 THEN
    RAISE EXCEPTION 'hosted render plan idempotency conflict' USING ERRCODE = '23505';
  END IF;

  RETURN QUERY SELECT inserted_count = 1, stored.payload, stored.payload_sha256;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_append_hosted_render_plan(
  uuid, uuid, uuid, uuid, text, jsonb, text
) FROM PUBLIC;

