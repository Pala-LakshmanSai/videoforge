-- V2-06 immutable hosted render-plan authority.
--
-- A render plan is activation-owned provenance for one exact locked revision.  It is deliberately
-- kept outside project_revisions.revision_config_payload: the resolved render manifest named by
-- this plan carries the revision_config_hash, so embedding the plan in that payload would create a
-- circular hash dependency.  Runtime code may read this table only; activation tooling inserts the
-- row with the migration-owner connection after the exact tenant fixture is prepared.

CREATE TABLE hosted_render_plans (
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'videoforge-hosted-cpu-submission/v1'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, workspace_id, project_id, project_revision_id),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_id)
    REFERENCES projects (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_revision_id)
    REFERENCES project_revisions (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK (payload->>'schema_version' IS NOT DISTINCT FROM schema_version),
  CHECK (payload->>'project_id' IS NOT DISTINCT FROM project_id::text),
  CHECK (payload->>'project_revision_id' IS NOT DISTINCT FROM project_revision_id::text),
  CHECK (updated_at >= created_at)
);

CREATE INDEX hosted_render_plans_account_created_idx
  ON hosted_render_plans (account_id, workspace_id, created_at DESC);

CREATE FUNCTION public.videoforge_validate_hosted_render_plan_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM projects AS project
      JOIN project_revisions AS revision
        ON revision.account_id = project.account_id
       AND revision.workspace_id = project.workspace_id
       AND revision.project_id = project.id
     WHERE project.account_id = NEW.account_id
       AND project.workspace_id = NEW.workspace_id
       AND project.id = NEW.project_id
       AND revision.id = NEW.project_revision_id
       AND revision.status = 'LOCKED'
  ) THEN
    RAISE EXCEPTION 'hosted render plan requires the exact locked project revision'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hosted_render_plans_tenant_account_derived
  BEFORE INSERT OR UPDATE ON hosted_render_plans
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account();
CREATE TRIGGER hosted_render_plans_tenant_write_guard
  BEFORE INSERT OR UPDATE ON hosted_render_plans
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER hosted_render_plans_validate_lineage
  BEFORE INSERT OR UPDATE ON hosted_render_plans
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_hosted_render_plan_lineage();
CREATE TRIGGER hosted_render_plans_append_only
  BEFORE UPDATE OR DELETE ON hosted_render_plans
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();

ALTER TABLE hosted_render_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_render_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_render_plans_tenant_rls ON hosted_render_plans
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

-- No application role receives INSERT/UPDATE/DELETE on this table.  The activation owner is the
-- only writer, and the append-only trigger remains a second independent immutability fence.
REVOKE ALL ON TABLE hosted_render_plans FROM PUBLIC;
